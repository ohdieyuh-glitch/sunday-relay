export function RelayQuickStart({ onNew, onConnect, onSettings }: { onNew: () => void; onConnect: () => void; onSettings: () => void }) {
  const items = [
    ['01', 'NEW PROJECT', 'Start from an objective and let Relay recommend the workforce and project boundaries.', onNew],
    ['02', 'CONNECT PROJECT', 'Connect an existing repository or import existing project context.', onConnect],
    ['03', 'PROJECT SETTINGS', 'Configure workforce, mode, permissions, limits, and completion requirements.', onSettings],
  ] as const;
  return <section className="rh-quick" aria-labelledby="quick-heading"><h2 id="quick-heading">QUICK START</h2>
    <div>{items.map(([number, title, copy, action]) => <button type="button" key={title} onClick={action}>
      <span>{number}</span><strong>{title}</strong><p>{copy}</p><em>OPEN →</em>
    </button>)}</div>
  </section>;
}
