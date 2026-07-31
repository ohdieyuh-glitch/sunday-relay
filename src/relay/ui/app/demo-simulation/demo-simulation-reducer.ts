import { RELAY_DEMO_SCRIPT, DEMO_SCENARIO_ID } from './demo-simulation-script';
import type { RelayDemoAction, RelayDemoSimulationState } from './demo-simulation-types';

export const INITIAL_RELAY_DEMO_STATE: RelayDemoSimulationState = {
  mode: 'demo_simulation',
  scenarioId: DEMO_SCENARIO_ID,
  instanceId: '',
  active: false,
  status: 'idle',
  currentStepIndex: 0,
  activeRole: null,
  elapsedBeforePauseMs: 0,
  speed: 1,
  events: [],
};

function stateAt(
  state: RelayDemoSimulationState,
  index: number,
): RelayDemoSimulationState {
  const bounded = Math.min(index, RELAY_DEMO_SCRIPT.length - 1);
  const complete = bounded === RELAY_DEMO_SCRIPT.length - 1;
  return {
    ...state,
    active: true,
    status: complete ? 'complete' : state.status,
    currentStepIndex: bounded,
    activeRole: RELAY_DEMO_SCRIPT[bounded].activeRole,
    events: RELAY_DEMO_SCRIPT.slice(0, bounded + 1).map((step) => step.event),
  };
}

export function relayDemoSimulationReducer(
  state: RelayDemoSimulationState,
  action: RelayDemoAction,
): RelayDemoSimulationState {
  switch (action.type) {
    case 'play':
      if (state.active) return state;
      return stateAt({
        ...INITIAL_RELAY_DEMO_STATE,
        active: true,
        status: 'playing',
        instanceId: action.instanceId,
        startedAt: action.now,
        speed: state.speed,
      }, 0);
    case 'advance':
      if (!state.active || state.status === 'complete') return state;
      return stateAt(state, state.currentStepIndex + 1);
    case 'pause':
      return state.active && state.status === 'playing'
        ? { ...state, status: 'paused', pausedAt: action.now }
        : state;
    case 'resume':
      return state.active && state.status === 'paused'
        ? { ...state, status: 'playing', pausedAt: undefined, startedAt: action.now }
        : state;
    case 'restart':
      if (!state.active) return state;
      return stateAt({
        ...state,
        status: 'playing',
        startedAt: action.now,
        pausedAt: undefined,
        elapsedBeforePauseMs: 0,
        events: [],
      }, 0);
    case 'exit':
      return { ...INITIAL_RELAY_DEMO_STATE, speed: state.speed };
    case 'speed':
      return { ...state, speed: action.speed };
  }
}
