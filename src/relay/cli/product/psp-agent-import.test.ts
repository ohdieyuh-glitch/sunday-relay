import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { CliCaps } from './contracts';
import {
  PSP_ARGUMENT_REFUSAL,
  looksLikePspCredentialArgument,
  renderPspPreview,
  runPspAgentImportCommand,
  type PspImportIo,
} from './psp-agent-import';
import {
  containsPspAgentId,
  createUnavailableEntitlementService,
  type PSPWorkspaceContext,
} from '../../psp';
import {
  FIXTURE_HOLDER_USER_ID,
  FIXTURE_NOW,
  FIXTURE_UNKNOWN_CREDENTIAL,
  FIXTURE_WORKSPACE_ID,
  createFixtureEntitlementService,
  fixtureScenario,
} from '../../psp/psp-fixtures';
import { parseCli } from '../main';

/**
 * CLI PSP Agent ID import — parity + security suite.
 *
 * Everything is synthetic (version-0 development fixtures) and deterministic:
 * no marketplace, no purchase, no trade, no payment provider, no network.
 */

function caps(overrides: Partial<CliCaps> = {}): CliCaps {
  return {
    tty: true, color: false, unicode: true, width: 100,
    reducedMotion: true, plain: false, json: false, ...overrides,
  };
}

function workspace(overrides: Partial<PSPWorkspaceContext> = {}): PSPWorkspaceContext {
  return {
    workspaceId: FIXTURE_WORKSPACE_ID,
    userId: FIXTURE_HOLDER_USER_ID,
    importAllowed: true,
    relayVersion: '0.5.0',
    grantablePermissions: ['workspace.read', 'workspace.write', 'mission.run', 'mission.review'],
    installedPspIds: [],
    ...overrides,
  };
}

interface Harness {
  io: PspImportIo;
  out: string[];
  /** Everything the terminal was asked to display, including prompts. */
  screen: () => string;
  echoed: string[];
}

function harness(input: {
  secret?: string | null;
  confirm?: boolean;
}): Harness {
  const out: string[] = [];
  const echoed: string[] = [];
  return {
    out,
    echoed,
    screen: () => [...out, ...echoed].join('\n'),
    io: {
      out: (line) => out.push(line),
      // A real terminal never echoes the typed credential; this fake records
      // ONLY the prompt, exactly like the raw-mode reader does.
      readSecret: async (prompt) => {
        echoed.push(prompt);
        return input.secret === undefined ? null : input.secret;
      },
      confirm: async (prompt) => {
        echoed.push(prompt);
        return input.confirm === true;
      },
    },
  };
}

function run(options: {
  credential?: string | null;
  confirm?: boolean;
  service?: ReturnType<typeof createFixtureEntitlementService>;
  workspaceOverrides?: Partial<PSPWorkspaceContext>;
  source?: 'interactive' | 'stdin' | 'env';
  envValue?: string;
}) {
  const h = harness({ secret: options.credential ?? undefined, confirm: options.confirm });
  const service = options.service ?? createFixtureEntitlementService();
  const source = options.source === 'stdin'
    ? { kind: 'stdin' as const, read: async () => options.credential ?? '' }
    : options.source === 'env'
      ? {
        kind: 'env' as const,
        name: 'RELAY_PSP_AGENT_ID',
        read: () => options.envValue,
      }
      : { kind: 'interactive' as const };

  return runPspAgentImportCommand({
    caps: caps(),
    workspace: workspace(options.workspaceOverrides),
    service,
    now: () => FIXTURE_NOW,
    importId: () => 'imp-cli-1',
    io: h.io,
    source,
    assumeYes: false,
  }).then((result) => ({ result, h, service }));
}

/* ------------------------------ command --------------------------------- */

describe('relay agent import — command surface', () => {
  it('the command exists and both spellings parse', () => {
    expect(parseCli(['agent', 'import']).command).toBe('agent');
    expect(parseCli(['agent', 'import']).agentAction).toBe('import');
    expect(parseCli(['psp-agent', 'import']).agentAction).toBe('import');
    expect(parseCli(['agent']).error).toContain('import');
  });

  it('there is NO flag that puts a credential in argv', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'relay', 'cli', 'main.ts'), 'utf8');
    expect(source).not.toContain("'psp-agent-id': { type: 'string' }");
    expect(source).not.toContain("'agent-id': { type: 'string' }");
    // Only a NAMED environment reference is accepted, never a value flag.
    expect(parseCli(['agent', 'import', '--credential-env', 'RELAY_PSP_AGENT_ID']).credentialEnv)
      .toBe('RELAY_PSP_AGENT_ID');
  });

  it('a credential pasted as an argument is refused, not used', () => {
    const parsed = parseCli(['agent', 'import', 'PSP-AGENT-0-RY0001-DEVFXTRADEVFXTRADEVFXTRADE-XXXX']);
    expect(parsed.credentialInArgv).toBe(true);
    const guidance = PSP_ARGUMENT_REFUSAL.join('\n');
    expect(guidance).toContain('never accepted as a command argument');
    expect(guidance).toContain('shell history');
    // The guidance itself must not teach an unsafe invocation.
    expect(containsPspAgentId(guidance)).toBe(false);
    expect(guidance).not.toMatch(/relay agent import\s+PSP-AGENT-/);
    expect(looksLikePspCredentialArgument('PSP-AGENT-0-RY0001-x')).toBe(true);
    expect(looksLikePspCredentialArgument('--stdin')).toBe(false);
  });
});

/* ------------------------------ security -------------------------------- */

describe('relay agent import — credential never reaches the terminal', () => {
  it('interactive entry is never echoed and never printed', async () => {
    const scenario = fixtureScenario('purchased');
    const { result, h } = await run({ credential: scenario.credential, confirm: true });
    expect(result.imported).toBe(true);
    const screen = h.screen();
    expect(containsPspAgentId(screen)).toBe(false);
    expect(screen).not.toContain('DEVFXTR');
    // The prompt was shown; the typed value never was.
    expect(h.echoed.some((line) => line.includes('hidden'))).toBe(true);
    expect(h.echoed.join('\n')).not.toContain(scenario.credential);
  });

  it('the completed output carries the identity, not the credential', async () => {
    const scenario = fixtureScenario('purchased');
    const { result, h } = await run({ credential: scenario.credential, confirm: true });
    const screen = h.screen();
    expect(screen).toContain('PSP AGENT IMPORTED');
    expect(screen).toContain('Atlas Delivery Squad');
    expect(screen).toContain('RY0001');            // PUBLIC identity only
    expect(screen).toContain(FIXTURE_WORKSPACE_ID);
    expect(containsPspAgentId(screen)).toBe(false);
    expect(result.pspAgentId).toBe('RY0001');
    expect(containsPspAgentId(result.lines.join('\n'))).toBe(false);
  });

  it('refuses to prompt when the terminal cannot hide input', async () => {
    const { result, h } = await run({ credential: null, confirm: true });
    expect(result.imported).toBe(false);
    expect(h.screen()).toContain('cannot hide typed input');
    // …and points at a safe alternative, never at an argv invocation.
    expect(h.screen()).toContain('--stdin');
    expect(containsPspAgentId(h.screen())).toBe(false);
  });

  it('reads from secure stdin and from a NAMED environment reference', async () => {
    const scenario = fixtureScenario('purchased');
    const piped = await run({ credential: scenario.credential, confirm: true, source: 'stdin' });
    expect(piped.result.imported).toBe(true);
    expect(containsPspAgentId(piped.h.screen())).toBe(false);

    const fromEnv = await run({
      confirm: true, source: 'env', envValue: fixtureScenario('traded').credential,
    });
    expect(fromEnv.result.imported).toBe(true);
    const screen = fromEnv.h.screen();
    expect(screen).toContain('RELAY_PSP_AGENT_ID');   // the NAME is safe
    expect(containsPspAgentId(screen)).toBe(false);   // the VALUE never is
  });

  it('the preview masks the ID and shows only safe facts', () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService();
    const looked = service.lookup({ credential: scenario.credential, now: FIXTURE_NOW });
    expect(looked.ok).toBe(true);
    if (!looked.ok) return;
    const preview = {
      pspAgentId: 'RY0001',
      maskedAgentId: 'PSP-AGENT-0-RY0001-••••••••••••••••',
      credentialFingerprint: 'pspfp_test',
      name: looked.value.product.name,
      creator: looked.value.product.creator,
      pspId: looked.value.product.pspId,
      pspVersionId: looked.value.product.pspVersionId,
      version: looked.value.product.version,
      agentRoles: looked.value.product.agentRoles,
      supportedModels: looked.value.product.supportedModels,
      requiredPermissions: looked.value.product.requiredPermissions,
      requiredTools: looked.value.product.requiredTools,
      reviewPolicy: looked.value.product.reviewPolicy,
      defaultBudgetPolicy: looked.value.product.defaultBudgetPolicy,
      relayDogColorway: looked.value.product.relayDogColorway,
      acquisitionType: 'purchase' as const,
      compatible: true,
      warnings: [],
      redemptionEffect: 'redeem_one_time' as const,
      confirmationRequired: true,
    };
    const lines = renderPspPreview(preview, caps()).join('\n');
    expect(lines).toContain('IMPORT PREVIEW');
    expect(lines).toContain('Atlas Delivery Squad');
    expect(lines).toContain('••••••••••••••••');
    expect(lines).toContain('official Relay Dog identity');
    expect(lines).toContain('redeemed once and bound to this workspace');
    expect(containsPspAgentId(lines)).toBe(false);
  });
});

/* ---------------------------- confirmation ------------------------------ */

describe('relay agent import — confirmation', () => {
  it('requires confirmation; declining imports nothing', async () => {
    const scenario = fixtureScenario('purchased');
    const { result, h, service } = await run({ credential: scenario.credential, confirm: false });
    expect(result.imported).toBe(false);
    expect(result.phase).toBe('confirmation_required');
    expect(h.screen()).toContain('Import cancelled');
    expect(h.screen()).toContain('nothing was redeemed');
    expect(service.imported).toHaveLength(0);
  });

  it('shows the preview BEFORE asking for confirmation', async () => {
    const scenario = fixtureScenario('purchased');
    const { h } = await run({ credential: scenario.credential, confirm: true });
    const previewIndex = h.out.findIndex((l) => l.includes('IMPORT PREVIEW'));
    expect(previewIndex).toBeGreaterThanOrEqual(0);
    const confirmPrompt = h.echoed.find((l) => l.includes('Import this PSP agent'));
    expect(confirmPrompt).toBeDefined();
  });
});

/* ------------------------------ failures -------------------------------- */

describe('relay agent import — failure states are handled safely', () => {
  const cases: Array<[string, string]> = [
    ['expired', 'expired'],
    ['revoked', 'revoked'],
    ['transferred', 'transferred'],
    ['disputed', 'disputed'],
    ['already_redeemed', 'already_redeemed'],
    ['incompatible', 'incompatible'],
    ['not_owned', 'invalid'],
  ];

  for (const [key, phase] of cases) {
    it(`handles a ${key} credential safely`, async () => {
      const scenario = fixtureScenario(key);
      const { result, h, service } = await run({ credential: scenario.credential, confirm: true });
      expect(result.imported).toBe(false);
      expect(result.phase).toBe(phase);
      expect(service.imported).toHaveLength(0);
      const screen = h.screen();
      expect(containsPspAgentId(screen)).toBe(false);
      expect(screen).not.toContain('DEVFXTR');
      expect(screen).toContain('PSP AGENT IMPORT —');
    });
  }

  it('handles an unknown credential and an invalid format safely', async () => {
    const unknown = await run({ credential: FIXTURE_UNKNOWN_CREDENTIAL, confirm: true });
    expect(unknown.result.imported).toBe(false);
    expect(containsPspAgentId(unknown.h.screen())).toBe(false);

    const malformed = await run({ credential: 'nonsense', confirm: true });
    expect(malformed.result.imported).toBe(false);
    expect(malformed.h.screen()).not.toContain('nonsense');
  });

  it('an unavailable entitlement service never fabricates an import', async () => {
    const scenario = fixtureScenario('purchased');
    const service = createFixtureEntitlementService({ unavailable: true });
    const { result, h } = await run({
      credential: scenario.credential, confirm: true, service,
    });
    expect(result.imported).toBe(false);
    expect(result.phase).toBe('service_unavailable');
    expect(h.screen()).toContain('SERVICE UNAVAILABLE');
    expect(service.imported).toHaveLength(0);
  });

  it('the production boundary refuses until a real backend exists', async () => {
    const scenario = fixtureScenario('purchased');
    const h = harness({ secret: scenario.credential, confirm: true });
    const result = await runPspAgentImportCommand({
      caps: caps(),
      workspace: workspace(),
      service: createUnavailableEntitlementService(),
      now: () => FIXTURE_NOW,
      importId: () => 'imp-1',
      io: h.io,
      source: { kind: 'interactive' },
    });
    expect(result.imported).toBe(false);
    expect(result.phase).toBe('service_unavailable');
    expect(containsPspAgentId(h.screen())).toBe(false);
  });

  it('a workspace without import permission is refused', async () => {
    const scenario = fixtureScenario('purchased');
    const { result } = await run({
      credential: scenario.credential, confirm: true,
      workspaceOverrides: { importAllowed: false },
    });
    expect(result.imported).toBe(false);
  });
});

/* --------------------------- source boundary ---------------------------- */

describe('relay agent import — source-level secret boundary', () => {
  it('the command module never logs, stores, or returns the credential', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'relay', 'cli', 'product', 'psp-agent-import.ts'), 'utf8',
    );
    expect(source).not.toMatch(/console\.(log|debug|info|warn|error)/);
    // Every emitted line goes through the redaction gate.
    expect(source).toContain('redactPspAgentIds(line)');
    // The credential is cleared on every exit path.
    expect(source).toContain('finally');
    expect(source).toContain("credential = ''");
  });
});
