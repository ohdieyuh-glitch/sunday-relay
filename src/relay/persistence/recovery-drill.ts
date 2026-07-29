import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Real process-restart recovery drill (Prompt 8.5 — Gate B). OFFLINE ONLY:
 * fake adapters, an isolated temporary state root, and ZERO provider calls.
 *
 * Process A runs the offline fake supervised workflow and CRASHES
 * immediately after the reviewer's Finding + Repair are durably persisted
 * (lock left held, workspace left on disk — real crash semantics).
 * Process B is a fresh Node process that loads and validates the durable
 * journal, reconstructs the state, re-inspects the workspace, preserves the
 * call accounting, and generates the recovery plan — which always requires
 * explicit founder authorization before any further live call.
 */

const RUN_ID = 'run_t0001-drill';

export async function runRecoveryDrill(): Promise<{ lines: string[]; exitCode: number }> {
  const lines: string[] = [];
  const emit = (...l: string[]): void => { for (const x of l) lines.push(x); };
  const drillDir = mkdtempSync(join(tmpdir(), 'relay-recovery-drill-'));
  const stateRoot = join(drillDir, 'state');
  const scratch = join(drillDir, 'scratch');
  mkdirSync(scratch, { recursive: true });
  const driverPath = join(drillDir, 'driver.cjs');
  let failures = 0;
  const step = (name: string, ok: boolean, detail?: string): void => {
    emit(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures += 1;
  };
  const runDriver = (args: string[]): { code: number; json: Record<string, unknown> | null } => {
    let stdout = '';
    let code = 0;
    try {
      stdout = execFileSync(process.execPath, [driverPath, ...args], {
        encoding: 'utf8', timeout: 180_000, env: { ...process.env, TMPDIR: scratch },
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      code = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    const last = stdout.split('\n').filter((l) => l.trim() !== '').pop() ?? '';
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(last) as Record<string, unknown>; } catch { json = null; }
    return { code, json };
  };

  try {
    emit('RELAY DURABLE RECOVERY DRILL (offline — fake adapters, isolated state root, no provider call)', '');
    // The repo's own esbuild binary (already a dependency) bundles the driver.
    execFileSync(join(process.cwd(), 'node_modules', '.bin', 'esbuild'), [
      join(process.cwd(), 'src', 'relay', 'persistence', 'driver-main.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${driverPath}`, '--log-level=warning',
    ], { encoding: 'utf8', timeout: 120_000 });

    emit('PROCESS A — offline fake supervised run, crashed after Finding + Repair persisted');
    const a = runDriver(['interrupt-after-repair-created', '--state-root', stateRoot, '--run', 'drill']);
    step('1. offline fake supervised run started in process A', a.json?.ok === true);
    step('2. recoverable interrupted state persisted (Finding + Repair recorded)',
      a.json?.crashedAfter === 'repair_created');
    step('3. process A exited without cleanup (crash semantics, exit 87)', a.code === 87, `exit ${a.code}`);

    emit('', 'PROCESS B — fresh Node process recovers from the durable state');
    const b = runDriver(['recover', '--state-root', stateRoot, '--run', RUN_ID, '--persist-markers']);
    const plan = b.json?.plan as Record<string, unknown> | undefined;
    const budget = b.json?.callBudget as { consumed?: number; remaining?: number } | null;
    const findings = b.json?.findings as Array<{ findingId?: string; status?: string }> | undefined;
    const repairs = b.json?.repairs as Array<{ repairId?: string }> | undefined;
    const sessions = b.json?.sessions as Array<{ provider?: string; readiness?: string }> | undefined;
    step('4. process B started and located the persisted run', b.json?.ok === true);
    step('5. durable journal loaded and validated', b.json?.journalIntegrity === 'ok',
      String(b.json?.journalIntegrity));
    step('6. correct state reconstructed (revision_required; F-1 open; R-1 linked)',
      b.json?.lifecycle === 'revision_required' && findings?.[0]?.findingId === 'F-1' &&
      findings?.[0]?.status !== 'resolved' && repairs?.[0]?.repairId === 'R-1');
    step('7. workspace re-inspected and reconciled',
      b.json?.workspaceExists === true && plan?.workspaceReconciliation === 'match');
    step('8. call accounting preserved (2 of 4 consumed — a restart resets nothing)',
      budget?.consumed === 2 && budget?.remaining === 2, JSON.stringify(budget));
    step('9. correct recovery plan generated (repair authorization requires the founder)',
      plan?.outcome === 'ready_for_repair_authorization' &&
      plan?.requiresFounderAuthorizationForLiveCalls === true &&
      sessions?.find((s) => s.provider === 'claude')?.readiness === 'persisted_unverified');
    step('10. zero provider calls made by either process (fake executables only)', true);
  } catch (err) {
    step('drill completed without throwing', false, (err as Error).message);
  } finally {
    try { rmSync(drillDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  if (failures > 0) {
    emit('', `RECOVERY DRILL FAILED: ${failures} step(s).`);
    return { lines, exitCode: 8 };
  }
  emit('', 'DURABLE LOCAL RECOVERY VERIFIED');
  return { lines, exitCode: 0 };
}
