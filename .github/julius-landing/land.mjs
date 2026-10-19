// Driver of the autonomous landing gate. Runs inside .github/workflows/julius-land.yml with the workflow's own token (identity: github-actions[bot]).
// It reads GitHub, asks `land-lib.mjs` whether EVERY condition holds, and only then squash-merges the pull request pinned to the cleared head. Fail closed: any problem,
// any unexpected API answer and any timeout ends the job without a merge. DRY_RUN=true runs every check and never merges.
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REPO, botCommentsDigest, checkCi, checkLanded, checkPullRequest, checkRuntime, ciIsPending, nonceUsed, parseClearance, verifyClearanceSignature } from './land-lib.mjs';
import { PER_PAGE, readAllPages, squashTitle } from './land-lib.mjs';

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
// Every list is read to its end; past the page cap readAllPages THROWS, which ends the job unmerged (fail closed).
const pageUrl = (path, page) => `${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`;
const paged = (path) => readAllPages((page) => gh(pageUrl(path, page)));
/** A list wrapped in an object with `total_count` (check runs, combined status): all pages, and the rows read must equal the total GitHub reports. */
async function pagedCounted(path, key) {
  let total;
  const rows = await readAllPages(async (page) => { const body = await gh(pageUrl(path, page)); total ??= body?.total_count; return body?.[key]; });
  // total_count is REQUIRED (the documented API always sends it): absent, not an integer, or different from the rows read all refuse.
  if (!Number.isInteger(total)) fail([`${path} sent no integer total_count; refusing to trust a list of unknown length`]);
  if (total !== rows.length) fail([`${path} reports ${total} ${key} but ${rows.length} were read`]);
  return rows;
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
const requiredChecks = readFileSync(join(here, 'required-checks.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
if (requiredChecks.length === 0) fail(['required-checks.txt is empty: refusing to land without a required-check list']);

async function snapshot() {
  const [pr, commit, files, issueComments, inlineComments, reviews, mainRef] = await Promise.all([
    gh(`/repos/${REPO}/pulls/${number}`), gh(`/repos/${REPO}/commits/${head}`), paged(`/repos/${REPO}/pulls/${number}/files`),
    paged(`/repos/${REPO}/issues/${number}/comments`), paged(`/repos/${REPO}/pulls/${number}/comments`), paged(`/repos/${REPO}/pulls/${number}/reviews`),
    gh(`/repos/${REPO}/git/ref/heads/main`),
  ]);
  // Both names of a rename or copy are checked; the row count is compared with the PR's own changed_files to catch truncation.
  return { pr, commit, files: files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean)), fileRows: files.length, digest: botCommentsDigest({ issueComments, inlineComments, reviews }), mainSha: mainRef.object.sha };
}
async function ciState() {
  const checkRuns = await pagedCounted(`/repos/${REPO}/commits/${head}/check-runs`, 'check_runs');
  const statuses = await pagedCounted(`/repos/${REPO}/commits/${head}/status`, 'statuses');
  return { checkRuns, statuses, self: SELF_CHECK };
}

// 1b. This job must be running the workflow as it is on main's tip (dispatch from another ref or commit is refused).
const tip = (await gh(`/repos/${REPO}/git/ref/heads/main`)).object.sha;
const runtimeProblems = checkRuntime({ ref: env.GITHUB_REF, sha: env.GITHUB_SHA, mainSha: tip });
if (runtimeProblems.length) fail(runtimeProblems);

// 2. The pull request against the clearance.
let s = await snapshot();
const history = await gh(`/repos/${REPO}/commits?sha=main&per_page=100`);
if (nonceUsed(history.map((c) => c.commit?.message ?? ''), fields.nonce)) fail(['this clearance nonce was already used by a landed commit on main (one use per clearance)']);
const prProblems = checkPullRequest({ fields, now: Date.now(), pr: s.pr, commit: s.commit, files: s.files, fileRows: s.fileRows, mainSha: s.mainSha, allowedBranches, digest: s.digest });
if (prProblems.length) fail(prProblems);
summary(`Clearance verified: ${fields.kind} head ${head} tree ${fields.tree} base ${fields.base}, signed by the registered reviewer key; PR #${number} is the App's single commit, ${s.files.length} files, none founder-governed.`);

// 3. CI: wait (bounded) until nothing is pending, then every check must be green.
// LAND_CI_WAIT_MS exists for the tests only; the workflow never sets it (a test pins that), so production always waits the full 25 minutes.
const deadline = Date.now() + Number(env.LAND_CI_WAIT_MS ?? 25 * 60 * 1000);
let ci = await ciState();
while (ciIsPending(ci) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 30_000)); ci = await ciState(); }
const ciProblems = checkCi({ ...ci, required: requiredChecks });
if (ciProblems.length) fail(ciProblems);
summary(`CI: ${ci.checkRuns.length - 1} check runs and ${ci.statuses.length} statuses green on ${head}.`);

// 4. Re-read everything immediately before acting: the head, main and the bot-comment set must still be exactly what was cleared.
s = await snapshot();
const again = checkPullRequest({ fields, now: Date.now(), pr: s.pr, commit: s.commit, files: s.files, fileRows: s.fileRows, mainSha: s.mainSha, allowedBranches, digest: s.digest });
if (again.length) fail(again.map((p) => `re-check before merge: ${p}`));

// Fail closed: ONLY the exact string "false" merges; "true", empty, "False" or anything else is a dry run.
if (env.DRY_RUN !== 'false') { summary('DRY RUN: every gate holds; the squash merge would be sent now. Nothing was merged.'); process.exit(0); }

// 4b. Main's tip, read ONE MORE TIME immediately before the merge: if it moved since the checks, abort (the cleared base is no longer the tip).
const tipNow = (await gh(`/repos/${REPO}/git/ref/heads/main`)).object.sha;
if (tipNow !== fields.base) fail([`main moved to ${tipNow} immediately before the merge; the clearance names base ${fields.base}`]);

// 5. The merge: squash, pinned to the cleared head (GitHub refuses if the head moved). The title is built here, never taken from the PR title: anyone with write access can edit
// that, and it would land verbatim on main (claims of approval, another clearance's nonce). The message keeps `clearance-nonce <nonce>` exactly: nonceUsed reads it.
const merge = await gh(`/repos/${REPO}/pulls/${number}/merge`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sha: head, merge_method: 'squash', commit_title: squashTitle(number, head), commit_message: `Landed by the Julius landing workflow: reviewer clearance (${fields.kind}) issued ${fields.issued}, head ${head}, tree ${fields.tree}, base ${fields.base}. clearance-nonce ${fields.nonce}. Rollback: git revert of this commit.` }),
});
summary(`MERGED PR #${number}: ${merge.sha}`);

// 6. Verify the landed commit is exactly the cleared tree on the cleared base; a mismatch is reported loudly (the merge cannot be undone here).
const landed = await gh(`/repos/${REPO}/commits/${merge.sha}`);
const landedProblems = checkLanded({ landed, base: fields.base, tree: fields.tree });
if (landedProblems.length) { for (const p of landedProblems) summary(`ALERT AFTER MERGE: ${p}`); process.exit(2); }
summary(`Landed commit ${merge.sha}: parent ${fields.base}, tree ${fields.tree} (= the cleared tree).`);
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `landed=${merge.sha}\n`);
