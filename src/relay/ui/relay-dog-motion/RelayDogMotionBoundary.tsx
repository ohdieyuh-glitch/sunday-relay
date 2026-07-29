/**
 * SUNDAY RELAY — MILESTONE 4.5
 * The motion boundary that wraps the existing Relay Dog artwork.
 *
 * Layers exist so that no two animations fight over the same transform:
 *
 *   .rdm            motion boundary — measured track, clips overflow
 *     .rdm-travel   horizontal patrol position (translateX)
 *       .rdm-facing direction (scaleX, with text counter-flipped)
 *         .rdm-body activity animation (jump, tippy-toe reach)
 *           <RelayPixelDog/>  unchanged artwork, keeps its own bob
 *
 * The dog artwork, colorway, and silhouette are untouched — this component
 * only positions and animates the existing sprite.
 */

import type { ReactNode } from 'react';

import type { RelayDogBehavior } from './dog-behavior';
import { useRelayDogPatrol } from './useRelayDogPatrol';

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
      <div
        ref={patrol.dogRef}
        className="rdm-travel"
        style={{ transform: `translateX(${Math.round(patrol.x)}px)` }}
      >
        <div className={facingClass}>
          <div className={activityClass}>{children}</div>
        </div>
      </div>
      {effectiveReducedMotion && (
        <span className="rdm-reduced-label">{behavior.reducedMotionFallback}</span>
      )}
    </div>
  );
}
