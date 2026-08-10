import { describe, expect, it } from 'vitest';

import { runShape } from './hosted-invoker';

/**
 * "REQUIRED REPORT MARKER IS ABSENT" IS TRUE AND USELESS ON ITS OWN.
 *
 * A real hosted run failed with exactly that and nothing else, after the
 * Prompt Architect had been paid and the workspace prepared. The sentence
 * cannot distinguish an agent that did the work and forgot the marker, from
 * one that hit its turn ceiling, from one the provider errored on before it
 * touched a file. The observation held all three answers; none reached the
 * operator.
 *
 * The shape is surfaced. The TEXT never is — it is model output that can quote
 * the workspace, and the report parser is the only thing that should read it.
 */

const observation = (over: Partial<Parameters<typeof runShape>[0]> = {}) => ({
  resultSubtype: 'success' as string | null,
  isError: false as boolean | null,
  numTurns: 3 as number | null,
  toolsUsed: ['Edit'] as readonly string[],
  finalText: 'some model output' as string | null,
  ...over,
});

describe('the run shape separates the cases that look identical', () => {
  it('reports an agent that hit its turn ceiling', () => {
    const out = runShape(observation({ resultSubtype: 'error_max_turns', isError: true, numTurns: 12 }));
    expect(out).toContain('result=error_max_turns');
    expect(out).toContain('isError=true');
    expect(out).toContain('turns=12');
  });

  it('reports an agent that said nothing at all', () => {
    // finalTextChars=0 with toolsUsed=0 is "it did not work", which reads
    // completely differently from "it worked and omitted the marker".
    const out = runShape(observation({ finalText: null, toolsUsed: [] }));
    expect(out).toContain('finalTextChars=0');
    expect(out).toContain('toolsUsed=0');
  });

  it('reports an agent that worked and still failed the parse', () => {
    const out = runShape(observation({ toolsUsed: ['Read', 'Edit'], finalText: 'x'.repeat(400) }));
    expect(out).toContain('toolsUsed=2');
    expect(out).toContain('finalTextChars=400');
  });

  it('NEVER includes the final text', () => {
    const secret = ['sk', 'notarealvalue0000'].join('-');
    const out = runShape(observation({ finalText: `I edited /srv/app/src/x.js using ${secret}` }));
    expect(out).not.toContain(secret);
    expect(out).not.toContain('/srv');
    expect(out).not.toContain('edited');
  });

  it('refuses a result subtype that is not an SDK enum', () => {
    // `resultSubtype` comes off provider output. Only the enum shape is
    // echoed, so a sentence cannot ride out through it.
    const out = runShape(observation({ resultSubtype: 'leaked secret sk-abcdefghijklmnop here' }));
    expect(out).not.toContain('leaked');
    expect(out).not.toContain('result=');
  });

  it('reports unknown fields as absent rather than inventing them', () => {
    const out = runShape(observation({ resultSubtype: null, isError: null, numTurns: null }));
    expect(out).not.toContain('result=');
    expect(out).not.toContain('isError=');
    expect(out).not.toContain('turns=');
    // The two it can always answer are still there.
    expect(out).toContain('toolsUsed=');
    expect(out).toContain('finalTextChars=');
  });
});
