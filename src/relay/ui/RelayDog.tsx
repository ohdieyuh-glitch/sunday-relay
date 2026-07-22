import type { RelayDogActivity } from '../mission';
import { renderDogFrames } from '../mission';

/**
 * Relay Dog (Prompt 8.2). Renders the deterministic dog state from Relay
 * Core — never random motion, never a UI-set value. Motion is CSS-driven and
 * honors reduced-motion; the state LABEL is always available without
 * animation.
 */
export function RelayDog({ dog, showBadge = true }: { dog: RelayDogActivity; showBadge?: boolean }) {
  const frames = renderDogFrames(dog);
  const moving = ['walking', 'trotting', 'running', 'sprinting', 'carrying_handoff', 'wandering'].includes(dog.state);
  return (
    <div
      className={`relay-dog relay-dog--${dog.state}${moving && !dog.reducedMotion ? ' relay-dog--moving' : ''}`}
      aria-label={`Relay Dog: ${dog.statusLabel}`}
      role="img"
    >
      <pre className="relay-dog-art" aria-hidden="true">{frames.slice(0, 2).join('\n')}</pre>
      <div className="relay-dog-meta">
        <span className="relay-dog-label">{dog.statusLabel}</span>
        {showBadge && dog.mode === 'autonomous' && <span className="relay-chip relay-chip--auto">AUTONOMOUS</span>}
        <span className="relay-dim relay-dog-metrics">
          activity {dog.activityLevel} · sync {dog.synchronizationLevel}
        </span>
      </div>
    </div>
  );
}
