import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../persistence/atomic-file';
import type { WonderlandEvent, WonderlandState } from './types';

export const emptyWonderlandState = (): WonderlandState => ({ events: [], missions: {}, cards: {}, brains: {}, avatars: {}, presence: {}, battles: {}, swarms: {}, rewards: [], usage: {}, commandResults: {}, sequence: 0 });

export interface WonderlandStore { read(): WonderlandState; transact<T>(mutation: (state: WonderlandState) => T): T; }

export function createMemoryWonderlandStore(initial = emptyWonderlandState()): WonderlandStore {
  let state = structuredClone(initial);
  return { read: () => structuredClone(state), transact: (mutation) => { const next = structuredClone(state); const result = mutation(next); state = next; return result; } };
}

export function createFileWonderlandStore(path: string): WonderlandStore {
  mkdirSync(dirname(path), { recursive: true });
  let state: WonderlandState;
  try { state = JSON.parse(readFileSync(path, 'utf8')) as WonderlandState; } catch { state = emptyWonderlandState(); }
  return { read: () => structuredClone(state), transact: (mutation) => { const next = structuredClone(state); const result = mutation(next); writeFileAtomic(path, JSON.stringify(next)); state = next; return result; } };
}

export interface EventSubscription { close(): void; }
export class WonderlandEventStream {
  private readonly listeners = new Map<number, (event: WonderlandEvent) => void>(); private next = 1;
  constructor(private readonly store: WonderlandStore) {}
  subscribe(afterSequence: number, listener: (event: WonderlandEvent) => void): EventSubscription {
    let cursor = afterSequence;
    const deliver = (event: WonderlandEvent) => { if (event.sequence <= cursor) return; cursor = event.sequence; listener(event); };
    for (const event of this.store.read().events) deliver(event);
    const id = this.next++; this.listeners.set(id, deliver); return { close: () => { this.listeners.delete(id); } };
  }
  publish(event: WonderlandEvent): void { for (const listener of this.listeners.values()) listener(structuredClone(event)); }
}
