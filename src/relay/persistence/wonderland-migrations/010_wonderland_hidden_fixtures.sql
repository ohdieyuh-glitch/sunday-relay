BEGIN;
CREATE TABLE relay_wonderland.hidden_test_fixtures(fixture_id text PRIMARY KEY,version integer NOT NULL CHECK(version>0),mission_id text NOT NULL REFERENCES relay_wonderland.mission_contracts,integrity_hash text NOT NULL,adapter_id text NOT NULL,policy_version text NOT NULL,server_locator text NOT NULL,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(mission_id,fixture_id,version));
CREATE INDEX wonderland_hidden_fixture_mission ON relay_wonderland.hidden_test_fixtures(mission_id,version);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('010_wonderland_hidden_fixtures');
COMMIT;
