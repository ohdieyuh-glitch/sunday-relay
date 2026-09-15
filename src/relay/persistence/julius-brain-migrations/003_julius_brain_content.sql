BEGIN;
-- ARTIFACT BYTES, DURABLE WITH THE BRAIN THAT REFERENCES THEM.
--
-- A Brain ARTIFACT record names `cas://sha256/<hex>`. When the Brain is durable
-- the bytes must be too: a record that outlives the disk its bytes were on is
-- a reference to nothing. Rows are content addressed and immutable — the
-- primary key is the hash, the size is checked against the bytes, and nothing
-- updates or deletes a row.
CREATE TABLE julius_brain.content(
 content_hash text PRIMARY KEY CHECK(content_hash ~ '^sha256:[0-9a-f]{64}$'),
 byte_size bigint NOT NULL CHECK(byte_size>=0),
 bytes bytea NOT NULL,
 stored_at timestamptz NOT NULL DEFAULT now(),
 CHECK(octet_length(bytes)=byte_size)
);
INSERT INTO julius_brain.schema_migrations(version) VALUES('003_julius_brain_content');
COMMIT;
