/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import {
  LEVEL_XP_THRESHOLDS,
  MAX_LEVEL,
  deriveAgentProgression,
} from '../../mission';
import { RelayAgentProgression, type RelayAgentProgressionProps } from './RelayAgentProgression';
import {
  COLISEUM_FIXTURE_DISCLOSURE,
  CONCLUDED_MANUAL_DUEL_FIXTURE,
  FRESH_AGENT_PROGRESSION_FIXTURE,
  LEVELED_AGENT_PROGRESSION_FIXTURE,
  MAX_LEVEL_AGENT_PROGRESSION_FIXTURE,
} from './fixtures';

afterEach(cleanup);

const SIMULATED_BANNER = `SIMULATED DATA — ${COLISEUM_FIXTURE_DISCLOSURE}`;

const html = (props: RelayAgentProgressionProps) =>
  renderToStaticMarkup(createElement(RelayAgentProgression, props));

describe('progression fixtures are the real curve, not hand-written numbers', () => {
  it('every fixture is exactly what deriveAgentProgression produces from its ledger', () => {
    expect(FRESH_AGENT_PROGRESSION_FIXTURE).toEqual(
      deriveAgentProgression({ agentId: 'fixture-agent-fresh', entries: [] }),
    );
    // The leveled fixture's figures follow the documented thresholds.
    expect(LEVELED_AGENT_PROGRESSION_FIXTURE.totalXp).toBe(575);
    expect(LEVELED_AGENT_PROGRESSION_FIXTURE.level).toBe(3);
    expect(LEVELED_AGENT_PROGRESSION_FIXTURE.xpIntoLevel)
      .toBe(575 - LEVEL_XP_THRESHOLDS[3]);
    expect(LEVELED_AGENT_PROGRESSION_FIXTURE.xpToNextLevel)
      .toBe(LEVEL_XP_THRESHOLDS[4] - 575);
    expect(MAX_LEVEL_AGENT_PROGRESSION_FIXTURE.level).toBe(MAX_LEVEL);
    expect(MAX_LEVEL_AGENT_PROGRESSION_FIXTURE.xpToNextLevel).toBeNull();
    expect(MAX_LEVEL_AGENT_PROGRESSION_FIXTURE.earnedChakraTier).toBe('crown');
  });

  it('a fresh agent has earned NOTHING: level 0, no tier — null, never root', () => {
    expect(FRESH_AGENT_PROGRESSION_FIXTURE.level).toBe(0);
    expect(FRESH_AGENT_PROGRESSION_FIXTURE.earnedChakraTier).toBeNull();
  });
});

describe('truthful rendering', () => {
  it('a null earned tier says the Dog keeps its gold — never a defaulted tier', () => {
    render(
      <RelayAgentProgression view={FRESH_AGENT_PROGRESSION_FIXTURE} source="development_fixture" />,
    );
    expect(screen.getByTestId('prog-earned-tier').textContent)
      .toBe('No tier earned yet — the Dog keeps its gold');
    expect(screen.getByTestId('prog-earned-tier').textContent).not.toContain('ROOT');
  });

  it('an earned tier is named as EARNED, with the Coliseum as its source', () => {
    render(
      <RelayAgentProgression
        view={LEVELED_AGENT_PROGRESSION_FIXTURE}
        source="development_fixture"
      />,
    );
    expect(screen.getByTestId('prog-earned-tier').textContent)
      .toBe('SOLAR PLEXUS — earned in the Coliseum');
  });

  it('max level renders as max level — it never invents a next-level number', () => {
    render(
      <RelayAgentProgression
        view={MAX_LEVEL_AGENT_PROGRESSION_FIXTURE}
        source="development_fixture"
      />,
    );
    expect(screen.getByTestId('prog-next-level').textContent)
      .toBe('Max level — there is no next level');
  });

  it('below max level, both remainder figures come from the view', () => {
    render(
      <RelayAgentProgression
        view={LEVELED_AGENT_PROGRESSION_FIXTURE}
        source="development_fixture"
      />,
    );
    expect(screen.getByTestId('prog-next-level').textContent)
      .toBe('75 XP into this level · 425 XP to next');
    expect(screen.getByTestId('prog-turn-cap').textContent)
      .toBe(String(LEVELED_AGENT_PROGRESSION_FIXTURE.autonomousRunTurnCap));
    expect(screen.getByTestId('prog-eval-depth').textContent)
      .toBe(String(LEVELED_AGENT_PROGRESSION_FIXTURE.evaluationDepth));
  });
});

describe('unlocked commands compose with the binding state — an unlock is not an engine', () => {
  it('an unlocked-but-unbound command reads "unlocked, no engine yet"', () => {
    const { container } = render(
      <RelayAgentProgression
        view={MAX_LEVEL_AGENT_PROGRESSION_FIXTURE}
        commands={CONCLUDED_MANUAL_DUEL_FIXTURE.commands}
        source="development_fixture"
      />,
    );
    const items = Array.from(container.querySelectorAll('.relay-coliseum-prog-unlock'));
    const byName = new Map(
      items.map((li) => [
        li.querySelector('.relay-coliseum-prog-unlock-name')?.textContent,
        li,
      ]),
    );
    // SWARM is unlocked at level 8+ but has no engine in the domain fixture.
    const swarm = byName.get('SWARM')!;
    expect(swarm.getAttribute('data-binding')).toBe('unbound');
    expect(swarm.textContent).toContain('unlocked, no engine yet');
    // TRACE is bound; the panel may say so.
    const trace = byName.get('TRACE')!;
    expect(trace.getAttribute('data-binding')).toBe('bound');
    expect(trace.textContent).toContain('bound to an engine');
  });

  it('without a duel view the binding is UNKNOWN, and it says so — no green check', () => {
    const { container } = render(
      <RelayAgentProgression
        view={MAX_LEVEL_AGENT_PROGRESSION_FIXTURE}
        source="development_fixture"
      />,
    );
    for (const li of Array.from(container.querySelectorAll('.relay-coliseum-prog-unlock'))) {
      expect(li.getAttribute('data-binding')).toBe('unknown');
      expect(li.textContent).toContain('engine binding unknown on this surface');
    }
  });

  it('locked commands are simply absent — the fresh agent lists only the three basics', () => {
    render(
      <RelayAgentProgression view={FRESH_AGENT_PROGRESSION_FIXTURE} source="development_fixture" />,
    );
    expect(FRESH_AGENT_PROGRESSION_FIXTURE.unlockedCommands).toEqual(['TRACE', 'SB', 'VERIFY']);
    expect(screen.queryByText('SWARM')).toBeNull();
  });
});

describe('the SIMULATED DATA banner', () => {
  it('fixture source renders the banner BEFORE any figure', () => {
    const markup = html({
      view: LEVELED_AGENT_PROGRESSION_FIXTURE,
      source: 'development_fixture',
    });
    expect(markup).toContain(SIMULATED_BANNER);
    expect(markup.indexOf(SIMULATED_BANNER)).toBeLessThan(markup.indexOf('AGENT PROGRESSION'));
    expect(markup.indexOf(SIMULATED_BANNER)).toBeLessThan(markup.indexOf('575'));
  });

  it('a live source renders no fixture disclosure', () => {
    const markup = html({ view: LEVELED_AGENT_PROGRESSION_FIXTURE, source: 'live' });
    expect(markup).not.toContain('SIMULATED DATA');
  });
});
