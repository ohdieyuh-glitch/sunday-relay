// The Space key, tested against the three ways it goes wrong.
//
// Every case here is a bug this would otherwise ship: a terminal you cannot
// type a space into, a panel that flickers open and shut while you write, a
// page that scrolls out from under the world, and a Space that reaches the
// game and makes the Dog do something.
import { classifyKey, isTextEntry, shouldPreventDefault, shouldStopGameInput } from './keys.js';

let pass = 0;
const fail = [];
const ok = (cond, what) => { if (cond) pass += 1; else fail.push(what); };
const eq = (a, b, what) => ok(a === b, `${what}: expected ${b}, got ${a}`);

const world = { tagName: 'CANVAS', getAttribute: () => null };
const video = { tagName: 'VIDEO', getAttribute: () => null };
const input = { tagName: 'INPUT', getAttribute: () => null };
const area = { tagName: 'TEXTAREA', getAttribute: () => null };
const editable = { tagName: 'DIV', isContentEditable: true, getAttribute: () => null };
const textbox = { tagName: 'DIV', getAttribute: (a) => (a === 'role' ? 'textbox' : null) };
const K = (key, target, extra = {}) => ({ key, target, ...extra });

// --- what a space MEANS -----------------------------------------------------
// CTRL+T OPENS AND CLOSES; SPACE BELONGS TO THE DOG (founder, 2026-09-03).
// These three used to assert the opposite, and they are the reason the change
// is safe to make: the contract was written down, so replacing it is a visible
// edit rather than a silent drift.
eq(classifyKey(K('t', world, { ctrlKey: true }), false), 'open-terminal',
   'ctrl+T from the world opens the terminal');
eq(classifyKey(K('t', video, { ctrlKey: true }), false), 'open-terminal',
   'ctrl+T over the streamed video opens it');
eq(classifyKey(K('T', world, { ctrlKey: true, code: 'KeyT' }), false), 'open-terminal',
   'ctrl+T by code and by capital, for clients that report either');
eq(classifyKey(K('t', world, { ctrlKey: true }), true), 'close-terminal',
   'ctrl+T again closes it -- a toggle, which Space could never safely be');
eq(classifyKey(K('t', input, { ctrlKey: true }), true), 'close-terminal',
   'ctrl+T closes from INSIDE the terminal input: it is not a character there');
// Space must now reach the game, or the jump silently does nothing and this
// layer hides an engine-side regression.
eq(classifyKey(K(' ', world), false), 'pass', 'space goes to the game: it is the jump');
eq(classifyKey(K(' ', video), false), 'pass', 'space over the video goes to the game too');
eq(classifyKey(K(' ', world, { code: 'Space', key: 'Unidentified' }), false), 'pass',
   'space by code goes to the game as well');

// --- and what it must NEVER mean -------------------------------------------
for (const [name, t] of [['input', input], ['textarea', area],
                         ['contenteditable', editable], ['role=textbox', textbox]]) {
  eq(classifyKey(K(' ', t), true), 'type', `space inside ${name} types a space`);
  eq(classifyKey(K(' ', t), false), 'type', `space inside ${name} types a space even when closed`);
}

// The founder allows a Space toggle only where it cannot fight text entry.
// The terminal focuses its input on open, so a toggle could only ever fire
// after the participant clicked away -- an invisible, occasional close.
eq(classifyKey(K(' ', world), true), 'pass', 'space with the terminal open does not toggle');

// --- escape -----------------------------------------------------------------
eq(classifyKey(K('Escape', world), true), 'close-terminal', 'escape from the world closes it');
eq(classifyKey(K('Escape', input), true), 'close-terminal', 'escape from the input closes it too');
eq(classifyKey(K('Escape', world), false), 'pass', 'escape with nothing open is not ours');

// --- modifiers and everything else -----------------------------------------
eq(classifyKey(K(' ', world, { ctrlKey: true }), false), 'pass', 'ctrl+space is not ours');
eq(classifyKey(K(' ', world, { metaKey: true }), false), 'pass', 'cmd+space is not ours');
eq(classifyKey(K('w', world), false), 'pass', 'W still belongs to the world');
eq(classifyKey(K('Shift', world), false), 'pass', 'shift still belongs to the world');
eq(classifyKey(null, false), 'pass', 'a missing event is not a crash');

// --- the browser's own behaviour -------------------------------------------
ok(shouldPreventDefault('open-terminal'), 'opening suppresses the page scroll');
ok(shouldPreventDefault('close-terminal'), 'closing suppresses the default');
ok(!shouldPreventDefault('type'), 'TYPING IS NEVER PREVENTED -- this is the space character');
ok(!shouldPreventDefault('pass'), 'a key we do not claim is left alone');

// --- what the GAME is allowed to see ---------------------------------------
// Pixel Streaming forwards keys to Wonderland. Typing "walk south" into the
// terminal must not walk the Dog south, and the opening Space must not reach
// the engine at all.
ok(shouldStopGameInput('open-terminal', false), 'the opening space never reaches the game');
ok(shouldStopGameInput('close-terminal', true), 'the closing escape never reaches the game');
ok(shouldStopGameInput('type', true), 'typed characters never reach the game');
ok(shouldStopGameInput('pass', true), 'NOTHING reaches the game while the terminal is open');
ok(!shouldStopGameInput('pass', false), 'W reaches the game when the world has focus');

// --- the text-entry probe itself -------------------------------------------
ok(isTextEntry(input) && isTextEntry(area) && isTextEntry(editable) && isTextEntry(textbox),
   'every text surface is recognised');
ok(!isTextEntry(world) && !isTextEntry(video) && !isTextEntry(null),
   'the world is not a text surface');

console.log(`\npassed ${pass}, failed ${fail.length}`);
for (const f of fail) console.log(`  FAILED: ${f}`);
process.exit(fail.length ? 1 : 0);
