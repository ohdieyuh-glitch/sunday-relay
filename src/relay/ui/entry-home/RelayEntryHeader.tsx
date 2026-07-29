import { useState } from 'react';
import { RelayDogMark } from '../pixel-dog';
import { RelayMenuButton, RelayMobileMenu } from '../chrome';
import type { EntryProductState, HandoffNetworkState } from './contracts';

/**
 * Compact authenticated product header for the Relay Entry Home. The user is
 * already inside the product — no marketing navigation, no sign-up, no
 * pricing. Left: identity + product switcher. Center: system status. Right:
 * terminal, settings, notifications, profile. On mobile the right-side
 * controls collapse behind the founder gold MENU block; the status strip
 * stays visible below the brand.
 */
export function RelayEntryHeader({
  productState,
  handoffNetworkState,
  onReturnToSunday,
  siblingProductUnavailableReason,
  onOpenProjectSettings,
  onOpenTerminal,
}: {
  productState: EntryProductState;
  handoffNetworkState: HandoffNetworkState;
  onReturnToSunday?: () => void;
  siblingProductUnavailableReason?: string;
  onOpenProjectSettings: () => void;
  onOpenTerminal: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <header className="reh-header">
      <div className="reh-header-left">
        <span className="reh-mark" aria-hidden="true">
          <RelayDogMark unit={2} />
        </span>
        <span className="reh-wordmark">SUNDAY RELAY</span>
        <nav className="reh-switcher" aria-label="Product switcher">
          {/* Alcatraz stays visible as an Aquala sibling product — the
              relationship is real. It is only CLICKABLE when a URL is
              configured; otherwise it is disabled and says why, instead of
              navigating to a route this repository does not build. */}
          <button
            type="button"
            className="reh-switch-btn"
            onClick={onReturnToSunday}
            disabled={!onReturnToSunday}
            aria-disabled={!onReturnToSunday}
            aria-pressed={false}
            title={onReturnToSunday ? undefined : siblingProductUnavailableReason}
          >
            ALCATRAZ
          </button>
          <button type="button" className="reh-switch-btn is-active" aria-pressed={true} aria-current="page">
            RELAY
          </button>
        </nav>
      </div>

      <RelayMenuButton onOpen={() => setMenuOpen(true)} />
      <RelayMobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        statusLine={`RLY / HOME — HANDOFF NETWORK ${
          handoffNetworkState === 'online' ? 'ONLINE' : 'STANDBY'
        }`}
        items={[
          {
            id: 'alcatraz',
            label: '← SUNDAY ALCATRAZ',
            onSelect: onReturnToSunday ?? (() => undefined),
            hint: onReturnToSunday ? undefined : 'NOT CONFIGURED',
          },
          { id: 'settings', label: 'PROJECT SETTINGS', onSelect: onOpenProjectSettings },
          { id: 'terminal', label: '>_ OPEN LIVE TERMINAL', onSelect: onOpenTerminal },
          {
            id: 'project-state',
            label: 'PROJECT',
            hint: productState === 'draft' ? 'DRAFT' : 'UNCONFIGURED',
          },
          { id: 'notifications', label: 'NOTIFICATIONS', hint: 'NONE' },
        ]}
      />

      <div className="reh-header-status" aria-label="System status">
        <span className="reh-status-cell">
          <span className="reh-status-key">PROJECT</span>
          <span className="reh-status-val">{productState === 'draft' ? 'DRAFT' : 'UNCONFIGURED'}</span>
        </span>
        <span className="reh-status-cell">
          <span className="reh-status-key">RLY</span>
          <span className="reh-status-val">HOME</span>
        </span>
        <span className="reh-status-cell">
          <span className="reh-status-key">HANDOFF NETWORK</span>
          <span className={`reh-status-val reh-status-val--${handoffNetworkState}`}>
            {handoffNetworkState === 'online' ? 'ONLINE' : 'STANDBY'}
          </span>
        </span>
      </div>

      <div className="reh-header-right">
        <button type="button" className="reh-term-btn" onClick={onOpenTerminal} aria-label="Open Live Terminal">
          <span aria-hidden="true">&gt;_</span>
          <span className="reh-term-btn-label">OPEN LIVE TERMINAL</span>
        </button>
        <button type="button" className="reh-head-btn" onClick={onOpenProjectSettings}>
          PROJECT SETTINGS
        </button>
        <button type="button" className="reh-icon-btn" aria-label="Notifications — none">
          <span aria-hidden="true">◷</span>
        </button>
        <button type="button" className="reh-icon-btn" aria-label="Your profile">
          <span aria-hidden="true">◩</span>
        </button>
      </div>
    </header>
  );
}
