// B35: whether an open hub is still showing a snapshot the live service has already replaced.
// Engine-free so a standalone check can compile it. Empty service digest is not stale:
// a missing read is not a count of zero.
#pragma once

#include <string>

namespace WonderlandSocialRecent
{
	/** True when the service has a digest and it is not the one the hub last applied. */
	inline bool HubSnapshotIsStale(const std::string& Applied, const std::string& Service)
	{
		return !Service.empty() && Service != Applied;
	}

	/**
	 * The recent-player count a surface may show. Empty when the surface is withheld,
	 * or when the count is not a positive number. Callers print this text; they do not
	 * invent a zero for a withheld or unknown list.
	 */
	inline std::string RecentBadge(bool bMayDraw, int Count)
	{
		if (!bMayDraw || Count <= 0)
		{
			return std::string();
		}
		return std::to_string(Count);
	}
}
