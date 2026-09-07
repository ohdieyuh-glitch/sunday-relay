import { useId } from 'react';

import {
  WONDERLAND_USAGE_CHANNELS,
  WONDERLAND_USAGE_CHANNEL_STYLE,
  WONDERLAND_USAGE_CHANNEL_SWOOSH,
  WONDERLAND_USAGE_TRANSITION,
  WONDERLAND_USAGE_VIEWPORT,
  wonderlandSwooshSpineSvgPath,
  wonderlandSwooshSvgPath,
} from '../../mission/wonderland/wonderland-usage-meter';
import type {
  WonderlandUsageChannel,
  WonderlandUsageHud,
  WonderlandUsageMeter,
} from '../../mission/wonderland/wonderland-usage-meter';

/**
 * THE WONDERLAND USAGE HUD — the top-left corner, rendered.
 *
 * A PRESENTER AND NOTHING ELSE. Every number, every colour, every control point
 * and the transition timing come from
 * `mission/wonderland/wonderland-usage-meter`; this file decides no capacity,
 * derives no percentage, and holds no palette of its own. The reason is the one
 * the Wonderland contract is built on: Unreal draws this same HUD from the same
 * struct, and a colour or a curve that lived only in a stylesheet would be one
 * Unreal had to guess at.
 *
 * THE METER DRAINS. The stroke is `remainingFraction` — what is LEFT — because
 * the readout beside it counts down, and a picture measuring spend beside words
 * measuring remainder disagree at every value but half. That exact combination
 * shipped briefly and produced an untouched meter reading "480 / 480" next to
 * an empty bar; both halves were correct and together they were nonsense.
 *
 * THE TWO BARS ARE THE SAME GEOMETRY AT TWO EXTENTS. The track is the swoosh
 * drawn to `capacitySpan`; the remainder is that same ribbon revealed along its
 * own spine. One curve, one extent, so the two cannot diverge — and a bigger
 * tier is a LONGER track rather than a differently-shaded one.
 *
 * NO ANIMATION LOOP LIVES HERE, and that is architectural rather than
 * incidental. `relay-dog-motion-boundary.test.ts` allows exactly one
 * `requestAnimationFrame` owner in the whole website — the world's scene — so
 * the drain is done with an SVG mask whose dash offset CSS transitions. The
 * browser interpolates it, nothing ticks, and the HUD cannot become a second
 * clock that disagrees with the first. A first version of this file did own a
 * frame loop, and that boundary test is what caught it.
 *
 * UNKNOWN RENDERS AS UNKNOWN. A figure that is not known has no stroke at all
 * and says so in words. A full bar would claim capacity nobody reported; an
 * empty one would claim it had all been spent.
 *
 * SIMULATED SAYS SO, on the HUD's own face rather than in a corner of the page.
 * No usage authority exists yet, so this is what it will normally say.
 */

/**
 * Unit-box coordinates are multiplied by this before they reach the SVG, so the
 * numbers in the markup are readable and the dash arithmetic stays in integers.
 * The contract's shapes live in a 0..1 box; the window onto it is the
 * contract's too.
 */
const VIEW = 100;

/** The cropped window, in viewBox units. Wide, because the drawing is. */
const VIEW_BOX = [
  WONDERLAND_USAGE_VIEWPORT.x * VIEW,
  WONDERLAND_USAGE_VIEWPORT.y * VIEW,
  WONDERLAND_USAGE_VIEWPORT.width * VIEW,
  WONDERLAND_USAGE_VIEWPORT.height * VIEW,
].join(' ');

/**
 * How much of the spine the leading highlight covers, as an arc fraction.
 * Small enough to read as an edge rather than as a second colour band.
 */
const HEAD_ARC = 0.035;

/** Below this the remainder is drawn as nothing rather than as a speck. */
const MINIMUM_VISIBLE_ARC = 0.004;

/**
 * THE MASK REGION, STATED, because its default is a trap.
 *
 * A `<mask>` defaults to `x=-10% y=-10% width=120% height=120%`, and under
 * `userSpaceOnUse` those percentages resolve against the VIEWPORT — not against
 * the content, and not against the unit box. So the moment the viewBox was
 * cropped to a wide band, the default region ended around y=52 while the ring's
 * lower arc and the whole single-agent bar sit near y=66: both were masked away
 * and rendered as bare track. Every number on screen stayed correct and half the
 * drawing went dark, which is the same class of defect as the shared mask id.
 *
 * The unit box is 0..100 after scaling, so this covers it with margin whatever
 * window the viewport crops to.
 */
const MASK_REGION = { x: -20, y: -20, width: 140, height: 140 } as const;

function ChannelStroke({
  channel,
  meter,
  reducedMotion,
  instanceId,
}: {
  readonly channel: WonderlandUsageChannel;
  readonly meter: WonderlandUsageMeter;
  readonly reducedMotion: boolean;
  readonly instanceId: string;
}): JSX.Element {
  const style = WONDERLAND_USAGE_CHANNEL_STYLE[channel];
  const shape = WONDERLAND_USAGE_CHANNEL_SWOOSH[channel];

  // A capacity nobody reported still draws the frame: the shape is the HUD's
  // furniture, and its absence would read as a broken HUD rather than as an
  // unreported one. What it does NOT draw is any remainder.
  const span = meter.capacitySpan.known ? (meter.capacitySpan.value as number) : 1;
  const left = meter.remainingFraction.known ? (meter.remainingFraction.value as number) : 0;
  const visible = meter.remainingFraction.known && left * span > MINIMUM_VISIBLE_ARC;

  const trackPath = wonderlandSwooshSvgPath({ to: span, shape, scale: VIEW });
  const spinePath = wonderlandSwooshSpineSvgPath({ to: span, shape, scale: VIEW });
  // The mask stroke has to be wider than the ribbon it reveals, or the reveal
  // would clip the ribbon's own edges.
  const maskWidth = Math.max(shape.tailWidth, shape.tipWidth) * 4 * VIEW;

  const transition = reducedMotion
    ? undefined
    : `stroke-dashoffset ${WONDERLAND_USAGE_TRANSITION.durationMs}ms ${WONDERLAND_USAGE_TRANSITION.cssTimingFunction}`;
  const transitionStyle = transition === undefined ? undefined : { transition };

  const revealId = `wh-reveal-${instanceId}-${channel}`;
  const headId = `wh-head-${instanceId}-${channel}`;

  return (
    <g className={`wh-stroke wh-stroke--${channel}`} data-known={meter.remainingFraction.known}>
      <defs>
        {/*
          `pathLength="1"` normalises the dash arithmetic to the fraction the
          contract already speaks in, so nothing here has to measure the curve.
          A dash of 1 with a gap of 1 means offset 0 shows everything and
          offset 1 shows nothing.
        */}
        <mask id={revealId} maskUnits="userSpaceOnUse" {...MASK_REGION}>
          <path
            className="wh-reveal"
            d={spinePath}
            pathLength="1"
            fill="none"
            stroke="#fff"
            strokeWidth={maskWidth}
            strokeLinecap="butt"
            strokeDasharray="1 1"
            strokeDashoffset={1 - left}
            style={transitionStyle}
          />
        </mask>
        {/*
          The leading edge: the same spine with a short dash whose trailing edge
          sits exactly at the remainder, so it travels WITH the reveal instead of
          being positioned each frame.
        */}
        <mask id={headId} maskUnits="userSpaceOnUse" {...MASK_REGION}>
          <path
            className="wh-reveal"
            d={spinePath}
            pathLength="1"
            fill="none"
            stroke="#fff"
            strokeWidth={maskWidth}
            strokeLinecap="butt"
            strokeDasharray={`${HEAD_ARC} 1`}
            strokeDashoffset={1 + HEAD_ARC - left}
            style={transitionStyle}
          />
        </mask>
      </defs>

      <path className="wh-track" d={trackPath} fill={style.track} />
      {visible && (
        <>
          <path
            className="wh-fill"
            d={trackPath}
            fill={style.accent}
            mask={`url(#${revealId})`}
          />
          <path
            className="wh-head"
            d={trackPath}
            fill={style.bright}
            mask={`url(#${headId})`}
          />
        </>
      )}
    </g>
  );
}

/** The number a figure shows, or the word for not knowing. It is never 0. */
function figureText(meter: WonderlandUsageMeter): string {
  if (!meter.remainingUnits.known || !meter.capacityUnits.known) return 'UNKNOWN';
  const unit = meter.unitLabel === null ? '' : ` ${meter.unitLabel}`;
  return `${Math.round(meter.remainingUnits.value as number)} / ${Math.round(
    meter.capacityUnits.value as number,
  )}${unit}`;
}

export function WonderlandUsageHudView({
  hud,
  reducedMotion = false,
  instanceId,
}: {
  readonly hud: WonderlandUsageHud;
  readonly reducedMotion?: boolean;
  /**
   * DISTINGUISHES THIS HUD'S SVG IDS FROM ANOTHER'S, and a page showing two
   * HUDs MUST pass distinct values.
   *
   * SVG mask ids are document-global. Two HUDs sharing one means the first
   * one's mask paints both, so the second shows the FIRST meter's remainder
   * underneath its own numbers — the most dangerous kind of rendering bug,
   * because every number on screen is still correct. The four-panel preview
   * showed exactly that: three different readings, one identical stroke.
   *
   * `useId` is the default and is enough for the single HUD the world mounts.
   * It is NOT enough on its own: it restarts its counter for every
   * `renderToStaticMarkup` call, so panels assembled from separate render
   * passes collide again. Hence a prop, and hence a test.
   */
  readonly instanceId?: string;
}): JSX.Element {
  const meters: Readonly<Record<WonderlandUsageChannel, WonderlandUsageMeter>> = {
    compound_agent: hud.compoundAgent,
    single_agent: hud.singleAgent,
  };
  // Draw order comes from the data, so the dominant frame is dominant on both
  // surfaces rather than by whichever element happened to be written second.
  const drawOrder = [...WONDERLAND_USAGE_CHANNELS].sort(
    (a, b) =>
      WONDERLAND_USAGE_CHANNEL_STYLE[b].emphasis - WONDERLAND_USAGE_CHANNEL_STYLE[a].emphasis,
  );
  // Reading order is the other way: the dominant channel is named first.
  const readOrder = [...drawOrder].reverse();
  const simulated = hud.compoundAgent.simulated || hud.singleAgent.simulated;
  const fallbackId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const instance = (instanceId ?? fallbackId).replace(/[^a-zA-Z0-9_-]/g, '');
  const glowId = `wh-glow-${instance}`;

  return (
    <div className="wh" data-anchor={hud.anchor} aria-live="polite">
      <svg
        className="wh-canvas"
        viewBox={VIEW_BOX}
        role="img"
        aria-label="Wonderland usage"
        focusable="false"
      >
        <defs>
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {drawOrder.map((channel) => (
          <g key={channel} filter={`url(#${glowId})`}>
            <ChannelStroke
              channel={channel}
              meter={meters[channel]}
              reducedMotion={reducedMotion}
              instanceId={instance}
            />
          </g>
        ))}
      </svg>

      <dl className="wh-readout">
        {readOrder.map((channel) => (
          <div className="wh-row" key={channel} data-channel={channel}>
            <dt style={{ color: WONDERLAND_USAGE_CHANNEL_STYLE[channel].accent }}>
              {WONDERLAND_USAGE_CHANNEL_STYLE[channel].label}
            </dt>
            <dd>{figureText(meters[channel])}</dd>
          </div>
        ))}
      </dl>

      {simulated && <p className="wh-provenance">SIMULATED · NO USAGE AUTHORITY REPORTING</p>}
      {hud.compoundAgent.unavailableReason !== null && (
        <p className="wh-reason">{hud.compoundAgent.unavailableReason}</p>
      )}
    </div>
  );
}
