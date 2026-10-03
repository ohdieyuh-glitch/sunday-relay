// Copyright Wonderland. wl.Qa.BrainLink -- the Project Brain link's own rules, checked in the packaged game with NO bridge
// (Second Wonderland, 2026-10-03; the founder's Project Brain Alpha list, items 1, 3, 9, 10, 11, 12).
//
// Every check has a control that must come out the OTHER way in the same run, so a check that cannot fail is caught by its own
// control (Second's rule: approve a control only after it can turn red):
//   BL1  a well-formed relay-wonderland-project-brain.v1 view parses (the control for BL2)
//   BL2  six malformed views are each refused WHOLE (wrong schema, no cursor, a surface without proposals, an entry without a
//        ref, not JSON, data not an object)
//   BL3  an events page parses; one without a cursor is refused
//   BL4  a write's answer is said in the bridge's words; only no-connection and 503 may be retried with the same key
//   BL5  PREVIEW: a credential-shaped line is refused before it is recorded; a clean line is recorded (control)
//   BL6  LIVE (a fixture view adopted): every line is the view's, a surface the view does not name is EMPTY (never a sample);
//        a clean proposal reaches the write path (spy 1); a key, and the same key with a zero-width space in it, never do (spy 0)
//   BL7  CUT OFF: after MarkLinkLost the model is not live, says NOT CONNECTED, and refuses proposals and reviews (spy 0); a new
//        live view makes it live again
//   BL8  a review names the memory by Project Brain's reference, never by the text on screen; an index past the end is refused
//   BL9  the terminal never echoes a pairing code; other /brain lines are echoed as typed (control)
// The model and the write delegates are restored at the end. Logs WLBRAINQA lines. `quit` exits after.
//
// PLAIN C++: no UCLASS, no UFUNCTION, no log category (LogTemp) -- a new early FName can shift Niagara's type hash (RC1).

#include "CoreMinimal.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "Misc/Guid.h"
#include "Kismet/KismetSystemLibrary.h"
#include "WonderlandCard.h"
#include "WonderlandProjectBrain.h"
#include "WonderlandProjectBrainLink.h"

namespace WonderlandBrainQa
{
	struct FTally
	{
		int32 Pass = 0;
		int32 Fail = 0;
	};

	void Report(FTally& Tally, const TCHAR* Id, bool bPass, const FString& Detail)
	{
		bPass ? ++Tally.Pass : ++Tally.Fail;
		UE_LOG(LogTemp, Display, TEXT("WLBRAINQA %s %s | %s"), Id, bPass ? TEXT("PASS") : TEXT("FAIL"), *Detail);
	}

	/** A credential the screen must catch, made at run time so no key-shaped literal is ever compiled into the game. */
	FString SyntheticKey()
	{
		const FString Body = FGuid::NewGuid().ToString(EGuidFormats::Digits).ToLower() + FGuid::NewGuid().ToString(EGuidFormats::Digits).Left(12);
		return FString(TEXT("s")) + TEXT("k-") + TEXT("proj-") + Body;
	}

	FString ViewJson(const FString& ProjectId, const FString& Schema, bool bCursor, bool bSurfaceProposals, bool bEntryRef)
	{
		const FString Entry = bEntryRef
			? FString(TEXT("{\"ref\":\"pbr:00000000-0000-4000-8000-000000000001@v1\",\"line\":\"QA fact one\",\"status\":\"ACTIVE\"}"))
			: FString(TEXT("{\"line\":\"QA fact one\",\"status\":\"ACTIVE\"}"));
		const FString Learned = TEXT("{\"ref\":\"pbr:00000000-0000-4000-8000-000000000002@v3\",\"line\":\"QA learned fact\",\"status\":\"PROPOSED\"}");
		return FString::Printf(TEXT("{\"data\":{\"schemaVersion\":\"%s\",\"projectId\":\"%s\",%s\"brainRevision\":41,\"sourceLine\":\"QA FIXTURE VIEW\","
			"\"missionTitle\":\"QA mission\",\"surfaces\":["
			"{\"id\":\"user_facts\",\"entryCount\":7,\"entries\":[%s]%s},"
			"{\"id\":\"learned_facts\",\"entryCount\":1,\"entries\":[%s],\"proposals\":[]}"
			"]}}"),
			*Schema, *ProjectId, bCursor ? TEXT("\"cursor\":\"pbc1.QUFB\",") : TEXT(""), *Entry,
			bSurfaceProposals ? TEXT(",\"proposals\":[{\"ref\":\"pbr:00000000-0000-4000-8000-000000000003@v1\",\"line\":\"QA pending proposal\"}]") : TEXT(""),
			*Learned);
	}

	UWonderlandProjectBrainSubsystem* BrainFor(UWorld* World)
	{
		UGameInstance* Instance = World != nullptr ? World->GetGameInstance() : nullptr;
		return Instance != nullptr ? Instance->GetSubsystem<UWonderlandProjectBrainSubsystem>() : nullptr;
	}

	const FWonderlandBrainSurface* Surface(const UWonderlandProjectBrainSubsystem& Brain, const TCHAR* Id)
	{
		return Brain.FindSurface(FName(Id));
	}

	void Run(UWorld* World, bool bQuit)
	{
		FTally T;
		UE_LOG(LogTemp, Display, TEXT("WLBRAINQA BEGIN | the Project Brain link's rules, no bridge"));
		UWonderlandProjectBrainSubsystem* Brain = BrainFor(World);
		if (Brain == nullptr)
		{
			Report(T, TEXT("BL0"), false, TEXT("no Project Brain subsystem in this world"));
			UE_LOG(LogTemp, Display, TEXT("WLBRAINQA END pass=%d fail=%d"), T.Pass, T.Fail);
			return;
		}
		const FWonderlandBrainModel Saved = Brain->GetModel();
		const UWonderlandProjectBrainSubsystem::FWonderlandBrainLivePropose SavedPropose = Brain->LivePropose;
		const UWonderlandProjectBrainSubsystem::FWonderlandBrainLiveReview SavedReview = Brain->LiveReview;
		const FString Project = TEXT("qa-brain-project");
		const FString Good = ViewJson(Project, TEXT("relay-wonderland-project-brain.v1"), true, true, true);

		// BL1 / BL2
		{
			FWonderlandBrainLiveView View;
			const bool bOk = WonderlandProjectBrainLinkLogic::ParseView(Good, View);
			const bool bShape = bOk && View.ProjectId == Project && View.BrainRevision == 41 && View.Surfaces.Num() == 2
				&& View.Surfaces[0].Entries.Num() == 1 && View.Surfaces[0].Proposals.Num() == 1
				&& View.Surfaces[0].Entries[0].Ref.StartsWith(TEXT("pbr:")) && View.Cursor == TEXT("pbc1.QUFB");
			Report(T, TEXT("BL1"), bShape, FString::Printf(TEXT("a well-formed view: parsed %s, project %s, revision %d, %d surface(s)"),
				bOk ? TEXT("yes") : TEXT("no"), *View.ProjectId, View.BrainRevision, View.Surfaces.Num()));

			struct FBad { const TCHAR* Why; FString Body; };
			const TArray<FBad> Bad = {
				{ TEXT("wrong schema"), ViewJson(Project, TEXT("relay-wonderland-project-brain.v2"), true, true, true) },
				{ TEXT("no cursor"), ViewJson(Project, TEXT("relay-wonderland-project-brain.v1"), false, true, true) },
				{ TEXT("a surface without proposals"), ViewJson(Project, TEXT("relay-wonderland-project-brain.v1"), true, false, true) },
				{ TEXT("an entry without a ref"), ViewJson(Project, TEXT("relay-wonderland-project-brain.v1"), true, true, false) },
				{ TEXT("not JSON"), Good.Left(Good.Len() / 2) },
				{ TEXT("data not an object"), FString(TEXT("{\"data\":[1,2,3]}")) },
			};
			int32 Refused = 0;
			FString Leaked;
			for (const FBad& Case : Bad)
			{
				FWonderlandBrainLiveView Out;
				Out.ProjectId = TEXT("untouched");
				if (!WonderlandProjectBrainLinkLogic::ParseView(Case.Body, Out) && Out.ProjectId == TEXT("untouched"))
				{
					++Refused;
				}
				else
				{
					Leaked += FString::Printf(TEXT(" [%s]"), Case.Why);
				}
			}
			Report(T, TEXT("BL2"), Refused == Bad.Num(), FString::Printf(TEXT("malformed views refused whole, the output untouched: %d of %d%s"),
				Refused, Bad.Num(), Leaked.IsEmpty() ? TEXT("") : *FString::Printf(TEXT("; ACCEPTED:%s"), *Leaked)));
		}

		// BL3
		{
			int32 Events = -1;
			FString Cursor;
			const bool bOk = WonderlandProjectBrainLinkLogic::ParseEventsPage(TEXT("{\"data\":{\"events\":[{\"seq\":1},{\"seq\":2}],\"cursor\":\"pbc1.Qg\"}}"), Events, Cursor);
			int32 Events2 = -1;
			FString Cursor2;
			const bool bRefused = !WonderlandProjectBrainLinkLogic::ParseEventsPage(TEXT("{\"data\":{\"events\":[]}}"), Events2, Cursor2);
			Report(T, TEXT("BL3"), bOk && Events == 2 && Cursor == TEXT("pbc1.Qg") && bRefused,
				FString::Printf(TEXT("events page: parsed %s (%d events, cursor %s); without a cursor refused %s"), bOk ? TEXT("yes") : TEXT("no"), Events, *Cursor,
					bRefused ? TEXT("yes") : TEXT("NO")));
		}

		// BL4
		{
			using namespace WonderlandProjectBrainLinkLogic;
			const FString Saved201 = WriteSentence(TEXT("{\"data\":{\"status\":\"PROPOSED\"}}"), 201, true, TEXT("proposal"));
			const FString Conflict = WriteSentence(TEXT("{\"error\":{\"code\":\"version_conflict\",\"message\":\"the memory changed since you read it\"}}"), 409, true, TEXT("review"));
			const FString Offline = WriteSentence(FString(), 0, false, TEXT("proposal"));
			const bool bWords = Saved201.StartsWith(TEXT("Saved in Project Brain")) && Conflict == TEXT("Not saved: the memory changed since you read it")
				&& Offline.StartsWith(TEXT("Not saved: the bridge could not be reached"));
			const bool bRetry = WriteMayRetry(FString(), 0, false) && WriteMayRetry(TEXT("{}"), 503, true) && !WriteMayRetry(TEXT("{}"), 409, true)
				&& !WriteMayRetry(TEXT("{}"), 422, true) && !WriteMayRetry(TEXT("{}"), 201, true);
			Report(T, TEXT("BL4"), bWords && bRetry, FString::Printf(TEXT("answers: '%s' / '%s' / '%s'; retry only on no connection or 503: %s"),
				*Saved201, *Conflict, *Offline, bRetry ? TEXT("yes") : TEXT("NO")));
		}

		// Spies on the two write paths: what the link would have sent, and nothing reaches the bridge.
		int32 ProposeCalls = 0;
		FString LastProposeText;
		int32 ReviewCalls = 0;
		FString LastReviewRef;
		Brain->LivePropose.BindLambda([&ProposeCalls, &LastProposeText](FName, const FString& Text) { ++ProposeCalls; LastProposeText = Text; return true; });
		Brain->LiveReview.BindLambda([&ReviewCalls, &LastReviewRef](FName, const FString& Ref, bool) { ++ReviewCalls; LastReviewRef = Ref; return true; });
		const FString Key = SyntheticKey();
		const FString KeyLine = FString::Printf(TEXT("our deploy key is %s for staging"), *Key);
		const FString ZwspLine = FString::Printf(TEXT("our deploy key is %s%s%s for staging"), *Key.Left(10), TEXT("​"), *Key.Mid(10));
		const bool bScreenSees = FWonderlandCardStore::HoldsSecret(KeyLine) && FWonderlandCardStore::HoldsSecret(ZwspLine);

		// BL5: preview
		{
			const bool bWasPreview = !Brain->GetModel().bLive;
			const int32 Before = Surface(*Brain, TEXT("user_facts")) != nullptr ? Surface(*Brain, TEXT("user_facts"))->Proposals.Num() : -1;
			const bool bKeyRecorded = Brain->Propose(FName(TEXT("user_facts")), KeyLine);
			const int32 AfterKey = Surface(*Brain, TEXT("user_facts"))->Proposals.Num();
			const bool bCleanRecorded = Brain->Propose(FName(TEXT("user_facts")), TEXT("QA: I prefer short status lines"));
			const int32 AfterClean = Surface(*Brain, TEXT("user_facts"))->Proposals.Num();
			Report(T, TEXT("BL5"), bWasPreview && bScreenSees && !bKeyRecorded && AfterKey == Before && bCleanRecorded && AfterClean == Before + 1 && ProposeCalls == 0,
				FString::Printf(TEXT("preview: started in the preview %s; the screen sees the key %s; key line recorded %s (%d -> %d); clean line recorded %s (-> %d); "
					"live sends %d (want 0)"), bWasPreview ? TEXT("yes") : TEXT("NO"), bScreenSees ? TEXT("yes") : TEXT("NO"), bKeyRecorded ? TEXT("YES") : TEXT("no"),
					Before, AfterKey, bCleanRecorded ? TEXT("yes") : TEXT("NO"), AfterClean, ProposeCalls));
		}

		// BL6: live
		{
			FWonderlandBrainLiveView View;
			WonderlandProjectBrainLinkLogic::ParseView(Good, View);
			Brain->AdoptLive(View);
			const FWonderlandBrainModel& M = Brain->GetModel();
			const FWonderlandBrainSurface* Facts = Surface(*Brain, TEXT("user_facts"));
			const FWonderlandBrainSurface* Decisions = Surface(*Brain, TEXT("decisions"));
			const bool bAdopted = Brain->IsLive() && !M.bDevelopmentPreview && M.BrainRevision == 41 && M.ProjectName == Project && M.SourceLine == TEXT("QA FIXTURE VIEW")
				&& Facts != nullptr && Facts->SampleLines.Num() == 1 && Facts->SampleLines[0] == TEXT("QA fact one") && Facts->EntryCount == 7
				&& Facts->Proposals.Num() == 1 && Decisions != nullptr && Decisions->SampleLines.Num() == 0 && Decisions->EntryCount == 0;
			const bool bClean = Brain->Propose(FName(TEXT("requirements")), TEXT("QA: the export must keep every field"));
			const int32 AfterClean = ProposeCalls;
			const bool bKey = Brain->Propose(FName(TEXT("requirements")), KeyLine);
			const bool bZwsp = Brain->Propose(FName(TEXT("constraints")), ZwspLine);
			const bool bSystem = Brain->Propose(FName(TEXT("decisions")), TEXT("QA: a SYSTEM surface is never the player's to write"));
			Report(T, TEXT("BL6"), bAdopted && bClean && AfterClean == 1 && !bKey && !bZwsp && !bSystem && ProposeCalls == 1 && !LastProposeText.Contains(Key.Mid(8, 16)),
				FString::Printf(TEXT("live: adopted %s (revision %d, user_facts %d line(s) of %d, decisions %d line(s): empty, never a sample); clean sent %s; key sent %s; "
					"key+ZWSP sent %s; a SYSTEM surface %s; sends %d (want 1)"), bAdopted ? TEXT("yes") : TEXT("NO"), M.BrainRevision,
					Facts != nullptr ? Facts->SampleLines.Num() : -1, Facts != nullptr ? Facts->EntryCount : -1, Decisions != nullptr ? Decisions->SampleLines.Num() : -1,
					bClean ? TEXT("yes") : TEXT("NO"), bKey ? TEXT("YES") : TEXT("no"), bZwsp ? TEXT("YES") : TEXT("no"), bSystem ? TEXT("ACCEPTED") : TEXT("refused"), ProposeCalls));
		}

		// BL8: reviews by reference (while live)
		{
			const bool bSent = Brain->Review(FName(TEXT("learned_facts")), 0, true);
			const bool bPast = Brain->Review(FName(TEXT("learned_facts")), 5, true);
			Report(T, TEXT("BL8"), bSent && !bPast && ReviewCalls == 1 && LastReviewRef == TEXT("pbr:00000000-0000-4000-8000-000000000002@v3"),
				FString::Printf(TEXT("review by reference: sent %s naming '%s'; an index past the end %s; reviews sent %d (want 1)"),
					bSent ? TEXT("yes") : TEXT("NO"), *LastReviewRef, bPast ? TEXT("ACCEPTED") : TEXT("refused"), ReviewCalls));
		}

		// BL7: cut off, then live again
		{
			Brain->MarkLinkLost(TEXT("QA: the bridge refused the session."));
			const FString LostLine = Brain->GetModel().SourceLine;
			const bool bLost = !Brain->IsLive() && Brain->GetModel().bLinkLost && LostLine.StartsWith(TEXT("NOT CONNECTED"));
			const int32 SendsBefore = ProposeCalls;
			const int32 ReviewsBefore = ReviewCalls;
			const bool bProposed = Brain->Propose(FName(TEXT("requirements")), TEXT("QA: written while cut off"));
			const bool bReviewed = Brain->Review(FName(TEXT("learned_facts")), 0, false);
			FWonderlandBrainLiveView View;
			WonderlandProjectBrainLinkLogic::ParseView(Good, View);
			Brain->AdoptLive(View);
			const bool bBack = Brain->IsLive() && !Brain->GetModel().bLinkLost && Brain->GetModel().SourceLine == TEXT("QA FIXTURE VIEW");
			Report(T, TEXT("BL7"), bLost && !bProposed && !bReviewed && ProposeCalls == SendsBefore && ReviewCalls == ReviewsBefore && bBack,
				FString::Printf(TEXT("cut off: not live %s, '%s'; a proposal %s, a review %s while cut off; a new view makes it live again %s"),
					bLost ? TEXT("yes") : TEXT("NO"), *LostLine.Left(48), bProposed ? TEXT("SENT") : TEXT("refused"), bReviewed ? TEXT("SENT") : TEXT("refused"),
					bBack ? TEXT("yes") : TEXT("NO")));
		}

		// BL9: the terminal echo
		{
			const FString Code = TEXT("QA7Z9K2M4P");
			const FString Masked = UWonderlandProjectBrainSubsystem::MaskTerminalEcho(FString::Printf(TEXT("/brain pair %s"), *Code));
			const FString Status = UWonderlandProjectBrainSubsystem::MaskTerminalEcho(TEXT("/brain status"));
			Report(T, TEXT("BL9"), !Masked.Contains(Code) && Masked.StartsWith(TEXT("/brain pair")) && Status == TEXT("/brain status"),
				FString::Printf(TEXT("echo: '%s' (the code shown %s); '/brain status' echoed as '%s'"), *Masked, Masked.Contains(Code) ? TEXT("YES") : TEXT("no"), *Status));
		}

		Brain->LivePropose = SavedPropose;
		Brain->LiveReview = SavedReview;
		Brain->ReplaceModelForQa(Saved);
		UE_LOG(LogTemp, Display, TEXT("WLBRAINQA restored the model (%s) and the write paths"), Saved.bLive ? TEXT("live") : TEXT("the preview"));
		UE_LOG(LogTemp, Display, TEXT("WLBRAINQA END pass=%d fail=%d"), T.Pass, T.Fail);
		if (bQuit && World != nullptr)
		{
			UKismetSystemLibrary::QuitGame(World, nullptr, EQuitPreference::Quit, false);
		}
	}

	FAutoConsoleCommandWithWorldAndArgs GBrainLinkQa(
		TEXT("wl.Qa.BrainLink"),
		TEXT("Project Brain link: its rules checked with no bridge -- views, refusals, the secret screen, cut-off, reviews by reference, "
			"the terminal echo (BL1-BL9). `quit` exits after. WLBRAINQA lines."),
		FConsoleCommandWithWorldAndArgsDelegate::CreateLambda([](const TArray<FString>& Args, UWorld* World)
		{
			Run(World, Args.Contains(TEXT("quit")));
		}));
}
