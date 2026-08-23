// A BURST OF FRAMES FROM THE LIVE STREAM, because a still cannot show a walk.
//
// The founder's complaint is motion: "sliding, teleporting, jittering,
// snapping, or updating at a low frame rate". Every one of those words
// describes a relationship BETWEEN frames. A single hero PNG — which is all
// this project could capture — cannot show any of them, so the only way to
// judge the fix has been to ask the founder to watch, which is the thing the
// standing instruction says not to do.
//
//   node burst.cjs <url> <outdir> [count] [intervalMs]
//
// Everything about connecting to the stream is the same as shot.cjs and for the
// same reasons: real Chrome because Playwright's Chromium has no H264 decoder,
// a click to satisfy autoplay, a wait for a video that is DECODING rather than
// merely present, and a settle so auto-exposure is not caught mid-converge.
//
// WHAT IT ALSO WRITES, AND WHY. Alongside the PNGs it records, per frame, the
// video element's own currentTime and the decoded-frame counter. Screenshots
// arrive when the browser gets round to them; those two numbers say what the
// STREAM actually delivered in between. A burst whose frames are 300 ms apart
// on the wall clock but 30 ms apart in stream time is measuring the capture,
// not the animation, and burst.json makes that visible instead of letting it be
// read as stutter.
'use strict';

const fs = require('fs');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8080/';
const OUTDIR = process.argv[3] || 'burst';
const COUNT = parseInt(process.argv[4] || '24', 10);
const INTERVAL = parseInt(process.argv[5] || '160', 10);
const SETTLE_MS = parseInt(process.env.WL_SETTLE_MS || '12000', 10);
const RES_X = parseInt(process.env.WL_RES_X || '1280', 10);
const RES_Y = parseInt(process.env.WL_RES_Y || '720', 10);

(async () => {
  let chromium;
  const toolRoot = process.env.WL_TOOLS
    || (process.env.WL_ROOT ? process.env.WL_ROOT + '/tools' : null);
  const candidates = [];
  if (toolRoot) candidates.push(toolRoot + '/node_modules/playwright');
  candidates.push('playwright');
  for (const c of candidates) {
    try { ({ chromium } = require(c)); break; } catch (_) { /* next */ }
  }
  if (!chromium) {
    console.error('playwright is not installed. Run prepare.sh on CPU.');
    process.exit(3);
  }

  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required',
           '--use-fake-ui-for-media-stream', '--no-sandbox',
           '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({
    viewport: { width: RES_X, height: RES_Y }, deviceScaleFactor: 1 });

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.mouse.click(RES_X / 2, RES_Y / 2); } catch (_) {}
  await page.waitForTimeout(1500);
  try { await page.mouse.click(RES_X / 2, RES_Y / 2); } catch (_) {}

  const playing = await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.videoWidth > 0 && v.videoHeight > 0 && v.currentTime > 0;
  }, { timeout: 90000 }).then(() => true).catch(() => false);

  if (!playing) {
    console.error('NO VIDEO: the page loaded but no frame ever decoded.');
    await browser.close();
    process.exit(4);
  }
  await page.waitForTimeout(SETTLE_MS);

  const probe = () => page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    return { t: v.currentTime, w: v.videoWidth, h: v.videoHeight,
             decoded: q ? q.totalVideoFrames : null,
             dropped: q ? q.droppedVideoFrames : null };
  });

  const first = await probe();
  console.log(`  [burst] stream ${first.w}x${first.h}, viewport ${RES_X}x${RES_Y}` +
              (first.w === RES_X && first.h === RES_Y ? ' (1:1)' : ' — RESAMPLED'));

  const frames = [];
  const t0 = Date.now();
  for (let i = 0; i < COUNT; i++) {
    const name = `f${String(i).padStart(3, '0')}.png`;
    const before = await probe();
    await page.screenshot({ path: path.join(OUTDIR, name) });
    frames.push({ i, name, wallMs: Date.now() - t0,
                  streamT: before.t, decoded: before.decoded, dropped: before.dropped });
    if (i + 1 < COUNT) await page.waitForTimeout(INTERVAL);
  }

  // Derive what the stream did between grabs, so a reader does not have to.
  for (let i = 1; i < frames.length; i++) {
    frames[i].dWallMs = frames[i].wallMs - frames[i - 1].wallMs;
    frames[i].dStreamMs = Math.round((frames[i].streamT - frames[i - 1].streamT) * 1000);
    if (frames[i].decoded != null && frames[i - 1].decoded != null) {
      frames[i].dDecoded = frames[i].decoded - frames[i - 1].decoded;
    }
  }
  const last = await probe();
  const meta = {
    url: URL_, count: COUNT, intervalMs: INTERVAL,
    stream: { w: first.w, h: first.h },
    viewport: { w: RES_X, h: RES_Y },
    resampled: !(first.w === RES_X && first.h === RES_Y),
    totalDecoded: last.decoded != null && first.decoded != null
      ? last.decoded - first.decoded : null,
    totalDropped: last.dropped != null && first.dropped != null
      ? last.dropped - first.dropped : null,
    spanMs: frames[frames.length - 1].wallMs,
    frames,
  };
  fs.writeFileSync(path.join(OUTDIR, 'burst.json'), JSON.stringify(meta, null, 2));
  const fpsDelivered = meta.totalDecoded != null && meta.spanMs > 0
    ? (meta.totalDecoded / (meta.spanMs / 1000)).toFixed(1) : '?';
  console.log(`  [burst] ${COUNT} frames over ${meta.spanMs} ms; stream delivered ` +
              `${meta.totalDecoded} decoded (${fpsDelivered} fps), ${meta.totalDropped} dropped`);
  console.log(`captured ${COUNT} -> ${OUTDIR}`);

  await browser.close();
})().catch((e) => {
  console.error('burst failed:', e && e.message ? e.message : e);
  process.exit(1);
});
