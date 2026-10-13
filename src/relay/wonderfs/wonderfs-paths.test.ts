import { describe, expect, it } from 'vitest';
import { normalizeWfsPath, wfsIsBeneath, wfsParentPath, wfsPathKey, wfsRebase, WFS_MAX_PATH_CHARS } from './wonderfs-paths';

/** T-PATH (§6.6): what a path may be, and when two paths are one. */

function accepted(input: string): { path: string; key: string } {
  const r = normalizeWfsPath(input);
  expect(r.ok, `expected "${JSON.stringify(input)}" to be accepted`).toBe(true);
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function refusedFor(input: unknown): string {
  const r = normalizeWfsPath(input);
  expect(r.ok, `expected ${JSON.stringify(input)} to be refused`).toBe(false);
  if (r.ok) throw new Error('accepted');
  expect(r.error.code).toBe('validation-failed');
  return r.error.message;
}

describe('WonderFS paths: what is accepted', () => {
  it('accepts plain relative paths and keeps their case for display', () => {
    expect(accepted('README.md').path).toBe('README.md');
    expect(accepted('src/Game/Main.cpp').path).toBe('src/Game/Main.cpp');
    expect(accepted('assets/textures/sky_01.png').path).toBe('assets/textures/sky_01.png');
    expect(accepted('.gitignore').path).toBe('.gitignore');
    expect(accepted('docs/.wonderfs-notes.md').path).toBe('docs/.wonderfs-notes.md');
  });

  it('accepts non-ASCII names and normalizes them to NFC', () => {
    const decomposed = 'café/über.txt';
    const p = accepted(decomposed);
    expect(p.path).toBe('café/über.txt');
    expect(p.path).not.toBe(decomposed);
  });

  it('accepts a path of exactly the character limit', () => {
    const atLimit = `${'a'.repeat(99)}/${'b'.repeat(WFS_MAX_PATH_CHARS - 100)}`;
    expect(atLimit.length).toBe(WFS_MAX_PATH_CHARS);
    expect(accepted(atLimit).path).toBe(atLimit);
  });
});

describe('WonderFS paths: what is refused', () => {
  const refusedInputs: Array<[string, unknown]> = [
    ['not text', 42],
    ['empty', ''],
    ['absolute', '/etc/passwd'],
    ['trailing slash', 'src/'],
    ['empty component', 'src//main.cpp'],
    ['dot', './main.cpp'],
    ['dot-dot traversal', 'src/../../secret'],
    ['NUL', 'a\u0000b'],
    ['LF (log injection)', 'a\nb'],
    ['CR (log injection)', 'a\rb'],
    ['NEL (log injection)', 'a\u0085b'],
    ['LINE SEPARATOR', 'a b'],
    ['DEL', 'a\u007fb'],
    ['RIGHT-TO-LEFT OVERRIDE (spoofing)', 'invoice‮txt.exe'],
    ['RIGHT-TO-LEFT ISOLATE', 'a⁧b'],
    ['ZERO WIDTH SPACE', 'a​b'],
    ['BOM', '﻿a'],
    ['less-than', 'a<b'],
    ['greater-than', 'a>b'],
    ['colon (NTFS stream)', 'file.txt:hidden'],
    ['double quote', 'a"b'],
    ['backslash', 'src\\main.cpp'],
    ['pipe', 'a|b'],
    ['question mark', 'a?b'],
    ['asterisk', 'a*b'],
    ['leading space', ' a.txt'],
    ['trailing space', 'a.txt '],
    ['trailing dot', 'a.'],
    ['device CON', 'CON'],
    ['device con with extension', 'con.txt'],
    ['device with a space before the dot', 'nul .log'],
    ['device inside a folder', 'src/AUX.h'],
    ['device COM superscript', 'COM¹.log'],
    ['device LPT9', 'lpt9'],
    ['reserved root', '.wonderfs'],
    ['reserved root, other case', '.WonderFS/state.json'],
    ['too long', 'a'.repeat(WFS_MAX_PATH_CHARS + 1)],
    ['component over 255 bytes', 'é'.repeat(128)],
  ];

  for (const [why, input] of refusedInputs) {
    it(`refuses: ${why}`, () => {
      refusedFor(input);
    });
  }

  it('never echoes a refused path into the message (a log line must not carry its characters)', () => {
    const message = refusedFor('ok\nINJECTED LINE');
    expect(message).not.toContain('\n');
    expect(message).not.toContain('INJECTED');
  });
});

describe('WonderFS paths: when two paths are one (case-insensitive keys)', () => {
  it('folds case', () => {
    expect(wfsPathKey('README.md')).toBe(wfsPathKey('readme.MD'));
  });

  it('folds the Greek final sigma the way NTFS does', () => {
    expect(wfsPathKey('ς')).toBe(wfsPathKey('σ'));
    expect(wfsPathKey('Σ')).toBe(wfsPathKey('σ'));
  });

  it('treats NFC and NFD spellings as one path', () => {
    expect(accepted('café.txt').key).toBe(accepted('café.txt').key);
  });

  it('keeps different names different', () => {
    expect(wfsPathKey('a.txt')).not.toBe(wfsPathKey('b.txt'));
    expect(wfsPathKey('src/a')).not.toBe(wfsPathKey('src_a'));
  });
});

describe('WonderFS paths: helpers', () => {
  it('finds the parent', () => {
    expect(wfsParentPath('a/b/c.txt')).toBe('a/b');
    expect(wfsParentPath('c.txt')).toBeNull();
  });

  it('knows what is beneath a folder, and that a sibling with a longer name is not', () => {
    expect(wfsIsBeneath('src/a.txt', 'src')).toBe(true);
    expect(wfsIsBeneath('src2/a.txt', 'src')).toBe(false);
    expect(wfsIsBeneath('src', 'src')).toBe(false);
  });

  it('rebases a descendant component-wise', () => {
    expect(wfsRebase('a/b/c.txt', 1, ['z', 'y'])).toBe('z/y/b/c.txt');
    expect(wfsRebase('Straße/x.txt', 1, ['new'])).toBe('new/x.txt');
  });
});
