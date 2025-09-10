-- 0001_fix-uuid-cast.sql
-- Migration script to fix UUID casting errors for meetings and connections tables
-- This migration updates invalid UUID strings to a new generated UUID before altering column types.
-- Ensure that the "uuid-ossp" extension is enabled to use uuid_generate_v4().

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Fix invalid UUIDs in meetings table
UPDATE meetings
SET user1_id = uuid_generate_v4()
WHERE NOT (user1_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

UPDATE meetings
SET user2_id = uuid_generate_v4()
WHERE NOT (user2_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

-- Fix invalid UUIDs in connections table
UPDATE connections
SET user1_id = uuid_generate_v4()
WHERE NOT (user1_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

UPDATE connections
SET user2_id = uuid_generate_v4()
WHERE NOT (user2_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');

-- Alter column types now that all values are valid UUIDs
ALTER TABLE meetings
  ALTER COLUMN user1_id TYPE uuid USING (user1_id::uuid);

ALTER TABLE meetings
  ALTER COLUMN user2_id TYPE uuid USING (user2_id::uuid);

ALTER TABLE connections
  ALTER COLUMN user1_id TYPE uuid USING (user1_id::uuid);

ALTER TABLE connections
  ALTER COLUMN user2_id TYPE uuid USING (user2_id::uuid);

COMMIT;
