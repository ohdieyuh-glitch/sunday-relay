import { chromium } from 'playwright-core';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const b = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('https://sunday-relay.vercel.app', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
const stage = () => p.evaluate(() => document.body.dataset.relayStage ?? '(unset)');
console.log('stage on landing      :', await stage());
await p.locator('button.rl3-cta').first().evaluate((el) => el.click());
// THE PASSAGE IS rAF-DRIVEN, and headless SwiftShader renders the whole scene in software -- so sample the stage
// over a long window rather than assuming the authored 2.4 s is wall-clock here.
for (const ms of [1000, 2000, 4000, 8000, 15000, 25000]) {
  await p.waitForTimeout(ms === 1000 ? 1000 : ms - (ms / 2));
  console.log(`  after ~${ms}ms: stage=${await stage()}  back=${await p.locator('button.rw-back').count()}  cta=${await p.locator('button.rl3-cta').count()}`);
}
console.log('--- deep link ---');
await p.goto('https://sunday-relay.vercel.app/#/relay', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
console.log('  stage=', await stage(), ' back=', await p.locator('button.rw-back').count(), ' cta=', await p.locator('button.rl3-cta').count());
console.log('  hash=', await p.evaluate(() => location.hash));
await b.close();
