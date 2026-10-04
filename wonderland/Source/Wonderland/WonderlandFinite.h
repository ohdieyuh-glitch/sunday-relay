// Copyright Wonderland. All Rights Reserved.

#pragma once

#include "CoreMinimal.h"

/**
 * DRAWABLE TRANSFORMS ONLY (Second, round 4's act-hands GPU hang: Nanite's shadow culling hung and the GPU stayed wedged for 47 minutes;
 * a non-finite or runaway instance transform is the classic cause). Every transform this code writes into a drawn part passes IsDrawable
 * first. One that fails is not written -- the part keeps its last place -- and the first failure at each site is logged with what it was
 * asked to draw. Plain C++: no reflection, no FName made at load.
 */
namespace WonderlandFinite
{
	/** Finite everywhere, a unit rotation, no scale beyond MaxScale, the place within the world's reach. A zero scale is drawable (hidden). */
	inline bool IsDrawable(const FTransform& Xf, double MaxScale = 100.0)
	{
		return !Xf.ContainsNaN() && Xf.GetRotation().IsNormalized() && Xf.GetScale3D().GetAbsMax() <= MaxScale
			&& Xf.GetTranslation().GetAbsMax() <= 2.0e6;
	}

	/** A scale alone: finite, and no axis beyond MaxScale. */
	inline bool IsDrawableScale(const FVector& Scale, double MaxScale = 100.0)
	{
		return !Scale.ContainsNaN() && Scale.GetAbsMax() <= MaxScale;
	}

	/** One warning per writing site (bSiteWarned is that site's own flag), naming the site and what it was asked to draw. */
	inline void NoteRefused(bool& bSiteWarned, const TCHAR* Site, const FString& Asked)
	{
		if (!bSiteWarned)
		{
			bSiteWarned = true;
			UE_LOG(LogTemp, Warning, TEXT("WLFINITE %s refused a transform it would have drawn (the last one kept; logged once): %s"), Site, *Asked);
		}
	}
}
