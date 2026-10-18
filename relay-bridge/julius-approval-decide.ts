/**
 * V6 G-4: THE DECIDE PATH. A PERSON ON A COMMITTED ALLOWLIST ANSWERS A HELD RUN'S ONE APPROVAL.
 *
 * `decideJuliusApproval` (`src/relay/mission/julius/julius-lifecycle-runtime.ts`) is complete: run checks, the
 * race-safe write (`decideApproval … WHERE state='PENDING'`), grant -> READY, deny -> FAILED. What did not exist
 * was a caller with a REAL authority: the only one composed anywhere (`composeJuliusStateApi`) refuses every
 * approval, deliberately, and nothing in the paid job could reach a run at all. This CLI is that caller, bundled
 * like the live entrypoint (`npm run relay:julius:decide:build`) so the founder's workflow step (G-W) can run it
 * inside the job, against the job's own store.
 *
 *   decide --contract <file> --approval <id> --decision APPROVED|DENIED
 *          --approver github:<login>#<numeric id> --reason-file <path> --comment-id <n>
 *
 * THE AUTHORITY (`committedApproverAuthority`). `mayApprove` is true ONLY when the approver's login AND numeric id
 * are in BOTH `.github/julius-approvers.json` (committed, reviewed, pinned with the mission) AND the founder
 * workflow's literal `JULIUS_APPROVER_LOGINS`, and the operation is in the file's `operations`. An empty,
 * unreadable or malformed list refuses everyone. There is no default and no `true`, and the bridge's
 * `mayApprove: async () => false` is untouched. Neither the worker App (which can write `.github/*.json`) nor a
 * workflow edit alone can add an approver.
 *
 * THE ROUTE-LEVEL GUARD (MAIN ruling, 2026-10-13). `decideJuliusApproval` has a latent defect, named in the V6
 * design and left for its own mission: on a CANCELLED run it WRITES `decidedBy = <the caller>` before its
 * blank-name and authority checks, and on an already-decided approval it RETURNS the decision and the run's state
 * before its authority check. No production caller reaches either branch today, and this one must not make them
 * reachable. So, in order, BEFORE ANY STORE ACCESS AT ALL (no read, no write):
 *   1. the approver identity must be non-blank and well formed (`github:<login>#<id>`)  -> APPROVER_REQUIRED / APPROVER_MALFORMED;
 *   2. it must be on BOTH committed lists                                                -> APPROVER_NOT_AUTHORIZED;
 *   3. the reason and the decision must be well formed                                   -> REASON_* / DECISION_INVALID.
 * Only then is the store read, and the CLI refuses, still before any write, unless the run is BLOCKED and holds
 * EXACTLY ONE PENDING approval equal to `--approval`, whose operation the file lists, and the reason cites the
 * run's plan evidence id. A cancelled run (not BLOCKED) and an already-decided approval (not PENDING) are
 * therefore refused here and never reach the kernel's two early branches; a blank or unauthorised caller learns
 * nothing about the run, because its refusal is printed before the run is read. `decideJuliusApproval` itself is
 * NOT modified: it is the proposed natural mission task (V6_MISSION_CONTRACT.r1).
 *
 * OUTCOMES, one machine line each: exit 0 `APPROVAL_DECIDED …`; exit 4 `APPROVAL_ALREADY_DECIDED …` (a race lost
 * at the store, never read as this caller's decision) or `APPROVAL_REFUSED reason=<code>`; exit 2 usage; exit 1 a
 * crash. The workflow continues ONLY on exit 0 with `decision=APPROVED run_state=READY`.
 *
 * NOT HERE (G-W's, with the founder's workflow commit): `request` and `await-comment`, the subcommands that print
 * the request and poll the pre-registered issue. They call this same `decideJuliusApprovalGuarded`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';

import {
  decideJuliusApproval,
  type JuliusApproverAuthority,
  type JuliusClock,
  type JuliusEventWriter,
  type JuliusIdFactory,
  type JuliusLifecycleDependencies,
  type JuliusPolicyOperation,
} from '../src/relay/mission/julius';
import { JuliusLifecyclePostgresRepository } from '../src/relay/persistence/julius-lifecycle-postgres';
import { listenJuliusPool } from '../src/relay/persistence/julius-pg-held';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JULIUS_RUNTIME_DATABASE_ENV_NAMES, juliusRuntimeDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { compileBootstrapRequest, parseLiveMissionContract } from './julius/mission-contract';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/* ----------------------------------------------------------- identities */

const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/u;
const NUMERIC_ID = /^[1-9][0-9]{0,19}$/u;

export interface JuliusApproverIdentity { readonly login: string; readonly id: string }

/** `github:<login>#<numeric id>`, or null. The numeric id is GitHub's, which a rename does not change. */
export function parseJuliusApproverId(raw: string): JuliusApproverIdentity | null {
  const match = /^github:([^#\s]+)#([^#\s]+)$/u.exec(raw);
  if (match === null || !LOGIN.test(match[1]!) || !NUMERIC_ID.test(match[2]!)) return null;
  return { login: match[1]!, id: match[2]! };
}

export interface JuliusApproverAllowlist {
  readonly approvers: readonly JuliusApproverIdentity[];
  readonly operations: readonly string[];
}

/**
 * `.github/julius-approvers.json`, strictly: `{ version: 1, about?, approvers: [{ login, id }], operations: [...] }`
 * and nothing it does not understand. Anything else is null, which refuses everyone.
 */
export function parseJuliusApproverAllowlist(text: string | null): JuliusApproverAllowlist | null {
  if (text === null) return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const file = value as Record<string, unknown>;
  if (Object.keys(file).some((key) => !['version', 'about', 'approvers', 'operations'].includes(key))) return null;
  if (file.version !== 1 || !Array.isArray(file.approvers) || !Array.isArray(file.operations)) return null;
  const approvers: JuliusApproverIdentity[] = [];
  for (const entry of file.approvers) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (Object.keys(entry).some((key) => key !== 'login' && key !== 'id')) return null;
    const { login, id } = entry as Record<string, unknown>;
    if (typeof login !== 'string' || !LOGIN.test(login) || typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
    approvers.push({ login, id: String(id) });
  }
  if (!file.operations.every((operation) => typeof operation === 'string' && /^[A-Z_]+$/u.test(operation))) return null;
  return { approvers, operations: file.operations as string[] };
}

/** The founder workflow's literal: `<login>#<id>` entries, comma or space separated. Malformed or empty: null. */
export function parseJuliusWorkflowApprovers(literal: string | undefined): readonly JuliusApproverIdentity[] | null {
  const entries = (literal ?? '').split(/[\s,]+/u).filter((entry) => entry !== '');
  if (entries.length === 0) return null;
  const parsed = entries.map((entry) => parseJuliusApproverId(`github:${entry}`));
  return parsed.every((entry): entry is JuliusApproverIdentity => entry !== null) ? parsed : null;
}

const sameIdentity = (a: JuliusApproverIdentity, b: JuliusApproverIdentity): boolean =>
  a.id === b.id && a.login.toLowerCase() === b.login.toLowerCase();

/**
 * THE COMMITTED AUTHORITY: the intersection of the committed file and the workflow literal, never the union.
 * `listed` answers the identity question alone (no operation, no store); `mayApprove` adds the operation.
 */
export function committedApproverAuthority(input: {
  readonly file: JuliusApproverAllowlist | null;
  readonly workflow: readonly JuliusApproverIdentity[] | null;
}): JuliusApproverAuthority & { listed(approverId: string): boolean } {
  const listed = (approverId: string): boolean => {
    const who = parseJuliusApproverId(approverId);
    if (who === null || input.file === null || input.workflow === null) return false;
    return input.file.approvers.some((entry) => sameIdentity(entry, who)) && input.workflow.some((entry) => sameIdentity(entry, who));
  };
  return {
    listed,
    async mayApprove({ approverId, operation }) {
      return listed(approverId) && input.file !== null && input.file.operations.includes(operation);
    },
  };
}

/* ---------------------------------------------------------- the citation */

/**
 * THE PLAN EVIDENCE A DECISION MUST CITE (contract section 5): the newest PASSED evidence row of the run's
 * SUCCEEDED plan task. The request summary prints the same id; a reason that does not contain it is refused.
 */
export function juliusPlanCitation(
  tasks: readonly { readonly taskId: string; readonly taskType: string; readonly state: string }[],
  evidence: readonly { readonly evidenceId: string; readonly taskId: string; readonly status: string; readonly occurredAt: string }[],
): string | null {
  const plans = new Set(tasks.filter((task) => task.taskType === 'plan' && task.state === 'SUCCEEDED').map((task) => task.taskId));
  const rows = evidence.filter((row) => plans.has(row.taskId) && row.status === 'PASSED')
    .sort((a, b) => (a.occurredAt === b.occurredAt ? a.evidenceId.localeCompare(b.evidenceId) : a.occurredAt.localeCompare(b.occurredAt)));
  return rows.length === 0 ? null : rows[rows.length - 1]!.evidenceId;
}

/** Printable ASCII without the characters a shell, a log command or a template could act on. */
const SAFE_REASON = /^[\x20-\x7E]+$/u;
const UNSAFE_IN_REASON = /[`$\\<>|]/u;

/* --------------------------------------------------- the guarded decide */

export type JuliusDecideStore = JuliusLifecycleDependencies['store'] & {
  tasksForRun(runId: string, projectId: string): Promise<readonly { readonly taskId: string; readonly taskType: string; readonly state: string }[]>;
  evidenceForRun(runId: string, projectId: string): Promise<readonly { readonly evidenceId: string; readonly taskId: string; readonly status: string; readonly occurredAt: string }[]>;
};

export interface JuliusDecideInput {
  readonly runId: string;
  readonly projectId: string;
  readonly approvalId: string;
  readonly decision: string;
  readonly approverId: string;
  readonly reason: string;
  readonly commentId: string;
}

export interface JuliusDecideResult { readonly exitCode: 0 | 4; readonly line: string }

const refused = (reasonCode: string): JuliusDecideResult => ({ exitCode: 4, line: `APPROVAL_REFUSED reason=${reasonCode}` });

/**
 * STEPS 1-3, FROM THE ARGUMENTS ALONE: the refusal, or null when the store may be read. It takes no store, so it
 * cannot read or write one, and a caller it refuses learns nothing about any run.
 */
export function juliusDecidePrecheck(
  input: JuliusDecideInput,
  authority: Pick<ReturnType<typeof committedApproverAuthority>, 'listed'>,
): JuliusDecideResult | null {
  if (input.approverId.trim() === '') return refused('APPROVER_REQUIRED');
  if (parseJuliusApproverId(input.approverId) === null) return refused('APPROVER_MALFORMED');
  if (!authority.listed(input.approverId)) return refused('APPROVER_NOT_AUTHORIZED');
  if (input.decision !== 'APPROVED' && input.decision !== 'DENIED') return refused('DECISION_INVALID');
  if (input.reason.trim() === '') return refused('REASON_REQUIRED');
  if (input.reason.length > 280) return refused('REASON_TOO_LONG');
  if (!SAFE_REASON.test(input.reason) || UNSAFE_IN_REASON.test(input.reason)) return refused('REASON_UNSAFE');
  if (!NUMERIC_ID.test(input.commentId)) return refused('COMMENT_ID_INVALID');
  return null;
}

export async function decideJuliusApprovalGuarded(
  input: JuliusDecideInput,
  deps: {
    readonly store: JuliusDecideStore;
    readonly authority: ReturnType<typeof committedApproverAuthority>;
    readonly clock: JuliusClock;
    readonly events?: JuliusEventWriter;
    readonly ids?: JuliusIdFactory;
  },
): Promise<JuliusDecideResult> {
  /* 1-3. WHO, AND IN WHAT WORDS: decided from the arguments alone, before the store is touched. */
  const early = juliusDecidePrecheck(input, deps.authority);
  if (early !== null) return early;

  /* 4. WHAT IS BEING DECIDED: read only now, and still nothing is written unless all of it holds. */
  const run = await deps.store.loadRun(input.runId, input.projectId);
  if (run === null) return refused('RUN_NOT_FOUND');
  if (run.state !== 'BLOCKED') return refused('RUN_NOT_BLOCKED');
  const pending = await deps.store.pendingApprovals(input.runId, input.projectId);
  if (pending.length !== 1) return refused('NOT_EXACTLY_ONE_PENDING_APPROVAL');
  const gate = pending[0]!;
  if (gate.approvalId !== input.approvalId) return refused('APPROVAL_NOT_THE_PENDING_ONE');
  if (!(await deps.authority.mayApprove({
    projectId: input.projectId, runId: input.runId, approverId: input.approverId, operation: gate.operation as JuliusPolicyOperation,
  }))) return refused('APPROVER_NOT_AUTHORIZED');
  const citation = juliusPlanCitation(
    await deps.store.tasksForRun(input.runId, input.projectId), await deps.store.evidenceForRun(input.runId, input.projectId));
  if (citation === null) return refused('NO_PLAN_EVIDENCE');
  if (!input.reason.includes(citation)) return refused('REASON_UNCITED');

  /* 5. THE DECISION, through the one production path, with the same authority as its port. */
  const outcome = await decideJuliusApproval({
    runId: input.runId, projectId: input.projectId, approvalId: input.approvalId,
    // Checked by the precheck above: exactly APPROVED or DENIED.
    decision: input.decision as 'APPROVED' | 'DENIED', approverId: input.approverId, reason: input.reason,
  }, {
    store: deps.store, clock: deps.clock, approvers: deps.authority,
    ...(deps.events === undefined ? {} : { events: deps.events }),
    ...(deps.ids === undefined ? {} : { ids: deps.ids }),
  });
  if (!outcome.decided) return refused(outcome.reasonCode);
  // A RACE LOST AT THE STORE (or a retry) is somebody else's decision, never this caller's.
  if (outcome.duplicate) return { exitCode: 4, line: `APPROVAL_ALREADY_DECIDED approval=${input.approvalId}` };
  return {
    exitCode: 0,
    line: `APPROVAL_DECIDED approval=${input.approvalId} decision=${outcome.state} by=${input.approverId} run_state=${outcome.runState} comment=${input.commentId}`,
  };
}

/* ------------------------------------------------------------ composition */

/** The CLI's store: the same repositories the mission job writes through, every method bound to its owner. */
export function composeJuliusDecideStore(pool: Pool): { store: JuliusDecideStore; events: JuliusEventWriter } {
  const runtime = createJuliusPostgresRuntimeStore(pool);
  const runs = new JuliusPostgresRepository(pool);
  const lifecycle = new JuliusLifecyclePostgresRepository(pool);
  const store: JuliusDecideStore = {
    loadRun: runs.loadRun.bind(runs),
    transition: runs.transition.bind(runs),
    requestApproval: lifecycle.requestApproval.bind(lifecycle),
    loadApproval: lifecycle.loadApproval.bind(lifecycle),
    pendingApprovals: lifecycle.pendingApprovals.bind(lifecycle),
    decideApproval: lifecycle.decideApproval.bind(lifecycle),
    cancelRunTasks: lifecycle.cancelRunTasks.bind(lifecycle),
    recordLifecycle: lifecycle.recordLifecycle.bind(lifecycle),
    tasksForRun: runtime.tasksForRun.bind(runtime),
    evidenceForRun: runtime.evidenceForRun.bind(runtime),
  };
  return { store, events: runtime };
}

/** The committed file, read from the checkout the CLI runs in; unreadable is null, which refuses everyone. */
export const JULIUS_APPROVERS_FILE = '.github/julius-approvers.json';
export function readJuliusApproverFile(root: string): string | null {
  try { return readFileSync(join(root, ...JULIUS_APPROVERS_FILE.split('/')), 'utf8'); } catch { return null; }
}

/** The run a contract names: `run:` + the contract-derived idempotency key, exactly as the bootstrap derives it. */
export function juliusRunIdForContract(raw: string): { ok: true; runId: string; projectId: string } | { ok: false; problem: string } {
  const parsed = parseLiveMissionContract(raw);
  if (!parsed.ok) return parsed;
  return { ok: true, runId: `run:${compileBootstrapRequest(parsed.contract, [], 'unused').idempotencyKey}`, projectId: parsed.contract.projectId };
}

/* ------------------------------------------------------------------ main */

const USAGE = 'Usage: julius-approval-decide decide --contract <file> --approval <id> --decision APPROVED|DENIED --approver github:<login>#<id> --reason-file <path> --comment-id <n>';

async function main(argv: readonly string[]): Promise<number> {
  const out = (line: string): void => { process.stdout.write(`${line.replace(/[\r\n]/gu, ' ')}\n`); };
  const option = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1]! : null;
  };
  const names = ['contract', 'approval', 'decision', 'approver', 'reason-file', 'comment-id'] as const;
  if (argv[0] !== 'decide' || names.some((name) => option(name) === null)) { out(USAGE); return 2; }
  let rawContract: string;
  let reason: string;
  try { rawContract = readFileSync(option('contract')!, 'utf8'); } catch { out('APPROVAL_REFUSED reason=CONTRACT_UNREADABLE'); return 4; }
  try { reason = readFileSync(option('reason-file')!, 'utf8').replace(/\r?\n$/u, ''); } catch { out('APPROVAL_REFUSED reason=REASON_UNREADABLE'); return 4; }
  const target = juliusRunIdForContract(rawContract);
  if (!target.ok) { out('APPROVAL_REFUSED reason=CONTRACT_REFUSED'); return 4; }
  const authority = committedApproverAuthority({
    file: parseJuliusApproverAllowlist(readJuliusApproverFile(process.cwd())),
    workflow: parseJuliusWorkflowApprovers(process.env.JULIUS_APPROVER_LOGINS),
  });
  const input: JuliusDecideInput = {
    runId: target.runId, projectId: target.projectId, approvalId: option('approval')!, decision: option('decision')!,
    approverId: option('approver')!, reason, commentId: option('comment-id')!,
  };
  // The identity, the lists and the words are judged before a database is even opened.
  const early = juliusDecidePrecheck(input, authority);
  if (early !== null) { out(early.line); return early.exitCode; }
  const databaseUrl = juliusRuntimeDatabaseUrl(process.env as Record<string, string | undefined>);
  if (databaseUrl === null) { out(`APPROVAL_REFUSED reason=DATABASE_UNCONFIGURED (${JULIUS_RUNTIME_DATABASE_ENV_NAMES.join(' or ')})`); return 4; }
  const pool = listenJuliusPool(new Pool({ connectionString: databaseUrl }), 'julius approval decide');
  try {
    const { store, events } = composeJuliusDecideStore(pool);
    const result = await decideJuliusApprovalGuarded(input, {
      store, events, authority, clock: { now: () => new Date().toISOString() }, ids: { next: (kind) => `${kind}:${randomUUID()}` },
    });
    out(result.line);
    return result.exitCode;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/* The esbuild bundle runs this file directly; the bridge tsconfig forbids import.meta. */
if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stdout.write(`JULIUS APPROVAL DECIDE crashed: ${error instanceof Error ? error.message.slice(0, 200).replace(/[\r\n]/gu, ' ') : 'unknown error'}\n`);
      process.exitCode = 1;
    },
  );
}
