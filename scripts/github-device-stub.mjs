#!/usr/bin/env node
/**
 * A LOOPBACK STAND-IN FOR GITHUB'S DEVICE FLOW -- development rehearsal ONLY. Identities from it are NOT REAL and never
 * count toward R16 (two real GitHub accounts are the gate). It lets CORE run two Wonderland clients through the bridge's
 * real desktop sign-in before those accounts exist.
 *
 *   node scripts/github-device-stub.mjs <port> 9001:stub-alpha 9002:stub-beta
 *
 * The bridge uses it only when WONDERLAND_SOCIAL_GITHUB_STUB=http://127.0.0.1:<port> AND its database is the throwaway
 * 127.0.0.1:54329 AND it is not production (relay-bridge/wonderland-github-stub-seam.ts); otherwise the bridge refuses
 * to start.
 *
 * What it serves, as GitHub does:
 *   POST /login/device/code           the NEXT identity on the command line gets this code (in order); none left: an error
 *   POST /login/oauth/access_token    pending once, then a user token for that identity
 *   GET  /user                        { login, id, type } for a token it issued
 *   GET  /login/device                a plain page saying approval is automatic
 * It binds 127.0.0.1 only and never prints a token.
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const STUB_BANNER = 'GITHUB DEVICE STUB -- identities are NOT real (development rehearsal only; never R16 evidence)';

/** "9001:stub-alpha" -> { id: 9001, login: 'stub-alpha' }; anything else throws. */
export function parseIdentity(text) {
  const match = /^(\d{1,9}):([A-Za-z0-9-]{1,39})$/.exec(String(text));
  if (match === null) throw new Error(`an identity is <numeric id>:<login>, not ${JSON.stringify(text)}`);
  return { id: Number(match[1]), login: match[2] };
}

export function createGitHubDeviceStub(identities, log = (line) => console.log(line)) {
  const queue = [...identities];
  const devices = new Map(); // device_code -> { identity, polls, done }
  const tokens = new Map(); // token -> identity
  let issued = 0;

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readJson = (req) => new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });

  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '/').split('?')[0];
      if (req.method === 'POST' && path === '/login/device/code') {
        await readJson(req);
        const identity = queue.shift();
        if (identity === undefined) return json(res, 200, { error: 'stub_exhausted', error_description: 'no identities left on this stub' });
        issued += 1;
        const deviceCode = randomBytes(20).toString('hex');
        devices.set(deviceCode, { identity, polls: 0, done: false });
        const userCode = `STUB-${String(issued).padStart(4, '0')}`;
        log(`[stub] device code ${issued} -> ${identity.login} (${identity.id}), user code ${userCode}`);
        return json(res, 200, { device_code: deviceCode, user_code: userCode, verification_uri: `http://127.0.0.1:${req.socket.localPort}/login/device`, expires_in: 900, interval: 5 });
      }
      if (req.method === 'POST' && path === '/login/oauth/access_token') {
        const body = await readJson(req);
        const device = devices.get(String(body.device_code ?? ''));
        if (device === undefined || device.done) return json(res, 200, { error: 'incorrect_device_code' });
        if (body.grant_type !== 'urn:ietf:params:oauth:grant-type:device_code') return json(res, 200, { error: 'unsupported_grant_type' });
        device.polls += 1;
        if (device.polls === 1) return json(res, 200, { error: 'authorization_pending' });
        device.done = true;
        const token = `stubtok_${randomBytes(16).toString('hex')}`;
        tokens.set(token, device.identity);
        log(`[stub] approved ${device.identity.login} (${device.identity.id})`);
        return json(res, 200, { access_token: token, token_type: 'bearer', scope: '' });
      }
      if (req.method === 'GET' && path === '/user') {
        const auth = String(req.headers.authorization ?? '');
        const identity = tokens.get(auth.replace(/^Bearer\s+/i, ''));
        if (identity === undefined) return json(res, 401, { message: 'Bad credentials' });
        return json(res, 200, { login: identity.login, id: identity.id, type: 'User' });
      }
      if (req.method === 'GET' && path === '/login/device') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        return res.end(`${STUB_BANNER}\nNothing to do here: the stub approves each code on its second poll.\n`);
      }
      return json(res, 404, { message: 'Not Found' });
    })();
  });
}

const entry = process.argv[1] === undefined ? '' : pathToFileURL(process.argv[1]).href;
if (import.meta.url === entry) {
  const port = Number.parseInt(process.argv[2] ?? '', 10);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    console.error('usage: node scripts/github-device-stub.mjs <port 1024-65535> <id:login> [<id:login> ...]');
    process.exit(2);
  }
  const identities = process.argv.slice(3).map(parseIdentity);
  if (identities.length === 0) {
    console.error('give at least one identity, e.g. 9001:stub-alpha 9002:stub-beta');
    process.exit(2);
  }
  createGitHubDeviceStub(identities).listen(port, '127.0.0.1', () => {
    console.log(`${STUB_BANNER}\nlistening on http://127.0.0.1:${port} for ${identities.map((i) => i.login).join(', ')} (approved in that order)`);
  });
}
