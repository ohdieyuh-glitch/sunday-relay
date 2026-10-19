import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

/**
 * PUBLIC CANON — what these two pages may and may not say.
 *
 * The outdated sites these replace presented a deprecated company, a banned
 * configuration name, a price, unreleased mechanics and a retired mascot. This
 * file is the reason that cannot drift back in quietly: it reads the shipped
 * HTML (every visible string, every attribute a crawler or screen reader
 * sees) and holds it to the canon.
 */

const SITES = ['iwonder', 'wonderland'] as const;
type Site = (typeof SITES)[number];

/** Everything a person or a crawler can read: text, plus alt/title/aria/meta and structured data. */
const readableOf = (doc: Document): string => {
  const attributes = Array.from(doc.querySelectorAll('*')).flatMap((el) =>
    ['alt', 'title', 'aria-label', 'content'].map((name) => el.getAttribute(name) ?? ''),
  );
  const ldJson = Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).map((s) => s.textContent ?? '');
  return [doc.title, doc.body.textContent ?? '', ...attributes, ...ldJson].join('\n').replace(/\s+/g, ' ');
};

const load = (site: Site) => {
  const html = readFileSync(join(__dirname, site, 'index.html'), 'utf8');
  const doc = new JSDOM(html).window.document;
  const readable = readableOf(doc);
  // The same page with its illustrative provider slots removed — the only place a vendor may be named.
  const bare = new JSDOM(html).window.document;
  bare.querySelectorAll('[data-providers]').forEach((node) => node.remove());
  return { html, doc, readable, outsideProviders: readableOf(bare) };
};

const FORBIDDEN: ReadonlyArray<readonly [RegExp, string]> = [
  [/aquala/i, 'Aquala is deprecated and is not the company'],
  [/sunday\s*relay/i, 'Sunday Relay is not the public product identity'],
  [/\bsunday\b/i, 'the Sunday family naming is retired'],
  [/alcatraz/i, 'Alcatraz is an internal product name'],
  [/\bpsp\b|project settings preset/i, 'C.A.R.D. is the only approved configuration name'],
  [/ship on sundays?/i, 'an unreleased marketplace'],
  [/cub pupp|battle pass|unchained|clan wars|relay legends|king romulus/i, 'unreleased or internal mechanics'],
  [/multi-agent orchestrat/i, 'Julius is a Compound AI Agent, not "multi-agent orchestration"'],
  [/\$\s?\d/, 'no prices or financial figures'],
  // Word-bounded: Project Brain holds "evaluations", which is not a valuation.
  [/net[-\s]?worth|\bvaluations?\b|revenue|funding/i, 'no financial claims'],
  [/\bI\.Wonder|\biWonder\b|I\.WONDER/, 'the brand is written i.Wonder'],
];

const REQUIRED_EVERYWHERE = [
  'i.Wonder', 'Wonderland', 'Julius', 'Compound AI Agent', 'Prompt Architect', 'Coding Agent',
  'Independent Reviewer', 'Project Brain', 'Multi-Agent Swarm', 'i.Wonder Laboratories, Inc.',
];

/**
 * Vendor names. The tiers are provider-independent, so a vendor is never the
 * subject of a sentence on either site. The company site may show providers
 * ONLY as illustrative, replaceable implementations inside a tier's slot
 * (`[data-providers]`); Wonderland names none at all.
 */
const VENDORS = /claude|anthropic|openai|chatgpt|\bgpt\b|codex|gemini|\bgrok\b|\bxai\b|llama|devin|cursor agent|copilot|windsurf|cascade|opencode|openhands|deepseek|hermes|\bpi agent\b/i;

describe.each(SITES)('%s — public canon', (site) => {
  const { readable, outsideProviders } = load(site);

  it.each(FORBIDDEN)('never says %s', (pattern, why) => {
    const match = readable.match(pattern);
    expect(match?.[0] ?? null, why).toBeNull();
  });

  it('names no vendor outside an illustrative provider slot', () => {
    expect(outsideProviders.match(VENDORS)?.[0] ?? null).toBeNull();
  });

  it('uses "Relay" only as the Relay Dog', () => {
    expect(readable.match(/\bRelay\b(?! Dog)/g) ?? []).toEqual([]);
  });

  it.each(REQUIRED_EVERYWHERE)('names %s', (term) => {
    expect(readable).toContain(term);
  });

  it('labels in-development work as in development', () => {
    expect(readable).toMatch(/in (active )?development/i);
  });
});

describe('wonderland — product specifics', () => {
  const { readable, doc } = load('wonderland');

  it('has no provider slots, so it names no vendor anywhere', () => {
    expect(doc.querySelectorAll('[data-providers]')).toHaveLength(0);
    expect(readable.match(VENDORS)?.[0] ?? null).toBeNull();
  });

  it('names the C.A.R.D. and never expands it', () => {
    expect(readable).toContain('C.A.R.D.');
    expect(readable).not.toMatch(/C\.A\.R\.D\.\s*\(/);
  });

  it('labels the concept art as concept art', () => {
    const figure = doc.querySelector('.wl-concept');
    expect(figure?.textContent).toMatch(/concept art/i);
    expect(figure?.textContent).toMatch(/not a screenshot/i);
  });
});

describe('iwonder — company specifics', () => {
  const { readable, outsideProviders, doc } = load('iwonder');
  const text = (selector: string) => (doc.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ');
  const scene = readFileSync(join(__dirname, 'iwonder', 'world-scene.ts'), 'utf8');

  it('leads with the company positioning, not the retired one', () => {
    const positioning = [
      'builds multiplayer open-world AI creation platforms',
      'researches, develops and deploys Compound AI Systems and Compound AI Agents',
    ];
    for (const phrase of positioning) {
      expect(doc.querySelector('meta[name="description"]')?.getAttribute('content')).toContain(phrase);
      expect(text('.iw-hero-lede')).toContain(phrase);
    }
    expect(readable).not.toMatch(/AI creation infrastructure|AI-native worlds?|infrastructure company/i);
  });

  it('names Wonderland the flagship platform and Julius the flagship Compound AI Agent', () => {
    expect(text('#wonderland')).toMatch(/flagship platform/i);
    expect(text('#julius')).toMatch(/flagship Compound AI Agent/i);
  });

  it('shows Julius as three tiers, each with its technology class, in order', () => {
    const cards = Array.from(doc.querySelectorAll('.iw-tiercard'));
    expect(cards.map((card) => card.querySelector('.iw-tiercard-name')?.textContent?.trim())).toEqual([
      'Prompt Architect', 'Coding Agent', 'Independent Reviewer',
    ]);
    expect(cards.map((card) => card.querySelector('.iw-tiercard-class')?.textContent?.trim())).toEqual([
      'Large Language Model', 'Agentic coding system', 'Independent agent harness / reviewer runtime',
    ]);
    expect(text('#julius')).toMatch(/not\s*one monolithic model/i);
    expect(text('#julius')).toMatch(/not\s*tied to any one AI vendor/i);
  });

  it('keeps every provider inside Julius, labelled illustrative and replaceable', () => {
    const slots = Array.from(doc.querySelectorAll('[data-providers]'));
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) expect(slot.closest('#julius'), slot.outerHTML.slice(0, 80)).not.toBeNull();
    expect(text('.iw-arch-note')).toMatch(/illustrative/i);
    expect(text('.iw-arch-note')).toMatch(/replaceable/i);
    expect(text('.iw-arch-note')).toMatch(/never dependencies of Julius/i);
    expect(outsideProviders).toMatch(/Third-party names are trademarks of their owners/);
  });

  it('defines Project Brain as the agent’s durable memory, not a project notebook', () => {
    const brain = text('#brain');
    expect(brain).toContain('Julius’s durable memory');
    expect(brain).toContain(
      'a persistent record of the actions, decisions, evidence, state and history accumulated by the Compound AI Agent throughout a mission or project',
    );
    expect(readable).not.toMatch(/durable memory of (a|the) project/i);
    for (const held of [
      'objectives', 'architecture', 'requirements', 'constraints', 'acceptance criteria', 'decisions', 'research',
      'evidence', 'evaluations', 'traces', 'provenance', 'handoffs', 'findings', 'repairs', 'mission state',
      'project state', 'actions taken by Julius',
    ]) {
      expect(brain.toLowerCase(), held).toContain(held.toLowerCase());
    }
  });

  it('does not put the Relay Dog on the company site', () => {
    expect(readable).not.toMatch(/relay dog/i);
    expect(scene).not.toMatch(/dog-mesh|buildDogMesh|DogAnimator/);
  });

  it('authors one camera shot per section', () => {
    const start = scene.indexOf('const LANDSCAPE');
    const table = scene.slice(start, scene.indexOf('];', start));
    const sections = doc.querySelectorAll('[data-scene]').length;
    expect(table.match(/\{ focus:/g)).toHaveLength(sections);
    for (const name of ['PORTRAIT_LIFT', 'PORTRAIT_STAGE', 'PORTRAIT_DISTANCE']) {
      const declaration = scene.slice(scene.indexOf(`const ${name} = [`));
      const values = declaration.slice(declaration.indexOf('[') + 1, declaration.indexOf(']')).split(',');
      expect(values, name).toHaveLength(sections);
    }
  });
});

describe.each(SITES)('%s — structure and integrity', (site) => {
  const { html, doc } = load(site);
  const UPPERCASE = ['pw-label', 'pw-ghost', 'pw-cta', 'pw-chip', 'pw-nav-link'];

  it('never renders the brand uppercased (I.WONDER)', () => {
    const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
    const offenders: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.includes('i.Wonder')) continue;
      for (let el = node.parentElement; el; el = el.parentElement) {
        if (el.classList.contains('pw-brandmark')) break;
        if (UPPERCASE.some((cls) => el.classList.contains(cls))) {
          offenders.push(el.outerHTML.slice(0, 120));
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has one h1, a language, a description and complete social metadata', () => {
    expect(doc.querySelectorAll('h1')).toHaveLength(1);
    expect(doc.documentElement.getAttribute('lang')).toBe('en');
    for (const selector of [
      'meta[name="description"]', 'link[rel="canonical"]', 'meta[property="og:title"]',
      'meta[property="og:description"]', 'meta[property="og:image"]', 'meta[property="og:url"]',
      'meta[name="twitter:card"]', 'link[rel="icon"]', 'meta[name="viewport"]',
    ]) {
      expect(doc.querySelector(selector), selector).not.toBeNull();
    }
    expect(doc.title.length).toBeGreaterThan(10);
  });

  it('uses only the three sanctioned URL placeholders', () => {
    const placeholders = new Set(html.match(/%[A-Z_]+%/g) ?? []);
    for (const placeholder of placeholders) {
      expect(['%IWONDER_URL%', '%WONDERLAND_URL%', '%APP_URL%']).toContain(placeholder);
    }
  });

  it('has no hard-coded external origins', () => {
    const external = Array.from(doc.querySelectorAll('[href], [src]'))
      .map((el) => el.getAttribute('href') ?? el.getAttribute('src') ?? '')
      .filter((url) => /^https?:/.test(url));
    expect(external).toEqual([]);
  });

  it('opens every external link in a new tab without an opener', () => {
    for (const link of Array.from(doc.querySelectorAll('a[href^="%"]'))) {
      expect(link.getAttribute('target'), link.outerHTML).toBe('_blank');
      expect(link.getAttribute('rel'), link.outerHTML).toContain('noopener');
    }
  });

  it('points every in-page link at a real section', () => {
    for (const link of Array.from(doc.querySelectorAll('a[href^="#"]'))) {
      const id = link.getAttribute('href')!.slice(1);
      expect(doc.getElementById(id), `#${id}`).not.toBeNull();
    }
  });

  it('gives every image alternative text and every control a name', () => {
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      expect(img.getAttribute('alt')?.length ?? 0).toBeGreaterThan(20);
    }
    for (const button of Array.from(doc.querySelectorAll('button'))) {
      expect(button.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });

  it('keys the stage to sections that exist', () => {
    expect(doc.querySelectorAll('[data-scene]').length).toBe(8);
  });
});
