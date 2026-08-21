// Collect REAL WebRTC statistics from a browser actually playing the stream.
//
// WHY FROM THE BROWSER. Every server-side number describes what we sent. The
// founder's complaint — "visibly low bitrate / heavily compressed and sometimes
// poor" — is about what ARRIVED, and only the receiving peer can measure that.
// Region, encoder settings and bitrate targets are all inputs; RTT, loss and
// the selected ICE candidate pair are outcomes.
//
// Writes one JSON object to stdout. Never asserts quality — that is
// verify-stream-quality.py's job, so the measurement and the verdict cannot be
// quietly conflated.
const path = require('path');
const TOOLS = process.env.WL_TOOLS || '/teamspace/studios/this_studio/wonderland/tools';
const { chromium } = require(path.join(TOOLS, 'node_modules', 'playwright'));

const URL = process.argv[2];
const SETTLE_MS = parseInt(process.env.WL_STATS_SETTLE_MS || '20000', 10);

if (!URL) {
  console.error('usage: stream-stats.cjs <player-url>');
  process.exit(2);
}

(async () => {
  // channel:'chrome' because Playwright's bundled Chromium has NO H264 decoder.
  // With it the page loads, ICE completes, and the video stays black forever —
  // which would read here as "connected, zero bitrate" and send someone hunting
  // an encoder bug that does not exist.
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

  // Capture every RTCPeerConnection the page creates, before it creates one.
  await page.addInitScript(() => {
    window.__wlPCs = [];
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const pc = new Native(...args);
      window.__wlPCs.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = Native.prototype;
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Some player frontends need a click to start. Harmless when they do not.
  try { await page.click('body', { timeout: 3000 }); } catch (_) {}

  // Let the connection settle AND let the encoder ramp. Sampling immediately
  // records the ramp-up, not the steady state, and reports a good link as bad.
  await page.waitForTimeout(SETTLE_MS);

  const stats = await page.evaluate(async () => {
    const out = {
      peerConnections: (window.__wlPCs || []).length,
      inbound: null, candidatePair: null, localCandidate: null,
      remoteCandidate: null, codec: null, error: null,
    };
    const pcs = window.__wlPCs || [];
    if (!pcs.length) { out.error = 'the page created no RTCPeerConnection'; return out; }

    for (const pc of pcs) {
      const report = await pc.getStats();
      const byId = new Map();
      report.forEach((s) => byId.set(s.id, s));
      report.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          out.inbound = {
            bytesReceived: s.bytesReceived, packetsReceived: s.packetsReceived,
            packetsLost: s.packetsLost, jitter: s.jitter,
            framesPerSecond: s.framesPerSecond, framesDecoded: s.framesDecoded,
            frameWidth: s.frameWidth, frameHeight: s.frameHeight,
            freezeCount: s.freezeCount, totalFreezesDuration: s.totalFreezesDuration,
            decoderImplementation: s.decoderImplementation, codecId: s.codecId,
          };
          const codec = byId.get(s.codecId);
          if (codec) out.codec = { mimeType: codec.mimeType, clockRate: codec.clockRate };
        }
        if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
          out.candidatePair = {
            currentRoundTripTime: s.currentRoundTripTime,
            availableIncomingBitrate: s.availableIncomingBitrate,
            bytesReceived: s.bytesReceived,
          };
          const l = byId.get(s.localCandidateId);
          const r = byId.get(s.remoteCandidateId);
          if (l) out.localCandidate = { type: l.candidateType, protocol: l.protocol, address: l.address };
          if (r) out.remoteCandidate = { type: r.candidateType, protocol: r.protocol, address: r.address };
        }
      });
      if (out.inbound) break;
    }
    return out;
  });

  // A second sample so bitrate is a RATE, not a total. One reading of
  // bytesReceived says nothing about throughput.
  const t0 = Date.now();
  const first = stats.inbound ? stats.inbound.bytesReceived : 0;
  await page.waitForTimeout(5000);
  const second = await page.evaluate(async () => {
    let bytes = 0, fps = null;
    for (const pc of (window.__wlPCs || [])) {
      const report = await pc.getStats();
      report.forEach((s) => {
        if (s.type === 'inbound-rtp' && s.kind === 'video') {
          bytes = s.bytesReceived; fps = s.framesPerSecond;
        }
      });
    }
    return { bytes, fps };
  });
  const seconds = (Date.now() - t0) / 1000;
  stats.measuredKbps = seconds > 0 ? Math.round(((second.bytes - first) * 8) / seconds / 1000) : null;
  stats.measuredFps = second.fps;
  stats.url = URL;

  console.log(JSON.stringify(stats, null, 2));
  await browser.close();
  process.exit(0);
})().catch((e) => {
  console.log(JSON.stringify({ error: String(e && e.message ? e.message : e) }, null, 2));
  process.exit(1);
});
