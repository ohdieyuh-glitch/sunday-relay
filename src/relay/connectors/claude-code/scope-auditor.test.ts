import { describe, expect, it } from 'vitest';
import { auditToolScope, classifyTarget } from './scope-auditor';
import type { SafeToolActivity } from './stream-parser';

/**
 * The scope auditor is the measurement behind an ADVISORY control. These
 * tests pin the behaviour that makes it worth trusting: containment is
 * decided by resolved location, not by how a path is spelled, and anything
 * unclassifiable counts as an escape rather than a pass.
 */

const WS = '/tmp/relay-ws/run-1';
const activity = (tool: string, ...targets: string[]): SafeToolActivity => ({ tool, targets });

describe('classifyTarget', () => {
  it('accepts a relative path inside the workspace', () => {
    expect(classifyTarget('src/normalize.js', WS)).toBe('src/normalize.js');
  });

  it('accepts an absolute path inside the workspace', () => {
    expect(classifyTarget(`${WS}/src/normalize.js`, WS)).toBe('src/normalize.js');
  });

  it('rejects an absolute path outside the workspace', () => {
    expect(classifyTarget('/etc/passwd', WS)).toBeNull();
  });

  it('rejects a traversal that climbs out of the workspace', () => {
    expect(classifyTarget('../../../etc/shadow', WS)).toBeNull();
  });

  it('rejects a traversal that lands on a sibling worktree', () => {
    expect(classifyTarget(`${WS}/../run-2/secret.txt`, WS)).toBeNull();
  });

  it('rejects a prefix-collision sibling directory', () => {
    // `/tmp/relay-ws/run-10` shares a string prefix with `/tmp/relay-ws/run-1`
    // but is a different directory. A naive startsWith check would pass it.
    expect(classifyTarget('/tmp/relay-ws/run-10/loot.txt', WS)).toBeNull();
  });

  it('treats a path that traverses out and back as contained', () => {
    expect(classifyTarget(`${WS}/src/../src/normalize.js`, WS)).toBe('src/normalize.js');
  });

  it('records a relative glob pattern as scope, not as an escape', () => {
    expect(classifyTarget('**/*.js', WS)).toBe('**/*.js');
  });

  it('still resolves an ABSOLUTE glob rather than excusing it as a pattern', () => {
    expect(classifyTarget('/etc/**', WS)).toBeNull();
  });

  it('rejects a tilde path, which node:path would otherwise resolve as relative', () => {
    // The case the gate exists for: a shell expands `~` to the home
    // directory, `node:path` does not, so an unguarded resolve would record
    // the founder's credential file as a path INSIDE the workspace.
    expect(classifyTarget('~/.claude/.credentials.json', WS)).toBeNull();
    expect(classifyTarget('~', WS)).toBeNull();
    expect(classifyTarget('~/', WS)).toBeNull();
  });

  it('does not reject a real file that merely starts with a tilde character', () => {
    // `~backup.js` is an ordinary relative filename, not a home reference.
    expect(classifyTarget('~backup.js', WS)).toBe('~backup.js');
  });

  it('rejects an unclassifiable target instead of passing it', () => {
    expect(classifyTarget('', WS)).toBeNull();
    expect(classifyTarget('   ', WS)).toBeNull();
    expect(classifyTarget('src/\0evil', WS)).toBeNull();
  });
});

describe('auditToolScope', () => {
  it('reports containment and the inspected paths for an in-workspace run', () => {
    const result = auditToolScope(
      [activity('Read', 'src/normalize.js'), activity('Grep', '**/*.js'), activity('Edit', 'src/normalize.js')],
      WS,
    );
    expect(result.contained).toBe(true);
    expect(result.escapes).toEqual([]);
    // Deduped and sorted, so a receipt is stable run to run.
    expect(result.filesInspected).toEqual(['**/*.js', 'src/normalize.js']);
    expect(result.toolsUsed).toEqual(['Read', 'Grep', 'Edit']);
  });

  it('fails containment on a single escape and names the tool that reached out', () => {
    const result = auditToolScope(
      [activity('Read', 'src/normalize.js'), activity('Read', '/home/founder/.claude/.credentials.json')],
      WS,
    );
    expect(result.contained).toBe(false);
    expect(result.escapes).toEqual(['Read: /home/founder/.claude/.credentials.json']);
    // The legitimate read is still recorded — evidence is not discarded
    // because the run was refused.
    expect(result.filesInspected).toEqual(['src/normalize.js']);
  });

  it('reports an empty, contained audit when no tool activity was observed', () => {
    const result = auditToolScope([], WS);
    expect(result).toEqual({ filesInspected: [], escapes: [], toolsUsed: [], contained: true });
  });

  it('bounds what it records so a noisy run cannot balloon a receipt', () => {
    const many = Array.from({ length: 500 }, (_, i) => activity('Read', `/outside/${i}.txt`));
    const result = auditToolScope(many, WS);
    expect(result.contained).toBe(false);
    expect(result.escapes.length).toBeLessThanOrEqual(100);
  });
});
