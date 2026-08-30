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
ok(/SUNDAY RELAY/.test(markup), 'the brand line is present');
ok(/wl-tm-light--r[\s\S]*wl-tm-light--y[\s\S]*wl-tm-light--g/.test(markup),
   'traffic-light chrome, in order');
ok(/&gt;_/.test(markup), 'the >_ prompt is present');
ok(/rgba\(11, 13, 18, 0\.82\)/.test(css), 'the panel is dark AND translucent');
ok(/backdrop-filter/.test(css), 'the world reads through the panel');
ok(/flex-direction: column/.test(css.split('.wl-tm-panels')[1] || ''),
   'the role sections are STACKED, not columns');
// The redesign the founder forbade would show up as these words.
for (const banned of ['tab', 'card', 'widget', 'accordion', 'carousel']) {
  const re = new RegExp(`class=["'][^"']*\\b${banned}`, 'i');
  ok(!re.test(markup), `no ${banned}s in the terminal markup`);
}

// --- the four sections, in the founder's order ------------------------------
const order = ['PROMPT ARCHITECT', 'CODING AGENT', 'INDEPENDENT REVIEWER', 'JULIUS'];
const idx = order.map((t) => js.indexOf(t));
ok(idx.every((i) => i >= 0), 'all four sections exist');
ok(idx.every((v, i) => i === 0 || v > idx[i - 1]), 'Julius is the band BELOW the workers');
ok(/JULIUS IS NOT A WORKER/i.test(js), 'the hierarchy is stated where it can be read');
ok(!/RELAY SYSTEM/.test(html + js), 'nothing is called RELAY SYSTEM any more');
ok(!/wl-tm-window/.test(html), 'index.html carries no second copy of the panel');
ok(/mount\.js/.test(html), 'and mounts the one that exists');

// --- space, escape, and the streamed game ----------------------------------
ok(/SPACE/.test(markup) && /LIVE TERMINAL/.test(markup), 'the page says Space is the terminal');
ok(/ESC/.test(markup), 'the page says Escape returns to the world');
ok(/does not jump/i.test(html), 'the page records that the Dog does not jump');
ok(/addEventListener\('keydown', onKeyDown, true\)/.test(js),
   'the keydown listener is CAPTURE PHASE -- it must beat the streaming client');
ok(/'keyup', 'keypress'/.test(js), 'key releases are withheld from the game too');
ok(/input\.focus\(/.test(js), 'opening focuses the input, so Space becomes a character');
ok(/preventScroll: true/.test(js), 'focus never scrolls the page');
ok(/overflow: hidden/.test(css), 'the page itself cannot scroll');

// --- honest state -----------------------------------------------------------
ok(/NO AUTHORITATIVE FEED CONNECTED/.test(markup),
   'the shipped markup starts in the honest state, not a live-looking one');
ok(/state = feedStatus\(\)/.test(js), 'the terminal boots cold');
ok(/Not sent: no authoritative Julius feed/.test(js),
   'a command with nowhere to go says so rather than being answered');
ok(!/RPG|quest|inventory|XP\b/i.test(html + js), 'no invented game output');
// The overlay must beat Epic's own UI layers, or Space opens a panel behind a control bar.
ok(/zIndex/.test(js), 'the overlay declares a stacking order over the stream client');

console.log(`\npassed ${pass}, failed ${fail.length}`);
for (const f of fail) console.log(`  FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
