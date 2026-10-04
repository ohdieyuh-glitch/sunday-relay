#include "WonderlandProjectBrain.h"

#include "Engine/GameInstance.h"
#include "WonderlandBeta.h"
#include "WonderlandCard.h"
#include "WonderlandCompanionSubsystem.h"
#include "WonderlandMissionHandoff.h"
#include "WonderlandJuliusStream.h"
#include "WonderlandProjectBrainLink.h"

DEFINE_LOG_CATEGORY_STATIC(LogWonderlandProjectBrain, Log, All);

const TCHAR* WonderlandBrainText::AccessWord(EWonderlandBrainAccess Access)
{
	switch (Access)
	{
	case EWonderlandBrainAccess::Yours: return TEXT("YOURS");
	case EWonderlandBrainAccess::Review: return TEXT("REVIEW");
	default: return TEXT("SYSTEM");
	}
}

const TCHAR* WonderlandBrainText::GroupWord(EWonderlandBrainGroup Group)
{
	switch (Group)
	{
	case EWonderlandBrainGroup::SemanticMemory: return TEXT("MEMORY CORE · SEMANTIC MEMORY");
	case EWonderlandBrainGroup::EpisodicMemory: return TEXT("MEMORY CORE · EPISODIC MEMORY");
	case EWonderlandBrainGroup::ProceduralMemory: return TEXT("MEMORY CORE · PROCEDURAL MEMORY");
	case EWonderlandBrainGroup::Systems: return TEXT("PROJECT BRAIN SYSTEMS");
	case EWonderlandBrainGroup::Components: return TEXT("LARGE LANGUAGE MODEL COMPONENTS");
	default: return TEXT("MISSION CONTEXT");
	}
}

void UWonderlandProjectBrainSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	// THE PLAYER'S SESSION FIRST: game-instance subsystems start in no promised order, and the samples below name the
	// companions, which a tester's build calls by their roles (WonderlandBeta). The switches are idempotent.
	WonderlandBeta::ApplyPlayerSessionSwitches();
	// NOTHING IS CONNECTED YET, so the only honest source is the labelled development preview. When a Project
	// Brain authority reaches Wonderland it replaces this model through the brain scope -- counts and revisions --
	// and the sample lines go with it.
	BuildDevelopmentPreview();
	// THE LINK TO THE REAL PROJECT BRAIN. It reads nothing until the stream's session is paired for a project, so an
	// unpaired world keeps the preview above, exactly as before. The session is the stream's, never held here.
	Collection.InitializeDependency(UWonderlandJuliusStreamSubsystem::StaticClass());
	Link = MakeShared<FWonderlandProjectBrainLink>(GetGameInstance(), this);
	LivePropose.BindSP(Link.ToSharedRef(), &FWonderlandProjectBrainLink::SendProposal);
	LiveReview.BindSP(Link.ToSharedRef(), &FWonderlandProjectBrainLink::SendReview);
	LiveSetStatus.BindSP(Link.ToSharedRef(), &FWonderlandProjectBrainLink::SendStatus);
	Link->Start();
}

void UWonderlandProjectBrainSubsystem::Deinitialize()
{
	LivePropose.Unbind();
	LiveReview.Unbind();
	LiveSetStatus.Unbind();
	if (Link.IsValid())
	{
		Link->Stop();
		Link.Reset();
	}
	Super::Deinitialize();
}

FString UWonderlandProjectBrainSubsystem::DescribeLink() const
{
	return Link.IsValid() ? Link->Describe() : FString(TEXT("WLBRAIN LINK: not started"));
}

void UWonderlandProjectBrainSubsystem::RefreshLink()
{
	if (Link.IsValid())
	{
		Link->Refresh();
	}
}

const FWonderlandBrainSurface* UWonderlandProjectBrainSubsystem::FindSurface(FName SurfaceId) const
{
	return Model.Surfaces.FindByPredicate([SurfaceId](const FWonderlandBrainSurface& Surface) { return Surface.Id == SurfaceId; });
}

FWonderlandBrainSurface* UWonderlandProjectBrainSubsystem::FindMutable(FName SurfaceId)
{
	return Model.Surfaces.FindByPredicate([SurfaceId](const FWonderlandBrainSurface& Surface) { return Surface.Id == SurfaceId; });
}

bool UWonderlandProjectBrainSubsystem::Propose(FName SurfaceId, const FString& Text)
{
	// PROJECT BRAIN STATE: never the Mission Handoff's to write (the write spy)
	FWonderlandMissionHandoff::NoteMutation(TEXT("UWonderlandProjectBrainSubsystem::Propose"));
	FWonderlandBrainSurface* Surface = FindMutable(SurfaceId);
	const FString Line = Text.TrimStartAndEnd();
	// THE ACCESS IS CHECKED HERE, not only in the panel: a surface that is not the owner's is refused at the one
	// place a proposal can be recorded, so no other caller can write to history, evidence or governance either.
	if (Surface == nullptr || Surface->Access != EWonderlandBrainAccess::Yours || Line.IsEmpty())
	{
		return false;
	}
	// NO KEY EVER LEAVES THIS CLIENT AS A MEMORY (the founder's "never persist secrets in the Project Brain"; Second, 10-03): the
	// same fail-closed screen C.A.R.D. and the Mission Contract objective use, on the text as typed AND without its invisible
	// characters. Refused whole -- never sent, never kept here, never logged (the log says only its length) -- in the preview too.
	if (FWonderlandCardStore::HoldsSecret(Line))
	{
		SetWriteNote(TEXT("Not sent: that line holds something shaped like a key or password. Project Brain never stores credentials -- "
			"keep them in Julius Connect, and write the memory without them."));
		UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN proposal on %s REFUSED before sending: it holds a credential shape (%d characters)"),
			*SurfaceId.ToString(), Line.Len());
		return false;
	}
	if (Model.bLive && Model.bLinkLost)
	{
		SetWriteNote(TEXT("Not sent: this world is no longer connected to Project Brain. /brain pair <code> connects it again."));
		return false;
	}
	if (Model.bLive)
	{
		// LIVE: SENT, NOT KEPT. Nothing is added here; the proposal appears when the bridge says Project Brain holds
		// it (the next view). The bridge checks the access again, from the membership row, not from this panel.
		const bool bSent = LivePropose.IsBound() && LivePropose.Execute(SurfaceId, Line.Left(4000));
		SetWriteNote(bSent ? FString(TEXT("Sending to Project Brain...")) : FString(TEXT("Not saved: this world is not linked to Project Brain right now.")));
		UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN proposal on %s %s: %d characters"),
			*SurfaceId.ToString(), bSent ? TEXT("sent to Project Brain") : TEXT("NOT sent (no link)"), Line.Len());
		return bSent;
	}
	Surface->Proposals.Add(Line.Left(240));
	SetWriteNote(FString());   // the preview now shows the last note (a refusal); a proposal kept clears it
	UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN proposal recorded on %s, not synced (no Project Brain authority): %d characters"),
		*SurfaceId.ToString(), Line.Len());
	OnBrainChanged.Broadcast();
	return true;
}

bool UWonderlandProjectBrainSubsystem::Review(FName SurfaceId, int32 LineIndex, bool bAccept)
{
	FWonderlandMissionHandoff::NoteMutation(TEXT("UWonderlandProjectBrainSubsystem::Review"));
	FWonderlandBrainSurface* Surface = FindMutable(SurfaceId);
	if (Surface == nullptr || Surface->Access != EWonderlandBrainAccess::Review || !Surface->SampleLines.IsValidIndex(LineIndex))
	{
		return false;
	}
	if (Model.bLive)
	{
		// A REVIEW NAMES THE MEMORY IT REVIEWS, by Project Brain's own reference -- never by the text on screen.
		if (Model.bLinkLost)
		{
			SetWriteNote(TEXT("Not sent: this world is no longer connected to Project Brain. /brain pair <code> connects it again."));
			return false;
		}
		if (!Surface->EntryRefs.IsValidIndex(LineIndex))
		{
			return false;
		}
		const bool bSent = LiveReview.IsBound() && LiveReview.Execute(SurfaceId, Surface->EntryRefs[LineIndex], bAccept);
		SetWriteNote(bSent ? FString(TEXT("Sending the review to Project Brain...")) : FString(TEXT("Not saved: this world is not linked to Project Brain right now.")));
		return bSent;
	}
	Surface->Reviews.Add(FString::Printf(TEXT("%s: %s"), bAccept ? TEXT("Accepted") : TEXT("Declined"), *Surface->SampleLines[LineIndex]));
	UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN review %s on %s line %d, not synced (no Project Brain authority)"),
		bAccept ? TEXT("accept") : TEXT("decline"), *SurfaceId.ToString(), LineIndex);
	OnBrainChanged.Broadcast();
	return true;
}

void UWonderlandProjectBrainSubsystem::AdoptLive(const FWonderlandBrainLiveView& View)
{
	Model.bLive = true;
	Model.bLinkLost = false;
	Model.bDevelopmentPreview = false;
	Model.ProjectName = View.ProjectId;
	Model.MissionTitle = View.MissionTitle;
	Model.BrainRevision = View.BrainRevision;
	Model.SourceLine = View.SourceLine;
	for (FWonderlandBrainSurface& Surface : Model.Surfaces)
	{
		// The panel's own definition stays (title, group, access, purpose); only what Project Brain holds changes.
		Surface.SampleLines.Reset();
		Surface.EntryRefs.Reset();
		Surface.ProposalRefs.Reset();
		Surface.ProposalVersions.Reset();
		Surface.Proposals.Reset();
		Surface.Reviews.Reset();
		Surface.EntryCount = 0;
		const FWonderlandBrainLiveSurface* Live = View.Surfaces.FindByPredicate(
			[&Surface](const FWonderlandBrainLiveSurface& Candidate) { return Candidate.Id == Surface.Id; });
		if (Live == nullptr)
		{
			continue;
		}
		Surface.EntryCount = Live->EntryCount;
		for (const FWonderlandBrainLiveEntry& Entry : Live->Entries)
		{
			// A person's review of a memory is shown on the memory itself, in Project Brain's word for it.
			Surface.SampleLines.Add(Entry.Review.IsEmpty() ? Entry.Line : FString::Printf(TEXT("%s · %s"), *Entry.Review, *Entry.Line));
			Surface.EntryRefs.Add(Entry.Ref);
		}
		for (const FWonderlandBrainLiveEntry& Proposal : Live->Proposals)
		{
			Surface.Proposals.Add(Proposal.Line);
			Surface.ProposalRefs.Add(Proposal.Ref);
			Surface.ProposalVersions.Add(Proposal.Version);
		}
	}
	UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN live view adopted for %s at revision %d"), *View.ProjectId, View.BrainRevision);
	OnBrainChanged.Broadcast();
}

void UWonderlandProjectBrainSubsystem::SetWriteNote(const FString& Note)
{
	if (Model.WriteNote == Note)
	{
		return;
	}
	Model.WriteNote = Note;
	OnBrainChanged.Broadcast();
}

void UWonderlandProjectBrainSubsystem::MarkLinkLost(const FString& Why)
{
	// ONLY A LIVE VIEW CAN GO STALE: the preview is labelled as the preview already, and stays exactly as it is.
	if (!Model.bLive || Model.bLinkLost)
	{
		return;
	}
	Model.bLinkLost = true;
	Model.SourceLine = FString::Printf(TEXT("NOT CONNECTED  ·  LAST READ AT BRAIN REVISION %d  ·  %s"), Model.BrainRevision, *Why.ToUpper());
	Model.WriteNote = FString::Printf(TEXT("Not connected: %s What is shown is what Project Brain held when it was last read; nothing can be sent "
		"until /brain pair <code> connects this world again."), *Why);
	UE_LOG(LogWonderlandProjectBrain, Warning, TEXT("WLBRAIN link lost: %s (the last view, revision %d, stays on screen labelled NOT CONNECTED)"), *Why,
		Model.BrainRevision);
	OnBrainChanged.Broadcast();
}

FString UWonderlandProjectBrainSubsystem::MaskTerminalEcho(const FString& Line)
{
	// "/brain pair <code>": the code is a one-time credential for this player's session -- never echoed or logged.
	FString Command;
	FString Rest;
	if (!Line.TrimStartAndEnd().Split(TEXT(" "), &Command, &Rest))
	{
		return Line;
	}
	FString Verb;
	FString Code;
	if (!Rest.TrimStartAndEnd().Split(TEXT(" "), &Verb, &Code))
	{
		Verb = Rest.TrimStartAndEnd();
	}
	return Verb.Equals(TEXT("pair"), ESearchCase::IgnoreCase) && !Code.TrimStartAndEnd().IsEmpty()
		? FString::Printf(TEXT("%s pair %s"), *Command, TEXT("••••••"))
		: FWonderlandCardStore::MaskForDisplay(Line);
}

void UWonderlandProjectBrainSubsystem::HandleTerminalLine(const FString& Argument, FString& OutSaid)
{
	FString Verb = Argument.TrimStartAndEnd();
	FString Rest;
	Argument.TrimStartAndEnd().Split(TEXT(" "), &Verb, &Rest);
	Rest = Rest.TrimStartAndEnd();
	UGameInstance* Instance = GetGameInstance();
	UWonderlandJuliusStreamSubsystem* Stream = Instance != nullptr ? Instance->GetSubsystem<UWonderlandJuliusStreamSubsystem>() : nullptr;
	// A BUILD WITH NO BRIDGE HAS NOTHING TO PAIR WITH (Second's RC13 review B6): every verb pointed the player at a website code this
	// build can never redeem. Unless a bridge is configured (or a view is already live), each one gets the same truthful line.
	if (!Model.bLive && (Stream == nullptr || Stream->GetBridgeUrl().IsEmpty()))
	{
		OutSaid = TEXT("Project Brain is not connected in this build: the entries you see are samples, and what you propose is kept until you quit, not saved.");
		// a CLASS of verb, never the word (Second's RC13 review C2: "/brain <a pasted key>" logged 16 characters of it)
		static const TCHAR* const KnownVerbs[] = { TEXT("status"), TEXT("pair"), TEXT("refresh"), TEXT("proposals"), TEXT("adopt"), TEXT("withdraw") };
		FString VerbClass = Verb.IsEmpty() ? FString(TEXT("status")) : FString::Printf(TEXT("other (%d chars)"), Verb.Len());
		for (const TCHAR* Known : KnownVerbs)
		{
			if (Verb.Equals(Known, ESearchCase::IgnoreCase))
			{
				VerbClass = Known;
			}
		}
		UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN /brain %s (no bridge in this build): %s"), *VerbClass, *DescribeLink());
		return;
	}
	if (Verb.IsEmpty() || Verb.Equals(TEXT("status"), ESearchCase::IgnoreCase))
	{
		const FString Where = Model.bLive
			? (Model.bLinkLost ? FString(TEXT("NOT CONNECTED (showing the last view read)")) : FString(TEXT("LIVE")))
			: FString(TEXT("DEVELOPMENT PREVIEW (sample data; not connected)"));
		const FString Bridge = Stream == nullptr ? FString(TEXT("no Julius link in this world"))
			: Stream->GetBridgeUrl().IsEmpty() ? FString(TEXT("no bridge configured for this build"))
			: Stream->IsPaired() ? FString::Printf(TEXT("paired for project %s"), Stream->GetPairedProjectId().IsEmpty() ? TEXT("(none named)") : *Stream->GetPairedProjectId())
			: FString(TEXT("not paired -- /brain pair <code> with the code from the Wonderland website"));
		// the link's DEVELOPER diagnostics go to the log, never into the player's answer (Second's RC13 review B5: R7 debug exposure)
		OutSaid = FString::Printf(TEXT("Project Brain: %s, project %s, brain revision %d; %s."), *Where, *Model.ProjectName, Model.BrainRevision, *Bridge);
		UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN /brain status: %s"), *DescribeLink());
		return;
	}
	if (Verb.Equals(TEXT("pair"), ESearchCase::IgnoreCase))
	{
		if (Stream == nullptr)
		{
			OutSaid = TEXT("Not paired: there is no Julius link in this world.");
			return;
		}
		if (Rest.IsEmpty())
		{
			OutSaid = TEXT("/brain pair <code> -- the pairing code shown on the Wonderland website for your project.");
			return;
		}
		if (Stream->GetBridgeUrl().IsEmpty())
		{
			OutSaid = TEXT("Not paired: this build has no Project Brain bridge configured.");
			return;
		}
		// THE STREAM REDEEMS IT (the one place a session is made); the answer arrives on the link, and /brain status reads it.
		Stream->Pair(Rest);
		UE_LOG(LogWonderlandProjectBrain, Display, TEXT("WLBRAIN /brain pair: a %d-character code sent to the bridge (the code itself is never logged)"), Rest.Len());
		OutSaid = TEXT("Pairing with the bridge... /brain status says when Project Brain is live.");
		return;
	}
	if (Verb.Equals(TEXT("refresh"), ESearchCase::IgnoreCase))
	{
		RefreshLink();
		OutSaid = Model.bLive ? TEXT("Reading Project Brain again from the bridge.") : TEXT("Not paired yet: nothing to read. /brain pair <code> first.");
		return;
	}
	if (Verb.Equals(TEXT("proposals"), ESearchCase::IgnoreCase))
	{
		if (!Model.bLive)
		{
			OutSaid = TEXT("Not live: the preview's proposals are not saved anywhere. /brain pair <code> connects Project Brain.");
			return;
		}
		const TArray<FPendingProposal> Pending = ListPendingProposals();
		if (Pending.Num() == 0)
		{
			OutSaid = TEXT("No proposal is waiting on your surfaces.");
			return;
		}
		TArray<FString> Rows;
		for (int32 Index = 0; Index < Pending.Num(); ++Index)
		{
			// THE LINE AS IT MAY BE SHOWN: what Project Brain holds was screened when it was written; masked again here all the same
			Rows.Add(FString::Printf(TEXT("%d. %s: %s (v%d)"), Index + 1, *Pending[Index].SurfaceTitle,
				*FWonderlandCardStore::MaskForDisplay(Pending[Index].Line.Left(160)), Pending[Index].Version));
		}
		OutSaid = FString::Printf(TEXT("Waiting in Project Brain -- /brain adopt <n> or /brain withdraw <n>:\n%s"), *FString::Join(Rows, TEXT("\n")));
		return;
	}
	const bool bAdopt = Verb.Equals(TEXT("adopt"), ESearchCase::IgnoreCase);
	if (bAdopt || Verb.Equals(TEXT("withdraw"), ESearchCase::IgnoreCase))
	{
		if (!Model.bLive || Model.bLinkLost)
		{
			OutSaid = TEXT("Not sent: this world is not connected to Project Brain. /brain pair <code> connects it.");
			return;
		}
		const TArray<FPendingProposal> Pending = ListPendingProposals();
		// A WHOLE NUMBER ONLY (Second's RC13 review: IsNumeric takes "1.9", which Atoi cut to proposal 1)
		bool bWholeNumber = !Rest.IsEmpty() && Rest.Len() <= 6;
		for (const TCHAR Digit : Rest)
		{
			bWholeNumber = bWholeNumber && FChar::IsDigit(Digit);
		}
		const int32 Number = bWholeNumber ? FCString::Atoi(*Rest) : 0;
		if (!Pending.IsValidIndex(Number - 1) || Pending[Number - 1].Version < 1 || !Pending[Number - 1].Ref.StartsWith(TEXT("pbr:")))
		{
			OutSaid = FString::Printf(TEXT("Not sent: there is no proposal %s. /brain proposals lists them."), Rest.IsEmpty() ? TEXT("with that number") : *Rest.Left(12));
			return;
		}
		const FPendingProposal& Chosen = Pending[Number - 1];
		const FString Status = bAdopt ? TEXT("ADOPTED") : TEXT("WITHDRAWN");
		const bool bSent = LiveSetStatus.IsBound() && LiveSetStatus.Execute(Chosen.Ref, Chosen.Version, Status);
		SetWriteNote(bSent ? FString::Printf(TEXT("Sending: %s proposal %d to Project Brain..."), bAdopt ? TEXT("adopt") : TEXT("withdraw"), Number)
			: FString(TEXT("Not sent: this world is not linked to Project Brain right now.")));
		UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN /brain %s %d: %s %s at v%d %s"), bAdopt ? TEXT("adopt") : TEXT("withdraw"), Number,
			*Chosen.SurfaceId.ToString(), *Chosen.Ref, Chosen.Version, bSent ? TEXT("sent") : TEXT("NOT sent (no link)"));
		OutSaid = bSent ? FString::Printf(TEXT("Asked Project Brain to %s proposal %d (%s). The bridge decides who may; /brain proposals shows the result."),
			bAdopt ? TEXT("adopt") : TEXT("withdraw"), Number, *Chosen.SurfaceTitle) : FString(TEXT("Not sent: this world is not linked to Project Brain right now."));
		return;
	}
	OutSaid = TEXT("/brain [status] | pair <code> | refresh | proposals | adopt <n> | withdraw <n> -- Project Brain: where it stands, connect this world "
		"with the website's code, read it again, and decide what you proposed.");
}

TArray<UWonderlandProjectBrainSubsystem::FPendingProposal> UWonderlandProjectBrainSubsystem::ListPendingProposals() const
{
	TArray<FPendingProposal> Out;
	if (!Model.bLive)
	{
		return Out;
	}
	for (const FWonderlandBrainSurface& Surface : Model.Surfaces)
	{
		if (Surface.Access != EWonderlandBrainAccess::Yours)
		{
			continue;
		}
		for (int32 Index = 0; Index < Surface.Proposals.Num(); ++Index)
		{
			FPendingProposal Row;
			Row.SurfaceId = Surface.Id;
			Row.SurfaceTitle = Surface.Title;
			Row.Line = Surface.Proposals[Index];
			Row.Ref = Surface.ProposalRefs.IsValidIndex(Index) ? Surface.ProposalRefs[Index] : FString();
			Row.Version = Surface.ProposalVersions.IsValidIndex(Index) ? Surface.ProposalVersions[Index] : 0;
			Out.Add(MoveTemp(Row));
		}
	}
	return Out;
}

FString UWonderlandProjectBrainSubsystem::GetSurfaceAccess(FName SurfaceId) const
{
	const FWonderlandBrainSurface* Surface = FindSurface(SurfaceId);
	return Surface != nullptr ? FString(WonderlandBrainText::AccessWord(Surface->Access)) : FString();
}

int32 UWonderlandProjectBrainSubsystem::GetProposalCount(FName SurfaceId) const
{
	const FWonderlandBrainSurface* Surface = FindSurface(SurfaceId);
	return Surface != nullptr ? Surface->Proposals.Num() + Surface->Reviews.Num() : 0;
}

void UWonderlandProjectBrainSubsystem::BuildDevelopmentPreview()
{
	Model = FWonderlandBrainModel();
	Model.ProjectName = TEXT("Wonderland");
	Model.MissionTitle = TEXT("Companion preview");
	Model.BrainRevision = 12;
	Model.bDevelopmentPreview = true;
	Model.SourceLine = TEXT("DEVELOPMENT PREVIEW · SAMPLE DATA · NOT CONNECTED TO PROJECT BRAIN");
	Model.ChakraRank = 7;

	using G = EWonderlandBrainGroup;
	using A = EWonderlandBrainAccess;
	// THE COMPANIONS BY THE NAMES THIS BUILD GIVES THEM (founder, 2026-10-01, D3): the canon names in a developer's
	// session, the role names in a tester's -- read from the one settings object every other surface reads.
	const UWonderlandCompanionPreviewSettings* Names = GetDefault<UWonderlandCompanionPreviewSettings>();
	const FString LlmName = Names != nullptr ? Names->LlmCompanionName : FString(TEXT("LLM COMPANION"));
	const FString AgentName = Names != nullptr ? Names->AgentName : FString(TEXT("JHINN"));
	const FString SharedLlm = FString::Printf(TEXT("%s: nothing shared, not joined."), *LlmName);
	const FString SharedAgent = FString::Printf(TEXT("%s: nothing shared, not joined."), *AgentName);
	const FString AurumDecision = FString::Printf(TEXT("%s wears the Aurum skin."), *LlmName);
	const auto Add = [this](const TCHAR* Id, const TCHAR* Title, G Group, A Access, const TCHAR* Purpose, std::initializer_list<const TCHAR*> Lines)
	{
		FWonderlandBrainSurface Surface;
		Surface.Id = FName(Id);
		Surface.Title = Title;
		Surface.Group = Group;
		Surface.Access = Access;
		Surface.Purpose = Purpose;
		for (const TCHAR* Line : Lines)
		{
			Surface.SampleLines.Add(Line);
		}
		Surface.EntryCount = Surface.SampleLines.Num();
		Model.Surfaces.Add(MoveTemp(Surface));
	};

	// The sample lines are facts about this project that the repository itself records -- never a guess about a
	// person -- so the preview reads like a Project Brain without pretending to be one.

	// 01 MEMORY CORE
	Add(TEXT("user_facts"), TEXT("User Facts"), G::SemanticMemory, A::Yours, TEXT("What you have told Project Brain about you and your work."),
		{TEXT("Wonderland is built in Unreal Engine 5.8."), TEXT("Relay is where the Compound AI Agent is built."), TEXT("Visual proof comes from PIE captures.")});
	Add(TEXT("learned_facts"), TEXT("Learned Facts"), G::SemanticMemory, A::Review, TEXT("What Project Brain inferred. You accept or decline; you do not rewrite it."),
		{TEXT("Imported agents keep a cyan crystalline lower soul."), TEXT("Golden Arrival is where every visitor first stands.")});
	Add(TEXT("preferences"), TEXT("Preferences"), G::SemanticMemory, A::Yours, TEXT("How you want the work presented and paced."),
		{TEXT("Usage labels sit below their bars."), TEXT("See it in Unreal before theory.")});
	Add(TEXT("identity"), TEXT("Identity"), G::SemanticMemory, A::Yours, TEXT("Who this project belongs to and what it is."),
		{TEXT("Project: Wonderland"), TEXT("Product: Relay")});
	Add(TEXT("session_history"), TEXT("Session History"), G::EpisodicMemory, A::System, TEXT("What happened in past sessions, as recorded."),
		{TEXT("Companion preview built and proven in PIE."), TEXT("Companion terminals drawn to the founder's frame.")});
	Add(TEXT("past_actions"), TEXT("Past Actions"), G::EpisodicMemory, A::System, TEXT("Actions taken on this project, in order."),
		{TEXT("Merged the companion preview into the world build."), TEXT("Measured companion placement from the play camera.")});
	Add(TEXT("user_events"), TEXT("User Events"), G::EpisodicMemory, A::System, TEXT("Moments you started, stopped or steered the work."),
		{TEXT("Founder set the sequential roadmap."), TEXT("Founder supplied the Project Brain reference.")});
	Add(TEXT("agent_experiences"), TEXT("Agent Experiences"), G::EpisodicMemory, A::System, TEXT("What agents learned doing the work."),
		{TEXT("A unity build shares every anonymous namespace."), TEXT("Daylight exposure needs strong emissive glow.")});
	Add(TEXT("instructions"), TEXT("Instructions"), G::ProceduralMemory, A::Yours, TEXT("Standing instructions every mission follows."),
		{TEXT("Complete each phase with visible Unreal proof."), TEXT("Julius remains the mission authority.")});
	Add(TEXT("prompt_systems"), TEXT("Prompt Systems"), G::ProceduralMemory, A::System, TEXT("The governed prompt frames each role runs under."),
		{TEXT("Prompt Architect planning frame."), TEXT("Independent Reviewer challenge frame.")});
	Add(TEXT("workflows"), TEXT("Workflows"), G::ProceduralMemory, A::Yours, TEXT("The order work moves through."),
		{TEXT("Plan, build, prove in PIE, report.")});
	Add(TEXT("skills"), TEXT("Skills"), G::ProceduralMemory, A::System, TEXT("Capabilities agents have demonstrated."),
		{TEXT("Unreal PIE capture."), TEXT("Slate interface construction.")});

	// 02 PROJECT BRAIN SYSTEMS
	Add(TEXT("scratchpads"), TEXT("Scratchpads"), G::Systems, A::Yours, TEXT("Working notes that are not yet memory."),
		{TEXT("Phase 2: Project Brain inside Wonderland.")});
	Add(TEXT("memory_synthesis"), TEXT("Memory Synthesis"), G::Systems, A::System, TEXT("How Project Brain condenses what it holds."),
		{TEXT("Last synthesis merged related notes into facts.")});
	Add(TEXT("auto_memories"), TEXT("Auto-Generated Memories"), G::Systems, A::Review, TEXT("Memories Project Brain wrote itself, waiting for you."),
		{TEXT("The founder prefers gold ornament on companions.")});
	Add(TEXT("context_handoffs"), TEXT("Context Handoffs"), G::Systems, A::System, TEXT("Context passed between roles, with its size."),
		{TEXT("Prompt Architect to Coding Agent."), TEXT("Coding Agent to Independent Reviewer.")});
	Add(TEXT("agent_state"), TEXT("Agent State"), G::Systems, A::System, TEXT("Where each agent is right now."),
		{TEXT("Julius 3.3: standby, not connected to this world.")});

	// 03 LARGE LANGUAGE MODEL COMPONENTS -- roles are permanent; providers are implementations.
	Add(TEXT("prompt_architect"), TEXT("Prompt Architect"), G::Components, A::System, TEXT("Plans the mission and guides the work. A role, not a provider."),
		{TEXT("Status: waiting.")});
	Add(TEXT("coding_agent"), TEXT("Coding Agent"), G::Components, A::System, TEXT("Implements and repairs. A role, not a provider."),
		{TEXT("Status: waiting.")});
	Add(TEXT("independent_reviewer"), TEXT("Independent Reviewer"), G::Components, A::System, TEXT("Challenges and verifies. A role, not a provider."),
		{TEXT("Status: waiting.")});
	Add(TEXT("shared_context"), TEXT("Shared Context"), G::Components, A::Yours, TEXT("What companions may see once they join a mission."),
		{*SharedLlm, *SharedAgent});

	// 04 MISSION CONTEXT -- the brain scope's own vocabulary.
	Add(TEXT("objective"), TEXT("Objective"), G::Mission, A::System, TEXT("What the Mission Contract locked in."),
		{TEXT("See the companions beside the Relay Dog in Wonderland.")});
	Add(TEXT("requirements"), TEXT("Requirements"), G::Mission, A::Yours, TEXT("What the result must do. Additions are proposals to the contract."),
		{TEXT("White LLM Companion bar beside the blue bar."), TEXT("Labels below the bars."), TEXT("Terminals in the Julius family.")});
	Add(TEXT("constraints"), TEXT("Constraints"), G::Mission, A::Yours, TEXT("What the work must not do."),
		{TEXT("Unreal is never the source of mission truth."), TEXT("Do not skip a failed visual gate.")});
	Add(TEXT("decisions"), TEXT("Decisions"), G::Mission, A::System, TEXT("Accepted decisions. Immutable once accepted."),
		{*AurumDecision});
	Add(TEXT("evidence"), TEXT("Evidence"), G::Mission, A::System, TEXT("What was observed, as references."),
		{TEXT("zc_companion_proof: 8 of 8 checks.")});
	Add(TEXT("evaluations"), TEXT("Evaluations"), G::Mission, A::System, TEXT("Judgements made against the evidence."),
		{TEXT("Phase 1 visual gate: passed in PIE.")});
	Add(TEXT("trace"), TEXT("Trace"), G::Mission, A::System, TEXT("Where every entry came from, and when."),
		{TEXT("Brain revision 12, development preview.")});
	Add(TEXT("governance"), TEXT("Governance"), G::Mission, A::System, TEXT("Who may change what, and who approves it."),
		{TEXT("Julius decides. Project Brain records. Wonderland shows.")});
}
