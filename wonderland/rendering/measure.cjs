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

  // THE VIDEO ELEMENT IS THE ROBUST INSTRUMENT, NOT THE PEER CONNECTION.
  //
  // Wrapping RTCPeerConnection depends on winning a race with the page's own
  // script and on the connection living on the main thread. It lost that race
  // on the real PS2 frontend and reported "no RTCPeerConnection was created",
  // on a stream that was demonstrably delivering frames — shot.cjs was
  // capturing them at the same moment.
  //
  // getVideoPlaybackQuality() is on the element the founder actually watches,
  // needs no interception, and counts exactly what arrived and was decoded.
  const vq = await page.evaluate(async (seconds) => {
    const v = document.querySelector('video');
    if (!v) return { error: 'no <video> element on the player page' };
    const read = () => {
      const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
      return {
        t: performance.now(),
        total: q ? q.totalVideoFrames : v.webkitDecodedFrameCount,
        dropped: q ? q.droppedVideoFrames : v.webkitDroppedFrameCount,
        w: v.videoWidth, h: v.videoHeight,
      };
    };
    const first = read();
    const series = [first];
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      series.push(read());
    }
    const last = series[series.length - 1];
    const secs = (last.t - first.t) / 1000;
    const perSecond = [];
    for (let i = 1; i < series.length; i++) {
      const dt = (series[i].t - series[i - 1].t) / 1000;
      if (dt > 0) perSecond.push((series[i].total - series[i - 1].total) / dt);
    }
    return {
      seconds: secs,
      frames: last.total - first.total,
      dropped: last.dropped - first.dropped,
      fps_mean: secs > 0 ? (last.total - first.total) / secs : null,
      per_second: perSecond,
      resolution: last.w + 'x' + last.h,
    };
  }, SECONDS);

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

  if (vq.error) {
    fs.writeFileSync(OUT, JSON.stringify({ error: vq.error }, null, 2));
    console.error('MEASUREMENT FAILED: ' + vq.error);
    process.exit(4);
  }
  // The peer-connection stats are a BONUS now. Their absence is a note, not a
  // failure, because the video element already answered the question.
  const pcStats = samples && samples.error ? null : samples;

  const video = (pcStats && pcStats.samples ? pcStats.samples : [])
    .filter((s) => s.framesPerSecond !== undefined);
  const codecs = [...new Set((pcStats && pcStats.samples ? pcStats.samples : [])
    .filter((s) => s.codec).map((s) => s.codec))];
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

  const sorted = (vq.per_second || []).slice().sort((a, b) => a - b);
  const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null);
  const summary = {
    url: URL_,
    seconds: SECONDS,
    // The primary measurement, from the element the founder watches.
    delivered: {
      fps_mean: vq.fps_mean, fps_min: sorted[0] ?? null,
      fps_p50: q(0.5), fps_p95: q(0.95),
      frames: vq.frames, dropped: vq.dropped,
      resolution: vq.resolution, window_seconds: vq.seconds,
      per_second: vq.per_second,
    },
    peer_connection_stats_available: !!(pcStats && pcStats.samples),
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
  const d = summary.delivered;
  console.log(`DELIVERED fps mean ${d.fps_mean === null ? '?' : d.fps_mean.toFixed(1)} ` +
              `min ${d.fps_min === null ? '?' : d.fps_min.toFixed(1)} ` +
              `p50 ${d.fps_p50 === null ? '?' : d.fps_p50.toFixed(1)}  ` +
              `${d.resolution}  frames ${d.frames} dropped ${d.dropped}` +
              (summary.bitrate_kbps ? `  ${Math.round(summary.bitrate_kbps)} kbps` : '') +
              (codecs.length ? `  codec ${codecs.join(',')}` : ''));
  if (!d.frames) {
    console.error('no frames were decoded — the stream delivered nothing to measure');
    process.exit(4);
  }
})().catch((e) => { console.error(e); process.exit(1); });
