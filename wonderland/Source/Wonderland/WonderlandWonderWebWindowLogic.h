#pragma once

/**
 * Wonder Web window decisions for the in-world workspace.
 *
 * Contract: wonderland-wonder-web-windows.v1.
 *
 * This translation unit decides titles, outline tokens, phases, tiles and
 * animation intents. It does not draw, open a socket, or talk to a provider.
 * Time arrives as an injected tsUtcMs. It includes no engine headers.
 *
 * vmNumber is read off the session record. The only place a number is chosen
 * is the session service under src/relay/integration/wonder-web-vm/. A window
 * is addressed by vmSessionId.
 *
 * The TypeScript module of the same contract
 * (src/relay/mission/wonderland/wonder-web-windows.ts) is the persistence
 * reader. This side keeps the same fields in memory and can emit the canonical
 * document. It does not parse one.
 *
 * Open, focus and pin do not extend a session. Server-side idle and hard TTL
 * own lifetime. A session end uses vm_ended_anim. A panel close uses close_anim
 * and never an end cause.
 *
 * endCause follows BRIDGE contract wonder-web-vm-session.v1. It is set only
 * when sessionState is ended or failed, and only from kSessionEndCauses.
 */

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace WonderlandWonderWebWindowLogic {

inline constexpr char kContract[] = "wonderland-wonder-web-windows.v1";

/** Closed set from wonder-web-vm-session.v1. A panel close is not in this set. */
inline constexpr const char* kSessionEndCauses[] = {
	"owner_terminated",
	"idle_timeout",
	"max_lifetime",
	"provider_failed",
	"cap_exhausted",
	"authorization_revoked",
};
inline constexpr std::size_t kSessionEndCauseCount = sizeof(kSessionEndCauses) / sizeof(kSessionEndCauses[0]);
inline constexpr int kDefaultShownWindowCap = 6;
inline constexpr double kDefaultIdleAutoMinimizeMs = 60000.0;
inline constexpr double kDefaultSurfaceRateLimitMs = 5000.0;
inline constexpr char kAgentDisplayNameFallback[] = "Unnamed agent";
/** Present names are measured in Unicode code points, not UTF-16 units and not bytes. */
inline constexpr std::size_t kAgentDisplayNameMaxCodePoints = 64;
inline constexpr char kClientRole[] = "presentational";

struct SessionRecord {
	std::string vmSessionId;
	std::string agentId;
	/** Engaged only when the registry sent a label. Nullopt is missing and null. */
	std::optional<std::string> agentDisplayName;
	int vmNumber = 0;
	std::string terminalId;
	std::string terminalKind;
	std::string terminalDisplayName;
	std::string accentColorRef;
	std::string sessionState;
	/** Omitted, explicit null, or a server reason. A missing reason stays null. */
	enum class CauseField { Omitted, Null, Value };
	CauseField causeField = CauseField::Omitted;
	std::string endCause;
};

struct Window {
	std::string vmSessionId;
	std::string agentId;
	/** Trimmed registry label, or nullopt when the registry omitted it. */
	std::optional<std::string> agentDisplayName;
	std::string terminalId;
	std::string terminalKind;
	std::string terminalDisplayName;
	std::optional<std::string> accentColorToken;
	std::string phase;
	bool pinned = false;
	std::string admission;
	int openedOrder = 0;
	double openedAtMs = 0;
	std::optional<std::string> openAnimation;
	std::optional<std::string> closeAnimation;
	std::optional<double> lastSurfaceAtMs;
	std::optional<double> idleSinceMs;
	std::string sessionState;
};

struct Manager {
	std::string contract;
	int windowCap = kDefaultShownWindowCap;
	bool cameraInCloseup = false;
	int nextOpenedOrder = 1;
	std::vector<Window> windows;
};

struct LogContext {
	double tsUtcMs = 0;
	std::string clientRole;
	std::string netId;
	std::string buildSha;
	std::string corrId;
};

struct LogEvent {
	double tsUtcMs = 0;
	std::string clientRole;
	std::string netId;
	std::string buildSha;
	std::string corrId;
	std::string event;
	std::string vmSessionId;
	std::optional<int> n;
};

struct AnimationCue {
	std::string intent;
	std::string vmSessionId;
	std::optional<std::string> endCause;
};

struct WindowResult {
	bool ok = false;
	Manager state;
	Window value;
	std::vector<LogEvent> events;
	std::vector<AnimationCue> animations;
	std::string errorCode;
	std::string errorMessage;
};

struct CreateResult {
	bool ok = false;
	Manager state;
	std::string errorCode;
	std::string errorMessage;
};

struct VisibilityEvent {
	std::string kind;
	std::optional<double> idleSinceMs;
};

struct VisibilityPolicy {
	double idleAutoMinimizeMs = kDefaultIdleAutoMinimizeMs;
	double surfaceRateLimitMs = kDefaultSurfaceRateLimitMs;
};

struct KeepOut {
	double minX = 0;
	double minY = 0;
	double maxX = 0;
	double maxY = 0;
};

struct TiledWindow {
	std::string vmSessionId;
	double x = 0;
	double y = 0;
	double size = 0;
	double width = 0;
	double height = 0;
};

struct ChipPlacement {
	std::string vmSessionId;
	int dockSlot = 0;
	double x = 0;
	double y = 0;
	double width = 0;
	double height = 0;
};

struct WorkspaceLayout {
	std::vector<TiledWindow> shown;
	std::vector<ChipPlacement> chips;
	bool hasTileArea = false;
	KeepOut tileArea;
};

struct ObserverView {
	std::optional<std::string> outlineColorToken;
	std::optional<std::string> ownerName;
	std::optional<std::string> title;
	std::string status;
};

struct StatusIndicator {
	std::string vmSessionId;
	std::optional<std::string> ownerName;
	std::optional<std::string> outlineColorToken;
	std::optional<std::string> title;
	std::string status;
	int dockSlot = 0;
};

struct AddressError {
	std::string code;
	std::string message;
};

bool IsLegacyBrowserId(const std::string& id);
std::optional<std::string> FormatWindowTitle(const std::optional<std::string>& agentDisplayName, int vmNumber);
std::optional<std::string> AccentTokenFromRef(const std::string& accentColorRef);
AddressError AddressByVmNumber(int vmNumber);
AddressError AddressByBrowserId(const std::string& browserId);

CreateResult CreateWindowManager(std::optional<int> windowCap = std::nullopt);
WindowResult OpenWindow(const Manager& state, const SessionRecord& session, const LogContext& ctx);
WindowResult SettleOpening(const Manager& state, const SessionRecord& session, const LogContext& ctx);
WindowResult ClosePanel(const Manager& state, const SessionRecord& session, const std::string& actorAgentId, const LogContext& ctx);
WindowResult SettleClosing(const Manager& state, const std::string& vmSessionId);
WindowResult ApplySession(const Manager& state, const SessionRecord& session, const LogContext& ctx);
WindowResult ApplyUserAction(
	const Manager& state,
	const SessionRecord& session,
	const std::string& actorAgentId,
	const std::string& action,
	const LogContext& ctx);
WindowResult ApplyVisibility(
	const Manager& state,
	const SessionRecord& session,
	const std::string& actorAgentId,
	const VisibilityEvent& event,
	const LogContext& ctx,
	const VisibilityPolicy& policy = VisibilityPolicy());

std::optional<std::string> DisplayedTitle(const Window& window, const SessionRecord* session);
ObserverView MakeObserverView(const Window& window, const SessionRecord* session);
std::vector<StatusIndicator> StatusIndicators(const Manager& state, const std::vector<SessionRecord>& sessions);
struct TileInput {
	std::vector<KeepOut> keepOut;
	std::optional<std::string> expandedVmSessionId;
};

WorkspaceLayout TileWindows(const Manager& state, const TileInput& input = TileInput());
std::string SerializeWindows(const Manager& state);

}  // namespace WonderlandWonderWebWindowLogic
