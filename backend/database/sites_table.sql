-- Sites Table (PostgreSQL)
CREATE TABLE IF NOT EXISTS sites (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    description TEXT,
    project_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sites_project_id ON sites(project_id);
CREATE INDEX IF NOT EXISTS idx_sites_location ON sites(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_sites_created_at ON sites(created_at);

-- Add unique constraint to prevent duplicate site names within the same project
CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_project_name ON sites(project_id, name); 