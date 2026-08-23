// THE UPRIGHT RELAY DOG — the founder's spec sheet, as arithmetic.
//
// WHY THIS IS NOT WonderlandDogPose
//
// WonderlandDogPose already stands a Dog up, and it is the right thing for what
// it does: a quadruped REARING onto its haunches to work. The forelegs fold in,
// the torso pitches back, the hind legs take the weight. It is a dog standing
// up, and it reads as one.
//
// The founder's reference sheet is a different body plan. It is not a dog
// rearing; it is the Relay Dog STANDING, and the difference is structural:
//
//   - the torso is VERTICAL and carries its full height, not pitched back
//   - the forelegs are ARMS, hanging at the sides from shoulders, with paw
//     blocks at the ends -- not folded against the chest
//   - the hind legs are LEGS, straight and slightly apart, with foot blocks
//   - the head sits level ON TOP of the torso, visor and gold eyes forward
//   - the tail is retained, curling out and back
//
// Both are wanted. A Dog rears to reach into an Avatar; a Dog STANDS to be
// presented, to carry a component, to be the hero of a frame. So this file adds
// the second one and leaves the first alone.
//
// WHAT IT MUST NOT DO. The founder's identity rule is that a skin transforms
// the Relay Dog and never replaces it, and proportions ARE the identity. So the
// upright form is built from the SAME parts the quadruped is built from -- the
// same head, the same torso, the same four limbs, the same tail. Nothing here
// creates a humanoid; it re-carries the canonical Dog. The reference sheet
// itself says so: it shows CLASSIC FORM and RELAY OG FORM as two views of one
// character.
//
// WHY IT IS ENGINE-FREE
//
// The complaint this exists to answer is "moves like a Minecraft character" --
// stiff, snapping, sliding, the whole body translating as one block. Every one
// of those is a property of the ARITHMETIC, not of the renderer:
//
//   sliding        a planted foot whose world position changes
//   snapping       a discontinuity across a phase or blend boundary
//   stepping       a pose quantised to a low update rate
//   one-block      no relative motion between pelvis, torso, head and limbs
//
// All four are decidable on a laptop with no GPU, so they are proven in
// WonderlandDogStance.test.cpp with g++ rather than judged from a stream. That
// is the same reason WonderlandDogGait is a separate file, and it is why the
// quadruped walk stopped sliding.
//
// PHASE IS DRIVEN BY DISTANCE, NEVER BY A CLOCK -- inherited deliberately from
// WonderlandGait. A biped walk advanced by time drifts out of step with the
// body the instant speed changes, and that mismatch IS the "legs twitch while
// the body glides" failure. Feeding it distance makes stride and travel the
// same quantity by construction: they cannot disagree.
#pragma once

namespace WonderlandStance
{
	/** Which body plan a Dog is carrying. Quadruped remains the canonical
	 *  spawn identity; Upright is selected per Dog and per role. */
	enum class EStance : int
	{
		Quadruped = 0,
		Upright   = 1,
	};

	/** Why this Dog is standing. Kept separate from WonderlandPose::EWork
	 *  because that enum answers "what are its paws doing" while this answers
	 *  "is it on two legs at all" -- a hero Dog stands with no work to do. */
	enum class EUprightRole : int
	{
		None = 0,        // stays quadruped
		Hero,            // the featured Dog of the arrival frame
		Working,         // implementing / reviewing / repairing / placing
		Ceremonial,      // legendary or presentation Dogs
		SpecialSkin,     // a skin whose sheet is drawn upright
	};

	const char* RoleName(EUprightRole Role);

	/** Does this role stand? One place, so "which Dogs are upright" is a
	 *  question with an answer rather than a scatter of conditionals. */
	bool RoleStandsUpright(EUprightRole Role);

	/** Duty factor for the biped walk. Bipeds spend LESS of the cycle in
	 *  stance than quadrupeds -- around 0.62 at a walk, dropping below 0.5 at a
	 *  run, where both feet leave the ground and it becomes a run by
	 *  definition. 0.62 keeps a brief double-support phase, which is what
	 *  reads as weight rather than as marching. */
	inline constexpr float WalkDutyFactor = 0.62f;

	/** Legs are half a cycle apart; that is what makes it a walk and not a
	 *  hop. Index 0 is LEFT, 1 is RIGHT. */
	float LegPhaseOffset(int LegIndex);

	/** THE STANDING BODY PLAN, at a given uprightness.
	 *
	 *  Every field is ADDED to the part's canonical rest position, in Unreal
	 *  units at the Dog's own scale; angles are degrees. Everything is ZERO at
	 *  Blend 0, which is what makes "quadruped" the exact canonical pose rather
	 *  than an approximation that happens to look close.
	 *
	 *  Limb indices match WonderlandGait throughout: 0 left-hind, 1 right-hind,
	 *  2 left-fore, 3 right-fore. In the upright plan 0 and 1 are the standing
	 *  LEGS and 2 and 3 are the hanging ARMS. Reusing the indices is not
	 *  laziness -- it is what keeps this the same Dog. */
	struct FStandingPose
	{
		/** Pelvis lifts until the hips carry the body at standing height. */
		float PelvisRise = 0.0f;
		/** The torso comes UPRIGHT. Negative pitches the chest up from the
		 *  quadruped's horizontal carry toward vertical. */
		float TorsoPitchDeg = 0.0f;
		/** Torso rises with the pelvis and stretches to its standing height:
		 *  a quadruped torso is carried long and low, a standing one is tall. */
		float TorsoRise = 0.0f;
		/** The head stays LEVEL and forward-facing however the torso moves --
		 *  the visor is the identity and it must read. */
		float HeadRise = 0.0f;
		float HeadPitchDeg = 0.0f;
		/** Standing legs: straighten, and spread slightly for a stable base. */
		float LegRise[4]     = { 0.0f, 0.0f, 0.0f, 0.0f };
		float LegPitchDeg[4] = { 0.0f, 0.0f, 0.0f, 0.0f };
		float LegSpread[4]   = { 0.0f, 0.0f, 0.0f, 0.0f };
		/** Arms hang from the SHOULDER, which is near the top of the standing
		 *  torso -- so the forelimbs rise a long way from their quadruped
		 *  position and rotate to hang down alongside the body. */
		float ArmRise[2]      = { 0.0f, 0.0f };
		float ArmPitchDeg[2]  = { 0.0f, 0.0f };
		float ArmOutDeg[2]    = { 0.0f, 0.0f };
		/** Tail curls out and back, as the sheet draws it. */
		float TailPitchDeg = 0.0f;
		/** How much each standing leg must span now the hips are high. A
		 *  planted foot does not move, so a rising hip has to be reached FROM:
		 *  this is the same correction WonderlandPose::HindStretch makes, and
		 *  it exists here for the same reason -- without it the body floats
		 *  above its own legs. */
		float LegStretch = 1.0f;
	};

	/**
	 * @param Blend       0 quadruped .. 1 fully standing.
	 * @param LegLength   hip-to-paw at rest, uu. Everything scales off it, so a
	 *                    Dog of any size stands by the same proportions.
	 * @param TorsoLength nose-to-tail body length at rest, uu.
	 */
	FStandingPose StandingPose(float Blend, float LegLength, float TorsoLength);

	/** ONE STANDING LEG THROUGH ONE STRIDE.
	 *
	 *  Same contract as WonderlandGait::FLegPose, and deliberately so: Forward
	 *  is along the facing axis, Lift is above the resting foot height, and
	 *  bStance means PLANTED -- which means its world position must not change
	 *  by any amount at all. */
	struct FStepPose
	{
		float Forward = 0.0f;
		float Lift = 0.0f;
		bool bStance = true;
	};

	FStepPose StepPose(float StridePhase, float StrideLength, float LiftHeight,
	                   float DutyFactor = WalkDutyFactor);

	/** Where that foot is in WORLD terms along the travel axis. Constant
	 *  through stance is the entire point, and the test asserts exactly it. */
	float WorldFootForward(float DistanceTravelled, float LegOffset,
	                       float StrideLength, float LiftHeight);

	/** HOW A RIGID BLOCKY LEG IS CARRIED so the foot reaches StepPose's target.
	 *
	 *  Identical reasoning to WonderlandGait::LegSwing: translating the limb
	 *  puts the foot in the right place and still reads as a box on a rail,
	 *  because nothing pivots. Swinging a rigid limb from the hip traces an
	 *  arc, so it falls short of the ground; the limb stretches by the small
	 *  amount the arc is short by -- a few percent, invisible on a blocky leg,
	 *  and it keeps foot lock EXACT rather than approximate. */
	struct FLimbSwing
	{
		float PitchDeg = 0.0f;
		float Stretch = 1.0f;
	};

	FLimbSwing LimbSwing(const FStepPose& Pose, float LegLength);

	/** THE BODY, WHICH IS WHERE "NOT A BLOCK" IS WON OR LOST.
	 *
	 *  A biped whose pelvis, torso and head hold still while the legs cycle is
	 *  exactly the Minecraft read the founder is describing. Real bipedal
	 *  walking moves the body on three separate rhythms and they are not the
	 *  same frequency, which is what stops it looking mechanical:
	 *
	 *    RISE   twice per stride -- the pelvis is highest over each planted
	 *           leg and lowest at double support.
	 *    SWAY   ONCE per stride -- the mass shifts laterally over whichever
	 *           foot is carrying it. This is the weight shift, and its being at
	 *           half the frequency of the rise is most of why walking reads as
	 *           alive rather than as bouncing.
	 *    ROLL   once per stride, following the sway -- the pelvis drops a
	 *           little on the UNSUPPORTED side (a real Trendelenburg drop).
	 *
	 *  The torso counter-rotates against the pelvis, and the head counters
	 *  BOTH, because a walking animal holds its gaze steady while its hips do
	 *  whatever they like. Those two counter-motions are the difference between
	 *  a character that walks and a doll being carried along. */
	struct FCarriage
	{
		/** Vertical rise of the pelvis, uu. Two peaks per stride. */
		float PelvisRise = 0.0f;
		/** Lateral shift of the pelvis, uu. One peak per stride. */
		float PelvisSway = 0.0f;
		/** Pelvis roll, degrees; drops toward the unsupported side. */
		float PelvisRollDeg = 0.0f;
		/** Pelvis yaw, degrees -- the hips rotate with the leading leg. */
		float PelvisYawDeg = 0.0f;
		/** Torso yaw, degrees. OPPOSITE the pelvis: the shoulders and hips
		 *  counter-rotate about the spine on every step. */
		float TorsoYawDeg = 0.0f;
		/** Torso roll, degrees, partially cancelling the pelvis roll. */
		float TorsoRollDeg = 0.0f;
		/** Head offsets that hold the gaze steady against the body. */
		float HeadRise = 0.0f;
		float HeadYawDeg = 0.0f;
		float HeadRollDeg = 0.0f;
	};

	/**
	 * @param StridePhase  distance travelled / stride length. Only the
	 *                     fraction matters.
	 * @param RiseHeight   peak pelvis rise, uu.
	 * @param SwayWidth    peak lateral shift, uu.
	 */
	FCarriage Carriage(float StridePhase, float RiseHeight, float SwayWidth);

	/** ARM SWING, contralateral and TRAILING.
	 *
	 *  Two details decide whether this reads as walking or as marching.
	 *
	 *  CONTRALATERAL: the left arm swings with the RIGHT leg. Getting this
	 *  backwards produces the unmistakable gait of someone concentrating on not
	 *  falling over, and it is a sign error away at all times.
	 *
	 *  TRAILING: the arm does not reach its extreme at the same instant the leg
	 *  does. Limbs have mass and joints have compliance, so the arm lags by a
	 *  small fraction of the cycle. That lag is most of what separates
	 *  "animated" from "keyframed by hand", and it costs one constant.
	 *
	 *  The amplitude scales with speed because a strolling animal barely swings
	 *  its arms and a running one throws them.
	 *
	 * @param StridePhase  the LEG's phase for the leg on the SAME side.
	 * @param Amplitude    peak swing, degrees, at this speed.
	 */
	struct FArmSwing
	{
		/** Degrees about the lateral axis; positive carries the paw FORWARD. */
		float PitchDeg = 0.0f;
		/** Degrees away from the body -- arms clear the hips at the extremes. */
		float OutDeg = 0.0f;
	};

	FArmSwing ArmSwing(float StridePhase, float Amplitude);

	/** Peak arm swing for a speed, degrees. Zero at a standstill, so an idle
	 *  Dog's arms hang rather than waving. */
	float ArmAmplitudeFor(float SpeedUU, float LegLength);

	/** IDLE, WHICH IS NOT STILLNESS.
	 *
	 *  A standing character that holds one exact pose is dead on the screen,
	 *  and the eye reads it as a prop within about a second. A breathing
	 *  rhythm, a slight sway and a rare weight change are what make a standing
	 *  figure look inhabited.
	 *
	 *  BREATH IS AMBIENT LIFE, NEVER STATE -- the founder's rule for the Dogs.
	 *  Nothing here reads or reports what Relay is doing; it is the same
	 *  amplitude whatever the Dog is working on.
	 *
	 * @param Seconds  wall time. Idle is the one thing correctly driven by a
	 *                 clock: it is not locked to travel because there is none.
	 */
	struct FIdleSway
	{
		float Breath = 0.0f;      // torso rise, uu
		float SwayDeg = 0.0f;     // slow lateral roll, degrees
		float HeadYawDeg = 0.0f;  // an occasional glance
	};

	FIdleSway IdleSway(float Seconds, float LegLength);

	/** Ease toward a target frame-rate-independently, by HALF-LIFE.
	 *
	 *  Every transition in this file goes through here -- stance blends, speed
	 *  changes, turns. `Current += Rate * Dt` is the standard way to make a
	 *  transition that behaves differently at 20 fps and 60, and this world is
	 *  streamed at a frame rate that moves. Snapping is a discontinuity, and a
	 *  discontinuity is what this function exists to make impossible. */
	float Approach(float Current, float Target, float DeltaSeconds,
	               float HalfLifeSeconds = 0.18f);

	/** Ease an ANGLE the short way round, in degrees.
	 *
	 *  Turning is where a character snaps. Approach() on a raw heading walks
	 *  the long way round whenever the target crosses +/-180 -- a Dog asked to
	 *  turn 10 degrees spins 350 the other way. Wrapping first is the whole
	 *  fix, and it is one line that is very easy not to write. */
	float ApproachAngleDeg(float CurrentDeg, float TargetDeg, float DeltaSeconds,
	                       float HalfLifeSeconds = 0.18f);

	/** Wrap an angle to (-180, 180]. */
	float WrapDeg(float Deg);
}
