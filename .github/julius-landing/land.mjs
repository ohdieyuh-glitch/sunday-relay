// Driver of the autonomous landing gate. Runs inside .github/workflows/julius-land.yml. Git writes use JULIUS_LANDER_TOKEN (julius-lander[bot]). The workflow token only comments and closes the pull request, and reads.
// It reads GitHub, asks `land-lib.mjs` whether EVERY condition holds, and only then creates the landing commit (the cleared tree on the cleared base, the signed clearance in its
// message) with the git data API, spends the clearance's nonce as a tag, and advances main with a NON-FORCED ref update (a fast-forward test). It never uses the merge endpoint. Fail closed: any problem, any unexpected API
// answer and any timeout ends the job without a landing. DRY_RUN=true makes every read and every check and writes nothing.
import { readFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LANDER_APP_ID, LANDER_IDENTITY, REPO, botCommentsDigest, buildLandingCommitMessage, checkCi, checkCreatedCommit, checkPullRequest, checkRuntime, ciIsPending, nonceUsed, parseClearance, parseLandingCommitMessage, parseRequiredChecks, verifyClearanceSignature } from './land-lib.mjs';
import { PER_PAGE, readAllPages } from './land-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const API = 'https://api.github.com';
const SELF_CHECK = 'Land a cleared pull request';
// r5: NOTHING this job prints may carry a credential, whatever an API, a proxy or a library echoes back into an error text. Every line goes through `summary`, which redacts the token
// literal, GitHub token shapes (ghs_/ghp_/gho_/ghu_/ghr_/github_pat_), `Bearer <x>` and `Authorization: <x>` first. (The runner also masks GITHUB_TOKEN; this does not rely on it.)
// V-4: the token is also redacted when a line break (or any whitespace) splits it, in its base64 forms (alone, behind `x-access-token:`, at the three byte alignments) and when ANY of its characters
// is written as a percent escape (%XX, upper or lower hex, also escaped again as %25XX: up to three levels). v3.5c: v3.5b only compared against encodeURIComponent(token), which is the token itself for
// the characters of a GitHub token, so a REAL percent-encoded echo (ghs%5F..., %67%68%73%5F...) was not hidden. Each character below matches itself OR its %XX, so partial encodings are covered.
// v3.5d: a GitHub token SHAPE (any credential, not only the job token) is also hidden when a line break (LF or CRLF, then at most one space or tab) splits it at ANY character; a plain space is not a gap.
// `Authorization: <x>` also covers a quoted value. v3.5e: the same line-break gap is also accepted INSIDE every %XX escape (between the %, the 25 levels and the two hex digits).
// Every sentence of the README "Output redaction" paragraph is a probe run on this function; the residuals (plain space inside a foreign shape or inside an escape, a lone CR, ...) are listed there and pinned by tests.
const b64Middles = (s) => [0, 1, 2].map((pad) => Buffer.from(' '.repeat(pad) + s).toString('base64')).map((e, pad) => e.slice(Math.ceil((pad * 8) / 6), Math.max(0, e.length - 4))).filter((m) => m.length >= 8);
// A direct scan, not a per-token expression. The expression this replaced was compiled on the first call and cost about half a second for a
// 40-character token, so every fresh process (one per end-to-end case) missed its deadline. Behaviour is the same: each character is itself or
// its %XX / %25XX form (at most three levels), a line-break gap may sit inside an escape, and the words after a token survive.
const WS = /\s/u;
const hexVal = (c) => {
  const x = c === undefined ? -1 : c.charCodeAt(0);
  if (x >= 48 && x <= 57) return x - 48;
  if (x >= 65 && x <= 70) return x - 55;
  if (x >= 97 && x <= 102) return x - 87;
  return -1;
};
// (?:\r?\n[ \t]?)? taken greedily. The atom after a gap is never CR, LF, space or tab, so failing to take the gap cannot succeed either.
const readGap = (s, i) => {
  let j = i;
  const a = s.charCodeAt(j);
  if (a === 13 && s.charCodeAt(j + 1) === 10) j += 2;
  else if (a === 10) j += 1;
  else return i;
  const b = s.charCodeAt(j);
  if (b === 32 || b === 9) j += 1;
  return j;
};
const skipWs = (s, i) => {
  let j = i;
  while (j < s.length) {
    const cp = s.codePointAt(j);
    const ch = String.fromCodePoint(cp);
    if (!WS.test(ch)) break;
    j += ch.length;
  }
  return j;
};
// '%' , a gap, ('2' gap '5' gap){0,3} greedy, then two hex digits with a gap between them. accept(byte) chooses the payload.
const matchPercentByte = (s, i, accept) => {
  if (s.charCodeAt(i) !== 37) return -1;
  for (let depth = 3; depth >= 0; depth -= 1) {
    let j = readGap(s, i + 1);
    let ok = true;
    for (let d = 0; d < depth; d += 1) {
      if (s.charCodeAt(j) !== 50) { ok = false; break; }
      j = readGap(s, j + 1);
      if (s.charCodeAt(j) !== 53) { ok = false; break; }
      j = readGap(s, j + 1);
    }
    if (!ok) continue;
    const h1 = hexVal(s[j]);
    if (h1 < 0) continue;
    j = readGap(s, j + 1);
    const h2 = hexVal(s[j]);
    if (h2 < 0) continue;
    if (accept((h1 << 4) | h2)) return j + 1;
  }
  return -1;
};
/** One character at i: itself, or %XX (either hex case), or that %XX escaped again (%25XX, at most three levels), a line-break gap allowed inside. Only a byte has a %XX form. Returns the index after the match, or -1. */
const charOrEscape = (s, i, ch) => {
  if (s.startsWith(ch, i)) return i + ch.length;
  const code = ch.codePointAt(0);
  if (code > 0xff) return -1;
  return matchPercentByte(s, i, (b) => b === code);
};
const matchSequence = (s, i, chars, matchOne) => {
  let j = i;
  for (let c = 0; c < chars.length; c += 1) {
    if (c > 0) j = readGap(s, j);
    const n = matchOne(s, j, chars[c]);
    if (n < 0) return -1;
    j = n;
  }
  return j;
};
// Whitespace between the characters of a job token that does not itself contain whitespace. Greedy, and no backtrack: a token character is not whitespace, so giving a space back cannot help it match.
const matchJobAt = (s, i, chars) => {
  let j = i;
  for (let c = 0; c < chars.length; c += 1) {
    if (c > 0) j = skipWs(s, j);
    const n = charOrEscape(s, j, chars[c]);
    if (n < 0) return -1;
    j = n;
  }
  return j > i ? j : -1;
};
const replaceLeftmost = (s, chars, matchAt, canStart) => {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (canStart(s, i, chars)) {
      const end = matchAt(s, i, chars);
      if (end > i) { out += '***'; i = end; continue; }
    }
    out += s[i];
    i += 1;
  }
  return out;
};
const jobCanStart = (s, i, chars) => s.startsWith(chars[0], i) || s.charCodeAt(i) === 37;
// base64url writes '+' as '-' and '/' as '_', and either may be the first character of a middle.
const b64CanStart = (s, i, chars) => {
  if (jobCanStart(s, i, chars)) return true;
  const ch = chars[0];
  if (ch === '+' && s.startsWith('-', i)) return true;
  if (ch === '/' && s.startsWith('_', i)) return true;
  return false;
};
const b64One = (s, i, ch) => {
  const alts = ch === '+' ? ['+', '-'] : ch === '/' ? ['/', '_'] : [ch];
  for (const a of alts) {
    const n = charOrEscape(s, i, a);
    if (n >= 0) return n;
  }
  return -1;
};
const isAlnumByte = (b) => (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122);
const SHAPE_PREFIXES = ['ghs', 'ghp', 'gho', 'ghu', 'ghr'];
const matchPrefixedHead = (s, i) => {
  for (const w of SHAPE_PREFIXES) {
    const end = matchSequence(s, i, [...`${w}_`], charOrEscape);
    if (end >= 0) return end;
  }
  return -1;
};
const matchPatHead = (s, i) => matchSequence(s, i, [...'github_pat_'], charOrEscape);
const matchShapeHead = (s, i) => {
  const a = matchPrefixedHead(s, i);
  if (a >= 0) return a;
  return matchPatHead(s, i);
};
const matchUnit = (s, i, pat) => {
  const ch = s[i];
  if (ch !== undefined && (pat ? /[A-Za-z0-9_]/u : /[A-Za-z0-9]/u).test(ch)) return i + 1;
  return matchPercentByte(s, i, (b) => (pat ? isAlnumByte(b) || b === 0x5f : isAlnumByte(b)));
};
const matchShapeAt = (s, i, pat) => {
  const head = pat ? matchPatHead(s, i) : matchPrefixedHead(s, i);
  if (head < 0) return -1;
  let j = head;
  let units = 0;
  while (units < 255) {
    const at = readGap(s, j);
    if (matchShapeHead(s, at) >= 0) break;
    const n = matchUnit(s, at, pat);
    if (n < 0) break;
    j = n;
    units += 1;
  }
  return units >= 16 ? j : -1;
};
const replaceShapes = (s, pat) => {
  let out = '';
  let i = 0;
  while (i < s.length) {
    // every shape head starts with 'g', or with a percent escape of 'g'
    const c = s.charCodeAt(i);
    if (c === 103 || c === 37) {
      const end = matchShapeAt(s, i, pat);
      if (end > i) { out += '***'; i = end; continue; }
    }
    out += s[i];
    i += 1;
  }
  return out;
};
// Only a job token that itself contains whitespace still needs an expression: `\s*` between its characters has to backtrack through that token's own whitespace. A GitHub token has none.
const GAP_SRC = '(?:\\r?\\n[ \\t]?)?';
const reEscape = (c) => c.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const percentSrc = (hexPair) => `%${GAP_SRC}(?:2${GAP_SRC}5${GAP_SRC}){0,3}${hexPair}`;
const charPattern = (c) => {
  const code = c.codePointAt(0);
  if (code > 0xff) return reEscape(c);
  const digits = [...code.toString(16).padStart(2, '0')].map((d) => (/[a-f]/u.test(d) ? `[${d}${d.toUpperCase()}]` : d));
  return `(?:${reEscape(c)}|${percentSrc(digits.join(GAP_SRC))})`;
};
let jobScan = null;
const jobScanFor = (token) => {
  if (jobScan !== null && jobScan.token === token) return jobScan;
  const chars = token.length <= 256 ? [...token] : null;
  const hasWs = chars !== null && chars.some((c) => WS.test(c));
  const middles = chars === null ? [] : [token, `x-access-token:${token}`, `${token}:x-oauth-basic`].flatMap((form) => b64Middles(form).map((m) => [...m]));
  let literal = null;
  if (hasWs) { try { literal = new RegExp(chars.map(charPattern).join('\\s*'), 'gu'); } catch { literal = null; } }
  jobScan = { token, chars, hasWs, middles, literal };
  return jobScan;
};
const redactOne = (text, token) => {
  if (!token || token.length < 8) return text;
  let out = text.split(token).join('***');
  const scan = jobScanFor(token);
  if (scan.chars !== null) {
    if (scan.hasWs) { if (scan.literal !== null) out = out.replace(scan.literal, '***'); }
    else out = replaceLeftmost(out, scan.chars, matchJobAt, jobCanStart);
    for (const middle of scan.middles) out = replaceLeftmost(out, middle, (s, i, cs) => matchSequence(s, i, cs, b64One), b64CanStart);
  }
  return out;
};
const redact = (text) => {
  let out = redactOne(String(text), env.GH_TOKEN);
  out = redactOne(out, env.JULIUS_LANDER_TOKEN);
  out = replaceShapes(out, false);
  out = replaceShapes(out, true);
  return out
    // v3.5e: `Bearer` takes a quoted value, or a word, after an optional `:` / `=`. v3.5h: the quotes may be backslash-escaped (JSON inside JSON: \" ... \"; the closing run of backslashes equals the
    // opening run and is not itself preceded by a backslash, so an escaped quote of a deeper level inside the value does not end it); an unterminated escaped quote hides the rest of the line.
    .replace(/\bBearer(?:\s*[:=]\s*|\s+)(?:(\\+)(["'])[^\r\n]*?(?<!\\)\1\2|\\+["'][^\r\n]*|"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|["'][^\r\n]*|[^\s"',;]+)/giu, 'Bearer ***')
    // `Authorization` + `:` or `=`: a quoted value (JSON, single quotes) is hidden alone, quotes kept; anything else hides the REST OF THE LINE (a scheme word, a value with spaces, `;` or `,`: Negotiate, Digest, AWS4-HMAC...).
    .replace(/(authorization\\*["']?\s*[:=]\s*)(["'])(?:\\.|(?!\2)[^\\\r\n])*\2/giu, '$1$2***$2')
    .replace(/(authorization\\*["']?\s*[:=])(?!\s*(["'])\*\*\*\2)(\s*)[^\r\n]+(?:\r?\n[ \t]+[^\r\n]*)*/giu, '$1$3***');
};
const summary = (line) => { const safe = redact(line); console.log(safe); if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, safe + '\n'); };
const fail = (problems) => { for (const p of problems) summary(`REFUSED: ${p}`); summary('Nothing was landed.'); process.exit(1); };
// Any error nobody handled (an API answer that is not 2xx, a network failure, a malformed file) ends the job with ONE line, never a stack trace. Before the ref update is sent nothing has
// landed: exit 1 ("REFUSED"). From the moment the ref update is sent main's state may have changed: exit 2 ("ALERT"), told apart so nobody reads "nothing landed" into it.
let refUpdateStarted = false;
// v3.5e: redact BEFORE the cut (a token that straddles the 300-character cut or the first line break used to leave its head visible)
const oneLine = (e) => redact(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300);
const onUnexpected = (e) => {
  if (!refUpdateStarted) { summary(`REFUSED: unexpected error before anything was landed: ${oneLine(e)}`); summary('Nothing was landed.'); process.exit(1); }
  summary(`ALERT AFTER LANDING: an unexpected error occurred after the ref update was sent: ${oneLine(e)}; check main by hand`);
  process.exit(2);
};
process.on('uncaughtException', onUnexpected);
process.on('unhandledRejection', onUnexpected);

// a10: a DEADLINE on every request (abort covers the connection and the body). Without it a connection that hangs after an applied ref update would never reach the recovery re-read and
// the job would sit until the workflow timeout with main already moved. An aborted request has no `.status`, so it is AMBIGUOUS like any lost answer. LAND_REQUEST_TIMEOUT_MS exists for
// the tests only; the workflow never sets it (a test pins that), so production always uses 30 seconds.
const REQUEST_TIMEOUT_MS = Number(env.LAND_REQUEST_TIMEOUT_MS ?? 30_000);
/** GitHub's workflow token reads, comments, and closes. The lander App token is the only credential that creates a commit or moves a ref. */
function tokenFor(method, path) {
  const verb = method ?? 'GET';
  const bare = String(path).split('?')[0];
  if (verb === 'GET' || verb === 'HEAD') return env.GH_TOKEN;
  if (verb === 'POST' && /\/git\/commits$/.test(bare)) return env.JULIUS_LANDER_TOKEN;
  if (verb === 'POST' && /\/git\/refs$/.test(bare)) return env.JULIUS_LANDER_TOKEN;
  if (verb === 'PATCH' && /\/git\/refs\/heads\/main$/.test(bare)) return env.JULIUS_LANDER_TOKEN;
  if (verb === 'POST' && /\/issues\/\d+\/comments$/.test(bare)) return env.GH_TOKEN;
  if (verb === 'PATCH' && /\/pulls\/\d+$/.test(bare)) return env.GH_TOKEN;
  throw new Error(`no token is authorized for ${verb} ${bare}`);
}
async function ghRaw(path, init = {}) {
  const token = tokenFor(init.method, path);
  return fetch(`${API}${path}`, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) } });
}
async function gh(path, init = {}) {
  const res = await ghRaw(path, init);
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw Object.assign(new Error(`${init.method ?? 'GET'} ${path} -> ${res.status}: ${typeof body === 'string' ? redact(body).slice(0, 200) : body?.message}`), { status: res.status });
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
if (env.JULIUS_LANDER_APP_ID !== LANDER_APP_ID) {
  fail([env.JULIUS_LANDER_APP_ID ? `JULIUS_LANDER_APP_ID is ${env.JULIUS_LANDER_APP_ID}, not the pinned lander app ${LANDER_APP_ID}` : 'JULIUS_LANDER_APP_ID is unset']);
}
if (typeof env.JULIUS_LANDER_TOKEN !== 'string' || env.JULIUS_LANDER_TOKEN === '') fail(['JULIUS_LANDER_TOKEN is unset']);

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
// b6: the nonce history scan above cannot see a use while main == the cleared base (the landing is a CHILD of the base: a reset of main to the base would re-open the clearance), so each
// landing also spends the nonce as a TAG, created before main is touched (step 7). A spent tag refuses here, whatever main's history is. 404 is the only "unspent" answer: anything
// else (the tag exists, or the read failed) refuses. A dry run only READS this.
const NONCE_TAG = `julius-landing-nonce-${fields.nonce}`;
const tagRead = await ghRaw(`/repos/${REPO}/git/ref/tags/${NONCE_TAG}`);
await tagRead.text().catch(() => '');
if (tagRead.status !== 404) fail([`the nonce tag ${NONCE_TAG} exists or could not be read (HTTP ${tagRead.status}): this clearance was already used, or its use cannot be ruled out`]);
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

// Main's tip, read ONE MORE TIME immediately before acting: if it moved since the checks, abort (the cleared base is no longer the tip). The ref update below is a fast-forward
// test (see 7b): a main that moved FORWARD after this read is refused by GitHub, not merely noticed; a main reset backward after it is not caught.
const tipNow = (await gh(`/repos/${REPO}/git/ref/heads/main`)).object.sha;
if (tipNow !== fields.base) fail([`main moved to ${tipNow} immediately before the landing; the clearance names base ${fields.base}`]);

// Fail closed: ONLY the exact string "false" lands; "true", empty, "False" or anything else is a dry run. A dry run has made every READ and every check above, and has computed the
// commit body; it performs NO write (no commit, no ref update, no comment, no close) and prints exactly what the live run would send.
if (env.DRY_RUN !== 'false') {
  summary('DRY RUN: every gate holds. The live run would do exactly this, and nothing was written:');
  summary(`  1. POST /repos/${REPO}/git/commits ${JSON.stringify({ ...commitBody, message: '(below)' })}`);
  summary(`  2. read the created commit back and require tree ${fields.tree}, the single parent ${fields.base}, the exact message and the ${LANDER_IDENTITY.name} identity`);
  summary(`  3. POST /repos/${REPO}/git/refs ${JSON.stringify({ ref: `refs/tags/${NONCE_TAG}`, sha: '<the created commit sha>' })} (spends the clearance; the tag does not exist now)`);
  summary(`  4. PATCH /repos/${REPO}/git/refs/heads/main ${JSON.stringify(refBody('<the created commit sha>'))} (not forced: a fast-forward test, refused if main moved forward since the tip read)`);
  summary(`  5. comment on PR #${number} naming the landed commit, then close the PR (it will not show as merged; that is expected)`);
  summary(`--- the landing commit message ---\n${message}--- end ---`);
  process.exit(0);
}

// 6. Create the commit (git data API): exactly the cleared tree, exactly one parent = the cleared base. Nothing is on main yet.
const created = await gh(`/repos/${REPO}/git/commits`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commitBody) });
const newSha = created?.sha;
const readBack = await gh(`/repos/${REPO}/commits/${newSha}`);
const createdProblems = checkCreatedCommit({ created: readBack, sha: newSha, base: fields.base, tree: fields.tree, message });
if (createdProblems.length) fail(createdProblems.map((p) => `created commit ${newSha}: ${p}`));

// 7a. SPEND THE NONCE, then advance main. Order: AFTER the commit was created and read back (a failed or lying creation spends nothing: main is untouched and the same clearance may be
// used again) and BEFORE the ref update (the use is recorded before its effect: a crash or a failure after this line leaves the clearance spent with nothing landed, which fails CLOSED;
// the other order could land twice if recording the use failed). Creating a ref is atomic and GitHub answers 422 when it exists, so two uses of one clearance cannot both pass this
// line. A refusal from here on SPENDS the clearance: the reviewer signs a new one (new nonce). The tag points at the created commit; it never moves and is never deleted here.
try {
  await gh(`/repos/${REPO}/git/refs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: `refs/tags/${NONCE_TAG}`, sha: newSha }) });
} catch (error) {
  fail([`the nonce tag ${NONCE_TAG} could not be created (already used, or unknown): ${error instanceof Error ? error.message : String(error)}; main was not touched, and this clearance must not be reused without a new nonce`]);
}

// 7b. Advance main. NOT forced. What a non-forced ref update IS: GitHub accepts it iff the new commit is a FAST-FORWARD of main's value at that instant. So it refuses a main that moved
// forward or sideways after the tip read above (the usual race). It does NOT compare against the tip read above: a main reset BACKWARD to an ancestor of the cleared base between that
// read and this call is fast-forwarded over (that rollback is undone) and nothing here can tell. The post-update read below detects only that main is not the created commit (somebody
// moved it again): if main IS the created commit, its parent is the cleared base by construction (the sha names the content, and the read-back checked tree and parent before this
// call), so there is no state in which "main is the created commit but its parent is not the base". REST offers no expected-old-value parameter; closing the backward-reset window
// would need a different primitive (not verified here). Any failure refuses and reports; there is no retry and never a force.
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
  else if (tipAfter === fields.base) { summary(`ALERT AFTER AN AMBIGUOUS REF UPDATE (${text}): main is still the cleared base ${fields.base}, but the request could still be applied late; state in doubt. No retry, no force, no comment, PR left open. Check main before signing anything new; this clearance is spent`); process.exit(2); }
  else { summary(`ALERT AFTER AN AMBIGUOUS REF UPDATE (${text}): main is ${tipAfter}, neither the created commit ${newSha} nor the cleared base ${fields.base}`); process.exit(2); }
}
summary(`LANDED PR #${number}: ${newSha}`);

// 8. Verify main now is the created commit, then close the PR with a comment naming it. The PR does not show as merged (the landed commit is not the PR head); that is expected.
// EVERYTHING from here on happens after the ref update was accepted (or may have been): nothing below may exit 1, print a bare stack trace, or stop before the PR is dealt with.
// A failed read of main, a failed comment and a failed close are each reported on their own; the exit code is 2 for an ALERT (main's state is in doubt) and 3 for a failed comment
// or close alone (the commit landed; do the housekeeping by hand).
let exitCode = 0;
const errText = (e) => redact(e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 300);
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
