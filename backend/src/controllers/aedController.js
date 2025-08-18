import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { IndustryStandardAED, AEDSimpleDetector } from '../services/aedDetector.js';
import { OptimizedAED } from '../services/aedDetectorOptimized.js';
import { processAEDEventsWithDeduplication } from '../services/segmentationWorker.js';
import { AEDDeduplicationService } from '../services/aedDeduplicationService.js';

// Fetch approved segments for a recording from segment_approvals
export const getApprovedSegments = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    const rawSegments = await db.query(`
      SELECT s.*
      FROM segments s
      JOIN segment_approvals sa ON sa.segment_id = s.id AND sa.status = 'approved'
      WHERE s.recording_id = :recordingId
      ORDER BY s.start_ms ASC
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    // Attach signed file URLs
    const { getFileUrl } = await import('../config/s3.js');
    const segments = await Promise.all(rawSegments.map(async (s) => ({
      ...s,
      file_url: await getFileUrl(s.s3_key)
    })));

    return res.json({ segments });
  } catch (err) {
    console.error('getApprovedSegments error', err);
    return res.status(500).json({ error: 'Failed to fetch approved segments' });
  }
};

// Enqueue AED jobs for approved segments of a recording
export const enqueueAEDForRecording = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;
    const { params = {} } = req.body || {};

    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    const segments = await db.query(`
      SELECT s.id, s.recording_id, s.s3_key, s.start_ms, s.end_ms, s.duration_ms
      FROM segments s
      JOIN segment_approvals sa ON sa.segment_id = s.id AND sa.status = 'approved'
      WHERE s.recording_id = :recordingId
      ORDER BY s.start_ms ASC
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (segments.length === 0) return res.status(400).json({ error: 'No approved segments for this recording' });

    const createdJobs = [];
    for (const seg of segments) {
      const payload = {
        type: 'aed',
        segment: { recording_id: seg.recording_id, s3_key: seg.s3_key, start_ms: seg.start_ms, end_ms: seg.end_ms, duration_ms: seg.duration_ms },
        params: {
          sample_rate: params.sample_rate ?? 32000,
          min_duration_ms: params.min_duration_ms ?? 80,
          merge_gap_ms: params.merge_gap_ms ?? 200,
          k_on_db: params.k_on_db ?? 8,
          k_off_db: params.k_off_db ?? 4
        }
      };

      const job = await db.query(`
        INSERT INTO job_queue (type, status, priority, recording_id, segment_id, payload)
        VALUES ('aed', 'queued', 5, :recordingId, :segmentId, :payload)
        RETURNING *
      `, { replacements: { recordingId: seg.recording_id, segmentId: seg.id, payload: JSON.stringify(payload) }, type: QueryTypes.INSERT });

      createdJobs.push(job[0][0]);
    }

    return res.status(201).json({ message: 'AED jobs queued', count: createdJobs.length, jobs: createdJobs });
  } catch (err) {
    console.error('enqueueAEDForRecording error', err);
    return res.status(500).json({ error: 'Failed to queue AED jobs' });
  }
};

// List AED events for a segment
export const getAEDEventsForSegment = async (req, res) => {
  try {
    const { segmentId } = req.params;
    const events = await db.query(`
      SELECT * FROM aed_events WHERE segment_id = :segmentId ORDER BY start_ms ASC
    `, { replacements: { segmentId }, type: QueryTypes.SELECT });
    return res.json({ events });
  } catch (err) {
    console.error('getAEDEventsForSegment error', err);
    return res.status(500).json({ error: 'Failed to fetch AED events' });
  }
};

// Run AED synchronously for selected segment IDs (simple, no enqueue)
export const runAEDNow = async (req, res) => {
  try {
    const userId = req.user.id;
    const { recording_id: recordingId, segment_ids: segmentIds = [] } = req.body || {};
    if (!recordingId || !Array.isArray(segmentIds) || segmentIds.length === 0) {
      return res.status(400).json({ error: 'recording_id and non-empty segment_ids are required' });
    }

    // Verify ownership
    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    // Fetch only approved segments among requested
    let segments = await db.query(`
      SELECT s.*
      FROM segments s
      JOIN segment_approvals sa ON sa.segment_id = s.id AND sa.status = 'approved'
      WHERE s.recording_id = :recordingId AND s.id IN (:ids)
      ORDER BY s.start_ms ASC
    `, { replacements: { recordingId, ids: segmentIds }, type: QueryTypes.SELECT });
    if (segments.length === 0) {
      // Fallback: allow running on provided segments even if not approved
      segments = await db.query(`
        SELECT s.* FROM segments s
        WHERE s.recording_id = :recordingId AND s.id IN (:ids)
        ORDER BY s.start_ms ASC
      `, { replacements: { recordingId, ids: segmentIds }, type: QueryTypes.SELECT });
      if (segments.length === 0) return res.status(400).json({ error: 'No segments found in selection' });
    }

    const detector = new AEDSimpleDetector();
    const results = await detector.runForSegments(segments);
    return res.json({ message: 'AED completed', count: results.length, events: results });
  } catch (err) {
    console.error('runAEDNow error', err);
    return res.status(500).json({ error: 'Failed to run AED' });
  }
};

// NEW: Run industry-standard AED for entire recording using approved segments
export const runIndustryAEDForRecording = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;
    const { config = {} } = req.body || {};

    // Verify ownership
    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id, r.duration_seconds
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    // Fetch all approved segments for this recording
    const approvedSegments = await db.query(`
      SELECT s.*
      FROM segments s
      JOIN segment_approvals sa ON sa.segment_id = s.id AND sa.status = 'approved'
      WHERE s.recording_id = :recordingId
      ORDER BY s.start_ms ASC
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (approvedSegments.length === 0) {
      return res.status(400).json({ error: 'No approved segments found for this recording. Please run QC first.' });
    }

    console.log(`🎯 Starting industry-standard AED for recording ${recordingId} with ${approvedSegments.length} approved segments`);

    // Clear existing events for this recording
    await db.query(`
      DELETE FROM aed_events WHERE recording_id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.DELETE });

    // Run industry-standard AED
    const detector = new IndustryStandardAED(config);
    const events = await detector.runForRecording(recordingId, approvedSegments);

    // Calculate coverage statistics
    const totalRecordingDuration = (rec[0].duration_seconds || 0) * 1000; // Convert to ms
    const approvedDuration = approvedSegments.reduce((sum, seg) => sum + seg.duration_ms, 0);
    const coveragePercent = totalRecordingDuration > 0 ? (approvedDuration / totalRecordingDuration) * 100 : 0;

    return res.json({
      message: 'Industry-standard AED completed successfully',
      recording_id: recordingId,
      events_detected: events.length,
      segments_processed: approvedSegments.length,
      coverage_percent: Math.round(coveragePercent * 100) / 100,
      total_duration_ms: totalRecordingDuration,
      processed_duration_ms: approvedDuration,
      method: 'industry-std-v2',
      events: events
    });
  } catch (err) {
    console.error('runIndustryAEDForRecording error', err);
    return res.status(500).json({ error: 'Failed to run industry-standard AED: ' + err.message });
  }
};

// List AED events for an entire recording
export const getAEDEventsForRecording = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    const events = await db.query(`
      SELECT ae.*
      FROM aed_events ae
      WHERE ae.recording_id = :recordingId
      ORDER BY ae.start_ms ASC
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    return res.json({ events });
  } catch (err) {
    console.error('getAEDEventsForRecording error', err);
    return res.status(500).json({ error: 'Failed to fetch AED events' });
  }
};

// NEW: Run optimized high-speed AED for entire recording
export const runOptimizedAEDForRecording = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;
    const { config = {} } = req.body || {};

    // Verify ownership
    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id, r.duration_seconds
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    // Fetch all approved segments for this recording
    const approvedSegments = await db.query(`
      SELECT s.*
      FROM segments s
      JOIN segment_approvals sa ON sa.segment_id = s.id AND sa.status = 'approved'
      WHERE s.recording_id = :recordingId
      ORDER BY s.start_ms ASC
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (approvedSegments.length === 0) {
      return res.status(400).json({ error: 'No approved segments found for this recording. Please run QC first.' });
    }

    console.log(`🚀 Starting optimized AED for recording ${recordingId} with ${approvedSegments.length} approved segments`);

    // Set response headers for streaming
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // Clear existing events for this recording
    await db.query(`
      DELETE FROM aed_events WHERE recording_id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.DELETE });

    // Create optimized detector with progress callback
    const detector = new OptimizedAED(config);
    detector.setProgressCallback((percent, message) => {
      res.write(`data: ${JSON.stringify({ progress: percent, message })}\n\n`);
    });

    try {
      // Run optimized AED
      const events = await detector.runForRecording(recordingId, approvedSegments);

      // Calculate coverage statistics
      const totalRecordingDuration = (rec[0].duration_seconds || 0) * 1000;
      const approvedDuration = approvedSegments.reduce((sum, seg) => sum + seg.duration_ms, 0);
      const coveragePercent = totalRecordingDuration > 0 ? (approvedDuration / totalRecordingDuration) * 100 : 0;

      const result = {
        message: 'Optimized AED completed successfully',
        recording_id: recordingId,
        events_detected: events.length,
        segments_processed: approvedSegments.length,
        coverage_percent: Math.round(coveragePercent * 100) / 100,
        total_duration_ms: totalRecordingDuration,
        processed_duration_ms: approvedDuration,
        method: 'optimized-v1',
        processing_time_estimate: `~${Math.ceil(approvedSegments.length * 0.5)}s`,
        events: events
      };

      // Send final result
      res.write(`data: ${JSON.stringify({ complete: true, result })}\n\n`);
      res.end();

    } catch (processingError) {
      res.write(`data: ${JSON.stringify({ error: 'Processing failed: ' + processingError.message })}\n\n`);
      res.end();
    }

  } catch (err) {
    console.error('runOptimizedAEDForRecording error', err);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to run optimized AED: ' + err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Setup failed: ' + err.message })}\n\n`);
      res.end();
    }
  }
};

/**
 * Process AED events for a recording with cross-segment deduplication
 */
export const processAEDWithDeduplication = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify user owns this recording
    const recording = await db.query(`
      SELECT r.*, p.user_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId AND p.user_id = :userId
    `, { replacements: { recordingId, userId }, type: QueryTypes.SELECT });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found or access denied' });
    }

    // Get segments for this recording
    const segments = await db.query(`
      SELECT id, start_ms, end_ms, duration_ms
      FROM segments
      WHERE recording_id = :recordingId
      ORDER BY start_ms
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (segments.length === 0) {
      return res.status(400).json({ error: 'No segments found for this recording' });
    }

    const segmentIds = segments.map(s => s.id);

    // Process AED events with deduplication
    const result = await processAEDEventsWithDeduplication(
      recordingId,
      segmentIds,
      (progress, message) => {
        console.log(`AED Progress: ${progress.toFixed(1)}% - ${message}`);
      }
    );

    res.json({
      success: true,
      recordingId: parseInt(recordingId),
      segmentsProcessed: segments.length,
      ...result
    });

  } catch (error) {
    console.error('❌ Error processing AED with deduplication:', error);
    res.status(500).json({ error: 'Failed to process AED events with deduplication' });
  }
};

/**
 * Get deduplication statistics for a recording
 */
export const getDeduplicationStats = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify user owns this recording
    const recording = await db.query(`
      SELECT r.*, p.user_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId AND p.user_id = :userId
    `, { replacements: { recordingId, userId }, type: QueryTypes.SELECT });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found or access denied' });
    }

    const dedupService = new AEDDeduplicationService();
    const stats = await dedupService.getDeduplicationStats(recordingId);

    // Get additional breakdown by segment
    const segmentStats = await db.query(`
      SELECT
        s.id as segment_id,
        s.start_ms as segment_start_ms,
        s.end_ms as segment_end_ms,
        COUNT(ae.id) as total_events,
        COUNT(CASE WHEN ae.duplicate_of IS NULL THEN 1 END) as unique_events,
        COUNT(CASE WHEN ae.duplicate_of IS NOT NULL THEN 1 END) as duplicate_events
      FROM segments s
      LEFT JOIN aed_events ae ON s.id = ae.segment_id
      WHERE s.recording_id = :recordingId
      GROUP BY s.id, s.start_ms, s.end_ms
      ORDER BY s.start_ms
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    res.json({
      recordingId: parseInt(recordingId),
      overall: stats,
      bySegment: segmentStats,
      deduplicationRate: stats.duplicate_events > 0 ?
        (stats.duplicate_events / stats.total_events * 100).toFixed(1) : 0
    });

  } catch (error) {
    console.error('❌ Error getting deduplication stats:', error);
    res.status(500).json({ error: 'Failed to get deduplication statistics' });
  }
};

/**
 * Manually trigger deduplication for a recording
 */
export const triggerDeduplication = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify user owns this recording
    const recording = await db.query(`
      SELECT r.*, p.user_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId AND p.user_id = :userId
    `, { replacements: { recordingId, userId }, type: QueryTypes.SELECT });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found or access denied' });
    }

    // Reset all duplicate markings
    await db.query(`
      UPDATE aed_events
      SET duplicate_of = NULL, temporal_iou = NULL, frequency_iou = NULL, dedup_confidence = NULL
      WHERE recording_id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.UPDATE });

    // Get all events for re-deduplication
    const events = await db.query(`
      SELECT id, segment_id, start_ms, end_ms, f_min_hz, f_max_hz, confidence, snr_db
      FROM aed_events
      WHERE recording_id = :recordingId
      ORDER BY start_ms
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    // Re-run deduplication
    const dedupService = new AEDDeduplicationService();
    const result = await dedupService.deduplicateEvents(events, recordingId);

    res.json({
      success: true,
      recordingId: parseInt(recordingId),
      ...result
    });

  } catch (error) {
    console.error('❌ Error triggering deduplication:', error);
    res.status(500).json({ error: 'Failed to trigger deduplication' });
  }
};

