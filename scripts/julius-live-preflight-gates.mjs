/**
 * LIVE PREFLIGHT — may this job execute the credentialed rig at all?
 *
 * Two gates already answer the standing questions: `julius-main-provenance`
 * asks whether the tree on `main` is an approved worker candidate, and
 * `julius-main-monotonicity` asks whether `main` has only moved forward. This
 * one asks the question a RUN has to ask, which neither of them can: is the code
 * this job is about to execute the code those gates just vouched for?
 *
 * THE VERIFIER MUST NOT COME FROM THE COMMIT IT IS JUDGING.
 *
 * A candidate commit running its own verifier to decide whether it is
 * trustworthy is not a check, it is a formality: alter the verifier in the same
 * push and it returns success. So this file is written to be executed from a
 * SEPARATE checkout pinned to a previously accepted-main checkpoint, while it
 * evaluates a completely different commit named to it as an argument.
 *
 * Everything it needs therefore arrives explicitly. There is no ambient branch,
 * no "the repository we are in", no reading of the working tree. It takes the
 * repository, the branch, the ref the job is running for and the job's own
 * commit, reads the branch remotely, and reports on the relationship between
 * them. Run from the trusted checkout it is a real check; run from the candidate
 * it would still be honest, but nobody should rely on that and the workflow will
 * not.
 *
 * THE INVARIANT, IN ORDER.
 *
 *   1. Read `main` and freeze its exact sha for the whole preflight.
 *   2. The ref this job runs for is exactly `refs/heads/main`.
 *   3. The job's own commit IS that frozen sha.
 *   4. Reviewed-main provenance says `provenant`, for that frozen sha.
 *   5. Main monotonicity says `monotonic`, for that same frozen sha.
 *   6. Re-read `main` after both.
 *   7. It is still the frozen sha.
 *   8. Only then, pass.
 *
 * Steps 4 and 5 are bound to the frozen sha rather than merely believed: each
 * gate reports the commit it evaluated, and a report about a different commit is
 * a report about a different question. Without that binding the two gates could
 * describe two different states of the branch and the pair would still look
 * like agreement.
 *
 * FAIL CLOSED. `pass` is the only passing verdict. `blocked` is a definite
 * negative — the wrong ref, the wrong commit, an unapproved tree, a rolled-back
 * branch. `indeterminate` is everything unreadable, contradictory or moving.
 * Both block. Unknown is never converted into success.
 *
 * WHERE THIS MUST SIT IN THE EVENTUAL WORKFLOW (recorded, not implemented here).
 *
 * Immediately after the trusted-verifier checkout and its Node setup, and BEFORE
 * any step that interprets candidate-controlled repository content — the mission
 * contract, the input gate, the build. Trust in the branch, the commit, its
 * provenance and its monotonicity has to be established before the candidate
 * gets to say anything, or the checks are running downstream of the thing they
 * are checking.
 *
 * NO PROVIDER, EVER. This module reads GitHub and nothing else: no provider SDK,
 * no model, no network client beyond `gh`. It also writes nothing anywhere — no
 * dispatch, no marker, no status, no artifact. It is a question, not an action.
 */

/** The only verdicts. Anything not `pass` blocks. */
export const LIVE_PREFLIGHT_VERDICTS = Object.freeze(['pass', 'blocked', 'indeterminate']);

/** The branch a live mission may run from, and the only ref that names it. */
export const LIVE_BRANCH = 'main';
export const LIVE_REF = `refs/heads/${LIVE_BRANCH}`;

const FULL_SHA = /^[0-9a-f]{40}$/u;
const isSha = (value) => typeof value === 'string' && FULL_SHA.test(value);

const verdict = (name, reason, extra = {}) => ({ verdict: name, reason, ...extra });

/**
 * A gate's report, as this helper requires it.
 *
 * `exitCode` is the gate's own answer and `verdict` is what it said; they are
 * both required because either alone can be wrong in a way the other catches.
 * An exit code with no verdict is a gate whose output could not be read; a
 * verdict that disagrees with the exit code is a gate that contradicted itself,
 * and neither is something to interpret generously.
 */
function readGate(report, name, expectedVerdict, frozenMainSha) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) {
    return verdict('indeterminate', `the ${name} gate produced no readable report`);
  }
  if (typeof report.verdict !== 'string' || report.verdict === '') {
    return verdict('indeterminate', `the ${name} gate reported no verdict`);
  }
  if (!Number.isInteger(report.exitCode)) {
    return verdict('indeterminate', `the ${name} gate reported no exit status`);
  }
  /**
   * A GATE THAT CONTRADICTS ITSELF IS NOT EVIDENCE.
   *
   * Exit 0 means the gate passed and its verdict must be the passing one; a
   * non-zero exit must not carry the passing verdict. Either combination is a
   * gate that has been altered, wrapped, or misread, and reading past it would
   * mean choosing which half to believe.
   */
  const passed = report.exitCode === 0;
  if (passed !== (report.verdict === expectedVerdict)) {
    return verdict('indeterminate',
      `the ${name} gate contradicted itself: exit ${report.exitCode} with verdict ${report.verdict}`);
  }
  // THE SAME EPOCH. A gate's report is about the commit it read; one about a
  // different commit answers a different question, however good its answer.
  if (report.mainSha !== frozenMainSha) {
    return verdict('indeterminate',
      `the ${name} gate evaluated ${typeof report.mainSha === 'string' ? report.mainSha : 'an unreadable commit'}, not the frozen ${frozenMainSha}`);
  }
  if (!passed) {
    return verdict(report.verdict === 'indeterminate' ? 'indeterminate' : 'blocked',
      `${name} is ${report.verdict}${typeof report.reason === 'string' && report.reason !== '' ? `: ${report.reason}` : ''}`);
  }
  return null;
}

/**
 * @param {object} input
 * @param {unknown} input.repository     `owner/repo`, for reporting.
 * @param {unknown} input.branch         The branch a live run may execute from.
 * @param {unknown} input.ref            The ref this job is running for.
 * @param {unknown} input.workflowSha    This job's own commit.
 * @param {unknown} input.frozenMainSha  `main`, read once at the start.
 * @param {unknown} input.provenance     { exitCode, verdict, mainSha, reason? }
 * @param {unknown} input.monotonicity   { exitCode, verdict, mainSha, accepted?, reason? }
 * @param {unknown} input.finalMainSha   `main`, re-read after both gates.
 */
export function evaluateLivePreflight(input) {
  /**
   * ONLY `main`, AND THE CALLER DOES NOT GET TO SAY WHICH BRANCH THAT IS.
   *
   * An earlier revision took the branch from the input and built the expected
   * ref out of it, which made the pair self-consistent for ANY branch: pass
   * `relay/anything` with `refs/heads/relay/anything` and the relationship
   * holds. The constants existed and enforced nothing.
   *
   * Both halves are now checked against the constants independently. The branch
   * is still an explicit argument, because a workflow naming what it is asking
   * about is auditable and a silent default is not — but naming it wrong is
   * refused rather than honoured. A caller cannot make another branch legitimate
   * by being consistent about it.
   */
  const branch = input?.branch;
  if (typeof branch !== 'string' || branch === '') {
    return verdict('indeterminate', 'the branch this preflight was asked about could not be read');
  }
  if (branch !== LIVE_BRANCH) {
    return verdict('blocked',
      `a live mission may only run from ${LIVE_BRANCH}, and this preflight was asked about ${branch}`,
      { ref: typeof input?.ref === 'string' ? input.ref : null });
  }

  /**
   * THE REF IS CHECKED AS A WHOLE STRING against the constant, not as a suffix,
   * not as a name, and not against anything derived from the input.
   *
   * `refs/heads/main` is the branch; `refs/tags/main`, `refs/heads/mainline`
   * and a dispatch from any other branch are not, and one of them being a
   * plausible-looking near-miss is exactly why this compares the whole thing.
   */
  const ref = input?.ref;
  if (typeof ref !== 'string' || ref !== LIVE_REF) {
    return verdict('blocked',
      `this job runs for ${typeof ref === 'string' && ref !== '' ? ref : 'an unreadable ref'}, not ${LIVE_REF}`,
      { ref: typeof ref === 'string' ? ref : null });
  }

  const frozenMainSha = input?.frozenMainSha;
  if (!isSha(frozenMainSha)) {
    return verdict('indeterminate', `${LIVE_BRANCH} could not be read as a full commit sha`, { ref });
  }

  /**
   * AND THE JOB'S OWN COMMIT IS THE ONE THAT WAS VERIFIED.
   *
   * Everything below establishes facts about `main`. If the job is executing a
   * different commit, those facts are about code that is not running, which is
   * the difference between a check and a decoration.
   */
  const workflowSha = input?.workflowSha;
  if (!isSha(workflowSha)) {
    return verdict('blocked', 'the commit this job is running could not be read as a full commit sha',
      { frozenMainSha, ref });
  }
  if (workflowSha !== frozenMainSha) {
    return verdict('blocked',
      `this job is running ${workflowSha}, which is not the ${LIVE_BRANCH} tip ${frozenMainSha} the gates describe`,
      { frozenMainSha, workflowSha, ref });
  }

  const provenance = readGate(input?.provenance, 'reviewed-main provenance', 'provenant', frozenMainSha);
  if (provenance !== null) return { ...provenance, frozenMainSha, workflowSha, ref };

  const monotonicity = readGate(input?.monotonicity, 'main monotonicity', 'monotonic', frozenMainSha);
  if (monotonicity !== null) return { ...monotonicity, frozenMainSha, workflowSha, ref };

  /**
   * THE RE-READ HAPPENS AFTER BOTH GATES, AND BEFORE ANY PASS.
   *
   * A branch that advanced while the gates ran leaves two true reports about a
   * commit that is no longer the tip. The job would then execute one commit
   * having verified another, which is the same failure as running the wrong ref
   * and is refused the same way.
   */
  const finalMainSha = input?.finalMainSha;
  if (!isSha(finalMainSha)) {
    return verdict('indeterminate', `${LIVE_BRANCH} could not be re-read to prove it held still`,
      { frozenMainSha, workflowSha, ref });
  }
  if (finalMainSha !== frozenMainSha) {
    return verdict('indeterminate',
      `${LIVE_BRANCH} moved during the preflight: ${frozenMainSha} then ${finalMainSha}`,
      { frozenMainSha, workflowSha, ref, finalMainSha });
  }

  const accepted = input?.monotonicity?.accepted;
  return verdict('pass',
    `${LIVE_BRANCH} ${frozenMainSha} is provenant and monotonic, and is the commit this job is running`,
    {
      frozenMainSha,
      workflowSha,
      ref,
      provenance: 'provenant',
      monotonicity: 'monotonic',
      acceptedCheckpoints: Number.isInteger(accepted) ? accepted : null,
      finalMainSha,
    });
}

/* ------------------------------------------------------------------ CLI --- */

import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Read one `key=value ... reason=<free text>` line, as both gates emit.
 *
 * Everything up to ` reason=` is a space-separated list of key/value pairs; the
 * reason is free text and is taken whole. A line missing the key this caller
 * asked for yields null, which the kernel turns into `indeterminate` — an
 * unparseable gate is not a gate that passed.
 */
export function parseGateLine(text, verdictKey) {
  if (typeof text !== 'string') return null;
  const line = text.split('\n').map((row) => row.trim()).filter((row) => row.includes(`${verdictKey}=`)).pop();
  if (line === undefined) return null;
  const marker = ' reason=';
  const at = line.indexOf(marker);
  const head = at === -1 ? line : line.slice(0, at);
  const reason = at === -1 ? '' : line.slice(at + marker.length);
  const fields = {};
  for (const token of head.split(/\s+/u)) {
    const eq = token.indexOf('=');
    if (eq > 0) fields[token.slice(0, eq)] = token.slice(eq + 1);
  }
  if (typeof fields[verdictKey] !== 'string') return null;
  const accepted = Number.parseInt(fields.accepted ?? '', 10);
  return {
    verdict: fields[verdictKey],
    mainSha: fields.main,
    accepted: Number.isNaN(accepted) ? undefined : accepted,
    reason,
  };
}

/**
 * Usage: node scripts/julius-live-preflight-gates.mjs <owner/repo> <branch> <ref> <workflow-sha>
 *
 * Every input is explicit. Nothing is inferred from the working tree, because
 * this is meant to run from a checkout that is deliberately NOT the one being
 * judged.
 */
async function main(argv) {
  const [repository, branch, ref, workflowSha] = argv;
  if (typeof repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/u.test(repository)
    || typeof branch !== 'string' || !/^[\w./-]+$/u.test(branch)
    || typeof ref !== 'string' || ref === ''
    || typeof workflowSha !== 'string' || workflowSha === '') {
    process.stderr.write('usage: julius-live-preflight-gates.mjs <owner/repo> <branch> <ref> <workflow-sha>\n');
    return 2;
  }

  const here = import.meta.dirname;
  /**
   * BOTH COMMANDS ARE LITERALS, and their arguments are built separately.
   *
   * The repository boundary scanner requires a deployment-capable path to be
   * statically readable: it wants to know WHAT a script runs, and a command
   * assembled at runtime — `process.execPath`, or an argv literal holding a
   * variable — is a command it cannot read. This shape is the one the scanner
   * sanctions and the one the rest of `scripts/` already uses. It matters more
   * here than elsewhere, because this file spawns two other scripts and a
   * follower that cannot name them cannot follow them.
   *
   * `node` resolves through PATH rather than pinning the running interpreter.
   * That is the same trust already placed in `gh` on the line below, and the
   * workflow that will call this pins its Node with `actions/setup-node`.
   */
  const gh = (path) => {
    const argv = ['api', path];
    return JSON.parse(execFileSync('gh', argv, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  };
  const runGate = (script, args, verdictKey) => {
    // Resolved beside THIS file, so the gate comes from the same trusted
    // checkout this helper was launched from and never from the candidate.
    const argv = [join(here, script), ...args];
    // Both streams: these gates print their verdict line to stdout on success
    // and to stderr on failure, and the failing line is the one worth reading.
    let stdout = ''; let stderr = ''; let exitCode = 0;
    try {
      stdout = execFileSync('node', argv, { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      const failure = error;
      exitCode = Number.isInteger(failure?.status) ? failure.status : -1;
      stdout = typeof failure?.stdout === 'string' ? failure.stdout : '';
      stderr = typeof failure?.stderr === 'string' ? failure.stderr : '';
    }
    const parsed = parseGateLine(`${stdout}\n${stderr}`, verdictKey);
    return parsed === null ? { exitCode } : { ...parsed, exitCode };
  };

  let result;
  try {
    const encoded = encodeURIComponent(branch);
    const frozenMainSha = gh(`repos/${repository}/branches/${encoded}`)?.commit?.sha;
    const provenance = runGate('julius-main-provenance.mjs', [repository, branch], 'provenance');
    const monotonicity = runGate('julius-main-monotonicity.mjs', [repository, branch], 'monotonicity');
    const finalMainSha = gh(`repos/${repository}/branches/${encoded}`)?.commit?.sha;
    result = evaluateLivePreflight({
      repository, branch, ref, workflowSha, frozenMainSha, provenance, monotonicity, finalMainSha,
    });
  } catch (error) {
    // Unreadable evidence is not a passing preflight.
    process.stderr.write(`live_preflight_indeterminate: ${error instanceof Error ? error.message : 'metadata unavailable'}\n`);
    return 1;
  }

  const line = `repo=${repository} branch=${branch} live_preflight=${result.verdict}`
    + ` ref=${result.ref ?? 'unknown'}`
    + ` frozen_main=${result.frozenMainSha ?? 'unknown'}`
    + ` workflow_sha=${result.workflowSha ?? 'unknown'}`
    + ` provenance=${result.provenance ?? 'not-reached'}`
    + ` monotonicity=${result.monotonicity ?? 'not-reached'}`
    + ` accepted=${result.acceptedCheckpoints ?? 'unknown'}`
    + ` final_main=${result.finalMainSha ?? 'unknown'}`
    + ` reason=${result.reason}`;
  if (result.verdict === 'pass') {
    process.stdout.write(`${line}\n`);
    return 0;
  }
  process.stderr.write(`${line}\n`);
  return 1;
}

const entrypoint = (() => {
  if (!process.argv[1]) return null;
  try { return pathToFileURL(realpathSync(process.argv[1])).href; } catch { return null; }
})();
if (entrypoint !== null && import.meta.url === entrypoint) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
