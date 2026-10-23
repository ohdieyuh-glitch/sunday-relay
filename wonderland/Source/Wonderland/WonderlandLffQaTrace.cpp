#include "WonderlandLffQaTrace.h"

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
	return call;
}

WonderlandLffQaCall WonderlandLffQaBuildFeed(const std::string& baseUrl, const std::string& categoryToken) {
	using namespace WonderlandLffQaTraceDetail;
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
	out += "}";
	return out;
}

void WonderlandLffQaEmit(WonderlandLffQaLog& log, const std::string& event, const std::string& listingId, const std::string& category) {
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
	log.lines.push_back(WonderlandLffQaFormatLine(row));
}

bool WonderlandLffQaApply(WonderlandLffQaState& state, WonderlandLffQaLog& log, const WonderlandLffQaCall& call, const std::string& dataJson) {
	using namespace WonderlandLffQaTraceDetail;
	JVal root;
	Parser parser(dataJson);
	if (!parser.Parse(root) || root.kind != JVal::Obj) {
		state.lastError = "invalid_response";
		return false;
	}
	const bool inbox = call.method == "GET" && call.path.find("/requests") != std::string::npos;
	const bool feed = call.method == "GET" && call.path == "/lff/posts";
	if (feed) {
		const JVal* posts = Field(root, "posts");
		if (posts == nullptr || posts->kind != JVal::Arr) {
			state.lastError = "invalid_response";
			return false;
		}
		std::vector<WonderlandLffQaRow> next;
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
			next.push_back(row);
		}
		for (const WonderlandLffQaRow& row : next) {
			if (FindRow(state, row.listingId) < 0) WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_SEEN, row.listingId, row.category);
		}
		for (const WonderlandLffQaRow& row : state.feed) {
			bool still = false;
			for (const WonderlandLffQaRow& kept : next) if (kept.listingId == row.listingId) still = true;
			if (!still) WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_REMOVED_SEEN, row.listingId, row.category);
		}
		state.feed.clear();
		for (const WonderlandLffQaRow& row : next) if (row.status == "OPEN") state.feed.push_back(row);
		state.lastError.clear();
		return true;
	}
	if (call.method == "POST" && call.path == "/lff/posts") {
		const std::string postId = FieldStr(root, "postId");
		if (!WonderlandLffQaIsId(postId)) { state.lastError = "invalid_response"; return false; }
		UpsertOpen(state, postId, call.category, "QA " + call.category, "OPEN");
		WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_POSTED, postId, call.category);
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
		WonderlandLffQaRequest request;
		request.requestId = requestId;
		request.listingId = call.listingId;
		request.category = category;
		request.requesterId = state.playerId;
		request.status = "PENDING";
		state.requests.push_back(request);
		WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_CONNECT_REQUESTED, call.listingId, category);
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
			bool known = false;
			for (const WonderlandLffQaRequest& prior : state.requests) if (prior.requestId == requestId) known = true;
			if (!known && !requesterId.empty() && requesterId != state.playerId) {
				WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_CONNECT_RECEIVED, listingId, category);
			}
			if (!known) {
				WonderlandLffQaRequest request;
				request.requestId = requestId;
				request.listingId = listingId;
				request.category = category;
				request.requesterId = requesterId;
				request.status = FieldStr(item, "status");
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
		out += '}';
	}
	out += "]}";
	return out;
}

WonderlandLffQaCommandResult WonderlandLffQaRun(
	WonderlandLffQaState& state, WonderlandLffQaLog& log, const std::string& baseUrl, const std::string& line, const WonderlandLffQaExchange* exchange) {
	using namespace WonderlandLffQaTraceDetail;
	WonderlandLffQaCommandResult result;
	if (!log.enabled) {
		result.error = "qa_disabled";
		return result;
	}
	const std::string text = Trim(line);
	const size_t space = text.find(' ');
	const std::string name = space == std::string::npos ? text : text.substr(0, space);
	const std::string arg = space == std::string::npos ? std::string() : Trim(text.substr(space + 1));
	if (name == WONDERLAND_LFF_QA_DUMP) {
		if (!arg.empty()) { result.error = "invalid_command"; return result; }
		result.dump = WonderlandLffQaDump(state, log);
		result.accepted = true;
		return result;
	}
	WonderlandLffQaCall call;
	bool filter = false;
	if (name == WONDERLAND_LFF_QA_POST) {
		const std::string token = WonderlandLffQaCategoryToken(arg);
		call = WonderlandLffQaBuildCreate(baseUrl, arg, "QA " + (token.empty() ? arg : token), "QA listing");
	} else if (name == WONDERLAND_LFF_QA_WITHDRAW) {
		call = WonderlandLffQaBuildClose(baseUrl, arg);
	} else if (name == WONDERLAND_LFF_QA_FILTER) {
		call = WonderlandLffQaBuildFeed(baseUrl, WonderlandLffQaCategoryToken(arg));
		filter = true;
	} else if (name == WONDERLAND_LFF_QA_REQUEST) {
		call = WonderlandLffQaBuildRequest(baseUrl, arg, "QA request");
	} else {
		result.error = "unknown_command";
		return result;
	}
	if (!call.ok) { result.error = call.error; return result; }
	if (exchange == nullptr || exchange->send == nullptr) { result.error = "transport_unavailable"; return result; }
	const std::string body = exchange->send(call, exchange->user);
	if (!WonderlandLffQaApply(state, log, call, body)) {
		result.error = state.lastError.empty() ? "invalid_response" : state.lastError;
		return result;
	}
	if (filter) {
		state.categoryFilter = call.category;
		WonderlandLffQaEmit(log, WONDERLAND_LFF_EVENT_FILTER, "", call.category);
	}
	result.accepted = true;
	return result;
}

#if defined(WITH_ENGINE) && !UE_BUILD_SHIPPING
#include "CoreMinimal.h"
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
		State.categoryFilter = Call.category;
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

void RunLine(const FString& Line) {
	UWonderlandSocialSubsystem* Sub = Social();
	Prepare(Sub);
	FString Text = Line.TrimStartAndEnd();
	FString Name;
	FString Arg;
	int32 Space = INDEX_NONE;
	if (Text.FindChar(TEXT(' '), Space)) {
		Name = Text.Left(Space);
		Arg = Text.Mid(Space + 1).TrimStartAndEnd();
	} else {
		Name = Text;
	}
	if (Name == TEXT("wl.Qa.LFF.Dump")) {
		if (!Arg.IsEmpty()) { Refuse(TEXT("invalid_command")); return; }
		const std::string Dump = WonderlandLffQaDump(State, Log);
		UE_LOG(LogTemp, Display, TEXT("%s"), UTF8_TO_TCHAR(Dump.c_str()));
		return;
	}
	const std::string ArgText = Narrow(Arg);
	WonderlandLffQaCall Call;
	bool bFilter = false;
	if (Name == TEXT("wl.Qa.LFF.Post")) {
		const std::string Token = WonderlandLffQaCategoryToken(ArgText);
		Call = WonderlandLffQaBuildCreate("", ArgText, std::string("QA ") + (Token.empty() ? ArgText : Token), "QA listing");
	} else if (Name == TEXT("wl.Qa.LFF.Withdraw")) {
		Call = WonderlandLffQaBuildClose("", ArgText);
	} else if (Name == TEXT("wl.Qa.LFF.Filter")) {
		Call = WonderlandLffQaBuildFeed("", WonderlandLffQaCategoryToken(ArgText));
		bFilter = true;
	} else if (Name == TEXT("wl.Qa.LFF.Request")) {
		Call = WonderlandLffQaBuildRequest("", ArgText, "QA request");
	} else {
		Refuse(TEXT("unknown_command"));
		return;
	}
	if (!Call.ok) {
		Refuse(UTF8_TO_TCHAR(Call.error.c_str()));
		return;
	}
	IWonderlandSocialService* Service = Sub != nullptr ? Sub->GetService() : nullptr;
	if (Service == nullptr || Service->IsDevelopmentPreview()) {
		Refuse(TEXT("needs a live connection"));
		return;
	}
	if (Name == TEXT("wl.Qa.LFF.Post")) {
		FWonderlandLffPostFields Fields;
		Fields.Category = UTF8_TO_TCHAR(Call.category.c_str());
		Fields.Title = FString::Printf(TEXT("QA %s"), *Fields.Category);
		Fields.Description = TEXT("QA listing");
		Fields.OpenSlots = 1;
		Service->CreateLffPost(Fields, [Call](const FWonderlandLffAnswer& Answer, const FString& CreatedId) {
			OnWrite(Call, Answer, CreatedId, "postId");
		});
		return;
	}
	if (Name == TEXT("wl.Qa.LFF.Withdraw")) {
		Service->ActOnLff(TEXT("lff.post.close"), UTF8_TO_TCHAR(Call.listingId.c_str()), [Call](const FWonderlandLffAnswer& Answer, const FString& CreatedId) {
			OnWrite(Call, Answer, CreatedId, nullptr);
		});
		return;
	}
	if (bFilter) {
		FWonderlandLffFeedQuery Query;
		Query.Category = UTF8_TO_TCHAR(Call.category.c_str());
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
	Service->SendLffRequest(UTF8_TO_TCHAR(Call.listingId.c_str()), TEXT("QA request"), [Call](const FWonderlandLffAnswer& Answer, const FString& CreatedId) {
		OnWrite(Call, Answer, CreatedId, "requestId");
	});
}

static TAutoConsoleVariable<int32> EnabledFlag(TEXT("wl.Qa.LFF.Enabled"), 0, TEXT("Looking for Feed QA commands. Off at 0. Absent from a shipping build."));
static TAutoConsoleVariable<FString> RoleFlag(TEXT("wl.Qa.LFF.Role"), TEXT("client"), TEXT("client_role written on each Looking for Feed QA line."));
static TAutoConsoleVariable<FString> NetFlag(TEXT("wl.Qa.LFF.NetId"), TEXT(""), TEXT("net_id written on each Looking for Feed QA line."));
static TAutoConsoleVariable<FString> ShaFlag(TEXT("wl.Qa.LFF.BuildSha"), TEXT(""), TEXT("build_sha written on each Looking for Feed QA line."));

static void Dispatch(const TArray<FString>& Args, const TCHAR* Command) {
	const IConsoleVariable* Flag = IConsoleManager::Get().FindConsoleVariable(TEXT("wl.Qa.LFF.Enabled"));
	if (Flag == nullptr || Flag->GetInt() != 1) {
		UE_LOG(LogTemp, Display, TEXT("%s refused: qa_disabled"), Command);
		return;
	}
	FString Line = Command;
	for (const FString& Arg : Args) Line += TEXT(" ") + Arg;
	RunLine(Line);
}

static FAutoConsoleCommandWithArgs PostCommand(TEXT("wl.Qa.LFF.Post"), TEXT("Post a Looking for Feed listing: wl.Qa.LFF.Post <category>. Off unless wl.Qa.LFF.Enabled is 1."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Post")); }));
static FAutoConsoleCommandWithArgs WithdrawCommand(TEXT("wl.Qa.LFF.Withdraw"), TEXT("Withdraw a Looking for Feed listing: wl.Qa.LFF.Withdraw <id>."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Withdraw")); }));
static FAutoConsoleCommandWithArgs FilterCommand(TEXT("wl.Qa.LFF.Filter"), TEXT("Filter the Looking for Feed: wl.Qa.LFF.Filter <category>."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Filter")); }));
static FAutoConsoleCommandWithArgs RequestCommand(TEXT("wl.Qa.LFF.Request"), TEXT("Request to join a Looking for Feed listing: wl.Qa.LFF.Request <id>."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Request")); }));
static FAutoConsoleCommandWithArgs DumpCommand(TEXT("wl.Qa.LFF.Dump"), TEXT("Print the current Looking for Feed QA state as one JSON line."), FConsoleCommandWithArgsDelegate::CreateLambda([](const TArray<FString>& Args) { Dispatch(Args, TEXT("wl.Qa.LFF.Dump")); }));

}  // namespace WonderlandLffQaTraceConsole
#endif
