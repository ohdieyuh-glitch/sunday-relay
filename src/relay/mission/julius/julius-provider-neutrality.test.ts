import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * JULIUS IS NOT THE THREE PROVIDERS IT WAS QUALIFIED WITH.
 *
 * The beta trio — an OpenAI architect, a hosted Claude coder, a Hermes reviewer —
 * is a set of REFERENCE CONFIGURATIONS. It proves the adapters and the
 * lifecycle; it must never become what Julius means. The founder's rule is
 * explicit: the qualification trio "must not hard-code Julius conceptually to
 * those models".
 *
 * THAT IS A STRUCTURAL PROPERTY, SO IT IS CHECKED STRUCTURALLY. A vendor name,
 * a model id or an adapter id inside the kernel would be the moment Julius
 * stopped being provider-neutral, and it would arrive one innocuous line at a
 * time: a default model in a policy, a special case for one connector's quirk,
 * a comparison against `'anthropic'`. This sweep reads the kernel's own source
 * and fails on the first such line.
 *
 * WHAT IS ALLOWED, AND WHY. Prose in a comment may name a provider — the
 * reasons a rule exists are often a specific paid run's history, and erasing
 * that would cost more than it protects. What may not appear is a provider name
 * or model id in CODE: the sweep strips comments and string-free lines before
 * looking. Fixtures and tests are excluded for the same reason they always are:
 * a test that scripts a provider has to name one.
 */

const ROOT = resolve(import.meta.dirname, '../../../..');
const KERNEL = 'src/relay/mission/julius';

/** Vendors, model families and the trio's adapter ids. Lower-cased before the match. */
const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
  [/\bopenai\b/u, 'a vendor'],
  [/\banthropic\b/u, 'a vendor'],
  [/\bxai\b/u, 'a vendor'],
  [/\bgrok[-\w]*\b/u, 'a model family'],
  [/\bgpt-[\w.]+\b/u, 'a model id'],
  [/\bclaude-[\w.]+\b/u, 'a model id'],
  [/\bsonnet\b|\bopus\b|\bhaiku\b/u, 'a model id'],
  [/openai-architect-live|claude-agent-sdk-hosted-live|hermes-local-live/u, 'an adapter id'],
];

/** Comment-only text is prose about history; code is the claim this sweep reads. */
const codeOf = (source: string): readonly { readonly line: number; readonly text: string }[] => {
  const lines: { line: number; text: string }[] = [];
  let inBlock = false;
  for (const [index, raw] of source.split(/\r?\n/u).entries()) {
    let text = raw;
    if (inBlock) {
      const close = text.indexOf('*/');
      if (close < 0) continue;
      text = text.slice(close + 2);
      inBlock = false;
    }
    for (;;) {
      const open = text.indexOf('/*');
      if (open < 0) break;
      const close = text.indexOf('*/', open + 2);
      if (close < 0) { text = text.slice(0, open); inBlock = true; break; }
      text = text.slice(0, open) + text.slice(close + 2);
    }
    const slashes = text.indexOf('//');
    if (slashes >= 0) text = text.slice(0, slashes);
    if (text.trim() !== '') lines.push({ line: index + 1, text });
  }
  return lines;
};

/**
 * THE TWO LINES THAT MAY NAME A VENDOR, each for a reason that is not a binding.
 *
 * A NAMED EXEMPTION IS NOT A LOOPHOLE: it is one line, one file, one reason,
 * and a new one costs whoever adds it an argument in this list.
 */
const EXEMPT: readonly (readonly [string, RegExp, string])[] = [
  [
    'src/relay/mission/julius/julius-router.ts', /CREDENTIAL_SHAPED/u,
    'A CREDENTIAL-PREFIX DETECTOR, which is the opposite of a binding: `xai` appears '
    + 'as one of the token prefixes that must never be recorded. Removing it would '
    + 'stop a secret being redacted in order to keep a sweep quiet.',
  ],
  [
    'src/relay/mission/julius/julius-router.ts', /transport:safeEnum\(v\.transport/u,
    'A CLOSED VOCABULARY OF TRANSPORTS ALREADY IN DURABLE ROWS. One member is named '
    + 'after the API shape a connector speaks (`relay-bridge/julius/live-workers.ts` '
    + 'and `openai-reviewer.ts` write it), so renaming it would make every recorded '
    + 'diagnostics row read `null` for its transport — rewriting history to improve a '
    + 'name. It binds nothing: `provider` beside it is a free token, and no routing, '
    + 'policy or completion rule reads either.',
  ],
];

describe('the Julius kernel names no provider, model or adapter', () => {
  const files = execFileSync('git', ['ls-files', `${KERNEL}/*.ts`], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/u)
    .filter((file) => file.trim() !== '')
    // A fixture scripts providers by definition; a test has to name what it drives.
    .filter((file) => !file.endsWith('.test.ts') && !file.endsWith('-fixtures.ts'));

  it('sweeps the whole kernel, so the count itself is part of the proof', () => {
    expect(files.length, 'the kernel is not a handful of files').toBeGreaterThan(40);
  });

  it('every exemption is still needed, and still has its reason', () => {
    // An exemption that no longer matches anything is a licence nobody is using,
    // and the next reader would take it for a precedent.
    for (const [file, pattern, reason] of EXEMPT) {
      expect(files, `${file} is exempted but not swept`).toContain(file);
      expect(pattern.test(readFileSync(resolve(ROOT, file), 'utf8')), `${file}: the exempted line is gone`).toBe(true);
      expect(reason.length, `${file}: an exemption without a reason is a loophole`).toBeGreaterThan(80);
    }
    expect(EXEMPT, 'two exemptions; a third needs an argument in the list').toHaveLength(2);
  });

  it.each(files.map((file) => [file] as const))('%s', (file) => {
    const exemptions = EXEMPT.filter(([path]) => path === file).map(([, pattern]) => pattern);
    const offenders: string[] = [];
    for (const { line, text } of codeOf(readFileSync(resolve(ROOT, file), 'utf8'))) {
      if (exemptions.some((pattern) => pattern.test(text))) continue;
      const lowered = text.toLowerCase();
      for (const [pattern, what] of FORBIDDEN) {
        if (pattern.test(lowered)) offenders.push(`${file}:${line} names ${what}: ${text.trim().slice(0, 120)}`);
      }
    }
    expect(offenders, 'the kernel must be neutral in code; prose may explain history').toEqual([]);
  });
});
