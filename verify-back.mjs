// Verify ENTER RELAY -> BACK on the ACTUAL PUBLIC Wonderland sites.
//
// Grepping the bundle for `rw-back` proves the code shipped; it proves nothing about whether the control appears,
// whether it returns, or whether the journey home runs. So this drives a real browser against the real URL and
// asserts what a person would check by hand -- including the two cases that are easy to ship broken: a deep link
// (no outward journey to retrace) and no WebGL (no frame loop to run a passage with).
import { chromium } from 'playwright-core';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const results = [];
function note(site, check, pass, detail = '') {
  results.push({ site, check, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${check}${detail ? `  — ${detail}` : ''}`);
}

async function findBack(page) {
  // The control's accessible name is deliberately not ENTER RELAY, so look for it by its own name.
  const byRole = page.locator('button.rw-back');
  return (await byRole.count()) > 0 ? byRole.first() : null;
}

async function enterRelay(page) {
  const cta = page.locator('button.rl3-cta').first();
  await cta.waitFor({ state: 'visible', timeout: 15000 });
  await cta.evaluate((el) => el.click());
  // The authored passage is ~2.4 s; wait past it rather than racing it.
  await page.waitForTimeout(7000);
}

async function run(browser, url, viewport, label, opts = {}) {
  const context = await browser.newContext({
    viewport,
    // The site is a single WebGL scene; a desktop UA on a phone viewport is the honest mobile test here.
    ...(opts.noWebgl ? { javaScriptEnabled: true } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });

  if (opts.noWebgl) {
    // FORCE THE STATIC PATH. With no context the hook arrives immediately instead of flying, and BACK must still
    // work -- that branch is the one a machine without a GPU actually takes.
    await page.addInitScript(() => {
      const deny = function () { return null; };
      HTMLCanvasElement.prototype.getContext = deny;
    });
  }

  const site = `${label} ${viewport.width}x${viewport.height}${opts.noWebgl ? ' no-webgl' : ''}${opts.deepLink ? ' deep-link' : ''}`;
  console.log(`\n=== ${site} ===`);
  const target = opts.deepLink ? `${url}/#/relay` : url;
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3500);

  note(site, 'page loads', (response?.status() ?? 0) < 400, `http ${response?.status()}`);

  if (opts.deepLink) {
    // A DEEP LINK LANDS STRAIGHT IN RELAY, with no passage. BACK must be there and must return immediately,
    // because there is no outward journey to retrace.
    const back = await findBack(page);
    note(site, 'BACK visible on a deep link', back !== null);
    if (back) {
      await back.evaluate((el) => el.click());
      await page.waitForTimeout(4000);
      const cta = await page.locator('button.rl3-cta').count();
      note(site, 'BACK returns to the landing state', cta > 0, `${cta} ENTER RELAY control(s)`);
    }
  } else {
    const ctaBefore = await page.locator('button.rl3-cta').count();
    note(site, 'landing shows ENTER RELAY', ctaBefore > 0, `${ctaBefore} found`);

    const backBefore = await findBack(page);
    // A Back that is present but inert on the landing page is a control users learn to distrust.
    note(site, 'no BACK on the landing page', backBefore === null);

    await enterRelay(page);
    const ctaAfter = await page.locator('button.rl3-cta').count();
    note(site, 'ENTER RELAY reaches the Relay state', ctaAfter === 0, `${ctaAfter} ENTER RELAY control(s) remain`);

    const back = await findBack(page);
    note(site, 'BACK visible after entering', back !== null);

    if (back) {
      await back.evaluate((el) => el.click());
      // The return retraces the same ~2.4 s passage.
      await page.waitForTimeout(7000);
      const ctaHome = await page.locator('button.rl3-cta').count();
      note(site, 'BACK returns to the landing state', ctaHome > 0, `${ctaHome} ENTER RELAY control(s)`);
      const backHome = await findBack(page);
      note(site, 'BACK is gone again on the landing page', backHome === null);
    }
  }

  const real = errors.filter((e) => !/favicon|404|net::ERR_|WebGLRenderer/i.test(e));
  note(site, 'no page errors', real.length === 0, real.slice(0, 2).join(' | ') || 'none');
  await context.close();
}

const urls = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--enable-unsafe-swiftshader'] });
for (const url of urls) {
  const label = new URL(url).host;
  await run(browser, url, DESKTOP, label);
  await run(browser, url, MOBILE, label);
  await run(browser, url, DESKTOP, label, { deepLink: true });
  await run(browser, url, DESKTOP, label, { noWebgl: true });
}
await browser.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
for (const f of failed) console.log(`  FAIL  ${f.site}: ${f.check}  ${f.detail}`);
process.exit(failed.length === 0 ? 0 : 1);
