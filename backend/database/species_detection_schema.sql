-- Species Detection and Annotation System Schema
-- This system integrates with BirdNET, Perch, and other species detection models
-- while providing comprehensive annotation capabilities

-- =====================================================
-- 1. SPECIES DETECTION MODELS
-- =====================================================

CREATE TABLE IF NOT EXISTS species_models (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE, -- e.g., 'birdnet_v2.4', 'perch_v1.0'
    model_type VARCHAR(50) NOT NULL, -- 'birdnet', 'perch', 'custom'
    version VARCHAR(20) NOT NULL,
    description TEXT,
    model_path VARCHAR(500), -- Path to model file
    config_json JSONB, -- Model configuration parameters
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 2. SPECIES DETECTION JOBS
-- =====================================================

CREATE TABLE IF NOT EXISTS species_detection_jobs (
    id SERIAL PRIMARY KEY,
    job_id UUID DEFAULT gen_random_uuid(),
    recording_id BIGINT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    model_id INTEGER NOT NULL REFERENCES species_models(id),
    status VARCHAR(32) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'canceled')),
    priority INTEGER DEFAULT 5,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    
    -- Job parameters
    config_json JSONB NOT NULL, -- Detection parameters (confidence threshold, time steps, etc.)
    
    -- Results summary
    total_detections INTEGER DEFAULT 0,
    high_confidence_count INTEGER DEFAULT 0,
    low_confidence_count INTEGER DEFAULT 0,
    
    -- Processing metadata
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    processing_time_ms BIGINT,
    error_message TEXT,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 3. SPECIES DETECTIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS species_detections (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES species_detection_jobs(id) ON DELETE CASCADE,
    recording_id BIGINT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    
    -- Detection details
    species_name VARCHAR(200) NOT NULL, -- Scientific or common name
    common_name VARCHAR(200), -- Common name if different from species_name
    confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    
    -- Temporal information
    start_time_seconds REAL NOT NULL, -- Start time in recording
    end_time_seconds REAL NOT NULL, -- End time in recording
    duration_seconds REAL NOT NULL,
    
    -- Frequency information
    min_frequency_hz REAL,
    max_frequency_hz REAL,
    peak_frequency_hz REAL,
    
    -- Model metadata
    model_id INTEGER NOT NULL REFERENCES species_models(id),
    model_version VARCHAR(20),
    
    -- Quality flags
    is_high_confidence BOOLEAN DEFAULT FALSE, -- Based on confidence threshold
    needs_review BOOLEAN DEFAULT FALSE, -- Flagged for manual review
    review_priority INTEGER DEFAULT 0, -- Priority for review (higher = more urgent)
    
    -- Annotation status
    annotation_status VARCHAR(32) DEFAULT 'pending' CHECK (annotation_status IN ('pending', 'confirmed', 'rejected', 'modified')),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 4. SPECIES ANNOTATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS species_annotations (
    id SERIAL PRIMARY KEY,
    detection_id INTEGER NOT NULL REFERENCES species_detections(id) ON DELETE CASCADE,
    recording_id BIGINT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    annotator_id INTEGER NOT NULL REFERENCES users(id),
    
    -- Annotation decision
    verdict VARCHAR(32) NOT NULL CHECK (verdict IN ('confirmed', 'rejected', 'modified', 'uncertain')),
    
    -- Modified species information (if verdict is 'modified')
    corrected_species_name VARCHAR(200),
    corrected_common_name VARCHAR(200),
    corrected_confidence_score REAL,
    
    -- Annotation metadata
    notes TEXT,
    tags JSONB, -- Additional tags or metadata
    
    -- Quality metrics
    annotation_confidence INTEGER CHECK (annotation_confidence >= 1 AND annotation_confidence <= 5), -- 1-5 scale
    review_time_seconds INTEGER, -- Time taken to annotate
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 5. SPECIES TAXONOMY
-- =====================================================

CREATE TABLE IF NOT EXISTS species_taxonomy (
    id SERIAL PRIMARY KEY,
    species_name VARCHAR(200) NOT NULL UNIQUE,
    common_name VARCHAR(200),
    scientific_name VARCHAR(200),
    family VARCHAR(100),
    order_name VARCHAR(100), -- 'order' is reserved in PostgreSQL
    class_name VARCHAR(100),
    phylum VARCHAR(100),
    kingdom VARCHAR(100),
    
    -- Conservation status
    iucn_status VARCHAR(10), -- CR, EN, VU, NT, LC, etc.
    population_trend VARCHAR(20), -- increasing, decreasing, stable, unknown
    
    -- Geographic information
    native_regions TEXT[], -- Array of regions where species is native
    habitat_types TEXT[], -- Array of habitat types
    
    -- Audio characteristics
    typical_frequency_range_hz REAL[], -- [min, max] in Hz
    typical_call_duration_ms REAL, -- Typical call duration in milliseconds
    
    -- Metadata
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 6. ANNOTATION CAMPAIGNS
-- =====================================================

CREATE TABLE IF NOT EXISTS annotation_campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    
    -- Campaign settings
    target_species TEXT[], -- Array of target species names
    confidence_threshold REAL DEFAULT 0.7, -- Minimum confidence for auto-approval
    review_threshold REAL DEFAULT 0.5, -- Below this threshold, always review
    
    -- Assignment settings
    assign_to_users INTEGER[], -- Array of user IDs
    auto_assign BOOLEAN DEFAULT TRUE,
    
    -- Progress tracking
    total_detections INTEGER DEFAULT 0,
    annotated_count INTEGER DEFAULT 0,
    confirmed_count INTEGER DEFAULT 0,
    rejected_count INTEGER DEFAULT 0,
    
    -- Status
    status VARCHAR(32) DEFAULT 'active' CHECK (status IN ('draft', 'active', 'paused', 'completed')),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 7. ANNOTATION ASSIGNMENTS
-- =====================================================

CREATE TABLE IF NOT EXISTS annotation_assignments (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER NOT NULL REFERENCES annotation_campaigns(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    detection_id INTEGER NOT NULL REFERENCES species_detections(id) ON DELETE CASCADE,
    
    -- Assignment status
    status VARCHAR(32) DEFAULT 'assigned' CHECK (status IN ('assigned', 'in_progress', 'completed', 'skipped')),
    
    -- Assignment metadata
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    -- Priority
    priority INTEGER DEFAULT 0, -- Higher = more urgent
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- 8. INDEXES FOR PERFORMANCE
-- =====================================================

-- Species detection jobs
CREATE INDEX IF NOT EXISTS idx_species_detection_jobs_recording_id ON species_detection_jobs(recording_id);
CREATE INDEX IF NOT EXISTS idx_species_detection_jobs_status ON species_detection_jobs(status);
CREATE INDEX IF NOT EXISTS idx_species_detection_jobs_model_id ON species_detection_jobs(model_id);

-- Species detections
CREATE INDEX IF NOT EXISTS idx_species_detections_job_id ON species_detections(job_id);
CREATE INDEX IF NOT EXISTS idx_species_detections_recording_id ON species_detections(recording_id);
CREATE INDEX IF NOT EXISTS idx_species_detections_species_name ON species_detections(species_name);
CREATE INDEX IF NOT EXISTS idx_species_detections_confidence_score ON species_detections(confidence_score);
CREATE INDEX IF NOT EXISTS idx_species_detections_needs_review ON species_detections(needs_review);
CREATE INDEX IF NOT EXISTS idx_species_detections_time_range ON species_detections(recording_id, start_time_seconds, end_time_seconds);

-- Species annotations
CREATE INDEX IF NOT EXISTS idx_species_annotations_detection_id ON species_annotations(detection_id);
CREATE INDEX IF NOT EXISTS idx_species_annotations_recording_id ON species_annotations(recording_id);
CREATE INDEX IF NOT EXISTS idx_species_annotations_annotator_id ON species_annotations(annotator_id);
CREATE INDEX IF NOT EXISTS idx_species_annotations_verdict ON species_annotations(verdict);

-- Species taxonomy
CREATE INDEX IF NOT EXISTS idx_species_taxonomy_species_name ON species_taxonomy(species_name);
CREATE INDEX IF NOT EXISTS idx_species_taxonomy_family ON species_taxonomy(family);
CREATE INDEX IF NOT EXISTS idx_species_taxonomy_order ON species_taxonomy(order_name);

-- Annotation campaigns
CREATE INDEX IF NOT EXISTS idx_annotation_campaigns_project_id ON annotation_campaigns(project_id);
CREATE INDEX IF NOT EXISTS idx_annotation_campaigns_status ON annotation_campaigns(status);

-- Annotation assignments
CREATE INDEX IF NOT EXISTS idx_annotation_assignments_campaign_id ON annotation_assignments(campaign_id);
CREATE INDEX IF NOT EXISTS idx_annotation_assignments_user_id ON annotation_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_annotation_assignments_status ON annotation_assignments(status);

-- =====================================================
-- 9. CONSTRAINTS AND TRIGGERS
-- =====================================================

-- Ensure end_time > start_time
ALTER TABLE species_detections ADD CONSTRAINT check_time_order CHECK (end_time_seconds > start_time_seconds);

-- Ensure duration matches time range
ALTER TABLE species_detections ADD CONSTRAINT check_duration_consistency CHECK (duration_seconds = (end_time_seconds - start_time_seconds));

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply triggers to all tables with updated_at
CREATE TRIGGER update_species_models_updated_at BEFORE UPDATE ON species_models FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_species_detection_jobs_updated_at BEFORE UPDATE ON species_detection_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_species_detections_updated_at BEFORE UPDATE ON species_detections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_species_annotations_updated_at BEFORE UPDATE ON species_annotations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_species_taxonomy_updated_at BEFORE UPDATE ON species_taxonomy FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_annotation_campaigns_updated_at BEFORE UPDATE ON annotation_campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_annotation_assignments_updated_at BEFORE UPDATE ON annotation_assignments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 10. INITIAL DATA
-- =====================================================

-- Insert default species detection models
INSERT INTO species_models (name, model_type, version, description, is_active) VALUES
('birdnet_v2.4', 'birdnet', '2.4', 'BirdNET v2.4 - Global bird species detection model', true),
('perch_v1.0', 'perch', '1.0', 'Perch v1.0 - Cornell Lab of Ornithology species detection model', true),
('custom_bioacoustics', 'custom', '1.0', 'Custom bioacoustics model for specialized species detection', true)
ON CONFLICT (name) DO NOTHING;

-- Insert some common bird species taxonomy
INSERT INTO species_taxonomy (species_name, common_name, scientific_name, family, order_name, class_name) VALUES
('American Robin', 'American Robin', 'Turdus migratorius', 'Turdidae', 'Passeriformes', 'Aves'),
('Northern Cardinal', 'Northern Cardinal', 'Cardinalis cardinalis', 'Cardinalidae', 'Passeriformes', 'Aves'),
('Blue Jay', 'Blue Jay', 'Cyanocitta cristata', 'Corvidae', 'Passeriformes', 'Aves'),
('American Crow', 'American Crow', 'Corvus brachyrhynchos', 'Corvidae', 'Passeriformes', 'Aves'),
('Red-winged Blackbird', 'Red-winged Blackbird', 'Agelaius phoeniceus', 'Icteridae', 'Passeriformes', 'Aves')
ON CONFLICT (species_name) DO NOTHING;

-- =====================================================
-- 11. VIEWS FOR COMMON QUERIES
-- =====================================================

-- View for species detection summary per recording
CREATE OR REPLACE VIEW species_detection_summary AS
SELECT 
    r.id as recording_id,
    r.name as recording_name,
    r.duration_seconds,
    COUNT(sd.id) as total_detections,
    COUNT(CASE WHEN sd.confidence_score >= 0.8 THEN 1 END) as high_confidence_detections,
    COUNT(CASE WHEN sd.confidence_score < 0.8 AND sd.confidence_score >= 0.5 THEN 1 END) as medium_confidence_detections,
    COUNT(CASE WHEN sd.confidence_score < 0.5 THEN 1 END) as low_confidence_detections,
    COUNT(CASE WHEN sd.needs_review THEN 1 END) as detections_needing_review,
    COUNT(DISTINCT sd.species_name) as unique_species_detected,
    MAX(sd.created_at) as last_detection_time
FROM recordings r
LEFT JOIN species_detections sd ON r.id = sd.recording_id
GROUP BY r.id, r.name, r.duration_seconds;

-- View for annotation progress per campaign
CREATE OR REPLACE VIEW annotation_campaign_progress AS
SELECT 
    ac.id as campaign_id,
    ac.name as campaign_name,
    ac.total_detections,
    COUNT(sa.id) as annotated_count,
    COUNT(CASE WHEN sa.verdict = 'confirmed' THEN 1 END) as confirmed_count,
    COUNT(CASE WHEN sa.verdict = 'rejected' THEN 1 END) as rejected_count,
    COUNT(CASE WHEN sa.verdict = 'modified' THEN 1 END) as modified_count,
    ROUND((COUNT(sa.id) * 100.0 / NULLIF(ac.total_detections, 0)), 2) as completion_percentage
FROM annotation_campaigns ac
LEFT JOIN species_detections sd ON sd.needs_review = true
LEFT JOIN species_annotations sa ON sd.id = sa.detection_id
GROUP BY ac.id, ac.name, ac.total_detections;

COMMENT ON TABLE species_models IS 'Species detection models (BirdNET, Perch, etc.)';
COMMENT ON TABLE species_detection_jobs IS 'Jobs for running species detection on recordings';
COMMENT ON TABLE species_detections IS 'Individual species detections from AI models';
COMMENT ON TABLE species_annotations IS 'Manual annotations and corrections of AI detections';
COMMENT ON TABLE species_taxonomy IS 'Taxonomic information for species';
COMMENT ON TABLE annotation_campaigns IS 'Campaigns for organizing annotation work';
COMMENT ON TABLE annotation_assignments IS 'Assignments of detections to annotators';
