-- Fix segments.recording_id to support timestamp-based IDs
-- Run this in DBeaver to fix the INTEGER overflow issue

-- 1. Check current data type
SELECT 
  column_name, 
  data_type, 
  character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'segments' AND column_name = 'recording_id';

-- 2. Change recording_id from INTEGER to BIGINT
ALTER TABLE segments ALTER COLUMN recording_id TYPE BIGINT;

-- 3. Verify the change
SELECT 
  column_name, 
  data_type, 
  character_maximum_length 
FROM information_schema.columns 
WHERE table_name = 'segments' AND column_name = 'recording_id';

-- 4. Test with a large timestamp value
SELECT 'Test query with large recording_id:' as info;
SELECT COUNT(*) as segment_count 
FROM segments 
WHERE recording_id = 1755372143127;

-- 5. Show current max recording_id to ensure we're in safe range
SELECT 
  'Current max recording_id:' as info, 
  COALESCE(MAX(recording_id), 0) as max_recording_id 
FROM segments;

-- Success message
SELECT 'segments.recording_id successfully changed to BIGINT!' as status;
