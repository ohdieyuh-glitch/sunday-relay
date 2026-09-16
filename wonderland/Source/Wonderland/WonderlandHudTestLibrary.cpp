#include "WonderlandHudTestLibrary.h"

#include "Engine/Engine.h"

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
