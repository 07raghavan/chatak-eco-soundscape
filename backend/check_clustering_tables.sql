-- Check if clustering tables exist and show their structure
-- Run this in your PostgreSQL database to verify the setup

-- Check if tables exist
SELECT 
    table_name,
    CASE 
        WHEN table_name IS NOT NULL THEN 'EXISTS'
        ELSE 'MISSING'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('audio_features', 'audio_clusters', 'cluster_assignments');

-- Show table structure if they exist
\dt audio_features;
\dt audio_clusters;
\dt cluster_assignments;

-- Check if tables have data
SELECT 'audio_features' as table_name, COUNT(*) as row_count FROM audio_features
UNION ALL
SELECT 'audio_clusters' as table_name, COUNT(*) as row_count FROM audio_clusters
UNION ALL
SELECT 'cluster_assignments' as table_name, COUNT(*) as row_count FROM cluster_assignments;

-- Check events table structure
\dt events;

-- Check if events table has data
SELECT COUNT(*) as events_count FROM events;
