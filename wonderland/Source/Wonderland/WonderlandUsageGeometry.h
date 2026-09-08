// WONDERLAND — THE USAGE HUD'S GEOMETRY, SAMPLED IN THE WORLD.
//
// The two meters are poly-Bézier arcs, and their control points are FROZEN by
// the founder and pinned by digest in
// src/relay/mission/wonderland/wonderland-hud-canon.test.ts. This is the code
// that turns those control points into something Slate can draw.
//
// WHY THE SAMPLER LIVES HERE AND NOT ON THE WIRE. Relay could send a polyline
// and save this file existing. It must not: the shape would then be re-derived
// on every push, a stroke's fidelity would depend on how many points the
// network felt like carrying, and the ribbon would change subtly with the
// transport. The CONTROL POINTS cross — a dozen numbers, already mirrored as
// FWonderlandUsageSwoosh — and the world draws them at whatever resolution the
// viewport deserves.
//
// ARC LENGTH, NOT BÉZIER `t`, WHICH IS THE WHOLE DIFFICULTY. A cubic's
// parameter runs fast through gentle curvature and slow through tight
// curvature, so filling a meter by `t` would drain quickly around the ring and
// crawl along the tail. Equal spend must draw equal stroke, so the sampler
// builds a cumulative arc-length table and inverts it. That is the same
// algorithm the TypeScript uses, at the same resolution, and
// `WonderlandUsageGeometryTest.cpp` holds this implementation against a fixture
// generated from it — because two ports of one algorithm is exactly the shape
// of a drift nobody notices until the two surfaces disagree on screen.
//
// PURE. No engine state, no allocation beyond the table, no Tick.

#pragma once

#include "CoreMinimal.h"
#include "WonderlandUsageHud.h"
#include "WonderlandUsageGeometry.generated.h"

/** Table resolution per segment. Must match the TypeScript's 64 exactly. */
static constexpr int32 WonderlandArcTableResolution = 64;

// Mirrors WonderlandSwooshSample. One point on the spine, with everything a
// renderer needs to offset along the normal without redoing the maths.
USTRUCT(BlueprintType)
struct FWonderlandSwooshSample
{
	GENERATED_BODY()

	/** Arc-length fraction, 0 at the tail and 1 at the tip. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float T = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float X = 0.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float Y = 0.f;

	/** Unit tangent. Falls back to +x where control points coincide. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float TangentX = 1.f;

	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float TangentY = 0.f;

	/** Half the stroke's thickness here: held, then tapered toward the tip. */
	UPROPERTY(BlueprintReadOnly, Category = "Wonderland|Usage")
	float HalfWidth = 0.f;
};

/**
 * The sampler.
 *
 * Built once per shape and reused. Building it is cheap — four segments at 64
 * steps — but doing it per sample per frame would be 256 hypots a stroke a
 * frame for a figure that never changes, which is precisely the kind of cost
 * §13 of the HUD direction rules out.
 */
class WONDERLAND_API FWonderlandSwooshSampler
{
public:
	explicit FWonderlandSwooshSampler(const FWonderlandUsageSwoosh& InShape);

	/** One point at an ARC-LENGTH fraction. `T` outside 0..1 draws an end. */
	FWonderlandSwooshSample Sample(float T) const;

	/** Total spine length in unit-box coordinates. */
	float TotalLength() const { return Total; }

	/** True when the shape had no usable segments and nothing can be drawn. */
	bool IsEmpty() const { return Cumulative.Num() <= 1; }

private:
	struct FSegmentPoints
	{
		float X0 = 0.f, Y0 = 0.f, X1 = 0.f, Y1 = 0.f;
		float X2 = 0.f, Y2 = 0.f, X3 = 0.f, Y3 = 0.f;
	};

	float HalfWidthAt(float T) const;

	FWonderlandUsageSwoosh Shape;
	TArray<FSegmentPoints> Segments;
	TArray<int32> SegmentIndex;
	TArray<float> Local;
	TArray<float> Cumulative;
	float Total = 0.f;
};

/**
 * THE CANONICAL SHAPES, generated from the frozen TypeScript contract.
 *
 * Defined in `WonderlandUsageGeometry.canonical.cpp`, which is GENERATED — see
 * that file's header. The shape is static design data the client may hold; the
 * usage FIGURES are runtime state and arrive from Relay. A world must be able
 * to draw its own empty track before the first push, which is why the curve
 * lives here and the numbers do not.
 */
WONDERLAND_API const FWonderlandUsageSwoosh& WonderlandCompoundSwoosh();
WONDERLAND_API const FWonderlandUsageSwoosh& WonderlandSingleSwoosh();

/**
 * The drawable outline of a stroke, as one closed ribbon.
 *
 * `Fraction` is how much of the spine to walk, so a meter draws its REMAINDER
 * by passing the remaining fraction — the meter drains rather than filling.
 * Returns the two edges walked out and back, which is what Slate wants for a
 * filled polygon.
 */
WONDERLAND_API void WonderlandSwooshOutline(
	const FWonderlandSwooshSampler& Sampler,
	float Fraction,
	int32 Steps,
	TArray<FVector2D>& OutPoints);
