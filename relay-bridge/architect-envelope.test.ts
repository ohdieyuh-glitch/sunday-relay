import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_TIMEOUT_MS, architectOperativeTimeoutMs, evaluateReadiness,
  readGptArchitectConfig,
} from '../src/relay/connectors/gpt-architect/config';
import {
  BRIDGE_ARCHITECT_DEFAULT_MAX_TOKENS, BRIDGE_ARCHITECT_DEFAULT_TIMEOUT_MS, architectPreflight,
  loadArchitectConfig,
} from './openai-architect';
import { architectWorker } from './julius/live-composition';

/**
 * ONE VARIABLE, TWO ARCHITECTS, AND A DEADLINE THAT WAS DECLARED WITHOUT BEING
 * RESOLVED.
 *
 * `RELAY_PROMPT_ARCHITECT_TIMEOUT_MS` and `RELAY_PROMPT_ARCHITECT_MAX_TOKENS`
 * are each read by TWO modules, and the two disagreed about what an unset
 * environment means:
 *
 *   src/relay/connectors/gpt-architect/config.ts   300_000 ms   4,000 tokens
 *   relay-bridge/openai-architect.ts                90_000 ms   1,200 tokens
 *
 * Both pairs arrived in one commit (97106c56) and neither referenced the
 * other. The VALUES are defensible — Julius's connector asks for a full plan,
 * the bridge path for one compact handoff — so this file pins them rather than
 * unifying them. What was not defensible is that nothing said so, and nothing
 * tested it.
 *
 * THE DEFECT WITH TEETH was one layer along. Julius's composition root
 * DECLARED its architect's deadline as `DEFAULT_TIMEOUT_MS` — the fallback —
 * while the number that actually cuts the call off is
 * `readGptArchitectConfig(env).timeoutMs`, which the variable moves. The two
 * agreed only under the empty environment, which is the one every test used.
 * That is exactly the declared-versus-operative drift `reviewer-deadline.ts`
 * was written to end, surviving one role over, underneath a comment claiming
 * it had been ended. The job-budget arithmetic in `coder-envelope.test.ts` was
 * built on the same fallback and would have kept passing while the real worst
 * case outgrew the job.
 *
 * These proofs therefore sweep environments that SET the variable, because
 * under the empty one every broken version of this code is indistinguishable
 * from a correct one.
 */

const ROOT = process.cwd();
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/** Every tracked source file, from git — the same enumeration the boundary
    scanners use, so an untracked scratch file cannot hide a third reader. */
const trackedSources = (): readonly string[] =>
  execFileSync('git', ['ls-files', '*.ts', '*.mts', '*.cts'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(path => path !== '' && !path.endsWith('.test.ts') && !path.endsWith('.d.ts'));

const readersOf = (variable: string): readonly string[] =>
  trackedSources().filter(path => read(path).includes(`env.${variable}`));

describe('1–4 · the declared deadline and the operative one, under environments that differ', () => {
  it('1 · the worker declares exactly what bounds the call, for every value swept', () => {
    // THE ASSERTION THE OLD ONE COULD NOT MAKE. `toBe(DEFAULT_TIMEOUT_MS)` is
    // satisfied by the empty environment and by nothing else being true.
    for (const value of ['1000', '90000', '300000', '412000', '900000']) {
      const env = { RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: value };
      expect(architectWorker(env).timeoutMs, `at ${value}`).toBe(Number(value));
      expect(architectWorker(env).timeoutMs, `at ${value}`).toBe(architectOperativeTimeoutMs(env));
    }
  });

  it('2 · and still agrees when nothing is set', () => {
    expect(architectWorker({}).timeoutMs).toBe(architectOperativeTimeoutMs({}));
    expect(architectWorker({}).timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('3 · an unusable value falls back on BOTH sides identically', () => {
    // Zero, negative and non-numeric are refused by `readGptArchitectConfig`,
    // which is the one place that decides. A declaration that did its own
    // parsing would be a second opinion about a malformed input.
    for (const value of ['0', '-1', 'soon', '']) {
      const env = { RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: value };
      expect(architectWorker(env).timeoutMs, `at ${JSON.stringify(value)}`).toBe(DEFAULT_TIMEOUT_MS);
      expect(architectWorker(env).timeoutMs).toBe(architectOperativeTimeoutMs(env));
    }
  });

  it('4 · the composition resolves the deadline and does not restate it', () => {
    const source = read('relay-bridge/julius/live-composition.ts');
    expect(source, 'the worker must read the resolver').toContain('architectOperativeTimeoutMs(env)');
    // The mutation this kills: going back to the fallback constant, which reads
    // like a derivation and is one step short of being one.
    expect(source).not.toMatch(/timeoutMs:\s*(?:DEFAULT_TIMEOUT_MS|ARCHITECT_OPERATIVE_TIMEOUT_MS)\b/u);
    // And one worker object serves both the registration and the adapter, so
    // two resolutions of one environment cannot drift.
    expect(source).toContain('const worker = architectWorker(options.env);');
  });
});

describe('5–8 · one variable, two envelopes, and both of them named', () => {
  it('5 · the two defaults differ, deliberately, and this is the record of it', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(300_000);
    expect(BRIDGE_ARCHITECT_DEFAULT_TIMEOUT_MS).toBe(90_000);
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(4_000);
    expect(BRIDGE_ARCHITECT_DEFAULT_MAX_TOKENS).toBe(1_200);
    // Stated as a relationship, not four unrelated numbers: the path that asks
    // for the larger answer is the path that waits longer for it.
    expect(DEFAULT_TIMEOUT_MS).toBeGreaterThan(BRIDGE_ARCHITECT_DEFAULT_TIMEOUT_MS);
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBeGreaterThan(BRIDGE_ARCHITECT_DEFAULT_MAX_TOKENS);
  });

  it('6 · neither read site carries a bare literal any more', () => {
    // A literal at the read site is how the two defaults came to exist without
    // either knowing about the other.
    const bridge = read('relay-bridge/openai-architect.ts');
    expect(bridge).toContain('env.RELAY_PROMPT_ARCHITECT_TIMEOUT_MS ?? BRIDGE_ARCHITECT_DEFAULT_TIMEOUT_MS');
    expect(bridge).toContain('env.RELAY_PROMPT_ARCHITECT_MAX_TOKENS ?? BRIDGE_ARCHITECT_DEFAULT_MAX_TOKENS');
    const connector = read('src/relay/connectors/gpt-architect/config.ts');
    expect(connector).toContain('env.RELAY_PROMPT_ARCHITECT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS');
    expect(connector).toContain('env.RELAY_PROMPT_ARCHITECT_MAX_TOKENS ?? DEFAULT_MAX_OUTPUT_TOKENS');
  });

  it('7 · setting the variable moves BOTH paths — it is not scoped to one', () => {
    // The coupling, asserted rather than assumed. An operator raising the
    // timeout for Julius also raises it for the Relay demo mission, and nobody
    // should have to read two files to discover that.
    const env = { RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: '250000', RELAY_PROMPT_ARCHITECT_MAX_TOKENS: '2500' };
    expect(readGptArchitectConfig(env).timeoutMs).toBe(250_000);
    expect(loadArchitectConfig(env as unknown as NodeJS.ProcessEnv).timeoutMs).toBe(250_000);
    expect(readGptArchitectConfig(env).maxOutputTokens).toBe(2_500);
    expect(loadArchitectConfig(env as unknown as NodeJS.ProcessEnv).maxOutputTokens).toBe(2_500);
  });

  it('8 · exactly these two modules read either variable, and no third', () => {
    // THE GUARD THAT MAKES THE REST HOLD. A third reader with a fourth default
    // is how this started; it must not be able to appear unnoticed. Adding one
    // is fine — pin its default here and say why it differs.
    const expected = [
      'relay-bridge/openai-architect.ts',
      'src/relay/connectors/gpt-architect/config.ts',
    ];
    for (const variable of ['RELAY_PROMPT_ARCHITECT_TIMEOUT_MS', 'RELAY_PROMPT_ARCHITECT_MAX_TOKENS']) {
      expect([...readersOf(variable)].sort(), `readers of ${variable}`).toEqual(expected);
    }
  });
});

/**
 * 9–13 · A BOUND SOMEBODY SET AND NOBODY CAN USE.
 *
 * The two paths disagreed about malformed input as well as about defaults. The
 * bridge's `architectPreflight` refused a non-positive timeout and named the
 * variable; the connector coerced it to `DEFAULT_TIMEOUT_MS` and said nothing,
 * so an operator who asked for something got something else in silence. That
 * is the same class as "unknown is not zero" one level up: a value that was
 * supplied and could not be used is not the same fact as a value nobody
 * supplied, and only one of the two may be answered with a default.
 *
 * `.env.example` is where this stopped being hypothetical. It SET both
 * variables, to the demo path's numbers, so any environment copied from it ran
 * Julius's architect on a 1,200-token ceiling and a 90 s deadline.
 */
describe('9–13 · an unusable bound is refused by name, on both paths', () => {
  const liveish = { OPENAI_API_KEY: 'k', OPENAI_PROMPT_ARCHITECT_MODEL: 'm', RELAY_PROMPT_ARCHITECT_MODE: 'live' };

  it('9 · the connector refuses it and names the variable, as the bridge already did', () => {
    for (const value of ['0', '-1', 'soon', '']) {
      const env = { ...liveish, RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: value };
      const readiness = evaluateReadiness(readGptArchitectConfig(env));
      expect(readiness.ready, `timeout=${JSON.stringify(value)}`).toBe(false);
      expect(readiness.missing).toContain('RELAY_PROMPT_ARCHITECT_TIMEOUT_MS');
      // And the bridge path, unchanged, refuses the same input the same way.
      const bridge = architectPreflight(loadArchitectConfig(env as unknown as NodeJS.ProcessEnv));
      expect(bridge.ready).toBe(false);
      expect(bridge.missing).toContain('RELAY_PROMPT_ARCHITECT_TIMEOUT_MS');
    }
  });

  it('10 · the token ceiling is refused the same way', () => {
    const env = { ...liveish, RELAY_PROMPT_ARCHITECT_MAX_TOKENS: '-5' };
    expect(evaluateReadiness(readGptArchitectConfig(env)).missing)
      .toContain('RELAY_PROMPT_ARCHITECT_MAX_TOKENS');
    expect(architectPreflight(loadArchitectConfig(env as unknown as NodeJS.ProcessEnv)).missing)
      .toContain('RELAY_PROMPT_ARCHITECT_MAX_TOKENS');
  });

  it('11 · an ABSENT bound is not a fault — the default is the honest answer', () => {
    // The distinction the whole change turns on. Refusing an unset variable
    // would break every deployment that has never set one, and would be wrong:
    // nobody asked for anything, so nothing was ignored.
    const readiness = evaluateReadiness(readGptArchitectConfig(liveish));
    expect(readiness.ready).toBe(true);
    expect(readiness.missing).toEqual([]);
    expect(readGptArchitectConfig(liveish).unusable).toEqual([]);
  });

  it('12 · the resolved bound stays usable, so nothing downstream sees a zero', () => {
    // `runGptArchitect` hands `timeoutMs` to the OpenAI client. A 0 there is a
    // different failure entirely, so the fault travels as a NAME and the number
    // stays sane.
    const config = readGptArchitectConfig({ ...liveish, RELAY_PROMPT_ARCHITECT_TIMEOUT_MS: '0' });
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
    expect(config.unusable).toEqual(['RELAY_PROMPT_ARCHITECT_TIMEOUT_MS']);
  });

  it('13 · .env.example documents both variables and SETS neither', () => {
    // What it used to set was one path's answer for a variable both paths read.
    const env = read('.env.example');
    for (const name of ['RELAY_PROMPT_ARCHITECT_TIMEOUT_MS', 'RELAY_PROMPT_ARCHITECT_MAX_TOKENS']) {
      const lines = [...env.matchAll(new RegExp(`^\\s*#?\\s*${name}=(.*)$`, 'gm'))];
      expect(lines.length, `${name} must still be documented`).toBeGreaterThan(0);
      for (const [line, value] of lines) {
        expect(line.trimStart().startsWith('#'), `${line.trim()} must be commented out`).toBe(true);
        expect(value.replace(/#.*$/u, '').trim(), `${line.trim()} carries a value`).toBe('');
      }
    }
    // And it teaches BOTH envelopes, so an operator reading only this file does
    // not learn one path's numbers as if they were the variable's meaning.
    for (const fragment of ['1,200 tokens / 90 s', '4,000 tokens / 300 s']) {
      expect(env, `.env.example must state ${fragment}`).toContain(fragment);
    }
  });
});
