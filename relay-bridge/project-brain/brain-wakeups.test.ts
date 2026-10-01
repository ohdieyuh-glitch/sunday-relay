import { afterEach, describe, expect, it, vi } from 'vitest';

import { PROJECT_BRAIN_NOTIFY_CHANNEL, createProjectBrainWakeups, waitForProjectBrainWake, type ProjectBrainListenClient } from './brain-wakeups';

/** A LISTEN connection the test drives: it can deliver a notification, fail, or end. */
function fakeClient(options: { failConnect?: boolean } = {}) {
  const handlers: Record<string, Array<(value?: unknown) => void>> = {};
  const queries: string[] = [];
  let ended = false;
  const client: ProjectBrainListenClient & { notify(payload: string, channel?: string): void; fail(): void; queries: string[]; ended(): boolean } = {
    connect: async () => { if (options.failConnect) throw new Error('connection refused'); },
    query: async (sql: string) => { queries.push(sql); },
    end: async () => { ended = true; },
    on: ((event: string, listener: (value?: unknown) => void) => { (handlers[event] ??= []).push(listener); return client; }) as ProjectBrainListenClient['on'],
    notify: (payload, channel = PROJECT_BRAIN_NOTIFY_CHANNEL) => { for (const h of handlers.notification ?? []) h({ channel, payload }); },
    fail: () => { for (const h of handlers.error ?? []) h(new Error('terminated')); },
    queries,
    ended: () => ended,
  };
  return client;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

afterEach(() => { vi.useRealTimers(); });

describe('Project Brain wake-ups', () => {
  it('LISTENs once and wakes only the followers of the project that changed', async () => {
    const clients: ReturnType<typeof fakeClient>[] = [];
    const wakeups = createProjectBrainWakeups({ connect: () => { const c = fakeClient(); clients.push(c); return c; } });
    const a: string[] = [];
    const b: string[] = [];
    wakeups.subscribe('prj-a', () => a.push('a'));
    wakeups.subscribe('prj-b', () => b.push('b'));
    await tick();
    expect(clients).toHaveLength(1);
    expect(clients[0]!.queries).toEqual([`LISTEN ${PROJECT_BRAIN_NOTIFY_CHANNEL}`]);
    expect(wakeups.listening).toBe(true);
    a.length = 0; b.length = 0; // the on-connect re-read wake
    clients[0]!.notify('prj-a');
    clients[0]!.notify('prj-a', 'some_other_channel');
    expect(a).toEqual(['a']);
    expect(b).toEqual([]);
    await wakeups.close();
  });

  it('a dropped listener wakes everyone (so they re-read) and reconnects while anyone follows', async () => {
    const clients: ReturnType<typeof fakeClient>[] = [];
    const wakeups = createProjectBrainWakeups({ connect: () => { const c = fakeClient(); clients.push(c); return c; }, reconnectMs: [5] });
    const woken: string[] = [];
    wakeups.subscribe('prj-a', () => woken.push('a'));
    await tick();
    woken.length = 0;
    clients[0]!.fail();
    expect(woken).toEqual(['a']);
    expect(wakeups.listening).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(clients).toHaveLength(2);
    expect(wakeups.listening).toBe(true);
    await wakeups.close();
  });

  it('keeps retrying a database that refuses, without throwing at the follower', async () => {
    let attempts = 0;
    const wakeups = createProjectBrainWakeups({ connect: () => { attempts += 1; return fakeClient({ failConnect: true }); }, reconnectMs: [5] });
    wakeups.subscribe('prj-a', () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(attempts).toBeGreaterThan(1);
    expect(wakeups.listening).toBe(false);
    await wakeups.close();
  });

  it('idles before closing, so a long-polling client does not cost a connection per page', async () => {
    const clients: ReturnType<typeof fakeClient>[] = [];
    const wakeups = createProjectBrainWakeups({ connect: () => { const c = fakeClient(); clients.push(c); return c; }, idleCloseMs: 20 });
    const off = wakeups.subscribe('prj-a', () => undefined);
    await tick();
    off();
    const again = wakeups.subscribe('prj-a', () => undefined);
    await tick();
    expect(clients).toHaveLength(1);
    again();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(clients[0]!.ended()).toBe(true);
    expect(wakeups.listening).toBe(false);
    await wakeups.close();
  });

  it('a wait ends on the wake, on the timeout, or on abort -- and never rejects', async () => {
    const clients: ReturnType<typeof fakeClient>[] = [];
    const wakeups = createProjectBrainWakeups({ connect: () => { const c = fakeClient(); clients.push(c); return c; } });
    const waiting = waitForProjectBrainWake(wakeups, 'prj-a', 5_000);
    await tick();
    clients[0]!.notify('prj-a');
    await expect(waiting).resolves.toBe('woken');
    await expect(waitForProjectBrainWake(null, 'prj-a', 5)).resolves.toBe('timeout');
    const abort = new AbortController();
    const aborted = waitForProjectBrainWake(wakeups, 'prj-a', 5_000, abort.signal);
    abort.abort();
    await expect(aborted).resolves.toBe('aborted');
    await wakeups.close();
  });
});
