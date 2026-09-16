import { describe, expect, it } from 'vitest';

import {
  JULIUS_WORKSPACE_LIMITS,
  juliusScopeViolations,
  parseJuliusWorkspaceStatus,
  readJuliusCodingAgentImplementation,
  sanitizeJuliusCodingAgentReport,
} from './julius-coding-agent';

/** The Coding Agent's result record: what the executor saw, what the coder said, and what the contract allows. */

const NUL = String.fromCharCode(0);

describe('S1 — the change set is read from the executor, new files included', () => {
  it('reads modified, added, deleted, renamed and untracked paths, one path per NUL field', () => {
    const porcelain = [' M src/slug.ts', 'A  src/new-tracked.ts', ' D src/gone.ts', 'R  src/renamed.ts', 'src/original.ts', '?? src/brand new.ts', ''].join(NUL);
    expect(parseJuliusWorkspaceStatus(porcelain)).toEqual({
      changes: [
        { path: 'src/slug.ts', change: 'MODIFIED' },
        { path: 'src/new-tracked.ts', change: 'ADDED' },
        { path: 'src/gone.ts', change: 'DELETED' },
        { path: 'src/renamed.ts', change: 'RENAMED' },
        { path: 'src/brand new.ts', change: 'UNTRACKED' },
      ],
      truncated: false,
    });
  });

  it('a change set too large to keep says it was cut, rather than looking complete', () => {
    const many = Array.from({ length: JULIUS_WORKSPACE_LIMITS.paths + 5 }, (_, index) => `?? gen/file-${String(index)}.ts`).join(NUL);
    const read = parseJuliusWorkspaceStatus(many);
    expect(read.changes).toHaveLength(JULIUS_WORKSPACE_LIMITS.paths);
    expect(read.truncated).toBe(true);
  });

  it('a path carrying control characters is not a path Julius will record', () => {
    expect(parseJuliusWorkspaceStatus(` M src/a${String.fromCharCode(7)}b.ts`).changes).toEqual([]);
  });
});

describe('S2 — scope is checked against the locked contract, not stated to the coder and forgotten', () => {
  const changes = (...paths: string[]) => paths.map((path) => ({ path, change: 'MODIFIED' as const }));

  it('a change outside the permitted paths is a violation; one inside is not', () => {
    expect(juliusScopeViolations({
      changes: changes('src/slug.ts', 'src/persistence/journal.ts'),
      permittedPaths: ['src/slug.ts', 'src/slug.test.ts'], outOfScope: [],
    })).toEqual([{ path: 'src/persistence/journal.ts', rule: 'OUTSIDE_PERMITTED_PATHS' }]);
  });

  it('a directory covers what is under it; `*` stays in one directory and `**` crosses them', () => {
    const permitted = { permittedPaths: ['src/slug/', 'test/*.test.ts', 'docs/**'], outOfScope: [] };
    expect(juliusScopeViolations({ changes: changes('src/slug/index.ts', 'src/slug/deep/x.ts', 'test/a.test.ts', 'docs/a/b/c.md'), ...permitted })).toEqual([]);
    expect(juliusScopeViolations({ changes: changes('test/nested/a.test.ts', 'src/slugger.ts'), ...permitted }).map((v) => v.path))
      .toEqual(['test/nested/a.test.ts', 'src/slugger.ts']);
  });

  it('out of scope is refused whatever the permitted list allows', () => {
    expect(juliusScopeViolations({
      changes: changes('src/persistence/journal.ts'), permittedPaths: ['**'], outOfScope: ['src/persistence/'],
    })).toEqual([{ path: 'src/persistence/journal.ts', rule: 'OUT_OF_SCOPE' }]);
  });

  it('a mission that stated no scope constrains nothing — an invented rule would refuse work nobody forbade', () => {
    expect(juliusScopeViolations({ changes: changes('anywhere/at/all.ts'), permittedPaths: [], outOfScope: [] })).toEqual([]);
  });
});

describe('S3 — the coder reports claims, and cannot report a decision', () => {
  const REPORT = {
    outcome: 'IMPLEMENTED', summary: 'Normalized the slug and added a test for the NULL case.',
    filesTouched: ['src/slug.ts', 'src/slug.test.ts'], testsRun: ['npm test -- slug'], remainingUncertainty: ['Whether NULL should render as empty.'],
    blockedReason: null,
  };

  it('reads a well-formed report', () => {
    expect(sanitizeJuliusCodingAgentReport(REPORT)).toEqual({ ok: true, report: { ...REPORT } });
  });

  it.each([
    ['a completion', { ...REPORT, outcome: 'COMPLETED' }, 'peer_response_mints_julius_only_outcome'],
    ['a verification', { ...REPORT, outcome: 'VERIFIED' }, 'peer_response_mints_julius_only_outcome'],
    ['a mission term', { ...REPORT, permissions: ['write anywhere'] }, 'peer_response_mutates_protected_term'],
    ['a budget, nested', { ...REPORT, remainingUncertainty: [], blockedReason: null, extra: { budget: 9 } }, 'peer_response_mutates_protected_term'],
    ['an invented field', { ...REPORT, reviewerApproved: true }, 'coding_agent_report_unknown_field'],
    ['an invented outcome', { ...REPORT, outcome: 'DONE_AND_DUSTED' }, 'coding_agent_report_outcome_unknown'],
    ['blocked with no reason', { ...REPORT, outcome: 'BLOCKED' }, 'coding_agent_report_blocked_without_reason'],
    ['a reason on work that is not blocked', { ...REPORT, blockedReason: 'the reader is missing' }, 'coding_agent_report_reason_without_block'],
    ['a credential-shaped summary', { ...REPORT, summary: 'set token: abc123 in the env' }, 'coding_agent_report_summary_invalid'],
  ])('refuses %s by name', (_label, value, reasonCode) => {
    expect(sanitizeJuliusCodingAgentReport(value)).toEqual({ ok: false, reasonCode });
  });

  it('the implementation record is rebuilt from an allowlist, and an unreadable one is refused whole', () => {
    const read = readJuliusCodingAgentImplementation({
      providerKind: 'claude-code-hosted', workspace: { captured: true, changes: [{ path: 'src/slug.ts', change: 'MODIFIED' }], truncated: false },
      report: REPORT, somethingElse: 'dropped',
    });
    expect(read).toEqual({ providerKind: 'claude-code-hosted', workspace: { captured: true, changes: [{ path: 'src/slug.ts', change: 'MODIFIED' }], truncated: false }, report: REPORT });
    expect(readJuliusCodingAgentImplementation({ providerKind: 'Claude Code!', workspace: { captured: true, changes: [], truncated: false } })).toBeNull();
    expect(readJuliusCodingAgentImplementation({ providerKind: 'x', workspace: { captured: true, changes: [{ path: 'a', change: 'TELEPORTED' }], truncated: false } })).toBeNull();
  });
});
