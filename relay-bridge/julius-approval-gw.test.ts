/**
 * V6 G-W: `request` / `await-comment` logic. No network, no database, no real wait: the GitHub client, the clock,
 * the sleep and the decide call are fakes. Each safety property of V6_FOUNDER_WORKFLOW_GW.r1 section 4 has a case
 * that fails if the rule is removed, and the refusal cases are the control for the acceptance one.
 */
import { describe, expect, it } from 'vitest';

import {
  awaitApprovalComment,
  buildApprovalRequest,
  createGithubIssueClient,
  evaluateApprovalComment,
  refusalLine,
  singleLineBody,
  type AwaitDeps,
  type CommentContext,
  type GithubIssueClient,
  type GithubIssueComment,
  type RequestView,
} from './julius-approval-gw';
import { juliusDecidePrecheck } from './julius-approval-decide';

const APPROVAL = 'approval:run:abc:task-build:DISPATCH_WORKER:1';
const CITATION = 'evidence:plan:7f3a';
const STAMP = '2026-10-19T01:00:00.000Z';
const FOUNDER = { login: 'ohdieyuh-glitch', id: 424242, type: 'User' };

const context = (over: Partial<CommentContext> = {}): CommentContext => ({
  approvalId: APPROVAL, citation: CITATION, stamp: STAMP,
  listed: (id) => id === 'github:ohdieyuh-glitch#424242', ...over,
});

const comment = (over: Partial<GithubIssueComment> = {}): GithubIssueComment => ({
  id: 1001, user: FOUNDER, created_at: '2026-10-19T01:05:00Z', updated_at: '2026-10-19T01:05:00Z',
  body: `APPROVE ${APPROVAL} plan ${CITATION} reviewed; looks right`, ...over,
});

describe('V6 G-W: which comment may decide (evaluateApprovalComment)', () => {
  it('ACCEPTS the founder\'s one-line APPROVE, naming the approval and citing the plan evidence', () => {
    const verdict = evaluateApprovalComment(comment(), context());
    expect(verdict).toEqual({
      ok: true, decision: 'APPROVED', approverId: 'github:ohdieyuh-glitch#424242',
      reason: `plan ${CITATION} reviewed; looks right`,
    });
  });

  it('ACCEPTS a DENY the same way (a denial is only ever the founder\'s own words)', () => {
    const verdict = evaluateApprovalComment(comment({ body: `DENY ${APPROVAL} plan ${CITATION} reviewed; not this one` }), context());
    expect(verdict.ok && verdict.decision).toBe('DENIED');
  });

  it('P1 refuses a bot or App, whatever its login and id', () => {
    const verdict = evaluateApprovalComment(comment({ user: { ...FOUNDER, type: 'Bot' } }), context());
    expect(verdict).toEqual({ ok: false, code: 'NOT_A_USER' });
    expect(evaluateApprovalComment(comment({ user: null }), context())).toEqual({ ok: false, code: 'NOT_A_USER' });
  });

  it('P1 refuses a user who is on only ONE of the two lists, and a right login with the wrong numeric id', () => {
    expect(evaluateApprovalComment(comment(), context({ listed: () => false }))).toEqual({ ok: false, code: 'NOT_ON_BOTH_LISTS' });
    expect(evaluateApprovalComment(comment({ user: { ...FOUNDER, id: 7 } }), context())).toEqual({ ok: false, code: 'NOT_ON_BOTH_LISTS' });
  });

  it('P2 refuses a comment created before, or in the same second as, the request stamp', () => {
    expect(evaluateApprovalComment(comment({ created_at: '2026-10-18T23:59:59Z', updated_at: '2026-10-18T23:59:59Z' }), context()))
      .toEqual({ ok: false, code: 'NOT_AFTER_REQUEST' });
    expect(evaluateApprovalComment(comment({ created_at: STAMP, updated_at: STAMP }), context()))
      .toEqual({ ok: false, code: 'NOT_AFTER_REQUEST' });
  });

  it('P3 refuses an edited comment', () => {
    expect(evaluateApprovalComment(comment({ updated_at: '2026-10-19T01:06:00Z' }), context())).toEqual({ ok: false, code: 'EDITED' });
  });

  it('P4 refuses another approval\'s id, and tells the founder that is the mistake', () => {
    const verdict = evaluateApprovalComment(comment({ body: `APPROVE approval:run:zzz:other:DISPATCH_WORKER:1 plan ${CITATION} reviewed` }), context());
    expect(verdict).toEqual({ ok: false, code: 'WRONG_APPROVAL' });
  });

  it('refuses a reason that does not cite the plan evidence id the request printed', () => {
    const verdict = evaluateApprovalComment(comment({ body: `APPROVE ${APPROVAL} looks fine to me, go ahead` }), context());
    expect(verdict).toEqual({ ok: false, code: 'REASON_UNCITED' });
  });

  it('refuses a body that is not exactly one APPROVE|DENY line of the right shape', () => {
    const bad = [
      `approve ${APPROVAL} plan ${CITATION} reviewed`, // lower case
      `MAYBE ${APPROVAL} plan ${CITATION} reviewed`,
      `APPROVE ${APPROVAL}`, // no reason
      `APPROVE ${APPROVAL} short`, // reason under 8
      `APPROVE ${APPROVAL} plan ${CITATION} reviewed\nand also run rm -rf`, // two lines
      `APPROVE ${APPROVAL} ${'x'.repeat(281)}`, // reason over 280
      '',
    ];
    for (const body of bad) expect(evaluateApprovalComment(comment({ body }), context()), JSON.stringify(body)).toEqual({ ok: false, code: 'BAD_SHAPE' });
  });

  it('accepts a CRLF line ending as the same single line', () => {
    expect(evaluateApprovalComment(comment({ body: `APPROVE ${APPROVAL} plan ${CITATION} reviewed\r\n` }), context()).ok).toBe(true);
    expect(singleLineBody('a\r\nb')).toBeNull();
    expect(singleLineBody('a\n')).toBe('a');
  });

  it('the regex metacharacters in an evidence id cannot widen the citation match', () => {
    const verdict = evaluateApprovalComment(comment({ body: `APPROVE ${APPROVAL} plan evidenceXplanX7f3a reviewed` }), context({ citation: 'evidence.plan.7f3a' }));
    expect(verdict).toEqual({ ok: false, code: 'REASON_UNCITED' });
  });

  it('a refusal line carries the id and the code and never any body', () => {
    expect(refusalLine(1001, 'EDITED')).toBe('APPROVAL_COMMENT_REFUSED id=1001 reason=EDITED');
  });
});

/* ------------------------------------------------------------ await loop */

function harness(comments: GithubIssueComment[][], over: Partial<AwaitDeps> = {}, reread?: (id: number) => GithubIssueComment | null) {
  let clock = 0;
  let polls = 0;
  const decided: unknown[] = [];
  const client: GithubIssueClient = {
    serverTime: async () => STAMP,
    listComments: async () => comments[Math.min(polls++, comments.length - 1)] ?? [],
    getComment: async (id) => (reread !== undefined ? reread(id) : (comments.flat().find((row) => row.id === id) ?? null)),
  };
  const deps: AwaitDeps = {
    client, issue: 9, context: context(), windowMs: 30 * 60_000, pollMs: 30_000,
    now: () => clock, sleep: async (ms) => { clock += ms; },
    decide: async (input) => {
      decided.push(input);
      return { exitCode: 0, line: `APPROVAL_DECIDED approval=${input.approvalId} decision=${input.decision} comment=${input.commentId}` };
    },
    ...over,
  };
  return { deps, decided, elapsed: () => clock };
}

describe('V6 G-W: the bounded wait (awaitApprovalComment)', () => {
  it('P5 the FIRST accepted comment decides; a later one is never even read as a decision', async () => {
    const first = comment({ id: 1, created_at: '2026-10-19T01:05:00Z', updated_at: '2026-10-19T01:05:00Z' });
    const second = comment({ id: 2, created_at: '2026-10-19T01:06:00Z', updated_at: '2026-10-19T01:06:00Z', body: `DENY ${APPROVAL} plan ${CITATION} reviewed; changed my mind` });
    const h = harness([[second, first]]);
    const result = await awaitApprovalComment(h.deps);
    expect(result).toMatchObject({ exitCode: 0, decision: 'APPROVED' });
    expect(h.decided).toHaveLength(1);
    expect(h.decided[0]).toMatchObject({ commentId: '1', decision: 'APPROVED', approverId: 'github:ohdieyuh-glitch#424242' });
  });

  it('logs the accepted comment\'s id, author (login#numeric id), both timestamps and the stamp BEFORE the decision line', async () => {
    const h = harness([[comment({ id: 77 })]]);
    const result = await awaitApprovalComment(h.deps);
    expect(result.lines[0]).toBe(
      `APPROVAL_COMMENT_ACCEPTED id=77 author=github:ohdieyuh-glitch#424242 created_at=2026-10-19T01:05:00Z updated_at=2026-10-19T01:05:00Z stamp=${STAMP}`);
    expect(result.lines[1]).toContain('APPROVAL_DECIDED');
  });

  it('keeps polling past refused comments, logging each ONCE by id and code', async () => {
    const stranger = comment({ id: 5, user: { login: 'someone', id: 1, type: 'User' } });
    const good = comment({ id: 6, created_at: '2026-10-19T01:09:00Z', updated_at: '2026-10-19T01:09:00Z' });
    const h = harness([[stranger], [stranger], [stranger, good]]);
    const result = await awaitApprovalComment(h.deps);
    expect(result.lines.filter((line) => line.startsWith('APPROVAL_COMMENT_REFUSED'))).toEqual(['APPROVAL_COMMENT_REFUSED id=5 reason=NOT_ON_BOTH_LISTS']);
    expect(result.decision).toBe('APPROVED');
    expect(h.elapsed()).toBe(60_000);
  });

  it('P6 the window running out with nothing accepted WRITES NOTHING and exits 1 with decision NONE', async () => {
    const h = harness([[]]);
    const result = await awaitApprovalComment(h.deps);
    expect(result).toMatchObject({ exitCode: 1, decision: 'NONE' });
    expect(result.lines.at(-1)).toBe(`APPROVAL_WINDOW_EXPIRED approval=${APPROVAL}`);
    expect(h.decided).toHaveLength(0);
    expect(h.elapsed()).toBe(30 * 60_000);
  });

  it('P6 refused-only comments also end in expiry with no write (a staged or edited comment decides nothing)', async () => {
    const edited = comment({ id: 3, updated_at: '2026-10-19T01:06:00Z' });
    const early = comment({ id: 4, created_at: '2026-10-18T22:00:00Z', updated_at: '2026-10-18T22:00:00Z' });
    const h = harness([[edited, early]]);
    const result = await awaitApprovalComment(h.deps);
    expect(result.decision).toBe('NONE');
    expect(h.decided).toHaveLength(0);
    expect(result.lines).toContain('APPROVAL_COMMENT_REFUSED id=3 reason=EDITED');
    expect(result.lines).toContain('APPROVAL_COMMENT_REFUSED id=4 reason=NOT_AFTER_REQUEST');
  });

  it('P3 a comment edited between the list and the decision is refused on the re-read', async () => {
    const listed = comment({ id: 8 });
    const h = harness([[listed]], {}, () => ({ ...listed, body: `APPROVE ${APPROVAL} plan ${CITATION} reviewed; now something else`, updated_at: '2026-10-19T01:06:30Z' }));
    const result = await awaitApprovalComment(h.deps);
    expect(result.lines).toContain('APPROVAL_COMMENT_REFUSED id=8 reason=CHANGED_ON_REREAD');
    expect(h.decided).toHaveLength(0);
    expect(result.decision).toBe('NONE');
  });

  it('a comment deleted between the list and the decision is refused too', async () => {
    const h = harness([[comment({ id: 9 })]], {}, () => null);
    const result = await awaitApprovalComment(h.deps);
    expect(result.lines).toContain('APPROVAL_COMMENT_REFUSED id=9 reason=CHANGED_ON_REREAD');
    expect(h.decided).toHaveLength(0);
  });

  it('P13 an accepted DENY is recorded and the step FAILS (exit 5), so the run is never resumed', async () => {
    const deny = comment({ id: 11, body: `DENY ${APPROVAL} plan ${CITATION} reviewed; no` });
    const h = harness([[deny]]);
    const result = await awaitApprovalComment(h.deps);
    expect(result).toMatchObject({ exitCode: 5, decision: 'DENIED' });
    expect(h.decided[0]).toMatchObject({ decision: 'DENIED' });
  });

  it('when the guarded decide refuses (exit 4, a race lost or an unlisted approver), the decision is NONE and the exit is that code', async () => {
    const h = harness([[comment({ id: 12 })]], { decide: async () => ({ exitCode: 4, line: 'APPROVAL_ALREADY_DECIDED approval=x' }) });
    const result = await awaitApprovalComment(h.deps);
    expect(result).toMatchObject({ exitCode: 4, decision: 'NONE' });
  });

  it('a transient GitHub error costs one poll, not the window and not a decision', async () => {
    let calls = 0;
    const client: GithubIssueClient = {
      serverTime: async () => STAMP,
      listComments: async () => { calls += 1; if (calls === 1) throw new Error('503'); return [comment({ id: 20 })]; },
      getComment: async () => comment({ id: 20 }),
    };
    const h = harness([[]], { client });
    const result = await awaitApprovalComment(h.deps);
    expect(result.lines[0]).toBe('APPROVAL_POLL_ERROR');
    expect(result.decision).toBe('APPROVED');
  });

  it('P7 there is no default decision: with no comment at all the decide callback is never called', async () => {
    const h = harness([[]], { windowMs: 60_000 });
    await awaitApprovalComment(h.deps);
    expect(h.decided).toEqual([]);
  });

  it('a body is never echoed: no output line contains any comment text', async () => {
    const hostile = comment({ id: 30, user: { login: 'x', id: 1, type: 'User' }, body: '::set-output name=decision::APPROVED $(curl evil)' });
    const h = harness([[hostile]], { windowMs: 30_000 });
    const result = await awaitApprovalComment(h.deps);
    expect(result.lines.join('\n')).not.toMatch(/set-output|curl|evil/u);
  });
});

/* ---------------------------------------------------------------- request */

const view = (over: Partial<RequestView> = {}): RequestView => ({
  runId: 'run:abc', pending: [{ approvalId: APPROVAL, taskId: 'task-build', operation: 'DISPATCH_WORKER' }],
  taskType: () => 'build', citation: CITATION, planHash: 'sha256:aa11', contractId: 'julius-v6-governance-1',
  binding: 'sha256:bb22', ...over,
});

describe('V6 G-W: the request (buildApprovalRequest)', () => {
  it('prints fixed-shape lines, the exact comment to type, and a deadline = stamp + window', () => {
    const built = buildApprovalRequest(view(), STAMP, 30);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.lines[0]).toBe(`APPROVAL_REQUEST approval=${APPROVAL} run=run:abc task=task-build task_type=build operation=DISPATCH_WORKER`);
    expect(built.lines[1]).toBe(`plan_evidence=${CITATION} plan_hash=sha256:aa11`);
    expect(built.lines[3]).toBe(`stamp=${STAMP} deadline=2026-10-19T01:30:00.000Z`);
    expect(built.lines[4]).toBe(`TO_DECIDE_COMMENT_EXACTLY: APPROVE ${APPROVAL} plan ${CITATION} reviewed; <your words>`);
    // The printed instruction is itself an acceptable comment.
    const typed = `APPROVE ${APPROVAL} plan ${CITATION} reviewed; fine`;
    expect(evaluateApprovalComment(comment({ body: typed }), context()).ok).toBe(true);
  });

  it('refuses before any wait when there is not exactly one pending approval', () => {
    for (const pending of [[], [view().pending[0]!, { approvalId: 'approval:2', taskId: null, operation: 'DISPATCH_WORKER' }]]) {
      expect(buildApprovalRequest(view({ pending }), STAMP, 30)).toEqual({ ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=NOT_EXACTLY_ONE_PENDING_APPROVAL' });
    }
  });

  it('refuses with no plan evidence to cite, an unsafe identifier, or an invalid window/stamp', () => {
    expect(buildApprovalRequest(view({ citation: null }), STAMP, 30)).toEqual({ ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=NO_PLAN_EVIDENCE' });
    expect(buildApprovalRequest(view({ runId: 'run:abc\n::error::x' }), STAMP, 30)).toEqual({ ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=UNSAFE_IDENTIFIER' });
    expect(buildApprovalRequest(view(), 'not a date', 30)).toEqual({ ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=WINDOW_INVALID' });
    expect(buildApprovalRequest(view(), STAMP, 0)).toEqual({ ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=WINDOW_INVALID' });
    expect(buildApprovalRequest(view(), STAMP, 121)).toEqual({ ok: false, line: 'APPROVAL_REQUEST_REFUSED reason=WINDOW_INVALID' });
  });

  it('an absent or odd plan hash / task prints as none, never as free text', () => {
    const built = buildApprovalRequest(view({ planHash: 'sha256: has spaces\n', taskType: () => null }), STAMP, 30);
    expect(built.ok && built.lines[1]).toBe(`plan_evidence=${CITATION} plan_hash=none`);
    expect(built.ok && built.lines[0]).toContain('task_type=none');
  });
});

/* ------------------------------------------------------------ the client */

describe('V6 G-W: the GitHub client is GET-only and keeps the token in the header', () => {
  const response = (body: unknown, init: { ok?: boolean; status?: number; date?: string } = {}) => ({
    ok: init.ok ?? true, status: init.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'date' ? (init.date ?? null) : null) },
    json: async () => body,
  });

  it('reads the clock from the Date header and refuses without one', async () => {
    const seen: { url: string; method: string; headers: Record<string, string> }[] = [];
    const ok = createGithubIssueClient({ repository: 'o/r', token: 't0ken', fetch: async (url, init) => { seen.push({ url, ...init }); return response({}, { date: 'Mon, 19 Oct 2026 01:00:00 GMT' }); } });
    expect(await ok.serverTime()).toBe('2026-10-19T01:00:00.000Z');
    expect(seen[0]).toMatchObject({ method: 'GET', url: 'https://api.github.com/rate_limit' });
    expect(seen[0]!.headers.Authorization).toBe('Bearer t0ken');
    expect(seen[0]!.url).not.toContain('t0ken');
    const none = createGithubIssueClient({ repository: 'o/r', token: 't', fetch: async () => response({}) });
    await expect(none.serverTime()).rejects.toThrow('GitHub clock unavailable');
  });

  it('lists comments with since, paginates to a short page, and every call is a GET', async () => {
    const methods: string[] = [];
    const urls: string[] = [];
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));
    let call = 0;
    const client = createGithubIssueClient({
      repository: 'o/r', token: 't',
      fetch: async (url, init) => { methods.push(init.method); urls.push(url); call += 1; return response(call === 1 ? page(100) : page(3)); },
    });
    expect(await client.listComments(9, STAMP)).toHaveLength(103);
    expect(methods).toEqual(['GET', 'GET']);
    expect(urls[0]).toContain('/repos/o/r/issues/9/comments?since=2026-10-19T01%3A00%3A00.000Z&per_page=100&page=1');
  });

  it('refuses a malformed repository, an empty token and a bad issue number; maps 404 to null', async () => {
    expect(() => createGithubIssueClient({ repository: 'o/r; rm -rf /', token: 't', fetch: async () => response({}) })).toThrow();
    expect(() => createGithubIssueClient({ repository: 'o/r', token: '', fetch: async () => response({}) })).toThrow();
    const client = createGithubIssueClient({ repository: 'o/r', token: 't', fetch: async () => response(null, { ok: false, status: 404 }) });
    await expect(client.listComments(0, STAMP)).rejects.toThrow();
    expect(await client.getComment(5)).toBeNull();
  });
});

/* ------------------------------------------------- reviewer findings F-1 and A-2 */

describe('V6 G-W review F-1: a comment the rules accept can never be refused by the decide precheck', () => {
  const body = (reason: string) => `APPROVE ${APPROVAL} plan ${CITATION} ${reason}`;

  it('refuses the reviewer\'s own example (a dollar sign in the reason) as REASON_UNSAFE', () => {
    expect(evaluateApprovalComment(comment({ body: `APPROVE ${APPROVAL} plan ${CITATION} reviewed; cost is $5 fine` }), context())).toEqual({ ok: false, code: 'REASON_UNSAFE' });
  });

  it('refuses every character the decide CLI refuses, and anything that is not printable ASCII', () => {
    const refused = ['`', '$', String.fromCharCode(92), '<', '>', '|', String.fromCharCode(0xe9), String.fromCharCode(0x2014), String.fromCodePoint(0x1f600), String.fromCharCode(9)];
    for (const bad of refused) {
      const verdict = evaluateApprovalComment(comment({ body: body(`reviewed ${bad} fine`) }), context());
      expect(verdict, JSON.stringify(bad)).toEqual({ ok: false, code: 'REASON_UNSAFE' });
    }
  });

  it('the wait CONTINUES past such a comment and decides on the next, correct one', async () => {
    const unsafe = comment({ id: 31, created_at: '2026-10-19T01:05:00Z', updated_at: '2026-10-19T01:05:00Z', body: `APPROVE ${APPROVAL} plan ${CITATION} reviewed; cost is $5 fine` });
    const good = comment({ id: 32, created_at: '2026-10-19T01:06:00Z', updated_at: '2026-10-19T01:06:00Z' });
    const h = harness([[unsafe], [unsafe, good]]);
    const result = await awaitApprovalComment(h.deps);
    expect(result).toMatchObject({ exitCode: 0, decision: 'APPROVED' });
    expect(result.lines).toContain('APPROVAL_COMMENT_REFUSED id=31 reason=REASON_UNSAFE');
    expect(h.decided).toHaveLength(1);
    expect(h.decided[0]).toMatchObject({ commentId: '32' });
  });

  it('PIN: every comment the rules accept passes juliusDecidePrecheck, and every REASON_UNSAFE precheck refusal is refused here first', () => {
    const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
    const reasons = [...printable.map((c) => `reviewed ${c} fine`), `reviewed ${String.fromCharCode(0xe9)} fine`, `reviewed ${String.fromCodePoint(0x1f600)} fine`, 'reviewed fine', 'reviewed; fine, ok. (yes) [ok] {ok} #1 @x %y ~z'];
    let accepted = 0;
    for (const reason of reasons) {
      const verdict = evaluateApprovalComment(comment({ body: body(reason) }), context());
      const precheck = juliusDecidePrecheck(
        { runId: 'run:abc', projectId: 'prj', approvalId: APPROVAL, decision: 'APPROVED', approverId: 'github:ohdieyuh-glitch#424242', reason: `plan ${CITATION} ${reason}`, commentId: '1001' },
        { listed: () => true },
      );
      if (verdict.ok) { accepted += 1; expect(precheck, JSON.stringify(reason)).toBeNull(); }
      if (precheck?.line === 'APPROVAL_REFUSED reason=REASON_UNSAFE') expect(verdict, JSON.stringify(reason)).toEqual({ ok: false, code: 'REASON_UNSAFE' });
    }
    expect(accepted).toBeGreaterThan(60);
  });
});

describe('V6 G-W review A-2: a comment created after the window\'s deadline decides nothing', () => {
  it('refuses a comment created 40 minutes after a 30-minute window, and accepts one created exactly AT the deadline', () => {
    const ctx = context({ deadline: '2026-10-19T01:30:00.000Z' });
    expect(evaluateApprovalComment(comment({ created_at: '2026-10-19T01:40:00Z', updated_at: '2026-10-19T01:40:00Z' }), ctx)).toEqual({ ok: false, code: 'AFTER_DEADLINE' });
    expect(evaluateApprovalComment(comment({ created_at: '2026-10-19T01:30:00Z', updated_at: '2026-10-19T01:30:00Z' }), ctx).ok).toBe(true);
    expect(evaluateApprovalComment(comment({ created_at: '2026-10-19T01:30:01Z', updated_at: '2026-10-19T01:30:01Z' }), ctx)).toEqual({ ok: false, code: 'AFTER_DEADLINE' });
    expect(evaluateApprovalComment(comment(), context({ deadline: 'not a date' }))).toEqual({ ok: false, code: 'MALFORMED' });
  });

  it('the wait derives the deadline from the stamp and its own window: a late comment listed by a poll inside the window is still refused', async () => {
    const late = comment({ id: 41, created_at: '2026-10-19T01:40:00Z', updated_at: '2026-10-19T01:40:00Z' });
    const h = harness([[late]]);
    const result = await awaitApprovalComment(h.deps);
    expect(result).toMatchObject({ exitCode: 1, decision: 'NONE' });
    expect(result.lines).toContain('APPROVAL_COMMENT_REFUSED id=41 reason=AFTER_DEADLINE');
    expect(h.decided).toHaveLength(0);
  });
});
