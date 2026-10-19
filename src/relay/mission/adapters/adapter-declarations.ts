import type { AdapterCapabilityDeclaration, AdapterVerb } from './adapter-lifecycle';

/**
 * WHAT RELAY'S OWN ADAPTERS ACTUALLY DO.
 *
 * Each entry describes an adapter that exists in this repository, and the
 * absences are the useful part. `resume` is missing almost everywhere because
 * almost nothing here holds a server-side session, and saying so stops an
 * operator looking for a flag that was never written.
 *
 * These are DECLARATIONS, checked against the real handlers by
 * `adapter-lifecycle.test.ts`. A declaration is a claim, and this file is
 * where a claim would be easiest to make carelessly.
 */

const v = (...verbs: AdapterVerb[]): readonly AdapterVerb[] => Object.freeze(verbs);

export const RELAY_ADAPTER_DECLARATIONS: readonly AdapterCapabilityDeclaration[] = Object.freeze([
  Object.freeze({
    adapterId: 'claude_code_local',
    displayName: 'Claude Code (installed CLI)',
    verbs: v('readiness', 'start', 'execute', 'stream', 'stop', 'result', 'usage', 'identity', 'capabilities'),
    absenceNotes: Object.freeze({
      resume: 'The CLI adapter resumes a SESSION, not an interrupted call: an unconfirmable in-flight run becomes disconnected and is never replayed, which is Relay’s rule rather than a limitation of the tool.',
    }),
  }),
  Object.freeze({
    adapterId: 'claude_agent_sdk_hosted',
    displayName: 'Claude Agent SDK (hosted)',
    verbs: v('readiness', 'execute', 'stream', 'result', 'usage', 'identity', 'capabilities'),
    absenceNotes: Object.freeze({
      start: 'The hosted invoker runs one bounded call and returns; there is no handle to hold.',
      stop: 'Nothing outlives the call, so there is nothing to cancel. A surface offering a cancel button over this would be lying.',
      resume: 'No server-side session is held.',
    }),
  }),
  Object.freeze({
    adapterId: 'openai_gpt_architect',
    displayName: 'ChatGPT (OpenAI) Prompt Architect',
    verbs: v('readiness', 'execute', 'result', 'usage', 'identity', 'capabilities'),
    absenceNotes: Object.freeze({
      start: 'One request, one answer.',
      stream: 'Relay reads the completed response; partial architecture is not useful to a mission.',
      stop: 'The call is short and unbounded cancellation would leave spend unaccounted.',
      resume: 'No session exists to resume.',
    }),
  }),
  Object.freeze({
    adapterId: 'hermes_local',
    displayName: 'Hermes Reviewer (local process)',
    verbs: v('readiness', 'execute', 'stop', 'result', 'identity', 'capabilities'),
    absenceNotes: Object.freeze({
      start: 'The reviewer runs one shot and returns a verdict.',
      stream: 'A partial review is not a review.',
      resume: 'No session is held.',
      usage: 'The one-shot CLI reports no usage Relay can attribute, so Relay reports none rather than estimating one.',
    }),
  }),
  Object.freeze({
    adapterId: 'hermes_remote_service',
    displayName: 'Hermes Reviewer (dedicated service)',
    verbs: v('readiness', 'start', 'stop', 'result', 'usage', 'identity', 'capabilities'),
    absenceNotes: Object.freeze({
      execute: 'The service starts a run and is polled; it has no single blocking call.',
      stream: 'The service returns a completed review, not tokens.',
      resume: 'A run is identified and polled rather than resumed — the run id IS the continuation.',
    }),
  }),
  Object.freeze({
    /**
     * Found by the coverage test above, not by me: the development architect
     * has been registered since role slots shipped and had no lifecycle
     * declaration, so nothing could describe it. That is the whole reason the
     * coverage test is worth having — it finds the ones already there, not
     * only the one being added.
     */
    adapterId: 'fusion_architect',
    displayName: 'Sunday Alcatraz (Fusion) development architect',
    verbs: v('readiness', 'execute', 'result', 'identity', 'capabilities'),
    absenceNotes: Object.freeze({
      start: 'One request, one plan.',
      stream: 'Relay reads the completed plan; a partial architecture is not useful to a mission.',
      stop: 'The call is short and holds nothing to cancel.',
      resume: 'No session is held.',
      usage: 'The development architect is unmetered — it is the no-spend path, and reporting a usage record for it would imply a cost that does not exist.',
    }),
  }),
  Object.freeze({
    adapterId: 'openai_reviewer',
    displayName: 'GPT Reviewer (provider API)',
    verbs: v('readiness', 'execute', 'result', 'identity', 'capabilities'),
    absenceNotes: Object.freeze({
      start: 'One request, one verdict.',
      stream: 'A partial review is not a review.',
      stop: 'The call is short and cancelling it mid-flight would leave the spend unaccounted.',
      resume: 'No session is held.',
      usage: 'Relay does not yet read the provider’s token counts back into a usage record, so it reports none rather than estimating one.',
    }),
  }),
  Object.freeze({
    adapterId: 'relay_live_reach',
    displayName: 'Live Reach retrieval',
    /**
     * `usage` is declared because retrieval is now metered — see
     * `live-reach-metering.ts`. The unit is retrievals and bytes, never money,
     * and the meter keeps confirmed and unconfirmed attempts apart rather than
     * reporting one number it cannot stand behind. Declaring the verb is what
     * makes `operatorPromises().budgetable` true, so a cap over retrieval is a
     * cap rather than a hope.
     */
    verbs: v('readiness', 'execute', 'result', 'identity', 'capabilities', 'usage'),
    absenceNotes: Object.freeze({
      start: 'A retrieval is one bounded fetch.',
      stream: 'Relay reads a whole document before sanitizing it; a partially sanitized document must never reach an agent.',
      stop: 'The fetch is bounded by bytes and time, so cancellation has nothing to add.',
      resume: 'A re-fetch is a new observation with its own retrieval time, not a continuation of an old one.',
    }),
  }),
]);
