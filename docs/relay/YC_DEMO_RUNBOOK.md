# YC Demo Runbook — Sunday Relay

**Finalized for Prompt 8.7 (2026-07-23). The video uses TWO product
surfaces of ONE product:** the Relay **browser application** and the Relay
**CLI product**. Both are built from this repository — the browser surface
from `src/relay/ui/`, the CLI from `src/relay/cli/` — so nothing in this
runbook depends on another checkout. The CLI segment is the
founder-approved **OFFLINE VISUAL SIMULATION** — fake adapters, zero
provider calls, zero network calls, no real file changes. The real
Claude→Codex supervised workflow was proven separately in Prompt 8.4;
durable crash recovery in Prompt 8.5.

> **Post-separation note.** Sunday Relay is its own repository
> (`ohdieyuh-glitch/sunday-relay`, checked out at
> `/home/kaisinrogodfree5/sunday-relay-product`). The paths below are the
> INDEPENDENT repository; `/home/kaisinrogodfree5/sunday-relay` is an Alcatraz
> worktree and no Relay command is run there any more. The readiness check no
> longer requires the retired `feature/relay-yc-demo` branch or the `9f8075f`
> checkpoint — those named an Alcatraz branch and a commit that does not exist
> in this object store. It now validates repository identity and the versioned
> product baseline in `docs/relay/YC_DEMO_BASELINE.json`, so it behaves
> identically on `main`, on any `relay/*` branch, and on a detached CI head.
> BOTH Relay surfaces — browser and CLI — live in this one repository; there
> is no separate Relay frontend checkout. (Sunday Alcatraz is a genuinely
> different repository, which is what the sibling worktree above is.)

**The two founder commands (memorize these):**

```bash
cd /home/kaisinrogodfree5/sunday-relay-product
npm run relay:yc-demo:check    # preflight — read-only, exits 0 when READY
npm run relay:yc-demo:cli      # honesty notice + the approved offline simulation
```

---

## A. Night-before check

- [ ] Charge the laptop (and bring the charger).
- [ ] Close unnecessary tabs, apps, and background processes.
- [ ] Silence notifications (OS Do Not Disturb + browser + Slack/mail).
- [ ] Terminal font 16–18 pt monospace; window ≥ **100×32** (demo is safe at
      80 columns; below 80 press `V` for the linear stream view).
- [ ] Browser zoom set and tested at recording resolution.
- [ ] Confirm the browser routes render at both mobile and desktop widths.
      This is a HUMAN check: `relay:yc-demo:check` never inspects the browser
      surface, so nothing has verified it for you. Do not debug CSS on the
      night before the take.
- [ ] Confirm the Relay Dog and assets load on both surfaces.
- [ ] Confirm the Project Settings agent selectors work (Prompt Architect /
      Coding Agent / Reviewer / Guided Mode) in the browser.
- [ ] `npm run relay:yc-demo:check` → **READY FOR FOUNDER ACCEPTANCE**.
- [ ] `npm run relay:yc-demo:cli` starts, plays, and `Q` exits cleanly.
- [ ] Confirm CLI playback controls respond (P, N, R, 1/2/3, V).
- [ ] Clear or hide sensitive terminal history (`clear`; short prompt:
      `PS1='> '`).
- [ ] Confirm the demonstration uses fixture data only (labels visible:
      OFFLINE DEMO · VISUAL SIMULATION · FAKE ADAPTERS · NO PROVIDER CALLS).
- [ ] Confirm no API key, credential, or account detail is visible anywhere
      on screen (terminal, browser, editors, menu bar).

## B. CLI launch

Exact commands:

```bash
cd /home/kaisinrogodfree5/sunday-relay-product
npm run relay:yc-demo:check
npm run relay:yc-demo:cli
```

The launcher prints an honesty notice, then opens the **activation splash**
(four-legged Relay Dog + offline labels + start keys).

Controls:

| Key | Action |
| --- | ------ |
| `ENTER` | enter the live PANELS console (paused on the first event) |
| `P` | play / pause (from the splash, `P` auto-plays) |
| `N` | advance one event |
| `R` | restart from the Prompt Architect |
| `1` / `2` / `3` | playback speed (1× / 1.5× / 2×) |
| `V` | toggle PANELS / STREAM |
| `Q` | quit safely (terminal always restored) |

Playback is ≈42 s at 1× (test-locked). Slash commands also work:
`/play /pause /next /restart /speed 2x /panels /stream /status /findings`.

## C. Browser launch

The browser surface is built from this repository. `package.json` declares
`dev` (`vite`) for the development server and `build` + `preview` (`vite
build`, `vite preview`) for the production bundle — the same bundle CI
asserts carries no development labelling.

Do **not** invent the URL. Vite prints it on start; record the one YOUR
machine prints, from the command you will actually run on the day, and write
both here before recording:

```
FRONTEND COMMAND:
<RECORD THE COMMAND YOU RAN — e.g. `npm run dev`, or `npm run build && npm run preview`>

FRONTEND URL:
<RECORD THE URL THAT COMMAND PRINTED ON THIS MACHINE>
```

Expected browser routes (open each one yourself — no Relay command checks
them):

- Relay Entry Home
- Project Settings
- Active Project Workspace
- Mobile preview
- Optional Relay Manual colorway

## D. Demonstration order

1. Begin in Sunday Alcatraz.
2. Switch into Relay.
3. Show Relay Home.
4. Select one project route.
5. Open Project Settings.
6. Click Prompt Architect: **Sunday Alcatraz**.
7. Click Coding Agent: **Claude Code**.
8. Click Reviewer: **Codex**.
9. Select **Guided Mode**.
10. Show research and Project Brain options.
11. Continue into the Active Workspace.
12. Explain the browser Relay Console.
13. Switch to the terminal.
14. Start the approved offline simulation (`npm run relay:yc-demo:cli`).
15. Let Prompt Architect generation and research appear.
16. Show Coding Agent activity.
17. Explain that agent statements remain **claims** until Relay verifies.
18. Show Relay verification.
19. Show independent Reviewer activity (Finding F-1 → Repair R-1 →
    re-review → approval).
20. End at **VERIFIED COMPLETE**.

## E. Truthful demo language

Approved explanation (say this over the CLI segment):

> "This terminal sequence is an offline product simulation showing how
> Relay presents a coordinated mission. The underlying real workflow has
> already been tested separately with a real Claude Code implementation
> and a real independent Codex review."

Do **not** say:

- "Claude is coding live" during the offline simulation
- "Codex is reviewing live" during the offline simulation
- "These are live provider calls"
- "Relay deployed this project"
- "This fixture is production work"

## F. Product message

Primary statement:

> **Sunday Relay turns separate AI agents into one continuous, supervised,
> independently verified workforce.**

Supporting explanation:

- Prompt Architect prepares the work and researches the project.
- Coding Agent implements.
- Relay preserves context and independently verifies evidence.
- Reviewer approves or requires repair.
- **Relay — not an individual agent — decides when the mission is verified
  complete.**

## G. Failure recovery (immediate, on camera if needed)

**CLI does not open:**
- `Ctrl+C`
- rerun `npm run relay:yc-demo:cli`

**CLI display looks corrupted (flicker, stale content, leftover from another run):**
1. press `Q` or `Ctrl+C`
2. wait for the shell prompt to return
3. run `reset` ONLY if the terminal itself is still corrupted
4. rerun `npm run relay:yc-demo:cli`

(`reset` is never needed during normal operation — the CLI restores the
terminal on every exit. A stale demo left running in another tab can also
cause this; quit it there with `Q`/`Ctrl+C`.)

**CLI is at the wrong step:**
- press `R` (restart)
- press `P` (play)

**CLI playback is too fast:**
- press `1` (back to 1×)

**Panels do not fit:**
- maximize the terminal
- reduce terminal zoom once
- press `V` for Stream mode

**Frontend asset missing:**
- refresh once
- use the verified local preview route
- do not debug live during recording
- continue with the CLI segment when necessary

**Frontend mobile view fails:**
- use the verified desktop layout
- do not spend the recording repairing CSS

## H. Stop conditions — do NOT record until

- [ ] CLI preflight passes (`relay:yc-demo:check` → READY)
- [ ] CLI visual playback passes end-to-end (splash → VERIFIED COMPLETE)
- [ ] Frontend visual review is approved by the founder — a human judgement;
      no Relay command asserts it
- [ ] Mobile **or** desktop fallback is selected
- [ ] No broken Relay Dog asset is visible on either surface
- [ ] Project Settings agent selectors work
- [ ] The founder can reach the Active Workspace
- [ ] The exact frontend command and URL are recorded in section C

---

# Appendix — other Relay proofs (NOT the primary video segment)

## A1. Legacy simulated scenario (`npm run relay:yc`)

The pre-8.6 deterministic scenario demo (SIMULATED banner, ~40 s,
`relay:yc:verify` proves determinism). Superseded as the primary segment by
the CLI product simulation above; still works as a backup narrative of the
orchestration engine.

## A2. Real proofs — separate segments, separate labels, not for the demo take

- **`npm run relay:claude:live`** — ONE real Claude Code agent in Relay's
  isolated worktree (Prompt 8). Run in its OWN terminal; label it LIVE;
  never claim Codex reviewed it. `relay claude doctor` is the safe pre-check.
- **`npm run relay:codex:live`** — the real independent Codex review proof
  (Prompt 8.3). Ends **RELAY STOPPED SAFELY (exit 3)** on the seeded-defect
  fixture — an honest outcome, not a demo beat. Requires `codex login`.
- **`npm run relay:supervised:live`** — the full real Claude→Codex
  supervised loop (Prompt 8.4, founder-authorized only).
- Never run a live command during the recording take, and never retry a
  provider call repeatedly on stage.

## A3. Deterministic workforce/product surfaces (safe any time)

- **`npm run relay:competitive`** — Mission Contract + simulated
  Claude/Codex workforce proof (reviewer labeled SIMULATED).
- **`npm run relay:mission-control`** — modes + consent + Relay Dog +
  reviewer gate + live-terminal projection (deterministic, no ANSI).

On-camera framing for any of these: the agents shown are deterministic
simulations; the mission, governance, and evidence stay with Relay; the
real provider proofs above were completed separately.
