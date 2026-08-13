import { useEffect, useState } from 'react';

import { listPsps, loadPsp, savePsp, pspIdFromName, type PspSummary } from './psp-client';

/**
 * CHOOSE OR CREATE A PSP — the surface a signed-in beta user selects a saved
 * configuration profile from, before starting a Mission, or saves the current
 * one under a name (criterion 4).
 *
 * A PSP is CONFIGURATION, not a Mission engine: selecting one only changes which
 * validated {@link RelayMissionConfig} the next Mission will carry, and the
 * component announces facts — a profile reads as "Loaded" only after the bridge
 * returned its config, and "Saved" only after the durable write resolved. It
 * never invents a profile that failed to load, and it states a refusal in the
 * bridge's own words. The bridge remains the authority for what a config may
 * contain; this only picks among what a human already saved.
 */
export function RelayPspPicker({
  bridgeUrl,
  defaultConfig,
  defaultLabel = 'Default beta configuration',
  activeConfig,
  onSelect,
  listImpl = listPsps,
  loadImpl = loadPsp,
  saveImpl = savePsp,
  canSave = true,
}: {
  readonly bridgeUrl?: string | null;
  readonly defaultConfig: unknown;
  readonly defaultLabel?: string;
  readonly activeConfig: unknown;
  readonly onSelect: (config: unknown, label: string) => void;
  readonly listImpl?: typeof listPsps;
  readonly loadImpl?: typeof loadPsp;
  readonly saveImpl?: typeof savePsp;
  /** When false, the picker is LOAD-ONLY — no "save this configuration" control.
   *  Used in the fail-closed no-Agent state, where there is no config to save. */
  readonly canSave?: boolean;
}) {
  const [psps, setPsps] = useState<readonly PspSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Preload the participant's saved profiles. A failure is disclosed, never
  // silently rendered as "no profiles" — an empty list and an unreadable one
  // are different facts.
  const reload = async () => {
    const result = await listImpl({ bridgeUrl });
    if (result.ok) setPsps(result.psps);
    else { setPsps([]); setNote(result.message); }
    return result;
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listImpl({ bridgeUrl });
      if (cancelled) return;
      if (result.ok) setPsps(result.psps);
      else setNote(result.message);
    })();
    return () => { cancelled = true; };
  }, [listImpl, bridgeUrl]);

  const onChange = async (value: string) => {
    setSelectedId(value);
    setNote(null);
    if (value === '') { onSelect(defaultConfig, defaultLabel); return; }
    setBusy(true);
    const result = await loadImpl({ pspId: value, bridgeUrl });
    setBusy(false);
    if (result.ok) { onSelect(result.config, result.name ?? value); setNote(`Loaded “${result.name ?? value}”.`); }
    else setNote(result.message);
  };

  const onSave = async () => {
    const name = saveName.trim();
    setNote(null);
    if (name === '') { setNote('Give the profile a name to save it.'); return; }
    const pspId = pspIdFromName(name);
    if (pspId === null) { setNote('Use letters or numbers in the profile name.'); return; }
    setBusy(true);
    const result = await saveImpl({ pspId, name, config: activeConfig, bridgeUrl });
    if (result.ok) {
      setSaveName('');
      const listed = await reload();
      setBusy(false);
      if (listed.ok) { setSelectedId(pspId); setNote(`Saved “${name}”.`); }
    } else { setBusy(false); setNote(result.message); }
  };

  return (
    <fieldset className="relay-psp-picker" data-busy={busy ? 'true' : 'false'}>
      <legend>Configuration</legend>
      <label>
        Run under
        <select
          aria-label="Configuration (PSP)"
          value={selectedId}
          disabled={busy}
          onChange={(e) => void onChange(e.target.value)}
        >
          <option value="">{defaultLabel}</option>
          {psps.map((p) => (
            <option key={p.pspId} value={p.pspId}>{p.name} · {p.mode}</option>
          ))}
        </select>
      </label>

      {canSave && (
        <div className="relay-psp-picker__save">
          <label>
            Save this configuration as
            <input
              aria-label="New profile name"
              value={saveName}
              disabled={busy}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Careful"
            />
          </label>
          <button type="button" onClick={() => void onSave()} disabled={busy || saveName.trim() === ''}>
            {busy ? 'Working…' : 'Save as PSP'}
          </button>
        </div>
      )}

      {note !== null && <p className="relay-psp-picker__note" role="status">{note}</p>}
    </fieldset>
  );
}
