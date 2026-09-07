import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  WONDERLAND_USAGE_CHANNEL_STYLE,
  WONDERLAND_USAGE_CHANNEL_SWOOSH,
  projectWonderlandUsageHud,
  projectWonderlandUsageMeter,
  wonderlandSwooshSvgPath,
  wonderlandUsageHudFixture,
} from '../../mission/wonderland/wonderland-usage-meter';
import type {
  WonderlandUsageChannel,
  WonderlandUsageMeter,
} from '../../mission/wonderland/wonderland-usage-meter';
import {
  applyWonderlandUsageReport,
  emptyWonderlandUsageAuthority,
  projectWonderlandUsageFromAuthority,
} from '../../mission/wonderland/wonderland-usage-authority';
import { WonderlandUsageHudView } from './WonderlandUsageHudView';

/**
 * THE HUD, RENDERED.
 *
 * Static markup rather than a DOM harness: everything worth asserting about
 * this component is in what it emits — which paths, which hues, which words —
 * and `renderToStaticMarkup` proves that without a browser. The animation is
 * asserted through `reducedMotion`, which is the one path that has no timer.
 */

const AT = '2026-09-07T10:00:00.000Z';

const meter = (
  channel: WonderlandUsageChannel,
  overrides: { capacityUnits?: number | null; usedUnits?: number | null } = {},
): WonderlandUsageMeter =>
  projectWonderlandUsageMeter({
    channel,
    tierId: `${channel}-tier`,
    tierLabel: 'TIER',
    unitLabel: 'WONDER',
    capacityUnits: 'capacityUnits' in overrides ? overrides.capacityUnits : 400,
    usedUnits: 'usedUnits' in overrides ? overrides.usedUnits : 160,
    referenceCapacityUnits: 400,
    provenance: 'live',
    observedAtIso: AT,
  });

const render = (
  compound: WonderlandUsageMeter,
  single: WonderlandUsageMeter,
): string =>
  renderToStaticMarkup(
    <WonderlandUsageHudView
      hud={projectWonderlandUsageHud({
        compoundAgent: compound,
        singleAgent: single,
        observedAtIso: AT,
      })}
      reducedMotion
    />,
  );

describe('the Wonderland usage HUD', () => {
  it('anchors in the top-left corner', () => {
    const html = render(meter('compound_agent'), meter('single_agent'));
    expect(html).toContain('data-anchor="top_left"');
  });

  it('draws both bars in their own colours', () => {
    const html = render(meter('compound_agent'), meter('single_agent'));
    expect(html).toContain(WONDERLAND_USAGE_CHANNEL_STYLE.compound_agent.accent);
    expect(html).toContain(WONDERLAND_USAGE_CHANNEL_STYLE.single_agent.accent);
    expect(html).toContain('COMPOUND AGENT');
    expect(html).toContain('SINGLE AGENT');
  });

  it('owns no animation loop — the website has exactly one, and it is the world', () => {
    // The drain is an SVG mask whose dash offset CSS transitions. A frame loop
    // here would be a second clock, and `relay-dog-motion-boundary.test.ts`
    // exists to refuse one.
    const source = readFileSync(join(__dirname, 'WonderlandUsageHudView.tsx'), 'utf8');
    // The same shape the boundary test itself matches: a CALL, so the prose
    // above may name the thing it refuses to start.
    expect(source).not.toMatch(/requestAnimationFrame\(/);
    expect(source).not.toMatch(/setInterval\(|setTimeout\(/);
  });

  it('honours reduced motion by not transitioning at all', () => {
    const still = render(meter('compound_agent'), meter('single_agent'));
    expect(still).not.toContain('stroke-dashoffset 520ms');
  });

  it('gives two HUDs on one page different mask ids', () => {
    // SVG mask ids are document-global. Sharing one means the first HUD's mask
    // paints both, so the second shows the FIRST meter's remainder under its
    // own numbers — every figure on screen correct and the picture wrong. The
    // four-panel preview showed exactly that.
    const one = renderToStaticMarkup(
      <WonderlandUsageHudView
        hud={projectWonderlandUsageHud({
          compoundAgent: meter('compound_agent', { usedUnits: 10 }),
          singleAgent: meter('single_agent', { usedUnits: 10 }),
          observedAtIso: AT,
        })}
        reducedMotion
        instanceId="first"
      />,
    );
    const two = renderToStaticMarkup(
      <WonderlandUsageHudView
        hud={projectWonderlandUsageHud({
          compoundAgent: meter('compound_agent', { usedUnits: 380 }),
          singleAgent: meter('single_agent', { usedUnits: 380 }),
          observedAtIso: AT,
        })}
        reducedMotion
        instanceId="second"
      />,
    );
    const ids = (html: string): string[] =>
      [...html.matchAll(/mask id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(one).length).toBeGreaterThan(0);
    for (const id of ids(one)) expect(ids(two)).not.toContain(id);
  });

  it('shows two different remainders as two different strokes', () => {
    const offsets = (used: number): string[] => {
      const html = renderToStaticMarkup(
        <WonderlandUsageHudView
          hud={projectWonderlandUsageHud({
            compoundAgent: meter('compound_agent', { usedUnits: used }),
            singleAgent: meter('single_agent', { usedUnits: used }),
            observedAtIso: AT,
          })}
          reducedMotion
          instanceId={`u${used}`}
        />,
      );
      return [...html.matchAll(/stroke-dashoffset="([^"]+)"/g)].map((m) => m[1]);
    };
    expect(offsets(40)).not.toEqual(offsets(360));
  });

  it('masks over the whole unit box, not over the cropped viewBox', () => {
    // A <mask> defaults to a region that is a PERCENTAGE OF THE VIEWPORT. Once
    // the viewBox was cropped to a wide band that default stopped around y=52,
    // while the ring's lower arc and the entire single-agent bar sit near y=66
    // — both masked away, both rendering as bare track, every number on screen
    // still correct.
    const html = render(meter('compound_agent'), meter('single_agent'));
    const regions = [...html.matchAll(/<mask[^>]*>/g)].map((m) => m[0]);
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      expect(region).toContain('maskUnits="userSpaceOnUse"');
      // Covers 0..100 in both axes, with margin.
      expect(Number(/x="(-?[\d.]+)"/.exec(region)?.[1])).toBeLessThanOrEqual(0);
      expect(Number(/y="(-?[\d.]+)"/.exec(region)?.[1])).toBeLessThanOrEqual(0);
      expect(Number(/width="([\d.]+)"/.exec(region)?.[1])).toBeGreaterThanOrEqual(100);
      expect(Number(/height="([\d.]+)"/.exec(region)?.[1])).toBeGreaterThanOrEqual(100);
    }
  });

  it('never intercepts the world it sits over', () => {
    const css = readFileSync(join(__dirname, 'wonderland-hud.css'), 'utf8');
    expect(css).toMatch(/pointer-events:\s*none/);
  });

  it('holds no colour of its own — every hue comes from the contract', () => {
    // Unreal draws this same HUD from the same struct. A hue that lived only in
    // the stylesheet would be one Unreal had to guess at.
    const css = readFileSync(join(__dirname, 'wonderland-hud.css'), 'utf8');
    for (const style of Object.values(WONDERLAND_USAGE_CHANNEL_STYLE)) {
      expect(css).not.toContain(style.accent);
      expect(css).not.toContain(style.bright);
      expect(css).not.toContain(style.track);
    }
  });

  it('says UNKNOWN rather than drawing an empty bar', () => {
    const blank = projectWonderlandUsageMeter({
      channel: 'compound_agent',
      provenance: 'live',
      observedAtIso: AT,
    });
    const html = render(blank, meter('single_agent'));
    expect(html).toContain('UNKNOWN');
    // The frame still draws — its absence would read as a broken HUD — but
    // nothing is filled, and no number is shown.
    expect(html).toContain('wh-track');
    expect(html).toContain('data-known="false"');
  });

  it('draws a longer track for a larger capacity, not a fuller one', () => {
    const at = (capacityUnits: number): string => {
      const html = render(
        projectWonderlandUsageMeter({
          channel: 'compound_agent',
          capacityUnits,
          usedUnits: 50,
          referenceCapacityUnits: 400,
          provenance: 'live',
          observedAtIso: AT,
        }),
        meter('single_agent'),
      );
      // The compound stroke specifically — the single-agent stroke is drawn
      // first and is identical in both renders.
      const group = html.slice(html.indexOf('wh-stroke--compound_agent'));
      return group.match(/class="wh-track" d="([^"]*)"/)?.[1] ?? '';
    };

    // The component draws EXACTLY the contract's geometry for the capacity it
    // was given — not a percentage of a fixed-length bar.
    expect(at(100)).toBe(
      wonderlandSwooshSvgPath({
        to: 0.25,
        shape: WONDERLAND_USAGE_CHANNEL_SWOOSH.compound_agent,
        scale: 100,
      }),
    );
    expect(at(400)).toBe(
      wonderlandSwooshSvgPath({
        to: 1,
        shape: WONDERLAND_USAGE_CHANNEL_SWOOSH.compound_agent,
        scale: 100,
      }),
    );
    expect(at(100)).not.toBe(at(400));
  });

  it('draws a full stroke when nothing has been spent, and none when it is gone', () => {
    // The meter DRAINS. Untouched is full; exhausted is empty. The readout
    // beside it counts down, and the two must never disagree.
    const untouched = render(
      meter('compound_agent', { usedUnits: 0 }),
      meter('single_agent', { usedUnits: 0 }),
    );
    expect(untouched).toContain('wh-fill');
    expect(untouched).toContain('400 / 400 WONDER');
    // A full meter reveals the whole spine: dash offset 0 hides nothing.
    expect(untouched).toContain('stroke-dashoffset="0"');

    const spent = render(
      meter('compound_agent', { usedUnits: 400 }),
      meter('single_agent', { usedUnits: 400 }),
    );
    expect(spent).not.toContain('wh-fill');
    expect(spent).toContain('0 / 400 WONDER');
  });

  it('labels a simulated reading on its own face', () => {
    const html = renderToStaticMarkup(
      <WonderlandUsageHudView hud={wonderlandUsageHudFixture(AT)} reducedMotion />,
    );
    expect(html).toContain('SIMULATED');
  });

  it('does not label a live reading as simulated', () => {
    const html = render(meter('compound_agent'), meter('single_agent'));
    expect(html).not.toContain('SIMULATED');
  });

  it('draws the dominant frame last, so the contract decides the stacking', () => {
    // `emphasis: 0` means "draws later, and on top". In SVG that is document
    // order, so the Compound frame must be the LAST stroke emitted — and it is
    // the contract that says so, not whichever element was written second.
    const html = render(meter('compound_agent'), meter('single_agent'));
    expect(WONDERLAND_USAGE_CHANNEL_STYLE.compound_agent.emphasis).toBeLessThan(
      WONDERLAND_USAGE_CHANNEL_STYLE.single_agent.emphasis,
    );
    expect(html.indexOf('wh-stroke--compound_agent')).toBeGreaterThan(
      html.indexOf('wh-stroke--single_agent'),
    );
  });

  it('lists the dominant channel first in the readout', () => {
    // Stacking order and READING order are different questions: the frame is
    // drawn last so it sits on top, and named first so the eye starts there.
    const html = render(meter('compound_agent'), meter('single_agent'));
    expect(html.indexOf('data-channel="compound_agent"')).toBeLessThan(
      html.indexOf('data-channel="single_agent"'),
    );
  });
});

/* ------------------------------------------------- the authority reading */

describe('the HUD says how much to believe its own figures', () => {
  const AUTHORITY_AT = '2026-09-07T10:00:00.000Z';
  const later = (seconds: number): string =>
    new Date(Date.parse(AUTHORITY_AT) + seconds * 1000).toISOString();

  const bound = (readAtIso: string, unavailableReason: string | null = null) => {
    const state = applyWonderlandUsageReport(
      emptyWonderlandUsageAuthority({ projectId: 'p1' }),
      {
        schemaVersion: 'relay-wonderland-usage-report.v1',
        projectId: 'p1',
        revision: 1,
        reportedAtIso: AUTHORITY_AT,
        authorityId: 'a1',
        unavailableReason,
        compoundAgent: {
          current: 300, maximum: 480, reference: 480,
          tierId: 't3', tierLabel: 'TIER III', unitLabel: 'WONDER',
        },
        singleAgent: {
          current: 40, maximum: 120, reference: 120,
          tierId: 't1', tierLabel: 'TIER I', unitLabel: 'WONDER',
        },
      },
    );
    const projection = projectWonderlandUsageFromAuthority(state, readAtIso);
    return renderToStaticMarkup(
      <WonderlandUsageHudView
        hud={projection.hud}
        status={projection.status}
        reducedMotion
        instanceId="authority"
      />,
    );
  };

  it('says nothing extra when the figures are current', () => {
    const html = bound(later(10));
    expect(html).not.toContain('STALE');
    expect(html).not.toContain('SIMULATED');
    expect(html).toContain('300 / 480 WONDER');
  });

  it('labels stale figures as stale, and still shows them', () => {
    // A stale figure is information. Hiding it leaves a founder with nothing.
    const html = bound(later(600));
    expect(html).toContain('STALE');
    expect(html).toContain('300 / 480 WONDER');
    expect(html).toContain('may have moved');
  });

  it('tells a refusing authority apart from a silent one', () => {
    const refusing = bound(later(10), 'The metering service is not reachable.');
    expect(refusing).toContain('USAGE AUTHORITY UNAVAILABLE');
    expect(refusing).toContain('not reachable');
    expect(refusing).toContain('UNKNOWN');

    const silent = renderToStaticMarkup(
      <WonderlandUsageHudView
        hud={
          projectWonderlandUsageFromAuthority(
            emptyWonderlandUsageAuthority({ projectId: 'p1' }),
            AUTHORITY_AT,
          ).hud
        }
        status={
          projectWonderlandUsageFromAuthority(
            emptyWonderlandUsageAuthority({ projectId: 'p1' }),
            AUTHORITY_AT,
          ).status
        }
        reducedMotion
        instanceId="silent"
      />,
    );
    expect(silent).toContain('NO USAGE AUTHORITY REPORTING');
    expect(silent).not.toContain('UNAVAILABLE');
  });

  it('lets the reading outrank the provenance line rather than showing both', () => {
    // "Simulated" and "stale" are both true of a stale live figure, and showing
    // both leaves a reader deciding which to act on.
    const html = bound(later(600));
    expect(html).not.toContain('SIMULATED · NO USAGE AUTHORITY REPORTING');
  });

  it('renders the reading as WORDS, never as a colour alone', () => {
    const html = bound(later(600));
    // A viewer who has to learn that a faded meter means "old" has not been told.
    expect(/STALE[^<]*/.test(html)).toBe(true);
  });
});
