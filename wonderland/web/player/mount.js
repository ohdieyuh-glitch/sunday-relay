// MOUNT THE LIVE TERMINAL ON A PAGE THAT DOES NOT HAVE IT.
//
// index.html carries the markup inline. The Pixel Streaming frontend does not:
// it is Epic's stock player.html plus a 2.5 MB bundle that fills the body with
// its own video at runtime. So the same terminal has to be BUILT onto that
// page rather than authored into it -- and it must be the same terminal, not a
// second copy of the approved design that can drift away from the first.
//
// This file therefore owns the markup once, and index.html's copy is checked
// against it by page.test.mjs.
import { install, setWorld } from './terminal.js';

const SECTION_MARKUP = `
  <div class="wl-tm-titlebar">
    <span class="wl-tm-brand">RELAY AGENT LIVE TERMINAL</span>
    <span id="wl-tm-live" class="wl-tm-live">NO FEED</span>
  </div>
  <div id="wl-tm-roles" class="wl-tm-roles"></div>
  <ul id="wl-tm-stream" class="wl-tm-stream"></ul>
  <div class="wl-tm-input">
    <span class="wl-tm-prompt">&gt;_</span>
    <input id="wl-tm-input" type="text" autocomplete="off" spellcheck="false"
           aria-label="Ask Relay" placeholder="">
    <button id="wl-tm-expand" class="wl-tm-expand" type="button"
            aria-label="Expand the terminal" title="Expand">&#9707;</button>
  </div>`;

/**
 * Build the terminal onto a live Pixel Streaming page and take the keyboard.
 *
 * `worldSelector` names the element the stream renders into. It is made
 * focusable, because "the world owns the keyboard" has to be something the
 * browser agrees with and not something this page merely believes -- without
 * a focusable world, Escape would have nowhere to give focus back to and the
 * next Space would be swallowed by whatever the PS client focused last.
 */
export function mount({ cssHref = './player.css', worldSelector = '#videoElementParent' } = {}) {
  if (document.getElementById('wl-terminal')) return window.wonderlandTerminal;

  if (cssHref && !document.querySelector(`link[href="${cssHref}"]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.append(link);
  }

  // The streamed video is the world. Whatever the client actually built, one
  // element gets the id the terminal expects and a tabindex so it can hold
  // focus; if the client has not built it yet, the body stands in and the
  // hand-off still works because focus() on <body> is a real focus.
  // BY REFERENCE. Epic's container already has an id (#videoElementParent) and
  // the client looks itself up by it, so renaming it would break the client
  // and leaving it alone left the terminal with no world to hand focus back
  // to. The element is handed over directly instead.
  const streamed = document.querySelector(worldSelector) || document.body;
  if (streamed !== document.body && !streamed.hasAttribute('tabindex')) {
    streamed.setAttribute('tabindex', '0');
  }
  setWorld(streamed);

  const hint = document.createElement('p');
  hint.id = 'wl-hint';
  hint.innerHTML = '<kbd>SPACE</kbd> LIVE TERMINAL';

  const overlay = document.createElement('div');
  overlay.id = 'wl-terminal';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Wonderland Live Terminal');
  // ABOVE THE STREAM CLIENT'S OWN UI. Epic's frontend layers its settings and
  // stats panels over the video; the terminal is the front door and has to be
  // over those too, or Space opens a panel behind a control bar.
  overlay.style.zIndex = '2147483000';
  const win = document.createElement('div');
  win.className = 'wl-tm-window';
  win.innerHTML = SECTION_MARKUP;
  overlay.append(win);

  document.body.append(hint, overlay);
  window.wonderlandTerminal = install();
  return window.wonderlandTerminal;
}

export { SECTION_MARKUP };
