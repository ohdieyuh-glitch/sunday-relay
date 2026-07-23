import type { AgentConnectionStatuses, RelayProjectDraft } from './contracts';

function statusFor(map: Record<string, string>, name: string) { return (map[name] ?? 'not-configured').replaceAll('-', ' ').toUpperCase(); }

export function RelayWorkforcePreview({ draft, statuses }: { draft: RelayProjectDraft; statuses: AgentConnectionStatuses }) {
  const rows = [
    ['PROMPT ARCHITECT', draft.architect || 'Not selected', statusFor(statuses.architect, draft.architect), 'Mission Contract'],
    ['CODING AGENT', draft.codingAgent || 'Not selected', statusFor(statuses.coding, draft.codingAgent), 'Verified implementation'],
    ['REVIEWER', draft.reviewer || 'Not selected', statusFor(statuses.reviewer, draft.reviewer), 'Approval or repair'],
    ['RELAY', 'Verified result', 'PREVIEW', ''],
  ];
  return <section className="rh-workforce" aria-labelledby="workforce-heading">
    <p className="rh-kicker">SELECTED PIPELINE / PREVIEW</p><h2 id="workforce-heading">RECOMMENDED WORKFORCE</h2>
    <p className="rh-preview-note">Preview only · No mission is running</p>
    <ol>{rows.map(([role, name, status, output], index) => <li key={role}>
      <span className="rh-node">{String(index + 1).padStart(2, '0')}</span><div><small>{role}</small><strong>{name}</strong><em><i /> {status}</em></div>
      {output && <p><span>↓</span> {output}</p>}
    </li>)}</ol>
  </section>;
}
