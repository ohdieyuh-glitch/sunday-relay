/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CONCLUDED_MANUAL_PROOF_ENTRIES,
  concludedManualDuelResults,
  scoreProofEntry,
} from '../../mission';
import { RelayColiseumConsole } from './RelayColiseumConsole';
import { RelayDuelResults } from './RelayDuelResults';
import { RelayProofMeter } from './RelayProofMeter';
import {
  ACTIVE_AUTOMATION_DUEL_FIXTURE,
  CHALLENGED_DUEL_FIXTURE,
  COLISEUM_FIXTURE_DISCLOSURE,
  CONCLUDED_MANUAL_DUEL_FIXTURE,
} from './fixtures';
import { formatDelta, formatMaybe, parseDuelCommand, proofEntryVerdict } from './projections';

afterEach(cleanup);

const SIMULATED_BANNER = `SIMULATED DATA — ${COLISEUM_FIXTURE_DISCLOSURE}`;

describe('fixtures are the shared domain projection, not a local copy', () => {
  it('every fixture view is exactly what projectDuelResults produces', () => {
    // The fixture module derives through the mission fixtures; re-deriving
    // here must give a deep-equal view — drift is structurally impossible.
    expect(CONCLUDED_MANUAL_DUEL_FIXTURE).toEqual(concludedManualDuelResults());
  });

  it('SB renders as bound — the domain binds it to the repair-loop engine', () => {
    const byName = new Map(
      CONCLUDED_MANUAL_DUEL_FIXTURE.commands.map((c) => [c.name, c.binding]),
    );
    expect(byName.get('TRACE')).toBe('bound');
    expect(byName.get('SB')).toBe('bound');
    expect(byName.get('VERIFY')).toBe('bound');
    for (const name of ['RED', 'FORK', 'GUARD', 'ROLLBACK', 'DEEP', 'SWARM'] as const) {
      expect(byName.get(name)).toBe('unbound');
    }
  });

  it('every fixture proof entry point value is producible by scoreProofEntry', () => {
    const scoredByDomain = new Set(
      Object.values(CONCLUDED_MANUAL_PROOF_ENTRIES)
        .flat()
        .map((entry) => scoreProofEntry(entry).points),
    );
    for (const participant of CONCLUDED_MANUAL_DUEL_FIXTURE.participants) {
      for (const entry of participant.entries) {
        expect(scoredByDomain.has(entry.points)).toBe(true);
      }
    }
  });
});

describe('projections', () => {
  it('recognizes all nine duel commands, case-insensitively, with or without a slash', () => {
    for (const verb of ['TRACE', 'SB', 'RED', 'VERIFY', 'FORK', 'GUARD', 'ROLLBACK', 'DEEP', 'SWARM']) {
      expect(parseDuelCommand(verb)).toBe(verb);
      expect(parseDuelCommand(`/${verb.toLowerCase()} some args`)).toBe(verb);
    }
    expect(parseDuelCommand('ATTACK')).toBeNull();
    expect(parseDuelCommand('')).toBeNull();
    // Recognition is on the verb only, not a substring.
    expect(parseDuelCommand('TRACEROUTE')).toBeNull();
  });

  it('verdict states the domain truth: unverified 0, penalties negative, verified verified', () => {
    expect(proofEntryVerdict({ category: 'security-finding', verified: false, points: 0, summary: 'x' }))
      .toBe('unverified — scores 0');
    expect(proofEntryVerdict({ category: 'security-finding', verified: false, points: -15, summary: 'x' }))
      .toBe('penalty — not verified work');
    expect(proofEntryVerdict({ category: 'bug-discovery', verified: true, points: 30, summary: 'x' }))
      .toBe('verified');
  });

  it('null renders as the word Unknown, never a number', () => {
    expect(formatMaybe(null)).toBe('Unknown');
    expect(formatMaybe(0)).toBe('0');
    expect(formatDelta(null)).toBe('Unknown');
    expect(formatDelta(2)).toBe('+2');
    expect(formatDelta(-1)).toBe('-1');
  });
});

describe('RelayProofMeter', () => {
  const aria = CONCLUDED_MANUAL_DUEL_FIXTURE.participants[0];

  it('shows the domain proof score and every entry with its verdict', () => {
    render(createElement(RelayProofMeter, { participant: aria }));
    expect(screen.getByTestId(`proof-score-${aria.participantId}`).textContent)
      .toContain(String(aria.proofScore));
    // The unverified claim visibly scores 0 and says why.
    const unverified = screen.getByText(/Claimed 2x speedup/).closest('li')!;
    expect(within(unverified).getByText('0')).toBeTruthy();
    expect(within(unverified).getByText('unverified — scores 0')).toBeTruthy();
    // Verified entries keep their domain-scored points.
    const verified = screen.getByText(/rounds half-cents/).closest('li')!;
    expect(within(verified).getByText('+30')).toBeTruthy();
    expect(within(verified).getByText('verified')).toBeTruthy();
  });

  it('an empty participant says no entries were recorded, not zero of anything', () => {
    render(createElement(RelayProofMeter, { participant: CHALLENGED_DUEL_FIXTURE.participants[0] }));
    expect(screen.getByText('No proof entries recorded.')).toBeTruthy();
  });
});

describe('RelayDuelResults', () => {
  it('concluded duel: winner, both participants, deltas, XP, rewards, opponent-fix bonus, fixes', () => {
    const [aria, ledger] = CONCLUDED_MANUAL_DUEL_FIXTURE.participants;
    render(createElement(RelayDuelResults, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    expect(screen.getByTestId('duel-winner').textContent).toBe(`Winner: ${aria.displayName}`);
    // Aria's unmeasured deltas render Unknown — never invented.
    expect(screen.getByTestId(`performance-delta-${aria.participantId}`).textContent).toBe('Unknown');
    expect(screen.getByTestId(`reliability-delta-${aria.participantId}`).textContent).toBe('Unknown');
    expect(screen.getByTestId(`eval-quality-${aria.participantId}`).textContent)
      .toBe(String(aria.evaluationQuality));
    // The opponent was never measured — all three are Unknown.
    expect(screen.getByTestId(`eval-quality-${ledger.participantId}`).textContent).toBe('Unknown');
    // Both participants' results are on screen.
    expect(screen.getAllByText(ledger.displayName).length).toBeGreaterThan(0);
    // XP, bonus and rewards are the domain-derived values, not invented ones.
    expect(screen.getByText(String(aria.xpEarned))).toBeTruthy();
    expect(screen.getByText(String(aria.opponentFixBonus))).toBeTruthy();
    expect(aria.rewards.length).toBeGreaterThan(0);
    expect(screen.getByText(aria.rewards.join(', '))).toBeTruthy();
    // The verified fix with its applied state.
    const applied = screen.getByText(/Banker rounding/).closest('li')!;
    expect(within(applied).getByText('Applied')).toBeTruthy();
  });

  it('active duel: no winner is claimed and unknowns stay Unknown', () => {
    const [red, blue] = ACTIVE_AUTOMATION_DUEL_FIXTURE.participants;
    render(createElement(RelayDuelResults, {
      view: ACTIVE_AUTOMATION_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    expect(screen.getByTestId('duel-winner').textContent).toBe('Winner: not decided');
    expect(screen.getByTestId(`eval-quality-${red.participantId}`).textContent).toBe('Unknown');
    expect(screen.getByTestId(`performance-delta-${blue.participantId}`).textContent).toBe('Unknown');
    expect(screen.getByText('No verified fixes recorded.')).toBeTruthy();
  });

  it('challenged duel: nothing is scored and nothing pretends to be', () => {
    render(createElement(RelayDuelResults, {
      view: CHALLENGED_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    expect(screen.getByTestId('duel-winner').textContent).toBe('Winner: not decided');
    expect(screen.getAllByText('No proof entries recorded.')).toHaveLength(2);
  });

  it('fixture source renders the SIMULATED DATA banner before any figure', () => {
    render(createElement(RelayDuelResults, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    const results = screen.getByLabelText('Duel results');
    const banner = within(results).getByText(SIMULATED_BANNER);
    expect(banner).toBeTruthy();
    // The banner is the FIRST child — before any figure.
    expect(results.firstElementChild).toBe(banner);
  });

  it('live source shows no simulated-data banner', () => {
    render(createElement(RelayDuelResults, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'live',
    }));
    expect(screen.queryByText(SIMULATED_BANNER)).toBeNull();
  });

  it('source is required — omitting it fails to type-check', () => {
    // @ts-expect-error — RelayDuelResults cannot be constructed without a source.
    const el = createElement(RelayDuelResults, { view: CONCLUDED_MANUAL_DUEL_FIXTURE });
    expect(el).toBeTruthy();
  });
});

describe('RelayColiseumConsole', () => {
  const input = () => screen.getByLabelText('Duel command input') as HTMLInputElement;

  it('fixture source always renders the SIMULATED DATA banner, first, before any figure', () => {
    render(createElement(RelayColiseumConsole, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    const console = screen.getByLabelText('Duel command console');
    const banners = within(console).getAllByText(SIMULATED_BANNER);
    expect(banners.length).toBeGreaterThan(0);
    expect(console.firstElementChild).toBe(banners[0]);
  });

  it('source is required — omitting it fails to type-check', () => {
    // @ts-expect-error — the console cannot be constructed without a source.
    const el = createElement(RelayColiseumConsole, { view: CHALLENGED_DUEL_FIXTURE });
    expect(el).toBeTruthy();
  });

  it('live source shows no simulated-data banner', () => {
    render(createElement(RelayColiseumConsole, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'live',
    }));
    expect(screen.queryByText(SIMULATED_BANNER)).toBeNull();
  });

  it('renders status header, participants and every command with its true binding', () => {
    render(createElement(RelayColiseumConsole, {
      view: ACTIVE_AUTOMATION_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    expect(document.querySelector('.relay-coliseum-console-status')?.textContent)
      .toBe('Active · Automation Fight');
    const [red, blue] = ACTIVE_AUTOMATION_DUEL_FIXTURE.participants;
    expect(screen.getAllByText(red.displayName).length).toBeGreaterThan(0);
    expect(screen.getAllByText(blue.displayName).length).toBeGreaterThan(0);
    expect(screen.getAllByText(SIMULATED_BANNER).length).toBeGreaterThan(0);
    const commands = within(screen.getByLabelText('Duel commands')).getAllByRole('listitem');
    expect(commands).toHaveLength(9);
    // TRACE, SB and VERIFY are bound in the domain; SB must render as bound.
    const boundNames = commands
      .filter((c) => c.getAttribute('data-binding') === 'bound')
      .map((c) => c.querySelector('.relay-coliseum-command-name')?.textContent);
    expect(boundNames).toEqual(['TRACE', 'SB', 'VERIFY']);
    // Unbound commands are labeled truthfully, one per unbound command.
    expect(screen.getAllByText('not yet wired to an engine')).toHaveLength(6);
  });

  it('challenged fixture renders its status truthfully', () => {
    render(createElement(RelayColiseumConsole, {
      view: CHALLENGED_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    expect(document.querySelector('.relay-coliseum-console-status')?.textContent)
      .toBe('Challenged · Manual duel');
  });

  it('Enter dispatches a bound command through the port and says only that it was dispatched', () => {
    const onCommand = vi.fn();
    render(createElement(RelayColiseumConsole, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'development_fixture',
      onCommand,
    }));
    fireEvent.change(input(), { target: { value: '/trace the reclaim' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommand).toHaveBeenCalledExactlyOnceWith('TRACE');
    expect(input().value).toBe('');
    expect(screen.getByText(/TRACE dispatched/).getAttribute('data-tone')).toBe('dispatched');
  });

  it('an unbound command never produces a result — it says it is not wired', () => {
    const onCommand = vi.fn();
    render(createElement(RelayColiseumConsole, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'development_fixture',
      onCommand,
    }));
    fireEvent.change(input(), { target: { value: 'SWARM' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommand).not.toHaveBeenCalled();
    expect(
      screen.getByText('SWARM is not yet wired to an engine — no result was produced.'),
    ).toBeTruthy();
  });

  it('SB is bound and dispatches through the port', () => {
    const onCommand = vi.fn();
    render(createElement(RelayColiseumConsole, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'development_fixture',
      onCommand,
    }));
    fireEvent.change(input(), { target: { value: 'sb repair the queue' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommand).toHaveBeenCalledExactlyOnceWith('SB');
  });

  it('a bound command without a dispatch port says nothing was sent', () => {
    render(createElement(RelayColiseumConsole, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    fireEvent.change(input(), { target: { value: 'VERIFY' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(screen.getByText(/VERIFY is bound, but this surface has no dispatch port/)).toBeTruthy();
  });

  it('unrecognized input dispatches nothing and says so', () => {
    const onCommand = vi.fn();
    render(createElement(RelayColiseumConsole, {
      view: CONCLUDED_MANUAL_DUEL_FIXTURE,
      source: 'development_fixture',
      onCommand,
    }));
    fireEvent.change(input(), { target: { value: 'ATTACK' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onCommand).not.toHaveBeenCalled();
    expect(screen.getByText('"ATTACK" is not a duel command. Nothing was dispatched.')).toBeTruthy();
  });

  it('Ctrl+A requests an Automation Fight through the port', () => {
    const onAutomationFight = vi.fn();
    render(createElement(RelayColiseumConsole, {
      view: CHALLENGED_DUEL_FIXTURE,
      source: 'development_fixture',
      onAutomationFight,
    }));
    fireEvent.keyDown(input(), { key: 'a', ctrlKey: true });
    expect(onAutomationFight).toHaveBeenCalledOnce();
    expect(screen.getByText('Automation Fight requested.')).toBeTruthy();
  });

  it('Ctrl+A without an automation port truthfully starts nothing', () => {
    render(createElement(RelayColiseumConsole, {
      view: CHALLENGED_DUEL_FIXTURE,
      source: 'development_fixture',
    }));
    fireEvent.keyDown(input(), { key: 'A', ctrlKey: true });
    expect(
      screen.getByText('Automation Fight is not yet wired to an engine — no fight was started.'),
    ).toBeTruthy();
  });

  it('plain "a" is typing, not an Automation Fight', () => {
    const onAutomationFight = vi.fn();
    render(createElement(RelayColiseumConsole, {
      view: CHALLENGED_DUEL_FIXTURE,
      source: 'development_fixture',
      onAutomationFight,
    }));
    fireEvent.keyDown(input(), { key: 'a' });
    expect(onAutomationFight).not.toHaveBeenCalled();
  });
});
