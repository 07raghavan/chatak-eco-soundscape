-- Add audio metadata fields to recordings table
-- Use in DBeaver to migrate existing DB

ALTER TABLE recordings
  ADD COLUMN IF NOT EXISTS duration_ms BIGINT,
  ADD COLUMN IF NOT EXISTS sample_rate INTEGER,
  ADD COLUMN IF NOT EXISTS channels INTEGER,
  ADD COLUMN IF NOT EXISTS codec_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS bit_rate BIGINT;

-- Backfill duration_ms from duration_seconds when available
UPDATE recordings
SET duration_ms = duration_seconds * 1000
WHERE duration_seconds IS NOT NULL AND duration_ms IS NULL;

-- Optional constraints and indexes
CREATE INDEX IF NOT EXISTS idx_recordings_sample_rate ON recordings(sample_rate);
CREATE INDEX IF NOT EXISTS idx_recordings_channels ON recordings(channels);

