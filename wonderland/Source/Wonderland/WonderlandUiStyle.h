// WONDERLAND — the in-world UI palette, in one place.
//
// PORTED FROM THE APPROVED WEB PLAYER, NOT INVENTED. The Live Terminal first
// shipped as an overlay on the Pixel Streaming page (wonderland/web/player on
// relay/wonderland-v2, founder canon 2026-09-03), and its stylesheet is where
// these values were measured and argued over: the gold, the cream, the dim
// greys, the translucent panels that sit ON the world instead of dissolving
// into it. Running natively in Unreal there is no browser to draw that panel,
// so the same values are drawn here in Slate. Change a colour in one place and
// the terminal and the map move together.
//
// Header-only and engine-thin on purpose: plain FLinearColor constants and two
// font helpers, so any widget in the module can include it without pulling a
// style set, an asset or a module startup dependency with it.
#pragma once

#include "CoreMinimal.h"
#include "Styling/CoreStyle.h"

namespace WonderlandUi
{
	/** sRGB 0-255 to linear, the way the stylesheet's hex values are meant. */
	inline FLinearColor Srgb(uint8 R, uint8 G, uint8 B, float Alpha = 1.0f)
	{
		FLinearColor C = FLinearColor(FColor(R, G, B));
		C.A = Alpha;
		return C;
	}

	/**
	 * THE ACCENT EVERY TERMINAL AND CONTROL IS DRAWN IN, and the one thing a theme has to move.
	 *
	 * FOUNDER, 2026-09-24: "Add Julius + Companion Terminal color customization; theme also recolours
	 * preset-command/accent UI." Those three surfaces do not each own a colour -- they all call Gold(), and so
	 * do the preset command chips, the section rules, the chevrons and every accent on the HUD. So the theme is
	 * this ONE value, and moving it moves all of them at once. Defaults to the gold that is already there, so
	 * an untouched install looks exactly as it does today.
	 */
	WONDERLAND_API FLinearColor ThemeAccent();

	/** The Julius Live Terminal's accent, and the AI Companion terminals' accent, chosen separately. */
	WONDERLAND_API FLinearColor JuliusAccent();
	WONDERLAND_API FLinearColor CompanionAccent();
	/** The SECONDARY terminal colour: the words inside each terminal. Cream until the founder chooses. ONE colour:
	 *  the companions follow the Julius Live Terminal's Secondary unless they were given their own afterwards. */
	WONDERLAND_API FLinearColor JuliusText();
	WONDERLAND_API FLinearColor CompanionText();
	/** The same lettering at the terminal's dimmed level (resting lines, sub-lines). Dim() until a Secondary is chosen. */
	WONDERLAND_API FLinearColor JuliusTextDim();
	WONDERLAND_API FLinearColor CompanionTextDim();
	/** The Menu's accent surfaces only -- never a background and never body text. */
	WONDERLAND_API FLinearColor MenuAccent();

	// --wl-* in player.css.
	inline FLinearColor Gold(float A = 1.0f)     { const FLinearColor C = ThemeAccent(); return FLinearColor(C.R, C.G, C.B, A); }
	/** The same shape as Gold(), but each reading the accent its own surface was given. */
	inline FLinearColor JuliusGold(float A = 1.0f)    { const FLinearColor C = JuliusAccent();    return FLinearColor(C.R, C.G, C.B, A); }
	inline FLinearColor CompanionGold(float A = 1.0f) { const FLinearColor C = CompanionAccent(); return FLinearColor(C.R, C.G, C.B, A); }
	inline FLinearColor MenuGold(float A = 1.0f)      { const FLinearColor C = MenuAccent();      return FLinearColor(C.R, C.G, C.B, A); }
	inline FLinearColor GoldDim()                { return Gold(0.40f); }
	inline FLinearColor GoldLive()               { return Gold(0.62f); }
	inline FLinearColor Cream(float A = 1.0f)    { return Srgb(0xEC, 0xE7, 0xDD, A); }
	inline FLinearColor Dim(float A = 1.0f)      { return Srgb(0x8B, 0x85, 0x78, A); }
	inline FLinearColor Faint(float A = 1.0f)    { return Srgb(0x5D, 0x58, 0x4E, A); }
	inline FLinearColor Green(float A = 1.0f)    { return Srgb(0x6F, 0xBF, 0x73, A); }

	// .wl-tm-window and .wl-tmpanel backgrounds: translucent, and the window
	// lighter than its sections so the sections sit on it.
	/**
	 * A DARK PLATE THAT CARRIES A TRACE OF ITS OWN ACCENT.
	 *
	 * FOUNDER, 2026-09-28: "I approved the real fire and terminal colors just make the terminal color change
	 * more apparent."
	 *
	 * WHY IT WAS NOT APPARENT. Every accent in both terminals was a hairline border and a few words of small
	 * text. ReadScreenExtremes exists in this project precisely because of that: a grid of 96 mean readings
	 * over the Julius terminal moved by 0.008 when the accent changed from gold to a green the photograph
	 * shows unmistakably. If an instrument built to measure this surface can barely see the change, the
	 * founder looking at it is not being fussy.
	 *
	 * The plate is the largest surface either terminal has, so tinting it is what makes the choice read. It
	 * moves NO layout, which the standing rule -- a content or colour request is not a licence to redesign --
	 * requires.
	 *
	 * NORMALISED BY THE ACCENT'S PEAK CHANNEL, so a dim accent tints as strongly as a bright one. Without
	 * that, picking a deep blue would look like picking nothing at all, which is the very complaint.
	 *
	 * The weight stays small and the alpha is the plate's own: cream body text sits near 0.83 linear, so a
	 * plate a few hundredths above black keeps the contrast the terminals are readable at.
	 */
	inline FLinearColor TintPlate(const FLinearColor& Plate, const FLinearColor& Accent, float Weight)
	{
		const float Peak = FMath::Max3(Accent.R, Accent.G, Accent.B);
		if (Peak <= UE_SMALL_NUMBER)
		{
			return Plate;
		}
		FLinearColor Out = Plate + (Accent / Peak) * Weight;
		Out.A = Plate.A;
		return Out;
	}

	/**
	 * THE SAME TINT, MIXED WHERE THE EYE SEES IT -- the Julius Live Terminal's plates use this one.
	 *
	 * "A few hundredths above black" is true in LINEAR terms and false on screen: the sRGB curve is steepest
	 * at the bottom, so TintPlate's 0.055 of gold on Srgb(9, 11, 15) lands at sRGB ~(68, 51, 24) -- a dark
	 * BROWN -- and at the plate's 58% alpha the world shows through it. That is the washed-out brown/gray the
	 * founder reported on 2026-10-01 ("black must actually look black").
	 *
	 * Here the weight is a fraction of the accent's peak in DISPLAY values: 0.045 of Wonderland gold lifts a
	 * black plate by ~(11, 9, 3) of 255 -- a warm black that still reads as black. TintPlate itself is left as
	 * it is for the Companion surfaces, which were not part of the request.
	 */
	inline FLinearColor TintPlateDisplay(const FLinearColor& Plate, const FLinearColor& Accent, float Weight)
	{
		const FColor PlateS = Plate.ToFColor(true);
		const FColor AccentS = Accent.ToFColor(true);
		const float Peak = static_cast<float>(FMath::Max3(AccentS.R, AccentS.G, AccentS.B));
		if (Peak <= 0.0f)
		{
			return Plate;
		}
		const float Scale = 255.0f * Weight / Peak;
		const auto Mix = [Scale](uint8 Base, uint8 Channel)
		{
			return static_cast<uint8>(FMath::Clamp(FMath::RoundToInt(static_cast<float>(Base) + static_cast<float>(Channel) * Scale), 0, 255));
		};
		FLinearColor Out = FLinearColor(FColor(Mix(PlateS.R, AccentS.R), Mix(PlateS.G, AccentS.G), Mix(PlateS.B, AccentS.B)));
		Out.A = Plate.A;
		return Out;
	}

	inline FLinearColor WindowFill()             { return Srgb(9, 11, 15, 0.58f); }
	inline FLinearColor SectionFill()            { return Srgb(11, 13, 18, 0.72f); }

	/**
	 * THE JULIUS LIVE TERMINAL'S DEPTHS, darkest first (founder, 2026-10-01):
	 *
	 *   body + header       deepest black, nearly opaque: it anchors the interface
	 *   JULIUS 3.3 output   the darkest panel, so the bright output reads hardest
	 *   agent sections      dark glass a shade above the body: Architect / Coder / Reviewer stay distinct
	 *   command rows        lighter, more translucent glass
	 *   input               near-opaque black
	 *
	 * None is fully opaque: the world stays visible, subdued, behind every layer -- ~14% through the body and
	 * ~6-8% through the panels that sit on it. Composited over a bright gold-glass world the body reads at
	 * sRGB ~(38, 32, 20); the old plate (linear tint, 58%) read at ~(115, 88, 48).
	 */
	inline FLinearColor JuliusBodyFill()         { return Srgb(4, 5, 7, 0.86f); }
	inline FLinearColor JuliusOutputFill()       { return Srgb(2, 3, 4, 0.55f); }
	inline FLinearColor JuliusSectionFill()      { return Srgb(20, 21, 26, 0.48f); }
	inline FLinearColor JuliusRowFill()          { return Srgb(28, 29, 34, 0.40f); }
	inline FLinearColor JuliusInputFill()        { return Srgb(3, 4, 6, 0.88f); }

	// The sub-agent column in the founder's frame is set in a warm coral, the
	// counterpart of the loop column's gold.
	inline FLinearColor Coral(float A = 1.0f)    { return Srgb(0xE2, 0x5B, 0x45, A); }

	// Map panel: deep night blue under the same gold.
	inline FLinearColor MapFill()                { return Srgb(10, 12, 20, 0.90f); }
	inline FLinearColor MapScrim()               { return Srgb(4, 6, 12, 0.62f); }
	inline FLinearColor Ivory(float A = 1.0f)    { return Srgb(0xF3, 0xEA, 0xD6, A); }
	inline FLinearColor Sage(float A = 1.0f)     { return Srgb(0x9C, 0xC7, 0x8F, A); }
	inline FLinearColor Sky(float A = 1.0f)      { return Srgb(0x8F, 0xC6, 0xF2, A); }

	/** The terminal's typeface: the web panel is monospace throughout. */
	inline FSlateFontInfo Mono(int32 Size)
	{
		return FCoreStyle::GetDefaultFontStyle("Mono", Size);
	}

	/** Titles and labels. LetterSpacing is in thousandths of an em. */
	inline FSlateFontInfo Sans(int32 Size, bool bBold = false, int32 LetterSpacing = 0)
	{
		FSlateFontInfo Font = FCoreStyle::GetDefaultFontStyle(bBold ? "Bold" : "Regular", Size);
		Font.LetterSpacing = LetterSpacing;
		return Font;
	}
}
