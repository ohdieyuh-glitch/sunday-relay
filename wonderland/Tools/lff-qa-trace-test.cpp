// Looking for Feed QA trace. g++ driver for the pure recorder.
// The Social Hub view stays the client. This proves the QA commands and the
// event lines, with the flag off and with an injected epoch clock.
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

long long StepClock(void* user) { return *static_cast<long long*>(user); }

struct Listing {
	std::string id;
	std::string category;
	std::string title;
	std::string status;
};

struct Request {
	std::string id;
	std::string listingId;
	std::string requesterId;
	std::string status;
	std::string message;
};

struct Board {
	std::vector<Listing> listings;
	std::vector<Request> requests;
	std::vector<WonderlandLffQaCall> calls;
	int next = 1;
};

std::string Between(const std::string& path, const std::string& prefix, const std::string& suffix) {
	if (path.compare(0, prefix.size(), prefix) != 0 || path.size() < prefix.size() + suffix.size()) return std::string();
	if (path.compare(path.size() - suffix.size(), suffix.size(), suffix) != 0) return std::string();
	return path.substr(prefix.size(), path.size() - prefix.size() - suffix.size());
}

std::string Esc(const std::string& value) {
	std::string out;
	for (char c : value) {
		if (c == '"' || c == '\\') out.push_back('\\');
		out.push_back(c);
	}
	return out;
}

std::string Send(const WonderlandLffQaCall& call, void* user) {
	Board* board = static_cast<Board*>(user);
	board->calls.push_back(call);
	if (call.method == "POST" && call.path == "/lff/posts") {
		Listing row;
		row.id = "lffp_" + std::to_string(board->next++);
		row.category = call.category;
		row.title = call.title.empty() ? "QA " + call.category : call.title;
		row.status = "OPEN";
		board->listings.push_back(row);
		return std::string("{\"postId\":\"") + row.id + "\"}";
	}
	if (call.method == "GET" && call.path == "/lff/posts") {
		const bool all = call.category.empty() || call.category == "ALL";
		std::string out = "{\"posts\":[";
		bool first = true;
		for (const Listing& row : board->listings) {
			if (row.status != "OPEN" || (!all && row.category != call.category)) continue;
			const Request* pick = nullptr;
			const Request* declined = nullptr;
			for (const Request& request : board->requests) {
				if (request.listingId != row.id || request.requesterId != call.actorId) continue;
				if (request.status == "ACCEPTED" || request.status == "PENDING") { pick = &request; break; }
				if (request.status == "DECLINED") declined = &request;
			}
			if (pick == nullptr) pick = declined;
			if (!first) out += ',';
			first = false;
			out += "{\"postId\":\"" + row.id + "\",\"category\":\"" + Esc(row.category) + "\",\"title\":\"" + Esc(row.title) + "\",\"status\":\"OPEN\"";
			if (pick != nullptr) out += ",\"viewerRequest\":{\"requestId\":\"" + pick->id + "\",\"status\":\"" + pick->status + "\"}";
			out += '}';
		}
		out += "]}";
		return out;
	}
	if (call.method == "POST" && call.path.size() > 6 && call.path.compare(call.path.size() - 6, 6, "/close") == 0) {
		for (Listing& row : board->listings) if (row.id == call.listingId) row.status = "CLOSED";
		return "{}";
	}
	if (call.method == "POST" && call.path.size() > 9 && call.path.compare(call.path.size() - 9, 9, "/requests") == 0) {
		Request request;
		request.id = "lffr_" + std::to_string(board->next++);
		request.listingId = call.listingId;
		request.requesterId = call.actorId;
		request.status = "PENDING";
		request.message = call.message;
		board->requests.push_back(request);
		return std::string("{\"requestId\":\"") + request.id + "\"}";
	}
	const std::string accepted = Between(call.path, "/lff/requests/", "/accept");
	const std::string declined = Between(call.path, "/lff/requests/", "/decline");
	if (call.method == "POST" && (!accepted.empty() || !declined.empty())) {
		const std::string id = accepted.empty() ? declined : accepted;
		for (Request& request : board->requests) if (request.id == id) request.status = accepted.empty() ? "DECLINED" : "ACCEPTED";
		return "{}";
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

std::string Expect(const char* role, const char* net, const char* event, const char* listing, const char* category, const char* title = nullptr, const char* message = nullptr) {
	const bool filter = std::string(event) == "filter_applied";
	const char* corr = filter ? "" : listing;
	std::string line = std::string("{\"ts_utc_ms\":1761200000000,\"client_role\":\"") + role
		+ "\",\"net_id\":\"" + net
		+ "\",\"build_sha\":\"aa930c26\",\"corr_id\":\"" + corr
		+ "\",\"event\":\"" + event
		+ "\",\"listing_id\":\"" + listing
		+ "\",\"category\":\"" + category
		+ "\",\"seen_by\":\"" + role + "\"";
	if (title != nullptr || message != nullptr) {
		line += std::string(",\"title\":\"") + (title != nullptr ? title : "") + "\",\"message\":\"" + (message != nullptr ? message : "") + "\"";
	}
	line += '}';
	return line;
}

std::string ExpectBeat(long long ts, const char* role, const char* net) {
	return std::string("{\"ts_utc_ms\":") + std::to_string(ts) + ",\"client_role\":\"" + role
		+ "\",\"net_id\":\"" + net
		+ "\",\"build_sha\":\"aa930c26\",\"corr_id\":\"\",\"event\":\"lff_heartbeat\",\"listing_id\":\"\",\"category\":\"\",\"seen_by\":\""
		+ role + "\",\"server_offset_ms\":\"\",\"rtt_ms\":\"\"}";
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
	const WonderlandLffQaCommandResult refusedAccept = WonderlandLffQaRun(offState, off, base, "wl.Qa.LFF.Accept lffr_1", &quietExchange);
	Check(!refusedAccept.accepted && refusedAccept.error == "qa_disabled" && !WonderlandLffQaHeartbeat(off), "flag off accept and heartbeat");
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
	Check(ada.lines[0] == Expect("client-a", "net-a", "listing_posted", "lffp_1", "TEAMS", "QA TEAMS", ""), "listing_posted");
	Check(board.calls.size() == 1 && board.calls[0].method == "POST" && board.calls[0].path == "/lff/posts", "create path");
	Check(board.calls[0].url == "http://bridge.example/relay-api/wonderland/social/lff/posts", "create url");
	Check(board.calls[0].body == "{\"category\":\"TEAMS\",\"title\":\"QA TEAMS\",\"description\":\"QA listing\",\"projectLabel\":\"\",\"skills\":[],\"openSlots\":1}", "create body");
	Check(board.calls[0].body.find("displayName") == std::string::npos, "create omits display name");
	Check(adaState.feed.size() == 1 && adaState.feed[0].status == "OPEN", "poster feed");

	const WonderlandLffQaCommandResult filtered = WonderlandLffQaRun(baoState, bao, base, "wl.Qa.LFF.Filter TEAMS", &exchange);
	Check(filtered.accepted && bao.lines.size() == 2, "filter lines");
	Check(bao.lines[0] == Expect("client-b", "net-b", "listing_seen", "lffp_1", "TEAMS", "QA TEAMS", ""), "listing_seen");
	Check(bao.lines[1] == Expect("client-b", "net-b", "filter_applied", "", "TEAMS"), "filter_applied");
	Check(board.calls.back().method == "GET" && board.calls.back().path == "/lff/posts", "feed path");
	Check(board.calls.back().url == "http://bridge.example/relay-api/wonderland/social/lff/posts?limit=50&category=TEAMS", "feed query");
	Check(baoState.categoryFilter == "TEAMS" && baoState.feed.size() == 1, "filter state");

	const WonderlandLffQaCommandResult requested = WonderlandLffQaRun(baoState, bao, base, "wl.Qa.LFF.Request lffp_1", &exchange);
	Check(requested.accepted && bao.lines.size() == 3, "request accepted");
	Check(bao.lines[2] == Expect("client-b", "net-b", "connect_requested", "lffp_1", "TEAMS", "QA TEAMS", "QA request"), "connect_requested");
	Check(board.calls.back().method == "POST" && board.calls.back().path == "/lff/posts/lffp_1/requests", "request path");
	Check(board.calls.back().body == "{\"message\":\"QA request\"}", "request body");

	WonderlandLffQaCall inbox = WonderlandLffQaBuildInbox(base, "lffp_1");
	Check(inbox.ok && inbox.method == "GET" && inbox.path == "/lff/posts/lffp_1/requests", "inbox path");
	const bool received = WonderlandLffQaApply(adaState, ada, inbox,
		"{\"postId\":\"lffp_1\",\"requests\":[{\"requestId\":\"lffr_2\",\"status\":\"PENDING\",\"message\":\"QA request\",\"requester\":{\"userId\":\"bao\"}}]}");
	Check(received && ada.lines.size() == 2, "inbox applied");
	Check(ada.lines[1] == Expect("client-a", "net-a", "connect_received", "lffp_1", "TEAMS", "QA TEAMS", "QA request"), "connect_received");

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

	Board pilot;
	WonderlandLffQaExchange pilotExchange;
	pilotExchange.send = &Send;
	pilotExchange.user = &pilot;
	WonderlandLffQaLog owner = MakeLog("client-a", "net-a", true, true);
	WonderlandLffQaState ownerState;
	ownerState.playerId = "ada";
	WonderlandLffQaLog joiner = MakeLog("client-b", "net-b", true, true);
	WonderlandLffQaState joinerState;
	joinerState.playerId = "bao";

	const WonderlandLffQaCommandResult quoted = WonderlandLffQaRun(ownerState, owner, base, "wl.Qa.LFF.Post TEAMS \"Table 4\"", &pilotExchange);
	Check(quoted.accepted && owner.lines.size() == 1, "quoted title accepted");
	Check(owner.lines[0] == Expect("client-a", "net-a", "listing_posted", "lffp_1", "TEAMS", "Table 4", ""), "posted title");
	Check(pilot.calls[0].body == "{\"category\":\"TEAMS\",\"title\":\"Table 4\",\"description\":\"QA listing\",\"projectLabel\":\"\",\"skills\":[],\"openSlots\":1}", "quoted title body");
	const size_t quotedCalls = pilot.calls.size();
	const WonderlandLffQaCommandResult openQuote = WonderlandLffQaRun(ownerState, owner, base, "wl.Qa.LFF.Post TEAMS \"nope", &pilotExchange);
	Check(!openQuote.accepted && openQuote.error == "invalid_command" && pilot.calls.size() == quotedCalls && owner.lines.size() == 1, "unclosed title");

	const WonderlandLffQaCommandResult cleared = WonderlandLffQaRun(joinerState, joiner, base, "wl.Qa.LFF.Filter all", &pilotExchange);
	Check(cleared.accepted && joiner.lines.size() == 2, "filter all lines");
	Check(joiner.lines[0] == Expect("client-b", "net-b", "listing_seen", "lffp_1", "TEAMS", "Table 4", ""), "seen title");
	Check(joiner.lines[1] == Expect("client-b", "net-b", "filter_applied", "", "ALL"), "filter all");
	Check(pilot.calls.back().url == "http://bridge.example/relay-api/wonderland/social/lff/posts?limit=50", "unfiltered url");
	Check(pilot.calls.back().url.find("category=") == std::string::npos && joinerState.categoryFilter.empty(), "filter all clears");
	const WonderlandLffQaCommandResult none = WonderlandLffQaRun(joinerState, joiner, base, "wl.Qa.LFF.Filter none", &pilotExchange);
	const WonderlandLffQaCommandResult clear = WonderlandLffQaRun(joinerState, joiner, base, "wl.Qa.LFF.Filter clear", &pilotExchange);
	Check(none.accepted && clear.accepted && joiner.lines.size() == 4, "none and clear add only the filter line");
	Check(joiner.lines[2] == Expect("client-b", "net-b", "filter_applied", "", "ALL") && joiner.lines[3] == Expect("client-b", "net-b", "filter_applied", "", "ALL"), "none and clear");
	Check(joinerState.categoryFilter.empty(), "clear leaves the filter empty");

	const WonderlandLffQaCommandResult noted = WonderlandLffQaRun(joinerState, joiner, base, "wl.Qa.LFF.Request lffp_1 \"need a healer\"", &pilotExchange);
	Check(noted.accepted && pilot.calls.back().path == "/lff/posts/lffp_1/requests", "noted request path");
	Check(pilot.calls.back().body == "{\"message\":\"need a healer\"}", "noted request body");
	Check(joiner.lines.back() == Expect("client-b", "net-b", "connect_requested", "lffp_1", "TEAMS", "Table 4", "need a healer"), "requested message");

	WonderlandLffQaCall ownerInbox = WonderlandLffQaBuildInbox(base, "lffp_1");
	const bool ownerSaw = WonderlandLffQaApply(ownerState, owner, ownerInbox,
		"{\"postId\":\"lffp_1\",\"requests\":[{\"requestId\":\"lffr_2\",\"status\":\"PENDING\",\"message\":\"need a healer\",\"requester\":{\"userId\":\"bao\"}}]}");
	Check(ownerSaw && owner.lines.back() == Expect("client-a", "net-a", "connect_received", "lffp_1", "TEAMS", "Table 4", "need a healer"), "received message");

	const WonderlandLffQaCommandResult badAccept = WonderlandLffQaRun(ownerState, owner, base, "wl.Qa.LFF.Accept ../secret", &pilotExchange);
	Check(!badAccept.accepted && badAccept.error == "invalid_id" && owner.lines.size() == 2, "accept rejects a bad id");
	const WonderlandLffQaCommandResult accepted = WonderlandLffQaRun(ownerState, owner, base, "wl.Qa.LFF.Accept lffr_2", &pilotExchange);
	Check(accepted.accepted && pilot.calls.back().method == "POST" && pilot.calls.back().path == "/lff/requests/lffr_2/accept" && pilot.calls.back().body == "{}", "accept path");
	Check(owner.lines.back() == Expect("client-a", "net-a", "connect_accepted", "lffp_1", "TEAMS", "Table 4", "need a healer"), "connect_accepted");
	const size_t joinerBeforeSeen = joiner.lines.size();
	const WonderlandLffQaCommandResult seenAccept = WonderlandLffQaRun(joinerState, joiner, base, "wl.Qa.LFF.Filter TEAMS", &pilotExchange);
	Check(seenAccept.accepted && joiner.lines.size() == joinerBeforeSeen + 2, "accept seen on the next filter");
	Check(joiner.lines[joinerBeforeSeen] == Expect("client-b", "net-b", "connect_accepted_seen", "lffp_1", "TEAMS", "Table 4", "need a healer"), "connect_accepted_seen");
	Check(joiner.lines.back() == Expect("client-b", "net-b", "filter_applied", "", "TEAMS"), "filter after accept");
	const size_t joinerAfterAccept = joiner.lines.size();
	WonderlandLffQaCall mine = WonderlandLffQaBuildFeed(base, "TEAMS");
	mine.method = "GET";
	mine.path = "/lff/requests";
	const bool mineAgain = WonderlandLffQaApply(joinerState, joiner, mine,
		"{\"requests\":[{\"requestId\":\"lffr_2\",\"postId\":\"lffp_1\",\"status\":\"ACCEPTED\",\"message\":\"need a healer\",\"category\":\"TEAMS\",\"title\":\"Table 4\"}]}");
	Check(mineAgain && joiner.lines.size() == joinerAfterAccept, "a second read does not emit the seen line again");

	const WonderlandLffQaCommandResult other = WonderlandLffQaRun(ownerState, owner, base, "wl.Qa.LFF.Post BUILDERS \"Other table\"", &pilotExchange);
	Check(other.accepted && owner.lines.back() == Expect("client-a", "net-a", "listing_posted", "lffp_3", "BUILDERS", "Other table", ""), "second post");
	const size_t beforeBuilders = joiner.lines.size();
	const WonderlandLffQaCommandResult otherSeen = WonderlandLffQaRun(joinerState, joiner, base, "wl.Qa.LFF.Filter BUILDERS", &pilotExchange);
	Check(otherSeen.accepted && joiner.lines.back() == Expect("client-b", "net-b", "filter_applied", "", "BUILDERS"), "builders filter");
	Check(joiner.lines[beforeBuilders] == Expect("client-b", "net-b", "listing_seen", "lffp_3", "BUILDERS", "Other table", ""), "builders title");
	Check(joiner.lines[beforeBuilders + 1] == Expect("client-b", "net-b", "listing_removed_seen", "lffp_1", "TEAMS"), "teams leaves the builders page");
	const WonderlandLffQaCommandResult otherRequest = WonderlandLffQaRun(joinerState, joiner, base, "wl.Qa.LFF.Request lffp_3 \"not this one\"", &pilotExchange);
	Check(otherRequest.accepted && pilot.calls.back().body == "{\"message\":\"not this one\"}", "decline setup request");
	WonderlandLffQaCall otherInbox = WonderlandLffQaBuildInbox(base, "lffp_3");
	Check(WonderlandLffQaApply(ownerState, owner, otherInbox,
		"{\"postId\":\"lffp_3\",\"requests\":[{\"requestId\":\"lffr_4\",\"status\":\"PENDING\",\"message\":\"not this one\",\"requester\":{\"userId\":\"bao\"}}]}"), "decline inbox");
	const WonderlandLffQaCommandResult declined = WonderlandLffQaRun(ownerState, owner, base, "wl.Qa.LFF.Decline lffr_4", &pilotExchange);
	Check(declined.accepted && pilot.calls.back().path == "/lff/requests/lffr_4/decline" && pilot.calls.back().body == "{}", "decline path");
	Check(owner.lines.back() == Expect("client-a", "net-a", "connect_declined", "lffp_3", "BUILDERS", "Other table", "not this one"), "connect_declined");
	const size_t beforeDeclineSeen = joiner.lines.size();
	const WonderlandLffQaCommandResult seenDecline = WonderlandLffQaRun(joinerState, joiner, base, "wl.Qa.LFF.Filter BUILDERS", &pilotExchange);
	Check(seenDecline.accepted && joiner.lines[beforeDeclineSeen] == Expect("client-b", "net-b", "connect_declined_seen", "lffp_3", "BUILDERS", "Other table", "not this one"), "connect_declined_seen");

	long long clock = 1761200000000LL;
	WonderlandLffQaLog beat = MakeLog("client-a", "net-a", true, false);
	beat.nowUtcMs = &StepClock;
	beat.clockUser = &clock;
	Check(WonderlandLffQaHeartbeat(beat) && beat.lines.size() == 1 && beat.lines[0] == ExpectBeat(clock, "client-a", "net-a"), "first heartbeat");
	clock += 4999;
	Check(!WonderlandLffQaHeartbeat(beat) && beat.lines.size() == 1, "heartbeat waits five seconds");
	clock += 1;
	Check(WonderlandLffQaHeartbeat(beat) && beat.lines.size() == 2 && beat.lines[1] == ExpectBeat(clock, "client-a", "net-a"), "heartbeat at five seconds");
	WonderlandLffQaLog beatOff = MakeLog("client-a", "net-a", false, true);
	Check(!WonderlandLffQaHeartbeat(beatOff) && beatOff.lines.empty(), "heartbeat stays quiet while disabled");
	WonderlandLffQaLog beatNoClock = MakeLog("client-a", "net-a", true, false);
	Check(!WonderlandLffQaHeartbeat(beatNoClock) && beatNoClock.lines.empty(), "heartbeat does not invent a timestamp");

	if (gFails != 0) {
		std::fprintf(stderr, "%d failed\n", gFails);
		return 1;
	}
	std::fputs("ok\n", stdout);
	return 0;
}
