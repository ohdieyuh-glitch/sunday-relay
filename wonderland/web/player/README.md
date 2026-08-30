# Wonderland player — the world, and the Live Terminal over it

Wonderland is an AI creation platform wrapped in an open-world interface. This
page is that wrapper: the streamed Unreal frame fills the viewport, and the
**Live Terminal** — the founder-approved Sunday Relay panel — opens over it.

```
SPACE   open the Live Terminal      (only when the world owns the keyboard)
ESC     close it, keyboard back to the world
```

**The Relay Dog does not jump.** Space is the terminal, in the browser and in
the engine both: `ARelayDogCharacter` binds Space to `OnLiveTerminalPressed`
and sets `JumpMaxCount = 0`, so the ability is refused rather than merely
unbound. World traversal must never require a jump; if a route needs one, the
route is the defect.

## Files

| File | What it decides |
|---|---|
| `keys.js` | who owns the keyboard — the only place that answers it |
| `feed.js` | what the terminal is allowed to say, and whether it is live |
| `terminal.js` | DOM wiring; deliberately dull, because the two above are tested |
| `index.html` / `player.css` | the approved panel, drawn over the world |

## The two rules that are structural, not habits

**Space is a character before it is a shortcut.** The moment the terminal opens
its input takes focus, so the global shortcut fires only when world input owns
the keyboard — never from an `<input>`, `<textarea>`, `<select>`,
`contenteditable`, or anything with a textbox role. `shouldPreventDefault`
returns false for typing, which is why the browser's own Space still inserts a
space, and true when we claim the key, which is why the page never scrolls.
Escape closes from inside the input too, so the mouse is never the only way
back to the world.

Pixel Streaming forwards keystrokes to the game, so the listener is **capture
phase**: the terminal sees Space before the streaming client does, and while
the terminal is open *every* key is withheld from the engine — otherwise typing
"walk south" walks the Dog south.

**The terminal projects execution; it does not invent it.** `normalizeEvent`
reads six named fields off an incoming event and ignores everything else, so
chain-of-thought, hidden prompts, secrets and internal reasoning cannot reach
the panel by default — a producer that grows a `reasoning` field leaks nothing,
because the field is never read. Secret-shaped strings that make it into a
headline are redacted anyway. With no source connected the terminal says
`NO AUTHORITATIVE FEED CONNECTED` and shows nothing; it does not fill the
sections with plausible rows, and a command typed with nowhere to send it says
so rather than being answered.

## The roles

`PROMPT ARCHITECT`, `CODING AGENT`, `INDEPENDENT REVIEWER`, then `JULIUS`.
Julius is the orchestration layer **above** the three workers, not a fourth
worker slot, and it reads as the system band beneath them. Every row that used
to be attributed to "Relay" is Julius speaking.

## Connecting a feed

```js
window.wonderlandTerminal.connect('relay bridge', events);
```

`events` are Relay workspace terminal events. Submissions leave as a
`wonderland:terminal-submit` window event. The bridge that carries real Julius
execution into this seam is the next piece of work; until it exists the panel
tells the truth about that.

## Verifying

```sh
./test.sh                 # 94 offline assertions, no browser
node capture.mjs [out]    # real Chrome: world → SPACE → type → ESC → live feed
```

`capture.mjs` serves the page (ES modules are blocked over `file://`), stands a
rendered Wonderland frame in for the stream, and photographs the sequence while
checking fifteen behaviours — including that a space typed into the input is a
space, that the panel never blinks while typing, and that private material
handed to a connected feed does not appear on screen.
