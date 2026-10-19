// Driver of the autonomous landing gate. Runs inside .github/workflows/julius-land.yml with the workflow's own token (identity: github-actions[bot]).
// It reads GitHub, asks `land-lib.mjs` whether EVERY condition holds, and only then squash-merges the pull request pinned to the cleared head. Fail closed: any problem,
// any unexpected API answer and any timeout ends the job without a merge. DRY_RUN=true runs every check and never merges.
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REPO, botCommentsDigest, checkCi, checkLanded, checkPullRequest, ciIsPending, nonceUsed, parseClearance, verifyClearanceSignature } from './land-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const API = 'https://api.github.com';
const SELF_CHECK = 'Land a cleared pull request';
const summary = (line) => { console.log(line); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, line + '\n'); };
const fail = (problems) => { for (const p of problems) summary(`REFUSED: ${p}`); summary('Nothing was merged.'); process.exit(1); };

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) } });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${typeof body === 'string' ? body.slice(0, 200) : body?.message}`);
  return body;
}
async function paged(path) {
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const rows = await gh(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

const number = env.PR ?? '';
const head = env.HEAD ?? '';
if (!/^[1-9][0-9]{0,6}$/u.test(number) || !/^[0-9a-f]{40}$/u.test(head)) fail(['inputs: pr must be an integer and head a full 40-hex sha']);

// 1. The clearance: parse, verify the signature against the key COMMITTED ON MAIN (this checkout), and bind it to the inputs.
const clearanceText = Buffer.from(env.CLEARANCE_B64 ?? '', 'base64').toString('utf8');
const parsed = parseClearance(clearanceText);
if (parsed.problems.length) fail(parsed.problems.map((p) => `clearance format: ${p}`));
const keyPem = readFileSync(join(here, 'reviewer-ed25519.pub'), 'utf8');
const sigProblems = verifyClearanceSignature(clearanceText, env.SIGNATURE_B64 ?? '', keyPem);
if (sigProblems.length) fail(sigProblems);
const { fields } = parsed;
if (fields.pr !== number || fields.head !== head) fail([`the dispatch inputs (pr ${number}, head ${head}) differ from the signed clearance (pr ${fields.pr}, head ${fields.head})`]);
const allowedBranches = readFileSync(join(here, 'allowed-branches.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

async function snapshot() {
  const [pr, commit, files, issueComments, inlineComments, reviews, mainRef] = await Promise.all([
    gh(`/repos/${REPO}/pulls/${number}`), gh(`/repos/${REPO}/commits/${head}`), paged(`/repos/${REPO}/pulls/${number}/files`),
    paged(`/repos/${REPO}/issues/${number}/comments`), paged(`/repos/${REPO}/pulls/${number}/comments`), paged(`/repos/${REPO}/pulls/${number}/reviews`),
    gh(`/repos/${REPO}/git/ref/heads/main`),
  ]);
  return { pr, commit, files: files.map((f) => f.filename), digest: botCommentsDigest({ issueComments, inlineComments, reviews }), mainSha: mainRef.object.sha };
}
async function ciState() {
  const runs = await gh(`/repos/${REPO}/commits/${head}/check-runs?per_page=100`);
  const combined = await gh(`/repos/${REPO}/commits/${head}/status`);
  return { checkRuns: runs.check_runs, statuses: combined.statuses, self: SELF_CHECK };
}

// 2. The pull request against the clearance.
let s = await snapshot();
const history = await gh(`/repos/${REPO}/commits?sha=main&per_page=100`);
if (nonceUsed(history.map((c) => c.commit?.message ?? ''), fields.nonce)) fail(['this clearance nonce was already used by a landed commit on main (one use per clearance)']);
const prProblems = checkPullRequest({ fields, now: Date.now(), pr: s.pr, commit: s.commit, files: s.files, mainSha: s.mainSha, allowedBranches, digest: s.digest });
if (prProblems.length) fail(prProblems);
summary(`Clearance verified: ${fields.kind} head ${head} tree ${fields.tree} base ${fields.base}, signed by the registered reviewer key; PR #${number} is the App's single commit, ${s.files.length} files, none founder-governed.`);

// 3. CI: wait (bounded) until nothing is pending, then every check must be green.
// LAND_CI_WAIT_MS exists for the tests only; the workflow never sets it (a test pins that), so production always waits the full 25 minutes.
const deadline = Date.now() + Number(env.LAND_CI_WAIT_MS ?? 25 * 60 * 1000);
let ci = await ciState();
while (ciIsPending(ci) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 30_000)); ci = await ciState(); }
const ciProblems = checkCi(ci);
if (ciProblems.length) fail(ciProblems);
summary(`CI: ${ci.checkRuns.length - 1} check runs and ${ci.statuses.length} statuses green on ${head}.`);

// 4. Re-read everything immediately before acting: the head, main and the bot-comment set must still be exactly what was cleared.
s = await snapshot();
const again = checkPullRequest({ fields, now: Date.now(), pr: s.pr, commit: s.commit, files: s.files, mainSha: s.mainSha, allowedBranches, digest: s.digest });
if (again.length) fail(again.map((p) => `re-check before merge: ${p}`));

// Fail closed: ONLY the exact string "false" merges; "true", empty, "False" or anything else is a dry run.
if (env.DRY_RUN !== 'false') { summary('DRY RUN: every gate holds; the squash merge would be sent now. Nothing was merged.'); process.exit(0); }

// 5. The merge: squash, pinned to the cleared head (GitHub refuses if the head moved).
const merge = await gh(`/repos/${REPO}/pulls/${number}/merge`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sha: head, merge_method: 'squash', commit_title: s.pr.title, commit_message: `Landed by the Julius landing workflow: reviewer clearance (${fields.kind}) issued ${fields.issued}, head ${head}, tree ${fields.tree}, base ${fields.base}. clearance-nonce ${fields.nonce}. Rollback: git revert of this commit.` }),
});
summary(`MERGED PR #${number}: ${merge.sha}`);

// 6. Verify the landed commit is exactly the cleared tree on the cleared base; a mismatch is reported loudly (the merge cannot be undone here).
const landed = await gh(`/repos/${REPO}/commits/${merge.sha}`);
const landedProblems = checkLanded({ landed, base: fields.base, tree: fields.tree });
if (landedProblems.length) { for (const p of landedProblems) summary(`ALERT AFTER MERGE: ${p}`); process.exit(2); }
summary(`Landed commit ${merge.sha}: parent ${fields.base}, tree ${fields.tree} (= the cleared tree).`);
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `landed=${merge.sha}\n`);
