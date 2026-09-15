import { isJuliusBrainId, juliusBrainProvenance, juliusBrainSha256, type JuliusBrainBody, type JuliusBrainDraft, type JuliusBrainRecordKind } from './julius-brain-contracts';
import type { JuliusBrainHandle } from './julius-brain-service';
import type { JuliusBrainAppend, JuliusBrainWriter } from './julius-runtime-ports';

/**
 * v1 → v2: THE LIVE PIPELINE'S BRAIN WRITES, MIRRORED INTO THE TYPED LEDGER.
 *
 * The Julius pipeline writes v1 entries (`julius_brain_entries`) and must not
 * be edited while the continuous-worker qualification is live. This bridges
 * without touching it: a decorator around the `JuliusBrainWriter` port that a
 * composition root can wrap the store with. The v1 write happens first and its
 * answer is returned unchanged; the mirror follows, idempotently keyed by the
 * Brain run AND the v1 entry id, so a replayed tick mirrors nothing twice.
 *
 * THE BRAIN RUN IS NOT THE JULIUS RUN. v1 entry ids, task ids and the Julius run
 * id itself are derived from the mission contract, so they repeat across paid
 * attempts of one contract. The Brain run id (for a paid run, its workflow run
 * and attempt) scopes and namespaces every mirrored record; without it attempt
 * 2's entries would be swallowed as duplicates of attempt 1's.
 *
 * A MIRROR FAILURE NEVER FAILS THE MISSION, AND IS NEVER SILENT. It is reported
 * through `onMirror`; `backfillJuliusBrainFromLegacy` re-drives any entry later,
 * under the same keys.
 *
 * THE MAPPING INVENTS NOTHING. v1 entries are prose with a kind, so:
 *   DECISION    → DECISION (VERIFICATION), the v1 text as the statement
 *   HANDOFF     → HANDOFF, classified by the v1 entry id prefix the pipeline
 *                 uses; a role the id does not reveal is recorded as UNKNOWN
 *   OBJECTIVE   → OBJECTIVE;  CONSTRAINT → CONSTRAINT (ACTIVE)
 *   REQUIREMENT → REQUIREMENT (UNCLASSIFIED, ACTIVE)
 *   FINDING, REPAIR, ARTIFACT, EVIDENCE → TRACE
 * The last four have no typed shape in v1 (no severity, no hash, no status),
 * and dressing prose up as a typed finding would claim fields nobody observed.
 */

export function juliusBrainLegacyKey(brainRunId: string, entryId: string): string {
  const plain = `legacy:${brainRunId}:${entryId}`;
  return isJuliusBrainId(plain) ? plain : `legacy:${brainRunId}:h-${juliusBrainSha256(entryId).slice(7, 39)}`;
}

const HANDOFF_PREFIXES: readonly { readonly prefix: string; readonly handoffClass: string; readonly fromRole: string; readonly toRole: string }[] = [
  { prefix: 'brain:guidance-request:', handoffClass: 'OTHER', fromRole: 'CODING_AGENT', toRole: 'PROMPT_ARCHITECT' },
  { prefix: 'brain:guidance-answer:', handoffClass: 'ARCHITECT_TO_CODER', fromRole: 'PROMPT_ARCHITECT', toRole: 'CODING_AGENT' },
  { prefix: 'brain:segment-resume:', handoffClass: 'JULIUS_CONTINUATION', fromRole: 'JULIUS', toRole: 'UNKNOWN' },
  { prefix: 'brain:research-answer:', handoffClass: 'RESEARCH_ANSWER', fromRole: 'JULIUS', toRole: 'UNKNOWN' },
];

const clip = (text: string, max = 8_000): string => (text.length <= max ? text : text.slice(0, max));

export function juliusBrainDraftFromLegacy(input: { readonly append: JuliusBrainAppend; readonly missionId: string | null; readonly brainRunId: string }): JuliusBrainDraft {
  const { append } = input;
  if (!isJuliusBrainId(input.brainRunId)) throw new Error('julius_brain_legacy_run_id_invalid');
  const key = juliusBrainLegacyKey(input.brainRunId, append.entryId);
  let kind: JuliusBrainRecordKind;
  let body: JuliusBrainBody;
  switch (append.kind) {
    case 'DECISION':
      kind = 'DECISION';
      body = { decisionClass: 'VERIFICATION', statement: clip(append.safeText), rationale: `Recorded by the Julius verification runtime as v1 entry ${append.entryId}.`, alternatives: [], status: 'ACTIVE' };
      break;
    case 'HANDOFF': {
      const known = HANDOFF_PREFIXES.find((candidate) => append.entryId.startsWith(candidate.prefix));
      kind = 'HANDOFF';
      body = { handoffClass: known?.handoffClass ?? 'OTHER', fromRole: known?.fromRole ?? 'UNKNOWN', toRole: known?.toRole ?? 'UNKNOWN', summary: clip(append.safeText), openQuestions: [] };
      break;
    }
    case 'OBJECTIVE':
      kind = 'OBJECTIVE';
      body = { statement: clip(append.safeText), successMeasure: null };
      break;
    case 'CONSTRAINT':
      kind = 'CONSTRAINT';
      body = { statement: clip(append.safeText), status: 'ACTIVE' };
      break;
    case 'REQUIREMENT':
      kind = 'REQUIREMENT';
      body = { requirementClass: 'UNCLASSIFIED', statement: clip(append.safeText), priority: null, status: 'ACTIVE' };
      break;
    default:
      kind = 'TRACE';
      body = { traceClass: 'ACTION', summary: clip(append.safeText), facts: { v1Kind: append.kind, v1EntryId: clip(append.entryId, 512), v1RunId: clip(append.runId, 256) } };
  }
  return {
    kind, op: 'CREATE', entityId: key, expectedVersion: 0, body,
    links: [],
    scope: { missionId: input.missionId, runId: input.brainRunId, taskId: append.taskId },
    retention: 'DURABLE', confidence: null, sensitivity: 'INTERNAL',
    provenance: juliusBrainProvenance('run_observed', { externalRef: clip(`julius_brain_entries:${append.runId}#${append.entryId}`, 2_048) }),
    idempotencyKey: key,
    occurredAt: append.occurredAt,
  };
}

export type JuliusBrainMirrorOutcome = 'MIRRORED' | 'DUPLICATE' | 'SKIPPED_NO_BRAIN' | 'REFUSED' | 'FAILED';

export interface JuliusBrainMirrorReport {
  readonly entryId: string;
  readonly v1Written: boolean;
  readonly outcome: JuliusBrainMirrorOutcome;
  readonly detail: string | null;
}

export function createJuliusBrainMirroringWriter(input: {
  readonly inner: JuliusBrainWriter;
  /** The Julius-principal handle for the Brain this run's project uses, and the Brain run it writes as; null when it has none. */
  readonly resolve: (append: JuliusBrainAppend) => Promise<{ readonly handle: JuliusBrainHandle; readonly missionId: string | null; readonly brainRunId: string } | null>;
  readonly onMirror?: (report: JuliusBrainMirrorReport) => void;
}): JuliusBrainWriter {
  return {
    async appendBrainEntry(append) {
      const v1Written = await input.inner.appendBrainEntry(append);
      const report = (outcome: JuliusBrainMirrorOutcome, detail: string | null) => input.onMirror?.({ entryId: append.entryId, v1Written, outcome, detail });
      try {
        const target = await input.resolve(append);
        if (target === null) { report('SKIPPED_NO_BRAIN', null); return v1Written; }
        if (target.handle.principal.kind !== 'JULIUS') throw new Error('julius_brain_mirror_requires_julius_principal');
        const result = await target.handle.commit([juliusBrainDraftFromLegacy({ append, missionId: target.missionId, brainRunId: target.brainRunId })]);
        if (result.outcome === 'REFUSED') report('REFUSED', `${result.reasonCode}: ${result.detail}`);
        else report(result.receipts[0]!.outcome === 'DUPLICATE' ? 'DUPLICATE' : 'MIRRORED', null);
      } catch (error) {
        report('FAILED', error instanceof Error ? error.message.split('\n')[0]!.slice(0, 300) : 'unknown');
      }
      return v1Written;
    },
  };
}

/** Re-drive v1 entries into the ledger under the mirror's own keys. Safe to repeat. */
export async function backfillJuliusBrainFromLegacy(input: {
  readonly handle: JuliusBrainHandle;
  readonly missionId: string | null;
  readonly brainRunId: string;
  readonly entries: readonly JuliusBrainAppend[];
}): Promise<{ readonly mirrored: number; readonly duplicates: number; readonly refused: readonly { readonly entryId: string; readonly reasonCode: string }[] }> {
  let mirrored = 0;
  let duplicates = 0;
  const refused: { entryId: string; reasonCode: string }[] = [];
  // One entry per commit, so a single refusal cannot hold back the rest.
  for (const append of input.entries) {
    const result = await input.handle.commit([juliusBrainDraftFromLegacy({ append, missionId: input.missionId, brainRunId: input.brainRunId })]);
    if (result.outcome === 'REFUSED') refused.push({ entryId: append.entryId, reasonCode: result.reasonCode });
    else if (result.receipts[0]!.outcome === 'DUPLICATE') duplicates += 1;
    else mirrored += 1;
  }
  return { mirrored, duplicates, refused };
}
