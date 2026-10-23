// B35: the open hub must take the live service's snapshot once that snapshot exists.
#include "WonderlandSocialRecentCount.h"

#include <cstdio>
#include <string>

namespace
{
	int gFails = 0;

	void Expect(bool bOk, const char* What)
	{
		if (!bOk)
		{
			std::fprintf(stderr, "FAIL %s\n", What);
			++gFails;
		}
	}
}

int main()
{
	using WonderlandSocialRecent::HubSnapshotIsStale;
	using WonderlandSocialRecent::RecentBadge;

	Expect(!HubSnapshotIsStale("recent-2", ""), "an empty service digest is not stale");
	Expect(!HubSnapshotIsStale("", ""), "no digest yet is not stale");
	Expect(!HubSnapshotIsStale("recent-2", "recent-2"), "the applied digest is current");
	Expect(HubSnapshotIsStale("recent-2", "recent-1"), "a filtered digest replaces recent-2");
	Expect(HubSnapshotIsStale("", "recent-1"), "a first real digest is stale against an unnoted panel");

	Expect(RecentBadge(false, 2).empty(), "a withheld surface shows no recent count");
	Expect(RecentBadge(true, 0).empty(), "a zero count is not shown");
	Expect(RecentBadge(true, -1).empty(), "a negative count is not shown");
	Expect(RecentBadge(true, 1) == "1", "a fresh list of one shows 1");
	Expect(RecentBadge(true, 2) == "2", "a fresh list of two shows 2");

	if (gFails != 0)
	{
		std::fprintf(stderr, "%d failed\n", gFails);
		return 1;
	}
	std::printf("b35_recent_count_kat ok\n");
	return 0;
}
