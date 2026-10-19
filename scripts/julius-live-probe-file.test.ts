import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  PROBE_CANDIDATE_LIMIT,
  PROBE_MAX_BYTES,
  PROBE_PREFERRED,
  PROBE_LIST_COMMAND,
  chooseProbeFile,
  orderProbeCandidates,
  parseTrackedPaths,
  resolveProbeFile,
} from './julius-live-probe-file';

const reader = (files: Record<string, Buffer | string | Error>) => (path: string): Buffer => {
  const entry = files[path];
  if (entry === undefined) {
    const error = new Error(`ENOENT: no such file or directory, open '${path}'`) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    throw error;
  }
  if (entry instanceof Error) throw entry;
  return typeof entry === 'string' ? Buffer.from(entry, 'utf8') : entry;
};

describe('probe candidate ordering', () => {
  it('tries the preferred name first so the throwaway-tree missions probe what they always probed', () => {
    expect(orderProbeCandidates(['a.txt', 'package.json', PROBE_PREFERRED, 'z.txt'])[0]).toBe(PROBE_PREFERRED);
  });

  it('keeps git\'s own order when the preferred name is not tracked', () => {
    expect(orderProbeCandidates(['a.txt', 'b.txt'])).toEqual(['a.txt', 'b.txt']);
  });

  it('leaves tooling paths for last, so a slice mission probes source rather than its import harness', () => {
    expect(orderProbeCandidates(['.julius/loader.mjs', '.julius/resolve.mjs', 'src/a.ts'])).toEqual([
      'src/a.ts', '.julius/loader.mjs', '.julius/resolve.mjs',
    ]);
  });

  it('still offers a tooling path when it is all there is', () => {
    expect(orderProbeCandidates(['.julius/loader.mjs'])).toEqual(['.julius/loader.mjs']);
  });

  it('treats a dot in any segment as tooling, not only the first', () => {
    expect(orderProbeCandidates(['a/.hidden/x.txt', 'b.txt'])).toEqual(['b.txt', 'a/.hidden/x.txt']);
  });

  it('never offers the same path twice', () => {
    const ordered = orderProbeCandidates([PROBE_PREFERRED, 'a.txt', PROBE_PREFERRED]);
    expect(ordered).toEqual([PROBE_PREFERRED, 'a.txt']);
  });

  it('drops empty entries rather than trying to read them', () => {
    expect(orderProbeCandidates(['', 'a.txt'])).toEqual(['a.txt']);
  });
});

describe('choosing the hand-off probe file', () => {
  it('chooses a tracked text file when the assumed README does not exist — the Mission 4 case', () => {
    // Exactly what `git ls-files` prints in the first slice mission's workspace,
    // import harness included.
    const tracked = [
      '.julius/loader.mjs',
      '.julius/resolve.mjs',
      'src/relay/mission/julius/julius-memory-trust.test.ts',
      'src/relay/mission/julius/julius-memory-trust.ts',
      'src/relay/mission/julius/julius-repair-lineage.ts',
      'src/relay/mission/julius/julius-runtime.ts',
    ].sort();
    const chosen = chooseProbeFile(tracked, reader({ 'src/relay/mission/julius/julius-memory-trust.test.ts': 'export const spec = 1;\n' }));
    expect(chosen.ok).toBe(true);
    // Mission source, not the harness that merely makes it importable.
    expect(chosen.ok && chosen.path).toBe('src/relay/mission/julius/julius-memory-trust.test.ts');
  });

  it('prefers README.md when git tracks it, so the earlier missions are unchanged', () => {
    const chosen = chooseProbeFile(['package.json', PROBE_PREFERRED], reader({ [PROBE_PREFERRED]: '# seed\n', 'package.json': '{}\n' }));
    expect(chosen.ok && chosen.path).toBe(PROBE_PREFERRED);
  });

  it('skips an unreadable path and reports its errno', () => {
    const chosen = chooseProbeFile(['gone.txt', 'here.txt'], reader({ 'here.txt': 'ok\n' }));
    expect(chosen.ok && chosen.path).toBe('here.txt');
  });

  it('skips a file git would diff as binary because it contains a NUL byte', () => {
    const chosen = chooseProbeFile(
      ['logo.png', 'here.txt'],
      reader({ 'logo.png': Buffer.from([0x89, 0x50, 0x00, 0x0d]), 'here.txt': 'ok\n' }),
    );
    expect(chosen.ok && chosen.path).toBe('here.txt');
  });

  it('skips bytes that are not valid UTF-8', () => {
    const chosen = chooseProbeFile(
      ['latin1.txt', 'here.txt'],
      reader({ 'latin1.txt': Buffer.from([0x68, 0xff, 0xfe, 0x69]), 'here.txt': 'ok\n' }),
    );
    expect(chosen.ok && chosen.path).toBe('here.txt');
  });

  it('skips a file larger than the probe ceiling', () => {
    const chosen = chooseProbeFile(
      ['huge.txt', 'here.txt'],
      reader({ 'huge.txt': Buffer.alloc(PROBE_MAX_BYTES + 1, 0x61), 'here.txt': 'ok\n' }),
    );
    expect(chosen.ok && chosen.path).toBe('here.txt');
  });

  it('accepts an empty tracked file — appending a marker still produces a diff that carries it', () => {
    const chosen = chooseProbeFile(['empty.txt'], reader({ 'empty.txt': Buffer.alloc(0) }));
    expect(chosen.ok && chosen.path).toBe('empty.txt');
  });

  it('returns the bytes it read, so the caller can restore them exactly', () => {
    const bytes = Buffer.from('no trailing newline', 'utf8');
    const chosen = chooseProbeFile(['a.txt'], reader({ 'a.txt': bytes }));
    expect(chosen.ok && chosen.content.equals(bytes)).toBe(true);
  });

  it('refuses, with every reason, when nothing tracked can carry the proof', () => {
    const chosen = chooseProbeFile(
      ['gone.txt', 'logo.png', 'huge.txt'],
      reader({ 'logo.png': Buffer.from([0x00]), 'huge.txt': Buffer.alloc(PROBE_MAX_BYTES + 1, 0x61) }),
    );
    expect(chosen.ok).toBe(false);
    if (chosen.ok) throw new Error('unreachable');
    expect(chosen.rejected.map((r) => r.reason)).toEqual([
      'unreadable:ENOENT',
      'binary:contains_nul_byte',
      `too_large:${PROBE_MAX_BYTES + 1}`,
    ]);
  });

  it('refuses an empty tracked list — an untracked workspace diffs to nothing', () => {
    const chosen = chooseProbeFile([], reader({}));
    expect(chosen.ok).toBe(false);
    if (chosen.ok) throw new Error('unreachable');
    expect(chosen.tracked).toBe(0);
    expect(chosen.rejected).toEqual([]);
  });

  it('reads a bounded number of candidates rather than a whole repository', () => {
    const tracked = Array.from({ length: 5_000 }, (_, index) => `f${String(index).padStart(5, '0')}.bin`);
    let reads = 0;
    const chosen = chooseProbeFile(tracked, () => { reads += 1; return Buffer.from([0x00]); });
    expect(chosen.ok).toBe(false);
    expect(reads).toBe(PROBE_CANDIDATE_LIMIT);
    if (chosen.ok) throw new Error('unreachable');
    expect(chosen.examined).toBe(PROBE_CANDIDATE_LIMIT);
    expect(chosen.tracked).toBe(5_000);
  });
});

describe('parsing what git ls-files printed', () => {
  it('takes one path per line and drops the blank tail', () => {
    expect(parseTrackedPaths('a.txt\nb/c.txt\n')).toEqual(['a.txt', 'b/c.txt']);
  });

  it('survives CRLF', () => {
    expect(parseTrackedPaths('a.txt\r\nb.txt\r\n')).toEqual(['a.txt', 'b.txt']);
  });

  it('is empty for empty output, which the chooser then refuses', () => {
    expect(parseTrackedPaths('')).toEqual([]);
  });
});

/* THE PROPERTY THE WHOLE PROBE EXISTS FOR, against real git: the chosen file,
 * appended to and then restored, produces a diff that CONTAINS the marker and
 * then a working tree that is CLEAN again. A chooser that picked an untracked
 * or binary file would pass every unit test above and still hand the reviewer
 * an empty diff — which is precisely the failure this probe is meant to catch. */
describe('against real git', () => {
  const git = (args: readonly string[], cwd: string): string =>
    execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 'p', GIT_AUTHOR_EMAIL: 'p@invalid', GIT_COMMITTER_NAME: 'p', GIT_COMMITTER_EMAIL: 'p@invalid' },
    });

  const seeded = (files: Record<string, Buffer | string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'julius-probe-'));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    git(['init', '--quiet', '--initial-branch=main', '.'], root);
    git(['add', '-A'], root);
    git(['commit', '--quiet', '-m', 'seed'], root);
    return root;
  };

  it('the file chosen from a slice-shaped workspace carries the marker into the diff and restores clean', () => {
    // A slice mission's workspace: real Relay paths, no README, one binary.
    const root = seeded({
      'src/relay/mission/julius/julius-memory-trust.ts': 'export const stub = 1;',
      'src/relay/mission/julius/julius-memory-trust.test.ts': 'import { stub } from "./julius-memory-trust";\n',
      'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]),
    });
    try {
      const tracked = parseTrackedPaths(git(['-c', 'core.quotePath=false', 'ls-files'], root));
      expect(tracked).not.toContain(PROBE_PREFERRED);

      const chosen = chooseProbeFile(tracked, (relative) => readFileSync(join(root, relative)));
      expect(chosen.ok).toBe(true);
      if (!chosen.ok) throw new Error('unreachable');
      expect(chosen.path).not.toBe('assets/logo.png');

      const marker = 'julius-live-preflight-marker';
      const target = join(root, chosen.path);
      writeFileSync(target, Buffer.concat([chosen.content, Buffer.from(`\n${marker}\n`, 'utf8')]));

      const diff = git(['--no-pager', 'diff'], root);
      expect(diff).toContain(marker);

      writeFileSync(target, chosen.content);
      expect(readFileSync(target).equals(chosen.content)).toBe(true);
      expect(git(['status', '--porcelain=v1'], root).trim()).toBe('');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('a binary file would have produced a diff WITHOUT the marker — which is why it is rejected', () => {
    const root = seeded({ 'assets/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]) });
    try {
      const bytes = readFileSync(join(root, 'assets/logo.png'));
      writeFileSync(join(root, 'assets/logo.png'), Buffer.concat([bytes, Buffer.from('\njulius-live-preflight-marker\n', 'utf8')]));
      expect(git(['--no-pager', 'diff'], root)).not.toContain('julius-live-preflight-marker');

      // And the chooser refuses it, so the preflight never gets there.
      const tracked = parseTrackedPaths(git(['-c', 'core.quotePath=false', 'ls-files'], root));
      expect(chooseProbeFile(tracked, (relative) => readFileSync(join(root, relative))).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('an untracked-only workspace is refused rather than probed into an empty diff', () => {
    const root = mkdtempSync(join(tmpdir(), 'julius-probe-'));
    try {
      git(['init', '--quiet', '--initial-branch=main', '.'], root);
      writeFileSync(join(root, 'loose.txt'), 'never added\n');
      const tracked = parseTrackedPaths(git(['-c', 'core.quotePath=false', 'ls-files'], root));
      expect(tracked).toEqual([]);
      expect(chooseProbeFile(tracked, (relative) => readFileSync(join(root, relative))).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('the seam the preflight calls', () => {
  const ok = (stdout: string) => async () => ({ status: 'SUCCEEDED', exitCode: 0, stdout, stderr: '' });

  it('sends the sandbox exactly the command the preflight documents', async () => {
    let sent: string | null = null;
    await resolveProbeFile(async (command) => { sent = command; return { status: 'SUCCEEDED', exitCode: 0, stdout: 'a.txt\n', stderr: '' }; },
      () => Buffer.from('x\n', 'utf8'));
    expect(sent).toBe(PROBE_LIST_COMMAND);
  });

  it('resolves a tracked text file', async () => {
    const resolved = await resolveProbeFile(ok('a.txt\nb.txt\n'), () => Buffer.from('x\n', 'utf8'));
    expect(resolved.ok && resolved.path).toBe('a.txt');
    expect(resolved.ok && resolved.tracked).toBe(2);
  });

  it('reports a failed listing as its own failure, never as "no candidate"', async () => {
    const resolved = await resolveProbeFile(
      async () => ({ status: 'FAILED', exitCode: 128, stdout: '', stderr: 'fatal: not a git repository' }),
      () => Buffer.from('x\n', 'utf8'),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error('unreachable');
    expect(resolved.failure).toBe('list_failed');
    expect(resolved.failure === 'list_failed' && resolved.stderr).toContain('not a git repository');
  });

  it('treats a zero exit with a non-SUCCEEDED status as a failed listing — the executor answers both', async () => {
    const resolved = await resolveProbeFile(async () => ({ status: 'TIMED_OUT', exitCode: 0, stdout: '', stderr: '' }), () => Buffer.from('x\n', 'utf8'));
    expect(resolved.ok === false && resolved.failure).toBe('list_failed');
  });

  it('reports no_candidate, with reasons, when the listing worked but nothing can carry the proof', async () => {
    const resolved = await resolveProbeFile(ok('logo.png\n'), () => Buffer.from([0x00]));
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error('unreachable');
    expect(resolved.failure).toBe('no_candidate');
    expect(resolved.failure === 'no_candidate' && resolved.rejected.map((r) => r.reason)).toEqual(['binary:contains_nul_byte']);
  });

  it('reports no_candidate for an empty repository rather than choosing nothing silently', async () => {
    const resolved = await resolveProbeFile(ok(''), () => Buffer.from('x\n', 'utf8'));
    expect(resolved.ok === false && resolved.failure).toBe('no_candidate');
    expect(resolved.ok === false && resolved.failure === 'no_candidate' && resolved.tracked).toBe(0);
  });
});
