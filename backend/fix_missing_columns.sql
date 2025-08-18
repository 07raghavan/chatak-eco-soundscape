-- Fix missing columns in recordings and upload_sessions tables
-- Run this in DBeaver to add all missing columns

-- =====================================================
-- 1. FIX RECORDINGS TABLE
-- =====================================================

-- Add missing columns to recordings table
ALTER TABLE recordings 
ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS recording_date DATE;

-- Update duration_seconds from existing duration_ms
UPDATE recordings 
SET duration_seconds = ROUND(duration_ms / 1000.0)
WHERE duration_ms IS NOT NULL AND duration_seconds IS NULL;

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_recordings_duration_seconds ON recordings(duration_seconds);
CREATE INDEX IF NOT EXISTS idx_recordings_recording_date ON recordings(recording_date);

-- =====================================================
-- 2. FIX UPLOAD_SESSIONS TABLE
-- =====================================================

-- Add missing columns to upload_sessions table
ALTER TABLE upload_sessions 
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS recording_date DATE;

-- =====================================================
-- 3. FIX SEGMENTS TABLE (recording_id should be BIGINT)
-- =====================================================

-- Change segments.recording_id from INTEGER to BIGINT
ALTER TABLE segments ALTER COLUMN recording_id TYPE BIGINT;

-- =====================================================
-- 4. VERIFY SCHEMA CHANGES
-- =====================================================

-- Check recordings table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'recordings' 
ORDER BY ordinal_position;

-- Check upload_sessions table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'upload_sessions' 
ORDER BY ordinal_position;

-- Check segments table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'segments' 
WHERE column_name IN ('id', 'recording_id')
ORDER BY ordinal_position;

-- =====================================================
-- 5. TEST DATA INTEGRITY
-- =====================================================

-- Show recordings with missing data
SELECT 
  id,
  name,
  duration_ms,
  duration_seconds,
  recording_date,
  checksum,
  upload_session_id,
  status
FROM recordings 
ORDER BY created_at DESC 
LIMIT 10;

-- Show upload sessions
SELECT 
  upload_id,
  filename,
  description,
  recording_date,
  status,
  created_at
FROM upload_sessions 
ORDER BY created_at DESC 
LIMIT 10;

-- =====================================================
-- 6. CLEANUP AND OPTIMIZATION
-- =====================================================

-- Update any recordings with missing duration_seconds
UPDATE recordings 
SET duration_seconds = ROUND(duration_ms / 1000.0)
WHERE duration_ms IS NOT NULL 
  AND duration_ms > 0 
  AND (duration_seconds IS NULL OR duration_seconds = 0);

-- Add comments for documentation
COMMENT ON COLUMN recordings.duration_seconds IS 'Duration in seconds (derived from duration_ms)';
COMMENT ON COLUMN recordings.description IS 'User-provided description of the recording';
COMMENT ON COLUMN recordings.recording_date IS 'Date when the recording was made (user-specified)';
COMMENT ON COLUMN recordings.checksum IS 'SHA256 checksum for file integrity verification';
COMMENT ON COLUMN recordings.upload_session_id IS 'Reference to the upload session that created this recording';

COMMENT ON COLUMN upload_sessions.description IS 'User-provided description for the recording';
COMMENT ON COLUMN upload_sessions.recording_date IS 'Date when the recording was made (user-specified)';

-- Success message
SELECT 'All missing columns added and data integrity fixed!' as status;

-- Show final statistics
SELECT 
  'Recordings with complete metadata:' as metric,
  COUNT(*) as count
FROM recordings 
WHERE duration_ms IS NOT NULL 
  AND duration_seconds IS NOT NULL 
  AND sample_rate IS NOT NULL;

SELECT 
  'Upload sessions with metadata:' as metric,
  COUNT(*) as count
FROM upload_sessions;
