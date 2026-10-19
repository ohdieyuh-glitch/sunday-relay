BEGIN;
ALTER TABLE relay_wonderland.julius_sandboxes ADD COLUMN sandbox_policy jsonb NOT NULL DEFAULT '{}', ADD COLUMN dispatch_generation bigint, ADD COLUMN execution_token_hash text, ADD COLUMN recovery_from_state text, ADD COLUMN recovery_owner text, ADD COLUMN owner_expires_at timestamptz NOT NULL DEFAULT (clock_timestamp()+interval '30 seconds');
ALTER TABLE relay_wonderland.julius_sandboxes ADD CHECK(dispatch_generation IS NULL OR dispatch_generation>0), ADD CHECK(execution_token_hash IS NULL OR length(execution_token_hash)=64);
ALTER TABLE relay_wonderland.julius_tool_settlements
 ADD COLUMN settlement_id text,
 ADD COLUMN dispatch_generation bigint,
 ADD COLUMN result_digest text,
 ADD COLUMN command_digest text,
 ADD COLUMN result jsonb;
UPDATE relay_wonderland.julius_tool_settlements
 SET settlement_id='legacy:'||invocation_id,dispatch_generation=1,result_digest=receipt_digest,command_digest=receipt_digest,result='{}'::jsonb;
ALTER TABLE relay_wonderland.julius_tool_settlements
 ALTER COLUMN settlement_id SET NOT NULL,
 ALTER COLUMN dispatch_generation SET NOT NULL,
 ALTER COLUMN result_digest SET NOT NULL,
 ALTER COLUMN command_digest SET NOT NULL,
 ALTER COLUMN result SET NOT NULL,
 ADD UNIQUE(settlement_id),
 ADD CHECK(dispatch_generation>0),
 ADD CHECK(length(result_digest)=64),
 ADD CHECK(length(command_digest)=64),
 ADD CHECK(result_digest=receipt_digest);
INSERT INTO relay_wonderland.schema_migrations(version) VALUES('021_julius_tool_settlement');
COMMIT;
