#include "WonderlandMascotStyle.h"

#include "RelayDogCharacter.h"
#include "WonderlandCompanionEmbodiment.h"
#include "Engine/Engine.h"
#include "Engine/World.h"
#include "EngineUtils.h"

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

	EWonderlandColorChannel ChannelFor(const FString& MaterialName)
	{
		const FString Name = MaterialName.ToLower();
		// THE EYES FIRST, because "eye" is the narrower claim and the visor is NOT one of them: it is the black
		// face the whole lineup is recognised by, and a secondary colour painted onto it would erase that.
		if (Name.Contains(TEXT("eye")) || Name.Contains(TEXT("pupil")))
		{
			return EWonderlandColorChannel::Eye;
		}
		// THE SHELL. Every skin in the lineup declares exactly these two and builds its own art on top of them,
		// so they are the one channel a colourway can move without touching anything authored.
		if (Name == TEXT("bone") || Name == TEXT("bonedeep"))
		{
			return EWonderlandColorChannel::Body;
		}
		return EWonderlandColorChannel::None;
	}

	const TArray<TPair<FName, FLinearColor>>& Palette()
	{
		// ONE SET, OFFERED IN BOTH PLACES. Chosen to read against Wonderland's ivory stone and against black:
		// a swatch that vanishes in the Wardrobe's preview square is not a choice, it is a trap. DEFAULT is
		// first and is how a player puts a skin back to the colours it was designed in.
		static const TArray<TPair<FName, FLinearColor>> Swatches = {
			{TEXT("DEFAULT"),  FLinearColor::White},
			{TEXT("BONE"),     FLinearColor(0.898f, 0.871f, 0.800f)},
			{TEXT("GOLD"),     FLinearColor(1.000f, 0.780f, 0.260f)},
			{TEXT("EMBER"),    FLinearColor(1.000f, 0.420f, 0.160f)},
			{TEXT("CRIMSON"),  FLinearColor(0.820f, 0.140f, 0.180f)},
			{TEXT("VIOLET"),   FLinearColor(0.560f, 0.340f, 0.960f)},
			{TEXT("AZURE"),    FLinearColor(0.260f, 0.560f, 1.000f)},
			{TEXT("CYAN"),     FLinearColor(0.300f, 0.900f, 1.000f)},
			{TEXT("JADE"),     FLinearColor(0.200f, 0.860f, 0.600f)},
			{TEXT("ROSE"),     FLinearColor(1.000f, 0.520f, 0.680f)},
			{TEXT("SLATE"),    FLinearColor(0.420f, 0.460f, 0.540f)},
			{TEXT("OBSIDIAN"), FLinearColor(0.140f, 0.150f, 0.190f)},
		};
		return Swatches;
	}

	FSimpleMulticastDelegate& OnChanged()
	{
		static FSimpleMulticastDelegate Changed;
		return Changed;
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
	/** Repaint every Relay Dog standing in a live world, and say how many there were.
	 *
	 * WHY THIS EXISTS. zc_mascot_persist read the colour back off the Dog's own material instances and found
	 * none at all -- not the wrong colour, no dynamic materials whatsoever. PaintCanonBody had exactly one
	 * caller, inside WearSkin on the canon branch, so choosing a colour saved a setting and touched nothing:
	 * the Dog already in the world kept its old materials until the player happened to re-wear Relay OG. The
	 * photographs missed it because opening the Wardrobe re-wears a skin, which repaints on the way past.
	 *
	 * Every world is walked rather than just the first: PIE can have more than one, and a console command
	 * the founder types should mean the same thing in all of them.
	 */
	int32 RepaintLiveDogs(bool bEvenIfUnchosen = false)
	{
		int32 Painted = 0;
		if (GEngine == nullptr)
		{
			return 0;
		}
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			UWorld* World = Context.World();
			if (World == nullptr || !World->IsGameWorld())
			{
				continue;
			}
			for (TActorIterator<ARelayDogCharacter> It(World); It; ++It)
			{
				It->PaintCanonBody(bEvenIfUnchosen);
				++Painted;
			}
		}
		return Painted;
	}

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
		const int32 Repainted = RepaintLiveDogs();
		UE_LOG(LogTemp, Display, TEXT("WLMASCOT %s = %s (saved, %d dog(s) repainted)"),
			bPrimary ? TEXT("PRIMARY") : TEXT("SECONDARY"), *Colour.ToString(), Repainted);
	}

	/** Repaint every AI Companion body standing in a live world. Cubs are NOT touched: they are not companions. */
	int32 RepaintLiveCompanions()
	{
		int32 Painted = 0;
		if (GEngine == nullptr)
		{
			return 0;
		}
		for (const FWorldContext& Context : GEngine->GetWorldContexts())
		{
			UWorld* World = Context.World();
			if (World == nullptr || !World->IsGameWorld())
			{
				continue;
			}
			for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
			{
				// EVERY BODY, INCLUDING THE DOG'S COSTUME AND THE WARDROBE'S MANNEQUIN, because all three wear
				// a colourway -- but each reads the colourway meant for it, which the embodiment decides from
				// what it is. A Sub-Agent Cub's body is left exactly as it is: the founder asked that companion
				// colour never reach a Cub, and a Cub is told apart here by the actor that owns it.
				It->RepaintColourway();
				++Painted;
			}
		}
		return Painted;
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
				// TRUE: reset has just written the designed colours and must put them ON, which a paint
				// that returns early on bChosen would not do -- that is what left magenta on the Dog.
				const int32 Repainted = RepaintLiveDogs(true);
				UE_LOG(LogTemp, Display, TEXT("WLMASCOT colours reset to the designed ones (%d dog(s) repainted)"),
					Repainted);
			}
		}));
}

namespace WonderlandMascotStyle
{
	void SaveAndApply()
	{
		if (UWonderlandMascotStyleSettings* Settings = GetMutableDefault<UWonderlandMascotStyleSettings>())
		{
			// SAVED IMMEDIATELY, because a colour the player picks and loses on exit is not a preference.
			Settings->SaveConfig();
		}
		// TRUE even when nothing has been chosen: this is also the path RESET takes, and a repaint that
		// returned early on bChosen is exactly what once left magenta on the Dog after a reset.
		RepaintLiveDogs(true);
		RepaintLiveCompanions();
		OnChanged().Broadcast();
	}
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
