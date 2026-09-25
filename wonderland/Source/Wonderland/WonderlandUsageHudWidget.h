// THE USAGE HUD, DRAWN. Top left, two coordinated swooping meters.
//
// A PRESENTER AND NOTHING ELSE. Every number this widget draws comes from
// UWonderlandUsageSubsystem, every curve from the frozen contract, and every
// colour from the generated palette. It decides no capacity, derives no
// percentage, holds no fallback figure and keeps nothing across a reopen. Ask
// it what the compound remainder is and the only honest answer it can give is
// "whatever the subsystem currently says", which is the property the founder
// directive asked for in as many words: the widget must not own authoritative
// usage state.
//
// THE COMPOSITION, and why it is one widget rather than two:
//
//   The Compound meter is the dominant frame — the long green swoop. The single
//   agent's is a shorter blue stroke that passes BEHIND it, nested inside its
//   curve. They are one composition, not two bars that happen to be adjacent,
//   and the layering is part of the design rather than a stacking accident. Two
//   widgets would each own a Z-order and the relationship would depend on which
//   was added to the canvas first. One widget paints both, in the order the
//   contract's `Emphasis` gives — lower draws later, and therefore on top.
//
// FOUR BANDS PER METER, drawn back to front:
//
//   TRACK      the whole shape at the tier's capacity span. A BIGGER TIER IS A
//              LONGER TRACK — that is the founder's requirement that higher
//              tiers visibly increase physical capacity, and it lives in the
//              geometry rather than in a shade.
//   REMAINDER  the same ribbon walked to what is LEFT. The meter drains.
//   HEAD       a short bright band at the remainder's leading edge.
//
// UNKNOWN RENDERS AS UNKNOWN. A capacity nobody reported still draws its track,
// because the swoosh is the HUD's furniture and its absence would read as a
// broken HUD; what it never draws is a remainder. A full arc would claim
// capacity nobody confirmed and an empty one would claim it had all been spent.
//
// NO TICK, AND NO STATE OF ITS OWN TO TICK OVER. The widget listens to the
// subsystem's change delegate and rebuilds its vertex bands only when the
// reading actually moves. Between changes a paint is a transform of cached unit
// coordinates — no sampling, no arc tables, no allocation, and nothing that
// reaches a backend.
//
// WHAT IS AND IS NOT VERIFIED HERE, stated plainly because the distinction
// matters more than the code. The GEOMETRY these bands are built from is proven
// against the TypeScript sampler numerically
// (wonderland/Tools/geometry-parity-check.sh), the DRAW PLAN that decides their
// extents is proven against the same cases the contract is
// (wonderland/Tools/usage-subsystem-check.sh), and the STATE they read is
// proven against the sequences a live world sees. The Slate calls below are
// NOT: there is no Unreal Engine in this repository, so nothing here has ever
// been compiled against the real UMG headers or seen to put a pixel on a
// screen. Treat this file as the part that still needs an engine, and the three
// harnesses as the part that does not.

#pragma once

#include "Blueprint/UserWidget.h"
#include "CoreMinimal.h"
#include "WonderlandUsageGeometry.h"
#include "WonderlandUsageHud.h"
#include "WonderlandUsageHudWidget.generated.h"

class UWonderlandUsageSubsystem;

UCLASS()
class WONDERLAND_API UWonderlandUsageHudWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	virtual void NativeConstruct() override;
	virtual void NativeDestruct() override;

	virtual int32 NativePaint(
		const FPaintArgs& Args,
		const FGeometry& AllottedGeometry,
		const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements,
		int32 LayerId,
		const FWidgetStyle& InWidgetStyle,
		bool bParentEnabled) const override;

	/**
	 * Rebuild the bands from the subsystem's current reading.
	 *
	 * A UFUNCTION because the subsystem's delegate is dynamic, which is what
	 * lets a Blueprint HUD bind to the same signal without a C++ subclass.
	 */
	UFUNCTION()
	void HandleUsageChanged();

	/** How many curve steps each band is built from. More is smoother and dearer. */
	UPROPERTY(EditDefaultsOnly, Category = "Wonderland|Usage")
	int32 CurveSteps = 48;

	/**
	 * WHAT THE THREE AGENT ROWS ACTUALLY PAINTED, one entry per row, "LABEL|Name".
	 *
	 * WHY THIS EXISTS. The founder's rule is that a visual system is not proven by a photograph of it, and
	 * the rows are text -- the thing a screenshot proof is worst at and a reader is most likely to take on
	 * trust. Re-reading the settings from a proof would establish nothing either: that tests the settings
	 * object against itself and leaves the actual question, whether NativePaint draws those names, exactly
	 * as unanswered as before.
	 *
	 * So this is written BY the paint, inside the same loop that emits the glyphs, from the same strings. A
	 * row that is not painted cannot appear here, and a name the HUD silently dropped cannot either.
	 *
	 * Transient and diagnostic. Nothing in the widget or the game reads it, so the presenter rule at the top
	 * of this file is intact: it reports what was drawn, it decides nothing.
	 */
	UPROPERTY(BlueprintReadOnly, Transient, Category = "Wonderland|Test")
	TArray<FString> PaintedAgentRows;

private:
	/** The subsystem, or null. Null is a real state: a widget can outlive one. */
	UWonderlandUsageSubsystem* Usage() const;

	void RebuildBands();

	/**
	 * Paint one band into the art box. Does nothing when the band is empty, which is the point.
	 *
	 * Positions leave here in RENDER space. MakeCustomVerts draws exactly the coordinates
	 * it is given, with no widget transform applied; the first engine run of this widget
	 * passed widget-local coordinates and the swoosh was painted from the corner of the
	 * editor window instead of the HUD's own corner, so only a sliver ever showed.
	 */
	void PaintBand(
		const TArray<FVector2D>& Unit,
		const FLinearColor& Colour,
		const FGeometry& AllottedGeometry,
		const FVector2f& ArtOrigin,
		float ArtScale,
		const FVector2f& Offset,
		FSlateWindowElementList& OutDrawElements,
		int32 LayerId) const;

	/** One line of the readout, with the soft shadow the web HUD gives its text. */
	void PaintText(
		const FString& Text,
		const FSlateFontInfo& Font,
		const FLinearColor& Colour,
		const FVector2f& At,
		const FGeometry& AllottedGeometry,
		FSlateWindowElementList& OutDrawElements,
		int32 LayerId) const;

	/**
	 * A four-point glint in render space, drawn at the white arc's leading tip. The LLM Companion's
	 * embodiment travels in starlight; its meter ends in one point of it.
	 */
	void PaintGlint(
		const FVector2f& Centre,
		float Radius,
		const FLinearColor& Colour,
		const FGeometry& AllottedGeometry,
		FSlateWindowElementList& OutDrawElements,
		int32 LayerId) const;

	/** Build (or rebuild, when a tuning variable moved) the samplers for the current composition. */
	void EnsureSamplers();

	/** The readout, rebuilt with the bands: exactly what the web HUD prints for the same reading. */
	FString CompoundFigure;
	FString SingleFigure;
	FString CompanionFigure;

	/**
	 * Each meter's fullness as the reading states it (RemainingFraction), e.g. "100%". Empty when the
	 * reading does not know it. Read from the contract, never computed from the drawn arc.
	 */
	FString CompoundPercent;
	FString SinglePercent;
	FString CompanionPercent;

	/** The held reading is the development preview (WonderlandUsagePreview.h): its unit figures are not usage. */
	bool bPreviewReading = false;
	FString ProvenanceLine;
	FString ReasonLine;

	/**
	 * A meter whose remainder is the whole track. Its head band is not painted: the head's bright tone is
	 * nearly white on every channel, and on a full meter it read as the end of the stroke fading out
	 * (founder, 2026-09-15: "the blue bar must be fully blue").
	 */
	bool bCompoundFull = false;
	bool bSingleFull = false;
	bool bCompanionFull = false;

	FWonderlandMeterBands CompoundBands;
	FWonderlandMeterBands SingleBands;

	/**
	 * THE THIRD, WHITE METER -- a development preview composition (WonderlandCompanionHud.h), drawn only
	 * when UWonderlandUsageHudSettings::bShowLlmCompanionMeter is set. The edge and glow bands are the same
	 * spine at wider half-widths, painted underneath so white holds its shape on ivory stone and cloud.
	 */
	bool bShowCompanionMeter = false;
	FWonderlandMeterBands CompanionBands;
	FWonderlandMeterBands CompanionEdgeBands;
	FWonderlandMeterBands CompanionGlowBands;
	bool bCompanionTipVisible = false;
	FVector2D CompanionTip = FVector2D::ZeroVector;

	/** The tuning the samplers were last built with, so a console change rebuilds them exactly once. */
	float BuiltSingleWidthScale = -1.0f;
	float BuiltCompanionEdge = -1.0f;
	float BuiltCompanionGlow = -1.0f;
	bool bBuiltWithCompanion = false;

	/**
	 * The samplers, built once.
	 *
	 * Constructing one walks every segment at the contract's arc resolution, so
	 * rebuilding them per reading — let alone per paint — would put that work on
	 * the frame budget for a curve that never changes. The shapes are frozen;
	 * only how far along them to walk moves.
	 */
	TUniquePtr<FWonderlandSwooshSampler> CompoundSampler;
	TUniquePtr<FWonderlandSwooshSampler> SingleSampler;
	TUniquePtr<FWonderlandSwooshSampler> CompanionSampler;
	TUniquePtr<FWonderlandSwooshSampler> CompanionEdgeSampler;
	TUniquePtr<FWonderlandSwooshSampler> CompanionGlowSampler;
};
