#include "WonderlandProjectBrainPanel.h"
#include "WonderlandCardCapabilities.h"
#include "WonderlandCardDirector.h"

#include "Framework/Application/SlateApplication.h"
#include "HAL/IConsoleManager.h"
#include "Rendering/DrawElements.h"
#include "Styling/CoreStyle.h"
#include "Widgets/Images/SImage.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SBox.h"
#include "Widgets/Layout/SConstraintCanvas.h"
#include "Widgets/Layout/SScaleBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Layout/SSpacer.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/SLeafWidget.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandBrainIcon.h"
#include "WonderlandUiStyle.h"
#include "WonderlandMascotStyle.h"

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderlandBrainLook
{
	// The frame's palette: deep navy, blue-violet light, cool white type.
	// ---- A WHITE PROJECT BRAIN (founder, 2026-09-25): "the whole project brain UI is white with black snow".
	//
	// The panel was a night field: a near-black ground with near-white text on it. Every name below keeps its
	// ROLE and swaps its value, so the hundreds of call sites throughout this file did not have to move -- Ink
	// is still "the text colour", Night is still "the ground", and they are simply the other way up now.
	//
	// THE ONE THING THAT STAYS DARK is the Wardrobe preview square, which the founder has now said twice:
	// "Do NOT make the whole Project Brain black. Only the Wardrobe preview square is black." It is drawn
	// from SkinPanelSolidBrush further down and is deliberately left as it was.
	// NAMED FOR ITS OWN PANEL, and it has to be.
	//
	// WonderWebLook declares an Ink() of its own in a HEADER, and two files in this module carry
	// `using namespace WonderWebLook;` at FILE scope -- so whenever the unity build happens to place this
	// file after one of them, every Ink() here becomes ambiguous and the module stops compiling. Nothing
	// about this file changed to cause that; the adaptive unity grouping did, which means it can happen
	// again to anyone. A name that cannot collide is cheaper than a build that fails by arrangement.
	FLinearColor BrainInk(float A = 1.0f) { return WonderlandUi::Srgb(0x14, 0x16, 0x24, A); }
	FLinearColor Mist(float A = 1.0f) { return WonderlandUi::Srgb(0x55, 0x5C, 0x78, A); }
	FLinearColor Violet(float A = 1.0f) { return WonderlandUi::Srgb(0x5A, 0x44, 0xC8, A); }
	FLinearColor Beam(float A = 1.0f) { return WonderlandUi::Srgb(0x35, 0x49, 0xC0, A); }
	FLinearColor Night(float A = 1.0f) { return WonderlandUi::Srgb(0xF7, 0xF7, 0xFB, A); }

	/** C.A.R.D.'s three words, as colours that read on the white panel: ready, a person can fix it, cannot be used from here. */
	FLinearColor CardStatusColour(EWonderlandCardStatus Status)
	{
		switch (Status)
		{
		case EWonderlandCardStatus::Ready:        return WonderlandUi::Srgb(0x1F, 0x9D, 0x5B);
		case EWonderlandCardStatus::Unconfigured: return WonderlandUi::Srgb(0xC9, 0x8A, 0x10);
		default:                                  return WonderlandUi::Srgb(0xC6, 0x3B, 0x3B);
		}
	}

	/** The worst of a set: one reference that cannot be used colours the whole tile; none at all is quiet. */
	FLinearColor CardWorstColour(const TArray<FWonderlandCardViewRef>& Refs)
	{
		if (Refs.Num() == 0)
		{
			return Mist(0.55f);
		}
		EWonderlandCardStatus Worst = EWonderlandCardStatus::Ready;
		for (const FWonderlandCardViewRef& Ref : Refs)
		{
			if (Ref.Status == EWonderlandCardStatus::Unavailable)
			{
				return CardStatusColour(Ref.Status);
			}
			if (Ref.Status == EWonderlandCardStatus::Unconfigured)
			{
				Worst = Ref.Status;
			}
		}
		return CardStatusColour(Worst);
	}

	/** Everything the open page shows, as one string: the page is redrawn only when this changes. */
	FString CardSignature(const FWonderlandCardView& View, FName Tab)
	{
		FString Out = Tab.ToString();
		Out += View.ActiveId + TEXT("|") + View.HandoffState + TEXT("|") + View.Skin + TEXT("|") + View.Primary + TEXT("|") + View.ModifiedWhat + TEXT("|") + View.Waiting;
		Out += TEXT("|") + View.Colour2 + TEXT("|") + View.Colour3 + TEXT("|") + View.Flame;
		Out += View.bModified ? TEXT("|M") : TEXT("|-");
		for (const TArray<FWonderlandCardViewRef>* Set : { &View.Companions, &View.Capabilities })
		{
			for (const FWonderlandCardViewRef& Ref : *Set)
			{
				Out += FString::Printf(TEXT("|%s:%d:%d:%s"), *Ref.Label, static_cast<int32>(Ref.Status), Ref.bSimulated ? 1 : 0, *Ref.Reason);
			}
		}
		for (const FWonderlandCardViewEntry& Entry : View.Cards)
		{
			Out += FString::Printf(TEXT("|%s:%s:%d"), *Entry.Id, *Entry.Name, Entry.bActive ? 1 : 0);
		}
		return Out;
	}

	/**
	 * BLACK SNOW ACROSS THE WHOLE PANEL (founder, 2026-09-25).
	 *
	 * The sculpture already has snow of its own, falling inside its chamber in three dimensions. This is the
	 * other half of the same instruction: the UI around it is white, and the snow falls over that too.
	 *
	 * DRAWN, NOT SIMULATED. There is no state to keep -- each flake's position is a pure function of its
	 * index and the clock, so the field costs nothing between frames, survives the panel being closed and
	 * reopened, and cannot drift out of step with itself.
	 *
	 * IT SKIPS THE SCULPTURE'S WINDOW. Inside that rectangle the founder is looking at the real chamber,
	 * which has real flakes falling in real depth; painting flat ones on top would put two snowfalls at two
	 * scales over each other.
	 */
	void PaintSnow(const FGeometry& Geometry, FSlateWindowElementList& Elements, int32 Layer,
				   float Time, const FVector4f& Hole, bool bHasHole)
	{
		const FSlateBrush* White = FCoreStyle::Get().GetBrush("WhiteBrush");
		const FVector2f Size(Geometry.GetLocalSize());
		if (Size.X < 8.0f || Size.Y < 8.0f)
		{
			return;
		}
		constexpr int32 Flakes = 190;
		for (int32 Index = 0; Index < Flakes; ++Index)
		{
			// A cheap fixed hash per flake: stable across frames, and uncorrelated enough between flakes that
			// the field does not read as rows.
			const float A = FMath::Frac(FMath::Sin(Index * 12.9898f) * 43758.5453f);
			const float B = FMath::Frac(FMath::Sin(Index * 78.2330f) * 21391.7739f);
			const float C = FMath::Frac(FMath::Sin(Index * 39.4262f) * 17631.4471f);

			const float Rate = 0.020f + B * 0.055f;                      // screens per second
			const float Fall = FMath::Frac(A + Time * Rate);
			const float Sway = FMath::Sin(Time * (0.5f + C) + Index) * 0.006f;
			const FVector2f At((A + Sway) * Size.X, Fall * Size.Y);
			const float Wide = 2.0f + C * 3.4f;

			if (bHasHole && At.X > Hole.X && At.X < Hole.Z && At.Y > Hole.Y && At.Y < Hole.W)
			{
				continue;
			}
			FSlateDrawElement::MakeBox(Elements, Layer,
				Geometry.ToPaintGeometry(FVector2f(Wide, Wide), FSlateLayoutTransform(At)),
				White, ESlateDrawEffect::None, WonderlandUi::Srgb(10, 10, 16, 0.80f));
		}
	}

	FSlateFontInfo Font(const char* Typeface, int32 Size, int32 LetterSpacing = 0)
	{
		FSlateFontInfo Info = FCoreStyle::GetDefaultFontStyle(Typeface, Size);
		Info.LetterSpacing = LetterSpacing;
		return Info;
	}

	// THE FRAME'S PROPORTIONS, as fractions of the viewport, measured from the founder's reference so the
	// panels, the connectors and the brain keep the composition at any resolution.
	struct FRect { float X0, Y0, X1, Y1; };
	// FIVE SECTIONS (founder, 2026-10-02: C.A.R.D. is the fifth Project Brain component, "Re-layout into five sections"). The
	// column keeps its width and its top; each of the four keeps its order and its share, a little shorter, and 05 C.A.R.D.
	// takes the foot. Was: 0.141-0.388, 0.404-0.620, 0.636-0.776, 0.792-0.912.
	constexpr FRect Panel1 = {0.042f, 0.141f, 0.446f, 0.336f};
	constexpr FRect Panel2 = {0.042f, 0.348f, 0.446f, 0.522f};
	constexpr FRect Panel3 = {0.042f, 0.534f, 0.446f, 0.656f};
	constexpr FRect Panel4 = {0.042f, 0.668f, 0.446f, 0.778f};
	constexpr FRect Panel5 = {0.042f, 0.790f, 0.446f, 0.930f};
	constexpr FRect Hologram = {0.502f, 0.125f, 0.892f, 0.956f};
	constexpr FRect Inspector = {0.515f, 0.140f, 0.885f, 0.880f};
	// THE SKIN VIEW STANDS WHERE THE INSPECTOR STANDS, a little wider because it carries a figure and a list side by
	// side. Nothing in the founder's frame moves to make room for it: it opens over the brain and shuts again.
	constexpr FRect SkinView = {0.478f, 0.132f, 0.905f, 0.906f};

	struct FConnector { float FromX, FromY, ToX, ToY; };
	constexpr FConnector Connectors[] = {
		// each leaves its panel at the SAME place along it as before the re-layout, and arrives where it always did
		{0.446f, 0.175f, 0.548f, 0.272f},
		{0.446f, 0.244f, 0.530f, 0.345f},
		{0.446f, 0.311f, 0.524f, 0.398f},
		{0.446f, 0.374f, 0.523f, 0.455f},
		{0.446f, 0.455f, 0.533f, 0.505f},
		{0.446f, 0.556f, 0.550f, 0.560f},
		{0.446f, 0.635f, 0.566f, 0.608f},
		{0.446f, 0.723f, 0.640f, 0.842f},
		// 05 C.A.R.D. into the root of the brain
		{0.446f, 0.860f, 0.668f, 0.884f},
	};

	/** Crown to root, as the frame's CHAKRA ADAPTIVE row reads. */
	FLinearColor Chakra(int32 Index)
	{
		static const FLinearColor Colors[] = {
			WonderlandUi::Srgb(0xB0, 0x6C, 0xFF), WonderlandUi::Srgb(0x5E, 0x5C, 0xF2), WonderlandUi::Srgb(0x3D, 0x9B, 0xFF),
			WonderlandUi::Srgb(0x3C, 0xD8, 0x6E), WonderlandUi::Srgb(0xFF, 0xD2, 0x3F), WonderlandUi::Srgb(0xFF, 0x8C, 0x2E),
			WonderlandUi::Srgb(0xFF, 0x3B, 0x3B),
		};
		return Colors[FMath::Clamp(Index, 0, 6)];
	}

	FVector2f At(const FVector2f& Size, float FX, float FY) { return FVector2f(Size.X * FX, Size.Y * FY); }
}

/* ---------------------------------------------------------------- backdrop and light */

/** The night field, the light rays, the panel halos, the connectors and the chakra row -- everything that is light. */
class SWonderlandBrainBackdrop : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandBrainBackdrop) {}
		SLATE_ATTRIBUTE(int32, ChakraRank)
		/** Normalised (L,T,R,B) the night field must NOT cover. Zero area means cover everything. */
		SLATE_ATTRIBUTE(FVector4f, Hole)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs)
	{
		ChakraRank = InArgs._ChakraRank;
		Hole = InArgs._Hole;
		RegisterActiveTimer(0.0f, FWidgetActiveTimerDelegate::CreateSP(this, &SWonderlandBrainBackdrop::Animate));
	}

	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(1920.0, 1080.0); }

	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override
	{
		using namespace WonderlandBrainLook;
		const FVector2f Size(AllottedGeometry.GetLocalSize());
		const FSlateBrush* White = FCoreStyle::Get().GetBrush("WhiteBrush");
		const float Time = static_cast<float>(FSlateApplication::Get().GetCurrentTime());
		int32 Layer = LayerId;

		// The night field. Deep enough that the world is a memory behind it, not a competitor.
		//
		// AND THIS IS WHY THE LIVING BRAIN WAS INVISIBLE. This wash is Srgb(3,6,22) at 0.94 across FAnchors(0,0,1,1)
		// -- the whole screen -- so the 3D world behind it, the sculpture included, reached the eye at six percent.
		// Every render precondition read healthy (2015 instances, mesh, material, vis=1, hidden=0, dead ahead at
		// 808 uu) because nothing was wrong with the sculpture: it was being painted over. Forcing it to 320 uu at
		// triple scale changed nothing, which is the tell -- distance and size cannot beat an opaque wash.
		//
		// The wardrobe never had this bug because it collapses this whole widget when it opens; its comment calls
		// its preview "a hole the world must show through". The brain window needed the same hole and never got it.
		// So the field is drawn as four bands around the window instead of one box over it. No hole, no change.
		const FVector4f Gap = Hole.Get(FVector4f(0.0f, 0.0f, 0.0f, 0.0f));
		const bool bHasHole = (Gap.Z - Gap.X) > 0.001f && (Gap.W - Gap.Y) > 0.001f;
		if (!bHasHole)
		{
			FSlateDrawElement::MakeBox(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(Size, FSlateLayoutTransform()), White,
				ESlateDrawEffect::None, Night(0.94f));
		}
		else
		{
			const float L = Gap.X * Size.X, T = Gap.Y * Size.Y, R = Gap.Z * Size.X, B = Gap.W * Size.Y;
			auto Band = [&](float X, float Y, float W, float H)
			{
				if (W <= 0.5f || H <= 0.5f) { return; }
				FSlateDrawElement::MakeBox(OutDrawElements, Layer,
					AllottedGeometry.ToPaintGeometry(FVector2f(W, H), FSlateLayoutTransform(FVector2f(X, Y))),
					White, ESlateDrawEffect::None, Night(0.94f));
			};
			// ---- AND THE EDGE IS FEATHERED, WHICH IS THE WHOLE OF THE FOUNDER'S "REMOVE THE SQUARE".
			//
			// FOUNDER, 2026-09-26: "There is a visible rectangular tonal/background boundary around the brain
			// presentation. REMOVE IT ... Do NOT simply change its color to something closer to white ...
			// REMOVE the unintended visible boundary so the brain exists naturally in the continuous white
			// Project Brain space."
			//
			// This is that boundary, and it is structural rather than a colour mistake. Inside the hole the eye
			// sees the WORLD -- the brain chamber -- and outside it sees this wash. Two surfaces that are close
			// but not identical, meeting along a hard axis-aligned line, read as a drawn rectangle however
			// carefully the two are matched. Matching them better is chasing the wrong thing: any residual
			// difference still has a crisp edge to live on.
			//
			// So the bands stop short of the hole and the gap between is filled with a ramp -- full wash at the
			// outside, nothing at all where it meets the world. There is no line for the eye to find, and the
			// wash still does its real job, which is stopping the garden showing through the rest of the panel.
			//
			// Outward only. A feather drawn INTO the hole would veil the brain, which is the thing the hole was
			// cut for.
			const float Feather = 54.0f;
			const float FL = FMath::Max(L - Feather, 0.0f);
			const float FT = FMath::Max(T - Feather, 0.0f);
			const float FR = FMath::Min(R + Feather, Size.X);
			const float FB = FMath::Min(B + Feather, Size.Y);

			Band(0.0f, 0.0f, Size.X, FT);
			Band(0.0f, FB, Size.X, Size.Y - FB);
			Band(0.0f, FT, FL, FB - FT);
			Band(FR, FT, Size.X - FR, FB - FT);

			// The ring between the solid bands and the hole, in steps that fade to nothing at the edge.
			auto Fade = [&](float X, float Y, float W, float H, float Alpha)
			{
				if (W <= 0.5f || H <= 0.5f || Alpha <= 0.002f) { return; }
				FSlateDrawElement::MakeBox(OutDrawElements, Layer,
					AllottedGeometry.ToPaintGeometry(FVector2f(W, H), FSlateLayoutTransform(FVector2f(X, Y))),
					White, ESlateDrawEffect::None, Night(0.94f * Alpha));
			};
			const int32 Steps = 18;
			for (int32 Step = 0; Step < Steps; ++Step)
			{
				// 1 at the outside of the ring, 0 where it meets the world.
				const float Near = static_cast<float>(Step) / static_cast<float>(Steps);
				const float Far = static_cast<float>(Step + 1) / static_cast<float>(Steps);
				const float Alpha = 1.0f - Far;
				const float TopY = FMath::Lerp(FT, T, Near);
				const float TopH = FMath::Lerp(FT, T, Far) - TopY;
				const float BotY = FMath::Lerp(FB, B, Far);
				const float BotH = FMath::Lerp(FB, B, Near) - BotY;
				const float LeftX = FMath::Lerp(FL, L, Near);
				const float LeftW = FMath::Lerp(FL, L, Far) - LeftX;
				const float RightX = FMath::Lerp(FR, R, Far);
				const float RightW = FMath::Lerp(FR, R, Near) - RightX;
				Fade(FL, TopY, FR - FL, TopH, Alpha);
				Fade(FL, BotY, FR - FL, BotH, Alpha);
				Fade(LeftX, T, LeftW, B - T, Alpha);
				Fade(RightX, T, RightW, B - T, Alpha);
			}
		}

		// THE SNOW GOES ON HERE, straight after the field and before anything else -- so it falls BEHIND the
		// cards and the text rather than over them. Black flakes crossing a paragraph would make it
		// unreadable, and the first version deferred this to the end of the scope and would have done
		// exactly that.
		PaintSnow(AllottedGeometry, OutDrawElements, Layer, Time, Gap, bHasHole);

		// Light falling from the upper left, and the blue-violet bloom the brain stands in.
		++Layer;
		for (int32 Ray = 0; Ray < 3; ++Ray)
		{
			const float Spread = 0.05f + 0.045f * Ray;
			TArray<FSlateVertex> Vertices;
			TArray<SlateIndex> Indices = {0, 1, 2, 0, 2, 3};
			const FVector2f Points[] = {At(Size, 0.0f + 0.03f * Ray, 0.0f), At(Size, Spread + 0.03f * Ray, 0.0f), At(Size, 0.30f + Spread * 2.0f, 0.70f), At(Size, 0.24f + 0.02f * Ray, 0.70f)};
			const FLinearColor RayTint[] = {Beam(0.075f - 0.02f * Ray), Beam(0.06f - 0.015f * Ray), Beam(0.0f), Beam(0.0f)};
			const FSlateRenderTransform& ToRender = AllottedGeometry.GetAccumulatedRenderTransform();
			for (int32 Corner = 0; Corner < 4; ++Corner)
			{
				FSlateVertex Vertex;
				const FVector2f Render = ToRender.TransformPoint(Points[Corner]);
				Vertex.Position[0] = Render.X;
				Vertex.Position[1] = Render.Y;
				Vertex.TexCoords[0] = 0.0f; Vertex.TexCoords[1] = 0.0f; Vertex.TexCoords[2] = 1.0f; Vertex.TexCoords[3] = 1.0f;
				Vertex.Color = RayTint[Corner].ToFColor(true);
				Vertices.Add(Vertex);
			}
			FSlateDrawElement::MakeCustomVerts(OutDrawElements, Layer, FSlateResourceHandle(), Vertices, Indices, nullptr, 0, 0);
		}
		++Layer;
		{
			static const FSlateRoundedBoxBrush Disc(FLinearColor::White, 10000.0f);
			const FVector2f Centre = At(Size, 0.715f, 0.47f);
			for (int32 Ring = 0; Ring < 7; ++Ring)
			{
				const float Radius = Size.Y * (0.18f + 0.045f * Ring);
				FSlateDrawElement::MakeBox(OutDrawElements, Layer,
					AllottedGeometry.ToPaintGeometry(FVector2f(Radius * 2.0f, Radius * 2.0f), FSlateLayoutTransform(Centre - FVector2f(Radius, Radius))),
					&Disc, ESlateDrawEffect::None, Beam(0.022f));
			}
		}

		// Halos round the glass panels: stacked outlines, fading outward, so each panel glows past its edge.
		++Layer;
		static const FSlateRoundedBoxBrush Halos[4] = {
			FSlateRoundedBoxBrush(FLinearColor::Transparent, 16.0f, Violet(0.160f), 2.5f),
			FSlateRoundedBoxBrush(FLinearColor::Transparent, 19.5f, Violet(0.125f), 2.5f),
			FSlateRoundedBoxBrush(FLinearColor::Transparent, 23.0f, Violet(0.090f), 2.5f),
			FSlateRoundedBoxBrush(FLinearColor::Transparent, 26.5f, Violet(0.055f), 2.5f),
		};
		for (const FRect& Rect : {Panel1, Panel2, Panel3, Panel4, Panel5})
		{
			for (int32 Ring = 0; Ring < 4; ++Ring)
			{
				const float Grow = 2.0f + 3.5f * Ring;
				const FVector2f Min = At(Size, Rect.X0, Rect.Y0) - FVector2f(Grow, Grow);
				const FVector2f Max = At(Size, Rect.X1, Rect.Y1) + FVector2f(Grow, Grow);
				FSlateDrawElement::MakeBox(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(Max - Min, FSlateLayoutTransform(Min)),
					&Halos[Ring], ESlateDrawEffect::None, FLinearColor::White);
			}
		}

		// The connectors: a glow pass, the line, a dot where it leaves the panel, and a mote of light travelling in.
		++Layer;
		static const FSlateRoundedBoxBrush Dot(FLinearColor::White, 10000.0f);
		for (int32 Index = 0; Index < static_cast<int32>(UE_ARRAY_COUNT(Connectors)); ++Index)
		{
			const FConnector& C = Connectors[Index];
			const FVector2f P0 = At(Size, C.FromX, C.FromY);
			const FVector2f P3 = At(Size, C.ToX, C.ToY);
			const FVector2f P1 = P0 + FVector2f(Size.X * 0.045f, 0.0f);
			const FVector2f P2 = P3 - FVector2f(Size.X * 0.035f, 0.0f);
			FSlateDrawElement::MakeCubicBezierSpline(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(), P0, P1, P2, P3, 5.0f, ESlateDrawEffect::None, Beam(0.16f));
			FSlateDrawElement::MakeCubicBezierSpline(OutDrawElements, Layer + 1, AllottedGeometry.ToPaintGeometry(), P0, P1, P2, P3, 1.4f, ESlateDrawEffect::None, Beam(0.85f));
			for (const FVector2f& End : {P0})
			{
				FSlateDrawElement::MakeBox(OutDrawElements, Layer + 2, AllottedGeometry.ToPaintGeometry(FVector2f(11.0f, 11.0f), FSlateLayoutTransform(End - FVector2f(5.5f, 5.5f))),
					&Dot, ESlateDrawEffect::None, Beam(0.30f));
				FSlateDrawElement::MakeBox(OutDrawElements, Layer + 3, AllottedGeometry.ToPaintGeometry(FVector2f(5.0f, 5.0f), FSlateLayoutTransform(End - FVector2f(2.5f, 2.5f))),
					&Dot, ESlateDrawEffect::None, BrainInk(0.95f));
			}
			const float T = FMath::Frac(Time * 0.22f + Index * 0.137f);
			const float U = 1.0f - T;
			const FVector2f Mote = P0 * (U * U * U) + P1 * (3.0f * U * U * T) + P2 * (3.0f * U * T * T) + P3 * (T * T * T);
			FSlateDrawElement::MakeBox(OutDrawElements, Layer + 3, AllottedGeometry.ToPaintGeometry(FVector2f(6.0f, 6.0f), FSlateLayoutTransform(Mote - FVector2f(3.0f, 3.0f))),
				&Dot, ESlateDrawEffect::None, Violet(0.9f * FMath::Sin(T * PI)));
		}
		Layer += 3;

		// CHAKRA ADAPTIVE: seven glowing points, the brain's rank the brightest.
		++Layer;
		const int32 Rank = FMath::Clamp(ChakraRank.Get(), 1, 7);
		for (int32 Index = 0; Index < 7; ++Index)
		{
			const FVector2f Centre = At(Size, 0.903f + 0.0118f * Index, 0.646f);
			const bool bRank = (7 - Index) == Rank;
			const float Glow = bRank ? 18.0f + 3.0f * FMath::Sin(Time * 2.4f) : 11.0f;
			FSlateDrawElement::MakeBox(OutDrawElements, Layer, AllottedGeometry.ToPaintGeometry(FVector2f(Glow, Glow), FSlateLayoutTransform(Centre - FVector2f(Glow * 0.5f, Glow * 0.5f))),
				&Dot, ESlateDrawEffect::None, Chakra(Index).CopyWithNewOpacity(bRank ? 0.45f : 0.22f));
			FSlateDrawElement::MakeBox(OutDrawElements, Layer + 1, AllottedGeometry.ToPaintGeometry(FVector2f(7.0f, 7.0f), FSlateLayoutTransform(Centre - FVector2f(3.5f, 3.5f))),
				&Dot, ESlateDrawEffect::None, Chakra(Index));
		}
		return Layer + 1;
	}

private:
	EActiveTimerReturnType Animate(double InCurrentTime, float InDeltaTime)
	{
		Invalidate(EInvalidateWidgetReason::Paint);
		return EActiveTimerReturnType::Continue;
	}

	TAttribute<int32> ChakraRank;
	TAttribute<FVector4f> Hole;
};

/** The living light over the brain: its core breathing in the rank's colour, and the platform's rings turning. */
class SWonderlandBrainCoreGlow : public SLeafWidget
{
public:
	SLATE_BEGIN_ARGS(SWonderlandBrainCoreGlow) {}
		SLATE_ATTRIBUTE(int32, ChakraRank)
		SLATE_ATTRIBUTE(float, Dim)
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs)
	{
		ChakraRank = InArgs._ChakraRank;
		Dim = InArgs._Dim;
		RegisterActiveTimer(0.0f, FWidgetActiveTimerDelegate::CreateSP(this, &SWonderlandBrainCoreGlow::Animate));
	}

	virtual FVector2D ComputeDesiredSize(float) const override { return FVector2D(1920.0, 1080.0); }

	virtual int32 OnPaint(const FPaintArgs& Args, const FGeometry& AllottedGeometry, const FSlateRect& MyCullingRect,
		FSlateWindowElementList& OutDrawElements, int32 LayerId, const FWidgetStyle& InWidgetStyle, bool bParentEnabled) const override
	{
		using namespace WonderlandBrainLook;
		const FVector2f Size(AllottedGeometry.GetLocalSize());
		const float Time = static_cast<float>(FSlateApplication::Get().GetCurrentTime());
		const float Keep = FMath::Clamp(Dim.Get(), 0.0f, 1.0f);
		static const FSlateRoundedBoxBrush Disc(FLinearColor::White, 10000.0f);
		const FLinearColor Rank = Chakra(7 - FMath::Clamp(ChakraRank.Get(), 1, 7));
		const FVector2f Core = At(Size, 0.727f, 0.420f);
		const float Breath = 0.5f + 0.5f * FMath::Sin(Time * 1.6f);
		for (int32 Ring = 0; Ring < 4; ++Ring)
		{
			const float Radius = Size.Y * (0.016f + 0.014f * Ring) * (1.0f + 0.18f * Breath);
			FSlateDrawElement::MakeBox(OutDrawElements, LayerId, AllottedGeometry.ToPaintGeometry(FVector2f(Radius * 2.0f, Radius * 2.0f), FSlateLayoutTransform(Core - FVector2f(Radius, Radius))),
				&Disc, ESlateDrawEffect::None, Rank.CopyWithNewOpacity((0.16f - 0.03f * Ring) * (0.6f + 0.4f * Breath) * Keep));
		}
		// The platform's rings, turning slowly: two dashed ellipses drawn as short arcs.
		const FVector2f Platform = At(Size, 0.727f, 0.826f);
		for (int32 Ring = 0; Ring < 2; ++Ring)
		{
			const float RX = Size.Y * (0.20f + 0.06f * Ring);
			const float RY = RX * 0.16f;
			const float Spin = Time * (Ring == 0 ? 0.35f : -0.22f);
			for (int32 Dash = 0; Dash < 18; ++Dash)
			{
				TArray<FVector2f> Arc;
				for (int32 Step = 0; Step <= 4; ++Step)
				{
					const float A = Spin + (Dash + Step * 0.12f) * (2.0f * PI / 18.0f);
					Arc.Add(Platform + FVector2f(FMath::Cos(A) * RX, FMath::Sin(A) * RY));
				}
				FSlateDrawElement::MakeLines(OutDrawElements, LayerId + 1, AllottedGeometry.ToPaintGeometry(), Arc, ESlateDrawEffect::None,
					Beam(0.55f * Keep), true, 1.4f);
			}
		}
		return LayerId + 1;
	}

private:
	EActiveTimerReturnType Animate(double InCurrentTime, float InDeltaTime)
	{
		Invalidate(EInvalidateWidgetReason::Paint);
		return EActiveTimerReturnType::Continue;
	}

	TAttribute<int32> ChakraRank;
	TAttribute<float> Dim;
};

/* ---------------------------------------------------------------- the panel */

SWonderlandProjectBrainPanel::SWonderlandProjectBrainPanel()
	: PanelBrush(WonderlandUi::Srgb(255, 255, 255, 0.72f), 14.0f, WonderlandBrainLook::Beam(0.55f), 1.4f)
	, CardBrush(WonderlandUi::Srgb(255, 255, 255, 0.86f), 9.0f, WonderlandUi::Srgb(120, 132, 214, 0.55f), 1.0f)
	, SelectedBrush(WonderlandUi::Srgb(96, 104, 255, 0.18f), 9.0f, WonderlandBrainLook::Violet(1.0f), 1.6f)
	, InspectorBrush(WonderlandUi::Srgb(252, 252, 255, 0.97f), 14.0f, WonderlandBrainLook::Violet(0.75f), 1.6f)
	, YoursBadge(WonderlandUi::Srgb(40, 200, 170, 0.18f), 6.0f, WonderlandUi::Srgb(96, 232, 204, 0.90f), 1.0f)
	, ReviewBadge(WonderlandUi::Srgb(240, 180, 60, 0.16f), 6.0f, WonderlandUi::Srgb(250, 204, 96, 0.90f), 1.0f)
	, SystemBadge(WonderlandUi::Srgb(150, 130, 255, 0.16f), 6.0f, WonderlandUi::Srgb(186, 166, 255, 0.90f), 1.0f)
	, InputBrush(WonderlandUi::Srgb(255, 255, 255, 0.98f), 7.0f, WonderlandBrainLook::Beam(0.55f), 1.0f)
	, ButtonBrush(WonderlandUi::Srgb(90, 100, 230, 0.16f), 7.0f, WonderlandBrainLook::Violet(0.85f), 1.0f)
	, ButtonHoverBrush(WonderlandUi::Srgb(110, 118, 255, 0.30f), 7.0f, WonderlandBrainLook::BrainInk(1.0f), 1.0f)
	, RuleBrush(WonderlandBrainLook::Beam(0.45f), 0.0f)
	, StatusBrush(WonderlandUi::Srgb(255, 244, 214, 0.90f), 6.0f, WonderlandUi::Srgb(196, 146, 24, 0.85f), 1.0f)
	// THE WARDROBE'S SURFACES, LAST because that is where they are declared. C++ initialises members in
	// declaration order whatever this list says, so listing them first only earned a C5038.
	// THE WINDOW'S FRAME: an outline and no fill at all. Anything with a fill here would tint the Dog behind it.
	, SkinWindowFrameBrush(FLinearColor(0.0f, 0.0f, 0.0f, 0.0f), 12.0f, WonderlandBrainLook::Beam(0.9f), 1.6f)
	// An outline with no fill for the panel, so its window is really a hole, and a solid for every surface that is
	// NOT the window. A filled panel behind the window tinted the Dog navy.
	, SkinPanelFrameBrush(FLinearColor(0.0f, 0.0f, 0.0f, 0.0f), 6.0f, WonderlandBrainLook::Violet(0.95f), 1.6f)
	, SkinPanelSolidBrush(WonderlandUi::Srgb(8, 12, 38, 0.95f), 0.0f, FLinearColor(0.0f, 0.0f, 0.0f, 0.0f), 0.0f)
	// THE 360 PILL. Barely there until the pointer finds it, and plainly lit while it is turning -- the founder
	// asked for "subtle and premium", and a control sitting inside the preview square must not compete with the
	// mascot for attention. Declaration order matters here: C++ initialises members in the order they are
	// DECLARED whatever this list says, and listing them out of order earns a C5038.
	, InspectBrush(WonderlandUi::Srgb(6, 9, 28, 0.55f), 12.0f, WonderlandBrainLook::Beam(0.55f), 1.0f)
	, InspectHoverBrush(WonderlandUi::Srgb(18, 24, 60, 0.85f), 12.0f, WonderlandBrainLook::Beam(0.95f), 1.2f)
	, InspectOnBrush(WonderlandUi::Srgb(46, 56, 150, 0.90f), 12.0f, WonderlandUi::Srgb(0xB8, 0xC4, 0xFF, 1.0f), 1.4f)
	, SwatchBrush(FLinearColor::White, 4.0f, FLinearColor(0.0f, 0.0f, 0.0f, 0.35f), 1.0f)
	, SwatchRingBrush(FLinearColor(0.0f, 0.0f, 0.0f, 0.0f), 5.0f, FLinearColor::White, 1.8f)
{
	ClearBrush.DrawAs = ESlateBrushDrawType::NoDrawType;
	InspectStyle = FButtonStyle()
		.SetNormal(InspectBrush).SetHovered(InspectHoverBrush).SetPressed(InspectOnBrush)
		.SetNormalPadding(FMargin(9.0f, 5.0f)).SetPressedPadding(FMargin(9.0f, 5.0f));
	// A SWATCH IS ITS OWN COLOUR, so the button chrome must add nothing: the chip inside it is what is seen.
	SwatchStyle = FButtonStyle()
		.SetNormal(ClearBrush).SetHovered(ClearBrush).SetPressed(ClearBrush)
		.SetNormalPadding(FMargin(0.0f)).SetPressedPadding(FMargin(0.0f));
}

const FWonderlandBrainSurface* SWonderlandProjectBrainPanel::Surface(FName SurfaceId) const
{
	return Model.Surfaces.FindByPredicate([SurfaceId](const FWonderlandBrainSurface& Entry) { return Entry.Id == SurfaceId; });
}

FText SWonderlandProjectBrainPanel::SurfaceLabel(FName SurfaceId) const
{
	const FWonderlandBrainSurface* Found = Surface(SurfaceId);
	return FText::FromString(Found != nullptr ? Found->Title : SurfaceId.ToString());
}

FText SWonderlandProjectBrainPanel::ChipLabel(FName SurfaceId) const
{
	const FWonderlandBrainSurface* Found = Surface(SurfaceId);
	if (Found == nullptr)
	{
		return FText::FromString(SurfaceId.ToString());
	}
	const int32 Pending = Found->Proposals.Num() + Found->Reviews.Num();
	return FText::FromString(Pending > 0
		? FString::Printf(TEXT("%s  %d  +%d"), *Found->Title, Found->EntryCount, Pending)
		: FString::Printf(TEXT("%s  %d"), *Found->Title, Found->EntryCount));
}

void SWonderlandProjectBrainPanel::Construct(const FArguments& InArgs)
{
	using namespace WonderlandBrainLook;
	HologramBrush = InArgs._HologramBrush;
	OnRequestClose = InArgs._OnRequestClose;
	OnRequestTerminal = InArgs._OnRequestTerminal;
	OnRequestMap = InArgs._OnRequestMap;
	OnRequestWonderWeb = InArgs._OnRequestWonderWeb;
	OnPropose = InArgs._OnPropose;
	OnReview = InArgs._OnReview;
	SkinPreviewBrush = InArgs._SkinPreviewBrush;
	Skins = InArgs._Skins;
	EquippedSkin = InArgs._EquippedSkin;
	OnChooseSkin = InArgs._OnChooseSkin;
	OnSkinPreviewPainted = InArgs._OnSkinPreviewPainted;
	CardWorld = InArgs._CardWorld;
	RefreshCardView(true);

	SelectableStyle = FButtonStyle()
		.SetNormal(ClearBrush)
		.SetHovered(FSlateRoundedBoxBrush(WonderlandUi::Srgb(110, 120, 255, 0.16f), 8.0f, Violet(0.55f), 1.0f))
		.SetPressed(FSlateRoundedBoxBrush(WonderlandUi::Srgb(110, 120, 255, 0.26f), 8.0f, Violet(0.85f), 1.0f))
		.SetNormalPadding(FMargin(0.0f))
		.SetPressedPadding(FMargin(0.0f));
	ActionStyle = FButtonStyle()
		.SetNormal(ButtonBrush)
		.SetHovered(ButtonHoverBrush)
		.SetPressed(ButtonHoverBrush)
		.SetNormalPadding(FMargin(12.0f, 5.0f))
		.SetPressedPadding(FMargin(12.0f, 6.0f, 12.0f, 4.0f));

	FSlateBrush NoBackground;
	NoBackground.DrawAs = ESlateBrushDrawType::NoDrawType;
	InputStyle = FCoreStyle::Get().GetWidgetStyle<FEditableTextBoxStyle>("NormalEditableTextBox");
	InputStyle.SetBackgroundImageNormal(NoBackground)
		.SetBackgroundImageHovered(NoBackground)
		.SetBackgroundImageFocused(NoBackground)
		.SetFont(Font("Regular", 11))
		.SetForegroundColor(FSlateColor(BrainInk()))
		.SetFocusedForegroundColor(FSlateColor(BrainInk()))
		.SetPadding(FMargin(6.0f, 4.0f));

	const auto Slot = [](const FRect& Rect) { return FAnchors(Rect.X0, Rect.Y0, Rect.X1, Rect.Y1); };

	// 01 MEMORY CORE
	TSharedRef<SWidget> MemoryBody =
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 8.0f, 0.0f)
		[
			MakeMemoryCard(EWonderlandBrainGlyph::Person, TEXT("Semantic Memory"), {TEXT("user_facts"), TEXT("learned_facts"), TEXT("preferences"), TEXT("identity")})
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 8.0f, 0.0f)
		[
			MakeMemoryCard(EWonderlandBrainGlyph::Clock, TEXT("Episodic Memory"), {TEXT("session_history"), TEXT("past_actions"), TEXT("user_events"), TEXT("agent_experiences")})
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f)
		[
			// workflows moved to 04 SKILLS & MODS (SECOND JUJU's contract r1); "skills" here is Learned Skills, what agents demonstrated
			MakeMemoryCard(EWonderlandBrainGlyph::Gear, TEXT("Procedural Memory"), {TEXT("instructions"), TEXT("prompt_systems"), TEXT("skills")})
		];

	// 02 PROJECT BRAIN SYSTEMS
	TSharedRef<SWidget> SystemsBody =
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().FillHeight(1.0f).Padding(0.0f, 0.0f, 0.0f, 7.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 8.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Document, TEXT("scratchpads"), 0.0f)]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 8.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Nodes, TEXT("memory_synthesis"), 0.0f)]
			+ SHorizontalBox::Slot().FillWidth(1.0f)[MakeTile(EWonderlandBrainGlyph::Sparkle, TEXT("auto_memories"), 0.0f)]
		]
		+ SVerticalBox::Slot().FillHeight(1.0f)
		[
			SNew(SHorizontalBox)
			// THE MASCOT SKIN TILE LEFT 02 (founder, 2026-10-06): how the Dog looks is 05 C.A.R.D.'s MASCOT & VISUAL MODS now. The row keeps
			// its two tiles inside the same anchors.
			+ SHorizontalBox::Slot().FillWidth(1.2f).Padding(0.0f, 0.0f, 8.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Arrows, TEXT("context_handoffs"), 0.0f)]
			+ SHorizontalBox::Slot().FillWidth(1.2f)[MakeTile(EWonderlandBrainGlyph::Pulse, TEXT("agent_state"), 0.0f)]
		];

	// 03 LARGE LANGUAGE MODEL COMPONENTS
	TSharedRef<SWidget> ComponentsBody =
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 7.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Feather, TEXT("prompt_architect"), 0.0f)]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 7.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Code, TEXT("coding_agent"), 0.0f)]
		+ SHorizontalBox::Slot().FillWidth(1.1f).Padding(0.0f, 0.0f, 7.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Magnifier, TEXT("independent_reviewer"), 0.0f)]
		+ SHorizontalBox::Slot().FillWidth(1.0f)[MakeTile(EWonderlandBrainGlyph::People, TEXT("shared_context"), 0.0f)];

	// 04 SKILLS & MODS (founder, 2026-10-06: it replaces 04 MISSION CONTEXT; SECOND JUJU's contract r1) -- what EXTENDS the agent 03
	// configures. The same two rows of four chips, so the layout is unchanged.
	TSharedRef<SWidget> SkillsBody =
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 6.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Document, TEXT("skill_md"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Sparkle, TEXT("skill_library"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Arrows, TEXT("workflows"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f)[MakeChip(EWonderlandBrainGlyph::Layers, TEXT("packs"))]
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Code, TEXT("julius_mods"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Gear, TEXT("deterministic_modules"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Nodes, TEXT("fuzzy_modules"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f)[MakeChip(EWonderlandBrainGlyph::Shield, TEXT("extension_permissions"))]
		];

	SAssignNew(InspectorBody, SVerticalBox);

	const auto Caption = [](const TCHAR* Text, const FSlateFontInfo& FontInfo, const FLinearColor& Colour) -> TSharedRef<SWidget>
	{
		return SNew(STextBlock).Text(FText::FromString(Text)).Font(FontInfo).ColorAndOpacity(Colour);
	};

	ChildSlot
	[
		SNew(SConstraintCanvas)
		// Light, halos, connectors and the chakra row.
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.0f, 0.0f, 1.0f, 1.0f)).Offset(FMargin(0.0f))
		[
			SNew(SWonderlandBrainBackdrop).ChakraRank_Lambda([this]() { return Model.ChakraRank; })
			// ONLY WHILE THE SCULPTURE IS ACTUALLY LIVE. If it ever fails to stage, the still hologram comes back
			// over an unbroken night field exactly as before -- a broken lens costs the movement, never the picture.
			.Hole_Lambda([this]() -> FVector4f
			{
				// Initialised because the compiler cannot see that neither is read unless the getter returned true
				// (C4701), and because a getter that ever returns true without writing should give a zero rect
				// rather than whatever was on the stack.
				FVector2D Centre = FVector2D::ZeroVector;
				FVector2D Extent = FVector2D::ZeroVector;
				// THE WARDROBE'S WINDOW FIRST, because while the wardrobe is open it owns the only hole there is.
				const bool bGot = bSkinsOpen ? GetSkinPreviewRect(Centre, Extent)
											 : (bSculptureLive && GetBrainSculptureRect(Centre, Extent));
				if (!bGot)
				{
					return FVector4f(0.0f, 0.0f, 0.0f, 0.0f);
				}
				return FVector4f(static_cast<float>(Centre.X - Extent.X * 0.5), static_cast<float>(Centre.Y - Extent.Y * 0.5),
								 static_cast<float>(Centre.X + Extent.X * 0.5), static_cast<float>(Centre.Y + Extent.Y * 0.5));
			})
			// IT NEVER COLLAPSES NOW.
			//
			// FOUNDER, 2026-09-24: "Keep the existing Project Brain look. Do NOT make the whole Project Brain
			// black. Only the Wardrobe preview square is black." Collapsing this widget when the wardrobe opened
			// took the night field off the WHOLE panel, so the garden showed through every card and heading --
			// photographed in PIE, the plaza, the HUD counters and the i.Wonder mark were all visible straight
			// through Project Brain. The field stays; the preview square is the hole.
			.Visibility_Lambda([this]() { return EVisibility::HitTestInvisible; })
		]
		// The brain. A NAMED BOX, because this rectangle is also where the living sculpture is framed: the lens
		// maths needs the window's measured place on screen, exactly as the wardrobe's does.
		+ SConstraintCanvas::Slot().Anchors(Slot(Hologram)).Offset(FMargin(0.0f))
		[
			SAssignNew(HologramWindow, SBox)
			[
				SNew(SScaleBox)
				.Stretch(EStretch::ScaleToFit)
				[
					SNew(SImage)
					.Image(HologramBrush)
					// HIDDEN WHILE THE WARDROBE IS OPEN: the skin view stands over the brain, and its preview is a hole
					// the world must show through -- not the hologram behind it.
					//
					// AND HIDDEN WHILE THE LIVING BRAIN IS FRAMED, for the same reason: a still of a brain drawn over
					// a breathing one would hide it completely. The still comes straight back if the sculpture ever
					// fails to stage, so a broken lens costs the movement and never the picture.
					.Visibility_Lambda([this]()
					{
						const bool bWanted = HologramBrush != nullptr && !bSkinsOpen && !bSculptureLive;
						return bWanted ? EVisibility::HitTestInvisible : EVisibility::Collapsed;
					})
					.ColorAndOpacity_Lambda([this]() { return FSlateColor(FLinearColor(1.0f, 1.0f, 1.0f, Selected.IsNone() && CardTab.IsNone() ? 1.0f : 0.30f)); })
				]
			]
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.0f, 0.0f, 1.0f, 1.0f)).Offset(FMargin(0.0f))
		[
			SNew(SWonderlandBrainCoreGlow)
			.Visibility_Lambda([this]() { return bSkinsOpen ? EVisibility::Collapsed : EVisibility::HitTestInvisible; })
			.ChakraRank_Lambda([this]() { return Model.ChakraRank; })
			.Dim_Lambda([this]() { return Selected.IsNone() && CardTab.IsNone() ? 1.0f : 0.25f; })
		]
		// The title.
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.042f, 0.036f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(INVTEXT("PROJECT BRAIN")).Font(Font("Light", 38, 330)).ColorAndOpacity(BrainInk())
				.ShadowOffset(FVector2D(0.0f, 0.0f)).ShadowColorAndOpacity(Violet(0.0f))
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(2.0f, 6.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("MEMORY    ×    REASONING    ×    CONTINUITY    ×    A HIGHER YOU"))).Font(Font("Regular", 9, 420)).ColorAndOpacity(Mist())
			]
		]
		// What this is, said at the top.
		//
		// FOUNDER, 2026-09-25: "REMOVE THE PROJECT BRAIN YELLOW SQUARE/LAYER ... a faint yellow square or
		// rectangular layer ... Remove completely." This was it: StatusBrush is a pale-yellow (255,244,214)
		// rounded plate with a gold border, and it was the only yellow surface anywhere on the page. Painted
		// across the top of the white brain chamber it reads exactly as a stray layer -- which is what it was
		// being read as.
		//
		// THE SENTENCE STAYS. The plate is what the founder objected to, not the disclosure: this line is the
		// project's standing honesty about sample data, and it is preserved -- set as plain page ink at the
		// weight the rest of the captions use, with no plate behind it and nothing yellow left on the page.
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.47f, 0.046f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(STextBlock).Text_Lambda([this]() { return FText::FromString(Model.SourceLine); })
				.Font(Font("Bold", 8, 160)).ColorAndOpacity(Mist())
		]
		// WONDER WEB IS OPENED FROM THE PROJECT (founder, 2026-09-17: contextually, never a permanent bottom shortcut): the
		// project the brain belongs to, and its in-world browser one click or W away.
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.47f, 0.084f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SButton)
			.ButtonStyle(&ActionStyle)
			.OnClicked_Lambda([this]() { OnRequestWonderWeb.ExecuteIfBound(); return FReply::Handled(); })
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text_Lambda([this]() { return FText::FromString(FString::Printf(TEXT("PROJECT  %s"), *Model.ProjectName.ToUpper())); })
					.Font(Font("Regular", 9, 200)).ColorAndOpacity(Mist())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(14.0f, 0.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock).Text(INVTEXT("OPEN WONDER WEB   W")).Font(Font("Bold", 10, 200)).ColorAndOpacity(WonderlandUi::Srgb(0xFF, 0xD4, 0x00))
				]
			]
		]
		// The panels.
		+ SConstraintCanvas::Slot().Anchors(Slot(Panel1)).Offset(FMargin(0.0f))
		[
			MakeGlassPanel(TEXT("01"), EWonderlandBrainGlyph::Folder, TEXT("MEMORY CORE"), TEXT("YOUR EXPERIENCE LIVES ON"), MemoryBody)
		]
		+ SConstraintCanvas::Slot().Anchors(Slot(Panel2)).Offset(FMargin(0.0f))
		[
			MakeGlassPanel(TEXT("02"), EWonderlandBrainGlyph::Layers, TEXT("PROJECT BRAIN SYSTEMS"), TEXT("KEEPING YOUR MIND IN MOTION"), SystemsBody)
		]
		+ SConstraintCanvas::Slot().Anchors(Slot(Panel3)).Offset(FMargin(0.0f))
		[
			MakeGlassPanel(TEXT("03"), EWonderlandBrainGlyph::People, TEXT("LARGE LANGUAGE MODEL COMPONENTS"), TEXT("MORE PERSPECTIVES, A STRONGER YOU"), ComponentsBody)
		]
		+ SConstraintCanvas::Slot().Anchors(Slot(Panel4)).Offset(FMargin(0.0f))
		[
			MakeGlassPanel(TEXT("04"), EWonderlandBrainGlyph::Nodes, TEXT("SKILLS & MODS"), TEXT("MORE ABILITIES, SAME AGENT"), SkillsBody)
		]
		+ SConstraintCanvas::Slot().Anchors(Slot(Panel5)).Offset(FMargin(0.0f))
		[
			MakeGlassPanel(TEXT("05"), EWonderlandBrainGlyph::Wallet, TEXT("C.A.R.D."), TEXT("YOUR LOADOUT, READY TO HAND OFF"), MakeCardStrip())
		]
		// The side captions, as the frame sets them.
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.823f, 0.058f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[Caption(TEXT("ADAPTIVE INTELLIGENCE"), Font("Regular", 9, 320), BrainInk(0.88f))]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)[Caption(TEXT("FOR A MORE CAPABLE YOU"), Font("Regular", 9, 320), BrainInk(0.88f))]
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.898f, 0.232f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[Caption(TEXT("PROJECT BRAIN"), Font("Bold", 10, 220), BrainInk())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 16.0f, 0.0f, 0.0f)[Caption(TEXT("ADAPTS"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)[Caption(TEXT("LEARNS"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)[Caption(TEXT("REMEMBERS"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)[Caption(TEXT("EVOLVES"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)[Caption(TEXT("WITH YOU"), Font("Regular", 8, 300), Mist())]
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.898f, 0.607f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			Caption(TEXT("CHAKRA ADAPTIVE"), Font("Regular", 8, 300), BrainInk(0.85f))
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.898f, 0.666f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[Caption(TEXT("GLOWS WITH"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)[Caption(TEXT("YOUR RANK"), Font("Regular", 8, 300), Mist())]
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.042f, 0.947f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			Caption(TEXT("YOUR CONTEXT, AMPLIFIED.   ——"), Font("Regular", 9, 320), BrainInk(0.85f))
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.800f, 0.947f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			Caption(TEXT("A MORE CAPABLE TOMORROW.   ——"), Font("Regular", 9, 320), BrainInk(0.85f))
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.42f, 0.978f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			Caption(TEXT("B or Esc to close   ·   choose any memory, system, component or C.A.R.D. to inspect it"), Font("Regular", 8, 60), Mist(0.75f))
		]
		// RELAY DOG SKINS: the live mascot and its wardrobe, over the brain.
		+ SConstraintCanvas::Slot().Anchors(Slot(SkinView)).Offset(FMargin(0.0f))
		[
			MakeSkinsView()
		]
		// The inspector: one surface at a time, over the brain.
		+ SConstraintCanvas::Slot().Anchors(Slot(Inspector)).Offset(FMargin(0.0f))
		[
			SAssignNew(InspectorRoot, SBorder)
			.Visibility_Lambda([this]() { return Selected.IsNone() ? EVisibility::Collapsed : EVisibility::Visible; })
			.BorderImage(&InspectorBrush)
			.Padding(FMargin(22.0f, 18.0f))
			[
				InspectorBody.ToSharedRef()
			]
		]
		// 05 C.A.R.D.'s page: one tab at a time, where the inspector stands, over the brain
		+ SConstraintCanvas::Slot().Anchors(Slot(Inspector)).Offset(FMargin(0.0f))
		[
			SNew(SBorder)
			.Visibility_Lambda([this]() { return CardTab.IsNone() || bSkinsOpen ? EVisibility::Collapsed : EVisibility::Visible; })
			.BorderImage(&InspectorBrush)
			.Padding(FMargin(22.0f, 18.0f))
			[
				SNew(SScrollBox)
				+ SScrollBox::Slot()
				[
					SAssignNew(CardPageBody, SVerticalBox)
				]
			]
		]
	];
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeGlassPanel(const TCHAR* Number, EWonderlandBrainGlyph Glyph, const TCHAR* Title, const TCHAR* Subtitle, TSharedRef<SWidget> Body)
{
	using namespace WonderlandBrainLook;
	return SNew(SBorder)
		.BorderImage(&PanelBrush)
		.Padding(FMargin(16.0f, 10.0f, 16.0f, 12.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(2.0f, 0.0f, 22.0f, 0.0f)
				[
					SNew(STextBlock).Text(FText::FromString(Number)).Font(Font("Light", 15, 80)).ColorAndOpacity(BrainInk(0.9f))
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 26.0f, 0.0f)
				[
					SNew(SWonderlandBrainIcon).Glyph(Glyph).Size(30.0f).Color(Violet()).Thickness(1.8f)
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(STextBlock).Text(FText::FromString(Title)).Font(Font("Regular", 12, 300)).ColorAndOpacity(BrainInk())
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 3.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(FText::FromString(Subtitle)).Font(Font("Regular", 7, 260)).ColorAndOpacity(Mist())
					]
				]
			]
			+ SVerticalBox::Slot().FillHeight(1.0f)
			[
				Body
			]
		];
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeSelectable(FName SurfaceId, const FSlateBrush* RestBrush, TSharedRef<SWidget> Content)
{
	return SNew(SBorder)
		.BorderImage_Lambda([this, SurfaceId, RestBrush]() -> const FSlateBrush* { return Selected == SurfaceId ? &SelectedBrush : RestBrush; })
		.Padding(FMargin(0.0f))
		[
			SNew(SButton)
			.ButtonStyle(&SelectableStyle)
			.ContentPadding(FMargin(0.0f))
			.OnClicked_Lambda([this, SurfaceId]() { Select(Selected == SurfaceId ? NAME_None : SurfaceId); return FReply::Handled(); })
			[
				Content
			]
		];
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeMemoryCard(EWonderlandBrainGlyph Glyph, const TCHAR* Title, std::initializer_list<const TCHAR*> SurfaceIds)
{
	using namespace WonderlandBrainLook;
	TSharedRef<SVerticalBox> Rows = SNew(SVerticalBox);
	for (const TCHAR* Id : SurfaceIds)
	{
		const FName SurfaceId(Id);
		Rows->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 1.0f)
		[
			MakeSelectable(SurfaceId, &ClearBrush,
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 3.0f, 9.0f, 3.0f)
				[
					SNew(SWonderlandBrainIcon).Glyph(EWonderlandBrainGlyph::File).Size(13.0f).Color(Violet(0.9f)).Thickness(1.2f)
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text_Lambda([this, SurfaceId]() { return SurfaceLabel(SurfaceId); }).Font(Font("Regular", 10)).ColorAndOpacity(BrainInk(0.92f))
				])
		];
	}
	return SNew(SBorder)
		.BorderImage(&CardBrush)
		.Padding(FMargin(10.0f, 8.0f, 10.0f, 8.0f))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 6.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
				[
					SNew(SWonderlandBrainIcon).Glyph(Glyph).Size(20.0f).Color(Violet()).Thickness(1.5f)
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(Title)).Font(Font("Regular", 11)).ColorAndOpacity(BrainInk())
				]
			]
			+ SVerticalBox::Slot().FillHeight(1.0f)
			[
				Rows
			]
		];
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeTile(EWonderlandBrainGlyph Glyph, FName SurfaceId, float Height)
{
	using namespace WonderlandBrainLook;
	return MakeSelectable(SurfaceId, &CardBrush,
		SNew(SBox)
		.VAlign(VAlign_Center)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(14.0f, 6.0f, 12.0f, 6.0f)
			[
				SNew(SWonderlandBrainIcon).Glyph(Glyph).Size(24.0f).Color(Violet()).Thickness(1.6f)
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(0.0f, 0.0f, 8.0f, 0.0f)
			[
				SNew(STextBlock).Text_Lambda([this, SurfaceId]() { return SurfaceLabel(SurfaceId); }).Font(Font("Regular", 11)).ColorAndOpacity(BrainInk()).AutoWrapText(true)
			]
		]);
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeChip(EWonderlandBrainGlyph Glyph, FName SurfaceId)
{
	using namespace WonderlandBrainLook;
	return MakeSelectable(SurfaceId, &CardBrush,
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(9.0f, 4.0f, 7.0f, 4.0f)
		[
			SNew(SWonderlandBrainIcon).Glyph(Glyph).Size(14.0f).Color(Violet()).Thickness(1.3f)
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(0.0f, 0.0f, 6.0f, 0.0f)
		[
			SNew(STextBlock).Text_Lambda([this, SurfaceId]() { return ChipLabel(SurfaceId); }).Font(Font("Regular", 9, 40)).ColorAndOpacity(BrainInk(0.95f))
			.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
		]);
}

void SWonderlandProjectBrainPanel::Refresh(const FWonderlandBrainModel& InModel)
{
	Model = InModel;
	if (!Selected.IsNone() && Surface(Selected) == nullptr)
	{
		Selected = NAME_None;
	}
	RebuildInspector();
}

void SWonderlandProjectBrainPanel::Select(FName SurfaceId)
{
	Selected = (SurfaceId.IsNone() || Surface(SurfaceId) == nullptr) ? NAME_None : SurfaceId;
	if (!Selected.IsNone() && !CardTab.IsNone())
	{
		// one thing over the brain at a time: a surface chosen closes C.A.R.D.'s page
		CardTab = NAME_None;
		RebuildCardPage();
	}
	RebuildInspector();
	if (!Selected.IsNone() && ProposalInput.IsValid() && FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetKeyboardFocus(ProposalInput, EFocusCause::SetDirectly);
	}
	else if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetKeyboardFocus(SharedThis(this), EFocusCause::SetDirectly);
	}
}

bool SWonderlandProjectBrainPanel::ProposeToSelected(const FString& Text)
{
	const FWonderlandBrainSurface* Found = Surface(Selected);
	if (Found == nullptr || Found->Access != EWonderlandBrainAccess::Yours || Text.TrimStartAndEnd().IsEmpty())
	{
		return false;
	}
	OnPropose.ExecuteIfBound(Selected, Text);
	return true;
}

void SWonderlandProjectBrainPanel::RebuildInspector()
{
	using namespace WonderlandBrainLook;
	ProposalInput.Reset();
	if (!InspectorBody.IsValid())
	{
		return;
	}
	InspectorBody->ClearChildren();
	const FWonderlandBrainSurface* Found = Surface(Selected);
	if (Found == nullptr)
	{
		return;
	}
	const FName SurfaceId = Found->Id;

	const FSlateBrush* Badge = &SystemBadge;
	FLinearColor BadgeInk = WonderlandUi::Srgb(0xD4, 0xC8, 0xFF);
	FString BadgeText = TEXT("SYSTEM · READ ONLY");
	if (Found->Access == EWonderlandBrainAccess::Yours)
	{
		Badge = &YoursBadge;
		BadgeInk = WonderlandUi::Srgb(0x8E, 0xF5, 0xDD);
		BadgeText = TEXT("YOURS · YOU MAY ADD");
	}
	else if (Found->Access == EWonderlandBrainAccess::Review)
	{
		Badge = &ReviewBadge;
		BadgeInk = WonderlandUi::Srgb(0xFF, 0xD9, 0x86);
		BadgeText = TEXT("REVIEW · ACCEPT OR DECLINE");
	}

	// Header: where it lives, and the way out.
	InspectorBody->AddSlot().AutoHeight()
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
		[
			SNew(STextBlock).Text(FText::FromString(WonderlandBrainText::GroupWord(Found->Group))).Font(Font("Regular", 8, 260)).ColorAndOpacity(Mist())
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
		[
			SNew(SButton).ButtonStyle(&SelectableStyle).ContentPadding(FMargin(8.0f, 2.0f))
			.OnClicked_Lambda([this]() { Select(NAME_None); return FReply::Handled(); })
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("×  ESC"))).Font(Font("Regular", 9, 120)).ColorAndOpacity(Mist())
			]
		]
	];
	InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 8.0f, 0.0f, 0.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Found->Title)).Font(Font("Light", 24, 60)).ColorAndOpacity(BrainInk())
	];
	InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
	[
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
		[
			SNew(SBorder).BorderImage(Badge).Padding(FMargin(10.0f, 4.0f))
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, Found->Access == EWonderlandBrainAccess::System ? 7.0f : 0.0f, 0.0f)
				[
					SNew(SWonderlandBrainIcon).Glyph(EWonderlandBrainGlyph::Lock).Size(13.0f).Color(BadgeInk).Thickness(1.3f)
					.Visibility(Found->Access == EWonderlandBrainAccess::System ? EVisibility::Visible : EVisibility::Collapsed)
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
				[
					SNew(STextBlock).Text(FText::FromString(BadgeText)).Font(Font("Bold", 8, 160)).ColorAndOpacity(BadgeInk)
				]
			]
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(14.0f, 0.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(FText::FromString(FString::Printf(TEXT("ENTRIES %d   ·   BRAIN REVISION %d"), Found->EntryCount, Model.BrainRevision)))
			.Font(Font("Regular", 8, 200)).ColorAndOpacity(Mist())
		]
	];
	InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 12.0f, 0.0f, 0.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Found->Purpose)).Font(Font("Regular", 11)).ColorAndOpacity(Mist()).AutoWrapText(true)
	];
	InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 12.0f)
	[
		SNew(SBox).HeightOverride(1.0f)[SNew(SBorder).BorderImage(&RuleBrush).Padding(0.0f)]
	];

	// The entries: sample lines in the preview, each with the one action its access allows. A surface this build has NO source for (04's
	// skills & mods in Beta; SECOND JUJU's contract r1 §2) says so plainly, and offers nothing that looks like install, enable or buy.
	const bool bNothingInThisBuild = Found->bNotInThisBuild && Found->SampleLines.Num() == 0 && Found->Proposals.Num() == 0;
	InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
	[
		SNew(STextBlock).Text(FText::FromString(bNothingInThisBuild ? TEXT("Nothing here in this build.")
			: Model.bDevelopmentPreview ? TEXT("SAMPLE ENTRIES") : TEXT("ENTRIES")))
		.Font(bNothingInThisBuild ? Font("Regular", 12) : Font("Bold", 8, 240)).ColorAndOpacity(bNothingInThisBuild ? BrainInk() : Violet())
	];
	for (int32 Index = 0; Index < Found->SampleLines.Num(); ++Index)
	{
		TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Top).Padding(2.0f, 6.0f, 10.0f, 0.0f)
			[
				SNew(SBox).WidthOverride(5.0f).HeightOverride(5.0f)[SNew(SBorder).BorderImage(&SelectedBrush).Padding(0.0f)]
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(FText::FromString(Found->SampleLines[Index])).Font(Font("Regular", 12)).ColorAndOpacity(BrainInk()).AutoWrapText(true)
			];
		if (Found->Access == EWonderlandBrainAccess::Review)
		{
			Row->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(10.0f, 0.0f, 6.0f, 0.0f)
			[
				SNew(SButton).ButtonStyle(&ActionStyle)
				.OnClicked_Lambda([this, SurfaceId, Index]() { OnReview.ExecuteIfBound(SurfaceId, Index, true); return FReply::Handled(); })
				[
					SNew(STextBlock).Text(INVTEXT("ACCEPT")).Font(Font("Bold", 8, 140)).ColorAndOpacity(BrainInk())
				]
			];
			Row->AddSlot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SButton).ButtonStyle(&ActionStyle)
				.OnClicked_Lambda([this, SurfaceId, Index]() { OnReview.ExecuteIfBound(SurfaceId, Index, false); return FReply::Handled(); })
				[
					SNew(STextBlock).Text(INVTEXT("DECLINE")).Font(Font("Bold", 8, 140)).ColorAndOpacity(BrainInk())
				]
			];
		}
		InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 7.0f)[Row];
	}

	// What the owner did here: proposals, never changes. NOT SAVED, because they are not (private beta, B29): they live
	// in this session only and are gone after a restart -- "not synced" read as though a copy were kept somewhere.
	if (Found->Proposals.Num() + Found->Reviews.Num() > 0)
	{
		InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 6.0f)
		[
			// LIVE, THESE ARE SAVED: Project Brain holds them as proposals until an owner adopts or declines them.
			SNew(STextBlock).Text(Model.bLive ? INVTEXT("PROPOSED  ·  SAVED IN PROJECT BRAIN") : INVTEXT("PROPOSED  ·  NOT SAVED")).Font(Font("Bold", 8, 240)).ColorAndOpacity(WonderlandUi::Srgb(0xFF, 0xD2, 0x73))
		];
		TArray<FString> Pending = Found->Proposals;
		Pending.Append(Found->Reviews);
		for (const FString& Line : Pending)
		{
			InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 5.0f)
			[
				SNew(STextBlock).Text(FText::FromString(Line)).Font(Font("Italic", 11)).ColorAndOpacity(WonderlandUi::Srgb(0xFF, 0xE3, 0xA6)).AutoWrapText(true)
			];
		}
	}

	InspectorBody->AddSlot().FillHeight(1.0f)[SNew(SSpacer)];

	// The one action, by access.
	if (Found->Access == EWonderlandBrainAccess::Yours)
	{
		InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
			[
				SNew(SBorder).BorderImage(&InputBrush).Padding(FMargin(6.0f, 2.0f))
				[
					SAssignNew(ProposalInput, SEditableTextBox)
					.Style(&InputStyle)
					.HintText(FText::FromString(FString::Printf(TEXT("Propose an addition to %s"), *Found->Title)))
					.ClearKeyboardFocusOnCommit(false)
					.SelectAllTextWhenFocused(false)
					.OnKeyDownHandler_Lambda([this](const FGeometry&, const FKeyEvent& KeyEvent)
					{
						const FKey Key = KeyEvent.GetKey();
						if (Key == EKeys::Enter && ProposalInput.IsValid())
						{
							const FString Text = ProposalInput->GetText().ToString();
							ProposalInput->SetText(FText::GetEmpty());
							ProposeToSelected(Text);
							return FReply::Handled();
						}
						if (Key == EKeys::Escape)
						{
							Select(NAME_None);
							return FReply::Handled();
						}
						return FReply::Unhandled();
					})
				]
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SButton).ButtonStyle(&ActionStyle)
				.OnClicked_Lambda([this]()
				{
					if (ProposalInput.IsValid())
					{
						const FString Text = ProposalInput->GetText().ToString();
						ProposalInput->SetText(FText::GetEmpty());
						ProposeToSelected(Text);
					}
					return FReply::Handled();
				})
				[
					SNew(STextBlock).Text(INVTEXT("PROPOSE")).Font(Font("Bold", 9, 160)).ColorAndOpacity(BrainInk())
				]
			]
		];
	}
	else if (Found->Access == EWonderlandBrainAccess::System)
	{
		InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
			[
				SNew(SWonderlandBrainIcon).Glyph(EWonderlandBrainGlyph::Lock).Size(18.0f).Color(Violet()).Thickness(1.5f)
			]
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				SNew(STextBlock).Text(INVTEXT("System-owned. Julius and Project Brain change it; Wonderland only shows it.")).Font(Font("Regular", 10)).ColorAndOpacity(Mist()).AutoWrapText(true)
			]
		];
	}
	else
	{
		InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock).Text(INVTEXT("Project Brain proposed these. Accept or decline each; nothing is rewritten here.")).Font(Font("Regular", 10)).ColorAndOpacity(Mist()).AutoWrapText(true)
		];
	}

	InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
	[
		SNew(STextBlock)
		// WHAT THE SURFACE IS, SAID PLAINLY: the preview's disclaimer, or -- live -- where the lines come from and what the
		// last write did, in the bridge's own words.
		.Text(Model.bLive
			? FText::FromString(Model.WriteNote.IsEmpty()
				? FString(TEXT("Live: Project Brain on the bridge. Every line is what it holds; proposals and reviews are sent to it and shown once saved."))
				: FString::Printf(TEXT("Live: Project Brain on the bridge. %s"), *Model.WriteNote))
			// the last write's note shows in the preview too (Second's RC13 review: a refused, credential-shaped PROPOSE cleared the
			// input and vanished without a word)
			: FText::FromString(FString(TEXT("Development preview: sample data, nothing sent. A connected Project Brain gives this world counts and revisions, never entry text, until an owner-scoped read is approved."))
				+ (Model.WriteNote.IsEmpty() ? FString() : FString::Printf(TEXT(" %s"), *Model.WriteNote))))
		.Font(Font("Regular", 8)).ColorAndOpacity(Mist(0.8f)).AutoWrapText(true)
	];
}

/* ------------------------------------------------------------------ RELAY DOG SKINS */

bool SWonderlandProjectBrainPanel::GetSkinPreviewRect(FVector2D& OutCentre, FVector2D& OutSize) const
{
	if (!bSkinsOpen || !SkinPreviewWindow.IsValid())
	{
		return false;
	}
	const FGeometry& Window = SkinPreviewWindow->GetCachedGeometry();
	const FGeometry& Whole = GetCachedGeometry();
	const FVector2D WholeSize = Whole.GetAbsoluteSize();
	if (WholeSize.X < 1.0 || WholeSize.Y < 1.0 || Window.GetAbsoluteSize().X < 1.0)
	{
		return false;
	}
	const FVector2D TopLeft = (Window.GetAbsolutePosition() - Whole.GetAbsolutePosition()) / WholeSize;
	OutSize = Window.GetAbsoluteSize() / WholeSize;
	OutCentre = TopLeft + OutSize * 0.5;
	return true;
}

bool SWonderlandProjectBrainPanel::GetBrainSculptureRect(FVector2D& OutCentre, FVector2D& OutSize) const
{
	// ONLY WHILE THE BRAIN IS THE THING ON SHOW. With the wardrobe open the skin preview owns the lens, and two
	// surfaces asking for the same camera in the same frame would fight over it every tick.
	if (bSkinsOpen || !HologramWindow.IsValid())
	{
		UE_LOG(LogTemp, Warning, TEXT("WLBRAINRECT: no rect -- skinsOpen=%d windowValid=%d"),
			bSkinsOpen ? 1 : 0, HologramWindow.IsValid() ? 1 : 0);
		return false;
	}
	const FGeometry& Window = HologramWindow->GetCachedGeometry();
	const FGeometry& Whole = GetCachedGeometry();
	const FVector2D WholeSize = Whole.GetAbsoluteSize();
	if (WholeSize.X < 1.0 || WholeSize.Y < 1.0 || Window.GetAbsoluteSize().X < 1.0)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLBRAINRECT: no rect -- whole=%.1fx%.1f window=%.1fx%.1f"),
			WholeSize.X, WholeSize.Y, Window.GetAbsoluteSize().X, Window.GetAbsoluteSize().Y);
		return false;
	}
	const FVector2D TopLeft = (Window.GetAbsolutePosition() - Whole.GetAbsolutePosition()) / WholeSize;
	OutSize = Window.GetAbsoluteSize() / WholeSize;
	OutCentre = TopLeft + OutSize * 0.5;
	return true;
}

void SWonderlandProjectBrainPanel::SetSculptureLive(bool bLive)
{
	bSculptureLive = bLive;
}

void SWonderlandProjectBrainPanel::SetSkinsOpen(bool bOpen)
{
	if (bSkinsOpen == bOpen)
	{
		return;
	}
	bSkinsOpen = bOpen;
	// THE WARDROBE AND THE INSPECTOR ARE THE SAME PIECE OF SCREEN, so opening one puts the other away. Two glass
	// panels stacked over the brain would leave the player reading through both of them at once.
	if (bSkinsOpen && !Selected.IsNone())
	{
		Select(NAME_None);
	}
	// AND WHOEVER STAGES THE WORLD IS TOLD, from here, so it happens on EVERY route in. See the declaration.
	if (OnSkinsOpenChanged)
	{
		OnSkinsOpenChanged(bSkinsOpen);
	}
}

// QA ONLY (wl.Qa.WardrobeSwatches' control): 1 draws the colourway rows at their full width again, unscaled, so the Wardrobe's
// card list covers the last swatches as it did before the rows were fitted to their column (Second, R7, 10-04). Never set in play.
static TAutoConsoleVariable<int32> CVarWardrobeSwatchOverflowQa(TEXT("wl.Qa.WardrobeOverflow"), 0,
	TEXT("QA only: 1 = the Wardrobe's colourway rows at full width, unscaled (re-creates the R7 overlap for wl.Qa.WardrobeSwatches' control)."));

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeSwatchRow(int32 Which)
{
	using namespace WonderlandBrainLook;
	// 0 PRIMARY, 1 SECONDARY, 2 FLAME (founder, 2026-10-01: the flame skins' fire, on its own row), 3 STRIPS (B65, founder,
	// 2026-10-02: Shadow's strips are COLOR 3, "exposed cleanly in Project Brain -> Wardrobe -> Shadow -> Colorways")
	const bool bPrimary = Which == 0;
	const bool bFlame = Which == 2;
	const bool bStrip = Which == 3;
	TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox);
	Row->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
	[
		SNew(SBox).WidthOverride(74.0f)
		[
			SNew(STextBlock)
			.Text(bStrip ? INVTEXT("STRIPS") : bFlame ? INVTEXT("FLAME") : (bPrimary ? INVTEXT("PRIMARY") : INVTEXT("SECONDARY")))
			.Font(Font("Bold", 8, 200)).ColorAndOpacity(Mist(0.95f))
		]
	];
	// THE PRIMARY ROW OFFERS A TRUE WHITE AND BLACK after DEFAULT (founder, 2026-10-02), the Menu's MASCOT PRIMARY row the same.
	// THE STRIPS ROW OFFERS THE SAME (white strips and black strips are both real choices, DEFAULT the designed ones).
	// each swatch named for QA (wl.Qa.WardrobeSwatches hit-tests its centre against its own button): row word and colour
	const TCHAR* const RowWord = bStrip ? TEXT("STRIPS") : bFlame ? TEXT("FLAME") : (bPrimary ? TEXT("PRIMARY") : TEXT("SECONDARY"));
	for (const TPair<FName, FLinearColor>& Swatch : (bPrimary || bStrip) ? WonderlandMascotStyle::PrimaryPalette() : WonderlandMascotStyle::Palette())
	{
		const FLinearColor Colour = Swatch.Value;
		const FName Label = Swatch.Key;
		Row->AddSlot().AutoWidth().Padding(0.0f, 0.0f, 5.0f, 0.0f)
		[
			SNew(SButton)
			.Tag(FName(*FString::Printf(TEXT("WardrobeSwatch.%s.%s"), RowWord, *Label.ToString())))
			.ButtonStyle(&SwatchStyle)
			.ToolTipText(FText::FromName(Label))
			.OnClicked_Lambda([bPrimary, bFlame, bStrip, Colour, Label]()
			{
				// THE STRIPS ARE THEIR OWN STATE TOO, read and written by the Menu's STRIPS row (WonderlandMascotStyle).
				if (bStrip)
				{
					WonderlandMascotStyle::PickMascotStrip(Label, Colour);
					return FReply::Handled();
				}
				// THE FLAME IS ITS OWN STATE, read and written by the Menu's FLAME row too (WonderlandMascotStyle).
				if (bFlame)
				{
					WonderlandMascotStyle::SetFlameColour(Colour);
					WonderlandMascotStyle::SaveAndApply();
					return FReply::Handled();
				}
				// THE PRIMARY KNOWS ITS SWATCH: DEFAULT and WHITE are both (1,1,1) (WonderlandMascotStyle::PrimaryPalette).
				if (bPrimary)
				{
					WonderlandMascotStyle::PickMascotPrimary(Label, Colour);
					return FReply::Handled();
				}
				// ONE CANONICAL STATE, WRITTEN FROM BOTH PLACES. The founder's rule: "Wardrobe color controls
				// and Menu mascot-color controls must read/write the SAME canonical customization state." This
				// is that state, and SaveAndApply is the only path from it to a repainted world -- so the
				// preview, the Dog in the world and the Menu's own swatches all move on this one click.
				if (UWonderlandMascotStyleSettings* Style = GetMutableDefault<UWonderlandMascotStyleSettings>())
				{
					(bPrimary ? Style->Primary : Style->Secondary) = Colour;
					Style->bChosen = true;
					Style->bSecondaryChosen |= !bPrimary;
					WonderlandMascotStyle::SaveAndApply();
				}
				return FReply::Handled();
			})
			[
				SNew(SBox).WidthOverride(18.0f).HeightOverride(18.0f)
				[
					SNew(SOverlay)
					+ SOverlay::Slot()[SNew(SImage).Image(&SwatchBrush).ColorAndOpacity(FSlateColor(Colour))]
					// THE RING SAYS WHICH ONE IS ON, and it is drawn from the SETTINGS rather than remembered
					// here: a colour chosen in the Menu while this panel is open must light up here too.
					+ SOverlay::Slot()
					[
						SNew(SImage).Image(&SwatchRingBrush)
						.Visibility_Lambda([bPrimary, bFlame, bStrip, Colour, Label]()
						{
							if (bStrip)
							{
								return WonderlandMascotStyle::IsMascotStripOn(Label, Colour)
									? EVisibility::HitTestInvisible : EVisibility::Hidden;
							}
							if (bFlame)
							{
								return WonderlandMascotStyle::FlameColour().Equals(Colour, 0.01f)
									? EVisibility::HitTestInvisible : EVisibility::Hidden;
							}
							if (bPrimary)
							{
								return WonderlandMascotStyle::IsMascotPrimaryOn(Label, Colour)
									? EVisibility::HitTestInvisible : EVisibility::Hidden;
							}
							const UWonderlandMascotStyleSettings& Style = UWonderlandMascotStyleSettings::Get();
							const FLinearColor Now = bPrimary ? Style.Primary : Style.Secondary;
							return Style.bChosen && Now.Equals(Colour, 0.01f)
								? EVisibility::HitTestInvisible : EVisibility::Hidden;
						})
					]
				]
			]
		];
	}
	return Row;
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeColourStrip()
{
	using namespace WonderlandBrainLook;
	// FOUNDER, 2026-09-25: "Add color controls directly inside the Wardrobe because this is where the player is
	// visually inspecting the skin ... Integrate the color controls cleanly without turning Wardrobe into a
	// crowded settings panel. The preview should remain the visual focus."
	//
	// So: rows of chips under the preview, no headings beyond the row words, no sliders, no picker dialog.
	// PRIMARY is the shell every skin shares; SECONDARY is the status eyes and a skin's secondary accents -- the
	// surfaces its figure tags `secondary`, which on Jack Flame are the tie and the suit; FLAME, shown only on a skin
	// with fire, is that fire on its own (founder, 2026-10-01). Halos, banners and the black visor are never reached.
	//
	// THE ROWS FIT THEIR OWN COLUMN (Second, R7, 10-04: with Shadow Flame worn, the PRIMARY row's JADE, ROSE, SLATE and OBSIDIAN and
	// the SECONDARY row's last swatches ran past the preview column's right edge, under the skin-card list beside it, and a click there
	// hit the card). A row of fifteen 18 uu swatches is ~430 uu wide; the column is ~325 at the founder's window. So the block is
	// scaled DOWN -- uniformly, all rows alike, never up -- to the column's width: the same rows, colours, order and words, in place;
	// at a window wide enough for them nothing changes. The note below stays outside and wraps as before.
	return SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SScaleBox)
			.Stretch_Lambda([]() { return CVarWardrobeSwatchOverflowQa.GetValueOnGameThread() != 0 ? EStretch::None : EStretch::ScaleToFitX; })
			.StretchDirection(EStretchDirection::DownOnly)
			.HAlign(HAlign_Left)
			.VAlign(VAlign_Top)
			[
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 6.0f)
		[
			SNew(STextBlock).Text(INVTEXT("COLOURWAY"))
			.Font(Font("Bold", 8, 260)).ColorAndOpacity(Violet(0.95f))
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 5.0f)[MakeSwatchRow(0)]
		+ SVerticalBox::Slot().AutoHeight()[MakeSwatchRow(1)]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)
		[
			SNew(SBox)
			.Visibility_Lambda([]() { return WonderlandMascotStyle::WornSkinHasFlame() ? EVisibility::Visible : EVisibility::Collapsed; })
			[
				MakeSwatchRow(2)
			]
		]
		// COLOR 3, shown only on a skin with strips (Shadow), as FLAME is only on a skin with fire
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)
		[
			SNew(SBox)
			.Visibility_Lambda([]() { return WonderlandMascotStyle::WornSkinHasStrips() ? EVisibility::Visible : EVisibility::Collapsed; })
			[
				MakeSwatchRow(3)
			]
		]
			]
		]
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 7.0f, 0.0f, 0.0f)
		[
			SNew(STextBlock)
			.Text(INVTEXT("PRIMARY paints the shell, SECONDARY the status eyes and the skin's secondary accents (Jack Flame's tie and suit), FLAME the skin's fire, STRIPS Shadow's flowing strips. Halos and the visor are left as designed."))
			.Font(Font("Regular", 7, 180)).ColorAndOpacity(Mist(0.75f))
			.AutoWrapText(true)
		];
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeSkinCard(const FWonderlandRelaySkin& Skin)
{
	using namespace WonderlandBrainLook;
	const FName SkinId = Skin.SkinId;
	const bool bLocked = Skin.Access == EWonderlandSkinAccess::Locked;

	const auto IsWorn = [this, SkinId]() { return EquippedSkin.IsSet() && EquippedSkin.Get() == SkinId; };

	return SNew(SButton)
		.ButtonStyle(&SelectableStyle)
		.IsEnabled(!bLocked)
		.OnClicked_Lambda([this, SkinId]()
		{
			// CLICKING A CARD ASKS; IT DOES NOT DRESS. The registry decides whether the skin may be worn, the stage's
			// Dog hears that it changed and re-dresses itself, and this panel finds out the same way everything else
			// does -- by reading the equipped id back. One authority over what the Dog is wearing, not two.
			OnChooseSkin.ExecuteIfBound(SkinId);
			return FReply::Handled();
		})
		[
			SNew(SBorder)
			.BorderImage(&CardBrush)
			.Padding(FMargin(12.0f, 9.0f))
			[
				SNew(SHorizontalBox)
				// The accent stripe: this skin's colour, and how a card is told apart at a glance.
				+ SHorizontalBox::Slot().AutoWidth().Padding(0.0f, 0.0f, 11.0f, 0.0f)
				[
					SNew(SBox).WidthOverride(3.0f)
					[
						SNew(SImage).Image(&StatusBrush)
						.ColorAndOpacity(FSlateColor(Skin.Accent.CopyWithNewOpacity(bLocked ? 0.28f : 1.0f)))
					]
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().AutoHeight()
					[
						SNew(SHorizontalBox)
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(FText::FromString(Skin.DisplayName))
							.Font(Font("Bold", 11, 130)).ColorAndOpacity(BrainInk(bLocked ? 0.45f : 1.0f))
						]
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(10.0f, 0.0f, 0.0f, 0.0f)
						[
							SNew(STextBlock).Text(FText::FromString(Skin.Family))
							.Font(Font("Regular", 8, 200)).ColorAndOpacity(Mist(0.8f))
						]
						+ SHorizontalBox::Slot().FillWidth(1.0f)[SNew(SSpacer)]
						// WORN, said on the card rather than only under the figure, so a list of seven can be read
						// without looking away from it.
						+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
						[
							SNew(STextBlock).Text(INVTEXT("WORN"))
							.Font(Font("Bold", 8, 220)).ColorAndOpacity(Violet())
							.Visibility_Lambda([IsWorn]() { return IsWorn() ? EVisibility::Visible : EVisibility::Hidden; })
						]
					]
					+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)
					[
						SNew(STextBlock).Text(FText::FromString(Skin.Summary))
						.Font(Font("Regular", 9)).ColorAndOpacity(Mist(bLocked ? 0.4f : 0.92f))
						.AutoWrapText(true)
					]
				]
			]
		];
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeSkinsView()
{
	using namespace WonderlandBrainLook;

	TSharedRef<SVerticalBox> Cards = SNew(SVerticalBox);
	for (const FWonderlandRelaySkin& Skin : Skins)
	{
		Cards->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 7.0f)[MakeSkinCard(Skin)];
	}

	// THE NAME AND THE PROVENANCE OF WHAT IS ON THE PLINTH, read back from the equipped id rather than remembered
	// here, so a skin changed from the console or by a remote authority shows the same answer as one clicked.
	const auto Worn = [this]() -> const FWonderlandRelaySkin*
	{
		const FName Id = EquippedSkin.IsSet() ? EquippedSkin.Get() : NAME_None;
		return Skins.FindByPredicate([Id](const FWonderlandRelaySkin& Skin) { return Skin.SkinId == Id; });
	};

	// THE WARDROBE IS BUILT AROUND A HOLE. Slate cannot paint a filled panel with a window cut out of it, so the panel
	// is an outline only, and every surface that is not the window -- the header, the wardrobe column, the caption
	// under the window, the footer, the margin -- carries its own solid. What is left unpainted is exactly the window,
	// and the world shows through it undimmed with the founder's own Relay Dog stood in it.
	const auto Solid = [this](const FMargin& Padding, TSharedRef<SWidget> Content) -> TSharedRef<SWidget>
	{
		return SNew(SBorder).BorderImage(&SkinPanelSolidBrush).Padding(Padding)[Content];
	};

	return SNew(SBorder)
		.Visibility_Lambda([this]() { return bSkinsOpen ? EVisibility::Visible : EVisibility::Collapsed; })
		.BorderImage(&SkinPanelFrameBrush)
		.Padding(FMargin(0.0f))
		[
			SNew(SVerticalBox)
			// ---- the header, on its own solid
			+ SVerticalBox::Slot().AutoHeight()
			[
				Solid(FMargin(22.0f, 18.0f, 22.0f, 12.0f),
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(STextBlock).Text(INVTEXT("RELAY DOG")).Font(Font("Light", 26, 300)).ColorAndOpacity(BrainInk())
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(1.0f, 5.0f, 0.0f, 0.0f)
						[
							// THE RULE, WRITTEN WHERE THE CHOICE IS MADE. A wardrobe is exactly the place a player would
							// expect a skin to matter, so the panel says plainly that it does not.
							SNew(STextBlock).Text(INVTEXT("ONE DOG   ·   MANY SKINS   ·   THE SAME JULIUS, THE SAME AUTHORITY"))
							.Font(Font("Regular", 9, 260)).ColorAndOpacity(Mist())
						]
					]
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Top)
					[
						SNew(SButton).ButtonStyle(&ActionStyle)
						.OnClicked_Lambda([this]() { SetSkinsOpen(false); return FReply::Handled(); })
						[
							SNew(STextBlock).Text(INVTEXT("CLOSE   Esc")).Font(Font("Bold", 9, 200)).ColorAndOpacity(Mist())
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 14.0f, 0.0f, 0.0f)
				[
					SNew(SBox).HeightOverride(1.0f)[SNew(SImage).Image(&RuleBrush)]
				])
			]
			// ---- the window, and the wardrobe beside it
			+ SVerticalBox::Slot().FillHeight(1.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth()
				[
					Solid(FMargin(0.0f), SNew(SBox).WidthOverride(22.0f))
				]
				+ SHorizontalBox::Slot().FillWidth(1.05f)
				[
					SNew(SVerticalBox)
					+ SVerticalBox::Slot().FillHeight(1.0f)
					[
						// THE WINDOW. Nothing is drawn inside this frame on purpose, and nothing is drawn behind it:
						// Slate composites over the world, so this unpainted region is a hole the world shows through,
						// and the wardrobe camera stands the founder's own Relay Dog in it. What is seen here is the
						// Dog itself -- live, lit by the world, breathing, and wearing what the registry says -- not a
						// capture and not a still. The scene capture this replaced wrote pure white in this build under
						// ten configurations; the filled panel that first stood behind this frame tinted the Dog navy.
						SNew(SOverlay)
						+ SOverlay::Slot()
						[
							SAssignNew(SkinPreviewWindow, SBorder).BorderImage(&SkinWindowFrameBrush).Padding(FMargin(6.0f))
							.Visibility(EVisibility::HitTestInvisible)
							[
								SNew(SVerticalBox)
								+ SVerticalBox::Slot().FillHeight(1.0f)
								[
									// ---- THE MASCOT, PAINTED FROM THE STAGE'S OWN CAMERA.
									//
									// FOUNDER, twice: "It must render a dedicated mascot preview presentation that
									// cannot accidentally become: the Project Brain sculpture, the live Wonderland
									// world, an empty camera, an incorrectly scaled mascot" and "Use a dedicated
									// deterministic preview representation/capture rig."
									//
									// This brush is the stage's render target and the panel has been building it all
									// along without ever drawing it -- the window was left as a bare hole with a
									// caption, showing whatever the player's camera happened to be pointing at. That
									// is why this square has shown, across successive sessions, the brain chamber,
									// the garden, a staircase, the Dog's back, and a nearly black frame.
									//
									// The capture cannot do any of that. It renders PRM_UseShowOnlyList with only the
									// body and the stage in the list, through its own 34 degree lens, with atmosphere
									// and fog off and exposure pinned manually -- so the world is not merely unlikely
									// to appear, it is structurally unable to.
									SNew(SImage)
									.Image(SkinPreviewBrush)
									.Visibility_Lambda([this]()
									{
										return SkinPreviewBrush != nullptr ? EVisibility::HitTestInvisible
																		   : EVisibility::Collapsed;
									})
								]
								+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(0.0f, 0.0f, 0.0f, 6.0f)
								[
									SNew(STextBlock)
									.Text(INVTEXT("LIVE  \u00B7  THIS IS YOUR RELAY DOG, IN THE WORLD"))
									.Font(Font("Regular", 8, 200)).ColorAndOpacity(Mist(0.85f))
									.ShadowOffset(FVector2D(1.0f, 1.0f)).ShadowColorAndOpacity(FLinearColor(0.0f, 0.0f, 0.0f, 0.8f))
								]
							]
						]
						// ---- THE 360 CONTROL, INSIDE THE PREVIEW SQUARE AT ITS TOP RIGHT (founder, 2026-09-25).
						//
						// IT CANNOT LIVE INSIDE THE WINDOW ITSELF. That border is HitTestInvisible on purpose -- it is a
						// hole the world is seen through, and a hit-testable widget stretched over a hole swallows the
						// clicks meant for what is behind it. So the window and the button are SIBLINGS in an overlay:
						// the button is the only hit-testable thing in the square, and it is forty pixels of its corner.
						+ SOverlay::Slot().HAlign(HAlign_Right).VAlign(VAlign_Top).Padding(0.0f, 14.0f, 14.0f, 0.0f)
						[
							SNew(SButton)
							.ButtonStyle(&InspectStyle)
							.ToolTipText(INVTEXT("Turn the mascot slowly through front, side, back and side. Press again to stop."))
							.OnClicked_Lambda([this]() { OnToggleInspect.ExecuteIfBound(); return FReply::Handled(); })
							[
								SNew(SHorizontalBox)
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 6.0f, 0.0f)
								[
									SNew(SWonderlandBrainIcon).Glyph(EWonderlandBrainGlyph::Arrows).Size(13.0f)
									// ONE COLOUR FOR THE GLYPH: SWonderlandBrainIcon takes a plain colour, not an attribute, and the
									// label beside it already says which state the control is in.
									.Color(WonderlandBrainLook::Beam(0.95f))
									.Thickness(1.3f)
								]
								+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
								[
									SNew(STextBlock)
									.Text_Lambda([this]()
									{
										return IsInspecting.Get(false) ? INVTEXT("360°  STOP") : INVTEXT("360°  VIEW");
									})
									.Font(Font("Bold", 8, 220))
									.ColorAndOpacity_Lambda([this]()
									{
										return FSlateColor(IsInspecting.Get(false) ? FLinearColor::White : WonderlandBrainLook::Beam(0.95f));
									})
								]
							]
						]
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						Solid(FMargin(2.0f, 12.0f, 0.0f, 0.0f),
						SNew(SVerticalBox)
						+ SVerticalBox::Slot().AutoHeight()
						[
							SNew(STextBlock)
							.Text_Lambda([Worn]()
							{
								const FWonderlandRelaySkin* Skin = Worn();
								return FText::FromString(Skin != nullptr ? Skin->DisplayName : TEXT("RELAY OG"));
							})
							.Font(Font("Bold", 14, 160)).ColorAndOpacity(BrainInk())
						]
						+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)
						[
							// WHO GRANTED IT, said every time. No account authority grants skins in this build, so every
							// skin but the Dog's own form reads DEVELOPMENT PREVIEW and none of them may read as owned.
							SNew(STextBlock)
							.Text_Lambda([Worn]()
							{
								const FWonderlandRelaySkin* Skin = Worn();
								if (Skin == nullptr)
								{
									return INVTEXT("—");
								}
								switch (Skin->Access)
								{
								case EWonderlandSkinAccess::Owned:
									return Skin->bIsBaseForm ? INVTEXT("THE DOG'S OWN FORM") : INVTEXT("OWNED");
								case EWonderlandSkinAccess::Locked:
									return INVTEXT("LOCKED");
								default:
									return INVTEXT("DEVELOPMENT PREVIEW   ·   NO ACCOUNT HAS GRANTED THIS");
								}
							})
							.Font(Font("Regular", 8, 200)).ColorAndOpacity(WonderlandUi::Srgb(0xFF, 0xD2, 0x73))
						])
					]
					+ SVerticalBox::Slot().AutoHeight()
					[
						Solid(FMargin(2.0f, 14.0f, 0.0f, 2.0f), MakeColourStrip())
					]
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f)
				[
					Solid(FMargin(16.0f, 0.0f, 22.0f, 0.0f),
					SNew(SScrollBox)
					+ SScrollBox::Slot()[Cards])
				]
			]
			// ---- the footer
			+ SVerticalBox::Slot().AutoHeight()
			[
				Solid(FMargin(22.0f, 14.0f, 22.0f, 18.0f),
				SNew(STextBlock)
				.Text(INVTEXT("A skin changes appearance only. It does not change what Julius may do, what the Dog is allowed to decide, or what the status eyes mean."))
				.Font(Font("Regular", 9)).ColorAndOpacity(Mist(0.85f)).AutoWrapText(true))
			]
		];
}

FReply SWonderlandProjectBrainPanel::OnKeyDown(const FGeometry& MyGeometry, const FKeyEvent& InKeyEvent)
{
	const FKey Key = InKeyEvent.GetKey();
	if (Key == EKeys::Escape)
	{
		// ONE THING AT A TIME, AND ONE STEP BACK AT A TIME. Escape shuts whatever is open over the brain before it
		// shuts the brain: a key that closed the whole panel from inside the wardrobe would lose the player's place.
		if (bSkinsOpen)
		{
			SetSkinsOpen(false);
		}
		else if (!CardTab.IsNone())
		{
			OpenCardTab(NAME_None);
		}
		else if (!Selected.IsNone())
		{
			Select(NAME_None);
		}
		else
		{
			OnRequestClose.ExecuteIfBound();
		}
		return FReply::Handled();
	}
	if (Key == EKeys::B)
	{
		OnRequestClose.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::M)
	{
		OnRequestMap.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::W && Selected.IsNone())
	{
		OnRequestWonderWeb.ExecuteIfBound();
		return FReply::Handled();
	}
	if (Key == EKeys::T && InKeyEvent.IsControlDown())
	{
		OnRequestTerminal.ExecuteIfBound();
		return FReply::Handled();
	}
	return SCompoundWidget::OnKeyDown(MyGeometry, InKeyEvent);
}

// ================================================================================================================= 05 C.A.R.D.
// The fifth Project Brain component (founder, 2026-10-02: "Re-layout into five sections"). Read live from WonderlandCardView and
// changed only through WonderlandCardDirector, the same path as the Live Terminal's /card: the panel keeps no C.A.R.D. state.

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeCardStrip()
{
	using namespace WonderlandBrainLook;
	return SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)
		[
			MakeCardTile(TEXT("handoff"), EWonderlandBrainGlyph::Sparkle, TEXT("handoff"),
				[this]() { return CardView.HandoffForm.IsEmpty() ? FString(TEXT("—")) : FString::Printf(TEXT("%s · %s"), *CardView.HandoffForm, *CardView.HandoffState); },
				[this]() { return CardView.HandoffState == TEXT("HELD") ? CardStatusColour(EWonderlandCardStatus::Ready) : Mist(0.55f); })
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)
		[
			// MASCOT & VISUAL MODS' way in (founder, 2026-10-06; SECOND JUJU's contract r1 §4): the tab id stays "mascot", the value line
			// stays the worn look
			MakeCardTile(TEXT("mascot"), EWonderlandBrainGlyph::Person, TEXT("mascot & visual mods"),
				[this]() { return FString::Printf(TEXT("%s · %s%s"), *CardView.Skin.ToUpper(), *CardView.Primary, CardView.bModified ? TEXT(" · MODIFIED") : TEXT("")); },
				[this]() { return CardView.bModified ? CardStatusColour(EWonderlandCardStatus::Unconfigured) : Mist(0.55f); })
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)
		[
			MakeCardTile(TEXT("companions"), EWonderlandBrainGlyph::People, TEXT("companions"),
				[this]() { return CardView.Companions.Num() < 2 ? FString(TEXT("—"))
					: FString::Printf(TEXT("%s · %s"), *CardView.Companions[0].Label.ToUpper(), *CardView.Companions[1].Label.ToUpper()); },
				[this]() { return CardWorstColour(CardView.Companions); })
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)
		[
			MakeCardTile(TEXT("capabilities"), EWonderlandBrainGlyph::Link, TEXT("skills_mcp"),
				[this]() { return CardView.Capabilities.Num() == 0 ? FString(TEXT("NONE ATTACHED"))
					: FString::Printf(TEXT("%d ATTACHED · %d READY"), CardView.Capabilities.Num(), CardView.CountCapabilities(EWonderlandCardStatus::Ready)); },
				[this]() { return CardWorstColour(CardView.Capabilities); })
		]
		+ SHorizontalBox::Slot().FillWidth(1.0f)
		[
			MakeCardTile(TEXT("saved"), EWonderlandBrainGlyph::Layers, TEXT("saved_cards"),
				[this]() { return FString::Printf(TEXT("%s · %d SAVED"), *CardView.ActiveName.ToUpper(), CardView.Cards.Num()); },
				[]() { return Violet(0.8f); })
		];
}

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeCardTile(FName Tab, EWonderlandBrainGlyph Glyph, const TCHAR* Caption,
	TFunction<FString()> Value, TFunction<FLinearColor()> Dot)
{
	using namespace WonderlandBrainLook;
	static const FSlateRoundedBoxBrush DotBrush(FLinearColor::White, 3.5f);
	return SNew(SBorder)
		.BorderImage_Lambda([this, Tab]() -> const FSlateBrush* { return CardTab == Tab ? &SelectedBrush : &CardBrush; })
		.Padding(FMargin(0.0f))
		[
			SNew(SButton)
			.ButtonStyle(&SelectableStyle)
			.ContentPadding(FMargin(0.0f))
			.OnClicked_Lambda([this, Tab]() { OpenCardTab(CardTab == Tab ? NAME_None : Tab); return FReply::Handled(); })
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight().Padding(10.0f, 8.0f, 9.0f, 3.0f)
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 7.0f, 0.0f)
					[
						SNew(SWonderlandBrainIcon).Glyph(Glyph).Size(16.0f).Color(Violet()).Thickness(1.4f)
					]
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Text(FText::FromString(Caption)).Font(Font("Regular", 9, 40)).ColorAndOpacity(BrainInk(0.95f))
						.OverflowPolicy(ETextOverflowPolicy::Ellipsis)
					]
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(6.0f, 0.0f, 0.0f, 0.0f)
					[
						SNew(SBox).WidthOverride(7.0f).HeightOverride(7.0f)
						[
							SNew(SImage).Image(&DotBrush).ColorAndOpacity_Lambda([Dot]() { return FSlateColor(Dot()); })
						]
					]
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(10.0f, 0.0f, 9.0f, 8.0f)
				[
					SNew(STextBlock).Text_Lambda([Value]() { return FText::FromString(Value()); }).Font(Font("Bold", 8, 60)).ColorAndOpacity(BrainInk(0.8f))
					.AutoWrapText(true)
				]
			]
		];
}

void SWonderlandProjectBrainPanel::OpenCardTab(FName Tab)
{
	CardTab = Tab;
	if (!CardTab.IsNone())
	{
		// ONE THING OVER THE BRAIN AT A TIME: the inspector and the wardrobe step aside for the page
		if (!Selected.IsNone())
		{
			Selected = NAME_None;
			RebuildInspector();
		}
		if (bSkinsOpen)
		{
			SetSkinsOpen(false);
		}
	}
	RefreshCardView(true);
	RebuildCardPage();
	if (FSlateApplication::IsInitialized())
	{
		FSlateApplication::Get().SetKeyboardFocus(SharedThis(this), EFocusCause::SetDirectly);
	}
}

void SWonderlandProjectBrainPanel::RefreshCardView(bool bForce)
{
	const double Now = FPlatformTime::Seconds();
	if (!bForce && CardViewAt >= 0.0 && Now - CardViewAt < 0.25)
	{
		return;
	}
	CardViewAt = Now;
	CardView = WonderlandCardView::Build(CardWorld.Get());
}

void SWonderlandProjectBrainPanel::Tick(const FGeometry& AllottedGeometry, const double InCurrentTime, const float InDeltaTime)
{
	SCompoundWidget::Tick(AllottedGeometry, InCurrentTime, InDeltaTime);
	RefreshCardView(false);
	if (!CardTab.IsNone() && WonderlandBrainLook::CardSignature(CardView, CardTab) != CardPageShown)
	{
		RebuildCardPage();
	}
}

void SWonderlandProjectBrainPanel::RebuildCardPage()
{
	using namespace WonderlandBrainLook;
	if (!CardPageBody.IsValid())
	{
		return;
	}
	CardPageBody->ClearChildren();
	CardPageShown = CardSignature(CardView, CardTab);
	if (CardTab.IsNone())
	{
		return;
	}
	static const FSlateRoundedBoxBrush DotBrush(FLinearColor::White, 4.0f);
	const FWonderlandCardView& V = CardView;
	const FString TabId = CardTab.ToString();
	auto Add = [this](TSharedRef<SWidget> Widget, float Top)
	{
		CardPageBody->AddSlot().AutoHeight().Padding(0.0f, Top, 0.0f, 0.0f)[Widget];
	};
	auto Line = [](const FString& Text, const FSlateFontInfo& FontInfo, const FLinearColor& Colour) -> TSharedRef<SWidget>
	{
		return SNew(STextBlock).Text(FText::FromString(Text)).Font(FontInfo).ColorAndOpacity(Colour).AutoWrapText(true);
	};
	// EVERY ACTION GOES THROUGH THE DIRECTOR, and the page is redrawn on the NEXT tick -- never inside the click that changed it
	auto Act = [this](const FString& Label, TFunction<void(UWorld*)> Do) -> TSharedRef<SWidget>
	{
		return SNew(SButton).ButtonStyle(&ActionStyle)
			.OnClicked_Lambda([this, Do]()
			{
				if (UWorld* World = CardWorld.Get())
				{
					Do(World);
				}
				RefreshCardView(true);
				CardPageShown.Reset();
				return FReply::Handled();
			})
			[
				SNew(STextBlock).Text(FText::FromString(Label)).Font(Font("Bold", 9, 160)).ColorAndOpacity(BrainInk())
			];
	};
	auto RefRow = [&Line](const FWonderlandCardViewRef& Ref) -> TSharedRef<SWidget>
	{
		return SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 8.0f, 0.0f)
				[
					SNew(SBox).WidthOverride(8.0f).HeightOverride(8.0f)
					[
						SNew(SImage).Image(&DotBrush).ColorAndOpacity(FSlateColor(CardStatusColour(Ref.Status)))
					]
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 10.0f, 0.0f)
				[
					Line(Ref.Title, Font("Regular", 8, 220), Mist())
				]
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					Line(Ref.Label, Font("Bold", 11, 40), BrainInk())
				]
				+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(10.0f, 0.0f, 0.0f, 0.0f)
				[
					Line(FString(WonderlandCardCapabilities::StatusWord(Ref.Status)) + (Ref.bSimulated ? TEXT(" · SIMULATED") : TEXT("")),
						Font("Bold", 8, 160), CardStatusColour(Ref.Status))
				]
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(16.0f, 3.0f, 0.0f, 0.0f)
			[
				Line(Ref.Reason, Font("Regular", 9), Mist())
			];
	};

	const TCHAR* Title = TabId == TEXT("handoff") ? TEXT("MISSION HANDOFF") : TabId == TEXT("mascot") ? TEXT("MASCOT & VISUAL MODS")
		: TabId == TEXT("companions") ? TEXT("COMPANIONS · IMPORTED AI") : TabId == TEXT("capabilities") ? TEXT("SKILLS · MCP · APIs") : TEXT("SAVED C.A.R.D.s");
	Add(SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
		[
			Line(FString::Printf(TEXT("05  C.A.R.D.  ·  %s"), Title), Font("Regular", 8, 260), Mist())
		]
		+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center)
		[
			SNew(SButton).ButtonStyle(&SelectableStyle).ContentPadding(FMargin(8.0f, 2.0f))
			.OnClicked_Lambda([this]() { OpenCardTab(NAME_None); return FReply::Handled(); })
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("×  ESC"))).Font(Font("Regular", 9, 120)).ColorAndOpacity(Mist())
			]
		], 0.0f);
	if (!V.bAvailable)
	{
		Add(Line(V.Unavailable, Font("Regular", 11), BrainInk()), 12.0f);
		return;
	}
	Add(Line(FString::Printf(TEXT("ACTIVE  %s"), *V.ActiveName.ToUpper()), Font("Light", 22, 120), BrainInk()), 8.0f);
	if (V.bModified)
	{
		Add(SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
			[
				Line(FString::Printf(TEXT("MODIFIED — %s"), *V.ModifiedWhat), Font("Regular", 9), CardStatusColour(EWonderlandCardStatus::Unconfigured))
			]
			+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(10.0f, 0.0f, 0.0f, 0.0f)
			[
				Act(TEXT("SAVE TO C.A.R.D."), [](UWorld* World) { FString Said; WonderlandCardDirector::SaveLiveToActive(World, Said); })
			], 6.0f);
	}

	if (TabId == TEXT("handoff"))
	{
		Add(Line(FString::Printf(TEXT("%s  ·  %s"), *V.HandoffForm, *V.HandoffState), Font("Bold", 13, 80), BrainInk()), 16.0f);
		Add(Line(TEXT("GOLD SWORD · LEFT HAND — the LLM Companion"), Font("Regular", 11), BrainInk(0.9f)), 12.0f);
		Add(Line(TEXT("CYAN SWORD · RIGHT HAND — Jhinn"), Font("Regular", 11), BrainInk(0.9f)), 4.0f);
		Add(Line(TEXT("Hand off from the Live Terminal with /handoff, mid-mission or roaming: the mission carries on, and you roam with the swords. "
			"Double-tap W to dash. /handoff again gives them back."), Font("Regular", 9), Mist()), 14.0f);
		Add(Line(TEXT("The form comes from the active C.A.R.D. when a handoff begins; swords already held never change in the hand."),
			Font("Regular", 9), Mist()), 6.0f);
	}
	else if (TabId == TEXT("mascot"))
	{
		// MASCOT & VISUAL MODS (founder, 2026-10-06; SECOND JUJU's contract r1 §4): how the loadout LOOKS. In Beta it holds three things --
		// this card's mascot, the mascot skins (the wardrobe, which 02 used to open), and Shadow Flame's colourways (inside the wardrobe, as
		// before). The other visual-mod kinds have no source in this build and are not shown.
		Add(Line(TEXT("MASCOT"), Font("Bold", 8, 240), Violet()), 16.0f);
		Add(Line(FString::Printf(TEXT("SKIN  %s"), *V.Skin.ToUpper()), Font("Bold", 13, 80), BrainInk()), 8.0f);
		Add(Line(FString::Printf(TEXT("PRIMARY  %s"), *V.Primary), Font("Bold", 13, 80), BrainInk()), 6.0f);
		// COLOR 2 AND COLOR 3 AND THE FLAME, as this card holds them (founder, 2026-10-04: the three colours through the C.A.R.D.)
		Add(Line(FString::Printf(TEXT("COLOR 2 · ACCENTS / MARBLING  %s"), *V.Colour2), Font("Bold", 10, 80), BrainInk(0.9f)), 6.0f);
		Add(Line(FString::Printf(TEXT("COLOR 3 · STRIPS  %s"), *V.Colour3), Font("Bold", 10, 80), BrainInk(0.9f)), 4.0f);
		Add(Line(FString::Printf(TEXT("FLAME  %s"), *V.Flame), Font("Bold", 10, 80), BrainInk(0.9f)), 4.0f);
		Add(Line(TEXT("MASCOT SKINS"), Font("Bold", 8, 240), Violet()), 16.0f);
		Add(SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()
			[
				SNew(SButton).ButtonStyle(&ActionStyle)
				.OnClicked_Lambda([this]() { SetSkinsOpen(true); return FReply::Handled(); })
				[
					SNew(STextBlock).Text(FText::FromString(TEXT("OPEN WARDROBE"))).Font(Font("Bold", 9, 160)).ColorAndOpacity(BrainInk())
				]
			], 8.0f);
		Add(Line(TEXT("SHADOW FLAME"), Font("Bold", 8, 240), Violet()), 16.0f);
		Add(Line(TEXT("Shadow Flame's colourways are in the wardrobe: choose Shadow Flame there, then its colours."), Font("Regular", 9), Mist()), 6.0f);
		Add(Line(TEXT("Pick a skin or a colour in the wardrobe, then SAVE TO C.A.R.D. to keep that look in this loadout. Selecting a C.A.R.D. "
			"puts its look on through the wardrobe's own door."), Font("Regular", 9), Mist()), 14.0f);
	}
	else if (TabId == TEXT("companions"))
	{
		for (const FWonderlandCardViewRef& Ref : V.Companions)
		{
			Add(RefRow(Ref), 14.0f);
		}
		if (!V.Waiting.IsEmpty())
		{
			Add(Line(V.Waiting, Font("Regular", 9), CardStatusColour(EWonderlandCardStatus::Unconfigured)), 12.0f);
		}
		Add(Line(TEXT("A C.A.R.D. names a provider for each side; the companion runtime connects it, and keys never enter a C.A.R.D. Between missions "
			"a selected C.A.R.D.'s companions take their places; a running mission keeps the ones it started with. Set one from the Live Terminal: "
			"/card companion left|right <provider>."), Font("Regular", 9), Mist()), 14.0f);
	}
	else if (TabId == TEXT("capabilities"))
	{
		if (V.Capabilities.Num() == 0)
		{
			Add(Line(TEXT("Nothing attached yet."), Font("Regular", 11), BrainInk(0.9f)), 16.0f);
		}
		for (const FWonderlandCardViewRef& Ref : V.Capabilities)
		{
			Add(RefRow(Ref), 14.0f);
		}
		Add(Line(TEXT("MCP servers and APIs are referenced by their Julius Connect connection; Julius Connect holds the credential, never this C.A.R.D. "
			"Attach one from the Live Terminal: /card attach mcp|api|skill <id>."), Font("Regular", 9), Mist()), 14.0f);
	}
	else
	{
		for (const FWonderlandCardViewEntry& Entry : V.Cards)
		{
			const FString Id = Entry.Id;
			TSharedRef<SHorizontalBox> Row = SNew(SHorizontalBox)
				+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
				[
					Line(FString::Printf(TEXT("%s%s%s"), *Entry.Name, Entry.bActive ? TEXT("  ·  ACTIVE") : TEXT(""), Entry.bBuiltIn ? TEXT("  ·  BUILT IN") : TEXT("")),
						Font(Entry.bActive ? "Bold" : "Regular", 11, 40), BrainInk())
				];
			if (!Entry.bActive)
			{
				Row->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 0.0f, 0.0f)
				[
					Act(TEXT("SELECT"), [Id](UWorld* World) { FString Said; WonderlandCardDirector::Select(World, Id, Said); })
				];
			}
			if (!Entry.bActive && !Entry.bBuiltIn)
			{
				Row->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(8.0f, 0.0f, 0.0f, 0.0f)
				[
					Act(TEXT("DELETE"), [Id](UWorld* World) { FString Said; WonderlandCardDirector::Delete(World, Id, Said); })
				];
			}
			Add(Row, 10.0f);
		}
		const int32 Next = V.Cards.Num() + 1;
		Add(SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().AutoWidth()
			[
				Act(TEXT("NEW C.A.R.D."), [Next](UWorld* World) { FString Id; FString Said; WonderlandCardDirector::Create(World, FString::Printf(TEXT("C.A.R.D. %d"), Next), Id, Said); })
			], 16.0f);
		Add(Line(TEXT("Selecting one puts on its skin and colour now, and its companions between missions. The built-in C.A.R.D. is always here."),
			Font("Regular", 9), Mist()), 10.0f);
	}
}
