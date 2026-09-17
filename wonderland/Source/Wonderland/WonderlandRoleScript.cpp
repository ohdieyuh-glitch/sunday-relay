#include "WonderlandRoleScript.h"

// THE CONCURRENT WORKSTREAM (founder, 2026-09-16 evening). All four wake together at mission start and keep working in
// parallel where their work allows it; where it truly depends on another component the dependency is shown honestly
// (WAITING_ON_GUIDANCE, WAITING_ON_REVIEW). One task is followed through the whole mission so every section tells the
// same story in its own terms: contract criteria C1-C7 and boundary B2; research R-03; prompt packet P-05 to the Coding
// Agent and review packet P-07 to the Reviewer; guidance G-018 and G-019; task CA-01; evidence E-021; finding F-004
// OPEN -> ADDRESSED -> RESOLVED; repair task CA-02 and repair evidence E-024. All of it is fixture data.
//
// THE HANDOFFS HAVE NO BLOCK. The world withholds the three simulated handoffs (UWonderlandMissionSubsystem), so no
// section ever narrates one; the work that used to sit on them is carried by the events either side.

// Named, not anonymous: the module is one unity translation unit.
namespace WonderlandRoleScriptDetail
{
	using K = EWonderlandRoleLineKind;

	struct FBuild
	{
		FWonderlandRoleBlock Block;
		FBuild& Status(const TCHAR* Text) { Block.Status = Text; return *this; }
		/** A status change partway through the block, when the component gets to it. */
		FBuild& Now(const FString& Text) { return Add(K::Status, Text); }
		FBuild& Add(K Kind, const FString& Text) { Block.Lines.Add({Kind, Text}); return *this; }
		FBuild& Episode(const FString& Text) { return Add(K::Episode, Text); }
		FBuild& Summary(const FString& Text) { return Add(K::Summary, Text); }
		FBuild& Log(const FString& Text) { return Add(K::Log, Text); }
		FBuild& Section(const FString& Text) { return Add(K::Section, Text); }
		FBuild& Command(const FString& Text) { return Add(K::Command, Text); }
		FBuild& File(const FString& Text) { return Add(K::CodeFile, Text); }
		/** "174", '+', "  code" */
		FBuild& Code(const TCHAR* Number, TCHAR Marker, const FString& Text)
		{
			return Add(K::CodeLine, FString::Printf(TEXT("%s|%c|%s"), Number, Marker, *Text));
		}
		FBuild& Stat(const FString& Text) { return Add(K::DiffStat, Text); }
		FBuild& Prompt(const FString& Target) { return Add(K::PromptBegin, Target); }
		FBuild& Heading(const FString& Text) { return Add(K::PromptHeading, Text); }
		FBuild& Line(const FString& Text) { return Add(K::PromptLine, Text); }
		FBuild& EndPrompt() { return Add(K::PromptEnd, FString()); }
		FBuild& Pass(const FString& Text) { return Add(K::Pass, Text); }
		FBuild& Fail(const FString& Text) { return Add(K::Fail, Text); }
		FBuild& Done(const FString& Text) { return Add(K::CheckDone, Text); }
		FBuild& Open(const FString& Text) { return Add(K::CheckOpen, Text); }
		FBuild& Card(const FString& Id, const FString& Severity, const FString& Message, const FString& Where)
		{
			return Add(K::FindingCard, FString::Printf(TEXT("%s|%s|%s|%s"), *Id, *Severity, *Message, *Where));
		}
		FBuild& State(const FString& Text) { return Add(K::State, Text); }
		FBuild& Wait(const FString& Text) { return Add(K::Wait, Text); }
		FBuild& Pause(float Seconds) { return Add(K::Pause, FString::SanitizeFloat(Seconds)); }
	};

	FString Companions(bool bLlm, bool bJhinn)
	{
		if (bLlm && bJhinn)
		{
			return TEXT("companions joined: LLM Companion, Jhinn");
		}
		if (bLlm || bJhinn)
		{
			return FString::Printf(TEXT("companion joined: %s"), bLlm ? TEXT("LLM Companion") : TEXT("Jhinn"));
		}
		return TEXT("companions: none joined");
	}

	const TCHAR* const Runtime = TEXT("src/relay/mission/creation-runtime.ts");
	const TCHAR* const Grants = TEXT("src/relay/mission/grants.ts");
	const TCHAR* const Evidence = TEXT("src/relay/mission/evidence.ts");
	const TCHAR* const BoundaryTest = TEXT("tests/mission/creation-boundary.test.ts");
	const TCHAR* const FailureTest = TEXT("tests/mission/failure-path.test.ts");

	/* ================================================================ JULIUS */
	FWonderlandRoleBlock Julius(const FString& E, int32 N, bool bLlm, bool bJhinn)
	{
		FBuild B;
		if (E == TEXT("run.started"))
		{
			B.Status(TEXT("ORCHESTRATING")).Episode(TEXT("MISSION ALPHA"))
				.Log(TEXT("mission alpha accepted · task-1 scoped"))
				.Log(TEXT("Mission Contract initializing"))
				.Log(TEXT("Prompt Architect active"))
				.Log(TEXT("Coding Agent active"))
				.Log(TEXT("Independent Reviewer active"))
				.Log(Companions(bLlm, bJhinn))
				.Log(TEXT("task lineage opened · task-1"));
		}
		else if (E == TEXT("mission.contract.locked"))
		{
			B.Status(TEXT("ORCHESTRATING"))
				.State(TEXT("Mission Contract LOCKED · RED"))
				.Log(TEXT("criteria C1-C7 recorded · boundary B2"))
				.Log(TEXT("architecture packet A-03 recorded"))
				.Log(TEXT("reviewer criteria initialized"))
				.Log(TEXT("Project Brain · contract revision r1"));
		}
		else if (E == TEXT("research.requested"))
		{
			B.Status(TEXT("ORCHESTRATING")).Episode(TEXT("RESEARCH"))
				.Log(TEXT("research R-03 -> Prompt Architect"))
				.Log(TEXT("prerequisite context -> Coding Agent"))
				.Log(TEXT("prior evidence E-017 -> Independent Reviewer"))
				.State(TEXT("mission state · RESEARCH · ORANGE"));
		}
		else if (E == TEXT("research.served"))
		{
			B.Status(TEXT("DECIDING"))
				.Log(TEXT("research packet R-03 received"))
				.Log(TEXT("assumptions A1-A3 attached to task-1"))
				.State(TEXT("research ACCEPTED -> planning"))
				.Now(TEXT("ORCHESTRATING"))
				.Log(TEXT("building task graph · CA-01 depends on P-05"));
		}
		else if (E == TEXT("architect.started"))
		{
			B.Status(TEXT("ORCHESTRATING")).Episode(TEXT("PLANNING"))
				.State(TEXT("mission state · PLANNING · YELLOW"))
				.Log(TEXT("Prompt Architect composing P-05"))
				.Log(TEXT("Coding Agent WAITING_ON_GUIDANCE"))
				.Log(TEXT("Reviewer preparing guidance challenge"));
		}
		else if (E == TEXT("architect.guidance"))
		{
			B.Status(TEXT("DECIDING")).Episode(TEXT("GUIDANCE"))
				.Log(TEXT("prompt packet P-05 received"))
				.Log(TEXT("routing P-05 -> Independent Reviewer (challenge)"))
				.Log(TEXT("challenge returned · no objection"))
				.State(TEXT("P-05 ACCEPTED · guidance G-018"))
				.Now(TEXT("ROUTING"))
				.Log(TEXT("dispatching P-05 -> Coding Agent"));
		}
		else if (E == TEXT("coder.started") && N == 1)
		{
			B.Status(TEXT("ORCHESTRATING")).Episode(TEXT("IMPLEMENTATION · CA-01"))
				.Log(TEXT("task CA-01 assigned -> Coding Agent"))
				.State(TEXT("mission state · IMPLEMENTATION · GREEN"))
				.Log(TEXT("review packet P-07 held for Reviewer"))
				.Log(TEXT("watching dependency CA-01 -> E-021"));
		}
		else if (E == TEXT("task.paused"))
		{
			B.Status(TEXT("DECIDING"))
				.State(TEXT("checkpoint CP-2 · approval required"))
				.Log(TEXT("Coding Agent held at CP-2"))
				.Log(TEXT("question Q-2 -> Prompt Architect"));
		}
		else if (E == TEXT("simulated.approval"))
		{
			B.Status(TEXT("ORCHESTRATING"))
				.State(TEXT("checkpoint CP-2 APPROVED"))
				.Log(TEXT("guidance G-019 -> Independent Reviewer"))
				.State(TEXT("G-019 ACCEPTED"))
				.Log(TEXT("coding continuation released"));
		}
		else if (E == TEXT("coder.started"))
		{
			B.Status(TEXT("ORCHESTRATING"))
				.Log(TEXT("Coding Agent resumed · CA-01"))
				.Log(TEXT("targeted tests requested"))
				.Log(TEXT("Project Brain · G-018, G-019 on task-1"));
		}
		else if (E == TEXT("review.started") && N == 1)
		{
			B.Status(TEXT("ROUTING")).Episode(TEXT("REVIEW · E-021"))
				.Log(TEXT("evidence E-021 received from Coding Agent"))
				.Log(TEXT("routing E-021 + P-07 -> Independent Reviewer"))
				.State(TEXT("mission state · REVIEW · BLUE"))
				.Now(TEXT("ORCHESTRATING"));
		}
		else if (E == TEXT("review.challenge"))
		{
			B.Status(TEXT("DECIDING"))
				.Log(TEXT("finding F-004 received · MATERIAL"))
				.State(TEXT("F-004 · OPEN"))
				.Log(TEXT("consultation F-004 -> Prompt Architect"));
		}
		else if (E == TEXT("review.repair_required"))
		{
			B.Status(TEXT("DECIDING")).Episode(TEXT("REPAIR · F-004"))
				.State(TEXT("REPAIR REQUIRED · F-004"))
				.Log(TEXT("Mission Contract regresses · GREEN"))
				.Log(TEXT("repair task CA-02 created -> Coding Agent"));
		}
		else if (E == TEXT("repair.started"))
		{
			B.Status(TEXT("ORCHESTRATING"))
				.Log(TEXT("repair CA-02 in progress"))
				.Log(TEXT("finding lifecycle tracked · F-004"))
				.Log(TEXT("Reviewer re-check armed"));
		}
		else if (E == TEXT("review.started"))
		{
			B.Status(TEXT("ORCHESTRATING"))
				.Log(TEXT("re-review released -> Independent Reviewer"))
				.Log(TEXT("awaiting repair evidence E-024"));
		}
		else if (E == TEXT("repair.completed"))
		{
			B.Status(TEXT("ROUTING")).Episode(TEXT("VERIFICATION"))
				.Log(TEXT("repair evidence E-024 received"))
				.Log(TEXT("routing E-024 -> Independent Reviewer"))
				.State(TEXT("mission state · VERIFYING · INDIGO"))
				.Now(TEXT("ORCHESTRATING"))
				.Log(TEXT("consistency check -> Prompt Architect"));
		}
		else if (E == TEXT("task.verified"))
		{
			B.Status(TEXT("DECIDING"))
				.Log(TEXT("review result received"))
				.State(TEXT("F-004 · RESOLVED"))
				.Log(TEXT("E-021 + E-024 checked against C1-C7"))
				.State(TEXT("task-1 VERIFIED"));
		}
		else if (E == TEXT("run.verified"))
		{
			B.Status(TEXT("DECIDING")).Episode(TEXT("COMPLETION"))
				.Log(TEXT("final consistency ALIGNED"))
				.Log(TEXT("completion gate evaluating"))
				.State(TEXT("run VERIFIED · VIOLET"))
				.Log(TEXT("Project Brain · mission record sealed"));
		}
		else if (E == TEXT("run.completed"))
		{
			B.Status(TEXT("COMPLETE"))
				.State(TEXT("mission alpha COMPLETE"))
				.Log(TEXT("all components returned to standby"));
		}
		return MoveTemp(B.Block);
	}

	/* ================================================================ PROMPT ARCHITECT */
	FWonderlandRoleBlock Architect(const FString& E, int32 N)
	{
		FBuild B;
		if (E == TEXT("run.started"))
		{
			B.Status(TEXT("ANALYSING")).Episode(TEXT("ANALYSIS · MISSION ALPHA"))
				.Command(TEXT("read mission-contract.draft"))
				.Log(TEXT("architecture map · src/relay/mission/*"))
				.Log(TEXT("boundary B2 located · creation runtime"))
				.Log(TEXT("starting task packet P-05"));
		}
		else if (E == TEXT("mission.contract.locked"))
		{
			B.Status(TEXT("ANALYSING"))
				.Log(TEXT("Mission Contract r1 received"))
				.Log(TEXT("constraints extracted · 4"))
				.Now(TEXT("COMPOSING"))
				.Log(TEXT("composing P-05 for Coding Agent"));
		}
		else if (E == TEXT("research.requested"))
		{
			B.Status(TEXT("RESEARCHING")).Episode(TEXT("RESEARCH · R-03"))
				.Log(TEXT("mapping the creation runtime surface"))
				.Done(TEXT("A1 · the sandbox owns every grant"))
				.Done(TEXT("A2 · no credential inheritance"))
				.Open(TEXT("A3 · failure path has evidence"));
		}
		else if (E == TEXT("research.served"))
		{
			B.Status(TEXT("COMPOSING")).Episode(TEXT("PROMPT · P-05"))
				.Prompt(TEXT("CODING AGENT"))
				.Heading(TEXT("Objective"))
				.Line(TEXT("Implement the Mission Contract boundary."))
				.Heading(TEXT("Constraints"))
				.Line(TEXT("- preserve sandbox isolation"))
				.Line(TEXT("- accepted guidance only"))
				.Line(TEXT("- do not change the contract"))
				.Line(TEXT("- return evidence"));
		}
		else if (E == TEXT("architect.started"))
		{
			B.Status(TEXT("COMPOSING"))
				.Heading(TEXT("Required work"))
				.Line(TEXT("1. inspect the creation runtime"))
				.Line(TEXT("2. implement the boundary"))
				.Line(TEXT("3. add targeted tests"))
				.Line(TEXT("4. return changed-file evidence"))
				.EndPrompt()
				.Log(TEXT("prompt packet P-05 prepared"))
				.Log(TEXT("submitting to Julius"))
				.Now(TEXT("SUBMITTED"))
				.Summary(TEXT("P-05 -> Coding Agent · submitted"));
		}
		else if (E == TEXT("architect.guidance"))
		{
			B.Status(TEXT("COMPOSING")).Episode(TEXT("PROMPT · P-07"))
				.Prompt(TEXT("INDEPENDENT REVIEWER"))
				.Line(TEXT("Review implementation E-021."))
				.Heading(TEXT("Check"))
				.Line(TEXT("- contract criterion C4"))
				.Line(TEXT("- architecture boundary B2"))
				.Line(TEXT("- sandbox isolation"))
				.Line(TEXT("- failure-path evidence"))
				.EndPrompt()
				.Log(TEXT("review packet P-07 prepared"))
				.Now(TEXT("SUBMITTED"))
				.Summary(TEXT("P-07 -> Independent Reviewer · submitted"));
		}
		else if (E == TEXT("coder.started") && N == 1)
		{
			B.Status(TEXT("MONITORING")).Episode(TEXT("CONSULTATION"))
				.Log(TEXT("consultation ready for Coding Agent"))
				.Log(TEXT("watching B2 while CA-01 is implemented"));
		}
		else if (E == TEXT("task.paused"))
		{
			B.Status(TEXT("CONSULTING"))
				.Section(TEXT("QUESTION Q-2"))
				.Log(TEXT("cache grants, or resolve them per call?"))
				.Log(TEXT("checking boundary B2 against a grant cache"))
				.Add(K::Finding, TEXT("a cached grant can outlive its scope"))
				.Log(TEXT("proposal G-019 · resolve per call, no cache"));
		}
		else if (E == TEXT("simulated.approval"))
		{
			B.Status(TEXT("MONITORING"))
				.State(TEXT("G-019 ACCEPTED by Julius"));
		}
		else if (E == TEXT("coder.started"))
		{
			B.Status(TEXT("CHECKING"))
				.Section(TEXT("ARCHITECTURE CONSISTENCY"))
				.Done(TEXT("resolveGrant inside B2"))
				.Done(TEXT("no new authority surface"));
		}
		else if (E == TEXT("review.started") && N == 1)
		{
			B.Status(TEXT("STANDBY"))
				.Wait(TEXT("available to Julius for consultation"));
		}
		else if (E == TEXT("review.challenge"))
		{
			B.Status(TEXT("CONSULTING")).Episode(TEXT("CONSULTATION · F-004"))
				.Log(TEXT("F-004 lies inside boundary B2"))
				.Log(TEXT("A3 confirmed · the failure path was unverified"));
		}
		else if (E == TEXT("review.repair_required"))
		{
			B.Status(TEXT("COMPOSING")).Episode(TEXT("PROMPT · CA-02"))
				.Prompt(TEXT("CODING AGENT"))
				.Line(TEXT("Repair finding F-004."))
				.Line(TEXT("- verify the denial path"))
				.Line(TEXT("- record evidence on deny"))
				.Line(TEXT("- add a failure-path test"))
				.EndPrompt()
				.Log(TEXT("repair packet submitted to Julius"))
				.Now(TEXT("SUBMITTED"));
		}
		else if (E == TEXT("repair.started"))
		{
			B.Status(TEXT("MONITORING"))
				.Log(TEXT("architecture guidance available"));
		}
		else if (E == TEXT("review.started"))
		{
			B.Status(TEXT("COMPOSING"))
				.Log(TEXT("re-review criteria · C7 on E-024"));
		}
		else if (E == TEXT("repair.completed"))
		{
			B.Status(TEXT("CHECKING")).Episode(TEXT("CONSISTENCY · E-024"))
				.Done(TEXT("E-024 inside boundary B2"))
				.Done(TEXT("no new authority surface"));
		}
		else if (E == TEXT("task.verified"))
		{
			B.Status(TEXT("DONE"))
				.Log(TEXT("consistency ALIGNED -> Julius"));
		}
		else if (E == TEXT("run.completed"))
		{
			B.Status(TEXT("STANDBY")).Log(TEXT("available"));
		}
		return MoveTemp(B.Block);
	}

	/* ================================================================ CODING AGENT */
	FWonderlandRoleBlock Coder(const FString& E, int32 N)
	{
		FBuild B;
		if (E == TEXT("run.started"))
		{
			B.Status(TEXT("INSPECTING")).Episode(TEXT("WORKSPACE · RELAY"))
				.Command(TEXT("open project relay"))
				.Command(TEXT("git status"))
				.Log(TEXT("clean · branch mission/alpha"))
				.Command(TEXT("ls src/relay/mission"))
				.Log(TEXT("14 files · creation-runtime.ts, grants.ts, evidence.ts"));
		}
		else if (E == TEXT("mission.contract.locked"))
		{
			B.Status(TEXT("INSPECTING"))
				.Command(TEXT("read creation-runtime.ts"))
				.File(Runtime)
				.Code(TEXT("171"), TEXT(' '), TEXT("export function createMission(req: MissionRequest) {"))
				.Code(TEXT("172"), TEXT(' '), TEXT("  const state = resolveState(req);"))
				.Code(TEXT("173"), TEXT(' '), TEXT("  const grant = grants.lookup(req.actor);"))
				.Code(TEXT("174"), TEXT(' '), TEXT("  return admit(state, grant);"))
				.Code(TEXT("175"), TEXT(' '), TEXT("}"))
				.Log(TEXT("no boundary check before admit()"));
		}
		else if (E == TEXT("research.requested"))
		{
			B.Status(TEXT("INSPECTING"))
				.Command(TEXT("grep -n \"admit(\" src/relay/mission"))
				.Log(TEXT("3 call sites · creation-runtime.ts:174"))
				.File(Grants)
				.Code(TEXT("38"), TEXT(' '), TEXT("export function lookup(actor: ActorId) {"))
				.Code(TEXT("39"), TEXT(' '), TEXT("  return grantCache.get(actor) ?? resolve(actor);"))
				.Code(TEXT("40"), TEXT(' '), TEXT("}"))
				.Log(TEXT("cached grants can outlive their scope"));
		}
		else if (E == TEXT("research.served"))
		{
			B.Status(TEXT("READY"))
				.Log(TEXT("workspace prepared · branch mission/alpha"))
				.Now(TEXT("WAITING_ON_GUIDANCE"))
				.Wait(TEXT("prompt packet P-05 in composition"))
				.Summary(TEXT("workspace inspected · 3 files read"));
		}
		else if (E == TEXT("architect.started"))
		{
			B.Status(TEXT("WAITING_ON_GUIDANCE"))
				.Wait(TEXT("awaiting accepted prompt packet"));
		}
		else if (E == TEXT("architect.guidance"))
		{
			B.Status(TEXT("PREPARING"))
				.State(TEXT("P-05 received · guidance G-018"))
				.Command(TEXT("git checkout -b mission/alpha-ca01"))
				.Command(TEXT("open creation-runtime.ts"));
		}
		else if (E == TEXT("coder.started") && N == 1)
		{
			B.Status(TEXT("IMPLEMENTING")).Episode(TEXT("IMPLEMENTING · creation-runtime.ts"))
				.File(Runtime)
				.Code(TEXT("171"), TEXT(' '), TEXT("export function createMission(req: MissionRequest) {"))
				.Code(TEXT("172"), TEXT(' '), TEXT("  const state = resolveState(req);"))
				.Code(TEXT("173"), TEXT('-'), TEXT("  const grant = grants.lookup(req.actor);"))
				.Code(TEXT("173"), TEXT('+'), TEXT("  const grant = resolveGrant(req.actor, req.scope);"))
				.Code(TEXT("174"), TEXT('+'), TEXT("  if (!grant.allowed) {"))
				.Code(TEXT("175"), TEXT('+'), TEXT("    return deny(req, grant.reason);"))
				.Code(TEXT("176"), TEXT('+'), TEXT("  }"))
				.Code(TEXT("177"), TEXT(' '), TEXT("  return admit(state, grant);"))
				.Stat(TEXT("+4 / -1"))
				.Command(TEXT("save creation-runtime.ts"));
		}
		else if (E == TEXT("task.paused"))
		{
			B.Status(TEXT("PAUSED"))
				.Wait(TEXT("held at checkpoint CP-2"))
				.Command(TEXT("run tests creation-boundary"))
				.Pass(TEXT("creation-boundary.test.ts   6/6"));
		}
		else if (E == TEXT("simulated.approval"))
		{
			B.Status(TEXT("IMPLEMENTING")).Episode(TEXT("IMPLEMENTING · grants.ts"))
				.Log(TEXT("guidance G-019 applied"))
				.File(Grants)
				.Code(TEXT("38"), TEXT('-'), TEXT("export function lookup(actor: ActorId) {"))
				.Code(TEXT("38"), TEXT('+'), TEXT("export function lookup(actor: ActorId, scope: Scope) {"))
				.Code(TEXT("39"), TEXT('-'), TEXT("  return grantCache.get(actor) ?? resolve(actor);"))
				.Code(TEXT("39"), TEXT('+'), TEXT("  return resolveGrantFresh(actor, scope);"))
				.Code(TEXT("40"), TEXT(' '), TEXT("}"))
				.Stat(TEXT("+2 / -2"));
		}
		else if (E == TEXT("coder.started"))
		{
			B.Status(TEXT("IMPLEMENTING")).Episode(TEXT("TESTS · creation-boundary.test.ts"))
				.File(BoundaryTest)
				.Code(TEXT("12"), TEXT('+'), TEXT("it('denies an out-of-scope actor', () => {"))
				.Code(TEXT("13"), TEXT('+'), TEXT("  const res = createMission(outOfScope);"))
				.Code(TEXT("14"), TEXT('+'), TEXT("  expect(res.status).toBe('DENIED');"))
				.Code(TEXT("15"), TEXT('+'), TEXT("});"))
				.Stat(TEXT("+4 / -0"))
				.Command(TEXT("run tests creation sandbox"))
				.Pass(TEXT("creation-boundary.test.ts   7/7"))
				.Pass(TEXT("sandbox-isolation.test.ts   4/4"))
				.Log(TEXT("evidence E-021 created"))
				.Now(TEXT("RETURNED"));
		}
		else if (E == TEXT("review.started") && N == 1)
		{
			B.Status(TEXT("WAITING_ON_REVIEW")).Episode(TEXT("SUBMITTED · E-021"))
				.Wait(TEXT("implementation E-021 submitted"))
				.Summary(TEXT("E-021 submitted for review"));
		}
		else if (E == TEXT("review.challenge"))
		{
			B.Status(TEXT("INSPECTING"))
				.Log(TEXT("finding F-004 raised"))
				.Command(TEXT("open creation-runtime.ts:175"));
		}
		else if (E == TEXT("review.repair_required"))
		{
			B.Status(TEXT("REPAIRING")).Episode(TEXT("REPAIR · F-004"))
				.State(TEXT("repair task CA-02 received"))
				.Log(TEXT("locating the denial path"))
				.File(Runtime)
				.Code(TEXT("174"), TEXT(' '), TEXT("  if (!grant.allowed) {"))
				.Code(TEXT("175"), TEXT('-'), TEXT("    return deny(req, grant.reason);"));
		}
		else if (E == TEXT("repair.started"))
		{
			B.Status(TEXT("REPAIRING"))
				.Code(TEXT("175"), TEXT('+'), TEXT("    evidence.record(req.id, grant.reason);"))
				.Code(TEXT("176"), TEXT('+'), TEXT("    return denyWithEvidence(req, grant);"))
				.Code(TEXT("177"), TEXT(' '), TEXT("  }"))
				.Stat(TEXT("+2 / -1"))
				.File(FailureTest)
				.Code(TEXT("1"), TEXT('+'), TEXT("it('denies and records evidence', () => {"))
				.Code(TEXT("2"), TEXT('+'), TEXT("  expect(run(denied)).toRecordEvidence();"))
				.Code(TEXT("3"), TEXT('+'), TEXT("});"))
				.Command(TEXT("run tests failure-path"))
				.Fail(TEXT("failure-path.test.ts   0/1   evidence id missing"));
		}
		else if (E == TEXT("review.started"))
		{
			B.Status(TEXT("REPAIRING"))
				.File(Evidence)
				.Code(TEXT("22"), TEXT('-'), TEXT("  id: req.id,"))
				.Code(TEXT("22"), TEXT('+'), TEXT("  id: req.id ?? mintEvidenceId(),"))
				.Stat(TEXT("+1 / -1"))
				.Command(TEXT("rerun tests failure-path creation"))
				.Pass(TEXT("failure-path.test.ts   1/1"))
				.Pass(TEXT("creation-boundary.test.ts   7/7"))
				.Log(TEXT("repair evidence E-024 created"));
		}
		else if (E == TEXT("repair.completed"))
		{
			B.Status(TEXT("WAITING_ON_REVIEW")).Episode(TEXT("SUBMITTED · E-024"))
				.Wait(TEXT("repair evidence E-024 submitted"))
				.Summary(TEXT("E-024 submitted for re-review"));
		}
		else if (E == TEXT("task.verified"))
		{
			B.Status(TEXT("WAITING"))
				.Wait(TEXT("verdict from Julius"));
		}
		else if (E == TEXT("run.verified"))
		{
			B.Status(TEXT("DONE"))
				.Log(TEXT("tasks CA-01, CA-02 closed"));
		}
		else if (E == TEXT("run.completed"))
		{
			B.Status(TEXT("STANDBY")).Log(TEXT("available"));
		}
		return MoveTemp(B.Block);
	}

	/* ================================================================ INDEPENDENT REVIEWER */
	FWonderlandRoleBlock Reviewer(const FString& E, int32 N)
	{
		FBuild B;
		if (E == TEXT("run.started"))
		{
			B.Status(TEXT("PREPARING")).Episode(TEXT("REVIEW PREPARATION"))
				.Log(TEXT("loading acceptance criteria"))
				.Section(TEXT("REVIEW CHECKLIST"))
				.Open(TEXT("scope compliance"))
				.Open(TEXT("authority boundaries"))
				.Open(TEXT("test evidence"))
				.Open(TEXT("architecture consistency"))
				.Open(TEXT("failure paths"));
		}
		else if (E == TEXT("mission.contract.locked"))
		{
			B.Status(TEXT("PREPARING"))
				.Log(TEXT("Mission Contract r1 loaded"))
				.Log(TEXT("acceptance criteria loaded · 7"))
				.Log(TEXT("architecture revision r3 loaded"));
		}
		else if (E == TEXT("research.requested"))
		{
			B.Status(TEXT("PREPARING"))
				.Log(TEXT("prior evidence E-017 received"))
				.Done(TEXT("E-017 scope matches task-1"))
				.Log(TEXT("inspecting architecture context B2"));
		}
		else if (E == TEXT("research.served"))
		{
			B.Status(TEXT("PREPARING"))
				.Log(TEXT("checklist bound to criteria C1-C7"))
				.Wait(TEXT("waiting on evidence"));
		}
		else if (E == TEXT("architect.started"))
		{
			B.Status(TEXT("PREPARING"))
				.Log(TEXT("preparing the guidance challenge for P-05"));
		}
		else if (E == TEXT("architect.guidance"))
		{
			B.Status(TEXT("CHALLENGING")).Episode(TEXT("CHALLENGE · P-05"))
				.Done(TEXT("within the Mission Contract"))
				.Done(TEXT("no authority leakage"))
				.Log(TEXT("no objection -> Julius"))
				.Summary(TEXT("P-05 challenged · no objection"));
		}
		else if (E == TEXT("coder.started") && N == 1)
		{
			B.Status(TEXT("PREPARING")).Episode(TEXT("PACKET · P-07"))
				.Log(TEXT("review packet P-07 received"))
				.Wait(TEXT("waiting on evidence E-021"));
		}
		else if (E == TEXT("task.paused"))
		{
			B.Status(TEXT("INSPECTING"))
				.Log(TEXT("inspecting partial evidence at CP-2"))
				.Done(TEXT("scope compliance"));
		}
		else if (E == TEXT("simulated.approval"))
		{
			B.Status(TEXT("CHALLENGING"))
				.Done(TEXT("G-019 narrows grant lifetime · no objection"));
		}
		else if (E == TEXT("coder.started"))
		{
			B.Status(TEXT("PREPARING"))
				.Log(TEXT("evidence E-021 announced"))
				.Wait(TEXT("waiting for Julius to route E-021"));
		}
		else if (E == TEXT("review.started") && N == 1)
		{
			B.Status(TEXT("INSPECTING")).Episode(TEXT("INSPECTING · E-021"))
				.File(Runtime)
				.Done(TEXT("scope valid"))
				.Done(TEXT("authority boundaries"))
				.Done(TEXT("contract preserved"))
				.Done(TEXT("test evidence present"))
				.Open(TEXT("failure path incomplete"));
		}
		else if (E == TEXT("review.challenge"))
		{
			B.Status(TEXT("INSPECTING"))
				.Card(TEXT("F-004"), TEXT("MATERIAL"), TEXT("Failure path lacks verification evidence."), TEXT("creation-runtime.ts:175"))
				.Log(TEXT("finding returned to Julius"));
		}
		else if (E == TEXT("review.repair_required"))
		{
			B.Status(TEXT("RETURNED"))
				.State(TEXT("F-004 · OPEN"))
				.Wait(TEXT("waiting on repair evidence"))
				.Summary(TEXT("F-004 raised · MATERIAL"));
		}
		else if (E == TEXT("repair.started"))
		{
			B.Status(TEXT("PREPARING")).Episode(TEXT("RE-REVIEW PREPARATION"))
				.Log(TEXT("preparing the re-review of F-004"))
				.Open(TEXT("corrected implementation"))
				.Open(TEXT("failure-path test evidence"));
		}
		else if (E == TEXT("review.started"))
		{
			B.Status(TEXT("RE-REVIEW")).Episode(TEXT("RE-REVIEW · F-004"))
				.Command(TEXT("compare E-021 with the repair in progress"))
				.State(TEXT("F-004 · OPEN -> ADDRESSED"))
				.Wait(TEXT("awaiting repair evidence E-024"));
		}
		else if (E == TEXT("repair.completed"))
		{
			B.Status(TEXT("INSPECTING"))
				.Log(TEXT("comparing repair evidence E-024"))
				.Done(TEXT("corrected implementation"))
				.Done(TEXT("test evidence"))
				.Done(TEXT("failure paths"));
		}
		else if (E == TEXT("task.verified"))
		{
			B.Status(TEXT("RETURNED"))
				.State(TEXT("F-004 · ADDRESSED -> RESOLVED"))
				.Log(TEXT("review result returned to Julius"))
				.Wait(TEXT("the verdict is Julius's"));
		}
		else if (E == TEXT("run.verified"))
		{
			B.Status(TEXT("DONE"));
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
	// READABLE, NOT INSTANT: a typed line has already taken its time to arrive, so it holds briefly; a finding, a decision
	// or a failing test is the thing to stop on.
	switch (Kind)
	{
	case EWonderlandRoleLineKind::CodeLine:
	case EWonderlandRoleLineKind::DiffAdd:
	case EWonderlandRoleLineKind::DiffRemove:    return 0.18f;
	case EWonderlandRoleLineKind::PromptLine:
	case EWonderlandRoleLineKind::Preview:       return 0.22f;
	case EWonderlandRoleLineKind::PromptHeading: return 0.25f;
	case EWonderlandRoleLineKind::PromptBegin:   return 0.45f;
	case EWonderlandRoleLineKind::PromptEnd:     return 0.30f;
	case EWonderlandRoleLineKind::PreviewRule:   return 0.20f;
	case EWonderlandRoleLineKind::Section:       return 0.35f;
	case EWonderlandRoleLineKind::CodeFile:
	case EWonderlandRoleLineKind::File:          return 0.55f;
	case EWonderlandRoleLineKind::DiffStat:      return 0.80f;
	case EWonderlandRoleLineKind::CheckDone:
	case EWonderlandRoleLineKind::CheckOpen:     return 0.55f;
	case EWonderlandRoleLineKind::Command:       return 0.80f;
	case EWonderlandRoleLineKind::Pass:          return 0.70f;
	case EWonderlandRoleLineKind::Fail:          return 1.40f;
	case EWonderlandRoleLineKind::Finding:
	case EWonderlandRoleLineKind::State:         return 1.10f;
	case EWonderlandRoleLineKind::FindingCard:   return 2.20f;
	case EWonderlandRoleLineKind::Wait:          return 0.90f;
	case EWonderlandRoleLineKind::Status:
	case EWonderlandRoleLineKind::Episode:
	case EWonderlandRoleLineKind::Summary:       return 0.05f;
	case EWonderlandRoleLineKind::Blank:         return 0.10f;
	default: break;
	}
	return 0.75f;
}

bool WonderlandRoleLineTypes(EWonderlandRoleLineKind Kind)
{
	return Kind == EWonderlandRoleLineKind::CodeLine || Kind == EWonderlandRoleLineKind::PromptLine
		|| Kind == EWonderlandRoleLineKind::Preview || Kind == EWonderlandRoleLineKind::DiffAdd || Kind == EWonderlandRoleLineKind::DiffRemove;
}

float WonderlandRoleTypingCharsPerSecond(EWonderlandRoleLineKind Kind)
{
	// A coding agent types code at a pace a person can follow; prose in a prompt a little faster.
	return Kind == EWonderlandRoleLineKind::CodeLine || Kind == EWonderlandRoleLineKind::DiffAdd || Kind == EWonderlandRoleLineKind::DiffRemove
		? 44.0f
		: 58.0f;
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
