// LOOKING FOR FEED QA TRACE.
//
// The Social Hub view (WonderlandSocialLffView, last changed in f1fbb264) stays
// the client. This file does not draw it and does not replace it. It records
// one JSON line per Looking for Feed event, and it turns the QA commands into
// the same /lff calls that view's live service sends.
//
//   wl.Qa.LFF.Post <category> [title...]
//   wl.Qa.LFF.Withdraw <id>
//   wl.Qa.LFF.Filter <category>|all|none|clear
//   wl.Qa.LFF.Request <id> [message...]
//   wl.Qa.LFF.Accept <id>
//   wl.Qa.LFF.Decline <id>
//   wl.Qa.LFF.Dump
//
// Accept and Decline are FWonderlandLffModel::Accept and Decline
// (WonderlandSocialLffView.cpp), which call ActOnLff("lff.request.accept" /
// "lff.request.decline"). The live service posts /lff/requests/<id>/accept and
// /lff/requests/<id>/decline (WonderlandSocialLive.cpp). Those routes are on
// the #406 board. A successful write emits connect_accepted or
// connect_declined on the acting client. The requester emits
// connect_accepted_seen or connect_declined_seen only when a later read shows
// that status: viewerRequest on a feed post, or GET /lff/requests
// (ReadLffMyRequests). A failed read emits nothing.
//
// title and message are appended after seen_by on listing_posted, listing_seen,
// and the connect_* events. Parsers that stop at seen_by still see the
// original prefix. filter_applied, listing_withdrawn, and listing_removed_seen
// keep the original nine fields.
//
// lff_heartbeat is one line every 5 seconds of the injected epoch clock while
// the log is enabled. server_offset_ms and rtt_ms are appended empty. This
// client has no Looking for Feed server clock. World presence asOfMs
// (WonderlandWorldPresence.h) and the world-report RTT (WonderlandSocialLive.cpp,
// the remote-soles send) are not an LFF time source and are not copied here.
//
// Another branch may define the same field names on its own. This file does
// not include that branch.
//
// ts_utc_ms is epoch milliseconds from the injected clock. This file does not
// read an uptime clock. A null clock emits nothing, including no heartbeat.
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
	// Appended after seen_by on the listing and connect events. Empty when
	// that event has nothing to say. Not written on the original nine-field lines.
	std::string title;
	std::string message;
};

struct WonderlandLffQaLog {
	bool enabled = false;
	std::string clientRole;
	std::string netId;
	std::string buildSha;
	long long (*nowUtcMs)(void* user) = nullptr;
	void* clockUser = nullptr;
	std::vector<std::string> lines;
	// Heartbeat gate. The first eligible tick while enabled emits, then not
	// again until 5000 ms of the injected clock have passed.
	bool heartbeatStarted = false;
	long long lastHeartbeatUtcMs = 0;
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
	std::string message;
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
	// The desktop create title, and the request note. Accept's listingId is the
	// request id; the trace line's listing_id stays the post id when we know it.
	std::string title;
	std::string message;
	// Who is asking. The feed's viewerRequest is that player's own request.
	std::string actorId;
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
inline const char* WONDERLAND_LFF_EVENT_CONNECT_ACCEPTED = "connect_accepted";
inline const char* WONDERLAND_LFF_EVENT_CONNECT_DECLINED = "connect_declined";
inline const char* WONDERLAND_LFF_EVENT_CONNECT_ACCEPTED_SEEN = "connect_accepted_seen";
inline const char* WONDERLAND_LFF_EVENT_CONNECT_DECLINED_SEEN = "connect_declined_seen";
inline const char* WONDERLAND_LFF_EVENT_HEARTBEAT = "lff_heartbeat";

inline const char* WONDERLAND_LFF_QA_POST = "wl.Qa.LFF.Post";
inline const char* WONDERLAND_LFF_QA_WITHDRAW = "wl.Qa.LFF.Withdraw";
inline const char* WONDERLAND_LFF_QA_FILTER = "wl.Qa.LFF.Filter";
inline const char* WONDERLAND_LFF_QA_REQUEST = "wl.Qa.LFF.Request";
inline const char* WONDERLAND_LFF_QA_ACCEPT = "wl.Qa.LFF.Accept";
inline const char* WONDERLAND_LFF_QA_DECLINE = "wl.Qa.LFF.Decline";
inline const char* WONDERLAND_LFF_QA_DUMP = "wl.Qa.LFF.Dump";

bool WonderlandLffQaIsCategoryToken(const std::string& category);
std::string WonderlandLffQaCategoryToken(const std::string& category);
bool WonderlandLffQaIsId(const std::string& id);
std::string WonderlandLffQaSocialUrl(const std::string& baseUrl, const std::string& path);

WonderlandLffQaCall WonderlandLffQaBuildCreate(const std::string& baseUrl, const std::string& category, const std::string& title, const std::string& description);
WonderlandLffQaCall WonderlandLffQaBuildFeed(const std::string& baseUrl, const std::string& categoryToken);
WonderlandLffQaCall WonderlandLffQaBuildClose(const std::string& baseUrl, const std::string& listingId);
WonderlandLffQaCall WonderlandLffQaBuildRequest(const std::string& baseUrl, const std::string& listingId, const std::string& message);
WonderlandLffQaCall WonderlandLffQaBuildAccept(const std::string& baseUrl, const std::string& requestId);
WonderlandLffQaCall WonderlandLffQaBuildDecline(const std::string& baseUrl, const std::string& requestId);
WonderlandLffQaCall WonderlandLffQaBuildInbox(const std::string& baseUrl, const std::string& listingId);

std::string WonderlandLffQaFormatLine(const WonderlandLffQaEvent& event);
void WonderlandLffQaEmit(WonderlandLffQaLog& log, const std::string& event, const std::string& listingId, const std::string& category, const std::string& title = "", const std::string& message = "");
// One lff_heartbeat when the log is enabled, the clock is set, and at least
// 5000 ms of that clock have passed since the previous beat. Returns false
// and writes nothing otherwise. server_offset_ms and rtt_ms are empty.
bool WonderlandLffQaHeartbeat(WonderlandLffQaLog& log);
bool WonderlandLffQaApply(WonderlandLffQaState& state, WonderlandLffQaLog& log, const WonderlandLffQaCall& call, const std::string& dataJson);
std::string WonderlandLffQaDump(const WonderlandLffQaState& state, const WonderlandLffQaLog& log);

WonderlandLffQaCommandResult WonderlandLffQaRun(
	WonderlandLffQaState& state, WonderlandLffQaLog& log, const std::string& baseUrl, const std::string& line, const WonderlandLffQaExchange* exchange);
