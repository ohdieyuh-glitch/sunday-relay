import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileHostedEnvelope, juliusHostedCreationAuthority,
  HOSTED_ALLOWED_TOOLS, HOSTED_CREATION_TOOL, HOSTED_DISALLOWED_TOOLS,
  type HostedCreationRecord,
} from './hosted-envelope';
import type { JuliusFileCreationPolicy } from '../../src/relay/mission/julius/julius-file-creation';

/**
 * THE TOOL AND ITS AUTHORITY ARRIVE TOGETHER, OR NOT AT ALL.
 *
 * The kernel decision is proven on its own in `julius-file-creation.test.ts`. What
 * these cases hold is the WIRING, which is where a capability like this usually
 * goes wrong: a tool granted whose authority was never passed, an authority that
 * inspects the wrong argument name, or a permission system that records only its
 * refusals and so cannot answer "what did this dispatch create".
 */

const ROOT = resolve(import.meta.dirname, '../..');

const policy: JuliusFileCreationPolicy = Object.freeze({
  permittedPaths: Object.freeze(['src', 'tests']),
  outOfScope: Object.freeze(['src/vendor']),
  maxBytes: 4096,
  mayOverwrite: false,
});

const authority = (exists: readonly string[] = []) => {
  const records: HostedCreationRecord[] = [];
  const decide = juliusHostedCreationAuthority({
    policy,
    observe: (relativePath) => exists.includes(relativePath),
    record: (entry) => records.push(entry),
  });
  return { decide, records };
};

const write = (filePath: string, content = 'x') =>
  ({ toolName: HOSTED_CREATION_TOOL, input: { file_path: filePath, content } });

describe('the envelope grants Write only with its authority', () => {
  it('WITHOUT a creation policy the tool is denied, exactly as before', () => {
    const envelope = compileHostedEnvelope({ workspacePath: '/w' });
    expect(envelope.allowedTools).toEqual([...HOSTED_ALLOWED_TOOLS]);
    expect(envelope.disallowedTools).toContain(HOSTED_CREATION_TOOL);
    expect(envelope.allowedTools, 'the default must not change').not.toContain(HOSTED_CREATION_TOOL);
  });

  it('WITH a creation policy the tool is allowed and no longer denied', () => {
    const envelope = compileHostedEnvelope({ workspacePath: '/w', creation: policy });
    expect(envelope.allowedTools).toContain(HOSTED_CREATION_TOOL);
    expect(envelope.disallowedTools, 'a tool in both lists is a contradiction the runtime resolves, not us')
      .not.toContain(HOSTED_CREATION_TOOL);
    // Nothing else moved. Bash in particular is still denied, because creation and
    // command execution are separate questions.
    for (const tool of ['Bash', 'WebFetch', 'WebSearch', 'Task']) {
      expect(envelope.disallowedTools, tool).toContain(tool);
    }
    expect(envelope.permissionMode).toBe('acceptEdits');
    expect(envelope.settingSources, 'no settings file may widen this').toEqual([]);
  });

  it('the frozen lists are not mutated by granting the tool', () => {
    compileHostedEnvelope({ workspacePath: '/w', creation: policy });
    expect(HOSTED_DISALLOWED_TOOLS).toContain(HOSTED_CREATION_TOOL);
    expect(HOSTED_ALLOWED_TOOLS).not.toContain(HOSTED_CREATION_TOOL);
  });
});

describe('Julius answers the permission question before the write', () => {
  it('permits a new file under a permitted path, and records that it did', () => {
    const { decide, records } = authority();
    expect(decide(write('src/settings/toggle.ts'))).toEqual({ behavior: 'allow' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ allowed: true, refusal: null, requestedPath: 'src/settings/toggle.ts' });
  });

  it('refuses a traversal and tells the model what to do differently', () => {
    const { decide, records } = authority();
    const answer = decide(write('../../etc/passwd'));
    expect(answer).not.toBeNull();
    expect(answer!.behavior).toBe('deny');
    if (answer!.behavior === 'deny') {
      expect(answer!.message, 'the refusal name is in the message the model reads').toContain('path_traversal');
      expect(answer!.message.length).toBeGreaterThan(30);
    }
    expect(records[0]).toMatchObject({ allowed: false, refusal: 'path_traversal' });
  });

  it('refuses an absolute path, a control location and a credential file', () => {
    const { decide } = authority();
    for (const [path, refusal] of [
      ['/etc/passwd', 'path_absolute'],
      ['src/.git/hooks/pre-commit', 'path_control_location'],
      ['src/.npmrc', 'path_credential_location'],
      ['src/vendor/lib.ts', 'path_out_of_scope'],
      ['elsewhere/x.ts', 'path_not_permitted'],
    ] as const) {
      const answer = decide(write(path));
      expect(answer?.behavior, path).toBe('deny');
      if (answer?.behavior === 'deny') expect(answer.message, path).toContain(refusal);
    }
  });

  it('the OVERWRITE rule is answered from the observation, not from the model', () => {
    // `exists` comes from the caller looking at the workspace. A model that
    // believes a file is new cannot make it new by saying so.
    const fresh = authority();
    expect(fresh.decide(write('src/known.ts'))).toEqual({ behavior: 'allow' });

    const occupied = authority(['src/known.ts']);
    const answer = occupied.decide(write('src/known.ts'));
    expect(answer?.behavior).toBe('deny');
    if (answer?.behavior === 'deny') expect(answer.message).toContain('overwrite_not_authorized');
  });

  it('the size ceiling is measured in BYTES of the actual content, not characters', () => {
    const { decide } = authority();
    // A multi-byte character costs more than one byte, and a ceiling counted in
    // characters would under-measure it.
    const wide = 'é'.repeat(2049); // 2 bytes each in UTF-8 → 4098 > 4096
    const answer = decide(write('src/wide.ts', wide));
    expect(answer?.behavior).toBe('deny');
    if (answer?.behavior === 'deny') expect(answer.message).toContain('content_too_large');
    expect(decide(write('src/ok.ts', 'a'.repeat(4096)))).toEqual({ behavior: 'allow' });
  });

  it('reads the path from whichever argument name the tool used', () => {
    const { decide } = authority();
    for (const key of ['file_path', 'path', 'filePath']) {
      const answer = decide({ toolName: HOSTED_CREATION_TOOL, input: { [key]: 'src/a.ts', content: 'x' } });
      expect(answer, key).toEqual({ behavior: 'allow' });
    }
  });

  it('a missing or non-string path is refused rather than treated as the workspace root', () => {
    const { decide } = authority();
    for (const input of [{ content: 'x' }, { file_path: 42, content: 'x' }, { file_path: '', content: 'x' }]) {
      const answer = decide({ toolName: HOSTED_CREATION_TOOL, input: input as Record<string, unknown> });
      expect(answer?.behavior, JSON.stringify(input)).toBe('deny');
    }
  });

  it('has NO OPINION about any other tool, so the tool policy stays in one place', () => {
    const { decide, records } = authority();
    for (const toolName of ['Edit', 'Read', 'Grep', 'Glob', 'Bash']) {
      expect(decide({ toolName, input: { file_path: '/etc/passwd' } }), toolName).toBeNull();
    }
    expect(records, 'and nothing is recorded for a tool it does not govern').toEqual([]);
  });

  it('records EVERY decision, so "what did this dispatch create" is answerable', () => {
    const { decide, records } = authority();
    decide(write('src/a.ts'));
    decide(write('../escape.ts'));
    decide(write('tests/b.test.ts'));
    expect(records).toHaveLength(3);
    expect(records.filter((entry) => entry.allowed).map((entry) => entry.requestedPath))
      .toEqual(['src/a.ts', 'tests/b.test.ts']);
    expect(records.filter((entry) => !entry.allowed)).toHaveLength(1);
  });
});

/**
 * THE CAPABILITY EXISTS AND IS NOT YET REACHED, AND THAT IS ASSERTED RATHER THAN
 * LEFT TO BE ASSUMED.
 *
 * Everything above is real: the decision, the authority, the conditional grant,
 * all tested. What no code yet does is PASS a `creation` policy on the live path,
 * because the path bounds live in Julius's coding-agent permissions packet while
 * the invoker seam carries only a tool policy. So a live mission still cannot
 * create a file, and "the capability is built" is not the same claim as "a
 * new-file mission can complete".
 *
 * This case fails the day someone wires it, which is the point: the wiring is a
 * deliberate act with a security consequence — the first dispatch that can write
 * a file it chose — and it should not arrive as a side effect of an unrelated
 * change. Whoever wires it updates this case and says so.
 */
describe('the creation capability is composed but not yet reached', () => {
  it('no live composition passes a creation policy, so Write is still denied in production', () => {
    const sources = [
      'relay-bridge/julius/live-workers.ts',
      'relay-bridge/julius/live-composition.ts',
      'relay-bridge/julius/claude-code-coding-provider.ts',
      'relay-bridge/hosted-coding-agent/hosted-runner.ts',
      'relay-bridge/hosted-coding-agent/hosted-invoker.ts',
    ];
    const wired = sources.filter((path) => /creation\s*:/u.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(wired,
      'a live caller now passes `creation`, so a dispatch can create files — update this case, and check the bounds it passes',
    ).toEqual([]);
  });
});
