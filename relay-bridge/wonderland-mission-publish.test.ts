import { describe, expect, it } from 'vitest'; import { createMissionRegistry } from './mission'; import { createMemoryWonderlandStore, RelayWonderlandPublisher, WonderlandService } from '../src/relay/wonderland';

describe('automatic Relay to Wonderland publication', () => {
  it('publishes authoritative registry mutations without a polling or manual publisher call', async () => {
    let id = 0; const wonderland = new WonderlandService(createMemoryWonderlandStore(), { id: (kind) => `${kind}_${++id}`, now: () => '2026-08-24T12:00:00.000Z' }); const publisher = new RelayWonderlandPublisher(wonderland);
    const registry = createMissionRegistry({ fusionBaseUrl: 'http://localhost:3000', sundayMode: 'fast', claudeMode: 'live', confirmLive: true, architectEnv: {}, now: () => '2026-08-24T12:00:00.000Z', onUpdate: (missionId, view, context) => publisher.publishMission(context.projectId, missionId, view, context.playerId ?? undefined) });
    registry.start({ missionId: 'mission-live', objective: 'Run the real Relay lifecycle', startedBy: 'user-a' }); await new Promise<void>((resolve) => setTimeout(resolve, 25));
    const events = wonderland.state().events; expect(events.some((event) => event.eventType === 'mission.started')).toBe(true); expect(events.some((event) => event.eventType === 'mission.stage_changed' || event.eventType === 'verification.failed')).toBe(true); expect(events.every((event, index) => index === 0 || event.sequence > events[index - 1].sequence)).toBe(true);
  });
});
