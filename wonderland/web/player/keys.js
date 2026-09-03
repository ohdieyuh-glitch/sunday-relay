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
 *   'open-terminal'   Ctrl+T, from anywhere -> open the Live Terminal
 *   'close-terminal'  Ctrl+T again, or Escape -> back to the world
 *   'type'            the key belongs to whatever has focus; do not touch it
 *   'pass'            not ours -- including Space, which is the Dog's jump
 *
 * CTRL+T TOGGLES, and unlike the Space binding it replaced it can afford to.
 * The old note said a Space toggle "would be a shortcut that only ever fires
 * when the participant has clicked away", because the terminal focuses its
 * input on open and a bare Space inside it is a space character. Ctrl+T is not
 * a character in any input, so the same key can open and close from either
 * side without ever competing with typing -- which is exactly the condition
 * the founder set for allowing a toggle at all.
 */
export function classifyKey(ev, terminalOpen) {
  if (!ev) return 'pass';
  const key = ev.key;
  // CTRL+T IS THE TERMINAL, AND SPACE IS THE DOG'S AGAIN (founder, 2026-09-03).
  //
  // This supersedes the 2026-08-30 canon that Space opens the terminal and the
  // Dog does not jump. The reasoning then was that the most reachable key
  // should go to the participant's line to their Compound Agent rather than to
  // a traversal mechanic -- sound, and the founder has now decided the other
  // way: Ctrl+T carries the terminal and Space carries the jump. Both keys are
  // still spoken for; what changed is which one.
  //
  // Ctrl+T is checked BEFORE the modifier bail-out below and before the
  // text-entry check, so it toggles from inside the terminal's own input too.
  // The browser's own Ctrl+T opens a tab, so preventDefault is not optional
  // here -- see shouldPreventDefault.
  if ((key === 't' || key === 'T' || ev.code === 'KeyT') && ev.ctrlKey && !ev.metaKey && !ev.altKey) {
    return terminalOpen ? 'close-terminal' : 'open-terminal';
  }
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return 'pass';
  if (isTextEntry(ev.target)) {
    // Escape still gets you out of the terminal from inside its own input --
    // otherwise the only way back to the world is the mouse.
    if (key === 'Escape' && terminalOpen) return 'close-terminal';
    return 'type';
  }
  // SPACE IS NO LONGER OURS. It goes to the game so the Dog can jump. The one
  // exception is while the terminal is open: then every key belongs to the
  // terminal, which `shouldStopGameInput` enforces, and a Space that reaches
  // the world underneath would be a jump the participant did not ask for.
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
 *   * The Ctrl+T that opens the terminal must NEVER reach the game. It is
 *     caught in the capture phase and stopped here.
 *
 *     SPACE IS DELIBERATELY NOT WITHHELD ANY MORE (2026-09-03). It is the
 *     Dog's jump, and a Space swallowed here is a jump that silently does
 *     nothing -- which is precisely how this layer would hide an engine-side
 *     regression, since "the key never arrived" and "the character refused it"
 *     look identical from the world.
 *
 *   * WHILE THE TERMINAL IS OPEN THE WORLD IS NOT BEING DRIVEN. Every key
 *     belongs to the terminal, or the participant types "walk south" and the
 *     Dog walks south. So the answer is simply: yes, all of them.
 */
export function shouldStopGameInput(verdict, terminalOpen) {
  return terminalOpen === true || verdict === 'open-terminal' || verdict === 'close-terminal';
}
