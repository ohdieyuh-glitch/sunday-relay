import { WonderlandService } from './service';

export interface PresenceScheduler { isRunning(): boolean; stop(): void; runNow(): string[]; }

/** Server lifecycle maintenance only; this never polls client-visible state. */
export function createPresenceScheduler(service: WonderlandService, options: { intervalMs?: number; now?: () => number } = {}): PresenceScheduler {
  const intervalMs = options.intervalMs ?? 15_000; const now = options.now ?? Date.now; let running = true; let pass = 0;
  const sweep = () => service.expirePresence(`presence-expiry:${now()}:${++pass}`);
  const timer = setInterval(sweep, intervalMs); timer.unref();
  return { isRunning: () => running, runNow: sweep, stop() { if (!running) return; running = false; clearInterval(timer); } };
}
