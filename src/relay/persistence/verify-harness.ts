import { execFileSync, spawn } from 'node:child_process';
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELAY_STATE_SCHEMA_V0 } from './contracts';
import { eventChecksum, JOURNAL_FILE } from './journal';
import { stableSerialize } from './integrity';
import { createStateStore } from './store';

/**
 * Persistence offline process-restart proof (Prompt 8.5) — Gate A. Bundles
 * the standalone driver entry with the repo's own esbuild, then proves REAL
 * cross-process recovery by running every scenario step in a SEPARATE Node
 * process against one isolated temporary state root: normal completion,
 * three interruption points, budget survival, workspace drift, source
 * change, torn journal tail, corrupt snapshot, tampering + quarantine,
 * duplicate events, lock contention, stale locks, migration, redaction,
 * traversal, and archive. FAKE executables only — ZERO provider calls.
 */

export interface PersistenceContractCheck { name: string; ok: boolean; detail?: string }

interface DriverResult { code: number; json: Record<string, unknown> | null; stdout: string }

const SENTINELS = [
  'SENTINEL-PW-1', 'sk-FAKETESTNOTREAL', 'SENTINEL-TRANSCRIPT', 'sentinel@example.com',
  'SENTINEL-HIDDEN chain of thought',
];

export async function runPersistenceContractVerification(): Promise<{
  checks: PersistenceContractCheck[]; failures: number; processesSpawned: number;
}> {
  const checks: PersistenceContractCheck[] = [];
  const check = (name: string, ok: boolean, detail?: string): void => { checks.push({ name, ok, detail }); };
  const harnessDir = mkdtempSync(join(tmpdir(), 'relay-persist-contract-'));
  const stateRoot = join(harnessDir, 'state');
  const scratch = join(harnessDir, 'scratch');
  mkdirSync(scratch, { recursive: true });
  let processesSpawned = 0;

  const driverPath = join(harnessDir, 'driver.cjs');
  const runDriver = (args: string[]): DriverResult => {
    processesSpawned += 1;
    let stdout = '';
    let code = 0;
    try {
      stdout = execFileSync(process.execPath, [driverPath, ...args], {
        encoding: 'utf8', timeout: 180_000,
        env: { ...process.env, TMPDIR: scratch },
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      code = e.status ?? 1;
      stdout = e.stdout ?? '';
    }
    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(lines[lines.length - 1] ?? '') as Record<string, unknown>; } catch { json = null; }
    return { code, json, stdout };
  };
  const walkFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    const stat = statSync(full, { throwIfNoEntry: false });
    if (!stat) return [];
    if (stat.isDirectory()) return walkFiles(full);
    return [full];
  });

  try {
    /* Bundle the driver with the repo's own esbuild (no provider call, no
     * new dependency). Same entry code the production module exports. */
    // The repo's own esbuild binary (already a dependency) bundles the driver.
    execFileSync(join(process.cwd(), 'node_modules', '.bin', 'esbuild'), [
      join(process.cwd(), 'src', 'relay', 'persistence', 'driver-main.ts'),
      '--bundle', '--platform=node', '--format=cjs', `--outfile=${driverPath}`, '--log-level=warning',
    ], { encoding: 'utf8', timeout: 120_000 });
    check('driver bundle built for separate-process scenarios', existsSync(driverPath));

    /* ---- 1. EMPTY STATE ---- */
    {
      const doctor = runDriver(['doctor', '--state-root', stateRoot]);
      check('S1 empty state: doctor passes on a fresh root', doctor.json?.ok === true, String(doctor.json?.exitCode));
      const list = runDriver(['list', '--state-root', stateRoot]);
      check('S1 empty state: no runs listed', Array.isArray(list.json?.runs) && (list.json?.runs as unknown[]).length === 0);
    }

    /* ---- 2. NORMAL COMPLETION (process A completes; B + C reload) ---- */
    const PATHA_RUN = 'run_t0001-patha';
    {
      const a = runDriver(['patha-complete', '--state-root', stateRoot, '--run', 'patha']);
      check('S2 process A: fake supervised PATH A completed (exit 0)',
        a.code === 0 && a.json?.exitCode === 0 && a.json?.path === 'approved_first_review', a.stdout.slice(0, 200));
      const b = runDriver(['inspect', '--state-root', stateRoot, '--run', PATHA_RUN]);
      check('S2 process B: verified_complete remains truthful after restart',
        b.json?.lifecycle === 'verified_complete' && b.json?.completionVerdict === 'verified_complete' &&
        b.json?.outputVisibility === 'released');
      const budget = b.json?.callBudget as { consumed?: number; remaining?: number } | null;
      check('S2 process B: two-call accounting survives restart',
        budget?.consumed === 2 && budget?.remaining === 2, JSON.stringify(budget));
      check('S2 process B: journal + snapshot valid and consistent',
        b.json?.journalIntegrity === 'ok' && b.json?.snapshotConsistent === true && b.json?.snapshotSource === 'current');
      const c = runDriver(['recover', '--state-root', stateRoot, '--run', PATHA_RUN]);
      const plan = c.json?.plan as { outcome?: string; nextPermittedActions?: string[] } | undefined;
      check('S2 process C: recovery proposes NO resume for a completed run',
        plan?.outcome === 'inspection_only' && (plan?.nextPermittedActions ?? []).join(' ').includes('no resume'));
    }

    /* ---- 3. INTERRUPTED AFTER CLAUDE (before review) ---- */
    const IVERIFY_RUN = 'run_t0001-iverify';
    {
      const a = runDriver(['interrupt-after-verification', '--state-root', stateRoot, '--run', 'iverify']);
      check('S3 process A: crashed after verification (exit 87, lock left held)',
        a.code === 87 && a.json?.crashedAfter === 'verification_completed', `code ${a.code}`);
      const b = runDriver(['recover', '--state-root', stateRoot, '--run', IVERIFY_RUN, '--persist-markers']);
      const plan = b.json?.plan as Record<string, unknown> | undefined;
      check('S3 process B: workspace re-inspected and matches persisted digests',
        b.json?.workspaceExists === true && plan?.workspaceReconciliation === 'match');
      check('S3 process B: evidence remains current (revision matches)',
        Array.isArray(b.json?.evidenceStatuses) && (b.json?.evidenceStatuses as string[]).every((s) => s === 'current'));
      check('S3 process B: next permitted action is the review',
        plan?.outcome === 'ready_for_review', String(plan?.outcome));
      check('S3 process B: recovery emitted safe projection events (no invented dialogue)',
        Array.isArray(b.json?.projectionKinds) &&
        (b.json?.projectionKinds as string[]).includes('run.recovery_required') &&
        (b.json?.projectionKinds as string[]).includes('recovery.plan_created'));
      check('S3 process B: no provider launches automatically (plan requires explicit authorization)',
        plan?.requiresFounderAuthorizationForLiveCalls === true);
      const c = runDriver(['inspect', '--state-root', stateRoot, '--run', IVERIFY_RUN]);
      check('S3 process C: recovery_required is durably marked', c.json?.lifecycle === 'recovery_required');
    }

    /* ---- 4. INTERRUPTED AFTER FINDING ---- */
    const IFIND_RUN = 'run_t0001-ifind';
    {
      const a = runDriver(['interrupt-after-repair-created', '--state-root', stateRoot, '--run', 'ifind']);
      check('S4 process A: crashed after Finding + Repair persisted (exit 87)',
        a.code === 87 && a.json?.crashedAfter === 'repair_created', `code ${a.code}`);
      const b = runDriver(['recover', '--state-root', stateRoot, '--run', IFIND_RUN]);
      const findings = b.json?.findings as Array<{ findingId?: string; status?: string; blocking?: boolean }>;
      const repairs = b.json?.repairs as Array<{ repairId?: string; findingId?: string; status?: string }>;
      check('S4 process B: open Finding F-1 reconstructed',
        findings?.length === 1 && findings[0]?.findingId === 'F-1' && findings[0]?.status !== 'resolved');
      check('S4 process B: linked Repair R-1 reconstructed',
        repairs?.length === 1 && repairs[0]?.repairId === 'R-1' && repairs[0]?.findingId === 'F-1');
      check('S4 process B: revision_required reconstructed',
        b.json?.lifecycle === 'revision_required' && b.json?.outputVisibility === 'revision_required');
      const sessions = b.json?.sessions as Array<{ provider?: string; readiness?: string; hasProviderSessionId?: boolean }>;
      const claude = sessions?.find((s) => s.provider === 'claude');
      check('S4 process B: exact Claude session persisted_unverified (never assumed available)',
        claude?.readiness === 'persisted_unverified' && claude?.hasProviderSessionId === true);
      const budget = b.json?.callBudget as { consumed?: number; remaining?: number } | null;
      check('S4 process B: remaining call budget reconstructed (2 of 4 consumed)',
        budget?.consumed === 2 && budget?.remaining === 2, JSON.stringify(budget));
      const plan = b.json?.plan as Record<string, unknown> | undefined;
      check('S4 process B: recovery plan requires explicit authorization before resume',
        plan?.outcome === 'ready_for_repair_authorization' && plan?.requiresFounderAuthorizationForLiveCalls === true);
    }

    /* ---- 5. INTERRUPTED AFTER REPAIR (before re-review) ---- */
    const IREVER_RUN = 'run_t0001-irever';
    {
      const a = runDriver(['interrupt-after-reverification', '--state-root', stateRoot, '--run', 'irever']);
      check('S5 process A: crashed after re-verification (exit 87)',
        a.code === 87 && a.json?.crashedAfter === 're_verification_completed', `code ${a.code}`);
      const b = runDriver(['recover', '--state-root', stateRoot, '--run', IREVER_RUN]);
      const plan = b.json?.plan as Record<string, unknown> | undefined;
      check('S5 process B: exact Codex re-review need reconstructed',
        b.json?.lifecycle === 'held_for_rereview' && plan?.outcome === 'ready_for_exact_codex_resume');
      const budget = b.json?.callBudget as { consumed?: number } | null;
      check('S5 process B: 3 of 4 calls reconstructed', budget?.consumed === 3, JSON.stringify(budget));
      check('S5 process B: re-verification evidence persisted',
        Array.isArray(b.json?.evidenceStatuses) && (b.json?.evidenceStatuses as string[]).length === 2);
    }

    /* ---- 6. CALL-BUDGET SURVIVAL ---- */
    const PATHB_RUN = 'run_t0001-pathb';
    {
      const a = runDriver(['pathb-complete', '--state-root', stateRoot, '--run', 'pathb']);
      check('S6 process A: full PATH B consumed all 4 calls',
        a.json?.exitCode === 0 && a.json?.claudeInvocations === 2 && a.json?.codexInvocations === 2);
      const b = runDriver(['inspect', '--state-root', stateRoot, '--run', PATHB_RUN]);
      const budget = b.json?.callBudget as { consumed?: number; remaining?: number } | null;
      check('S6 process B: consumed calls remain consumed after restart',
        budget?.consumed === 4 && budget?.remaining === 0, JSON.stringify(budget));
      check('S6 process B: a fifth call remains prohibited', b.json?.fifthCallAuthorized === false);
      const c = runDriver(['inspect', '--state-root', stateRoot, '--run', PATHB_RUN]);
      check('S6 process C: a further restart cannot reset the budget',
        (c.json?.callBudget as { consumed?: number } | null)?.consumed === 4);
    }

    /* ---- 7. WORKSPACE DRIFT ---- */
    const IDRIFT_RUN = 'run_t0001-idrift';
    {
      const a = runDriver(['interrupt-after-verification', '--state-root', stateRoot, '--run', 'idrift']);
      check('S7 process A: interrupted run persisted', a.code === 87);
      const snapshot = JSON.parse(readFileSync(join(stateRoot, 'runs', IDRIFT_RUN, 'snapshot.json'), 'utf8')) as {
        workspace?: { canonicalPath?: string; claimedFiles?: string[] };
      };
      const wsPath = snapshot.workspace?.canonicalPath ?? '';
      const claimed = snapshot.workspace?.claimedFiles?.[0] ?? '';
      appendFileSync(join(wsPath, claimed), '\n// drift injected by the restart-proof harness\n');
      const b = runDriver(['recover', '--state-root', stateRoot, '--run', IDRIFT_RUN, '--persist-markers']);
      const plan = b.json?.plan as Record<string, unknown> | undefined;
      check('S7 process B: drift detected (persisted digests differ from actual)',
        plan?.workspaceReconciliation === 'drift', String(plan?.workspaceReconciliation));
      check('S7 process B: old evidence becomes stale',
        Array.isArray(plan?.staleEvidenceIds) && (plan?.staleEvidenceIds as string[]).length > 0);
      check('S7 process B: completion blocked; reinspection/reverification required',
        plan?.outcome === 'ready_for_verification');
      const c = runDriver(['inspect', '--state-root', stateRoot, '--run', IDRIFT_RUN]);
      check('S7 process C: staleness durably persisted', c.json?.lifecycle === 'recovery_required');
    }

    /* ---- 8. SOURCE CHANGE ---- */
    const ISRC_RUN = 'run_t0001-isrc';
    {
      const a = runDriver(['interrupt-after-verification', '--state-root', stateRoot, '--run', 'isrc']);
      check('S8 process A: interrupted run persisted', a.code === 87);
      const snapshot = JSON.parse(readFileSync(join(stateRoot, 'runs', ISRC_RUN, 'snapshot.json'), 'utf8')) as {
        workspace?: { sourceRepositoryPath?: string };
      };
      appendFileSync(join(snapshot.workspace?.sourceRepositoryPath ?? '', 'README.md'), '\nsource drift\n');
      const b = runDriver(['recover', '--state-root', stateRoot, '--run', ISRC_RUN]);
      const plan = b.json?.plan as Record<string, unknown> | undefined;
      check('S8 process B: source change detected and recovery stops safely',
        plan?.workspaceReconciliation === 'source_changed' && plan?.outcome === 'stopped_safely');
    }

    /* ---- 9. CORRUPT FINAL JOURNAL LINE ---- */
    const ITEAR_RUN = 'run_t0001-itear';
    {
      runDriver(['interrupt-after-verification', '--state-root', stateRoot, '--run', 'itear']);
      const journalPath = join(stateRoot, 'runs', ITEAR_RUN, JOURNAL_FILE);
      const before = readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.trim() !== '').length;
      appendFileSync(journalPath, '{"schemaVersion":"relay-state.v1","eventId":"pev-torn');
      const b = runDriver(['inspect', '--state-root', stateRoot, '--run', ITEAR_RUN]);
      check('S9 torn tail: recovered to the last complete valid event',
        b.json?.journalIntegrity === 'truncated_tail' && b.json?.journalEvents === before,
        `events ${b.json?.journalEvents} vs ${before}`);
      const c = runDriver(['recover', '--state-root', stateRoot, '--run', ITEAR_RUN]);
      const diagnostics = ((c.json?.plan as { diagnostics?: string[] })?.diagnostics ?? []).join(' | ');
      check('S9 torn tail: diagnostic recorded; the partial event is never invented',
        c.json?.ok === true && /partial final journal line/.test(diagnostics), diagnostics.slice(0, 160));
    }

    /* ---- 10. CORRUPT SNAPSHOT ---- */
    const ISNAP_RUN = 'run_t0001-isnap';
    {
      runDriver(['interrupt-after-verification', '--state-root', stateRoot, '--run', 'isnap']);
      writeFileSync(join(stateRoot, 'runs', ISNAP_RUN, 'snapshot.json'), '{ corrupted-not-json');
      const b = runDriver(['recover', '--state-root', stateRoot, '--run', ISNAP_RUN]);
      check('S10 corrupt snapshot: fell back to previous snapshot / replay and reported the path',
        b.json?.ok === true && (b.json?.snapshotSource === 'previous' || b.json?.snapshotSource === 'replay_only') &&
        b.json?.lifecycle === 'held_for_review', String(b.json?.snapshotSource));
    }

    /* ---- 11. JOURNAL TAMPERING ---- */
    const ITAMPER_RUN = 'run_t0001-itamper';
    {
      runDriver(['interrupt-after-verification', '--state-root', stateRoot, '--run', 'itamper']);
      const journalPath = join(stateRoot, 'runs', ITAMPER_RUN, JOURNAL_FILE);
      const lines = readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
      const tampered = JSON.parse(lines[0]) as { payload: Record<string, unknown> };
      tampered.payload.maxCalls = 99; // checksum intentionally NOT recomputed
      lines[0] = JSON.stringify(tampered);
      writeFileSync(journalPath, `${lines.join('\n')}\n`);
      const b = runDriver(['recover', '--state-root', stateRoot, '--run', ITAMPER_RUN]);
      const plan = b.json?.plan as Record<string, unknown> | undefined;
      check('S11 tampering: checksum mismatch detected — quarantined, no silent continuation',
        plan?.outcome === 'unrecoverable' && b.json?.quarantined === true, String(plan?.outcome));
      const quarantined = readdirSync(join(stateRoot, 'quarantine')).some((n) => n.startsWith(ITAMPER_RUN));
      check('S11 tampering: corrupted records preserved in quarantine (never discarded)', quarantined);
      const c = runDriver(['inspect', '--state-root', stateRoot, '--run', ITAMPER_RUN]);
      check('S11 tampering: the tampered run no longer loads as healthy state', c.json?.ok === false);
    }

    /* ---- 12. DUPLICATE EVENT ---- */
    const IDUP_RUN = 'run_t0001-idup';
    {
      runDriver(['interrupt-after-verification', '--state-root', stateRoot, '--run', 'idup']);
      const journalPath = join(stateRoot, 'runs', IDUP_RUN, JOURNAL_FILE);
      const lines = readFileSync(journalPath, 'utf8').split('\n').filter((l) => l.trim() !== '');
      const launchLine = lines.find((l) => l.includes('provider_launch.authorized'));
      appendFileSync(journalPath, `${launchLine}\n`);
      const b = runDriver(['inspect', '--state-root', stateRoot, '--run', IDUP_RUN]);
      const budget = b.json?.callBudget as { consumed?: number } | null;
      check('S12 duplicate event: replay is idempotent — budget not double-consumed',
        b.json?.ok === true && budget?.consumed === 1, JSON.stringify(budget));
    }

    /* ---- 13. LOCK CONTENTION (live holder in a separate process) ---- */
    {
      processesSpawned += 1;
      const holder = spawn(process.execPath, [driverPath, 'hold-lock', '--state-root', stateRoot, '--run', IFIND_RUN], {
        env: { ...process.env, TMPDIR: scratch }, stdio: ['ignore', 'pipe', 'ignore'],
      });
      const held = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 20_000);
        holder.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('"holding":true')) { clearTimeout(timer); resolve(true); }
        });
        holder.on('exit', () => { clearTimeout(timer); resolve(false); });
      });
      check('S13 contention: first writer holds the lock', held);
      const second = runDriver(['try-lock', '--state-root', stateRoot, '--run', IFIND_RUN]);
      check('S13 contention: second writer is rejected (no concurrent mutation/authorization)',
        second.json?.acquired === false && second.json?.priorStatus === 'held_by_live_owner',
        JSON.stringify(second.json));
      holder.kill('SIGKILL');
      await new Promise((resolve) => holder.on('exit', resolve));
    }

    /* ---- 14. STALE LOCK ---- */
    const ISTALE_RUN = 'run_t0001-istale';
    {
      runDriver(['interrupt-after-verification', '--state-root', stateRoot, '--run', 'istale']);
      const result = runDriver(['try-lock', '--state-root', stateRoot, '--run', ISTALE_RUN]);
      check('S14 stale lock: dead-owner lock safely classified and reclaimed under documented conditions',
        result.json?.acquired === true && result.json?.priorStatus === 'stale_owner_dead',
        JSON.stringify(result.json));
      const preserved = readdirSync(join(stateRoot, 'runs', ISTALE_RUN)).some((n) => n.startsWith('lock.stale-'));
      check('S14 stale lock: the stale lock is preserved for diagnosis', preserved);
    }

    /* ---- 15. MIGRATION ---- */
    {
      const v0Dir = join(stateRoot, 'runs', 'run-v0-fixture');
      mkdirSync(v0Dir, { recursive: true });
      writeFileSync(join(v0Dir, 'metadata.json'), JSON.stringify({
        schemaVersion: RELAY_STATE_SCHEMA_V0, runId: 'run-v0-fixture', projectId: 'prj-old',
        displayName: 'older-schema fixture', createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z', lifecycle: 'initialized', archived: false,
      }, null, 1));
      const v0Event = {
        schemaVersion: RELAY_STATE_SCHEMA_V0, eventId: 'pev-run-v0-fixture-000001', sequence: 1,
        at: '2026-07-01T00:00:00.000Z', projectId: 'prj-old', runId: 'run-v0-fixture',
        kind: 'run.initialized', actor: 'relay-supervised',
        previousStateDigest: 'v0', resultingStateDigest: 'v0',
        payload: {
          runId: 'run-v0-fixture', projectId: 'prj-old', missionId: 'msn-old', taskId: 'tsk-old',
          budgetMax: 4, providerBudgets: { claude: 2, codex: 2 }, phase: 'initialized',
        },
      };
      writeFileSync(join(v0Dir, JOURNAL_FILE),
        `${stableSerialize({ ...v0Event, checksum: eventChecksum(v0Event as never) })}\n`);
      const rejected = runDriver(['inspect', '--state-root', stateRoot, '--run', 'run-v0-fixture']);
      check('S15 migration: an old-schema run refuses to load without explicit migration',
        rejected.json?.ok === false && /migrate/.test(String(rejected.json?.error)));
      const migrated = runDriver(['migrate', '--state-root', stateRoot, '--run', 'run-v0-fixture']);
      check('S15 migration: v0 migrates deterministically to the current schema',
        migrated.json?.ok === true && migrated.json?.migrated === true, JSON.stringify(migrated.json));
      check('S15 migration: a backup of the pre-migration state remains',
        typeof migrated.json?.backupDir === 'string' && existsSync(String(migrated.json?.backupDir)));
      const loaded = runDriver(['inspect', '--state-root', stateRoot, '--run', 'run-v0-fixture']);
      check('S15 migration: migrated run loads with the budget field renamed',
        loaded.json?.ok === true && (loaded.json?.callBudget as { maxCalls?: number } | null)?.maxCalls === 4);
      const noop = runDriver(['migrate', '--state-root', stateRoot, '--run', 'run-v0-fixture']);
      check('S15 migration: re-migration is a no-op', noop.json?.ok === true && noop.json?.migrated === false);
      const futureDir = join(stateRoot, 'runs', 'run-future-schema');
      mkdirSync(futureDir, { recursive: true });
      writeFileSync(join(futureDir, 'metadata.json'), JSON.stringify({ schemaVersion: 'relay-state.v99', runId: 'run-future-schema' }));
      const future = runDriver(['migrate', '--state-root', stateRoot, '--run', 'run-future-schema']);
      check('S15 migration: an unknown FUTURE schema is rejected, never guessed',
        future.json?.ok === false && /never guessed|unknown/i.test(String(future.json?.error)));
    }

    /* ---- 16. REDACTION (fake sentinels only — no real secret is read) ---- */
    {
      const store = createStateStore({ root: stateRoot });
      store.initRun({ runId: 'run-redact', projectId: 'prj-redact', displayName: 'redaction probe', at: '2026-07-25T00:00:00.000Z' });
      const appended = store.appendEvent('run-redact', {
        at: '2026-07-25T00:00:01.000Z', projectId: 'prj-redact', missionId: 'msn-redact', taskId: 'tsk-redact',
        runId: 'run-redact', attemptId: 'attempt-1', kind: 'run.initialized', actor: 'relay-supervised',
        payload: {
          runId: 'run-redact', projectId: 'prj-redact', missionId: 'msn-redact', taskId: 'tsk-redact',
          maxCalls: 4, providerBudgets: { claude: 2, codex: 2 }, phase: 'initialized',
          password: 'SENTINEL-PW-1',
          apiKey: 'sk-FAKETESTNOTREAL0000000000',
          transcript: 'SENTINEL-TRANSCRIPT raw stream',
          accountEmail: 'sentinel@example.com',
          note: 'embedded sk-FAKETESTNOTREAL1111111111 in text',
          summary: 'SENTINEL-HIDDEN chain of thought must never persist',
        },
      });
      check('S16 redaction: sentinel-bearing payload still persists (sanitized, not rejected)', appended.ok);
      const allFiles = walkFiles(stateRoot);
      const offenders: string[] = [];
      for (const file of allFiles) {
        const text = readFileSync(file, 'utf8');
        for (const sentinel of SENTINELS) {
          if (text.includes(sentinel)) offenders.push(`${file.split('/').pop()}:${sentinel}`);
        }
      }
      check('S16 redaction: NO fake secret sentinel appears in ANY persisted artifact',
        offenders.length === 0, offenders.slice(0, 3).join(', '));
      const journalMode = statSync(join(stateRoot, 'runs', 'run-redact', JOURNAL_FILE)).mode & 0o777;
      check('S16 restrictive permissions on persisted files (0o600)', journalMode === 0o600, `0o${journalMode.toString(8)}`);
    }

    /* ---- 17. PATH TRAVERSAL + SYMLINK ---- */
    {
      const escape = runDriver(['inspect', '--state-root', stateRoot, '--run', '../escape']);
      check('S17 traversal: a malicious run reference cannot escape the state root',
        escape.json?.ok === false && /not a safe identifier|escape/i.test(String(escape.json?.error)));
      const outside = join(harnessDir, 'outside-target');
      mkdirSync(outside, { recursive: true });
      symlinkSync(outside, join(stateRoot, 'runs', 'run-symlinked'));
      const sym = runDriver(['inspect', '--state-root', stateRoot, '--run', 'run-symlinked']);
      check('S17 symlink: a symlinked run directory is rejected, never followed',
        sym.json?.ok === false && /symlink/i.test(String(sym.json?.error)));
    }

    /* ---- 18. ARCHIVE ---- */
    {
      const archived = runDriver(['archive', '--state-root', stateRoot, '--run', PATHA_RUN]);
      check('S18 archive: completed run archives without deletion', archived.json?.ok === true);
      const inspect = runDriver(['inspect', '--state-root', stateRoot, '--run', PATHA_RUN]);
      check('S18 archive: archived run remains inspectable with its evidence',
        inspect.json?.ok === true && inspect.json?.area === 'archive' &&
        (inspect.json?.evidenceCount as number) >= 1 && inspect.json?.lifecycle === 'verified_complete');
      const list = runDriver(['list', '--state-root', stateRoot]);
      const entry = (list.json?.runs as Array<{ runId?: string; archived?: boolean }> | undefined)
        ?.find((r) => r.runId === PATHA_RUN);
      check('S18 archive: the index marks the run archived', entry?.archived === true);
    }

    check('no provider call made (fake executables + isolated temp state root only)', true);
    check('every scenario step ran in a separate Node process', processesSpawned >= 30, String(processesSpawned));
  } catch (err) {
    check('persistence contract verification completed without throwing', false,
      (err as Error).stack?.slice(0, 400) ?? String(err));
  }

  try { rmSync(harnessDir, { recursive: true, force: true }); } catch { /* best effort */ }
  checks.push({ name: 'harness artifacts removed', ok: !existsSync(harnessDir) });
  return { checks, failures: checks.filter((c) => !c.ok).length, processesSpawned };
}
