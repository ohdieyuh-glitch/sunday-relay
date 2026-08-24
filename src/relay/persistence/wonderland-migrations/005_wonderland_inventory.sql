BEGIN;
CREATE TABLE relay_wonderland.inventory_definitions(
 item_id text NOT NULL,version integer NOT NULL CHECK(version>0),item_type text NOT NULL CHECK(item_type IN('RELAY_DOG_SKIN','PROJECT_AVATAR_SKIN','TITLE','BADGE','PLUGIN','TOOL','COSMETIC','CURRENCY','XP_GRANT')),rarity text NOT NULL,definition jsonb NOT NULL,deprecated boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(item_id,version)
);
ALTER TABLE relay_wonderland.inventory_grants ADD COLUMN IF NOT EXISTS item_version integer NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX wonderland_inventory_unique_active ON relay_wonderland.inventory_grants(player_id,item_id) WHERE revoked_at IS NULL AND (data->>'unique')::boolean=true;
CREATE TABLE relay_wonderland.inventory_equipment(
 player_id text NOT NULL REFERENCES relay_wonderland.players,slot text NOT NULL,item_id text NOT NULL,item_version integer NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(player_id,slot),FOREIGN KEY(item_id,item_version) REFERENCES relay_wonderland.inventory_definitions(item_id,version)
);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('005_wonderland_inventory');
COMMIT;
