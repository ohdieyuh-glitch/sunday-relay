/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RelayAgentConfigEditor } from './RelayAgentConfigEditor';

/**
 * CONFIGURE THE COMPOUND PSP AGENT, through the pure editor. These are the
 * "EDITOR:" behaviours re-homed from RelayMissionRunner: a checked permission and
 * edited ceilings become exactly what the config REQUESTS; a cleared ceiling is
 * `null` = "not set" and never 0; a negative/non-finite value is ignored; an
 * untouched field is preserved; and an edit relabels the config "Custom". The
 * editor only PROPOSES — the runner's Contract gate and the bridge's refusal are
 * the runner's own concern, tested there.
 */

// A controlled harness that mirrors how RelayConfigureAgent / RelayMissionRunner
// hold the working config: it feeds each onChange back as the new config, so the
// controlled editor re-renders exactly as it would in the product.
function Harness({
  initial,
  onConfig,
}: {
  readonly initial: unknown;
  readonly onConfig?: (config: unknown, label: string) => void;
}) {
  const [config, setConfig] = useState<unknown>(initial);
  return (
    <RelayAgentConfigEditor
      config={config}
      onChange={(next, label) => { setConfig(next); onConfig?.(next, label); }}
    />
  );
}

type EditedConfig = { permissions?: string[]; limits?: Record<string, number | null>; mode?: string; review?: string };
const last = (calls: Array<{ config: unknown; label: string }>) => calls.at(-1);

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('RelayAgentConfigEditor', () => {
  it('EDITOR: a checked permission + edited spend/agent ceilings are exactly what the config REQUESTS (criteria 3 & 5)', () => {
    const calls: Array<{ config: unknown; label: string }> = [];
    render(<Harness initial={{ mode: 'guided' }} onConfig={(config, label) => calls.push({ config, label })} />);
    fireEvent.click(screen.getByLabelText('push_feature_branch'));
    fireEvent.change(screen.getByLabelText('Spend ceiling (USD)'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Agent-call ceiling'), { target: { value: '4' } });
    const config = last(calls)?.config as EditedConfig;
    expect(config.permissions).toContain('push_feature_branch');
    expect(config.limits?.spendUsd).toBe(2);
    expect(config.limits?.agentCalls).toBe(4);
  });

  it('EDITOR: checking merge_pr proposes it verbatim in the requested permissions (the runner gates on it)', () => {
    const calls: Array<{ config: unknown; label: string }> = [];
    render(<Harness initial={{ mode: 'guided' }} onConfig={(config, label) => calls.push({ config, label })} />);
    fireEvent.click(screen.getByLabelText('merge_pr'));
    // The editor forwards the high-consequence permission exactly as requested;
    // it is the RUNNER that turns this into a Mission Contract gate.
    expect((last(calls)?.config as EditedConfig).permissions).toContain('merge_pr');
  });

  it('EDITOR: clearing a ceiling yields null in the payload and discloses "not set", never 0', () => {
    const calls: Array<{ config: unknown; label: string }> = [];
    render(
      <Harness
        initial={{ mode: 'guided', limits: { spendUsd: 5, agentCalls: 8 } }}
        onConfig={(config, label) => calls.push({ config, label })}
      />,
    );
    const spend = screen.getByLabelText('Spend ceiling (USD)') as HTMLInputElement;
    expect(spend.value).toBe('5');
    fireEvent.change(spend, { target: { value: '' } });
    // The cleared ceiling discloses "not set" beside its own input — never "$0".
    expect(spend.closest('label')?.textContent).toContain('not set');
    const config = last(calls)?.config as EditedConfig;
    expect(config.limits?.spendUsd).toBeNull();
    // The untouched ceiling is carried unchanged — the edit is surgical.
    expect(config.limits?.agentCalls).toBe(8);
  });

  it('EDITOR: a negative or non-finite ceiling is ignored — the config is never proposed with a bad number', () => {
    const onChange = vi.fn();
    render(<RelayAgentConfigEditor config={{ mode: 'guided', limits: { spendUsd: 5 } }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Spend ceiling (USD)'), { target: { value: '-5' } });
    fireEvent.change(screen.getByLabelText('Agent-call ceiling'), { target: { value: 'abc' } });
    // Neither an out-of-range nor a non-numeric value produces a proposal.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('EDITOR: a request that exceeds the grant is still only PROPOSED here — the editor forwards it, the bridge judges it', () => {
    const calls: Array<{ config: unknown; label: string }> = [];
    render(<Harness initial={{ mode: 'guided' }} onConfig={(config, label) => calls.push({ config, label })} />);
    // Requesting an over-reaching permission simply names it; the editor never
    // decides whether it is granted — that is the bridge's authority.
    fireEvent.click(screen.getByLabelText('push_feature_branch'));
    expect((last(calls)?.config as EditedConfig).permissions).toContain('push_feature_branch');
  });

  it('EDITOR: editing config relabels it "Custom (from …)" so an edited profile is never misnamed (F1, truthfulness)', () => {
    const calls: Array<{ config: unknown; label: string }> = [];
    render(<Harness initial={{ mode: 'guided' }} onConfig={(config, label) => calls.push({ config, label })} />);
    fireEvent.change(screen.getByLabelText('Spend ceiling (USD)'), { target: { value: '2' } });
    // The emitted label announces the divergence; it no longer presents a
    // pristine profile name as if the config were unchanged.
    expect(last(calls)?.label).toContain('Custom');
    expect(last(calls)?.label).toMatch(/from/i);
  });

  it('EDITOR: the mode and review selects propose the chosen policy', () => {
    const calls: Array<{ config: unknown; label: string }> = [];
    render(<Harness initial={{ mode: 'guided', review: 'independent' }} onConfig={(config, label) => calls.push({ config, label })} />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'autonomous' } });
    expect((last(calls)?.config as EditedConfig).mode).toBe('autonomous');
    fireEvent.change(screen.getByLabelText('Review requirement'), { target: { value: 'security' } });
    expect((last(calls)?.config as EditedConfig).review).toBe('security');
  });
});
