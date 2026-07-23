import type { RelayProjectDraft } from './contracts';
import { recommendationFor } from './recommendations';

export function RelayRecommendations({ draft, onApply, onSettings }: { draft: RelayProjectDraft; onApply: () => void; onSettings: () => void }) {
  const r = recommendationFor(draft);
  return <section className="rh-recommend">
    <div><p className="rh-kicker">RELAY POLICY RECOMMENDATION</p><h2>RELAY RECOMMENDS</h2></div>
    <dl><div><dt>Prompt Architect</dt><dd>{r.architect}</dd></div><div><dt>Coding Agent</dt><dd>{r.codingAgent}</dd></div>
      <div><dt>Reviewer</dt><dd>{r.reviewer}</dd></div><div><dt>Mode</dt><dd>{r.mode}</dd></div></dl>
    <details><summary>WHY THIS SETUP?</summary><p>{r.reason}</p></details>
    <div className="rh-recommend-actions"><button type="button" className="rh-primary" onClick={onApply}>USE RECOMMENDED SETUP</button><button type="button" onClick={onSettings}>CHANGE SETTINGS</button></div>
  </section>;
}
