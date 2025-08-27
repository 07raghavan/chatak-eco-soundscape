-- Annotations Table Setup
-- This table stores all annotation data from both volunteer and platform users

CREATE TABLE IF NOT EXISTS annotations (
    id BIGSERIAL PRIMARY KEY,
    cluster_id BIGINT NOT NULL,
    annotator_id VARCHAR(255) NOT NULL,
    species_label VARCHAR(255),
    sound_type VARCHAR(100),
    confidence DECIMAL(3,2) DEFAULT 0.5,
    notes TEXT,
    background_tags JSONB,
    suggestion_matches JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add annotation_status column to clusters table if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'clusters' AND column_name = 'annotation_status'
    ) THEN
        ALTER TABLE clusters ADD COLUMN annotation_status VARCHAR(50) DEFAULT 'pending';
    END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_annotations_cluster_id ON annotations(cluster_id);
CREATE INDEX IF NOT EXISTS idx_annotations_annotator_id ON annotations(annotator_id);
CREATE INDEX IF NOT EXISTS idx_annotations_created_at ON annotations(created_at);
CREATE INDEX IF NOT EXISTS idx_clusters_annotation_status ON clusters(annotation_status);

-- Add foreign key constraint
ALTER TABLE annotations 
ADD CONSTRAINT fk_annotations_cluster_id 
FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE;

-- Create annotation statistics view
CREATE OR REPLACE VIEW annotation_stats AS
SELECT 
    c.id as cluster_id,
    c.label as cluster_label,
    c.annotation_status,
    COUNT(a.id) as annotation_count,
    MAX(a.created_at) as last_annotated,
    STRING_AGG(DISTINCT a.species_label, ', ') as species_labels,
    AVG(a.confidence) as avg_confidence
FROM clusters c
LEFT JOIN annotations a ON c.id = a.cluster_id
GROUP BY c.id, c.label, c.annotation_status;

-- Insert sample annotation data (optional)
INSERT INTO annotations (cluster_id, annotator_id, species_label, sound_type, confidence, notes, background_tags) 
VALUES 
    (1, 'volunteer_001', 'Bird', 'Song', 0.8, 'Clear bird song, possibly robin', '["Wind", "Traffic"]'),
    (1, 'platform_user_001', 'American Robin', 'Song', 0.9, 'Confirmed American Robin song', '["Wind"]')
ON CONFLICT DO NOTHING;

-- Update sample cluster status
UPDATE clusters SET annotation_status = 'annotated' WHERE id = 1;

-- Grant permissions (adjust as needed for your setup)
-- GRANT SELECT, INSERT, UPDATE ON annotations TO your_app_user;
-- GRANT SELECT ON annotation_stats TO your_app_user;


