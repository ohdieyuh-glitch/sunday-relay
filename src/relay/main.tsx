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
import './ui/project-workspace/relay-project-workspace.css';
import './ui/project-settings/relay-project-settings.css';
import './ui/chrome/relay-chrome.css';
import './ui/relay-manual-theme.css';
import { RelayPreviewApp } from './ui/preview/RelayPreviewApp';
import { RelayBetaEntry } from './ui/app/RelayBetaEntry';

// Isolated preview wiring (feature/relay-entry-home-claude): the entry now
// renders the preview shell, whose default route is the Relay Entry Home —
// the in-product screen between Sunday Alcatraz and Project Settings. The
// execution console (MissionControl, Prompt 8.2) stays reachable at
// #/relay/console. This is the branch's single integration change beyond
// src/relay/ui/**; see docs/relay/RELAY_ENTRY_HOME.md for reconciliation.
// The beta entry gate is TRANSPARENT unless a live Relay Bridge is configured
// (VITE_RELAY_LIVE=1): the demo build renders the preview app exactly as before.
// With a live bridge it is the front door — sign in, connect a repository, then
// the app — the same journey the API enforces.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RelayBetaEntry>
      <RelayPreviewApp />
    </RelayBetaEntry>
  </StrictMode>,
);
