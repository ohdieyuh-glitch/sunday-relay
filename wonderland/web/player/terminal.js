// The Wonderland Live Terminal: DOM wiring only.
//
// Every decision worth arguing about lives in keys.js (who owns the keyboard)
// and feed.js (what may be shown). This file moves elements around and is
// deliberately dull, because the two files it calls are the ones under test.
import { classifyKey, shouldPreventDefault, shouldStopGameInput } from './keys.js';
import { feedStatus } from './feed.js';

// THE THREE WORKERS. Julius is deliberately absent from this list: it is the
// orchestration layer ABOVE them and it speaks in the stream as a role, which
// says the hierarchy better than a fourth equal box beside them did.
const WORKERS = [
  { key: 'architect', title: 'PROMPT ARCHITECT', glyph: '\u25C8' },
  { key: 'coding', title: 'CODING AGENT', glyph: '\u25C9' },
  { key: 'reviewer', title: 'INDEPENDENT REVIEWER', glyph: '\u25A3' },
];

// The stream keeps the most recent work. A mission is longer than a panel,
// and at this size it is much longer.
const STREAM_ROWS = 40;

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

function rowNode(row) {
  const li = document.createElement('li');
  li.className = 'wl-tmrow' + (row.state === 'open' ? '' : ` wl-tmrow--${row.state}`);
  const role = document.createElement('span');
  role.className = 'wl-tmrow-role';
  role.textContent = row.role.toUpperCase();
  li.append(role);
  if (row.operation) {
    const tag = document.createElement('span');
    tag.className = 'wl-tmrow-tag';
    tag.textContent = `[${row.operation.toUpperCase()}]`;
    li.append(tag);
  }
  if (row.at) {
    const time = document.createElement('span');
    time.className = 'wl-tmrow-time';
    time.textContent = row.at;
    li.append(time);
  }
  const msg = document.createElement('span');
  msg.className = 'wl-tmrow-msg';
  // One line. The detail joins the headline rather than taking a second row --
  // at 27% of the viewport a two-line entry halves how much history is visible.
  msg.textContent = row.detail ? `${row.headline}. ${row.detail}` : row.headline;
  li.append(msg);
  return li;
}

function render() {
  const live = el('wl-tm-live');
  if (live) {
    live.textContent = state.live ? 'LIVE' : 'NO FEED';
    live.classList.toggle('wl-tm-live--on', state.live);
    live.title = state.live ? (state.note || 'connected') : state.label;
  }
  const roles = el('wl-tm-roles');
  if (roles) {
    roles.textContent = '';
    for (const w of WORKERS) {
      const active = state.live && state.rows.some((r) => r.panel === w.key);
      const chip = document.createElement('span');
      chip.className = 'wl-tm-role' + (active ? ' wl-tm-role--active' : '');
      chip.title = !state.live ? state.label : (active ? 'active in this mission' : 'idle');
      const g = document.createElement('span');
      g.className = 'wl-tm-role-glyph';
      g.textContent = w.glyph;
      chip.append(g, document.createTextNode(w.title));
      roles.append(chip);
    }
  }
  const host = el('wl-tm-stream');
  if (!host) return;
  host.textContent = '';
  const rows = state.rows.slice(-STREAM_ROWS);
  if (!rows.length) {
    const p = document.createElement('li');
    p.className = 'wl-tm-empty';
    // The honest state, in one line because one line is what there is room for.
    p.textContent = state.live
      ? 'Connected. No activity in the current mission.'
      : 'No authoritative Julius feed connected. This terminal shows execution; it does not simulate it.';
    host.append(p);
    return;
  }
  for (const r of rows) host.append(rowNode(r));
  // A terminal shows its newest line.
  host.scrollTop = host.scrollHeight;
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
    const host = el('wl-tm-stream');
    if (host) {
      const p = document.createElement('li');
      p.className = 'wl-tm-empty';
      p.textContent = `Not sent: no authoritative Julius feed is connected. ("${text}")`;
      host.append(p);
      host.scrollTop = host.scrollHeight;
    }
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
export function claimKeyboard(root = window) {
  if (claimed) return;
  claimed = true;
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
  const expand = el('wl-tm-expand');
  if (expand) {
    expand.addEventListener('click', () => {
      const max = document.body.dataset.terminalSize === 'max';
      document.body.dataset.terminalSize = max ? 'min' : 'max';
      expand.setAttribute('aria-label', max ? 'Expand the terminal' : 'Shrink the terminal');
      const host = el('wl-tm-stream');
      if (host) host.scrollTop = host.scrollHeight;
    });
  }
  const input = el('wl-tm-input');
  if (input) {
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); submit(); }
    });
  }
  const world = el('wl-world');
  if (world) world.addEventListener('click', focusWorld);
  document.body.dataset.terminal = 'closed';
  // MINIMISED IS THE DEFAULT (founder, 2026-08-30). The panel is a HUD
  // element over a world you are standing in, not a page you read.
  document.body.dataset.terminalSize = 'min';
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
