import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import {
  JULIUS_REACHABLE_TASK_STATES,
  JULIUS_STATES_WITHOUT_A_TASK_STATE,
  JULIUS_TO_WONDERLAND_TASK_STATE,
  WONDERLAND_TASK_SOURCES,
  WONDERLAND_TASK_STATES,
  projectJuliusTaskState,
} from './wonderland-julius-task-state';

const RUNNING = ['Preparation', 'Research', 'Implementation', 'Verification', 'Review', 'Repair'] as const;

/** Members of a C++ `enum class`, in declaration order, read from the real header. */
function cppEnumMembers(header: string, name: string): string[] {
  const source = readFileSync(
    join(resolve(__dirname, '../../../../wonderland/Source/Wonderland'), header),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const start = source.indexOf(`enum class ${name}`);
  expect(start, `${name} not found in ${header}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  return source
    .slice(open + 1, close)
    .split(',')
    .map((entry) => entry.trim().split(/[\s=]/)[0])
    .filter((entry) => entry.length > 0);
}

describe('Julius run state -> Mission Contract task state', () => {
  it('is TOTAL over Julius\'s states, with nothing extra', () => {
    expect(Object.keys(JULIUS_TO_WONDERLAND_TASK_STATE).sort()).toEqual([...JULIUS_MISSION_STATES].sort());
  });

  it('only ever answers with a real EWonderlandTaskState member', () => {
    for (const projection of Object.values(JULIUS_TO_WONDERLAND_TASK_STATE)) {
      if (projection.kind === 'state') expect(WONDERLAND_TASK_STATES).toContain(projection.state);
    }
  });

  it('refuses exactly the three states the founder\'s list cannot show', () => {
    expect([...JULIUS_STATES_WITHOUT_A_TASK_STATE].sort()).toEqual(['BLOCKED', 'CANCELLED', 'WAITING']);
  });

  it('never converts a refusal into the nearest wrong member', () => {
    for (const juliusState of ['BLOCKED', 'WAITING', 'CANCELLED'] as const) {
      const projection = JULIUS_TO_WONDERLAND_TASK_STATE[juliusState];
      expect(projection.kind, `${juliusState} must not render as a task state`).toBe('unrepresentable');
      if (projection.kind === 'unrepresentable') {
        // It carries Julius's own word, so a caller can say what is true.
        expect(projection.juliusState).toBe(juliusState);
        expect(projection.reason.length).toBeGreaterThan(20);
      }
    }
  });

  it('shows a created or READY mission as Queued, never as running (Julius rule 5: dispatched:false)', () => {
    for (const juliusState of ['CREATED', 'READY'] as const) {
      const projection = JULIUS_TO_WONDERLAND_TASK_STATE[juliusState];
      expect(projection).toEqual({ kind: 'state', state: 'Queued' });
      if (projection.kind === 'state') expect(RUNNING as readonly string[]).not.toContain(projection.state);
    }
  });

  it('has exactly ONE route to Completed, and it is Julius\'s own COMPLETED', () => {
    const routes = JULIUS_MISSION_STATES.filter((juliusState) => {
      const projection = JULIUS_TO_WONDERLAND_TASK_STATE[juliusState];
      return projection.kind === 'state' && projection.state === 'Completed';
    });
    expect(routes).toEqual(['COMPLETED']);
  });

  it('never produces Draft or Research, which Julius has no state for', () => {
    expect(JULIUS_REACHABLE_TASK_STATES.has('Draft')).toBe(false);
    expect(JULIUS_REACHABLE_TASK_STATES.has('Research')).toBe(false);
    // Control: the set is not simply empty, so the two checks above could fail.
    expect(JULIUS_REACHABLE_TASK_STATES.has('Queued')).toBe(true);
  });
});

describe('projectJuliusTaskState: unknown stays unknown', () => {
  it('no report is Unknown', () => {
    expect(projectJuliusTaskState(null)).toBeNull();
  });

  it('a state this build was never taught is Unknown, not a guess', () => {
    expect(projectJuliusTaskState('ARCHIVED')).toBeNull();
    expect(projectJuliusTaskState('')).toBeNull();
  });

  it('does not case-fold its way to a conclusion', () => {
    // The near-miss that a lenient parser would accept as Completed.
    expect(projectJuliusTaskState('completed')).toBeNull();
    // Control: the exact token does resolve, so the line above is a real refusal.
    expect(projectJuliusTaskState('COMPLETED')).toEqual({ kind: 'state', state: 'Completed' });
  });

  it('passes a refusal through rather than dropping it', () => {
    expect(projectJuliusTaskState('BLOCKED')?.kind).toBe('unrepresentable');
  });
});

describe('the TypeScript vocabularies are the C++ enums, in ordinal order', () => {
  it('WONDERLAND_TASK_STATES is EWonderlandTaskState', () => {
    expect(cppEnumMembers('WonderlandMissionTasks.h', 'EWonderlandTaskState')).toEqual([...WONDERLAND_TASK_STATES]);
  });

  it('WONDERLAND_TASK_SOURCES is EWonderlandTaskSource, with Local at ordinal 0', () => {
    const members = cppEnumMembers('WonderlandMissionTasks.h', 'EWonderlandTaskSource');
    expect(members).toEqual([...WONDERLAND_TASK_SOURCES]);
    // A default-constructed task must never claim Julius said so.
    expect(members[0]).toBe('Local');
  });
});
