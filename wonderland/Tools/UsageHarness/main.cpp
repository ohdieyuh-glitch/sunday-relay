// THE USAGE SUBSYSTEM, COMPILED AND RUN.
//
// There is no Unreal Engine here, so the usual answer would be an editor
// automation test nobody in this repository can execute. Instead this builds
// the REAL subsystem against the syntax stubs and drives it through the
// sequences a live world actually sees: a reconnect delivering an old reading,
// a fan-out delivering somebody else's, a link dropping mid-mission.
//
// WHAT IT PROVES: the ordering rules and the held state. Every claim in
// WonderlandUsageSubsystem.h's header comment is asserted below by exercising
// the code, not by reading it.
//
// WHAT IT CANNOT PROVE: that a widget draws. That needs the engine. The two
// are different claims and this harness only makes the first.

#include "WonderlandUsageSubsystem.h"
#include "WonderlandUsageGeometry.h"

#include <cmath>

#include <cstdio>
#include <string>

static int Failures = 0;
static int Checks = 0;

static void Check(bool Condition, const char* What)
{
	++Checks;
	if (Condition)
	{
		return;
	}
	++Failures;
	std::printf("FAIL %s\n", What);
}

/** An authority status shaped like one Relay would actually project. */
static FWonderlandUsageAuthorityStatus Report(int64 Revision, EWonderlandUsageReading Reading)
{
	FWonderlandUsageAuthorityStatus Status;
	Status.Revision = Revision;
	Status.Reading = Reading;
	return Status;
}

/** A HUD carrying one recognisable figure, so a swap is visible. */
static FWonderlandUsageHud Hud(double CompoundRemaining)
{
	FWonderlandUsageHud Out;
	Out.CompoundAgent.Status = EWonderlandUsageStatus::Available;
	Out.CompoundAgent.RemainingUnits.bKnown = true;
	Out.CompoundAgent.RemainingUnits.Value = CompoundRemaining;
	return Out;
}

static double HeldRemaining(const UWonderlandUsageSubsystem& Subsystem)
{
	return Subsystem.GetUsage().CompoundAgent.RemainingUnits.Value;
}

/* ------------------------------------------------- the draw plan mirror */

/** A meter built from figures directly, the way a fixture or a replay would. */
static FWonderlandUsageMeter Meter(bool bSpanKnown, double Span, bool bLeftKnown, double Left)
{
	FWonderlandUsageMeter M;
	M.CapacitySpan.bKnown = bSpanKnown;
	M.CapacitySpan.Value = Span;
	M.RemainingFraction.bKnown = bLeftKnown;
	M.RemainingFraction.Value = Left;
	return M;
}

static bool Near(float A, float B)
{
	return std::fabs(A - B) < 1e-5f;
}

static void CheckDrawPlan()
{
	// THE SAME CASES THE TYPESCRIPT IS HELD TO, run against the C++ mirror.
	// wonderland-usage-meter.test.ts proves the contract; this proves the port
	// agrees with it, which is the only way the two surfaces can be said to draw
	// the same HUD.

	// Dynamic values, not a hardcoded percentage.
	for (int32 Step = 0; Step <= 4; ++Step)
	{
		const float Left = static_cast<float>(Step) / 4.f;
		const FWonderlandMeterDrawPlan P = WonderlandMeterDrawPlan(Meter(true, 1.0, true, Left));
		Check(Near(P.RemainderOfTrack, Left), "the plan carries the reading it was given");
		Check(Near(P.RemainderFraction, Left), "a full track makes remainder and arc the same");
	}

	// Clamping, so a renderer never walks past the end of its own curve.
	{
		const FWonderlandMeterDrawPlan P = WonderlandMeterDrawPlan(Meter(true, 1.8, true, -0.4));
		Check(Near(P.TrackFraction, 1.f), "an over-range span clamps to the whole shape");
		Check(Near(P.RemainderOfTrack, 0.f), "a negative remainder clamps to nothing");
		Check(P.HeadStartFraction >= 0.f, "and the head cannot start before the tail");
	}

	// A non-finite reading must not become geometry.
	{
		const FWonderlandMeterDrawPlan P =
			WonderlandMeterDrawPlan(Meter(true, NAN, true, INFINITY));
		Check(std::isfinite(P.TrackFraction), "a NaN span does not reach the renderer");
		Check(std::isfinite(P.RemainderFraction), "an infinite remainder does not either");
		Check(Near(P.TrackFraction, 0.f), "a NaN span draws nothing rather than everything");
	}

	// Zero capacity.
	{
		const FWonderlandMeterDrawPlan P = WonderlandMeterDrawPlan(Meter(true, 0.0, true, 0.0));
		Check(Near(P.TrackFraction, 0.f), "zero capacity is a zero-length track");
		Check(!P.bTrackVisible, "and it is not drawn");
		Check(!P.bRemainderVisible, "nor is a remainder of it");
		Check(!P.bHeadVisible, "nor a highlight over that");
	}

	// Full capacity.
	{
		const FWonderlandMeterDrawPlan P = WonderlandMeterDrawPlan(Meter(true, 1.0, true, 1.0));
		Check(Near(P.TrackFraction, 1.f), "full capacity is the whole track");
		Check(P.bTrackVisible && P.bRemainderVisible, "and it is drawn, remainder and all");
		Check(Near(P.RemainderFraction, 1.f), "with the remainder filling it");
	}

	// A BIGGER TIER IS A LONGER TRACK, which is the founder's requirement that
	// higher tiers visibly increase physical capacity.
	{
		const FWonderlandMeterDrawPlan Small = WonderlandMeterDrawPlan(Meter(true, 0.25, true, 1.0));
		const FWonderlandMeterDrawPlan Large = WonderlandMeterDrawPlan(Meter(true, 1.00, true, 1.0));
		Check(Large.TrackFraction > Small.TrackFraction, "a bigger tier draws a longer track");
		Check(Near(Small.RemainderOfTrack, 1.f) && Near(Large.RemainderOfTrack, 1.f),
			"and both untouched tiers are FULL, so the difference read is length");
		Check(Large.RemainderFraction > Small.RemainderFraction,
			"so the bigger tier's remainder covers more of the shape");
	}

	// Unknown capacity draws the frame and never a remainder.
	{
		const FWonderlandMeterDrawPlan P = WonderlandMeterDrawPlan(Meter(false, 0.0, false, 0.0));
		Check(Near(P.TrackFraction, 1.f), "an unreported capacity still draws its frame");
		Check(P.bTrackVisible, "because a missing frame reads as a broken HUD");
		Check(!P.bRemainderKnown && !P.bRemainderVisible,
			"but it never claims a remainder nobody reported");
	}

	// A reported zero and silence are different facts that draw the same thing.
	{
		const FWonderlandMeterDrawPlan Spent = WonderlandMeterDrawPlan(Meter(true, 1.0, true, 0.0));
		const FWonderlandMeterDrawPlan Silent = WonderlandMeterDrawPlan(Meter(true, 1.0, false, 0.0));
		Check(Spent.bRemainderKnown, "a spent meter reported its zero");
		Check(!Silent.bRemainderKnown, "a silent one reported nothing");
		Check(!Spent.bRemainderVisible && !Silent.bRemainderVisible,
			"and both draw nothing, which is why the flag has to exist");
	}

	// A speck is drawn as nothing.
	{
		const FWonderlandMeterDrawPlan P = WonderlandMeterDrawPlan(Meter(true, 1.0, true, 0.000002));
		Check(P.bRemainderKnown && P.RemainderFraction > 0.f, "the speck was reported");
		Check(!P.bRemainderVisible, "and is still too short to draw as a shape");
	}

	// The highlight stays inside the remainder it highlights.
	{
		const float Readings[] = {0.f, 0.01f, 0.5f, 0.97f, 1.f};
		for (const float Left : Readings)
		{
			const FWonderlandMeterDrawPlan P = WonderlandMeterDrawPlan(Meter(true, 1.0, true, Left));
			Check(P.HeadStartFraction >= 0.f, "the head never starts before the tail");
			Check(Near(P.HeadEndFraction, P.RemainderFraction), "the head ends at the remainder");
			Check(P.HeadStartFraction <= P.HeadEndFraction, "and never runs backwards");
			Check(P.HeadEndFraction <= P.TrackFraction, "nor past the track");
		}
	}

	// The highlight scales with the track, so a short tier is not all highlight.
	{
		const FWonderlandMeterDrawPlan Short = WonderlandMeterDrawPlan(Meter(true, 0.10, true, 1.0));
		const FWonderlandMeterDrawPlan Long = WonderlandMeterDrawPlan(Meter(true, 1.00, true, 1.0));
		Check(Short.HeadEndFraction - Short.HeadStartFraction <
				Long.HeadEndFraction - Long.HeadStartFraction,
			"a short track gets a proportionally short highlight");
		Check(Near(Long.HeadEndFraction - Long.HeadStartFraction, WonderlandMeterHeadArc),
			"and a full track gets exactly the contract's head arc");
	}
}

/* --------------------------------------------------- the ribbon strip */

static void CheckRibbonStrip()
{
	const FWonderlandSwooshSampler Sampler(WonderlandCompoundSwoosh());
	TArray<FVector2D> Strip;

	WonderlandSwooshRibbonStrip(Sampler, 0.f, 1.f, 16, Strip);
	Check(Strip.Num() == 32, "the strip emits two points per step");

	// THE STRIP AND THE SPINE ARE THE SAME CURVE. Every pair straddles the
	// sample it came from, at exactly the contract's half-width, perpendicular
	// to the tangent. A renderer drawing this is drawing the frozen shape.
	bool bStraddles = true;
	bool bPerpendicular = true;
	bool bWidthMatches = true;
	for (int32 Step = 0; Step < 16; ++Step)
	{
		const float T = static_cast<float>(Step) / 15.f;
		const FWonderlandSwooshSample Point = Sampler.Sample(T);
		const FVector2D& Left = Strip[Step * 2];
		const FVector2D& Right = Strip[Step * 2 + 1];

		const double MidX = (Left.X + Right.X) * 0.5;
		const double MidY = (Left.Y + Right.Y) * 0.5;
		if (std::fabs(MidX - Point.X) > 1e-5 || std::fabs(MidY - Point.Y) > 1e-5)
		{
			bStraddles = false;
		}

		const double SpanX = Left.X - Right.X;
		const double SpanY = Left.Y - Right.Y;
		if (std::fabs(SpanX * Point.TangentX + SpanY * Point.TangentY) > 1e-5)
		{
			bPerpendicular = false;
		}
		if (std::fabs(std::sqrt(SpanX * SpanX + SpanY * SpanY) - 2.0 * Point.HalfWidth) > 1e-5)
		{
			bWidthMatches = false;
		}
	}
	Check(bStraddles, "every strip pair straddles the spine sample it came from");
	Check(bPerpendicular, "and sits square to the tangent there");
	Check(bWidthMatches, "and spans exactly the contract's width at that point");

	// A BAND RATHER THAN A PREFIX, which is what the leading highlight needs.
	TArray<FVector2D> Band;
	WonderlandSwooshRibbonStrip(Sampler, 0.6f, 0.7f, 8, Band);
	Check(Band.Num() == 16, "a band emits the same two points per step");
	const FWonderlandSwooshSample BandStart = Sampler.Sample(0.6f);
	Check(std::fabs((Band[0].X + Band[1].X) * 0.5 - BandStart.X) < 1e-5,
		"and starts where it was asked to, not at the tail");

	// THE OUTLINE AND THE STRIP MUST DESCRIBE THE SAME RIBBON.
	//
	// Two ways to draw one shape — a closed polygon for a filled path, a vertex
	// strip for Slate — and until this check existed only one of them was
	// exercised. A normal flipped in the outline alone would have produced a
	// browser-shaped fill and a world-shaped strip that no test compared, so the
	// two are held against each other rather than each against itself.
	TArray<FVector2D> Outline;
	TArray<FVector2D> Whole;
	WonderlandSwooshOutline(Sampler, 1.f, 12, Outline);
	WonderlandSwooshRibbonStrip(Sampler, 0.f, 1.f, 12, Whole);
	Check(Outline.Num() == Whole.Num(), "the outline and the strip carry the same point count");
	bool bSameRibbon = Outline.Num() == Whole.Num();
	for (int32 Step = 0; bSameRibbon && Step < 12; ++Step)
	{
		// The outline walks one edge out and the other back; the strip pairs
		// them. Same points, two orderings.
		const FVector2D& OutEdge = Outline[Step];
		const FVector2D& BackEdge = Outline[Outline.Num() - 1 - Step];
		if (std::fabs(OutEdge.X - Whole[Step * 2].X) > 1e-6 ||
			std::fabs(OutEdge.Y - Whole[Step * 2].Y) > 1e-6 ||
			std::fabs(BackEdge.X - Whole[Step * 2 + 1].X) > 1e-6 ||
			std::fabs(BackEdge.Y - Whole[Step * 2 + 1].Y) > 1e-6)
		{
			bSameRibbon = false;
		}
	}
	Check(bSameRibbon, "and they trace the same two edges");

	// NOTHING DRAWS NOTHING, so a caller that paints whatever it is handed is safe.
	TArray<FVector2D> Empty;
	WonderlandSwooshRibbonStrip(Sampler, 0.5f, 0.5f, 8, Empty);
	Check(Empty.Num() == 0, "a zero-length band emits no geometry");
	WonderlandSwooshRibbonStrip(Sampler, 0.8f, 0.2f, 8, Empty);
	Check(Empty.Num() == 0, "a backwards band emits no geometry either");
}

/* -------------------------------------------------------- the bands */

static void CheckBands()
{
	const FWonderlandSwooshSampler Sampler(WonderlandCompoundSwoosh());
	FWonderlandMeterBands Bands;

	// A HALF-SPENT METER ON A HALF-SIZE TIER.
	WonderlandBuildMeterBands(Sampler, Meter(true, 0.5, true, 0.5), 48, Bands);
	Check(Bands.Track.Num() > 0, "a reported meter draws its track");
	Check(Bands.Remainder.Num() > 0, "and its remainder");
	Check(Bands.Head.Num() > 0, "and a highlight at the leading edge");
	Check(Bands.Head.Num() < Bands.Remainder.Num(),
		"the highlight is built from fewer steps than the remainder it caps");

	// AN UNREPORTED CAPACITY DRAWS THE FRAME AND NOTHING ELSE.
	WonderlandBuildMeterBands(Sampler, Meter(false, 0.0, false, 0.0), 48, Bands);
	Check(Bands.Track.Num() > 0, "an unreported meter still draws its frame");
	Check(Bands.Remainder.Num() == 0, "but never a remainder nobody reported");
	Check(Bands.Head.Num() == 0, "nor a highlight over one");

	// A SPENT METER IS A FRAME WITH NOTHING IN IT — and so is silence. The
	// pictures match because both are "nothing left to draw"; the CAPTION
	// differs, which is why the plan carries bRemainderKnown separately.
	WonderlandBuildMeterBands(Sampler, Meter(true, 1.0, true, 0.0), 48, Bands);
	Check(Bands.Track.Num() > 0, "a spent meter still draws its frame");
	Check(Bands.Remainder.Num() == 0, "and draws no remainder, because there is none");

	// A SPECK IS THE CASE THAT SEPARATES `known` FROM `visible`, and it is here
	// because its absence let a real mutation through. Every other reading with
	// nothing to draw also has a zero-length arc, so the ribbon's own guard
	// returns empty whichever flag the builder consults; only a remainder that
	// is REPORTED, POSITIVE and BELOW THE THRESHOLD tells the two apart. Built
	// on `bRemainderKnown` instead of `bRemainderVisible`, this draws a sliver
	// nobody can read as a measurement.
	WonderlandBuildMeterBands(Sampler, Meter(true, 1.0, true, 0.000002), 48, Bands);
	Check(Bands.Track.Num() > 0, "a nearly-spent meter still draws its frame");
	Check(Bands.Remainder.Num() == 0, "and drops a remainder too short to read as a shape");
	Check(Bands.Head.Num() == 0, "and the highlight goes with it");

	// A ZERO-CAPACITY TIER DRAWS NOTHING AT ALL.
	WonderlandBuildMeterBands(Sampler, Meter(true, 0.0, true, 1.0), 48, Bands);
	Check(Bands.Track.Num() == 0, "a zero-capacity tier has no frame to draw");
	Check(Bands.Remainder.Num() == 0, "and nothing inside it either");

	// THE DEFAULT-CONSTRUCTED METER — what a widget built before Relay says
	// anything is handed — must reach the same place as an explicit unknown.
	FWonderlandMeterBands Untold;
	WonderlandBuildMeterBands(Sampler, FWonderlandUsageMeter(), 48, Untold);
	Check(Untold.Track.Num() > 0, "an untold meter draws its frame");
	Check(Untold.Remainder.Num() == 0, "and claims no capacity while it waits");

	// A BIGGER TIER IS PHYSICALLY LONGER ON SCREEN, which is the requirement
	// measured on the geometry rather than asserted about the plan: the track's
	// far end sits further along the curve.
	FWonderlandMeterBands Small, Large;
	WonderlandBuildMeterBands(Sampler, Meter(true, 0.25, true, 1.0), 48, Small);
	WonderlandBuildMeterBands(Sampler, Meter(true, 1.00, true, 1.0), 48, Large);
	const FWonderlandSwooshSample SmallEnd = Sampler.Sample(0.25f);
	const FWonderlandSwooshSample LargeEnd = Sampler.Sample(1.0f);
	const FVector2D& SmallTip = Small.Track[Small.Track.Num() - 2];
	const FVector2D& LargeTip = Large.Track[Large.Track.Num() - 2];
	Check(std::fabs(SmallTip.X - (SmallEnd.X - SmallEnd.TangentY * SmallEnd.HalfWidth)) < 1e-4,
		"the small tier's track ends where its capacity span does");
	Check(std::fabs(LargeTip.X - (LargeEnd.X - LargeEnd.TangentY * LargeEnd.HalfWidth)) < 1e-4,
		"and the large tier's ends at the end of the curve");
	Check(SmallTip.X != LargeTip.X || SmallTip.Y != LargeTip.Y,
		"so two tiers do not end in the same place");
}

/* ------------------------------------------------------ the composition */

static void CheckComposition()
{
	// THE SINGLE AGENT PASSES BEHIND THE COMPOUND ARC, and the widget reads that
	// from the palette rather than choosing it. Asserting the data here is what
	// keeps a renderer from being free to stack them the other way round.
	Check(WonderlandCompoundPalette().Emphasis == 0,
		"the Compound meter is the dominant frame");
	Check(WonderlandSinglePalette().Emphasis > WonderlandCompoundPalette().Emphasis,
		"and the single agent sits behind it");

	// The two curves must actually differ, or "layered and offset" would be one
	// shape drawn twice.
	const FWonderlandSwooshSampler Compound(WonderlandCompoundSwoosh());
	const FWonderlandSwooshSampler Single(WonderlandSingleSwoosh());
	bool bDiffer = false;
	for (int32 Step = 0; Step <= 8; ++Step)
	{
		const float T = static_cast<float>(Step) / 8.f;
		const FWonderlandSwooshSample A = Compound.Sample(T);
		const FWonderlandSwooshSample B = Single.Sample(T);
		if (std::fabs(A.X - B.X) > 1e-3 || std::fabs(A.Y - B.Y) > 1e-3)
		{
			bDiffer = true;
		}
	}
	Check(bDiffer, "the two meters are different curves, not one drawn twice");

	// BOTH ARE CURVED. The founder asked for swooping arcs rather than bars, so
	// a shape that had been flattened to a straight run is a regression: walk
	// each spine and require the tangent to actually turn.
	const FWonderlandSwooshSampler* Shapes[] = {&Compound, &Single};
	const char* Names[] = {
		"the Compound meter is a curve, not a bar",
		"the single-agent meter is a curve, not a bar",
	};
	for (int32 Which = 0; Which < 2; ++Which)
	{
		const FWonderlandSwooshSample Head = Shapes[Which]->Sample(0.f);
		const FWonderlandSwooshSample Tail = Shapes[Which]->Sample(1.f);
		const double Dot = Head.TangentX * Tail.TangentX + Head.TangentY * Tail.TangentY;
		Check(Dot < 0.9, Names[Which]);
	}

	// AND THE PALETTE IS THE APPROVED ONE, not a placeholder. Every default in
	// FWonderlandUsagePalette is magenta precisely so an un-generated palette is
	// unmistakable; a generated one is never magenta.
	const FWonderlandUsagePalette& C = WonderlandCompoundPalette();
	Check(!(C.Accent.R == 1.f && C.Accent.G == 0.f && C.Accent.B == 1.f),
		"the Compound palette was generated, not left at its sentinel");
	Check(C.Accent.G > C.Accent.R && C.Accent.G > C.Accent.B,
		"and the Compound meter is green");
	const FWonderlandUsagePalette& S = WonderlandSinglePalette();
	Check(S.Accent.B > S.Accent.R && S.Accent.B > S.Accent.G,
		"and the single-agent meter is blue");

	// The crop travelled too: a client drawing into the full unit square would
	// put a third of the HUD in empty space.
	Check(WonderlandUsageViewport().Height < 1.0,
		"the viewport crops the unit box rather than drawing all of it");
}

int main()
{
	FSubsystemCollectionBase Collection;

	/* ------------------------------------------------ nothing said yet */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);

		Check(!S.HasUsage(), "a fresh subsystem holds no usage");
		Check(!S.IsBound(), "a fresh subsystem is bound to no project");
		Check(S.GetAppliedRevision() == 0, "a fresh subsystem holds revision 0");

		// UNKNOWN IS NOT ZERO. The default meters must say Unavailable, so a
		// world that has never been told anything cannot render a full or an
		// empty bar as though it were a measurement.
		Check(S.GetUsage().CompoundAgent.Status == EWonderlandUsageStatus::Unavailable,
			"an untold compound meter is Unavailable, not zero");
		Check(S.GetUsage().SingleAgent.Status == EWonderlandUsageStatus::Unavailable,
			"an untold single meter is Unavailable, not zero");
		Check(!S.GetUsage().CompoundAgent.RemainingUnits.bKnown,
			"an untold compound remainder is unknown, not 0");
		Check(S.GetAuthority().Reading == EWonderlandUsageReading::NotReported,
			"an untold authority reads NotReported");
		Check(S.GetLinkStatus().State == EWonderlandLinkState::NeverConnected,
			"an untold link reads NeverConnected");
		Check(!FString(S.GetLinkStatus().Explanation).IsEmpty(),
			"a never-connected link still explains itself");

		// SILENCE ABOUT IDENTITY IS NOT PERMISSION.
		const EWonderlandOrderingVerdict V =
			S.ApplyUsage(FString("alpha"), Hud(100), Report(1, EWonderlandUsageReading::Known));
		Check(V == EWonderlandOrderingVerdict::ForeignProject,
			"an unbound subsystem refuses every push as foreign");
		Check(!S.HasUsage(), "a refused push leaves an unbound subsystem untold");
		Check(S.GetForeignProjectPushesRejected() == 1, "the refusal is counted as foreign");
	}

	/* --------------------------------------------------- the happy path */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		Check(S.IsBound(), "binding names a project");

		Check(S.ApplyUsage(FString("alpha"), Hud(480), Report(1, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Applied,
			"the first real reading applies");
		Check(S.HasUsage(), "an applied reading is held");
		Check(S.GetAppliedRevision() == 1, "the applied revision is recorded");
		Check(HeldRemaining(S) == 480, "the applied figures are the ones held");
		Check(S.GetAppliedPushes() == 1, "the application is counted");

		Check(S.ApplyUsage(FString("alpha"), Hud(300), Report(2, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Applied,
			"a newer reading applies");
		Check(HeldRemaining(S) == 300, "the newer figures replace the older ones");
		Check(S.GetAppliedRevision() == 2, "the revision advances");

		// STATE MOVES WITHOUT THE HOLDER BEING REBUILT. The same object now
		// carries a different reading; nothing was recreated to make that
		// happen, which is what lets a widget bind once and keep drawing.
		Check(S.GetAppliedPushes() == 2, "both applications went through one holder");
	}

	/* ------------------------------------------------------ the refusals */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		S.ApplyUsage(FString("alpha"), Hud(480), Report(5, EWonderlandUsageReading::Known));

		// A FAN-OUT DELIVERING SOMEBODY ELSE'S SPEND.
		Check(S.ApplyUsage(FString("beta"), Hud(7), Report(9, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::ForeignProject,
			"another project's reading is foreign");
		Check(HeldRemaining(S) == 480, "a foreign reading does not overwrite ours");
		Check(S.GetAppliedRevision() == 5, "a foreign reading does not move the revision");
		Check(S.GetForeignProjectPushesRejected() == 1, "the foreign refusal is counted");

		// A READING THAT NEVER PASSED THROUGH AN AUTHORITY.
		Check(S.ApplyUsage(FString("alpha"), Hud(7), Report(0, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Malformed,
			"revision 0 is malformed, not merely old");
		Check(S.ApplyUsage(FString("alpha"), Hud(7), Report(9, EWonderlandUsageReading::NotReported)) ==
				EWonderlandOrderingVerdict::Malformed,
			"a NotReported push is malformed however new it claims to be");
		Check(S.GetMalformedPushesRejected() == 2, "both malformed refusals are counted");
		Check(HeldRemaining(S) == 480, "no malformed reading reached the held figures");

		// THE WIRE RETRYING, WHICH IS HEALTHY.
		Check(S.ApplyUsage(FString("alpha"), Hud(7), Report(5, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Duplicate,
			"the revision we already hold is a duplicate");
		Check(S.GetDuplicatePushesRejected() == 1, "the duplicate is counted as a duplicate");
		Check(S.GetStaleRevisionPushesRejected() == 0,
			"a duplicate is NOT filed as a stale revision");

		// A REPLICA THAT IS BEHIND, WHICH IS NOT.
		Check(S.ApplyUsage(FString("alpha"), Hud(7), Report(4, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::StaleRevision,
			"an older revision is stale");
		Check(S.GetStaleRevisionPushesRejected() == 1, "the stale refusal is counted separately");
		Check(HeldRemaining(S) == 480, "a stale reading does not take back a newer one");
		Check(S.GetAppliedPushes() == 1, "none of the refusals counted as an application");
	}

	/* ------------------------------- the link drops, and comes back */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		S.ApplyUsage(FString("alpha"), Hud(480), Report(3, EWonderlandUsageReading::Known));

		FWonderlandLinkStatus Lost;
		Lost.State = EWonderlandLinkState::Stale;
		Lost.Explanation = FString("Contact with Relay was lost.");
		S.SetLinkStatus(Lost);

		// A DISCONNECTION IS NEVER A COMPLETION, AND NEVER A RESET.
		Check(S.HasUsage(), "losing the link does not un-tell the world");
		Check(HeldRemaining(S) == 480, "losing the link does not clear the figures");
		Check(S.GetAppliedRevision() == 3, "losing the link does not move the revision");
		Check(S.GetLinkStatus().State == EWonderlandLinkState::Stale, "the link says it is stale");

		// AND IT NEVER REWRITES WHAT THE AUTHORITY SAID.
		Check(S.GetAuthority().Reading == EWonderlandUsageReading::Known,
			"the client's link trouble does not edit Relay's verdict");

		// RECONNECT REPLAYING AN OLD READING. The classic corruption: a resumed
		// stream re-sends from its own cursor and the world must not rewind.
		Check(S.ApplyUsage(FString("alpha"), Hud(999), Report(2, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::StaleRevision,
			"a reconnect replaying an older revision is refused");
		Check(HeldRemaining(S) == 480, "the replay did not corrupt the held figures");

		FWonderlandLinkStatus Back;
		Back.State = EWonderlandLinkState::Live;
		Back.Explanation = FString("Connected to Relay.");
		S.SetLinkStatus(Back);
		Check(S.ApplyUsage(FString("alpha"), Hud(120), Report(4, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Applied,
			"the first genuinely new reading after a reconnect applies");
		Check(HeldRemaining(S) == 120, "and it is the one held");
	}

	/* ------------------------------------------------- switching worlds */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		S.ApplyUsage(FString("alpha"), Hud(480), Report(6, EWonderlandUsageReading::Known));

		S.BindProject(FString("alpha"));
		Check(S.HasUsage(), "re-binding the same project keeps the reading");
		Check(HeldRemaining(S) == 480, "an idempotent bind costs nothing");

		S.BindProject(FString("beta"));
		Check(!S.HasUsage(), "binding a different project drops the previous reading");
		Check(S.GetAppliedRevision() == 0, "and its revision, so beta's first push is not stale");
		Check(!S.GetUsage().CompoundAgent.RemainingUnits.bKnown,
			"the dropped reading becomes unknown, not zero");

		// The counters are this SESSION's history and survive a rebind: an
		// operator asking why a world looks wrong needs what it refused, not
		// what it refused since the last level change.
		Check(S.GetAppliedPushes() == 1, "the counters survive the rebind");

		Check(S.ApplyUsage(FString("alpha"), Hud(1), Report(7, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::ForeignProject,
			"the previous project's traffic is now foreign");
		Check(S.ApplyUsage(FString("beta"), Hud(50), Report(1, EWonderlandUsageReading::Known)) ==
				EWonderlandOrderingVerdict::Applied,
			"beta's first reading applies at revision 1 despite alpha having reached 6");
		Check(HeldRemaining(S) == 50, "and beta's figures are the ones held");
	}

	/* ----------------------------------------------------- teardown */
	{
		UWonderlandUsageSubsystem S;
		S.Initialize(Collection);
		S.BindProject(FString("alpha"));
		S.ApplyUsage(FString("alpha"), Hud(480), Report(1, EWonderlandUsageReading::Known));
		S.Deinitialize();

		Check(!S.HasUsage(), "deinitialising forgets the reading");
		Check(!S.IsBound(), "deinitialising forgets the project");
		Check(S.GetAppliedRevision() == 0, "deinitialising forgets the revision");
	}

	CheckDrawPlan();
	CheckRibbonStrip();
	CheckBands();
	CheckComposition();

	if (Failures > 0)
	{
		std::printf("FAIL %d of %d usage subsystem checks\n", Failures, Checks);
		return 1;
	}
	std::printf("ok   usage subsystem: %d checks\n", Checks);
	return 0;
}
