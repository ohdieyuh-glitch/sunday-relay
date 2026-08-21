// Measure the stream the founder actually receives, from the receiving end.
//
// WHY THE BROWSER IS THE INSTRUMENT
//
// Two different numbers get called "FPS" here and only one of them matters to
// a person looking at Wonderland. The engine can render 140 frames a second
// into an encoder that delivers 22, and the engine-side counter will report
// the 140. WebRTC's own getStats() reports what arrived and was decoded:
// framesPerSecond, framesDecoded, frameWidth/Height, bytesReceived, jitter,
// freezeCount. That is the founder's experience, measured rather than inferred.
//
// It also needs nothing from the engine. Every engine-side profiler in this
// project has had to be verified before it could be trusted (FScreenshotRequest
// returned success and wrote nothing), so a measurement that depends on no
// engine feature at all is the one to build the report on. Engine-side numbers
// are a useful ADDITION and are collected separately, by probe, when they have
// been proven to exist.
//
//   node measure.cjs <player-url> <out.json> [seconds]
'use strict';

const URL_ = process.argv[2] || 'http://127.0.0.1:8080/';
const OUT = process.argv[3] || 'stream-stats.json';
const SECONDS = parseInt(process.argv[4] || process.env.WL_MEASURE_SECONDS || '30', 10);
const SETTLE_MS = parseInt(process.env.WL_SETTLE_MS || '12000', 10);
const fs = require('fs');

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
    console.error('playwright is not installed; run prepare.sh on CPU first.');
    process.exit(3);
  }

  // channel:'chrome' for the same reason shot.cjs uses it: Playwright's bundled
  // Chromium has no H264 decoder, so an H264 stream decodes zero frames and
  // every number below would be a confident zero.
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required',
           '--use-fake-ui-for-media-stream',
           '--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.mouse.click(640, 360); } catch (_) {}

  // Find the RTCPeerConnection the player page made. The PS2 frontend does not
  // expose it on window, so it is captured by wrapping the constructor BEFORE
  // the page's own script runs on the next navigation.
  await page.addInitScript(() => {
    window.__wlPCs = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const pc = new Original(...args);
      window.__wlPCs.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = Original.prototype;
  });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  try { await page.mouse.click(640, 360); } catch (_) {}
  await page.waitForTimeout(SETTLE_MS);

  const samples = await page.evaluate(async (seconds) => {
    const out = [];
    const pcs = window.__wlPCs || [];
    if (!pcs.length) return { error: 'no RTCPeerConnection was created on this page' };
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      for (const pc of pcs) {
        let report;
        try { report = await pc.getStats(); } catch (_) { continue; }
        report.forEach((s) => {
          if (s.type === 'inbound-rtp' && s.kind === 'video') {
            out.push({
              t: Date.now(),
              framesPerSecond: s.framesPerSecond,
              framesDecoded: s.framesDecoded,
              framesDropped: s.framesDropped,
              frameWidth: s.frameWidth,
              frameHeight: s.frameHeight,
              bytesReceived: s.bytesReceived,
              jitter: s.jitter,
              freezeCount: s.freezeCount,
              totalFreezesDuration: s.totalFreezesDuration,
              totalDecodeTime: s.totalDecodeTime,
              totalInterFrameDelay: s.totalInterFrameDelay,
              keyFramesDecoded: s.keyFramesDecoded,
              codecId: s.codecId,
              pliCount: s.pliCount,
              nackCount: s.nackCount,
            });
          }
          if (s.type === 'codec' && s.mimeType) {
            out.push({ t: Date.now(), codec: s.mimeType, codecId: s.id });
          }
        });
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { samples: out };
  }, SECONDS);

  await browser.close();

  if (samples.error) {
    fs.writeFileSync(OUT, JSON.stringify({ error: samples.error }, null, 2));
    console.error('MEASUREMENT FAILED: ' + samples.error);
    process.exit(4);
  }

  const video = samples.samples.filter((s) => s.framesPerSecond !== undefined);
  const codecs = [...new Set(samples.samples.filter((s) => s.codec).map((s) => s.codec))];
  // Bitrate from the byte counter across the window, not from an instantaneous
  // field: bytesReceived is monotonic and the difference over a known interval
  // is the only honest way to state a rate.
  let bitrateKbps = null;
  if (video.length >= 2) {
    const a = video[0], b = video[video.length - 1];
    const seconds = (b.t - a.t) / 1000;
    if (seconds > 0) bitrateKbps = ((b.bytesReceived - a.bytesReceived) * 8) / seconds / 1000;
  }
  const fps = video.map((s) => s.framesPerSecond).filter((v) => typeof v === 'number');
  fps.sort((x, y) => x - y);
  const pct = (p) => (fps.length ? fps[Math.min(fps.length - 1, Math.floor(fps.length * p))] : null);

  const summary = {
    url: URL_,
    seconds: SECONDS,
    samples: video.length,
    codec: codecs,
    resolution: video.length ? `${video[video.length - 1].frameWidth}x${video[video.length - 1].frameHeight}` : null,
    fps_min: fps.length ? fps[0] : null,
    fps_p50: pct(0.5),
    fps_p95: pct(0.95),
    fps_max: fps.length ? fps[fps.length - 1] : null,
    fps_mean: fps.length ? fps.reduce((a, b) => a + b, 0) / fps.length : null,
    bitrate_kbps: bitrateKbps,
    frames_dropped: video.length ? video[video.length - 1].framesDropped : null,
    freeze_count: video.length ? video[video.length - 1].freezeCount : null,
    total_freeze_seconds: video.length ? video[video.length - 1].totalFreezesDuration : null,
    // Decode time per frame is the receiver's cost, not the renderer's. Kept
    // because a stream that is heavy to DECODE looks stuttery on the founder's
    // machine no matter what the L4 did.
    mean_decode_ms: (() => {
      if (video.length < 2) return null;
      const a = video[0], b = video[video.length - 1];
      const frames = b.framesDecoded - a.framesDecoded;
      if (!frames) return null;
      return ((b.totalDecodeTime - a.totalDecodeTime) / frames) * 1000;
    })(),
    raw: video,
  };
  fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`fps p50 ${summary.fps_p50}  min ${summary.fps_min}  ` +
              `${summary.resolution}  ${Math.round(summary.bitrate_kbps || 0)} kbps  ` +
              `codec ${codecs.join(',') || '?'}`);
  if (summary.fps_p50 === null) {
    console.error('no frames were decoded — the stream delivered nothing to measure');
    process.exit(4);
  }
})().catch((e) => { console.error(e); process.exit(1); });
