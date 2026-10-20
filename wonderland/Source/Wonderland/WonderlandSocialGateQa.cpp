// wl.Qa.SocialGate -- B35 (R16 privacy, the reviewer's SC1 / M1 / M1b): the social surface gate, checked in ONE client with no server.
//
// A developer session (-wldev) goes live against a DEAD loopback port (http://127.0.0.1:9: every read fails, as a server that cannot be
// reached), and the QA lands views into that live service by hand (FWonderlandSocialLiveService::QaLand), each with the moment its read was
// ISSUED. Every verdict judges what the panels BUILT (the texts in their widget trees, the rows and rail badges they built), never a flag
// (the reviewer's R2-23). The fixture people are named "QX..." so a single text search finds any of them drawn. Through the real open paths:
//   SG0   no live service: the hub is built without the gate (the over-filter control, M1-e)
//   SGA0  a service ADOPTED with that hub open (a sign-in from inside it, RV-B35-11): the hub is withheld at once
//   SGA3  the LFF gate is armed again after the adoption reset it (RV-B35-12)
//   SGA1  a read issued after the open releases it; then NO read lands for longer than MaxShownAge with NO broadcast: withheld again (the
//         judgement runs for an open made with no service)
//   SGA2  after that outage, an UNCHANGED read (no broadcast) releases it
//   SG1   /social on RECENT over a view read BEFORE the open: every tab, each PAINTED (and captured with -wlframes), draws nobody, no badge
//   SG2   a check that can FAIL: an ungated panel over the same view builds the stranger's name
//   SG3   a read issued before the open lands after it: still nobody
//   SG4   a read issued after the open: that read's people (not the one who hid), badges back; SG4b FRIENDS with BLOCKED BY YOU
//   SG5   no read lands for longer than MaxShownAge (the dead port): nobody again, and the line says why
//   SG8   failing reads back off: issue gaps grow and none is at the tick rate (R2-25)
//   SG9   the LFF tab's own gate is up after the open
//   SG6a/SG11/SG12/SG13  a profile from the hub: withheld until ITS profile.read; drawn on a post-open read; not-found = "This profile is not
//         available." with nothing of the player; withheld again past the age limit
//   SG6   Esc back to the hub 0.3 s after a FRESH view landed (R2-24): withheld again (a new open)
//   SG7   a colour change with the hub open (RefreshChrome): withheld again
//   SG10  the MUTATION control (wl.Dev.MutateSocialGate 1, -wldev only): the same first open DOES build and PAINT the stranger (R2-29); back on, it does not
// WLSOCIALGATEQA lines; frames to Saved/Screenshots/WLSOCIALGATE; quits. Non-Shipping, developer sessions only, never over a real service.
#include "CoreMinimal.h"

#if !UE_BUILD_SHIPPING
#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Paths.h"
#include "WonderlandBeta.h"
#include "WonderlandSocialHubPanel.h"
#include "WonderlandSocialLive.h"
#include "WonderlandSocialProfilePanel.h"
#include "WonderlandSocialSubsystem.h"
#include "WonderlandUiSubsystem.h"
#include "WonderlandUiTestLibrary.h"

namespace WonderlandSocialGateQa
{
	struct FRun
	{
		TWeakObjectPtr<UWorld> World;
		int32 Phase = 0;
		double At = 0.0;
		int32 Pass = 0;
		int32 Fail = 0;
		FString Dir;
		double OpenedAt = 0.0;
		int32 ReadsAtOpen = 0;
		int32 TabIndex = 0;
		int32 PaintsBefore = 0;
		int32 CapturesBefore = 0;
		bool bAllTabsOk = true;
		FString TabLog;
		bool bProfileDrawn = false;
		double AdoptedAt = 0.0;
		double HubOpenedAt = 0.0;
		/** R3-02: every SocialChanged broadcast while the run lasts, and the count when the release settled */
		int32 Broadcasts = 0;
		int32 BroadcastsAtRelease = 0;
		FDelegateHandle ChangedHandle;
		TWeakObjectPtr<UWonderlandSocialSubsystem> Social;
	};
	TSharedPtr<FRun> GRun;

	double Now() { return FPlatformTime::Seconds(); }

	void Check(FRun& R, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? R.Pass : R.Fail)++;
		UE_LOG(LogTemp, Display, TEXT("WLSOCIALGATEQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	void Shot(FRun& R, const TCHAR* Name)
	{
		int32 W = 0;
		int32 H = 0;
		const FString Path = R.Dir / FString::Printf(TEXT("%s.png"), Name);
		const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, W, H);
		UE_LOG(LogTemp, Display, TEXT("WLSOCIALGATEQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), W, H);
	}

	UWonderlandUiSubsystem* Ui(UWorld* World)
	{
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ULocalPlayer* Player = PC != nullptr ? PC->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
	}

	FWonderlandSocialPersonRow Person(const TCHAR* Id, const TCHAR* Name)
	{
		FWonderlandSocialPersonRow Row;
		Row.UserId = Id;
		Row.DisplayName = Name;
		Row.Handle = FString(Name).ToLower();
		Row.Presence.UserId = Id;
		Row.Presence.OnlineState = TEXT("ONLINE");
		Row.Presence.Availability = TEXT("AVAILABLE");
		return Row;
	}

	/** The viewer usr_qagv with: friends QXAnn (usr_qafa) and QXBo (usr_qafb), a request from QXCy (usr_qasz), QXAnn's DM, a party with QXBo, the
	 *  viewer's own block of QXBix (usr_qabk), and on RECENT the stranger QXXan (usr_qasx, unless bWithoutStranger: Xan hid) and QXYu (usr_qasy). */
	FWonderlandSocialSnapshot View(bool bWithoutStranger)
	{
		FWonderlandSocialSnapshot S;
		S.Schema = TEXT("relay-wonderland-social-view.v1");
		S.bDevelopmentPreview = false;
		S.ViewerId = TEXT("usr_qagv");
		S.Self.Profile.UserId = TEXT("usr_qagv");
		S.Self.Profile.DisplayName = TEXT("Gate Viewer");
		S.Self.Presence.UserId = TEXT("usr_qagv");
		S.Self.Presence.OnlineState = TEXT("ONLINE");
		S.Self.Presence.Availability = TEXT("AVAILABLE");
		S.Friends.Add(Person(TEXT("usr_qafa"), TEXT("QXAnn")));
		S.Friends.Add(Person(TEXT("usr_qafb"), TEXT("QXBo")));
		FWonderlandSocialRequestRow Request;
		Request.RequestId = TEXT("req_qa1");
		Request.Person = Person(TEXT("usr_qasz"), TEXT("QXCy"));
		S.IncomingRequests.Add(Request);
		if (!bWithoutStranger)
		{
			FWonderlandSocialRecentRow Xan;
			Xan.Person = Person(TEXT("usr_qasx"), TEXT("QXXan"));
			Xan.Context = TEXT("WORLD");
			S.RecentPlayers.Add(Xan);
		}
		FWonderlandSocialRecentRow Yu;
		Yu.Person = Person(TEXT("usr_qasy"), TEXT("QXYu"));
		Yu.Context = TEXT("WORLD");
		S.RecentPlayers.Add(Yu);
		FWonderlandSocialConversationRow Dm;
		Dm.ConversationId = TEXT("cnv_qa1");
		Dm.Kind = TEXT("DIRECT");
		Dm.Title = TEXT("QXAnn");
		Dm.OtherUserId = TEXT("usr_qafa");
		Dm.Unread = 1;
		S.Conversations.Add(Dm);
		S.bHasParty = true;
		S.Party.PartyId = TEXT("pty_qa1");
		S.Party.Name = TEXT("Gate Crew");
		S.Party.LeaderId = TEXT("usr_qagv");
		S.Party.bViewerIsMember = true;
		S.Party.bViewerIsLeader = true;
		FWonderlandSocialPartyMember Me;
		Me.UserId = TEXT("usr_qagv");
		Me.Role = TEXT("LEADER");
		FWonderlandSocialPartyMember Bo;
		Bo.UserId = TEXT("usr_qafb");
		Bo.Role = TEXT("MEMBER");
		S.Party.Members = { Me, Bo };
		for (const FWonderlandSocialPersonRow& F : S.Friends)
		{
			FWonderlandSocialProfileView P;
			P.Profile.UserId = F.UserId;
			P.Profile.DisplayName = F.DisplayName;
			P.Presence = F.Presence;
			P.Relationship = TEXT("FRIEND");
			S.Profiles.Add(F.UserId, P);
			S.NamesById.Add(F.UserId, F.DisplayName);
		}
		{
			FWonderlandSocialProfileView Blocked;
			Blocked.Profile.UserId = TEXT("usr_qabk");
			Blocked.Profile.DisplayName = TEXT("QXBix");
			Blocked.Relationship = TEXT("BLOCKED");
			Blocked.Presence.UserId = TEXT("usr_qabk");
			Blocked.Presence.RestrictedReason = TEXT("BLOCKED");
			S.Profiles.Add(TEXT("usr_qabk"), Blocked);
			S.NamesById.Add(TEXT("usr_qabk"), TEXT("QXBix"));
		}
		S.NamesById.Add(TEXT("usr_qasx"), TEXT("QXXan"));
		S.NamesById.Add(TEXT("usr_qasy"), TEXT("QXYu"));
		S.NamesById.Add(TEXT("usr_qasz"), TEXT("QXCy"));
		return S;
	}

	/** The BUILT texts that name a fixture person (a name "QX...", a handle "qx...", an id "usr_qa..."), joined; empty when none. */
	FString PeopleIn(const TArray<FString>& Texts)
	{
		TArray<FString> Hits;
		for (const FString& T : Texts)
		{
			if (T.Contains(TEXT("QX"), ESearchCase::CaseSensitive) || T.Contains(TEXT("qx"), ESearchCase::CaseSensitive) || T.Contains(TEXT("usr_qa")))
			{
				Hits.Add(T.Left(60));
			}
		}
		return FString::Join(Hits, TEXT(" / "));
	}

	/** Nobody BUILT on the open hub: no person text in its widget tree, no built row, every built badge blank, the gate up. */
	bool HubWithheld(UWonderlandUiSubsystem* U, FString& Why)
	{
		const TSharedPtr<SWonderlandSocialHubPanel> Hub = U->GetOpenSocialHubForQa();
		if (!Hub.IsValid())
		{
			Why = TEXT("(no hub open)");
			return false;
		}
		const FString Shown = U->DescribeOpenSocialHub();   // flushes the pending rebuild first
		const FString People = PeopleIn(Hub->QaBuiltTexts());
		Why = FString::Printf(TEXT("built people [%s] | %s"), *People, *Shown.Left(260));
		return People.IsEmpty() && Shown.Contains(TEXT("gate UPDATING")) && Shown.Contains(TEXT("| rows none |"))
			&& Shown.Contains(TEXT("badges FRIENDS - PARTY - MESSAGES - REQUESTS - RECENT -"));
	}

	/** The open profile built nothing of the player (no person text). */
	bool ProfileWithheld(UWonderlandUiSubsystem* U, FString& Why)
	{
		const FString Shown = U->DescribeOpenProfile();
		TArray<FString> Texts;
		if (const TSharedPtr<SWidget> Panel = U->GetOpenProfilePanelForQa())
		{
			WonderlandSocialPaintLog::CollectBuiltTexts(Panel.ToSharedRef(), Texts);
		}
		const FString People = PeopleIn(Texts);
		Why = FString::Printf(TEXT("built people [%s] | %s"), *People, *Shown);
		return Shown.Contains(TEXT("withheld")) && People.IsEmpty();
	}

	const SWonderlandSocialHubPanel::ETab GTabs[] = { SWonderlandSocialHubPanel::ETab::Friends, SWonderlandSocialHubPanel::ETab::Requests,
		SWonderlandSocialHubPanel::ETab::Recent, SWonderlandSocialHubPanel::ETab::Messages, SWonderlandSocialHubPanel::ETab::Party };

	bool Tick(float)
	{
		if (!GRun.IsValid())
		{
			return false;
		}
		FRun& R = *GRun;
		UWorld* World = R.World.Get();
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
		UWonderlandUiSubsystem* U = Ui(World);
		const double In = Now() - R.At;
		const auto Next = [&R](int32 Phase) { R.Phase = Phase; R.At = Now(); };
		const auto Finish = [&R]()
		{
			if (UWonderlandSocialSubsystem* Bound = R.Social.Get())
			{
				Bound->OnSocialChanged().Remove(R.ChangedHandle);
			}
			UE_LOG(LogTemp, Display, TEXT("WLSOCIALGATEQA SUMMARY %d passed, %d failed -- %s"), R.Pass, R.Fail, R.Fail == 0 ? TEXT("ALL PASS") : TEXT("FAILURES"));
			GRun.Reset();
			FPlatformMisc::RequestExit(false);
		};
		if (World == nullptr || Social == nullptr || U == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogTemp, Display, TEXT("WLSOCIALGATEQA quit: no world, social subsystem or UI"));
				Finish();
				return false;
			}
			return true;
		}
		FWonderlandSocialLiveService* Live = Social->GetLive();
		const TSharedPtr<FWonderlandLffModel> Lff = Social->GetLff();
		FString Why;
		switch (R.Phase)
		{
		case 0:
			if (In >= 8.0)
			{
				U->DismissWelcome();
				U->CloseOverlay();
				R.Social = Social;
				R.ChangedHandle = Social->OnSocialChanged().AddLambda([]() { if (GRun.IsValid()) { ++GRun->Broadcasts; } });
				// SG0: no live service: the hub is built without the gate (this harness's preview carries nobody)
				R.HubOpenedAt = Now();
				U->OpenSocialHub(TEXT("recent"));
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SG0"), Live == nullptr && Shown.Contains(TEXT("gate fresh")), FString::Printf(TEXT("no live service, hub built without the gate: %s"), *Shown.Left(300)));
				// SGA0: a service ADOPTED with that hub open (as a sign-in from inside it)
				R.AdoptedAt = Now();
				Social->ConnectLive(TEXT("http://127.0.0.1:9"), TEXT("qa-socialgate-dead-port"));
				R.OpenedAt = Now();
				// R3-07: the adopted service holds PEOPLE at once, from a read issued before the hub opened (so SGA0's "built nobody" is not vacuous)
				if (FWonderlandSocialLiveService* Adopted = Social->GetLive())
				{
					Adopted->QaLand(View(true), R.HubOpenedAt - 0.2);
				}
				Next(1);
			}
			break;
		case 1:
			if (In >= 0.3)
			{
				const bool bWithheld = HubWithheld(U, Why);
				bool bHeldPeople = false;
				if (Live != nullptr)
				{
					for (const FWonderlandSocialPersonRow& Row : Live->GetSnapshot().Friends) { bHeldPeople |= Row.UserId == TEXT("usr_qafa"); }
					for (const FWonderlandSocialRecentRow& Row : Live->GetSnapshot().RecentPlayers) { bHeldPeople |= Row.Person.UserId == TEXT("usr_qasy"); }
				}
				Check(R, TEXT("SGA0"), Live != nullptr && bWithheld && bHeldPeople, FString::Printf(TEXT("adopted with the hub open, the service holding people read before the open (%s): %s"),
					bHeldPeople ? TEXT("yes") : TEXT("NO"), *Why));
				Check(R, TEXT("SGA3"), Lff.IsValid() && Lff->IsOpenGateArmed() && Lff->IsGateUp(), FString::Printf(TEXT("LFF gate after the adoption reset it: armed %s, up %s"),
					Lff.IsValid() && Lff->IsOpenGateArmed() ? TEXT("yes") : TEXT("NO"), Lff.IsValid() && Lff->IsGateUp() ? TEXT("yes") : TEXT("NO")));
				if (Live == nullptr)
				{
					Check(R, TEXT("SGA"), false, TEXT("no live service after ConnectLive (needs -wldev)"));
					Finish();
					return false;
				}
				Next(12);
			}
			break;
		case 12:
			// R3-02: the release waits until the dead port has been FOUND unreachable (its one state change and broadcast are over), so nothing but
			// the ticker can withhold the released hub inside SGA1's window
			if (Live->IsUnreachable() && Live->QaReadFailures().Num() >= 1 && In >= 0.3)
			{
				Live->QaLand(View(true), Now());   // a read issued after the open (broadcast)
				Next(2);
			}
			else if (In >= 15.0)
			{
				Check(R, TEXT("SGA1"), false, TEXT("instrument: the dead port was never found unreachable within 15 s"));
				Next(2);
			}
			break;
		case 2:
			if (In >= 0.3)
			{
				const FString Released = U->DescribeOpenSocialHub();
				R.bProfileDrawn = Released.Contains(TEXT("gate fresh")) && Released.Contains(TEXT("usr_qasy"));
				R.BroadcastsAtRelease = R.Broadcasts;
				Next(3);
			}
			break;
		case 3:
			if (In >= WonderlandSocialFreshness::MaxShownAgeSeconds + 0.6)
			{
				// SGA1: released by a post-open read, then NO read for longer than MaxShownAge and NO broadcast (counted, R3-02): the ticker withholds it
				const bool bWithheld = HubWithheld(U, Why);
				const int32 InWindow = R.Broadcasts - R.BroadcastsAtRelease;
				Check(R, TEXT("SGA1"), R.bProfileDrawn && bWithheld && InWindow == 0, FString::Printf(TEXT("released after the adoption: %s; %.1f s later with no read and %d broadcasts (must be 0): %s"),
					R.bProfileDrawn ? TEXT("yes") : TEXT("NO"), In, InWindow, *Why));
				Live->QaLand(View(true), Now(), false);   // SGA2: the SAME view again, landing silently (an unchanged read after an outage)
				Next(4);
			}
			break;
		case 4:
			if (In >= 0.3)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SGA2"), Shown.Contains(TEXT("gate fresh")) && Shown.Contains(TEXT("usr_qasy")), FString::Printf(TEXT("an unchanged read after the outage releases: %s"), *Shown.Left(300)));
				Next(41);
			}
			break;
		case 41:
			if (Now() - R.AdoptedAt >= 14.0)
			{
				// SG8 (R2-25, R3-03): THE BACK-OFF SEQUENCE. With the hub open and every read failing (the dead port), the n-th consecutive failure
				// schedules exactly min(8, 0.75 * 2^(n-1)) s, and no snapshot read is issued before that wait ends
				const TArray<FWonderlandSocialLiveService::FQaReadFailure>& Failures = Live->QaReadFailures();
				const TArray<double>& Issued = Live->QaReadIssueTimes();
				bool bExact = true;
				bool bWaited = true;
				int32 Counted = 0;
				int32 Expected = 1;
				FString Line;
				for (const FWonderlandSocialLiveService::FQaReadFailure& F : Failures)
				{
					if (F.FailedAt < R.AdoptedAt)
					{
						continue;
					}
					const double Want = FMath::Min(8.0, WonderlandSocialFreshness::OpenResyncSeconds * FMath::Pow(2.0, static_cast<double>(FMath::Min(F.Failures - 1, 4))));
					double NextIssue = -1.0;
					for (const double At : Issued)
					{
						if (At > F.FailedAt)
						{
							NextIssue = At;
							break;
						}
					}
					const bool bThisWaited = NextIssue < 0.0 || NextIssue >= F.FailedAt + F.Gap - 0.001;
					bExact &= !F.b429 && F.Failures == Expected && FMath::Abs(F.Gap - Want) < 1.0e-6;
					bWaited &= bThisWaited;
					Line += FString::Printf(TEXT("[#%d scheduled %.3f (want %.3f), next issue after %s] "), F.Failures, F.Gap, Want,
						NextIssue < 0.0 ? TEXT("none yet") : *FString::Printf(TEXT("%.3f s%s"), NextIssue - F.FailedAt, bThisWaited ? TEXT("") : TEXT(" EARLY")));
					++Expected;
					++Counted;
				}
				Check(R, TEXT("SG8"), Counted >= 3 && bExact && bWaited, FString::Printf(TEXT("%d failed reads in %.1f s since the adoption: %s(each the exact doubling from 0.75 s, capped at 8, and waited out)"),
					Counted, Now() - R.AdoptedAt, *Line));
				U->CloseOverlay();
				Next(5);
			}
			break;
		case 5:
			if (In >= 0.5)
			{
				// SG1: the view the viewer has from BEFORE the open, listing the stranger QXXan who has since hidden; then every tab, painted
				Live->QaLand(View(false), Now() - 0.5);
				R.OpenedAt = Now();
				U->OpenSocialHub(TEXT("recent"));   // the /social path
				R.ReadsAtOpen = Live->QaReadsIssued();
				R.TabIndex = 0;
				R.bAllTabsOk = true;
				R.TabLog.Reset();
				// SG2: the same view in an UNGATED panel BUILDS QXXan (the check can fail)
				const TSharedRef<SWonderlandSocialHubPanel> Control = SNew(SWonderlandSocialHubPanel).Snapshot(View(false)).bConnected(true)
					.bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Recent).bAwaitingFresh(false);
				const FString ControlPeople = PeopleIn(Control->QaBuiltTexts());
				Check(R, TEXT("SG2"), ControlPeople.Contains(TEXT("QXXan")), FString::Printf(TEXT("control, an ungated panel over the stale view builds [%s]"), *ControlPeople));
				Next(10);
			}
			break;
		case 10:
			// SG1, one tab per step: SetTab, then judge only after that tab was PAINTED (and, with -wlframes, captured)
			if (In >= 0.05 && R.TabIndex < UE_ARRAY_COUNT(GTabs))
			{
				if (const TSharedPtr<SWonderlandSocialHubPanel> Hub = U->GetOpenSocialHubForQa())
				{
					R.PaintsBefore = Hub->QaPaintsNoted();
					R.CapturesBefore = WonderlandSocialPaintLog::CaptureCount();
					Hub->SetTab(GTabs[R.TabIndex]);
				}
				Next(11);
			}
			break;
		case 11:
			if (In >= 0.35)
			{
				const TSharedPtr<SWonderlandSocialHubPanel> Hub = U->GetOpenSocialHubForQa();
				const bool bPainted = Hub.IsValid() && Hub->QaPaintsNoted() > R.PaintsBefore && Hub->QaLastPaintedNote().Contains(TEXT("gate UPDATING"))
					&& Hub->QaLastPaintedNote().StartsWith(FString::Printf(TEXT("tab %s"), SWonderlandSocialHubPanel::TabName(GTabs[R.TabIndex])));
				const bool bCaptured = WonderlandSocialPaintLog::CaptureCount() > R.CapturesBefore;
				const bool bWithheld = HubWithheld(U, Why);
				R.bAllTabsOk &= bPainted && bWithheld && (bCaptured || !WonderlandSocialPaintLog::FramesWanted());   // R3-05: captured when frames are on
				R.TabLog += FString::Printf(TEXT("[%s painted %s captured %s withheld %s] "), SWonderlandSocialHubPanel::TabName(GTabs[R.TabIndex]),
					bPainted ? TEXT("yes") : TEXT("NO"), bCaptured ? TEXT("yes") : TEXT("no(-wlframes off?)"), bWithheld ? TEXT("yes") : *FString::Printf(TEXT("NO %s"), *Why));
				++R.TabIndex;
				if (R.TabIndex < UE_ARRAY_COUNT(GTabs))
				{
					Next(10);
				}
				else
				{
					Check(R, TEXT("SG1"), R.bAllTabsOk, FString::Printf(TEXT("first open over a view read before it, each tab painted: %s"), *R.TabLog));
					Shot(R, TEXT("1_first_open_withheld"));
					if (Hub.IsValid())
					{
						Hub->SetTab(SWonderlandSocialHubPanel::ETab::Recent);
					}
					Live->QaLand(View(false), R.OpenedAt - 0.1);   // SG3: a read issued before the open, landing after it
					Next(13);
				}
			}
			break;
		case 13:
			if (In >= 0.3)
			{
				const bool bSg3 = HubWithheld(U, Why);   // first: Check's arguments are evaluated in no fixed order
				Check(R, TEXT("SG3"), bSg3, FString::Printf(TEXT("a read issued 0.1 s before the open landed after it: %s"), *Why));
				Live->QaLand(View(true), Now());   // SG4: issued now (QXXan hid: not in it)
				Next(14);
			}
			break;
		case 14:
			if (In >= 0.3)
			{
				const TSharedPtr<SWonderlandSocialHubPanel> Hub = U->GetOpenSocialHubForQa();
				const FString Shown = U->DescribeOpenSocialHub();
				const FString People = Hub.IsValid() ? PeopleIn(Hub->QaBuiltTexts()) : FString();
				Check(R, TEXT("SG4"), Shown.Contains(TEXT("gate fresh")) && People.Contains(TEXT("QXYu")) && !People.Contains(TEXT("QXXan")) && Shown.Contains(TEXT("RECENT 1")),
					FString::Printf(TEXT("a read issued after the open: built [%s] | %s"), *People, *Shown.Left(300)));
				Shot(R, TEXT("2_fresh_drawn"));
				if (Hub.IsValid())
				{
					Hub->SetTab(SWonderlandSocialHubPanel::ETab::Friends);
					const FString Friends = U->DescribeOpenSocialHub();
					const FString FriendPeople = PeopleIn(Hub->QaBuiltTexts());
					Check(R, TEXT("SG4b"), FriendPeople.Contains(TEXT("QXAnn")) && FriendPeople.Contains(TEXT("QXBo")) && FriendPeople.Contains(TEXT("QXBix")),
						FString::Printf(TEXT("fresh FRIENDS builds both friends + BLOCKED BY YOU: [%s] | %s"), *FriendPeople, *Friends.Left(200)));
					Hub->SetTab(SWonderlandSocialHubPanel::ETab::Recent);
				}
				Next(15);
			}
			break;
		case 15:
			if (In >= WonderlandSocialFreshness::MaxShownAgeSeconds + 0.6)
			{
				const bool bWithheld = HubWithheld(U, Why);
				Check(R, TEXT("SG5"), bWithheld && Why.Contains(TEXT("gate UPDATING (")), FString::Printf(TEXT("%.1f s with no landed read: %s"), In, *Why));
				Shot(R, TEXT("3_aged_withheld"));
				Check(R, TEXT("SG9"), Lff.IsValid() && Lff->IsGateUp(), FString::Printf(TEXT("LFF gate up after the hub open: %s"), Lff.IsValid() ? *Lff->Describe().Left(200) : TEXT("no LFF model")));
				Live->QaLand(View(true), Now());
				Next(16);
			}
			break;
		case 16:
			if (In >= 0.3)
			{
				Social->OpenProfile(TEXT("usr_qafa"));   // what a row's PROFILE button calls
				Next(17);
			}
			break;
		case 17:
			if (In >= 0.5)
			{
				const bool bAtOpen = ProfileWithheld(U, Why);
				const FString AtOpen = Why;
				Live->QaLand(View(true), Now());   // a fresh SNAPSHOT changes nothing for the profile: it is withheld until ITS profile.read lands
				const bool bAfterSnapshot = ProfileWithheld(U, Why);
				Check(R, TEXT("SG6a"), bAtOpen && bAfterSnapshot, FString::Printf(TEXT("profile before its own read: %s | after a fresh snapshot: %s"), *AtOpen, *Why));
				// SG11: its own profile.read, issued after the open, lands: the card is BUILT
				FWonderlandSocialProfileView Ann;
				Ann.Profile.UserId = TEXT("usr_qafa");
				Ann.Profile.DisplayName = TEXT("QXAnn");
				Ann.Profile.RelayDog.SkinId = TEXT("relay_og");
				Ann.Presence = Person(TEXT("usr_qafa"), TEXT("QXAnn")).Presence;
				Ann.Relationship = TEXT("FRIEND");
				const bool bLanded = U->QaProfileReadLanded(200, Ann, Now(), TEXT("qa-ann-1"));
				TArray<FString> Texts;
				if (const TSharedPtr<SWidget> Panel = U->GetOpenProfilePanelForQa())
				{
					WonderlandSocialPaintLog::CollectBuiltTexts(Panel.ToSharedRef(), Texts);
				}
				Check(R, TEXT("SG11"), bLanded && PeopleIn(Texts).Contains(TEXT("QXAnn")) && !U->DescribeOpenProfile().Contains(TEXT("withheld")),
					FString::Printf(TEXT("a profile.read issued after the open landed: built [%s] | %s"), *PeopleIn(Texts), *U->DescribeOpenProfile()));
				Shot(R, TEXT("4a_profile_drawn"));
				// SG12: the authority's not-found: nothing of the player, one generic line
				U->QaProfileReadLanded(404, FWonderlandSocialProfileView(), Now(), FString());
				const bool bGone = ProfileWithheld(U, Why);
				Check(R, TEXT("SG12"), bGone && Why.Contains(TEXT("This profile is not available.")), FString::Printf(TEXT("profile.read answered not-found: %s"), *Why));
				Shot(R, TEXT("4b_profile_not_available"));
				U->QaProfileReadLanded(200, Ann, Now(), TEXT("qa-ann-2"));
				R.bProfileDrawn = !U->DescribeOpenProfile().Contains(TEXT("withheld"));
				Next(18);
			}
			break;
		case 18:
			if (In >= WonderlandSocialFreshness::MaxShownAgeSeconds + 0.6)
			{
				const bool bAged = ProfileWithheld(U, Why);
				Check(R, TEXT("SG13"), R.bProfileDrawn && bAged, FString::Printf(TEXT("drawn after a fresh read: %s; %.1f s with no landed read: %s"), R.bProfileDrawn ? TEXT("yes") : TEXT("NO"), In, *Why));
				Live->QaLand(View(true), Now());   // R2-24: a FRESH view 0.3 s before Esc
				Next(19);
			}
			break;
		case 19:
			if (In >= 0.3)
			{
				U->BackFromProfile();                      // what Esc and CLOSE on the profile call: a NEW open of the hub
				const bool bWithheld = HubWithheld(U, Why);
				Check(R, TEXT("SG6"), bWithheld, FString::Printf(TEXT("Esc back to the hub 0.3 s after a fresh view landed: %s"), *Why));
				Shot(R, TEXT("4_back_from_profile_withheld"));
				Live->QaLand(View(true), Now());
				Next(20);
			}
			break;
		case 20:
			if (In >= 0.3)
			{
				// SG7: a colour change with the hub open rebuilds the chrome, the hub reopens withheld
				const bool bFreshBefore = U->DescribeOpenSocialHub().Contains(TEXT("gate fresh"));
				UWonderlandUiTestLibrary::PickMascotColour(true, FLinearColor(0.20f, 0.45f, 0.90f));
				const bool bWithheld = HubWithheld(U, Why);
				Check(R, TEXT("SG7"), bFreshBefore && bWithheld, FString::Printf(TEXT("fresh before the colour change: %s | after it: %s"), bFreshBefore ? TEXT("yes") : TEXT("NO"), *Why));
				UWonderlandUiTestLibrary::ResetAllColours();
				U->CloseOverlay();
				Next(21);
			}
			break;
		case 21:
			if (In >= 0.5)
			{
				// SG10: the mutation control (developer sessions only): the gate off, the same first open BUILDS and PAINTS the stranger
				IConsoleManager::Get().ProcessUserConsoleInput(TEXT("wl.Dev.MutateSocialGate 1"), *GLog, World);
				Live->QaLand(View(false), Now() - 0.5);
				U->OpenSocialHub(TEXT("recent"));
				if (const TSharedPtr<SWonderlandSocialHubPanel> Hub = U->GetOpenSocialHubForQa())
				{
					R.PaintsBefore = Hub->QaPaintsNoted();
				}
				R.CapturesBefore = WonderlandSocialPaintLog::CaptureCount();
				Next(22);
			}
			break;
		case 22:
			if (In >= 0.35)
			{
				const TSharedPtr<SWonderlandSocialHubPanel> Hub = U->GetOpenSocialHubForQa();
				const FString MutantPeople = Hub.IsValid() ? PeopleIn(Hub->QaBuiltTexts()) : FString();
				const bool bPaintedLeak = Hub.IsValid() && Hub->QaLastPaintedNote().Contains(TEXT("usr_qasx"));
				const bool bCaptured = WonderlandSocialPaintLog::CaptureCount() > R.CapturesBefore;
				Shot(R, TEXT("5a_mutation_leak"));
				IConsoleManager::Get().ProcessUserConsoleInput(TEXT("wl.Dev.MutateSocialGate 0"), *GLog, World);
				U->CloseOverlay();
				U->OpenSocialHub(TEXT("recent"));
				const bool bRestored = HubWithheld(U, Why);
				Check(R, TEXT("SG10"), WonderlandBeta::IsDeveloperSession() && MutantPeople.Contains(TEXT("QXXan")) && bPaintedLeak && bRestored
					&& (bCaptured || !WonderlandSocialPaintLog::FramesWanted()),   // R3-05
					FString::Printf(TEXT("gate OFF (mutant, must leak): built [%s], painted with usr_qasx %s, captured %s | gate ON again: %s"), *MutantPeople,
						bPaintedLeak ? TEXT("yes") : TEXT("NO"), bCaptured ? TEXT("yes") : TEXT("no(-wlframes off?)"), *Why));
				Shot(R, TEXT("5_mutation_restored_withheld"));
				U->CloseOverlay();
				Next(23);
			}
			break;
		case 23:
			if (In >= 0.5)
			{
				Finish();
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaSocialGate(
		TEXT("wl.Qa.SocialGate"),
		TEXT("B35 (SC1): the social surface gate in one client with no server (a dead loopback port): adoption with the hub open, every open path ")
		TEXT("withheld judged on BUILT content, release only by a read issued after the open, the age rule, backoff, the LFF gate, the profile, and ")
		TEXT("the -wldev mutation control. Needs -wldev and no live service. Frames to Saved/Screenshots/WLSOCIALGATE; quits."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			if (GRun.IsValid())
			{
				return;
			}
			// A DEVELOPER SESSION ONLY, and never over a real live service (the reviewer's R2-08): it goes live against a dead port itself and lands
			// QA people into that service, so in a player's session or a signed-in one it refuses and does nothing
			const UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
			const UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
			if (!WonderlandBeta::IsDeveloperSession() || (Social != nullptr && Social->GetLive() != nullptr))
			{
				UE_LOG(LogTemp, Display, TEXT("WLSOCIALGATEQA refused: %s"), !WonderlandBeta::IsDeveloperSession() ? TEXT("needs a developer session (-wldev)") : TEXT("a live social service is already connected"));
				return;
			}
			GRun = MakeShared<FRun>();
			GRun->World = World;
			GRun->At = Now();
			GRun->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSOCIALGATE"));
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick), 0.05f);
			UE_LOG(LogTemp, Display, TEXT("WLSOCIALGATEQA armed (MayDraw: issued at/after the open, at most %.2f s old; open re-read %.2f s)"),
				WonderlandSocialFreshness::MaxShownAgeSeconds, WonderlandSocialFreshness::OpenResyncSeconds);
		}));
}
#endif
