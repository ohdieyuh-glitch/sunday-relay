// WHAT THE LIVE TERMINAL IS ALLOWED TO SAY.
//
// Founder canon, 2026-08-30, two rules that pull in the same direction:
//
//   "Do NOT show: chain-of-thought, private hidden prompts, secrets,
//    internal sensitive reasoning."
//
//   "Unreal should visualize authoritative execution events. It should not
//    invent authoritative backend state."
//
// Both are enforced here rather than trusted to the renderer.
//
//   * DISCLOSURE is an ALLOWLIST, not a denylist. `normalizeEvent` copies six
//     named fields off an incoming event and ignores the rest, so a producer
//     that starts attaching `reasoning`, `systemPrompt` or `apiKey` cannot
//     leak it into the panel by default -- the new field simply is not read.
//     A denylist would have to be updated every time the backend grows a
//     field, and would be wrong for exactly as long as nobody noticed.
//
//   * AUTHORITY is a state, not a default. With no source connected the
//     terminal says NO AUTHORITATIVE FEED CONNECTED and shows nothing. It
//     does not fill the panels with plausible rows. Relay's own rule --
//     unknown is not zero, simulated data says so -- is the same rule, and
//     a terminal that invents backend state is worse than an empty one
//     because it is convincing.

/** Orchestration categories are JULIUS: the controller ABOVE the workers. */
export const ROLE_LABEL = {
  relay: 'Julius',
  manual_task: 'Julius',
  completion_engine: 'Julius',
  workspace_inspection: 'Julius Inspection',
  verification: 'Julius Verification',
  security: 'Julius Security',
  prompt_architect: 'Prompt Architect',
  research: 'Prompt Architect',
  coding_agent: 'Coding Agent',
  repair: 'Coding Agent',
  reviewer: 'Reviewer',
  system: 'System',
};

/** Which stacked section a row lands in. Julius is its own section. */
export const PANEL_OF = {
  prompt_architect: 'architect', research: 'architect',
  coding_agent: 'coding', repair: 'coding',
  reviewer: 'reviewer', verification: 'reviewer',
  relay: 'julius', manual_task: 'julius', completion_engine: 'julius',
  workspace_inspection: 'julius', security: 'julius', system: 'julius',
};

/** Shapes that must never render even if a producer put one in a headline. */
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,          // provider keys
  /\bgh[pousr]_[A-Za-z0-9]{8,}/g,      // GitHub tokens
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
  /\beyJ[A-Za-z0-9._-]{20,}/g,         // JWTs
  /\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY)[A-Za-z0-9_]*\s*=\s*\S+/g,
];

/** Text that is safe to draw: trimmed, length-capped, secret-shapes removed. */
export function safeText(value, max = 160) {
  if (typeof value !== 'string') return '';
  let out = value;
  for (const re of SECRET_SHAPES) out = out.replace(re, '[redacted]');
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

/**
 * One authoritative execution event -> one safe row, or null.
 *
 * Reads ONLY: category, at, headline, detail, operation, state. Everything
 * else on the event -- however interesting -- is not displayed, because the
 * front end is a projection of execution, not a window into it.
 */
export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const category = typeof raw.category === 'string' ? raw.category : 'system';
  const headline = safeText(raw.headline);
  if (!headline) return null;            // a row with nothing to say is not a row
  const state = raw.state === 'done' || raw.state === 'evidence' || raw.state === 'user'
    ? raw.state : 'open';
  return {
    panel: PANEL_OF[category] || 'julius',
    role: ROLE_LABEL[category] || 'System',
    at: safeText(raw.at, 24),
    headline,
    detail: safeText(raw.detail, 200),
    operation: safeText(raw.operation, 48),
    state,
  };
}

/**
 * The honest state of the feed itself.
 *
 * `connected` is the ONLY thing that turns the LIVE lamp on. A page that is
 * merely open, or that once had a connection, is not live.
 */
export function feedStatus({ connected = false, source = null, events = [] } = {}) {
  if (!connected) {
    return {
      live: false,
      label: 'NO AUTHORITATIVE FEED CONNECTED',
      note: 'The terminal shows Julius execution when Relay is connected. '
          + 'It does not simulate one.',
      rows: [],
    };
  }
  const rows = events.map(normalizeEvent).filter(Boolean);
  return {
    live: true,
    label: 'LIVE',
    note: safeText(source, 80),
    rows,
  };
}
