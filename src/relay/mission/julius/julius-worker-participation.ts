import { JULIUS_CODER_OBSERVATION_KINDS, JULIUS_CODER_OBSERVATION_LIMITS } from './julius-architecture-drift';
import { JULIUS_CHECKPOINT_LIMITS, JULIUS_GUIDANCE_LIMITS } from './julius-continuous-lifecycle';
import {
  JULIUS_RESEARCH_ASK_FIELDS,
  JULIUS_RESEARCH_ASK_LIMITS,
} from './julius-research-protocol';
import { JULIUS_SEGMENT_LIMITS } from './julius-segment-lineage';
import {
  LIVE_REACH_READ_CAPABILITIES,
  LIVE_REACH_SOURCES,
} from '../live-reach';

/**
 * HOW A WORKER WITHOUT A STRUCTURED OUTPUT SCHEMA PARTICIPATES.
 *
 * THE GAP THIS CLOSES. The continuous lifecycle — checkpoints, guidance,
 * governed research, segment continuation — is complete in the domain and was
 * unreachable in production. `driveContinuousLifecycle` runs only when a
 * dispatch result carries `guidanceRequest`, `guidance`, or `researchAsks`, and
 * on trusted main `9f155b91` no live adapter carried any of the three. The
 * architect can answer a guidance task; a guidance task is minted only from a
 * coder's request; no coder could make one. The loop could not start, so on
 * every paid mission so far the Coding Agent's only way to be stuck was to
 * finish anyway, and a research grant would have been sealed and never
 * consulted.
 *
 * WHY A BLOCK OF TEXT AND NOT A FIELD. The Prompt Architect answers with one
 * JSON object against a schema, so its channels are fields. The Coding Agent is
 * an agentic session: it holds tools, edits files across many turns, and its
 * only structured return is the text of its final message. It also cannot
 * create a file — `HOSTED_DISALLOWED_TOOLS` denies Write — so a file-based
 * channel is not available to it, and a channel through the diff would put the
 * worker's request inside the candidate patch. Its final message is what it
 * has, and this is the discipline for reading one thing out of it.
 *
 * THE DISCIPLINE IS THE ONE THE AGENT EXECUTION REPORT ESTABLISHED — a marker
 * on its own line, one JSON object after it, a balanced-brace scan so trailing
 * prose is harmless, and no truncation anywhere near it. That parser is a
 * connector's (`src/relay/connectors/claude-code/report-parser.ts`) and the
 * domain may not import a connector, so the scan is written again here rather
 * than shared. The two never need to agree: they read different markers for
 * different protocols, and each is held by its own cases.
 *
 * WHAT THIS MODULE DOES NOT DO. It does not decide whether an ask is
 * permitted, whether a question deserves an answer, or whether a resume is
 * usable. Every channel is handed on EXACTLY as the worker wrote it, typed
 * `unknown`, and the domain's own sanitizers refuse what they refuse — the same
 * rule the architect's `contractProposal` follows, and for the same reason: a
 * transport that pre-cleaned a request would be deciding what the domain is
 * allowed to refuse, and the record would never say the worker tried.
 *
 * AMBIGUITY IS REFUSED, NEVER RESOLVED. Two blocks in one message is a worker
 * that said two things; this reports that it could not be read rather than
 * picking the later one. An unrecognised channel name refuses the whole block
 * for the same reason a research ask naming a forbidden field refuses the whole
 * ask: a request silently dropped is a worker that believes it asked and a
 * record that does not say it did.
 *
 * Pure: no clock, no Node, no network, no filesystem.
 */

export const JULIUS_PARTICIPATION_VERSION = 'julius-worker-participation.v1' as const;

/**
 * The marker, on its own line, once. Deliberately unlike
 * `RELAY_AGENT_EXECUTION_REPORT_V1`: a worker that emitted the wrong one gets a
 * legible refusal instead of a report parsed as a participation block.
 */
export const JULIUS_PARTICIPATION_MARKER = 'JULIUS_WORKER_PARTICIPATION_V1' as const;

export const JULIUS_PARTICIPATION_LIMITS = Object.freeze({
  /**
   * The JSON object itself. Every channel inside is separately bounded by the
   * domain sanitizer that owns it; this is the outer bound that stops a runaway
   * message being scanned as a request, and it is generous enough that no
   * well-formed block can reach it.
   */
  blockChars: 12_000,
});

/**
 * THE CHANNELS, AND NOTHING ELSE.
 *
 * Each name is a field the pipeline already reads off a dispatch result. This
 * list is not a new capability: it is the set of existing capabilities a worker
 * with no output schema previously had no way to reach.
 */
export const JULIUS_PARTICIPATION_CHANNELS = [
  'guidanceRequest',
  'researchAsks',
  'segmentResume',
  /**
   * A Coding Agent's account of its own work — claims, not evidence. Julius
   * records it beside the change set the executor observed and compares the
   * two; the authority guard refuses a report that claims a completion.
   */
  'report',
  /**
   * What a Coding Agent saw the design do under real code, with evidence.
   * Julius decides whether it is a reason to consult the architect.
   */
  'architectureObservations',
] as const;
export type JuliusParticipationChannel = (typeof JULIUS_PARTICIPATION_CHANNELS)[number];

/**
 * WHY A BLOCK COULD NOT BE READ — closed, so the record names the cause rather
 * than reporting that something unspecified went wrong.
 */
export const JULIUS_PARTICIPATION_REFUSALS = [
  /** The marker appears more than once. Two requests, and no way to tell which. */
  'PARTICIPATION_REPEATED',
  /** The marker is there and no JSON object follows it. */
  'PARTICIPATION_NO_OBJECT',
  /** An object begins and never closes. */
  'PARTICIPATION_UNCLOSED',
  /** The object is larger than a request has any reason to be. */
  'PARTICIPATION_TOO_LARGE',
  /** It closes and is not JSON. */
  'PARTICIPATION_MALFORMED',
  /**
   * It is JSON and is not an object.
   *
   * UNREACHABLE BY CONSTRUCTION TODAY, and kept on purpose: the block must
   * begin with `{` and is cut at its balanced closing brace, so what reaches
   * `JSON.parse` is an object or a syntax error. It is the fail-safe for a
   * later hand loosening that opening rule — a list read as its first element
   * is exactly the silent resolution this module refuses, and it should refuse
   * by name rather than fall through to `Object.keys` of a primitive.
   */
  'PARTICIPATION_NOT_AN_OBJECT',
  /** An object with no channel in it: a worker that said nothing, loudly. */
  'PARTICIPATION_NO_CHANNEL',
  /** A key that is not a channel. Refused whole, never dropped. */
  'PARTICIPATION_UNKNOWN_CHANNEL',
] as const;
export type JuliusParticipationRefusal = (typeof JULIUS_PARTICIPATION_REFUSALS)[number];

/**
 * WHAT A WORKER'S FINAL MESSAGE SAID.
 *
 * THREE OUTCOMES, NOT TWO. "No block" is the ordinary case and is not a
 * failure: most dispatches finish the work. "A block that could not be read" is
 * a different fact from both, and it is the one that must never be silently
 * folded into "no block" — a worker that asked and was not heard is exactly the
 * failure this channel exists to prevent, one indirection later.
 */
export type JuliusParticipationReading =
  | { readonly present: false }
  | { readonly present: true; readonly readable: false; readonly reasonCode: JuliusParticipationRefusal }
  | {
      readonly present: true;
      readonly readable: true;
      /** Which channels the worker used, in the module's own order. */
      readonly channels: readonly JuliusParticipationChannel[];
      /** Exactly as written. Julius sanitises; this does not. */
      readonly guidanceRequest?: unknown;
      readonly researchAsks?: unknown;
      readonly segmentResume?: unknown;
      readonly report?: unknown;
      readonly architectureObservations?: unknown;
    };

const ABSENT: JuliusParticipationReading = Object.freeze({ present: false });
const refuse = (reasonCode: JuliusParticipationRefusal): JuliusParticipationReading =>
  Object.freeze({ present: true, readable: false, reasonCode });

/**
 * The balanced-brace scan. Braces inside strings do not count, and a backslash
 * escapes the next character, so a request quoting JSON at Julius does not cut
 * its own block short. Returns the index of the closing brace, or -1.
 */
function closingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Read a worker's participation block out of its final message.
 *
 * The marker must appear exactly once. It is the WORKER's text, never a
 * prompt's — the charter that teaches the protocol is not searched, and nothing
 * here ever reads a transcript.
 */
export function readJuliusParticipationBlock(finalText: string | null): JuliusParticipationReading {
  if (typeof finalText !== 'string') return ABSENT;
  const first = finalText.indexOf(JULIUS_PARTICIPATION_MARKER);
  if (first === -1) return ABSENT;
  if (finalText.indexOf(JULIUS_PARTICIPATION_MARKER, first + JULIUS_PARTICIPATION_MARKER.length) !== -1) {
    return refuse('PARTICIPATION_REPEATED');
  }

  const after = finalText.slice(first + JULIUS_PARTICIPATION_MARKER.length);
  /**
   * THE OBJECT MUST BE THE NEXT THING, and the one wrapper tolerated is named.
   *
   * Scanning forward to the first `{` anywhere would read `[{...}, {...}]` as
   * its first element — a worker that sent a list and had one item answered,
   * which is the silent resolution this module exists to refuse. A fenced block
   * is different in kind: it is a well-known wrapper around the same one
   * object, not a second reading of what the worker meant, and refusing it
   * would cost a paid dispatch over punctuation. So: whitespace, at most one
   * fence opener, then the object.
   */
  const opening = /^\s*(?:```[A-Za-z]*[^\S\n]*\n)?\s*\{/.exec(after);
  if (opening === null) return refuse('PARTICIPATION_NO_OBJECT');
  const start = opening[0].length - 1;
  const end = closingBrace(after, start);
  if (end === -1) return refuse('PARTICIPATION_UNCLOSED');
  const body = after.slice(start, end + 1);
  if (body.length > JULIUS_PARTICIPATION_LIMITS.blockChars) return refuse('PARTICIPATION_TOO_LARGE');

  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return refuse('PARTICIPATION_MALFORMED'); }
  // Unreachable while the opening rule above holds. See the refusal's own note.
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return refuse('PARTICIPATION_NOT_AN_OBJECT');
  }

  const source = parsed as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!(JULIUS_PARTICIPATION_CHANNELS as readonly string[]).includes(key)) {
      return refuse('PARTICIPATION_UNKNOWN_CHANNEL');
    }
  }
  const channels = JULIUS_PARTICIPATION_CHANNELS.filter((channel) => channel in source);
  if (channels.length === 0) return refuse('PARTICIPATION_NO_CHANNEL');

  return Object.freeze({
    present: true as const,
    readable: true as const,
    channels: Object.freeze([...channels]),
    // `in`, not a truthiness test: a channel written as `null` is a channel the
    // worker used and the domain will refuse by name, which is a better record
    // than a request that was never mentioned again.
    ...('guidanceRequest' in source ? { guidanceRequest: source.guidanceRequest } : {}),
    ...('researchAsks' in source ? { researchAsks: source.researchAsks } : {}),
    ...('segmentResume' in source ? { segmentResume: source.segmentResume } : {}),
    ...('report' in source ? { report: source.report } : {}),
    ...('architectureObservations' in source ? { architectureObservations: source.architectureObservations } : {}),
  });
}

/**
 * THE PROTOCOL AS THE WORKER IS TOLD IT — built from the constants the parser
 * and the domain sanitizers actually use.
 *
 * A channel a worker was never told about is a channel that does not exist, and
 * a protocol described twice is a protocol that drifts. Every bound below is
 * read from its owning module, so raising `JULIUS_RESEARCH_ASK_LIMITS.asks` or
 * adding a Live Reach source changes what the worker is told in the same edit
 * that changes what Julius accepts.
 */
export function juliusParticipationProtocol(): string {
  return [
    'ASKING JULIUS FOR SOMETHING, MID-MISSION.',
    'If you can finish the work, finish it and say nothing further: no block is the ordinary case.',
    'If you are blocked on something this workspace cannot settle, you may END YOUR TURN and ask.',
    'Asking ends this dispatch. Julius answers, and your work resumes in a later segment with the answer in hand — so ask before you guess, not after.',
    `To ask — or to report — end your final message with the line ${JULIUS_PARTICIPATION_MARKER} followed by exactly one JSON object, once, with any of these keys and no others:`,
    '',
    `  "guidanceRequest": { "question": string, "blockedOn": string[], "attempted": string[], "relevantPaths": string[] }`,
    `      A question for the Prompt Architect about the plan you were given. Not an instruction to it, and not a change to your terms.`,
    `      question up to ${JULIUS_CHECKPOINT_LIMITS.summaryChars} characters; each list entry up to ${JULIUS_GUIDANCE_LIMITS.entryChars}, at most ${JULIUS_GUIDANCE_LIMITS.entriesPerList} entries.`,
    '',
    `  "researchAsks": [ { ${JULIUS_RESEARCH_ASK_FIELDS.map((field) => `"${field}"`).join(', ')} } ]`,
    `      Something outside this workspace for Julius to go and read on your behalf, at most ${JULIUS_RESEARCH_ASK_LIMITS.asks} per turn.`,
    `      "source" is one of: ${LIVE_REACH_SOURCES.join(', ')}. "capability" is one of: ${LIVE_REACH_READ_CAPABILITIES.join(', ')}.`,
    `      "reference" is what to read, up to ${JULIUS_RESEARCH_ASK_LIMITS.referenceChars} characters; "purpose" is why you need it, up to ${JULIUS_RESEARCH_ASK_LIMITS.purposeChars}.`,
    `      Julius decides whether the mission is authorised to read it. An unauthorised ask is refused and recorded; it is never served quietly.`,
    '',
    `  "segmentResume": { "completedSoFar": string[], "nextIntent": string }`,
    `      Where to pick your own work up, for the segment that continues it. At most ${JULIUS_SEGMENT_LIMITS.entries} entries of ${JULIUS_SEGMENT_LIMITS.entryChars} characters; nextIntent up to ${JULIUS_SEGMENT_LIMITS.intentChars}.`,
    '',
    `  "report": { "outcome": "IMPLEMENTED" | "PARTIALLY_IMPLEMENTED" | "BLOCKED" | "NO_CHANGE_NEEDED", "summary": string, "filesTouched": string[], "testsRun": string[], "remainingUncertainty": string[], "blockedReason": string | null }`,
    `      Optional: your own account of the work, recorded beside what the independent executor observed. blockedReason is required exactly when the outcome is BLOCKED.`,
    `      You cannot report the work complete or verified — Julius and the independent reviewer decide that, and such a report is refused.`,
    '',
    `  "architectureObservations": [ { "kind": ${JULIUS_CODER_OBSERVATION_KINDS.map((kind) => `"${kind}"`).join(' | ')}, "subject": string, "claim": string, "evidenceRefs": string[] } ]`,
    `      Optional, Coding Agent only: what the design in force did under real code, at most ${JULIUS_CODER_OBSERVATION_LIMITS.observations}, each with 1 to ${JULIUS_CODER_OBSERVATION_LIMITS.evidenceRefs} evidence locators.`,
    `      "subject" up to ${JULIUS_CODER_OBSERVATION_LIMITS.subjectChars} characters — for ASSUMPTION_INVALIDATED, the assumption id from the ARCHITECTURE CONTEXT; "claim" up to ${JULIUS_CODER_OBSERVATION_LIMITS.claimChars}.`,
    `      You do not change the architecture. Julius decides whether what you saw is a reason to consult the Prompt Architect.`,
    '',
    'RULES THAT REFUSE THE WHOLE BLOCK, so a request is never half-heard:',
    '  - the marker more than once, or a key that is not one of the five above;',
    '  - any field naming a mission term you do not set — budget, hosts, scope, role, ids, credentials.',
    'Write no reasoning, monologue or scratchpad text into the block. It is a request, and Julius records it.',
  ].join('\n');
}
