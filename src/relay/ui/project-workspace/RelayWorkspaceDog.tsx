import { RelayPixelDog } from '../pixel-dog';
import { RelayDogMotionBoundary, projectWorkspaceDogBehavior } from '../relay-dog-motion';
import { DOG_PRESENTATION } from './projections';
import type { WorkspaceDogState } from './contracts';

/**
 * The Pixel Relay Dog as the living project-state indicator. The state
 * always arrives through props (normalized UI data) — the component never
 * invents state from animation timing, and COMPLETE appears only after the
 * CompletionPolicy verdict reached the workspace.
 *
 * Milestone 4.5: the artwork is unchanged; it is now wrapped in the SHARED
 * motion boundary, which owns idle patrol, facing, and the activity
 * animation. Live and Demo Simulation both render this same component and
 * therefore the same single controller.
 */
export function RelayWorkspaceDog({
  state,
  reducedMotion = false,
}: {
  state: WorkspaceDogState;
  reducedMotion?: boolean;
}) {
  const p = DOG_PRESENTATION[state];
  const behavior = projectWorkspaceDogBehavior(state);
  return (
    <RelayDogMotionBoundary behavior={behavior} reducedMotion={reducedMotion}>
      <RelayPixelDog
        pose={p.pose}
        label={p.label}
        sublabel="RELAY DOG"
        marker={p.marker}
        moving={p.moving}
        reducedMotion={reducedMotion}
        floor
        unit={6}
      />
    </RelayDogMotionBoundary>
  );
}
