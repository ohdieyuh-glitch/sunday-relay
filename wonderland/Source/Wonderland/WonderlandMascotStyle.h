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

	/** THE RELAY DOG'S EYES, and a skin's SECONDARY ACCENTS once chosen -- Jack Flame's fire and tie (founder,
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

	/** The swatches offered in the Wardrobe and the Menu, so both offer exactly the same set. */
	WONDERLAND_API const TArray<TPair<FName, FLinearColor>>& Palette();

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
