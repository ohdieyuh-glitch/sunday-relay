import { useRef, useState } from 'react';

import { RelayAgentConfigEditor } from './RelayAgentConfigEditor';
import {
  applyMissionConfigToCard, cardCurrency, cardReference, isPersistedCard, loadAgentDraft, missionConfigLabel,
  projectMissionConfig, saveAgentDraft,
} from '../relay-experience';

/**
 * EDIT THE C.A.R.D. — the pre-Mission surface for the execution boundaries a
 * Mission will REQUEST: repository permissions, the spend/compute ceilings, the
 * execution and review policy.
 *
 * IT EDITS THE ONE AUTHORITATIVE C.A.R.D., NEVER A COPY. It opens on the
 * projection of the record the participant built in the world (or last saved
 * here), and its primary control writes the edit BACK INTO that record — a new
 * revision of the same C.A.R.D. It used to seed from a `sessionStorage` copy or
 * a default and save to that copy, which is why a participant who had just
 * configured their Agent in the world was asked to configure it again. The
 * fresh live journey no longer routes through here at all; this surface is
 * reached only when the participant explicitly chooses Edit C.A.R.D. It never
 * creates a C.A.R.D. — that happens once, in the world — and it never seeds a
 * default in place of one.
 *
 * It needs no session and no bridge: the editor is pure and the working copy
 * lives in local state until the participant commits it. The record is a
 * REQUEST; the bridge remains the authority for what a Mission actually runs
 * under.
 */
export function RelayConfigureAgent({
  onStartBuilding,
  onCancel,
  primaryLabel = 'Save C.A.R.D.',
}: {
  /** The participant committed the edit: it is PERSISTED first, then control
   *  returns to the caller (the runner, with the updated C.A.R.D. re-read). */
  readonly onStartBuilding: () => void;
  /** Leave without saving. Also the way back from the no-C.A.R.D. state. */
  readonly onCancel?: () => void;
  /** The primary control's text. */
  readonly primaryLabel?: string;
}) {
  // Hydrate from the authoritative C.A.R.D.: its projection is the working copy.
  const [card, setCard] = useState(() => loadAgentDraft());
  const hasCard = isPersistedCard(card);
  const [config, setConfig] = useState<unknown>(() => (hasCard ? projectMissionConfig(card) : null));
  // Truthful seed: the C.A.R.D. is named as itself — never as a default.
  const [label, setLabel] = useState(hasCard ? missionConfigLabel(card) : '');
  // What this surface opened on. A commit is refused if the record moved since.
  const opened = useRef(cardReference(card));
  const [notice, setNotice] = useState<string | null>(null);

  if (!hasCard) {
    // NOTHING TO EDIT, AND NOTHING IS INVENTED. A C.A.R.D. is created exactly
    // once, when the participant creates their Compound Agent in the world;
    // this surface only edits one that exists. No default is seeded here.
    return (
      <div className="relay-configure-agent" data-state="no-card">
        <h1>No C.A.R.D. to edit</h1>
        <p role="alert">
          No C.A.R.D. exists in this browser. It is created once, when you create your Compound Agent —
          there is nothing to configure here until then.
        </p>
        {onCancel !== undefined && (
          <button type="button" className="relay-configure-agent__cancel" onClick={onCancel}>Back</button>
        )}
      </div>
    );
  }

  const commit = () => {
    // THE RECORD MAY HAVE MOVED SINCE THIS SURFACE OPENED (another tab, the
    // world). Saving this working copy over it would silently revert every
    // field the copy carries to its mount-time value. The store is the
    // authority: refuse, reload the current record into the form, and let the
    // participant decide again from what is actually configured.
    const currency = cardCurrency(opened.current);
    if (!currency.ok) {
      const current = currency.current;
      setCard(current);
      opened.current = cardReference(current);
      setConfig(isPersistedCard(current) ? projectMissionConfig(current) : null);
      setLabel(isPersistedCard(current) ? missionConfigLabel(current) : '');
      setNotice(currency.reason === 'stale_revision'
        ? `Your C.A.R.D. changed while you were editing (revision ${opened.current.revision} is current). It was reloaded — review it and save again.`
        : currency.reason === 'no_card'
          ? 'Your C.A.R.D. is no longer in this browser.'
          : 'A different C.A.R.D. is active now. It was reloaded — review it and save again.');
      return;
    }
    // WRITE BACK INTO THE RECORD, then hand off. Every field this surface edits
    // is applied; every field it never shows — the network policy, the Project
    // Brain policy, the reviewer policy — keeps its value, and the store
    // advances the revision only if something actually changed.
    saveAgentDraft(applyMissionConfigToCard(currency.current, config));
    onStartBuilding();
  };

  return (
    <div className="relay-configure-agent" data-state="configure">
      <h1>Edit your C.A.R.D.</h1>
      <p>
        This is the C.A.R.D. <strong>{card.name || 'UNNAMED'}</strong> runs under — revision {card.revision}.{' '}
        Its <strong>Prompt Architect</strong>, <strong>Coding Agent</strong> and{' '}
        <strong>independent Reviewer</strong> work under <strong>Relay</strong>&apos;s orchestration; set what a
        Mission may request and the ceilings it runs within. Configured once, the same C.A.R.D. is carried into
        every Mission unchanged.
      </p>
      <RelayAgentConfigEditor
        config={config}
        baseLabel={label}
        onChange={(next, nextLabel) => { setConfig(next); setLabel(nextLabel); }}
      />
      <p className="relay-configure-agent__config">Configured as <strong>{label}</strong>.</p>
      {notice !== null && <p className="relay-configure-agent__notice" role="alert">{notice}</p>}
      <button type="button" className="relay-configure-agent__start" onClick={commit}>
        {primaryLabel}
      </button>
      {onCancel !== undefined && (
        <button type="button" className="relay-configure-agent__cancel" onClick={onCancel}>Cancel</button>
      )}
    </div>
  );
}
