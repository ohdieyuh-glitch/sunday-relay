#include "WonderlandCompanionEmbodiment.h"

#include "Camera/PlayerCameraManager.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "ProceduralMeshComponent.h"
#include "Kismet/GameplayStatics.h"
#include "WonderlandMascotStyle.h"
#include "WonderlandSubAgentCubs.h"

namespace
{
	/** The three tiers the Project Avatar forge writes, coarsest first. */
	const TCHAR* const WonderlandFigureTiers[] = { TEXT("_Small"), TEXT("_Medium"), TEXT("_Large") };
}

#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Engine/Texture.h"
#include "Misc/FileHelper.h"
#include "HAL/FileManager.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandCompanion, Log, All);

namespace
{
	// ENGINE CONTENT FIRST. The lit and glowing parents ship with the engine, so a companion needs nothing
	// from the world's Content to be drawn. The one project parent is the V1 master material, cleared for
	// read-only use as a parent by the world build (2026-09-15); the V2 materials are world-space
	// triplanar and would swim on anything that floats, and they are the world's to tune.
	const TCHAR* const LitParentPath = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
	const TCHAR* const RimParentPath = TEXT("/Game/Wonderland/Materials/M_WLMaster.M_WLMaster");
	// THE GLOW PARENT, AND WHY IT IS THE PROJECT'S OWN.
	//
	// This used to be /Engine/EngineDebugMaterials/LevelColorationUnlitMaterial, and the first packaged build
	// Wonderland has ever had reported the consequence fourteen times: "material parent ... did not load;
	// drawing that material lit instead". It is an engine DEBUG material and is not cooked into a packaged
	// build, so Arden Infernal's fire, Skeleton Flame's fire and Celestial Light's glow would every one of
	// them have drawn LIT in the only build a player ever runs -- and no proof could see it, because PIE loads
	// editor content perfectly happily.
	//
	// The engine one is kept as a fallback purely so a tree without the asset still draws something rather
	// than nothing; zc_make_glow_material authors the real one.
	/**
	 * THE BRIGHTEST A FIGURE'S OWN LIGHT IS ALLOWED TO GET, and why there is a ceiling at all.
	 *
	 * FOUNDER, 2026-09-25: "the lighting is too bright and washed out. Reduce glare, bloom, and overexposure
	 * so the mascot skins are clearly visible. The same applies to the AI Agent companions and LLM
	 * companions. They should not be blown out by bright lighting." And, in the same breath: "Keep the
	 * current flame quality on the mascot skins. The flames finally look good. Do not regress them."
	 *
	 * Those two only look contradictory until the numbers are read. Measured across every figure this
	 * project ships:
	 *
	 *   flames and embers   4,000 - 4,800     <- the thing the founder says looks good
	 *   companion bases     5,200 - 10,400
	 *   starlight, edges   17,600 - 20,800
	 *   eyes               20,000 - 32,000    <- the starbursts
	 *
	 * The glare is not coming from the sun. It is coming from figures emitting up to thirty-two thousand
	 * times white and blooming across half the frame. Closing the world's exposure cannot fix that -- it only
	 * darkens the world AROUND the blown figure, which is exactly what the first attempt at this did.
	 *
	 * So the top end is compressed and the bottom is left alone. Below the knee nothing changes at all, which
	 * is what keeps every flame in the project bit-identical to the version the founder approved. Above it,
	 * the fourth root pulls 32,000 down to about 9,100 while keeping the ORDER intact, so an eye still reads
	 * brighter than a body and a halo still reads brighter than cloth.
	 */
	/**
	 * 700, CHOSEN BY SWEEPING IT IN A LIVE SESSION (zc_glow_sweep), not picked.
	 *
	 * The ladder, measured on the LLM Companion filling the frame -- the worst case in the project, because
	 * its wings, tail, gems and body are ALL glow:
	 *
	 *     knee   clipped   mean
	 *     6000     4.17%   74.4     washed; the figure is a white shape
	 *     1800     3.57%   65.2     better, still glow-washed over the armour
	 *      700     3.57%   61.5     crown, face, gold trim AND the eyes read
	 *      220     1.79%   58.6     crispest body, but the eyes go dark
	 *
	 * The clipped fraction barely moves across the whole range, which is the useful finding: the last few
	 * per cent of clipping in that frame are the FLAMES, and they are supposed to clip. So the number could
	 * not be chosen by the metric alone, and the pictures decided between 220 and 700 -- 220 is crisper but
	 * kills the glowing eyes, which are a feature rather than glare.
	 */
	/**
	 * THE LEVEL A SHOWCASE FIGURE'S EYES ARE DRIVEN TO, and why it is a knob now.
	 *
	 * The preview eye is computed as (Authored / Peak) * EyeGlowScale * GlowScale * HaloShare -- so although
	 * the comment below calls it "driven to a level", it is still MULTIPLIED by the wardrobe's own glow
	 * reduction. 14 was chosen when that reduction was 0.10, for "14 x 0.10 = 1.4 against a stage white near
	 * 2". The reduction has since gone to 0.001 and then, measured, to 0.0002. Nobody retuned this, so the
	 * product is now 0.0028 rather than 1.4.
	 *
	 * THE RENDERED RESULT IS NEVERTHELESS CORRECT, WHICH IS WHY THIS IS A KNOB AND NOT A FIX. Photographed at
	 * both values, the eye band against the face below it:
	 *
	 *     glow 0.0010   eye 0.916   face 0.932   eye-over-face -0.016   both pinned, no contrast at all
	 *     glow 0.0002   eye 0.790   face 0.724   eye-over-face +0.066   a coloured core standing off the face
	 *
	 * The founder's requirement is "clear contrast against the face" and "individually readable rather than
	 * one blown-out light", and the second row is the one that satisfies it. The arithmetic looks alarming
	 * and the picture is right, which is the reverse of the usual trap and the reason not to "correct" a
	 * number that is currently producing the wanted image.
	 *
	 * WHAT IT IS FOR: item 6 asks that SECONDARY colour the eyes. It reaches them -- the eye material carries
	 * the Eye channel and Want *= Secondary runs -- but the eye's EMISSIVE contribution is small enough at
	 * this product that the tint cannot show against the lamp-lit surface, so the proof measures no colour
	 * change. Settling that needs a sweep of this level against three things at once: the eye-over-face
	 * contrast, whether the eye clips, and whether SECONDARY becomes visible. That is a measurement, not an
	 * arithmetic correction, and it needs the level to be movable from a job.
	 */
	TAutoConsoleVariable<float> CVarPreviewEyeGlow(
		TEXT("wl.Look.PreviewEyeGlow"),
		14.0f,
		TEXT("The level a showcase figure's eyes are driven to before the wardrobe's own glow reduction is "
		     "applied. Shipped at 14, the value chosen when that reduction was 0.10."),
		ECVF_Default);

	TAutoConsoleVariable<float> CVarGlowKnee(
		// ---- TRIED AT 30, REVERTED TO 700, AND THE ATTEMPT IS WORTH KEEPING WRITTEN DOWN.
		//
		// Celestial Light's eyes read DARKER than its own face at every hour -- over_face -0.2167 / -0.1181 /
		// -0.1587. Its face materials are authored at edge 20,800 and starlight 17,600, which at a knee of 700
		// render around 1161 against a white point near 25, so the face was forty-six times past clipping. The
		// obvious reading was "compress the body glow until the face stops clipping", and it is wrong.
		//
		// SWEPT 700 / 120 / 30 / 8 and measured. At 30 Celestial's face does come down, 0.999 to 0.453, and its
		// over_face turns positive. But re-running the full eye gate showed the cost: RELAY OG, whose body is
		// not a glow material at all, lost its dusk and night margin entirely -- over +0.054 to -0.022 at dusk,
		// +0.058 to -0.016 at night. Fixing the skin that was broken broke the skin that worked.
		//
		// AND IT WAS NEVER GOING TO FIX CELESTIAL ANYWAY, which the sweep itself said if read carefully: its
		// "eye" reading tracked the knee, 0.842 to 0.527 to 0.271. A real eye cannot do that. The eye branch
		// normalises by peak and multiplies by an absolute level, so it is knee-INDEPENDENT -- Relay OG's is.
		// A reading that moves with the knee is not reading an eye.
		//
		// THE ACTUAL CAUSE, from the figure file. On Celestial Light's head: eye n=2 at z 19.1, edge n=45
		// spanning z 15.6-25.5, starlight n=18 spanning z 19.4-25.6. Two eye boxes inside sixty-three boxes of
		// head glow at the same height. Relay OG's head carries eye n=2 and NO glow material at all, which is
		// exactly why it is the only skin whose eyes have never failed. Celestial's eyes are not dim -- they are
		// surrounded and overlapped by the skin's own luminous head, and no global curve can separate them.
		//
		// That is authored art and belongs in the generator, not in this constant. Left at 700.
		TEXT("wl.Look.GlowKnee"), 700.0f,
		TEXT("Brightness at which a figure's BODY glow starts being compressed. Flames are never compressed."));
	TAutoConsoleVariable<float> CVarGlowCurve(
		TEXT("wl.Look.GlowCurve"), 0.15f,
		TEXT("How hard body glow is compressed above the knee. 1 = no compression, 0 = hard ceiling."));

	/**
	 * HOW FAR THE FLAMES COME DOWN (founder, 2026-09-25): "Don't overexaggerate on the flames either, the
	 * flames look good, just dim them down a bit."
	 *
	 * So they are NOT compressed like a body is -- the shape, the flicker and the falloff that the founder
	 * approved are all untouched -- they are simply scaled. A plain multiplier keeps every relative value
	 * inside the fire intact: an ember that was brighter than its neighbour still is.
	 */
	/**
	 * WHAT A FLAME IS WORTH ON THE FIRE MATERIAL, which is a different question from what it was worth on a
	 * flat unlit card.
	 *
	 * The figures author their fires at two to five THOUSAND times white, and that was survivable when the
	 * ribbons were drawn in an opaque unlit material that simply clipped. M_WL_Fire is ADDITIVE and shaped:
	 * the value passes straight through, so the same number puts the entire foot of every tongue over white
	 * and erases the falloff and the flicker the material exists to draw. Measured on the first build: 88% of
	 * Arden's foot band and 94% of Skeleton Flame's were over white.
	 *
	 * THE SQUARE ROOT IS THE POINT. The authored strengths span 2,400 to 32,000 and their RATIOS are the
	 * artist's intent -- an ember that is brighter than its neighbour must stay brighter. A square root keeps
	 * the ordering and compresses the range into one a shaped additive surface can draw, which a flat scale
	 * cannot: any scale small enough for 32,000 makes 2,400 invisible.
	 */
	/**
	 * HOW MANY TONGUES A FLAME PART BURNS WITH, and how far they reach.
	 *
	 * FOUNDER, 2026-09-26: "bring the flames back to the mascot skins." Moving the ribbons onto the fire
	 * material made every tongue softer and narrower, and the honest result of that is LESS fire on screen --
	 * each tongue now fades out at its tip and at both edges instead of being a solid card, so five of them
	 * read as a few licks where five cards read as a blaze. The shape is right and there is not enough of it.
	 *
	 * Both are CVars so the pair can be swept together in one play session against wl.Look.Reglow, which is
	 * how the gain was found; guessing either of them costs a build.
	 */
	/**
	 * WHICH SURFACE THE FLAME RIBBONS ARE DRAWN ON -- and it is ON, which is the founder's P0 item 4 arriving.
	 *
	 * FOUNDER: "believable animated Unreal fire, not plastic voxel flames ... flicker, emissive falloff,
	 * softness/distortion, proper attachment." And then, after the first attempt at it: "bring the flames back
	 * to the mascot skins."
	 *
	 * THE RETREAT AND WHY IT IS OVER. Moving the ribbons onto M_WL_Fire appeared to take the flames off the
	 * mascots entirely, and the honest thing at the time was to put them back on the old surface and say so.
	 * The diagnosis was wrong in an instructive way: I had concluded "the material is not drawing" from a
	 * capture, and both halves of that were false.
	 *
	 * WHAT IT ACTUALLY WAS, read off the section rather than guessed at (DescribeFlames). Nothing structural
	 * was broken -- two sections, visible, 768 vertices, wearing MID_M_WL_Fire, UVs running 0 to 1 exactly.
	 * The same ribbon was simply handed Color (264.0, 89.8, 13.2) on the voxel glow and (12.4, 4.2, 0.6) here,
	 * and the voxel glow then multiplies by a large internal emissive exposure this material has no equivalent
	 * of, while the shape terms multiply DOWN by about six. The ribbons were always drawing, about three
	 * orders of magnitude too faint to see -- which is exactly why cranking the gain to thirty read as "still
	 * nothing" instead of as progress, and why the slab test that would have caught it measured empty air.
	 *
	 * THE COMPARISON THAT DECIDED IT, both photographed at 21:00 in one session. On the voxel glow Arden
	 * Infernal is an opaque yellow-white plume with 63% of the figure clipped to white and no mascot visible
	 * inside it at all -- the founder's "plastic voxel flames", precisely. On this material at the calibrated
	 * gain the figure is 26% clipped, the Dog reads through its own fire, and the flame has an orange-to-gold
	 * gradient, a soft edge, a taper and bands of flicker climbing it. Dimmer by the meter, and far more like
	 * fire.
	 */
	// ---- BACK TO 0: THE BLACK FLAMES WERE NEVER REQUESTED. FOUNDER, 2026-09-28 (correction pass):
	//
	//   "The BLACK FLAMES were NEVER requested ... Remove/revert the unwanted black-flame change. I previously
	//    had a SECOND flame treatment that was correct: DETAILED BLUE + WHITE FLAMES. That is the flame design
	//    I want restored."
	//
	// THE BLACK FLAMES WERE THIS SWITCH. Shipping 1 (78826f13, "I approved the real fire") put every flame on
	// M_WL_Fire, and zc_fire_shipped's own photograph of it shows what that looks like in the world: Skeleton
	// Flame wrapped in dark, smoke-edged tongues (captures/zc/fire_shipped/default_skeleton_flame.png). The
	// same run with the switch forced to 0 shows the ribbons as the founder approved them on 2026-09-26 --
	// "these are the flames I need back" -- layered cyan-blue tongues with white flame inside, rising above
	// the shoulders (forced_off_skeleton_flame.png). That run's clauses only COUNTED fire instances; nobody
	// looked at the colour, which is how a black fire shipped as "the approved fire".
	//
	// WHY M_WL_Fire DRAWS BLACK, so nobody reads the switch as a taste question: it is TRANSLUCENT, and its
	// emissive IS its Color -- no EmissiveStrength term, no x1000. The ribbons hand it sqrt(strength) x FireGain
	// x FlameDim, about 75 for a ghost ember, against a world whose white is near 25,000 scene units (see
	// WonderlandSceneUnits). A translucent surface that covers the background with a near-black emissive is a
	// black silhouette with a torn, smoky edge -- which is exactly what the capture shows, at every hour.
	//
	// THE SECOND TREATMENT IS THE ONE THIS RESTORES, unchanged: the ribbons on the figure's own glow material,
	// FireTongues 8 and FireReach 1.18 (set together with it on 09-26 and never moved since), FlameDim 0.40
	// (the founder's 09-27 dim), each skin's deep ember outside and its pale ember as the hot core inside. Every
	// flame skin gets the same construction in its own palette, which is the founder's "same detailed flame
	// language, different colours". M_WL_Fire stays on disk and one console variable away; it is not deleted,
	// only no longer what a player sees.
	TAutoConsoleVariable<int32> CVarFireMaterial(
		TEXT("wl.Look.FireMaterial"), 0,
		TEXT("0 (shipped) draws flame ribbons on the figure's own glow material -- the founder's layered blue/white "
		     "ghostfire. 1 draws them on M_WL_Fire, which renders BLACK in the world (its Color carries no scene scale)."));

	TAutoConsoleVariable<int32> CVarFireTongues(
		TEXT("wl.Look.FireTongues"), 8,
		TEXT("Tongues per flame part. More is a fuller fire; the cost is a few hundred triangles a figure."));
	TAutoConsoleVariable<float> CVarFireReach(
		TEXT("wl.Look.FireReach"), 1.18f,
		TEXT("Scale on flame height and width. 1 = as the figure authored it."));

	TAutoConsoleVariable<float> CVarFireGain(
		// SWEPT RATHER THAN CHOSEN, TWICE, and the second sweep is the one that counts.
		//
		// The first walked 0.12 to 6.0 and concluded 1.6-2.3, which was measuring the wrong thing: at those
		// values the ribbons are three orders of magnitude below the surface they used to be drawn on, and the
		// whole range looked identically dark. zc_fire_calibrate walks 2.3 to 420 instead, on both flame
		// skins, at night, against the ground beside the figure. Arden Infernal: 0.076 luma at 2.3, 0.19 at
		// 12, 0.36 at 45, 0.49 at 140, 0.61 at 420 -- monotonic the whole way, which is what finally proved
		// the ribbons had been drawing all along.
		//
		// 60, AND THE SECOND OPINION IS WHY IT IS NOT 200. The sweep above judged the whole FIGURE's rectangle,
		// where a bright flame is averaged against a lot of unlit dog; zc_fire_look judges the FIRE's own
		// crop, which is the harsher and more honest question -- does the flame keep its colour, or has it
		// gone white? At 200 it answered 0.87 and 0.91 over white against a 0.45 ceiling: washed out. The two
		// instruments do not disagree, they are asking about different rectangles, and the tighter one
		// governs, because a flame that is white in close-up is the plastic look however good the wide shot is.
		TEXT("wl.Look.FireGain"), 60.0f,
		TEXT("Brightness of a flame ribbon on M_WL_Fire, against the square root of its authored strength."));

	/**
	 * WHETHER A FIGURE'S BOXES GO IN A HIERARCHICAL INSTANCED COMPONENT OR A PLAIN ONE.
	 *
	 * FOUNDER, P0 item 5: "Test 0/1/5/10 avatars and optimize remaining spawn/render cost."
	 *
	 * WHAT THE LADDER ACTUALLY MEASURED, once the readings were separated properly. One Large Project Avatar
	 * costs 18.7 ms of frame; HIDING it gives back 15.5 of those and turning off its shadows gives back 0.8.
	 * So the cost is neither the animator, nor the ticking, nor the shadows, nor having the actor at all -- it
	 * is submitting the thing to be drawn, across roughly seventy movable components and 31,900 instances.
	 *
	 * HISM WAS CHOSEN FOR THAT AND HAD NEVER BEEN A/B'D. Its per-instance quadtree culling is worth having
	 * when instances are spread over a landscape; every instance in one of these components is inside a volume
	 * about the size of a shoe, moves with the component, and is either all visible or all not, so the tree
	 * looked like pure upkeep.
	 *
	 * MEASURED, AND IT IS NOT THE ANSWER -- which is worth writing down so nobody spends another afternoon on
	 * it. zc_avatar_hism prices one avatar four times in a single session, out and back: hierarchical cost
	 * 14.16 ms and then 14.05 ms, plain cost 13.47 ms and then 9.89 ms. Plain looks 2.4 ms cheaper on the
	 * average and its own two passes disagree by 3.6, so the gap is smaller than the noise it is drawn from
	 * and the honest reading is that the two are indistinguishable on this hardware. The default stays where
	 * it was, because there is no evidence to move it.
	 *
	 * WHAT THAT LEAVES. The 15.5 ms is not the animator, not the ticking, not the shadows, not the actor, and
	 * not the tree. It is the plain fact of submitting 58 movable components and ~31,900 instances, and the
	 * only lever left that does not touch the art is the tier system -- which already works, and is why ten
	 * avatars cost less than one: the crowd budget drops them all to Small. The open question for the founder
	 * is whether a single hero avatar needs to be Large at all.
	 */
	TAutoConsoleVariable<int32> CVarFigureDistanceField(
		TEXT("wl.Figure.DistanceField"), 0,
		TEXT("Whether figures contribute to the global distance field. 0 removes them from an update that is "
		     "paid on the frame a figure registers its components."),
		ECVF_Default);

	TAutoConsoleVariable<int32> CVarFigureHism(
		TEXT("wl.Figure.Hism"), 1,
		TEXT("1 builds figure parts as hierarchical instanced meshes; 0 as plain instanced meshes."));

	TAutoConsoleVariable<float> CVarFlameDim(
		// FOUNDER, 2026-09-27: "Dim down the flames a bit on the skeleton and arden mascot skins."
		//
		// 0.55 to 0.40, which is a bit rather than a lot -- the founder asked for less fire, not for the
		// fire to go away, and these two skins ARE their fire. Arden Infernal is the ember mane and the
		// tail; Skeleton Flame is the ghostfire off the ears, the flanks and the back.
		//
		// THIS KNOB AND NOT ONE OF THE OTHERS, deliberately. It scales flame brightness only: shape, flicker,
		// taper and falloff are untouched, so the fire still moves and reads as fire rather than becoming a
		// dimmer card. And it reaches exactly the two skins named -- the flame surface is built from parts
		// with Twinkle motion, which Arden and Skeleton Flame have and the others do not. Measured on
		// Celestial Light: sources=0. So no other skin in the lineup changes.
		//
		// Not FireGain, which was swept against the fire material and moving it would re-open a calibration
		// that took two sweeps to settle. Not PreviewGlow, which is the wardrobe camera only and would dim
		// the picture while leaving the world untouched.
		// THE FLOOR WAS 0.05 AND THAT IS NOT LOW ENOUGH TO REACH THE ANSWER.
		//
		// FOUNDER, 2026-09-27, second pass: the flames are STILL too intense. The arithmetic says why the
		// first dim could not have been enough. Skeleton Flame's ghost embers are authored at 2,800 and
		// 4,800; on the fire master that is sqrt(2800) * FireGain 60 * Dim, so at 0.40 the surface is
		// driven to about 1,270 and 1,663. In this scene a strength of 1.0 renders at luma 0.039, so white
		// pins near 25. The flame is fifty to sixty-six times past clipping, and at the old clamp floor of
		// 0.05 it would still be six times past it. A knob that cannot reach the answer at either end of
		// its range cannot be swept, and everything the founder reported -- the silhouette swallowed, the
		// eyes and the chest skull unreadable, bloom eating what is next to the figure -- is what a surface
		// sixty times over white looks like.
		//
		// So the floor comes down to 0.004, which puts the reachable range either side of the white point
		// instead of entirely above it, and the value itself is chosen by zc_flame_dim from captures rather
		// than picked here. Fire SHOULD clip in its core -- that is what white-hot looks like -- but a
		// figure whose every surface clips has no fire in it, only a white shape.
		TEXT("wl.Look.FlameDim"), 0.40f,
		TEXT("Scale on flame brightness. 1 = as authored. Shape and flicker are never touched."));

	/**
	 * HOW BRIGHT A FLAME SURFACE IS, ASKED IN ONE PLACE.
	 *
	 * There were two copies of this and they did not agree. The build path used the fire master's curve
	 * -- sqrt(Strength) * FireGain * Dim -- when the project had the fire material, and the flat card's
	 * Strength * Dim when it did not. RepaintColourway used the FLAT formula unconditionally, whatever
	 * the twins had actually been built on.
	 *
	 * So picking a colourway silently moved every flame in the game off the curve it was calibrated on,
	 * and -- the reason this had to be fixed before the dim could be swept at all -- any change to
	 * FireGain was thrown away the first time a colour was chosen. A sweep whose result a recolour
	 * quietly reverts is not evidence.
	 */
	float WonderlandFlameStrength(float Strength, bool bFireMaster)
	{
		const float Dim = FMath::Clamp(CVarFlameDim.GetValueOnAnyThread(), 0.004f, 4.0f);
		const float Authored = FMath::Max(Strength, 0.0f);
		// The fallback card (no fire master, reachable with `wl.Look.FireMaterial 0`, the shipped state again since 2026-09-28) used to
		// be Authored x Dim, calibrated when both that and EmissiveStrength carried the authored strength. With
		// EmissiveStrength pinned at WonderlandSceneUnits, 4.2 x 0.4 = 1.7 is 1,700 scene units -- a dark teal
		// against a 25,000 white, which is what the ghostfire photographed as. x12 lands the ember at about
		// 20,000: bright, coloured, just under white, with the founder's FlameDim still the knob.
		return bFireMaster
			? FMath::Sqrt(Authored) * FMath::Max(CVarFireGain.GetValueOnAnyThread(), 0.001f) * Dim
			: Authored * Dim * 3.0f;   // x3 at generator scale 15: a ghost ember 10.5 x 0.4 x 3 = 12,600 -- lit, coloured, under white
	}

	/**
	 * THE WORLD'S WHITE IS NEAR 25,000 EMISSIVE UNITS, NOT 25.
	 *
	 * Found the hard way. The post-process volume holds the noon exposure at EV100 14.2, at which a sunlit
	 * ivory wall sits around 20,000 in scene units, so an emissive of 18 -- the eye level, on an unlit
	 * material whose output IS its Color -- is a thousand times darker than the stone beside it and
	 * photographs black. Every number in this file had been reasoned against a white of 25, taken from a
	 * rim surface whose material carries its own x1000 inside. M_WL_VoxelGlow gets its thousand from the
	 * EmissiveStrength parameter, which is why the eyes read at level 12 as long as that parameter carried
	 * 1,242 and went black the moment the glow scale came down; the additive material has no such
	 * parameter, so its Color must carry the thousand itself. This is that thousand, written once.
	 */
	constexpr float WonderlandSceneUnits = 1000.0f;

	float WonderlandTameGlow(float Strength)
	{
		const float Knee = FMath::Max(CVarGlowKnee.GetValueOnAnyThread(), 1.0f);
		const float Curve = FMath::Clamp(CVarGlowCurve.GetValueOnAnyThread(), 0.0f, 1.0f);
		if (!(Strength > Knee))
		{
			return FMath::Max(Strength, 0.0f);
		}
		return Knee * FMath::Pow(Strength / Knee, Curve);
	}

	const TCHAR* const GlowParentPath = TEXT("/Game/Wonderland/Materials/M_WL_VoxelGlow.M_WL_VoxelGlow");
	const TCHAR* const GlowFallbackPath = TEXT("/Engine/EngineDebugMaterials/LevelColorationUnlitMaterial.LevelColorationUnlitMaterial");
	// THE PROJECT'S OWN ADDITIVE MATERIAL, not the engine's.
	//
	// This pointed at /Engine/EngineMaterials/EmissiveMeshMaterial, and the engine answered on every load:
	//
	//     LogMaterial: Material EmissiveMeshMaterial missing usage flag InstancedStaticMeshes!
	//                  Default Material will be used in game.
	//
	// The figures draw through instanced components, so that flag is not optional for them, and the halos
	// were being replaced by the default material in a packaged build. Usage flags cannot be set on engine
	// content -- it is not ours to resave and the flag would not travel with the project -- so
	// M_WL_VoxelAdditive is ours: unlit, additive, flagged for instanced static meshes, carrying the same
	// "Color" parameter this file already writes into every instance.
	//
	// The engine material is kept as a fallback for the same reason the engine cube is: a project that has
	// not run the asset job should still show a companion, just without the flag.
	/**
	 * THE FIRE MATERIAL, and it is the flame RIBBONS' parent and nothing else's.
	 *
	 * FOUNDER, P0 item 4: "believable animated Unreal fire, not plastic voxel flames ... flicker, emissive
	 * falloff, softness/distortion." The ribbons were already the right SHAPE -- tapered, crossed, licking on
	 * a three-octave flicker -- and were being painted in the figure's own opaque unlit glow material, so a
	 * beautifully shaped tongue of flame was drawn as a hard-edged coloured card. That is the plastic.
	 *
	 * M_WL_Fire (Tools/editor_jobs/zc_make_fire_material.py) is additive, unlit, two-sided, and reads the UVs
	 * RebuildFlames already writes: V runs 0 at the foot of a tongue to 1 at its tip, U across the ribbon. It
	 * fades out at the tip, softens to nothing at both edges, and scrolls leaning bands up through the flame.
	 * Its colour parameter is called "Color", which is what every existing writer already sets -- the
	 * colourway, the heartbeat and the wardrobe's glow scale all reach it without being told about it.
	 *
	 * BODY BOXES DO NOT USE IT. A glow material on a cube still has to read as a solid lit block.
	 */
	const TCHAR* const FireParentPath = TEXT("/Game/Wonderland/Materials/M_WL_Fire.M_WL_Fire");

	const TCHAR* const AdditiveParentPath = TEXT("/Game/Wonderland/Materials/M_WL_VoxelAdditive.M_WL_VoxelAdditive");
	/** THE EYE'S SPILL. M_WL_EyeHalo (Tools/editor_jobs/zc_make_eye_halo_material.py) is additive and unlit like
	 *  M_WL_VoxelAdditive, but instead of a flat Color across the whole face it fades radially from the centre of
	 *  the pane to nothing at its edge. Round 3 drew the "eyehalo" panes flat and photographed them as olive
	 *  frames round a lit square -- a plate, not a light. A light is its colour spilling off it and dying away,
	 *  and this is the surface that does that. Missing (a tree before the asset job), the halo falls back to
	 *  the flat additive at the flat additive's share, and still draws. */
	const TCHAR* const EyeHaloParentPath = TEXT("/Game/Wonderland/Materials/M_WL_EyeHalo.M_WL_EyeHalo");

	/** THE COLOUR A GLOW ANIMATOR MUST REMEMBER, which is not always the colour the painter chose.
	 *
	 *  M_WL_VoxelGlow multiplies its Color by EmissiveStrength, which is pinned at WonderlandSceneUnits, so
	 *  a glow surface is painted with the small number and the material supplies the thousand.
	 *  M_WL_VoxelAdditive and M_WL_EyeHalo have no strength at all -- their emissive IS Color -- so an
	 *  additive surface must be painted with the number already multiplied. Both paint sites did that
	 *  correctly. The REST colour did not, and the rest colour is what actually reaches the material:
	 *  AnimateGlow writes Rest * Amount into Color on every tick of every figure, so whatever the painter
	 *  wrote survived exactly one frame and was then replaced by a number a thousand times too small.
	 *
	 *  Measured on the live costume (zc_eye_halo_probe, 2026-09-27 11:38): every skin's eye halo carried
	 *  M_WL_EyeHalo, two instances, visible, Inner and Falloff correct -- and Color (19.8, 11.5, 2.0)
	 *  against a scene white near 25,000. Black. That is why the default Dog's eyes glowed and no costume's
	 *  did: the Dog's halos are plain components driven by ARelayDogCharacter::SetEyeGlow, which writes the
	 *  thousand itself and is not on this animator at all.
	 *
	 *  This is not only the eyes. Every additive surface on every figure goes through here -- Celestial
	 *  Light's halo edge, a cub's ghost tail, the Project Avatars' halos -- and all of them have been dark
	 *  since the scene scale was introduced. */
	FLinearColor RestColourFor(EWonderlandCompanionMaterialKind Kind, const FLinearColor& Colour)
	{
		return Kind == EWonderlandCompanionMaterialKind::Additive ? Colour * WonderlandSceneUnits : Colour;
	}

	/** True when a material definition is an eye's halo pane rather than a body surface or a fire. */
	bool IsEyeHaloName(const FName& Name)
	{
		const FString Text = Name.ToString();
		return Text.Contains(TEXT("halo"), ESearchCase::IgnoreCase)
			&& Text.Contains(TEXT("eye"), ESearchCase::IgnoreCase)
			&& !Text.Contains(TEXT("fire"), ESearchCase::IgnoreCase);
	}
	const TCHAR* const AdditiveFallbackPath = TEXT("/Engine/EngineMaterials/EmissiveMeshMaterial.EmissiveMeshMaterial");
	const TCHAR* const CubePath = TEXT("/Engine/BasicShapes/Cube.Cube");
	// THE FIGURES' OWN CUBE, AND WHY IT EXISTS. Every .wlvox body is instances of a cube, and on 2026-09-24
	// zc_avatar_cost measured what that costs once several of them are on screen at once: ten Project Avatars
	// BEHIND the camera cost nothing (32.36 ms against a 32.37 ms baseline), the same ten FACING it cost
	// 202.6 ms -- and 193.46 ms of that was the RENDER THREAD while the GPU sat at 42.97 ms over 6,338 draw
	// calls. Low draw calls and low GPU with a huge render thread is the CPU walking 314,020 instances.
	//
	// The world's Nanite pass fixed the same shape of problem (114.95 -> 55.54 ms) but deliberately skipped the
	// engine's own meshes, because they are shared editor furniture this project does not own. So the project
	// now carries its own Nanite cube and the figures use that instead, which moves the instance culling onto
	// the GPU where it costs nothing to add another avatar.
	//
	// FALLBACK KEPT ON PURPOSE. If SM_WL_VoxelCube is ever missing -- a fresh clone before the asset job has
	// run, a Content tree that did not sync -- the figures fall back to the engine cube and simply render the
	// way they did before. A missing optimisation must not be a missing companion.
	const TCHAR* const NaniteCubePath = TEXT("/Game/Wonderland/Meshes/SM_WL_VoxelCube.SM_WL_VoxelCube");

	/** The cube the voxel bodies are instanced from: the project's Nanite one if it is there, the engine's if not. */
	UStaticMesh* LoadVoxelCube()
	{
		if (UStaticMesh* Nanite = LoadObject<UStaticMesh>(nullptr, NaniteCubePath))
		{
			return Nanite;
		}
		return LoadObject<UStaticMesh>(nullptr, CubePath);
	}

	/** The plain, non-Nanite cube. ADDITIVE PARTS MUST NOT BE NANITE.
	 *
	 *  Nanite supports opaque and masked blend modes and nothing else, and the additive parent here is the
	 *  engine's EmissiveMeshMaterial, which is BLEND_Additive. Together they made the engine say so on every
	 *  load, twice over:
	 *
	 *    LogStaticMesh: Invalid material [MID_EmissiveMeshMaterial_0] used on Nanite static mesh
	 *                   [SM_WL_VoxelCube]. Only opaque or masked blend modes are currently supported,
	 *                   [BLEND_Additive] blend mode was specified.
	 *    LogMaterial:   Material EmissiveMeshMaterial missing usage flag Nanite!
	 *                   DEFAULT MATERIAL WILL BE USED IN GAME.
	 *
	 *  The last line is the one that matters: not a cosmetic warning, a statement that these surfaces render
	 *  as default grey in a packaged build. 43 materials across the Project Avatars -- every Cherubim, Seraph
	 *  and TenTails halo -- are declared `add`, so that is all of their halos.
	 *
	 *  Nanite stays for the opaque bulk, which is the overwhelming majority of a figure's instances and the
	 *  reason the cube was made Nanite. Only the additive groups move to the plain cube, where their blend
	 *  mode is legal. */
	UStaticMesh* LoadPlainCube()
	{
		return LoadObject<UStaticMesh>(nullptr, CubePath);
	}
}

AWonderlandCompanionEmbodiment::AWonderlandCompanionEmbodiment()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = true;
	// After movement has run, so the companion follows where the Dog IS this frame rather than where it was.
	PrimaryActorTick.TickGroup = TG_PostPhysics;
	SetCanBeDamaged(false);
	SetActorEnableCollision(false);

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Root->SetMobility(EComponentMobility::Movable);
	SetRootComponent(Root);

	FloatRoot = CreateDefaultSubobject<USceneComponent>(TEXT("Float"));
	FloatRoot->SetMobility(EComponentMobility::Movable);
	FloatRoot->SetupAttachment(Root);
}

UMaterialInterface* AWonderlandCompanionEmbodiment::ParentFor(EWonderlandCompanionMaterialKind Kind) const
{
	const TCHAR* Path = LitParentPath;
	switch (Kind)
	{
	case EWonderlandCompanionMaterialKind::Rim: Path = RimParentPath; break;
	case EWonderlandCompanionMaterialKind::Glow: Path = GlowParentPath; break;
	case EWonderlandCompanionMaterialKind::Additive:
		Path = LoadObject<UMaterialInterface>(nullptr, AdditiveParentPath) != nullptr
			? AdditiveParentPath : AdditiveFallbackPath;
		break;
	default: break;
	}
	UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, Path);
	// The glow parent is the project's own material now. If a tree has not run zc_make_glow_material yet,
	// the old engine debug material still draws something unlit rather than dropping straight to lit -- but
	// it is a fallback for a missing asset, not the shipping path, because it does not survive a cook.
	if (Parent == nullptr && Kind == EWonderlandCompanionMaterialKind::Glow)
	{
		Parent = LoadObject<UMaterialInterface>(nullptr, GlowFallbackPath);
		if (Parent != nullptr)
		{
			UE_LOG(LogWonderlandCompanion, Warning,
				TEXT("WLCOMPANION %s is missing; falling back to the engine debug material, which does NOT package"),
				GlowParentPath);
		}
	}
	if (Parent == nullptr && Path != LitParentPath)
	{
		// LOUD, NOT SILENT. A missing parent draws the part in plain lit colour rather than not at all, and
		// says so, because a companion whose eyes quietly stopped glowing is the kind of drift nobody reports.
		UE_LOG(LogWonderlandCompanion, Warning, TEXT("WLCOMPANION material parent %s did not load; drawing that material lit instead"), Path);
		Parent = LoadObject<UMaterialInterface>(nullptr, LitParentPath);
	}
	return Parent;
}

namespace
{
	/**
	 * IS THIS PART THE DOG, OR SOMETHING THE DOG IS WEARING?
	 *
	 * FOUNDER: framing "MUST derive from the physical BODY", excluding halos, flames, particles, glow cards
	 * and props. This is the one place that decides it, and it decides on the part's NAME.
	 *
	 * WHY NOT ON THE MATERIAL, WHICH IS WHAT IT USED TO DO. A part counted as body only if it was shaded Lit
	 * or Rim. Three of the five skins are built almost entirely from Glow and Additive materials -- a glowing
	 * torso is still a torso -- so for Apollo, Skeleton Flame and Celestial Light nearly the whole figure was
	 * classified as not-body and the framing box collapsed onto whatever small solid fragment was left. It
	 * measured 30 uu of body on figures 200 to 400 uu tall. "Emits light" and "is an ornament" are simply not
	 * the same question, and answering the second with the first is what made the mascot render wrong.
	 *
	 * AND WHY AN ALLOWLIST RATHER THAN A DENYLIST. Every skin file in the lineup says the same thing in its
	 * own header -- "the dog underneath is identical in every one" -- and they are: all five declare exactly
	 * root, body, head, arm_l, arm_l_fore, arm_r, arm_r_fore, leg_l, leg_l_shin, leg_r, leg_r_shin, and then
	 * hang their own halo, crown, robe, lamps, banner, aura, sigil, tail and fires off that skeleton. Framing
	 * on the shared skeleton therefore gives all five skins the SAME framing, which is the deterministic
	 * close-up the founder asked for, and a skin that invents a new ornament tomorrow is excluded by default
	 * rather than quietly resizing the shot.
	 */
	bool WonderlandPartIsFramingBody(FName PartName)
	{
		const FString Name = PartName.ToString().ToLower();
		return Name == TEXT("body")
			|| Name == TEXT("head")
			|| Name.StartsWith(TEXT("arm_"))
			|| Name.StartsWith(TEXT("leg_"));
	}
}

void AWonderlandCompanionEmbodiment::ClearBody()
{
	for (UInstancedStaticMeshComponent* Mesh : PartMeshes)
	{
		if (Mesh != nullptr)
		{
			Mesh->DestroyComponent();
		}
	}
	for (int32 Index = PartPivots.Num() - 1; Index >= 0; --Index)
	{
		if (PartPivots[Index] != nullptr)
		{
			PartPivots[Index]->DestroyComponent();
		}
	}
	PartMeshes.Reset();
	PartPivots.Reset();
	PartNames.Reset();
	PartMeshIsBody.Reset();
	PartMeshNames.Reset();
	MaterialInstances.Reset();
	FlameMaterialInstances.Reset();
	FlameRestColours.Reset();
	BuiltMaterials.Reset();
	Motions.Reset();
	// THE FIRE GOES OUT WITH THE BODY THAT WAS BURNING.
	//
	// FlameSources is rebuilt by the next LoadFigure, but the SECTIONS already laid into FlameSurface are not --
	// so changing to a skin that carries no fire left the previous skin's flames hanging in the air. Photographed
	// in the Wardrobe: Apollo, which has no flame part at all, was wearing somebody else's burning crown. The
	// material instances those sections were drawn with are being discarded on the line above, too.
	FlameSources.Reset();
	if (FlameSurface != nullptr)
	{
		FlameSurface->ClearAllMeshSections();
	}
	// AND THE SHADOW GOES WITH THE BODY THAT CAST IT, for the same reason: a skin switched away from Shadow Flame must take
	// every tendril with it (founder: "Confirm switching skins removes the shadow effects completely").
	ShadowSources.Reset();
	ShadowTendrils.Reset();
	ShadowTips.Reset();
	ShadowTipWeights.Reset();
	ShadowPath.Reset();
	ShadowDetail = -1;
	ShadowVertexCount = 0;
	if (UProceduralMeshComponent* Shadow = ShadowSurface.Get())
	{
		Shadow->ClearAllMeshSections();
	}
	GlowMaterials.Reset();
	bHasHeartbeat = false;
	BoxCount = 0;
}

bool AWonderlandCompanionEmbodiment::LoadFigure(const FString& FilePath)
{
	// LEARN WHETHER THIS FIGURE HAS TIERS, once, from its own name. Set before the load so a tier swap that
	// re-enters here does not keep re-deriving it.
	if (FigureTier == INDEX_NONE)
	{
		const FString Base = FPaths::GetBaseFilename(FilePath);
		for (int32 Tier = 0; Tier < UE_ARRAY_COUNT(WonderlandFigureTiers); ++Tier)
		{
			if (Base.EndsWith(WonderlandFigureTiers[Tier]))
			{
				FigureTierRoot = FPaths::Combine(FPaths::GetPath(FilePath),
					Base.LeftChop(FCString::Strlen(WonderlandFigureTiers[Tier])));
				FigureTier = Tier;
				break;
			}
		}
	}

	// PARSED ONCE PER FILE, NOT ONCE PER SPAWN.
	//
	// Every LoadFigure used to read the whole file off disk and parse it again: Cherubim Large is 2.5 MB and
	// 36,025 boxes, TenTails Large 2.9 MB and 39,845. One /pa at Large therefore read and parsed 7 MB on the
	// spawn frame, and a server holding MANY Project Avatars would pay that per avatar -- which is the cost the
	// founder is feeling. The wardrobe pays it too, on every skin click.
	//
	// The parsed figure is immutable once built, so it is shared. Keyed by path AND the file's timestamp, so
	// regenerating a skin with the forge is picked up without an editor restart; the entry is simply replaced.
	struct FCachedFigure
	{
		FDateTime Stamp;
		TSharedPtr<const FWonderlandCompanionFigure> Figure;
	};
	static TMap<FString, FCachedFigure> FigureCache;

	const FDateTime Stamp = IFileManager::Get().GetTimeStamp(*FilePath);
	TSharedPtr<const FWonderlandCompanionFigure> Shared;
	if (const FCachedFigure* Hit = FigureCache.Find(FilePath))
	{
		if (Hit->Stamp == Stamp && Hit->Figure.IsValid())
		{
			Shared = Hit->Figure;
		}
	}
	if (!Shared.IsValid())
	{
		FString Text;
		if (!FFileHelper::LoadFileToString(Text, *FilePath))
		{
			LastError = FString::Printf(TEXT("cannot read figure file %s"), *FilePath);
			UE_LOG(LogWonderlandCompanion, Error, TEXT("WLCOMPANION %s: %s"), *DisplayName, *LastError);
			return false;
		}
		TSharedRef<FWonderlandCompanionFigure> Parsed = MakeShared<FWonderlandCompanionFigure>();
		FString ParseError;
		if (!FWonderlandCompanionFigure::Parse(Text, Parsed.Get(), ParseError))
		{
			LastError = FString::Printf(TEXT("%s: %s"), *FilePath, *ParseError);
			UE_LOG(LogWonderlandCompanion, Error, TEXT("WLCOMPANION %s: figure refused, %s"), *DisplayName, *LastError);
			return false;
		}
		Shared = Parsed;
		FigureCache.Add(FilePath, FCachedFigure{Stamp, Shared});
	}
	const FWonderlandCompanionFigure& Figure = *Shared;
	UStaticMesh* Cube = LoadVoxelCube();
	UStaticMesh* PlainCube = LoadPlainCube();
	if (Cube == nullptr)
	{
		LastError = TEXT("the engine cube /Engine/BasicShapes/Cube did not load");
		UE_LOG(LogWonderlandCompanion, Error, TEXT("WLCOMPANION %s: %s"), *DisplayName, *LastError);
		return false;
	}

	// Only now, with a figure known to be whole, does the old body come down.
	ClearBody();
	FigurePath = FilePath;
	LastError.Reset();
	// Hashed from the name, so the two companions never hover, flap or blink in step.
	Phase = static_cast<float>(GetTypeHash(DisplayName) % 10007u) / 10007.0f;

	// ---- ONE SIZE FOR EVERY MASCOT BODY (founder, 2026-09-30, a HARD rule: "ALL mascot skins must be the same overall height as the canonical Relay OG mascot skin").
	//
	// Measured 2026-09-30: every alternate skin's body stood 155 uu -- the generator's 1.55 m -- while the Relay OG the world
	// shows is the Dog's own body at 175, so every skin was 11-12% smaller than the mascot it dresses (and its shoulders
	// 24.5 uu lower, which is where the Mission Contract hands fell short). A figure that carries its canonical body's
	// extent is now scaled here so that body stands TargetBodyHeightUU tall; its costume, horns and fire come with it.
	if (TargetBodyHeightUU > 1.0f && Figure.HasBody())
	{
		FigureScale = TargetBodyHeightUU / ((Figure.BodyHighest - Figure.BodyLowest) * Figure.VoxelUU);
	}
	const float Unit = Figure.VoxelUU * FMath::Max(FigureScale, 0.05f);
	BodyHeightUU = Figure.HasBody() ? (Figure.BodyHighest - Figure.BodyLowest) * Unit : 0.0f;
	BodyLowestUU = Figure.HasBody() ? Figure.BodyLowest * Unit : 0.0f;
	// MEASURED, NOT ASSUMED: how tall this figure really is, from the boxes it is about to build.
	{
		float Lowest = TNumericLimits<float>::Max();
		float Highest = -TNumericLimits<float>::Max();
		// AND HOW WIDE, in the same pass. The wardrobe frames the figure from its height alone, which does not
		// know that a halo or a banner reaches sideways -- so those skins were clipped at the window's sides
		// and every other skin paid for it with margin. Measured here rather than guessed there.
		float Widest = 0.0f;
		// AND WHERE THE FLAMES WILL REACH. RebuildFlames does not draw the twinkle boxes -- it lays procedural
		// ribbons in their place, running to Source.Height * Reach * (0.58 + 0.62 * Lick), up to 1.20x the
		// source's own height, and swaying out to about 0.82x its width. The wardrobe frames on the two numbers
		// below, so measuring only the boxes told it Arden Infernal fitted while its mane -- which is flame,
		// not boxes -- was being cut off by the window. Gathered per part and in FIGURE space, which is what
		// Box.Centre already is; the FlameSources built later are relative to their part's pivot instead.
		TMap<int32, FBox> Fires;
		for (const FWonderlandCompanionBox& Box : Figure.Boxes)
		{
			Lowest = FMath::Min(Lowest, static_cast<float>(Box.Centre.Z - Box.Size.Z * 0.5));
			Highest = FMath::Max(Highest, static_cast<float>(Box.Centre.Z + Box.Size.Z * 0.5));
			Widest = FMath::Max(Widest, static_cast<float>(FMath::Abs(Box.Centre.X) + Box.Size.X * 0.5));
			Widest = FMath::Max(Widest, static_cast<float>(FMath::Abs(Box.Centre.Y) + Box.Size.Y * 0.5));
			if (Figure.Parts.IsValidIndex(Box.Part)
				&& Figure.Parts[Box.Part].Motion == EWonderlandCompanionMotion::Twinkle)
			{
				const FVector Half = Box.Size * 0.5;
				Fires.FindOrAdd(Box.Part, FBox(ForceInit)) += FBox(Box.Centre - Half, Box.Centre + Half);
			}
		}
		for (const TPair<int32, FBox>& Fire : Fires)
		{
			const FVector FireSize = Fire.Value.GetSize();
			const float Tall = FMath::Max(static_cast<float>(FireSize.Z), 4.0f);
			const float Fat = FMath::Max(static_cast<float>(FMath::Max(FireSize.X, FireSize.Y)), 3.0f);
			// 1.45 and 1.15 rather than the 1.20 and 0.82 the ribbon maths alone gives. Those are the limits for
			// ONE tongue at full lick; a source lays five of them, each with its own sway and drift, and the
			// envelope of five is wider than any one. Measured against the capture rather than derived: at 1.20
			// and 0.82 Arden Infernal's mane still ran past the window's left edge.
			Highest = FMath::Max(Highest, static_cast<float>(Fire.Value.Min.Z) + Tall * 1.45f);
			const FVector Mid = Fire.Value.GetCenter();
			Widest = FMath::Max(Widest, static_cast<float>(FMath::Abs(Mid.X)) + Fat * 1.15f);
			Widest = FMath::Max(Widest, static_cast<float>(FMath::Abs(Mid.Y)) + Fat * 1.15f);
		}
		FigureHeightUU = Figure.Boxes.Num() > 0 ? (Highest - Lowest) * Unit : 0.0f;
		FigureWidthUU = Figure.Boxes.Num() > 0 ? Widest * 2.0f * Unit : 0.0f;
		// AND KEEP THE FLOOR OF IT. /pa was re-deriving this by walking every instance of every component back
		// out of the render proxy with GetInstanceTransform(bWorldSpace=true) -- 95,594 calls for one /pa at
		// Large, on the spawn frame, to recover a number this loop had just computed for free.
		FigureLowestUU = Figure.Boxes.Num() > 0 ? Lowest * Unit : 0.0f;
	}

	for (int32 Index = 0; Index < Figure.Materials.Num(); ++Index)
	{
		const FWonderlandCompanionMaterial& Def = Figure.Materials[Index];
		UMaterialInterface* Parent = ParentFor(Def.Kind);
		// AN EYE HALO IS A SOFT LIGHT, NOT A PLATE: the radial material if the project has it. See EyeHaloParentPath.
		if (Def.Kind == EWonderlandCompanionMaterialKind::Additive && IsEyeHaloName(Def.Name))
		{
			if (UMaterialInterface* Soft = LoadObject<UMaterialInterface>(nullptr, EyeHaloParentPath))
			{
				Parent = Soft;
			}
		}
		UMaterialInstanceDynamic* Instance = UMaterialInstanceDynamic::Create(Parent, this);
		if (Instance != nullptr)
		{
			const FLinearColor Lit(Def.Color.R, Def.Color.G, Def.Color.B, 1.0f);
			const FLinearColor Emissive = Lit * WonderlandTameGlow(Def.Strength);
			switch (Def.Kind)
			{
			case EWonderlandCompanionMaterialKind::Lit:
				Instance->SetVectorParameterValue(TEXT("Color"), Lit);
				break;
			case EWonderlandCompanionMaterialKind::Rim:
				Instance->SetVectorParameterValue(TEXT("BaseColor"), Lit);
				Instance->SetVectorParameterValue(TEXT("RimColor"), Emissive);
				Instance->SetScalarParameterValue(TEXT("RimAmp"), 1.0f);
				Instance->SetScalarParameterValue(TEXT("EmissiveStrength"), 0.0f);
				// THE V1 MASTER CAN BREATHE AND BOB IN ITS VERTEX SHADER, on one clock shared by everything
				// that wears it. A companion must never join that heartbeat.
				Instance->SetScalarParameterValue(TEXT("BobAmp"), 0.0f);
				Instance->SetScalarParameterValue(TEXT("BreatheAmp"), 0.0f);
				Instance->SetScalarParameterValue(TEXT("DetailAmp"), 0.0f);
				break;
			case EWonderlandCompanionMaterialKind::Glow:
			case EWonderlandCompanionMaterialKind::Additive:
				// EVERY NAME THE STOCK MATERIALS USE, because setting the wrong one fails SILENTLY.
				//
				// A material instance accepts any parameter name you hand it and simply ignores one it does not
				// have, so a mis-named parameter looks exactly like a correct one that had no effect. That cost
				// three build-and-test cycles on the brain's chamber, where tinting LevelColorationUnlitMaterial
				// through "Color" did nothing at all and every panel stayed the material's own white. The ember
				// flames were dull brown here for the same reason. Setting all of them is free: the ones that do
				// not exist are discarded, and the one that does takes.
				// AN ADDITIVE SURFACE CARRIES THE SCENE SCALE IN ITS COLOUR: M_WL_VoxelAdditive's emissive is its
				// Color and nothing else (zc_material_graphs), so without this an eye halo at 6 is 6 against 25,000.
				Instance->SetVectorParameterValue(TEXT("Color"),
					Def.Kind == EWonderlandCompanionMaterialKind::Additive ? Emissive * WonderlandSceneUnits : Emissive);
				Instance->SetVectorParameterValue(TEXT("EmissiveColor"), Emissive);
				Instance->SetVectorParameterValue(TEXT("BaseColor"), Emissive);
				// PINNED AT 1000, NOT THE STRENGTH. M_WL_VoxelGlow's emissive is Color x EmissiveStrength x ~0.001 --
				// QUADRATIC in the authored strength when both are set from it. At the old 4000x scale that was
				// 1,200 x 1,200 -> one white; after the generator's re-baseline to 6 it was 4 x 4 -> 0.02 -> BLACK,
				// and every glow on every figure in the world rendered black: Celestial's halo, Skeleton's
				// ghostfire, the costume eyes (zc_eyes_look, 2026-09-27 15:47 UTC). The eye had only ever read
				// because its strength was 1,242. With this term held at 1000 the material's output IS Color, which
				// is the number the tame curve, the day cycle and the eye drive already choose.
				Instance->SetScalarParameterValue(TEXT("EmissiveStrength"), WonderlandSceneUnits);
				{
					const bool bBeats = Def.Name.ToString().Contains(TEXT("pulse"), ESearchCase::IgnoreCase);
					GlowMaterials.Add({Index, TEXT("Color"), RestColourFor(Def.Kind, Emissive), bBeats});
					bHasHeartbeat |= bBeats;
				}
				break;
			}

			// ---- AND THE FOUNDER'S OWN COLOURWAY OVER THE TOP. See ApplyColourway: it is the one place that
			// ---- decides which channels a chosen colour is allowed to reach.
			ApplyColourway(Index, Instance, Def, Lit, Emissive);
		}
		MaterialInstances.Add(Instance);
		BuiltMaterials.Add(Def);
		// ---- THE FLAME'S REST SLOT IS OPENED **BEFORE** THE TWIN IS PAINTED, and getting that order wrong
		// ---- is what turned the founder's ghostfire black.
		//
		// ApplyColourway writes the twin's colour into FlameRestColours so the heartbeat can beat around it.
		// That write is guarded by IsValidIndex, and the array used to be grown at the BOTTOM of this loop --
		// after the paint. So the write silently found no slot, the rest stayed at its initialised Black, and
		// the animator then drove the fire to Black * Amount on every subsequent frame. Photographed: a solid
		// black spiked plume standing where Skeleton Flame's white-cyan ghostfire belongs.
		//
		// A silent IsValidIndex guard around a write is a trap, and this is the second time today an array
		// grown in the wrong order has produced a confident, wrong picture.
		FlameRestColours.Add(FLinearColor::Black);

		// ---- AND ITS FLAME TWIN. Only glowing materials need one; everything else reuses the body instance,
		// so a figure with no fire allocates nothing extra.
		UMaterialInstanceDynamic* Flame = Instance;
		if (Def.Kind == EWonderlandCompanionMaterialKind::Glow
			|| Def.Kind == EWonderlandCompanionMaterialKind::Additive)
		{
			// THE FIRE MASTER IF THE PROJECT HAS ONE, and the figure's own glow master if it does not -- so a
			// worktree without the asset still draws flames, just the old way, rather than drawing nothing.
			UMaterialInterface* FireMaster = CVarFireMaterial.GetValueOnAnyThread() != 0
				? LoadObject<UMaterialInterface>(nullptr, FireParentPath) : nullptr;
			if (UMaterialInstanceDynamic* Full = UMaterialInstanceDynamic::Create(
				FireMaster != nullptr ? FireMaster : ParentFor(Def.Kind), this))
			{
				const FLinearColor Untamed(Def.Color.R, Def.Color.G, Def.Color.B, 1.0f);
				// ON THE FIRE MATERIAL, the square root of the authored strength; on the old flat card, the
				// strength itself. See CVarFireGain -- the two surfaces need different numbers to look the
				// same brightness, and the fallback path must not change just because this one did. Recorded
				// on the actor so RepaintColourway can answer the same question the same way.
				bFlameOnFireMaster = FireMaster != nullptr;
				const float FlameStrength = WonderlandFlameStrength(Def.Strength, bFlameOnFireMaster);
				const FLinearColor FullEmissive = Untamed * FlameStrength;
				Full->SetVectorParameterValue(TEXT("Color"), FullEmissive);
				Full->SetVectorParameterValue(TEXT("EmissiveColor"), FullEmissive);
				Full->SetVectorParameterValue(TEXT("BaseColor"), FullEmissive);
				Full->SetScalarParameterValue(TEXT("EmissiveStrength"), WonderlandSceneUnits);   // see the body instance above
				ApplyColourway(Index, Full, Def, FullEmissive, FullEmissive, /*bFlameTwin=*/true);
				Flame = Full;
			}
		}
		FlameMaterialInstances.Add(Flame);
	}

	for (const FWonderlandCompanionPart& Def : Figure.Parts)
	{
		USceneComponent* Parent = Def.Parent == INDEX_NONE ? FloatRoot.Get() : PartPivots[Def.Parent].Get();
		const FVector ParentPivot = Def.Parent == INDEX_NONE ? FVector::ZeroVector : Figure.Parts[Def.Parent].Pivot;
		const FName ComponentName = MakeUniqueObjectName(this, USceneComponent::StaticClass(), FName(*FString::Printf(TEXT("Part_%s"), *Def.Name.ToString())));
		USceneComponent* Pivot = NewObject<USceneComponent>(this, ComponentName);
		Pivot->SetMobility(EComponentMobility::Movable);
		Pivot->SetupAttachment(Parent);
		PartNames.Add(Def.Name);
		const FVector Rest = (Def.Pivot - ParentPivot) * Unit;
		Pivot->SetRelativeLocation(Rest);
		Pivot->RegisterComponent();
		PartPivots.Add(Pivot);

		FPartMotion Motion;
		Motion.Motion = Def.Motion;
		Motion.A = Def.A;
		Motion.B = Def.B;
		Motion.RestLocation = Rest;
		Motions.Add(Motion);
	}

	// ---- THE LIMBS, CLASSIFIED ONCE, FROM WHERE THEY ACTUALLY ARE (founder regression, 2026-09-29).
	//
	// Animate used to tell a knee from an elbow, and left from right, by each joint's RestLocation -- which is
	// relative to its PARENT, and so exactly zero sideways for every shin and forearm, because each hangs straight
	// under the joint above it. All four read as "the right knee". Here the ABSOLUTE pivot decides the side and
	// the hierarchy decides the kind: a knee-motion joint under a stride joint is a knee, under a wing it is an
	// elbow. The leg lengths come from the figure's own pivots and boxes, so a costume taller or shorter in the
	// leg than the canon Dog can solve its own knee onto the canon's foot rather than borrow an angle meant for
	// a different leg.
	for (int32 Index = 0; Index < Figure.Parts.Num() && Index < Motions.Num(); ++Index)
	{
		const FWonderlandCompanionPart& Def = Figure.Parts[Index];
		FPartMotion& Limb = Motions[Index];
		const int8 Side = Def.Pivot.Y * Unit > 1.0f ? 1 : (Def.Pivot.Y * Unit < -1.0f ? -1 : 0);
		if (Def.Motion == EWonderlandCompanionMotion::Stride)
		{
			Limb.LimbKind = 1;
			Limb.LimbSide = Side;
		}
		else if (Def.Motion == EWonderlandCompanionMotion::Wing && Side != 0)
		{
			Limb.LimbKind = 3;
			Limb.LimbSide = Side;
		}
		else if (Def.Motion == EWonderlandCompanionMotion::Knee && Figure.Parts.IsValidIndex(Def.Parent))
		{
			const FWonderlandCompanionPart& Upper = Figure.Parts[Def.Parent];
			const int8 UpperSide = Upper.Pivot.Y * Unit > 1.0f ? 1 : (Upper.Pivot.Y * Unit < -1.0f ? -1 : 0);
			Limb.LimbSide = Side != 0 ? Side : UpperSide;
			if (Upper.Motion == EWonderlandCompanionMotion::Stride)
			{
				Limb.LimbKind = 2;
				// THE SOLE UNDER THIS KNEE IS ON THE FIGURE'S GROUND PLANE, z = 0 -- the costume stands on the capsule's
				// sole, so that plane IS the ground. Not the lowest box: several skins' shoes sit a few uu below it, and
				// measuring to them made a standing costume bend its knees 2-8 uu forward to lift its feet onto the
				// canon's (zg_07, 2026-09-29). Measured this way a straight costume leg stays straight.
				Limb.ShinUU = FMath::Max(static_cast<float>(Def.Pivot.Z) * Unit, 1.0f);
				Limb.UpperIndex = Def.Parent;
				FPartMotion& Hip = Motions[Def.Parent];
				Hip.LowerIndex = Index;
				Hip.ThighUU = FMath::Max(static_cast<float>((Def.Pivot - Upper.Pivot).Size()) * Unit, 1.0f);
				Hip.ShinUU = Limb.ShinUU;
			}
			else if (Upper.Motion == EWonderlandCompanionMotion::Wing)
			{
				Limb.LimbKind = 4;
				// THE HAND TIP UNDER THIS ELBOW: the lowest box face of the forearm and everything it carries, the same
				// far end the canon measures for its own arms (MeasureChain's TipLocal). Fire is not the hand: a
				// `twinkle` part's boxes only size the ribbons laid in their place, so they are left out.
				float LowestZ = Def.Pivot.Z;
				for (const FWonderlandCompanionBox& Box : Figure.Boxes)
				{
					if (Figure.Parts.IsValidIndex(Box.Part) && (Figure.Parts[Box.Part].Motion == EWonderlandCompanionMotion::Twinkle
						|| Figure.Parts[Box.Part].Motion == EWonderlandCompanionMotion::Shadow))
					{
						continue;
					}
					int32 Holder = Box.Part;
					bool bUnderElbow = false;
					for (int32 Guard = 0; Holder != INDEX_NONE && Guard < 64; ++Guard)
					{
						if (Holder == Index) { bUnderElbow = true; break; }
						Holder = Figure.Parts.IsValidIndex(Holder) ? Figure.Parts[Holder].Parent : INDEX_NONE;
					}
					if (bUnderElbow)
					{
						LowestZ = FMath::Min(LowestZ, static_cast<float>(Box.Centre.Z - Box.Size.Z * 0.5));
					}
				}
				Limb.ShinUU = FMath::Max(static_cast<float>(Def.Pivot.Z - LowestZ) * Unit, 1.0f);
				Limb.UpperIndex = Def.Parent;
				FPartMotion& Shoulder = Motions[Def.Parent];
				Shoulder.LowerIndex = Index;
				Shoulder.ThighUU = FMath::Max(static_cast<float>((Def.Pivot - Upper.Pivot).Size()) * Unit, 1.0f);
				Shoulder.ShinUU = Limb.ShinUU;
			}
		}
		// A PART UNDER A SPINE JOINT RISES WITH IT, so it must not add the performance lift a second time.
		for (int32 Holder = Def.Parent, Guard = 0; Holder != INDEX_NONE && Guard < 64 && Figure.Parts.IsValidIndex(Holder); ++Guard)
		{
			if (Figure.Parts[Holder].Motion == EWonderlandCompanionMotion::Spine)
			{
				Limb.bLiftedByAncestor = true;
				break;
			}
			Holder = Figure.Parts[Holder].Parent;
		}
	}

	// ONE INSTANCED COMPONENT PER PART AND MATERIAL, filled before it is registered, so a figure of a few
	// thousand boxes costs a few dozen components and a single render-state build each.
	TMap<int64, TArray<FTransform>> Groups;
	// THE FLAME PARTS ARE MEASURED AND THEN SKIPPED.
	//
	// Everything a figure tags `twinkle` is a tongue of fire -- halofire, armfire, tailfire, earfire, backfire,
	// the leg and shoulder fires. Their boxes are used only to learn how tall and wide the fire should be and
	// which two ember materials it burns in; no cube of them is ever drawn. RebuildFlames lays real tapered
	// ribbons in their place each frame.
	FlameSources.Reset();
	TMap<int32, FBox> FlameBounds;
	TMap<int32, TArray<int32>> FlameMaterials;
	// THE SHADOW PARTS ARE MEASURED AND SKIPPED THE SAME WAY: their boxes only say where tendrils are born.
	ShadowSources.Reset();
	ShadowTendrils.Reset();
	TMap<int32, FBox> ShadowBounds;
	TMap<int32, int32> ShadowMaterial;
	for (const FWonderlandCompanionBox& Box : Figure.Boxes)
	{
		const bool bFlame = Figure.Parts.IsValidIndex(Box.Part)
			&& Figure.Parts[Box.Part].Motion == EWonderlandCompanionMotion::Twinkle;
		const bool bShadow = Figure.Parts.IsValidIndex(Box.Part)
			&& Figure.Parts[Box.Part].Motion == EWonderlandCompanionMotion::Shadow;
		const FVector Local = (Box.Centre - Figure.Parts[Box.Part].Pivot) * Unit;
		const FVector Scale = Box.Size * (Unit / 100.0f);
		if (bShadow)
		{
			const FVector Half = Box.Size * Unit * 0.5;
			FBox& Bounds = ShadowBounds.FindOrAdd(Box.Part, FBox(ForceInit));
			Bounds += FBox(Local - Half, Local + Half);
			ShadowMaterial.FindOrAdd(Box.Part, Box.Material);
			continue;
		}
		if (bFlame)
		{
			const FVector Half = Box.Size * Unit * 0.5;
			FBox& Bounds = FlameBounds.FindOrAdd(Box.Part, FBox(ForceInit));
			Bounds += FBox(Local - Half, Local + Half);
			FlameMaterials.FindOrAdd(Box.Part).AddUnique(Box.Material);
			continue;
		}
		const int64 Key = (static_cast<int64>(Box.Part) << 32) | static_cast<int64>(static_cast<uint32>(Box.Material));
		// The engine cube is 100 uu on a side, centred on its pivot.
		Groups.FindOrAdd(Key).Add(FTransform(Box.Rotation, Local, Scale));
	}
	for (const TPair<int32, FBox>& Found : FlameBounds)
	{
		const TArray<int32>* Mats = FlameMaterials.Find(Found.Key);
		if (Mats == nullptr || Mats->Num() == 0) { continue; }
		FFlameSource Source;
		Source.PartIndex = Found.Key;
		// The figures list the deeper ember first and the pale tip second, so the last one is the hot core.
		Source.OuterMaterial = (*Mats)[0];
		Source.InnerMaterial = (*Mats)[Mats->Num() - 1];
		const FVector Size = Found.Value.GetSize();
		Source.Base = FVector(Found.Value.GetCenter().X, Found.Value.GetCenter().Y, Found.Value.Min.Z);
		Source.Height = FMath::Max(static_cast<float>(Size.Z), 4.0f);
		Source.Width = FMath::Max(static_cast<float>(FMath::Max(Size.X, Size.Y)), 3.0f);
		Source.Seed = static_cast<float>(Found.Key) * 2.393f;
		FlameSources.Add(Source);
	}
	if (FlameSources.Num() > 0 && FlameSurface == nullptr)
	{
		FlameSurface = NewObject<UProceduralMeshComponent>(this, TEXT("FlameSurface"));
		FlameSurface->SetMobility(EComponentMobility::Movable);
		FlameSurface->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		FlameSurface->SetGenerateOverlapEvents(false);
		FlameSurface->SetCanEverAffectNavigation(false);
		// Fire does not cast shadows: a shadow-casting flame is a dark lamp, the same rule the glow boxes follow.
		FlameSurface->SetCastShadow(false);
		FlameSurface->SetupAttachment(RootComponent);
		FlameSurface->RegisterComponent();
	}

	// THE SHADOW TENDRILS: `a` of them for each `shadow` part, every one with constants of its own (RebuildShadows).
	for (const TPair<int32, FBox>& Found : ShadowBounds)
	{
		const FWonderlandCompanionPart& Def = Figure.Parts[Found.Key];
		FShadowSource Source;
		Source.PartIndex = Found.Key;
		Source.Material = ShadowMaterial.FindRef(Found.Key);
		Source.Centre = Found.Value.GetCenter();
		Source.HalfSize = Found.Value.GetExtent();
		const int32 SourceIndex = ShadowSources.Add(Source);
		// THE STYLE FOLLOWS WHERE THE FIGURE PUT THE PART: off the back and the head they rise past the head, round the
		// torso they orbit, from the hips they sweep low by the legs and trail.
		const FString Name = Def.Name.ToString().ToLower();
		const int32 Style = (Name.Contains(TEXT("back")) || Name.Contains(TEXT("head"))) ? 0
			: (Name.Contains(TEXT("hip")) || Name.Contains(TEXT("leg")) || Name.Contains(TEXT("tail"))) ? 2 : 1;
		const int32 Count = FMath::Clamp(FMath::RoundToInt(Def.A), 1, 8);
		const float Reach = FMath::Clamp(Def.B, 1.0f, 60.0f) * Unit;
		FRandomStream Stream(Found.Key * 7919 + 13);
		for (int32 K = 0; K < Count; ++K)
		{
			FShadowTendril Tendril;
			Tendril.Source = SourceIndex;
			Tendril.Style = Style;
			Tendril.Anchor = Source.Centre + FVector(Stream.FRandRange(-1.0f, 1.0f) * Source.HalfSize.X,
				Stream.FRandRange(-1.0f, 1.0f) * Source.HalfSize.Y, Stream.FRandRange(-1.0f, 1.0f) * Source.HalfSize.Z);
			Tendril.Reach = Reach * Stream.FRandRange(0.75f, 1.2f);
			Tendril.Seed = Stream.FRandRange(0.0f, 1000.0f);
			ShadowTendrils.Add(Tendril);
		}
	}
	// A BUDGET, NOT A STYLE: however many a figure asks for, a whole Dog gets at most 24.
	if (ShadowTendrils.Num() > 24)
	{
		ShadowTendrils.SetNum(24);
	}
	if (ShadowTendrils.Num() > 0 && !ShadowSurface.IsValid())
	{
		UProceduralMeshComponent* Shadow = NewObject<UProceduralMeshComponent>(this,
			MakeUniqueObjectName(this, UProceduralMeshComponent::StaticClass(), TEXT("ShadowSurface")));
		Shadow->SetMobility(EComponentMobility::Movable);
		Shadow->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Shadow->SetGenerateOverlapEvents(false);
		Shadow->SetCanEverAffectNavigation(false);
		// Shadow energy is not a solid: it darkens by being black, and casts nothing.
		Shadow->SetCastShadow(false);
		Shadow->SetupAttachment(RootComponent);
		Shadow->RegisterComponent();
		// THE ACTOR HOLDS IT (InstanceComponents is reflected), so the weak handle above never dangles while we live.
		AddInstanceComponent(Shadow);
		ShadowSurface = Shadow;
	}

	for (TPair<int64, TArray<FTransform>>& Group : Groups)
	{
		const int32 PartIndex = static_cast<int32>(Group.Key >> 32);
		const int32 MaterialIndex = static_cast<int32>(Group.Key & 0xffffffff);
		const EWonderlandCompanionMaterialKind Kind = Figure.Materials[MaterialIndex].Kind;
		// AUTO-NAMED, DELIBERATELY. This built a readable name per component -- Printf into an FString, an
		// FName construction that hashes it, then MakeUniqueObjectName, which walks the outer's objects to
		// prove the name is free. That is three allocations and a scan for each of ~58 components per avatar,
		// on the frame the avatar arrives, and the scan gets slower as more avatars accumulate. P0 item 5 is
		// about exactly that frame. Nothing reads these names -- no proof and no C++ looks up "Mesh_*", only
		// the pivots are found by name -- so the engine's counter-based naming does the same job for free.
		// HIERARCHICAL, NOT PLAIN. HISM keeps a quadtree over its instances and culls and LODs them per
		// instance on the render thread; a plain ISM submits the lot. These figures animate by moving the
		// COMPONENT -- every instance inside one is static relative to it -- which is the case HISM is built
		// for, so the tree is built once at load rather than rebuilt per frame.
		//
		// Tried because the crowd cost is per-avatar render work and the alternatives were all closed: the
		// material regrouping did nothing measurable, both voxel culls removed geometry that turned out to be
		// visible, and a coarser voxel distorts the creature. This one changes no art at all.
		// See CVarFigureHism: the tree is a bet that per-instance culling is worth its upkeep, and until now
		// nobody had measured it against the alternative on this shape of data.
		UInstancedStaticMeshComponent* Mesh = CVarFigureHism.GetValueOnAnyThread() != 0
			? NewObject<UHierarchicalInstancedStaticMeshComponent>(this)
			: NewObject<UInstancedStaticMeshComponent>(this);
		Mesh->SetMobility(EComponentMobility::Movable);
		// Additive cannot be Nanite. See LoadPlainCube.
		Mesh->SetStaticMesh(Kind == EWonderlandCompanionMaterialKind::Additive ? PlainCube : Cube);
		if (MaterialInstances.IsValidIndex(MaterialIndex) && MaterialInstances[MaterialIndex] != nullptr)
		{
			Mesh->SetMaterial(0, MaterialInstances[MaterialIndex]);
		}
		Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Mesh->SetGenerateOverlapEvents(false);
		Mesh->SetCanEverAffectNavigation(false);
		// ---- A FIGURE DOES NOT WRITE ITSELF INTO THE DISTANCE FIELD SCENE.
		//
		// This project runs Lumen with r.GenerateMeshDistanceFields=True, so every primitive registered into
		// the world is a candidate to contribute to the global distance field -- and contributing means that
		// field is updated on the frame the primitive arrives. A Project Avatar registers forty-one instanced
		// components carrying some thirty-two thousand instances in the frame it spawns, measured as a flat
		// 22 ms over a quiet frame on every arrival, whatever else is already standing.
		//
		// A moving character is the case distance fields are worst at and least needed for: the field is a
		// coarse static representation, Lumen resolves moving geometry through screen traces instead, and a
		// figure that walks would be invalidating its own contribution continuously in any case.
		//
		// MEASURED, AND THE DEFAULT IS NOW OFF. Eight arrivals of Cherubim Large, one job per fresh editor
		// because a second job in the same session measures an editor that the first one filled:
		//
		//     distance field ON,  run 1   quiet 24.12   arrivals 45.3   ->  21.2 ms over quiet
		//     distance field ON,  run 2   quiet 24.57   arrivals 44.6   ->  20.0 ms over quiet
		//     distance field OFF          quiet 23.53   arrivals 33.1   ->   9.6 ms over quiet
		//
		// The two ON runs agree within 1.2 ms and every one of the eight arrivals is lower with it off --
		// max 41.2 against 54.7, min 29.1 against 32.0 -- so this is a consistent shift rather than an
		// average pulled by outliers. The arrival cost more than halves.
		if (CVarFigureDistanceField.GetValueOnAnyThread() == 0)
		{
			Mesh->bAffectDistanceFieldLighting = false;
		}
		// ---- AND OUT OF GLOBAL ILLUMINATION, FOR FIGURES THAT ASK TO BE. Set HERE, before
		// RegisterComponent, because that is the only place it takes.
		//
		// FOUNDER, P0 item 5: "optimize remaining spawn/render cost." Measured on one avatar: turning
		// affect_dynamic_indirect_lighting off recovers essentially all of what disabling Lumen globally
		// does, without touching any other surface's lighting.
		//
		// A FIRST ATTEMPT SET IT ON THE ACTOR AFTER LoadFigure AND REACHED 3 COMPONENTS OF 198. These
		// meshes are NewObject'd inside this loop and only join the actor's component list at
		// RegisterComponent below, so a TInlineComponentArray taken afterwards in the caller sees the
		// default subobjects and none of the 65 per-part meshes. The distance-field column read 198/198 in
		// that run and I took it as proof the loop had worked -- it was THIS line, which has been here all
		// along, and my own code had done nothing.
		if (!bContributeToGlobalIllumination)
		{
			Mesh->bAffectDynamicIndirectLighting = false;
		}
		// Light does not cast shadows: an unlit eye or a halo that shadowed the ground would be a dark lamp.
		Mesh->SetCastShadow(Kind == EWonderlandCompanionMaterialKind::Lit || Kind == EWonderlandCompanionMaterialKind::Rim);
		Mesh->SetupAttachment(PartPivots[PartIndex]);
		Mesh->AddInstances(Group.Value, false, false, false);
		Mesh->RegisterComponent();
		PartMeshes.Add(Mesh);
		PartMeshNames.Add(Figure.Parts[PartIndex].Name);
		// WHICH PARTS THE WARDROBE IS ALLOWED TO FRAME ON. See WonderlandPartIsFramingBody.
		PartMeshIsBody.Add(WonderlandPartIsFramingBody(Figure.Parts[PartIndex].Name));
		BoxCount += Group.Value.Num();
	}

	UE_LOG(LogWonderlandCompanion, Log, TEXT("WLCOMPANION %s (%s) built from %s: %d boxes, %d parts, %d materials, %d components"),
		*DisplayName, *ClassLabel, *FilePath, BoxCount, PartPivots.Num(), MaterialInstances.Num(), PartMeshes.Num());
	// A SHOWCASE FIGURE KEEPS ITS CHANNEL ACROSS A SKIN CHANGE. LoadFigure builds an entirely new set of
	// components, and without this the first skin the founder clicks in the wardrobe would be lit by the
	// stage and every one after it by the sun.
	if (bShowcaseLit)
	{
		SetShowcaseLit(true);
	}
	Animate(GetWorld() != nullptr ? static_cast<float>(GetWorld()->GetTimeSeconds()) : 0.0f);
	return true;
}

bool AWonderlandCompanionEmbodiment::ReloadFigure()
{
	return !FigurePath.IsEmpty() && LoadFigure(FigurePath);
}

void AWonderlandCompanionEmbodiment::SetFormation(EWonderlandCompanionFormation InFormation,
	const AActor* Contract, int32 Index, int32 Count)
{
	ContractActor = Contract;
	if (Formation != InFormation)
	{
		const EWonderlandCompanionFormation Previous = Formation;
		Formation = InFormation;
		// HOME ACROSS THE DOG? Each companion clears the verification beam on the side it is already on, which is not
		// always the side it follows on; flying straight home, both then crossed through the Dog and through each other
		// in the completion shot (Scenario D film, 2026-09-16: 123 uu apart, 121 from the Dog). So a companion that ends
		// a mission flight on the wrong side of the Dog is routed round it -- see RouteHome.
		bRoutingHome = false;
		const APlayerController* RouteController = FollowController.Get();
		const APawn* RoutePawn = RouteController != nullptr ? RouteController->GetPawn() : nullptr;
		if (Formation == EWonderlandCompanionFormation::Follow && Previous != EWonderlandCompanionFormation::Follow
			&& RoutePawn != nullptr && GetWorld() != nullptr)
		{
			const FRotator Heading(0.0, RoutePawn->GetActorRotation().Yaw, 0.0);
			const double Across = FVector::DotProduct(GetActorLocation() - RoutePawn->GetActorLocation(), Heading.RotateVector(FVector::RightVector));
			const double HomeSide = FollowOffset.Y >= 0.0 ? 1.0 : -1.0;
			bRoutingHome = Across * HomeSide < 0.0;
			RouteStartedAt = static_cast<float>(GetWorld()->GetTimeSeconds());
			if (bRoutingHome)
			{
				UE_LOG(LogWonderlandCompanion, Log, TEXT("WLCOMPANION %s goes home round the %s of the Dog"),
					*DisplayName, HomeSide > 0.0 ? TEXT("front") : TEXT("back"));
			}
		}
		// Spread around a shared circle rather than stacking: two companions in the same place is one
		// companion with a shadow. The phase is per-companion and constant for the stage.
		FormationPhase = Count > 0 ? static_cast<float>(Index) / static_cast<float>(Count) : 0.0f;
		NextPulseAt = -1.0f;
		if (Formation == EWonderlandCompanionFormation::ClearTheSightLine && Contract != nullptr)
		{
			bFlankRight = ChooseFlank(Contract);
		}
	}
}

bool AWonderlandCompanionEmbodiment::ChooseFlank(const AActor* Contract) const
{
	// Right of the beam when this companion is further right than the other one; each on its own side when there is
	// no other. Both decide on the same frame from the same positions, so they always choose opposite flanks.
	const APlayerController* Controller = FollowController.Get();
	const APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (Pawn == nullptr)
	{
		return FollowOffset.Y >= 0.0;
	}
	const FVector Along = (Contract->GetActorLocation() - Pawn->GetActorLocation()).GetSafeNormal2D();
	const FVector Right(-Along.Y, Along.X, 0.0);
	const double Mine = FVector::DotProduct(GetActorLocation() - Pawn->GetActorLocation(), Right);
	for (TActorIterator<AWonderlandCompanionEmbodiment> Other(GetWorld()); Other; ++Other)
	{
		// ONLY THE OTHER COMPANION. This returns on the FIRST body it finds, so a cub's body or the Dog's own
		// costume walking into the iteration decided which flank this companion took -- and the pair no longer
		// agreed, because each of them met a different stranger first. See IsIndependentCompanion.
		if (*Other == this || !Other->IsIndependentCompanion())
		{
			continue;
		}
		const double Theirs = FVector::DotProduct(Other->GetActorLocation() - Pawn->GetActorLocation(), Right);
		if (FMath::IsNearlyEqual(Mine, Theirs, 1.0))
		{
			return FormationPhase >= 0.5f;
		}
		return Mine > Theirs;
	}
	return Mine >= 0.0;
}

void AWonderlandCompanionEmbodiment::SetParticipation(bool bInJoined, bool bInAgent, const FLinearColor& InAccent, FName InFlightBeat)
{
	bJoined = bInJoined;
	bAgent = bInAgent;
	ContributionAccent = InAccent;
	FlightBeat = InFlightBeat;
}

int32 AWonderlandCompanionEmbodiment::GetPulsesInFlight() const
{
	int32 Flying = 0;
	for (const FSupportPulse& Pulse : Pulses)
	{
		Flying += Pulse.Started >= 0.0f ? 1 : 0;
	}
	return Flying;
}

void AWonderlandCompanionEmbodiment::SetFollowController(APlayerController* Controller)
{
	FollowController = Controller;
	bHasSnapped = false;
}

APawn* AWonderlandCompanionEmbodiment::GetFollowPawn() const
{
	const APlayerController* Controller = FollowController.Get();
	return Controller != nullptr ? Controller->GetPawn() : nullptr;
}

void AWonderlandCompanionEmbodiment::SnapToTarget()
{
	bHasSnapped = false;
	if (const APawn* Pawn = GetFollowPawn())
	{
		SetActorLocationAndRotation(DesiredLocation(Pawn), FRotator(0.0, Pawn->GetActorRotation().Yaw, 0.0));
		bHasSnapped = true;
	}
}

FVector AWonderlandCompanionEmbodiment::ContributionOrigin() const
{
	// From the body, not the figure origin: the origin is the tail tip, and light leaving a companion's feet reads as
	// something dripping from it rather than something it gives.
	return GetActorLocation() + FVector(0.0, 0.0, BodyClearanceHeightUU * FMath::Max(FigureScale, 0.05f));
}

FVector AWonderlandCompanionEmbodiment::RouteHome(const APawn* Pawn, const FVector& FollowTarget, float Now)
{
	// THE WAY HOME, ROUND THE DOG. The companion that follows on the Dog's right passes in front of it, the one on the
	// left behind it: when both change sides at once they cross HomeRouteReachUU in front and behind, never meeting, and
	// neither flies through the Dog. First out to the pass on the side it is on, then across it, then home as usual once
	// it is well out on its own side -- or after five seconds, whatever happened (a Dog that ran off, a teleport).
	const FRotator Heading(0.0, Pawn->GetActorRotation().Yaw, 0.0);
	const FVector Forward = Heading.RotateVector(FVector::ForwardVector);
	const FVector Right = Heading.RotateVector(FVector::RightVector);
	const FVector FromDog = GetActorLocation() - Pawn->GetActorLocation();
	const double Along = FVector::DotProduct(FromDog, Forward);
	const double Across = FVector::DotProduct(FromDog, Right);
	const double HomeSide = FollowOffset.Y >= 0.0 ? 1.0 : -1.0;
	if (Formation != EWonderlandCompanionFormation::Follow || Across * HomeSide > HomeRouteReachUU * 0.55
		|| Now - RouteStartedAt > 5.0f)
	{
		bRoutingHome = false;
		return FollowTarget;
	}
	const double PassAlong = HomeSide * HomeRouteReachUU;
	const bool bAtThePass = FMath::Abs(Along - PassAlong) < HomeRouteReachUU * 0.35;
	const double Side = bAtThePass ? HomeSide : (Across >= 0.0 ? 1.0 : -1.0);
	return Pawn->GetActorLocation() + Forward * PassAlong + Right * (Side * HomeRouteReachUU)
		+ FVector(0.0, 0.0, FollowTarget.Z - Pawn->GetActorLocation().Z);
}

FVector AWonderlandCompanionEmbodiment::DesiredLocation(const APawn* Pawn) const
{
	const AActor* Contract = ContractActor.Get();
	if (Contract != nullptr && Formation != EWonderlandCompanionFormation::Follow)
	{
		const FVector ContractAt = Contract->GetActorLocation();
		const FWonderlandCompanionOrbit Orbit = WonderlandCompanionOrbitFor(Formation);

		if (WonderlandFormationOrbits(Formation))
		{
			// A CIRCLE ABOUT THE CONTRACT, ABOVE IT. Inside the Dog's own circle so the two read as
			// concentric rather than as a crowd, and above the Dog's head so a companion never masks it.
			//
			// THE ANGLE IS INTEGRATED, NOT CLOCK x RATE. With `time x revolutions`, changing flight at 35 s from
			// 0.085 to 0.07 rev/s moved every companion's place on the circle by half a turn in one frame, and the
			// two flew straight across the circle through each other -- 16 uu apart in the first film.
			const float Angle = 2.0f * PI * static_cast<float>(FMath::Frac(OrbitTurns) + FormationPhase);
			const float Rise = Orbit.BobUU * FMath::Sin(Angle * 2.0f);
			return ContractAt + FVector(FMath::Cos(Angle) * Orbit.RadiusUU,
			                            FMath::Sin(Angle) * Orbit.RadiusUU,
			                            Orbit.HeightUU + Rise);
		}

		// CLEAR THE SIGHT-LINE. Flanking the Dog, level with it and well out to either side, measured against
		// the line the beam actually travels rather than against the Dog's facing -- the Dog turns to face the
		// contract, so the two agree here, but the beam is what must not be crossed and so the beam is what is used.
		// NOT BEHIND IT: 150 uu behind the Dog is where the play camera stands, and the first film's verification
		// shot had the Jhinn's wings filling the corner of the frame, a blur between the viewer and the beam.
		// THE FLANK IS THE SIDE THE COMPANION IS ALREADY ON (chosen once, in SetFormation), so reaching it never
		// crosses the beam. Taking it from the follow offset sent the LLM Companion from the Dog's left, where it
		// follows, across the beam to the right.
		const FVector Along = (ContractAt - Pawn->GetActorLocation()).GetSafeNormal2D();
		const FVector Right(-Along.Y, Along.X, 0.0);
		const double Side = bFlankRight ? 1.0 : -1.0;
		// NOR BETWEEN THE VIEWER AND THE DOG (editor 72, 2026-09-17). The mission camera watches verification from
		// the side, and from there the flank straight out beside the Dog put the LLM Companion squarely in front of
		// it, covering its legs. So there are two places on this companion's own side of the beam -- straight out
		// beside the Dog, or back and out, away from the Contract -- and it takes whichever is further off the line
		// through the Dog to the camera, in front or behind. Both keep it on its own side, so neither crosses the beam;
		// with the camera behind the Dog, as the play camera stands, it is still straight out to the side.
		const FVector Beside = Along * 30.0 + Right * (Side * 250.0);
		const FVector BackAndOut = -Along * 200.0 + Right * (Side * 170.0);
		FVector Offset = Beside;
		const APlayerController* Viewer = FollowController.Get();
		if (Viewer != nullptr && Viewer->PlayerCameraManager != nullptr)
		{
			const FVector ToViewer = (Viewer->PlayerCameraManager->GetCameraLocation() - Pawn->GetActorLocation()).GetSafeNormal2D();
			const double OnLineBeside = FMath::Abs(FVector::DotProduct(Beside.GetSafeNormal2D(), ToViewer));
			const double OnLineBack = FMath::Abs(FVector::DotProduct(BackAndOut.GetSafeNormal2D(), ToViewer));
			if (!ToViewer.IsNearlyZero() && OnLineBack + 0.05 < OnLineBeside)
			{
				Offset = BackAndOut;
			}
		}
		return Pawn->GetActorLocation() + Offset + FVector(0.0, 0.0, HoverHeightUU * 0.5);
	}

	float Radius = 0.0f;
	float HalfHeight = 0.0f;
	Pawn->GetSimpleCollisionCylinder(Radius, HalfHeight);
	const FVector Feet = Pawn->GetActorLocation() - FVector(0.0, 0.0, HalfHeight);
	const FRotator Heading(0.0, Pawn->GetActorRotation().Yaw, 0.0);
	return Feet
		+ Heading.RotateVector(FVector(FollowOffset.X, FollowOffset.Y, 0.0))
		+ FVector(0.0, 0.0, HoverHeightUU + FollowOffset.Z);
}

void AWonderlandCompanionEmbodiment::SetBodyRole(EWonderlandBodyRole InRole)
{
	if (BodyRole == InRole)
	{
		return;
	}
	BodyRole = InRole;
	// A BODY THAT HAS ALREADY BEEN BUILT IS REPAINTED, so telling it what it is never has to happen before it
	// is dressed. The Dog's costume is spawned, loaded and only then classified; this makes that order safe.
	RepaintColourway();
}

void AWonderlandCompanionEmbodiment::SetGlowScale(float Scale)
{
	const float Wanted = FMath::Clamp(Scale, 0.0f, 4.0f);
	// ---- A RELATIVE TOLERANCE, BECAUSE THE SHIPPED VALUE IS THE OLD ABSOLUTE ONE.
	//
	// This early-out exists so the wardrobe's per-tick re-application costs a float compare instead of a
	// repaint, which is right. But it was written with a FIXED tolerance of 0.001 and wl.Look.PreviewGlow
	// now ships at exactly 0.001 -- so every value from 0.0 up to 0.002 is "nearly equal" to the current
	// one and silently discarded. The knob has a dead band wider than its own working range.
	//
	// MEASURED, and it cost a whole evening's conclusion: a sweep across 0.0, 0.000033, 0.0001, 0.00033 and
	// 0.001 produced five identical pictures, and the run's own control -- "turn the figure's fire off
	// entirely" -- never turned anything off, because 0.0 is within 0.001 of 0.001. That read as "the glow
	// contributes 0.001 of the window", i.e. as a dead lever and a finding about the STAGE, when it was
	// really this line refusing the values. The upward half of the same sweep, whose steps are larger than
	// the tolerance, moved the picture every time.
	//
	// Scaling the tolerance with the value keeps the cheap early-out for a knob sitting still and lets the
	// knob express its whole range, including an exact zero, which is the one value a control most needs.
	const float Tolerance = FMath::Max(FMath::Max(FMath::Abs(GlowScale), FMath::Abs(Wanted)) * 1.0e-3f,
	                                   UE_SMALL_NUMBER);
	if (FMath::IsNearlyEqual(GlowScale, Wanted, Tolerance))
	{
		return;
	}
	GlowScale = Wanted;
	RepaintColourway();
}

FString AWonderlandCompanionEmbodiment::DescribeFlames() const
{
	if (FlameSurface == nullptr)
	{
		return TEXT("no flame surface");
	}
	FString Out = FString::Printf(TEXT("sections=%d flameMids=%d sources=%d "),
		FlameSurface->GetNumSections(), FlameMaterialInstances.Num(), FlameSources.Num());
	for (int32 Slot = 0; Slot < FlameSurface->GetNumSections(); ++Slot)
	{
		const FProcMeshSection* Section = FlameSurface->GetProcMeshSection(Slot);
		UMaterialInterface* Worn = FlameSurface->GetMaterial(Slot);
		FLinearColor Colour = FLinearColor::Black;
		FString WornName = TEXT("none");
		if (Worn != nullptr)
		{
			WornName = Worn->GetName();
			if (const UMaterialInstanceDynamic* Mid = Cast<UMaterialInstanceDynamic>(Worn))
			{
				Mid->GetVectorParameterValue(FMaterialParameterInfo(TEXT("Color")), Colour);
				if (const UMaterialInterface* Master = Mid->Parent)
				{
					WornName += TEXT("<") + Master->GetName() + TEXT(">");
				}
			}
		}
		Out += FString::Printf(TEXT("| [%d] verts=%d tris=%d visible=%d mat=%s colour=(%.2f,%.2f,%.2f) "),
			Slot,
			Section != nullptr ? Section->ProcVertexBuffer.Num() : -1,
			Section != nullptr ? Section->ProcIndexBuffer.Num() / 3 : -1,
			Section != nullptr ? (Section->bSectionVisible ? 1 : 0) : -1,
			*WornName, Colour.R, Colour.G, Colour.B);
	}
	return Out;
}

FString AWonderlandCompanionEmbodiment::DescribeMaterialColours() const
{
	FString Out;
	for (int32 Index = 0; Index < BuiltMaterials.Num(); ++Index)
	{
		FLinearColor Body = FLinearColor::Black;
		FLinearColor Twin = FLinearColor::Black;
		if (MaterialInstances.IsValidIndex(Index) && MaterialInstances[Index] != nullptr)
		{
			// A RIM surface is painted through BaseColor (and RimColor), never Color (ApplyColourway): reading Color there
			// reported the parent's default, so a rim shell's paint -- Shadow Flame's coat -- was invisible to every proof.
			const TCHAR* Painted = BuiltMaterials[Index].Kind == EWonderlandCompanionMaterialKind::Rim ? TEXT("BaseColor") : TEXT("Color");
			MaterialInstances[Index]->GetVectorParameterValue(FMaterialParameterInfo(Painted), Body);
		}
		if (FlameMaterialInstances.IsValidIndex(Index) && FlameMaterialInstances[Index] != nullptr)
		{
			FlameMaterialInstances[Index]->GetVectorParameterValue(FMaterialParameterInfo(TEXT("Color")), Twin);
		}
		Out += FString::Printf(TEXT("%s|%s|%.4f,%.4f,%.4f|%.4f,%.4f,%.4f;"), *BuiltMaterials[Index].Name.ToString(),
			*BuiltMaterials[Index].Channel.ToString(), Body.R, Body.G, Body.B, Twin.R, Twin.G, Twin.B);
	}
	return Out;
}

bool AWonderlandCompanionEmbodiment::DeclaresFlame() const
{
	for (const FWonderlandCompanionMaterial& Material : BuiltMaterials)
	{
		if (WonderlandMascotStyle::IsFlameChannel(Material.Channel))
		{
			return true;
		}
	}
	return false;
}

bool AWonderlandCompanionEmbodiment::DeclaresStrips() const
{
	for (const FWonderlandCompanionMaterial& Material : BuiltMaterials)
	{
		if (WonderlandMascotStyle::IsStripChannel(Material.Channel))
		{
			return true;
		}
	}
	return false;
}

bool AWonderlandCompanionEmbodiment::QaReadPaint(FName Name, FLinearColor& OutBase, FLinearColor& OutRim, FString& OutRelief) const
{
	OutBase = OutRim = FLinearColor(-1.0f, -1.0f, -1.0f, 1.0f);
	OutRelief = TEXT("none");
	for (int32 Index = 0; Index < BuiltMaterials.Num(); ++Index)
	{
		if (BuiltMaterials[Index].Name != Name || !MaterialInstances.IsValidIndex(Index) || MaterialInstances[Index] == nullptr)
		{
			continue;
		}
		UMaterialInstanceDynamic* Instance = MaterialInstances[Index];
		if (BuiltMaterials[Index].Kind == EWonderlandCompanionMaterialKind::Rim)
		{
			Instance->GetVectorParameterValue(FMaterialParameterInfo(TEXT("BaseColor")), OutBase);
			Instance->GetVectorParameterValue(FMaterialParameterInfo(TEXT("RimColor")), OutRim);
			UTexture* Relief = nullptr;
			if (Instance->GetTextureParameterValue(FMaterialParameterInfo(TEXT("NormalTex")), Relief) && Relief != nullptr)
			{
				OutRelief = Relief->GetName();
			}
			// B65.1: the smoke's tone map rides with its relief (WonderlandMascotStyle::SmokeTextureName names them the same way)
			UTexture* Tone = nullptr;
			if (Instance->GetTextureParameterValue(FMaterialParameterInfo(TEXT("AlbedoTex")), Tone) && Tone != nullptr
				&& Tone->GetName().StartsWith(TEXT("WLSmokeTone")))
			{
				OutRelief += TEXT("+tone");
			}
		}
		else
		{
			Instance->GetVectorParameterValue(FMaterialParameterInfo(TEXT("Color")), OutBase);
		}
		return true;
	}
	return false;
}

FString AWonderlandCompanionEmbodiment::DescribeFramingParts() const
{
	// WHICH PARTS THE FRAMING BOX IS ACTUALLY MADE OF, and where each one sits.
	//
	// Written because the box measured 91 uu of body on a 155 uu figure and no amount of reasoning about the
	// classifier settled why. Python cannot enumerate these components -- get_components_by_class returns
	// nothing for them -- so the only way to see inside the union is to have the actor say it. Excluded parts
	// are listed too: a part missing from BOTH lists is a part that was never built, which is a different
	// fault from a part that was built and rejected.
	const FTransform Actor = GetActorTransform();
	FString In;
	FString Out;
	for (int32 Index = 0; Index < PartMeshes.Num(); ++Index)
	{
		const UInstancedStaticMeshComponent* Mesh = PartMeshes[Index].Get();
		const FString Name = PartMeshNames.IsValidIndex(Index)
			? PartMeshNames[Index].ToString() : FString(TEXT("?"));
		if (Mesh == nullptr)
		{
			Out += FString::Printf(TEXT("%s(null) "), *Name);
			continue;
		}
		const FBox Box = Mesh->Bounds.GetBox();
		const float Low = static_cast<float>(Box.Min.Z - Actor.GetLocation().Z);
		const float High = static_cast<float>(Box.Max.Z - Actor.GetLocation().Z);
		const FString Cell = FString::Printf(TEXT("%s[n=%d z%.0f..%.0f] "),
			*Name, Mesh->GetInstanceCount(), Low, High);
		if (PartMeshIsBody.IsValidIndex(Index) && PartMeshIsBody[Index])
		{
			In += Cell;
		}
		else
		{
			Out += Cell;
		}
	}
	return FString::Printf(TEXT("BODY: %s|| EXCLUDED: %s"), *In, *Out);
}

FBox AWonderlandCompanionEmbodiment::GetFramingBodyBounds() const
{
	// ---- THE FIGURE'S OWN TURN IS TAKEN OUT BEFORE THE BOX IS MEASURED.
	//
	// WHY, AND IT IS A BUG THE REGRESSION PROOF CAUGHT RATHER THAN A PRECAUTION. A component's Bounds is a
	// world-space axis-aligned box. A dog is deeper than it is wide, so turning it ninety degrees swaps those
	// two and the box genuinely changes shape -- and the wardrobe camera, which takes whichever axis binds,
	// then solves a different distance for the same skin. Photographed as the 360 inspection quietly resizing
	// the mascot, which is precisely what the founder ruled out: "360 must not alter permanent framing."
	//
	// So every part is brought back into the actor's own frame, unioned there, and the result is returned in
	// world units at the actor's position with the rotation left off. The box is then a property of the skin
	// and nothing else: the same figure gives the same box at every angle it can be looked at from.
	// ONLY THE YAW IS REMOVED, AND NOTHING ELSE IS TOUCHED.
	//
	// The first attempt at this took each part back through the actor's full inverse transform and then put it
	// forward again through a rotation-free one. That round trip is not identity: it divided the box by the
	// actor's scale and multiplied it back by the same scale in a different order, and the measured body came
	// out at a third of its real size on every skin -- small enough that a Max(..., 30.0f) floor caught it and
	// reported a tidy 30.0 uu for all five, which is how a broken measurement gets to look like a working one.
	//
	// So the box is never taken out of world units. It is shifted to the actor's origin, turned by the actor's
	// yaw alone, and shifted back. Scale is left exactly where it was, because a figure staged at a third size
	// really is a third as tall and the camera has to come in for it.
	const FTransform Actor = GetActorTransform();
	const FTransform UnYaw(FRotator(0.0f, -Actor.Rotator().Yaw, 0.0f).Quaternion());
	const FVector Origin = Actor.GetLocation();
	FBox Local(ForceInit);
	for (int32 Index = 0; Index < PartMeshes.Num(); ++Index)
	{
		if (!PartMeshIsBody.IsValidIndex(Index) || !PartMeshIsBody[Index])
		{
			continue;
		}
		const UInstancedStaticMeshComponent* Mesh = PartMeshes[Index].Get();
		if (Mesh == nullptr || Mesh->GetInstanceCount() <= 0)
		{
			continue;
		}
		Local += Mesh->Bounds.GetBox().ShiftBy(-Origin).TransformBy(UnYaw);
	}
	if (!Local.IsValid)
	{
		return Local;
	}
	return Local.ShiftBy(Origin);
}

FBox AWonderlandCompanionEmbodiment::GetSilhouetteBounds() const
{
	// The same yaw-only frame as GetFramingBodyBounds, over a wider set of meshes: everything built for a part that is the
	// figure, judged by how the part MOVES rather than what it is called or what it is made of. See the declaration.
	const FTransform Actor = GetActorTransform();
	const FTransform UnYaw(FRotator(0.0f, -Actor.Rotator().Yaw, 0.0f).Quaternion());
	const FVector Origin = Actor.GetLocation();
	FBox Local(ForceInit);
	for (int32 Index = 0; Index < PartMeshes.Num(); ++Index)
	{
		const UInstancedStaticMeshComponent* Mesh = PartMeshes[Index].Get();
		if (Mesh == nullptr || Mesh->GetInstanceCount() <= 0 || !PartMeshNames.IsValidIndex(Index))
		{
			continue;
		}
		const int32 Part = PartNames.IndexOfByKey(PartMeshNames[Index]);
		const EWonderlandCompanionMotion Motion = Motions.IsValidIndex(Part) ? Motions[Part].Motion : EWonderlandCompanionMotion::None;
		if (Motion == EWonderlandCompanionMotion::Twinkle || Motion == EWonderlandCompanionMotion::Trail
			|| Motion == EWonderlandCompanionMotion::Float || Motion == EWonderlandCompanionMotion::Orbit)
		{
			continue;
		}
		Local += Mesh->Bounds.GetBox().ShiftBy(-Origin).TransformBy(UnYaw);
	}
	return Local.IsValid ? Local.ShiftBy(Origin) : Local;
}

FBox AWonderlandCompanionEmbodiment::GetFlameBounds() const
{
	if (FlameSurface == nullptr || !FlameSurface->IsVisible() || FlameSources.Num() == 0)
	{
		return FBox(ForceInit);
	}
	const FTransform Actor = GetActorTransform();
	const FTransform UnYaw(FRotator(0.0f, -Actor.Rotator().Yaw, 0.0f).Quaternion());
	const FVector Origin = Actor.GetLocation();
	return FlameSurface->Bounds.GetBox().ShiftBy(-Origin).TransformBy(UnYaw).ShiftBy(Origin);
}

void AWonderlandCompanionEmbodiment::SetShowcaseLit(bool bShowcase)
{
	// Channel 1 alone for a showcase; channel 0 alone for a body that lives in the world. Applied to every
	// primitive the figure owns, including ones built after this call -- see the re-application in
	// LoadFigure, because a skin swapped in the wardrobe builds a whole new set of components.
	bShowcaseLit = bShowcase;
	FLightingChannels Channels;
	Channels.bChannel0 = !bShowcase;
	Channels.bChannel1 = bShowcase;
	Channels.bChannel2 = false;
	TArray<UPrimitiveComponent*> Parts;
	GetComponents<UPrimitiveComponent>(Parts);
	for (UPrimitiveComponent* Part : Parts)
	{
		if (Part != nullptr)
		{
			Part->SetLightingChannels(Channels.bChannel0, Channels.bChannel1, Channels.bChannel2);
		}
	}
}

void AWonderlandCompanionEmbodiment::SetExposureAware(bool bAware)
{
	if (bExposureAware == bAware)
	{
		return;
	}
	bExposureAware = bAware;
	if (!bAware)
	{
		// ---- A FIGURE OFF THE CLOCK STILL NEEDS ITS EYES LIT, and forgetting that was a regression I put in.
		//
		// The wardrobe's preview body opts out of the day cycle so that a showcase does not get dimmer after
		// sunset. But the eyes are driven by that same cycle now, and opting out left them at the default of
		// 1 -- which, multiplied by the wardrobe's own glow scale, is a fraction of what they were before the
		// eye work went in. Photographed at noon: Relay OG in the preview square with its warm gold status
		// eyes simply not lit, on the very feature whose requirement was "eyes have to be glowing".
		//
		// So a figure that ignores the clock is given a fixed showcase level instead of inheriting nothing.
		// It is deliberately lower than the world's noon value: the preview stage is a dark room a few
		// centimetres across, and what reads as a lamp against sunlit stone would be a white hole in here.
		// 14, not 6, since the stage's glow scale came down to 0.10 with the generator's re-baseline: the eye is
		// driven to 14 x 0.10 = 1.4 against a stage white near 2 -- a bright coloured core, not a white hole and
		// not a dull square. The world drives the same eye to 12 against a white near 25.
		EyeGlowScale = FMath::Max(CVarPreviewEyeGlow.GetValueOnAnyThread(), 0.0f);
		RepaintColourway();
	}
}

void AWonderlandCompanionEmbodiment::SetShowcaseEyeGlow(float Level)
{
	// FOR A FIGURE THAT IS OFF THE CLOCK ONLY. An exposure-aware body takes its eye level from the day cycle
	// and must not be overridden here; SetEyeGlow is that path and guards itself the same way in reverse.
	//
	// RE-APPLIED RATHER THAN SET ONCE, so wl.Look.PreviewEyeGlow is live: the showcase level is assigned
	// during SetExposureAware(false), which runs when the stage builds its body and never again, so without
	// this the knob could only ever be read at startup. That is the same shape as the glow scale, which was
	// dead for exactly this reason until it was re-applied per tick.
	if (bExposureAware)
	{
		return;
	}
	const float Wanted = FMath::Max(Level, 0.0f);
	// Relative, with a small absolute floor -- see SetGlowScale, where a FIXED tolerance of 0.001 guarding a
	// knob shipped at 0.001 made its whole working range inexpressible and silently killed a sweep's control.
	const float Tolerance = FMath::Max(FMath::Max(FMath::Abs(EyeGlowScale), FMath::Abs(Wanted)) * 1.0e-3f,
	                                   UE_SMALL_NUMBER);
	if (FMath::IsNearlyEqual(EyeGlowScale, Wanted, Tolerance))
	{
		return;
	}
	EyeGlowScale = Wanted;
	RepaintColourway();
}

float AWonderlandCompanionEmbodiment::GetEyeGlowScale() const
{
	return EyeGlowScale;
}

void AWonderlandCompanionEmbodiment::SetEyeGlow(float Scale)
{
	if (!bExposureAware)
	{
		return;
	}
	const float Wanted = FMath::Clamp(Scale, 0.05f, 30.0f);   // was 12: EyeGlowDay 18 was never reachable
	if (FMath::IsNearlyEqual(EyeGlowScale, Wanted, 0.004f))
	{
		return;
	}
	EyeGlowScale = Wanted;
	RepaintColourway();
}

void AWonderlandCompanionEmbodiment::SetRimBoost(float Amount)
{
	// ---- AN EDGE ON THE FIGURE AFTER DARK, BECAUSE AT 04:00 IT IS DARKER THAN THE GROUND IT STANDS ON.
	//
	// Measured twice, reproducibly: the mascot reads 0.074 luma against ground at 0.121 at the darkest hour,
	// a separation of 0.0476 against a floor of 0.05. Marginal, but consistent -- and the direction is the
	// telling part. A bone-white dog should not be DARKER than the stone under it.
	//
	// WHY NOT MORE MOONLIGHT OR MORE FILL, which were the obvious levers. Both light the ground MORE than the
	// figure, because the ground is a large horizontal surface facing a light source that is overhead and a
	// sky that is everywhere, while a standing figure presents mostly vertical surfaces to both. Raising
	// either widens the gap it is meant to close, and the night-is-still-night clause (N10, ratio <= 0.38)
	// caps how far they can go regardless.
	//
	// A rim is the answer the problem actually asks for, and it is what any night scene does to keep a
	// character off its background. RimAmp already exists on every Rim material the figures are built from,
	// and the shell -- bone, gold, linen, frost -- is exactly what should catch it. Nothing emissive is
	// touched, so this cannot lift the fire or the eyes and cannot interact with NightGlowScale.
	// ---- AND THE SHOWCASE DOES NOT TAKE IT, FOR THE SAME REASON IT DOES NOT TAKE THE EYE LEVEL.
	//
	// The day cycle drives this across EVERY embodiment in the world, and the wardrobe mannequin is one of
	// them. Letting it through would make the preview change with the hour -- brighter-edged at midnight than
	// at noon -- which is precisely the live-world dependency the founder ruled out, and precisely the bug
	// that had the wardrobe measuring three times darker at midnight before the figure was moved onto its own
	// lighting channel. The preview is a stage in a box; the clock does not reach into it.
	if (!bExposureAware)
	{
		return;
	}
	const float Wanted = FMath::Clamp(Amount, 1.0f, 6.0f);
	if (FMath::IsNearlyEqual(RimBoost, Wanted, 0.01f))
	{
		return;
	}
	RimBoost = Wanted;
	for (int32 Index = 0; Index < BuiltMaterials.Num(); ++Index)
	{
		if (BuiltMaterials[Index].Kind != EWonderlandCompanionMaterialKind::Rim)
		{
			continue;
		}
		if (MaterialInstances.IsValidIndex(Index) && MaterialInstances[Index] != nullptr)
		{
			// a smoke surface's own rim amplitude rides on the boost (B65), so the night lifts it exactly as much as any rim
			const float Own = WonderlandMascotStyle::IsSmokeLook(BuiltMaterials[Index].Look) ? WonderlandMascotStyle::SmokeRimAmp() : 1.0f;
			MaterialInstances[Index]->SetScalarParameterValue(TEXT("RimAmp"), RimBoost * Own);
		}
	}
}

void AWonderlandCompanionEmbodiment::SetNightGlow(float Scale)
{
	// THE SHOWCASE TAKES THIS ONE, AND EXEMPTING IT WAS A MISTAKE.
	//
	// bExposureAware was added so a wardrobe preview would not get dimmer after sunset, and it is right for
	// the EYE level, which is a brightness the showcase sets for itself. It was wrong here. This correction
	// exists to cancel the night exposure lift on emissive surfaces -- and the preview is drawn through the
	// same camera with the same exposure as everything else, so its fire is lifted by exactly the same 1.45 EV.
	//
	// Measured: with the figure on its own lighting channel and the stage rig at four times its old strength,
	// Relay OG's preview settled to a 1.8x spread across the day while ARDEN INFERNAL went the other way to
	// 2.2x -- brighter at midnight, because the one part of it that is emissive was the one part still riding
	// the clock. It only touches glowing channels, so nothing about the showcase's lit surfaces changes.
	const float Wanted = FMath::Clamp(Scale, 0.05f, 1.0f);
	if (FMath::IsNearlyEqual(NightGlowScale, Wanted, 0.004f))
	{
		return;
	}
	NightGlowScale = Wanted;
	RepaintColourway();
}

void AWonderlandCompanionEmbodiment::ApplyColourway(int32 MaterialIndex, UMaterialInstanceDynamic* Instance,
	const FWonderlandCompanionMaterial& Def, const FLinearColor& Lit, const FLinearColor& Emissive,
	bool bFlameTwin)
{
	if (Instance == nullptr)
	{
		return;
	}
	const bool bGlows = Def.Kind == EWonderlandCompanionMaterialKind::Glow
		|| Def.Kind == EWonderlandCompanionMaterialKind::Additive;
	const FLinearColor Authored = bGlows ? Emissive : Lit;

	// ---- WHICH COLOURWAY, IF ANY. A Sub-Agent Cub wears none, and neither does anything unclassified.
	const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
	FLinearColor Primary = FLinearColor::White;
	FLinearColor Secondary = FLinearColor::White;
	bool bChosen = false;
	if (BodyRole == EWonderlandBodyRole::Mascot && Style.bChosen)
	{
		Primary = Style.Primary;
		Secondary = Style.Secondary;
		bChosen = true;
	}
	else if (BodyRole == EWonderlandBodyRole::Companion && Style.bCompanionChosen)
	{
		Primary = Style.CompanionPrimary;
		Secondary = Style.CompanionSecondary;
		bChosen = true;
	}

	// ---- AND WHICH CHANNELS IT MAY TOUCH. Everything the skin's artist authored on top of the shared shell --
	// Skeleton Flame's ghostfire, Arden's ember and char, Apollo's solar, Celestial Light's starlight and
	// banner, and the black visor every one of them is recognised by -- is None, and is written back at its
	// authored colour. That is what makes a repaint safe to run repeatedly: it is idempotent, and a channel
	// the founder did not ask for is restored rather than merely skipped.
	// AND HOW HARD THE FIRE BURNS ON THIS PARTICULAR BODY. Only the glowing channels: dimming the shell as
	// well would turn a wardrobe preview into a night scene. See SetGlowScale.
	// AND HOW HARD IT BURNS AGAINST THE SKY, which is the clock's business rather than the wardrobe's. The two
	// factors are multiplied and never assigned over one another: a preview figure at 0.10 stays at 0.10 all
	// night. See SetNightGlow.
	//
	// THE EYES ARE ON THEIR OWN CURVE AND TAKE NEITHER OF THE OTHER TWO SKY FACTORS. The founder asked for
	// them to be glowing at every hour, and the night correction -- right for fire and halos -- would cut
	// them five-fold exactly when the rest of the figure goes dark too. See SetEyeGlow.
	const EWonderlandColorChannel Channel = WonderlandMascotStyle::ChannelFor(Def.Name.ToString());
	const bool bIsEye = Channel == EWonderlandColorChannel::Eye;
	FLinearColor Want = Authored;
	if (bGlows && !bIsEye)
	{
		// ---- AND A FLAME TWIN DOES NOT TAKE THE NIGHT CORRECTION.
		//
		// wl.Look.NightGlow exists to stop emissive surfaces clipping when the night exposure opens 1.45 EV,
		// and it is right for a body's glow. It is wrong for the FIRE. The founder's reference footage shows
		// the ghostfire blazing in a dark plaza -- that plume is the skin, not an artefact -- and cutting it
		// five-fold after dark is precisely the "flames I need back" complaint. The shell around it still
		// takes the correction, so the Dog does not wash out; only the fire is left alone.
		// HALF THE NIGHT CORRECTION FOR THE FIRE. Exempt entirely, Arden's halo fire photographed as a yellow blaze
		// over the whole head at night (round 2): the night exposure opens 1.45 EV and a 12,600 ember clips. Half
		// way keeps the fire plainly there after dark -- the founder's video -- without it swallowing the figure.
		Want = Authored * GlowScale * (bFlameTwin ? FMath::Lerp(1.0f, NightGlowScale, 0.5f) : NightGlowScale);
	}
	else if (bGlows)
	{
		// ---- AN EYE IS DRIVEN TO A LEVEL, NOT MULTIPLIED BY ONE, AND THE SWEEP IS WHY.
		//
		// A single multiplier was tried first and cannot work here, because the five skins author their eyes
		// across a huge range. Measured at noon at 3.2x: Relay OG's eyes sat 0.54 above its face and were not
		// clipped at all, Apollo's cleared its bright gold armour by 0.03, and Arden's and Celestial Light's
		// were 100% blown to white. Multiplying moves all five and fixes none -- the dim one needs more and
		// the bright ones need less, from the same knob.
		//
		// So the hue is kept and the BRIGHTNESS IS REPLACED. Every skin's eyes then land at the same
		// deliberately chosen level, which is not merely convenient: the eyes are a status indicator, and a
		// status light that is twenty times brighter on one costume than another is a worse instrument than
		// one that reads the same everywhere. The founder's SECONDARY colour still shows, because only the
		// magnitude is taken -- the direction through the colour cube is the skin's own.
		const float Peak = FMath::Max3(Authored.R, FMath::Max(Authored.G, Authored.B), KINDA_SMALL_NUMBER);
		// ---- AND THE HALO AROUND THE EYE TAKES A FRACTION OF THE EYE'S LEVEL.
		//
		// FOUNDER, 2026-09-27: "COLORED EYE CORE + EMISSIVE LIGHT + CONTROLLED BLOOM/HALO + CLEAR CONTRAST
		// AGAINST THE FACE." The generator lays an additive pane, named "eyehalo", just behind and a little
		// wider than each eye. It is routed here as an eye -- the name contains "eye", which is right: it is
		// the eye's own light and must follow the eye's clock, not the body's night correction -- but at the
		// eye's full level it would be a second, bigger eye. A rim is a rim because it is dimmer than what it
		// rims, so a halo takes about a third of the level the core is driven to.
		// ON THE SOFT MATERIAL THE SHARE IS THREE-QUARTERS, NOT A THIRD. The flat additive at 0.28 was the most a hard
		// pane could carry before it read as a second eye; the radial surface holds that level only over the eye
		// itself (hidden behind the core) and fades from there, so the spill next to the core starts bright and
		// is gone by the pane's edge. That fade is what reads as glow. Round 3's 0.28 on the flat pane read as a
		// frame (EYES_round3_day_night.png), and the founder's word for it was "gone".
		const bool bHalo = Def.Name.ToString().Contains(TEXT("halo"), ESearchCase::IgnoreCase);
		const bool bSoftHalo = bHalo && Instance != nullptr && Instance->Parent != nullptr
			&& Instance->Parent->GetFName() == FName(TEXT("M_WL_EyeHalo"));
		const float HaloShare = bSoftHalo ? 0.75f : (bHalo ? 0.28f : 1.0f);
		Want = (Authored / Peak) * EyeGlowScale * GlowScale * HaloShare;
	}
	if (bChosen)
	{
		if (BodyRole == EWonderlandBodyRole::Companion)
		{
			// ---- A COMPANION IS ROUTED BY WHAT A SURFACE IS, NOT BY WHAT IT IS CALLED.
			//
			// FOUNDER: "PRIMARY controls the AI Companion's SOLID WHITE BODY PARTS ... SECONDARY controls the
			// AI Companion's GLOW / ENERGY portions ... These channels MUST be genuinely independent."
			//
			// The mascot's channels are decided by material NAME, because a Relay Dog skin's authored art has
			// to be protected piece by piece -- bone and bonedeep may be recoloured, a visor and a banner may
			// not. A companion is a different object and the founder has asked for a different split: the
			// shell against the light. That is the material's KIND, which is exactly the distinction already
			// drawn everywhere else in this function -- Lit and Rim are the body, Glow and Additive are the
			// energy -- so routing on it is both what was asked for and genuinely independent by construction.
			//
			// Neither multiply changes intensity. Primary tints a lit surface and cannot make it emissive;
			// Secondary tints an emissive one and cannot make the companion brighter. "Colour customization
			// must change COLOR, not flatten the materials."
			Want *= bGlows ? Secondary : Primary;
		}
		else if (Def.Channel == TEXT("secondary") || Def.Channel == TEXT("secondary_light") || Def.Channel == TEXT("secondary_deep"))
		{
			// ---- A SKIN'S SECONDARY ACCENTS: surfaces the FIGURE tags `secondary` (founder, 2026-09-29: "For JACK
			// FLAME: the SECONDARY COLOR customization must control BOTH the FLAMES and the RED TIE").
			//
			// Declared per material in the figure file, so which surfaces follow the Secondary is the skin's own data
			// and no skin is named here. The flame twin comes through this same function (bFlameTwin), so the
			// ribbons of fire and the boxes of the tie take the one colour together, and the saved rest colours
			// below keep the glow animator from putting the authored red back next frame. Only a Secondary the
			// player actually picked moves them: picking a primary alone leaves the fire as it was designed.
			if (UWonderlandMascotStyleSettings::Get().HasChosenSecondary())
			{
				// AND THE SUIT (founder, 2026-09-30: "flames, tie, suit"): a `secondary_deep` cloth takes a deep shade of
				// the colour rather than the authored near-black brightness, which would leave it visibly unchanged.
				Want = Def.Channel == TEXT("secondary_deep")
					? WonderlandMascotStyle::DeepAccentColour(Want, Secondary)
					: WonderlandMascotStyle::AccentColour(Want, Secondary, Def.Channel == TEXT("secondary_light"));
			}
		}
		else if (WonderlandMascotStyle::IsPrimaryChannel(Def.Channel))
		{
			// ---- A `primary` SURFACE TAKES THE CHOSEN PRIMARY AS ITS COLOUR (founder, 2026-10-02: "WHITE -> pure white ...
			// Do not allow the default near-black/navy Shadow Flame base to tint or multiply the selected primary color").
			//
			// The multiply below is a tint, and a tint of a near-white shell is the chosen colour -- but Shadow Flame's coat
			// is authored near-black, and anything times near-black stays near-black: white left it exactly as designed,
			// every other colour came out dark. A figure tags its shell `primary` to say the chosen colour IS the shell's
			// colour. Only a REAL choice does it (HasChosenPrimary): DEFAULT still means the coat as designed. A Rim surface
			// keeps its rim at the figure's strength, in the same hue (see the switch below), so the shell still reads.
			if (WonderlandMascotStyle::HasChosenPrimary())
			{
				Want = FLinearColor(Primary.R, Primary.G, Primary.B, Want.A);
				// ---- AND THE COAT'S DEEP PARTS KEEP THEIR DEPTH (B65, founder: "darker crimson shadowing + brighter crimson
				// highlights ... visible form separation"). A LIT `primary` surface is the deep coat (cuffs, soles): it takes a
				// darker shade of the SAME colour, never the old navy. Black is already the deepest it can be.
				if (Def.Kind == EWonderlandCompanionMaterialKind::Lit)
				{
					Want = FLinearColor(Primary.R * 0.62f, Primary.G * 0.62f, Primary.B * 0.62f, Want.A);
				}
			}
		}
		else
		{
			switch (Channel)
			{
			case EWonderlandColorChannel::Body: Want *= Primary;   break;
			case EWonderlandColorChannel::Eye:  Want *= Secondary; break;
			case EWonderlandColorChannel::None: default:                     break;
			}
		}
	}

	// ---- COLOR 3: A SKIN'S STRIPS FOLLOW THE STRIPS COLOUR (B65, founder, 2026-10-02: "The user should be able to change the
	// strips without changing the body ... Changing Color 3 must NOT recolor the entire mascot; recolor eyes accidentally;
	// affect companion swords; reset clothing").
	//
	// The fire's twin, and outside the colourway for the same reason: picking a primary or a secondary never moves the strips,
	// and picking the strips moves nothing else. Declared by the figure (`strip`), so no skin is named here; only the Dog's
	// own costume and the Wardrobe's mannequin of it wear it. The colour is taken as it is (the pure-colour rule): white
	// strips are white, black strips black. Their detail -- the grazing-angle edge, the motion -- is the smoke look's below.
	if (BodyRole == EWonderlandBodyRole::Mascot && WonderlandMascotStyle::IsStripChannel(Def.Channel)
		&& WonderlandMascotStyle::HasChosenStrip())
	{
		const FLinearColor Strip = WonderlandMascotStyle::StripColour();
		Want = FLinearColor(Strip.R, Strip.G, Strip.B, Want.A);
	}

	// ---- A FLAME SKIN'S FIRE FOLLOWS THE FLAME COLOUR (founder, 2026-10-01: "Flame Color ... This must be independent
	// from normal body/secondary color").
	//
	// OUTSIDE THE COLOURWAY ABOVE ON PURPOSE: a player who has picked no primary or secondary can still recolour the fire,
	// and picking either of those never moves it. Declared by the figure (`flame` / `flame_light`), so no skin is named
	// here, and only the Dog's own costume and the Wardrobe's mannequin of it wear it -- a companion and a Sub-Agent Cub
	// keep their own fire. The flame twin comes through this same function, so both instances of the fire take it.
	if (BodyRole == EWonderlandBodyRole::Mascot && WonderlandMascotStyle::IsFlameChannel(Def.Channel)
		&& WonderlandMascotStyle::HasChosenFlame())
	{
		static const FName FlameLight(TEXT("flame_light"));
		Want = WonderlandMascotStyle::AccentColour(Want, WonderlandMascotStyle::FlameColour(), Def.Channel == FlameLight);
	}

	switch (Def.Kind)
	{
	case EWonderlandCompanionMaterialKind::Lit:
		Instance->SetVectorParameterValue(TEXT("Color"), Want);
		break;
	case EWonderlandCompanionMaterialKind::Rim:
		Instance->SetVectorParameterValue(TEXT("BaseColor"), Want);
		if (WonderlandMascotStyle::IsSmokeLook(Def.Look))
		{
			// ---- THE SMOKE LOOK (B65): the base stays EXACTLY the colour (above); the detail is a cloudy relief, a roughness
			// that wanders and a grazing-angle rim in a BRIGHTER TINT OF THE SAME HUE -- "the selected color changes the palette,
			// not the amount of detail" (WonderlandMascotStyle::IsSmokeLook). It is worn by a RECOLOURED surface; the designed
			// colours keep the designed look exactly (the founder's reference is that look), unless wl.Shadow.OnDefault asks.
			const bool bStrip = WonderlandMascotStyle::IsStripChannel(Def.Channel);
			const bool bRecoloured = bStrip
				? (BodyRole == EWonderlandBodyRole::Mascot && WonderlandMascotStyle::HasChosenStrip())
				: (bChosen && BodyRole == EWonderlandBodyRole::Mascot && WonderlandMascotStyle::IsPrimaryChannel(Def.Channel) && WonderlandMascotStyle::HasChosenPrimary());
			if (bRecoloured || WonderlandMascotStyle::SmokeOnDefault())
			{
				// the strips' edge stays subtle (founder, 10-01: "very subtle rim illumination"), the body's reads
				const float Gain = bStrip ? WonderlandMascotStyle::SmokeStripRimGain() : WonderlandMascotStyle::SmokeRimGain();
				Instance->SetVectorParameterValue(TEXT("RimColor"), bRecoloured ? WonderlandMascotStyle::SmokeRimTint(Want) * Gain
					: Want * WonderlandTameGlow(Def.Strength));
				Instance->SetScalarParameterValue(TEXT("RimAmp"), RimBoost * WonderlandMascotStyle::SmokeRimAmp());
				if (!bStrip || WonderlandMascotStyle::SmokeStripRelief())
				{
					WonderlandMascotStyle::ApplySmokeDetail(Instance);
				}
				else
				{
					WonderlandMascotStyle::RestoreSmokeDetail(Instance);
				}
				break;
			}
			// THE DESIGNED LOOK, EXACTLY: nothing the smoke look wrote is left behind (a colour picked, then DEFAULT)
			WonderlandMascotStyle::RestoreSmokeDetail(Instance);
			Instance->SetScalarParameterValue(TEXT("RimAmp"), RimBoost);
		}
		// The rim keeps its own relationship to the base: it is the same hue, at the strength the figure asked
		// for, so a recoloured shell still reads as a shell and not as a flat card.
		Instance->SetVectorParameterValue(TEXT("RimColor"), Want * WonderlandTameGlow(Def.Strength));
		break;
	case EWonderlandCompanionMaterialKind::Glow:
		Instance->SetVectorParameterValue(TEXT("Color"), Want);
		Instance->SetVectorParameterValue(TEXT("EmissiveColor"), Want);
		Instance->SetVectorParameterValue(TEXT("BaseColor"), Want);
		break;
	case EWonderlandCompanionMaterialKind::Additive:
		// see the build loop: the additive material has no strength parameter, so the scene scale rides in Color
		Instance->SetVectorParameterValue(TEXT("Color"), Want * WonderlandSceneUnits);
		Instance->SetVectorParameterValue(TEXT("EmissiveColor"), Want * WonderlandSceneUnits);
		Instance->SetVectorParameterValue(TEXT("BaseColor"), Want);
		break;
	}

	// AND THE PULSE REMEMBERS THE NEW REST. The glow animator drives Color from a remembered rest colour; left
	// alone it would put the old one back on the next frame and the recolour would last exactly one tick.
	//
	// EACH INSTANCE REMEMBERS ITS OWN. The two share a material index, so writing both into GlowMaterials::Rest
	// meant the flame twin's value -- far brighter, because a ribbon is fed the untamed colour -- landed on
	// the body and the animator then drove the shell at flame brightness. See the bFlameTwin parameter.
	if (bFlameTwin)
	{
		if (FlameRestColours.IsValidIndex(MaterialIndex))
		{
			FlameRestColours[MaterialIndex] = Want;
		}
		return;
	}
	for (FGlowMaterial& Glow : GlowMaterials)
	{
		if (Glow.MaterialIndex == MaterialIndex && Glow.Parameter == TEXT("Color"))
		{
			// the same scale the switch above just wrote: the animator replaces Color every tick from this
			Glow.Rest = RestColourFor(Def.Kind, Want);
		}
	}
}

void AWonderlandCompanionEmbodiment::RepaintColourway()
{
	for (int32 Index = 0; Index < BuiltMaterials.Num(); ++Index)
	{
		const FWonderlandCompanionMaterial& Def = BuiltMaterials[Index];
		const FLinearColor Lit(Def.Color.R, Def.Color.G, Def.Color.B, 1.0f);
		const FLinearColor Emissive = Lit * WonderlandTameGlow(Def.Strength);
		if (MaterialInstances.IsValidIndex(Index))
		{
			ApplyColourway(Index, MaterialInstances[Index], Def, Lit, Emissive);
		}
		// THE FLAME TWIN TOO, at its own uncompressed strength -- the same colour, not the same number.
		UMaterialInstanceDynamic* Body = MaterialInstances.IsValidIndex(Index) ? MaterialInstances[Index] : nullptr;
		UMaterialInstanceDynamic* Flame = FlameMaterialInstances.IsValidIndex(Index)
			? FlameMaterialInstances[Index] : nullptr;
		if (Flame != nullptr && Flame != Body)
		{
			const FLinearColor Full = Lit * WonderlandFlameStrength(Def.Strength, bFlameOnFireMaster);
			ApplyColourway(Index, FlameMaterialInstances[Index], Def, Full, Full, /*bFlameTwin=*/true);
		}
	}
}

void AWonderlandCompanionEmbodiment::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const UWorld* World = GetWorld();
	if (World == nullptr)
	{
		return;
	}

	// The orbit's own clock: the rate eases toward the flight's, and the angle is the running sum of it. Every
	// companion in the same flight integrates the same rate on the same frames, so they stay opposite.
	const bool bOrbiting = ContractActor.IsValid() && WonderlandFormationOrbits(Formation);
	const float WantRate = bOrbiting ? WonderlandCompanionOrbitFor(Formation).Revolutions : 0.0f;
	OrbitRate = FMath::FInterpTo(OrbitRate, WantRate, DeltaSeconds, 1.6f);
	OrbitTurns += static_cast<double>(OrbitRate) * DeltaSeconds;

	APlayerController* Controller = FollowController.Get();
	const APawn* Pawn = Controller != nullptr ? Controller->GetPawn() : nullptr;
	if (Pawn != nullptr)
	{
		FVector Target = DesiredLocation(Pawn);
		if (bRoutingHome)
		{
			Target = RouteHome(Pawn, Target, static_cast<float>(World->GetTimeSeconds()));
		}
		// OUT OF THE WALLS. Swept from the Dog's chest to where the companion's body would float, on the camera
		// channel -- the same geometry that stops the follow camera -- so beside a wall or down a narrow lane the
		// companion draws in toward the Dog instead of hovering inside the stone. The Dog itself never blocks.
		//
		// AN ORBIT IS SWEPT FROM ITS CENTRE, THE CONTRACT. Swept from the Dog, any planter between the Dog and the far
		// side of the circle pulled the companion back to the Dog: in the second film they dropped to the ground
		// 7 uu from it, mid-orbit, and one was pulled onto the verification beam. The sight-line flank is not swept
		// at all -- pulled in, it would land on exactly the line it exists to keep clear.
		const bool bOrbitFlight = ContractActor.IsValid() && WonderlandFormationOrbits(Formation);
		const bool bFlankFlight = ContractActor.IsValid() && Formation == EWonderlandCompanionFormation::ClearTheSightLine;
		UWorld* SweepWorld = bFlankFlight ? nullptr : GetWorld();
		if (SweepWorld != nullptr)
		{
			const FVector BodyLift(0.0, 0.0, BodyClearanceHeightUU);
			FCollisionQueryParams Query(SCENE_QUERY_STAT(WonderlandCompanionFollow), false, this);
			Query.AddIgnoredActor(Pawn);
			// Nor the Contract, nor another companion: an orbit is not a wall, and a companion pulled short by the
			// crystal it is circling would crowd in toward the Dog on exactly the side the other one is on.
			if (const AActor* Contract = ContractActor.Get())
			{
				Query.AddIgnoredActor(Contract);
			}
			for (TActorIterator<AWonderlandCompanionEmbodiment> Other(SweepWorld); Other; ++Other)
			{
				Query.AddIgnoredActor(*Other);
			}
			FHitResult Hit;
			const FVector SweepFrom = bOrbitFlight ? ContractActor.Get()->GetActorLocation() : Pawn->GetActorLocation();
			if (SweepWorld->SweepSingleByChannel(Hit, SweepFrom, Target + BodyLift, FQuat::Identity, ECC_Camera,
				FCollisionShape::MakeSphere(BodyClearanceRadiusUU), Query) && !Hit.bStartPenetrating)
			{
				Target = Hit.Location - BodyLift;
			}
		}
		FVector Location = GetActorLocation();
		FRotator Facing = GetActorRotation();

		// ROOM FOR THE DOG. In a mission flight nothing should brush past it: a companion whose body would be at the
		// Dog's height and within its reach is moved straight out from it. (Following, the offsets place a companion
		// at the Dog's shoulder on purpose, so this is for mission flights only.)
		if (bHasSnapped && (bOrbitFlight || bFlankFlight))
		{
			FVector FromDog = Target - Pawn->GetActorLocation();
			const double Level = FromDog.Z;
			FromDog.Z = 0.0;
			const double Reach = FromDog.Size();
			if (Reach < DogSpacingUU && Level < 110.0)
			{
				const FVector Out = Reach > 1.0 ? FromDog / Reach : FVector(0.0, FormationPhase < 0.5f ? -1.0 : 1.0, 0.0);
				Target += Out * (DogSpacingUU - Reach);
			}
		}

		// ROOM FOR EACH OTHER. Flights change together, so two companions can be sent across each other's path --
		// into an orbit from either side of the Dog, or home again at completion. Whichever is inside the other's
		// space is steered out of it, and because both do it they part and pass instead of meeting.
		if (bHasSnapped)
		{
			for (TActorIterator<AWonderlandCompanionEmbodiment> Other(GetWorld()); Other; ++Other)
			{
				// A PEER, OR NOTHING AT ALL. Every Sub-Agent Cub carries a body of this class, and so does the
				// Dog itself and the wardrobe's mannequin. Counting them as companions is what made summoning
				// Cubs shove the AI Companions about and push them into the floor. See IsIndependentCompanion.
				if (*Other == this || !Other->IsIndependentCompanion())
				{
					continue;
				}
				// FLAT, AND ONLY FLAT. This kept half of the vertical separation, so a body floating above this
				// one produced a push with a DOWNWARD component -- and a companion hovering 34 uu off the ground
				// has nowhere downward to go but through it. Two companions at different heights still part
				// perfectly well sideways, which is the only direction the composition ever cared about.
				FVector Apart = Location - Other->GetActorLocation();
				Apart.Z = 0.0;
				const double Gap = Apart.Size();
				if (Gap < CompanionSpacingUU)
				{
					const FVector Away = Gap > 1.0
						? Apart / Gap
						: FVector(0.0, FormationPhase < 0.5f ? 1.0 : -1.0, 0.0);
					Target += Away * ((CompanionSpacingUU - Gap) * 1.5);
				}
			}
		}

		// ---- AND NEVER BELOW THE GROUND, whatever anything above decided.
		//
		// FOUNDER, 2026-09-25, with video: the AI Companions "sink or merge into the floor". The cause is fixed
		// above -- cub bodies were being counted as companions to steer away from -- but a companion standing in
		// the world's floor is a thing the founder should never see again for ANY reason, so the floor is now a
		// floor. Traced from well above the target to well below it, on the channel the world's ground blocks;
		// the body is held at least its own half-hover clear of whatever it finds, and left alone if it finds
		// nothing (out over water, or mid-orbit above a gap) rather than snapped to some invented height.
		//
		// This is also what makes UNEVEN GROUND work, which the founder's test list asks for: the follow offset
		// is measured from the DOG's feet, so a companion walking beside a Dog on a slope was already being asked
		// to stand at the Dog's height rather than at its own.
		if (UWorld* FloorWorld = GetWorld())
		{
			FHitResult Floor;
			FCollisionQueryParams FloorQuery(SCENE_QUERY_STAT(WonderlandCompanionFloor), false, this);
			FloorQuery.AddIgnoredActor(Pawn);
			for (TActorIterator<AWonderlandCompanionEmbodiment> Body(FloorWorld); Body; ++Body)
			{
				FloorQuery.AddIgnoredActor(*Body);
			}
			for (TActorIterator<AWonderlandSubAgentCub> Cub(FloorWorld); Cub; ++Cub)
			{
				FloorQuery.AddIgnoredActor(*Cub);
			}
			if (FloorWorld->LineTraceSingleByChannel(Floor, Target + FVector(0.0, 0.0, 400.0),
					Target - FVector(0.0, 0.0, 800.0), ECC_Visibility, FloorQuery))
			{
				Target.Z = FMath::Max(Target.Z, Floor.ImpactPoint.Z + HoverHeightUU * 0.5);
			}
		}

		if (!bHasSnapped || FVector::DistSquared(Location, Target) > FMath::Square(SnapDistanceUU))
		{
			// A spawn, or a teleport: be there, facing the way the Dog faces, rather than streak across the world.
			Location = Target;
			Facing = FRotator(0.0, Pawn->GetActorRotation().Yaw, 0.0);
			bHasSnapped = true;
		}
		else
		{
			// Exponential lag: frame-rate independent, and it never overshoots the place it is heading for.
			const float Alpha = FollowLagSeconds <= KINDA_SMALL_NUMBER ? 1.0f : 1.0f - FMath::Exp(-DeltaSeconds / FollowLagSeconds);
			Location = FMath::Lerp(Location, Target, Alpha);

			IdleSeconds = Pawn->GetVelocity().Size2D() < 15.0 ? IdleSeconds + DeltaSeconds : 0.0f;
			double DesiredYaw = Pawn->GetActorRotation().Yaw;
			const AActor* Contract = ContractActor.Get();
			if (Contract != nullptr && WonderlandFormationOrbits(Formation))
			{
				// Circling the Contract, a companion faces it: it is working on it, not escorting the Dog.
				const FVector ToContract = Contract->GetActorLocation() - Location;
				if (ToContract.SizeSquared2D() > 1.0)
				{
					DesiredYaw = ToContract.Rotation().Yaw;
				}
			}
			else if (FaceCameraAfterIdleSeconds >= 0.0f && IdleSeconds >= FaceCameraAfterIdleSeconds && Controller->PlayerCameraManager != nullptr)
			{
				const FVector ToCamera = Controller->PlayerCameraManager->GetCameraLocation() - Location;
				if (ToCamera.SizeSquared2D() > 1.0)
				{
					DesiredYaw = ToCamera.Rotation().Yaw;
				}
			}
			Facing = FMath::RInterpTo(FRotator(0.0, Facing.Yaw, 0.0), FRotator(0.0, DesiredYaw, 0.0), DeltaSeconds, 3.0f);
		}
		SetActorLocationAndRotation(Location, Facing, false, nullptr, ETeleportType::TeleportPhysics);
	}

	// ---- WHAT A BODY NOBODY IS LOOKING AT COSTS: NOTHING.
	//
	// FOUNDER: "a private Server Avatar may eventually contain MANY Project Avatars... DO NOT solve this by
	// simply reducing the number of Project Avatars. The system itself must become cheaper."
	//
	// Measured, one Project Avatar is 31,899 instanced boxes, and ten of them took the RENDER thread from 86.6
	// to 405.2 ms while the GPU barely moved, 53.5 to 78.9. The hardware can draw this comfortably; what it
	// cannot do is re-submit a third of a million movable instances every frame. Every joint this animator
	// moves dirties the instanced components hanging off it, and it does so whether or not the body is on
	// screen -- which is where nearly all of that cost was going, because most of a crowd is behind you.
	//
	// So an unseen body holds its pose, and a distant one animates on a coarser clock. Nothing is removed from
	// the world, nothing is culled from view, and a body that comes back into frame simply carries on.
	const float Now = static_cast<float>(World->GetTimeSeconds());
	const bool bSeen = WasRecentlyRendered(0.4f);
	// A SPAWNED PROJECT AVATAR FOLLOWS NOBODY, so its distance is measured from whoever is looking instead.
	if (!FollowController.IsValid())
	{
		if (const APlayerController* Viewer = UGameplayStatics::GetPlayerController(this, 0))
		{
			if (const APawn* Eye = Viewer->GetPawn())
			{
				ChooseFigureTier(static_cast<float>(FVector::Dist(GetActorLocation(), Eye->GetActorLocation())), Now);
			}
		}
	}
	float Every = 0.0f;
	if (!bSeen)
	{
		// Out of sight. Kept alive on a slow heartbeat so a body that reappears is never frozen mid-stride.
		Every = 0.5f;
	}
	else if (const APawn* Watcher = FollowController.IsValid() ? FollowController->GetPawn() : nullptr)
	{
		const float Away = static_cast<float>(FVector::Dist(GetActorLocation(), Watcher->GetActorLocation()));
		ChooseFigureTier(Away, Now);
		// Close enough to read a joint: every frame. Further out, a body's limbs subtend less than a pixel of
		// movement per frame and nobody can tell the difference.
		if (Away > 4500.0f) { Every = 0.20f; }
		else if (Away > 2200.0f) { Every = 0.08f; }
	}
	// A WORN COSTUME IS THE PLAYER'S OWN BODY and animates every frame: a skin that skipped frames whenever the
	// renderer briefly lost sight of it would stutter against the canon Dog it is standing in for.
	if (WornPose.bValid)
	{
		Every = 0.0f;
	}
	if (Every > 0.0f && (Now - LastAnimateSeconds) < Every)
	{
		return;
	}

	Animate(Now);
	AnimatePulses(Now);
}

/**
 * HOW EACH ACTIVITY LOOKS, and why. Bounded, and all of it a shaping of the motion the body already has: the rate it
 * moves at, how far it moves, and how high it floats. Nothing here is decorative -- each one is what that runtime state
 * honestly looks like from outside.
 */
namespace WonderlandCompanionActivity
{
	struct FLook
	{
		float Rate = 1.0f;
		float Amplitude = 1.0f;
		float HeightUU = 0.0f;
	};

	FLook For(FName Activity)
	{
		// LISTENING is attentive stillness; THINKING is quick and small; WORKING is quicker and steadier; RESPONDING
		// rises and moves; WAITING FOR AUTH is dormant; ERROR sinks; DISCONNECTED is nearly still, because nothing is
		// there to move it.
		if (Activity == TEXT("LISTENING")) return { 0.70f, 0.80f, 3.0f };
		if (Activity == TEXT("THINKING")) return { 1.90f, 0.55f, 5.0f };
		if (Activity == TEXT("WORKING")) return { 2.30f, 0.45f, 2.0f };
		if (Activity == TEXT("RESPONDING")) return { 1.35f, 1.25f, 4.0f };
		if (Activity == TEXT("WAITING_FOR_AUTH")) return { 0.35f, 0.50f, -4.0f };
		if (Activity == TEXT("ERROR")) return { 0.45f, 0.35f, -7.0f };
		if (Activity == TEXT("DISCONNECTED")) return { 0.15f, 0.15f, -9.0f };
		return { 1.0f, 1.0f, 0.0f }; // IDLE, and anything this build does not know: the body's own resting motion.
	}
}

void AWonderlandCompanionEmbodiment::DriveGaitFromCanonical(float InStridePhase, float InGaitWeight, float InSpeedUU)
{
	// TAKEN WHOLE, NOT BLENDED TOWARD. Easing the costume toward the Dog's numbers would just be a third gait with
	// a lag of its own -- and a lag is precisely what "the skins do not move like the Dog" looks like. The
	// canonical values ARE this body's values for the frame.
	bGaitDrivenExternally = true;
	GaitPhase = InStridePhase;
	GaitWeight = InGaitWeight;
	GroundSpeedUU = InSpeedUU;
}

void AWonderlandCompanionEmbodiment::WearCanonicalPose(const FWonderlandWornPose& InPose)
{
	// TAKEN WHOLE, for the same reason the gait is: easing toward the Dog's numbers would be a third animation
	// with a lag of its own, and a lag is exactly what "the skins do not move like the Dog" looks like.
	WornPose = InPose;
	WornPose.bValid = true;
	bGaitDrivenExternally = true;
	GaitPhase = InPose.StridePhase;
	GaitWeight = InPose.GaitWeight;
	GroundSpeedUU = InPose.SpeedUU;
}

void AWonderlandCompanionEmbodiment::ChooseFigureTier(float DistanceUU, float NowSeconds)
{
	// Only for figures that HAVE tiers. A companion or a mascot skin is one file and is left alone.
	if (FigureTierRoot.IsEmpty() || FigureTier == INDEX_NONE) { return; }
	// Checked a few times a second at most: this is a distance band, not a per-frame decision.
	if (NowSeconds < NextTierCheckSeconds) { return; }
	NextTierCheckSeconds = NowSeconds + 0.5f;

	// HYSTERESIS, so a body hovering on a boundary does not reload itself every half second. Coming closer has
	// to beat the threshold it left by a clear margin before the finer tier is loaded again.
	const float Near = 2600.0f;
	const float Far = 6200.0f;
	const float Slack = 700.0f;
	int32 Want = FigureTier;
	if (DistanceUU > Far + Slack) { Want = 0; }
	else if (DistanceUU > Near + Slack && FigureTier == 2) { Want = 1; }
	else if (DistanceUU < Far - Slack && FigureTier == 0) { Want = 1; }
	else if (DistanceUU < Near - Slack) { Want = 2; }

	// ---- A CROWD BUDGET, AND IT IS NOT A GUESS.
	//
	// FOUNDER: "Project Avatar lag... must scale inside one Server Avatar." zc_avatar_cost measured exactly
	// where the lag is and exactly what moves it. Ten Project Avatars standing at 900 uu and FACING the camera
	// cost 183.63 ms a frame, with 314,020 instances between them and the render thread at 166.62 ms while the
	// GPU sat at 42.18. The SAME ten, seen from far enough away to drop to the coarse tier, cost 46.61 ms with
	// 67,910 instances. Same figures, same materials, same shaders: the instance count is the whole cost, and
	// the tier is the whole lever. (A Nanite cube was tried first and returned 9% -- the cost is not GPU-side
	// instance culling, so it is not a shading problem to be shaded away.)
	//
	// So distance is no longer the only thing that decides. One avatar, or two, keep the finest tier they have
	// always had and nothing about the single-avatar case changes. A crowd shares a budget. That is what
	// scaling inside one Server Avatar means in practice: the cost of the tenth avatar is bounded, rather than
	// being the same as the cost of the first and simply arriving ten times.
	//
	// Counted rather than tracked. A live counter incremented and decremented across spawn, load, tier reload
	// and destruction is four places to get a leak wrong; this runs at most twice a second per figure, over a
	// handful of actors, and cannot drift.
	int32 Crowd = 0;
	for (TActorIterator<AWonderlandCompanionEmbodiment> Other(GetWorld()); Other; ++Other)
	{
		if (!Other->FigureTierRoot.IsEmpty()) { ++Crowd; }
	}
	const int32 Ceiling = Crowd <= 2 ? 2 : (Crowd <= 5 ? 1 : 0);
	Want = FMath::Min(Want, Ceiling);
	CrowdSeen = Crowd;
	CrowdTierCeiling = Ceiling;

	if (Want == FigureTier) { return; }

	const FString Wanted = FigureTierRoot + WonderlandFigureTiers[Want] + TEXT(".wlvox");
	if (!FPaths::FileExists(Wanted)) { return; }
	const int32 Was = FigureTier;
	if (LoadFigure(Wanted))
	{
		FigureTier = Want;
		UE_LOG(LogTemp, Display, TEXT("WLFIGURE %s tier %d -> %d at %.0f uu (crowd %d, ceiling %d)"),
			*GetName(), Was, Want, DistanceUU, Crowd, Ceiling);
	}
}

namespace
{
	/**
	 * `wl.Look.Reglow` -- rebuild every figure in the world against the current glow knee.
	 *
	 * The knee is the one number in this change that cannot be reasoned to: where a glow stops reading as
	 * bright armour and starts reading as a white blob depends on the tonemapper, the sun and the exposure
	 * together. Guessing it and rebuilding to check would cost a full build per candidate value.
	 *
	 * With this, a proof can set `wl.Look.GlowKnee`, call `wl.Look.Reglow`, photograph and measure, and walk
	 * the value to the answer inside ONE play session.
	 */
	FAutoConsoleCommandWithWorldAndArgs GReglow(
		TEXT("wl.Look.Reglow"),
		TEXT("Re-apply every figure's materials at the current wl.Look.GlowKnee."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			if (World == nullptr) { return; }
			int32 Rebuilt = 0;
			for (TActorIterator<AWonderlandCompanionEmbodiment> It(World); It; ++It)
			{
				if (It->ReloadFigure()) { ++Rebuilt; }
			}
			UE_LOG(LogTemp, Display, TEXT("WLLOOK reglowed %d figures at knee %.0f"),
				Rebuilt, CVarGlowKnee.GetValueOnGameThread());
		}));
}

void AWonderlandCompanionEmbodiment::RebuildFlames(float TimeSeconds)
{
	if (FlameSurface == nullptr || FlameSources.Num() == 0) { return; }

	// ONE SECTION PER EMBER MATERIAL, not one per pass.
	//
	// The first build painted every section from FlameSources[0], so a figure whose fires burn in more than one
	// colour -- or whose first flame part happens to list an unexpected material -- came out in the wrong one.
	// Keyed by the material each tongue actually belongs to, a skin's own ghostfire blue and another's ember
	// orange both come out right without either being named here.
	struct FPile
	{
		TArray<FVector> Verts;
		TArray<int32> Tris;
		TArray<FVector2D> UVs;
		TArray<FVector> Normals;
	};
	TMap<int32, FPile> Piles;

	const int32 Tongues = FMath::Clamp(CVarFireTongues.GetValueOnAnyThread(), 1, 16);
	const int32 Rungs = 7;
	const float Reach = FMath::Clamp(CVarFireReach.GetValueOnAnyThread(), 0.3f, 2.5f);
	for (const FFlameSource& Source : FlameSources)
	{
		if (!PartPivots.IsValidIndex(Source.PartIndex) || PartPivots[Source.PartIndex] == nullptr) { continue; }
		// In the actor's own space, so the ribbons ride the joint they burn on wherever the animation puts it.
		const FTransform Local = PartPivots[Source.PartIndex]->GetComponentTransform().GetRelativeTransform(GetActorTransform());

		for (int32 Pass = 0; Pass < 2; ++Pass)
		{
			const int32 Material = (Pass == 0) ? Source.OuterMaterial : Source.InnerMaterial;
			if (!MaterialInstances.IsValidIndex(Material)) { continue; }
			FPile& Pile = Piles.FindOrAdd(Material);
			// THE OUTER SHEET AND THE INNER CORE, both scaled by the figure-wide reach so "more fire" is one
			// knob rather than two places to forget.
			const float Lift = ((Pass == 0) ? 1.0f : 0.62f) * Reach;
			const float Fat = ((Pass == 0) ? 1.0f : 0.52f) * Reach;

			for (int32 T = 0; T < Tongues; ++T)
			{
				const float Turn = 2.0f * PI * (static_cast<float>(T) / Tongues) + Source.Seed;
				const float Seed = Source.Seed + T * 1.77f + Pass * 0.41f;
				// THE SAME THREE-OCTAVE FLICKER the tongues already move on, so shape and motion agree.
				const float Flick =
					  0.55f * FMath::Sin(2.0f * PI * (TimeSeconds / 0.37f + Seed))
					+ 0.30f * FMath::Sin(2.0f * PI * (TimeSeconds / 0.19f + Seed * 2.3f))
					+ 0.15f * FMath::Sin(2.0f * PI * (TimeSeconds / 0.83f + Seed * 0.7f));
				const float Lick = FMath::Clamp(0.5f + 0.5f * Flick, 0.0f, 1.0f);
				const float Tall = Source.Height * Lift * (0.58f + 0.62f * Lick);
				const FVector Foot = Source.Base + FVector(FMath::Cos(Turn), FMath::Sin(Turn), 0.0f) * (Source.Width * 0.22f);

				// CROSSED, SO IT HAS VOLUME. A single ribbon is a card: turn ninety degrees to it and the flame
				// thins to a line and disappears. Two sheets through the same spine read as a tongue from every
				// angle, for one more quad strip.
				for (int32 Blade = 0; Blade < 2; ++Blade)
				{
					const float Face = Turn + PI * 0.5f + (Blade == 1 ? PI * 0.5f : 0.0f);
					const int32 First = Pile.Verts.Num();
					for (int32 Rung = 0; Rung <= Rungs; ++Rung)
					{
						const float Up = static_cast<float>(Rung) / Rungs;
						// A tongue does not rise straight: it leans and curls, more the higher it gets.
						const float Sway = FMath::Sin(2.0f * PI * (TimeSeconds / 0.44f + Seed) + Up * 3.1f) * Source.Width * 0.30f * Up;
						const float Drift = FMath::Cos(2.0f * PI * (TimeSeconds / 0.61f + Seed * 1.3f) + Up * 2.4f) * Source.Width * 0.24f * Up;
						const FVector Spine = Foot + FVector(Sway, Drift, Tall * Up);
						// TAPERING TO NOTHING. Fire has no edge at the top; a ribbon ending square reads as card.
						const float Wide = Source.Width * 0.30f * Fat * FMath::Pow(1.0f - Up, 0.75f);
						const FVector Side(FMath::Cos(Face) * Wide, FMath::Sin(Face) * Wide, 0.0f);
						Pile.Verts.Add(Local.TransformPosition(Spine - Side));
						Pile.Verts.Add(Local.TransformPosition(Spine + Side));
						Pile.UVs.Add(FVector2D(0.0f, Up));
						Pile.UVs.Add(FVector2D(1.0f, Up));
						const FVector Out = Local.TransformVectorNoScale(
							FVector(FMath::Cos(Face + PI * 0.5f), FMath::Sin(Face + PI * 0.5f), 0.25f)).GetSafeNormal();
						Pile.Normals.Add(Out);
						Pile.Normals.Add(Out);
					}
					for (int32 Rung = 0; Rung < Rungs; ++Rung)
					{
						const int32 A = First + Rung * 2;
						Pile.Tris.Add(A); Pile.Tris.Add(A + 1); Pile.Tris.Add(A + 2);
						Pile.Tris.Add(A + 1); Pile.Tris.Add(A + 3); Pile.Tris.Add(A + 2);
						// Drawn from both sides: a flame seen from behind must not vanish.
						Pile.Tris.Add(A + 2); Pile.Tris.Add(A + 1); Pile.Tris.Add(A);
						Pile.Tris.Add(A + 2); Pile.Tris.Add(A + 3); Pile.Tris.Add(A + 1);
					}
				}
			}
		}
	}

	// The section index for a material is fixed the first time it is seen, so sections are only ever UPDATED
	// after that -- the topology of a flame never changes, only where its vertices are.
	int32 Slot = 0;
	for (TPair<int32, FPile>& Pair : Piles)
	{
		FPile& Pile = Pair.Value;
		if (Pile.Verts.Num() == 0) { ++Slot; continue; }
		if (FlameSurface->GetNumSections() <= Slot)
		{
			FlameSurface->CreateMeshSection(Slot, Pile.Verts, Pile.Tris, Pile.Normals, Pile.UVs,
											TArray<FColor>(), TArray<FProcMeshTangent>(), false);
			// PAINTED AFTER THE SECTION EXISTS. ProceduralMeshComponent keeps materials per section, so setting
			// one before the section is made is silently dropped -- the mistake that made the brain's python
			// draw white.
			// THE UNTAMED TWIN, so the fire is exactly the fire the founder approved while the body it grows
			// out of is brought down around it.
			if (FlameMaterialInstances.IsValidIndex(Pair.Key) && FlameMaterialInstances[Pair.Key] != nullptr)
			{
				FlameSurface->SetMaterial(Slot, FlameMaterialInstances[Pair.Key]);
			}
		}
		else
		{
			FlameSurface->UpdateMeshSection(Slot, Pile.Verts, Pile.Normals, Pile.UVs,
											TArray<FColor>(), TArray<FProcMeshTangent>());
		}
		++Slot;
	}
}

// Named, not anonymous: the module builds as one unity translation unit.
namespace WonderlandShadowMath
{
	/** A stable 0..1 number from a seed: every tendril's constants come from its own seed, so no two agree. */
	inline float Hash01(float X)
	{
		return FMath::Frac(FMath::Sin(X * 12.9898f) * 43758.5453f);
	}
}

void AWonderlandCompanionEmbodiment::RebuildShadows(float TimeSeconds)
{
	UProceduralMeshComponent* Surface = ShadowSurface.Get();
	if (Surface == nullptr || ShadowTendrils.Num() == 0)
	{
		return;
	}
	using WonderlandShadowMath::Hash01;

	// ---- WHERE THE FIGURE HAS BEEN. A tendril point some way along the strip is laid where the Dog stood that long ago,
	// so a moving Dog streams its shadows behind it and a Dog that stops sees them curl back in as the path catches up.
	const FVector Here = GetActorLocation();
	if (ShadowPath.Num() == 0 || TimeSeconds - ShadowPath.Last().W > 1.0f / 90.0f)
	{
		ShadowPath.Add(FVector4(Here.X, Here.Y, Here.Z, TimeSeconds));
	}
	while (ShadowPath.Num() > 2 && TimeSeconds - ShadowPath[0].W > 1.6f)
	{
		ShadowPath.RemoveAt(0, 1, EAllowShrinking::No);
	}
	const auto PathAt = [this, &Here](float T) -> FVector
	{
		if (ShadowPath.Num() == 0 || T >= ShadowPath.Last().W)
		{
			return Here;
		}
		for (int32 I = ShadowPath.Num() - 1; I > 0; --I)
		{
			const FVector4& A = ShadowPath[I - 1];
			const FVector4& B = ShadowPath[I];
			if (T >= A.W)
			{
				const float Alpha = (B.W - A.W) > KINDA_SMALL_NUMBER ? (T - A.W) / (B.W - A.W) : 1.0f;
				return FMath::Lerp(FVector(A), FVector(B), Alpha);
			}
		}
		return FVector(ShadowPath[0]);
	};

	// ---- HOW MUCH TO DRAW. A showcase (the wardrobe, a profile) always gets everything; in the world, detail falls with
	// the camera's distance, and far away only the rising tendrils stay -- the dark aura's silhouette, not its detail.
	int32 Detail = 0;
	if (!bShowcaseLit)
	{
		if (const APlayerCameraManager* Camera = UGameplayStatics::GetPlayerCameraManager(this, 0))
		{
			const float Away = static_cast<float>(FVector::Dist(Camera->GetCameraLocation(), Here));
			Detail = Away > 5200.0f ? 2 : Away > 2400.0f ? 1 : 0;
		}
	}
	const int32 Rungs = Detail == 0 ? 18 : Detail == 1 ? 10 : 6;

	struct FPile
	{
		TArray<FVector> Verts;
		TArray<int32> Tris;
		TArray<FVector2D> UVs;
		TArray<FVector> Normals;
	};
	TMap<int32, FPile> Piles;
	TArray<FVector> Tips;
	TArray<float> Weights;
	const FTransform Actor = GetActorTransform();
	TArray<FVector> Spine;
	Spine.SetNumUninitialized(Rungs + 1);

	for (const FShadowTendril& T : ShadowTendrils)
	{
		if (!ShadowSources.IsValidIndex(T.Source))
		{
			continue;
		}
		const FShadowSource& Source = ShadowSources[T.Source];
		if (Detail == 2 && T.Style != 0)
		{
			continue;
		}
		if (!PartPivots.IsValidIndex(Source.PartIndex) || PartPivots[Source.PartIndex] == nullptr
			|| !MaterialInstances.IsValidIndex(Source.Material))
		{
			continue;
		}
		// BORN ON ITS JOINT, wherever the animation has put that joint this frame -- as the flames are.
		const FTransform PartToActor = PartPivots[Source.PartIndex]->GetComponentTransform().GetRelativeTransform(Actor);
		const FVector Anchor = PartToActor.TransformPosition(T.Anchor);
		const float AnchorRadius = FMath::Max(static_cast<float>(FVector2D(Anchor.X, Anchor.Y).Size()), 4.0f);
		const float AnchorTurn = FMath::Atan2(static_cast<float>(Anchor.Y), static_cast<float>(Anchor.X));

		// ---- ITS OWN CONSTANTS: direction, speed and how that speed swells and ebbs, lifetime, curl, phase.
		const float S = T.Seed;
		const float Dir = Hash01(S + 1.1f) < 0.5f ? -1.0f : 1.0f;
		const float Omega = FMath::Lerp(0.30f, 0.85f, Hash01(S + 2.3f)) * Dir;
		const float SwellAmp = FMath::Lerp(0.25f, 0.55f, Hash01(S + 3.7f));
		const float SwellPeriod = FMath::Lerp(4.5f, 9.0f, Hash01(S + 4.1f));
		const float Life = FMath::Lerp(6.5f, 11.0f, Hash01(S + 5.3f));
		const float LifeOffset = Hash01(S + 6.7f) * Life;
		const float CurlFreq = FMath::Lerp(0.9f, 2.2f, Hash01(S + 7.9f));
		const float CurlPeriod = FMath::Lerp(1.6f, 3.4f, Hash01(S + 8.2f));
		const float StripPhase = Hash01(S + 9.4f) * 2.0f * PI;
		const float Climb = FMath::Lerp(-0.25f, 0.45f, Hash01(S + 10.6f));

		// ---- ITS LIFETIME: it grows out, lives, then lets go at the root and dissolves upward. Its width is zero at both
		// ends of the cycle, so the next lifetime -- a slightly different strip -- arrives without a pop.
		const float Cycle = (TimeSeconds + LifeOffset) / Life;
		const float CycleIndex = FMath::FloorToFloat(Cycle);
		const float U = Cycle - CycleIndex;
		const float Variant = Hash01(S + CycleIndex * 3.17f);
		const float Grow = FMath::SmoothStep(0.0f, 0.22f, U);
		const float Fade = FMath::SmoothStep(0.78f, 1.0f, U);
		const float Len = T.Reach * (0.35f + 0.65f * Grow) * FMath::Lerp(0.85f, 1.15f, Variant);
		const float RootCut = 0.85f * Fade;
		const float WidthEnvelope = Grow * (1.0f - Fade);

		// ---- ITS ORBIT, swelling and ebbing: the integral of Omega * (1 + SwellAmp * sin), so it speeds up and slows down
		// smoothly rather than spinning at one rate.
		const float Turn = AnchorTurn + Omega * TimeSeconds
			+ Omega * SwellAmp * SwellPeriod / (2.0f * PI) * (1.0f - FMath::Cos(2.0f * PI * TimeSeconds / SwellPeriod));

		for (int32 K = 0; K <= Rungs; ++K)
		{
			const float Along = RootCut + (1.0f - RootCut) * static_cast<float>(K) / Rungs;
			const float Curl = 0.11f * Len * FMath::Sin(2.0f * PI * (CurlFreq * Along - TimeSeconds / CurlPeriod) + StripPhase);
			float Radius = AnchorRadius;
			float Angle = AnchorTurn;
			float Height = static_cast<float>(Anchor.Z);
			if (T.Style == 0)
			{
				// RISING: up off the shoulders and back, drifting round a little, leaning well OUT as it climbs -- the first runtime
				// pass kept it inside the head's width, where the head hid it.
				Radius = AnchorRadius + 0.42f * Len * FMath::Pow(Along, 0.8f) + Curl * Along;
				Angle = AnchorTurn + 0.38f * FMath::Sin(2.0f * PI * (0.45f * Along - TimeSeconds / (SwellPeriod * 0.7f)) + StripPhase)
					+ Dir * FMath::Lerp(0.4f, 0.9f, Variant) * Along;
				Height += 0.92f * Len * Along + 0.06f * Len * FMath::Sin(2.0f * PI * (0.8f * Along - TimeSeconds / CurlPeriod) + StripPhase);
			}
			else if (T.Style == 1)
			{
				// ORBITING: round the torso BEYOND the arms (the first pass orbited at the arms' own radius: black on black), curling
				// as it goes, some spiralling up and some down.
				Radius = FMath::Max(AnchorRadius * 2.4f, 0.55f * Len) + Curl;
				Angle = Turn + Dir * FMath::Lerp(1.6f, 2.6f, Variant) * Along;
				Height += Climb * Len * Along + 0.10f * Len * FMath::Sin(2.0f * PI * (0.7f * Along - TimeSeconds / CurlPeriod) + StripPhase);
			}
			else
			{
				// SWEEPING: low past the legs, dipping, then lifting at the end -- the ones that trail furthest.
				Radius = FMath::Lerp(AnchorRadius, FMath::Max(AnchorRadius * 2.4f, 0.60f * Len), FMath::SmoothStep(0.0f, 0.45f, Along)) + Curl;
				Angle = AnchorTurn + 0.6f * (Turn - AnchorTurn) + Dir * 1.5f * Along;
				Height += -0.30f * Len * FMath::Sin(PI * FMath::Min(Along * 1.2f, 1.0f)) + 0.15f * Len * Along;
			}
			FVector Point(Radius * FMath::Cos(Angle), Radius * FMath::Sin(Angle), Height);
			// ATTACHED AT THE ROOT: the first stretch eases out of the anchor itself, so a strip never floats free of the Dog.
			Point = FMath::Lerp(Anchor, Point, FMath::SmoothStep(0.0f, 0.25f, Along));
			// THE TRAIL: further along the strip is where the Dog was further back. Capped, so a teleport or a fast run can
			// stretch a strip but never tear it loose.
			const float Lag = Along * (T.Style == 2 ? 0.55f : 0.38f);
			FVector Behind = PathAt(TimeSeconds - Lag) - Here;
			Behind = Behind.GetClampedToMaxSize(0.7f * Len);
			Point += Actor.InverseTransformVector(Behind) * FMath::SmoothStep(0.05f, 1.0f, Along);
			Spine[K] = Point;
		}
		Tips.Add(Spine[Rungs]);
		Weights.Add(WidthEnvelope);

		// ---- THE RIBBON: two crossed tapered blades through the spine, twisting slowly, widest mid-strip, with a swell of
		// width running along it so it reads as smoke rather than as a flat card.
		FPile& Pile = Piles.FindOrAdd(Source.Material);
		// WIDE ENOUGH TO READ AS A STRIP: the first runtime pass (half-width 2.5-7 uu) drew threads the eye lost against the body.
		const float BaseHalfWidth = FMath::Clamp(0.075f * T.Reach, 4.0f, 12.0f);
		for (int32 Blade = 0; Blade < 2; ++Blade)
		{
			const int32 First = Pile.Verts.Num();
			for (int32 K = 0; K <= Rungs; ++K)
			{
				const float Along = RootCut + (1.0f - RootCut) * static_cast<float>(K) / Rungs;
				const FVector Ahead = Spine[FMath::Min(K + 1, Rungs)] - Spine[FMath::Max(K - 1, 0)];
				const FVector Tangent = Ahead.GetSafeNormal(KINDA_SMALL_NUMBER, FVector::UpVector);
				FVector Across = FVector::CrossProduct(Tangent, FVector::UpVector);
				if (Across.SizeSquared() < 1e-4f)
				{
					Across = FVector::CrossProduct(Tangent, FVector::ForwardVector);
				}
				Across.Normalize();
				const FVector Over = FVector::CrossProduct(Tangent, Across).GetSafeNormal();
				const float Twist = StripPhase + 2.2f * Along + 0.8f * Dir * TimeSeconds + (Blade == 1 ? 0.5f * PI : 0.0f);
				const FVector Side = Across * FMath::Cos(Twist) + Over * FMath::Sin(Twist);
				// NEVER A NEGATIVE BASE. Sin(PI) in float is -8.7e-8, and Pow of a negative number is NaN: one NaN at every tip
				// gave the whole surface NaN bounds, and the renderer culled every strip (the first runtime passes: 988
				// vertices, "visible", nothing on screen; the log's "NaNs found on Bounds for Primitive ShadowSurface").
				const float Profile = FMath::Pow(FMath::Max(0.0f, FMath::Sin(PI * FMath::Clamp((Along - RootCut) / FMath::Max(1.0f - RootCut, 1e-3f), 0.0f, 1.0f))), 0.6f);
				const float Swell = 0.75f + 0.25f * FMath::Sin(2.0f * PI * (1.7f * Along - TimeSeconds / 1.3f) + StripPhase);
				const float Half = BaseHalfWidth * WidthEnvelope * Profile * Swell;
				Pile.Verts.Add(Spine[K] - Side * Half);
				Pile.Verts.Add(Spine[K] + Side * Half);
				Pile.UVs.Add(FVector2D(0.0f, Along));
				Pile.UVs.Add(FVector2D(1.0f, Along));
				const FVector Normal = FVector::CrossProduct(Tangent, Side).GetSafeNormal(KINDA_SMALL_NUMBER, Over);
				Pile.Normals.Add(Normal);
				Pile.Normals.Add(Normal);
			}
			for (int32 K = 0; K < Rungs; ++K)
			{
				const int32 A = First + K * 2;
				Pile.Tris.Add(A); Pile.Tris.Add(A + 1); Pile.Tris.Add(A + 2);
				Pile.Tris.Add(A + 1); Pile.Tris.Add(A + 3); Pile.Tris.Add(A + 2);
				// both faces: a strip seen from behind must not vanish
				Pile.Tris.Add(A + 2); Pile.Tris.Add(A + 1); Pile.Tris.Add(A);
				Pile.Tris.Add(A + 2); Pile.Tris.Add(A + 3); Pile.Tris.Add(A + 1);
			}
		}
	}

	// ---- INTO THE MESH. The topology only changes with the detail level, so most frames only move vertices.
	const bool bRebuild = Detail != ShadowDetail || Surface->GetNumSections() != Piles.Num();
	if (bRebuild)
	{
		Surface->ClearAllMeshSections();
	}
	int32 Slot = 0;
	int32 Vertices = 0;
	for (TPair<int32, FPile>& Pair : Piles)
	{
		FPile& Pile = Pair.Value;
		Vertices += Pile.Verts.Num();
		if (bRebuild)
		{
			Surface->CreateMeshSection(Slot, Pile.Verts, Pile.Tris, Pile.Normals, Pile.UVs, TArray<FColor>(), TArray<FProcMeshTangent>(), false);
			// painted after the section exists (a material set before it is silently dropped -- see RebuildFlames)
			Surface->SetMaterial(Slot, MaterialInstances[Pair.Key]);
		}
		else
		{
			Surface->UpdateMeshSection(Slot, Pile.Verts, Pile.Normals, Pile.UVs, TArray<FColor>(), TArray<FProcMeshTangent>());
		}
		++Slot;
	}
	ShadowDetail = Detail;
	ShadowVertexCount = Vertices;
	ShadowTips = MoveTemp(Tips);
	ShadowTipWeights = MoveTemp(Weights);
}

FString AWonderlandCompanionEmbodiment::DescribeShadows() const
{
	if (ShadowTendrils.Num() == 0)
	{
		return FString();
	}
	int32 Styles[3] = {0, 0, 0};
	for (const FShadowTendril& T : ShadowTendrils)
	{
		++Styles[FMath::Clamp(T.Style, 0, 2)];
	}
	const UProceduralMeshComponent* Surface = ShadowSurface.Get();
	FString Material = TEXT("none");
	if (ShadowSources.Num() > 0 && MaterialInstances.IsValidIndex(ShadowSources[0].Material) && MaterialInstances[ShadowSources[0].Material] != nullptr)
	{
		Material = MaterialInstances[ShadowSources[0].Material]->GetName();
	}
	// HOW FAR OUT AND UP THE STRIPS REACH, in actor space: the number that says whether they leave the silhouette at all.
	float Out = 0.0f;
	float Up = 0.0f;
	for (const FVector& Tip : ShadowTips)
	{
		Out = FMath::Max(Out, static_cast<float>(FVector2D(Tip.X, Tip.Y).Size()));
		Up = FMath::Max(Up, static_cast<float>(Tip.Z));
	}
	float Widest = 0.0f;
	for (const FShadowTendril& T : ShadowTendrils)
	{
		Widest = FMath::Max(Widest, FMath::Clamp(0.075f * T.Reach, 4.0f, 12.0f));
	}
	// WHERE THE SURFACE ACTUALLY IS (first runtime passes: 988 vertices, nothing on screen): its world place and bounds,
	// what it hangs from, and the actor's own place -- a surface drawn somewhere else reads as "visible" here and as
	// nothing on camera.
	FString Where = TEXT("no surface");
	if (Surface != nullptr)
	{
		const USceneComponent* Parent = Surface->GetAttachParent();
		Where = FString::Printf(TEXT("surface at %s (actor at %s), parent %s, registered %s, world bounds centre %s extent %s, section0 material %s"),
			*Surface->GetComponentLocation().ToCompactString(), *GetActorLocation().ToCompactString(),
			Parent != nullptr ? *Parent->GetName() : TEXT("NONE"), Surface->IsRegistered() ? TEXT("yes") : TEXT("NO"),
			*Surface->Bounds.Origin.ToCompactString(), *Surface->Bounds.BoxExtent.ToCompactString(),
			Surface->GetMaterial(0) != nullptr ? *Surface->GetMaterial(0)->GetName() : TEXT("NONE"));
	}
	return FString::Printf(TEXT("tendrils %d (rise %d, orbit %d, sweep %d) | detail %d | vertices %d | sections %d | visible %s | material %s | tips out to %.0f uu, up to %.0f uu, strips up to %.0f uu wide | %s"),
		ShadowTendrils.Num(), Styles[0], Styles[1], Styles[2], ShadowDetail, ShadowVertexCount,
		Surface != nullptr ? Surface->GetNumSections() : 0, (Surface != nullptr && Surface->IsVisible()) ? TEXT("yes") : TEXT("no"), *Material, Out, Up, Widest * 2.0f, *Where);
}

bool AWonderlandCompanionEmbodiment::HasLiveShadows() const
{
	// LIVE MEANS DRAWABLE: the renderer culls a primitive whose bounds are NaN or empty, so a surface with sections and
	// vertices but no finite bounds is not live (it passed every check once and drew nothing).
	const UProceduralMeshComponent* Surface = ShadowSurface.Get();
	return Surface != nullptr && Surface->GetNumSections() > 0 && Surface->IsVisible() && ShadowVertexCount > 0
		&& !Surface->Bounds.ContainsNaN() && Surface->Bounds.SphereRadius > 1.0;
}

void AWonderlandCompanionEmbodiment::SetRuntimeActivity(FName Activity)
{
	if (Activity.IsNone() || Activity == RuntimeActivity)
	{
		return;
	}
	RuntimeActivity = Activity;
	ActivityChangedAt = GetWorld() != nullptr ? GetWorld()->GetTimeSeconds() : 0.0f;
	// A BODY DOES NOT SNAP BETWEEN MOODS: the new look is eased into over the next moment.
	ActivityBlend = 0.0f;
}

FRotator AWonderlandCompanionEmbodiment::GetPartRotation(FName PartName) const
{
	const int32 Index = PartNames.IndexOfByKey(PartName);
	return PartPivots.IsValidIndex(Index) && PartPivots[Index] != nullptr
		? PartPivots[Index]->GetRelativeRotation()
		: FRotator::ZeroRotator;
}

TArray<FName> AWonderlandCompanionEmbodiment::GetPartNames() const
{
	return PartNames;
}

namespace
{
	/**
	 * WRITE A JOINT ONLY IF IT ACTUALLY MOVED.
	 *
	 * THE COST THIS EXISTS TO STOP. One Project Avatar is 31,899 instanced boxes hanging off its joints, and
	 * moving a joint dirties every instance under it for the renderer to re-submit. The idle motions here are
	 * fractions of a degree -- a breath, a weight shift, a tail drifting -- and they were being written EVERY
	 * FRAME regardless, so a crowd standing perfectly still cost exactly as much as a crowd running. Measured:
	 * ten avatars took the render thread from 86.6 ms to 405.2 while the GPU barely moved, 53.5 to 78.9. The
	 * hardware was never the problem; re-submitting a third of a million movable instances was.
	 *
	 * The thresholds are below what a joint can show on screen: a twentieth of a degree, and a twentieth of a
	 * uu. Nothing visible is dropped, and a pose that genuinely changes is written as it always was.
	 */
	void WriteJoint(USceneComponent* Pivot, const FVector& Where, const FRotator& Facing)
	{
		if (Pivot == nullptr) { return; }
		if (Pivot->GetRelativeLocation().Equals(Where, 0.05) && Pivot->GetRelativeRotation().Equals(Facing, 0.05f))
		{
			return;
		}
		Pivot->SetRelativeLocationAndRotation(Where, Facing);
	}

	void WriteJointRotation(USceneComponent* Pivot, const FRotator& Facing)
	{
		if (Pivot == nullptr) { return; }
		if (Pivot->GetRelativeRotation().Equals(Facing, 0.05f)) { return; }
		Pivot->SetRelativeRotation(Facing);
	}

	void WriteJointLocation(USceneComponent* Pivot, const FVector& Where)
	{
		if (Pivot == nullptr) { return; }
		if (Pivot->GetRelativeLocation().Equals(Where, 0.05)) { return; }
		Pivot->SetRelativeLocation(Where);
	}
}

bool AWonderlandCompanionEmbodiment::GetHandFrame(bool bPlusY, USceneComponent*& OutForearm, FVector& OutTipLocal) const
{
	// THE ELBOW ON THAT SIDE carries the hand: its tip is its measured length straight down its own axis at rest
	for (int32 Index = 0; Index < Motions.Num(); ++Index)
	{
		const FPartMotion& Part = Motions[Index];
		if (Part.LimbKind == 4 && Part.LimbSide == (bPlusY ? 1 : -1) && PartPivots.IsValidIndex(Index) && PartPivots[Index] != nullptr)
		{
			OutForearm = PartPivots[Index];
			OutTipLocal = FVector(0.0, 0.0, -Part.ShinUU);
			return true;
		}
	}
	return false;
}

bool AWonderlandCompanionEmbodiment::SolveLegToSole(int32 HipIndex, const FVector& SoleWorld, FRotator& OutHip, FRotator& OutKnee) const
{
	// A TWO-BONE SOLVE IN THE HIP'S OWN PARENT FRAME, where the hip rests at RestLocation and swings about Y.
	//
	// The same convention the canon writes its own legs in: a positive pitch swings a hanging limb forward, and the
	// shin folds BACK (heel up) at a negative pitch. The thigh leads the hip-to-sole line by the angle the triangle
	// needs, which puts the knee in front of that line -- a biped's knee -- and never hyperextends.
	if (!PartPivots.IsValidIndex(HipIndex) || !Motions.IsValidIndex(HipIndex))
	{
		return false;
	}
	const FPartMotion& Part = Motions[HipIndex];
	const USceneComponent* Hip = PartPivots[HipIndex];
	const USceneComponent* Knee = PartPivots.IsValidIndex(Part.LowerIndex) ? PartPivots[Part.LowerIndex].Get() : nullptr;
	const USceneComponent* Frame = Hip != nullptr ? Hip->GetAttachParent() : nullptr;
	if (Hip == nullptr || Knee == nullptr || Frame == nullptr || Part.ThighUU <= 1.0f || Part.ShinUU <= 1.0f)
	{
		return false;
	}
	const FVector Target = Frame->GetComponentTransform().InverseTransformPosition(SoleWorld);
	const FVector Reach = Target - Part.RestLocation;
	const float Forward = static_cast<float>(Reach.X);
	const float Down = static_cast<float>(-Reach.Z);
	const float Thigh = Part.ThighUU;
	const float Shin = Part.ShinUU;
	const float Span = FMath::Clamp(FMath::Sqrt(Forward * Forward + Down * Down),
		FMath::Abs(Thigh - Shin) + 0.01f, Thigh + Shin - 0.001f);
	const float Bend = PI - FMath::Acos(FMath::Clamp((Thigh * Thigh + Shin * Shin - Span * Span) / (2.0f * Thigh * Shin), -1.0f, 1.0f));
	const float Lead = FMath::Acos(FMath::Clamp((Thigh * Thigh + Span * Span - Shin * Shin) / (2.0f * Thigh * Span), -1.0f, 1.0f));
	const float Toward = FMath::Atan2(Forward, Down);
	OutHip = FRotator(FMath::RadiansToDegrees(Toward + Lead), 0.0f, 0.0f);
	OutKnee = FRotator(-FMath::RadiansToDegrees(Bend), 0.0f, 0.0f);
	return true;
}

bool AWonderlandCompanionEmbodiment::SolveArmToHand(int32 ShoulderIndex, FQuat& OutShoulder, FQuat& OutElbow) const
{
	// A TWO-BONE SOLVE IN THREE DIMENSIONS, IN THE SHOULDER'S OWN PARENT FRAME.
	//
	// The hand goes where the canon's hand on the same side is. The elbow goes to the side of the shoulder-to-hand line
	// the canon's elbow is on -- measured off the CANON's own line, so a painting arm keeps its elbow down and out and
	// a hand on the book keeps its elbow tucked -- and each joint's rotation is the canon's own, turned by the least
	// that gets there, so the twist an act gives the arm (the wrist turned to the page, the glass's grip) is kept.
	// A target out of this arm's reach straightens it toward the target rather than tearing it off the shoulder.
	if (!PartPivots.IsValidIndex(ShoulderIndex) || !Motions.IsValidIndex(ShoulderIndex))
	{
		return false;
	}
	const FPartMotion& Part = Motions[ShoulderIndex];
	if (Part.LimbKind != 3 || Part.LimbSide == 0 || !Motions.IsValidIndex(Part.LowerIndex) || !PartPivots.IsValidIndex(Part.LowerIndex)
		|| Part.ThighUU <= 1.0f || Part.ShinUU <= 1.0f)
	{
		return false;
	}
	const USceneComponent* Shoulder = PartPivots[ShoulderIndex];
	const USceneComponent* Frame = Shoulder != nullptr ? Shoulder->GetAttachParent() : nullptr;
	if (Frame == nullptr)
	{
		return false;
	}
	const bool bPlus = Part.LimbSide > 0;
	const FVector HandW = bPlus ? WornPose.HandPlusY : WornPose.HandMinusY;
	const FVector CanonElbowW = bPlus ? WornPose.ElbowPlusY : WornPose.ElbowMinusY;
	const FVector CanonShoulderW = bPlus ? WornPose.ShoulderAtPlusY : WornPose.ShoulderAtMinusY;
	if (HandW.IsZero() || CanonShoulderW.IsZero() || CanonElbowW.IsZero())
	{
		return false;
	}

	const FTransform FrameXf = Frame->GetComponentTransform();
	const FVector S = Part.RestLocation;
	const FVector D = FrameXf.InverseTransformPosition(HandW) - S;
	const double Dist = D.Size();
	if (Dist < 0.5)
	{
		return false;
	}
	const FVector Dn = D / Dist;
	const double Upper = Part.ThighUU;
	const double Lower = Part.ShinUU;
	const double Span = FMath::Clamp(Dist, FMath::Abs(Upper - Lower) + 0.01, Upper + Lower - 0.001);

	const FQuat CopiedS = (bPlus ? WornPose.ShoulderPlusY : WornPose.ShoulderMinusY).Quaternion();
	const FQuat CopiedE = (bPlus ? WornPose.ForearmPlusY : WornPose.ForearmMinusY).Quaternion();
	const FVector UpperRest = Motions[Part.LowerIndex].RestLocation;
	const FVector UpperRestN = UpperRest.IsNearlyZero() ? FVector(0.0, 0.0, -1.0) : UpperRest.GetSafeNormal();

	// THE SIDE THE ELBOW BENDS TOWARD: the canon elbow's offset from the canon's own shoulder-to-hand line, brought into
	// this frame and laid square to THIS arm's reach.
	const FVector CanonReach = (HandW - CanonShoulderW).GetSafeNormal();
	FVector PoleW = CanonElbowW - CanonShoulderW;
	PoleW -= CanonReach * FVector::DotProduct(PoleW, CanonReach);
	FVector Pole = FrameXf.InverseTransformVectorNoScale(PoleW);
	Pole -= Dn * FVector::DotProduct(Pole, Dn);
	if (Pole.SizeSquared() < 1e-4)
	{
		// A straight canon arm names no side: keep the one this arm has on the canon's own rotation, else bend down.
		const FVector Copied = CopiedS.RotateVector(UpperRestN);
		Pole = Copied - Dn * FVector::DotProduct(Copied, Dn);
		if (Pole.SizeSquared() < 1e-4)
		{
			Pole = FVector(0.0, 0.0, -1.0) - Dn * Dn.Z;
			if (Pole.SizeSquared() < 1e-4)
			{
				Pole = FVector(1.0, 0.0, 0.0) - Dn * Dn.X;
			}
		}
	}
	Pole.Normalize();

	const double Lead = FMath::Acos(FMath::Clamp((Upper * Upper + Span * Span - Lower * Lower) / (2.0 * Upper * Span), -1.0, 1.0));
	const FVector ElbowAt = S + (Dn * FMath::Cos(Lead) + Pole * FMath::Sin(Lead)) * Upper;
	const FVector HandAt = S + Dn * Span;

	// The shoulder: the canon's rotation turned by the least that points this upper arm at the solved elbow.
	OutShoulder = FQuat::FindBetweenNormals(CopiedS.RotateVector(UpperRestN), (ElbowAt - S).GetSafeNormal()) * CopiedS;
	OutShoulder.Normalize();
	// The elbow, relative to the shoulder: the canon's forearm rotation turned by the least that reaches the hand.
	const FVector ForearmWant = OutShoulder.Inverse().RotateVector((HandAt - ElbowAt).GetSafeNormal());
	OutElbow = FQuat::FindBetweenNormals(CopiedE.RotateVector(FVector(0.0, 0.0, -1.0)), ForearmWant) * CopiedE;
	OutElbow.Normalize();
	return true;
}

FVector AWonderlandCompanionEmbodiment::GetHandWorld(float SideSign) const
{
	for (int32 Index = 0; Index < Motions.Num() && Index < PartPivots.Num(); ++Index)
	{
		const FPartMotion& Part = Motions[Index];
		if (Part.LimbKind != 3 || Part.LimbSide == 0 || (Part.LimbSide > 0) != (SideSign >= 0.0f))
		{
			continue;
		}
		const USceneComponent* Elbow = PartPivots.IsValidIndex(Part.LowerIndex) ? PartPivots[Part.LowerIndex].Get() : nullptr;
		if (Elbow != nullptr)
		{
			return Elbow->GetComponentTransform().TransformPosition(FVector(0.0, 0.0, -Part.ShinUU));
		}
	}
	return FVector::ZeroVector;
}

bool AWonderlandCompanionEmbodiment::GetArmReach(float SideSign, FVector& OutShoulderWorld, float& OutLengthUU) const
{
	for (int32 Index = 0; Index < Motions.Num() && Index < PartPivots.Num(); ++Index)
	{
		const FPartMotion& Part = Motions[Index];
		if (Part.LimbKind != 3 || Part.LimbSide == 0 || (Part.LimbSide > 0) != (SideSign >= 0.0f)
			|| Part.ThighUU <= 1.0f || Part.ShinUU <= 1.0f)
		{
			continue;
		}
		const USceneComponent* Shoulder = PartPivots[Index].Get();
		if (Shoulder == nullptr)
		{
			continue;
		}
		OutShoulderWorld = Shoulder->GetComponentLocation();
		OutLengthUU = Part.ThighUU + Part.ShinUU;
		return true;
	}
	return false;
}

FVector AWonderlandCompanionEmbodiment::GetSoleWorld(float SideSign) const
{
	for (int32 Index = 0; Index < Motions.Num() && Index < PartPivots.Num(); ++Index)
	{
		const FPartMotion& Part = Motions[Index];
		if (Part.LimbKind != 1 || Part.LimbSide == 0 || (Part.LimbSide > 0) != (SideSign >= 0.0f))
		{
			continue;
		}
		const USceneComponent* Knee = PartPivots.IsValidIndex(Part.LowerIndex) ? PartPivots[Part.LowerIndex].Get() : nullptr;
		if (Knee != nullptr)
		{
			return Knee->GetComponentTransform().TransformPosition(FVector(0.0, 0.0, -Part.ShinUU));
		}
	}
	return FVector::ZeroVector;
}

FString AWonderlandCompanionEmbodiment::DescribeLimbs() const
{
	static const TCHAR* const Kinds[] = {TEXT("-"), TEXT("hip"), TEXT("knee"), TEXT("shoulder"), TEXT("elbow")};
	FString Out;
	for (int32 Index = 0; Index < Motions.Num() && Index < PartNames.Num(); ++Index)
	{
		const FPartMotion& Part = Motions[Index];
		if (Part.LimbKind == 0 || Part.LimbKind > 4)
		{
			continue;
		}
		Out += FString::Printf(TEXT("%s=%s%s thigh %.1f shin %.1f; "), *PartNames[Index].ToString(), Kinds[Part.LimbKind],
			Part.LimbSide > 0 ? TEXT("+Y") : (Part.LimbSide < 0 ? TEXT("-Y") : TEXT("0")), Part.ThighUU, Part.ShinUU);
	}
	return Out;
}

void AWonderlandCompanionEmbodiment::Animate(float TimeSeconds)
{
	const float Scale = FMath::Max(FigureScale, 0.05f);

	// THE FIRE IS LAID DOWN FIRST, on the joints as they stood last frame -- a few hundred triangles for a
	// whole figure, and only for the skins that actually carry flame parts.
	RebuildFlames(TimeSeconds);
	// AND THE SHADOW, the same way and only for a skin that carries it (Shadow Flame).
	RebuildShadows(TimeSeconds);

	// WHAT THE RUNTIME SAYS THIS COMPANION IS DOING, eased in. The phase is advanced by the rate rather than the clock
	// being scaled, so a change of activity never makes the body jump: it simply moves at a different pace from here.
	{
		const WonderlandCompanionActivity::FLook Look = WonderlandCompanionActivity::For(RuntimeActivity);
		ActivityBlend = FMath::Min(1.0f, ActivityBlend + FMath::Max(TimeSeconds - LastAnimateSeconds, 0.0f) * 1.8f);
		const float Blend = FMath::SmoothStep(0.0f, 1.0f, ActivityBlend);
		ActivityRate = FMath::Lerp(ActivityRate, Look.Rate, Blend * 0.25f);
		ActivityAmplitude = FMath::Lerp(ActivityAmplitude, Look.Amplitude, Blend * 0.25f);
		ActivityHeightUU = FMath::Lerp(ActivityHeightUU, Look.HeightUU, Blend * 0.25f);
		ActivityPhase += FMath::Max(TimeSeconds - LastAnimateSeconds, 0.0f) * ActivityRate;
		LastAnimateSeconds = TimeSeconds;
	}
	const float ActivityTime = ActivityPhase;

	// ---------------------------------------------------------------- THE GAIT, MEASURED RATHER THAN TIMED
	//
	// A WALK CYCLE DRIVEN BY A TIMER IS THE DEFINITION OF STIFF: the legs march at a fixed rate whatever the body is
	// doing, so a creature standing still paddles on the spot and one crossing a plaza takes the same little steps.
	// This clock is advanced by DISTANCE instead, so one turn of the cycle is always one stride on the ground and the
	// feet keep up with the body by construction.
	// UNLESS A RELAY DOG IS HANDING DOWN ITS OWN, which is what a worn mascot skin does. The canonical stride has
	// already been solved by the Dog this frame, so the costume wears that number and does not measure a second
	// one. Everything below still reads GaitPhase and GaitWeight, so the entire body -- legs, lean, sway, bob,
	// every joint -- inherits the canonical cadence, easing and transitions without any of them knowing.
	if (bGaitDrivenExternally)
	{
		// The spot is still tracked so that releasing the drive does not read as one enormous instant stride.
		GaitMeasuredAt = TimeSeconds;
		LastGroundSpot = GetActorLocation();
		bHasGroundSpot = true;
	}
	else
	{
		const float Delta = FMath::Max(TimeSeconds - GaitMeasuredAt, 0.0f);
		GaitMeasuredAt = TimeSeconds;
		const FVector Here = GetActorLocation();
		if (bHasGroundSpot && Delta > KINDA_SMALL_NUMBER)
		{
			const float Travelled = static_cast<float>(FVector::Dist2D(Here, LastGroundSpot));
			// Smoothed: one stuttered editor frame must not read as a sprint, and one dropped frame must not stop it.
			GroundSpeedUU = FMath::FInterpTo(GroundSpeedUU, Travelled / Delta, Delta, 6.0f);
			GaitPhase += Travelled / FMath::Max(StrideLengthUU * Scale, 1.0f);
		}
		LastGroundSpot = Here;
		bHasGroundSpot = true;

		// HOW MUCH OF THE WALK IS SHOWING. Eased both ways, because a body that snaps from standing to walking on the
		// frame it starts moving is as mechanical as one that never moves at all.
		const float Want = FMath::Clamp(GroundSpeedUU / FMath::Max(WalkSpeedUU, 1.0f), 0.0f, 1.35f);
		GaitWeight = FMath::FInterpTo(GaitWeight, Want, FMath::Max(TimeSeconds - LastAnimateSeconds, 0.0f) + Delta, 3.2f);

		// STANDING IS NOT STILLNESS. With no stride to run, the cycle keeps turning slowly so the body shifts its
		// weight, breathes and settles: a creature frozen between steps reads as a statue that happens to hover.
		if (GaitWeight < 0.98f)
		{
			GaitPhase += Delta * 0.22f * (1.0f - GaitWeight);
		}
	}
	// A SECOND CLOCK AT AN UNRELATED PERIOD. Every joint below mixes a little of this in, so no cycle ever lands in
	// exactly the same place twice. It is a small thing and it is most of the difference between a body that is
	// animated and one that is running a loop.
	const float Drift = FMath::Sin(2.0f * PI * (ActivityTime / 7.37f + Phase * 3.1f));
	const float Gait = GaitPhase;
	const float Walk = FMath::Clamp(GaitWeight, 0.0f, 1.2f);

	// THE FLOAT: bounded, absolute from rest, and on this companion's own phase.
	//
	// AND NOT AT ALL WHEN THE BODY IS WORN. This is why the alternate skins drifted.
	//
	// FOUNDER, 2026-09-25: "The alternate mascot skins are still not truly standing still during idle. When
	// they are supposed to be standing, they slightly float/drift left and right... They should remain
	// planted exactly like Relay OG."
	//
	// FloatRoot is the PARENT of every root part in the figure, and it was writing a hover on Z plus a
	// rotation of 1.5 degrees of pitch and 2.0 degrees of ROLL, continuously, on the companion's own clock.
	// That is correct and wanted for a free-standing companion, which is a hovering creature. It is wrong
	// for a costume: two degrees of roll on a body this tall swings it several uu side to side, which is
	// precisely "floats and drifts left and right" -- and Relay OG cannot do it, because Relay OG is the
	// Dog's own geometry and has no FloatRoot at all.
	//
	// So when the pose is canonical the float is not damped or scaled, it is ABSENT: the component is put
	// back to identity and every bit of motion comes from the Dog. That is the canonical path fixed rather
	// than a per-frame snap over the top of it, and it leaves the free-standing companions exactly as they
	// were -- which the founder also asked for.
	if (FloatRoot != nullptr)
	{
		if (WornPose.bValid)
		{
			WriteJoint(FloatRoot, FVector::ZeroVector, FRotator::ZeroRotator);
		}
		else
		{
			const float Hover = 2.0f * PI * (ActivityTime / FMath::Max(HoverPeriodSeconds, 0.5f) + Phase);
			FloatRoot->SetRelativeLocationAndRotation(
				FVector(0.0, 0.0, FMath::Sin(Hover) * HoverAmplitudeUU * ActivityAmplitude + ActivityHeightUU),
				FRotator(FMath::Sin(Hover * 0.5f + 1.1f) * 1.5f, 0.0, FMath::Cos(Hover * 0.5f) * 2.0f));
		}
	}

	for (int32 Index = 0; Index < PartPivots.Num() && Index < Motions.Num(); ++Index)
	{
		USceneComponent* Pivot = PartPivots[Index];
		const FPartMotion& Part = Motions[Index];
		if (Pivot == nullptr)
		{
			continue;
		}
		switch (Part.Motion)
		{
		case EWonderlandCompanionMotion::Float:
		{
			const float Angle = 2.0f * PI * (ActivityTime / 3.1f + Phase + Part.A);
			const float Idle = FMath::Sin(Angle) * 2.0f * Scale;
			// THE PERFORMANCE LIFTS THE WHOLE BODY -- 72 uu to meditate, 150 to fly up and verify. A floating part
			// keeps its own small bob on top of that; what it must not do is ignore the lift entirely, which is
			// what a costume did through every preparation and verification the founder ever watched.
			// NOR TAKE IT TWICE: a floating part hung under the lifted spine already rises with it (bLiftedByAncestor).
			WriteJointLocation(Pivot, Part.RestLocation + FVector(0.0, 0.0,
				Idle + ((WornPose.bValid && !Part.bLiftedByAncestor) ? WornPose.LiftUU : 0.0f)));
			break;
		}
		case EWonderlandCompanionMotion::Head:
		{
			if (WornPose.bValid)
			{
				// THE DOG'S HEAD. Bowed to the pages while it reads, level against its own lean while it walks,
				// turned to the Contract where the performance turns it -- all of it decided by the one animator.
				// The canon head joint AS WRITTEN when the Dog hands it down, so a performance's bow reaches the skin.
				WriteJointRotation(Pivot, WornPose.bHasCanonJoints
					? WornPose.HeadRotation : FRotator(WornPose.HeadPitchDeg, WornPose.HeadYawDeg, 0.0f));
				break;
			}
			const float Angle = 2.0f * PI * (ActivityTime / 5.3f + Phase);
			WriteJointRotation(Pivot, FRotator(FMath::Sin(Angle * 1.3f) * 2.5f, FMath::Sin(Angle) * 4.0f, FMath::Cos(Angle * 0.7f) * 3.0f));
			break;
		}
		case EWonderlandCompanionMotion::Wing:
		{
			// AN ARM, WHEN A DOG IS DRIVING IT. The canon rig hangs the arms off this motion, so a driven body
			// swings them from the Dog's own solved shoulder rather than flapping them as decoration.
			if (WornPose.bValid && Part.LimbKind == 3)
			{
				// THE DOG'S OWN SHOULDER, from the arm hanging on the SAME SIDE of the body -- pitch and the outward
				// roll the arms-back run sweeps them by. Keyed by physical side: the canon's Left arm hangs at +Y.
				if (WornPose.bHasCanonJoints)
				{
					// AND THROUGH A MISSION CONTRACT ACT, THE DOG'S HANDS (founder correction, 2026-09-29).
					//
					// Every act is choreographed on the canon body: the book opened before ITS chest, the brush and
					// scraper hung from ITS forearm, the lens held on ITS eye line, both hands aimed from ITS shoulders
					// at the Contract. Copying the canon's arm ANGLES onto shoulders 24.5 uu lower held every skin's
					// hands a quarter of a metre under the props -- the book floating over empty paws, the brush
					// painting in the air above them. So as the act comes in, this arm is solved to put its hand where
					// the canon's hand is, bending its elbow the way the canon's bends, starting from the canon's own
					// rotations; the arm and its elbow are written together, here. Blended by the same share the canon
					// blends its own arms onto the act's goals with, so the hand never jumps.
					const bool bPlus = Part.LimbSide > 0;
					const FRotator CopiedShoulder = bPlus ? WornPose.ShoulderPlusY : WornPose.ShoulderMinusY;
					const FRotator CopiedForearm = bPlus ? WornPose.ForearmPlusY : WornPose.ForearmMinusY;
					USceneComponent* Elbow = PartPivots.IsValidIndex(Part.LowerIndex) ? PartPivots[Part.LowerIndex].Get() : nullptr;
					const float Acting = FMath::Clamp(WornPose.MissionWeight, 0.0f, 1.0f);
					FQuat SolvedShoulder = FQuat::Identity;
					FQuat SolvedElbow = FQuat::Identity;
					if (Acting > 0.001f && Elbow != nullptr && SolveArmToHand(Index, SolvedShoulder, SolvedElbow))
					{
						WriteJoint(Pivot, Part.RestLocation, FQuat::Slerp(CopiedShoulder.Quaternion(), SolvedShoulder, Acting).Rotator());
						WriteJointRotation(Elbow, FQuat::Slerp(CopiedForearm.Quaternion(), SolvedElbow, Acting).Rotator());
						break;
					}
					WriteJoint(Pivot, Part.RestLocation, CopiedShoulder);
					WriteJointRotation(Elbow, CopiedForearm);
					break;
				}
				const float Shoulder = Part.LimbSide > 0 ? WornPose.ShoulderLeftDeg : WornPose.ShoulderRightDeg;
				WriteJoint(Pivot, Part.RestLocation, FRotator(Shoulder, 0.0f, 0.0f));
				break;
			}
			// Swept back and forward about the root and lifted a little, mirrored by side.
			const float Side = Part.A < 0.0f ? -1.0f : 1.0f;
			const float Beat = 2.0f * PI * (ActivityTime / 2.4f + Phase);
			// TWO TERMS AT DIFFERENT PERIODS, and the second lags: a wing driven by one sine beats like a metronome,
			// and the founder's word for that is stiff. The downstroke is also faster than the recovery, which is how
			// a wing actually works and what makes the beat read as effort rather than as oscillation.
			const float Flap = FMath::Sin(Beat) * 0.78f + FMath::Sin(Beat * 0.41f + 1.2f) * 0.22f;
			const float Bite = FMath::Sin(Beat - 0.55f);
			WriteJointRotation(Pivot, FRotator(
				Bite * 4.0f + Drift * 1.4f,
				Side * Flap * 11.0f,
				Side * (Flap * 8.0f + Bite * 2.5f)));
			break;
		}
		case EWonderlandCompanionMotion::Tail:
		{
			// A wave travelling down the wisp: the further from the body, the later and the wider it swings.
			const float Along = FMath::Clamp(Part.A / FMath::Max(Part.B, 1.0f), 0.0f, 1.0f);
			const float Reach = FMath::Pow(Along, 1.35f);
			if (WornPose.bValid)
			{
				// THE DOG'S TAIL, spread along the chain so a segmented wisp still reads as one tail rather than
				// every segment snapping to the same angle.
				WriteJoint(Pivot, Part.RestLocation,
					FRotator(WornPose.TailPitchDeg * Reach, WornPose.TailYawDeg * Reach, 0.0f));
				break;
			}
			const float Wave = 2.0f * PI * (ActivityTime / 2.2f + Phase) - Part.A * 0.62f;
			// A SECOND, SLOWER SWING ACROSS THE FIRST, and a little pitch: one sine on one axis is a windscreen wiper.
			const float Cross = 2.0f * PI * (ActivityTime / 6.1f + Phase * 0.7f) - Part.A * 0.30f;
			WriteJoint(Pivot, 
				Part.RestLocation + FVector(
					FMath::Cos(Wave * 0.8f) * 3.0f,
					FMath::Sin(Wave) * 9.0f + FMath::Sin(Cross) * 3.4f,
					FMath::Sin(Cross * 1.3f) * 2.2f) * (Reach * Scale),
				FRotator(
					FMath::Sin(Cross) * 4.0f * Reach,
					FMath::Sin(Wave) * 8.0f * Reach,
					FMath::Sin(Wave * 0.5f + 0.4f) * 5.0f * Reach));
			break;
		}
		case EWonderlandCompanionMotion::Stride:
		{
			// A LEG. Through one cycle the hip swings forward, plants, and is driven back under the body; the foot
			// lifts only on the forward half, because a foot that lifts while bearing weight is a creature skating.
			const float Cycle = FMath::Frac(Gait + Part.A);
			const float Swing = FMath::Sin(2.0f * PI * Cycle);
			// The lift is the positive half only, eased, so the foot leaves and meets the ground softly.
			const float Raw = FMath::Max(Swing, 0.0f);
			const float Lift = Raw * Raw * (3.0f - 2.0f * Raw);
			const float Reach = FMath::Max(Part.B, 0.01f);
			// Standing, the legs do not hold a pose: they shift weight slowly from side to side. DRIVEN, that
			// shuffle is the Dog's stillness instead of this body's clock -- and while the Dog is off the ground
			// the legs stop striding at nothing, which is the jump channel a costume never had.
			const float Idle = FMath::Sin(2.0f * PI * (ActivityTime / 4.6f + Phase + Part.A)) * 2.2f;
			if (WornPose.bValid)
			{
				// THE DOG'S OWN LEG, ON THE SAME SIDE OF THE BODY (founder regression, 2026-09-29).
				//
				// Walking, standing and jumping, this leg is SOLVED so its sole lands exactly where the canon
				// animator put the canon sole on that side: the canon's stride pins a planted foot in the world,
				// and a costume leg of a different length (every skin's thigh and shin differ from the canon's
				// 17.25 / 30.75) given the canon's ANGLES would put its foot somewhere else and skate. As the legs
				// cross to meditate or trail to fly they leave the plane a two-bone solve works in, so the canon
				// joints are blended in by the same share the canon blends its own legs into those poses with.
				// The hip and its knee are written together, here.
				const bool bPlus = Part.LimbSide > 0;
				if (WornPose.bHasCanonJoints && Part.LimbSide != 0)
				{
					const FRotator CopiedHip = bPlus ? WornPose.HipPlusY : WornPose.HipMinusY;
					const FRotator CopiedShin = bPlus ? WornPose.ShinPlusY : WornPose.ShinMinusY;
					USceneComponent* Knee = PartPivots.IsValidIndex(Part.LowerIndex) ? PartPivots[Part.LowerIndex].Get() : nullptr;
					const float Performed = FMath::Clamp(WornPose.LegPerformWeight, 0.0f, 1.0f);
					FRotator SolvedHip = CopiedHip;
					FRotator SolvedKnee = CopiedShin;
					if (Performed < 0.999f && Knee != nullptr
						&& SolveLegToSole(Index, bPlus ? WornPose.SolePlusY : WornPose.SoleMinusY, SolvedHip, SolvedKnee))
					{
						// THE CANON HIP'S OUTWARD SWEEP COMES WITH IT (the Mission Handoff's spaced feet, M2): the two-bone solve
						// works in the leg's sagittal plane and would drop it. Walking and standing it is 0 on the canon -- its
						// hips are written with no sweep -- so this is the solve exactly as before; only while no performed
						// pose blends in, so an act's own crossfade is untouched.
						if (Performed <= 0.001f)
						{
							SolvedHip.Roll = CopiedHip.Roll;
						}
						WriteJoint(Pivot, Part.RestLocation, Performed <= 0.001f ? SolvedHip
							: FQuat::Slerp(SolvedHip.Quaternion(), CopiedHip.Quaternion(), Performed).Rotator());
						WriteJointRotation(Knee, Performed <= 0.001f ? SolvedKnee
							: FQuat::Slerp(SolvedKnee.Quaternion(), CopiedShin.Quaternion(), Performed).Rotator());
						break;
					}
					WriteJoint(Pivot, Part.RestLocation, CopiedHip);
					WriteJointRotation(Knee, CopiedShin);
					break;
				}
				// A pose with no canon joints (an older caller): the Left/Right angles, Left being the +Y leg.
				const float Hip = bPlus ? WornPose.HipLeftDeg : WornPose.HipRightDeg;
				WriteJoint(Pivot, Part.RestLocation, FRotator(Hip, 0.0f, 0.0f));
				break;
			}
			const float Air = 0.0f;
			const float Still = WornPose.bValid ? FMath::Clamp(WornPose.Stillness, 0.0f, 1.0f) : 0.0f;
			const float Ground = (1.0f - Air) * (1.0f - Still);
			WriteJoint(Pivot, 
				Part.RestLocation + FVector(0.0, 0.0, Lift * 3.4f * Reach * Walk * Scale * Ground),
				FRotator((Swing * 27.0f * Walk + Idle * (1.0f - Walk) * (1.0f - Still)) * Ground
					+ Air * -18.0f * Reach + Drift * 1.1f, 0.0, 0.0));
			break;
		}
		case EWonderlandCompanionMotion::Knee:
		{
			// THE JOINT BELOW A HIP, AND IT ARRIVES LATE. A knee that bends on the same frame as its hip is the most
			// mechanical thing a walk can do; the 0.11 of a cycle it runs behind is what makes the leg read as a leg.
			const float Cycle = FMath::Frac(Gait + Part.A - 0.11f);
			// Bent hardest through the swing, nearly straight under load, and never quite locked.
			const float Bend = FMath::Max(FMath::Sin(2.0f * PI * Cycle), 0.0f);
			const float Load = FMath::Max(-FMath::Sin(2.0f * PI * Cycle), 0.0f);
			const float Reach = FMath::Max(Part.B, 0.01f);
			if (WornPose.bValid)
			{
				// A KNEE OR AN ELBOW, AS CLASSIFIED AT LOAD from the figure's hierarchy and absolute pivots.
				//
				// THE DEFECT THAT WAS HERE (founder regression, 2026-09-29): this told them apart by RestLocation.Y,
				// which is relative to the parent joint and therefore ZERO for every shin and forearm -- so all four
				// read as "the right knee", and took the knee's angle with the opposite sign to the canon's shin.
				const bool bPlus = Part.LimbSide > 0;
				if (WornPose.bHasCanonJoints && Part.LimbKind != 0)
				{
					if (Motions.IsValidIndex(Part.UpperIndex) && Motions[Part.UpperIndex].LimbSide != 0
						&& Motions[Part.UpperIndex].LowerIndex == Index)
					{
						break;   // the hip or shoulder above wrote this joint with its own, solved or copied as a pair
					}
					WriteJointRotation(Pivot, Part.LimbKind == 4
						? (bPlus ? WornPose.ForearmPlusY : WornPose.ForearmMinusY)
						: (bPlus ? WornPose.ShinPlusY : WornPose.ShinMinusY));
					break;
				}
				// An older caller: Left is the +Y side, an elbow bends positive and a shin folds back (negative).
				const float Solved = Part.LimbKind == 4
					? (bPlus ? WornPose.ElbowLeftDeg : WornPose.ElbowRightDeg)
					: -(bPlus ? WornPose.KneeLeftDeg : WornPose.KneeRightDeg);
				WriteJointRotation(Pivot, FRotator(Solved, 0.0f, 0.0f));
				break;
			}
			const float KneeAir = 0.0f;
			WriteJointRotation(Pivot, FRotator(
				(-Bend * 34.0f + Load * 6.0f) * Reach * Walk * (1.0f - KneeAir)
				+ KneeAir * -30.0f * Reach + Drift * 0.9f, 0.0, 0.0));
			break;
		}
		case EWonderlandCompanionMotion::Spine:
		{
			// THE BODY ITSELF FLEXES. It rolls into the stride, yaws against it, and bobs twice a cycle -- once for
			// each pair of feet. A torso carried rigidly over moving legs is a puppet on a stick.
			const float Amount = FMath::Max(Part.A, 0.0f);
			const float Wave = 2.0f * PI * (Gait + Part.B);
			const float Breathe = FMath::Sin(2.0f * PI * (ActivityTime / 3.9f + Phase)) * 1.4f;
			if (WornPose.bValid)
			{
				// THE DOG'S OWN TORSO, composed exactly as the canon body's root is: sway and bob damped by the
				// stillness the performance asks for, the mission lift added, the lean and turn-roll carried.
				// This is the half that used to be invented here, and the reason a standing skin looked nothing
				// like a standing Relay OG -- at rest the gait weight is zero and ONLY this was left running.
				// NOT SCALED BY Amount, AND THAT WAS THE BUG.
				//
				// FOUNDER, repeatedly: "Relay OG is still the exact animation authority... they still stand
				// weird and walk weird. Fix the actual cause, not cosmetic offsets."
				//
				// Part.A is this FIGURE'S own idle amplitude -- how much it flexes when it is animating
				// itself, which is the branch below. Every Relay skin declares `part root - 0 0 0 spine
				// 0.850`, so multiplying the CANONICAL pose by it made every dressed Dog bob, sway, pitch,
				// yaw and roll at exactly 85% of the authority it is supposed to be copying. Measured
				// against the canon body's own root: 14.880 against 17.519 uu of bob, a ratio of 0.849.
				//
				// An authority's value is not a starting point to be scaled. It is the value.
				WriteJoint(Pivot, 
					Part.RestLocation + FVector(0.0, WornPose.SwayUU, WornPose.BobUU + WornPose.LiftUU),
					FRotator(WornPose.BodyPitchDeg, WornPose.BodyYawDeg, WornPose.BodyRollDeg));
				break;
			}
			WriteJoint(Pivot, 
				Part.RestLocation + FVector(0.0, 0.0, FMath::Sin(Wave * 2.0f) * 1.9f * Amount * Walk * Scale),
				FRotator(
					FMath::Sin(Wave * 2.0f + 0.7f) * 2.6f * Amount * Walk + Breathe * Amount,
					FMath::Sin(Wave + 1.57f) * 3.4f * Amount * Walk,
					FMath::Sin(Wave) * 5.2f * Amount * Walk + Drift * 1.6f * Amount));
			break;
		}
		case EWonderlandCompanionMotion::Trail:
		{
			// A SEGMENT THAT STREAMS. The wave starts at the body and arrives late at the tip, it widens along the
			// chain, and the whole thing sweeps BACK as the body speeds up -- so a tail follows a running creature
			// instead of waving at the same rate whatever it is doing.
			const float Along = FMath::Clamp(Part.A / FMath::Max(Part.B, 1.0f), 0.0f, 1.0f);
			const float Reach = FMath::Pow(Along, 1.2f) + 0.12f;
			const float Lag = Part.A * 0.42f;
			const float Wave = 2.0f * PI * (ActivityTime / 2.05f + Phase) - Lag;
			const float Slow = 2.0f * PI * (ActivityTime / 5.7f + Phase * 0.5f) - Lag * 0.6f;
			// Swinging widens with speed; the backward sweep is what "streaming" actually looks like.
			const float Amplitude = (1.0f + 1.5f * Walk) * Reach;
			WriteJointRotation(Pivot, FRotator(
				(FMath::Sin(Slow) * 5.0f - 16.0f * Walk * Reach) * (1.0f + 0.3f * Drift),
				FMath::Sin(Wave) * 11.0f * Amplitude,
				FMath::Sin(Wave * 0.63f + 0.9f) * 7.0f * Amplitude));
			break;
		}
		case EWonderlandCompanionMotion::Orbit:
			WriteJointRotation(Pivot, FRotator(0.0, FMath::Fmod(ActivityTime * Part.A + Phase * 360.0f, 360.0f), 0.0));
			break;
		case EWonderlandCompanionMotion::Blink:
		{
			// A 0.14 s squash every 5.2 s, offset per companion so the two never blink together.
			const float Cycle = FMath::Fmod(ActivityTime + Phase * 5.2f, 5.2f);
			const float Squash = Cycle < 0.14f ? FMath::Lerp(0.12f, 1.0f, FMath::Abs(Cycle - 0.07f) / 0.07f) : 1.0f;
			Pivot->SetRelativeScale3D(FVector(1.0, 1.0, Squash));
			break;
		}
		case EWonderlandCompanionMotion::Twinkle:
		{
			// FIRE, NOT A PULSING BALL.
			//
			// FOUNDER, repeatedly: the flames on Arden Infernal and Skeleton Flame still read as plastic. This is
			// why. Every part carrying this motion in the skins is a tongue of flame -- halofire, armfire,
			// tailfire, earfire, backfire, the leg and shoulder fires -- and it was scaling the whole tuft
			// UNIFORMLY by ONE slow sine, which is a lump growing and shrinking in place. Nothing burns like that.
			//
			// Real fire runs at several rates at once, it is TALLER AND THINNER at the peak of a lick rather than
			// simply bigger, and it climbs off whatever it is burning. Three octaves at deliberately unrelated
			// periods, seeded per part, so neighbouring tongues never flicker together and the whole never settles
			// into a visible beat -- which is the tell that gave the old one away as an animation.
			const float Seed = Part.A * 7.13f + Phase * 3.7f;
			const float Flicker =
				  0.55f * FMath::Sin(2.0f * PI * (ActivityTime / 0.37f + Seed))
				+ 0.30f * FMath::Sin(2.0f * PI * (ActivityTime / 0.19f + Seed * 2.3f))
				+ 0.15f * FMath::Sin(2.0f * PI * (ActivityTime / 0.83f + Seed * 0.7f));
			const float Lick = FMath::Clamp(0.5f + 0.5f * Flicker, 0.0f, 1.0f);
			// Thin as it climbs, broad as it falls back: the volume is roughly held, and holding it is what stops
			// the tuft pumping like a bellows.
			const float Tall = 0.70f + 0.66f * Lick;
			const float Wide = 1.00f - 0.28f * Lick;
			Pivot->SetRelativeScale3D(FVector(Wide, Wide, Tall));
			WriteJointLocation(Pivot, Part.RestLocation + FVector(0.0, 0.0, Lick * 1.9f * Scale));
			break;
		}
		default:
			break;
		}
	}

	// A slow pulse on everything that glows, from rest, so it can never ratchet brighter.
	const float Pulse = 1.0f + 0.10f * FMath::Sin(2.0f * PI * (ActivityTime / 2.9f + Phase));

	// ---- AND THE HEARTBEAT, for a figure that declared one. See FGlowMaterial::bHeartbeat.
	//
	// ONE CLOCK, TWO DEPTHS. The beat is a raised cosine over 2.4 s -- bright, softening away to almost
	// nothing, and back -- which is the founder's "glow on, soften/off, glow on" and reads as something alive
	// rather than as a light being switched. The marked materials take it at full depth, down to a twelfth,
	// so a chest skull is genuinely dark between beats instead of permanently emissive. Everything else that
	// glows on the same body takes the SAME clock at a third of the depth: the eyes and the ghostfire pulse
	// with the skull rather than ignoring it, and the flame never drops far enough to look like it is going
	// out -- the founder's other standing instruction about this skin.
	//
	// The phase is the body's own, hashed from its name, so two Dogs beat independently and one Dog's parts
	// beat exactly together.
	const float Swell = 0.5f - 0.5f * FMath::Cos(2.0f * PI * FMath::Frac(ActivityTime / 2.4f + Phase));
	const float Shaped = FMath::Pow(Swell, 1.7f);
	const float DeepBeat = 0.08f + 0.92f * Shaped;
	const float ShallowBeat = 0.62f + 0.38f * Shaped;
	for (const FGlowMaterial& Glow : GlowMaterials)
	{
		const float Amount = bHasHeartbeat
			? (Glow.bHeartbeat ? DeepBeat : ShallowBeat)
			: Pulse;
		if (MaterialInstances.IsValidIndex(Glow.MaterialIndex) && MaterialInstances[Glow.MaterialIndex] != nullptr)
		{
			MaterialInstances[Glow.MaterialIndex]->SetVectorParameterValue(Glow.Parameter, Glow.Rest * Amount);
		}
		// AND THE RIBBON THAT GROWS OUT OF IT, on the same clock at the same depth. The ribbons are the only
		// part of Skeleton Flame visible from directly behind -- the chest skull faces forward -- so without
		// this the Dog has no heartbeat at all from half the angles it can be looked at from. See
		// FlameRestColours.
		if (Glow.Parameter == TEXT("Color")
			&& FlameMaterialInstances.IsValidIndex(Glow.MaterialIndex)
			&& FlameMaterialInstances[Glow.MaterialIndex] != nullptr
			&& FlameMaterialInstances[Glow.MaterialIndex] != MaterialInstances[Glow.MaterialIndex]
			&& FlameRestColours.IsValidIndex(Glow.MaterialIndex))
		{
			FlameMaterialInstances[Glow.MaterialIndex]->SetVectorParameterValue(
				TEXT("Color"), FlameRestColours[Glow.MaterialIndex] * Amount);
		}
	}
}

/**
 * THE SUPPORT PULSES. Small lights that leave a companion and travel into the Contract while the study
 * is going on -- the founder's "contributing energy and information", and emphatically not shots.
 *
 * WHAT KEEPS IT FROM READING AS COMBAT is entirely in the numbers: they are slow (three quarters of a
 * second to cross), they are rare (one every second and a half per companion, offset so the two never
 * fire together), they arrive and stop rather than striking, and they travel on a curve that rises
 * before it falls. A fast straight repeat of the same light would be gunfire with a nicer colour.
 */
void AWonderlandCompanionEmbodiment::AnimatePulses(float TimeSeconds)
{
	const AActor* Contract = ContractActor.Get();
	const FWonderlandCompanionOrbit FlightOrbit = WonderlandCompanionOrbitFor(Formation);
	// ONLY A JOINED COMPANION CONTRIBUTES, and only in a flight that contributes. Gathering and holding clear do not.
	const bool bShould = WonderlandFormationOrbits(Formation) && FlightOrbit.bContributes && Contract != nullptr;
	AnimateBeam(TimeSeconds, FlightOrbit, bShould);
	if (PulseMesh == nullptr)
	{
		if (!bShould)
		{
			return;
		}
		// Built on first use rather than at spawn: a companion that never joins a study never pays for it.
		UStaticMesh* Cube = LoadVoxelCube();
		UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, GlowParentPath);
		if (Cube == nullptr)
		{
			return;
		}
		PulseMesh = NewObject<UInstancedStaticMeshComponent>(this,
			MakeUniqueObjectName(this, UInstancedStaticMeshComponent::StaticClass(), TEXT("SupportPulse")));
		PulseMesh->SetMobility(EComponentMobility::Movable);
		PulseMesh->SetStaticMesh(Cube);
		PulseMid = Parent != nullptr ? UMaterialInstanceDynamic::Create(Parent, this) : nullptr;
		if (PulseMid != nullptr)
		{
			// An unlit emissive reads as BLACK below about x3000 in this world's daylight exposure; the
			// companions' own figures carry the same multiplier for the same reason.
			PulseMid->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.80f, 0.93f, 1.0f) * 4200.0f);
			PulseMesh->SetMaterial(0, PulseMid.Get());
		}
		PulseMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		PulseMesh->SetGenerateOverlapEvents(false);
		PulseMesh->SetCanEverAffectNavigation(false);
		PulseMesh->SetCastShadow(false);
		PulseMesh->SetAbsolute(true, true, true);
		PulseMesh->SetupAttachment(Root);
		PulseMesh->RegisterComponent();
		Pulses.SetNum(4);
		// A head and two trailing sparks per pulse.
		// EVERY INSTANCE IS CREATED ONCE, HERE, and afterwards only ever MOVED.
		//
		// The first version cleared and re-added the instances every frame, which forces a full render
		// state rebuild per companion per frame. It stalled a PIE session so badly that the run never got
		// past its seventh sample and the editor sat at several hundred per cent CPU until it was killed.
		// An unused pulse is parked at zero scale rather than removed: a scale of nothing costs a matrix
		// multiply, and a rebuilt buffer costs the frame.
		TArray<FTransform> Parked;
		Parked.Init(FTransform(FRotator::ZeroRotator, FVector::ZeroVector, FVector::ZeroVector), Pulses.Num() * PulseSparks);
		PulseMesh->AddInstances(Parked, false, false, false);
	}

	// Each companion's light is its own colour -- starlight for the LLM Companion, the imported-agent cyan for the
	// Jhinn -- so it is always readable which companion is contributing what. Set only when it changes.
	if (PulseMid != nullptr && !AppliedPulseAccent.Equals(ContributionAccent))
	{
		PulseMid->SetVectorParameterValue(TEXT("Color"), ContributionAccent * 4200.0f);
		AppliedPulseAccent = ContributionAccent;
	}

	if (!bShould)
	{
		// Park them rather than clearing: this branch runs every frame for the whole of a mission that is
		// not a study, and rebuilding an instance buffer every frame is what stalled the first version.
		for (int32 Index = 0; Index < Pulses.Num(); ++Index)
		{
			if (Pulses[Index].Started >= 0.0f)
			{
				Pulses[Index].Started = -1.0f;
				for (int32 Spark = 0; Spark < PulseSparks; ++Spark)
				{
					PulseMesh->UpdateInstanceTransform(Index * PulseSparks + Spark,
						FTransform(FRotator::ZeroRotator, FVector::ZeroVector, FVector::ZeroVector), true, false, false);
				}
			}
		}
		PulseMesh->MarkRenderStateDirty();
		return;
	}

	const FWonderlandCompanionOrbit& Orbit = FlightOrbit;
	if (NextPulseAt < 0.0f)
	{
		// Offset by the companion's own phase so the two never fire together.
		NextPulseAt = TimeSeconds + Orbit.PulseEverySeconds * FormationPhase;
	}
	if (TimeSeconds >= NextPulseAt)
	{
		NextPulseAt = TimeSeconds + Orbit.PulseEverySeconds;
		for (FSupportPulse& Pulse : Pulses)
		{
			if (Pulse.Started < 0.0f)
			{
				Pulse.From = ContributionOrigin();
				Pulse.Started = TimeSeconds;
				++PulsesSent;
				break;
			}
		}
	}

	const FVector Target = Contract->GetActorLocation();
	for (int32 Index = 0; Index < Pulses.Num(); ++Index)
	{
		FSupportPulse& Pulse = Pulses[Index];
		const float Along = Pulse.Started >= 0.0f
			? (TimeSeconds - Pulse.Started) / FMath::Max(Orbit.PulseTravelSeconds, 0.05f)
			: -1.0f;
		if (Pulse.Started >= 0.0f && Along >= 1.0f + PulseTrail * (PulseSparks - 1))
		{
			// It ARRIVES rather than striking: the light reaches the Contract, its sparks follow it in, and it is done.
			Pulse.Started = -1.0f;
		}
		for (int32 Spark = 0; Spark < PulseSparks; ++Spark)
		{
			FTransform Where(FRotator::ZeroRotator, FVector::ZeroVector, FVector::ZeroVector);
			// Each spark runs the same curve a little behind the one before, so a pulse reads as a travelling light
			// with a tail at play distance -- a single 5 uu cube, the first version, was three pixels.
			const float At = Pulse.Started >= 0.0f ? Along - PulseTrail * Spark : -1.0f;
			if (At >= 0.0f && At < 1.0f)
			{
				// A curve, not a line. It rises out of the companion and settles into the Contract, which is what
				// makes it read as offering rather than firing.
				const FVector Straight = FMath::Lerp(Pulse.From, Target, At);
				const float Arc = FMath::Sin(At * PI) * 40.0f;
				const float Size = FMath::Lerp(15.0f, 6.0f, At) * (Spark == 0 ? 1.0f : (Spark == 1 ? 0.62f : 0.4f));
				// Turning as it goes, so the voxel light glints instead of sliding.
				Where = FTransform(FRotator(At * 300.0f, At * 420.0f, 0.0f), Straight + FVector(0.0, 0.0, Arc), FVector(Size / 100.0f));
			}
			const int32 Instance = Index * PulseSparks + Spark;
			if (PulseMesh->IsValidInstance(Instance))
			{
				PulseMesh->UpdateInstanceTransform(Instance, Where, true, false, false);
			}
		}
	}
	// One render-state touch for the whole set, after all four have moved.
	PulseMesh->MarkRenderStateDirty();
}

void AWonderlandCompanionEmbodiment::AnimateBeam(float TimeSeconds, const FWonderlandCompanionOrbit& Orbit, bool bContributing)
{
	const AActor* Contract = ContractActor.Get();
	// THE JHINN'S EXECUTION BEAM: on for a moment in each cycle while it implements or repairs, so it reads as work
	// being delivered in bursts rather than a laser held on the crystal. The LLM Companion contributes by pulses alone.
	const float Cycle = 2.4f;
	const float CyclePhase = FMath::Fmod(TimeSeconds + FormationPhase * Cycle, Cycle);
	const bool bWant = bContributing && bAgent && Orbit.bAgentBeam && Contract != nullptr && CyclePhase < 0.9f;
	if (!bWant)
	{
		if (BeamMesh != nullptr && BeamMesh->IsVisible())
		{
			BeamMesh->SetVisibility(false);
		}
		bBeamOn = false;
		return;
	}
	if (BeamMesh == nullptr)
	{
		UStaticMesh* Cube = LoadVoxelCube();
		UMaterialInterface* Parent = LoadObject<UMaterialInterface>(nullptr, GlowParentPath);
		if (Cube == nullptr)
		{
			return;
		}
		BeamMesh = NewObject<UStaticMeshComponent>(this, MakeUniqueObjectName(this, UStaticMeshComponent::StaticClass(), TEXT("ContributionBeam")));
		BeamMesh->SetMobility(EComponentMobility::Movable);
		BeamMesh->SetStaticMesh(Cube);
		BeamMid = Parent != nullptr ? UMaterialInstanceDynamic::Create(Parent, this) : nullptr;
		if (BeamMid != nullptr)
		{
			BeamMesh->SetMaterial(0, BeamMid.Get());
		}
		BeamMesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		BeamMesh->SetGenerateOverlapEvents(false);
		BeamMesh->SetCanEverAffectNavigation(false);
		BeamMesh->SetCastShadow(false);
		BeamMesh->SetAbsolute(true, true, true);
		BeamMesh->SetupAttachment(Root);
		BeamMesh->RegisterComponent();
	}
	if (BeamMid != nullptr)
	{
		// Brightest at the start of the burst, fading out, with a floor that still reads in daylight (x3000 and up).
		const float Burst = 1.0f - FMath::Clamp(CyclePhase / 0.9f, 0.0f, 1.0f);
		BeamMid->SetVectorParameterValue(TEXT("Color"), ContributionAccent * (3600.0f + 2400.0f * Burst));
	}
	const FVector From = ContributionOrigin();
	const FVector To = Contract->GetActorLocation();
	const FVector Span = To - From;
	const double Length = Span.Size();
	if (Length < 10.0)
	{
		BeamMesh->SetVisibility(false);
		bBeamOn = false;
		return;
	}
	// The unit cube is 100 uu and centred, so the bar sits at the midpoint, turned along the span, X-scaled to length.
	BeamMesh->SetWorldLocationAndRotation((From + To) * 0.5, Span.Rotation());
	// Seven uu across: at 4.5 the first film showed a hairline that vanished whenever the bar was not broadside.
	BeamMesh->SetWorldScale3D(FVector(Length / 100.0, 0.07, 0.07));
	if (!BeamMesh->IsVisible())
	{
		BeamMesh->SetVisibility(true);
	}
	bBeamOn = true;
}

