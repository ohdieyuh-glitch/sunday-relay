// LOOKING FOR FEED QA TRACE.
//
// The Social Hub view (WonderlandSocialLffView, last changed in f1fbb264) stays
// the client. This file does not draw it and does not replace it. It records
// one JSON line per Looking for Feed event, and it turns the five QA commands
// into the same /lff calls that view's live service sends.
//
// Another branch may define the same field names on its own. This file does
// not include that branch.
//
// ts_utc_ms is epoch milliseconds from the injected clock. This file does not
// read an uptime clock.
//
// Shipping leaves WonderlandLffQaLog::enabled false, and the console commands
// are not registered in a shipping build. A disabled log emits nothing.

#pragma once

#include <string>
#include <vector>

struct WonderlandLffQaEvent {
	long long tsUtcMs = 0;
	std::string clientRole;
	std::string netId;
	std::string buildSha;
	std::string corrId;
	std::string event;
	std::string listingId;
	std::string category;
	std::string seenBy;
};

struct WonderlandLffQaLog {
	bool enabled = false;
	std::string clientRole;
	std::string netId;
	std::string buildSha;
	long long (*nowUtcMs)(void* user) = nullptr;
	void* clockUser = nullptr;
	std::vector<std::string> lines;
};

struct WonderlandLffQaRow {
	std::string listingId;
	std::string category;
	std::string title;
	std::string status;
};

struct WonderlandLffQaRequest {
	std::string requestId;
	std::string listingId;
	std::string category;
	std::string requesterId;
	std::string status;
};

struct WonderlandLffQaState {
	std::string playerId;
	std::string categoryFilter;
	std::vector<WonderlandLffQaRow> feed;
	std::vector<WonderlandLffQaRequest> requests;
	std::string lastError;
};

struct WonderlandLffQaCall {
	std::string method;
	std::string path;
	std::string url;
	std::string body;
	std::string category;
	std::string listingId;
	bool ok = false;
	std::string error;
};

struct WonderlandLffQaExchange {
	std::string (*send)(const WonderlandLffQaCall& call, void* user) = nullptr;
	void* user = nullptr;
};

struct WonderlandLffQaCommandResult {
	bool accepted = false;
	std::string error;
	std::string dump;
};

inline const char* WONDERLAND_LFF_EVENT_POSTED = "listing_posted";
inline const char* WONDERLAND_LFF_EVENT_SEEN = "listing_seen";
inline const char* WONDERLAND_LFF_EVENT_FILTER = "filter_applied";
inline const char* WONDERLAND_LFF_EVENT_CONNECT_REQUESTED = "connect_requested";
inline const char* WONDERLAND_LFF_EVENT_CONNECT_RECEIVED = "connect_received";
inline const char* WONDERLAND_LFF_EVENT_WITHDRAWN = "listing_withdrawn";
inline const char* WONDERLAND_LFF_EVENT_REMOVED_SEEN = "listing_removed_seen";

inline const char* WONDERLAND_LFF_QA_POST = "wl.Qa.LFF.Post";
inline const char* WONDERLAND_LFF_QA_WITHDRAW = "wl.Qa.LFF.Withdraw";
inline const char* WONDERLAND_LFF_QA_FILTER = "wl.Qa.LFF.Filter";
inline const char* WONDERLAND_LFF_QA_REQUEST = "wl.Qa.LFF.Request";
inline const char* WONDERLAND_LFF_QA_DUMP = "wl.Qa.LFF.Dump";

bool WonderlandLffQaIsCategoryToken(const std::string& category);
std::string WonderlandLffQaCategoryToken(const std::string& category);
bool WonderlandLffQaIsId(const std::string& id);
std::string WonderlandLffQaSocialUrl(const std::string& baseUrl, const std::string& path);

WonderlandLffQaCall WonderlandLffQaBuildCreate(const std::string& baseUrl, const std::string& category, const std::string& title, const std::string& description);
WonderlandLffQaCall WonderlandLffQaBuildFeed(const std::string& baseUrl, const std::string& categoryToken);
WonderlandLffQaCall WonderlandLffQaBuildClose(const std::string& baseUrl, const std::string& listingId);
WonderlandLffQaCall WonderlandLffQaBuildRequest(const std::string& baseUrl, const std::string& listingId, const std::string& message);
WonderlandLffQaCall WonderlandLffQaBuildInbox(const std::string& baseUrl, const std::string& listingId);

std::string WonderlandLffQaFormatLine(const WonderlandLffQaEvent& event);
void WonderlandLffQaEmit(WonderlandLffQaLog& log, const std::string& event, const std::string& listingId, const std::string& category);
bool WonderlandLffQaApply(WonderlandLffQaState& state, WonderlandLffQaLog& log, const WonderlandLffQaCall& call, const std::string& dataJson);
std::string WonderlandLffQaDump(const WonderlandLffQaState& state, const WonderlandLffQaLog& log);

WonderlandLffQaCommandResult WonderlandLffQaRun(
	WonderlandLffQaState& state, WonderlandLffQaLog& log, const std::string& baseUrl, const std::string& line, const WonderlandLffQaExchange* exchange);
