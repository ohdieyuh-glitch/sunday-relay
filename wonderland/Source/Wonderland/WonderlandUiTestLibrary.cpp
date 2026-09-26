#include "WonderlandUiTestLibrary.h"

#include "WonderlandDemoFlow.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandSubAgentCubs.h"

#include "Camera/CameraActor.h"
#include "EngineUtils.h"
#include "Camera/CameraComponent.h"
#include "Kismet/GameplayStatics.h"
#include "WonderlandCompanionEmbodiment.h"

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
#include "WonderlandMissionSubsystem.h"
#include "WonderlandMissionTasks.h"
#include "WonderlandUiSubsystem.h"
#include "WonderlandUsageSubsystem.h"

#if WITH_EDITOR
#include "Editor/EditorEngine.h"
#endif

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

	// Not `Known`: WonderlandUsagePreview.cpp has one with the same signature, and a unity build puts both in one
	// translation unit, where file-local names are not local at all.
	FWonderlandFigure KnownTestFigure(double Value)
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
		Meter.CapacityUnits = KnownTestFigure(Capacity);
		Meter.UsedUnits = KnownTestFigure(Spent);
		Meter.RemainingUnits = KnownTestFigure(Capacity - Spent);
		Meter.ReferenceCapacityUnits = KnownTestFigure(Reference);
		Meter.CapacitySpan = KnownTestFigure(Capacity / Reference);
		Meter.FillFraction = KnownTestFigure(Spent / Capacity);
		Meter.RemainingFraction = KnownTestFigure((Capacity - Spent) / Capacity);
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

namespace
{
	bool GWonderlandBackgroundThrottleSuspended = false;
	bool GWonderlandThrottleHookInstalled = false;
}

bool UWonderlandUiTestLibrary::SetBackgroundThrottleSuspended(bool bSuspended)
{
#if WITH_EDITOR
	UEditorEngine* Editor = Cast<UEditorEngine>(GEngine);
	if (Editor == nullptr)
	{
		return false;
	}
	if (!GWonderlandThrottleHookInstalled)
	{
		Editor->ShouldDisableCPUThrottlingDelegates.Add(
			UEditorEngine::FShouldDisableCPUThrottling::CreateLambda([]() { return GWonderlandBackgroundThrottleSuspended; }));
		GWonderlandThrottleHookInstalled = true;
	}
	GWonderlandBackgroundThrottleSuspended = bSuspended;
	return true;
#else
	return false;
#endif
}

/* ==================================================================== a comparison scene, for a proof */

UWonderlandMissionTaskSubsystem* UWonderlandUiTestLibrary::GetMissionTasks(UObject* WorldContextObject)
{
	const UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	const APlayerController* Controller = World != nullptr ? UGameplayStatics::GetPlayerController(World, 0) : nullptr;
	ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
	return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionTaskSubsystem>() : nullptr;
}

UWonderlandMissionSubsystem* UWonderlandUiTestLibrary::GetMission(UObject* WorldContextObject)
{
	const UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	const APlayerController* Controller = World != nullptr ? UGameplayStatics::GetPlayerController(World, 0) : nullptr;
	ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
	return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionSubsystem>() : nullptr;
}

UWonderlandDemoSubsystem* UWonderlandUiTestLibrary::GetDemo(UObject* WorldContextObject)
{
	UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	return World != nullptr ? World->GetSubsystem<UWonderlandDemoSubsystem>() : nullptr;
}

UWonderlandSubAgentCubSubsystem* UWonderlandUiTestLibrary::GetCubs(UObject* WorldContextObject)
{
	UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	return World != nullptr ? World->GetSubsystem<UWonderlandSubAgentCubSubsystem>() : nullptr;
}

AWonderlandCompanionEmbodiment* UWonderlandUiTestLibrary::SpawnFigureActor(UObject* WorldContextObject, FVector Location, const FString& FigurePath, const FString& Label)
{
	UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	if (World == nullptr)
	{
		return nullptr;
	}
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	AWonderlandCompanionEmbodiment* Body = World->SpawnActor<AWonderlandCompanionEmbodiment>(AWonderlandCompanionEmbodiment::StaticClass(), FTransform(Location), Params);
	if (Body == nullptr)
	{
		return nullptr;
	}
	Body->DisplayName = Label;
	Body->ClassLabel = TEXT("PROJECT AVATAR");
#if WITH_EDITOR
	Body->SetActorLabel(FString::Printf(TEXT("WL_ProjectAvatar_%s"), *Label.Replace(TEXT(" "), TEXT("_"))), false);
#endif
	// FOLLOWING NOBODY. No controller is given, so it stands where it was put: a comparison scene, not a companion.
	Body->LoadFigure(FigurePath);
	return Body;
}

bool UWonderlandUiTestLibrary::PoseCamera(UObject* WorldContextObject, FVector Location, FVector LookAt, float FieldOfView)
{
	UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	APlayerController* Controller = World != nullptr ? UGameplayStatics::GetPlayerController(World, 0) : nullptr;
	if (Controller == nullptr)
	{
		return false;
	}
	// ONE CAMERA, REUSED. Every shot in a family comes from the same actor, so nothing differs between them but the pose.
	static const FName ProofCameraName(TEXT("WL_ProofCamera"));
	ACameraActor* Camera = nullptr;
	for (TActorIterator<ACameraActor> It(World); It; ++It)
	{
		if (It->GetFName() == ProofCameraName)
		{
			Camera = *It;
			break;
		}
	}
	if (Camera == nullptr)
	{
		FActorSpawnParameters Params;
		Params.Name = ProofCameraName;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
		Camera = World->SpawnActor<ACameraActor>(ACameraActor::StaticClass(), FTransform(Location), Params);
		if (Camera == nullptr)
		{
			return false;
		}
	}
	const FRotator Facing = (LookAt - Location).Rotation();
	Camera->SetActorLocationAndRotation(Location, Facing, false, nullptr, ETeleportType::TeleportPhysics);
	if (UCameraComponent* Lens = Camera->GetCameraComponent())
	{
		Lens->SetConstraintAspectRatio(false);
		Lens->SetFieldOfView(FMath::Clamp(FieldOfView, 10.0f, 150.0f));
	}
	Controller->SetViewTargetWithBlend(Camera, 0.0f);
	return true;
}

bool UWonderlandUiTestLibrary::ReleaseCamera(UObject* WorldContextObject)
{
	UWorld* World = GEngine != nullptr ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	APlayerController* Controller = World != nullptr ? UGameplayStatics::GetPlayerController(World, 0) : nullptr;
	if (Controller == nullptr)
	{
		return false;
	}
	Controller->SetViewTargetWithBlend(Controller->GetPawn(), 0.0f);
	return true;
}

bool UWonderlandUiTestLibrary::ReadScreenRect(float MinX, float MinY, float MaxX, float MaxY,
	FLinearColor& OutMean, float& OutDarkFraction, float& OutBrightFraction, int32& OutSampled)
{
	OutMean = FLinearColor::Black;
	OutDarkFraction = 0.0f;
	OutBrightFraction = 0.0f;
	OutSampled = 0;
	if (!FSlateApplication::IsInitialized() || GEngine == nullptr || GEngine->GameViewport == nullptr)
	{
		return false;
	}
	// THE GAME LAYER, not the bare SViewport: the panel drawn OVER the world is half of what is being judged.
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
	if (!FSlateApplication::Get().TakeScreenshot(Target.ToSharedRef(), Pixels, Size)
		|| Size.X <= 0 || Size.Y <= 0 || Pixels.Num() != Size.X * Size.Y)
	{
		return false;
	}

	const int32 Left   = FMath::Clamp(FMath::FloorToInt(FMath::Min(MinX, MaxX) * Size.X), 0, Size.X - 1);
	const int32 Right  = FMath::Clamp(FMath::CeilToInt (FMath::Max(MinX, MaxX) * Size.X), Left + 1, Size.X);
	const int32 Top    = FMath::Clamp(FMath::FloorToInt(FMath::Min(MinY, MaxY) * Size.Y), 0, Size.Y - 1);
	const int32 Bottom = FMath::Clamp(FMath::CeilToInt (FMath::Max(MinY, MaxY) * Size.Y), Top + 1, Size.Y);

	const int32 Wide = Right - Left;
	const int32 Tall = Bottom - Top;
	const int32 StepX = FMath::Max(1, Wide / 100);
	const int32 StepY = FMath::Max(1, Tall / 100);

	double SumR = 0.0, SumG = 0.0, SumB = 0.0;
	int32 Dark = 0, Bright = 0, Count = 0;
	for (int32 Y = Top; Y < Bottom; Y += StepY)
	{
		for (int32 X = Left; X < Right; X += StepX)
		{
			const FColor& C = Pixels[Y * Size.X + X];
			const double R = C.R / 255.0, G = C.G / 255.0, B = C.B / 255.0;
			SumR += R; SumG += G; SumB += B;
			// Luma rather than a channel: a blue-black backdrop and a grey one are both "dark".
			const double Luma = 0.2126 * R + 0.7152 * G + 0.0722 * B;
			if (Luma < 0.14) { ++Dark; }
			if (Luma > 0.72) { ++Bright; }
			++Count;
		}
	}
	if (Count <= 0)
	{
		return false;
	}
	OutMean = FLinearColor(
		static_cast<float>(SumR / Count), static_cast<float>(SumG / Count), static_cast<float>(SumB / Count), 1.0f);
	OutDarkFraction = static_cast<float>(Dark) / static_cast<float>(Count);
	OutBrightFraction = static_cast<float>(Bright) / static_cast<float>(Count);
	OutSampled = Count;
	return true;
}

bool UWonderlandUiTestLibrary::PickMascotColour(bool bPrimary, FLinearColor Colour)
{
	UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>();
	if (Style == nullptr)
	{
		return false;
	}
	(bPrimary ? Style->Primary : Style->Secondary) = Colour;
	Style->bChosen = true;
	WonderlandMascotStyle::SaveAndApply();
	return true;
}

bool UWonderlandUiTestLibrary::PickCompanionColour(bool bPrimary, FLinearColor Colour)
{
	UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>();
	if (Style == nullptr)
	{
		return false;
	}
	(bPrimary ? Style->CompanionPrimary : Style->CompanionSecondary) = Colour;
	Style->bCompanionChosen = true;
	WonderlandMascotStyle::SaveAndApply();
	return true;
}

FLinearColor UWonderlandUiTestLibrary::GetMascotColour(bool bPrimary)
{
	const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
	return bPrimary ? Style.Primary : Style.Secondary;
}

FLinearColor UWonderlandUiTestLibrary::GetCompanionColour(bool bPrimary)
{
	const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
	return bPrimary ? Style.CompanionPrimary : Style.CompanionSecondary;
}

bool UWonderlandUiTestLibrary::ResetAllColours()
{
	UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>();
	if (Style == nullptr)
	{
		return false;
	}
	Style->Primary = FLinearColor::White;
	Style->Secondary = FLinearColor(1.00f, 0.78f, 0.16f, 1.0f);
	Style->bChosen = false;
	Style->CompanionPrimary = FLinearColor::White;
	Style->CompanionSecondary = FLinearColor(0.42f, 0.80f, 1.00f, 1.0f);
	Style->bCompanionChosen = false;
	WonderlandMascotStyle::SaveAndApply();
	return true;
}
