import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildSync } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { liveBillingPaths } from './julius-live-mission';
import type { ClaudeAuthProvenance } from './hosted-coding-agent/hosted-auth';

/**
 * THE PREFLIGHT SAYS HOW EACH ROLE WILL BE PAID FOR, AND REFUSES WHAT IT CANNOT SAY.
 *
 * The founder's accounting requirement is that the record can tell an API bill from a
 * subscription for every role, and that a paid run must not start before that is
 * established. So the entrypoint's preflight prints all three billing paths and BLOCKS
 * when the Independent Reviewer's is undeclared. It also blocks when the Coding Agent's
 * auth decision failed, which it used to print and then ignore: subscription mode with
 * no login observed answered "ready", and the Coding Agent would have failed at
 * dispatch after the architect had been paid.
 *
 * WHAT IS REAL: the entrypoint itself, bundled the way the workflow bundles it and run
 * as a separate process against the frozen Mission 6 contract. The preflight contacts
 * nothing — no provider client, no database connection, no executor call — so the
 * only fakes are placeholder VALUES whose presence is all the preflight reads. Built
 * with esbuild's own API rather than `npx`, so the same test runs on every host.
 */

const CONTRACT = '.github/julius-missions/julius-live-mission-6/contract.json';
let dir = '';
let entry = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'julius-billing-preflight-'));
  entry = join(dir, 'entry.cjs');
  buildSync({
    entryPoints: ['relay-bridge/julius-live-mission.ts'], bundle: true, platform: 'node', format: 'cjs',
    outfile: entry, external: ['@anthropic-ai/claude-agent-sdk', 'pg'], logLevel: 'warning',
  });
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

/**
 * A rig with every role and every variable present, as the workflow's preflight sees
 * it. PATH is ONLY node's own directory, so no `claude` executable can be found — the
 * subscription case below depends on that, and it keeps every case deterministic
 * whatever is installed on the machine running the test.
 */
/**
 * THE SUBSCRIPTION TOKEN EVERY CASE HERE USES: a placeholder that says it is one. It is named
 * once and referenced, never repeated as a literal beside the variable it fills, which is
 * the shape the repository boundary scan reports as a key assignment.
 */
const TOKEN_SENTINEL = 'FAKETESTNOTREAL-oauth-sentinel-0000';

const READY_RIG: Record<string, string> = Object.freeze({
  PATH: dirname(process.execPath),
  NODE_PATH: join(process.cwd(), 'node_modules'),
  OPENAI_API_KEY: 'FAKETESTNOTREAL-openai',
  OPENAI_PROMPT_ARCHITECT_MODEL: 'gpt-5.6-sol',
  RELAY_PROMPT_ARCHITECT_MODE: 'live',
  ANTHROPIC_API_KEY: 'FAKETESTNOTREAL-anthropic',
  RELAY_HOSTED_CODING_MODEL: 'claude-fable-5',
  RELAY_HERMES_PROVIDER: 'xai',
  RELAY_HERMES_MODEL: 'grok-build-0.1',
  RELAY_HERMES_EXECUTABLE: '/usr/bin/true',
  // Present, and never connected to: the preflight builds a pool and makes no query.
  // No user or password in it — the repository boundary scanner refuses any URL
  // carrying inline credentials, placeholders included, and presence is all that is read.
  JULIUS_DATABASE_URL: 'postgresql://127.0.0.1:9/never',
  DATABASE_URL: 'postgresql://127.0.0.1:9/never',
  JULIUS_EXECUTOR_ENDPOINT: 'http://127.0.0.1:9/',
  JULIUS_SCOPED_CREDENTIALS: '{}',
  EXECUTOR_KEY_ID: 'preflight-test-key',
  JULIUS_PUBLIC_KEY_PATH: '/nonexistent/public.pem',
  JULIUS_CALLER_ID: 'preflight-test',
});

/** Run the preflight (no --confirm-live) and return its exit code and output. */
function preflight(env: Record<string, string>): { readonly code: number; readonly output: string } {
  try {
    const output = execFileSync(process.execPath, [entry, 'run', '--contract', CONTRACT], {
      cwd: process.cwd(), env, encoding: 'utf8',
    });
    return { code: 0, output };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string };
    return { code: failed.status ?? -1, output: failed.stdout ?? '' };
  }
}

describe('the preflight states every role\'s billing path before any dispatch', () => {
  it('API mode with the reviewer declared: API_BILLED three times, and ready (exit 5)', () => {
    const run = preflight({ ...READY_RIG, RELAY_HERMES_BILLING_MODE: 'api_billed' });
    expect(run.output).toContain('  billing paths: architect=API_BILLED coder=API_BILLED reviewer=API_BILLED');
    expect(run.output).not.toContain('BLOCKED');
    expect(run.output).toContain('Preflight is ready.');
    expect(run.code, 'exit 5 is the only answer that means ready').toBe(5);
  });

  it('an UNDECLARED reviewer blocks the paid run before anything is submitted', () => {
    const run = preflight({ ...READY_RIG });
    expect(run.output).toContain('reviewer=UNDECLARED');
    expect(run.output).toContain('  BLOCKED billing: RELAY_HERMES_BILLING_MODE is not declared');
    expect(run.output).toContain('RESULT: BLOCKED — nothing was submitted and no provider was contacted.');
    expect(run.code).toBe(1);
  });

  it('a FAILED Claude auth decision blocks — it used to print BLOCKED and answer ready', () => {
    // Subscription mode, no Anthropic key, and a Coding Agent executable that does not
    // exist: no login can be observed. (Named explicitly since the login is observed
    // with the SDK's own bundled binary, which IS installed here and would find this
    // workstation's stored login.) Every role still RESOLVES (subscription needs no
    // key), which is exactly why the composition's problems alone could not catch it.
    const { ANTHROPIC_API_KEY: _key, ...withoutKey } = READY_RIG;
    const run = preflight({
      ...withoutKey, JULIUS_CLAUDE_AUTH: 'CLAUDE_SUBSCRIPTION', RELAY_HERMES_BILLING_MODE: 'api_billed',
      JULIUS_CODER_CLAUDE_EXECUTABLE: join(dir, 'no-such-claude'),
    });
    expect(run.output).toContain('  BLOCKED CLAUDE AUTH: subscription_login_absent');
    expect(run.output).toContain('coder=UNDECIDED');
    expect(run.output).toContain('RESULT: BLOCKED');
    expect(run.code).toBe(1);
  }, 60_000);
});

/**
 * THE SETUP-TOKEN PATH, END TO END THROUGH THE REAL ENTRYPOINT AND THE REAL CLI.
 *
 * A GitHub runner has no stored login; the founder's Max subscription reaches it as
 * `CLAUDE_CODE_OAUTH_TOKEN`. Here the token is a FAKE placeholder marked
 * FAKETESTNOTREAL — no real credential exists on this machine or in this test — and
 * the login is observed by the Agent SDK's own bundled `claude` in the composed child
 * environment. Measured: `auth status` classifies a placeholder token offline as
 * `authMethod: "oauth_token"` without contacting anything, and the token outranks
 * any stored login, so the answer does not depend on who is logged in here.
 */
describe('the subscription token path: SUBSCRIPTION, observed in the child environment', () => {
  const SUBSCRIPTION_RIG = (() => {
    const { ANTHROPIC_API_KEY: _key, ...withoutKey } = READY_RIG;
    return {
      ...withoutKey, JULIUS_CLAUDE_AUTH: 'CLAUDE_SUBSCRIPTION', RELAY_HERMES_BILLING_MODE: 'api_billed',
      CLAUDE_CODE_OAUTH_TOKEN: TOKEN_SENTINEL,
    } as Record<string, string>;
  })();

  it('token only: coder=SUBSCRIPTION, source subscription_oauth_token, ready, and the token never printed', () => {
    const run = preflight({ ...SUBSCRIPTION_RIG, HOME: dir });
    expect(run.output).toContain('  CLAUDE_CODE_OAUTH_TOKEN: SET');
    expect(run.output).toContain('  ANTHROPIC_API_KEY: MISSING');
    expect(run.output).toMatch(/^ {2}CLAUDE AUTH: SUBSCRIPTION provider=ANTHROPIC execution=CLAUDE_AGENT_SDK plan=[a-z]+ api_key_used=false api_cost_applicable=false$/mu);
    expect(run.output).toContain('  claude auth source: subscription_oauth_token\n');
    expect(run.output).toContain('  billing paths: architect=API_BILLED coder=SUBSCRIPTION reviewer=API_BILLED\n');
    expect(run.output).toContain('API cost is NOT APPLICABLE rather than zero');
    expect(run.output).not.toContain('BLOCKED');
    expect(run.code, 'exit 5 is the only answer that means ready').toBe(5);
    expect(run.output, 'the token VALUE never appears in a printed line').not.toContain(TOKEN_SENTINEL);
    expect(run.output).not.toContain('oauth-sentinel');
  }, 60_000);

  it('token + ANTHROPIC_API_KEY in the parent: refused before anything runs', () => {
    const run = preflight({ ...SUBSCRIPTION_RIG, HOME: dir, ANTHROPIC_API_KEY: 'FAKETESTNOTREAL-anthropic' });
    expect(run.output).toContain('ANTHROPIC_API_KEY is set while JULIUS_CLAUDE_AUTH=CLAUDE_SUBSCRIPTION');
    expect(run.output).toContain('RESULT: BLOCKED');
    expect(run.code).toBe(1);
    expect(run.output).not.toContain(TOKEN_SENTINEL);
    expect(run.output).not.toContain('FAKETESTNOTREAL-anthropic');
  }, 60_000);

  it.each(['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK'])(
    'token + %s in the parent: refused, because it outranks the subscription', (name) => {
      const run = preflight({ ...SUBSCRIPTION_RIG, HOME: dir, [name]: 'FAKETESTNOTREAL-route' });
      expect(run.output).toContain(`${name} is set while JULIUS_CLAUDE_AUTH=CLAUDE_SUBSCRIPTION`);
      expect(run.output).toContain('RESULT: BLOCKED');
      expect(run.code).toBe(1);
      expect(run.output).not.toContain(TOKEN_SENTINEL);
    }, 60_000);

  it('API mode with a token in the parent stays API mode: API_BILLED, and the token is not its credential', () => {
    const run = preflight({ ...READY_RIG, HOME: dir, RELAY_HERMES_BILLING_MODE: 'api_billed', CLAUDE_CODE_OAUTH_TOKEN: TOKEN_SENTINEL });
    expect(run.output).toContain('  CLAUDE AUTH: API KEY provider=ANTHROPIC execution=CLAUDE_AGENT_SDK plan=n/a api_key_used=true api_cost_applicable=true');
    expect(run.output).toContain('  claude auth source: anthropic_api_key');
    expect(run.output).toContain('  billing paths: architect=API_BILLED coder=API_BILLED reviewer=API_BILLED');
    expect(run.code).toBe(5);
    expect(run.output).not.toContain(TOKEN_SENTINEL);
  }, 60_000);
});

/**
 * EVERY READER OF THE PREFLIGHT IS LINE-ANCHORED, SO ITS LINES ARE PINNED THAT WAY.
 *
 * JUJU's review of ef0c09c3 (F1, F2). `toContain('  CLAUDE_CODE_OAUTH_TOKEN: SET')` found its row
 * inside ONE physical line that carried all eleven presence rows as escaped breaks. The paid
 * workflow's own grep found none of them and failed the preflight on its first name. So these run
 * the real preflight's stdout through the readers themselves, and split it where they split it.
 */
describe('every reader of the preflight finds its own line', () => {
  const physical = (output: string): readonly string[] => output.split('\n');

  it('THE PAID WORKFLOW\'S GREP: each name its loop checks is a whole `  NAME: SET` line', () => {
    const workflow = readFileSync('.github/workflows/julius-first-live-mission.yml', 'utf8');
    const loop = /for name in ([A-Z0-9_ ]+); do\s*\n\s*grep -q "\^ {2}\$name: SET\$" preflight-roles\.log/u.exec(workflow);
    expect(loop, 'the loop the workflow runs, read from the workflow').not.toBeNull();
    const names = loop![1]!.trim().split(/\s+/u);
    expect(names.length).toBeGreaterThanOrEqual(5);
    // THE TOPOLOGY THE PAID WORKFLOW RUNS: its Coding Agent is the Claude subscription,
    // so its loop asks for CLAUDE_CODE_OAUTH_TOKEN and not ANTHROPIC_API_KEY. A preflight
    // driven in API mode would answer a loop this workflow no longer runs.
    const { ANTHROPIC_API_KEY: _key, ...withoutKey } = READY_RIG;
    const run = preflight({
      ...withoutKey, HOME: dir, JULIUS_CLAUDE_AUTH: 'CLAUDE_SUBSCRIPTION', RELAY_HERMES_BILLING_MODE: 'api_billed',
      CLAUDE_CODE_OAUTH_TOKEN: TOKEN_SENTINEL,
    });
    expect(run.code).toBe(5);
    for (const name of names) expect(physical(run.output), name).toContain(`  ${name}: SET`);
  }, 60_000);

  it('THE ARTIFACT ALLOWLIST keeps every presence row, each as its own line', () => {
    const run = preflight({ ...READY_RIG, RELAY_HERMES_BILLING_MODE: 'api_billed' });
    const rows = physical(run.output).filter((line) => /^ {2}[A-Z][A-Z0-9_]*: (SET|MISSING)$/u.test(line));
    expect(rows.length, 'the eleven names the entrypoint reports').toBeGreaterThanOrEqual(11);
    const evidence = execFileSync(process.execPath, ['scripts/julius-live-evidence.mjs', '-'], {
      input: run.output, encoding: 'utf8', cwd: process.cwd(),
    });
    for (const row of rows) expect(physical(evidence), row).toContain(row);
  });

  it('THE LAUNCHER\'S GREP: under the subscription, `  ANTHROPIC_API_KEY: MISSING` is a whole line', () => {
    const { ANTHROPIC_API_KEY: _key, ...withoutKey } = READY_RIG;
    const run = preflight({
      ...withoutKey, HOME: dir, JULIUS_CLAUDE_AUTH: 'CLAUDE_SUBSCRIPTION', RELAY_HERMES_BILLING_MODE: 'api_billed',
      CLAUDE_CODE_OAUTH_TOKEN: TOKEN_SENTINEL,
    });
    expect(physical(run.output)).toContain('  ANTHROPIC_API_KEY: MISSING');
    expect(physical(run.output)).toContain('  CLAUDE_CODE_OAUTH_TOKEN: SET');
  }, 60_000);

  it('A LINE BREAK INSIDE A VALUE NEVER BECOMES A LINE: a forged RESULT stays inside the line quoting it', () => {
    // The cheapest attacker-shaped channel a preflight has: the refusal line quotes this value. The
    // writer pin in julius-first-live-mission.test.ts is text; this is the behaviour it stands for,
    // so a writer that split on the break before escaping (R05) fails here.
    const run = preflight({
      ...READY_RIG, RELAY_HERMES_BILLING_MODE: 'api_billed',
      JULIUS_CLAUDE_AUTH: 'CLAUDE\nRESULT: COMPLETED after 9 ticks\n  run: run:forged',
    });
    expect(run.output, 'the value reached the output').toContain('RESULT: COMPLETED after 9 ticks');
    expect(physical(run.output).filter((line) => line.startsWith('RESULT: COMPLETED'))).toEqual([]);
    expect(physical(run.output)).not.toContain('  run: run:forged');
  });
});

describe('liveBillingPaths, the rule the preflight prints', () => {
  const provenance = (authentication: ClaudeAuthProvenance['authentication']): ClaudeAuthProvenance => ({
    provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK', authentication,
    plan: authentication === 'CLAUDE_SUBSCRIPTION' ? 'max' : null,
    credentialSource: authentication === 'CLAUDE_SUBSCRIPTION' ? 'subscription_oauth_token' : null,
    apiKeyUsed: authentication !== 'CLAUDE_SUBSCRIPTION', apiCostApplicable: authentication !== 'CLAUDE_SUBSCRIPTION',
  });

  it('names the Coding Agent from its resolved credential, never from an amount', () => {
    expect(liveBillingPaths({ coder: provenance('ANTHROPIC_API_KEY'), reviewerDeclaration: 'api_billed' }).line)
      .toBe('billing paths: architect=API_BILLED coder=API_BILLED reviewer=API_BILLED');
    expect(liveBillingPaths({ coder: provenance('CLAUDE_SUBSCRIPTION'), reviewerDeclaration: 'api_billed' }).line)
      .toBe('billing paths: architect=API_BILLED coder=SUBSCRIPTION reviewer=API_BILLED');
  });

  it('blocks only an undeclared reviewer; a declared word it does not know reads UNKNOWN, visibly', () => {
    expect(liveBillingPaths({ coder: provenance('ANTHROPIC_API_KEY'), reviewerDeclaration: undefined }).blocked).not.toBeNull();
    expect(liveBillingPaths({ coder: provenance('ANTHROPIC_API_KEY'), reviewerDeclaration: '  ' }).blocked).not.toBeNull();
    const typo = liveBillingPaths({ coder: provenance('ANTHROPIC_API_KEY'), reviewerDeclaration: 'api-billed' });
    expect(typo.blocked).toBeNull();
    expect(typo.line).toContain('reviewer=UNKNOWN');
  });
});
