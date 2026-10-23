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
 *   1. Restates the progress rules (P1-P7 in the header) independently in TypeScript and checks EVERY row of every
 *      KAT table against them, so no expected value is anyone's say-so and none can be edited alone.
 *   2. Holds the status vocabularies to their sources: JULIUS_MISSION_STATES and JULIUS_TERMINAL_MISSION_STATES are
 *      read from src/relay/mission/julius/julius-runtime.ts on this tree; BRIDGE's AdmissionState
 *      (#407 dd0153a0, src/relay/integration/wonderland-admission/admission-store.ts) is restated here and compared
 *      with that file whenever it is on the tree.
 *   3. Checks that the scripts cover every transition out of every non-terminal state, every terminal against every
 *      kind of later answer, the run-id mismatch, no dispatch after Accepted and the poll cap.
 *   4. Compiles and runs the C++ KAT with -Werror when a C++ compiler is present. CI (ubuntu-latest) has one; a CI run
 *      without one FAILS rather than reporting a pass for C++ it never ran.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');
const CPP_DIR = join(ROOT, 'wonderland', 'Source', 'Wonderland');
const PROGRESS_H = join(CPP_DIR, 'WonderlandJuliusMissionProgress.h');
const PROGRESS_CPP = join(CPP_DIR, 'WonderlandJuliusMissionProgress.cpp');
const LOGIC_CPP = join(CPP_DIR, 'WonderlandJuliusMissionLogic.cpp');
const KAT = join(ROOT, 'wonderland', 'Tools', 'j1_progress_kat.cpp');
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
    const cells = [...trimmed.matchAll(/"((?:[^"\\]|\\.)*)"|E(?:MissionProgress|StatusVocabulary|PollStep)::(\w+)|\b(\d+)\b/gu)]
      .map((match) => (match[1] !== undefined ? cString(match[1]) : (match[2] ?? match[3] ?? '')));
    rows.push(cells);
  }
  if (rows.length === 0) throw new Error(`KAT section ${name} is empty`);
  return rows;
}

/* ------------------------------------------------------------------ the rules, restated */

const ADMISSION_STATES = ['RESERVED', 'ADMISSION_HELD', 'LEDGER_UNWRITTEN', 'INTERRUPTED', 'FAILED'] as const;
const STATES = ['AwaitingDispatchAnswer', 'AdmittedHeld', 'Dispatched', 'Running', 'Paused', 'Waiting', 'Succeeded',
  'Failed', 'Refused', 'DispatchFailed', 'RunIdMismatch', 'AnswerInvalid', 'PollLimitReached'] as const;
type State = typeof STATES[number];
const TERMINAL: readonly State[] = ['Succeeded', 'Failed', 'Refused', 'DispatchFailed', 'RunIdMismatch', 'AnswerInvalid', 'PollLimitReached'];
const NON_TERMINAL_AFTER_ACCEPT: readonly State[] = ['AdmittedHeld', 'Dispatched', 'Running', 'Paused', 'Waiting'];

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

const POLL = { base: 5000, factor: 2, cap: 60000, maxCount: 240, maxTotal: 10_800_000 } as const;
function referencePoll(sent: number, watched: number): [string, number] {
  if (sent >= POLL.maxCount) return ['Stop', 0];
  const delay = Math.min(POLL.base * POLL.factor ** Math.min(sent, 10), POLL.cap);
  if (watched > POLL.maxTotal || delay > POLL.maxTotal - watched) return ['Stop', 0];
  return ['WaitThenPoll', delay];
}

const CLIENT_OK = 'wlj_0b1f3c2a-5d4e-4f60-8a71-92b3c4d5e6f7';
const CLIENT_OTHER = 'wlj_7e6d5c4b-3a29-4180-9f7e-6d5c4b3a2918';
const SERVER: Readonly<Record<string, string>> = {
  S1: 'run:0123456789abcdef01234567', S2: 'run:89abcdef0123456789abcdef', bad: 'run:0123456789ABCDEF01234567', short: 'run:0123', none: '',
};
const SERVER_RUN_ID = /^run:[0-9a-f]{24}$/u;

interface Answer { http: number; hasError: boolean; kind: string; hasData: boolean; vocab: string; client: string; server: string; status: string }
interface Step { from: State; to: State; event: string; kind: string }

function parseAnswer(fields: string[], vocab: string): Answer {
  const [http, err, client, server, status] = fields;
  const hasData = client !== 'nodata';
  return {
    http: Number(http), hasError: err !== '-', kind: err === '-' || err === '~' ? '' : (err ?? ''), hasData, vocab,
    client: client === 'ok' ? CLIENT_OK : client === 'other' ? CLIENT_OTHER : '',
    server: hasData ? (SERVER[server ?? ''] ?? '') : '', status: status === '-' || !hasData ? '' : (status ?? ''),
  };
}
const NO_ANSWER: Answer = { http: 0, hasError: false, kind: '', hasData: false, vocab: 'Unknown', client: '', server: '', status: '' };

/** The tracker, restated from the header's P1-P7. Returns every step, like the C++ trace. */
function referenceRun(script: string): { state: State; pinned: string; polls: number; steps: Step[] } {
  let state: State = 'AwaitingDispatchAnswer';
  let pinned = '';
  let polls = 0;
  const steps: Step[] = [{ from: state, to: state, event: 'started', kind: 'start' }];
  const move = (event: string, to: State, kind: string) => { steps.push({ from: state, to, event, kind }); state = to; };
  const mismatched = (answer: Answer) => (answer.server !== '' && answer.server !== pinned) || (answer.client !== '' && answer.client !== CLIENT_OK);
  for (const token of script === '' ? [] : script.split(' ')) {
    const fields = token.split(',');
    if (token === 'D0' || fields[0] === 'D') {
      const answer = token === 'D0' ? NO_ANSWER : parseAnswer(fields.slice(1), 'Admission');
      const verdict = referenceAnswer(answer.http, answer.hasError, answer.kind);
      if (TERMINAL.includes(state)) move('ignored_after_terminal', state, 'dispatch');
      else if (state === 'AwaitingDispatchAnswer') {
        if (verdict === 'NoAnswer') move('dispatch_unanswered', state, 'dispatch');
        else if (verdict === 'Refused') move('dispatch_refused', 'Refused', 'dispatch');
        else if (!answer.hasData || !SERVER_RUN_ID.test(answer.server) || answer.client === '') move('answer_rejected', 'AnswerInvalid', 'dispatch');
        else if (answer.client !== CLIENT_OK) move('run_id_mismatched', 'RunIdMismatch', 'dispatch');
        else { pinned = answer.server; move('admitted', referenceStatus('Admission', answer.status), 'dispatch'); }
      } else if (verdict !== 'Accepted') move('late_dispatch_answer_ignored', state, 'late');
      else if (mismatched(answer)) move('run_id_mismatched', 'RunIdMismatch', 'late');
      else if (!answer.hasData || answer.server === '' || answer.client === '') move('late_dispatch_answer_ignored', state, 'late');
      else move('dispatch_replayed', referenceStatus('Admission', answer.status), 'late');
    } else if (token === 'P0' || fields[0] === 'P') {
      const answer = token === 'P0' ? NO_ANSWER : parseAnswer([fields[1] ?? '', fields[2] ?? '', ...fields.slice(4)], { A: 'Admission', J: 'JuliusRun' }[fields[3] ?? ''] ?? 'Unknown');
      if (state === 'AwaitingDispatchAnswer') { move('poll_failed', state, 'poll'); continue; }
      polls = Math.min(polls + 1, POLL.maxCount);
      const readable = answer.http >= 200 && answer.http <= 299 && !answer.hasError && answer.kind === '' && answer.hasData;
      if (TERMINAL.includes(state)) move('ignored_after_terminal', state, 'poll');
      else if (!readable) move('poll_failed', state, 'poll');
      else if (mismatched(answer)) move('run_id_mismatched', 'RunIdMismatch', 'poll');
      else if (answer.server === '' || (answer.vocab === 'Admission' && answer.client === '')) move('poll_failed', state, 'poll');
      else move('status_applied', referenceStatus(answer.vocab, answer.status), 'poll');
    } else if (fields[0] === 'N' && fields.length === 2) {
      if (state === 'AwaitingDispatchAnswer' || TERMINAL.includes(state)) continue;
      if (referencePoll(polls, Number(fields[1]))[0] === 'Stop') move('poll_limit_reached', 'PollLimitReached', 'next');
    } else {
      throw new Error(`malformed script step ${token}`);
    }
  }
  return { state, pinned, polls, steps };
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
    expect(Object.keys(ADMISSION_GROUPS)).toEqual([...ADMISSION_STATES]);
    if (existsSync(ADMISSION_STORE)) {
      const union = /export type AdmissionState = ([^;]+);/u.exec(source(ADMISSION_STORE))?.[1] ?? '';
      expect([...union.matchAll(/'([A-Z_]+)'/gu)].map((match) => match[1])).toEqual([...ADMISSION_STATES]);
    }
  });

  it('every status row expects what the restated map gives, and every vocabulary word has a row', () => {
    const rows = table('KAT-PROGRESS-STATUS');
    for (const [label, vocabulary, status, expected] of rows) {
      expect(expected, `${label}`).toBe(referenceStatus(vocabulary ?? '', status ?? ''));
      if (vocabulary === 'Admission') expect(['AdmittedHeld', 'Waiting', 'DispatchFailed'], `P7 ${label}`).toContain(expected);
    }
    const has = (vocabulary: string, status: string) => rows.some((row) => row[1] === vocabulary && row[2] === status);
    for (const word of ADMISSION_STATES) expect(has('Admission', word), word).toBe(true);
    for (const word of juliusStates().all) expect(has('JuliusRun', word), word).toBe(true);
    // Cross-vocabulary words, case variants, padding, empty and free text are all Waiting.
    for (const label of ['admission_julius_completed', 'julius_admission_held', 'julius_lowercase_completed', 'julius_mixed_case',
      'admission_padded', 'admission_trailing', 'admission_empty', 'julius_empty', 'julius_free_text', 'unknown_completed', 'julius_prefix']) {
      expect(rows.find((row) => row[0] === label)?.[3], label).toBe('Waiting');
    }
  });
});

describe('J1 progress logic: the words on screen claim nothing', () => {
  it('one display row per state, terminal flags match, the admitted words are exact, and nothing claims spend or PASS', () => {
    const rows = table('KAT-PROGRESS-DISPLAY');
    expect(rows.map((row) => row[1])).toEqual([...STATES]);
    for (const [name, state, label, terminal, send] of rows) {
      expect(terminal, `${name} terminal`).toBe(TERMINAL.includes(state as State) ? '1' : '0');
      expect(send, `${name} send`).toBe(state === 'AwaitingDispatchAnswer' ? '1' : '0');
      expect(label ?? '', name).not.toMatch(/pass|spen[dt]|cost|\$|qualif|verified|success|charged|paid for/iu);
    }
    expect(rows.find((row) => row[1] === 'AdmittedHeld')?.[2]).toBe('Admitted \u2014 waiting for the paid run');
    expect(rows.find((row) => row[1] === 'Running')?.[2]).not.toMatch(/admitted/iu);
    expect(source(PROGRESS_CPP)).toContain('"Admitted \\xE2\\x80\\x94 waiting for the paid run"');
    expect(/[^\x00-\x7f]/u.test(source(PROGRESS_CPP)) || /[^\x00-\x7f]/u.test(source(PROGRESS_H)), 'sources stay ASCII').toBe(false);
  });
});

describe('J1 progress logic: polling is bounded and never dispatches (P4, P5)', () => {
  it('every poll row expects the restated schedule, and the header states the same constants', () => {
    for (const [label, sent, watched, step, delay] of table('KAT-POLL')) {
      expect([step, Number(delay)], label).toEqual(referencePoll(Number(sent), Number(watched)));
    }
    const header = source(PROGRESS_H);
    expect(header).toContain(`PollBaseDelayMs = ${POLL.base};`);
    expect(header).toContain(`PollGrowthFactor = ${POLL.factor};`);
    expect(header).toContain(`PollMaxDelayMs = ${POLL.cap};`);
    expect(header).toContain(`PollMaxCount = ${POLL.maxCount};`);
    expect(header).toContain(`PollMaxTotalWatchMs = ${POLL.maxTotal};`);
  });

  it('every poll-run row reaches the limit after exactly the restated number of polls', () => {
    const rows = table('KAT-POLL-RUN');
    for (const [label, answer, requestMs, polls, watchedMs] of rows) {
      let sent = 0;
      let watched = 0;
      for (;;) {
        const [step, delay] = referencePoll(sent, watched);
        if (step === 'Stop') break;
        if (answer !== 'frozen') watched += delay + Number(requestMs);
        sent += 1;
      }
      expect([sent, watched], label).toEqual([Number(polls), Number(watchedMs)]);
    }
    expect(rows.some((row) => row[1] === 'frozen' && row[3] === String(POLL.maxCount)), 'the count cap is reached').toBe(true);
    expect(rows.some((row) => row[1] === 'fail'), 'failing polls are run').toBe(true);
  });
});

describe('J1 progress logic: the state machine (P1, P2, P3)', () => {
  const rows = table('KAT-PROGRESS-SCRIPT');
  const runs = rows.map((row) => ({ row, run: referenceRun(row[1] ?? '') }));

  it('every script row expects what the restated rules give', () => {
    for (const { row, run } of runs) {
      const [label, , final, lastEvent, pinned, send] = row;
      expect(run.state, `${label} state`).toBe(final);
      expect(run.steps.at(-1)?.event, `${label} last event`).toBe(lastEvent);
      expect(run.pinned, `${label} pinned`).toBe(SERVER[pinned ?? ''] ?? '');
      expect(send, `${label} send allowed`).toBe(run.state === 'AwaitingDispatchAnswer' ? '1' : '0');
    }
  });

  it('every transition out of every non-terminal state is exercised', () => {
    const seen = new Set(runs.flatMap(({ run }) => run.steps.map((step) => `${step.from}>${step.to}`)));
    const targets: State[] = ['AdmittedHeld', 'Dispatched', 'Running', 'Paused', 'Waiting', 'Succeeded', 'Failed', 'DispatchFailed', 'RunIdMismatch', 'PollLimitReached'];
    for (const from of NON_TERMINAL_AFTER_ACCEPT) {
      for (const to of targets) expect(seen.has(`${from}>${to}`), `${from} -> ${to}`).toBe(true);
    }
    for (const to of ['AwaitingDispatchAnswer', 'Refused', 'AdmittedHeld', 'Waiting', 'DispatchFailed', 'AnswerInvalid', 'RunIdMismatch']) {
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

  it('the header states the rules the scripts pin', () => {
    const header = source(PROGRESS_H);
    for (const text of ['P1 NO SECOND DISPATCH', 'P2 THE SERVER RUN ID IS PINNED', 'P3 TERMINALS ARE STICKY', 'P4 POLLING NEVER DISPATCHES',
      'P5 THE POLL SCHEDULE IS BOUNDED', 'P6 NO SPEND, NO PASS', 'P7 A 202 IS NOT A RUNNING MISSION', '#407 defines NO status endpoint',
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
      const counts = ['KAT-PROGRESS-STATUS', 'KAT-PROGRESS-DISPLAY', 'KAT-POLL', 'KAT-POLL-RUN', 'KAT-PROGRESS-SCRIPT'].map((name) => table(name).length);
      expect(out.trim()).toBe(`J1 PROGRESS KAT PASS status=${counts[0]} display=${counts[1]} poll=${counts[2]} poll_run=${counts[3]} script=${counts[4]}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
