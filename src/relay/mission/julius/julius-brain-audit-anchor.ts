import { canonicalJuliusBrainJson, juliusBrainSha256 } from './julius-brain-contracts';
import type { JuliusBrainAuditEvent, JuliusBrainServiceEnvironment } from './julius-brain-access';

/**
 * ANCHORING THE AUDIT WHERE THE DATABASE CANNOT REACH IT.
 *
 * The access audit is a hash chain inside the Brain's own database. That
 * exposes a rewrite — as long as the reader has something to compare against.
 * Whoever owns the database can disable a trigger, rewrite an entry and rebuild
 * the chain from there, or restore an older snapshot; the chain alone then looks
 * perfect. So the head is published, periodically, somewhere the database owner
 * does not control:
 *
 *   audit head  ──▶  anchor (a few numbers and digests)  ──▶  external sink
 *
 * AN ANCHOR CARRIES NO MISSION CONTENT: the environment, its own sequence, the
 * Brain's head, the audit head's sequence and hash, a timestamp, and the digest
 * of the anchor before it. No record, no token, no session, no identifier of any
 * person. That is what makes it safe to keep with a third party.
 *
 * The anchors chain too, so a sink that loses or reorders them is detected, not
 * only a database that was rewritten.
 *
 * WHAT A FAILING SINK MEANS, STATED RATHER THAN INVENTED:
 *   - The service keeps serving. Anchoring is verification, not admission
 *     control: refusing Brain writes because a third party is down would trade a
 *     detection property for an availability one.
 *   - Preservation is unaffected. It is derived from the Brain's own records.
 *   - The verifiable window stops advancing: everything after the last anchor is
 *     verifiable only by the in-database chain, which an owner could rebuild.
 *     That is an operational alert, and how long it may last is a deployment
 *     decision recorded in the evaluation matrix (B9), not a default invented
 *     here.
 */

export const JULIUS_BRAIN_ANCHOR_FORMAT = 'julius-brain-audit-anchor.v1' as const;

export interface JuliusBrainAuditAnchorBody {
  readonly format: typeof JULIUS_BRAIN_ANCHOR_FORMAT;
  readonly environment: JuliusBrainServiceEnvironment;
  readonly anchorSequence: number;
  /** The Brain ledger's head when the anchor was taken, or null when it could not be read. */
  readonly brainHead: { readonly sequence: number; readonly chainHash: string } | null;
  readonly auditHead: { readonly sequence: number; readonly hash: string };
  readonly at: string;
  readonly previousAnchorDigest: string | null;
}
export interface JuliusBrainAuditAnchor extends JuliusBrainAuditAnchorBody { readonly digest: string }

/** The fields an anchor may carry. Anything else would be content leaving the system. */
export const JULIUS_BRAIN_ANCHOR_FIELDS: readonly string[] = ['format', 'environment', 'anchorSequence', 'brainHead', 'auditHead', 'at', 'previousAnchorDigest', 'digest'];

export const digestJuliusBrainAuditAnchor = (body: JuliusBrainAuditAnchorBody): string => juliusBrainSha256(canonicalJuliusBrainJson(body));

/** Where anchors are kept: append-only, outside the Brain database. */
export interface JuliusBrainAnchorSink {
  append(anchor: JuliusBrainAuditAnchor): Promise<void>;
  /** Every anchor the sink holds, oldest first. */
  read(): Promise<readonly JuliusBrainAuditAnchor[]>;
}

export function createJuliusBrainAnchorMemorySink(): JuliusBrainAnchorSink & { readonly anchors: JuliusBrainAuditAnchor[] } {
  const anchors: JuliusBrainAuditAnchor[] = [];
  return { anchors, async append(anchor) { anchors.push(anchor); }, async read() { return [...anchors]; } };
}

export type JuliusBrainAnchorOutcome =
  | { readonly outcome: 'ANCHORED'; readonly anchor: JuliusBrainAuditAnchor }
  | { readonly outcome: 'UNCHANGED'; readonly anchor: JuliusBrainAuditAnchor }
  | { readonly outcome: 'NOTHING_TO_ANCHOR' }
  | { readonly outcome: 'SINK_UNAVAILABLE'; readonly detail: string; readonly pending: JuliusBrainAuditAnchor | null }
  | { readonly outcome: 'AUDIT_UNREADABLE'; readonly detail: string };

export function createJuliusBrainAuditAnchorer(deps: {
  readonly environment: JuliusBrainServiceEnvironment;
  readonly auditHead: () => Promise<{ readonly sequence: number; readonly hash: string } | null>;
  readonly brainHead: () => Promise<{ readonly sequence: number; readonly chainHash: string } | null>;
  readonly sink: JuliusBrainAnchorSink;
  readonly clock: { now(): string };
}) {
  return {
    /** Publish the current head, unless it is already the newest anchor's. */
    async anchor(): Promise<JuliusBrainAnchorOutcome> {
      const firstLine = (error: unknown) => (error instanceof Error ? error.message.split('\n')[0]!.slice(0, 200) : 'unknown');
      let auditHead: { sequence: number; hash: string } | null;
      try { auditHead = await deps.auditHead(); } catch (error) { return { outcome: 'AUDIT_UNREADABLE', detail: firstLine(error) }; }
      if (auditHead === null) return { outcome: 'NOTHING_TO_ANCHOR' };
      let held: readonly JuliusBrainAuditAnchor[];
      try { held = await deps.sink.read(); } catch (error) { return { outcome: 'SINK_UNAVAILABLE', detail: firstLine(error), pending: null }; }
      const previous = held.at(-1) ?? null;
      if (previous !== null && previous.auditHead.sequence === auditHead.sequence && previous.auditHead.hash === auditHead.hash) return { outcome: 'UNCHANGED', anchor: previous };
      // The Brain's head is context, never a reason to refuse an anchor.
      let brainHead: { sequence: number; chainHash: string } | null = null;
      try { brainHead = await deps.brainHead(); } catch { brainHead = null; }
      const body: JuliusBrainAuditAnchorBody = {
        format: JULIUS_BRAIN_ANCHOR_FORMAT, environment: deps.environment, anchorSequence: (previous?.anchorSequence ?? 0) + 1,
        brainHead, auditHead, at: deps.clock.now(), previousAnchorDigest: previous?.digest ?? null,
      };
      const anchor: JuliusBrainAuditAnchor = { ...body, digest: digestJuliusBrainAuditAnchor(body) };
      try { await deps.sink.append(anchor); } catch (error) { return { outcome: 'SINK_UNAVAILABLE', detail: firstLine(error), pending: anchor }; }
      return { outcome: 'ANCHORED', anchor };
    },
  };
}

export interface JuliusBrainAnchorVerification {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** The newest audit sequence an anchor vouches for, or 0 when none does. */
  readonly verifiedThrough: number;
  readonly anchors: number;
}

/**
 * The audit as the database now tells it, against the anchors kept outside it.
 * Catches a rewritten entry, a rolled-back database, and an anchor record that
 * is itself missing, reordered or altered.
 */
export function verifyJuliusBrainAuditAgainstAnchors(input: {
  readonly events: readonly JuliusBrainAuditEvent[];
  readonly anchors: readonly JuliusBrainAuditAnchor[];
  readonly environment?: JuliusBrainServiceEnvironment;
}): JuliusBrainAnchorVerification {
  const problems: string[] = [];
  const byAuditSequence = new Map(input.events.map((event) => [event.sequence, event]));
  let verifiedThrough = 0;
  let previous: JuliusBrainAuditAnchor | null = null;

  for (const anchor of input.anchors) {
    const expectedSequence = (previous?.anchorSequence ?? 0) + 1;
    if (anchor.format !== JULIUS_BRAIN_ANCHOR_FORMAT) { problems.push(`anchor ${anchor.anchorSequence}: not ${JULIUS_BRAIN_ANCHOR_FORMAT}`); break; }
    if (input.environment !== undefined && anchor.environment !== input.environment) { problems.push(`anchor ${anchor.anchorSequence}: anchored a ${anchor.environment} service, not ${input.environment}`); break; }
    if (anchor.anchorSequence !== expectedSequence) { problems.push(`anchor ${anchor.anchorSequence}: out of sequence (expected ${expectedSequence})`); break; }
    if ((anchor.previousAnchorDigest ?? null) !== (previous?.digest ?? null)) { problems.push(`anchor ${anchor.anchorSequence}: does not follow anchor ${expectedSequence - 1}`); break; }
    const { digest, ...body } = anchor;
    if (digest !== digestJuliusBrainAuditAnchor(body)) { problems.push(`anchor ${anchor.anchorSequence}: its content does not match its digest`); break; }
    if (previous !== null && anchor.auditHead.sequence < previous.auditHead.sequence) { problems.push(`anchor ${anchor.anchorSequence}: anchors audit ${anchor.auditHead.sequence}, behind anchor ${previous.anchorSequence}'s ${previous.auditHead.sequence}`); break; }

    const event = byAuditSequence.get(anchor.auditHead.sequence);
    if (event === undefined) {
      problems.push(`audit ${anchor.auditHead.sequence}: anchored at ${anchor.at} but absent now (the database is behind its anchors)`);
    } else if (event.hash !== anchor.auditHead.hash) {
      problems.push(`audit ${anchor.auditHead.sequence}: does not match the anchor taken at ${anchor.at} (the audit was rewritten)`);
    } else {
      verifiedThrough = Math.max(verifiedThrough, anchor.auditHead.sequence);
    }
    previous = anchor;
  }
  return { ok: problems.length === 0, problems, verifiedThrough, anchors: input.anchors.length };
}
