import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { juliusPathLocation } from '../mission/julius/julius-workspace-paths';
import {
  authorizeAgent,
  authorizeHuman,
  wfsCloneGrantWithin,
  wfsGlobCovered,
  wfsGlobMatches,
  wfsIsAgentProtected,
  wfsIssuerStillCovers,
  wfsMergeNeedsApproval,
  type WfsGrant,
} from './index';

/** T-ISOLATION's pure half (§8, §9.1): who may act, under what, and that every refusal looks the same from outside. */

const NOW = '2026-10-11T03:00:00.000Z';

function grant(over: Partial<WfsGrant> = {}): WfsGrant {
  return {
    grantId: 'grant-1',
    projectId: 'prj-1',
    principalId: 'julius-7',
    principalKind: 'julius',
    issuedBy: { kind: 'human', userId: 'ghu-1' },
    branches: 'own',
    ops: ['read', 'write', 'delete', 'move', 'merge'],
    paths: ['src/**'],
    expiresAtIso: '2026-10-11T04:00:00.000Z',
    revokedAtIso: null,
    ...over,
  };
}

function agentRequest(over: Partial<Parameters<typeof authorizeAgent>[0]> = {}): Parameters<typeof authorizeAgent>[0] {
  return {
    grant: grant(),
    principalId: 'julius-7',
    projectId: 'prj-1',
    nowIso: NOW,
    action: 'write',
    branchIsMain: false,
    branchOwnedByPrincipal: true,
    paths: ['src/main.cpp'],
    issuerNow: { kind: 'human', role: 'owner', createMission: true },
    ...over,
  };
}

function refusedUniformly(r: ReturnType<typeof authorizeAgent>): void {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('allowed');
  // §9.1: the caller sees ONE answer for every refusal; the reason is only in details (the server's own log).
  expect(r.error.code).toBe('not-found');
  expect(r.error.message).toBe('Not found.');
}

describe('WonderFS authorization: humans (§8.2)', () => {
  it('lets an owner and an editor write, and a viewer only read', () => {
    expect(authorizeHuman({ role: 'owner', action: 'manage_project', paths: [] }).ok).toBe(true);
    expect(authorizeHuman({ role: 'editor', action: 'write', paths: ['a.txt'] }).ok).toBe(true);
    expect(authorizeHuman({ role: 'viewer', action: 'read', paths: ['a.txt'] }).ok).toBe(true);
    refusedUniformly(authorizeHuman({ role: 'viewer', action: 'write', paths: ['a.txt'] }));
    refusedUniformly(authorizeHuman({ role: 'editor', action: 'manage_project', paths: [] }));
  });

  it('answers "no role" exactly as it answers "no such project"', () => {
    refusedUniformly(authorizeHuman({ role: null, action: 'read', paths: [] }));
  });

  it('refuses every write into the server\'s reserved namespace, even to an owner', () => {
    refusedUniformly(authorizeHuman({ role: 'owner', action: 'write', paths: ['.wonderfs/state.json'] }));
    refusedUniformly(authorizeHuman({ role: 'owner', action: 'move', paths: ['a.txt', '.WONDERFS/a.txt'] }));
  });
});

describe('WonderFS authorization: agents under grants (§8.3)', () => {
  it('allows an agent inside its grant', () => {
    expect(authorizeAgent(agentRequest()).ok).toBe(true);
    expect(authorizeAgent(agentRequest({ action: 'read', paths: ['src/deep/x.h'] })).ok).toBe(true);
  });

  it('refuses with no grant, an expired grant, or a revoked grant (checked on every use)', () => {
    refusedUniformly(authorizeAgent(agentRequest({ grant: null })));
    refusedUniformly(authorizeAgent(agentRequest({ grant: grant({ expiresAtIso: NOW }) })));
    refusedUniformly(authorizeAgent(agentRequest({ grant: grant({ revokedAtIso: '2026-10-11T02:59:59.000Z' }) })));
    expect(authorizeAgent(agentRequest({ grant: grant({ revokedAtIso: '2026-10-11T03:00:01.000Z' }) })).ok).toBe(true);
  });

  it('refuses a grant presented for another project or by another principal', () => {
    refusedUniformly(authorizeAgent(agentRequest({ projectId: 'prj-2' })));
    refusedUniformly(authorizeAgent(agentRequest({ principalId: 'julius-8' })));
  });

  it('refuses an operation the grant does not name', () => {
    refusedUniformly(authorizeAgent(agentRequest({ grant: grant({ ops: ['read'] }), action: 'write' })));
    refusedUniformly(authorizeAgent(agentRequest({ action: 'issue_grant' })));
  });

  it('keeps an agent on its own branch unless main is granted', () => {
    refusedUniformly(authorizeAgent(agentRequest({ branchOwnedByPrincipal: false })));
    refusedUniformly(authorizeAgent(agentRequest({ branchIsMain: true, branchOwnedByPrincipal: false })));
    expect(authorizeAgent(agentRequest({ grant: grant({ branches: 'main_and_own' }), branchIsMain: true, branchOwnedByPrincipal: false })).ok).toBe(true);
  });

  it('refuses a path outside the grant, in any case spelling, and a malformed path', () => {
    refusedUniformly(authorizeAgent(agentRequest({ paths: ['docs/readme.md'] })));
    refusedUniformly(authorizeAgent(agentRequest({ paths: ['src/ok.cpp', 'secrets/key.txt'] })));
    refusedUniformly(authorizeAgent(agentRequest({ paths: ['src/../secrets/key.txt'] })));
    expect(authorizeAgent(agentRequest({ paths: ['SRC/Main.cpp'] })).ok).toBe(true);
  });

  it('refuses the reserved namespace whatever the grant says', () => {
    refusedUniformly(authorizeAgent(agentRequest({ grant: grant({ paths: ['**'] }), paths: ['.wonderfs/x'] })));
  });
});

describe('WonderFS authorization: globs', () => {
  it('matches `*` within one name and `**` across folders, case-insensitively', () => {
    expect(wfsGlobMatches('src/*.cpp', 'src/main.cpp')).toBe(true);
    expect(wfsGlobMatches('src/*.cpp', 'src/deep/main.cpp')).toBe(false);
    expect(wfsGlobMatches('src/**', 'src/deep/main.cpp')).toBe(true);
    expect(wfsGlobMatches('src/**/x.h', 'src/x.h')).toBe(true);
    expect(wfsGlobMatches('src/**/x.h', 'src/a/b/x.h')).toBe(true);
    expect(wfsGlobMatches('**', 'anything/at/all.txt')).toBe(true);
    expect(wfsGlobMatches('src/*.cpp', 'SRC/MAIN.CPP')).toBe(true);
  });

  it('treats every regex metacharacter in a glob as a literal', () => {
    expect(wfsGlobMatches('a.b', 'aXb')).toBe(false);
    expect(wfsGlobMatches('a+(b)', 'a+(b)')).toBe(true);
    expect(wfsGlobMatches('a$', 'a$')).toBe(true);
  });

  it('matches nothing with a malformed glob', () => {
    expect(wfsGlobMatches('', 'a')).toBe(false);
    expect(wfsGlobMatches('/src/**', 'src/a')).toBe(false);
    expect(wfsGlobMatches('src/../**', 'secrets/a')).toBe(false);
  });

  it('covers a child glob only conservatively', () => {
    expect(wfsGlobCovered('src/game/**', ['src/**'])).toBe(true);
    expect(wfsGlobCovered('src/a.cpp', ['**'])).toBe(true);
    expect(wfsGlobCovered('src/**', ['src/**'])).toBe(true);
    expect(wfsGlobCovered('docs/**', ['src/**'])).toBe(false);
    expect(wfsGlobCovered('src/**', ['src/*.cpp'])).toBe(false);
    expect(wfsGlobCovered('src2/a', ['src/**'])).toBe(false);
  });
});

describe('WonderFS authorization: clone grants are never wider than their parent', () => {
  const parent = grant({ grantId: 'grant-parent' });
  const child = (over: Partial<WfsGrant> = {}): WfsGrant =>
    grant({ grantId: 'grant-child', principalId: 'clone-1', principalKind: 'clone', issuedBy: { kind: 'grant', grantId: 'grant-parent' }, ops: ['read', 'write'], paths: ['src/game/**'], expiresAtIso: '2026-10-11T03:30:00.000Z', ...over });

  it('accepts a subset', () => {
    expect(wfsCloneGrantWithin(child(), parent, NOW).ok).toBe(true);
  });

  it('refuses a wider op, a wider path, a longer life, main, another parent, or a dead parent', () => {
    refusedUniformly(wfsCloneGrantWithin(child({ ops: ['read', 'write', 'merge'] }), grant({ grantId: 'grant-parent', ops: ['read', 'write'] }), NOW));
    refusedUniformly(wfsCloneGrantWithin(child({ paths: ['docs/**'] }), parent, NOW));
    refusedUniformly(wfsCloneGrantWithin(child({ expiresAtIso: '2026-10-11T05:00:00.000Z' }), parent, NOW));
    refusedUniformly(wfsCloneGrantWithin(child({ branches: 'main_and_own' }), parent, NOW));
    refusedUniformly(wfsCloneGrantWithin(child({ issuedBy: { kind: 'grant', grantId: 'grant-other' } }), parent, NOW));
    refusedUniformly(wfsCloneGrantWithin(child(), grant({ grantId: 'grant-parent', revokedAtIso: NOW }), NOW));
    refusedUniformly(wfsCloneGrantWithin(child({ principalKind: 'julius' }), parent, NOW));
  });

  it('asks a human only for an imported agent merging into main', () => {
    expect(wfsMergeNeedsApproval('imported_agent', true)).toBe(true);
    expect(wfsMergeNeedsApproval('imported_agent', false)).toBe(false);
    expect(wfsMergeNeedsApproval('julius', true)).toBe(false);
  });
});

describe('WonderFS authorization: a grant follows its issuer (r1.2 §19.M2, T-ISSUER, guard b)', () => {
  it('refuses, at use, a grant whose issuer was removed or demoted', () => {
    // removed from project_members: no role now
    refusedUniformly(authorizeAgent(agentRequest({ issuerNow: { kind: 'human', role: null, createMission: false } })));
    // an ADMIN (editor) who lost create_mission: their julius grant no longer stands
    refusedUniformly(authorizeAgent(agentRequest({ issuerNow: { kind: 'human', role: 'editor', createMission: false } })));
    // a viewer cannot back an imported agent's write grant
    refusedUniformly(authorizeAgent(agentRequest({ grant: grant({ principalKind: 'imported_agent' }), issuerNow: { kind: 'human', role: 'viewer', createMission: false } })));
    // a clone whose parent grant is no longer valid
    refusedUniformly(authorizeAgent(agentRequest({ grant: grant({ principalKind: 'clone', issuedBy: { kind: 'grant', grantId: 'g-parent' } }), issuerNow: { kind: 'grant', parentValid: false } })));
  });

  it('the controls: an issuer who still holds the rights keeps the grant valid', () => {
    expect(authorizeAgent(agentRequest({ issuerNow: { kind: 'human', role: 'editor', createMission: true } })).ok).toBe(true);
    expect(authorizeAgent(agentRequest({ grant: grant({ principalKind: 'imported_agent' }), issuerNow: { kind: 'human', role: 'editor', createMission: false } })).ok).toBe(true);
    expect(authorizeAgent(agentRequest({ grant: grant({ principalKind: 'clone', issuedBy: { kind: 'grant', grantId: 'g-parent' } }), issuerNow: { kind: 'grant', parentValid: true } })).ok).toBe(true);
    expect(wfsIssuerStillCovers('julius', { kind: 'grant', parentValid: true })).toBe(false); // a julius grant is a human's, never a grant's
  });
});

describe('WonderFS authorization: protected paths on fold keys (r1.3 §19.M3, T-PROTECTED-FOLD)', () => {
  const allGrant = grant({ paths: ['**'] });
  it('an agent with a `**` grant writes none of the protected classes, in any case spelling', () => {
    for (const p of ['.GITHUB/Workflows/ci.yml', '.github/workflows', '.Git/hooks/pre-commit', 'CONFIG/.ENV', '.Claude/settings.json', 'sub/.ENVRC', '.AWS/credentials', 'deep/.SSH', 'keys/server.PEM', 'Node_Modules/x/index.js']) {
      expect(wfsIsAgentProtected(p), p).toBe(true);
      refusedUniformly(authorizeAgent(agentRequest({ grant: allGrant, paths: [p] })));
    }
  });

  it('the controls: an ordinary path and a documentation .env file are written; a read of a protected path is a matter for the grant', () => {
    expect(authorizeAgent(agentRequest({ grant: allGrant, paths: ['src/main.cpp'] })).ok).toBe(true);
    expect(authorizeAgent(agentRequest({ grant: allGrant, paths: ['app/.ENV.Example'] })).ok).toBe(true);
    expect(authorizeAgent(agentRequest({ grant: allGrant, action: 'read', paths: ['.git/config'] })).ok).toBe(true);
  });

  it('a human editor may write CI configuration; nobody writes the reserved root', () => {
    expect(authorizeHuman({ role: 'editor', action: 'write', paths: ['.github/workflows/ci.yml'] }).ok).toBe(true);
    refusedUniformly(authorizeHuman({ role: 'editor', action: 'write', paths: ['.wonderfs/x'] }));
  });

  it('THE DRIFT TEST: every location juliusPathLocation protects (read from its source at this commit) is protected here too', () => {
    const source = readFileSync(join(__dirname, '..', 'mission', 'julius', 'julius-workspace-paths.ts'), 'utf8');
    const listOf = (name: string): string[] => {
      // the array literal that follows `const <name>: readonly string[] = Object.freeze(`
      const decl = source.indexOf(`const ${name}: readonly string[] = Object.freeze(`);
      expect(decl, `${name} not found in julius-workspace-paths.ts`).toBeGreaterThanOrEqual(0);
      const open = source.indexOf('[', source.indexOf('Object.freeze(', decl));
      const close = source.indexOf(']', open);
      expect(open > decl && close > open, `${name}'s array literal not found`).toBe(true);
      const items = [...source.slice(open + 1, close).matchAll(/'([^']+)'/gu)].map((x) => x[1]);
      expect(items.length, `${name} is empty`).toBeGreaterThan(0);
      return items;
    };
    const samples: string[] = [];
    for (const s of [...listOf('CONTROL_SEGMENTS'), ...listOf('CREDENTIAL_SEGMENTS')]) samples.push(s, `sub/${s}`, `sub/${s}/x.txt`);
    for (const f of [...listOf('CONTROL_FILES'), ...listOf('CREDENTIAL_FILES')]) samples.push(f, `sub/${f}`);
    samples.push('.env', 'sub/.env.production', '.github/workflows', '.github/workflows/deploy.yml');
    expect(samples.length).toBeGreaterThan(40);
    for (const s of samples) {
      expect(juliusPathLocation(s.split('/')).kind, `julius classifies ${s}`).not.toBe('ordinary'); // the sample really is protected there
      expect(wfsIsAgentProtected(s), `WonderFS must protect ${s}`).toBe(true);
    }
    // and the documentation exemption agrees both ways
    for (const doc of ['.env.example', '.env.sample', '.env.template', '.env.dist']) {
      expect(juliusPathLocation([doc]).kind).toBe('ordinary');
      expect(wfsIsAgentProtected(doc)).toBe(false);
    }
  });
});
