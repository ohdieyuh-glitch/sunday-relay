import { describe, expect, it } from 'vitest';

import { JULIUS_FILE_AUTHORITY_REFUSALS, juliusFileEditDecision } from './julius-file-authority';

/**
 * JULIUS DECIDES WHETHER A WORKER MAY EDIT A FILE, and refuses only what no
 * contract could make safe. Every refusal has a CONTROL beside it -- an ordinary
 * path of the same kind that passes -- so no case here can pass because the
 * decision refuses everything.
 */

describe('Julius decides whether a worker may edit an existing file', () => {
  it('an ordinary file anywhere in the workspace may be edited -- scope stays a post-session judgement', () => {
    for (const path of ['src/app.ts', 'README.md', 'package.json', '.github/CODEOWNERS', 'Config/DefaultGame.ini',
      'src/relay/workspace/julius-tools/node-tool-adapter.ts', '.env.example', 'docs/workflows/guide.md']) {
      expect(juliusFileEditDecision({ path }), path).toEqual({ allowed: true, path });
    }
  });

  it('two spellings of one path are ONE decision, answered with the normalised spelling', () => {
    expect(juliusFileEditDecision({ path: 'src\\relay\\.\\app.ts' })).toEqual({ allowed: true, path: 'src/relay/app.ts' });
    expect(juliusFileEditDecision({ path: ' src//relay/app.ts ' })).toEqual({ allowed: true, path: 'src/relay/app.ts' });
  });

  it('refuses control, credential and workflow locations -- at any depth, and in ANY case', () => {
    const cases: Array<[string, string]> = [
      ['.git/config', 'path_control_location'], ['.Git/hooks/post-checkout', 'path_control_location'],
      ['.GIT/hooks/pre-commit', 'path_control_location'], ['packages/app/.git/config', 'path_control_location'],
      ['.claude/settings.json', 'path_control_location'], ['sub/.Claude/settings.local.json', 'path_control_location'],
      ['.julius/loader.mjs', 'path_control_location'], ['.husky/pre-commit', 'path_control_location'],
      ['node_modules/pkg/index.js', 'path_control_location'], ['src/.envrc', 'path_control_location'],
      ['.env', 'path_credential_location'], ['app/.env.production', 'path_credential_location'],
      ['.ssh/id_rsa', 'path_credential_location'], ['.AWS/credentials', 'path_credential_location'],
      ['.npmrc', 'path_credential_location'], ['id_ed25519', 'path_credential_location'],
      ['.github/workflows/ci.yml', 'path_workflow_location'], ['.GitHub/Workflows/ship.yml', 'path_workflow_location'],
    ];
    for (const [path, refusal] of cases) {
      expect(juliusFileEditDecision({ path }), path).toMatchObject({ allowed: false, refusal });
    }
  });

  it('refuses anything that is not a workspace path, by SHAPE, before any location is consulted', () => {
    const cases: Array<[string, string]> = [
      ['/home/runner/.bashrc', 'path_absolute'], ['~/.ssh/id_rsa', 'path_absolute'],
      ['../relay-bridge/server.ts', 'path_traversal'], ['src/../../x.ts', 'path_traversal'],
      ['C:/Users/runner/x.ts', 'path_drive_qualified'], ['src/app.ts:hidden', 'path_invalid_character'],
      ['.git./config', 'path_ambiguous_segment'], ['src/CON', 'path_reserved_name'], ['', 'path_empty'],
    ];
    for (const [path, refusal] of cases) {
      expect(juliusFileEditDecision({ path }), path).toMatchObject({ allowed: false, refusal });
    }
  });

  it('every refusal carries a reason a model can act on, and the reason names no host path', () => {
    const decision = juliusFileEditDecision({ path: '.git/hooks/pre-commit' });
    expect(decision).toMatchObject({ allowed: false });
    expect(decision.allowed ? '' : decision.because).toMatch(/\.git/u);
    const absolute = juliusFileEditDecision({ path: '/home/runner/work/sunday-relay/package.json' });
    expect(absolute).toMatchObject({ allowed: false, refusal: 'path_absolute' });
    expect(absolute.allowed ? '' : absolute.because).not.toContain('/home/runner');
  });
});

describe('the refusal vocabulary is CLOSED', () => {
  it('every refusal the edit decision can produce is a member of the closed set', () => {
    const produced = new Set<string>();
    for (const path of ['', '/x', 'C:/x', '../x', 'a\u0000b', 'a:b', 'x./y', 'CON', 'a'.repeat(2000),
      '.git/x', '.ssh/x', '.github/workflows/x']) {
      const decision = juliusFileEditDecision({ path });
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) produced.add(decision.refusal);
    }
    for (const name of produced) expect(JULIUS_FILE_AUTHORITY_REFUSALS, name).toContain(name);
    expect(produced.size).toBe(11);
  });

  it('the set is frozen, has no duplicate, and holds only snake_case names a record column can carry', () => {
    expect(Object.isFrozen(JULIUS_FILE_AUTHORITY_REFUSALS)).toBe(true);
    expect(new Set(JULIUS_FILE_AUTHORITY_REFUSALS).size).toBe(JULIUS_FILE_AUTHORITY_REFUSALS.length);
    for (const name of JULIUS_FILE_AUTHORITY_REFUSALS) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/u);
  });
});
