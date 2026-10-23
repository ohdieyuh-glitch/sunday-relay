import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { runHostedCodingAgent } from '../relay-bridge/hosted-coding-agent/hosted-runner';
import { hostedLimitsForAllocation } from '../relay-bridge/hosted-coding-agent/hosted-envelope';

const MODEL = process.env.PROBE_MODEL ?? 'claude-opus-5-5';
const levels = (process.argv[2] ?? 'low').split(',');
const short = (value: unknown, n = 240): unknown => typeof value === 'string' && value.length > n ? `${value.slice(0, n)}...` : value;

for (const level of levels) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'effort-probe-')));
  execFileSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'hello.txt'), 'placeholder\n');
  const t0 = Date.now();
  let summary: Record<string, unknown>;
  try {
    const outcome = await runHostedCodingAgent({
      queryFn: query as never,
      prompt: 'Edit the file hello.txt in the working directory so that its entire content is exactly the single line: effort probe ok\nThen stop. Do not do anything else.',
      workspacePath: dir, apiKey: '', authMode: 'CLAUDE_SUBSCRIPTION', requestedModel: MODEL,
      now: () => new Date().toISOString(), limits: hostedLimitsForAllocation(500_000),
      ...(level === 'none' ? {} : { effort: level as never }),
    });
    const o = outcome as Record<string, unknown>;
    const obs = (o.observation ?? {}) as Record<string, unknown>;
    summary = { kind: o.kind, safeMessage: short(o.safeMessage), reason: o.reason ?? o.failureReason,
      observationKeys: Object.keys(obs), observation: JSON.parse(JSON.stringify(obs, (k, v) => (typeof v === 'string' ? short(v, 160) : v))) };
  } catch (error) {
    summary = { thrown: short(error instanceof Error ? error.message : String(error)) };
  }
  let file = '';
  try { file = readFileSync(join(dir, 'hello.txt'), 'utf8'); } catch { /* absent */ }
  console.log(JSON.stringify({ level, model: MODEL, wallMs: Date.now() - t0, helloTxt: file.trim(), ...summary }, null, 1).slice(0, 6000));
  console.log('-----');
}
