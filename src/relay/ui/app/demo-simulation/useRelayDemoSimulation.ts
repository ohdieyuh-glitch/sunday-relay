import { useCallback, useEffect, useReducer, useRef } from 'react';
import { RELAY_DEMO_SCRIPT } from './demo-simulation-script';
import { INITIAL_RELAY_DEMO_STATE, relayDemoSimulationReducer } from './demo-simulation-reducer';

let demoInstanceSequence = 0;

export function useRelayDemoSimulation() {
  const [state, dispatch] = useReducer(relayDemoSimulationReducer, INITIAL_RELAY_DEMO_STATE);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!state.active || state.status !== 'playing') return;
    const step = RELAY_DEMO_SCRIPT[state.currentStepIndex];
    if (!step || step.durationMs === 0) return;
    timerRef.current = window.setTimeout(() => dispatch({ type: 'advance' }), step.durationMs / state.speed);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [state.active, state.currentStepIndex, state.speed, state.status]);

  const play = useCallback(() => {
    demoInstanceSequence += 1;
    dispatch({
      type: 'play',
      now: Date.now(),
      instanceId: `demo-simulation:normalize-project-name:${demoInstanceSequence}`,
    });
  }, []);
  const pause = useCallback(() => dispatch({ type: 'pause', now: Date.now() }), []);
  const resume = useCallback(() => dispatch({ type: 'resume', now: Date.now() }), []);
  const next = useCallback(() => dispatch({ type: 'advance' }), []);
  const restart = useCallback(() => dispatch({ type: 'restart', now: Date.now() }), []);
  const exit = useCallback(() => dispatch({ type: 'exit' }), []);
  const setSpeed = useCallback((speed: 1 | 2) => dispatch({ type: 'speed', speed }), []);

  return { state, play, pause, resume, next, restart, exit, setSpeed };
}
