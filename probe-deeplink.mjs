import { chromium } from 'playwright-core';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const b = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--enable-unsafe-swiftshader'] });
for (const host of ['https://sunday-relay.vercel.app', 'https://iwonder-three.vercel.app']) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await p.goto(`${host}/#/relay`, { waitUntil: 'domcontentloaded' });
    // A fresh context each time, and a longer settle: the earlier miss was the third run in one browser.
    await p.waitForTimeout(9000);
    const stage = await p.evaluate(() => document.body.dataset.relayStage ?? '(unset)');
    const back = await p.locator('button.rw-back').count();
    const cta = await p.locator('button.rl3-cta').count();
    let returned = '-';
    if (back > 0) {
      await p.locator('button.rw-back').first().evaluate((el) => el.click());
      await p.waitForTimeout(4000);
      returned = String(await p.locator('button.rl3-cta').count());
    }
    console.log(`  ${host.replace('https://','')} attempt ${attempt}: stage=${stage} back=${back} cta=${cta} returned_cta=${returned}`);
    await p.context().close();
  }
}
await b.close();
