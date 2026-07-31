import type { RoleBillingRow } from './coding-terminal';

/**
 * MISSION ROLES — truthful role, runtime, and billing presentation.
 *
 * The rows are a pure projection (`buildRoleBilling`); this component only
 * renders them. It exists so the workspace can never imply a role ran, was
 * billed, or approved something when it did not:
 *
 *   ChatGPT — Prompt Architect — coordinated by Sunday Alcatraz, which selects
 *     and records the route; the request itself leaves the Relay bridge
 *     directly for OpenAI, and the row never claims a hop that did not occur.
 *     Labeled API PAID only after a proven, attested, api-billed request.
 *   Claude Code — Coding Agent — authenticated local runtime, SUBSCRIPTION.
 *   Hermes — Reviewer — Hermes Agent runtime on the provider its real
 *     configuration resolved to, SUBSCRIPTION, READ ONLY. Hermes is a runtime,
 *     not a model, and is never shown as API PAID.
 */
export function RelayRoleBilling({ rows }: { rows: RoleBillingRow[] }) {
  return (
    <section className="rcat-roles" aria-label="Mission roles, runtimes and billing">
      <h3 className="rcat-roles-title">MISSION ROLES</h3>
      {rows.map((row) => (
        <div className="rcat-role-row" key={row.roleKey}>
          <span className="rcat-role-actor">{row.actor}</span>
          <span className="rcat-role-name">{row.role}</span>
          <span className="rcat-role-runtime">{row.runtime}</span>
          <span className="rcat-role-billing">{row.billingLabel}</span>
          {row.accessLabel && <span className="rcat-role-access">{row.accessLabel}</span>}
          <span className="rcat-role-status">{row.statusLabel}</span>
        </div>
      ))}
    </section>
  );
}
