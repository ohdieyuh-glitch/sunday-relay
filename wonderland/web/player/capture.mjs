// Drive the player page in a real browser and photograph the sequence the
// founder asked to see: world -> SPACE -> terminal -> typed command -> ESC.
//
//   node wonderland/web/player/capture.mjs [out_dir]
//
// The <video> is empty here (the stream needs the GPU box), so a rendered
// Wonderland frame stands in as the poster. Everything else -- the keyboard
// rules, the focus handoff, the panel -- is the real page.
import { chromium } from '/home/kaisinrogodfree5/sunday-relay-landing3d/node_modules/playwright/index.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] || join(HERE, '../../v2/reference/renders'));
const POSTER = resolve(HERE, '../../v2/reference/renders/V2_GOLDENARRIVAL_PASS24_HeroCam0_720p.png');
mkdirSync(OUT, { recursive: true });

const checks = [];
const check = (name, cond, got) => { checks.push({ name, ok: !!cond, got }); };

// ES modules are blocked over file://, so the page is served. It is served
// from the repo root, which is also how the poster reaches it.
const ROOT = resolve(HERE, '../../..');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
               '.mjs': 'text/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = resolve(ROOT, '.' + rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const rel = (abs) => '/' + abs.slice(ROOT.length + 1);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('  page error:', m.text()); });
await page.goto(`${BASE}${rel(join(HERE, 'index.html'))}`);
await page.$eval('#wl-video', (v, p) => { v.poster = p; }, rel(POSTER));
await page.waitForTimeout(300);

const shot = (n) => page.screenshot({ path: join(OUT, `WL_TERMINAL_${n}.png`) });

// 1. the world, terminal closed
await shot('1_world');
check('world focus is where the page starts',
      await page.evaluate(() => document.activeElement.id === 'wl-world'));
check('terminal starts closed',
      await page.evaluate(() => document.body.dataset.terminal === 'closed'));
check('the SPACE hint is visible over the world',
      await page.isVisible('#wl-hint'));

// 2. SPACE opens it
await page.keyboard.press('Space');
await page.waitForTimeout(200);
await shot('2_terminal');
check('space opened the terminal',
      await page.evaluate(() => document.body.dataset.terminal === 'open'));
check('and focus moved to the input',
      await page.evaluate(() => document.activeElement.id === 'wl-tm-input'));
check('all four role sections are stacked',
      (await page.$$eval('.wl-tmpanel-title', (n) => n.map((e) => e.textContent).join('|')))
        === 'PROMPT ARCHITECT|CODING AGENT|INDEPENDENT REVIEWER|JULIUS');
check('the terminal is honest with no feed connected',
      (await page.textContent('#wl-tm-live')).includes('NO AUTHORITATIVE FEED'));

// 3. TYPING -- the space character, three times, and the panel must not blink
await page.keyboard.type('build a lantern walk along the north way');
await page.waitForTimeout(150);
const typed = await page.inputValue('#wl-tm-input');
check('SPACE TYPED A SPACE', typed === 'build a lantern walk along the north way', typed);
check('and the terminal never closed while typing',
      await page.evaluate(() => document.body.dataset.terminal === 'open'));
check('the page did not scroll',
      await page.evaluate(() => window.scrollY === 0));
await shot('3_typed');

// 4. ESC returns to the world
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
await shot('4_return');
check('escape closed the terminal',
      await page.evaluate(() => document.body.dataset.terminal === 'closed'));
check('and gave the keyboard back to the world',
      await page.evaluate(() => document.activeElement.id === 'wl-world'));

// 5. a connected feed renders authoritative rows -- and only safe fields
await page.keyboard.press('Space');
await page.evaluate(() => window.wonderlandTerminal.connect('relay bridge', [
  { category: 'prompt_architect', at: '14:02:03', headline: 'Planning the lantern walk',
    detail: 'north way, 9 stations', operation: 'PLAN', state: 'done' },
  { category: 'coding_agent', at: '14:02:41', headline: 'Placing lantern stations',
    detail: 'wonderland/v2/layout_v2.py', operation: 'MODIFY',
    reasoning: 'PRIVATE REASONING THAT MUST NOT APPEAR' },
  { category: 'reviewer', at: '14:03:12', headline: 'Reviewing placement clearance',
    detail: 'walkable audit, 0 blocked routes', operation: 'RUN' },
  { category: 'relay', at: '14:03:30', headline: 'Evidence recorded',
    detail: 'mission verified against the walkable audit', state: 'evidence' },
]));
await page.waitForTimeout(250);
await shot('5_live');
const body = await page.textContent('body');
check('a connected feed reads LIVE', (await page.textContent('#wl-tm-live')).includes('LIVE'));
check('orchestration is attributed to Julius', body.includes('Julius: Evidence recorded'));
check('PRIVATE REASONING IS NOT ON SCREEN', !body.includes('PRIVATE REASONING'));

await browser.close();
server.close();

let bad = 0;
for (const c of checks) {
  if (!c.ok) bad += 1;
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.got !== undefined && !c.ok ? `  -> ${JSON.stringify(c.got)}` : ''}`);
}
console.log(`\n${checks.length - bad}/${checks.length} live-browser checks passed`);
console.log(`shots in ${OUT}`);
process.exit(bad ? 1 : 0);
