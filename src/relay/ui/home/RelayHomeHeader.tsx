import type { RelayHomeMode, RelayTerminalState } from './contracts';
import { RelayModeSelector } from './RelayModeSelector';

export function RelayHomeHeader({ mode, terminalState, onMode, onSettings, onTerminal }: {
  mode: RelayHomeMode | ''; terminalState: RelayTerminalState; onMode: (mode: RelayHomeMode) => void; onSettings: () => void; onTerminal: () => void;
}) {
  return <header className="rh-header">
    <div className="rh-brand"><span className="rh-mark" aria-hidden="true">R</span><div><b>SUNDAY</b><strong>RELAY</strong></div></div>
    <button className="rh-product" type="button" aria-label="Product switcher, Relay active">PRODUCT / <b>RELAY ▾</b></button>
    <button className="rh-project-select" type="button"><span>PROJECT</span><b>NO PROJECT SELECTED</b><em>▾</em></button>
    <RelayModeSelector value={mode} onChange={onMode} />
    <div className="rh-header-actions">
      <button type="button" onClick={onTerminal} className="rh-terminal-button">[ &gt;_ ] <span>OPEN LIVE TERMINAL</span><i className={`state-${terminalState}`} /></button>
      <button type="button" onClick={onSettings} aria-label="Open Project Settings">⚙ <span>PROJECT SETTINGS</span></button>
      <button type="button" aria-label="Notifications">◇</button>
      <button type="button" aria-label="User profile">KR</button>
    </div>
  </header>;
}
