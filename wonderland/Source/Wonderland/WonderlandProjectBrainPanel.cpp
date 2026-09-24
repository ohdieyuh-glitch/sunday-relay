#include "WonderlandProjectBrainPanel.h"

#include "Framework/Application/SlateApplication.h"
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

// Named, not anonymous: the module is one unity translation unit (see WonderlandCompanionHud.cpp).
namespace WonderlandBrainLook
{
	// The frame's palette: deep navy, blue-violet light, cool white type.
	FLinearColor Ink(float A = 1.0f) { return WonderlandUi::Srgb(0xEE, 0xF1, 0xFF, A); }
	FLinearColor Mist(float A = 1.0f) { return WonderlandUi::Srgb(0x9C, 0xA8, 0xDA, A); }
	FLinearColor Violet(float A = 1.0f) { return WonderlandUi::Srgb(0xB7, 0xA6, 0xFF, A); }
	FLinearColor Beam(float A = 1.0f) { return WonderlandUi::Srgb(0x7E, 0x8E, 0xFF, A); }
	FLinearColor Night(float A = 1.0f) { return WonderlandUi::Srgb(3, 6, 22, A); }

	FSlateFontInfo Font(const char* Typeface, int32 Size, int32 LetterSpacing = 0)
	{
		FSlateFontInfo Info = FCoreStyle::GetDefaultFontStyle(Typeface, Size);
		Info.LetterSpacing = LetterSpacing;
		return Info;
	}

	// THE FRAME'S PROPORTIONS, as fractions of the viewport, measured from the founder's reference so the
	// panels, the connectors and the brain keep the composition at any resolution.
	struct FRect { float X0, Y0, X1, Y1; };
	constexpr FRect Panel1 = {0.042f, 0.141f, 0.446f, 0.388f};
	constexpr FRect Panel2 = {0.042f, 0.404f, 0.446f, 0.620f};
	constexpr FRect Panel3 = {0.042f, 0.636f, 0.446f, 0.776f};
	constexpr FRect Panel4 = {0.042f, 0.792f, 0.446f, 0.912f};
	constexpr FRect Hologram = {0.502f, 0.125f, 0.892f, 0.956f};
	constexpr FRect Inspector = {0.515f, 0.140f, 0.885f, 0.880f};
	// THE SKIN VIEW STANDS WHERE THE INSPECTOR STANDS, a little wider because it carries a figure and a list side by
	// side. Nothing in the founder's frame moves to make room for it: it opens over the brain and shuts again.
	constexpr FRect SkinView = {0.478f, 0.132f, 0.905f, 0.906f};

	struct FConnector { float FromX, FromY, ToX, ToY; };
	constexpr FConnector Connectors[] = {
		{0.446f, 0.184f, 0.548f, 0.272f},
		{0.446f, 0.271f, 0.530f, 0.345f},
		{0.446f, 0.356f, 0.524f, 0.398f},
		{0.446f, 0.436f, 0.523f, 0.455f},
		{0.446f, 0.537f, 0.533f, 0.505f},
		{0.446f, 0.661f, 0.550f, 0.560f},
		{0.446f, 0.752f, 0.566f, 0.608f},
		{0.446f, 0.852f, 0.640f, 0.842f},
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
			Band(0.0f, 0.0f, Size.X, T);
			Band(0.0f, B, Size.X, Size.Y - B);
			Band(0.0f, T, L, B - T);
			Band(R, T, Size.X - R, B - T);
		}

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
		for (const FRect& Rect : {Panel1, Panel2, Panel3, Panel4})
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
					&Dot, ESlateDrawEffect::None, Ink(0.95f));
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
	: PanelBrush(WonderlandUi::Srgb(12, 18, 54, 0.66f), 14.0f, WonderlandBrainLook::Beam(0.95f), 1.4f)
	, CardBrush(WonderlandUi::Srgb(20, 28, 80, 0.58f), 9.0f, WonderlandUi::Srgb(88, 102, 232, 0.60f), 1.0f)
	, SelectedBrush(WonderlandUi::Srgb(96, 104, 255, 0.30f), 9.0f, WonderlandBrainLook::Violet(1.0f), 1.6f)
	, InspectorBrush(WonderlandUi::Srgb(8, 12, 38, 0.95f), 14.0f, WonderlandBrainLook::Violet(0.95f), 1.6f)
	, YoursBadge(WonderlandUi::Srgb(40, 200, 170, 0.18f), 6.0f, WonderlandUi::Srgb(96, 232, 204, 0.90f), 1.0f)
	, ReviewBadge(WonderlandUi::Srgb(240, 180, 60, 0.16f), 6.0f, WonderlandUi::Srgb(250, 204, 96, 0.90f), 1.0f)
	, SystemBadge(WonderlandUi::Srgb(150, 130, 255, 0.16f), 6.0f, WonderlandUi::Srgb(186, 166, 255, 0.90f), 1.0f)
	, InputBrush(WonderlandUi::Srgb(4, 6, 22, 0.96f), 7.0f, WonderlandBrainLook::Beam(0.80f), 1.0f)
	, ButtonBrush(WonderlandUi::Srgb(70, 80, 220, 0.35f), 7.0f, WonderlandBrainLook::Violet(0.90f), 1.0f)
	, ButtonHoverBrush(WonderlandUi::Srgb(110, 118, 255, 0.55f), 7.0f, WonderlandBrainLook::Ink(1.0f), 1.0f)
	, RuleBrush(WonderlandBrainLook::Beam(0.45f), 0.0f)
	, StatusBrush(WonderlandUi::Srgb(40, 30, 10, 0.60f), 6.0f, WonderlandUi::Srgb(250, 204, 96, 0.75f), 1.0f)
	// THE WARDROBE'S SURFACES, LAST because that is where they are declared. C++ initialises members in
	// declaration order whatever this list says, so listing them first only earned a C5038.
	// THE WINDOW'S FRAME: an outline and no fill at all. Anything with a fill here would tint the Dog behind it.
	, SkinWindowFrameBrush(FLinearColor(0.0f, 0.0f, 0.0f, 0.0f), 12.0f, WonderlandBrainLook::Beam(0.9f), 1.6f)
	// An outline with no fill for the panel, so its window is really a hole, and a solid for every surface that is
	// NOT the window. A filled panel behind the window tinted the Dog navy.
	, SkinPanelFrameBrush(FLinearColor(0.0f, 0.0f, 0.0f, 0.0f), 6.0f, WonderlandBrainLook::Violet(0.95f), 1.6f)
	, SkinPanelSolidBrush(WonderlandUi::Srgb(8, 12, 38, 0.95f), 0.0f, FLinearColor(0.0f, 0.0f, 0.0f, 0.0f), 0.0f)
{
	ClearBrush.DrawAs = ESlateBrushDrawType::NoDrawType;
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
		.SetForegroundColor(FSlateColor(Ink()))
		.SetFocusedForegroundColor(FSlateColor(Ink()))
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
			MakeMemoryCard(EWonderlandBrainGlyph::Gear, TEXT("Procedural Memory"), {TEXT("instructions"), TEXT("prompt_systems"), TEXT("workflows"), TEXT("skills")})
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
			+ SHorizontalBox::Slot().FillWidth(1.2f).Padding(0.0f, 0.0f, 8.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Arrows, TEXT("context_handoffs"), 0.0f)]
			+ SHorizontalBox::Slot().FillWidth(1.2f).Padding(0.0f, 0.0f, 8.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Pulse, TEXT("agent_state"), 0.0f)]
			+ SHorizontalBox::Slot().FillWidth(1.0f)[MakeSkinTile()]
		];

	// 03 LARGE LANGUAGE MODEL COMPONENTS
	TSharedRef<SWidget> ComponentsBody =
		SNew(SHorizontalBox)
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 7.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Feather, TEXT("prompt_architect"), 0.0f)]
		+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 7.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Code, TEXT("coding_agent"), 0.0f)]
		+ SHorizontalBox::Slot().FillWidth(1.1f).Padding(0.0f, 0.0f, 7.0f, 0.0f)[MakeTile(EWonderlandBrainGlyph::Magnifier, TEXT("independent_reviewer"), 0.0f)]
		+ SHorizontalBox::Slot().FillWidth(1.0f)[MakeTile(EWonderlandBrainGlyph::People, TEXT("shared_context"), 0.0f)];

	// 04 MISSION CONTEXT -- the brain scope's vocabulary, two rows of chips.
	TSharedRef<SWidget> MissionBody =
		SNew(SVerticalBox)
		+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 6.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Target, TEXT("objective"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Document, TEXT("requirements"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Shield, TEXT("constraints"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f)[MakeChip(EWonderlandBrainGlyph::Check, TEXT("decisions"))]
		]
		+ SVerticalBox::Slot().AutoHeight()
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Magnifier, TEXT("evidence"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Check, TEXT("evaluations"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f).Padding(0.0f, 0.0f, 6.0f, 0.0f)[MakeChip(EWonderlandBrainGlyph::Link, TEXT("trace"))]
			+ SHorizontalBox::Slot().FillWidth(1.0f)[MakeChip(EWonderlandBrainGlyph::Shield, TEXT("governance"))]
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
				FVector2D Centre, Extent;
				if (!bSculptureLive || !GetBrainSculptureRect(Centre, Extent))
				{
					return FVector4f(0.0f, 0.0f, 0.0f, 0.0f);
				}
				return FVector4f(static_cast<float>(Centre.X - Extent.X * 0.5), static_cast<float>(Centre.Y - Extent.Y * 0.5),
								 static_cast<float>(Centre.X + Extent.X * 0.5), static_cast<float>(Centre.Y + Extent.Y * 0.5));
			})
			.Visibility_Lambda([this]() { return bSkinsOpen ? EVisibility::Collapsed : EVisibility::HitTestInvisible; })
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
					.ColorAndOpacity_Lambda([this]() { return FSlateColor(FLinearColor(1.0f, 1.0f, 1.0f, Selected.IsNone() ? 1.0f : 0.30f)); })
				]
			]
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.0f, 0.0f, 1.0f, 1.0f)).Offset(FMargin(0.0f))
		[
			SNew(SWonderlandBrainCoreGlow)
			.Visibility_Lambda([this]() { return bSkinsOpen ? EVisibility::Collapsed : EVisibility::HitTestInvisible; })
			.ChakraRank_Lambda([this]() { return Model.ChakraRank; })
			.Dim_Lambda([this]() { return Selected.IsNone() ? 1.0f : 0.25f; })
		]
		// The title.
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.042f, 0.036f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()
			[
				SNew(STextBlock).Text(INVTEXT("PROJECT BRAIN")).Font(Font("Light", 38, 330)).ColorAndOpacity(Ink())
				.ShadowOffset(FVector2D(0.0f, 0.0f)).ShadowColorAndOpacity(Violet(0.0f))
			]
			+ SVerticalBox::Slot().AutoHeight().Padding(2.0f, 6.0f, 0.0f, 0.0f)
			[
				SNew(STextBlock).Text(FText::FromString(TEXT("MEMORY    ×    REASONING    ×    CONTINUITY    ×    A HIGHER YOU"))).Font(Font("Regular", 9, 420)).ColorAndOpacity(Mist())
			]
		]
		// What this is, said at the top.
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.47f, 0.046f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SBorder).BorderImage(&StatusBrush).Padding(FMargin(10.0f, 4.0f))
			[
				SNew(STextBlock).Text_Lambda([this]() { return FText::FromString(Model.SourceLine); }).Font(Font("Bold", 8, 160)).ColorAndOpacity(WonderlandUi::Srgb(0xFF, 0xD2, 0x73))
			]
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
			MakeGlassPanel(TEXT("04"), EWonderlandBrainGlyph::Target, TEXT("MISSION CONTEXT"), TEXT("WHAT THIS MISSION IS HOLDING"), MissionBody)
		]
		// The side captions, as the frame sets them.
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.823f, 0.058f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[Caption(TEXT("ADAPTIVE INTELLIGENCE"), Font("Regular", 9, 320), Ink(0.88f))]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)[Caption(TEXT("FOR A MORE CAPABLE YOU"), Font("Regular", 9, 320), Ink(0.88f))]
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.898f, 0.232f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[Caption(TEXT("PROJECT BRAIN"), Font("Bold", 10, 220), Ink())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 16.0f, 0.0f, 0.0f)[Caption(TEXT("ADAPTS"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)[Caption(TEXT("LEARNS"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)[Caption(TEXT("REMEMBERS"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)[Caption(TEXT("EVOLVES"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 5.0f, 0.0f, 0.0f)[Caption(TEXT("WITH YOU"), Font("Regular", 8, 300), Mist())]
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.898f, 0.607f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			Caption(TEXT("CHAKRA ADAPTIVE"), Font("Regular", 8, 300), Ink(0.85f))
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.898f, 0.666f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			SNew(SVerticalBox)
			+ SVerticalBox::Slot().AutoHeight()[Caption(TEXT("GLOWS WITH"), Font("Regular", 8, 300), Mist())]
			+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 4.0f, 0.0f, 0.0f)[Caption(TEXT("YOUR RANK"), Font("Regular", 8, 300), Mist())]
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.042f, 0.947f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			Caption(TEXT("YOUR CONTEXT, AMPLIFIED.   ——"), Font("Regular", 9, 320), Ink(0.85f))
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.800f, 0.947f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			Caption(TEXT("A MORE CAPABLE TOMORROW.   ——"), Font("Regular", 9, 320), Ink(0.85f))
		]
		+ SConstraintCanvas::Slot().Anchors(FAnchors(0.42f, 0.978f)).AutoSize(true).Alignment(FVector2D(0.0, 0.0))
		[
			Caption(TEXT("B or Esc to close   ·   choose any memory, system or component to inspect it"), Font("Regular", 8, 60), Mist(0.75f))
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
					SNew(STextBlock).Text(FText::FromString(Number)).Font(Font("Light", 15, 80)).ColorAndOpacity(Ink(0.9f))
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
						SNew(STextBlock).Text(FText::FromString(Title)).Font(Font("Regular", 12, 300)).ColorAndOpacity(Ink())
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
					SNew(STextBlock).Text_Lambda([this, SurfaceId]() { return SurfaceLabel(SurfaceId); }).Font(Font("Regular", 10)).ColorAndOpacity(Ink(0.92f))
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
					SNew(STextBlock).Text(FText::FromString(Title)).Font(Font("Regular", 11)).ColorAndOpacity(Ink())
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
				SNew(STextBlock).Text_Lambda([this, SurfaceId]() { return SurfaceLabel(SurfaceId); }).Font(Font("Regular", 11)).ColorAndOpacity(Ink()).AutoWrapText(true)
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
			SNew(STextBlock).Text_Lambda([this, SurfaceId]() { return ChipLabel(SurfaceId); }).Font(Font("Regular", 9, 40)).ColorAndOpacity(Ink(0.95f))
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
		SNew(STextBlock).Text(FText::FromString(Found->Title)).Font(Font("Light", 24, 60)).ColorAndOpacity(Ink())
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

	// The entries: sample lines in the preview, each with the one action its access allows.
	InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 8.0f)
	[
		SNew(STextBlock).Text(FText::FromString(Model.bDevelopmentPreview ? TEXT("SAMPLE ENTRIES") : TEXT("ENTRIES"))).Font(Font("Bold", 8, 240)).ColorAndOpacity(Violet())
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
				SNew(STextBlock).Text(FText::FromString(Found->SampleLines[Index])).Font(Font("Regular", 12)).ColorAndOpacity(Ink()).AutoWrapText(true)
			];
		if (Found->Access == EWonderlandBrainAccess::Review)
		{
			Row->AddSlot().AutoWidth().VAlign(VAlign_Center).Padding(10.0f, 0.0f, 6.0f, 0.0f)
			[
				SNew(SButton).ButtonStyle(&ActionStyle)
				.OnClicked_Lambda([this, SurfaceId, Index]() { OnReview.ExecuteIfBound(SurfaceId, Index, true); return FReply::Handled(); })
				[
					SNew(STextBlock).Text(INVTEXT("ACCEPT")).Font(Font("Bold", 8, 140)).ColorAndOpacity(Ink())
				]
			];
			Row->AddSlot().AutoWidth().VAlign(VAlign_Center)
			[
				SNew(SButton).ButtonStyle(&ActionStyle)
				.OnClicked_Lambda([this, SurfaceId, Index]() { OnReview.ExecuteIfBound(SurfaceId, Index, false); return FReply::Handled(); })
				[
					SNew(STextBlock).Text(INVTEXT("DECLINE")).Font(Font("Bold", 8, 140)).ColorAndOpacity(Ink())
				]
			];
		}
		InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 0.0f, 0.0f, 7.0f)[Row];
	}

	// What the owner did here: proposals, never changes.
	if (Found->Proposals.Num() + Found->Reviews.Num() > 0)
	{
		InspectorBody->AddSlot().AutoHeight().Padding(0.0f, 10.0f, 0.0f, 6.0f)
		[
			SNew(STextBlock).Text(INVTEXT("PROPOSED  ·  NOT SYNCED")).Font(Font("Bold", 8, 240)).ColorAndOpacity(WonderlandUi::Srgb(0xFF, 0xD2, 0x73))
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
					SNew(STextBlock).Text(INVTEXT("PROPOSE")).Font(Font("Bold", 9, 160)).ColorAndOpacity(Ink())
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
		.Text(INVTEXT("Development preview: sample data, nothing sent. A connected Project Brain gives this world counts and revisions, never entry text, until an owner-scoped read is approved."))
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
							.Font(Font("Bold", 11, 130)).ColorAndOpacity(Ink(bLocked ? 0.45f : 1.0f))
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

TSharedRef<SWidget> SWonderlandProjectBrainPanel::MakeSkinTile()
{
	using namespace WonderlandBrainLook;
	// THE WAY INTO THE WARDROBE, in the shape of the tiles it stands beside, so it reads as part of 02 PROJECT BRAIN
	// SYSTEMS rather than as a button dropped into it. It shows what the Dog is wearing without being opened,
	// because a control that only says its own name makes a person open it to learn anything.
	const auto Worn = [this]() -> const FWonderlandRelaySkin*
	{
		const FName Id = EquippedSkin.IsSet() ? EquippedSkin.Get() : NAME_None;
		return Skins.FindByPredicate([Id](const FWonderlandRelaySkin& Skin) { return Skin.SkinId == Id; });
	};
	return SNew(SButton)
		.ButtonStyle(&SelectableStyle)
		.OnClicked_Lambda([this]() { SetSkinsOpen(!bSkinsOpen); return FReply::Handled(); })
		[
			SNew(SBorder)
			.BorderImage(&CardBrush)
			.Padding(FMargin(12.0f, 10.0f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight()
				[
					SNew(SHorizontalBox)
					+ SHorizontalBox::Slot().AutoWidth().VAlign(VAlign_Center).Padding(0.0f, 0.0f, 9.0f, 0.0f)
					[
						SNew(SWonderlandBrainIcon).Glyph(EWonderlandBrainGlyph::Sparkle).Size(13.0f).Color(Violet())
					]
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(STextBlock).Text(INVTEXT("MASCOT SKIN")).Font(Font("Bold", 10, 180)).ColorAndOpacity(Ink())
					]
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 7.0f, 0.0f, 0.0f)
				[
					SNew(SHorizontalBox)
					// The worn skin's own colour, so the tile changes when the Dog does.
					+ SHorizontalBox::Slot().AutoWidth().Padding(0.0f, 0.0f, 8.0f, 0.0f)
					[
						SNew(SBox).WidthOverride(3.0f)
						[
							SNew(SImage).Image(&StatusBrush)
							.ColorAndOpacity_Lambda([Worn]()
							{
								const FWonderlandRelaySkin* Skin = Worn();
								return FSlateColor(Skin != nullptr ? Skin->Accent : FLinearColor::White);
							})
						]
					]
					+ SHorizontalBox::Slot().FillWidth(1.0f).VAlign(VAlign_Center)
					[
						SNew(STextBlock)
						.Text_Lambda([Worn]()
						{
							const FWonderlandRelaySkin* Skin = Worn();
							return FText::FromString(Skin != nullptr ? Skin->DisplayName : TEXT("RELAY OG"));
						})
						.Font(Font("Regular", 10, 120)).ColorAndOpacity(Mist())
					]
				]
				+ SVerticalBox::Slot().AutoHeight().Padding(0.0f, 6.0f, 0.0f, 0.0f)
				[
					SNew(STextBlock)
					.Text_Lambda([this]() { return FText::FromString(bSkinsOpen ? TEXT("CLOSE") : TEXT("SWITCH SKIN")); })
					.Font(Font("Bold", 8, 220)).ColorAndOpacity(Violet())
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
							SNew(STextBlock).Text(INVTEXT("RELAY DOG")).Font(Font("Light", 26, 300)).ColorAndOpacity(Ink())
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
						SAssignNew(SkinPreviewWindow, SBorder).BorderImage(&SkinWindowFrameBrush).Padding(FMargin(6.0f))
						.Visibility(EVisibility::HitTestInvisible)
						[
							SNew(SVerticalBox)
							+ SVerticalBox::Slot().FillHeight(1.0f)
							[
								SNew(SSpacer)
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
							.Font(Font("Bold", 14, 160)).ColorAndOpacity(Ink())
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
