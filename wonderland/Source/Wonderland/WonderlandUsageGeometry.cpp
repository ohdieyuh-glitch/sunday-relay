#include "WonderlandUsageGeometry.h"

namespace
{
	float Cubic(float T, float A, float B, float C, float D)
	{
		const float U = 1.f - T;
		return U * U * U * A + 3.f * U * U * T * B + 3.f * U * T * T * C + T * T * T * D;
	}

	float CubicDerivative(float T, float A, float B, float C, float D)
	{
		const float U = 1.f - T;
		return 3.f * U * U * (B - A) + 6.f * U * T * (C - B) + 3.f * T * T * (D - C);
	}

	/** A bad parameter draws an end, never a NaN. */
	float Clamp01(float Value)
	{
		if (!FMath::IsFinite(Value)) { return 0.f; }
		return FMath::Clamp(Value, 0.f, 1.f);
	}
}

FWonderlandSwooshSampler::FWonderlandSwooshSampler(const FWonderlandUsageSwoosh& InShape)
	: Shape(InShape)
{
	// The segments as explicit four-point cubics, head to tail: each segment's
	// end becomes the next one's start, which is what makes the spine continuous
	// rather than a set of disconnected curves.
	float X0 = Shape.StartX;
	float Y0 = Shape.StartY;
	for (const FWonderlandSwooshSegment& Segment : Shape.Segments)
	{
		FSegmentPoints Points;
		Points.X0 = X0;                Points.Y0 = Y0;
		Points.X1 = Segment.Control1X; Points.Y1 = Segment.Control1Y;
		Points.X2 = Segment.Control2X; Points.Y2 = Segment.Control2Y;
		Points.X3 = Segment.EndX;      Points.Y3 = Segment.EndY;
		Segments.Add(Points);
		X0 = Segment.EndX;
		Y0 = Segment.EndY;
	}

	// The cumulative arc-length table. Sampling by chord length at a fixed
	// resolution is an approximation, and it is the SAME approximation the
	// TypeScript makes at the same resolution — which matters more than being
	// closer to the true integral, because the two must agree on screen.
	SegmentIndex.Add(0);
	Local.Add(0.f);
	Cumulative.Add(0.f);

	float PreviousX = Shape.StartX;
	float PreviousY = Shape.StartY;
	for (int32 Index = 0; Index < Segments.Num(); ++Index)
	{
		const FSegmentPoints& Points = Segments[Index];
		for (int32 Step = 1; Step <= WonderlandArcTableResolution; ++Step)
		{
			const float T = static_cast<float>(Step) / static_cast<float>(WonderlandArcTableResolution);
			const float X = Cubic(T, Points.X0, Points.X1, Points.X2, Points.X3);
			const float Y = Cubic(T, Points.Y0, Points.Y1, Points.Y2, Points.Y3);
			Total += FMath::Sqrt((X - PreviousX) * (X - PreviousX) + (Y - PreviousY) * (Y - PreviousY));
			PreviousX = X;
			PreviousY = Y;
			SegmentIndex.Add(Index);
			Local.Add(T);
			Cumulative.Add(Total);
		}
	}
}

float FWonderlandSwooshSampler::HalfWidthAt(float T) const
{
	// Held at full thickness, then tapered. The exponent is what makes the tail
	// come to a point rather than a wedge.
	const float Held = Clamp01(Shape.TaperStart);
	if (T <= Held) { return Shape.TailWidth; }
	const float Span = 1.f - Held;
	const float Progress = Span <= 0.f ? 1.f : (T - Held) / Span;
	const float Remaining = FMath::Pow(1.f - Progress, FMath::Max(Shape.TaperExponent, 0.f));
	return Shape.TipWidth + (Shape.TailWidth - Shape.TipWidth) * Remaining;
}

FWonderlandSwooshSample FWonderlandSwooshSampler::Sample(float T) const
{
	FWonderlandSwooshSample Out;
	Out.T = Clamp01(T);
	if (Segments.Num() == 0)
	{
		// A shape with no segments is drawable as nothing. Returning a sample at
		// the origin rather than refusing keeps a malformed contract from
		// crashing a world; the widget draws an empty track and says UNKNOWN.
		Out.X = Shape.StartX;
		Out.Y = Shape.StartY;
		return Out;
	}

	const float Target = Total * Out.T;

	// Find the table interval containing the target length.
	int32 Index = 1;
	while (Index < Cumulative.Num() - 1 && Cumulative[Index] < Target) { ++Index; }

	const float Lower = Cumulative[Index - 1];
	const float Upper = Cumulative[Index];
	const float Span = Upper - Lower;
	const float WithinInterval = Span <= 0.f ? 0.f : (Target - Lower) / Span;

	const int32 Segment = SegmentIndex[Index];
	// A step that crossed a segment boundary restarts its local parameter at 0,
	// so the previous row's local value belongs to the PREVIOUS curve and must
	// not be interpolated against this one.
	const float LocalLower = SegmentIndex[Index - 1] == Segment ? Local[Index - 1] : 0.f;
	const float LocalUpper = Local[Index];
	const float LocalT = LocalLower + (LocalUpper - LocalLower) * WithinInterval;

	const FSegmentPoints& Points = Segments.IsValidIndex(Segment)
		? Segments[Segment]
		: Segments[Segments.Num() - 1];

	const float Dx = CubicDerivative(LocalT, Points.X0, Points.X1, Points.X2, Points.X3);
	const float Dy = CubicDerivative(LocalT, Points.Y0, Points.Y1, Points.Y2, Points.Y3);
	// A zero-length tangent is possible where control points coincide. Falling
	// back to +x keeps the ribbon drawable rather than producing NaN normals.
	const float Length = FMath::Sqrt(Dx * Dx + Dy * Dy);
	const float SafeLength = Length == 0.f ? 1.f : Length;

	Out.X = Cubic(LocalT, Points.X0, Points.X1, Points.X2, Points.X3);
	Out.Y = Cubic(LocalT, Points.Y0, Points.Y1, Points.Y2, Points.Y3);
	Out.TangentX = (Length == 0.f ? 1.f : Dx) / SafeLength;
	Out.TangentY = (Length == 0.f ? 0.f : Dy) / SafeLength;
	Out.HalfWidth = HalfWidthAt(Out.T);
	return Out;
}

void WonderlandSwooshOutline(
	const FWonderlandSwooshSampler& Sampler,
	float Fraction,
	int32 Steps,
	TArray<FVector2D>& OutPoints)
{
	OutPoints.Reset();
	const float Walk = Clamp01(Fraction);
	const int32 Count = FMath::Max(Steps, 2);
	if (Sampler.IsEmpty() || Walk <= 0.f) { return; }

	// Out along one edge and back along the other, so the result is one closed
	// ribbon Slate can fill in a single call rather than two strips it has to
	// stitch.
	TArray<FVector2D> Back;
	Back.Reserve(Count);
	for (int32 Step = 0; Step < Count; ++Step)
	{
		const float T = Walk * static_cast<float>(Step) / static_cast<float>(Count - 1);
		const FWonderlandSwooshSample Point = Sampler.Sample(T);
		// The normal is the tangent turned a quarter turn. Widths are half-widths
		// precisely so this is an offset either way rather than a division.
		const FVector2D Normal(-Point.TangentY, Point.TangentX);
		const FVector2D Centre(Point.X, Point.Y);
		OutPoints.Add(Centre + Normal * Point.HalfWidth);
		Back.Add(Centre - Normal * Point.HalfWidth);
	}
	for (int32 Step = Back.Num() - 1; Step >= 0; --Step)
	{
		OutPoints.Add(Back[Step]);
	}
}
