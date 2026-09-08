// WONDERLAND — THE USAGE HUD'S GEOMETRY, SAMPLED IN THE WORLD.
//
// The two meters are poly-Bézier arcs, and their control points are FROZEN by
// the founder and pinned by digest in
// src/relay/mission/wonderland/wonderland-hud-canon.test.ts. This is the code
// that turns those control points into something Slate can draw.
//
// WHY THE SAMPLER LIVES HERE AND NOT ON THE WIRE. Relay could send a polyline
// and save this file existing. It must not: the shape would then be re-derived
// on every push, a stroke's fidelity would depend on how many points the
// network felt like carrying, and the ribbon would change subtly with the
// transport. The CONTROL POINTS cross — a dozen numbers, already mirrored as
// FWonderlandUsageSwoosh — and the world draws them at whatever resolution the
// viewport deserves.
//
// ARC LENGTH, NOT BÉZIER `t`, WHICH IS THE WHOLE DIFFICULTY. A cubic's
// parameter runs fast through gentle curvature and slow through tight
// curvature, so filling a meter by `t` would drain quickly around the ring and
// crawl along the tail. Equal spend must draw equal stroke, so the sampler
// builds a cumulative arc-length table and inverts it. That is the same
// algorithm the TypeScript uses, at the same resolution, and
// `WonderlandUsageGeometryTest.cpp` holds this implementation against a fixture
// generated from it — because two ports of one algorithm is exactly the shape
// of a drift nobody notices until the two surfaces disagree on screen.
//
// PURE. No engine state, no allocation beyond the table, no Tick.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandUsageHud.h"
#include "WonderlandUsageGeometry.generated.h"

/** Table resolution per segment. Must match the TypeScript's 64 exactly. */
static constexpr int32 WonderlandArcTableResolution = 64;

// Mirrors WonderlandSwooshSample. One point on the spine, with everything a
// renderer needs to offset along the normal without redoing the maths.
USTRUCT(BlueprintType)
struct FWonderlandSwooshSample
{
	GENERATED_BODY()

	/** Arc-length fraction, 0 at the tail and 1 at the tip. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float T = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float X = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float Y = 0.f;

	/** Unit tangent. Falls back to +x where control points coincide. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float TangentX = 1.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float TangentY = 0.f;

	/** Half the stroke's thickness here: held, then tapered toward the tip. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float HalfWidth = 0.f;
};

/**
 * The sampler.
 *
 * Built once per shape and reused. Building it is cheap — four segments at 64
 * steps — but doing it per sample per frame would be 256 hypots a stroke a
 * frame for a figure that never changes, which is precisely the kind of cost
 * §13 of the HUD direction rules out.
 */
class WONDERLAND_API FWonderlandSwooshSampler
{
public:
	explicit FWonderlandSwooshSampler(const FWonderlandUsageSwoosh& InShape);

	/** One point at an ARC-LENGTH fraction. `T` outside 0..1 draws an end. */
	FWonderlandSwooshSample Sample(float T) const;

	/** Total spine length in unit-box coordinates. */
	float TotalLength() const { return Total; }

	/** True when the shape had no usable segments and nothing can be drawn. */
	bool IsEmpty() const { return Cumulative.Num() <= 1; }

private:
	struct FSegmentPoints
	{
		float X0 = 0.f, Y0 = 0.f, X1 = 0.f, Y1 = 0.f;
		float X2 = 0.f, Y2 = 0.f, X3 = 0.f, Y3 = 0.f;
	};

	float HalfWidthAt(float T) const;

	FWonderlandUsageSwoosh Shape;
	TArray<FSegmentPoints> Segments;
	TArray<int32> SegmentIndex;
	TArray<float> Local;
	TArray<float> Cumulative;
	float Total = 0.f;
};

/**
 * THE CANONICAL SHAPES, generated from the frozen TypeScript contract.
 *
 * Defined in `WonderlandUsageGeometry.canonical.cpp`, which is GENERATED — see
 * that file's header. The shape is static design data the client may hold; the
 * usage FIGURES are runtime state and arrive from Relay. A world must be able
 * to draw its own empty track before the first push, which is why the curve
 * lives here and the numbers do not.
 */
WONDERLAND_API const FWonderlandUsageSwoosh& WonderlandCompoundSwoosh();
WONDERLAND_API const FWonderlandUsageSwoosh& WonderlandSingleSwoosh();

/**
 * The drawable outline of a stroke, as one closed ribbon.
 *
 * `Fraction` is how much of the spine to walk, so a meter draws its REMAINDER
 * by passing the remaining fraction — the meter drains rather than filling.
 * Returns the two edges walked out and back, which is what Slate wants for a
 * filled polygon.
 */
WONDERLAND_API void WonderlandSwooshOutline(
	const FWonderlandSwooshSampler& Sampler,
	float Fraction,
	int32 Steps,
	TArray<FVector2D>& OutPoints);

/* ------------------------------------------------------------ draw plan */

// Mirrors WonderlandMeterDrawPlan. The arithmetic between a reading and a
// drawing, computed once in the contract and mirrored here field for field.
//
// WHY THIS IS MIRRORED RATHER THAN RE-DERIVED. Two surfaces draw this meter,
// and until the plan existed each converted `CapacitySpan` and
// `RemainingFraction` into arcs on its own. That is how a HUD comes to be
// subtly different in the product from the one that was approved: one reading,
// two rounding rules, two visibility thresholds, and nobody able to say which
// is canon. `WonderlandMeterDrawPlan` below reproduces the contract's function
// exactly, and the usage harness holds it against the same cases.
USTRUCT(BlueprintType)
struct FWonderlandMeterDrawPlan
{
	GENERATED_BODY()

	// Arc fraction of the whole shape the track occupies. A BIGGER TIER IS A
	// LONGER TRACK — the founder asked for higher tiers to visibly increase
	// physical capacity, and this is the field that does it.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float TrackFraction = 1.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	bool bTrackVisible = false;

	// Remainder along the track, 0..1. Zero whenever the remainder is unknown.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float RemainderOfTrack = 0.f;

	// The same remainder as an arc fraction of the whole shape. This is the one
	// a renderer that draws geometry walks to; the browser's mask wants the
	// other. Both are carried so neither consumer multiplies and re-clamps.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float RemainderFraction = 0.f;

	// Whether a remainder was REPORTED. A reported zero draws nothing and so
	// does silence; a renderer that could not tell them apart would caption
	// "0 left" over an unreported meter.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	bool bRemainderKnown = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	bool bRemainderVisible = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float HeadStartFraction = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float HeadEndFraction = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	bool bHeadVisible = false;
};

/** Mirrors WONDERLAND_METER_HEAD_ARC. */
WONDERLAND_API extern const float WonderlandMeterHeadArc;

/** Mirrors WONDERLAND_METER_MINIMUM_VISIBLE_ARC. */
WONDERLAND_API extern const float WonderlandMeterMinimumVisibleArc;

/**
 * Turn one meter into the arcs that draw it. Mirrors `wonderlandMeterDrawPlan`.
 *
 * Clamped here for the reason the contract clamps: a meter can arrive from a
 * fixture, a replayed capture or a future authority, and a renderer handed 1.4
 * would draw past the end of its own curve.
 */
WONDERLAND_API FWonderlandMeterDrawPlan WonderlandMeterDrawPlan(const FWonderlandUsageMeter& Meter);

/**
 * The ribbon between two arc fractions, as a TRIANGLE STRIP.
 *
 * `WonderlandSwooshOutline` returns a closed polygon, which is what a filled
 * path wants; Slate wants vertices and indices. Emitting the two edges in pairs
 * makes the index arithmetic trivial — (0,1,2), (2,1,3), and so on — so no
 * renderer has to work out how to triangulate a ribbon, and none of them can
 * work it out differently.
 *
 * Two fractions rather than one because the leading highlight is a BAND rather
 * than a prefix: it ends at the remainder and reaches back a fixed arc.
 *
 * Output is 2 points per step, left edge then right edge. Empty when the span
 * is empty, so a caller that draws whatever it is handed draws nothing.
 */
WONDERLAND_API void WonderlandSwooshRibbonStrip(
	const FWonderlandSwooshSampler& Sampler,
	float From,
	float To,
	int32 Steps,
	TArray<FVector2D>& OutPoints);

/* -------------------------------------------------------------- palette */

// The channel palette, pre-converted to linear. GENERATED — see
// WonderlandUsageGeometry.canonical.cpp.
//
// NO TYPESCRIPT MIRROR, and that is the point rather than an omission. The
// contract states this palette as CSS (`#3fd6a0`, `rgba(63, 214, 160, 0.45)`),
// which is what a browser renders and a designer reads. Unreal cannot use
// either: it needs linear FLinearColors, and a client that parsed CSS at run
// time would carry a string parser for no reason. So the SAME constants are
// converted once at export — sRGB linearised on the same curve the engine uses
// — and the result lands here. Mirroring the struct would mean inventing a
// TypeScript interface nothing in the browser would ever read.
USTRUCT(BlueprintType)
struct FWonderlandUsagePalette
{
	GENERATED_BODY()

	// The filled stroke.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FLinearColor Accent = FLinearColor(1.f, 0.f, 1.f, 1.f);

	// The leading edge, brightest where the fill ends.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FLinearColor Bright = FLinearColor(1.f, 0.f, 1.f, 1.f);

	// The light the meter casts into the HUD.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FLinearColor Glow = FLinearColor(1.f, 0.f, 1.f, 1.f);

	// The unspent remainder of the frame.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FLinearColor Track = FLinearColor(1.f, 0.f, 1.f, 1.f);

	// 0 IS THE DOMINANT FRAME, AND THIS IS THE LAYER ORDER. Lower draws later,
	// and therefore on top: the Compound swoop is 0 and the single-agent stroke
	// is 1, so the single agent's curve passes BEHIND the Compound arc. The
	// founder asked for exactly that relationship, and it is data rather than a
	// renderer's convention so both surfaces stack the two the same way.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	int64 Emphasis = 0;
};

WONDERLAND_API const FWonderlandUsagePalette& WonderlandCompoundPalette();
WONDERLAND_API const FWonderlandUsagePalette& WonderlandSinglePalette();

/**
 * The crop onto the unit box. GENERATED from the contract.
 *
 * A WINDOW, not a scale: the aspect is preserved, so nothing is squashed and a
 * stroke's thickness means the same thing in both axes. A client that carried
 * its own crop would clip a redrawn shape the browser showed whole.
 */
WONDERLAND_API const FWonderlandUsageViewport& WonderlandUsageViewport();

/* ---------------------------------------------------------- the bands */

/**
 * One meter's three drawable bands, in UNIT COORDINATES.
 *
 * Unit space rather than a widget's local space because the two things that
 * change move at different rates: the reading changes when Relay says so, and
 * the widget's size changes when the viewport does. Building in unit space
 * makes a resize a multiply per vertex rather than a re-walk of the arc table,
 * and means a new reading never has to know how big anything currently is.
 */
/*
 * NOT A USTRUCT, DELIBERATELY, and the parity test is what forced the question.
 *
 * These are transient render buffers: rebuilt whenever the reading moves,
 * thrown away when the widget goes, read by exactly one paint. Reflection would
 * buy serialisation, Blueprint exposure and garbage-collection consideration
 * for three arrays that want none of the three, and it would put a shape with
 * no TypeScript counterpart into a parity table whose whole job is to catch
 * exactly that. UWonderlandRelayLink already makes the same call about its pawn
 * array, for the same reason.
 */
struct FWonderlandMeterBands
{
	// The whole shape at the tier's capacity span. A BIGGER TIER IS A LONGER
	// TRACK — the founder's requirement that higher tiers visibly increase
	// physical capacity lives here rather than in a shade.
	TArray<FVector2D> Track;

	// The same ribbon walked to what is LEFT. The meter drains.
	TArray<FVector2D> Remainder;

	// A short bright band at the remainder's leading edge.
	TArray<FVector2D> Head;
};

/**
 * Build one meter's bands. A FREE FUNCTION, for the reason the ordering rule is
 * one: a `UUserWidget` cannot be constructed outside a running engine, so band
 * logic that lived only inside the widget would be logic nothing in this
 * repository could execute. Here it is exercised by the usage harness against
 * the same readings the contract is tested with.
 *
 * EVERY BAND CAN COME BACK EMPTY, and a caller that draws whatever it is handed
 * therefore draws nothing for an unreported remainder, a spent meter or a
 * zero-capacity tier. That is what keeps "nobody has said" from reaching a
 * vertex buffer as a shape somebody might read as a measurement.
 */
WONDERLAND_API void WonderlandBuildMeterBands(
	const FWonderlandSwooshSampler& Sampler,
	const FWonderlandUsageMeter& Meter,
	int32 Steps,
	FWonderlandMeterBands& OutBands);
