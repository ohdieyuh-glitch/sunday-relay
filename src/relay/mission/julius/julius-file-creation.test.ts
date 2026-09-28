import { describe, expect, it } from 'vitest';

import {
  JULIUS_FILE_CREATION_LIMITS,
  juliusFileCreationDecision,
  juliusFileCreationPolicyFor,
  juliusFileEditDecision,
  type JuliusFileCreationPolicy,
} from './julius-file-creation';

/**
 * JULIUS DECIDES WHETHER A WORKER MAY CREATE -- OR EDIT -- A FILE.
 *
 * Carries every case of the first version (relay/julius-task-generality
 * b48f4f0f) forward, adds the hardening it lacked -- case-insensitive control
 * locations, Windows-only spellings, credential `.env` files -- and the part it
 * never had: WHO may grant creation, and how a task contract may only narrow it.
 */

const policy = (over: Partial<JuliusFileCreationPolicy> = {}): JuliusFileCreationPolicy => ({
  permittedPaths: ['src', 'tests'],
  alsoWithin: [],
  outOfScope: ['src/vendor'],
  maxBytes: 4096,
  mayOverwrite: false,
  ...over,
});

const ask = (path: string, over: { bytes?: number; exists?: boolean } = {}) => ({
  path, bytes: over.bytes ?? 100, exists: over.exists ?? false,
});

describe('Julius decides whether a worker may create a file', () => {
  it('A. a new source file under a permitted path is allowed, and the answer names the normalised path', () => {
    expect(juliusFileCreationDecision(ask('src/settings/toggle.ts'), policy()))
      .toEqual({ allowed: true, path: 'src/settings/toggle.ts', overwrites: false });
  });

  it('B. a new test file is allowed, and is not a special case', () => {
    expect(juliusFileCreationDecision(ask('tests/settings/toggle.test.ts'), policy())).toMatchObject({ allowed: true });
  });

  it('C. nested creation is allowed where the prefix permits it, at any depth', () => {
    for (const path of ['src/a/b/c/d/deep.ts', 'src/one.ts', 'tests/x/y.spec.ts']) {
      expect(juliusFileCreationDecision(ask(path), policy()), path).toMatchObject({ allowed: true, path });
    }
  });

  it('two spellings of one path are ONE decision', () => {
    for (const spelling of ['src\\settings\\toggle.ts', 'src/./settings/toggle.ts', 'src//settings//toggle.ts']) {
      expect(juliusFileCreationDecision(ask(spelling), policy()), spelling)
        .toEqual({ allowed: true, path: 'src/settings/toggle.ts', overwrites: false });
    }
  });

  it('D. a traversal is refused, even one that would land back inside', () => {
    for (const path of ['../outside.ts', 'src/../../outside.ts', 'src/a/../b.ts', 'src\\..\\..\\out.ts']) {
      expect(juliusFileCreationDecision(ask(path), policy()), path).toMatchObject({ allowed: false, refusal: 'path_traversal' });
    }
  });

  it('E. an absolute, home-relative or drive-qualified path is refused by SHAPE, before any prefix is consulted', () => {
    const cases: Array<[string, string]> = [
      ['/etc/passwd', 'path_absolute'], ['/src/ok.ts', 'path_absolute'], ['\\\\server\\share\\x.ts', 'path_absolute'],
      ['~/.bashrc', 'path_absolute'], ['C:/Users/x/.ssh/id_rsa', 'path_drive_qualified'], ['c:\\windows\\x.dll', 'path_drive_qualified'],
    ];
    for (const [path, refusal] of cases) {
      expect(juliusFileCreationDecision(ask(path), policy({ permittedPaths: ['src', '/'] })), path).toMatchObject({ allowed: false, refusal });
    }
  });

  it('F. an unauthorized overwrite is refused; an authorized one says it overwrites', () => {
    expect(juliusFileCreationDecision(ask('src/existing.ts', { exists: true }), policy()))
      .toMatchObject({ allowed: false, refusal: 'overwrite_not_authorized' });
    expect(juliusFileCreationDecision(ask('src/existing.ts', { exists: true }), policy({ mayOverwrite: true })))
      .toEqual({ allowed: true, path: 'src/existing.ts', overwrites: true });
  });

  it('G. an oversized file is refused, and the ceiling is inclusive', () => {
    expect(juliusFileCreationDecision(ask('src/big.ts', { bytes: 4096 }), policy())).toMatchObject({ allowed: true });
    expect(juliusFileCreationDecision(ask('src/big.ts', { bytes: 4097 }), policy())).toMatchObject({ allowed: false, refusal: 'content_too_large' });
    expect(juliusFileCreationDecision(ask('src/x.ts', { bytes: -1 }), policy())).toMatchObject({ allowed: false, refusal: 'content_negative' });
    expect(juliusFileCreationDecision(ask('src/x.ts', { bytes: Number.NaN }), policy())).toMatchObject({ allowed: false, refusal: 'content_negative' });
  });

  it('a control location is refused even where a permitted prefix covers it -- and in ANY case', () => {
    for (const path of ['src/.git/hooks/pre-commit', '.git/config', '.GIT/hooks/pre-commit', 'src/node_modules/pkg/index.js', '.claude/settings.json', 'src/.julius/loader.mjs']) {
      const decision = juliusFileCreationDecision(ask(path), policy({ permittedPaths: ['src', '.git', '.GIT', '.claude'] }));
      expect(decision, path).toMatchObject({ allowed: false, refusal: 'path_control_location' });
    }
  });

  it('a Windows-only spelling of a control location is refused before it could reach one', () => {
    expect(juliusFileCreationDecision(ask('.git./hooks/pre-commit'), policy({ permittedPaths: ['.git.'] })))
      .toMatchObject({ allowed: false, refusal: 'path_ambiguous_segment' });
    expect(juliusFileCreationDecision(ask('src/x.ts:payload'), policy()))
      .toMatchObject({ allowed: false, refusal: 'path_invalid_character' });
  });

  it('a credential location or file is refused, and so is `.env` -- while `.env.example` is a deliverable', () => {
    for (const path of ['src/.ssh/id_rsa', 'src/.aws/credentials', 'src/.npmrc', 'src/sub/.netrc', 'src/id_ed25519', 'src/.env', 'src/.env.local']) {
      expect(juliusFileCreationDecision(ask(path), policy()), path).toMatchObject({ allowed: false, refusal: 'path_credential_location' });
    }
    expect(juliusFileCreationDecision(ask('src/.env.example'), policy())).toMatchObject({ allowed: true });
  });

  it('a CI workflow file is refused, because it changes what runs; the rest of `.github` is not', () => {
    expect(juliusFileCreationDecision(ask('.github/workflows/ship.yml'), policy({ permittedPaths: ['.github'] })))
      .toMatchObject({ allowed: false, refusal: 'path_workflow_location' });
    expect(juliusFileCreationDecision(ask('.github/CODEOWNERS'), policy({ permittedPaths: ['.github'] }))).toMatchObject({ allowed: true });
  });

  it('out of scope beats permitted, because an exclusion is the more specific statement', () => {
    expect(juliusFileCreationDecision(ask('src/vendor/lib.ts'), policy())).toMatchObject({ allowed: false, refusal: 'path_out_of_scope' });
  });

  it('EMPTY permittedPaths PERMITS NOTHING, and a prefix is a directory, not a string prefix', () => {
    expect(juliusFileCreationDecision(ask('src/x.ts'), policy({ permittedPaths: [] }))).toMatchObject({ allowed: false, refusal: 'path_not_permitted' });
    expect(juliusFileCreationDecision(ask('srcextra/x.ts'), policy({ permittedPaths: ['src'] }))).toMatchObject({ allowed: false, refusal: 'path_not_permitted' });
  });

  it('the locked task contract can NARROW where a file lands, never widen it', () => {
    const narrowed = policy({ permittedPaths: ['src'], alsoWithin: ['src/settings'] });
    expect(juliusFileCreationDecision(ask('src/settings/toggle.ts'), narrowed)).toMatchObject({ allowed: true });
    expect(juliusFileCreationDecision(ask('src/other/x.ts'), narrowed)).toMatchObject({ allowed: false, refusal: 'path_not_permitted' });
    // A contract naming a path the mission never granted adds nothing.
    const widened = policy({ permittedPaths: ['src'], alsoWithin: ['lib'] });
    expect(juliusFileCreationDecision(ask('lib/x.ts'), widened)).toMatchObject({ allowed: false, refusal: 'path_not_permitted' });
  });

  it('every refusal carries a reason a record can quote', () => {
    for (const path of ['../x', '/x', 'C:/x', '.git/x', 'src/.npmrc', 'src/vendor/x', 'nope/x', '', 'src/x:y']) {
      const decision = juliusFileCreationDecision(ask(path), policy());
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) expect(decision.because.length, path).toBeGreaterThan(10);
    }
  });

  it('is PURE: the same request answers the same way and nothing is mutated', () => {
    const bounds = policy();
    const first = juliusFileCreationDecision(ask('src/x.ts'), bounds);
    expect(juliusFileCreationDecision(ask('src/x.ts'), bounds)).toEqual(first);
    expect(bounds.permittedPaths).toEqual(['src', 'tests']);
  });
});

describe('who may grant creation: the MISSION, never a worker -- and a bad grant fails closed', () => {
  const contract = { permittedPaths: ['src/settings'], outOfScope: ['src/vendor'] };

  it('no grant is no creation, and not a problem: every mission written before this capability is unchanged', () => {
    expect(juliusFileCreationPolicyFor(null, contract)).toEqual({ policy: null, problem: null });
    expect(juliusFileCreationPolicyFor(undefined, contract)).toEqual({ policy: null, problem: null });
  });

  it('a grant composes with the contract: the grant says where, the contract narrows and excludes', () => {
    const result = juliusFileCreationPolicyFor({ permittedPaths: ['src', 'tests'], maxBytes: 8192, mayOverwrite: true }, contract);
    expect(result.policy).toEqual({
      permittedPaths: ['src', 'tests'], alsoWithin: ['src/settings'], outOfScope: ['src/vendor'], maxBytes: 8192, mayOverwrite: true,
    });
  });

  it('defaults: 256 KiB, no overwrite; and a requested size is clamped to the hard 1 MiB', () => {
    expect(juliusFileCreationPolicyFor({ permittedPaths: ['src'] }, null).policy)
      .toMatchObject({ maxBytes: JULIUS_FILE_CREATION_LIMITS.defaultMaxBytes, mayOverwrite: false, alsoWithin: [], outOfScope: [] });
    expect(juliusFileCreationPolicyFor({ permittedPaths: ['src'], maxBytes: 50 * 1024 * 1024 }, null).policy?.maxBytes)
      .toBe(JULIUS_FILE_CREATION_LIMITS.hardMaxBytes);
  });

  it('a grant naming no path, an unsafe path, or a control location FAILS CLOSED, with a reason', () => {
    for (const grant of [{ permittedPaths: [] }, { permittedPaths: ['../up'] }, { permittedPaths: ['/abs'] }, { permittedPaths: ['.git'] }, { permittedPaths: ['src', '.github/workflows'] }]) {
      const result = juliusFileCreationPolicyFor(grant, contract);
      expect(result.policy, JSON.stringify(grant)).toBeNull();
      expect(result.problem, JSON.stringify(grant)).toMatch(/.{10,}/u);
    }
    const tooMany = { permittedPaths: Array.from({ length: JULIUS_FILE_CREATION_LIMITS.maxPrefixes + 1 }, (_, i) => `d${String(i)}`) };
    expect(juliusFileCreationPolicyFor(tooMany, null).policy).toBeNull();
  });
});

describe('Julius decides whether a worker may edit an existing file', () => {
  const edits = { outOfScope: ['src/vendor'] };

  it('an ordinary file anywhere in the granted repository may be edited -- scope stays a post-session judgement', () => {
    for (const path of ['src/app.ts', 'README.md', 'package.json', '.github/CODEOWNERS', 'Config/DefaultGame.ini']) {
      expect(juliusFileEditDecision({ path }, edits), path).toMatchObject({ allowed: true, path });
    }
  });

  it('refuses control, credential and workflow locations, out-of-scope paths, and anything not a workspace path', () => {
    const cases: Array<[string, string]> = [
      ['.git/config', 'path_control_location'], ['.Git/hooks/post-checkout', 'path_control_location'],
      ['.claude/settings.json', 'path_control_location'], ['.env', 'path_credential_location'],
      ['.github/workflows/ci.yml', 'path_workflow_location'], ['src/vendor/lib.ts', 'path_out_of_scope'],
      ['/home/runner/.bashrc', 'path_absolute'], ['../relay-bridge/server.ts', 'path_traversal'],
    ];
    for (const [path, refusal] of cases) {
      expect(juliusFileEditDecision({ path }, edits), path).toMatchObject({ allowed: false, refusal });
    }
  });
});
