import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted Fira Code weights (400/500/700).
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import '@fontsource/fira-code/700.css';
// Relay-owned design tokens + Relay-scoped styles. Relay is an independent
// product: it carries its own token sheet and imports no other product's CSS.
import './relay-tokens.css';
import './relay.css';
import './ui/mission-control.css';
import './ui/pixel-dog/pixel-dog.css';
import './ui/relay-dog-motion/relay-dog-motion.css';
import './ui/entry-home/relay-entry-home.css';
import './ui/landing/relay-landing.css';
import './ui/relay-experience/relay-experience.css';
import './ui/relay-world/relay-world.css';
import './ui/wonderland-hud/wonderland-hud.css';
import './ui/project-workspace/relay-project-workspace.css';
import './ui/project-settings/relay-project-settings.css';
import './ui/chrome/relay-chrome.css';
import './ui/relay-manual-theme.css';
import { RelayPreviewApp } from './ui/preview/RelayPreviewApp';
import { RelayBetaEntry } from './ui/app/RelayBetaEntry';

// The front door is the Relay experience: Aquala → ENTER RELAY → create your
// Compound Agent (its C.A.R.D.) in the world. The preview shell's default route
// renders that same world; the superseded Entry Home survives only at the
// explicit `#/relay/home-legacy` route nothing links to, and the execution
// console stays reachable at #/relay/console.
// The beta entry gate is TRANSPARENT unless a live Relay Bridge is configured
// (VITE_RELAY_LIVE=1 + VITE_RELAY_BRIDGE_URL): the demo build renders the
// preview app. With a live bridge it is the front door — the world, then
// sign-in, then a repository, then Missions under the ONE C.A.R.D. built in
// the world — the same journey the API enforces.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RelayBetaEntry>
      <RelayPreviewApp />
    </RelayBetaEntry>
  </StrictMode>,
);
