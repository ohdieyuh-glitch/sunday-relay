import type { SidekickFailure } from '../../src/relay/mission/sidekicks';

/**
 * WHAT A PROVIDER MUST BE ABLE TO DO — the whole seam between Wonderland and whatever is thinking.
 *
 * FOUNDER DIRECTIVE (2026-09-17): finish the provider interface, auth state, cancellation, timeout, rate limits, quota
 * failure, malformed results, reconnection, session identity and audit PROVIDER-FREE, with deterministic fixtures, before
 * any paid call. So this port is written for the fixtures first; a real provider is then something that satisfies it, not
 * something the architecture bends around.
 *
 * DELIBERATELY SMALL. A provider answers, streams while it answers, can be stopped, and can say whether it is reachable.
 * It does not decide states, keep sessions, write audit or know anything about Wonderland: those belong to the domain.
 */

export interface ProviderChunk {
  /** More of the answer, as it actually arrives. */
  readonly text: string;
}

export type ProviderResult =
  | { readonly ok: true; readonly answer: string; readonly modelId: string; readonly ms: number }
  | { readonly ok: false; readonly failure: SidekickFailure; readonly detail: string; readonly retryAfterMs?: number };

export interface ProviderAsk {
  readonly sessionId: string;
  readonly turnId: string;
  readonly modelId: string;
  /** What the user said. A provider gets this and nothing else about Wonderland. */
  readonly ask: string;
  /** Earlier turns of this session, oldest first, so a conversation is a conversation. */
  readonly history: readonly { readonly ask: string; readonly answer: string }[];
  /** Give up after this long. The runtime enforces it too; a provider that honours it fails faster and more clearly. */
  readonly timeoutMs: number;
  /** Called as words arrive, so the terminal and the body move while the provider is still talking. */
  readonly onChunk: (chunk: ProviderChunk) => void;
  /** Resolves when the caller has cancelled; a provider should stop and answer CANCELLED. */
  readonly signal: AbortSignal;
}

/** What a scoped piece of work asks for, which is not a conversation. */
export interface AgentTask extends ProviderAsk {
  /** The only folder this work may touch. A single agent is bounded by construction, not by good intentions. */
  readonly workingDirectory: string;
  /** What it is allowed to do inside that folder, and nothing beyond it. */
  readonly allow: readonly ('read' | 'write' | 'run')[];
}

export interface SidekickProviderPort {
  readonly providerId: string;
  /**
   * Is there really something behind this? For a development provider, always. For a real one, this is the honest check
   * -- the tool answering, or the credential being present -- and it is what moves a sidekick out of AUTH_REQUIRED.
   */
  reachable(): Promise<{ readonly ok: true; readonly detail: string } | { readonly ok: false; readonly failure: SidekickFailure; readonly detail: string }>;
  /** One turn. Streams as it goes, obeys the signal, and never throws: a failure is a result, not an exception. */
  ask(input: ProviderAsk): Promise<ProviderResult>;
  /** Let go of anything held. */
  close?(): Promise<void>;
}

export interface AgentProviderPort extends Omit<SidekickProviderPort, 'ask'> {
  /** One bounded task inside one folder. Same rules as a turn, with a working directory and an allowance. */
  work(input: AgentTask): Promise<ProviderResult>;
}
