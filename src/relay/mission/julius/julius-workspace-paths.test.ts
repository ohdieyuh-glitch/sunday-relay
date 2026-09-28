import { describe, expect, it } from 'vitest';

import {
  JULIUS_PATH_LIMITS,
  juliusPathIsUnder,
  juliusPathLocation,
  juliusWorkspaceRelativePath,
} from './julius-workspace-paths';

/**
 * THE ONE ANSWER TO "IS THIS A WORKSPACE PATH?", HELD CASE BY CASE.
 *
 * Every refusal has a CONTROL beside it -- an ordinary path of the same kind that
 * passes -- so no case here can pass because the module refuses everything.
 */

const refusalOf = (raw: unknown) => {
  const result = juliusWorkspaceRelativePath(raw);
  return result.ok ? 'ok' : result.refusal;
};

const segmentsOf = (raw: string): readonly string[] => {
  const result = juliusWorkspaceRelativePath(raw);
  if (!result.ok) throw new Error(`fixture path refused: ${raw}`);
  return result.segments;
};

describe('juliusWorkspaceRelativePath: one spelling, or a named refusal', () => {
  it('normalises separators and dot segments, and keeps the case', () => {
    for (const spelling of ['src\\Settings\\Toggle.ts', 'src/./Settings/Toggle.ts', 'src//Settings//Toggle.ts', ' src/Settings/Toggle.ts ']) {
      const result = juliusWorkspaceRelativePath(spelling);
      expect(result, spelling).toMatchObject({ ok: true, path: 'src/Settings/Toggle.ts' });
    }
  });

  it('refuses absolute, UNC, home-relative and drive-qualified spellings by SHAPE', () => {
    expect(refusalOf('/etc/passwd')).toBe('path_absolute');
    expect(refusalOf('\\\\server\\share\\x.ts')).toBe('path_absolute');
    expect(refusalOf('~/.ssh/id_rsa')).toBe('path_absolute');
    expect(refusalOf('~')).toBe('path_absolute');
    expect(refusalOf('C:/Users/x/file.ts')).toBe('path_drive_qualified');
    expect(refusalOf('c:\\windows\\x.dll')).toBe('path_drive_qualified');
    // CONTROL: a directory NAMED `~something` is an ordinary relative path.
    expect(refusalOf('src/~draft/x.ts')).toBe('ok');
  });

  it('refuses ".." anywhere, including a traversal that would land back inside', () => {
    for (const path of ['../x.ts', 'src/../../x.ts', 'src/a/../b.ts', 'src\\..\\x.ts']) {
      expect(refusalOf(path), path).toBe('path_traversal');
    }
    // CONTROL: dots inside a name are not traversal.
    expect(refusalOf('src/a..b/x.ts')).toBe('ok');
  });

  it('refuses control characters and the characters Windows refuses in a name -- ":" is an alternate data stream', () => {
    for (const path of ['src/a\u0000.ts', 'src/a\nb.ts', 'src/a\u007f.ts']) expect(refusalOf(path), JSON.stringify(path)).toBe('path_invalid_character');
    for (const path of ['src/file.ts:hidden', 'src/a<b.ts', 'src/a|b.ts', 'src/a?.ts', 'src/*.ts', 'src/"q".ts']) {
      expect(refusalOf(path), path).toBe('path_invalid_character');
    }
    // CONTROL: ordinary punctuation passes.
    expect(refusalOf('src/a-b_c.d+e@f(1).ts')).toBe('ok');
  });

  it('refuses a segment ending in a dot or a space, because Windows strips both -- `.git.` IS `.git` there', () => {
    for (const path of ['.git./hooks/pre-commit', 'src/name./x.ts', 'src/name /x.ts', 'src/x.ts.']) {
      expect(refusalOf(path), path).toBe('path_ambiguous_segment');
    }
  });

  it('refuses Windows reserved device names on the stem, with or without an extension', () => {
    for (const path of ['src/CON', 'src/nul.txt', 'src/Com1.ts', 'LPT9', 'src/aux.json', 'src/conin$']) {
      expect(refusalOf(path), path).toBe('path_reserved_name');
    }
    // CONTROL: names that merely CONTAIN a device name are files.
    for (const path of ['src/console.ts', 'src/nullable.ts', 'src/com10.ts', 'src/auxiliary.ts']) {
      expect(refusalOf(path), path).toBe('ok');
    }
  });

  it('bounds length, depth and segment size', () => {
    expect(refusalOf(`src/${'a'.repeat(JULIUS_PATH_LIMITS.chars)}`)).toBe('path_too_long');
    expect(refusalOf(Array.from({ length: JULIUS_PATH_LIMITS.segments + 1 }, () => 'd').join('/'))).toBe('path_too_long');
    expect(refusalOf(`src/${'s'.repeat(JULIUS_PATH_LIMITS.segmentChars + 1)}.ts`)).toBe('path_too_long');
    expect(refusalOf(Array.from({ length: JULIUS_PATH_LIMITS.segments }, () => 'd').join('/'))).toBe('ok');
  });

  it('an empty, blank or dot-only path is refused rather than treated as the workspace root', () => {
    for (const path of ['', '   ', '.', './', '.\\', 17, null, undefined]) {
      expect(refusalOf(path), String(path)).toBe('path_empty');
    }
  });
});

describe('juliusPathLocation: control, credential and workflow locations, case-insensitively', () => {
  it('control directories are found at any depth and in ANY CASE -- `.GIT/hooks` is the real hook on Windows and macOS', () => {
    for (const path of ['.git/config', 'src/.git/hooks/pre-commit', '.GIT/hooks/pre-commit', '.Git/config', '.claude/settings.json',
      '.husky/pre-commit', 'node_modules/pkg/index.js', 'Node_Modules/x.js', '.julius/loader.mjs', 'src/.envrc']) {
      expect(juliusPathLocation(segmentsOf(path)).kind, path).toBe('control');
    }
  });

  it('credential directories and files are found in any case, and `.env` is a credential while its documentation is not', () => {
    for (const path of ['src/.ssh/id_rsa', '.AWS/credentials', 'src/.npmrc', 'sub/.NETRC', 'id_ed25519', '.env', 'app/.env.production', '.ENV.local']) {
      expect(juliusPathLocation(segmentsOf(path)).kind, path).toBe('credential');
    }
    for (const path of ['.env.example', 'app/.env.sample', '.env.template', 'config/.env.dist', 'src/environment.ts', 'src/.environment']) {
      expect(juliusPathLocation(segmentsOf(path)).kind, path).toBe('ordinary');
    }
  });

  it('a CI workflow file is a workflow location; the rest of `.github` is ordinary', () => {
    expect(juliusPathLocation(segmentsOf('.github/workflows/ship.yml')).kind).toBe('workflow');
    expect(juliusPathLocation(segmentsOf('.GitHub/Workflows/ship.yml')).kind).toBe('workflow');
    for (const path of ['.github/CODEOWNERS', '.github/ISSUE_TEMPLATE/bug.md', 'docs/workflows/guide.md']) {
      expect(juliusPathLocation(segmentsOf(path)).kind, path).toBe('ordinary');
    }
  });
});

describe('juliusPathIsUnder: a prefix is a directory, not a string prefix', () => {
  it('matches the prefix itself and anything beneath it, and nothing that merely shares characters', () => {
    expect(juliusPathIsUnder('src/x.ts', 'src')).toBe(true);
    expect(juliusPathIsUnder('src/x.ts', 'src/')).toBe(true);
    expect(juliusPathIsUnder('src', 'src')).toBe(true);
    expect(juliusPathIsUnder('srcextra/x.ts', 'src')).toBe(false);
    expect(juliusPathIsUnder('src/x.ts', '')).toBe(false);
    expect(juliusPathIsUnder('src/x.ts', './')).toBe(false);
  });
});
