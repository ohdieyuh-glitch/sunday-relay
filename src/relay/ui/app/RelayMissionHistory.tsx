import { useEffect, useState } from 'react';

import { listBetaMissions, type BetaMissionSummary } from './beta-mission';

/**
 * YOUR MISSIONS — the history list a signed-in beta user sees on the Start
 * screen (criterion 12). Each row is one Mission this bridge still holds for
 * this participant; opening one reconnects the runner to it (its final result,
 * or its live state if still running).
 *
 * It announces facts. An empty list and an unreadable one are DIFFERENT and say
 * so. And it discloses its own scope: the registry is in-memory, so the list
 * reflects what this server currently holds — it never implies a durable
 * archive it does not keep.
 */
export function RelayMissionHistory({
  bridgeUrl,
  onOpen,
  listImpl = listBetaMissions,
}: {
  readonly bridgeUrl?: string | null;
  readonly onOpen: (missionId: string) => void;
  readonly listImpl?: typeof listBetaMissions;
}) {
  const [missions, setMissions] = useState<readonly BetaMissionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listImpl({ bridgeUrl });
      if (cancelled) return;
      if (result.ok) setMissions(result.missions);
      else setNote(result.message);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [listImpl, bridgeUrl]);

  // Nothing to show and nothing to say yet — stay out of the way until loaded.
  if (!loaded && note === null) return null;

  return (
    <section className="relay-mission-history" aria-label="Your Missions">
      <h3>Your Missions</h3>
      {note !== null && <p className="relay-mission-history__note" role="status">{note}</p>}
      {note === null && missions.length === 0 && (
        <p className="relay-mission-history__empty">No Missions yet on this Relay Bridge.</p>
      )}
      {missions.length > 0 && (
        <ul>
          {missions.map((m) => (
            <li key={m.missionId} className="relay-mission-history__row">
              <span className="relay-mission-history__objective">{m.objective || '(no objective)'}</span>
              {' — '}
              <span className="relay-mission-history__state">{m.state}</span>
              <button type="button" onClick={() => onOpen(m.missionId)}>Open</button>
            </li>
          ))}
        </ul>
      )}
      {missions.length > 0 && (
        <p className="relay-mission-history__scope">
          Reflects Missions this Relay Bridge currently holds; a restart clears them.
        </p>
      )}
    </section>
  );
}
