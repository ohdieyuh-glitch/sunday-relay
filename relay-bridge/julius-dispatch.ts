import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { bearerMatches } from './bearer-auth';
import { sessionTokenFrom } from './browser-session/routes';

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
 *   7. caps (daily, per-mission runs, one run once) and concurrency (exactly one chain at a time)
 *   8. a ledger that cannot be written: the acceptance row, every pre_call row. NO row = NO provider call.
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
  /** REVIEWER: sha256 over everything the reviewer was shown, so a verdict can be tied to what was judged. Present on a failed leg that got that far. */
  readonly shownSha256?: string | null;
  /** REVIEWER: the verdict the reviewer returned. */
  readonly verdict?: 'approve' | 'reject';
  /** How many provider HTTP requests sit behind THIS response id (a Hermes tool loop can be several). Null/absent = adapter cannot say. Ledgered for the console request-count check (xAI 12 vs 3). */
  readonly requests?: number | null;
  /** False = the adapter refused BEFORE any request left (nothing could have been billed). Absent = unknown/contacted. */
  readonly providerContacted?: false;
  /** Provider- or session-reported cost in USD micros, when it gave one. Never inferred, never a price list. */
  readonly costUsdMicros?: number | null;
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
}
export type ChainState = 'ACCEPTED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'HALTED' | 'ORPHANED';
const TERMINAL: readonly ChainState[] = ['COMPLETED', 'FAILED', 'HALTED', 'ORPHANED'];

export type DispatchMode = 'live' | 'fake';

interface RunRecord {
  readonly runId: string;
  readonly dispatchId: string;
  readonly projectHash: string;
  readonly callerHash: string;
  readonly keyHash: string;
  readonly missionId: string;
  state: ChainState;
  readonly events: ChainEvent[];
  resultText: string | null;
  resultSha256: string | null;
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const sha16 = (value: string): string => sha256(value).slice(0, 16);
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const tailOf = (id: string | null): string | null => (id === null ? null : id.slice(-8));

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
  /** `fake` = the zero-spend rehearsal build on the IDENTICAL code path (D11); labelled in every row and on the wire, never countable. */
  readonly mode: DispatchMode;
  /** Read at every use: the kill switch is re-read before every role, so flipping it halts a running chain at the next role. */
  readonly env: () => Record<string, string | undefined>;
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
}
export type DispatchOutcome =
  | { readonly ok: true; readonly status: 202 | 200; readonly dispatchId: string; readonly runId: string; readonly state: ChainState; readonly replayed: boolean; readonly ledgerRef: string; readonly mode: DispatchMode }
  | { readonly ok: false; readonly status: number; readonly code: string };

export interface JuliusDispatchController {
  dispatch(input: DispatchInput): Promise<DispatchOutcome>;
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

  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = reservationChain.then(fn, fn);
    reservationChain = run.then(() => undefined, () => undefined);
    return run;
  };

  const emit = (rec: RunRecord, event: Omit<ChainEvent, 'sequence' | 'at'>): void => {
    rec.events.push({ sequence: rec.events.length + 1, at: new Date(deps.now()).toISOString(), ...event });
  };

  async function runChain(rec: RunRecord, ctx: { readonly missionId: string; readonly budgetCapUsd: number; readonly legEstimateUsd: number }): Promise<void> {
    const providers = deps.providers as DispatchProviders;
    const base = { dispatchId: rec.dispatchId, runId: rec.runId };
    const env = deps.env();
    const secrets = DISPATCH_ROLES.map((role) => {
      const name = providers[role].keyEnv;
      return name === null ? '' : (env[name] ?? '').trim();
    }).filter((value) => value !== '');
    const timeoutMs = positiveInt(env.JULIUS_J1_ROLE_TIMEOUT_MS, J1_DEFAULT_ROLE_TIMEOUT_MS);
    const summaries: Record<string, unknown>[] = [];
    let architectText: string | null = null;
    let coderArtifact: string | null = null;
    let coderEvidence: string | null = null;
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
      const apiKey = provider.keyEnv === null ? '' : (deps.env()[provider.keyEnv] ?? '').trim();
      if (provider.keyEnv !== null && apiKey === '') { failure = 'provider_key_missing'; break; }
      /* THE ROW BEFORE THE CALL, fsynced by the ledger. A pre_call row that cannot be written means NO provider call. */
      try {
        await deps.ledger.append({
          phase: 'pre_call', ...base, role, provider: provider.providerId, model: provider.model, keyHash: rec.keyHash, playerHash: rec.callerHash,
          mode: deps.mode, attempt: 1, at: new Date(deps.now()).toISOString(),
        });
      } catch {
        failure = 'ledger_write_failed'; halted = true; break;
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
      const scrubbed = scrubKeys(out.text, secrets);
      const text = role === 'coder' ? scrubbed.trim() : scrubbed;
      const responseId = out.responseId === null ? null : scrubKeys(out.responseId, secrets);
      const echoedModel = out.model === null ? null : scrubKeys(out.model, secrets);
      let roleFailure: string | null = null;
      if (!out.ok) roleFailure = out.failureClass ?? 'provider_failed';
      /* THE IDENTITY OF EVERY LEG: a successful leg with no provider response id or no provider-echoed model cannot be tied to a
         console row and is not accepted (the reviewer found response_id empty on every INDEPENDENT_REVIEWER row). */
      else if (responseId === null || responseId.trim() === '' || echoedModel === null || echoedModel.trim() === '') roleFailure = 'response_identity_missing';
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
        providerResponseId: responseId, model: echoedModel, mode: deps.mode,
        usage: out.usage === undefined ? null : { input: out.usage.input, output: out.usage.output, total: out.usage.total },
        requests: out.requests ?? null,
        spend, spendUnknown: spend === 'spend_unknown', costUsdMicros: out.costUsdMicros ?? null,
        outputSha256: text === '' ? null : sha256(text), outputChars: text.length,
        changedPaths: role === 'coder' ? (out.changedPaths ?? null) : null,
        toolInvocations: role === 'coder' ? (out.toolInvocations ?? null) : null,
        evidenceSha256: role === 'coder' && evidence !== null ? sha256(evidence) : null,
        evidenceChars: role === 'coder' && evidence !== null ? evidence.length : null,
        shownSha256: role === 'reviewer' ? (out.shownSha256 ?? null) : null,
        verdict: role === 'reviewer' ? (out.verdict ?? null) : null,
        attempts: 1,
      };
      let resultWritten = true;
      try { await deps.ledger.append(resultRow); } catch { resultWritten = false; }
      emit(rec, {
        type: roleFailure === null ? 'role.completed' : 'role.failed', role, phase: roleFailure === null ? 'done' : 'refused', outcome,
        responseIdTail: tailOf(responseId), responseIdSha16: responseId === null ? null : sha16(responseId),
        usage: out.usage ?? null, failure: roleFailure,
      });
      summaries.push({
        role, outcome, responseIdTail: tailOf(responseId), responseIdSha16: responseId === null ? null : sha16(responseId),
        usage: out.usage ?? null, spend, outputSha256: text === '' ? null : sha256(text), outputChars: text.length,
        changedPaths: role === 'coder' ? (out.changedPaths ?? null) : null, toolInvocations: role === 'coder' ? (out.toolInvocations ?? null) : null,
        shownSha256: role === 'reviewer' ? (out.shownSha256 ?? null) : null,
      });
      if (!resultWritten) {
        /* The call happened and cannot be recorded: stop the chain here; the id is in the event above for a console reconcile. */
        failure = 'ledger_write_failed_after_call'; halted = true; break;
      }
      if (roleFailure !== null) { failure = `${role}_${roleFailure}`; break; }
      if (role === 'architect') architectText = text;
      if (role === 'coder') { coderArtifact = text; coderEvidence = evidence; }
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

    const state: ChainState = failure === null ? 'COMPLETED' : halted ? 'HALTED' : 'FAILED';
    const result = {
      runId: rec.runId, dispatchId: rec.dispatchId, missionId: ctx.missionId, mode: deps.mode, state, failure,
      roles: summaries, spendUnknownLegs: unknownSpendLegs, reviewerVerdict: verdict, checkerPass,
      artifactSha256: coderArtifact === null ? null : sha256(coderArtifact), artifactText: coderArtifact,
    };
    /* The result bytes are EXACTLY this string; the client hashes the string it receives. */
    const resultText = JSON.stringify(result);
    const resultSha256 = sha256(resultText);
    rec.resultText = resultText;
    rec.resultSha256 = resultSha256;
    try {
      /* THE FINAL ROW (role=final), shaped for the reviewer's crosscheck: resultSha256 and the checker's output hash. */
      await deps.ledger.append({
        phase: 'result', role: 'final', ...base, at: new Date(deps.now()).toISOString(), state, failure, mode: deps.mode,
        resultSha256, resultChars: resultText.length, checkerOutputSha256, spendUnknownLegs: unknownSpendLegs,
      });
    } catch {
      /* Terminal anyway; the roles' own rows already stand. A missing final row makes the run an orphan at the next start. */
    }
    rec.state = state;
    emit(rec, { type: state === 'COMPLETED' ? 'chain.completed' : 'chain.failed', outcome: state, failure, resultSha256 });
    log(`chain ${state} run=${sha16(rec.runId)} dispatch=${rec.dispatchId} result=${resultSha256.slice(0, 16)} mode=${deps.mode}`);
  }

  return {
    killSwitchOn,
    whenIdle: () => running,

    async recover() {
      const rows = await deps.ledger.rows();
      const orphaned: string[] = [];
      const finished: string[] = [];
      for (const start of rows.filter((row) => row.phase === 'run_start')) {
        const runId = String(start.runId);
        if (records.has(runId)) continue;
        const final = rows.find((row) => row.phase === 'result' && row.role === 'final' && row.runId === runId);
        const orphanRow = rows.find((row) => row.phase === 'orphaned' && row.runId === runId);
        const rec: RunRecord = {
          runId, dispatchId: String(start.dispatchId), projectHash: String(start.projectHash), callerHash: String(start.authorizedPlayerHash),
          keyHash: String(start.keyHash), missionId: String(start.missionId), state: 'ORPHANED', events: [], resultText: null,
          resultSha256: final === undefined ? null : String(final.resultSha256),
        };
        if (final !== undefined) { rec.state = String(final.state) as ChainState; finished.push(runId); }
        else {
          if (orphanRow === undefined) await deps.ledger.append({ phase: 'orphaned', runId, dispatchId: rec.dispatchId, at: new Date(deps.now()).toISOString() });
          orphaned.push(runId);
        }
        records.set(runId, rec);
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
      const budgetCapUsd = positiveNumber(env.JULIUS_J1_BUDGET_CAP_USD);
      const legEstimateUsd = positiveNumber(env.JULIUS_J1_LEG_ESTIMATE_USD);
      if (founder === '' || project === '' || reviewerConfigured === '' || budgetCapUsd === null || legEstimateUsd === null) return refuse(503, 'julius_dispatch_not_configured');
      if (input.callerPlayerId !== founder) return refuse(403, 'julius_dispatch_founder_only');
      if (input.projectId !== project) return refuse(403, 'julius_dispatch_wrong_project');
      if (boundSession !== null && boundSession !== input.sessionId) return refuse(403, 'julius_dispatch_second_pairing');
      const { providers, frozen } = deps;
      /* D6: the reviewer provider is READ FROM CONFIG; the composed adapter must be that provider, and differ from both others. */
      if (providers.reviewer.providerId !== reviewerConfigured) return refuse(503, 'julius_dispatch_reviewer_config_mismatch');
      const ids = [providers.architect.providerId, providers.coder.providerId, providers.reviewer.providerId];
      if (new Set(ids).size !== 3) return refuse(503, 'julius_dispatch_reviewer_not_independent');
      /* D11: one code path, two labels. A fake adapter can never run live, and a real one can never run under the fake label. */
      if (DISPATCH_ROLES.some((role) => providers[role].fake !== (deps.mode === 'fake'))) return refuse(503, 'julius_dispatch_mode_mismatch');
      if (frozenMissionProblems(frozen).length > 0) return refuse(503, 'julius_dispatch_mission_not_frozen');

      const callerHash = sha16(input.callerPlayerId);
      const keyHash = sha16(input.idempotencyKey);
      /* D7, in memory: the same key for the same run replays (no second chain, no new pre_call); anything else for a known run is refused. */
      const existing = records.get(input.runId);
      if (existing !== undefined) {
        if (existing.callerHash === callerHash && existing.keyHash === keyHash) {
          return { ok: true, status: 200, dispatchId: existing.dispatchId, runId: existing.runId, state: existing.state, replayed: true, ledgerRef: `julius-j1-ledger:${existing.dispatchId}`, mode: deps.mode };
        }
        return refuse(409, 'julius_dispatch_already_dispatched');
      }
      /* D7: a key already used by ANOTHER run (a different mission instance) is refused, whatever the run id. */
      for (const rec of records.values()) if (rec.keyHash === keyHash) return refuse(409, 'julius_dispatch_key_reused');

      const run = await deps.runs.lookup({ projectId: input.projectId, runId: input.runId }).catch(() => 'unavailable' as const);
      if (run === 'unavailable') return refuse(503, 'julius_dispatch_run_lookup_unavailable');
      if (run === null) return refuse(404, 'julius_dispatch_run_not_found');
      if (run.missionId !== frozen.missionId || run.contractSha256 !== frozen.contractSha256) return refuse(409, 'julius_dispatch_mission_not_frozen_mission');
      if (run.state !== 'READY') return refuse(409, 'julius_dispatch_run_not_ready');

      /* Concurrency: taken SYNCHRONOUSLY (no await since this check), before the reservation. */
      if (inFlight) return refuse(429, 'julius_dispatch_busy');
      inFlight = true;
      let started = false;
      try {
        const dailyCap = positiveInt(env.JULIUS_J1_DAILY_CAP, J1_DEFAULT_DAILY_CAP);
        const missionCap = positiveInt(env.JULIUS_J1_MAX_RUNS_PER_MISSION, J1_DEFAULT_MAX_RUNS_PER_MISSION);
        const dispatchId = newId();
        const at = deps.now();
        const reserved = await locked(async (): Promise<DispatchOutcome | 'reserved'> => {
          const rows = (await deps.ledger.rows()).filter((row) => row.phase === 'run_start');
          if (rows.some((row) => row.runId === input.runId)) return refuse(409, 'julius_dispatch_already_dispatched');
          if (rows.some((row) => row.keyHash === keyHash)) return refuse(409, 'julius_dispatch_key_reused');
          if (rows.filter((row) => String(row.at).slice(0, 10) === utcDay(at)).length >= dailyCap) return refuse(429, 'julius_dispatch_cap_reached');
          if (rows.filter((row) => row.missionId === frozen.missionId).length >= missionCap) return refuse(429, 'julius_dispatch_mission_cap_reached');
          /* THE RUN_START ROW precedes every pre_call row. Its write is the commit point. */
          await deps.ledger.append({
            phase: 'run_start', dispatchId, runId: input.runId, missionId: frozen.missionId, frozenSha256: frozen.contractSha256,
            contractSha256: frozen.contractSha256, checkerSha256: frozen.checkerSha256, preregId: frozen.preregId,
            budgetCapUsd, legEstimateUsd, authorizedPlayerHash: callerHash, mode: deps.mode, at: new Date(at).toISOString(),
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
          runId: input.runId, dispatchId, projectHash: sha16(input.projectId), callerHash, keyHash, missionId: frozen.missionId, state: 'ACCEPTED',
          events: [], resultText: null, resultSha256: null,
        };
        records.set(input.runId, rec);
        emit(rec, { type: 'chain.accepted' });
        log(`accepted run=${sha16(input.runId)} dispatch=${dispatchId} key=${keyHash} mode=${deps.mode} reviewer=${providers.reviewer.providerId}`);
        started = true;
        running = runChain(rec, { missionId: frozen.missionId, budgetCapUsd, legEstimateUsd })
          .catch(() => { rec.state = 'FAILED'; emit(rec, { type: 'chain.failed', outcome: 'FAILED', failure: 'internal_error' }); })
          .finally(() => { inFlight = false; });
        return { ok: true, status: 202, dispatchId, runId: input.runId, state: 'ACCEPTED', replayed: false, ledgerRef: `julius-j1-ledger:${dispatchId}`, mode: deps.mode };
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
      return { status: 200, body: { data: { runId: rec.runId, state: rec.state, mode: deps.mode, events: page, nextCursor, terminal: TERMINAL.includes(rec.state) && nextCursor >= rec.events.length } } };
    },

    result(input) {
      const rec = records.get(input.runId);
      if (rec === undefined || rec.projectHash !== sha16(input.projectId) || rec.callerHash !== sha16(input.callerPlayerId)) {
        return { status: 404, body: { error: { kind: 'julius_dispatch_run_unknown', message: 'No dispatched run with that id on this bridge.' } } };
      }
      if (rec.state === 'ORPHANED') {
        return { status: 409, body: { error: { kind: 'julius_dispatch_run_orphaned', message: 'The bridge restarted during this run; it is not resumed.' } } };
      }
      if (rec.resultText === null && rec.resultSha256 !== null) {
        return { status: 410, body: { error: { kind: 'julius_dispatch_result_lost_on_restart', message: 'The result text did not survive a restart.', detail: { resultSha256: rec.resultSha256 } } } };
      }
      if (rec.resultText === null || rec.resultSha256 === null) {
        return { status: 409, body: { error: { kind: 'julius_dispatch_result_not_ready', message: 'The chain has not finished.' } } };
      }
      return { status: 200, body: { data: { runId: rec.runId, state: rec.state, mode: deps.mode, resultText: rec.resultText, resultSha256: rec.resultSha256 } } };
    },
  };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* HTTP edge                                                                                                        */

export const JULIUS_DISPATCH_PATH = '/wonderland/julius/dispatch';
export const JULIUS_DISPATCH_EVENTS_PATH = '/wonderland/julius/dispatch/events';
export const JULIUS_DISPATCH_RESULT_PATH = '/wonderland/julius/dispatch/result';
export const isJuliusDispatchRoute = (path: string): boolean =>
  path === JULIUS_DISPATCH_PATH || path === JULIUS_DISPATCH_EVENTS_PATH || path === JULIUS_DISPATCH_RESULT_PATH;

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

const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/;
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
    const runId = query.get('runId') ?? '';
    if (!RUN_ID.test(runId)) return err(400, 'julius_dispatch_run_invalid', 'runId is required.');
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
  let body: { runId?: unknown; clientTriggerId?: unknown; clientLogSha256?: unknown } | null = null;
  try { body = JSON.parse(request.rawBody ?? '') as typeof body; } catch { body = null; }
  if (body === null || typeof body !== 'object') return err(400, 'julius_dispatch_body_invalid', 'The body must be JSON.');
  const { runId, clientTriggerId, clientLogSha256 } = body;
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) return err(400, 'julius_dispatch_run_invalid', 'runId is required.');
  /* THE GAME-ORIGIN BINDING: no hash of a client log line, no dispatch. */
  if (typeof clientTriggerId !== 'string' || !TRIGGER_ID.test(clientTriggerId) || typeof clientLogSha256 !== 'string' || !HEX64.test(clientLogSha256)) {
    return err(400, 'julius_dispatch_client_log_binding_required', 'clientTriggerId and clientLogSha256 (the hash of the client log line written before this request) are required.');
  }
  const outcome = await ports.dispatch.dispatch({
    projectId, runId, callerPlayerId: native.playerId, sessionId: native.sessionId,
    idempotencyKey: request.idempotencyKey, clientTriggerId, clientLogSha256,
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
    mode: 'live',
    env,
    now,
  });
}
