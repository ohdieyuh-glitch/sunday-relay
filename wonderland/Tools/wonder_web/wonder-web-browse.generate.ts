/**
 * WONDER WEB'S PAGES — the sample web pages Julius browses inside Wonderland.
 *
 * FOUNDER DIRECTION (2026-09-17): "Wonder Web outside = Wonderland black/yellow shell. Website inside = normal real web
 * experience." So the shell is Wonderland's, and what is inside is ordinary web furniture -- a site bar, a profile, a
 * photo grid, a post with comments, search results, an inbox, an article, a cart. No sci-fi panels, no abstract
 * Wonderland UI inside the page.
 *
 * WHAT THIS IS NOT. Nothing here is fetched: there is no network in the simulation, and the shell says SIMULATED PAGE on
 * every tab. The pages are shaped like the real sites they are named after because that is what the founder asked to
 * see, and the content is the studio's own sample data -- not a copy of anyone's site, and not a logo.
 *
 * HOW TO REGENERATE (same convention as wonder-web-preview.generate.ts -- the name keeps vitest from collecting it):
 *   cp wonderland/Tools/wonder_web/wonder-web-browse.generate.ts wonderland/Tools/wonder_web/wonder-web-browse.generate.test.ts
 *   WONDER_WEB_BROWSE_OUT=wonderland/UiArt/WonderWeb/wonder-web-browse.json npx vitest run wonderland/Tools/wonder_web/wonder-web-browse.generate.test.ts
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** One row of an ordinary web list: a result, a message, a line of a cart. */
interface Row {
  readonly title: string;
  readonly meta?: string;
  readonly snippet?: string;
  readonly tint?: string;
}

/** A block of ordinary web furniture. The renderer draws each kind the way a website draws it. */
interface Block {
  readonly kind: 'site_bar' | 'profile' | 'grid' | 'post' | 'compose' | 'results' | 'list' | 'article' | 'cart' | 'footer';
  readonly brand?: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly text?: string;
  readonly meta?: string;
  readonly button?: string;
  readonly query?: string;
  readonly total?: string;
  readonly tint?: string;
  readonly height?: number;
  readonly likes?: number;
  readonly links?: readonly string[];
  readonly lines?: readonly string[];
  readonly cells?: readonly string[];
  readonly stats?: readonly string[];
  readonly rows?: readonly Row[];
}

interface Tab {
  readonly tabId: string;
  readonly title: string;
  readonly site: string;
  /** What the address bar reads while the sample page is drawn. Never fetchable. */
  readonly url: string;
  /**
   * The real page this tab stands for, loaded only in real mode and only if its host is allowed
   * (founder, 2026-09-17: "soon it should not be a simulation should be real"). Left out where a real page would need
   * the founder's own account: a mailbox is theirs to sign into, not ours to pretend at.
   */
  readonly real?: string;
  readonly letter: string;
  readonly blocks: readonly Block[];
}

const PHOTO = ['#C9D6E3', '#E7D8C9', '#D9E3C9', '#E3C9D6', '#CFC9E3', '#E3DDC9', '#C9E3DF', '#E0E0E0', '#D2C9E3'];

/**
 * The studio's own account. NOCTIS is Wonderland's content-creation nation (WorldDesign/CANON/nations.json), which is
 * what a Wonderland studio would put in its bio.
 */
const SOCIAL: Tab = {
  tabId: 'social',
  title: 'Instagram',
  site: 'Instagram',
  url: 'instagram.com/wonderland.studio',
  real: 'https://www.instagram.com/',
  letter: 'I',
  blocks: [
    { kind: 'site_bar', brand: 'Instagram', query: 'Search', links: ['Home', 'Explore', 'Reels', 'Messages', 'Profile'] },
    {
      kind: 'profile', title: 'wonderland.studio', subtitle: 'Wonderland Studio', tint: '#E7D8C9',
      stats: ['312 posts', '18.4k followers', '280 following'],
      lines: ['Creation studio in Wonderland · NOCTIS', 'Pixel Canvas · tools, art and small games', 'wonderland.studio/links'],
      button: 'Edit profile',
    },
    { kind: 'grid', cells: PHOTO },
    {
      kind: 'post', title: 'wonderland.studio', meta: '2 hours ago', tint: '#E7D8C9', height: 300, likes: 412,
      text: 'Pixel Canvas got a palette today. Sixteen by nine, five colours, one very patient dog.',
      rows: [
        { title: 'kai.builds', snippet: 'that yellow is perfect' },
        { title: 'judith.makes', snippet: 'the grid feels so good to click' },
        { title: 'tanish.dev', snippet: 'ship it' },
      ],
    },
    { kind: 'compose', text: 'Write a caption…', button: 'Post' },
    { kind: 'footer', text: 'Meta · About · Help · Press · API · Jobs · Privacy · Terms' },
  ],
};

const SEARCH: Tab = {
  tabId: 'search',
  title: 'Search',
  site: 'Google',
  url: 'www.google.com/search?q=pixel+canvas+palette+tokens',
  real: 'https://html.duckduckgo.com/html/?q=pixel+canvas+palette+tokens',
  letter: 'G',
  blocks: [
    { kind: 'site_bar', brand: 'Google', query: 'pixel canvas palette tokens', links: ['All', 'Images', 'Videos', 'News'] },
    { kind: 'results', meta: 'About 12,400 results (0.31 seconds)', rows: [
      { title: 'Design tokens — Wonderland Studio docs', meta: 'docs.wonderstudio.com › brand › design-tokens', snippet: 'The five palette colours, their names and where they may be used. Updated today.' },
      { title: 'Palette conventions for pixel grids', meta: 'www.smashingmagazine.com › 2026 › 04 › pixel-palettes', snippet: 'Why five colours is usually enough, and how to pick the fifth.' },
      { title: 'Pixel Canvas (Wonderland) — press kit', meta: 'wonderland.studio › press', snippet: 'Screenshots, logos and the short description, in one archive.' },
      { title: 'Colour tokens in practice - discussion', meta: 'news.ycombinator.com › item', snippet: '118 comments. "Tokens are only useful when the names outlive the hex."' },
    ] },
  ],
};

const MAIL: Tab = {
  tabId: 'mail',
  title: 'Inbox',
  site: 'Mail',
  url: 'mail.wonderstudio.com/inbox',
  letter: 'M',
  blocks: [
    { kind: 'site_bar', brand: 'Mail', query: 'Search mail', links: ['Inbox', 'Starred', 'Sent', 'Drafts', 'Archive'] },
    { kind: 'list', title: 'Inbox', meta: '4 unread', rows: [
      { title: 'Judith Okafor', meta: '09:41', snippet: 'Palette sign-off — the five colours look right to me, ship them.' },
      { title: 'Arden Supplies', meta: '08:02', snippet: 'Your order is ready to place — two items are waiting in your cart.' },
      { title: 'Kai Mensah', meta: 'Yesterday', snippet: 'Press kit — can we post the canvas picture today?' },
      { title: 'Wonderland Studio', meta: 'Yesterday', snippet: 'Weekly summary: 3 creations, 1 mission, 0 incidents.' },
    ] },
  ],
};

const DOCS: Tab = {
  tabId: 'docs',
  title: 'Design tokens',
  site: 'Docs',
  url: 'docs.wonderstudio.com/brand/design-tokens',
  real: 'https://en.wikipedia.org/wiki/Design_system',
  letter: 'D',
  blocks: [
    { kind: 'site_bar', brand: 'Wonderland Studio Docs', query: 'Search the docs', links: ['Brand', 'Tools', 'Missions', 'Changelog'] },
    { kind: 'article', title: 'Design tokens', subtitle: 'Updated today · Brand', lines: [
      'The palette is five colours and no more. Four are for drawing; the fifth is the ink everything else sits on.',
      'A token is named for what it does, never for what it looks like: canvas.ink outlives "near-black" the first time the ink changes.',
      'signal.yellow #FFD400 — the one saturated accent. Buttons, marks, the live line.',
      'sky.blue #3B9EFF — links, selection, anything cool and secondary.',
      'rose #FF4D8D — warnings that are not failures.',
      'jade #3DDC97 — done, connected, healthy.',
      'canvas.ink #05050A — the ground. Everything above is drawn on it.',
    ] },
  ],
};

const STORE: Tab = {
  tabId: 'store',
  title: 'Cart',
  site: 'Arden Supplies',
  url: 'shop.arden-supplies.com/cart',
  real: 'https://example.com/',
  letter: 'A',
  blocks: [
    { kind: 'site_bar', brand: 'Arden Supplies', query: 'Search products', links: ['Paper', 'Ink', 'Frames', 'Account', 'Cart (2)'] },
    { kind: 'cart', title: 'Your cart', total: '$46.00', button: 'Place order', rows: [
      { title: 'Archival print paper, A3', meta: 'Quantity 2', snippet: '$28.00' },
      { title: 'Pigment ink, warm black', meta: 'Quantity 1', snippet: '$18.00' },
    ], lines: ['Delivery Thursday 19 September', 'Pay on delivery'] },
    { kind: 'footer', text: 'Arden Supplies · Returns · Delivery · Contact' },
  ],
};

const MODEL = {
  schema: 'wonderland-wonder-web-browse.v1',
  /** Repeated by the shell on screen, on every tab. */
  notice: 'SAMPLE PAGES · SIMULATED BROWSING · NOTHING IS FETCHED AND NOTHING IS PUBLISHED',
  generated: 'wonderland/Tools/wonder_web/wonder-web-browse.generate.ts',
  tabs: [SOCIAL, SEARCH, MAIL, DOCS, STORE],
} as const;

describe('wonder web browse projection', () => {
  it('is three to five tabs of ordinary web pages, and says it is simulated', () => {
    expect(MODEL.tabs.length).toBeGreaterThanOrEqual(3);
    expect(MODEL.tabs.length).toBeLessThanOrEqual(5);
    expect(MODEL.notice).toMatch(/SIMULATED/);
    // Every tab is a site with an address and a page; every page starts with the site's own bar, like a website does.
    for (const tab of MODEL.tabs) {
      expect(tab.url).not.toMatch(/^https?:/);
      // A real address, where there is one, is https and nothing else.
      if ('real' in tab && tab.real !== undefined) {
        expect(tab.real).toMatch(/^https:\/\//);
      }
      expect(tab.blocks[0].kind).toBe('site_bar');
      expect(tab.blocks.length).toBeGreaterThanOrEqual(2);
      expect(tab.letter).toHaveLength(1);
    }
    // The founder's example is present and shaped like the real thing: profile, grid, post, comments, compose.
    const social = MODEL.tabs.find((t) => t.tabId === 'social')!;
    expect(social.url).toContain('instagram.com');
    expect(social.blocks.map((b) => b.kind)).toEqual(['site_bar', 'profile', 'grid', 'post', 'compose', 'footer']);
    expect(social.blocks.find((b) => b.kind === 'post')?.rows?.length).toBe(3);
    // The founder's example is the one that must also exist for real.
    expect(social.real).toBe('https://www.instagram.com/');
    // The mailbox has no real address: signing into an inbox is the person's own step, not something to imitate.
    expect(MODEL.tabs.find((t) => t.tabId === 'mail')?.real).toBeUndefined();
  });

  it('writes the projection', () => {
    const out = process.env.WONDER_WEB_BROWSE_OUT;
    expect(out, 'set WONDER_WEB_BROWSE_OUT to the output path').toBeTruthy();
    writeFileSync(out as string, `${JSON.stringify(MODEL, null, 1)}\n`, 'utf8');
  });
});
