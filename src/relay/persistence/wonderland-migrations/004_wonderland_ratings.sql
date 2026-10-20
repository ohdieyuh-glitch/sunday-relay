BEGIN;
CREATE TABLE relay_wonderland.agent_ratings(
  agent_id text NOT NULL REFERENCES relay_wonderland.agents,
  mode text NOT NULL CHECK(mode IN('GOAL','EVAL')),
  rating double precision NOT NULL,
  deviation double precision NOT NULL CHECK(deviation>0),
  volatility double precision NOT NULL CHECK(volatility>0),
  period bigint NOT NULL CHECK(period>=0),
  battle_count bigint NOT NULL CHECK(battle_count>=0),
  provisional boolean NOT NULL,
  source_battle_id text REFERENCES relay_wonderland.battles,
  updated_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  PRIMARY KEY(agent_id,mode)
);
CREATE TABLE relay_wonderland.rating_history(
  battle_id text NOT NULL REFERENCES relay_wonderland.battles,
  agent_id text NOT NULL REFERENCES relay_wonderland.agents,
  mode text NOT NULL CHECK(mode IN('GOAL','EVAL')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(battle_id,agent_id,mode)
);
CREATE INDEX wonderland_rating_history_agent ON relay_wonderland.rating_history(agent_id,mode,created_at DESC);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('004_wonderland_ratings');
COMMIT;
