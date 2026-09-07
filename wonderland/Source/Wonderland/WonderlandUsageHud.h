// WONDERLAND — THE USAGE METER. The swoosh in the top-left corner.
//
// Mirrors `WonderlandUsageMeter` and `WonderlandUsageSwoosh` in
// src/relay/mission/wonderland/wonderland-usage-meter.ts, field for field, and
// wonderland-cpp-parity.test.ts fails when they drift in either direction.
//
// THE MEANING, which is not a percentage. A higher tier increases the meter's
// PHYSICAL MAXIMUM LENGTH, so two agents on two tiers are two different-sized
// pictures rather than two renderings of the same full bar:
//
//     CapacitySpan is capacity / reference   — how long the meter is drawn
//     FillFraction is used / capacity        — how much of that length is spent
//
// Multiply them and you have the absolute arc that is filled, which is the same
// length for the same spend regardless of tier. That is what a single
// percentage cannot express, and it is why these are two fields.
//
// TWO STRUCTS, TWO LIFETIMES. The METER changes every time usage does. The
// SWOOSH is the shape and changes when a designer changes it. Keeping them
// apart is what lets the curve be redrawn — thicker, longer, more hooked —
// without a field of the reading moving, and it is why the control points are
// data here rather than constants inside a material or a widget.
//
// UNKNOWN IS NEVER ZERO. Every number is an FWonderlandFigure, so an
// unconfigured meter draws as Unknown rather than as an empty bar. An empty bar
// is a claim that nothing has been used.
//
// NOTHING HERE IS BILLING. There is no tier→capacity table in this file or in
// its TypeScript mirror, and there must not be one: a tier is an opaque id, a
// label and a capacity supplied by an authority. Relay holds no subscription
// ledger, and a constant here would quietly become one.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandTypes.h"
#include "RelayWorldState.h"
#include "WonderlandUsageHud.generated.h"

/* ------------------------------------------------------------- vocabulary */

// Mirrors WONDERLAND_USAGE_STATUSES, which is Relay's existing usage status
// vocabulary reused rather than restated.
//
// `Unavailable` sits at ordinal 0 deliberately: a default-constructed meter has
// been told nothing, and "available" would be the one reading that invites a
// player to spend capacity nobody has confirmed they have.
UENUM(BlueprintType)
enum class EWonderlandUsageStatus : uint8
{
	Unavailable,
	Available,
	Limited,
	Blocked,
	Updating
};

// Mirrors WONDERLAND_HUD_ANCHORS. Where a HUD element sits.
//
// Declared rather than left to convention, because the corner is a product
// decision — the founder named the top left — and two surfaces with two
// conventions would put the same meter in two places.
UENUM(BlueprintType)
enum class EWonderlandHudAnchor : uint8
{
	TopLeft,
	TopRight,
	BottomLeft,
	BottomRight
};

/* ---------------------------------------------------------- the channels */

// Mirrors WONDERLAND_USAGE_CHANNELS. Two bars, two subjects.
//
// A single agent and a Compound Agent consume different things, so one meter
// showing their sum would be a bar nobody could act on: it falls and you do not
// know which capability shrank. Compound sits at ordinal 0 because it is the
// dominant frame — the broader capacity and the longer sweep.
UENUM(BlueprintType)
enum class EWonderlandUsageChannel : uint8
{
	CompoundAgent,
	SingleAgent
};

// Mirrors WonderlandUsageChannelStyle. The palette and the draw order, as data.
//
// Both surfaces read these values. A colour that lived only in a stylesheet
// would be a colour Unreal had to guess at, and the two HUDs would drift the
// first time either was retouched.
USTRUCT(BlueprintType)
struct FWonderlandUsageChannelStyle
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	EWonderlandUsageChannel Channel = EWonderlandUsageChannel::CompoundAgent;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString Label;

	// The filled stroke.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString Accent;

	// The leading edge, brightest where the fill ends.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString Bright;

	// The light the meter casts into the HUD.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString Glow;

	// The unspent remainder of the frame. Never the same value as Accent.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString Track;

	// 0 is the dominant frame. Lower draws later, and on top.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	int64 Emphasis = 0;
};

/* ------------------------------------------------------------- the shape */

// Mirrors WonderlandSwooshSegment. One cubic of the spine.
USTRUCT(BlueprintType)
struct FWonderlandSwooshSegment
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double Control1X = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double Control1Y = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double Control2X = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double Control2Y = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double EndX = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double EndY = 0.0;
};

// Mirrors WonderlandUsageSwoosh. A poly-Bézier spine plus a width profile, in a
// unit box whose origin is the anchored corner.
//
// ONE CUBIC WAS NOT ENOUGH. The Compound frame wraps 250 degrees around a
// corner ornament before flying out to the right, and a single cubic cannot
// turn that far without cusping. A start point and a list of segments is
// exactly what an SVG path and an Unreal spline both already are.
//
// THE PARAMETER IS ARC LENGTH, NOT BÉZIER `t`. Bézier `t` runs fast through
// gentle stretches and slow through tight ones, so a meter drawn on raw `t`
// would show a different amount of stroke for the same spend depending on where
// on the curve it fell — and this meter's whole thesis is that spend is drawn as
// length. Any consumer sampling these points MUST reparameterise by length, as
// the TypeScript sampler does.
//
// THE WIDTH HOLDS AND THEN TAPERS. A profile that tapered from the first pixel
// would make the frame look like it was already draining.
USTRUCT(BlueprintType)
struct FWonderlandUsageSwoosh
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double StartX = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double StartY = 0.0;

	// Head to tail. Never empty.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	TArray<FWonderlandSwooshSegment> Segments;

	// Ribbon half-width before the taper begins.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double TailWidth = 0.0;

	// Ribbon half-width at the very tip. Near zero is a point, which is intended.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double TipWidth = 0.0;

	// Arc fraction at which the width starts falling. 0 tapers from the start.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double TaperStart = 0.0;

	// How sharply the width falls after TaperStart. 1 is linear.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	double TaperExponent = 1.0;
};

/* ------------------------------------------------------------- the meter */

// Mirrors WonderlandUsageMeter. One reading of one player's capacity.
USTRUCT(BlueprintType)
struct FWonderlandUsageMeter
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString SchemaVersion;

	// Which of the two bars this reading fills. Never inferred from a tier.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	EWonderlandUsageChannel Channel = EWonderlandUsageChannel::CompoundAgent;

	// Opaque. Never parsed, never ranked, never mapped to a price here.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandText TierId;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandText TierLabel;

	// What one unit is called. Null until the authority says — Relay does not
	// know whether a unit is a token, a dollar or a mission, and a HUD that
	// hard-coded one would have to be rewritten when it turned out to be another.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandText UnitLabel;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandFigure CapacityUnits;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandFigure UsedUnits;

	// Derived, and only when both sides are known.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandFigure RemainingUnits;

	// The tier ceiling this HUD draws a full arc for.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandFigure ReferenceCapacityUnits;

	// capacity / reference, clamped to 0..1. The meter's PHYSICAL LENGTH.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandFigure CapacitySpan;

	// used / capacity, clamped to 0..1. How much of that length is spent.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandFigure FillFraction;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	EWonderlandUsageStatus Status = EWonderlandUsageStatus::Unavailable;

	// A sentence whenever the meter cannot show a real reading.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandText UnavailableReason;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	EWonderlandProvenance Provenance = EWonderlandProvenance::Simulated;

	// True whenever Provenance is not Live. The label travels with the data.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	bool bSimulated = true;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	EWonderlandHudAnchor Anchor = EWonderlandHudAnchor::TopLeft;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString ObservedAtIso;
};

/* --------------------------------------------------------------- the HUD */

// Mirrors WonderlandUsageHud. The whole top-left HUD: both bars, one anchor,
// one observation instant.
//
// The two meters travel TOGETHER because they are read together. A HUD
// assembled from a fresh Compound reading and a stale single reading is not
// fresh, and ObservedAtIso is the HUD's own instant rather than either meter's
// so that a renderer can tell.
USTRUCT(BlueprintType)
struct FWonderlandUsageHud
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString SchemaVersion;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	EWonderlandHudAnchor Anchor = EWonderlandHudAnchor::TopLeft;

	// The dominant frame: the long right-facing green swoop.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandUsageMeter CompoundAgent;

	// The simpler blue stroke nested inside it.
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FWonderlandUsageMeter SingleAgent;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	FString ObservedAtIso;
};
