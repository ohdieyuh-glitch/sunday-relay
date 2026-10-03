// WONDERLAND — THE MASCOT'S OWN COLOURS.
//
// FOUNDER, 2026-09-24: "Mascot colors: PRIMARY = main/full mascot colorway. SECONDARY = Relay Dog eyes.
// Persist/apply to world, Wardrobe, missions."
//
// TWO COLOURS, ONE PLACE. The Dog is dressed in three different situations -- standing in the world, framed in
// the Wardrobe's preview, and performing a Mission Contract -- and each of those already builds its own body
// from its own materials. If each remembered its own colour they would drift apart the first time one of them
// was touched, so the colour lives HERE and all three read it.
//
// SAVED AS CONFIG, which is what makes it survive a restart without a save game: the founder picks a colourway
// once and Wonderland opens in it every time after.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "WonderlandMascotStyle.generated.h"

UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Wonderland Mascot Style"))
class WONDERLAND_API UWonderlandMascotStyleSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	/**
	 * THE MAIN COLOURWAY -- the whole mascot, whichever skin it is wearing.
	 *
	 * White by default, which multiplies to exactly what the artist made: a founder who has never chosen a
	 * colour must see the skins as they were designed, not as a tinted version of them.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Mascot")
	FLinearColor Primary = FLinearColor::White;

	/** THE RELAY DOG'S EYES, and a skin's SECONDARY ACCENTS once chosen -- Jack Flame's fire, tie and suit (founder,
	 *  2026-09-29). The founder's gold is what the canon Dog's eyes already wear. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Mascot")
	FLinearColor Secondary = FLinearColor(1.00f, 0.78f, 0.16f, 1.0f);

	/**
	 * THE COLOUR EVERY TERMINAL, PRESET COMMAND AND ACCENT IS DRAWN IN.
	 *
	 * Wonderland's own gold by default. WonderlandUi::Gold() reads this, and the Julius terminal, both companion
	 * terminals, the command chips and every accent on the HUD read Gold(), so moving this one value moves all
	 * of them -- which is exactly what "theme also recolours preset-command/accent UI" asks for.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	FLinearColor TerminalAccent = FLinearColor(FColor(0xD9, 0xA4, 0x41));

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	bool bTerminalAccentChosen = false;

	/**
	 * WONDERLAND'S OWN POINTER: "system", "arrow", "mark" or "ring" (founder, 2026-09-24).
	 *
	 * "system" by default and deliberately: a custom pointer that cannot be turned off is a worse default than
	 * the one the machine already has. Painted rather than shipped as an asset, so it wears TerminalAccent and
	 * the founder's theme moves the pointer along with every other control.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Cursor")
	FString CursorShape = TEXT("system");

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Cursor")
	float CursorSize = 22.0f;

	/** True once the founder has actually chosen, so an untouched install never tints anything. */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Mascot")
	bool bChosen = false;

	/**
	 * TRUE ONCE THE SECONDARY ITSELF HAS BEEN PICKED (founder, 2026-09-29: "For JACK FLAME: The SECONDARY COLOR
	 * customization must control BOTH the FLAMES and the RED TIE").
	 *
	 * A skin's secondary ACCENTS -- surfaces its figure tags `secondary` -- follow this colour. bChosen alone cannot
	 * gate them: it goes true when only the PRIMARY is picked, and Secondary then still holds its default gold,
	 * which would turn Jack Flame's fire and tie gold the moment a player tinted his shell. The eyes keep their
	 * long-standing rule (bChosen); the accents wait for a real choice. See HasChosenSecondary.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Mascot")
	bool bSecondaryChosen = false;

	/** Secondary's value before anyone chooses it (and after a reset). */
	static FLinearColor DefaultSecondary() { return FLinearColor(1.00f, 0.78f, 0.16f, 1.0f); }

	/** Whether the SECONDARY has been chosen: the flag, or -- for a colourway saved before the flag existed -- a
	 *  Secondary that differs from its default while the colourway is chosen. */
	bool HasChosenSecondary() const
	{
		return bChosen && (bSecondaryChosen || !Secondary.Equals(DefaultSecondary(), 0.002f));
	}

	/**
	 * THE AI COMPANIONS' OWN COLOURWAY, kept separate from the mascot's (founder, 2026-09-25).
	 *
	 * "AI COMPANION COLOR CUSTOMIZATION ... Do not couple this to Sub-Agent Cub transforms. Preserve companion
	 * identity/readability." Separate values, the same two channels, and nothing about it touches a Cub.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Companions")
	FLinearColor CompanionPrimary = FLinearColor::White;

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Companions")
	FLinearColor CompanionSecondary = FLinearColor(0.42f, 0.80f, 1.00f, 1.0f);

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Companions")
	bool bCompanionChosen = false;

	/**
	 * THE JULIUS LIVE TERMINAL'S OWN ACCENT, and the AI COMPANION TERMINALS' accent, separately.
	 *
	 * FOUNDER, 2026-09-25: "Provide real color customization in the MENU tab for: (A) Julius Live Terminal,
	 * (B) AI Companion terminals." One TerminalAccent served both, so they could not be told apart. Each falls
	 * back to TerminalAccent until it is chosen, so nothing changes for an install that has not asked.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	FLinearColor JuliusTerminalAccent = FLinearColor(FColor(0xD9, 0xA4, 0x41));

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	bool bJuliusTerminalAccentChosen = false;

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	FLinearColor CompanionTerminalAccent = FLinearColor(FColor(0xD9, 0xA4, 0x41));

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	bool bCompanionTerminalAccentChosen = false;

	/**
	 * THE SECONDARY TERMINAL COLOUR: THE WORDS INSIDE, as opposed to the chrome around them.
	 *
	 * FOUNDER, 2026-09-28: "Make a secondary live terminal colors option for the text colors of the words
	 * inside the terminal."
	 *
	 * The same primary/secondary shape the mascot already has, where PRIMARY is the colourway and SECONDARY
	 * is the eyes. Here PRIMARY is the accent -- frame, rule, title, the plate's tint -- and SECONDARY is the
	 * transcript: what the companion and Julius actually SAY.
	 *
	 * SCOPED TO THE TRANSCRIPT ON PURPOSE. It colours the spoken lines and nothing structural, because the
	 * standing rule on the menu accents is "update the intentional accent surfaces WITHOUT making text
	 * unreadable; do not indiscriminately tint every element." Button labels, key hints and the input box
	 * keep their cream, so no choice here can leave a terminal the player cannot operate.
	 *
	 * Defaults to the cream the transcript has always been, and is inert until chosen, so an install that has
	 * not asked for this sees no change at all.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	FLinearColor JuliusTerminalTextColor = FLinearColor(FColor(0xEC, 0xE7, 0xDD));

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	bool bJuliusTerminalTextChosen = false;

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	FLinearColor CompanionTerminalTextColor = FLinearColor(FColor(0xEC, 0xE7, 0xDD));

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Terminals")
	bool bCompanionTerminalTextChosen = false;

	/**
	 * THE MENU'S OWN THEME COLOUR (founder, 2026-09-25): "Allow the player to select a Menu theme ... Update the
	 * intentional accent surfaces WITHOUT making text unreadable. Do not indiscriminately tint every element."
	 *
	 * So this drives the Menu's accents -- headings, keys, the selected tab -- and nothing else. Body text keeps
	 * its own ivory whatever is chosen here, which is what stops a dark theme choice erasing the words.
	 */
	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Menu")
	FLinearColor MenuAccent = FLinearColor(FColor(0xD9, 0xA4, 0x41));

	UPROPERTY(Config, EditAnywhere, BlueprintReadWrite, Category = "Menu")
	bool bMenuAccentChosen = false;

	static const UWonderlandMascotStyleSettings& Get()
	{
		const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>();
		check(Settings != nullptr);
		return *Settings;
	}
};

/**
 * WHICH OF A FIGURE'S CHANNELS A CHOSEN COLOUR IS ALLOWED TO TOUCH.
 *
 * FOUNDER, 2026-09-25: "Color customization must not flatten or destroy the actual art. Preserve Skeleton
 * Flame's flames and glowing elements, Arden Infernal's fire/mane/details, Apollo's celestial details,
 * Celestial Light's special elements, Relay OG's recognizable structure. Only recolour the surfaces/channels
 * intended to be customizable. Do not simply tint the entire rendered mascot."
 *
 * The skins make this easy, because they were built to a shared scheme. Every one of the five declares the
 * same first four materials -- bone (the shell), bonedeep (its shade), visor (the black face) and eye -- and
 * then its OWN art on top: gold, ghost, ghostpale, ember, emberpale, crimson, char, demon, ruby, solar,
 * starlight, bannercloth, frost, ink. So:
 *
 *   Body  -- bone and bonedeep. The main colourway, present in every skin, and the founder's PRIMARY.
 *   Eye   -- eye and pupil. The status eyes, and the founder's SECONDARY.
 *   None  -- everything else, including the visor and every authored effect, which is never touched.
 *
 * ONE EXCEPTION, DECLARED BY THE SKIN ITSELF (founder, 2026-09-29: "For JACK FLAME: the SECONDARY COLOR
 * customization must control BOTH the FLAMES and the RED TIE"). A figure may tag a material `secondary` or
 * `secondary_light` after its strength; those surfaces follow the chosen SECONDARY at their authored brightness
 * (WonderlandMascotStyle::AccentColour). The tag lives in the skin's own figure file, so no skin is named here and
 * no other skin's fire moves.
 */
enum class EWonderlandColorChannel : uint8 { None, Body, Eye };

namespace WonderlandMascotStyle
{
	/** True when a part, material or component of this name is one of the Dog's eyes rather than its body. */
	WONDERLAND_API bool NamesAnEye(const FString& Name);

	/** Which channel a material of this name belongs to. See EWonderlandColorChannel. */
	WONDERLAND_API EWonderlandColorChannel ChannelFor(const FString& MaterialName);

	/**
	 * A SECONDARY ACCENT'S COLOUR: the chosen Secondary's HUE at the authored surface's BRIGHTNESS.
	 *
	 * Multiplying cannot do it -- Jack Flame's red heart times an azure Secondary is merely a darker red -- so the
	 * accent keeps its own peak intensity (every glow and night factor already applied to Authored) and takes the
	 * chosen colour's direction through the colour cube. bLight lifts the hue toward white, so a flame's pale core
	 * stays paler than its outer tongue. White, the DEFAULT swatch, means "as designed" and returns Authored.
	 */
	WONDERLAND_API FLinearColor AccentColour(const FLinearColor& Authored, const FLinearColor& Chosen, bool bLight);

	/**
	 * A SECONDARY-COLOURED CLOTH: the chosen Secondary as a DEEP SHADE, for a lit surface a figure tags
	 * `secondary_deep` -- Jack Flame's suit (founder, 2026-09-30: "The Jack Flame secondary color must now control
	 * ALL THREE: flames, tie, suit ... while preserving material detail/readability").
	 *
	 * Not AccentColour: that keeps the authored brightness, and the suit is authored near-black (0.034), so any hue at
	 * that level is still black and the suit would not visibly change. A cloth takes the chosen colour at a fixed
	 * share instead -- dark enough that the pinstripes, the glowing tie and the fire still read on it by value, light
	 * enough that the hue is plainly the chosen one. White, the DEFAULT swatch, returns Authored.
	 */
	WONDERLAND_API FLinearColor DeepAccentColour(const FLinearColor& Authored, const FLinearColor& Chosen);

	/** The swatches offered in the Wardrobe and the Menu, so both offer exactly the same set. */
	WONDERLAND_API const TArray<TPair<FName, FLinearColor>>& Palette();

	/**
	 * THE MASCOT PRIMARY, PURE (founder, 2026-10-02: "WHITE -> pure white, BLACK -> black ... The chosen color should be
	 * the actual visible primary color, not a blend with the skin's original dark body color").
	 *
	 * The PRIMARY rows offer DEFAULT, then a true WHITE and BLACK, then the shared palette. DEFAULT and WHITE are both
	 * (1,1,1), so whether the primary is a REAL choice is kept beside the colour: in its own small file
	 * (Saved/Wonderland/PrimaryChoice.txt, "CHOSEN" or "DEFAULT"), not a new config property, for the FName reason the
	 * flame colour gives (a new reflected or config name crashed RC1 at boot). No file, or an unreadable one: a saved
	 * non-white primary counts as chosen, white as DEFAULT -- exactly what the colourway meant before the file.
	 *
	 * A figure material tagged `primary` takes a chosen primary AS its colour; everything else keeps the multiply it had.
	 */
	WONDERLAND_API const TArray<TPair<FName, FLinearColor>>& PrimaryPalette();
	WONDERLAND_API bool HasChosenPrimary();
	/** Pick a PRIMARY swatch (DEFAULT included) from the Wardrobe or the Menu: the state, the file, SaveAndApply. */
	WONDERLAND_API void PickMascotPrimary(FName Key, const FLinearColor& Colour);
	/** Whether this PRIMARY swatch is the one on (its ring). */
	WONDERLAND_API bool IsMascotPrimaryOn(FName Key, const FLinearColor& Colour);
	/** Whether a figure's material channel takes the chosen primary as its colour: `primary`. */
	WONDERLAND_API bool IsPrimaryChannel(FName Channel);
	/** What the saved choice file is read with ("CHOSEN" / "DEFAULT", or false). For the QA's hostile inputs. */
	WONDERLAND_API bool ParsePrimaryChoice(const FString& Text, bool& bOutChosen);

	/**
	 * THE FLAME COLOUR (founder, 2026-10-01: "When a flame-bearing mascot is equipped, the Color menu should expose a
	 * separate: Flame Color. This must be independent from normal body/secondary color").
	 *
	 * ONE colour for every flame skin, as the primary and the secondary are one colour for every skin. WHITE -- the
	 * DEFAULT swatch -- means each skin's own designed fire: Jack Flame's orange, Baal's blue, Skeleton Flame's cyan. A
	 * figure opts its fire in by tagging those materials `flame`, or `flame_light` for a pale core, so no skin is named
	 * in code; the skull, the eyes, the body and Jack Flame's tie and suit carry no such tag and never move with it.
	 *
	 * KEPT IN ITS OWN SMALL FILE (Saved/Wonderland/FlameColour.txt), not a new config property: a new reflected or
	 * config name shifts the FName table Niagara hashes, which crashed RC1 at boot (WonderlandBeta.h). Written whole or
	 * not at all; a file that does not hold three numbers in 0..1 means the designed fire.
	 */
	WONDERLAND_API FLinearColor FlameColour();
	WONDERLAND_API bool HasChosenFlame();
	/** Store it (White = as designed) and save it. The caller repaints, through SaveAndApply, like every other row. */
	WONDERLAND_API void SetFlameColour(const FLinearColor& Colour);
	/** What the saved file is read with: three numbers in 0..1 separated by spaces, or false. For the QA's hostile inputs. */
	WONDERLAND_API bool ParseFlameColour(const FString& Text, FLinearColor& Out);
	/** Whether a figure's material channel is fire that follows the FLAME colour: `flame` or `flame_light`. */
	WONDERLAND_API bool IsFlameChannel(FName Channel);
	/** Whether the skin the player's Relay Dog wears has any such fire. The FLAME rows show only then. */
	WONDERLAND_API bool WornSkinHasFlame();

	/**
	 * THE STRIPS COLOUR -- COLOR 3 (founder, 2026-10-02, "SHADOW MASCOT COLORWAYS + THIRD COLOR CHANNEL": "The flowing black
	 * strips / ribbons / tendrils surrounding the Shadow mascot need their OWN independently selectable color channel ...
	 * Treat COLOR 3 similarly to how flame/accent regions are independently configurable on other mascot skins").
	 *
	 * The flame colour's twin: one colour, a figure opts its strips in by tagging them `strip` (no skin is named in code),
	 * shown as its own STRIPS row in the Wardrobe and the Menu only while such a skin is worn. Unlike the fire, WHITE is a
	 * real choice here (white strips), so DEFAULT -- the strips as designed -- is kept as the word itself: the file
	 * Saved/Wonderland/StripColour.txt holds "DEFAULT" or three numbers in 0..1. A file, never a config property (the FName
	 * reason above). Changing it moves the strips and nothing else: not the body, the eyes, the swords or the clothes.
	 */
	WONDERLAND_API bool HasChosenStrip();
	/** The chosen strip colour; meaningful only when HasChosenStrip(). */
	WONDERLAND_API FLinearColor StripColour();
	/** Pick a STRIPS swatch (DEFAULT included) from the Wardrobe or the Menu: the state, the file, SaveAndApply. */
	WONDERLAND_API void PickMascotStrip(FName Key, const FLinearColor& Colour);
	/** Whether this STRIPS swatch is the one on (its ring); DEFAULT and WHITE are told apart. */
	WONDERLAND_API bool IsMascotStripOn(FName Key, const FLinearColor& Colour);
	/** What the saved file is read with: "DEFAULT", or three numbers in 0..1. For the QA's hostile inputs. */
	WONDERLAND_API bool ParseStripColour(const FString& Text, bool& bOutChosen, FLinearColor& OutColour);
	/** Whether a figure's material channel is a strip that follows the STRIPS colour: `strip`. */
	WONDERLAND_API bool IsStripChannel(FName Channel);
	/** Whether the skin the player's Relay Dog wears has any such strips. The STRIPS rows show only then. */
	WONDERLAND_API bool WornSkinHasStrips();
	/** Every reset's share of the small files: the primary back to DEFAULT (not CHOSEN) and the strips back to DEFAULT. */
	WONDERLAND_API void ResetChoiceFiles();

	/**
	 * THE SMOKE LOOK (founder, 2026-10-02: "Changing Shadow's primary color must NOT remove its visual detail ... Every
	 * colorway should preserve the SAME rich Shadow material identity. The selected color changes the palette, not the
	 * amount of detail ... preserve detail through tonal variation, masks, normals, roughness, controlled highlights/shadows
	 * ... Do NOT solve the detail problem by multiplying the selected color against the old navy material").
	 *
	 * A rim surface whose figure marks it `smoke` keeps its BASE colour exactly (pure colour rule), and takes its detail
	 * from everything around the colour: a cloudy normal relief (the master's NormalTex, a cooked texture, projected at
	 * TexScale), a roughness that wanders (RoughVary) so highlights travel across it, a little procedural relief
	 * (DetailAmp), and a grazing-angle rim in a LIGHTER TINT OF THE SAME HUE -- never a multiply by the old navy. Black
	 * keeps readable dark-grey highlights; white takes light-grey tonal relief and white edges. The DEFAULT colours wear
	 * the same look, so the designed skin and every recolour are one material identity. Tunable live: wl.Shadow.*.
	 */
	WONDERLAND_API bool IsSmokeLook(FName Look);
	/** The rim's tint for a smoke surface of this colour: the same hue lifted toward white, with a dark-grey floor. */
	WONDERLAND_API FLinearColor SmokeRimTint(const FLinearColor& Base);
	/** The rim's emissive gain for a smoke surface (RimColor = SmokeRimTint x this). */
	WONDERLAND_API float SmokeRimGain();
	/** The rim's amplitude for a smoke surface, before the night's rim boost multiplies it (RimAmp = boost x this). */
	WONDERLAND_API float SmokeRimAmp();
	/** The STRIPS' rim gain when a strip colour is chosen (subtle edges), and whether recoloured strips take the relief. */
	WONDERLAND_API float SmokeStripRimGain();
	WONDERLAND_API bool SmokeStripRelief();
	/** Whether the DEFAULT colours wear the smoke look too (wl.Shadow.OnDefault; off: the designed look exactly). */
	WONDERLAND_API bool SmokeOnDefault();
	/** The relief texture the smoke look binds right now, by name, or "none" (for the QA). */
	WONDERLAND_API FString SmokeTextureName();
	/** Put a rim material instance back to its parent's own detail (undoes ApplySmokeDetail): DEFAULT leaves nothing behind. */
	WONDERLAND_API void RestoreSmokeDetail(UMaterialInstanceDynamic* Instance);
	/** Write the smoke look's detail parameters (all but the colours and RimAmp) onto one rim material instance. */
	WONDERLAND_API void ApplySmokeDetail(UMaterialInstanceDynamic* Instance);
	/**
	 * B65.3 (founder, 2026-10-03: "WHITE must read genuinely WHITE at noon ... DEFAULT: restore/strengthen the bright blue
	 * smoky marbling ... BLACK: increase readable gray/smoky highlights"): the whole smoke look on one surface, by the
	 * PROFILE of its colour -- the designed body (navy cells, bright blue veins), a light pick (white kept bright, soft
	 * marbling, a small neutral glow), a dark pick (black cells, grey smoke veins) or any other colour (the pick exactly,
	 * marbled with darker shades of itself). Writes BaseColor, the tone map, the relief, the roughness and the glow.
	 */
	WONDERLAND_API void ApplySmokeLook(UMaterialInstanceDynamic* Instance, const FLinearColor& Pick, bool bDesignedBody);
	/** The base colour ApplySmokeLook paints for this pick: the pick itself, the designed body's vein blue, or a dark pick's grey. */
	WONDERLAND_API FLinearColor SmokeBaseFor(const FLinearColor& Pick, bool bDesignedBody);
	/** The profile ApplySmokeLook uses for this pick, by name (designed / light / dark / colour), for the QA's log. */
	WONDERLAND_API FString SmokeProfileName(const FLinearColor& Pick, bool bDesignedBody);
	/** One line naming the smoke look's current settings, for the QA's log. */
	WONDERLAND_API FString DescribeSmokeLook();

	/**
	 * SAVE, AND MAKE IT TRUE EVERYWHERE, NOW.
	 *
	 * The founder's rule for these controls is that the Wardrobe and the Menu are one system: "Changing the
	 * mascot color in Wardrobe must immediately be reflected in Menu. Changing it in Menu must immediately be
	 * reflected when Wardrobe opens." Every writer calls this and nothing else, so there is one path from a
	 * chosen colour to a repainted world.
	 */
	WONDERLAND_API void SaveAndApply();

	/** Told whenever SaveAndApply runs, so an open panel can redraw its swatches. */
	WONDERLAND_API FSimpleMulticastDelegate& OnChanged();

	/**
	 * Tint one material instance, setting EVERY name the project's materials use for a colour.
	 *
	 * A material instance accepts any parameter name and silently ignores one it does not have, so a mis-named
	 * parameter is indistinguishable from a correct one that had no effect -- the failure that made the brain's
	 * chamber panels white and the ember flames brown. Setting all of them costs nothing and cannot miss.
	 */
	WONDERLAND_API void Tint(class UMaterialInstanceDynamic* Instance, const FLinearColor& Colour);
}
