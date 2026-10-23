#include "WonderlandWonderWebWindowLogic.h"

#include <algorithm>
#include <cmath>
#include <sstream>
#include <utility>

namespace WonderlandWonderWebWindowLogic {
namespace {

bool HasControlChar(const std::string& value) {
	const auto* bytes = reinterpret_cast<const unsigned char*>(value.data());
	const std::size_t count = value.size();
	std::size_t index = 0;
	while (index < count) {
		const unsigned char lead = bytes[index];
		std::uint32_t codePoint = 0;
		std::size_t length = 1;
		if (lead < 0x80) {
			codePoint = lead;
		} else if ((lead & 0xE0) == 0xC0 && index + 1 < count) {
			codePoint = (static_cast<std::uint32_t>(lead & 0x1F) << 6) | (bytes[index + 1] & 0x3F);
			length = 2;
		} else if ((lead & 0xF0) == 0xE0 && index + 2 < count) {
			codePoint = (static_cast<std::uint32_t>(lead & 0x0F) << 12)
				| (static_cast<std::uint32_t>(bytes[index + 1] & 0x3F) << 6)
				| (bytes[index + 2] & 0x3F);
			length = 3;
		} else if ((lead & 0xF8) == 0xF0 && index + 3 < count) {
			codePoint = (static_cast<std::uint32_t>(lead & 0x07) << 18)
				| (static_cast<std::uint32_t>(bytes[index + 1] & 0x3F) << 12)
				| (static_cast<std::uint32_t>(bytes[index + 2] & 0x3F) << 6)
				| (bytes[index + 3] & 0x3F);
			length = 4;
		} else {
			++index;
			continue;
		}
		if (codePoint <= 0x1F || codePoint == 0x7F || (codePoint >= 0x80 && codePoint <= 0x9F)
			|| codePoint == 0x2028 || codePoint == 0x2029) {
			return true;
		}
		index += length;
	}
	return false;
}

bool IsTrimCodePoint(std::uint32_t codePoint) {
	if (codePoint == 0x09 || codePoint == 0x0A || codePoint == 0x0B || codePoint == 0x0C || codePoint == 0x0D
		|| codePoint == 0x20 || codePoint == 0xA0 || codePoint == 0x1680 || codePoint == 0x2028
		|| codePoint == 0x2029 || codePoint == 0x202F || codePoint == 0x205F || codePoint == 0x3000
		|| codePoint == 0xFEFF) {
		return true;
	}
	return codePoint >= 0x2000 && codePoint <= 0x200A;
}

std::uint32_t DecodeAt(const std::string& value, std::size_t index, std::size_t& length) {
	const auto* bytes = reinterpret_cast<const unsigned char*>(value.data());
	const unsigned char lead = bytes[index];
	if (lead < 0x80) {
		length = 1;
		return lead;
	}
	if ((lead & 0xE0) == 0xC0 && index + 1 < value.size()) {
		length = 2;
		return (static_cast<std::uint32_t>(lead & 0x1F) << 6) | (bytes[index + 1] & 0x3F);
	}
	if ((lead & 0xF0) == 0xE0 && index + 2 < value.size()) {
		length = 3;
		return (static_cast<std::uint32_t>(lead & 0x0F) << 12)
			| (static_cast<std::uint32_t>(bytes[index + 1] & 0x3F) << 6)
			| (bytes[index + 2] & 0x3F);
	}
	if ((lead & 0xF8) == 0xF0 && index + 3 < value.size()) {
		length = 4;
		return (static_cast<std::uint32_t>(lead & 0x07) << 18)
			| (static_cast<std::uint32_t>(bytes[index + 1] & 0x3F) << 12)
			| (static_cast<std::uint32_t>(bytes[index + 2] & 0x3F) << 6)
			| (bytes[index + 3] & 0x3F);
	}
	length = 1;
	return lead;
}

std::string Trim(const std::string& value) {
	std::size_t begin = 0;
	while (begin < value.size()) {
		std::size_t length = 1;
		if (!IsTrimCodePoint(DecodeAt(value, begin, length))) break;
		begin += length;
	}
	std::size_t end = value.size();
	while (end > begin) {
		std::size_t start = end - 1;
		while (start > begin && (static_cast<unsigned char>(value[start]) & 0xC0) == 0x80) --start;
		std::size_t length = 1;
		if (!IsTrimCodePoint(DecodeAt(value, start, length)) || start + length != end) break;
		end = start;
	}
	return value.substr(begin, end - begin);
}

bool KnownKind(const std::string& kind) {
	return kind == "grok_bot_group" || kind == "openai_companion" || kind == "julius";
}

bool KnownSessionState(const std::string& state) {
	return state == "provisioning" || state == "running" || state == "paused" || state == "ended" || state == "failed";
}

bool IsLiveSessionState(const std::string& state) {
	return state == "provisioning" || state == "running" || state == "paused";
}

bool KnownEndCause(const std::string& cause) {
	for (const char* published : kSessionEndCauses) {
		if (cause == published) return true;
	}
	return false;
}

bool IsTerminalSessionState(const std::string& state) {
	return state == "ended" || state == "failed";
}

bool IsShownPhase(const std::string& phase) {
	return phase == "opening" || phase == "live" || phase == "focused";
}

bool IsHeldPhase(const std::string& phase) {
	return IsShownPhase(phase) || phase == "minimized";
}

bool UsableVmNumber(int vmNumber) {
	return vmNumber > 0;
}

std::size_t CodePointCount(const std::string& value) {
	const auto* bytes = reinterpret_cast<const unsigned char*>(value.data());
	const std::size_t count = value.size();
	std::size_t index = 0;
	std::size_t points = 0;
	while (index < count) {
		const unsigned char lead = bytes[index];
		std::size_t length = 1;
		if (lead < 0x80) {
			length = 1;
		} else if ((lead & 0xE0) == 0xC0 && index + 1 < count) {
			length = 2;
		} else if ((lead & 0xF0) == 0xE0 && index + 2 < count) {
			length = 3;
		} else if ((lead & 0xF8) == 0xF0 && index + 3 < count) {
			length = 4;
		} else {
			++index;
			++points;
			continue;
		}
		index += length;
		++points;
	}
	return points;
}

std::string RejectedNameReason() {
	return "Display name must be a non-empty string of at most "
		+ std::to_string(kAgentDisplayNameMaxCodePoints)
		+ " Unicode code points, with no control characters.";
}

struct NameResolution {
	bool ok = false;
	std::optional<std::string> name;
	std::string reason;
};

NameResolution ResolveAgentDisplayName(const std::optional<std::string>& raw) {
	NameResolution result;
	if (!raw.has_value()) {
		result.ok = true;
		return result;
	}
	if (HasControlChar(*raw)) {
		result.reason = RejectedNameReason();
		return result;
	}
	const std::string name = Trim(*raw);
	if (name.empty() || CodePointCount(name) > kAgentDisplayNameMaxCodePoints) {
		result.reason = RejectedNameReason();
		return result;
	}
	result.ok = true;
	result.name = name;
	return result;
}

const Window* FindWindow(const Manager& state, const std::string& vmSessionId) {
	for (const Window& window : state.windows) {
		if (window.vmSessionId == vmSessionId) return &window;
	}
	return nullptr;
}

void ReplaceWindow(std::vector<Window>& windows, const Window& next) {
	for (Window& window : windows) {
		if (window.vmSessionId == next.vmSessionId) {
			window = next;
			return;
		}
	}
}

void DemoteFocus(std::vector<Window>& windows, const std::string& exceptId) {
	for (Window& window : windows) {
		if (window.vmSessionId != exceptId && window.phase == "focused") window.phase = "live";
	}
}

int ShownCount(const std::vector<Window>& windows) {
	int count = 0;
	for (const Window& window : windows) {
		if (IsShownPhase(window.phase)) ++count;
	}
	return count;
}

int HeldCount(const std::vector<Window>& windows) {
	int count = 0;
	for (const Window& window : windows) {
		if (IsHeldPhase(window.phase)) ++count;
	}
	return count;
}

const Window* MostRecentShown(const std::vector<Window>& windows, const std::string& exceptId) {
	const Window* best = nullptr;
	for (const Window& window : windows) {
		if (window.vmSessionId == exceptId || !IsShownPhase(window.phase)) continue;
		if (best == nullptr || window.openedOrder > best->openedOrder) best = &window;
	}
	return best;
}

LogEvent MakeLog(
	const LogContext& ctx,
	const std::string& event,
	const std::string& vmSessionId,
	const SessionRecord* session) {
	LogEvent line;
	line.tsUtcMs = ctx.tsUtcMs;
	line.clientRole = ctx.clientRole;
	line.netId = ctx.netId;
	line.buildSha = ctx.buildSha;
	line.corrId = ctx.corrId;
	line.event = event;
	line.vmSessionId = vmSessionId;
	if (session != nullptr && session->vmSessionId == vmSessionId && UsableVmNumber(session->vmNumber)) {
		line.n = session->vmNumber;
	}
	return line;
}

AnimationCue MakeCue(const std::string& intent, const std::string& vmSessionId, std::optional<std::string> endCause = std::nullopt) {
	AnimationCue cue;
	cue.intent = intent;
	cue.vmSessionId = vmSessionId;
	cue.endCause = std::move(endCause);
	return cue;
}

WindowResult Refuse(const Manager& state, const std::string& code, const std::string& message) {
	WindowResult result;
	result.ok = false;
	result.state = state;
	result.errorCode = code;
	result.errorMessage = message;
	return result;
}

WindowResult Succeed(
	Manager state,
	Window value,
	std::vector<LogEvent> events,
	std::vector<AnimationCue> animations) {
	WindowResult result;
	result.ok = true;
	result.state = std::move(state);
	result.value = std::move(value);
	result.events = std::move(events);
	result.animations = std::move(animations);
	return result;
}

std::optional<std::string> SessionError(const SessionRecord& session, bool requireLiveNumber) {
	if (session.vmSessionId.empty() || Trim(session.vmSessionId).empty() || HasControlChar(session.vmSessionId)) {
		return std::string("invalid_session");
	}
	if (IsLegacyBrowserId(session.vmSessionId)) return std::string("browser_id_not_an_address");
	if (session.agentId.empty() || Trim(session.agentId).empty() || HasControlChar(session.agentId)) {
		return std::string("invalid_session");
	}
	if (!KnownKind(session.terminalKind)) return std::string("invalid_session");
	if (session.terminalId.empty() || Trim(session.terminalId).empty() || HasControlChar(session.terminalId)) {
		return std::string("invalid_session");
	}
	if (HasControlChar(session.terminalDisplayName)) return std::string("invalid_session");
	if (!KnownSessionState(session.sessionState)) return std::string("invalid_session");
	if (session.causeField == SessionRecord::CauseField::Value
		&& (!KnownEndCause(session.endCause) || !IsTerminalSessionState(session.sessionState))) {
		return std::string("unsupported_contract");
	}
	if (requireLiveNumber && !UsableVmNumber(session.vmNumber)) return std::string("vm_number_unusable");
	return std::nullopt;
}

std::optional<std::string> ContextError(const LogContext& ctx) {
	if (!std::isfinite(ctx.tsUtcMs)) return std::string("invalid_session");
	return std::nullopt;
}

std::string SessionMessage(const std::string& code) {
	if (code == "browser_id_not_an_address") return "vmSessionId must not be a browser or browser-N id.";
	if (code == "unsupported_contract") {
		return "endCause belongs to wonder-web-vm-session.v1 and is set only when the session has ended or failed.";
	}
	if (code == "vm_number_unusable") return "vmNumber must be a positive integer supplied by the session record.";
	return "Session record is unusable.";
}

void FocusMostRecent(
	std::vector<Window>& windows,
	const std::string& exceptId,
	const LogContext& ctx,
	std::vector<LogEvent>& events) {
	const Window* next = MostRecentShown(windows, exceptId);
	if (next == nullptr || next->phase == "focused") return;
	Window focused = *next;
	events.push_back(MakeLog(ctx, "ww_window_focused", focused.vmSessionId, nullptr));
	DemoteFocus(windows, focused.vmSessionId);
	focused.phase = "focused";
	ReplaceWindow(windows, focused);
}

WindowResult FocusWindow(
	Manager state,
	Window window,
	const SessionRecord& session,
	const LogContext& ctx,
	bool fromMinimized) {
	if (window.phase == "closed" || window.phase == "closing") {
		return Refuse(state, "illegal_phase", "A closed panel cannot take focus.");
	}
	if (window.phase == "focused" && !fromMinimized) return Succeed(std::move(state), std::move(window), {}, {});
	window.phase = "focused";
	window.admission = "shown";
	window.sessionState = session.sessionState;
	DemoteFocus(state.windows, window.vmSessionId);
	ReplaceWindow(state.windows, window);
	std::vector<LogEvent> events;
	std::vector<AnimationCue> animations;
	if (fromMinimized) {
		events.push_back(MakeLog(ctx, "ww_window_surfaced", window.vmSessionId, &session));
		animations.push_back(MakeCue("restore_unfold", window.vmSessionId));
	}
	events.push_back(MakeLog(ctx, "ww_window_focused", window.vmSessionId, &session));
	return Succeed(std::move(state), std::move(window), std::move(events), std::move(animations));
}

WindowResult RestoreWindow(
	Manager state,
	Window window,
	const SessionRecord& session,
	const LogContext& ctx,
	bool respectCap) {
	if (respectCap && ShownCount(state.windows) >= state.windowCap) {
		return Refuse(state, "window_cap_reached", "The shown-window cap is full. The session keeps running as a chip.");
	}
	window.lastSurfaceAtMs = ctx.tsUtcMs;
	ReplaceWindow(state.windows, window);
	return FocusWindow(std::move(state), std::move(window), session, ctx, true);
}

WindowResult MinimizeWindow(Manager state, Window window, const SessionRecord& session, const LogContext& ctx) {
	if (window.phase == "closed" || window.phase == "closing") {
		return Refuse(state, "illegal_phase", "A closed panel cannot minimize.");
	}
	if (window.phase == "minimized") return Succeed(std::move(state), std::move(window), {}, {});
	const bool wasFocused = window.phase == "focused";
	window.phase = "minimized";
	window.admission = "queued_chip";
	ReplaceWindow(state.windows, window);
	std::vector<LogEvent> events;
	events.push_back(MakeLog(ctx, "ww_window_minimized", window.vmSessionId, &session));
	if (wasFocused) FocusMostRecent(state.windows, window.vmSessionId, ctx, events);
	return Succeed(std::move(state), window, std::move(events), {MakeCue("minimize_fold", window.vmSessionId)});
}

struct Ready {
	bool ok = false;
	Window window;
	WindowResult refusal;
};

Ready ReadyMutation(
	const Manager& state,
	const SessionRecord& session,
	const std::string& actorAgentId,
	const LogContext& ctx,
	bool requireUsableNumber) {
	Ready ready;
	if (const std::optional<std::string> ctxError = ContextError(ctx)) {
		ready.refusal = Refuse(state, *ctxError, "tsUtcMs must be injected.");
		return ready;
	}
	if (const std::optional<std::string> invalid = SessionError(session, requireUsableNumber)) {
		ready.refusal = Refuse(state, *invalid, SessionMessage(*invalid));
		return ready;
	}
	const Window* window = FindWindow(state, session.vmSessionId);
	if (window == nullptr) {
		ready.refusal = Refuse(state, "window_not_found", "No window for that vmSessionId.");
		return ready;
	}
	if (session.agentId != window->agentId) {
		ready.refusal = Refuse(state, "agent_identity_changed", "agentId on a vmSessionId does not change.");
		return ready;
	}
	if (actorAgentId != window->agentId) {
		ready.refusal = Refuse(state, "not_owner", "The action is authorized by agentId, not by display name or colour.");
		return ready;
	}
	ready.ok = true;
	ready.window = *window;
	return ready;
}

WindowResult FinishClose(
	Manager state,
	Window window,
	const SessionRecord& session,
	const LogContext& ctx,
	bool sessionEnded) {
	std::optional<std::string> endCause;
	if (sessionEnded && session.causeField == SessionRecord::CauseField::Value) endCause = session.endCause;
	const bool wasFocused = window.phase == "focused";
	window.closeAnimation = sessionEnded ? std::optional<std::string>("vm_ended_anim") : std::optional<std::string>("close_anim");
	window.phase = "closing";
	if (sessionEnded) window.sessionState = session.sessionState;
	ReplaceWindow(state.windows, window);
	std::vector<LogEvent> events;
	std::vector<AnimationCue> animations;
	if (sessionEnded) {
		events.push_back(MakeLog(ctx, "ww_session_terminated", window.vmSessionId, &session));
		animations.push_back(MakeCue("vm_ended_anim", window.vmSessionId, endCause));
	} else {
		animations.push_back(MakeCue("close_anim", window.vmSessionId));
	}
	events.push_back(MakeLog(ctx, "ww_panel_closed", window.vmSessionId, &session));
	if (wasFocused) FocusMostRecent(state.windows, window.vmSessionId, ctx, events);
	if (HeldCount(state.windows) == 0 && state.cameraInCloseup) {
		animations.push_back(MakeCue("camera_return", window.vmSessionId));
		state.cameraInCloseup = false;
	}
	return Succeed(std::move(state), std::move(window), std::move(events), std::move(animations));
}

WindowResult Admit(Manager state, const SessionRecord& session, const LogContext& ctx, const std::optional<std::string>& agentDisplayName, const Window* previous) {
	std::vector<Window> others;
	for (const Window& window : state.windows) {
		if (previous == nullptr || window.vmSessionId != previous->vmSessionId) others.push_back(window);
	}
	const bool queued = ShownCount(others) >= state.windowCap;
	bool otherHeld = false;
	for (const Window& window : others) {
		if (IsHeldPhase(window.phase)) otherHeld = true;
	}
	std::optional<std::string> openAnimation;
	if (!queued) openAnimation = otherHeld ? std::string("spawn_inline") : std::string("cinematic_closeup");
	Window window;
	window.vmSessionId = session.vmSessionId;
	window.agentId = session.agentId;
	window.agentDisplayName = agentDisplayName;
	window.terminalId = session.terminalId;
	window.terminalKind = session.terminalKind;
	window.terminalDisplayName = session.terminalDisplayName;
	window.accentColorToken = AccentTokenFromRef(session.accentColorRef);
	window.phase = queued ? "minimized" : "opening";
	window.pinned = previous != nullptr && previous->pinned;
	window.admission = queued ? "queued_chip" : "shown";
	window.openedOrder = previous != nullptr ? previous->openedOrder : state.nextOpenedOrder;
	window.openedAtMs = previous != nullptr ? previous->openedAtMs : ctx.tsUtcMs;
	window.openAnimation = openAnimation;
	window.lastSurfaceAtMs = previous != nullptr ? previous->lastSurfaceAtMs : std::nullopt;
	window.sessionState = session.sessionState;
	std::vector<LogEvent> events;
	events.push_back(MakeLog(ctx, "ww_window_opened", window.vmSessionId, &session));
	if (queued) events.push_back(MakeLog(ctx, "ww_window_minimized", window.vmSessionId, &session));
	std::vector<AnimationCue> animations;
	if (openAnimation.has_value() && *openAnimation == "cinematic_closeup") {
		animations.push_back(MakeCue("cinematic_closeup", window.vmSessionId));
		state.cameraInCloseup = true;
	} else if (openAnimation.has_value() && *openAnimation == "spawn_inline") {
		animations.push_back(MakeCue("spawn_inline", window.vmSessionId));
	}
	if (previous == nullptr) {
		state.windows.push_back(window);
		state.nextOpenedOrder += 1;
	} else {
		ReplaceWindow(state.windows, window);
	}
	return Succeed(std::move(state), std::move(window), std::move(events), std::move(animations));
}

std::string JsonString(const std::string& value) {
	std::string out = "\"";
	for (unsigned char character : value) {
		if (character == '"' || character == '\\') {
			out.push_back('\\');
			out.push_back(static_cast<char>(character));
		} else if (character < 0x20) {
			constexpr char hex[] = "0123456789abcdef";
			out += "\\u00";
			out.push_back(hex[character >> 4]);
			out.push_back(hex[character & 0x0F]);
		} else {
			out.push_back(static_cast<char>(character));
		}
	}
	out.push_back('"');
	return out;
}

std::string JsonNumber(double value) {
	if (std::isfinite(value) && std::floor(value) == value && value >= -9007199254740991.0 && value <= 9007199254740991.0) {
		return std::to_string(static_cast<long long>(value));
	}
	std::ostringstream stream;
	stream.precision(17);
	stream << value;
	return stream.str();
}

std::string JsonOptionalString(const std::optional<std::string>& value) {
	return value ? JsonString(*value) : "null";
}

std::string JsonOptionalNumber(const std::optional<double>& value) {
	return value ? JsonNumber(*value) : "null";
}

void AppendField(std::vector<std::pair<std::string, std::string>>& fields, const std::string& key, const std::string& json) {
	fields.emplace_back(key, json);
}

std::string CanonicalObject(std::vector<std::pair<std::string, std::string>> fields) {
	std::sort(fields.begin(), fields.end(), [](const auto& left, const auto& right) { return left.first < right.first; });
	std::string out = "{";
	for (std::size_t index = 0; index < fields.size(); ++index) {
		if (index > 0) out.push_back(',');
		out += JsonString(fields[index].first);
		out.push_back(':');
		out += fields[index].second;
	}
	out.push_back('}');
	return out;
}

bool ByOpenedOrder(const Window& left, const Window& right) {
	if (left.openedOrder != right.openedOrder) return left.openedOrder < right.openedOrder;
	return left.vmSessionId < right.vmSessionId;
}

struct Area {
	double minX = 0;
	double minY = 0;
	double maxX = 0;
	double maxY = 0;
};

}  // namespace

bool IsLegacyBrowserId(const std::string& id) {
	if (id == "browser") return true;
	if (id.rfind("browser-", 0) != 0 || id.size() < 9) return false;
	for (std::size_t index = 8; index < id.size(); ++index) {
		if (id[index] < '0' || id[index] > '9') return false;
	}
	return true;
}

std::optional<std::string> FormatWindowTitle(const std::optional<std::string>& agentDisplayName, int vmNumber) {
	if (!UsableVmNumber(vmNumber)) return std::nullopt;
	const NameResolution resolved = ResolveAgentDisplayName(agentDisplayName);
	const std::string name = resolved.ok && resolved.name.has_value() ? *resolved.name : std::string(kAgentDisplayNameFallback);
	return name + " \u2014 Wonder Web VM " + std::to_string(vmNumber);
}

std::optional<std::string> AccentTokenFromRef(const std::string& accentColorRef) {
	if (HasControlChar(accentColorRef)) return std::nullopt;
	const std::string token = Trim(accentColorRef);
	if (token.empty()) return std::nullopt;
	return token;
}

AddressError AddressByVmNumber(int) {
	return AddressError{"vm_number_not_an_address", "vmNumber is a display value from the session record. It cannot address a window."};
}

AddressError AddressByBrowserId(const std::string&) {
	return AddressError{"browser_id_not_an_address", "A browser or browser-N id cannot address a window. Identity is vmSessionId."};
}

CreateResult CreateWindowManager(std::optional<int> windowCap) {
	CreateResult created;
	if (windowCap.has_value() && *windowCap <= 0) {
		created.errorCode = "window_cap_unusable";
		created.errorMessage = "Shown-window cap must be a positive integer.";
		return created;
	}
	created.ok = true;
	created.state.contract = kContract;
	created.state.windowCap = windowCap.value_or(kDefaultShownWindowCap);
	created.state.cameraInCloseup = false;
	created.state.nextOpenedOrder = 1;
	return created;
}

WindowResult OpenWindow(const Manager& incoming, const SessionRecord& session, const LogContext& ctx) {
	if (const std::optional<std::string> ctxError = ContextError(ctx)) {
		return Refuse(incoming, *ctxError, "tsUtcMs must be injected.");
	}
	if (const std::optional<std::string> invalid = SessionError(session, true)) {
		return Refuse(incoming, *invalid, SessionMessage(*invalid));
	}
	const NameResolution named = ResolveAgentDisplayName(session.agentDisplayName);
	if (!named.ok) return Refuse(incoming, "agent_display_name_rejected", named.reason);
	if (!IsLiveSessionState(session.sessionState)) {
		return Refuse(incoming, "session_not_live", "A window opens only for a provisioning, running, or paused session.");
	}
	Manager state = incoming;
	const Window* existing = FindWindow(state, session.vmSessionId);
	if (existing != nullptr) {
		Window previous = *existing;
		if (previous.agentId != session.agentId) {
			return Refuse(incoming, "agent_identity_changed", "agentId on a vmSessionId does not change.");
		}
		if (previous.phase == "closed") {
			if (!IsLiveSessionState(previous.sessionState)) {
				return Refuse(incoming, "session_id_reused", "vmSessionId is never reused after the session ends.");
			}
			return Admit(std::move(state), session, ctx, named.name, &previous);
		}
		if (previous.phase == "closing") return Refuse(incoming, "illegal_phase", "The panel is still closing.");
		if (previous.phase == "minimized") return RestoreWindow(std::move(state), previous, session, ctx, false);
		return FocusWindow(std::move(state), previous, session, ctx, false);
	}
	return Admit(std::move(state), session, ctx, named.name, nullptr);
}

WindowResult SettleOpening(const Manager& incoming, const SessionRecord& session, const LogContext& ctx) {
	if (const std::optional<std::string> ctxError = ContextError(ctx)) {
		return Refuse(incoming, *ctxError, "tsUtcMs must be injected.");
	}
	const Window* found = FindWindow(incoming, session.vmSessionId);
	if (found == nullptr) return Refuse(incoming, "window_not_found", "No window for that vmSessionId.");
	if (found->phase != "opening") return Refuse(incoming, "illegal_phase", "Only an opening window settles.");
	Manager state = incoming;
	Window window = *found;
	window.phase = "focused";
	DemoteFocus(state.windows, window.vmSessionId);
	ReplaceWindow(state.windows, window);
	return Succeed(std::move(state), window, {MakeLog(ctx, "ww_window_focused", window.vmSessionId, &session)}, {});
}

WindowResult ClosePanel(
	const Manager& incoming,
	const SessionRecord& session,
	const std::string& actorAgentId,
	const LogContext& ctx) {
	const Ready ready = ReadyMutation(incoming, session, actorAgentId, ctx, false);
	if (!ready.ok) return ready.refusal;
	if (ready.window.phase == "closed") return Refuse(incoming, "illegal_phase", "The panel is already closed.");
	if (ready.window.phase == "closing") return Succeed(incoming, ready.window, {}, {});
	return FinishClose(incoming, ready.window, session, ctx, false);
}

WindowResult SettleClosing(const Manager& incoming, const std::string& vmSessionId) {
	const Window* found = FindWindow(incoming, vmSessionId);
	if (found == nullptr) return Refuse(incoming, "window_not_found", "No window for that vmSessionId.");
	if (found->phase != "closing") return Refuse(incoming, "illegal_phase", "Only a closing panel settles.");
	Manager state = incoming;
	Window window = *found;
	window.phase = "closed";
	ReplaceWindow(state.windows, window);
	return Succeed(std::move(state), window, {}, {});
}

WindowResult ApplySession(const Manager& incoming, const SessionRecord& session, const LogContext& ctx) {
	if (const std::optional<std::string> ctxError = ContextError(ctx)) {
		return Refuse(incoming, *ctxError, "tsUtcMs must be injected.");
	}
	if (const std::optional<std::string> invalid = SessionError(session, false)) {
		return Refuse(incoming, *invalid, SessionMessage(*invalid));
	}
	const Window* found = FindWindow(incoming, session.vmSessionId);
	if (found == nullptr) return Refuse(incoming, "window_not_found", "No window for that vmSessionId.");
	if (found->agentId != session.agentId) {
		return Refuse(incoming, "agent_identity_changed", "agentId on a vmSessionId does not change.");
	}
	const NameResolution named = ResolveAgentDisplayName(session.agentDisplayName);
	Window patched = *found;
	if (named.ok) patched.agentDisplayName = named.name;
	patched.terminalId = session.terminalId;
	patched.terminalKind = session.terminalKind;
	patched.terminalDisplayName = session.terminalDisplayName;
	patched.accentColorToken = AccentTokenFromRef(session.accentColorRef);
	patched.sessionState = session.sessionState;
	if (IsLiveSessionState(session.sessionState) && !IsLiveSessionState(found->sessionState)) {
		return Refuse(incoming, "session_id_reused", "vmSessionId is never reused after the session ends.");
	}
	if (!IsLiveSessionState(session.sessionState)) {
		if (!IsLiveSessionState(found->sessionState)) return Succeed(incoming, *found, {}, {});
		Manager state = incoming;
		if (patched.phase == "closed" || patched.phase == "closing") {
			ReplaceWindow(state.windows, patched);
			return Succeed(std::move(state), patched, {MakeLog(ctx, "ww_session_terminated", patched.vmSessionId, &session)}, {});
		}
		ReplaceWindow(state.windows, patched);
		return FinishClose(std::move(state), patched, session, ctx, true);
	}
	Manager state = incoming;
	ReplaceWindow(state.windows, patched);
	return Succeed(std::move(state), patched, {}, {});
}

WindowResult ApplyUserAction(
	const Manager& state,
	const SessionRecord& session,
	const std::string& actorAgentId,
	const std::string& action,
	const LogContext& ctx) {
	if (action == "close") return ClosePanel(state, session, actorAgentId, ctx);
	VisibilityEvent event;
	if (action == "focus") event.kind = "user_focus";
	else if (action == "minimize") event.kind = "user_minimize";
	else if (action == "pin") event.kind = "user_pin";
	else if (action == "unpin") event.kind = "user_unpin";
	else event.kind = "user_minimize";
	return ApplyVisibility(state, session, actorAgentId, event, ctx, VisibilityPolicy());
}

WindowResult ApplyVisibility(
	const Manager& incoming,
	const SessionRecord& session,
	const std::string& actorAgentId,
	const VisibilityEvent& event,
	const LogContext& ctx,
	const VisibilityPolicy& policy) {
	const Ready ready = ReadyMutation(incoming, session, actorAgentId, ctx, false);
	if (!ready.ok) return ready.refusal;
	Window window = ready.window;
	if (window.phase == "closed" || window.phase == "closing") {
		return Refuse(incoming, "illegal_phase", "The panel is not on the workspace.");
	}
	Manager state = incoming;
	if (event.kind == "user_pin") {
		if (window.pinned) return Succeed(std::move(state), window, {}, {});
		window.pinned = true;
		ReplaceWindow(state.windows, window);
		return Succeed(std::move(state), window, {MakeLog(ctx, "ww_window_pinned", window.vmSessionId, &session)}, {});
	}
	if (event.kind == "user_unpin") {
		if (!window.pinned) return Succeed(std::move(state), window, {}, {});
		window.pinned = false;
		ReplaceWindow(state.windows, window);
		return Succeed(std::move(state), window, {}, {});
	}
	if (event.kind == "user_minimize") return MinimizeWindow(std::move(state), window, session, ctx);
	if (event.kind == "user_focus") {
		if (window.phase == "minimized") return RestoreWindow(std::move(state), window, session, ctx, true);
		return FocusWindow(std::move(state), window, session, ctx, false);
	}
	if (event.kind == "idle") {
		window.idleSinceMs = event.idleSinceMs.value_or(0);
		const double elapsed = ctx.tsUtcMs - window.idleSinceMs.value_or(0);
		ReplaceWindow(state.windows, window);
		if (window.pinned || !IsShownPhase(window.phase) || elapsed < policy.idleAutoMinimizeMs) {
			return Succeed(std::move(state), window, {}, {});
		}
		return MinimizeWindow(std::move(state), window, session, ctx);
	}
	const bool urgent = event.kind == "permission_request" || event.kind == "failure" || event.kind == "result";
	if (window.phase != "minimized") {
		if (urgent && window.phase != "focused") return FocusWindow(std::move(state), window, session, ctx, false);
		return Succeed(std::move(state), window, {}, {});
	}
	if (!urgent) {
		if (window.lastSurfaceAtMs.has_value() && ctx.tsUtcMs - *window.lastSurfaceAtMs < policy.surfaceRateLimitMs) {
			return Succeed(std::move(state), window, {}, {});
		}
		if (ShownCount(state.windows) >= state.windowCap) return Succeed(std::move(state), window, {}, {});
	}
	return RestoreWindow(std::move(state), window, session, ctx, false);
}

std::optional<std::string> DisplayedTitle(const Window& window, const SessionRecord* session) {
	if (session == nullptr || session->vmSessionId != window.vmSessionId) return std::nullopt;
	return FormatWindowTitle(window.agentDisplayName, session->vmNumber);
}

ObserverView MakeObserverView(const Window& window, const SessionRecord* session) {
	ObserverView view;
	view.outlineColorToken = window.accentColorToken;
	view.ownerName = window.agentDisplayName;
	view.title = DisplayedTitle(window, session);
	view.status = window.phase;
	return view;
}

std::vector<StatusIndicator> StatusIndicators(const Manager& state, const std::vector<SessionRecord>& sessions) {
	std::vector<Window> chips;
	for (const Window& window : state.windows) {
		if (window.phase == "minimized") chips.push_back(window);
	}
	std::sort(chips.begin(), chips.end(), ByOpenedOrder);
	std::vector<StatusIndicator> indicators;
	for (std::size_t index = 0; index < chips.size(); ++index) {
		const Window& window = chips[index];
		const SessionRecord* session = nullptr;
		for (const SessionRecord& candidate : sessions) {
			if (candidate.vmSessionId == window.vmSessionId) session = &candidate;
		}
		StatusIndicator indicator;
		indicator.vmSessionId = window.vmSessionId;
		indicator.ownerName = window.agentDisplayName;
		indicator.outlineColorToken = window.accentColorToken;
		indicator.title = DisplayedTitle(window, session);
		indicator.status = "minimized";
		indicator.dockSlot = static_cast<int>(index);
		indicators.push_back(std::move(indicator));
	}
	return indicators;
}

WorkspaceLayout TileWindows(const Manager& state, const TileInput& input) {
	constexpr double kHalfX = 295;
	constexpr double kHalfY = 166;
	constexpr double kViewAcross = 16;
	constexpr double kGap = 18;
	constexpr double kHudClearance = 8;
	constexpr double kMargin = 10;
	constexpr double kLoneSize = 1.15;
	constexpr double kPairSize = 1;
	constexpr double kManySize = 0.9;
	constexpr double kExpandedSize = 1.6;
	constexpr double kGlassX = 240;
	constexpr double kGlassY = 160;
	constexpr double kChipX = 560;
	constexpr double kChipY = 96;
	constexpr double kChipScale = 0.2;

	std::vector<Window> shown;
	std::vector<Window> folded;
	for (const Window& window : state.windows) {
		if (IsShownPhase(window.phase)) shown.push_back(window);
		else if (window.phase == "minimized") folded.push_back(window);
	}
	std::sort(shown.begin(), shown.end(), ByOpenedOrder);
	std::sort(folded.begin(), folded.end(), ByOpenedOrder);

	WorkspaceLayout layout;
	const double chipWidth = kChipX * kChipScale;
	const double chipHeight = kChipY * kChipScale;
	for (std::size_t index = 0; index < folded.size(); ++index) {
		ChipPlacement chip;
		chip.vmSessionId = folded[index].vmSessionId;
		chip.dockSlot = static_cast<int>(index);
		chip.width = chipWidth;
		chip.height = chipHeight;
		chip.x = -kHalfX + kMargin + chipWidth * 0.5 + static_cast<double>(index) * (chipWidth + 6);
		chip.y = -kHalfY + kMargin + chipHeight * 0.5;
		layout.chips.push_back(chip);
	}
	if (shown.empty() || kGlassX <= 0 || kGlassY <= 0 || kHalfX <= 0 || kHalfY <= 0) return layout;

	const double clearX = kHudClearance > 0 ? kHudClearance / (2 * kHalfX) : 0;
	const double clearY = kHudClearance > 0 ? kHudClearance / (2 * kHalfY) : 0;
	const double marginX = kMargin / (2 * kHalfX);
	const double marginY = kMargin / (2 * kHalfY);
	const double chipRow = folded.empty() ? 0 : (kChipY * kChipScale + 12) / (2 * kHalfY);
	const double bottom = 1 - marginY - chipRow;
	double belowTop = marginY;
	for (const KeepOut& box : input.keepOut) {
		if (box.minY < 0.5 && box.maxY + clearY > belowTop) belowTop = box.maxY + clearY;
	}
	std::vector<Area> areas;
	areas.push_back(Area{marginX, belowTop, 1 - marginX, bottom});
	double left = marginX;
	double right = 1 - marginX;
	for (const KeepOut& box : input.keepOut) {
		if (box.maxX < 0.5) {
			if (box.maxX + clearX > left) left = box.maxX + clearX;
		} else if (box.minX > 0.5) {
			if (box.minX - clearX < right) right = box.minX - clearX;
		}
	}
	double top = marginY;
	for (const KeepOut& box : input.keepOut) {
		if (box.maxX > left && box.minX < right && box.minY < 0.5 && box.maxY + clearY > top) {
			top = box.maxY + clearY;
		}
	}
	if (right > left && bottom > top) areas.push_back(Area{left, top, right, bottom});

	auto roomX = [&](const Area& area) { return (area.maxX - area.minX) * 2 * kHalfX; };
	auto roomY = [&](const Area& area) { return (area.maxY - area.minY) * 2 * kHalfY; };
	auto fit = [&](const Area& area, int across, int down, double want) {
		const double xFit = (roomX(area) - kGap * (across - 1)) / (kGlassX * across);
		const double yFit = (roomY(area) - kGap * (down - 1)) / (kGlassY * down);
		double best = want;
		if (xFit < best) best = xFit;
		if (yFit < best) best = yFit;
		return best;
	};
	auto centre = [&](const Area& area) {
		TiledWindow point;
		point.x = ((area.minX + area.maxX) * 0.5 - 0.5) * 2 * kHalfX + kViewAcross;
		point.y = (0.5 - (area.minY + area.maxY) * 0.5) * 2 * kHalfY;
		return point;
	};

	const int count = static_cast<int>(shown.size());
	const double want = count == 1 ? kLoneSize : count == 2 ? kPairSize : kManySize;
	double bestSize = -1;
	int bestArea = 0;
	int bestAcross = count;
	for (int areaIndex = 0; areaIndex < static_cast<int>(areas.size()); ++areaIndex) {
		for (int across = count; across >= 1; --across) {
			const int down = static_cast<int>(std::ceil(static_cast<double>(count) / across));
			const double size = fit(areas[static_cast<std::size_t>(areaIndex)], across, down, want);
			if (size > bestSize + 0.01) {
				bestSize = size;
				bestArea = areaIndex;
				bestAcross = across;
			}
		}
	}
	const Area& area = areas[static_cast<std::size_t>(bestArea)];
	const double size = bestSize > 0.3 ? bestSize : 0.3;
	const int down = static_cast<int>(std::ceil(static_cast<double>(count) / bestAcross));
	const TiledWindow centrePoint = centre(area);
	const double cellX = kGlassX * size + kGap;
	const double cellY = kGlassY * size + kGap;
	for (int index = 0; index < count; ++index) {
		const int row = index / bestAcross;
		const int inRow = row < down - 1 ? bestAcross : count - bestAcross * (down - 1);
		const int column = index % bestAcross;
		TiledWindow placed;
		placed.vmSessionId = shown[static_cast<std::size_t>(index)].vmSessionId;
		placed.x = centrePoint.x + (column - (inRow - 1) * 0.5) * cellX;
		placed.y = centrePoint.y + ((down - 1) * 0.5 - row) * cellY;
		placed.size = size;
		placed.width = kGlassX * size;
		placed.height = kGlassY * size;
		layout.shown.push_back(placed);
	}
	if (input.expandedVmSessionId.has_value()) {
		int target = -1;
		for (int index = 0; index < count; ++index) {
			if (layout.shown[static_cast<std::size_t>(index)].vmSessionId == *input.expandedVmSessionId) target = index;
		}
		if (target >= 0) {
			double expandedSize = -1;
			int expandedArea = 0;
			for (int areaIndex = 0; areaIndex < static_cast<int>(areas.size()); ++areaIndex) {
				const double candidate = fit(areas[static_cast<std::size_t>(areaIndex)], 1, 1, kExpandedSize);
				if (candidate > expandedSize) {
					expandedSize = candidate;
					expandedArea = areaIndex;
				}
			}
			const TiledWindow expandedCentre = centre(areas[static_cast<std::size_t>(expandedArea)]);
			const double grown = expandedSize > 0.3 ? expandedSize : 0.3;
			TiledWindow& current = layout.shown[static_cast<std::size_t>(target)];
			current.x = expandedCentre.x;
			current.y = expandedCentre.y;
			current.size = grown;
			current.width = kGlassX * grown;
			current.height = kGlassY * grown;
		}
	}
	layout.hasTileArea = true;
	layout.tileArea = KeepOut{area.minX, area.minY, area.maxX, area.maxY};
	return layout;
}

std::string SerializeWindows(const Manager& state) {
	std::string windows = "[";
	for (std::size_t index = 0; index < state.windows.size(); ++index) {
		const Window& window = state.windows[index];
		if (index > 0) windows.push_back(',');
		std::vector<std::pair<std::string, std::string>> fields;
		AppendField(fields, "accentColorToken", JsonOptionalString(window.accentColorToken));
		AppendField(fields, "admission", JsonString(window.admission));
		AppendField(fields, "agentDisplayName", JsonOptionalString(window.agentDisplayName));
		AppendField(fields, "agentId", JsonString(window.agentId));
		AppendField(fields, "closeAnimation", JsonOptionalString(window.closeAnimation));
		AppendField(fields, "idleSinceMs", JsonOptionalNumber(window.idleSinceMs));
		AppendField(fields, "lastSurfaceAtMs", JsonOptionalNumber(window.lastSurfaceAtMs));
		AppendField(fields, "openAnimation", JsonOptionalString(window.openAnimation));
		AppendField(fields, "openedAtMs", JsonNumber(window.openedAtMs));
		AppendField(fields, "openedOrder", JsonNumber(window.openedOrder));
		AppendField(fields, "phase", JsonString(window.phase));
		AppendField(fields, "pinned", window.pinned ? "true" : "false");
		AppendField(fields, "sessionState", JsonString(window.sessionState));
		AppendField(fields, "terminalDisplayName", JsonString(window.terminalDisplayName));
		AppendField(fields, "terminalId", JsonString(window.terminalId));
		AppendField(fields, "terminalKind", JsonString(window.terminalKind));
		AppendField(fields, "vmSessionId", JsonString(window.vmSessionId));
		windows += CanonicalObject(std::move(fields));
	}
	windows.push_back(']');
	std::vector<std::pair<std::string, std::string>> root;
	AppendField(root, "cameraInCloseup", state.cameraInCloseup ? "true" : "false");
	AppendField(root, "contract", JsonString(state.contract));
	AppendField(root, "nextOpenedOrder", JsonNumber(state.nextOpenedOrder));
	AppendField(root, "windowCap", JsonNumber(state.windowCap));
	AppendField(root, "windows", windows);
	return CanonicalObject(std::move(root));
}

}  // namespace WonderlandWonderWebWindowLogic
