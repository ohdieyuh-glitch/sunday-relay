import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_AUTHORIZATION_DECISION_FIELDS,
  WONDERLAND_DENIAL_MESSAGE,
  WONDERLAND_PROJECT_CAPABILITIES,
  WONDERLAND_ROLE_CAPABILITIES,
  WONDERLAND_UNAVAILABLE_MESSAGE,
  authorizeWonderlandProjectCapability,
} from './wonderland-authorization';
import type { WonderlandMembership } from './wonderland-authorization';

const PLAYER = 'player-1';
const PROJECT = 'project-alpha';
const CAP = 'read_world_state' as const;

const ask = (
  membership: WonderlandMembership | null,
  over: Partial<Parameters<typeof authorizeWonderlandProjectCapability>[0]> = {},
) =>
  authorizeWonderlandProjectCapability(
    { playerId: PLAYER, projectId: PROJECT, capability: CAP, ...over },
    membership,
  );

const owner: WonderlandMembership = { projectId: PROJECT, playerId: PLAYER, role: 'OWNER' };

/* ------------------------------------------------- the canonical authority */

describe('this reuses the product’s membership record and holds none of its own', () => {
  it('grants an OWNER, which is the only role the product writes', () => {
    const decision = ask(owner);
    expect(decision.granted).toBe(true);
    expect(decision.verdict).toBe('granted');
  });

  it('names OWNER because that is what the seed and the schema use', () => {
    // `mission-seed.ts` inserts OWNER; `julius-tool-postgres.ts` authorises
    // against the same table. If the product's written role ever changes, this
    // fails rather than silently granting nothing.
    const seed = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'relay-bridge', 'julius', 'mission-seed.ts'),
      'utf8',
    );
    expect(seed).toContain('project_members');
    for (const role of Object.keys(WONDERLAND_ROLE_CAPABILITIES)) {
      expect(seed).toContain(`'${role}'`);
    }
  });

  it('stores no membership of its own', () => {
    // A second membership model would be a second answer to "who may see
    // this", and the two would diverge the day somebody was removed from one.
    const source = readFileSync(join(__dirname, 'wonderland-authorization.ts'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(code).not.toMatch(/\bnew Map\b|\bnew Set\b|\[\]\s*;/);
    expect(code).not.toContain('SELECT');
  });
});

/* ----------------------------------------------------------- fail closed */

describe('nothing is granted by default, ever', () => {
  it('denies a player with no row', () => {
    const decision = ask(null);
    expect(decision.granted).toBe(false);
    expect(decision.verdict).toBe('not_a_member');
  });

  it('denies a role this build does not recognise', () => {
    // The column has no CHECK constraint. A role the product starts writing
    // before this table learns about it grants NOTHING — an allow-list that
    // defaulted open would hand every future role every capability the day it
    // was inserted, before anybody decided what it was for.
    for (const role of ['VIEWER', 'GUEST', 'EDITOR', 'DEVELOPER', 'REVIEWER', 'admin', '']) {
      const decision = ask({ ...owner, role });
      expect(decision.granted, `role ${role} must grant nothing`).toBe(false);
      expect(decision.verdict).toBe('unrecognised_role');
    }
  });

  it('denies a known role that lacks the capability asked for', () => {
    // UNREACHABLE TODAY — one capability exists and the one role carries it —
    // and an untested branch in an authorisation function is exactly the kind
    // that is wrong the first time it matters. So the table is injected rather
    // than mutated: the canonical one is frozen, and unfreezing it to make a
    // test pass would be removing a guard to exercise a guard.
    const decision = authorizeWonderlandProjectCapability(
      { playerId: PLAYER, projectId: PROJECT, capability: CAP },
      owner,
      Object.freeze({ OWNER: Object.freeze([]) }),
    );
    expect(decision.granted).toBe(false);
    expect(decision.verdict).toBe('role_lacks_capability');
  });

  it('keeps the canonical role table frozen', () => {
    // The reason the test above injects instead of mutating.
    expect(Object.isFrozen(WONDERLAND_ROLE_CAPABILITIES)).toBe(true);
    expect(() => {
      (WONDERLAND_ROLE_CAPABILITIES as Record<string, readonly string[]>).VIEWER = ['x' as never];
    }).toThrow();
  });

  it('denies a record that answers a different question', () => {
    // A caller that looked up the wrong row, or a store returning a near-miss,
    // would otherwise have its mistake read as an authorisation.
    expect(ask({ ...owner, playerId: 'player-2' }).verdict).toBe('record_mismatch');
    expect(ask({ ...owner, projectId: 'project-beta' }).verdict).toBe('record_mismatch');
  });

  it('denies a malformed question before consulting anything', () => {
    for (const over of [
      { playerId: '' },
      { projectId: '   ' },
      { capability: 'delete_everything' as never },
    ]) {
      const decision = ask(owner, over);
      expect(decision.granted).toBe(false);
      expect(decision.verdict).toBe('malformed_request');
    }
  });

  it('treats every verdict but granted as a denial', () => {
    const denials = [
      ask(null),
      ask({ ...owner, role: 'VIEWER' }),
      ask({ ...owner, playerId: 'other' }),
      ask(owner, { playerId: '' }),
    ];
    for (const decision of denials) expect(decision.granted).toBe(false);
  });
});

/* ------------------------------------------------------ non-disclosure */

describe('a denied caller learns one thing', () => {
  it('has one denial sentence, whatever the reason', () => {
    // Telling an unauthorised person that a project EXISTS but they lack a
    // role, versus that it does not exist, is a membership oracle: query ids
    // until the refusal changes shape and the tenant list falls out.
    expect(WONDERLAND_DENIAL_MESSAGE).toBe('permission denied');
    expect(WONDERLAND_DENIAL_MESSAGE.toLowerCase()).not.toContain('member');
    expect(WONDERLAND_DENIAL_MESSAGE.toLowerCase()).not.toContain('role');
    expect(WONDERLAND_DENIAL_MESSAGE.toLowerCase()).not.toContain('project');
  });

  it('keeps the operator’s detail off the denial sentence', () => {
    // The detail exists and is useful; it belongs in a log, not a body.
    for (const decision of [ask(null), ask({ ...owner, role: 'VIEWER' })]) {
      expect(decision.detail.length).toBeGreaterThan(10);
      expect(WONDERLAND_DENIAL_MESSAGE).not.toContain(decision.verdict);
    }
  });

  it('says UNAVAILABLE differently from DENIED, and neither reads as the other', () => {
    // An unanswerable authority is not a denial: the request may have been
    // perfectly authorised and the deployment could not check.
    expect(WONDERLAND_UNAVAILABLE_MESSAGE).not.toBe(WONDERLAND_DENIAL_MESSAGE);
    expect(WONDERLAND_UNAVAILABLE_MESSAGE.toLowerCase()).not.toContain('permission');
    expect(WONDERLAND_UNAVAILABLE_MESSAGE.toLowerCase()).not.toContain('denied');
  });

  it('carries no project or player in either public sentence', () => {
    for (const message of [WONDERLAND_DENIAL_MESSAGE, WONDERLAND_UNAVAILABLE_MESSAGE]) {
      expect(message).not.toContain(PROJECT);
      expect(message).not.toContain(PLAYER);
    }
  });
});

describe('the shape', () => {
  it('names every field it carries', () => {
    expect(Object.keys(ask(owner)).sort()).toEqual(
      [...WONDERLAND_AUTHORIZATION_DECISION_FIELDS].sort(),
    );
  });

  it('echoes the question so a log line reads alone', () => {
    const decision = ask(null);
    expect(decision.playerId).toBe(PLAYER);
    expect(decision.projectId).toBe(PROJECT);
    expect(decision.capability).toBe(CAP);
  });

  it('declares exactly the capabilities the role table can grant', () => {
    const granted = new Set(Object.values(WONDERLAND_ROLE_CAPABILITIES).flat());
    for (const capability of granted) {
      expect(WONDERLAND_PROJECT_CAPABILITIES).toContain(capability);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ask(owner))).toBe(true);
    expect(Object.isFrozen(WONDERLAND_ROLE_CAPABILITIES)).toBe(true);
  });
});
