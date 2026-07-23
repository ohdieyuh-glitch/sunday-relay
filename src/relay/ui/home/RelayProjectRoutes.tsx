import { PROJECT_ROUTES } from './fixtures';

export function RelayProjectRoutes({ selected, onSelect }: { selected?: string; onSelect: (id: string) => void }) {
  return <section className="rh-routes" aria-labelledby="routes-heading">
    <div className="rh-section-head"><p className="rh-kicker">MISSION TYPES / 06 AVAILABLE</p><h2 id="routes-heading">STARTING ROUTES</h2></div>
    <div className="rh-route-list">{PROJECT_ROUTES.map((route) => <button type="button" key={route.id}
      className={selected === route.id ? 'is-selected' : ''} aria-pressed={selected === route.id} onClick={() => onSelect(route.id)}>
      <span>{route.number}</span><div><strong>{route.title}</strong><p>{route.description}</p></div><em>↗</em>
    </button>)}</div>
  </section>;
}
