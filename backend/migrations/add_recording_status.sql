-- Add status field to recordings table for tracking metadata processing
-- Run this in DBeaver to ensure recordings table has proper status tracking

-- 1. Add status column if it doesn't exist
ALTER TABLE recordings 
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'uploaded';

-- 2. Add index for status queries
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);

-- 3. Update existing recordings without status
UPDATE recordings 
SET status = CASE 
  WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN 'processed'
  ELSE 'uploaded'
END
WHERE status IS NULL OR status = '';

-- 4. Add check constraint for valid status values
DO $$
BEGIN
  -- Drop constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'recordings_status_check'
  ) THEN
    ALTER TABLE recordings DROP CONSTRAINT recordings_status_check;
  END IF;
  
  -- Add new constraint
  ALTER TABLE recordings 
  ADD CONSTRAINT recordings_status_check 
  CHECK (status IN ('uploaded', 'processed', 'metadata_failed', 'processing'));
END $$;

-- 5. Show current status distribution
SELECT 
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM recordings 
GROUP BY status
ORDER BY count DESC;

-- 6. Show recordings that need metadata processing
SELECT 
  id,
  name,
  status,
  duration_ms,
  sample_rate,
  created_at
FROM recordings 
WHERE status = 'uploaded' OR duration_ms IS NULL
ORDER BY created_at DESC
LIMIT 10;

COMMENT ON COLUMN recordings.status IS 'Processing status: uploaded, processed, metadata_failed, processing';
