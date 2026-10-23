#include "WonderlandLffQaTrace.h"

#include <cctype>
#include <cstdio>
#include <utility>

namespace WonderlandLffQaTraceDetail {

bool Equals(const std::string& value, const char* token) { return value == token; }

void AppendEscaped(std::string& out, const std::string& value) {
	out.push_back('"');
	for (unsigned char c : value) {
		if (c == '"' || c == '\\') {
			out.push_back('\\');
			out.push_back(static_cast<char>(c));
		} else if (c < 0x20 || c == 0x7f) {
			char buf[8];
			std::snprintf(buf, sizeof(buf), "\\u%04x", c);
			out += buf;
		} else {
			out.push_back(static_cast<char>(c));
		}
	}
	out.push_back('"');
}

std::string JsonString(const std::string& value) {
	std::string out;
	AppendEscaped(out, value);
	return out;
}

struct JVal {
	enum Kind { Null, Bool, Str, Num, Obj, Arr } kind = Null;
	bool b = false;
	std::string s;
	std::vector<std::pair<std::string, JVal>> obj;
	std::vector<JVal> arr;
};

class Parser {
public:
	explicit Parser(const std::string& text) : text_(text) {}
	bool Parse(JVal& out) { return Value(out) && Skip() == text_.size(); }

private:
	const std::string& text_;
	size_t at_ = 0;

	size_t Skip() {
		while (at_ < text_.size() && (text_[at_] == ' ' || text_[at_] == '\n' || text_[at_] == '\r' || text_[at_] == '\t')) ++at_;
		return at_;
	}
	bool Value(JVal& out) {
		if (Skip() >= text_.size()) return false;
		const char c = text_[at_];
		if (c == '"') return String(out.s) && (out.kind = JVal::Str, true);
		if (c == '{') return Object(out);
		if (c == '[') return Array(out);
		if (c == 't' || c == 'f') return Bool(out);
		if (c == 'n') return Null(out);
		if (c == '-' || (c >= '0' && c <= '9')) return Number(out);
		return false;
	}
	bool String(std::string& out) {
		if (at_ >= text_.size() || text_[at_] != '"') return false;
		++at_;
		out.clear();
		while (at_ < text_.size()) {
			const char c = text_[at_++];
			if (c == '"') return true;
			if (c == '\\') {
				if (at_ >= text_.size()) return false;
				const char e = text_[at_++];
				if (e == 'u') {
					if (at_ + 4 > text_.size()) return false;
					at_ += 4;
					out.push_back('?');
				} else if (e == 'n') out.push_back('\n');
				else if (e == 'r') out.push_back('\r');
				else if (e == 't') out.push_back('\t');
				else out.push_back(e);
			} else out.push_back(c);
		}
		return false;
	}
	bool Object(JVal& out) {
		++at_;
		out.kind = JVal::Obj;
		if (Skip() < text_.size() && text_[at_] == '}') { ++at_; return true; }
		while (at_ < text_.size()) {
			std::string key;
			JVal child;
			if (!String(key) || Skip() >= text_.size() || text_[at_] != ':' || (++at_, !Value(child))) return false;
			out.obj.emplace_back(std::move(key), std::move(child));
			if (Skip() >= text_.size()) return false;
			if (text_[at_] == '}') { ++at_; return true; }
			if (text_[at_] != ',') return false;
			++at_;
		}
		return false;
	}
	bool Array(JVal& out) {
		++at_;
		out.kind = JVal::Arr;
		if (Skip() < text_.size() && text_[at_] == ']') { ++at_; return true; }
		while (at_ < text_.size()) {
			JVal child;
			if (!Value(child)) return false;
			out.arr.push_back(std::move(child));
			if (Skip() >= text_.size()) return false;
			if (text_[at_] == ']') { ++at_; return true; }
			if (text_[at_] != ',') return false;
			++at_;
		}
		return false;
	}
	bool Bool(JVal& out) {
		if (text_.compare(at_, 4, "true") == 0) { at_ += 4; out.kind = JVal::Bool; out.b = true; return true; }
		if (text_.compare(at_, 5, "false") == 0) { at_ += 5; out.kind = JVal::Bool; out.b = false; return true; }
		return false;
	}
	bool Null(JVal& out) {
		if (text_.compare(at_, 4, "null") != 0) return false;
		at_ += 4;
		out.kind = JVal::Null;
		return true;
	}
	bool Number(JVal& out) {
		const size_t start = at_;
		if (text_[at_] == '-') ++at_;
		while (at_ < text_.size() && ((text_[at_] >= '0' && text_[at_] <= '9') || text_[at_] == '.')) ++at_;
		out.kind = JVal::Num;
		out.s = text_.substr(start, at_ - start);
		return at_ > start;
	}
};

const JVal* Field(const JVal& value, const char* key) {
	if (value.kind != JVal::Obj) return nullptr;
	for (const auto& pair : value.obj) if (pair.first == key) return &pair.second;
	return nullptr;
}

std::string FieldStr(const JVal& value, const char* key) {
	const JVal* field = Field(value, key);
	return field != nullptr && field->kind == JVal::Str ? field->s : std::string();
}

WonderlandLffQaCall Ready(const std::string& method, const std::string& baseUrl, const std::string& path, const std::string& body) {
	WonderlandLffQaCall call;
	call.method = method;
	call.path = path;
	call.url = WonderlandLffQaSocialUrl(baseUrl, path);
	call.body = body;
	call.ok = true;
	return call;
}

WonderlandLffQaCall Reject(const std::string& error) {
	WonderlandLffQaCall call;
	call.error = error;
	return call;
}

int FindRow(const WonderlandLffQaState& state, const std::string& listingId) {
	for (size_t i = 0; i < state.feed.size(); ++i) if (state.feed[i].listingId == listingId) return static_cast<int>(i);
	return -1;
}

void UpsertOpen(WonderlandLffQaState& state, const std::string& listingId, const std::string& category, const std::string& title, const std::string& status) {
	const int at = FindRow(state, listingId);
	if (status != "OPEN" && status != "open") {
		if (at >= 0) state.feed.erase(state.feed.begin() + at);
		return;
	}
	WonderlandLffQaRow row;
	row.listingId = listingId;
	row.category = category;
	row.title = title;
	row.status = "OPEN";
	if (at >= 0) state.feed[static_cast<size_t>(at)] = row;
	else state.feed.push_back(row);
}

std::string Trim(const std::string& value) {
	size_t begin = 0;
	while (begin < value.size() && (value[begin] == ' ' || value[begin] == '\t')) ++begin;
	size_t end = value.size();
	while (end > begin && (value[end - 1] == ' ' || value[end - 1] == '\t')) --end;
	return value.substr(begin, end - begin);
}

void SplitHead(const std::string& text, std::string& head, std::string& rest) {
	const size_t space = text.find(' ');
	if (space == std::string::npos) {
		head = text;
		rest.clear();
		return;
	}
	head = text.substr(0, space);
	rest = Trim(text.substr(space + 1));
}

bool IsClearFilter(const std::string& value) {
	std::string lower;
	lower.reserve(value.size());
	for (unsigned char c : value) lower.push_back(static_cast<char>(std::tolower(c)));
	return lower == "all" || lower == "none" || lower == "clear";
}

// A quoted title or message, or the raw remainder when the console already
// stripped the quotes. An unclosed quote is refused. Nothing is invented.
bool ParseOptionalText(const std::string& rest, std::string& text, std::string& error) {
	text.clear();
	if (rest.empty()) return true;
	if (rest[0] != '"' && rest[0] != '\'') {
		text = rest;
		return true;
	}
	const char quote = rest[0];
	for (size_t i = 1; i < rest.size(); ++i) {
		if (rest[i] == '\\' && i + 1 < rest.size()) {
			text.push_back(rest[++i]);
			continue;
		}
		if (rest[i] == quote) {
			if (!Trim(rest.substr(i + 1)).empty()) {
				error = "invalid_command";
				return false;
			}
			return true;
		}
		text.push_back(rest[i]);
	}
	error = "invalid_command";
	return false;
}

bool EndsWith(const std::string& value, const char* suffix) {
	const std::string tail(suffix);
	return value.size() >= tail.size() && value.compare(value.size() - tail.size(), tail.size(), tail) == 0;
}

std::string ActionRequestId(const std::string& path, const char* action) {
	const std::string prefix = "/lff/requests/";
	const std::string suffix = std::string("/") + action;
	if (path.size() <= prefix.size() + suffix.size()) return std::string();
	if (path.compare(0, prefix.size(), prefix) != 0 || !EndsWith(path, suffix.c_str())) return std::string();
	const std::string id = path.substr(prefix.size(), path.size() - prefix.size() - suffix.size());
	return WonderlandLffQaIsId(id) ? id : std::string();
}

int FindRequest(const WonderlandLffQaState& state, const std::string& requestId) {
	for (size_t i = 0; i < state.requests.size(); ++i) if (state.requests[i].requestId == requestId) return static_cast<int>(i);
	return -1;
}

bool CarriesNote(const std::string& event) {
	return event == WONDERLAND_LFF_EVENT_POSTED || event == WONDERLAND_LFF_EVENT_SEEN
		|| event == WONDERLAND_LFF_EVENT_CONNECT_REQUESTED || event == WONDERLAND_LFF_EVENT_CONNECT_RECEIVED
		|| event == WONDERLAND_LFF_EVENT_CONNECT_ACCEPTED || event == WONDERLAND_LFF_EVENT_CONNECT_DECLINED
		|| event == WONDERLAND_LFF_EVENT_CONNECT_ACCEPTED_SEEN || event == WONDERLAND_LFF_EVENT_CONNECT_DECLINED_SEEN;
}

std::string RowTitle(const WonderlandLffQaState& state, const std::string& listingId) {
	const int at = FindRow(state, listingId);
	return at >= 0 ? state.feed[static_cast<size_t>(at)].title : std::string();
}

}  // namespace WonderlandLffQaTraceDetail

bool WonderlandLffQaIsCategoryToken(const std::string& category) {
	using namespace WonderlandLffQaTraceDetail;
	return Equals(category, "TEAMS") || Equals(category, "BUILDERS") || Equals(category, "AI_ENGINEERS")
		|| Equals(category, "DESIGNERS") || Equals(category, "COMPETITORS") || Equals(category, "COLLABORATORS");
}

std::string WonderlandLffQaCategoryToken(const std::string& category) {
	if (WonderlandLffQaIsCategoryToken(category)) return category;
	if (category == "teams") return "TEAMS";
	if (category == "builders") return "BUILDERS";
	if (category == "ai_engineers") return "AI_ENGINEERS";
	if (category == "designers") return "DESIGNERS";
	if (category == "competitors") return "COMPETITORS";
	if (category == "collaborators") return "COLLABORATORS";
	return std::string();
}

bool WonderlandLffQaIsId(const std::string& id) {
	if (id.empty() || id.size() > 80) return false;
	for (unsigned char c : id) {
		const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
		if (!ok) return false;
	}
	return true;
}

std::string WonderlandLffQaSocialUrl(const std::string& baseUrl, const std::string& path) {
	std::string base = baseUrl;
	while (!base.empty() && base.back() == '/') base.pop_back();
	std::string suffix = path;
	if (suffix.empty() || suffix[0] != '/') suffix.insert(suffix.begin(), '/');
	return base + "/relay-api/wonderland/social" + suffix;
}

WonderlandLffQaCall WonderlandLffQaBuildCreate(const std::string& baseUrl, const std::string& category, const std::string& title, const std::string& description) {
	using namespace WonderlandLffQaTraceDetail;
	const std::string token = WonderlandLffQaCategoryToken(category);
	if (token.empty()) return Reject("invalid_category");
	WonderlandLffQaCall call = Ready("POST", baseUrl, "/lff/posts",
		std::string("{\"category\":") + JsonString(token) + ",\"title\":" + JsonString(title)
		+ ",\"description\":" + JsonString(description) + ",\"projectLabel\":\"\",\"skills\":[],\"openSlots\":1}");
	call.category = token;
	call.title = title;
	return call;
}

WonderlandLffQaCall WonderlandLffQaBuildFeed(const std::string& baseUrl, const std::string& categoryToken) {
	using namespace WonderlandLffQaTraceDetail;
	// all / none / clear ask for the unfiltered feed. The view's empty Category
	// is that read. The trace line says ALL; the query does not.
	if (IsClearFilter(categoryToken)) {
		WonderlandLffQaCall call = Ready("GET", baseUrl, "/lff/posts?limit=50", "");
		call.path = "/lff/posts";
		call.category = "ALL";
		return call;
	}
	if (!WonderlandLffQaIsCategoryToken(categoryToken)) return Reject("invalid_category");
	WonderlandLffQaCall call = Ready("GET", baseUrl, std::string("/lff/posts?limit=50&category=") + categoryToken, "");
	call.path = "/lff/posts";
	call.category = categoryToken;
	return call;
}

WonderlandLffQaCall WonderlandLffQaBuildClose(const std::string& baseUrl, const std::string& listingId) {
	using namespace WonderlandLffQaTraceDetail;
	if (!WonderlandLffQaIsId(listingId)) return Reject("invalid_id");
	WonderlandLffQaCall call = Ready("POST", baseUrl, "/lff/posts/" + listingId + "/close", "{}");
	call.listingId = listingId;
	return call;
}

WonderlandLffQaCall WonderlandLffQaBuildRequest(const std::string& baseUrl, const std::string& listingId, const std::string& message) {
	using namespace WonderlandLffQaTraceDetail;
	if (!WonderlandLffQaIsId(listingId)) return Reject("invalid_id");
	WonderlandLffQaCall call = Ready("POST", baseUrl, "/lff/posts/" + listingId + "/requests",
		std::string("{\"message\":") + JsonString(message) + "}");
	call.listingId = listingId;
	call.message = message;
	return call;
}

WonderlandLffQaCall WonderlandLffQaBuildAccept(const std::string& baseUrl, const std::string& requestId) {
	using namespace WonderlandLffQaTraceDetail;
	if (!WonderlandLffQaIsId(requestId)) return Reject("invalid_id");
	WonderlandLffQaCall call = Ready("POST", baseUrl, "/lff/requests/" + requestId + "/accept", "{}");
	call.listingId = requestId;
	return call;
}

WonderlandLffQaCall WonderlandLffQaBuildDecline(const std::string& baseUrl, const std::string& requestId) {
	using namespace WonderlandLffQaTraceDetail;
	if (!WonderlandLffQaIsId(requestId)) return Reject("invalid_id");
	WonderlandLffQaCall call = Ready("POST", baseUrl, "/lff/requests/" + requestId + "/decline", "{}");
	call.listingId = requestId;
	return call;
}

WonderlandLffQaCall WonderlandLffQaBuildInbox(const std::string& baseUrl, const std::string& listingId) {
	using namespace WonderlandLffQaTraceDetail;
	if (!WonderlandLffQaIsId(listingId)) return Reject("invalid_id");
	WonderlandLffQaCall call = Ready("GET", baseUrl, "/lff/posts/" + listingId + "/requests", "");
	call.listingId = listingId;
	return call;
}

std::string WonderlandLffQaFormatLine(const WonderlandLffQaEvent& event) {
	using namespace WonderlandLffQaTraceDetail;
	std::string out = "{\"ts_utc_ms\":";
	out += std::to_string(event.tsUtcMs);
	out += ",\"client_role\":";
	AppendEscaped(out, event.clientRole);
	out += ",\"net_id\":";
	AppendEscaped(out, event.netId);
	out += ",\"build_sha\":";
	AppendEscaped(out, event.buildSha);
	out += ",\"corr_id\":";
	AppendEscaped(out, event.corrId);
	out += ",\"event\":";
	AppendEscaped(out, event.event);
	out += ",\"listing_id\":";
	AppendEscaped(out, event.listingId);
	out += ",\"category\":";
	AppendEscaped(out, event.category);
	out += ",\"seen_by\":";
	AppendEscaped(out, event.seenBy);
	if (CarriesNote(event.event)) {
		out += ",\"title\":";
		AppendEscaped(out, event.title);
		out += ",\"message\":";
		AppendEscaped(out, event.message);
	}
	if (event.event == WONDERLAND_LFF_EVENT_HEARTBEAT) {
		// No LFF server clock is consulted. Both fields stay empty on purpose.
		out += ",\"server_offset_ms\":\"\",\"rtt_ms\":\"\"";
	}
	out += "}";
	return out;
}

void WonderlandLffQaEmit(WonderlandLffQaLog& log, const std::string& event, const std::string& listingId, const std::string& category, const std::string& title, const std::string& message) {
	if (!log.enabled || log.nowUtcMs == nullptr) return;
	WonderlandLffQaEvent row;
	row.tsUtcMs = log.nowUtcMs(log.clockUser);
	row.clientRole = log.clientRole;
	row.netId = log.netId;
	row.buildSha = log.buildSha;
	row.corrId = listingId;
	row.event = event;
	row.listingId = listingId;
	row.category = category;
	row.seenBy = log.clientRole;
	row.title = title;
	row.message = message;
	log.lines.push_back(WonderlandLffQaFormatLine(row));
}

namespace WonderlandLffQaTraceDetail {

void ObserveOwn(WonderlandLffQaState& state, WonderlandLffQaLog& log, const std::string& requestId, const std::string& listingId, const std::string& category, const std::string& title, const std::string& message, const std::string& status) {
	if (!WonderlandLffQaIsId(requestId)) return;
	const int at = FindRequest(state, requestId);
	const std::string previous = at >= 0 ? state.requests[static_cast<size_t>(at)].status : std::string();
	std::string keptListing = listingId;
	std::string keptCategory = category;
	std::string keptMessage = message;
	if (at >= 0) {
		if (keptListing.empty()) keptListing = state.requests[static_cast<size_t>(at)].listingId;
		if (keptCategory.empty()) keptCategory = state.requests[static_cast<size_t>(at)].category;
		if (keptMessage.empty()) keptMessage = state.requests[static_cast<size_t>(at)].message;
	}
	std::string keptTitle = title.empty() ? RowTitle(state, keptListing) : title;
	if (at >= 0) {
		WonderlandLffQaRequest& slot = state.requests[static_cast<size_t>(at)];
		if (!keptListing.empty()) slot.listingId = keptListing;
		if (!keptCategory.empty()) slot.category = keptCategory;
		if (!message.empty()) slot.message = message;
		if (!status.empty()) slot.status = status;
	} else {
		WonderlandLffQaRequest created;
		created.requestId = requestId;
		created.listingId = keptListing;
		created.category = keptCategory;
		created.requesterId = state.playerId;
		created.status = status;
		created.message = keptMessage;
		state.requests.push_back(created);
	}
	if (status == "ACCEPTED" && previous != "ACCEPTED") WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_CONNECT_ACCEPTED_SEEN, keptListing, keptCategory, keptTitle, keptMessage);
	else if (status == "DECLINED" && previous != "DECLINED") WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_CONNECT_DECLINED_SEEN, keptListing, keptCategory, keptTitle, keptMessage);
}

}  // namespace WonderlandLffQaTraceDetail

bool WonderlandLffQaApply(WonderlandLffQaState& state, WonderlandLffQaLog& log, const WonderlandLffQaCall& call, const std::string& dataJson) {
	using namespace WonderlandLffQaTraceDetail;
	JVal root;
	Parser parser(dataJson);
	if (!parser.Parse(root) || root.kind != JVal::Obj) {
		state.lastError = "invalid_response";
		return false;
	}
	const bool mine = call.method == "GET" && call.path == "/lff/requests";
	const bool inbox = call.method == "GET" && !mine && call.path.find("/requests") != std::string::npos;
	const bool feed = call.method == "GET" && call.path == "/lff/posts";
	if (feed) {
		const JVal* posts = Field(root, "posts");
		if (posts == nullptr || posts->kind != JVal::Arr) {
			state.lastError = "invalid_response";
			return false;
		}
		struct Note { std::string requestId, listingId, category, title, status; };
		std::vector<WonderlandLffQaRow> next;
		std::vector<Note> notes;
		for (const JVal& item : posts->arr) {
			if (item.kind != JVal::Obj) { state.lastError = "invalid_response"; return false; }
			WonderlandLffQaRow row;
			row.listingId = FieldStr(item, "postId");
			row.category = FieldStr(item, "category");
			row.title = FieldStr(item, "title");
			row.status = FieldStr(item, "status");
			if (!WonderlandLffQaIsId(row.listingId) || !WonderlandLffQaIsCategoryToken(row.category)) {
				state.lastError = "invalid_response";
				return false;
			}
			const JVal* viewer = Field(item, "viewerRequest");
			if (viewer != nullptr && viewer->kind != JVal::Null) {
				if (viewer->kind != JVal::Obj) { state.lastError = "invalid_response"; return false; }
				notes.push_back(Note{FieldStr(*viewer, "requestId"), row.listingId, row.category, row.title, FieldStr(*viewer, "status")});
			}
			next.push_back(row);
		}
		for (const WonderlandLffQaRow& row : next) {
			if (FindRow(state, row.listingId) < 0) WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_SEEN, row.listingId, row.category, row.title, "");
		}
		for (const WonderlandLffQaRow& row : state.feed) {
			bool still = false;
			for (const WonderlandLffQaRow& kept : next) if (kept.listingId == row.listingId) still = true;
			if (!still) WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_REMOVED_SEEN, row.listingId, row.category);
		}
		state.feed.clear();
		for (const WonderlandLffQaRow& row : next) if (row.status == "OPEN") state.feed.push_back(row);
		for (const Note& note : notes) ObserveOwn(state, log, note.requestId, note.listingId, note.category, note.title, "", note.status);
		state.lastError.clear();
		return true;
	}
	if (call.method == "POST" && call.path == "/lff/posts") {
		const std::string postId = FieldStr(root, "postId");
		if (!WonderlandLffQaIsId(postId)) { state.lastError = "invalid_response"; return false; }
		const std::string title = call.title.empty() ? std::string("QA ") + call.category : call.title;
		UpsertOpen(state, postId, call.category, title, "OPEN");
		WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_POSTED, postId, call.category, title, "");
		state.lastError.clear();
		return true;
	}
	if (call.method == "POST" && call.path.size() > 6 && call.path.compare(call.path.size() - 6, 6, "/close") == 0) {
		const std::string listingId = call.listingId.empty() ? FieldStr(root, "postId") : call.listingId;
		std::string category = call.category;
		const int at = FindRow(state, listingId);
		if (category.empty() && at >= 0) category = state.feed[static_cast<size_t>(at)].category;
		if (at >= 0) state.feed.erase(state.feed.begin() + at);
		WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_WITHDRAWN, listingId, category);
		state.lastError.clear();
		return true;
	}
	if (call.method == "POST" && call.path.size() > 9 && call.path.compare(call.path.size() - 9, 9, "/requests") == 0) {
		const std::string requestId = FieldStr(root, "requestId");
		if (!WonderlandLffQaIsId(requestId)) { state.lastError = "invalid_response"; return false; }
		std::string category = call.category;
		const int at = FindRow(state, call.listingId);
		if (category.empty() && at >= 0) category = state.feed[static_cast<size_t>(at)].category;
		const std::string title = at >= 0 ? state.feed[static_cast<size_t>(at)].title : std::string();
		WonderlandLffQaRequest request;
		request.requestId = requestId;
		request.listingId = call.listingId;
		request.category = category;
		request.requesterId = state.playerId;
		request.status = "PENDING";
		request.message = call.message;
		state.requests.push_back(request);
		WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_CONNECT_REQUESTED, call.listingId, category, title, call.message);
		state.lastError.clear();
		return true;
	}
	const std::string acceptedId = call.method == "POST" ? ActionRequestId(call.path, "accept") : std::string();
	const std::string declinedId = call.method == "POST" ? ActionRequestId(call.path, "decline") : std::string();
	const bool responsePath = call.method == "POST" && call.path.compare(0, 14, "/lff/requests/") == 0 && (EndsWith(call.path, "/accept") || EndsWith(call.path, "/decline"));
	if (responsePath) {
		const std::string requestId = !acceptedId.empty() ? acceptedId : declinedId;
		if (requestId.empty()) { state.lastError = "invalid_response"; return false; }
		const bool accepted = !acceptedId.empty();
		const int at = FindRequest(state, requestId);
		const std::string listingId = at >= 0 ? state.requests[static_cast<size_t>(at)].listingId : std::string();
		const std::string category = at >= 0 ? state.requests[static_cast<size_t>(at)].category : std::string();
		const std::string message = at >= 0 ? state.requests[static_cast<size_t>(at)].message : std::string();
		const std::string title = RowTitle(state, listingId);
		if (at >= 0) state.requests[static_cast<size_t>(at)].status = accepted ? "ACCEPTED" : "DECLINED";
		else {
			WonderlandLffQaRequest created;
			created.requestId = requestId;
			created.status = accepted ? "ACCEPTED" : "DECLINED";
			state.requests.push_back(created);
		}
		WonderlandLffQaEmit(log, accepted ? WONDERLAND_LFF_EVENT_CONNECT_ACCEPTED : WONDERLAND_LFF_EVENT_CONNECT_DECLINED, listingId, category, title, message);
		state.lastError.clear();
		return true;
	}
	if (mine) {
		const JVal* requests = Field(root, "requests");
		if (requests == nullptr || requests->kind != JVal::Arr) { state.lastError = "invalid_response"; return false; }
		for (const JVal& item : requests->arr) {
			if (item.kind != JVal::Obj) { state.lastError = "invalid_response"; return false; }
			std::string category = FieldStr(item, "category");
			std::string title = FieldStr(item, "title");
			const JVal* post = Field(item, "post");
			if (post != nullptr && post->kind == JVal::Obj) {
				if (category.empty()) category = FieldStr(*post, "category");
				if (title.empty()) title = FieldStr(*post, "title");
			}
			ObserveOwn(state, log, FieldStr(item, "requestId"), FieldStr(item, "postId"), category, title, FieldStr(item, "message"), FieldStr(item, "status"));
		}
		state.lastError.clear();
		return true;
	}
	if (inbox) {
		const JVal* requests = Field(root, "requests");
		if (requests == nullptr || requests->kind != JVal::Arr) { state.lastError = "invalid_response"; return false; }
		for (const JVal& item : requests->arr) {
			if (item.kind != JVal::Obj) { state.lastError = "invalid_response"; return false; }
			const std::string requestId = FieldStr(item, "requestId");
			const JVal* requester = Field(item, "requester");
			const std::string requesterId = requester != nullptr ? FieldStr(*requester, "userId") : FieldStr(item, "requesterId");
			const std::string listingId = FieldStr(item, "postId").empty() ? call.listingId : FieldStr(item, "postId");
			std::string category = FieldStr(item, "category");
			if (category.empty()) {
				const int at = FindRow(state, listingId);
				if (at >= 0) category = state.feed[static_cast<size_t>(at)].category;
			}
			const std::string message = FieldStr(item, "message");
			const std::string status = FieldStr(item, "status");
			const std::string title = RowTitle(state, listingId);
			if (!requesterId.empty() && requesterId == state.playerId) {
				ObserveOwn(state, log, requestId, listingId, category, title, message, status);
				continue;
			}
			bool known = false;
			for (const WonderlandLffQaRequest& prior : state.requests) if (prior.requestId == requestId) known = true;
			if (!known && !requesterId.empty() && (status.empty() || status == "PENDING")) {
				WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_CONNECT_RECEIVED, listingId, category, title, message);
			}
			if (!known) {
				WonderlandLffQaRequest request;
				request.requestId = requestId;
				request.listingId = listingId;
				request.category = category;
				request.requesterId = requesterId;
				request.status = status;
				request.message = message;
				state.requests.push_back(request);
			}
		}
		state.lastError.clear();
		return true;
	}
	state.lastError = "invalid_response";
	return false;
}

std::string WonderlandLffQaDump(const WonderlandLffQaState& state, const WonderlandLffQaLog& log) {
	using namespace WonderlandLffQaTraceDetail;
	std::string out = "{\"client_role\":";
	AppendEscaped(out, log.clientRole);
	out += ",\"category_filter\":";
	AppendEscaped(out, state.categoryFilter);
	out += ",\"feed\":[";
	for (size_t i = 0; i < state.feed.size(); ++i) {
		if (i != 0) out += ',';
		out += "{\"listing_id\":";
		AppendEscaped(out, state.feed[i].listingId);
		out += ",\"category\":";
		AppendEscaped(out, state.feed[i].category);
		out += ",\"title\":";
		AppendEscaped(out, state.feed[i].title);
		out += ",\"status\":";
		AppendEscaped(out, state.feed[i].status);
		out += '}';
	}
	out += "],\"requests\":[";
	for (size_t i = 0; i < state.requests.size(); ++i) {
		if (i != 0) out += ',';
		out += "{\"request_id\":";
		AppendEscaped(out, state.requests[i].requestId);
		out += ",\"listing_id\":";
		AppendEscaped(out, state.requests[i].listingId);
		out += ",\"category\":";
		AppendEscaped(out, state.requests[i].category);
		out += ",\"requester_id\":";
		AppendEscaped(out, state.requests[i].requesterId);
		out += ",\"status\":";
		AppendEscaped(out, state.requests[i].status);
		out += ",\"message\":";
		AppendEscaped(out, state.requests[i].message);
		out += '}';
	}
	out += "]}";
	return out;
}

enum class WonderlandLffQaCommandKind { Unknown, Dump, Post, Withdraw, Filter, Request, Accept, Decline };

struct WonderlandLffQaParsed {
	WonderlandLffQaCommandKind kind = WonderlandLffQaCommandKind::Unknown;
	std::string error;
	WonderlandLffQaCall call;
};

WonderlandLffQaParsed WonderlandLffQaParse(const std::string& baseUrl, const std::string& line) {
	using namespace WonderlandLffQaTraceDetail;
	WonderlandLffQaParsed parsed;
	const std::string text = Trim(line);
	std::string name;
	std::string arg;
	SplitHead(text, name, arg);
	if (name == WONDERLAND_LFF_QA_DUMP) {
		parsed.kind = WonderlandLffQaCommandKind::Dump;
		if (!arg.empty()) parsed.error = "invalid_command";
		return parsed;
	}
	if (name == WONDERLAND_LFF_QA_POST) {
		parsed.kind = WonderlandLffQaCommandKind::Post;
		std::string category;
		std::string titleText;
		std::string title;
		SplitHead(arg, category, titleText);
		if (!ParseOptionalText(titleText, title, parsed.error)) return parsed;
		const std::string token = WonderlandLffQaCategoryToken(category);
		if (titleText.empty()) title = std::string("QA ") + (token.empty() ? category : token);
		parsed.call = WonderlandLffQaBuildCreate(baseUrl, category, title, "QA listing");
	} else if (name == WONDERLAND_LFF_QA_WITHDRAW) {
		parsed.kind = WonderlandLffQaCommandKind::Withdraw;
		parsed.call = WonderlandLffQaBuildClose(baseUrl, arg);
	} else if (name == WONDERLAND_LFF_QA_FILTER) {
		parsed.kind = WonderlandLffQaCommandKind::Filter;
		parsed.call = WonderlandLffQaBuildFeed(baseUrl, IsClearFilter(arg) ? arg : WonderlandLffQaCategoryToken(arg));
	} else if (name == WONDERLAND_LFF_QA_REQUEST) {
		parsed.kind = WonderlandLffQaCommandKind::Request;
		std::string id;
		std::string messageText;
		std::string message;
		SplitHead(arg, id, messageText);
		if (!ParseOptionalText(messageText, message, parsed.error)) return parsed;
		if (messageText.empty()) message = "QA request";
		parsed.call = WonderlandLffQaBuildRequest(baseUrl, id, message);
	} else if (name == WONDERLAND_LFF_QA_ACCEPT) {
		parsed.kind = WonderlandLffQaCommandKind::Accept;
		parsed.call = WonderlandLffQaBuildAccept(baseUrl, arg);
	} else if (name == WONDERLAND_LFF_QA_DECLINE) {
		parsed.kind = WonderlandLffQaCommandKind::Decline;
		parsed.call = WonderlandLffQaBuildDecline(baseUrl, arg);
	} else {
		return parsed;
	}
	if (parsed.error.empty() && !parsed.call.ok) parsed.error = parsed.call.error;
	return parsed;
}

WonderlandLffQaCommandResult WonderlandLffQaRun(
	WonderlandLffQaState& state, WonderlandLffQaLog& log, const std::string& baseUrl, const std::string& line, const WonderlandLffQaExchange* exchange) {
	WonderlandLffQaCommandResult result;
	if (!log.enabled) {
		result.error = "qa_disabled";
		return result;
	}
	const WonderlandLffQaParsed parsed = WonderlandLffQaParse(baseUrl, line);
	if (parsed.kind == WonderlandLffQaCommandKind::Unknown) { result.error = "unknown_command"; return result; }
	if (!parsed.error.empty()) { result.error = parsed.error; return result; }
	if (parsed.kind == WonderlandLffQaCommandKind::Dump) {
		result.dump = WonderlandLffQaDump(state, log);
		result.accepted = true;
		return result;
	}
	WonderlandLffQaCall call = parsed.call;
	call.actorId = state.playerId;
	if (!call.ok) { result.error = call.error.empty() ? std::string("invalid_command") : call.error; return result; }
	if (exchange == nullptr || exchange->send == nullptr) { result.error = "transport_unavailable"; return result; }
	const std::string body = exchange->send(call, exchange->user);
	if (!WonderlandLffQaApply(state, log, call, body)) {
		result.error = state.lastError.empty() ? "invalid_response" : state.lastError;
		return result;
	}
	if (parsed.kind == WonderlandLffQaCommandKind::Filter) {
		state.categoryFilter = call.category == "ALL" ? std::string() : call.category;
		WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_FILTER, "", call.category);
	}
	result.accepted = true;
	return result;
}

bool WonderlandLffQaHeartbeat(WonderlandLffQaLog& log) {
	if (!log.enabled || log.nowUtcMs == nullptr) return false;
	const long long now = log.nowUtcMs(log.clockUser);
	constexpr long long kPeriodMs = 5000;
	if (log.heartbeatStarted && (now < log.lastHeartbeatUtcMs || now - log.lastHeartbeatUtcMs < kPeriodMs)) return false;
	log.heartbeatStarted = true;
	log.lastHeartbeatUtcMs = now;
	WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_HEARTBEAT, "", "");
	return !log.lines.empty() && log.lines.back().find(WONDERLAND_LFF_EVENT_HEARTBEAT) != std::string::npos;
}

#if defined(WITH_ENGINE) && !UE_BUILD_SHIPPING
#include "CoreMinimal.h"
#include "Containers/Ticker.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "HAL/IConsoleManager.h"
#include "Misc/DateTime.h"
#include "WonderlandSocialSubsystem.h"

namespace WonderlandLffQaTraceConsole {

WonderlandLffQaLog Log;
WonderlandLffQaState State;

long long QaNowUtcMs(void*) {
	const FDateTime Now = FDateTime::UtcNow();
	return static_cast<long long>(Now.ToUnixTimestamp()) * 1000LL + static_cast<long long>(Now.GetMillisecond());
}

std::string Narrow(const FString& Text) { return std::string(TCHAR_TO_UTF8(*Text)); }

UWonderlandSocialSubsystem* Social() {
	if (GEngine == nullptr) return nullptr;
	for (const FWorldContext& Context : GEngine->GetWorldContexts()) {
		UWorld* World = Context.World();
		if (World == nullptr || World->GetGameInstance() == nullptr) continue;
		if (UWonderlandSocialSubsystem* Found = World->GetGameInstance()->GetSubsystem<UWonderlandSocialSubsystem>()) return Found;
	}
	return nullptr;
}

void Prepare(UWonderlandSocialSubsystem* Sub) {
	Log.enabled = true;
	Log.nowUtcMs = &QaNowUtcMs;
	const IConsoleVariable* Role = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Qa.LFF.Role"));
	const IConsoleVariable* Net = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Qa.LFF.NetId"));
	const IConsoleVariable* Sha = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Qa.LFF.BuildSha"));
	Log.clientRole = Role != nullptr ? Narrow(Role->GetString()) : std::string("client");
	Log.netId = Net != nullptr ? Narrow(Net->GetString()) : std::string();
	Log.buildSha = Sha != nullptr ? Narrow(Sha->GetString()) : std::string();
	if (Sub != nullptr && Sub->GetSnapshot() != nullptr) State.playerId = Narrow(Sub->GetSnapshot()->ViewerId);
}

void LogNew(size_t Before) {
	for (size_t Index = Before; Index < Log.lines.size(); ++Index) {
		UE_LOG(LogTemp, Display, TEXT("%s"), UTF8_TO_TCHAR(Log.lines[Index].c_str()));
	}
}

void Refuse(const TCHAR* Why) {
	UE_LOG(LogTemp, Display, TEXT("wl.Qa.LFF refused: %s"), Why);
}

bool ApplyAnswer(const WonderlandLffQaCall& Call, const std::string& DataJson, bool bFilter) {
	const size_t Before = Log.lines.size();
	if (!WonderlandLffQaApply(State, Log, Call, DataJson)) {
		Refuse(UTF8_TO_TCHAR(State.lastError.empty() ? "invalid_response" : State.lastError.c_str()));
		return false;
	}
	if (bFilter) {
		State.categoryFilter = Call.category == "ALL" ? std::string() : Call.category;
		WonderlandLffQaEmit(Log, WONDERLAND_LFF_EVENT_FILTER, "", Call.category);
	}
	LogNew(Before);
	return true;
}

std::string FeedData(const FWonderlandLffFeedPage& Page) {
	using WonderlandLffQaTraceDetail::JsonString;
	std::string Out = "{\"posts\":[";
	for (int32 Index = 0; Index < Page.Posts.Num(); ++Index) {
		if (Index != 0) Out += ',';
		const FWonderlandLffPost& Post = Page.Posts[Index];
		Out += "{\"postId\":";
		Out += JsonString(Narrow(Post.PostId));
		Out += ",\"category\":";
		Out += JsonString(Narrow(Post.Category));
		Out += ",\"title\":";
		Out += JsonString(Narrow(Post.Title));
		Out += ",\"status\":";
		Out += JsonString(Narrow(Post.Status));
		if (Post.bHasViewerRequest) {
			Out += ",\"viewerRequest\":{\"requestId\":";
			Out += JsonString(Narrow(Post.ViewerRequestId));
			Out += ",\"status\":";
			Out += JsonString(Narrow(Post.ViewerRequestStatus));
			Out += '}';
		}
		Out += '}';
	}
	Out += "]}";
	return Out;
}

void OnWrite(const WonderlandLffQaCall Call, const FWonderlandLffAnswer& Answer, const FString& CreatedId, const char* IdField) {
	if (!Answer.IsOk()) {
		Refuse(Answer.Problem.IsEmpty() ? TEXT("not_ok") : *Answer.Problem);
		return;
	}
	std::string Data = "{}";
	if (IdField != nullptr) {
		using WonderlandLffQaTraceDetail::JsonString;
		Data = std::string("{\"") + IdField + "\":" + JsonString(Narrow(CreatedId)) + "}";
	}
	ApplyAnswer(Call, Data, false);
}

std::string MineData(const FWonderlandLffMyRequests& Mine) {
	using WonderlandLffQaTraceDetail::JsonString;
	std::string Out = "{\"requests\":[";
	for (int32 Index = 0; Index < Mine.Requests.Num(); ++Index) {
		if (Index != 0) Out += ',';
		const FWonderlandLffMyRequest& Row = Mine.Requests[Index];
		Out += "{\"requestId\":";
		Out += JsonString(Narrow(Row.RequestId));
		Out += ",\"postId\":";
		Out += JsonString(Narrow(Row.PostId));
		Out += ",\"status\":";
		Out += JsonString(Narrow(Row.Status));
		Out += ",\"message\":";
		Out += JsonString(Narrow(Row.Message));
		if (Row.bHasPost) {
			Out += ",\"category\":";
			Out += JsonString(Narrow(Row.Post.Category));
			Out += ",\"title\":";
			Out += JsonString(Narrow(Row.Post.Title));
		}
		Out += '}';
	}
	Out += "]}";
	return Out;
}

void ObserveMine(IWonderlandSocialService* Service) {
	if (Service == nullptr || Service->IsDevelopmentPreview()) return;
	Service->ReadLffMyRequests([](const FWonderlandLffAnswer& Answer, const FWonderlandLffMyRequests& Mine) {
		if (!Answer.IsOk()) return;
		WonderlandLffQaCall Call;
		Call.method = "GET";
		Call.path = "/lff/requests";
		Call.ok = true;
		ApplyAnswer(Call, MineData(Mine), false);
	});
}

void RunLine(const FString& Line) {
	UWonderlandSocialSubsystem* Sub = Social();
	Prepare(Sub);
	const WonderlandLffQaParsed Parsed = WonderlandLffQaParse("", Narrow(Line));
	if (Parsed.kind == WonderlandLffQaCommandKind::Unknown) { Refuse(TEXT("unknown_command")); return; }
	if (!Parsed.error.empty()) { Refuse(UTF8_TO_TCHAR(Parsed.error.c_str())); return; }
	if (Parsed.kind == WonderlandLffQaCommandKind::Dump) {
		const std::string Dump = WonderlandLffQaDump(State, Log);
		UE_LOG(LogTemp, Display, TEXT("%s"), UTF8_TO_TCHAR(Dump.c_str()));
		return;
	}
	WonderlandLffQaCall Call = Parsed.call;
	Call.actorId = State.playerId;
	if (!Call.ok) { Refuse(UTF8_TO_TCHAR(Call.error.c_str())); return; }
	IWonderlandSocialService* Service = Sub != nullptr ? Sub->GetService() : nullptr;
	if (Service == nullptr || Service->IsDevelopmentPreview()) {
		Refuse(TEXT("needs a live connection"));
		return;
	}
	if (Parsed.kind == WonderlandLffQaCommandKind::Post) {
		FWonderlandLffPostFields Fields;
		Fields.Category = UTF8_TO_TCHAR(Call.category.c_str());
		Fields.Title = UTF8_TO_TCHAR(Call.title.c_str());
		Fields.Description = TEXT("QA listing");
		Fields.OpenSlots = 1;
		Service->CreateLffPost(Fields, [Call](const FWonderlandLffAnswer& Answer, const FString& CreatedId) {
			OnWrite(Call, Answer, CreatedId, "postId");
		});
		return;
	}
	if (Parsed.kind == WonderlandLffQaCommandKind::Withdraw) {
		Service->ActOnLff(TEXT("lff.post.close"), UTF8_TO_TCHAR(Call.listingId.c_str()), [Call](const FWonderlandLffAnswer& Answer, const FString& CreatedId) {
			OnWrite(Call, Answer, CreatedId, nullptr);
		});
		return;
	}
	if (Parsed.kind == WonderlandLffQaCommandKind::Accept || Parsed.kind == WonderlandLffQaCommandKind::Decline) {
		const TCHAR* Operation = Parsed.kind == WonderlandLffQaCommandKind::Accept ? TEXT("lff.request.accept") : TEXT("lff.request.decline");
		Service->ActOnLff(Operation, UTF8_TO_TCHAR(Call.listingId.c_str()), [Call](const FWonderlandLffAnswer& Answer, const FString& CreatedId) {
			OnWrite(Call, Answer, CreatedId, nullptr);
		});
		return;
	}
	if (Parsed.kind == WonderlandLffQaCommandKind::Filter) {
		FWonderlandLffFeedQuery Query;
		Query.Category = Call.category == "ALL" ? FString() : UTF8_TO_TCHAR(Call.category.c_str());
		Query.Limit = 50;
		Service->ReadLffFeed(Query, [Call](const FWonderlandLffAnswer& Answer, const FWonderlandLffFeedPage& Page) {
			if (!Answer.IsOk()) {
				Refuse(Answer.Problem.IsEmpty() ? TEXT("not_ok") : *Answer.Problem);
				return;
			}
			ApplyAnswer(Call, FeedData(Page), true);
		});
		return;
	}
	Service->SendLffRequest(UTF8_TO_TCHAR(Call.listingId.c_str()), UTF8_TO_TCHAR(Call.message.c_str()), [Call](const FWonderlandLffAnswer& Answer, const FString& CreatedId) {
		OnWrite(Call, Answer, CreatedId, "requestId");
	});
}

static TAutoConsoleVariable<int32> EnabledFlag(TEXT("wl.Qa.LFF.Enabled"), 0, TEXT("Looking for Feed QA commands. Off at 0. Absent from a shipping build."));
static TAutoConsoleVariable<FString> RoleFlag(TEXT("wl.Qa.LFF.Role"), TEXT("client"), TEXT("client_role written on each Looking for Feed QA line."));
static TAutoConsoleVariable<FString> NetFlag(TEXT("wl.Qa.LFF.NetId"), TEXT(""), TEXT("net_id written on each Looking for Feed QA line."));
static TAutoConsoleVariable<FString> ShaFlag(TEXT("wl.Qa.LFF.BuildSha"), TEXT(""), TEXT("build_sha written on each Looking for Feed QA line."));

static void ArmHeartbeat();

static void Dispatch(const TArray<FString>& Args, const TCHAR* Command) {
	const IConsoleVariable* Flag = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Qa.LFF.Enabled"));
	if (Flag == nullptr || Flag->GetInt() != 1) {
		UE_LOG(LogTemp, Display, TEXT("%s refused: qa_disabled"), Command);
		return;
	}
	FString Line = Command;
	for (const FString& Arg : Args) Line += TEXT(" ") + Arg;
	RunLine(Line);
	ArmHeartbeat();
}

static FTSTicker::FDelegateHandle GHeartbeat;

static bool HeartbeatTick(float) {
	IConsoleVariable* Flag = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Qa.LFF.Enabled"));
	if (Flag == nullptr || Flag->GetInt() != 1) {
		GHeartbeat.Reset();
		return false;
	}
	UWonderlandSocialSubsystem* Sub = Social();
	Prepare(Sub);
	const size_t Before = Log.lines.size();
	const bool Beat = WonderlandLffQaHeartbeat(Log);
	LogNew(Before);
	if (Beat) {
		IWonderlandSocialService* Service = Sub != nullptr ? Sub->GetService() : nullptr;
		ObserveMine(Service);
	}
	return true;
}

static void ArmHeartbeat() {
	if (GHeartbeat.IsValid()) return;
	GHeartbeat = FTSTicker::GetCoreTicker().AddTicker(FTickerDelegate::CreateStatic(&HeartbeatTick), 1.0f);
}

static void OnQaEnabled(IConsoleVariable* Var) {
	if (Var != nullptr && Var->GetInt() == 1) ArmHeartbeat();
}

static FAutoConsoleCommandWithArgs PostCommand(TEXT("wl.Qa.LFF.Post"), TEXT("Post a Looking for Feed listing: wl.Qa.LFF.Post <category> [title...]. Off unless wl.Qa.LFF.Enabled is 1."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Post")); }));
static FAutoConsoleCommandWithArgs WithdrawCommand(TEXT("wl.Qa.LFF.Withdraw"), TEXT("Withdraw a Looking for Feed listing: wl.Qa.LFF.Withdraw <id>."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Withdraw")); }));
static FAutoConsoleCommandWithArgs FilterCommand(TEXT("wl.Qa.LFF.Filter"), TEXT("Filter the Looking for Feed: wl.Qa.LFF.Filter <category>, or all, none, or clear."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Filter")); }));
static FAutoConsoleCommandWithArgs RequestCommand(TEXT("wl.Qa.LFF.Request"), TEXT("Request to join a Looking for Feed listing: wl.Qa.LFF.Request <id> [message...]."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Request")); }));
static FAutoConsoleCommandWithArgs AcceptCommand(TEXT("wl.Qa.LFF.Accept"), TEXT("Accept a Looking for Feed request: wl.Qa.LFF.Accept <id>."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Accept")); }));
static FAutoConsoleCommandWithArgs DeclineCommand(TEXT("wl.Qa.LFF.Decline"), TEXT("Decline a Looking for Feed request: wl.Qa.LFF.Decline <id>."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Decline")); }));
static FAutoConsoleCommandWithArgs DumpCommand(TEXT("wl.Qa.LFF.Dump"), TEXT("Print the current Looking for Feed QA state as one JSON line."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Dump")); }));

static struct FQaHeartbeatHook {
	FQaHeartbeatHook() {
		if (IConsoleVariable* Var = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Qa.LFF.Enabled"))) {
			Var->SetOnChangedCallback(FConsoleVariableDelegate::CreateStatic(&OnQaEnabled));
		}
	}
} GQaHeartbeatHook;

}  // namespace WonderlandLffQaTraceConsole
#endif
