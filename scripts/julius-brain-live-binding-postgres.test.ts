import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { createLiveJuliusProjectBrainBinding, type JuliusLiveBrainReport } from '../relay-bridge/julius/project-brain-binding';
import { juliusPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { createJuliusProjectBrainService } from '../src/relay/mission/julius/julius-brain-service';
import type { JuliusBrainAppend } from '../src/relay/mission/julius/julius-runtime-ports';
import { readJuliusLegacyBrainAppends } from '../src/relay/persistence/julius-brain-legacy-postgres';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusReadPostgresRepository } from '../src/relay/persistence/julius-read-postgres';
import { PROJECT, RUN, TASK, seedBase } from './julius-sibling-support';

/**
 * THE PREPARED LIVE BINDING AGAINST THE LIVE v1 REPOSITORIES, ON A REAL
 * POSTGRESQL. The mirror sees appends on their way into `julius_brain_entries`;
 * the backfill reads the rows back. Only a real table shows whether the two
 * agree. `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL`; todo otherwise.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const clock = { now: () => new Date().toISOString() };

async function freshDatabase(): Promise<string> {
  const name = `jbbind${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try { await admin.query(`CREATE DATABASE ${name}`); } finally { await admin.end(); }
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

function bind(pool: Pool, reports: JuliusLiveBrainReport[]) {
  return createLiveJuliusProjectBrainBinding({
    store: new JuliusBrainPostgresStore(pool), clock, projectId: PROJECT, title: 'Julius',
    runs: new JuliusPostgresRepository(pool),
    legacyEntries: (runId, projectId) => readJuliusLegacyBrainAppends(pool, runId, projectId),
    onReport: (report) => reports.push(report),
  });
}

suite('the prepared live Project Brain binding on a real PostgreSQL', () => {
  it('mirror, backfill, typed context and checkpoint agree across the real v1 table and a cold connection', async () => {
    const url = await freshDatabase();
    const reports: JuliusLiveBrainReport[] = [];
    const pool = new Pool({ connectionString: url, max: 4 });
    try {
      await seedBase(pool);
      // What the bootstrap seed does: a v1 row written with SQL, past the writer port.
      await pool.query(
        `INSERT INTO relay_wonderland.julius_brain_entries(entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
         VALUES('seed:constraint',$1,$2,NULL,'julius','CONSTRAINT','Edit only the trust core file','[]',1,now())`, [RUN, PROJECT]);
      await pool.query('UPDATE relay_wonderland.julius_runs SET project_brain_revision=1 WHERE run_id=$1', [RUN]);

      const binding = bind(pool, reports);
      expect(await binding.bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: true });
      expect(reports.at(-1)).toMatchObject({ event: 'BOOTSTRAPPED', mirrored: 1, refused: 0 });

      // Through the live repository: a domain kind the table stores as another, microseconds and an offset the table does not keep.
      const writer = binding.wrapWriter(new JuliusPostgresRepository(pool));
      const objective: JuliusBrainAppend = {
        runId: RUN, projectId: PROJECT, taskId: TASK, workerId: 'julius', entryId: 'brain:objective:1', kind: 'OBJECTIVE',
        safeText: 'Implement the trust core', evidenceIds: [], occurredAt: '2026-09-15T14:00:00.123456+02:00',
      };
      expect(await writer.appendBrainEntry(objective)).toBe(true);
      expect(reports.at(-1)).toMatchObject({ event: 'MIRROR', v1Written: true, outcome: 'MIRRORED' });
      const rows = await readJuliusLegacyBrainAppends(pool, RUN, PROJECT);
      expect(rows.map((row) => [row.entryId, row.kind])).toEqual([['seed:constraint', 'CONSTRAINT'], ['brain:objective:1', 'CONSTRAINT']]);

      const handle = (await createJuliusProjectBrainService({ store: new JuliusBrainPostgresStore(pool), clock }).open({ brainId: binding.brainId, projectId: PROJECT, principal: juliusPrincipal('JULIUS', 'julius') }))!;
      const requirement = await handle.create('REQUIREMENT', { requirementClass: 'FUNCTIONAL', statement: 'Every admission is evidenced', priority: 'MUST', status: 'ACTIVE' }, { key: 'req', scope: { missionId: 'mission' } });
      expect(requirement.outcome).toBe('COMMITTED');
      expect(await binding.checkpoint('drive ended COMPLETED')).toBe('COMMITTED');
    } finally { await pool.end(); }

    // A restarted process.
    const cold = new Pool({ connectionString: url, max: 2 });
    try {
      const binding = bind(cold, reports);
      expect(await binding.bootstrap({ runId: RUN })).toEqual({ outcome: 'READY', created: false });
      expect(reports.at(-1)).toMatchObject({ event: 'BOOTSTRAPPED', mirrored: 0, duplicates: 2, refused: 0 });

      const reader = new JuliusReadPostgresRepository(cold);
      const v1 = await reader.brainEntriesForRun(RUN, PROJECT);
      const entries = await binding.wrapContextReader(reader).brainEntriesForRun(RUN, PROJECT);
      expect(entries.slice(0, v1.length)).toEqual(v1);
      const typed = entries.slice(v1.length);
      expect(typed).toHaveLength(3);
      expect(typed.every((entry) => entry.entryId.startsWith('brain2:') && !entry.entryId.includes('legacy:'))).toBe(true);
      expect(reports.filter((report) => report.event === 'CONTEXT').map((report) => report.event === 'CONTEXT' && [report.mode, report.withheld])).toEqual(Array(3).fill(['FRESH', null]));
    } finally { await cold.end(); }
  }, 180_000);
});
