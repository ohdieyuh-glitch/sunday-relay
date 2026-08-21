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
//   BATCHES=<count>            instanced-batch actors
//   INSTANCED_PIECES=<count>   pieces those batches declare
//   LOOSE_PIECES=<count>       static meshes still on their own actor
//   VISIBLE_PIECES=<count>     instanced + loose; THIS is the world-loaded gate
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

	/** A "there is nothing here at all" backstop. NOT the world-loaded signal
	 *  any more — batched decoration means the real world ships a few hundred
	 *  actors. Override with -WonderlandMinActors=N. */
	extern int32 GExpectedMinActors;

	/** THE floor that means "the built world loaded": instanced + loose static
	 *  mesh pieces, counted as the MAP declares them (this runs before
	 *  BeginPlay, so a batch's instances do not exist yet).
	 *  Override with -WonderlandMinPieces=N. */
	extern int32 GExpectedMinPieces;
}
