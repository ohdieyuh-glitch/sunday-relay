/**
 * THE USAGE HUD, RENDERED TO A FILE A DESIGNER CAN OPEN.
 *
 * The HUD's shape is data (`WONDERLAND_USAGE_CHANNEL_SWOOSH`), and the whole
 * point of that is that the curve can be retouched without the data layer
 * moving. Retouching needs LOOKING, and the world it lives in needs a GPU and
 * a signed-in session — so this renders the real component, with the real
 * contract, to a static page.
 *
 * It is a viewer and not a fixture: every number comes from the module's own
 * labelled simulated tiers, and the HUD prints its own SIMULATED line, so
 * nothing here can be mistaken for a reading.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { WonderlandUsageHudView } from '../src/relay/ui/wonderland-hud/WonderlandUsageHudView';
import {
  WONDERLAND_USAGE_FIXTURE_TIERS,
  projectWonderlandUsageHud,
  wonderlandUsageFixture,
} from '../src/relay/mission/wonderland/wonderland-usage-meter';

/** A fixed instant: a simulated reading that refreshed its own clock would
 *  look more live than it is. */
const AT = '2026-01-01T00:00:00.000Z';

/**
 * The repository root: the working directory, because npm runs a script there.
 *
 * NOT `import.meta.url`, for two reasons. This file is bundled to CommonJS —
 * react-dom's server build is CJS and requires `stream` — and `import.meta`
 * does not exist there; the Bridge's tsconfig forbids it outright for the same
 * reason.
 *
 * And NOT a path computed by a runner script either. `relay-repository-boundary.mjs`
 * refuses a file run from package.json that builds a child command at runtime,
 * because a deployment-capable path has to be readable without executing it.
 * The first version of this preview had an `.mjs` wrapper calling
 * `execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), …)` and the scanner
 * was right about it. The bundle and the run are two literal commands in the
 * npm script now, and there is no wrapper left to analyse.
 */
const ROOT = resolve(process.cwd());

/**
 * Every combination worth looking at, INCLUDING the ones that are not pretty.
 *
 * A preview that only showed a healthy meter would be a preview of the case
 * that never needs design attention. An unreported meter and an exhausted one
 * are the states a founder will actually be staring at.
 */
const SCENES: readonly {
  readonly title: string;
  readonly compound: number | null;
  readonly single: number | null;
}[] = [
  { title: 'TYPICAL', compound: 186, single: 78 },
  { title: 'NEARLY SPENT', compound: 452, single: 116 },
  { title: 'UNTOUCHED', compound: 0, single: 0 },
  { title: 'NOTHING REPORTED', compound: null, single: null },
];

const compoundTier = WONDERLAND_USAGE_FIXTURE_TIERS.find(
  (tier) => tier.channel === 'compound_agent' && tier.capacityUnits ===
    Math.max(...WONDERLAND_USAGE_FIXTURE_TIERS.filter((t) => t.channel === 'compound_agent')
      .map((t) => t.capacityUnits)),
)!;
const singleTier = WONDERLAND_USAGE_FIXTURE_TIERS.find(
  (tier) => tier.channel === 'single_agent' && tier.capacityUnits ===
    Math.max(...WONDERLAND_USAGE_FIXTURE_TIERS.filter((t) => t.channel === 'single_agent')
      .map((t) => t.capacityUnits)),
)!;

const panel = (scene: (typeof SCENES)[number]): string => {
  const hud = projectWonderlandUsageHud({
    compoundAgent: wonderlandUsageFixture({
      channel: 'compound_agent',
      tierId: scene.compound === null ? 'no-such-tier' : compoundTier.tierId,
      usedUnits: scene.compound ?? 0,
      observedAtIso: AT,
    }),
    singleAgent: wonderlandUsageFixture({
      channel: 'single_agent',
      tierId: scene.single === null ? 'no-such-tier' : singleTier.tierId,
      usedUnits: scene.single ?? 0,
      observedAtIso: AT,
    }),
    observedAtIso: AT,
  });
  return `<section class="scene"><h2>${scene.title}</h2><div class="frame">${
    renderToStaticMarkup(
      <WonderlandUsageHudView
        hud={hud}
        reducedMotion
        instanceId={scene.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}
      />,
    )
  }</div></section>`;
};

const css = readFileSync(join(ROOT, 'src/relay/ui/wonderland-hud/wonderland-hud.css'), 'utf8');
const html = `<!doctype html><meta charset="utf-8">
<title>Wonderland usage HUD — preview</title>
<style>
  html,body{margin:0;background:#05070c;color:#c8d3e6;
    font:12px/1.6 'Fira Code',ui-monospace,monospace}
  main{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1px;
    background:#141b28}
  .scene{background:radial-gradient(120% 90% at 20% 15%,#152234 0%,#070b12 60%,#04060a 100%);
    padding:1.25rem 1.25rem 2rem}
  h2{margin:0 0 .5rem;font-size:10px;letter-spacing:.24em;color:#5d6b83;font-weight:400}
  .frame{position:relative;height:290px}
  .frame .wh{position:absolute;top:0;left:0;width:290px}
  footer{padding:1rem 1.25rem;color:#4d5a70;letter-spacing:.1em;font-size:10px}
${css}
</style>
<main>${SCENES.map(panel).join('')}</main>
<footer>SIMULATED FIXTURES · GEOMETRY AND PALETTE READ FROM
  src/relay/mission/wonderland/wonderland-usage-meter.ts · REGENERATE WITH
  npm run wonderland:hud:preview</footer>`;

mkdirSync(join(ROOT, 'generated'), { recursive: true });
const out = join(ROOT, 'generated/wonderland-hud-preview.html');
writeFileSync(out, html);
process.stdout.write(`wonderland hud preview -> ${out}\n`);
