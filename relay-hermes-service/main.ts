import type { Server } from 'node:http';
import { createLocalHermesTransport } from '../relay-bridge/reviewer-harness/hermes/local-transport';
import { createHermesService, setLifecycleState } from './service';
import { describeStartup, loadServiceConfig } from './config';

/**
 * THE STANDALONE HERMES REVIEWER SERVICE PROCESS.
 *
 * This is the box that actually has Hermes. The Relay bridge does not, will
 * not, and should stop pretending it might — which is the whole reason this
 * process exists.
 *
 * It reuses the production engine wholesale: `createLocalHermesTransport`
 * wraps the existing discovery, isolated profile, argument builder,
 * process-group termination, redaction, limits and usage parsing. There is no
 * second process runner and no second profile implementation here, because two
 * copies of safety logic drift, and the drifted one is always the one running
 * in production.
 *
 * SHUTDOWN IS PART OF THE CONTRACT, NOT AN AFTERTHOUGHT. On SIGTERM the
 * service stops accepting new reviews immediately, asks every live run to
 * cancel, waits a bounded time, and exits. A review interrupted this way is
 * never reported as completed and never yields a verdict — a platform
 * restarting a container must not be able to manufacture an approval.
 */

/** How long a graceful shutdown may take before the process exits anyway. */
const SHUTDOWN_GRACE_MS = 10_000;

export function main(): void {
  const result = loadServiceConfig(process.env);
  if (!result.ok) {
    // Names only — never values. This reaches a deployment log.
    for (const problem of result.problems) {
      console.error(`Hermes Reviewer service cannot start: ${problem}`);
    }
    process.exitCode = 1;
    return;
  }
  const config = result.config;

  const engine = createLocalHermesTransport({
    executable: config.executable,
    provider: config.provider,
    apiKey: config.apiKey,
    env: process.env,
  });

  const server: Server = createHermesService(engine);

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    // 1. Refuse new reviews immediately. Readiness still answers, and says
    //    it is shutting down rather than looking healthy.
    setLifecycleState('shutting_down');
    console.log(`Hermes Reviewer service received ${signal} — draining.`);

    // 2. Ask every live run to stop. `cancelAll` reaches the child process
    //    groups through the same termination path a user cancel uses.
    void engine.cancelAll?.().catch(() => { /* best effort */ });

    // 3. Close the listener, then exit once connections drain.
    server.close(() => process.exit(0));

    // 4. A child that ignores cancellation must not hold the deploy open.
    const forced = setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS);
    forced.unref?.();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server.listen(config.port, config.host, () => {
    setLifecycleState('ready');
    // eslint-disable-next-line no-console
    console.log(describeStartup(config));
  });
}

// Run when executed directly (the esbuild CJS bundle sets require.main).
if (require.main === module) {
  main();
}
