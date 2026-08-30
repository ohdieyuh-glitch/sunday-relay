// WHO OWNS THE KEYBOARD.
//
// Founder canon, 2026-08-30: SPACE opens the Wonderland Live Terminal, and the
// Relay Dog does not jump. That is one line of product and three traps of
// implementation, so the decision lives here on its own, as a pure function
// over a keyboard event, and is tested rather than tried.
//
//   1. WONDERLAND RUNS THROUGH PIXEL STREAMING. The page holds a <video> and
//      forwards keystrokes to the game. If Space reaches the game it is a
//      game key; the terminal must claim it FIRST, in the capture phase,
//      before the streaming client sees it.
//
//   2. SPACE IS ALSO A CHARACTER. The moment the terminal is open the
//      participant is typing into it, and a global Space shortcut that fires
//      while they type would open and close the panel on every word. So the
//      shortcut only fires when WORLD input owns focus -- never from an
//      <input>, a <textarea>, a <select>, or anything contenteditable.
//
//   3. SPACE SCROLLS A BROWSER PAGE. Default-prevented whenever we claim it,
//      and never when we do not, because preventing it inside a text field is
//      how you build a terminal you cannot type a space into.
//
// The three verdicts are separate on purpose: `type` says what the key means,
// and the caller decides what to do about it, so this file has no DOM in it
// and can be tested with plain objects.

/** True when the event's target is a place a person is typing. */
export function isTextEntry(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable === true) return true;
  // A shadow-DOM or custom element that declares itself a text box.
  const role = String(target.getAttribute ? target.getAttribute('role') || '' : '');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}

/**
 * What a keydown means to Wonderland.
 *
 *   'open-terminal'   Space, from the world -> open the Live Terminal
 *   'close-terminal'  Escape, with the terminal open -> back to the world
 *   'type'            the key belongs to whatever has focus; do not touch it
 *   'pass'            not ours
 *
 * `terminalOpen` matters for Escape only. Space with the terminal ALREADY
 * open and the world still focused is deliberately 'pass' rather than a
 * toggle: the founder allows a toggle "ONLY if this does not conflict with
 * terminal text entry", and the terminal focuses its input on open, so a
 * toggle would be a shortcut that only ever fires when the participant has
 * clicked away -- an invisible, occasional close. Escape is the close.
 */
export function classifyKey(ev, terminalOpen) {
  if (!ev || ev.ctrlKey || ev.metaKey || ev.altKey) return 'pass';
  const key = ev.key;
  if (isTextEntry(ev.target)) {
    // Escape still gets you out of the terminal from inside its own input --
    // otherwise the only way back to the world is the mouse.
    if (key === 'Escape' && terminalOpen) return 'close-terminal';
    return 'type';
  }
  if (key === ' ' || key === 'Spacebar' || ev.code === 'Space') {
    return terminalOpen ? 'pass' : 'open-terminal';
  }
  if (key === 'Escape' && terminalOpen) return 'close-terminal';
  return 'pass';
}

/** Should the browser's own behaviour be suppressed for this verdict? */
export function shouldPreventDefault(verdict) {
  return verdict === 'open-terminal' || verdict === 'close-terminal';
}

/**
 * Should this key be withheld from the streamed game?
 *
 * Pixel Streaming forwards keystrokes to Wonderland. Two consequences:
 *
 *   * The Space that opens the terminal must NEVER reach the game. It is
 *     caught in the capture phase and stopped here. The engine-side guard
 *     (`ARelayDogCharacter::OnLiveTerminalPressed`) exists for the Space
 *     that arrives anyway -- through a gamepad, a resumed session, a client
 *     that binds its own listener -- and it does not jump either.
 *
 *   * WHILE THE TERMINAL IS OPEN THE WORLD IS NOT BEING DRIVEN. Every key
 *     belongs to the terminal, or the participant types "walk south" and the
 *     Dog walks south. So the answer is simply: yes, all of them.
 */
export function shouldStopGameInput(verdict, terminalOpen) {
  return terminalOpen === true || verdict === 'open-terminal' || verdict === 'close-terminal';
}
