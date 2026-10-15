import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { JULIUS_MISSION_STATES } from '../julius/julius-runtime';
import {
  JULIUS_REACHABLE_TASK_STATES,
  JULIUS_STATES_WITHOUT_A_TASK_STATE,
  JULIUS_TO_WONDERLAND_TASK_STATE,
  WONDERLAND_TASK_SOURCES,
  WONDERLAND_TASK_STATES,
  projectJuliusTaskState,
  refuseJuliusState,
} from './wonderland-julius-task-state';

const RUNNING = ['Preparation', 'Research', 'Implementation', 'Verification', 'Review', 'Repair'] as const;

/**
 * THE CLIENT'S HEADERS, PINNED -- the fixture this suite needs and main lacks.
 *
 * The Unreal client lives on CORE's task3 line, not on main, so main's tree has
 * no `WonderlandMissionTasks.h` or `WonderlandJuliusTaskState.h` to read. These
 * are the parts this suite parses, VERBATIM from CORE's final RC at task3
 * 6eb97308 (WonderlandMissionTasks.h blob 4f320ed1, WonderlandJuliusTaskState.h
 * blob 8f4acfc0). When the client's source is in this tree, the live header is
 * read instead and these are not consulted.
 */
const PINNED_CLIENT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'WonderlandMissionTasks.h': `UENUM(BlueprintType)
enum class EWonderlandTaskState : uint8
{
	/** An empty slot. Gray. Local to this session, known to no backend, and recorded in no history. */
	Draft,
	/** A real contract, waiting for Julius to reach it. Red. */
	Queued,
	Preparation,
	Research,
	Implementation,
	Verification,
	Review,
	Repair,
	Completed,
	Failed,
	Paused,
	/** A reviewer or a policy stopped the run. Not a choice, and not a failure. */
	Blocked,
	/** The run is waiting on a person -- an approval or a checkpoint. Not running. */
	Waiting,
	/** Someone stopped the run on purpose. Not a failure. */
	Cancelled
};

UENUM(BlueprintType)
enum class EWonderlandTaskSource : uint8
{
	/** Held in this session only. Every DRAFT is this, and so is a submitted contract that has not reached Julius. */
	Local,
	/** Julius reported this state. The only thing that may drive a running mission. */
	Julius
};
`,
  'WonderlandJuliusTaskState.h': `	// WONDERLAND_JULIUS_TASK_STATE_TABLE_BEGIN -- parsed by wonderland-julius-task-state.test.ts; keep one entry per line.
	inline constexpr FEntry Table[] = {
		{ TEXT("CREATED"),   EWonderlandTaskState::Queued },
		{ TEXT("READY"),     EWonderlandTaskState::Queued },
		{ TEXT("PLANNING"),  EWonderlandTaskState::Preparation },
		{ TEXT("EXECUTING"), EWonderlandTaskState::Implementation },
		{ TEXT("WAITING"),   EWonderlandTaskState::Waiting },
		{ TEXT("REVIEWING"), EWonderlandTaskState::Review },
		{ TEXT("REPAIRING"), EWonderlandTaskState::Repair },
		{ TEXT("VERIFYING"), EWonderlandTaskState::Verification },
		{ TEXT("BLOCKED"),   EWonderlandTaskState::Blocked },
		{ TEXT("PAUSED"),    EWonderlandTaskState::Paused },
		{ TEXT("FAILED"),    EWonderlandTaskState::Failed },
		{ TEXT("COMPLETED"), EWonderlandTaskState::Completed },
		{ TEXT("CANCELLED"), EWonderlandTaskState::Cancelled },
	};
	// WONDERLAND_JULIUS_TASK_STATE_TABLE_END
`,
});

/** The client's header: the live one when the Unreal source is in this tree, the pinned RC copy otherwise. */
function clientHeader(header: string): string {
  const live = join(resolve(__dirname, '../../../../wonderland/Source/Wonderland'), header);
  if (existsSync(live)) return readFileSync(live, 'utf8');
  const pinned = PINNED_CLIENT_HEADERS[header];
  expect(pinned, `${header} is neither in this tree nor pinned`).toBeDefined();
  return pinned;
}

/** Members of a C++ `enum class`, in declaration order, read from the client's header. */
function cppEnumMembers(header: string, name: string): string[] {
  const source = clientHeader(header)
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

  it('gives every Julius state an honest member now -- nothing is refused', () => {
    expect([...JULIUS_STATES_WITHOUT_A_TASK_STATE]).toEqual([]);
  });

  it('maps BLOCKED, WAITING and CANCELLED one-for-one (founder decision 2026-09-27)', () => {
    expect(JULIUS_TO_WONDERLAND_TASK_STATE.BLOCKED).toEqual({ kind: 'state', state: 'Blocked' });
    expect(JULIUS_TO_WONDERLAND_TASK_STATE.WAITING).toEqual({ kind: 'state', state: 'Waiting' });
    expect(JULIUS_TO_WONDERLAND_TASK_STATE.CANCELLED).toEqual({ kind: 'state', state: 'Cancelled' });
  });

  it('BLOCKED is not PAUSED, WAITING is not running, CANCELLED is not FAILED -- the founder\'s three rules', () => {
    const shown = (juliusState: 'BLOCKED' | 'WAITING' | 'CANCELLED') => {
      const projection = JULIUS_TO_WONDERLAND_TASK_STATE[juliusState];
      return projection.kind === 'state' ? projection.state : null;
    };
    expect(shown('BLOCKED')).not.toBe('Paused');
    expect(RUNNING as readonly string[]).not.toContain(shown('WAITING'));
    expect(shown('WAITING')).not.toBe('Paused');
    expect(shown('CANCELLED')).not.toBe('Failed');
    // None of the three is quietly turned into "not started yet" either.
    for (const juliusState of ['BLOCKED', 'WAITING', 'CANCELLED'] as const) expect(shown(juliusState)).not.toBe('Queued');
  });

  it('keeps the refusal mechanism working for the NEXT homeless Julius state', () => {
    // Unused by today's map, so exercised here: a kept mechanism nobody runs is a
    // mechanism nobody knows still works.
    const refusal = refuseJuliusState('BLOCKED', 'a reason long enough to be a reason');
    expect(refusal).toEqual({ kind: 'unrepresentable', juliusState: 'BLOCKED', reason: 'a reason long enough to be a reason' });
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

  it('projects the three new states by their exact token only', () => {
    expect(projectJuliusTaskState('BLOCKED')).toEqual({ kind: 'state', state: 'Blocked' });
    expect(projectJuliusTaskState('blocked')).toBeNull();
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

describe('the ENGINE\'s map is this map (WonderlandJuliusTaskState.h)', () => {
  /** The table between its markers, as [juliusState, taskState] pairs, read from the client's header. */
  function cppTable(): Array<[string, string]> {
    const header = clientHeader('WonderlandJuliusTaskState.h');
    const begin = header.indexOf('WONDERLAND_JULIUS_TASK_STATE_TABLE_BEGIN');
    const end = header.indexOf('WONDERLAND_JULIUS_TASK_STATE_TABLE_END');
    expect(begin, 'table markers missing from the header').toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    const rows = [...header.slice(begin, end).matchAll(/\{\s*TEXT\("([A-Z_]+)"\)\s*,\s*EWonderlandTaskState::([A-Za-z]+)\s*\}/g)];
    return rows.map((m) => [m[1], m[2]]);
  }

  it('the parser found a table at all, so agreement below cannot be two empty lists', () => {
    expect(cppTable().length).toBeGreaterThan(10);
  });

  it('every Julius state appears in the C++ table exactly once', () => {
    const states = cppTable().map(([julius]) => julius);
    expect([...states].sort()).toEqual([...JULIUS_MISSION_STATES].sort());
    expect(new Set(states).size).toBe(states.length);
  });

  it('the C++ table and the TypeScript map agree, entry for entry', () => {
    for (const [julius, task] of cppTable()) {
      const projection = JULIUS_TO_WONDERLAND_TASK_STATE[julius as keyof typeof JULIUS_TO_WONDERLAND_TASK_STATE];
      expect(projection, `${julius} is in the C++ table but not the TypeScript map`).toBeDefined();
      expect(projection).toEqual({ kind: 'state', state: task });
    }
  });

  it('and every task state the C++ table names is a real EWonderlandTaskState member', () => {
    for (const [, task] of cppTable()) expect(WONDERLAND_TASK_STATES as readonly string[]).toContain(task);
  });
});
