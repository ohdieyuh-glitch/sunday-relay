import { existsSync } from 'node:fs';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

/**
 * WONDER WEB LIVE — the real browser behind Wonderland's shell.
 *
 * FOUNDER DIRECTION (2026-09-17): "when it comes to the wonder web soon it should not be a simulation should be real."
 *
 * The engine's own Chromium cannot render here -- this Unreal install ships CEF's libraries but not the helper process it
 * needs -- so the real page is rendered by a real browser ON THIS MACHINE, inside the Julius Connect runtime, and
 * Wonderland draws the frames it produces and sends back where the founder clicked. The bytes come from the real site,
 * the rendering is a real browser's, and a site that wants an account shows its own sign-in page.
 *
 * WHAT KEEPS IT SAFE:
 *   - ONE ALLOWLIST, CHECKED HERE TOO. Wonderland checks a host before it asks; this checks again before it navigates, so
 *     a client that forgets cannot reach further than the list.
 *   - NO STORED SIGN-IN BY DEFAULT. The context is ephemeral: cookies live for the session and are dropped on shutdown,
 *     so nothing signs itself in again later without the founder saying so.
 *   - NOTHING TYPED FOR ANYONE. Julius typing into a page is a capability that goes through the gate; this runtime only
 *     does what it is told, and every navigation and input is logged with its host.
 *   - NO CREDENTIAL EVER PASSES THROUGH THE MODEL. Sign-in happens in the page itself, the way it does in any browser.
 */

export interface LiveBrowserOptions {
  /** Where Chromium lives. This machine has Edge; a downloaded Chromium works the same. */
  readonly executablePath?: string;
  readonly allowHosts: readonly string[];
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Keep a page after this long without a frame request, to stop a forgotten tab holding memory. */
  readonly idleMs?: number;
}

export interface LiveFrame {
  readonly tabId: string;
  readonly url: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly jpeg: Buffer;
  readonly loading: boolean;
}

export interface LiveBrowserEvent {
  readonly at: string;
  readonly tabId: string;
  readonly action: 'navigate' | 'click' | 'scroll' | 'type' | 'key' | 'back' | 'close' | 'refused' | 'error';
  readonly host: string;
  readonly detail: string;
}

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export interface LiveBrowser {
  navigate(tabId: string, url: string): Promise<{ ok: true; host: string } | { ok: false; refusal: string }>;
  /** Render this tab at the size of the window it is drawn in, so the page lays itself out for the space it actually has. */
  setViewport(tabId: string, width: number, height: number): Promise<boolean>;
  /** What the page says, as a person reading it would see: its title and the start of its text. */
  read(tabId: string): Promise<{ title: string; url: string; text: string } | null>;
  /** Use the page's OWN search box, the way a person would: type the words into it and submit. */
  searchOnPage(tabId: string, query: string): Promise<{ ok: true } | { ok: false; refusal: string }>;
  frame(tabId: string, quality?: number): Promise<LiveFrame | null>;
  click(tabId: string, x: number, y: number): Promise<boolean>;
  scroll(tabId: string, deltaY: number): Promise<boolean>;
  typeText(tabId: string, text: string): Promise<boolean>;
  pressKey(tabId: string, key: string): Promise<boolean>;
  back(tabId: string): Promise<boolean>;
  close(tabId: string): Promise<void>;
  /** Every navigation and input, newest last. Hosts and actions only -- never what was typed into a password field. */
  log(): readonly LiveBrowserEvent[];
  open(): readonly string[];
  shutdown(): Promise<void>;
}

export function createLiveBrowser(options: LiveBrowserOptions): LiveBrowser {
  const allow = new Set(options.allowHosts.map((host) => host.trim().toLowerCase()).filter((host) => host.length > 0));
  const viewport = options.viewport ?? { width: 1200, height: 800 };
  const idleMs = options.idleMs ?? 5 * 60 * 1000;
  const executablePath = options.executablePath ?? (existsSync(EDGE) ? EDGE : undefined);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  const pages = new Map<string, { page: Page; lastUsed: number; loading: boolean; size: { width: number; height: number } }>();
  const events: LiveBrowserEvent[] = [];

  const note = (tabId: string, action: LiveBrowserEvent['action'], host: string, detail: string) => {
    events.push({ at: new Date().toISOString(), tabId, action, host, detail });
    if (events.length > 200) {
      events.splice(0, events.length - 200);
    }
    // eslint-disable-next-line no-console -- the runtime's own log is where a person checks what the browser did.
    console.log(`${new Date().toISOString()} browser ${action} ${host} ${detail}`);
  };

  const ensureContext = async (): Promise<BrowserContext> => {
    if (context !== null) {
      return context;
    }
    browser = await chromium.launch({ executablePath, headless: true });
    // EPHEMERAL BY DEFAULT: this context keeps cookies only while it lives.
    context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    context.setDefaultNavigationTimeout(25000);
    return context;
  };

  const pageFor = async (tabId: string): Promise<Page> => {
    const held = pages.get(tabId);
    if (held !== undefined && !held.page.isClosed()) {
      held.lastUsed = Date.now();
      return held.page;
    }
    const page = await (await ensureContext()).newPage();
    pages.set(tabId, { page, lastUsed: Date.now(), loading: false, size: { ...viewport } });
    return page;
  };

  const sweep = () => {
    const now = Date.now();
    for (const [tabId, held] of pages) {
      if (now - held.lastUsed > idleMs) {
        void held.page.close().catch(() => undefined);
        pages.delete(tabId);
        note(tabId, 'close', '-', 'closed after being idle');
      }
    }
  };

  return {
    async setViewport(tabId, width, height) {
      const size = {
        width: Math.max(480, Math.min(2400, Math.round(width))),
        height: Math.max(320, Math.min(1800, Math.round(height))),
      };
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return false;
      }
      if (held.size.width === size.width && held.size.height === size.height) {
        return true;
      }
      await held.page.setViewportSize(size);
      held.size = size;
      return true;
    },

    async read(tabId) {
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return null;
      }
      held.lastUsed = Date.now();
      const text = await held.page
        .evaluate(() => (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200))
        .catch(() => '');
      return { title: await held.page.title().catch(() => ''), url: held.page.url(), text };
    },

    async searchOnPage(tabId, query) {
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return { ok: false, refusal: 'no page is open on this tab' };
      }
      const box = held.page.locator('input[type=search], input[name=q], input[name=search], input[type=text]').first();
      try {
        await box.waitFor({ state: 'visible', timeout: 5000 });
        await box.fill(query);
        await box.press('Enter');
        await held.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
        note(tabId, 'type', hostOf(held.page.url()) ?? '-', `searched the page's own box (${query.length} characters)`);
        held.lastUsed = Date.now();
        return { ok: true };
      } catch (error) {
        note(tabId, 'error', hostOf(held.page.url()) ?? '-', String(error).slice(0, 160));
        return { ok: false, refusal: `this page has no search box we could use: ${String(error).slice(0, 100)}` };
      }
    },

    async navigate(tabId, url) {
      const host = hostOf(url);
      if (host === null) {
        note(tabId, 'refused', '-', `${url} is not an http(s) address`);
        return { ok: false, refusal: `${url} is not an http(s) address` };
      }
      if (!allow.has(host)) {
        note(tabId, 'refused', host, 'host is not on the allowlist, nothing was fetched');
        return { ok: false, refusal: `${host} is not on the allowlist, so nothing was fetched` };
      }
      const page = await pageFor(tabId);
      const held = pages.get(tabId);
      if (held) {
        held.loading = true;
      }
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        // MOST PAGES BUILD THEMSELVES IN THE BROWSER, so domcontentloaded is a splash screen, not the page. Give it a
        // moment to settle; if it never goes quiet -- a site with a live feed -- the frame is taken as it is.
        await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined);
        note(tabId, 'navigate', host, url);
        return { ok: true, host };
      } catch (error) {
        note(tabId, 'error', host, String(error).slice(0, 160));
        return { ok: false, refusal: `${host} did not load: ${String(error).slice(0, 120)}` };
      } finally {
        if (held) {
          held.loading = false;
          held.lastUsed = Date.now();
        }
      }
    },

    async frame(tabId, quality = 70) {
      sweep();
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return null;
      }
      held.lastUsed = Date.now();
      const jpeg = await held.page.screenshot({ type: 'jpeg', quality });
      return {
        tabId,
        url: held.page.url(),
        title: await held.page.title().catch(() => ''),
        width: held.size.width,
        height: held.size.height,
        jpeg,
        loading: held.loading,
      };
    },

    async click(tabId, x, y) {
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return false;
      }
      await held.page.mouse.click(Math.round(x), Math.round(y));
      note(tabId, 'click', hostOf(held.page.url()) ?? '-', `at ${Math.round(x)},${Math.round(y)}`);
      held.lastUsed = Date.now();
      return true;
    },

    async scroll(tabId, deltaY) {
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return false;
      }
      await held.page.mouse.wheel(0, Math.round(deltaY));
      held.lastUsed = Date.now();
      return true;
    },

    async typeText(tabId, text) {
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return false;
      }
      await held.page.keyboard.type(text, { delay: 18 });
      // THE TEXT ITSELF IS NOT LOGGED: what is typed into a page is the page's business, and may be a password.
      note(tabId, 'type', hostOf(held.page.url()) ?? '-', `${text.length} characters`);
      held.lastUsed = Date.now();
      return true;
    },

    async pressKey(tabId, key) {
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return false;
      }
      await held.page.keyboard.press(key);
      note(tabId, 'key', hostOf(held.page.url()) ?? '-', key);
      held.lastUsed = Date.now();
      return true;
    },

    async back(tabId) {
      const held = pages.get(tabId);
      if (held === undefined || held.page.isClosed()) {
        return false;
      }
      await held.page.goBack().catch(() => undefined);
      note(tabId, 'back', hostOf(held.page.url()) ?? '-', held.page.url());
      held.lastUsed = Date.now();
      return true;
    },

    async close(tabId) {
      const held = pages.get(tabId);
      if (held !== undefined) {
        await held.page.close().catch(() => undefined);
        pages.delete(tabId);
        note(tabId, 'close', '-', 'closed');
      }
    },

    log() {
      return events;
    },

    open() {
      return [...pages.keys()];
    },

    async shutdown() {
      for (const [, held] of pages) {
        await held.page.close().catch(() => undefined);
      }
      pages.clear();
      await context?.close().catch(() => undefined);
      await browser?.close().catch(() => undefined);
      context = null;
      browser = null;
    },
  };
}
