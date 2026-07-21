import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setRelayClockForTest,
  setRelayIdFactoryForTest,
  useRelayStore,
  RELAY_STORAGE_KEY,
} from './store';
import { currentStage } from '../domain/stages';

const implReply = `\`\`\`json relay:implementation-report
{
  "agent": "Claude Code (Fable 5)",
  "summary": "Implemented the banner.",
  "changedFiles": ["src/components/SpendCapBanner.tsx"]
}
\`\`\``;

const reviewReply = `\`\`\`json relay:review
{
  "reviewer": "OpenAI Codex",
  "verdict": "changes-requested",
  "findings": [
    { "id": "R1", "severity": "major", "title": "Unconditional render", "detail": "Shown to signed-in users." }
  ]
}
\`\`\``;

const repairReply = `\`\`\`json relay:repair-report
{
  "agent": "Claude Code (Fable 5)",
  "summary": "Gated on anonymous session.",
  "resolvedFindings": [{ "id": "R1", "resolution": "Session check added." }],
  "changedFiles": ["src/components/SpendCapBanner.tsx"]
}
\`\`\``;

const evidenceReply = `\`\`\`json relay:test-evidence
{
  "entries": [
    { "command": "npm run typecheck", "status": "pass", "output": "clean" },
    { "command": "npx vitest run", "status": "pass", "output": "all green" }
  ]
}
\`\`\``;

const draft = {
  title: 'Spend banner',
  objective: 'Ship the anonymous spend banner.',
  acceptanceCriteria: ['banner gated on anon'],
};

let tick = 0;

beforeEach(() => {
  tick = 0;
  setRelayClockForTest(() => `2026-07-21T10:00:${String(tick++).padStart(2, '0')}.000Z`);
  setRelayIdFactoryForTest(() => `m-${tick}`);
  useRelayStore.setState({ missions: [], activeMissionId: null });
});

afterEach(() => {
  setRelayClockForTest(null);
  setRelayIdFactoryForTest(null);
});

function activeMission() {
  const s = useRelayStore.getState();
  const m = s.missions.find((x) => x.id === s.activeMissionId);
  if (!m) throw new Error('no active mission');
  return m;
}

describe('relay store — golden path', () => {
  it('walks mission → verified with real store actions and a growing ledger', () => {
    const store = useRelayStore.getState();
    const created = store.createMission(draft);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.value;

    // Premature verification is refused with the failing checks as errors.
    const early = useRelayStore.getState().markVerified(id);
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.errors.join('\n')).toContain('Implementation report');

    expect(useRelayStore.getState().generateHandoff(id).ok).toBe(true);
    expect(currentStage(activeMission())).toBe('implementation');

    expect(useRelayStore.getState().ingestImplementationReport(id, implReply).ok).toBe(true);
    expect(useRelayStore.getState().generateReviewBrief(id).ok).toBe(true);
    expect(useRelayStore.getState().ingestReview(id, reviewReply).ok).toBe(true);
    expect(currentStage(activeMission())).toBe('repair-task');

    expect(useRelayStore.getState().generateRepairTask(id).ok).toBe(true);
    expect(activeMission().repairTask?.findingIds).toEqual(['R1']);
    expect(useRelayStore.getState().ingestRepairReport(id, repairReply).ok).toBe(true);
    expect(useRelayStore.getState().ingestEvidence(id, evidenceReply).ok).toBe(true);

    const verified = useRelayStore.getState().markVerified(id);
    expect(verified).toEqual({ ok: true, value: null });
    const m = activeMission();
    expect(m.verification?.ok).toBe(true);
    expect(m.verification?.checks.length).toBeGreaterThanOrEqual(8);
    expect(currentStage(m)).toBe('verified');
    // mission + handoff + impl + review-brief + review + repair-task + repair + evidence + verified
    expect(m.ledger).toHaveLength(9);
    expect(m.ledger.at(-1)?.summary).toContain('verified complete');

    // Verified missions are immutable.
    const frozen = useRelayStore.getState().ingestEvidence(id, evidenceReply);
    expect(frozen.ok).toBe(false);
    if (!frozen.ok) expect(frozen.errors[0]).toContain('immutable');
  });

  it('enforces golden-path order and artifact freezing', () => {
    const store = useRelayStore.getState();
    const created = store.createMission(draft);
    if (!created.ok) throw new Error('create failed');
    const id = created.value;

    expect(useRelayStore.getState().ingestImplementationReport(id, implReply).ok).toBe(false);
    expect(useRelayStore.getState().ingestReview(id, reviewReply).ok).toBe(false);
    expect(useRelayStore.getState().generateRepairTask(id).ok).toBe(false);
    expect(useRelayStore.getState().ingestEvidence(id, evidenceReply).ok).toBe(false);

    expect(useRelayStore.getState().generateHandoff(id).ok).toBe(true);
    expect(useRelayStore.getState().generateHandoff(id).ok).toBe(false); // no double handoff

    // Re-paste at the frontier is allowed (corrected report before review).
    expect(useRelayStore.getState().ingestImplementationReport(id, implReply).ok).toBe(true);
    expect(useRelayStore.getState().ingestImplementationReport(id, implReply).ok).toBe(true);

    expect(useRelayStore.getState().ingestReview(id, reviewReply).ok).toBe(true);
    // Frozen once downstream exists.
    const frozen = useRelayStore.getState().ingestImplementationReport(id, implReply);
    expect(frozen.ok).toBe(false);
  });

  it('parse failures surface operator-readable errors and change nothing', () => {
    const store = useRelayStore.getState();
    const created = store.createMission(draft);
    if (!created.ok) throw new Error('create failed');
    const id = created.value;
    useRelayStore.getState().generateHandoff(id);

    const bad = useRelayStore.getState().ingestImplementationReport(id, 'not a report');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain('relay:implementation-report');
    expect(activeMission().implementationReport).toBeUndefined();
    expect(activeMission().ledger).toHaveLength(2); // mission + handoff only
  });
});

describe('relay store — persistence isolation', () => {
  it('persists under sunday.relay.v1 via localStorage when available', async () => {
    const written = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => written.get(k) ?? null,
      setItem: (k: string, v: string) => void written.set(k, v),
      removeItem: (k: string) => void written.delete(k),
      clear: () => written.clear(),
      key: () => null,
      length: 0,
    });
    vi.resetModules();
    try {
      const fresh = await import('./store');
      const created = fresh.useRelayStore.getState().createMission(draft);
      expect(created.ok).toBe(true);
      expect([...written.keys()]).toEqual([RELAY_STORAGE_KEY]);
      const stored = JSON.parse(written.get(RELAY_STORAGE_KEY)!);
      expect(stored.state.missions).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });
});
