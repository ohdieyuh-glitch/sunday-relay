/**
 * PROMPT ARCHITECT — ChatGPT (OpenAI API), routed through Sunday Alcatraz.
 *
 * Server-side only. The key is read from the bridge process environment and is
 * NEVER returned, logged, or placed in a mission event. Live mode is explicit:
 * RELAY_PROMPT_ARCHITECT_MODE=live is required — a key alone never enables it.
 *
 * Malformed or empty model output is REJECTED. It is never silently replaced
 * with a fixture, and a failure never becomes a fabricated handoff.
 *
 * Uses plain fetch against the REST API (the `openai` SDK is not installed and
 * this task must not add dependencies).
 */

import { createHash } from 'node:crypto';
import { safeText } from './redact';

export interface PromptArchitectHandoff {
  objective: string;
  task: string;
  implementationInstructions: string[];
  constraints: string[];
  acceptanceCriteria: string[];
  allowedFiles: string[];
  prohibitedFiles: string[];
  recommendedChecks: string[];
}

export interface ArchitectReceipt {
  provider: 'openai';
  model: string;
  /** Redacted — last 6 chars only, never the full provider id. */
  requestIdRedacted: string | null;
  startedAt: string;
  completedAt: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Digest of the exact request body Relay sent (proves what was asked). */
  inputDigest: string;
  outputDigest: string;
  billingPath: 'api_billed';
  /** TRUTHFUL ROUTE. Sunday Alcatraz SELECTS and RECORDS the architect route
      (mode, provider, model, limits); the request itself leaves the Relay
      bridge directly for the OpenAI REST API. `networkPath` states the path
      that actually occurred — no UI may claim a hop that did not happen. */
  coordinatedBy: 'sunday-alcatraz';
  networkPath: 'relay-bridge-direct-openai';
  coordinationLabel: string;
}

/** The single truthful phrase for the architect route. */
export const ARCHITECT_COORDINATION_LABEL =
  'Coordinated by Sunday Alcatraz · direct OpenAI request from the Relay bridge';

export interface OpenAiArchitectResult {
  handoff: PromptArchitectHandoff;
  receipt: ArchitectReceipt;
}

export class PromptArchitectBlockedError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = 'PromptArchitectBlockedError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface OpenAiArchitectConfig {
  apiKey?: string;
  model?: string;
  mode?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

/** Reads config WITHOUT exposing values. Live requires the explicit mode. */
export function loadArchitectConfig(env: NodeJS.ProcessEnv = process.env): OpenAiArchitectConfig {
  return {
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_PROMPT_ARCHITECT_MODEL,
    mode: env.RELAY_PROMPT_ARCHITECT_MODE,
    maxOutputTokens: Number(env.RELAY_PROMPT_ARCHITECT_MAX_TOKENS ?? 1200),
    timeoutMs: Number(env.RELAY_PROMPT_ARCHITECT_TIMEOUT_MS ?? 90_000),
  };
}

/** Preflight — never throws, never exposes values. */
export function architectPreflight(cfg: OpenAiArchitectConfig): {
  ready: boolean;
  reason?: string;
  missing: string[];
} {
  const missing: string[] = [];
  if (cfg.mode !== 'live') missing.push('RELAY_PROMPT_ARCHITECT_MODE=live');
  if (!cfg.apiKey) missing.push('OPENAI_API_KEY');
  if (!cfg.model) missing.push('OPENAI_PROMPT_ARCHITECT_MODEL');
  // A bounded request is part of the configuration, not a default we assume:
  // an unusable timeout/output limit blocks before the request is made.
  const positive = (v: number | undefined) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (!positive(cfg.timeoutMs)) missing.push('RELAY_PROMPT_ARCHITECT_TIMEOUT_MS');
  if (!positive(cfg.maxOutputTokens)) missing.push('RELAY_PROMPT_ARCHITECT_MAX_TOKENS');
  if (missing.length) {
    return {
      ready: false,
      reason: `The ChatGPT Prompt Architect is not configured. Missing: ${missing.join(', ')}.`,
      missing,
    };
  }
  return { ready: true, missing: [] };
}

const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim().length > 0);

/** Strict validation — a malformed handoff is a hard failure, never a fixture. */
export function validateHandoff(raw: unknown): PromptArchitectHandoff {
  if (!raw || typeof raw !== 'object') {
    throw new PromptArchitectBlockedError('architect_malformed', 'The Prompt Architect returned no usable handoff.');
  }
  const o = raw as Record<string, unknown>;
  const str = (k: string): string => {
    const v = o[k];
    if (typeof v !== 'string' || !v.trim()) {
      throw new PromptArchitectBlockedError('architect_malformed', `The Prompt Architect handoff is missing "${k}".`);
    }
    return safeText(v);
  };
  const arr = (k: string, required: boolean): string[] => {
    const v = o[k];
    if (v === undefined && !required) return [];
    if (!isStrArray(v) || (required && v.length === 0)) {
      throw new PromptArchitectBlockedError('architect_malformed', `The Prompt Architect handoff is missing "${k}".`);
    }
    return v.map((s) => safeText(s));
  };
  return {
    objective: str('objective'),
    task: str('task'),
    implementationInstructions: arr('implementationInstructions', true),
    constraints: arr('constraints', false),
    acceptanceCriteria: arr('acceptanceCriteria', true),
    allowedFiles: arr('allowedFiles', false),
    prohibitedFiles: arr('prohibitedFiles', false),
    recommendedChecks: arr('recommendedChecks', false),
  };
}

/** The full mission contract handed to the Prompt Architect. Everything here
    is stated to the model explicitly — the architect is never asked to infer
    the scope, the evidence rule, or the call budget. */
export interface ArchitectMissionContract {
  originalRequest: string;
  missionId: string;
  missionRevision?: string;
  objective: string;
  requirements?: string[];
  constraints: string[];
  outOfScope?: string[];
  acceptanceCriteria: string[];
  allowedFiles: string[];
  prohibitedFiles: string[];
  requiredTests?: string[];
  evidenceRequirements?: string[];
  maxRoleCalls?: number;
  noRepairRule?: string;
  verificationCommand: string;
  projectDescription: string;
}

function buildMessages(input: ArchitectMissionContract) {
  const system = [
    'You are the Prompt Architect for Sunday Relay, an autonomous coding relay.',
    'You produce a small, precise implementation handoff for a Coding Agent (Claude Code).',
    'You do NOT write the final implementation yourself. You do not reveal reasoning.',
    'Respond with ONE JSON object and nothing else, matching exactly this shape:',
    '{"objective":string,"task":string,"implementationInstructions":string[],',
    '"constraints":string[],"acceptanceCriteria":string[],"allowedFiles":string[],',
    '"prohibitedFiles":string[],"recommendedChecks":string[]}',
  ].join('\n');

  const bullets = (items: readonly string[] | undefined) =>
    items && items.length ? items.map((c) => `- ${c}`).join('\n') : '- (none stated)';

  const user = [
    `MISSION: ${input.missionId}`,
    `MISSION REVISION: ${input.missionRevision ?? '(unversioned)'}`,
    '',
    "FOUNDER'S EXACT REQUEST:",
    input.originalRequest,
    '',
    `OBJECTIVE: ${input.objective}`,
    `CONTROLLED PROJECT: ${input.projectDescription}`,
    '',
    `ALLOWED FILES (the agent may edit ONLY these): ${input.allowedFiles.join(', ')}`,
    `PROHIBITED FILES (never modify): ${input.prohibitedFiles.join(', ')}`,
    `REQUIRED VERIFICATION (Relay runs this itself): ${input.verificationCommand}`,
    '',
    `REQUIREMENTS:\n${bullets(input.requirements)}`,
    `CONSTRAINTS:\n${bullets(input.constraints)}`,
    `ACCEPTANCE CRITERIA:\n${bullets(input.acceptanceCriteria)}`,
    `REQUIRED TESTS:\n${bullets(input.requiredTests)}`,
    `EVIDENCE REQUIREMENTS:\n${bullets(input.evidenceRequirements)}`,
    '',
    `OUT OF SCOPE:\n${bullets(
      input.outOfScope ?? [
        'package installation',
        'network access',
        'shell commands',
        'editing any file outside the allowed list',
        'changing the tests',
      ],
    )}`,
    '',
    `MAXIMUM ROLE CALLS FOR THIS MISSION: ${input.maxRoleCalls ?? 1} per role.`,
    `NO-REPAIR RULE: ${
      input.noRepairRule ??
      'There is no repair iteration. The Coding Agent gets exactly one attempt; a failed review stops the mission.'
    }`,
    '',
    'Produce the handoff JSON now.',
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Extract the first JSON object from model text (handles ```json fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new PromptArchitectBlockedError('architect_malformed', 'The Prompt Architect did not return JSON.');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    throw new PromptArchitectBlockedError('architect_malformed', 'The Prompt Architect returned unparseable JSON.');
  }
}

export async function runOpenAiArchitect(
  input: ArchitectMissionContract & {
    config: OpenAiArchitectConfig;
    fetchImpl?: typeof fetch;
    now?: () => string;
  },
): Promise<OpenAiArchitectResult> {
  const cfg = input.config;
  const pre = architectPreflight(cfg);
  if (!pre.ready) throw new PromptArchitectBlockedError('architect_not_configured', pre.reason as string);

  const now = input.now ?? (() => new Date().toISOString());
  const doFetch = input.fetchImpl ?? fetch;
  const startedAt = now();
  const messages = buildMessages(input);
  const inputDigest = createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 16);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 90_000);
  let res: Response;
  try {
    res = await doFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        max_completion_tokens: cfg.maxOutputTokens ?? 1200,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
  } catch {
    throw new PromptArchitectBlockedError('architect_unreachable', 'The Prompt Architect provider could not be reached.', true);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Map the common, actionable cases without leaking the response body.
    const code =
      res.status === 401 ? 'architect_auth_failed'
      : res.status === 429 ? 'architect_rate_limited_or_no_credit'
      : 'architect_provider_error';
    const message =
      res.status === 401 ? 'The Prompt Architect provider rejected the credential.'
      : res.status === 429 ? 'The Prompt Architect provider refused the request (rate limit or insufficient balance).'
      : `The Prompt Architect provider returned status ${res.status}.`;
    throw new PromptArchitectBlockedError(code, message, res.status === 429);
  }

  let payload: {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    id?: string;
  };
  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    throw new PromptArchitectBlockedError('architect_malformed', 'The Prompt Architect returned an unreadable response.');
  }

  const content = payload.choices?.[0]?.message?.content ?? '';
  if (!content.trim()) {
    throw new PromptArchitectBlockedError('architect_malformed', 'The Prompt Architect returned an empty handoff.');
  }
  const handoff = validateHandoff(extractJson(content));
  const completedAt = now();
  const rawId = typeof payload.id === 'string' ? payload.id : null;

  return {
    handoff,
    receipt: {
      provider: 'openai',
      model: cfg.model as string,
      requestIdRedacted: rawId ? `…${rawId.slice(-6)}` : null,
      startedAt,
      completedAt,
      inputTokens: payload.usage?.prompt_tokens ?? null,
      outputTokens: payload.usage?.completion_tokens ?? null,
      totalTokens: payload.usage?.total_tokens ?? null,
      inputDigest,
      outputDigest: createHash('sha256').update(content).digest('hex').slice(0, 16),
      billingPath: 'api_billed',
      coordinatedBy: 'sunday-alcatraz',
      networkPath: 'relay-bridge-direct-openai',
      coordinationLabel: ARCHITECT_COORDINATION_LABEL,
    },
  };
}
