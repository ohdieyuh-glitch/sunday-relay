import { useState } from 'react';

import {
  LIVE_REACH_READINESS_LABEL,
  allSources,
  capabilityState,
  isActionCapability,
  resolveReadiness,
  shouldShowGlobalNotice,
  shouldShowSourceNotice,
  supportedCapabilities,
  type BackendProbe,
  type LiveReachCapability,
  type LiveReachSettings,
  type LiveReachSource,
} from '../../mission/live-reach';

/**
 * LIVE REACH — what Relay can see, and what it may do.
 *
 * The direction is explicit that default-enabled must be VISIBLE rather than
 * buried, so the first thing this surface says is that these capabilities
 * arrive on. It is also explicit that this must not become a settings wall,
 * so one source is expanded at a time and the capability rows appear only
 * inside the one being looked at.
 *
 * IT SHOWS ONLY WHAT EXISTS. Capability rows come from
 * `supportedCapabilities`, which reads the registry — a source with no backend
 * for an operation has no row for it, so there is no toggle that changes
 * nothing. Today no source supports any ACTION, and rather than hide that this
 * surface says it in the place a founder would look for the switches.
 *
 * READINESS IS NOT A SETTING. It arrives as probes and is displayed, never
 * chosen: a source is READY because something answered, and this screen cannot
 * make it so.
 */

const CAPABILITY_LABEL: Readonly<Record<string, string>> = Object.freeze({
  search: 'Search',
  read_item: 'Read a page or item',
  read_comments: 'Read comments',
  read_profile: 'Read profiles',
  read_feed: 'Read feeds',
  read_media: 'Read media',
  post: 'Post', reply: 'Reply', comment: 'Comment', message: 'Message',
  follow: 'Follow', unfollow: 'Unfollow', like: 'Like', delete: 'Delete', apply: 'Apply',
});

export interface RelayLiveReachSettingsProps {
  readonly settings: LiveReachSettings;
  /** Observed probes. Absent means nothing has been probed, which reads UNKNOWN. */
  readonly probes?: readonly BackendProbe[];
  readonly onSetCapability?: (source: LiveReachSource, capability: LiveReachCapability, enabled: boolean) => void;
  readonly onSetGroup?: (source: LiveReachSource, group: 'read' | 'actions' | 'integration', enabled: boolean) => void;
  readonly onDisableAll?: () => void;
  readonly onAcknowledgeGlobal?: () => void;
  readonly onAcknowledgeSource?: (source: LiveReachSource) => void;
}

export function RelayLiveReachSettings({
  settings,
  probes = [],
  onSetCapability,
  onSetGroup,
  onDisableAll,
  onAcknowledgeGlobal,
  onAcknowledgeSource,
}: RelayLiveReachSettingsProps) {
  const [open, setOpen] = useState<LiveReachSource | null>(null);
  const sources = allSources();
  const interactive = onSetCapability !== undefined && onSetGroup !== undefined;

  const readinessFor = (source: LiveReachSource) => {
    const capabilities = supportedCapabilities(source);
    if (capabilities.length === 0) return 'capability_unsupported' as const;
    // The source's best answer across what it can do: a founder asking "can
    // Relay use this" is asking whether ANYTHING works, not whether everything
    // does. Per-capability detail lives inside the expanded panel.
    const states = capabilities.map((capability) => resolveReadiness({ source, capability, probes }));
    return states.includes('ready') ? 'ready' as const : (states[0] ?? 'unknown' as const);
  };

  return (
    <section className="rlr" aria-labelledby="rlr-heading">
      <header className="rlr-head">
        <h2 id="rlr-heading" className="rlr-title">LIVE REACH</h2>
        <p className="rlr-sub">
          Current information from outside Relay, retrieved through Relay&apos;s own
          network policy and recorded as evidence.
        </p>
      </header>

      {/* THE ONCE-ONLY GLOBAL NOTICE. Non-blocking, and it does not return. */}
      {shouldShowGlobalNotice(settings) && (
        <div className="rlr-notice" role="status" data-notice="global">
          <p className="rlr-notice-body">
            Relay&apos;s connected capabilities are <strong>enabled by default</strong>. Your
            Compound Agent may use them for live information, and for supported account
            actions, when a Mission requires it. Relay does not act on its own: a
            capability being available is not permission to use it.
          </p>
          <div className="rlr-notice-actions">
            <button type="button" className="rlr-btn rlr-btn--primary" onClick={onAcknowledgeGlobal}>
              KEEP ENABLED
            </button>
            <button type="button" className="rlr-btn" onClick={onAcknowledgeGlobal}>
              MANAGE INDIVIDUALLY
            </button>
            <button
              type="button"
              className="rlr-btn rlr-btn--quiet"
              onClick={() => { onDisableAll?.(); onAcknowledgeGlobal?.(); }}
            >
              DISABLE ALL
            </button>
          </div>
        </div>
      )}

      <ul className="rlr-list">
        {sources.map((definition) => {
          const source = definition.source;
          const readiness = readinessFor(source);
          const capabilities = supportedCapabilities(source);
          const reads = capabilities.filter((c) => !isActionCapability(c));
          const actions = capabilities.filter(isActionCapability);
          const expanded = open === source;

          return (
            <li key={source} className="rlr-item">
              <button
                type="button"
                className="rlr-row"
                /* Selecting a row by its source id rather than by its label:
                   the status dot is aria-hidden and the readiness word is part
                   of the accessible name, so matching on text is brittle in a
                   way that has nothing to do with what is being tested. */
                data-source={source}
                aria-expanded={expanded}
                onClick={() => { setOpen(expanded ? null : source); }}
              >
                <span className={`rlr-dot rlr-dot--${readiness}`} aria-hidden="true">●</span>
                <span className="rlr-name">{definition.displayName}</span>
                <span className={`rlr-state rlr-state--${readiness}`}>
                  {LIVE_REACH_READINESS_LABEL[readiness]}
                </span>
              </button>

              {expanded && (
                <div className="rlr-panel">
                  {/* THE PER-SOURCE NOTICE, once, on first entry to THIS source. */}
                  {shouldShowSourceNotice(source, settings) && capabilities.length > 0 && (
                    <div className="rlr-notice rlr-notice--source" role="status" data-notice={source}>
                      <p className="rlr-notice-body">
                        {definition.displayName} access is currently enabled. Relay may use this
                        connection for supported live information when a Mission requires it.
                        You can disable this integration, its read access, or individual
                        capabilities below.
                      </p>
                      <button type="button" className="rlr-btn" onClick={() => { onAcknowledgeSource?.(source); }}>
                        GOT IT
                      </button>
                    </div>
                  )}

                  <p className="rlr-note">{definition.accessNote}</p>

                  {capabilities.length === 0 ? (
                    <p className="rlr-note rlr-note--absent">
                      Relay has no backend for this source, so there is nothing to switch on.
                      It is listed because knowing what Relay cannot reach is worth as much as
                      knowing what it can.
                    </p>
                  ) : (
                    <>
                      <Group
                        label="INTEGRATION"
                        enabled={settings.sources?.[source]?.enabled !== false}
                        interactive={interactive}
                        onChange={(next) => { onSetGroup?.(source, 'integration', next); }}
                      />
                      <fieldset className="rlr-group">
                        <legend>EYES · READ ACCESS</legend>
                        {reads.map((capability) => (
                          <Toggle
                            key={capability}
                            label={CAPABILITY_LABEL[capability] ?? capability}
                            enabled={capabilityState(source, capability, settings).enabled}
                            interactive={interactive}
                            onChange={(next) => { onSetCapability?.(source, capability, next); }}
                          />
                        ))}
                      </fieldset>

                      <fieldset className="rlr-group">
                        <legend>ACTIONS · PUBLISH ACCESS</legend>
                        {actions.length === 0 ? (
                          <p className="rlr-note rlr-note--absent">
                            Relay performs no actions on this source. No backend implements one,
                            so no switch is shown — a control here would be a claim that Relay
                            can do something it cannot.
                          </p>
                        ) : actions.map((capability) => (
                          <Toggle
                            key={capability}
                            label={CAPABILITY_LABEL[capability] ?? capability}
                            enabled={capabilityState(source, capability, settings).enabled}
                            interactive={interactive}
                            onChange={(next) => { onSetCapability?.(source, capability, next); }}
                          />
                        ))}
                      </fieldset>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Group({ label, enabled, interactive, onChange }: {
  label: string; enabled: boolean; interactive: boolean; onChange: (next: boolean) => void;
}) {
  return (
    <div className="rlr-master">
      <Toggle label={label} enabled={enabled} interactive={interactive} onChange={onChange} />
    </div>
  );
}

function Toggle({ label, enabled, interactive, onChange }: {
  label: string; enabled: boolean; interactive: boolean; onChange: (next: boolean) => void;
}) {
  // A read-only host gets the STATE, never an input that silently does nothing.
  if (!interactive) {
    return (
      <p className="rlr-toggle rlr-toggle--readonly">
        <span className="rlr-toggle-label">{label}</span>
        <span className="rlr-toggle-state">{enabled ? 'ON' : 'OFF'}</span>
      </p>
    );
  }
  return (
    <label className="rlr-toggle">
      <input
        type="checkbox"
        checked={enabled}
        onChange={(event) => { onChange(event.target.checked); }}
      />
      <span className="rlr-toggle-label">{label}</span>
      <span className="rlr-toggle-state">{enabled ? 'ON' : 'OFF'}</span>
    </label>
  );
}
