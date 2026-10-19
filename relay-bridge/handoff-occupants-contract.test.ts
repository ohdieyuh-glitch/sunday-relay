import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MISSION_DISPATCHABLE_OCCUPANTS } from './role-slot-config';
import { ROLE_OCCUPANTS } from '../src/relay/mission/role-slots';

/**
 * THE FOUNDER'S OCCUPANT TABLE, PINNED TO THE CODE.
 *
 * `docs/relay/FOUNDER_TESTING_HANDOFF.md` carries a table of every occupant and
 * whether a mission can dispatch it. It is the table a founder reads to decide
 * which agent to name, and it drifted twice today in opposite directions:
 *
 *   `hermes_remote_service` was listed as **not wired** long after the mission
 *   began dispatching on the resolved transport, so a correctly configured
 *   remote Reviewer looked impossible.
 *
 *   `openai_reviewer` was MISSING ENTIRELY — registered, dispatchable, the one
 *   Reviewer that needs nothing deployed, and absent from the list of what can
 *   hold the role.
 *
 * The first was a false claim and reading caught it. The second was an
 * omission, and reading never would: there is no sentence to check. Both are
 * mechanical, so both are checked here rather than re-read.
 */

const HANDOFF = readFileSync(
  join(process.cwd(), 'docs/relay/FOUNDER_TESTING_HANDOFF.md'),
  'utf8',
);

/** Rows of the occupants table: role, id, and the dispatch verdict. */
const rows = HANDOFF.split('\n')
  .map((line) => /^\|\s*(\w+)\s*\|\s*`([a-z0-9_]+)`\s*\|.*\|\s*(\*{0,2}(?:yes|no)\b.*?)\s*\|$/i.exec(line))
  .filter((m): m is RegExpExecArray => m !== null)
  .map((m) => ({
    role: m[1],
    occupantId: m[2],
    dispatchable: /^\*{0,2}yes\b/i.test(m[3]),
  }));

describe('the handoff occupant table matches the registry', () => {
  it('parses the table at all, so nothing below passes on an empty list', () => {
    // The failure this guards: a table reformat silently empties `rows` and
    // every assertion becomes vacuously true.
    expect(rows.length).toBeGreaterThanOrEqual(ROLE_OCCUPANTS.length);
  });

  it('lists every registered occupant', () => {
    const listed = new Set(rows.map((r) => r.occupantId));
    for (const occupant of ROLE_OCCUPANTS) {
      expect(listed, `${occupant.occupantId} is registered and absent from the founder's table`)
        .toContain(occupant.occupantId);
    }
  });

  it('invents no occupant the registry does not have', () => {
    const registered = new Set(ROLE_OCCUPANTS.map((o) => o.occupantId));
    for (const row of rows) {
      expect(registered, `${row.occupantId} is in the founder's table and not registered`)
        .toContain(row.occupantId);
    }
  });

  it('agrees with the dispatchable set, row by row', () => {
    // The drift that told a founder a working Reviewer could not be driven.
    for (const row of rows) {
      expect(
        row.dispatchable,
        `${row.occupantId}: the table says ${row.dispatchable ? 'yes' : 'no'} and the code says the opposite`,
      ).toBe(MISSION_DISPATCHABLE_OCCUPANTS.has(row.occupantId));
    }
  });

  it('names the role each occupant actually holds', () => {
    for (const row of rows) {
      const occupant = ROLE_OCCUPANTS.find((o) => o.occupantId === row.occupantId);
      if (occupant === undefined) continue;
      expect(row.role, `${row.occupantId} is listed under the wrong role`).toBe(occupant.role);
    }
  });
});
