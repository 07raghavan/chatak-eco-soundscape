-- Audio Clustering Database Schema
-- Tables for storing audio features, clusters, and UMAP embeddings

-- Audio features table
CREATE TABLE IF NOT EXISTS audio_features (
    id SERIAL PRIMARY KEY,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    feature_vector JSONB NOT NULL,  -- Store extracted audio features
    umap_x FLOAT,                   -- UMAP X coordinate for visualization
    umap_y FLOAT,                   -- UMAP Y coordinate for visualization
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Audio clusters table
CREATE TABLE IF NOT EXISTS audio_clusters (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,           -- e.g., "Cluster 1", "Cluster 2"
    cluster_label INTEGER NOT NULL,       -- HDBSCAN cluster ID
    feature_centroid JSONB NOT NULL,      -- Cluster center features
    snippet_count INTEGER DEFAULT 0,      -- Number of snippets in cluster
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Cluster assignments table
CREATE TABLE IF NOT EXISTS cluster_assignments (
    id SERIAL PRIMARY KEY,
    cluster_id INTEGER NOT NULL REFERENCES audio_clusters(id) ON DELETE CASCADE,
    event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    confidence FLOAT DEFAULT 1.0,        -- How confident we are in this assignment
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_audio_features_event_id ON audio_features(event_id);
CREATE INDEX IF NOT EXISTS idx_audio_features_umap_coords ON audio_features(umap_x, umap_y);
CREATE INDEX IF NOT EXISTS idx_audio_clusters_label ON audio_clusters(cluster_label);
CREATE INDEX IF NOT EXISTS idx_cluster_assignments_cluster_id ON cluster_assignments(cluster_id);
CREATE INDEX IF NOT EXISTS idx_cluster_assignments_event_id ON cluster_assignments(event_id);

-- Unique constraints
ALTER TABLE audio_features ADD CONSTRAINT unique_event_features UNIQUE (event_id);
ALTER TABLE cluster_assignments ADD CONSTRAINT unique_event_cluster UNIQUE (event_id);

-- Comments
COMMENT ON TABLE audio_features IS 'Stores extracted audio features and UMAP embeddings for clustering visualization';
COMMENT ON TABLE audio_clusters IS 'Stores cluster information from HDBSCAN clustering';
COMMENT ON TABLE cluster_assignments IS 'Maps events to their assigned clusters';

-- Update trigger for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_audio_features_updated_at 
    BEFORE UPDATE ON audio_features 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_audio_clusters_updated_at 
    BEFORE UPDATE ON audio_clusters 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_cluster_assignments_updated_at 
    BEFORE UPDATE ON cluster_assignments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
