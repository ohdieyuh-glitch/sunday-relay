import { describe, expect, it } from 'vitest';
import {
  juliusFileCreationDecision,
  type JuliusFileCreationPolicy,
  type JuliusFileCreationRequest,
} from './julius-file-creation';

/**
 * THE FOUNDER'S CASES A THROUGH F, PLUS THE ONES A DENY-BY-DEFAULT RULE NEEDS.
 *
 * G and H are not here because they are not this module's questions. A created
 * file appearing in DIFF evidence and a new-file mission not parking are both
 * properties of the workspace snapshot, and `coder-workspace-new-file.test.ts`
 * proves them against real git: `git add -A` into a temporary index puts untracked
 * files in the tree, so a creation is observable and is attributed to the attempt
 * that made it. The one boundary there is an IGNORED path, which produces no
 * evidence at all.
 */

const policy = (overrides: Partial<JuliusFileCreationPolicy> = {}): JuliusFileCreationPolicy => ({
  permittedPaths: ['src', 'tests'],
  outOfScope: ['src/vendor'],
  maxBytes: 64 * 1024,
  mayOverwrite: false,
  ...overrides,
});

const ask = (path: string, overrides: Partial<JuliusFileCreationRequest> = {}): JuliusFileCreationRequest =>
  ({ path, bytes: 128, exists: false, ...overrides });

const decide = (path: string, req: Partial<JuliusFileCreationRequest> = {}, pol: Partial<JuliusFileCreationPolicy> = {}) =>
  juliusFileCreationDecision(ask(path, req), policy(pol));

describe('Julius decides whether a worker may create a file', () => {
  /* ------------------------------------------------------- A, B and C: allow */

  it('A. a new source file under a permitted path is allowed', () => {
    const decision = decide('src/settings/toggle.ts');
    expect(decision.allowed, JSON.stringify(decision)).toBe(true);
    if (decision.allowed) {
      expect(decision.path).toBe('src/settings/toggle.ts');
      expect(decision.overwrites).toBe(false);
    }
  });

  it('B. a new test file is allowed, and is not a special case', () => {
    expect(decide('tests/settings/toggle.test.ts').allowed).toBe(true);
    expect(decide('src/settings/toggle.test.ts').allowed).toBe(true);
  });

  it('C. nested creation is allowed where the prefix permits it, at any depth', () => {
    for (const path of ['src/a/b/c/d/deep.ts', 'src/one.ts', 'tests/x/y.spec.ts']) {
      expect(decide(path).allowed, path).toBe(true);
    }
  });

  it('the answer is the NORMALISED path, so two spellings cannot be authorised differently', () => {
    for (const spelling of ['src\\settings\\toggle.ts', 'src/./settings/toggle.ts', 'src//settings//toggle.ts']) {
      const decision = decide(spelling);
      expect(decision.allowed, spelling).toBe(true);
      if (decision.allowed) expect(decision.path, spelling).toBe('src/settings/toggle.ts');
    }
  });

  /* ------------------------------------------------------ D, E and F: refuse */

  it('D. a traversal is refused, whatever it would resolve to', () => {
    for (const path of ['../outside.ts', 'src/../../outside.ts', 'src/a/../../../etc/passwd', 'src\\..\\..\\out.ts']) {
      const decision = decide(path);
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) expect(decision.refusal, path).toBe('path_traversal');
    }
  });

  it('D2. a traversal that happens to land back inside is STILL refused', () => {
    // Resolving it would be a second implementation of the boundary, and the two
    // would disagree one day. The shape is refused, not the destination.
    const decision = decide('src/a/../b.ts');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('path_traversal');
  });

  it('E. an absolute or drive-qualified path is refused by SHAPE, before any prefix is consulted', () => {
    for (const [path, refusal] of [
      ['/etc/passwd', 'path_absolute'],
      ['/src/ok.ts', 'path_absolute'],
      ['\\\\server\\share\\x.ts', 'path_absolute'],
      ['C:/Users/Kaisi/.ssh/id_rsa', 'path_drive_qualified'],
      ['c:\\windows\\system32\\x.dll', 'path_drive_qualified'],
    ] as const) {
      const decision = decide(path);
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) expect(decision.refusal, path).toBe(refusal);
    }
  });

  it('F. an unauthorized overwrite is refused, and an authorized one says it overwrites', () => {
    const blocked = decide('src/existing.ts', { exists: true });
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.refusal).toBe('overwrite_not_authorized');

    const permitted = decide('src/existing.ts', { exists: true }, { mayOverwrite: true });
    expect(permitted.allowed).toBe(true);
    if (permitted.allowed) expect(permitted.overwrites, 'the caller must be told it is a replacement').toBe(true);
  });

  /* ------------------------------------- the rules a deny-by-default needs */

  it('a control location is refused even when a permitted prefix would cover it', () => {
    for (const path of ['src/.git/hooks/pre-commit', '.git/config', 'src/node_modules/pkg/index.js', 'src/.julius/loader.mjs']) {
      const decision = juliusFileCreationDecision(ask(path), policy({ permittedPaths: ['src', '.git', '.julius'] }));
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) expect(decision.refusal, path).toBe('path_control_location');
    }
  });

  it('a credential location or file is refused, directory or leaf', () => {
    for (const path of ['src/.ssh/id_rsa', 'src/.aws/credentials', 'src/.npmrc', 'src/sub/.netrc', 'src/id_ed25519']) {
      const decision = juliusFileCreationDecision(ask(path), policy({ permittedPaths: ['src'] }));
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) expect(decision.refusal, path).toBe('path_credential_location');
    }
  });

  it('a CI workflow file is refused, because it changes what runs', () => {
    const decision = juliusFileCreationDecision(
      ask('.github/workflows/ship.yml'), policy({ permittedPaths: ['.github'] }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('path_control_location');
    // And an ordinary .github file is NOT refused by that rule, so the rule is
    // about workflows rather than about a directory name.
    expect(juliusFileCreationDecision(ask('.github/CODEOWNERS'), policy({ permittedPaths: ['.github'] })).allowed).toBe(true);
  });

  it('out of scope beats permitted, because an exclusion is the more specific statement', () => {
    const decision = decide('src/vendor/lib.ts');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('path_out_of_scope');
  });

  it('EMPTY permittedPaths PERMITS NOTHING, which is the default a contract must not fall into', () => {
    // The dangerous reading is "no restriction stated, so anything goes". A
    // contract that forgot to say where work may land must not thereby authorise
    // the whole workspace.
    const decision = juliusFileCreationDecision(ask('src/ok.ts'), policy({ permittedPaths: [] }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('path_not_permitted');
  });

  it('a path under no permitted prefix is refused, and a prefix is not a string prefix', () => {
    // "srcextra" starts with "src" as text and is not under it as a path.
    const decision = juliusFileCreationDecision(ask('srcextra/x.ts'), policy({ permittedPaths: ['src'] }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.refusal).toBe('path_not_permitted');
  });

  it('the size ceiling is enforced, and its boundary is inclusive', () => {
    expect(decide('src/x.ts', { bytes: 64 * 1024 }).allowed, 'exactly at the ceiling is allowed').toBe(true);
    const over = decide('src/x.ts', { bytes: 64 * 1024 + 1 });
    expect(over.allowed).toBe(false);
    if (!over.allowed) expect(over.refusal).toBe('content_too_large');
    for (const bytes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const decision = decide('src/x.ts', { bytes });
      expect(decision.allowed, String(bytes)).toBe(false);
    }
    expect(decide('src/empty.ts', { bytes: 0 }).allowed, 'an empty file is a legitimate creation').toBe(true);
  });

  it('an empty or blank path is refused rather than treated as the workspace root', () => {
    for (const path of ['', '   ', '.', './', '/']) {
      expect(decide(path).allowed, JSON.stringify(path)).toBe(false);
    }
  });

  it('every refusal carries a reason a record can quote', () => {
    for (const path of ['../x', '/x', 'C:/x', '.git/x', 'src/.npmrc', 'src/vendor/x', 'nope/x', '']) {
      const decision = decide(path);
      expect(decision.allowed, path).toBe(false);
      if (!decision.allowed) {
        expect(decision.because.length, path).toBeGreaterThan(20);
        expect(decision.refusal, path).toMatch(/^[a-z_]+$/u);
      }
    }
  });

  it('is PURE: the same request answers the same way and nothing is mutated', () => {
    const request = ask('src/a.ts');
    const bounds = policy();
    const first = juliusFileCreationDecision(request, bounds);
    const second = juliusFileCreationDecision(request, bounds);
    expect(first).toEqual(second);
    expect(request.path, 'the request is untouched').toBe('src/a.ts');
    expect(bounds.permittedPaths, 'the policy is untouched').toEqual(['src', 'tests']);
  });
});
