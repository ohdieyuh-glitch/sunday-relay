# Wonder Web windows — workspace decisions

**Status: PROPOSED.** Logic only. No Unreal compile was run, and no VM was
started. The module decides what a window is called, which outline token it
shows, which phase it is in, where it tiles, and which animation intent to
play. It does not draw, open a socket, or talk to a provider.

Contract: `wonderland-wonder-web-windows.v1`.

| Piece | Path |
|---|---|
| Domain | `src/relay/mission/wonderland/wonder-web-windows.ts` |
| Tests | `src/relay/mission/wonderland/wonder-web-windows.test.ts` |
| Standalone C++ | `wonderland/Source/Wonderland/WonderlandWonderWebWindowLogic.h` / `.cpp` |
| C++ driver | `wonderland/Tools/wonder-web-window-logic-test.cpp` |

The TypeScript module is not re-exported from `src/relay/mission/wonderland/index.ts`.
Callers import the file. The C++ names were chosen so they do not collide with
Cosmo's client-line extraction `WonderlandWonderWebWindows.h` / `.cpp`.

Time is an injected `tsUtcMs`. A missing value stays null and is rendered as
unknown. A VM number that is not a positive integer is null, never `0`.

---

## What a window is

```
User
  Parent terminal   grok_bot_group | openai_companion | julius
    Agent           authenticated agentId + customized display name
      VM session    stable vmSessionId, never reused
        Window      keyed only by that vmSessionId
```

The founder names ("Grok Bot companion", "OpenAI companion", "Julius") are the
terminal's `displayName`. The kind on the session record is BRIDGE's
`grok_bot_group | openai_companion | julius`. There is no bot / Dot / Card
enum. Dot and Card are customized display names.

The title is always `<agentDisplayName> — Wonder Web VM <N>` (em dash). `N` is
`vmNumber` from the session record, display only. This module does not choose,
store, or address by a number. The only place a number is chosen is BRIDGE's
session service under `src/relay/integration/wonder-web-vm/` (that directory
is not created here). The registry record carries no title. A `title`,
`windowTitle`, or any other title-like field on the session record is ignored.
An empty or control-character name is rejected for open. When the display
name is missing or empty, the composed title and `observerView` title use
`Unnamed agent`, the same string Cosmo's client shows. That fallback is not
a provider or terminal label. A custom name that happens to be "Grok" is the
user's name and is kept.

Parent identity (`terminalId`, `kind`, `displayName`) is secondary metadata.
It is not the title and it is not an authorization key.

### Session input

BRIDGE's published session contract is authoritative. This module consumes:

```
vmSessionId, agentId, agentDisplayName, vmNumber,
terminal { terminalId, kind, displayName },
accentColorRef,
sessionState: provisioning | running | paused | ended | failed
```

`endCause` is BRIDGE contract `wonder-web-vm-session.v1`. It is set only
when `sessionState` is `ended` or `failed`, and it is this closed set:

`owner_terminated`, `idle_timeout`, `max_lifetime`, `provider_failed`,
`cap_exhausted`, `authorization_revoked`.

Omit it rather than inventing one. An unknown value, and any `endCause` on
`provisioning`, `running`, or `paused`, is `unsupported_contract`. Closing
a window is never an end cause: `close_anim` carries `endCause: null`.

---

## PROPOSED acceptance criteria

1. **Identity is `vmSessionId`.** A reused `vmNumber`, or a client id of the
   shape `browser` / `browser-N`, cannot address a window. `addressByVmNumber`
   and `addressByBrowserId` always refuse, and they do not look at state.
   Persisted windows carry neither `vmNumber` nor a browser id. A document
   that adds one is `number_is_not_identity`. An ended session id is never
   reused (`session_id_reused`).

2. **The outline token is the parent terminal's `accentColorRef`.** Every
   window under that terminal copies the one string. An empty or
   control-character ref is null (Unknown). The module never substitutes
   `#FFD400` or a dot-color token.

3. **Panel close is not session end.** `close_anim` is the user closing the
   panel. The VM keeps `provisioning | running | paused`. `vm_ended_anim` is
   the session moving to `ended` or `failed` while its window is shown or
   minimized. The two intents are never substituted for each other.
   `minimize_fold` is only a fold to a chip.

4. **Camera rule for PILOT.** Chips count as held. `cinematic_closeup` plays
   only when the window being shown is the only held window. An open while
   every other window is a chip is `spawn_inline`, not a camera move. The
   last shown window leaving while a chip remains does not emit
   `camera_return`. `camera_return` plays only when the last held window
   leaves and the camera was already in the close-up. A cap-queued chip
   emits neither open intent.

5. **A seventh session keeps running.** The shown-window cap is an input,
   default 6. Past the cap the new window is a minimized chip
   (`admission: queued_chip`). The session is not blocked, serialized, or
   stopped. User restore of a chip respects the cap (`window_cap_reached`).
   Permission, failure, and result may surface past the cap.

6. **Focus does not pause anyone.** No output changes another session's
   `sessionState`, and no output tells a runtime to wait.

7. **Skywalker criterion 8.** `observerView` is exactly
   `outlineColorToken`, `ownerName`, `title`, `status`. It is built field by
   field. Stream, frame, URL, page, and action are not fields, even when the
   caller hangs them on the session record.

8. **Skywalker criterion 9.** Focus, minimize, pin, unpin, close, and
   visibility are authorized by `actorAgentId === window.agentId`. Display
   name and accent are not credentials. Two agents with the same name and
   the same colour cannot act on each other's windows.

9. **Skywalker criterion 11.** The module emits no keepalive, heartbeat,
   extend, renew, or hold. Open, focus, pin, and minimize do not change
   session lifetime. Server-side idle and hard TTL own that. A pinned,
   focused window still becomes `vm_ended_anim` when the session ends. The
   test walks outputs for lifetime-affecting tokens; the module source does
   not contain those action names.

10. **QA lines** carry `ts_utc_ms`, `client_role`, `net_id`, `build_sha`,
    `corr_id`, `event`, `vmSessionId`, and `n`. `n` is the session's usable
    number, or null. `client_role` is `presentational`
    (`WONDERLAND_CLIENT_ROLE`). Events: `ww_window_opened`,
    `ww_window_surfaced`, `ww_window_minimized`, `ww_window_focused`,
    `ww_window_pinned`, `ww_panel_closed`, `ww_session_terminated`.

---

## Animation intents

Cosmo renders each intent as its own visual. The client today uses one
`GrowSeconds` (0.3s) for open, close, minimize, and restore
(`WonderlandWonderWebScreen.cpp:40` on `aa930c26`). These intents are
distinct on purpose. The module does not emit durations.

| Intent | When |
|---|---|
| `cinematic_closeup` | First held window opens. Sets `cameraInCloseup`. |
| `spawn_inline` | A later window opens while another is held, including when the others are only chips. Camera flag unchanged. |
| `minimize_fold` | User minimize, or idle auto-minimize of an unpinned shown window. |
| `restore_unfold` | A chip is shown again (user focus, or an urgent / allowed surface). |
| `close_anim` | User panel close. Session state unchanged. |
| `vm_ended_anim` | Session `ended` or `failed` while the window is shown or minimized. `endCause` is copied from the record, or null. |
| `camera_return` | The last held window leaves (shown or chip) and the camera was in the close-up. A remaining chip blocks it. |

### PILOT camera rule

Held means shown or minimized. A chip is held.

- All chips, then a new open: `spawn_inline`. The camera stays where it is.
- The last shown window leaves while any chip remains: no `camera_return`.
- `camera_return` only when that departure drops the held count to zero and
  `cameraInCloseup` was already true.

Causes on `vm_ended_anim`, from `wonder-web-vm-session.v1`:
`owner_terminated`, `idle_timeout`, `max_lifetime`, `provider_failed`,
`cap_exhausted`, `authorization_revoked`. A panel close does not use one.

A cap-queued open emits `ww_window_opened` and `ww_window_minimized` and no
animation. The window never stood, so it does not fold.

---

## Phases

`opening`, `live`, `minimized`, `focused`, `closing`, `closed`. `pinned` is
a flag, not a phase. Shown (counts toward the cap): `opening | live |
focused`. Held (the workspace is still up): shown plus `minimized`.

Focus is exclusive. Settling an opening window focuses it and demotes any
other `focused` window to `live`. Idle past 60s (injected clock, configurable)
auto-minimizes a shown window unless it is pinned. Pin does not block a
manual minimize. Progress surfaces are rate-limited (default 5s) and will
not exceed the shown cap. Permission, failure, and result ignore both.

---

## Hook map for Cosmo (`aa930c26`)

Client line: `aa930c269c43a52fc31c785f7bdcc231c8af6cf0`
(`backup/wonderland/r16reh16w-aa930c26`). Drive these functions. Do not
replace them. Pass `vmSessionId` from a side table; `FWonderWebWindow` has
no owner, agent, title, colour, or session (`WonderlandUiSubsystem.h:983-993`).

| Decision | Client call | Where |
|---|---|---|
| First shown window, `cinematic_closeup` | `OpenOverlay` → `SetViewTargetWithBlend(Workspace, 0.8f, VTBlend_Cubic)`, then `TileWonderWeb` | `WonderlandUiSubsystem.cpp:685`, `:872-873` |
| Later window, `spawn_inline` | `OpenWonderWebWindow`: if the overlay is already Wonder Web, `Present` + `TileWonderWeb` only. No blend. | `WonderlandUiSubsystem.cpp:3261-3295` |
| `minimize_fold` / chip | `MinimizeWonderWebWindow(Id, true)` | `.cpp:3326-3356`, declaration `.h:638` |
| `restore_unfold` | `MinimizeWonderWebWindow(Id, false)` or `OpenWonderWebWindow` (clears minimized) | `.cpp:3326`, `.cpp:3261` |
| `close_anim` | `CloseWonderWebWindow` | `.cpp:3297-3322`, `.h:634` |
| `vm_ended_anim` | Same panel dismissal as close, with a separate visual. Do not call a session-stop API from the window manager. | new visual; dismissal is still `CloseWonderWebWindow` |
| `camera_return` | `CloseOverlay` → `SetViewTargetWithBlend(Pawn, 0.7f, VTBlend_Cubic)` | `.cpp:1081`, blend at `:1136` |
| Focus move | `FocusWonderWebWindow` / `MostRecentWonderWebWindow` | `.cpp:1745`, `.cpp:1724` |
| Layout | `TileWonderWeb` | `.cpp:3449-3600`, `.h:649` |
| Chip widget | `SWonderWebWindowChip`, design 560×96 | `WonderlandJuliusConnectPanel.h:112` |
| Shown cap input | `GetWonderWebWindowLimit` (entitlement, else 6) | `.cpp:3187-3191`, `WonderlandEntitlements.h:37` |
| Expand | `ExpandWonderWebWindow` | `.cpp:3359-3378`. This module does not own expand as a phase. `tileWindows(..., { expandedVmSessionId })` reproduces the client's enlarged placement. |

Tile defaults copied from that line: half-view fallback `(295, 166)`,
`viewAcross` 16 (`ViewSide` default −16, negated), gap 18, HUD clearance 8,
margin 10, lone size 1.15, pair size 1.0 (literal, `.cpp:3541`), many size
0.9 (literal), expanded size 1.6, glass 240×160 (window width 240, content
1536×1024), chip scale 0.2. One window with an empty keep-out lands at size
1.15, centre x = 16, y = 0.

`FWonderWebWindow` cannot store `agentId`, the title, `accentColorRef`, or
`vmSessionId`. Cosmo keeps a side table keyed by `vmSessionId` and passes
the client's `FName` only as a handle for the calls above. Do not mint
`browser` / `browser-N` as identity (`NextWonderWebWindowId`,
`.cpp:3194-3215`, pool through `MaxBrowserId` 12 at `.cpp:107`).

### Mismatches (do not redesign the client)

- **Cap.** `CountOpenWonderWebWindows` (`.cpp:3176-3184`) counts minimized
  browser windows. `SpawnWonderWebWindow` (`.cpp:3222-3258`) refuses a
  Ctrl+W past the limit and opens nothing. This module counts shown windows
  only, and a seventh *session* stays running as a chip. Ctrl+W refusal
  stays the client's. Session admission does not copy that refusal.
- **Last-window close.** The client keeps `bOpen` and calls `CloseOverlay`
  (comment at `.h:604-606`: the set is kept). This module moves the panel
  to `closing` then `closed`. The session may stay live. Reopen uses the
  same `vmSessionId` and the same `openedOrder`.
- **Ids.** The client reuses `browser`, `browser-2` … `browser-12`. This
  module refuses that shape as an address.
- **One timer.** Client open, close, minimize, and restore share
  `GrowSeconds` 0.3s. Intents here are separate so Cosmo can split the visuals.
- **Camera durations** stay the client's: 0.8s cubic in, 0.7s cubic back.
  The module emits the intent, not the seconds.
- **No pin, idle fold, or reopen** on the client. The only auto-surface is
  Julius `web-lookup` (`HandleJuliusConnectChanged`, `.cpp:3646`) plus the
  prompt opening Connections. This module does not auto-open from a task
  template.
- **Outline.** There is no `accentColorRef` on the client. The window line
  is hard-coded `WonderWebLook::Line` = `Srgb(0xFF, 0xD4, 0x00)`
  (`WonderlandWonderWebPanel.h:6` and `:34`). `WonderlandUiStyle.h:41` is
  the `ThemeAccent()` declaration, not a hex literal. `Gold()` (`h:57`)
  reads that one accent. Until settings load, the accent is
  `FColor(0xD9, 0xA4, 0x41)` (`WonderlandMascotStyle.cpp:1872`). Julius and
  Companion accents fall back to it (`:1908`, `:1914`) unless a per-surface
  choice was saved. Terminals therefore share one accent today. That is the
  gap for Cosmo and BRIDGE: feed `accentColorRef` from the parent terminal,
  and stop painting the workspace outline from `WonderWebLook::Line`.
- **Existing Wonder Web domain** (`docs/relay/WONDER_WEB.md`,
  `src/relay/mission/wonder-web/`) is the creation pipeline. Its surface
  title is the constant `WONDER WEB`. Dot colours are a per-user hash.
  It has no parent terminal, no VM session, and no window phase. This
  module is the workspace layer above that surface. It does not change it.
- **Record vs actor.** Opening is authorized by possession of the session
  record (`agentId` on the record). Later mutations require
  `actorAgentId === window.agentId`.
- **Focus handoff logs `n: null`.** The neighbour's number is not stored on
  the window. The log does not invent one.

---

## Hook map for BRIDGE

Publish the session record above from the session service. Numbering stays
in `src/relay/integration/wonder-web-vm/` only. This module will follow a
rename of that contract; it does not define a second one.

When the server ends a VM, send `sessionState: ended | failed` and
`endCause` from `wonder-web-vm-session.v1` (`owner_terminated`,
`idle_timeout`, `max_lifetime`, `provider_failed`, `cap_exhausted`,
`authorization_revoked`). The window manager will close the panel with
`vm_ended_anim` and copy that cause. It will refuse any other cause, and
any cause on a session that is still live, as `unsupported_contract`. It
will not send a keepalive, and it must not be asked to. Idle timeout and
hard TTL remain server-side. A browser session being open, focused, or
pinned is not a reason to extend the VM. Closing the panel is not an end
cause.

Do not put stream, frame, URL, page, or action on anything an observer can
read. `observerView` drops them even if they arrive.

---

## Build notes for the C++ file

`WonderlandWonderWebWindowLogic.cpp` includes no engine header and no
`USTRUCT` / `UENUM`. `wonderland-cpp-parity` concatenates every header in
`wonderland/Source/Wonderland/`, so those tokens must stay out of this header.

`Wonderland.Build.cs` was not modified (`PCHUsage = UseExplicitOrSharedPCHs`).
Unreal Build Tool compiles every `.cpp` in the module directory. This file
should compile as an ordinary translation unit. If a later module build
force-includes a precompiled header and objects, exclude
`WonderlandWonderWebWindowLogic.cpp` from the Wonderland module rather than
adding engine macros to it. Cosmo owns actors, materials, and animation assets.

`wonderland/Tools/syntax-check.sh` was not modified. Its baseline lists
`WonderlandDogAnimation.cpp`, `WonderlandModule.cpp`,
`WonderlandHubGameMode.cpp`, and `WonderlandDogPawn.cpp` only. A line is not
required for this standalone logic file; the g++ logic test is the proof. If
someone later wants the stub sweep to see it, the line would be
`WonderlandWonderWebWindowLogic.cpp:0`. Do not add it from this change.

The C++ `SerializeWindows` emits the same canonical document the TypeScript
module writes (sorted keys, no `vmNumber`). `deserializeWindows` lives in
the TypeScript module, which is the persistence reader shared by the browser
and the CLI. The C++ side keeps the struct in memory.

---

## What this change is not

No Unreal editor build. No packaged client. No provider call. No real VM.
No edits under `src/relay/integration/`, and no edits to the client files on
`aa930c26`.
