-- AED tables for simple band-adaptive detector

-- aed_events: stores detected acoustic events per approved segment
CREATE TABLE IF NOT EXISTS aed_events (
  id SERIAL PRIMARY KEY,
  recording_id INT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  segment_id INT NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  start_ms BIGINT NOT NULL,
  end_ms BIGINT NOT NULL,
  f_min_hz REAL,
  f_max_hz REAL,
  peak_freq_hz REAL,
  snr_db REAL,
  confidence REAL,
  method VARCHAR(64) NOT NULL DEFAULT 'band-adapt-v1',
  method_version VARCHAR(16) NOT NULL DEFAULT '1.0',
  snippet_s3_key VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_aed_events_recording_id ON aed_events(recording_id);
CREATE INDEX IF NOT EXISTS idx_aed_events_segment_id ON aed_events(segment_id);
CREATE INDEX IF NOT EXISTS idx_aed_events_time ON aed_events(recording_id, start_ms);

-- Optional manual tagging table
CREATE TABLE IF NOT EXISTS aed_event_tags (
  id SERIAL PRIMARY KEY,
  event_id INT NOT NULL REFERENCES aed_events(id) ON DELETE CASCADE,
  label VARCHAR(64),
  species VARCHAR(128),
  verdict VARCHAR(32),
  notes TEXT,
  reviewer_id INT REFERENCES users(id) ON DELETE SET NULL,
  confidence_override REAL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_aed_event_tags_event_id ON aed_event_tags(event_id);


