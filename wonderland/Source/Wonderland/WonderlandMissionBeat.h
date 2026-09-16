// WONDERLAND — THE MISSION BEAT. What the Mission Contract Orb is showing, and what it will mean.
//
// THE FOUNDER'S SEVENTEEN STATES (2026-09-15), which is the vocabulary a person watching the Dog reads:
// idle, mission start, researching, handoff, the three roles working, waiting, guidance, challenge,
// repair required, repairing, verifying, approval, block, error, complete.
//
// WHY A SECOND VOCABULARY EXISTS AT ALL. EWonderlandJuliusState (WonderlandJuliusState.h) is the RUNTIME's
// twelve phases, mirrored field for field into TypeScript and guarded by wonderland-cpp-parity. It answers
// "which phase is this run in" and there is exactly one answer. The founder's list is finer, because a
// person watching wants to tell a review that is CHALLENGING from a review that is merely running, and a
// pause that is WAITING FOR THEM from one that is not. Those distinctions live on the runtime's second
// axis — EWonderlandActivityAccent — or in the event that caused the phase.
//
// SO A BEAT IS A PAIR, NOT A NEW TRUTH: every member below resolves to one runtime phase and one accent
// that already exist, plus the event names Phase 4 will bind it to. Nothing here invents a state Julius
// cannot produce, and nothing here is a place a provider name could be written down — the founder's rule
// stands: ROLES ARE PERMANENT, PROVIDERS ARE IMPLEMENTATIONS.
//
// PLAIN ENUMS ON PURPOSE. No UENUM, no USTRUCT: the parity test reads those macros and would require a
// TypeScript mirror for a vocabulary that is this world's presentation layer and not the wire. What DOES
// cross the wire is the pair each beat resolves to, and that is mirrored already.
//
// UNOBSERVED IS ORDINAL 0 AND IS NOT IDLE, the same rule the rest of the module keeps. A default-built orb
// says nothing has been reported, never that a mission is resting.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandJuliusState.h"

/** The founder's seventeen, plus the absence of an observation. */
enum class EWonderlandMissionBeat : uint8
{
	Unobserved,
	Idle,
	MissionStart,
	Researching,
	Handoff,
	PromptArchitectActive,
	CodingAgentActive,
	IndependentReviewerActive,
	WaitingCheckpoint,
	Guidance,
	ReviewChallenge,
	RepairRequired,
	Repairing,
	Verifying,
	ApprovalContinue,
	Block,
	Error,
	CompleteVerified
};

/** Every beat, in the order a mission walks them. Sized by the enum, so adding a member breaks the loop loudly. */
inline constexpr int32 WonderlandMissionBeatCount = 18;

/**
 * The seven, in the founder's order: red, orange, yellow, green, blue, indigo, violet. `None` is before the
 * first — an idle orb has not started a task and must not show a root it has not earned.
 */
enum class EWonderlandChakra : uint8
{
	None,
	Root,
	Sacral,
	SolarPlexus,
	Heart,
	Throat,
	Brow,
	Crown
};

inline constexpr int32 WonderlandChakraSteps = 7;

/**
 * HOW THE ORB MOVES for a beat. Numbers rather than clip names, because there is no rig: the orb is built
 * from instanced cubes and posed every frame, so "agitated" has to be a figure, not an asset reference.
 *
 * SPIN CARRIES MEANING AND IS SIGNED. Forward is work advancing. RepairRequired spins BACKWARDS because
 * work is going back to a role that already had it, and Block spins at zero because nothing is moving.
 */
struct FWonderlandBeatMotion
{
	/** Dais revolutions per second. Negative turns back. */
	float SpinRevs = 0.0f;
	/** Vertical travel of the core either side of its rest height, uu. */
	float BobUU = 0.0f;
	float BobPeriod = 4.0f;
	/** Core brightness pulse, hertz, and how deep it cuts (0..1). */
	float PulseHz = 0.0f;
	float PulseDepth = 0.0f;
	/** Unsettled motion, uu. Only states that are genuinely unsettled get any. */
	float JitterUU = 0.0f;
	/** Resting size of the core, as a multiple. */
	float CoreScale = 1.0f;
	/** Resting brightness of the core, as a multiple of the chakra colour. */
	float Brightness = 1.0f;
};

/**
 * ONE BEAT, FULLY STATED: what it looks like, what it means, and what will drive it.
 *
 * `Events` is the part that matters most and the part nothing reads yet. It names the Julius events from
 * the founder's Phase 4 list that will resolve to this beat, so the binding is written down HERE — beside
 * the visual — instead of being invented later in whatever code happens to receive the stream.
 */
struct FWonderlandBeatReading
{
	EWonderlandMissionBeat Beat = EWonderlandMissionBeat::Unobserved;
	/** What a person reads on screen. Never a provider name. */
	const TCHAR* Label = TEXT("UNOBSERVED");
	/** One sentence. A HUD that shows a beat should be able to say why. */
	const TCHAR* Meaning = TEXT("Nothing has been reported.");
	/** The runtime phase this beat resolves to. Already mirrored to TypeScript. */
	EWonderlandJuliusState Phase = EWonderlandJuliusState::Unobserved;
	/** The runtime's second axis. `Unobserved` means the beat is carried by the phase alone. */
	EWonderlandActivityAccent Accent = EWonderlandActivityAccent::Unobserved;
	/** Where the orb's colour goes. Meaningless unless bAdvances. */
	EWonderlandChakra Chakra = EWonderlandChakra::None;
	/** False means HOLD the colour already reached: a modifier, not a step. */
	bool bAdvances = false;
	/** True when the mission is waiting on a person rather than on a model. */
	bool bAsksForAHuman = false;
	/** True for a real ending, of any kind. */
	bool bTerminal = false;
	/** The Julius events that will resolve here in Phase 4. Comma separated, in the founder's spelling. */
	const TCHAR* Events = TEXT("");
	/**
	 * WHAT JULIUS WOULD HAVE TO EMIT for this beat, when nothing in the catalogue currently does. Empty for
	 * every beat a real event already reaches.
	 *
	 * A DECLARED GAP, NOT A SILENT ONE. Two of the founder's seventeen have no event behind them: nothing
	 * reports the gate opened by `task.paused` being CLEARED, and nothing reports that a finished run has
	 * been acknowledged and the world may rest. Both are states a person watching plainly sees, so they
	 * stay in the vocabulary — and the gap is written down here rather than hidden by binding them to the
	 * nearest event that happens to exist, which would make the orb claim a reading it never got. Relay's
	 * own `JULIUS_ACTIVITY_NOT_YET_EMITTED` keeps the same kind of ledger for the same reason.
	 */
	const TCHAR* NotYetEmitted = TEXT("");
	FWonderlandBeatMotion Motion;
};

/* ------------------------------------------------------------------ resolvers */

/** Every field of one beat. Total: an unknown member returns the Unobserved reading rather than garbage. */
WONDERLAND_API const FWonderlandBeatReading& WonderlandBeatReading(EWonderlandMissionBeat Beat);

/** The beat a name selects, e.g. "repair_required". Unobserved when nothing matches. */
WONDERLAND_API EWonderlandMissionBeat WonderlandBeatFromId(FName Id);

/** The stable id of a beat, e.g. "repair_required". The name a console command and a test use. */
WONDERLAND_API FName WonderlandBeatId(EWonderlandMissionBeat Beat);

/**
 * The colour the orb should be showing after this beat, given what it was showing before.
 *
 * THE FOLD IS THE POINT. A beat that holds keeps the step the task has actually reached, so a challenge
 * during review does not reset the progression, and a repair genuinely walks it back to the coding step.
 */
WONDERLAND_API EWonderlandChakra WonderlandChakraForBeat(EWonderlandMissionBeat Beat, EWonderlandChakra Previous);

/** 1..7, or 0 for None. What the seven pips around the dais count up to. */
WONDERLAND_API int32 WonderlandChakraStep(EWonderlandChakra Chakra);

WONDERLAND_API EWonderlandChakra WonderlandChakraForStep(int32 Step);

/**
 * The colour, in linear space, before any glow exposure is applied.
 *
 * NOT THE TEXTBOOK SEVEN. These are pulled toward what reads on a bright Wonderland afternoon — the indigo
 * especially, which at its literal value is indistinguishable from the blue beside it at a distance of a
 * few metres, which would make two of the seven pips the same pip.
 */
WONDERLAND_API FLinearColor WonderlandChakraColour(EWonderlandChakra Chakra);

/** The name a person reads: "ROOT", "HEART", "CROWN". */
WONDERLAND_API const TCHAR* WonderlandChakraName(EWonderlandChakra Chakra);

/** True when a beat is real but no Julius event reaches it yet. Two of the seventeen are in this state. */
WONDERLAND_API bool WonderlandBeatAwaitsAnEvent(EWonderlandMissionBeat Beat);

/**
 * WHETHER A MISSION CONTRACT EXISTS AT ALL while this beat is showing.
 *
 * THE FOUNDER'S CANON, 2026-09-16: a contract is manifested by a task being EXECUTED, not by a player
 * being present. So two beats mean no contract -- `Unobserved`, where nothing has been reported, and
 * `Idle`, where no mission is running -- and every other beat is a task in flight, including the three
 * endings, which a person needs to see land before the crystal goes.
 *
 * It is stated here rather than in the world layer because it is a fact about the VOCABULARY: whether a
 * beat describes a running task is the same question wherever it is asked.
 */
WONDERLAND_API bool WonderlandBeatShowsContract(EWonderlandMissionBeat Beat);
