import { describe, expect, it } from 'vitest';

import { renderOperationsView } from './operations';
import { emptyOperationalRecord, projectOperations } from '../../mission/llmops';
import type { CliCaps } from './contracts';
import { parseCli } from '../main';
import type { RelayOperationalRecord } from '../../mission/llmops';

/**
 * THE CLI'S OPERATIONS SURFACE.
 *
 * The property under test is the one that makes a parity claim mean something:
 * an unknown figure survives the trip to the terminal AS an unknown. A renderer
 * that prints `0.0%` for an error rate whose denominator nobody counted has
 * undone everything the projection was careful about.
 */

const caps: CliCaps = {
  tty: false, color: false, unicode: false, width: 80,
  reducedMotion: false, plain: true, json: false,
};

const AS_OF = '2026-08-05T12:00:00.000Z';
const RECENT = '2026-08-05T11:59:00.000Z';

const render = (over: Partial<RelayOperationalRecord> = {}) => {
  const record: RelayOperationalRecord = {
    ...emptyOperationalRecord('proj_1'), newestSignalAt: RECENT, ...over,
  };
  return renderOperationsView({ caps, view: projectOperations(record, AS_OF) });
};

const text = (over: Partial<RelayOperationalRecord> = {}) => render(over).lines.join('\n');

describe('an unknown survives the trip to the terminal', () => {
  it('prints an error rate with no denominator as unknown, never as 0.0%', () => {
    const out = text({
      errors: [{ kind: 'provider_error', at: RECENT, recovered: true, attempt: 1 }],
    });
    expect(out).toContain('denominator unknown');
    expect(out).not.toMatch(/ERROR RATE\s+0\.0%/);
  });

  it('prints a real rate once the attempts are counted', () => {
    const out = text({
      errors: [{ kind: 'provider_error', at: RECENT, recovered: true, attempt: 1 }],
      attempts: { attempts: 4, source: 'counted' },
    });
    expect(out).toContain('25.0%');
  });

  it('says a tail percentile is missing rather than printing the maximum', () => {
    const out = text({
      latency: [
        { phase: 'total', durationMs: 100, observedAt: RECENT },
        { phase: 'total', durationMs: 900, observedAt: RECENT },
      ],
    });
    expect(out).toContain('too few samples');
    // The p50 and max ARE known and are shown.
    expect(out).toContain('100ms');
    expect(out).toContain('900ms');
  });

  it('names the phases nobody timed instead of listing them as fast', () => {
    const out = text({ latency: [{ phase: 'queue', durationMs: 5, observedAt: RECENT }] });
    expect(out).toContain('Not timed:');
    expect(out).toContain('generation');
  });

  it('a project with nothing reported says so, and reports UNKNOWN health', () => {
    const out = renderOperationsView({
      caps, view: projectOperations(emptyOperationalRecord('proj_1'), AS_OF),
    }).lines.join('\n');
    expect(out).toContain('UNKNOWN');
    expect(out).toContain('Nothing has reported for this project');
    expect(out).not.toContain('HEALTHY');
  });
});

describe('the figures a reader can act on come first, and are not softened', () => {
  it('an open wait on the user is stated as waiting on THEM', () => {
    const out = text({
      waits: [{ reason: 'user_approval', since: '2026-08-05T11:00:00.000Z', until: null }],
    });
    expect(out).toContain('WAITING ON YOU');
    expect(out).toContain('1h 0m');
  });

  it('a closed wait is past tense, and does not shout', () => {
    const out = text({
      waits: [{
        reason: 'user_input',
        since: '2026-08-05T11:00:00.000Z',
        until: '2026-08-05T11:05:00.000Z',
      }],
    });
    expect(out).toContain('Waited on you for 5m 0s');
    expect(out).not.toContain('WAITING ON YOU');
  });

  it('an unrecovered error is called out beside the count', () => {
    const out = text({
      errors: [{ kind: 'tool_failure', at: RECENT, recovered: false, attempt: 1 }],
      attempts: { attempts: 2, source: 'counted' },
    });
    expect(out).toContain('unrecovered');
    expect(out).toContain('FAILING');
  });

  it('a self-assessed evaluation is never counted as an independent one', () => {
    const out = text({
      evaluations: [
        {
          evaluationId: 'e1', rubricId: 'r', verdict: 'pass',
          judgedBy: 'agent-a', authoredBy: 'agent-a', at: RECENT,
        },
      ],
      attempts: { attempts: 1, source: 'counted' },
    });
    expect(out).toContain('0 independent');
    expect(out).toContain('1 self-assessed');
  });

  it('a repair loop that hit its limit is reported as ended unfixed', () => {
    const out = text({
      repairLoops: [{
        loopId: 'lp1',
        cycles: [{ cycle: 1, findingId: 'f1', repaired: false, at: RECENT }],
        outcome: 'limit_reached',
      }],
      attempts: { attempts: 1, source: 'counted' },
    });
    expect(out).toContain('ended unfixed');
    expect(out).toContain('DEGRADED');
  });
});

describe('both surfaces read one projection', () => {
  it('the CLI json IS the view, so nothing can drift', () => {
    const record: RelayOperationalRecord = {
      ...emptyOperationalRecord('proj_1'),
      newestSignalAt: RECENT,
      attempts: { attempts: 7, source: 'counted' },
      errors: [{ kind: 'rate_limited', at: RECENT, recovered: true, attempt: 2 }],
    };
    const view = projectOperations(record, AS_OF);
    const { json } = renderOperationsView({ caps, view });
    // Not "equal to" — the SAME object. A CLI that reshaped the view would be
    // a second implementation waiting to disagree with the website's.
    expect(json).toBe(view);
  });
});

describe('the route is reachable, not just the renderer', () => {
  it('parses `relay project operations` and `relay project brain` from argv', () => {
    // `cliStatus: "tested"` covered only `renderOperationsView` before this.
    // A renderer nothing routes to is not a CLI surface.
    for (const action of ['operations', 'brain']) {
      const parsed = parseCli(['project', action]);
      expect(parsed.command, action).toBe('project');
      expect(parsed.projectAction, action).toBe(action);
      expect(parsed.error, action).toBeUndefined();
    }
  });

  it('rejects an action it does not have', () => {
    expect(parseCli(['project', 'telemetry']).error).toBeDefined();
  });
});
