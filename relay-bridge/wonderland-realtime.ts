import type { Pool, PoolClient, Notification } from 'pg';
import type { WonderlandEvent } from '../src/relay/mission/wonderland/wonderland-backend';
import type { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';

export interface WonderlandEventNotice { readonly eventId: string; readonly projectId: string; readonly sequence: number; }
export interface WonderlandFanoutTransport {
  publish(notice: WonderlandEventNotice): Promise<void>;
  subscribe(listener: (notice: WonderlandEventNotice) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

/** Shared test/local acceleration. The durable event source still owns replay. */
export class InMemoryWonderlandFanout implements WonderlandFanoutTransport {
  private readonly listeners = new Set<(notice: WonderlandEventNotice) => void>();
  async publish(notice: WonderlandEventNotice): Promise<void> { for (const listener of this.listeners) listener(notice); }
  async subscribe(listener: (notice: WonderlandEventNotice) => void): Promise<() => Promise<void>> { this.listeners.add(listener); return async () => { this.listeners.delete(listener); }; }
  async close(): Promise<void> { this.listeners.clear(); }
}

/** PostgreSQL LISTEN/NOTIFY acceleration. Payloads contain identifiers only, never telemetry. */
export class PostgresWonderlandFanout implements WonderlandFanoutTransport {
  private client: PoolClient | null = null;
  private readonly listeners = new Set<(notice: WonderlandEventNotice) => void>();
  private readonly channel = 'relay_wonderland_events';
  constructor(private readonly pool: Pool) {}
  private async connected(): Promise<PoolClient> {
    if (this.client) return this.client;
    const client = await this.pool.connect();
    client.on('notification', (notification: Notification) => {
      if (notification.channel !== this.channel || !notification.payload) return;
      try { const notice = JSON.parse(notification.payload) as WonderlandEventNotice; if (typeof notice.eventId === 'string' && typeof notice.projectId === 'string' && Number.isSafeInteger(notice.sequence)) for (const listener of this.listeners) listener(notice); } catch { /* malformed transport data is ignored; replay remains truth */ }
    });
    client.on('error', () => { if (this.client === client) this.client = null; });
    await client.query(`LISTEN ${this.channel}`); this.client = client; return client;
  }
  async publish(notice: WonderlandEventNotice): Promise<void> { await this.pool.query('SELECT pg_notify($1,$2)', [this.channel, JSON.stringify(notice)]); }
  async subscribe(listener: (notice: WonderlandEventNotice) => void): Promise<() => Promise<void>> { await this.connected(); this.listeners.add(listener); return async () => { this.listeners.delete(listener); }; }
  async close(): Promise<void> { const client = this.client; this.client = null; this.listeners.clear(); if (client) { await client.query(`UNLISTEN ${this.channel}`).catch(() => undefined); client.release(); } }
}

export interface WonderlandRealtimeSubscription {
  readonly replayed: number;
  close(): Promise<void>;
}

/** Durable replay plus cross-instance acceleration, with duplicate suppression and bounded slow-client backlog. */
export class DistributedWonderlandRealtime {
  constructor(private readonly database: TransactionalWonderlandDatabase, private readonly transport: WonderlandFanoutTransport, private readonly canSee: (event: WonderlandEvent, playerId: string) => boolean) {}
  async publishCommitted(event: WonderlandEvent): Promise<void> { await this.transport.publish({ eventId: event.eventId, projectId: event.projectId, sequence: event.sequence }); }
  async subscribe(input: { projectId: string; playerId: string; cursor: number; maxBuffered?: number }, deliver: (event: WonderlandEvent) => boolean | void, onSlow?: () => void): Promise<WonderlandRealtimeSubscription> {
    if (!Number.isSafeInteger(input.cursor) || input.cursor < 0) throw new Error('invalid_replay_cursor');
    const maxBuffered = input.maxBuffered ?? 128; if (!Number.isSafeInteger(maxBuffered) || maxBuffered < 1 || maxBuffered > 4096) throw new Error('invalid_realtime_buffer');
    let closed = false; let unsubscribed = false; let cursor = input.cursor; let buffered = 0;
    let unsubscribe: () => Promise<void> = async () => undefined;
    let releaseLive!: () => void;
    const replayAttached = new Promise<void>(resolve => { releaseLive = resolve; });
    let delivery = Promise.resolve();
    const apply = (event: WonderlandEvent): void => { if (closed || event.projectId !== input.projectId || event.sequence <= cursor || !this.canSee(event, input.playerId)) return; cursor = event.sequence; const writable = deliver(event); if (writable === false) { buffered += 1; if (buffered > maxBuffered) { closed = true; onSlow?.(); if (!unsubscribed) { unsubscribed = true; void unsubscribe(); } } } else buffered = 0; };
    // Attach live first, then replay: sequence/event suppression closes the race.
    unsubscribe = await this.transport.subscribe(notice => {
      if (closed || notice.projectId !== input.projectId) return;
      delivery = delivery.then(async () => { await replayAttached; if (closed || notice.sequence <= cursor) return; const events = await this.database.replayEvents(input.projectId, cursor, 1000); events.forEach(apply); }).catch(() => undefined);
    });
    const replay = await this.database.replayEvents(input.projectId, input.cursor, 1000); replay.forEach(apply);
    releaseLive();
    return { replayed: replay.length, close: async () => { closed = true; if (!unsubscribed) { unsubscribed = true; await unsubscribe(); } } };
  }
}
