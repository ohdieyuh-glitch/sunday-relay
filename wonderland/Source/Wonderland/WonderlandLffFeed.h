// WONDERLAND — Looking for Feed row, presentation only.
//
// Relay's pure domain (src/relay/mission/wonderland/wonderland-lff.ts) decides
// which listings exist. This header is the row a Social Hub feed can draw.
// Unknown sits at ordinal 0 so a zero-filled value is not a category.
//
// No USTRUCT and no UENUM: this row is not part of the world-state parity
// table. The labels and the open-feed predicate are checked by
// wonderland/Tools/lff-feed-logic-test.cpp, compiled with the stub toolchain.

#pragma once

#include "CoreMinimal.h"

enum class WonderlandLffCategory : uint8
{
	Unknown = 0,
	Teams,
	Builders,
	AiEngineers,
	Designers,
	Competitors
};

struct WonderlandLffFeedRow
{
	const char* ListingId = nullptr;
	WonderlandLffCategory Category = WonderlandLffCategory::Unknown;
	const char* CategoryLabel = nullptr;
	const char* Title = nullptr;
	const char* AuthorId = nullptr;
	const char* AuthorDisplayName = nullptr;
	const char* ContactMethod = nullptr;
	const char* ContactLabel = nullptr;
	const char* ContactValue = nullptr;
	const char* Status = nullptr;
	int64 ExpiresAtUnixMs = 0;
};

const char* WonderlandLffCategoryLabel(WonderlandLffCategory category);
WonderlandLffCategory WonderlandLffCategoryFromId(const char* categoryId);
bool WonderlandLffRowIsOnOpenFeed(const char* status, int64 nowUnixMs, int64 expiresUnixMs);
