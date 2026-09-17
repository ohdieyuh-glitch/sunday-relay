import { sanitizeJuliusCodingAgentReport } from './julius-coding-agent';
import { sanitizeJuliusCoderObservations } from './julius-architecture-drift';
import { sanitizeJuliusArchitecture } from './julius-architecture-state';
import { describe, expect, it } from 'vitest';
import {
  JULIUS_CHECKPOINT_LIMITS,
  JULIUS_GUIDANCE_LIMITS,
  sanitizeJuliusGuidanceRequest,
} from './julius-continuous-lifecycle';
import {
  JULIUS_RESEARCH_ASK_FIELDS,
  JULIUS_RESEARCH_ASK_FORBIDDEN_FIELDS,
  JULIUS_RESEARCH_ASK_LIMITS,
  sanitizeJuliusResearchAsks,
} from './julius-research-protocol';
import { JULIUS_SEGMENT_LIMITS, sanitizeJuliusSegmentState } from './julius-segment-lineage';
import {
  JULIUS_PARTICIPATION_CHANNELS,
  JULIUS_PARTICIPATION_LIMITS,
  JULIUS_PARTICIPATION_MARKER,
  JULIUS_PARTICIPATION_REFUSALS,
  juliusParticipationProtocol,
  readJuliusParticipationBlock,
} from './julius-worker-participation';
import { LIVE_REACH_ACTION_CAPABILITIES, LIVE_REACH_READ_CAPABILITIES, LIVE_REACH_SOURCES } from '../live-reach';

/**
 * THE CHANNEL A WORKER WITH NO OUTPUT SCHEMA ASKS THROUGH.
 *
 * The properties below are the ones that decide whether the continuous
 * lifecycle is real on a paid run: a request is read exactly as written, an
 * ambiguous one is refused rather than guessed at, and a worker's silence is
 * never mistaken for either.
 */

const block = (json: string, prose = 'Done.'): string => `${prose}\n${JULIUS_PARTICIPATION_MARKER}\n${json}\n`;

const ASK = {
  source: 'web', capability: 'read_item',
  reference: 'https://www.postgresql.org/docs/current/app-psql.html',
  purpose: 'Establish what psql writes for a SQL NULL in unaligned output.',
};

describe('a worker that says nothing is not a worker that asked', () => {
  it('no marker is ABSENT, and absent is not a refusal', () => {
    const reading = readJuliusParticipationBlock('I implemented the module and the tests pass.');
    expect(reading.present).toBe(false);
    // The union has nowhere to put a reason when nothing was asked; a caller
    // that treated "no block" as "unreadable block" would report every ordinary
    // dispatch as a failed request.
    expect('reasonCode' in reading).toBe(false);
  });

  it('a null or empty final message is ABSENT, never an error', () => {
    expect(readJuliusParticipationBlock(null).present).toBe(false);
    expect(readJuliusParticipationBlock('').present).toBe(false);
  });
});

describe('a request is carried EXACTLY as the worker wrote it', () => {
  it('the guidance request reaches the caller untouched, and the domain sanitizer accepts it', () => {
    const request = {
      question: 'What does the evidence exporter write for a SQL NULL?',
      blockedOn: ['the exporter is not in this workspace'],
      attempted: ['read every file in the slice'],
      relevantPaths: ['src/relay/mission/julius/julius-bundle-cell.ts'],
    };
    const reading = readJuliusParticipationBlock(block(JSON.stringify({ guidanceRequest: request })));
    expect(reading).toMatchObject({ present: true, readable: true, channels: ['guidanceRequest'] });
    if (!reading.present || !reading.readable) return;
    expect(reading.guidanceRequest).toEqual(request);
    // THE SEAM IS REAL, not merely shaped right: what comes out of the block is
    // what `driveContinuousLifecycle` will hand to the domain.
    expect(sanitizeJuliusGuidanceRequest(reading.guidanceRequest)).not.toBeNull();
  });

  it('research asks reach the caller as an array, and the domain sanitizer accepts them', () => {
    const reading = readJuliusParticipationBlock(block(JSON.stringify({ researchAsks: [ASK] })));
    if (!reading.present || !reading.readable) throw new Error('expected a readable block');
    expect(reading.researchAsks).toEqual([ASK]);
    expect(sanitizeJuliusResearchAsks(reading.researchAsks)).toHaveLength(1);
  });

  it('a segment resume reaches the caller, and the domain sanitizer accepts it', () => {
    const resume = { completedSoFar: ['read the specification'], nextIntent: 'implement readTextCell' };
    const reading = readJuliusParticipationBlock(block(JSON.stringify({ segmentResume: resume })));
    if (!reading.present || !reading.readable) throw new Error('expected a readable block');
    expect(sanitizeJuliusSegmentState(reading.segmentResume)).toEqual(resume);
  });

  it('two channels in one block are both carried, in the module’s order', () => {
    const reading = readJuliusParticipationBlock(block(JSON.stringify({
      researchAsks: [ASK],
      guidanceRequest: { question: 'Which reading does the exporter support?' },
    })));
    if (!reading.present || !reading.readable) throw new Error('expected a readable block');
    expect(reading.channels).toEqual(['guidanceRequest', 'researchAsks']);
  });

  /**
   * THE TRANSPORT DOES NOT CLEAN. A request the domain will refuse must arrive
   * at the domain to BE refused: the pipeline records `RESEARCH_ASK_UNREADABLE`
   * and `guidance.deferred` against a worker that asked badly, and a transport
   * that dropped the request first would erase the only evidence that it did.
   */
  it('a request the domain will refuse is still carried, not filtered out here', () => {
    const forbidden = JULIUS_RESEARCH_ASK_FORBIDDEN_FIELDS[0]!;
    const reading = readJuliusParticipationBlock(block(JSON.stringify({
      researchAsks: [{ ...ASK, [forbidden]: ['evil.example'] }],
    })));
    if (!reading.present || !reading.readable) throw new Error('expected a readable block');
    expect(sanitizeJuliusResearchAsks(reading.researchAsks)).toBeNull();
  });

  it('a channel written as null is a channel the worker used, not a channel it omitted', () => {
    const reading = readJuliusParticipationBlock(block('{"guidanceRequest":null}'));
    if (!reading.present || !reading.readable) throw new Error('expected a readable block');
    expect(reading.channels).toEqual(['guidanceRequest']);
    expect(reading.guidanceRequest).toBeNull();
    expect(sanitizeJuliusGuidanceRequest(reading.guidanceRequest)).toBeNull();
  });
});

describe('an ambiguous or unreadable request is refused, never resolved', () => {
  const reason = (text: string): string => {
    const reading = readJuliusParticipationBlock(text);
    if (!reading.present) throw new Error('expected a present block');
    if (reading.readable) throw new Error('expected an unreadable block');
    return reading.reasonCode;
  };

  it('two markers refuse — the later one does NOT win', () => {
    const text = `${block('{"guidanceRequest":{"question":"first"}}')}\n${block('{"guidanceRequest":{"question":"second"}}')}`;
    expect(reason(text)).toBe('PARTICIPATION_REPEATED');
  });

  it('a marker with no object refuses', () => {
    expect(reason(`Done.\n${JULIUS_PARTICIPATION_MARKER}\nI have nothing to add.`)).toBe('PARTICIPATION_NO_OBJECT');
  });

  it('an object that never closes refuses, rather than being read as far as it got', () => {
    expect(reason(block('{"guidanceRequest":{"question":"why"'))).toBe('PARTICIPATION_UNCLOSED');
  });

  it('an object past the outer bound refuses', () => {
    const padding = 'x'.repeat(JULIUS_PARTICIPATION_LIMITS.blockChars);
    expect(reason(block(JSON.stringify({ guidanceRequest: { question: padding } })))).toBe('PARTICIPATION_TOO_LARGE');
  });

  it('a block just inside the bound is still read', () => {
    const body = JSON.stringify({ guidanceRequest: { question: 'q'.repeat(200) } });
    expect(body.length).toBeLessThan(JULIUS_PARTICIPATION_LIMITS.blockChars);
    expect(readJuliusParticipationBlock(block(body))).toMatchObject({ readable: true });
  });

  it('malformed JSON refuses', () => {
    expect(reason(block('{"guidanceRequest": }'))).toBe('PARTICIPATION_MALFORMED');
  });

  /**
   * A LIST IS NOT AN OBJECT, and its first element is not "the request". The
   * parser does not scan forward to the first brace it can find, because doing
   * so would answer one of several asks and drop the rest without saying so.
   */
  it('a list wrapping the object refuses rather than having its first element read', () => {
    expect(reason(`${JULIUS_PARTICIPATION_MARKER}\n[{"guidanceRequest":{"question":"first"}},{"guidanceRequest":{"question":"second"}}]`))
      .toBe('PARTICIPATION_NO_OBJECT');
  });

  it('a bare JSON value refuses', () => {
    expect(reason(`${JULIUS_PARTICIPATION_MARKER}\n"guidanceRequest"`)).toBe('PARTICIPATION_NO_OBJECT');
  });

  it('prose between the marker and the object refuses — the object is the next thing', () => {
    expect(reason(`${JULIUS_PARTICIPATION_MARKER}\nhere is my request:\n{"guidanceRequest":{"question":"why"}}`))
      .toBe('PARTICIPATION_NO_OBJECT');
  });

  /**
   * THE ONE WRAPPER TOLERATED, and it is named. A fenced block is the same one
   * object with punctuation around it, not a second reading of intent; the
   * architect path already spends a correction turn on exactly this.
   */
  it('a fenced block is read, because a fence is punctuation and not an ambiguity', () => {
    for (const fence of ['```', '```json']) {
      const text = `${JULIUS_PARTICIPATION_MARKER}\n${fence}\n{"guidanceRequest":{"question":"why"}}\n\u0060\u0060\u0060`;
      expect(readJuliusParticipationBlock(text)).toMatchObject({ readable: true, channels: ['guidanceRequest'] });
    }
  });

  it('an empty object refuses rather than reading as an absent block', () => {
    expect(reason(block('{}'))).toBe('PARTICIPATION_NO_CHANNEL');
  });

  /**
   * A CHANNEL JULIUS DOES NOT HAVE IS REFUSED WHOLE.
   *
   * The alternative — ignore the unknown key and serve the rest — is how a
   * worker comes to believe it raised something Julius never saw. The refusal
   * is recorded; a silent drop is not.
   */
  it('an unrecognised key refuses the whole block, including the channels beside it', () => {
    expect(reason(block(JSON.stringify({
      guidanceRequest: { question: 'a real question' },
      escalateToFounder: true,
    })))).toBe('PARTICIPATION_UNKNOWN_CHANNEL');
  });

  it('every refusal the module can return is in the declared vocabulary', () => {
    const declared = new Set<string>(JULIUS_PARTICIPATION_REFUSALS);
    for (const text of [
      `${block('{"guidanceRequest":{}}')}${block('{}')}`,
      `${JULIUS_PARTICIPATION_MARKER} nothing`,
      `${JULIUS_PARTICIPATION_MARKER}\n[1,2]`,
      block('{"segmentResume":{'),
      block(JSON.stringify({ segmentResume: { nextIntent: 'x'.repeat(JULIUS_PARTICIPATION_LIMITS.blockChars) } })),
      block('{not json}'),
      `${JULIUS_PARTICIPATION_MARKER}\n{ } trailing`,
    ]) {
      const reading = readJuliusParticipationBlock(text);
      if (reading.present && !reading.readable) expect(declared.has(reading.reasonCode)).toBe(true);
    }
  });
});

describe('the block survives text a worker actually writes around it', () => {
  it('prose after the object is harmless', () => {
    const text = `${block('{"guidanceRequest":{"question":"why"}}')}\nI will continue once you answer.`;
    expect(readJuliusParticipationBlock(text)).toMatchObject({ readable: true });
  });

  it('a brace inside a string does not close the object early', () => {
    const question = 'The exporter writes { } for an empty struct — does it?';
    const reading = readJuliusParticipationBlock(block(JSON.stringify({ guidanceRequest: { question } })));
    if (!reading.present || !reading.readable) throw new Error('expected a readable block');
    expect((reading.guidanceRequest as { question: string }).question).toBe(question);
  });

  it('an escaped quote inside a string does not end it', () => {
    const question = 'Is the value written as \\"\\" or as nothing at all?';
    const reading = readJuliusParticipationBlock(block(JSON.stringify({ guidanceRequest: { question } })));
    if (!reading.present || !reading.readable) throw new Error('expected a readable block');
    expect((reading.guidanceRequest as { question: string }).question).toBe(question);
  });

  it('a nested object closes at the right brace, not the first one', () => {
    const reading = readJuliusParticipationBlock(block(JSON.stringify({
      guidanceRequest: { question: 'why', blockedOn: ['a'], attempted: [], relevantPaths: [] },
    })));
    if (!reading.present || !reading.readable) throw new Error('expected a readable block');
    expect(sanitizeJuliusGuidanceRequest(reading.guidanceRequest)).not.toBeNull();
  });
});

/**
 * THE PROTOCOL AND THE PARSER CANNOT DRIFT.
 *
 * A worker is told the bounds by one string and judged by another module's
 * constants. These cases hold the string to those constants, so raising a limit
 * or adding a Live Reach source cannot leave the instruction describing the old
 * one — which is the failure mode that made `HostedLimits.maxTurns` decorative.
 */
describe('what the worker is told is what Julius accepts', () => {
  const protocol = juliusParticipationProtocol();

  it('names the marker and every channel, and no channel it does not have', () => {
    expect(protocol).toContain(JULIUS_PARTICIPATION_MARKER);
    for (const channel of JULIUS_PARTICIPATION_CHANNELS) expect(protocol).toContain(`"${channel}"`);
  });

  /**
   * READ THE NUMBER OUT OF THE SENTENCE IT IS IN, rather than asking whether
   * the protocol contains that digit anywhere. `toContain('3')` is satisfied by
   * the `300` in a different bound, so it passes a protocol that states the
   * wrong ceiling — which is exactly the drift these cases exist to catch.
   */
  const statedBound = (pattern: RegExp): readonly number[] => {
    const match = pattern.exec(protocol);
    expect(match, `the protocol must state this bound: ${pattern.source}`).not.toBeNull();
    return match!.slice(1).map((group) => Number.parseInt(group!, 10));
  };

  it('states the research bounds the sanitizer actually enforces', () => {
    expect(statedBound(/at most (\d+) per turn/u)).toEqual([JULIUS_RESEARCH_ASK_LIMITS.asks]);
    expect(statedBound(/"reference" is what to read, up to (\d+) characters/u))
      .toEqual([JULIUS_RESEARCH_ASK_LIMITS.referenceChars]);
    expect(statedBound(/"purpose" is why you need it, up to (\d+)/u))
      .toEqual([JULIUS_RESEARCH_ASK_LIMITS.purposeChars]);
    for (const field of JULIUS_RESEARCH_ASK_FIELDS) expect(protocol).toContain(`"${field}"`);
  });

  it('states the guidance and segment bounds the sanitizers actually enforce', () => {
    expect(statedBound(/question up to (\d+) characters/u)).toEqual([JULIUS_CHECKPOINT_LIMITS.summaryChars]);
    expect(statedBound(/each list entry up to (\d+), at most (\d+) entries/u))
      .toEqual([JULIUS_GUIDANCE_LIMITS.entryChars, JULIUS_GUIDANCE_LIMITS.entriesPerList]);
    expect(statedBound(/At most (\d+) entries of (\d+) characters/u))
      .toEqual([JULIUS_SEGMENT_LIMITS.entries, JULIUS_SEGMENT_LIMITS.entryChars]);
    expect(statedBound(/nextIntent up to (\d+)/u)).toEqual([JULIUS_SEGMENT_LIMITS.intentChars]);
  });

  /**
   * THE VOCABULARY LINE ITSELF, not a substring search over the whole
   * protocol. `message` is a Live Reach ACTION capability and also an ordinary
   * English word this text uses; asking whether the protocol "contains" it
   * answers a question about prose. Reading the list the worker is actually
   * offered answers the question that matters.
   */
  const offered = (label: string): readonly string[] => {
    const match = new RegExp(`"${label}" is one of: ([^\n.]+)\\.`, 'u').exec(protocol);
    expect(match, `the protocol must offer a closed ${label} vocabulary`).not.toBeNull();
    return match![1]!.split(', ');
  };

  it('offers exactly Live Reach’s sources and read capabilities, and no action capability', () => {
    expect(offered('source')).toEqual([...LIVE_REACH_SOURCES]);
    /**
     * EXACTLY the read set: a protocol that OFFERED an action capability would
     * teach a worker to spend a turn asking for something
     * `sanitizeJuliusResearchAsks` can only refuse, and would read as though
     * Julius might act as an account on its behalf.
     */
    expect(offered('capability')).toEqual([...LIVE_REACH_READ_CAPABILITIES]);
    for (const capability of LIVE_REACH_ACTION_CAPABILITIES) {
      expect(offered('capability').includes(capability),
        `the protocol offers the action capability ${capability}`).toBe(false);
    }
  });

  /**
   * IT TELLS THE WORKER THE TWO THINGS THAT CHANGE ITS BEHAVIOUR: that asking
   * ends the turn (so it asks instead of guessing and continuing), and that
   * Julius decides authorisation (so it does not treat an ask as a retrieval it
   * already has).
   */
  it('says that asking ends the dispatch and that Julius decides what may be read', () => {
    expect(protocol).toContain('Asking ends this dispatch');
    expect(protocol).toContain('Julius decides whether the mission is authorised');
  });

  it('says that finishing the work and saying nothing is the ordinary case', () => {
    expect(protocol).toContain('no block is the ordinary case');
  });

  /**
   * THE PROTOCOL ITSELF PARSES. A worker copying the shape it was shown must
   * produce something this module reads — otherwise the instruction is a
   * specification of a format nobody can satisfy.
   */
  it('the shape it demonstrates is a shape the parser reads', () => {
    const demonstrated = {
      guidanceRequest: { question: 'q', blockedOn: [], attempted: [], relevantPaths: [] },
      researchAsks: [ASK],
      segmentResume: { completedSoFar: [], nextIntent: 'continue' },
      report: { outcome: 'PARTIALLY_IMPLEMENTED', summary: 'Half done.', filesTouched: [], testsRun: [], remainingUncertainty: [], blockedReason: null },
      architectureObservations: [{ kind: 'DEPENDENCY_CHANGED', subject: 'pg', claim: 'NULL renders as a word.', evidenceRefs: ['test/output.txt:3'] }],
    };
    const reading = readJuliusParticipationBlock(block(JSON.stringify(demonstrated)));
    expect(reading).toMatchObject({ readable: true, channels: [...JULIUS_PARTICIPATION_CHANNELS] });
    if (!reading.present || !reading.readable) return;
    expect(sanitizeJuliusGuidanceRequest(reading.guidanceRequest)).not.toBeNull();
    expect(sanitizeJuliusResearchAsks(reading.researchAsks)).toHaveLength(1);
    expect(sanitizeJuliusSegmentState(reading.segmentResume)).not.toBeNull();
    expect(sanitizeJuliusCodingAgentReport(reading.report).ok).toBe(true);
    const design = sanitizeJuliusArchitecture({
      value: { components: [{ name: 'normalizer', responsibility: 'Turns a page into rows.' }], boundaries: [], dependencies: [], decisions: [], assumptions: [], openQuestions: [], risks: [] },
      revision: 1, proposedByTaskId: 'plan-1', recordedAt: 't',
    });
    if (!design.ok) throw new Error(design.reasonCode);
    expect(sanitizeJuliusCoderObservations({ value: reading.architectureObservations, state: design.state }).ok).toBe(true);
  });
});
