/**
 * IS THIS A REAL DEPLOYMENT?
 *
 * The trusted-origin gate has two branches. In production, the service URL's
 * origin must appear in `RELAY_HERMES_TRUSTED_ORIGINS` and an absent policy
 * denies. Outside production, loopback is accepted with no allowlist at all,
 * because a developer running the service on `127.0.0.1` should not have to
 * configure one.
 *
 * Which branch runs was decided by `env.NODE_ENV === 'production'` alone. A
 * Railway service does not set `NODE_ENV` unless somebody remembers to, so the
 * deployed bridge could silently take the DEVELOPMENT branch — the one whose
 * whole point is that it is more permissive. Nothing would be logged, no test
 * would fail, and the rule the README describes would not be the rule running.
 *
 * A forgotten environment variable must not be the difference between a gate
 * and no gate, so the platform's own marker counts too. `RAILWAY_ENVIRONMENT`
 * is set by Railway on every service in every environment and cannot be
 * forgotten by whoever writes the deploy config, because Railway writes it.
 *
 * ONE-WAY. Every signal here can only turn production ON. There is deliberately
 * no variable that turns it off: a host that can be talked out of being a
 * production host is not one.
 */
export function isProductionDeployment(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === 'production') return true;
  // Railway sets this on every service, in every environment, always.
  if (typeof env.RAILWAY_ENVIRONMENT === 'string' && env.RAILWAY_ENVIRONMENT.trim() !== '') return true;
  if (typeof env.RAILWAY_ENVIRONMENT_NAME === 'string' && env.RAILWAY_ENVIRONMENT_NAME.trim() !== '') return true;
  if (typeof env.RAILWAY_SERVICE_ID === 'string' && env.RAILWAY_SERVICE_ID.trim() !== '') return true;
  return false;
}
