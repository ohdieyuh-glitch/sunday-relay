import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MissionView, RelayApp } from './RelayApp';
import {
  setRelayClockForTest,
  setRelayIdFactoryForTest,
  useRelayStore,
} from './state/store';

/**
 * DOM-less render smoke test: every golden-path UI state must render without
 * throwing. NOTE: react-dom/server renders a zustand store's INITIAL state
 * (useSyncExternalStore server snapshot), so stage states are rendered via
 * MissionView with the mission passed explicitly; store actions still build
 * the mission for real.
 */

const implReply = `\`\`\`json relay:implementation-report
{ "agent": "Claude Code (Fable 5)", "summary": "Implemented.", "changedFiles": ["a.ts"] }
\`\`\``;

const reviewReply = `\`\`\`json relay:review
{ "reviewer": "OpenAI Codex", "verdict": "changes-requested",
  "findings": [{ "id": "R1", "severity": "major", "title": "Bug", "detail": "Broken." }] }
\`\`\``;

const repairReply = `\`\`\`json relay:repair-report
{ "agent": "Claude Code (Fable 5)", "summary": "Fixed.",
  "resolvedFindings": [{ "id": "R1", "resolution": "Fixed it." }], "changedFiles": ["a.ts"] }
\`\`\``;

const evidenceReply = `\`\`\`json relay:test-evidence
{ "entries": [{ "command": "npx vitest run", "status": "pass", "output": "green" }] }
\`\`\``;

let tick = 0;

beforeEach(() => {
  tick = 0;
  setRelayClockForTest(() => `2026-07-21T12:00:${String(tick++).padStart(2, '0')}.000Z`);
  setRelayIdFactoryForTest(() => 'm-render');
  useRelayStore.setState({ missions: [], activeMissionId: null });
});

afterEach(() => {
  setRelayClockForTest(null);
  setRelayIdFactoryForTest(null);
});

function createFixtureMission(title: string): string {
  const created = useRelayStore.getState().createMission({
    title,
    objective: 'Render every stage.',
    acceptanceCriteria: ['renders'],
  });
  if (!created.ok) throw new Error('create failed');
  return created.value;
}

function renderMission(id: string): string {
  const mission = useRelayStore.getState().missions.find((m) => m.id === id);
  if (!mission) throw new Error('mission missing');
  return renderToStaticMarkup(createElement(MissionView, { mission }));
}

describe('relay UI renders every golden-path state', () => {
  it('empty app state shows the mission form', () => {
    const html = renderToStaticMarkup(createElement(RelayApp));
    expect(html).toContain('SUNDAY RELAY');
    expect(html).toContain('New mission');
    expect(html).toContain('Acceptance criteria');
  });

  it('renders each stage of a full mission without throwing', () => {
    const id = createFixtureMission('Render fixture');

    expect(renderMission(id)).toContain('Generate implementer handoff');

    useRelayStore.getState().generateHandoff(id);
    expect(renderMission(id)).toContain('Implementer handoff');

    useRelayStore.getState().ingestImplementationReport(id, implReply);
    const reviewStage = renderMission(id);
    expect(reviewStage).toContain('Implementation report');
    expect(reviewStage).toContain('Generate review brief');

    useRelayStore.getState().ingestReview(id, reviewReply);
    const repairTaskStage = renderMission(id);
    expect(repairTaskStage).toContain('Independent review');
    expect(repairTaskStage).toContain('Generate repair task');

    useRelayStore.getState().generateRepairTask(id);
    expect(renderMission(id)).toContain('Repair task');

    useRelayStore.getState().ingestRepairReport(id, repairReply);
    const evidenceStage = renderMission(id);
    expect(evidenceStage).toContain('Resolved: Fixed it.');
    expect(evidenceStage).toContain('Test evidence');

    useRelayStore.getState().ingestEvidence(id, evidenceReply);
    const gateStage = renderMission(id);
    expect(gateStage).toContain('Verification gate');
    expect(gateStage).toContain('Seal mission as verified');

    useRelayStore.getState().markVerified(id);
    const done = renderMission(id);
    expect(done).toContain('verified complete');
    expect(done).toContain('immutable');
  });

  it('renders the failing-gate state honestly (gate closed, seal disabled)', () => {
    const id = createFixtureMission('Self-review fixture');
    useRelayStore.getState().generateHandoff(id);
    useRelayStore.getState().ingestImplementationReport(id, implReply);
    useRelayStore.getState().ingestReview(
      id,
      `\`\`\`json relay:review
{ "reviewer": "Claude Code (Fable 5)", "verdict": "approved", "findings": [] }
\`\`\``,
    );
    useRelayStore.getState().ingestEvidence(id, evidenceReply);
    const html = renderMission(id);
    expect(html).toContain('self-review');
    expect(html).toContain('Gate closed');
    expect(html).toContain('disabled');
  });
});
