// THE CANONICAL RELAY DOG'S LOCOMOTION — as arithmetic, with no engine in it.
//
// WHY THIS IS A SEPARATE, ENGINE-FREE FILE (the same reason WonderlandDogGait is)
//
// Every property that decides whether this reads as a body moving — foot lock,
// the shape of the stride, whether a transition snaps, whether the arms go back
// only when they should — is a claim about numbers. Claims about numbers can be
// proven with g++ on a laptop in a second. The alternative is renting a GPU,
// cooking a level and squinting at a stream, which is how this project has
// previously "verified" motion and how it previously shipped a Dog whose paws
// skated. So the whole model lives here in plain floats, and
// wonderland/tests/cpp/RelayDogStride.test.cpp holds it to its promises.
//
// WHY NOT WonderlandGait
//
// That file is proven and stays untouched: it is a QUADRUPED's gait, with four
// legs in a lateral sequence and a deliberate refusal to add a knee, because
// the V1 Dog's identity had none. The V2 canonical Relay Dog is a different
// body plan — upright, bipedal, arms at the sides, and (as of the seams in
// dog_canon.py) real elbows and knees. Its gait is therefore its own arithmetic.
// What it does NOT re-derive is the one thing both bodies share: a planted foot
// must not move in world space, and the way to guarantee that is to drive the
// stride from DISTANCE TRAVELLED rather than from a clock. A gait advanced by
// time drifts out of step with the body the instant speed changes — that is
// the "movement speed and animation speed disagree" failure, by construction.
//
// WHERE THE NUMBERS COME FROM
//
// The founder's reference for personality is the REAL landing-page Dog:
// src/relay/ui/landing/three/dog-rig.ts in the product repo at f91c1d4, driven
// by choreography.ts, whose beat 8 asks for {IDLE, facing the viewer, tracking
// the pointer}. That rig's mechanisms are ported here on purpose, with their
// values: critically-damped springs for every continuous quantity (frame-rate
// independent, no overshoot), a SHAPED gait phase so stance outlasts swing, and
// an ADDITIVE look layer so the head can watch something while the body walks.
// Ported, not reinvented — a second Dog with a second personality would be a
// different character, and the founder's rule is that there is one.
//
// The gait thresholds are Froude numbers, Fr = v^2 / (g*h), from the LEG length
// rather than hard-coded uu/s: the canonical Dog stands 2.9025 head-widths tall
// on legs 0.8 of one, so a Dog built at any scale breaks into a jog at the speed
// that looks right for its size with no per-Dog tuning.
#pragma once

namespace RelayDogStride
{
	/** Gravity in Unreal units per second squared (981 uu/s^2 = 9.81 m/s^2). */
	inline constexpr float GravityUU = 981.0f;

	/** What the body is doing. Continuous blending happens between neighbours;
	 *  the enum names the band, it never selects a clip. */
	enum class EGait : int
	{
		Idle = 0,
		Walk = 1,
		Jog = 2,
		Run = 3,
		/** The founder's anime/ninja run: strong forward lean, BOTH arms
		 *  trailing back, fast leg cycle. A POSTURE at the top of the speed
		 *  range, not a separate character. */
		AnimeRun = 4,
	};

	const char* GaitName(EGait Gait);

	/** Froude thresholds (dimensionless), walk->jog->run->anime run. */
	inline constexpr float FroudeJog = 0.50f;
	inline constexpr float FroudeRun = 1.50f;
	inline constexpr float FroudeAnime = 3.00f;

	/** Speed, in uu/s, at which a Dog with this leg length hits a Froude number.
	 *  v = sqrt(Fr * g * h). */
	float SpeedForFroude(float Froude, float LegLengthUU);

	/** How the stride is shaped at a given ground speed. Everything here is a
	 *  continuous function of speed except the enum, so nothing pops at a
	 *  threshold: the duty factor falls, the stride lengthens, the lean grows
	 *  and the arms swing back in proportion, all smoothly. */
	struct FStride
	{
		EGait Gait = EGait::Idle;
		/** Fraction of the cycle each foot is planted. 0.62 walking, ~0.35 in a
		 *  full run. Above 0.5 both feet overlap on the ground, which is what
		 *  makes a walk read as unhurried; below it there is a flight phase. */
		float DutyFactor = 0.62f;
		/** Distance the body travels in one full cycle (two steps), uu. */
		float StrideLength = 0.0f;
		/** Peak foot lift during swing, uu. */
		float LiftHeight = 0.0f;
		/** Vertical travel of the pelvis over a cycle, uu. */
		float BobHeight = 0.0f;
		/** How high the hip rides above the sole WHILE MOVING, uu.
		 *
		 *  The canonical Dog is drawn with a straight leg: thigh + shin is
		 *  exactly the hip height, so a standing Dog's knee is locked. A leg
		 *  that is already at full extension cannot reach forward at all —
		 *  every stride target off the vertical is further away than the leg
		 *  is long. Bodies solve this by riding slightly lower when they move,
		 *  and the faster they go the lower they ride. So does this: the hip
		 *  drops a few percent to walk and further to run, which is what buys
		 *  the stride its reach and what makes the knee bend at all. The drop
		 *  is applied to the pelvis by the animator, so the feet still meet
		 *  the ground. */
		float HipHeightUU = 0.0f;
		/** Forward lean of the whole body, degrees. Zero standing. */
		float LeanDeg = 0.0f;
		/** 0..1: how much of the arms' behaviour is the anime arms-back posture
		 *  rather than the contralateral swing. Zero below the run band. */
		float ArmsBack = 0.0f;
		/** 0..1 within the current band; diagnostics only. */
		float Blend = 0.0f;
	};

	/** @param SpeedUU     ground speed, uu/s.
	 *  @param LegLengthUU hip-to-ground distance at rest, uu (48 at W=60). */
	FStride StrideForSpeed(float SpeedUU, float LegLengthUU);

	/** One foot's contribution, in the body's frame.
	 *
	 *  `Forward` is measured against the body: during stance it moves BACKWARD
	 *  at exactly the speed the body moves forward, which is what pins the foot
	 *  in world space. That identity — world position constant through stance —
	 *  is the property the test asserts, and it is why nothing here takes a
	 *  clock. */
	struct FFootPose
	{
		float Forward = 0.0f;
		float Lift = 0.0f;
		bool bStance = true;
	};

	/** @param StridePhase  distance travelled / stride length, plus this foot's
	 *                      half-cycle offset. Only the fraction matters. */
	FFootPose FootPose(float StridePhase, float StrideLength, float LiftHeight, float DutyFactor);

	/** Where that foot is along the travel axis in WORLD terms. Constant while
	 *  planted; the test asserts exactly that, at several speeds. */
	float WorldFootForward(float DistanceTravelled, float FootOffset,
	                       float StrideLength, float LiftHeight, float DutyFactor);

	/** A leg carried so its foot reaches FootPose's target.
	 *
	 *  Unlike the V1 quadruped this Dog HAS a knee, so the leg does not have to
	 *  stretch to make the arc reach: hip and knee together put the foot where
	 *  the stride says, and the knee bend is what stops a straight block leg
	 *  from reading as a pendulum. Bend is always non-negative — a knee that
	 *  hyperextends is instantly wrong, and a block one is grotesque. */
	struct FLegPose
	{
		/** Degrees about the lateral axis at the hip. Positive swings forward. */
		float HipDeg = 0.0f;
		/** Degrees at the knee. Positive folds the shin BACKWARD (heel up). */
		float KneeDeg = 0.0f;
	};

	/** @param ThighUU  hip to knee, uu.  @param ShinUU  knee to sole, uu.
	 *  @param HipHeightUU  how far the hip rides above the sole right now. */
	FLegPose LegPose(const FFootPose& Foot, float ThighUU, float ShinUU, float HipHeightUU);

	/** Ease a foot onto the ground under it.
	 *
	 *  The rules are the V1 gait's, and they are right for the same reasons:
	 *  ONLY A PLANTED FOOT is placed (gluing a swinging foot to the terrain
	 *  cancels the swing and the Dog shuffles), only VERTICALLY (moving it
	 *  sideways would fight the foot lock everything rests on), CLAMPED so one
	 *  bad trace cannot stretch a leg to the horizon, and eased by HALF-LIFE so
	 *  it behaves the same at 20 fps and at 60. What is new is that it lives
	 *  here rather than in the actor, so a staircase can be walked up in a test
	 *  on a laptop instead of judged from a stream.
	 *
	 *  @param CurrentOffset  what was applied last frame, uu.
	 *  @param GroundDelta    traced ground minus the foot's height, uu.
	 *  @param bStance        is the foot planted right now.
	 *  @param MaxOffset      furthest a foot may be moved, uu. */
	float FootGroundOffset(float CurrentOffset, float GroundDelta, bool bStance,
	                       float MaxOffset, float DeltaSeconds, float HalfLifeSeconds = 0.09f);

	/** The furthest a foot may be placed either side of the hip, given how high
	 *  the hip is riding: the leg is a rigid pair of blocks and cannot reach
	 *  past its own length. Used to CAP the stride, so no pose is ever asked
	 *  for that the canonical proportions cannot make. */
	float ReachHalfSpan(float LegLengthUU, float HipHeightUU);

	/** One arm. Shoulder and elbow, in degrees, about the lateral axis. */
	struct FArmPose
	{
		float ShoulderDeg = 0.0f;
		/** Positive folds the forearm FORWARD/up, the way an elbow bends. */
		float ElbowDeg = 0.0f;
		/** Degrees the shoulder is swept outward, away from the torso. Only
		 *  the arms-back posture uses it, so the blocks clear the hips. */
		float ShoulderYawDeg = 0.0f;
	};

	/** Contralateral swing blended toward the anime arms-back posture.
	 *  @param Phase     the same stride phase the legs use (arms oppose them).
	 *  @param bLeft     which arm.
	 *  @param GaitWeight 0..1 how much locomotion is happening at all.
	 *  @param ArmsBack   0..1 from FStride. */
	FArmPose ArmPose(float StridePhase, bool bLeft, float GaitWeight, float ArmsBack);

	/** The pelvis's carriage for a stride phase: bob (twice per cycle, once per
	 *  footfall), lateral sway (once, onto the stance foot) and the roll that
	 *  goes with it. */
	struct FBodyPose
	{
		float BobUU = 0.0f;
		float SwayUU = 0.0f;
		float RollDeg = 0.0f;
		float PitchDeg = 0.0f;
	};

	FBodyPose BodyPose(float StridePhase, const FStride& Stride);

	// ---------------------------------------------------------------- springs
	//
	// Ported from dog-rig.ts, including the Padé approximation, so the Unreal
	// Dog and the landing Dog ease identically. A critically-damped spring has
	// no overshoot and is frame-rate independent; `lerp(a, b, 0.1)` per frame is
	// neither, and is the usual reason a scene "feels different on the good
	// monitor".

	struct FSpring
	{
		float Value = 0.0f;
		float Velocity = 0.0f;
	};

	/** One step toward Target. SmoothTime is roughly the time to converge. */
	void SpringStep(FSpring& State, float Target, float SmoothTime, float DeltaSeconds);

	/** Shortest signed angular difference in DEGREES, so a turn never takes the
	 *  long way round. */
	float ShortestAngleDeg(float FromDeg, float ToDeg);

	/** Reshape a linear 0..1 phase so stance occupies `Bias` of the cycle.
	 *  A pure sine spends exactly half the cycle in each and reads as a
	 *  wind-up toy; this single function is most of the difference between
	 *  walking and marching. */
	float ShapePhase(float Phase, float Bias);

	// ------------------------------------------------------------- idle life
	//
	// THE FOUNDER'S REFERENCE IS BEAT 8 OF THE LANDING. The Dog stands facing
	// the viewer and is never still: an idle layer of three incommensurate
	// frequencies (so the loop cannot be heard), plus a HEAD that behaves like
	// an intelligent observer — restrained glances, variable dwell, an
	// occasional look up or down, and a smooth return toward centre.
	//
	// There is no pointer in Unreal, so what the landing gets from the mouse is
	// produced here by an interest scheduler: it picks a direction to attend to,
	// holds it for an unpredictable but bounded time, and returns. The
	// SCHEDULER IS SEPARATE FROM THE AIM so a runtime look-target (the camera, a
	// participant, another Dog, a combat cue later) can override the choice
	// without touching the easing — the layered BASE IDLE + LOOK TARGET + STATE
	// OVERRIDE architecture the founder asked for.

	/** The head's comfortable cone, degrees. Beyond this a companion reads as a
	 *  security camera; the landing rig uses 0.22 rad / 0.09 rad and this is
	 *  the same angle in degrees, with the up/down look allowed slightly more. */
	inline constexpr float HeadYawLimitDeg = 12.6f;
	inline constexpr float HeadPitchLimitDeg = 7.5f;

	/** Body micro-motion while standing. Amplitudes are deliberately tiny: the
	 *  founder's rule is weight/torso/arm/tail SETTLING, never a breathing bob
	 *  or a pulse. */
	struct FIdlePose
	{
		float SwayUU = 0.0f;
		float RollDeg = 0.0f;
		float HeadYawDeg = 0.0f;
		float HeadPitchDeg = 0.0f;
		float ArmLeftDeg = 0.0f;
		float ArmRightDeg = 0.0f;
		float TailYawDeg = 0.0f;
		float TailPitchDeg = 0.0f;
	};

	/** @param TimeSeconds  the actor's own elapsed time.
	 *  @param Weight       1 standing, 0 at full stride. */
	FIdlePose IdlePose(float TimeSeconds, float Weight, float ScaleUU);

	/** Where the head would like to be aimed, and for how long. */
	struct FGlance
	{
		float YawDeg = 0.0f;
		float PitchDeg = 0.0f;
		/** Seconds remaining on this glance. */
		float HoldSeconds = 0.0f;
		/** True while the Dog is deliberately looking at something rather than
		 *  resting near centre. Diagnostics and, later, a hook for state. */
		bool bAttending = false;
	};

	/** The interest scheduler.
	 *
	 *  DETERMINISTIC GIVEN A SEED, so the test can prove what a stream cannot:
	 *  that no two consecutive glances are the same, that the dwell varies, that
	 *  the Dog returns near centre between glances rather than ratcheting away,
	 *  and that every angle stays inside the cone. A mechanical loop is the
	 *  failure the founder named, and a fixed interval is exactly that.
	 */
	class FInterest
	{
	public:
		explicit FInterest(unsigned Seed = 0x5eed1234u) : Rng(Seed ? Seed : 1u) {}

		/** Advance by DeltaSeconds and return the current desired aim. */
		FGlance Update(float DeltaSeconds);

		/** Force the next decision immediately — used when a runtime look
		 *  target appears or a state override ends. */
		void Interrupt() { Remaining = 0.0f; }

	private:
		float NextFloat();

		unsigned Rng;
		FGlance Current;
		float Remaining = 0.0f;
		/** Glances alternate with rests, so the head keeps coming back. */
		bool bResting = true;
		float LastSide = 1.0f;
	};

	// ------------------------------------------------------- the whole animal
	//
	// One object that owns the phase, the springs and the interest scheduler,
	// takes (dt, speed, heading, ground) and returns every angle the Dog needs.
	// The Unreal actor's job is then only to read velocity and write transforms,
	// which is the part that cannot be tested without an engine.

	struct FDogPose
	{
		FStride Stride;
		float GaitWeight = 0.0f;
		float SpeedUU = 0.0f;
		float StridePhase = 0.0f;

		FBodyPose Body;
		float LeanDeg = 0.0f;
		/** Body roll INTO a turn, degrees; momentum, not steering. */
		float TurnRollDeg = 0.0f;

		FLegPose LegLeft, LegRight;
		/** How far the pelvis is lowered from its standing height, uu.
		 *  Positive is down. Blended by gait weight, so a standing Dog is at
		 *  its canonical height and a running one rides lower. */
		float PelvisDropUU = 0.0f;
		FArmPose ArmLeft, ArmRight;

		float HeadYawDeg = 0.0f;
		float HeadPitchDeg = 0.0f;
		float TailYawDeg = 0.0f;
		float TailPitchDeg = 0.0f;

		float SwayUU = 0.0f;
		float BobUU = 0.0f;

		/** The eased vertical correction actually applied to each foot, uu. */
		float FootOffsetLeft = 0.0f;
		float FootOffsetRight = 0.0f;
		/** Where each foot is in the stride right now, so the caller can trace
		 *  under the place the foot is about to be put rather than where it
		 *  was last frame. */
		FFootPose FootLeft;
		FFootPose FootRight;
	};

	/** Everything the actor measures each frame. */
	struct FDogInput
	{
		float DeltaSeconds = 0.0f;
		/** Ground speed, uu/s. */
		float SpeedUU = 0.0f;
		/** Distance travelled this frame along the ground, uu. Drives the
		 *  phase; the actor passes the real thing so a Dog blocked by a wall
		 *  stops striding instead of running on the spot. */
		float DistanceUU = 0.0f;
		/** Yaw the body is facing, degrees, and the yaw it wants. */
		float HeadingDeg = 0.0f;
		float DesiredHeadingDeg = 0.0f;
		/** Traced ground height minus the height that foot would otherwise be
		 *  planted at, uu. Positive means the ground is ABOVE the foot — a step
		 *  up. The TRACE needs an engine; what to do with it does not, so the
		 *  easing lives here where it can be proven on stairs without one. */
		float GroundDeltaLeft = 0.0f;
		float GroundDeltaRight = 0.0f;

		/** Optional runtime look target, degrees relative to the body. When
		 *  bHasLookTarget is false the interest scheduler chooses. */
		bool bHasLookTarget = false;
		float LookYawDeg = 0.0f;
		float LookPitchDeg = 0.0f;
	};

	class FDogAnimator
	{
	public:
		FDogAnimator() = default;

		/** @param LegLengthUU hip height, @param ThighUU / @param ShinUU the
		 *  two segments, @param ScaleUU the Dog's head width in uu (the canon's
		 *  unit) so amplitudes scale with the body. */
		void Configure(float InLegLengthUU, float InThighUU, float InShinUU, float InScaleUU);

		const FDogPose& Update(const FDogInput& In);

		const FDogPose& Pose() const { return Current; }
		float DistanceTravelled() const { return Distance; }

	private:
		float LegLengthUU = 48.0f;
		float ThighUU = 24.0f;
		float ShinUU = 24.0f;
		float ScaleUU = 60.0f;

		FDogPose Current;
		FInterest Interest;
		FSpring GaitBlend, HeadYaw, HeadPitch, Lean, TurnRoll, SpeedFilter;
		float FootOffsetLeft = 0.0f;
		float FootOffsetRight = 0.0f;
		float Distance = 0.0f;
		float Phase = 0.0f;
		float Elapsed = 0.0f;
	};
}
