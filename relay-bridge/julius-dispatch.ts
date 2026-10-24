import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { bearerMatches } from './bearer-auth';
import { sessionTokenFrom } from './browser-session/routes';
import { isAdmittedRunId, type AdmissionClaimStore } from './julius-dispatch-admission';
import { runJuliusCompanionSlot, type JuliusCompanionBinding } from './julius-companion-slot';
import { preSpendDecision, spendRefusalCode, type JuliusSpendLedgerPort } from './julius-dispatch-spend';
import { composeRoleProviders } from './julius-role-compose';
import type { KeyStore } from './julius-key-store';
import type { JuliusSettlementFact } from '../src/relay/mission/julius/julius-spend-ceiling';

/**
 * J1: THE IN-GAME MISSION DISPATCH ROUTE. Flag-gated, loopback-only, founder-only.
 *
 * WHAT IT IS. After the game has created a run (`POST .../julius/missions`, which never dispatches), the PAIRED GAME CLIENT may
 * ask this bridge to drive that run through Architect -> Coder -> Reviewer, LOCALLY, with a per-role pre_call/result ledger, and
 * read the chain events and the result back. The three roles are PORTS (`RoleProvider`); this file contains no provider code,
 * no key and no network call. Tests inject fakes; a paid run needs real adapters (OPEN_ITEMS) AND reviewer clearance of the
 * exact head/tree first.
 *
 * WHAT IT REFUSES, in this order, each with its own named code and BEFORE any provider is contacted:
 *   1. not loopback (peer address, Host header, any forwarding header)            403 julius_dispatch_not_loopback
 *   2. kill switch not exactly JULIUS_J1_ENABLED=1 (default OFF; re-read per role) 503 julius_dispatch_disabled
 *   3. a browser origin, the operator credential, or anything but a native session 403/401
 *   4. a native session that is not the ONE founder player, for the ONE configured project
 *   5. a second pairing (a different session id after the first accepted dispatch) 403 julius_dispatch_second_pairing
 *   6. a run that is not READY in the frozen mission, or a mission that is not frozen/independent/unseeded
 *   7. caps (daily, per-mission runs, one run once) and concurrency (exactly one chain at a time).
 *      A mission whose marker namespace is in the runtime spend table is refused by
 *      `authorizeJuliusLiveSpend` before the admission is claimed. That is the only
 *      durable cap. Env may lower the in-chain estimate. It cannot raise the table.
 *   8. a ledger that cannot be written: the acceptance row, every pre_call row. NO row = NO provider call.
 *   9. a live (non-fake) composition. Paid execution is the gated workflow. This process does not call a provider.
 *
 * RUN IDS. The client may present either id of the admitted pair: `wlj_` plus a canonical lowercase UUIDv4,
 * or `run:` plus 24 lowercase hex. Any other string is `400 julius_dispatch_run_invalid`. The id must be the
 * one on the admitted record. Spend, evidence and billing rows key on the `run:` id. This route does not mint one.
 *
 * THE TRIGGER ORIGINATES IN THE GAME. The dispatch body must carry `clientLogSha256`: the sha256 of the exact client log line
 * (run id, trigger id, key hash) the game wrote BEFORE it sent the request. The bridge cannot read the client log; it BINDS the
 * hash into the acceptance row, which precedes every pre_call row, so a reviewer can check the capture file for a line with that
 * hash and an earlier timestamp. The operator bearer is refused outright, so a shell `curl` cannot stand in for the game.
 *
 * NO KEY, NO TEXT IN A ROW. Keys are read from the injected environment INSIDE a call, handed to the role port, never stored,
 * logged, ledgered or returned; provider output is scrubbed of every exact key value. Rows hold ids, hashes, counts and
 * digests only. The FULL provider response id is in the ledger only (for the founder's console read); events and results carry
 * its tail and a hash.
 */

export type DispatchRole = 'architect' | 'coder' | 'reviewer';
export const DISPATCH_ROLES: readonly DispatchRole[] = ['architect', 'coder', 'reviewer'];

export const J1_DEFAULT_DAILY_CAP = 2;
export const J1_DEFAULT_MAX_RUNS_PER_MISSION = 2;
export const J1_DEFAULT_ROLE_TIMEOUT_MS = 10 * 60_000;
export const J1_TEXT_MAX_CHARS = 8_000;
export const J1_EVENTS_PAGE_LIMIT = 200;

/* ---------------------------------------------------------------------------------------------------------------- */
/* Ports                                                                                                            */

export interface RoleUsage { readonly input: number | null; readonly output: number | null; readonly total: number | null }

export interface RoleCallInput {
  readonly role: DispatchRole;
  readonly runId: string;
  readonly dispatchId: string;
  readonly missionId: string;
  /** From the injected environment, at call time. Empty string for a role whose adapter declares no key (a subscription coder). */
  readonly apiKey: string;
  /** The earlier roles' scrubbed outputs (the architect's plan for the coder; both for the reviewer). */
  readonly architectText: string | null;
  readonly coderArtifact: string | null;
  /** REVIEWER: the bounded executor evidence the coder leg returned (changed-path list or diff text), scrubbed. Null/absent = the executor gave none. */
  readonly coderEvidence?: string | null;
}
export interface RoleCallOutput {
  readonly ok: boolean;
  readonly text: string;
  /** The provider's own response id, or null when the call failed before one existed. */
  readonly responseId: string | null;
  readonly model: string | null;
  readonly usage?: RoleUsage;
  /** Failure class only, never a provider message (a message can echo a key or a prompt). */
  readonly failureClass?: string;
  /** CODER: how many paths the EXECUTOR observed changed in the workspace. Null/absent = the executor did not capture (UNKNOWN, never 0). A coder that changed none cannot complete the chain. */
  readonly changedPaths?: number | null;
  /** CODER: how many command invocations the executor itself mediated for the session. Null/absent = the executor cannot say; never 0 by default. Ledgered, not gated. */
  readonly toolInvocations?: number | null;
  /** CODER: bounded executor evidence (diff or changed-file contents, or a labelled path list) shown to the reviewer. Null/absent = none. */
  readonly evidence?: string | null;
  /** CODER, D-5 / real child PATH: the shared index file's sha256 right after the start and right before the close, and the pinned bash's sha256. Absent = the shell did not say. */
  readonly shellEvidence?: { readonly indexSha256AfterStart: string | null; readonly indexSha256BeforeClose: string | null; readonly bashSha256: string | null };
  /** CODER bundle step: sha256 of the trimmed final message and of the trimmed out/normalized.json bytes (null = no file), and the workspace paths that changed. */
  readonly bundle?: {
    readonly judgedSha256: string; readonly fileSha256: string | null; readonly changedPaths: readonly string[];
    /** M3 D1: the FULL workspace hash lists before and after the session, and their sha256 (the lists go to a `bundle_lists` ledger row). */
    readonly beforeList: Readonly<Record<string, string>>; readonly afterList: Readonly<Record<string, string>>;
    readonly beforeListSha256: string; readonly afterListSha256: string;
    /** M3 D2: the git directory's own tree hash before and after (null = no git directory named) and the named exclusions in force. */
    readonly gitTreeSha256Before: string | null; readonly gitTreeSha256After: string | null; readonly excluded: readonly string[];
  };
  /** REVIEWER: sha256 over everything the reviewer was shown, so a verdict can be tied to what was judged. Present on a failed leg that got that far. */
  readonly shownSha256?: string | null;
  /** REVIEWER: the verdict the reviewer returned. */
  readonly verdict?: 'approve' | 'reject';
  /** How many provider HTTP requests sit behind THIS response id (a Hermes tool loop can be several). Null/absent = adapter cannot say. Ledgered for the console request-count check (xAI 12 vs 3). */
  readonly requests?: number | null;
  /** False = the adapter refused BEFORE any request left (nothing could have been billed). Absent = unknown/contacted. */
  readonly providerContacted?: false;
  /** Provider- or session-reported cost in USD micros, when it gave one. Never inferred, never a price list. Copied on success and on failure. */
  readonly costUsdMicros?: number | null;
  /** Set once a provider was contacted. The bill is not settled in this process. */
  readonly billing?: 'PENDING';
  /** The provider request id used to trace the bill. Null when the provider did not return one of the accepted shapes. */
  readonly traceId?: string | null;
  /** xAI `usage.cost_in_usd_ticks` that `costUsdMicros` was rounded up from. Present only beside that receipt. */
  readonly costUsdTicksRaw?: number | null;
}

/** The spend marker on every result row: usage the provider reported, an explicit unknown, or a leg that never reached the provider. */
export type SpendMarker = 'usage_reported' | 'spend_unknown' | 'not_contacted';
export function spendMarkerOf(out: Pick<RoleCallOutput, 'usage' | 'providerContacted' | 'costUsdMicros'>): SpendMarker {
  if (out.providerContacted === false) return 'not_contacted';
  const u = out.usage;
  const hasTokens = u !== undefined && (u.input !== null || u.output !== null || u.total !== null);
  return hasTokens || (typeof out.costUsdMicros === 'number') ? 'usage_reported' : 'spend_unknown';
}
export interface RoleProvider {
  /** The provider's independence group: the three roles must differ. Ledger and config only: it NEVER goes to the client. */
  readonly providerId: string;
  /** The model the adapter is configured to request (ledgered in pre_call; the provider-echoed model comes back in the output and is REQUIRED). */
  readonly model: string;
  /**
   * The provider-echoed model strings this role's response may carry. DEFAULT (absent) = [model]: strict equality with the requested model.
   * Checked by the CONTROLLER after every successful call (failure class `served_model_mismatch`); an alias is accepted only when listed.
   * The response id, echoed model, usage and requests stay in the result row of a mismatched leg (spend is recorded, never dropped).
   */
  readonly servedModelAllow?: readonly string[];
  /** True for a fake adapter. A fake adapter in live mode, or a real one in fake mode, is refused. */
  readonly fake: boolean;
  /** The environment variable the key is read from, or null for a role with no key. */
  readonly keyEnv: string | null;
  call(input: RoleCallInput): Promise<RoleCallOutput>;
}
export interface DispatchProviders { readonly architect: RoleProvider; readonly coder: RoleProvider; readonly reviewer: RoleProvider }

/** The run the game created with POST .../julius/missions. Null = no such run in this project. */
export interface RunLookup {
  lookup(input: { readonly projectId: string; readonly runId: string }): Promise<{ readonly missionId: string; readonly contractSha256: string; readonly state: string } | null>;
}

/** The hidden checker, run on the coder's artifact only. Written by someone other than the mission's author (attested in `FrozenMission`). */
export interface HiddenChecker {
  /** `output` is the checker's own verdict text; its sha256 goes in the final row. */
  check(input: { readonly runId: string; readonly artifactText: string }): Promise<{ readonly pass: boolean; readonly output?: string }>;
}

export interface FrozenMission {
  readonly missionId: string;
  readonly contractSha256: string;
  readonly checkerSha256: string;
  readonly missionAuthor: string;
  readonly checkerAuthor: string;
  /** Must be false: a defect seeded for the coder to find is a forced catch, not a mission. */
  readonly seededDefect: boolean;
  /** The reviewed prereg this freeze belongs to. */
  readonly preregId: string;
  /** Marker namespace in the runtime spend table. Absent means this mission is not that cap. */
  readonly markerNamespace?: string | null;
  /** Contract `limits.spendUsd`. Unknown stays null. The table's default is not substituted here. */
  readonly spendUsd?: number | null;
  /** Contract `limits.repairCycles`. Unknown stays null. */
  readonly repairCycles?: number | null;
}

export function frozenMissionProblems(m: FrozenMission): readonly string[] {
  const problems: string[] = [];
  const hex64 = /^[0-9a-f]{64}$/;
  if (m.missionId.trim() === '') problems.push('missionId empty');
  if (!hex64.test(m.contractSha256)) problems.push('contractSha256 is not a sha256');
  if (!hex64.test(m.checkerSha256)) problems.push('checkerSha256 is not a sha256');
  if (m.missionAuthor.trim() === '' || m.checkerAuthor.trim() === '') problems.push('author attestation missing');
  else if (m.missionAuthor.trim().toLowerCase() === m.checkerAuthor.trim().toLowerCase()) problems.push('checker written by the mission author');
  if (m.seededDefect) problems.push('mission has a seeded defect');
  if (m.preregId.trim() === '') problems.push('preregId empty');
  return problems;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Ledger                                                                                                           */

export type DispatchRow = Readonly<Record<string, string | number | boolean | null | Readonly<Record<string, string | number | null>>>>;
export interface DispatchLedger {
  /** Rejects (or throws) unless the row is durably written. The caller does not proceed on a rejection. */
  append(row: DispatchRow): Promise<void>;
  rows(): Promise<readonly DispatchRow[]>;
}

/** In-memory ledger for tests. `failWrites(row)` returning true makes that append reject and keeps nothing. */
export function createMemoryDispatchLedger(options: { readonly failWrites?: (row: DispatchRow) => boolean } = {}): DispatchLedger & { readonly held: DispatchRow[] } {
  const held: DispatchRow[] = [];
  return {
    held,
    async append(row) {
      await Promise.resolve();
      if (options.failWrites?.(row) === true) throw new Error('memory ledger write refused');
      held.push(row);
    },
    async rows() { return held.slice(); },
  };
}

/**
 * A single-process append-only JSON-lines file, one write plus fsync per row, serialised in this process; read back at start so
 * caps survive a restart. Any unreadable line REFUSES to open (a lost row could have been a cap). NOT safe across two processes.
 */
export interface FileDispatchLedger extends DispatchLedger { readonly file: string; close(): void }
export function createFileDispatchLedger(options: { readonly file: string }): FileDispatchLedger {
  const file = resolve(options.file);
  mkdirSync(dirname(file), { recursive: true });
  const rows: DispatchRow[] = [];
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const last = lines.pop();
    lines.forEach((line, index) => {
      let value: unknown;
      try { value = JSON.parse(line); } catch { value = null; }
      if (typeof value !== 'object' || value === null || Array.isArray(value) || typeof (value as { phase?: unknown }).phase !== 'string') {
        throw new Error(`julius dispatch ledger: line ${index + 1} is not a valid row; refusing to open it`);
      }
      rows.push(value as DispatchRow);
    });
    if (last !== undefined && last !== '') throw new Error('julius dispatch ledger: unterminated final line; refusing to open it');
  }
  let fd: number | null = openSync(file, 'a');
  let chain: Promise<unknown> = Promise.resolve();
  return {
    file,
    append(row) {
      const run = chain.then(() => {
        if (fd === null) throw new Error('julius dispatch ledger: closed');
        const data = Buffer.from(`${JSON.stringify(row)}\n`, 'utf8');
        let offset = 0;
        while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset);
        fsyncSync(fd);
        rows.push(row);
      });
      chain = run.then(() => undefined, () => undefined);
      return run;
    },
    async rows() { return rows.slice(); },
    close() { if (fd !== null) { closeSync(fd); fd = null; } },
  };
}

/**
 * THE ORDERING RULE: UI-action < run_created <= first pre_call <= result (and every row of the run after run_created in ledger
 * order). Checked against the ledger itself, so a reviewer-run replay can re-verify it. The UI-action time is the CLIENT's claim
 * (the bridge cannot read the client log); what it proves is that the claim precedes the bridge's own clock reading.
 */
export function verifyRunOrdering(rows: readonly DispatchRow[], runId: string): { readonly ok: true } | { readonly ok: false; readonly violation: string } {
  const mine = rows.filter((r) => r.runId === runId);
  const created = mine.find((r) => r.phase === 'run_created');
  if (created === undefined) return { ok: false, violation: 'run_created_missing' };
  const ui = Date.parse(String(created.uiActionUtc));
  const createdAt = Date.parse(String(created.at));
  if (!Number.isFinite(ui) || !Number.isFinite(createdAt)) return { ok: false, violation: 'timestamp_unparsable' };
  if (!(ui < createdAt)) return { ok: false, violation: 'ui_action_not_before_run_created' };
  const createdIndex = mine.indexOf(created);
  let floor = createdAt;
  const firstPre = mine.findIndex((r) => r.phase === 'pre_call');
  const firstResult = mine.findIndex((r) => r.phase === 'result');
  if (firstPre !== -1 && firstResult !== -1 && firstResult < firstPre) return { ok: false, violation: 'result_before_pre_call' };
  for (const [index, row] of mine.entries()) {
    if (index === createdIndex) continue;
    if (index < createdIndex) return { ok: false, violation: 'row_before_run_created' };
    const at = Date.parse(String(row.at));
    if (!Number.isFinite(at)) return { ok: false, violation: 'timestamp_unparsable' };
    if (at < floor) return { ok: false, violation: `${String(row.phase)}_before_earlier_row` };
    floor = at;
  }
  return { ok: true };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Events and result. NOTHING on this wire names a provider or a model: the provider-name ban is enforced HERE, at the */
/* source, not only in the client. Provider ids and models live in the ledger and the config only.                  */

export type ChainPhase = 'started' | 'done' | 'refused';
export interface ChainEvent {
  readonly sequence: number;
  readonly type: string;
  readonly at: string;
  /** architect | coder | reviewer | checker */
  readonly role?: DispatchRole | 'checker';
  /** The client's `WLMISSION chain phase=` value. */
  readonly phase?: ChainPhase;
  readonly outcome?: string;
  readonly responseIdTail?: string | null;
  readonly responseIdSha16?: string | null;
  readonly usage?: RoleUsage | null;
  readonly failure?: string | null;
  readonly resultSha256?: string;
  /** Companion evidence only: a scrubbed wake id, the body digest, and artifact hashes. Never a task body. */
  readonly wakeId?: string | null;
  readonly bodyDigest?: string | null;
  readonly artifactHashes?: readonly string[];
}
/** UNRECORDED = the chain ended but its FINAL ledger row could not be written: the run has no sealed record (a restart will orphan it). */
export type ChainState = 'ACCEPTED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'HALTED' | 'ORPHANED' | 'UNRECORDED';
const TERMINAL: readonly ChainState[] = ['COMPLETED', 'FAILED', 'HALTED', 'ORPHANED', 'UNRECORDED'];

/**
 * RESTART LIMITS, stated. The ledger survives a restart (caps, one-run-once, run creator); process memory does not. In particular
 * the second-pairing bind (`boundSession`) lives in memory only: after a restart the first session id seen binds again, so a
 * different session can dispatch a NEW run. A repeat dispatch of a run already in the ledger is refused from the ledger.
 */
export const J1_RESTART_LIMITS = Object.freeze({
  boundSessionSurvivesRestart: false,
  ledgerRefusesRepeatRunAfterRestart: true,
  statement: 'The second-pairing bind (boundSession) is in-memory and resets on restart; run, key and creator checks are read from the ledger and survive it.',
});

export type DispatchMode = 'live' | 'fake';

interface RunRecord {
  /** The id the caller presented. Events and the HTTP body echo it. */
  readonly presentedRunId: string;
  /** Ledger key for spend, evidence and billing. Always `run:` + 24 hex. */
  readonly serverRunId: string;
  readonly clientRunId: string;
  readonly runId: string;
  readonly dispatchId: string;
  readonly projectHash: string;
  readonly callerHash: string;
  readonly keyHash: string;
  readonly missionId: string;
  readonly mode: DispatchMode;
  state: ChainState;
  readonly events: ChainEvent[];
  resultText: string | null;
  resultSha256: string | null;
}

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/u;
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const sha16 = (value: string): string => sha256(value).slice(0, 16);
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const tailOf = (id: string | null): string | null => (id === null ? null : id.slice(-8));

/**
 * A provider request id: Anthropic `request-id` (`req_`), or an xAI / OpenAI response id
 * (`resp_` or `chatcmpl-`). A Claude session id and a message id are not one.
 * Credential-shaped text is not one. Non-empty is not enough.
 */
const PROVIDER_REQUEST_ID = /^(?:req_|resp_|chatcmpl-)[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const CREDENTIAL_SHAPED_REQUEST = /(?:^sk-|api[_-]?key|secret|token|password)/iu;

export function providerRequestId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('sess-') || trimmed.startsWith('sess_') || trimmed.startsWith('msg_')) return null;
  if (!PROVIDER_REQUEST_ID.test(trimmed)) return null;
  if (CREDENTIAL_SHAPED_REQUEST.test(trimmed)) return null;
  return trimmed;
}

/** Removes every exact key value (8+ chars) from provider output, then bounds it. */
export function scrubKeys(text: string, keys: readonly string[]): string {
  let out = text;
  for (const key of keys) if (key.length >= 8) out = out.split(key).join('[redacted]');
  return out.slice(0, J1_TEXT_MAX_CHARS);
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* Controller                                                                                                       */

export interface JuliusDispatchDeps {
  /** Null = no adapters composed: every dispatch is refused 503 julius_dispatch_providers_not_composed. */
  readonly providers: DispatchProviders | null;
  readonly runs: RunLookup;
  readonly frozen: FrozenMission;
  readonly checker: HiddenChecker;
  readonly ledger: DispatchLedger;
  /**
   * OPTIONAL CLAIM, never the source. The mode stamped on rows and on the wire is DERIVED from the composed adapters (every
   * adapter's `fake` flag: all fake = 'fake', all real = 'live', a mix is refused). A declared mode that contradicts the derived
   * one is refused `julius_dispatch_mode_mismatch`. Fake = the zero-spend rehearsal build on the IDENTICAL code path (D11).
   */
  readonly mode?: DispatchMode;
  /**
   * sha256 of the exact UTF-8 bytes of the brief the roles are given. REQUIRED in live mode and, whenever present, must EQUAL the frozen
   * contract sha256: a mismatch is refused (`julius_dispatch_brief_not_frozen_contract`) BEFORE any ledger row or provider call. Recorded
   * in the run_start row.
   */
  readonly briefSha256?: string;
  /** Read at every use: the kill switch is re-read before every role, so flipping it halts a running chain at the next role. */
  readonly env: () => Record<string, string | undefined>;
  /**
   * WHERE THE PROVIDER KEYS COME FROM. When given, every key is read from this port at CALL time (one read per leg, dropped when the leg ends)
   * and `env` is NEVER consulted for a key: the keyEnv names are logical key names only. The production wiring always supplies it.
   * Absent = the legacy env read, kept ONLY for fake-mode controllers and unit tests. REQUIRED when the derived mode is live (503 julius_dispatch_key_store_required).
   */
  readonly keyStore?: KeyStore;
  /**
   * The admission claim. Absent refuses `julius_dispatch_admission_required` before any ledger row or provider call.
   * The controller does not reserve a run itself.
   */
  readonly claims?: AdmissionClaimStore;
  /** The durable spend ledger #404 reads. Settlements recorded here are the facts `authorizeJuliusLiveSpend` folds. */
  readonly spendLedger?: JuliusSpendLedgerPort;
  /**
   * Optional companion slot. Absent means the chain never wakes one. When present, Julius hands at most one
   * companion task to `port` after the architect and does not call a provider for it. A timeout, failure,
   * or rejection does not stop the coder. No spend row is written for the slot.
   */
  readonly companion?: JuliusCompanionBinding;
  readonly now: () => number;
  /** Safe lines only (ids, hashes, codes). Never a key, a body or provider text. */
  readonly log?: (line: string) => void;
  readonly newId?: () => string;
}

export interface DispatchInput {
  readonly projectId: string;
  readonly runId: string;
  readonly callerPlayerId: string;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly clientTriggerId: string;
  readonly clientLogSha256: string;
  /** When the player's UI action happened, UTC ISO-8601, from the game client log line the hash binds. Must precede the ledger run_created time. */
  readonly clientUiActionUtc: string;
  /** Client clock minus bridge clock, measured against a GET /echo reading. REQUIRED when the composition is live; optional in code. */
  readonly clientOffsetMs?: number;
  /** The echoId issued by GET /echo that the offset was measured against. REQUIRED when live. */
  readonly echoId?: string;
}
export type EchoOutcome =
  | { readonly ok: true; readonly bridgeUtc: string; readonly echoId: string }
  | { readonly ok: false; readonly status: number; readonly code: string };

/** Largest |clientOffsetMs| the bridge accepts, and how long an issued echoId is remembered (in memory only). */
export const J1_MAX_CLOCK_OFFSET_MS = 1000;
export const J1_ECHO_TTL_MS = 120_000;
const J1_ECHO_MAX_OUTSTANDING = 32;
export type DispatchOutcome =
  | { readonly ok: true; readonly status: 202 | 200; readonly dispatchId: string; readonly runId: string; readonly state: ChainState; readonly replayed: boolean; readonly ledgerRef: string; readonly mode: DispatchMode }
  | { readonly ok: false; readonly status: number; readonly code: string };

export interface JuliusDispatchController {
  dispatch(input: DispatchInput): Promise<DispatchOutcome>;
  /** Issues { bridgeUtc, echoId } for the client's clock-offset measurement; the echoId is remembered for 120 s and is single use. */
  issueEcho(input: { readonly projectId: string; readonly callerPlayerId: string }): EchoOutcome;
  events(input: { readonly projectId: string; readonly runId: string; readonly callerPlayerId: string; readonly cursor: number }): { readonly status: number; readonly body: unknown };
  result(input: { readonly projectId: string; readonly runId: string; readonly callerPlayerId: string }): { readonly status: number; readonly body: unknown };
  /**
   * RESTART / ORPHAN HANDLING (D9). Reads the ledger: every run with a run_start and no final row gets an `orphaned` row and the
   * state ORPHANED (it is NEVER resumed, so a finished or half-finished leg can never get a second pre_call); finished runs are
   * re-registered with their result hash (the result TEXT is gone with the process). Call once at start, before serving.
   */
  recover(): Promise<{ readonly orphaned: readonly string[]; readonly finished: readonly string[] }>;
  /** Resolves when no chain is running (tests, shutdown). */
  whenIdle(): Promise<void>;
  killSwitchOn(): boolean;
}

const refuse = (status: number, code: string): DispatchOutcome => ({ ok: false, status, code });
const positiveInt = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const positiveNumber = (raw: string | undefined): number | null => {
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function createJuliusDispatch(deps: JuliusDispatchDeps): JuliusDispatchController {
  const records = new Map<string, RunRecord>();
  let inFlight = false;
  let running: Promise<void> = Promise.resolve();
  let boundSession: string | null = null;
  let reservationChain: Promise<unknown> = Promise.resolve();
  const log = (line: string): void => { try { deps.log?.(`[julius-j1] ${line}`); } catch { /* a log sink must not break the chain */ } };
  const newId = deps.newId ?? ((): string => `disp_${sha256(`${deps.now()}:${Math.random()}`).slice(0, 20)}`);
  const killSwitchOn = (): boolean => deps.env().JULIUS_J1_ENABLED === '1';
  /* echoId -> expiry (ms). In memory only: a restart forgets every echo, so a pre-restart echo is unknown (refused). */
  const echoes = new Map<string, number>();
  const pruneEchoes = (at: number): void => {
    for (const [id, expiry] of echoes) if (expiry <= at) echoes.delete(id);
    while (echoes.size >= J1_ECHO_MAX_OUTSTANDING) { const oldest = echoes.keys().next(); if (oldest.done === true) break; echoes.delete(oldest.value); }
  };

  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = reservationChain.then(fn, fn);
    reservationChain = run.then(() => undefined, () => undefined);
    return run;
  };

  const emit = (rec: RunRecord, event: Omit<ChainEvent, 'sequence' | 'at'>): void => {
    rec.events.push({ sequence: rec.events.length + 1, at: new Date(deps.now()).toISOString(), ...event });
  };

  async function runChain(rec: RunRecord, ctx: { readonly missionId: string; readonly budgetCapUsd: number; readonly legEstimateUsd: number; readonly mode: DispatchMode }): Promise<void> {
    const providers = deps.providers as DispatchProviders;
    const base = { dispatchId: rec.dispatchId, runId: rec.serverRunId, clientRunId: rec.clientRunId };
    const env = deps.env();
    /** Every key in play, read NOW for one leg's scrub (the store is read again each time; nothing is kept between legs). */
    const keysInPlay = (): string[] => DISPATCH_ROLES.map((role) => {
      const name = providers[role].keyEnv;
      if (name === null) return '';
      if (deps.keyStore !== undefined) { try { return deps.keyStore.getKey(name).trim(); } catch { return ''; } }
      return (deps.env()[name] ?? '').trim();
    }).filter((value) => value !== '');
    const timeoutMs = positiveInt(env.JULIUS_J1_ROLE_TIMEOUT_MS, J1_DEFAULT_ROLE_TIMEOUT_MS);
    const summaries: Record<string, unknown>[] = [];
    let architectText: string | null = null;
    let coderArtifact: string | null = null;
    let coderEvidence: string | null = null;
    let companionArtifactSha: string | null = null;
    let verdict: 'approve' | 'reject' | null = null;
    let failure: string | null = null;
    let halted = false;
    let legsStarted = 0;
    /** Legs whose spend the provider did not report. COUNTED, never priced: the console read is the measurement. */
    let unknownSpendLegs = 0;
    rec.state = 'RUNNING';

    for (const role of DISPATCH_ROLES) {
      const provider = providers[role];
      if (!killSwitchOn()) { failure = 'kill_switch_flipped'; halted = true; break; }
      /* BUDGET: a leg that could take the run's ESTIMATED spend over the cap is refused BEFORE its pre_call. The estimate is an
         operator number (JULIUS_J1_LEG_ESTIMATE_USD), not a measurement; the console read is the measurement. */
      if ((legsStarted + 1) * ctx.legEstimateUsd > ctx.budgetCapUsd) {
        try { await deps.ledger.append({ phase: 'budget_refused', ...base, role, at: new Date(deps.now()).toISOString(), budgetCapUsd: ctx.budgetCapUsd, legEstimateUsd: ctx.legEstimateUsd, legsStarted, unknownSpendLegs }); } catch { /* refusing anyway */ }
        emit(rec, { type: 'chain.refused', role, phase: 'refused', failure: 'budget_refused' });
        failure = 'budget_refused'; halted = true; break;
      }
      let apiKey = '';
      if (provider.keyEnv !== null) {
        if (deps.keyStore !== undefined) { try { apiKey = deps.keyStore.getKey(provider.keyEnv).trim(); } catch { apiKey = ''; } } else apiKey = (deps.env()[provider.keyEnv] ?? '').trim();
      }
      if (provider.keyEnv !== null && apiKey === '') { failure = 'provider_key_missing'; break; }
      /* THE ROW BEFORE THE CALL, fsynced by the ledger. A pre_call row that cannot be written means NO provider call. */
      try {
        await deps.ledger.append({
          phase: 'pre_call', ...base, role, provider: provider.providerId, model: provider.model, keyHash: rec.keyHash, playerHash: rec.callerHash,
          mode: ctx.mode, attempt: 1, at: new Date(deps.now()).toISOString(),
        });
      } catch {
        failure = 'ledger_write_failed'; halted = true; break;
      }
      /* KILL SWITCH, THE LAST LOOK: re-read immediately before the provider call, after the (awaited) pre_call row. A flip during
         that write stops THIS call. The pre_call row stands, so a call_not_made row says the call did not happen. */
      if (!killSwitchOn()) {
        try { await deps.ledger.append({ phase: 'call_not_made', ...base, role, reason: 'kill_switch_flipped_before_call', at: new Date(deps.now()).toISOString() }); } catch { /* halting anyway */ }
        emit(rec, { type: 'chain.refused', role, phase: 'refused', failure: 'kill_switch_flipped' });
        failure = 'kill_switch_flipped'; halted = true; break;
      }
      legsStarted += 1;
      emit(rec, { type: 'role.started', role, phase: 'started' });
      let out: RoleCallOutput;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        out = await Promise.race([
          provider.call({ role, runId: rec.runId, dispatchId: rec.dispatchId, missionId: ctx.missionId, apiKey, architectText, coderArtifact, coderEvidence }),
          new Promise<RoleCallOutput>((_, reject) => { timer = setTimeout(() => reject(new Error('role timeout')), timeoutMs); }),
        ]);
      } catch (error) {
        out = { ok: false, text: '', responseId: null, model: null, failureClass: error instanceof Error && error.message === 'role timeout' ? 'timeout' : 'provider_error' };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      // The coder's final message is trimmed ONCE, here: the checker judges, the ledger hashes (outputSha256, artifactSha256) and the result bytes carry exactly these trimmed bytes (contract v2 artifact policy).
      const secrets = keysInPlay();
      const scrubbed = scrubKeys(out.text, secrets);
      const text = role === 'coder' ? scrubbed.trim() : scrubbed;
      const rawId = typeof out.responseId === 'string' ? out.responseId : null;
      const responseId = providerRequestId(rawId);
      const scrubbedId = rawId === null ? null : scrubKeys(rawId, secrets);
      const echoedModel = out.model === null ? null : scrubKeys(out.model, secrets);
      let roleFailure: string | null = null;
      if (!out.ok) roleFailure = out.failureClass ?? 'provider_failed';
      /* A successful leg needs a provider request id of the provider's own shape, and the model the provider echoed. */
      else if (responseId === null || echoedModel === null || echoedModel.trim() === '') roleFailure = 'response_identity_missing';
      else if (!(provider.servedModelAllow ?? [provider.model]).includes(echoedModel)) roleFailure = 'served_model_mismatch';
      else if (text.trim() === '') roleFailure = 'empty_output';
      else if (role === 'coder' && (out.changedPaths ?? 0) < 1) roleFailure = 'no_workspace_change';
      else if (role === 'reviewer' && out.verdict !== 'approve' && out.verdict !== 'reject') roleFailure = 'verdict_missing';
      const evidence = out.evidence === undefined || out.evidence === null || out.evidence === '' ? null : scrubKeys(out.evidence, secrets);
      const outcome = roleFailure === null ? 'ok' : roleFailure;
      const spend = spendMarkerOf(out);
      if (spend === 'spend_unknown') unknownSpendLegs += 1;
      const resultRow: DispatchRow = {
        phase: 'result', ...base, role, provider: provider.providerId, at: new Date(deps.now()).toISOString(), outcome,
        /* The FULL response id lives in the ledger only: the founder reads the provider console by it. */
        providerResponseId: scrubbedId, model: echoedModel, mode: ctx.mode,
        usage: out.usage === undefined ? null : { input: out.usage.input, output: out.usage.output, total: out.usage.total },
        requests: out.requests ?? null,
        spend, spendUnknown: spend === 'spend_unknown', costUsdMicros: out.costUsdMicros ?? null, costUsdTicksRaw: out.costUsdTicksRaw ?? null,
        billing: out.billing ?? null, traceId: out.traceId ?? null,
        outputSha256: text === '' ? null : sha256(text), outputChars: text.length,
        changedPaths: role === 'coder' ? (out.changedPaths ?? null) : null,
        toolInvocations: role === 'coder' ? (out.toolInvocations ?? null) : null,
        artifactJudgedSha256: role === 'coder' ? (out.bundle?.judgedSha256 ?? null) : null,
        artifactFileSha256: role === 'coder' ? (out.bundle?.fileSha256 ?? null) : null,
        workspaceChangedPaths: role === 'coder' && out.bundle !== undefined ? out.bundle.changedPaths.join(',') : null,
        beforeListSha256: role === 'coder' ? (out.bundle?.beforeListSha256 ?? null) : null,
        afterListSha256: role === 'coder' ? (out.bundle?.afterListSha256 ?? null) : null,
        gitTreeSha256Before: role === 'coder' ? (out.bundle?.gitTreeSha256Before ?? null) : null,
        gitTreeSha256After: role === 'coder' ? (out.bundle?.gitTreeSha256After ?? null) : null,
        workspaceExcluded: role === 'coder' && out.bundle !== undefined ? out.bundle.excluded.join(',') : null,
        indexSha256AfterStart: role === 'coder' ? (out.shellEvidence?.indexSha256AfterStart ?? null) : null,
        indexSha256BeforeClose: role === 'coder' ? (out.shellEvidence?.indexSha256BeforeClose ?? null) : null,
        bashSha256: role === 'coder' ? (out.shellEvidence?.bashSha256 ?? null) : null,
        evidenceSha256: role === 'coder' && evidence !== null ? sha256(evidence) : null,
        evidenceChars: role === 'coder' && evidence !== null ? evidence.length : null,
        shownSha256: role === 'reviewer' ? (out.shownSha256 ?? null) : null,
        verdict: role === 'reviewer' ? (out.verdict ?? null) : null,
        attempts: 1,
      };
      let resultWritten = true;
      /* M3 D1: the full lists go to their own row BEFORE the result row, so a result row never exists without its lists. */
      if (role === 'coder' && out.bundle !== undefined) {
        try {
          await deps.ledger.append({ phase: 'bundle_lists', ...base, role, at: resultRow.at, beforeListSha256: out.bundle.beforeListSha256, afterListSha256: out.bundle.afterListSha256, beforeList: { ...out.bundle.beforeList }, afterList: { ...out.bundle.afterList } });
        } catch { resultWritten = false; }
      }
      if (resultWritten) { try { await deps.ledger.append(resultRow); } catch { resultWritten = false; } }
      if (resultWritten && deps.spendLedger !== undefined) {
        const usd = typeof out.costUsdMicros === 'number' && Number.isSafeInteger(out.costUsdMicros) && out.costUsdMicros >= 0 ? out.costUsdMicros : null;
        const fact: JuliusSettlementFact = {
          taskId: `${rec.serverRunId}:${role}`,
          role: role === 'coder' ? 'CODING_AGENT' : role === 'reviewer' ? 'INDEPENDENT_REVIEWER' : 'PROMPT_ARCHITECT',
          basis: usd === null ? null : 'PROVIDER_REPORTED',
          usdMicros: usd,
          estimatedUsdMicros: null,
          billingPath: role === 'coder' ? 'API_BILLED' : null,
        };
        try { await deps.spendLedger.record(rec.serverRunId, fact); } catch { resultWritten = false; }
      }
      emit(rec, {
        type: roleFailure === null ? 'role.completed' : 'role.failed', role, phase: roleFailure === null ? 'done' : 'refused', outcome,
        responseIdTail: tailOf(scrubbedId), responseIdSha16: scrubbedId === null ? null : sha16(scrubbedId),
        usage: out.usage ?? null, failure: roleFailure,
      });
      summaries.push({
        role, outcome, responseIdTail: tailOf(scrubbedId), responseIdSha16: scrubbedId === null ? null : sha16(scrubbedId),
        usage: out.usage ?? null, spend, outputSha256: text === '' ? null : sha256(text), outputChars: text.length,
        changedPaths: role === 'coder' ? (out.changedPaths ?? null) : null, toolInvocations: role === 'coder' ? (out.toolInvocations ?? null) : null,
        shownSha256: role === 'reviewer' ? (out.shownSha256 ?? null) : null,
      });
      if (!resultWritten) {
        /* The call happened and cannot be recorded: stop the chain here; the id is in the event above for a console reconcile. */
        failure = 'ledger_write_failed_after_call'; halted = true; break;
      }
      if (roleFailure !== null) { failure = `${role}_${roleFailure}`; break; }
      if (role === 'architect') {
        architectText = text;
        const binding = deps.companion;
        if (binding !== undefined) {
          try {
            const slot = await runJuliusCompanionSlot({
              plan: text,
              runId: rec.clientRunId,
              legacyRunId: rec.serverRunId,
              deadlineMs: binding.deadlineMs,
              port: binding.port,
              clock: binding.clock,
              integrate: binding.integrate,
              validate: binding.validate,
              review: {
                review: async (artifact) => {
                  const verdict = await binding.review.review(artifact);
                  if (verdict.verdict === 'approve') companionArtifactSha = artifact.sha256;
                  return verdict;
                },
              },
            });
            emit(rec, {
              type: 'companion.recorded',
              outcome: slot.evidence.disposition,
              failure: slot.evidence.reason,
              resultSha256: slot.evidence.bodyDigest ?? undefined,
              wakeId: slot.evidence.wakeId,
              bodyDigest: slot.evidence.bodyDigest,
              artifactHashes: slot.evidence.artifactHashes,
            });
          } catch {
            emit(rec, { type: 'companion.recorded', outcome: 'failed', failure: 'companion_slot_failed' });
          }
        }
      }
      if (role === 'coder') {
        coderArtifact = text;
        coderEvidence = evidence;
        if (companionArtifactSha !== null) {
          const note = `untrusted_companion_sha256=${companionArtifactSha}`;
          coderEvidence = coderEvidence === null || coderEvidence === '' ? note : `${coderEvidence}\n${note}`;
        }
      }
      if (role === 'reviewer') verdict = out.verdict ?? null;
    }

    let checkerPass: boolean | null = null;
    let checkerOutputSha256: string | null = null;
    if (failure === null && coderArtifact !== null) {
      emit(rec, { type: 'checker.started', role: 'checker', phase: 'started' });
      try {
        const checked = await deps.checker.check({ runId: rec.runId, artifactText: coderArtifact });
        checkerPass = checked.pass === true;
        checkerOutputSha256 = sha256(checked.output ?? JSON.stringify({ pass: checkerPass }));
      } catch { checkerPass = false; checkerOutputSha256 = sha256('checker_threw'); }
      try {
        await deps.ledger.append({ phase: 'checker', ...base, role: 'checker', at: new Date(deps.now()).toISOString(), pass: checkerPass, checkerSha256: deps.frozen.checkerSha256, checkerOutputSha256 });
      } catch { failure = 'ledger_write_failed'; halted = true; }
      emit(rec, { type: 'checker.completed', role: 'checker', phase: 'done', outcome: checkerPass ? 'pass' : 'fail' });
      if (failure === null && verdict !== 'approve') failure = 'reviewer_rejected';
      if (failure === null && !checkerPass) failure = 'checker_failed';
    }

    /* The ordering rule is verified against the ledger before the verdict is sealed. */
    let orderOk = false;
    try { orderOk = verifyRunOrdering(await deps.ledger.rows(), rec.serverRunId).ok; } catch { orderOk = false; }
    if (!orderOk && failure === null) { failure = 'run_order_violation'; halted = true; }
    const state: ChainState = failure === null ? 'COMPLETED' : halted ? 'HALTED' : 'FAILED';
    const result = {
      runId: rec.runId, dispatchId: rec.dispatchId, missionId: ctx.missionId, mode: ctx.mode, state, failure,
      roles: summaries, spendUnknownLegs: unknownSpendLegs, reviewerVerdict: verdict, checkerPass,
      artifactSha256: coderArtifact === null ? null : sha256(coderArtifact), artifactText: coderArtifact,
    };
    /* The result bytes are EXACTLY this string; the client hashes the string it receives. */
    const resultText = JSON.stringify(result);
    const resultSha256 = sha256(resultText);
    rec.resultText = resultText;
    rec.resultSha256 = resultSha256;
    let finalRowWritten = true;
    try {
      /* THE FINAL ROW (role=final), shaped for the reviewer's crosscheck: resultSha256 and the checker's output hash. */
      await deps.ledger.append({
        phase: 'result', role: 'final', ...base, at: new Date(deps.now()).toISOString(), state, failure, mode: ctx.mode,
        resultSha256, resultChars: resultText.length, checkerOutputSha256, spendUnknownLegs: unknownSpendLegs, orderOk,
      });
    } catch {
      /* NOT swallowed: the roles' own rows stand, but the run has no sealed record. It surfaces as UNRECORDED (a restart orphans it). */
      finalRowWritten = false;
    }
    if (!finalRowWritten) {
      rec.state = 'UNRECORDED';
      emit(rec, { type: 'chain.final_row_failed', outcome: 'UNRECORDED', failure: 'ledger_write_failed_final_row', resultSha256 });
      log(`chain UNRECORDED final_row_unwritten run=${sha16(rec.runId)} dispatch=${rec.dispatchId} result=${resultSha256.slice(0, 16)}`);
      return;
    }
    rec.state = state;
    emit(rec, { type: state === 'COMPLETED' ? 'chain.completed' : 'chain.failed', outcome: state, failure, resultSha256 });
    log(`chain ${state} run=${sha16(rec.runId)} dispatch=${rec.dispatchId} result=${resultSha256.slice(0, 16)} mode=${ctx.mode}`);
  }

  return {
    killSwitchOn,
    whenIdle: () => running,

    issueEcho(echoInput) {
      const env = deps.env();
      if (!killSwitchOn()) return { ok: false, status: 503, code: 'julius_dispatch_disabled' };
      const founder = (env.JULIUS_J1_FOUNDER_PLAYER_ID ?? '').trim();
      if (founder === '' || echoInput.callerPlayerId !== founder) return { ok: false, status: 403, code: 'julius_dispatch_founder_only' };
      if (echoInput.projectId !== (env.JULIUS_J1_PROJECT_ID ?? '').trim()) return { ok: false, status: 403, code: 'julius_dispatch_wrong_project' };
      const at = deps.now();
      pruneEchoes(at);
      const echoId = `echo_${randomBytes(18).toString('hex')}`;
      echoes.set(echoId, at + J1_ECHO_TTL_MS);
      return { ok: true, bridgeUtc: new Date(at).toISOString(), echoId };
    },

    async recover() {
      const rows = await deps.ledger.rows();
      const orphaned: string[] = [];
      const finished: string[] = [];
      for (const start of rows.filter((row) => row.phase === 'run_start')) {
        const serverRunId = String(start.runId);
        const clientRunId = typeof start.clientRunId === 'string' && start.clientRunId !== '' ? String(start.clientRunId) : serverRunId;
        if (records.has(serverRunId)) continue;
        const final = rows.find((row) => row.phase === 'result' && row.role === 'final' && row.runId === serverRunId);
        const orphanRow = rows.find((row) => row.phase === 'orphaned' && row.runId === serverRunId);
        const rec: RunRecord = {
          presentedRunId: clientRunId, serverRunId, clientRunId, runId: clientRunId,
          dispatchId: String(start.dispatchId), projectHash: String(start.projectHash), callerHash: String(start.authorizedPlayerHash),
          keyHash: String(start.keyHash), missionId: String(start.missionId), mode: start.mode === 'live' ? 'live' : 'fake', state: 'ORPHANED', events: [], resultText: null,
          resultSha256: final === undefined ? null : String(final.resultSha256),
        };
        if (final !== undefined) { rec.state = String(final.state) as ChainState; finished.push(serverRunId); }
        else {
          if (orphanRow === undefined) await deps.ledger.append({ phase: 'orphaned', runId: serverRunId, clientRunId, dispatchId: rec.dispatchId, at: new Date(deps.now()).toISOString() });
          orphaned.push(serverRunId);
        }
        records.set(serverRunId, rec);
        records.set(clientRunId, rec);
      }
      return { orphaned, finished };
    },

    async dispatch(input) {
      const env = deps.env();
      if (!killSwitchOn()) return refuse(503, 'julius_dispatch_disabled');
      if (deps.providers === null) return refuse(503, 'julius_dispatch_providers_not_composed');
      const founder = (env.JULIUS_J1_FOUNDER_PLAYER_ID ?? '').trim();
      const project = (env.JULIUS_J1_PROJECT_ID ?? '').trim();
      const reviewerConfigured = (env.JULIUS_J1_REVIEWER_PROVIDER ?? '').trim();
      const configuredBudgetUsd = positiveNumber(env.JULIUS_J1_BUDGET_CAP_USD);
      const legEstimateUsd = positiveNumber(env.JULIUS_J1_LEG_ESTIMATE_USD);
      if (founder === '' || project === '' || reviewerConfigured === '' || configuredBudgetUsd === null || legEstimateUsd === null) return refuse(503, 'julius_dispatch_not_configured');
      let budgetCapUsd = configuredBudgetUsd;
      if (input.callerPlayerId !== founder) return refuse(403, 'julius_dispatch_founder_only');
      if (input.projectId !== project) return refuse(403, 'julius_dispatch_wrong_project');
      if (boundSession !== null && boundSession !== input.sessionId) return refuse(403, 'julius_dispatch_second_pairing');
      const { providers, frozen } = deps;
      /* D6: the reviewer provider is READ FROM CONFIG; the composed adapter must be that provider, and differ from both others. */
      if (providers.reviewer.providerId !== reviewerConfigured) return refuse(503, 'julius_dispatch_reviewer_config_mismatch');
      const ids = [providers.architect.providerId, providers.coder.providerId, providers.reviewer.providerId];
      if (new Set(ids).size !== 3) return refuse(503, 'julius_dispatch_reviewer_not_independent');
      /* D11: one code path, two labels. A fake adapter can never run live, and a real one can never run under the fake label. */
      const fakeFlags = DISPATCH_ROLES.map((role) => providers[role].fake === true);
      if (fakeFlags.some((f) => f) && !fakeFlags.every((f) => f)) return refuse(503, 'julius_dispatch_mode_mismatch');
      const mode: DispatchMode = fakeFlags.every((f) => f) ? 'fake' : 'live';
      if (deps.mode !== undefined && deps.mode !== mode) return refuse(503, 'julius_dispatch_mode_mismatch');
      /* G3-4: the composition checks are REQUIRED here, not left to the caller (independent groups AND model families, models mappable). */
      try { composeRoleProviders(providers); } catch { return refuse(503, 'julius_dispatch_providers_not_composed'); }
      if (frozenMissionProblems(frozen).length > 0) return refuse(503, 'julius_dispatch_mission_not_frozen');
      if (deps.briefSha256 === undefined ? mode === 'live' : deps.briefSha256 !== frozen.contractSha256) return refuse(503, 'julius_dispatch_brief_not_frozen_contract');
      /* R3: in live mode the KeyStore is the only key source; the legacy env read is never reachable. Refused here, before any ledger row or provider call. */
      if (mode === 'live' && deps.keyStore === undefined) return refuse(503, 'julius_dispatch_key_store_required');
      /* D-4: the composition-time check is not enough; ask the env accessor AGAIN before anything is written or called. Any value, even empty, is a key present. */
      if (mode === 'live' && DISPATCH_ROLES.some((role) => { const name = providers[role].keyEnv; return name !== null && env[name] !== undefined; })) return refuse(503, 'julius_dispatch_provider_key_in_env');
      if (!isAdmittedRunId(input.runId)) return refuse(400, 'julius_dispatch_run_invalid');
      if (deps.claims === undefined) return refuse(503, 'julius_dispatch_admission_required');

      const callerHash = sha16(input.callerPlayerId);
      const keyHash = sha16(input.idempotencyKey);
      /* D7, in memory: the same key for the same run replays (no second chain, no new pre_call); anything else for a known run is refused. */
      const existing = records.get(input.runId);
      if (existing !== undefined) {
        if (existing.callerHash === callerHash && existing.keyHash === keyHash) {
          return { ok: true, status: 200, dispatchId: existing.dispatchId, runId: input.runId, state: existing.state, replayed: true, ledgerRef: `julius-j1-ledger:${existing.dispatchId}`, mode: existing.mode };
        }
        /* The CREATOR of a run is the (player, key) that created it; anyone else is refused by name. */
        return refuse(403, 'julius_dispatch_run_creator_mismatch');
      }
      /* D7: a key already used by ANOTHER run (a different mission instance) is refused, whatever the run id. */
      for (const rec of records.values()) if (rec.keyHash === keyHash) return refuse(409, 'julius_dispatch_key_reused');

      const run = await deps.runs.lookup({ projectId: input.projectId, runId: input.runId }).catch(() => 'unavailable' as const);
      if (run === 'unavailable') return refuse(503, 'julius_dispatch_run_lookup_unavailable');
      if (run === null) return refuse(404, 'julius_dispatch_run_not_found');
      if (run.missionId !== frozen.missionId || run.contractSha256 !== frozen.contractSha256) return refuse(409, 'julius_dispatch_mission_not_frozen_mission');
      if (run.state !== 'READY') return refuse(409, 'julius_dispatch_run_not_ready');
      const admitted = await deps.claims.read(input.runId);
      if (admitted === null) return refuse(404, 'julius_dispatch_run_not_admitted');
      if (
        (input.runId !== admitted.clientRunId && input.runId !== admitted.serverRunId)
        || admitted.missionId !== frozen.missionId
      ) return refuse(409, 'julius_dispatch_run_mismatch');

      /* Concurrency: taken SYNCHRONOUSLY (no await since this check), before the reservation. */
      if (inFlight) return refuse(429, 'julius_dispatch_busy');
      inFlight = true;
      let started = false;
      try {
        const dailyCap = positiveInt(env.JULIUS_J1_DAILY_CAP, J1_DEFAULT_DAILY_CAP);
        const missionCap = positiveInt(env.JULIUS_J1_MAX_RUNS_PER_MISSION, J1_DEFAULT_MAX_RUNS_PER_MISSION);
        const dispatchId = newId();
        const at = deps.now();
        /* UI-action < run_created: the client's claimed UI time must parse, and must precede the bridge's own clock reading. */
        const uiMs = UTC_ISO.test(input.clientUiActionUtc ?? '') ? Date.parse(input.clientUiActionUtc) : Number.NaN;
        if (!Number.isFinite(uiMs) || !(uiMs < at)) return refuse(409, 'julius_dispatch_run_order_violation');
        const reserved = await locked(async (): Promise<DispatchOutcome | 'reserved'> => {
          const allRows = await deps.ledger.rows();
          const rows = allRows.filter((row) => row.phase === 'run_start');
          const samePair = (row: DispatchRow): boolean => row.runId === admitted.serverRunId || row.clientRunId === admitted.clientRunId || row.runId === admitted.clientRunId;
          const createdRow = allRows.find((row) => row.phase === 'run_created' && samePair(row));
          if (createdRow !== undefined && (createdRow.creatorPlayerHash !== callerHash || createdRow.creatorKeyHash !== keyHash)) return refuse(403, 'julius_dispatch_run_creator_mismatch');
          if (createdRow !== undefined || rows.some(samePair)) return refuse(409, 'julius_dispatch_already_dispatched');
          if (admitted.idempotencyKey !== input.idempotencyKey) return refuse(409, 'julius_dispatch_run_mismatch');
          if (rows.some((row) => row.keyHash === keyHash)) return refuse(409, 'julius_dispatch_key_reused');
          /* A REFUSED attempt (run_refused) counts against the daily cap exactly like a started run. */
          const dayCount = allRows.filter((row) => (row.phase === 'run_start' || row.phase === 'run_refused') && String(row.at).slice(0, 10) === utcDay(at)).length;
          if (dayCount >= dailyCap) return refuse(429, 'julius_dispatch_cap_reached');
          if (rows.filter((row) => row.missionId === frozen.missionId).length >= missionCap) return refuse(429, 'julius_dispatch_mission_cap_reached');
          /* CLOCK BINDING: the echo is single use (consumed here whatever the verdict), unexpired and one this bridge issued. */
          const offsetOk = typeof input.clientOffsetMs === 'number' && Number.isFinite(input.clientOffsetMs);
          const echoGiven = typeof input.echoId === 'string' && input.echoId !== '';
          const expiry = echoGiven ? echoes.get(input.echoId as string) : undefined;
          if (echoGiven) echoes.delete(input.echoId as string);
          const echoLive = expiry !== undefined && expiry > at;
          const clockRefusal: { status: number; code: string } | null =
            mode === 'live' && (!offsetOk || !echoGiven) ? { status: 400, code: 'julius_dispatch_clock_binding_required' }
              : echoGiven && !echoLive ? { status: 409, code: 'julius_dispatch_clock_echo_unknown' }
                : offsetOk && Math.abs(input.clientOffsetMs as number) > J1_MAX_CLOCK_OFFSET_MS ? { status: 409, code: 'julius_dispatch_clock_offset_out_of_range' }
                  : null;
          if (clockRefusal !== null) {
            await deps.ledger.append({
              phase: 'run_refused', status: 'REFUSED', code: clockRefusal.code, runId: input.runId, dispatchId, mode, creatorPlayerHash: callerHash, creatorKeyHash: keyHash,
              clientOffsetMs: offsetOk ? (input.clientOffsetMs as number) : null, echoId: echoGiven ? (input.echoId as string) : null, at: new Date(at).toISOString(),
            });
            log(`refused run=${sha16(input.runId)} code=${clockRefusal.code} mode=${mode}`);
            return refuse(clockRefusal.status, clockRefusal.code);
          }
          const ledgerRead = deps.spendLedger === undefined
            ? { readable: false as const }
            : await deps.spendLedger.readPrior({ missionId: frozen.markerNamespace ?? frozen.missionId, projectId: input.projectId, excludeRunId: admitted.serverRunId });
          const decision = preSpendDecision({
            markerNamespace: frozen.markerNamespace ?? null,
            spendUsd: frozen.spendUsd ?? null,
            repairCycles: frozen.repairCycles ?? null,
            ledger: ledgerRead,
          });
          if (decision.applicable && decision.authorized === false) {
            const mapped = spendRefusalCode(decision.reasonCode);
            await deps.ledger.append({
              phase: 'run_refused', status: 'REFUSED', code: mapped.code, runId: admitted.serverRunId, clientRunId: admitted.clientRunId,
              dispatchId, mode, creatorPlayerHash: callerHash, creatorKeyHash: keyHash, at: new Date(at).toISOString(),
            });
            return refuse(mapped.status, mapped.code);
          }
          if (decision.applicable && decision.authorized) {
            const grantedUsd = decision.spendCeilingUsdMicros / 1_000_000;
            if (grantedUsd < budgetCapUsd) budgetCapUsd = grantedUsd;
          }
          /* Live adapters are not called here. The paid path is the gated workflow. The admission stays unclaimed. */
          if (mode === 'live') return refuse(503, 'julius_dispatch_paid_path_is_workflow');
          const claimed = await deps.claims!.claim(admitted);
          if (!claimed.ok) {
            const code = claimed.reason === 'already_terminal' ? 'julius_dispatch_already_terminal'
              : claimed.reason === 'mismatch' ? 'julius_dispatch_run_mismatch'
                : 'julius_dispatch_run_not_admitted';
            return refuse(claimed.reason === 'not_admitted' ? 404 : 409, code);
          }
          if (claimed.replayed) return refuse(409, 'julius_dispatch_already_dispatched');
          /* RUN_CREATED keys on the server run id. The client id is stored beside it. */
          await deps.ledger.append({
            phase: 'run_created', runId: admitted.serverRunId, clientRunId: admitted.clientRunId, dispatchId, creatorPlayerHash: callerHash, creatorKeyHash: keyHash,
            uiActionUtc: input.clientUiActionUtc, clientTriggerId: input.clientTriggerId, clientLogSha256: input.clientLogSha256, at: new Date(at).toISOString(),
            clientOffsetMs: offsetOk ? (input.clientOffsetMs as number) : null, echoId: echoGiven ? (input.echoId as string) : null,
          });
          /* THE RUN_START ROW precedes every pre_call row. Its write is the commit point. */
          await deps.ledger.append({
            phase: 'run_start', dispatchId, runId: admitted.serverRunId, clientRunId: admitted.clientRunId, missionId: frozen.missionId, frozenSha256: frozen.contractSha256,
            contractSha256: frozen.contractSha256, briefSha256: deps.briefSha256 ?? null, checkerSha256: frozen.checkerSha256, preregId: frozen.preregId,
            budgetCapUsd, legEstimateUsd, authorizedPlayerHash: callerHash, mode, at: new Date(at).toISOString(),
            projectHash: sha16(input.projectId), sessionHash: sha16(input.sessionId), keyHash,
            clientTriggerId: input.clientTriggerId, clientLogSha256: input.clientLogSha256,
            runOrdinal: rows.filter((row) => row.missionId === frozen.missionId).length + 1,
            architectProvider: providers.architect.providerId, coderProvider: providers.coder.providerId, reviewerProvider: providers.reviewer.providerId,
          });
          return 'reserved';
        }).catch((): DispatchOutcome => refuse(503, 'julius_dispatch_ledger_unavailable'));
        if (reserved !== 'reserved') return reserved;

        boundSession = input.sessionId;
        const rec: RunRecord = {
          presentedRunId: input.runId, serverRunId: admitted.serverRunId, clientRunId: admitted.clientRunId, runId: input.runId,
          dispatchId, projectHash: sha16(input.projectId), callerHash, keyHash, missionId: frozen.missionId, mode, state: 'ACCEPTED',
          events: [], resultText: null, resultSha256: null,
        };
        records.set(admitted.serverRunId, rec);
        records.set(admitted.clientRunId, rec);
        records.set(input.runId, rec);
        emit(rec, { type: 'chain.accepted' });
        log(`accepted run=${sha16(input.runId)} dispatch=${dispatchId} key=${keyHash} mode=${mode} reviewer=${providers.reviewer.providerId}`);
        started = true;
        running = runChain(rec, { missionId: frozen.missionId, budgetCapUsd, legEstimateUsd, mode })
          .catch(() => { rec.state = 'FAILED'; emit(rec, { type: 'chain.failed', outcome: 'FAILED', failure: 'internal_error' }); })
          .finally(() => { inFlight = false; });
        return { ok: true, status: 202, dispatchId, runId: input.runId, state: 'ACCEPTED', replayed: false, ledgerRef: `julius-j1-ledger:${dispatchId}`, mode };
      } finally {
        if (!started) inFlight = false;
      }
    },

    events(input) {
      const rec = records.get(input.runId);
      if (rec === undefined || rec.projectHash !== sha16(input.projectId) || rec.callerHash !== sha16(input.callerPlayerId)) {
        return { status: 404, body: { error: { kind: 'julius_dispatch_run_unknown', message: 'No dispatched run with that id on this bridge.' } } };
      }
      const page = rec.events.filter((event) => event.sequence > input.cursor).slice(0, J1_EVENTS_PAGE_LIMIT);
      const nextCursor = page.length === 0 ? input.cursor : page[page.length - 1].sequence;
      return { status: 200, body: { data: { runId: input.runId, serverRunId: rec.serverRunId, state: rec.state, mode: rec.mode, events: page, nextCursor, terminal: TERMINAL.includes(rec.state) && nextCursor >= rec.events.length } } };
    },

    result(input) {
      const rec = records.get(input.runId);
      if (rec === undefined || rec.projectHash !== sha16(input.projectId) || rec.callerHash !== sha16(input.callerPlayerId)) {
        return { status: 404, body: { error: { kind: 'julius_dispatch_run_unknown', message: 'No dispatched run with that id on this bridge.' } } };
      }
      if (rec.state === 'ORPHANED') {
        return { status: 409, body: { error: { kind: 'julius_dispatch_run_orphaned', message: 'The bridge restarted during this run; it is not resumed.' } } };
      }
      if (rec.state === 'UNRECORDED') {
        return { status: 409, body: { error: { kind: 'julius_dispatch_final_row_unwritten', message: 'The chain ended but its final ledger row could not be written.', detail: { resultSha256: rec.resultSha256 } } } };
      }
      if (rec.resultText === null && rec.resultSha256 !== null) {
        return { status: 410, body: { error: { kind: 'julius_dispatch_result_lost_on_restart', message: 'The result text did not survive a restart.', detail: { resultSha256: rec.resultSha256 } } } };
      }
      if (rec.resultText === null || rec.resultSha256 === null) {
        return { status: 409, body: { error: { kind: 'julius_dispatch_result_not_ready', message: 'The chain has not finished.' } } };
      }
      return { status: 200, body: { data: { runId: input.runId, serverRunId: rec.serverRunId, state: rec.state, mode: rec.mode, resultText: rec.resultText, resultSha256: rec.resultSha256 } } };
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* HTTP edge                                                                                                        */

export const JULIUS_DISPATCH_PATH = '/wonderland/julius/dispatch';
export const JULIUS_DISPATCH_EVENTS_PATH = '/wonderland/julius/dispatch/events';
export const JULIUS_DISPATCH_RESULT_PATH = '/wonderland/julius/dispatch/result';
export const JULIUS_DISPATCH_ECHO_PATH = '/wonderland/julius/dispatch/echo';
export const isJuliusDispatchRoute = (path: string): boolean =>
  path === JULIUS_DISPATCH_PATH || path === JULIUS_DISPATCH_EVENTS_PATH || path === JULIUS_DISPATCH_RESULT_PATH || path === JULIUS_DISPATCH_ECHO_PATH;

export interface JuliusDispatchRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  /** Request URL with `/relay-api` already stripped (query included). */
  readonly url: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly rawBody: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly now: number;
  readonly operatorToken: string | undefined;
  /** `req.socket.remoteAddress`. */
  readonly remoteAddress: string | undefined;
  /** The Host header. */
  readonly host: string | undefined;
  /** True when ANY of x-forwarded-for / x-forwarded-host / forwarded / x-real-ip is present. */
  readonly forwarded: boolean;
}
export interface JuliusDispatchRoutePorts {
  readonly dispatch: JuliusDispatchController;
  readonly verifyNativeSession: (input: { token: string; now: number }) => { playerId: string; projectId: string; sessionId: string } | null;
}

const err = (status: number, kind: string, message: string) => ({ status, body: { error: { kind, message } } });

export function isLoopbackPeer(remoteAddress: string | undefined, host: string | undefined, forwarded: boolean): boolean {
  if (forwarded) return false;
  if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') return false;
  if (host === undefined) return false;
  const name = host.trim().toLowerCase().replace(/:\d+$/, '');
  return name === '127.0.0.1' || name === 'localhost' || name === '[::1]';
}

/**
 * RID-6 client run id. `wlj_` plus a canonical lowercase UUIDv4.
 * The server validates this. It does not mint a substitute.
 */
export const J1_CLIENT_RUN_ID = /^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isClientMintedRunId(value: string): boolean {
  return J1_CLIENT_RUN_ID.test(value);
}

const TRIGGER_ID = /^[A-Za-z0-9_-]{8,64}$/;
const KEY = /^[A-Za-z0-9_-]{8,80}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export async function handleJuliusDispatchRoute(
  request: JuliusDispatchRouteRequest,
  ports: JuliusDispatchRoutePorts,
): Promise<{ status: number; body: unknown }> {
  if (!isLoopbackPeer(request.remoteAddress, request.host, request.forwarded)) {
    return err(403, 'julius_dispatch_not_loopback', 'Mission dispatch is only served to the same machine.');
  }
  const isDispatch = request.path === JULIUS_DISPATCH_PATH;
  if (isDispatch && !ports.dispatch.killSwitchOn()) return err(503, 'julius_dispatch_disabled', 'Mission dispatch is switched off.');
  if (request.origin !== undefined) return err(403, 'julius_dispatch_browser_refused', 'Only the paired game client may use this route.');
  /* The operator bearer is a shell credential: it can never stand in for the game. */
  if (bearerMatches(request.authorization, request.operatorToken)) {
    return err(403, 'julius_dispatch_operator_is_not_the_game', 'The in-game trigger must come from the paired game client.');
  }
  const token = sessionTokenFrom(request.authorization);
  const native = token === null ? null : ports.verifyNativeSession({ token, now: request.now });
  if (native === null) return err(401, 'sign_in_required', 'Mission dispatch needs a paired Wonderland session.');

  const query = new URL(request.url, 'http://relay.invalid').searchParams;
  const projectId = query.get('projectId') ?? '';
  if (projectId === '' || native.projectId !== projectId) return err(403, 'julius_dispatch_wrong_project', 'This session was not paired for that project.');

  if (!isDispatch) {
    if (request.method !== 'GET') return err(405, 'method_not_allowed', 'Reading a dispatched run is a GET.');
    if (request.path === JULIUS_DISPATCH_ECHO_PATH) {
      const echo = ports.dispatch.issueEcho({ projectId, callerPlayerId: native.playerId });
      return echo.ok ? { status: 200, body: { data: { bridgeUtc: echo.bridgeUtc, echoId: echo.echoId } } } : err(echo.status, echo.code, 'Julius could not issue a clock echo.');
    }
    const runId = query.get('runId') ?? '';
    if (!isAdmittedRunId(runId)) return err(400, 'julius_dispatch_run_invalid', 'runId must be the admitted wlj_ id or the admitted run: id.');
    if (request.path === JULIUS_DISPATCH_RESULT_PATH) {
      return ports.dispatch.result({ projectId, runId, callerPlayerId: native.playerId });
    }
    const rawCursor = query.get('cursor');
    const cursor = rawCursor === null ? 0 : Number(rawCursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0) return err(400, 'julius_dispatch_cursor_invalid', 'cursor must be a whole number.');
    return ports.dispatch.events({ projectId, runId, callerPlayerId: native.playerId, cursor });
  }

  if (request.method !== 'POST') return err(405, 'method_not_allowed', 'Dispatch is a POST.');
  if (request.idempotencyKey === undefined || !KEY.test(request.idempotencyKey)) return err(400, 'julius_dispatch_idempotency_key_invalid', 'x-relay-idempotency-key is required.');
  let body: { runId?: unknown; clientTriggerId?: unknown; clientLogSha256?: unknown; clientUiActionUtc?: unknown; clientOffsetMs?: unknown; echoId?: unknown } | null = null;
  try { body = JSON.parse(request.rawBody ?? '') as typeof body; } catch { body = null; }
  if (body === null || typeof body !== 'object') return err(400, 'julius_dispatch_body_invalid', 'The body must be JSON.');
  const { runId, clientTriggerId, clientLogSha256, clientUiActionUtc, clientOffsetMs, echoId } = body;
  if (typeof runId !== 'string' || !isAdmittedRunId(runId)) return err(400, 'julius_dispatch_run_invalid', 'runId must be the admitted wlj_ id or the admitted run: id.');
  /* THE GAME-ORIGIN BINDING: no hash of a client log line, no dispatch. */
  if (typeof clientTriggerId !== 'string' || !TRIGGER_ID.test(clientTriggerId) || typeof clientLogSha256 !== 'string' || !HEX64.test(clientLogSha256)
    || typeof clientUiActionUtc !== 'string' || !UTC_ISO.test(clientUiActionUtc) || !Number.isFinite(Date.parse(clientUiActionUtc))) {
    return err(400, 'julius_dispatch_client_log_binding_required', 'clientTriggerId, clientLogSha256 (the hash of the client log line written before this request) and clientUiActionUtc are required.');
  }
  /* Optional in code, required in live (the controller decides by mode); a present value must still have the right type. */
  if ((clientOffsetMs !== undefined && (typeof clientOffsetMs !== 'number' || !Number.isFinite(clientOffsetMs))) || (echoId !== undefined && (typeof echoId !== 'string' || (echoId as string).length > 128))) {
    return err(400, 'julius_dispatch_clock_binding_invalid', 'clientOffsetMs must be a number and echoId a string.');
  }
  const outcome = await ports.dispatch.dispatch({
    projectId, runId, callerPlayerId: native.playerId, sessionId: native.sessionId,
    idempotencyKey: request.idempotencyKey, clientTriggerId, clientLogSha256, clientUiActionUtc,
    ...(clientOffsetMs === undefined ? {} : { clientOffsetMs }), ...(echoId === undefined ? {} : { echoId }),
  });
  if (!outcome.ok) return err(outcome.status, outcome.code, 'Julius could not dispatch this run.');
  return {
    status: outcome.status,
    body: { data: { runId: outcome.runId, dispatchId: outcome.dispatchId, state: outcome.state, replayed: outcome.replayed, ledgerRef: outcome.ledgerRef, mode: outcome.mode } },
  };
}

/**
 * THE COMPOSITION THE BRIDGE SHIPS TODAY: no provider adapters, no ledger, no run lookup. It answers the kill-switch refusal when
 * the switch is off and `julius_dispatch_providers_not_composed` when it is on, so mounting the route in server.ts changes nothing
 * until a reviewed composition (real adapters, the frozen mission, the file ledger) replaces this one.
 */
export function createUncomposedJuliusDispatch(env: () => Record<string, string | undefined>, now: () => number = Date.now): JuliusDispatchController {
  const unavailable = async (): Promise<never> => { throw new Error('julius dispatch is not composed'); };
  return createJuliusDispatch({
    providers: null,
    runs: { lookup: unavailable },
    frozen: { missionId: '', contractSha256: '', checkerSha256: '', missionAuthor: '', checkerAuthor: '', seededDefect: false, preregId: '' },
    checker: { check: unavailable },
    ledger: { append: unavailable, rows: unavailable },
    env,
    now,
  });
}
