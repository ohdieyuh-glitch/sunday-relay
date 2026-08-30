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
ok(!/RELAY AGENT LIVE TERMINAL/.test(markup), 'no title bar -- the reference has none');
// The traffic-light chrome belonged to a full-screen window. At HUD size the
// reference drops it for a title and a LIVE lamp, and three window-dressing
// dots would cost a fifth of the title row.
ok(!/wl-tm-light/.test(markup), 'no window chrome');
ok(!/wl-tm-expand/.test(markup), 'and no expand control -- that was mine, not the reference');
ok(/&gt;_/.test(markup), 'the >_ prompt is present -- the one row a terminal cannot do without');

ok(/backdrop-filter/.test(css), 'the world reads through the panel');
ok(/flex-direction: column/.test(css.split('.wl-tm-panels')[1] || ''),
   'the sections are STACKED, not columns');
// The redesign the founder forbade would show up as these words.
for (const banned of ['tab', 'card', 'widget', 'accordion', 'carousel']) {
  const re = new RegExp(`class=["'][^"']*\\b${banned}`, 'i');
  ok(!re.test(markup), `no ${banned}s in the terminal markup`);
}

// --- the four sections, in the founder's order -----------------------------
// Read off their reference: PROMPT ARCHITECT, CODING AGENT, the orchestration
// layer THIRD, then INDEPENDENT REVIEWER.
const order = ['PROMPT ARCHITECT', 'CODING AGENT', 'JULIUS', 'INDEPENDENT REVIEWER'];
const idx = order.map((t) => js.indexOf(`title: '${t}'`));
ok(idx.every((i) => i >= 0), 'all four sections exist');
ok(idx.every((v, i) => i === 0 || v > idx[i - 1]),
   'Julius sits THIRD -- between the workers that produce and the reviewer that checks');
ok(!/RELAY SYSTEM/.test(html + js), 'nothing is called RELAY SYSTEM any more');
ok(/wl-tmpanel-state/.test(js) && /wl-tmpanel-status/.test(js),
   'each header states its state twice, beside the name and again on the right');
ok(/wl-tmrow-sub/.test(js), 'the detail is its own dim line under the headline');

// --- the size the founder asked for, kept ----------------------------------
ok(/39\.2vw/.test(css), 'the panel is 39.2vw wide, as measured');
ok(/27\.3vh/.test(css), 'and 27.3vh tall');
ok(/inset: auto 0 3\.1vh 0/.test(css), 'anchored to the bottom, not filling the screen');
ok(/max\(420px/.test(css), 'with a pixel floor, because an unreadable panel is not a smaller one');
// The transparency is the one thing from my version the founder kept.
ok(/rgba\(11, 13, 18, 0\.72\)/.test(css), 'the sections keep the dark translucent fill');
ok(/backdrop-filter/.test(css), 'and the world still reads through them');
// The sections are the frames; there is no box around the boxes.
// THE RECTANGULAR OUTLINE. One panel with four sections inside it, not four
// panels floating on the world -- it is what makes the terminal read as a
// single instrument.
const win = css.slice(css.indexOf('.wl-tm-window {'), css.indexOf('/* ------------------------------------------------ the four'));
ok(/border: 1px solid var\(--wl-gold-dim\)/.test(win), 'the terminal has its outer outline');
ok(/border-radius/.test(win), 'rounded, as the reference is');
ok(/rgba\(9, 11, 15, 0\.58\)/.test(win), 'its fill is lighter than the sections, so they sit ON it');
ok(/backdrop-filter/.test(win), 'and the world still reads through it');

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
ok(/'WAITING'/.test(js), 'and WAITING means connected-but-idle, which is a different thing');
ok(/state = feedStatus\(\)/.test(js), 'the terminal boots cold');
ok(/Not sent: no authoritative Julius feed/.test(js),
   'a command with nowhere to go says so rather than being answered');
ok(!/RPG|quest|inventory|XP\b/i.test(html + js), 'no invented game output');
// The overlay must beat Epic's own UI layers, or Space opens a panel behind a control bar.
ok(/zIndex/.test(js), 'the overlay declares a stacking order over the stream client');

console.log(`\npassed ${pass}, failed ${fail.length}`);
for (const f of fail) console.log(`  FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
