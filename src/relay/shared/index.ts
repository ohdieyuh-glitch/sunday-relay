/**
 * `src/relay/shared` — the browser-safe seam between Relay's two surfaces.
 *
 * Contents rule: pure types, fixture data, comparison models and projections
 * that BOTH the website and the CLI need. Nothing here may import a terminal
 * renderer, a persistence implementation, a Node built-in, or a provider SDK.
 *
 * This is deliberately NOT a second Mission Operations domain: the mission
 * contract, status model, capsules, ledger and economics all continue to live
 * in `src/relay/mission`, and this module only projects them for a surface.
 *
 * Enforced by `browser-boundary.test.ts` in this directory.
 */
export {
  COMPETITIVE_MISSION_SPEC,
  projectCompetitiveMission,
  competitiveJson,
} from './competitive-mission';
