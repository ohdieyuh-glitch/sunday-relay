/**
 * Writes the committed record of Julius's own overhead under SIMULATED
 * PROVIDER LATENCY: `src/relay/mission/julius/julius-latency-measure.json`.
 *
 *   npm run julius:latency:measure            # measure the record matrix and write it
 *   npm run julius:latency:measure -- --compare   # measure, print against the committed record, write nothing
 *
 * Spend-free: every provider is a scripted fake wrapped in an injected delay.
 * No provider is called, no credential is read, nothing is paid for. The
 * numbers are about Julius's scheduling and bookkeeping on THIS machine, not
 * about any real provider, whose latency stays Unknown.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  juliusLatencyMatrix, measureJuliusLatencyMatrix, type JuliusLatencyRecord,
} from '../src/relay/mission/julius/julius-latency-measure';

const repoRoot = resolve(__dirname, '..');
const recordPath = resolve(repoRoot, 'src/relay/mission/julius/julius-latency-measure.json');
const compare = process.argv.slice(2).includes('--compare');

function baseCommit(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const cpu = cpus()[0];
  const record = await measureJuliusLatencyMatrix(juliusLatencyMatrix('record'), {
    nowMs: () => performance.now(),
    sleep: (ms) => new Promise<void>((done) => { setTimeout(done, ms); }),
  }, {
    generatedAt: new Date().toISOString(),
    baseCommit: baseCommit(),
    environment: {
      node: process.version, platform: platform(), release: release(),
      cpuModel: cpu?.model ?? null, cpuCount: cpus().length,
    },
  });

  if (compare) {
    if (!existsSync(recordPath)) {
      process.stderr.write('julius_latency_measure: no committed record to compare against\n');
      return 2;
    }
    const committed = JSON.parse(readFileSync(recordPath, 'utf8')) as JuliusLatencyRecord;
    const before = new Map(committed.cases.map((item) => [item.name, item]));
    process.stdout.write(`${record.label}\n`);
    process.stdout.write('case | julius ms/dispatch (committed -> now) | makespan / serial (committed -> now)\n');
    for (const item of record.cases) {
      const old = before.get(item.name);
      const show = (value: number | null | undefined) => (value === null || value === undefined ? 'Unknown' : String(value));
      process.stdout.write(`${item.name} | ${show(old?.juliusPerDispatchMs)} -> ${show(item.juliusPerDispatchMs)} | ${show(old?.makespanOverSerial)} -> ${show(item.makespanOverSerial)}\n`);
    }
    return 0;
  }

  writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  process.stdout.write(`julius_latency_measure: wrote ${String(record.cases.length)} cases (${record.label})\n`);
  return 0;
}

main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  process.stderr.write(`julius_latency_measure_threw: ${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}\n`);
  process.exitCode = 8;
});
