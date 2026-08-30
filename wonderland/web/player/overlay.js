// The entry the Pixel Streaming page loads.
//
// TWO STEPS, IN THIS ORDER, AND THE ORDER IS THE WHOLE DESIGN.
//
//   1. CLAIM THE KEYBOARD NOW, at module evaluation. Listeners on the same
//      target in the same phase fire in registration order, so the only way to
//      beat a streaming client that binds window-capture is to bind first --
//      which means before its script runs, not after the DOM is ready.
//      install-overlay.sh therefore puts this tag BEFORE player.js.
//   2. BUILD THE PANEL when the document is ready.
//
// Done the other way round, the client forwards the opening Space and every
// character typed into the terminal straight to Unreal.
import { mount } from './mount.js';
import { claimKeyboard } from './terminal.js';

claimKeyboard();

// The installer copies this module to www/wonderland/, so the stylesheet sits
// beside it; the local harness serves it from the same directory.
const CSS = new URL('./player.css', import.meta.url).href;
const start = () => mount({ cssHref: CSS });
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
