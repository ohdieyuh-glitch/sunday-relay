import { describe, expect, it } from 'vitest';

import {
  BRAIN_DOC_STALE_AFTER_MS, SHORT_TERM_CAPACITY, emptyShortTermMemory,
  isSelfApproved, proposePromotion, refreshBrainDocument, rememberShortTerm,
  type RelayLongTermEntry, type RelayShortTermEntry,
} from './brain-memory';

/**
 * SHORT-TERM AND LONG-TERM PROJECT MEMORY.
 *
 * The properties under test are the ones that make long-term memory worth
 * trusting at all: that nothing enters it without a second party, that an agent
 * cannot promote its own observation, and that a generated document says what
 * it was generated FROM rather than only what it concluded.
 */

const AT = '2026-08-05T12:00:00.000Z';

const observation = (over: Partial<RelayShortTermEntry> = {}): RelayShortTermEntry => ({
  entryId: 'obs_1', kind: 'run_outcome', summary: 'suite went green',
  observedAt: AT, observedBy: 'relay', ...over,
});

const approved = (over: Partial<RelayLongTermEntry> = {}): RelayLongTermEntry => ({
  entryId: 'lt_1', statement: 'The API base URL is configured per environment.',
  source: 'repository_observed', citation: 'src/config.ts',
  proposedBy: 'agent-a', approvedBy: 'founder', approvedAt: AT, ...over,
});

/* ------------------------------------------------------------ short term */

describe('short-term memory is bounded, and says what it dropped', () => {
  it('keeps the most recent entries and COUNTS the evictions', () => {
    let memory = emptyShortTermMemory();
    for (let i = 0; i < SHORT_TERM_CAPACITY + 10; i += 1) {
      memory = rememberShortTerm(memory, observation({
        entryId: `obs_${String(i).padStart(4, '0')}`,
        observedAt: new Date(Date.parse(AT) + i * 1000).toISOString(),
      }));
    }
    expect(memory.entries.length).toBe(SHORT_TERM_CAPACITY);
    // A surface reporting 64 recent events when 74 happened is describing its
    // own buffer and calling it the project's history.
    expect(memory.evicted).toBe(10);
    expect(memory.entries[memory.entries.length - 1].entryId).toBe('obs_0073');
  });

  it('is ordered by when things were observed, not by when they arrived', () => {
    let memory = emptyShortTermMemory();
    memory = rememberShortTerm(memory, observation({ entryId: 'b', observedAt: '2026-08-05T12:00:02.000Z' }));
    memory = rememberShortTerm(memory, observation({ entryId: 'a', observedAt: '2026-08-05T12:00:01.000Z' }));
    expect(memory.entries.map((e) => e.entryId)).toEqual(['a', 'b']);
  });
});

/* ------------------------------------------------------------- long term */

describe('nothing enters long-term memory on its own authority', () => {
  it('an entry approved by its own proposer is not an approved entry', () => {
    expect(isSelfApproved(approved())).toBe(false);
    expect(isSelfApproved(approved({ approvedBy: 'agent-a' }))).toBe(true);
    // Case and padding do not buy a second party.
    expect(isSelfApproved(approved({ approvedBy: ' AGENT-A ' }))).toBe(true);
  });

  it('promotion produces a PROPOSAL, and there is no function that produces more', () => {
    const proposal = proposePromotion({
      entry: observation(),
      statement: 'The suite is green on main.',
      source: 'run_observed',
      citation: 'run_123',
      proposedBy: 'agent-a',
      proposedAt: AT,
      supporting: [observation({ entryId: 'obs_2' })],
    });
    expect(proposal.basis).toEqual(['obs_1', 'obs_2']);
    expect(proposal.proposedBy).toBe('agent-a');
    // The proposal carries no approver and no approval time, because it is not
    // approved. A module able to mint an approved entry would make the human
    // approval gate optional, which is the only thing giving the Brain value.
    expect(Object.keys(proposal)).not.toContain('approvedBy');
    expect(Object.keys(proposal)).not.toContain('approvedAt');
  });

  it('the same observation cited twice is one basis, not two', () => {
    const entry = observation();
    const proposal = proposePromotion({
      entry, statement: 's', source: 'run_observed', citation: 'c',
      proposedBy: 'a', proposedAt: AT, supporting: [entry],
    });
    expect(proposal.basis).toEqual(['obs_1']);
  });
});

/* --------------------------------------------------------- documentation */

describe('a refreshed document says what it was generated FROM', () => {
  const doc = (over: Parameters<typeof refreshBrainDocument>[0] extends infer T
    ? Partial<T> : never = {}) => refreshBrainDocument({
    projectId: 'proj_1', longTerm: [], shortTerm: emptyShortTermMemory(),
    proposals: [], generatedAt: AT, ...over,
  });

  it('an empty project produces a document that states nothing, and says so', () => {
    const document = doc();
    expect(document.newestInputAt).toBeNull();
    expect(document.freshness).toContain('Nothing has been recorded');
    // A document about a project nothing has reported on must not look like a
    // document about a busy one.
    expect(document.stale).toBe(true);
    expect(document.sections[0].lines[0]).toContain('Nothing has been approved');
  });

  it('reports its inputs, not only its conclusions', () => {
    const memory = rememberShortTerm(emptyShortTermMemory(), observation());
    const document = doc({ longTerm: [approved()], shortTerm: memory });
    expect(document.longTermEntries).toBe(1);
    expect(document.shortTermEntries).toBe(1);
    expect(document.newestInputAt).toBe(AT);
    expect(document.stale).toBe(false);
  });

  it('goes stale on the clock, from the newest input it actually has', () => {
    const old = new Date(Date.parse(AT) - BRAIN_DOC_STALE_AFTER_MS - 60_000).toISOString();
    const document = doc({ longTerm: [approved({ approvedAt: old })] });
    expect(document.stale).toBe(true);
    expect(document.freshness).toContain('minutes old');
  });

  it('surfaces self-approved entries instead of quietly counting them', () => {
    const document = doc({ longTerm: [approved(), approved({ entryId: 'lt_2', approvedBy: 'agent-a' })] });
    expect(document.longTermEntries).toBe(2);
    expect(document.selfApprovedEntries).toBe(1);
    const headings = document.sections.map((s) => s.heading);
    expect(headings).toContain('APPROVED BY THEIR OWN AUTHOR');
  });

  it('does not add that section when there is nothing to confess', () => {
    const document = doc({ longTerm: [approved()] });
    expect(document.sections.map((s) => s.heading)).not.toContain('APPROVED BY THEIR OWN AUTHOR');
  });

  it('tells the reader when older observations fell off the end', () => {
    let memory = emptyShortTermMemory();
    for (let i = 0; i < SHORT_TERM_CAPACITY + 3; i += 1) {
      memory = rememberShortTerm(memory, observation({
        entryId: `obs_${i}`, observedAt: new Date(Date.parse(AT) + i * 1000).toISOString(),
      }));
    }
    const document = doc({ shortTerm: memory, generatedAt: new Date(Date.parse(AT) + 100_000).toISOString() });
    expect(document.shortTermEvicted).toBe(3);
    const recent = document.sections.find((s) => s.heading === 'RECENTLY OBSERVED');
    expect(recent?.lines.join('\n')).toContain('3 older observation(s) have been evicted');
  });

  it('an unreadable timestamp makes freshness unknown rather than fresh', () => {
    const document = doc({ generatedAt: 'not-a-date', longTerm: [approved()] });
    expect(document.stale).toBe(true);
    expect(document.freshness).toContain('could not be read');
  });
});
