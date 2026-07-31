import { describe, it, expect } from 'vitest';
import { runArchitect, parseInstructions, ArchitectUnavailableError } from './architect';

/**
 * Prompt Architect (Sunday Alcatraz) connector contract. The critical property
 * is HONEST PROVENANCE: 'live' only when the Fusion backend reports that live
 * providers are actually enabled — otherwise 'simulated', clearly labelled. A
 * failing architect must throw, never silently return a fabricated handoff.
 */

const ACCEPT = ['The test suite passes', 'Only the claimed file changed'];
const CONSTRAIN = ['Edit only src/normalize.js'];

function mockFusion(opts: {
  live: boolean;
  answer?: string;
  runStatus?: number;
  healthFails?: boolean;
  modelsUsed?: string[];
}) {
  const fetchImpl = (async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith('/health')) {
      if (opts.healthFails) throw new Error('connection refused');
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ liveProvidersEnabled: opts.live }),
      } as unknown as Response;
    }
    // /api/fusion/run
    const status = opts.runStatus ?? 200;
    return {
      ok: status === 200,
      status,
      text: async () =>
        JSON.stringify({
          finalAnswer: opts.answer ?? '1. Trim the input.\n2. Lowercase it.\n3. Return the value.',
          traceId: 'ft_test_1',
          modelsUsed: opts.modelsUsed ?? ['claude'],
        }),
    } as unknown as Response;
  }) as typeof fetch;
  return fetchImpl;
}

const run = (fetchImpl: typeof fetch) =>
  runArchitect({
    objective: 'Implement normalizeProjectName so its test passes.',
    fusionBaseUrl: 'http://fusion.test',
    fixedConstraints: CONSTRAIN,
    fixedAcceptance: ACCEPT,
    fetchImpl,
  });

describe('parseInstructions', () => {
  it('extracts a numbered list', () => {
    expect(parseInstructions('1. Alpha step\n2) Beta step\n3. Gamma step')).toEqual([
      'Alpha step',
      'Beta step',
      'Gamma step',
    ]);
  });

  it('extracts bullets', () => {
    expect(parseInstructions('- First thing here\n* Second thing here')).toEqual([
      'First thing here',
      'Second thing here',
    ]);
  });

  it('falls back to sentences when there is no list', () => {
    const out = parseInstructions('Trim the incoming value first. Then lowercase the whole name.');
    expect(out.length).toBeGreaterThan(0);
    expect(out[0]).toContain('Trim the incoming value');
  });
});

describe('runArchitect provenance honesty', () => {
  it('labels provenance live ONLY when Fusion reports live providers enabled', async () => {
    const h = await run(mockFusion({ live: true }));
    expect(h.architectProvenance).toBe('live');
    expect(h.architectLabel).toMatch(/Sunday Alcatraz · live/);
    expect(h.architectLabel).toContain('claude');
  });

  it('labels provenance simulated when no provider key is configured', async () => {
    const h = await run(mockFusion({ live: false }));
    expect(h.architectProvenance).toBe('simulated');
    expect(h.architectLabel).toMatch(/offline models/i);
    expect(h.architectLabel).not.toMatch(/· live/);
  });

  it('preserves the objective and returns Relay-fixed constraints/acceptance', async () => {
    const h = await run(mockFusion({ live: true }));
    expect(h.objective).toContain('normalizeProjectName');
    expect(h.acceptanceCriteria).toEqual(ACCEPT);
    expect(h.constraints).toEqual(CONSTRAIN);
    expect(h.instructions).toEqual(['Trim the input.', 'Lowercase it.', 'Return the value.']);
    expect(h.traceId).toBe('ft_test_1');
  });
});

describe('runArchitect failure is honest — never a fabricated handoff', () => {
  it('throws when the Alcatraz backend is unreachable', async () => {
    await expect(run(mockFusion({ live: true, healthFails: true }))).rejects.toBeInstanceOf(
      ArchitectUnavailableError,
    );
  });

  it('throws when the run endpoint errors', async () => {
    await expect(run(mockFusion({ live: true, runStatus: 500 }))).rejects.toBeInstanceOf(
      ArchitectUnavailableError,
    );
  });

  it('throws when the architect returns an empty brief', async () => {
    await expect(run(mockFusion({ live: true, answer: '   ' }))).rejects.toBeInstanceOf(
      ArchitectUnavailableError,
    );
  });
});
