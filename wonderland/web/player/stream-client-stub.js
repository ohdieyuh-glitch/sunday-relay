// A STAND-IN FOR EPIC'S PIXEL STREAMING BUNDLE.
//
// The real player.js is 2.5 MB and builds a WebRTC video at run time. What
// matters to the Live Terminal is only the shape of it: window-level key
// listeners that forward to Unreal, loaded as a DEFERRED CLASSIC SCRIPT --
// which is what decides the registration order the terminal has to win.
//
// This registers in the worst way it reasonably could: window capture, window
// bubble, and document capture. wl_forwarded is what the game would receive.
window.wl_forwarded = [];
const forward = (ev) => { window.wl_forwarded.push(ev.key); };
window.addEventListener('keydown', forward, true);
window.addEventListener('keydown', forward, false);
document.addEventListener('keydown', forward, true);
