/**
 * LIVE PROJECT BRAIN UPDATES WITHOUT POLLING.
 *
 * Migration 029 puts a trigger on Julius's durable event log: every committed
 * Julius or Project Brain event sends `pg_notify('relay_project_brain', projectId)`.
 * This holds ONE listening connection per bridge process and wakes whoever is
 * following that project. A wake-up carries no state -- the follower re-reads the
 * durable log from its cursor -- so a missed or duplicated notification can delay
 * an update but never invent, lose or reorder one.
 *
 * NOTIFY IS TRANSACTIONAL. Postgres delivers it only when the announcing
 * transaction commits, so a follower is never woken for a row that does not exist.
 *
 * WHEN THE LISTENER IS DOWN, followers are woken anyway (so they re-read), and on
 * a slow safety interval after that; the listener reconnects with backoff while
 * anyone is following, and closes when nobody is.
 */

export const PROJECT_BRAIN_NOTIFY_CHANNEL = 'relay_project_brain';

/** The slice of `pg.Client` this needs; a test can hand in a fake. */
export interface ProjectBrainListenClient {
  connect(): Promise<unknown>;
  query(sql: string): Promise<unknown>;
  end(): Promise<unknown>;
  on(event: 'notification', listener: (message: { channel: string; payload?: string }) => void): unknown;
  on(event: 'error' | 'end', listener: (error?: unknown) => void): unknown;
}

export interface ProjectBrainWakeups {
  /** Call `wake` whenever the project's durable feed may have moved. Returns an unsubscribe. */
  subscribe(projectId: string, wake: () => void): () => void;
  /** Whether the listening connection is up right now. */
  readonly listening: boolean;
  close(): Promise<void>;
}

export function createProjectBrainWakeups(input: {
  readonly connect: () => ProjectBrainListenClient;
  readonly reconnectMs?: readonly number[];
  /** How long the listener stays open with nobody following. */
  readonly idleCloseMs?: number;
  readonly log?: (line: string) => void;
}): ProjectBrainWakeups {
  const followers = new Map<string, Set<() => void>>();
  const backoff = input.reconnectMs ?? [500, 1000, 2000, 5000, 10000];
  let client: ProjectBrainListenClient | null = null;
  let listening = false;
  let connecting = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const followerCount = () => [...followers.values()].reduce((sum, set) => sum + set.size, 0);
  const wakeProject = (projectId: string) => { for (const wake of followers.get(projectId) ?? []) wake(); };
  const wakeAll = () => { for (const projectId of followers.keys()) wakeProject(projectId); };

  const drop = (reason: string) => {
    if (client === null) return;
    const stale = client;
    client = null;
    listening = false;
    stale.end().catch(() => undefined);
    input.log?.(`project brain listener down: ${reason}`);
    // Re-read now: anything committed while the listener was down was not announced.
    wakeAll();
    schedule();
  };

  const schedule = () => {
    if (closed || timer !== null || followerCount() === 0) return;
    const delay = backoff[Math.min(attempt, backoff.length - 1)] ?? 10000;
    attempt += 1;
    timer = setTimeout(() => { timer = null; void open(); }, delay);
    timer.unref?.();
  };

  const open = async () => {
    if (closed || client !== null || connecting || followerCount() === 0) return;
    connecting = true;
    const candidate = input.connect();
    try {
      candidate.on('notification', (message) => {
        if (message.channel === PROJECT_BRAIN_NOTIFY_CHANNEL && typeof message.payload === 'string') wakeProject(message.payload);
      });
      candidate.on('error', (error) => { if (client === candidate) drop(error instanceof Error ? error.message : 'error'); });
      candidate.on('end', () => { if (client === candidate) drop('connection ended'); });
      await candidate.connect();
      await candidate.query(`LISTEN ${PROJECT_BRAIN_NOTIFY_CHANNEL}`);
      client = candidate;
      listening = true;
      attempt = 0;
      // Anything committed between a follower's read and this LISTEN was not announced to it.
      wakeAll();
    } catch (error) {
      candidate.end().catch(() => undefined);
      input.log?.(`project brain listener could not connect: ${error instanceof Error ? error.message : String(error)}`);
      schedule();
    } finally {
      connecting = false;
    }
  };

  return {
    subscribe(projectId, wake) {
      const set = followers.get(projectId) ?? new Set();
      set.add(wake);
      followers.set(projectId, set);
      void open();
      if (idleTimer !== null) { clearTimeout(idleTimer); idleTimer = null; }
      return () => {
        set.delete(wake);
        if (set.size === 0) followers.delete(projectId);
        // A long-polling client unsubscribes between every page. Closing at once
        // would cost a connection per poll, so the listener idles for a while first.
        if (followerCount() === 0 && client !== null && idleTimer === null) {
          idleTimer = setTimeout(() => {
            idleTimer = null;
            if (followerCount() > 0 || client === null) return;
            const idle = client;
            client = null;
            listening = false;
            idle.end().catch(() => undefined);
          }, input.idleCloseMs ?? 60_000);
          idleTimer.unref?.();
        }
      };
    },
    get listening() { return listening; },
    async close() {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      if (idleTimer !== null) clearTimeout(idleTimer);
      followers.clear();
      const last = client;
      client = null;
      listening = false;
      await last?.end().catch(() => undefined);
    },
  };
}

/**
 * Wait until the project is woken or `ms` passes, whichever is first. Never
 * rejects: a timeout is an ordinary answer ("nothing new"), not an error.
 */
export function waitForProjectBrainWake(wakeups: ProjectBrainWakeups | null, projectId: string, ms: number, signal?: AbortSignal): Promise<'woken' | 'timeout' | 'aborted'> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve('aborted'); return; }
    let unsubscribe: () => void = () => undefined;
    const finish = (how: 'woken' | 'timeout' | 'aborted') => {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      resolve(how);
    };
    const onAbort = () => finish('aborted');
    const timer = setTimeout(() => finish('timeout'), Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (wakeups !== null) unsubscribe = wakeups.subscribe(projectId, () => finish('woken'));
  });
}
