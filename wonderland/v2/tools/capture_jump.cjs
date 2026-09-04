// THE JUMP, AS PAINTED FRAMES, WITH THE KEY ACTUALLY PRESSED.
//
//   node capture_jump.cjs <url> <outdir> [mode] [seconds]
//       mode: stand | run        (default stand)
//
// The founder rejected the Dog's jump for a pose -- "arms/front limbs pulled
// behind him" -- so the acceptance evidence has to be the pose, at the moments
// it passes through: the dip before, the drive off the ground, the apex, the
// landing. A screenshot every 500 ms cannot show that. A jump at
// JumpZVelocity 420 is airborne for well under a second, so half of it would
// fall between two grabs and the contact sheet would be an argument about
// capture rate rather than about animation.
//
// So this drives the REAL package over Pixel Streaming -- Space is bound to
// ACharacter::Jump in RelayDogCharacter -- and records every frame Chrome
// paints, through CDP Page.startScreencast, the same transport screencast.cjs
// uses for the locomotion film. What arrives is what the founder would see.
//
// `run` holds W first so the jump blends out of the run cycle, which is the
// case the founder called out separately: a running jump must not look like a
// standing one played while sliding.
'use strict';
const fs = require('fs');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8080/';
const OUTDIR = process.argv[3] || 'jumpcast';
const MODE = (process.argv[4] || 'stand').toLowerCase();
const SECONDS = parseFloat(process.argv[5] || '4.5');
const RES_X = parseInt(process.env.WL_RES_X || '1280', 10);
const RES_Y = parseInt(process.env.WL_RES_Y || '720', 10);
const SETTLE_MS = parseInt(process.env.WL_SETTLE_MS || '18000', 10);

(async () => {
  let chromium = null;
  const toolRoot = process.env.WL_TOOLS
    || (process.env.WL_ROOT ? process.env.WL_ROOT + '/tools' : null);
  for (const c of [toolRoot && toolRoot + '/node_modules/playwright', 'playwright']) {
    if (!c) continue;
    try { ({ chromium } = require(c)); break; } catch (_) { /* next */ }
  }
  if (!chromium) { console.error('playwright is not installed.'); process.exit(3); }
  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.launch({
    channel: 'chrome',                 // Chromium has no H264 decoder
    args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox',
           '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: RES_X, height: RES_Y }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.mouse.click(RES_X / 2, RES_Y / 2); } catch (_) {}
  await page.waitForTimeout(SETTLE_MS);
  const ok = await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.videoWidth > 0 && v.currentTime > 0;
  }, { timeout: 90000 }).then(() => true).catch(() => false);
  if (!ok) { console.error('NO VIDEO: nothing ever decoded.'); await browser.close(); process.exit(4); }
  // The stream only forwards keys once the video has focus.
  try { await page.mouse.click(RES_X / 2, RES_Y / 2); } catch (_) {}

  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', async (ev) => {
    const i = frames.length;
    frames.push({ i, ts: ev.metadata && ev.metadata.timestamp, at: Date.now() });
    fs.writeFileSync(path.join(OUTDIR, String(i).padStart(4, '0') + '.jpg'),
                     Buffer.from(ev.data, 'base64'));
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); } catch (_) {}
  });
  await cdp.send('Page.startScreencast',
                 { format: 'jpeg', quality: 82, maxWidth: RES_X, maxHeight: RES_Y, everyNthFrame: 1 });

  const t0 = Date.now();
  const mark = {};
  if (MODE === 'run') {
    // Get to the arms-back run first: the blend out of it is the thing being
    // judged, and a jump pressed at walking speed is a different question.
    await page.keyboard.down('KeyW');
    mark.runFrom = Date.now() - t0;
    await page.waitForTimeout(2200);
  }
  mark.jumpAt = Date.now() - t0;
  await page.keyboard.down('Space');
  await page.waitForTimeout(120);          // a real press, not a tap the engine may miss
  await page.keyboard.up('Space');
  await page.waitForTimeout(Math.max(500, SECONDS * 1000 - (Date.now() - t0)));
  if (MODE === 'run') { await page.keyboard.up('KeyW'); await page.waitForTimeout(400); }

  try { await cdp.send('Page.stopScreencast'); } catch (_) {}
  fs.writeFileSync(path.join(OUTDIR, 'jump.json'),
                   JSON.stringify({ mode: MODE, frames: frames.length, mark, frameList: frames }, null, 1));
  console.log(JSON.stringify({ mode: MODE, frames: frames.length, outdir: OUTDIR, mark }));
  await browser.close();
})().catch((e) => { console.error('ERR', e && e.message); process.exit(1); });
