import { mkdtempSync, rmSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os'; import { describe, expect, it } from 'vitest';
import { createPresenceScheduler } from './presence-scheduler'; import { WonderlandService } from './service'; import { createFileWonderlandStore } from './store';

describe('durable presence lifecycle scheduler', () => {
  it('expires stale sessions once, clears challenge availability, and remains stable after restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'wonderland-presence-')); const path = join(root, 'state.json'); let clock = Date.parse('2026-08-24T12:00:00.000Z'); let ids = 0;
    try {
      const first = new WonderlandService(createFileWonderlandStore(path), { now: () => new Date(clock).toISOString(), id: (kind) => `${kind}_${++ids}` }); const session = first.joinPresence('join', { playerId: 'player', relayDogId: 'dog', worldId: 'world', instanceId: 'one', ttlMs: 1_000, projectId: 'project' });
      clock += 2_000; const restarted = new WonderlandService(createFileWonderlandStore(path), { now: () => new Date(clock).toISOString(), id: (kind) => `${kind}_${++ids}` }); const scheduler = createPresenceScheduler(restarted, { intervalMs: 60_000, now: () => clock });
      expect(scheduler.runNow()).toEqual([session.id]); expect(scheduler.runNow()).toEqual([]); scheduler.stop(); expect(scheduler.isRunning()).toBe(false);
      const state = restarted.state(); expect(state.presence[session.id]).toMatchObject({ connected: false, challengeAvailable: false, projectId: 'project' }); expect(state.events.filter((event) => event.eventType === 'presence.left')).toHaveLength(1);
      const secondRestart = new WonderlandService(createFileWonderlandStore(path), { now: () => new Date(clock).toISOString() }); expect(secondRestart.expirePresence('after-restart')).toEqual([]); expect(secondRestart.state().events.filter((event) => event.eventType === 'presence.left')).toHaveLength(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
