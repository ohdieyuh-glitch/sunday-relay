import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

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
  const VERIFIED = 'org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=VERIFIED organization_id=org_recorded';

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
      if (/\becho\b/u.test(line)) expect(line, 'nothing echoes a key').not.toMatch(/API_KEY/u);
    }
    expect(body).toContain('--config -');
    expect(body).toContain('node scripts/julius-org-attribution.mjs');
    expect(body).toContain('provider_balance=UNKNOWN');
    expect(body, 'the Anthropic key is an environment entry for the attribution script, never a curl argument').not.toContain('api.anthropic.com');
  });

  /**
   * Run the step for real. A fake curl answers OpenAI and xAI. A fake node,
   * earlier on PATH, answers the organization script with a closed line.
   * Neither is a live provider, and neither is presented as one.
   */
  const runReadiness = (statuses: { openai: string; xai: string }, env: Record<string, string> = {}, probe?: { line: string; exitCode: number }) => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-readiness-'));
    const record = dir.replace(/\\/gu, '/');
    const fakeNode = join(dir, 'node');
    writeFileSync(fakeNode, [
      '#!/usr/bin/env bash',
      'for arg in "$@"; do case "$arg" in *FAKETESTNOTREAL*) echo LEAK >> "$FAKE_DIR/leak";; esac; done',
      `printf '%s\\n' "$*" >> '${record}/node-argv'`,
      'case "$*" in',
      '  *julius-org-attribution.mjs*)',
      '    if [ -n "${JULIUS_ORG_PROBE_LINE:-}" ]; then printf \'%s\\n\' "$JULIUS_ORG_PROBE_LINE"; exit "${JULIUS_ORG_PROBE_EXIT:-1}"; fi',
      `    printf '%s\\n' '${VERIFIED}'`,
      '    exit 0;;',
      'esac',
      'echo "unexpected node: $*" >> "$FAKE_DIR/leak"',
      'exit 1',
    ].join('\n'));
    chmodSync(fakeNode, 0o755);
    const fakeCurl = join(dir, 'curl');
    writeFileSync(fakeCurl, [
      '#!/usr/bin/env bash',
      'config=$(cat)',
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
    let code = 0;
    let output = '';
    try {
      output = execFileSync('bash', [...GITHUB_BASH, script(readiness)], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
          FAKE_DIR: dir,
          GITHUB_WORKSPACE: dir,
          OPENAI_API_KEY: 'FAKETESTNOTREAL-openai',
          ANTHROPIC_API_KEY: 'FAKETESTNOTREAL-anthropic',
          XAI_API_KEY: 'FAKETESTNOTREAL-xai',
          JULIUS_EXPECTED_ANTHROPIC_ORG_ID: 'org_recorded',
          OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol',
          RELAY_HOSTED_CODING_MODEL: 'claude-opus-5-5',
          RELAY_HERMES_PROVIDER: 'xai',
          RELAY_HERMES_MODEL: 'grok-build-0.1',
          ...(probe === undefined ? {} : { JULIUS_ORG_PROBE_LINE: probe.line, JULIUS_ORG_PROBE_EXIT: String(probe.exitCode) }),
          ...env,
        },
      });
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
      output = String((error as { stdout?: string }).stdout ?? '');
    }
    const recorded = (name: string): string => { try { return readFileSync(join(dir, name), 'utf8'); } catch { return ''; } };
    return { code, output, leak: recorded('leak'), nodeArgv: recorded('node-argv').trim() };
  };

  it('both API providers authenticate and the organization line is VERIFIED, with no key in argv or output', () => {
    const run = runReadiness({ openai: '200', xai: '200' });
    expect(run.code).toBe(0);
    expect(run.output.match(/result=AUTHENTICATED_MODEL_AVAILABLE/gu)?.length).toBe(2);
    expect(run.output).toContain(VERIFIED);
    expect(run.output).toContain('provider_balance=UNKNOWN');
    expect(run.leak, 'no argv leak, and curl never calls Anthropic').toBe('');
    expect(run.output).not.toContain('FAKETESTNOTREAL');
    expect(run.nodeArgv).toBe('scripts/julius-org-attribution.mjs');
  });

  it('an unverified organization still probes the reviewer and fails closed', () => {
    const line = 'org_attribution provider=anthropic model=claude-opus-5-5 http=200 result=ORG_ATTRIBUTION_UNVERIFIED reason=mismatch organization_id=org_other expected_organization_id=org_recorded';
    const run = runReadiness({ openai: '200', xai: '200' }, {}, { line, exitCode: 1 });
    expect(run.code).not.toBe(0);
    expect(run.output).toContain(line);
    expect(run.output).toContain('ORG_ATTRIBUTION_UNVERIFIED');
    expect(run.output).toContain('provider_readiness provider=xai model=grok-build-0.1 http=200 result=AUTHENTICATED_MODEL_AVAILABLE');
    expect(run.output).toContain('provider_balance=UNKNOWN');
    expect(run.output).not.toContain('FAKETESTNOTREAL');
  });

  it('a refused credential or an unreachable API provider fails the job', () => {
    expect(runReadiness({ openai: '401', xai: '200' }).code).not.toBe(0);
    expect(runReadiness({ openai: '404', xai: '200' }).code).not.toBe(0);
    expect(runReadiness({ openai: '200', xai: '503' }).code).not.toBe(0);
  });

  it('a missing key or expected organization id fails before any request is made', () => {
    const blanks: Record<string, string>[] = [
      { XAI_API_KEY: '' },
      { ANTHROPIC_API_KEY: '' },
      { JULIUS_EXPECTED_ANTHROPIC_ORG_ID: '' },
    ];
    for (const blank of blanks) {
      const run = runReadiness({ openai: '200', xai: '200' }, blank);
      expect(run.code, JSON.stringify(blank)).not.toBe(0);
      expect(run.output, JSON.stringify(blank)).not.toContain('provider_readiness');
      expect(run.output, JSON.stringify(blank)).not.toContain('org_attribution');
      expect(run.nodeArgv, JSON.stringify(blank)).toBe('');
      expect(run.output).not.toContain('FAKETESTNOTREAL');
    }
  });
});
