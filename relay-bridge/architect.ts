/**
 * PROMPT ARCHITECT connector (Sunday Alcatraz).
 *
 * "Sunday Alcatraz" is the Fusion compound-intelligence engine, already
 * served over HTTP by the existing backend (`server/index.ts` → POST
 * /api/fusion/run). The bridge calls it server-to-server to produce a real,
 * request-shaped implementation brief that becomes the Coding Agent's
 * handoff. No provider key ever lives here — the Fusion backend owns keys and
 * decides live-vs-mock from FUSION_ENABLE_LIVE_PROVIDERS. The bridge reads
 * /health to label provenance HONESTLY: 'live' only when Fusion actually ran
 * a provider model; otherwise 'simulated' (engine ran with offline adapters).
 */

import { safeText, safeLines } from './redact';

export type SundayMode = 'fast' | 'balanced' | 'deep';

export interface ArchitectHandoff {
  objective: string;
  /** Steps the architect proposed — injected into the coding-agent prompt. */
  instructions: string[];
  /** Relay's fixed safety envelope (authoritative, not the architect's). */
  constraints: string[];
  /** Verifiable acceptance criteria for the controlled task (authoritative). */
  acceptanceCriteria: string[];
  /** The architect's full brief text (redacted) — shown and injected. */
  briefText: string;
  architectLabel: string;
  architectProvenance: 'live' | 'simulated';
  traceId: string | null;
  modelsUsed: string[];
}

export class ArchitectUnavailableError extends Error {
  readonly code = 'architect_unavailable';
  readonly retryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'ArchitectUnavailableError';
  }
}

interface FusionHealth {
  liveProvidersEnabled?: boolean;
  anthropicConfigured?: boolean;
  openaiConfigured?: boolean;
}

interface FusionRunResponse {
  finalAnswer?: string;
  traceId?: string;
  modelsUsed?: string[];
  providers?: Array<{ model?: string; status?: string }>;
}

function buildArchitectPrompt(objective: string, acceptance: string[]): string {
  return [
    'You are the Prompt Architect for an autonomous coding mission. Produce a',
    'concise implementation brief that a Coding Agent (Claude Code) will follow.',
    '',
    'TASK OBJECTIVE:',
    objective,
    '',
    'The Coding Agent must satisfy these acceptance criteria (do not change them):',
    ...acceptance.map((a) => `- ${a}`),
    '',
    'Respond with, in this order:',
    '1) One sentence restating the objective.',
    '2) A numbered list of 3-6 concrete implementation steps.',
    '3) Key constraints or risks the agent should respect.',
    'Keep it under 180 words. Describe the plan; do not write the final code.',
  ].join('\n');
}

/** Pull a step list out of the architect's prose. Prefers numbered/bulleted
    lines; falls back to the first few sentences. Always returns something. */
export function parseInstructions(answer: string): string[] {
  const lines = answer
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const numbered = lines
    .filter((l) => /^(?:\d+[.)]|[-*•])\s+/.test(l))
    .map((l) => l.replace(/^(?:\d+[.)]|[-*•])\s+/, '').trim())
    .filter((l) => l.length > 0);
  if (numbered.length >= 2) return numbered.slice(0, 6);
  // Fallback: split into sentences.
  const sentences = answer
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
  return sentences.slice(0, 4);
}

async function getJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ArchitectUnavailableError('The Prompt Architect returned an unreadable response.');
  }
}

export async function runArchitect(input: {
  objective: string;
  fusionBaseUrl: string;
  fixedConstraints: string[];
  fixedAcceptance: string[];
  sundayMode?: SundayMode;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<ArchitectHandoff> {
  const doFetch = input.fetchImpl ?? fetch;
  const base = input.fusionBaseUrl.replace(/\/$/, '');
  const sundayMode = input.sundayMode ?? 'balanced';

  // 1) Provenance from /health — the only honest source of live-vs-mock.
  let health: FusionHealth = {};
  try {
    const hres = await doFetch(`${base}/health`, { method: 'GET' });
    if (hres.ok) health = await getJson<FusionHealth>(hres);
  } catch {
    throw new ArchitectUnavailableError('Sunday Alcatraz (the Prompt Architect) is not reachable.');
  }
  const live = health.liveProvidersEnabled === true;

  // 2) Run the architect.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 120_000);
  let payload: FusionRunResponse;
  try {
    const res = await doFetch(`${base}/api/fusion/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: buildArchitectPrompt(input.objective, input.fixedAcceptance),
        sundayMode,
        adapterMode: 'auto', // Fusion decides live vs mock from its own policy
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new ArchitectUnavailableError(
        `Sunday Alcatraz could not prepare the handoff (status ${res.status}).`,
      );
    }
    payload = await getJson<FusionRunResponse>(res);
  } catch (err) {
    if (err instanceof ArchitectUnavailableError) throw err;
    throw new ArchitectUnavailableError('Sunday Alcatraz did not answer in time.');
  } finally {
    clearTimeout(timeout);
  }

  const answer = typeof payload.finalAnswer === 'string' ? payload.finalAnswer : '';
  if (!answer.trim()) {
    throw new ArchitectUnavailableError('Sunday Alcatraz returned an empty brief.');
  }
  const modelsUsed = Array.isArray(payload.modelsUsed)
    ? payload.modelsUsed.map((m) => safeText(m)).filter(Boolean)
    : (payload.providers ?? []).map((p) => safeText(p.model)).filter(Boolean);

  const instructions = safeLines(parseInstructions(answer));
  const architectLabel = live
    ? `Sunday Alcatraz · live${modelsUsed.length ? ` (${modelsUsed.join(', ')})` : ''}`
    : 'Sunday Alcatraz engine · offline models (no provider key on host)';

  return {
    objective: safeText(input.objective),
    instructions: instructions.length ? instructions : ['Implement the objective within the claimed file only.'],
    constraints: safeLines(input.fixedConstraints),
    acceptanceCriteria: safeLines(input.fixedAcceptance),
    briefText: safeText(answer),
    architectLabel,
    architectProvenance: live ? 'live' : 'simulated',
    traceId: typeof payload.traceId === 'string' ? safeText(payload.traceId) : null,
    modelsUsed,
  };
}
