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
import type { JuliusReviewCharge, JuliusReviewStage } from '../src/relay/mission/julius/julius-review-stage';
import type { JuliusContractReviewCharge } from '../src/relay/mission/julius/julius-task-contract';
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
  | { kind: 'review_incomplete'; safeMessage: string; shape: HermesReviewShape; diagnostics: HermesReviewDiagnostics; startedAt: string; completedAt: string };

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
  /**
   * THE REVIEW SERVICE ANSWERED AND HAD NO CAPACITY FOR THE REVIEW.
   *
   * `capacity_exhausted` and `shutting_down` are states the hosted harness
   * reports about ITSELF: it was reached, it authenticated, it understood the
   * request, and it is full or draining. Recording those as
   * `review_provider_http_error` sent an operator to the model provider — which
   * had not been asked anything yet — when what clears it is a run finishing or
   * a deploy landing. REMOTE PATH ONLY: a local reviewer has no admission step.
   */
  | 'review_service_unavailable'
  /**
   * THE REVIEW SERVICE UNDERSTOOD THE REQUEST AND DECLINED IT.
   *
   * A 422 whose limits it cannot read, or a `review_refused`. No provider call
   * necessarily happened, so naming it a provider error is a claim about
   * somebody else's system; it is the request that has to change. REMOTE PATH
   * ONLY, for the same reason.
   */
  | 'review_request_rejected'
  | 'review_process_exit'
  | 'review_output_too_large'
  | 'review_json_absent'
  | 'review_json_unparseable'
  | 'review_verdict_missing'
  | 'review_verdict_invalid'
  | 'review_summary_missing'
  | 'review_summary_invalid'
  | 'review_json_ambiguous'
  /**
   * UNREACHABLE UNLESS THE TWO READERS DRIFT APART. The classifier applies the
   * validator's own rules to the validator's own slice, so a review it calls
   * readable is one the validator accepted — and the classifier only runs after
   * the validator refused. It is kept as the canary for that invariant
   * breaking, and named for what it would mean.
   */
  | 'review_classifier_disagreement';

/**
 * THE SAFE CORROBORATING FACTS BESIDE THE SHAPE.
 *
 * The shape says WHICH boundary failed. It cannot say the exit code Hermes
 * returned, how many bytes arrived against the ceiling, or how many
 * verdict-bearing objects made a text ambiguous — and those are the facts an
 * operator needs to debug the class without buying a second paid run.
 *
 * EVERY FIELD IS STRUCTURAL. Numbers, booleans, and tokens this runtime chose
 * itself. No reviewer text, no summary, no diff, no prompt, no provider body,
 * no header. `null` is a real answer everywhere it appears and always means
 * "not known here", never zero — a reviewer that never started has no exit
 * code, and reporting `0` would say it exited cleanly.
 *
 * The domain narrows this again on the way to the durable record
 * (`safeReviewDiagnostics`), because redaction that depends on the caller
 * remembering to redact is not redaction.
 */
export interface HermesReviewDiagnostics {
  /** Which review this was. `null` when the caller did not say. */
  readonly stage: 'plan' | 'build' | null;
  readonly transport: 'local' | 'remote' | 'openai';
  /** Configuration, known before the call — never parsed out of an error. */
  readonly provider: string | null;
  /**
   * Evidence, never configuration. On a failed review this is almost always
   * `null`: the served model is read from the engine's usage report, which
   * only exists once a review actually finished.
   */
  readonly servedModel: string | null;
  /** `null` when no process ran, or when the transport has no process. */
  readonly processExitCode: number | null;
  readonly timedOut: boolean;
  /**
   * TOTAL BYTES SEEN, not bytes retained. The local runner counts every chunk
   * including the ones past the ceiling it refuses to keep, so this stays
   * exact through truncation rather than reporting the ceiling as the size.
   */
  readonly outputBytesObserved: number | null;
  readonly outputByteLimit: number | null;
  readonly outputTruncated: boolean;
  readonly jsonDetected: boolean;
  readonly jsonParseable: boolean;
  /** Verdict-bearing candidates. 1 for a normal review, 2+ is the ambiguity. */
  readonly reviewObjectCount: number | null;
  readonly verdictPresent: boolean;
  readonly verdictValid: boolean;
  readonly summaryPresent: boolean;
  readonly failureShape: HermesReviewShape | null;
  /**
   * THE STATUS THE PROVIDER ACTUALLY RETURNED, when one was read.
   *
   * Paid attempt #4 recorded `review_authentication_failed` and stopped there.
   * That one shape covers three different repairs — a 401 is a dead key, a 403
   * is a key without access to the model, and a 400 whose body merely mentions
   * `api-key` is a malformed request — and an operator cannot tell which
   * without asking the provider again. The classifier already knew the number
   * and dropped it.
   *
   * Read from an HTTP response or from a status line the engine printed; never
   * inferred from prose, and `null` when none was read. The body it came with
   * is not kept.
   */
  readonly providerHttpStatus: number | null;
  /**
   * THE REVIEW SERVICE'S OWN STATUS, which is not the provider's.
   *
   * A remote admission refusal is the hosted harness answering about ITSELF —
   * 422 for a request it would not read, 503 for capacity — before Hermes or
   * any provider has run. Recording that as `providerHttpStatus` would send an
   * operator to a model vendor that was never called, which is the same
   * misattribution `review_service_unavailable` and `review_request_rejected`
   * exist to prevent. The shape says which KIND; this says which number.
   *
   * REMOTE PATH ONLY. Null everywhere else, including the local path, where the
   * status Hermes prints IS the provider's.
   */
  readonly serviceHttpStatus: number | null;
}

/** What the reviewer's text structurally was — no part of it is retained. */
export function reviewStructureFacts(text: string | null): Pick<
  HermesReviewDiagnostics,
  'jsonDetected' | 'jsonParseable' | 'reviewObjectCount' | 'verdictPresent' | 'verdictValid' | 'summaryPresent'
> {
  if (text === null) {
    return {
      jsonDetected: false, jsonParseable: false, reviewObjectCount: null,
      verdictPresent: false, verdictValid: false, summaryPresent: false,
    };
  }
  const scan = scanReviewJson(text);
  // A candidate is a verdict-bearing object; the ambiguity IS this count > 1.
  const reviewObjectCount = scan.withVerdict.length + scan.verdictsInArrays;
  const jsonDetected = scan.objects.length > 0 || reviewObjectCount > 0 || scan.malformed || scan.unclosed;
  const slice = extractReviewJson(text);
  if (slice === null) {
    return {
      jsonDetected, jsonParseable: scan.objects.length > 0,
      reviewObjectCount, verdictPresent: false, verdictValid: false, summaryPresent: false,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(slice);
  } catch {
    try { raw = JSON.parse(escapeInvalidJsonEscapes(slice)); } catch {
      return { jsonDetected, jsonParseable: false, reviewObjectCount, verdictPresent: false, verdictValid: false, summaryPresent: false };
    }
  }
  if (raw === null || typeof raw !== 'object') {
    return { jsonDetected, jsonParseable: false, reviewObjectCount, verdictPresent: false, verdictValid: false, summaryPresent: false };
  }
  const o = raw as Record<string, unknown>;
  const summary = o.summary;
  return {
    jsonDetected: true,
    jsonParseable: true,
    reviewObjectCount,
    verdictPresent: o.verdict !== undefined,
    verdictValid: o.verdict === 'approved' || o.verdict === 'changes_required' || o.verdict === 'unable_to_review',
    summaryPresent: typeof summary === 'string' && summary.trim() !== '',
  };
}

/**
 * ONE BUILDER FOR EVERY TRANSPORT, so three reviewers cannot describe the same
 * failure with three different field sets. Everything not supplied is `null`
 * or `false` — the honest default for "this transport cannot know that", never
 * a zero that would read as a measurement.
 */
export function reviewDiagnostics(input: {
  readonly transport: HermesReviewDiagnostics['transport'];
  readonly shape: HermesReviewShape | null;
  readonly stage?: 'plan' | 'build' | null;
  readonly provider?: string | null;
  readonly servedModel?: string | null;
  readonly processExitCode?: number | null;
  readonly timedOut?: boolean;
  readonly outputBytesObserved?: number | null;
  readonly outputByteLimit?: number | null;
  readonly outputTruncated?: boolean;
  /** Only a status a provider really returned. Never parsed out of prose. */
  readonly providerHttpStatus?: number | null;
  /** The review service's own status. Never the provider's. */
  readonly serviceHttpStatus?: number | null;
  /** Read for its SHAPE only; no part of it is retained. */
  readonly text?: string | null;
}): HermesReviewDiagnostics {
  return {
    stage: input.stage ?? null,
    transport: input.transport,
    provider: input.provider ?? null,
    servedModel: input.servedModel ?? null,
    processExitCode: input.processExitCode ?? null,
    timedOut: input.timedOut ?? false,
    outputBytesObserved: input.outputBytesObserved ?? null,
    outputByteLimit: input.outputByteLimit ?? null,
    outputTruncated: input.outputTruncated ?? false,
    providerHttpStatus: input.providerHttpStatus ?? null,
    serviceHttpStatus: input.serviceHttpStatus ?? null,
    ...reviewStructureFacts(input.text ?? null),
    failureShape: input.shape,
  };
}

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

/** A review Julius dispatched: the stage and its charge, always together. */
export type ReviewPacket = ReviewPacketFields | (Omit<ReviewPacketFields, 'stage' | 'charge'> & {
  readonly stage: JuliusReviewStage;
  readonly charge: JuliusReviewCharge;
});

interface ReviewPacketFields {
  /**
   * WHICH STAGE THIS REVIEW IS, as Julius dispatched it, and what that stage
   * charges the reviewer with.
   *
   * THE TWO TRAVEL TOGETHER OR NOT AT ALL. This module takes the stage and the
   * charge as TYPES and never as values — the charge is Julius's statement of
   * what a stage judges, and a reviewer that could look one up would be
   * choosing its own charge. So a packet carrying a stage without its charge
   * would announce "PLAN REVIEW" over an implementation rubric: the paid run's
   * own defect, reintroduced. The union below makes that unrepresentable.
   * Neither field means an implementation review, which is the only kind the
   * older reviewer harness builds, so nothing it sends changes meaning.
   */
  stage?: undefined;
  charge?: undefined;
  /**
   * THE LOCKED TASK CONTRACT this review grades against, when Julius dispatched
   * one. Optional because two callers legitimately have none: the older reviewer
   * harness, and a plan review, whose subject is the document that will become
   * the contract's detail rather than work done under it.
   *
   * A VALUE, HANDED DOWN. This module never derives it — a reviewer that could
   * fetch its own charge would be choosing what it is graded against, which is
   * the defect the stage charge already exists to prevent, one level up.
   */
  contract?: JuliusContractReviewCharge;
  /** Prior blocking findings, for a repair review that must judge their resolution. */
  priorFindings?: string[];
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
  /**
   * WHAT THE PREVIOUS ANSWER GOT WRONG ABOUT ITS OWN SHAPE, when Julius is
   * asking a second time.
   *
   * Paid run 33802017460 bought a real plan, a real diff and passing tests, and
   * then BOTH reviews failed to parse — so Julius never received a verdict and
   * the run ended FAILED with zero decisions. A plain retry would have asked
   * the identical question and got the identical answer, which is exactly why
   * those shapes are `retryable: false`. A CORRECTION is a different act: it
   * names the shape defect and asks again.
   *
   * It is composed by the caller from a CLOSED failure shape — never from the
   * model's own output, which is the text that was malformed — and it is
   * emitted immediately before the emit instruction, where the last thing the
   * reviewer reads is what its previous answer did wrong. Absent on a first
   * ask, which is every ask that has ever been made before now.
   */
  correction?: string;
}

const LEGACY_IMPLEMENTATION_CHARGE: JuliusReviewCharge = Object.freeze({
  stage: 'build', subject: 'IMPLEMENTATION', repair: false,
  judges: Object.freeze([
    'Does the implementation satisfy every acceptance criterion?',
    'Did it stay inside the allowed file scope?',
    'Is the behaviour correct for edge cases implied by the requirements?',
    'Is the evidence sufficient?',
  ]),
  mustNotDemand: Object.freeze<string[]>([]),
  requires: Object.freeze<JuliusReviewCharge['requires'][number][]>(['plan', 'diff']),
});

export function buildReviewPrompt(p: ReviewPacket): string {
  const stage = p.stage ?? 'build';
  /**
   * THE CHARGE COMES FROM JULIUS. The Julius adapter always supplies the
   * domain's charge for the stage it dispatched. A caller that supplies none —
   * the older reviewer harness, which only ever reviews an implementation —
   * gets the implementation rubric this prompt has always carried, so nothing
   * it sends changes meaning. This module never reaches into the domain for
   * it: the reviewer consumes a contract, it does not own one.
   */
  // The charge always arrives with the stage (the packet type makes one
  // without the other unrepresentable); a packet with neither is the older
  // harness's implementation review.
  const charge: JuliusReviewCharge = p.charge ?? LEGACY_IMPLEMENTATION_CHARGE;
  const rubric = charge.judges.map((question, index) => `(${index + 1}) ${question}`).join(' ');
  const findings = p.priorFindings ?? [];
  const priorFindingsBlock = charge.repair || findings.length > 0
    ? [`PRIOR BLOCKING FINDINGS (${charge.repair ? 'this review must judge whether each is resolved' : 'for context'}):`,
      ...(findings.length > 0 ? findings.map((finding) => `- ${finding}`)
        : ['- (none recorded: this repair was admitted by failed evidence rather than by a reviewer finding, so judge the repaired work and its evidence)']), '']
    : [];
  const head = charge.subject === 'PLAN'
    ? [
      'You are an INDEPENDENT reviewer of a PLAN. Review the plan below strictly',
      'against the founder\'s request, the acceptance criteria and the mission',
      'constraints. Do NOT assume the planning agent\'s conclusion is correct —',
      'judge the plan yourself. You have no write access and must not attempt',
      'to modify anything.',
      '',
      `THIS IS A ${stage.toUpperCase()} REVIEW. No implementation exists yet, by design.`,
      `Do NOT demand, and do NOT penalise the absence of: ${charge.mustNotDemand.join(', ')}.`,
      'A finding that asks for any of those is out of scope for this stage and',
      'must not be raised. Judge whether the PLAN, if executed, would satisfy',
      'the criteria, and whether a coding agent could execute it as written.',
    ]
    : [
      'You are an INDEPENDENT code reviewer. Review the change below strictly',
      'against the stated requirements and the supplied evidence. Do NOT assume the',
      "implementing agent's conclusion is correct — judge the artifact yourself.",
      'You have no write access and must not attempt to modify anything.',
      '',
      `THIS IS A ${stage.toUpperCase()} REVIEW of an implementation.`,
    ];
  const body = charge.subject === 'PLAN'
    ? [
      'THE PLAN UNDER REVIEW (the validated Prompt Architect handoff):',
      p.handoffJson,
      '',
      `ACCEPTANCE CRITERIA:\n${(p.acceptanceCriteria ?? []).map((c) => `- ${c}`).join('\n') || '- (none stated)'}`,
      `ALLOWED FILES (the only files the plan may direct edits to): ${p.allowedFiles?.join(', ') || '(none stated)'}`,
      `PROHIBITED FILES (the plan must leave unchanged): ${p.prohibitedFiles?.join(', ') || '(none stated)'}`,
      '',
      ...priorFindingsBlock,
      `RELAY VERIFICATION EVIDENCE:\n${p.relayEvidence.map((e) => `- ${e}`).join('\n') || '- (none)'}`,
    ]
    : [
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
      ...priorFindingsBlock,
      `RELAY VERIFICATION EVIDENCE:\n${p.relayEvidence.map((e) => `- ${e}`).join('\n')}`,
    ];
  /**
   * THE LOCKED CONTRACT, QUOTED, when Julius dispatched one.
   *
   * This is what makes a finding checkable: every blocking criterion carries the
   * mission's own id, so a finding names `[criterion-x]` rather than a paraphrase
   * nobody can match back. The binding is printed too — a review and the
   * implementation it judges are the same agreement only if they name the same
   * revision and digest, and a durable record of what the reviewer was shown is
   * how that stops being a claim about code paths.
   */
  const contractBlock = p.contract === undefined ? [] : [
    'THE LOCKED TASK CONTRACT (the agreement this work was dispatched under — grade against THIS, not against your own',
    'reading of the request; every finding must name the criterion id it fails):',
    `  CONTRACT: ${p.contract.binding.contractId} revision ${p.contract.binding.contractRevision}`,
    `  BINDING DIGEST: ${p.contract.binding.bindingDigest}`,
    `  OBJECTIVE: ${p.contract.objective}`,
    `  RESPONSIBILITY BOUNDARY: ${p.contract.responsibilityBoundary}`,
    `  BLOCKING ACCEPTANCE CRITERIA:\n${p.contract.blockingCriteria.map((line) => `    - ${line}`).join('\n') || '    - (none stated)'}`,
    `  REQUIRED EVIDENCE: ${p.contract.requiredEvidence.join(', ') || '(none stated)'}`,
    `  REQUIRED CHECKS: ${p.contract.requiredChecks.join(' && ') || '(none stated)'}`,
    `  IN SCOPE: ${p.contract.inScope.join(', ') || '(none stated)'}`,
    `  OUT OF SCOPE: ${p.contract.outOfScope.join(', ') || '(none)'}`,
    `  PERMITTED PATHS: ${p.contract.permittedPaths.join(', ') || '(none stated)'}`,
    `  PROHIBITED: ${p.contract.prohibitedActions.join('; ') || '(none)'}`,
    `  CONTRACT REVIEW CRITERIA:\n${p.contract.contractReviewCriteria.map((line) => `    - ${line}`).join('\n') || '    - (none stated)'}`,
    `  FAILURE CONDITIONS: ${p.contract.failureConditions.join('; ') || '(none stated)'}`,
    `  STOPPING CONDITION: ${p.contract.stoppingCondition}`,
    '',
  ];
  return [
    ...head,
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
    ...contractBlock,
    ...body,
    '',
    `RUBRIC: ${rubric}`,
    ...(p.correction === undefined ? [] : ['', p.correction]),
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
 * WHAT THE REVIEWER'S OUTPUT ACTUALLY CONTAINS, structurally.
 *
 * The first version of this scan took the first parseable object ANYWHERE, at
 * any depth. An independent review proved that manufactures approvals: a
 * reviewer that quotes a JSON object out of the diff and then states its own
 * `changes_required` verdict below had the QUOTED object selected, and Julius
 * recorded an approval for a review that said no. Reviewer output of exactly
 * that shape is invited by this repository's own diffs, which contain review
 * fixtures as literals.
 *
 * So the scan is TOP LEVEL ONLY — an array is skipped whole rather than
 * descended into, and a region that fails to parse is skipped past rather than
 * re-entered — and the caller must find exactly one candidate for the verdict.
 * Two is not a tie to be broken; it is a text whose verdict cannot be known.
 */
interface ReviewJsonScan {
  /** Top-level objects that parsed, in the order they appear. */
  readonly objects: readonly string[];
  /** Those carrying a `verdict` key — the candidates for the review itself. */
  readonly withVerdict: readonly string[];
  /** A `{` that never closes: the signature of a truncated review. */
  readonly unclosed: boolean;
  /** A balanced region that looked like JSON — quoted keys — and failed to parse. */
  readonly malformed: boolean;
  /**
   * Verdict-bearing objects found INSIDE a top-level array — never candidates,
   * always evidence that the text states more than one verdict.
   */
  readonly verdictsInArrays: number;
}

/**
 * How far into nested top-level arrays the ambiguity count looks. Selection
 * never descends at all; this bound exists so a pathological `[[[[…` cannot
 * make the scan superlinear, and it is stated rather than left implicit.
 */
const ARRAY_AMBIGUITY_DEPTH = 4;

export function scanReviewJson(text: string): ReviewJsonScan {
  return scanReviewJsonAt(text, 0);
}

function scanReviewJsonAt(text: string, depth: number): ReviewJsonScan {
  const objects: string[] = [];
  const withVerdict: string[] = [];
  let unclosed = false;
  let malformed = false;
  let verdictsInArrays = 0;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    // An array is skipped ENTIRE. Descending into one is how an object inside a
    // findings list became the review.
    if (ch === '[') {
      const span = balancedRegion(text, i, '[', ']');
      if (span === null) { unclosed = true; break; }
      /**
       * SKIPPED FOR SELECTION, COUNTED FOR AMBIGUITY.
       *
       * Not descending is what stopped a findings entry from being read as the
       * review. But silently DISCARDING an array is its own way to manufacture
       * an approval: a reviewer that states `changes_required` in an array and
       * quotes an `approved` object beside it leaves exactly one top-level
       * verdict, and answering with it picks the one the reviewer did not
       * give. The interior never becomes a candidate; it only makes a text that
       * states two verdicts refuse, which is the rule the top level already
       * follows.
       */
      if (depth < ARRAY_AMBIGUITY_DEPTH) {
        const inner = scanReviewJsonAt(span.slice(1, -1), depth + 1);
        verdictsInArrays += inner.withVerdict.length + inner.verdictsInArrays;
      }
      i += span.length - 1;
      continue;
    }
    if (ch !== '{') continue;
    const region = balancedRegion(text, i, '{', '}');
    if (region === null) { unclosed = true; break; }
    i += region.length - 1;

    let parsed: unknown;
    try {
      parsed = JSON.parse(region);
    } catch {
      try {
        parsed = JSON.parse(escapeInvalidJsonEscapes(region));
      } catch {
        // A brace in prose is not malformed JSON — `if (a) { b(); }` has no
        // quoted key. Requiring one keeps "the model wrote prose" (absent)
        // separate from "the model wrote broken JSON" (unparseable), which the
        // operator answers with a prompt change and a schema fix respectively.
        if (/"[^"]*"\s*:/.test(region)) malformed = true;
        continue;
      }
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    objects.push(region);
    if (Object.prototype.hasOwnProperty.call(parsed, 'verdict')) withVerdict.push(region);
  }

  return { objects, withVerdict, unclosed, malformed, verdictsInArrays };
}

/**
 * THE ONE OBJECT THAT IS THE REVIEW, or null when that cannot be known.
 *
 * Exactly one verdict-bearing object is the review. None, with exactly one
 * object present, is a review whose verdict is missing — returned so the caller
 * can say which field was wrong rather than "no JSON". Anything else is refused:
 * two verdicts is ambiguity, and ambiguity on this path spends money.
 */
export function extractReviewJson(text: string): string | null {
  const scan = scanReviewJson(text);
  if (scan.withVerdict.length > 1) return null;
  // One verdict at the top level and another inside an array is still a text
  // stating two verdicts. It is refused for the same reason two at the top
  // level are: choosing between them is choosing one the reviewer may not have
  // given, on the path where being wrong ships code and spends money.
  if (scan.withVerdict.length === 1 && scan.verdictsInArrays > 0) return null;
  if (scan.withVerdict.length === 1) return scan.withVerdict[0]!;
  return scan.objects.length === 1 ? scan.objects[0]! : null;
}

/** The `open`…`close` region starting at `from`, or null when it never closes. */
function balancedRegion(text: string, from: number, open: string, close: string): string | null {
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
    if (ch === open) depth += 1;
    else if (ch === close) {
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

    /**
     * The corroborating facts this process actually observed.
     *
     * `bytes` counts EVERY chunk, including the ones past the ceiling that
     * `out` refuses to keep, so the observed size stays exact through
     * truncation instead of reporting our own limit back as the model's size.
     * The structural facts are read from the retained text, which is all this
     * process has — and none of that text travels, only what shape it was.
     */
    const localDiagnostics = (input: {
      shape: HermesReviewShape;
      exitCode: number | null;
      timedOut: boolean;
      /** Only ever `classifyHermesUpstreamFailure`'s own reading. */
      providerHttpStatus?: number | null;
    }): HermesReviewDiagnostics => ({
      stage: null,
      transport: 'local',
      provider: cfg.provider ?? null,
      // Read from the usage file only once a review really finished, so a
      // failed review attests no model rather than the configured one.
      servedModel: null,
      processExitCode: input.exitCode,
      timedOut: input.timedOut,
      outputBytesObserved: bytes,
      outputByteLimit: cfg.maxOutputBytes,
      outputTruncated: truncated,
      providerHttpStatus: input.providerHttpStatus ?? null,
      // The local path talks to a provider, never to a review service.
      serviceHttpStatus: null,
      ...reviewStructureFacts(out),
      failureShape: input.shape,
    });
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
      finish({
        kind: 'review_incomplete', safeMessage: 'The Hermes reviewer timed out.', shape: 'review_timeout',
        // The process was killed, so it has no exit code to report. `null`
        // here is the difference between "it did not exit" and "it exited 0".
        diagnostics: localDiagnostics({ shape: 'review_timeout', exitCode: null, timedOut: true }),
        startedAt, completedAt: now(),
      });
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
      /**
       * A TRUNCATED ANSWER IS NEVER A VERDICT, even when the part that arrived
       * parses.
       *
       * The retained prefix can hold a complete, valid review object followed
       * by text this process never saw — and a reviewer's later word is the one
       * that counts. `extractReviewJson` refuses a text stating two verdicts
       * precisely so a quoted approval cannot outrank a real rejection; reading
       * only a prefix hides the second verdict and defeats that guard silently,
       * which is the one failure mode where the guard's absence looks like
       * success. What was cut off is unknown, and unknown is not approval.
       */
      const parsed = truncated ? null : validateHermesReview(out);
      if (!parsed) {
        /**
         * NAME THE ACTUAL FAILURE. Hermes exits 0 when its provider rejects
         * the request, so "no valid structured review" was reported for a dead
         * credential — which sends an operator to read the reviewer's prompt
         * and rubric when the fix is an expired key.
         */
        /**
         * ONLY WHEN THE REVIEWER RETURNED NO VERDICT AT ALL.
         *
         * `classifyHermesUpstreamFailure` matches an `HTTP 401:` line anywhere
         * in the text, and a code reviewer quoting one — this repository's own
         * fixtures contain such a line — would have had its review recorded as
         * a dead credential, durably, sending an operator to rotate a working
         * key. Requiring the absence of a verdict-bearing object separates the
         * two: a provider's error dump carries a body but never a verdict, and
         * a reviewer quoting an error still states its own.
         *
         * The test is NOT "nothing parsed": xAI's rejection is itself JSON
         * (`HTTP 400: {"code":"invalid-argument",…}`), which parses and would
         * have suppressed the classification that case exists to prove.
         */
        const upstream = scanReviewJson(out).withVerdict.length === 0
          ? classifyHermesUpstreamFailure(out)
          : null;
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
          diagnostics: localDiagnostics({ shape, exitCode: code ?? null, timedOut: false, providerHttpStatus: upstream?.status ?? null }),
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
 * `validateHermesReview` returns `null` for several different reasons and the
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
  const scan = scanReviewJson(text);
  // TWO VERDICTS IS NOT A TIE TO BREAK. A reviewer that quoted one object and
  // meant another leaves a text whose verdict cannot be known, and guessing is
  // how an approval gets manufactured.
  if (scan.withVerdict.length > 1) return 'review_json_ambiguous';
  if (scan.withVerdict.length === 1 && scan.verdictsInArrays > 0) return 'review_json_ambiguous';
  const slice = extractReviewJson(text);
  if (slice === null) {
    // An object that never closed is a review cut off mid-sentence; a balanced
    // region with quoted keys that will not parse is malformed JSON; anything
    // else — prose, code with braces, an empty answer — is no JSON at all.
    if (scan.unclosed || scan.malformed) return 'review_json_unparseable';
    // Several objects and no verdict among them: the verdict is what is
    // missing, and saying "no JSON" would send the operator the wrong way.
    return scan.objects.length > 0 ? 'review_verdict_missing' : 'review_json_absent';
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
  return 'review_classifier_disagreement';
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
  const scan = scanReviewJson(text);
  if (scan.withVerdict.length > 1 || (scan.withVerdict.length === 1 && scan.verdictsInArrays > 0)) {
    parts.push(`json=ambiguous objectsWithVerdict=${String(scan.withVerdict.length)} inArrays=${String(scan.verdictsInArrays)}`);
    return `Review shape: ${parts.join(' ')}.`;
  }
  const slice = extractReviewJson(text);
  if (slice === null) {
    parts.push(scan.unclosed || scan.malformed ? 'json=unparseable'
      : scan.objects.length > 0 ? 'json=noVerdictObject' : 'json=absent');
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
