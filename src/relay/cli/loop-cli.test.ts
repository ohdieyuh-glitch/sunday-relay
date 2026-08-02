import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOOP_CLI_HELP, runLoopCli, slashCommandFromArgv } from './loop-cli';
import { runCli } from './main';
import {
  ALL_LOOP_FEATURES_DISABLED,
  DEFAULT_LOOP_LIMITS,
  evaluateLoopAvailability,
  parseSlashCommand,
  projectLoopCommandPreview,
  resolveLoopTarget,
  type RelayAgentRegistrySnapshot,
} from '../mission';

const NOW = '2026-08-02T12:00:00.000Z';

const REGISTRY: RelayAgentRegistrySnapshot = {
  activeCompoundAgentRoles: ['prompt_architect', 'coding_agent'],
  eligibleRoles: ['prompt_architect', 'coding_agent', 'reviewer'],
  availability: { prompt_architect: 'available', coding_agent: 'available', reviewer: 'available' },
  provenance: 'simulated',
  observedAt: NOW,
};

function cli(positionals: string[], registry?: RelayAgentRegistrySnapshot) {
  return runLoopCli({ positionals, registry, observedAt: NOW });
}

/* ------------------------------------------------------------ argv → slash */

describe('argv reconstructs the canonical slash string', () => {
  it('rebuilds each documented CLI form', () => {
    expect(slashCommandFromArgv(['loop'])).toBe('/loop');
    expect(slashCommandFromArgv(['loops'])).toBe('/loops');
    expect(slashCommandFromArgv(['loop', 'all', 'fix', 'it'])).toBe('/loop all fix it');
    expect(slashCommandFromArgv(['loop', 'architect', 'plan the repair'])).toBe(
      '/loop architect plan the repair',
    );
    expect(slashCommandFromArgv(['loop', 'status', 'lpe_a'])).toBe('/loop status lpe_a');
    expect(slashCommandFromArgv(['sloop', 'converge'])).toBe('/sloop converge');
  });

  it('passes a literal slash command straight through', () => {
    expect(slashCommandFromArgv(['/loop all inspect and repair the project'])).toBe(
      '/loop all inspect and repair the project',
    );
  });

  it('re-quotes an argument whose internal spacing the shell preserved', () => {
    expect(slashCommandFromArgv(['loop', 'all', 'keep   the   spacing'])).toBe(
      '/loop all "keep   the   spacing"',
    );
  });
});

/* ------------------------------------------------------------- CLI ↔ UI */

describe('CLI and website normalize to the SAME command contract', () => {
  const PAIRS: Array<[string[], string]> = [
    [['loop', 'all', 'fix', 'it'], '/loop all fix it'],
    [['loop', 'team', 'fix', 'it'], '/loop team fix it'],
    [['loop', 'architect', 'plan', 'it'], '/loop architect plan it'],
    [['loop', 'coder', 'repair', 'it'], '/loop coder repair it'],
    [['loop', 'harness', 'review', 'it'], '/loop harness review it'],
    [['loop', 'architect,coding', 'ship', 'it'], '/loop architect,coding ship it'],
    [['loop', 'status', 'lpe_a'], '/loop status lpe_a'],
    [['loops'], '/loops'],
    [['loop', 'schedules'], '/loop schedules'],
    [['sloop', 'inspect', 'lpe_a'], '/sloop inspect lpe_a'],
  ];

  for (const [argv, slash] of PAIRS) {
    it(`relay ${argv.join(' ')} === ${slash}`, () => {
      const fromCli = cli(argv).parsed;
      const fromComposer = parseSlashCommand(slash);
      expect(fromComposer.ok).toBe(true);
      if (!fromComposer.ok) throw new Error('unreachable');
      expect(fromCli?.command).toEqual(fromComposer.value.command);
      expect(fromCli?.family).toBe(fromComposer.value.family);
    });
  }

  it('resolves aliases to the same ROLE on both surfaces', () => {
    const viaCli = cli(['loop', 'coder', 'fix']).parsed?.command;
    const viaSlash = parseSlashCommand('/loop coding-agent fix');
    if (!viaSlash.ok || viaSlash.value.command.kind !== 'loop_create') throw new Error('unreachable');
    if (viaCli?.kind !== 'loop_create') throw new Error('expected loop_create');
    expect(viaCli.target.requestedRoles).toEqual(viaSlash.value.command.target.requestedRoles);
    expect(viaCli.objective).toBe(viaSlash.value.command.objective);
    // The expression the user typed is preserved verbatim on each surface, so
    // a preview can echo their words back rather than a canonical rewrite.
    expect(viaCli.target.requestedExpression).toBe('coder');
    expect(viaSlash.value.command.target.requestedExpression).toBe('coding-agent');
  });

  it('produces the same validation message on both surfaces', () => {
    const viaCli = cli(['loop', 'architect,qa', 'fix', 'it']);
    const viaSlash = parseSlashCommand('/loop architect,qa fix it');
    expect(viaCli.invalid).toBe(true);
    expect(viaSlash.ok).toBe(false);
    if (viaSlash.ok) throw new Error('unreachable');
    expect(viaCli.lines.join(' ')).toContain(viaSlash.error.message);
    for (const detail of viaSlash.error.details ?? []) {
      expect(viaCli.lines.join(' ')).toContain(detail);
    }
  });

  it('renders the same preview rows from the same inputs', () => {
    const parsed = parseSlashCommand('/loop all fix the parser');
    if (!parsed.ok || parsed.value.command.kind !== 'loop_create') throw new Error('unreachable');
    const availability = evaluateLoopAvailability({
      command: parsed.value.command,
      flags: ALL_LOOP_FEATURES_DISABLED,
      unchain: null,
      assignableRoles: REGISTRY.eligibleRoles,
      observedAt: NOW,
    });
    const preview = projectLoopCommandPreview({
      parsed: parsed.value,
      availability,
      target: resolveLoopTarget(parsed.value.command.target, REGISTRY),
      limits: DEFAULT_LOOP_LIMITS,
      independentReviewRequired: true,
    });
    const cliLines = cli(['loop', 'all', 'fix', 'the', 'parser'], REGISTRY).lines.join('\n');
    for (const row of preview.rows) {
      expect(cliLines).toContain(row.value);
    }
  });
});

/* -------------------------------------------------------------- previews */

describe('the CLI preview tells the truth', () => {
  it('names the roles the default target actually resolves to', () => {
    const lines = cli(['loop', 'fix', 'the', 'parser'], REGISTRY).lines.join('\n');
    expect(lines).toContain('no target was named');
    expect(lines).toContain('architect, coding');
  });

  it('says Unknown when it has observed no registry, rather than showing none', () => {
    const lines = cli(['loop', 'all', 'fix', 'it']).lines.join('\n');
    expect(lines).toContain('Unknown');
  });

  it('reports a role the registry cannot staff, and why', () => {
    const partial: RelayAgentRegistrySnapshot = {
      ...REGISTRY,
      availability: { prompt_architect: 'available', coding_agent: 'entitlement_locked' },
    };
    const lines = cli(['loop', 'architect,coding', 'fix', 'it'], partial).lines.join('\n');
    expect(lines).toContain('Unavailable');
    expect(lines).toContain('entitlement locked');
  });

  it('states that nothing runs or is spent until confirmation', () => {
    expect(cli(['loop', 'all', 'fix', 'it'], REGISTRY).lines.join('\n')).toContain(
      'Nothing runs and nothing is spent until you confirm',
    );
  });

  it('never offers confirmation while the engine is disabled', () => {
    const lines = cli(['loop', 'all', 'fix', 'it'], REGISTRY).lines.join('\n');
    expect(lines).toContain('BLOCKED');
    expect(lines).toContain('Loop Engine');
    expect(lines).not.toContain('Confirm to compile');
  });

  it('shows a cost line only for commands that could cost something', () => {
    expect(cli(['loop', 'all', 'fix', 'it'], REGISTRY).lines.join('\n')).toContain('Spending limit');
    expect(cli(['loop', 'status'], REGISTRY).lines.join('\n')).not.toContain('Spending limit');
    expect(cli(['loops'], REGISTRY).lines.join('\n')).not.toContain('Spending limit');
  });

  it('does not interpret a cron expression it has not implemented', () => {
    const lines = cli(['loop', 'cron', '0 8 * * 1-5', 'inspect', 'deps'], REGISTRY).lines.join('\n');
    expect(lines).toContain('0 8 * * 1-5');
    expect(lines).toContain('has not been interpreted yet');
  });

  it('reports the S-Loop gate truthfully instead of faking a session', () => {
    const lines = cli(['sloop', 'explore', 'three', 'repairs'], REGISTRY).lines.join('\n');
    expect(lines).toContain('BLOCKED');
    expect(lines).toContain('Unchain');
    expect(lines).toContain('capacity, never permissions');
  });

  it('exits usage only for a command it cannot read', () => {
    expect(cli(['loop', 'architect,qa', 'fix']).invalid).toBe(true);
    // Blocked is understood; it just cannot run yet.
    expect(cli(['loop', 'all', 'fix', 'it']).invalid).toBe(false);
  });
});

/* ------------------------------------------------------- end-to-end CLI */

describe('relay loop through the real CLI entry point', () => {
  function capture(argv: string[]) {
    const lines: string[] = [];
    const io = { out: (line: string) => lines.push(line), isTTY: false, env: {} as NodeJS.ProcessEnv };
    return { lines, run: () => runCli(argv, io), io };
  }

  it('prints the Loop grammar for `relay loop help`', async () => {
    const c = capture(['loop', 'help']);
    expect(await c.run()).toBe(0);
    expect(c.lines.join('\n')).toContain('Relay Loops');
    expect(c.lines.join('\n')).toContain('relay loop architect,coding');
  });

  it('previews a Loop without spending anything', async () => {
    const c = capture(['loop', 'all', 'fix', 'the', 'parser']);
    expect(await c.run()).toBe(0);
    const out = c.lines.join('\n');
    expect(out).toContain('Draft Loop');
    expect(out).toContain('fix the parser');
  });

  it('accepts a literal slash command', async () => {
    const c = capture(['/loop all inspect and repair the project']);
    expect(await c.run()).toBe(0);
    expect(c.lines.join('\n')).toContain('inspect and repair the project');
  });

  it('reports a malformed command with a usage exit code', async () => {
    const c = capture(['loop', 'architect,qa', 'fix', 'it']);
    expect(await c.run()).not.toBe(0);
    expect(c.lines.join('\n')).toContain('Unknown role');
  });

  it('lists Loop commands in the main help text', async () => {
    const c = capture(['help']);
    expect(await c.run()).toBe(0);
    const out = c.lines.join('\n');
    expect(out).toContain('relay loop <objective>');
    expect(out).toContain('relay loops');
    expect(out).toContain('relay sloop <objective>');
  });

  it('the documented grammar and the parser agree on every listed form', () => {
    // Every `relay loop …` line in the help text must actually parse. Help
    // that documents a form the parser rejects is worse than no help.
    const forms = LOOP_CLI_HELP.filter((line) => /^\s{2}relay (loop|loops|sloop)/.test(line))
      .map((line) => line.trim().split(/\s{2,}/)[0])
      .map((form) =>
        form
          .replace(/<objective>|<o>|<when \+ what>/g, 'do the thing')
          .replace(/"<expr>"/g, '"0 8 * * 1-5"')
          .replace(/\[loop-id\]|\[id\]/g, '')
          .trim(),
      );
    expect(forms.length).toBeGreaterThan(8);
    for (const form of forms) {
      // Take the FIRST alternative wherever help shows `a|b`.
      const concrete = form.replace(/(\S+)\|\S+/g, (_m, first: string) => first);
      const argv = concrete.split(/\s+/).slice(1);
      const result = runLoopCli({ positionals: argv, observedAt: NOW });
      expect(result.invalid, `documented form failed to parse: ${concrete}`).toBe(false);
    }
  });
});

/* ------------------------------------------------------ browser boundary */

describe('the CLI Loop surface stays a thin client', () => {
  const source = readFileSync(join(__dirname, 'loop-cli.ts'), 'utf8');

  it('imports only the mission barrel', () => {
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const imported of imports) {
      expect(imported, `loop-cli imports ${imported}`).toBe('../mission');
    }
  });

  it('reaches no provider, no filesystem and no process', () => {
    for (const [pattern, what] of [
      [/child_process|spawn\(/, 'a process'],
      [/readFileSync|writeFileSync/, 'the filesystem'],
      [/\bfetch\s*\(/, 'the network'],
      [/process\.env/, 'the environment'],
    ] as Array<[RegExp, string]>) {
      expect(pattern.test(source), `loop-cli reaches ${what}`).toBe(false);
    }
  });

  it('cannot mint an Unchain session — it passes null, always', () => {
    const occurrences = [...source.matchAll(/unchain:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    expect(occurrences.length).toBeGreaterThan(0);
    for (const value of occurrences) {
      expect(value, 'the CLI may only ever pass a null Unchain session').toBe('null');
    }
  });
});
