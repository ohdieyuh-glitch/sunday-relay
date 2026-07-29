import { describe, expect, it } from 'vitest';

import {
  createCommandEvent,
  redactCommandMetadata,
  RELAY_MISSION_COMMAND_EVENT_TYPES,
} from './command-events';

const baseEvent = {
  eventId: 'cmd-1-ev-0',
  commandId: 'cmd-1',
  projectId: 'project-sunday',
  missionId: 'mission-auth',
  missionRevision: 3,
  sequence: 0,
  eventType: 'command_received' as const,
  actorId: 'user-founder',
  occurredAt: '2026-07-28T12:00:00.000Z',
};

describe('command events', () => {
  it('exposes every canonical event type', () => {
    expect(RELAY_MISSION_COMMAND_EVENT_TYPES).toEqual([
      'command_received', 'command_interpreted', 'command_clarification_required',
      'command_validation_required', 'command_validated', 'command_rejected',
      'checkpoint_required', 'checkpoint_satisfied', 'checkpoint_failed',
      'approval_required', 'approval_received', 'command_execution_started',
      'state_change_applied', 'command_executed', 'command_failed',
    ]);
  });

  it('events are frozen at creation — mutation throws and changes nothing', () => {
    const event = createCommandEvent({ ...baseEvent, metadata: { note: 'hello' } });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.metadata)).toBe(true);
    expect(() => {
      (event as { actorId: string }).actorId = 'intruder';
    }).toThrow();
    expect(event.actorId).toBe('user-founder');
  });

  it('carries mission revision, command linkage, and sequence', () => {
    const event = createCommandEvent(baseEvent);
    expect(event.missionRevision).toBe(3);
    expect(event.commandId).toBe('cmd-1');
    expect(event.sequence).toBe(0);
  });

  it('redacts secret-named keys wholesale and secret-shaped values in strings', () => {
    const metadata = {
      apiKey: 'sk-abcdef0123456789',
      nested: { GITHUB_TOKEN: 'ghp_abcdef', fine: 'plain value' },
      note: 'password: hunter2secret and more',
      list: ['token=abcdef123456', 'harmless'],
    };
    const redacted = redactCommandMetadata(metadata) as {
      apiKey: string;
      nested: { GITHUB_TOKEN: string; fine: string };
      note: string;
      list: string[];
    };
    expect(redacted.apiKey).toBe('[redacted]');
    expect(redacted.nested.GITHUB_TOKEN).toBe('[redacted]');
    expect(redacted.nested.fine).toBe('plain value');
    expect(redacted.note).not.toContain('hunter2secret');
    expect(redacted.list[0]).not.toContain('abcdef123456');
    expect(redacted.list[1]).toBe('harmless');
  });

  it('never mutates the metadata input object', () => {
    const metadata = { apiKey: 'sk-abcdef0123456789', nested: { value: 'x' } };
    const snapshot = JSON.stringify(metadata);
    createCommandEvent({ ...baseEvent, metadata });
    expect(JSON.stringify(metadata)).toBe(snapshot);
  });
});
