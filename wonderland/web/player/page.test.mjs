// The page itself, checked for the things the founder specified by name.
//
// These are cheap string assertions and they are worth having anyway: every
// item here is a written instruction, and the way an approved design drifts
// is one reasonable-looking edit at a time.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, f), 'utf8');
const html = read('index.html');
const css = read('player.css');
// The panel's markup lives in mount.js (one copy, two pages); terminal.js
// owns the sections and the honest state.
const markup = read('mount.js');
const js = read('terminal.js') + read('mount.js') + read('overlay.js');

let pass = 0;
const fail = [];
const ok = (c, w) => { if (c) pass += 1; else fail.push(w); };

// --- the approved layout ----------------------------------------------------
ok(/RELAY AGENT LIVE TERMINAL/.test(markup), 'the title reads as the founder\'s reference');
// The traffic-light chrome belonged to a full-screen window. At HUD size the
// reference drops it for a title and a LIVE lamp, and three window-dressing
// dots would cost a fifth of the title row.
ok(!/wl-tm-light/.test(markup), 'no window chrome at HUD size');
ok(/wl-tm-live/.test(markup), 'a LIVE lamp instead');
ok(/&gt;_/.test(markup), 'the >_ prompt is present');
ok(/rgba\(11, 13, 18, 0\.8/.test(css), 'the panel is dark AND translucent');
ok(/backdrop-filter/.test(css), 'the world reads through the panel');
ok(/flex-direction: column/.test(css.split('.wl-tm-window')[1] || ''),
   'the panel stacks its rows');
// The redesign the founder forbade would show up as these words.
for (const banned of ['tab', 'card', 'widget', 'accordion', 'carousel']) {
  const re = new RegExp(`class=["'][^"']*\\b${banned}`, 'i');
  ok(!re.test(markup), `no ${banned}s in the terminal markup`);
}

// --- the three workers, and Julius above them ------------------------------
// The panel is a HUD element now, and at 27% of the viewport a stacked
// section per role is four headers with no room for what they hold. The
// founder's reference shows three WORKER chips with the orchestration layer
// speaking in the stream, which states the hierarchy better than a fourth
// equal box beside them.
const order = ['PROMPT ARCHITECT', 'CODING AGENT', 'INDEPENDENT REVIEWER'];
const idx = order.map((t) => js.indexOf(t));
ok(idx.every((i) => i >= 0), 'all three worker chips exist');
ok(idx.every((v, i) => i === 0 || v > idx[i - 1]), 'in the founder order');
ok(!/WORKERS = \[[\s\S]{0,400}JULIUS/i.test(js), 'JULIUS IS NOT ONE OF THE CHIPS');
ok(/Julius is deliberately absent/i.test(js), 'and the reason is stated where it can be read');
ok(/ROLE_LABEL/.test(read('feed.js')) && /Julius/.test(read('feed.js')),
   'Julius still speaks in the stream');
ok(!/RELAY SYSTEM/.test(html + js), 'nothing is called RELAY SYSTEM any more');

// --- the size the founder asked for ----------------------------------------
// Measured off their reference frame (1672 x 941): 39.2% wide, 27.3% tall,
// bottom-centred with a 3.1% margin. Fractions, so it holds at any viewport.
ok(/39\.2vw/.test(css), 'the panel is 39.2vw wide, as measured');
ok(/27\.3vh/.test(css), 'and 27.3vh tall');
ok(/3\.1vh/.test(css), 'and sits 3.1vh off the bottom');
ok(/inset: auto 0 3\.1vh 0/.test(css), 'anchored to the bottom, not filling the screen');
ok(/max\(420px/.test(css), 'with a pixel floor, because an unreadable panel is not a smaller one');
ok(/terminalSize = 'min'/.test(js), 'and it opens MINIMISED');

// --- space, escape, and the streamed game ----------------------------------
ok(/SPACE/.test(markup) && /LIVE TERMINAL/.test(markup), 'the page says Space is the terminal');
ok(/ESC/.test(html) || /Escape/.test(read('README.md')), 'Escape is documented');
ok(/does not jump/i.test(html), 'the page records that the Dog does not jump');
ok(/addEventListener\('keydown', onKeyDown, true\)/.test(js),
   'the keydown listener is CAPTURE PHASE -- it must beat the streaming client');
ok(/'keyup', 'keypress'/.test(js), 'key releases are withheld from the game too');
ok(/input\.focus\(/.test(js), 'opening focuses the input, so Space becomes a character');
ok(/preventScroll: true/.test(js), 'focus never scrolls the page');
ok(/overflow: hidden/.test(css), 'the page itself cannot scroll');

// AN OVERLAY INJECTED INTO SOMEONE ELSE'S PAGE CARRIES ITS OWN TYPE.
// Epic's <body> declares font-family: 'Montserrat' inline, and an inline
// style beats any stylesheet rule -- the approved terminal came up on the
// live link in the wrong typeface with nothing in the markup to explain it.
ok(/#wl-terminal, #wl-terminal \* \{[\s\S]{0,120}font-family/.test(css),
   'the terminal sets its own font on itself, not only on body');
ok(/#wl-hint \{[\s\S]{0,200}font-family/.test(css), 'and so does the hint');

// --- honest state -----------------------------------------------------------
ok(/'NO FEED'/.test(js) && /No authoritative Julius feed connected/.test(js),
   'the terminal starts in the honest state, not a live-looking one');
ok(/state = feedStatus\(\)/.test(js), 'the terminal boots cold');
ok(/Not sent: no authoritative Julius feed/.test(js),
   'a command with nowhere to go says so rather than being answered');
ok(!/RPG|quest|inventory|XP\b/i.test(html + js), 'no invented game output');
// The overlay must beat Epic's own UI layers, or Space opens a panel behind a control bar.
ok(/zIndex/.test(js), 'the overlay declares a stacking order over the stream client');

console.log(`\npassed ${pass}, failed ${fail.length}`);
for (const f of fail) console.log(`  FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
