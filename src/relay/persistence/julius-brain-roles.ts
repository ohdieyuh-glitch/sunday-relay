/**
 * LEAST PRIVILEGE FOR THE PROJECT BRAIN DATABASE.
 *
 * Roles are created by whoever provisions the database (the provider's tooling
 * or an administrator); this module holds what each is GRANTED, so the grants
 * are reviewed, versioned and proven like the schema they protect.
 *
 *   owner     owns julius_brain and runs migrations. Used only by the
 *             migration step; never by a running service. An owner can disable
 *             a trigger, which is exactly why nothing that runs continuously
 *             may be the owner.
 *   service   what the Brain service runs as: reads everything it needs,
 *             appends history, advances heads, re-projects entities, records
 *             Python executions. No DELETE, no TRUNCATE, no DDL, not an owner —
 *             so the immutability triggers hold against it.
 *   reader    SELECT only: exports, inspection, restore verification.
 *
 * Role names are identifiers supplied by provisioning; they are validated
 * rather than quoted, so a grant can never become a different statement.
 */

const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

function role(name: string): string {
  if (!ROLE.test(name)) throw new Error('julius_brain_role_name_invalid');
  return name;
}

export function juliusBrainRoleGrants(input: { readonly database: string; readonly service: string; readonly reader: string }): string[] {
  const database = role(input.database);
  const service = role(input.service);
  const reader = role(input.reader);
  return [
    `REVOKE ALL ON DATABASE ${database} FROM PUBLIC`,
    `REVOKE ALL ON SCHEMA julius_brain FROM PUBLIC`,
    `GRANT CONNECT ON DATABASE ${database} TO ${service}, ${reader}`,
    `GRANT USAGE ON SCHEMA julius_brain TO ${service}, ${reader}`,

    `GRANT SELECT ON julius_brain.schema_migrations, julius_brain.database_identity TO ${service}`,
    `GRANT SELECT, INSERT ON julius_brain.projects TO ${service}`,
    `GRANT SELECT, INSERT ON julius_brain.brains TO ${service}`,
    // The head only: FOR UPDATE on the Brain row needs an UPDATE privilege, and nothing else about a Brain may change.
    `GRANT UPDATE (head_sequence, head_chain_hash) ON julius_brain.brains TO ${service}`,
    `GRANT SELECT, INSERT ON julius_brain.records, julius_brain.links, julius_brain.content TO ${service}`,
    `GRANT SELECT, INSERT, UPDATE ON julius_brain.entities, julius_brain.python_executions TO ${service}`,
    // The access state is append-only for the service: claims, registrations, sessions and audit are inserted and read, never changed.
    `GRANT SELECT, INSERT ON julius_brain.access_token_claims, julius_brain.access_registrations, julius_brain.access_sessions, julius_brain.access_audit TO ${service}`,

    `GRANT SELECT ON ALL TABLES IN SCHEMA julius_brain TO ${reader}`,
  ];
}
