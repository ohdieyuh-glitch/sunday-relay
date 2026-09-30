import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ANTHROPIC_CREDENTIAL_ENV_NAMES, CLAUDE_AUTH_MODES } from '../relay-bridge/hosted-coding-agent/hosted-auth';
import { declaredBillingPath } from '../relay-bridge/attestation';
import { JOB_BUDGET_MS } from '../relay-bridge/reviewer-deadline';

/**
 * THE LOCAL LIVE QUALIFICATION IS THE WORKFLOW'S PATH, LAUNCHED FROM ANOTHER PLACE.
 *
 * The founder chose to run the first subscription-backed qualification from their own laptop,
 * because that is where the first-party Claude login lives. The hosted runner has none, and no
 * personal credential may move to GitHub. That choice is only safe if the local launch is the SAME
 * mission as the hosted one: the same job environment, the same shared scripts, the same
 * entrypoint and the same refusals. A second, simpler path would be a different mission that
 * happens to share a name.
 *
 * These cases hold `scripts/julius-local-qualification.sh` to that. Every difference from the
 * workflow is named in this file together with its reason, so a difference cannot appear by drift:
 *
 *   - the Coding Agent authenticates from the subscription, and no Anthropic route may exist;
 *   - PostgreSQL moves off 127.0.0.1:5432, which inside WSL2 is Docker Desktop's forward to
 *     Julius's live store, and onto a database name of its own;
 *   - no provider is contacted to validate a credential;
 *   - GitHub-only gates are replaced by local ones that refuse the same things.
 */

const ROOT = resolve(import.meta.dirname, '..');
const read = (relative: string): string => readFileSync(resolve(ROOT, relative), 'utf8');
const LAUNCHER_PATH = 'scripts/julius-local-qualification.sh';
const WORKFLOW_PATH = '.github/workflows/julius-first-live-mission.yml';
const MISSION = 'julius-live-mission-6';
const launcher = read(LAUNCHER_PATH);
const workflow = read(WORKFLOW_PATH);
const executorScript = read('.github/julius-live-executor.sh');
const hermesScript = read('.github/julius-live-hermes.sh');

/** Lines that execute: neither a comment nor a message printed to the operator. */
const codeLines = (text: string): string[] => text.split('\n')
  .filter((line) => !/^\s*#/u.test(line) && !/^\s*say\s/u.test(line));

/** One shell function's body, from its opening line to the first line that is a bare `}`. */
const functionBody = (name: string): string => {
  const start = launcher.indexOf(`\n${name}() {`);
  expect(start, `${name} must exist`).toBeGreaterThan(-1);
  const end = launcher.indexOf('\n}\n', start);
  return launcher.slice(start, end);
};

/** The `env:` block of the workflow's `first-live-mission` job, as NAME → value. */
function workflowJobEnv(): Map<string, string> {
  const lines = workflow.split('\n');
  const job = lines.findIndex((line) => /^ {2}first-live-mission:\s*$/u.test(line));
  expect(job, 'the workflow must still define the first-live-mission job').toBeGreaterThan(-1);
  const envAt = lines.findIndex((line, index) => index > job && /^ {4}env:\s*$/u.test(line));
  const stepsAt = lines.findIndex((line, index) => index > job && /^ {4}steps:\s*$/u.test(line));
  expect(envAt).toBeGreaterThan(job);
  expect(stepsAt).toBeGreaterThan(envAt);
  const env = new Map<string, string>();
  for (const line of lines.slice(envAt + 1, stepsAt)) {
    const match = /^ {6}([A-Z][A-Z0-9_]*):\s*(.*?)\s*$/u.exec(line);
    if (match === null) continue;
    const value = match[2]!.replace(/^'(.*)'$/u, '$1').replace(/^"(.*)"$/u, '$1')
      // The workflow derives the mission from its dispatch input; the launcher runs one mission.
      .replace('${{ inputs.mission }}', MISSION);
    env.set(match[1]!, value);
  }
  return env;
}

/** The launcher's `# BEGIN JOB ENV` … `# END JOB ENV` block, as NAME → value. */
function launcherJobEnv(): Map<string, string> {
  const begin = launcher.indexOf('# BEGIN JOB ENV');
  const end = launcher.indexOf('# END JOB ENV');
  expect(begin, 'the launcher must delimit the block it mirrors').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(begin);
  const env = new Map<string, string>();
  for (const line of launcher.slice(begin, end).split('\n')) {
    const match = /^export ([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (match !== null) env.set(match[1]!, match[2]!);
  }
  return env;
}

/**
 * THE ONLY DELIBERATE DIFFERENCES INSIDE THE MIRRORED BLOCK, each with its reason. Adding an entry
 * here is how a new difference is argued in; nothing else can make one pass.
 */
const LOCAL_DIFFERENCES: Record<string, { readonly local: string; readonly why: string }> = {
  PGDATABASE: {
    local: 'julius_qualification',
    why: 'a name of its own, so nothing that reaches the wrong port can find a database called "julius" there',
  },
};

describe('the local launch mirrors the workflow job, and names every difference', () => {
  it('sets every variable of the workflow job, with the workflow\'s value', () => {
    const fromWorkflow = workflowJobEnv();
    const fromLauncher = launcherJobEnv();
    expect(fromWorkflow.size, 'the parser must find the workflow block').toBeGreaterThan(15);
    expect([...fromLauncher.keys()].sort()).toEqual([...fromWorkflow.keys()].sort());
    for (const [name, value] of fromWorkflow) {
      const difference = LOCAL_DIFFERENCES[name];
      if (difference === undefined) {
        expect(fromLauncher.get(name), `${name} must equal the workflow's value`).toBe(value);
      } else {
        expect(fromLauncher.get(name), `${name}: ${difference.why}`).toBe(difference.local);
        expect(value, `${name}'s exception is stale: the workflow already uses the local value`).not.toBe(difference.local);
      }
    }
  });

  it('adds exactly two variables of its own; the workflow runs its coder in the same subscription mode and sets none of the rig-only switches', () => {
    const begin = launcher.indexOf('# BEGIN JOB ENV');
    const end = launcher.indexOf('# END JOB ENV');
    const outside = (launcher.slice(0, begin) + launcher.slice(end)).split('\n')
      .map((line) => /^export ([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line))
      .filter((match): match is RegExpExecArray => match !== null);
    expect(outside.map((match) => match[1])).toEqual(['JULIUS_CLAUDE_AUTH', 'JULIUS_LIVE_PG_PORT']);
    const auth = outside[0]![2]!;
    expect((CLAUDE_AUTH_MODES as readonly string[]).includes(auth), 'a mode the composition knows').toBe(true);
    expect(auth).toBe('CLAUDE_SUBSCRIPTION');
    const port = outside[1]![2]!;
    expect(port).toMatch(/^[0-9]+$/u);
    expect(port, '127.0.0.1:5432 inside WSL2 is the live store\'s forward').not.toBe('5432');
    // THE CODER'S AUTH IS NO LONGER A LOCAL-ONLY SWITCH (founder, 2026-09-29): the paid workflow runs
    // the Coding Agent on the founder's Claude subscription as well, so it sets the SAME mode the
    // launcher exports, on exactly the two steps that start the coder, and never an API mode.
    const modes = [...workflow.matchAll(/^\s+JULIUS_CLAUDE_AUTH: (.+)$/gmu)].map((match) => match[1]!.trim());
    expect(modes, 'the roles preflight and the LIVE step, and no other').toHaveLength(2);
    for (const mode of modes) expect(mode, 'the workflow agrees with the launcher').toBe(auth);
    // CI UNCHANGED for the rest: every other switch added for the local rig defaults to the old
    // behaviour, and the workflow sets none of them.
    for (const name of ['JULIUS_LIVE_PG_PORT', 'HERMES_PHASE', 'HERMES_PYTHON', 'HERMES_VENV_DIR', 'HERMES_SRC_DIR']) {
      expect(workflow, `the workflow must not set ${name}`).not.toContain(name);
    }
  });

  it('declares how the reviewer is paid for where its API key is injected, and the launcher agrees', () => {
    // The founder declared it in the workflow job, whose Hermes step writes the xAI API key into
    // the reviewer's profile. The launcher writes the same key the same way, so the same word is
    // true in both places; the mirror test above already holds the two values equal.
    const declared = workflowJobEnv().get('RELAY_HERMES_BILLING_MODE');
    expect(declaredBillingPath(declared), 'a declaration the canonical parser recognises').toBe('api_billed');
    expect(launcherJobEnv().get('RELAY_HERMES_BILLING_MODE')).toBe(declared);
  });

  it('bounds the live step by the workflow job\'s own ceiling', () => {
    const jobAt = workflow.indexOf('\n  first-live-mission:');
    const ceiling = /\n {4}timeout-minutes:\s*(\d+)/u.exec(workflow.slice(jobAt))?.[1];
    const local = /^readonly LIVE_TIMEOUT_MINUTES=(\d+)$/mu.exec(launcher)?.[1];
    expect(local).toBe(ceiling);
    expect(Number(local) * 60_000).toBe(JOB_BUDGET_MS);
  });

  it('uses the workflow\'s literals for the paid confirmation and the rerun acknowledgement', () => {
    expect(workflow).toContain("inputs.confirm_live == 'RUN LIVE MISSION'");
    expect(workflow).toContain('RERUN PAID MISSION');
    expect(launcher).toContain(`[ "$confirm" = 'RUN LIVE MISSION' ]`);
    expect(launcher).toContain(`[ "$rerun" = 'RERUN PAID MISSION' ]`);
  });
});

describe('the Coding Agent can only authenticate from the subscription', () => {
  const routesLine = launcher.split('\n').find((line) => line.startsWith('readonly ANTHROPIC_ROUTES=('));

  it('refuses and removes every route hosted-auth.ts says would leave the subscription', () => {
    expect(routesLine, 'the launcher must name its routes in one place').toBeDefined();
    const routes = /\(([^)]*)\)/u.exec(routesLine!)![1]!.trim().split(/\s+/u);
    for (const name of ANTHROPIC_CREDENTIAL_ENV_NAMES) {
      expect(routes, `${name} would take the Coding Agent off the subscription`).toContain(name);
    }
    expect(launcher).toContain('if [ -n "${!route:-}" ]; then');
    expect(launcher).toContain('unset "${ANTHROPIC_ROUTES[@]}"');
    // The refusal runs at the top of the file, before any subcommand can.
    expect(launcher.indexOf('for route in "${ANTHROPIC_ROUTES[@]}"; do')).toBeLessThan(launcher.indexOf('\nmain() {'));
  });

  it('names the API key only to refuse it, and never assigns one', () => {
    const naming = codeLines(launcher).filter((line) => line.includes('ANTHROPIC_API_KEY'));
    expect(naming).toEqual([
      routesLine,
      "  grep -qx '  ANTHROPIC_API_KEY: MISSING' \"$LOGS/preflight-roles.log\" || problems+=('the entrypoint saw an Anthropic API key')",
    ]);
    expect(launcher).not.toMatch(/ANTHROPIC_API_KEY=/u);
  });

  it('accepts only the subscription line the entrypoint prints, with no API key and no API cost', () => {
    expect(launcher).toContain("'^  CLAUDE AUTH: SUBSCRIPTION provider=ANTHROPIC execution=CLAUDE_AGENT_SDK plan=[a-z]+ api_key_used=false api_cost_applicable=false$'");
  });

  it('drops every inherited database URL before it can be used', () => {
    expect(launcher).toContain('unset DATABASE_URL JULIUS_DATABASE_URL JULIUS_TEST_DATABASE_URL');
    expect(launcher).toContain('postgresql://*@127.0.0.1:"$JULIUS_LIVE_PG_PORT"/"$PGDATABASE") ;;');
  });
});

describe('no provider is contacted before the founder authorises the run', () => {
  it('carries no provider readiness probe', () => {
    // The header names the probe it deliberately leaves out; only what EXECUTES is judged.
    const code = codeLines(launcher).join('\n');
    for (const probe of ['api.openai.com', 'api.anthropic.com', 'api.x.ai', '/v1/models', 'provider_readiness', 'x-api-key', 'Authorization: Bearer']) {
      expect(code, `${probe} would contact a provider to validate a credential`).not.toContain(probe);
    }
  });

  it('passes the paid flag exactly once, in `run`, after the typed confirmation and the attempt marker', () => {
    const paid = codeLines(launcher).filter((line) => line.includes('--confirm-live'));
    expect(paid).toHaveLength(1);
    expect(paid[0]).toContain('node dist-relay-bridge/julius-live-mission.cjs run --contract "$CONTRACT" --confirm-live');
    const run = functionBody('cmd_run');
    const paidAt = run.indexOf('--confirm-live');
    expect(paidAt, 'the paid flag lives in cmd_run').toBeGreaterThan(-1);
    expect(run.indexOf(`[ "$confirm" = 'RUN LIVE MISSION' ]`)).toBeLessThan(paidAt);
    expect(run.indexOf('> "$marker_dir/attempted-$stamp.txt"'), 'the marker exists before a provider can be reached').toBeLessThan(paidAt);
    expect(run.indexOf('[ -z "$(git status --porcelain)" ]'), 'only a clean checkout runs').toBeLessThan(paidAt);
    expect(run.indexOf('[ "$commit" = "$HEAD_SHA" ]'), 'only the pinned commit runs').toBeLessThan(paidAt);
    expect(run.indexOf('preflight_not_passed_on_this_rig')).toBeLessThan(paidAt);
  });

  it('checks the typed confirmation before it reads anything', () => {
    const run = functionBody('cmd_run');
    expect(run.indexOf(`[ "$confirm" = 'RUN LIVE MISSION' ]`)).toBeLessThan(run.indexOf('preamble'));
  });
});

describe('it runs the workflow\'s own scripts, not copies of them', () => {
  it('provisions, launches and proves through the shared scripts', () => {
    for (const script of [
      'julius-live-images.sh', 'julius-live-identity.sh', 'julius-live-workspace.sh', 'julius-live-executor.sh',
      'julius-live-key-boundary.sh', 'julius-live-receipt-boundary.sh', 'julius-live-hermes.sh', 'julius-live-evidence-dump.sh',
    ]) {
      expect(workflow, `the workflow must still run ${script}`).toContain(`./.github/${script}`);
      expect(launcher, `the launcher must run ${script}`).toContain(`./.github/${script}`);
    }
  });

  it('builds the same bundles and drives the same entrypoint and checks', () => {
    for (const build of ['relay:executor:build', 'relay:julius:preflight:build', 'relay:julius:build']) {
      expect(workflow).toContain(`npm run ${build}`);
      expect(launcher).toContain(`npm run --silent ${build}`);
    }
    expect(workflow).toContain('npm run relay:julius:preflight');
    expect(launcher).toContain('npm run --silent relay:julius:preflight');
    expect(launcher).toContain('node scripts/julius-live-contract-check.mjs "$CONTRACT"');
    expect(launcher).toContain('node dist-relay-bridge/julius-live-mission.cjs observe-research --contract "$CONTRACT"');
    expect(launcher).toContain('node dist-relay-bridge/julius-live-mission.cjs run --contract "$CONTRACT" >');
  });

  it('discards the identity script\'s stdout, which carries the very secrets a runner masks', () => {
    expect(read('.github/julius-live-identity.sh'), 'the reason still holds').toContain('::add-mask::');
    const lines = launcher.split('\n').filter((line) => line.includes('./.github/julius-live-identity.sh') && !/^\s*#/u.test(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/\.\/\.github\/julius-live-identity\.sh >\/dev\/null$/u);
  });

  it('reduces evidence with the workflow\'s own allowlists and scans it with the workflow\'s own shapes', () => {
    const quoted = (text: string, head: string): string | undefined => {
      const start = text.indexOf(`'${head}`);
      return start < 0 ? undefined : text.slice(start + 1, text.indexOf("'", start + 1));
    };
    for (const head of ['^executor_(', '^(research_observation', '(sk-(ant-|proj-)?']) {
      const fromWorkflow = quoted(workflow, head);
      expect(fromWorkflow, `the workflow must still carry ${head}`).toBeDefined();
      expect(quoted(launcher, head), `${head} must be the workflow's pattern, verbatim`).toBe(fromWorkflow);
    }
  });
});

describe('Docker Desktop, and the live store on it, are out of reach', () => {
  it('proves the daemon is this distro\'s own before any subcommand touches a container', () => {
    const guard = functionBody('require_native_docker');
    expect(guard).toContain('export DOCKER_HOST=unix:///var/run/docker.sock');
    expect(guard).toContain("*'Docker Desktop'*) refuse");
    expect(guard).toContain('/mnt/*) refuse');
    for (const name of ['cmd_rig_up', 'cmd_preflight', 'cmd_evidence', 'cmd_rig_down', 'cmd_run']) {
      const body = functionBody(name);
      const guarded = body.indexOf('require_native_docker');
      expect(guarded, `${name} must prove the daemon first`).toBeGreaterThan(-1);
      for (const touch of ['docker ', './.github/', 'npm run']) {
        const first = codeLines(body).join('\n').indexOf(touch);
        if (first < 0) continue;
        expect(codeLines(body).join('\n').indexOf('require_native_docker'), `${name}: the guard precedes \`${touch.trim()}\``).toBeLessThan(first);
      }
    }
  });

  it('removes containers by name only after that proof', () => {
    const removal = codeLines(launcher).filter((line) => line.includes('docker rm -f julius-executor julius-postgres'));
    expect(removal).toHaveLength(1);
    expect(functionBody('cmd_rig_down')).toContain('docker rm -f julius-executor julius-postgres');
  });

  it('strips the Windows PATH, where docker is Docker Desktop\'s shim', () => {
    expect(launcher).toContain("grep -v '^/mnt/'");
  });
});

describe('the shared scripts\' new switches default to exactly what CI ran', () => {
  it('the executor publishes PostgreSQL on the one switchable port, 5432 when unset', () => {
    expect(executorScript).toContain('pg_port=${JULIUS_LIVE_PG_PORT:-5432}');
    expect(executorScript).toContain('-p "127.0.0.1:${pg_port}:5432"');
    expect(executorScript).toContain(`printf 'DATABASE_URL=postgresql://%s:%s@127.0.0.1:%s/%s\\n' "$PGUSER" "$PGPASSWORD" "$pg_port" "$PGDATABASE"`);
    expect(executorScript).toContain(`DATABASE_URL=$(printf 'postgresql://%s:%s@127.0.0.1:%s/%s' "$PGUSER" "$PGPASSWORD" "$pg_port" "$PGDATABASE")`);
    // Its comment explains why 127.0.0.1:5432 is taken locally; no EXECUTED line may name it.
    expect(codeLines(executorScript).join('\n'), 'no literal port may remain in the launch').not.toContain('127.0.0.1:5432');
    expect(executorScript).toContain('pg_port_refused');
  });

  it('Hermes defaults to the single install-and-bootstrap pass, from python3, under /opt', () => {
    expect(hermesScript).toContain('HERMES_PHASE=${HERMES_PHASE:-all}');
    expect(hermesScript).toContain('"${HERMES_PYTHON:-python3}" -m venv "$HERMES_VENV"');
    expect(hermesScript).toContain('HERMES_VENV=${HERMES_VENV_DIR:-/opt/hermes-venv}');
    expect(hermesScript).toContain('HERMES_SRC=${HERMES_SRC_DIR:-/opt/hermes-src}');
    expect(hermesScript).toContain('[ "$HERMES_PHASE" = install ] || : "${XAI_API_KEY:?missing XAI_API_KEY}"');
    // An install-only pass ends before the profile, the credential or the wrapper exist.
    expect(hermesScript.indexOf('if [ "$HERMES_PHASE" = install ]; then')).toBeLessThan(hermesScript.indexOf('mkdir -p "$HERMES_PROFILE_HOME"'));
    expect(hermesScript).not.toContain('/opt/hermes-venv/bin');
  });
});

describe('the frozen mission is pinned by content', () => {
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

  it('pins the tree of the mission this branch carries', () => {
    const pinned = /^readonly MISSION6_TREE=([0-9a-f]{40})$/mu.exec(launcher)?.[1];
    expect(pinned).toBeDefined();
    expect(git('rev-parse', `HEAD:.github/julius-missions/${MISSION}`), 'Mission 6 changed; the freeze is a founder decision').toBe(pinned);
  });

  it('pins every slice path the mission copies, and the preflight checks them', () => {
    const block = /^readonly MISSION6_SLICE_BLOBS='([^']*)'$/mu.exec(launcher)?.[1];
    expect(block).toBeDefined();
    const entries = block!.split('\n').map((entry) => entry.split('='));
    const slice = read(`.github/julius-missions/${MISSION}/slice.txt`).split('\n')
      .map((line) => line.replace(/#.*$/u, '').trim()).filter((line) => line !== '');
    for (const path of slice) {
      expect(entries.map(([path_]) => path_), `${path} is copied into the workspace and must be pinned`).toContain(path);
    }
    for (const [, blob] of entries) expect(blob).toMatch(/^[0-9a-f]{40}$/u);
    expect(functionBody('cmd_preflight')).toContain('done <<< "$MISSION6_SLICE_BLOBS"');
  });
});

/**
 * BEHAVIOUR, NOT ONLY TEXT: the refusals that stand before any effect. Each case runs the real
 * script and stops at a refusal that precedes every command with a side effect, so nothing here
 * touches Docker, sudo, a database or a provider.
 */
describe('the refusals that stand before anything runs', () => {
  const home = mkdtempSync(join(tmpdir(), 'julius-local-qual-'));
  const bash = (script: string, args: readonly string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [resolve(ROOT, script), ...args], {
      cwd: ROOT, encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: home, ...env },
    });

  it('refuses a launch environment that carries an Anthropic key, before printing anything else', () => {
    const result = bash(LAUNCHER_PATH, ['help'], { ANTHROPIC_API_KEY: 'FAKETESTNOTREAL' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('REFUSED: ANTHROPIC_API_KEY is set in the launch environment');
    expect(result.stdout).toBe('');
  });

  it('refuses a paid run without the literal confirmation, and with a near miss', () => {
    for (const args of [['run'], ['run', '--confirm', 'run live mission'], ['run', '--confirm', 'RUN LIVE MISSION ']]) {
      const result = bash(LAUNCHER_PATH, args);
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.stderr).toContain('run_not_confirmed');
    }
  });

  it('prints its own usage', () => {
    const result = bash(LAUNCHER_PATH, ['help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('provision-check');
    expect(result.stdout).toContain('rig-down');
  });

  it('the Hermes bootstrap refuses an unknown phase, and still needs the credential for every phase but install', () => {
    const base = {
      HERMES_PROFILE_HOME: join(home, 'profile'), HERMES_WRAPPER_DIR: join(home, 'wrapper'),
      HERMES_REQUEST_TIMEOUT_SECONDS: '480', RELAY_HERMES_MODEL: 'grok-build-0.1',
    };
    const unknown = bash('.github/julius-live-hermes.sh', [], { ...base, HERMES_PHASE: 'everything' });
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('hermes_phase_unknown:everything');
    for (const phase of ['bootstrap', 'all', '']) {
      const result = bash('.github/julius-live-hermes.sh', [], { ...base, ...(phase === '' ? {} : { HERMES_PHASE: phase }) });
      expect(result.status, `phase ${phase || '(unset)'}`).not.toBe(0);
      expect(result.stderr).toContain('missing XAI_API_KEY');
    }
    // `install` gets past the credential check and stops at its first real step, here a python
    // that fails at once, so nothing is created.
    const install = bash('.github/julius-live-hermes.sh', [], { ...base, HERMES_PHASE: 'install', HERMES_PYTHON: 'false', HERMES_VENV_DIR: join(home, 'venv') });
    expect(install.status).not.toBe(0);
    expect(install.stderr).not.toContain('missing XAI_API_KEY');
  });
});
