import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { architectWorker, CODER_WORKER, reviewerWorker } from '../relay-bridge/julius/live-composition';

/**
 * THE DRILL WORKER TABLES ARE COPIES, AND A COPY THAT DRIFTS PROVES SOMETHING
 * ELSE.
 *
 * Three PostgreSQL drills each declare their own architect, coder and reviewer
 * rather than importing the production ones, because each scripts its own
 * adapters for its own scenario. That is legitimate; what is not is a drill
 * registering a task type production does not serve. Such a drill passes while
 * exercising a route no paid mission can take, which is the most expensive kind
 * of green.
 *
 * THE INVARIANT IS SUBSET, NOT EQUALITY. A drill may be NARROWER than
 * production — none of them needs the guidance stages, because none of their
 * scripted adapters answers one — and it may never be wider or different. So a
 * typo, a stale name, or a stage invented for a drill fails here, and a stage
 * added to production does not.
 */
const DRILLS = [
  'scripts/julius-recovery-drill.ts',
  'scripts/julius-repair-loop-drill.ts',
  'scripts/julius-failure-recovery-drill.ts',
] as const;

const PRODUCTION: Readonly<Record<string, readonly string[]>> = Object.freeze({
  PROMPT_ARCHITECT: architectWorker({}).taskTypes,
  CODING_AGENT: CODER_WORKER.taskTypes,
  INDEPENDENT_REVIEWER: reviewerWorker('xai').taskTypes,
});

interface Registration { readonly role: string; readonly taskTypes: readonly string[] }

/**
 * Read the tables out of the source.
 *
 * Source-reading rather than importing, because the constants are file-local —
 * exporting them purely to be asserted would change production shape to suit a
 * test. The window is bounded so the match cannot run from one worker's `role`
 * into the next worker's `taskTypes`.
 */
function registrationsIn(relativePath: string): Registration[] {
  const source = readFileSync(resolve(__dirname, '..', relativePath), 'utf8');
  const pattern = /role:\s*'([A-Z_]+)'[^;]{0,300}?taskTypes:\s*\[([^\]]*)\]/gu;
  const found: Registration[] = [];
  for (const match of source.matchAll(pattern)) {
    const taskTypes = [...match[2]!.matchAll(/'([^']+)'/gu)].map((entry) => entry[1]!);
    found.push({ role: match[1]!, taskTypes });
  }
  return found;
}

describe('a drill may be narrower than production and never different from it', () => {
  it.each(DRILLS)('%s registers all three slots', (drill) => {
    const roles = registrationsIn(drill).map((entry) => entry.role);
    expect(new Set(roles)).toEqual(new Set(Object.keys(PRODUCTION)));
  });

  it.each(DRILLS)('%s names only task types production serves', (drill) => {
    for (const registration of registrationsIn(drill)) {
      const production = PRODUCTION[registration.role];
      expect(production, `${registration.role} is a real slot`).toBeDefined();
      expect(registration.taskTypes.length, `${registration.role} registers something`).toBeGreaterThan(0);
      for (const taskType of registration.taskTypes) {
        expect(
          production, `${drill}: ${registration.role} registers ${taskType}, which production does not serve`,
        ).toContain(taskType);
      }
    }
  });
});
