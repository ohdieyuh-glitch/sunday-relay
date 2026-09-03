/**
 * REVIEWER — Hermes (Nous Research Hermes Agent CLI).
 *
 * Hermes is the reviewer RUNTIME; its underlying provider/model is captured
 * separately and reported truthfully. The review is independent and READ-ONLY:
 * the packet is passed inline on the prompt, the process runs in an empty temp
 * cwd (so it has no path into the controlled project), and `--safe-mode` is set.
 *
 * Invoked exactly once via the installed one-shot flag (`-z/--oneshot`, proven
 * from local --help). Output is strictly validated — unparseable or malformed
 * output can NEVER be treated as approval, and a launch failure never earns
 * reviewer credit.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { safeText } from './redact';
import { parseUsageFile } from './reviewer-harness/hermes/runner';

export type HermesVerdict = 'approved' | 'changes_required' | 'unable_to_review';

export interface HermesFinding {
  findingId: string;
  severity: 'blocking' | 'major' | 'minor' | 'informational';
  requirement: string;
  file?: string;
  line?: number;
  explanation: string;
  evidence: string;
  recommendedAction?: string;
}

export interface HermesReviewResult {
  verdict: HermesVerdict;
  summary: string;
  findings: HermesFinding[];
  requirementsChecked: Array<{ requirement: string; status: 'passed' | 'failed' | 'uncertain'; evidence: string }>;
  /**
   * Relay had to normalise invalid JSON escapes before this parsed. The review
   * itself is the reviewer's; this records that the bytes were not.
   */
  parseRepaired: boolean;
}

export type HermesOutcome =
  /**
   * REQUESTED AND SERVED ARE SEPARATE FIELDS, here at the source.
   *
   * One `model` field used to carry three different facts depending on the
   * path: the local runner stamped its CONFIGURATION into it, the remote path
   * hardcoded null into it, and the provider path put the response's actual
   * model into it. A single field with three meanings is how the requested
   * model came to be attested as the one that reviewed (defect 3,
   * HOSTED_MISSION_EVIDENCE.md).
   *
   * `requestedModel` is what this path asked its engine for — configuration,
   * stated as such. `servedModel` is what the engine itself reported answered
   * — evidence, never inferred, never defaulted from `requestedModel`.
   */
  | { kind: 'reviewed'; result: HermesReviewResult; startedAt: string; completedAt: string; requestedModel: string | null; servedModel: string | null; provider: string | null }
  | { kind: 'launch_failed'; safeMessage: string }
  | { kind: 'review_incomplete'; safeMessage: string; shape: HermesReviewShape; startedAt: string; completedAt: string };

/**
 * WHY A REVIEW WAS UNREADABLE, as a machine token.
 *
 * Paid attempt #2 (run 33802017460) failed with BOTH reviewer tasks recording
 * `reviewer_review_incomplete` and nothing else. The safe message that would
 * have separated a dead credential from a model writing prose was composed and
 * then dropped: the coordinator persists `code`, `retryable` and `failureClass`
 * — not the message. So `failures.tsv` said the review was unreadable and could
 * not say in what way, which is the one thing an operator needs to know before
 * paying again.
 *
 * These are the shapes the local path can actually distinguish. They are
 * STRUCTURAL only: no reviewer text, no diff, no provider message. The token
 * travels as the Julius failure class, so it survives the database being
 * destroyed with the job.
 */
export type HermesReviewShape =
  | 'review_timeout'
  | 'review_authentication_failed'
  | 'review_provider_http_error'
  | 'review_process_exit'
  | 'review_output_too_large'
  | 'review_json_absent'
  | 'review_json_unparseable'
  | 'review_verdict_missing'
  | 'review_verdict_invalid'
  | 'review_summary_missing'
  | 'review_summary_invalid'
  | 'review_unreadable';

export interface HermesConfig {
  executable: string;
  model?: string;
  provider?: string;
  billingMode?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export function loadHermesConfig(env: NodeJS.ProcessEnv = process.env): HermesConfig {
  return {
    executable: env.RELAY_HERMES_EXECUTABLE ?? 'hermes',
    model: env.RELAY_HERMES_MODEL,
    provider: env.RELAY_HERMES_PROVIDER,
    billingMode: env.RELAY_HERMES_BILLING_MODE,
    timeoutMs: Number(env.RELAY_HERMES_TIMEOUT_MS ?? 180_000),
    maxOutputBytes: Number(env.RELAY_HERMES_MAX_OUTPUT ?? 512 * 1024),
  };
}

/* --------------------------------------------------------- preflight */

/**
 * Reviewer availability, proven before a single paid request is made.
 *
 * Three local, read-only probes: `--help` (does this build support the one-shot
 * and read-only flags Relay depends on?), `status` (which provider and model
 * does the real Hermes configuration resolve to?), and ONE minimal generation
 * that proves the configured provider actually answers.
 *
 * THE THIRD PROBE EXISTS BECAUSE THE FIRST TWO CANNOT SEE A DEAD CREDENTIAL.
 * Hermes reports a key that is merely PRESENT as configured — `status` prints a
 * ✓ and `doctor` prints "API key or custom endpoint configured" — and then
 * exits 0 while writing `HTTP 400 ... Incorrect API key provided` to stdout. A
 * preflight built on those two probes passed a Reviewer that could not
 * authenticate, so Relay spent a metered Prompt Architect call and an entire
 * Coding Agent run before finding out. That contradicted the guarantee this
 * preflight exists to make.
 *
 * Relay never holds this credential — it lives in the operator's own Hermes
 * configuration — so there is no authenticated zero-inference endpoint Relay
 * could ask instead. One tiny generation is the cheapest honest question
 * available.
 *
 * THIS PARAGRAPH USED TO SAY THE PROBE "spends no MONEY (subscription-billed)".
 * That was true of a local Hermes under the operator's own login and false of
 * the Reviewer Relay actually dispatches, which runs against an xAI API key;
 * the same stale sentence justified a hard-coded `subscription` in the
 * attestation, the review card and the founder's billing row. The probe is one
 * request and a few seconds, and on an api-billed Reviewer it costs what one
 * tiny request costs. That is still the deliberate trade — a reviewer that
 * cannot answer must fail HERE, not after the mission has already paid for
 * everything upstream of it — but it is a trade with a price, not a free one.
 */
export interface HermesProbeResult {
  ok: boolean;
  /** stdout+stderr combined — auth state is not always on stdout. */
  text: string;
}

/** The liveness probe's prompt and its own timeout, kept small on purpose. */
const LIVENESS_PROMPT = 'Reply with the single word: OK';
const LIVENESS_TIMEOUT_MS = 60_000;

/**
 * An upstream provider failure, recognised from output Hermes prints on a
 * SUCCESSFUL exit.
 *
 * Hermes exits 0 when its provider rejects the request, so exit status carries
 * no signal here and the text is the only evidence. The upstream body is
 * classified and discarded rather than surfaced: it can quote the request, and
 * callers get a category instead of a vendor's prose.
 */
export function classifyHermesUpstreamFailure(
  text: string,
): { kind: 'authentication' | 'upstream'; status: number | null } | null {
  const http = text.match(/(^|\n)\s*HTTP\s+(\d{3})\s*:/);
  if (!http) return null;
  const status = Number(http[2]);
  const credentialRejected = /\b(api[- ]?key|unauthorized|authentication|invalid[- ]token)\b/i.test(text);
  if (status === 401 || status === 403 || credentialRejected) {
    return { kind: 'authentication', status: Number.isFinite(status) ? status : null };
  }
  return { kind: 'upstream', status: Number.isFinite(status) ? status : null };
}

export interface HermesPreflightResult {
  ready: boolean;
  missing: string[];
  reason?: string;
  executable: string;
  oneShotSupported: boolean;
  readOnlySupported: boolean;
  /** Resolved from the real Hermes execution configuration. */
  model: string | null;
  provider: string | null;
  /**
   * Services `hermes status` lists as logged in. INFORMATIONAL ONLY — it is
   * not evidence about the configured inference provider. A Hermes
   * authenticated by API key has no "logged in" line at all, and a logged-in
   * unrelated service (a tool gateway, a portal) says nothing about whether
   * the model provider will answer. `livenessVerified` is the authority.
   */
  authenticatedProviders: string[];
  /** The configured provider answered a minimal request. */
  livenessVerified: boolean;
  /**
   * WHAT THE PROBE CAN ACTUALLY TELL. Hermes authenticated by API key prints
   * no "logged in" line at all, so this file cannot distinguish a subscription
   * from a key — which is why it must not answer as though it could. It said
   * `'subscription'`, as a type with one inhabitant.
   *
   * The decision belongs to the operator's declaration or the registered
   * occupant, both of which the mission reads directly; `unknown` is what an
   * honest probe reports.
   */
  billingPath: 'subscription' | 'unknown';
}

const defaultProbe = (
  executable: string,
  args: string[],
  timeoutMs = 20_000,
): HermesProbeResult => {
  try {
    const r = spawnSync(executable, args, {
      encoding: 'utf8',
      timeout: timeoutMs,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    });
    if (r.error) return { ok: false, text: '' };
    return { ok: r.status === 0, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
  } catch {
    return { ok: false, text: '' };
  }
};

/** Parse `hermes status` for the configured provider/model + logged-in auth. */
export function parseHermesStatus(text: string): {
  model: string | null;
  provider: string | null;
  authenticatedProviders: string[];
} {
  const model = text.match(/^\s*Model:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const provider = text.match(/^\s*Provider:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const authenticatedProviders: string[] = [];
  for (const line of text.split('\n')) {
    // "  Nous Portal   ✓ logged in" / "  OpenAI Codex  ✗ not logged in"
    const m = line.match(/^\s{2}(\S[^✓✗]*?)\s*✓\s*(logged in|active|managed tools available)/i);
    if (m) authenticatedProviders.push(safeText(m[1].trim()));
  }
  return {
    model: model ? safeText(model) : null,
    provider: provider ? safeText(provider) : null,
    authenticatedProviders,
  };
}

export function hermesPreflight(
  cfg: HermesConfig,
  deps: {
    probe?: (executable: string, args: string[], timeoutMs?: number) => HermesProbeResult;
  } = {},
): HermesPreflightResult {
  const probe = deps.probe ?? defaultProbe;
  const missing: string[] = [];

  const help = probe(cfg.executable, ['--help']);
  const oneShotSupported = /(^|\s)-z(\s|,)/.test(help.text) || help.text.includes('-z PROMPT');
  const readOnlySupported = help.text.includes('--safe-mode');
  if (!help.ok && !help.text.trim()) missing.push('hermes executable (not runnable on PATH)');
  else {
    if (!oneShotSupported) missing.push('hermes one-shot mode (-z)');
    if (!readOnlySupported) missing.push('hermes read-only mode (--safe-mode)');
    /**
     * THE FLAG THE PROBE AND THE MISSION BOTH PASS, checked beside the other
     * two rather than discovered by a probe that produces no output.
     *
     * Without this, a hermes build lacking `--usage-file` fails the liveness
     * probe as "hermes reviewer response (the one-shot probe produced no
     * output)" — a message that sends an operator to look at the model, the
     * credential and the prompt, none of which is the problem. Naming the
     * missing flag is the difference between a two-minute fix and an afternoon.
     */
    if (!help.text.includes('--usage-file')) {
      missing.push('hermes usage reporting (--usage-file), which the reviewer needs to attest its served model');
    }
  }

  const status = probe(cfg.executable, ['status']);
  const parsed = parseHermesStatus(status.text);
  const model = cfg.model ?? parsed.model;
  const provider = cfg.provider ?? parsed.provider;
  if (!model) missing.push('hermes model (RELAY_HERMES_MODEL or a configured default)');
  if (!provider) missing.push('hermes provider (RELAY_HERMES_PROVIDER or a configured default)');
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs <= 0) missing.push('RELAY_HERMES_TIMEOUT_MS');
  if (!Number.isFinite(cfg.maxOutputBytes) || cfg.maxOutputBytes <= 0) missing.push('RELAY_HERMES_MAX_OUTPUT');

  /**
   * THE LIVENESS PROBE, and only once everything structural already holds.
   *
   * Asking a reviewer to answer when the executable is missing or the model is
   * unresolved wastes a spawn and a timeout to learn what is already known.
   * The arguments mirror `runHermesReview` exactly, so this proves the path the
   * mission will actually take rather than a neighbouring one — which is why
   * `--usage-file` is here too. When the mission leg gained that flag this
   * probe did not, and the comment above became a claim the code no longer
   * supported: a flag the real call passes and the probe does not is exactly
   * what this mirroring exists to prevent. The path is a throwaway; the probe
   * does not read the file, it proves the binary accepts the argument.
   */
  let livenessVerified = false;
  if (missing.length === 0) {
    const probeUsagePath = join(mkdtempSync(join(tmpdir(), 'relay-hermes-probe-')), 'usage.json');
    const args = ['-z', LIVENESS_PROMPT, '--safe-mode', '--usage-file', probeUsagePath];
    /**
     * `try/finally`, not a call after the branch.
     *
     * `defaultProbe` catches everything and cannot throw, so production leaked
     * nothing — but `deps.probe` is injectable, and cleanup that depends on the
     * injected function not throwing is cleanup that works by luck. The
     * directory goes with the probe on every path, including a throw.
     */
    try {
      if (cfg.model) args.push('-m', cfg.model);
      if (cfg.provider) args.push('--provider', cfg.provider);
      const live = probe(cfg.executable, args, Math.min(cfg.timeoutMs, LIVENESS_TIMEOUT_MS));
      const failure = classifyHermesUpstreamFailure(live.text);
      if (failure !== null) {
        missing.push(
          failure.kind === 'authentication'
            ? 'hermes provider authentication (the configured provider rejected the reviewer credential)'
            : `hermes provider availability (the configured provider returned HTTP ${String(failure.status ?? 0)})`,
        );
      } else if (!live.text.trim()) {
        missing.push('hermes reviewer response (the one-shot probe produced no output)');
      } else {
        livenessVerified = true;
      }
    } finally {
      try { rmSync(dirname(probeUsagePath), { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  return {
    ready: missing.length === 0,
    missing,
    reason: missing.length ? `The Hermes reviewer is not available. Missing: ${missing.join(', ')}.` : undefined,
    executable: cfg.executable,
    oneShotSupported,
    readOnlySupported,
    model,
    provider,
    authenticatedProviders: parsed.authenticatedProviders,
    livenessVerified,
    // Not knowable from a Hermes probe. See the field's own note.
    billingPath: 'unknown',
  };
}

export interface ReviewPacket {
  missionId: string;
  missionRevision?: string;
  originalRequest: string;
  /** The exact validated Prompt Architect handoff (serialized). */
  handoffJson: string;
  acceptanceCriteria?: string[];
  allowedFiles?: string[];
  prohibitedFiles?: string[];
  baseRevision: string;
  artifactDigest: string;
  changedFiles: string[];
  unifiedDiff: string;
  changedFileContents: string;
  testCommand: string;
  testOutput: string;
  relayEvidence: string[];
}

export function buildReviewPrompt(p: ReviewPacket): string {
  return [
    'You are an INDEPENDENT code reviewer. Review the change below strictly',
    'against the stated requirements and the supplied evidence. Do NOT assume the',
    "implementing agent's conclusion is correct — judge the artifact yourself.",
    'You have no write access and must not attempt to modify anything.',
    '',
    'Respond with ONE JSON object and nothing else:',
    '{"verdict":"approved"|"changes_required"|"unable_to_review","summary":string,',
    '"findings":[{"findingId":string,"severity":"blocking"|"major"|"minor"|"informational",',
    '"requirement":string,"file":string,"line":number,"explanation":string,"evidence":string,',
    '"recommendedAction":string}],',
    '"requirementsChecked":[{"requirement":string,"status":"passed"|"failed"|"uncertain","evidence":string}]}',
    '',
    `MISSION: ${p.missionId}`,
    `MISSION REVISION: ${p.missionRevision ?? '(unversioned)'}`,
    `BASE REVISION: ${p.baseRevision}`,
    `ARTIFACT DIGEST: ${p.artifactDigest}`,
    '',
    "FOUNDER'S ORIGINAL REQUEST:",
    p.originalRequest,
    '',
    'IMPLEMENTATION HANDOFF (requirements):',
    p.handoffJson,
    '',
    `ACCEPTANCE CRITERIA:\n${(p.acceptanceCriteria ?? []).map((c) => `- ${c}`).join('\n') || '- (none stated)'}`,
    `ALLOWED FILES (the only files the agent could edit): ${p.allowedFiles?.join(', ') || '(none stated)'}`,
    `PROHIBITED FILES (must be unchanged): ${p.prohibitedFiles?.join(', ') || '(none stated)'}`,
    '',
    `CHANGED FILES: ${p.changedFiles.join(', ') || '(none)'}`,
    '',
    'UNIFIED DIFF:',
    p.unifiedDiff || '(empty)',
    '',
    'RESULTING FILE CONTENT:',
    p.changedFileContents || '(empty)',
    '',
    `DETERMINISTIC TEST COMMAND: ${p.testCommand}`,
    'TEST OUTPUT:',
    p.testOutput || '(none)',
    '',
    `RELAY VERIFICATION EVIDENCE:\n${p.relayEvidence.map((e) => `- ${e}`).join('\n')}`,
    '',
    'RUBRIC: (1) Does the implementation satisfy every acceptance criterion?',
    '(2) Did it stay inside the allowed file scope? (3) Is the behaviour correct for',
    'edge cases implied by the requirements? (4) Is the evidence sufficient?',
    'Emit the JSON now.',
  ].join('\n');
}

const SEVERITIES = new Set(['blocking', 'major', 'minor', 'informational']);

/** The escapes JSON actually defines. Everything else is a syntax error. */
const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

/**
 * THE ONE REPAIR RELAY WILL ATTEMPT ON REVIEWER OUTPUT, and the reasoning that
 * bounds it.
 *
 * A reviewer of CODE quotes code, and quoted code contains backslashes. The
 * real reviewer failed on `.replace(/[\s_]+/g, '-')` pasted into an evidence
 * string: `\s` is not a JSON escape, so `JSON.parse` rejected an otherwise
 * complete and correct review. That is not an exotic edge — it is the single
 * most likely thing a code reviewer writes, so the Reviewer role failed on
 * output that was substantively fine.
 *
 * This escapes ONLY a backslash that begins no valid escape sequence, which is
 * a faithful recovery rather than a guess: the model meant a literal
 * backslash, and a literal backslash is spelled `\\`. Already-valid escapes are
 * matched as a pair and pass through untouched, so `\\s` is never re-processed.
 *
 * WHAT IT DELIBERATELY CANNOT DO: balance braces, close quotes, invent fields,
 * or recover a truncated response. Those still fail. And the repaired text is
 * handed to exactly the same strict field validation below, so a repair can
 * never manufacture a verdict — an approval still has to be spelled out by the
 * reviewer itself.
 */
export function escapeInvalidJsonEscapes(text: string): string {
  return text.replace(/\\(.)/gs, (whole, ch: string) =>
    (VALID_JSON_ESCAPES.has(ch) ? whole : `\\\\${ch}`));
}

/** Strict validation — malformed output NEVER approves. */
/**
 * THE ONE JSON OBJECT THE REVIEWER MEANT, found deterministically.
 *
 * The old extraction took the first `{` and the last `}` in the text. That is
 * correct for a model that answers with nothing else, and wrong the moment it
 * does not: a sentence containing a brace before the JSON, a trailing note
 * after it, or a fenced diff snippet quoted above the verdict all produce a
 * slice that spans two things and parses as neither. The reviewer is then told
 * its JSON was unparseable when the JSON was fine.
 *
 * So candidates are scanned in order — each fenced block first, then the bare
 * text — and within each, every balanced `{…}` region is offered to the parser
 * until one is a JSON OBJECT. String literals are tracked so a brace inside a
 * quoted diff cannot end the region.
 *
 * THIS IS NOT PERMISSIVENESS. It changes only WHICH substring is parsed, never
 * what an accepted review must contain: the verdict vocabulary, the required
 * summary and every other rule are applied afterwards, unchanged. A text with
 * no parseable object still yields null.
 */
export function extractReviewJson(text: string): string | null {
  const candidates: string[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    if (match[1] !== undefined) candidates.push(match[1]);
  }
  candidates.push(text);

  for (const candidate of candidates) {
    for (let i = 0; i < candidate.length; i += 1) {
      if (candidate[i] !== '{') continue;
      const region = balancedObject(candidate, i);
      if (region === null) continue;
      // The REGION is returned, never the repaired form: the caller performs
      // the repair itself and records that it had to, and handing back
      // already-repaired text would silently clear `parseRepaired` — evidence
      // that the reviewer's output was malformed.
      for (const attempt of [region, escapeInvalidJsonEscapes(region)]) {
        try {
          const parsed: unknown = JSON.parse(attempt);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return region;
        } catch { /* try the repaired form, then the next region */ }
      }
    }
  }
  return null;
}

/** The `{…}` starting at `from`, or null when it never closes. */
function balancedObject(text: string, from: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

export function validateHermesReview(text: string): HermesReviewResult | null {
  // ONE EXTRACTOR FOR EVERY READER, so the validator, the shape classifier and
  // the human-readable description can never disagree about which object the
  // reviewer meant, or about whether there was one at all.
  const slice = extractReviewJson(text);
  if (slice === null) return null;
  let raw: unknown;
  let parseRepaired = false;
  try {
    raw = JSON.parse(slice);
  } catch {
    try {
      raw = JSON.parse(escapeInvalidJsonEscapes(slice));
      parseRepaired = true;
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const verdict = o.verdict;
  if (verdict !== 'approved' && verdict !== 'changes_required' && verdict !== 'unable_to_review') return null;
  if (typeof o.summary !== 'string' || !o.summary.trim()) return null;

  const findings: HermesFinding[] = Array.isArray(o.findings)
    ? o.findings.flatMap((f, i) => {
        if (!f || typeof f !== 'object') return [];
        const g = f as Record<string, unknown>;
        const sev = typeof g.severity === 'string' && SEVERITIES.has(g.severity) ? (g.severity as HermesFinding['severity']) : 'informational';
        return [{
          findingId: typeof g.findingId === 'string' && g.findingId.trim() ? safeText(g.findingId) : `F-${i + 1}`,
          severity: sev,
          requirement: safeText(g.requirement ?? ''),
          file: typeof g.file === 'string' ? safeText(g.file) : undefined,
          line: typeof g.line === 'number' ? g.line : undefined,
          explanation: safeText(g.explanation ?? ''),
          evidence: safeText(g.evidence ?? ''),
          recommendedAction: typeof g.recommendedAction === 'string' ? safeText(g.recommendedAction) : undefined,
        }];
      })
    : [];

  const requirementsChecked = Array.isArray(o.requirementsChecked)
    ? o.requirementsChecked.flatMap((r) => {
        if (!r || typeof r !== 'object') return [];
        const g = r as Record<string, unknown>;
        const st: 'passed' | 'failed' | 'uncertain' =
          g.status === 'passed' ? 'passed' : g.status === 'failed' ? 'failed' : 'uncertain';
        return [{ requirement: safeText(g.requirement ?? ''), status: st, evidence: safeText(g.evidence ?? '') }];
      })
    : [];

  return { verdict, summary: safeText(o.summary), findings, requirementsChecked, parseRepaired };
}

export function hasBlockingFinding(r: HermesReviewResult): boolean {
  return r.verdict === 'changes_required' || r.findings.some((f) => f.severity === 'blocking');
}

/** Runs the reviewer exactly once. Read-only: empty temp cwd + --safe-mode. */
export async function runHermesReview(input: {
  packet: ReviewPacket;
  config: HermesConfig;
  now?: () => string;
  spawnImpl?: typeof spawn;
}): Promise<HermesOutcome> {
  const now = input.now ?? (() => new Date().toISOString());
  const cfg = input.config;
  const doSpawn = input.spawnImpl ?? spawn;
  const prompt = buildReviewPrompt(input.packet);

  // Empty scratch cwd — the reviewer has no path into the controlled project.
  const cwd = mkdtempSync(join(tmpdir(), 'relay-hermes-review-'));
  /**
   * Hermes writes what actually ran — including the SERVED model — to its
   * usage file. The harness runner has always asked for this file; this
   * direct path did not, so the local reviewer's model was reported from
   * configuration.
   */
  const usageFilePath = join(cwd, 'relay-hermes-usage.json');

  /**
   * AND THE SCRATCH DIRECTORY IS ACTUALLY REMOVED.
   *
   * It never was. That was invisible while the directory stayed empty — an
   * empty tmpdir entry per review is untidy and nothing more — but this
   * function now writes a file into it, so every review would leave a usage
   * report on the host indefinitely. The first version of this comment said
   * the file "vanishes with the scratch cwd", which was a claim about code
   * that did not exist; a test that asserted it is what found that out.
   *
   * Removal is best-effort by construction: failing to clean up a temporary
   * directory must never turn a completed review into a failed one.
   */
  const discardScratch = () => {
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  const args = ['-z', prompt, '--safe-mode', '--usage-file', usageFilePath];
  if (cfg.model) args.push('-m', cfg.model);
  if (cfg.provider) args.push('--provider', cfg.provider);

  const startedAt = now();

  return await new Promise<HermesOutcome>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = doSpawn(cfg.executable, args, {
        cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
      });
    } catch {
      // Nothing ran, so there is nothing to read out of the scratch directory.
      discardScratch();
      resolve({ kind: 'launch_failed', safeMessage: 'The Hermes reviewer could not be started.' });
      return;
    }

    let out = '';
    let bytes = 0;
    let truncated = false;
    let settled = false;
    const finish = (o: HermesOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      /**
       * The funnel every outcome EXCEPT the spawn throw passes through, which
       * is why cleanup lives here rather than in each of the four `finish` call
       * sites. The spawn-throw path resolves directly, a few lines above, and
       * calls `discardScratch()` itself — the reason that duplicate exists.
       *
       * The first version of this comment said "every outcome" and "six call
       * sites"; both were false, and the next reader who trusts "every outcome"
       * while adding a fifth exit leaks the scratch directory again, which is
       * the defect this hunk fixes.
       *
       * The usage file is read while building the argument to this call, so it
       * is still on disk at that point and gone immediately after.
       */
      discardScratch();
      resolve(o);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      finish({ kind: 'review_incomplete', safeMessage: 'The Hermes reviewer timed out.', shape: 'review_timeout', startedAt, completedAt: now() });
    }, cfg.timeoutMs);

    child.stdout?.on('data', (c: Buffer) => {
      bytes += c.length;
      // PAST THE CEILING THE TEXT IS NO LONGER THE REVIEW. Dropping the
      // overflowing chunk and parsing what arrived would report a truncated
      // review as unparseable JSON — a shape complaint about the model when the
      // cause is our own ceiling. The overflow is remembered instead.
      if (bytes <= cfg.maxOutputBytes) out += c.toString('utf8'); else truncated = true;
    });
    child.stderr?.on('data', () => { /* never surfaced verbatim */ });
    child.on('error', () => finish({ kind: 'launch_failed', safeMessage: 'The Hermes reviewer could not be started.' }));
    child.on('close', (code) => {
      const completedAt = now();
      const parsed = validateHermesReview(out);
      if (!parsed) {
        /**
         * NAME THE ACTUAL FAILURE. Hermes exits 0 when its provider rejects
         * the request, so "no valid structured review" was reported for a dead
         * credential — which sends an operator to read the reviewer's prompt
         * and rubric when the fix is an expired key.
         */
        const upstream = classifyHermesUpstreamFailure(out);
        /**
         * THE SHAPE IS THE PART THAT SURVIVES. The message below is composed
         * and then dropped — the coordinator persists the code, the retryable
         * flag and the failure CLASS, not the text — which is why paid attempt
         * #2 recorded `reviewer_review_incomplete` twice and could not say
         * whether the credential was dead or the model had written prose.
         *
         * The order is the order of causes: an answer that never came, then
         * one the provider refused, then a process that died, then our own
         * ceiling, and only then the shape of what the model actually wrote.
         */
        const shape: HermesReviewShape =
          upstream?.kind === 'authentication' ? 'review_authentication_failed'
            : upstream !== null ? 'review_provider_http_error'
              : code !== 0 ? 'review_process_exit'
                : truncated ? 'review_output_too_large'
                  : classifyUnreadableReview(out);
        finish({
          kind: 'review_incomplete',
          shape,
          safeMessage:
            upstream?.kind === 'authentication'
              ? 'The Hermes reviewer could not authenticate with its configured provider.'
              : upstream !== null
                ? `The Hermes reviewer's provider returned HTTP ${String(upstream.status ?? 0)}.`
                : code !== 0
                  ? `The Hermes reviewer exited without a valid review (code ${code ?? 'unknown'}).`
                  : truncated
                    ? `The Hermes reviewer produced more than the ${String(cfg.maxOutputBytes)}-byte ceiling allows.`
                    // SHAPE, NOT TEXT. `describeUnreadableReview` reports whether
                    // a fence was present, whether JSON parsed, and which
                    // required field was wrong — never the review itself, which
                    // quotes the diff.
                    : `The Hermes reviewer returned no valid structured review. ${describeUnreadableReview(out)}`,
          startedAt,
          completedAt,
        });
        return;
      }
      finish({
        kind: 'reviewed',
        result: parsed,
        startedAt,
        completedAt,
        requestedModel: cfg.model ?? null,
        // What Hermes itself reported answered. Absent or malformed usage
        // stays null — the configured model never stands in for it.
        servedModel: parseUsageFile(usageFilePath).model,
        provider: cfg.provider ?? null,
      });
    });
  });
}

/**
 * WHY A REVIEW COULD NOT BE READ, in facts that cannot leak.
 *
 * `validateHermesReview` returns `null` for six different reasons and the
 * mission reported one sentence for all of them: "The Reviewer service
 * returned a review Relay could not read." A real Hermes/xAI/Grok review ran
 * for 45 seconds against a real diff and produced something Relay rejected,
 * and nothing said whether the model wrote prose instead of JSON, used a
 * verdict word outside the vocabulary, or omitted the summary.
 *
 * Only SHAPE is surfaced — whether a fenced block was present, whether braces
 * were found, whether JSON parsed, and whether the two required fields were
 * present and of the right kind. The verdict VALUE is echoed only when it is a
 * short bare word, because that is the single most likely cause (a model
 * answering "approve" or "PASS") and a word of that shape cannot carry a
 * sentence. Review TEXT is never included: it quotes the diff.
 */
/**
 * THE SAME INSPECTION `describeUnreadableReview` MAKES, AS ONE TOKEN.
 *
 * The prose description is for a human reading a log; this is for the durable
 * record, which is the copy that survives. Both walk the text in the same order
 * — fenced block, braces, parse, verdict, summary — so a shape and its
 * description can never disagree about what was wrong.
 *
 * `unable_to_review` is deliberately NOT invalid here: it is a verdict the
 * reviewer is allowed to return and the adapter refuses separately, with its
 * own class. Only a word outside the whole vocabulary is `verdict_invalid`.
 */
export function classifyUnreadableReview(text: string): HermesReviewShape {
  const slice = extractReviewJson(text);
  if (slice === null) {
    // No balanced object parsed anywhere. Whether the model wrote prose or
    // stopped mid-object is the difference between "absent" and "unparseable",
    // and a brace with no partner is the signature of the second.
    return /\{/.test(text) ? 'review_json_unparseable' : 'review_json_absent';
  }
  let raw: unknown;
  try {
    raw = JSON.parse(slice);
  } catch {
    try { raw = JSON.parse(escapeInvalidJsonEscapes(slice)); } catch { return 'review_json_unparseable'; }
  }
  if (raw === null || typeof raw !== 'object') return 'review_json_unparseable';

  const o = raw as Record<string, unknown>;
  if (o.verdict === undefined) return 'review_verdict_missing';
  if (o.verdict !== 'approved' && o.verdict !== 'changes_required' && o.verdict !== 'unable_to_review') {
    return 'review_verdict_invalid';
  }
  if (o.summary === undefined) return 'review_summary_missing';
  if (typeof o.summary !== 'string' || !o.summary.trim()) return 'review_summary_invalid';
  // Every field the validator requires is present and well formed, so the
  // rejection came from somewhere this function cannot see.
  return 'review_unreadable';
}

export function describeUnreadableReview(text: string): string {
  const parts: string[] = [];
  parts.push(`chars=${String(text.length)}`);
  parts.push(`fenced=${String(/```/.test(text))}`);

  // THE SAME EXTRACTOR THE VALIDATOR USES. Reading the text a second way let
  // this description and the durable shape disagree: a review whose fenced
  // block held a quoted diff and whose JSON followed it was reported here as
  // "json=absent" while the classifier had already parsed the object and found
  // the verdict word wrong.
  const slice = extractReviewJson(text);
  if (slice === null) {
    parts.push(/\{/.test(text) ? 'json=unparseable' : 'json=absent');
    return `Review shape: ${parts.join(' ')}.`;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(slice);
  } catch {
    try { raw = JSON.parse(escapeInvalidJsonEscapes(slice)); } catch {
      parts.push('json=unparseable');
      return `Review shape: ${parts.join(' ')}.`;
    }
  }
  if (raw === null || typeof raw !== 'object') {
    parts.push('json=notAnObject');
    return `Review shape: ${parts.join(' ')}.`;
  }
  parts.push('json=parsed');

  const o = raw as Record<string, unknown>;
  const verdict = o.verdict;
  if (typeof verdict !== 'string') {
    parts.push(`verdict=${verdict === undefined ? 'absent' : 'notAString'}`);
  } else if (/^[A-Za-z_]{1,24}$/.test(verdict)) {
    // A bare word is safe to echo and is almost always the answer.
    parts.push(`verdict="${verdict}"`);
  } else {
    parts.push('verdict=unrecognisedShape');
  }

  const summary = o.summary;
  parts.push(`summary=${
    typeof summary !== 'string' ? (summary === undefined ? 'absent' : 'notAString')
      : summary.trim() === '' ? 'empty' : 'present'
  }`);
  parts.push(`findings=${Array.isArray(o.findings) ? String(o.findings.length) : 'absent'}`);
  return `Review shape: ${parts.join(' ')}.`;
}
