import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { parseLiveMissionContract } from '../relay-bridge/julius-live-mission';
import { EXECUTOR_SANDBOX_LIMITS, EXECUTOR_SANDBOX_POLICY } from '../relay-bridge/julius/executor-effects';
import { HOSTED_ALLOWED_TOOLS, HOSTED_DISALLOWED_TOOLS } from '../relay-bridge/hosted-coding-agent/hosted-envelope';
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

  it('runs one LIVE mission at a time and never cancels one in flight', () => {
    // Dry runs get a per-run group (see the F6 cases); paid runs share one.
    expect(workflow, 'two concurrent live missions would race for one workspace and one executor')
      .toMatch(/concurrency:\s*\n\s*group:\s*julius-first-live-mission-\$\{\{ inputs\.confirm_live == 'RUN LIVE MISSION' && 'live' \|\| github\.run_id \}\}\s*\n\s*cancel-in-progress:\s*false/u);
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
    // Exit 5 (asserted above) is what proves the roles resolved; these pin
    // WHICH models were configured. The served model is observed during the run.
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
    const identity = read('.github/julius-live-identity.sh');
    expect(identity, 'a derived credential printed once is a credential in the log forever')
      .toContain('::add-mask::');
    expect(identity).toMatch(/julius-derive-scoped-credentials\.mjs --values/u);
    expect(workflow, 'the mission mints its identity through the shared script').toContain('./.github/julius-live-identity.sh');
  });

  it('scans the evidence for credential shapes and refuses to upload when it finds any', () => {
    const start = workflow.indexOf('- name: Refuse to publish evidence');
    expect(start, 'evidence must be scanned before it leaves the runner').toBeGreaterThan(-1);
    const rest = workflow.slice(start);
    const step = rest.slice(0, rest.indexOf('\n      - ', 1));
    expect(step).toContain('rm -rf julius-live-evidence');
    expect(step).toMatch(/exit 1/u);
    // The scan must run before the EVIDENCE upload, or it protects nothing.
    // (The completion-marker upload legitimately comes earlier and carries
    // only provenance fields — its own test proves that.)
    expect(start, 'the scan must precede the evidence upload step')
      .toBeLessThan(workflow.indexOf('name: julius-live-evidence'));
  });

  it('uploads only the curated evidence directory, never the environment or a config file', () => {
    expect(workflow).toMatch(/path:\s*julius-live-evidence/u);
    for (const forbidden of ['printenv', 'env > ', 'env >>', '${{ toJSON(secrets) }}', 'auth.json']) {
      expect(workflow, `${forbidden} would put secret-bearing material in an artifact`).not.toContain(forbidden);
    }
  });

  it('gives the reviewer profile to the reviewer alone, not to the coding agent', () => {
    // `runHermesReview` forwards only PATH and HOME, so HOME is how the
    // reviewer receives its credential. But the live Claude coding agent is a
    // child of the SAME process and holds Read/Glob/Grep, so a job-wide HOME
    // pointed at the profile would hand it the xAI key too. The credential is
    // therefore redirected by a wrapper at exec time, for that child only.
    const start = workflow.indexOf("- name: 'LIVE: run the first real Julius mission'");
    const rest = workflow.slice(start);
    const step = rest.slice(0, rest.indexOf('\n      - ', 1));
    const assignments = step.split('\n').filter((line) => !/^\s*#/.test(line));
    expect(
      assignments.some((line) => /^\s*HOME:/.test(line)),
      'a job-wide HOME would give the live coding agent the directory holding the xAI credential',
    ).toBe(false);
    expect(step, 'the reviewer is spawned through the redirecting wrapper')
      .toMatch(/RELAY_HERMES_EXECUTABLE:\s*\/tmp\/julius-hermes-bin\/hermes/u);
    expect(step, 'XAI_API_KEY in the live step would never reach the reviewer child anyway')
      .not.toContain('XAI_API_KEY');
  });

  it('the wrapper, not the workflow, is what redirects HOME for Hermes', () => {
    const wrapper = read('.github/julius-live-hermes.sh');
    expect(wrapper, 'the wrapper must set HOME for the Hermes child at exec time')
      .toMatch(/exec env HOME="\$HERMES_PROFILE_HOME"/u);
    expect(wrapper, 'the credential must be proven resolvable with HERMES_HOME unset, as Julius spawns it')
      .toContain('env -u HERMES_HOME');
  });
});

describe('what the job creates, the job destroys', () => {
  it('always runs cleanup, and removes the reviewer profile and the signing key', () => {
    const start = workflow.indexOf('- name: Destroy everything this job created');
    expect(start, 'a cleanup step must exist').toBeGreaterThan(-1);
    const step = workflow.slice(start);
    expect(step, 'cleanup must run even when the mission fails').toMatch(/if:\s*always\(\)/u);
    expect(step, 'the profile holds the xAI credential and must not outlive the job').toContain('rm -rf /tmp/julius-hermes-home');
    // The signing key, receipts and ledger live inside the executor
    // container's own layer, so removing the container removes them — and the
    // F4 cases prove the host never held the key to begin with.
    expect(step, 'removing the executor container is what destroys its private material')
      .toContain('docker rm -f julius-executor');
    expect(step, 'the workspace tmpfs must be unmounted').toContain('umount');
    expect(step, 'sandboxes must be destroyed').toContain("--filter 'label=julius.sandbox'");
  });

  it('generates the executor identity per-job rather than provisioning a durable secret', () => {
    // The signing key is minted INSIDE the executor container (the F4 cases
    // prove where); this one proves nothing durable exists on either side.
    expect(read('.github/julius-executor-entrypoint.sh'), 'the signing key is ephemeral and executor-born')
      .toContain('generateKeyPairSync');
    expect(read('.github/julius-live-identity.sh'), 'the credential root is ephemeral').toContain('openssl rand -base64 33');
    for (const file of [WORKFLOW_PATH, '.github/julius-live-identity.sh', '.github/julius-live-executor.sh']) {
      expect(read(file), 'a durable executor secret would need rotating and could leak between runs')
        .not.toContain('secrets.EXECUTOR_CREDENTIAL_ROOT');
    }
  });
});

describe('the sandbox proven by preflight is the sandbox the mission uses', () => {
  it('the preflight probe declares the live composition limits exactly', () => {
    expect(PREFLIGHT_LIMITS).toEqual(EXECUTOR_SANDBOX_LIMITS);
    // Dry run 33625851653: two copies that this equality once blessed had
    // drifted together, 4,767 bytes above the executor's ceiling. Equality of
    // copies proves nothing about the executor; the preflight must send the
    // live composition's object itself, so there is only one thing to be wrong.
    expect(PREFLIGHT_LIMITS, 'the preflight must import the live limits, never keep a copy').toBe(EXECUTOR_SANDBOX_LIMITS);
  });

  it('the preflight probe declares the live composition policy exactly', () => {
    expect(PREFLIGHT_POLICY).toEqual(EXECUTOR_SANDBOX_POLICY);
    expect(PREFLIGHT_POLICY, 'the preflight must import the live policy, never keep a copy').toBe(EXECUTOR_SANDBOX_POLICY);
  });

  it('both sides read the one shared limits module, and neither keeps an output number of its own', () => {
    const shared = 'relay-bridge/julius/sandbox-limits';
    expect(read('scripts/julius-live-preflight.ts')).toContain(`from '../${shared}'`);
    expect(read('relay-bridge/julius/executor-effects.ts')).toContain("from './sandbox-limits'");
    for (const file of ['scripts/julius-live-preflight.ts', 'relay-bridge/julius/executor-effects.ts']) {
      expect(read(file), `${file} must not carry its own outputBytes literal`).not.toMatch(/outputBytes:\s*\d/u);
    }
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

  it('asks only for edits, because the hosted agent is denied file creation', () => {
    // `HOSTED_DISALLOWED_TOOLS` includes `Write`: the coding agent can Edit an
    // existing file but cannot bring a new one into existence. A mission that
    // asks for a new file is a paid run that cannot complete.
    expect(HOSTED_DISALLOWED_TOOLS, 'this test exists because Write is denied').toContain('Write');
    expect(HOSTED_ALLOWED_TOOLS).toContain('Edit');

    const provisioning = read('.github/julius-live-workspace.sh');
    const contract = JSON.parse(contractSource) as { objective: string; requirements: string[] };
    const deliverables = ['julius-live-proof.js', 'julius-live-proof.test.js'];
    for (const file of deliverables) {
      expect(provisioning, `${file} must be seeded in the workspace, not created by the agent`)
        .toContain(`cat > ${file} <<'JAVASCRIPT'`);
      // Tracked, or `git diff` cannot see the agent's work at all.
      expect(provisioning, `${file} must be committed so the captured diff is non-empty`)
        .toMatch(new RegExp(`add[^\\n]*${file.replace('.', '\\.')}`, 'u'));
    }
    const asks = [contract.objective, ...contract.requirements].join(' ');
    expect(asks, 'the contract must ask for edits, never for a new file').not.toMatch(/\bCreate\b/u);
  });

  it('seeds deliverables whose test command FAILS until the work is really done', () => {
    // A stub test that passes would let the mission satisfy its TEST evidence
    // having implemented nothing — the machine-checkable half of completion,
    // satisfied by doing no work. So the seeded pair is actually executed here.
    const provisioning = read('.github/julius-live-workspace.sh');
    const directory = mkdtempSync(join(tmpdir(), 'julius-live-stubs-'));
    for (const file of ['julius-live-proof.js', 'julius-live-proof.test.js']) {
      const block = new RegExp(`cat > ${file.replace(/\./gu, '\\.')} <<'JAVASCRIPT'\\n([\\s\\S]*?)\\nJAVASCRIPT\\n`, 'u');
      const seeded = block.exec(provisioning);
      expect(seeded, `${file} must be seeded by the provisioning script`).not.toBeNull();
      writeFileSync(join(directory, file), `${(seeded as RegExpExecArray)[1]}\n`);
    }
    const parsed = parseLiveMissionContract(contractSource);
    if (!parsed.ok) throw new Error(parsed.problem);
    const [command, ...args] = parsed.contract.testCommand.split(' ');
    expect(command).toBe('node');

    let code = 0;
    try {
      execFileSync(process.execPath, args, { cwd: directory, stdio: 'ignore' });
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
    }
    expect(code, 'the seeded stubs must FAIL the declared test command, or completion is free').not.toBe(0);
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

/* ------------------------------------------------- final pre-live hardening */

/** The `run:` body of a named step, with YAML block indentation stripped. */
const stepScript = (name: string): string => {
  const start = workflow.indexOf(`- name: ${name}`);
  expect(start, `step "${name}" must exist`).toBeGreaterThan(-1);
  const rest = workflow.slice(start);
  const end = rest.indexOf('\n      - ', 1);
  const step = end < 0 ? rest : rest.slice(0, end);
  const body = step.slice(step.indexOf('run: |') + 'run: |'.length);
  return body.split('\n').map((line) => line.replace(/^ {10}/u, '')).join('\n');
};

describe('F4 — the executor owns its signing key, and Julius cannot reach it', () => {
  it('the host never generates or holds private signing material', () => {
    expect(workflow, 'a key minted on the runner is readable by the user that runs Julius')
      .not.toMatch(/openssl genpkey/u);
    const entrypoint = read('.github/julius-executor-entrypoint.sh');
    expect(entrypoint, 'the key must be born inside the executor').toMatch(/generateKeyPairSync\("ed25519"\)/u);
    expect(entrypoint).toMatch(/private\.pem/u);
  });

  it('the private root is not bind-mounted, so the host filesystem cannot see it', () => {
    // The launch moved into a script shared with the Docker regression job, so the
    // mounts are asserted where they are written, and the mission must call it.
    const launch = read('.github/julius-live-executor.sh');
    const start = launch.indexOf('docker run -d --name julius-executor');
    expect(start, 'the shared launch script must start the executor').toBeGreaterThan(-1);
    const run = launch.slice(start, launch.indexOf('./.github/wait-for-executor.sh', start));
    const mounts = run.split('\n').filter((line) => line.includes('-v '));
    expect(mounts.length).toBeGreaterThan(0);
    for (const mount of mounts) {
      expect(mount, 'mounting the private root would hand the key back to the host')
        .not.toContain('executor-private');
    }
    expect(run, 'the executor mints its identity through its own entrypoint')
      .toContain('.github/julius-executor-entrypoint.sh');
    expect(workflow, 'the mission starts its executor through the shared launch script')
      .toContain('./.github/julius-live-executor.sh');
  });

  it('only the public half is exported to Julius, and it is checked', () => {
    const launch = read('.github/julius-live-executor.sh');
    expect(launch).toContain('cat /executor-private/public.pem');
    expect(launch, 'exporting the private half would defeat the whole arrangement')
      .not.toContain('cat /executor-private/private.pem');
    const proof = read('.github/julius-live-key-boundary.sh');
    expect(proof, 'the boundary must be asserted from the side that must not hold the key')
      .toContain('executor_private_key_readable_by_julius');
    expect(proof).toContain('julius_holds_private_key_material');
    expect(proof, 'and the executor must actually have it').toContain('docker exec julius-executor test -f /executor-private/private.pem');
    expect(workflow, 'the mission runs the same boundary proof as the regression').toContain('./.github/julius-live-key-boundary.sh');
  });

  it('the signing key and the ledger stay executor-private; the receipt root is the launch script\u2019s one topology switch', () => {
    const launch = read('.github/julius-live-executor.sh');
    for (const variable of ['EXECUTOR_LEDGER_ROOT', 'EXECUTOR_SIGNING_KEY_PATH']) {
      const line = launch.split('\n').find((entry) => entry.includes(`-e ${variable}=`));
      expect(line, `${variable} must be set on the executor`).toBeDefined();
      expect(line, `${variable} must live under the container-private root`).toContain('/executor-private');
    }
    // The receipt root is what the host daemon must be able to see (the sandbox's receipt
    // directory is bind-mounted from it), so it is a variable, not a literal under the private root.
    expect(launch).toContain('-e EXECUTOR_RECEIPT_ROOT="$receipt_root"');
    expect(launch).toContain('receipt_root=/executor-private/receipts');
    expect(launch).toMatch(/receipt_root=\$JULIUS_RECEIPT_HOST_ROOT/u);
    expect(launch, 'the private root is never among the mounts, whichever transport is chosen')
      .not.toMatch(/-v [^\n]*executor-private/u);
  });

  it('the mission and its Docker regression run the same launch scripts', () => {
    const regression = read('.github/workflows/julius-real-infra.yml');
    expect(regression, 'the provider-free half of the mission must run on real Docker on every relevant PR')
      .toContain('first-live-topology:');
    expect(regression).toMatch(/receipts:\s*\[executor-private, host-visible\]/u);
    for (const script of ['julius-live-images.sh', 'julius-live-identity.sh', 'julius-live-workspace.sh', 'julius-live-executor.sh', 'julius-live-key-boundary.sh']) {
      expect(workflow, `the mission must run ${script}`).toContain(`./.github/${script}`);
      expect(regression, `the regression must run ${script}`).toContain(`./.github/${script}`);
    }
    expect(regression, 'the regression drives the same provider-free preflight').toContain('npm run relay:julius:preflight');
    expect(regression, 'no provider secret may reach the regression').not.toMatch(/secrets\.(OPENAI|ANTHROPIC|XAI)_API_KEY/u);
  });
});

describe('F5 — evidence is built by allowlist, and secrets cannot ride along', () => {
  const buildEvidence = (log: string): string => execFileSync(
    process.execPath,
    [resolve(ROOT, 'scripts/julius-live-evidence.mjs'), '-'],
    { input: log, encoding: 'utf8', cwd: ROOT },
  );

  it('never copies a raw log into the uploaded evidence', () => {
    expect(workflow, 'tee writes raw bytes to disk; ::add-mask:: only redacts the console')
      .not.toMatch(/cp\s+\S*\.log\s+julius-live-evidence/u);
    expect(workflow, 'evidence is rebuilt from an allowlist instead')
      .toContain('node scripts/julius-live-evidence.mjs');
  });

  it('captures executor diagnostics by allowlist and deletes the raw container log before upload', () => {
    const collect = stepScript('Collect the redacted validation evidence');
    expect(collect, 'the raw executor log is written only to a private temp file').toMatch(/umask 077\s*\n\s*raw_executor_log=\$\(mktemp\)/u);
    expect(collect, 'only the executor\u2019s own safe lines may be kept').toContain("grep -E '^executor_(ready|diagnostic)[ :]'");
    expect(collect, 'and only characters a safe line can contain').toContain("grep -E '^[A-Za-z0-9_=:. -]+$'");
    expect(collect, 'the raw log must not survive to the upload step').toContain('rm -f "$raw_executor_log"');
    expect(collect.indexOf('rm -f "$raw_executor_log"'), 'delete before the evidence directory is complete')
      .toBeLessThan(collect.indexOf('dump "SELECT'));
    expect(workflow, 'a raw docker log must never be written into the evidence directory')
      .not.toMatch(/docker logs [^\n]*> *julius-live-evidence/u);
  });

  it('keeps the lines a mission actually needs', () => {
    const output = buildEvidence([
      'RESULT: COMPLETED after 11 ticks',
      '  run: run:abc123',
      '  task run:abc123:plan [PROMPT_ARCHITECT/plan] → SUCCEEDED',
      '  evidence ev:1 [TEST/PASSED] Deterministic test command exited 0.',
      '  verification decisions: ACCEPT, ACCEPT',
      'julius_exit=0',
    ].join('\n'));
    expect(output).toContain('RESULT: COMPLETED after 11 ticks');
    expect(output).toContain('  task run:abc123:plan [PROMPT_ARCHITECT/plan] → SUCCEEDED');
    expect(output).toContain('julius_exit=0');
  });

  it('keeps the failure outcomes — the runs that most need evidence', () => {
    // A paid mission that is BLOCKED or crashes must state its outcome in its
    // own artifact; the first cut of the allowlist kept only success shapes.
    const failures = [
      'RESULT: BLOCKED — nothing was submitted and no provider was contacted.',
      'RESULT: BLOCKED at bootstrap — contract_rejected: the durable store refused.',
      'JULIUS LIVE MISSION crashed: connect ECONNREFUSED 127.0.0.1:5432',
    ];
    const output = buildEvidence(failures.join('\n'));
    for (const line of failures) expect(output, 'failure outcomes are evidence too').toContain(line);
  });

  it('MUTATION: a secret smuggled into a recognised line cannot reach the artifact', () => {
    // Each of these is a real leak shape: a key pasted into an evidence
    // summary, a PEM in a stack trace, an auth header echoed by a client, a
    // connection URL, and an opaque base64url credential of the exact length
    // this job's scoped credentials have. The needle strings are assembled by
    // CONCATENATION so that no credential-shaped literal ever exists in this
    // file — the repository boundary scanner is right to refuse those, and a
    // test about leak prevention should not itself look like a leak.
    const anthropicShaped = ['sk-ant-', 'api03-AAAABBBBCCCCDDDDEEEEFFFF0000'].join('');
    const xaiShaped = ['xai-', '9f2ba7c1d4e6f0aa8b3c5d7e9f1a2b4c'].join('');
    const pemHeader = ['-----BEGIN ', 'PRIVATE KEY-----'].join('');
    const inlineUrl = ['postgresql://julius:', 's3cretp4ssw0rd', '@127.0.0.1:5432/julius'].join('');
    const openaiShaped = ['sk-proj-', 'ZZZZYYYYXXXXWWWWVVVV1111'].join('');
    const opaqueScoped = 'Xk7Qm2Rv9TzLbN4pAeWs6YcHgJdF1uOi3ZrKxVtB0nM';
    // Every needle rides inside a line the allowlist RECOGNISES — otherwise
    // the allowlist drops it first and the secret rejector is never exercised,
    // which is a test that keeps passing after the rule it guards is deleted.
    const smuggled = [
      `  evidence ev:2 [ARTIFACT/PASSED] leaked ${anthropicShaped}`,
      `  finding f:1 blocking=true status=OPEN — token ${xaiShaped}`,
      `  cause: ${pemHeader}`,
      '  cause: Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345',
      `  cause: ${inlineUrl}`,
      `  evidence ev:3 [ARTIFACT/PASSED] ${opaqueScoped}`,
      `  cause: retry with ${openaiShaped}`,
    ];
    const output = buildEvidence(smuggled.join('\n'));
    for (const forbidden of [anthropicShaped, xaiShaped, pemHeader, 'Bearer abcdefghij', 's3cretp4ssw0rd', opaqueScoped, openaiShaped]) {
      expect(output, `${forbidden.slice(0, 12)}… must never reach the uploaded evidence`).not.toContain(forbidden);
    }
    expect(output, 'and the artifact must say how much it withheld').toMatch(/withheld/u);
  });

  it('the layer-one shape scan itself catches a bearer token and a vendor key', () => {
    // This regex guards the files the allowlist never sees — the workspace
    // diff and the reviewer's free-text findings — and this commit history
    // includes one edit that silently broke its Bearer clause. So the REAL
    // pattern is extracted from the workflow and executed, not admired.
    const scanStep = stepScript('Refuse to publish evidence that contains credential material');
    const pattern = /grep -rEq '(.+)' julius-live-evidence/u.exec(scanStep)?.[1];
    expect(pattern, 'the shape scan must exist in the scan step').toBeDefined();

    const matches = (line: string): boolean => {
      try {
        execFileSync('grep', ['-Eq', pattern as string], { input: line, stdio: ['pipe', 'ignore', 'ignore'] });
        return true;
      } catch { return false; }
    };
    const bearer = ['Authorization: Bearer ', 'abcdefghijklmnopqrstuvwxyz012345'].join('');
    expect(matches(bearer), 'a bearer token in a diff or finding must trip the scan').toBe(true);
    expect(matches(['leaked ', 'sk-ant-', 'api03-AAAAAAAAAAAAAAAAAAAAAAAA'].join('')), 'an Anthropic-shaped key must trip the scan').toBe(true);
    expect(matches(['-----BEGIN ', 'PRIVATE KEY-----'].join('')), 'a PEM header must trip the scan').toBe(true);
    expect(matches('  task run:abc [CODING_AGENT/build] → SUCCEEDED'), 'ordinary evidence must not trip it').toBe(false);
  });

  it('the workflow also matches this job\u2019s exact ephemeral values, not only shapes', () => {
    const scan = stepScript('Refuse to publish evidence that contains credential material');
    expect(scan, 'a shape rule cannot know what a derived scoped credential looks like')
      .toContain('grep -rF -f');
    expect(scan, 'the needle file must not survive the step').toContain('rm -f "$needles"');
    expect(scan, 'a leak must delete the evidence, not merely warn').toContain('rm -rf julius-live-evidence');
    expect(workflow.indexOf('Refuse to publish evidence'), 'the scan must precede the upload')
      .toBeLessThan(workflow.indexOf('name: julius-live-evidence'));
  });
});

describe('F8 — Hermes is pinned to an immutable commit', () => {
  const SHA = /^[0-9a-f]{40}$/u;

  it('the workflow default and the script default are the same 40-hex commit', () => {
    const fromWorkflow = /hermes_ref:[\s\S]*?default:\s*'([^']+)'/u.exec(workflow)?.[1] ?? '';
    const fromScript = /HERMES_REF=\$\{HERMES_REF:-([0-9a-zA-Z.]+)\}/u.exec(read('.github/julius-live-hermes.sh'))?.[1] ?? '';
    expect(fromWorkflow, 'a tag can be repointed by its owner').toMatch(SHA);
    expect(fromScript).toMatch(SHA);
    expect(fromScript, 'the two defaults must not drift apart').toBe(fromWorkflow);
  });

  it('a non-SHA ref is refused before anything is installed', () => {
    const script = read('.github/julius-live-hermes.sh');
    expect(script).toContain('hermes_ref_not_a_commit_sha');
    const guardAt = script.indexOf('hermes_ref_not_a_commit_sha');
    expect(guardAt, 'the guard must precede the install').toBeLessThan(script.indexOf('pip install --quiet "git+'));
  });
});

describe('F9 — dispatch inputs are validated before anything is built', () => {
  const gate = (): string => stepScript("'Gate: the dispatch inputs are well formed'");
  const runGate = (env: Record<string, string>): number => {
    try {
      execFileSync('bash', ['-c', gate()], {
        env: { ...process.env, ...env }, stdio: 'ignore', cwd: ROOT,
      });
      return 0;
    } catch (error) {
      return (error as { status?: number }).status ?? 1;
    }
  };
  const base = { MAX_TICKS: '24', CONFIRM_LIVE: '', HERMES_REF: '2ea39daeb1f675d72e5c21c9400f2d58d7e6d71a' };

  it('runs before the install, so a bad dispatch costs nothing', () => {
    expect(workflow.indexOf("- name: 'Gate: the dispatch inputs are well formed'"))
      .toBeLessThan(workflow.indexOf('- name: Install'));
  });

  it('accepts the committed defaults', () => {
    expect(runGate(base)).toBe(0);
  });

  it('refuses a malformed tick count', () => {
    for (const value of ['', 'abc', '12x', '-4', '3.5', ' 12']) {
      expect(runGate({ ...base, MAX_TICKS: value }), `max_ticks='${value}' must be refused`).not.toBe(0);
    }
  });

  it('refuses a tick count outside the bounds, in both directions', () => {
    expect(runGate({ ...base, MAX_TICKS: '7' }), 'below the floor the run is cut off after being paid for').not.toBe(0);
    expect(runGate({ ...base, MAX_TICKS: '33' }), 'above the ceiling the bound stops bounding').not.toBe(0);
    expect(runGate({ ...base, MAX_TICKS: '10000' })).not.toBe(0);
    expect(runGate({ ...base, MAX_TICKS: '8' }), 'the floor itself is allowed').toBe(0);
    expect(runGate({ ...base, MAX_TICKS: '32' }), 'the ceiling itself is allowed').toBe(0);
  });

  it('cannot exceed the entrypoint\u2019s own default bound', () => {
    // `driveJuliusRunToTerminal` defaults to 32 ticks, so the input may only
    // ever tighten Julius's bound, never loosen it.
    expect(gate()).toContain('MAX_ALLOWED=32');
  });

  it('refuses a mistyped confirmation instead of silently running a dry run', () => {
    expect(runGate({ ...base, CONFIRM_LIVE: 'run live mission' })).not.toBe(0);
    expect(runGate({ ...base, CONFIRM_LIVE: 'RUN LIVE MISSION ' })).not.toBe(0);
    expect(runGate({ ...base, CONFIRM_LIVE: 'RUN LIVE MISSION' })).toBe(0);
  });

  it('refuses a mutable Hermes ref', () => {
    expect(runGate({ ...base, HERMES_REF: 'v0.18.2' })).not.toBe(0);
    expect(runGate({ ...base, HERMES_REF: 'main' })).not.toBe(0);
    expect(runGate({ ...base, HERMES_REF: '2ea39da' }), 'a short SHA is still ambiguous').not.toBe(0);
  });
});

describe('F6 — a paid mission cannot be run twice by accident', () => {
  it('live dispatches share one concurrency group; dry runs do not', () => {
    const group = /concurrency:\s*\n\s*group:\s*(.+)/u.exec(workflow)?.[1] ?? '';
    expect(group, 'live runs must serialise').toContain("'live'");
    expect(group, 'dry runs must stay unlimited and parallel').toContain('github.run_id');
    expect(workflow, 'a live run must never be cancelled mid-flight').toMatch(/cancel-in-progress:\s*false/u);
  });

  it('a completed paid run publishes a marker carrying no secret', () => {
    const marker = stepScript('Record that a paid mission completed');
    expect(marker).toContain('run_id=');
    expect(marker).toContain('commit=');
    for (const forbidden of ['API_KEY', 'SCOPED', 'PASSWORD', 'printenv', 'private.pem']) {
      expect(marker, `${forbidden} must never enter the durable marker`).not.toContain(forbidden);
    }
    expect(workflow, 'the marker is published only when a PAID run succeeded')
      .toMatch(/if: success\(\) && inputs\.confirm_live == 'RUN LIVE MISSION'/u);
  });

  it('a second paid dispatch is refused unless the operator acknowledges it', () => {
    const guard = stepScript("'Gate: a paid first-live mission has not already completed'");
    expect(guard).toContain('julius_first_live_already_completed');
    // Unknown is not zero: a failed marker QUERY must refuse like a found
    // marker does, behind the same acknowledgement — not read as "no marker".
    expect(guard, 'an unreadable marker list must not pass as a first run')
      .toContain('julius_first_live_marker_unknown');
    expect(guard, 'the query result must be branched on, never defaulted to zero')
      .not.toContain('|| echo 0');
    expect(guard, 'the guard reads the completion marker artifact').toContain('julius-first-live-completed');
    expect(guard, 'and can only be overridden by an explicit typed phrase').toContain('RERUN PAID MISSION');
    expect(workflow, 'the guard applies to live dispatches only, so dry runs stay repeatable')
      .toMatch(/- name: 'Gate: a paid first-live mission has not already completed'\n\s*if: inputs\.confirm_live == 'RUN LIVE MISSION'/u);
    expect(workflow, 'listing artifacts needs actions:read and nothing more')
      .toMatch(/permissions:[\s\S]*?actions: read/u);
  });

  it('the guard runs before any credential or container exists', () => {
    expect(workflow.indexOf("- name: 'Gate: a paid first-live mission has not already completed'"))
      .toBeLessThan(workflow.indexOf('- name: Create the ephemeral scoped credentials'));
  });
});
