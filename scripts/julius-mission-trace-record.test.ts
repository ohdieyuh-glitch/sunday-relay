import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';

describe('the paid workflow derives trace ids and dispatch sends none', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/julius-first-live-mission.yml'), 'utf8');

  it('adds no trace input and derives traceId from the admitted run id', () => {
    const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
    expect(inputs).not.toMatch(/\n {6}(trace_id|traceId|span_id|spanId):/u);
    expect(inputs).toContain('\n      run_id:\n');
    expect(workflow).toContain('import { juliusMissionTraceId } from "./scripts/julius-mission-trace.mjs"');
    expect(workflow).toContain('JULIUS_RUN_ID: ${{ needs.spend-tag.outputs.run_id }}');
    const audit = workflow.indexOf('json_audit="julius-run-spent.v1');
    const auditEnd = workflow.indexOf('"', audit + 'json_audit="'.length);
    expect(workflow.slice(audit, auditEnd)).not.toContain('trace');
  });
});

describe('the paid-run archive file derives span ids from receipt phases', () => {
  it('writes the known coder trace and does not copy a trace id out of the diagnostics', () => {
    const script = readFileSync(join(ROOT, '.github/julius-live-evidence-dump.sh'), 'utf8');
    const start = script.indexOf('write_mission_trace() {');
    const end = script.indexOf('\nwrite_mission_trace ||');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const out = mkdtempSync(join(tmpdir(), 'julius-mission-trace-'));
    try {
      writeFileSync(join(out, 'live-mission.evidence.txt'), `Run ${WLJ} accepted in state READY; driving the Julius run loop.\n`);
      writeFileSync(join(out, 'worker-diagnostics.tsv'), [
        'role\tstage\tdispatch_attempt\ttrace_id',
        'CODING_AGENT\tbuild\t1\tffffffffffffffffffffffffffffffff',
        'INDEPENDENT_REVIEWER\trepair:plan\t1\tffffffffffffffffffffffffffffffff',
        '(2 rows)',
        '',
      ].join('\n'));
      execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', `${script.slice(start, end)}\nwrite_mission_trace`], {
        cwd: ROOT,
        env: { ...process.env, out, JULIUS_RUN_ID: 'preflight:ignored' },
      });
      const written = readFileSync(join(out, 'mission-trace.txt'), 'utf8');
      expect(written).toContain('schema=julius-mission-trace.v1');
      expect(written).toContain(`run_id=${WLJ}`);
      expect(written).toContain('traceId=192b1fbb866790da0ba590b4a8f45144');
      expect(written).toContain('traceparent=null');
      expect(written).toContain('phase role=CODING_AGENT stage=build attempt=1 spanId=3e314a67b8845836 traceparent=00-192b1fbb866790da0ba590b4a8f45144-3e314a67b8845836-01');
      expect(written).toContain('phase role=INDEPENDENT_REVIEWER stage=repair:plan attempt=1 spanId=27db1a46844508b8 traceparent=00-192b1fbb866790da0ba590b4a8f45144-27db1a46844508b8-01');
      expect(written).not.toContain('ffffffffffffffffffffffffffffffff');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it('a legacy accepted run and a preflight id derive null', () => {
    const script = readFileSync(join(ROOT, '.github/julius-live-evidence-dump.sh'), 'utf8');
    const start = script.indexOf('write_mission_trace() {');
    const end = script.indexOf('\nwrite_mission_trace ||');
    const out = mkdtempSync(join(tmpdir(), 'julius-mission-trace-legacy-'));
    try {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'live-mission.evidence.txt'), 'Run run:0123456789abcdef01234567 accepted in state READY; driving the Julius run loop.\n');
      writeFileSync(join(out, 'worker-diagnostics.tsv'), 'unavailable\n');
      execFileSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', `${script.slice(start, end)}\nwrite_mission_trace`], {
        cwd: ROOT,
        env: { ...process.env, out, JULIUS_RUN_ID: 'preflight:abc' },
      });
      expect(readFileSync(join(out, 'mission-trace.txt'), 'utf8')).toContain('traceId=null');
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
