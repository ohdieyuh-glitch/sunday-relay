/**
 * WHAT EVERY JULIUS CAPABILITY DRILL SHARES.
 *
 * A drill is not a test. A test asserts that a function returns what its
 * author expected; a drill DRIVES production code against real infrastructure,
 * writes down what it saw step by step, and files an attestation the Beta Gate
 * independently verifies before it will report the capability proven. The gate
 * refuses that attestation unless its digests still match this tree, its paths
 * cover the row's own probe, and its transcript carries the declared passing
 * steps and no failing one — so what lives here is the machinery for producing
 * evidence in exactly the shape the gate checks, and nothing that decides a
 * verdict.
 *
 * There is deliberately no `pass()` helper that takes a boolean it does not
 * look at. Every step records the value it read, so a transcript says what was
 * true rather than that something was fine.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

/**
 * THE COLUMNS THE BETA GATE READS, restated here rather than imported from it.
 *
 * Importing the gate would drag its module-scope `import.meta.url` and its
 * run-as-a-program guard into a drill's bundle, where both would resolve to
 * that bundle and the gate would run in place of the drill. So the list is
 * declared, and `julius-drill-support.test.ts` asserts it is character for
 * character the gate's own — the same parity idiom the contract brief uses,
 * for the same reason: two writers of one document drift the day one of them
 * learns about a field.
 */
export const CAPABILITY_PROOF_COLUMNS = [
  'capability', 'drill', 'outcome', 'steps', 'infrastructure',
  'exercised_path', 'exercised_digest', 'transcript', 'recorded_at',
] as const;

export interface DrillStep { readonly ok: boolean; readonly name: string; readonly detail: string }

/**
 * A drill's transcript and its step ledger, kept together so they cannot
 * disagree about how many steps there were — which is the one number the gate
 * holds the transcript to.
 */
export class DrillRecord {
  readonly lines: string[] = [];
  readonly steps: DrillStep[] = [];

  say(...lines: readonly string[]): void { for (const line of lines) this.lines.push(line); }

  /** One observation. `detail` is what was actually read, not a restatement of the name. */
  step(name: string, ok: boolean, detail = ''): boolean {
    this.steps.push({ ok, name, detail });
    this.lines.push(`  [${ok ? 'PASS' : 'FAIL'}] ${this.steps.length}. ${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
  }

  get failures(): DrillStep[] { return this.steps.filter((row) => !row.ok); }

  /**
   * Close the transcript on the drill's own verdict line, which the gate
   * requires to be an all-capitals VERIFIED sentence. `verified` is derived
   * from the steps, never passed in: a drill that could be told it passed is a
   * drill that can be told anything.
   */
  seal(name: string): boolean {
    const verified = this.failures.length === 0;
    this.say('');
    this.say(verified ? `${name} VERIFIED` : `${name} DRILL FAILED: ${this.failures.length} step(s).`);
    return verified;
  }
}

/** Reads one scalar from the database. `null` means the query returned no row. */
export function scalarReader(pool: Pool) {
  return async (sql: string, params: readonly unknown[] = []): Promise<string | null> => {
    const result = await pool.query(sql, [...params]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) return null;
    const value = Object.values(row)[0];
    return value === null || value === undefined ? null : String(value);
  };
}

/**
 * The ledger the Beta Gate reads. A FAILED drill still writes one, recording
 * the outcome it actually had — a drill that files nothing when it fails
 * teaches a reader that silence means success, and the gate refuses any row
 * whose outcome is not VERIFIED anyway.
 *
 * The digest is taken at the moment the drill ran, which is what makes the
 * proof expire: edit one of these files and the gate recomputes a different
 * hash and reports CAPABILITY STALE rather than carrying yesterday's proof
 * forward over today's code.
 */
export function writeAttestation(input: {
  readonly outDir: string;
  readonly repoRoot: string;
  readonly capability: string;
  readonly drill: string;
  readonly exercised: readonly string[];
  readonly infrastructure: string;
  readonly transcriptFile: string;
  readonly record: DrillRecord;
  readonly verified: boolean;
}): void {
  mkdirSync(input.outDir, { recursive: true });
  writeFileSync(join(input.outDir, input.transcriptFile), `${input.record.lines.join('\n')}\n`);
  const recordedAt = new Date().toISOString();
  const rows = input.exercised.map((path) => [
    input.capability,
    input.drill,
    input.verified ? 'VERIFIED' : 'FAILED',
    String(input.record.steps.length),
    input.infrastructure,
    path,
    `sha256:${createHash('sha256').update(readFileSync(join(input.repoRoot, path))).digest('hex')}`,
    input.transcriptFile,
    recordedAt,
  ].join('\t'));
  /**
   * MERGED, NEVER OVERWRITTEN.
   *
   * Three drills run into one directory in CI and in a mission bundle, and the
   * gate reads ONE ledger. A writer that truncated would leave the last drill's
   * proof and silently discard the other two — a directory that looks complete
   * and proves a third of what it says. Rows for THIS drill are replaced (a
   * rerun supersedes itself); every other drill's rows are carried through
   * untouched.
   */
  const ledger = join(input.outDir, 'capability-proofs.tsv');
  const header = CAPABILITY_PROOF_COLUMNS.join('\t');
  const kept: string[] = [];
  if (existsSync(ledger)) {
    const lines = readFileSync(ledger, 'utf8').split('\n')
      .filter((line) => line.length > 0 && !/^\(\d+ rows?\)$/.test(line));
    const existingHeader = lines[0] ?? '';
    if (existingHeader !== header) {
      // Overwriting would destroy evidence this writer cannot read; saying
      // nothing would be worse. The drill fails on its own output instead.
      throw new Error('capability_proof_ledger_header_mismatch: refusing to overwrite a ledger this drill cannot merge');
    }
    const mine = `${input.capability}\t${input.drill}\t`;
    kept.push(...lines.slice(1).filter((line) => !line.startsWith(mine)));
  }
  const all = [...kept, ...rows];
  writeFileSync(ledger, `${[header, ...all, `(${all.length} rows)`].join('\n')}\n`);
}
