-- Segments Table (PostgreSQL)
-- Stores derived audio segments and QC metrics

CREATE TABLE IF NOT EXISTS segments (
  id SERIAL PRIMARY KEY,
  recording_id INT NOT NULL,
  s3_key VARCHAR(500) NOT NULL,
  start_ms BIGINT NOT NULL,
  end_ms BIGINT NOT NULL,
  duration_ms BIGINT NOT NULL,
  sample_rate INTEGER,
  channels INTEGER,
  -- QC metrics
  silence_pct REAL,
  clipping_pct REAL,
  rms_db REAL,
  band_energy_low REAL,   -- e.g., 0.5–2 kHz
  band_energy_mid REAL,   -- e.g., 2–8 kHz
  band_energy_high REAL,  -- optional high band
  crest_factor REAL,
  qc_status VARCHAR(32) DEFAULT 'unknown', -- pass, fail, review, unknown
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_segments_recording FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_segments_recording_id ON segments(recording_id);
CREATE INDEX IF NOT EXISTS idx_segments_s3_key ON segments(s3_key);
CREATE INDEX IF NOT EXISTS idx_segments_qc_status ON segments(qc_status);

