import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A SOURCE FILE GIT CANNOT DIFF IS A FILE NOBODY REVIEWED.
 *
 * Git decides a file is binary by looking for a NUL byte in its first 8 000,
 * and a binary file produces `Binary files a/… and b/… differ` instead of a
 * diff — in `git diff`, in `git log -p`, and in the PR view a reviewer reads.
 * Five production files carried literal NUL bytes, written as raw bytes where
 * an escape was meant:
 *
 *   `const SECTION = '<NUL>JULIUS-SECTION-9f2a<NUL>';`
 *
 * Three of them were past the threshold and were genuinely binary to git, so
 * every change to them shipped unreviewable — including two that arrived in
 * #279 and whose review therefore could not see them. The other two held the
 * hazard one edit away: move that line earlier, or grow the file, and the
 * threshold is crossed silently.
 *
 * Written as an escape, the same character is the same character: nothing
 * about the running program changes. What changes is that the file can be read
 * by the people who approve it.
 *
 * This file may not spell that escape literally either — a test that forbids a
 * byte cannot contain it — so the separator below is built rather than typed.
 *
 * ESC (0x1b) is deliberately NOT refused: the CLI renders real ANSI sequences,
 * git diffs those files perfectly well, and banning them would be a rule about
 * taste rather than about whether a change can be seen.
 */

const SOURCE = /\.(?:ts|tsx|mjs|cjs|js|jsx|sql|json|md|ya?ml)$/u;

const trackedSourceFiles = (): readonly string[] =>
  execFileSync('git', ['ls-files', '-z'], { cwd: process.cwd(), maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split(String.fromCharCode(0))
    .filter((path) => path.length > 0 && SOURCE.test(path));

/**
 * THE SCAN ITSELF, as a value.
 *
 * A gate whose only test is "the repository passes today" cannot tell the
 * difference between finding nothing and looking for nothing. This is the
 * thing the repository is checked with AND the thing the cases below feed
 * known-bad bytes to, so the two can never diverge.
 */
export const juliusNulOffenders = (
  files: readonly { readonly path: string; readonly bytes: Uint8Array }[],
): readonly string[] => files.flatMap(({ path, bytes }) => {
  const at = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).indexOf(0);
  // WHERE matters: only a NUL inside git's sniffing window makes the file
  // binary, but one past it is a single edit away from being inside it.
  return at === -1 ? [] : [`${path} (first NUL at byte ${String(at)}${at < 8000 ? ' — BINARY to git' : ''})`];
});

describe('every tracked source file can be diffed', () => {
  it('holds no NUL byte, so git never calls it binary', () => {
    const offenders = juliusNulOffenders(trackedSourceFiles().map((path) => ({
      path, bytes: readFileSync(join(process.cwd(), path)),
    })));
    expect(offenders, 'write the escape rather than a raw NUL byte').toEqual([]);
  });

  it('finds a NUL wherever it is, so a passing run means something', () => {
    const clean = Buffer.from('const SECTION = "JULIUS";', 'utf8');
    const early = Buffer.concat([Buffer.from('const SECTION = "', 'utf8'), Buffer.from([0]), Buffer.from('";', 'utf8')]);
    // Past git's sniffing window: still refused, because one edit moves it in.
    const late = Buffer.concat([Buffer.alloc(9000, 0x61), Buffer.from([0])]);

    expect(juliusNulOffenders([{ path: 'clean.ts', bytes: clean }])).toEqual([]);
    expect(juliusNulOffenders([{ path: 'early.ts', bytes: early }]))
      .toEqual(['early.ts (first NUL at byte 17 — BINARY to git)']);
    expect(juliusNulOffenders([{ path: 'late.ts', bytes: late }]), 'a late NUL is still an offender')
      .toEqual(['late.ts (first NUL at byte 9000)']);
    expect(juliusNulOffenders([{ path: 'a.ts', bytes: early }, { path: 'b.ts', bytes: late }]), 'and every file is reported')
      .toHaveLength(2);
  });

  it('is reading a real file list, so the gate cannot pass by finding nothing', () => {
    const files = trackedSourceFiles();
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('relay-bridge/julius/coder-workspace.ts');
  });
});
