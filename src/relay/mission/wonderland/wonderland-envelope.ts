/**
 * THE WONDERLAND ENVELOPE — what crosses the boundary into a world.
 *
 * Everything Unreal is ever told about a Julius mission arrives in this shape.
 * It exists because the two sides have genuinely different obligations: Julius
 * owns orchestration and its event type is rich, internal and free to change;
 * a world renders a figure and must keep rendering it correctly across three
 * provider swaps and a schema migration.
 *
 * WHAT IT IS NOT. It is not a second Julius event system. `julius-events.ts`
 * owns persistence, ordering and delivery, and `integration/terminal/
 * julius-event-port.ts` already declares the shape Relay is willing to READ.
 * This is the shape Relay is willing to SEND ONWARD, which is a smaller and
 * stricter thing: the terminal shows a founder their own mission's text, and a
 * world does not need the text at all.
 *
 * THREE RULES, each enforced rather than described:
 *
 *  1. NO PROVIDER PAYLOAD REACHES A WORLD. `metadata` admits primitives only,
 *     bounded in length, with secret-shaped keys dropped through the boundary
 *     redaction Relay already owns. A prompt, a completion, a stack trace and
 *     an API key are all structurally unable to travel here — not by review,
 *     by the type and the sanitiser.
 *
 *  2. A PROVIDER NAME IS NEVER A ROLE. `workerRole` is the function that acted.
 *     Julius's `SPECIALIST:${name}` collapses to the bare token `SPECIALIST`,
 *     because a specialist's own name is not a permanent label — the same rule
 *     the Live Terminal's actor list already applies, for the same reason.
 *
 *  3. IDENTITY IS EXPLICIT OR NULL. Six identifiers travel and every one is
 *     either known or `null`. Nothing here derives a missionId from a runId or
 *     invents a world session, because a world that guessed which mission it
 *     was drawing would be wrong silently.
 *
 * ORDERING TRAVELS WITH THE FACT. `sequence` and `revision` are both here and
 * they answer different questions — see `wonderland-ordering.ts`.
 */

import { exactKeys } from './wonderland-contracts';
import {
  containsPrivateReasoning,
  containsStackTrace,
  factKeyIsSecretShaped,
  redactBoundaryText,
} from '../../integration/terminal/terminal-redaction';
import { JULIUS_DEFAULT_ROLES } from '../julius/julius-runtime';
import type { JuliusWorkerRole } from '../julius/julius-runtime';
import { containsWonderlandHostPath } from './wonderland-host-paths';
import { JULIUS_STATE_SOURCES, JULIUS_VISUAL_STATES } from './wonderland-julius-state';
import type { JuliusStateSource, JuliusVisualState } from './wonderland-julius-state';

/* ------------------------------------------------------------ versioning */

export const WONDERLAND_ENVELOPE_SCHEMA_V1 = 'relay-wonderland-envelope.v1' as const;
export type WonderlandEnvelopeSchemaVersion = typeof WONDERLAND_ENVELOPE_SCHEMA_V1;

/* ---------------------------------------------------------- worker roles */

/**
 * WHICH FUNCTION ACTED, in the product's own words.
 *
 * DERIVED from `JULIUS_DEFAULT_ROLES` so the three permanent slots cannot drift
 * from the kernel's list, plus one token the kernel does not have:
 *
 * `SPECIALIST` — Julius spawns specialists under its own policy and names them
 * freely, as `SPECIALIST:${string}`. That name is run-time data chosen by the
 * orchestrator, so letting it through would put an arbitrary string on the wire
 * into a renderer and make a specialist's name a de-facto vocabulary. The token
 * says a specialist acted; which one is Julius's business.
 */
export const WONDERLAND_WORKER_ROLES = [
  ...JULIUS_DEFAULT_ROLES,
  'SPECIALIST',
] as const;
export type WonderlandWorkerRole = (typeof WONDERLAND_WORKER_ROLES)[number];

const DEFAULT_ROLE_MEMBERS: ReadonlySet<string> = new Set<string>(JULIUS_DEFAULT_ROLES);

/**
 * Collapse a Julius worker role onto the wire vocabulary, or `null`.
 *
 * `null` for anything unrecognised rather than a guess: a role the world does
 * not model is an absence of information, and inventing `SPECIALIST` for it
 * would report a specialist that never ran.
 */
export function wonderlandWorkerRole(role: string | null | undefined): WonderlandWorkerRole | null {
  if (typeof role !== 'string' || role.length === 0) return null;
  if (DEFAULT_ROLE_MEMBERS.has(role)) return role as WonderlandWorkerRole;
  return role.startsWith('SPECIALIST:') || role === 'SPECIALIST' ? 'SPECIALIST' : null;
}

/** Type-level proof that every default role is a wire role. */
const _rolesCover: readonly WonderlandWorkerRole[] = JULIUS_DEFAULT_ROLES as readonly JuliusWorkerRole[] as readonly WonderlandWorkerRole[];
void _rolesCover;

/* -------------------------------------------------------------- metadata */

/** The only value kinds that may cross. No objects, no arrays, no functions. */
export type WonderlandMetadataValue = string | number | boolean | null;
export type WonderlandMetadata = Readonly<Record<string, WonderlandMetadataValue>>;

/**
 * The longest a metadata string may be.
 *
 * Short on purpose. Metadata is for identifiers, counts and short labels — a
 * task title, an attempt number, a file count. Anything longer is prose, and
 * prose from a provider is the payload this envelope exists to keep out. The
 * limit is a structural refusal rather than a formatting preference.
 */
export const WONDERLAND_METADATA_MAX_LENGTH = 120;

/** How many entries may cross. A map this size is a summary, not a document. */
export const WONDERLAND_METADATA_MAX_ENTRIES = 16;

export interface WonderlandMetadataResult {
  readonly metadata: WonderlandMetadata;
  /** Entries removed, so a surface can say something was dropped. */
  readonly dropped: number;
}

/**
 * THE METADATA KEYS THAT HOLD CODES (row 12, R4; internal review M3).
 *
 * The Julius normalizer carries a kernel event's `reasonCode`, `severity` and
 * `outcome` here (`WONDERLAND_CARRIED_FACT_KEYS`), and the kernel's write-time
 * check only refuses `key=value` text -- so each was a free string of up to 120
 * characters, a host path among them. A code is a machine word: the human gate's
 * shape (wonderland-human-gate.ts), in either case, because the kernel's own
 * codes are both SCREAMING_SNAKE (`EVIDENCE_FAILED`) and lower_snake
 * (`checkpoint_identity_required`). No space, slash, backslash or colon fits, so
 * neither prose nor a path can travel under one of these keys.
 *
 * DROPPED, never replaced: the Unreal client decodes `metadata` as an open map of
 * scalars and requires none of these keys (WonderlandWireDecode.cpp,
 * DecodeEnvelopeObject), so a value that is not a code is removed and counted in
 * `metadataDropped` like every other drop.
 */
export const WONDERLAND_CODE_METADATA_KEYS: ReadonlySet<string> = new Set(['reasonCode', 'severity', 'outcome']);
const METADATA_CODE = /^[A-Za-z0-9][A-Za-z0-9._]{0,63}$/u;

/**
 * THE METADATA KEY THAT HOLDS A WORKER ROLE (row 12; internal verify n4).
 *
 * The Julius normalizer carries a kernel event's `role` fact here
 * (`WONDERLAND_CARRIED_FACT_KEYS`), and for a specialist the kernel writes
 * `SPECIALIST:<name>` -- the orchestrator-chosen name rule 2 keeps off the wire.
 * `workerRole` already obeyed rule 2; this key did not, so the name crossed beside
 * it. The SAME function now decides both: `wonderlandWorkerRole` keeps a permanent
 * role, collapses a specialist to `SPECIALIST`, and answers null for anything else,
 * which is DROPPED and counted, never guessed.
 */
export const WONDERLAND_ROLE_METADATA_KEY = 'role';

/**
 * SANITISE, which is the enforcement of rule 1.
 *
 * Drops rather than redacts. A redacted value still occupies a key a renderer
 * might display, and a credential-named key showing "[redacted]" on a HUD tells
 * a viewer that a credential exists — which is more than a world has any
 * business saying. Counting the drops keeps that honest without naming what
 * was removed.
 */
export function sanitizeWonderlandMetadata(raw: unknown): WonderlandMetadataResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { metadata: Object.freeze({}), dropped: 0 };
  }
  const out: Record<string, WonderlandMetadataValue> = {};
  let dropped = 0;
  let kept = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= WONDERLAND_METADATA_MAX_ENTRIES) {
      dropped += 1;
      continue;
    }
    if (factKeyIsSecretShaped(key)) {
      dropped += 1;
      continue;
    }
    // A CODE KEY CARRIES A CODE OR NOTHING (review M3): a string of the code shape, never prose, a path, a
    // number, a boolean or null.
    if (WONDERLAND_CODE_METADATA_KEYS.has(key) && !(typeof value === 'string' && METADATA_CODE.test(value))) {
      dropped += 1;
      continue;
    }
    // THE ROLE KEY OBEYS RULE 2 (verify n4): the wire role or nothing, by `workerRole`'s own function.
    if (key === WONDERLAND_ROLE_METADATA_KEY) {
      const role = wonderlandWorkerRole(typeof value === 'string' ? value : null);
      if (role === null) {
        dropped += 1;
        continue;
      }
      out[key] = role;
      kept += 1;
      continue;
    }
    if (value === null || typeof value === 'boolean') {
      out[key] = value;
      kept += 1;
      continue;
    }
    if (typeof value === 'number') {
      // NaN and Infinity are not facts a renderer can draw, and they survive
      // JSON as `null`, which would read as "reported nothing".
      if (!Number.isFinite(value)) {
        dropped += 1;
        continue;
      }
      out[key] = value;
      kept += 1;
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > WONDERLAND_METADATA_MAX_LENGTH) {
        dropped += 1;
        continue;
      }
      // A SECRET UNDER AN INNOCENT KEY (row 12, R4). The key rule above stops
      // `apiKey`; it cannot stop a provider's error code that echoed a key into
      // `reasonCode`, and the kernel's own write-time check only refuses
      // `key=value` text. So the VALUE is screened by the repository's boundary
      // redactor, and private reasoning or a stack trace is dropped the same way
      // -- and so is a PATH ON THE HOST, by the patterns /result trims with
      // (wonderland-host-paths.ts; internal review M3).
      if (redactBoundaryText(value).redactions > 0 || containsPrivateReasoning(value) || containsStackTrace(value)
        || containsWonderlandHostPath(value)) {
        dropped += 1;
        continue;
      }
      out[key] = value;
      kept += 1;
      continue;
    }
    // Objects, arrays, functions, symbols, undefined: a provider payload's
    // natural shapes. None of them cross.
    dropped += 1;
  }
  return { metadata: Object.freeze(out), dropped };
}

/* ------------------------------------------------------------ the envelope */

export interface WonderlandEnvelope {
  readonly schemaVersion: WonderlandEnvelopeSchemaVersion;
  readonly eventId: string;

  /* -------- identity. Every one known or explicitly null. -------- */

  /** The world this belongs to. The one identifier that is never null. */
  readonly projectId: string;
  /** The viewing session, when a world has been entered. */
  readonly worldSessionId: string | null;
  /** WHICH Julius. A surface must never merge two instances' streams. */
  readonly juliusInstanceId: string | null;
  readonly missionId: string | null;
  readonly runId: string | null;
  readonly taskId: string | null;
  readonly workerRole: WonderlandWorkerRole | null;

  /* -------- the semantic fact -------- */

  readonly state: JuliusVisualState;
  /** Which vocabulary produced the state. Precision travels with the reading. */
  readonly stateSource: JuliusStateSource;
  /** The upstream state string, kept so the visual collapse loses nothing. */
  readonly sourceState: string | null;
  /** True only for an event that asserts a real ending. */
  readonly terminal: boolean;

  /* -------- ordering -------- */

  readonly sequence: number;
  readonly revision: number;
  readonly occurredAt: string;

  /* -------- safe metadata -------- */

  readonly metadata: WonderlandMetadata;
  /** Metadata entries the sanitiser removed. Never what they were. */
  readonly metadataDropped: number;
}

export const WONDERLAND_ENVELOPE_FIELDS = exactKeys<WonderlandEnvelope>()([
  'schemaVersion',
  'eventId',
  'projectId',
  'worldSessionId',
  'juliusInstanceId',
  'missionId',
  'runId',
  'taskId',
  'workerRole',
  'state',
  'stateSource',
  'sourceState',
  'terminal',
  'sequence',
  'revision',
  'occurredAt',
  'metadata',
  'metadataDropped',
] as const);

/**
 * Build an envelope, sanitising as it goes.
 *
 * The ONLY constructor. A caller cannot assemble the object literally and skip
 * the sanitiser, because the sanitiser's output is the only thing that
 * satisfies `metadata` in practice — and a test sweeps real provider payloads
 * through here to prove nothing survives.
 */
export function wonderlandEnvelope(input: {
  readonly eventId: string;
  readonly projectId: string;
  readonly worldSessionId?: string | null;
  readonly juliusInstanceId?: string | null;
  readonly missionId?: string | null;
  readonly runId?: string | null;
  readonly taskId?: string | null;
  readonly workerRole?: string | null;
  readonly state: JuliusVisualState;
  readonly stateSource: JuliusStateSource;
  readonly sourceState?: string | null;
  readonly terminal?: boolean;
  readonly sequence: number;
  readonly revision?: number;
  readonly occurredAt: string;
  readonly metadata?: unknown;
}): WonderlandEnvelope {
  const sanitized = sanitizeWonderlandMetadata(input.metadata);
  return Object.freeze({
    schemaVersion: WONDERLAND_ENVELOPE_SCHEMA_V1,
    eventId: input.eventId,
    projectId: input.projectId,
    worldSessionId: input.worldSessionId ?? null,
    juliusInstanceId: input.juliusInstanceId ?? null,
    missionId: input.missionId ?? null,
    runId: input.runId ?? null,
    taskId: input.taskId ?? null,
    workerRole: wonderlandWorkerRole(input.workerRole),
    state: input.state,
    stateSource: input.stateSource,
    sourceState: input.sourceState ?? null,
    terminal: input.terminal ?? false,
    sequence: input.sequence,
    // Absent means zero, and zero is the lowest revision — so an authority that
    // does not version its reports never accidentally outranks one that does.
    revision: input.revision ?? 0,
    occurredAt: input.occurredAt,
    metadata: sanitized.metadata,
    metadataDropped: sanitized.dropped,
  });
}

/** Every vocabulary this envelope can carry, for a receiver to switch on. */
export const WONDERLAND_ENVELOPE_VOCABULARIES = Object.freeze({
  state: JULIUS_VISUAL_STATES,
  stateSource: JULIUS_STATE_SOURCES,
  workerRole: WONDERLAND_WORKER_ROLES,
});
