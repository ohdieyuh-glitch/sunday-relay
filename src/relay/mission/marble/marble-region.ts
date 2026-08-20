import type {
  MarbleAssetManifest,
  MarbleImportResult,
  MarbleWorldRegion,
} from './marble-contracts';
import { manifestReadiness } from './marble-operations';

/**
 * BINDING A GENERATED WORLD TO AN AUTHORED REGION.
 *
 * The authored Wonderland layout stays authoritative. Marble supplies
 * environmental richness AROUND structure Relay already owns, and this module
 * is the place that refuses a binding which would move any of it.
 *
 * The separation that matters in Unreal, stated once here so both sides agree:
 *
 *   APPEARANCE   the Marble splat. Drawn, never collided with.
 *   COLLISION    the exported collider GLB. Collided with, never drawn.
 *   INTERACTION  native Unreal actors — the Dogs, the gate, anything with
 *                behaviour. Neither generated nor replaceable by generation.
 *
 * Collapsing appearance and collision is the tempting shortcut and it is wrong
 * in both directions: a splat is the wrong thing to walk on, and a collider is
 * the wrong thing to look at.
 */

/* ------------------------------------------------------- renderer seam */

/**
 * A candidate way of drawing Gaussian splats inside UE 5.8.
 *
 * NOTHING IS SELECTED. Several plugins exist; none has been evaluated against
 * this project's actual constraints, and picking one because it turned up in a
 * search is how a renderer becomes load-bearing before anyone checked it
 * packages on Linux. The seam exists so alternatives can be swapped; the
 * evaluation fields below are the questions that decide it, and every one of
 * them starts as `null` meaning UNKNOWN — not false, not "probably fine".
 */
export interface SplatRendererCandidate {
  readonly rendererId: string;
  readonly ue58Compatible: boolean | null;
  readonly linuxPackaging: boolean | null;
  readonly pixelStreamingVerified: boolean | null;
  readonly multipleWorlds: boolean | null;
  readonly lumenInteraction: boolean | null;
  readonly fogInteraction: boolean | null;
  readonly niagaraCompositing: boolean | null;
  readonly opaqueOccluderSupport: boolean | null;
  readonly collisionFromSplat: boolean | null;
  readonly measuredFps: number | null;
  readonly measuredVramMb: number | null;
  readonly licence: string | null;
  readonly evaluatedAtIso: string | null;
  readonly note: string | null;
}

/** A candidate nobody has tested yet. Every capability is unknown. */
export function unevaluatedRenderer(rendererId: string, note?: string): SplatRendererCandidate {
  return {
    rendererId,
    ue58Compatible: null,
    linuxPackaging: null,
    pixelStreamingVerified: null,
    multipleWorlds: null,
    lumenInteraction: null,
    fogInteraction: null,
    niagaraCompositing: null,
    opaqueOccluderSupport: null,
    collisionFromSplat: null,
    measuredFps: null,
    measuredVramMb: null,
    licence: null,
    evaluatedAtIso: null,
    note: note ?? null,
  };
}

/**
 * The questions a renderer must answer YES to before Wonderland depends on it.
 *
 * `opaqueOccluderSupport` is on the list because of a specific requirement: the
 * Relay Dog has to render IN FRONT of the environment and be occluded by it
 * correctly. A splat renderer that cannot depth-sort against ordinary meshes
 * makes the hero subject float, and no amount of environmental beauty survives
 * that.
 */
export const RENDERER_BLOCKING_CRITERIA = [
  'ue58Compatible',
  'linuxPackaging',
  'pixelStreamingVerified',
  'opaqueOccluderSupport',
] as const;

export function rendererIsUsable(c: SplatRendererCandidate): {
  readonly usable: boolean;
  readonly unknown: readonly string[];
  readonly failed: readonly string[];
} {
  const unknown: string[] = [];
  const failed: string[] = [];
  for (const k of RENDERER_BLOCKING_CRITERIA) {
    const v = c[k];
    if (v === null) unknown.push(k);
    else if (v === false) failed.push(k);
  }
  return { usable: unknown.length === 0 && failed.length === 0, unknown, failed };
}

/* ---------------------------------------------------------- the binding */

export interface RegionBindingDecision {
  readonly bound: boolean;
  readonly reasons: readonly string[];
  /** What the region can do with this world, once bound. */
  readonly capability: 'none' | 'backdrop_only' | 'walkable';
}

/**
 * Decide whether a generated world may be bound to an authored region.
 *
 * `backdrop_only` is a real, useful outcome and not a failure: a world with no
 * collider can still stand behind the authored plaza and carry the horizon,
 * as long as nothing tries to walk on it. Saying so explicitly is what keeps a
 * missing collider from becoming a player falling through the floor.
 */
export function decideRegionBinding(input: {
  readonly region: MarbleWorldRegion;
  readonly manifest: MarbleAssetManifest;
  readonly renderer: SplatRendererCandidate | null;
  /** Anchors the import would displace, if any. Empty means it displaces none. */
  readonly displacedAnchors?: readonly string[];
}): RegionBindingDecision {
  const reasons: string[] = [];
  const readiness = manifestReadiness(input.manifest);

  const displaced = input.displacedAnchors ?? [];
  const protectedHits = displaced.filter((a) => input.region.authoritativeAnchors.includes(a));
  if (protectedHits.length > 0) {
    reasons.push(
      `would displace authored anchors: ${protectedHits.join(', ')} — the layout is authoritative`,
    );
  }
  if (!readiness.renderable) reasons.push('no splat asset at any resolution');

  if (!input.renderer) {
    reasons.push('no splat renderer selected');
  } else {
    const r = rendererIsUsable(input.renderer);
    if (r.unknown.length) reasons.push(`renderer ${input.renderer.rendererId} unverified: ${r.unknown.join(', ')}`);
    if (r.failed.length) reasons.push(`renderer ${input.renderer.rendererId} fails: ${r.failed.join(', ')}`);
  }

  if (reasons.length > 0) return { bound: false, reasons, capability: 'none' };
  return {
    bound: true,
    reasons: [],
    capability: readiness.walkable ? 'walkable' : 'backdrop_only',
  };
}

/**
 * A staged import that has not happened.
 *
 * Announce facts, not intentions: this is what Relay records BEFORE anything
 * reaches Unreal, and every "imported" flag is false until something confirms
 * otherwise. There is deliberately no constructor that produces a `true`.
 */
export function stagedImport(requestId: string, regionId: string): MarbleImportResult {
  return {
    requestId,
    regionId,
    splatImported: false,
    colliderImported: false,
    rendererId: null,
    importedAtIso: null,
    note: 'staged; nothing has been imported into Unreal',
  };
}
