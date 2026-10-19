import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_LOOP_FEATURES_DISABLED,
  DEFAULT_LOOP_LIMITS,
  evaluateLoopAvailability,
  parseSlashCommand,
  projectLoopCommandPreview,
  renderLoopPreviewLines,
  resolveLoopTarget,
  routeRelayInput,
  type RelayAgentRegistrySnapshot,
} from '../../mission';
import { runLoopCli } from '../../cli/loop-cli';
import { isLoopRunCommand } from '../../cli/loop-run-cli';
import { openLoopSurface } from '../loop';

const NOW = '2026-08-02T12:00:00.000Z';

const REGISTRY: RelayAgentRegistrySnapshot = {
  activeCompoundAgentRoles: ['prompt_architect', 'coding_agent'],
  eligibleRoles: ['prompt_architect', 'coding_agent', 'reviewer'],
  availability: { prompt_architect: 'available', coding_agent: 'available', reviewer: 'available' },
  provenance: 'simulated',
  observedAt: NOW,
};

/**
 * The website composer and the CLI must reach the SAME words for the same
 * command. This is the parity contract in its smallest testable form: build
 * the preview through the shared projection, and prove the terminal renderer
 * produces the identical row values.
 */
describe('website ↔ CLI Loop preview parity', () => {
  function composerPreview(input: string) {
    const parsed = parseSlashCommand(input);
    if (!parsed.ok) throw new Error(`could not parse ${input}`);
    const command = parsed.value.command;
    const availability = evaluateLoopAvailability({
      command,
      flags: ALL_LOOP_FEATURES_DISABLED,
      unchain: null,
      assignableRoles: REGISTRY.eligibleRoles,
      observedAt: NOW,
    });
    const target =
      command.kind === 'loop_create' || command.kind === 'sloop_create'
        ? resolveLoopTarget(command.target, REGISTRY)
        : null;
    return projectLoopCommandPreview({
      parsed: parsed.value,
      availability,
      target,
      limits: DEFAULT_LOOP_LIMITS,
      independentReviewRequired: true,
    });
  }

  const CASES: Array<[string, string[]]> = [
    ['/loop all fix the parser', ['loop', 'all', 'fix', 'the', 'parser']],
    ['/loop architect,coding ship it', ['loop', 'architect,coding', 'ship', 'it']],
    // `/loop status <id>` used to live here. It no longer describes what either
    // surface does with that input — both now OPEN THE RUN rather than preview
    // the command — so it is asserted below as the routing decision it became,
    // not left here asserting a preview neither surface renders.
    ['/loop status', ['loop', 'status']],
    ['/sloop explore three repairs', ['sloop', 'explore', 'three', 'repairs']],
  ];

  for (const [slash, argv] of CASES) {
    it(`${slash} renders identically on both surfaces`, () => {
      const preview = composerPreview(slash);
      const cliLines = runLoopCli({ positionals: argv, registry: REGISTRY, observedAt: NOW }).lines;
      expect(cliLines).toEqual(renderLoopPreviewLines(preview));
    });
  }

  it('a status command NAMING A RUN opens the run on both surfaces, and previews on neither', () => {
    /*
     * The one place the two surfaces could drift into meaning different things.
     * A user typing `status lpe_a` is asking what a run IS DOING; describing the
     * command back to them is the answer to a different question.
     *
     * Website: `openLoopSurface` returns the run surface.
     * CLI: `isLoopRunCommand` routes it to the bridge instead of the preview.
     * Both refuse the same input — one with no id — for the same reason.
     */
    const opened = openLoopSurface('/loop status lpr_a', {
      flags: null, registry: null, observedAt: NOW,
      projectId: 'p', workspaceId: 'w',
    });
    expect(opened.kind).toBe('run');
    expect(isLoopRunCommand(['loop', 'status', 'lpr_a'])).toBe(true);

    // A LOOP id where a RUN id belongs opens no run surface either. The CLI
    // seam refused this from the start; the website did not, so
    // `/loop status lpe_abc` opened a panel that then reported "no such Loop
    // run" for a perfectly valid Loop id.
    for (const wrong of ['/loop status lpe_abc', '/loop status lps_abc']) {
      const mismatched = openLoopSurface(wrong, {
        flags: null, registry: null, observedAt: NOW,
        projectId: 'p', workspaceId: 'w',
      });
      expect(mismatched.kind, wrong).not.toBe('run');
    }

    // No id: neither surface can resolve "the caller's current Loop", and both
    // fall back to the preview that explains why.
    const bare = openLoopSurface('/loop status', {
      flags: null, registry: null, observedAt: NOW,
      projectId: 'p', workspaceId: 'w',
    });
    expect(bare.kind).not.toBe('run');
    expect(isLoopRunCommand(['loop', 'status'])).toBe(false);
  });

  it('a CONTROL never opens a run surface on the website — the browser cannot authorize one', () => {
    for (const action of ['pause', 'resume', 'stop']) {
      const opened = openLoopSurface(`/loop ${action} lpr_a`, {
        flags: null, registry: null, observedAt: NOW,
        projectId: 'p', workspaceId: 'w',
      });
      expect(opened.kind, action).not.toBe('run');
    }
    // The CLI does route them — it can carry an operator credential.
    expect(isLoopRunCommand(['loop', 'stop', 'lpr_a'])).toBe(true);
  });

  it('uses one vocabulary for absence on both surfaces', () => {
    const preview = composerPreview('/loop all fix it');
    // No registry on this call: the preview must say Unknown, never show an
    // empty agent list that reads like "no agents are needed".
    const withoutRegistry = runLoopCli({ positionals: ['loop', 'all', 'fix', 'it'], observedAt: NOW });
    expect(withoutRegistry.lines.join('\n')).toContain('Unknown');
    expect(preview.rows.some((r) => r.label === 'Agents')).toBe(true);
  });
});

/**
 * The composer's ONE seam: a leading slash goes to the Loop grammar, anything
 * else stays with the existing natural-language interpreter. Asserted against
 * the component source so the seam cannot be quietly removed.
 */
describe('the conversation routes slash input to the Loop grammar', () => {
  const source = readFileSync(join(__dirname, 'RelayProjectConversation.tsx'), 'utf8');

  it('routes through the shared router rather than testing the string itself', () => {
    expect(source).toContain('routeRelayInput');
    // A hand-rolled `startsWith('/')` here would be a second grammar in
    // disguise — the router is the one place that decision is made.
    expect(/startsWith\(\s*['"]\//.test(source)).toBe(false);
  });

  it('falls back to the conversation when no Loop handler is wired', () => {
    // Optional handler: a surface without a Loop composer must keep today's
    // behaviour rather than swallowing `/loop …` into silence.
    expect(source).toContain('onSendSlashCommand !== undefined');
    expect(source).toContain('onSendProjectMessage(text)');
  });

  it('agrees with the router on real inputs', () => {
    expect(routeRelayInput('/loop all fix it')).toBe('slash');
    expect(routeRelayInput('Why is Relay waiting?')).toBe('natural_language');
    expect(routeRelayInput('What is happening?')).toBe('natural_language');
  });
});

/**
 * The browser may never reach a server capability. The Loop domain is pure and
 * browser-safe by design; this proves the specific modules the UI now imports
 * carry nothing that would break that.
 */
describe('the browser Loop surface stays browser-safe', () => {
  const LOOP_DIR = join(__dirname, '..', '..', 'mission', 'loop');
  const SOURCES = [
    'loop-command-parser.ts',
    'loop-command-types.ts',
    'loop-roles.ts',
    'loop-target.ts',
    'loop-blockers.ts',
    'loop-contract.ts',
    'loop-completion.ts',
    'loop-availability.ts',
    'loop-preview.ts',
    'index.ts',
  ];

  it('no Loop domain module imports a Node builtin, adapter or persistence', () => {
    for (const file of SOURCES) {
      const source = readFileSync(join(LOOP_DIR, file), 'utf8');
      expect(/from\s+['"]node:/.test(source), `${file} imports a node builtin`).toBe(false);
      expect(/from\s+['"]\.\.\/\.\.\/(persistence|workspace|connectors|cli)/.test(source), `${file} reaches a server module`).toBe(false);
      expect(/child_process|readFileSync|writeFileSync/.test(source), `${file} touches Node fs/process`).toBe(false);
    }
  });

  it('no Loop domain module declares a credential-shaped field', () => {
    const CREDENTIAL_FIELD = /\b(apiKey|accessToken|refreshToken|clientSecret|privateKey|password|bearer)\b\s*[:?]/;
    for (const file of SOURCES) {
      const source = readFileSync(join(LOOP_DIR, file), 'utf8');
      expect(CREDENTIAL_FIELD.test(source), `${file} declares a credential-shaped field`).toBe(false);
    }
  });

  it('the Unchain session type is observation-only — the domain cannot build one', () => {
    const source = readFileSync(join(LOOP_DIR, 'loop-availability.ts'), 'utf8');
    // An exported factory would be a client-side path to eligibility. The only
    // exported function that mentions Unchain must be the one that REFUSES.
    const exported = [...source.matchAll(/export function (\w+)/g)].map((m) => m[1]);
    const unchainFns = exported.filter((name) => /unchain/i.test(name));
    expect(unchainFns).toEqual(['unchainSessionProblem']);
    // And nothing anywhere constructs a session literal with a granting shape.
    expect(/grantedToOperator:\s*true/.test(source), 'the domain fabricates an operator grant').toBe(false);
  });
});

/* -------------------------------------------------- the host actually wires it */

/**
 * A surface nothing mounts is not an integrated surface.
 *
 * `RelayProjectWorkspace` takes `loopSurface` OPTIONALLY — deliberately, so the
 * approved screen renders unchanged without it — which means the parser can be
 * fully integrated and `/loop` can still fall through to the conversation
 * because no host ever passed one. That is precisely the gap this asserts
 * against, and it is invisible to every other test in this file.
 */
describe('the application host reaches the Loop surface', () => {
  const HOST = join(__dirname, '..', 'preview', 'RelayPreviewApp.tsx');
  const source = readFileSync(HOST, 'utf8');

  it('opens the Loop surface through the shared pure entry point', () => {
    expect(source).toContain('openLoopSurface');
    // The host must not reach past it into the parser and re-decide meaning.
    expect(/\bparseSlashCommand\b/.test(source), 'the host parses slash input itself').toBe(false);
  });

  it('passes a loopSurface to EVERY workspace it renders', () => {
    const renders = source.match(/<RelayProjectWorkspace\b/g) ?? [];
    expect(renders.length, 'expected the host to render the workspace').toBeGreaterThan(0);
    const wired = source.match(/loopSurface=\{loopSurface\}/g) ?? [];
    expect(
      wired.length,
      'a RelayProjectWorkspace render site without loopSurface silently drops /loop',
    ).toBe(renders.length);
  });

  it('cannot mint an Unchain session or enable a Loop feature from the browser', () => {
    // The host supplies flags and Unchain state. Both must be the refusing
    // value: a host that passed enabled flags would be claiming shipped
    // capability, and one that passed a session would be forging eligibility.
    expect(source).toContain('flags: null');
    expect(/unchain:\s*(?!null)/.test(source), 'the host supplies an Unchain session').toBe(false);
  });

  it('starts nothing — the host has no Loop execution call', () => {
    for (const forbidden of [/startLoop\s*\(/, /runLoop\s*\(/, /dispatchLoop\s*\(/]) {
      expect(forbidden.test(source), `the host calls ${forbidden}`).toBe(false);
    }
  });
});
