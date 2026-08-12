#include "WonderlandHubGameMode.h"

#include "WonderlandDogPawn.h"

AWonderlandHubGameMode::AWonderlandHubGameMode()
{
	// The Dog IS the player. A Blueprint subclass may restyle it; the C++
	// default guarantees a clean clone of this repository spawns one at all.
	DefaultPawnClass = AWonderlandDogPawn::StaticClass();
}
