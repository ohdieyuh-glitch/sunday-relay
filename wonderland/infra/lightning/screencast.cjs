// DENSE MOTION EVIDENCE: every frame the page paints, not one every 670 ms.
//
// burst.cjs takes screenshots, and a full-page screenshot of a 1080p stream
// costs about half a second. Frames 670 ms apart cannot distinguish a smooth
// walk from a teleporting one — at a walking speed of 130 uu/s the Dog moves
// most of a stride between grabs, so EVERY gait looks like snapping. Measuring
// the capture and reporting it as the animation is the mistake this file
// exists to avoid.
//
// Chrome DevTools Protocol's Page.startScreencast pushes a JPEG per painted
// frame with a timestamp, over the already-open connection. No encoder, no
// ffmpeg, no re-render. That is dense enough to see a paw leave the ground.
//
//   node screencast.cjs <url> <outdir> [seconds] [maxFps]
//
// Writes NNNN.jpg plus screencast.json carrying each frame's CDP timestamp and
// the video element's own currentTime, so a gap in the output can be told apart
// from a gap in the stream.
'use strict';

const fs = require('fs');
const path = require('path');

const URL_ = process.argv[2] || 'http://127.0.0.1:8080/';
const OUTDIR = process.argv[3] || 'screencast';
const SECONDS = parseFloat(process.argv[4] || '6');
const MAX_FPS = parseInt(process.argv[5] || '30', 10);
const SETTLE_MS = parseInt(process.env.WL_SETTLE_MS || '10000', 10);
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
  if (!chromium) { console.error('playwright is not installed.'); process.exit(3); }

  fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await chromium.launch({
    channel: 'chrome',                 // Chromium has no H264 decoder
    args: ['--autoplay-policy=no-user-gesture-required',
           '--use-fake-ui-for-media-stream', '--no-sandbox',
           '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    viewport: { width: RES_X, height: RES_Y }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.mouse.click(RES_X / 2, RES_Y / 2); } catch (_) {}
  await page.waitForTimeout(1500);
  try { await page.mouse.click(RES_X / 2, RES_Y / 2); } catch (_) {}

  // TWO KINDS OF PAGE, and waiting for the wrong readiness signal reports the
  // healthy one as dead. The Pixel Streaming player paints a <video> and is
  // ready when a frame has DECODED; the Three.js gait preview paints a <canvas>
  // and is ready when it has a backing size. This tool is worth having for both
  // — the same motion question is asked of the engine and of the preview — so
  // it asks the page which one it is rather than assuming.
  const kind = await page.evaluate(() =>
    document.querySelector('video') ? 'video'
      : document.querySelector('canvas') ? 'canvas' : 'none');
  let playing = false;
  if (kind === 'video') {
    playing = await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return !!v && v.videoWidth > 0 && v.videoHeight > 0 && v.currentTime > 0;
    }, { timeout: 90000 }).then(() => true).catch(() => false);
    if (!playing) {
      console.error('NO VIDEO: the page loaded but no frame ever decoded.');
      await browser.close(); process.exit(4);
    }
  } else if (kind === 'canvas') {
    playing = await page.waitForFunction(() => {
      const c = document.querySelector('canvas');
      return !!c && c.width > 0 && c.height > 0;
    }, { timeout: 30000 }).then(() => true).catch(() => false);
    if (!playing) {
      console.error('NO CANVAS: the page has a canvas that never got a size.');
      await browser.close(); process.exit(4);
    }
    console.log('  [screencast] canvas page (no video element) — WebGL capture');
  } else {
    console.error('NEITHER: the page has no <video> and no <canvas> to capture.');
    await browser.close(); process.exit(4);
  }
  await page.waitForTimeout(SETTLE_MS);

  const cdp = await context.newCDPSession(page);
  const frames = [];
  let n = 0;

  cdp.on('Page.screencastFrame', async (ev) => {
    // ACK FIRST. Chrome stops sending until the frame is acknowledged, so any
    // work done before the ack throttles the very rate being measured.
    try { await cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }); }
    catch (_) { /* the session may already be closing */ }
    const name = `${String(n).padStart(4, '0')}.jpg`;
    fs.writeFileSync(path.join(OUTDIR, name), Buffer.from(ev.data, 'base64'));
    frames.push({ i: n, name,
                  timestamp: ev.metadata && ev.metadata.timestamp,
                  w: ev.metadata && ev.metadata.deviceWidth,
                  h: ev.metadata && ev.metadata.deviceHeight });
    n++;
  });

  const probe = () => page.evaluate(() => {
    const v = document.querySelector('video');
    if (v) {
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      return { t: v.currentTime, w: v.videoWidth, h: v.videoHeight,
               decoded: q ? q.totalVideoFrames : null,
               dropped: q ? q.droppedVideoFrames : null };
    }
    // A canvas page has no stream to account for; report the surface size and
    // wall time so the same metadata block works, with nulls where a stream
    // number would be a fabrication.
    const c = document.querySelector('canvas');
    return { t: performance.now() / 1000,
             w: c ? c.width : 0, h: c ? c.height : 0,
             decoded: null, dropped: null };
  });
  const before = await probe();

  await cdp.send('Page.startScreencast',
    { format: 'jpeg', quality: 92, maxWidth: RES_X, maxHeight: RES_Y, everyNthFrame: 1 });
  await page.waitForTimeout(SECONDS * 1000);
  await cdp.send('Page.stopScreencast');
  const after = await probe();

  // Inter-frame gaps, so "the animation stuttered" and "the capture stuttered"
  // are separable by a reader who was not here.
  const gaps = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].timestamp && frames[i - 1].timestamp) {
      gaps.push(+((frames[i].timestamp - frames[i - 1].timestamp) * 1000).toFixed(1));
    }
  }
  gaps.sort((a, b) => a - b);
  const pct = (p) => gaps.length ? gaps[Math.min(gaps.length - 1,
    Math.floor(gaps.length * p))] : null;

  const meta = {
    url: URL_, seconds: SECONDS, maxFps: MAX_FPS,
    stream: { w: before.w, h: before.h },
    viewport: { w: RES_X, h: RES_Y },
    resampled: !(before.w === RES_X && before.h === RES_Y),
    capturedFrames: frames.length,
    captureFps: +(frames.length / SECONDS).toFixed(1),
    surface: kind,
    streamDecoded: after.decoded != null ? after.decoded - before.decoded : null,
    streamDropped: after.dropped != null ? after.dropped - before.dropped : null,
    streamFps: after.decoded != null
      ? +((after.decoded - before.decoded) / (after.t - before.t)).toFixed(1) : null,
    gapMs: { p50: pct(0.5), p90: pct(0.9), max: gaps.length ? gaps[gaps.length - 1] : null },
    frames,
  };
  fs.writeFileSync(path.join(OUTDIR, 'screencast.json'), JSON.stringify(meta, null, 2));
  console.log(`  [screencast] ${frames.length} frames in ${SECONDS}s ` +
              `(${meta.captureFps} fps captured` +
              (meta.streamFps != null
                ? `, stream ${meta.streamFps} fps, ${meta.streamDropped} dropped)`
                : ', canvas surface — no stream counters)'));
  console.log(`  [screencast] frame gaps p50 ${meta.gapMs.p50}ms p90 ${meta.gapMs.p90}ms max ${meta.gapMs.max}ms`);
  console.log(`captured -> ${OUTDIR}`);
  await browser.close();
})().catch((e) => {
  console.error('screencast failed:', e && e.message ? e.message : e);
  process.exit(1);
});
