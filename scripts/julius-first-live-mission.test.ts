import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseLiveMissionContract } from '../relay-bridge/julius-live-mission';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from '../relay-bridge/julius/executor-effects';
import { PREFLIGHT_LIMITS, PREFLIGHT_POLICY } from './julius-live-preflight';

/**
 * THE FIRST LIVE MISSION'S SAFETY CONTRACT.
 *
 * This is the only workflow in the repository that may spend provider money
 * and hand a live coding agent a writable filesystem. Everything protecting
 * that is configuration — a trigger list, an `if:` expression, a flag, a
 * cleanup step — and configuration decays silently. These cases hold the
 * arrangement to what it claims:
 *
 *   1. nothing but a human dispatch can start it;
 *   2. the paid stage is gated twice more, and the unpaid stage cannot pay;
 *   3. no credential is written into the repository, and none can leave in an
 *      artifact;
 *   4. the mission is bounded — spend, repairs, ticks — and aimed at a
 *      throwaway directory rather than at this checkout;
 *   5. the sandbox the preflight proves is the SAME sandbox the mission uses;
 *   6. what the job creates, the job destroys.
 *
 * They are deliberately assertions about the real files, not about a fixture:
 * each one reads the workflow, the contract or the production constant it is
 * protecting.
 */

const ROOT = resolve(import.meta.dirname, '..');
const WORKFLOW_PATH = '.github/workflows/julius-first-live-mission.yml';
const CONTRACT_PATH = '.github/julius-first-live-mission.json';
const read = (relative: string): string => readFileSync(resolve(ROOT, relative), 'utf8');

const workflow = read(WORKFLOW_PATH);
const contractSource = read(CONTRACT_PATH);

/** The workflow's `on:` block, up to the next top-level key. */
const triggerBlock = (): string => {
  const start = workflow.indexOf('\non:');
  expect(start, 'the workflow must declare an `on:` block').toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const end = rest.search(/\n(?=[a-z])/u);
  return end < 0 ? rest : rest.slice(0, end);
};

describe('only a human dispatch can start the live mission', () => {
  it('declares workflow_dispatch and no automatic trigger', () => {
    const triggers = triggerBlock();
    expect(triggers, 'the workflow must be dispatchable by hand').toMatch(/workflow_dispatch:/u);
    // A `push:`/`pull_request:`/`schedule:` trigger would let a commit or a
    // clock spend provider money with nobody deciding to.
    for (const forbidden of ['push:', 'pull_request:', 'schedule:', 'repository_dispatch:', 'workflow_call:', 'issue_comment:']) {
      expect(triggers, `\`${forbidden}\` would start a paid mission without a human`).not.toContain(forbidden);
    }
  });

  it('runs one mission at a time and never cancels one in flight', () => {
    expect(workflow, 'two concurrent live missions would race for one workspace and one executor')
      .toMatch(/concurrency:\s*\n\s*group:\s*julius-first-live-mission\s*\n\s*cancel-in-progress:\s*false/u);
  });

  it('isolates the provider credentials in a dedicated GitHub Environment', () => {
    expect(workflow, 'live provider secrets must not sit beside ordinary CI')
      .toMatch(/environment:\s*julius-live-validation/u);
  });

  it('pins every action to an immutable commit SHA with a readable version beside it', () => {
    const uses = workflow.split('\n').filter((line) => /^\s*-?\s*uses\s*:/.test(line) && !/^\s*#/.test(line));
    expect(uses.length, 'the workflow must use at least one action').toBeGreaterThan(0);
    for (const line of uses) {
      const reference = /uses\s*:\s*['"]?([^'"\s]+)/.exec(line)?.[1] ?? '';
      const version = reference.slice(reference.lastIndexOf('@') + 1);
      expect(version, `${reference} must be pinned to a 40-character commit SHA, not a movable tag`)
        .toMatch(/^[0-9a-f]{40}$/u);
      expect(line, `${reference} must keep a "# v…" comment so the pin is reviewable`).toMatch(/#\s*v?\d/u);
    }
  });
});

describe('the paid stage is gated, and the unpaid stage cannot pay', () => {
  const liveStep = (): string => {
    const start = workflow.indexOf("- name: 'LIVE: run the first real Julius mission'");
    expect(start, 'the live step must exist').toBeGreaterThan(-1);
    const rest = workflow.slice(start);
    const end = rest.indexOf('\n      - ', 1);
    return end < 0 ? rest : rest.slice(0, end);
  };

  it('the live step requires the exact typed confirmation', () => {
    expect(liveStep(), 'the live step must be gated on the exact dispatch phrase')
      .toMatch(/if:\s*inputs\.confirm_live == 'RUN LIVE MISSION'/u);
  });

  it('the live step passes --confirm-live, so Julius gates it a third time', () => {
    expect(liveStep()).toContain('--confirm-live');
  });

  it('the live step bounds the run loop with a finite tick ceiling', () => {
    expect(liveStep(), 'an unbounded run loop can spend until the budget stops it')
      .toMatch(/--max-ticks/u);
    expect(workflow, 'max_ticks must have a finite default').toMatch(/max_ticks:[\s\S]*?default:\s*'\d+'/u);
  });

  it('the preflight role-resolution step never passes --confirm-live', () => {
    const start = workflow.indexOf("- name: 'Preflight: all three roles resolve");
    expect(start).toBeGreaterThan(-1);
    const rest = workflow.slice(start);
    const end = rest.indexOf('\n      - ', 1);
    const step = end < 0 ? rest : rest.slice(0, end);
    // What matters is the INVOCATION, not the prose: this step's comment and
    // its failure message both name the flag while deliberately not passing
    // it, and a whole-step scan would read either as the flag itself.
    const invocations = step.split('\n').filter((line) => line.includes('relay:julius:mission'));
    expect(invocations.length, 'the preflight step must invoke the entrypoint exactly once').toBe(1);
    expect(invocations[0], 'the unpaid preflight must not be able to dispatch a provider')
      .not.toContain('--confirm-live');
    // Exit 5 is the entrypoint's "ready, nothing contacted" answer. Accepting
    // any other code would let a half-configured rig read as ready.
    expect(step).toMatch(/-ne 5/u);
  });

  it('pins all three roles to the models the founder named', () => {
    expect(workflow).toMatch(/OPENAI_PROMPT_ARCHITECT_MODEL:\s*gpt-5\.6-sol/u);
    expect(workflow).toMatch(/RELAY_HOSTED_CODING_MODEL:\s*claude-fable-5/u);
    expect(workflow).toMatch(/RELAY_HERMES_PROVIDER:\s*xai/u);
    expect(workflow).toMatch(/RELAY_HERMES_MODEL:\s*grok-build-0\.1/u);
    // And proves what actually resolved, rather than trusting what was set.
    expect(workflow).toContain('architect=gpt-5.6-sol');
    expect(workflow).toContain('coder=claude-fable-5');
    expect(workflow).toContain('reviewer=xai/grok-build-0.1');
  });

  it('configures no fallback provider and no scripted adapter', () => {
    // The composition has no import through which a scripted adapter could
    // arrive; this guards the other end — a deployment variable that would
    // stand something in for a real provider.
    for (const forbidden of ['RELAY_PROMPT_ARCHITECT_MODE: mock', 'RELAY_PROMPT_ARCHITECT_MODE: fake', 'FALLBACK', 'SIMULATED', 'DRY_RUN']) {
      expect(workflow, `${forbidden} would let something other than a live provider answer`).not.toContain(forbidden);
    }
    expect(workflow, 'the architect must be in live mode or not run at all').toMatch(/RELAY_PROMPT_ARCHITECT_MODE:\s*live/u);
  });
});

describe('no credential is committed, and none can leave the runner', () => {
  it('references every provider secret by name only', () => {
    for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY']) {
      expect(workflow, `${name} must be read from the secrets context`).toContain(`secrets.${name}`);
    }
  });

  it('contains no credential-shaped literal', () => {
    // Shapes, never values. Each alternative is a vendor prefix followed by
    // enough characters to be usable.
    const shaped = /(sk-[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AKIA[A-Z0-9]{12,}|-----BEGIN)/u;
    for (const file of [WORKFLOW_PATH, CONTRACT_PATH, '.github/julius-live-hermes.sh', '.github/julius-live-workspace.sh']) {
      expect(shaped.test(read(file)), `${file} must contain no credential-shaped literal`).toBe(false);
    }
  });

  it('masks the ephemeral executor credentials before they can reach a log', () => {
    expect(workflow, 'a derived credential printed once is a credential in the log forever')
      .toContain('::add-mask::');
    expect(workflow).toMatch(/julius-derive-scoped-credentials\.mjs --values/u);
  });

  it('scans the evidence for credential shapes and refuses to upload when it finds any', () => {
    const start = workflow.indexOf('- name: Refuse to publish evidence');
    expect(start, 'evidence must be scanned before it leaves the runner').toBeGreaterThan(-1);
    const rest = workflow.slice(start);
    const step = rest.slice(0, rest.indexOf('\n      - ', 1));
    expect(step).toContain('rm -rf julius-live-evidence');
    expect(step).toMatch(/exit 1/u);
    // The scan must run before the upload, or it protects nothing.
    expect(start, 'the scan must precede the upload step').toBeLessThan(workflow.indexOf('upload-artifact'));
  });

  it('uploads only the curated evidence directory, never the environment or a config file', () => {
    expect(workflow).toMatch(/path:\s*julius-live-evidence/u);
    for (const forbidden of ['printenv', 'env > ', 'env >>', '${{ toJSON(secrets) }}', 'auth.json']) {
      expect(workflow, `${forbidden} would put secret-bearing material in an artifact`).not.toContain(forbidden);
    }
  });

  it('keeps the reviewer credential out of the child environment by construction', () => {
    // `runHermesReview` forwards only PATH and HOME. The workflow must
    // therefore hand the reviewer its profile through HOME — passing
    // XAI_API_KEY into the live step would be a boundary change that does
    // nothing, and reads as if the credential flows through Julius.
    const start = workflow.indexOf("- name: 'LIVE: run the first real Julius mission'");
    const rest = workflow.slice(start);
    const step = rest.slice(0, rest.indexOf('\n      - ', 1));
    expect(step, 'the reviewer profile reaches Hermes through HOME').toMatch(/HOME:\s*\/tmp\/julius-hermes-home/u);
    expect(step, 'XAI_API_KEY in the live step would never reach the reviewer child anyway')
      .not.toContain('XAI_API_KEY');
  });
});

describe('what the job creates, the job destroys', () => {
  it('always runs cleanup, and removes the reviewer profile and the signing key', () => {
    const start = workflow.indexOf('- name: Destroy everything this job created');
    expect(start, 'a cleanup step must exist').toBeGreaterThan(-1);
    const step = workflow.slice(start);
    expect(step, 'cleanup must run even when the mission fails').toMatch(/if:\s*always\(\)/u);
    expect(step, 'the profile holds the xAI credential and must not outlive the job').toContain('rm -rf /tmp/julius-hermes-home');
    expect(step, 'the ephemeral signing key must not outlive the job').toContain('/tmp/julius-executor');
    expect(step, 'the workspace tmpfs must be unmounted').toContain('umount');
    expect(step, 'sandboxes must be destroyed').toContain("--filter 'label=julius.sandbox'");
  });

  it('generates the executor identity per-job rather than provisioning a durable secret', () => {
    expect(workflow, 'the signing key is ephemeral').toContain('openssl genpkey -algorithm ED25519');
    expect(workflow, 'the credential root is ephemeral').toContain('openssl rand -base64 33');
    expect(workflow, 'a durable executor secret would need rotating and could leak between runs')
      .not.toContain('secrets.EXECUTOR_CREDENTIAL_ROOT');
  });
});

describe('the sandbox proven by preflight is the sandbox the mission uses', () => {
  it('the preflight probe declares the live composition limits exactly', () => {
    expect(PREFLIGHT_LIMITS).toEqual(EXECUTOR_SANDBOX_LIMITS);
  });

  it('the preflight probe declares the live composition policy exactly', () => {
    expect(PREFLIGHT_POLICY).toEqual(EXECUTOR_SANDBOX_POLICY);
  });

  it('the sandbox denies network, so no worker can reach a provider through a tool', () => {
    expect(EXECUTOR_SANDBOX_POLICY.network).toBe('DENY');
    expect(PREFLIGHT_POLICY.network).toBe('DENY');
  });

  it('the workspace tmpfs is mounted at exactly the ceiling the executor enforces', () => {
    const provisioning = read('.github/julius-live-workspace.sh');
    // The executor refuses a workspace whose BACKING FILESYSTEM is larger than
    // the declared ceiling, so these two numbers must be the same number.
    expect(provisioning).toContain(`WORKSPACE_BYTES=${EXECUTOR_SANDBOX_LIMITS.workspaceBytes}`);
    expect(provisioning, 'inode allowance is part of the ceiling; df and du both report it as zero')
      .toContain('nr_inodes=$((WORKSPACE_BYTES / 1024))');
  });
});

describe('the mission itself is bounded and aimed away from this repository', () => {
  const parsed = parseLiveMissionContract(contractSource);

  it('is a contract the live entrypoint accepts', () => {
    expect(parsed.ok ? 'accepted' : parsed.problem).toBe('accepted');
  });

  it('states its own spend and repair ceilings rather than inheriting defaults', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.problem);
    expect(parsed.contract.limits?.spendUsd).toBeLessThanOrEqual(5);
    expect(parsed.contract.limits?.repairCycles).toBeLessThanOrEqual(1);
  });

  it('carries at least one blocking acceptance criterion', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.problem);
    expect(parsed.contract.acceptanceCriteria.some((criterion) => criterion.blocking)).toBe(true);
  });

  it('points the coding agent outside this checkout', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.problem);
    const workspace = resolve(parsed.contract.workspacePath);
    const repository = realpathSync(ROOT);
    expect(
      workspace === repository || workspace.startsWith(repository + sep),
      'a live coding agent pointed at the Relay checkout would be editing the code that governs it',
    ).toBe(false);
  });

  it('declares a test command that can run with no network and no dependency', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.problem);
    // The sandbox is `--network none` and holds no node_modules, so anything
    // that would fetch or resolve a package cannot pass.
    expect(parsed.contract.testCommand).toMatch(/^node --test /u);
    for (const forbidden of ['npm ', 'npx ', 'yarn ', 'pnpm ']) {
      expect(parsed.contract.testCommand).not.toContain(forbidden);
    }
  });

  it('is refused by the contract checker when its ceilings are raised', () => {
    const directory = mkdtempSync(join(tmpdir(), 'julius-live-contract-'));
    const check = (contract: unknown): { code: number; output: string } => {
      // A real file, not `/dev/stdin`: the checker reads its argument with
      // readFileSync, and reading a pipe that way is not dependable.
      const file = join(directory, `contract-${randomUUID()}.json`);
      writeFileSync(file, JSON.stringify(contract));
      try {
        const output = execFileSync(
          process.execPath,
          [resolve(ROOT, 'scripts/julius-live-contract-check.mjs'), file],
          { encoding: 'utf8', cwd: ROOT },
        );
        return { code: 0, output };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string };
        return { code: failure.status ?? 1, output: failure.stdout ?? '' };
      }
    };
    const base = JSON.parse(contractSource) as Record<string, unknown>;

    expect(check(base).code, 'the committed contract must pass its own checker').toBe(0);

    const overspend = check({ ...base, limits: { spendUsd: 50, repairCycles: 1 } });
    expect(overspend.code).toBe(1);
    expect(overspend.output).toContain('above the 5 ceiling');

    const overRepair = check({ ...base, limits: { spendUsd: 5, repairCycles: 9 } });
    expect(overRepair.code).toBe(1);
    expect(overRepair.output).toContain('above the 1 allowed');

    const intoRepository = check({ ...base, workspacePath: resolve(ROOT, 'src') });
    expect(intoRepository.code).toBe(1);
    expect(intoRepository.output).toContain('inside this repository');

    const unbounded = check({ ...base, limits: undefined });
    expect(unbounded.code).toBe(1);
    expect(unbounded.output).toContain('limits must be present');
  });
});
