import type {
  WonderWebSurface,
  WonderWebTab,
  WonderWebViewport,
} from '../../mission/wonder-web';
import './relay-wonder-web.css';

/**
 * WONDER WEB — the window, rendered from the founder's reference.
 *
 * This component renders a `WonderWebSurface` and decides NOTHING. Which tabs
 * exist, which controls are live, what the viewport shows and whether the
 * terminal accepts input are all fields on the projection, computed in
 * `src/relay/mission/wonder-web` where they are tested. A renderer that decided
 * any of them would be a second opinion about a user's authority, and the two
 * would eventually disagree.
 *
 * THE FRAME IS THE BOUNDARY. A creation is loaded into a sandboxed iframe
 * pointed at its OWN ORIGIN — the per-creation ephemeral port the bridge opens —
 * and `sandbox` withholds `allow-same-origin` relative to this document, so the
 * creation cannot reach Relay's origin, its storage or its session. The bridge
 * serves `connect-src 'none'` with every byte, which is what closes egress. Both
 * halves are required and both are tested; this attribute alone would not be a
 * boundary, and neither would the header alone.
 *
 * `allow-scripts` is granted because a creation that cannot run is not a
 * creation. It is safe here precisely because the frame is alone in an origin
 * that holds nothing.
 */

const SANDBOX_ALLOWANCES = 'allow-scripts allow-forms allow-pointer-lock';

export function RelayWonderWeb({
  surface,
  creationUrl,
  onSelectTab,
  onBack,
  onForward,
  onReload,
  onStop,
  onRebuild,
  onReturnToProject,
  onClearTerminal,
}: {
  readonly surface: WonderWebSurface;
  /**
   * The bridge's per-creation origin. Null whenever nothing is open, and
   * deliberately NOT derived from the creation record: a URL the renderer
   * assembled itself could point at a creation the surface did not authorize.
   */
  readonly creationUrl: string | null;
  readonly onSelectTab?: (userId: string) => void;
  readonly onBack?: () => void;
  readonly onForward?: () => void;
  readonly onReload?: () => void;
  readonly onStop?: () => void;
  readonly onRebuild?: () => void;
  readonly onReturnToProject?: () => void;
  readonly onClearTerminal?: () => void;
}) {
  const { chrome, terminal, address } = surface;

  return (
    <section className="rww" aria-label="Wonder Web">
      <header className="rww__titlebar">
        <div className="rww__brand">
          <WonderMark className="rww__mark" />
          <span className="rww__wordmark">{surface.title}</span>
        </div>

        <div className="rww__tabs" role="tablist" aria-label="Views">
          {surface.tabs.map((tab) => (
            <TabButton key={tab.userId} tab={tab} onSelect={onSelectTab} />
          ))}
          <button type="button" className="rww__tab rww__tab-add" aria-label="New view">
            +
          </button>
        </div>

        <div className="rww__window-controls">
          <button type="button" className="rww__winbtn" aria-label="Minimize">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <button type="button" className="rww__winbtn" aria-label="Maximize">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <rect x="2.5" y="2.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
          <button type="button" className="rww__winbtn" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.6" />
              <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        </div>
      </header>

      <div className="rww__toolbar">
        <button type="button" className="rww__navbtn" aria-label="Back" disabled={!chrome.canGoBack} onClick={onBack}>
          <Arrow direction="left" />
        </button>
        <button type="button" className="rww__navbtn" aria-label="Forward" disabled={!chrome.canGoForward} onClick={onForward}>
          <Arrow direction="right" />
        </button>
        <button type="button" className="rww__navbtn" aria-label="Reload" disabled={!chrome.canReload} onClick={onReload}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              d="M15 9a6 6 0 1 1-1.8-4.3M15 2.2V5.6h-3.4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="rww__address">
          {/* The lock is a FACT about how the bytes reached the frame, not decoration. */}
          {address.secure ? <LockIcon /> : null}
          <span className="rww__address-text">{address.display}</span>
        </div>

        <button
          type="button"
          className="rww__navbtn"
          aria-label="Return to project"
          disabled={!chrome.canReturnToProject}
          onClick={onReturnToProject}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M9 2.2 11.1 6.6 16 7.3l-3.5 3.4.8 4.8L9 13.2l-4.3 2.3.8-4.8L2 7.3l4.9-.7Z"
              fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="rww__navbtn" aria-label="Menu">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <circle cx="9" cy="3.6" r="1.4" fill="currentColor" />
            <circle cx="9" cy="9" r="1.4" fill="currentColor" />
            <circle cx="9" cy="14.4" r="1.4" fill="currentColor" />
          </svg>
        </button>
      </div>

      <div className="rww__viewport">
        <Viewport viewport={surface.viewport} creationUrl={creationUrl} />
      </div>

      <div className="rww__terminal">
        <div className="rww__terminal-bar">
          <span className="rww__terminal-title">
            <span aria-hidden="true">&gt;_</span> Terminal
          </span>
          <div className="rww__terminal-actions">
            <button type="button" className="rww__terminal-clear" onClick={onClearTerminal}>
              Clear
            </button>
            <span className="rww__terminal-divider" aria-hidden="true" />
            <button
              type="button"
              className="rww__winbtn"
              aria-label="Restart"
              disabled={!chrome.canRestart}
              onClick={onReload}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
                <path d="M4 3 12 7.5 4 12Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="rww__winbtn"
              aria-label="Rebuild"
              disabled={!chrome.canRebuild}
              onClick={onRebuild}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
                <path d="M3 8.1 6 11.2 12.2 4.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className="rww__winbtn"
              aria-label="Stop"
              disabled={!chrome.canStop}
              onClick={onStop}
            >
              <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
                <path d="M3.4 4.3h8.2l-.8 8a1 1 0 0 1-1 .9H5.2a1 1 0 0 1-1-.9ZM5.6 4.3V3a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.3"
                  fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        <div className="rww__terminal-body">
          {terminal.truncatedFrom !== null ? (
            <div className="rww__terminal-line rww__terminal-line--runtime">
              {`… earlier output dropped; showing the last ${terminal.lines.length} of ${terminal.truncatedFrom} lines`}
            </div>
          ) : null}
          {terminal.lines.map((line) => (
            <div
              key={`${line.stream}-${line.sequence}`}
              className={`rww__terminal-line${line.stream === 'runtime' ? ' rww__terminal-line--runtime' : ''}`}
            >
              {line.text}
            </div>
          ))}
          <div className="rww__prompt">
            <span>{terminal.prompt}</span>
            {terminal.acceptsInput ? <span className="rww__cursor" aria-hidden="true" /> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function TabButton({
  tab,
  onSelect,
}: {
  readonly tab: WonderWebTab;
  readonly onSelect?: (userId: string) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tab.isActive}
      className={[
        'rww__tab',
        tab.isActive ? 'rww__tab--active' : '',
        tab.access === 'observe' ? 'rww__tab--observer' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelect?.(tab.userId)}
    >
      <span>{tab.label}</span>
      <span
        className={`rww__dot${tab.connectionState === 'RECONNECTING' ? ' rww__dot--reconnecting' : ''}`}
        style={{ background: `var(--${tab.dotColorToken})` }}
        aria-hidden="true"
      />
    </button>
  );
}

function Viewport({
  viewport,
  creationUrl,
}: {
  readonly viewport: WonderWebViewport;
  readonly creationUrl: string | null;
}) {
  if (viewport.kind === 'creation' && creationUrl !== null) {
    return (
      <iframe
        className="rww__frame"
        title="Creation"
        src={creationUrl}
        sandbox={SANDBOX_ALLOWANCES}
        // Belt and braces with the header the bridge already sends.
        referrerPolicy="no-referrer"
      />
    );
  }
  if (viewport.kind === 'failed') {
    return (
      <div className="rww__state rww__state--failed">
        <span className="rww__state-title">Build failed</span>
        <span className="rww__state-detail">{viewport.summary}</span>
        <span className="rww__state-detail">{`Phase: ${viewport.phase}`}</span>
      </div>
    );
  }
  if (viewport.kind === 'working') {
    return (
      <div className="rww__state">
        <span className="rww__state-title">{viewport.status}</span>
        <span className="rww__state-detail">{viewport.message}</span>
      </div>
    );
  }
  if (viewport.kind === 'observed') {
    return (
      <div className="rww__state">
        <span className="rww__state-title">Another player&rsquo;s creation</span>
        <span className="rww__state-detail">
          {`You can see that this creation exists and that it is ${viewport.status}. Opening, running and reading it belong to its owner.`}
        </span>
      </div>
    );
  }
  // Idle — the Wonder face on black, exactly as the reference rests.
  return <WonderMark className="rww__idle-mark" />;
}

/** The Wonder face: a ring, two facing arcs, and a wave. */
export function WonderMark({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 120" role="img" aria-label="Wonder">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="60" cy="60" r="52" strokeWidth="7" />
        <path d="M40 44a11 11 0 1 0 0 22" strokeWidth="7" />
        <path d="M80 44a11 11 0 1 1 0 22" strokeWidth="7" />
        <path d="M40 55h40" strokeWidth="7" />
        <path d="M34 80q6.5-7 13 0t13 0q6.5-7 13 0t13 0" strokeWidth="7" />
      </g>
    </svg>
  );
}

function Arrow({ direction }: { readonly direction: 'left' | 'right' }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={direction === 'right' ? 'rotate(180 9 9)' : undefined}
      >
        <line x1="15" y1="9" x2="3" y2="9" />
        <polyline points="8,4 3,9 8,14" />
      </g>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-label="Served from an isolated origin" role="img">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        <rect x="2.4" y="5.6" width="8.2" height="6" rx="1.2" />
        <path d="M4.4 5.6V4.1a2.1 2.1 0 0 1 4.2 0v1.5" />
      </g>
    </svg>
  );
}
