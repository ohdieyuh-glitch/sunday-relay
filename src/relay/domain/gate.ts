import type { RelayMission, VerificationCheck } from './types';
import { reviewRequiresRepair } from './stages';

/**
 * The verification gate — "verified complete" is COMPUTED, never asserted.
 * Every check is derivable from the mission record alone; the store refuses
 * to mark a mission verified while any check fails.
 */

export interface GateResult {
  ok: boolean;
  checks: VerificationCheck[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function verifyMission(mission: RelayMission): GateResult {
  const checks: VerificationCheck[] = [];
  const impl = mission.implementationReport;
  const review = mission.review;
  const repair = mission.repairReport;
  const evidence = mission.evidence;

  checks.push({
    id: 'implementation-report',
    label: 'Implementation report received',
    ok: Boolean(impl),
    detail: impl ? `From ${impl.agent} at ${impl.receivedAt}.` : 'No implementation report ingested.',
  });

  checks.push({
    id: 'independent-review',
    label: 'Independent review received',
    ok: Boolean(review),
    detail: review
      ? `${review.reviewer} — ${review.verdict}, ${review.findings.length} finding(s).`
      : 'No review ingested.',
  });

  // Independence is structural, not cosmetic: the reviewer identity must
  // differ from the implementer identity or the "independent review" stage
  // never happened.
  if (impl && review) {
    const independent = norm(review.reviewer) !== norm(impl.agent);
    checks.push({
      id: 'reviewer-independent',
      label: 'Reviewer is independent of the implementer',
      ok: independent,
      detail: independent
        ? `Implementer "${impl.agent}" ≠ reviewer "${review.reviewer}".`
        : `Reviewer and implementer are the same agent ("${review.reviewer}") — that is a self-review, not an independent review.`,
    });
  }

  const needsRepair = review ? reviewRequiresRepair(review) : false;

  if (review && needsRepair) {
    checks.push({
      id: 'repair-report',
      label: 'Repair completion received',
      ok: Boolean(repair),
      detail: repair
        ? `From ${repair.agent} at ${repair.receivedAt}.`
        : 'Review requested changes but no repair report was ingested.',
    });

    // R2 backstop: changes-requested with nothing enumerated is unrepairable —
    // a vacuous repair must never outweigh the reviewer's standing objection.
    // (Ingestion rejects such reviews; this guards artifacts from other paths.)
    if (review.findings.length === 0) {
      checks.push({
        id: 'findings-resolved',
        label: 'Every review finding resolved',
        ok: false,
        detail:
          'Review verdict is changes-requested but no findings are enumerated — nothing concrete was repaired. A fresh review is required.',
      });
      checks.push({
        id: 'evidence-present',
        label: 'Test evidence recorded',
        ok: Boolean(evidence && evidence.entries.length > 0),
        detail: evidence ? `${evidence.entries.length} command run(s).` : 'No test evidence ingested.',
      });
      return { ok: false, checks };
    }

    const resolvedIds = new Set((repair?.resolvedFindings ?? []).map((r) => r.id));
    const findingIds = new Set(review.findings.map((f) => f.id));
    const unresolved = review.findings.filter((f) => !resolvedIds.has(f.id)).map((f) => f.id);
    const unknown = [...resolvedIds].filter((id) => !findingIds.has(id));
    const ok = Boolean(repair) && unresolved.length === 0 && unknown.length === 0;
    const detailParts: string[] = [];
    if (unresolved.length > 0) detailParts.push(`Unresolved finding(s): ${unresolved.join(', ')}.`);
    if (unknown.length > 0) {
      detailParts.push(`Resolution(s) reference unknown finding id(s): ${unknown.join(', ')}.`);
    }
    checks.push({
      id: 'findings-resolved',
      label: 'Every review finding resolved',
      ok,
      detail: ok
        ? `All ${review.findings.length} finding(s) resolved by id.`
        : detailParts.join(' ') || 'No repair report to resolve findings.',
    });
  } else if (review && !needsRepair) {
    checks.push({
      id: 'findings-resolved',
      label: 'Every review finding resolved',
      ok: true,
      detail: 'Clean approval with zero findings — repair not required.',
    });
  }

  checks.push({
    id: 'evidence-present',
    label: 'Test evidence recorded',
    ok: Boolean(evidence && evidence.entries.length > 0),
    detail: evidence
      ? `${evidence.entries.length} command run(s).`
      : 'No test evidence ingested.',
  });

  if (evidence && evidence.entries.length > 0) {
    const failing = evidence.entries.filter((e) => e.status !== 'pass');
    checks.push({
      id: 'evidence-green',
      label: 'All evidence commands passed',
      ok: failing.length === 0,
      detail:
        failing.length === 0
          ? evidence.entries.map((e) => e.command).join(' · ')
          : `Failing: ${failing.map((e) => e.command).join(', ')}.`,
    });

    // Evidence must postdate the last code change it claims to verify.
    // ISO-8601 UTC strings compare correctly as strings.
    const baseline = needsRepair ? repair?.receivedAt : impl?.receivedAt;
    if (baseline) {
      const fresh = evidence.receivedAt >= baseline;
      checks.push({
        id: 'evidence-fresh',
        label: 'Evidence postdates the last change',
        ok: fresh,
        detail: fresh
          ? `Evidence ${evidence.receivedAt} ≥ last change ${baseline}.`
          : `Evidence ${evidence.receivedAt} was recorded BEFORE the last change ${baseline} — rerun verification.`,
      });
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}
