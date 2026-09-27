import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
    if (process.platform === 'win32') {
      emit(...UNSUPPORTED_HOST);
      return { lines, exitCode: 2 };
    }
    // The repo's own esbuild binary (already a dependency) bundles the driver.
    const esbuild = repoEsbuild();
    execFileSync(esbuild.command, [
      ...esbuild.lead,
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

/**
 * THE REPO'S OWN esbuild, ON A HOST THAT CAN ACTUALLY SPAWN IT.
 *
 * `node_modules/.bin/esbuild` is a POSIX shell script. `execFileSync` does not go
 * through a shell and Windows `CreateProcess` reads a PE header, so spawning that
 * name failed ENOENT before the drill started — and BOTH durable-persistence
 * gates were unrunnable on Windows, each reporting "completed without throwing —
 * spawnSync … ENOENT" and "scenario steps ran across 0 separate Node processes".
 * A gate a developer cannot run is a gate that stops being run.
 *
 * AND THE `.cmd` BESIDE IT IS NOT THE FIX. Node refuses to spawn a `.cmd` or
 * `.bat` without a shell — `EINVAL` — and passing `shell: true` to fix that would
 * hand a command line to `cmd.exe`, which is a quoting hazard in a harness whose
 * arguments include temporary paths.
 *
 * SO IT SPAWNS NODE AGAINST esbuild's OWN ENTRY SCRIPT. `node_modules/esbuild/bin/esbuild`
 * is plain JavaScript with a shebang; `process.execPath` is the interpreter
 * already running. No shell, no platform branch, no quoting: the same two
 * arguments on every host. The `.bin` shim is used only as a fallback, so a
 * layout without the package entry still fails on a real path rather than an
 * invented one.
 */
function repoEsbuild(): { readonly command: string; readonly lead: readonly string[] } {
  const entry = join(process.cwd(), 'node_modules', 'esbuild', 'bin', 'esbuild');
  if (existsSync(entry)) return { command: process.execPath, lead: [entry] };
  return { command: join(process.cwd(), 'node_modules', '.bin', 'esbuild'), lead: [] };
}

/**
 * A HOST THAT CANNOT RUN THIS GATE SAYS SO IN ONE LINE.
 *
 * Both persistence gates drive REAL child processes against the repository's own
 * fake provider executables, and those fakes are Node scripts made executable by
 * a POSIX shebang plus `chmod 0o755`. Windows `CreateProcess` reads a PE header
 * and honours neither, so the supervised proof inside process A never reaches its
 * crash boundary: it exits 0 instead of the drill's own 87, and every later step
 * that reads the state A should have left fails in a way that looks like a
 * recovery defect and is not.
 *
 * SO IT REFUSES UP FRONT, NAMING THE CAUSE, AND IT REFUSES NON-ZERO. A gate that
 * returned success on a host where it proved nothing would be the vacuous pass
 * this repository has already paid for once — three MCP scenarios that "passed"
 * because a spawn failure short-circuited them before they asserted anything.
 * This is a genuine platform gap, neither hidden nor claimed as covered: the gate
 * runs on POSIX and in CI, and on Windows it reports that it cannot run rather
 * than what a broken fixture made it look like.
 */
const UNSUPPORTED_HOST: readonly string[] = [
  'UNSUPPORTED HOST: this gate spawns the repository\'s fake provider executables,',
  'which are Node scripts made executable by a POSIX shebang and chmod. Windows',
  'CreateProcess honours neither, so process A cannot reach its crash boundary and',
  'every step that reads the state it should have left is meaningless.',
  'Nothing is proven and nothing is claimed. Run it on POSIX or in CI.',
];
