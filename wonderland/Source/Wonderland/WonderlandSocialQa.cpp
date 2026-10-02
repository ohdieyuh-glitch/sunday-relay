// wl.Qa.Social -- Wonderland Social's deterministic checks on the DEVELOPMENT PREVIEW, in the client (Phase C).
//
// What it proves, on the generated preview (UiArt/Social/social-preview.json) and the profile screen:
//   SQ1 the preview loaded as one (schema, the preview flag, the viewer, friends and profiles)
//   SQ2 privacy reached the client intact: the player who blocked the viewer has no profile here, and a friend on a
//       private server shows no location
//   SQ3 a friend's profile opens: rank and level PENDING, the primary Compound AI Agent and the Relay Dog in their skin on
//       the profile stage -- a stage that is NOT the wardrobe's
//   SQ4 every action in a preview is refused, with the reason a person can read
//   SQ5 a mutual friend's profile opens from the profile (the same path a chip click takes)
//   SQ6 the profile closes
// and the Social Hub (step 2, Friends):
//   SQ7  FRIENDS lists every friend the authority sent, people who are on first, the blocker nowhere
//   SQ8  REQUESTS lists the incoming friend request and the party invitation, with who sent them
//   SQ9  a hub action (accept the request) reaches the service and its refusal shows on the hub
//   SQ10 a profile opens from the hub, and Esc on it comes back to the hub on the tab the player left
//   SQ11 RECENT says plainly that nobody is there yet (the preview has no recent players)
// and Messages (step 4):
//   SQ12 MESSAGES shows the inbox with its unread count and opens the newest conversation with its whole history
//   SQ13 a reply goes to the service (the call SEND makes) and its refusal shows on the hub
// and Parties + Party Voice (steps 5-6):
//   SQ14 PARTY without a party: CREATE, and the friends' party this viewer may see (Arena Run, open to friends)
//   SQ15 the 'party' preview scene (the viewer accepted Lab Crew): the party, its leader and both members
//   SQ16 the voice column steps through the authority's scripted states to 'connected, Nova speaking'
//   SQ17 a voice command is refused with the reason (the preview carries no audio)
// `wl.Qa.Social player` (a boot WITHOUT -wldev) instead proves a player session never shows synthetic people:
//   SQP1 no preview loaded, SQP2 the hub says NOT CONNECTED and lists nobody, SQP3 voice is UNAVAILABLE (VOICE
//   TRANSPORT PENDING), never a scripted example.
// Frames to Saved/Screenshots/WLSOCIAL. Sends no input; quits.
// In its own file, so Wonderland Social never edits the shared QA file while it is being built.
#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/LocalPlayer.h"
#include "Engine/World.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Paths.h"
#include "WonderlandSkinStage.h"
#include "WonderlandSocialLive.h"
#include "RelayDogCharacter.h"
#include "WonderlandSocialSubsystem.h"
#include "WonderlandUiSubsystem.h"
#include "WonderlandUiTestLibrary.h"

namespace WonderlandSocialQa
{
	struct FRun
	{
		TWeakObjectPtr<UWorld> World;
		int32 Phase = 0;
		double At = 0.0;
		int32 Pass = 0;
		int32 Fail = 0;
		FString Dir;
		bool bPlayerMode = false;
	};
	TSharedPtr<FRun> GRun;

	double Now() { return FPlatformTime::Seconds(); }

	void Check(FRun& R, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? R.Pass : R.Fail)++;
		UE_LOG(LogTemp, Display, TEXT("WLSOCIALQA %s %s | %s"), Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	void Shot(FRun& R, const TCHAR* Name)
	{
		int32 W = 0;
		int32 H = 0;
		const FString Path = R.Dir / FString::Printf(TEXT("%s.png"), Name);
		const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, W, H);
		UE_LOG(LogTemp, Display, TEXT("WLSOCIALQA frame %s %s %dx%d"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"), W, H);
	}

	UWonderlandUiSubsystem* Ui(UWorld* World)
	{
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		ULocalPlayer* Player = PC != nullptr ? PC->GetLocalPlayer() : nullptr;
		return Player != nullptr ? Player->GetSubsystem<UWonderlandUiSubsystem>() : nullptr;
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
		if (World == nullptr || Social == nullptr || U == nullptr)
		{
			if (In > 120.0)
			{
				UE_LOG(LogTemp, Display, TEXT("WLSOCIALQA quit: no world, social subsystem or UI"));
				FPlatformMisc::RequestExit(false);
				return false;
			}
			return true;
		}
		const FWonderlandSocialSnapshot* Snap = Social->GetSnapshot();
		switch (R.Phase)
		{
		case 0:
			if (In >= 8.0)
			{
				U->DismissWelcome();
				U->CloseOverlay();
				Check(R, TEXT("SQ1"), Snap != nullptr && Snap->Schema == TEXT("relay-wonderland-social-preview.v1") && Snap->bDevelopmentPreview
					&& Snap->ViewerId == TEXT("usr_kai") && Snap->Friends.Num() >= 5 && Snap->Profiles.Num() >= 7 && Social->GetLastError().IsEmpty(),
					Snap != nullptr ? FString::Printf(TEXT("schema '%s', preview %s, viewer %s, %d friends, %d profiles, error '%s' | %s"), *Snap->Schema,
						Snap->bDevelopmentPreview ? TEXT("yes") : TEXT("NO"), *Snap->ViewerId, Snap->Friends.Num(), Snap->Profiles.Num(),
						*Social->GetLastError(), *Social->GetSourceLine()) : FString::Printf(TEXT("no snapshot: %s"), *Social->GetLastError()));
				// the fixtures: MIRA blocked KAI; RHEA is on a private server whose location she does not share
				const FWonderlandSocialPersonRow* Rhea = Snap != nullptr ? Snap->Friends.FindByPredicate([](const FWonderlandSocialPersonRow& Row) { return Row.UserId == TEXT("usr_rhea"); }) : nullptr;
				const bool bMiraHidden = Social->FindProfile(TEXT("usr_mira")) == nullptr && (Snap == nullptr || !Snap->NamesById.Contains(TEXT("usr_mira")));
				Check(R, TEXT("SQ2"), bMiraHidden && Rhea != nullptr && !Rhea->Presence.bHasLocation,
					FString::Printf(TEXT("the blocker (usr_mira) has no profile or name here: %s; usr_rhea on a private server shows a location: %s"),
						bMiraHidden ? TEXT("yes") : TEXT("NO"), Rhea == nullptr ? TEXT("(not a friend row)") : Rhea->Presence.bHasLocation ? TEXT("YES") : TEXT("no")));
				Social->OpenProfile(TEXT("usr_nova"));
				Next(1);
			}
			break;
		case 1:
			if (In >= 3.0)
			{
				const FString Shown = U->DescribeOpenProfile();
				const FWonderlandSocialProfileView* Nova = Social->FindProfile(TEXT("usr_nova"));
				AWonderlandSkinStage* Stage = AWonderlandSkinStage::GetProfileStage(World);
				const bool bStage = Stage != nullptr && Nova != nullptr && Stage != AWonderlandSkinStage::Get(World)
					&& Stage->GetShownSkinId() == FName(*Nova->Profile.RelayDog.SkinId);
				Check(R, TEXT("SQ3"), Shown.Contains(TEXT("user=usr_nova")) && Shown.Contains(TEXT("rank=PENDING")) && Shown.Contains(TEXT("level=PENDING"))
					&& Shown.Contains(TEXT("dogRendered=1")) && bStage,
					FString::Printf(TEXT("%s | the profile stage shows '%s' (want '%s'), and it is not the wardrobe's: %s"), *Shown,
						Stage != nullptr ? *Stage->GetShownSkinId().ToString() : TEXT("(none)"), Nova != nullptr ? *Nova->Profile.RelayDog.SkinId : TEXT("?"),
						Stage != nullptr && Stage != AWonderlandSkinStage::Get(World) ? TEXT("yes") : TEXT("NO")));
				Shot(R, TEXT("1_profile_usr_nova"));
				// SQ4: every action in a preview is refused with the reason, through the one service
				const TCHAR* const Ops[] = { TEXT("messages.send"), TEXT("parties.invite"), TEXT("requests.send"), TEXT("blocks.add"), TEXT("reports.file") };
				int32 Refused = 0;
				FString Reason;
				for (const TCHAR* Op : Ops)
				{
					const FWonderlandSocialActionResult Answer = Social->GetService()->Request(Op, TEXT("usr_nova"));
					Refused += (!Answer.bOk && Answer.Reason.Contains(TEXT("DEVELOPMENT PREVIEW"))) ? 1 : 0;
					Reason = Answer.Reason;
				}
				Check(R, TEXT("SQ4"), Refused == static_cast<int32>(UE_ARRAY_COUNT(Ops)), FString::Printf(TEXT("%d of %d actions refused in the preview, with '%s'"),
					Refused, static_cast<int32>(UE_ARRAY_COUNT(Ops)), *Reason));
				Social->OpenProfile(TEXT("usr_orion"));
				Next(2);
			}
			break;
		case 2:
			if (In >= 3.0)
			{
				const FString Shown = U->DescribeOpenProfile();
				Check(R, TEXT("SQ5"), Shown.Contains(TEXT("user=usr_orion")), Shown);
				Shot(R, TEXT("2_profile_usr_orion"));
				U->CloseOverlay();
				Next(3);
			}
			break;
		case 3:
			if (In >= 1.0)
			{
				Check(R, TEXT("SQ6"), U->DescribeOpenProfile().IsEmpty(), TEXT("closed: no profile open"));
				U->OpenSocialHub(TEXT("friends"));
				Next(5);
			}
			break;
		case 5:
			if (In >= 2.0)
			{
				// SQ7: every friend, in presence order (on first), and the blocker nowhere
				const FString Shown = U->DescribeOpenSocialHub();
				FString Rows;
				Shown.Split(TEXT("| rows "), nullptr, &Rows);
				Rows.Split(TEXT(" |"), &Rows, nullptr);
				TArray<FString> Ids;
				Rows.ParseIntoArray(Ids, TEXT(","));
				bool bOrdered = true;
				bool bSeenOff = false;
				for (const FString& Id : Ids)
				{
					const FWonderlandSocialPersonRow* Row = Snap != nullptr ? Snap->Friends.FindByPredicate([&Id](const FWonderlandSocialPersonRow& F) { return F.UserId == Id; }) : nullptr;
					const bool bOn = Row != nullptr && Row->Presence.RestrictedReason.IsEmpty()
						&& (Row->Presence.OnlineState == TEXT("ONLINE") || Row->Presence.OnlineState == TEXT("BUSY") || Row->Presence.OnlineState == TEXT("AWAY"));
					bOrdered &= Row != nullptr && !(bOn && bSeenOff);
					bSeenOff |= !bOn;
				}
				Check(R, TEXT("SQ7"), Shown.StartsWith(TEXT("tab FRIENDS")) && Shown.Contains(TEXT("DEVELOPMENT PREVIEW")) && Snap != nullptr
					&& Ids.Num() == Snap->Friends.Num() && bOrdered && !Ids.Contains(TEXT("usr_mira")),
					FString::Printf(TEXT("%s | %d rows for %d friends, on-first order %s, the blocker listed: %s"), *Shown, Ids.Num(),
						Snap != nullptr ? Snap->Friends.Num() : -1, bOrdered ? TEXT("yes") : TEXT("NO"), Ids.Contains(TEXT("usr_mira")) ? TEXT("YES") : TEXT("no")));
				Shot(R, TEXT("3_hub_friends"));
				U->OpenSocialHub(TEXT("requests"));
				Next(6);
			}
			break;
		case 6:
			if (In >= 2.0)
			{
				// SQ8: the incoming request and the party invitation, each with who sent it
				const FString Shown = U->DescribeOpenSocialHub();
				const bool bCounts = Snap != nullptr && Snap->IncomingRequests.Num() >= 1 && Snap->PartyInvites.Num() >= 1;
				const FString Asker = bCounts ? Snap->IncomingRequests[0].Person.UserId : FString();
				const FString Inviter = bCounts ? Snap->PartyInvites[0].From.UserId : FString();
				Check(R, TEXT("SQ8"), Shown.StartsWith(TEXT("tab REQUESTS")) && bCounts && Shown.Contains(Asker) && Shown.Contains(Inviter)
					&& Shown.Contains(FString::Printf(TEXT("requests in %d"), Snap->IncomingRequests.Num())),
					FString::Printf(TEXT("%s | request from %s, party invite from %s ('%s')"), *Shown, *Asker, *Inviter,
						bCounts ? *Snap->PartyInvites[0].PartyName : TEXT("-")));
				Shot(R, TEXT("4_hub_requests"));
				// SQ9 (asked here, read next tick): accepting the request, the same call the ACCEPT button makes
				if (bCounts)
				{
					U->RequestSocialAction(TEXT("requests.accept"), Snap->IncomingRequests[0].RequestId);
				}
				Next(7);
			}
			break;
		case 7:
			if (In >= 1.0)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SQ9"), Shown.Contains(TEXT("action: DEVELOPMENT PREVIEW")),
					FString::Printf(TEXT("the hub shows the service's answer: %s"), *Shown));
				Shot(R, TEXT("5_hub_action_refused"));
				U->OpenSocialHub(TEXT("friends"));
				Social->OpenProfile(TEXT("usr_nova"));   // what the row's PROFILE button calls
				Next(8);
			}
			break;
		case 8:
			if (In >= 3.0)
			{
				const FString Profile = U->DescribeOpenProfile();
				U->BackFromProfile();                     // what Esc and CLOSE on the profile call
				const FString Back = U->DescribeOpenSocialHub();
				Check(R, TEXT("SQ10"), Profile.Contains(TEXT("user=usr_nova")) && Back.StartsWith(TEXT("tab FRIENDS")),
					FString::Printf(TEXT("from the hub: %s | Esc: %s"), *Profile, Back.IsEmpty() ? TEXT("(hub NOT back)") : *Back));
				U->OpenSocialHub(TEXT("recent"));
				Next(9);
			}
			break;
		case 9:
			if (In >= 2.0)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SQ11"), Shown.StartsWith(TEXT("tab RECENT")) && Snap != nullptr
					&& Shown.Contains(FString::Printf(TEXT("recent %d"), Snap->RecentPlayers.Num())) && (Snap->RecentPlayers.Num() > 0 || Shown.Contains(TEXT("rows none"))),
					Shown);
				Shot(R, TEXT("6_hub_recent"));
				U->OpenSocialHub(TEXT("messages"));
				Next(10);
			}
			break;
		case 10:
			if (In >= 2.0)
			{
				// SQ12: the inbox, its unread count, and the newest conversation open with every message the authority sent
				const FString Shown = U->DescribeOpenSocialHub();
				const FWonderlandSocialConversationRow* First = Snap != nullptr && Snap->Conversations.Num() > 0 ? &Snap->Conversations[0] : nullptr;
				int32 Unread = 0;
				for (const FWonderlandSocialConversationRow& C : Snap != nullptr ? Snap->Conversations : TArray<FWonderlandSocialConversationRow>())
				{
					Unread += C.Unread;
				}
				const TArray<FWonderlandSocialMessage>* History = First != nullptr ? Snap->Messages.Find(First->ConversationId) : nullptr;
				Check(R, TEXT("SQ12"), First != nullptr && History != nullptr && Shown.StartsWith(TEXT("tab MESSAGES"))
					&& Shown.Contains(FString::Printf(TEXT("conversations %d (unread %d)"), Snap->Conversations.Num(), Unread))
					&& Shown.Contains(FString::Printf(TEXT("open %s (%d messages)"), *First->ConversationId, History->Num())),
					FString::Printf(TEXT("%s | want %d unread, '%s' open with %d messages"), *Shown, Unread, First != nullptr ? *First->ConversationId : TEXT("-"),
						History != nullptr ? History->Num() : -1));
				Shot(R, TEXT("7_hub_messages"));
				if (First != nullptr)
				{
					U->SendSocialMessage(First->ConversationId, TEXT("QA reply"));
				}
				Next(11);
			}
			break;
		case 11:
			if (In >= 1.0)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SQ13"), Shown.Contains(TEXT("action: DEVELOPMENT PREVIEW")), FString::Printf(TEXT("the reply's answer on the hub: %s"), *Shown));
				Shot(R, TEXT("8_hub_reply_refused"));
				U->OpenSocialHub(TEXT("party"));
				Next(12);
			}
			break;
		case 12:
			if (In >= 2.0)
			{
				// SQ14: no party of the viewer's own; the friends' party they may see is listed
				const FString Shown = U->DescribeOpenSocialHub();
				const bool bVisible = Snap != nullptr && Snap->VisibleParties.Num() >= 1;
				Check(R, TEXT("SQ14"), Shown.StartsWith(TEXT("tab PARTY")) && Shown.Contains(TEXT("| party none (0 members)")) && bVisible
					&& Shown.Contains(FString::Printf(TEXT("visible parties %d"), Snap->VisibleParties.Num())) && Shown.Contains(Snap->VisibleParties[0].PartyId),
					FString::Printf(TEXT("%s | want '%s' listed"), *Shown, bVisible ? *Snap->VisibleParties[0].Name : TEXT("-")));
				Shot(R, TEXT("9_hub_party_none"));
				// the second scene, generated by the authority: the viewer accepted the Lab Crew invitation
				Social->LoadPreviewScene(TEXT("party"));
				U->OpenSocialHub(TEXT("party"));
				Next(13);
			}
			break;
		case 13:
			if (In >= 2.0)
			{
				const FWonderlandSocialSnapshot* Party = Social->GetSnapshot();
				const FString Shown = U->DescribeOpenSocialHub();
				const bool bParty = Party != nullptr && Party->bHasParty && Party->Party.bViewerIsMember && !Party->Party.bViewerIsLeader;
				Check(R, TEXT("SQ15"), bParty && Shown.Contains(FString::Printf(TEXT("| party %s (%d members, leader %s)"), *Party->Party.Name, Party->Party.Members.Num(), *Party->Party.LeaderId))
					&& Shown.Contains(Party->Party.LeaderId) && Shown.Contains(Party->ViewerId) && Shown.Contains(TEXT("scripted voice state 1 of")),
					FString::Printf(TEXT("scene '%s' | %s"), *Social->GetPreviewScene(), *Shown));
				Shot(R, TEXT("10_hub_party_lab_crew"));
				// two steps through the authority's script: connecting, then connected with Nova speaking
				U->HandleVoiceCommand(TEXT("preview.step"), FString());
				U->HandleVoiceCommand(TEXT("preview.step"), FString());
				Next(14);
			}
			break;
		case 14:
			if (In >= 1.0)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				const IWonderlandVoiceService* Voice = Social->GetVoice();
				const FWonderlandVoiceParticipant* Nova = Voice != nullptr ? Voice->GetState().Participants.FindByPredicate([](const FWonderlandVoiceParticipant& V) { return V.UserId == TEXT("usr_nova"); }) : nullptr;
				Check(R, TEXT("SQ16"), Shown.Contains(TEXT("voice CONNECTED [DEVELOPMENT PREVIEW")) && Shown.Contains(TEXT("connected, Nova speaking"))
					&& Nova != nullptr && Nova->bSpeaking, Shown);
				Shot(R, TEXT("11_hub_voice_speaking"));
				U->HandleVoiceCommand(TEXT("mic.mute"), FString());
				Next(15);
			}
			break;
		case 15:
			if (In >= 1.0)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SQ17"), Shown.Contains(TEXT("action: DEVELOPMENT PREVIEW · voice is a scripted example")), Shown);
				Shot(R, TEXT("12_hub_voice_refused"));
				Social->LoadPreviewScene(TEXT("base"));
				U->CloseOverlay();
				UE_LOG(LogTemp, Display, TEXT("WLSOCIALQA END pass=%d fail=%d"), R.Pass, R.Fail);
				Next(4);
			}
			break;
		case 20:   // `player`: a player session (no -wldev) never shows the preview's synthetic people
			if (In >= 8.0)
			{
				U->DismissWelcome();
				U->CloseOverlay();
				Check(R, TEXT("SQP1"), Snap == nullptr && Social->GetService() == nullptr,
					Snap == nullptr ? FString(TEXT("no social snapshot in a player session")) : FString::Printf(TEXT("a snapshot with %d friends LOADED"), Snap->Friends.Num()));
				U->OpenSocialHub(TEXT("friends"));
				Next(21);
			}
			break;
		case 21:
			if (In >= 2.0)
			{
				const FString Shown = U->DescribeOpenSocialHub();
				Check(R, TEXT("SQP2"), Shown.Contains(TEXT("NOT CONNECTED")) && Shown.Contains(TEXT("friends 0")) && Shown.Contains(TEXT("rows none")), Shown);
				const IWonderlandVoiceService* Voice = Social->GetVoice();
				Check(R, TEXT("SQP3"), Voice != nullptr && Voice->GetState().Connection == TEXT("UNAVAILABLE") && Voice->GetPreviewLabel().IsEmpty()
					&& Voice->GetState().Detail == WonderlandVoice::TransportPending() && Social->GetVoicePreview() == nullptr,
					Voice != nullptr ? FString::Printf(TEXT("voice %s, '%s', provider '%s', preview label '%s'"), *Voice->GetState().Connection, *Voice->GetState().Detail,
						*Voice->GetProviderId(), *Voice->GetPreviewLabel()) : FString(TEXT("NO voice service")));
				Shot(R, TEXT("P_hub_player_session"));
				U->CloseOverlay();
				UE_LOG(LogTemp, Display, TEXT("WLSOCIALQA END pass=%d fail=%d"), R.Pass, R.Fail);
				Next(4);
			}
			break;
		case 4:
			if (In >= 1.0)
			{
				GRun.Reset();
				FPlatformMisc::RequestExit(false);
				return false;
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaSocial(
		TEXT("wl.Qa.Social"),
		TEXT("Wonderland Social's checks on the DEVELOPMENT PREVIEW (SQ1-SQ6): the preview, privacy, a profile with rank/level PENDING and ")
		TEXT("the Relay Dog on the profile stage, actions refused with the reason, a second profile, close; then the Social Hub (SQ7-SQ11). ")
		TEXT("`wl.Qa.Social player` (no -wldev): no synthetic people in a player session (SQP1-SQP2). Frames to Saved/Screenshots/WLSOCIAL; quits."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GRun.IsValid())
			{
				return;
			}
			GRun = MakeShared<FRun>();
			GRun->World = World;
			GRun->At = Now();
			GRun->bPlayerMode = Args.Num() > 0 && Args[0].Equals(TEXT("player"), ESearchCase::IgnoreCase);
			GRun->Phase = GRun->bPlayerMode ? 20 : 0;
			GRun->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSOCIAL"));
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick), 0.1f);
			UE_LOG(LogTemp, Display, TEXT("WLSOCIALQA armed"));
		}));
}

// wl.Qa.SocialLive <me> <peer> <a|b> [url] -- TWO REAL CLIENTS, ONE LOOP (founder: "multiple real Wonderland clients
// interacting"). Each client is a developer session on the loopback DEVELOPMENT social server; neither knows the other except
// through the server. Client A asks, client B answers, each checking what crossed:
//   LSQ1 live (a live view of this player, not the preview)
//   LSQ2 A's friend request reached B (B's own view)            LSQ3 both are friends (each one's own view)
//   LSQ4 A's message reached B, unread                           LSQ5 B's reply reached A
//   LSQ6 A's party invitation reached B, B accepted: both see one party of two
//   LSQ7 each sees the other ONLINE (presence across clients)
//   LSQ8 MULTIPLAYER PHASE 1: both in the same world context, each sees the other's Relay Dog STANDING in its own world
//   LSQ9 B blocks A: each one's figure of the other disappears, and A's friendship with B is gone from A's own view
// `... restart` (after the DURABLE dev server was restarted from its database alone, fresh sessions, fresh clients):
//   LSQR1 the conversation came back, both messages in order    LSQR2 the block came back: no friendship either way; A (the
//   BLOCKED player) gets no profile of B at all, B (the blocker) sees A as BLOCKED -- the profile authority's rule ("somebody
//   the subject has blocked does not get their profile"), which keeps the blocker able to see and undo the block
//                                                                 LSQR3 (A) A is still in the party A leads
// Frames to Saved/Screenshots/WLSOCIALLIVE. Sends no input; quits when its side is done (or after 4 minutes).
namespace WonderlandSocialLiveQa
{
	struct FLive
	{
		TWeakObjectPtr<UWorld> World;
		FString Me;
		FString Peer;
		bool bA = true;
		bool bRestart = false;
		FString Url;
		int32 Phase = 0;
		double At = 0.0;
		double StartedAt = 0.0;
		int32 Pass = 0;
		int32 Fail = 0;
		FString Dir;
		/** LSQ8's frame: a camera that puts BOTH Dogs in the picture (the player's own camera may face away from the peer). */
		TWeakObjectPtr<ACameraActor> Camera;
	};
	TSharedPtr<FLive> GLive;

	double Now() { return FPlatformTime::Seconds(); }

	/**
	 * Frame this player's Dog and the peer's side by side: from beside the line between them, back far enough for both,
	 * looking at the middle. The 10-02 durable run's LSQ8 passed on data while its frame showed only the player's own Dog
	 * (the follow camera faced away) -- a picture that proves nothing; this one is meant to show both figures.
	 */
	void FrameBoth(FLive& L, UWorld* World, const FVector& PeerSoles)
	{
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		APawn* Pawn = PC != nullptr ? PC->GetPawn() : nullptr;
		if (Pawn == nullptr)
		{
			return;
		}
		const FVector Mine = Pawn->GetActorLocation() - FVector(0.0, 0.0, Pawn->GetSimpleCollisionHalfHeight());
		const FVector Between = PeerSoles - Mine;
		const double Separation = Between.Size2D();
		const FVector Along = Between.GetSafeNormal2D().IsNearlyZero() ? Pawn->GetActorForwardVector().GetSafeNormal2D() : Between.GetSafeNormal2D();
		const FVector Side = Along.RotateAngleAxis(90.0, FVector::UpVector);
		const FVector Middle = (Mine + PeerSoles) * 0.5 + FVector(0.0, 0.0, 90.0);
		// ~40 degrees down: at eye level (the first framed run, 10-02) a raised planter wall hid the far Dog and only its name
		// label showed above the wall; from above, waist-high garden furniture no longer hides either figure.
		const double Back = FMath::Max(450.0, Separation * 0.9 + 250.0);
		const FVector Where = Middle + Side * Back + FVector(0.0, 0.0, Back * 0.8);
		ACameraActor* Cam = L.Camera.Get();
		if (Cam == nullptr)
		{
			FActorSpawnParameters Params;
			Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Cam = World->SpawnActor<ACameraActor>(Where, FRotator::ZeroRotator, Params);
			L.Camera = Cam;
		}
		if (Cam != nullptr)
		{
			Cam->SetActorLocationAndRotation(Where, (Middle - Where).Rotation());
			Cam->GetCameraComponent()->SetFieldOfView(70.0f);
			Cam->GetCameraComponent()->SetConstraintAspectRatio(false);
			PC->SetViewTargetWithBlend(Cam, 0.0f);
			UE_LOG(LogTemp, Display, TEXT("WLSOCIALLIVE %s frame camera: both Dogs %.0f uu apart, camera %.0f uu to the side, looking at %s"), *L.Me, Separation,
				(Where - Middle).Size2D(), *Middle.ToCompactString());
		}
	}

	void RestoreView(FLive& L, UWorld* World)
	{
		APlayerController* PC = World != nullptr ? World->GetFirstPlayerController() : nullptr;
		if (PC != nullptr && PC->GetPawn() != nullptr)
		{
			PC->SetViewTargetWithBlend(PC->GetPawn(), 0.0f);
		}
		if (ACameraActor* Cam = L.Camera.Get())
		{
			Cam->Destroy();
		}
		L.Camera.Reset();
	}

	void Check(FLive& L, const TCHAR* Id, bool bOk, const FString& Detail)
	{
		(bOk ? L.Pass : L.Fail)++;
		UE_LOG(LogTemp, Display, TEXT("WLSOCIALLIVE %s %s %s | %s"), *L.Me, Id, bOk ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	void Shot(FLive& L, const FString& Name)
	{
		int32 W = 0;
		int32 H = 0;
		const FString Path = L.Dir / FString::Printf(TEXT("%s_%s.png"), *L.Me, *Name);
		const bool bOk = UWonderlandUiTestLibrary::CaptureGameViewport(Path, W, H);
		UE_LOG(LogTemp, Display, TEXT("WLSOCIALLIVE frame %s %s"), *Path, bOk ? TEXT("saved") : TEXT("FAILED"));
	}

	const FWonderlandSocialPersonRow* Friend(const FWonderlandSocialSnapshot& S, const FString& Id)
	{
		return S.Friends.FindByPredicate([&Id](const FWonderlandSocialPersonRow& R) { return R.UserId == Id; });
	}

	const FWonderlandSocialConversationRow* With(const FWonderlandSocialSnapshot& S, const FString& Id)
	{
		return S.Conversations.FindByPredicate([&Id](const FWonderlandSocialConversationRow& C) { return C.OtherUserId == Id; });
	}

	bool PartyOfTwo(const FWonderlandSocialSnapshot& S, const FString& A, const FString& B)
	{
		return S.bHasParty && S.Party.Members.Num() == 2
			&& S.Party.Members.ContainsByPredicate([&A](const FWonderlandSocialPartyMember& M) { return M.UserId == A; })
			&& S.Party.Members.ContainsByPredicate([&B](const FWonderlandSocialPartyMember& M) { return M.UserId == B; });
	}

	void Finish(FLive& L)
	{
		UE_LOG(LogTemp, Display, TEXT("WLSOCIALLIVE %s END pass=%d fail=%d"), *L.Me, L.Pass, L.Fail);
		L.Phase = 99;
		L.At = Now();
	}

	bool Tick(float)
	{
		if (!GLive.IsValid())
		{
			return false;
		}
		FLive& L = *GLive;
		UWorld* World = L.World.Get();
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		UWonderlandSocialSubsystem* Social = Instance != nullptr ? Instance->GetSubsystem<UWonderlandSocialSubsystem>() : nullptr;
		UWonderlandUiSubsystem* U = WonderlandSocialQa::Ui(World);
		const double In = Now() - L.At;
		const auto Next = [&L](int32 Phase) { L.Phase = Phase; L.At = Now(); };
		if (L.Phase == 99)
		{
			if (In >= 2.0)
			{
				GLive.Reset();
				FPlatformMisc::RequestExit(false);
				return false;
			}
			return true;
		}
		if (Now() - L.StartedAt > 300.0)
		{
			Check(L, TEXT("TIMEOUT"), false, FString::Printf(TEXT("stuck in phase %d"), L.Phase));
			Finish(L);
			return true;
		}
		if (World == nullptr || Social == nullptr || U == nullptr)
		{
			return true;
		}
		FWonderlandSocialLiveService* Live = Social->GetLive();
		const FWonderlandSocialSnapshot* S = Live != nullptr && Live->HasSnapshot() ? &Live->GetSnapshot() : nullptr;
		const FString MeId = FString::Printf(TEXT("usr_%s"), *L.Me);
		const FString PeerId = FString::Printf(TEXT("usr_%s"), *L.Peer);
		switch (L.Phase)
		{
		case 0:   // connect
			if (In >= 8.0)
			{
				U->DismissWelcome();
				U->CloseOverlay();
				Social->ConnectDevSession(L.Url, L.Me);
				Next(1);
			}
			break;
		case 1:
			if (S != nullptr)
			{
				Check(L, TEXT("LSQ1"), !S->bDevelopmentPreview && S->ViewerId == MeId && S->Schema == TEXT("relay-wonderland-social-view.v1"),
					FString::Printf(TEXT("%s | viewer %s, schema %s, preview %s"), *Live->Describe(), *S->ViewerId, *S->Schema, S->bDevelopmentPreview ? TEXT("YES") : TEXT("no")));
				Next(L.bRestart ? 50 : (L.bA ? 10 : 20));
			}
			break;

		// ---------------------------------------------------------------- A: asks
		case 10:   // the peer must exist on the server before a request can name them: wait for a moment, then ask
			if (In >= 6.0)
			{
				U->RequestSocialAction(TEXT("requests.send"), PeerId);
				Next(11);
			}
			break;
		case 11:   // B accepts; A's own view shows the friendship
			if (S != nullptr && Friend(*S, PeerId) != nullptr)
			{
				Check(L, TEXT("LSQ3"), true, FString::Printf(TEXT("%s is %s's friend in %s's own view"), *PeerId, *MeId, *MeId));
				const FWonderlandSocialPersonRow* P = Friend(*S, PeerId);
				Check(L, TEXT("LSQ7"), P->Presence.OnlineState == TEXT("ONLINE"), FString::Printf(TEXT("%s seen %s, '%s'"), *PeerId, *P->Presence.OnlineState, *P->Presence.Headline));
				U->RequestSocialAction(TEXT("conversations.open"), PeerId);
				Next(12);
			}
			else if (In >= 8.0 && In < 8.3)
			{
				U->RequestSocialAction(TEXT("requests.send"), PeerId);   // B may not have existed yet the first time
			}
			break;
		case 12:
			if (S != nullptr && With(*S, PeerId) != nullptr)
			{
				U->SendSocialMessage(With(*S, PeerId)->ConversationId, FString::Printf(TEXT("hello from %s"), *L.Me));
				Next(13);
			}
			break;
		case 13:   // B's reply
			if (S != nullptr && With(*S, PeerId) != nullptr)
			{
				const TArray<FWonderlandSocialMessage>* History = S->Messages.Find(With(*S, PeerId)->ConversationId);
				const FWonderlandSocialMessage* Reply = History != nullptr ? History->FindByPredicate([&PeerId](const FWonderlandSocialMessage& M) { return M.SenderId == PeerId; }) : nullptr;
				if (Reply != nullptr)
				{
					Check(L, TEXT("LSQ5"), Reply->Body.StartsWith(TEXT("hello back from")), FString::Printf(TEXT("%s's reply reached %s: '%s'"), *PeerId, *MeId, *Reply->Body));
					U->OpenSocialHub(TEXT("messages"));
					Shot(L, TEXT("1_messages"));
					U->RequestSocialAction(TEXT("parties.create"), FString());
					Next(14);
				}
			}
			break;
		case 14:
			if (S != nullptr && S->bHasParty)
			{
				U->RequestSocialAction(TEXT("parties.invite"), PeerId);
				Next(15);
			}
			break;
		case 15:
			if (S != nullptr && PartyOfTwo(*S, MeId, PeerId))
			{
				Check(L, TEXT("LSQ6"), true, FString::Printf(TEXT("one party of two in %s's own view: %s"), *MeId, *S->Party.PartyId));
				U->OpenSocialHub(TEXT("party"));
				Next(16);
			}
			break;
		case 16:
			if (In >= 2.0)
			{
				Shot(L, TEXT("2_party"));
				U->OpenSocialHub(TEXT("friends"));
				Next(17);
			}
			break;
		case 17:
			if (In >= 2.0)
			{
				Shot(L, TEXT("3_friends"));
				U->CloseOverlay();
				Next(30);
			}
			break;
		case 30:   // LSQ8 (A): the peer's figure stands in A's world
			if (Live != nullptr && Live->GetWorldView().Avatars.ContainsByPredicate([&PeerId](const FWonderlandRemoteAvatar& A) { return A.UserId == PeerId; })
				&& Social->NumRemotePlayers() >= 1 && In >= 4.0)
			{
				Check(L, TEXT("LSQ8"), true, FString::Printf(TEXT("context %s (%s), %d here | standing in %s's world: %s"), *Live->GetWorldView().ContextId,
					*Live->GetWorldView().ServerName, Live->GetWorldView().Population, *MeId, *Social->DescribeRemotePlayers()));
				const FWonderlandRemoteAvatar* PeerAvatar = Live->GetWorldView().Avatars.FindByPredicate([&PeerId](const FWonderlandRemoteAvatar& A) { return A.UserId == PeerId; });
				FrameBoth(L, World, PeerAvatar->Location);
				Next(31);
			}
			break;
		case 31:
			if (In >= 2.0)
			{
				Shot(L, TEXT("4_world_peer_visible"));
				RestoreView(L, World);
				Next(32);
			}
			break;
		case 32:   // LSQ9 (A): B blocks A -- B's figure leaves A's world, the friendship leaves A's view
			if (Live != nullptr && !Live->GetWorldView().Avatars.ContainsByPredicate([&PeerId](const FWonderlandRemoteAvatar& A) { return A.UserId == PeerId; })
				&& Social->NumRemotePlayers() == 0 && S != nullptr && Friend(*S, PeerId) == nullptr)
			{
				Check(L, TEXT("LSQ9"), true, FString::Printf(TEXT("after the block: no figure of %s in %s's world (%s), no friendship in %s's view"), *PeerId, *MeId,
					*Social->DescribeRemotePlayers(), *MeId));
				Shot(L, TEXT("5_world_after_block"));
				Finish(L);
			}
			break;

		// ---------------------------------------------------------------- B: answers
		case 20:   // A's request arrives in B's own view
			if (S != nullptr)
			{
				const FWonderlandSocialRequestRow* Asked = S->IncomingRequests.FindByPredicate([&PeerId](const FWonderlandSocialRequestRow& R) { return R.Person.UserId == PeerId; });
				if (Asked != nullptr)
				{
					Check(L, TEXT("LSQ2"), true, FString::Printf(TEXT("%s's request %s reached %s"), *PeerId, *Asked->RequestId, *MeId));
					U->OpenSocialHub(TEXT("requests"));
					Shot(L, TEXT("1_request_arrived"));
					U->RequestSocialAction(TEXT("requests.accept"), Asked->RequestId);
					Next(21);
				}
			}
			break;
		case 21:
			if (S != nullptr && Friend(*S, PeerId) != nullptr)
			{
				Check(L, TEXT("LSQ3"), true, FString::Printf(TEXT("%s is %s's friend in %s's own view"), *PeerId, *MeId, *MeId));
				const FWonderlandSocialPersonRow* P = Friend(*S, PeerId);
				Check(L, TEXT("LSQ7"), P->Presence.OnlineState == TEXT("ONLINE"), FString::Printf(TEXT("%s seen %s, '%s'"), *PeerId, *P->Presence.OnlineState, *P->Presence.Headline));
				Next(22);
			}
			break;
		case 22:   // A's message, unread
			if (S != nullptr && With(*S, PeerId) != nullptr)
			{
				const FWonderlandSocialConversationRow* C = With(*S, PeerId);
				const TArray<FWonderlandSocialMessage>* History = S->Messages.Find(C->ConversationId);
				const FWonderlandSocialMessage* Hello = History != nullptr ? History->FindByPredicate([&PeerId](const FWonderlandSocialMessage& M) { return M.SenderId == PeerId; }) : nullptr;
				if (Hello != nullptr)
				{
					Check(L, TEXT("LSQ4"), Hello->Body.StartsWith(TEXT("hello from")) && C->Unread >= 1,
						FString::Printf(TEXT("'%s' reached %s, unread %d"), *Hello->Body, *MeId, C->Unread));
					U->OpenSocialHub(TEXT("messages"));
					Shot(L, TEXT("2_message_arrived"));
					U->SendSocialMessage(C->ConversationId, FString::Printf(TEXT("hello back from %s"), *L.Me));
					Next(23);
				}
			}
			break;
		case 23:   // A's party invitation
			if (S != nullptr && S->PartyInvites.Num() > 0)
			{
				U->OpenSocialHub(TEXT("requests"));
				U->RequestSocialAction(TEXT("party_invites.accept"), S->PartyInvites[0].InviteId);
				Next(24);
			}
			break;
		case 24:
			if (S != nullptr && PartyOfTwo(*S, MeId, PeerId))
			{
				Check(L, TEXT("LSQ6"), true, FString::Printf(TEXT("one party of two in %s's own view: %s (leader %s)"), *MeId, *S->Party.PartyId, *S->Party.LeaderId));
				U->OpenSocialHub(TEXT("party"));
				Next(25);
			}
			break;
		case 25:
			if (In >= 2.0)
			{
				Shot(L, TEXT("3_party"));
				U->CloseOverlay();
				// B STEPS 400 uu AHEAD, so A's camera (behind A's Dog, facing the same way at the same start) frames B's Dog
				if (ARelayDogCharacter* Dog = Cast<ARelayDogCharacter>(World->GetFirstPlayerController() != nullptr ? World->GetFirstPlayerController()->GetPawn() : nullptr))
				{
					Dog->SetActorLocation(Dog->GetActorLocation() + Dog->GetActorForwardVector() * 400.0, false, nullptr, ETeleportType::TeleportPhysics);
				}
				Next(40);
			}
			break;
		case 40:   // LSQ8 (B)
			if (Live != nullptr && Live->GetWorldView().Avatars.ContainsByPredicate([&PeerId](const FWonderlandRemoteAvatar& A) { return A.UserId == PeerId; })
				&& Social->NumRemotePlayers() >= 1 && In >= 4.0)
			{
				Check(L, TEXT("LSQ8"), true, FString::Printf(TEXT("context %s (%s), %d here | standing in %s's world: %s"), *Live->GetWorldView().ContextId,
					*Live->GetWorldView().ServerName, Live->GetWorldView().Population, *MeId, *Social->DescribeRemotePlayers()));
				const FWonderlandRemoteAvatar* PeerAvatar = Live->GetWorldView().Avatars.FindByPredicate([&PeerId](const FWonderlandRemoteAvatar& A) { return A.UserId == PeerId; });
				FrameBoth(L, World, PeerAvatar->Location);
				Next(44);
			}
			break;
		case 44:   // LSQ8 (B)'s frame, both Dogs in it, then the player's own view back
			if (In >= 2.0)
			{
				Shot(L, TEXT("4_world_peer_visible"));
				RestoreView(L, World);
				Next(41);
			}
			break;
		case 41:   // give A time to photograph B's Dog, then block A
			if (In >= 10.0)
			{
				U->RequestSocialAction(TEXT("blocks.add"), PeerId);
				Next(42);
			}
			break;
		case 42:   // LSQ9 (B)
			if (Live != nullptr && !Live->GetWorldView().Avatars.ContainsByPredicate([&PeerId](const FWonderlandRemoteAvatar& A) { return A.UserId == PeerId; })
				&& Social->NumRemotePlayers() == 0)
			{
				Check(L, TEXT("LSQ9"), true, FString::Printf(TEXT("after blocking: no figure of %s in %s's world (%s)"), *PeerId, *MeId, *Social->DescribeRemotePlayers()));
				Finish(L);
			}
			break;
		// ---------------------------------------------------------------- after a backend restart (both roles)
		case 50:
			if (S != nullptr && In >= 2.0)
			{
				const FWonderlandSocialConversationRow* C = With(*S, PeerId);
				const TArray<FWonderlandSocialMessage>* History = C != nullptr ? S->Messages.Find(C->ConversationId) : nullptr;
				TArray<FString> Bodies;
				for (const FWonderlandSocialMessage& M : History != nullptr ? *History : TArray<FWonderlandSocialMessage>())
				{
					Bodies.Add(M.Body);
				}
				const FString Want = FString::Printf(TEXT("hello from %s|hello back from %s"), L.bA ? *L.Me : *L.Peer, L.bA ? *L.Peer : *L.Me);
				Check(L, TEXT("LSQR1"), FString::Join(Bodies, TEXT("|")) == Want,
					FString::Printf(TEXT("conversation %s after the restart: [%s] (want [%s])"), C != nullptr ? *C->ConversationId : TEXT("MISSING"), *FString::Join(Bodies, TEXT("|")), *Want));
				// B blocked A. A (blocked) gets no profile of B; B (the blocker) still sees A, as BLOCKED (see the header).
				const bool bNoFriend = Friend(*S, PeerId) == nullptr;
				const FWonderlandSocialProfileView* PeerProfile = S->Profiles.Find(PeerId);
				const bool bProfileRight = L.bA ? PeerProfile == nullptr : (PeerProfile != nullptr && PeerProfile->Relationship == TEXT("BLOCKED"));
				Check(L, TEXT("LSQR2"), bNoFriend && bProfileRight, FString::Printf(TEXT("the block after the restart: friendship %s, %s's profile %s (want %s)"),
					bNoFriend ? TEXT("gone") : TEXT("STILL THERE"), *PeerId,
					PeerProfile == nullptr ? TEXT("hidden") : *FString::Printf(TEXT("visible as %s"), *PeerProfile->Relationship),
					L.bA ? TEXT("hidden: the blocked player") : TEXT("visible as BLOCKED: the blocker")));
				if (L.bA)
				{
					Check(L, TEXT("LSQR3"), S->bHasParty && S->Party.bViewerIsLeader, FString::Printf(TEXT("party after the restart: %s (leader %s)"),
						S->bHasParty ? *S->Party.PartyId : TEXT("NONE"), S->bHasParty ? *S->Party.LeaderId : TEXT("-")));
				}
				U->OpenSocialHub(TEXT("messages"));
				Next(51);
			}
			break;
		case 51:
			if (In >= 2.0)
			{
				Shot(L, TEXT("R_messages_after_restart"));
				U->CloseOverlay();
				Finish(L);
			}
			break;
		default:
			break;
		}
		return true;
	}

	FAutoConsoleCommandWithWorldAndArgs GQaSocialLive(
		TEXT("wl.Qa.SocialLive"),
		TEXT("Two real clients, one loop: `wl.Qa.SocialLive <me> <peer> <a|b> [http://127.0.0.1:8796]` on the DEVELOPMENT social server ")
		TEXT("(developer sessions). A asks (friend request, message, party); B answers; each checks what crossed (LSQ1-LSQ7); quits."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			if (GLive.IsValid() || Args.Num() < 3)
			{
				UE_LOG(LogTemp, Display, TEXT("WLSOCIALLIVE usage: wl.Qa.SocialLive <me> <peer> <a|b> [url]"));
				return;
			}
			GLive = MakeShared<FLive>();
			GLive->World = World;
			GLive->Me = Args[0].ToLower();
			GLive->Peer = Args[1].ToLower();
			GLive->bA = Args[2].Equals(TEXT("a"), ESearchCase::IgnoreCase);
			GLive->Url = Args.Num() > 3 ? Args[3] : FString(TEXT("http://127.0.0.1:8796"));
			GLive->bRestart = Args.Num() > 4 && Args[4].Equals(TEXT("restart"), ESearchCase::IgnoreCase);
			GLive->At = Now();
			GLive->StartedAt = Now();
			GLive->Dir = FPaths::ConvertRelativePathToFull(FPaths::ProjectSavedDir() / TEXT("Screenshots") / TEXT("WLSOCIALLIVE"));
			FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&Tick), 0.1f);
			UE_LOG(LogTemp, Display, TEXT("WLSOCIALLIVE %s armed as %s with %s on %s"), *GLive->Me, GLive->bA ? TEXT("A") : TEXT("B"), *GLive->Peer, *GLive->Url);
		}));
}
