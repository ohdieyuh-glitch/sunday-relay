import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_EXECUTION_PROFILE_SCHEMA_V1,
  WONDERLAND_PLAYER_CRITERION_FIELDS,
  WONDERLAND_PLAYER_MISSION_FIELDS,
  composeTrustedMissionContract,
  parseExecutionProfile,
  parsePlayerMissionFields,
} from './wonderland-execution-profile';
import type { WonderlandExecutionProfile } from './wonderland-execution-profile';

/**
 * FOUNDER DECISION 4: "PLAYERS MUST NEVER AUTHOR THOSE VALUES DIRECTLY."
 *
 * The operator's half of a contract lives in a profile; the player's half is
 * four fields; the server composes them and Julius's own parser is the gate.
 * Every refusal has a control beside it that the same input with the one thing
 * under test put right is accepted.
 */

const PROJECT = 'prj-alpha';
const SUFFIX = 'a1b2c3d4e5f6';

const operatorBody = (over: Record<string, unknown> = {}) => ({
  tenantId: 'tenant-alpha',
  enabled: true,
  markerNamespacePrefix: 'wl-alpha',
  workspacePath: '/srv/julius/workspaces/alpha',
  testCommand: 'npm test',
  limits: { spendUsd: 2.5, repairCycles: 1, architectMaxOutputTokens: 4000 },
  research: null,
  ...over,
});

const playerBody = (over: Record<string, unknown> = {}) => ({
  objective: 'Add a dark mode toggle to the settings page.',
  requirements: ['The toggle persists across reloads.'],
  constraints: ['Do not change the colour tokens.'],
  acceptanceCriteria: [{ id: 'toggle-works', text: 'Toggling switches the theme.', blocking: true }],
  ...over,
});

const profile = (over: Record<string, unknown> = {}): WonderlandExecutionProfile => {
  const parsed = parseExecutionProfile(PROJECT, operatorBody(over));
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.value;
};

const fields = (over: Record<string, unknown> = {}) => {
  const parsed = parsePlayerMissionFields(playerBody(over));
  if (!parsed.ok) throw new Error(parsed.problem);
  return parsed.value;
};

describe('the operator\'s profile', () => {
  it('accepts a complete profile, taking the project from the PATH', () => {
    const parsed = parseExecutionProfile(PROJECT, operatorBody());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toMatchObject({
        schemaVersion: WONDERLAND_EXECUTION_PROFILE_SCHEMA_V1, projectId: PROJECT, tenantId: 'tenant-alpha', enabled: true,
        limits: { spendUsd: 2.5, repairCycles: 1, architectMaxOutputTokens: 4000 }, research: null,
      });
    }
  });

  it('refuses an unknown key by name -- a typo must not silently default -- and a project in the body is one', () => {
    for (const [key, value] of [['spendUSD', 3], ['projectId', 'prj-other'], ['missionId', 'm']] as const) {
      const parsed = parseExecutionProfile(PROJECT, { ...operatorBody(), [key]: value });
      expect(parsed.ok, key).toBe(false);
      if (!parsed.ok) expect(parsed.problem).toContain(key);
    }
  });

  it('refuses a workspace that is relative, climbs, or carries a control character', () => {
    for (const workspacePath of ['srv/julius', '/srv/julius/../../etc', 'C:\\ws\\..\\x', '/srv/ju\nlius', '']) {
      expect(parseExecutionProfile(PROJECT, operatorBody({ workspacePath })).ok, JSON.stringify(workspacePath)).toBe(false);
    }
    // CONTROL: absolute paths on either kind of executor.
    for (const workspacePath of ['/srv/julius/ws', 'C:\\julius\\ws', 'D:/julius/ws']) {
      expect(parseExecutionProfile(PROJECT, operatorBody({ workspacePath })).ok, workspacePath).toBe(true);
    }
  });

  it('refuses limits that are not real ceilings', () => {
    for (const limits of [
      { spendUsd: 0, repairCycles: 1, architectMaxOutputTokens: 10 },
      { spendUsd: -1, repairCycles: 1, architectMaxOutputTokens: 10 },
      { spendUsd: Number.NaN, repairCycles: 1, architectMaxOutputTokens: 10 },
      { spendUsd: 1, repairCycles: 1.5, architectMaxOutputTokens: 10 },
      { spendUsd: 1, repairCycles: 1, architectMaxOutputTokens: 0 },
      { spendUsd: 1, repairCycles: 1 },
    ]) {
      expect(parseExecutionProfile(PROJECT, operatorBody({ limits })).ok, JSON.stringify(limits)).toBe(false);
    }
  });

  it('refuses an "enabled" that is not the operator\'s explicit true or false', () => {
    for (const enabled of [undefined, 'true', 1, null]) {
      expect(parseExecutionProfile(PROJECT, operatorBody({ enabled })).ok, String(enabled)).toBe(false);
    }
    expect(parseExecutionProfile(PROJECT, operatorBody({ enabled: false })).ok).toBe(true);
  });

  it('refuses a namespace prefix Julius could not count under', () => {
    for (const markerNamespacePrefix of ['Wl-Alpha', '1wl', 'w', 'wl_alpha', 'wl-alpha-far-too-long-for-any-namespace']) {
      expect(parseExecutionProfile(PROJECT, operatorBody({ markerNamespacePrefix })).ok, markerNamespacePrefix).toBe(false);
    }
  });

  it('refuses, when WRITTEN, a research clause Julius would refuse when a mission is composed', () => {
    const parsed = parseExecutionProfile(PROJECT, operatorBody({ research: { roles: ['NOT_A_ROLE'], allowances: [], missionBudget: { maxRetrievals: 1 }, roleBudget: { maxRetrievals: 1 } } }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problem).toMatch(/research/);
  });
});

describe('the player\'s four fields, and nothing else of theirs', () => {
  it('accepts exactly objective, requirements, constraints and acceptance criteria', () => {
    expect(WONDERLAND_PLAYER_MISSION_FIELDS).toEqual(['objective', 'requirements', 'constraints', 'acceptanceCriteria']);
    expect(parsePlayerMissionFields(playerBody()).ok).toBe(true);
  });

  it('REFUSES every operator field a player might send, and names each one', () => {
    const smuggled = {
      workspacePath: '/', testCommand: 'rm -rf /', limits: { spendUsd: 9999 }, missionId: 'mission:mine',
      markerNamespace: 'julius-first-live', tenantId: 't', projectId: 'p', research: {},
    };
    const parsed = parsePlayerMissionFields({ ...playerBody(), ...smuggled });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.kind).toBe('forbidden_field');
      expect([...(parsed.forbidden ?? [])].sort()).toEqual(Object.keys(smuggled).sort());
    }
  });

  it('REFUSES a key inside a criterion beyond id, text and blocking -- the evidence standard is the operator\'s -- and names it', () => {
    expect(WONDERLAND_PLAYER_CRITERION_FIELDS).toEqual(['id', 'text', 'blocking']);
    const parsed = parsePlayerMissionFields(playerBody({ acceptanceCriteria: [
      { id: 'a', text: 'one', blocking: true },
      { id: 'b', text: 'two', blocking: true, requiredEvidence: ['DIFF'], weight: 3 },
    ] }));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.kind).toBe('forbidden_field');
      expect(parsed.forbidden).toEqual(['acceptanceCriteria[1].requiredEvidence', 'acceptanceCriteria[1].weight']);
    }
    // Named alongside a top-level smuggle, never instead of it.
    const both = parsePlayerMissionFields({
      ...playerBody({ acceptanceCriteria: [{ id: 'a', text: 'one', blocking: true, requiredEvidence: ['TEST'] }] }), testCommand: '',
    });
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.forbidden).toEqual(['testCommand', 'acceptanceCriteria[0].requiredEvidence']);
  });

  it('refuses a mission with no way to tell it is done, and duplicate criterion ids', () => {
    expect(parsePlayerMissionFields(playerBody({ acceptanceCriteria: [] })).ok).toBe(false);
    expect(parsePlayerMissionFields(playerBody({ acceptanceCriteria: [
      { id: 'a', text: 'one', blocking: true }, { id: 'a', text: 'two', blocking: false },
    ] })).ok).toBe(false);
    expect(parsePlayerMissionFields(playerBody({ objective: '   ' })).ok).toBe(false);
  });
});

describe('the composed contract: the player\'s words, the operator\'s everything else, the server\'s identity', () => {
  it('takes every execution-sensitive value from the profile and every word from the player', () => {
    const composed = composeTrustedMissionContract(profile(), fields(), SUFFIX);
    expect(composed.ok).toBe(true);
    if (!composed.ok) return;
    expect(composed.value).toMatchObject({
      missionId: `mission:wl-${SUFFIX}`,
      markerNamespace: `wl-alpha-${SUFFIX}`,
      projectId: PROJECT,
      tenantId: 'tenant-alpha',
      workspacePath: '/srv/julius/workspaces/alpha',
      testCommand: 'npm test',
      limits: { spendUsd: 2.5, repairCycles: 1, architectMaxOutputTokens: 4000 },
      objective: 'Add a dark mode toggle to the settings page.',
      requirements: ['The toggle persists across reloads.'],
      constraints: ['Do not change the colour tokens.'],
    });
    expect(composed.value.research).toBeUndefined();
  });

  it('two missions get two identities, and never the player\'s text as one', () => {
    const a = composeTrustedMissionContract(profile(), fields(), 'aaaaaaaaaaaa');
    const b = composeTrustedMissionContract(profile(), fields(), 'bbbbbbbbbbbb');
    expect(a.ok && b.ok && a.value.missionId !== b.value.missionId && a.value.markerNamespace !== b.value.markerNamespace).toBe(true);
    for (const bad of ['', 'ABCDEF123456', 'mission:mine', '0123456789abc']) {
      expect(composeTrustedMissionContract(profile(), fields(), bad).ok, bad).toBe(false);
    }
  });

  it('what Julius\'s own parser refuses is refused, in its words', () => {
    // A profile carrying an empty workspace cannot be written, so reach the parser through a hand-built profile.
    const broken = { ...profile(), workspacePath: '' } as WonderlandExecutionProfile;
    const composed = composeTrustedMissionContract(broken, fields(), SUFFIX);
    expect(composed.ok).toBe(false);
    if (!composed.ok) expect(composed.problem).toContain('workspacePath');
  });
});
