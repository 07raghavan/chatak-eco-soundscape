-- Spectrogram Pyramids Table
-- Stores metadata for multi-resolution spectrogram tiling system AND fast single-image spectrograms
-- Now supports both recording-level and segment-level spectrograms

CREATE TABLE IF NOT EXISTS spec_pyramids (
    id SERIAL PRIMARY KEY,
    recording_id INT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    segment_id INT REFERENCES segments(id) ON DELETE CASCADE,
    
    -- Pyramid metadata (for tiled spectrograms)
    zoom_levels_json JSONB, -- Array of zoom level configs (nullable for single-image spectrograms)
    tile_params_json JSONB, -- Tiling parameters (sr, n_fft, hop_ms, etc.)
    tiles_s3_prefix VARCHAR(500), -- S3 prefix for tiles (nullable for single-image spectrograms)
    
    -- Fast spectrogram metadata (new for single-image spectrograms)
    spectrogram_type VARCHAR(32) NOT NULL DEFAULT 'tiled' CHECK (spectrogram_type IN ('tiled', 'fast_single')),
    image_s3_key VARCHAR(500), -- S3 key for single spectrogram image
    image_local_path VARCHAR(1000), -- Local path for spectrogram image
    aed_events_count INT NOT NULL DEFAULT 0, -- Number of AED events overlaid
    generation_config_json JSONB, -- Configuration used for generation
    
    -- Generation status
    status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    total_tiles INT NOT NULL DEFAULT 0,
    generated_tiles INT NOT NULL DEFAULT 0,
    
    -- Performance metrics
    generation_time_ms BIGINT, -- Time taken to generate (milliseconds)
    file_size_bytes BIGINT, -- Size of generated spectrogram file
    
    -- Error tracking
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spec_pyramids_recording_id ON spec_pyramids(recording_id);
CREATE INDEX IF NOT EXISTS idx_spec_pyramids_segment_id ON spec_pyramids(segment_id);
CREATE INDEX IF NOT EXISTS idx_spec_pyramids_status ON spec_pyramids(status);

-- Ensure either recording_id for full recording spectrograms or segment_id for segment spectrograms
ALTER TABLE spec_pyramids ADD CONSTRAINT chk_recording_or_segment 
  CHECK ((segment_id IS NULL) OR (segment_id IS NOT NULL));

-- Create unique constraint for recording spectrograms (when segment_id IS NULL)
-- This replaces the original UNIQUE constraint on recording_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_spec_pyramids_recording_unique 
  ON spec_pyramids(recording_id, spectrogram_type) 
  WHERE segment_id IS NULL;

-- Create unique constraint for segment spectrograms
CREATE UNIQUE INDEX IF NOT EXISTS idx_spec_pyramids_segment_unique 
  ON spec_pyramids(segment_id, spectrogram_type) 
  WHERE segment_id IS NOT NULL;

-- Trigger to maintain updated_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_spec_pyramids_updated_at'
  ) THEN
    CREATE TRIGGER trg_spec_pyramids_updated_at BEFORE UPDATE ON spec_pyramids
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
