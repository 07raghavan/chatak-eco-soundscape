-- =====================================================
-- AED ROI CLUSTERING & LABEL PROPAGATION SCHEMA
-- =====================================================
-- This schema supports advanced clustering, feature extraction,
-- and LEAVES-style label propagation for audio event detection

-- =====================================================
-- EMBEDDING VERSIONS & FEATURE STORAGE
-- =====================================================

-- Track different embedding models and their configurations
CREATE TABLE IF NOT EXISTS embedding_versions (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,                    -- 'panns_cnn14', 'yamnet', 'openl3'
  model_version TEXT NOT NULL,                 -- 'v1.0', 'v2.1'
  pooling TEXT DEFAULT 'mean',                 -- 'mean', 'max', 'attention'
  dim INTEGER NOT NULL,                        -- embedding dimension
  pca_components INTEGER DEFAULT 50,           -- PCA target dimensions
  pca_s3_key TEXT,                            -- S3 path to pca.pkl
  faiss_s3_prefix TEXT,                       -- S3 prefix for FAISS indices
  umap_s3_key TEXT,                           -- S3 path to UMAP coordinates
  stats_json JSONB,                           -- model performance stats
  config_json JSONB,                          -- full model configuration
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(project_id, model_name, model_version)
);

-- Store ROI feature metadata and S3 pointers
CREATE TABLE IF NOT EXISTS roi_features (
  roi_id BIGINT PRIMARY KEY,                  -- FK to aed_events.id
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  embedding_version_id BIGINT REFERENCES embedding_versions(id) ON DELETE CASCADE,
  feature_type TEXT NOT NULL,                 -- 'dsp', 'panns', 'yamnet'
  s3_key TEXT NOT NULL,                       -- Parquet shard containing this ROI
  shard_index INTEGER,                        -- Index within the shard
  dim INTEGER NOT NULL,                       -- Feature vector dimension
  norm_version TEXT DEFAULT 'v1',             -- Normalization version
  quality_score FLOAT,                        -- Feature quality metric
  extraction_time_ms INTEGER,                 -- Processing time
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  INDEX idx_roi_features_project (project_id),
  INDEX idx_roi_features_embedding (embedding_version_id),
  INDEX idx_roi_features_type (feature_type)
);

-- =====================================================
-- CLUSTERING SYSTEM
-- =====================================================

-- Track clustering runs and their parameters
CREATE TABLE IF NOT EXISTS clusters (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,                       -- Unique run identifier
  algo TEXT NOT NULL,                         -- 'hdbscan', 'kmeans', 'auto'
  params_json JSONB NOT NULL,                 -- Algorithm parameters
  embedding_version_id BIGINT NOT NULL REFERENCES embedding_versions(id),
  version INTEGER DEFAULT 1,                  -- Clustering version
  num_clusters INTEGER,                       -- Total clusters found
  num_noise INTEGER DEFAULT 0,                -- Noise points (HDBSCAN)
  silhouette_score FLOAT,                     -- Clustering quality metric
  calinski_harabasz_score FLOAT,             -- Clustering quality metric
  davies_bouldin_score FLOAT,                 -- Clustering quality metric
  stability_score FLOAT,                      -- Cross-validation stability
  is_active BOOLEAN DEFAULT FALSE,            -- Currently active clustering
  s3_prefix TEXT,                             -- S3 path to cluster artifacts
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(project_id, run_id),
  INDEX idx_clusters_project (project_id),
  INDEX idx_clusters_active (project_id, is_active) WHERE is_active = TRUE
);

-- Store individual ROI cluster assignments
CREATE TABLE IF NOT EXISTS cluster_memberships (
  cluster_id BIGINT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  roi_id BIGINT NOT NULL,                     -- aed_events.id
  cluster_label INTEGER NOT NULL,             -- Cluster ID (-1 for noise)
  membership_proba FLOAT DEFAULT 1.0,         -- Membership probability
  distance_to_centroid FLOAT,                 -- Distance to cluster center
  is_core_point BOOLEAN DEFAULT FALSE,        -- Core point in HDBSCAN
  outlier_score FLOAT,                        -- Outlier detection score
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  PRIMARY KEY(cluster_id, roi_id),
  INDEX idx_memberships_cluster (cluster_id, cluster_label),
  INDEX idx_memberships_roi (roi_id)
);

-- Store cluster exemplars (medoids, representatives)
CREATE TABLE IF NOT EXISTS cluster_exemplars (
  id BIGSERIAL PRIMARY KEY,
  cluster_id BIGINT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  cluster_label INTEGER NOT NULL,             -- Which cluster within the run
  roi_id BIGINT NOT NULL,                     -- Representative ROI
  exemplar_type TEXT NOT NULL,                -- 'medoid', 'centroid', 'random'
  rank INTEGER DEFAULT 1,                     -- Ranking within cluster
  representativeness_score FLOAT,             -- How well it represents cluster
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  INDEX idx_exemplars_cluster (cluster_id, cluster_label),
  INDEX idx_exemplars_type (exemplar_type)
);

-- =====================================================
-- CLUSTER QUALITY & TIERS
-- =====================================================

-- Store per-cluster quality metrics and tier assignments
CREATE TABLE IF NOT EXISTS cluster_quality (
  id BIGSERIAL PRIMARY KEY,
  cluster_id BIGINT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  cluster_label INTEGER NOT NULL,
  size INTEGER NOT NULL,                      -- Number of ROIs in cluster
  cohesion_score FLOAT,                       -- Intra-cluster similarity
  separation_score FLOAT,                     -- Inter-cluster separation
  density_score FLOAT,                        -- Cluster density
  consensus_score FLOAT,                      -- Member agreement
  combined_score FLOAT,                       -- Weighted combination
  quality_tier TEXT NOT NULL,                 -- 'high', 'medium', 'low'
  auto_propagate_eligible BOOLEAN DEFAULT FALSE, -- Can auto-propagate labels
  manual_review_priority INTEGER DEFAULT 5,   -- Review priority (1-10)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(cluster_id, cluster_label),
  INDEX idx_quality_tier (quality_tier),
  INDEX idx_quality_score (combined_score DESC)
);

-- =====================================================
-- LABEL PROPAGATION SYSTEM
-- =====================================================

-- Track label propagation runs and their parameters
CREATE TABLE IF NOT EXISTS propagation_runs (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cluster_id BIGINT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,                       -- Unique propagation run ID
  algorithm TEXT DEFAULT 'label_spreading',   -- 'label_spreading', 'label_propagation'
  params_json JSONB NOT NULL,                 -- Algorithm parameters
  num_seeds INTEGER,                          -- Number of seed labels
  num_propagated INTEGER,                     -- Labels propagated
  num_auto_applied INTEGER,                   -- Auto-applied with high confidence
  accuracy_on_holdout FLOAT,                  -- Validation accuracy
  precision_macro FLOAT,                      -- Macro-averaged precision
  recall_macro FLOAT,                         -- Macro-averaged recall
  f1_macro FLOAT,                             -- Macro-averaged F1
  trust_threshold FLOAT DEFAULT 0.6,          -- Trust threshold for auto-apply
  confidence_threshold FLOAT DEFAULT 0.85,    -- Confidence threshold
  metrics_json JSONB,                         -- Detailed metrics
  s3_artifacts_prefix TEXT,                   -- S3 path to propagation artifacts
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(project_id, run_id),
  INDEX idx_propagation_cluster (cluster_id),
  INDEX idx_propagation_project (project_id)
);

-- Store ROI labels from human annotation and propagation
CREATE TABLE IF NOT EXISTS roi_labels (
  roi_id BIGINT NOT NULL,                     -- aed_events.id
  class_id INTEGER NOT NULL,                  -- Label class ID
  class_name TEXT,                            -- Human-readable class name
  confidence FLOAT NOT NULL DEFAULT 1.0,     -- Label confidence
  source TEXT NOT NULL,                       -- 'human', 'propagated', 'model'
  propagation_run_id BIGINT REFERENCES propagation_runs(id) ON DELETE SET NULL,
  annotator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  trust_score FLOAT,                          -- Trust score for propagated labels
  local_density FLOAT,                        -- Local neighborhood density
  margin_score FLOAT,                         -- Confidence margin
  is_auto_applied BOOLEAN DEFAULT FALSE,      -- Was automatically applied
  is_validated BOOLEAN DEFAULT FALSE,         -- Human validated
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY(roi_id, class_id),
  INDEX idx_labels_class (class_id),
  INDEX idx_labels_source (source),
  INDEX idx_labels_confidence (confidence DESC),
  INDEX idx_labels_propagation (propagation_run_id)
);

-- =====================================================
-- MULTI-LABEL TAXONOMY (BUSHY TREE)
-- =====================================================

-- Define hierarchical label taxonomy with multi-parent support
CREATE TABLE IF NOT EXISTS label_classes (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                         -- Class name (e.g., 'bird_song')
  display_name TEXT,                          -- Human-friendly name
  description TEXT,                           -- Class description
  color_hex TEXT DEFAULT '#3B82F6',           -- UI color
  is_compound BOOLEAN DEFAULT FALSE,          -- Compound/multi-label class
  compound_components INTEGER[],              -- Component class IDs for compounds
  level INTEGER DEFAULT 0,                    -- Hierarchy level
  is_active BOOLEAN DEFAULT TRUE,             -- Active for annotation
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(project_id, name),
  INDEX idx_classes_project (project_id),
  INDEX idx_classes_compound (is_compound),
  INDEX idx_classes_level (level)
);

-- Define parent-child relationships in taxonomy (DAG support)
CREATE TABLE IF NOT EXISTS label_hierarchy (
  parent_id INTEGER NOT NULL REFERENCES label_classes(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES label_classes(id) ON DELETE CASCADE,
  relationship_type TEXT DEFAULT 'is_a',      -- 'is_a', 'part_of', 'co_occurs'
  strength FLOAT DEFAULT 1.0,                 -- Relationship strength
  created_at TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY(parent_id, child_id),
  CHECK(parent_id != child_id)               -- Prevent self-reference
);

-- =====================================================
-- JOB ORCHESTRATION & PROCESSING
-- =====================================================

-- Track all clustering and propagation jobs
CREATE TABLE IF NOT EXISTS processing_jobs (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,                     -- 'extract_features', 'cluster', 'propagate'
  job_subtype TEXT,                           -- 'dsp', 'panns', 'hdbscan', etc.
  run_id TEXT NOT NULL,                       -- Links to cluster/propagation run
  status TEXT DEFAULT 'queued',               -- 'queued', 'running', 'completed', 'failed'
  priority INTEGER DEFAULT 5,                 -- Job priority (1-10)
  params_json JSONB,                          -- Job parameters
  progress_pct INTEGER DEFAULT 0,             -- Progress percentage
  current_step TEXT,                          -- Current processing step
  total_steps INTEGER,                        -- Total steps in job
  worker_id TEXT,                             -- Worker instance ID
  started_at TIMESTAMPTZ,                     -- Job start time
  finished_at TIMESTAMPTZ,                    -- Job completion time
  error_message TEXT,                         -- Error details if failed
  retry_count INTEGER DEFAULT 0,              -- Number of retries
  max_retries INTEGER DEFAULT 3,              -- Maximum retry attempts
  estimated_duration_ms BIGINT,               -- Estimated processing time
  actual_duration_ms BIGINT,                  -- Actual processing time
  memory_usage_mb INTEGER,                    -- Peak memory usage
  cpu_usage_pct FLOAT,                        -- Average CPU usage
  s3_input_keys TEXT[],                       -- Input S3 keys
  s3_output_keys TEXT[],                      -- Output S3 keys
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_jobs_status (status),
  INDEX idx_jobs_type (job_type, job_subtype),
  INDEX idx_jobs_project (project_id),
  INDEX idx_jobs_priority (priority DESC, created_at),
  INDEX idx_jobs_run (run_id)
);

-- =====================================================
-- PERFORMANCE METRICS & MONITORING
-- =====================================================

-- Store system performance metrics for monitoring
CREATE TABLE IF NOT EXISTS clustering_metrics (
  id BIGSERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  metric_type TEXT NOT NULL,                  -- 'throughput', 'quality', 'cost'
  metric_name TEXT NOT NULL,                  -- Specific metric name
  value FLOAT NOT NULL,                       -- Metric value
  unit TEXT,                                  -- Metric unit
  tags_json JSONB,                           -- Additional tags/dimensions
  timestamp TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_metrics_type (metric_type, metric_name),
  INDEX idx_metrics_project (project_id),
  INDEX idx_metrics_time (timestamp DESC)
);
