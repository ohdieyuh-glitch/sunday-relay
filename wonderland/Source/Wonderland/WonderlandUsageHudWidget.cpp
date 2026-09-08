#include "WonderlandUsageHudWidget.h"

#include "Engine/GameInstance.h"
#include "Rendering/DrawElements.h"
#include "WonderlandUsageSubsystem.h"

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

	const FVector2D Size = AllottedGeometry.GetLocalSize();
	const FWonderlandUsageViewport& Window = WonderlandUsageViewport();

	// A WINDOW, NOT A SQUASH. The contract crops the unit box to a wide band and
	// says so; scaling each axis independently would stretch the swoosh to
	// whatever aspect the widget happened to have and make a stroke's thickness
	// mean two different things in two directions. One scale, chosen so the
	// window fits, and the drawing is centred in what is left.
	const float ScaleX = Window.Width > 0.f ? Size.X / Window.Width : 0.f;
	const float ScaleY = Window.Height > 0.f ? Size.Y / Window.Height : 0.f;
	const float Scale = FMath::Min(ScaleX, ScaleY);
	const float OffsetX = (Size.X - Window.Width * Scale) * 0.5f;
	const float OffsetY = (Size.Y - Window.Height * Scale) * 0.5f;

	TArray<FSlateVertex> Vertices;
	Vertices.Reserve(Unit.Num());
	for (const FVector2D& Point : Unit)
	{
		FSlateVertex Vertex;
		Vertex.Position[0] = OffsetX + static_cast<float>(Point.X - Window.X) * Scale;
		Vertex.Position[1] = OffsetY + static_cast<float>(Point.Y - Window.Y) * Scale;
		Vertex.Color = Colour.ToFColor(false);
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

	int32 Layer = Base;
	for (const FLayer& Entry : Layers)
	{
		// Track, then remainder, then head — back to front within one meter, so
		// the leading edge is never buried under the track it sits on.
		PaintBand(Entry.Bands->Track, Entry.Palette->Track, AllottedGeometry, OutDrawElements, ++Layer);
		PaintBand(Entry.Bands->Remainder, Entry.Palette->Accent, AllottedGeometry, OutDrawElements, ++Layer);
		PaintBand(Entry.Bands->Head, Entry.Palette->Bright, AllottedGeometry, OutDrawElements, ++Layer);
	}

	return Layer;
}
