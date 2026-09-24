// WONDERLAND — THE SUB-AGENT + WONDER WEB DEMONSTRATION.
//
// FOUNDER DIRECTIVE (2026-09-22): "Create a polished SIMULATION DEMONSTRATION inside Wonderland that visibly shows
// BOTH: 1. Relay Dog Sub-Agent Cub Ghosts being used during a mission, 2. Wonder Web being actively used during that
// same demonstration ... The demonstration should be visually understandable without someone needing to read
// engineering logs."
//
// WHAT THIS IS NOT. It is not a second mission system, not a second browser, and not a second authority over
// anything. Every step below CALLS the system that already owns that behaviour -- the clearance probe, the mission
// beats, the cub flock, the Wonder Web workspace and its live pages -- and the only thing this file owns is the
// ORDER and the DWELL. A demonstration that reimplemented what it demonstrates would be a demonstration of itself.
//
// CUBS ARE ORDINARY SUB-AGENTS. Not /MAS, not Compound AI Agent clones, not alternate Julius instances, and the word
// does not appear in this flow at all. Julius remains the primary Compound AI Agent and the mission authority
// throughout; the cubs are delegated helpers and the demonstration says so on screen.
//
// IT IS SIMULATED AND IT SAYS SO. The sub-agent count comes from the DEVELOPMENT fixture path
// (`ReportActiveSubAgentsForDevelopment`), never from the production Julius path, and every surface that shows the
// count shows where it came from. Production remains Julius -> ActiveSubagents -> presentation, untouched.
//
// WHY A STEP MACHINE AND NOT A TIMELINE. The founder asked for a demonstration that works every time, and a script
// of "wait 2 s, then do the next thing" is exactly the thing that works until the day a page loads slowly. Every
// step here has THREE parts: what it does once on entry, an observable condition that says it actually happened, and
// a dwell long enough for a person to see it. A step advances when the dwell has passed AND the condition is true --
// or when its timeout expires, in which case it advances anyway and RECORDS THAT IT FELL THROUGH. So the demo cannot
// hang on a slow page and cannot race ahead of one, and a run where something did not happen says which step.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "WonderlandDemoFlow.generated.h"

/** The demonstration, in order. One entry per beat the founder listed. */
UENUM(BlueprintType)
enum class EWonderlandDemoStep : uint8
{
	/** Not running. */
	Off,
	/** The Dog is where it will be staged from, and the viewer is told what they are about to see. */
	Staging,
	/** The pre-mission spatial clearance probe, before any cinematic. */
	Clearance,
	/** The Mission Contract manifests at the staging the probe chose. */
	Contract,
	/** Julius delegates: the simulated sub-agent count becomes non-zero. */
	Delegating,
	/** The primary Relay Dog pauses, lifts, turns luminous, and the cubs emerge one by one. */
	Ascending,
	/** The Dog is still, so the cubs swirl around its body. */
	Swirl,
	/** The Dog walks, so the cubs take the dome above it. */
	Flight,
	/** A Wonder Web window opens in the world. */
	WebOpen,
	/** A real page loads in it. */
	WebLoad,
	/** The page is read: scrolled, and its title and address observed. */
	WebRead,
	/** The cubs are given work to be seen doing. */
	CubWork,
	/** The work finishes: the cubs fly home and fold in, and the count drops honestly. */
	Returning,
	/** The mission reaches its simulated completion. */
	Completing,
	/** Everything settles, with Wonder Web still open long enough to read. */
	Settled,
	/** Done. */
	Finished
};

WONDERLAND_API const TCHAR* WonderlandDemoStepName(EWonderlandDemoStep Step);

/** What one step did, and whether it actually happened. */
USTRUCT(BlueprintType)
struct WONDERLAND_API FWonderlandDemoBeat
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Demo")
	FName Id;

	/** What a viewer is meant to understand from this beat. Shown on screen, not just logged. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Demo")
	FString Caption;

	/** True when the step's own condition was observed rather than timed out. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Demo")
	bool bObserved = false;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Demo")
	float Seconds = 0.0f;

	/** What was measured: a count, an address, a frame number. Never a claim, always a reading. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Demo")
	FString Note;
};

/**
 * THE DEMONSTRATION DIRECTOR.
 *
 * A world subsystem, because a demonstration is a thing happening in a level and must not survive leaving it.
 */
UCLASS()
class WONDERLAND_API UWonderlandDemoSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;
	virtual void Deinitialize() override;

	/**
	 * RUN THE DEMONSTRATION. Starting it again restarts it from the beginning, so a founder who wants to see it twice
	 * presses the same key twice rather than having to know how to stop it.
	 */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Demo")
	bool BeginSubAgentWebDemo();

	/** Stop, and put back everything the demonstration changed. */
	UFUNCTION(BlueprintCallable, Category = "Wonderland|Demo")
	void StopDemo();

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	bool IsRunning() const { return Step != EWonderlandDemoStep::Off && Step != EWonderlandDemoStep::Finished; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	EWonderlandDemoStep GetStep() const { return Step; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	FString GetStepName() const { return WonderlandDemoStepName(Step); }

	/** What the viewer is being shown right now, in words. The on-screen caption reads this. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	FString GetCaption() const { return Caption; }

	/** Every beat so far, with what was measured at each. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	const TArray<FWonderlandDemoBeat>& GetBeats() const { return Beats; }

	/** The run as lines, for `wl.Demo.Status` and for a proof. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	TArray<FString> DescribeDemo() const;

	/* ---- THE FOUNDER'S CHECKLIST, measured while it runs rather than asserted afterwards ---- */

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	bool DidAscend() const { return bAscended; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	bool DidSwirl() const { return bSwirled; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	bool DidFly() const { return bFlew; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	bool DidReturn() const { return bReturned; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	bool DidWebOpen() const { return bWebOpened; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	bool DidPageLoad() const { return bPageLoaded; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	bool DidComplete() const { return bCompleted; }

	/** The most cubs seen at once. The founder asked for four or five of them together. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	int32 GetPeakCubCount() const { return PeakCubs; }

	/** The address the page actually reported being on. Empty if none ever loaded. */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	FString GetLoadedUrl() const { return LoadedUrl; }

	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	FString GetLoadedTitle() const { return LoadedTitle; }

	/**
	 * WHERE THE SUB-AGENT COUNT CAME FROM, in words, for the on-screen label and the report. Always DEVELOPMENT while
	 * this demonstration is driving it -- that is the point of having a separate path for it.
	 */
	UFUNCTION(BlueprintPure, Category = "Wonderland|Demo")
	FString GetSubAgentSourceLabel() const;

	/** The page this demonstration browses. The founder nominated it. */
	static const TCHAR* DemoPageUrl();

private:
	void Enter(EWonderlandDemoStep Next);
	bool StepReady() const;
	void RecordBeat(bool bObserved);
	class UWonderlandMissionSubsystem* Mission() const;
	class UWonderlandUiSubsystem* Ui() const;
	class UWonderlandSubAgentCubSubsystem* Cubs() const;
	class UWonderlandWonderWebLiveSubsystem* Live() const;
	class APawn* Dog() const;
	/** Mean of what the flock is doing right now: how high above the Dog, and how far into FLIGHT. */
	void ReadFlock(float& OutMeanHeight, float& OutMeanBlend, int32& OutCount) const;

	EWonderlandDemoStep Step = EWonderlandDemoStep::Off;
	FString Caption;
	TArray<FWonderlandDemoBeat> Beats;
	float StepSeconds = 0.0f;
	float StepMin = 0.0f;
	float StepTimeout = 0.0f;
	/** Readings taken on entry, so a step can tell what CHANGED rather than only what is true. */
	int32 FramesAtEntry = 0;

	bool bAscended = false;
	bool bSwirled = false;
	bool bFlew = false;
	bool bReturned = false;
	bool bWebOpened = false;
	bool bPageLoaded = false;
	bool bCompleted = false;
	int32 PeakCubs = 0;
	FString LoadedUrl;
	FString LoadedTitle;
	FName WebWindow;
	/** True when this demonstration had to widen the browser allowlist for the founder's nominated page. */
	bool bWidenedAllowlist = false;

	void ShowCaption();
	void HideCaption();

	/** The caption layer. Exists only while the demonstration runs; the HUD proper is never touched. */
	TSharedPtr<class SWidget> CaptionLayer;
};
