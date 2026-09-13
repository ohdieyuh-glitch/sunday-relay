#include "WonderlandUsageHudWidget.h"

#include "Engine/GameInstance.h"
#include "Fonts/FontMeasure.h"
#include "Framework/Application/SlateApplication.h"
#include "Rendering/DrawElements.h"
#include "Rendering/SlateRenderer.h"
#include "Styling/SlateTypes.h"
#include "Brushes/SlateRoundedBoxBrush.h"
#include "WonderlandUiStyle.h"
#include "WonderlandUsagePreview.h"
#include "WonderlandUsageSubsystem.h"

namespace
{
	// THE WORDS ARE THE WEB HUD'S WORDS (src/relay/ui/wonderland-hud/WonderlandUsageHudView.tsx),
	// and the channel labels are WONDERLAND_USAGE_CHANNEL_STYLE's. A second vocabulary for the
	// same reading on the second surface would be a second thing to keep honest.
	const TCHAR* const CompoundLabel = TEXT("COMPOUND AGENT");
	const TCHAR* const SingleLabel = TEXT("SINGLE AGENT");

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

	bool IsPreview(const FWonderlandUsageAuthorityStatus& Authority)
	{
		return Authority.AuthorityId.bKnown && Authority.AuthorityId.Value == WonderlandUsagePreview::AuthorityId;
	}

	/** The authority's own word outranks the provenance line, as on the web. Empty for a current real reading. */
	FString ProvenanceText(const FWonderlandUsageHud& Hud, const FWonderlandUsageAuthorityStatus& Authority)
	{
		if (IsPreview(Authority))
		{
			return TEXT("DEVELOPMENT PREVIEW \u00B7 NOT JULIUS USAGE");
		}
		switch (Authority.Reading)
		{
		case EWonderlandUsageReading::NotReported: return TEXT("NO USAGE AUTHORITY REPORTING");
		case EWonderlandUsageReading::Stale: return TEXT("STALE \u00B7 LAST REPORTED FIGURES");
		case EWonderlandUsageReading::Unavailable: return TEXT("USAGE AUTHORITY UNAVAILABLE");
		default: break;
		}
		return (Hud.CompoundAgent.bSimulated || Hud.SingleAgent.bSimulated)
			? FString(TEXT("SIMULATED \u00B7 NO USAGE AUTHORITY REPORTING"))
			: FString();
	}
}

void UWonderlandUsageHudWidget::NativeConstruct()
{
	Super::NativeConstruct();

	// The samplers are built once and never rebuilt. The shapes are frozen; only
	// how far along them to walk moves.
	CompoundSampler = MakeUnique<FWonderlandSwooshSampler>(WonderlandCompoundSwoosh());
	SingleSampler = MakeUnique<FWonderlandSwooshSampler>(WonderlandSingleSwoosh());

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

void UWonderlandUsageHudWidget::RebuildBands()
{
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
	// goes down first and the Compound swoop lands on top of it. Both surfaces
	// read the same field, so neither can stack them the other way round.
	struct FLayer
	{
		const FWonderlandMeterBands* Bands;
		const FWonderlandUsagePalette* Palette;
	};
	FLayer Layers[] = {
		{&SingleBands, &WonderlandSinglePalette()},
		{&CompoundBands, &WonderlandCompoundPalette()},
	};
	if (Layers[0].Palette->Emphasis < Layers[1].Palette->Emphasis)
	{
		Swap(Layers[0], Layers[1]);
	}

	// THE LAYOUT, from the web HUD: the art on top at the contract's aspect, the readout
	// directly under it. The readout's height is reserved first so a short widget shrinks
	// the art rather than pushing the words out of view.
	const FVector2f Size = FVector2f(AllottedGeometry.GetLocalSize());
	const FWonderlandUsageViewport& Window = WonderlandUsageViewport();
	const FSlateFontInfo LabelFont = WonderlandUi::Sans(10, true, 150);
	const FSlateFontInfo FigureFont = WonderlandUi::Mono(10);
	const FSlateFontInfo PercentFont = WonderlandUi::Sans(17, true, 40);
	const FSlateFontInfo NoteFont = WonderlandUi::Sans(8, false, 110);
	const float RowHeight = 27.0f;
	const float NoteHeight = 15.0f;
	const int32 Notes = (ProvenanceLine.IsEmpty() ? 0 : 1) + (ReasonLine.IsEmpty() ? 0 : 1);
	const float ReadoutHeight = RowHeight * 2.0f + 6.0f + NoteHeight * 2.0f;
	const float ArtScale = (Window.Width > 0.0 && Window.Height > 0.0)
		? FMath::Min(Size.X / static_cast<float>(Window.Width), FMath::Max(Size.Y - ReadoutHeight, 1.0f) / static_cast<float>(Window.Height))
		: 0.0f;
	const FVector2f ArtOrigin(0.0f, 0.0f);
	const float ArtWidth = static_cast<float>(Window.Width) * ArtScale;
	const float ArtHeight = static_cast<float>(Window.Height) * ArtScale;
	const float ReadoutTop = FMath::Max(ArtHeight - 12.0f, 0.0f);
	const float Right = FMath::Max(ArtWidth, 260.0f);
	const float Bottom = ReadoutTop + RowHeight * 2.0f + 6.0f + NoteHeight * static_cast<float>(Notes);

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
		// Track, then remainder, then head — back to front within one meter, so
		// the leading edge is never buried under the track it sits on.
		PaintBand(Entry.Bands->Track, Entry.Palette->Track, AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
		PaintBand(Entry.Bands->Remainder, Entry.Palette->Accent, AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
		PaintBand(Entry.Bands->Head, Entry.Palette->Bright, AllottedGeometry, ArtOrigin, ArtScale, FVector2f::ZeroVector, OutDrawElements, ++Layer);
	}

	// THE READOUT. The dominant channel is named first; each label wears its channel's hue.
	const TSharedRef<FSlateFontMeasure> Measure = FSlateApplication::Get().GetRenderer()->GetFontMeasureService();
	const FLinearColor Figure(0.933f, 0.957f, 1.0f, 1.0f);
	float Y = ReadoutTop;
	struct FRow
	{
		const TCHAR* Label;
		const FString* Value;
		const FString* Percent;
		const FWonderlandUsagePalette* Palette;
	};
	const FRow Rows[] = {
		{CompoundLabel, &CompoundFigure, &CompoundPercent, &WonderlandCompoundPalette()},
		{SingleLabel, &SingleFigure, &SinglePercent, &WonderlandSinglePalette()},
	};
	++Layer;
	for (const FRow& Row : Rows)
	{
		// LABEL left in the channel's hue; the PERCENT right, large, in the channel's bright tone, so
		// each arc's fullness reads at a glance; the unit figure small beside it, and only when the
		// units are real usage (a development preview's 100 units are not).
		const float BaseLine = Y + RowHeight - 17.0f;
		PaintText(Row.Label, LabelFont, Row.Palette->Accent, FVector2f(2.0f, BaseLine + 1.0f), AllottedGeometry, OutDrawElements, Layer);
		float ValueRight = Right;
		if (!Row.Percent->IsEmpty())
		{
			const float PercentWidth = static_cast<float>(Measure->Measure(*Row.Percent, PercentFont).X);
			PaintText(*Row.Percent, PercentFont, Row.Palette->Bright, FVector2f(Right - PercentWidth, Y + RowHeight - 29.0f), AllottedGeometry, OutDrawElements, Layer);
			ValueRight = Right - PercentWidth - 10.0f;
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
	Layer += 2;

	return Layer;
}
