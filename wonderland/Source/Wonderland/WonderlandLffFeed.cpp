#include "WonderlandLffFeed.h"

#include <cstring>

const char* WonderlandLffCategoryLabel(WonderlandLffCategory category)
{
	switch (category)
	{
	case WonderlandLffCategory::Teams: return "Looking for Teams";
	case WonderlandLffCategory::Builders: return "Looking for Builders";
	case WonderlandLffCategory::AiEngineers: return "Looking for AI Engineers";
	case WonderlandLffCategory::Designers: return "Looking for Designers";
	case WonderlandLffCategory::Competitors: return "Looking for Competitors";
	default: return nullptr;
	}
}

WonderlandLffCategory WonderlandLffCategoryFromId(const char* categoryId)
{
	if (categoryId == nullptr) return WonderlandLffCategory::Unknown;
	if (std::strcmp(categoryId, "teams") == 0) return WonderlandLffCategory::Teams;
	if (std::strcmp(categoryId, "builders") == 0) return WonderlandLffCategory::Builders;
	if (std::strcmp(categoryId, "ai_engineers") == 0) return WonderlandLffCategory::AiEngineers;
	if (std::strcmp(categoryId, "designers") == 0) return WonderlandLffCategory::Designers;
	if (std::strcmp(categoryId, "competitors") == 0) return WonderlandLffCategory::Competitors;
	return WonderlandLffCategory::Unknown;
}

bool WonderlandLffRowIsOnOpenFeed(const char* status, int64 nowUnixMs, int64 expiresUnixMs)
{
	if (status == nullptr) return false;
	if (std::strcmp(status, "open") != 0) return false;
	return expiresUnixMs > nowUnixMs;
}
