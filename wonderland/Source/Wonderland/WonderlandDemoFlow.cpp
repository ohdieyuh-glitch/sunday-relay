#include "WonderlandDemoFlow.h"

#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Kismet/GameplayStatics.h"
#include "WonderlandMissionSubsystem.h"
#include "WonderlandSubAgentCubs.h"
#include "WonderlandUiSubsystem.h"
#include "Engine/GameViewportClient.h"
#include "Widgets/Layout/SBorder.h"
#include "Widgets/Layout/SConstraintCanvas.h"
#include "Widgets/SBoxPanel.h"
#include "Widgets/Text/STextBlock.h"
#include "WonderlandUiStyle.h"
#include "WonderlandWonderWebLive.h"

namespace
{
	/**
	 * HOW LONG EACH BEAT IS HELD, AND HOW LONG IT IS WAITED FOR.
	 *
	 * The dwell is for the viewer: a beat that is over before a person notices it did not demonstrate anything. The
	 * timeout is for the machine: it is the point at which the demonstration stops waiting for something and goes on
	 * WITHOUT it, recording that it did. Neither number changes what any system does; they only change how long a
	 * person is given to see it.
	 */
	struct FStepTiming { float Min; float Timeout; };

	FStepTiming TimingFor(EWonderlandDemoStep Step)
	{
		switch (Step)
		{
		case EWonderlandDemoStep::Staging:    return {2.5f, 4.0f};
		case EWonderlandDemoStep::Clearance:  return {2.0f, 5.0f};
		case EWonderlandDemoStep::Contract:   return {3.0f, 8.0f};
		case EWonderlandDemoStep::Delegating: return {1.5f, 5.0f};
		// The ascension is the longest wait by far: one cub leaves at a time, on purpose, and hurrying it would
		// destroy the one thing it exists to show.
		case EWonderlandDemoStep::Ascending:  return {6.0f, 16.0f};
		case EWonderlandDemoStep::Swirl:      return {7.0f, 12.0f};
		case EWonderlandDemoStep::Flight:     return {7.0f, 14.0f};
		case EWonderlandDemoStep::WebOpen:    return {2.0f, 6.0f};
		// A real page over a real network. Generous, because the honest alternative to waiting is a fake page.
		case EWonderlandDemoStep::WebLoad:    return {3.0f, 25.0f};
		case EWonderlandDemoStep::WebRead:    return {6.0f, 14.0f};
		case EWonderlandDemoStep::CubWork:    return {6.0f, 10.0f};
		case EWonderlandDemoStep::Returning:  return {4.0f, 14.0f};
		case EWonderlandDemoStep::Completing: return {3.0f, 6.0f};
		case EWonderlandDemoStep::Settled:    return {6.0f, 8.0f};
		default:                              return {0.0f, 1.0f};
		}
	}

	/** Four or five cubs, as the founder asked for this demonstration. Capacity is five, so five is what is asked for. */
	constexpr int32 DemoCubCount = 5;

	/** Above this mean blend the flock is in FLIGHT; below its complement it is in SWIRL. Read, never assumed. */
	constexpr float FlightBlendSeen = 0.70f;
	constexpr float SwirlBlendSeen = 0.30f;

	/** The tab a spawned Wonder Web window works in is named after the window; the first one is "browser". */
	const TCHAR* FirstBrowserWindow = TEXT("browser");
}

const TCHAR* UWonderlandDemoSubsystem::DemoPageUrl()
{
	// THE FOUNDER'S NOMINATED PAGE. A real address on the real internet, loaded through the existing Wonder Web path.
	return TEXT("https://iwonder-context-hub.vercel.app/");
}

const TCHAR* WonderlandDemoStepName(EWonderlandDemoStep Step)
{
	switch (Step)
	{
	case EWonderlandDemoStep::Off:        return TEXT("OFF");
	case EWonderlandDemoStep::Staging:    return TEXT("STAGING");
	case EWonderlandDemoStep::Clearance:  return TEXT("CLEARANCE");
	case EWonderlandDemoStep::Contract:   return TEXT("MISSION CONTRACT");
	case EWonderlandDemoStep::Delegating: return TEXT("DELEGATING");
	case EWonderlandDemoStep::Ascending:  return TEXT("ASCENSION");
	case EWonderlandDemoStep::Swirl:      return TEXT("SWIRL");
	case EWonderlandDemoStep::Flight:     return TEXT("FLIGHT");
	case EWonderlandDemoStep::WebOpen:    return TEXT("WONDER WEB OPEN");
	case EWonderlandDemoStep::WebLoad:    return TEXT("WONDER WEB LOADING");
	case EWonderlandDemoStep::WebRead:    return TEXT("WONDER WEB IN USE");
	case EWonderlandDemoStep::CubWork:    return TEXT("SUB-AGENTS WORKING");
	case EWonderlandDemoStep::Returning:  return TEXT("SUB-AGENTS RETURNING");
	case EWonderlandDemoStep::Completing: return TEXT("COMPLETING");
	case EWonderlandDemoStep::Settled:    return TEXT("SETTLED");
	case EWonderlandDemoStep::Finished:   return TEXT("FINISHED");
	}
	return TEXT("UNKNOWN");
}

/* ------------------------------------------------------------------ who this talks to */

UWonderlandMissionSubsystem* UWonderlandDemoSubsystem::Mission() const
{
	const APlayerController* Controller = UGameplayStatics::GetPlayerController(GetWorld(), 0);
	ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
	return Player != nullptr ? Player->GetSubsystem<UWonderlandMissionSubsystem>() : nullptr;
}

UWonderlandUiSubsystem* UWonderlandDemoSubsystem::Ui() const
{
	const APlayerController* Controller = UGameplayStatics::GetPlayerController(GetWorld(), 0);
	ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
	return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
}

UWonderlandSubAgentCubSubsystem* UWonderlandDemoSubsystem::Cubs() const
{
	UWorld* World = GetWorld();
	return World != nullptr ? World->GetSubsystem<UWonderlandSubAgentCubSubsystem>() : nullptr;
}

UWonderlandWonderWebLiveSubsystem* UWonderlandDemoSubsystem::Live() const
{
	const UWorld* World = GetWorld();
	UGameInstance* GameInstance = World != nullptr ? World->GetGameInstance() : nullptr;
	return GameInstance != nullptr ? GameInstance->GetSubsystem<UWonderlandWonderWebLiveSubsystem>() : nullptr;
}

APawn* UWonderlandDemoSubsystem::Dog() const
{
	return UGameplayStatics::GetPlayerPawn(GetWorld(), 0);
}

FString UWonderlandDemoSubsystem::GetSubAgentSourceLabel() const
{
	const UWonderlandSubAgentCubSubsystem* Flock = Cubs();
	if (Flock == nullptr)
	{
		return TEXT("NO FLOCK");
	}
	// THE DEMONSTRATION NEVER CLAIMS LIVE. It drives the development fixture path on purpose, and this label is what
	// keeps a viewer -- or a screenshot of a viewer's screen -- from reading a simulated count as a real one.
	switch (Flock->GetCountSource())
	{
	case EWonderlandCubCountSource::Julius:      return TEXT("LIVE  ·  JULIUS");
	case EWonderlandCubCountSource::Development: return TEXT("SIMULATED  ·  DEVELOPMENT FIXTURE, NOT LIVE JULIUS");
	case EWonderlandCubCountSource::UserSummoned: return TEXT("SUMMONED  ·  A USER REQUEST, NOT A JULIUS REPORT");
	default:                                     return TEXT("NOTHING REPORTED");
	}
}

void UWonderlandDemoSubsystem::ReadFlock(float& OutMeanHeight, float& OutMeanBlend, int32& OutCount) const
{
	OutMeanHeight = 0.0f;
	OutMeanBlend = 0.0f;
	OutCount = 0;
	const UWonderlandSubAgentCubSubsystem* Flock = Cubs();
	const APawn* Pawn = Dog();
	if (Flock == nullptr || Pawn == nullptr)
	{
		return;
	}
	const TArray<AWonderlandSubAgentCub*> All = Flock->GetCubs();
	for (const AWonderlandSubAgentCub* Cub : All)
	{
		if (Cub == nullptr)
		{
			continue;
		}
		OutMeanHeight += static_cast<float>(Cub->GetActorLocation().Z - Pawn->GetActorLocation().Z);
		OutMeanBlend += Cub->GetFlightBlend();
		++OutCount;
	}
	if (OutCount > 0)
	{
		OutMeanHeight /= OutCount;
		OutMeanBlend /= OutCount;
	}
}

/* ------------------------------------------------------------------ running it */

bool UWonderlandDemoSubsystem::BeginSubAgentWebDemo()
{
	if (Dog() == nullptr)
	{
		UE_LOG(LogTemp, Warning, TEXT("WLDEMO there is no Relay Dog in the world to demonstrate with"));
		return false;
	}
	// STARTING AGAIN RESTARTS IT. A founder who wants to see it twice presses the same key twice.
	StopDemo();
	Beats.Reset();
	bAscended = bSwirled = bFlew = bReturned = bWebOpened = bPageLoaded = bCompleted = false;
	PeakCubs = 0;
	LoadedUrl.Reset();
	LoadedTitle.Reset();
	WebWindow = NAME_None;

	// THE FOUNDER'S NOMINATED PAGE HAS TO BE ALLOWED TO LOAD, and the allowlist is policy rather than plumbing -- so
	// widening it is done openly, said out loud, and reported afterwards. The alternative was to fake the page, which
	// the founder ruled out in the same breath as nominating it.
	if (IConsoleVariable* Hosts = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.WonderWeb.RealHosts")))
	{
		const FString Host = TEXT("iwonder-context-hub.vercel.app");
		const FString Current = Hosts->GetString();
		if (!Current.Contains(Host))
		{
			Hosts->Set(*(Current + TEXT(",") + Host), ECVF_SetByConsole);
			bWidenedAllowlist = true;
			UE_LOG(LogTemp, Display,
				TEXT("WLDEMO added '%s' to wl.WonderWeb.RealHosts for the demonstration -- the founder nominated this page"),
				*Host);
		}
	}

	UE_LOG(LogTemp, Display, TEXT("WLDEMO SUB-AGENT + WONDER WEB DEMONSTRATION -- SIMULATED, not live Julius"));
	ShowCaption();
	Enter(EWonderlandDemoStep::Staging);
	return true;
}

void UWonderlandDemoSubsystem::StopDemo()
{
	if (Step == EWonderlandDemoStep::Off)
	{
		return;
	}
	// PUT BACK WHAT THE DEMONSTRATION CHANGED. It borrowed the flock and a browser window; neither is its property.
	if (UWonderlandSubAgentCubSubsystem* Flock = Cubs())
	{
		Flock->ReportActiveSubAgentsForDevelopment(0);
	}
	Step = EWonderlandDemoStep::Off;
	Caption.Reset();
	HideCaption();
}

void UWonderlandDemoSubsystem::ShowCaption()
{
	if (CaptionLayer.IsValid())
	{
		return;
	}
	const APlayerController* Controller = UGameplayStatics::GetPlayerController(GetWorld(), 0);
	ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
	if (Player == nullptr || Player->ViewportClient == nullptr)
	{
		return;
	}
	TWeakObjectPtr<UWonderlandDemoSubsystem> WeakThis(this);

	// BENEATH THE MISSION STRIP, never over it. The strip carries the mission's own truth line and this carries the
	// demonstration's; two labels fighting for the same band would leave a viewer reading neither.
	CaptionLayer = SNew(SConstraintCanvas)
		.Visibility(EVisibility::HitTestInvisible)
		+ SConstraintCanvas::Slot()
		.Anchors(FAnchors(0.5f, 0.090f, 0.5f, 0.090f))
		.Alignment(FVector2D(0.5f, 0.0f))
		.AutoSize(true)
		.Offset(FMargin(0.0f))
		[
			SNew(SBorder)
			.BorderImage(FCoreStyle::Get().GetBrush("WhiteBrush"))
			.BorderBackgroundColor(FSlateColor(FLinearColor(0.02f, 0.02f, 0.035f, 0.72f)))
			.Padding(FMargin(18.0f, 9.0f))
			[
				SNew(SVerticalBox)
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center)
				[
					// WHAT IS HAPPENING, in a sentence a person reads rather than parses.
					SNew(STextBlock)
					.Font(WonderlandUi::Sans(13, true, 2))
					.ColorAndOpacity(WonderlandUi::Cream())
					.Text_Lambda([WeakThis]()
					{
						return WeakThis.IsValid() ? FText::FromString(WeakThis->GetCaption()) : FText::GetEmpty();
					})
				]
				+ SVerticalBox::Slot().AutoHeight().HAlign(HAlign_Center).Padding(FMargin(0.0f, 5.0f, 0.0f, 0.0f))
				[
					// AND WHERE THE COUNT CAME FROM, never omitted. A screenshot travels further than the person who
					// took it, so a simulated count must be legible as simulated in the picture itself.
					SNew(STextBlock)
					.Font(WonderlandUi::Sans(8, false, 2))
					.ColorAndOpacity(WonderlandUi::Faint())
					.Text_Lambda([WeakThis]()
					{
						if (!WeakThis.IsValid())
						{
							return FText::GetEmpty();
						}
						const UWonderlandDemoSubsystem* Demo = WeakThis.Get();
						return FText::FromString(FString::Printf(
							TEXT("FOUNDER DEMONSTRATION  ·  %s  ·  SUB-AGENT COUNT: %s  ·  JULIUS REMAINS THE PRIMARY COMPOUND AI AGENT"),
							*Demo->GetStepName(), *Demo->GetSubAgentSourceLabel()));
					})
				]
			]
		];
	// Above the mission strip's layer so the two never overlap in z, and well below any panel or window.
	Player->ViewportClient->AddViewportWidgetForPlayer(Player, CaptionLayer.ToSharedRef(), 19);
}

void UWonderlandDemoSubsystem::HideCaption()
{
	if (!CaptionLayer.IsValid())
	{
		return;
	}
	const APlayerController* Controller = UGameplayStatics::GetPlayerController(GetWorld(), 0);
	ULocalPlayer* Player = Controller != nullptr ? Controller->GetLocalPlayer() : nullptr;
	if (Player != nullptr && Player->ViewportClient != nullptr)
	{
		Player->ViewportClient->RemoveViewportWidgetForPlayer(Player, CaptionLayer.ToSharedRef());
	}
	CaptionLayer.Reset();
}

void UWonderlandDemoSubsystem::RecordBeat(bool bObserved)
{
	FWonderlandDemoBeat Beat;
	Beat.Id = FName(WonderlandDemoStepName(Step));
	Beat.Caption = Caption;
	Beat.bObserved = bObserved;
	Beat.Seconds = StepSeconds;

	float Height = 0.0f;
	float Blend = 0.0f;
	int32 Count = 0;
	ReadFlock(Height, Blend, Count);
	switch (Step)
	{
	case EWonderlandDemoStep::Clearance:
		if (const UWonderlandMissionSubsystem* M = Mission())
		{
			Beat.Note = FString::Printf(TEXT("%s  ·  %.0f uu clear  ·  %.0f uu headroom  ·  %d places measured"),
				*M->GetLastStagingFitName(), M->GetLastStaging().Chosen.ClearRadiusUU,
				M->GetLastStaging().Chosen.ClearHeightUU, M->GetLastStaging().CandidatesTried);
		}
		break;
	case EWonderlandDemoStep::Ascending:
	case EWonderlandDemoStep::Swirl:
	case EWonderlandDemoStep::Flight:
	case EWonderlandDemoStep::CubWork:
		Beat.Note = FString::Printf(TEXT("%d cubs  ·  mean %.0f uu above the Dog  ·  flight blend %.2f"), Count, Height, Blend);
		break;
	case EWonderlandDemoStep::WebLoad:
	case EWonderlandDemoStep::WebRead:
		if (const UWonderlandWonderWebLiveSubsystem* L = Live())
		{
			const FString Tab(FirstBrowserWindow);
			Beat.Note = FString::Printf(TEXT("%s  ·  \"%s\"  ·  %d frames%s"),
				*L->GetLiveUrl(Tab), *L->GetTitle(Tab), L->GetFrameCount(Tab),
				L->GetProblem(Tab).IsEmpty() ? TEXT("") : *FString::Printf(TEXT("  ·  %s"), *L->GetProblem(Tab)));
		}
		break;
	case EWonderlandDemoStep::Returning:
		Beat.Note = FString::Printf(TEXT("%d cubs remaining"), Count);
		break;
	default:
		break;
	}
	Beats.Add(Beat);
	UE_LOG(LogTemp, Display, TEXT("WLDEMO %-22s %s  (%.1f s)%s%s"),
		WonderlandDemoStepName(Step), bObserved ? TEXT("observed") : TEXT("TIMED OUT"),
		StepSeconds, Beat.Note.IsEmpty() ? TEXT("") : TEXT("  ·  "), *Beat.Note);
}

void UWonderlandDemoSubsystem::Enter(EWonderlandDemoStep Next)
{
	Step = Next;
	StepSeconds = 0.0f;
	const FStepTiming Timing = TimingFor(Next);
	StepMin = Timing.Min;
	StepTimeout = Timing.Timeout;

	UWonderlandMissionSubsystem* M = Mission();
	UWonderlandSubAgentCubSubsystem* Flock = Cubs();
	UWonderlandUiSubsystem* U = Ui();

	switch (Next)
	{
	case EWonderlandDemoStep::Staging:
		Caption = TEXT("JULIUS  ·  PRIMARY COMPOUND AI AGENT  ·  preparing a mission");
		break;

	case EWonderlandDemoStep::Clearance:
		Caption = TEXT("CLEARANCE  ·  measuring the room before anything is staged");
		if (M != nullptr)
		{
			M->ProbeClearanceNow();
		}
		break;

	case EWonderlandDemoStep::Contract:
		Caption = TEXT("MISSION CONTRACT  ·  manifesting at the staging the probe chose");
		if (M != nullptr)
		{
			// THE MISSION'S OWN BEATS, driven one at a time so the demonstration is the order rather than a second
			// mission system. mission_start manifests the Contract; researching is what a delegating run looks like.
			M->SetBeatById(TEXT("mission_start"));
		}
		break;

	case EWonderlandDemoStep::Delegating:
		Caption = TEXT("JULIUS DELEGATES  ·  5 ordinary sub-agents  ·  SIMULATED, not live Julius");
		if (M != nullptr)
		{
			M->SetBeatById(TEXT("researching"));
		}
		if (Flock != nullptr)
		{
			// THE DEVELOPMENT PATH, DELIBERATELY. Production is Julius -> ActiveSubagents -> presentation and is not
			// touched here; this demonstration must never be able to masquerade as that.
			Flock->ReportActiveSubAgentsForDevelopment(DemoCubCount);
		}
		break;

	case EWonderlandDemoStep::Ascending:
		Caption = TEXT("ASCENSION  ·  the Relay Dog lifts and the sub-agent cubs emerge one by one");
		break;

	case EWonderlandDemoStep::Swirl:
		Caption = TEXT("SWIRL  ·  the Dog is still, so the cubs orbit its body");
		break;

	case EWonderlandDemoStep::Flight:
		Caption = TEXT("FLIGHT  ·  the Dog walks, so the cubs take the dome above it");
		break;

	case EWonderlandDemoStep::WebOpen:
		Caption = TEXT("WONDER WEB  ·  opening a window in the world");
		if (U != nullptr)
		{
			U->SpawnWonderWebWindow();
			WebWindow = FName(FirstBrowserWindow);
		}
		break;

	case EWonderlandDemoStep::WebLoad:
		Caption = TEXT("WONDER WEB  ·  loading a real page through Julius Connect");
		if (U != nullptr)
		{
			FString Refusal;
			if (!U->NavigateFocusedBrowser(DemoPageUrl(), Refusal))
			{
				// REFUSED IS A RESULT, NOT A CRASH. The demonstration says so and carries on to show the refusal,
				// because a governed browser refusing a host is a true thing about the system.
				UE_LOG(LogTemp, Warning, TEXT("WLDEMO Wonder Web refused the page: %s"), *Refusal);
				Caption = FString::Printf(TEXT("WONDER WEB  ·  the page was refused: %s"), *Refusal);
			}
		}
		break;

	case EWonderlandDemoStep::WebRead:
		Caption = TEXT("WONDER WEB IN USE  ·  the page is live and being read");
		FramesAtEntry = Live() != nullptr ? Live()->GetFrameCount(FString(FirstBrowserWindow)) : 0;
		if (UWonderlandWonderWebLiveSubsystem* L = Live())
		{
			// THE PAGE'S OWN INPUT PATH, not a simulated click on a named control. The runtime scrolls the real page
			// and sends back frames of the result, which is both the honest way to use it and the only way the frame
			// counter afterwards proves anything.
			L->SendScroll(FString(FirstBrowserWindow), 320.0);
		}
		break;

	case EWonderlandDemoStep::CubWork:
		Caption = TEXT("SUB-AGENTS WORKING  ·  each one on its own piece, under Julius's authority");
		if (Flock != nullptr)
		{
			// DIFFERENT WORK, VISIBLY. Five cubs all doing the same thing is one cub drawn five times.
			const EWonderlandSubAgentCubState Work[] = {
				EWonderlandSubAgentCubState::Researching,
				EWonderlandSubAgentCubState::Implementing,
				EWonderlandSubAgentCubState::Verifying,
				EWonderlandSubAgentCubState::Working,
				EWonderlandSubAgentCubState::Waiting,
			};
			for (int32 Index = 0; Index < DemoCubCount; ++Index)
			{
				Flock->SetCubState(Index, Work[Index % UE_ARRAY_COUNT(Work)]);
			}
		}
		if (M != nullptr)
		{
			M->SetBeatById(TEXT("coding_agent"));
		}
		break;

	case EWonderlandDemoStep::Returning:
		Caption = TEXT("RETURNING  ·  the work is done, the cubs fly home and fold back in");
		if (Flock != nullptr)
		{
			// THE COUNT DROPS HONESTLY: the flock's own RETURNING and MERGING carry them home, and nothing is deleted.
			Flock->ReportActiveSubAgentsForDevelopment(0);
		}
		if (M != nullptr)
		{
			M->SetBeatById(TEXT("verifying"));
		}
		break;

	case EWonderlandDemoStep::Completing:
		Caption = TEXT("COMPLETE  ·  the simulated contract was met  ·  DEVELOPMENT PREVIEW");
		if (M != nullptr)
		{
			M->SetBeatById(TEXT("complete_verified"));
		}
		break;

	case EWonderlandDemoStep::Settled:
		Caption = TEXT("Julius remains the primary Compound AI Agent  ·  Wonder Web stays open to read");
		break;

	case EWonderlandDemoStep::Finished:
		Caption = TEXT("DEMONSTRATION COMPLETE");
		// THE CAPTION STAYS UP at the end, so the last frame of a recording still says what was being shown and that
		// the count was simulated. `wl.Demo.Stop` takes it down.
		UE_LOG(LogTemp, Display, TEXT("WLDEMO finished"));
		for (const FString& Line : DescribeDemo())
		{
			UE_LOG(LogTemp, Display, TEXT("WLDEMO %s"), *Line);
		}
		break;

	default:
		break;
	}
}

bool UWonderlandDemoSubsystem::StepReady() const
{
	const UWonderlandSubAgentCubSubsystem* Flock = Cubs();
	const UWonderlandWonderWebLiveSubsystem* L = Live();
	const UWonderlandUiSubsystem* U = Ui();
	const UWonderlandMissionSubsystem* M = Mission();
	const FString Tab(FirstBrowserWindow);
	float Height = 0.0f;
	float Blend = 0.0f;
	int32 Count = 0;
	ReadFlock(Height, Blend, Count);

	switch (Step)
	{
	case EWonderlandDemoStep::Staging:
		return Dog() != nullptr;
	case EWonderlandDemoStep::Clearance:
		// The probe is synchronous; what is waited for is the dwell, so a viewer sees the beat at all.
		return M != nullptr;
	case EWonderlandDemoStep::Contract:
		return M != nullptr && M->IsOrbInWorld();
	case EWonderlandDemoStep::Delegating:
		return Count > 0;
	case EWonderlandDemoStep::Ascending:
		// EVERY CUB OUT, AND THE ASCENSION OVER. Not a timer: the flock says when it has finished.
		return Flock != nullptr && !Flock->IsAscending() && Count >= DemoCubCount;
	case EWonderlandDemoStep::Swirl:
		// AT REST THEY ORBIT THE BODY: mostly out of FLIGHT, and below the Dog's own height.
		return Count > 0 && Blend < SwirlBlendSeen;
	case EWonderlandDemoStep::Flight:
		return Count > 0 && Blend > FlightBlendSeen;
	case EWonderlandDemoStep::WebOpen:
		return U != nullptr && U->CountOpenWonderWebWindows() > 0;
	case EWonderlandDemoStep::WebLoad:
		// A REAL FRAME FROM A REAL PAGE. Not "we asked it to navigate" -- a picture arrived and the runtime says
		// which address it is of.
		return L != nullptr && L->HasFrame(Tab) && !L->GetLiveUrl(Tab).IsEmpty() && !L->IsLoading(Tab);
	case EWonderlandDemoStep::WebRead:
		// THE PAGE IS STILL LIVE: more frames arrived after the scroll than before it.
		return L != nullptr && L->GetFrameCount(Tab) > FramesAtEntry + 2;
	case EWonderlandDemoStep::CubWork:
		return Count > 0;
	case EWonderlandDemoStep::Returning:
		return Count == 0;
	case EWonderlandDemoStep::Completing:
		return M != nullptr;
	case EWonderlandDemoStep::Settled:
		return true;
	default:
		return true;
	}
}

void UWonderlandDemoSubsystem::Tick(float DeltaTime)
{
	Super::Tick(DeltaTime);
	if (!IsRunning())
	{
		return;
	}
	StepSeconds += DeltaTime;

	// ---- what the run has been seen to do, recorded as it happens rather than claimed at the end
	float Height = 0.0f;
	float Blend = 0.0f;
	int32 Count = 0;
	ReadFlock(Height, Blend, Count);
	PeakCubs = FMath::Max(PeakCubs, Count);
	const UWonderlandSubAgentCubSubsystem* Flock = Cubs();
	if (Count >= DemoCubCount && Flock != nullptr && !Flock->IsAscending())
	{
		bAscended = true;
	}
	if (Count > 0 && Blend < SwirlBlendSeen)
	{
		bSwirled = true;
	}
	if (Count > 0 && Blend > FlightBlendSeen)
	{
		bFlew = true;
	}
	if (bAscended && Count == 0 && Step >= EWonderlandDemoStep::Returning)
	{
		bReturned = true;
	}
	if (const UWonderlandUiSubsystem* U = Ui())
	{
		if (U->CountOpenWonderWebWindows() > 0)
		{
			bWebOpened = true;
		}
	}
	if (const UWonderlandWonderWebLiveSubsystem* L = Live())
	{
		const FString Tab(FirstBrowserWindow);
		if (L->HasFrame(Tab) && !L->GetLiveUrl(Tab).IsEmpty())
		{
			bPageLoaded = true;
			LoadedUrl = L->GetLiveUrl(Tab);
			LoadedTitle = L->GetTitle(Tab);
		}
	}

	// ---- THE DOG WALKS DURING FLIGHT, AND ONLY THEN. This is what makes the two station-keeping modes visible in
	// ---- one run: the founder's rule is about whether the Dog is moving, so the demonstration moves it.
	if (Step == EWonderlandDemoStep::Flight)
	{
		if (APawn* Pawn = Dog())
		{
			// FORCED, because an open Wonder Web window puts the controller into overlay input and an unforced
			// AddMovementInput is silently dropped -- which is exactly how a previous film had the Dog stand still
			// for a whole sequence that was supposed to show it walking.
			Pawn->AddMovementInput(Pawn->GetActorForwardVector(), 1.0f, true);
		}
	}

	// ---- advance when the beat has been held long enough AND actually happened, or when waiting has gone on too long
	const bool bReady = StepReady();
	if (StepSeconds < StepMin)
	{
		return;
	}
	if (!bReady && StepSeconds < StepTimeout)
	{
		return;
	}
	RecordBeat(bReady);
	if (Step == EWonderlandDemoStep::Completing)
	{
		bCompleted = true;
	}
	Enter(static_cast<EWonderlandDemoStep>(static_cast<uint8>(Step) + 1));
}

TStatId UWonderlandDemoSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UWonderlandDemoSubsystem, STATGROUP_Tickables);
}

void UWonderlandDemoSubsystem::Deinitialize()
{
	StopDemo();
	Super::Deinitialize();
}

TArray<FString> UWonderlandDemoSubsystem::DescribeDemo() const
{
	TArray<FString> Lines;
	Lines.Add(FString::Printf(TEXT("SUB-AGENT + WONDER WEB DEMONSTRATION  ·  %s"), WonderlandDemoStepName(Step)));
	Lines.Add(FString::Printf(TEXT("sub-agent source: %s"), *GetSubAgentSourceLabel()));
	Lines.Add(FString::Printf(TEXT("peak cubs: %d  ·  asked for %d"), PeakCubs, DemoCubCount));
	Lines.Add(FString::Printf(TEXT("ascension %s  ·  swirl %s  ·  flight %s  ·  return %s"),
		bAscended ? TEXT("PASS") : TEXT("FAIL"), bSwirled ? TEXT("PASS") : TEXT("FAIL"),
		bFlew ? TEXT("PASS") : TEXT("FAIL"), bReturned ? TEXT("PASS") : TEXT("FAIL")));
	Lines.Add(FString::Printf(TEXT("wonder web opened %s  ·  real page loaded %s  ·  mission completed %s"),
		bWebOpened ? TEXT("PASS") : TEXT("FAIL"), bPageLoaded ? TEXT("PASS") : TEXT("FAIL"),
		bCompleted ? TEXT("PASS") : TEXT("FAIL")));
	if (!LoadedUrl.IsEmpty())
	{
		Lines.Add(FString::Printf(TEXT("page: %s  ·  \"%s\""), *LoadedUrl, *LoadedTitle));
	}
	if (bWidenedAllowlist)
	{
		Lines.Add(TEXT("note: the browser allowlist was widened for the founder's nominated page"));
	}
	for (const FWonderlandDemoBeat& Beat : Beats)
	{
		Lines.Add(FString::Printf(TEXT("  %-22s %-9s %5.1f s  %s"),
			*Beat.Id.ToString(), Beat.bObserved ? TEXT("observed") : TEXT("TIMED OUT"), Beat.Seconds, *Beat.Note));
	}
	return Lines;
}

/* ------------------------------------------------------------------ the command */

namespace
{
	UWonderlandDemoSubsystem* DemoFor(UWorld* World)
	{
		return World != nullptr ? World->GetSubsystem<UWonderlandDemoSubsystem>() : nullptr;
	}

	FAutoConsoleCommandWithWorldAndArgs GDemoSubAgentWeb(
		TEXT("wl.Demo.SubAgentWeb"),
		TEXT("Play the founder demonstration: a mission in which Julius delegates to ordinary sub-agent Cub Ghosts and "
		     "uses Wonder Web on a real page. SIMULATED sub-agent count (development fixture), real web page. "
		     "Running it again restarts it."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			UWonderlandDemoSubsystem* Demo = DemoFor(World);
			if (Demo == nullptr)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLDEMO no demonstration subsystem in this world"));
				return;
			}
			UE_LOG(LogTemp, Display, TEXT("WLDEMO start: %s"), Demo->BeginSubAgentWebDemo() ? TEXT("running") : TEXT("REFUSED"));
		}));

	FAutoConsoleCommandWithWorldAndArgs GDemoStatus(
		TEXT("wl.Demo.Status"),
		TEXT("What the founder demonstration is doing, and what it has been seen to do."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			const UWonderlandDemoSubsystem* Demo = DemoFor(World);
			if (Demo == nullptr)
			{
				UE_LOG(LogTemp, Warning, TEXT("WLDEMO no demonstration subsystem in this world"));
				return;
			}
			for (const FString& Line : Demo->DescribeDemo())
			{
				UE_LOG(LogTemp, Display, TEXT("WLDEMO %s"), *Line);
			}
		}));

	FAutoConsoleCommandWithWorldAndArgs GDemoStop(
		TEXT("wl.Demo.Stop"),
		TEXT("Stop the founder demonstration and put back what it borrowed."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			if (UWonderlandDemoSubsystem* Demo = DemoFor(World))
			{
				Demo->StopDemo();
				UE_LOG(LogTemp, Display, TEXT("WLDEMO stopped"));
			}
		}));
}
