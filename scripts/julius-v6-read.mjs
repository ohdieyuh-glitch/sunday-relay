#!/usr/bin/env node
/**
 * THE V6 READER (row 2, G-5 instrument; V6_CODE_DESIGN section 7, V6_READING_AMENDMENT r2 section 3 E1-E9).
 *
 * ZERO NETWORK, ZERO SPEND, NO DEPENDENCIES. It reads files that were already downloaded:
 *
 *   --bundle <dir>          the evidence bundle (bundle-manifest.txt, approvals.tsv, transitions.tsv,
 *                           lifecycle-events.tsv, trajectory.tsv, budget.tsv, runs.tsv, tasks.tsv, ...)
 *   --log <file>            the paid job's log (HELD_FOR_APPROVAL, APPROVAL_DECIDED, RESULT, julius_exit=)
 *   --approvers <file>      the committed .github/julius-approvers.json
 *   --workflow-logins <s>   the founder workflow's literal JULIUS_APPROVER_LOGINS ("login#id,login#id")
 *   --contract <file>       the pinned mission contract.json
 *   --grant <file>          the committed grant, { "<markerNamespace>": [approvalGates...] }
 *   --ci-log <file>         a vitest `--reporter=verbose` log of the SAME head (E7, E8 read test names from it)
 *
 * and prints MET, NOT MET or UNKNOWN for each of E1..E9, with the rows each verdict relied on.
 *
 * THE RULES (the amendment's: "the stricter reading wins; UNKNOWN stays UNKNOWN"):
 *   - UNKNOWN is never MET. An input that is missing, reads `unavailable`, is truncated (its `(N rows)` footer
 *     disagrees with its rows) or lacks a column the item needs makes that item UNKNOWN, and never "empty so fine".
 *   - A fact that is read and contradicts the item is NOT MET, and NOT MET outranks UNKNOWN: one known failure
 *     decides the item whatever else is unread.
 *   - An item is MET only when every one of its checks was made and passed.
 *
 * NOT JUDGED HERE (the footer says so on every run): the hidden product oracles and independent scoring (matrix
 * section 6 (f)(g)), the served-model reading (R-MODEL), the blocking criteria's evidence ids, E10 (the budget fit),
 * and the contract-digest recomputation behind `:gate-<16 hex>`. This reader is evidence for the independent
 * review, never the review.
 *
 * Exit: 0 when every item is MET, 1 otherwise, 2 for a usage error.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const MET = 'MET';
export const NOT_MET = 'NOT MET';
export const UNKNOWN = 'UNKNOWN';
export const ITEMS = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9'];

/** The rows of trajectory that never reach a provider (julius-trajectory.ts JULIUS_PRE_PROVIDER_REFUSALS). */
const PRE_PROVIDER_REFUSALS = ['GOVERNANCE_HELD', 'APPROVAL_DENIED', 'POLICY_DENIED', 'CONTRACT_NOT_LOCKED', 'REVIEW_CONTRACT_MISMATCH', 'CONTRACT_STALE'];

/** The CI tests E7 and E8 read, by name (amendment E7, E8; F8). */
export const E7_TESTS = [
  'ADMISSION (F3): a run paused after its task was claimed spends no attempt',
  'ADMISSION (F3): a PENDING or a DENIED approval written after the claim refuses the admission',
  'ADMISSION LOCK (F3): an admission that meets a pause still being written waits for it, then refuses',
  'ADMISSION (F3): a run already over, or BLOCKED, while its task is still ACTIVE refuses the admission',
];
export const E8_TESTS = [
  'DENY: a denied gate fails the run, nothing is ever dispatched, and the record says who denied it',
  'REJECTED: a denied approval fails the run, and nothing is ever dispatched',
  'ENACTMENT: that denial ENDS the run at the next advance through the production store, and nothing is dispatched',
  '(c) DENY DRILL at zero spend: the run FAILED by APPROVAL_DENIED',
];

/* ------------------------------------------------------------------ files */

/** A verdict builder: collects failures (NOT MET), gaps (UNKNOWN) and the rows relied on. */
function item(id) {
  const fails = [];
  const gaps = [];
  const passes = [];
  const rows = [];
  return {
    id,
    fail(why) { if (!fails.includes(why)) fails.push(why); },
    gap(why) { if (!gaps.includes(why)) gaps.push(why); },
    pass(why) { if (!passes.includes(why)) passes.push(why); },
    rely(...ids) { for (const entry of ids) if (entry !== undefined && !rows.includes(entry)) rows.push(entry); },
    done() {
      const status = fails.length > 0 ? NOT_MET : gaps.length > 0 ? UNKNOWN : MET;
      return { id, status, because: [...fails.map((why) => `NOT MET: ${why}`), ...gaps.map((why) => `UNKNOWN: ${why}`), ...passes], rows };
    },
  };
}

/**
 * One psql -A TSV: header, data rows, and the `(N rows)` footer. `unavailable` is the dump's own word for a query that
 * failed. A footer that disagrees with the rows means the file was cut, and it is not read.
 */
export function parseTsv(text) {
  if (text === null) return { state: 'missing' };
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return { state: 'unreadable', why: 'empty file' };
  if (lines[0].trim() === 'unavailable') return { state: 'unavailable' };
  const footer = /^\((\d+) rows?\)$/u.exec(lines[lines.length - 1]);
  if (footer === null) return { state: 'unreadable', why: 'no (N rows) footer: the file is cut or is not a psql dump' };
  const header = lines[0].split('\t');
  const body = lines.slice(1, -1);
  if (Number(footer[1]) !== body.length) return { state: 'unreadable', why: `footer says ${footer[1]} rows, file holds ${body.length}` };
  const rows = body.map((line, index) => {
    const cells = line.split('\t');
    const row = { _line: index + 2 };
    header.forEach((name, column) => { row[name] = cells[column] ?? ''; });
    return row;
  });
  return { state: 'ok', header, rows };
}

/** key=value lines (bundle-manifest.txt, operator-approval.txt). */
export function parseKeyValues(text) {
  if (text === null) return null;
  const out = {};
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const match = /^([a-z_]+)=(.*)$/u.exec(line);
    if (match !== null) out[match[1]] = match[2];
  }
  return out;
}

/** A timestamp as BigInt microseconds since the epoch, or null. Reads psql's `2026-10-15 09:28:49.711-07` and ISO `...Z`. */
export function parseTime(value) {
  const match = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)(?:\.(\d{1,6}))?(Z|[+-]\d\d(?::?\d\d)?)?$/u.exec(String(value).trim());
  if (match === null) return null;
  const [, y, mo, d, h, mi, s, frac = '', zone = 'Z'] = match;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    offsetMinutes = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || '0'));
  }
  const seconds = BigInt(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000) - BigInt(offsetMinutes * 60);
  return seconds * 1_000_000n + BigInt(frac.padEnd(6, '0') || '0');
}

const readText = (path) => (path !== undefined && existsSync(path) ? readFileSync(path, 'utf8') : null);

/** Everything the reader needs, read once. `files` may inject text for tests; otherwise it reads the paths. */
export function loadInputs(options) {
  const bundle = options.bundle;
  const tsv = {};
  for (const name of ['approvals', 'transitions', 'lifecycle-events', 'trajectory', 'budget', 'runs', 'tasks', 'evidence', 'task-contracts', 'contract-events', 'settlement-integrity']) {
    tsv[name] = parseTsv(bundle === undefined ? null : readText(join(bundle, `${name}.tsv`)));
  }
  const json = (path) => {
    const text = readText(path);
    if (text === null) return { state: 'missing' };
    try { return { state: 'ok', value: JSON.parse(text) }; } catch { return { state: 'unreadable' }; }
  };
  return {
    tsv,
    manifest: parseKeyValues(bundle === undefined ? null : readText(join(bundle, 'bundle-manifest.txt'))),
    operator: parseKeyValues(bundle === undefined ? null : readText(join(bundle, 'operator-approval.txt'))),
    evidenceText: bundle === undefined ? null : readText(join(bundle, 'live-mission.evidence.txt')),
    log: options.log === undefined ? null : readText(options.log),
    ciLog: options.ciLog === undefined ? null : readText(options.ciLog),
    approvers: json(options.approvers),
    contract: json(options.contract),
    grant: json(options.grant),
    workflowLogins: options.workflowLogins ?? null,
  };
}

/* ------------------------------------------------------------------ helpers */

/** Tells an item the file is not usable: the right word for each way a TSV can be unusable. */
function need(it, inputs, name, columns) {
  const file = inputs.tsv[name];
  if (file.state !== 'ok') {
    it.gap(`${name}.tsv is ${file.state === 'unreadable' ? `unreadable (${file.why})` : file.state}`);
    return null;
  }
  const lacking = columns.filter((column) => !file.header.includes(column));
  if (lacking.length > 0) {
    it.gap(`${name}.tsv lacks column(s) ${lacking.join(', ')}`);
    return null;
  }
  return file.rows;
}

const at = (file, row, key) => `${file}.tsv:L${row._line}[${row[key]}]`;

/** Job-log lines, with a leading GitHub timestamp stripped. */
function logLines(text) {
  return text.replace(/\r/g, '').split('\n').map((line) => line.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /u, ''));
}

/** The log split at its `julius_exit=` lines: segments[i] is the output that ends at exits[i]. */
function logSegments(lines) {
  const segments = [];
  const exits = [];
  let current = [];
  lines.forEach((line, index) => {
    const exit = /^julius_exit=(\d+)$/u.exec(line);
    if (exit === null) { current.push({ line, index }); return; }
    segments.push(current);
    exits.push({ code: Number(exit[1]), index });
    current = [];
  });
  return { segments, exits, tail: current };
}

/** A provider-class attempt row of the trajectory (isJuliusProviderAttempt, read from the TSV's columns). */
function isProviderAttempt(row) {
  if (row.event_kind !== 'DISPATCH' && row.event_kind !== 'RETRY') return false;
  let facts = {};
  try { facts = JSON.parse(row.safe_facts || '{}'); } catch { /* unreadable facts are not a tool step */ }
  if (typeof facts.toolId === 'string' && facts.toolId !== '') return false;
  if (row.provider_id !== '') return true;
  const refusal = PRE_PROVIDER_REFUSALS.includes(row.outcome)
    && row.duration_ms === '' && row.usd_micros === '' && row.input_tokens === '' && row.output_tokens === '';
  return !refusal;
}

const canonical = (value) => JSON.stringify(value, (_key, v) => (v !== null && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, v[key]])) : v));

/** The run the bundle names, or null. */
function runIdOf(inputs) {
  const id = inputs.manifest?.julius_run_id;
  return id === undefined || id === 'none' || id === '' ? null : id;
}

/** The scope every item reads: the one run, its single approval and the facts about it that several items share. */
function gate(it, inputs, columnsNeeded = {}) {
  const runId = runIdOf(inputs);
  if (runId === null) { it.gap('bundle-manifest.txt names no julius_run_id (missing, or `none`): nothing can be scoped to a run'); return null; }
  const approvals = need(it, inputs, 'approvals', ['approval_id', 'run_id', 'task_id', 'operation', 'policy_revision', 'reason_code', 'state', 'requested_at', 'decided_at', 'decided_by', 'decision_reason', ...(columnsNeeded.approvals ?? [])]);
  if (approvals === null) return null;
  const mine = approvals.filter((row) => row.run_id === runId);
  if (mine.length !== 1) {
    it.fail(`approvals.tsv holds ${mine.length} approval row(s) for ${runId}; the V6 run has exactly ONE`);
    it.rely(...mine.map((row) => at('approvals', row, 'approval_id')));
    return null;
  }
  const row = mine[0];
  it.rely(at('approvals', row, 'approval_id'));
  const requestedAt = parseTime(row.requested_at);
  const decidedAt = row.decided_at === '' ? null : parseTime(row.decided_at);
  return { runId, approval: row, requestedAt, decidedAt };
}

/* ------------------------------------------------------------------ the items */

function e1(inputs) {
  const it = item('E1');
  const g = gate(it, inputs);
  const runs = need(it, inputs, 'runs', ['run_id', 'card_revision']);
  if (g === null || runs === null) return it.done();
  const run = runs.find((row) => row.run_id === g.runId);
  if (run === undefined) { it.fail(`runs.tsv has no row for ${g.runId}`); return it.done(); }
  it.rely(at('runs', run, 'run_id'));
  if (!/:gate-[0-9a-f]{16}$/u.test(run.card_revision)) it.fail(`runs.tsv card_revision ${run.card_revision} does not end in :gate-<16 hex>: the run was not gated by a clause`);
  else it.pass(`card_revision ${run.card_revision} carries a :gate-<16 hex> suffix`);
  if (g.approval.policy_revision !== run.card_revision) it.fail(`approvals.tsv policy_revision ${g.approval.policy_revision} differs from runs.tsv card_revision ${run.card_revision}`);
  else it.pass('approvals.tsv policy_revision equals runs.tsv card_revision');
  // The clause equals the committed grant (both directions).
  if (inputs.contract.state !== 'ok') it.gap(`--contract is ${inputs.contract.state}: the clause cannot be compared with the grant`);
  else if (inputs.grant.state !== 'ok') it.gap(`--grant is ${inputs.grant.state}: the clause cannot be compared with the grant`);
  else {
    const namespace = inputs.contract.value.markerNamespace;
    const clause = inputs.contract.value.approvalGates;
    const granted = typeof namespace === 'string' ? inputs.grant.value[namespace] : undefined;
    if (clause === undefined) it.fail('the pinned contract has no approvalGates clause');
    else if (granted === undefined) it.fail(`the committed grant has no entry for namespace ${namespace}`);
    else if (canonical(clause) !== canonical(granted)) it.fail('the contract clause does not equal the committed grant');
    else it.pass(`the contract clause equals the committed grant for ${namespace}`);
  }
  return it.done();
}

function e2(inputs) {
  const it = item('E2');
  const g = gate(it, inputs);
  const tasks = need(it, inputs, 'tasks', ['task_id', 'task_type', 'role']);
  const events = need(it, inputs, 'lifecycle-events', ['run_id', 'sequence', 'event_type', 'approval_id']);
  const transitions = need(it, inputs, 'transitions', ['run_id', 'sequence', 'to_state', 'reason_code']);
  if (g !== null) {
    if (g.approval.reason_code !== 'CARD_SCOPED_APPROVAL_REQUIRED') it.fail(`reason_code is ${g.approval.reason_code}, not CARD_SCOPED_APPROVAL_REQUIRED`);
    if (g.approval.state !== 'APPROVED') it.fail(`the approval's state is ${g.approval.state}; E2 reads PENDING -> APPROVED`);
    if (tasks !== null) {
      const task = tasks.find((row) => row.task_id === g.approval.task_id);
      it.rely(task === undefined ? undefined : at('tasks', task, 'task_id'));
      if (task === undefined) it.fail(`tasks.tsv has no task ${g.approval.task_id}`);
      else if (task.role !== 'CODING_AGENT' || task.task_type !== 'build') it.fail(`the gated task is ${task.role}/${task.task_type}, not the pre-registered CODING_AGENT/build`);
    }
    if (events !== null) {
      const requested = events.find((row) => row.run_id === g.runId && row.event_type === 'julius.approval.requested' && row.approval_id === g.approval.approval_id);
      if (requested === undefined) it.fail('lifecycle-events.tsv has no julius.approval.requested naming the approval');
      else it.rely(at('lifecycle-events', requested, 'approval_id'));
    }
    if (transitions !== null) {
      const blocked = transitions.filter((row) => row.run_id === g.runId && row.to_state === 'BLOCKED' && row.reason_code === 'APPROVAL_REQUIRED');
      if (blocked.length === 0) it.fail('transitions.tsv has no walk to BLOCKED with reason APPROVAL_REQUIRED');
      else it.rely(...blocked.map((row) => at('transitions', row, 'sequence')));
    }
    // LIVE-1's own words.
    if (inputs.log === null) it.gap('--log is missing: LIVE-1\'s HELD_FOR_APPROVAL line, its exit 3 and the absence of a RESULT line cannot be read');
    else {
      const { segments, exits } = logSegments(logLines(inputs.log));
      const first = segments[0];
      if (first === undefined) it.gap('the log holds no julius_exit= line: LIVE-1 never ended in this log');
      else {
        const held = first.filter(({ line }) => line.startsWith('HELD_FOR_APPROVAL: '));
        const right = held.filter(({ line }) => line.startsWith(`HELD_FOR_APPROVAL: run ${g.runId} approval ${g.approval.approval_id} `));
        if (right.length !== 1) it.fail(`LIVE-1 holds ${right.length} HELD_FOR_APPROVAL line(s) naming this run and approval (need exactly 1)`);
        else it.pass('LIVE-1 printed one HELD_FOR_APPROVAL line naming this run and approval');
        if (exits[0].code !== 3) it.fail(`LIVE-1 ended julius_exit=${exits[0].code}, not 3`);
        if (first.some(({ line }) => line.startsWith('RESULT:'))) it.fail('LIVE-1 printed a RESULT: line (a held run has none)');
        it.rely(`log:L${exits[0].index + 1}[julius_exit=${exits[0].code}]`, ...right.map(({ index }) => `log:L${index + 1}[HELD_FOR_APPROVAL]`));
      }
    }
  }
  return it.done();
}

/** The hold window rule shared by E3 and E4: no provider attempt and no reservation inside [requested_at, decided_at]. */
function windowChecks(it, inputs, g, { taskOnly }) {
  const trajectory = need(it, inputs, 'trajectory', ['event_kind', 'task_id', 'provider_id', 'outcome', 'safe_facts', 'occurred_at', 'run_id', 'usd_micros', 'duration_ms', 'input_tokens', 'output_tokens']);
  const budget = need(it, inputs, 'budget', ['run_id', 'sequence', 'task_id', 'event_type', 'occurred_at']);
  if (g.requestedAt === null) { it.gap('approvals.tsv requested_at is unreadable'); return; }
  if (g.decidedAt === null) { it.gap('approvals.tsv decided_at is empty or unreadable: the window has no end'); return; }
  const inWindow = (stamp) => { const t = parseTime(stamp); return t === null ? null : t >= g.requestedAt && t <= g.decidedAt; };
  const before = (stamp) => { const t = parseTime(stamp); return t === null ? null : t <= g.decidedAt; };
  const scope = (row) => row.run_id === g.runId && (!taskOnly || row.task_id === g.approval.task_id);
  const test = taskOnly ? before : inWindow;
  const label = taskOnly ? `before decided_at (the gated task ${g.approval.task_id})` : 'inside [requested_at, decided_at]';
  if (trajectory !== null) {
    for (const row of trajectory.filter((r) => scope(r) && isProviderAttempt(r))) {
      const inside = test(row.occurred_at);
      if (inside === null) it.gap(`${at('trajectory', row, 'event_kind')} has an unreadable occurred_at`);
      else if (inside) it.fail(`a provider-class ${row.event_kind} of ${row.task_id} sits ${label}`);
      if (inside) it.rely(at('trajectory', row, 'event_kind'));
    }
    for (const row of trajectory.filter((r) => scope(r) && r.outcome === 'GOVERNANCE_HELD')) {
      let facts = {};
      try { facts = JSON.parse(row.safe_facts || '{}'); } catch { /* read as empty */ }
      if (facts.handedBack !== true || !(Number(facts.pendingApprovals) >= 1)) it.fail(`a GOVERNANCE_HELD row (${at('trajectory', row, 'task_id')}) lacks handedBack=true and pendingApprovals>=1`);
    }
    it.pass(`trajectory.tsv read: ${trajectory.filter((r) => scope(r) && isProviderAttempt(r)).length} provider-class attempt row(s) in scope`);
  }
  if (budget !== null) {
    for (const row of budget.filter((r) => scope(r) && r.event_type === 'julius.budget.reserved')) {
      const inside = test(row.occurred_at);
      if (inside === null) it.gap(`${at('budget', row, 'sequence')} has an unreadable occurred_at`);
      else if (inside) { it.fail(`a julius.budget.reserved row for ${row.task_id} sits ${label}`); it.rely(at('budget', row, 'sequence')); }
    }
  }
}

function e3(inputs) {
  const it = item('E3');
  const g = gate(it, inputs);
  if (g !== null) windowChecks(it, inputs, g, { taskOnly: false });
  return it.done();
}

function e4(inputs) {
  const it = item('E4');
  const g = gate(it, inputs);
  if (g !== null) {
    windowChecks(it, inputs, g, { taskOnly: false });
    // And the gated task: nothing at all before the decision.
    windowChecks(it, inputs, g, { taskOnly: true });
  }
  return it.done();
}

function parseApproverId(raw) {
  const match = /^github:([A-Za-z0-9][A-Za-z0-9-]{0,38})#([1-9][0-9]{0,19})$/u.exec(raw);
  return match === null ? null : { login: match[1], id: match[2] };
}

function e5(inputs) {
  const it = item('E5');
  const g = gate(it, inputs);
  const events = need(it, inputs, 'lifecycle-events', ['run_id', 'sequence', 'event_type', 'approval_id', 'decision', 'decided_by']);
  const transitions = need(it, inputs, 'transitions', ['run_id', 'sequence', 'from_state', 'to_state', 'reason_code', 'occurred_at']);
  const evidence = need(it, inputs, 'evidence', ['evidence_id', 'task_id', 'run_id']);
  if (g === null) return it.done();
  const who = parseApproverId(g.approval.decided_by);
  if (g.approval.state !== 'APPROVED') it.fail(`the approval's state is ${g.approval.state}, not APPROVED`);
  if (who === null) it.fail(`decided_by "${g.approval.decided_by}" is not github:<login>#<numeric id>`);
  else {
    const same = (entry) => String(entry.id) === who.id && String(entry.login).toLowerCase() === who.login.toLowerCase();
    // The committed allowlist.
    if (inputs.approvers.state !== 'ok') it.gap(`--approvers is ${inputs.approvers.state}: the committed allowlist was not read`);
    else {
      const list = Array.isArray(inputs.approvers.value.approvers) ? inputs.approvers.value.approvers : [];
      const operations = Array.isArray(inputs.approvers.value.operations) ? inputs.approvers.value.operations : [];
      if (!list.some(same)) it.fail(`${g.approval.decided_by} is not in the committed .github/julius-approvers.json`);
      else it.pass('decided_by is in the committed allowlist');
      if (!operations.includes(g.approval.operation)) it.fail(`operation ${g.approval.operation} is not in the committed allowlist's operations`);
    }
    // The workflow's literal.
    if (inputs.workflowLogins === null) it.gap('--workflow-logins was not given: the workflow literal was not read');
    else {
      const entries = inputs.workflowLogins.split(/[\s,]+/u).filter((entry) => entry !== '').map((entry) => /^([^#]+)#(\d+)$/u.exec(entry)).filter(Boolean).map((m) => ({ login: m[1], id: m[2] }));
      if (!entries.some(same)) it.fail(`${g.approval.decided_by} is not in the founder workflow's JULIUS_APPROVER_LOGINS`);
      else it.pass('decided_by is in the workflow literal');
    }
  }
  // The reason cites the plan evidence.
  if (evidence !== null) {
    const planTask = g.approval.task_id.replace(/:build$/u, ':plan');
    const ids = evidence.filter((row) => row.run_id === g.runId && row.task_id === planTask).map((row) => row.evidence_id);
    if (ids.length === 0) it.gap(`evidence.tsv holds no evidence of the plan task ${planTask}: the cited id cannot be checked`);
    else if (!ids.some((id) => g.approval.decision_reason.includes(id))) it.fail('decision_reason cites none of the plan task\'s evidence ids');
    else it.pass('decision_reason cites a plan evidence id');
  }
  if (events !== null) {
    const decided = events.filter((row) => row.run_id === g.runId && row.event_type === 'julius.approval.decided' && row.approval_id === g.approval.approval_id);
    if (decided.length !== 1) it.fail(`lifecycle-events.tsv holds ${decided.length} julius.approval.decided row(s) for the approval (need 1)`);
    else {
      it.rely(at('lifecycle-events', decided[0], 'approval_id'));
      if (decided[0].decision !== 'APPROVED') it.fail(`the decided event says ${decided[0].decision}`);
      if (decided[0].decided_by !== g.approval.decided_by) it.fail(`the decided event names ${decided[0].decided_by} but approvals.tsv names ${g.approval.decided_by}`);
    }
  }
  if (transitions !== null) {
    const grants = transitions.filter((row) => row.run_id === g.runId && row.from_state === 'BLOCKED' && row.to_state === 'READY' && row.reason_code === 'APPROVAL_GRANTED');
    if (grants.length === 0) it.fail('transitions.tsv has no BLOCKED -> READY APPROVAL_GRANTED');
    else {
      it.rely(...grants.map((row) => at('transitions', row, 'sequence')));
      const stamp = parseTime(grants[0].occurred_at);
      if (g.decidedAt !== null && stamp !== null && stamp < g.decidedAt) it.fail('the APPROVAL_GRANTED transition is stamped before decided_at');
    }
  }
  // The person's own comment (G-W): operator-approval.txt.
  const op = inputs.operator;
  if (op === null) it.gap('operator-approval.txt is not in the bundle: the founder\'s comment (id, author, created_at == updated_at, later than the request stamp) cannot be read');
  else {
    const created = parseTime(op.created_at ?? '');
    const updated = parseTime(op.updated_at ?? '');
    const stamp = parseTime(op.request_stamp ?? '');
    if (op.comment_id === undefined || op.author_login === undefined || op.author_id === undefined || created === null || updated === null || stamp === null) it.gap('operator-approval.txt lacks comment_id/author/created_at/updated_at/request_stamp');
    else {
      if (created !== updated) it.fail('the accepted comment was edited (created_at != updated_at)');
      if (created <= stamp) it.fail('the accepted comment is not later than the request\'s GitHub-clock stamp');
      if (who !== null && (String(op.author_id) !== who.id || op.author_login.toLowerCase() !== who.login.toLowerCase())) it.fail('the comment\'s author is not the identity approvals.tsv records as decider');
      if (op.approval_id !== g.approval.approval_id) it.fail('the comment does not name this approval id');
      if (inputs.log !== null) {
        const decidedLine = logLines(inputs.log).find((line) => line.startsWith('APPROVAL_DECIDED '));
        if (decidedLine !== undefined && !decidedLine.includes(` comment=${op.comment_id}`)) it.fail('the decide step\'s line names a different comment id than operator-approval.txt');
      }
      it.pass('operator-approval.txt: one unedited comment, later than the request, by the recorded decider');
    }
  }
  void evidence;
  return it.done();
}

function e6(inputs) {
  const it = item('E6');
  const g = gate(it, inputs);
  const trajectory = need(it, inputs, 'trajectory', ['event_kind', 'task_id', 'provider_id', 'outcome', 'safe_facts', 'occurred_at', 'run_id', 'usd_micros', 'duration_ms', 'input_tokens', 'output_tokens']);
  const contracts = need(it, inputs, 'task-contracts', ['contract_revision', 'task_id', 'state', 'locked_at', 'run_id']);
  const contractEvents = need(it, inputs, 'contract-events', ['run_id', 'sequence', 'task_id', 'event_type', 'contract_task_id', 'occurred_at']);
  const tasks = need(it, inputs, 'tasks', ['task_id', 'task_type', 'parent_task_id']);
  if (g === null) return it.done();
  if (g.decidedAt === null) { it.gap('decided_at is empty or unreadable'); return it.done(); }
  const task = g.approval.task_id;
  if (trajectory !== null) {
    const mine = trajectory.filter((row) => row.run_id === g.runId && row.task_id === task && isProviderAttempt(row));
    const dispatches = mine.filter((row) => row.event_kind === 'DISPATCH');
    const retries = mine.filter((row) => row.event_kind === 'RETRY');
    const early = dispatches.filter((row) => { const t = parseTime(row.occurred_at); return t === null || t <= g.decidedAt; });
    const late = dispatches.filter((row) => { const t = parseTime(row.occurred_at); return t !== null && t > g.decidedAt; });
    it.rely(...mine.map((row) => at('trajectory', row, 'event_kind')));
    if (early.length > 0) it.fail(`${early.length} provider-class DISPATCH row(s) of the gated task are at or before decided_at`);
    if (late.length > 1) it.fail(`${late.length} provider-class DISPATCH rows of the gated task after the grant (exactly one allowed)`);
    if (late.length === 0 && early.length === 0) it.fail('no provider-class DISPATCH row of the gated task after the grant');
    if (late.length === 1 && early.length === 0 && late.length + retries.length === 1) it.pass('exactly one provider-class DISPATCH of the gated task, after decided_at');
    if (retries.length > 0) it.gap(`a RETRY of the gated task exists (${retries.length} row(s)): held to the independent review's ruling, never MET by default`);
  }
  // The build's contract re-locked after the grant: UNKNOWN.
  if (contracts !== null) {
    for (const row of contracts.filter((r) => r.run_id === g.runId && r.task_id === task)) {
      const locked = row.locked_at === '' ? null : parseTime(row.locked_at);
      if (locked !== null && locked > g.decidedAt) { it.gap(`the gated task's contract revision ${row.contract_revision} was locked after decided_at (a re-lock)`); it.rely(at('task-contracts', row, 'contract_revision')); }
    }
  }
  if (contractEvents !== null) {
    for (const row of contractEvents.filter((r) => r.run_id === g.runId && r.contract_task_id === task && ['julius.contract.locked', 'julius.contract.proposed', 'julius.contract.challenged'].includes(r.event_type))) {
      const stamp = parseTime(row.occurred_at);
      if (stamp !== null && stamp > g.decidedAt) { it.gap(`a ${row.event_type} of the gated task's contract is stamped after decided_at (a re-lock)`); it.rely(at('contract-events', row, 'sequence')); }
    }
  }
  if (tasks !== null) {
    const repairs = tasks.filter((row) => row.parent_task_id === task || row.task_type === 'repair:build');
    for (const row of repairs) it.pass(`note: ${row.task_id} (${row.task_type}) exists beside the gated task`);
  }
  return it.done();
}

function ciStatus(text, name) {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.includes(name));
  if (lines.length === 0) return { state: 'absent' };
  const states = lines.map((line) => {
    const t = line.trim();
    if (/^[✓√]/u.test(t)) return 'pass';
    if (/^[×✗✘]|^FAIL\b|^❯/u.test(t)) return 'fail';
    return 'other';
  });
  if (states.includes('fail')) return { state: 'fail', count: lines.length };
  if (states.includes('pass')) return { state: 'pass', count: lines.length };
  return { state: 'unclear', count: lines.length };
}

function ciChecks(it, inputs, names) {
  if (inputs.ciLog === null) { it.gap('--ci-log is missing: the same-head CI run\'s test names and counts were not read'); return; }
  for (const name of names) {
    const status = ciStatus(inputs.ciLog, name);
    if (status.state === 'pass') it.pass(`CI log: "${name}" passed`);
    else if (status.state === 'fail') it.fail(`CI log: "${name}" FAILED`);
    else if (status.state === 'absent') it.gap(`CI log: "${name}" does not appear (not executed, or not in this log)`);
    else it.gap(`CI log: "${name}" appears but not as a passed line (skipped, todo or unclear)`);
  }
}

function e7(inputs) {
  const it = item('E7');
  const g = gate(it, inputs);
  const trajectory = need(it, inputs, 'trajectory', ['event_kind', 'task_id', 'provider_id', 'outcome', 'safe_facts', 'occurred_at', 'run_id', 'usd_micros', 'duration_ms', 'input_tokens', 'output_tokens']);
  const transitions = need(it, inputs, 'transitions', ['run_id', 'sequence', 'from_state', 'to_state', 'reason_code', 'occurred_at']);
  if (g !== null && trajectory !== null && transitions !== null) {
    const grant = transitions.find((row) => row.run_id === g.runId && row.from_state === 'BLOCKED' && row.to_state === 'READY' && row.reason_code === 'APPROVAL_GRANTED');
    const attempts = trajectory.filter((row) => row.run_id === g.runId && row.task_id === g.approval.task_id && isProviderAttempt(row))
      .map((row) => ({ row, at: parseTime(row.occurred_at) }));
    if (grant === undefined) it.fail('no APPROVAL_GRANTED transition: admission cannot be the last check of a grant that is not recorded');
    else if (attempts.length === 0) it.fail('the gated task has no provider attempt');
    else if (attempts.some((a) => a.at === null)) it.gap('an attempt row has an unreadable occurred_at');
    else {
      const granted = parseTime(grant.occurred_at);
      const first = attempts.reduce((a, b) => (a.at <= b.at ? a : b));
      it.rely(at('transitions', grant, 'sequence'), at('trajectory', first.row, 'event_kind'));
      if (granted === null) it.gap('the APPROVAL_GRANTED transition has an unreadable occurred_at');
      else if (first.at <= granted) it.fail('the gated task\'s first provider attempt is not later than the APPROVAL_GRANTED transition');
      else it.pass('the gated task\'s first provider attempt is later than APPROVAL_GRANTED');
    }
  }
  ciChecks(it, inputs, E7_TESTS);
  return it.done();
}

function e8(inputs) {
  const it = item('E8');
  ciChecks(it, inputs, E8_TESTS);
  return it.done();
}

function e9(inputs) {
  const it = item('E9');
  const g = gate(it, inputs);
  const runs = need(it, inputs, 'runs', ['run_id', 'state']);
  const trajectory = need(it, inputs, 'trajectory', ['event_kind', 'outcome', 'run_id']);
  const settlement = need(it, inputs, 'settlement-integrity', []);
  const manifest = inputs.manifest;
  if (manifest === null) it.gap('bundle-manifest.txt is missing');
  else {
    if (manifest.mode !== 'paid') it.fail(`bundle-manifest mode=${manifest.mode}, not paid`);
    if (manifest.tracked_changes !== '0') it.fail(`bundle-manifest tracked_changes=${manifest.tracked_changes}, not 0`);
  }
  if (g !== null) {
    if (runs !== null) {
      const run = runs.find((row) => row.run_id === g.runId);
      if (run === undefined) it.fail(`runs.tsv has no row for ${g.runId}`);
      else { it.rely(at('runs', run, 'run_id')); if (run.state !== 'COMPLETED') it.fail(`runs.tsv state is ${run.state}, not COMPLETED`); }
    }
    if (trajectory !== null && !trajectory.some((row) => row.run_id === g.runId && row.event_kind === 'COMPLETION' && row.outcome === 'VERIFIED')) it.fail('trajectory.tsv has no COMPLETION row with outcome VERIFIED');
    if (settlement !== null && settlement.length !== 0) it.fail(`settlement-integrity.tsv holds ${settlement.length} data row(s); the healthy answer is none`);
    // The log.
    if (inputs.log === null) it.gap('--log is missing');
    else {
      const lines = logLines(inputs.log);
      const { segments, exits } = logSegments(lines);
      const exitCodes = exits.map((entry) => entry.code);
      if (exits.length < 2) {
        if (segments[0] !== undefined && exitCodes[0] === 3 && !lines.some((line) => line.startsWith('RESULT:'))) it.fail('the job ended held: one julius_exit=3 and no RESULT (a failed paid attempt, not a success)');
        else it.fail(`the log holds ${exits.length} julius_exit= line(s); a V6 success holds exactly two: 3 then 0`);
      } else {
        if (exits.length !== 2 || exitCodes[0] !== 3 || exitCodes[1] !== 0) it.fail(`julius_exit= lines read [${exitCodes.join(', ')}]; a V6 success reads exactly [3, 0]`);
        const results = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.startsWith('RESULT:'));
        if (results.length !== 1) it.fail(`the log holds ${results.length} RESULT: line(s); exactly one is allowed (the gate reads two as no answer)`);
        else {
          const [{ line, index }] = results;
          if (!/^RESULT: COMPLETED\b/u.test(line)) it.fail(`the RESULT line is "${line}", not COMPLETED`);
          if (exits[0] !== undefined && index < exits[0].index) it.fail('the RESULT line comes from LIVE-1, not from the resume');
          const below = lines.slice(index + 1, index + 4).find((candidate) => /^ {2}run: /u.test(candidate));
          if (below === undefined) it.fail('the RESULT line has no `  run:` line within three lines (the gate reads it as unattributed)');
          else if (below.trim() !== `run: ${g.runId}`) it.fail(`the RESULT is attributed to ${below.trim()}, not ${g.runId}`);
          else it.pass(`one RESULT: COMPLETED, attributed to ${g.runId}`);
          it.rely(`log:L${index + 1}[RESULT]`);
        }
        const decided = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.startsWith('APPROVAL_DECIDED '));
        const okDecided = decided.filter(({ line, index }) => line.includes(`approval=${g.approval.approval_id} `) && line.includes(' decision=APPROVED ') && line.includes(' run_state=READY') && exits[0] !== undefined && index > exits[0].index);
        if (okDecided.length !== 1) it.fail(`the log holds ${okDecided.length} matching APPROVAL_DECIDED ... decision=APPROVED run_state=READY line(s) after LIVE-1 (need 1)`);
        else it.rely(`log:L${okDecided[0].index + 1}[APPROVAL_DECIDED]`);
        const held = lines.filter((line) => line.startsWith('HELD_FOR_APPROVAL: '));
        if (held.length !== 1) it.fail(`the log holds ${held.length} HELD_FOR_APPROVAL line(s); a second hold ends the job held (one round only)`);
        const accepted = lines.filter((line) => /^Run \S+ accepted in state /u.test(line));
        if (accepted.some((line) => !line.startsWith(`Run ${g.runId} accepted `))) it.fail('an invocation accepted a different run id');
      }
    }
    // The bundle's allowlisted evidence (both invocations, the same run).
    if (inputs.evidenceText === null) it.gap('live-mission.evidence.txt is missing: both invocations\' allowlisted lines cannot be read');
    else {
      const lines = logLines(inputs.evidenceText);
      const runs2 = new Set(lines.filter((line) => /^ {2}run: /u.test(line)).map((line) => line.trim()));
      const accepted = lines.filter((line) => /^Run \S+ accepted in state /u.test(line));
      const foreign = [...runs2].filter((entry) => entry !== `run: ${g.runId}`);
      if (foreign.length > 0) it.fail(`live-mission.evidence.txt names another run: ${foreign.join('; ')}`);
      else if (accepted.length === 0 && runs2.size === 0) it.gap('live-mission.evidence.txt names no run at all');
      else it.pass('live-mission.evidence.txt names only this run');
    }
  }
  return it.done();
}

/* ------------------------------------------------------------------ driver */

export function readV6(options) {
  const inputs = loadInputs(options);
  return [e1, e2, e3, e4, e5, e6, e7, e8, e9].map((fn) => fn(inputs));
}

export const NOT_JUDGED = [
  'matrix section 6 (f)(g): the hidden product oracles and the independent scoring',
  'R-MODEL: the served-model reading on all three legs',
  'the blocking criteria\'s evidence ids',
  'E10: the budget fit (repairCycles <= 2, window <= 30 min, timeout-minutes 300)',
  'the contract-digest recomputation behind :gate-<16 hex>',
];

export function render(results) {
  const out = [];
  for (const result of results) {
    out.push(`${result.id}: ${result.status}`);
    for (const line of result.because) out.push(`  ${line}`);
    if (result.rows.length > 0) out.push(`  rows relied on: ${result.rows.join(' | ')}`);
  }
  out.push('', 'NOT JUDGED HERE:', ...NOT_JUDGED.map((entry) => `  - ${entry}`));
  return out.join('\n');
}

export function parseArgs(argv) {
  const options = {};
  const names = { '--bundle': 'bundle', '--log': 'log', '--approvers': 'approvers', '--workflow-logins': 'workflowLogins', '--contract': 'contract', '--grant': 'grant', '--ci-log': 'ciLog' };
  for (let i = 0; i < argv.length; i += 2) {
    const key = names[argv[i]];
    if (key === undefined || argv[i + 1] === undefined) return null;
    options[key] = argv[i + 1];
  }
  return options.bundle === undefined ? null : options;
}

export function main(argv, write = (text) => process.stdout.write(text)) {
  const options = parseArgs(argv);
  if (options === null) {
    write('usage: julius-v6-read.mjs --bundle <dir> [--log <file>] [--approvers <file>] [--workflow-logins <login#id,...>] [--contract <file>] [--grant <file>] [--ci-log <file>]\n');
    return 2;
  }
  const results = readV6(options);
  write(`${render(results)}\n`);
  return results.every((result) => result.status === MET) ? 0 : 1;
}

if (typeof process !== 'undefined' && process.argv[1] !== undefined && /julius-v6-read\.mjs$/u.test(process.argv[1].replace(/\\/g, '/'))) {
  process.exitCode = main(process.argv.slice(2));
}
