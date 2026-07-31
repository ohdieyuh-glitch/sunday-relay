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
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeText } from './redact';

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
}

export type HermesOutcome =
  | { kind: 'reviewed'; result: HermesReviewResult; startedAt: string; completedAt: string; model: string | null; provider: string | null }
  | { kind: 'launch_failed'; safeMessage: string }
  | { kind: 'review_incomplete'; safeMessage: string; startedAt: string; completedAt: string };

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
 * Reviewer availability, proven WITHOUT consuming a review.
 *
 * Two local, read-only probes: `--help` (does this build support the one-shot
 * + read-only flags Relay depends on?) and `status` (which provider/model does
 * the real Hermes configuration resolve to, and is any provider authenticated?).
 * Neither probe contacts an inference provider, so a full-team preflight costs
 * nothing and can run before the first paid OpenAI request.
 */
export interface HermesProbeResult {
  ok: boolean;
  /** stdout+stderr combined — auth state is not always on stdout. */
  text: string;
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
  authenticatedProviders: string[];
  billingPath: 'subscription';
}

const defaultProbe = (executable: string, args: string[]): HermesProbeResult => {
  try {
    const r = spawnSync(executable, args, {
      encoding: 'utf8',
      timeout: 20_000,
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
  deps: { probe?: (executable: string, args: string[]) => HermesProbeResult } = {},
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
  }

  const status = probe(cfg.executable, ['status']);
  const parsed = parseHermesStatus(status.text);
  const model = cfg.model ?? parsed.model;
  const provider = cfg.provider ?? parsed.provider;
  if (!model) missing.push('hermes model (RELAY_HERMES_MODEL or a configured default)');
  if (!provider) missing.push('hermes provider (RELAY_HERMES_PROVIDER or a configured default)');
  if (parsed.authenticatedProviders.length === 0) missing.push('hermes authenticated provider');
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs <= 0) missing.push('RELAY_HERMES_TIMEOUT_MS');
  if (!Number.isFinite(cfg.maxOutputBytes) || cfg.maxOutputBytes <= 0) missing.push('RELAY_HERMES_MAX_OUTPUT');

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
    billingPath: 'subscription',
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

/** Strict validation — malformed output NEVER approves. */
export function validateHermesReview(text: string): HermesReviewResult | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
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

  return { verdict, summary: safeText(o.summary), findings, requirementsChecked };
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

  const args = ['-z', prompt, '--safe-mode'];
  if (cfg.model) args.push('-m', cfg.model);
  if (cfg.provider) args.push('--provider', cfg.provider);

  // Empty scratch cwd — the reviewer has no path into the controlled project.
  const cwd = mkdtempSync(join(tmpdir(), 'relay-hermes-review-'));
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
      resolve({ kind: 'launch_failed', safeMessage: 'The Hermes reviewer could not be started.' });
      return;
    }

    let out = '';
    let bytes = 0;
    let settled = false;
    const finish = (o: HermesOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(o);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      finish({ kind: 'review_incomplete', safeMessage: 'The Hermes reviewer timed out.', startedAt, completedAt: now() });
    }, cfg.timeoutMs);

    child.stdout?.on('data', (c: Buffer) => {
      bytes += c.length;
      if (bytes <= cfg.maxOutputBytes) out += c.toString('utf8');
    });
    child.stderr?.on('data', () => { /* never surfaced verbatim */ });
    child.on('error', () => finish({ kind: 'launch_failed', safeMessage: 'The Hermes reviewer could not be started.' }));
    child.on('close', (code) => {
      const completedAt = now();
      const parsed = validateHermesReview(out);
      if (!parsed) {
        finish({
          kind: 'review_incomplete',
          safeMessage:
            code === 0
              ? 'The Hermes reviewer returned no valid structured review.'
              : `The Hermes reviewer exited without a valid review (code ${code ?? 'unknown'}).`,
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
        model: cfg.model ?? null,
        provider: cfg.provider ?? null,
      });
    });
  });
}
