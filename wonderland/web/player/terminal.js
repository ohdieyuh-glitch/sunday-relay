// The Wonderland Live Terminal: DOM wiring only.
//
// Every decision worth arguing about lives in keys.js (who owns the keyboard)
// and feed.js (what may be shown). This file moves elements around and is
// deliberately dull, because the two files it calls are the ones under test.
import { classifyKey, shouldPreventDefault, shouldStopGameInput } from './keys.js';
import { feedStatus } from './feed.js';

// THE FOUR SECTIONS, IN THE FOUNDER'S ORDER.
//
// Read off their reference frame: PROMPT ARCHITECT, CODING AGENT, then the
// orchestration layer, then INDEPENDENT REVIEWER. Julius sits THIRD -- between
// the workers that produce and the reviewer that checks them -- which is
// where a controller belongs in a run, and it is not the order I had.
const SECTIONS = [
  { key: 'architect', title: 'PROMPT ARCHITECT' },
  { key: 'coding', title: 'CODING AGENT' },
  { key: 'julius', title: 'JULIUS' },
  { key: 'reviewer', title: 'INDEPENDENT REVIEWER' },
];

//: What a section says when it has nothing to report. The reference gives the
//: reviewer its own line -- it is not idle, it is waiting on a verification
//: that has not happened -- and that distinction is worth keeping.
const RESTING = {
  architect: 'No activity yet.',
  coding: 'No activity yet.',
  julius: 'No activity yet.',
  reviewer: 'Reviewer: Independent review begins after Julius verification.',
};

// Each section keeps its most recent work; the list scrolls when the panel
// cannot hold all four at once.
const ROWS_PER_SECTION = 4;

const el = (id) => document.getElementById(id);

/** The element the stream renders into. Set by mount(); falls back to the id. */
let worldEl = null;
export function setWorld(node) { worldEl = node; }
let open = false;
let state = feedStatus();          // starts cold, on purpose

/** The world is focusable, so "world focus" is something the browser agrees with. */
function focusWorld() {
  // BY REFERENCE, NOT BY ID. Epic's stream container already HAS an id, so
  // renaming it would break the client's own lookups and not renaming it left
  // this returning null -- Escape then handed focus to nothing and the next
  // Space was swallowed by whatever the client had focused.
  const world = worldEl || el('wl-world');
  if (world && typeof world.focus === 'function') world.focus({ preventScroll: true });
}

function openTerminal() {
  if (open) return;
  open = true;
  document.body.dataset.terminal = 'open';
  const input = el('wl-tm-input');
  // Focus the input in the same tick: from this moment Space is a character,
  // which is the whole reason the shortcut is world-focus-only.
  if (input) input.focus({ preventScroll: true });
  render();
}

function closeTerminal() {
  if (!open) return;
  open = false;
  document.body.dataset.terminal = 'closed';
  focusWorld();
}

function rowNode(row, withDetail) {
  const li = document.createElement('li');
  li.className = 'wl-tmrow' + (row.state === 'open' ? '' : ` wl-tmrow--${row.state}`);
  const head = document.createElement('div');
  head.className = 'wl-tmrow-head';
  const dot = document.createElement('span');
  dot.className = 'wl-tmrow-dot';
  dot.textContent = '\u25CF';
  head.append(dot);
  if (row.at) {
    const time = document.createElement('span');
    time.className = 'wl-tmrow-time';
    time.textContent = row.at;
    head.append(time);
  }
  const role = document.createElement('span');
  role.className = 'wl-tmrow-role';
  role.textContent = `${row.role}:`;
  const msg = document.createElement('span');
  msg.className = 'wl-tmrow-msg';
  msg.textContent = row.headline;
  head.append(role, msg);
  li.append(head);
  // The detail is its own dim line under the headline, indented past the
  // bullet -- the reference's "Mission Contract accepted at revision 1."
  //
  // ONLY IN THE SECTION THAT IS WORKING, which is what the reference shows:
  // three of its four boxes carry one body line and the live one carries two.
  // Give every section a sub-line and the four of them no longer fit in the
  // height the founder asked for -- the last one loses its body entirely.
  if (row.detail && withDetail) {
    const sub = document.createElement('div');
    sub.className = 'wl-tmrow-sub';
    sub.textContent = row.detail;
    li.append(sub);
  }
  return li;
}

function render() {
  const host = el('wl-tm-panels');
  if (!host) return;
  host.textContent = '';
  // The section that owns the newest event is the one currently working.
  const newest = state.rows.length ? state.rows[state.rows.length - 1].panel : null;
  for (const section of SECTIONS) {
    const all = state.rows.filter((r) => r.panel === section.key);
    const rows = all.slice(-ROWS_PER_SECTION);
    const live = state.live && all.length > 0;
    // THE HEADER STATES THE SAME THING TWICE, AS THE REFERENCE DOES: a
    // bracketed state beside the name and the word again on the right. With
    // no feed at all it says so rather than reading as a connected mission
    // that happens to be quiet.
    const word = !state.live ? 'NO FEED' : (live ? 'LIVE' : 'WAITING');
    const box = document.createElement('section');
    box.className = 'wl-tmpanel' + (live ? ' wl-tmpanel--live' : '');
    const head = document.createElement('div');
    head.className = 'wl-tmpanel-head';
    const sq = document.createElement('span');
    sq.className = 'wl-tmpanel-sq';
    sq.textContent = '\u25A0';
    const title = document.createElement('h2');
    title.className = 'wl-tmpanel-title';
    title.textContent = section.title;
    const st = document.createElement('span');
    st.className = 'wl-tmpanel-state';
    st.textContent = `[${word}]`;
    const right = document.createElement('span');
    right.className = 'wl-tmpanel-status';
    right.textContent = word;
    head.append(sq, title, st, right);
    box.append(head);
    if (rows.length) {
      const ul = document.createElement('ul');
      ul.className = 'wl-tmpanel-feed';
      for (const r of rows) ul.append(rowNode(r, section.key === newest));
      box.append(ul);
    } else {
      const p = document.createElement('p');
      p.className = 'wl-tmpanel-empty';
      p.textContent = state.live
        ? RESTING[section.key]
        : 'No authoritative Julius feed connected.';
      box.append(p);
    }
    host.append(box);
  }
}

/**
 * Connect a source of authoritative execution events.
 *
 * Nothing calls this yet from inside Wonderland: the Relay bridge feed is the
 * next piece of work, and until it exists the terminal says so rather than
 * pretending. `window.wonderlandTerminal.connect(...)` is the seam it will
 * arrive through, and takes already-normalised Relay events.
 */
function connect(source, events) {
  state = feedStatus({ connected: true, source, events: events || [] });
  render();
}

function submit() {
  const input = el('wl-tm-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  // WITHOUT A CONNECTED JULIUS THERE IS NOWHERE FOR THIS TO GO, and inventing
  // a reply is precisely the failure the founder named. Say what happened.
  if (!state.live) {
    // NOWHERE TO SEND IT IS SOMETHING TO SAY, not something to answer.
    const box = document.querySelector('.wl-tmpanel .wl-tmpanel-empty');
    if (box) box.textContent = `Not sent: no authoritative Julius feed is connected. ("${text}")`;
    return;
  }
  window.dispatchEvent(new CustomEvent('wonderland:terminal-submit', { detail: { text } }));
}

function onKeyDown(ev) {
  const verdict = classifyKey(ev, open);
  if (shouldPreventDefault(verdict)) ev.preventDefault();
  if (shouldStopGameInput(verdict, open)) stop(ev);
  if (verdict === 'open-terminal') openTerminal();
  else if (verdict === 'close-terminal') closeTerminal();
}

/** stopImmediatePropagation, so a client listener on the SAME target is cut
 *  off too -- plain stopPropagation only stops the next target down. */
function stop(ev) {
  ev.stopPropagation();
  if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
}

let claimed = false;

/**
 * Take the keyboard. NO DOM REQUIRED, AND THAT IS THE POINT.
 *
 * Listeners on the same target in the same phase fire in REGISTRATION ORDER,
 * so a streaming client that binds window-capture before us cannot be stopped
 * by any amount of stopImmediatePropagation -- its handler has already run.
 * The only defence is to register first, which means at module evaluation,
 * before the client's script has run and long before the panel exists.
 *
 * Proven by wonderland/web/player/capture.mjs against a page that registers
 * keydown on window (both phases) and document capture BEFORE this module: it
 * forwarded the opening Space and every character of "walk south" to the game
 * until this ran first.
 */
/**
 * Ask the browser for the keys it normally keeps.
 *
 * Ctrl+T is the founder's canonical Live Terminal chord and Chrome reserves it
 * for "new tab": in a normal tab the keydown is never dispatched to the page,
 * so no listener and no preventDefault can reach it. The Keyboard Lock API is
 * the documented way to receive reserved chords, and it only takes effect
 * while the document is FULLSCREEN -- which is how the world is played anyway.
 *
 * Best-effort by design: unsupported browser, no fullscreen, or a rejected
 * promise all just mean Ctrl+T stays with the browser and backquote carries
 * the terminal instead. It must never throw into the caller, because failing
 * to get a nice-to-have key is not a reason for the page not to load.
 */
function lockReservedKeys() {
  try {
    const kb = navigator.keyboard;
    if (!kb || typeof kb.lock !== 'function') return;
    if (document.fullscreenElement) {
      kb.lock(['KeyT']).catch(() => {});
    } else if (typeof kb.unlock === 'function') {
      kb.unlock();
    }
  } catch (_) { /* the terminal still has backquote */ }
}

export function claimKeyboard(root = window) {
  if (claimed) return;
  claimed = true;
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('fullscreenchange', lockReservedKeys);
    lockReservedKeys();
  }
  root.addEventListener('keydown', onKeyDown, true);
  for (const type of ['keyup', 'keypress']) {
    root.addEventListener(type, (ev) => {
      if (shouldStopGameInput('pass', open)) stop(ev);
    }, true);
  }
}

export function install(root = window) {
  // The keyboard may already be claimed (overlay.js claims it at module
  // evaluation, before the panel exists); claimKeyboard is idempotent.
  claimKeyboard(root);
  const input = el('wl-tm-input');
  if (input) {
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    });
  }
  const world = el('wl-world');
  if (world) world.addEventListener('click', focusWorld);
  document.body.dataset.terminal = 'closed';
  render();
  focusWorld();
  return { open: openTerminal, close: closeTerminal, connect, isOpen: () => open };
}

// Auto-install ONLY when the markup is already on the page (index.html).
// The Pixel Streaming frontend has no markup of its own, so mount.js builds it
// first and calls install() itself; auto-installing on import would run
// against an empty document and bind nothing.
if (typeof document !== 'undefined' && document.getElementById('wl-terminal')) {
  window.wonderlandTerminal = install();
}
