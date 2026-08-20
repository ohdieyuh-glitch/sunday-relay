import type {
  MarbleAssetManifest,
  MarbleGenerationOperation,
  MarbleGenerationRequest,
  MarbleOperationState,
  MarbleSplatResolution,
  MarbleWorldRegion,
  WorldLabsOperation,
  WorldLabsWorld,
} from './marble-contracts';
import { MARBLE_SPLAT_RESOLUTIONS } from './marble-contracts';

/**
 * MARBLE OPERATIONS — the state machine, and the rules that keep a retry from
 * becoming a second bill.
 *
 * PURE. Time is injected. Nothing here performs I/O; a provider does that and
 * hands the result back in.
 */

/* -------------------------------------------------------------- dedupe */

/**
 * A content key for a request, so the same ask twice is recognised as the same
 * ask.
 *
 * Deliberately does NOT include requestId, requestedAtIso or requestedBy: two
 * people asking for the identical region at different times want the SAME
 * world, and generating it twice costs money for nothing. It DOES include
 * projectId, because cross-project reuse would leak one project's environment
 * into another and that isolation matters more than the saving.
 */
export function marbleDedupeKey(req: MarbleGenerationRequest): string {
  const imgs = (req.imageRefs ?? [])
    .map((r) => `${r.source}:${r.value}`)
    .slice()
    .sort()
    .join('|');
  return [
    req.projectId,
    req.regionId,
    req.model,
    req.promptType,
    (req.textPrompt ?? '').trim(),
    imgs,
  ].join(' ');
}

/* ----------------------------------------------------------- validation */

export interface MarbleValidation {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * Reject a request the API would reject, before it costs anything, and reject
 * one Relay should not make at all.
 */
export function validateMarbleRequest(
  req: MarbleGenerationRequest,
  region?: MarbleWorldRegion | null,
): MarbleValidation {
  const problems: string[] = [];
  const need = (v: unknown, name: string) => {
    if (typeof v !== 'string' || v.trim() === '') problems.push(`${name} is required`);
  };
  need(req.requestId, 'requestId');
  need(req.projectId, 'projectId');
  need(req.regionId, 'regionId');
  need(req.displayName, 'displayName');
  need(req.requestedBy, 'requestedBy');
  need(req.requestedAtIso, 'requestedAtIso');

  if (req.promptType === 'text') {
    if (!req.textPrompt || req.textPrompt.trim() === '') {
      problems.push('textPrompt is required for a text prompt');
    }
  } else if (req.promptType === 'image' || req.promptType === 'multi-image') {
    const n = req.imageRefs?.length ?? 0;
    if (n === 0) problems.push(`${req.promptType} needs at least one image reference`);
    if (req.promptType === 'image' && n > 1) {
      problems.push('image prompt takes exactly one reference; use multi-image for more');
    }
  } else if (req.promptType === 'video') {
    if ((req.imageRefs?.length ?? 0) === 0) problems.push('video prompt needs a media reference');
  }

  // A region the caller did not supply is not the same as a region that does
  // not exist, so this only checks the binding when one was given.
  if (region && region.regionId !== req.regionId) {
    problems.push(`region ${region.regionId} does not match request region ${req.regionId}`);
  }
  return { ok: problems.length === 0, problems };
}

/* -------------------------------------------------------- state machine */

const ALLOWED: Readonly<Record<MarbleOperationState, readonly MarbleOperationState[]>> = {
  draft: ['awaiting_approval', 'cancelled'],
  awaiting_approval: ['approved', 'cancelled'],
  approved: ['submitted', 'cancelled'],
  submitted: ['running', 'succeeded', 'failed', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: MarbleOperationState, to: MarbleOperationState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function newMarbleOperation(req: MarbleGenerationRequest): MarbleGenerationOperation {
  return {
    requestId: req.requestId,
    projectId: req.projectId,
    regionId: req.regionId,
    state: 'draft',
    operationId: null,
    worldId: null,
    providerStatus: null,
    attempts: 0,
    dedupeKey: marbleDedupeKey(req),
    approvedBy: null,
    approvedAtIso: null,
    submittedAtIso: null,
    completedAtIso: null,
    failure: null,
  };
}

/**
 * Whether this operation may be SENT to the provider right now.
 *
 * The single most important predicate in the module. It refuses anything that
 * already carries an operation id, because that generation has demonstrably
 * started and the correct action is to poll it. "Retry" on a submitted
 * operation is how a crash-and-restart turns into two paid worlds.
 */
export function isSubmittable(op: MarbleGenerationOperation): boolean {
  return op.state === 'approved' && op.operationId === null;
}

/** Record that the provider accepted the request and gave us an id. */
export function markSubmitted(
  op: MarbleGenerationOperation,
  operationId: string,
  atIso: string,
): MarbleGenerationOperation {
  if (!isSubmittable(op)) {
    throw new Error(
      `refusing to mark submitted: operation ${op.requestId} is ${op.state}` +
        (op.operationId ? ` and already has provider operation ${op.operationId}` : ''),
    );
  }
  return {
    ...op,
    state: 'submitted',
    operationId,
    submittedAtIso: atIso,
    attempts: op.attempts + 1,
  };
}

/**
 * Fold a polled provider operation into Relay's record.
 *
 * IDEMPOTENT: applying the same provider payload twice yields the same record,
 * so a resumed poll loop cannot advance anything by re-reading it.
 */
export function applyProviderOperation(
  op: MarbleGenerationOperation,
  provider: WorldLabsOperation,
  atIso: string,
): MarbleGenerationOperation {
  if (provider.operation_id !== op.operationId) {
    throw new Error(
      `operation id mismatch: record holds ${op.operationId ?? 'none'}, ` +
        `payload is ${provider.operation_id}`,
    );
  }
  if (op.state === 'succeeded' || op.state === 'failed' || op.state === 'cancelled') return op;

  const worldId = provider.metadata?.world_id ?? op.worldId ?? null;
  const status = provider.metadata?.progress?.status ?? null;

  if (provider.error) {
    const msg =
      provider.error.message ?? `provider error ${String(provider.error.code ?? 'unknown')}`;
    return {
      ...op,
      state: 'failed',
      worldId,
      providerStatus: status,
      failure: msg,
      completedAtIso: atIso,
    };
  }
  if (provider.done) {
    // `done` with no world is a real provider outcome, and it is a FAILURE,
    // not a success with nothing in it.
    const world = provider.response?.world ?? null;
    if (!world || !world.id) {
      return {
        ...op,
        state: 'failed',
        worldId,
        providerStatus: status,
        failure: 'provider reported done with no world in the response',
        completedAtIso: atIso,
      };
    }
    return {
      ...op,
      state: 'succeeded',
      worldId: world.id,
      providerStatus: status,
      completedAtIso: atIso,
      failure: null,
    };
  }
  const next: MarbleOperationState = op.state === 'submitted' ? 'running' : op.state;
  return { ...op, state: next, worldId, providerStatus: status };
}

/* ------------------------------------------------------------ manifest */

/**
 * Read a world document into Relay's manifest.
 *
 * UNKNOWN IS NOT ZERO. Every absent asset becomes null and an absent splat
 * resolution is simply not a key — never an empty string, never a default URL.
 * Downstream has to handle "there is no collider" as a real case, because the
 * provider genuinely does not always return one.
 */
export function readMarbleManifest(world: WorldLabsWorld): MarbleAssetManifest {
  const a = world.assets ?? null;
  const splats: Partial<Record<MarbleSplatResolution, string>> = {};
  const spz = a?.splats?.spz_urls ?? null;
  if (spz) {
    for (const res of MARBLE_SPLAT_RESOLUTIONS) {
      const u = spz[res];
      if (typeof u === 'string' && u !== '') splats[res] = u;
    }
  }
  const sem = a?.splats?.semantics_metadata ?? null;
  return {
    worldId: world.id,
    caption: a?.caption ?? null,
    thumbnailUrl: a?.thumbnail_url ?? null,
    panoUrl: a?.imagery?.pano_url ?? null,
    colliderMeshUrl: a?.mesh?.collider_mesh_url ?? null,
    splatUrls: splats,
    metricScaleFactor: typeof sem?.metric_scale_factor === 'number' ? sem.metric_scale_factor : null,
    groundPlaneOffset: typeof sem?.ground_plane_offset === 'number' ? sem.ground_plane_offset : null,
  };
}

/**
 * Is this manifest usable for the Wonderland pipeline?
 *
 * A world with no splat at any resolution has nothing to show, and one with no
 * collider can be shown but not walked on. Both are reported rather than
 * assumed, because "generation succeeded" and "we can use it" are different
 * claims, and only the second one lets a region go live.
 */
export function manifestReadiness(m: MarbleAssetManifest): {
  readonly renderable: boolean;
  readonly walkable: boolean;
  readonly missing: readonly string[];
} {
  const missing: string[] = [];
  const renderable = Object.keys(m.splatUrls).length > 0;
  const walkable = typeof m.colliderMeshUrl === 'string' && m.colliderMeshUrl !== '';
  if (!renderable) missing.push('splats');
  if (!walkable) missing.push('collider_mesh');
  if (!m.panoUrl) missing.push('pano');
  if (!m.thumbnailUrl) missing.push('thumbnail');
  return { renderable, walkable, missing };
}
