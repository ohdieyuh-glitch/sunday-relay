// Host-side check of WonderlandLffFeed. Not an Unreal target: g++ links it.
#include "WonderlandLffFeed.h"

#include <cstdio>
#include <cstring>

static int fail(const char* what)
{
	std::fprintf(stderr, "lff feed logic failed: %s\n", what);
	return 1;
}

int main()
{
	if (WonderlandLffCategoryLabel(WonderlandLffCategory::Unknown) != nullptr) return fail("unknown label");
	if (std::strcmp(WonderlandLffCategoryLabel(WonderlandLffCategory::Teams), "Looking for Teams") != 0) return fail("teams");
	if (std::strcmp(WonderlandLffCategoryLabel(WonderlandLffCategory::Builders), "Looking for Builders") != 0) return fail("builders");
	if (std::strcmp(WonderlandLffCategoryLabel(WonderlandLffCategory::AiEngineers), "Looking for AI Engineers") != 0) return fail("ai engineers");
	if (std::strcmp(WonderlandLffCategoryLabel(WonderlandLffCategory::Designers), "Looking for Designers") != 0) return fail("designers");
	if (std::strcmp(WonderlandLffCategoryLabel(WonderlandLffCategory::Competitors), "Looking for Competitors") != 0) return fail("competitors");

	if (WonderlandLffCategoryFromId(nullptr) != WonderlandLffCategory::Unknown) return fail("null id");
	if (WonderlandLffCategoryFromId("nope") != WonderlandLffCategory::Unknown) return fail("unknown id");
	if (WonderlandLffCategoryFromId("teams") != WonderlandLffCategory::Teams) return fail("from teams");
	if (WonderlandLffCategoryFromId("builders") != WonderlandLffCategory::Builders) return fail("from builders");
	if (WonderlandLffCategoryFromId("ai_engineers") != WonderlandLffCategory::AiEngineers) return fail("from ai");
	if (WonderlandLffCategoryFromId("designers") != WonderlandLffCategory::Designers) return fail("from designers");
	if (WonderlandLffCategoryFromId("competitors") != WonderlandLffCategory::Competitors) return fail("from competitors");

	if (!WonderlandLffRowIsOnOpenFeed("open", 10, 11)) return fail("open before expiry");
	if (WonderlandLffRowIsOnOpenFeed("open", 11, 11)) return fail("open at expiry");
	if (WonderlandLffRowIsOnOpenFeed("open", 12, 11)) return fail("open after expiry");
	if (WonderlandLffRowIsOnOpenFeed("withdrawn", 10, 11)) return fail("withdrawn");
	if (WonderlandLffRowIsOnOpenFeed("expired", 10, 11)) return fail("expired");
	if (WonderlandLffRowIsOnOpenFeed(nullptr, 10, 11)) return fail("null status");

	std::puts("ok");
	return 0;
}
