import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * SUNDAY RELAY — THE CANONICAL PANEL EXPAND CONTROL AND FOCUSED-PANEL SHELL.
 *
 * ONE control and ONE shell for every eligible workspace and Live Terminal
 * panel. Not a modal library, not a second layout system, and not a per-panel
 * design: a panel opts in by wrapping itself, and gets the same icon in the
 * same corner with the same keyboard behaviour as every other panel.
 *
 * THE CENTRAL DESIGN DECISION — FOCUS IN PLACE, NEVER RE-MOUNT.
 *
 * The obvious implementation is to render the panel's content into an overlay
 * when it expands. That is wrong here, and expensively so: the panel would
 * UNMOUNT from its old position and MOUNT in the new one, so React would build
 * a second component instance. For the Coding Agent that means a second
 * `RelayCodingAgentTerminal` — its scroll position, auto-scroll toggle and
 * open diff all reset, and any consumer that treats mounting as "start"
 * genuinely starts something twice.
 *
 * So the panel STAYS EXACTLY WHERE IT IS in the React tree. Expanding sets an
 * attribute; CSS lifts that same DOM node to fill the viewport. Nothing
 * unmounts, nothing re-renders from scratch, no output is lost, no execution
 * restarts, no scroll resets, and there is provably only ever one terminal —
 * `panel-focus.test.tsx` asserts the instance count directly.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it owns no mission state, no terminal
 * state and no agent state. The only thing it knows is WHICH panel is focused,
 * which is view state and belongs to the view. It never touches the Relay Dog.
 */

/** The panels that may be focused. A stable id, not a display string. */
export const RELAY_FOCUSABLE_PANELS = [
  'prompt_architect',
  'coding_agent',
  'reviewer',
  'project_brain',
  'mission_economics',
  'verification',
  'manual_tasks',
  'conversation',
  'console',
  'live_terminal',
] as const;

export type RelayFocusablePanel = (typeof RELAY_FOCUSABLE_PANELS)[number];

/** Human names, used in every aria-label so the control is never ambiguous. */
export const RELAY_PANEL_NAME: Readonly<Record<RelayFocusablePanel, string>> = Object.freeze({
  prompt_architect: 'Prompt Architect',
  coding_agent: 'Coding Agent',
  reviewer: 'Reviewer',
  project_brain: 'Project Brain',
  mission_economics: 'Mission Economics',
  verification: 'Verification',
  manual_tasks: 'Manual tasks',
  conversation: 'Project conversation',
  console: 'Relay Console',
  live_terminal: 'Live Terminal',
});

export const EXPAND_TOOLTIP = 'Expand';
export const RETURN_TOOLTIP = 'Return to workspace';

/**
 * THE FOUR-CORNER EXPAND ICON.
 *
 * Drawn from Relay's existing line weight rather than an icon package, and
 * marked `aria-hidden` because the accessible name lives on the button. The
 * icon never carries meaning on its own.
 */
function CornersIcon({ collapse }: { collapse: boolean }) {
  return (
    <svg
      className="rpw-expand-icon"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
    >
      {collapse ? (
        <path
          d="M7 1v4a2 2 0 0 1-2 2H1M9 1v4a2 2 0 0 0 2 2h4M7 15v-4a2 2 0 0 0-2-2H1M9 15v-4a2 2 0 0 1 2-2h4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="square"
        />
      ) : (
        <path
          d="M1 5.5V1h4.5M10.5 1H15v4.5M15 10.5V15h-4.5M5.5 15H1v-4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="square"
        />
      )}
    </svg>
  );
}

/**
 * The control itself. A REAL button — so it is keyboard-activatable, focusable
 * and announced — with a panel-specific accessible name.
 */
export function RelayPanelExpandButton({
  panel,
  focused,
  onToggle,
  buttonRef,
}: {
  panel: RelayFocusablePanel;
  focused: boolean;
  onToggle: (panel: RelayFocusablePanel) => void;
  buttonRef?: (node: HTMLButtonElement | null) => void;
}) {
  const name = RELAY_PANEL_NAME[panel];
  return (
    <button
      type="button"
      ref={buttonRef}
      className="rpw-expand-btn"
      // The panel NAME is in the label, so a screen-reader user moving between
      // panels never hears eleven identical "Expand" buttons.
      aria-label={focused ? `Return to workspace from ${name} panel` : `Expand ${name} panel`}
      aria-expanded={focused}
      title={focused ? RETURN_TOOLTIP : EXPAND_TOOLTIP}
      data-panel={panel}
      onClick={() => onToggle(panel)}
    >
      <CornersIcon collapse={focused} />
    </button>
  );
}

/** Everything focusable inside the panel, for containment. */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * THE FOCUSED-PANEL SHELL.
 *
 * Wraps a panel wherever it already lives. When `focused` is false it is a
 * plain container and the panel renders exactly as it always has — which is
 * why adding this to a panel cannot change the unfocused workspace.
 *
 * When focused it becomes a dialog: `aria-modal` makes the rest of the
 * application inert to assistive technology, the backdrop makes it inert to
 * the pointer, Escape closes, Tab is contained, and focus returns to the
 * expand button that opened it. This mirrors the focus handling the Live
 * Terminal already uses rather than inventing a second convention.
 */
export function RelayFocusedPanel({
  panel,
  focused,
  onClose,
  returnFocusTo,
  children,
  className,
}: {
  panel: RelayFocusablePanel;
  focused: boolean;
  onClose: () => void;
  /** The expand button to restore focus to, so focus never lands on <body>. */
  returnFocusTo?: HTMLButtonElement | null;
  children: ReactNode;
  className?: string;
}) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const name = RELAY_PANEL_NAME[panel];

  useEffect(() => {
    if (!focused) return undefined;
    const node = shellRef.current;
    // The background must not scroll behind a focused panel — the same rule
    // the Live Terminal already applies.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus moves INTO the focused view on open. The shell itself is the
    // target when it holds no focusable control of its own.
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus?.();
    return () => {
      document.body.style.overflow = previousOverflow;
      // Focus returns to the control that opened it, never to <body>.
      returnFocusTo?.focus?.();
    };
  }, [focused, returnFocusTo]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!focused) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      // CONTAINMENT. Tab cycles inside the focused panel rather than walking
      // into the inert workspace behind it.
      const nodes = Array.from(shellRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      }
    },
    [focused, onClose],
  );

  return (
    <div
      ref={shellRef}
      className={`rpw-focusable${className ? ` ${className}` : ''}`}
      data-panel={panel}
      data-focused={focused ? 'true' : 'false'}
      // Dialog semantics ONLY while focused; unfocused it is a plain wrapper.
      {...(focused
        ? {
          role: 'dialog' as const,
          'aria-modal': true as const,
          'aria-label': `${name} — focused panel`,
          'aria-labelledby': undefined,
          tabIndex: -1,
        }
        : {})}
      onKeyDown={onKeyDown}
    >
      {/* PRESENT EVEN WHEN EMPTY. A live region inserted at the same moment as
          its text is usually not announced at all — the region has to be in
          the accessibility tree first, and only its CONTENT may change. */}
      <p className="rpw-visually-hidden" role="status" aria-live="polite" id={titleId}>
        {focused ? `${name} panel expanded. Press Escape to return to the workspace.` : ''}
      </p>
      {children}
    </div>
  );
}

/**
 * The backdrop that makes the workspace inert to the pointer while a panel is
 * focused. Rendered once by the workspace, never per panel.
 *
 * It is NOT a click-to-close surface: closing is an explicit act through the
 * visible return control or Escape, so a mis-click cannot collapse a terminal
 * someone is reading.
 */
export function RelayFocusBackdrop({ focused }: { focused: boolean }) {
  if (!focused) return null;
  return <div className="rpw-focus-backdrop" aria-hidden="true" />;
}
