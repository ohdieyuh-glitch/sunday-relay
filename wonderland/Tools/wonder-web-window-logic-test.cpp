/**
 * Standalone driver for WonderlandWonderWebWindowLogic.
 * Prints one JSON object, the same golden report as wonder-web-windows.test.ts.
 * No engine, no VM, no network.
 */

#include "../Source/Wonderland/WonderlandWonderWebWindowLogic.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

namespace {

namespace Logic = WonderlandWonderWebWindowLogic;

Logic::LogContext GoldenContext() {
	Logic::LogContext ctx;
	ctx.tsUtcMs = 1700000000000.0;
	ctx.clientRole = "presentational";
	ctx.netId = "net-7";
	ctx.buildSha = "f539cab2";
	ctx.corrId = "corr-golden";
	return ctx;
}

Logic::SessionRecord GoldenSession(
	const std::string& id,
	int vmNumber,
	const std::string& name,
	const std::string& agentId,
	const std::string& sessionState,
	Logic::SessionRecord::CauseField causeField,
	const std::string& endCause) {
	Logic::SessionRecord session;
	session.vmSessionId = id;
	session.agentId = agentId;
	session.agentDisplayName = name;
	session.vmNumber = vmNumber;
	session.terminalId = "term-julius";
	session.terminalKind = "julius";
	session.terminalDisplayName = "Julius";
	session.accentColorRef = "accent-julius";
	session.sessionState = sessionState;
	session.causeField = causeField;
	session.endCause = endCause;
	return session;
}

Logic::SessionRecord Live(const std::string& id, int vmNumber, const std::string& name = "Dot") {
	return GoldenSession(id, vmNumber, name, "auth-dot", "running", Logic::SessionRecord::CauseField::Omitted, "");
}

/** C++ has one null state for both an omitted label and an explicit null. */
Logic::SessionRecord Unnamed(const std::string& id, int vmNumber) {
	Logic::SessionRecord session = Live(id, vmNumber);
	session.agentDisplayName = std::nullopt;
	return session;
}

std::string Escape(const std::string& value) {
	std::string out;
	for (unsigned char character : value) {
		if (character == '"' || character == '\\') {
			out.push_back('\\');
			out.push_back(static_cast<char>(character));
		} else {
			out.push_back(static_cast<char>(character));
		}
	}
	return out;
}

std::string Quote(const std::string& value) {
	return "\"" + Escape(value) + "\"";
}

std::string Array(const std::vector<std::string>& values) {
	std::string out = "[";
	for (std::size_t index = 0; index < values.size(); ++index) {
		if (index > 0) out.push_back(',');
		out += Quote(values[index]);
	}
	out.push_back(']');
	return out;
}

bool Fail(const char* step, const Logic::WindowResult& result) {
	std::cerr << step << " " << result.errorCode << "\n";
	return false;
}

std::string Fixed6(double value) {
	const double rounded = std::round(value * 1e6) / 1e6;
	char buffer[64];
	std::snprintf(buffer, sizeof(buffer), "%.6f", rounded);
	return buffer;
}

const char* kLifetime[] = {
	"keepalive",
	"heartbeat",
	"extend",
	"extendsession",
	"renew",
	"ttl",
	"stayalive",
	"holdsession",
	"bumpexpiry",
	"preventidle",
	"preventtimeout",
};

bool IsLifetimeToken(const std::string& value) {
	std::string lower;
	lower.reserve(value.size());
	for (unsigned char character : value) {
		lower.push_back(static_cast<char>(character >= 'A' && character <= 'Z' ? character - 'A' + 'a' : character));
	}
	for (const char* token : kLifetime) {
		if (lower == token) return true;
	}
	return false;
}

int LifetimeHits(const Logic::WindowResult& result) {
	int hits = 0;
	auto note = [&](const std::string& value) {
		if (IsLifetimeToken(value)) ++hits;
	};
	note(result.errorCode);
	note(result.value.phase);
	note(result.value.admission);
	note(result.value.sessionState);
	if (result.value.agentDisplayName) note(*result.value.agentDisplayName);
	if (result.value.openAnimation) note(*result.value.openAnimation);
	if (result.value.closeAnimation) note(*result.value.closeAnimation);
	for (const Logic::LogEvent& event : result.events) note(event.event);
	for (const Logic::AnimationCue& cue : result.animations) {
		note(cue.intent);
		if (cue.endCause) note(*cue.endCause);
	}
	for (const Logic::Window& window : result.state.windows) {
		note(window.phase);
		note(window.admission);
		note(window.sessionState);
	}
	return hits;
}

}  // namespace

int main() {
	const Logic::LogContext ctx = GoldenContext();
	const Logic::CreateResult created = Logic::CreateWindowManager();
	if (!created.ok) {
		std::cerr << "create\n";
		return 1;
	}

	const Logic::WindowResult first = Logic::OpenWindow(created.state, Live("sess-1", 3), ctx);
	if (!first.ok) return Fail("open-first", first) ? 0 : 1;
	const Logic::WindowResult settled = Logic::SettleOpening(first.state, Live("sess-1", 3), ctx);
	if (!settled.ok) return Fail("settle-first", settled) ? 0 : 1;
	const Logic::WindowResult second = Logic::OpenWindow(settled.state, Live("sess-2", 4, "Card"), ctx);
	if (!second.ok) return Fail("open-second", second) ? 0 : 1;
	const Logic::WindowResult closed = Logic::ClosePanel(second.state, Live("sess-2", 4, "Card"), "auth-dot", ctx);
	if (!closed.ok) return Fail("close", closed) ? 0 : 1;

	const Logic::WindowResult endOpen = Logic::OpenWindow(created.state, Live("sess-end", 1), ctx);
	if (!endOpen.ok) return Fail("end-open", endOpen) ? 0 : 1;
	const Logic::WindowResult endSettled = Logic::SettleOpening(endOpen.state, Live("sess-end", 1), ctx);
	if (!endSettled.ok) return Fail("end-settle", endSettled) ? 0 : 1;
	const Logic::WindowResult endPinned = Logic::ApplyUserAction(endSettled.state, Live("sess-end", 1), "auth-dot", "pin", ctx);
	if (!endPinned.ok) return Fail("pin", endPinned) ? 0 : 1;
	const Logic::WindowResult ended = Logic::ApplySession(
		endPinned.state,
		GoldenSession("sess-end", 1, "Dot", "auth-dot", "ended", Logic::SessionRecord::CauseField::Value, "idle_timeout"),
		ctx);
	if (!ended.ok) return Fail("end", ended) ? 0 : 1;

	Logic::Manager capped = created.state;
	for (int index = 1; index <= 6; ++index) {
		const Logic::WindowResult opened = Logic::OpenWindow(capped, Live("cap-" + std::to_string(index), index), ctx);
		if (!opened.ok) return Fail("cap-open", opened) ? 0 : 1;
		if (opened.value.phase == "opening") {
			const Logic::WindowResult settledCap = Logic::SettleOpening(opened.state, Live("cap-" + std::to_string(index), index), ctx);
			if (!settledCap.ok) return Fail("cap-settle", settledCap) ? 0 : 1;
			capped = settledCap.state;
		} else {
			capped = opened.state;
		}
	}
	const Logic::WindowResult seventh = Logic::OpenWindow(capped, Live("cap-7", 7, "Card"), ctx);
	if (!seventh.ok) return Fail("seventh", seventh) ? 0 : 1;

	const Logic::WorkspaceLayout lone = Logic::TileWindows(settled.state);
	if (lone.shown.empty()) {
		std::cerr << "tile\n";
		return 1;
	}
	const Logic::SessionRecord titleSession = Live("sess-1", 3);
	const Logic::ObserverView view = Logic::MakeObserverView(settled.value, &titleSession);
	const Logic::WindowResult denied = Logic::ApplyUserAction(second.state, Live("sess-2", 4, "Card"), "someone-else", "close", ctx);
	const Logic::WindowResult emptyName = Logic::OpenWindow(created.state, Live("sess-empty", 1, ""), ctx);
	const Logic::SessionRecord missingSession = Unnamed("sess-missing", 2);
	const Logic::WindowResult missingOpen = Logic::OpenWindow(created.state, missingSession, ctx);
	if (!missingOpen.ok || missingOpen.value.agentDisplayName.has_value()) {
		std::cerr << "missing-name\n";
		return 1;
	}
	const Logic::ObserverView missingView = Logic::MakeObserverView(missingOpen.value, &missingSession);
	if (!missingView.title.has_value()) {
		std::cerr << "missing-title\n";
		return 1;
	}
	const Logic::SessionRecord nullSession = Unnamed("sess-null", 5);
	const Logic::WindowResult nullOpen = Logic::OpenWindow(created.state, nullSession, ctx);
	if (!nullOpen.ok || nullOpen.value.agentDisplayName.has_value()) {
		std::cerr << "null-name\n";
		return 1;
	}
	const Logic::ObserverView nullView = Logic::MakeObserverView(nullOpen.value, &nullSession);
	if (!nullView.title.has_value()) {
		std::cerr << "null-title\n";
		return 1;
	}
	const std::optional<std::string> title = Logic::FormatWindowTitle("Dot", 3);

	std::vector<std::string> closeEvents;
	for (const Logic::LogEvent& event : closed.events) closeEvents.push_back(event.event);
	std::vector<std::string> closeIntents;
	for (const Logic::AnimationCue& cue : closed.animations) closeIntents.push_back(cue.intent);
	std::vector<std::string> endEvents;
	for (const Logic::LogEvent& event : ended.events) endEvents.push_back(event.event);
	std::vector<std::string> endIntents;
	for (const Logic::AnimationCue& cue : ended.animations) endIntents.push_back(cue.intent);
	std::vector<std::string> secondIntents;
	for (const Logic::AnimationCue& cue : second.animations) secondIntents.push_back(cue.intent);
	std::vector<std::string> seventhIntents;
	for (const Logic::AnimationCue& cue : seventh.animations) seventhIntents.push_back(cue.intent);
	std::vector<std::string> observerKeys = {"outlineColorToken", "ownerName", "status", "title"};
	std::sort(observerKeys.begin(), observerKeys.end());

	std::vector<std::string> acceptedCauses;
	for (const char* cause : Logic::kSessionEndCauses) {
		const std::string id = std::string("cause-") + cause;
		const Logic::WindowResult causeOpen = Logic::OpenWindow(created.state, Live(id, 1), ctx);
		if (!causeOpen.ok) return Fail("cause-open", causeOpen) ? 0 : 1;
		const Logic::WindowResult causeSettled = Logic::SettleOpening(causeOpen.state, Live(id, 1), ctx);
		if (!causeSettled.ok) return Fail("cause-settle", causeSettled) ? 0 : 1;
		const Logic::WindowResult causeEnded = Logic::ApplySession(
			causeSettled.state,
			GoldenSession(id, 1, "Dot", "auth-dot", "ended", Logic::SessionRecord::CauseField::Value, cause),
			ctx);
		if (!causeEnded.ok) return Fail("cause-end", causeEnded) ? 0 : 1;
		if (causeEnded.animations.empty() || causeEnded.animations[0].intent != "vm_ended_anim") {
			std::cerr << "cause-intent " << cause << "\n";
			return 1;
		}
		if (!causeEnded.animations[0].endCause || *causeEnded.animations[0].endCause != cause) {
			std::cerr << "cause-value " << cause << "\n";
			return 1;
		}
		for (const Logic::AnimationCue& cue : causeEnded.animations) {
			if (cue.intent == "close_anim") {
				std::cerr << "cause-close " << cause << "\n";
				return 1;
			}
		}
		acceptedCauses.push_back(causeEnded.animations[0].endCause.value_or(""));
	}
	const Logic::WindowResult unknownCause = Logic::ApplySession(
		endSettled.state,
		GoldenSession("sess-end", 1, "Dot", "auth-dot", "ended", Logic::SessionRecord::CauseField::Value, "explicit_stop"),
		ctx);
	const Logic::WindowResult runningCause = Logic::ApplySession(
		endSettled.state,
		GoldenSession("sess-end", 1, "Dot", "auth-dot", "running", Logic::SessionRecord::CauseField::Value, "idle_timeout"),
		ctx);

	const std::string sixtyFour(64, 'a');
	const std::string sixtyFive(65, 'a');
	const Logic::WindowResult atLimit = Logic::OpenWindow(created.state, Live("sess-64", 1, sixtyFour), ctx);
	if (!atLimit.ok || !atLimit.value.agentDisplayName || *atLimit.value.agentDisplayName != sixtyFour) {
		std::cerr << "code-points-64\n";
		return 1;
	}
	const Logic::WindowResult overLimit = Logic::OpenWindow(created.state, Live("sess-65", 1, sixtyFive), ctx);
	if (overLimit.ok || overLimit.errorCode != "agent_display_name_rejected") {
		std::cerr << "code-points-65\n";
		return 1;
	}
	const std::string emoji = "\xF0\x9F\x98\x80";
	const std::string emojiAtLimit = std::string(63, 'a') + emoji;
	const std::string emojiOver = std::string(64, 'a') + emoji;
	const Logic::WindowResult emojiOpen = Logic::OpenWindow(created.state, Live("sess-emoji", 1, emojiAtLimit), ctx);
	if (!emojiOpen.ok || !emojiOpen.value.agentDisplayName || *emojiOpen.value.agentDisplayName != emojiAtLimit) {
		std::cerr << "emoji-open\n";
		return 1;
	}
	const Logic::WindowResult emojiRefuse = Logic::OpenWindow(created.state, Live("sess-emoji-over", 1, emojiOver), ctx);
	if (emojiRefuse.ok || emojiRefuse.errorCode != "agent_display_name_rejected") {
		std::cerr << "emoji-over\n";
		return 1;
	}
	const Logic::WindowResult lineSep = Logic::OpenWindow(created.state, Live("sess-line", 1, "Dot\xE2\x80\xA8"), ctx);
	if (lineSep.ok || lineSep.errorCode != "agent_display_name_rejected") {
		std::cerr << "line-sep\n";
		return 1;
	}
	const Logic::WindowResult paraSep = Logic::OpenWindow(created.state, Live("sess-para", 1, "Dot\xE2\x80\xA9"), ctx);
	if (paraSep.ok || paraSep.errorCode != "agent_display_name_rejected") {
		std::cerr << "para-sep\n";
		return 1;
	}
	for (const char* providerName : {"Grok", "Claude", "OpenAI"}) {
		const Logic::SessionRecord record = Live(std::string("sess-") + providerName, 8, providerName);
		const Logic::WindowResult opened = Logic::OpenWindow(created.state, record, ctx);
		if (!opened.ok || !opened.value.agentDisplayName || *opened.value.agentDisplayName != providerName) {
			std::cerr << "shown-name " << providerName << "\n";
			return 1;
		}
		const Logic::ObserverView namedView = Logic::MakeObserverView(opened.value, &record);
		const std::string expected = std::string(providerName) + " \u2014 Wonder Web VM 8";
		if (!namedView.title || *namedView.title != expected || !namedView.ownerName || *namedView.ownerName != providerName) {
			std::cerr << "shown-title " << providerName << "\n";
			return 1;
		}
	}

	const std::string accent = first.value.accentColorToken.value_or("");
	const std::string firstIntent = first.animations.empty() ? "" : first.animations[0].intent;
	const std::string observerTitle = view.title.value_or("");

	std::cout
		<< "{"
		<< "\"accent\":" << Quote(accent) << ","
		<< "\"authCode\":" << Quote(denied.ok ? "" : denied.errorCode) << ","
		<< "\"browserCode\":" << Quote(Logic::AddressByBrowserId("browser-2").code) << ","
		<< "\"causes\":" << Array(acceptedCauses) << ","
		<< "\"closeEvents\":" << Array(closeEvents) << ","
		<< "\"closeIntents\":" << Array(closeIntents) << ","
		<< "\"contract\":" << Quote(Logic::kContract) << ","
		<< "\"defaultCap\":" << Logic::kDefaultShownWindowCap << ","
		<< "\"emptyName\":" << Quote(emptyName.ok ? "" : emptyName.errorCode) << ","
		<< "\"endEvents\":" << Array(endEvents) << ","
		<< "\"endIntents\":" << Array(endIntents) << ","
		<< "\"endPhase\":" << Quote(ended.value.phase) << ","
		<< "\"endPinned\":" << (ended.value.pinned ? "true" : "false") << ","
		<< "\"fallback\":" << Quote(Logic::kAgentDisplayNameFallback) << ","
		<< "\"firstIntent\":" << Quote(firstIntent) << ","
		<< "\"lifetime\":" << LifetimeHits(ended) << ","
		<< "\"missingName\":" << Quote(*missingView.title) << ","
		<< "\"nullName\":" << Quote(*nullView.title) << ","
		<< "\"numberCode\":" << Quote(Logic::AddressByVmNumber(4).code) << ","
		<< "\"observerKeys\":" << Array(observerKeys) << ","
		<< "\"observerTitle\":" << Quote(observerTitle) << ","
		<< "\"runningCause\":" << Quote(runningCause.ok ? "" : runningCause.errorCode) << ","
		<< "\"secondCamera\":" << (second.state.cameraInCloseup ? "true" : "false") << ","
		<< "\"secondIntents\":" << Array(secondIntents) << ","
		<< "\"seventhAdmission\":" << Quote(seventh.value.admission) << ","
		<< "\"seventhIntents\":" << Array(seventhIntents) << ","
		<< "\"seventhPhase\":" << Quote(seventh.value.phase) << ","
		<< "\"seventhSession\":" << Quote(seventh.value.sessionState) << ","
		<< "\"tile1Size\":" << Quote(Fixed6(lone.shown[0].size)) << ","
		<< "\"tile1X\":" << Quote(Fixed6(lone.shown[0].x)) << ","
		<< "\"tile1Y\":" << Quote(Fixed6(lone.shown[0].y)) << ","
		<< "\"title\":" << Quote(title.value_or("")) << ","
		<< "\"unknownCause\":" << Quote(unknownCause.ok ? "" : unknownCause.errorCode)
		<< "}\n";
	return 0;
}
