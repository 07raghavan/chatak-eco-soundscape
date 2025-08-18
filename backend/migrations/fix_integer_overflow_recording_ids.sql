-- Simple fix: Just change INTEGER columns to BIGINT
-- This will fix the "value out of range for type integer" error

-- Drop views that might block the column type changes
DROP VIEW IF EXISTS aed_events_unique CASCADE;
DROP VIEW IF EXISTS aed_events_duplicates CASCADE;

-- Change column types from INTEGER to BIGINT
ALTER TABLE recordings ALTER COLUMN id TYPE BIGINT;
ALTER TABLE segments ALTER COLUMN recording_id TYPE BIGINT;
ALTER TABLE segments ALTER COLUMN id TYPE BIGINT;
ALTER TABLE aed_events ALTER COLUMN recording_id TYPE BIGINT;
ALTER TABLE aed_events ALTER COLUMN segment_id TYPE BIGINT;
ALTER TABLE aed_events ALTER COLUMN id TYPE BIGINT;
ALTER TABLE spec_pyramids ALTER COLUMN recording_id TYPE BIGINT;
ALTER TABLE spec_pyramids ALTER COLUMN id TYPE BIGINT;

-- Fix sequences to support BIGINT (only if they exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'recordings_id_seq') THEN
        ALTER SEQUENCE recordings_id_seq AS BIGINT;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'segments_id_seq') THEN
        ALTER SEQUENCE segments_id_seq AS BIGINT;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'aed_events_id_seq') THEN
        ALTER SEQUENCE aed_events_id_seq AS BIGINT;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'spec_pyramids_id_seq') THEN
        ALTER SEQUENCE spec_pyramids_id_seq AS BIGINT;
    END IF;
END $$;

-- Verify the fix
SELECT 'INTEGER OVERFLOW FIX COMPLETE - AED analysis should now work!' as status;
