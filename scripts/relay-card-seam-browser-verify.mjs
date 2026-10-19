#!/usr/bin/env node
/**
 * THE C.A.R.D. SEAM, VERIFIED IN A REAL BROWSER — in BOTH builds.
 *
 * A previous front-door defect shipped because the demo build (no bridge) and
 * the production build (`VITE_RELAY_LIVE=1` + `VITE_RELAY_BRIDGE_URL`) take
 * different paths, and local verification only ever exercised the demo one.
 * This script drives the SAME journey through both:
 *
 *   Aquala → ENTER RELAY → create the Compound Agent (all eight steps, the
 *   C.A.R.D. included) → ACTIVATE RELAY
 *     demo build : the Agent is online; the durable record carries what was chosen
 *     live build : the next screen is SIGN-IN — no second configuration screen —
 *                  then, as a returning signed-in participant with a connected
 *                  repository, the Mission runner runs under that same C.A.R.D.
 *                  (same id, same revision, same values), Edit C.A.R.D. opens it
 *                  hydrated, Save writes revision N+1, and "PSP" never appears.
 *
 * Usage (from the repository root):
 *   npm run build && npx vite preview --port 4173 &                      # demo build
 *   VITE_RELAY_LIVE=1 VITE_RELAY_BRIDGE_URL=http://127.0.0.1:8799 \
 *     npx vite build --outDir dist-live && npx vite preview --outDir dist-live --port 4174 &
 *   PLAYWRIGHT_DIR=<dir containing node_modules/playwright> \
 *     node scripts/relay-card-seam-browser-verify.mjs
 *
 * Environment: DEMO_BASE (default http://127.0.0.1:4173), LIVE_BASE (default
 * http://127.0.0.1:4174), BRIDGE_PORT (default 8799 — a mock bridge this script
 * starts, answering the read-only calls the runner makes on mount), CHROME
 * (optional executable), PLAYWRIGHT_DIR (where `playwright` resolves from —
 * it is not a dependency of this repository).
 *
 * Exit code 1 if any check fails. Every check is printed PASS/FAIL.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';

const DEMO_BASE = process.env.DEMO_BASE ?? 'http://127.0.0.1:4173';
const LIVE_BASE = process.env.LIVE_BASE ?? 'http://127.0.0.1:4174';
const BRIDGE_PORT = Number(process.env.BRIDGE_PORT ?? '8799');
const AGENT_KEY = 'sunday-relay.compound-agent.v1';
const LEGACY_SESSION_KEY = 'sunday-relay.configured-psp';

const require = createRequire(join(process.env.PLAYWRIGHT_DIR ?? process.cwd(), 'package.json'));
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright is not resolvable — set PLAYWRIGHT_DIR to a directory whose node_modules holds it.');
  process.exit(2);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A mock bridge: only what the live runner reads on mount, with CORS. Nothing here starts anything. */
function startMockBridge(port) {
  const server = createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Content-Type': 'application/json',
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const url = req.url ?? '';
    if (url.startsWith('/relay-api/psp')) { res.writeHead(200, cors); res.end(JSON.stringify({ data: { psps: [] }, psps: [] })); return; }
    if (url.startsWith('/relay-api/missions')) { res.writeHead(200, cors); res.end(JSON.stringify({ missions: [] })); return; }
    if (url.startsWith('/relay-api/repositories')) { res.writeHead(200, cors); res.end(JSON.stringify({ data: { repositories: [] }, repositories: [] })); return; }
    res.writeHead(404, cors); res.end(JSON.stringify({ error: 'not mocked' }));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

async function newPage(browser, options = {}) {
  // Reduced motion: this harness tests the JOURNEY, not the passage animation,
  // and a headless software-GL run should not spend its timeouts on easing.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...options });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  return { context, page, errors };
}

const LEGACY = ['WANDERING', 'What are we building', 'rpv-devchip', 'reh-dog'];
async function assertLoaded(page, where) {
  // A connection-refused error page has no legacy markers either; prove the
  // product loaded before proving what it does not show.
  const entered = await page.getByRole('button', { name: /ENTER RELAY/i }).count();
  record(`${where}: the Relay front door loaded (ENTER RELAY present)`, entered > 0);
  if (entered === 0) throw new Error(`${where}: page did not load — is the preview server up?`);
}

async function assertNoLegacy(page, where) {
  const html = await page.content();
  const found = LEGACY.filter((marker) => html.includes(marker));
  record(`${where}: no legacy shell markers`, found.length === 0, found.join(', '));
}
async function assertNoPsp(page, where) {
  const text = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label') ?? '');
    return `${document.body.innerText}\n${labels.join('\n')}`;
  });
  record(`${where}: the word "PSP" is not shown to the participant`, !/\bPSP\b/.test(text));
}

/** Activate a control by DOM click. This harness proves the JOURNEY; the
 *  landing's full-bleed canvas sits over parts of the panel and intercepts
 *  synthetic pointer hit-tests in headless software-GL runs. */
async function press(locator) {
  await locator.waitFor({ state: 'visible', timeout: 15000 });
  await locator.dispatchEvent('click');
}

/** Enter text the way a person's keystrokes reach React: Playwright's fill when
 *  its actionability check agrees the field is editable, else the native value
 *  setter + an `input` event (what a keystroke produces), after logging why
 *  the check disagreed with the rendered DOM. */
async function type(page, label, text) {
  const field = page.getByLabel(label);
  try {
    await field.fill(text, { timeout: 8000 });
    return;
  } catch {
    const state = await field.evaluate((el) => ({
      disabled: el.disabled, readOnly: el.readOnly, inert: el.closest('[inert]') !== null,
      box: JSON.stringify(el.getBoundingClientRect()), visibility: getComputedStyle(el).visibility,
      opacity: getComputedStyle(el).opacity, layerOpacity: getComputedStyle(el.closest('.rw-layer') ?? el).opacity,
    }));
    console.log(`note: fill("${label}") refused by the actionability check — ${JSON.stringify(state)}; entering the text programmatically`);
    await field.evaluate((el, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  }
}

/** Drive the eight in-world steps. Returns the persisted record. */
/** ENTER RELAY the way a person can: the pointer if the 3D canvas lets it
 *  through, else the keyboard (Tab to the control, Enter) — the canvas sits
 *  over the landing and intercepts synthetic pointer hit-tests in headless runs. */
async function enterRelay(page) {
  const enter = page.getByRole('button', { name: /ENTER RELAY/i }).first();
  try {
    await enter.click({ timeout: 3000 });
  } catch {
    let focused = false;
    for (let i = 0; i < 30 && !focused; i += 1) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => /ENTER RELAY/i.test(document.activeElement?.textContent ?? ''));
    }
    if (!focused) throw new Error('ENTER RELAY is reachable by neither pointer nor keyboard');
    await page.keyboard.press('Enter');
  }
  // The world reports its stage on the root element; the Relay layer is inert
  // and fading in until the stage is `relay` and its chrome is opaque.
  // `attached`, not `visible`: the world root is a full-bleed container whose
  // own box Playwright can consider hidden while its layers are what is seen.
  await page.waitForSelector('.rw[data-stage="relay"]', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => {
    const layer = document.querySelector('.rx')?.closest('.rw-layer');
    return layer !== null && layer !== undefined && !layer.hasAttribute('inert') && Number(getComputedStyle(layer).opacity) > 0.95;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

async function createAgent(page, { name = 'Caesar', spend = '3' } = {}) {
  await enterRelay(page);
  await type(page, 'Agent name', name);
  await press(page.getByRole('button', { name: 'CONTINUE', exact: true }));
  for (let slot = 0; slot < 3; slot += 1) {
    // The first SELECTABLE option in each slot — the product's own catalogue.
    await press(page.locator('.rx-option:not([disabled])').first());
    await press(page.getByRole('button', { name: 'CONTINUE', exact: true }));
  }
  // STEP 05 — C.A.R.D.: choose AUTONOMOUS so the value is distinguishable from any default.
  await press(page.getByRole('button', { name: 'AUTONOMOUS', exact: true }));
  await press(page.getByRole('button', { name: 'CONTINUE', exact: true }));
  // STEP 06 — limits.
  await type(page, 'Spend limit in USD', spend);
  await press(page.getByRole('button', { name: 'CONTINUE', exact: true }));
  // STEP 07 — review → STEP 08 — activate.
  await press(page.getByRole('button', { name: 'CONTINUE', exact: true }));
  await press(page.getByRole('button', { name: /ACTIVATE RELAY/i }));
  await page.waitForTimeout(600);
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), AGENT_KEY);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
});
const bridge = await startMockBridge(BRIDGE_PORT);

try {
  /* ------------------------------------------------------------ DEMO BUILD */
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(DEMO_BASE, { waitUntil: 'networkidle' });
    await assertLoaded(page, 'demo');
    await assertNoLegacy(page, 'demo');
    const stored = await createAgent(page);
    record('demo: the Agent is online after ACTIVATE RELAY', await page.locator('.rx[data-activated="true"]').count() === 1);
    record('demo: no second configuration screen appears', await page.getByText(/Edit your C\.A\.R\.D\./i).count() === 0);
    record('demo: the durable record carries the chosen values', stored?.mode === 'autonomous' && stored?.spendUsd === 3 && stored?.name === 'Caesar', JSON.stringify({ mode: stored?.mode, spendUsd: stored?.spendUsd }));
    record('demo: the record is an addressable C.A.R.D. revision', typeof stored?.cardId === 'string' && stored.cardId.startsWith('card-') && stored?.revision >= 1 && stored?.activatedAt !== null, `${stored?.cardId} r${stored?.revision}`);
    record('demo: no legacy session store is written', await page.evaluate((k) => sessionStorage.getItem(k), LEGACY_SESSION_KEY) === null);
    await assertNoPsp(page, 'demo after activation');
    record('demo: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  /* ------------------------------------------------------------ LIVE BUILD */
  {
    const { context, page, errors } = await newPage(browser);
    await page.goto(LIVE_BASE, { waitUntil: 'networkidle' });
    await assertLoaded(page, 'live');
    await assertNoLegacy(page, 'live');
    const stored = await createAgent(page);
    // THE SEAM: activation leads to sign-in, not to another configuration screen.
    record('live: ACTIVATE RELAY leads straight to sign-in', await page.getByRole('button', { name: /Sign in with GitHub/i }).count() === 1);
    record('live: no second configuration screen for the same C.A.R.D.', await page.getByText(/Edit your C\.A\.R\.D\./i).count() === 0 && await page.getByLabel('Execution mode').count() === 0);
    record('live: no default configuration is shown in its place', await page.getByText(/Default beta configuration/i).count() === 0);
    record('live: the C.A.R.D. is persisted with the chosen values', stored?.mode === 'autonomous' && stored?.spendUsd === 3 && stored?.activatedAt !== null && stored?.revision >= 1, `${stored?.cardId} r${stored?.revision}`);
    const cardId = stored?.cardId; const revision = stored?.revision;
    await assertNoPsp(page, 'live sign-in');

    // RETURNING, SIGNED-IN PARTICIPANT with a connected repository — the reload
    // after the OAuth round-trip. Only the session and the repository pointer are
    // added; the C.A.R.D. is read from where the world left it.
    await page.evaluate(() => {
      sessionStorage.setItem('sunday-relay.bridge.session', JSON.stringify({
        token: 'browser-verify', origin: location.origin, expiresAt: '2099-01-01T00:00:00.000Z', scope: 'browser_control', participantId: 'ghu-verify',
      }));
      // Stored exactly as connected-repository.ts stores it: a JSON-encoded string.
      sessionStorage.setItem('sunday-relay.connected-repository', JSON.stringify('github:github.com/verify/app'));
    });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const runningUnder = await page.getByText(/Running under/i).first().textContent().catch(() => '');
    record('live: the runner runs under the C.A.R.D. built in the world', /C\.A\.R\.D\. Caesar · revision \d+/.test(runningUnder ?? ''), (runningUnder ?? '').trim());
    record('live: same C.A.R.D. id and revision after the reload', await page.evaluate((k) => { const r = JSON.parse(localStorage.getItem(k) ?? '{}'); return `${r.cardId}:${r.revision}:${r.participantId}`; }, AGENT_KEY) === `${cardId}:${revision}:ghu-verify`, 'claimed for ghu-verify');
    const agentPanel = await page.getByLabel('Active C.A.R.D.').textContent().catch(() => '');
    record('live: the requested view shows the chosen autonomy and roles', /autonomous/.test(agentPanel ?? '') && /Claude Code|Sunday Alcatraz|Hermes/.test(agentPanel ?? ''));
    record('live: Start Mission is offered under that C.A.R.D. (no fail-closed default)', await page.getByRole('button', { name: /Start Mission/i }).count() === 1);
    await assertNoPsp(page, 'live runner');
    await assertNoLegacy(page, 'live runner');

    // EXPLICIT EDIT: the surface opens on the record's values and saves a new revision.
    await press(page.getByRole('button', { name: /Edit C\.A\.R\.D\./i }));
    await page.waitForTimeout(300);
    record('live: Edit C.A.R.D. opens the edit surface, not sign-in', await page.getByText(/Edit your C\.A\.R\.D\./i).count() === 1 && await page.getByRole('button', { name: /Sign in with GitHub/i }).count() === 0);
    record('live: the edit surface is hydrated from the C.A.R.D.', await page.getByLabel('Execution mode').inputValue() === 'autonomous');
    await assertNoPsp(page, 'live edit surface');
    await page.getByLabel('Execution mode').selectOption('guided');
    await press(page.getByRole('button', { name: /Save C\.A\.R\.D\./i }));
    await page.waitForTimeout(500);
    const after = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), AGENT_KEY);
    record('live: Save writes the SAME C.A.R.D. as the next revision', after.cardId === cardId && after.revision === revision + 1 && after.mode === 'guided', `${after.cardId} r${after.revision} ${after.mode}`);
    const runningAfter = await page.getByText(/Running under/i).first().textContent().catch(() => '');
    record('live: the runner follows the new revision', (runningAfter ?? '').includes(`revision ${revision + 1}`), (runningAfter ?? '').trim());
    record('live: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  /* ---------------------------------------------------- LIVE BUILD, MOBILE */
  {
    const { context, page, errors } = await newPage(browser, {
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    });
    await page.goto(LIVE_BASE, { waitUntil: 'networkidle' });
    const stored = await createAgent(page, { name: 'Mobile', spend: '2' });
    record('mobile live: activation leads straight to sign-in', await page.getByRole('button', { name: /Sign in with GitHub/i }).count() === 1);
    record('mobile live: the C.A.R.D. persisted with the chosen values', stored?.mode === 'autonomous' && stored?.spendUsd === 2 && stored?.revision >= 1);
    record('mobile live: no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    record('mobile live: no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }
} catch (error) {
  // Leave a picture of where it stopped, next to the results.
  try {
    for (const context of browser.contexts()) {
      const page = context.pages().at(-1);
      if (page) await page.screenshot({ path: `${process.env.HARNESS_SHOT_DIR ?? '.'}/card-seam-harness-failure.png` });
    }
  } catch { /* the failure itself is what matters */ }
  throw error;
} finally {
  await browser.close();
  bridge.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
if (failed.length > 0) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - ${f.name} ${f.detail}`);
  process.exit(1);
}
