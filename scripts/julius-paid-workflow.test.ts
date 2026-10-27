import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { LEGACY_RUN_ID_PATTERN, parseJuliusAdmissionRunId, WLJ_RUN_ID_PATTERN } from './julius-admission-run-id.mjs';
import { preflightIdentityFor } from './julius-live-preflight-identity';
import { parseJuliusAttemptRecordTag } from '../src/relay/mission/julius/julius-spend-ceiling';
import { juliusRunResultBodyIsExact, parseJuliusRunResultRecord } from '../relay-bridge/julius-mission-evidence-reader';

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

  it('declares the full read set plus statuses: write and (X′ §2, the attempted record tag) contents: write, and never checks: write', () => {
    const block = /\n    permissions:\n((?: {6}\S[^\n]*\n)+)/u.exec(paid)?.[1] ?? '';
    const scopes = Object.fromEntries(block.trim().split('\n').map((line) => line.trim().split(/:\s*/u)));
    expect(scopes).toEqual({ contents: 'write', actions: 'read', 'pull-requests': 'read', issues: 'read', statuses: 'write' });
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

/* ------------------------------------------------------------------------------------------------------------------
 * X′ (X_PRIME_ARTIFACT_INDEPENDENT_PROPOSAL.md): J1 without blocking on GitHub artifacts. Every founder requirement
 * the workflow carries is pinned here; the readers' halves are in julius-prior-spend.test.ts and
 * julius-mission-evidence-reader.test.ts.
 * ---------------------------------------------------------------------------------------------------------------- */

/** A fake `curl` for a job-token tag write: every POST answers 201 with a fresh sha, the ref create answers `refCode`. */
function runWithFakeCurl(
  text: string,
  env: Record<string, string>,
  curl: { refCode?: string; refBody?: string; exitCode?: string; failPath?: string } = {},
): { status: number; stderr: string; stdout: string; curlLog: string } {
  const bin = mkdtempSync(join(tmpdir(), 'julius-x-prime-curl-'));
  const curlLog = join(bin, 'curl.log');
  writeFileSync(join(bin, 'curl'), [
    '#!/usr/bin/env bash',
    'out=""; method="GET"; data=""; url=""; prev=""',
    'for arg in "$@"; do',
    '  if [ "$prev" = "-o" ]; then out=$arg; fi',
    '  if [ "$prev" = "-X" ]; then method=$arg; fi',
    '  if [ "$prev" = "--data-binary" ]; then data=$arg; fi',
    '  case "$arg" in https://*) url=$arg ;; esac',
    '  prev=$arg',
    'done',
    'printf \'%s %s DATA %s\\n\' "$method" "$url" "$data" >> "$CURL_LOG"',
    'if [ "${CURL_EXIT:-0}" != 0 ]; then exit "$CURL_EXIT"; fi',
    'respond() { if [ -n "$out" ]; then printf \'%s\' "$2" > "$out"; fi; printf \'%s\' "$1"; exit 0; }',
    'if [ -n "${CURL_FAIL_PATH:-}" ]; then case "$url" in *"$CURL_FAIL_PATH") respond 500 \'{"message":"boom"}\';; esac; fi',
    'case "$url" in',
    '  */git/refs)',
    '    if [ "$CURL_REF_CODE" = 201 ]; then',
    '      sha=$(printf \'%s\' "$data" | grep -oE \'"sha":"[0-9a-f]{40}"\' | grep -oE \'[0-9a-f]{40}\' | head -1)',
    '      respond 201 "{\\"ref\\":\\"x\\",\\"object\\":{\\"sha\\":\\"$sha\\",\\"type\\":\\"tag\\"}}"',
    '    fi',
    '    respond "$CURL_REF_CODE" "$CURL_REF_BODY" ;;',
    '  */statuses/*) respond 201 \'{"id":1,"state":"success"}\' ;;',
    '  *)',
    '    count=0; if [ -f "$CURL_LOG.count" ]; then count=$(cat "$CURL_LOG.count"); fi',
    '    count=$((count + 1)); printf \'%s\' "$count" > "$CURL_LOG.count"',
    '    respond 201 "{\\"sha\\":\\"$(printf \'%040x\' "$count")\\"}" ;;',
    'esac',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'curl'), 0o755);
  const read = (): string => { try { return readFileSync(curlLog, 'utf8'); } catch { return ''; } };
  try {
    const stdout = execFileSync('bash', [...GITHUB_BASH, text], {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
        CURL_LOG: curlLog,
        CURL_REF_CODE: curl.refCode ?? '201',
        CURL_REF_BODY: curl.refBody ?? '',
        CURL_EXIT: curl.exitCode ?? '0',
        CURL_FAIL_PATH: curl.failPath ?? '',
        GITHUB_RUN_ID: '40400000001',
        GITHUB_RUN_ATTEMPT: '1',
        GITHUB_SHA: 'a'.repeat(40),
        GITHUB_REPOSITORY: 'ohdieyuh-glitch/sunday-relay',
        GITHUB_SERVER_URL: 'https://github.com',
        GH_TOKEN: 'github-token-placeholder',
        ...env,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '', stdout, curlLog: read() };
  } catch (error) {
    const failed = error as { status?: number; stderr?: string; stdout?: string };
    return { status: failed.status ?? 1, stderr: failed.stderr ?? '', stdout: failed.stdout ?? '', curlLog: read() };
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

const X_WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const X_WLJ_HEX = '0123456789ab4cde8fab0123456789ab';
const ATTEMPT_TAG = "'Record the attempt durably (git tag)'";
const ATTEMPT_MARKER = "'Record that a paid mission was attempted (before any provider can be reached)'";
const PRE_MARKER = "'Gate: attempted markers and the combined cap, before the attempted marker'";
const LIVE_STEP = "'LIVE: run the first real Julius mission'";

/** The JSON-escaped body one POST carried, decoded back to its text. */
const postedBody = (log: string, path: string): string => {
  const line = log.split('\n').find((entry) => entry.startsWith(`POST https://api.github.com/repos/ohdieyuh-glitch/sunday-relay${path} `)) ?? '';
  const data = line.slice(line.indexOf(' DATA ') + ' DATA '.length);
  const parsed = JSON.parse(data) as { content?: string; message?: string };
  return parsed.content ?? parsed.message ?? '';
};

/** A step's `if:` expression, or null. */
const ifOf = (block: string): string | null => /\n {8}if: ([^\n]+)\n/u.exec(block)?.[1] ?? null;

describe('X′ §2: the attempted marker is a job-token tag, and LIVE waits for it', { timeout: 60_000 }, () => {
  const paid = job('first-live-mission');
  const tagBlock = step(paid, ATTEMPT_TAG);
  const tagScript = script(tagBlock);
  const env = { JULIUS_RUN_ID: X_WLJ, MARKER_NAMESPACE: 'julius-inworld-data-1', CONTRACT: '.github/julius-missions/julius-inworld-data-1/contract.json' };

  it('the tag step follows the pre-marker gate and the marker, precedes the best-effort upload and LIVE, under the marker\'s own if', () => {
    const at = (name: string): number => paid.indexOf(`- name: ${name}`);
    expect(at(PRE_MARKER)).toBeGreaterThan(-1);
    expect(at(PRE_MARKER)).toBeLessThan(at(ATTEMPT_MARKER));
    expect(at(ATTEMPT_MARKER)).toBeLessThan(at(ATTEMPT_TAG));
    expect(at(ATTEMPT_TAG)).toBeLessThan(at(LIVE_STEP));
    const upload = paid.indexOf('- uses: actions/upload-artifact', at(ATTEMPT_MARKER));
    expect(at(ATTEMPT_TAG)).toBeLessThan(upload);
    expect(upload).toBeLessThan(at(LIVE_STEP));
    expect(tagBlock).toContain('        id: attempt_tag\n');
    expect(ifOf(tagBlock)).toBe(ifOf(step(paid, ATTEMPT_MARKER)));
    expect(tagBlock).not.toContain('continue-on-error');
    expect(tagBlock).not.toMatch(/secrets\./u);
  });

  it('LIVE runs only when the tag step succeeded (the upload no longer gates it)', () => {
    expect(ifOf(step(paid, LIVE_STEP))).toBe(
      "success() && inputs.confirm_live == 'RUN LIVE MISSION' && steps.coder_auth.outcome == 'success' && steps.provider_readiness.outcome == 'success' && steps.attempt_tag.outcome == 'success'",
    );
  });

  it('the attempted-marker upload is best-effort: continue-on-error, still loud on an empty directory', () => {
    const upload = paid.slice(paid.indexOf('- uses: actions/upload-artifact', paid.indexOf(`- name: ${ATTEMPT_MARKER}`)));
    const block = upload.slice(0, upload.indexOf('\n      - ', 1));
    expect(block).toContain('name: ${{ steps.inputs_gate.outputs.marker_namespace }}-attempted\n');
    expect(block).toContain('        continue-on-error: true\n');
    expect(block).toContain('if-no-files-found: error');
  });

  it('writes an annotated tag under julius-run-record-, never under julius-run-spent-, with the closed v1 body', () => {
    const created = runWithFakeCurl(tagScript, env);
    expect(created.status, created.stderr).toBe(0);
    expect(created.curlLog).toContain(`"ref":"refs/tags/julius-run-record-${X_WLJ_HEX}-attempted"`);
    expect(created.curlLog).not.toContain('julius-run-spent-');
    const body = postedBody(created.curlLog, '/git/tags');
    const lines = body.split('\n');
    expect(lines.slice(0, 6)).toEqual([
      'julius-run-attempted.v1', `run=${X_WLJ}`, 'namespace=julius-inworld-data-1',
      'workflow_run_id=40400000001', 'workflow_run_attempt=1', `head_sha=${'a'.repeat(40)}`,
    ]);
    expect(lines[6]).toMatch(/^attempted_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
    expect(lines[7]).toMatch(/^contract_sha256=[0-9a-f]{64}$/u);
    expect(postedBody(created.curlLog, '/git/blobs')).toBe(body);
    // The reader's own pure parser reads exactly what the workflow writes.
    expect(parseJuliusAttemptRecordTag(`refs/tags/julius-run-record-${X_WLJ_HEX}-attempted`, body, 'julius-inworld-data-1')).toEqual({
      kind: 'bound', binding: { workflowRunId: '40400000001', workflowRunAttempt: '1', headSha: 'a'.repeat(40) },
    });
    expect(created.stdout).not.toContain('github-token-placeholder');
  });

  it('a ref that already exists is RUN_ID_ALREADY_ATTEMPTED; any other failure is ATTEMPT_TAG_UNVERIFIED (LIVE never runs)', () => {
    const exists = runWithFakeCurl(tagScript, env, { refCode: '422', refBody: '{"message":"Reference already exists"}' });
    expect(exists.status).not.toBe(0);
    expect(exists.stderr).toContain('RUN_ID_ALREADY_ATTEMPTED');
    for (const failure of [{ refCode: '500' }, { exitCode: '7' }, { failPath: '/git/tags' }, { refCode: '422', refBody: '{"message":"other"}' }]) {
      const refused = runWithFakeCurl(tagScript, env, failure);
      expect(refused.status, JSON.stringify(failure)).not.toBe(0);
      expect(refused.stderr, JSON.stringify(failure)).toContain('ATTEMPT_TAG_UNVERIFIED');
    }
    for (const bad of [{ JULIUS_RUN_ID: 'not-an-id' }, { MARKER_NAMESPACE: 'Bad Namespace' }, { MARKER_NAMESPACE: 'julius-inworld-data-1\nnamespace=other-ns' }, { GITHUB_SHA: 'z'.repeat(40) }] as readonly Record<string, string>[]) {
      const refused = runWithFakeCurl(tagScript, { ...env, ...bad });
      expect(refused.status, JSON.stringify(bad)).not.toBe(0);
      expect(refused.curlLog, JSON.stringify(bad)).toBe('');
    }
  });
});

/**
 * Run one step script in `cwd`, with a fake `stat` (the 0700 check is the script's; NTFS cannot answer it).
 * `HOME` stands in for `/var/lib` (D-c): the host kit's base directories `<HOME>/julius-handoff` and
 * `<HOME>/julius-evidence` are created as the kit would, unless `NO_HOST_BASE=1` models a host without them.
 */
function runStep(source: string, cwd: string, env: Record<string, string>): { status: number; stderr: string; stdout: string } {
  let text = source;
  if (env.HOME !== undefined) {
    expect(source.includes('$HOME'), 'the host paths are /var/lib, never the runner user\'s home').toBe(false);
    // Forward slashes: the script assigns the path unquoted, where a Windows backslash would be an escape.
    text = source.replaceAll('/var/lib/julius-', `${env.HOME.replaceAll('\\', '/')}/julius-`);
    if (env.NO_HOST_BASE !== '1') for (const base of ['julius-handoff', 'julius-evidence']) mkdirSync(join(env.HOME, base), { recursive: true, mode: 0o700 });
  }
  const bin = mkdtempSync(join(tmpdir(), 'julius-x-prime-bin-'));
  // FAKE_STAT_MODE/UID answer for every path; FAKE_STAT_RUN_MODE/UID override them for a run directory (`…-<attempt>`).
  writeFileSync(join(bin, 'stat'), [
    '#!/usr/bin/env bash',
    'path="${@: -1}"; mode=${FAKE_STAT_MODE:-700}; uid=${FAKE_STAT_UID:-$(id -u)}',
    'case "$path" in *-[0-9]|*-[0-9][0-9]) mode=${FAKE_STAT_RUN_MODE:-$mode}; uid=${FAKE_STAT_RUN_UID:-$uid} ;; esac',
    'printf \'%s %s\\n\' "$mode" "$uid"',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'stat'), 0o755);
  // FAKE_CP_PLANT: after the real copy into `j1-handoff/`, plant a FIFO in it (X-5: the copy must be re-checked).
  writeFileSync(join(bin, 'cp'), [
    '#!/usr/bin/env bash',
    '/usr/bin/cp "$@" || exit $?',
    'if [ -n "${FAKE_CP_PLANT:-}" ] && [ "${@: -1}" = j1-handoff/ ]; then mkfifo j1-handoff/planted.fifo; fi',
    '',
  ].join('\n'));
  chmodSync(join(bin, 'cp'), 0o755);
  // GNU's own text-mode line (`<sha>  <name>`) on every platform: Git Bash on Windows defaults to binary (`<sha> *<name>`).
  writeFileSync(join(bin, 'sha256sum'), '#!/usr/bin/env bash\nexec /usr/bin/sha256sum --text "$@"\n');
  chmodSync(join(bin, 'sha256sum'), 0o755);
  try {
    const stdout = execFileSync('bash', [...GITHUB_BASH, text], {
      cwd,
      env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`, GITHUB_RUN_ID: '40400000001', GITHUB_RUN_ATTEMPT: '1', ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stderr: '', stdout };
  } catch (error) {
    const failed = error as { status?: number; stderr?: string; stdout?: string };
    return { status: failed.status ?? 1, stderr: failed.stderr ?? '', stdout: failed.stdout ?? '' };
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

/** GITHUB_OUTPUT as GitHub reads it: `k=v` lines and `k<<DELIM` blocks. */
function readOutputs(file: string): Record<string, string> {
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: Record<string, string> = {};
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const heredoc = /^([a-z_]+)<<(.+)$/u.exec(line);
    if (heredoc !== null) {
      const body: string[] = [];
      for (i += 1; i < lines.length && lines[i] !== heredoc[2]; i += 1) body.push(lines[i] ?? '');
      out[heredoc[1] ?? ''] = body.join('\n');
      continue;
    }
    const at = line.indexOf('=');
    if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
  }
  return out;
}

const HANDOFF_LIVE = "'J1: hand the final message and the scanned evidence to the grade job (runner host, 0700)'";
const HANDOFF_GRADE = "'J1: receive the handoff from the runner host and verify every hash'";
const GRADE_STEP_NAME = "'J1: stage the pinned checker from git objects and grade'";
const STEM = 'build_task.ctx_1';

describe('X′ §3: grading without an artifact handoff', { timeout: 60_000 }, () => {
  const paid = job('first-live-mission');
  const grade = job('grade-inworld');
  const remove = job('delete-final-message');

  /** A live job's workspace after the scan, a home, and the handoff it leaves. */
  const handOff = (): { home: string; work: string; outputs: Record<string, string>; dir: string; cleanup: () => void } => {
    const home = mkdtempSync(join(tmpdir(), 'julius-x-prime-home-'));
    const work = mkdtempSync(join(tmpdir(), 'julius-x-prime-live-'));
    const finalDir = join(work, 'final');
    execFileSync('bash', ['-c', `mkdir -p "${finalDir}" "${work}/julius-live-evidence/final-message"`]);
    writeFileSync(join(finalDir, `${STEM}.raw.txt`), 'the coder said this');
    writeFileSync(join(finalDir, `${STEM}.manifest.json`), '{"schema":"julius-final-message.v2"}\n');
    writeFileSync(join(finalDir, `${STEM}.redacted.json`), '{"never":"handed"}\n');
    writeFileSync(join(work, 'julius-live-evidence', 'tasks.tsv'), 'run_id\n(0 rows)\n');
    writeFileSync(join(work, 'julius-live-evidence', 'final-message', `${STEM}.redacted.json`), '{"published":true}\n');
    const output = join(work, 'github-output.txt');
    writeFileSync(output, '');
    const run = runStep(script(step(paid, HANDOFF_LIVE)), work, { HOME: home, FINAL_MESSAGE_DIR: finalDir, GITHUB_OUTPUT: output });
    expect(run.status, run.stderr).toBe(0);
    return {
      home, work, outputs: readOutputs(output), dir: join(home, 'julius-handoff', '40400000001-1'),
      cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); },
    };
  };

  const receive = (home: string, outputs: Record<string, string>, env: Record<string, string> = {}) => {
    const work = mkdtempSync(join(tmpdir(), 'julius-x-prime-grade-'));
    const runnerTemp = mkdtempSync(join(tmpdir(), 'julius-x-prime-rt-'));
    const result = runStep(script(step(grade, HANDOFF_GRADE)), work, {
      HOME: home, RUNNER_TEMP: runnerTemp, HANDOFF_SUMS: outputs.sums ?? '', HANDOFF_SUMS_SHA256: outputs.sums_sha256 ?? '', ...env,
    });
    const listing = (sub: string): string[] => { try { return readdirSync(join(work, sub)).sort(); } catch { return []; } };
    const seen = { finalMessage: listing('j1-final-message'), evidence: listing('j1-evidence'), manifests: (() => { try { return readdirSync(join(runnerTemp, 'j1-manifests')).sort(); } catch { return []; } })() };
    rmSync(work, { recursive: true, force: true });
    rmSync(runnerTemp, { recursive: true, force: true });
    return { ...result, seen };
  };

  it('the live job copies the raw message, its manifest and the SCANNED evidence to a 0700 run-scoped host directory, hashes as outputs', () => {
    const at = (name: string): number => paid.indexOf(`- name: ${name}`);
    expect(at("'Refuse to publish evidence that contains credential material'")).toBeLessThan(at(HANDOFF_LIVE));
    expect(at(HANDOFF_LIVE)).toBeLessThan(paid.indexOf('id: evidence_upload'));
    expect(paid).toContain('handoff_sha256sums: ${{ steps.handoff.outputs.sums }}');
    expect(paid).toContain('handoff_sums_sha256: ${{ steps.handoff.outputs.sums_sha256 }}');
    expect(paid, 'the old one-day artifact hand-off is gone').not.toMatch(/name: j1-final-message\n/u);
    const handoffScript = script(step(paid, HANDOFF_LIVE));
    expect(handoffScript, 'no privilege: the job creates only its own run directory').not.toMatch(/\bsudo\b|mkdir -p|chmod/u);
    expect(handoffScript).toContain('root=/var/lib/julius-handoff\n');
    expect(handoffScript).toContain('base_private "$root" || refuse base_not_private');
    const { dir, outputs, cleanup } = handOff();
    try {
      expect(outputs.sums?.split('\n')).toEqual([
        expect.stringMatching(/^[0-9a-f]{64} {2}\.\/evidence\/final-message\/build_task\.ctx_1\.redacted\.json$/u),
        expect.stringMatching(/^[0-9a-f]{64} {2}\.\/evidence\/tasks\.tsv$/u),
        expect.stringMatching(/^[0-9a-f]{64} {2}\.\/final-message\/build_task\.ctx_1\.manifest\.json$/u),
        expect.stringMatching(/^[0-9a-f]{64} {2}\.\/final-message\/build_task\.ctx_1\.raw\.txt$/u),
      ]);
      expect(outputs.sums_sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(outputs.sums, 'hashes and names only, never content').not.toContain('the coder said this');
      expect(readdirSync(join(dir, 'final-message')).sort()).toEqual([`${STEM}.manifest.json`, `${STEM}.raw.txt`]);
      if (process.platform !== 'win32') {
        expect(statSync(dir).mode & 0o777).toBe(0o700);
        expect(statSync(join(dir, '..')).mode & 0o777).toBe(0o700);
      }
    } finally { cleanup(); }
  });

  it('grade-inworld reads the host directory, re-hashes, and grades only what the live job hashed', () => {
    expect(grade).not.toContain('actions/download-artifact');
    expect(grade.indexOf(`- name: ${HANDOFF_GRADE}`)).toBeLessThan(grade.indexOf(`- name: ${GRADE_STEP_NAME}`));
    expect(step(grade, HANDOFF_GRADE)).not.toContain('continue-on-error');
    const { home, outputs, cleanup } = handOff();
    try {
      const ok = receive(home, outputs);
      expect(ok.status, ok.stderr).toBe(0);
      expect(ok.seen.finalMessage).toEqual([`${STEM}.manifest.json`, `${STEM}.raw.txt`]);
      expect(ok.seen.evidence).toEqual(['final-message', 'tasks.tsv']);
      expect(ok.seen.manifests).toEqual([`${STEM}.manifest.json`]);
    } finally { cleanup(); }
  });

  it('a HASH MISMATCH REFUSES GRADING: a changed, added or removed file, a forged list, a malformed line, a shared directory', () => {
    const cases: readonly [string, (dir: string, outputs: Record<string, string>) => Record<string, string>, string][] = [
      ['changed', (dir, o) => { writeFileSync(join(dir, 'final-message', `${STEM}.raw.txt`), 'something else'); return o; }, 'hash_mismatch'],
      ['added', (dir, o) => { writeFileSync(join(dir, 'evidence', 'planted.tsv'), 'x'); return o; }, 'hash_mismatch'],
      ['removed', (dir, o) => { rmSync(join(dir, 'evidence', 'tasks.tsv')); return o; }, 'hash_mismatch'],
      ['forged list', (_dir, o) => ({ ...o, sums: (o.sums ?? '').replace(/^[0-9a-f]{64}/u, '0'.repeat(64)) }), 'sums_digest_mismatch'],
      ['no digest', (_dir, o) => ({ ...o, sums_sha256: '' }), 'sums_digest_missing'],
    ];
    for (const [label, mutate, reason] of cases) {
      const { home, dir, outputs, cleanup } = handOff();
      try {
        const refused = receive(home, mutate(dir, outputs));
        expect(refused.status, label).not.toBe(0);
        expect(refused.stderr, label).toContain(`handoff_refused: ${reason}`);
        expect(refused.seen.finalMessage, `${label}: nothing is left for the grader`).toEqual([]);
      } finally { cleanup(); }
    }
    const { home, outputs, cleanup } = handOff();
    try {
      const malformed = `${outputs.sums ?? ''}\nnot a sums line`;
      const sha = execFileSync('bash', ['-c', 'printf \'%s\\n\' "$S" | sha256sum | cut -d" " -f1'], { env: { ...process.env, S: malformed }, encoding: 'utf8' }).trim();
      expect(receive(home, { sums: malformed, sums_sha256: sha }).stderr).toContain('handoff_refused: sums_malformed');
      expect(receive(home, outputs, { FAKE_STAT_MODE: '755' }).stderr).toContain('handoff_refused: base_not_private');
      expect(receive(home, outputs, { FAKE_STAT_UID: '4242424' }).stderr).toContain('handoff_refused: base_not_private');
      expect(receive(join(home, 'nowhere'), outputs).stderr).toContain('handoff_refused: handoff_missing');
      expect(receive(join(home, 'no-kit'), outputs, { NO_HOST_BASE: '1' }).stderr).toContain('handoff_refused: base_not_private');
    } finally { cleanup(); }
  });

  it('X-2 (W6, W11): the live handoff refuses a stale run directory and a base that is not 0700 and the job user\'s', () => {
    const { home, work, cleanup } = handOff();
    try {
      const again = (env: Record<string, string> = {}) => {
        const output = join(work, 'again.txt');
        writeFileSync(output, '');
        return runStep(script(step(paid, HANDOFF_LIVE)), work, { HOME: home, FINAL_MESSAGE_DIR: '', GITHUB_OUTPUT: output, ...env });
      };
      expect(again().stderr, 'W6: a stale directory for the run attempt is never reused').toContain('handoff_refused: handoff_exists');
      for (const env of [{ FAKE_STAT_MODE: '755' }, { FAKE_STAT_MODE: '750' }, { FAKE_STAT_UID: '4242424' }] as readonly Record<string, string>[]) {
        expect(again({ ...env, GITHUB_RUN_ATTEMPT: '2' }).stderr, `W11 ${JSON.stringify(env)}`).toContain('handoff_refused: base_not_private');
      }
      const fresh = mkdtempSync(join(tmpdir(), 'julius-x-prime-home-'));
      try {
        expect(runStep(script(step(paid, HANDOFF_LIVE)), work, { HOME: fresh, NO_HOST_BASE: '1', FINAL_MESSAGE_DIR: '', GITHUB_OUTPUT: join(work, 'x.txt') }).stderr)
          .toContain('handoff_refused: base_not_private');
      } finally { rmSync(fresh, { recursive: true, force: true }); }
    } finally { cleanup(); }
  });

  it('X-2 (W14): grading refuses a run directory that is not 0700 and the job user\'s, under a private base', () => {
    const { home, outputs, cleanup } = handOff();
    try {
      expect(receive(home, outputs, { FAKE_STAT_RUN_MODE: '755' }).stderr).toContain('handoff_refused: handoff_not_private');
      expect(receive(home, outputs, { FAKE_STAT_RUN_UID: '4242424' }).stderr).toContain('handoff_refused: handoff_not_private');
      expect(receive(home, outputs).status, 'control: a private run directory is received').toBe(0);
    } finally { cleanup(); }
  });

  it('X-5: the COPY is re-checked after cp -R: anything but regular files and directories in it refuses grading', () => {
    const { home, outputs, cleanup } = handOff();
    try {
      const planted = receive(home, outputs, { FAKE_CP_PLANT: '1' });
      expect(planted.status).not.toBe(0);
      expect(planted.stderr).toContain('handoff_refused: handoff_copy_not_regular');
      expect(planted.seen.finalMessage).toEqual([]);
    } finally { cleanup(); }
  });

  it('GRADING HOLDS NO SECRET AND NO ENVIRONMENT, and reads contents only', () => {
    expect(grade).toMatch(/\n    permissions:\n      contents: read\n    steps:\n/u);
    expect(grade).not.toMatch(/secrets\.|environment:|vars\.|github\.token|GH_TOKEN|GITHUB_TOKEN/u);
    expect(grade).not.toMatch(/: write\n/u);
    expect(script(step(grade, GRADE_STEP_NAME))).toContain('env -i PATH="$PATH" HOME="$stage" node scripts/julius-inworld-grade.mjs');
  });

  it('delete-final-message removes the handoff final message, and its artifact deletion is this run\'s own, best-effort', () => {
    expect(remove).toContain("if: ${{ always() && inputs.mission == 'julius-inworld-data-1' && inputs.confirm_live == 'RUN LIVE MISSION' && needs.first-live-mission.result != 'skipped' }}");
    const { home, dir, cleanup } = handOff();
    try {
      const deleted = runStep(script(step(remove, "'J1: delete the graded final message'")), home, { HOME: home });
      expect(deleted.status, deleted.stderr).toBe(0);
      expect(() => readdirSync(join(dir, 'final-message'))).toThrow();
      expect(readdirSync(join(dir, 'evidence')).sort()).toEqual(['final-message', 'tasks.tsv']);
    } finally { cleanup(); }
    const best = step(remove, "'J1: delete this run''s j1-final-message artifact, if one exists (best-effort)'");
    expect(best).toContain('continue-on-error: true');
    expect(best).toContain('repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/artifacts?name=j1-final-message&per_page=100');
  });

  it('EVERY ARTIFACT UPLOAD AFTER LIVE IS BEST-EFFORT (continue-on-error), so none can fail the job that LIVE ran in', () => {
    const live = workflow.indexOf(`- name: ${LIVE_STEP}`);
    const after = workflow.slice(live).split('- uses: actions/upload-artifact').slice(1);
    expect(after.length).toBeGreaterThanOrEqual(4);
    for (const block of after) {
      const head = block.slice(0, block.indexOf('\n        with:'));
      expect(head, block.slice(0, 200)).toContain('\n        continue-on-error: true');
    }
  });

  it('NOTHING DELETES HISTORICAL ARTIFACTS OR TAGS: the only deletion is delete-final-message\'s own run-scoped one', () => {
    const deletions = workflow.split('\n').filter((line) => /-X DELETE|--method DELETE|"DELETE"|git push [^\n]*(--delete|:refs)|git tag -d|\/git\/refs\/[^\n]*DELETE/u.test(line));
    expect(deletions.map((line) => line.trim())).toEqual(['gh api -X DELETE "repos/$GITHUB_REPOSITORY/actions/artifacts/$id" && echo "j1_final_message_deleted artifact_id=$id"']);
    expect(remove).toContain(deletions[0]?.trim() ?? 'missing');
    expect(workflow, 'no artifact is listed repository-wide for deletion').not.toMatch(/actions\/artifacts\?[^\n]*\n[^\n]*DELETE/u);
    for (const file of readdirSync(join(ROOT, '.github/workflows'))) {
      if (file === 'julius-first-live-mission.yml') continue;
      expect(readFileSync(join(ROOT, '.github/workflows', file), 'utf8'), file).not.toMatch(/actions\/artifacts\/[^\n]*-X DELETE|-X DELETE[^\n]*actions\/artifacts|git\/refs\/tags[^\n]*DELETE/u);
    }
  });
});

const RECORD_STEP = "'J1: write the result tag and the julius-run-result status'";
const VERDICT_STEP = "'J1: read the verdict for the result record (closed fields)'";
const PASS_STEP_NAME = "'J1: the pinned checker''s verdict is PASS'";
const SUMMARY_STEP = "'Result record: summarize this run in closed fields'";

/** A job's `permissions:` block as a map, or null. */
const permissionsOf = (text: string): Record<string, string> | null => {
  const block = /\n {4}permissions:\n((?: {6}[a-z-]+: [a-z]+\n)+)/u.exec(text)?.[1];
  return block === undefined ? null : Object.fromEntries(block.trim().split('\n').map((line) => line.trim().split(/:\s*/u)));
};

describe('X′ §4: the result record is written by a minimal job of its own; grading never holds a write token', { timeout: 60_000 }, () => {
  const record = job('record-result');
  const grade = job('grade-inworld');
  const recordScript = script(step(record, RECORD_STEP));
  const outputs = {
    RUN: X_WLJ, NAMESPACE: 'julius-inworld-data-1', FINAL_STATE: 'COMPLETED', COMPLETED_AT: '2026-10-26T10:00:00Z', OUTCOME_UNKNOWN: 'none',
    COST_BASIS: 'COMPLETE', USD_MICROS: '1234567', VERDICT: 'PASS', CHECKER_SHA256: '1a98f1a4d739ebe2da254715d81f56cd5fa08d534a1fbf10ef6214e8b262207e',
    COMBINED_PIN_SHA256: 'c'.repeat(64), JUDGED_TRIMMED_SHA256: 'b'.repeat(64), PUBLISHED_TRIMMED_SHA256: 'b'.repeat(64), FINAL_MESSAGE_SHA256: 'b'.repeat(64),
    GRADER_SHA256: 'e'.repeat(64), NODE_SHA256: 'd'.repeat(64), NODE_VERSION: 'v22.23.2',
  };

  it('record-result: contents: write + statuses: write and nothing else, no checkout, no secret, one best-effort step', () => {
    expect(permissionsOf(record)).toEqual({ contents: 'write', statuses: 'write' });
    expect(record).toContain('    needs: [spend-tag, first-live-mission, grade-inworld]\n');
    expect(record).toContain("    if: ${{ always() && inputs.mission == 'julius-inworld-data-1' && inputs.confirm_live == 'RUN LIVE MISSION' && needs.first-live-mission.result != 'skipped' && needs.grade-inworld.result != 'skipped' }}\n");
    expect(record).not.toMatch(/actions\/checkout|secrets\.|environment:|vars\./u);
    expect(record.split('\n      - ').length - 1).toBe(1);
    expect(step(record, RECORD_STEP)).toContain('continue-on-error: true');
    expect(recordScript, 'no repository code runs with the write token').not.toMatch(/\bnode\b|\bnpm\b|\.\/\.github\/|scripts\//u);
  });

  it('THE GRADER NEVER HOLDS contents: write OR statuses: write (mutation: the grader with contents: write fails here)', () => {
    expect(permissionsOf(grade)).toEqual({ contents: 'read' });
    // The only jobs that may write contents: the spend tag, the paid job's attempted tag, and the record job.
    const writers = ['spend-tag', 'paid-slot', 'first-live-mission', 'grade-inworld', 'record-result', 'delete-final-message']
      .filter((name) => permissionsOf(job(name))?.contents === 'write');
    expect(writers).toEqual(['spend-tag', 'first-live-mission', 'record-result']);
    expect(permissionsOf(job('delete-final-message'))).toEqual({ actions: 'write' });
  });

  it('the result tag and the julius-run-result status are written only by the record job', () => {
    const writes = (text: string) => /julius-run-record-\$\{suffix\}-result|"context":"julius-run-result"/u.test(text);
    expect(writes(record)).toBe(true);
    for (const name of ['spend-tag', 'paid-slot', 'first-live-mission', 'grade-inworld', 'delete-final-message']) expect(writes(job(name)), name).toBe(false);
    for (const file of readdirSync(join(ROOT, '.github/workflows')).filter((name) => name !== 'julius-first-live-mission.yml')) {
      expect(readFileSync(join(ROOT, '.github/workflows', file), 'utf8'), file).not.toMatch(/julius-run-record-|julius-run-result/u);
    }
  });

  it('writes the v1 body under julius-run-record-<suffix>-result, and the status hash, state and target the reader binds on', () => {
    const run = runWithFakeCurl(recordScript, outputs);
    expect(run.status, run.stderr).toBe(0);
    expect(run.curlLog).toContain(`"ref":"refs/tags/julius-run-record-${X_WLJ_HEX}-result"`);
    expect(run.curlLog).not.toContain('julius-run-spent-');
    const body = postedBody(run.curlLog, '/git/tags');
    const parsed = parseJuliusRunResultRecord(body);
    expect(parsed).toMatchObject({
      run: X_WLJ, workflowRunId: '40400000001', workflowRunAttempt: '1', headSha: 'a'.repeat(40), finalState: 'COMPLETED', verdict: 'PASS', usdMicros: 1234567,
      graderSha256: 'e'.repeat(64), nodeSha256: 'd'.repeat(64), nodeVersion: 'v22.23.2',
    });
    // BYTE-EXACT (X-3): each line ended by exactly one LF, no CR, no trailing blank line. Checked on the bytes
    // themselves, not through the reader's own predicate.
    expect(body.endsWith('\nnode_version=v22.23.2\n')).toBe(true);
    expect(body).not.toMatch(/\r|\n\n/u);
    expect(body.split('\n')).toHaveLength(21);
    expect(juliusRunResultBodyIsExact(body)).toBe(true);
    const statusLine = run.curlLog.split('\n').find((line) => line.includes(`/statuses/${'a'.repeat(40)} `)) ?? '';
    const status = JSON.parse(statusLine.slice(statusLine.indexOf(' DATA ') + 6)) as Record<string, string>;
    expect(status).toEqual({
      state: 'success', context: 'julius-run-result',
      description: `v1 sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`,
      target_url: 'https://github.com/ohdieyuh-glitch/sunday-relay/actions/runs/40400000001',
    });
    expect(status.description?.length ?? 0).toBeLessThanOrEqual(140);
  });

  it('no verdict from the grade job is NOT_RUN and a failure status; a malformed field writes nothing', () => {
    const notRun = runWithFakeCurl(recordScript, { ...outputs, VERDICT: '', JUDGED_TRIMMED_SHA256: '', PUBLISHED_TRIMMED_SHA256: '' });
    expect(notRun.status, notRun.stderr).toBe(0);
    expect(parseJuliusRunResultRecord(postedBody(notRun.curlLog, '/git/tags'))?.verdict).toBe('NOT_RUN');
    expect(notRun.curlLog).toContain('"state":"failure"');
    for (const bad of [{ VERDICT: 'PASS\nverdict=PASS' }, { CHECKER_SHA256: 'x' }, { RUN: 'not-an-id' }, { FINAL_STATE: 'DONE' }, { OUTCOME_UNKNOWN: 'anything' }, { USD_MICROS: '-1' }]) {
      const refused = runWithFakeCurl(recordScript, { ...outputs, ...bad });
      expect(refused.status, JSON.stringify(bad)).not.toBe(0);
      expect(refused.curlLog, JSON.stringify(bad)).toBe('');
    }
    const exists = runWithFakeCurl(recordScript, outputs, { refCode: '422', refBody: '{"message":"Reference already exists"}' });
    expect(exists.stderr).toContain('result_tag_already_exists');
    expect(exists.curlLog, 'no status for a tag this run did not write').not.toContain('/statuses/');
  });

  it('the PASS step runs only on the pinned checker\'s own PASS, after the grade step; the verdict step reads closed fields', () => {
    expect(ifOf(step(grade, PASS_STEP_NAME))).toBe("success() && steps.verdict.outputs.verdict == 'PASS'");
    expect(grade.indexOf(`- name: ${GRADE_STEP_NAME}`)).toBeLessThan(grade.indexOf(`- name: ${VERDICT_STEP}`));
    expect(grade.indexOf(`- name: ${VERDICT_STEP}`)).toBeLessThan(grade.indexOf(`- name: ${PASS_STEP_NAME}`));
    expect(ifOf(step(grade, VERDICT_STEP))).toBe('always()');
    const work = mkdtempSync(join(tmpdir(), 'julius-x-prime-verdict-'));
    const rt = mkdtempSync(join(tmpdir(), 'julius-x-prime-rt-'));
    try {
      execFileSync('bash', ['-c', `mkdir -p "${work}/julius-inworld-verdict" "${work}/j1-evidence/final-message" "${rt}/j1-manifests"`]);
      const record = (sha: string) => JSON.stringify({ schema: 'julius-final-message.v2', taskId: 'build:task', contextId: 'ctx:1', runId: X_WLJ, trimmedSha256: sha });
      writeFileSync(join(work, 'julius-inworld-verdict', 'checker-verdict.txt'), [
        'schema=julius-inworld-verdict.v1', 'verdict=PASS', 'reason=none', `run_id=${X_WLJ}`, 'task_id=build:task', 'task_type=build',
        `judged_trimmed_sha256=${'b'.repeat(64)}`, 'context_id=ctx:1', `checker_sha256=${'1'.repeat(64)}`, `combined_pin=${'c'.repeat(64)}`, '',
      ].join('\n'));
      writeFileSync(join(work, 'j1-evidence', 'final-message', 'build_task.ctx_1.redacted.json'), record('b'.repeat(64)));
      writeFileSync(join(rt, 'j1-manifests', 'build_task.ctx_1.manifest.json'), record('b'.repeat(64)));
      const output = join(work, 'out.txt');
      writeFileSync(output, '');
      const run = runStep(script(step(grade, VERDICT_STEP)), work, { RUNNER_TEMP: rt, GITHUB_OUTPUT: output });
      expect(run.status, run.stderr).toBe(0);
      expect(readOutputs(output)).toEqual({
        verdict: 'PASS', checker_sha256: '1'.repeat(64), combined_pin_sha256: 'c'.repeat(64), judged_trimmed_sha256: 'b'.repeat(64),
        published_trimmed_sha256: 'b'.repeat(64), final_message_sha256: 'b'.repeat(64),
        // X-4: the grader's own hash comes from the verdict file (absent here), the node binary is the one on PATH.
        grader_sha256: 'none', node_sha256: expect.stringMatching(/^[0-9a-f]{64}$/u), node_version: process.version,
      });
      // No verdict file at all: NOT_RUN, every hash `none`.
      rmSync(join(work, 'julius-inworld-verdict'), { recursive: true, force: true });
      writeFileSync(output, '');
      expect(runStep(script(step(grade, VERDICT_STEP)), work, { RUNNER_TEMP: rt, GITHUB_OUTPUT: output }).status).toBe(0);
      expect(readOutputs(output).verdict).toBe('NOT_RUN');
      expect(readOutputs(output).published_trimmed_sha256).toBe('none');
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(rt, { recursive: true, force: true });
    }
  });

  it('the run summary is closed tokens from the scanned bundle: COMPLETED only with LIVE success AND this run\'s RESULT line', () => {
    const paid = job('first-live-mission');
    const summary = script(step(paid, SUMMARY_STEP));
    expect(paid.indexOf("- name: 'Refuse to publish evidence that contains credential material'")).toBeLessThan(paid.indexOf(`- name: ${SUMMARY_STEP}`));
    const work = mkdtempSync(join(tmpdir(), 'julius-x-prime-summary-'));
    try {
      execFileSync('bash', ['-c', `mkdir -p "${work}/julius-live-evidence" "${work}/julius-inworld-data-1-completed"`]);
      writeFileSync(join(work, 'julius-live-evidence', 'live-mission.evidence.txt'), `RESULT: COMPLETED after 9 ticks\n  run: ${X_WLJ}\n`);
      writeFileSync(join(work, 'julius-inworld-data-1-completed', 'marker.txt'), 'completed_at=2026-10-26T10:00:00Z\nrun_id=1\n');
      writeFileSync(join(work, 'julius-live-evidence', 'cost-accounting.tsv'), `run_id\tknown_usd_micros\tunknown_components\testimated_components\tunsettled_components\n${X_WLJ}\t1200000\t0\t0\t0\n${X_WLJ}\t34567\t0\t0\t0\n(2 rows)\n`);
      writeFileSync(join(work, 'julius-live-evidence', 'failures.tsv'), `run_id\tevent_type\treason_code\tjulius_code\tfailure_class\trecovery_action\trole\ttask_id\n${X_WLJ}\tjulius.task.failed\tHANDED_TIMEOUT_OUTCOME_UNKNOWN\t\t\t\tCODING_AGENT\tbuild:1\n(1 row)\n`);
      const run = (live: string) => {
        const output = join(work, `out-${live}.txt`);
        writeFileSync(output, '');
        const result = runStep(summary, work, { LIVE_OUTCOME: live, JULIUS_RUN_ID: X_WLJ, MARKER_NAMESPACE: 'julius-inworld-data-1', GITHUB_OUTPUT: output });
        expect(result.status, result.stderr).toBe(0);
        return readOutputs(output);
      };
      expect(run('success')).toEqual({
        final_state: 'COMPLETED', completed_at: '2026-10-26T10:00:00Z', outcome_unknown: 'HANDED_TIMEOUT_OUTCOME_UNKNOWN/CODING_AGENT/build:1', cost_basis: 'COMPLETE', usd_micros: '1234567',
      });
      expect(run('failure').final_state).toBe('FAILED');
      expect(run('cancelled').final_state).toBe('INTERRUPTED');
      writeFileSync(join(work, 'julius-live-evidence', 'live-mission.evidence.txt'), 'RESULT: COMPLETED after 9 ticks\n  run: wlj_other\n');
      expect(run('success'), 'a run whose own record never said COMPLETED is not COMPLETED').toMatchObject({ final_state: 'FAILED', completed_at: 'none' });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('LIVE PROGRESS IS UNCHANGED: the two publisher steps are byte-identical (comments aside) to #486\'s head b2764b76', () => {
    const paid = job('first-live-mission');
    const pinned = {
      "'Live progress: start the phase publisher (best-effort)'": '0c0e849f3206d40b00e53c8054b3c9245276013d5ad0771d83941f71983ac5e7',
      "'Live progress: stop the phase publisher'": 'a96dade13436b24050ec0cef51803b1e5289e327da832ef62140285e7f5ce4cf',
    };
    for (const [name, sha] of Object.entries(pinned)) {
      let block = step(paid, name);
      const blank = block.indexOf('\n\n');
      if (blank >= 0) block = block.slice(0, blank);
      block = block.split('\n').filter((line) => !/^\s*#/u.test(line)).join('\n').trimEnd();
      expect(createHash('sha256').update(block).digest('hex'), name).toBe(sha);
    }
  });
});

describe('X′ §5 (e): a private host copy of the scanned evidence, with SHA256SUMS', { timeout: 60_000 }, () => {
  const paid = job('first-live-mission');
  const grade = job('grade-inworld');
  const COPY = "'Keep the scanned evidence on the runner host (0700, SHA256SUMS)'";
  const ADD = "'Add the verdict to the runner host evidence copy (0700, SHA256SUMS)'";

  const sumsOf = (dir: string): Record<string, string> => Object.fromEntries(readFileSync(join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n').map((line) => {
    const [sha, name] = line.split(/ {2}/u);
    return [name ?? '', sha ?? ''];
  }));

  it('is the paid job\'s last step, best-effort, and keeps the scanned bundle and both markers, never a final message', () => {
    const steps = paid.slice(paid.indexOf('\n    steps:\n'));
    expect(steps.slice(steps.lastIndexOf('\n      - name: ') + '\n      - name: '.length).startsWith(COPY)).toBe(true);
    expect(step(paid, COPY)).toContain('continue-on-error: true');
    expect(script(step(paid, COPY))).not.toMatch(/\bsudo\b|mkdir -p|chmod 0700 "\$root"/u);
    expect(script(step(paid, COPY))).toContain('root=/var/lib/julius-evidence\n');
    const home = mkdtempSync(join(tmpdir(), 'julius-x-prime-home-'));
    const work = mkdtempSync(join(tmpdir(), 'julius-x-prime-live-'));
    try {
      execFileSync('bash', ['-c', `mkdir -p "${work}/julius-live-evidence/final-message" "${work}/julius-inworld-data-1-attempted" "${work}/julius-inworld-data-1-completed"`]);
      writeFileSync(join(work, 'julius-live-evidence', 'tasks.tsv'), 'run_id\n(0 rows)\n');
      writeFileSync(join(work, 'julius-live-evidence', 'final-message', `${STEM}.redacted.json`), '{"published":true}\n');
      writeFileSync(join(work, 'julius-inworld-data-1-attempted', 'marker.txt'), 'attempted_at=x\n');
      writeFileSync(join(work, 'julius-inworld-data-1-completed', 'marker.txt'), 'completed_at=x\n');
      const env = { HOME: home, MARKER_NAMESPACE: 'julius-inworld-data-1' };
      const copied = runStep(script(step(paid, COPY)), work, env);
      expect(copied.status, copied.stderr).toBe(0);
      const dir = join(home, 'julius-evidence', '40400000001-1');
      const sums = sumsOf(dir);
      expect(Object.keys(sums).sort()).toEqual([
        './julius-inworld-data-1-attempted/marker.txt', './julius-inworld-data-1-completed/marker.txt',
        `./julius-live-evidence/final-message/${STEM}.redacted.json`, './julius-live-evidence/tasks.tsv',
      ]);
      expect(sums['./julius-live-evidence/tasks.tsv']).toBe(createHash('sha256').update('run_id\n(0 rows)\n').digest('hex'));
      if (process.platform !== 'win32') expect(statSync(dir).mode & 0o777).toBe(0o700);
      // The grade job adds its verdict, and SHA256SUMS covers it.
      const gradeWork = mkdtempSync(join(tmpdir(), 'julius-x-prime-grade-'));
      try {
        execFileSync('bash', ['-c', `mkdir -p "${gradeWork}/julius-inworld-verdict"`]);
        writeFileSync(join(gradeWork, 'julius-inworld-verdict', 'checker-verdict.txt'), 'schema=julius-inworld-verdict.v1\nverdict=PASS\n');
        const added = runStep(script(step(grade, ADD)), gradeWork, { HOME: home });
        expect(added.status, added.stderr).toBe(0);
        expect(sumsOf(dir)['./julius-inworld-verdict/checker-verdict.txt']).toBe(createHash('sha256').update('schema=julius-inworld-verdict.v1\nverdict=PASS\n').digest('hex'));
        expect(Object.keys(sumsOf(dir))).toHaveLength(5);
      } finally { rmSync(gradeWork, { recursive: true, force: true }); }
      // A second copy for the same run attempt is refused, never merged.
      expect(runStep(script(step(paid, COPY)), work, env).stderr).toContain('evidence_copy_refused: copy_exists');
      // A raw final message in the bundle: the copy is removed and the step says so.
      rmSync(join(home, 'julius-evidence'), { recursive: true, force: true });
      writeFileSync(join(work, 'julius-live-evidence', `${STEM}.raw.txt`), 'the coder said this');
      const refused = runStep(script(step(paid, COPY)), work, env);
      expect(refused.stderr).toContain('evidence_copy_refused: final_message_raw_in_evidence');
      expect(() => readdirSync(dir)).toThrow();
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    }
  });
});

describe('Branch S X: bare self-hosted labels, fork guards on every pull_request job, an explicit PostgreSQL port', { timeout: 60_000 }, () => {
  const read = (file: string): string => readFileSync(join(ROOT, '.github/workflows', file), 'utf8');
  /** Every top-level job of a workflow: its key and its text. */
  const jobsOf = (text: string): { name: string; text: string }[] => {
    const body = text.slice(text.indexOf('\njobs:\n'));
    const keys = [...body.matchAll(/\n {2}([a-z][a-z0-9-]*):\n/gu)];
    return keys.map((match, index) => ({ name: match[1] ?? '', text: body.slice(match.index ?? 0, keys[index + 1]?.index ?? body.length) }));
  };
  const LABELS: Readonly<Record<string, string>> = {
    'relay-ci.yml': 'julius-ci', 'julius-real-infra.yml': 'julius-ci', 'julius-governed-evidence.yml': 'julius-ci',
    'julius-first-live-mission.yml': 'julius-paid', 'julius-governed-land.yml': 'julius-paid', 'julius-land.yml': 'julius-paid', 'julius-accept-main.yml': 'julius-paid',
  };
  const GUARD = "(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)";

  it('every job of the seven workflows runs on its bare label, and nothing asks for a hosted or generic self-hosted runner', () => {
    expect(readdirSync(join(ROOT, '.github/workflows')).sort()).toEqual(Object.keys(LABELS).sort());
    for (const [file, label] of Object.entries(LABELS)) {
      const jobs = jobsOf(read(file));
      expect(jobs.length, file).toBeGreaterThan(0);
      for (const entry of jobs) expect(/\n {4}runs-on: ([^\n]+)\n/u.exec(entry.text)?.[1], `${file} ${entry.name}`).toBe(label);
      expect(read(file), file).not.toMatch(/runs-on:[^\n]*(ubuntu|self-hosted|windows|macos)/u);
    }
  });

  it('every job of a pull_request-triggered workflow carries the head-repo guard, inert for push and dispatch', () => {
    const triggers = (file: string): string => read(file).slice(0, read(file).indexOf('\njobs:\n'));
    const triggered = Object.keys(LABELS).filter((file) => /\n {2}pull_request:/u.test(triggers(file)));
    expect(triggered.sort()).toEqual(['julius-governed-evidence.yml', 'julius-real-infra.yml', 'relay-ci.yml']);
    for (const file of triggered) {
      for (const entry of jobsOf(read(file))) {
        const condition = /\n {4}if: ([^\n]+)\n/u.exec(entry.text)?.[1] ?? '';
        expect(condition, `${file} ${entry.name}`).toContain(` && ${GUARD} }}`);
        expect(condition.startsWith("${{ !startsWith(github.ref, 'refs/heads/julius-governed-audit/')"), `${file} ${entry.name}: the audit-branch condition is kept`).toBe(true);
      }
    }
    // The paid and landing workflows have no pull_request trigger at all.
    for (const file of ['julius-first-live-mission.yml', 'julius-governed-land.yml', 'julius-land.yml', 'julius-accept-main.yml']) {
      expect(read(file).slice(0, read(file).indexOf('\njobs:\n')), file).not.toMatch(/\n {2}pull_request(_target)?:/u);
    }
  });

  it('the jobs that publish PostgreSQL through the executor\'s lines name JULIUS_LIVE_PG_PORT=55433, which the executor reads', () => {
    const port = "      JULIUS_LIVE_PG_PORT: '55433'\n";
    const realInfra = Object.fromEntries(jobsOf(read('julius-real-infra.yml')).map((entry) => [entry.name, entry.text]));
    expect(realInfra['first-live-topology']).toContain(port);
    expect(realInfra['learning-store-container']).toContain(port);
    expect(job('first-live-mission')).toContain(port);
    const executor = readFileSync(join(ROOT, '.github/julius-live-executor.sh'), 'utf8');
    expect(executor).toContain('pg_port=${JULIUS_LIVE_PG_PORT:-5432}');
    expect(executor).toContain('-p "127.0.0.1:${pg_port}:5432"');
  });
});

describe('REVIEW rulings D-a, D-b, D-d on the paid workflow', { timeout: 60_000 }, () => {
  const paid = job('first-live-mission');
  const grade = job('grade-inworld');
  /** Every step of a job: its display name (or `uses`) and its text. */
  const stepsOf = (text: string): { name: string; text: string }[] => text.slice(text.indexOf('\n    steps:\n')).split('\n      - ').slice(1)
    .map((block) => ({ name: /^(?:name: |uses: )([^\n]+)/u.exec(block)?.[1] ?? block.slice(0, 60), text: block }));

  it('D-a: the job token reaches exactly the steps that call GitHub, each named here with its reason; no job-level env carries it', () => {
    const jobEnv = paid.slice(paid.indexOf('\n    env:\n'), paid.indexOf('\n    steps:\n'));
    expect(jobEnv).not.toMatch(/GITHUB_TOKEN|GH_TOKEN|github\.token/u);
    const holders = stepsOf(paid).filter((entry) => /\n {10}(GITHUB_TOKEN|GH_TOKEN): \$\{\{ github\.token \}\}/u.test(entry.text)).map((entry) => entry.name);
    expect(holders).toEqual([
      "'Gate: the code this job will run is reviewed, current and not rolled back'", // gh api: main's tip, provenance, monotonicity
      "'Gate: no paid mission has been attempted or completed for THIS contract'", // gh api: the completion-marker listing
      "'Gate: attempted markers and the combined cap, before the attempted marker'", // the spent-tag ledger and attempted markers
      "'Learning pair arm WITH: restore arm WITHOUT''s store before anything migrates or bootstraps'", // the WITHOUT run's artifacts
      ATTEMPT_TAG, // X′ §2: the one contents: write use, the attempted record tag
      "'Live progress: start the phase publisher (best-effort)'", // the julius-live-progress status (statuses: write)
      LIVE_STEP, // the entrypoint's in-run cap check on the spent-tag ledger
    ]);
    // No other way to the token: no `github.token` and no `secrets.GITHUB_TOKEN` outside those steps.
    for (const entry of stepsOf(paid).filter((candidate) => !holders.includes(candidate.name))) {
      expect(entry.text, entry.name).not.toMatch(/github\.token|secrets\.GITHUB_TOKEN|GH_TOKEN|GITHUB_TOKEN:/u);
    }
  });

  it('D-a: the coder\'s and the reviewer\'s child environments are allowlists without the token', () => {
    const envelope = readFileSync(join(ROOT, 'relay-bridge/hosted-coding-agent/hosted-envelope.ts'), 'utf8');
    const built = envelope.slice(envelope.indexOf('export function hostedChildEnv('));
    expect(built.slice(0, built.indexOf('\n}\n'))).not.toMatch(/process\.env|GITHUB_TOKEN|GH_TOKEN|\.\.\.input/u);
    const reviewer = readFileSync(join(ROOT, 'relay-bridge/hermes-reviewer.ts'), 'utf8');
    expect(reviewer.split("env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },").length - 1).toBe(2);
  });

  it('D-b: the FAIL step mirrors the PASS step, only when this run\'s own verdict file says FAIL', () => {
    const passStep = step(grade, "'J1: the pinned checker''s verdict is PASS'");
    const failStep = step(grade, "'J1: the pinned checker''s verdict is FAIL'");
    expect(ifOf(failStep)).toBe("success() && steps.verdict.outputs.verdict == 'FAIL'");
    expect(ifOf(passStep)).toBe("success() && steps.verdict.outputs.verdict == 'PASS'");
    expect(grade.indexOf("- name: 'J1: read the verdict for the result record (closed fields)'")).toBeLessThan(grade.indexOf("- name: 'J1: the pinned checker''s verdict is FAIL'"));
    expect(failStep).toContain("run: echo 'checker_verdict=FAIL'");
  });

  it('D-d: grade-inworld sets up the LIVE job\'s own pinned node, without a cache, before anything runs node', () => {
    const pins = [...paid.matchAll(/- uses: (actions\/setup-node@[0-9a-f]{40}) # v4\n {8}with:\n {10}node-version: '([0-9]+)'/gu)].map((match) => `${match[1] ?? ''} ${match[2] ?? ''}`);
    expect(new Set(pins).size).toBe(1);
    const setup = /- uses: (actions\/setup-node@[0-9a-f]{40}) # v4\n {8}with:\n {10}node-version: '([0-9]+)'\n/u.exec(grade);
    expect(setup === null ? null : `${setup[1] ?? ''} ${setup[2] ?? ''}`).toBe(pins[0]);
    const block = grade.slice(grade.indexOf('- uses: actions/setup-node'));
    expect(block.slice(0, block.indexOf('\n      - ', 1))).not.toContain('cache:');
    expect(grade.indexOf('- uses: actions/setup-node')).toBeLessThan(grade.indexOf("- name: 'J1: receive the handoff from the runner host and verify every hash'"));
  });
});
