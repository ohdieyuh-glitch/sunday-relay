#include "WonderlandBrainIcon.h"

#include "Rendering/DrawElements.h"

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderlandBrainGlyphs
{
	using FStroke = TArray<FVector2f>;

	void Arc(TArray<FStroke>& Out, float Cx, float Cy, float R, float FromDeg, float ToDeg, int32 Steps = 18)
	{
		FStroke Stroke;
		for (int32 Step = 0; Step <= Steps; ++Step)
		{
			const float A = FMath::DegreesToRadians(FMath::Lerp(FromDeg, ToDeg, static_cast<float>(Step) / static_cast<float>(Steps)));
			Stroke.Add(FVector2f(Cx + FMath::Cos(A) * R, Cy + FMath::Sin(A) * R));
		}
		Out.Add(MoveTemp(Stroke));
	}

	void Line(TArray<FStroke>& Out, std::initializer_list<FVector2f> Points)
	{
		Out.Add(FStroke(Points));
	}

	void Box(TArray<FStroke>& Out, float X, float Y, float W, float H)
	{
		Line(Out, {{X, Y}, {X + W, Y}, {X + W, Y + H}, {X, Y + H}, {X, Y}});
	}

	/** The strokes of one glyph in a 0..1 box, y down. */
	TArray<FStroke> Strokes(EWonderlandBrainGlyph Glyph)
	{
		TArray<FStroke> S;
		switch (Glyph)
		{
		case EWonderlandBrainGlyph::Folder:
			Line(S, {{0.08f, 0.26f}, {0.40f, 0.26f}, {0.48f, 0.36f}, {0.92f, 0.36f}, {0.92f, 0.82f}, {0.08f, 0.82f}, {0.08f, 0.26f}});
			Line(S, {{0.08f, 0.44f}, {0.92f, 0.44f}});
			break;
		case EWonderlandBrainGlyph::File:
			Line(S, {{0.14f, 0.24f}, {0.42f, 0.24f}, {0.50f, 0.34f}, {0.86f, 0.34f}, {0.86f, 0.80f}, {0.14f, 0.80f}, {0.14f, 0.24f}});
			break;
		case EWonderlandBrainGlyph::Person:
			Arc(S, 0.5f, 0.32f, 0.16f, 0.0f, 360.0f);
			Arc(S, 0.5f, 0.92f, 0.34f, 200.0f, 340.0f);
			break;
		case EWonderlandBrainGlyph::Clock:
			Arc(S, 0.5f, 0.5f, 0.38f, 0.0f, 360.0f, 28);
			Line(S, {{0.5f, 0.28f}, {0.5f, 0.52f}, {0.66f, 0.60f}});
			break;
		case EWonderlandBrainGlyph::Gear:
			Arc(S, 0.5f, 0.5f, 0.14f, 0.0f, 360.0f);
			{
				FStroke Teeth;
				for (int32 Tooth = 0; Tooth <= 16; ++Tooth)
				{
					const float A = FMath::DegreesToRadians(22.5f * Tooth);
					const float R = (Tooth % 2 == 0) ? 0.40f : 0.30f;
					Teeth.Add(FVector2f(0.5f + FMath::Cos(A) * R, 0.5f + FMath::Sin(A) * R));
				}
				S.Add(MoveTemp(Teeth));
			}
			break;
		case EWonderlandBrainGlyph::Layers:
			for (int32 Layer = 0; Layer < 3; ++Layer)
			{
				const float Y = 0.30f + 0.18f * Layer;
				Line(S, {{0.10f, Y}, {0.50f, Y - 0.14f}, {0.90f, Y}, {0.50f, Y + 0.14f}, {0.10f, Y}});
			}
			break;
		case EWonderlandBrainGlyph::Document:
			Line(S, {{0.22f, 0.10f}, {0.62f, 0.10f}, {0.80f, 0.28f}, {0.80f, 0.90f}, {0.22f, 0.90f}, {0.22f, 0.10f}});
			Line(S, {{0.34f, 0.46f}, {0.68f, 0.46f}});
			Line(S, {{0.34f, 0.60f}, {0.68f, 0.60f}});
			Line(S, {{0.34f, 0.74f}, {0.58f, 0.74f}});
			break;
		case EWonderlandBrainGlyph::Nodes:
			Arc(S, 0.5f, 0.20f, 0.09f, 0.0f, 360.0f, 12);
			Arc(S, 0.20f, 0.78f, 0.09f, 0.0f, 360.0f, 12);
			Arc(S, 0.80f, 0.78f, 0.09f, 0.0f, 360.0f, 12);
			Line(S, {{0.45f, 0.28f}, {0.25f, 0.70f}});
			Line(S, {{0.55f, 0.28f}, {0.75f, 0.70f}});
			Line(S, {{0.30f, 0.78f}, {0.70f, 0.78f}});
			break;
		case EWonderlandBrainGlyph::Sparkle:
			Line(S, {{0.42f, 0.08f}, {0.50f, 0.42f}, {0.84f, 0.50f}, {0.50f, 0.58f}, {0.42f, 0.92f}, {0.34f, 0.58f}, {0.02f, 0.50f}, {0.34f, 0.42f}, {0.42f, 0.08f}});
			Line(S, {{0.80f, 0.10f}, {0.80f, 0.30f}});
			Line(S, {{0.70f, 0.20f}, {0.90f, 0.20f}});
			break;
		case EWonderlandBrainGlyph::Arrows:
			Line(S, {{0.12f, 0.36f}, {0.86f, 0.36f}});
			Line(S, {{0.70f, 0.20f}, {0.86f, 0.36f}, {0.70f, 0.52f}});
			Line(S, {{0.88f, 0.66f}, {0.14f, 0.66f}});
			Line(S, {{0.30f, 0.50f}, {0.14f, 0.66f}, {0.30f, 0.82f}});
			break;
		case EWonderlandBrainGlyph::Pulse:
			Line(S, {{0.04f, 0.54f}, {0.30f, 0.54f}, {0.40f, 0.26f}, {0.52f, 0.80f}, {0.62f, 0.40f}, {0.70f, 0.54f}, {0.96f, 0.54f}});
			break;
		case EWonderlandBrainGlyph::People:
			Arc(S, 0.36f, 0.34f, 0.13f, 0.0f, 360.0f);
			Arc(S, 0.66f, 0.30f, 0.11f, 0.0f, 360.0f);
			Arc(S, 0.36f, 0.94f, 0.28f, 200.0f, 340.0f);
			Arc(S, 0.68f, 0.84f, 0.24f, 220.0f, 330.0f);
			break;
		case EWonderlandBrainGlyph::Feather:
			Line(S, {{0.16f, 0.88f}, {0.84f, 0.14f}});
			Line(S, {{0.84f, 0.14f}, {0.62f, 0.62f}, {0.30f, 0.72f}});
			Line(S, {{0.84f, 0.14f}, {0.40f, 0.36f}, {0.30f, 0.72f}});
			break;
		case EWonderlandBrainGlyph::Code:
			Line(S, {{0.34f, 0.26f}, {0.10f, 0.50f}, {0.34f, 0.74f}});
			Line(S, {{0.66f, 0.26f}, {0.90f, 0.50f}, {0.66f, 0.74f}});
			Line(S, {{0.56f, 0.18f}, {0.44f, 0.82f}});
			break;
		case EWonderlandBrainGlyph::Magnifier:
			Arc(S, 0.42f, 0.42f, 0.28f, 0.0f, 360.0f, 24);
			Line(S, {{0.62f, 0.62f}, {0.90f, 0.90f}});
			break;
		case EWonderlandBrainGlyph::Lock:
			Box(S, 0.20f, 0.46f, 0.60f, 0.44f);
			Arc(S, 0.5f, 0.46f, 0.20f, 180.0f, 360.0f, 12);
			Line(S, {{0.5f, 0.62f}, {0.5f, 0.74f}});
			break;
		case EWonderlandBrainGlyph::Target:
			Arc(S, 0.5f, 0.5f, 0.40f, 0.0f, 360.0f, 28);
			Arc(S, 0.5f, 0.5f, 0.22f, 0.0f, 360.0f, 20);
			Arc(S, 0.5f, 0.5f, 0.05f, 0.0f, 360.0f, 8);
			break;
		case EWonderlandBrainGlyph::Shield:
			Line(S, {{0.5f, 0.08f}, {0.86f, 0.22f}, {0.82f, 0.58f}, {0.5f, 0.92f}, {0.18f, 0.58f}, {0.14f, 0.22f}, {0.5f, 0.08f}});
			break;
		case EWonderlandBrainGlyph::Check:
			Arc(S, 0.5f, 0.5f, 0.40f, 0.0f, 360.0f, 28);
			Line(S, {{0.30f, 0.52f}, {0.44f, 0.66f}, {0.72f, 0.36f}});
			break;
		case EWonderlandBrainGlyph::Link:
			Arc(S, 0.36f, 0.64f, 0.18f, 45.0f, 315.0f, 16);
			Arc(S, 0.64f, 0.36f, 0.18f, 225.0f, 495.0f, 16);
			Line(S, {{0.40f, 0.60f}, {0.60f, 0.40f}});
			break;
		case EWonderlandBrainGlyph::Brain:
			Arc(S, 0.38f, 0.40f, 0.26f, 110.0f, 340.0f, 18);
			Arc(S, 0.62f, 0.40f, 0.26f, 200.0f, 430.0f, 18);
			Arc(S, 0.5f, 0.62f, 0.30f, 20.0f, 160.0f, 14);
			Line(S, {{0.5f, 0.18f}, {0.5f, 0.86f}});
			break;
		case EWonderlandBrainGlyph::Agent:
			// A hexagon holding a smaller one: the Compound Agent and the agents it holds.
			for (float R : {0.40f, 0.18f})
			{
				FStroke Hex;
				for (int32 Corner = 0; Corner <= 6; ++Corner)
				{
					const float A = FMath::DegreesToRadians(-90.0f + 60.0f * Corner);
					Hex.Add(FVector2f(0.5f + FMath::Cos(A) * R, 0.5f + FMath::Sin(A) * R));
				}
				S.Add(MoveTemp(Hex));
			}
			break;
		case EWonderlandBrainGlyph::Missions:
			// A contract on a board: the clipboard of the reference, with its clip and its lines.
			Line(S, {{0.22f, 0.18f}, {0.78f, 0.18f}, {0.78f, 0.90f}, {0.22f, 0.90f}, {0.22f, 0.18f}});
			Line(S, {{0.38f, 0.10f}, {0.62f, 0.10f}, {0.62f, 0.24f}, {0.38f, 0.24f}, {0.38f, 0.10f}});
			Line(S, {{0.34f, 0.44f}, {0.40f, 0.50f}, {0.50f, 0.38f}});
			Line(S, {{0.56f, 0.44f}, {0.68f, 0.44f}});
			Line(S, {{0.34f, 0.64f}, {0.40f, 0.70f}, {0.50f, 0.58f}});
			Line(S, {{0.56f, 0.64f}, {0.68f, 0.64f}});
			break;
		case EWonderlandBrainGlyph::Commands:
			// Three rails with a knob set on each: presets are arrangements, and a slider reads as one.
			Line(S, {{0.12f, 0.28f}, {0.88f, 0.28f}});
			Line(S, {{0.12f, 0.50f}, {0.88f, 0.50f}});
			Line(S, {{0.12f, 0.72f}, {0.88f, 0.72f}});
			Arc(S, 0.34f, 0.28f, 0.07f, 0.0f, 360.0f, 12);
			Arc(S, 0.66f, 0.50f, 0.07f, 0.0f, 360.0f, 12);
			Arc(S, 0.44f, 0.72f, 0.07f, 0.0f, 360.0f, 12);
			break;
		case EWonderlandBrainGlyph::Menu:
			Line(S, {{0.16f, 0.28f}, {0.84f, 0.28f}});
			Line(S, {{0.16f, 0.50f}, {0.84f, 0.50f}});
			Line(S, {{0.16f, 0.72f}, {0.84f, 0.72f}});
			break;
		case EWonderlandBrainGlyph::Wallet:
			// A wallet body with its flap and clasp: read at a glance, and never a coin or a currency sign, because the
			// HUD must not suggest what kind of money it holds.
			Line(S, {{0.12f, 0.30f}, {0.80f, 0.30f}, {0.80f, 0.84f}, {0.12f, 0.84f}, {0.12f, 0.30f}});
			Line(S, {{0.12f, 0.30f}, {0.64f, 0.14f}, {0.70f, 0.30f}});
			Line(S, {{0.58f, 0.48f}, {0.90f, 0.48f}, {0.90f, 0.68f}, {0.58f, 0.68f}, {0.58f, 0.48f}});
			Arc(S, 0.68f, 0.58f, 0.03f, 0.0f, 360.0f, 8);
			break;
		}
		return S;
	}
}

void SWonderlandBrainIcon::Construct(const FArguments& InArgs)
{
	Glyph = InArgs._Glyph;
	Size = InArgs._Size;
	Color = InArgs._Color;
	Thickness = InArgs._Thickness;
}

FVector2D SWonderlandBrainIcon::ComputeDesiredSize(float) const
{
	return FVector2D(Size, Size);
}

int32 SWonderlandBrainIcon::OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
	FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const
{
	const FVector2f Local(AllottedGeometry.GetLocalSize());
	const float Extent = FMath::Min(Local.X, Local.Y);
	const FVector2f Origin = (Local - FVector2f(Extent, Extent)) * 0.5f;
	const FLinearColor Tint = Color * InWidgetStyle.GetColorAndOpacityTint();
	for (const WonderlandBrainGlyphs::FStroke& Unit : WonderlandBrainGlyphs::Strokes(Glyph))
	{
		TArray<FVector2f> Points;
		Points.Reserve(Unit.Num());
		for (const FVector2f& Point : Unit)
		{
			Points.Add(Origin + Point * Extent);
		}
		// A soft wide pass under the stroke: the frame's icons glow slightly past their edges.
		FSlateDrawElement::MakeLines(OutDrawElements, LayerId, AllottedGeometry.ToPaintGeometry(), Points,
			ESlateDrawEffect::None, Tint.CopyWithNewOpacity(Tint.A * 0.22f), true, Thickness * 2.6f);
		FSlateDrawElement::MakeLines(OutDrawElements, LayerId + 1, AllottedGeometry.ToPaintGeometry(), Points,
			ESlateDrawEffect::None, Tint, true, Thickness);
	}
	return LayerId + 1;
}
