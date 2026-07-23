import { RelayPixelDog } from '../pixel-dog';
import { DOG_PRESENTATION } from './projections';
import type { WorkspaceDogState } from './contracts';

/**
 * The Pixel Relay Dog as the living project-state indicator. The state
 * always arrives through props (normalized UI data) — the component never
 * invents state from animation timing, and COMPLETE appears only after the
 * CompletionPolicy verdict reached the workspace.
 */
export function RelayWorkspaceDog({
  state,
  reducedMotion = false,
}: {
  state: WorkspaceDogState;
  reducedMotion?: boolean;
}) {
  const p = DOG_PRESENTATION[state];
  return (
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
  );
}
