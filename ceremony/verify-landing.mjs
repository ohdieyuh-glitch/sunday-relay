/**
 * THE TEN LANDING PROOFS, in one place, run against the repository and against
 * GitHub facts gathered into one file.
 *
 * This container has no `gh`, so every GitHub-side fact is supplied through
 * `--evidence` exactly as the three trust gates already accept it, and every
 * git-side fact is read from the repository here. An absent field is never
 * treated as a pass: each check reports PASS, FAIL or INDETERMINATE, and the
 * script exits non-zero unless all ten are PASS.
 *
 *   node verify-landing.mjs --repo <dir> --evidence <file>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
};
const repo = arg('repo') ?? process.cwd();
const evidencePath = arg('evidence');
if (evidencePath === null) { process.stderr.write('missing --evidence <file>\n'); process.exit(2); }
const e = JSON.parse(readFileSync(evidencePath, 'utf8'));

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const results = [];
const check = (n, title, verdict, detail) => { results.push({ n, title, verdict, detail }); };
/** UNKNOWN IS NOT PASS. A field nobody supplied leaves its check indeterminate. */
const need = (...keys) => keys.every((k) => e[k] !== undefined && e[k] !== null);

/**
 * THE REF THIS SCRIPT READS IS NOT THE GATE'S BRANCH NAME.
 *
 * `branch` is what the trust gates are told to ask GitHub about ("main"). The
 * ref to resolve HERE is a remote-tracking one, because a worktree's local
 * `main` can be anything or nothing. The first dry run read a stale local
 * `main` and reported the wrong parent and the wrong tree — a false FAIL, which
 * is the safe direction, but a wrong answer either way.
 */
const mainSha = git('rev-parse', e.gitRef ?? 'origin/main');
const mainTree = git('rev-parse', `${mainSha}^{tree}`);
const parents = git('rev-list', '--parents', '-n', '1', mainSha).split(' ').slice(1);

// 1 — main moved exactly once: the new main's only parent is the pre-merge main.
check(1, 'main moved exactly once',
  need('preMergeMainSha')
    ? (parents.length === 1 && parents[0] === e.preMergeMainSha ? 'PASS' : 'FAIL')
    : 'INDETERMINATE',
  `parents=[${parents.join(', ')}] expected=[${e.preMergeMainSha ?? '?'}]`);

// 2 — one parent: a squash, never a merge commit.
check(2, 'resulting main has one parent', parents.length === 1 ? 'PASS' : 'FAIL',
  `${parents.length} parent(s)`);

// 3 — exactly one merged PR records this commit as its merge result.
check(3, 'exactly one merged PR records the commit',
  need('mergedPullsForMainSha')
    ? (e.mergedPullsForMainSha.length === 1 ? 'PASS' : 'FAIL')
    : 'INDETERMINATE',
  `${e.mergedPullsForMainSha?.length ?? '?'} merged PR(s): ${(e.mergedPullsForMainSha ?? []).map((p) => `#${p.number}`).join(', ')}`);

// 4 — that PR's author is the worker App, not a person.
check(4, 'merged PR author = julius-worker[bot]',
  need('pullAuthorLogin') ? (e.pullAuthorLogin === 'julius-worker[bot]' ? 'PASS' : 'FAIL') : 'INDETERMINATE',
  `author=${e.pullAuthorLogin ?? '?'}`);

// 5 — the tree that landed is the tree that was approved, byte for byte.
check(5, 'main tree = approved PR head tree',
  need('approvedHeadTreeSha') ? (mainTree === e.approvedHeadTreeSha ? 'PASS' : 'FAIL') : 'INDETERMINATE',
  `main=${mainTree} approved=${e.approvedHeadTreeSha ?? '?'}`);

// 6 — nothing on main was dropped: the pre-merge main is an ancestor of the head.
let contained = 'INDETERMINATE';
if (need('preMergeMainSha', 'approvedHeadSha')) {
  try {
    execFileSync('git', ['-C', repo, 'merge-base', '--is-ancestor', e.preMergeMainSha, e.approvedHeadSha]);
    contained = 'PASS';
  } catch { contained = 'FAIL'; }
}
check(6, 'pre-merge main contained in PR head', contained,
  `${e.preMergeMainSha ?? '?'} in ${e.approvedHeadSha ?? '?'}`);

// 7 — the approver is a different login from the author. Author ≠ approver is
//     the whole separation; an App approving itself would defeat it.
const approvals = (e.reviews ?? []).filter((r) => r.state === 'APPROVED');
check(7, 'APPROVED review login differs from worker login',
  need('reviews') && need('pullAuthorLogin')
    ? (approvals.length > 0 && approvals.every((r) => r.user?.login !== e.pullAuthorLogin) ? 'PASS' : 'FAIL')
    : 'INDETERMINATE',
  `${approvals.length} approval(s) by ${approvals.map((r) => r.user?.login).join(', ') || '(none)'}`);

// 8 — THE BINDING IS THE commit_id, NEVER THE BODY. #237's approval body quoted
//     a 42-character sha; its commit_id was correct. Read the field.
check(8, 'review commit_id = exact approved head',
  need('reviews', 'approvedHeadSha')
    ? (approvals.length > 0 && approvals.every((r) => r.commit_id === e.approvedHeadSha) ? 'PASS' : 'FAIL')
    : 'INDETERMINATE',
  `commit_id(s)=${approvals.map((r) => r.commit_id).join(', ') || '(none)'} expected=${e.approvedHeadSha ?? '?'}`);

// 9 and 10 — the repository's own rules, fed the same evidence file.
const gate = (script, args, expect) => {
  try {
    const out = execFileSync('node', [`${repo}/scripts/${script}`, ...args], { encoding: 'utf8' }).trim();
    return { verdict: out.includes(expect) ? 'PASS' : 'FAIL', detail: out.split('\n').pop() ?? out };
  } catch (error) {
    const out = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    return { verdict: out.includes(expect) ? 'PASS' : 'FAIL', detail: out.split('\n').pop() || 'gate exited non-zero' };
  }
};
const prov = gate('julius-main-provenance.mjs', [e.repoSlug, e.branch ?? 'main', '--evidence', evidencePath], 'provenance=provenant');
check(9, 'provenance = provenant', prov.verdict, prov.detail);
const mono = gate('julius-main-monotonicity.mjs', [e.repoSlug, e.branch ?? 'main', '--evidence', evidencePath], 'monotonicity=monotonic');
check(10, 'monotonicity = monotonic', mono.verdict, mono.detail);

for (const r of results) {
  process.stdout.write(`${String(r.n).padStart(2)}. ${r.title.padEnd(46)} ${r.verdict.padEnd(14)} ${r.detail}\n`);
}
const failed = results.filter((r) => r.verdict !== 'PASS');
process.stdout.write(failed.length === 0
  ? '\nALL TEN PROOFS PASS — the landing is trusted.\n'
  : `\n${failed.length} of 10 not PASS: ${failed.map((r) => r.n).join(', ')} — DO NOT PROCEED TO PROVIDER SPEND.\n`);
process.exit(failed.length === 0 ? 0 : 1);
