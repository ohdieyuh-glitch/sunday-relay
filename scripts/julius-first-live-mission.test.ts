import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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

  it('the live step requires the exact typed confirmation, and a clean run behind it', () => {
    expect(liveStep(), 'the live step must be gated on the exact dispatch phrase')
      .toMatch(/if:\s*success\(\) && inputs\.confirm_live == 'RUN LIVE MISSION'/u);
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

describe('the evidence dump names only tables and columns the migrations create', () => {
  // Free dry runs #1 and #2 uploaded `unavailable` for evidence.tsv and findings.tsv: the inline
  // queries named `type` where the table has `evidence_type`, and `julius_findings` where the
  // table is `julius_reviewer_findings`, and psql's refusal became a silent placeholder. The
  // queries now live in one script the mission runs and the Docker regression validates against
  // a migrated database; this case holds them to the migration SQL offline as well.
  const migrationsDirectory = resolve(ROOT, 'src/relay/persistence/wonderland-migrations');
  const schema = (): Map<string, Set<string>> => {
    const tables = new Map<string, Set<string>>();
    const files = readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = readFileSync(join(migrationsDirectory, file), 'utf8');
      for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? relay_wonderland\.([a-z_]+)\s*\(([\s\S]*?)\n\);/gu)) {
        const columns = new Set<string>();
        for (const line of match[2].split(/[,\n]/u)) {
          const column = /^\s*([a-z_]+)\s+(?:text|jsonb|bigint|integer|boolean|timestamptz|numeric|double precision|bytea)\b/u.exec(line);
          if (column) columns.add(column[1]);
        }
        tables.set(match[1], columns);
      }
      for (const match of sql.matchAll(/ALTER TABLE relay_wonderland\.([a-z_]+)([\s\S]*?);/gu)) {
        const columns = tables.get(match[1]) ?? new Set<string>();
        for (const added of match[2].matchAll(/ADD COLUMN(?: IF NOT EXISTS)? ([a-z_]+)/gu)) columns.add(added[1]);
        tables.set(match[1], columns);
      }
    }
    return tables;
  };

  const queries = (): Array<{ file: string; table: string; columns: string[]; orderBy: string[] }> => {
    const script = read('.github/julius-live-evidence-dump.sh');
    const found: Array<{ file: string; table: string; columns: string[]; orderBy: string[] }> = [];
    for (const match of script.matchAll(/dump "SELECT ([a-z_,]+) FROM relay_wonderland\.([a-z_]+)(?: ORDER BY ([a-z_,]+))?" ([a-z-]+\.tsv)/gu)) {
      found.push({ file: match[4], table: match[2], columns: match[1].split(','), orderBy: match[3] ? match[3].split(',') : [] });
    }
    return found;
  };

  it('the mission runs the dump script, and only the dump script, for its table evidence', () => {
    const collect = stepScript('Collect the redacted validation evidence');
    expect(collect).toContain('./.github/julius-live-evidence-dump.sh julius-live-evidence');
    expect(workflow, 'an inline query would drift away from the validated script again').not.toContain('dump "SELECT');
  });

  it('every dumped table exists and every selected or ordered column is a real column', () => {
    const tables = schema();
    const dumps = queries();
    const everyDumpedFile = [...read('.github/julius-live-evidence-dump.sh').matchAll(/" ([a-z-]+\.tsv)$/gmu)].map((match) => match[1]).sort();
    expect(everyDumpedFile, 'every file the script writes, including the ones this regex cannot parse')
      .toEqual(['decisions.tsv', 'evidence.tsv', 'failures.tsv', 'findings.tsv', 'reviewer-diagnostics.tsv', 'runs.tsv', 'tasks.tsv', 'tool-invocations.tsv']);
    expect(dumps.map((dump) => dump.file).sort()).toEqual(['decisions.tsv', 'evidence.tsv', 'findings.tsv', 'runs.tsv', 'tasks.tsv', 'tool-invocations.tsv']);
    for (const dump of dumps) {
      const columns = tables.get(dump.table);
      expect(columns, `${dump.file} reads relay_wonderland.${dump.table}, which no migration creates`).toBeDefined();
      for (const column of [...dump.columns, ...dump.orderBy]) {
        expect(columns!.has(column), `${dump.file}: ${dump.table}.${column} is not a column the migrations create`).toBe(true);
      }
    }
  });

  it('is held by the Docker regression against a migrated database as well', () => {
    const regression = read('.github/workflows/julius-real-infra.yml');
    expect(regression).toContain('./.github/julius-live-evidence-dump.sh /tmp/julius-evidence-check');
    expect(regression, 'a stale name must fail the PR, not become a placeholder').toContain('evidence_query_invalid');
  });

  /**
   * THE FACTS BESIDE THE CLASS. Hand-checked for the same reason as the failure
   * query: it joins. It exists because `failures.tsv` can say
   * `review_process_exit` and never which exit code, or
   * `review_output_too_large` and never how many bytes — each a class an
   * operator could otherwise only investigate by paying for another run.
   */
  it('the reviewer diagnostics query exports allowlisted structural keys and no payload', () => {
    const tables = schema();
    const script = read('.github/julius-live-evidence-dump.sh');
    const query = script.split('\n').find((line) => line.includes('reviewer-diagnostics.tsv')) ?? '';
    expect(query, 'the reviewer diagnostics dump must exist').not.toBe('');

    for (const column of ['task_id', 'role']) {
      expect(tables.get('julius_tasks')?.has(column), `julius_tasks.${column} is not a column the migrations create`).toBe(true);
    }

    // EVERY KEY THE SAFE RECORD DEFINES, so a field added to the allowlist
    // without a column here would be collected and then silently not exported.
    for (const key of [
      'reviewStage', 'transport', 'provider', 'servedModel', 'processExitCode', 'timedOut',
      'outputBytesObserved', 'outputByteLimit', 'outputTruncated', 'jsonDetected', 'jsonParseable',
      'reviewObjectCount', 'verdictPresent', 'verdictValid', 'summaryPresent', 'failureShape',
    ]) {
      expect(query, `the diagnostics dump must select ${key}`).toContain(`'${key}'`);
    }
    // No key exists in the allowlist for reviewer text, a summary, a diff or a
    // prompt — so there is nothing to select, and nothing selects one.
    for (const forbidden of ['reviewText', 'summary\'', 'stdout', 'stderr', 'prompt', 'diff']) {
      expect(query.includes(forbidden), `the diagnostics dump must not export ${forbidden}`).toBe(false);
    }
    expect(query, 'the whole payload is never dumped').not.toMatch(/\bpayload\b(?!\s*(?:->|#>))/u);
    // Scoped to rows that actually carry the record, so ordinary events do not
    // become a wall of empty columns.
    expect(query, 'scoped to events carrying a diagnostics object')
      .toContain("jsonb_typeof(e.payload->'facts'->'diagnostics')='object'");
  });

  /**
   * WHY A TASK FAILED, and why this query is checked by hand rather than by the
   * parser above: it joins, so the simple SELECT/FROM regex cannot read it.
   * The first paid attempt is the reason it exists at all — its artifact could
   * say the plan task FAILED and never why.
   */
  it('the failure query reads real columns and exports named fact keys, never a whole payload', () => {
    const tables = schema();
    const script = read('.github/julius-live-evidence-dump.sh');
    const query = script.split('\n').find((line) => line.includes('failures.tsv')) ?? '';
    expect(query, 'the failure dump must exist').not.toBe('');

    // `events` is declared on a single line in 001, which the shared parser
    // above cannot read, so its columns are taken from the migration directly
    // rather than assumed. A column this query names and no migration creates
    // is exactly the defect that made two dry-run artifacts read "unavailable".
    const eventsDdl = /CREATE TABLE relay_wonderland\.events\(([\s\S]*?)\);/u
      .exec(readFileSync(join(migrationsDirectory, '001_wonderland_runtime.sql'), 'utf8'))?.[1] ?? '';
    expect(eventsDdl, 'the events table must exist in the migrations').not.toBe('');
    for (const column of ['event_type', 'payload', 'occurred_at']) {
      expect(new RegExp(`\\b${column}\\s+(?:text|jsonb|timestamptz)\\b`, 'u').test(eventsDdl),
        `events.${column} is not a column the migrations create`).toBe(true);
    }
    for (const column of ['task_id', 'role']) {
      expect(tables.get('julius_tasks')?.has(column), `julius_tasks.${column} is not a column the migrations create`).toBe(true);
    }

    // NAMED KEYS ONLY. Every value below is a machine token by construction —
    // nine JuliusErrorCodes, a class narrowed to /^[a-z][a-z0-9_]{0,63}$/, a
    // continuation reason — so provider text cannot ride out in this file.
    for (const key of ["'code'", "'failureClass'", "'errorRetryable'", "'reasonCode'"]) {
      expect(query, `the failure dump must select ${key}`).toContain(key);
    }
    // Anchored on the column, not on what follows it: `SELECT e.payload FROM …`
    // is the most natural way to dump the one column with room for anything,
    // and an earlier form of this assertion did not catch it.
    expect(query, 'the whole payload is never dumped')
      .not.toMatch(/\bpayload\b(?!\s*(?:->|#>))/u);
    expect(query, 'and it is scoped to the failure events, not the whole stream')
      .toContain("'julius.task.failed'");
    // A TASK CAN END FOR A REASON ONLY THIS TYPE CARRIES. RECOVERY_LIMIT_REACHED
    // travels on `recovery.action`, and a task that never reached a worker
    // leaves no `task.failed` behind — so without this type the artifact cannot
    // say why such a task stopped. `recovery_action` distinguishes those rows
    // from the ordinary requeues the same type also records.
    expect(query, 'the recovery sweep can end a task, so its rows belong here')
      .toContain("'julius.recovery.action'");
    expect(query, 'and a requeue must be distinguishable from a terminal recovery')
      .toContain("'action'");
  });

  it('keeps the two names dry run #2 proved wrong corrected', () => {
    const dumps = queries();
    expect(dumps.find((dump) => dump.file === 'evidence.tsv')?.columns).toContain('evidence_type');
    expect(dumps.find((dump) => dump.file === 'findings.tsv')?.table).toBe('julius_reviewer_findings');
  });
});

describe('the preflight is a legitimate participant in the durable schema (dry run 33635375764)', () => {
  // The executor's sandbox record references projects, julius_runs, julius_tasks and,
  // as a composite key, julius_tool_invocations. Dry run #2 died on the first create
  // because the probe seeded none of them. These cases hold the ORDER the source
  // enforces; the real-PostgreSQL cases in julius-live-preflight-identity.test.ts
  // hold the foreign keys themselves.
  const preflight = read('scripts/julius-live-preflight.ts');
  const fixture = read('scripts/julius-live-preflight-identity.ts');
  const sibling = read('scripts/julius-sibling-support.ts');
  const liveEntry = read('relay-bridge/julius-live-mission.ts');

  it('seeds its ancestry before the first executor request, and each invocation before its sandbox', () => {
    expect(preflight.indexOf('await seedPreflightIdentity(pool, identity)'), 'the ancestry must exist before any executor call')
      .toBeLessThan(preflight.indexOf('client.createSandbox('));
    const roundTrip = preflight.slice(preflight.indexOf('const runInSandbox'));
    expect(roundTrip.indexOf('await seedPreflightInvocation('), 'the invocation must be recorded before the sandbox that references it')
      .toBeLessThan(roundTrip.indexOf('client.createSandbox('));
  });

  it('hands the executor the dispatch generation the claim returned, and migrates by version rather than by sentinel', () => {
    // PR #214's host-visible entry: an invocation left AUTHORIZED loses execution authority.
    expect(preflight).toContain('const { dispatchGeneration } = await seedPreflightInvocation(');
    expect(preflight, 'a hard-coded generation cannot match a claimed one').not.toMatch(/dispatchGeneration:\s*\d/u);
    expect(fixture).toMatch(/SET state='DISPATCHING',dispatch_generation=i\.dispatch_generation\+1/u);
    expect(fixture, 'the claim is scoped to this invocation and this project, never the fleet').toMatch(/WHERE o\.invocation_id=\$1 AND o\.project_id=\$4 AND o\.state='PENDING'/u);
    expect(fixture, 'the production claimDispatch sweeps every pending invocation and must not be used by a probe').not.toContain('claimDispatch(');
    // MIGRATION IS PER-VERSION, AND NO SENTINEL MAY COME BACK.
    //
    // This used to require the probe `column_name='sandbox_policy'` — the
    // artefact of whichever migration was last when it was written. Adding 022
    // made that answer "already migrated" for a database at 021, so the new
    // column would never have been created. `migrate()` now consults
    // `schema_migrations`, so the rule is that no caller reintroduces a
    // one-column stand-in for the whole set.
    expect(preflight).toContain('await migrateIfNeeded(pool)');
    expect(preflight, 'the probe must not name one migration\'s artefact')
      .not.toContain("column_name='sandbox_policy'");
    for (const source of [fixture, sibling, liveEntry]) {
      expect(source, 'a column sentinel cannot decide whether a migration set has landed')
        .not.toMatch(/information_schema\.columns[\s\S]{0,200}sandbox_policy/u);
    }
  });

  it('names no invented identity: every id derives from the nonce, and the invocation goes through the production repository', () => {
    for (const literal of ["run:julius-live-preflight'", "task:julius-live-preflight'", 'JULIUS_PROJECT_ID']) {
      expect(preflight, `${literal} was the unseeded identity that dry run #2 sent`).not.toContain(literal);
    }
    expect(fixture).toContain("import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres'");
    expect(fixture, 'the executor persistence is never special-cased or bypassed').not.toMatch(/INSERT INTO relay_wonderland\.julius_(sandboxes|tool_invocations)/u);
    expect(fixture).toMatch(/projectId: `\$\{PREFLIGHT_PROJECT_PREFIX\}\$\{input\.nonce\}`/u);
  });

  it('cleans up in a finally, in reverse foreign-key order, and reports rather than hides a failure', () => {
    const tail = preflight.slice(preflight.indexOf('} finally {', preflight.indexOf('async function main')));
    expect(tail).toContain('await cleanupPreflightIdentity(pool, identity)');
    expect(tail).toContain('PREFLIGHT CLEANUP FAILED');
    expect(preflight, 'a clean proof cannot leave rows behind and still exit 0').toContain('return code === 0 && cleanupFailed ? 1 : code;');
    const order = ['julius_tool_execution_receipts', 'julius_sandboxes', 'julius_tool_invocations', 'julius_tasks', 'julius_runs', 'mission_contracts', 'project_members', 'projects']
      .map((table) => fixture.indexOf(`['${table}',`));
    for (let index = 1; index < order.length; index += 1) {
      expect(order[index - 1], 'children before parents; receipts before the sandboxes they RESTRICT').toBeLessThan(order[index]);
    }
    expect(fixture, 'the shared tenant player row is never deleted').not.toMatch(/DELETE FROM relay_wonderland\.players/u);
    expect(fixture).toContain("throw new Error('preflight_identity_not_owned')");
    // The one table without a project column is reached only through the nonce's run AND project.
    expect(fixture).toContain('DELETE FROM relay_wonderland.julius_tasks t USING relay_wonderland.julius_runs r WHERE t.run_id=r.run_id AND r.run_id=$1 AND r.project_id=$2');
    expect(fixture, 'ownership is asserted on every identifier, not the project alone').toMatch(/identity\.runId === `run:julius-preflight-\$\{identity\.nonce\}`/u);
  });

  it('the Docker regression job runs the PostgreSQL-backed suite with JULIUS_REAL_POSTGRES=1 (the proof is that step, not this case)', () => {
    const regression = read('.github/workflows/julius-real-infra.yml');
    expect(regression).toContain('npx vitest run scripts/julius-live-preflight-identity.test.ts');
    expect(regression).toMatch(/JULIUS_REAL_POSTGRES:\s*'1'/u);
  });
});

describe('the receipt transport — proven on real Docker, PR #214 (runs 33667743669, 33685880591)', () => {
  // The executor asks the host Docker daemon to bind-mount each sandbox's scoped receipt
  // directory, and the daemon resolves bind sources on the host. A receipt root inside the
  // executor's own layer stopped every sandbox at prepareWorkspace with
  // `sandbox_create_failed class=bind_source_missing`; a root:root 0700 host root mounted into
  // the executor at the same path carried the whole provider-free preflight to a pass. These
  // cases hold the mission to that transport and to the boundary around it.
  const launch = read('.github/julius-live-executor.sh');
  const boundary = read('.github/julius-live-receipt-boundary.sh');
  const HOST_ROOT = '/tmp/julius-executor/receipts';
  const launchBlock = (): string => {
    const start = launch.indexOf('docker run -d --name julius-executor');
    return launch.slice(start, launch.indexOf('./.github/wait-for-executor.sh', start));
  };

  it('1. the mission sets the host receipt root, deliberately', () => {
    expect(workflow).toMatch(new RegExp(`^\\s*JULIUS_RECEIPT_HOST_ROOT: ${HOST_ROOT.replace(/\//gu, '\\/')}\\s*$`, 'mu'));
  });

  it('2. the host path and the executor path are the same absolute path', () => {
    expect(launch).toContain('receipt_mount=(-v "$JULIUS_RECEIPT_HOST_ROOT:$JULIUS_RECEIPT_HOST_ROOT")');
    expect(launch).toContain('receipt_root=$JULIUS_RECEIPT_HOST_ROOT');
    expect(launch).toContain('-e EXECUTOR_RECEIPT_ROOT="$receipt_root"');
    expect(launch, 'a relative or private-root path is refused before anything starts').toContain('receipt_root_refused:not_absolute');
    expect(launch).toContain('receipt_root_refused:executor_private');
    expect(boundary).toContain('receipt_boundary_violation:receipt_mount_path_differs');
  });

  it('3 + 4. the host root and its parent are created root:root with mode exactly 0700, and proven so at runtime', () => {
    expect(launch).toContain('sudo install -d -m 0700 -o root -g root "$parent"');
    expect(launch).toContain('sudo install -d -m 0700 -o root -g root "$JULIUS_RECEIPT_HOST_ROOT"');
    // Symlinks are refused BEFORE anything is created (install -d follows one), the created path
    // must resolve to itself, and both the parent and the root are measured afterwards.
    expect(launch.indexOf('sudo test -L "$candidate"'), 'the symlink refusal precedes creation').toBeLessThan(launch.indexOf('sudo install -d -m 0700 -o root -g root "$parent"'));
    expect(launch).toContain('receipt_root_refused:symlink:$candidate');
    expect(launch).toContain('resolved=$(sudo realpath "$JULIUS_RECEIPT_HOST_ROOT")');
    expect(launch).toContain('receipt_root_refused:resolves_elsewhere');
    expect(launch, 'parent and root measured').toMatch(/for measured in "\$parent" "\$JULIUS_RECEIPT_HOST_ROOT"; do\s*\n\s*actual=\$\(sudo stat -c '%U:%G %a' "\$measured"\)\s*\n\s*if \[ "\$actual" != 'root:root 700' \]/u);
    expect(boundary).toContain("[ \"$actual\" = 'root:root 700' ]");
    expect(boundary, 'the probe measures the parent as well').toContain('for measured in "$parent" "$root"; do');
    expect(boundary).toContain('[ "$(sudo realpath "$root")" = "$root" ]');
    for (const refusal of ['runner_can_list', 'runner_can_read', 'runner_can_write', 'runner_has_mode_bits', 'symlink:$candidate', 'root_resolves_elsewhere']) {
      expect(boundary, `the boundary probe must try as the runner user: ${refusal}`).toContain(`receipt_boundary_violation:${refusal}`);
    }
    expect(workflow, 'the mission runs the boundary probe').toContain('./.github/julius-live-receipt-boundary.sh');
    expect(read('.github/workflows/julius-real-infra.yml'), 'so does the regression').toContain('./.github/julius-live-receipt-boundary.sh');
  });

  it('5. the executor is given the receipt root and nothing else beyond the socket, the checkout and the fleet', () => {
    const mounts = launchBlock().split('\n').filter((line) => line.includes('-v ') || line.includes('receipt_mount'));
    const sources = mounts.map((line) => line.trim());
    expect(sources).toEqual([
      '-v /var/run/docker.sock:/var/run/docker.sock \\',
      '-v "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE:ro" \\',
      '-v "$fleet_root:$fleet_root" \\',
      '"${receipt_mount[@]}" \\',
    ]);
    expect(boundary, 'exactly one receipt mount at runtime').toContain('receipt_boundary_violation:receipt_mounts=');
  });

  it('6 + 7 + 8. the signing key, the ledger and the private root are never bind-mounted', () => {
    for (const forbidden of ['private.pem', 'ledger', 'executor-private']) {
      expect(launchBlock().split('\n').filter((line) => line.includes('-v ')).join('\n')).not.toContain(forbidden);
    }
    // The probe refuses any executor mount naming these, at runtime, from docker inspect.
    expect(boundary).toContain('for forbidden in executor-private private.pem ledger; do');
    expect(boundary).toContain('receipt_boundary_violation:mount_names_$forbidden');
    expect(launch).toContain('-e EXECUTOR_SIGNING_KEY_PATH=/executor-private/private.pem');
    expect(launch).toContain('-e EXECUTOR_LEDGER_ROOT=/executor-private/ledger');
    expect(boundary, 'and neither exists on any host path').toContain('/tmp/julius-executor/private.pem /tmp/julius-executor/ledger');
    // Under a root:root 0700 parent an unprivileged `[ -e ]` cannot see; existence is asked with sudo.
    expect(boundary).toContain('if sudo test -e "$host_path"; then');
    expect(read('.github/julius-live-key-boundary.sh')).toContain('if sudo test -e "$path"; then');
  });

  it('9 + 10 + 11. network DENY, the 4 MiB workspace and the shared output ceiling are unchanged', () => {
    expect(EXECUTOR_SANDBOX_POLICY.network).toBe('DENY');
    expect(EXECUTOR_SANDBOX_LIMITS.workspaceBytes).toBe(4_194_304);
    expect(read('relay-bridge/julius/sandbox-limits.ts')).toMatch(/outputBytes:\s*MAX_SANDBOX_OUTPUT_BYTES\b/u);
  });

  it('12. cleanup removes the host receipt root, after every container that could write into it', () => {
    const cleanup = stepScript('Destroy everything this job created');
    expect(cleanup).toContain('sudo rm -rf /tmp/julius-executor');
    expect(cleanup.indexOf('docker rm -f julius-executor julius-postgres')).toBeLessThan(cleanup.indexOf('sudo rm -rf /tmp/julius-executor'));
    expect(cleanup.indexOf("--filter 'label=julius.sandbox'")).toBeLessThan(cleanup.indexOf('sudo rm -rf /tmp/julius-executor'));
  });

  it('each sandbox is handed only its own scoped subtree: the adapter mounts it, the preflight reads the daemon, the workload is refused', () => {
    const adapter = read('src/relay/workspace/julius-tools/docker-sandbox-adapter.ts');
    // The adapter mounts <root>/<sha256(sandboxId)>, never the root.
    expect(adapter).toContain('const sandboxReceipts=join(this.config.durability.receipts.root,opaque(record.sandboxId))');
    expect(adapter).toContain("createHash('sha256').update(value).digest('hex')");
    expect(adapter).toContain('`type=bind,src=${sandboxReceipts},dst=/julius-receipts-root`');
    expect(adapter).not.toMatch(/src=\$\{this\.config\.durability\.receipts\.root\},dst=/u);
    // The scope is proven from the daemon's mount table while the sandbox exists — the workload
    // runs as uid 65532 and cannot list the root-owned mount, so an in-sandbox listing proves nothing.
    const preflight = read('scripts/julius-live-preflight.ts');
    expect(preflight).toContain("['ps', '-aq', '--filter', `label=julius.sandbox=${sandboxId}`]");
    expect(preflight).toContain("['inspect', '--format', '{{json .Mounts}}', containers[0] as string]");
    expect(preflight).toContain('const expectedSource = join(hostReceiptRoot, sha(sandboxId));');
    for (const violation of ['receipt_mounts=', 'receipt_mount_is_not_the_sandbox_scope', 'whole_receipt_root_mounted', 'earlier_sandbox_scope_mounted', 'executor_private_mounted', 'receipt_subpath_mounted', 'unexpected_bind:']) {
      expect(preflight, `the daemon-side proof must refuse: ${violation}`).toContain(violation);
    }
    expect(preflight, 'the proof is taken between prepare and execute').toMatch(/if \(afterPrepare\) await afterPrepare\(invocationId\);\s*\n\s*return await client\.executeTool/u);
    expect(preflight).toContain("].join(' && '), proveReceiptScope);");
    // And from inside: uid 65532, the mount exists but cannot be listed, nothing under /executor-private.
    for (const check of ['[ "$(id -u)" = "65532" ]', 'test -d /julius-receipts-root', '! ls -A /julius-receipts-root >/dev/null 2>&1', 'test ! -e /executor-private', 'echo RECEIPT_WORKLOAD_REFUSED']) {
      expect(preflight, `the in-sandbox probe must check: ${check}`).toContain(check);
    }
    expect(preflight).toContain("scope.stdout.includes('RECEIPT_WORKLOAD_REFUSED')");
  });

  it('the executor-private entry is an exact expected-failure regression, and host-visible a full pass', () => {
    const regression = read('.github/workflows/julius-real-infra.yml');
    const step = regression.slice(regression.indexOf('- name: Preflight round trip (${{ matrix.receipts }} receipts)'), regression.indexOf('- name: Preflight identity regression'));
    expect(step).toContain("expected='executor_diagnostic operation=prepare result=sandbox_create_failed class=bind_source_missing status=500'");
    expect(step, 'an unexpected pass must fail').toContain('negative_regression_failed:executor-private receipts unexpectedly passed');
    expect(step, 'a different stage or class must fail').toContain('negative_regression_failed:executor-private refused for a different stage or class');
    expect(step, 'an additional refusal must fail').toContain('negative_regression_failed:executor-private produced an additional refusal');
    expect(step, 'the mission transport must pass with no refusal at all').toContain('first_live_topology_failed:host-visible executor refused a request');
    expect(step).toContain('grep -qxF "$expected"');
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
    // The exact grammar of the two lines the executor writes — not a character set, which a
    // credential-shaped tail on an otherwise valid line would pass.
    const grammar = '^executor_(ready:[0-9]{1,5}|diagnostic operation=[a-z]+ result=[A-Za-z0-9_.:-]{1,120} class=[A-Za-z0-9_]{1,32} status=[0-9]{3})$';
    expect(collect, 'only lines matching the executor\u2019s exact grammar may be kept').toContain(`grep -E '${grammar}'`);
    const kept = new RegExp(grammar, 'u');
    expect(kept.test('executor_diagnostic operation=create result=masked class=23503 status=500')).toBe(true);
    expect(kept.test('executor_ready:8787')).toBe(true);
    expect(kept.test('executor_diagnostic operation=prepare result=masked class=none status=500 Authorization: Bearer abc')).toBe(false);
    expect(kept.test(['executor_ready:8787 ', 'sk-ant-', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].join(''))).toBe(false);
    expect(collect, 'the raw log must not survive to the upload step').toContain('rm -f "$raw_executor_log"');
    expect(collect.indexOf('rm -f "$raw_executor_log"'), 'delete before the evidence directory is complete')
      .toBeLessThan(collect.indexOf('./.github/julius-live-evidence-dump.sh'));
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
  const GATE = "'Gate: no paid first-live mission has been attempted or completed'";
  const ATTEMPT_STEP = "'Record that a paid mission was attempted (before any provider can be reached)'";

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

  /**
   * THE FIRST PAID ATTEMPT IS WHY THIS SECTION EXISTS.
   *
   * Run 33697109210 crossed the live boundary, failed at its `plan` task and
   * published no marker at all, because only COMPLETION was recorded. A second
   * ordinary dispatch would then have been treated as the first paid run. The
   * attempt marker closes that: it records that a paid run was AUTHORIZED AND
   * ENTERED, which is the strongest claim this job can honestly make — whether
   * a provider was billed is not observable from here.
   */
  it('a paid attempt is recorded BEFORE the provider-capable entrypoint can run', () => {
    const attempt = workflow.indexOf(`- name: ${ATTEMPT_STEP}`);
    const upload = workflow.indexOf('name: julius-first-live-attempted');
    const live = workflow.indexOf("- name: 'LIVE: run the first real Julius mission'");
    expect(attempt, 'the attempt marker step must exist').toBeGreaterThan(-1);
    // Without this, deleting the upload makes the ordering assertion below pass
    // vacuously: indexOf answers -1, and -1 is less than every position.
    expect(upload, 'the attempt marker upload must exist').toBeGreaterThan(-1);
    expect(attempt, 'it is written before the entrypoint, not after').toBeLessThan(live);
    expect(upload, 'and uploaded before the entrypoint, or a dead runner loses it').toBeLessThan(live);
    expect(workflow.indexOf('name: julius-first-live-completed'), 'completion is still recorded after the run')
      .toBeGreaterThan(live);
  });

  it('the attempt marker carries safe provenance and a contract digest, never contract text', () => {
    const marker = stepScript(ATTEMPT_STEP);
    expect(marker).toContain('attempted_at=');
    expect(marker).toContain('run_id=');
    expect(marker).toContain('commit=');
    expect(marker, 'the digest identifies WHAT was authorized without reproducing it')
      .toContain('contract_sha256=');
    expect(marker, 'the contract is hashed, never copied').toMatch(/sha256sum "\$CONTRACT"/u);
    for (const forbidden of ['API_KEY', 'SCOPED', 'PASSWORD', 'printenv', 'private.pem', 'cat "$CONTRACT"']) {
      expect(marker, `${forbidden} must never enter the durable marker`).not.toContain(forbidden);
    }
  });

  it('a dry run creates neither marker', () => {
    for (const step of [ATTEMPT_STEP, "Record that a paid mission completed"]) {
      const start = workflow.indexOf(`- name: ${step}`);
      const guard = workflow.slice(start, start + 260);
      expect(guard, `${step} must be gated on the typed live phrase`)
        .toMatch(/if: success\(\) && inputs\.confirm_live == 'RUN LIVE MISSION'/u);
    }
  });

  /**
   * THE PAID PATH MUST NEVER RUN AFTER A FAILURE, AND MUST SAY SO.
   *
   * GitHub applies a default `success()` to a step whose `if:` names no status
   * function, and this workflow's own history shows it: in runs 33625851653
   * and 33635375764 a failed preflight skipped every custom-`if:` step below
   * it while the `always()` steps ran. The guard was therefore already there,
   * implicitly. Writing it out is defence in depth, not a repair — it puts the
   * property where a reader can see it, and this case fails if a paid step is
   * ever given `always()` or `!cancelled()`, which WOULD reach the entrypoint.
   */
  it('every paid step fails closed: no status guard, no spend', () => {
    for (const step of ["- name: 'LIVE: run the first real Julius mission'", `- name: ${ATTEMPT_STEP}`]) {
      const start = workflow.indexOf(step);
      expect(start, `${step} must exist`).toBeGreaterThan(-1);
      const condition = /\n\s*if: (.+)/u.exec(workflow.slice(start, start + 300))?.[1] ?? '';
      expect(condition, `${step} must not run after an earlier step failed`).toContain('success()');
      expect(condition).toContain("inputs.confirm_live == 'RUN LIVE MISSION'");
    }
    const uploads = workflow.split('- uses: actions/upload-artifact');
    const attemptUpload = uploads.find((block) => block.includes('name: julius-first-live-attempted')) ?? '';
    expect(attemptUpload, 'the attempt upload is itself on the paid, fail-closed path')
      .toMatch(/if: success\(\) && inputs\.confirm_live == 'RUN LIVE MISSION'/u);
    // A MARKER THAT UPLOADED NOTHING MUST NOT BE A GREEN STEP. upload-artifact
    // v4 defaults to `warn`, so an empty directory uploads no artifact and the
    // step still succeeds. THE TWO MARKERS NEED IT FOR DIFFERENT REASONS, and
    // conflating them is how one of these assertions would get relaxed: the
    // attempt marker is followed immediately by the step that spends, so
    // `error` makes "a marker exists before any provider can be reached" a
    // property of the upload rather than of the previous step's `set -e`;
    // nothing spends after the completion marker, and its reason is the NEXT
    // dispatch, whose `count_markers julius-first-live-completed` would read
    // zero and be told no paid mission has ever completed.
    for (const marker of ['julius-first-live-attempted', 'julius-first-live-completed']) {
      const upload = uploads.find((block) => block.includes(`name: ${marker}`)) ?? '';
      expect(upload, `${marker} must not report success having uploaded nothing`)
        .toContain('if-no-files-found: error');
    }
  });

  it('the guard reads BOTH markers and can only be overridden by the exact phrase', () => {
    const guard = stepScript(GATE);
    expect(guard, 'a failed attempt must block the next ordinary dispatch')
      .toContain('julius-first-live-attempted');
    expect(guard, 'a completed run must block it too').toContain('julius-first-live-completed');
    expect(guard).toContain('julius_first_live_already_entered');
    // Unknown is not zero: a failed marker QUERY must refuse like a found
    // marker does, behind the same acknowledgement — not read as "no marker".
    expect(guard, 'an unreadable marker list must not pass as a first run')
      .toContain('julius_first_live_marker_unknown');
    expect(guard, 'the query result must be branched on, never defaulted to zero')
      .not.toContain('|| echo 0');
    expect(guard, 'and can only be overridden by an explicit typed phrase').toContain('RERUN PAID MISSION');
    expect(workflow, 'the guard applies to live dispatches only, so dry runs stay repeatable')
      .toMatch(/- name: 'Gate: no paid first-live mission has been attempted or completed'\n\s*if: inputs\.confirm_live == 'RUN LIVE MISSION'/u);
    expect(workflow, 'listing artifacts needs actions:read and nothing more')
      .toMatch(/permissions:[\s\S]*?actions: read/u);
  });

  /**
   * THE GUARD, EXECUTED. The cases above read the file; these run the real
   * script against a stubbed `gh`, because a guard that only reads correctly
   * is a guard nobody has proven refuses.
   */
  describe('the guard, run against a stubbed artifact list', () => {
    const runGuard = (input: { completed?: number | string; attempted?: number | string; readable?: boolean; acknowledge?: string; constant?: string }): number => {
      const bin = mkdtempSync(join(realpathSync(tmpdir()), 'julius-gh-'));
      const readable = input.readable ?? true;
      writeFileSync(join(bin, 'gh'), [
        '#!/usr/bin/env bash',
        readable ? '' : 'exit 1',
        'case "$*" in',
        `  *julius-first-live-completed*) echo '${input.completed ?? 0}';;`,
        `  *julius-first-live-attempted*) echo '${input.attempted ?? 0}';;`,
        '  *) echo 0;;',
        'esac',
      ].join('\n'), { mode: 0o755 });
      let script = stepScript(GATE);
      if (input.constant !== undefined) {
        script = script.replace(/^RECORDED_PAID_ATTEMPTS=.*$/mu, `RECORDED_PAID_ATTEMPTS=${input.constant}`);
        expect(script, `the substitution must have replaced the whole line for "${input.constant}"`)
          .toContain(`\nRECORDED_PAID_ATTEMPTS=${input.constant}\n`);
      }
      try {
        execFileSync('bash', ['-c', script], {
          cwd: ROOT, stdio: 'ignore',
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH ?? ''}`,
            GITHUB_REPOSITORY: 'owner/repo',
            GH_TOKEN: 'stub',
            ACKNOWLEDGE_RERUN: input.acknowledge ?? '',
          },
        });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status ?? 1;
      }
    };

    /**
     * NO MARKERS IS NOT THE SAME AS NO ATTEMPT. Run 33697109210 entered the
     * paid path and failed before the attempt marker existed, so it left none.
     * A guard that counted only artifacts would wave the very next dispatch
     * through — on the exact run that revealed the gap. The workflow records
     * that attempt, so an empty marker list still refuses.
     */
    it('refuses even with no markers, because a paid attempt is recorded in the workflow', () => {
      expect(runGuard({})).not.toBe(0);
      expect(runGuard({ acknowledge: 'RERUN PAID MISSION' }), 'and only the typed phrase gets past it').toBe(0);
    });

    it('the recorded attempt names the run it stands for, so it can be checked and incremented', () => {
      const guard = stepScript(GATE);
      expect(guard).toMatch(/RECORDED_PAID_ATTEMPTS=1\s+# run 33697109210/u);
      expect(guard, 'and it is counted, not merely written down')
        .toContain('[ "$RECORDED_PAID_ATTEMPTS" -gt 0 ]');
      // ORDER, NOT ONLY PRESENCE. A digit test that runs after the branch it
      // protects still refuses, but only after announcing a first paid mission,
      // and one moved into a later step would not refuse at all.
      expect(guard.indexOf('is_count "$RECORDED_PAID_ATTEMPTS"'), 'the value is validated before it is used')
        .toBeLessThan(guard.indexOf('[ "$RECORDED_PAID_ATTEMPTS" -gt 0 ]'));
    });

    it('MUTATION: a FAILED first attempt still blocks the next ordinary paid dispatch', () => {
      expect(runGuard({ attempted: 1, completed: 0 }), 'this is exactly attempt #1 followed by an ordinary re-dispatch').not.toBe(0);
    });

    it('a completed run blocks it too, as it always did', () => {
      expect(runGuard({ completed: 1 })).not.toBe(0);
    });

    it('the exact acknowledgement lets a deliberate rerun through, over either marker', () => {
      expect(runGuard({ attempted: 1, acknowledge: 'RERUN PAID MISSION' })).toBe(0);
      expect(runGuard({ completed: 1, acknowledge: 'RERUN PAID MISSION' })).toBe(0);
      expect(runGuard({ completed: 3, attempted: 5, acknowledge: 'RERUN PAID MISSION' }), 'however many there are').toBe(0);
    });

    it('MUTATION: a mistyped acknowledgement is refused', () => {
      for (const typo of ['rerun paid mission', 'RERUN PAID MISSION ', 'RERUN-PAID-MISSION', 'yes', 'RERUN PAID MISSIO']) {
        expect(runGuard({ attempted: 1, acknowledge: typo }), `"${typo}" must not pass`).not.toBe(0);
      }
    });

    /**
     * UNKNOWN IS NOT ZERO, AND A NON-COUNT IS UNKNOWN. A `gh` that exits 0 with
     * something that is not a number — or with nothing — must refuse exactly as
     * an unreadable list does. An earlier form of this guard defaulted the
     * value to zero, and zero is the one answer that lets a second paid run
     * through. A first form of the digit test concatenated the two counts,
     * which let a BLANK answer hide behind the other's digits; each value is
     * now tested on its own, and these cases hold that.
     */
    /**
     * THE ONE VALUE A HUMAN EDITS IS THE ONE THAT MUST NOT FAIL OPEN. Before it
     * was digit-tested, an empty or non-numeric `RECORDED_PAID_ATTEMPTS` made
     * the comparison error, fall through to the else, and announce a first paid
     * mission. Deliberately NOT overridable by the typed phrase: a malformed
     * constant in the repository is a mistake to fix, not an operator decision.
     */
    it('MUTATION: a malformed recorded-attempt constant refuses, and the phrase cannot override it', () => {
      const withConstant = (value: string): number => {
        const bin = mkdtempSync(join(realpathSync(tmpdir()), 'julius-gh-'));
        writeFileSync(join(bin, 'gh'), '#!/usr/bin/env bash\necho 0\n', { mode: 0o755 });
        const script = stepScript(GATE).replace(/^RECORDED_PAID_ATTEMPTS=.*$/mu, `RECORDED_PAID_ATTEMPTS=${value}`);
        expect(script, `the substitution must have replaced the whole line for value "${value}"`)
          .toContain(`\nRECORDED_PAID_ATTEMPTS=${value}\n`);
        try {
          execFileSync('bash', ['-c', script], {
            cwd: ROOT, stdio: 'ignore',
            env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}`, GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'stub', ACKNOWLEDGE_RERUN: 'RERUN PAID MISSION' },
          });
          return 0;
        } catch (error) {
          return (error as { status?: number }).status ?? 1;
        }
      };
      for (const value of ['', 'many', '1.5', '-1', '" 1 "']) {
        expect(withConstant(value), `RECORDED_PAID_ATTEMPTS=${value} must refuse even with the phrase`).not.toBe(0);
      }
      // The control: a well-formed constant PROCEEDS under the same phrase, so
      // the refusals above are caused by the malformation and not by the harness.
      expect(withConstant('2'), 'a well-formed count is still overridable by the phrase').toBe(0);
    });

    /**
     * THE MARKER READ NEEDS A CASE THAT CAN FAIL.
     *
     * `RECORDED_PAID_ATTEMPTS=1` satisfies the refusal's third disjunct on
     * every dispatch, so while it stands, every case above still passes with
     * the two marker disjuncts DELETED — a review proved exactly that by
     * mutation. The artifact-based half of the guard is the half that keeps
     * working once this constant is understood as history, and it had no
     * assertion that could go red. Retiring the constant to 0 is the only way
     * to see it, so one case does that and holds the marker read on its own.
     */
    it('MUTATION: with the recorded attempt retired to 0, the marker read alone still refuses', () => {
      expect(runGuard({ constant: '0', attempted: 1 }), 'an attempt marker alone must refuse').not.toBe(0);
      expect(runGuard({ constant: '0', completed: 1 }), 'a completion marker alone must refuse').not.toBe(0);
      // The control. With no markers AND no recorded attempt this really would
      // be the first paid mission, and the gate proceeds — so the two refusals
      // above are caused by the marker counts and not by the harness.
      expect(runGuard({ constant: '0' }), 'and with neither, a genuine first paid mission proceeds').toBe(0);
      expect(runGuard({ constant: '0', attempted: 1, acknowledge: 'RERUN PAID MISSION' }),
        'the typed phrase still overrides a marker, exactly as it overrides the constant').toBe(0);
    });

    it('MUTATION: a marker list that answers with something other than a count fails closed', () => {
      for (const value of ['null', '', 'many', '1.5', '-1', 'null\nnull']) {
        expect(runGuard({ completed: value }), `completed="${value}" must not pass as zero`).not.toBe(0);
        expect(runGuard({ attempted: value }), `attempted="${value}" must not pass as zero`).not.toBe(0);
      }
      expect(runGuard({ completed: '', attempted: '' })).not.toBe(0);
      expect(runGuard({ completed: '', acknowledge: 'RERUN PAID MISSION' }), 'and only the typed phrase overrides it').toBe(0);
    });

    it('MUTATION: an unreadable marker list fails closed, and only the phrase overrides it', () => {
      expect(runGuard({ readable: false })).not.toBe(0);
      expect(runGuard({ readable: false, acknowledge: 'RERUN PAID MISSION' })).toBe(0);
    });
  });

  it('the guard runs before any credential or container exists', () => {
    expect(workflow.indexOf(`- name: ${GATE}`))
      .toBeLessThan(workflow.indexOf('- name: Create the ephemeral scoped credentials'));
  });
});
