#include "WonderlandCompanionHud.h"

#include "Misc/DateTime.h"

namespace
{
	FWonderlandSwooshSegment Seg(float C1X, float C1Y, float C2X, float C2Y, float EX, float EY)
	{
		FWonderlandSwooshSegment Out;
		Out.Control1X = C1X; Out.Control1Y = C1Y;
		Out.Control2X = C2X; Out.Control2Y = C2Y;
		Out.EndX = EX;       Out.EndY = EY;
		return Out;
	}

	FWonderlandFigure Known(double Value)
	{
		FWonderlandFigure Figure;
		Figure.bKnown = true;
		Figure.Value = Value;
		Figure.Reason = EWonderlandUnknownReason::Unobserved;   // the contract's word for "this figure is known"
		return Figure;
	}
}

const FWonderlandUsageSwoosh& WonderlandCompanionHud::LlmCompanionSwoosh()
{
	static const FWonderlandUsageSwoosh Shape = []{
		FWonderlandUsageSwoosh S;
		// The Single Agent spine offset 0.040 inward and refitted (see the header). Four segments,
		// joined where the blue's are, so each white cubic sits against its blue counterpart.
		S.StartX = 0.380155f;
		S.StartY = 0.602795f;
		S.Segments.Add(Seg(0.347060f, 0.634225f, 0.298108f, 0.641252f, 0.258718f, 0.617244f));
		S.Segments.Add(Seg(0.214134f, 0.590039f, 0.193594f, 0.534613f, 0.198790f, 0.484093f));
		S.Segments.Add(Seg(0.203844f, 0.435630f, 0.233697f, 0.386875f, 0.282276f, 0.372188f));
		S.Segments.Add(Seg(0.465626f, 0.316532f, 0.667399f, 0.338014f, 0.849294f, 0.388541f));
		// As wide as the slimmed blue where they run together, then a longer, finer taper than the
		// blue's blunt end: the companion stroke finishes in a point, which is where the glint sits.
		S.TailWidth = 0.011200f;
		S.TipWidth = 0.003000f;
		S.TaperStart = 0.660000f;
		S.TaperExponent = 1.350000f;
		return S;
	}();
	return Shape;
}

const FWonderlandUsagePalette& WonderlandCompanionHud::LlmCompanionPalette()
{
	static const FWonderlandUsagePalette Palette = []{
		FWonderlandUsagePalette P;
		P.Accent = FLinearColor(1.0f, 1.0f, 1.0f, 1.0f);
		P.Bright = FLinearColor(1.0f, 1.0f, 1.0f, 1.0f);
		// A cool breath rather than a white halo: white light on ivory stone needs a hue to read as light.
		P.Glow = FLinearColor(0.58f, 0.78f, 1.0f, 0.20f);
		P.Track = FLinearColor(1.0f, 1.0f, 1.0f, 0.16f);
		P.Emphasis = 2;
		return P;
	}();
	return Palette;
}

FWonderlandUsageSwoosh WonderlandCompanionHud::WithWidthScale(const FWonderlandUsageSwoosh& Shape, float Scale)
{
	FWonderlandUsageSwoosh Out = Shape;
	const float Safe = FMath::IsFinite(Scale) ? FMath::Clamp(Scale, 0.1f, 2.0f) : 1.0f;
	Out.TailWidth = Shape.TailWidth * Safe;
	Out.TipWidth = Shape.TipWidth * Safe;
	return Out;
}

FWonderlandUsageSwoosh WonderlandCompanionHud::WithWidthOffset(const FWonderlandUsageSwoosh& Shape, float ExtraHalfWidth)
{
	FWonderlandUsageSwoosh Out = Shape;
	const float Safe = FMath::IsFinite(ExtraHalfWidth) ? FMath::Clamp(ExtraHalfWidth, 0.0f, 0.05f) : 0.0f;
	Out.TailWidth = Shape.TailWidth + Safe;
	Out.TipWidth = Shape.TipWidth + Safe;
	return Out;
}

FWonderlandUsageMeter WonderlandCompanionHud::PreviewMeter(float Percent)
{
	const double Capacity = 100.0;
	const double Remaining = FMath::Clamp(static_cast<double>(FMath::IsFinite(Percent) ? Percent : 0.0f), 0.0, 100.0);
	FWonderlandUsageMeter Meter;
	Meter.CapacityUnits = Known(Capacity);
	Meter.UsedUnits = Known(Capacity - Remaining);
	Meter.RemainingUnits = Known(Remaining);
	Meter.ReferenceCapacityUnits = Known(Capacity);
	Meter.CapacitySpan = Known(1.0);
	Meter.FillFraction = Known((Capacity - Remaining) / Capacity);
	Meter.RemainingFraction = Known(Remaining / Capacity);
	Meter.Status = EWonderlandUsageStatus::Available;
	Meter.Provenance = EWonderlandProvenance::Simulated;
	Meter.bSimulated = true;
	Meter.ObservedAtIso = FDateTime::UtcNow().ToIso8601();
	return Meter;
}
