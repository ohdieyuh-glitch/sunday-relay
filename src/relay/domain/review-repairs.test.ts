import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractLabeledJson, parseImplementationReport, parseReview } from './ingest';
import { verifyMission } from './gate';
import { createMission } from './stages';
import {
  setRelayClockForTest,
  setRelayIdFactoryForTest,
  useRelayStore,
} from '../state/store';
import type { RelayMission } from './types';

/**
 * Regression tests for the independent adversarial review of the gate/domain
 * layer (recorded mission m-relay-gate-001, findings R2–R6; R1 was fixed in
 * the render-test restructure). Each test reproduces the reviewer's probe.
 */

const T = (h: number) => `2026-07-21T${String(h).padStart(2, '0')}:00:00.000Z`;

let tick = 0;

beforeEach(() => {
  tick = 0;
  setRelayClockForTest(() => `2026-07-21T14:00:${String(tick++).padStart(2, '0')}.000Z`);
  setRelayIdFactoryForTest(() => `m-${tick}`);
  useRelayStore.setState({ missions: [], activeMissionId: null });
});

afterEach(() => {
  setRelayClockForTest(null);
  setRelayIdFactoryForTest(null);
});

describe('R2 — changes-requested with zero findings cannot reach verified', () => {
  it('ingestion rejects a changes-requested review with an empty findings list', () => {
    const result = parseReview(
      JSON.stringify({ reviewer: 'OpenAI Codex', verdict: 'changes-requested', findings: [] }),
      T(11),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('at least one finding');
  });

  it('gate backstop fails such a review even if it entered via another path', () => {
    const created = createMission(
      { title: 'R2', objective: 'o', acceptanceCriteria: ['a'] },
      { id: 'm-r2', at: T(9) },
    );
    if (!created.ok) throw new Error('fixture');
    const mission: RelayMission = {
      ...created.value,
      implementationReport: { receivedAt: T(10), agent: 'A', summary: 's', changedFiles: [] },
      review: { receivedAt: T(11), reviewer: 'B', verdict: 'changes-requested', findings: [] },
      repairReport: {
        receivedAt: T(12),
        agent: 'A',
        summary: 'vacuous',
        resolvedFindings: [],
        changedFiles: [],
      },
      evidence: {
        receivedAt: T(13),
        entries: [{ command: 'npx vitest run', status: 'pass', output: 'green' }],
      },
    };
    const gate = verifyMission(mission);
    expect(gate.ok).toBe(false);
    const check = gate.checks.find((c) => c.id === 'findings-resolved');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('no findings are enumerated');
  });
});

describe('R3 — addMission cannot inject or overwrite verified state', () => {
  const base = () => {
    const created = createMission(
      { title: 'Seed', objective: 'o', acceptanceCriteria: ['a'] },
      { id: 'm-seed', at: T(9) },
    );
    if (!created.ok) throw new Error('fixture');
    return created.value;
  };

  it('refuses a fabricated verification record the gate does not reproduce', () => {
    const fabricated: RelayMission = {
      ...base(),
      verification: { at: T(10), ok: true, checks: [] },
    };
    const result = useRelayStore.getState().addMission(fabricated);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('does not reproduce');
    expect(useRelayStore.getState().missions).toHaveLength(0);
  });

  it('refuses to overwrite an existing verified mission and forces the recorded badge', () => {
    const added = useRelayStore.getState().addMission(base());
    expect(added.ok).toBe(true);
    const stored = useRelayStore.getState().missions[0];
    expect(stored.recorded).toBe(true);

    // Manually seal it in state, then try to replace it.
    useRelayStore.setState((s) => ({
      missions: s.missions.map((m) =>
        m.id === 'm-seed' ? { ...m, verification: { at: T(11), ok: true as const, checks: [] } } : m,
      ),
    }));
    const overwrite = useRelayStore.getState().addMission(base());
    expect(overwrite.ok).toBe(false);
    if (!overwrite.ok) expect(overwrite.errors[0]).toContain('immutable');
  });
});

describe('R4 — a lone block labeled for a different artifact is rejected', () => {
  it('does not misfile a repair-report block as an implementation report', () => {
    const repairText = `\`\`\`json relay:repair-report
{ "agent": "A", "summary": "s", "resolvedFindings": [], "changedFiles": [] }
\`\`\``;
    const result = parseImplementationReport(repairText, T(10));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toContain('relay:repair-report');
      expect(result.errors[0]).toContain('relay:implementation-report');
    }
  });

  it('still accepts a genuinely unlabeled single block', () => {
    const result = extractLabeledJson('```json\n{"a":1}\n```', 'review');
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe('R5 — review brief is not a custody event and cannot be re-generated', () => {
  it('logs under review-brief and guards duplicates', () => {
    const s = useRelayStore.getState();
    const created = s.createMission({ title: 'R5', objective: 'o', acceptanceCriteria: ['a'] });
    if (!created.ok) throw new Error('create failed');
    const id = created.value;
    useRelayStore.getState().generateHandoff(id);
    useRelayStore.getState().ingestImplementationReport(
      id,
      `\`\`\`json relay:implementation-report
{ "agent": "A", "summary": "s", "changedFiles": [] }
\`\`\``,
    );
    expect(useRelayStore.getState().generateReviewBrief(id).ok).toBe(true);
    const mission = useRelayStore.getState().missions.find((m) => m.id === id)!;
    expect(mission.ledger.at(-1)?.stage).toBe('review-brief');
    expect(mission.ledger.filter((e) => e.stage === 'review').length).toBe(0);

    const again = useRelayStore.getState().generateReviewBrief(id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.errors[0]).toContain('already generated');
  });
});

describe('R6 — artifacts carry the mission id and mismatches are refused', () => {
  it('briefs stamp the real mission id into every response example', async () => {
    const { generateImplementerHandoff } = await import('./briefs');
    const created = createMission(
      { title: 'R6', objective: 'o', acceptanceCriteria: ['a'] },
      { id: 'm-r6-real', at: T(9) },
    );
    if (!created.ok) throw new Error('fixture');
    const handoff = generateImplementerHandoff(created.value, T(9));
    expect(handoff.markdown).toContain('"missionId": "m-r6-real"');
  });

  it('rejects an artifact stamped for another mission', () => {
    const s = useRelayStore.getState();
    const created = s.createMission({ title: 'R6', objective: 'o', acceptanceCriteria: ['a'] });
    if (!created.ok) throw new Error('create failed');
    const id = created.value;
    useRelayStore.getState().generateHandoff(id);
    const foreign = `\`\`\`json relay:implementation-report
{ "missionId": "m-other", "agent": "A", "summary": "s", "changedFiles": [] }
\`\`\``;
    const result = useRelayStore.getState().ingestImplementationReport(id, foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('m-other');
  });

  it('tolerates artifacts without a mission id', () => {
    const s = useRelayStore.getState();
    const created = s.createMission({ title: 'R6b', objective: 'o', acceptanceCriteria: ['a'] });
    if (!created.ok) throw new Error('create failed');
    const id = created.value;
    useRelayStore.getState().generateHandoff(id);
    const result = useRelayStore.getState().ingestImplementationReport(
      id,
      `\`\`\`json relay:implementation-report
{ "agent": "A", "summary": "s", "changedFiles": [] }
\`\`\``,
    );
    expect(result.ok).toBe(true);
  });
});
