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

## 2. The window manager drives the intents (in `WonderlandWonderWebWindows.cpp`, #420)

```cpp
#include "WonderlandWonderWebWindowLook.h"   // via WonderlandWonderWebScreen.h already
using WonderlandWonderWebWindowLook::EVisualIntent;
```

| Event | Today (#420 head) | With this branch |
|---|---|---|
| Window opens, the overlay was closed (first window) | `PresentWonderWebWindow` :275 `Screen->Present(...)` | `Screen->PresentWithIntent(Window.ContentSize, SWonderWebWindowChip::DesignSize(), WonderWebWorkspace.Get(), EVisualIntent::SpawnWithCloseUp);` The camera blend stays the caller's (`OpenOverlay`). |
| Window opens beside others | same line | `...PresentWithIntent(..., EVisualIntent::SpawnInline);` No camera move. |
| Minimize | `MinimizeWonderWebWindow` :523 `Screen->SetMinimized(true)` | Unchanged, or `Screen->ApplyIntent(EVisualIntent::Minimize)`; it is the same 0.3 s fold. Restore stays `SetMinimized(false)`. |
| User closes one window | `CloseWonderWebWindow` :499 `Screen->Dismiss()` | `Screen->ApplyIntent(EVisualIntent::Close);` This is the distinct close (shrink to 86% with a fade, `wl.WonderWeb.CloseSeconds` 0.22). It never shows VM ENDED. |
| Whole workspace closes (back to the Dog) | `WonderlandUiSubsystem.cpp` :1106 (#420) `Screen->Dismiss()` | Keep `Dismiss()`: the legacy fold. |
| VM really ended (session service says Ended/Failed) | none | `Screen->ApplyIntent(EVisualIntent::VmEnded);` The window stays, the glass dims (0.55) and a VM ENDED badge in the outline colour fades in over `wl.WonderWeb.VmEndedSeconds` 0.45. Only a spawn intent clears it. |

`Present()` and `Dismiss()` behave exactly as before for any caller that passes no intent.

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
Identity.State = /* ESessionState from the session service */;
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
