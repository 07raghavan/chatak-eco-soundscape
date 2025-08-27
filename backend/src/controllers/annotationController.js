import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';

/**
 * Annotation Controller
 * Handles all annotation operations for the dual annotation system
 */

/**
 * Get clusters for a recording with annotation status
 * GET /api/projects/:projectId/recordings/:recordingId/clusters
 */
export const getRecordingClusters = async (req, res) => {
  try {
    const { projectId, recordingId } = req.params;
    const userId = req.user.id;

    console.log(`🔍 Fetching clusters for recording ${recordingId} in project ${projectId}`);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Get clusters with annotation counts and representative samples
    const clusters = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.cluster_label,
        c.created_at,
        COUNT(DISTINCT ca.event_id) as snippet_count,
        COUNT(DISTINCT a.id) as annotation_count,
        COUNT(DISTINCT CASE WHEN a.annotation_type = 'representative_sample' THEN a.id END) as representative_count
      FROM audio_clusters c
      LEFT JOIN cluster_assignments ca ON c.id = ca.cluster_id
      LEFT JOIN events e ON ca.event_id = e.id
      LEFT JOIN annotations a ON c.id = a.cluster_id
      WHERE e.recording_id = :recordingId
      GROUP BY c.id, c.name, c.cluster_label, c.created_at
      ORDER BY c.cluster_label
    `, {
      replacements: { recordingId },
      type: QueryTypes.SELECT
    });

    console.log(`📊 Found ${clusters.length} clusters for recording ${recordingId}:`);
    clusters.forEach(cluster => {
      console.log(`  - Cluster ${cluster.cluster_label}: ${cluster.snippet_count} clips, ${cluster.annotation_count} annotations`);
    });

    // Get representative samples for each cluster
    for (let cluster of clusters) {
      const representatives = await db.query(`
        SELECT 
          a.id,
          a.species_label,
          a.confidence_score,
          a.annotation_type,
          a.created_at,
          e.start_ms,
          e.end_ms
        FROM annotations a
        JOIN events e ON a.event_id = e.id
        WHERE a.cluster_id = :clusterId 
        AND a.annotation_type = 'representative_sample'
        ORDER BY a.confidence_score DESC
        LIMIT 5
      `, {
        replacements: { clusterId: cluster.id },
        type: QueryTypes.SELECT
      });

      cluster.representative_samples = representatives;
      cluster.needs_annotation = cluster.representative_count < 3; // Need at least 3 representative samples
    }

    res.json({
      success: true,
      recording_id: recordingId,
      project_id: projectId,
      clusters: clusters,
      total_clusters: clusters.length
    });

  } catch (error) {
    console.error('❌ Get recording clusters error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get clips for a specific event
 * GET /api/projects/:projectId/events/:eventId/clips
 */
export const getEventClips = async (req, res) => {
  try {
    const { projectId, eventId } = req.params;
    const userId = req.user.id;
    const { limit = 10, offset = 0 } = req.query;

    console.log(`🔍 Fetching clips for event ${eventId} in project ${projectId}`);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Verify event exists and belongs to project
    const eventCheck = await db.query(`
      SELECT e.* FROM events e
      JOIN recordings r ON e.recording_id = r.id
      WHERE e.id = :eventId AND r.project_id = :projectId
    `, {
      replacements: { eventId, projectId },
      type: QueryTypes.SELECT
    });

    if (eventCheck.length === 0) {
      return res.status(404).json({ error: 'Event not found in project' });
    }

    // Get the event as a clip
    const clips = [{
      id: eventCheck[0].id,
      start_ms: eventCheck[0].start_ms,
      end_ms: eventCheck[0].end_ms,
      snippet_file_path: eventCheck[0].snippet_file_path,
      cluster_confidence: 1.0,
      annotation_count: 0,
      suggestions: [],
      has_high_confidence: false
    }];

    res.json({
      success: true,
      event: eventCheck[0],
      clips: clips,
      pagination: {
        total: 1,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: false
      }
    });

  } catch (error) {
    console.error('❌ Get event clips error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get clips for a specific cluster with suggestions
 * GET /api/projects/:projectId/clusters/:clusterId/clips
 */
export const getClusterClips = async (req, res) => {
  try {
    const { projectId, clusterId } = req.params;
    const userId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    console.log(`🔍 Fetching clips for cluster ${clusterId} in project ${projectId}`);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Get cluster info
    const clusterInfo = await db.query(`
      SELECT * FROM audio_clusters WHERE id = :clusterId
    `, {
      replacements: { clusterId },
      type: QueryTypes.SELECT
    });

    if (clusterInfo.length === 0) {
      return res.status(404).json({ error: 'Cluster not found' });
    }

    // Get clips (events) for this cluster with high confidence suggestions
    const clips = await db.query(`
      SELECT 
        e.id,
        e.start_ms,
        e.end_ms,
        e.snippet_file_path,
        ca.confidence as cluster_confidence,
        COUNT(DISTINCT a.id) as annotation_count
      FROM cluster_assignments ca
      JOIN events e ON ca.event_id = e.id
      LEFT JOIN annotations a ON e.id = a.event_id
      WHERE ca.cluster_id = :clusterId
      GROUP BY e.id, e.start_ms, e.end_ms, e.snippet_file_path, ca.confidence
      ORDER BY e.start_ms ASC
      LIMIT :limit OFFSET :offset
    `, {
      replacements: { clusterId, limit: parseInt(limit), offset: parseInt(offset) },
      type: QueryTypes.SELECT
    });

    // Get suggestions for each clip (only high confidence ≥50%)
    for (let clip of clips) {
      const suggestions = await db.query(`
        SELECT 
          s.id,
          s.species_name,
          s.scientific_name,
          s.confidence_score,
          s.source,
          s.start_time_ms,
          s.end_time_ms
        FROM annotation_suggestions s
        WHERE s.event_id = :eventId 
        AND s.confidence_score >= 0.5
        ORDER BY s.confidence_score DESC
        LIMIT 3
      `, {
        replacements: { eventId: clip.id },
        type: QueryTypes.SELECT
      });

      clip.suggestions = suggestions;
      clip.has_high_confidence = suggestions.length > 0;
    }

    // Get total count for pagination
    const totalCount = await db.query(`
      SELECT COUNT(DISTINCT e.id) as total
      FROM cluster_assignments ca
      JOIN events e ON ca.event_id = e.id
      WHERE ca.cluster_id = :clusterId
    `, {
      replacements: { clusterId },
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      cluster: clusterInfo[0],
      clips: clips,
      pagination: {
        total: totalCount[0].total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        has_more: (parseInt(offset) + parseInt(limit)) < totalCount[0].total
      }
    });

  } catch (error) {
    console.error('❌ Get cluster clips error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create annotation for a clip
 * POST /api/projects/:projectId/clips/:eventId/annotate
 */
export const createAnnotation = async (req, res) => {
  try {
    const { projectId, eventId } = req.params;
    const userId = req.user.id;
    const { 
      clusterId, 
      annotationType, 
      speciesLabel, 
      confidenceScore, 
      backgroundTags, 
      notes 
    } = req.body;

    console.log(`✏️ Creating annotation for event ${eventId} in project ${projectId}`);
    console.log('📝 Request body:', req.body);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Verify event exists and belongs to project
    const eventCheck = await db.query(`
      SELECT e.* FROM events e
      JOIN recordings r ON e.recording_id = r.id
      WHERE e.id = :eventId AND r.project_id = :projectId
    `, {
      replacements: { eventId, projectId },
      type: QueryTypes.SELECT
    });

    if (eventCheck.length === 0) {
      return res.status(404).json({ error: 'Event not found in project' });
    }

    // Check if annotation already exists for this event and user
    const existingAnnotation = await db.query(`
      SELECT id FROM annotations 
      WHERE user_id = :userId AND event_id = :eventId AND annotation_type = :annotationType
    `, {
      replacements: { userId, eventId, annotationType },
      type: QueryTypes.SELECT
    });

    let annotationId;
    
    if (existingAnnotation.length > 0) {
      // Update existing annotation
      const [updateResult] = await db.query(`
        UPDATE annotations SET
          cluster_id = :clusterId,
          species_label = :speciesLabel,
          confidence_score = :confidenceScore,
          background_tags = :backgroundTags,
          notes = :notes,
          metadata = :metadata,
          updated_at = NOW()
        WHERE id = :annotationId
        RETURNING id
      `, {
        replacements: {
          annotationId: existingAnnotation[0].id,
          clusterId: clusterId || null,
          speciesLabel,
          confidenceScore,
          backgroundTags: Array.isArray(backgroundTags) ? `{${backgroundTags.join(',')}}` : '{}',
          notes: notes || '',
          metadata: JSON.stringify({ created_via: 'platform', updated: true })
        },
        type: QueryTypes.UPDATE
      });
      annotationId = updateResult[0].id;
    } else {
      // Create new annotation
      const [insertResult] = await db.query(`
        INSERT INTO annotations (
          user_id, project_id, cluster_id, event_id, 
          annotation_type, species_label, confidence_score, 
          background_tags, notes, metadata
        ) VALUES (
          :userId, :projectId, :clusterId, :eventId,
          :annotationType, :speciesLabel, :confidenceScore,
          :backgroundTags, :notes, :metadata
        ) RETURNING id
      `, {
        replacements: {
          userId,
          projectId,
          clusterId: clusterId || null,
          eventId,
          annotationType,
          speciesLabel,
          confidenceScore,
          backgroundTags: Array.isArray(backgroundTags) ? `{${backgroundTags.join(',')}}` : '{}',
          notes: notes || '',
          metadata: JSON.stringify({ created_via: 'platform' })
        },
        type: QueryTypes.INSERT
      });
      annotationId = insertResult[0].id;
    }

    console.log(`✅ Annotation created with ID: ${annotationId}`);

    res.json({
      success: true,
      annotation_id: annotationId,
      message: 'Annotation created successfully'
    });

  } catch (error) {
    console.error('❌ Create annotation error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      constraint: error.constraint
    });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

/**
 * Submit clip to public annotation platform
 * POST /api/projects/:projectId/clips/:eventId/submit-to-public
 */
export const submitClipToPublic = async (req, res) => {
  try {
    const { projectId, eventId } = req.params;
    const userId = req.user.id;
    const { submissionReason, difficultyLevel = 'Medium' } = req.body;

    console.log(`📤 Submitting clip ${eventId} to public platform from project ${projectId}`);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Get cluster info for this event
    const clusterInfo = await db.query(`
      SELECT ca.cluster_id, ac.name as cluster_name
      FROM cluster_assignments ca
      JOIN audio_clusters ac ON ca.cluster_id = ac.id
      WHERE ca.event_id = :eventId
      LIMIT 1
    `, {
      replacements: { eventId },
      type: QueryTypes.SELECT
    });

    if (clusterInfo.length === 0) {
      return res.status(404).json({ error: 'Event not assigned to any cluster' });
    }

    const clusterId = clusterInfo[0].cluster_id;

    // Check if already submitted
    const existingSubmission = await db.query(`
      SELECT id FROM clip_submissions 
      WHERE event_id = :eventId AND project_id = :projectId
    `, {
      replacements: { eventId, projectId },
      type: QueryTypes.SELECT
    });

    if (existingSubmission.length > 0) {
      return res.status(400).json({ error: 'Clip already submitted to public platform' });
    }

    // Create submission
    const [submissionResult] = await db.query(`
      INSERT INTO clip_submissions (
        project_id, cluster_id, event_id, submission_reason, difficulty_level
      ) VALUES (
        :projectId, :clusterId, :eventId, :submissionReason, :difficultyLevel
      ) RETURNING id
    `, {
      replacements: {
        projectId,
        clusterId,
        eventId,
        submissionReason,
        difficultyLevel
      },
      type: QueryTypes.INSERT
    });

    const submissionId = submissionResult[0].id;

    console.log(`✅ Clip submitted to public platform with ID: ${submissionId}`);

    res.json({
      success: true,
      submission_id: submissionId,
      message: 'Clip submitted to public platform successfully'
    });

  } catch (error) {
    console.error('❌ Submit clip to public error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get annotation statistics for a project
 * GET /api/projects/:projectId/annotation-stats
 */
export const getProjectAnnotationStats = async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    console.log(`📊 Fetching annotation stats for project ${projectId}`);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Get annotation statistics
    const stats = await db.query(`
      SELECT 
        COUNT(DISTINCT a.id) as total_annotations,
        COUNT(DISTINCT a.user_id) as annotators_count,
        COUNT(DISTINCT a.cluster_id) as annotated_clusters,
        COUNT(DISTINCT CASE WHEN a.annotation_type = 'representative_sample' THEN a.cluster_id END) as clusters_with_representatives,
        COUNT(DISTINCT cs.id) as clips_submitted_to_public,
        COUNT(DISTINCT cs.id) FILTER (WHERE cs.status = 'completed') as public_annotations_completed
      FROM projects p
      LEFT JOIN recordings r ON p.id = r.project_id
      LEFT JOIN events e ON r.id = e.recording_id
      LEFT JOIN annotations a ON e.id = a.event_id
      LEFT JOIN clip_submissions cs ON e.id = cs.event_id
      WHERE p.id = :projectId
    `, {
      replacements: { projectId },
      type: QueryTypes.SELECT
    });

    // Get cluster annotation progress
    const clusterProgress = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.snippet_count,
        COUNT(DISTINCT a.id) as annotation_count,
        COUNT(DISTINCT CASE WHEN a.annotation_type = 'representative_sample' THEN a.id END) as representative_count,
        CASE 
          WHEN COUNT(DISTINCT CASE WHEN a.annotation_type = 'representative_sample' THEN a.id END) >= 3 THEN 'complete'
          WHEN COUNT(DISTINCT CASE WHEN a.annotation_type = 'representative_sample' THEN a.id END) > 0 THEN 'in_progress'
          ELSE 'not_started'
        END as status
      FROM audio_clusters c
      LEFT JOIN cluster_assignments ca ON c.id = ca.cluster_id
      LEFT JOIN events e ON ca.event_id = e.id
      LEFT JOIN recordings r ON e.recording_id = r.id
      LEFT JOIN annotations a ON c.id = a.cluster_id
      WHERE r.project_id = :projectId
      GROUP BY c.id, c.name, c.snippet_count
      ORDER BY c.cluster_label
    `, {
      replacements: { projectId },
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      project_id: projectId,
      statistics: stats[0],
      cluster_progress: clusterProgress
    });

  } catch (error) {
    console.error('❌ Get annotation stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get clips available for public annotation
 * GET /api/projects/:projectId/public-clips
 */
export const getPublicClips = async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;

    console.log(`🔍 Fetching public clips for project ${projectId}`);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Get clips submitted to public platform
    const clips = await db.query(`
      SELECT 
        cs.*,
        e.start_ms,
        e.end_ms,
        e.snippet_file_path,
        c.name as cluster_name,
        c.cluster_label
      FROM clip_submissions cs
      JOIN events e ON cs.event_id = e.id
      LEFT JOIN audio_clusters c ON cs.cluster_id = c.id
      WHERE cs.project_id = :projectId 
      AND cs.status = 'pending'
      ORDER BY cs.created_at ASC
    `, {
      replacements: { projectId },
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      project_id: projectId,
      clips: clips,
      total_clips: clips.length
    });

  } catch (error) {
    console.error('❌ Get public clips error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get volunteer progress and statistics
 * GET /api/annotation/volunteer/progress
 */
export const getVolunteerProgress = async (req, res) => {
  try {
    const userId = req.user.id;

    console.log(`📊 Fetching volunteer progress for user ${userId}`);

    // Get or create volunteer progress
    let progress = await db.query(`
      SELECT * FROM volunteer_progress WHERE user_id = :userId
    `, {
      replacements: { userId },
      type: QueryTypes.SELECT
    });

    if (progress.length === 0) {
      // Create new volunteer progress record
      const [newProgress] = await db.query(`
        INSERT INTO volunteer_progress (
          user_id, total_annotations, accuracy_score, level, 
          experience_points, badges, streak_days
        ) VALUES (
          :userId, 0, 0.00, 'Beginner', 0, '{}', 0
        ) RETURNING *
      `, {
        replacements: { userId },
        type: QueryTypes.INSERT
      });
      progress = [newProgress[0]];
    }

    // Calculate level based on experience points
    const experiencePoints = progress[0].experience_points;
    let level = 'Beginner';
    if (experiencePoints >= 300) level = 'Master';
    else if (experiencePoints >= 200) level = 'Expert';
    else if (experiencePoints >= 100) level = 'Intermediate';

    // Update level if changed
    if (level !== progress[0].level) {
      await db.query(`
        UPDATE volunteer_progress 
        SET level = :level, updated_at = NOW()
        WHERE user_id = :userId
      `, {
        replacements: { level, userId },
        type: QueryTypes.UPDATE
      });
      progress[0].level = level;
    }

    res.json({
      success: true,
      progress: progress[0]
    });

  } catch (error) {
    console.error('❌ Get volunteer progress error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Submit volunteer annotation
 * POST /api/annotation/volunteer/submit
 */
export const submitVolunteerAnnotation = async (req, res) => {
  try {
    const userId = req.user.id;
    const { 
      clipSubmissionId, 
      basicClassification, 
      detailedSpecies, 
      confidenceLevel, 
      backgroundNoise, 
      notes 
    } = req.body;

    console.log(`✏️ Submitting volunteer annotation for clip ${clipSubmissionId}`);

    // Verify clip submission exists and is available
    const clipCheck = await db.query(`
      SELECT cs.*, cs.project_id FROM clip_submissions cs
      WHERE cs.id = :clipSubmissionId AND cs.status = 'pending'
    `, {
      replacements: { clipSubmissionId },
      type: QueryTypes.SELECT
    });

    if (clipCheck.length === 0) {
      return res.status(404).json({ error: 'Clip not found or not available for annotation' });
    }

    const clip = clipCheck[0];

    // Create volunteer annotation
    const [annotationResult] = await db.query(`
      INSERT INTO public_annotations (
        volunteer_id, clip_submission_id, basic_classification,
        detailed_species, confidence_level, background_noise, notes
      ) VALUES (
        :userId, :clipSubmissionId, :basicClassification,
        :detailedSpecies, :confidenceLevel, :backgroundNoise, :notes
      ) RETURNING id
    `, {
      replacements: {
        userId,
        clipSubmissionId,
        basicClassification,
        detailedSpecies: detailedSpecies || null,
        confidenceLevel,
        backgroundNoise: backgroundNoise || [],
        notes: notes || ''
      },
      type: QueryTypes.INSERT
    });

    const annotationId = annotationResult[0].id;

    // Update clip submission volunteer count
    await db.query(`
      UPDATE clip_submissions 
      SET volunteer_annotations_count = volunteer_annotations_count + 1,
          updated_at = NOW()
      WHERE id = :clipSubmissionId
    `, {
      replacements: { clipSubmissionId },
      type: QueryTypes.UPDATE
    });

    // Update volunteer progress
    await db.query(`
      UPDATE volunteer_progress 
      SET 
        total_annotations = total_annotations + 1,
        experience_points = experience_points + 10,
        last_annotation_date = CURRENT_DATE,
        updated_at = NOW()
      WHERE user_id = :userId
    `, {
      replacements: { userId },
      type: QueryTypes.UPDATE
    });

    // Check if consensus reached (3 or more annotations)
    const consensusCheck = await db.query(`
      SELECT 
        COUNT(*) as total_annotations,
        COUNT(DISTINCT basic_classification) as unique_classifications,
        basic_classification,
        COUNT(*) as classification_count
      FROM public_annotations 
      WHERE clip_submission_id = :clipSubmissionId
      GROUP BY basic_classification
      ORDER BY classification_count DESC
      LIMIT 1
    `, {
      replacements: { clipSubmissionId },
      type: QueryTypes.SELECT
    });

    if (consensusCheck.length > 0 && consensusCheck[0].total_annotations >= 3) {
      const topClassification = consensusCheck[0];
      const consensusPercentage = (topClassification.classification_count / topClassification.total_annotations) * 100;
      
      if (consensusPercentage >= 66.67) { // 2/3 majority
        await db.query(`
          UPDATE clip_submissions 
          SET 
            consensus_reached = true,
            consensus_species = :consensusSpecies,
            consensus_confidence = :consensusConfidence,
            status = 'completed',
            updated_at = NOW()
          WHERE id = :clipSubmissionId
        `, {
          replacements: {
            consensusSpecies: topClassification.basic_classification,
            consensusConfidence: consensusPercentage / 100,
            clipSubmissionId
          },
          type: QueryTypes.UPDATE
        });
      }
    }

    console.log(`✅ Volunteer annotation submitted with ID: ${annotationId}`);

    res.json({
      success: true,
      annotation_id: annotationId,
      message: 'Volunteer annotation submitted successfully'
    });

  } catch (error) {
    console.error('❌ Submit volunteer annotation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get BirdNet suggestions for an event
 * GET /api/projects/:projectId/events/:eventId/suggestions
 */
export const getEventSuggestions = async (req, res) => {
  try {
    const { projectId, eventId } = req.params;
    const userId = req.user.id;

    console.log(`🔍 Fetching BirdNet suggestions for event ${eventId} in project ${projectId}`);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Get BirdNet suggestions for this event (only high confidence ≥50%)
    const suggestions = await db.query(`
      SELECT 
        s.id,
        s.species_name,
        s.scientific_name,
        s.confidence_score,
        s.source,
        s.start_time_ms,
        s.end_time_ms,
        s.metadata
      FROM annotation_suggestions s
      WHERE s.event_id = :eventId 
      AND s.confidence_score >= 0.5
      AND s.source = 'birdnet'
      ORDER BY s.confidence_score DESC
      LIMIT 3
    `, {
      replacements: { eventId },
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      event_id: eventId,
      suggestions: suggestions,
      total_suggestions: suggestions.length
    });

  } catch (error) {
    console.error('❌ Get event suggestions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create annotation with suggestion voting
 * POST /api/projects/:projectId/clips/:eventId/annotate-with-suggestions
 */
export const createAnnotationWithSuggestions = async (req, res) => {
  try {
    const { projectId, eventId } = req.params;
    const userId = req.user.id;
    const { 
      clusterId, 
      annotationType, 
      speciesLabel, 
      confidenceScore, 
      backgroundTags, 
      notes,
      suggestionVotes, // Array of {suggestionId, vote: 'match'|'no_match'|'not_clear'}
      regionBoxes // Array of {suggestionId, start_ms, end_ms, label}
    } = req.body;

    console.log(`✏️ Creating annotation with suggestions for event ${eventId} in project ${projectId}`);
    console.log('📝 Request body:', req.body);

    // Verify project access
    const projectCheck = await db.query(`
      SELECT p.* FROM projects p
      WHERE p.id = :projectId AND p.user_id = :userId
    `, {
      replacements: { projectId, userId },
      type: QueryTypes.SELECT
    });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Verify event exists and belongs to project
    const eventCheck = await db.query(`
      SELECT e.* FROM events e
      JOIN recordings r ON e.recording_id = r.id
      WHERE e.id = :eventId AND r.project_id = :projectId
    `, {
      replacements: { eventId, projectId },
      type: QueryTypes.SELECT
    });

    if (eventCheck.length === 0) {
      return res.status(404).json({ error: 'Event not found in project' });
    }

    // Create main annotation
    const [annotationResult] = await db.query(`
      INSERT INTO annotations (
        user_id, project_id, cluster_id, event_id, 
        annotation_type, species_label, confidence_score, 
        background_tags, notes, metadata
      ) VALUES (
        :userId, :projectId, :clusterId, :eventId,
        :annotationType, :speciesLabel, :confidenceScore,
        :backgroundTags, :notes, :metadata
      ) RETURNING id
    `, {
      replacements: {
        userId,
        projectId,
        clusterId: clusterId || null,
        eventId,
        annotationType,
        speciesLabel,
        confidenceScore,
        backgroundTags: Array.isArray(backgroundTags) ? `{${backgroundTags.join(',')}}` : '{}',
        notes: notes || '',
        metadata: JSON.stringify({ 
          created_via: 'platform',
          suggestion_votes: suggestionVotes || [],
          region_boxes: regionBoxes || []
        })
      },
      type: QueryTypes.INSERT
    });

    const annotationId = annotationResult[0].id;

    console.log(`✅ Annotation with suggestions created with ID: ${annotationId}`);

    res.json({
      success: true,
      annotation_id: annotationId,
      message: 'Annotation with suggestions created successfully'
    });

  } catch (error) {
    console.error('❌ Create annotation with suggestions error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      constraint: error.constraint
    });
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
