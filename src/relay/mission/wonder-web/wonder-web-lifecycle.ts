import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import type { Provenance } from '../../protocol/enums';
import {
  WONDER_WEB_CREATION_STATUSES,
  WONDER_WEB_SCHEMA_VERSION,
  type WonderWebBuildOutcome,
  type WonderWebCreationDraft,
  type WonderWebCreationStatus,
  type WonderWebCreationType,
  type WonderWebError,
  type WonderWebFile,
  type WonderWebLogLine,
  type WonderWebProducer,
  type WonderWebRuntimeType,
} from './wonder-web-contracts';

/**
 * WONDER WEB — the lifecycle, as a machine rather than a convention.
 *
 * Every function here is pure and total: it takes a creation and a fact, and
 * returns either the next creation or a structured refusal. Time is an injected
 * ISO string, never read. Nothing throws, so a UI, the CLI and the bridge can
 * all evaluate the same transition and get the same answer.
 *
 * WHY A TABLE AND NOT A SWITCH. The legal edges are DATA (`WONDER_WEB_EDGES`),
 * and the test walks the full 7x7 product asserting that every pair not in the
 * table is refused. A switch statement can only be tested for the cases somebody
 * remembered to write; a table can be tested for the cases nobody thought of,
 * which is where an illegal transition would actually come from.
 *
 * THE LOAD-BEARING RULE. `READY` has exactly one inbound edge, from `BUILDING`,
 * and `completeBuild` is the only function that can traverse it. It refuses a
 * non-zero exit code, refuses an UNOBSERVED exit code, and refuses a build that
 * produced no entrypoint. There is no other door into READY — not a setter, not
 * a "force" flag, not a repair path — because a creation that reports READY is a
 * creation a user is about to run.
 */

/** Logs are bounded. An unbounded log is a memory leak and an unreadable panel. */
export const WONDER_WEB_MAX_LOG_LINES = 500;

/** Errors are bounded too — the most recent failures are the actionable ones. */
export const WONDER_WEB_MAX_ERRORS = 50;

/**
 * THE LEGAL EDGES. Anything not listed is refused with `illegal-transition`.
 *
 * `FAILED` and `STOPPED` both lead back to `PREPARING` because rebuilding after
 * a failure is the normal repair loop, and a creation that failed once must not
 * become permanently unopenable. `READY -> PREPARING` is the rebuild of a
 * working creation, which is a thing a user does after editing sources.
 */
export const WONDER_WEB_EDGES: Readonly<Record<WonderWebCreationStatus, readonly WonderWebCreationStatus[]>> =
  Object.freeze({
    CREATED: ['PREPARING', 'FAILED'],
    PREPARING: ['BUILDING', 'FAILED'],
    BUILDING: ['READY', 'FAILED'],
    READY: ['RUNNING', 'PREPARING', 'FAILED'],
    RUNNING: ['STOPPED', 'FAILED'],
    STOPPED: ['RUNNING', 'PREPARING', 'FAILED'],
    FAILED: ['PREPARING'],
  });

/** True when `to` is reachable from `from` in one step. Data, not opinion. */
export function isLegalWonderWebTransition(
  from: WonderWebCreationStatus,
  to: WonderWebCreationStatus,
): boolean {
  return WONDER_WEB_EDGES[from].includes(to);
}

/* ------------------------------------------------------------- validation */

/**
 * A path a creation may legally name.
 *
 * Refused: absolute paths (POSIX or Windows), drive letters, UNC prefixes, any
 * `..` segment, and backslashes. A creation that can name a path outside its own
 * root has escaped before any runtime boundary gets a chance to matter, so this
 * is checked at the domain edge rather than trusted to the filesystem layer.
 */
export function isSafeCreationPath(path: string): boolean {
  if (path === '' || path.trim() !== path) return false;
  if (path.includes('\\')) return false;
  if (path.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(path)) return false;
  if (path.includes('\0')) return false;
  return !path.split('/').some((segment) => segment === '..' || segment === '');
}

function validateFiles(files: readonly WonderWebFile[], label: string): RelayResult<null> {
  for (const file of files) {
    if (!isSafeCreationPath(file.path)) {
      return fail(
        relayError('validation-failed', `A ${label} path escapes the creation root.`, {
          details: [file.path],
        }),
      );
    }
    if (!Number.isFinite(file.sizeBytes) || file.sizeBytes < 0) {
      return fail(
        relayError('validation-failed', `A ${label} declares an impossible size.`, {
          details: [file.path],
        }),
      );
    }
  }
  return ok(null);
}

/* ------------------------------------------------------------- log folding */

/**
 * Append lines, keeping the MOST RECENT within the bound.
 *
 * Dropping the oldest rather than refusing the newest is deliberate: the tail of
 * a build log is where the error is. The sequence numbers are preserved as
 * given, so a reader can always tell that lines were dropped.
 */
function foldLogs(
  existing: readonly WonderWebLogLine[],
  incoming: readonly WonderWebLogLine[],
): readonly WonderWebLogLine[] {
  const all = [...existing, ...incoming];
  return all.length <= WONDER_WEB_MAX_LOG_LINES
    ? all
    : all.slice(all.length - WONDER_WEB_MAX_LOG_LINES);
}

function foldErrors(
  existing: readonly WonderWebError[],
  incoming: WonderWebError,
): readonly WonderWebError[] {
  const all = [...existing, incoming];
  return all.length <= WONDER_WEB_MAX_ERRORS
    ? all
    : all.slice(all.length - WONDER_WEB_MAX_ERRORS);
}

/** Every accepted transition passes through here, so `version` cannot drift. */
function advance(
  creation: WonderWebCreationDraft,
  to: WonderWebCreationStatus,
  atIso: string,
  patch: Partial<WonderWebCreationDraft> = {},
): RelayResult<WonderWebCreationDraft> {
  if (!isLegalWonderWebTransition(creation.status, to)) {
    return fail(
      relayError('illegal-transition', `A creation cannot go from ${creation.status} to ${to}.`, {
        entityIds: { creationId: creation.creationId },
      }),
    );
  }
  return ok({
    ...creation,
    ...patch,
    status: to,
    updatedAt: atIso,
    version: creation.version + 1,
  });
}

/* ------------------------------------------------------------- the machine */

export interface CreateWonderWebCreationInput {
  readonly creationId: string;
  readonly ownerUserId: string;
  readonly name: string;
  readonly missionId?: string | null;
  readonly projectId?: string | null;
  readonly creationType: WonderWebCreationType;
  readonly runtimeType: WonderWebRuntimeType;
  readonly sourceFiles: readonly WonderWebFile[];
  readonly provenance: Provenance;
  readonly producer: WonderWebProducer;
  readonly createdAtIso: string;
}

/**
 * Open a creation record. It starts CREATED with no entrypoint and no artifacts,
 * because at this instant nothing has been built and the record must not imply
 * otherwise.
 */
export function createWonderWebCreation(
  input: CreateWonderWebCreationInput,
): RelayResult<WonderWebCreationDraft> {
  if (input.creationId.trim() === '') {
    return fail(relayError('validation-failed', 'A creation needs an id.'));
  }
  // An unowned creation is refused rather than defaulted to the caller: every
  // authorization decision downstream reads this one field.
  if (input.ownerUserId.trim() === '') {
    return fail(relayError('validation-failed', 'A creation must name the Wonderland account that owns it.'));
  }
  if (input.name.trim() === '') {
    return fail(relayError('validation-failed', 'A creation needs a name a user can recognize.'));
  }
  const files = validateFiles(input.sourceFiles, 'source file');
  if (!files.ok) return files;

  return ok({
    schemaVersion: WONDER_WEB_SCHEMA_VERSION,
    creationId: input.creationId,
    missionId: input.missionId ?? null,
    projectId: input.projectId ?? null,
    ownerUserId: input.ownerUserId,
    name: input.name,
    creationType: input.creationType,
    runtimeType: input.runtimeType,
    sourceFiles: input.sourceFiles,
    buildArtifacts: [],
    entrypoint: null,
    status: 'CREATED',
    logs: [],
    errors: [],
    createdAt: input.createdAtIso,
    updatedAt: input.createdAtIso,
    provenance: input.provenance,
    producer: input.producer,
    version: 1,
  });
}

/** Sources are being materialized. Also the first step of every rebuild. */
export function beginWonderWebPreparation(
  creation: WonderWebCreationDraft,
  atIso: string,
): RelayResult<WonderWebCreationDraft> {
  return advance(creation, 'PREPARING', atIso);
}

/** A build command is now running. */
export function beginWonderWebBuild(
  creation: WonderWebCreationDraft,
  atIso: string,
): RelayResult<WonderWebCreationDraft> {
  return advance(creation, 'BUILDING', atIso);
}

/**
 * THE ONLY DOOR INTO READY.
 *
 * A successful build is an exit code of exactly 0 that was actually OBSERVED,
 * plus an entrypoint. Anything else lands in FAILED carrying the reason, and the
 * logs are kept either way — a failed build's log is the only thing the user has
 * to work with.
 */
export function completeWonderWebBuild(
  creation: WonderWebCreationDraft,
  outcome: WonderWebBuildOutcome,
  atIso: string,
): RelayResult<WonderWebCreationDraft> {
  if (creation.status !== 'BUILDING') {
    return fail(
      relayError('illegal-transition', `Only a BUILDING creation can complete a build; this one is ${creation.status}.`, {
        entityIds: { creationId: creation.creationId },
      }),
    );
  }
  const artifacts = validateFiles(outcome.artifacts, 'build artifact');
  if (!artifacts.ok) return artifacts;

  const logs = foldLogs(creation.logs, outcome.logs);

  // An unobserved exit is UNKNOWN, and unknown is not success. A killed or
  // disconnected build is reported as what it is rather than assumed to be fine.
  if (outcome.exitCode === null) {
    return advance(creation, 'FAILED', atIso, {
      logs,
      buildArtifacts: outcome.artifacts,
      errors: foldErrors(creation.errors, {
        phase: 'build',
        summary: 'The build exit was never observed, so the build cannot be called successful.',
        detail: null,
        occurredAtIso: atIso,
      }),
    });
  }
  if (outcome.exitCode !== 0) {
    return advance(creation, 'FAILED', atIso, {
      logs,
      buildArtifacts: outcome.artifacts,
      errors: foldErrors(creation.errors, {
        phase: 'build',
        summary: `The build exited ${outcome.exitCode}.`,
        detail: null,
        occurredAtIso: atIso,
      }),
    });
  }
  // A build can exit 0 and still have produced nothing openable. READY would be
  // a lie about a creation whose entrypoint does not exist, so it is refused.
  if (outcome.entrypoint === null) {
    return advance(creation, 'FAILED', atIso, {
      logs,
      buildArtifacts: outcome.artifacts,
      errors: foldErrors(creation.errors, {
        phase: 'build',
        summary: 'The build succeeded but produced no entrypoint, so there is nothing to open.',
        detail: null,
        occurredAtIso: atIso,
      }),
    });
  }
  if (!isSafeCreationPath(outcome.entrypoint)) {
    return fail(
      relayError('validation-failed', 'The build entrypoint escapes the creation root.', {
        details: [outcome.entrypoint],
      }),
    );
  }
  // The entrypoint must be one of the files the build actually wrote. An
  // entrypoint naming a file nobody produced is the same lie one step later.
  if (!outcome.artifacts.some((file) => file.path === outcome.entrypoint)) {
    return fail(
      relayError('evidence-required', 'The build entrypoint names a file the build did not produce.', {
        details: [outcome.entrypoint],
      }),
    );
  }

  return advance(creation, 'READY', atIso, {
    logs,
    buildArtifacts: outcome.artifacts,
    entrypoint: outcome.entrypoint,
  });
}

/** A ready or stopped creation is now being served/executed. */
export function startWonderWebRun(
  creation: WonderWebCreationDraft,
  atIso: string,
): RelayResult<WonderWebCreationDraft> {
  if (creation.entrypoint === null) {
    return fail(
      relayError('evidence-required', 'A creation with no entrypoint cannot be run.', {
        entityIds: { creationId: creation.creationId },
      }),
    );
  }
  return advance(creation, 'RUNNING', atIso);
}

/** A deliberate stop. The build survives, so the creation is openable again. */
export function stopWonderWebRun(
  creation: WonderWebCreationDraft,
  atIso: string,
): RelayResult<WonderWebCreationDraft> {
  return advance(creation, 'STOPPED', atIso);
}

/** A failure at any phase, recorded as a value with the phase it happened in. */
export function failWonderWebCreation(
  creation: WonderWebCreationDraft,
  error: WonderWebError,
  atIso: string,
): RelayResult<WonderWebCreationDraft> {
  return advance(creation, 'FAILED', atIso, {
    errors: foldErrors(creation.errors, error),
  });
}

/**
 * Rebuild. The previous artifacts and entrypoint are CLEARED on the way back to
 * PREPARING, because a creation being rebuilt is not currently openable and a
 * stale entrypoint left in place would let Wonder Web open the previous build
 * while reporting the new one.
 */
export function rebuildWonderWebCreation(
  creation: WonderWebCreationDraft,
  atIso: string,
): RelayResult<WonderWebCreationDraft> {
  return advance(creation, 'PREPARING', atIso, {
    buildArtifacts: [],
    entrypoint: null,
  });
}

/** Append runtime log lines without changing state. Bounded, like every log here. */
export function appendWonderWebLogs(
  creation: WonderWebCreationDraft,
  lines: readonly WonderWebLogLine[],
  atIso: string,
): WonderWebCreationDraft {
  return {
    ...creation,
    logs: foldLogs(creation.logs, lines),
    updatedAt: atIso,
    version: creation.version + 1,
  };
}

/** Exported for the exhaustiveness test; the machine itself reads the table. */
export const WONDER_WEB_ALL_STATUSES = WONDER_WEB_CREATION_STATUSES;
