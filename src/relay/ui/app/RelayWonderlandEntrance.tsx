import { useCallback, useState } from 'react';

import { RelayEntryHome } from '../entry-home';
import type { ProjectRouteDefinition, ConnectionStatuses } from '../entry-home';

// Truthful for the LIVE entrance: NOTHING is connected until the participant
// signs in. The demo DEFAULT_CONNECTION_STATUSES labels the coding agent
// CONNECTED — true in the demo's local-adapter context, false on a hosted live
// entrance — so the live entrance must never borrow it. Every role reads
// sign_in_required, which is the honest state before any GitHub sign-in.
const ENTRANCE_CONNECTION_STATUSES: ConnectionStatuses = {
  promptArchitect: 'sign_in_required',
  codingAgent: 'sign_in_required',
  reviewer: 'sign_in_required',
};

/**
 * THE WONDERLAND ENTRANCE — the live front door of the private beta.
 *
 * Relay does NOT use GitHub as its entrance. A fresh live participant begins
 * HERE, in Wonderland, with the Wandering Relay Dog: they can read the routes,
 * ask the guide, and describe an idea. GitHub sign-in, install and discovery are
 * deferred and CONTEXTUAL — they happen only when the participant deliberately
 * chooses to start building, at which point {@link onStartBuilding} advances the
 * gate to sign-in.
 *
 * This is a thin LIVE wrapper over the PURE {@link RelayEntryHome} — never the
 * preview shell, never the demo store, never any fixture. The props it feeds are
 * truthful and EMPTY: no recent projects, no guide transcript, no fabricated
 * reply, the least-claiming entitlement. "Explore" is simply staying on this
 * screen; the only exit is a start-building affordance. DOM-only.
 */
export function RelayWonderlandEntrance({
  onStartBuilding,
  reducedMotion,
}: {
  /** The participant chose to begin building — the gate reveals GitHub sign-in. */
  readonly onStartBuilding: () => void;
  readonly reducedMotion?: boolean;
}) {
  // Local, browsable exploration state. Nothing here is persisted, dispatched,
  // or sent to a provider — it only keeps the entrance interactive while the
  // participant looks around.
  const [projectIdeaDraft, setProjectIdeaDraft] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<ProjectRouteDefinition | null>(null);

  // Any deliberate "begin building" affordance leaves the entrance for the
  // contextual GitHub sign-in. Describing an idea, choosing a route or asking
  // the guide are exploration and keep the participant here.
  const startBuilding = useCallback(() => { onStartBuilding(); }, [onStartBuilding]);

  return (
    <RelayEntryHome
      productState="unconfigured"
      currentProject={null}
      recentProjects={[]}
      projectIdeaDraft={projectIdeaDraft}
      projectBriefDraft={null}
      selectedRoute={selectedRoute}
      guideMessages={[]}
      guideStatus="idle"
      suggestedQuestions={[]}
      dogState="wandering"
      handoffNetworkState="standby"
      entitlement="free"
      connectionStatuses={ENTRANCE_CONNECTION_STATUSES}
      {...(reducedMotion !== undefined ? { reducedMotion } : {})}
      // Sunday Alcatraz is a separate product with its own deployment; it is not
      // linked from this build, so the control presents itself as unavailable
      // rather than pointing at a route that does not exist here.
      siblingProductUnavailableReason="Sunday Alcatraz is a separate product and isn’t linked from this build."
      // Exploration — stays on the entrance.
      onSelectProjectRoute={setSelectedRoute}
      onUpdateProjectIdea={setProjectIdeaDraft}
      onAskRelay={() => { /* The live entrance never fabricates a guide reply. */ }}
      onSelectSuggestedQuestion={() => { /* no fabricated content on the live path */ }}
      onUpdateProjectBriefDraft={() => { /* no draft engine on the live entrance */ }}
      onCopyProjectBrief={() => { /* nothing to copy on the live entrance */ }}
      onClearProjectBrief={() => { /* nothing to clear on the live entrance */ }}
      // Start building — the deliberate exit into contextual GitHub sign-in.
      onBuildProjectBrief={startBuilding}
      onConnectExistingProject={startBuilding}
      onOpenProjectSettings={startBuilding}
      onOpenTerminal={startBuilding}
      onContinueToProjectSettings={startBuilding}
      onOpenRecentProject={startBuilding}
    />
  );
}
