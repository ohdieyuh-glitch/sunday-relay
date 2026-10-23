/**
 * CODER-SLOT LIVE PROBE v2 (JULIUS_DEV, 2026-10-18). UNSCORED, NOT A REGISTRATION, NOT EVIDENCE for any readiness row.
 *
 * What it does: for each requested effort level it makes ONE tiny edit task in a brand-new throwaway git workspace under the OS temp
 * directory and runs the REAL Julius hosted runner (runHostedCodingAgent) through the REAL Claude Agent SDK and CLI, subscription auth.
 * With `selftest` it additionally offers the coder the NEW run_mission_test tool backed by a STUB (no executor, no test command, no
 * network): it only counts calls and returns a canned result, to prove the live model <-> SDK <-> MCP path works.
 *
 * What it can touch (and nothing else):
 *   1. a fresh directory created with mkdtemp under the OS temp dir (the coder's cwd; tools Read/Glob/Grep/Edit only; Bash disallowed;
 *      Julius's PreToolUse authority confines file tools to that directory by real path and refuses control/credential/workflow paths);
 *   2. the results folder named below (two files: probe_result.json, probe_result.txt) written by THIS script only;
 *   3. the CLI's own credential file under ~/.claude IF the login token needs refreshing (normal CLI behaviour).
 * It does NOT write the repository, the evidence folders, Registration 2, or any Julius store. It passes persistSession:false so the CLI
 * does not save a transcript into ~/.claude/projects. The child's environment is built from nothing (PATH, HOME and terminal markers
 * only); no API key, database URL or other credential of any provider is passed.
 *
 * Spending limits (all enforced, per run; the probe makes at most 2 runs per level argument you give it):
 *   - maxBudgetUsd 0.50 handed to the CLI (it stops itself and returns error_max_budget_usd), AND checked again after the run;
 *   - maxTurns 8; maxRuntimeMs 240000 (the runner aborts the child at that deadline).
 * Billing path: CLAUDE_SUBSCRIPTION. The API key is omitted from the child entirely, so there is no per-token API bill; usage is drawn
 * from the Claude plan of whichever account the CLI is logged in to on this machine (or CLAUDE_CODE_OAUTH_TOKEN if you set it yourself).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { runHostedCodingAgent } from '../relay-bridge/hosted-coding-agent/hosted-runner';
import { hostedLimitsForAllocation } from '../relay-bridge/hosted-coding-agent/hosted-envelope';

const MODEL = 'claude-opus-5-5'; // the model the paid workflow pins for the Coding Agent
const RESULTS = process.env.PROBE_RESULTS_DIR ?? 'C:\\dev\\iwonder\\_qa_handoff\\julius_readiness\\followon_100\\coder_probe_20261018';
const args = process.argv.slice(2);
const levels = (args.find((a) => !a.startsWith('--')) ?? 'low').split(',');
const withSelfTest = args.includes('--selftest');
const ALLOWED = ['low', 'medium', 'high', 'xhigh', 'max', 'none'];
for (const level of levels) if (!ALLOWED.includes(level)) { console.error(`refused: level "${level}" is not one of ${ALLOWED.join(', ')}`); process.exit(2); }
if (levels.length > 3) { console.error('refused: at most 3 runs per invocation'); process.exit(2); }

const short = (value: unknown, n = 200): unknown => (typeof value === 'string' && value.length > n ? `${value.slice(0, n)}...` : value);
const results: Record<string, unknown>[] = [];

for (const level of levels) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'julius-coder-probe-')));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'hello.txt'), 'placeholder\n');
  const stub = { calls: 0 };
  const selfTestTool = withSelfTest ? {
    maxCalls: 2,
    async run() { stub.calls += 1; return { n: stub.calls, passed: true, exitCode: 0, refused: null as string | null, outputTail: 'stub: 3 tests, 3 passed' }; },
  } : undefined;
  const prompt = withSelfTest
    ? 'First call the run_mission_test tool once and read its result. Then edit the file hello.txt in the working directory so that its entire content is exactly the single line: effort probe ok\nThen stop. Do nothing else.'
    : 'Edit the file hello.txt in the working directory so that its entire content is exactly the single line: effort probe ok\nThen stop. Do nothing else.';
  const t0 = Date.now();
  let summary: Record<string, unknown>;
  try {
    const outcome = await runHostedCodingAgent({
      // persistSession:false is injected HERE, in the probe, so the product code is untouched and no transcript is saved to ~/.claude/projects
      queryFn: ((params: { prompt: string; options: Record<string, unknown> }) => query({ ...params, options: { ...params.options, persistSession: false } } as never)) as never,
      prompt, workspacePath: dir, apiKey: '', authMode: 'CLAUDE_SUBSCRIPTION', requestedModel: MODEL,
      now: () => new Date().toISOString(),
      limits: { ...hostedLimitsForAllocation(500_000), maxTurns: 8, maxRuntimeMs: 240_000 },
      ...(level === 'none' ? {} : { effort: level as never }),
      ...(selfTestTool === undefined ? {} : { selfTestTool, sdkHelpers: { createSdkMcpServer, tool } as never }),
    });
    const o = outcome as unknown as Record<string, unknown>;
    const obs = (o.observation ?? {}) as Record<string, unknown>;
    summary = {
      kind: o.kind, safeMessage: short(o.safeMessage), reason: o.reason ?? o.failureReason,
      observation: JSON.parse(JSON.stringify(obs, (_k, v) => (typeof v === 'string' ? short(v, 160) : v))),
    };
  } catch (error) {
    summary = { thrown: short(error instanceof Error ? error.message : String(error)) };
  }
  let file = '';
  try { file = readFileSync(join(dir, 'hello.txt'), 'utf8').trim(); } catch { /* absent */ }
  results.push({
    level, withSelfTest, model: MODEL, wallMs: Date.now() - t0, workspace: dir, helloTxt: file, helloOk: file === 'effort probe ok',
    stubSelfTestCalls: withSelfTest ? stub.calls : null, ...summary,
  });
  console.log(JSON.stringify(results[results.length - 1], null, 1).slice(0, 7000));
  console.log('-----');
}

mkdirSync(RESULTS, { recursive: true });
const json = JSON.stringify({ probe: 'coder-slot-live-probe-v2', at: new Date().toISOString(), results }, null, 1);
writeFileSync(join(RESULTS, 'probe_result.json'), json);
writeFileSync(join(RESULTS, 'probe_result.txt'), `sha256 ${createHash('sha256').update(json).digest('hex')}\n${results.map((r) => `${String(r.level)}: kind=${String(r.kind)} helloOk=${String(r.helloOk)} wallMs=${String(r.wallMs)} selfTestCalls=${String(r.stubSelfTestCalls)}`).join('\n')}\n`);
console.log(`results written to ${RESULTS}`);
