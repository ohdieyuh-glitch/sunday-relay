import { RelayPixelDog, type PixelDogPose } from '../pixel-dog';
import { RelayDogMotionBoundary, projectHomeDogBehavior } from '../relay-dog-motion';
import type { HomeDogState } from './contracts';

/**
 * Relay Dog on the Home screen — a system guide and handoff indicator, not a
 * customer-service chatbot. Pre-mission states only: READY, WAITING,
 * WANDERING. State arrives through props; the dog never fabricates activity.
 *
 * Milestone 4.5: wrapped in the SHARED motion boundary so the pre-mission
 * idle states patrol left and right, using the same controller as the
 * workspace dog. The artwork itself is unchanged.
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
      <RelayDogMotionBoundary
        behavior={projectHomeDogBehavior(state)}
        reducedMotion={reducedMotion}
        className="reh-dog-motion"
      >
        <RelayPixelDog
          pose={POSE[state]}
          label={LABEL[state]}
          sublabel="RELAY DOG"
          moving={state === 'wandering'}
          reducedMotion={reducedMotion}
          floor
          unit={7}
        />
      </RelayDogMotionBoundary>
      <p className="reh-dog-message">
        Tell me what you want to build, choose a project route, or ask me how Relay works.
      </p>
    </div>
  );
}
