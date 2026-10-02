import { describe, expect, it, vi } from 'vitest';

import type { Pool } from 'pg';

import {
  WonderlandMembershipPostgres,
  WonderlandRunScopePostgres,
} from './wonderland-membership-postgres';
import { authorizeWonderlandProjectCapability } from '../mission/wonderland/wonderland-authorization';

/**
 * THE MEMBERSHIP LOOKUP.
 *
 * These tests hold two properties a database adapter is uniquely able to
 * break: that both attacker-supplied identifiers are PARAMETERS rather than
 * interpolated text, and that a store which cannot answer throws rather than
 * reporting an absence — because an absence is a denial and a failure is not.
 */

const pool = (rows: unknown[], onQuery?: (sql: string, params: unknown[]) => void): Pool =>
  ({
    query: vi.fn(async (sql: string, params: unknown[]) => {
      onQuery?.(sql, params);
      return { rows };
    }),
  }) as unknown as Pool;

describe('the canonical membership row', () => {
  it('returns the role the table holds', async () => {
    const store = new WonderlandMembershipPostgres(pool([{ role: 'OWNER' }]));
    const membership = await store.lookup({ playerId: 'player-1', projectId: 'project-alpha' });
    expect(membership).toEqual({
      playerId: 'player-1',
      projectId: 'project-alpha',
      role: 'OWNER',
    });
  });

  it('returns null for a player with no row', async () => {
    const store = new WonderlandMembershipPostgres(pool([]));
    expect(await store.lookup({ playerId: 'player-1', projectId: 'project-alpha' })).toBeNull();
  });

  it('passes both identifiers as parameters and interpolates neither', async () => {
    // The project arrives from a query string and the player from a verified
    // session. Interpolating either would be an injection on the one table
    // that decides who sees what.
    let sql = '';
    let params: unknown[] = [];
    const store = new WonderlandMembershipPostgres(
      pool([{ role: 'OWNER' }], (s, p) => {
        sql = s;
        params = p;
      }),
    );
    const nasty = "x' OR '1'='1";
    await store.lookup({ playerId: nasty, projectId: nasty });
    expect(sql).toContain('$1');
    expect(sql).toContain('$2');
    expect(sql).not.toContain(nasty);
    expect(params).toEqual([nasty, nasty]);
  });

  it('reads the canonical table and no other', async () => {
    let sql = '';
    const store = new WonderlandMembershipPostgres(pool([], (s) => { sql = s; }));
    await store.lookup({ playerId: 'p', projectId: 'q' });
    expect(sql).toContain('relay_wonderland.project_members');
  });

  it('does not filter by role, so an unknown role is not silence', async () => {
    // Filtering here would make a role the product starts writing look
    // identical to no membership at all, and the operator log would say
    // `not_a_member` for somebody who plainly is one.
    let sql = '';
    const store = new WonderlandMembershipPostgres(pool([{ role: 'VIEWER' }], (s) => { sql = s; }));
    const membership = await store.lookup({ playerId: 'p', projectId: 'q' });
    expect(sql.toUpperCase()).not.toContain("ROLE=");
    expect(membership?.role).toBe('VIEWER');

    // And the DECISION, made elsewhere, still denies it.
    const decision = authorizeWonderlandProjectCapability(
      { playerId: 'p', projectId: 'q', capability: 'read_world_state' },
      membership,
    );
    expect(decision.granted).toBe(false);
    expect(decision.verdict).toBe('unrecognised_role');
  });

  it('throws when the database cannot answer, rather than reporting an absence', async () => {
    // A failure read as an absence is a denial where a 503 belonged.
    const broken = {
      query: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    } as unknown as Pool;
    await expect(
      new WonderlandMembershipPostgres(broken).lookup({ playerId: 'p', projectId: 'q' }),
    ).rejects.toThrow(/connection refused/);
  });
});

describe('the run scope check', () => {
  it('confirms a run belongs to the authorised project', async () => {
    const store = new WonderlandRunScopePostgres(pool([{ ok: true }]));
    expect(await store.runBelongsToProject({ runId: 'run-1', projectId: 'p' })).toBe(true);
  });

  it('refuses a run that is not in the project', async () => {
    const store = new WonderlandRunScopePostgres(pool([]));
    expect(await store.runBelongsToProject({ runId: 'run-1', projectId: 'p' })).toBe(false);
  });

  it('asks whether the run is IN the project, never which project it is in', async () => {
    // Resolving a project FROM a run id would let somebody name a run they
    // have no rights to, have the server discover its project, and be
    // authorised against the project they just caused it to pick.
    let sql = '';
    let params: unknown[] = [];
    const store = new WonderlandRunScopePostgres(
      pool([{ ok: true }], (s, p) => {
        sql = s;
        params = p;
      }),
    );
    await store.runBelongsToProject({ runId: 'run-1', projectId: 'project-alpha' });
    expect(sql).toContain('project_id=$2');
    expect(params).toEqual(['run-1', 'project-alpha']);
    // It never SELECTs the project column, so there is nothing to resolve from.
    expect(sql).not.toMatch(/SELECT[^F]*project_id/i);
  });
});
