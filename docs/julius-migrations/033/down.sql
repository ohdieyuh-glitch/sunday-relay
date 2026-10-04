-- MIGRATION 033: DOWN. Drops the Wonderland social tables 033 created, and its sequence, and deletes its stamp.
-- (RUNBOOK.md, rollback (b).)
-- Use only on a recorded decision. One transaction: it refuses, and changes nothing, unless 033 is applied and no later
-- migration is. IT DESTROYS SOCIAL DATA, so it also refuses while any social table holds a row, unless the operator
-- states the loss in the same session first:
--   SET relay.migration_033_down_accepts_data_loss = 'yes';
-- AFTER RUNNING IT, the deployed code must no longer list 033, or the next migrate() re-applies it.
\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE
  held bigint := 0;
  counted bigint;
  social text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social') THEN
    RAISE EXCEPTION 'migration_033_down_refused: 033 is not applied here';
  END IF;
  IF EXISTS (SELECT 1 FROM relay_wonderland.schema_migrations WHERE version > '033_wonderland_social') THEN
    RAISE EXCEPTION 'migration_033_down_refused: a later migration is applied; reverse it first';
  END IF;
  FOR social IN SELECT tablename FROM pg_tables WHERE schemaname = 'relay_wonderland' AND tablename LIKE 'social\_%' LOOP
    EXECUTE format('SELECT count(*) FROM relay_wonderland.%I', social) INTO counted;
    held := held + counted;
  END LOOP;
  IF held > 0 AND current_setting('relay.migration_033_down_accepts_data_loss', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'migration_033_down_refused: the social tables hold % rows; set relay.migration_033_down_accepts_data_loss = yes to drop them', held;
  END IF;
END
$$;
DROP TABLE relay_wonderland.social_commands, relay_wonderland.social_messages, relay_wonderland.social_encounters,
  relay_wonderland.social_presence, relay_wonderland.social_server_invites, relay_wonderland.social_server_members,
  relay_wonderland.social_servers, relay_wonderland.social_party_invites, relay_wonderland.social_party_members,
  relay_wonderland.social_parties, relay_wonderland.social_blocks, relay_wonderland.social_friend_requests,
  relay_wonderland.social_friendships, relay_wonderland.social_settings, relay_wonderland.social_profiles;
DROP SEQUENCE relay_wonderland.social_join_order;
DELETE FROM relay_wonderland.schema_migrations WHERE version = '033_wonderland_social';
COMMIT;
