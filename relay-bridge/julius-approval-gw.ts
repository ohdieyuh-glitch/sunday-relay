/**
 * V6 G-W: THE TWO SUBCOMMANDS BEHIND THE FOUNDER'S IN-JOB APPROVAL STEP (form (b)).
 *
 *   request        print the held run's ONE pending approval as fixed-shape lines and record GitHub's own clock
 *   await-comment  poll the pre-registered issue for the founder's `APPROVE|DENY <approvalId> <reason>` comment
 *
 * `julius-approval-decide.ts` composes them (its `main` dispatches on the first argument) and owns the guarded
 * decide path they end in. This file holds only the LOGIC, with the GitHub client, the clock, the sleep and the
 * decide call all injected, so every rule below is a test that needs no network, no database and no wait.
 * (It imports types from the decide CLI and nothing else of it, so the two files form no runtime cycle.)
 *
 * WHAT A COMMENT MUST BE (V6_FOUNDER_WORKFLOW_GW.r1 section 3; SECOND's conditions cc8711bd l.88-93). It is
 * ACCEPTED only if ALL of these hold, and every other comment is refused and logged by id and code, never by body:
 *   - posted by a real user (`user.type == 'User'`), never a bot or an App;
 *   - login AND numeric id on BOTH approver lists (`authority.listed`);
 *   - CREATED strictly after the request stamp, on GitHub's clock (the approval id is predictable, so this, not
 *     the id, is what stops a comment staged in advance), and NOT after the window's deadline (stamp + window);
 *   - never edited (`created_at == updated_at`), checked again on a re-read just before the decision;
 *   - ONE line `APPROVE|DENY <approvalId> <reason of 8-280 characters>`, naming THAT run's pending approval;
 *   - a reason that cites the plan evidence id the request printed, and that the guarded decide path will take: printable
 *     ASCII without the characters the decide CLI refuses (the SAME rule, pinned by a test), so an accepted comment can
 *     never be refused by the precheck and end the wait on the first comment.
 * The FIRST accepted comment decides; the store's `WHERE state='PENDING'` refuses a second. The window running out
 * with nothing accepted writes NOTHING: the run stays BLOCKED with its approval PENDING.
 *
 * It reads GitHub with GET only and never writes a comment: an agent posting the founder's comment would be a
 * faked human decision.
 */
import type { JuliusApproverIdentity } from './julius-approval-decide';

/* --------------------------------------------------------------- the comment */

export interface GithubIssueComment {
  readonly id: number;
  readonly user: { readonly login: string; readonly id: number; readonly type: string } | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly body: string;
}

export type CommentRefusal =
  | 'NOT_A_USER' | 'NOT_ON_BOTH_LISTS' | 'NOT_AFTER_REQUEST' | 'EDITED' | 'BAD_SHAPE'
  | 'WRONG_APPROVAL' | 'REASON_UNCITED' | 'REASON_UNSAFE' | 'AFTER_DEADLINE' | 'CHANGED_ON_REREAD' | 'MALFORMED';

export interface CommentContext {
  readonly approvalId: string;
  /** The plan evidence id the request printed; the reason must contain it. */
  readonly citation: string;
  /** The request stamp, GitHub's clock, ISO. */
  readonly stamp: string;
  /** The end of the window (stamp + window), ISO. A comment created after it decides nothing. Absent: no deadline check. */
  readonly deadline?: string;
  readonly listed: (approverId: string) => boolean;
}

export type CommentVerdict =
  | { readonly ok: true; readonly decision: 'APPROVED' | 'DENIED'; readonly reason: string; readonly approverId: string }
  | { readonly ok: false; readonly code: CommentRefusal };

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The decide CLI's reason rules (`SAFE_REASON` / `UNSAFE_IN_REASON` in julius-approval-decide.ts); a test pins the two together. */
const SAFE_REASON = /^[\x20-\x7E]+$/u;
const UNSAFE_IN_REASON = /[`$\\<>|]/u;

/** A body is ONE line; a single trailing line break (GitHub's CRLF included) is not a second line. */
export function singleLineBody(body: string): string | null {
  const trimmed = body.replace(/\r?\n$/u, '');
  return /[\r\n]/u.test(trimmed) ? null : trimmed;
}

export function evaluateApprovalComment(comment: GithubIssueComment, context: CommentContext): CommentVerdict {
  const refuse = (code: CommentRefusal): CommentVerdict => ({ ok: false, code });
  const who = comment.user;
  if (who === null || typeof who !== 'object' || who.type !== 'User') return refuse('NOT_A_USER');
  if (typeof who.login !== 'string' || !Number.isSafeInteger(who.id) || who.id <= 0) return refuse('MALFORMED');
  const approverId = `github:${who.login}#${who.id}`;
  if (!context.listed(approverId)) return refuse('NOT_ON_BOTH_LISTS');
  const created = Date.parse(comment.created_at);
  const updated = Date.parse(comment.updated_at);
  const stamp = Date.parse(context.stamp);
  if (Number.isNaN(created) || Number.isNaN(updated) || Number.isNaN(stamp)) return refuse('MALFORMED');
  if (!(created > stamp)) return refuse('NOT_AFTER_REQUEST');
  if (context.deadline !== undefined) {
    const deadline = Date.parse(context.deadline);
    if (Number.isNaN(deadline)) return refuse('MALFORMED');
    if (created > deadline) return refuse('AFTER_DEADLINE');
  }
  if (created !== updated) return refuse('EDITED');
  const line = typeof comment.body === 'string' ? singleLineBody(comment.body) : null;
  if (line === null) return refuse('BAD_SHAPE');
  // The approval id is named exactly; a different id is its own refusal so the log tells the founder which mistake.
  const generic = /^(APPROVE|DENY) (\S+) (.{8,280})$/u.exec(line);
  if (generic === null) return refuse('BAD_SHAPE');
  if (generic[2] !== context.approvalId) return refuse('WRONG_APPROVAL');
  const reason = generic[3]!;
  if (!SAFE_REASON.test(reason) || UNSAFE_IN_REASON.test(reason)) return refuse('REASON_UNSAFE');
  if (!new RegExp(escapeRegExp(context.citation), 'u').test(reason)) return refuse('REASON_UNCITED');
  return { ok: true, decision: generic[1] === 'APPROVE' ? 'APPROVED' : 'DENIED', reason, approverId };
}

/** The workflow step logs a refusal as `APPROVAL_COMMENT_REFUSED id=<id> reason=<code>`; never the body. */
export const refusalLine = (commentId: number, code: CommentRefusal): string =>
  `APPROVAL_COMMENT_REFUSED id=${Number.isSafeInteger(commentId) ? commentId : 0} reason=${code}`;

/* ----------------------------------------------------------------- GitHub */

export interface GithubIssueClient {
  /** GitHub's own clock, ISO: the `Date` header of a response. */
  serverTime(): Promise<string>;
  listComments(issue: number, sinceIso: string): Promise<readonly GithubIssueComment[]>;
  getComment(commentId: number): Promise<GithubIssueComment | null>;
}

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/u;

/** GET-only client over an injected fetch. The token only ever goes in the Authorization header. */
export function createGithubIssueClient(input: {
  readonly repository: string;
  readonly token: string;
  readonly fetch: (url: string, init: { method: 'GET'; headers: Record<string, string> }) => Promise<{
    readonly ok: boolean; readonly status: number; readonly headers: { get(name: string): string | null }; json(): Promise<unknown>;
  }>;
  readonly apiBase?: string;
}): GithubIssueClient {
  if (!REPO.test(input.repository)) throw new Error('GITHUB_REPOSITORY is malformed');
  if (input.token === '') throw new Error('GH_TOKEN is empty');
  const base = input.apiBase ?? 'https://api.github.com';
  const headers = {
    Authorization: `Bearer ${input.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'julius-approval-gw',
  };
  const get = (path: string) => input.fetch(`${base}${path}`, { method: 'GET', headers });
  return {
    async serverTime() {
      const response = await get('/rate_limit');
      const date = response.headers.get('date');
      const parsed = date === null ? Number.NaN : Date.parse(date);
      if (!response.ok || Number.isNaN(parsed)) throw new Error('GitHub clock unavailable');
      return new Date(parsed).toISOString();
    },
    async listComments(issue, sinceIso) {
      if (!Number.isSafeInteger(issue) || issue <= 0) throw new Error('issue number is malformed');
      const all: GithubIssueComment[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const response = await get(`/repos/${input.repository}/issues/${issue}/comments?since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`);
        if (!response.ok) throw new Error(`comments list failed (${response.status})`);
        const rows = await response.json();
        if (!Array.isArray(rows)) throw new Error('comments list was not an array');
        all.push(...(rows as GithubIssueComment[]));
        if (rows.length < 100) break;
      }
      return all;
    },
    async getComment(commentId) {
      const response = await get(`/repos/${input.repository}/issues/comments/${commentId}`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`comment read failed (${response.status})`);
      return (await response.json()) as GithubIssueComment;
    },
  };
}

/* ---------------------------------------------------------------- request */

export interface PendingApprovalView {
  readonly approvalId: string;
  readonly taskId: string | null;
  readonly operation: string;
}

export interface RequestView {
  readonly runId: string;
  readonly pending: readonly PendingApprovalView[];
  readonly taskType: (taskId: string | null) => string | null;
  /** Newest PASSED evidence id of the run's SUCCEEDED plan task (`juliusPlanCitation`), and its integrity hash. */
  readonly citation: string | null;
  readonly planHash: string | null;
  readonly contractId: string;
  readonly binding: string;
}

export type RequestResult =
  | { readonly ok: true; readonly lines: readonly string[]; readonly stamp: string; readonly approvalId: string; readonly citation: string }
  | { readonly ok: false; readonly line: string };

const TOKEN = /^[A-Za-z0-9:._#@/=+-]{1,200}$/u;
const safeToken = (value: string | null): string => (value !== null && TOKEN.test(value) ? value : 'none');

/**
 * R1. Zero or several pending approvals, or no plan evidence to cite, refuses BEFORE any wait starts. The lines are
 * fixed-shape tokens (never free text), so a run id or a summary can never carry a workflow command into a log.
 */
export function buildApprovalRequest(view: RequestView, stamp: string, windowMinutes: number): RequestResult {
  if (view.pending.length !== 1) return { ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=NOT_EXACTLY_ONE_PENDING_APPROVAL' };
  const gate = view.pending[0]!;
  if (view.citation === null) return { ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=NO_PLAN_EVIDENCE' };
  if (![gate.approvalId, view.runId, view.citation].every((token) => TOKEN.test(token))) {
    return { ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=UNSAFE_IDENTIFIER' };
  }
  const stampMs = Date.parse(stamp);
  if (Number.isNaN(stampMs) || !Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 120) {
    return { ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=WINDOW_INVALID' };
  }
  const deadline = new Date(stampMs + windowMinutes * 60_000).toISOString();
  const lines = [
    `APPROVAL_REQUEST approval=${gate.approvalId} run=${view.runId} task=${safeToken(gate.taskId)} task_type=${safeToken(view.taskType(gate.taskId))} operation=${safeToken(gate.operation)}`,
    `plan_evidence=${view.citation} plan_hash=${safeToken(view.planHash)}`,
    `contract=${safeToken(view.contractId)} binding=${safeToken(view.binding)}`,
    `stamp=${stamp} deadline=${deadline}`,
    `TO_DECIDE_COMMENT_EXACTLY: APPROVE ${gate.approvalId} plan ${view.citation} reviewed; <your words>`,
  ];
  return { ok: true, lines, stamp, approvalId: gate.approvalId, citation: view.citation };
}

/* ---------------------------------------------------------- await-comment */

export interface AwaitDeps {
  readonly client: GithubIssueClient;
  readonly issue: number;
  readonly context: CommentContext;
  readonly windowMs: number;
  readonly pollMs: number;
  /** Monotonic milliseconds. */
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** The guarded decide path; the ONLY thing that writes. */
  readonly decide: (input: {
    readonly approvalId: string; readonly decision: 'APPROVED' | 'DENIED'; readonly approverId: string;
    readonly reason: string; readonly commentId: string;
  }) => Promise<{ readonly exitCode: number; readonly line: string }>;
}

export interface AwaitResult {
  readonly exitCode: number;
  readonly decision: 'APPROVED' | 'DENIED' | 'NONE';
  readonly lines: readonly string[];
}

export async function awaitApprovalComment(deps: AwaitDeps): Promise<AwaitResult> {
  const lines: string[] = [];
  const refusedIds = new Set<number>();
  const started = deps.now();
  const log = (line: string): void => { lines.push(line); };
  // The window's end on GitHub's clock (stamp + window): a comment created after it is refused even if the poll that lists it runs in time.
  const stampMs = Date.parse(deps.context.stamp);
  const context: CommentContext = Number.isNaN(stampMs) || deps.context.deadline !== undefined
    ? deps.context
    : { ...deps.context, deadline: new Date(stampMs + deps.windowMs).toISOString() };
  for (;;) {
    let comments: readonly GithubIssueComment[] = [];
    try {
      comments = await deps.client.listComments(deps.issue, deps.context.stamp);
    } catch {
      // A transient API error costs one poll, never the window and never a decision.
      log('APPROVAL_POLL_ERROR');
    }
    const ordered = [...comments].sort((a, b) => (a.created_at === b.created_at ? a.id - b.id : a.created_at < b.created_at ? -1 : 1));
    for (const comment of ordered) {
      if (refusedIds.has(comment.id)) continue;
      const verdict = evaluateApprovalComment(comment, context);
      if (!verdict.ok) { refusedIds.add(comment.id); log(refusalLine(comment.id, verdict.code)); continue; }
      /* RE-READ once, immediately before deciding: an edit or deletion between the list and now refuses it. */
      let again: GithubIssueComment | null = null;
      try { again = await deps.client.getComment(comment.id); } catch { again = null; }
      const same = again !== null && again.body === comment.body && again.updated_at === comment.updated_at
        && again.created_at === comment.created_at && again.user?.id === comment.user?.id && again.user?.login === comment.user?.login;
      const reverdict = same && again !== null ? evaluateApprovalComment(again, context) : null;
      if (reverdict === null || !reverdict.ok) {
        refusedIds.add(comment.id);
        log(refusalLine(comment.id, 'CHANGED_ON_REREAD'));
        continue;
      }
      // The evidence the consolidated review reads (amendment section 5 item 9): who, when, against which stamp. Fixed-shape
      // tokens from validated fields; never the body.
      log(`APPROVAL_COMMENT_ACCEPTED id=${comment.id} author=${verdict.approverId} created_at=${comment.created_at} updated_at=${comment.updated_at} stamp=${deps.context.stamp}`);
      const result = await deps.decide({
        approvalId: deps.context.approvalId, decision: verdict.decision, approverId: verdict.approverId,
        reason: verdict.reason, commentId: String(comment.id),
      });
      log(result.line);
      if (result.exitCode !== 0) return { exitCode: result.exitCode, decision: 'NONE', lines };
      // A recorded denial is the founder's own decision: the step fails (no resume) and the evidence says so.
      return { exitCode: verdict.decision === 'APPROVED' ? 0 : 5, decision: verdict.decision, lines };
    }
    if (deps.now() - started >= deps.windowMs) {
      log(`APPROVAL_WINDOW_EXPIRED approval=${deps.context.approvalId}`);
      return { exitCode: 1, decision: 'NONE', lines };
    }
    await deps.sleep(Math.min(deps.pollMs, Math.max(0, deps.windowMs - (deps.now() - started))));
  }
}

/** For callers that hold the two lists: the identity question alone (`listed`). */
export type ListedFn = (approverId: string) => boolean;
export type { JuliusApproverIdentity };
