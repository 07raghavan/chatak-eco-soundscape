-- Enhance existing job_queue table for idempotency and versioning
-- This addresses the gaps without creating a new table

-- =====================================================
-- 1. ADD MISSING COLUMNS TO EXISTING job_queue TABLE
-- =====================================================

-- Add code version tracking for idempotency
ALTER TABLE job_queue 
ADD COLUMN IF NOT EXISTS code_version TEXT DEFAULT 'v1.0';

ALTER TABLE job_queue 
ADD COLUMN IF NOT EXISTS worker_image TEXT;

ALTER TABLE job_queue 
ADD COLUMN IF NOT EXISTS segment_id BIGINT REFERENCES segments(id);

-- Add more granular job types
ALTER TABLE job_queue 
DROP CONSTRAINT IF EXISTS job_queue_type_check;

-- Add timing columns for better tracking
ALTER TABLE job_queue
ADD COLUMN IF NOT EXISTS started_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS finished_at TIMESTAMP;

-- =====================================================
-- 2. CREATE IDEMPOTENCY CONSTRAINT
-- =====================================================

-- Remove duplicates before creating unique index
DELETE FROM job_queue
WHERE id IN (
  SELECT id FROM (
    SELECT id,
      ROW_NUMBER() OVER (
        PARTITION BY
          COALESCE(segment_id, -1),
          COALESCE((payload->>'recording_id')::BIGINT, -1),
          type,
          code_version
        ORDER BY created_at
      ) AS rn
    FROM job_queue
    WHERE status IN ('queued', 'running', 'succeeded')
  ) t
  WHERE t.rn > 1
);

-- Unique constraint to prevent duplicate jobs
-- Only one active job per (recording_id, segment_id, type, code_version)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_job 
ON job_queue(
  COALESCE(segment_id, -1), 
  COALESCE((payload->>'recording_id')::BIGINT, -1), 
  type, 
  code_version
) 
WHERE status IN ('queued', 'running', 'succeeded');

-- =====================================================
-- 3. ADD HELPER FUNCTIONS FOR IDEMPOTENCY
-- =====================================================

-- Function to safely enqueue job with idempotency check
CREATE OR REPLACE FUNCTION enqueue_job_idempotent(
  p_type TEXT,
  p_payload JSONB,
  p_code_version TEXT DEFAULT 'v1.0',
  p_segment_id BIGINT DEFAULT NULL,
  p_priority INTEGER DEFAULT 5
) RETURNS TABLE(
  result_job_id UUID,
  was_created BOOLEAN,
  existing_status TEXT
) AS $$
DECLARE
  v_recording_id BIGINT;
  v_existing_job RECORD;
  v_new_job_id UUID;
BEGIN
  -- Extract recording_id from payload
  v_recording_id := (p_payload->>'recording_id')::BIGINT;

  -- Check for existing job
  SELECT id, jq.job_id, status INTO v_existing_job
  FROM job_queue jq
  WHERE jq.type = p_type
    AND jq.code_version = p_code_version
    AND COALESCE(jq.segment_id, -1) = COALESCE(p_segment_id, -1)
    AND COALESCE((jq.payload->>'recording_id')::BIGINT, -1) = COALESCE(v_recording_id, -1)
    AND jq.status IN ('queued', 'running', 'succeeded');

  IF FOUND THEN
    -- Return existing job
    result_job_id := v_existing_job.job_id;
    was_created := FALSE;
    existing_status := v_existing_job.status;
    RETURN NEXT;
  ELSE
    -- Create new job
    INSERT INTO job_queue (
      type, payload, code_version, segment_id, priority, created_at, updated_at
    ) VALUES (
      p_type, p_payload, p_code_version, p_segment_id, p_priority, NOW(), NOW()
    ) RETURNING job_queue.job_id INTO v_new_job_id;

    result_job_id := v_new_job_id;
    was_created := TRUE;
    existing_status := 'queued';
    RETURN NEXT;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to check if outputs already exist (skip processing)
CREATE OR REPLACE FUNCTION check_job_outputs_exist(
  p_recording_id BIGINT,
  p_segment_id BIGINT DEFAULT NULL,
  p_job_type TEXT DEFAULT 'segment',
  p_code_version TEXT DEFAULT 'v1.0'
) RETURNS BOOLEAN AS $$
DECLARE
  outputs_exist BOOLEAN := FALSE;
BEGIN
  CASE p_job_type
    WHEN 'segment' THEN
      -- Check if segments exist for this recording
      SELECT EXISTS(
        SELECT 1 FROM segments 
        WHERE recording_id = p_recording_id
      ) INTO outputs_exist;
      
    WHEN 'aed' THEN
      -- Check if AED events exist for this segment/recording
      IF p_segment_id IS NOT NULL THEN
        SELECT EXISTS(
          SELECT 1 FROM aed_events 
          WHERE segment_id = p_segment_id
        ) INTO outputs_exist;
      ELSE
        SELECT EXISTS(
          SELECT 1 FROM aed_events 
          WHERE recording_id = p_recording_id
        ) INTO outputs_exist;
      END IF;
      
    WHEN 'tiles' THEN
      -- Check if spectrogram tiles exist
      SELECT EXISTS(
        SELECT 1 FROM spec_pyramids sp
        JOIN spec_tiles st ON sp.id = st.index_id
        WHERE sp.recording_id = p_recording_id
          AND sp.method_version = p_code_version
      ) INTO outputs_exist;
      
    ELSE
      -- For other job types, assume outputs don't exist
      outputs_exist := FALSE;
  END CASE;
  
  RETURN outputs_exist;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. CREATE VIEWS FOR JOB MONITORING
-- =====================================================

-- View for active jobs with better formatting
CREATE OR REPLACE VIEW active_jobs AS
SELECT 
  j.id,
  j.job_id,
  j.type,
  j.status,
  j.priority,
  j.attempts,
  j.max_attempts,
  j.code_version,
  j.worker_image,
  j.segment_id,
  (j.payload->>'recording_id')::BIGINT as recording_id,
  j.error,
  j.created_at,
  j.updated_at,
  j.started_at,
  j.finished_at,
  CASE 
    WHEN j.finished_at IS NOT NULL AND j.started_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (j.finished_at - j.started_at))
    ELSE NULL 
  END as duration_seconds,
  CASE 
    WHEN j.status = 'running' AND j.started_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (NOW() - j.started_at))
    ELSE NULL 
  END as running_seconds
FROM job_queue j
WHERE j.status IN ('queued', 'running')
ORDER BY j.created_at DESC;

-- View for job statistics
CREATE OR REPLACE VIEW job_stats AS
SELECT 
  type,
  code_version,
  status,
  COUNT(*) as job_count,
  AVG(CASE 
    WHEN finished_at IS NOT NULL AND started_at IS NOT NULL 
    THEN EXTRACT(EPOCH FROM (finished_at - started_at))
    ELSE NULL 
  END) as avg_duration_seconds,
  MAX(attempts) as max_attempts_seen,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count
FROM job_queue 
GROUP BY type, code_version, status
ORDER BY type, code_version, status;

-- =====================================================
-- 5. UPDATE EXISTING DATA
-- =====================================================

-- Set default code version for existing jobs
UPDATE job_queue 
SET code_version = 'v1.0' 
WHERE code_version IS NULL;

-- Update job types to be more specific
UPDATE job_queue 
SET type = 'segment' 
WHERE type = 'segmentation';

-- =====================================================
-- 6. ADD COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN job_queue.code_version IS 'Code version for idempotency - prevents duplicate processing with same version';
COMMENT ON COLUMN job_queue.worker_image IS 'Docker image or worker version that processed this job';
COMMENT ON COLUMN job_queue.segment_id IS 'Segment ID for segment-level jobs (NULL for recording-level jobs)';
COMMENT ON COLUMN job_queue.started_at IS 'When job processing actually started';
COMMENT ON COLUMN job_queue.finished_at IS 'When job processing completed (success or failure)';

COMMENT ON FUNCTION enqueue_job_idempotent IS 'Safely enqueue job with idempotency check - prevents duplicates';
COMMENT ON FUNCTION check_job_outputs_exist IS 'Check if job outputs already exist to skip unnecessary processing';

COMMENT ON INDEX uniq_active_job IS 'Prevents duplicate active jobs for same recording/segment + job type + code version';

COMMENT ON VIEW active_jobs IS 'Currently active (queued/running) jobs with computed metrics';
COMMENT ON VIEW job_stats IS 'Job statistics grouped by type, version, and status';

-- =====================================================
-- 7. VERIFY ENHANCEMENTS
-- =====================================================

-- Show enhanced table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'job_queue' 
ORDER BY ordinal_position;

-- Show new indexes
SELECT 
  indexname, 
  indexdef 
FROM pg_indexes 
WHERE tablename = 'job_queue' 
AND indexname LIKE '%uniq%';

-- Test idempotent job creation
SELECT * FROM enqueue_job_idempotent(
  'segment', 
  '{"recording_id": 123}', 
  'v1.0'
);

-- Success message
SELECT 'job_queue table enhanced with idempotency and versioning!' as status;
