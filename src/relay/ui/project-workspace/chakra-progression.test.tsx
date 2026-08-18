/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { RelayPixelDog } from '../pixel-dog';
import { RelayChakraTierPicker } from './RelayChakraTierPicker';
import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import { WORKSPACE_FIXTURES } from './fixtures';
import { MAX_LEVEL_AGENT_PROGRESSION_FIXTURE } from '../coliseum/fixtures';
import {
  CHAKRA_ACCENTS,
  CHAKRA_TIERS,
  RELAY_DOG_DEFAULT_ACCENT,
  chakraAccent,
  chakraDogPalette,
  chakraLabel,
  isChakraTier,
} from '../../shared/relay-chakra';

/**
 * THE PROGRESSION IS AN ACCENT, AND IT IS NOT A RANK.
 *
 * Two things are held here and they pull in opposite directions, which is why
 * both are asserted.
 *
 * The visual one: a tier reaches the eyes, the collar and the light the figure
 * casts, and reaches NOTHING ELSE. The body, its shading and the visor are the
 * animal's identity; a tier that recoloured them would be the flat colour
 * swatch the direction forbids.
 *
 * The honest one: Relay awards no levels. There is no ledger, no counter and
 * no rule that advances a tier, so the surface must present it as chosen
 * rather than earned — and `null` must stay a real answer instead of quietly
 * becoming root.
 */

afterEach(cleanup);

const noop = () => undefined;

describe('the tier data', () => {
  it('covers the seven chakras in order, once each', () => {
    expect(CHAKRA_TIERS).toEqual([
      'root', 'sacral', 'solar_plexus', 'heart', 'throat', 'third_eye', 'crown',
    ]);
    expect(CHAKRA_TIERS.map((t) => CHAKRA_ACCENTS[t].step)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(new Set(CHAKRA_TIERS.map((t) => CHAKRA_ACCENTS[t].accent)).size)
      .toBe(CHAKRA_TIERS.length);
  });

  it('keeps Relay’s own gold as a tier rather than inventing a new identity', () => {
    // The product already looks like this. If no tier were the shipped gold,
    // no tier would look like Relay.
    expect(CHAKRA_ACCENTS.solar_plexus.accent).toBe(RELAY_DOG_DEFAULT_ACCENT.accent);
    expect(CHAKRA_ACCENTS.solar_plexus.bright).toBe(RELAY_DOG_DEFAULT_ACCENT.bright);
  });

  it('resolves an absent, unknown or forked tier to the shipped colours, never to root', () => {
    for (const value of [null, undefined, 'kundalini', 7, {}]) {
      expect(isChakraTier(value)).toBe(false);
      expect(chakraAccent(value)).toEqual(RELAY_DOG_DEFAULT_ACCENT);
      expect(chakraAccent(value).accent).not.toBe(CHAKRA_ACCENTS.root.accent);
      expect(chakraLabel(value)).toBe('NO TIER');
    }
  });

  it('recolours the eyes and the collar, and nothing else', () => {
    for (const tier of CHAKRA_TIERS) {
      const palette = chakraDogPalette(tier);
      // `y` is the eye, `c` the collar. `w`, `s` and `d` — body, shading and
      // visor — must be absent: the animal's identity is not a colour chip.
      expect(Object.keys(palette).sort()).toEqual(['c', 'y']);
    }
  });
});

describe('the Dog with a tier', () => {
  const eyeRects = (container: HTMLElement, hex: string) =>
    Array.from(container.querySelectorAll('rect')).filter(
      (r) => (r.getAttribute('fill') ?? '').toLowerCase() === hex.toLowerCase(),
    );

  it('renders exactly as shipped when no tier is chosen', () => {
    const { container } = render(<RelayPixelDog pose="standing" label="READY" unit={1} />);
    expect(eyeRects(container, RELAY_DOG_DEFAULT_ACCENT.bright).length).toBeGreaterThan(0);
    expect(container.querySelector('.rpd--tier')).toBeNull();
    for (const tier of CHAKRA_TIERS) {
      if (tier === 'solar_plexus') continue; // that IS the shipped gold
      expect(eyeRects(container, CHAKRA_ACCENTS[tier].bright)).toHaveLength(0);
    }
  });

  it('paints the eyes and collar in the tier, leaving the body untouched', () => {
    const { container } = render(
      <RelayPixelDog pose="standing" label="READY" unit={1} tier="throat" />,
    );
    expect(eyeRects(container, CHAKRA_ACCENTS.throat.bright).length).toBeGreaterThan(0);
    expect(eyeRects(container, CHAKRA_ACCENTS.throat.accent).length).toBeGreaterThan(0);
    // The bone-white body and the dark visor are still there, in their own
    // colours — a tier lights the animal, it does not repaint it.
    expect(eyeRects(container, '#ece9e2').length).toBeGreaterThan(0);
    expect(eyeRects(container, '#23262e').length).toBeGreaterThan(0);
    // And the shipped gold is gone from the sprite entirely.
    expect(eyeRects(container, RELAY_DOG_DEFAULT_ACCENT.bright)).toHaveLength(0);
  });

  it('publishes the accent as variables the surrounding surface can share', () => {
    const { container } = render(
      <RelayPixelDog pose="standing" label="READY" unit={1} tier="crown" />,
    );
    const figure = container.querySelector('.rpd') as HTMLElement;
    expect(figure.style.getPropertyValue('--rpd-accent')).toBe(CHAKRA_ACCENTS.crown.accent);
    expect(figure.style.getPropertyValue('--rpd-accent-glow')).toBe(CHAKRA_ACCENTS.crown.glow);
    expect(figure.className).toContain('rpd--tier-crown');
  });

  it('keeps the tier under reduced motion, because colour is not movement', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'relay', 'ui', 'pixel-dog', 'pixel-dog.css'), 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion'));
    expect(reduced).not.toContain('rpd--tier');
    // And the marker keeps its own meaning rather than the tier's colour.
    expect(css).not.toContain('.rpd--tier .rpd-marker {');
  });
});

describe('earned over chosen', () => {
  type WorkspaceProps = ComponentProps<typeof RelayProjectWorkspace>;
  const workspaceHtml = (overrides: Partial<WorkspaceProps> = {}) =>
    renderToStaticMarkup(
      createElement(RelayProjectWorkspace, {
        ...WORKSPACE_FIXTURES.implementing,
        terminalOpen: false,
        onSendProjectMessage: noop,
        onApproveDecision: noop,
        onRejectDecision: noop,
        onOpenTerminal: noop,
        onCloseTerminal: noop,
        onOpenProjectSettings: noop,
        onOpenManualTask: noop,
        onApproveManualTask: noop,
        onRejectManualTask: noop,
        onRequestResearch: noop,
        onOpenFinding: noop,
        onOpenRepair: noop,
        onReturnHome: noop,
        chakraTier: 'heart',
        ...overrides,
      } as WorkspaceProps),
    );

  it('a supplied progression view makes the EARNED tier win on the Dog and the accent', () => {
    // The max-level fixture earned CROWN through the real curve; HEART is chosen.
    const html = workspaceHtml({
      agentProgression: {
        view: MAX_LEVEL_AGENT_PROGRESSION_FIXTURE,
        source: 'development_fixture',
      },
    });
    expect(MAX_LEVEL_AGENT_PROGRESSION_FIXTURE.earnedChakraTier).toBe('crown');
    expect(html).toContain('rpd--tier-crown');
    expect(html).not.toContain('rpd--tier-heart');
    expect(html).toContain(`--rpb-accent:${CHAKRA_ACCENTS.crown.accent}`);
    expect(html).not.toContain(`--rpb-accent:${CHAKRA_ACCENTS.heart.accent}`);
    // The picker states the override truthfully and drops the no-levels claim.
    expect(html).toContain('earned in the Coliseum');
    expect(html).toContain('overrides the');
    expect(html).not.toContain('Relay awards no levels');
    // And the mounted panel carries its fixture disclosure.
    expect(html).toContain('SIMULATED DATA');
  });

  it('absent progression renders EXACTLY as before: the chosen tier stands', () => {
    const html = workspaceHtml();
    expect(html).toContain('rpd--tier-heart');
    expect(html).not.toContain('rpd--tier-crown');
    expect(html).toContain(`--rpb-accent:${CHAKRA_ACCENTS.heart.accent}`);
    expect(html).toContain('Relay awards no levels');
    expect(html).not.toContain('earned in the Coliseum');
  });
});

describe('the tier picker', () => {
  it('says the tier is chosen and not earned', () => {
    render(<RelayChakraTierPicker selected={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/Relay awards no levels/)).toBeTruthy();
    expect(screen.getByText(/chosen, not earned/)).toBeTruthy();
  });

  it('offers NO TIER as a real choice, selected when nothing is chosen', () => {
    const onSelect = vi.fn();
    render(<RelayChakraTierPicker selected={null} onSelect={onSelect} />);
    const none = screen.getByRole('radio', { name: /NO TIER/ }) as HTMLInputElement;
    expect(none.checked).toBe(true);
    expect(screen.getAllByRole('radio')).toHaveLength(CHAKRA_TIERS.length + 1);
  });

  it('reports the chosen tier, and null when the choice is removed', () => {
    const onSelect = vi.fn();
    render(<RelayChakraTierPicker selected="heart" onSelect={onSelect} />);
    expect((screen.getByRole('radio', { name: /HEART/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /CROWN/ }));
    expect(onSelect).toHaveBeenCalledWith('crown');
    fireEvent.click(screen.getByRole('radio', { name: /NO TIER/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('states an earned override instead of the no-levels note when a tier is earned', () => {
    render(<RelayChakraTierPicker selected="heart" earnedTier="crown" onSelect={vi.fn()} />);
    expect(screen.getByTestId('rctp-earned-note').textContent)
      .toContain('CROWN was earned in the Coliseum');
    expect(screen.getByTestId('rctp-earned-note').textContent)
      .toContain('overrides the chosen appearance');
    expect(screen.queryByText(/Relay awards no levels/)).toBeNull();
    // The CHOICE itself is untouched: heart stays selected.
    expect((screen.getByRole('radio', { name: /HEART/ }) as HTMLInputElement).checked).toBe(true);
  });

  it('with no earned tier — the default — the picker reads exactly as before', () => {
    render(<RelayChakraTierPicker selected="heart" earnedTier={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/chosen, not earned/)).toBeTruthy();
    expect(screen.queryByTestId('rctp-earned-note')).toBeNull();
  });

  it('draws no inputs for a host that cannot store the choice', () => {
    render(<RelayChakraTierPicker selected="root" />);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText('SELECTED')).toBeTruthy();
  });
});
