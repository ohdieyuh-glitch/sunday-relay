import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { ANTHROPIC_CREDENTIAL_ENV_NAMES } from '../relay-bridge/hosted-coding-agent/hosted-auth';
import { sdkExecutableCandidates } from '../relay-bridge/hosted-coding-agent/hosted-login-probe';

/**
 * ONE SPENDING PATH, ONE SLOT, NO WAY AROUND EITHER.
 *
 * The queue logic is proven in `julius-paid-slot.test.ts` by calling the rule.
 * This file proves the WIRING that makes the rule binding: that the job which
 * can spend cannot start before admission, that admission itself runs only
 * proven code and holds nothing worth stealing, that no second workflow can
 * reach a provider key, and that the provider-readiness check fails a run
 * before spending — driven for real over a fake `curl`, not read as text.
 */

const ROOT = resolve(__dirname, '..');
const WORKFLOW_PATH = resolve(ROOT, '.github/workflows/julius-first-live-mission.yml');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

/**
 * The shell GitHub runs every `run:` step of both jobs in: their
 * `defaults.run.shell: bash` means `bash --noprofile --norc -eo pipefail {0}`.
 * Driving a step under anything laxer hides every early exit: a plain `bash -c`
 * never aborts on a failing command, and a step that `-e` ended early is exactly
 * what cost the smoke of run 36685079176 its verdict.
 */
const GITHUB_BASH = ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c'];

/** The text of one top-level job, from its key to the next job key. */
const job = (name: string): string => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name} must exist`).toBeGreaterThan(-1);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9-]*:\n/u);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

/** One step's block within a job's text, by its exact name. */
const step = (text: string, name: string): string => {
  const start = text.indexOf(`- name: ${name}`);
  expect(start, `step ${name} must exist`).toBeGreaterThan(-1);
  const rest = text.slice(start);
  const end = rest.indexOf('\n      - ', 1);
  return end < 0 ? rest : rest.slice(0, end);
};

/** A step's `run: |` script, de-indented, runnable by bash. */
const script = (block: string): string => {
  const at = block.indexOf('run: |\n');
  expect(at, 'the step must have a multi-line run script').toBeGreaterThan(-1);
  return block.slice(at + 'run: |\n'.length).split('\n').map((line) => line.replace(/^ {10}/u, '')).join('\n');
};

const ADMISSION = "'Admission: wait for the paid provider slot'";
const ADMISSION_GATE = "'Gate: admission runs only reviewed, current, not rolled-back code'";
const CLAIM_GATE = "'Gate: the paid-run queue claim is well formed'";
const READINESS = "'Preflight: each provider accepts its credential and serves the pinned model, nothing generated'";

describe('the job that can spend cannot start before admission', () => {
  const paidJob = job('first-live-mission');

  it('needs paid-slot, and runs only when admission succeeded or the run is not paid', () => {
    expect(paidJob).toMatch(/\n    needs: paid-slot\n/u);
    expect(paidJob).toContain("if: ${{ !cancelled() && (needs.paid-slot.result == 'success' || (needs.paid-slot.result == 'skipped' && inputs.confirm_live != 'RUN LIVE MISSION')) }}");
  });

  it('a paid run whose admission was skipped, failed or refused a duplicate cannot reach the job', () => {
    // The condition, evaluated the way Actions evaluates it, for every outcome.
    const admits = (result: string, confirm: string, cancelled = false): boolean =>
      !cancelled && (result === 'success' || (result === 'skipped' && confirm !== 'RUN LIVE MISSION'));
    expect(admits('success', 'RUN LIVE MISSION')).toBe(true);
    for (const result of ['failure', 'cancelled', 'skipped']) {
      expect(admits(result, 'RUN LIVE MISSION'), `a paid run with admission ${result}`).toBe(false);
    }
    expect(admits('skipped', ''), 'a dry run proceeds as it always has').toBe(true);
    expect(admits('success', 'RUN LIVE MISSION', true), 'a cancelled workflow starts nothing').toBe(false);
  });

  it('keeps the provider environment on the paid job alone', () => {
    expect(paidJob).toContain('environment: julius-live-validation');
  });
});

describe('admission holds nothing worth stealing, and runs only proven code', () => {
  const slot = job('paid-slot');

  it('runs only for a paid dispatch, with no environment and no secret', () => {
    expect(slot).toMatch(/\n    if: inputs\.confirm_live == 'RUN LIVE MISSION'\n/u);
    expect(slot).not.toMatch(/environment:/u);
    expect(slot).not.toMatch(/secrets\./u);
    expect(slot, 'the wait is bounded below the hosted-job cap').toMatch(/timeout-minutes: 350/u);
  });

  it('proves the checkout from the pinned verifier BEFORE any repository script runs', () => {
    const gate = step(slot, ADMISSION_GATE);
    expect(gate).toContain('node .julius-trusted-verifier/scripts/julius-live-preflight-gates.mjs');
    expect(gate).toContain('"${GITHUB_REPOSITORY}" main "${GITHUB_REF}" "${GITHUB_SHA}"');
    const gateAt = slot.indexOf(`- name: ${ADMISSION_GATE}`);
    const claimAt = slot.indexOf(`- name: ${CLAIM_GATE}`);
    const admissionAt = slot.indexOf(`- name: ${ADMISSION}`);
    expect(gateAt).toBeLessThan(claimAt);
    expect(claimAt).toBeLessThan(admissionAt);
    // Nothing before the gate runs `node scripts/...` or reads the lockfile.
    const beforeGate = slot.slice(0, gateAt);
    expect(beforeGate).not.toMatch(/node scripts\//u);
    expect(beforeGate).not.toMatch(/cache: npm/u);
  });

  it('checks the claim against the mission grant before occupying the queue', () => {
    const claim = step(slot, CLAIM_GATE);
    expect(claim).toContain('julius-live-contract-check.mjs');
    expect(claim).toContain('--lane "$LANE"');
  });

  it('waits through the queue script with the job token and the run id', () => {
    const admission = step(slot, ADMISSION);
    expect(admission).toContain('node scripts/julius-paid-slot.mjs wait --repo "$GITHUB_REPOSITORY" --run-id "$GITHUB_RUN_ID"');
    expect(admission).toContain('GH_TOKEN: ${{ github.token }}');
  });

  it('the run title carries the claim the queue reads', () => {
    expect(workflow).toMatch(/^run-name: "julius mission=\$\{\{ inputs\.mission \}\} lane=.* mode=.* key=.*"$/mu);
  });
});

describe('a lane is a grant, not a word typed at dispatch', () => {
  const check = (mission: string, lane: string): number => {
    try {
      execFileSync(process.execPath, [resolve(ROOT, 'scripts/julius-live-contract-check.mjs'), resolve(ROOT, `.github/julius-missions/${mission}/contract.json`), '--lane', lane], { stdio: 'ignore', cwd: ROOT });
      return 0;
    } catch (error) {
      return (error as { status?: number }).status ?? 1;
    }
  };

  it('the qualification may claim the head of the queue; nothing else may', () => {
    expect(check('julius-continuous-1', 'qualification')).toBe(0);
    expect(check('julius-continuous-1', 'qualification-repair')).toBe(0);
    expect(check('julius-continuous-1', 'lab'), 'the qualification is not an experiment').not.toBe(0);
    expect(check('julius-live-mission-5', 'qualification'), 'a historical mission cannot buy qualification priority').not.toBe(0);
    expect(check('julius-live-mission-5', 'regression')).toBe(0);
    expect(check('julius-continuous-1', 'urgent'), 'outside the vocabulary').not.toBe(0);
    expect(check('julius-continuous-1', ''), 'an empty claim is malformed, not absent').not.toBe(0);
  }, 30_000);
});

describe('no second spending path', () => {
  it('exactly one workflow references a provider key or the provider environment', () => {
    const dir = resolve(ROOT, '.github/workflows');
    const spenders = readdirSync(dir)
      .filter((file) => /\.ya?ml$/u.test(file))
      .filter((file) => /secrets\.(OPENAI|ANTHROPIC|XAI)_API_KEY|julius-live-validation/u.test(readFileSync(join(dir, file), 'utf8')));
    expect(spenders).toEqual(['julius-first-live-mission.yml']);
  });

  it('the only trigger is a human dispatch', () => {
    const on = /\non:\n([\s\S]*?)\n[a-z]/u.exec(workflow)?.[1] ?? '';
    expect(on).toContain('workflow_dispatch:');
    for (const trigger of ['push:', 'pull_request', 'schedule:', 'workflow_run:', 'repository_dispatch:']) {
      expect(on, `${trigger} would let something other than a dispatch start a paid run`).not.toContain(trigger);
    }
  });

  it('nothing in the paid workflow can cancel a run', () => {
    expect(workflow).not.toMatch(/cancel-in-progress:\s*true/u);
  });
});

describe('provider readiness fails before spending, and never exposes a key', () => {
  const paidJob = job('first-live-mission');
  const readiness = step(paidJob, READINESS);

  it('runs on every dispatch, before the roles check and long before LIVE', () => {
    expect(readiness, 'a condition would let a paid run skip it').not.toMatch(/\n\s+if:/u);
    const at = paidJob.indexOf(`- name: ${READINESS}`);
    expect(at).toBeLessThan(paidJob.indexOf("- name: 'Preflight: all three roles resolve"));
    expect(at).toBeLessThan(paidJob.indexOf("- name: 'LIVE: run the first real Julius mission'"));
  });

  it('the key reaches curl only through --config on stdin, and is never echoed', () => {
    const body = script(readiness);
    for (const line of body.split('\n')) {
      if (/API_KEY/u.test(line) && !/^\s*\[ -n "\$OPENAI_API_KEY" \]/u.test(line)) {
        expect(line, 'a key may only be interpolated into the printf that feeds --config').toMatch(/^\s*printf 'header = /u);
      }
      if (/\bcurl\b/u.test(line)) expect(line, 'curl never receives a key as an argument').not.toMatch(/API_KEY/u);
      // The Coding Agent's subscription token: presence-checked once, and otherwise
      // named only as the one allow-listed variable `env -i` hands the CLI — an
      // ENVIRONMENT entry for the child, never an argument to it, never printed.
      if (/CLAUDE_CODE_OAUTH_TOKEN/u.test(line)) {
        expect(line, 'the token is only presence-checked or handed to the CLI under env -i').toMatch(
          /^\s*(\[ -n "\$OPENAI_API_KEY" \] && \[ -n "\$CLAUDE_CODE_OAUTH_TOKEN" \] && \[ -n "\$XAI_API_KEY" \] \|\| \{|env -i -C "\$sub\/work" PATH="\$PATH" HOME="\$sub\/home" CI=1 NO_COLOR=1 TERM=dumb CLAUDE_CODE_OAUTH_TOKEN="\$CLAUDE_CODE_OAUTH_TOKEN" \\)$/u,
        );
      }
      if (/\becho\b/u.test(line)) expect(line, 'nothing echoes a key').not.toMatch(/API_KEY/u);
    }
    expect(body).toContain('--config -');
    expect(body).toContain('provider_balance=UNKNOWN');
  });

  /**
   * Run the step for real: a fake `curl` answers one status per API-billed provider,
   * and the Coding Agent's subscription is checked by the step's own literal `env -i`
   * command and the REAL check script, with a FAKE token. The step names the ubuntu
   * x64 CLI; here that path is a shim that records its argv, cwd and environment
   * NAMES and then runs the Agent SDK's REAL bundled CLI for this host — which
   * classifies a placeholder token offline as `oauth_token` (measured 2026-09-29),
   * so nothing is contacted. The step runs from a temporary copy of the workspace:
   * the check script (which imports only node builtins) and the shim.
   */
  const hostCli = (() => {
    const require = createRequire(join(ROOT, 'package.json'));
    for (const candidate of sdkExecutableCandidates()) {
      try { return require.resolve(candidate); } catch { /* not installed for this platform */ }
    }
    throw new Error('the Agent SDK bundled CLI is not installed for this platform');
  })();
  const CLI_ALLOWED_ENV = ['PATH', 'HOME', 'CI', 'NO_COLOR', 'TERM', 'CLAUDE_CODE_OAUTH_TOKEN'];
  /**
   * What the shim's own shell adds to its environment when it starts; none of it is
   * inherited through `env -i`. On Windows the MSYS runtime also sets its own three
   * (measured 2026-09-29) — none of them a credential.
   */
  const SHELL_OWN_ENV = ['PWD', 'OLDPWD', 'SHLVL', '_', ...(process.platform === 'win32' ? ['MSYSTEM', 'SYSTEMROOT', 'WINDIR'] : [])];
  /**
   * `loggedOut` swaps the real CLI for one that reports no login and exits 1, as a
   * CLI with no usable subscription does: the step must still reach its verdict,
   * probe the reviewer and fail on its count, not end early under `bash -e`.
   */
  const runReadiness = (statuses: { openai: string; xai: string }, env: Record<string, string> = {}, loggedOut = false) => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-readiness-'));
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(join(ROOT, 'scripts', 'julius-subscription-check.mjs'), join(dir, 'scripts', 'julius-subscription-check.mjs'));
    const shimDir = join(dir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64');
    mkdirSync(shimDir, { recursive: true });
    const record = dir.replace(/\\/gu, '/');
    writeFileSync(join(shimDir, 'claude'), [
      '#!/usr/bin/env bash',
      `for arg in "$@"; do case "$arg" in *FAKETESTNOTREAL*) echo LEAK >> '${record}/leak';; esac; done`,
      `printf '%s\\n' "$*" >> '${record}/cli-argv'`,
      `pwd >> '${record}/cli-cwd'`,
      `compgen -e >> '${record}/cli-env'`,
      loggedOut
        ? `printf '%s\\n' '{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}'; exit 1`
        : `exec '${hostCli.replace(/\\/gu, '/')}' "$@"`,
    ].join('\n'));
    chmodSync(join(shimDir, 'claude'), 0o755);
    const fakeCurl = join(dir, 'curl');
    writeFileSync(fakeCurl, [
      '#!/usr/bin/env bash',
      'config=$(cat)',
      // Record whether any key or token ever arrived as an argument — it must not.
      'for arg in "$@"; do case "$arg" in *FAKETESTNOTREAL*) echo LEAK >> "$FAKE_DIR/leak";; esac; done',
      'url="${@: -1}"',
      'case "$url" in',
      `  *api.openai.com*) printf '%s' "${statuses.openai}";;`,
      '  *api.anthropic.com*) echo ANTHROPIC_API_CALLED >> "$FAKE_DIR/leak"; printf 200;;',
      `  *api.x.ai*) printf '%s' "${statuses.xai}";;`,
      '  *) printf 000;;',
      'esac',
    ].join('\n'));
    chmodSync(fakeCurl, 0o755);
    const fakeSleep = join(dir, 'sleep');
    writeFileSync(fakeSleep, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(fakeSleep, 0o755);
    // Every route that outranks the subscription is BLANK here, whatever the shell
    // running the test holds, exactly as the workflow step never passes one.
    const blankRoutes = Object.fromEntries(ANTHROPIC_CREDENTIAL_ENV_NAMES.map((name) => [name, '']));
    let code = 0;
    let output = '';
    try {
      output = execFileSync('bash', [...GITHUB_BASH, script(readiness)], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...blankRoutes,
          PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
          FAKE_DIR: dir,
          GITHUB_WORKSPACE: dir,
          OPENAI_API_KEY: 'FAKETESTNOTREAL-openai', CLAUDE_CODE_OAUTH_TOKEN: 'FAKETESTNOTREAL-oauth', XAI_API_KEY: 'FAKETESTNOTREAL-xai',
          OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol', RELAY_HOSTED_CODING_MODEL: 'claude-opus-5-5',
          RELAY_HERMES_PROVIDER: 'xai', RELAY_HERMES_MODEL: 'grok-build-0.1',
          ...env,
        },
      });
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
      output = String((error as { stdout?: string }).stdout ?? '');
    }
    const recorded = (name: string): string => { try { return readFileSync(join(dir, name), 'utf8'); } catch { return ''; } };
    return {
      code, output,
      leak: recorded('leak'),
      cliArgv: recorded('cli-argv').trim(),
      cliCwd: recorded('cli-cwd').trim(),
      cliEnv: recorded('cli-env').split('\n').map((name) => name.trim()).filter(Boolean),
    };
  };

  it('all three ready: two API providers AUTHENTICATED, the Coding Agent on its SUBSCRIPTION, no key or token in argv or output', () => {
    const run = runReadiness({ openai: '200', xai: '200' });
    expect(run.code).toBe(0);
    expect(run.output.match(/result=AUTHENTICATED_MODEL_AVAILABLE/gu)?.length).toBe(2);
    expect(run.output).toContain('provider_readiness provider=anthropic model=claude-opus-5-5 http=none auth=CLAUDE_SUBSCRIPTION method=oauth_token plan=absent result=SUBSCRIPTION_LOGIN_PRESENT');
    expect(run.output).toContain('provider_balance=UNKNOWN');
    expect(run.leak, 'no argv leak, and the Anthropic API is never called').toBe('');
    expect(run.output).not.toContain('FAKETESTNOTREAL');
    // The CLI ran exactly once, zero-generation, from the empty work directory,
    // and nothing outside the allow-list reached it: no ANTHROPIC_*, no provider key.
    expect(run.cliArgv).toBe('auth status --json');
    expect(run.cliCwd.replace(/\\/gu, '/')).toMatch(/\/work$/u);
    expect(run.cliEnv.filter((name) => !SHELL_OWN_ENV.includes(name)).sort()).toEqual([...CLI_ALLOWED_ENV].sort());
  }, 60_000);

  it('a CLI that exits non-zero still leaves its verdict, the reviewer is still probed, and the count fails the job', () => {
    const run = runReadiness({ openai: '200', xai: '200' }, {}, true);
    expect(run.code).not.toBe(0);
    expect(run.cliArgv).toBe('auth status --json');
    expect(run.output).toContain('provider_readiness provider=anthropic model=claude-opus-5-5 http=none auth=CLAUDE_SUBSCRIPTION reason=NOT_LOGGED_IN result=SUBSCRIPTION_NOT_READY');
    expect(run.output).toContain('provider_readiness provider=xai model=grok-build-0.1 http=200 result=AUTHENTICATED_MODEL_AVAILABLE');
    expect(run.output).toContain('provider_balance=UNKNOWN');
    expect(run.output).not.toContain('FAKETESTNOTREAL');
  }, 60_000);

  it('an Anthropic route set in the step never reaches the CLI: refused before it runs', () => {
    for (const name of ANTHROPIC_CREDENTIAL_ENV_NAMES) {
      const run = runReadiness({ openai: '200', xai: '200' }, { [name]: 'FAKETESTNOTREAL-route' });
      expect(run.code, name).not.toBe(0);
      expect(run.output, name).toContain(`reason=OUTRANKED_BY_${name} result=SUBSCRIPTION_NOT_READY`);
      expect(run.cliArgv, `${name}: the CLI must not run at all`).toBe('');
      expect(run.output).not.toContain('FAKETESTNOTREAL');
    }
  }, 240_000);

  /**
   * The optional smoke step, driven for real over a FAKE CLI that answers fixed
   * JSON — the real one would spend subscription usage. Proves the step's own
   * shell: the request is sent only after a subscription status, and only an
   * exact OK passes.
   *
   * `cliExit` is what the fake CLI returns after printing the reply. The real CLI
   * exits NON-ZERO on an error reply, and under GitHub's `bash -e` that used to end
   * the step before smoke-verdict ever read the reply (run 36685079176). A shim that
   * always exited 0, run under a shell without `-e`, is why no case here caught it.
   */
  const runSmoke = (statusJson: string, replyJson: string, env: Record<string, string> = {}, cliExit = 0) => {
    const smoke = step(job('first-live-mission'), "'Subscription smoke: one tiny request on the Coding Agent''s subscription'");
    const dir = mkdtempSync(join(tmpdir(), 'julius-smoke-'));
    mkdirSync(join(dir, 'scripts'));
    copyFileSync(join(ROOT, 'scripts', 'julius-subscription-check.mjs'), join(dir, 'scripts', 'julius-subscription-check.mjs'));
    const shimDir = join(dir, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64');
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(join(dir, 'status.json'), statusJson);
    writeFileSync(join(dir, 'reply.json'), replyJson);
    const record = dir.replace(/\\/gu, '/');
    writeFileSync(join(shimDir, 'claude'), [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "$*" >> '${record}/cli-argv'`,
      `case "$1" in auth) cat '${record}/status.json';; -p) cat '${record}/reply.json'; exit ${cliExit};; esac`,
    ].join('\n'));
    chmodSync(join(shimDir, 'claude'), 0o755);
    const blankRoutes = Object.fromEntries(ANTHROPIC_CREDENTIAL_ENV_NAMES.map((name) => [name, '']));
    let code = 0;
    let output = '';
    try {
      output = execFileSync('bash', [...GITHUB_BASH, script(smoke)], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...blankRoutes, CLAUDE_CODE_OAUTH_TOKEN: 'FAKETESTNOTREAL-oauth', RELAY_HOSTED_CODING_MODEL: 'claude-opus-5-5', ...env },
      });
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
      output = String((error as { stdout?: string }).stdout ?? '');
    }
    let argv = '';
    try { argv = readFileSync(join(dir, 'cli-argv'), 'utf8'); } catch { /* the CLI never ran */ }
    return { code, output, calls: argv.split('\n').filter(Boolean) };
  };
  const TOKEN_ONLY = '{"loggedIn":true,"authMethod":"oauth_token","apiProvider":"firstParty"}';

  it('smoke: a subscription status and an exact OK pass, after exactly one literal request', () => {
    // modelUsage attests the requested model; a PASS will require it once the served-model
    // check lands, and today's verdict ignores it, so this fixture holds either way.
    const run = runSmoke(TOKEN_ONLY, '{"type":"result","subtype":"success","is_error":false,"result":"OK","modelUsage":{"claude-opus-5-5":{"inputTokens":3,"outputTokens":1}}}');
    expect(run.code).toBe(0);
    expect(run.output).toContain('subscription_smoke provider=anthropic model=claude-opus-5-5 auth=CLAUDE_SUBSCRIPTION method=oauth_token reply=OK result=PASS');
    expect(run.output).toContain('subscription_smoke_auth_exit=0');
    expect(run.output).toContain('subscription_smoke_cli_exit=0');
    expect(run.calls).toEqual([
      'auth status --json',
      '-p Reply with exactly OK --max-turns 1 --output-format json --model claude-opus-5-5 --setting-sources user --strict-mcp-config --no-session-persistence',
    ]);
    expect(run.output).not.toContain('FAKETESTNOTREAL');
  }, 60_000);

  it('smoke: an api_key status FAILS CLOSED and no request is sent; a wrong reply fails; a key in the step stops the CLI', () => {
    const apiKey = runSmoke('{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","apiKeySource":"ANTHROPIC_API_KEY"}', '{"result":"OK"}');
    expect(apiKey.code).not.toBe(0);
    expect(apiKey.output).toContain('reason=API_KEY_IN_PLAY result=SUBSCRIPTION_NOT_READY');
    expect(apiKey.calls).toEqual(['auth status --json']);
    // The real CLI exits 1 on an error reply. Under GitHub's `bash -e` the step must
    // still reach its verdict and say so, then fail closed.
    const wrong = runSmoke(TOKEN_ONLY, '{"type":"result","is_error":true,"result":"Credit balance is too low"}', {}, 1);
    expect(wrong.code).not.toBe(0);
    expect(wrong.output).toContain('subscription_smoke_cli_exit=1');
    expect(wrong.output).toContain('reply=ERROR result=FAIL');
    expect(wrong.output).not.toContain('Credit balance');
    // A CLI that dies printing nothing is judged UNREADABLE, not skipped.
    const silent = runSmoke(TOKEN_ONLY, '', {}, 1);
    expect(silent.code).not.toBe(0);
    expect(silent.output).toContain('subscription_smoke_cli_exit=1');
    expect(silent.output).toContain('reply=UNREADABLE result=FAIL');
    const outranked = runSmoke(TOKEN_ONLY, '{"result":"OK"}', { ANTHROPIC_API_KEY: 'FAKETESTNOTREAL-anthropic' });
    expect(outranked.code).not.toBe(0);
    expect(outranked.output).toContain('reason=OUTRANKED_BY_ANTHROPIC_API_KEY result=SUBSCRIPTION_NOT_READY');
    expect(outranked.calls).toEqual([]);
    expect(outranked.output).not.toContain('FAKETESTNOTREAL');
  }, 120_000);

  it('a refused credential or an unreachable API provider fails the job', () => {
    expect(runReadiness({ openai: '401', xai: '200' }).code).not.toBe(0);
    expect(runReadiness({ openai: '404', xai: '200' }).code).not.toBe(0);
    expect(runReadiness({ openai: '200', xai: '503' }).code).not.toBe(0);
  }, 120_000);

  it('an Anthropic API key beside the token fails the job: the subscription would be outranked', () => {
    const run = runReadiness({ openai: '200', xai: '200' }, { ANTHROPIC_API_KEY: 'FAKETESTNOTREAL-anthropic' });
    expect(run.code).not.toBe(0);
    expect(run.output).toContain('reason=OUTRANKED_BY_ANTHROPIC_API_KEY result=SUBSCRIPTION_NOT_READY');
    expect(run.output).not.toContain('FAKETESTNOTREAL');
  }, 60_000);

  it('a missing key or token fails before any request is made', () => {
    const blanks: Record<string, string>[] = [{ XAI_API_KEY: '' }, { CLAUDE_CODE_OAUTH_TOKEN: '' }];
    for (const blank of blanks) {
      const run = runReadiness({ openai: '200', xai: '200' }, blank);
      expect(run.code, JSON.stringify(blank)).not.toBe(0);
      expect(run.output).not.toContain('provider_readiness');
    }
  }, 60_000);
});
