// The entry the Pixel Streaming page loads. One line of behaviour: put the
// Live Terminal on the live world.
import { mount } from './mount.js';

const start = () => mount({ cssHref: './wonderland/player.css' });
// player.js is deferred and builds the video at run time. Mounting on
// DOMContentLoaded is enough -- the terminal finds the stream element if it is
// already there and falls back to the body if it is not, and either way the
// capture-phase key listener is on `window`, which exists from the first line.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
