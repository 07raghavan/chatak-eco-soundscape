-- Add spec_tiles table for individual tile tracking
-- Enhances the existing spec_pyramids system with proper tile indexing

-- =====================================================
-- 1. CREATE SPEC_TILES TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS spec_tiles (
  id BIGSERIAL PRIMARY KEY,
  index_id BIGINT NOT NULL REFERENCES spec_pyramids(id) ON DELETE CASCADE,
  zoom INT NOT NULL,
  tile_x BIGINT NOT NULL,
  tile_y INT NOT NULL,
  s3_key TEXT NOT NULL,
  
  -- Tile metadata
  width_px INT NOT NULL DEFAULT 1024,
  height_px INT NOT NULL DEFAULT 512,
  file_size_bytes BIGINT,
  format VARCHAR(10) NOT NULL DEFAULT 'webp',
  
  -- Time and frequency bounds for this tile
  start_time_ms BIGINT,
  end_time_ms BIGINT,
  min_freq_hz REAL,
  max_freq_hz REAL,
  
  -- Generation metadata
  generation_time_ms INT,
  compression_quality INT DEFAULT 85,
  
  -- Status tracking
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Ensure unique tiles per pyramid/zoom/position
  UNIQUE(index_id, zoom, tile_x, tile_y)
);

-- =====================================================
-- 2. ADD PERFORMANCE INDEXES
-- =====================================================

-- Primary lookup index for tile requests
CREATE INDEX IF NOT EXISTS idx_spec_tiles_lookup 
ON spec_tiles(index_id, zoom, tile_x, tile_y);

-- Index for spatial queries (time/frequency range)
CREATE INDEX IF NOT EXISTS idx_spec_tiles_spatial 
ON spec_tiles(index_id, zoom, start_time_ms, end_time_ms);

-- Index for frequency range queries
CREATE INDEX IF NOT EXISTS idx_spec_tiles_frequency 
ON spec_tiles(index_id, min_freq_hz, max_freq_hz);

-- Index for status queries
CREATE INDEX IF NOT EXISTS idx_spec_tiles_status 
ON spec_tiles(status) WHERE status != 'completed';

-- Index for S3 key lookups
CREATE INDEX IF NOT EXISTS idx_spec_tiles_s3_key 
ON spec_tiles(s3_key);

-- Composite index for viewport queries (most common)
CREATE INDEX IF NOT EXISTS idx_spec_tiles_viewport 
ON spec_tiles(index_id, zoom, tile_x, tile_y, status) 
WHERE status = 'completed';

-- =====================================================
-- 3. UPDATE SPEC_PYRAMIDS TABLE
-- =====================================================

-- Add enhanced metadata columns to spec_pyramids
ALTER TABLE spec_pyramids 
ADD COLUMN IF NOT EXISTS method_version TEXT NOT NULL DEFAULT 'v2.0',
ADD COLUMN IF NOT EXISTS sr INT,
ADD COLUMN IF NOT EXISTS hop INT, 
ADD COLUMN IF NOT EXISTS n_mels INT,
ADD COLUMN IF NOT EXISTS fmin REAL,
ADD COLUMN IF NOT EXISTS fmax REAL,
ADD COLUMN IF NOT EXISTS zoom_levels INT[],
ADD COLUMN IF NOT EXISTS px_per_sec REAL[],
ADD COLUMN IF NOT EXISTS tile_w INT NOT NULL DEFAULT 1024,
ADD COLUMN IF NOT EXISTS tile_h INT NOT NULL DEFAULT 512;

-- Update existing records with default values
UPDATE spec_pyramids 
SET 
  sr = 32000,
  hop = 10,
  n_mels = 128,
  fmin = 0,
  fmax = 16000,
  zoom_levels = ARRAY[0, 1, 2, 3, 4],
  px_per_sec = ARRAY[100.0, 50.0, 25.0, 12.5, 6.25]
WHERE sr IS NULL;

-- =====================================================
-- 4. CREATE HELPER FUNCTIONS
-- =====================================================

-- Function to calculate tile bounds
CREATE OR REPLACE FUNCTION calculate_tile_bounds(
  p_zoom INT,
  p_tile_x BIGINT,
  p_tile_y INT,
  p_tile_w INT,
  p_tile_h INT,
  p_px_per_sec REAL,
  p_total_duration_ms BIGINT,
  p_fmin REAL,
  p_fmax REAL
) RETURNS TABLE(
  start_time_ms BIGINT,
  end_time_ms BIGINT,
  min_freq_hz REAL,
  max_freq_hz REAL
) AS $$
DECLARE
  time_per_px_ms REAL;
  freq_per_px_hz REAL;
BEGIN
  -- Calculate time per pixel at this zoom level
  time_per_px_ms := 1000.0 / p_px_per_sec;
  
  -- Calculate frequency per pixel
  freq_per_px_hz := (p_fmax - p_fmin) / p_tile_h;
  
  -- Calculate tile bounds
  start_time_ms := FLOOR(p_tile_x * p_tile_w * time_per_px_ms);
  end_time_ms := LEAST(
    FLOOR((p_tile_x + 1) * p_tile_w * time_per_px_ms),
    p_total_duration_ms
  );
  
  -- Frequency bounds (Y=0 is highest frequency)
  max_freq_hz := p_fmax - (p_tile_y * p_tile_h * freq_per_px_hz);
  min_freq_hz := GREATEST(
    p_fmax - ((p_tile_y + 1) * p_tile_h * freq_per_px_hz),
    p_fmin
  );
  
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get tiles for viewport
CREATE OR REPLACE FUNCTION get_tiles_for_viewport(
  p_index_id BIGINT,
  p_zoom INT,
  p_start_time_ms BIGINT,
  p_end_time_ms BIGINT,
  p_min_freq_hz REAL DEFAULT NULL,
  p_max_freq_hz REAL DEFAULT NULL
) RETURNS TABLE(
  tile_id BIGINT,
  tile_x BIGINT,
  tile_y INT,
  s3_key TEXT,
  width_px INT,
  height_px INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    st.id,
    st.tile_x,
    st.tile_y,
    st.s3_key,
    st.width_px,
    st.height_px
  FROM spec_tiles st
  WHERE st.index_id = p_index_id
    AND st.zoom = p_zoom
    AND st.status = 'completed'
    AND st.end_time_ms >= p_start_time_ms
    AND st.start_time_ms <= p_end_time_ms
    AND (p_min_freq_hz IS NULL OR st.max_freq_hz >= p_min_freq_hz)
    AND (p_max_freq_hz IS NULL OR st.min_freq_hz <= p_max_freq_hz)
  ORDER BY st.tile_x, st.tile_y;
END;
$$ LANGUAGE plpgsql STABLE;

-- =====================================================
-- 5. CREATE VIEWS FOR EASY ACCESS
-- =====================================================

-- View for complete tile information
CREATE OR REPLACE VIEW spec_tiles_complete AS
SELECT 
  st.*,
  sp.recording_id,
  sp.sr,
  sp.hop,
  sp.n_mels,
  sp.fmin,
  sp.fmax,
  sp.px_per_sec[st.zoom + 1] as px_per_sec_current,
  sp.tiles_s3_prefix
FROM spec_tiles st
JOIN spec_pyramids sp ON st.index_id = sp.id
WHERE st.status = 'completed';

-- View for pyramid statistics
CREATE OR REPLACE VIEW spec_pyramid_stats AS
SELECT 
  sp.id as pyramid_id,
  sp.recording_id,
  sp.status as pyramid_status,
  COUNT(st.id) as total_tiles,
  COUNT(CASE WHEN st.status = 'completed' THEN 1 END) as completed_tiles,
  COUNT(CASE WHEN st.status = 'failed' THEN 1 END) as failed_tiles,
  COUNT(CASE WHEN st.status = 'pending' THEN 1 END) as pending_tiles,
  SUM(st.file_size_bytes) as total_size_bytes,
  AVG(st.generation_time_ms) as avg_generation_time_ms,
  MIN(st.created_at) as first_tile_created,
  MAX(st.updated_at) as last_tile_updated
FROM spec_pyramids sp
LEFT JOIN spec_tiles st ON sp.id = st.index_id
GROUP BY sp.id, sp.recording_id, sp.status;

-- =====================================================
-- 6. ADD COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE spec_tiles IS 'Individual spectrogram tiles for DeepZoom-like pyramid viewing';
COMMENT ON COLUMN spec_tiles.index_id IS 'References the spec_pyramids record this tile belongs to';
COMMENT ON COLUMN spec_tiles.zoom IS 'Zoom level (0=highest resolution, higher=more zoomed out)';
COMMENT ON COLUMN spec_tiles.tile_x IS 'Tile X coordinate (time axis)';
COMMENT ON COLUMN spec_tiles.tile_y IS 'Tile Y coordinate (frequency axis, 0=highest frequency)';
COMMENT ON COLUMN spec_tiles.s3_key IS 'S3 key for the tile image (WEBP format)';
COMMENT ON COLUMN spec_tiles.start_time_ms IS 'Start time in milliseconds that this tile covers';
COMMENT ON COLUMN spec_tiles.end_time_ms IS 'End time in milliseconds that this tile covers';
COMMENT ON COLUMN spec_tiles.min_freq_hz IS 'Minimum frequency in Hz that this tile covers';
COMMENT ON COLUMN spec_tiles.max_freq_hz IS 'Maximum frequency in Hz that this tile covers';

COMMENT ON FUNCTION get_tiles_for_viewport IS 'Get all tiles needed for a specific viewport (time/frequency range)';
COMMENT ON VIEW spec_tiles_complete IS 'Complete tile information with pyramid metadata joined';
COMMENT ON VIEW spec_pyramid_stats IS 'Statistics about tile generation progress for each pyramid';

-- =====================================================
-- 7. VERIFY SCHEMA CHANGES
-- =====================================================

-- Show table structure
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'spec_tiles' 
ORDER BY ordinal_position;

-- Show indexes
SELECT 
  indexname, 
  indexdef 
FROM pg_indexes 
WHERE tablename = 'spec_tiles';

-- Success message
SELECT 'spec_tiles table and enhancements successfully added!' as status;
