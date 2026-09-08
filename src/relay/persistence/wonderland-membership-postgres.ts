import type { Pool } from 'pg';

import type { WonderlandMembership } from '../mission/wonderland/wonderland-authorization';

/**
 * THE CANONICAL MEMBERSHIP LOOKUP, AND NOTHING ELSE.
 *
 * `relay_wonderland.project_members(project_id, player_id, role)` has been the
 * membership record since migration 001. `julius-tool-postgres.ts` already
 * authorises tool execution against it in production, with an `EXISTS` subquery
 * joined through the run to its project. This is the same table, read the same
 * way, for the world routes.
 *
 * IT READS AND DECIDES NOTHING. The verdict lives in
 * `wonderland-authorization.ts`, which is pure and tested; a store that
 * answered yes-or-no would put an authorisation decision inside a database
 * adapter, where the next adapter would make it slightly differently.
 *
 * NULL IS AN ABSENT ROW. A failure to reach the database THROWS, and the route
 * turns that into a 503 rather than a denial — those are different facts, and a
 * lookup failure read as an absence is a denial where an operator's problem
 * belonged.
 *
 * NO ROLE FILTER IN THE QUERY, deliberately. The role comes back and the
 * capability table decides. Filtering here would mean a role the product starts
 * writing looks identical to no membership at all, and the operator log would
 * say `not_a_member` for somebody who plainly is one.
 */
export class WonderlandMembershipPostgres {
  constructor(private readonly pool: Pool) {}

  async lookup(input: {
    readonly playerId: string;
    readonly projectId: string;
  }): Promise<WonderlandMembership | null> {
    // Both identifiers are attacker-supplied — the project from a query string,
    // the player from a verified session — so both are parameters and neither
    // is interpolated. The pair is the primary key, so this reads at most one
    // row and cannot be widened by a crafted value.
    const result = await this.pool.query<{ role: string }>(
      `SELECT role FROM relay_wonderland.project_members WHERE project_id=$1 AND player_id=$2`,
      [input.projectId, input.playerId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return Object.freeze({
      projectId: input.projectId,
      playerId: input.playerId,
      role: row.role,
    });
  }
}

/**
 * Does this run belong to this project? Asked SEPARATELY and asked SECOND.
 *
 * The authorisation decides a project from the query; this confirms the run
 * belongs to that project. Never the reverse — resolving a project FROM a run
 * id would let somebody name a run they have no rights to, have the server
 * discover its project, and be authorised against the project they just caused
 * it to pick.
 *
 * The route already refuses a hydration whose run names another project, so
 * this is the same guarantee one layer earlier: with it, the reader never
 * returns the row at all.
 */
export class WonderlandRunScopePostgres {
  constructor(private readonly pool: Pool) {}

  async runBelongsToProject(input: {
    readonly runId: string;
    readonly projectId: string;
  }): Promise<boolean> {
    const result = await this.pool.query<{ ok: boolean }>(
      `SELECT true AS ok FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2`,
      [input.runId, input.projectId],
    );
    return result.rows[0]?.ok === true;
  }
}
