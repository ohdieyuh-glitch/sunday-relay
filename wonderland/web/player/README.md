# Wonderland player — the world, and the Live Terminal over it

Wonderland is an AI creation platform wrapped in an open-world interface. This
page is that wrapper: the streamed Unreal frame fills the viewport, and the
**Live Terminal** opens over it as a HUD panel.

## The size, and why it is a number

Measured off the founder's first reference frame (1672 × 941): **39.2% of the
viewport wide, 27.3% tall, bottom-centred with a 3.1% margin**. Those fractions
are in the stylesheet as written, with a 420 px floor — below that the log
stops being readable, and a panel you cannot read is not a smaller panel.

## The layout, from the second reference

**One rectangular outline** containing **four stacked sections** —
`PROMPT ARCHITECT`, `CODING AGENT`, `JULIUS`, `INDEPENDENT REVIEWER`, in that
order, with the orchestration layer *third*: between the workers that produce
and the reviewer that checks them. Each section is a bordered box with a gold
square, a gold title, a bracketed state beside the name and the same word again
on the right, over one body line.

The outline matters: four boxes floating on the world read as a stack of
notifications, and one panel containing four sections reads as an instrument.
Its fill is lighter than the sections' so they sit *on* it rather than
dissolving into it, and both stay translucent.

The **detail sub-line appears only in the section that is currently working** —
which is what the reference shows, three boxes with one body line and the live
one with two. Give every section a sub-line and the four of them no longer fit
in 27.3vh, and the last one loses its body entirely.

## Files

| File | What it decides |
|---|---|
| `keys.js` | who owns the keyboard — the only place that answers it |
| `feed.js` | what the terminal is allowed to say, and whether it is live |
| `terminal.js` | claims the keyboard, wires the panel |
| `mount.js` | the approved panel's markup, once, for both pages |
| `overlay.js` | the entry Epic's frontend loads |
| `install-overlay.sh` | puts it on the served page, reproducibly |
| `index.html` / `player.css` | the standalone harness, and the look |

## The two pages

`index.html` is the harness: a `<video>` and the same mount. The page the
founder actually opens is Epic's Pixel Streaming frontend — `player.html` plus
a 2.5 MB bundle that builds its video at run time — so `mount.js` owns the
panel's markup and builds it onto that page instead. Two copies of an approved
design is two designs, and the second one drifts.

`pixel-streaming-infra` lives outside this repository, so the edit to the
served page is `install-overlay.sh` rather than a hand-edit: idempotent (it
keeps a pristine `player.html.orig` and re-patches from it), it fails if Epic's
frontend changes shape, and it asserts the tag order it produced.

## Load order is load-bearing

The overlay's script tag goes **before** `player.js`. Key listeners on the same
target in the same phase fire in *registration order*, so a client that binds
window-capture before us cannot be stopped by any amount of
`stopImmediatePropagation` — its handler has already run. Capture phase is
necessary and nowhere near sufficient. So `claimKeyboard()` runs at module
evaluation with no DOM at all, and the panel is built later on
`DOMContentLoaded`.

Placed after `player.js`, the game receives the opening Space and every
character typed into the terminal. That is measured, not assumed:
`stream-page.html` reproduces it exactly by swapping those two lines.

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
./test.sh                 # 97 offline assertions, no browser
node capture.mjs [out]    # real Chrome, 24 checks, both pages
```

`capture.mjs` serves the page (ES modules are blocked over `file://`), stands a
rendered Wonderland frame in for the stream, and photographs the sequence while
checking twenty-four behaviours across both pages — that a space typed into
the input is a space, that the panel never blinks while typing, that private
material handed to a connected feed never appears on screen, and that a stream
client which registers keydown on window in both phases and on document
capture receives *nothing* while the terminal is open.
