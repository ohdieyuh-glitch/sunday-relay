// Looking for Feed QA trace. g++ driver for the pure recorder.
// The Social Hub view stays the client. This proves the five commands and the
// seven event lines, with the flag off and with an injected epoch clock.
#include "../Source/Wonderland/WonderlandLffQaTrace.h"

#include <cstdio>
#include <string>
#include <vector>

namespace {

int gFails = 0;

void Check(bool ok, const char* what) {
	if (ok) return;
	std::fprintf(stderr, "fail: %s\n", what);
	++gFails;
}

long long FixedClock(void*) { return 1761200000000LL; }

struct Listing {
	std::string id;
	std::string category;
	std::string title;
	std::string status;
};

struct Board {
	std::vector<Listing> listings;
	std::vector<WonderlandLffQaCall> calls;
	int next = 1;
};

std::string Send(const WonderlandLffQaCall& call, void* user) {
	Board* board = static_cast<Board*>(user);
	board->calls.push_back(call);
	if (call.method == "POST" && call.path == "/lff/posts") {
		Listing row;
		row.id = "lffp_" + std::to_string(board->next++);
		row.category = call.category;
		row.title = "QA " + call.category;
		row.status = "OPEN";
		board->listings.push_back(row);
		return std::string("{\"postId\":\"") + row.id + "\"}";
	}
	if (call.method == "GET" && call.path == "/lff/posts") {
		std::string out = "{\"posts\":[";
		bool first = true;
		for (const Listing& row : board->listings) {
			if (row.status != "OPEN" || row.category != call.category) continue;
			if (!first) out += ',';
			first = false;
			out += "{\"postId\":\"" + row.id + "\",\"category\":\"" + row.category + "\",\"title\":\"" + row.title + "\",\"status\":\"OPEN\"}";
		}
		out += "]}";
		return out;
	}
	if (call.method == "POST" && call.path.size() > 6 && call.path.compare(call.path.size() - 6, 6, "/close") == 0) {
		for (Listing& row : board->listings) if (row.id == call.listingId) row.status = "CLOSED";
		return "{}";
	}
	if (call.method == "POST" && call.path.size() > 9 && call.path.compare(call.path.size() - 9, 9, "/requests") == 0) {
		const std::string id = "lffr_" + std::to_string(board->next++);
		return std::string("{\"requestId\":\"") + id + "\"}";
	}
	return "{}";
}

WonderlandLffQaLog MakeLog(const char* role, const char* net, bool enabled, bool withClock) {
	WonderlandLffQaLog log;
	log.enabled = enabled;
	log.clientRole = role;
	log.netId = net;
	log.buildSha = "aa930c26";
	log.nowUtcMs = withClock ? &FixedClock : nullptr;
	return log;
}

std::string Expect(const char* role, const char* net, const char* event, const char* listing, const char* category) {
	const bool filter = std::string(event) == "filter_applied";
	const char* corr = filter ? "" : listing;
	return std::string("{\"ts_utc_ms\":1761200000000,\"client_role\":\"") + role
		+ "\",\"net_id\":\"" + net
		+ "\",\"build_sha\":\"aa930c26\",\"corr_id\":\"" + corr
		+ "\",\"event\":\"" + event
		+ "\",\"listing_id\":\"" + listing
		+ "\",\"category\":\"" + category
		+ "\",\"seen_by\":\"" + role + "\"}";
}

}  // namespace

int main() {
	const std::string base = "http://bridge.example/";
	Check(WonderlandLffQaSocialUrl(base, "/lff/posts") == "http://bridge.example/relay-api/wonderland/social/lff/posts", "url prefix");

	Board quiet;
	WonderlandLffQaExchange quietExchange;
	quietExchange.send = &Send;
	quietExchange.user = &quiet;
	WonderlandLffQaLog off = MakeLog("client-a", "net-a", false, true);
	WonderlandLffQaState offState;
	offState.playerId = "ada";
	offState.feed.push_back(WonderlandLffQaRow{"lff_keep", "TEAMS", "kept", "OPEN"});
	const WonderlandLffQaCommandResult refused = WonderlandLffQaRun(offState, off, base, "wl.Qa.LFF.Post TEAMS", &quietExchange);
	Check(!refused.accepted && refused.error == "qa_disabled", "flag off refuses");
	Check(off.lines.empty() && quiet.calls.empty() && offState.feed.size() == 1 && offState.feed[0].listingId == "lff_keep", "flag off changes nothing");

	Board board;
	WonderlandLffQaExchange exchange;
	exchange.send = &Send;
	exchange.user = &board;
	WonderlandLffQaLog ada = MakeLog("client-a", "net-a", true, true);
	WonderlandLffQaState adaState;
	adaState.playerId = "ada";
	WonderlandLffQaLog bao = MakeLog("client-b", "net-b", true, true);
	WonderlandLffQaState baoState;
	baoState.playerId = "bao";

	const WonderlandLffQaCommandResult hostile = WonderlandLffQaRun(baoState, bao, base, "wl.Qa.LFF.Request ../secret", &exchange);
	Check(!hostile.accepted && hostile.error == "invalid_id" && board.calls.empty() && bao.lines.empty(), "hostile id");
	const WonderlandLffQaCommandResult badCategory = WonderlandLffQaRun(adaState, ada, base, "wl.Qa.LFF.Post NOT_A_CATEGORY", &exchange);
	Check(!badCategory.accepted && badCategory.error == "invalid_category" && board.calls.empty(), "bad category");

	const WonderlandLffQaCommandResult posted = WonderlandLffQaRun(adaState, ada, base, "wl.Qa.LFF.Post teams", &exchange);
	Check(posted.accepted && ada.lines.size() == 1, "post accepted");
	Check(ada.lines[0] == Expect("client-a", "net-a", "listing_posted", "lffp_1", "TEAMS"), "listing_posted");
	Check(board.calls.size() == 1 && board.calls[0].method == "POST" && board.calls[0].path == "/lff/posts", "create path");
	Check(board.calls[0].url == "http://bridge.example/relay-api/wonderland/social/lff/posts", "create url");
	Check(board.calls[0].body == "{\"category\":\"TEAMS\",\"title\":\"QA TEAMS\",\"description\":\"QA listing\",\"projectLabel\":\"\",\"skills\":[],\"openSlots\":1}", "create body");
	Check(board.calls[0].body.find("displayName") == std::string::npos, "create omits display name");
	Check(adaState.feed.size() == 1 && adaState.feed[0].status == "OPEN", "poster feed");

	const WonderlandLffQaCommandResult filtered = WonderlandLffQaRun(baoState, bao, base, "wl.Qa.LFF.Filter TEAMS", &exchange);
	Check(filtered.accepted && bao.lines.size() == 2, "filter lines");
	Check(bao.lines[0] == Expect("client-b", "net-b", "listing_seen", "lffp_1", "TEAMS"), "listing_seen");
	Check(bao.lines[1] == Expect("client-b", "net-b", "filter_applied", "", "TEAMS"), "filter_applied");
	Check(board.calls.back().method == "GET" && board.calls.back().path == "/lff/posts", "feed path");
	Check(board.calls.back().url == "http://bridge.example/relay-api/wonderland/social/lff/posts?limit=50&category=TEAMS", "feed query");
	Check(baoState.categoryFilter == "TEAMS" && baoState.feed.size() == 1, "filter state");

	const WonderlandLffQaCommandResult requested = WonderlandLffQaRun(baoState, bao, base, "wl.Qa.LFF.Request lffp_1", &exchange);
	Check(requested.accepted && bao.lines.size() == 3, "request accepted");
	Check(bao.lines[2] == Expect("client-b", "net-b", "connect_requested", "lffp_1", "TEAMS"), "connect_requested");
	Check(board.calls.back().method == "POST" && board.calls.back().path == "/lff/posts/lffp_1/requests", "request path");
	Check(board.calls.back().body == "{\"message\":\"QA request\"}", "request body");

	WonderlandLffQaCall inbox = WonderlandLffQaBuildInbox(base, "lffp_1");
	Check(inbox.ok && inbox.method == "GET" && inbox.path == "/lff/posts/lffp_1/requests", "inbox path");
	const bool received = WonderlandLffQaApply(adaState, ada, inbox,
		"{\"postId\":\"lffp_1\",\"requests\":[{\"requestId\":\"lffr_2\",\"status\":\"PENDING\",\"requester\":{\"userId\":\"bao\"}}]}");
	Check(received && ada.lines.size() == 2, "inbox applied");
	Check(ada.lines[1] == Expect("client-a", "net-a", "connect_received", "lffp_1", "TEAMS"), "connect_received");

	const WonderlandLffQaCommandResult withdrawn = WonderlandLffQaRun(adaState, ada, base, "wl.Qa.LFF.Withdraw lffp_1", &exchange);
	Check(withdrawn.accepted && ada.lines.size() == 3 && adaState.feed.empty(), "withdraw accepted");
	Check(ada.lines[2] == Expect("client-a", "net-a", "listing_withdrawn", "lffp_1", "TEAMS"), "listing_withdrawn");
	Check(board.calls.back().method == "POST" && board.calls.back().path == "/lff/posts/lffp_1/close" && board.calls.back().body == "{}", "close path");
	bool adaSawRemoved = false;
	for (const std::string& line : ada.lines) if (line.find("listing_removed_seen") != std::string::npos) adaSawRemoved = true;
	Check(!adaSawRemoved, "withdraw is not a removal seen by the poster");

	const WonderlandLffQaCommandResult gone = WonderlandLffQaRun(baoState, bao, base, "wl.Qa.LFF.Filter TEAMS", &exchange);
	Check(gone.accepted && bao.lines.size() == 5 && baoState.feed.empty(), "second filter");
	Check(bao.lines[3] == Expect("client-b", "net-b", "listing_removed_seen", "lffp_1", "TEAMS"), "listing_removed_seen");
	Check(bao.lines[4] == Expect("client-b", "net-b", "filter_applied", "", "TEAMS"), "filter again");

	const char* events[] = {
		WONDERLAND_LFF_EVENT_POSTED, WONDERLAND_LFF_EVENT_SEEN, WONDERLAND_LFF_EVENT_FILTER,
		WONDERLAND_LFF_EVENT_CONNECT_REQUESTED, WONDERLAND_LFF_EVENT_CONNECT_RECEIVED,
		WONDERLAND_LFF_EVENT_WITHDRAWN, WONDERLAND_LFF_EVENT_REMOVED_SEEN};
	for (const char* event : events) {
		bool found = false;
		for (const std::string& line : ada.lines) if (line.find(std::string("\"event\":\"") + event + "\"") != std::string::npos) found = true;
		for (const std::string& line : bao.lines) if (line.find(std::string("\"event\":\"") + event + "\"") != std::string::npos) found = true;
		Check(found, event);
	}

	WonderlandLffQaLog silent = MakeLog("client-a", "net-a", true, false);
	WonderlandLffQaState silentState;
	silentState.playerId = "ada";
	Board silentBoard;
	WonderlandLffQaExchange silentExchange;
	silentExchange.send = &Send;
	silentExchange.user = &silentBoard;
	const WonderlandLffQaCommandResult noClock = WonderlandLffQaRun(silentState, silent, base, "wl.Qa.LFF.Post TEAMS", &silentExchange);
	Check(noClock.accepted && silent.lines.empty() && silentState.feed.size() == 1, "null clock emits nothing");

	const WonderlandLffQaCommandResult dump = WonderlandLffQaRun(baoState, bao, base, "  wl.Qa.LFF.Dump  ", nullptr);
	Check(dump.accepted && dump.dump.find('\n') == std::string::npos, "dump is one line");
	Check(dump.dump.find("\"category_filter\":\"TEAMS\"") != std::string::npos && dump.dump.find("\"feed\":[]") != std::string::npos, "dump feed is empty after withdraw");
	Check(dump.dump.find("\"request_id\":\"lffr_2\"") != std::string::npos && dump.dump.find("\"requester_id\":\"bao\"") != std::string::npos, "dump keeps the request");
	Check(bao.lines.size() == 5, "dump emits no event");
	const WonderlandLffQaCommandResult dumpExtra = WonderlandLffQaRun(baoState, bao, base, "wl.Qa.LFF.Dump extra", nullptr);
	Check(!dumpExtra.accepted && dumpExtra.error == "invalid_command", "dump takes no argument");
	const WonderlandLffQaCommandResult unknown = WonderlandLffQaRun(baoState, bao, base, "wl.Qa.LFF.Nope", &exchange);
	Check(!unknown.accepted && unknown.error == "unknown_command" && board.calls.size() == 5, "unknown command");

	if (gFails != 0) {
		std::fprintf(stderr, "%d failed\n", gFails);
		return 1;
	}
	std::fputs("ok\n", stdout);
	return 0;
}
