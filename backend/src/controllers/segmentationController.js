import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { getFileUrl } from '../config/s3.js';
import { startSegmentationBackground, getSegmentationStatus, clearSegmentationStatus, createSingleSegmentForShortClip } from '../services/segmentationWorker.js';

const PRESETS = [
  { key: 'birds_low', label: 'Birds (0.5–8 kHz)', min_hz: 500, max_hz: 8000, default_sr: 32000 },
  { key: 'birds_mid', label: 'Birds (1–12 kHz)', min_hz: 1000, max_hz: 12000, default_sr: 44100 },
  { key: 'mammals', label: 'Mammals (100–4 kHz)', min_hz: 100, max_hz: 4000, default_sr: 32000 },
  { key: 'bats', label: 'Bats (20–120 kHz)', min_hz: 20000, max_hz: 120000, default_sr: 96000 },
  { key: 'custom', label: 'Custom', min_hz: null, max_hz: null, default_sr: 32000 }
];

export const getSegmentationPresets = async (req, res) => {
  return res.json({ presets: PRESETS });
};

export const createSegmentationJob = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;
    const {
      strategy = 'hybrid',
      seg_len_s = 60,
      overlap_pct = 5,
      min_hz,
      max_hz,
      preset_key = 'birds_low',
      sample_rate,
      min_silence_db = -35,
      min_silence_sec = 0.5,
      silence_backoff_sec = 5,
      pipeline_version = 'seg-v1.0'
    } = req.body;

    // Check recording ownership via project
    const rec = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    // Guard: very short audio (< 60s) not worth segmenting
    const durationSec = rec[0].duration_seconds || (rec[0].duration_ms ? rec[0].duration_ms / 1000 : null);
    
    if (!durationSec) {
      return res.status(400).json({ 
        error: 'Recording duration unknown. Please re-upload the file to extract metadata.' 
      });
    }
    
    console.log(`✅ Recording validated: ${Math.round(durationSec)}s duration`);

    // Handle short clips (< 60 seconds) - create single segment instead of segmentation
    if (durationSec < 60) {
      console.log(`📝 Short clip detected (${Math.round(durationSec)}s < 60s) - creating single segment instead of segmentation`);

      const singleSegment = await createSingleSegmentForShortClip(parseInt(recordingId, 10), rec[0]);

      return res.status(201).json({
        message: `Short clip processed as single segment (${Math.round(durationSec)}s)`,
        segments: [singleSegment],
        recording_id: recordingId,
        is_short_clip: true
      });
    }

    console.log(`✅ Recording ready for segmentation: ${Math.round(durationSec)}s duration`);

    const preset = PRESETS.find(p => p.key === preset_key) || PRESETS[0];
    const effectiveSampleRate = sample_rate || preset.default_sr || 32000;

    const payload = {
      recording_id: rec[0].id,
      s3_key: rec[0].file_path,
      pipeline_version,
      params: {
        strategy,
        seg_len_s,
        overlap_pct,
        min_hz: min_hz ?? preset.min_hz,
        max_hz: max_hz ?? preset.max_hz,
        sample_rate: effectiveSampleRate,
        min_silence_db,
        min_silence_sec,
        silence_backoff_sec
      }
    };

    // Start segmentation in background
    const result = await startSegmentationBackground(parseInt(recordingId, 10), payload.params || {});
    res.status(202).json({
      message: 'Segmentation started in background',
      recording_id: recordingId,
      status: 'running'
    });
  } catch (err) {
    console.error('❌ createSegmentationJob error', err);
    res.status(500).json({ error: 'Failed to queue segmentation job' });
  }
};

// Get background segmentation status
export const getBackgroundSegmentationStatus = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const status = getSegmentationStatus(parseInt(recordingId, 10));

    if (!status) {
      return res.status(404).json({ error: 'No active segmentation found' });
    }

    res.json(status);
  } catch (err) {
    console.error('❌ getBackgroundSegmentationStatus error', err);
    res.status(500).json({ error: 'Failed to get segmentation status' });
  }
};

// Clear background segmentation status
export const clearBackgroundSegmentationStatus = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    clearSegmentationStatus(parseInt(recordingId, 10));
    res.json({ message: 'Segmentation status cleared' });
  } catch (err) {
    console.error('❌ clearBackgroundSegmentationStatus error', err);
    res.status(500).json({ error: 'Failed to clear segmentation status' });
  }
};

export const getSegmentationJobs = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Use database-agnostic JSON query
    const dbType = process.env.DB_TYPE || (process.env.SUPABASE_DB_URL ? 'postgres' : 'mysql');

    let query;
    if (dbType === 'postgres') {
      query = `
        SELECT * FROM job_queue
        WHERE type = 'segmentation' AND payload->>'recording_id' = :recordingId::text
        ORDER BY created_at DESC
      `;
    } else {
      query = `
        SELECT * FROM job_queue
        WHERE type = 'segmentation' AND JSON_EXTRACT(payload, '$.recording_id') = :recordingId
        ORDER BY created_at DESC
      `;
    }

    const jobs = await db.query(query, { replacements: { recordingId }, type: QueryTypes.SELECT });
    
    res.json({ jobs });
  } catch (err) {
    console.error('❌ getSegmentationJobs error', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
};

export const getSegmentationJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    // Fetch job with ownership check
    const jobs = await db.query(`
      SELECT
        jq.id, jq.job_id, jq.type, jq.status, jq.priority, jq.attempts, jq.max_attempts,
        jq.payload, jq.error, jq.created_at, jq.updated_at, jq.run_at,
        p.user_id as owner_id
      FROM job_queue jq
      JOIN recordings r ON jq.recording_id = r.id
      JOIN projects p ON r.project_id = p.id
      WHERE jq.job_id = :jobId AND jq.type = 'segmentation'
    `, { replacements: { jobId }, type: QueryTypes.SELECT });

    if (jobs.length === 0) return res.status(404).json({ error: 'Job not found' });
    if (jobs[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    const job = jobs[0];

    // Extract progress information from payload
    const progress = job.payload?.progress || 0;
    const progressMessage = job.payload?.progress_message || 'Waiting to start...';

    res.json({
      job_id: job.job_id,
      status: job.status,
      progress: progress,
      progress_message: progressMessage,
      created_at: job.created_at,
      updated_at: job.updated_at,
      error: job.error,
      attempts: job.attempts
    });
  } catch (err) {
    console.error('❌ getSegmentationJobStatus error', err);
    res.status(500).json({ error: 'Failed to fetch job status' });
  }
};

export const streamSegmentationProgress = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user.id;

    // Verify job ownership
    const jobs = await db.query(`
      SELECT
        jq.id, jq.job_id, jq.status, jq.recording_id,
        p.user_id as owner_id
      FROM job_queue jq
      JOIN recordings r ON jq.recording_id = r.id
      JOIN projects p ON r.project_id = p.id
      WHERE jq.job_id = :jobId AND jq.type = 'segmentation'
    `, { replacements: { jobId }, type: QueryTypes.SELECT });

    if (jobs.length === 0) return res.status(404).json({ error: 'Job not found' });
    if (jobs[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    const job = jobs[0];

    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', job_id: jobId })}\n\n`);

    // Poll for job updates
    const pollInterval = setInterval(async () => {
      try {
        const updatedJobs = await db.query(`
          SELECT status, payload, error, updated_at
          FROM job_queue
          WHERE job_id = :jobId
        `, { replacements: { jobId }, type: QueryTypes.SELECT });

        if (updatedJobs.length === 0) {
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Job not found' })}\n\n`);
          clearInterval(pollInterval);
          res.end();
          return;
        }

        const updatedJob = updatedJobs[0];
        const progress = updatedJob.payload?.progress || 0;
        const progressMessage = updatedJob.payload?.progress_message || 'Processing...';

        const progressData = {
          type: 'progress',
          job_id: jobId,
          status: updatedJob.status,
          progress: progress,
          progress_message: progressMessage,
          updated_at: updatedJob.updated_at,
          error: updatedJob.error
        };

        res.write(`data: ${JSON.stringify(progressData)}\n\n`);

        // Stop polling if job is complete
        if (updatedJob.status === 'succeeded' || updatedJob.status === 'failed') {
          res.write(`data: ${JSON.stringify({ type: 'complete', status: updatedJob.status })}\n\n`);
          clearInterval(pollInterval);
          res.end();
        }
      } catch (pollError) {
        console.error('❌ Progress polling error:', pollError);
        res.write(`data: ${JSON.stringify({ type: 'error', message: 'Polling error' })}\n\n`);
        clearInterval(pollInterval);
        res.end();
      }
    }, 1000); // Poll every second

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(pollInterval);
    });

  } catch (err) {
    console.error('❌ streamSegmentationProgress error', err);
    res.status(500).json({ error: 'Failed to stream progress' });
  }
};

export const getSegmentsForRecording = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const { approved } = req.query;

    // Base query
    let sql = `
      SELECT s.*, sa.status as approval_status
      FROM segments s
      LEFT JOIN segment_approvals sa ON sa.segment_id = s.id
      WHERE s.recording_id = :recordingId`;

    // Approved-only filter
    if (approved === 'true') {
      sql += ` AND sa.status = 'approved'`;
    }

    sql += ` ORDER BY s.start_ms ASC`;

    const segments = await db.query(sql, { replacements: { recordingId }, type: QueryTypes.SELECT });
    const segmentsWithUrls = await Promise.all(
      segments.map(async (s) => ({
        ...s,
        file_url: await getFileUrl(s.s3_key)
      }))
    );
    res.json({ segments: segmentsWithUrls });
  } catch (err) {
    console.error('❌ getSegmentsForRecording error', err);
    res.status(500).json({ error: 'Failed to fetch segments' });
  }
};


