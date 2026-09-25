#include "WonderlandMascotStyle.h"

#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/ConfigCacheIni.h"
#include "HAL/IConsoleManager.h"

namespace WonderlandMascotStyle
{
	bool NamesAnEye(const FString& Name)
	{
		// MATCHED ON THE NAMES THE PROJECT ALREADY USES, rather than on a list this file invents: the canon
		// body's components, the figures' materials and the skins' parts all spell it the same way.
		return Name.Contains(TEXT("eye"), ESearchCase::IgnoreCase)
			|| Name.Contains(TEXT("visor"), ESearchCase::IgnoreCase)
			|| Name.Contains(TEXT("pupil"), ESearchCase::IgnoreCase);
	}

	void Tint(UMaterialInstanceDynamic* Instance, const FLinearColor& Colour)
	{
		if (Instance == nullptr)
		{
			return;
		}
		static const TCHAR* const Names[] = {
			TEXT("Color"), TEXT("BaseColor"), TEXT("Tint"), TEXT("EmissiveColor"), TEXT("RimColor"),
		};
		for (const TCHAR* Name : Names)
		{
			Instance->SetVectorParameterValue(Name, Colour);
		}
	}
}

namespace
{
	/** Parse "R,G,B" or "#RRGGBB" so the founder can try a colour without a rebuild. */
	bool ReadColour(const FString& Text, FLinearColor& Out)
	{
		FString Clean = Text.TrimStartAndEnd();
		if (Clean.StartsWith(TEXT("#")))
		{
			Out = FLinearColor(FColor::FromHex(Clean));
			return true;
		}
		TArray<FString> Parts;
		Clean.ParseIntoArray(Parts, TEXT(","), true);
		if (Parts.Num() < 3)
		{
			return false;
		}
		Out = FLinearColor(FCString::Atof(*Parts[0]), FCString::Atof(*Parts[1]), FCString::Atof(*Parts[2]), 1.0f);
		return true;
	}

	void SetAndSave(const TArray<FString>& Args, bool bPrimary)
	{
		UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>();
		if (Settings == nullptr || Args.Num() < 1)
		{
			UE_LOG(LogTemp, Warning, TEXT("WLMASCOT usage: wl.Mascot.%s <r,g,b | #RRGGBB>"),
				bPrimary ? TEXT("Primary") : TEXT("Secondary"));
			return;
		}
		FLinearColor Colour;
		if (!ReadColour(FString::Join(Args, TEXT("")), Colour))
		{
			UE_LOG(LogTemp, Warning, TEXT("WLMASCOT could not read a colour from '%s'"), *FString::Join(Args, TEXT(" ")));
			return;
		}
		(bPrimary ? Settings->Primary : Settings->Secondary) = Colour;
		Settings->bChosen = true;
		// SAVED IMMEDIATELY, because a colour the founder picks and loses on exit is not a preference.
		Settings->SaveConfig();
		UE_LOG(LogTemp, Display, TEXT("WLMASCOT %s = %s (saved)"),
			bPrimary ? TEXT("PRIMARY") : TEXT("SECONDARY"), *Colour.ToString());
	}

	FAutoConsoleCommand GMascotPrimary(
		TEXT("wl.Mascot.Primary"),
		TEXT("The mascot's main colourway: wl.Mascot.Primary <r,g,b | #RRGGBB>. Saved."),
		FConsoleCommandWithArgsDelegate::CreateStatic(&SetAndSave, true));

	FAutoConsoleCommand GMascotSecondary(
		TEXT("wl.Mascot.Secondary"),
		TEXT("The Relay Dog's eyes: wl.Mascot.Secondary <r,g,b | #RRGGBB>. Saved."),
		FConsoleCommandWithArgsDelegate::CreateStatic(&SetAndSave, false));

	FAutoConsoleCommand GMascotReset(
		TEXT("wl.Mascot.Reset"),
		TEXT("Put the mascot back to the colours its skins were designed in."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			if (UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>())
			{
				Settings->Primary = FLinearColor::White;
				Settings->Secondary = FLinearColor(1.00f, 0.78f, 0.16f, 1.0f);
				Settings->bChosen = false;
				Settings->SaveConfig();
				UE_LOG(LogTemp, Display, TEXT("WLMASCOT colours reset to the designed ones"));
			}
		}));
}

// ---------------------------------------------------------------------------------------------------------
// THE TERMINAL AND ACCENT THEME.
//
// Kept beside the mascot's colours because it is the same idea applied to the other half of the screen: one
// value, saved, that every surface reads rather than each remembering its own.
#include "WonderlandUiStyle.h"

namespace
{
	/** The gold that was hard-coded in WonderlandUiStyle.h, which is what an untouched install must still show. */
	FLinearColor GThemeAccent = FLinearColor(FColor(0xD9, 0xA4, 0x41));
	bool GThemeAccentLoaded = false;
}

namespace WonderlandUi
{
	FLinearColor ThemeAccent()
	{
		if (!GThemeAccentLoaded)
		{
			GThemeAccentLoaded = true;
			if (const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>())
			{
				if (Settings->bTerminalAccentChosen)
				{
					GThemeAccent = Settings->TerminalAccent;
				}
			}
		}
		return GThemeAccent;
	}
}

namespace
{
	FAutoConsoleCommand GTerminalAccent(
		TEXT("wl.Theme.Accent"),
		TEXT("The colour every terminal, preset command and accent is drawn in: wl.Theme.Accent <r,g,b | #RRGGBB>. Saved."),
		FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args)
		{
			UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>();
			// Initialised for the same reason as the rect above: unread unless ReadColour succeeded, but a
			// colour read off the stack would be a real bug rather than a warning.
			FLinearColor Colour = FLinearColor::White;
			if (Settings == nullptr || Args.Num() < 1 || !ReadColour(FString::Join(Args, TEXT("")), Colour))
			{
				UE_LOG(LogTemp, Warning, TEXT("WLTHEME usage: wl.Theme.Accent <r,g,b | #RRGGBB>"));
				return;
			}
			Settings->TerminalAccent = Colour;
			Settings->bTerminalAccentChosen = true;
			Settings->SaveConfig();
			GThemeAccent = Colour;
			GThemeAccentLoaded = true;
			// REBUILT, NOT WAITED FOR. The brushes that carry this colour are made once when a panel is
			// constructed, so a running terminal keeps the old gold until it is asked to build again.
			if (GEngine != nullptr)
			{
				GEngine->Exec(nullptr, TEXT("wl.Hud.Refresh"));
			}
			UE_LOG(LogTemp, Display, TEXT("WLTHEME accent = %s (saved)"), *Colour.ToString());
		}));

	FAutoConsoleCommand GTerminalAccentReset(
		TEXT("wl.Theme.Reset"),
		TEXT("Put every terminal and accent back to Wonderland's own gold."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			if (UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>())
			{
				Settings->bTerminalAccentChosen = false;
				Settings->SaveConfig();
			}
			GThemeAccent = FLinearColor(FColor(0xD9, 0xA4, 0x41));
			GThemeAccentLoaded = true;
			if (GEngine != nullptr) { GEngine->Exec(nullptr, TEXT("wl.Hud.Refresh")); }
			UE_LOG(LogTemp, Display, TEXT("WLTHEME accent reset to Wonderland gold"));
		}));
}
