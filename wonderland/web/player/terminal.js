// The Wonderland Live Terminal: DOM wiring only.
//
// Every decision worth arguing about lives in keys.js (who owns the keyboard)
// and feed.js (what may be shown). This file moves elements around and is
// deliberately dull, because the two files it calls are the ones under test.
import { classifyKey, shouldPreventDefault, shouldStopGameInput } from './keys.js';
import { feedStatus } from './feed.js';

const SECTIONS = [
  { key: 'architect', title: 'PROMPT ARCHITECT' },
  { key: 'coding', title: 'CODING AGENT' },
  { key: 'reviewer', title: 'INDEPENDENT REVIEWER' },
  // JULIUS IS LAST AND JULIUS IS NOT A WORKER. It is the orchestration layer
  // above the three roles above it, and it reads as the system band under
  // them rather than a fourth slot beside them.
  { key: 'julius', title: 'JULIUS' },
];

const ROWS_PER_SECTION = 4;

const el = (id) => document.getElementById(id);
let open = false;
let state = feedStatus();          // starts cold, on purpose

/** The world is focusable, so "world focus" is something the browser agrees with. */
function focusWorld() {
  const world = el('wl-world');
  if (world) world.focus({ preventScroll: true });
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
  const sq = document.createElement('span');
  sq.className = 'wl-tmrow-square';
  sq.textContent = row.state === 'done' || row.state === 'evidence' ? '✓' : '■';
  const time = document.createElement('span');
  time.className = 'wl-tmrow-time';
  time.textContent = row.at;
  const main = document.createElement('div');
  main.className = 'wl-tmrow-main';
  const head = document.createElement('p');
  head.className = 'wl-tmrow-headline';
  const role = document.createElement('span');
  role.className = 'wl-tmrow-role';
  role.textContent = `${row.role}: `;
  head.append(role, document.createTextNode(row.headline));
  main.append(head);
  if (row.detail) {
    const d = document.createElement('p');
    d.className = 'wl-tmrow-detail';
    d.textContent = row.detail;
    main.append(d);
  }
  li.append(sq, time, main);
  if (row.operation) {
    const op = document.createElement('span');
    op.className = 'wl-tmrow-op';
    op.textContent = row.operation;
    li.append(op);
  }
  return li;
}

function render() {
  const live = el('wl-tm-live');
  if (live) {
    live.textContent = state.live ? '● LIVE' : `○ ${state.label}`;
    live.classList.toggle('wl-tm-live--on', state.live);
  }
  const note = el('wl-tm-note');
  if (note) note.textContent = state.note || '';
  const host = el('wl-tm-panels');
  if (!host) return;
  host.textContent = '';
  for (const section of SECTIONS) {
    const all = state.rows.filter((r) => r.panel === section.key);
    // A MISSION IS LONGER THAN A SCREEN. Uncapped, one busy role pushes the
    // sections below it off the bottom -- which is how JULIUS, the last
    // section, disappears. Each role shows its most recent work and says how
    // much came before, so all four stay visible for any feed length.
    const rows = all.slice(-ROWS_PER_SECTION);
    const earlier = all.length - rows.length;
    const box = document.createElement('section');
    box.className = 'wl-tmpanel';
    const head = document.createElement('div');
    head.className = 'wl-tmpanel-head';
    const title = document.createElement('h2');
    title.className = 'wl-tmpanel-title';
    title.textContent = section.title;
    const status = document.createElement('span');
    status.className = 'wl-tmpanel-status';
    // An honest per-section status: a role with no authoritative events is
    // IDLE, and with no feed at all it is simply not reporting.
    status.textContent = !state.live ? 'NOT REPORTING' : (rows.length ? 'ACTIVE' : 'IDLE');
    head.append(title, status);
    box.append(head);
    if (rows.length) {
      const ul = document.createElement('ul');
      ul.className = 'wl-tmpanel-feed';
      for (const r of rows) ul.append(rowNode(r));
      box.append(ul);
      if (earlier > 0) {
        const more = document.createElement('p');
        more.className = 'wl-tmpanel-empty';
        more.textContent = `+${earlier} earlier step${earlier === 1 ? '' : 's'}`;
        box.append(more);
      }
    } else {
      const p = document.createElement('p');
      p.className = 'wl-tmpanel-empty';
      p.textContent = state.live
        ? 'No activity from this role in the current mission.'
        : 'Awaiting an authoritative Julius feed.';
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
    const note = el('wl-tm-note');
    if (note) note.textContent = 'Not sent: no authoritative Julius feed is connected.';
    return;
  }
  window.dispatchEvent(new CustomEvent('wonderland:terminal-submit', { detail: { text } }));
}

function onKeyDown(ev) {
  const verdict = classifyKey(ev, open);
  if (shouldPreventDefault(verdict)) ev.preventDefault();
  if (shouldStopGameInput(verdict, open)) ev.stopPropagation();
  if (verdict === 'open-terminal') openTerminal();
  else if (verdict === 'close-terminal') closeTerminal();
}

export function install(root = window) {
  // CAPTURE PHASE. The Pixel Streaming client binds its own window listeners
  // to forward keys to the game; capture is how the terminal gets there first.
  root.addEventListener('keydown', onKeyDown, true);
  // keyup/keypress are swallowed on the same terms, or the game receives the
  // release of a key it never received the press of.
  for (const type of ['keyup', 'keypress']) {
    root.addEventListener(type, (ev) => {
      if (shouldStopGameInput('pass', open)) ev.stopPropagation();
    }, true);
  }
  const send = el('wl-tm-send');
  if (send) send.addEventListener('click', submit);
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
