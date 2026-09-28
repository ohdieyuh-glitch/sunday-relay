import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE CLASSIFICATION PAGE, HELD TO ITS OWN NUMBERS.
 *
 * `docs/JULIUS_GENERALITY_CLASSIFICATION.md` says which of Julius's narrownesses
 * blocks a real user task, and every verdict rests on a constant: 4 MiB, a tool
 * allowlist, a frozen network policy, an image tag. A page like this is at its
 * most dangerous when it is nearly right — a reader trusts the verdict, the
 * constant behind it moved, and nobody re-derives the verdict.
 *
 * So the load-bearing constants are asserted HERE rather than described there. If
 * the workspace ceiling is raised, or the agent is granted `Write`, or the image
 * gains Python, this suite fails and the page must be rewritten. It does NOT
 * assert the verdicts themselves: a verdict is a judgement about a user task, and
 * a test that pinned it would only be repeating the prose.
 */

const ROOT = resolve(import.meta.dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');
const PAGE = 'docs/JULIUS_GENERALITY_CLASSIFICATION.md';

describe('the generality classification still describes this repository', () => {
  it('the Coding Agent still cannot create a file or run a command', () => {
    const envelope = read('relay-bridge/hosted-coding-agent/hosted-envelope.ts');
    /**
     * ANCHORED ON `Object.freeze([`, NOT ON THE NEXT BRACKET.
     *
     * The first attempt read `HOSTED_ALLOWED_TOOLS[^[]*\[([^\]]*)\]` and captured
     * NOTHING, because the declaration is annotated `readonly string[]` and that
     * annotation's own brackets come first. It failed loudly, which is the only
     * reason it was caught: had the list been non-empty by accident the page's
     * first two rows would have been "verified" by a regex reading a type.
     */
    const listAfter = (identifier: string): string => {
      const at = envelope.indexOf(identifier);
      expect(at, `${identifier} must still exist`).toBeGreaterThan(-1);
      return /Object\.freeze\(\[([\s\S]*?)\]\)/u.exec(envelope.slice(at))?.[1] ?? '';
    };
    const allowed = listAfter('HOSTED_ALLOWED_TOOLS');
    const denied = listAfter('HOSTED_DISALLOWED_TOOLS');
    const names = (block: string): string[] =>
      [...block.matchAll(/'([A-Za-z]+)'/gu)].map((match) => match[1]!);
    expect(names(allowed).length, 'an empty read here would pass every check below vacuously')
      .toBeGreaterThan(0);

    expect(names(allowed).sort(), 'the page says the agent may only read, search and edit')
      .toEqual(['Edit', 'Glob', 'Grep', 'Read']);
    for (const tool of ['Write', 'Bash', 'NotebookEdit']) {
      expect(names(denied), `${tool} being granted would make the page's first two rows wrong`)
        .toContain(tool);
    }
  });

  it('the live trio still builds the HOSTED coder, so that envelope is the paid one', () => {
    expect(read('relay-bridge/julius/live-composition.ts'))
      .toContain("workerId: 'coding-agent-claude-hosted'");
  });

  it('the workspace ceiling is still 4 MiB, and still measured against the WHOLE filesystem', () => {
    expect(read('src/relay/workspace/julius-tools/workspace-provisioning.ts'))
      .toContain('BETA_WORKSPACE_BYTES=4_194_304');
    const adapter = read('src/relay/workspace/julius-tools/docker-sandbox-adapter.ts');
    // The distinction the page turns on: this is `total`, not bytes used, so a
    // directory on a big filesystem is refused however empty it is.
    expect(adapter).toContain('total>workspaceBytes');
    expect(adapter).toContain('sandbox_workspace_ceiling_unenforceable');
  });

  it('the sandbox still has no network, with no per-mission override', () => {
    expect(read('relay-bridge/julius/sandbox-limits.ts')).toContain("network: 'DENY'");
    const adapter = read('src/relay/workspace/julius-tools/docker-sandbox-adapter.ts');
    expect(adapter, 'the argv still hard-codes it').toContain("'--network','none'");
    expect(adapter, 'and MEDIATED is still unavailable rather than silently downgraded')
      .toContain('sandbox_mediated_network_unavailable');
  });

  it('the execution image is still Node-only', () => {
    const images = read('.github/julius-live-images.sh');
    expect(images).toContain("'FROM node:22-bookworm-slim'");
    for (const absent of ['python', 'rustc', 'golang', 'openjdk', 'dotnet']) {
      expect(images.toLowerCase(), `${absent} in the image would change row 5`).not.toContain(absent);
    }
  });

  it('CI still forbids a non-Node command and a contract that asks for a new file', () => {
    const suite = read('scripts/julius-first-live-mission.test.ts');
    expect(suite).toContain("expect(command, mission).toBe('node')");
    expect(suite).toContain('must ask for edits, never for a new file');
  });

  it('a live BUILD still records only TEST and DIFF, which is why the gate names those two', () => {
    const workers = read('relay-bridge/julius/live-workers.ts');
    const recorded = new Set([...workers.matchAll(/type: '([A-Z_]+)'/gu)].map((match) => match[1]!));
    // ARTIFACT appears, but on the architect, a consultation and a rebuttal — never
    // on a build — and `verifyTask` scopes evidence to the task. The gate's
    // producible set is the one place that decides this.
    expect(read('scripts/julius-live-contract-check.mjs'))
      .toContain("const BUILD_EVIDENCE = ['TEST', 'DIFF']");
    expect([...recorded].sort(), 'a new evidence type here may widen what a contract may require')
      .toEqual(['ARTIFACT', 'DIFF', 'REVIEW_FINDING', 'TEST']);
  });

  it('research authority is still a grant table, and still refuses a self-grant', () => {
    const gate = read('scripts/julius-live-contract-check.mjs');
    expect(gate).toContain('MISSION_RESEARCH');
    expect(gate).toContain('a contract cannot grant itself research authority');
  });

  it('every row of the page carries a verdict from the closed vocabulary', () => {
    const page = read(PAGE);
    const rows = page.split('\n').filter((line) => /^\| \d+ \|/u.test(line));
    expect(rows.length, 'the page should still classify nine findings').toBe(9);
    for (const row of rows) {
      const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
      expect(cells.length, `row has the wrong number of cells: ${row}`).toBe(4);
      for (const verdict of cells.slice(2)) {
        expect(verdict, `"${verdict}" is not one of the three verdicts`)
          .toMatch(/MVP BLOCKER|MVP LIMITATION|POST-MVP/u);
      }
    }
  });

  it('the page names the finding that was FIXED rather than classifying it', () => {
    // The preflight contradiction is not a row, because it is not outstanding.
    // Leaving it in the table would overstate what remains.
    const page = read(PAGE);
    expect(page).toContain('already fixed is not in the table');
    expect(page).toContain('julius-contract-verification-modes.test.ts');
  });
});
