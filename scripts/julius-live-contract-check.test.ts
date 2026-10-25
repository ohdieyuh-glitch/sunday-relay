import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * THE SPEND TABLE, PINNED.
 *
 * `MISSION_LIMITS` in `scripts/julius-live-contract-check.mjs` is the grant a
 * contract cannot make for itself. This file is the list. Adding a namespace,
 * or changing a number, is a reviewable edit of this pin.
 */

const CHECK = 'scripts/julius-live-contract-check.mjs';
const SOURCE = readFileSync(CHECK, 'utf8');

const MISSION_LIMITS: Readonly<Record<string, { readonly spendUsd: number; readonly repairCycles: number }>> = {
  'julius-live-mission-2': { spendUsd: 20, repairCycles: 3 },
  'julius-live-mission-3': { spendUsd: 20, repairCycles: 3 },
  'julius-live-mission-4': { spendUsd: 20, repairCycles: 3 },
  'julius-live-mission-5': { spendUsd: 30, repairCycles: 3 },
  'julius-continuous-1': { spendUsd: 60, repairCycles: 3 },
  'julius-unreal-mission-1': { spendUsd: 30, repairCycles: 3 },
  'julius-learning-pair-1': { spendUsd: 30, repairCycles: 3 },
  'julius-learning-pair-2': { spendUsd: 30, repairCycles: 3 },
  'julius-diag-output-safety-1': { spendUsd: 100, repairCycles: 3 },
  'julius-diag-output-safety-2': { spendUsd: 100, repairCycles: 3 },
  'julius-diag-audit-fixes-1': { spendUsd: 100, repairCycles: 3 },
  'julius-diag-digest-evidence-1': { spendUsd: 100, repairCycles: 3 },
  'julius-inworld-data-1': { spendUsd: 30, repairCycles: 3 },
};

function limitsTable(): Map<string, { spendUsd: number; repairCycles: number }> {
  const start = SOURCE.indexOf('const MISSION_LIMITS = Object.freeze({');
  const end = SOURCE.indexOf('\n});', start);
  const body = SOURCE.slice(start, end);
  const found = new Map<string, { spendUsd: number; repairCycles: number }>();
  for (const match of body.matchAll(/'([a-z0-9-]+)': Object\.freeze\(\{ spendUsd: (\d+), repairCycles: (\d+) \}\)/gu)) {
    found.set(match[1]!, { spendUsd: Number(match[2]), repairCycles: Number(match[3]) });
  }
  return found;
}

describe('MISSION_LIMITS', () => {
  it('pins every namespace grant, including julius-inworld-data-1 at 30 dollars and 3 repair cycles', () => {
    const found = limitsTable();
    expect(Object.fromEntries(found)).toEqual(MISSION_LIMITS);
    expect(found.get('julius-inworld-data-1')).toEqual({ spendUsd: 30, repairCycles: 3 });
    expect([...SOURCE.matchAll(/julius-inworld-data-1/gu)]).toHaveLength(1);
  });

  it('leaves the default at five dollars and one repair cycle', () => {
    expect(SOURCE).toMatch(/const DEFAULT_LIMITS = Object\.freeze\(\{ spendUsd: 5, repairCycles: 1 \}\)/u);
  });

  it('the checker accepts that grant and refuses one dollar or one cycle past it', () => {
    const base = JSON.parse(readFileSync('.github/julius-missions/julius-live-mission-2/contract.json', 'utf8')) as Record<string, unknown>;
    const check = (limits: { spendUsd: number; repairCycles: number }, namespace: string) => {
      const file = join(mkdtempSync(join(realpathSync(tmpdir()), 'julius-inworld-limits-')), 'contract.json');
      writeFileSync(file, JSON.stringify({ ...base, markerNamespace: namespace, limits }));
      try {
        return { code: 0, output: execFileSync(process.execPath, [CHECK, file], { encoding: 'utf8' }) };
      } catch (error) {
        const failure = error as { status?: number; stdout?: string; stderr?: string };
        return { code: failure.status ?? 1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
      }
    };
    expect(check({ spendUsd: 30, repairCycles: 3 }, 'julius-inworld-data-1').code).toBe(0);
    const overSpend = check({ spendUsd: 31, repairCycles: 3 }, 'julius-inworld-data-1');
    expect(overSpend.code).toBe(1);
    expect(overSpend.output).toContain('above the 30 ceiling for julius-inworld-data-1');
    const overRepair = check({ spendUsd: 30, repairCycles: 4 }, 'julius-inworld-data-1');
    expect(overRepair.code).toBe(1);
    expect(overRepair.output).toContain('above the 3 allowed for julius-inworld-data-1');
    const leaked = check({ spendUsd: 30, repairCycles: 3 }, 'julius-some-future-mission');
    expect(leaked.code).toBe(1);
    expect(leaked.output).toContain('above the 5 ceiling for julius-some-future-mission');
  }, 30_000);
});
