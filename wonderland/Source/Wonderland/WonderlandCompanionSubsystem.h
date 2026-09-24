// WONDERLAND — THE COMPANION PREVIEW: who floats beside the player, and from which figure.
//
// THE FOUNDER'S ASK, 2026-09-15, before any import is wired: SEE an imported LLM Companion and an imported
// Jhinn AI Agent physically beside the Relay Dog in Wonderland. This subsystem is that preview and nothing
// more. It spawns two AWonderlandCompanionEmbodiment actors for the local player whenever a controller
// attaches in a game world, points them at whatever pawn that controller wears, and removes them when the
// controller goes. Nothing is placed in a map and nothing is saved, so no world file changes and a PIE
// restart starts clean.
//
// IT IS NOT AN IMPORT. No provider is contacted, no agent is attached, and the terminals beside these bodies
// say WAITING and record typed lines as not sent. The names are presentation names for the preview
// (founder: "GPT 6 Astra", "Claude Code Fable 5"). When /join and real imports arrive, the embodiment is the
// part that stays; what decides who is embodied moves to whatever authority owns imports.
//
// ONE SETTING TURNS IT ON (Project Settings > Game > Wonderland Companion Preview, DefaultGame.ini), and
// Shipping never shows it. The Jhin canon it follows (WorldDesign/PRODUCTION_ORDER.md): Jhins are Single AI
// Agents beside Julius, never replacing it; an IMPORTED agent's spectral lower body is the immutable
// cyan-blue crystalline colour. The LLM Companion is not a Jhin, and wears starlight instead.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "Subsystems/LocalPlayerSubsystem.h"
#include "WonderlandCompanionSubsystem.generated.h"

class APlayerController;
class AWonderlandCompanionEmbodiment;

UCLASS(Config = Game, DefaultConfig, meta = (DisplayName = "Wonderland Companion Preview"))
class WONDERLAND_API UWonderlandCompanionPreviewSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	/** Spawn both preview embodiments beside the player and mount their terminals. Never in Shipping. */
	UPROPERTY(Config, EditAnywhere, Category = "Preview")
	bool bShowCompanionPreview = false;

	/** Where figure files live: relative to the project directory unless absolute. `wl.Companion.FigureDir` overrides it. */
	UPROPERTY(Config, EditAnywhere, Category = "Preview")
	FString FigureDirectory = TEXT("Companions");

	/**
	 * WHAT THE FOUNDER CALLED HIS COMPOUND AGENT.
	 *
	 * The HUD's three rows name the three things that are actually running -- "COMPOUND AGENT: <user-created
	 * name>", "SINGLE AGENT: <active coding agent>", "LLM COMPANION: <active companion>" (founder, 2026-09-24).
	 * The other two names already existed, below; this is the one that did not, because the compound agent is
	 * the one the user names themselves rather than one Wonderland ships.
	 */
	UPROPERTY(Config, EditAnywhere, Category = "Preview")
	FString CompoundAgentName = TEXT("Julius");

	/** The imported large language model companion's presentation name. */
	UPROPERTY(Config, EditAnywhere, Category = "LLM Companion")
	FString LlmCompanionName = TEXT("GPT 6 Astra");

	UPROPERTY(Config, EditAnywhere, Category = "LLM Companion")
	FString LlmCompanionFigure = TEXT("GPT6Astra.wlvox");

	/** In the pawn's yaw frame: X forward, Y right (negative is the Dog's left), uu. */
	UPROPERTY(Config, EditAnywhere, Category = "LLM Companion")
	FVector LlmCompanionOffset = FVector(-40.0, -135.0, 0.0);

	/** The imported Jhinn AI Agent's presentation name. */
	UPROPERTY(Config, EditAnywhere, Category = "AI Agent")
	FString AgentName = TEXT("Claude Code Fable 5");

	UPROPERTY(Config, EditAnywhere, Category = "AI Agent")
	FString AgentFigure = TEXT("ClaudeCodeFable5.wlvox");

	UPROPERTY(Config, EditAnywhere, Category = "AI Agent")
	FVector AgentOffset = FVector(-40.0, 140.0, 0.0);
};

UCLASS()
class WONDERLAND_API UWonderlandCompanionSubsystem : public ULocalPlayerSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Whether this build shows the companion preview at all. False in Shipping, whatever the setting says. */
	static bool IsPreviewEnabled();

	/** A figure file named by a setting: absolute as given, else under `wl.Companion.FigureDir` or FigureDirectory. */
	static FString ResolveFigurePath(const FString& FileName);

	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	int32 GetEmbodimentCount() const;

	/** 0 is the LLM Companion, 1 the Jhinn AI Agent. Null when the preview is off or the index is out of range. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Companion")
	AWonderlandCompanionEmbodiment* GetEmbodiment(int32 Index) const;

	/** Re-read the figure files and rebuild both bodies in place. Returns how many rebuilt. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Companion")
	int32 ReloadFigures();

private:
	/**
	 * THE BODIES FOLLOW THE RUNTIME. Whatever the sidekick runtime says each companion's mind is doing -- thinking,
	 * working, waiting for an account, or nothing at all -- is pushed into its body here (WonderlandSidekicks.h).
	 * Founder, 2026-09-17: "If no provider is connected: do not pretend it is working."
	 */
	void PushRuntimeActivity();
	void HandlePlayerControllerChanged(APlayerController* NewController);
	void Spawn(APlayerController* Controller);
	void Despawn();

	TWeakObjectPtr<APlayerController> BoundController;
	TArray<TWeakObjectPtr<AWonderlandCompanionEmbodiment>> Embodiments;
	FDelegateHandle ControllerChangedHandle;
	FDelegateHandle SidekicksChangedHandle;
};
