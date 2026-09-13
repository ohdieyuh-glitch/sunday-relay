#include "WonderlandUiTestLibrary.h"

#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "Engine/GameViewportClient.h"
#include "Framework/Application/SlateApplication.h"
#include "GameFramework/PlayerController.h"
#include "HAL/FileManager.h"
#include "ImageCore.h"
#include "ImageUtils.h"
#include "Misc/DateTime.h"
#include "Misc/Paths.h"
#include "Slate/SGameLayerManager.h"
#include "Widgets/SViewport.h"
#include "WonderlandUiSubsystem.h"
#include "WonderlandUsageSubsystem.h"

namespace
{
	bool SendKey(const FKey& Key, bool bDown, bool bControl, uint32 Character = 0)
	{
		if (!FSlateApplication::IsInitialized() || !Key.IsValid())
		{
			return false;
		}
		const FModifierKeysState Modifiers(false, false, bControl, false, false, false, false, false, false);
		const FKeyEvent Event(Key, Modifiers, 0, false, Character, 0);
		return bDown ? FSlateApplication::Get().ProcessKeyDownEvent(Event) : FSlateApplication::Get().ProcessKeyUpEvent(Event);
	}

	FKey KeyForCharacter(TCHAR Character)
	{
		if (Character == TEXT(' '))
		{
			return EKeys::SpaceBar;
		}
		if (FChar::IsAlpha(Character) || FChar::IsDigit(Character))
		{
			const TCHAR Upper = FChar::ToUpper(Character);
			if (FChar::IsDigit(Upper))
			{
				static const FName Digits[] = { "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine" };
				return FKey(Digits[Upper - TEXT('0')]);
			}
			return FKey(FName(FString(1, &Upper)));
		}
		return FKey();
	}

	FWonderlandFigure Known(double Value)
	{
		FWonderlandFigure Figure;
		Figure.bKnown = true;
		Figure.Value = Value;
		return Figure;
	}

	FWonderlandText KnownText(const FString& Value)
	{
		FWonderlandText Text;
		Text.bKnown = true;
		Text.Value = Value;
		return Text;
	}

	FWonderlandUsageMeter SimulatedMeter(EWonderlandUsageChannel Channel, double Capacity, double Reference, double Used,
		const FString& TierId, const FString& TierLabel)
	{
		const double Spent = FMath::Clamp(Used, 0.0, Capacity);
		FWonderlandUsageMeter Meter;
		Meter.SchemaVersion = TEXT("development-fixture");
		Meter.Channel = Channel;
		Meter.TierId = KnownText(TierId);
		Meter.TierLabel = KnownText(TierLabel);
		Meter.UnitLabel = KnownText(TEXT("WONDER"));
		Meter.CapacityUnits = Known(Capacity);
		Meter.UsedUnits = Known(Spent);
		Meter.RemainingUnits = Known(Capacity - Spent);
		Meter.ReferenceCapacityUnits = Known(Reference);
		Meter.CapacitySpan = Known(Capacity / Reference);
		Meter.FillFraction = Known(Spent / Capacity);
		Meter.RemainingFraction = Known((Capacity - Spent) / Capacity);
		Meter.Status = EWonderlandUsageStatus::Available;
		Meter.Provenance = EWonderlandProvenance::Simulated;
		Meter.bSimulated = true;
		Meter.ObservedAtIso = FDateTime::UtcNow().ToIso8601();
		return Meter;
	}
}

UWonderlandUiSubsystem* UWonderlandUiTestLibrary::GetUi(UObject* WorldContextObject)
{
	const UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	const APlayerController* Controller = World != nullptr ? World->GetFirstPlayerController() : nullptr;
	const ULocalPlayer* LocalPlayer = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
	return LocalPlayer != nullptr ? LocalPlayer->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
}

bool UWonderlandUiTestLibrary::PressKey(FName KeyName, bool bControl)
{
	const FKey Key(KeyName);
	if (!Key.IsValid())
	{
		return false;
	}
	if (bControl)
	{
		SendKey(EKeys::LeftControl, true, true);
	}
	SendKey(Key, true, bControl);
	SendKey(Key, false, bControl);
	if (bControl)
	{
		SendKey(EKeys::LeftControl, false, false);
	}
	return true;
}

bool UWonderlandUiTestLibrary::SetKeyHeld(FName KeyName, bool bDown)
{
	return SendKey(FKey(KeyName), bDown, false);
}

bool UWonderlandUiTestLibrary::TypeText(const FString& Text)
{
	if (!FSlateApplication::IsInitialized())
	{
		return false;
	}
	const FModifierKeysState NoModifiers(false, false, false, false, false, false, false, false, false);
	for (TCHAR Character : Text)
	{
		const FKey Key = KeyForCharacter(Character);
		if (Key.IsValid())
		{
			SendKey(Key, true, false, Character);
		}
		FSlateApplication::Get().ProcessKeyCharEvent(FCharacterEvent(Character, NoModifiers, 0, false));
		if (Key.IsValid())
		{
			SendKey(Key, false, false, Character);
		}
	}
	return true;
}

void UWonderlandUiTestLibrary::FocusGameViewport()
{
	if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetAllUserFocusToGameViewport();
	}
}

bool UWonderlandUiTestLibrary::CaptureGameViewport(const FString& FilePath, int32& OutWidth, int32& OutHeight)
{
	OutWidth = 0;
	OutHeight = 0;
	if (!FSlateApplication::IsInitialized() || GEngine == nullptr || GEngine->GameViewport == nullptr || FilePath.IsEmpty())
	{
		return false;
	}
	// The game layer holds the scene viewport AND every widget added over it (the usage
	// HUD, the terminal, the map). The bare SViewport is the fallback: scene only.
	TSharedPtr<SWidget> Target;
	if (TSharedPtr<IGameLayerManager> Layers = GEngine->GameViewport->GetGameLayerManager())
	{
		Target = StaticCastSharedPtr<SGameLayerManager>(Layers);
	}
	if (!Target.IsValid())
	{
		Target = GEngine->GameViewport->GetGameViewportWidget();
	}
	if (!Target.IsValid())
	{
		return false;
	}

	TArray<FColor> Pixels;
	FIntVector Size;
	if (!FSlateApplication::Get().TakeScreenshot(Target.ToSharedRef(), Pixels, Size) || Size.X <= 0 || Size.Y <= 0
		|| Pixels.Num() != Size.X * Size.Y)
	{
		return false;
	}
	for (FColor& Pixel : Pixels)
	{
		Pixel.A = 255;   // the back buffer's alpha is not coverage; a PNG would read it as transparency
	}
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(FilePath), true);
	if (!FImageUtils::SaveImageByExtension(*FilePath, FImageView(Pixels.GetData(), Size.X, Size.Y)))
	{
		return false;
	}
	OutWidth = Size.X;
	OutHeight = Size.Y;
	return true;
}

bool UWonderlandUiTestLibrary::ApplySimulatedUsageScene(UObject* WorldContextObject, FName Scene, bool bLargeTier)
{
	const UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	UGameInstance* GameInstance = World != nullptr ? World->GetGameInstance() : nullptr;
	UWonderlandUsageSubsystem* Usage = GameInstance != nullptr ? GameInstance->GetSubsystem<UWonderlandUsageSubsystem>() : nullptr;
	if (Usage == nullptr)
	{
		return false;
	}

	// The preview's scenes (scripts/wonderland-hud-preview.tsx) are spent units against each
	// channel's LARGEST fixture tier. They are applied here as the same FRACTION of whichever
	// tier is chosen, so "nearly spent" on the smaller tier is still nearly spent rather than
	// clamped to empty -- and the two tiers can be compared at the same scene.
	double CompoundSpentFraction = 186.0 / 480.0;
	double SingleSpentFraction = 78.0 / 120.0;
	if (Scene == FName(TEXT("nearly_spent")))
	{
		CompoundSpentFraction = 452.0 / 480.0;
		SingleSpentFraction = 116.0 / 120.0;
	}
	else if (Scene == FName(TEXT("untouched")))
	{
		CompoundSpentFraction = 0.0;
		SingleSpentFraction = 0.0;
	}
	else if (Scene != FName(TEXT("typical")))
	{
		return false;
	}

	// Fixture tiers from wonderland-usage-meter.ts: the reference is each channel's top tier,
	// so the smaller tier draws a physically shorter track.
	const double CompoundCapacity = bLargeTier ? 480.0 : 240.0;
	const double SingleCapacity = bLargeTier ? 120.0 : 60.0;
	const double CompoundUsed = FMath::RoundToDouble(CompoundSpentFraction * CompoundCapacity);
	const double SingleUsed = FMath::RoundToDouble(SingleSpentFraction * SingleCapacity);

	FWonderlandUsageHud Hud;
	Hud.SchemaVersion = TEXT("development-fixture");
	Hud.CompoundAgent = SimulatedMeter(EWonderlandUsageChannel::CompoundAgent, CompoundCapacity, 480.0, CompoundUsed,
		bLargeTier ? TEXT("fixture-compound-large") : TEXT("fixture-compound-small"),
		bLargeTier ? TEXT("FIXTURE \u00B7 COMPOUND III") : TEXT("FIXTURE \u00B7 COMPOUND I"));
	Hud.SingleAgent = SimulatedMeter(EWonderlandUsageChannel::SingleAgent, SingleCapacity, 120.0, SingleUsed,
		bLargeTier ? TEXT("fixture-single-large") : TEXT("fixture-single-small"),
		bLargeTier ? TEXT("FIXTURE \u00B7 SINGLE II") : TEXT("FIXTURE \u00B7 SINGLE I"));
	Hud.ObservedAtIso = FDateTime::UtcNow().ToIso8601();

	const FString Project = TEXT("wonderland-development-fixture");
	Usage->BindProject(Project);
	FWonderlandUsageAuthorityStatus Authority;
	Authority.Reading = EWonderlandUsageReading::Known;
	Authority.Reason = KnownText(TEXT("SIMULATED development fixture. No usage authority is reporting."));
	Authority.AuthorityId = KnownText(TEXT("development-fixture"));
	Authority.Revision = Usage->GetAppliedRevision() + 1;
	return Usage->ApplyUsage(Project, Hud, Authority) == EWonderlandOrderingVerdict::Applied;
}
