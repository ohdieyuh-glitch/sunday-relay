import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * WONDERLAND -- J1 mission PROGRESS logic (after the dispatch is Accepted), held to the bridge's real vocabularies.
 *
 * `wonderland/Source/Wonderland/WonderlandJuliusMissionProgress.{h,cpp}` is standard C++17 with no Unreal include,
 * layered on r2's WonderlandJuliusMissionLogic (a821a467), whose files it does not change.
 * `wonderland/Tools/j1_progress_kat.cpp` runs it against known answers. This file:
 *
 *   1. Restates the progress rules (P1-P9 in the header) independently in TypeScript and checks EVERY row of every
 *      KAT table against them, so no expected value is anyone's say-so and none can be edited alone.
 *   2. Holds the status vocabularies to their sources: JULIUS_MISSION_STATES and JULIUS_TERMINAL_MISSION_STATES are
 *      read from src/relay/mission/julius/julius-runtime.ts on this tree; BRIDGE's AdmissionState
 *      (#407 dd0153a0, src/relay/integration/wonderland-admission/admission-store.ts) is restated here and compared
 *      with that file whenever it is on the tree. BRIDGE's status-route words (awaiting_operator, dispatched +
 *      dispatchedAt, operator_window_expired) are BRIDGE's room confirmation of 2026-10-23, not yet on a pushed branch:
 *      restated here and pinned in the header, to be re-pinned when BRIDGE posts its closed sets with SHAs.
 *   3. Checks that the scripts cover every transition out of every non-terminal state, every terminal against every
 *      kind of later answer, the run-id mismatch, no dispatch after Accepted, the three-phase poll budget (hold, then
 *      the dispatch window from BRIDGE's dispatchedAt, then the run window from the first Julius status), and that an
 *      Admission answer after a Julius status or a reported dispatch is only logged (P8, P9).
 *   3a. Reads .github/workflows/julius-first-live-mission.yml on this tree and fails if either poll budget is
 *      shorter than the workflow job it waits on (paid-slot, first-live-mission).
 *   4. Compiles and runs the C++ KAT with -Werror when a C++ compiler is present. CI (ubuntu-latest) has one; a CI run
 *      without one FAILS rather than reporting a pass for C++ it never ran.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CPP_DIR = join(ROOT, 'wonderland', 'Source', 'Wonderland');
const PROGRESS_H = join(CPP_DIR, 'WonderlandJuliusMissionProgress.h');
const PROGRESS_CPP = join(CPP_DIR, 'WonderlandJuliusMissionProgress.cpp');
const LOGIC_CPP = join(CPP_DIR, 'WonderlandJuliusMissionLogic.cpp');
const KAT = join(ROOT, 'wonderland', 'Tools', 'j1_progress_kat.cpp');
const LIVE_WORKFLOW = join(ROOT, '.github', 'workflows', 'julius-first-live-mission.yml');
const JULIUS_RUNTIME = join(ROOT, 'src', 'relay', 'mission', 'julius', 'julius-runtime.ts');
const ADMISSION_STORE = join(ROOT, 'src', 'relay', 'integration', 'wonderland-admission', 'admission-store.ts');

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

function section(name: string): string {
  const text = source(KAT);
  const begin = text.indexOf(`// ${name}-BEGIN`);
  const end = text.indexOf(`// ${name}-END`);
  if (begin < 0 || end < begin) throw new Error(`KAT section ${name} not found`);
  return text.slice(begin, end);
}

/** A C string literal's bytes as UTF-8 text: only \xHH, \\ and \" escapes are used in these tables. */
function cString(literal: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < literal.length; index += 1) {
    const character = literal[index] ?? '';
    if (character === '\\') {
      const next = literal[index + 1] ?? '';
      if (next === 'x') {
        bytes.push(parseInt(literal.slice(index + 2, index + 4), 16));
        index += 3;
      } else {
        bytes.push(next.charCodeAt(0));
        index += 1;
      }
    } else {
      bytes.push(...Buffer.from(character, 'utf8'));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/** Rows of one table: string literals, integers and E...::Value enum names, in order. */
function table(name: string): string[][] {
  const rows: string[][] = [];
  for (const line of section(name).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{ ')) continue;
    const cells = [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"|E(?:MissionProgress|StatusVocabulary|PollStep|PollPhase)::(\w+)|\b(\d+)\b/gu)]
      .map((match) => (match[1] !== undefined ? cString(match[1]) : (match[2] ?? match[3] ?? '')));
    rows.push(cells);
  }
  if (rows.length === 0) throw new Error(`KAT section ${name} is empty`);
  return rows;
}

/* ------------------------------------------------------------------ the rules, restated */

const ADMISSION_STATES = ['RESERVED', 'ADMISSION_HELD', 'LEDGER_UNWRITTEN', 'INTERRUPTED', 'FAILED'] as const;
/** BRIDGE's status-route words (room confirmation 2026-10-23; re-pin when BRIDGE posts the closed sets with SHAs). */
const BRIDGE = { awaitingOperator: 'awaiting_operator', dispatched: 'dispatched', operatorWindowExpired: 'operator_window_expired' } as const;
const STATES = ['AwaitingDispatchAnswer', 'AdmittedHeld', 'OperatorStarted', 'DispatchUnconfirmed', 'Dispatched', 'Running',
  'Paused', 'Waiting', 'Succeeded', 'Failed', 'Refused', 'DispatchFailed', 'NotStarted', 'RunIdMismatch', 'AnswerInvalid',
  'PollLimitReached'] as const;
type State = typeof STATES[number];
const TERMINAL: readonly State[] = ['Succeeded', 'Failed', 'Refused', 'DispatchFailed', 'NotStarted', 'RunIdMismatch', 'AnswerInvalid', 'PollLimitReached'];
const NON_TERMINAL_AFTER_ACCEPT: readonly State[] = ['AdmittedHeld', 'OperatorStarted', 'DispatchUnconfirmed', 'Dispatched', 'Running', 'Paused', 'Waiting'];

function juliusStates(): { all: string[]; terminal: string[] } {
  const text = source(JULIUS_RUNTIME);
  const all = /export const JULIUS_MISSION_STATES = \[([^\]]*)\]/u.exec(text)?.[1] ?? '';
  const terminal = /JULIUS_TERMINAL_MISSION_STATES[^=]*=\s*Object\.freeze\(\[([^\]]*)\]/u.exec(text)?.[1] ?? '';
  const words = (list: string) => [...list.matchAll(/'([A-Z_]+)'/gu)].map((match) => match[1] ?? '');
  return { all: words(all), terminal: words(terminal) };
}

/** Julius run state -> progress: the header's grouping, restated. Every member must be named here exactly once. */
const JULIUS_GROUPS: Readonly<Record<string, State>> = {
  CREATED: 'Dispatched', PLANNING: 'Dispatched', READY: 'Dispatched',
  EXECUTING: 'Running', WAITING: 'Running', REVIEWING: 'Running', REPAIRING: 'Running', VERIFYING: 'Running',
  BLOCKED: 'Paused', PAUSED: 'Paused',
  COMPLETED: 'Succeeded', FAILED: 'Failed', CANCELLED: 'Failed',
};
const ADMISSION_GROUPS: Readonly<Record<string, State>> = {
  RESERVED: 'AdmittedHeld', ADMISSION_HELD: 'AdmittedHeld', LEDGER_UNWRITTEN: 'AdmittedHeld',
  INTERRUPTED: 'DispatchFailed', FAILED: 'DispatchFailed',
  [BRIDGE.awaitingOperator]: 'AdmittedHeld', [BRIDGE.dispatched]: 'OperatorStarted',
};

function referenceStatus(vocabulary: string, status: string): State {
  const groups = vocabulary === 'Admission' ? ADMISSION_GROUPS : vocabulary === 'JuliusRun' ? JULIUS_GROUPS : {};
  return Object.prototype.hasOwnProperty.call(groups, status) ? (groups[status] as State) : 'Waiting';
}

/** r2's ClassifyDispatchAnswer, restated (rules 1, 2, 2a, 3). */
const PRE_CHAIN_429_KINDS = ['julius_dispatch_cap_reached', 'julius_dispatch_mission_cap_reached'];
function referenceAnswer(status: number, hasError: boolean, kind: string): 'Accepted' | 'Refused' | 'NoAnswer' {
  if (status === 429 && hasError && kind !== '') return PRE_CHAIN_429_KINDS.includes(kind) ? 'Refused' : 'NoAnswer';
  if (status >= 200 && status <= 299 && !hasError && kind === '') return 'Accepted';
  if (status >= 400 && status <= 599 && hasError && kind !== '') return 'Refused';
  return 'NoAnswer';
}

const POLL = { base: 5000, factor: 2, cap: 60000, slowAfter: 1_800_000, slow: 120_000, hold: 10_800_000, dispatch: 21_600_000, run: 19_800_000 } as const;
/** P5 restated: three time budgets, no count cap. */
function referencePoll(sent: number, phase: string, watched: number): [string, number] {
  const budget = phase === 'Run' ? POLL.run : phase === 'Dispatch' ? POLL.dispatch : phase === 'Hold' ? POLL.hold : Number.NaN;
  if (Number.isNaN(budget)) throw new Error(`unknown poll phase ${phase}`);
  const delay = watched >= POLL.slowAfter ? POLL.slow : Math.min(POLL.base * POLL.factor ** Math.min(sent, 10), POLL.cap);
  if (watched > budget || delay > budget - watched) return ['Stop', 0];
  return ['WaitThenPoll', delay];
}

const CLIENT_OK = 'wlj_0b1f3c2a-5d4e-4f60-8a71-92b3c4d5e6f7';
const CLIENT_OTHER = 'wlj_7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918';
const SERVER: Readonly<Record<string, string>> = {
  S1: 'run:0123456789abcdef01234567', S2: 'run:89abcdef0123456789abcdef', bad: 'run:0123456789ABCDEF01234567', short: 'run:0123',
  jkey: 'run:6c2d9e1f-3a4b-4c5d-9e6f-7a8b9c0d1e2f', none: '',
};
const SERVER_RUN_ID = /^run:[0-9a-f]{24}$/u;

interface Answer {
  http: number; hasError: boolean; kind: string; hasData: boolean; vocab: string; client: string; server: string; status: string;
  dispatchedAt: string; cause: string; receivedUtcMs: number;
}

/** P9 restated: BRIDGE's dispatchedAt is exactly YYYY-MM-DDTHH:MM:SSZ or YYYY-MM-DDTHH:MM:SS.sssZ, a real UTC date from
 * 1970 to 9999, no leap second. Anything else is "can't confirm". Checked against JavaScript's own Date.UTC. */
function referenceUtc(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/u.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const millis = Number(match[7] ?? '0');
  if (year < 1970 || hour > 23 || minute > 59 || second > 59) return null;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return ms;
}
interface Step { from: State; to: State; event: string; kind: string }

function parseAnswer(fields: string[], vocab: string, bridge: string[] = []): Answer {
  const [http, err, client, server, status] = fields;
  const [dispatchedAt, cause, received] = bridge;
  const hasData = client !== 'nodata';
  return {
    http: Number(http), hasError: err !== '-', kind: err === '-' || err === '~' ? '' : (err ?? ''), hasData, vocab,
    client: client === 'ok' ? CLIENT_OK : client === 'other' ? CLIENT_OTHER : '',
    server: hasData ? (SERVER[server ?? ''] ?? '') : '', status: status === '-' || !hasData ? '' : (status ?? ''),
    dispatchedAt: dispatchedAt === undefined || dispatchedAt === '-' ? '' : dispatchedAt,
    cause: cause === undefined || cause === '-' ? '' : cause,
    receivedUtcMs: received === undefined || received === '-' ? 0 : Number(received),
  };
}
const NO_ANSWER: Answer = { http: 0, hasError: false, kind: '', hasData: false, vocab: 'Unknown', client: '', server: '', status: '',
  dispatchedAt: '', cause: '', receivedUtcMs: 0 };

/** The tracker, restated from the header's P1-P9. Returns every step, like the C++ trace. */
function referenceRun(script: string): {
  state: State; pinned: string; polls: number; julius: boolean; dispatchReported: boolean; dispatchConfirmed: boolean; steps: Step[];
} {
  let state: State = 'AwaitingDispatchAnswer';
  let pinned = '';
  let polls = 0;
  let julius = false;
  let runStart: number | null = null;
  let dispatchReported = false;
  let dispatchConfirmed = false;
  let dispatchAge = 0;
  let dispatchStart: number | null = null;
  // P8: an Admission status applies only before any Julius status; after one it is logged and moves nothing.
  // P9: likewise after the bridge reported its dispatch, except that a "dispatched" with a usable dispatchedAt may
  // still confirm a dispatch that came without one. The cause operator_window_expired before any dispatch is NotStarted.
  const admission = (event: string, answer: Answer, kind: string) => {
    const saysDispatched = answer.status === BRIDGE.dispatched;
    if (julius || (dispatchReported && (dispatchConfirmed || !saysDispatched))) { move('admission_answer_logged', state, kind); return; }
    if (saysDispatched) {
      dispatchReported = true;
      const at = referenceUtc(answer.dispatchedAt);
      if (at === null) { move(event, 'DispatchUnconfirmed', kind); return; }
      dispatchConfirmed = true;
      dispatchAge = Math.max(0, answer.receivedUtcMs - at);
      move(event, 'OperatorStarted', kind);
      return;
    }
    if (answer.cause === BRIDGE.operatorWindowExpired) { move(event, 'NotStarted', kind); return; }
    move(event, referenceStatus('Admission', answer.status), kind);
  };
  const steps: Step[] = [{ from: state, to: state, event: 'started', kind: 'start' }];
  const move = (event: string, to: State, kind: string) => { steps.push({ from: state, to, event, kind }); state = to; };
  const mismatched = (answer: Answer) => (answer.server !== '' && answer.server !== pinned) || (answer.client !== '' && answer.client !== CLIENT_OK);
  for (const token of script === '' ? [] : script.split(' ')) {
    const fields = token.split(',');
    if (token === 'D0' || (fields[0] === 'D' && (fields.length === 6 || fields.length === 9))) {
      const answer = token === 'D0' ? NO_ANSWER : parseAnswer(fields.slice(1, 6), 'Admission', fields.slice(6));
      const verdict = referenceAnswer(answer.http, answer.hasError, answer.kind);
      if (TERMINAL.includes(state)) move('ignored_after_terminal', state, 'dispatch');
      else if (state === 'AwaitingDispatchAnswer') {
        if (verdict === 'NoAnswer') move('dispatch_unanswered', state, 'dispatch');
        else if (verdict === 'Refused') move('dispatch_refused', 'Refused', 'dispatch');
        else if (!answer.hasData || !SERVER_RUN_ID.test(answer.server) || answer.client === '') move('answer_rejected', 'AnswerInvalid', 'dispatch');
        else if (answer.client !== CLIENT_OK) move('run_id_mismatched', 'RunIdMismatch', 'dispatch');
        else { pinned = answer.server; admission('admitted', answer, 'dispatch'); }
      } else if (verdict !== 'Accepted') move('late_dispatch_answer_ignored', state, 'late');
      else if (mismatched(answer)) move('run_id_mismatched', 'RunIdMismatch', 'late');
      else if (!answer.hasData || answer.server === '' || answer.client === '') move('late_dispatch_answer_ignored', state, 'late');
      else admission('dispatch_replayed', answer, 'late');
    } else if (token === 'P0' || (fields[0] === 'P' && (fields.length === 7 || fields.length === 10))) {
      const answer = token === 'P0' ? NO_ANSWER : parseAnswer([fields[1] ?? '', fields[2] ?? '', ...fields.slice(4, 7)],
        { A: 'Admission', J: 'JuliusRun' }[fields[3] ?? ''] ?? 'Unknown', fields.slice(7));
      if (state === 'AwaitingDispatchAnswer') { move('poll_failed', state, 'poll'); continue; }
      polls += 1;
      const readable = answer.http >= 200 && answer.http <= 299 && !answer.hasError && answer.kind === '' && answer.hasData;
      if (TERMINAL.includes(state)) move('ignored_after_terminal', state, 'poll');
      else if (!readable) move('poll_failed', state, 'poll');
      else if (mismatched(answer)) move('run_id_mismatched', 'RunIdMismatch', 'poll');
      else if (answer.server === '' || (answer.vocab === 'Admission' && answer.client === '')) move('poll_failed', state, 'poll');
      else if (answer.vocab === 'Admission') admission('status_applied', answer, 'poll');
      else {
        if (answer.vocab === 'JuliusRun') julius = true;
        move('status_applied', referenceStatus(answer.vocab, answer.status), 'poll');
      }
    } else if (fields[0] === 'N' && fields.length === 2) {
      if (state === 'AwaitingDispatchAnswer' || TERMINAL.includes(state)) continue;
      const watched = Number(fields[1]);
      let phase: 'Hold' | 'Dispatch' | 'Run' = 'Hold';
      let phaseWatched = watched;
      if (julius) {
        if (runStart === null) runStart = watched;
        phase = 'Run';
        phaseWatched = Math.max(0, watched - runStart);
      } else if (dispatchConfirmed) {
        // P9: the dispatch window starts at dispatchedAt, backdated by its age at arrival, never before Accepted (0).
        if (dispatchStart === null) dispatchStart = watched - Math.min(dispatchAge, watched);
        phase = 'Dispatch';
        phaseWatched = Math.max(0, watched - dispatchStart);
      }
      if (referencePoll(polls, phase, phaseWatched)[0] === 'Stop') {
        if (phase === 'Hold' && state === 'AdmittedHeld') move('hold_window_expired', 'NotStarted', 'next');
        else move('poll_limit_reached', 'PollLimitReached', 'next');
      }
    } else {
      throw new Error(`malformed script step ${token}`);
    }
  }
  return { state, pinned, polls, julius, dispatchReported, dispatchConfirmed, steps };
}

/* ------------------------------------------------------------------ the tests */

describe('J1 progress logic: status strings map exactly, inside their own vocabulary', () => {
  it('the Julius vocabulary is the one on this tree, and every member is grouped once', () => {
    const { all, terminal } = juliusStates();
    expect(all).toEqual(['CREATED', 'PLANNING', 'READY', 'EXECUTING', 'WAITING', 'REVIEWING', 'REPAIRING', 'VERIFYING',
      'BLOCKED', 'PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED']);
    expect(Object.keys(JULIUS_GROUPS).sort()).toEqual([...all].sort());
    for (const word of all) {
      expect(TERMINAL.includes(JULIUS_GROUPS[word] as State), `${word} terminal`).toBe(terminal.includes(word));
    }
  });

  it("BRIDGE's AdmissionState is restated exactly, and compared with the file when it is on the tree", () => {
    expect(Object.keys(ADMISSION_GROUPS)).toEqual([...ADMISSION_STATES, BRIDGE.awaitingOperator, BRIDGE.dispatched]);
    if (existsSync(ADMISSION_STORE)) {
      const union = /export type AdmissionState = ([^;]+);/u.exec(source(ADMISSION_STORE))?.[1] ?? '';
      expect([...union.matchAll(/'([A-Z_]+)'/gu)].map((match) => match[1])).toEqual([...ADMISSION_STATES]);
    }
  });

  it('every status row expects what the restated map gives, and every vocabulary word has a row', () => {
    const rows = table('KAT-PROGRESS-STATUS');
    for (const [label, vocabulary, status, expected] of rows) {
      expect(expected, `${label}`).toBe(referenceStatus(vocabulary ?? '', status ?? ''));
      if (vocabulary === 'Admission') expect(['AdmittedHeld', 'Waiting', 'DispatchFailed', 'OperatorStarted'], `P7 ${label}`).toContain(expected);
    }
    const has = (vocabulary: string, status: string) => rows.some((row) => row[1] === vocabulary && row[2] === status);
    for (const word of Object.keys(ADMISSION_GROUPS)) expect(has('Admission', word), word).toBe(true);
    for (const word of juliusStates().all) expect(has('JuliusRun', word), word).toBe(true);
    // Cross-vocabulary words, case variants, padding, empty and free text are all Waiting.
    for (const label of ['admission_julius_completed', 'julius_admission_held', 'julius_lowercase_completed', 'julius_mixed_case',
      'admission_padded', 'admission_trailing', 'admission_empty', 'julius_empty', 'julius_free_text', 'unknown_completed', 'julius_prefix',
      'admission_awaiting_operator_upper', 'admission_dispatched_mixed_case', 'admission_dispatched_padded', 'admission_cause_word_as_state',
      'julius_awaiting_operator', 'julius_dispatched_word_lower', 'unknown_dispatched', 'unknown_awaiting_operator']) {
      expect(rows.find((row) => row[0] === label)?.[3], label).toBe('Waiting');
    }
  });

  it("BRIDGE's status-route words are pinned once in the header (re-pin when BRIDGE posts the closed sets)", () => {
    const header = source(PROGRESS_H);
    expect(header).toContain(`BridgeAwaitingOperatorState = "${BRIDGE.awaitingOperator}";`);
    expect(header).toContain(`BridgeDispatchedState = "${BRIDGE.dispatched}";`);
    expect(header).toContain(`BridgeOperatorWindowExpiredCause = "${BRIDGE.operatorWindowExpired}";`);
    expect(header).toContain('dispatchedAt');
    expect(header, 'updatedAt is not the dispatch time').toContain('updatedAt is NOT used');
    // Each word is compared through its constant only (the trace name "dispatched" of the Julius-side state is a name, not a comparison).
    for (const word of Object.values(BRIDGE)) {
      expect(source(PROGRESS_CPP), `${word} is compared through its constant only`).not.toMatch(new RegExp(`[=!]=\\s*"${word}"|"${word}"\\s*[=!]=`, 'u'));
    }
    for (const name of ['BridgeAwaitingOperatorState', 'BridgeDispatchedState', 'BridgeOperatorWindowExpiredCause']) {
      expect(source(PROGRESS_CPP), `${name} is used`).toContain(name);
    }
  });

  it("every dispatchedAt row parses as the restated format and JavaScript's Date.UTC give (P9)", () => {
    const rows = table('KAT-UTC-TIME');
    for (const [label, text, ok, ms] of rows) {
      const reference = referenceUtc(text ?? '');
      expect(ok, `${label} ok`).toBe(reference === null ? '0' : '1');
      if (reference !== null) {
        expect(Number(ms), `${label} ms`).toBe(reference);
        expect(new Date(reference).toISOString().replace('.000Z', 'Z'), label).toBe((text ?? '').replace('.000Z', 'Z'));
      }
    }
    expect(rows.filter((row) => row[2] === '1').length, 'valid forms').toBeGreaterThanOrEqual(5);
    expect(rows.find((row) => row[0] === 'offset_zero')?.[2], '+00:00 is not accepted').toBe('0');
    expect(rows.find((row) => row[0] === 'not_leap_2026')?.[2], 'impossible dates are not accepted').toBe('0');
  });
});

describe('J1 progress logic: the words on screen claim nothing', () => {
  it('one display row per state, terminal flags match, the held words are exact, and nothing claims spend or PASS', () => {
    const rows = table('KAT-PROGRESS-DISPLAY');
    expect(rows.map((row) => row[1])).toEqual([...STATES]);
    for (const [name, state, label, terminal, send] of rows) {
      expect(terminal, `${name} terminal`).toBe(TERMINAL.includes(state as State) ? '1' : '0');
      expect(send, `${name} send`).toBe(state === 'AwaitingDispatchAnswer' ? '1' : '0');
      expect(label ?? '', name).not.toMatch(/pass|spen[dt]|cost|\$|qualif|verified|success|charged|paid for/iu);
    }
    expect(rows.find((row) => row[1] === 'AdmittedHeld')?.[2]).toBe('Waiting for the operator to start the run');
    expect(rows.find((row) => row[1] === 'OperatorStarted')?.[2]).toBe('The operator started the run \u2014 waiting for Julius to report');
    expect(rows.find((row) => row[1] === 'DispatchUnconfirmed')?.[2]).toMatch(/^Can't confirm when the run was started/u);
    expect(rows.find((row) => row[1] === 'NotStarted')?.[2]).toMatch(/^Not started \u2014 /u);
    expect(rows.find((row) => row[1] === 'NotStarted')?.[2], 'not started is not a failure').not.toMatch(/fail|error|bridge ended/iu);
    expect(rows.find((row) => row[1] === 'Running')?.[2]).not.toMatch(/admitted|operator/iu);
    expect(source(PROGRESS_CPP)).toContain('"Waiting for the operator to start the run"');
    expect(/[^\x00-\x7f]/u.test(source(PROGRESS_CPP)) || /[^\x00-\x7f]/u.test(source(PROGRESS_H)), 'sources stay ASCII').toBe(false);
  });
});

describe('J1 progress logic: polling is bounded and never dispatches (P4, P5)', () => {
  it('every poll row expects the restated schedule, and the header states the same constants', () => {
    for (const [label, sent, phase, watched, step, delay] of table('KAT-POLL')) {
      expect([step, Number(delay)], label).toEqual(referencePoll(Number(sent), phase ?? '', Number(watched)));
    }
    const header = source(PROGRESS_H);
    expect(header).toContain(`PollBaseDelayMs = ${POLL.base};`);
    expect(header).toContain(`PollGrowthFactor = ${POLL.factor};`);
    expect(header).toContain(`PollMaxDelayMs = ${POLL.cap};`);
    expect(header).toContain(`PollSlowAfterMs = ${POLL.slowAfter};`);
    expect(header).toContain(`PollSlowDelayMs = ${POLL.slow};`);
    expect(header).toContain(`PollHoldWatchMs = ${POLL.hold};`);
    expect(header).toContain(`PollDispatchWatchMs = ${POLL.dispatch};`);
    expect(header, 'the old admission budget name is gone').not.toContain('PollAdmissionWatchMs');
    expect(header).toContain(`PollRunWatchMs = ${POLL.run};`);
    expect(header, 'no poll-count cap').not.toMatch(/PollMaxCount|PollMaxTotalWatchMs/u);
    expect(source(PROGRESS_CPP), 'no poll-count cap').not.toMatch(/PollMaxCount|PollMaxTotalWatchMs/u);
  });

  it("both budgets are at least the paid workflow's own job timeouts, read from the workflow on this tree (M-1)", () => {
    const lines = source(LIVE_WORKFLOW).split('\n');
    /** The timeout-minutes of a top-level job: the first one between `  <job>:` and the next job. */
    const jobTimeout = (job: string): { minutes: number; line: number } => {
      const start = lines.findIndex((line) => line === `  ${job}:`);
      expect(start, `job ${job}`).toBeGreaterThanOrEqual(0);
      for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (/^  [a-z0-9_-]+:\s*$/u.test(line)) break;
        const match = /^    timeout-minutes: (\d+)\s*$/u.exec(line);
        if (match) return { minutes: Number(match[1]), line: index + 1 };
      }
      throw new Error(`job ${job} has no timeout-minutes`);
    };
    const paidSlot = jobTimeout('paid-slot');
    const live = jobTimeout('first-live-mission');
    // The workflow's own measured worst case for the live job (3 repair cycles plus the entrypoint's margins).
    const worst = /^\s*#.*= (\d+)\s+\((\d+(?:\.\d+)?) min\)\s*$/u;
    const worstCases = lines.map((line) => worst.exec(line)).filter((match): match is RegExpExecArray => match !== null).map((match) => Number(match[1]));
    expect(worstCases.length, 'the live job states its measured worst case').toBeGreaterThan(0);
    const worstMs = Math.max(...worstCases);
    expect(worstMs, 'the stated worst case fits the live job').toBeLessThanOrEqual(live.minutes * 60_000);
    // L-6: the dispatch budget starts at BRIDGE's dispatchedAt, so the whole paid-slot wait is inside it.
    expect(POLL.dispatch, `dispatch budget vs paid-slot timeout-minutes ${paidSlot.minutes} (line ${paidSlot.line})`).toBeGreaterThanOrEqual(paidSlot.minutes * 60_000);
    expect(POLL.run, `run budget vs first-live-mission timeout-minutes ${live.minutes} (line ${live.line})`).toBeGreaterThanOrEqual(live.minutes * 60_000);
    expect(POLL.run, `run budget vs the live job's worst case ${worstMs} ms`).toBeGreaterThanOrEqual(worstMs);
    // Values as reviewed at d35faa39's tree; if the workflow moves, this names the change instead of passing silently.
    expect([paidSlot.minutes, live.minutes, worstMs]).toEqual([350, 300, 17_516_316]);
  });

  it('every poll-run row stops after exactly the restated number of polls, in the restated state', () => {
    const rows = table('KAT-POLL-RUN');
    for (const [label, , requestMs, dispatchFrom, dispatchAge, juliusFrom, polls, watchedMs, final] of rows) {
      let sent = 0;
      let watched = 0;
      let runStart: number | null = null;
      let dispatchStart: number | null = null;
      let phase: 'Hold' | 'Dispatch' | 'Run' = 'Hold';
      for (;;) {
        // The answer to poll `sent` (1-based) was recorded before this ask.
        const julius = Number(juliusFrom) !== 0 && sent >= Number(juliusFrom);
        const dispatched = !julius && Number(dispatchFrom) !== 0 && sent >= Number(dispatchFrom);
        let phaseWatched = watched;
        if (julius) {
          if (runStart === null) runStart = watched;
          phase = 'Run';
          phaseWatched = watched - runStart;
        } else if (dispatched) {
          // P9: age at the first dispatched answer, clamped to Accepted.
          if (dispatchStart === null) dispatchStart = watched - Math.min(Number(dispatchAge), watched);
          phase = 'Dispatch';
          phaseWatched = Math.max(0, watched - dispatchStart);
        }
        const [step, delay] = referencePoll(sent, phase, phaseWatched);
        if (step === 'Stop') break;
        watched += delay + Number(requestMs);
        sent += 1;
      }
      expect([sent, watched], label).toEqual([Number(polls), Number(watchedMs)]);
      // Stopped while still held (held answers or failures only): the hold window's neutral end. Otherwise the limit.
      expect(final, `${label} final`).toBe(phase === 'Hold' ? 'NotStarted' : 'PollLimitReached');
    }
    expect(rows.some((row) => row[1] === 'fail'), 'failing polls are run').toBe(true);
    expect(rows.some((row) => Number(row[5]) > 0 && Number(row[7]) > POLL.dispatch), 'a run phase outlasts the dispatch budget').toBe(true);
    expect(rows.some((row) => Number(row[3]) > 0 && Number(row[7]) > POLL.hold + POLL.dispatch - POLL.slow), 'L-6: a late claim keeps its whole dispatch window').toBe(true);
    expect(rows.some((row) => row[8] === 'NotStarted'), 'the hold window ends NotStarted').toBe(true);
  });
});

describe('J1 progress logic: the state machine (P1, P2, P3)', () => {
  const rows = table('KAT-PROGRESS-SCRIPT');
  const runs = rows.map((row) => ({ row, run: referenceRun(row[1] ?? '') }));

  it('every script row expects what the restated rules give', () => {
    for (const { row, run } of runs) {
      const [label, , final, lastEvent, pinned, send] = row;
      expect(run.state, `${label} state`).toBe(final);
      if (run.state === 'AwaitingDispatchAnswer') expect(run.polls, `${label} no poll counted before Accepted`).toBe(0);
      expect(run.steps.at(-1)?.event, `${label} last event`).toBe(lastEvent);
      expect(run.pinned, `${label} pinned`).toBe(SERVER[pinned ?? ''] ?? '');
      expect(send, `${label} send allowed`).toBe(run.state === 'AwaitingDispatchAnswer' ? '1' : '0');
    }
  });

  it('a poll before the first Accepted answer is not counted (P4, mutant S22)', () => {
    const entry = runs.find(({ row }) => row[0] === 'poll_before_accepted');
    expect(entry?.run.polls).toBe(0);
    expect(source(KAT)).toContain('Tracker.PollsRecorded() == 0, "P4 polls before Accepted are not counted');
  });

  it('every transition out of every non-terminal state is exercised', () => {
    const seen = new Set(runs.flatMap(({ run }) => run.steps.map((step) => `${step.from}>${step.to}`)));
    const targets: State[] = ['AdmittedHeld', 'OperatorStarted', 'DispatchUnconfirmed', 'Dispatched', 'Running', 'Paused', 'Waiting',
      'Succeeded', 'Failed', 'DispatchFailed', 'NotStarted', 'RunIdMismatch', 'PollLimitReached'];
    // P8: Dispatched, Running and Paused are only reached by a Julius status, so from them an Admission answer can
    // never lead back to AdmittedHeld, to a dispatch state, nor end the run as DispatchFailed or NotStarted.
    // P9: after the bridge reported its dispatch nothing goes back to held nor ends it as DispatchFailed or NotStarted;
    // only a usable dispatchedAt moves DispatchUnconfirmed to OperatorStarted. AdmittedHeld's own window ends
    // NotStarted, never PollLimitReached.
    const impossibleFrom: Readonly<Record<string, readonly State[]>> = {
      Dispatched: ['AdmittedHeld', 'DispatchFailed', 'OperatorStarted', 'DispatchUnconfirmed', 'NotStarted'],
      Running: ['AdmittedHeld', 'DispatchFailed', 'OperatorStarted', 'DispatchUnconfirmed', 'NotStarted'],
      Paused: ['AdmittedHeld', 'DispatchFailed', 'OperatorStarted', 'DispatchUnconfirmed', 'NotStarted'],
      OperatorStarted: ['AdmittedHeld', 'DispatchFailed', 'DispatchUnconfirmed', 'NotStarted'],
      DispatchUnconfirmed: ['AdmittedHeld', 'DispatchFailed', 'NotStarted'],
      AdmittedHeld: ['PollLimitReached'],
    };
    for (const from of NON_TERMINAL_AFTER_ACCEPT) {
      for (const to of targets) {
        const impossible = (impossibleFrom[from] ?? []).includes(to);
        expect(seen.has(`${from}>${to}`), `${from} -> ${to}`).toBe(!impossible);
      }
    }
    for (const to of ['AwaitingDispatchAnswer', 'Refused', 'AdmittedHeld', 'OperatorStarted', 'DispatchUnconfirmed', 'Waiting',
      'DispatchFailed', 'NotStarted', 'AnswerInvalid', 'RunIdMismatch']) {
      expect(seen.has(`AwaitingDispatchAnswer>${to}`), `AwaitingDispatchAnswer -> ${to}`).toBe(true);
    }
    // P1: nothing goes back to AwaitingDispatchAnswer; P2: Refused and AnswerInvalid only from before Accepted.
    for (const key of seen) {
      const [from, to] = key.split('>');
      if (to === 'AwaitingDispatchAnswer') expect(from, key).toBe('AwaitingDispatchAnswer');
      if (to === 'Refused' || to === 'AnswerInvalid') expect(['AwaitingDispatchAnswer', to], key).toContain(from);
    }
  });

  it('every terminal is tried against every kind of later answer and never moves (P3)', () => {
    for (const terminal of TERMINAL) {
      const sticky = runs.filter(({ row, run }) => row[0]?.startsWith('sticky_') && run.steps.some((step) => step.from === terminal && step.event === 'ignored_after_terminal'));
      const kinds = new Set(sticky.flatMap(({ run }) => run.steps.filter((step) => step.from === terminal).map((step) => step.kind)));
      expect([...kinds].sort(), terminal).toEqual(['dispatch', 'poll']);
      for (const { run } of sticky) {
        const index = run.steps.findIndex((step) => step.to === terminal);
        for (const step of run.steps.slice(index + 1)) expect(step.to, terminal).toBe(terminal);
      }
    }
  });

  it('after Accepted nothing ever allows a dispatch, and a different run id fails closed', () => {
    for (const { row, run } of runs) {
      if (run.steps.some((step) => step.event === 'admitted')) expect(row[5], `${row[0]}`).toBe('0');
      const pinnedAt = run.steps.findIndex((step) => step.event === 'admitted');
      if (pinnedAt >= 0) for (const step of run.steps.slice(pinnedAt)) expect(step.to, `${row[0]}`).not.toBe('AwaitingDispatchAnswer');
    }
    for (const label of ['held_mismatch_server_run_id', 'running_mismatch_server_run_id', 'waiting_mismatch_client_run_id',
      'held_late_replay_other_server_run_id', 'accepted_other_client_run_id', 'paused_mismatch_server_run_id_case', 'dispatched_mismatch_on_julius_client_field']) {
      expect(rows.find((row) => row[0] === label)?.[2], label).toBe('RunIdMismatch');
    }
    for (const label of ['held_poll_transport_failure', 'running_poll_bare_500', 'waiting_poll_run_not_found_404', 'held_late_no_answer', 'held_late_refusal', 'running_late_busy']) {
      const row = rows.find((candidate) => candidate[0] === label);
      expect(row, label).toBeDefined();
      expect(row?.[5], label).toBe('0');
      expect(TERMINAL.includes(row?.[2] as State), label).toBe(false);
    }
  });

  it('after a Julius status an Admission answer is only logged, and DispatchFailed is reached only before one (M-2)', () => {
    for (const { row, run } of runs) {
      let julius = false;
      let dispatch = false;
      // Re-run prefix by prefix so each step knows whether a Julius status or a dispatch had applied before it.
      const tokens = (row[1] ?? '') === '' ? [] : (row[1] ?? '').split(' ');
      for (let count = 1; count <= tokens.length; count += 1) {
        const before = referenceRun(tokens.slice(0, count - 1).join(' '));
        const after = referenceRun(tokens.slice(0, count).join(' '));
        julius = before.julius;
        dispatch = before.dispatchReported;
        for (const step of after.steps.slice(before.steps.length)) {
          if ((step.to === 'DispatchFailed' || step.to === 'NotStarted') && step.from !== step.to) {
            expect(julius, `${row[0]} ${step.to} after Julius`).toBe(false);
            expect(dispatch, `${row[0]} ${step.to} after dispatch`).toBe(false);
            expect(['AwaitingDispatchAnswer', 'AdmittedHeld', 'Waiting'], `${row[0]}`).toContain(step.from);
          }
          if (step.event === 'admission_answer_logged') {
            expect(julius || dispatch, `${row[0]} logged before Julius or dispatch`).toBe(true);
            expect(step.to, `${row[0]}`).toBe(step.from);
          }
          if (julius || dispatch) expect(step.to, `${row[0]} back to admitted`).not.toBe('AdmittedHeld');
          if (julius) expect(['OperatorStarted', 'DispatchUnconfirmed'], `${row[0]} dispatch state after Julius`).not.toContain(step.to);
        }
      }
      expect(run.steps.length, `${row[0]}`).toBeGreaterThan(0);
    }
    for (const label of ['m2_running_admission_poll_no_regression', 'm2_running_admission_poll_no_dispatch_failed_interrupted',
      'm2_running_late_replay_no_dispatch_failed_interrupted', 'running_to_held_admission', 'running_to_dispatch_failed_interrupted',
      'running_late_replay_interrupted']) {
      const row = rows.find((candidate) => candidate[0] === label);
      expect(row?.[2], label).toBe('Running');
      expect(row?.[3], label).toBe('admission_answer_logged');
    }
    for (const label of ['m2_pre_julius_waiting_to_dispatch_failed', 'm2_pre_julius_waiting_late_replay_dispatch_failed', 'held_to_dispatch_failed_interrupted']) {
      expect(rows.find((candidate) => candidate[0] === label)?.[2], label).toBe('DispatchFailed');
    }
    expect(table('KAT-PROGRESS-DISPLAY').find((row) => row[1] === 'DispatchFailed')?.[2]).toBe('The bridge ended this request before Julius reported a run');
  });

  it("L-6: the held phase ends neutral, and the dispatch window is BRIDGE's dispatchedAt, set once (P5, P9)", () => {
    const final = (label: string) => {
      const row = rows.find((candidate) => candidate[0] === label);
      expect(row, label).toBeDefined();
      return [row?.[2], row?.[3]];
    };
    // Held: its own window, shown as waiting for the operator; it ends NotStarted (unpaid), never DispatchFailed.
    expect(final('accepted_awaiting_operator')).toEqual(['AdmittedHeld', 'admitted']);
    expect(final('held_next_poll_over_budget')).toEqual(['NotStarted', 'hold_window_expired']);
    expect(final('phase_held_hold_budget_exhausted')).toEqual(['NotStarted', 'hold_window_expired']);
    expect(final('held_to_not_started_operator_window_expired')).toEqual(['NotStarted', 'status_applied']);
    expect(final('accepted_operator_window_expired_interrupted')).toEqual(['NotStarted', 'admitted']);
    expect(final('held_operator_window_expired_on_failed_is_not_dispatch_failed')).toEqual(['NotStarted', 'status_applied']);
    // Accepted INTERRUPTED/FAILED without that exact cause stay DispatchFailed.
    expect(final('accepted_interrupted_other_cause')[0]).toBe('DispatchFailed');
    expect(final('accepted_failed_cause_case_variant')[0]).toBe('DispatchFailed');
    expect(final('held_to_dispatch_failed_interrupted')[0]).toBe('DispatchFailed');
    // Dispatched: the 360 min starts at dispatchedAt, not at Accepted.
    expect(final('l6_window_fits_after_late_claim')).toEqual(['OperatorStarted', 'status_applied']);
    expect(final('l6_window_exhausted_after_late_claim')).toEqual(['PollLimitReached', 'poll_limit_reached']);
    expect(final('l6_old_budget_from_accepted_is_gone')[0]).toBe('OperatorStarted');
    expect(final('l6_later_dispatched_at_never_restarts')[0]).toBe('PollLimitReached');
    expect(final('l6_julius_opens_fresh_run_window')[0]).toBe('Running');
    // Fail closed: dispatched with dispatchedAt missing or unparseable says "can't confirm" and starts no window.
    expect(final('held_to_dispatch_unconfirmed_missing_dispatched_at')).toEqual(['DispatchUnconfirmed', 'status_applied']);
    expect(final('accepted_dispatched_without_time')).toEqual(['DispatchUnconfirmed', 'admitted']);
    expect(final('held_to_dispatch_unconfirmed_offset_form')[0]).toBe('DispatchUnconfirmed');
    expect(final('dispatch_unconfirmed_no_fresh_window_cant_confirm')).toEqual(['PollLimitReached', 'poll_limit_reached']);
    expect(final('dispatch_unconfirmed_never_not_started')).toEqual(['PollLimitReached', 'poll_limit_reached']);
    // After dispatch, INTERRUPTED / FAILED / the expiry cause are only logged.
    for (const label of ['operator_started_interrupted_logged', 'operator_started_failed_logged', 'operator_started_window_expired_logged',
      'operator_started_late_replay_interrupted_logged', 'dispatch_unconfirmed_interrupted_logged', 'dispatch_unconfirmed_window_expired_logged']) {
      expect(final(label)[1], label).toBe('admission_answer_logged');
    }
    expect(final('operator_started_mismatch_server_run_id')[0]).toBe('RunIdMismatch');
    expect(source(KAT)).toContain('L-6 still watching through the 350 min paid-slot wait + 4 min after a claim at');
  });

  it('keyed only on serverRunId: a status naming any other run id is never applied and fails closed (P2)', () => {
    for (const label of ['runid_julius_own_name_is_not_applied', 'runid_julius_own_name_while_running']) {
      const entry = runs.find(({ row }) => row[0] === label);
      expect(entry, label).toBeDefined();
      const { row, run } = entry as (typeof runs)[number];
      expect(row[1], label).toContain(',jkey,');
      expect(run.state, label).toBe('RunIdMismatch');
      expect(run.pinned, label).toBe(SERVER.S1);
      const last = run.steps.at(-1);
      expect(last?.event, label).toBe('run_id_mismatched');
      // The status the foreign id reported (COMPLETED / FAILED) was not applied.
      expect(run.steps.some((step) => step.to === 'Succeeded' || step.to === 'Failed'), label).toBe(false);
    }
    expect(SERVER_RUN_ID.test(SERVER.jkey ?? ''), "Julius's own run name is not a serverRunId").toBe(false);
  });

  it('the header states the rules the scripts pin', () => {
    const header = source(PROGRESS_H);
    for (const text of ['P1 NO SECOND DISPATCH', 'P2 THE SERVER RUN ID IS PINNED', 'P3 TERMINALS ARE STICKY', 'P4 POLLING NEVER DISPATCHES',
      'P5 THE POLL SCHEDULE IS BOUNDED BY TIME, IN THREE PHASES', 'P6 NO SPEND, NO PASS', 'P7 A 202 IS NOT A RUNNING MISSION',
      'P8 JULIUS OUTRANKS ADMISSION', "P9 THE DISPATCH TIME IS THE BRIDGE'S, AND IT IS SET ONCE", 'KEYED ONLY ON serverRunId', '#407 defines NO status endpoint',
      'dd0153a0d8c362283224d388390e822b13c3b2d6', 'ONE TRACKER PER TRIGGER']) {
      expect(header).toContain(text);
    }
    for (const text of [source(PROGRESS_CPP), source(PROGRESS_H)]) {
      expect(text).not.toMatch(/#include\s+"(?:CoreMinimal|Http|Engine)|\bUObject\b|\bFString\b|\bFHttp|\bsrand\s*\(|\brand\s*\(|chrono/u);
    }
  });
});

function cxxCompiler(): string | null {
  for (const candidate of ['g++', 'c++', 'clang++']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // not on PATH; try the next
    }
  }
  return null;
}

describe('J1 progress logic: the C++ KAT compiles with -Werror and passes', () => {
  it('builds and runs wonderland/Tools/j1_progress_kat.cpp', () => {
    const compiler = cxxCompiler();
    if (compiler === null) {
      expect(process.env.GITHUB_ACTIONS, 'CI must have a C++ compiler: no pass for C++ that never ran').not.toBe('true');
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'j1-progress-kat-'));
    try {
      const exe = join(dir, 'j1_progress_kat');
      execFileSync(compiler, ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', CPP_DIR, KAT, PROGRESS_CPP, LOGIC_CPP, '-o', exe], { stdio: 'pipe' });
      const out = execFileSync(exe, { encoding: 'utf8' });
      const counts = ['KAT-PROGRESS-STATUS', 'KAT-PROGRESS-DISPLAY', 'KAT-POLL', 'KAT-POLL-RUN', 'KAT-PROGRESS-SCRIPT', 'KAT-UTC-TIME'].map((name) => table(name).length);
      expect(out.trim()).toBe(`J1 PROGRESS KAT PASS status=${counts[0]} display=${counts[1]} poll=${counts[2]} poll_run=${counts[3]} script=${counts[4]} utc=${counts[5]}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
