import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  commandRequestsExecution,
  isSlashCommandInput,
  parseSlashCommand,
  routeRelayInput,
} from './loop-command-parser';
import {
  RELAY_LOOP_ACTIONS,
  RELAY_SWARM_LOOP_ACTIONS,
  type RelayParsedSlashCommand,
} from './loop-command-types';
import { looksLikeTargetExpression, parseRoleExpression, roleForAlias } from './loop-roles';

/** Unwrap a parse that must succeed; fail loudly with the real error if not. */
function parsed(input: string): RelayParsedSlashCommand {
  const result = parseSlashCommand(input);
  if (!result.ok) {
    throw new Error(
      `expected "${input}" to parse, got: ${result.error.message} ${(result.error.details ?? []).join(' ')}`,
    );
  }
  return result.value;
}

/** Assert a parse fails and return the error for inspection. */
function rejected(input: string) {
  const result = parseSlashCommand(input);
  expect(result.ok, `expected "${input}" to be rejected`).toBe(false);
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

const DEFAULT_TARGET = {
  kind: 'active_compound_agent',
  requestedExpression: null,
  requestedRoles: [],
};

describe('slash routing', () => {
  it('routes only leading-slash input to the slash grammar', () => {
    expect(isSlashCommandInput('/loop do the thing')).toBe(true);
    expect(isSlashCommandInput('   /loop do the thing')).toBe(true);
    expect(isSlashCommandInput('loop do the thing')).toBe(false);
    expect(isSlashCommandInput('please /loop this')).toBe(false);
    expect(isSlashCommandInput('')).toBe(false);
  });

  it('leaves ordinary language to the existing interpreter', () => {
    expect(routeRelayInput('/loop fix the parser')).toBe('slash');
    expect(routeRelayInput('keep repairing the parser until tests pass')).toBe('natural_language');
    // The word "loop" in prose is not a command:
    expect(routeRelayInput('loop over the failing tests')).toBe('natural_language');
  });
});

describe('composer and catalog', () => {
  it('/loop opens the composer and creates nothing', () => {
    expect(parsed('/loop').command).toEqual({ kind: 'loop_composer' });
    expect(commandRequestsExecution(parsed('/loop').command)).toBe(false);
  });

  it('/loops opens the catalog and refuses arguments', () => {
    expect(parsed('/loops').command).toEqual({ kind: 'loop_catalog' });
    expect(rejected('/loops archived').code).toBe('invalid-command');
  });

  it('/sloop opens the swarm composer', () => {
    expect(parsed('/sloop').command).toEqual({ kind: 'sloop_composer' });
  });

  it('preserves the raw input for the confirmation preview', () => {
    expect(parsed('  /loop all fix the parser  ').raw).toBe('/loop all fix the parser');
  });
});

describe('whole compound agent targeting', () => {
  it('/loop all targets every eligible agent', () => {
    expect(parsed('/loop all Inspect, repair and independently review the parser.').command).toEqual({
      kind: 'loop_create',
      target: { kind: 'all_eligible_agents', requestedExpression: 'all', requestedRoles: [] },
      objective: 'Inspect, repair and independently review the parser.',
    });
  });

  it('/loop team is the canonical alias of /loop all', () => {
    const all = parsed('/loop all fix it').command;
    const team = parsed('/loop team fix it').command;
    if (all.kind !== 'loop_create' || team.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(team.target.kind).toBe(all.target.kind);
    expect(team.objective).toBe(all.objective);
  });

  it('resolves no roles for all/team — the registry decides, not the parser', () => {
    const command = parsed('/loop all fix it').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.target.requestedRoles).toEqual([]);
  });
});

describe('single-role targeting', () => {
  const cases: Array<[string, string]> = [
    ['/loop architect plan the repair', 'prompt_architect'],
    ['/loop prompt-architect plan the repair', 'prompt_architect'],
    ['/loop planning plan the repair', 'prompt_architect'],
    ['/loop coding repair the tests', 'coding_agent'],
    ['/loop coder repair the tests', 'coding_agent'],
    ['/loop code repair the tests', 'coding_agent'],
    ['/loop coding-agent repair the tests', 'coding_agent'],
    ['/loop reviewer inspect the branch', 'reviewer'],
    ['/loop review inspect the branch', 'reviewer'],
    ['/loop harness inspect the branch', 'reviewer'],
    ['/loop harness-reviewer inspect the branch', 'reviewer'],
  ];

  for (const [input, role] of cases) {
    it(`${input} → ${role}`, () => {
      const command = parsed(input).command;
      if (command.kind !== 'loop_create') throw new Error('expected loop_create');
      expect(command.target.kind).toBe('exact_roles');
      expect(command.target.requestedRoles).toEqual([role]);
    });
  }

  it('keeps the objective exactly as written', () => {
    const command = parsed(
      '/loop architect Research the authentication failure, compare the likely causes.',
    ).command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.objective).toBe('Research the authentication failure, compare the likely causes.');
  });
});

describe('multi-role targeting', () => {
  it('/loop architect,coding names two roles in order', () => {
    const command = parsed('/loop architect,coding implement the parser').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.target.requestedRoles).toEqual(['prompt_architect', 'coding_agent']);
    expect(command.target.requestedExpression).toBe('architect,coding');
  });

  it('/loop architect,coding,reviewer names three roles', () => {
    const command = parsed('/loop architect,coding,reviewer ship it').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.target.requestedRoles).toEqual(['prompt_architect', 'coding_agent', 'reviewer']);
  });

  it('rejects a duplicate role reached through two different aliases', () => {
    const error = rejected('/loop coding,coder implement it');
    expect(error.details?.some((d) => d.includes('more than once'))).toBe(true);
  });

  it('rejects an unknown role and names the known ones', () => {
    const error = rejected('/loop architect,qa implement it');
    expect(error.details?.some((d) => d.includes('Unknown role "qa"'))).toBe(true);
    expect(error.details?.some((d) => d.includes('architect'))).toBe(true);
  });

  it('rejects a malformed role list rather than ignoring the stray separator', () => {
    expect(rejected('/loop architect,,coding implement it').code).toBe('invalid-command');
    expect(rejected('/loop architect, implement it').details?.length).toBeGreaterThan(0);
  });

  it('refuses to combine all/team with specific roles', () => {
    const error = rejected('/loop all,coding implement it');
    expect(error.details?.some((d) => d.includes('one or the other'))).toBe(true);
  });

  it('reports every problem at once, not just the first', () => {
    // `architect` marks this as a target, so both bad entries are reported.
    expect(rejected('/loop architect,qa,ops implement it').details?.length).toBe(2);
  });

  it('reads a comma list containing NO role word as an objective, and says so', () => {
    // The honest limit of the grammar: `qa,ops fix it` and
    // `refactor,cleanup the parser` are the same shape, and nothing in the
    // text distinguishes a misspelled target from prose. Both become
    // objectives; a target naming nothing real is caught later by role
    // resolution against the registry, which can actually answer it.
    const command = parsed('/loop qa,ops implement it').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.target.kind).toBe('active_compound_agent');
    expect(command.objective).toBe('qa,ops implement it');
  });
});

describe('default target and objective disambiguation', () => {
  it('/loop <objective> defaults to the active compound agent', () => {
    expect(parsed('/loop fix the failing authentication tests').command).toEqual({
      kind: 'loop_create',
      target: DEFAULT_TARGET,
      objective: 'fix the failing authentication tests',
    });
  });

  it('records that no target was typed, rather than pretending one was chosen', () => {
    const command = parsed('/loop fix it').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.target.requestedExpression).toBeNull();
  });

  it('treats a prose comma list as an objective, not a target', () => {
    const command = parsed('/loop refactor,cleanup the parser').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.target.kind).toBe('active_compound_agent');
    expect(command.objective).toBe('refactor,cleanup the parser');
  });

  it('treats a comma list of real role words as a target', () => {
    const command = parsed('/loop code,review the parser').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.target.kind).toBe('exact_roles');
    expect(command.objective).toBe('the parser');
  });

  it('requires an objective', () => {
    expect(rejected('/loop all').code).toBe('invalid-command');
    expect(rejected('/loop architect').code).toBe('invalid-command');
    expect(rejected('/loop architect,coding').message).toContain('objective');
  });
});

describe('objective normalization', () => {
  it('collapses wrapped whitespace so line breaks do not change meaning', () => {
    const command = parsed('/loop all fix   the\n  parser\ttests').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.objective).toBe('fix the parser tests');
  });

  it('preserves a fully quoted objective verbatim', () => {
    const command = parsed('/loop all "keep   the    spacing exactly"').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.objective).toBe('keep   the    spacing exactly');
  });

  it('does not strip quotes that are part of the objective', () => {
    const command = parsed('/loop all rename "old" to "new"').command;
    if (command.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(command.objective).toBe('rename "old" to "new"');
  });
});

describe('action commands', () => {
  for (const action of RELAY_LOOP_ACTIONS) {
    it(`/loop ${action} parses as an action`, () => {
      expect(parsed(`/loop ${action}`).command).toEqual({ kind: 'loop_action', action, loopId: null });
    });
  }

  it('accepts an optional Loop id on Loop-addressing actions', () => {
    expect(parsed('/loop status lpe_abc123').command).toEqual({
      kind: 'loop_action',
      action: 'status',
      loopId: 'lpe_abc123',
    });
  });

  it('accepts a schedule id where a schedule is addressable', () => {
    expect(parsed('/loop inspect lps_weekday8am').command).toEqual({
      kind: 'loop_action',
      action: 'inspect',
      loopId: 'lps_weekday8am',
    });
  });

  it('refuses a trailing sentence rather than silently dropping it', () => {
    expect(rejected('/loop status of the authentication work').message).toContain('not a Loop identifier');
  });

  it('refuses text after a valid Loop id', () => {
    expect(rejected('/loop stop lpe_abc now please').message).toContain('Unexpected text');
  });

  it('refuses an id on actions that address no single Loop', () => {
    expect(rejected('/loop templates lpe_abc').message).toContain('takes no arguments');
    expect(rejected('/loop help me').message).toContain('takes no arguments');
  });

  it('normalizes command case', () => {
    expect(parsed('/LOOP STATUS').command).toEqual({
      kind: 'loop_action',
      action: 'status',
      loopId: null,
    });
  });
});

describe('schedule grammar', () => {
  it('/loop schedule opens the scheduled composer', () => {
    expect(parsed('/loop schedule').command).toEqual({ kind: 'loop_schedule_composer' });
  });

  it('/loop schedules lists Cron Loops and takes no arguments', () => {
    expect(parsed('/loop schedules').command).toEqual({ kind: 'loop_schedule_list' });
    expect(rejected('/loop schedules paused').code).toBe('invalid-command');
  });

  it('preserves a natural-language schedule request without splitting it', () => {
    expect(
      parsed('/loop schedule Every weekday at 8 AM, inspect the repository for failing tests.').command,
    ).toEqual({
      kind: 'loop_schedule_create',
      target: DEFAULT_TARGET,
      scheduleRequest: 'Every weekday at 8 AM, inspect the repository for failing tests.',
    });
  });

  it('accepts a target on a scheduled Loop', () => {
    const command = parsed('/loop schedule coding Every 6 hours, repair failing tests.').command;
    if (command.kind !== 'loop_schedule_create') throw new Error('expected loop_schedule_create');
    expect(command.target.requestedRoles).toEqual(['coding_agent']);
    expect(command.scheduleRequest).toBe('Every 6 hours, repair failing tests.');
  });

  it('requires a schedule request', () => {
    expect(rejected('/loop schedule coding').code).toBe('invalid-command');
  });
});

describe('cron grammar', () => {
  it('preserves a quoted cron expression exactly', () => {
    expect(parsed('/loop cron "0 8 * * 1-5" Inspect dependency alerts.').command).toEqual({
      kind: 'loop_cron_create',
      target: DEFAULT_TARGET,
      cronExpression: '0 8 * * 1-5',
      objective: 'Inspect dependency alerts.',
    });
  });

  it('accepts a bare five-field expression', () => {
    const command = parsed('/loop cron 0 8 * * 1-5 Inspect dependency alerts.').command;
    if (command.kind !== 'loop_cron_create') throw new Error('expected loop_cron_create');
    expect(command.cronExpression).toBe('0 8 * * 1-5');
    expect(command.objective).toBe('Inspect dependency alerts.');
  });

  it('accepts a target before the objective', () => {
    const command = parsed('/loop cron "0 8 * * 1-5" coding repair failing tests').command;
    if (command.kind !== 'loop_cron_create') throw new Error('expected loop_cron_create');
    expect(command.target.requestedRoles).toEqual(['coding_agent']);
    expect(command.objective).toBe('repair failing tests');
  });

  it('rejects a short bare expression rather than guessing the boundary', () => {
    expect(rejected('/loop cron 0 8 * inspect things').message).toContain('5 fields');
  });

  it('rejects an unterminated quoted expression', () => {
    expect(rejected('/loop cron "0 8 * * 1-5 inspect').message).toContain('closing quote');
  });

  it('requires an objective after the expression', () => {
    expect(rejected('/loop cron "0 8 * * 1-5"').message).toContain('objective');
  });

  it('requires an expression', () => {
    expect(rejected('/loop cron').message).toContain('cron expression is required');
  });

  it('never interprets cron semantics — an out-of-range field still parses', () => {
    const command = parsed('/loop cron "99 99 * * *" do a thing').command;
    if (command.kind !== 'loop_cron_create') throw new Error('expected loop_cron_create');
    expect(command.cronExpression).toBe('99 99 * * *');
  });
});

describe('swarm loop grammar', () => {
  for (const action of RELAY_SWARM_LOOP_ACTIONS) {
    it(`/sloop ${action} parses as a swarm action`, () => {
      expect(parsed(`/sloop ${action}`).command).toEqual({
        kind: 'sloop_action',
        action,
        loopId: null,
      });
    });
  }

  it('/sloop <objective> requests a draft S-Loop contract', () => {
    expect(parsed('/sloop explore three independent repairs and converge').command).toEqual({
      kind: 'sloop_create',
      target: DEFAULT_TARGET,
      objective: 'explore three independent repairs and converge',
    });
  });

  it('/sloop converge accepts a Loop id', () => {
    expect(parsed('/sloop converge lpe_swarm1').command).toEqual({
      kind: 'sloop_action',
      action: 'converge',
      loopId: 'lpe_swarm1',
    });
  });

  it('reports the swarm family so a surface can apply the Unchain gate', () => {
    expect(parsed('/sloop do it').family).toBe('sloop');
    expect(parsed('/loop do it').family).toBe('loop');
  });

  it('requires an objective', () => {
    expect(rejected('/sloop architect').code).toBe('invalid-command');
  });
});

describe('malformed input', () => {
  it('rejects a missing leading slash', () => {
    expect(rejected('loop fix it').message).toContain('must begin with "/"');
  });

  it('rejects an empty command', () => {
    expect(rejected('').code).toBe('invalid-command');
    expect(rejected('   ').code).toBe('invalid-command');
    expect(rejected('/').message).toContain('needs a name');
    expect(rejected('/ loop fix it').message).toContain('needs a name');
  });

  it('rejects an unknown slash command and lists the known ones', () => {
    const error = rejected('/mission do it');
    expect(error.message).toContain('Unknown slash command');
    expect(error.details?.some((d) => d.includes('/loops'))).toBe(true);
  });

  it('rejects a non-string input without throwing', () => {
    expect(parseSlashCommand(undefined as never).ok).toBe(false);
    expect(parseSlashCommand(42 as never).ok).toBe(false);
  });
});

describe('execution intent', () => {
  it('marks only creation commands as requesting execution', () => {
    expect(commandRequestsExecution(parsed('/loop all fix it').command)).toBe(true);
    expect(commandRequestsExecution(parsed('/loop schedule daily, fix it').command)).toBe(true);
    expect(commandRequestsExecution(parsed('/loop cron "0 8 * * 1-5" fix it').command)).toBe(true);
    expect(commandRequestsExecution(parsed('/sloop fix it').command)).toBe(true);

    expect(commandRequestsExecution(parsed('/loop').command)).toBe(false);
    expect(commandRequestsExecution(parsed('/loops').command)).toBe(false);
    expect(commandRequestsExecution(parsed('/loop status').command)).toBe(false);
    expect(commandRequestsExecution(parsed('/loop templates').command)).toBe(false);
    expect(commandRequestsExecution(parsed('/sloop status').command)).toBe(false);
  });
});

describe('role helpers', () => {
  it('normalizes aliases identically wherever they are used', () => {
    expect(roleForAlias('CODER')).toBe('coding_agent');
    expect(roleForAlias('  harness  ')).toBe('reviewer');
    expect(roleForAlias('qa')).toBeNull();
  });

  it('recognizes a target expression when ANY entry is a role word', () => {
    expect(looksLikeTargetExpression('architect')).toBe(true);
    expect(looksLikeTargetExpression('architect,coding')).toBe(true);
    expect(looksLikeTargetExpression('all')).toBe(true);
    // One known role marks the whole token as a target, so the unknown entry
    // becomes a reported error instead of silently joining the objective.
    expect(looksLikeTargetExpression('architect,qa')).toBe(true);
    // No known entry: indistinguishable from prose, so it is prose.
    expect(looksLikeTargetExpression('qa,ops')).toBe(false);
    expect(looksLikeTargetExpression('refactor')).toBe(false);
    expect(looksLikeTargetExpression('')).toBe(false);
  });

  it('never resolves an alias to a role Relay does not have', () => {
    // The founder directive names research and testing roles as FUTURE roles.
    // Relay has three. An alias for a role that cannot be staffed would let a
    // command claim a target that can never be filled.
    for (const absent of ['research', 'researcher', 'testing', 'tester', 'security', 'specialist']) {
      expect(roleForAlias(absent), `${absent} must not resolve until the role exists`).toBeNull();
    }
  });

  it('reports an empty expression as an empty target', () => {
    const result = parseRoleExpression('   ');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.problems[0].reason).toBe('empty_target');
  });
});

/**
 * PARSING IS NOT EXECUTION — proven structurally rather than by assertion.
 *
 * A behavioural test can only show that the calls it happens to make are free
 * of side effects. Reading the sources proves the CAPABILITY to have one is
 * absent: no filesystem, no network, no provider, no clock, no journal, no
 * entitlement. If a future change imports any of them, this fails.
 */
describe('parser purity', () => {
  const SOURCES = ['loop-command-parser.ts', 'loop-command-types.ts', 'loop-roles.ts'];
  const read = (file: string) => readFileSync(join(__dirname, file), 'utf8');

  it('imports nothing that could execute, persist, spend or reach the network', () => {
    const FORBIDDEN: Array<[RegExp, string]> = [
      [/from\s+['"]node:(fs|child_process|http|https|net|dns|os)/, 'a Node capability'],
      [/from\s+['"]\.\.\/\.\.\/persistence/, 'the durable journal'],
      [/from\s+['"]\.\.\/\.\.\/workspace/, 'the workspace'],
      [/from\s+['"]\.\.\/\.\.\/connectors/, 'a provider adapter'],
      [/from\s+['"]\.\.\/\.\.\/coordination/, 'the dispatch battery'],
      [/from\s+['"]\.\.\/\.\.\/psp/, 'entitlement'],
      [/\bfetch\s*\(/, 'the network'],
      [/\bDate\.now\s*\(/, 'the clock'],
      [/new\s+Date\s*\(/, 'the clock'],
      [/\bMath\.random\s*\(/, 'nondeterminism'],
      [/\bprocess\.env\b/, 'the environment'],
      [/\blocalStorage\b|\bsessionStorage\b/, 'browser storage'],
    ];
    for (const file of SOURCES) {
      const source = read(file);
      for (const [pattern, what] of FORBIDDEN) {
        expect(pattern.test(source), `${file} reaches ${what}`).toBe(false);
      }
    }
  });

  it('parsing the same input twice yields identical results', () => {
    const inputs = [
      '/loop',
      '/loops',
      '/loop all fix it',
      '/loop architect,coding fix it',
      '/loop status lpe_a',
      '/loop cron "0 8 * * 1-5" fix it',
      '/sloop fix it',
    ];
    for (const input of inputs) {
      expect(parseSlashCommand(input)).toEqual(parseSlashCommand(input));
    }
  });
});
