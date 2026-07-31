import type { RelayDemoSimulationState } from './demo-simulation-types';

export function RelayDemoSimulationControls({
  state,
  onPlay,
  onPause,
  onResume,
  onNext,
  onRestart,
  onExit,
  onSpeed,
}: {
  state: RelayDemoSimulationState;
  onPlay: () => void;
  onPause: () => void;
  onResume: () => void;
  onNext: () => void;
  onRestart: () => void;
  onExit: () => void;
  onSpeed: (speed: 1 | 2) => void;
}) {
  if (!state.active) {
    return <button type="button" onClick={onPlay}>PLAY DEMO</button>;
  }
  return (
    <span className="rds-controls" role="group" aria-label="Demo Simulation controls">
      <span className="rpv-switcher-tag">DEMO SIMULATION</span>
      {state.status === 'playing' && <button type="button" onClick={onPause}>PAUSE</button>}
      {state.status === 'paused' && <button type="button" onClick={onResume}>RESUME</button>}
      <button type="button" onClick={onNext} disabled={state.status === 'complete'}>NEXT</button>
      <button type="button" onClick={onRestart}>RESTART DEMO</button>
      <button type="button" onClick={onExit}>EXIT DEMO</button>
      <button type="button" aria-pressed={state.speed === 1} onClick={() => onSpeed(1)}>1×</button>
      <button type="button" aria-pressed={state.speed === 2} onClick={() => onSpeed(2)}>2×</button>
    </span>
  );
}
