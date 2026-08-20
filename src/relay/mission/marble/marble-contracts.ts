/**
 * MARBLE — World Labs as an OPTIONAL environment generator for Wonderland.
 *
 * Three owners, and the boundary between them is the whole design:
 *
 *   RELAY   is authoritative. Requests, approvals, operation identity,
 *           provenance, verification, durable state. Nothing below decides
 *           anything Relay is supposed to decide.
 *   UNREAL  is the interactive runtime. Gameplay, the Dogs, collision,
 *           cameras, Niagara, Pixel Streaming.
 *   MARBLE  supplies environmental APPEARANCE around authored structure.
 *
 * Marble is never the source of truth for Relay state. A generated world is
 * an ARTIFACT Relay recorded, in the same sense an evidence artifact is: it
 * carries where it came from, what was asked for, what was approved, and what
 * came back — and Relay can be re-derived without it.
 *
 * The authored layout stays authoritative for landmark placement, the hero
 * camera, player spawn, the Relay Dog and anything traversable. Marble adds
 * richness AROUND that structure and may not move it.
 *
 * FIELD NAMES ARE NOT INVENTED. Everything under the `WorldLabs*` types below
 * is transcribed from the official World Labs API documentation
 * (docs.worldlabs.ai/api) as of 2026-08-19 — base https://api.worldlabs.ai,
 * auth header `WLT-Api-Key`, generation POST /marble/v1/worlds:generate,
 * polling GET /marble/v1/operations/{operation_id}, retrieval GET
 * /marble/v1/worlds/{world_id}, export POST /marble/v1/worlds/{id}:export.
 * Where this file names something Relay invented, it says so.
 *
 * PURE. No Node, no network, no clock — time arrives as an injected ISO
 * string, exactly like the rest of the mission domain.
 */

/* ============================================================ world labs */

/** Models the API accepts. Strings are theirs; the list may grow. */
export const MARBLE_MODELS = ['marble-1.1', 'marble-1.1-plus'] as const;
export type MarbleModel = (typeof MARBLE_MODELS)[number];

/** `world_prompt.type` in the generate request. */
export const MARBLE_PROMPT_TYPES = ['text', 'image', 'multi-image', 'video'] as const;
export type MarblePromptType = (typeof MARBLE_PROMPT_TYPES)[number];

/** `metadata.progress.status` on an operation. */
export const MARBLE_PROGRESS_STATUS = ['IN_PROGRESS', 'SUCCEEDED'] as const;
export type MarbleProgressStatus = (typeof MARBLE_PROGRESS_STATUS)[number];

/**
 * Splat resolutions the API returns under `assets.splats.spz_urls`.
 * Keys are theirs, including `full_res`.
 */
export const MARBLE_SPLAT_RESOLUTIONS = ['100k', '500k', 'full_res'] as const;
export type MarbleSplatResolution = (typeof MARBLE_SPLAT_RESOLUTIONS)[number];

/** Export request shapes, POST /marble/v1/worlds/{id}:export. */
export const MARBLE_EXPORT_ASSET_TYPES = ['splats', 'mesh'] as const;
export type MarbleExportAssetType = (typeof MARBLE_EXPORT_ASSET_TYPES)[number];
export const MARBLE_EXPORT_FORMATS = ['ply', 'glb'] as const;
export type MarbleExportFormat = (typeof MARBLE_EXPORT_FORMATS)[number];

/**
 * The world document, as the API returns it under `world`.
 *
 * Every field is optional on purpose. A provider that returns a world with no
 * collider mesh is a real case the pipeline has to survive, and modelling
 * these as required would mean the type system asserts something the network
 * does not guarantee — which is how a malformed response becomes a crash
 * instead of a recorded failure.
 */
export interface WorldLabsWorldAssets {
  readonly caption?: string | null;
  readonly thumbnail_url?: string | null;
  readonly splats?: {
    readonly spz_urls?: Partial<Record<MarbleSplatResolution, string>> | null;
    readonly semantics_metadata?: {
      readonly metric_scale_factor?: number | null;
      readonly ground_plane_offset?: number | null;
    } | null;
  } | null;
  readonly mesh?: { readonly collider_mesh_url?: string | null } | null;
  readonly imagery?: { readonly pano_url?: string | null } | null;
}

export interface WorldLabsWorld {
  readonly id: string;
  readonly display_name?: string | null;
  readonly model?: string | null;
  readonly assets?: WorldLabsWorldAssets | null;
}

/** GET /marble/v1/operations/{operation_id}. */
export interface WorldLabsOperation {
  readonly operation_id: string;
  readonly done: boolean;
  readonly error?: { readonly code?: string | number | null; readonly message?: string | null } | null;
  readonly metadata?: {
    readonly world_id?: string | null;
    readonly progress?: { readonly status?: string | null } | null;
  } | null;
  readonly response?: { readonly world?: WorldLabsWorld | null } | null;
}

/* ================================================================ relay */

/**
 * What Relay asked for. RELAY-OWNED — this is not a World Labs shape.
 *
 * `regionId` binds the generation to one authored Wonderland region, so a
 * result can never be silently applied to the wrong part of the world, and
 * `projectId` keeps generations from leaking across projects.
 */
export interface MarbleGenerationRequest {
  readonly requestId: string;
  readonly projectId: string;
  readonly regionId: string;
  readonly displayName: string;
  readonly model: MarbleModel;
  readonly promptType: MarblePromptType;
  /** Present for `text`; absent otherwise. */
  readonly textPrompt?: string | null;
  /** Reference images, as URIs or previously-uploaded media asset ids. */
  readonly imageRefs?: readonly MarbleImageRef[];
  /** Free-form art-direction notes recorded as provenance, never sent as-is. */
  readonly artDirectionNote?: string | null;
  readonly requestedAtIso: string;
  readonly requestedBy: string;
}

export interface MarbleImageRef {
  readonly source: 'uri' | 'media_asset';
  readonly value: string;
}

/** Lifecycle of one generation, as RELAY tracks it. */
export const MARBLE_OPERATION_STATES = [
  'draft',        // built, not approved, nothing sent
  'awaiting_approval',
  'approved',     // may be sent; still nothing sent
  'submitted',    // the API has an operation id
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;
export type MarbleOperationState = (typeof MARBLE_OPERATION_STATES)[number];

/**
 * A generation Relay is tracking.
 *
 * `operationId` is null until the API has actually accepted the request. That
 * distinction is what makes retry safe: a record with no operation id has
 * provably not started, and one with an operation id must be POLLED rather
 * than resubmitted. Retrying a submitted generation is how you pay twice.
 */
export interface MarbleGenerationOperation {
  readonly requestId: string;
  readonly projectId: string;
  readonly regionId: string;
  readonly state: MarbleOperationState;
  readonly operationId: string | null;
  readonly worldId: string | null;
  /** Verbatim provider status when known; null means Relay has not seen one. */
  readonly providerStatus: string | null;
  readonly attempts: number;
  readonly dedupeKey: string;
  readonly approvedBy: string | null;
  readonly approvedAtIso: string | null;
  readonly submittedAtIso: string | null;
  readonly completedAtIso: string | null;
  readonly failure: string | null;
}

/** Assets Relay resolved from a finished world. Any of them may be absent. */
export interface MarbleAssetManifest {
  readonly worldId: string;
  readonly caption: string | null;
  readonly thumbnailUrl: string | null;
  readonly panoUrl: string | null;
  readonly colliderMeshUrl: string | null;
  readonly splatUrls: Readonly<Partial<Record<MarbleSplatResolution, string>>>;
  readonly metricScaleFactor: number | null;
  readonly groundPlaneOffset: number | null;
}

export interface MarbleWorldResult {
  readonly requestId: string;
  readonly worldId: string;
  readonly manifest: MarbleAssetManifest;
  readonly retrievedAtIso: string;
}

/**
 * An authored Wonderland region a generated world may be bound to.
 *
 * The authored layout stays authoritative. `authoritativeAnchors` names what
 * Marble may not move — landmarks, the hero camera, spawn, the Dog — so a
 * binding that would displace one is refused rather than negotiated.
 */
export interface MarbleWorldRegion {
  readonly regionId: string;
  readonly displayName: string;
  readonly authoritativeAnchors: readonly string[];
  readonly boundsUu: {
    readonly minX: number; readonly minY: number;
    readonly maxX: number; readonly maxY: number;
  };
}

/** What actually reached Unreal. Absent is `null`, never zero or false. */
export interface MarbleImportResult {
  readonly requestId: string;
  readonly regionId: string;
  readonly splatImported: boolean;
  readonly colliderImported: boolean;
  readonly rendererId: string | null;
  readonly importedAtIso: string | null;
  readonly note: string | null;
}

/* =============================================================== events */

/**
 * Durable events. Names are the founder's; payloads are ours.
 *
 * `MarbleGenerationRequested` is emitted when Relay RECORDS the intent, which
 * is not when anything is sent. `MarbleGenerationStarted` is emitted only
 * after the provider has returned an operation id — announce facts, not
 * intentions, and "we asked" is not "it started".
 */
export const MARBLE_EVENT_TYPES = [
  'MarbleGenerationRequested',
  'MarbleGenerationStarted',
  'MarbleWorldReady',
  'MarbleAssetsDownloaded',
  'MarbleSplatImported',
  'MarbleColliderImported',
  'WonderlandRegionBound',
  'WonderlandRegionVerified',
] as const;
export type MarbleEventType = (typeof MARBLE_EVENT_TYPES)[number];

export interface MarbleEvent {
  readonly type: MarbleEventType;
  readonly requestId: string;
  readonly projectId: string;
  readonly regionId: string;
  readonly atIso: string;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

/* ============================================ verification vocabulary */

/**
 * The founder's ladder, as a type, so a caller cannot record a higher rung
 * than it earned. A passing unit test is SPECIFIED..IMPLEMENTED; it is not
 * RENDERED and it is certainly not PROVEN.
 */
export const MARBLE_ASSURANCE = [
  'specified',
  'implemented',
  'compiled',
  'running',
  'rendered',
  'streamed',
  'proven',
] as const;
export type MarbleAssurance = (typeof MARBLE_ASSURANCE)[number];
