import type { Provenance } from '../../protocol/enums';

/**
 * WONDER WEB — the vocabulary of a creation.
 *
 * Wonder Web is the in-world surface that OPENS AND RUNS what an AI execution
 * system produced, without the user leaving Wonderland. This file is the
 * provider-independent vocabulary it opens things with. It is PURE: no Node, no
 * clock, no network, so the browser, the CLI and the bridge all reach the same
 * conclusions about the same record.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE. A creation says READY only when a build
 * actually succeeded. Every other honesty rule in this repository is a special
 * case of the same idea — announce facts, not intentions — and Wonder Web is
 * where it becomes visible to a user, because READY is a button they will press.
 * The state machine in `wonder-web-lifecycle.ts` is what makes it structural
 * rather than a convention; the fields here are shaped so that lying requires
 * inventing a value rather than omitting one.
 *
 * PROVIDER INDEPENDENCE. Nothing here names Julius, Claude, or any coding
 * provider. A creation carries `provenance` (did this really happen) and a
 * `producer` descriptor (who says so), and Wonder Web renders both. Binding the
 * pipeline to one provider is how the surface would have to be rewritten for
 * the second one.
 */

/* ------------------------------------------------------------- versioning */

/**
 * The stored shape's version. A record whose version this build does not know
 * is reported as unsupported and kept — never coerced into "no creation", which
 * would present a user's work as absent because a field moved.
 */
export const WONDER_WEB_SCHEMA_V1 = 'relay-wonder-web.v1' as const;
export const WONDER_WEB_SCHEMA_VERSION = WONDER_WEB_SCHEMA_V1;
export const SUPPORTED_WONDER_WEB_SCHEMA_VERSIONS = [WONDER_WEB_SCHEMA_V1] as const;
export type WonderWebSchemaVersion = (typeof SUPPORTED_WONDER_WEB_SCHEMA_VERSIONS)[number];

/* ------------------------------------------------------------ vocabularies */

/**
 * WHAT KIND of thing was created.
 *
 * `unknown` is a real member and it is FIRST. A creation whose type Relay has
 * not established is not a website by default — it is a creation whose type is
 * unknown, and Wonder Web says so rather than guessing a viewer for it. The
 * ordinal matters beyond TypeScript: these vocabularies mirror to Unreal enums,
 * a default-constructed USTRUCT zero-fills, and whatever sits at ordinal 0 is
 * what a renderer shows before Relay has said anything.
 */
export const WONDER_WEB_CREATION_TYPES = [
  'unknown',
  'website',
  'web_app',
  'visualization',
  'game_prototype',
  'local_tool',
  'software_application',
  'other',
] as const;
export type WonderWebCreationType = (typeof WONDER_WEB_CREATION_TYPES)[number];

/**
 * HOW a creation is actually executed — which is not the same question as what
 * it is. A game prototype and a visualization can both be a static bundle; a
 * local tool cannot be. The runtime type, not the creation type, decides what
 * isolation is available, so the two are kept apart deliberately.
 */
export const WONDER_WEB_RUNTIME_TYPES = [
  'unknown',
  /** Files served read-only and rendered in a sandboxed frame. */
  'static_bundle',
  /** A process that listens on a port. Not isolated by the frame boundary. */
  'node_service',
  /** An executable on the host. Nothing about this is isolated. */
  'native_process',
] as const;
export type WonderWebRuntimeType = (typeof WONDER_WEB_RUNTIME_TYPES)[number];

/**
 * THE LIFECYCLE.
 *
 * `CREATED`   the record exists; nothing has been prepared.
 * `PREPARING` sources are being materialized into a build root.
 * `BUILDING`  a build command is running.
 * `READY`     a build SUCCEEDED and an entrypoint exists. Nothing else reaches here.
 * `RUNNING`   a ready creation is being served/executed now.
 * `FAILED`    preparation, build or run failed. Carries the reason.
 * `STOPPED`   a run was ended deliberately. The build survives; READY is regained.
 */
export const WONDER_WEB_CREATION_STATUSES = [
  'CREATED',
  'PREPARING',
  'BUILDING',
  'READY',
  'RUNNING',
  'FAILED',
  'STOPPED',
] as const;
export type WonderWebCreationStatus = (typeof WONDER_WEB_CREATION_STATUSES)[number];

/** The statuses from which no further work proceeds without an explicit command. */
export const WONDER_WEB_RESTING_STATUSES: readonly WonderWebCreationStatus[] = [
  'READY',
  'FAILED',
  'STOPPED',
] as const;

/* ------------------------------------------------------------ capabilities */

/**
 * WHAT GENERATED SOFTWARE MIGHT REACH — the complete list, so that "everything
 * else" is never the answer to a security question.
 *
 * Every one of these is DENIED unless a grant names it. That is the fail-closed
 * default required of the sandbox, and `wonder-web-sandbox.ts` is where it is
 * enforced rather than described.
 */
export const WONDER_WEB_CAPABILITIES = [
  'host_filesystem',
  'credentials',
  'project_brain',
  'other_user_projects',
  'other_user_creations',
  'network_egress',
  'wonderland_runtime',
] as const;
export type WonderWebCapability = (typeof WONDER_WEB_CAPABILITIES)[number];

/* ------------------------------------------------------------------ files */

/**
 * One file belonging to a creation.
 *
 * `path` is always relative and always POSIX-shaped. An absolute path or a `..`
 * segment is refused at validation, because a creation that can name a path
 * outside its own root has already escaped whatever the runtime does later.
 */
export interface WonderWebFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string | null;
  /** Null when Relay has not classified it. Never guessed from the extension alone. */
  readonly mediaType: string | null;
}

/* ------------------------------------------------------------- diagnostics */

/**
 * A line of build or runtime output, already redacted and bounded.
 *
 * `stream` is kept because a creation that fails prints to stderr and a user
 * looking at a failure needs to see which lines were the failure. Raw provider
 * streams never reach this type — the producer redacts first.
 */
export interface WonderWebLogLine {
  readonly sequence: number;
  readonly stream: 'build' | 'runtime';
  readonly text: string;
  readonly redactionsApplied: number;
}

/**
 * A failure, as a value.
 *
 * `phase` says WHEN it happened, because "the build failed" and "it built and
 * then crashed" are different facts about a creation and a user acts on them
 * differently. `detail` is a safe bounded summary, never a raw stream.
 */
export interface WonderWebError {
  readonly phase: 'prepare' | 'build' | 'run';
  readonly summary: string;
  readonly detail: string | null;
  readonly occurredAtIso: string;
}

/* --------------------------------------------------------------- provenance */

/**
 * WHO produced this creation, without naming a provider in the type.
 *
 * `systemId` is a free string precisely so a second execution system needs no
 * change here. `attestationId` points at the existing execution-attestation
 * record when one exists — Wonder Web does not restate what actually ran, it
 * refers to the module that already proves it.
 */
export interface WonderWebProducer {
  readonly systemId: string;
  readonly systemVersion: string | null;
  readonly attestationId: string | null;
}

/* ----------------------------------------------------------- build outcome */

/**
 * THE EVIDENCE THAT A BUILD HAPPENED.
 *
 * This is the object the lifecycle demands before it will write READY. It is a
 * separate type, and not a pair of booleans on the creation, so that "we believe
 * it is ready" cannot be expressed at all: to reach READY a caller must produce
 * a completed build carrying an exit code and the artifacts it wrote.
 *
 * `exitCode: null` is NOT success. It means the build's exit was never observed
 * — a killed process, a lost connection — and an unobserved exit is unknown, so
 * the lifecycle refuses it the same way it refuses a non-zero one.
 */
export interface WonderWebBuildOutcome {
  readonly startedAtIso: string;
  readonly finishedAtIso: string;
  readonly exitCode: number | null;
  readonly artifacts: readonly WonderWebFile[];
  readonly entrypoint: string | null;
  readonly logs: readonly WonderWebLogLine[];
}

/* -------------------------------------------------------------- the record */

/**
 * A CREATION — the whole durable record.
 *
 * `ownerUserId` is the Wonderland account, never a device path, a Windows user
 * or a session id. It is the field every authorization decision in
 * `wonder-web-sandbox.ts` reads, and it is required: a creation with no owner
 * is refused at validation rather than defaulting to whoever asked.
 *
 * `projectId` is nullable because a creation can be produced by a mission before
 * the user decides it belongs to a project — that promotion is a deliberate act,
 * not an automatic one. `missionId` is nullable for the same reason in reverse:
 * an imported creation had no mission.
 *
 * `version` increments on every accepted transition. It is what a client uses to
 * tell a stale view from a current one, and what makes a replicated view of
 * somebody else's creation orderable without granting any authority over it.
 */
export interface WonderWebCreation {
  readonly schemaVersion: WonderWebSchemaVersion;
  readonly creationId: string;
  readonly missionId: string | null;
  readonly projectId: string | null;
  readonly ownerUserId: string;
  readonly name: string;
  readonly creationType: WonderWebCreationType;
  readonly runtimeType: WonderWebRuntimeType;
  readonly sourceFiles: readonly WonderWebFile[];
  readonly buildArtifacts: readonly WonderWebFile[];
  /** The file Wonder Web opens. Null until a build produced one. */
  readonly entrypoint: string | null;
  readonly status: WonderWebCreationStatus;
  readonly logs: readonly WonderWebLogLine[];
  readonly errors: readonly WonderWebError[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly provenance: Provenance;
  readonly producer: WonderWebProducer;
  readonly version: number;
  /** Sha-256 over every other field. Proves the stored bytes were not edited. */
  readonly checksum: string;
}

/**
 * A creation in hand but not yet sealed.
 *
 * Every lifecycle function takes and returns a draft, and only the store seals.
 * That keeps the checksum honest by construction: there is no path that mutates
 * a field and leaves a checksum that still verifies, because the type carrying
 * the checksum is never the type anything mutates.
 */
export type WonderWebCreationDraft = Omit<WonderWebCreation, 'checksum'>;

/** True when this creation may be opened. Derived, never stored, never guessed. */
export function isOpenableInWonderWeb(creation: WonderWebCreationDraft): boolean {
  return (
    (creation.status === 'READY' || creation.status === 'RUNNING') &&
    creation.entrypoint !== null
  );
}
