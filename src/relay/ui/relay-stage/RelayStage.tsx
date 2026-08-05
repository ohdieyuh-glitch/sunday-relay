import type { ReactNode } from 'react';
import './relay-stage.css';
import {
  RELAY_STAGE_LAYERS, layerClips, layoutStage,
  type RelayStageActor, type RelayStageLayer, type RelayStageLayout,
} from '../../shared/relay-stage-layout';

/**
 * Layers that are decoration WHEN EMPTY. Any of them may legally hold an actor,
 * and one that does is announced like any other.
 */
const DECORATIVE_LAYERS: readonly RelayStageLayer[] = ['backdrop', 'far', 'effects'];

/**
 * THE RELAY STAGE — a frameless region with room to act in.
 *
 * FRAMELESS MEANS FRAMELESS. No border, no background panel, no rounded box,
 * no drop shadow, no `overflow: hidden` around the cast. The stage is a region
 * of the page, not a widget on it, and depth comes from layered content rather
 * than from a container edge. That is the whole point: the Relay Dog used to
 * live in a full-width band with its scenery clipped to a fixed 128×90 box, so
 * there was no vertical room for a jump, no depth, and nowhere to put a second
 * actor.
 *
 * WHAT IT OWNS. Space and layers. Nothing else. `RelayDogMotionBoundary` still
 * owns patrol, facing and the activity animation — it is proven by four test
 * files and there is no reason to reimplement it here. An actor is handed a
 * slot; what it does inside that slot is its own business.
 *
 * WHAT IT REFUSES.
 *
 * - **To invent an actor.** An empty cast renders an empty stage that SAYS it
 *   is empty. It does not helpfully draw a Dog so the space looks used.
 * - **To hide an overflow.** When the cast asks for more room than the stage
 *   has, the stage says so rather than overlapping sprites — two actors drawn
 *   on top of each other is a surface lying about how much is there.
 * - **To clip the cast.** Only the backdrop clips. An actor mid-jump or
 *   mid-transformation must not be cut by the thing that exists to give it
 *   room, which is exactly what the old box did.
 * - **To animate on its own clock.** Movement is driven by state something
 *   else observed, never by a timer here.
 */

export interface RelayStageProps {
  /** Who is on stage. Empty is a real state, not a missing one. */
  readonly actors: readonly RelayStageActor[];
  /** Rendered content per actor id. An id with no node renders nothing. */
  readonly render: (actorId: string) => ReactNode;
  /** Observed by the host; the stage measures nothing itself. */
  readonly viewportWidthPx: number;
  /** Why the stage is empty, when it is. */
  readonly emptyReason?: string;
  /** The selectable scene. Absent means no backdrop — and no pretend one. */
  readonly backdrop?: ReactNode;
  /** Suppresses parallax and effects. Layout is IDENTICAL either way. */
  readonly reducedMotion?: boolean;
  readonly label?: string;
  /** Host-supplied spacing only. The stage adds no frame of its own. */
  readonly className?: string;
}

export function RelayStage({
  actors, render, viewportWidthPx, emptyReason, backdrop, reducedMotion = false, label,
  className,
}: RelayStageProps) {
  const layout: RelayStageLayout = layoutStage({
    actors,
    viewportWidthPx,
    ...(emptyReason === undefined ? {} : { emptyReason }),
  });

  const byLayer = (layer: RelayStageLayer) =>
    layout.placements.filter((placement) => placement.layer === layer);

  return (
    <section
      className={`rst${reducedMotion ? ' rst--still' : ''}${className === undefined ? '' : ` ${className}`}`}
      aria-label={label ?? 'Relay stage'}
      data-stage-capacity={layout.capacity}
      data-stage-requested={layout.requestedWidth}
      data-stage-overflowing={layout.overflowing ? 'yes' : 'no'}
      style={{
        // Aspect with a floor, never a fixed height. The band it replaces was
        // 90px at every viewport, which is why nothing could ever jump.
        aspectRatio: String(layout.shape.aspectRatio),
        minHeight: `${layout.shape.minHeightRem}rem`,
      }}
    >
      {RELAY_STAGE_LAYERS.map((layer) => (
        <div
          key={layer}
          className={`rst-layer rst-layer--${layer}${layerClips(layer) ? ' is-clipped' : ''}`}
          data-stage-layer={layer}
          // Decoration is hidden from assistive technology — but only while it
          // IS decoration. `far` and `effects` are legal layers to declare an
          // actor on, and a blanket aria-hidden would erase that actor from a
          // screen reader while leaving it plainly visible on screen.
          aria-hidden={
            DECORATIVE_LAYERS.includes(layer) && byLayer(layer).length === 0 ? true : undefined
          }
        >
          {layer === 'backdrop' ? backdrop ?? null : null}
          {byLayer(layer).map((placement) => (
            <div
              key={placement.id}
              className="rst-actor"
              data-stage-actor={placement.id}
              style={{
                left: `${placement.leftPercent}%`,
                bottom: `${placement.bottomPercent}%`,
                // A real box, so an actor that measures its own track measures
                // the stage rather than its own sprite.
                width: `${placement.widthPercent}%`,
                // Depth scales and lifts together — they are one fact about
                // distance, and applying only the first floats an actor.
                transform: `translateX(-50%) scale(${placement.scale})`,
                zIndex: placement.order,
              }}
            >
              {render(placement.id)}
            </div>
          ))}
        </div>
      ))}

      {layout.emptyReason !== null && (
        <p className="rst-empty" role="status">{layout.emptyReason}</p>
      )}

      {layout.overflowing && (
        // Said out loud rather than drawn as an overlap. A stage that quietly
        // stacked its cast would be claiming room it does not have.
        <p className="rst-overflow" role="status">
          {`This stage has room for about ${layout.capacity} dog-widths, and `}
          {`${layout.requestedWidthLabel} were placed. Some are overlapping.`}
        </p>
      )}
    </section>
  );
}
