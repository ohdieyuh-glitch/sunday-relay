import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('Looking for Feed C++ row', () => {
  it('AC-13 the feed row labels and the open-feed predicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lff-feed-'));
    const binary = join(dir, 'lff-feed-logic-test');
    try {
      execFileSync('g++', [
        '-std=c++17',
        `-I${join(ROOT, 'wonderland/Tools/SyntaxStubs')}`,
        `-I${join(ROOT, 'wonderland/Source/Wonderland')}`,
        join(ROOT, 'wonderland/Tools/lff-feed-logic-test.cpp'),
        join(ROOT, 'wonderland/Source/Wonderland/WonderlandLffFeed.cpp'),
        '-o',
        binary,
      ], { encoding: 'utf8' });
      const ran = execFileSync(binary, { encoding: 'utf8' });
      expect(ran.trim()).toBe('ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
