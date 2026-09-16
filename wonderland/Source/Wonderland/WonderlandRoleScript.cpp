#include "WonderlandRoleScript.h"

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandRoleScriptDetail
{
	using K = EWonderlandRoleLineKind;

	/** One task, one guidance thread, one finding, followed through the whole mission, so every console tells the same
	 *  story in its own terms: task-04, guidance G-018/G-019/G-020, evidence E-021 then repair evidence E-024, finding
	 *  F-004, contract criteria C1-C7, architecture boundary B2. All fixture values. */
	struct FBuild
	{
		FWonderlandRoleBlock Block;
		FBuild& Status(const TCHAR* Text) { Block.Status = Text; return *this; }
		FBuild& Add(K Kind, const FString& Text) { Block.Lines.Add({Kind, Text}); return *this; }
		FBuild& Log(const FString& Text) { return Add(K::Log, Text); }
		FBuild& Section(const FString& Text) { return Add(K::Section, Text); }
		FBuild& Command(const FString& Text) { return Add(K::Command, Text); }
		FBuild& Preview(const FString& Text) { return Add(K::Preview, Text); }
		FBuild& Rule() { return Add(K::PreviewRule, TEXT("----------------------------------------")); }
		FBuild& File(const FString& Text) { return Add(K::File, Text); }
		FBuild& Plus(const FString& Text) { return Add(K::DiffAdd, Text); }
		FBuild& Minus(const FString& Text) { return Add(K::DiffRemove, Text); }
		FBuild& Pass(const FString& Text) { return Add(K::Pass, Text); }
		FBuild& Fail(const FString& Text) { return Add(K::Fail, Text); }
		FBuild& Done(const FString& Text) { return Add(K::CheckDone, Text); }
		FBuild& Open(const FString& Text) { return Add(K::CheckOpen, Text); }
		FBuild& Finding(const FString& Text) { return Add(K::Finding, Text); }
		FBuild& State(const FString& Text) { return Add(K::State, Text); }
		FBuild& Wait(const FString& Text) { return Add(K::Wait, Text); }
	};

	FString Companions(bool bLlm, bool bJhinn)
	{
		if (bLlm && bJhinn)
		{
			return TEXT("Companion participation: 2 joined (LLM Companion, Jhinn)");
		}
		if (bLlm || bJhinn)
		{
			return FString::Printf(TEXT("Companion participation: 1 joined (%s)"), bLlm ? TEXT("LLM Companion") : TEXT("Jhinn"));
		}
		return TEXT("Companion participation: none joined");
	}

	FWonderlandRoleBlock Julius(const FString& E, int32 N, bool bLlm, bool bJhinn)
	{
		FBuild B;
		if (E == TEXT("run.started"))
		{
			B.Status(TEXT("ORCHESTRATING")).Section(TEXT("MISSION"))
				.Log(TEXT("Mission alpha accepted · task-1 scoped"))
				.Log(TEXT("Mission Contract initializing"))
				.Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Prompt Architect, Coding Agent, Reviewer: standby"))
				.Log(Companions(bLlm, bJhinn));
		}
		else if (E == TEXT("mission.contract.locked"))
		{
			B.Status(TEXT("ORCHESTRATING")).Section(TEXT("MISSION"))
				.Log(TEXT("Mission Contract locked · RED"))
				.Log(TEXT("Criteria C1-C7 recorded · boundary B2"))
				.Section(TEXT("PROJECT BRAIN"))
				.Log(TEXT("Recorded contract revision r1"));
		}
		else if (E == TEXT("research.requested"))
		{
			B.Status(TEXT("ROUTING")).Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Dispatch: research -> Prompt Architect"))
				.Log(TEXT("Prerequisite context released -> Coding Agent"))
				.Log(TEXT("Prior evidence E-017 released -> Reviewer"))
				.Section(TEXT("MISSION"))
				.Log(TEXT("Mission state: RESEARCH · ORANGE"));
		}
		else if (E == TEXT("research.served"))
		{
			B.Status(TEXT("DECIDING")).Section(TEXT("PROJECT BRAIN"))
				.Log(TEXT("Research packet R-03 recorded"))
				.Log(TEXT("Assumptions A1-A3 attached to task-1"))
				.Section(TEXT("DECISIONS"))
				.State(TEXT("Research ACCEPTED -> planning"));
		}
		else if (E == TEXT("simulated.handoff") && N == 1)
		{
			B.Status(TEXT("ROUTING")).Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Handoff: research -> architecture"))
				.Log(TEXT("Prompt Architect consultation active"));
		}
		else if (E == TEXT("architect.started"))
		{
			B.Status(TEXT("ORCHESTRATING")).Section(TEXT("MISSION"))
				.Log(TEXT("Mission state: PLANNING · YELLOW"))
				.Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Awaiting guidance proposal from Prompt Architect"))
				.Log(TEXT("Coding Agent WAITING on accepted guidance"));
		}
		else if (E == TEXT("architect.guidance"))
		{
			B.Status(TEXT("DECIDING")).Section(TEXT("DECISIONS"))
				.Log(TEXT("Guidance proposal G-018 received"))
				.Log(TEXT("Routing G-018 -> Independent Reviewer for challenge"))
				.Log(TEXT("Challenge returned: no objection"))
				.State(TEXT("Guidance G-018 ACCEPTED"))
				.Section(TEXT("PROJECT BRAIN"))
				.Log(TEXT("Accepted guidance delivered -> Coding Agent"));
		}
		else if (E == TEXT("simulated.handoff") && N == 2)
		{
			B.Status(TEXT("ROUTING")).Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Task packet T-04 dispatched -> Coding Agent"))
				.Log(TEXT("Review packet P-07 held for Reviewer"))
				.Log(TEXT("Dependency task-03 satisfied"));
		}
		else if (E == TEXT("coder.started") && N == 1)
		{
			B.Status(TEXT("ORCHESTRATING")).Section(TEXT("MISSION"))
				.Log(TEXT("Mission state: IMPLEMENTATION · GREEN"))
				.Log(TEXT("Active task lineage: task-04"))
				.Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Coding Agent dispatch active"))
				.Log(TEXT("Reviewer awaiting evidence"));
		}
		else if (E == TEXT("task.paused"))
		{
			B.Status(TEXT("DECIDING")).Section(TEXT("DECISIONS"))
				.Log(TEXT("Checkpoint CP-2 reached · approval required"))
				.Log(TEXT("Coding Agent held at checkpoint"))
				.Log(TEXT("Architecture question Q-2 -> Prompt Architect"));
		}
		else if (E == TEXT("simulated.approval"))
		{
			B.Status(TEXT("DECIDING")).Section(TEXT("DECISIONS"))
				.State(TEXT("Checkpoint CP-2 APPROVED"))
				.Log(TEXT("Coding continuation released"));
		}
		else if (E == TEXT("coder.started"))
		{
			B.Status(TEXT("ORCHESTRATING")).Section(TEXT("DECISIONS"))
				.Log(TEXT("Guidance proposal G-019 received"))
				.Log(TEXT("Routing G-019 -> Independent Reviewer"))
				.State(TEXT("Guidance G-019 ACCEPTED"))
				.Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Coding Agent resumed · task-04"));
		}
		else if (E == TEXT("simulated.handoff"))
		{
			B.Status(TEXT("ROUTING")).Section(TEXT("PROJECT BRAIN"))
				.Log(TEXT("Evidence packet E-021 attached"))
				.Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Implementation returned · E-021"))
				.Log(TEXT("Routing E-021 + P-07 -> Independent Reviewer"));
		}
		else if (E == TEXT("review.started") && N == 1)
		{
			B.Status(TEXT("ORCHESTRATING")).Section(TEXT("MISSION"))
				.Log(TEXT("Mission state: REVIEW · BLUE"))
				.Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Independent Reviewer dispatch active"))
				.Log(TEXT("Coding Agent WAITING on review result"));
		}
		else if (E == TEXT("review.challenge"))
		{
			B.Status(TEXT("DECIDING")).Section(TEXT("DECISIONS"))
				.Log(TEXT("Finding F-004 received · MATERIAL"))
				.State(TEXT("Finding lifecycle: F-004 OPEN"))
				.Log(TEXT("Consultation on F-004 -> Prompt Architect"));
		}
		else if (E == TEXT("review.repair_required"))
		{
			B.Status(TEXT("DECIDING")).Section(TEXT("DECISIONS"))
				.State(TEXT("Repair REQUIRED · F-004"))
				.Log(TEXT("Mission Contract regresses · GREEN"))
				.Log(TEXT("Repair task R1 dispatched -> Coding Agent"));
		}
		else if (E == TEXT("repair.started"))
		{
			B.Status(TEXT("ORCHESTRATING")).Section(TEXT("MISSION"))
				.Log(TEXT("Mission state: REPAIR · round 1"))
				.Section(TEXT("PROJECT BRAIN"))
				.Log(TEXT("Finding lifecycle updated · F-004 OPEN"));
		}
		else if (E == TEXT("review.started"))
		{
			B.Status(TEXT("ROUTING")).Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Re-review armed · Reviewer awaiting E-024"))
				.Log(TEXT("Coding Agent repair in progress"));
		}
		else if (E == TEXT("repair.completed"))
		{
			B.Status(TEXT("ROUTING")).Section(TEXT("PROJECT BRAIN"))
				.Log(TEXT("Repair evidence E-024 attached"))
				.Section(TEXT("ORCHESTRATION"))
				.Log(TEXT("Routing E-024 -> Independent Reviewer"))
				.Section(TEXT("MISSION"))
				.Log(TEXT("Mission state: VERIFYING · INDIGO"));
		}
		else if (E == TEXT("task.verified"))
		{
			B.Status(TEXT("DECIDING")).Section(TEXT("DECISIONS"))
				.Log(TEXT("Review result received: F-004 RESOLVED"))
				.Log(TEXT("E-021 + E-024 checked against C1-C7"))
				.State(TEXT("Julius decision: task-1 VERIFIED"));
		}
		else if (E == TEXT("run.verified"))
		{
			B.Status(TEXT("DECIDING")).Section(TEXT("MISSION"))
				.State(TEXT("Run VERIFIED · Mission Contract VIOLET"))
				.Section(TEXT("PROJECT BRAIN"))
				.Log(TEXT("Mission record sealed"));
		}
		else if (E == TEXT("run.completed"))
		{
			B.Status(TEXT("COMPLETE")).Section(TEXT("DECISIONS"))
				.State(TEXT("Julius: mission COMPLETE"))
				.Log(TEXT("All components returned to standby"));
		}
		return MoveTemp(B.Block);
	}

	FWonderlandRoleBlock Architect(const FString& E, int32 N)
	{
		FBuild B;
		if (E == TEXT("run.started"))
		{
			B.Status(TEXT("STANDBY")).Log(TEXT("standing by for Julius"));
		}
		else if (E == TEXT("mission.contract.locked"))
		{
			B.Status(TEXT("ANALYSING")).Log(TEXT("reading Mission Contract r1"))
				.Log(TEXT("criteria C1-C7 · boundary B2"));
		}
		else if (E == TEXT("research.requested"))
		{
			B.Status(TEXT("RESEARCHING")).Section(TEXT("ARCHITECTURE ANALYSIS"))
				.Log(TEXT("mapping the creation runtime surface"))
				.Log(TEXT("assumption A1: the sandbox owns every grant"))
				.Log(TEXT("assumption A2: no credential inheritance"))
				.Done(TEXT("A1 holds"))
				.Done(TEXT("A2 holds"));
		}
		else if (E == TEXT("research.served"))
		{
			B.Status(TEXT("RESEARCHING"))
				.Log(TEXT("assumption A3: the failure path needs evidence"))
				.Open(TEXT("A3 unverified · carried into the brief"))
				.Log(TEXT("research packet R-03 -> Julius"));
		}
		else if (E == TEXT("simulated.handoff") && N == 1)
		{
			B.Status(TEXT("COMPOSING")).Log(TEXT("consultation opened by Julius"))
				.Section(TEXT("TARGET")).Log(TEXT("CODING AGENT"));
		}
		else if (E == TEXT("architect.started"))
		{
			B.Status(TEXT("COMPOSING")).Section(TEXT("PROMPT PREVIEW")).Rule()
				.Preview(TEXT("Objective:"))
				.Preview(TEXT("Implement the creation boundary without"))
				.Preview(TEXT("changing the Mission Contract."))
				.Preview(TEXT("Architecture constraints:"))
				.Preview(TEXT("- preserve sandbox isolation"))
				.Preview(TEXT("- no credential inheritance"))
				.Preview(TEXT("- accepted guidance only"));
		}
		else if (E == TEXT("architect.guidance"))
		{
			B.Status(TEXT("SUBMITTED"))
				.Preview(TEXT("Required evidence:"))
				.Preview(TEXT("- changed files, tests, artifact refs"))
				.Rule()
				.Log(TEXT("proposal G-018 prepared"))
				.Log(TEXT("submitted to Julius"))
				.Wait(TEXT("awaiting authority decision"))
				.State(TEXT("G-018 ACCEPTED by Julius"));
		}
		else if (E == TEXT("simulated.handoff") && N == 2)
		{
			B.Status(TEXT("COMPOSING")).Section(TEXT("TARGET")).Log(TEXT("INDEPENDENT REVIEWER"))
				.Section(TEXT("PROMPT PREVIEW")).Rule()
				.Preview(TEXT("Review the implementation against:"))
				.Preview(TEXT("- Mission Contract criterion C4"))
				.Preview(TEXT("- architecture boundary B2"))
				.Preview(TEXT("- evidence packet E-021"));
		}
		else if (E == TEXT("coder.started") && N == 1)
		{
			B.Status(TEXT("COMPOSING"))
				.Preview(TEXT("Check for:"))
				.Preview(TEXT("- sandbox escape"))
				.Preview(TEXT("- authority leakage"))
				.Preview(TEXT("- incomplete verification"))
				.Rule()
				.Log(TEXT("review packet P-07 submitted to Julius"));
		}
		else if (E == TEXT("task.paused"))
		{
			B.Status(TEXT("CONSULTING")).Section(TEXT("CONSULTATION Q-2"))
				.Log(TEXT("question from CP-2: cache grants or resolve?"))
				.Log(TEXT("checking boundary B2 against a grant cache"))
				.Finding(TEXT("a cached grant can outlive its scope"));
		}
		else if (E == TEXT("simulated.approval"))
		{
			B.Status(TEXT("CONSULTING")).Section(TEXT("GUIDANCE PROPOSAL"))
				.Preview(TEXT("G-019: resolve grants per call, no cache"))
				.Log(TEXT("proposal G-019 submitted to Julius"));
		}
		else if (E == TEXT("coder.started"))
		{
			B.Status(TEXT("WAITING")).Wait(TEXT("G-019 routed to Reviewer"))
				.State(TEXT("G-019 ACCEPTED by Julius"));
		}
		else if (E == TEXT("simulated.handoff"))
		{
			B.Status(TEXT("CHECKING")).Section(TEXT("ARCHITECTURE CONSISTENCY"))
				.Log(TEXT("E-021 against boundary B2"))
				.Done(TEXT("no new authority surface"));
		}
		else if (E == TEXT("review.started") && N == 1)
		{
			B.Status(TEXT("STANDBY")).Wait(TEXT("review in progress · available to Julius"));
		}
		else if (E == TEXT("review.challenge"))
		{
			B.Status(TEXT("CONSULTING")).Section(TEXT("CONSULTATION F-004"))
				.Log(TEXT("F-004 lies inside boundary B2"))
				.Log(TEXT("A3 confirmed: the failure path was unverified"));
		}
		else if (E == TEXT("review.repair_required"))
		{
			B.Status(TEXT("SUBMITTED")).Section(TEXT("TARGET")).Log(TEXT("CODING AGENT"))
				.Section(TEXT("PROMPT PREVIEW")).Rule()
				.Preview(TEXT("Repair F-004:"))
				.Preview(TEXT("- verify the denial path"))
				.Preview(TEXT("- add a failure-path test"))
				.Preview(TEXT("- return repair evidence"))
				.Rule()
				.Log(TEXT("repair packet G-020 submitted to Julius"));
		}
		else if (E == TEXT("repair.started"))
		{
			B.Status(TEXT("WAITING")).State(TEXT("G-020 ACCEPTED by Julius"))
				.Wait(TEXT("repair in progress"));
		}
		else if (E == TEXT("review.started"))
		{
			B.Status(TEXT("COMPOSING")).Log(TEXT("re-review criteria for Reviewer"))
				.Preview(TEXT("Re-check C7 failure-path coverage on E-024"));
		}
		else if (E == TEXT("repair.completed"))
		{
			B.Status(TEXT("CHECKING")).Section(TEXT("ARCHITECTURE CONSISTENCY"))
				.Log(TEXT("E-024 against boundary B2"))
				.Done(TEXT("B2 respected · no new surface"));
		}
		else if (E == TEXT("task.verified"))
		{
			B.Status(TEXT("DONE")).Log(TEXT("consistency result returned to Julius"));
		}
		else if (E == TEXT("run.completed"))
		{
			B.Status(TEXT("STANDBY")).Log(TEXT("available"));
		}
		return MoveTemp(B.Block);
	}

	FWonderlandRoleBlock Coder(const FString& E, int32 N)
	{
		FBuild B;
		if (E == TEXT("run.started"))
		{
			B.Status(TEXT("STANDBY")).Log(TEXT("standing by for Julius"));
		}
		else if (E == TEXT("research.requested"))
		{
			B.Status(TEXT("PREPARING"))
				.Command(TEXT("$ inspect src/wonder/creation/"))
				.Log(TEXT("12 files · creation-runtime.ts, grants.ts"))
				.Command(TEXT("$ read mission-contract r1"));
		}
		else if (E == TEXT("research.served"))
		{
			B.Status(TEXT("WAITING")).Log(TEXT("prerequisite context loaded"))
				.Wait(TEXT("waiting on accepted guidance"));
		}
		else if (E == TEXT("architect.guidance"))
		{
			B.Status(TEXT("PREPARING")).Log(TEXT("accepted guidance G-018 loaded"));
		}
		else if (E == TEXT("simulated.handoff") && N == 2)
		{
			B.Status(TEXT("PREPARING")).Log(TEXT("task packet T-04 received"))
				.Command(TEXT("$ open src/wonder/creation/creation-runtime.ts"));
		}
		else if (E == TEXT("coder.started") && N == 1)
		{
			B.Status(TEXT("IMPLEMENTING")).Section(TEXT("EDIT"))
				.File(TEXT("src/wonder/creation/creation-runtime.ts"))
				.Minus(TEXT("export const admitAll = (req) => admit(req);"))
				.Plus(TEXT("export function enforceCreationBoundary(req) {"))
				.Plus(TEXT("  const grant = resolveGrant(req.actor, req.scope);"))
				.Plus(TEXT("  if (!grant.allowed) return deny(req, grant.reason);"))
				.Plus(TEXT("  return admit(req, grant);"))
				.Plus(TEXT("}"))
				.Log(TEXT("5 lines added · 1 line removed"));
		}
		else if (E == TEXT("task.paused"))
		{
			B.Status(TEXT("PAUSED")).Wait(TEXT("held at checkpoint CP-2"));
		}
		else if (E == TEXT("simulated.approval"))
		{
			B.Status(TEXT("IMPLEMENTING")).Command(TEXT("$ run tests creation-boundary"))
				.Pass(TEXT("creation-boundary.test.ts   6/6"));
		}
		else if (E == TEXT("coder.started"))
		{
			B.Status(TEXT("IMPLEMENTING")).Log(TEXT("guidance G-019 applied"))
				.File(TEXT("src/wonder/creation/grants.ts"))
				.Minus(TEXT("  const cached = grantCache.get(key);"))
				.Plus(TEXT("  const grant = resolveGrantFresh(actor, scope);"))
				.Command(TEXT("$ run tests creation sandbox"))
				.Pass(TEXT("creation-boundary.test.ts   6/6"))
				.Pass(TEXT("sandbox-isolation.test.ts   4/4"));
		}
		else if (E == TEXT("simulated.handoff"))
		{
			B.Status(TEXT("RETURNED")).Log(TEXT("evidence packet E-021 created"))
				.Log(TEXT("implementation E-021 returned to Julius"));
		}
		else if (E == TEXT("review.started") && N == 1)
		{
			B.Status(TEXT("WAITING")).Wait(TEXT("waiting on review result"));
		}
		else if (E == TEXT("review.challenge"))
		{
			B.Status(TEXT("WAITING")).Wait(TEXT("finding F-004 raised · awaiting Julius"));
		}
		else if (E == TEXT("review.repair_required"))
		{
			B.Status(TEXT("REPAIRING")).Section(TEXT("FINDING F-004"))
				.Finding(TEXT("Reviewer: failure path lacks verification evidence"))
				.Command(TEXT("$ locate deny path · creation-runtime.ts:148"));
		}
		else if (E == TEXT("repair.started"))
		{
			B.Status(TEXT("REPAIRING")).Section(TEXT("REPAIR"))
				.File(TEXT("src/wonder/creation/creation-runtime.ts"))
				.Minus(TEXT("  if (!grant.allowed) return deny(req, grant.reason);"))
				.Plus(TEXT("  if (!grant.allowed) return denyWithEvidence(req, grant);"))
				.File(TEXT("tests/creation/failure-path.test.ts"))
				.Plus(TEXT("it('denies and records evidence', () => {"))
				.Plus(TEXT("  expect(run(deniedRequest)).toMatchEvidence();"))
				.Plus(TEXT("});"));
		}
		else if (E == TEXT("review.started"))
		{
			B.Status(TEXT("REPAIRING")).Command(TEXT("$ run tests failure-path"))
				.Fail(TEXT("failure-path.test.ts   0/1  evidence id missing"))
				.File(TEXT("src/wonder/creation/creation-runtime.ts"))
				.Plus(TEXT("  evidence.record(req.id, grant.reason);"))
				.Command(TEXT("$ run tests failure-path creation"))
				.Pass(TEXT("failure-path.test.ts   1/1"))
				.Pass(TEXT("creation-boundary.test.ts   6/6"));
		}
		else if (E == TEXT("repair.completed"))
		{
			B.Status(TEXT("RETURNED")).Log(TEXT("repair evidence E-024 created"))
				.Log(TEXT("repair evidence returned to Julius"));
		}
		else if (E == TEXT("task.verified"))
		{
			B.Status(TEXT("WAITING")).Wait(TEXT("verdict from Julius"));
		}
		else if (E == TEXT("run.verified"))
		{
			B.Status(TEXT("DONE")).Log(TEXT("task-04 closed"));
		}
		else if (E == TEXT("run.completed"))
		{
			B.Status(TEXT("STANDBY")).Log(TEXT("available"));
		}
		return MoveTemp(B.Block);
	}

	FWonderlandRoleBlock Reviewer(const FString& E, int32 N)
	{
		FBuild B;
		if (E == TEXT("run.started"))
		{
			B.Status(TEXT("STANDBY")).Log(TEXT("standing by for Julius"));
		}
		else if (E == TEXT("research.requested"))
		{
			B.Status(TEXT("PREPARING")).Log(TEXT("prior evidence E-017 received for context"))
				.Done(TEXT("E-017 scope matches task-1"));
		}
		else if (E == TEXT("research.served"))
		{
			B.Status(TEXT("PREPARING")).Log(TEXT("contract criteria loaded: 7"));
		}
		else if (E == TEXT("architect.guidance"))
		{
			B.Status(TEXT("CHALLENGING")).Section(TEXT("GUIDANCE CHALLENGE G-018"))
				.Done(TEXT("within the Mission Contract"))
				.Done(TEXT("no authority leakage"))
				.Log(TEXT("no objection returned to Julius"));
		}
		else if (E == TEXT("coder.started") && N == 1)
		{
			B.Status(TEXT("PREPARING")).Log(TEXT("preparing review context for task-04"))
				.Section(TEXT("CRITERIA"))
				.Open(TEXT("C1 changed-file scope"))
				.Open(TEXT("C4 sandbox boundary"))
				.Open(TEXT("C6 test evidence"))
				.Open(TEXT("C7 failure-path coverage"));
		}
		else if (E == TEXT("coder.started"))
		{
			B.Status(TEXT("CHALLENGING")).Section(TEXT("GUIDANCE CHALLENGE G-019"))
				.Done(TEXT("narrows grant lifetime · no objection"));
		}
		else if (E == TEXT("simulated.handoff") && N == 3)
		{
			B.Status(TEXT("PREPARING")).Log(TEXT("review packet P-07 received"));
		}
		else if (E == TEXT("review.started") && N == 1)
		{
			B.Status(TEXT("INSPECTING")).Log(TEXT("received implementation E-021"))
				.Log(TEXT("evidence artifacts: 4"))
				.Section(TEXT("CHECKING"))
				.Done(TEXT("C1 changed-file scope"))
				.Done(TEXT("C4 sandbox boundary"))
				.Done(TEXT("C6 test evidence"))
				.Open(TEXT("C7 failure-path coverage"));
		}
		else if (E == TEXT("review.challenge"))
		{
			B.Status(TEXT("INSPECTING")).Command(TEXT("$ inspect diff · creation-runtime.ts"))
				.Plus(TEXT("enforceCreationBoundary(...)"))
				.Plus(TEXT("explicit denial path"))
				.Section(TEXT("FINDING F-004 · SEVERITY MATERIAL"))
				.Finding(TEXT("Claim: failure path lacks verification evidence"))
				.Log(TEXT("Evidence: creation-runtime.ts:148 · E-021"));
		}
		else if (E == TEXT("review.repair_required"))
		{
			B.Status(TEXT("RETURNED")).State(TEXT("F-004  OPEN"))
				.Log(TEXT("finding F-004 returned to Julius"));
		}
		else if (E == TEXT("repair.started"))
		{
			B.Status(TEXT("WAITING")).Wait(TEXT("waiting on repair evidence"));
		}
		else if (E == TEXT("review.started"))
		{
			B.Status(TEXT("RE-REVIEW")).Log(TEXT("re-review criteria received"))
				.Wait(TEXT("awaiting repair evidence E-024"));
		}
		else if (E == TEXT("repair.completed"))
		{
			B.Status(TEXT("RE-REVIEW")).Log(TEXT("repair E-024 received"))
				.Command(TEXT("$ compare before / after"))
				.State(TEXT("F-004  OPEN -> ADDRESSED"))
				.Command(TEXT("$ run resolution check"))
				.Done(TEXT("C7 failure-path coverage"));
		}
		else if (E == TEXT("task.verified"))
		{
			B.Status(TEXT("RETURNED")).State(TEXT("F-004  ADDRESSED -> RESOLVED"))
				.Log(TEXT("review result returned to Julius"))
				.Wait(TEXT("the verdict is Julius's"));
		}
		else if (E == TEXT("run.completed"))
		{
			B.Status(TEXT("STANDBY")).Log(TEXT("available"));
		}
		return MoveTemp(B.Block);
	}
}

FWonderlandRoleBlock WonderlandRoleBlockFor(EWonderlandJuliusRole Role, FName EventType, int32 Occurrence, bool bLlmJoined, bool bJhinnJoined)
{
	const FString Event = EventType.ToString();
	const int32 N = FMath::Max(Occurrence, 1);
	switch (Role)
	{
	case EWonderlandJuliusRole::Julius:              return WonderlandRoleScriptDetail::Julius(Event, N, bLlmJoined, bJhinnJoined);
	case EWonderlandJuliusRole::PromptArchitect:     return WonderlandRoleScriptDetail::Architect(Event, N);
	case EWonderlandJuliusRole::CodingAgent:         return WonderlandRoleScriptDetail::Coder(Event, N);
	case EWonderlandJuliusRole::IndependentReviewer: return WonderlandRoleScriptDetail::Reviewer(Event, N);
	default: break;
	}
	return FWonderlandRoleBlock();
}

FString WonderlandRoleRestingStatus(EWonderlandJuliusRole Role, bool bCompleted)
{
	if (Role == EWonderlandJuliusRole::Julius)
	{
		return bCompleted ? TEXT("COMPLETE") : TEXT("STANDBY");
	}
	return TEXT("STANDBY");
}

float WonderlandRoleLineHoldSeconds(EWonderlandRoleLineKind Kind)
{
	// READABLE, NOT INSTANT (founder: "I need enough time to actually READ what is happening"). A code line or a
	// packet line is short and comes in a run; a finding or a decision is the thing to stop on.
	switch (Kind)
	{
	case EWonderlandRoleLineKind::PreviewRule: return 0.30f;
	case EWonderlandRoleLineKind::Section:     return 0.45f;
	case EWonderlandRoleLineKind::DiffAdd:
	case EWonderlandRoleLineKind::DiffRemove:  return 0.55f;
	case EWonderlandRoleLineKind::Preview:     return 0.60f;
	case EWonderlandRoleLineKind::CheckDone:
	case EWonderlandRoleLineKind::CheckOpen:   return 0.65f;
	case EWonderlandRoleLineKind::File:        return 0.70f;
	case EWonderlandRoleLineKind::Command:     return 0.85f;
	case EWonderlandRoleLineKind::Pass:        return 0.75f;
	case EWonderlandRoleLineKind::Fail:        return 1.10f;
	case EWonderlandRoleLineKind::Finding:
	case EWonderlandRoleLineKind::State:       return 1.10f;
	case EWonderlandRoleLineKind::Wait:        return 0.90f;
	default: break;
	}
	return 0.80f;
}

const TCHAR* WonderlandJuliusRoleTitle(EWonderlandJuliusRole Role)
{
	switch (Role)
	{
	case EWonderlandJuliusRole::Julius:              return TEXT("JULIUS");
	case EWonderlandJuliusRole::PromptArchitect:     return TEXT("PROMPT ARCHITECT");
	case EWonderlandJuliusRole::CodingAgent:         return TEXT("CODING AGENT");
	case EWonderlandJuliusRole::IndependentReviewer: return TEXT("INDEPENDENT REVIEWER");
	default: break;
	}
	return TEXT("");
}
