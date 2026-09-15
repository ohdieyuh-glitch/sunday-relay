#include "WonderlandProjectBrain.h"

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
	// NOTHING IS CONNECTED YET, so the only honest source is the labelled development preview. When a Project
	// Brain authority reaches Wonderland it replaces this model through the brain scope -- counts and revisions --
	// and the sample lines go with it.
	BuildDevelopmentPreview();
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
	FWonderlandBrainSurface* Surface = FindMutable(SurfaceId);
	const FString Line = Text.TrimStartAndEnd();
	// THE ACCESS IS CHECKED HERE, not only in the panel: a surface that is not the owner's is refused at the one
	// place a proposal can be recorded, so no other caller can write to history, evidence or governance either.
	if (Surface == nullptr || Surface->Access != EWonderlandBrainAccess::Yours || Line.IsEmpty())
	{
		return false;
	}
	Surface->Proposals.Add(Line.Left(240));
	UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN proposal recorded on %s, not synced (no Project Brain authority): %d characters"),
		*SurfaceId.ToString(), Line.Len());
	OnBrainChanged.Broadcast();
	return true;
}

bool UWonderlandProjectBrainSubsystem::Review(FName SurfaceId, int32 LineIndex, bool bAccept)
{
	FWonderlandBrainSurface* Surface = FindMutable(SurfaceId);
	if (Surface == nullptr || Surface->Access != EWonderlandBrainAccess::Review || !Surface->SampleLines.IsValidIndex(LineIndex))
	{
		return false;
	}
	Surface->Reviews.Add(FString::Printf(TEXT("%s: %s"), bAccept ? TEXT("Accepted") : TEXT("Declined"), *Surface->SampleLines[LineIndex]));
	UE_LOG(LogWonderlandProjectBrain, Log, TEXT("WLBRAIN review %s on %s line %d, not synced (no Project Brain authority)"),
		bAccept ? TEXT("accept") : TEXT("decline"), *SurfaceId.ToString(), LineIndex);
	OnBrainChanged.Broadcast();
	return true;
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
		{TEXT("GPT 6 Astra: nothing shared, not joined."), TEXT("Claude Code Fable 5: nothing shared, not joined.")});

	// 04 MISSION CONTEXT -- the brain scope's own vocabulary.
	Add(TEXT("objective"), TEXT("Objective"), G::Mission, A::System, TEXT("What the Mission Contract locked in."),
		{TEXT("See the companions beside the Relay Dog in Wonderland.")});
	Add(TEXT("requirements"), TEXT("Requirements"), G::Mission, A::Yours, TEXT("What the result must do. Additions are proposals to the contract."),
		{TEXT("White LLM Companion bar beside the blue bar."), TEXT("Labels below the bars."), TEXT("Terminals in the Julius family.")});
	Add(TEXT("constraints"), TEXT("Constraints"), G::Mission, A::Yours, TEXT("What the work must not do."),
		{TEXT("Unreal is never the source of mission truth."), TEXT("Do not skip a failed visual gate.")});
	Add(TEXT("decisions"), TEXT("Decisions"), G::Mission, A::System, TEXT("Accepted decisions. Immutable once accepted."),
		{TEXT("GPT 6 Astra wears the Aurum skin.")});
	Add(TEXT("evidence"), TEXT("Evidence"), G::Mission, A::System, TEXT("What was observed, as references."),
		{TEXT("zc_companion_proof: 8 of 8 checks.")});
	Add(TEXT("evaluations"), TEXT("Evaluations"), G::Mission, A::System, TEXT("Judgements made against the evidence."),
		{TEXT("Phase 1 visual gate: passed in PIE.")});
	Add(TEXT("trace"), TEXT("Trace"), G::Mission, A::System, TEXT("Where every entry came from, and when."),
		{TEXT("Brain revision 12, development preview.")});
	Add(TEXT("governance"), TEXT("Governance"), G::Mission, A::System, TEXT("Who may change what, and who approves it."),
		{TEXT("Julius decides. Project Brain records. Wonderland shows.")});
}
