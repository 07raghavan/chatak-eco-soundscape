-- Create events table for BirdNet AED
CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    recording_id BIGINT NOT NULL,
    species VARCHAR(255) NOT NULL,
    scientific_name VARCHAR(255) NOT NULL,
    confidence DECIMAL(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    start_ms INT NOT NULL CHECK (start_ms >= 0),
    end_ms INT NOT NULL CHECK (end_ms >= 0),
    duration_ms INT NOT NULL CHECK (duration_ms >= 0),
    snippet_file_path TEXT,
    snippet_file_size BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_events_recording_id ON events(recording_id);
CREATE INDEX IF NOT EXISTS idx_events_confidence ON events(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_events_updated_at 
    BEFORE UPDATE ON events 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE events IS 'BirdNet AED events - stores detected bird species with timing and audio snippets';
COMMENT ON COLUMN events.recording_id IS 'Reference to the recording this event belongs to';
COMMENT ON COLUMN events.species IS 'Common name of the detected bird species';
COMMENT ON COLUMN events.scientific_name IS 'Scientific name of the detected bird species';
COMMENT ON COLUMN events.confidence IS 'BirdNet confidence score (0.0 to 1.0)';
COMMENT ON COLUMN events.start_ms IS 'Start time of the detection in milliseconds';
COMMENT ON COLUMN events.end_ms IS 'End time of the detection in milliseconds';
COMMENT ON COLUMN events.duration_ms IS 'Duration of the detection in milliseconds';
COMMENT ON COLUMN events.snippet_file_path IS 'Path to the audio snippet file for this detection';
COMMENT ON COLUMN events.snippet_file_size IS 'Size of the audio snippet file in bytes';
