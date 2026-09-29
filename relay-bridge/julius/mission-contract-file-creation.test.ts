import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  compileBootstrapRequest,
  liveMissionFileCreationGrantFor,
  parseLiveMissionContract,
} from './mission-contract';

/**
 * THE MISSION CONTRACT GRANTS FILE CREATION -- OR, BY DEFAULT, DOES NOT.
 *
 * The grant is operator-authored, checked against the domain's own rules at
 * PARSE time (a malformed grant stops the mission before anything is paid for),
 * and absent from the parsed contract when absent from the file -- so every
 * contract written before it compiles to the binding digest it always had.
 */

const base = (over: Record<string, unknown> = {}) => JSON.stringify({
  missionId: 'mission:create-1', markerNamespace: 'julius-create-one', projectId: 'prj-1', tenantId: 't-1',
  objective: 'Add a settings page.', requirements: ['A new page component'], constraints: [],
  acceptanceCriteria: [{ id: 'AC-1', text: 'The page exists', blocking: true }],
  testCommand: '', workspacePath: '/workspace/mission',
  ...over,
});

const parsed = (raw: string) => {
  const result = parseLiveMissionContract(raw);
  if (!result.ok) throw new Error(result.problem);
  return result.contract;
};

describe('a contract with no creation grant is exactly the contract it was', () => {
  it('Mission 6 -- the pinned paid mission -- parses with NO creation grant, so its digest cannot have moved', () => {
    const raw = readFileSync(join(process.cwd(), '.github', 'julius-missions', 'julius-live-mission-6', 'contract.json'), 'utf8');
    const contract = parsed(raw);
    expect('fileCreation' in contract).toBe(false);
    expect(liveMissionFileCreationGrantFor(contract)(contract.missionId)).toBeNull();
  });

  it('an absent field is not spread, so the binding digest is the same with or without this change', () => {
    const without = parsed(base());
    expect(Object.keys(without)).not.toContain('fileCreation');
    const withGrant = parsed(base({ fileCreation: { permittedPaths: ['src'] } }));
    // CONTROL: a grant IS part of the digest -- granting creation is a different agreement.
    expect(compileBootstrapRequest(withGrant, [], 'card-1')).not.toEqual(compileBootstrapRequest(without, [], 'card-1'));
  });
});

describe('a creation grant is parsed, bound to its mission, and refused when malformed', () => {
  it('a valid grant is kept as written and answers only for its own mission', () => {
    const contract = parsed(base({ fileCreation: { permittedPaths: ['src/pages', 'tests'], maxBytes: 65536, mayOverwrite: false } }));
    expect(contract.fileCreation).toEqual({ permittedPaths: ['src/pages', 'tests'], maxBytes: 65536, mayOverwrite: false });
    const lookup = liveMissionFileCreationGrantFor(contract);
    expect(lookup('mission:create-1')).toEqual(contract.fileCreation);
    expect(lookup('mission:someone-else')).toBeNull();
  });

  it('refuses a malformed grant at parse time, naming what is wrong', () => {
    const cases: Array<[unknown, RegExp]> = [
      [null, /must be an object/u],
      [['src'], /must be an object/u],
      [{ permittedPaths: 'src' }, /permittedPaths/u],
      [{ permittedPaths: ['src'], anywhere: true }, /unknown field "anywhere"/u],
      [{ permittedPaths: ['src'], maxBytes: 0 }, /maxBytes/u],
      [{ permittedPaths: ['src'], maxBytes: 1.5 }, /maxBytes/u],
      [{ permittedPaths: ['src'], mayOverwrite: 'yes' }, /mayOverwrite/u],
      [{ permittedPaths: [] }, /names no path/u],
      [{ permittedPaths: ['../outside'] }, /refused/u],
      [{ permittedPaths: ['/etc'] }, /refused/u],
      [{ permittedPaths: ['.git'] }, /refused/u],
      [{ permittedPaths: ['.github/workflows'] }, /refused/u],
    ];
    for (const [grant, reason] of cases) {
      const result = parseLiveMissionContract(base({ fileCreation: grant }));
      expect(result.ok, JSON.stringify(grant)).toBe(false);
      if (!result.ok) expect(result.problem, JSON.stringify(grant)).toMatch(reason);
    }
  });
});
