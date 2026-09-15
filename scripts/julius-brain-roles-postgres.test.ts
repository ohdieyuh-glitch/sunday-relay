import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { paidRunArchive } from '../src/relay/mission/julius/julius-brain-archive-fixtures';
import { importJuliusPaidRunArchive } from '../src/relay/mission/julius/julius-brain-archive-import';
import { juliusPrincipal } from '../src/relay/mission/julius/julius-brain-contracts';
import { exportJuliusBrain } from '../src/relay/mission/julius/julius-brain-export';
import { PostgresJuliusBrainContentStore } from '../src/relay/persistence/julius-brain-content-postgres';
import { assertJuliusBrainDatabase, migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';
import { juliusBrainRoleGrants } from '../src/relay/persistence/julius-brain-roles';
import { JuliusPythonExecutionPostgresStore } from '../src/relay/persistence/julius-python-postgres';
import { NodeJuliusPythonRunner, discoverJuliusPythonExecutable, resolveJuliusPythonSdkRoot } from '../src/relay/workspace/julius-tools/python-runner';
import { FLOW, runBrainPythonMissionFlow, summariseBrainPythonFlow } from './julius-brain-python-flow';

/**
 * LEAST PRIVILEGE, PROVEN. The Brain service runs as a role that does not own
 * the schema: everything the Brain and Python stores do works, and nothing that
 * would rewrite history — including disabling the guard — is possible.
 * `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL` naming a server role that may
 * create databases and roles; todo otherwise. The mission flow part needs
 * CPython 3.11+.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const python = discoverJuliusPythonExecutable();
const sdkRoot = resolveJuliusPythonSdkRoot();

suite('Project Brain database roles', () => {
  it('the service role runs the whole Brain + Python flow, and cannot delete, rewrite, disable the guard, alter the schema or migrate', async () => {
    const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const database = `jbroles${suffix}`;
    const service = `jbsvc${suffix}`;
    const reader = `jbread${suffix}`;
    const secret = { service: randomUUID(), reader: randomUUID() };
    const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const urlFor = (user: string | null, credential: string | null) => {
      const url = new URL(process.env.DATABASE_URL!);
      url.pathname = `/${database}`;
      if (user !== null && credential !== null) { url.username = user; url.password = credential; }
      return url.toString();
    };
    await admin.query(`CREATE DATABASE ${database}`);
    const owner = new Pool({ connectionString: urlFor(null, null), max: 2 });
    try {
      await migrateJuliusBrainDatabase(owner, { environment: 'test' });
      await admin.query(`CREATE ROLE ${service} LOGIN PASSWORD '${secret.service}'`);
      await admin.query(`CREATE ROLE ${reader} LOGIN PASSWORD '${secret.reader}'`);
      for (const grant of juliusBrainRoleGrants({ database, service, reader })) await owner.query(grant);

      const svc = new Pool({ connectionString: urlFor(service, secret.service), max: 6 });
      try {
        expect((await assertJuliusBrainDatabase(svc, { environment: 'test' })).environment).toBe('test');
        const brains = new JuliusBrainPostgresStore(svc);
        const content = new PostgresJuliusBrainContentStore(svc);

        if (python !== null && sdkRoot !== null) {
          const executions = new JuliusPythonExecutionPostgresStore(svc);
          let tick = 0;
          const clock = { now: () => new Date(Date.parse('2026-09-15T08:00:00.000Z') + (tick++) * 1_000).toISOString() };
          const runner = new NodeJuliusPythonRunner({ sandboxRoot: mkdtempSync(join(tmpdir(), 'jbroles-sbx-')), sdkRoot, content });
          const ids = await runBrainPythonMissionFlow({ brains, executions, content, runner, python, clock, hostInstanceId: 'host-roles' });
          const summary = await summariseBrainPythonFlow({ brains, executions, content }, ids.executions);
          expect(summary.resume).toBe('VERIFIED');
          expect(summary.executions.map((row) => row.state)).toEqual(['SUCCEEDED', 'SUCCEEDED', 'SUCCEEDED']);
        }
        const imported = await importJuliusPaidRunArchive({ store: brains, brainId: FLOW.brainId, projectId: FLOW.projectId, archive: paidRunArchive(), content, recordedAt: '2026-09-15T09:00:00.000Z' });
        if (python === null) expect(imported.outcome).toBe('REFUSED'); // no Brain exists without the flow
        else expect(imported.outcome).toBe('IMPORTED');

        const denied = async (sql: string, message: RegExp) => expect(svc.query(sql)).rejects.toThrow(message);
        await denied('DELETE FROM julius_brain.records', /permission denied/);
        await denied('DELETE FROM julius_brain.entities', /permission denied/);
        await denied("UPDATE julius_brain.records SET kind='FINDING'", /permission denied/);
        await denied("UPDATE julius_brain.content SET byte_size=0", /permission denied/);
        await denied("UPDATE julius_brain.brains SET title='renamed'", /permission denied/);
        await denied('TRUNCATE julius_brain.records', /permission denied/);
        await denied('ALTER TABLE julius_brain.records DISABLE TRIGGER records_immutable', /must be owner/);
        await denied('CREATE TABLE julius_brain.shadow(x int)', /permission denied/);
        await denied("INSERT INTO julius_brain.schema_migrations(version) VALUES('099_forged')", /permission denied/);
        await denied("UPDATE julius_brain.database_identity SET environment='production'", /permission denied/);
        await expect(migrateJuliusBrainDatabase(svc, { environment: 'test' })).rejects.toThrow(/permission denied/);
        // What UPDATE it does hold on a Brain row is the head, and the guard still refuses a rollback.
        await denied('UPDATE julius_brain.brains SET head_sequence=0', /julius_brain_immutable|a Brain head never moves backwards/);
      } finally { await svc.end(); }

      const read = new Pool({ connectionString: urlFor(reader, secret.reader), max: 2 });
      try {
        const store = new JuliusBrainPostgresStore(read);
        if (python !== null) {
          const bundle = await exportJuliusBrain({ store, brainId: FLOW.brainId, projectId: FLOW.projectId, exportedBy: juliusPrincipal('JULIUS', 'julius'), exportedAt: '2026-09-15T10:00:00.000Z' });
          expect(bundle?.ledger.verified).toBe(true);
        }
        await expect(read.query("INSERT INTO julius_brain.projects(project_id) VALUES('prj-reader')")).rejects.toThrow(/permission denied/);
        await expect(read.query("UPDATE julius_brain.python_executions SET state='FAILED'")).rejects.toThrow(/permission denied/);
      } finally { await read.end(); }
    } finally {
      await owner.end();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${service}`).catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS ${reader}`).catch(() => undefined);
      await admin.end();
    }
  }, 300_000);
});
