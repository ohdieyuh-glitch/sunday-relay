import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
    // Subscription mode, no Anthropic key, and no `claude` on PATH: no login can be
    // observed. Every role still RESOLVES (subscription needs no key), which is exactly
    // why the composition's problems alone could not catch it.
    const { ANTHROPIC_API_KEY: _key, ...withoutKey } = READY_RIG;
    const run = preflight({ ...withoutKey, JULIUS_CLAUDE_AUTH: 'CLAUDE_SUBSCRIPTION', RELAY_HERMES_BILLING_MODE: 'api_billed' });
    expect(run.output).toContain('  BLOCKED CLAUDE AUTH: subscription_login_absent');
    expect(run.output).toContain('coder=UNDECIDED');
    expect(run.output).toContain('RESULT: BLOCKED');
    expect(run.code).toBe(1);
  });
});

describe('liveBillingPaths, the rule the preflight prints', () => {
  const provenance = (authentication: ClaudeAuthProvenance['authentication']): ClaudeAuthProvenance => ({
    provider: 'ANTHROPIC', execution: 'CLAUDE_AGENT_SDK', authentication,
    plan: authentication === 'CLAUDE_SUBSCRIPTION' ? 'max' : null,
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
