import type {
  MarbleGenerationRequest,
  WorldLabsOperation,
  WorldLabsWorld,
} from './marble-contracts';

/**
 * THE PROVIDER SEAM.
 *
 * The domain declares the shape it needs and a connector implements it. That
 * inversion is the repository's rule — adapters may not import `/mission` —
 * and it is also what makes the mock below a first-class citizen rather than a
 * test double bolted on afterwards.
 *
 * A provider does exactly three things and decides nothing. Whether a request
 * is ALLOWED is settled before anything here is called; see marble-gate.ts.
 */
export interface MarbleProvider {
  /** Stable id recorded in provenance, e.g. `worldlabs-http` or `mock`. */
  readonly providerId: string;
  /** True when calls to this provider can cost money. */
  readonly billable: boolean;

  /** POST /marble/v1/worlds:generate — returns the operation id it assigned. */
  submit(req: MarbleGenerationRequest): Promise<{ readonly operationId: string }>;

  /** GET /marble/v1/operations/{operation_id}. */
  poll(operationId: string): Promise<WorldLabsOperation>;

  /** GET /marble/v1/worlds/{world_id}. */
  fetchWorld(worldId: string): Promise<WorldLabsWorld>;
}

/**
 * Translate a Relay request into the World Labs generate body.
 *
 * Kept here, next to the interface, so both the real client and the mock speak
 * the same wire shape and a field-name mistake shows up in the mock's tests
 * rather than in a paid call. Field names are transcribed from the official
 * docs; see the header of marble-contracts.ts.
 */
export function toWorldLabsGenerateBody(req: MarbleGenerationRequest): Record<string, unknown> {
  const world_prompt: Record<string, unknown> = { type: req.promptType };
  if (req.promptType === 'text') {
    world_prompt.text_prompt = req.textPrompt ?? '';
  } else if (req.promptType === 'image') {
    const ref = req.imageRefs?.[0];
    world_prompt.image_prompt = ref
      ? ref.source === 'uri'
        ? { source: 'uri', uri: ref.value }
        : { source: 'media_asset', media_asset_id: ref.value }
      : {};
  } else if (req.promptType === 'multi-image') {
    world_prompt.multi_image_prompt = (req.imageRefs ?? []).map((ref) =>
      ref.source === 'uri'
        ? { source: 'uri', uri: ref.value }
        : { source: 'media_asset', media_asset_id: ref.value },
    );
  } else {
    const ref = req.imageRefs?.[0];
    world_prompt.video_prompt = ref
      ? ref.source === 'uri'
        ? { source: 'uri', uri: ref.value }
        : { source: 'media_asset', media_asset_id: ref.value }
      : {};
  }
  return { display_name: req.displayName, model: req.model, world_prompt };
}

/* ------------------------------------------------------------ the mock */

export interface MockMarbleOptions {
  /** Polls before the operation reports done. Default 2. */
  readonly pollsBeforeDone?: number;
  /** Force a provider-side failure. */
  readonly failWith?: string;
  /** Report done with no world — a real outcome the pipeline must survive. */
  readonly doneWithNoWorld?: boolean;
  /** Omit the collider so the "renderable but not walkable" path is exercised. */
  readonly omitCollider?: boolean;
  /** Omit every splat so the unusable-world path is exercised. */
  readonly omitSplats?: boolean;
}

/**
 * A provider that generates nothing and costs nothing.
 *
 * This is the DEFAULT, not a fallback. The whole pipeline — request, approval,
 * submission, polling, manifest, readiness, import staging — can be exercised
 * end to end against it, so the only thing a live provider adds is the network
 * and the bill. `billable` is false and is checked by the gate's tests.
 *
 * It is deterministic: ids derive from the request, so a resumed run sees the
 * same operation rather than a fresh one, which is exactly the property the
 * idempotence rules need in order to be testable at all.
 */
export class MockMarbleProvider implements MarbleProvider {
  readonly providerId = 'mock';
  readonly billable = false;

  private readonly opts: MockMarbleOptions;
  private readonly polls = new Map<string, number>();
  private readonly requests = new Map<string, MarbleGenerationRequest>();

  constructor(opts: MockMarbleOptions = {}) {
    this.opts = opts;
  }

  async submit(req: MarbleGenerationRequest): Promise<{ operationId: string }> {
    const operationId = `mock-op-${req.requestId}`;
    this.requests.set(operationId, req);
    if (!this.polls.has(operationId)) this.polls.set(operationId, 0);
    return { operationId };
  }

  async poll(operationId: string): Promise<WorldLabsOperation> {
    const n = (this.polls.get(operationId) ?? 0) + 1;
    this.polls.set(operationId, n);
    const worldId = `mock-world-${operationId}`;

    if (this.opts.failWith) {
      return {
        operation_id: operationId,
        done: true,
        error: { code: 'MOCK_FAILURE', message: this.opts.failWith },
        metadata: { world_id: worldId, progress: { status: 'IN_PROGRESS' } },
      };
    }
    const threshold = this.opts.pollsBeforeDone ?? 2;
    if (n < threshold) {
      return {
        operation_id: operationId,
        done: false,
        error: null,
        metadata: { world_id: worldId, progress: { status: 'IN_PROGRESS' } },
      };
    }
    if (this.opts.doneWithNoWorld) {
      return {
        operation_id: operationId,
        done: true,
        error: null,
        metadata: { world_id: worldId, progress: { status: 'SUCCEEDED' } },
        response: { world: null },
      };
    }
    return {
      operation_id: operationId,
      done: true,
      error: null,
      metadata: { world_id: worldId, progress: { status: 'SUCCEEDED' } },
      response: { world: await this.fetchWorld(worldId) },
    };
  }

  async fetchWorld(worldId: string): Promise<WorldLabsWorld> {
    const splats = this.opts.omitSplats
      ? null
      : {
          spz_urls: {
            '100k': `https://mock.invalid/${worldId}/100k.spz`,
            '500k': `https://mock.invalid/${worldId}/500k.spz`,
            full_res: `https://mock.invalid/${worldId}/full.spz`,
          },
          semantics_metadata: { metric_scale_factor: 1, ground_plane_offset: 0 },
        };
    return {
      id: worldId,
      display_name: 'mock world',
      model: 'marble-1.1',
      assets: {
        caption: 'a mock world; nothing was generated',
        thumbnail_url: `https://mock.invalid/${worldId}/thumb.jpg`,
        splats,
        mesh: this.opts.omitCollider ? null : { collider_mesh_url: `https://mock.invalid/${worldId}/collider.glb` },
        imagery: { pano_url: `https://mock.invalid/${worldId}/pano.jpg` },
      },
    };
  }
}
