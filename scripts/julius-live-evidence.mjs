#!/usr/bin/env node
/**
 * Builds the mission's uploadable evidence by ALLOWLIST, never by redaction.
 *
 * The first draft of this workflow `tee`'d the entrypoint's stdout to a file
 * and uploaded it. That is safe only for as long as every line the entrypoint
 * will ever print is safe, which is a promise about future code rather than a
 * property of this one — and GitHub's `::add-mask::` does not help, because it
 * redacts the console stream while `tee` writes the raw bytes to disk.
 *
 * So nothing is uploaded because it looked harmless. A line is emitted only if
 * it MATCHES A KNOWN SHAPE — a task transition, an evidence record, a
 * verification decision, a SET/MISSING presence report — and even then it is
 * put through a secret-shape rejector before it is allowed out. Anything
 * unrecognised is dropped and counted, so the artifact reports how much it
 * withheld instead of quietly passing it through.
 *
 * Reads a log on stdin or from a file argument; writes the filtered evidence to
 * stdout. It is given no credential and needs none: the job's own ephemeral
 * values are matched exactly by a separate scan in the workflow, which is the
 * layer that catches a secret this one has no shape for.
 */

import { readFileSync } from 'node:fs';

/**
 * The shapes the live entrypoint prints. Each is anchored, so a line that
 * merely CONTAINS one of these does not qualify — it must be one.
 */
const ALLOWED = [
  /^JULIUS LIVE MISSION — preflight$/u,
  /^  mission: [\w:.-]+ \(project [\w:.-]+\)$/u,
  /^  requested models: architect=\S+ coder=\S+ reviewer=\S+$/u,
  // How the review packet reaches Hermes. The roles check refuses anything but
  // `file`, and the bundle has to be able to show which one a run was given.
  /^  reviewer_prompt_transport: (argv|file|unrecognised)$/u,
  // WHETHER THE LIVE LEDGER WAS BOUND. The roles check refuses the run unless
  // it says BOUND, and a receipt has to be able to show that from the bundle:
  // qualification 34753589938's preflight-roles evidence withheld this line.
  /^  live_ledger: (BOUND|UNBOUND|UNKNOWN)$/u,
  /^  [A-Z][A-Z0-9_]*: (SET|MISSING)$/u,
  /^  BLOCKED [a-z_ ]+: .+$/iu,
  /^RESULT: [A-Z_]+( \(stalled before terminal state\))?( after \d+ ticks)?$/u,
  // The outcomes that matter most are the failures: a BLOCKED or crashed paid
  // run must state WHAT happened in its own artifact. The free-text tails stay
  // subject to the secret rejectors below, like every other kept line.
  /^RESULT: [A-Z_]+( at bootstrap)? — .+$/u,
  /^JULIUS LIVE MISSION crashed: .+$/u,
  /^  cause: .+$/u,
  /^Run [\w:.-]+ accepted in state [A-Z_]+; driving the Julius run loop\.$/u,
  /^  run: [\w:.-]+$/u,
  /^  task [\w:.-]+ \[[\w:.-]+\/[\w:.-]+\] → [A-Z_]+$/u,
  /^  evidence [\w:.-]+ \[[A-Z_]+\/[A-Z_]+\] .*$/u,
  /^  finding [\w:.-]+ blocking=(true|false) status=[A-Z_]+ — .*$/u,
  /^  verification decisions: .*$/u,
  /^julius_exit=\d+$/u,
  /^JULIUS LIVE PREFLIGHT — .+$/u,
  /^PREFLIGHT (OK|FAILED)(:.*)?$/u,
];

/**
 * Structural refusals applied AFTER the allowlist. A recognised shape whose
 * free-text tail carries key-shaped material is dropped rather than trimmed:
 * the point is that nothing unexamined leaves the runner.
 */
const SECRET_SHAPES = [
  /\b(sk|xai|rk|pk)-[A-Za-z0-9_-]{12,}/u,
  /\bsk-(ant|proj|svcacct|admin)-[A-Za-z0-9_-]{8,}/u,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/u,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/u,
  /\bAKIA[0-9A-Z]{12,}/u,
  /-----BEGIN [A-Z ]*(PRIVATE )?KEY-----/u,
  /\bAuthorization:\s*\S+/iu,
  /\b(?:password|passwd|secret|api[_-]?key|credential|token)\s*[:=]\s*\S{8,}/iu,
  /\bpostgres(?:ql)?:\/\/[^\s:/@]+:[^\s:/@]{6,}@/u,
];

/**
 * A generic high-entropy catch for a credential no shape above anticipates —
 * the derived scoped credentials are 43-character base64url, for instance.
 * Deliberately narrow: it requires MIXED CASE, so the sha256 digests and
 * lowercase-hex run identifiers that legitimately appear in evidence are not
 * mistaken for key material.
 */
function carriesOpaqueSecret(line) {
  for (const token of line.match(/[A-Za-z0-9+/=_-]{32,}/gu) ?? []) {
    const hasUpper = /[A-Z]/u.test(token);
    const hasLower = /[a-z]/u.test(token);
    if (!hasUpper || !hasLower) continue;
    if (new Set(token).size >= 16) return true;
  }
  return false;
}

export function filterEvidence(log) {
  const kept = [];
  let droppedUnrecognised = 0;
  let droppedUnsafe = 0;

  for (const raw of log.split('\n')) {
    const line = raw.replace(/\r$/u, '');
    if (line.trim() === '') continue;
    if (!ALLOWED.some((shape) => shape.test(line))) { droppedUnrecognised += 1; continue; }
    if (SECRET_SHAPES.some((shape) => shape.test(line)) || carriesOpaqueSecret(line)) { droppedUnsafe += 1; continue; }
    kept.push(line);
  }
  return { kept, droppedUnrecognised, droppedUnsafe };
}

const path = process.argv[2];
const source = path && path !== '-' ? readFileSync(path, 'utf8') : readFileSync(0, 'utf8');
const { kept, droppedUnrecognised, droppedUnsafe } = filterEvidence(source);

const out = [
  '# Julius live mission — evidence (allowlisted lines only)',
  `# ${kept.length} line(s) kept; ${droppedUnrecognised} unrecognised and ${droppedUnsafe} secret-shaped line(s) withheld.`,
  '',
  ...kept,
];
process.stdout.write(`${out.join('\n')}\n`);
