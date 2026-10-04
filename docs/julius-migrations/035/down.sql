-- MIGRATION 035: DOWN. Drops the voice tables 035 created and deletes its stamp. (RUNBOOK.md, rollback (b).)
-- One transaction: it refuses, changing nothing, unless 035 is applied and no later migration is. It destroys voice
-- bindings and the issuance record, so it also refuses while any voice table holds a row, unless the loss is stated:
--   SET relay.migration_035_down_accepts_data_loss = 'yes';
-- Tokens already issued are not revoked by this script: run the bridge's reconcile (or wait out their expiry) first.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  held bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice') THEN
    RAISE EXCEPTION 'migration_035_down_refused: 035 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version > '035_wonderland_voice') THEN
    RAISE EXCEPTION 'migration_035_down_refused: a later migration is applied; reverse it first';
  END IF;
  SELECT (SELECT count(*) FROM relay_wonderland.voice_identities) + (SELECT count(*) FROM relay_wonderland.voice_identity_history)
       + (SELECT count(*) FROM relay_wonderland.voice_issuances) INTO held;
  IF held > 0 AND current_setting('relay.migration_035_down_accepts_data_loss', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'migration_035_down_refused: the voice tables hold % rows; set relay.migration_035_down_accepts_data_loss = yes to drop them', held;
  END IF;
END
$$;
DROP TABLE relay_wonderland.voice_issuances, relay_wonderland.voice_identity_history, relay_wonderland.voice_identities;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '035_wonderland_voice';
COMMIT;
