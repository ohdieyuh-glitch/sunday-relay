#include "WonderlandGameMode.h"

#include "WonderlandPlayerController.h"

AWonderlandGameMode::AWonderlandGameMode()
{
	// The whole point of the class. Everything else stays at the engine
	// default on purpose — see the header.
	PlayerControllerClass = AWonderlandPlayerController::StaticClass();
}
