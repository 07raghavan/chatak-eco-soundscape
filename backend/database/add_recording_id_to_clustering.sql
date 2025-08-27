-- =====================================================
-- ADD RECORDING_ID TO CLUSTERING TABLES
-- =====================================================
-- This migration adds recording_id to all clustering tables for easier querying
-- Run this in DBeaver to update your existing clustering tables

-- =====================================================
-- 1. ADD RECORDING_ID TO CLUSTERING_JOBS TABLE
-- =====================================================

-- Add recording_id column to clustering_jobs
ALTER TABLE clustering_jobs 
ADD COLUMN IF NOT EXISTS recording_id BIGINT REFERENCES recordings(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_clustering_jobs_recording 
ON clustering_jobs(recording_id);

-- =====================================================
-- 2. ADD RECORDING_ID TO CLUSTERS TABLE
-- =====================================================

-- Add recording_id column to clusters
ALTER TABLE clusters 
ADD COLUMN IF NOT EXISTS recording_id BIGINT REFERENCES recordings(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_clusters_recording 
ON clusters(recording_id);

-- =====================================================
-- 3. ADD RECORDING_ID TO CLUSTER_MEMBERSHIPS TABLE
-- =====================================================

-- Add recording_id column to cluster_memberships
ALTER TABLE cluster_memberships 
ADD COLUMN IF NOT EXISTS recording_id BIGINT REFERENCES recordings(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_cluster_memberships_recording 
ON cluster_memberships(recording_id);

-- =====================================================
-- 4. ADD RECORDING_ID TO CLUSTER_QUALITY TABLE
-- =====================================================

-- Add recording_id column to cluster_quality
ALTER TABLE cluster_quality 
ADD COLUMN IF NOT EXISTS recording_id BIGINT REFERENCES recordings(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_cluster_quality_recording 
ON cluster_quality(recording_id);

-- =====================================================
-- 5. ADD RECORDING_ID TO ROI_FEATURES TABLE
-- =====================================================

-- Add recording_id column to roi_features
ALTER TABLE roi_features 
ADD COLUMN IF NOT EXISTS recording_id BIGINT REFERENCES recordings(id) ON DELETE CASCADE;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_roi_features_recording 
ON roi_features(recording_id);

-- =====================================================
-- 6. UPDATE EXISTING RECORDS (if any)
-- =====================================================

-- Update existing clustering_jobs with recording_id from payload if possible
UPDATE clustering_jobs 
SET recording_id = CAST(payload->>'recordingId' AS BIGINT)
WHERE recording_id IS NULL 
  AND payload->>'recordingId' IS NOT NULL;

-- Update existing clusters with recording_id from related jobs if possible
UPDATE clusters c
SET recording_id = cj.recording_id
FROM clustering_jobs cj
WHERE c.recording_id IS NULL 
  AND c.run_id = cj.job_id 
  AND cj.recording_id IS NOT NULL;

-- =====================================================
-- 7. ADD CONSTRAINTS
-- =====================================================

-- Make recording_id NOT NULL for new records
ALTER TABLE clustering_jobs 
ALTER COLUMN recording_id SET NOT NULL;

ALTER TABLE clusters 
ALTER COLUMN recording_id SET NOT NULL;

-- =====================================================
-- 8. VERIFY CHANGES
-- =====================================================

-- Show updated table structures
SELECT 
  'clustering_jobs' as table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'clustering_jobs' 
  AND column_name = 'recording_id'
UNION ALL
SELECT 
  'clusters' as table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'clusters' 
  AND column_name = 'recording_id'
UNION ALL
SELECT 
  'cluster_memberships' as table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'cluster_memberships' 
  AND column_name = 'recording_id';

-- Show new indexes
SELECT 
  indexname,
  tablename,
  indexdef
FROM pg_indexes
WHERE indexname LIKE '%recording%'
  AND tablename IN ('clustering_jobs', 'clusters', 'cluster_memberships', 'cluster_quality', 'roi_features');

-- Success message
SELECT 'RECORDING_ID ADDED TO CLUSTERING TABLES SUCCESSFULLY!' as status;
