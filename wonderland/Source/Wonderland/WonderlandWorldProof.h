// Runtime proof that the packaged build loaded the world that was built.
//
// WHY THIS EXISTS. The live stream worked and showed the wrong world: a simple
// blocky scene with proxy-looking pawns and almost none of the generated
// content. Every layer reported success, because every layer WAS succeeding —
// the package simply had no map pinned and opened the engine default. Nothing
// in the running client said which world it was in, so the only way to notice
// was for a person to look at a browser and recognise that it was wrong.
//
// These lines make the running build state it, at Warning level so they survive
// the packaged log's Display filtering:
//
//   WORLD=<map>
//   ACTORS=<count>
//   RELAY_DOGS=<count>
//   COMPOUND_AGENTS=<count>
//   PROXY_ACTORS=<count>
//
// A world far smaller than the generated one is announced as a MISMATCH rather
// than left for a human to spot.

#pragma once

#include "CoreMinimal.h"

DECLARE_LOG_CATEGORY_EXTERN(LogWonderlandProof, Log, All);

namespace WonderlandWorldProof
{
	/** Hook world begin-play. Called once from the module's StartupModule. */
	void Register();
	void Unregister();

	/** The expected floor. A world below this is reported as a mismatch. */
	extern int32 GExpectedMinActors;
}
