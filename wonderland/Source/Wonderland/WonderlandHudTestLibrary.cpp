#include "WonderlandHudTestLibrary.h"

#include "Components/SceneCaptureComponent2D.h"
#include "Engine/Engine.h"
#include "Engine/GameViewportClient.h"
#include "Engine/SceneCapture2D.h"
#include "Engine/TextureRenderTarget2D.h"
#include "Engine/World.h"
#include "UObject/UObjectIterator.h"
#include "WonderlandUsageHudWidget.h"
#include "WonderlandCursor.h"
#include "Performance/EnginePerformanceTargets.h"
#include "UnrealClient.h"
#include "RenderCore.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/FileManager.h"
#include "ImageCore.h"
#include "ImageUtils.h"
#include "Misc/Paths.h"
#include "Slate/SGameLayerManager.h"
#include "Widgets/SViewport.h"

#if WITH_EDITOR
#include "Editor/EditorEngine.h"
#include "PlayInEditorDataTypes.h"
#include "Settings/LevelEditorPlaySettings.h"
#include "UObject/Package.h"
#endif

bool UWonderlandHudTestLibrary::RequestPlayInNewWindow(int32 Width, int32 Height)
{
#if WITH_EDITOR
	UEditorEngine* Editor = Cast<UEditorEngine>(GEngine);
	if (Editor == nullptr || Editor->IsPlayingSessionInEditor() || Editor->GetPIEWorldContext() != nullptr || Width < 320 || Height < 240)
	{
		return false;
	}
	// A private copy of the play settings: the session is sized, and nobody's saved settings change.
	ULevelEditorPlaySettings* Settings = DuplicateObject<ULevelEditorPlaySettings>(GetDefault<ULevelEditorPlaySettings>(), GetTransientPackage());
	Settings->NewWindowWidth = Width;
	Settings->NewWindowHeight = Height;
	Settings->NewWindowPosition = FIntPoint(-1, -1);

	FRequestPlaySessionParams Params;
	Params.SessionDestination = EPlaySessionDestinationType::InProcess;
	Params.WorldType = EPlaySessionWorldType::PlayInEditor;
	// No destination viewport: the session opens in a new window, at the copied settings' size.
	Params.EditorPlaySettings = Settings;
	Editor->RequestPlaySession(Params);
	return true;
#else
	return false;
#endif
}

bool UWonderlandHudTestLibrary::CaptureViewportJpeg(const FString& FilePath, int32 Width, int32 Quality)
{
	if (!FSlateApplication::IsInitialized() || GEngine == nullptr || GEngine->GameViewport == nullptr || FilePath.IsEmpty())
	{
		return false;
	}
	// The game layer holds the scene AND every widget over it, which is what a person watching sees.
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
		Pixel.A = 255;
	}
	IFileManager::Get().MakeDirectory(*FPaths::GetPath(FilePath), true);
	const FImageView View(Pixels.GetData(), Size.X, Size.Y);
	if (Width > 0 && Width < Size.X)
	{
		FImage Scaled;
		const int32 Height = FMath::Max(1, FMath::RoundToInt(static_cast<double>(Size.Y) * Width / Size.X));
		FImageCore::ResizeTo(View, Scaled, Width, Height, ERawImageFormat::BGRA8, EGammaSpace::sRGB);
		return FImageUtils::SaveImageByExtension(*FilePath, Scaled, FMath::Clamp(Quality, 1, 100));
	}
	return FImageUtils::SaveImageByExtension(*FilePath, View, FMath::Clamp(Quality, 1, 100));
}


bool UWonderlandHudTestLibrary::GetFrameCostMs(float& OutFrameMs, float& OutGameMs, float& OutRenderMs, float& OutGpuMs)
{
	OutFrameMs = OutGameMs = OutRenderMs = OutGpuMs = 0.0f;
	if (GEngine == nullptr || GEngine->GameViewport == nullptr)
	{
		return false;
	}
	// The same numbers `stat unit` prints, taken from the viewport that is actually drawing.
	FStatUnitData* Unit = GEngine->GameViewport->GetStatUnitData();
	if (Unit == nullptr)
	{
		return false;
	}
	OutFrameMs = Unit->FrameTime;
	OutGameMs = Unit->GameThreadTime;
	OutRenderMs = Unit->RenderThreadTime;
	OutGpuMs = Unit->GPUFrameTime[0];
	return true;
}

bool UWonderlandHudTestLibrary::GetDrawCallCount(int32& OutDrawCalls, int32& OutPrimitives)
{
	OutDrawCalls = GNumDrawCallsRHI[0];
	OutPrimitives = static_cast<int32>(GNumPrimitivesDrawnRHI[0]);
	return OutDrawCalls > 0 || OutPrimitives > 0;
}

ASceneCapture2D* UWonderlandHudTestLibrary::SpawnSceneCapture(UObject* WorldContextObject, FVector Location,
	FRotator Rotation, UTextureRenderTarget2D* Target)
{
	UWorld* World = GEngine != nullptr
		? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull)
		: nullptr;
	if (World == nullptr)
	{
		return nullptr;
	}

	FActorSpawnParameters Params;
	Params.ObjectFlags |= RF_Transient;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	ASceneCapture2D* Capture = World->SpawnActor<ASceneCapture2D>(
		ASceneCapture2D::StaticClass(), FTransform(Rotation, Location), Params);
	if (Capture == nullptr)
	{
		return nullptr;
	}

	if (USceneCaptureComponent2D* Component = Capture->GetCaptureComponent2D())
	{
		Component->TextureTarget = Target;
		// FINAL COLOUR, because the question is what a player sees -- a scene-colour capture would answer a
		// question about the renderer's intermediate state instead.
		Component->CaptureSource = ESceneCaptureSource::SCS_FinalColorLDR;
		// ON DEMAND. The proof decides when each frame is taken; a capture running every frame would make
		// "two frames one second apart" mean whatever the scheduler happened to do.
		Component->bCaptureEveryFrame = false;
		Component->bCaptureOnMovement = false;
	}
	return Capture;
}

TArray<FString> UWonderlandHudTestLibrary::GetPaintedAgentRows(UObject* WorldContextObject)
{
	TArray<FString> Rows;
	const UWorld* World = GEngine != nullptr
		? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull)
		: nullptr;
	if (World == nullptr)
	{
		return Rows;
	}

	for (TObjectIterator<UWonderlandUsageHudWidget> It; It; ++It)
	{
		const UWonderlandUsageHudWidget* Widget = *It;
		// THE RIGHT WORLD, and a live one. Play-in-editor keeps the editor's own widget objects alive
		// alongside the running game's, and a stale one would answer with rows nobody is looking at.
		if (Widget == nullptr || Widget->GetWorld() != World || Widget->HasAnyFlags(RF_ClassDefaultObject))
		{
			continue;
		}
		if (Widget->PaintedAgentRows.Num() > 0)
		{
			return Widget->PaintedAgentRows;
		}
	}
	return Rows;
}

FString UWonderlandHudTestLibrary::GetDrawnCursorShape()
{
	return WonderlandCursor::NameOf(WonderlandCursor::Chosen());
}

bool UWonderlandHudTestLibrary::IsDrawingWonderlandCursor(UObject* WorldContextObject)
{
	const UWorld* World = GEngine != nullptr
		? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull)
		: nullptr;
	UGameViewportClient* Viewport = World != nullptr ? World->GetGameViewport() : nullptr;
	// The viewport is the authority on whether a Wonderland pointer is on screen at all. The accessor is
	// GetIsUsingSoftwareCursorWidgets -- GetUseSoftwareCursorWidgets does not exist, which the compiler
	// said rather than the runtime, and that is the good case.
	return Viewport != nullptr && Viewport->GetIsUsingSoftwareCursorWidgets();
}
