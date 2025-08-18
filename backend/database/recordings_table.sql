-- Recordings Table (PostgreSQL)
CREATE TABLE IF NOT EXISTS recordings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT NOT NULL,
    duration_seconds INTEGER,
    recording_date TIMESTAMP,
    site_id INT NOT NULL,
    project_id INT NOT NULL,
    status VARCHAR(50) DEFAULT 'uploading', -- uploading, processing, completed, failed
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_recordings_project_id ON recordings(project_id);
CREATE INDEX IF NOT EXISTS idx_recordings_site_id ON recordings(site_id);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at);
CREATE INDEX IF NOT EXISTS idx_recordings_recording_date ON recordings(recording_date);

-- Add unique constraint to prevent duplicate file paths
CREATE UNIQUE INDEX IF NOT EXISTS idx_recordings_file_path ON recordings(file_path);

-- Add constraint to ensure file_size is positive
ALTER TABLE recordings ADD CONSTRAINT check_file_size_positive CHECK (file_size > 0);

-- Add constraint to ensure duration is positive
ALTER TABLE recordings ADD CONSTRAINT check_duration_positive CHECK (duration_seconds > 0); 