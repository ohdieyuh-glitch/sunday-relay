#include "WonderlandUsageHudWidget.h"

#include "Engine/GameInstance.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Styling/SlateTypes.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "UObject/UObjectIterator.h"
#include "WonderlandCompanionHud.h"
#include "WonderlandUiStyle.h"
#include "WonderlandUsagePreview.h"
#include "WonderlandCompanionSubsystem.h"
#include "WonderlandUsageSubsystem.h"

namespace
{
	// THE WORDS ARE THE WEB HUD'S WORDS (src/relay/ui/wonderland-hud/WonderlandUsageHudView.tsx),
	// and the channel labels are WONDERLAND_USAGE_CHANNEL_STYLE's. A second vocabulary for the
	// same reading on the second surface would be a second thing to keep honest.
	const TCHAR* const CompoundLabel = TEXT("COMPOUND AGENT");
	const TCHAR* const SingleLabel = TEXT("SINGLE AGENT");
	// The founder's name for the third reading (2026-09-15). It has no web counterpart until the
	// LLM Companion channel is canon; see WonderlandCompanionHud.h.
	const TCHAR* const CompanionLabel = TEXT("LLM COMPANION");

	// LIVE TUNING FOR THE PREVIEW COMPOSITION. Each is read when the bands rebuild; `wl.Hud.Refresh`
	// rebuilds every HUD on screen, so the composition can be judged in PIE without a compile.
	TAutoConsoleVariable<float> CVarSingleWidthScale(
		TEXT("wl.Hud.SingleWidthScale"), 0.80f,
		TEXT("Blue Single Agent ribbon width while the white LLM Companion arc is shown (1 = the approved width)."));
	TAutoConsoleVariable<float> CVarCompanionEdge(
		TEXT("wl.Hud.CompanionEdge"), 0.0028f,
		TEXT("Extra half-width, in unit-box coordinates, of the dark edge under the white arc."));
	TAutoConsoleVariable<float> CVarCompanionGlow(
		TEXT("wl.Hud.CompanionGlow"), 0.0075f,
		TEXT("Extra half-width of the cool glow under the white arc. 0 draws no glow."));
	TAutoConsoleVariable<float> CVarCompanionGlint(
		TEXT("wl.Hud.CompanionGlint"), 7.0f,
		TEXT("Radius in HUD units of the glint at the white arc's tip. 0 draws no glint."));

	FAutoConsoleCommand CmdRefreshHud(
		TEXT("wl.Hud.Refresh"),
		TEXT("Rebuild every usage HUD's bands and samplers from the current reading and tuning variables."),
		FConsoleCommandDelegate::CreateLambda([]()
		{
			for (TObjectIterator<UWonderlandUsageHudWidget> It; It; ++It)
			{
				if (!It->HasAnyFlags(RF_ClassDefaultObject | RF_ArchetypeObject))
				{
					It->HandleUsageChanged();
				}
			}
		}));

	/** The number a figure shows, or the word for not knowing. It is never 0. */
	FString FigureText(const FWonderlandUsageMeter& Meter)
	{
		if (!Meter.RemainingUnits.bKnown || !Meter.CapacityUnits.bKnown)
		{
			return TEXT("UNKNOWN");
		}
		const FString Unit = Meter.UnitLabel.bKnown ? FString(TEXT(" ")) + Meter.UnitLabel.Value : FString();
		return FString::Printf(TEXT("%lld / %lld%s"),
			static_cast<int64>(FMath::RoundToDouble(Meter.RemainingUnits.Value)),
			static_cast<int64>(FMath::RoundToDouble(Meter.CapacityUnits.Value)), *Unit);
	}

	/** The meter's stated fullness, "100%". Empty when the reading does not state it -- never a guessed 0. */
	FString PercentText(const FWonderlandUsageMeter& Meter)
	{
		if (!Meter.RemainingFraction.bKnown)
		{
			return FString();
		}
		return FString::Printf(TEXT("%d%%"), FMath::RoundToInt(FMath::Clamp(Meter.RemainingFraction.Value, 0.0, 1.0) * 100.0));
	}

	/** Whether a reading's remainder is its whole track, so the stroke is drawn as one solid colour. */
	bool IsFull(const FWonderlandUsageMeter& Meter)
	{
		const FWonderlandMeterDrawPlan Plan = WonderlandMeterDrawPlan(Meter);
		return Plan.bRemainderVisible && Plan.RemainderOfTrack >= 0.995f;
	}

	bool IsPreview(const FWonderlandUsageAuthorityStatus& Authority)
	{
		return Authority.AuthorityId.bKnown && Authority.AuthorityId.Value == WonderlandUsagePreview::AuthorityId;
	}

	/** The authority's own word outranks the provenance line, as on the web. Empty for a current real reading. */
	FString ProvenanceText(const FWonderlandUsageHud& Hud, const FWonderlandUsageAuthorityStatus& Authority)
	{
		if (IsPreview(Authority))
		{
			return TEXT("DEVELOPMENT PREVIEW · NOT JULIUS USAGE");
		}
		switch (Authority.Reading)
		{
		case EWonderlandUsageReading::NotReported: return TEXT("NO USAGE AUTHORITY REPORTING");
		case EWonderlandUsageReading::Stale: return TEXT("STALE · LAST REPORTED FIGURES");
		case EWonderlandUsageReading::Unavailable: return TEXT("USAGE AUTHORITY UNAVAILABLE");
		default: break;
		}
		return (Hud.CompoundAgent.bSimulated || Hud.SingleAgent.bSimulated)
			? FString(TEXT("SIMULATED · NO USAGE AUTHORITY REPORTING"))
			: FString();
	}
}

void UWonderlandUsageHudWidget::NativeConstruct()
{
	Super::NativeConstruct();

	// The samplers are built once and never rebuilt unless the composition's tuning moves. The shapes
	// are frozen; only how far along them to walk moves.
	EnsureSamplers();

	if (UWonderlandUsageSubsystem* Subsystem = Usage())
	{
		Subsystem->OnUsageChanged.AddDynamic(this, &UWonderlandUsageHudWidget::HandleUsageChanged);
	}

	// Built from whatever is already held rather than waiting for the next push.
	// A widget opened mid-mission must show the current reading immediately; one
	// that waited would be blank for however long the authority's cadence is,
	// and a blank meter is indistinguishable from an empty one.
	RebuildBands();
}

void UWonderlandUsageHudWidget::NativeDestruct()
{
	if (UWonderlandUsageSubsystem* Subsystem = Usage())
	{
		Subsystem->OnUsageChanged.RemoveDynamic(this, &UWonderlandUsageHudWidget::HandleUsageChanged);
	}

	CompoundSampler.Reset();
	SingleSampler.Reset();
	CompanionSampler.Reset();
	CompanionEdgeSampler.Reset();
	CompanionGlowSampler.Reset();

	Super::NativeDestruct();
}

UWonderlandUsageSubsystem* UWonderlandUsageHudWidget::Usage() const
{
	// NULL IS A REAL STATE, not a defensive habit. A widget can be constructed
	// in a preview, in an editor viewport, or in a game instance that never
	// registered the subsystem, and every one of those must draw an untold HUD
	// rather than crash or invent a reading.
	const UGameInstance* Instance = GetGameInstance();
	return Instance == nullptr ? nullptr : Instance->GetSubsystem<UWonderlandUsageSubsystem>();
}

void UWonderlandUsageHudWidget::HandleUsageChanged()
{
	RebuildBands();
}

void UWonderlandUsageHudWidget::EnsureSamplers()
{
	const UWonderlandUsageHudSettings* Settings = GetDefault<UWonderlandUsageHudSettings>();
	const bool bCompanion = Settings != nullptr && Settings->bShowLlmCompanionMeter;
	const float SingleScale = bCompanion ? CVarSingleWidthScale.GetValueOnGameThread() : 1.0f;
	const float Edge = CVarCompanionEdge.GetValueOnGameThread();
	const float Glow = CVarCompanionGlow.GetValueOnGameThread();

	if (CompoundSampler.IsValid() && bBuiltWithCompanion == bCompanion && BuiltSingleWidthScale == SingleScale
		&& BuiltCompanionEdge == Edge && BuiltCompanionGlow == Glow)
	{
		return;
	}

	bShowCompanionMeter = bCompanion;
	CompoundSampler = MakeUnique<FWonderlandSwooshSampler>(WonderlandCompoundSwoosh());
	// SLIMMED ONLY TO MAKE ROOM. Without the white arc the blue is exactly the approved stroke.
	SingleSampler = MakeUnique<FWonderlandSwooshSampler>(bCompanion
		? WonderlandCompanionHud::WithWidthScale(WonderlandSingleSwoosh(), SingleScale)
		: WonderlandSingleSwoosh());
	if (bCompanion)
	{
		const FWonderlandUsageSwoosh& White = WonderlandCompanionHud::LlmCompanionSwoosh();
		CompanionSampler = MakeUnique<FWonderlandSwooshSampler>(White);
		CompanionEdgeSampler = MakeUnique<FWonderlandSwooshSampler>(WonderlandCompanionHud::WithWidthOffset(White, Edge));
		CompanionGlowSampler = MakeUnique<FWonderlandSwooshSampler>(WonderlandCompanionHud::WithWidthOffset(White, Glow));
	}
	else
	{
		CompanionSampler.Reset();
		CompanionEdgeSampler.Reset();
		CompanionGlowSampler.Reset();
	}
	bBuiltWithCompanion = bCompanion;
	BuiltSingleWidthScale = SingleScale;
	BuiltCompanionEdge = Edge;
	BuiltCompanionGlow = Glow;
}

void UWonderlandUsageHudWidget::RebuildBands()
{
	EnsureSamplers();

	// AN UNTOLD HUD IS A DEFAULT METER, NOT AN ABSENT ONE. With no subsystem the
	// bands are built from default-constructed meters, whose capacity is unknown
	// and whose remainder is unreported — so the tracks draw and nothing else
	// does. That is the same picture a connected-but-unreported world shows,
	// which is correct: in both cases nobody has said.
	const UWonderlandUsageSubsystem* Subsystem = Usage();
	const FWonderlandUsageHud Hud =
		Subsystem == nullptr ? FWonderlandUsageHud() : Subsystem->GetUsage();
	const FWonderlandUsageAuthorityStatus Authority =
		Subsystem == nullptr ? FWonderlandUsageAuthorityStatus() : Subsystem->GetAuthority();

	CompoundFigure = FigureText(Hud.CompoundAgent);
	SingleFigure = FigureText(Hud.SingleAgent);
	CompoundPercent = PercentText(Hud.CompoundAgent);
	SinglePercent = PercentText(Hud.SingleAgent);
	bCompoundFull = IsFull(Hud.CompoundAgent);
	bSingleFull = IsFull(Hud.SingleAgent);
	bPreviewReading = IsPreview(Authority);
	ProvenanceLine = ProvenanceText(Hud, Authority);
	ReasonLine = Authority.Reason.bKnown ? Authority.Reason.Value
		: (Hud.CompoundAgent.UnavailableReason.bKnown ? Hud.CompoundAgent.UnavailableReason.Value : FString());

	// The building itself is in the geometry module, where the usage harness can
	// run it. What is left here is plumbing.
	if (CompoundSampler.IsValid())
	{
		WonderlandBuildMeterBands(*CompoundSampler, Hud.CompoundAgent, CurveSteps, CompoundBands);
	}
	if (SingleSampler.IsValid())
	{
		WonderlandBuildMeterBands(*SingleSampler, Hud.SingleAgent, CurveSteps, SingleBands);
	}

	// THE WHITE ARC HAS A FIGURE ONLY FROM THE PREVIEW. Under any real authority it is a default meter --
	// capacity unknown, remainder unreported -- so its track draws and its row says UNKNOWN, because no
	// authority reports LLM Companion usage yet and a full white stroke would claim one did.
	CompanionBands = FWonderlandMeterBands();
	CompanionEdgeBands = FWonderlandMeterBands();
	CompanionGlowBands = FWonderlandMeterBands();
	bCompanionTipVisible = false;
	CompanionFigure.Reset();
	CompanionPercent.Reset();
	bCompanionFull = false;
	if (bShowCompanionMeter && CompanionSampler.IsValid())
	{
		const UWonderlandUsageHudSettings* Settings = GetDefault<UWonderlandUsageHudSettings>();
		const FWonderlandUsageMeter Companion = (bPreviewReading && Settings != nullptr)
			? WonderlandCompanionHud::PreviewMeter(Settings->Preview.LlmCompanionPercent)
			: FWonderlandUsageMeter();
		CompanionFigure = FigureText(Companion);
		CompanionPercent = PercentText(Companion);
		bCompanionFull = IsFull(Companion);
		WonderlandBuildMeterBands(*CompanionSampler, Companion, CurveSteps, CompanionBands);
		if (CompanionEdgeSampler.IsValid())
		{
			WonderlandBuildMeterBands(*CompanionEdgeSampler, Companion, CurveSteps, CompanionEdgeBands);
		}
		if (CompanionGlowSampler.IsValid() && CVarCompanionGlow.GetValueOnGameThread() > 0.0f)
		{
			WonderlandBuildMeterBands(*CompanionGlowSampler, Companion, CurveSteps, CompanionGlowBands);
		}
		const FWonderlandMeterDrawPlan Plan = WonderlandMeterDrawPlan(Companion);
		if (Plan.bRemainderVisible)
		{
			const FWonderlandSwooshSample Tip = CompanionSampler->Sample(Plan.RemainderFraction);
			CompanionTip = FVector2D(Tip.X, Tip.Y);
			bCompanionTipVisible = true;
		}
	}
}

void UWonderlandUsageHudWidget::PaintBand(
	const TArray<FVector2D>& Unit,
	const FLinearColor& Colour,
	const FGeometry& AllottedGeometry,
	const FVector2f& ArtOrigin,
	float ArtScale,
	const FVector2f& Offset,
	FSlateWindowElementList& OutDrawElements,
	int32 LayerId) const
{
	// A BAND WITH NOTHING IN IT DRAWS NOTHING, and that is the whole reason the
	// draw plan's flags exist. An unreported remainder, a spent meter and a
	// zero-capacity tier all arrive here as an empty array, so none of them can
	// reach a vertex buffer and become a shape nobody meant to show.
	if (Unit.Num() < 4)
	{
		return;
	}

	// A WINDOW, NOT A SQUASH. The contract crops the unit box to a wide band and
	// says so; one scale for both axes keeps a stroke's thickness meaning one thing.
	const FWonderlandUsageViewport& Window = WonderlandUsageViewport();
	const FSlateRenderTransform& ToRender = AllottedGeometry.GetAccumulatedRenderTransform();
	const FColor Packed = Colour.ToFColor(true);

	TArray<FSlateVertex> Vertices;
	Vertices.Reserve(Unit.Num());
	for (const FVector2D& Point : Unit)
	{
		const FVector2f Local(
			ArtOrigin.X + Offset.X + static_cast<float>(Point.X - Window.X) * ArtScale,
			ArtOrigin.Y + Offset.Y + static_cast<float>(Point.Y - Window.Y) * ArtScale);
		const FVector2f Render = ToRender.TransformPoint(Local);
		FSlateVertex Vertex;
		Vertex.Position[0] = Render.X;
		Vertex.Position[1] = Render.Y;
		Vertex.TexCoords[0] = 0.0f;
		Vertex.TexCoords[1] = 0.0f;
		Vertex.TexCoords[2] = 1.0f;
		Vertex.TexCoords[3] = 1.0f;
		Vertex.Color = Packed;
		Vertices.Add(Vertex);
	}

	// The strip arrives as pairs — left edge, right edge, per step — so the
	// triangles are (n, n+1, n+2) and (n+2, n+1, n+3) and nothing has to work
	// out how to triangulate a ribbon. That arithmetic living in the geometry
	// module rather than here is what keeps two renderers from doing it two
	// different ways.
	TArray<SlateIndex> Indices;
	Indices.Reserve((Vertices.Num() / 2 - 1) * 6);
	for (int32 Pair = 0; Pair + 3 < Vertices.Num(); Pair += 2)
	{
		Indices.Add(Pair);
		Indices.Add(Pair + 1);
		Indices.Add(Pair + 2);
		Indices.Add(Pair + 2);
		Indices.Add(Pair + 1);
		Indices.Add(Pair + 3);
	}

	FSlateDrawElement::MakeCustomVerts(
		OutDrawElements, LayerId, FSlateResourceHandle(), Vertices, Indices, nullptr, 0, 0);
}

void UWonderlandUsageHudWidget::PaintGlint(
	const FVector2f& Centre,
	float Radius,
	const FLinearColor& Colour,
	const FGeometry& AllottedGeometry,
	FSlateWindowElementList& OutDrawElements,
	int32 LayerId) const
{
	if (Radius <= 0.0f)
	{
		return;
	}
	// Two thin diamonds crossed: a tall one and a shorter, wider-set one, which is the four-point star
	// the companion's sparkles are drawn with in the world. Positions leave in render space, as PaintBand's do.
	const FSlateRenderTransform& ToRender = AllottedGeometry.GetAccumulatedRenderTransform();
	const FColor Packed = Colour.ToFColor(true);
	TArray<FSlateVertex> Vertices;
	TArray<SlateIndex> Indices;
	auto AddDiamond = [&](float Along, float Across, bool bVertical)
	{
		const SlateIndex Start = static_cast<SlateIndex>(Vertices.Num());
		const FVector2f Corner[4] = {
			bVertical ? Centre + FVector2f(0.0f, -Along) : Centre + FVector2f(-Along, 0.0f),
			bVertical ? Centre + FVector2f(Across, 0.0f) : Centre + FVector2f(0.0f, -Across),
			bVertical ? Centre + FVector2f(0.0f, Along) : Centre + FVector2f(Along, 0.0f),
			bVertical ? Centre + FVector2f(-Across, 0.0f) : Centre + FVector2f(0.0f, Across),
		};
		for (const FVector2f& Point : Corner)
		{
			const FVector2f Render = ToRender.TransformPoint(Point);
			FSlateVertex Vertex;
			Vertex.Position[0] = Render.X;
			Vertex.Position[1] = Render.Y;
			Vertex.TexCoords[0] = 0.0f;
			Vertex.TexCoords[1] = 0.0f;
			Vertex.TexCoords[2] = 1.0f;
			Vertex.TexCoords[3] = 1.0f;
			Vertex.Color = Packed;
			Vertices.Add(Vertex);
		}
		Indices.Append({ Start, static_cast<SlateIndex>(Start + 1), static_cast<SlateIndex>(Start + 2),
			Start, static_cast<SlateIndex>(Start + 2), static_cast<SlateIndex>(Start + 3) });
	};
	AddDiamond(Radius, Radius * 0.22f, true);
	AddDiamond(Radius * 0.72f, Radius * 0.18f, false);
	FSlateDrawElement::MakeCustomVerts(OutDrawElements, LayerId, FSlateResourceHandle(), Vertices, Indices, nullptr, 0, 0);
}

void UWonderlandUsageHudWidget::PaintText(
	const FString& Text,
	const FSlateFontInfo& Font,
	const FLinearColor& Colour,
	const FVector2f& At,
	const FGeometry& AllottedGeometry,
	FSlateWindowElementList& OutDrawElements,
	int32 LayerId) const
{
	if (Text.IsEmpty())
	{
		return;
	}
	const FVector2f Size(1024.0f, 64.0f);
	FSlateDrawElement::MakeText(OutDrawElements, LayerId,
		AllottedGeometry.ToPaintGeometry(Size, FSlateLayoutTransform(At + FVector2f(0.0f, 1.0f))),
		Text, Font, ESlateDrawEffect::None, FLinearColor(0.0f, 0.0f, 0.0f, 0.7f * Colour.A));
	FSlateDrawElement::MakeText(OutDrawElements, LayerId + 1,
		AllottedGeometry.ToPaintGeometry(Size, FSlateLayoutTransform(At)),
		Text, Font, ESlateDrawEffect::None, Colour);
}

int32 UWonderlandUsageHudWidget::NativePaint(
	const FPaintArgs& Args,
	const FGeometry& AllottedGeometry,
	const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements,
	int32 LayerId,
	const FWidgetStyle& InWidgetStyle,
	bool bParentEnabled) const
{
	const int32 Base = Super::NativePaint(
		Args, AllottedGeometry, MyCullingRect, OutDrawElements, LayerId, InWidgetStyle, bParentEnabled);

	// THE SINGLE AGENT PASSES BEHIND THE COMPOUND ARC, and the order is data
	// rather than a convention this file chose. The palette's `Emphasis` says 0
	// is the dominant frame and lower draws later; the single agent is 1, so it
	// goes down first and the Compound swoop lands on top of it. The white LLM
	// Companion arc is 2 and goes down before both. Every surface reads the same
	// field, so none of them can stack the meters the other way round.
	struct FLayer
	{
		const FWonderlandMeterBands* Bands;
		const FWonderlandUsagePalette* Palette;
		bool bFull;
		bool bCompanion;
	};
	TArray<FLayer, TInlineAllocator<3>> Layers;
	Layers.Add({&SingleBands, &WonderlandSinglePalette(), bSingleFull, false});
	Layers.Add({&CompoundBands, &WonderlandCompoundPalette(), bCompoundFull, false});
	if (bShowCompanionMeter)
	{
		Layers.Add({&CompanionBands, &WonderlandCompanionHud::LlmCompanionPalette(), bCompanionFull, true});
	}
	Layers.StableSort([](const FLayer& A, const FLayer& B) { return A.Palette->Emphasis > B.Palette->Emphasis; });

	// THE LAYOUT, from the web HUD: the art on top at the contract's aspect, the readout
	// directly under it. The readout's height is reserved first so a short widget shrinks
	// the art rather than pushing the words out of view.
	const FVector2f Size = FVector2f(AllottedGeometry.GetLocalSize());
	const FWonderlandUsageViewport& Window = WonderlandUsageViewport();
	// THE PERCENT IS THE READING, so it is the largest thing in the readout (founder, 2026-09-13: the
	// 17 px figures were correct but too small to read over the bright world). Three rows share the
	// height two had, so each row and its percent step down a little rather than shrinking the art.
	const int32 RowCount = bShowCompanionMeter ? 3 : 2;
	const FSlateFontInfo LabelFont = WonderlandUi::Sans(12, true, 150);
	const FSlateFontInfo FigureFont = WonderlandUi::Mono(10);
	const FSlateFontInfo PercentFont = WonderlandUi::Sans(bShowCompanionMeter ? 28 : 30, true, 30);
	const FSlateFontInfo NoteFont = WonderlandUi::Sans(9, false, 110);
	const float RowHeight = bShowCompanionMeter ? 38.0f : 42.0f;
	const float PercentLift = bShowCompanionMeter ? 41.0f : 44.0f;
	const float LabelLift = bShowCompanionMeter ? 20.0f : 21.0f;
	const float NoteHeight = 17.0f;
	const int32 Notes = (ProvenanceLine.IsEmpty() ? 0 : 1) + (ReasonLine.IsEmpty() ? 0 : 1);
	const float ReadoutHeight = RowHeight * static_cast<float>(RowCount) + 6.0f + NoteHeight * 2.0f;
	const float ArtScale = (Window.Width > 0.0 && Window.Height > 0.0)
		? FMath::Min(Size.X / static_cast<float>(Window.Width), FMath::Max(Size.Y - ReadoutHeight, 1.0f) / static_cast<float>(Window.Height))
		: 0.0f;
	const FVector2f ArtOrigin(0.0f, 0.0f);
	const float ArtWidth = static_cast<float>(Window.Width) * ArtScale;
	const float ArtHeight = static_cast<float>(Window.Height) * ArtScale;
	const float ReadoutTop = FMath::Max(ArtHeight - 12.0f, 0.0f);
	const float Right = FMath::Max(ArtWidth, 260.0f);
	const float Bottom = ReadoutTop + RowHeight * static_cast<float>(RowCount) + 6.0f + NoteHeight * static_cast<float>(Notes);

	// A SOFT DARK GROUND, NOT A PANEL. Wonderland is ivory stone and bright sky, and a pale
	// ring with small type over it reads as nothing. Stacked, feathered rounded fields build a
	// shadow with no hard edge, so the instrument stays a swoosh on the world rather than a box
	// in front of it.
	static const FSlateRoundedBoxBrush Ground(FLinearColor::White, 26.0f);
	int32 Layer = Base;
	const FVector2f GroundOrigin(-16.0f, -12.0f);
	const FVector2f GroundSize(Right + 34.0f, Bottom + 26.0f);
	++Layer;
	for (int32 Ring = 0; Ring < 5; ++Ring)
	{
		const float Grow = static_cast<float>(4 - Ring) * 7.0f;
		FSlateDrawElement::MakeBox(OutDrawElements, Layer,
			AllottedGeometry.ToPaintGeometry(GroundSize + FVector2f(Grow * 2.0f, Grow * 2.0f),
				FSlateLayoutTransform(GroundOrigin - FVector2f(Grow, Grow))),
			&Ground, ESlateDrawEffect::None, FLinearColor(0.02f, 0.03f, 0.05f, 0.075f));
	}

	// A SHADOW UNDER THE FRAME, the lift the web HUD gets from its drop-shadow filter.
	const FVector2f ShadowOffset(1.5f, 3.5f);
	const FLinearColor Shadow(0.0f, 0.0f, 0.0f, 0.38f);
	for (const FLayer& Entry : Layers)
	{
		PaintBand(Entry.Bands->Track, Shadow, AllottedGeometry, ArtOrigin, ArtScale, ShadowOffset, OutDrawElements, ++Layer);
	}
	for (const FLayer& Entry : Layers)
	{
		if (Entry.bCompanion)
		{
			// UNDER THE WHITE: a cool glow, then a dark hairline one step wider than the ribbon. White on
			// ivory stone and white cloud has no edge of its own; these give it one on any ground.
			PaintBand(CompanionGlowBands.Remainder, Entry.Palette->Glow, AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
			PaintBand(CompanionEdgeBands.Track, FLinearColor(0.010f, 0.016f, 0.030f, 0.30f), AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
			PaintBand(CompanionEdgeBands.Remainder, FLinearColor(0.010f, 0.016f, 0.030f, 0.46f), AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
		}
		// Track, then remainder, then head — back to front within one meter, so
		// the leading edge is never buried under the track it sits on. A full meter
		// paints no head: its stroke is one colour from end to end.
		PaintBand(Entry.Bands->Track, Entry.Palette->Track, AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
		PaintBand(Entry.Bands->Remainder, Entry.Palette->Accent, AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
		if (!Entry.bFull)
		{
			PaintBand(Entry.Bands->Head, Entry.Palette->Bright, AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
		}
	}
	if (bShowCompanionMeter && bCompanionTipVisible)
	{
		const FVector2f Tip(
			ArtOrigin.X + static_cast<float>(CompanionTip.X - Window.X) * ArtScale,
			ArtOrigin.Y + static_cast<float>(CompanionTip.Y - Window.Y) * ArtScale);
		const float GlintRadius = CVarCompanionGlint.GetValueOnGameThread();
		PaintGlint(Tip + FVector2f(1.0f, 2.0f), GlintRadius * 1.15f, FLinearColor(0.0f, 0.02f, 0.05f, 0.35f), AllottedGeometry, OutDrawElements, ++Layer);
		PaintGlint(Tip, GlintRadius, FLinearColor(1.0f, 1.0f, 1.0f, 0.98f), AllottedGeometry, OutDrawElements, ++Layer);
	}

	// THE READOUT, UNDER THE ART. The dominant channel is named first; each label wears its channel's hue.
	const TSharedRef<FSlateFontMeasure> Measure = FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
	const FLinearColor Figure(0.933f, 0.957f, 1.0f, 1.0f);
	float Y = ReadoutTop;
	struct FRow
	{
		const TCHAR* Label;
		FString Named;
		const FString* Value;
		const FString* Percent;
		const FWonderlandUsagePalette* Palette;
	};
	// WHO EACH ROW IS, not merely what kind of thing it is (founder, 2026-09-24): "COMPOUND AGENT: <user-created
	// name>", "SINGLE AGENT: <active coding agent, e.g. Claude Code>", "LLM COMPANION: <active companion, e.g.
	// ChatGPT>". Read from the settings the rest of Wonderland already names these by, so the HUD, the companion
	// terminals and the world all say the same thing without a second vocabulary to keep honest.
	const UWonderlandCompanionPreviewSettings* Named = GetDefault<UWonderlandCompanionPreviewSettings>();
	TArray<FRow, TInlineAllocator<3>> Rows;
	Rows.Add({CompoundLabel, Named != nullptr ? Named->CompoundAgentName : FString(),
			  &CompoundFigure, &CompoundPercent, &WonderlandCompoundPalette()});
	Rows.Add({SingleLabel, Named != nullptr ? Named->AgentName : FString(),
			  &SingleFigure, &SinglePercent, &WonderlandSinglePalette()});
	if (bShowCompanionMeter)
	{
		Rows.Add({CompanionLabel, Named != nullptr ? Named->LlmCompanionName : FString(),
				  &CompanionFigure, &CompanionPercent, &WonderlandCompanionHud::LlmCompanionPalette()});
	}
	// RECORDED AS IT IS DRAWN. NativePaint is const because Slate paints are, so the write is cast -- kept to
	// this one diagnostic line, and touching nothing the widget draws from.
	TArray<FString>& Painted = const_cast<UWonderlandUsageHudWidget*>(this)->PaintedAgentRows;
	Painted.Reset();
	++Layer;
	for (const FRow& Row : Rows)
	{
		// LABEL left in the channel's hue; the PERCENT right, large, in the channel's bright tone, so
		// each arc's fullness reads at a glance; the unit figure small beside it, and only when the
		// units are real usage (a development preview's 100 units are not).
		const float BaseLine = Y + RowHeight - LabelLift;
		PaintText(Row.Label, LabelFont, Row.Palette->Accent, FVector2f(2.0f, BaseLine + 1.0f), AllottedGeometry, OutDrawElements, Layer);
		// The name follows its label, dimmer, so the kind still reads first and the identity second.
		if (!Row.Named.IsEmpty())
		{
			const float LabelWidth = static_cast<float>(Measure->Measure(Row.Label, LabelFont).X);
			const FLinearColor Quiet(Row.Palette->Accent.R, Row.Palette->Accent.G, Row.Palette->Accent.B, 0.72f);
			PaintText(FString::Printf(TEXT("  %s"), *Row.Named), LabelFont, Quiet,
					  FVector2f(2.0f + LabelWidth, BaseLine + 1.0f), AllottedGeometry, OutDrawElements, Layer);
		}
		// After both glyph runs, so an entry here means the label went down and reports whether a name went
		// with it. An unnamed row records as "LABEL|" rather than going missing, which is the state a proof
		// most needs to be able to see.
		Painted.Add(FString::Printf(TEXT("%s|%s"), Row.Label, *Row.Named));
		float ValueRight = Right;
		if (!Row.Percent->IsEmpty())
		{
			const float PercentWidth = static_cast<float>(Measure->Measure(*Row.Percent, PercentFont).X);
			// A darker halo first, so a large figure holds its edge against ivory stone and white cloud.
			const FVector2f At(Right - PercentWidth, Y + RowHeight - PercentLift);
			for (const FVector2f& Halo : {FVector2f(-1.5f, 0.0f), FVector2f(1.5f, 0.0f), FVector2f(0.0f, -1.5f), FVector2f(0.0f, 2.5f)})
			{
				PaintText(*Row.Percent, PercentFont, FLinearColor(0.0f, 0.02f, 0.04f, 0.55f), At + Halo, AllottedGeometry, OutDrawElements, Layer);
			}
			PaintText(*Row.Percent, PercentFont, Row.Palette->Bright, At, AllottedGeometry, OutDrawElements, Layer + 2);
			ValueRight = Right - PercentWidth - 12.0f;
		}
		if (!bPreviewReading || Row.Percent->IsEmpty())
		{
			const float ValueWidth = static_cast<float>(Measure->Measure(*Row.Value, FigureFont).X);
			PaintText(*Row.Value, FigureFont, FLinearColor(Figure.R, Figure.G, Figure.B, 0.72f), FVector2f(ValueRight - ValueWidth, BaseLine + 1.0f), AllottedGeometry, OutDrawElements, Layer);
		}
		Y += RowHeight;
	}
	Y += 6.0f;
	PaintText(ProvenanceLine, NoteFont, FLinearColor(0.913f, 0.941f, 1.0f, 0.82f), FVector2f(2.0f, Y), AllottedGeometry, OutDrawElements, Layer);
	Y += ProvenanceLine.IsEmpty() ? 0.0f : NoteHeight;
	PaintText(ReasonLine, NoteFont, FLinearColor(0.913f, 0.941f, 1.0f, 0.66f), FVector2f(2.0f, Y), AllottedGeometry, OutDrawElements, Layer);
	Layer += 4;   // the percent figures paint up to Layer + 3

	return Layer;
}
