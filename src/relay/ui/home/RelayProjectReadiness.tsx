import type { RelayProjectDraft } from './contracts';
import { projectReadiness } from './recommendations';

export function RelayProjectReadiness({ draft }: { draft: RelayProjectDraft }) {
  const readiness = projectReadiness(draft);
  return <section className={`rh-readiness ${readiness.ready ? 'is-ready' : ''}`} aria-live="polite" aria-label="Project readiness">
    <div><p className="rh-kicker">PROJECT READINESS</p><strong>{readiness.ready ? 'READY TO START' : 'CONFIGURATION REQUIRED'}</strong></div>
    <ul>{Object.entries(readiness.items).map(([name, ready]) => <li key={name}><span>{ready ? '■' : '□'}</span>{name}<em>{ready ? 'READY' : 'MISSING'}</em></li>)}</ul>
  </section>;
}
