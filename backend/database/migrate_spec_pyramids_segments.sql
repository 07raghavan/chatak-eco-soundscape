-- Migration: Add segment-based spectrogram support to spec_pyramids table
-- Run this to update existing database to support per-segment spectrograms

-- Add the segment_id column (nullable for existing records)
ALTER TABLE spec_pyramids ADD COLUMN IF NOT EXISTS segment_id INT REFERENCES segments(id) ON DELETE CASCADE;

-- Remove the old unique constraint on recording_id (if it exists)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'spec_pyramids_recording_id_key'
  ) THEN
    ALTER TABLE spec_pyramids DROP CONSTRAINT spec_pyramids_recording_id_key;
  END IF;
END $$;

-- Add new indexes
CREATE INDEX IF NOT EXISTS idx_spec_pyramids_segment_id ON spec_pyramids(segment_id);

-- Add constraints
ALTER TABLE spec_pyramids ADD CONSTRAINT chk_recording_or_segment 
  CHECK ((segment_id IS NULL) OR (segment_id IS NOT NULL));

-- Create unique constraint for recording spectrograms (when segment_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_spec_pyramids_recording_unique 
  ON spec_pyramids(recording_id, spectrogram_type) 
  WHERE segment_id IS NULL;

-- Create unique constraint for segment spectrograms
CREATE UNIQUE INDEX IF NOT EXISTS idx_spec_pyramids_segment_unique 
  ON spec_pyramids(segment_id, spectrogram_type) 
  WHERE segment_id IS NOT NULL;
