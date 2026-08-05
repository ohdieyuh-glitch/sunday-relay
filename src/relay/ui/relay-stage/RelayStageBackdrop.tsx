import './relay-stage-backdrop.css';
import { resolveBackdrop, type RelayBackdropId } from './stage-backdrop';

/**
 * THE TWO SELECTABLE SCENES, DRAWN IN CSS AND SVG.
 *
 * No external asset, no image URL, no font — for the same reason the Relay Dog
 * has none: a request that can 404 into a blank stage is a scene that sometimes
 * is not there. Everything below is geometry and gradient.
 *
 * DECORATION, AND MARKED AS SUCH. Both scenes are `aria-hidden` and take no
 * pointer events. A backdrop carries no product meaning, gates nothing, and
 * cannot change what any surface reports — it is the same rule the motion
 * system holds itself to, and the reason a user picking Space Station has not
 * put Relay in space.
 *
 * ONLY THE BACKDROP LAYER CLIPS, which is what lets these draw a horizon that
 * runs to the edges while an actor in front of them is free to leave the box.
 */

export function RelayStageBackdrop({
  backdrop, reducedMotion = false,
}: {
  readonly backdrop: RelayBackdropId | string | null | undefined;
  readonly reducedMotion?: boolean;
}) {
  // An unknown id resolves to `none`, never to a substitute scene.
  const entry = resolveBackdrop(backdrop);
  if (entry.id === 'none') return null;

  const className = `rsb rsb--${entry.id}${reducedMotion ? ' rsb--still' : ''}`;

  if (entry.id === 'jungle') {
    return (
      <div className={className} aria-hidden="true" data-backdrop="jungle">
        {/* Sky through the canopy: the only warm light in the scene. */}
        <div className="rsb-sky" />
        {/* A shaft of light, the one moving element, and the first thing
            reduced motion stills. */}
        <div className="rsb-shaft" />
        {/* Three depths of foliage. Far is flat and desaturated, near is dark
            and high-contrast — the whole of the depth cue, done with colour. */}
        <svg className="rsb-canopy rsb-canopy--far" viewBox="0 0 200 60" preserveAspectRatio="none">
          <path d="M0 34 Q14 16 28 32 Q42 12 58 30 Q74 10 90 30 Q108 12 124 31 Q140 12 158 30 Q176 14 200 32 L200 0 L0 0 Z" />
        </svg>
        <svg className="rsb-canopy rsb-canopy--mid" viewBox="0 0 200 60" preserveAspectRatio="none">
          <path d="M0 26 Q18 6 34 24 Q52 2 70 22 Q90 4 108 24 Q128 2 148 23 Q168 6 200 24 L200 0 L0 0 Z" />
        </svg>
        <svg className="rsb-canopy rsb-canopy--near" viewBox="0 0 200 60" preserveAspectRatio="none">
          <path d="M0 16 Q22 -4 44 14 Q66 -8 88 12 Q112 -6 134 13 Q158 -4 200 14 L200 0 L0 0 Z" />
        </svg>
        {/* Undergrowth along the ground line, so an actor stands IN the scene
            rather than in front of a picture of one. */}
        <svg className="rsb-undergrowth" viewBox="0 0 200 30" preserveAspectRatio="none">
          <path d="M0 30 L0 22 Q10 10 18 22 Q26 8 36 21 Q48 9 58 22 Q70 10 82 21 Q96 8 108 22 Q122 10 134 21 Q148 8 160 22 Q174 10 186 21 Q194 14 200 20 L200 30 Z" />
        </svg>
      </div>
    );
  }

  return (
    <div className={className} aria-hidden="true" data-backdrop="space_station">
      {/* THE WINDOW IS THE POINT: visible outer space, not a painted wall. */}
      <div className="rsb-void">
        <div className="rsb-stars" />
        <div className="rsb-stars rsb-stars--far" />
        {/* A planet limb with a terminator — the lit edge and the shadow are
            one gradient, so the light has a direction and the sphere reads as
            a sphere rather than a disc. */}
        <div className="rsb-planet" />
        <div className="rsb-planet-glow" />
      </div>
      {/* The interior in front of the void: window frame, ribs, and a floor. */}
      <div className="rsb-window-frame" />
      <div className="rsb-rib rsb-rib--left" />
      <div className="rsb-rib rsb-rib--right" />
      <div className="rsb-deck" />
    </div>
  );
}
