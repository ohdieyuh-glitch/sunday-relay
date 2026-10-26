import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { LEGACY_RUN_ID_PATTERN, parseJuliusAdmissionRunId, WLJ_RUN_ID_PATTERN } from './julius-admission-run-id.mjs';
import { preflightIdentityFor } from './julius-live-preflight-identity';

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

/**
 * Assembled at runtime. A provider-key name followed by a long literal is a
 * committed assignment to the repository boundary scan, so this stand-in is
 * never written out beside that name.
 */
const joinedStandIn = (...parts: readonly string[]): string => parts.join('-');
const loginStandIn = joinedStandIn('oauth', 'placeholder', 'not', 'a', 'key');

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
    expect(paidJob).toMatch(/\n    needs: \[spend-tag, paid-slot\]\n/u);
    expect(paidJob).toContain("if: ${{ !cancelled() && needs.spend-tag.result == 'success' && (needs.paid-slot.result == 'success' || (needs.paid-slot.result == 'skipped' && inputs.confirm_live != 'RUN LIVE MISSION')) }}");
  });

  it('a paid run whose admission was skipped, failed or refused a duplicate cannot reach the job', () => {
    // The condition, evaluated the way Actions evaluates it, for every outcome.
    const admits = (result: string, confirm: string, cancelled = false, spend = 'success'): boolean =>
      !cancelled && spend === 'success' && (result === 'success' || (result === 'skipped' && confirm !== 'RUN LIVE MISSION'));
    expect(admits('success', 'RUN LIVE MISSION')).toBe(true);
    for (const result of ['failure', 'cancelled', 'skipped']) {
      expect(admits(result, 'RUN LIVE MISSION'), `a paid run with admission ${result}`).toBe(false);
    }
    expect(admits('skipped', ''), 'a dry run proceeds as it always has').toBe(true);
    expect(admits('success', 'RUN LIVE MISSION', true), 'a cancelled workflow starts nothing').toBe(false);
    expect(admits('success', 'RUN LIVE MISSION', false, 'failure'), 'a refused run id starts nothing').toBe(false);
  });

  it('keeps the provider environment on the paid job alone', () => {
    expect(paidJob).toContain('environment: julius-live-validation');
  });
});

describe('admission holds nothing worth stealing, and runs only proven code', () => {
  const slot = job('paid-slot');

  it('runs only for a paid dispatch, with no environment and no secret', () => {
    expect(slot).toMatch(/\n    needs: spend-tag\n/u);
    expect(slot).toMatch(/\n    if: needs\.spend-tag\.result == 'success' && inputs\.confirm_live == 'RUN LIVE MISSION'\n/u);
    expect(slot).not.toMatch(/environment:/u);
    expect(slot).not.toMatch(/secrets\./u);
    expect(slot, 'the wait is bounded below the hosted-job cap').toMatch(/timeout-minutes: 350/u);
  });

  it('proves the checkout with the attested trust chain BEFORE any other repository script runs', () => {
    const gate = step(slot, ADMISSION_GATE);
    // The attested verifier on main's own checkout; the frozen pinned verifier is gone.
    expect(gate).toContain('node scripts/julius-main-provenance-trust.mjs --require-trusted-verifier');
    expect(gate).toContain('node scripts/julius-main-provenance.mjs "${GITHUB_REPOSITORY}" main');
    expect(gate).toContain('node scripts/julius-main-monotonicity.mjs "${GITHUB_REPOSITORY}" main');
    expect(gate).not.toContain('.julius-trusted-verifier');
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
  /* Test fixtures only. The real ids come from the repository variables, never from source. */
  const ARCHITECT_ORG = 'aff8a85a-82c3-4ca7-afa7-8d3f63856dc4';
  const CODER_ORG = 'be82739b-746c-4288-a91b-6a332816e790';
  const verified = (role: 'architect' | 'coder', org: string): string =>
    `org_attribution provider=anthropic role=${role} model=claude-opus-5-5 http=200 result=VERIFIED organization_id=${org}`;
  const MARKER = "- name: 'Record that a paid mission was attempted (before any provider can be reached)'";

  /** The ORDER rule, as one predicate: after the build, before the marker, the roles check and LIVE. */
  const gateRunsBeforeMarker = (text: string): boolean => {
    const at = text.indexOf(`- name: ${READINESS}`);
    const build = text.indexOf('- name: Build the executor, the preflight probe and the live entrypoint');
    const marker = text.indexOf(MARKER);
    return at > -1 && build > -1 && marker > -1 && at > build && at < marker
      && at < text.indexOf("- name: 'Preflight: all three roles resolve")
      && at < text.indexOf("- name: 'LIVE: run the first real Julius mission'");
  };

  it('runs on every dispatch, after the build and before the attempted marker, the roles check and LIVE', () => {
    expect(readiness, 'a condition would let a paid run skip it').not.toMatch(/\n\s+if:/u);
    expect(gateRunsBeforeMarker(paidJob)).toBe(true);
  });

  it('MUTATION: the same gate moved after the attempted marker is refused by the order rule', () => {
    const block = `${readiness.trimEnd()}\n`;
    const without = paidJob.replace(block, '');
    expect(without, 'the mutation removed the step').not.toContain(`- name: ${READINESS}`);
    const markerAt = without.indexOf(MARKER);
    const nextStep = without.indexOf('\n      - name:', markerAt);
    const moved = `${without.slice(0, nextStep + 1)}      ${block}${without.slice(nextStep + 1)}`;
    expect(moved).toContain(`- name: ${READINESS}`);
    expect(gateRunsBeforeMarker(moved)).toBe(false);
  });

  it('the key reaches curl only through --config on stdin, and is never echoed', () => {
    const body = script(readiness);
    const expandsKey = /\$\{?[A-Z_]*API_KEY\b/u;
    for (const line of body.split('\n')) {
      if (expandsKey.test(line) && !/^\s*if \[ -z "\$\{ANTHROPIC_ARCHITECT_API_KEY:-\}" \]; then$/u.test(line)) {
        expect(line, 'a key may only be interpolated into the printf that feeds --config').toMatch(/^\s*printf 'header = /u);
      }
      if (/\bcurl\b/u.test(line)) expect(line, 'curl never receives a key as an argument').not.toMatch(/API_KEY/u);
      if (/\becho\b/u.test(line)) expect(line, 'nothing echoes a key').not.toMatch(expandsKey);
    }
    expect(body).toContain('--config -');
    expect(body).toContain('JULIUS_ORG_ATTRIBUTION_ROLE=architect node scripts/julius-org-attribution.mjs');
    expect(body).toContain('JULIUS_ORG_ATTRIBUTION_ROLE=coder node scripts/julius-org-attribution.mjs');
    expect(body, 'the consumer login token is not a readiness credential').not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    expect(body).toContain('provider_balance=UNKNOWN');
    expect(body, 'OpenAI is not a J1 requirement').not.toMatch(/OPENAI|api\.openai\.com/u);
    expect(readiness, 'OpenAI is not passed to the readiness step').not.toContain('secrets.OPENAI_API_KEY');
  });

  /**
   * Run the step for real. A fake curl answers Anthropic (per key) and xAI. A fake
   * node, earlier on PATH, answers the organization script with one closed line per
   * role. Neither is a live provider, and neither is presented as one.
   */
  const runReadiness = (
    statuses: { architect?: string; coder?: string; xai: string },
    env: Record<string, string> = {},
    orgs: { architect?: string; coder?: string } = {},
  ) => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-readiness-'));
    const record = dir.replace(/\\/gu, '/');
    const fakeNode = join(dir, 'node');
    writeFileSync(fakeNode, [
      '#!/usr/bin/env bash',
      'for arg in "$@"; do case "$arg" in *FAKETESTNOTREAL*) echo LEAK >> "$FAKE_DIR/leak";; esac; done',
      `printf '%s %s\\n' "\${JULIUS_ORG_ATTRIBUTION_ROLE:-none}" "$*" >> '${record}/node-argv'`,
      'case "$*" in',
      '  *julius-org-attribution.mjs*)',
      '    case "${JULIUS_ORG_ATTRIBUTION_ROLE:-}" in',
      `      architect) if [ -n "\${FAKE_ARCHITECT_LINE:-}" ]; then printf '%s\\n' "$FAKE_ARCHITECT_LINE"; exit 1; fi; printf '%s\\n' "org_attribution provider=anthropic role=architect model=claude-opus-5-5 http=200 result=VERIFIED organization_id=$FAKE_ARCHITECT_ORG";;`,
      `      coder) if [ -n "\${FAKE_CODER_LINE:-}" ]; then printf '%s\\n' "$FAKE_CODER_LINE"; exit 1; fi; printf '%s\\n' "org_attribution provider=anthropic role=coder model=claude-opus-5-5 http=200 result=VERIFIED organization_id=$FAKE_CODER_ORG";;`,
      '      *) echo "role missing" >> "$FAKE_DIR/leak"; exit 1;;',
      '    esac',
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
      '  *api.openai.com*) echo OPENAI_CALLED >> "$FAKE_DIR/leak"; printf 200;;',
      '  *api.anthropic.com*)',
      '    case "$config" in',
      `      *FAKETESTNOTREAL-anthropic-architect*) printf '%s' "${statuses.architect ?? '200'}";;`,
      `      *FAKETESTNOTREAL-anthropic*) printf '%s' "${statuses.coder ?? '200'}";;`,
      '      *) printf 000;;',
      '    esac;;',
      `  *api.x.ai*) printf '%s' "${statuses.xai}";;`,
      '  *) printf 000;;',
      'esac',
    ].join('\n'));
    chmodSync(fakeCurl, 0o755);
    const fakeSleep = join(dir, 'sleep');
    writeFileSync(fakeSleep, '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(fakeSleep, 0o755);
    const outputFile = join(dir, 'github-output');
    writeFileSync(outputFile, '');
    let code = 0;
    let output = '';
    let stderr = '';
    try {
      output = execFileSync('bash', [...GITHUB_BASH, script(readiness)], {
        cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PATH: `${dir}${delimiter}${process.env.PATH ?? ''}`,
          FAKE_DIR: dir,
          GITHUB_WORKSPACE: dir,
          GITHUB_OUTPUT: outputFile,
          FAKE_ARCHITECT_ORG: orgs.architect ?? ARCHITECT_ORG,
          FAKE_CODER_ORG: orgs.coder ?? CODER_ORG,
          ANTHROPIC_ARCHITECT_API_KEY: 'FAKETESTNOTREAL-anthropic-architect',
          JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID: ARCHITECT_ORG,
          ANTHROPIC_API_KEY: 'FAKETESTNOTREAL-anthropic',
          XAI_API_KEY: 'FAKETESTNOTREAL-xai',
          JULIUS_EXPECTED_ANTHROPIC_ORG_ID: CODER_ORG,
          RELAY_ANTHROPIC_ARCHITECT_MODEL: 'claude-opus-5-5',
          RELAY_HOSTED_CODING_MODEL: 'claude-opus-5-5',
          RELAY_HERMES_PROVIDER: 'xai',
          RELAY_HERMES_MODEL: 'grok-build-0.1',
          ...env,
        },
      });
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
      output = String((error as { stdout?: string }).stdout ?? '');
      stderr = String((error as { stderr?: string }).stderr ?? '');
    }
    const recorded = (name: string): string => { try { return readFileSync(join(dir, name), 'utf8'); } catch { return ''; } };
    return { code, output, stderr, leak: recorded('leak'), nodeArgv: recorded('node-argv').trim(), githubOutput: recorded('github-output') };
  };

  it('both Anthropic keys and xAI authenticate, both organizations are VERIFIED and distinct, with no key in argv or output', () => {
    const run = runReadiness({ xai: '200' });
    expect(run.code, run.stderr).toBe(0);
    expect(run.output).toContain('provider_readiness provider=anthropic role=architect model=claude-opus-5-5 http=200 result=AUTHENTICATED_MODEL_AVAILABLE');
    expect(run.output).toContain('provider_readiness provider=anthropic role=coder model=claude-opus-5-5 http=200 result=AUTHENTICATED_MODEL_AVAILABLE');
    expect(run.output.match(/result=AUTHENTICATED_MODEL_AVAILABLE/gu)?.length).toBe(3);
    expect(run.output).toContain(verified('architect', ARCHITECT_ORG));
    expect(run.output).toContain(verified('coder', CODER_ORG));
    expect(run.output).toContain(`org_attribution_distinct result=DISTINCT architect_organization_id=${ARCHITECT_ORG} coder_organization_id=${CODER_ORG}`);
    expect(run.output).toContain('provider_balance=UNKNOWN');
    expect(run.leak, 'no argv leak, and OpenAI is never contacted').toBe('');
    expect(run.output).not.toContain('FAKETESTNOTREAL');
    expect(run.nodeArgv.split('\n')).toEqual(['architect scripts/julius-org-attribution.mjs', 'coder scripts/julius-org-attribution.mjs']);
    // The verified ids are the gate's outputs, for LIVE.
    expect(run.githubOutput).toBe(`architect_org=${ARCHITECT_ORG}\ncoder_org=${CODER_ORG}\n`);
  });

  it('the two keys billing the same organization is refused before the marker', () => {
    const run = runReadiness({ xai: '200' }, {}, { architect: CODER_ORG, coder: CODER_ORG });
    expect(run.code).not.toBe(0);
    expect(run.output).toContain(`org_attribution_distinct result=REFUSED reason=architect_and_coder_share_an_organization organization_id=${CODER_ORG}`);
    expect(run.stderr).toContain('two distinct accounts are required');
    expect(run.githubOutput).toBe('');
  });

  it("either role's organization not matching its OWN expected id still probes the reviewer and fails closed", () => {
    for (const [role, expected] of [['architect', ARCHITECT_ORG], ['coder', CODER_ORG]] as const) {
      const line = `org_attribution provider=anthropic role=${role} model=claude-opus-5-5 http=200 result=ORG_ATTRIBUTION_UNVERIFIED reason=mismatch organization_id=org_other expected_organization_id=${expected}`;
      const run = runReadiness({ xai: '200' }, role === 'architect' ? { FAKE_ARCHITECT_LINE: line } : { FAKE_CODER_LINE: line });
      expect(run.code, role).not.toBe(0);
      expect(run.output, role).toContain(line);
      expect(run.output, role).toContain('provider_readiness provider=xai model=grok-build-0.1 http=200 result=AUTHENTICATED_MODEL_AVAILABLE');
      expect(run.stderr, role).toContain('ORG_ATTRIBUTION_UNVERIFIED');
      expect(run.githubOutput, role).toBe('');
      expect(run.output).not.toContain('FAKETESTNOTREAL');
    }
  }, 60_000);

  it('a refused credential or an unreachable API provider fails the job', () => {
    expect(runReadiness({ architect: '401', xai: '200' }).code).not.toBe(0);
    expect(runReadiness({ coder: '401', xai: '200' }).code).not.toBe(0);
    expect(runReadiness({ architect: '404', xai: '200' }).code).not.toBe(0);
    expect(runReadiness({ xai: '503' }).code).not.toBe(0);
  }, 60_000);

  it('a missing key or expected organization id fails before any request is made, by name', () => {
    for (const name of ['ANTHROPIC_ARCHITECT_API_KEY', 'JULIUS_EXPECTED_ANTHROPIC_ARCHITECT_ORG_ID', 'XAI_API_KEY', 'ANTHROPIC_API_KEY', 'JULIUS_EXPECTED_ANTHROPIC_ORG_ID']) {
      const run = runReadiness({ xai: '200' }, { [name]: '' });
      expect(run.code, name).not.toBe(0);
      expect(run.stderr, name).toContain(`provider_credentials_missing: ${name}`);
      expect(run.output, name).not.toContain('provider_readiness');
      expect(run.output, name).not.toContain('org_attribution');
      expect(run.nodeArgv, name).toBe('');
      expect(run.output).not.toContain('FAKETESTNOTREAL');
    }
    const unset = runReadiness({ xai: '200' }, { ANTHROPIC_ARCHITECT_API_KEY: '' });
    expect(unset.stderr).toContain('architect_credential_unset');
  }, 60_000);

  it('OpenAI is neither required nor contacted: an absent OpenAI key changes nothing', () => {
    const run = runReadiness({ xai: '200' }, { OPENAI_API_KEY: '' });
    expect(run.code, run.stderr).toBe(0);
    expect(run.leak).toBe('');
  });
});

describe('the coder stops before a provider call unless the user-owned API key is present', () => {
  const gate = step(job('first-live-mission'), "'Gate: coder uses the Anthropic API key'");
  const body = script(gate);

  const runGate = (apiKey: string): { status: number; stderr: string; stdout: string } => {
    try {
      const stdout = execFileSync('bash', [...GITHUB_BASH, body], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ANTHROPIC_API_KEY: apiKey, CLAUDE_CODE_OAUTH_TOKEN: loginStandIn },
      });
      return { status: 0, stderr: '', stdout };
    } catch (error) {
      const failed = error as { status?: number; stderr?: string; stdout?: string };
      return { status: failed.status ?? 1, stderr: failed.stderr ?? '', stdout: failed.stdout ?? '' };
    }
  };

  it('fails closed when the API key is absent, and does not print either credential', () => {
    expect(gate).toContain('ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}');
    expect(gate).not.toContain('secrets.CLAUDE_CODE_OAUTH_TOKEN');
    expect(body).not.toMatch(/echo "\$ANTHROPIC_API_KEY"|echo "\$CLAUDE_CODE_OAUTH_TOKEN"/u);
    const missing = runGate('');
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('coder_auth_api_key_required');
    expect(missing.stderr).not.toContain('oauth-placeholder');
    expect(missing.stdout).not.toContain('oauth-placeholder');
    const present = runGate('FAKETESTNOTREAL-anthropic');
    expect(present.status).toBe(0);
    expect(present.stdout).toContain('coder_auth=ANTHROPIC_API_KEY');
    expect(present.stdout).not.toContain('FAKETESTNOTREAL');
    expect(present.stderr).not.toContain('FAKETESTNOTREAL');
  });

  it('the roles preflight and LIVE take the API key and not the consumer login token', () => {
    const paid = job('first-live-mission');
    for (const name of ["'Preflight: all three roles resolve to the expected models, nothing dispatched'", "'LIVE: run the first real Julius mission'"]) {
      const block = step(paid, name);
      expect(block).toContain('JULIUS_CLAUDE_AUTH: ANTHROPIC_API');
      expect(block).toContain('ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}');
      expect(block).not.toContain('secrets.CLAUDE_CODE_OAUTH_TOKEN');
      expect(block).not.toContain('CLAUDE_SUBSCRIPTION');
    }
    const liveAt = paid.indexOf("- name: 'LIVE: run the first real Julius mission'");
    const gateAt = paid.indexOf("- name: 'Gate: coder uses the Anthropic API key'");
    const readyAt = paid.indexOf(`- name: ${READINESS}`);
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(readyAt);
    expect(readyAt).toBeLessThan(liveAt);
  });
});

describe('a paid run is attempt 1 only', () => {
  const RERUN_GATE = "'Gate: a paid run is attempt 1 only'";
  const runGate = (text: string, env: Record<string, string>): { status: number; stderr: string } => {
    try {
      execFileSync('bash', [...GITHUB_BASH, text], { cwd: ROOT, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, stderr: '' };
    } catch (error) {
      const failed = error as { status?: number; stderr?: string };
      return { status: failed.status ?? 1, stderr: failed.stderr ?? '' };
    }
  };

  it('is the paid job\'s first step, paid-only, and refuses a re-run before anything else runs', () => {
    const paidJob = job('first-live-mission');
    const steps = paidJob.slice(paidJob.indexOf('\n    steps:\n'));
    const first = steps.search(/\n      - (name|uses):/u);
    expect(steps.slice(first + 1).startsWith(`      - name: ${RERUN_GATE}`)).toBe(true);
    const gate = step(paidJob, RERUN_GATE);
    expect(gate).toContain("if: inputs.confirm_live == 'RUN LIVE MISSION'\n");
    const text = script(gate);
    expect(runGate(text, { GITHUB_RUN_ATTEMPT: '1' }).status).toBe(0);
    for (const attempt of ['2', '10', '', '01', '1 ']) {
      const refused = runGate(text, { GITHUB_RUN_ATTEMPT: attempt });
      expect(refused.status, JSON.stringify(attempt)).not.toBe(0);
      expect(refused.stderr, JSON.stringify(attempt)).toContain('PAID_RERUN_REFUSED');
    }
  });
});

describe('one spent tag per admission run id, before any provider call', () => {
  const HEX = '0123456789abcdef01234567';
  const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
  const WLJ_HEX = '0123456789ab4cde8fab0123456789ab';
  const tagJob = job('spend-tag');
  const tagScript = script(step(tagJob, "'Gate: one spent tag for this admission run id, before any provider call'"));

  it('a paid re-run (attempt above 1) halts PAID_RERUN_REFUSED before any API call; a preflight re-run creates no tag either way', () => {
    const paid = { JULIUS_RUN_ID: WLJ, CONFIRM_LIVE: 'RUN LIVE MISSION' };
    for (const attempt of ['2', '3', '']) {
      const refused = runTag({ ...paid, GITHUB_RUN_ATTEMPT: attempt });
      expect(refused.status, JSON.stringify(attempt)).not.toBe(0);
      expect(refused.stderr, JSON.stringify(attempt)).toContain('PAID_RERUN_REFUSED');
      expect(refused.curlLog, JSON.stringify(attempt)).toBe('');
    }
    const preflight = runTag({ JULIUS_RUN_ID: WLJ, CONFIRM_LIVE: '', GITHUB_RUN_ATTEMPT: '2' });
    expect(preflight.status).toBe(0);
    expect(preflight.curlLog).toBe('');
    const first = runTag({ ...paid, GITHUB_RUN_ATTEMPT: '1' });
    expect(first.stderr).not.toContain('PAID_RERUN_REFUSED');
    expect(first.curlLog).not.toBe('');
  });

  const runTag = (env: Record<string, string>, curl?: { code?: string; body?: string; exitCode?: string; getCode?: string; getBody?: string; refCode?: string; refBody?: string }): { status: number; stderr: string; output: string; curlLog: string } => {
    const bin = mkdtempSync(join(tmpdir(), 'julius-spent-tag-'));
    const curlLog = join(bin, 'curl.log');
    const getCode = curl?.getCode ?? (curl?.code === '500' ? '500' : '404');
    const refCode = curl?.refCode ?? (curl?.code === '422' ? '422' : '201');
    const refBody = curl?.refBody ?? (curl?.code === '422' ? (curl.body ?? '') : '');
    writeFileSync(join(bin, 'curl'), [
      '#!/usr/bin/env bash',
      'out=""',
      'method="GET"',
      'data=""',
      'url=""',
      'prev=""',
      'for arg in "$@"; do',
      '  printf \'%s\\n\' "$arg" >> "$CURL_LOG"',
      '  if [ "$prev" = "-o" ]; then out=$arg; fi',
      '  if [ "$prev" = "-X" ]; then method=$arg; fi',
      '  if [ "$prev" = "--data-binary" ]; then data=$arg; fi',
      '  case "$arg" in https://*) url=$arg ;; esac',
      '  prev=$arg',
      'done',
      'printf \'DATA %s\\n\' "$data" >> "$CURL_LOG"',
      'if [ "${CURL_EXIT:-0}" != 0 ]; then exit "$CURL_EXIT"; fi',
      'respond() {',
      '  if [ -n "$out" ]; then printf \'%s\' "$2" > "$out"; fi',
      '  printf \'%s\' "$1"',
      '  exit 0',
      '}',
      'if [ "$method" = GET ]; then respond "$CURL_GET_CODE" "$CURL_GET_BODY"; fi',
      'case "$url" in',
      '  */git/refs)',
      '    if [ "$CURL_REF_CODE" = 201 ]; then',
      '      sha=$(printf \'%s\' "$data" | grep -oE \'[0-9a-f]{40}\' | head -1)',
      '      respond 201 "{\\"ref\\":\\"refs/tags/julius-run-spent\\",\\"object\\":{\\"sha\\":\\"$sha\\",\\"type\\":\\"tag\\"}}"',
      '    fi',
      '    respond "$CURL_REF_CODE" "$CURL_REF_BODY"',
      '    ;;',
      '  *)',
      '    count=0',
      '    if [ -f "$CURL_LOG.count" ]; then count=$(cat "$CURL_LOG.count"); fi',
      '    count=$((count + 1))',
      '    printf \'%s\' "$count" > "$CURL_LOG.count"',
      '    sha=$(printf \'%040x\' "$count")',
      '    respond 201 "{\\"sha\\":\\"$sha\\"}"',
      '    ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(join(bin, 'curl'), 0o755);
    const output = join(bin, 'github-output.txt');
    writeFileSync(output, '');
    try {
      execFileSync('bash', [...GITHUB_BASH, tagScript], {
        cwd: ROOT,
        env: {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
          CURL_LOG: curlLog,
          CURL_GET_CODE: getCode,
          CURL_GET_BODY: curl?.getBody ?? '',
          CURL_REF_CODE: refCode,
          CURL_REF_BODY: refBody,
          CURL_EXIT: curl?.exitCode ?? '0',
          GITHUB_RUN_ATTEMPT: '1',
          GITHUB_OUTPUT: output,
          GITHUB_RUN_ID: '4242',
          GITHUB_SHA: 'a'.repeat(40),
          GITHUB_REPOSITORY: 'ohdieyuh-glitch/sunday-relay',
          GH_TOKEN: 'github-token-placeholder',
          JULIUS_RUN_ID: '',
          MISSION: 'julius-first-live',
          CONFIRM_LIVE: '',
          ...env,
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return {
        status: 0, stderr: '', output: readFileSync(output, 'utf8'),
        curlLog: (() => { try { return readFileSync(curlLog, 'utf8'); } catch { return ''; } })(),
      };
    } catch (error) {
      const failed = error as { status?: number; stderr?: string };
      return {
        status: failed.status ?? 1,
        stderr: failed.stderr ?? '',
        output: (() => { try { return readFileSync(output, 'utf8'); } catch { return ''; } })(),
        curlLog: (() => { try { return readFileSync(curlLog, 'utf8'); } catch { return ''; } })(),
      };
    }
  };

  it('the workflow contains both id patterns and does not mint a run id', () => {
    expect(tagScript).toContain(WLJ_RUN_ID_PATTERN);
    expect(tagScript).toContain(LEGACY_RUN_ID_PATTERN);
    expect(tagScript).toContain('node scripts/julius-admission-run-id.mjs derive');
    expect(tagScript.indexOf('node scripts/julius-admission-run-id.mjs derive')).toBeLessThan(tagScript.indexOf('curl '));
    expect(tagScript).not.toMatch(/randomUUID|randomBytes|openssl rand|\/dev\/urandom/u);
    expect(tagScript).not.toContain('${{');
    expect(tagJob).not.toMatch(/secrets\./u);
    expect(tagJob).toMatch(/\n    permissions:\n      contents: write\n/u);
    expect(job('paid-slot')).not.toMatch(/\n    permissions:\n/u);
    // The paid job declares its own block (the read set plus statuses: write for the live-progress publisher), pinned below.
    expect(job('first-live-mission')).toMatch(/\n    permissions:\n/u);
    expect(workflow).toMatch(/concurrency:\s*\n\s*group:\s*\$\{\{ inputs\.confirm_live == 'RUN LIVE MISSION' && 'julius-paid-provider-slot'/u);
  });

  it('refuses uppercase, a UUIDv1, a UUIDv7, and other malformed ids before any tag write', () => {
    for (const value of [
      'wlj_01234567-89AB-4CDE-8FAB-0123456789AB',
      'wlj_01234567-89ab-1cde-8fab-0123456789ab',
      'wlj_01234567-89ab-7cde-8fab-0123456789ab',
      'wlj_01234567-89ab-4cde-cfab-0123456789ab',
      `run:${HEX.toUpperCase()}`,
      `run:${HEX.slice(0, 23)}`,
      'not-an-id',
    ]) {
      const run = runTag({ JULIUS_RUN_ID: value, CONFIRM_LIVE: 'RUN LIVE MISSION' });
      expect(run.status, value).not.toBe(0);
      expect(run.stderr, value).toContain('admission_run_id_malformed');
      expect(run.curlLog, value).toBe('');
    }
  });

  it('a missing id is a hard failure for a paid run and a preflight, and mints nothing', () => {
    for (const confirm of ['RUN LIVE MISSION', '']) {
      const refused = runTag({ JULIUS_RUN_ID: '', CONFIRM_LIVE: confirm });
      expect(refused.status, confirm).not.toBe(0);
      expect(refused.stderr, confirm).toContain('admission_run_id_required');
      expect(refused.curlLog, confirm).toBe('');
    }
  });

  it('derives the 32-hex wlj tag and the 24-hex legacy tag, and a preflight writes neither', () => {
    const dry = runTag({ JULIUS_RUN_ID: WLJ, CONFIRM_LIVE: '' });
    expect(dry.status).toBe(0);
    expect(dry.output).toContain(`run_id=${WLJ}`);
    expect(dry.output).toContain(`concurrency_group=julius-paid-${WLJ_HEX}`);
    expect(dry.output).toContain('trace_id=192b1fbb866790da0ba590b4a8f45144');
    expect(dry.curlLog).toBe('');
    const created = runTag({ JULIUS_RUN_ID: WLJ, CONFIRM_LIVE: 'RUN LIVE MISSION' });
    expect(created.status).toBe(0);
    expect(created.curlLog).toContain(`/git/ref/tags/julius-run-spent-${WLJ_HEX}`);
    expect(created.curlLog).toContain(`refs/tags/julius-run-spent-${WLJ_HEX}`);
    expect(created.curlLog).toContain(`run=${WLJ}`);
    expect(created.curlLog).toContain('reservedUsdMicros=5000000');
    expect(created.curlLog).not.toContain('192b1fbb866790da0ba590b4a8f45144');
    expect(created.curlLog).not.toContain('trace_id=');
    expect(created.output).not.toContain('github-token-placeholder');
    const legacy = runTag({ JULIUS_RUN_ID: `run:${HEX}`, CONFIRM_LIVE: 'RUN LIVE MISSION' });
    expect(legacy.status).toBe(0);
    expect(legacy.output).toContain(`concurrency_group=julius-paid-${HEX}`);
    expect(legacy.curlLog).toContain(`/git/ref/tags/julius-run-spent-${HEX}`);
    expect(legacy.curlLog).toContain(`run=run:${HEX}`);
    expect(legacy.output).toContain('trace_id=null');
    expect(legacy.curlLog).not.toContain('trace_id=');
  });

  it('a second dispatch of the same id creates no second tag', () => {
    const bin = mkdtempSync(join(tmpdir(), 'julius-spent-replay-'));
    const state = join(bin, 'spent');
    writeFileSync(join(bin, 'curl'), [
      '#!/usr/bin/env bash',
      'out=""',
      'method="GET"',
      'data=""',
      'url=""',
      'prev=""',
      'for arg in "$@"; do',
      '  printf \'%s\\n\' "$arg" >> "$CURL_LOG"',
      '  if [ "$prev" = "-o" ]; then out=$arg; fi',
      '  if [ "$prev" = "-X" ]; then method=$arg; fi',
      '  if [ "$prev" = "--data-binary" ]; then data=$arg; fi',
      '  case "$arg" in https://*) url=$arg ;; esac',
      '  prev=$arg',
      'done',
      'respond() {',
      '  if [ -n "$out" ]; then printf \'%s\' "$2" > "$out"; fi',
      '  printf \'%s\' "$1"',
      '  exit 0',
      '}',
      'if [ "$method" = GET ]; then',
      '  if [ -f "$SPENT_STATE" ]; then respond 200 \'{"object":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}\' ; fi',
      '  respond 404 \'\'',
      'fi',
      'sha=$(printf \'%s\' "$data" | grep -oE \'[0-9a-f]{40}\' | head -1 || true)',
      'if [ -z "$sha" ]; then sha=$(printf \'%040x\' 1); fi',
      'case "$url" in',
      '  */git/refs)',
      '    printf \'%s\' "$url" > "$SPENT_STATE"',
      '    respond 201 "{\\"ref\\":\\"refs/tags/julius-run-spent\\",\\"object\\":{\\"sha\\":\\"$sha\\",\\"type\\":\\"tag\\"}}"',
      '    ;;',
      '  *) respond 201 "{\\"sha\\":\\"$sha\\"}" ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(join(bin, 'curl'), 0o755);
    let invokeCount = 0;
    const invoke = (id: string): { status: number; stderr: string; curlLog: string } => {
      invokeCount += 1;
      const curlLog = join(bin, `curl-${invokeCount}.log`);
      const output = join(bin, 'github-output.txt');
      writeFileSync(output, '');
      try {
        execFileSync('bash', [...GITHUB_BASH, tagScript], {
          cwd: ROOT,
          env: {
            ...process.env,
            PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
            CURL_LOG: curlLog,
            SPENT_STATE: state,
            GITHUB_RUN_ATTEMPT: '1',
            GITHUB_OUTPUT: output,
            GITHUB_RUN_ID: '4242',
            GITHUB_SHA: 'a'.repeat(40),
            GITHUB_REPOSITORY: 'ohdieyuh-glitch/sunday-relay',
            GH_TOKEN: 'github-token-placeholder',
            JULIUS_RUN_ID: id,
            MISSION: 'julius-first-live',
            CONFIRM_LIVE: 'RUN LIVE MISSION',
          },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { status: 0, stderr: '', curlLog: readFileSync(curlLog, 'utf8') };
      } catch (error) {
        const failed = error as { status?: number; stderr?: string };
        let curlText = '';
        try { curlText = readFileSync(curlLog, 'utf8'); } catch { curlText = ''; }
        return { status: failed.status ?? 1, stderr: failed.stderr ?? '', curlLog: curlText };
      }
    };
    const created = invoke(WLJ);
    expect(created.status).toBe(0);
    expect(created.curlLog).toContain('-X\nPOST');
    expect(created.curlLog).toContain(`/git/ref/tags/julius-run-spent-${WLJ_HEX}`);
    const replay = invoke(WLJ);
    expect(replay.status).not.toBe(0);
    expect(replay.stderr).toContain('RUN_ID_ALREADY_SPENT');
    expect(replay.curlLog).not.toContain('-X\nPOST');
    const again = invoke(WLJ);
    expect(again.curlLog).toContain(`/git/ref/tags/julius-run-spent-${WLJ_HEX}`);
    expect(again.curlLog).not.toContain('-X\nPOST');
  });

  it('an existing tag and any other API result do not authorize a second spend', () => {
    const exists = runTag(
      { JULIUS_RUN_ID: `run:${HEX}`, CONFIRM_LIVE: 'RUN LIVE MISSION' },
      { code: '422', body: '{"message":"Reference already exists"}' },
    );
    expect(exists.status).not.toBe(0);
    expect(exists.stderr).toContain('RUN_ID_ALREADY_SPENT');
    const precreated = runTag(
      { JULIUS_RUN_ID: WLJ, CONFIRM_LIVE: 'RUN LIVE MISSION' },
      { getCode: '200', getBody: '{"object":{"sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}' },
    );
    expect(precreated.status).not.toBe(0);
    expect(precreated.stderr).toContain('RUN_ID_ALREADY_SPENT');
    expect(precreated.curlLog).not.toContain('-X\nPOST');
    const broken = runTag({ JULIUS_RUN_ID: WLJ, CONFIRM_LIVE: 'RUN LIVE MISSION' }, { code: '500', body: 'no' });
    expect(broken.status).not.toBe(0);
    expect(broken.stderr).toContain('SPENT_TAG_UNVERIFIED');
  });

  it('reserves the contract ceiling, and a missing contract writes nothing', () => {
    const mission5 = runTag({
      JULIUS_RUN_ID: `run:${HEX}`,
      CONFIRM_LIVE: 'RUN LIVE MISSION',
      MISSION: 'julius-live-mission-5',
    });
    expect(mission5.status).toBe(0);
    expect(mission5.curlLog).toContain('namespace=julius-live-mission-5');
    expect(mission5.curlLog).toContain('reservedUsdMicros=30000000');
    const missing = runTag({
      JULIUS_RUN_ID: `run:${HEX}`,
      CONFIRM_LIVE: 'RUN LIVE MISSION',
      MISSION: 'julius-no-such-mission',
    });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('SPENT_TAG_UNVERIFIED');
    expect(missing.curlLog).toBe('');
  });
});

describe('the WITHOUT-arm log parser admits one id through the shared module', () => {
  const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
  const LEGACY = 'run:0123456789abcdef01234567';
  const probe = preflightIdentityFor({ tenantId: 'tenant', nonce: 'abcd1234', policyRevision: 'card:julius-live:1' });
  const accepted = (runId: string): string => `Run ${runId} accepted in state READY; driving the Julius run loop.\n`;

  function parseLog(log: string): { readonly status: number; readonly stdout: string; readonly stderr: string } {
    const block = step(job('first-live-mission'), "'Learning pair arm WITHOUT: dump this run''s store, restorable, for its WITH arm'");
    const full = script(block);
    const from = full.indexOf('accepted_run=$(');
    const at = full.indexOf('JULIUS_PG_CONTAINER=');
    expect(from, 'the parser names the accepted run').toBeGreaterThan(0);
    expect(at, 'the parser stops before the store dump').toBeGreaterThan(from);
    const logPath = join(ROOT, 'live-mission.log');
    writeFileSync(logPath, log);
    try {
      const stdout = execFileSync('bash', [...GITHUB_BASH, `set -euo pipefail\n${full.slice(from, at)}\nprintf '%s\\n' "$run_id"\n`], {
        cwd: ROOT, encoding: 'utf8',
      });
      return { status: 0, stdout, stderr: '' };
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      return { status: failed.status ?? 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
    } finally {
      rmSync(logPath, { force: true });
    }
  }

  it('the executor probe id is not an admission id', () => {
    expect(probe.runId).toBe('preflight:julius-abcd1234');
    expect(probe.runId.startsWith('run:')).toBe(false);
    expect(parseJuliusAdmissionRunId(probe.runId)).toEqual({ ok: false, reason: 'admission_run_id_malformed' });
  });

  it('calls the shared parser and no longer captures only a legacy run id', () => {
    const block = script(step(job('first-live-mission'), "'Learning pair arm WITHOUT: dump this run''s store, restorable, for its WITH arm'"));
    expect(block).toContain('node scripts/julius-admission-run-id.mjs derive');
    expect(block).not.toContain('run:[0-9a-f]\\{24\\}');
    expect(block.indexOf('node scripts/julius-admission-run-id.mjs derive')).toBeLessThan(block.indexOf('JULIUS_PG_CONTAINER='));
  });

  it('accepts one canonical wlj_ id', () => {
    const parsed = parseLog(accepted(WLJ));
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(parsed.stdout).toBe(`${WLJ}\n`);
  });

  it('still accepts one legacy run: id', () => {
    const parsed = parseLog(accepted(LEGACY));
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(parsed.stdout).toBe(`${LEGACY}\n`);
  });

  it('fails closed when the log names both forms, two ids, none, or a token the parser refuses', () => {
    for (const log of [
      accepted(WLJ) + accepted(LEGACY),
      accepted(WLJ) + accepted('wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
      '',
      'Run not-an-id accepted in state READY; driving the Julius run loop.\n',
      accepted('wlj_01234567-89AB-4CDE-8FAB-0123456789AB'),
      accepted(`run:${'A'.repeat(24)}`),
      accepted(probe.runId),
      'RESULT: COMPLETED\n',
    ]) {
      const parsed = parseLog(log);
      expect(parsed.status, log).not.toBe(0);
      expect(parsed.stderr, log).toContain('learning_store_run_unnamed');
    }
  });

  it('ignores a preflight probe line beside one admitted id', () => {
    const parsed = parseLog(
      `  preflight identity seeded in foreign-key order: project=prj-julius-preflight-abcd1234 run=${probe.runId} task=task:julius-preflight-abcd1234\n${accepted(WLJ)}`,
    );
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(parsed.stdout).toBe(`${WLJ}\n`);
  });
});

describe('the roles preflight runs the entrypoint as the admitted run (P0, run 40230911550)', () => {
  const ROLES = "'Preflight: all three roles resolve to the expected models, nothing dispatched'";
  const LIVE = "'LIVE: run the first real Julius mission'";

  it('passes the same run id to the roles preflight as to the live step, or the entrypoint refuses admission_run_id_required', () => {
    const paid = job('first-live-mission');
    for (const name of [ROLES, LIVE]) {
      const block = step(paid, name);
      expect(block, name).toContain('JULIUS_RUN_ID: ${{ needs.spend-tag.outputs.run_id }}');
      expect(block, name).toContain('JULIUS_SERVER_RUN_ID: ${{ needs.spend-tag.outputs.run_id }}');
    }
  });

  it('the entrypoint admission check refuses without the ids and admits with the two equal values the step passes', async () => {
    const { admitLiveJuliusRunId } = await import('../relay-bridge/julius-live-mission');
    expect(admitLiveJuliusRunId({})).toEqual({ ok: false, reason: 'admission_run_id_required' });
    const id = 'wlj_21d2b8fe-a9d5-47af-94b3-62c23f24ffdf';
    expect(admitLiveJuliusRunId({ JULIUS_RUN_ID: id, JULIUS_SERVER_RUN_ID: id })).toEqual({ ok: true, runId: id });
  });
});

describe('the live-progress publisher is best-effort, paid-only, and the job writes only statuses', () => {
  const paid = job('first-live-mission');
  const START = "'Live progress: start the phase publisher (best-effort)'";
  const STOP = "'Live progress: stop the phase publisher'";
  const LIVE = "'LIVE: run the first real Julius mission'";

  it('declares the full read set plus statuses: write, and never checks: write', () => {
    const block = /\n    permissions:\n((?: {6}\S[^\n]*\n)+)/u.exec(paid)?.[1] ?? '';
    const scopes = Object.fromEntries(block.trim().split('\n').map((line) => line.trim().split(/:\s*/u)));
    expect(scopes).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read', issues: 'read', statuses: 'write' });
    // As a YAML key, not prose: the comment above the block names `checks: write` to say it is never granted.
    expect(workflow).not.toMatch(/^\s+checks:\s*write\s*$/mu);
  });

  it('starts before LIVE and stops after it, both paid-only and continue-on-error; the status token goes to the publisher alone', () => {
    const start = step(paid, START);
    const stop = step(paid, STOP);
    expect(paid.indexOf(`- name: ${START}`)).toBeLessThan(paid.indexOf(`- name: ${LIVE}`));
    expect(paid.indexOf(`- name: ${LIVE}`)).toBeLessThan(paid.indexOf(`- name: ${STOP}`));
    expect(start).toContain("if: inputs.confirm_live == 'RUN LIVE MISSION'");
    expect(stop).toContain("if: always() && inputs.confirm_live == 'RUN LIVE MISSION'");
    for (const block of [start, stop]) expect(block).toContain('continue-on-error: true');
    expect(start).toContain('GH_TOKEN: ${{ github.token }}');
    expect(start).not.toMatch(/secrets\./u);
    expect(start).toContain('nohup node .github/julius-live-progress.mjs');
    expect(stop).not.toContain('GH_TOKEN');
    expect(step(paid, LIVE)).not.toContain('GH_TOKEN');
    // The LIVE step's one GitHub token is the job token, for the spent-tag ledger read (count only real spend).
    expect(step(paid, LIVE).split('GITHUB_TOKEN: ${{ github.token }}')).toHaveLength(2);
    expect(step(paid, LIVE)).not.toContain('secrets.GITHUB_TOKEN');
  });
});

describe('the provider-readiness evidence allowlist admits closed lines only', () => {
  /** The exact pipeline the evidence step runs, cut from the workflow text and executed over a fixture log. */
  const start = workflow.indexOf("grep -E '^(provider_readiness provider=");
  const end = workflow.indexOf('> julius-live-evidence/provider-readiness.txt 2>/dev/null || true', start);
  const pipeline = workflow.slice(start, end + '> julius-live-evidence/provider-readiness.txt 2>/dev/null || true'.length)
    .split('\n').map((line) => line.trim()).join('\n');
  const admitted = (lines: readonly string[]): string[] => {
    const dir = mkdtempSync(join(tmpdir(), 'julius-readiness-evidence-'));
    try {
      writeFileSync(join(dir, 'provider-readiness.log'), `${lines.join('\n')}\n`);
      execFileSync('bash', ['-c', `mkdir -p julius-live-evidence\n${pipeline}`], { cwd: dir, encoding: 'utf8' });
      return readFileSync(join(dir, 'julius-live-evidence/provider-readiness.txt'), 'utf8').split('\n').filter(Boolean);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  /* Fixture ids only. The credential-shaped token is assembled so no key literal is committed. */
  const ORG = 'aff8a85a-82c3-4ca7-afa7-8d3f63856dc4';
  const CODER = 'be82739b-746c-4288-a91b-6a332816e790';
  const token = ['sk', 'ant', 'api03', 'FAKETESTNOTREALFAKETESTNOTREAL'].join('-');

  it('is one anchored pipeline over the readiness log', () => {
    expect(start).toBeGreaterThan(-1);
    expect(pipeline).toMatch(/^grep -E '\^\(/u);
    expect(pipeline).toContain(")$' provider-readiness.log");
    expect(pipeline).toContain("grep -viE '(sk-|xai-|ghp_|gho_|bearer|authorization|api[_-]?key|private[-_ ]?key)'");
  });

  it('keeps every closed line the gate prints', () => {
    const good = [
      'provider_readiness provider=anthropic role=architect model=claude-opus-5-5 http=200 result=AUTHENTICATED_MODEL_AVAILABLE',
      'provider_readiness provider=xai model=grok-build-0.1 http=200 result=AUTHENTICATED_MODEL_AVAILABLE',
      `org_attribution provider=anthropic role=architect model=claude-opus-5-5 http=200 result=VERIFIED organization_id=${ORG}`,
      `org_attribution provider=anthropic role=coder model=claude-opus-5-5 http=200 result=ORG_ATTRIBUTION_UNVERIFIED reason=mismatch organization_id=org_other expected_organization_id=${CODER}`,
      `org_attribution_distinct result=DISTINCT architect_organization_id=${ORG} coder_organization_id=${CODER}`,
      `org_attribution_distinct result=REFUSED reason=architect_and_coder_share_an_organization organization_id=${CODER}`,
      'provider_balance=UNKNOWN (no provider exposes a spend-free balance query; exhaustion surfaces as PROVIDER_BLOCKED when a provider refuses)',
    ];
    expect(admitted(good)).toEqual(good);
  });

  it('refuses a credential-shaped token in an organization-id slot or appended, and any role but architect|coder', () => {
    const bad = [
      `org_attribution provider=anthropic role=architect model=claude-opus-5-5 http=200 result=VERIFIED organization_id=${token}`,
      `org_attribution provider=anthropic role=coder model=claude-opus-5-5 http=200 result=VERIFIED organization_id=${CODER} ${token}`,
      `org_attribution_distinct result=DISTINCT architect_organization_id=${token} coder_organization_id=${CODER}`,
      `org_attribution_distinct result=REFUSED reason=architect_and_coder_share_an_organization organization_id=${token}`,
      `org_attribution provider=anthropic role=reviewer model=claude-opus-5-5 http=200 result=VERIFIED organization_id=${ORG}`,
      `provider_readiness provider=anthropic role=${token} model=claude-opus-5-5 http=200 result=AUTHENTICATED_MODEL_AVAILABLE`,
      `org_attribution provider=anthropic role=architect model=claude-opus-5-5 http=200 result=VERIFIED organization_id=_${ORG}`,
    ];
    expect(admitted(bad)).toEqual([]);
  });
});
