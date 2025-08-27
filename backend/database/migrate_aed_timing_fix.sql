-- Migration: Fix AED Timing Issues
-- This script adds absolute timing columns and fixes existing timing data

-- Step 1: Add new columns for absolute timing
ALTER TABLE aed_events 
ADD COLUMN IF NOT EXISTS absolute_start_ms BIGINT,
ADD COLUMN IF NOT EXISTS absolute_end_ms BIGINT;

-- Step 2: Update existing records to calculate absolute timing
-- This converts the current start_ms/end_ms (which are absolute) to relative timing
-- and stores the absolute values in the new columns
UPDATE aed_events 
SET 
  absolute_start_ms = start_ms,
  absolute_end_ms = end_ms,
  start_ms = start_ms - (
    SELECT s.start_ms 
    FROM segments s 
    WHERE s.id = aed_events.segment_id
  ),
  end_ms = end_ms - (
    SELECT s.start_ms 
    FROM segments s 
    WHERE s.id = aed_events.segment_id
  )
WHERE absolute_start_ms IS NULL;

-- Step 3: Ensure relative timing is non-negative
UPDATE aed_events 
SET start_ms = GREATEST(0, start_ms),
    end_ms = GREATEST(start_ms + 1, end_ms)
WHERE start_ms < 0 OR end_ms <= start_ms;

-- Step 4: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_aed_events_absolute_time ON aed_events(recording_id, absolute_start_ms);

-- Step 5: Verify the migration
SELECT 
  'Migration Summary' as info,
  COUNT(*) as total_events,
  COUNT(CASE WHEN absolute_start_ms IS NOT NULL THEN 1 END) as events_with_absolute_timing,
  COUNT(CASE WHEN start_ms >= 0 AND end_ms > start_ms THEN 1 END) as events_with_valid_relative_timing,
  AVG(end_ms - start_ms) as avg_duration_ms
FROM aed_events;     

-- Step 6: Show sample of fixed data
-- Option A: View all data (remove LIMIT)
SELECT 
  id,
  recording_id,
  segment_id,
  start_ms as relative_start_ms,
  end_ms as relative_end_ms,
  absolute_start_ms,
  absolute_end_ms,
  (end_ms - start_ms) as duration_ms
FROM aed_events 
ORDER BY recording_id, absolute_start_ms;

-- Option B: View only first few records for verification (uncomment and adjust as needed)
-- LIMIT 20;

-- Option C: View data for specific recording (uncomment and adjust recording_id)
-- WHERE recording_id = 1
-- ORDER BY absolute_start_ms;
