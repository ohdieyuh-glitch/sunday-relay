BEGIN;
-- THE PROJECT EXECUTION PROFILE: the operator's half of every player-created
-- Julius contract. Founder decision 4 (2026-09-27): "PLAYERS MUST NEVER AUTHOR
-- THOSE VALUES DIRECTLY" -- the workspace on the executor machine, the
-- verification command, the spend / repair / architect-token ceilings, the
-- research the mission may do, the tenant and the marker namespace prefix. A
-- player route composes a contract from the player's four fields and the
-- CURRENT row here; nothing a player sends can reach these columns.
--
-- APPEND-ONLY BY DESIGN. Every operator write is a new version and the current
-- profile is the highest. Two reasons, both from the Julius lane's review:
-- a version column with no bump rule silently stays 1, and a write that sets
-- where and how paid work runs is an execution-authority write whose history
-- must survive -- who set which workspace, command and budget, and when. So a
-- version moves by construction, and the rows ARE the audit trail. A
-- concurrent writer loses on the primary key rather than overwriting.
--
-- NO CASCADE from projects: an audit trail that vanished with its project
-- would be no audit trail.
CREATE TABLE relay_wonderland.project_execution_profiles (
  project_id  text        NOT NULL REFERENCES relay_wonderland.projects(project_id),
  version     integer     NOT NULL CHECK (version > 0),
  profile     jsonb       NOT NULL,
  written_by  text        NOT NULL CHECK (length(written_by) > 0),
  written_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version)
);

-- WHICH PLAYER CREATED WHICH MISSION, FROM WHICH PROFILE, AS WHAT CONTRACT.
--
-- A mission a player creates is composed in memory from their four fields and
-- the current profile. Two things must outlive that request: WHO asked for it
-- (founder decision 4 is about who may cause paid work, which is unanswerable
-- without a record), and the EXACT contract -- the workspace, command and
-- research are not in the mission snapshot Julius stores, and the operator's
-- paid run (`julius-live-mission run --contract`) needs them. So the composed
-- contract is recorded BEFORE the run is created: a mission that exists always
-- has its contract here. `run_id` is filled once Julius has answered.
--
-- Written once per mission id; the id is derived from (project, player, the
-- client's idempotency key), so a retry finds its own row, never a stranger's.
CREATE TABLE relay_wonderland.player_mission_contracts (
  mission_id       text        PRIMARY KEY,
  project_id       text        NOT NULL,
  player_id        text        NOT NULL CHECK (length(player_id) > 0),
  profile_version  integer     NOT NULL,
  contract         jsonb       NOT NULL,
  run_id           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (project_id, profile_version)
    REFERENCES relay_wonderland.project_execution_profiles(project_id, version)
);
CREATE INDEX player_mission_contracts_project_idx ON relay_wonderland.player_mission_contracts(project_id, created_at);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('027_project_execution_profiles');
COMMIT;
