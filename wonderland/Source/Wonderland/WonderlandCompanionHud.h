// WONDERLAND — THE LLM COMPANION ARC. A development preview composition, not yet canon.
//
// THE FOUNDER'S ASK, 2026-09-15: a third meter for the imported LLM Companion, fully white,
// placed NEXT TO the blue Single Agent stroke and not beside the green Compound frame, with the
// blue made slightly skinnier so the pair fits cleanly, and every label kept below the art.
//
// WHY IT IS NOT IN THE USAGE CONTRACT YET. FWonderlandUsageHud, EWonderlandUsageChannel and the
// generated canonical shapes mirror the TypeScript contract field for field, and the two frozen
// spines are pinned by digest (wonderland-hud-canon.test.ts). A third channel belongs there once
// the founder has SEEN this composition in the world and approved it; adding it to the contract
// first would turn that approval into a formality. So the white spine lives here as design data
// beside the frozen two, the widget draws it only when UWonderlandUsageHudSettings asks, and its
// figure comes from the development preview alone. Porting it is the control points below plus a
// channel.
//
// HOW THE SPINE WAS MADE. It is the Single Agent spine offset 0.040 unit toward the ring's
// centre, refitted one cubic per segment with the base spine's end tangents (Schneider's method),
// and checked against the true offset: the worst deviation is 0.00076 unit, under 2% of the gap.
// An offset rather than a fresh drawing keeps the white parallel to the blue all the way round,
// so the two read as a pair and the gap never pinches or opens.
//
// NOTHING HERE IS A NEW REFLECTED TYPE. The shape and palette reuse FWonderlandUsageSwoosh and
// FWonderlandUsagePalette, so the C++ ↔ TypeScript parity table has nothing new to account for.
#pragma once

#include "CoreMinimal.h"
#include "WonderlandUsageGeometry.h"
#include "WonderlandUsageHud.h"

namespace WonderlandCompanionHud
{
	/** How far inside the blue spine the white one runs, in unit-box coordinates. Documentation; the fit is baked. */
	inline constexpr float LlmCompanionInsetUnits = 0.040f;

	/** The white LLM Companion spine, nested inside the Single Agent stroke. */
	WONDERLAND_API const FWonderlandUsageSwoosh& LlmCompanionSwoosh();

	/**
	 * White, and white to the tip: accent, head and label are one colour, so a full meter is a
	 * fully white stroke rather than a white stroke with a paler end. Emphasis 2 puts it behind
	 * the blue, which is itself behind the green.
	 */
	WONDERLAND_API const FWonderlandUsagePalette& LlmCompanionPalette();

	/** Shape with its ribbon half-widths scaled. The spine, and therefore the arc length, is untouched. */
	WONDERLAND_API FWonderlandUsageSwoosh WithWidthScale(const FWonderlandUsageSwoosh& Shape, float Scale);

	/** Shape with a constant added to its ribbon half-widths: the dark edge and the glow drawn under the white. */
	WONDERLAND_API FWonderlandUsageSwoosh WithWidthOffset(const FWonderlandUsageSwoosh& Shape, float ExtraHalfWidth);

	/**
	 * The development preview's reading for the white arc: capacity equals the reference, so the
	 * track is the whole spine, and the remainder is Percent of it. Simulated, and says so. The
	 * Channel field is left at its default because the contract has no LLM Companion channel yet;
	 * nothing that builds bands reads it.
	 */
	WONDERLAND_API FWonderlandUsageMeter PreviewMeter(float Percent);
}
