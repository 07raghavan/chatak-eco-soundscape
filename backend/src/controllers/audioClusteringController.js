import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { AudioFeatureService } from '../services/audioFeatureService.js';
import { AudioClusteringService } from '../services/audioClusteringService.js';
import { getFileUrl } from '../config/s3.js';

const featureService = new AudioFeatureService();
const clusteringService = new AudioClusteringService();

/**
 * Start audio clustering for a recording
 * POST /api/recordings/:recordingId/clustering
 */
export const startAudioClustering = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    console.log(`🎯 Starting audio clustering for recording ${recordingId}`);

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if recording has events
    const eventCount = await db.query(`
      SELECT COUNT(*) as count
      FROM events
      WHERE recording_id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (eventCount[0].count === 0) {
      return res.status(400).json({ 
        error: 'No acoustic events found for this recording. Please run acoustic event detection first.' 
      });
    }

    // Set up Server-Sent Events for progress updates
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Progress callback function
    const progressCallback = (progress, message) => {
      res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
    };

    try {
      // Step 1: Get unique events (no duplicate timelines)
      progressCallback(10, 'Fetching unique acoustic events...');
      
      const uniqueEvents = await getUniqueTimelineEvents(recordingId);
      console.log(`📊 Found ${uniqueEvents.length} unique timeline events`);
      
      if (uniqueEvents.length === 0) {
        throw new Error('No unique timeline events found for clustering');
      }

      // Step 2: Extract audio features
      progressCallback(20, 'Extracting audio features...');
      
      const features = await featureService.extractFeaturesForSnippets(uniqueEvents);
      console.log(`🎵 Extracted features for ${features.length} snippets`);
      
      if (features.length === 0) {
        throw new Error('Failed to extract audio features');
      }

      // Step 3: Perform clustering
      progressCallback(60, 'Performing HDBSCAN clustering...');
      
      const clusteringResults = await clusteringService.performClustering(features);
      console.log(`🎯 Clustering completed with ${clusteringResults.total_clusters} clusters`);

      // Step 4: Send final results
      progressCallback(100, 'Clustering complete!');
      
      res.write(`data: ${JSON.stringify({ 
        progress: 100, 
        message: 'Audio clustering completed successfully!',
        result: {
          success: true,
          total_events: uniqueEvents.length,
          total_clusters: clusteringResults.total_clusters,
          total_snippets: clusteringResults.total_snippets
        }
      })}\n\n`);

      res.end();

    } catch (analysisError) {
      console.error('Audio clustering error:', analysisError);
      res.write(`data: ${JSON.stringify({ 
        progress: -1, 
        error: analysisError.message 
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    console.error('❌ Audio clustering controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get unique timeline events (no duplicate time slots)
 */
async function getUniqueTimelineEvents(recordingId) {
  const events = await db.query(`
    SELECT 
      e.id as event_id,
      e.species,
      e.scientific_name,
      e.confidence,
      e.start_ms,
      e.end_ms,
      e.duration_ms,
      e.snippet_file_path,
      e.snippet_file_size,
      e.created_at
    FROM events e
    WHERE e.recording_id = :recordingId
      AND e.snippet_file_path IS NOT NULL
    ORDER BY e.start_ms ASC
  `, {
    replacements: { recordingId },
    type: QueryTypes.SELECT
  });

  // Group by timeline to avoid duplicates
  const timelineGroups = new Map();
  
  events.forEach(event => {
    const startSec = Math.floor(event.start_ms / 1000);
    const endSec = Math.floor(event.end_ms / 1000);
    const timeKey = `${startSec}-${endSec}`;
    
    if (!timelineGroups.has(timeKey)) {
      timelineGroups.set(timeKey, []);
    }
    timelineGroups.get(timeKey).push(event);
  });

  // Take one event per timeline (the one with highest confidence)
  const uniqueEvents = [];
  
  for (const [timeKey, eventsInTimeline] of timelineGroups) {
    const bestEvent = eventsInTimeline.reduce((best, current) => 
      current.confidence > best.confidence ? current : best
    );
    
    uniqueEvents.push({
      ...bestEvent,
      s3_key: bestEvent.snippet_file_path, // Use snippet_file_path as s3_key
      timeline_key: timeKey
    });
  }

  return uniqueEvents;
}

/**
 * Get clustering results for a recording
 * GET /api/recordings/:recordingId/clustering
 */
export const getClusteringResults = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get clustering results
    const results = await clusteringService.getClusteringResults(recordingId);

    res.json({
      success: true,
      recording_id: recordingId,
      ...results
    });

  } catch (error) {
    console.error('❌ Get clustering results error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get clustering status for a recording
 * GET /api/recordings/:recordingId/clustering/status
 */
export const getClusteringStatus = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    console.log(`🔍 Checking clustering status for recording ${recordingId}`);

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      console.log(`❌ Recording ${recordingId} not found`);
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      console.log(`❌ Access denied for recording ${recordingId}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log(`✅ Recording ${recordingId} access verified`);

    // First check if the clustering tables exist
    try {
      // Check if clustering exists - use a simpler query first
      const clusterCount = await db.query(`
        SELECT COUNT(DISTINCT ac.id) as count
        FROM audio_clusters ac
        JOIN cluster_assignments ca ON ac.id = ca.cluster_id
        JOIN events e ON ca.event_id = e.id
        WHERE e.recording_id = :recordingId
      `, { 
        replacements: { recordingId }, 
        type: QueryTypes.SELECT 
      });

      const hasClustering = clusterCount[0].count > 0;
      console.log(`📊 Clustering status: ${hasClustering ? 'Found' : 'Not found'} (${clusterCount[0].count} clusters)`);

      // Get latest clustering timestamp
      let lastClustering = null;
      if (hasClustering) {
        const latestCluster = await db.query(`
          SELECT ac.created_at
          FROM audio_clusters ac
          JOIN cluster_assignments ca ON ac.id = ca.cluster_id
          JOIN events e ON ca.event_id = e.id
          WHERE e.recording_id = :recordingId
          ORDER BY ac.created_at DESC
          LIMIT 1
        `, { 
          replacements: { recordingId }, 
          type: QueryTypes.SELECT 
        });
        lastClustering = latestCluster[0].created_at;
        console.log(`🕒 Latest clustering: ${lastClustering}`);
      }

      res.json({
        success: true,
        recording_id: recordingId,
        has_clustering: hasClustering,
        cluster_count: clusterCount[0].count,
        last_clustering: lastClustering
      });

    } catch (dbError) {
      console.error('❌ Database query error:', dbError);
      
      // If tables don't exist or query fails, return no clustering
      res.json({
        success: true,
        recording_id: recordingId,
        has_clustering: false,
        cluster_count: 0,
        last_clustering: null
      });
    }

  } catch (error) {
    console.error('❌ Get clustering status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete clustering results for a recording
 * DELETE /api/recordings/:recordingId/clustering
 */
export const deleteClustering = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete clustering data (cascade will handle related records)
    const deleteResult = await db.query(`
      DELETE FROM audio_clusters ac
      WHERE ac.id IN (
        SELECT DISTINCT ac2.id
        FROM audio_clusters ac2
        JOIN cluster_assignments ca ON ac2.id = ca.cluster_id
        JOIN events e ON ca.event_id = e.id
        WHERE e.recording_id = :recordingId
      )
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.DELETE 
    });

    // Also delete audio features
    await db.query(`
      DELETE FROM audio_features af
      WHERE af.event_id IN (
        SELECT id FROM events WHERE recording_id = :recordingId
      )
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.DELETE 
    });

    res.json({
      success: true,
      message: 'Clustering results deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete clustering error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get events for a recording (for preview)
 * GET /api/recordings/:recordingId/events
 */
export const getEventsForRecording = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const { limit = 3 } = req.query;
    const userId = req.user.id;

    console.log(`🔍 Fetching events for recording ${recordingId} (limit: ${limit})`);

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      console.log(`❌ Recording ${recordingId} not found`);
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      console.log(`❌ Access denied for recording ${recordingId}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log(`✅ Recording ${recordingId} access verified`);

    // Get total count of unique timeline events (no duplicates by start/end time)
    const totalUniqueEvents = await db.query(`
      SELECT COUNT(DISTINCT CONCAT(e.start_ms, '_', e.end_ms)) as unique_count
      FROM events e
      WHERE e.recording_id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    const totalUniqueCount = totalUniqueEvents[0].unique_count;

    // Get preview events (include snippet URL for audio playback)
    const events = await db.query(`
      SELECT 
        e.id,
        e.species,
        e.scientific_name,
        e.confidence,
        e.start_ms,
        e.end_ms,
        e.duration_ms,
        e.snippet_file_path
      FROM events e
      WHERE e.recording_id = :recordingId
      ORDER BY e.start_ms ASC
      LIMIT :limit
    `, { 
      replacements: { recordingId, limit: parseInt(limit) }, 
      type: QueryTypes.SELECT 
    });

    // Add snippet URLs to events
    const eventsWithUrls = await Promise.all(events.map(async (event) => ({
      ...event,
      snippet_url: event.snippet_file_path ? await getFileUrl(event.snippet_file_path) : null
    })));

    console.log(`📊 Found ${totalUniqueCount} unique timeline events, showing ${eventsWithUrls.length} preview events for recording ${recordingId}`);

    res.json({
      success: true,
      recording_id: recordingId,
      events: eventsWithUrls,
      total_found: totalUniqueCount,
      preview_count: eventsWithUrls.length
    });

  } catch (error) {
    console.error('❌ Get events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get audio snippet for an event
 * GET /api/recordings/:recordingId/events/:eventId/snippet
 */
export const getEventSnippet = async (req, res) => {
  try {
    const { recordingId, eventId } = req.params;
    const userId = req.user.id;

    console.log(`🔍 Fetching snippet for event ${eventId} in recording ${recordingId}`);

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      console.log(`❌ Recording ${recordingId} not found`);
      return res.status(500).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      console.log(`❌ Access denied for recording ${recordingId}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get the event snippet file path
    const event = await db.query(`
      SELECT e.snippet_file_path
      FROM events e
      WHERE e.id = :eventId AND e.recording_id = :recordingId
    `, { 
      replacements: { eventId, recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (event.length === 0) {
      console.log(`❌ Event ${eventId} not found in recording ${recordingId}`);
      return res.status(404).json({ error: 'Event not found' });
    }

    const snippetPath = event[0].snippet_file_path;
    if (!snippetPath) {
      console.log(`❌ No snippet file path for event ${eventId}`);
      return res.status(404).json({ error: 'Snippet file not found' });
    }

    // Generate signed URL for the snippet
    const snippetUrl = await getFileUrl(snippetPath);
    
    // Return the signed URL instead of redirecting
    res.json({
      success: true,
      snippet_url: snippetUrl,
      event_id: eventId,
      recording_id: recordingId
    });

  } catch (error) {
    console.error('❌ Get event snippet error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
