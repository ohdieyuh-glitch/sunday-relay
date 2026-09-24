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

	/** THE RELAY DOG'S EYES, and only the eyes. The founder's gold is what the canon Dog already wears. */
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

	static const UWonderlandMascotStyleSettings& Get()
	{
		const UWonderlandMascotStyleSettings* Settings = GetDefault<UWonderlandMascotStyleSettings>();
		check(Settings != nullptr);
		return *Settings;
	}
};

namespace WonderlandMascotStyle
{
	/** True when a part, material or component of this name is one of the Dog's eyes rather than its body. */
	WONDERLAND_API bool NamesAnEye(const FString& Name);

	/**
	 * Tint one material instance, setting EVERY name the project's materials use for a colour.
	 *
	 * A material instance accepts any parameter name and silently ignores one it does not have, so a mis-named
	 * parameter is indistinguishable from a correct one that had no effect -- the failure that made the brain's
	 * chamber panels white and the ember flames brown. Setting all of them costs nothing and cannot miss.
	 */
	WONDERLAND_API void Tint(class UMaterialInstanceDynamic* Instance, const FLinearColor& Colour);
}
