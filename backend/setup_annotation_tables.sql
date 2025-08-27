-- Annotation System Database Schema
-- This file sets up tables for both platform annotations and public volunteer annotations

-- Platform annotations (expert users within projects)
CREATE TABLE IF NOT EXISTS annotations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cluster_id INTEGER REFERENCES audio_clusters(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
  annotation_type VARCHAR(50) NOT NULL CHECK (annotation_type IN ('manual', 'suggestion_vote', 'region_box', 'representative_sample')),
  species_label VARCHAR(100),
  confidence_score DECIMAL(3,2) CHECK (confidence_score >= 0 AND confidence_score <= 1),
  background_tags TEXT[],
  notes TEXT,
  metadata JSONB, -- Store additional annotation data
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Clips submitted to public platform for volunteer annotation (must come before public_annotations)
CREATE TABLE IF NOT EXISTS clip_submissions (
  id SERIAL PRIMARY KEY,
  original_annotation_id INTEGER REFERENCES annotations(id) ON DELETE SET NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cluster_id INTEGER REFERENCES audio_clusters(id) ON DELETE CASCADE,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  submission_reason TEXT NOT NULL, -- Why this clip was sent to public
  difficulty_level VARCHAR(20) NOT NULL DEFAULT 'Medium' CHECK (difficulty_level IN ('Easy', 'Medium', 'Hard')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'archived')),
  volunteer_annotations_count INTEGER DEFAULT 0,
  consensus_reached BOOLEAN DEFAULT FALSE,
  consensus_species VARCHAR(100),
  consensus_confidence DECIMAL(3,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Public annotation platform (volunteer annotations)
CREATE TABLE IF NOT EXISTS public_annotations (
  id SERIAL PRIMARY KEY,
  volunteer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clip_submission_id INTEGER NOT NULL REFERENCES clip_submissions(id) ON DELETE CASCADE,
  basic_classification VARCHAR(50) NOT NULL CHECK (basic_classification IN ('Bird', 'Frog', 'Bat', 'Mammal', 'Car', 'Plane', 'Human', 'Insect', 'Water', 'Unknown')),
  detailed_species VARCHAR(100),
  confidence_level VARCHAR(20) NOT NULL CHECK (confidence_level IN ('Very Sure', 'Somewhat Sure', 'Not Sure')),
  background_noise TEXT[],
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Volunteer progress tracking and gamification
CREATE TABLE IF NOT EXISTS volunteer_progress (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  total_annotations INTEGER DEFAULT 0,
  accuracy_score DECIMAL(5,2) DEFAULT 0.00,
  level VARCHAR(20) DEFAULT 'Beginner' CHECK (level IN ('Beginner', 'Intermediate', 'Expert', 'Master')),
  experience_points INTEGER DEFAULT 0,
  badges TEXT[] DEFAULT '{}',
  streak_days INTEGER DEFAULT 0,
  last_annotation_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Annotation suggestions from BirdNet or other sources
CREATE TABLE IF NOT EXISTS annotation_suggestions (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  source VARCHAR(50) NOT NULL, -- 'birdnet', 'manual', 'ml_model'
  species_name VARCHAR(100) NOT NULL,
  scientific_name VARCHAR(100),
  confidence_score DECIMAL(3,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
  start_time_ms INTEGER,
  end_time_ms INTEGER,
  metadata JSONB, -- Store additional suggestion data
  created_at TIMESTAMP DEFAULT NOW()
);

-- Spectrogram metadata for on-demand generation
CREATE TABLE IF NOT EXISTS spectrograms (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  file_path VARCHAR(500) NOT NULL,
  s3_key VARCHAR(500),
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  zoom_levels INTEGER[] DEFAULT '{1,2,4,8}', -- Available zoom levels
  generated_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP -- For cleanup of temporary spectrograms
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_annotations_user_id ON annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_annotations_project_id ON annotations(project_id);
CREATE INDEX IF NOT EXISTS idx_annotations_cluster_id ON annotations(cluster_id);
CREATE INDEX IF NOT EXISTS idx_annotations_event_id ON annotations(event_id);
CREATE INDEX IF NOT EXISTS idx_annotations_annotation_type ON annotations(annotation_type);

CREATE INDEX IF NOT EXISTS idx_clip_submissions_project_id ON clip_submissions(project_id);
CREATE INDEX IF NOT EXISTS idx_clip_submissions_cluster_id ON clip_submissions(cluster_id);
CREATE INDEX IF NOT EXISTS idx_clip_submissions_status ON clip_submissions(status);
CREATE INDEX IF NOT EXISTS idx_clip_submissions_difficulty ON clip_submissions(difficulty_level);

CREATE INDEX IF NOT EXISTS idx_public_annotations_volunteer_id ON public_annotations(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_public_annotations_clip_submission_id ON public_annotations(clip_submission_id);
CREATE INDEX IF NOT EXISTS idx_public_annotations_basic_classification ON public_annotations(basic_classification);

CREATE INDEX IF NOT EXISTS idx_annotation_suggestions_event_id ON annotation_suggestions(event_id);
CREATE INDEX IF NOT EXISTS idx_annotation_suggestions_confidence ON annotation_suggestions(confidence_score);
CREATE INDEX IF NOT EXISTS idx_annotation_suggestions_source ON annotation_suggestions(source);

CREATE INDEX IF NOT EXISTS idx_spectrograms_event_id ON spectrograms(event_id);

-- Add comments for documentation
COMMENT ON TABLE annotations IS 'Platform annotations by expert users within projects';
COMMENT ON TABLE clip_submissions IS 'Clips submitted to public platform for volunteer annotation';
COMMENT ON TABLE public_annotations IS 'Volunteer annotations on public platform';
COMMENT ON TABLE volunteer_progress IS 'Volunteer progress tracking and gamification';
COMMENT ON TABLE annotation_suggestions IS 'Species suggestions from BirdNet or other sources';
COMMENT ON TABLE spectrograms IS 'Generated spectrograms for audio events';

-- Insert default background tags for consistency
INSERT INTO volunteer_progress (user_id, total_annotations, level) 
SELECT id, 0, 'Beginner' FROM users 
ON CONFLICT (user_id) DO NOTHING;
