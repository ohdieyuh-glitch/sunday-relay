#include "WonderlandProjectAvatar.h"

#include <cmath>

namespace WonderlandAvatar
{
	using WonderlandPose::EWork;

	const char* StageName(EStage Stage)
	{
		switch (Stage)
		{
		case EStage::Dormant:  return "dormant";
		case EStage::Egg:      return "egg";
		case EStage::Baby:     return "baby";
		case EStage::Growing:  return "growing";
		case EStage::Advanced: return "advanced";
		case EStage::Final:    return "final";
		default: return "?";
		}
	}

	const char* MissionName(EMission Mission)
	{
		switch (Mission)
		{
		case EMission::Unknown:      return "unknown";
		case EMission::Idle:         return "idle";
		case EMission::Researching:  return "researching";
		case EMission::Planning:     return "planning";
		case EMission::Implementing: return "implementing";
		case EMission::Reviewing:    return "reviewing";
		case EMission::Verifying:    return "verifying";
		case EMission::Repairing:    return "repairing";
		case EMission::Approved:     return "approved";
		case EMission::Complete:     return "complete";
		default: return "?";
		}
	}

	EWork WorkForMission(EMission Mission)
	{
		switch (Mission)
		{
		// THE TRUTHFULNESS RULE. No Relay data and nothing happening both mean
		// the Dog does no work at all. Mapping Unknown to something plausible —
		// researching, say — would make an unreachable Bridge look like a busy
		// project, which is the exact failure this whole module is shaped to
		// prevent.
		case EMission::Unknown:      return EWork::None;
		case EMission::Idle:         return EWork::None;

		case EMission::Researching:  return EWork::Meditating;
		case EMission::Planning:     return EWork::Meditating;
		case EMission::Implementing: return EWork::Channelling;
		case EMission::Reviewing:    return EWork::Inspecting;
		case EMission::Verifying:    return EWork::Inspecting;
		case EMission::Repairing:    return EWork::Repairing;
		case EMission::Approved:     return EWork::Approving;
		// Complete is a finished project, not a Dog still working on it.
		case EMission::Complete:     return EWork::None;
		default: return EWork::None;
		}
	}

	bool MissionWantsAttendance(EMission Mission)
	{
		return WorkForMission(Mission) != EWork::None;
	}

	FAvatarLook LookFor(EStage Stage, EMission Mission, float Phase)
	{
		FAvatarLook Look;
		switch (Stage)
		{
		case EStage::Dormant:  Look.Scale = 0.55f; Look.Segments = 0; break;
		case EStage::Egg:      Look.Scale = 1.00f; Look.Segments = 0; break;
		case EStage::Baby:     Look.Scale = 1.18f; Look.Segments = 1; break;
		case EStage::Growing:  Look.Scale = 1.45f; Look.Segments = 2; break;
		case EStage::Advanced: Look.Scale = 1.78f; Look.Segments = 3; break;
		case EStage::Final:    Look.Scale = 2.15f; Look.Segments = 4; break;
		}

		// GLOW IS ACTIVITY, and a dormant project does not glow at all. A
		// baseline shimmer on Unknown would light the Avatar for a Bridge that
		// never answered.
		const float Pulse = 0.5f + 0.5f * std::sin(Phase * 6.28318530718f);
		switch (Mission)
		{
		case EMission::Unknown:
		case EMission::Idle:
			Look.Glow = (Stage == EStage::Dormant) ? 0.0f : 0.08f;
			break;
		case EMission::Researching:
		case EMission::Planning:
			Look.Glow = 0.22f + 0.10f * Pulse;
			break;
		case EMission::Implementing:
			Look.Glow = 0.62f + 0.28f * Pulse;   // the busiest it ever looks
			break;
		case EMission::Reviewing:
		case EMission::Verifying:
			Look.Glow = 0.40f + 0.12f * Pulse;
			break;
		case EMission::Repairing:
			// Guttering rather than pulsing: something is wrong and it shows.
			Look.Glow = 0.30f + 0.30f * std::fabs(std::sin(Phase * 18.0f));
			break;
		case EMission::Approved:
		case EMission::Complete:
			Look.Glow = 0.85f;                   // steady, finished
			break;
		}
		return Look;
	}

	EStage StageFor(EStage Current, EMission Mission, int CompletedRuns)
	{
		// EARNED, NOT ELAPSED. The stage is a function of how many missions have
		// actually completed, so an Avatar cannot grow because the level has
		// been open a while. There is no time parameter to pass.
		EStage Earned = EStage::Dormant;
		if (CompletedRuns >= 12)     { Earned = EStage::Final; }
		else if (CompletedRuns >= 6) { Earned = EStage::Advanced; }
		else if (CompletedRuns >= 3) { Earned = EStage::Growing; }
		else if (CompletedRuns >= 1) { Earned = EStage::Baby; }
		else if (Mission != EMission::Unknown) { Earned = EStage::Egg; }

		// NEVER REGRESS. A Bridge that drops out sets Mission to Unknown, and a
		// project that visibly shrank because the network blinked would be
		// worse than one that froze.
		return (int(Earned) > int(Current)) ? Earned : Current;
	}
}
