import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_MEMORY_SOURCE,
  describeObservation,
  evidenceCitation,
  evidenceObservation,
  proposeEvidence,
} from './evidence-brain-link';
import { evidenceReference, normalizeObservation, type RawObservation } from './evidence-normalizer';
import {
  emptyShortTermMemory,
  isSelfApproved,
  proposePromotion,
  refreshBrainDocument,
  rememberShortTerm,
} from '../../shared/llmops/brain-memory';
import type { LiveReachAttempt } from '../live-reach';

/**
 * EVIDENCE REACHES THE BRAIN AS A REFERENCE, NEVER AS A FACT.
 *
 * The requirement is that the Project Brain can point at what was retrieved
 * without absorbing what it claimed. So the two things held here are: a
 * retrieval lands in SHORT-TERM memory and gets no further on its own, and the
 * citation that crosses over is enough to re-check the source later.
 */

const ATTEMPT: LiveReachAttempt = {
  source: 'github',
  capability: 'read_item',
  requestedBackendId: 'relay_github_public',
  actualBackendId: 'relay_github_public',
  fallbackOccurred: false,
  startedAt: '2026-08-10T12:00:00.000Z',
  completedAt: '2026-08-10T12:00:01.000Z',
};

const artifact = (over: Partial<RawObservation> = {}) => normalizeObservation('ev-1', {
  missionId: 'msn-1',
  projectId: 'rly-100',
  source: 'github',
  capability: 'read_item',
  reference: 'https://github.com/example/repo/releases/tag/v2.0.0',
  title: 'v2.0.0',
  author: 'example',
  publishedAt: '2026-08-10T11:30:00.000Z',
  retrievedAt: '2026-08-10T12:00:00.000Z',
  query: null,
  content: 'The legacy adapter has been removed.',
  sanitization: 'clean',
  injectionSignals: [],
  authority: 'primary',
  attempt: ATTEMPT,
  ...over,
});

describe('a retrieval becomes an observation', () => {
  it('describes what was read, from where, how fresh, and by which backend', () => {
    const summary = describeObservation(artifact());
    expect(summary).toContain('github');
    expect(summary).toContain('30 minutes before retrieval');
    expect(summary).toContain('relay_github_public');
  });

  it('says the publication time is unknown rather than implying one', () => {
    expect(describeObservation(artifact({ publishedAt: null })))
      .toContain('publication time unknown');
  });

  it('names the fallback when there was one', () => {
    const summary = describeObservation(artifact({
      attempt: { ...ATTEMPT, actualBackendId: 'relay_http_fetch', fallbackOccurred: true },
    }));
    expect(summary).toContain('relay_http_fetch');
    expect(summary).toContain('after a fallback');
  });

  it('attributes the observation to Live Reach, not to whichever agent asked', () => {
    const entry = evidenceObservation(artifact());
    expect(entry.observedBy).toBe('live-reach');
    expect(entry.observedAt).toBe('2026-08-10T12:00:00.000Z');
    expect(entry.missionId).toBe('msn-1');
  });

  it('lands in short-term memory, which the Brain document then reports', () => {
    const memory = rememberShortTerm(emptyShortTermMemory(), evidenceObservation(artifact()));
    const document = refreshBrainDocument({
      projectId: 'rly-100',
      longTerm: [],
      shortTerm: memory,
      proposals: [],
      generatedAt: '2026-08-10T12:00:30.000Z',
    });
    const observed = document.sections.find((s) => s.heading === 'RECENTLY OBSERVED');
    expect(observed?.lines.join(' ')).toContain('github');
    // And NOT in what the project knows: nothing has approved it.
    const known = document.sections.find((s) => s.heading === 'WHAT THIS PROJECT KNOWS');
    expect(known?.lines).toEqual(['Nothing has been approved into long-term memory yet.']);
  });
});

describe('the citation is checkable later', () => {
  it('carries the reference, the retrieval time and the fingerprint', () => {
    const citation = evidenceCitation(evidenceReference(artifact()));
    expect(citation).toContain('https://github.com/example/repo/releases/tag/v2.0.0');
    expect(citation).toContain('2026-08-10T12:00:00.000Z');
    // The fingerprint is what lets a later re-fetch prove the page changed
    // after the claim was approved. A citation naming only a URL cannot.
    expect(citation).toMatch(/fnv1a-[0-9a-f]{8}/);
  });

  it('changes when the source content changes', () => {
    const first = evidenceCitation(evidenceReference(artifact()));
    const second = evidenceCitation(evidenceReference(artifact({ content: 'Something else entirely.' })));
    expect(first).not.toBe(second);
  });
});

describe('promotion requires a person, and a statement they wrote', () => {
  it('proposes rather than approves', () => {
    const draft = proposeEvidence({
      artifact: artifact(),
      statement: 'The project must migrate off the legacy adapter before upgrading.',
      proposedBy: 'prompt-architect',
      proposedAt: '2026-08-10T12:01:00.000Z',
    });
    const proposal = proposePromotion(draft);

    const document = refreshBrainDocument({
      projectId: 'rly-100',
      longTerm: [],
      shortTerm: rememberShortTerm(emptyShortTermMemory(), draft.entry),
      proposals: [proposal],
      generatedAt: '2026-08-10T12:01:30.000Z',
    });
    // AWAITING APPROVAL, not known. A retrieval never becomes project
    // knowledge on its own authority.
    expect(document.sections.find((s) => s.heading === 'AWAITING APPROVAL')?.lines.join(' '))
      .toContain('migrate off the legacy adapter');
    expect(document.pendingProposals).toBe(1);
    expect(document.longTermEntries).toBe(0);
  });

  it('records the statement the proposer wrote, not text lifted from the page', () => {
    const page = 'The legacy adapter has been removed.';
    const draft = proposeEvidence({
      artifact: artifact({ content: page }),
      statement: 'We depend on that adapter in two places and must plan a migration.',
      proposedBy: 'prompt-architect',
      proposedAt: '2026-08-10T12:01:00.000Z',
    });
    // Whoever proposes has to stand behind a claim in their own words.
    // Copying a sentence out of a page and calling it project knowledge is the
    // silent absorption this linkage exists to prevent.
    expect(draft.statement).not.toBe(page);
    expect(draft.statement).toContain('must plan a migration');
    expect(draft.source).toBe(EVIDENCE_MEMORY_SOURCE);
  });

  it('is still refused promotion when the proposer approves their own claim', () => {
    // The Brain's own rule, and it applies unchanged to evidence: an entry
    // approved by its author is not an approved entry.
    const selfApproved = {
      entryId: 'ev-1',
      statement: 'The adapter is gone.',
      source: EVIDENCE_MEMORY_SOURCE,
      citation: evidenceCitation(evidenceReference(artifact())),
      proposedBy: 'prompt-architect',
      approvedBy: 'prompt-architect',
      approvedAt: '2026-08-10T12:02:00.000Z',
    };
    expect(isSelfApproved(selfApproved)).toBe(true);

    const document = refreshBrainDocument({
      projectId: 'rly-100',
      longTerm: [selfApproved],
      shortTerm: emptyShortTermMemory(),
      proposals: [],
      generatedAt: '2026-08-10T12:02:30.000Z',
    });
    // Surfaced, not hidden: the entry is in use and the Brain says who
    // approved it.
    expect(document.selfApprovedEntries).toBe(1);
    expect(document.sections.find((s) => s.heading === 'APPROVED BY THEIR OWN AUTHOR')).toBeDefined();
  });
});
