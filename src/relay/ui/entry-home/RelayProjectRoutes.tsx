import { useState } from 'react';
import { PRIMARY_PROJECT_ROUTES, SECONDARY_PROJECT_ROUTES } from './recommendations';
import type { ProjectRouteDefinition } from './contracts';

/**
 * PROJECT ROUTES — numbered technical selector plates, not marketing feature
 * cards. Selecting a route prefills the objective + category and updates the
 * workforce/research/evidence recommendations. Selection NEVER begins
 * execution.
 */
export function RelayProjectRoutes({
  selectedRoute,
  onSelectProjectRoute,
}: {
  selectedRoute: ProjectRouteDefinition | null;
  onSelectProjectRoute: (route: ProjectRouteDefinition) => void;
}) {
  const [showMore, setShowMore] = useState(false);

  const renderRoute = (route: ProjectRouteDefinition) => {
    const active = selectedRoute?.routeId === route.routeId;
    return (
      <li key={route.routeId}>
        <button
          type="button"
          className={`reh-route${active ? ' is-active' : ''}`}
          aria-pressed={active}
          onClick={() => onSelectProjectRoute(route)}
        >
          <span className="reh-route-number" aria-hidden="true">
            {route.routeNumber}
          </span>
          <span className="reh-route-body">
            <span className="reh-route-title">{route.title}</span>
            {route.summary && <span className="reh-route-summary">{route.summary}</span>}
            <span className="reh-route-meta">{route.meta}</span>
          </span>
          <span className="reh-route-indicator" aria-hidden="true">
            {active ? '■' : '□'}
          </span>
        </button>
      </li>
    );
  };

  return (
    <section className="reh-routes" aria-labelledby="reh-routes-heading">
      <h2 id="reh-routes-heading" className="reh-section-title">
        PROJECT ROUTES
      </h2>
      <ol className="reh-route-list">{PRIMARY_PROJECT_ROUTES.map(renderRoute)}</ol>

      <button
        type="button"
        className="reh-btn reh-btn--ghost reh-routes-more"
        aria-expanded={showMore}
        onClick={() => setShowMore((v) => !v)}
      >
        {showMore ? 'HIDE ADDITIONAL ROUTES' : 'VIEW MORE PROJECT ROUTES'}
      </button>

      {showMore && (
        <ol className="reh-route-list reh-route-list--secondary" aria-label="Additional project routes">
          {SECONDARY_PROJECT_ROUTES.map(renderRoute)}
        </ol>
      )}
    </section>
  );
}
