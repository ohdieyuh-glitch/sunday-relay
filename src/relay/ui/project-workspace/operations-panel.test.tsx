/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';

import { RelayOperationsPanel } from './RelayOperationsPanel';
import { emptyOperationalRecord, projectOperations } from '../../mission/llmops';
import type { RelayOperationalRecord } from '../../mission/llmops';

/**
 * THE OPERATIONS PANEL.
 *
 * One property is worth more than all the others here: AN UNKNOWN NEVER
 * RENDERS AS A NUMBER. Everything the projection was careful about is undone
 * by a renderer that prints `0.0%` for a rate whose denominator nobody counted,
 * and that renderer is the last thing between the model and the person.
 */

afterEach(cleanup);

const AS_OF = '2026-08-05T12:00:00.000Z';
const RECENT = '2026-08-05T11:59:00.000Z';

const panel = (over: Partial<RelayOperationalRecord> = {}) => {
  const record: RelayOperationalRecord = {
    ...emptyOperationalRecord('proj_1'), newestSignalAt: RECENT, ...over,
  };
  return render(createElement(RelayOperationsPanel, {
    view: projectOperations(record, AS_OF),
  }));
};

const text = () => document.body.textContent ?? '';

describe('an unknown is drawn as an unknown', () => {
  it('an error rate with no denominator is a dash and a reason, never 0.0%', () => {
    panel({ errors: [{ kind: 'provider_error', at: RECENT, recovered: true, attempt: 1 }] });
    expect(text()).toContain('denominator unknown');
    expect(text()).not.toContain('0.0%');
    expect(document.querySelector('.rop-unknown')).not.toBeNull();
  });

  it('a known rate is a real percentage', () => {
    panel({
      errors: [{ kind: 'provider_error', at: RECENT, recovered: true, attempt: 1 }],
      attempts: { attempts: 4, source: 'counted' },
    });
    expect(text()).toContain('25.0%');
  });

  it('a tail percentile with too few samples says so, in its own cell', () => {
    panel({
      latency: [
        { phase: 'total', durationMs: 100, observedAt: RECENT },
        { phase: 'total', durationMs: 900, observedAt: RECENT },
      ],
    });
    expect(text()).toContain('too few samples');
    // p50 and max ARE known and render as figures.
    expect(text()).toContain('100ms');
    expect(text()).toContain('900ms');
  });

  it('names the phases nobody timed rather than drawing them as rows of zeroes', () => {
    panel({ latency: [{ phase: 'queue', durationMs: 5, observedAt: RECENT }] });
    expect(text()).toContain('Not timed:');
    expect(text()).toContain('generation');
    // Only the observed phase gets a row.
    expect(document.querySelectorAll('.rop-latency tbody tr').length).toBe(1);
  });
});

describe('silence is its own state, and says which silence it is', () => {
  it('a project that reported nothing is UNKNOWN, not HEALTHY', () => {
    render(createElement(RelayOperationsPanel, {
      view: projectOperations(emptyOperationalRecord('proj_1'), AS_OF),
    }));
    expect(text()).toContain('UNKNOWN');
    expect(text()).toContain('Nothing has reported for this project');
    expect(document.querySelector('.rop-health--healthy')).toBeNull();
  });

  it('a deployment with NO SOURCE WIRED says that instead', () => {
    // Different fact from a project with nothing to report, and the panel does
    // not let the two share a sentence.
    render(createElement(RelayOperationsPanel, { view: null }));
    expect(text()).toContain('no operations source wired');
    expect(text()).toContain('UNKNOWN');
  });

  it('health always carries a reason — a state with none is just a colour', () => {
    panel({ attempts: { attempts: 3, source: 'counted' } });
    const reason = document.querySelector('.rop-health-reason')?.textContent ?? '';
    expect(reason.length).toBeGreaterThan(10);
  });
});

describe('the figures a person can act on are not softened', () => {
  it('an open wait on the user is addressed to them', () => {
    panel({ waits: [{ reason: 'user_approval', since: '2026-08-05T11:00:00.000Z', until: null }] });
    expect(text()).toContain('WAITING ON YOU');
    expect(document.querySelector('.rop-waiting--open')).not.toBeNull();
  });

  it('a finished wait is past tense and does not shout', () => {
    panel({
      waits: [{
        reason: 'user_input', since: '2026-08-05T11:00:00.000Z', until: '2026-08-05T11:05:00.000Z',
      }],
    });
    expect(text()).toContain('Waited on you for');
    expect(document.querySelector('.rop-waiting--open')).toBeNull();
  });

  it('a self-assessed evaluation is never presented as an independent one', () => {
    panel({
      evaluations: [{
        evaluationId: 'e1', rubricId: 'r', verdict: 'pass',
        judgedBy: 'agent-a', authoredBy: 'agent-a', at: RECENT,
      }],
      attempts: { attempts: 1, source: 'counted' },
    });
    expect(text()).toContain('0 independent');
    expect(text()).toContain('1 self-assessed');
  });

  it('a repair loop that hit its limit is shown as ended unfixed', () => {
    panel({
      repairLoops: [{
        loopId: 'lp1',
        cycles: [{ cycle: 1, findingId: 'f1', repaired: false, at: RECENT }],
        outcome: 'limit_reached',
      }],
      attempts: { attempts: 1, source: 'counted' },
    });
    expect(text()).toContain('ended unfixed');
    expect(document.querySelector('.rop-bad')).not.toBeNull();
  });

  it('an unrecovered error is called out and the panel reads FAILING', () => {
    panel({
      errors: [{ kind: 'tool_failure', at: RECENT, recovered: false, attempt: 1 }],
      attempts: { attempts: 2, source: 'counted' },
    });
    expect(text()).toContain('unrecovered');
    expect(document.querySelector('.rop-health--failing')).not.toBeNull();
  });
});
