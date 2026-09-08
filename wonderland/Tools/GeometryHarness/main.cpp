// NATIVE HARNESS FOR THE UNREAL GEOMETRY SAMPLER.
//
// The Unreal HUD's arc-length sampler is a port of the TypeScript one, and two
// ports of one algorithm drift silently — especially here, where the control
// points are frozen, so a divergence shows up as the same shape drawn subtly
// wrong rather than as an obvious break.
//
// There is no Unreal Engine in CI and there is no GPU, so the usual answer
// would be an editor automation test nobody in this repository can run. This
// compiles the REAL sampler against the same stubs the syntax check uses and
// prints what it computes, so the port can be diffed against the fixture the
// TypeScript emitted. It is not a substitute for running in the engine — it
// cannot be, it has no engine — but it is the difference between a port that
// has been checked and one that has merely been written.

#include "WonderlandUsageGeometry.h"
#include <cstdio>

int main()
{
	const int Steps = 32;
	struct Row { const char* Name; const FWonderlandUsageSwoosh* Shape; };
	const Row Rows[] = {
		{ "compound", &WonderlandCompoundSwoosh() },
		{ "single",   &WonderlandSingleSwoosh() },
	};

	for (const Row& R : Rows)
	{
		const FWonderlandSwooshSampler Sampler(*R.Shape);
		for (int i = 0; i <= Steps; ++i)
		{
			const float T = static_cast<float>(i) / static_cast<float>(Steps);
			const FWonderlandSwooshSample S = Sampler.Sample(T);
			std::printf("%s\t%.6f\t%.6f\t%.6f\t%.6f\t%.6f\t%.6f\n",
				R.Name, T, S.X, S.Y, S.TangentX, S.TangentY, S.HalfWidth);
		}
	}
	return 0;
}
