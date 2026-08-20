// Capture the founder hero frame from the Pixel Streaming player page.
//
// Why a browser at all: the engine's own FScreenshotRequest is a PHANTOM in
// this configuration — it returns success and writes no file. The only frame
// that can be trusted is the one that actually travelled the stream, so the
// capture happens on the receiving end.
//
// Why channel "chrome" and never the bundled Chromium: Playwright's Chromium
// build has NO H264 decoder. The stream negotiates, the page loads, the video
// element stays black, and nothing anywhere reports an error. That cost a full
// session to find. Real Chrome has the decoder.
'use strict';

const URL_ = process.argv[2] || 'http://127.0.0.1:8080/';
const OUT = process.argv[3] || 'wonderland.png';
const SETTLE_MS = parseInt(process.env.WL_SETTLE_MS || '12000', 10);

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('playwright is not installed. In the Studio:');
    console.error('  npm i -g playwright && npx playwright install chrome');
    process.exit(3);
  }

  const browser = await chromium.launch({
    channel: 'chrome',                 // NOT the bundled build - see above
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--no-sandbox',                  // Studios commonly run as root
      '--disable-dev-shm-usage',
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });

  page.on('console', (m) => {
    const t = m.text();
    if (/error|failed|ice|webrtc/i.test(t)) console.log('  [page]', t.slice(0, 160));
  });

  await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The PS2 player usually needs one gesture before it will play. Clicking the
  // centre of the page satisfies both the overlay and the autoplay policy;
  // doing it unconditionally is harmless when no overlay is present.
  try { await page.mouse.click(640, 360); } catch (_) {}
  await page.waitForTimeout(1500);
  try { await page.mouse.click(640, 360); } catch (_) {}

  // Wait for a video element that is actually DECODING, not merely present.
  // readyState alone lies: it goes to 4 on a stream that never paints.
  const playing = await page
    .waitForFunction(() => {
      const v = document.querySelector('video');
      return !!v && v.videoWidth > 0 && v.videoHeight > 0 && v.currentTime > 0;
    }, { timeout: 90000 })
    .then(() => true)
    .catch(() => false);

  if (!playing) {
    console.error('NO VIDEO: the page loaded but no frame ever decoded.');
    console.error('Check, in order: the streamer connected to signalling, TURN is');
    console.error('advertised in the signalling peer options, and this is real Chrome.');
  }

  // Auto-exposure needs real time to settle; grabbing the first frame gives a
  // washed or black image that then gets compared against the reference and
  // sends everyone chasing a lighting bug that does not exist.
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: OUT });
  console.log(playing ? `captured ${OUT}` : `captured ${OUT} (NO VIDEO - suspect)`);

  await browser.close();
  process.exit(playing ? 0 : 4);
})().catch((e) => {
  console.error('capture failed:', e && e.message ? e.message : e);
  process.exit(1);
});
