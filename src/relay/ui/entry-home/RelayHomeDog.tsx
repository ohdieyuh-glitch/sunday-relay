import { RelayPixelDog, type PixelDogPose } from '../pixel-dog';
import type { HomeDogState } from './contracts';

/**
 * Relay Dog on the Home screen — a system guide and handoff indicator, not a
 * customer-service chatbot. Pre-mission states only: READY, WAITING,
 * WANDERING. State arrives through props; the dog never fabricates activity.
 */

const POSE: Record<HomeDogState, PixelDogPose> = {
  ready: 'standing',
  waiting: 'sitting',
  wandering: 'trotting',
};

const LABEL: Record<HomeDogState, string> = {
  ready: 'READY',
  waiting: 'WAITING',
  wandering: 'WANDERING',
};

export function RelayHomeDog({
  state,
  reducedMotion = false,
}: {
  state: HomeDogState;
  reducedMotion?: boolean;
}) {
  return (
    <div className="reh-dog">
      <RelayPixelDog
        pose={POSE[state]}
        label={LABEL[state]}
        sublabel="RELAY DOG"
        moving={state === 'wandering'}
        reducedMotion={reducedMotion}
        floor
        unit={7}
      />
      <p className="reh-dog-message">
        Tell me what you want to build, choose a project route, or ask me how Relay works.
      </p>
    </div>
  );
}
