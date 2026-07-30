/**
 * SUNDAY RELAY — MILESTONE 4.5
 * The motion boundary that wraps the existing Relay Dog artwork.
 *
 * Layers exist so that no two animations fight over the same transform:
 *
 *   .rdm            motion boundary — measured track, clips overflow
 *     .rdm-travel   horizontal patrol position (translateX)
 *       .rdm-facing direction (scaleX, with text counter-flipped)
 *         .rdm-body activity animation (jump, sleep-breathe, dig, type)
 *           <RelayPixelDog/>  unchanged artwork, keeps its own bob
 *   .rdo            operational scenery (Z marks, dirt, code editor) —
 *                   decorative, aria-hidden, behind the dog, no pointer events
 *
 * The dog artwork, colorway, and silhouette are untouched — this component
 * only positions and animates the existing sprite.
 */

import type { ReactNode } from 'react';

import type { RelayDogBehavior } from './dog-behavior';
import { useRelayDogPatrol } from './useRelayDogPatrol';
import {
  RelayDogOperationalDecor,
  operationalActivityDescription,
} from './RelayDogOperationalDecor';

export interface RelayDogMotionBoundaryProps {
  behavior: RelayDogBehavior;
  /** Caller-supplied reduced-motion override; the media query also applies. */
  reducedMotion?: boolean;
  /** The existing dog component, rendered unchanged inside the layers. */
  children: ReactNode;
  className?: string;
}

export function RelayDogMotionBoundary({
  behavior,
  reducedMotion = false,
  children,
  className = '',
}: RelayDogMotionBoundaryProps) {
  const patrol = useRelayDogPatrol({
    patrolEnabled: behavior.patrolEnabled,
    reducedMotion,
  });

  const effectiveReducedMotion = patrol.reducedMotion;
  const description = operationalActivityDescription(behavior.activity);
  const activityClass = `rdm-body rdm-body--${behavior.activity}`;
  const facingClass = `rdm-facing rdm-facing--${patrol.direction}`;

  return (
    <div
      ref={patrol.boundaryRef}
      className={`rdm rdm--${behavior.activity}${
        effectiveReducedMotion ? ' rdm--reduced' : ''
      }${patrol.walking ? ' rdm--walking' : ''}${
        behavior.attentionRequired ? ' rdm--attention' : ''
      } ${className}`.trim()}
      data-relay-dog-activity={behavior.activity}
      data-relay-dog-patrol={behavior.patrolEnabled && !effectiveReducedMotion ? 'on' : 'off'}
    >
      {/* Scenery first so it paints BEHIND the dog and can never cover a
          mission control. Decorative only — the meaning is in the text below. */}
      <RelayDogOperationalDecor
        activity={behavior.activity}
        reducedMotion={effectiveReducedMotion}
      />
      <div
        ref={patrol.dogRef}
        className="rdm-travel"
        style={{ transform: `translateX(${Math.round(patrol.x)}px)` }}
      >
        <div className={facingClass}>
          <div className={activityClass}>{children}</div>
        </div>
      </div>
      {/* The plain-language sentence for the three animated operational states.
          It describes what the DOG is doing and never an outcome, so it cannot
          imply that a review approved, a verification passed or a repair
          succeeded. Visually hidden: the dog figure already shows the label. */}
      {description && <span className="rdm-a11y-description">{description}</span>}
      {effectiveReducedMotion && (
        <span className="rdm-reduced-label">{behavior.reducedMotionFallback}</span>
      )}
    </div>
  );
}
