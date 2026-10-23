# Wonder Web VM window look: hunks for FORGE (2026-10-23)

Author: Cosmo (Wonderland dev agent). Branch `wonderland/wonder-web-unreal-cosmo-20261023`, based on `aa930c269c43a52fc31c785f7bdcc231c8af6cf0`.

This branch adds the look and motion of a VM window, in `WonderlandWonderWebWindowLook.h/.cpp`, `WonderlandWonderWebScreen.*`,
`WonderlandWonderWebPanel.*`, `WonderlandWonderWebBrowserPanel.*` and `WonderlandMascotStyle.*`. It does **not** touch
`WonderlandUiSubsystem.h/.cpp`, `WonderlandWonderWebWindows.*` (FORGE, PR #420), or the live wire files
(`WonderlandWonderWebLive*`). The hunks below are for FORGE to apply in the files FORGE owns. Nothing here was compiled against
Unreal. No VM exists yet: until a caller passes an identity, every window keeps the legacy look (WONDER WEB lettering, `#FFD400`
outline, 0.3 s fold both ways).

Line numbers are given at `aa930c26` and at PR #420 head `9bad459f108d8f86954aa78a55d8780765e20204`.

## 1. `GetCompanionTerminalAccent(idx)` reads the per-terminal colour

`WonderlandUiSubsystem.cpp`: `aa930c26` :563-567, #420 :540-544 (the function did not move). `WonderlandMascotStyle.h` is
already included by that file.

```diff
 FLinearColor UWonderlandUiSubsystem::GetCompanionTerminalAccent(int32 Index) const
 {
-	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid()
-		? CompanionTerminals[Index]->GetPaintedAccent() : FLinearColor::Transparent;
+	// THE TERMINAL'S OWN OUTLINE COLOUR: its per-terminal pick, else the shared companion colour (WonderlandMascotStyle).
+	return CompanionTerminals.IsValidIndex(Index) && CompanionTerminals[Index].IsValid()
+		? WonderlandMascotStyle::CompanionTerminalAccentFor(Index) : FLinearColor::Transparent;
 }
```

**Caution before applying.** Today this getter reports the colour the terminal actually **painted**
(`SWonderlandCompanionTerminal::GetPaintedAccent`, set from `WonderlandUi::CompanionGold()` at CompanionTerminal.cpp:185/601;
the console does the same at CompanionConsole.cpp:158/1710). QA reads it as a painted readback. The terminals still paint
the one shared colour, so after this hunk the getter reports the per-terminal pick while the terminal itself draws the shared
colour. Until nobody picks a per-terminal colour, the two values are identical, because the per-terminal colour falls back to
`CompanionAccent()`. There are two ways to resolve this:
- (a) Recommended: keep this getter as the painted readback, and add a sibling `GetCompanionTerminalOutline(int32)` (a
  header change, which is FORGE's) that returns the hunk's expression.
- (b) Apply the hunk as written, and add a follow-up where each companion terminal or console is told its index and paints
  `CompanionTerminalAccentFor(Index)` instead of `CompanionGold()`. That is not in this branch.

## 2. The window manager drives the look with FORGE's cues (in `WonderlandWonderWebWindows.cpp`)

Aligned 1:1 with FORGE's `wonderland-wonder-web-windows.v1` (branch `wonderland/wonder-web-windows-forge-20261023`, head
`46383abec8173017c58b780dcd14f942437d9dfe`). The look never decides the camera or the admission; it plays the cue FORGE's logic
emitted. Hand each cue over as it is:

```cpp
#include "WonderlandWonderWebWindowLook.h"   // via WonderlandWonderWebScreen.h already
WonderlandWonderWebWindowLook::FForgeCue Cue;
Cue.Intent = /* FORGE AnimationCue.intent, e.g. "close_anim" */;
Cue.bHasEndCause = /* cue.endCause !== undefined && !== null */;
Cue.EndCause = /* cue.endCause (BRIDGE wonder-web-vm-session.v1), only read for vm_ended_anim */;
// The pure half reads UTF-8 std::string: from an FString use std::string(TCHAR_TO_UTF8(*Value)).
Screen->ApplyCue(Cue);   // false (and nothing happens) for an intent this build does not know
```

| FORGE output | `EVisualIntent` | The window does |
|---|---|---|
| `openAnimation: cinematic_closeup` (no other window held) | `SpawnWithCloseUp` | `PresentWithIntent(..., SpawnWithCloseUp)`: unfold. The camera blend stays the caller's. |
| `openAnimation: spawn_inline` (another window held, **chips included**) | `SpawnInline` | `PresentWithIntent(..., SpawnInline)`: unfold in place, camera untouched. |
| `admission: queued_chip` (`openAnimation: null`; the 7th window at the default cap of 6) | none | `Screen->PresentQueuedChip(Window.ContentSize, SWonderWebWindowChip::DesignSize(), WonderWebWorkspace.Get())`: a chip from the start, no unfold, no camera. |
| `minimize_fold` | `Minimize` | The 0.3 s fold to the chip. The window stays held. |
| `restore_unfold` | `RestoreUnfold` | Unfold from the chip (`SetMinimized(false)`). |
| `close_anim` | `Close` | The distinct close (shrink to 86% with a fade, `wl.WonderWeb.CloseSeconds` 0.22). Never VM ENDED. |
| `vm_ended_anim` + `endCause` | `VmEnded` | The glass dims (0.55) and the cause badge fades in over `wl.WonderWeb.VmEndedSeconds` 0.45, holds `wl.WonderWeb.VmEndedHoldSeconds` 1.6, then the close shape. A chip leaves at once. |
| `camera_return` | `CameraReturn` | Nothing on the window. The camera is the manager's: FORGE emits it only when the last **held** window (chips included) leaves. |

- FORGE's `settleClosing(id)`: call it once `Screen->HasLeft()` is true (after `close_anim` or `vm_ended_anim`).
- The cause badge, from BRIDGE's six (`ended`/`failed` only): `owner_terminated` "VM STOPPED BY OWNER", `idle_timeout` "VM IDLE
  TIMEOUT", `max_lifetime` "VM TIME LIMIT REACHED", `provider_failed` "VM PROVIDER FAILED", `cap_exhausted` "VM CAP
  EXHAUSTED", `authorization_revoked` "VM ACCESS REVOKED". None, null or anything unknown shows the neutral "VM ENDED"; it never
  crashes. A window close is never a cause: an `endCause` on any other cue is dropped.
- **Mismatch to settle with BRIDGE:** FORGE's TS `SESSION_END_CAUSES` today is `idle_timeout, max_lifetime, explicit_stop,
  failure`, so FORGE's `validateSession` would reject `owner_terminated`, `provider_failed`, `cap_exhausted` and
  `authorization_revoked` as `invalid_end_cause`. The look shows `explicit_stop` and `failure` as the neutral "VM ENDED".
- Whole workspace closes (back to the Dog), `WonderlandUiSubsystem.cpp` :1106 (#420): keep `Dismiss()`, the legacy fold.
- Old names still read by `ParseIntent` (never by `ApplyCue`): `spawn_close_up`, `minimize`, `close`, `vm_ended`.
  `IntentName` now returns FORGE's names.
- `Present()`, `Dismiss()`, `SetMinimized()` and `ApplyIntent(EVisualIntent)` keep their signatures and behaviour for callers
  that pass no cue. One behaviour change: `ApplyIntent(VmEnded)` now leaves after the veil (FORGE's `closing`); in the first
  commit the window stayed.

## 3. The look (title, parent line, outline)

When the window record knows its VM, put this after `EnsureWonderWebWindow` and whenever the name, number, parent or state
changes. Do not run it every frame; a missing name is logged once per session id.

```cpp
FWonderWebWindowIdentity Identity;
Identity.AgentDisplayName = /* the agent's custom name (bot, Dot, Julius card) */;
Identity.VmNumber = /* N, per parent terminal, reusable */;
Identity.ParentTerminalName = /* the parent companion's (or Julius's) custom name */;
Identity.bHasParentAccent = true;
Identity.ParentAccent = WonderlandWonderWebWindowLook::ParentTerminalOutline(
	bJuliusCard ? EWonderWebParentKind::Julius : EWonderWebParentKind::CompanionTerminal, CompanionTerminalIndex);
Identity.State = /* WonderlandWonderWebWindowLook::ParseSessionState(session.state) */;
Identity.EndCause = /* WonderlandWonderWebWindowLook::ParseEndCause(session.endCause), counted only for ended/failed */;
Identity.ProviderLabel = /* used only to refuse it as a name; never shown or logged */;
Identity.VmSessionId = /* stable internal id */;
const FWonderWebWindowLook Look = WonderlandWonderWebWindowLook::ResolveLook(Identity);
Screen->SetWindowLook(Look);          // outline for the VM ENDED badge; State Ended/Failed also turns VM ENDED on
Panel->SetWindowLook(Look);           // SWonderlandWonderWebPanel or SWonderlandWonderWebBrowserPanel: title block + outline
```

- `FWonderWebWindow::Content` is a `TSharedPtr<SWidget>`, so the typed panel is only known at creation
  (`SAssignNew(WonderWebPanel, ...)` :160, `SAssignNew(Panel, SWonderlandWonderWebBrowserPanel)` :193 in #420). Keep a typed
  weak pointer in the record (a header change, FORGE's), or call `SetWindowLook` right there.
- The title is `<name> — Wonder Web VM <N>` (U+2014). A missing name, or one that is only a provider label, shows
  `Unnamed agent`. N outside 1..9999 shows no number.
- Only the window's outline is recoloured. The Wonder Web's other line work stays `#FFD400`.

## 4. Per-terminal colour API (`WonderlandMascotStyle.h`)

`MaxCompanionTerminals()` (16), `HasCompanionTerminalAccent(i)`, `CompanionTerminalAccentFor(i)`,
`PickCompanionTerminalAccent(i, Colour)`, `ClearCompanionTerminalAccent(i)`.

- Colours are stored in `Saved/Wonderland/CompanionTerminalAccents.txt`. There is no new UPROPERTY, because of the FName and
  Niagara rule.
- Falls back to the shared companion colour, then the theme, so existing saves are unchanged.
- Picking a colour calls `SaveAndApply()`.
- A menu or QA hook for picking a colour (e.g. in `WonderlandUiTestLibrary`) is not in this branch.

## 5. `syntax-check.sh`: conflict with #420

Both branches append to the same two lines: `BASELINE` and `HEADER_BASELINE`.
- This branch adds `WonderlandWonderWebWindowLook.cpp:1` and `WonderlandWonderWebWindowLook.h:1`. The stubs have no Slate,
  so there is one fatal include error in each.
- #420 adds `WonderlandWonderWebWindows.cpp:1` and `WonderlandWonderWebWindows.h:0`.
- Resolution: keep all four entries.

## 6. The observerView card (`SWonderWebObserverCard`)

For FORGE's `ObserverView` (`outlineColorToken`, `ownerName`, `title`, `status`) and nothing else: there is no content slot,
so no frame, URL or terminal text can reach it.

```cpp
FWonderWebObserverView View;
View.OutlineColorToken = /* observerView.outlineColorToken, unset when null */;
View.OwnerName = /* observerView.ownerName */;
View.Title = /* observerView.title, unset when null */;
View.Status = /* observerView.status: opening|live|minimized|focused|closing|closed */;
SNew(SWonderWebObserverCard).View(View)   // or Card->SetView(View) on a change
```

- The outline resolves only from `#RRGGBB` (sRGB, as `FColor`). Anything else, or null, draws a neutral grey, never `#FFD400`.
- An empty owner name shows `Unnamed agent`. FORGE's own fallback is `Agent`, which passes through as given.
- The title is sanitised and capped at 160 bytes. A null title collapses its line.
- Open points for FORGE: the token format is unspecified in v1 (this reads `#RRGGBB` only). FORGE keeps a custom name
  `Grok` as given, while the window title (section 3) refuses a provider label as a name. The card shows whatever FORGE sends.

## 7. API added in this commit (no renames)

`EVisualIntent::RestoreUnfold`, `EVisualIntent::CameraReturn`, `ESessionState::Paused` (all appended), `EEndCause`,
`EAdmission`, `EWindowPhase`, `FForgeCue`, `FCuePlan`, `FObserverViewInput`, `FObserverLook`, `ParseEndCause`, `EndCauseName`,
`EndCauseBadge`, `EffectiveEndCause`, `ParseSessionState`, `ParseAdmission`, `ParsePhase`, `PhaseLabel`, `PlanForCue`,
`PlanForAdmission`, `VmEndedLeaveDelay`, `ParseColorToken`, `ResolveObserver`; Unreal half: `FWonderWebWindowIdentity::EndCause`,
`FWonderWebWindowLook::EndCause`, `FWonderWebObserverView`, `FWonderWebObserverLook`, `ResolveObserverLook`,
`VmEndedBadgeText`, `SWonderWebObserverCard`, `SWonderWebVmEndedVeil::Label`, `AWonderlandWonderWebScreen::ApplyCue`,
`ApplyIntent(EVisualIntent, EEndCause)`, `PresentQueuedChip`, `HasLeft`, `GetEndCause`, cvar `wl.WonderWeb.VmEndedHoldSeconds`.
Every name listed in sections 1 to 5 of the first commit is unchanged.
