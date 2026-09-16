import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

import { chainJuliusBrainAuditEvent, verifyJuliusBrainAuditChain, type JuliusBrainAuditEvent } from '../src/relay/mission/julius/julius-brain-access';
import { createJuliusBrainAuditAnchorer, verifyJuliusBrainAuditAgainstAnchors } from '../src/relay/mission/julius/julius-brain-audit-anchor';
import { createJuliusBrainAnchorFileSink } from '../src/relay/persistence/julius-brain-anchor-file';
import { JuliusBrainAccessPostgresState } from '../src/relay/persistence/julius-brain-access-postgres';
import { migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';

/**
 * THE ANCHOR AGAINST A REAL DATABASE AND A REAL FILE.
 *
 * The owner does what only an owner can — disables the immutability trigger,
 * rewrites a refusal, and rebuilds every hash after it — and the anchors kept
 * outside the database say so. `JULIUS_REAL_POSTGRES=1` with `DATABASE_URL`;
 * todo otherwise.
 */
const enabled = (process.env.JULIUS_REAL_INFRA === '1' || process.env.JULIUS_REAL_POSTGRES === '1') && (process.env.DATABASE_URL ?? '') !== '';
const suite = enabled ? describe : describe.todo;
const NOW = '2026-09-15T12:00:00.000Z';

suite('the audit anchor on a real PostgreSQL', () => {
  it('an owner who rewrites the audit and rebuilds its chain is exposed by the anchors; the file sink is append-only and refuses a forged line', async () => {
    const name = `jbanchor${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.pathname = `/${name}`;
    const owner = new Pool({ connectionString: url.toString(), max: 2 });
    const path = join(mkdtempSync(join(tmpdir(), 'jb-anchor-')), 'anchors.jsonl');
    try {
      await migrateJuliusBrainDatabase(owner, { environment: 'test' });
      const state = new JuliusBrainAccessPostgresState(owner);
      const sink = createJuliusBrainAnchorFileSink(path);
      let tick = 0;
      const anchorer = createJuliusBrainAuditAnchorer({
        environment: 'test', sink, clock: { now: () => new Date(Date.parse(NOW) + (tick += 1) * 1_000).toISOString() },
        auditHead: () => state.auditHead(), brainHead: async () => null,
      });

      for (const reasonCode of [null, 'other_run', null, 'state_mode_is_bound'] as const) {
        await state.appendAudit({ at: NOW, action: reasonCode === null ? 'CALL_ALLOWED' : 'CALL_REFUSED', sessionId: 'bsess:x', brainRunId: 'workflow:35000000000/1', call: 'READ_CONTEXT', reasonCode });
        expect((await anchorer.anchor()).outcome).toBe('ANCHORED');
      }
      const anchors = await sink.read();
      expect(anchors).toHaveLength(4);
      expect(await state.auditHead()).toMatchObject({ sequence: 4 });
      expect(verifyJuliusBrainAuditAgainstAnchors({ events: await state.readAudit(), anchors, environment: 'test' })).toMatchObject({ ok: true, verifiedThrough: 4 });
      // Anchors hold no mission content, no session token, no reason: only numbers and digests.
      expect(readFileSync(path, 'utf8')).not.toMatch(/bsess|READ_CONTEXT|other_run/);

      // The owner rewrites the second decision and rebuilds the chain after it.
      const before = await state.readAudit();
      const rebuilt: JuliusBrainAuditEvent[] = [];
      for (const event of before) {
        const edited = event.sequence === 2 ? { ...event, action: 'CALL_ALLOWED' as const, reasonCode: null } : event;
        rebuilt.push(chainJuliusBrainAuditEvent(rebuilt.at(-1) ?? null, edited));
      }
      await owner.query('ALTER TABLE julius_brain.access_audit DISABLE TRIGGER access_audit_immutable');
      for (const event of rebuilt) {
        await owner.query('UPDATE julius_brain.access_audit SET event = $2::jsonb, previous_hash = $3, hash = $4 WHERE sequence = $1', [event.sequence, JSON.stringify(event), event.previousHash, event.hash]);
      }
      await owner.query('ALTER TABLE julius_brain.access_audit ENABLE TRIGGER access_audit_immutable');

      // In the database it is a perfect chain. Against the anchors it is not.
      const after = await state.readAudit();
      expect(verifyJuliusBrainAuditChain(after).ok).toBe(true);
      const checked = verifyJuliusBrainAuditAgainstAnchors({ events: after, anchors, environment: 'test' });
      expect(checked.ok).toBe(false);
      expect(checked.problems[0]).toMatch(/audit 2: does not match the anchor/);

      // The sink is append-only in use, and a line that is not an anchor is refused rather than believed.
      const lines = readFileSync(path, 'utf8').trimEnd().split('\n');
      expect(lines).toHaveLength(4);
      writeFileSync(path, `${lines.join('\n')}\n{"format":"something-else"}\n`, 'utf8');
      await expect(sink.read()).rejects.toThrow(/julius_brain_anchor_file_line_invalid: line 5/);
    } finally {
      await owner.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => undefined);
      await admin.end();
    }
  }, 60_000);
});
