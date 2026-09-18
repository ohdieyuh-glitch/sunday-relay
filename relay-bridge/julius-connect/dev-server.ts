import { createServer, type Server } from 'node:http';

import { handleJuliusConnectRoute, isJuliusConnectRoute } from './julius-connect-routes';
import { createLiveBrowser, type LiveBrowser } from './live-browser';
import { createJuliusConnectService, type JuliusConnectService, type JuliusConnectServiceOptions } from './julius-connect-service';
import { handleSidekickRoute, isSidekickRoute } from '../sidekicks/sidekick-routes';
import { createSidekickService, type SidekickService } from '../sidekicks/sidekick-service';
import { createCredentialIntake } from '../sidekicks/credential-intake';

/**
 * JULIUS CONNECT — THE LOCAL DEVELOPMENT SERVICE WONDERLAND TALKS TO.
 *
 *   npm run julius-connect:dev
 *
 * Binds 127.0.0.1 only. Provider-free: every connector that can connect here is a DEVELOPMENT CONNECTOR, the vault is
 * process memory, and nothing outside this machine is contacted. Logs name intents and outcomes, never material.
 */

/**
 * The hosts the real browser may reach. Wonderland checks the same list before it asks; this is the check that actually
 * stops a fetch, so a client that forgets cannot reach further (founder, 2026-09-17: Wonder Web should be real).
 */
export const LIVE_BROWSER_HOSTS = [
  'en.wikipedia.org', 'wikipedia.org', 'www.wikipedia.org',
  'example.com', 'www.example.com',
  'instagram.com', 'www.instagram.com',
  'duckduckgo.com', 'html.duckduckgo.com',
];

export const JULIUS_CONNECT_DEV_HOST = '127.0.0.1';
export const JULIUS_CONNECT_DEV_PORT = 8795;
const TICK_MS = 200;

export function startJuliusConnectDevServer(
  port: number,
  options: Partial<JuliusConnectServiceOptions> = {},
  log: (line: string) => void = () => undefined,
): Promise<{ server: Server; service: JuliusConnectService; port: number; close: () => Promise<void> }> {
  const hosts = (process.env.WONDER_WEB_HOSTS ?? '').split(',').map((host) => host.trim()).filter((host) => host.length > 0);
  const browser: LiveBrowser = createLiveBrowser({ allowHosts: hosts.length > 0 ? hosts : LIVE_BROWSER_HOSTS });
  const service = createJuliusConnectService({ userId: 'founder', projectId: 'pixel-canvas', browser, ...options });
  // THE COMPANIONS LIVE HERE TOO. One local service, two doors: connections under /julius-connect/v1/ and the LLM
  // Companion and Jhinn under /sidekicks/v1/. They share a process and share nothing else -- a sidekick has no
  // connection authority, and Julius Connect has no opinion about what a companion says.
  // THE KEY LIVES HERE AND NOWHERE ELSE: in this process's memory, put in by the founder's own connect step, resolved
  // only at the moment of a call. Not on disk, not in a log, not in anything Wonderland reads.
  const intake = createCredentialIntake();
  const sidekicks: SidekickService = createSidekickService({ resolveOpenAiKey: () => intake.resolve('openai') });
  const ticker = setInterval(() => {
    service.tick();
    sidekicks.tick();
  }, TICK_MS);
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    if (isSidekickRoute(pathname)) {
      if (req.method === 'POST') {
        const started = Date.now();
        res.on('finish', () => log(`${new Date().toISOString()} ${req.method} ${pathname} -> ${res.statusCode} (${Date.now() - started} ms)`));
      }
      void handleSidekickRoute(req, res, sidekicks, (providerId, material) => intake.put(providerId, material)).catch(() => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end('{"ok":false}');
        }
      });
      return;
    }
    if (!isJuliusConnectRoute(pathname)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"ok":false}');
      return;
    }
    if (req.method === 'POST') {
      const started = Date.now();
      res.on('finish', () => log(`${new Date().toISOString()} ${req.method} ${pathname} -> ${res.statusCode} (${Date.now() - started} ms)`));
    }
    void handleJuliusConnectRoute(req, res, service, browser);
  });
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      clearInterval(ticker);
      reject(error);
    });
    server.listen(port, JULIUS_CONNECT_DEV_HOST, () => {
      const address = server.address();
      const bound = typeof address === 'object' && address !== null ? address.port : port;
      resolve({
        server, service, port: bound,
        close: () => new Promise<void>((done) => {
          clearInterval(ticker);
          void browser.shutdown();
          void sidekicks.close();
          server.close(() => done());
        }),
      });
    });
  });
}

if (require.main === module) {
  // A PROMISE NOBODY CAUGHT MUST NOT TAKE THE SERVICE DOWN. This process holds every connection, every grant and every
  // audit line; a browser that failed in the background is worth a line in the log, not the loss of all of that.
  process.on('unhandledRejection', (reason) => {
    console.error(`Julius Connect: something failed in the background and was not caught -- ${String(reason).slice(0, 300)}`);
  });
  process.on('uncaughtException', (error) => {
    console.error(`Julius Connect: uncaught -- ${String(error?.stack ?? error).slice(0, 500)}`);
  });

  const port = Number(process.env.JULIUS_CONNECT_DEV_PORT ?? JULIUS_CONNECT_DEV_PORT);
  startJuliusConnectDevServer(port, {}, (line) => console.log(line)).then(({ port: bound }) => {
    console.log(`JULIUS CONNECT — DEVELOPMENT SERVICE on http://${JULIUS_CONNECT_DEV_HOST}:${bound}/julius-connect/v1/surface`);
    console.log('Provider-free: development connectors only, in-memory vault, no provider is contacted.');
    console.log(`WONDER WEB LIVE: a real browser on this machine may reach these hosts and no others -- ${LIVE_BROWSER_HOSTS.join(', ')}.`);
    console.log('SIDEKICKS: the LLM Companion and Jhinn are SIMULATED until the founder connects a real provider. No provider is contacted.');
  }, (error: Error) => {
    console.error(`Julius Connect development service could not start: ${error.message}`);
    process.exitCode = 1;
  });
}
