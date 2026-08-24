BEGIN;
CREATE TABLE relay_wonderland.eval_runtimes(
  battle_id text PRIMARY KEY REFERENCES relay_wonderland.battles ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES relay_wonderland.projects,
  state text NOT NULL CHECK(state IN('CREATED','PREPARING','EVALUATING','REBUTTAL_WINDOW','ADJUDICATING','FINALIZING','COMPLETE','FAILED','CANCELLED')),
  representation_version text NOT NULL,
  rebuttal_deadline timestamptz,
  snapshot jsonb NOT NULL,
  version bigint NOT NULL CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE relay_wonderland.eval_effects(
  battle_id text NOT NULL REFERENCES relay_wonderland.eval_runtimes ON DELETE CASCADE,
  effect_kind text NOT NULL CHECK(effect_kind IN('EVALUATOR_EXECUTION','FINDING','REBUTTAL','ADJUDICATION','RESULT','RATING','STATISTICS','RECOMMENDATION','REWARD')),
  effect_key text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(battle_id,effect_kind,effect_key)
);
CREATE INDEX wonderland_eval_runtime_state ON relay_wonderland.eval_runtimes(state,updated_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('006_wonderland_eval_runtime');
COMMIT;
