-- Add deduplication support to aed_events table
-- Run this in DBeaver to add cross-segment deduplication capabilities

-- =====================================================
-- 1. ADD DEDUPLICATION COLUMNS
-- =====================================================

-- Add duplicate tracking column
ALTER TABLE aed_events 
ADD COLUMN IF NOT EXISTS duplicate_of INTEGER REFERENCES aed_events(id);

-- Add deduplication metadata
ALTER TABLE aed_events 
ADD COLUMN IF NOT EXISTS temporal_iou DECIMAL(4,3),
ADD COLUMN IF NOT EXISTS frequency_iou DECIMAL(4,3),
ADD COLUMN IF NOT EXISTS dedup_confidence DECIMAL(4,3);

-- =====================================================
-- 2. ADD PERFORMANCE INDEXES
-- =====================================================

-- Index for cross-segment deduplication queries
CREATE INDEX IF NOT EXISTS idx_aed_events_recording_time 
ON aed_events(recording_id, start_ms, end_ms);

-- Index for segment boundary queries
CREATE INDEX IF NOT EXISTS idx_aed_events_segment_time 
ON aed_events(segment_id, start_ms, end_ms);

-- Index for frequency range queries
CREATE INDEX IF NOT EXISTS idx_aed_events_frequency 
ON aed_events(recording_id, f_min_hz, f_max_hz);

-- Index for duplicate relationships
CREATE INDEX IF NOT EXISTS idx_aed_events_duplicate_of 
ON aed_events(duplicate_of) WHERE duplicate_of IS NOT NULL;

-- Composite index for deduplication queries
CREATE INDEX IF NOT EXISTS idx_aed_events_dedup_lookup 
ON aed_events(recording_id, start_ms, end_ms, f_min_hz, f_max_hz) 
WHERE duplicate_of IS NULL;

-- =====================================================
-- 3. ADD CONSTRAINTS AND VALIDATION
-- =====================================================

-- Ensure duplicate_of references valid events
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_duplicate_of_not_self'
        AND table_name = 'aed_events'
    ) THEN
        ALTER TABLE aed_events
        ADD CONSTRAINT chk_duplicate_of_not_self
        CHECK (duplicate_of IS NULL OR duplicate_of != id);
    END IF;
END $$;

-- Ensure IoU values are valid (0-1 range)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_temporal_iou_range'
        AND table_name = 'aed_events'
    ) THEN
        ALTER TABLE aed_events
        ADD CONSTRAINT chk_temporal_iou_range
        CHECK (temporal_iou IS NULL OR (temporal_iou >= 0 AND temporal_iou <= 1));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_frequency_iou_range'
        AND table_name = 'aed_events'
    ) THEN
        ALTER TABLE aed_events
        ADD CONSTRAINT chk_frequency_iou_range
        CHECK (frequency_iou IS NULL OR (frequency_iou >= 0 AND frequency_iou <= 1));
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'chk_dedup_confidence_range'
        AND table_name = 'aed_events'
    ) THEN
        ALTER TABLE aed_events
        ADD CONSTRAINT chk_dedup_confidence_range
        CHECK (dedup_confidence IS NULL OR (dedup_confidence >= 0 AND dedup_confidence <= 1));
    END IF;
END $$;

-- =====================================================
-- 4. CREATE DEDUPLICATION FUNCTIONS
-- =====================================================

-- Function to calculate temporal IoU between two events
CREATE OR REPLACE FUNCTION calculate_temporal_iou(
    start1_ms BIGINT, end1_ms BIGINT,
    start2_ms BIGINT, end2_ms BIGINT
) RETURNS DECIMAL(4,3) AS $$
DECLARE
    overlap_start BIGINT;
    overlap_end BIGINT;
    overlap_duration BIGINT;
    union_duration BIGINT;
    iou DECIMAL(4,3);
BEGIN
    -- Calculate overlap
    overlap_start := GREATEST(start1_ms, start2_ms);
    overlap_end := LEAST(end1_ms, end2_ms);
    overlap_duration := GREATEST(0, overlap_end - overlap_start);

    -- Calculate union
    union_duration := (end1_ms - start1_ms) + (end2_ms - start2_ms) - overlap_duration;

    -- Calculate IoU
    IF union_duration = 0 THEN
        RETURN 0;
    ELSE
        iou := overlap_duration::DECIMAL / union_duration::DECIMAL;
        RETURN LEAST(1.0, GREATEST(0.0, iou));
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to calculate frequency IoU between two events
CREATE OR REPLACE FUNCTION calculate_frequency_iou(
    fmin1_hz REAL, fmax1_hz REAL,
    fmin2_hz REAL, fmax2_hz REAL
) RETURNS DECIMAL(4,3) AS $$
DECLARE
    overlap_min REAL;
    overlap_max REAL;
    overlap_range REAL;
    union_range REAL;
    iou DECIMAL(4,3);
BEGIN
    -- Handle NULL values
    IF fmin1_hz IS NULL OR fmax1_hz IS NULL OR fmin2_hz IS NULL OR fmax2_hz IS NULL THEN
        RETURN 0;
    END IF;

    -- Calculate overlap
    overlap_min := GREATEST(fmin1_hz, fmin2_hz);
    overlap_max := LEAST(fmax1_hz, fmax2_hz);
    overlap_range := GREATEST(0, overlap_max - overlap_min);

    -- Calculate union
    union_range := (fmax1_hz - fmin1_hz) + (fmax2_hz - fmin2_hz) - overlap_range;

    -- Calculate IoU
    IF union_range = 0 THEN
        RETURN 0;
    ELSE
        iou := overlap_range::DECIMAL / union_range::DECIMAL;
        RETURN LEAST(1.0, GREATEST(0.0, iou));
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =====================================================
-- 5. CREATE DEDUPLICATION VIEW
-- =====================================================

-- View for non-duplicate events only
CREATE OR REPLACE VIEW aed_events_unique AS
SELECT * FROM aed_events 
WHERE duplicate_of IS NULL;

-- View for duplicate analysis
CREATE OR REPLACE VIEW aed_events_duplicates AS
SELECT 
    d.id as duplicate_id,
    d.segment_id as duplicate_segment_id,
    d.start_ms as duplicate_start_ms,
    d.end_ms as duplicate_end_ms,
    d.confidence as duplicate_confidence,
    o.id as original_id,
    o.segment_id as original_segment_id,
    o.start_ms as original_start_ms,
    o.end_ms as original_end_ms,
    o.confidence as original_confidence,
    d.temporal_iou,
    d.frequency_iou,
    d.dedup_confidence
FROM aed_events d
JOIN aed_events o ON d.duplicate_of = o.id;

-- =====================================================
-- 6. ADD COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN aed_events.duplicate_of IS 'References the ID of the original event if this is a duplicate';
COMMENT ON COLUMN aed_events.temporal_iou IS 'Temporal Intersection over Union with the original event (0-1)';
COMMENT ON COLUMN aed_events.frequency_iou IS 'Frequency Intersection over Union with the original event (0-1)';
COMMENT ON COLUMN aed_events.dedup_confidence IS 'Confidence score for the deduplication decision (0-1)';

COMMENT ON INDEX idx_aed_events_recording_time IS 'Index for cross-segment deduplication queries';
COMMENT ON INDEX idx_aed_events_dedup_lookup IS 'Composite index for efficient deduplication lookups';

COMMENT ON VIEW aed_events_unique IS 'View containing only non-duplicate events';
COMMENT ON VIEW aed_events_duplicates IS 'View for analyzing duplicate relationships';

-- =====================================================
-- 7. VERIFY SCHEMA CHANGES
-- =====================================================

-- Show updated table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'aed_events' 
ORDER BY ordinal_position;

-- Show new indexes
SELECT
    indexname,
    indexdef
FROM pg_indexes
WHERE tablename = 'aed_events'
AND (indexname LIKE '%dedup%' OR indexname LIKE '%recording_time%');

-- Success message
SELECT 'Cross-segment deduplication schema successfully added!' as status;
