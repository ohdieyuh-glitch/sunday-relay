// WHERE THE USAGE HUD'S READING COMES FROM, AND THE ONE PLACE A PREVIEW LIVES.
//
// The HUD is a presenter of UWonderlandUsageSubsystem, and the subsystem holds whatever an
// authority last applied through ApplyUsage. Until Julius's usage authority is connected to
// Wonderland nothing applies a reading, and the founder asked (2026-09-13) to SEE the finished
// instrument at full capacity in the meantime. That is a development preview, and it is built to
// be replaced rather than to be mistaken for data:
//
//   * ONE SOURCE SETTING. Project Settings > Game > Wonderland Usage HUD, stored in DefaultGame.ini.
//     `DevelopmentPreview` applies the preview reading below; `JuliusUsageAuthority` applies nothing
//     and leaves the subsystem to whatever the real authority pushes. Swapping the source is the
//     whole migration -- the widget, the subsystem and the contract do not change.
//   * ONE PREVIEW STATE. The two percentages live in FWonderlandUsagePreviewState and nowhere else;
//     no widget, Blueprint node or test carries its own 100.
//   * THE SAME CONTRACT. The preview is an ordinary FWonderlandUsageHud applied through the ordinary
//     ApplyUsage path, so the HUD draws it with exactly the code a real reading will use.
//   * IT SAYS WHAT IT IS. Every meter is Provenance=Simulated with bSimulated set, the authority id
//     is `development-preview`, and the HUD prints DEVELOPMENT PREVIEW under the meters. Shipping
//     builds never apply it.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "WonderlandUsageHud.h"
#include "WonderlandUsagePreview.generated.h"

class UGameInstance;
class UWonderlandUsageSubsystem;

/** Who feeds the usage HUD in this build. */
UENUM(BlueprintType)
enum class EWonderlandUsageSource : uint8
{
	/** Nothing is applied locally; the HUD shows what Julius's usage authority reports (or that nothing is reporting). */
	JuliusUsageAuthority,
	/** The development preview reading is applied at player attach. Never in Shipping. */
	DevelopmentPreview,
};

/** The development preview's figures: how full each meter is drawn, in percent of its capacity. */
USTRUCT(BlueprintType)
struct FWonderlandUsagePreviewState
{
	GENERATED_BODY()

	/** Green, the dominant arc: the Compound AI Agent (Julius) channel. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Preview", meta = (ClampMin = "0", ClampMax = "100"))
	float CompoundAgentPercent = 100.0f;

	/** Blue, the arc behind it: the Single AI Agent channel. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Preview", meta = (ClampMin = "0", ClampMax = "100"))
	float SingleAgentPercent = 100.0f;

	/**
	 * White, nested beside the blue: the imported LLM Companion (founder, 2026-09-15). Preview-only --
	 * the usage contract has no LLM Companion channel yet, so this figure is the only thing that can
	 * fill the white arc, and it is drawn only when UWonderlandUsageHudSettings::bShowLlmCompanionMeter is set.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Preview", meta = (ClampMin = "0", ClampMax = "100"))
	float LlmCompanionPercent = 100.0f;
};

UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Wonderland Usage HUD"))
class WONDERLAND_API UWonderlandUsageHudSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UPROPERTY(Config, EditAnywhere, Category = "Source")
	EWonderlandUsageSource UsageSource = EWonderlandUsageSource::JuliusUsageAuthority;

	UPROPERTY(Config, EditAnywhere, Category = "Source", meta = (EditCondition = "UsageSource == EWonderlandUsageSource::DevelopmentPreview"))
	FWonderlandUsagePreviewState Preview;

	/**
	 * Draw the third, white LLM Companion arc beside the blue one, with the blue slimmed to make room
	 * (WonderlandCompanionHud.h). Off, the HUD is exactly the approved two-meter instrument. On, the white
	 * arc shows a figure only while the held reading is the development preview; under a real authority
	 * it draws its track and no percentage, because nobody reports LLM Companion usage yet.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Composition")
	bool bShowLlmCompanionMeter = false;
};

namespace WonderlandUsagePreview
{
	/** The authority id every preview reading carries; the HUD's provenance line keys on it. */
	inline const TCHAR* const AuthorityId = TEXT("development-preview");
	/** The project the preview binds, so a real authority's bind replaces it cleanly. */
	inline const TCHAR* const ProjectId = TEXT("wonderland-development-preview");

	/** The preview as an ordinary usage reading. Capacity is 100 units, so remaining units ARE the percentage. */
	WONDERLAND_API FWonderlandUsageHud BuildReading(const FWonderlandUsagePreviewState& State);

	/**
	 * Apply the configured preview when the source setting asks for one and nothing else holds the
	 * subsystem. Returns true only when a preview reading was applied. Does nothing in Shipping, and
	 * never replaces a reading from another authority.
	 */
	WONDERLAND_API bool ApplyIfConfigured(UGameInstance* GameInstance);
}
