-- Job orchestration tables for segmentation and AED

-- Enable pgcrypto extension for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS job_queue (
  id SERIAL PRIMARY KEY,
  job_id UUID DEFAULT gen_random_uuid(),
  type VARCHAR(64) NOT NULL, -- segmentation, aed
  status VARCHAR(32) NOT NULL DEFAULT 'queued', -- queued, running, succeeded, failed, canceled
  priority INTEGER DEFAULT 5,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  payload JSONB NOT NULL, -- includes recording_id, params, etc.
  error TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_type ON job_queue(status, type);
CREATE INDEX IF NOT EXISTS idx_job_queue_run_at ON job_queue(run_at);

-- AED results and ROIs (lightweight placeholder for next phase)
CREATE TABLE IF NOT EXISTS aed_results (
  id SERIAL PRIMARY KEY,
  segment_id INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  num_events INTEGER DEFAULT 0,
  details JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_aed_segment FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS rois (
  id SERIAL PRIMARY KEY,
  segment_id INT NOT NULL,
  start_ms BIGINT NOT NULL,
  end_ms BIGINT NOT NULL,
  peak_db REAL,
  min_freq_hz REAL,
  max_freq_hz REAL,
  confidence REAL,
  s3_key VARCHAR(500), -- optional ROI snippet path
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rois_segment FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rois_segment_id ON rois(segment_id);

