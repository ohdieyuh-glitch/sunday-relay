import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Same self-hosted Fira Code weights as the main app (400/500/700).
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import '@fontsource/fira-code/700.css';
// Sunday design tokens (read-only reuse) + Relay-scoped styles.
import '@/styles/global.css';
import './relay.css';
import './ui/mission-control.css';
import './ui/pixel-dog/pixel-dog.css';
import './ui/entry-home/relay-entry-home.css';
import { RelayPreviewApp } from './ui/preview/RelayPreviewApp';

// Isolated preview wiring (feature/relay-entry-home-claude): the entry now
// renders the preview shell, whose default route is the Relay Entry Home —
// the in-product screen between Sunday Alcatraz and Project Settings. The
// execution console (MissionControl, Prompt 8.2) stays reachable at
// #/relay/console. This is the branch's single integration change beyond
// src/relay/ui/**; see docs/relay/RELAY_ENTRY_HOME.md for reconciliation.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RelayPreviewApp />
  </StrictMode>,
);
