import { useSyncExternalStore } from 'react';
import type { RelayAppStore } from './store';
import type { RelayAppData } from './contracts';

/** Subscribe a component to the application store (React 18 external
    store contract — no extra state library needed or introduced). */
export function useRelayAppState(store: RelayAppStore): RelayAppData {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
