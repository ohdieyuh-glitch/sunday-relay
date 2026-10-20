// wl.Qa.SocialGate -- B35 (R16 privacy, the reviewer's SC1 / M1): the social surface gate, checked in ONE client with no server.
//
// A developer session (-wldev) goes live against a DEAD loopback port (http://127.0.0.1:9: every read fails at once, as a server that
// cannot be reached), and the QA lands views into that live service by hand (FWonderlandSocialLiveService::QaLand), each with the moment
// its read was ISSUED. So every rule is driven exactly, through the real open paths of UWonderlandUiSubsystem:
//   SG0  no live service (the preview): the hub draws its people, no gate (the over-filter control, M1-e)
//   SG1  the hub opened by /social (OpenSocialHub) on RECENT over a view read BEFORE the open: nobody drawn on ANY tab, every rail badge blank
//   SG2  a check that can FAIL: an ungated panel over the same view lists the stranger (so SG1's "nobody" is not a blind check)
//   SG3  a read issued before the open lands after it: still nobody
//   SG4  a read issued after the open lands: the people of THAT read are drawn (the stranger who hid is not), badges back
//   SG5  no read lands for longer than MaxShownAgeSeconds (the dead port): nobody again, and the line says why
//   SG6  a profile from the hub is withheld (its profile.read fails here), and Esc back to the hub (BackFromProfile) is withheld again
//        although the last view is only fractions of a second old: it was read before THIS open
//   SG7  a colour change with the hub open (RefreshChrome): withheld again
//   SG8  reads while open are not repeated at the tick rate when they fail (backoff), and are issued again after the open
//   SG9  the LFF tab's own gate is up after the open (FWonderlandLffModel::IsGateUp)
//   SG10 the MUTATION control (wl.Dev.MutateSocialGate 1, -wldev only): the gate off, SG1's open DOES draw the stranger -- the instrument
//        fails on the old behaviour -- and back on, it does not
// WLSOCIALGATEQA lines; frames to Saved/Screenshots/WLSOCIALGATE; quits. Non-Shipping, developer sessions only.
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

	/** The viewer usr_qagv with: friends Ann (usr_qafa) and Bo (usr_qafb), a request from Cy (usr_qasz), Ann's DM, a party with Bo, and on
	 *  RECENT the stranger Xan (usr_qasx, unless bWithoutStranger: Xan hid from the viewer) and Yu (usr_qasy). */
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
		S.Friends.Add(Person(TEXT("usr_qafa"), TEXT("Ann")));
		S.Friends.Add(Person(TEXT("usr_qafb"), TEXT("Bo")));
		FWonderlandSocialRequestRow Request;
		Request.RequestId = TEXT("req_qa1");
		Request.Person = Person(TEXT("usr_qasz"), TEXT("Cy"));
		S.IncomingRequests.Add(Request);
		if (!bWithoutStranger)
		{
			FWonderlandSocialRecentRow Xan;
			Xan.Person = Person(TEXT("usr_qasx"), TEXT("Xan"));
			Xan.Context = TEXT("WORLD");
			S.RecentPlayers.Add(Xan);
		}
		FWonderlandSocialRecentRow Yu;
		Yu.Person = Person(TEXT("usr_qasy"), TEXT("Yu"));
		Yu.Context = TEXT("WORLD");
		S.RecentPlayers.Add(Yu);
		FWonderlandSocialConversationRow Dm;
		Dm.ConversationId = TEXT("cnv_qa1");
		Dm.Kind = TEXT("DIRECT");
		Dm.Title = TEXT("Ann");
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
		S.NamesById.Add(TEXT("usr_qasx"), TEXT("Xan"));
		S.NamesById.Add(TEXT("usr_qasy"), TEXT("Yu"));
		S.NamesById.Add(TEXT("usr_qasz"), TEXT("Cy"));
		return S;
	}

	/** Nobody drawn: the gate is up, no row, no badge. */
	bool Withheld(const FString& Shown)
	{
		return Shown.Contains(TEXT("gate UPDATING")) && Shown.Contains(TEXT("| rows none |"))
			&& Shown.Contains(TEXT("badges FRIENDS - PARTY - MESSAGES - REQUESTS - RECENT -"))
			&& !Shown.Contains(TEXT("usr_qasx")) && !Shown.Contains(TEXT("usr_qafa")) && !Shown.Contains(TEXT("usr_qasy"));
	}

	/** Every people tab of the open hub, each described as the next frame draws it. */
	FString EveryTab(UWonderlandUiSubsystem* U, bool& bAllWithheld)
	{
		bAllWithheld = true;
		FString All;
		const TSharedPtr<SWonderlandSocialHubPanel> Hub = U->GetOpenSocialHubForQa();
		if (!Hub.IsValid())
		{
			bAllWithheld = false;
			return TEXT("(no hub open)");
		}
		const SWonderlandSocialHubPanel::ETab Tabs[] = { SWonderlandSocialHubPanel::ETab::Friends, SWonderlandSocialHubPanel::ETab::Requests,
			SWonderlandSocialHubPanel::ETab::Recent, SWonderlandSocialHubPanel::ETab::Messages, SWonderlandSocialHubPanel::ETab::Party };
		for (const SWonderlandSocialHubPanel::ETab Tab : Tabs)
		{
			Hub->SetTab(Tab);
			const FString Shown = U->DescribeOpenSocialHub();
			bAllWithheld &= Withheld(Shown);
			All += FString::Printf(TEXT("[%s] %s "), SWonderlandSocialHubPanel::TabName(Tab), *Shown.Left(220));
		}
		Hub->SetTab(SWonderlandSocialHubPanel::ETab::Recent);
		return All;
	}

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
		switch (R.Phase)
		{
		case 0:
			if (In >= 8.0)
			{
				U->DismissWelcome();
				U->CloseOverlay();
				// SG0: the preview (no live service) draws its people
				U->OpenSocialHub(TEXT("friends"));
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SG0"), Live == nullptr && Shown.Contains(TEXT("DEVELOPMENT PREVIEW")) && Shown.Contains(TEXT("gate fresh")) && !Shown.Contains(TEXT("| rows none |")),
					FString::Printf(TEXT("no live service, preview hub drawn: %s"), *Shown.Left(400)));
				Shot(R, TEXT("0_preview_hub"));
				U->CloseOverlay();
				const bool bLive = Social->ConnectLive(TEXT("http://127.0.0.1:9"), TEXT("qa-socialgate-dead-port"));
				UE_LOG(LogTemp, Display, TEXT("WLSOCIALGATEQA live on a dead port: %s"), bLive ? TEXT("yes") : TEXT("NO (needs -wldev)"));
				Next(1);
			}
			break;
		case 1:
			if (In >= 1.0)
			{
				if (Live == nullptr)
				{
					Check(R, TEXT("SG1"), false, TEXT("no live service (run with -wldev)"));
					Finish();
					return false;
				}
				// the view the viewer has from BEFORE the open, listing the stranger Xan who has since hidden
				Live->QaLand(View(false), Now() - 0.5);
				R.OpenedAt = Now();
				U->OpenSocialHub(TEXT("recent"));   // the /social path
				R.ReadsAtOpen = Live->QaReadsIssued();
				bool bAll = false;
				const FString Tabs = EveryTab(U, bAll);
				Check(R, TEXT("SG1"), bAll, FString::Printf(TEXT("first open over a view read before it, every tab: %s"), *Tabs));
				Shot(R, TEXT("1_first_open_withheld"));
				// SG2: the same view in an UNGATED panel lists Xan (the check above can fail)
				const TSharedRef<SWonderlandSocialHubPanel> Control = SNew(SWonderlandSocialHubPanel).Snapshot(View(false)).bConnected(true)
					.bDevelopmentPreview(false).InitialTab(SWonderlandSocialHubPanel::ETab::Recent).bAwaitingFresh(false);
				const FString Ungated = Control->Describe();
				Check(R, TEXT("SG2"), !Withheld(Ungated) && Ungated.Contains(TEXT("usr_qasx")),
					FString::Printf(TEXT("control, an ungated panel over the stale view (must list usr_qasx): %s"), *Ungated.Left(400)));
				// SG3: a read issued before the open, landing after it
				Live->QaLand(View(false), R.OpenedAt - 0.1);
				Next(3);
			}
			break;
		case 3:
			if (In >= 0.3)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SG3"), Withheld(Shown), FString::Printf(TEXT("a read issued 0.1 s before the open landed after it: %s"), *Shown.Left(400)));
				// SG4: a read issued now (Xan hid: not in it)
				Live->QaLand(View(true), Now());
				Next(4);
			}
			break;
		case 4:
			if (In >= 0.3)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SG4"), Shown.Contains(TEXT("gate fresh")) && Shown.Contains(TEXT("usr_qasy")) && !Shown.Contains(TEXT("usr_qasx"))
					&& Shown.Contains(TEXT("RECENT 1")), FString::Printf(TEXT("a read issued after the open: %s"), *Shown.Left(500)));
				Shot(R, TEXT("2_fresh_drawn"));
				Next(5);
			}
			break;
		case 5:
			if (In >= WonderlandSocialFreshness::MaxShownAgeSeconds + 0.6)
			{
				// SG5: nothing has landed since (the dead port): the people are withheld again, with the reason
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SG5"), Withheld(Shown) && Shown.Contains(TEXT("gate UPDATING (")),
					FString::Printf(TEXT("%.1f s with no landed read: %s"), In, *Shown.Left(400)));
				Shot(R, TEXT("3_aged_withheld"));
				// SG8: reads while open, issued since the open, backing off (a dead port fails at once)
				const int32 Reads = Live->QaReadsIssued() - R.ReadsAtOpen;
				const double Open = Now() - R.OpenedAt;
				Check(R, TEXT("SG8"), Reads >= 1 && Reads <= 6, FString::Printf(TEXT("%d snapshot reads in %.1f s open, all failing (tick rate would be ~%d)"), Reads, Open,
					static_cast<int32>(Open / 0.25)));
				// SG9: the LFF tab's own gate was armed by this open
				const TSharedPtr<FWonderlandLffModel> Lff = Social->GetLff();
				Check(R, TEXT("SG9"), Lff.IsValid() && Lff->IsGateUp(), FString::Printf(TEXT("LFF gate up after the hub open: %s"), Lff.IsValid() ? *Lff->Describe().Left(300) : TEXT("no LFF model")));
				// SG6: fresh again, then a profile from the hub, then Esc
				Live->QaLand(View(true), Now());
				Next(6);
			}
			break;
		case 6:
			if (In >= 0.3)
			{
				const FString Before = U->DescribeOpenSocialHub();
				Social->OpenProfile(TEXT("usr_qafa"));   // what a row's PROFILE button calls
				Next(7);
				UE_LOG(LogTemp, Display, TEXT("WLSOCIALGATEQA hub before the profile: %s"), *Before.Left(300));
			}
			break;
		case 7:
			if (In >= 0.5)
			{
				const FString Profile = U->DescribeOpenProfile();
				Live->QaLand(View(true), Now());   // a fresh SNAPSHOT changes nothing for the profile: it is withheld until ITS profile.read lands
				const FString Profile2 = U->DescribeOpenProfile();
				U->BackFromProfile();                      // what Esc and CLOSE on the profile call
				const FString Back = U->DescribeOpenSocialHub();
				Check(R, TEXT("SG6"), Profile.Contains(TEXT("withheld")) && Profile2.Contains(TEXT("withheld")) && Withheld(Back),
					FString::Printf(TEXT("profile: %s | after a snapshot: %s | Esc back to the hub: %s"), *Profile, *Profile2, *Back.Left(300)));
				Shot(R, TEXT("4_back_from_profile_withheld"));
				Live->QaLand(View(true), Now());
				Next(8);
			}
			break;
		case 8:
			if (In >= 0.3)
			{
				// SG7: a colour change with the hub open rebuilds the chrome, the hub reopens withheld
				const bool bFreshBefore = U->DescribeOpenSocialHub().Contains(TEXT("gate fresh"));
				UWonderlandUiTestLibrary::PickMascotColour(true, FLinearColor(0.20f, 0.45f, 0.90f));
				const FString After = U->DescribeOpenSocialHub();
				Check(R, TEXT("SG7"), bFreshBefore && Withheld(After), FString::Printf(TEXT("fresh before the colour change: %s | after it: %s"),
					bFreshBefore ? TEXT("yes") : TEXT("NO"), *After.Left(300)));
				UWonderlandUiTestLibrary::ResetAllColours();
				U->CloseOverlay();
				Next(10);
			}
			break;
		case 10:
			if (In >= 0.5)
			{
				// SG10: the mutation control (developer sessions only): the gate off, the same first open DOES draw the stranger
				IConsoleManager::Get().ProcessUserConsoleInput(TEXT("wl.Dev.MutateSocialGate 1"), *GLog, World);
				Live->QaLand(View(false), Now() - 0.5);
				U->OpenSocialHub(TEXT("recent"));
				const FString Mutated = U->DescribeOpenSocialHub();
				IConsoleManager::Get().ProcessUserConsoleInput(TEXT("wl.Dev.MutateSocialGate 0"), *GLog, World);
				U->CloseOverlay();
				U->OpenSocialHub(TEXT("recent"));
				const FString Restored = U->DescribeOpenSocialHub();
				Check(R, TEXT("SG10"), WonderlandBeta::IsDeveloperSession() && Mutated.Contains(TEXT("usr_qasx")) && Withheld(Restored),
					FString::Printf(TEXT("gate OFF (mutant, must leak): %s | gate ON again: %s"), *Mutated.Left(300), *Restored.Left(300)));
				Shot(R, TEXT("5_mutation_restored_withheld"));
				U->CloseOverlay();
				Next(11);
			}
			break;
		case 11:
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
		TEXT("B35 (SC1): the social surface gate in one client with no server (a dead loopback port): every open path withheld, release only by a read ")
		TEXT("issued after the open, the age rule, backoff, the LFF gate, and the -wldev mutation control (SG0-SG10). Needs -wldev. Frames to ")
		TEXT("Saved/Screenshots/WLSOCIALGATE; quits."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>&, UWorld* World)
		{
			if (GRun.IsValid())
			{
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
