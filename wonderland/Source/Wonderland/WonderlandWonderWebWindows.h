// WONDERLAND — WONDER WEB WINDOWS.
//
// Window ids and the log category shared by WonderlandUiSubsystem.cpp and
// WonderlandWonderWebWindows.cpp. The window methods stay members of
// UWonderlandUiSubsystem and are defined in the .cpp. FWonderWebWindow, the
// UFUNCTION declarations and the window fields stay on the class: a UCLASS
// member cannot leave the class, and the moved definitions name
// UWonderlandUiSubsystem::FWonderWebWindow.
//
// LogWonderlandUi was file-static. A second translation unit cannot see a
// static category, and a unity build cannot define the category struct twice.
// It is declared here and defined once in WonderlandUiSubsystem.cpp. Verbosity
// is unchanged: Log, All.

#pragma once

#include "CoreMinimal.h"

#ifdef DECLARE_LOG_CATEGORY_EXTERN
DECLARE_LOG_CATEGORY_EXTERN(LogWonderlandUi, Log, All);
#endif

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderWebWindowIds
{
	const FName Creation(TEXT("creation"));
	const FName Connections(TEXT("connections"));
	const FName Browser(TEXT("browser"));
	/** How many browser windows may be open at once. Each one is a real page in the runtime, so this is a memory bound. */
	/**
	 * The highest number a browser window id may carry. Not a limit on how many may be open -- that is the account's
	 * entitlement -- just the range of names this build will answer to, so a typo cannot invent a window.
	 */
	constexpr int32 MaxBrowserId = 12;
}
