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
import { MissionControl } from './ui/MissionControl';

// Prompt 8.2: the primary Relay surface is Mission Control, projecting from
// Relay Core. The earlier custody-rail prototype (RelayApp) remains in the
// tree, parked, for the protocol demonstration.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MissionControl />
  </StrictMode>,
);
