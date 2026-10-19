// Driver of the autonomous landing gate. Runs inside .github/workflows/julius-land.yml with the workflow's own token (identity: github-actions[bot]).
// It reads GitHub, asks `land-lib.mjs` whether EVERY condition holds, and only then creates the landing commit (the cleared tree on the cleared base, the signed clearance in its
// message) with the git data API and advances main with a NON-FORCED ref update (a compare-and-swap). It never uses the merge endpoint. Fail closed: any problem, any unexpected API
// answer and any timeout ends the job without a landing. DRY_RUN=true makes every read and every check and writes nothing.
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LANDER_IDENTITY, REPO, botCommentsDigest, buildLandingCommitMessage, checkCi, checkCreatedCommit, checkPullRequest, checkRuntime, ciIsPending, nonceUsed, parseClearance, parseLandingCommitMessage, parseRequiredChecks, verifyClearanceSignature } from './land-lib.mjs';
import { PER_PAGE, readAllPages } from './land-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const API = 'https://api.github.com';
const SELF_CHECK = 'Land a cleared pull request';
const summary = (line) => { console.log(line); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, line + '\n'); };
const fail = (problems) => { for (const p of problems) summary(`REFUSED: ${p}`); summary('Nothing was landed.'); process.exit(1); };
// Any error nobody handled (an API answer that is not 2xx, a network failure, a malformed file) ends the job with ONE line, never a stack trace. Before the ref update is sent nothing has
// landed: exit 1 ("REFUSED"). From the moment the ref update is sent main's state may have changed: exit 2 ("ALERT"), told apart so nobody reads "nothing landed" into it.
let refUpdateStarted = false;
const oneLine = (e) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300);
const onUnexpected = (e) => {
  if (!refUpdateStarted) { summary(`REFUSED: unexpected error before anything was landed: ${oneLine(e)}`); summary('Nothing was landed.'); process.exit(1); }
  summary(`ALERT AFTER LANDING: an unexpected error occurred after the ref update was sent: ${oneLine(e)}; check main by hand`);
  process.exit(2);
};
process.on('uncaughtException', onUnexpected);
process.on('unhandledRejection', onUnexpected);

async function gh(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) } });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw Object.assign(new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${typeof body === 'string' ? body.slice(0, 200) : body?.message}`), { status: res.status });
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
const requiredChecks = parseRequiredChecks(readFileSync(join(here, 'required-checks.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
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

// 2. The pull request against the clearance (first look; the decision that counts is the FINAL one in step 4).
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

// 4. THE FINAL READ, immediately before acting, and the ONLY basis of the decision: the pull request, its files, the bot-comment digest, main's tip AND the CI state (every check run
// and status, paginated fail-closed) are read again together. A check re-run, a new failing check or a status that appeared after step 3 is seen here, not missed.
s = await snapshot();
ci = await ciState();
const again = [
  ...checkPullRequest({ fields, now: Date.now(), pr: s.pr, commit: s.commit, files: s.files, fileRows: s.fileRows, mainSha: s.mainSha, allowedBranches, digest: s.digest }),
  ...checkCi({ ...ci, required: requiredChecks }),
];
if (again.length) fail(again.map((p) => `re-check before landing: ${p}`));

// 5. The landing commit: built (and checked to round-trip) whether or not anything is written. Its message carries the signed clearance; see README for the format.
const message = buildLandingCommitMessage({ clearanceText, signatureB64: env.SIGNATURE_B64 ?? '' });
const reparsed = parseLandingCommitMessage(message, { expected: { pr: number, head, tree: fields.tree, base: fields.base }, publicKeyPem: keyPem });
if (reparsed.problems.length) fail(reparsed.problems.map((p) => `the landing commit message does not round-trip: ${p}`));
const commitBody = { message, tree: fields.tree, parents: [fields.base], author: LANDER_IDENTITY, committer: LANDER_IDENTITY };
const refBody = (sha) => ({ sha, force: false });

// Main's tip, read ONE MORE TIME immediately before acting: if it moved since the checks, abort (the cleared base is no longer the tip). The ref update below is a compare-and-swap
// on the same fact, so a move after this read is refused by GitHub, not merely noticed.
const tipNow = (await gh(`/repos/${REPO}/git/ref/heads/main`)).object.sha;
if (tipNow !== fields.base) fail([`main moved to ${tipNow} immediately before the landing; the clearance names base ${fields.base}`]);

// Fail closed: ONLY the exact string "false" lands; "true", empty, "False" or anything else is a dry run. A dry run has made every READ and every check above, and has computed the
// commit body; it performs NO write (no commit, no ref update, no comment, no close) and prints exactly what the live run would send.
if (env.DRY_RUN !== 'false') {
  summary('DRY RUN: every gate holds. The live run would do exactly this, and nothing was written:');
  summary(`  1. POST /repos/${REPO}/git/commits ${JSON.stringify({ ...commitBody, message: '(below)' })}`);
  summary(`  2. read the created commit back and require tree ${fields.tree}, the single parent ${fields.base}, the exact message and the github-actions[bot] identity`);
  summary(`  3. PATCH /repos/${REPO}/git/refs/heads/main ${JSON.stringify(refBody('<the created commit sha>'))} (not forced: fails if main is no longer ${fields.base})`);
  summary(`  4. comment on PR #${number} naming the landed commit, then close the PR (it will not show as merged; that is expected)`);
  summary(`--- the landing commit message ---\n${message}--- end ---`);
  process.exit(0);
}

// 6. Create the commit (git data API): exactly the cleared tree, exactly one parent = the cleared base. Nothing is on main yet.
const created = await gh(`/repos/${REPO}/git/commits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commitBody) });
const newSha = created?.sha;
const readBack = await gh(`/repos/${REPO}/commits/${newSha}`);
const createdProblems = checkCreatedCommit({ created: readBack, sha: newSha, base: fields.base, tree: fields.tree, message });
if (createdProblems.length) fail(createdProblems.map((p) => `created commit ${newSha}: ${p}`));

// 7. Advance main. NOT forced: a non-forced ref update is a fast-forward compare-and-swap that GitHub refuses unless main is still the parent of the new commit. Any failure refuses
// and reports; there is no retry and never a force.
refUpdateStarted = true;
try {
  await gh(`/repos/${REPO}/git/refs/heads/main`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(refBody(newSha)) });
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  // A CLEAN refusal is an HTTP 4xx answer (408 and 429 excepted): GitHub answered and did not move main. Anything else (timeout, 5xx, network error, an unreadable answer) is AMBIGUOUS:
  // the update may have been applied with the answer lost, so main's tip is read again and judged. There is never a retry and never a force.
  const status = error?.status;
  if (Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429) fail([`the ref update was refused (main moved or the update is not a fast-forward); nothing landed, no retry: ${text}`]);
  let tipAfter;
  try { tipAfter = (await gh(`/repos/${REPO}/git/ref/heads/main`)).object.sha; } catch (readError) {
    summary(`ALERT AFTER AN AMBIGUOUS REF UPDATE (${text}): main's tip could not be read again (${readError instanceof Error ? readError.message : String(readError)}); check main by hand, created commit ${newSha}`);
    process.exit(2);
  }
  if (tipAfter === newSha) summary(`LANDED (the PATCH response was lost): ${text}; main is the created commit ${newSha}`);
  else if (tipAfter === fields.base) fail([`the ref update outcome was ambiguous (${text}) and main is still the cleared base ${fields.base}; nothing landed, no retry`]);
  else { summary(`ALERT AFTER AN AMBIGUOUS REF UPDATE (${text}): main is ${tipAfter}, neither the created commit ${newSha} nor the cleared base ${fields.base}`); process.exit(2); }
}
summary(`LANDED PR #${number}: ${newSha}`);

// 8. Verify main now is the created commit, then close the PR with a comment naming it. The PR does not show as merged (the landed commit is not the PR head); that is expected.
// EVERYTHING from here on happens after the ref update was accepted (or may have been): nothing below may exit 1, print a bare stack trace, or stop before the PR is dealt with.
// A failed read of main, a failed comment and a failed close are each reported on their own; the exit code is 2 for an ALERT (main's state is in doubt) and 3 for a failed comment
// or close alone (the commit landed; do the housekeeping by hand).
let exitCode = 0;
const errText = (e) => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300);
const alertLanding = (what) => { summary(`ALERT AFTER LANDING: main was updated to ${newSha} but ${what}`); exitCode = 2; };
let mainAfter;
try { mainAfter = (await gh(`/repos/${REPO}/git/ref/heads/main`)).object.sha; } catch (error) { alertLanding(`reading main back failed: ${errText(error)}`); }
if (mainAfter !== undefined && mainAfter !== newSha) { summary(`ALERT AFTER LANDING: main is ${mainAfter}, expected ${newSha}`); process.exit(2); }
if (mainAfter === newSha) summary(`Landed commit ${newSha}: parent ${fields.base}, tree ${fields.tree} (= the cleared tree).`);
try { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `landed=${newSha}\n`); } catch (error) { alertLanding(`writing the job output failed: ${errText(error)}`); }
try {
  await gh(`/repos/${REPO}/issues/${number}/comments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: `Landed on main as ${newSha} (tree ${fields.tree}, parent ${fields.base}) by the Julius landing workflow. This pull request is closed, not merged: the landed commit is not the PR head, which is expected.` }) });
} catch (error) {
  summary(`WARNING: the commit landed but commenting on PR #${number} failed: ${errText(error)}. Comment by hand.`);
  if (exitCode === 0) exitCode = 3;
}
try {
  await gh(`/repos/${REPO}/pulls/${number}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'closed' }) });
} catch (error) {
  summary(`WARNING: the commit landed but closing PR #${number} failed: ${errText(error)}. Close it by hand.`);
  if (exitCode === 0) exitCode = 3;
}
process.exit(exitCode);
