BEGIN;
-- WHAT THE BRAIN KEEPS, THE DATABASE REFUSES TO CHANGE.
--
-- The store never updates or deletes history; this makes that a property of
-- the database rather than of the code that happens to be connected to it. A
-- change of truth is a new record — never an UPDATE, a DELETE or a TRUNCATE.
--
--   records, links, content   no UPDATE, no DELETE, no TRUNCATE
--   brains                    no DELETE or TRUNCATE; the head only moves
--                             forward and the identity never changes
--   entities                  current state is re-projected in place, but
--                             never deleted or truncated
--   python_executions,
--   projects                  never deleted or truncated
--
-- A role that owns these tables can still disable a trigger; that is an
-- administrative act outside the application, and the ledger's hash chain is
-- what exposes it afterwards.
CREATE FUNCTION julius_brain.refuse_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'julius_brain_immutable: % on %', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE FUNCTION julius_brain.head_moves_forward() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.brain_id <> OLD.brain_id OR NEW.project_id <> OLD.project_id OR NEW.identity <> OLD.identity OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'julius_brain_immutable: a Brain identity never changes' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.head_sequence < OLD.head_sequence OR (NEW.head_sequence = OLD.head_sequence AND NEW.head_chain_hash <> OLD.head_chain_hash) THEN
    RAISE EXCEPTION 'julius_brain_immutable: a Brain head never moves backwards' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER records_immutable BEFORE UPDATE OR DELETE ON julius_brain.records FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER records_not_truncated BEFORE TRUNCATE ON julius_brain.records FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER links_immutable BEFORE UPDATE OR DELETE ON julius_brain.links FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER links_not_truncated BEFORE TRUNCATE ON julius_brain.links FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER content_immutable BEFORE UPDATE OR DELETE ON julius_brain.content FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER content_not_truncated BEFORE TRUNCATE ON julius_brain.content FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER brains_head_forward BEFORE UPDATE ON julius_brain.brains FOR EACH ROW EXECUTE FUNCTION julius_brain.head_moves_forward();
CREATE TRIGGER brains_not_deleted BEFORE DELETE ON julius_brain.brains FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER brains_not_truncated BEFORE TRUNCATE ON julius_brain.brains FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER entities_not_deleted BEFORE DELETE ON julius_brain.entities FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER entities_not_truncated BEFORE TRUNCATE ON julius_brain.entities FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER python_executions_not_deleted BEFORE DELETE ON julius_brain.python_executions FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER python_executions_not_truncated BEFORE TRUNCATE ON julius_brain.python_executions FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER projects_not_deleted BEFORE DELETE ON julius_brain.projects FOR EACH ROW EXECUTE FUNCTION julius_brain.refuse_change();
CREATE TRIGGER projects_not_truncated BEFORE TRUNCATE ON julius_brain.projects FOR EACH STATEMENT EXECUTE FUNCTION julius_brain.refuse_change();
INSERT INTO julius_brain.schema_migrations(version) VALUES('004_julius_brain_immutability');
COMMIT;
