import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { s3, BUCKET_NAME, getFileUrl } from '../config/s3.js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { AEDDeduplicationService } from './aedDeduplicationService.js';
import { jobService } from './jobService.js';
import pLimit from 'p-limit';
import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory store for active segmentations (for background processing)
const activeSegmentations = new Map(); // recordingId -> { status, progress, message, startTime }

// Path to local FFmpeg binaries
const FFMPEG_PATH = path.join(__dirname, '..', '..', 'bin', 'ffmpeg.exe');
const FFPROBE_PATH = path.join(__dirname, '..', '..', 'bin', 'ffprobe.exe');

// Helper: run a command and collect stdout
const runCmd = (cmd, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('close', (code) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${cmd} exited with code ${code}: ${stderr}`));
  });
});

// Probe audio using ffprobe
const ffprobeJson = async (inputPathOrUrl) => {
  try {
    const { stdout } = await runCmd(FFPROBE_PATH, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', inputPathOrUrl]);
    return JSON.parse(stdout);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`FFprobe not found at ${FFPROBE_PATH}. Please ensure FFmpeg is properly extracted to backend/bin/`);
    }
    throw error;
  }
};

// Decide canonical sample rate from params (hybrid policy based on target frequencies)
const chooseSampleRateFromParams = (params = {}) => {
  // Follow policy from extra.txt
  const maxHz = Number(params.max_hz) || null;
  const explicitSr = Number(params.sample_rate) || null;
  if (explicitSr) return explicitSr;
  if (maxHz && maxHz >= 20000) return 96000;    // bats/ultrasonic
  if (maxHz && maxHz >= 12000) return 44100;    // up to 12–20 kHz
  if (maxHz && maxHz >= 8000) return 22050;     // 8-12 kHz (optimized for birds)
  return 16000;                                 // targets ≤ 8 kHz (birds) - Nyquist at 8kHz
};

// Normalize to FLAC mono at target sample rate (optimized for speed)
const normalizeToFlac = async (inputUrl, targetPath, targetSr) => {
  const args = ['-y', '-i', inputUrl, '-ar', String(targetSr), '-ac', '1', '-sample_fmt', 's16', '-c:a', 'flac', '-compression_level', '0', targetPath];
  await runCmd(FFMPEG_PATH, args);
};

// QC helpers
const estimateSilencePct = async (inputPath, minSilenceDb = -35, minSilenceSec = 0.5) => {
  try {
    const { stderr } = await runCmd(FFMPEG_PATH, ['-i', inputPath, '-af', `silencedetect=noise=${minSilenceDb}dB:d=${minSilenceSec}`, '-f', 'null', '-']);
    
    // Extract both silence start and end points for complete boundary detection
    const silenceStarts = [...stderr.matchAll(/silence_start: ([0-9.]+)/g)].map(m => parseFloat(m[1])).filter(Number.isFinite);
    const silenceEnds = [...stderr.matchAll(/silence_end: ([0-9.]+)/g)].map(m => parseFloat(m[1])).filter(Number.isFinite);
    const silenceDurations = [...stderr.matchAll(/silence_duration: ([0-9.]+)/g)].map(m => parseFloat(m[1])).filter(Number.isFinite);
    
    // Calculate total silence time from durations (more reliable)
    const totalSilence = silenceDurations.reduce((a,b)=>a+b,0);
    
    const meta = await ffprobeJson(inputPath);
    const dur = parseFloat(meta?.format?.duration || '0');
    if (!dur || dur <= 0) return null;
    
    return Math.max(0, Math.min(100, (totalSilence / dur) * 100));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('❌ FFmpeg not found for silence detection');
    }
    return null;
  }
};

const estimateRmsDb = async (inputPath) => {
  try {
    const { stderr } = await runCmd(FFMPEG_PATH, ['-i', inputPath, '-filter:a', 'volumedetect', '-f', 'null', '-']);
    const match = stderr.match(/mean_volume:\s*(-?[0-9.]+) dB/);
    if (match) return parseFloat(match[1]);
  } catch {}
  return null;
};

const estimateClippingPct = async (inputPath) => {
  try {
    // Use volumedetect filter which actually outputs peak levels
    const { stderr } = await runCmd(FFMPEG_PATH, ['-i', inputPath, '-af', 'volumedetect', '-f', 'null', '-']);
    
    // Extract peak level from volumedetect output
    const peakMatch = stderr.match(/max_volume:\s*(-?[0-9.]+) dB/);
    if (!peakMatch) {
      console.warn('⚠️ No peak level found in volumedetect output for:', inputPath);
      return null;
    }
    
    const peakDb = parseFloat(peakMatch[1]);
    
    // Clipping detection logic:
    // - 0 dB = maximum amplitude (no headroom)
    // - Positive dB = clipping (exceeds maximum)
    // - Negative dB = safe (has headroom)
    
    if (peakDb >= 0) {
      // Clipping detected - calculate severity
      // 0 dB = 100% clipping, -6 dB = 50% clipping, etc.
      const clippingSeverity = Math.min(100, Math.max(0, (peakDb + 6) * 16.67)); // Scale 0dB to 100%
      console.log(`🎵 Clipping detected: ${peakDb.toFixed(2)}dB = ${clippingSeverity.toFixed(1)}% severity`);
      return clippingSeverity;
    } else if (peakDb >= -1) {
      // Very close to clipping (0-1 dB headroom)
      return 5; // 5% clipping risk
    } else if (peakDb >= -3) {
      // Low headroom (1-3 dB)
      return 2; // 2% clipping risk
    } else {
      // Safe headroom (>3 dB)
      return 0;
    }
    
  } catch (error) {
    console.error('❌ Error estimating clipping percentage for:', inputPath, error.message);
    return null;
  }
};

const createSegmentRow = async (recordingId, s3Key, startMs, endMs, durationMs, qc) => {
  const result = await db.query(`
    INSERT INTO segments (
      recording_id, s3_key, start_ms, end_ms, duration_ms, sample_rate, channels,
      silence_pct, clipping_pct, rms_db, band_energy_low, band_energy_mid, band_energy_high, crest_factor, qc_status
    ) VALUES (
      :recordingId, :s3Key, :startMs, :endMs, :durationMs, :sampleRate, :channels,
      :silencePct, :clippingPct, :rmsDb, :bandLow, :bandMid, :bandHigh, :crest, :qcStatus
    )
    RETURNING *
  `, {
    replacements: {
      recordingId,
      s3Key,
      startMs,
      endMs,
      durationMs,
      sampleRate: qc.sample_rate || null,
      channels: 1,
      silencePct: qc.silence_pct ?? null,
      clippingPct: qc.clipping_pct ?? null,
      rmsDb: qc.rms_db ?? null,
      bandLow: qc.band_energy_low ?? null,
      bandMid: qc.band_energy_mid ?? null,
      bandHigh: qc.band_energy_high ?? null,
      crest: qc.crest_factor ?? null,
      qcStatus: qc.qc_status || 'unknown'
    },
    type: QueryTypes.SELECT
  });

  return result[0]; // Return the created segment
};

// Batch create multiple segment rows for better performance
const createSegmentRowsBatch = async (segmentData) => {
  if (segmentData.length === 0) return;

  const values = segmentData.map((data, index) =>
    `($${index * 11 + 1}, $${index * 11 + 2}, $${index * 11 + 3}, $${index * 11 + 4}, $${index * 11 + 5}, $${index * 11 + 6}, $${index * 11 + 7}, $${index * 11 + 8}, $${index * 11 + 9}, $${index * 11 + 10}, $${index * 11 + 11})`
  ).join(', ');

  const replacements = segmentData.flatMap(data => [
    data.recordingId,
    data.s3Key,
    data.startMs,
    data.endMs,
    data.durationMs,
    data.qc.sample_rate || null,
    1, // channels
    data.qc.silence_pct ?? null,
    data.qc.clipping_pct ?? null,
    data.qc.rms_db ?? null,
    data.qc.qc_status || 'unknown'
  ]);

  await db.query(`
    INSERT INTO segments (
      recording_id, s3_key, start_ms, end_ms, duration_ms, sample_rate, channels,
      silence_pct, clipping_pct, rms_db, qc_status
    ) VALUES ${values}
  `, { replacements, type: QueryTypes.INSERT });

  // Batch insert approvals for passed segments
  const passedSegments = segmentData.filter(data => data.qc.qc_status === 'pass');
  if (passedSegments.length > 0) {
    const approvalValues = passedSegments.map((data, index) =>
      `((SELECT id FROM segments WHERE recording_id = $${index + 1} AND s3_key = $${index + 1 + passedSegments.length} ORDER BY id DESC LIMIT 1), 'approved', NULL, NOW())`
    ).join(', ');

    const approvalReplacements = passedSegments.flatMap(data => [data.recordingId, data.s3Key]);

    await db.query(`
      INSERT INTO segment_approvals (segment_id, status, approved_by, approved_at)
      VALUES ${approvalValues}
      ON CONFLICT (segment_id) DO UPDATE SET status = 'approved', approved_at = NOW(), updated_at = NOW()
    `, { replacements: approvalReplacements, type: QueryTypes.INSERT });
  }
};

// Process single segment with sample-accurate cutting
const processSegment = async (segment, index, normalizedPath, workDir, recordingId, targetSr, performanceMetrics = null) => {
  const outPath = path.join(workDir, `segment_${String(index).padStart(5,'0')}.flac`);

  // Calculate precise duration for sample-accurate cutting
  const duration = segment.end - segment.start;

  console.log(`🔪 Processing segment ${index}: ${segment.start.toFixed(3)}s → ${segment.end.toFixed(3)}s (${duration.toFixed(3)}s)`);

  // Sample-accurate segmentation with decode+reencode (NO -c copy)
  await runCmd(FFMPEG_PATH, [
    '-hide_banner', '-nostats', '-accurate_seek',
    '-ss', String(segment.start),
    '-i', normalizedPath,
    '-t', String(duration),
    '-af', `atrim=start=0:end=${duration},asetpts=N/SR/TB`,
    '-c:a', 'flac',
    '-compression_level', '5',
    '-y', outPath
  ]);
  if (performanceMetrics) performanceMetrics.ffmpeg_operations++;

  // Get metadata and verify actual duration
  const meta = await ffprobeJson(outPath);
  const actualDur = parseFloat(meta?.format?.duration || '0');
  const drift = Math.abs(duration - actualDur);

  console.log(`📏 Segment ${index}: planned=${duration.toFixed(3)}s, actual=${actualDur.toFixed(3)}s, drift=${drift.toFixed(3)}ms`);

  // QC analysis in parallel
  const [silencePct, rmsDb, clippingPct] = await Promise.all([
    estimateSilencePct(outPath),
    estimateRmsDb(outPath),
    estimateClippingPct(outPath)
  ]);
  if (performanceMetrics) performanceMetrics.ffmpeg_operations += 3;

  // Note: Band energy and crest factor are not currently used in the system
  // Keeping them as NULL to avoid unnecessary processing

  // QC decision - more nuanced quality assessment
const qcStatus = (() => {
  // Fail conditions
  if (silencePct !== null && silencePct > 90) return 'fail'; // Too much silence
  if (clippingPct !== null && clippingPct > 15) return 'fail'; // Too much clipping
  
  // Review conditions
  if (silencePct !== null && silencePct > 70) return 'review'; // High silence, needs review
  if (clippingPct !== null && clippingPct > 5) return 'review'; // Some clipping, needs review
  
  // Pass conditions
  return 'pass';
})();

  const key = `segments/recording-${recordingId}/segment_${String(index).padStart(5,'0')}.flac`;

  // Stream upload to S3 (no memory spike for large files)
  if (s3 && BUCKET_NAME) {
    const fileStats = fs.statSync(outPath);
    const fileSize = fileStats.size;

    if (fileSize > 100 * 1024 * 1024) { // > 100MB, use multipart upload
      console.log(`📤 Large segment ${index} (${Math.round(fileSize/1024/1024)}MB) - using multipart upload`);

      const upload = new Upload({
        client: s3,
        params: {
          Bucket: BUCKET_NAME,
          Key: key,
          Body: fs.createReadStream(outPath),
          ContentType: 'audio/flac',
          ServerSideEncryption: 'AES256'
        },
        partSize: 10 * 1024 * 1024, // 10MB parts
        queueSize: 3 // Max 3 concurrent parts
      });

      await upload.done();
    } else {
      // Regular streaming upload for smaller files
      const fileStream = fs.createReadStream(outPath);
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileStream,
        ContentType: 'audio/flac',
        ServerSideEncryption: 'AES256'
      }));
    }

    if (performanceMetrics) performanceMetrics.s3_uploads++;
  }

  // Clean up temp file immediately
  try {
    fs.unlinkSync(outPath);
  } catch (cleanupErr) {
    console.warn(`⚠️ Failed to cleanup ${outPath}:`, cleanupErr.message);
  }

  // Use planned boundaries consistently for accurate timing
const startMs = Math.round(segment.start * 1000);
const endMs = Math.round(segment.end * 1000); // Use planned end, not actual
const durMs = endMs - startMs; // Calculate from boundaries for consistency

  return {
    recordingId,
    s3Key: key,
    startMs,
    endMs,
    durationMs: durMs,
    qc: {
      sample_rate: targetSr,
      silence_pct: silencePct,
      clipping_pct: clippingPct,
      rms_db: rmsDb,
      band_energy_low: null,  // Not currently used
      band_energy_mid: null,  // Not currently used
      band_energy_high: null, // Not currently used
      crest_factor: null,     // Not currently used
      qc_status: qcStatus
    }
  };
};

// Process segments with proper concurrency control
const processSegmentsInParallel = async (segmentsPlanned, normalizedPath, workDir, recordingId, targetSr, updateProgress, performanceMetrics = null) => {
  const maxConcurrency = Math.min(4, os.cpus().length); // Conservative concurrency for stability
  const limit = pLimit(maxConcurrency); // Proper concurrency limiter

  console.log(`🔄 Processing ${segmentsPlanned.length} segments with max ${maxConcurrency} concurrent workers`);

  const createdKeys = [];
  const segmentDataBatch = [];
  let completedCount = 0;

  // Create limited concurrent tasks
  const tasks = segmentsPlanned.map((segment, index) =>
    limit(async () => {
      const result = await processSegment(segment, index, normalizedPath, workDir, recordingId, targetSr, performanceMetrics);

      completedCount++;
      const progress = 40 + ((completedCount / segmentsPlanned.length) * 50);
      await updateProgress(progress, `Processed ${completedCount}/${segmentsPlanned.length} segments`);

      return result;
    })
  );

  // Wait for all segments to complete
  const results = await Promise.all(tasks);

  // Collect results
  createdKeys.push(...results.map(r => r.s3Key));
  segmentDataBatch.push(...results);

  if (performanceMetrics) {
    performanceMetrics.segments_created += results.length;
    performanceMetrics.total_duration_ms += results.reduce((sum, r) => sum + r.durationMs, 0);
  }

  // Batch insert all segments at once for better performance
  if (segmentDataBatch.length > 0) {
    console.log(`💾 Batch inserting ${segmentDataBatch.length} segments to database`);
    await createSegmentRowsBatch(segmentDataBatch);
  }

  return createdKeys;
};

export const pollAndRunSegmentation = async () => {
  console.log('🔍 Segmentation worker polling for jobs...');

  try {
    // Reset any stuck jobs first
    await jobService.resetStuckJobs(60); // Reset jobs running > 60 minutes

    // Get the next queued segmentation job using enhanced job service
    const job = await jobService.getNextJob(['segmentation', 'segment'], 'segmentation-worker');

    if (!job) {
      console.log('📭 No segmentation jobs in queue');
      return;
    }

    const recordingId = job.payload.recording_id;
    console.log(`🚀 Processing segmentation job ${job.job_id} for recording ${recordingId}`);

    try {
      // Check if outputs already exist (idempotency)
      const outputsExist = await jobService.checkOutputsExist(recordingId, 'segment', {
        codeVersion: job.code_version
      });

      if (outputsExist) {
        console.log(`⏭️ Segments already exist for recording ${recordingId}, skipping processing`);
        await jobService.completeJob(job.job_id, { skipped: true, reason: 'outputs_already_exist' });
        return;
      }

      // Run the segmentation with progress tracking
      const result = await runSegmentationWithProgress(recordingId, job.payload.params || {}, job.job_id);

      // Mark as succeeded with result metadata
      await jobService.completeJob(job.job_id, {
        segments_created: result?.segments_created || 0,
        total_duration_ms: result?.total_duration_ms || 0,
        processing_time_ms: result?.processing_time_ms || 0
      });

      console.log(`✅ Segmentation job ${job.job_id} completed successfully`);

    } catch (error) {
      console.error(`❌ Segmentation job ${job.job_id} failed:`, error);

      // Use enhanced job service for failure handling with exponential backoff
      const shouldRetry = job.attempts < (job.max_attempts || 3);
      await jobService.failJob(job.job_id, error, shouldRetry);
    }

  } catch (err) {
    console.error('❌ Segmentation worker error:', err);
  }
};

// Enhanced worker loop with better management
let workerInterval = null;
let isWorkerRunning = false;

export const startSegmentationWorkerLoop = (intervalMs = 5000) => {
  if (workerInterval) {
    console.log('⚠️ Segmentation worker already running');
    return;
  }

  console.log(`🧵 Starting segmentation worker loop (polling every ${intervalMs}ms)`);

  workerInterval = setInterval(async () => {
    if (isWorkerRunning) {
      console.log('⏳ Previous worker iteration still running, skipping...');
      return;
    }

    isWorkerRunning = true;
    try {
      await pollAndRunSegmentation();
    } catch (e) {
      console.error('❌ Segmentation worker loop error:', e);
    } finally {
      isWorkerRunning = false;
    }
  }, intervalMs);
};

export const stopSegmentationWorkerLoop = () => {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    console.log('🛑 Segmentation worker loop stopped');
  }
};

export const getWorkerStatus = () => {
  return {
    running: !!workerInterval,
    processing: isWorkerRunning
  };
};

// Queue a segmentation job for async processing with idempotency
export const queueSegmentationJob = async (recordingId, params = {}) => {
  console.log(`📋 Queueing segmentation job for recording ${recordingId}`);

  const payload = {
    recording_id: recordingId,
    params: params
  };

  try {
    // Use enhanced job service with idempotency check
    const result = await jobService.enqueueJobIdempotent('segment', payload, {
      priority: 5,
      codeVersion: process.env.CODE_VERSION || 'v1.0'
    });

    if (result.wasCreated) {
      console.log(`✅ Created new segmentation job: ${result.jobId}`);
    } else {
      console.log(`♻️ Found existing segmentation job: ${result.jobId} (status: ${result.status})`);
    }

    return {
      job_id: result.jobId,
      was_created: result.wasCreated,
      status: result.status
    };

  } catch (error) {
    console.error(`❌ Failed to queue segmentation job for recording ${recordingId}:`, error);
    throw error;
  }
};

// Run segmentation with progress tracking (used by worker)
export const runSegmentationWithProgress = async (recordingId, params = {}, jobId = null) => {
  console.log(`⚡ Running segmentation with progress tracking for recording ${recordingId}`);

  const startTime = Date.now();
  const performanceMetrics = {
    recording_id: recordingId,
    job_id: jobId,
    start_time: startTime,
    segments_created: 0,
    total_duration_ms: 0,
    processing_time_ms: 0,
    ffmpeg_operations: 0,
    s3_uploads: 0,
    db_operations: 0
  };

  try {
    // Update job progress
    const updateProgress = async (progress, message) => {
      if (jobId) {
        // Use database-agnostic JSON update
        const dbType = process.env.DB_TYPE || (process.env.SUPABASE_DB_URL ? 'postgres' : 'mysql');

        if (dbType === 'postgres') {
          await db.query(`
            UPDATE job_queue
            SET payload = jsonb_set(payload, '{progress}', :progress::jsonb),
                payload = jsonb_set(payload, '{progress_message}', :message::jsonb),
                updated_at = NOW()
            WHERE id = :jobId
          `, {
            replacements: {
              jobId,
              progress: JSON.stringify(progress),
              message: JSON.stringify(message)
            },
            type: QueryTypes.UPDATE
          });
        } else {
          await db.query(`
            UPDATE job_queue
            SET payload = JSON_SET(payload, '$.progress', :progress),
                payload = JSON_SET(payload, '$.progress_message', :message),
                updated_at = NOW()
            WHERE id = :jobId
          `, {
            replacements: {
              jobId,
              progress: progress,
              message: message
            },
            type: QueryTypes.UPDATE
          });
        }
      }
      console.log(`📊 Progress ${progress}%: ${message}`);
    };

    await updateProgress(0, 'Starting segmentation...');

    // Fetch recording info
    const recRows = await db.query(`SELECT * FROM recordings WHERE id = :id`, {
      replacements: { id: recordingId },
      type: QueryTypes.SELECT
    });
    if (!recRows || recRows.length === 0) throw new Error('Recording not found');
    const rec = recRows[0];

    await updateProgress(5, 'Validating recording...');

    // Get input URL
    const inputUrl = await getFileUrl(rec.file_path);

    await updateProgress(10, 'Analyzing audio metadata...');

    // Probe original file
    const probe = await ffprobeJson(inputUrl);
    performanceMetrics.ffmpeg_operations++;
    const audioStream = probe.streams.find(s => s.codec_type === 'audio');
    if (!audioStream) throw new Error('No audio stream found');

    const durationSec = parseFloat(probe.format.duration);
    performanceMetrics.total_duration_ms = Math.round(durationSec * 1000);
    const origSr = parseInt(audioStream.sample_rate);
    const channels = parseInt(audioStream.channels);
    const bitRate = parseInt(probe.format.bit_rate || '0');
    const codecName = audioStream.codec_name;

    // Save probe to recordings
    await db.query(`
      UPDATE recordings SET duration_ms = :durationMs, sample_rate = :sr, channels = :ch, bit_rate = :br, codec_name = :codec
      WHERE id = :id
    `, {
      replacements: {
        durationMs: Math.round(durationSec * 1000),
        sr: origSr,
        ch: channels,
        br: bitRate,
        codec: codecName,
        id: recordingId
      },
      type: QueryTypes.UPDATE
    });

    await updateProgress(15, 'Preparing audio normalization...');

    // Normalize
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
    const normalizedPath = path.join(workDir, 'normalized.flac');
    const segLen = params.seg_len_s || 60;
    const overlapPct = params.overlap_pct || 10;
    const targetSr = chooseSampleRateFromParams(params);

    await updateProgress(20, 'Normalizing audio...');
    await normalizeToFlac(inputUrl, normalizedPath, targetSr);
    performanceMetrics.ffmpeg_operations++;

    await updateProgress(30, 'Detecting silence points...');

    // Silence detection with adaptive backoff
    const minSilenceDb = params.min_silence_db ?? -35;
    const minSilenceSec = params.min_silence_sec ?? 0.5;
    
    // FIX: Adaptive backoff based on audio characteristics
    const avgSegmentLength = segLen;
    const backoffSec = Math.min(Math.max(avgSegmentLength * 0.1, 1), 10); // 10% of segment length, min 1s, max 10s
    
    console.log(`🔍 Adaptive silence detection: backoff=${backoffSec.toFixed(1)}s (${(backoffSec/avgSegmentLength*100).toFixed(1)}% of segment length)`);
    const { stderr: sil } = await runCmd(FFMPEG_PATH, ['-i', normalizedPath, '-af', `silencedetect=noise=${minSilenceDb}dB:d=${minSilenceSec}`, '-f', 'null', '-']);
    performanceMetrics.ffmpeg_operations++;
    
    // FIX: Use both silence start and end points for complete boundary detection
    const silenceStarts = [...sil.matchAll(/silence_start: ([0-9.]+)/g)].map(m => parseFloat(m[1])).filter(Number.isFinite);
    const silenceEnds = [...sil.matchAll(/silence_end: ([0-9.]+)/g)].map(m => parseFloat(m[1])).filter(Number.isFinite);
    const silenceDurations = [...sil.matchAll(/silence_duration: ([0-9.]+)/g)].map(m => parseFloat(m[2])).filter(Number.isFinite);
    
    // Combine all silence points for better cut point selection
    const cutPoints = [...silenceStarts, ...silenceEnds].sort((a, b) => a - b);

    const overlapSec = (segLen * overlapPct) / 100;
    const segmentsPlanned = [];
    let currentStart = 0;

    await updateProgress(35, 'Planning segment boundaries...');

    while (currentStart < durationSec) {
      const idealEnd = currentStart + segLen;
      let actualEnd = idealEnd;

      if (idealEnd < durationSec) {
        const searchStart = Math.max(idealEnd - backoffSec, currentStart + 1);
        const searchEnd = Math.min(idealEnd + backoffSec, durationSec);
        const candidateCuts = cutPoints.filter(cp => cp >= searchStart && cp <= searchEnd);

        if (candidateCuts.length > 0) {
          actualEnd = candidateCuts.reduce((closest, cp) =>
            Math.abs(cp - idealEnd) < Math.abs(closest - idealEnd) ? cp : closest
          );
        }
      } else {
        actualEnd = durationSec;
      }

      segmentsPlanned.push({ start: currentStart, end: actualEnd });
      // FIX: Proper overlap calculation - move back by overlap amount
      currentStart = actualEnd - overlapSec;
      
      // Ensure we don't go backwards or create infinite loops
      if (currentStart <= segmentsPlanned[segmentsPlanned.length - 1].start) {
        currentStart = segmentsPlanned[segmentsPlanned.length - 1].start + 1;
      }

      if (actualEnd >= durationSec) break;
    }

    console.log(`📋 Planned ${segmentsPlanned.length} segments`);

    // Process segments with parallel extraction and QC
    const createdKeys = await processSegmentsInParallel(
      segmentsPlanned,
      normalizedPath,
      workDir,
      recordingId,
      targetSr,
      updateProgress,
      performanceMetrics
    );

    performanceMetrics.segments_created = createdKeys.length;
    await updateProgress(95, 'Cleaning up temporary files...');

    // Cleanup
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('⚠️ Cleanup warning:', cleanupErr.message);
    }

    await updateProgress(100, 'Segmentation completed successfully');

    // Calculate final performance metrics
    performanceMetrics.processing_time_ms = Date.now() - startTime;
    const throughputSegmentsPerSec = performanceMetrics.segments_created / (performanceMetrics.processing_time_ms / 1000);
    const compressionRatio = performanceMetrics.total_duration_ms / performanceMetrics.processing_time_ms;

    // Log performance metrics
    console.log(`📊 Segmentation Performance Metrics:
      - Recording ID: ${recordingId}
      - Segments Created: ${performanceMetrics.segments_created}
      - Total Audio Duration: ${(performanceMetrics.total_duration_ms / 1000).toFixed(1)}s
      - Processing Time: ${(performanceMetrics.processing_time_ms / 1000).toFixed(1)}s
      - Throughput: ${throughputSegmentsPerSec.toFixed(2)} segments/sec
      - Compression Ratio: ${compressionRatio.toFixed(1)}x (${compressionRatio > 1 ? 'faster than real-time' : 'slower than real-time'})
      - FFmpeg Operations: ${performanceMetrics.ffmpeg_operations}
      - S3 Uploads: ${performanceMetrics.s3_uploads}
      - DB Operations: ${performanceMetrics.db_operations}`);

    // Store performance metrics in database (optional)
    if (jobId) {
      const dbType = process.env.DB_TYPE || (process.env.SUPABASE_DB_URL ? 'postgres' : 'mysql');

      if (dbType === 'postgres') {
        await db.query(`
          UPDATE job_queue
          SET payload = jsonb_set(payload, '{performance_metrics}', :metrics::jsonb)
          WHERE id = :jobId
        `, {
          replacements: {
            jobId,
            metrics: JSON.stringify(performanceMetrics)
          },
          type: QueryTypes.UPDATE
        });
      } else {
        await db.query(`
          UPDATE job_queue
          SET payload = JSON_SET(payload, '$.performance_metrics', :metrics)
          WHERE id = :jobId
        `, {
          replacements: {
            jobId,
            metrics: JSON.stringify(performanceMetrics)
          },
          type: QueryTypes.UPDATE
        });
      }
    }

    // Return created segments
    const createdSegments = await db.query(`
      SELECT * FROM segments WHERE recording_id = :rid AND s3_key IN (:keys)
      ORDER BY start_ms ASC
    `, {
      replacements: { rid: recordingId, keys: createdKeys },
      type: QueryTypes.SELECT
    });

    return createdSegments;

  } catch (err) {
    console.error('❌ runSegmentationWithProgress error', err);
    if (jobId) {
      err.jobId = jobId; // Attach job ID for error handling
    }
    throw err;
  }
};

// Start segmentation in background and return immediately
export const startSegmentationBackground = async (recordingId, params = {}) => {
  console.log(`🚀 Starting background segmentation for recording ${recordingId}`);

  // Check if already running
  if (activeSegmentations.has(recordingId)) {
    throw new Error('Segmentation already in progress for this recording');
  }

  // Mark as started
  activeSegmentations.set(recordingId, {
    status: 'running',
    progress: 0,
    message: 'Starting segmentation...',
    startTime: Date.now()
  });

  // Start processing in background (don't await)
  runSegmentationDirect(recordingId, params)
    .then(segments => {
      activeSegmentations.set(recordingId, {
        status: 'completed',
        progress: 100,
        message: `Completed: ${segments.length} segments created`,
        startTime: activeSegmentations.get(recordingId)?.startTime || Date.now(),
        segments: segments
      });
      console.log(`✅ Background segmentation completed for recording ${recordingId}: ${segments.length} segments`);
    })
    .catch(error => {
      activeSegmentations.set(recordingId, {
        status: 'failed',
        progress: 0,
        message: `Error: ${error.message}`,
        startTime: activeSegmentations.get(recordingId)?.startTime || Date.now(),
        error: error.message
      });
      console.error(`❌ Background segmentation failed for recording ${recordingId}:`, error);
    });

  return {
    message: 'Segmentation started in background',
    recording_id: recordingId,
    status: 'running'
  };
};

// Get status of background segmentation
export const getSegmentationStatus = (recordingId) => {
  return activeSegmentations.get(recordingId) || null;
};

// Clear completed/failed segmentation status
export const clearSegmentationStatus = (recordingId) => {
  activeSegmentations.delete(recordingId);
};

// Create a single segment for short clips (< 60 seconds)
export const createSingleSegmentForShortClip = async (recordingId, recording) => {
  console.log(`📝 Creating single segment for short clip: recording ${recordingId}`);

  try {
    // Get the audio file URL
    const inputUrl = await getFileUrl(recording.file_path);

    // Probe the audio to get accurate metadata
    const probe = await ffprobeJson(inputUrl);
    const durationSec = parseFloat(probe?.format?.duration || '0');
    const durationMs = Math.round(durationSec * 1000);
    const origSr = parseInt(probe?.streams?.[0]?.sample_rate || '0', 10) || null;
    const channels = parseInt(probe?.streams?.[0]?.channels || '0', 10) || null;
    const bitRate = parseInt(probe?.format?.bit_rate || '0', 10) || null;
    const codecName = probe?.streams?.[0]?.codec_name || null;

    // Update recording metadata
    await db.query(`
      UPDATE recordings SET duration_ms = :durationMs, sample_rate = :sr, channels = :ch, bit_rate = :br, codec_name = :codec
      WHERE id = :id
    `, { replacements: { durationMs, sr: origSr, ch: channels, br: bitRate, codec: codecName, id: recordingId }, type: QueryTypes.UPDATE });

    // Create temporary directory for processing
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'short-clip-'));
    const targetSr = 32000; // Standard sample rate
    const normalizedPath = path.join(workDir, 'normalized.flac');

    // Normalize the audio
    await normalizeToFlac(inputUrl, normalizedPath, targetSr);

    // Perform quality control analysis
    const silencePct = await estimateSilencePct(normalizedPath, -35, 0.5);
    const rmsDb = await estimateRmsDb(normalizedPath);
    const clippingPct = await estimateClippingPct(normalizedPath);

    // Determine QC status
    let qcStatus = 'pass';
    if (silencePct !== null && silencePct >= 80) qcStatus = 'fail';
    if (clippingPct !== null && clippingPct >= 0.5) qcStatus = qcStatus === 'pass' ? 'review' : qcStatus;

    console.log(`📊 QC Analysis for short clip: silence=${silencePct?.toFixed(1)}%, rms=${rmsDb?.toFixed(1)}dB, clipping=${clippingPct?.toFixed(1)}%, status=${qcStatus}`);

    // Stream upload the normalized audio to S3 as the "segment" (no memory spike)
    const segmentKey = `segments/recording-${recordingId}/short_clip_full.flac`;

    if (s3 && BUCKET_NAME) {
      const fileStats = fs.statSync(normalizedPath);
      const fileSize = fileStats.size;

      if (fileSize > 100 * 1024 * 1024) { // > 100MB, use multipart upload
        console.log(`📤 Large short clip (${Math.round(fileSize/1024/1024)}MB) - using multipart upload`);

        const upload = new Upload({
          client: s3,
          params: {
            Bucket: BUCKET_NAME,
            Key: segmentKey,
            Body: fs.createReadStream(normalizedPath),
            ContentType: 'audio/flac',
            ServerSideEncryption: 'AES256'
          },
          partSize: 10 * 1024 * 1024, // 10MB parts
          queueSize: 3 // Max 3 concurrent parts
        });

        await upload.done();
      } else {
        // Regular streaming upload for smaller files
        const fileStream = fs.createReadStream(normalizedPath);
        await s3.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: segmentKey,
          Body: fileStream,
          ContentType: 'audio/flac',
          ServerSideEncryption: 'AES256'
        }));
      }

      console.log(`✅ Uploaded short clip to S3: ${segmentKey}`);
    }

    // Create segment record in database
    const segment = await createSegmentRow(recordingId, segmentKey, 0, durationMs, durationMs, {
      sample_rate: targetSr,
      silence_pct: silencePct,
      clipping_pct: clippingPct,
      rms_db: rmsDb,
      band_energy_low: null,
      band_energy_mid: null,
      band_energy_high: null,
      crest_factor: null,
      qc_status: qcStatus
    });

    // Auto-approve if QC passes
    if (qcStatus === 'pass') {
      await db.query(`
        INSERT INTO segment_approvals (segment_id, status, approved_by, approved_at)
        VALUES (:segmentId, 'approved', NULL, NOW())
        ON CONFLICT (segment_id) DO UPDATE SET status = 'approved', approved_at = NOW(), updated_at = NOW()
      `, { replacements: { segmentId: segment.id }, type: QueryTypes.INSERT });

      console.log(`✅ Short clip auto-approved (QC: ${qcStatus})`);
    } else {
      console.log(`⚠️ Short clip requires review (QC: ${qcStatus})`);
    }

    // Cleanup temporary files
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('⚠️ Failed to cleanup temp directory:', cleanupErr.message);
    }

    console.log(`✅ Single segment created for short clip: ${durationSec}s, QC: ${qcStatus}`);

    return {
      id: segment.id,
      recording_id: recordingId,
      start_ms: 0,
      end_ms: durationMs,
      duration_ms: durationMs,
      s3_key: segmentKey,
      qc_status: qcStatus,
      sample_rate: targetSr,
      silence_pct: silencePct,
      rms_db: rmsDb,
      clipping_pct: clippingPct,
      is_short_clip: true
    };

  } catch (error) {
    console.error('❌ Failed to create single segment for short clip:', error);
    throw error;
  }
};

// Run segmentation immediately for a recording (direct processing)
export const runSegmentationDirect = async (recordingId, params = {}) => {
  console.log(`⚡ Running segmentation immediately for recording ${recordingId}`);

  const startTime = Date.now();
  const performanceMetrics = {
    recording_id: recordingId,
    start_time: startTime,
    segments_created: 0,
    total_duration_ms: 0,
    processing_time_ms: 0,
    ffmpeg_operations: 0,
    s3_uploads: 0,
    db_operations: 0
  };

  // Fetch recording info (including file_path)
  const recRows = await db.query(`SELECT * FROM recordings WHERE id = :id`, { replacements: { id: recordingId }, type: QueryTypes.SELECT });
  if (!recRows || recRows.length === 0) throw new Error('Recording not found');
  const rec = recRows[0];

  try {
    const inputUrl = await getFileUrl(rec.file_path);

    // Probe
    const probe = await ffprobeJson(inputUrl);
    const durationSec = parseFloat(probe?.format?.duration || '0');
    const origSr = parseInt(probe?.streams?.[0]?.sample_rate || '0', 10) || null;
    const channels = parseInt(probe?.streams?.[0]?.channels || '0', 10) || null;
    const bitRate = parseInt(probe?.format?.bit_rate || '0', 10) || null;
    const codecName = probe?.streams?.[0]?.codec_name || null;

    // Save probe to recordings
    await db.query(`
      UPDATE recordings SET duration_ms = :durationMs, sample_rate = :sr, channels = :ch, bit_rate = :br, codec_name = :codec
      WHERE id = :id
    `, { replacements: { durationMs: Math.round(durationSec * 1000), sr: origSr, ch: channels, br: bitRate, codec: codecName, id: recordingId }, type: QueryTypes.UPDATE });

    // Normalize
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seg-'));
    const normalizedPath = path.join(workDir, 'normalized.flac');
    const segLen = params.seg_len_s || 60;
    const overlapPct = params.overlap_pct || 10; // default 10%
    const targetSr = chooseSampleRateFromParams(params);
    await normalizeToFlac(inputUrl, normalizedPath, targetSr);

    // Silence detection for better segmentation quality with adaptive backoff
    const minSilenceDb = -35;
    const minSilenceSec = 0.5;
    
    // FIX: Adaptive backoff based on audio characteristics
    const avgSegmentLength = segLen;
    const backoffSec = Math.min(Math.max(avgSegmentLength * 0.1, 1), 10); // 10% of segment length, min 1s, max 10s
    
    console.log(`🔍 Adaptive silence detection: backoff=${backoffSec.toFixed(1)}s (${(backoffSec/avgSegmentLength*100).toFixed(1)}% of segment length)`);
    const { stderr: sil } = await runCmd(FFMPEG_PATH, ['-i', normalizedPath, '-af', `silencedetect=noise=${minSilenceDb}dB:d=${minSilenceSec}`, '-f', 'null', '-']);
    
    // FIX: Use both silence start and end points for complete boundary detection
    const silenceStarts = [...sil.matchAll(/silence_start: ([0-9.]+)/g)].map(m => parseFloat(m[1])).filter(Number.isFinite);
    const silenceEnds = [...sil.matchAll(/silence_end: ([0-9.]+)/g)].map(m => parseFloat(m[1])).filter(Number.isFinite);
    
    // Combine all silence points for better cut point selection
    const cutPoints = [...silenceStarts, ...silenceEnds].sort((a, b) => a - b);

    const overlapSec = (segLen * overlapPct) / 100;
    const segmentsPlanned = [];
    let t = 0;
    
    while (t < durationSec) {
      const hardEnd = Math.min(durationSec, t + segLen);
      const searchStart = Math.max(t, hardEnd - backoffSec);
      const candidate = cutPoints.filter(cp => cp >= searchStart && cp <= hardEnd).sort((a,b)=>Math.abs(hardEnd - a) - Math.abs(hardEnd - b))[0];
      const segmentEnd = candidate ?? hardEnd;
      segmentsPlanned.push({ start: t, end: segmentEnd });
      
      // FIX: Proper overlap calculation - move back by overlap amount
      t = segmentEnd - overlapSec;
      
      // Ensure we don't go backwards or create infinite loops
      if (t <= segmentsPlanned[segmentsPlanned.length - 1].start) {
        t = segmentsPlanned[segmentsPlanned.length - 1].start + 1;
      }
      
      if (t >= durationSec) break;
      if (durationSec - t < segLen * 0.3) { segmentsPlanned[segmentsPlanned.length - 1].end = durationSec; break; }
    }

    const createdKeys = [];
    for (let i = 0; i < segmentsPlanned.length; i++) {
      const seg = segmentsPlanned[i];
      const outPath = path.join(workDir, `segment_${String(i).padStart(5,'0')}.flac`);
      await runCmd(FFMPEG_PATH, ['-y', '-i', normalizedPath, '-ss', String(seg.start), '-to', String(seg.end), '-c', 'copy', outPath]);

      const meta = await ffprobeJson(outPath);
      const dur = parseFloat(meta?.format?.duration || '0');
      const durMs = Math.round(dur * 1000);
      const startMs = Math.round(seg.start * 1000);
      const endMs = Math.round(seg.end * 1000);

      // Quality control analysis
      const silencePct = await estimateSilencePct(outPath, -35, 0.5);
      const rmsDb = await estimateRmsDb(outPath);
      const clippingPct = await estimateClippingPct(outPath);
      let qcStatus = 'pass';
      if (silencePct !== null && silencePct >= 80) qcStatus = 'fail';
      if (clippingPct !== null && clippingPct >= 0.5) qcStatus = qcStatus === 'pass' ? 'review' : qcStatus;

      const key = `segments/recording-${recordingId}/${path.basename(outPath)}`;
      const body = fs.readFileSync(outPath);
      if (s3 && BUCKET_NAME) {
        const command = new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: body,
          ContentType: 'audio/flac'
        });
        await s3.send(command);
      }

      await createSegmentRow(recordingId, key, startMs, endMs, durMs, {
        sample_rate: targetSr,
        silence_pct: silencePct,
        clipping_pct: clippingPct,
        rms_db: rmsDb,
        band_energy_low: null,
        band_energy_mid: null,
        band_energy_high: null,
        crest_factor: null,
        qc_status: qcStatus
      });

      if (qcStatus === 'pass') {
        await db.query(`
          INSERT INTO segment_approvals (segment_id, status, approved_by, approved_at)
          VALUES ((SELECT id FROM segments WHERE recording_id = :recordingId AND s3_key = :s3Key ORDER BY id DESC LIMIT 1), 'approved', NULL, NOW())
          ON CONFLICT (segment_id) DO UPDATE SET status = 'approved', approved_at = NOW(), updated_at = NOW()
        `, { replacements: { recordingId, s3Key: key }, type: QueryTypes.INSERT });
      }
      createdKeys.push(key);
    }

    // Cleanup temporary files
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('⚠️ Failed to cleanup temp directory:', cleanupErr.message);
    }

    // Return created segments
    const createdSegments = await db.query(`
      SELECT * FROM segments WHERE recording_id = :rid AND s3_key IN (:keys)
      ORDER BY start_ms ASC
    `, { replacements: { rid: recordingId, keys: createdKeys }, type: QueryTypes.SELECT });

    console.log(`✅ Segmentation completed successfully: ${createdSegments.length} segments created`);
    return createdSegments;
  } catch (err) {
    console.error('❌ runSegmentationDirect error', err);

    // Cleanup on error
    try {
      if (workDir && fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('⚠️ Failed to cleanup temp directory on error:', cleanupErr.message);
    }

    throw err;
  }
};

/**
 * Process AED events with cross-segment deduplication
 * Handles overlapping segments to prevent duplicate event detection
 */
export const processAEDEventsWithDeduplication = async (recordingId, segmentIds, progressCallback = null) => {
  try {
    console.log(`🔍 Processing AED events for recording ${recordingId} with ${segmentIds.length} segments...`);

    // Initialize deduplication service
    const dedupService = new AEDDeduplicationService({
      temporalIouThreshold: 0.5,
      frequencyIouThreshold: 0.5,
      overlapWindowMs: 5000, // 5 second overlap window
      confidenceWeight: 0.7
    });

    let totalEvents = 0;
    let totalDuplicates = 0;
    let processedSegments = 0;

    // Process segments in order to handle overlaps properly
    for (let i = 0; i < segmentIds.length; i++) {
      const segmentId = segmentIds[i];

      if (progressCallback) {
        const progress = (processedSegments / segmentIds.length) * 100;
        progressCallback(progress, `Processing AED for segment ${i + 1}/${segmentIds.length}`);
      }

      // Get segment info
      const segment = await db.query(`
        SELECT id, recording_id, s3_key, start_ms, end_ms, duration_ms
        FROM segments
        WHERE id = :segmentId
      `, {
        replacements: { segmentId },
        type: QueryTypes.SELECT
      });

      if (segment.length === 0) {
        console.warn(`⚠️ Segment ${segmentId} not found, skipping AED processing`);
        continue;
      }

      const segmentData = segment[0];

      // TODO: Run AED detection on this segment
      // This would integrate with the AEDDetectorOptimized service
      // For now, we'll simulate some events for testing
      const mockEvents = await simulateAEDEvents(segmentData);

      if (mockEvents.length > 0) {
        // Insert events into database
        const insertedEvents = await insertAEDEvents(mockEvents, recordingId, segmentId);

        // Perform deduplication against previous segments
        if (i > 0) { // Only deduplicate after the first segment
          const dedupResult = await dedupService.deduplicateEvents(insertedEvents, recordingId);
          totalDuplicates += dedupResult.duplicatesFound;

          console.log(`🔗 Segment ${i + 1}: ${insertedEvents.length} events, ${dedupResult.duplicatesFound} duplicates found`);
        } else {
          console.log(`🎵 Segment ${i + 1}: ${insertedEvents.length} events (first segment, no deduplication)`);
        }

        totalEvents += insertedEvents.length;
      }

      processedSegments++;
    }

    // Get final deduplication statistics
    const finalStats = await dedupService.getDeduplicationStats(recordingId);

    console.log(`✅ AED processing complete for recording ${recordingId}:`);
    console.log(`   📊 Total events detected: ${totalEvents}`);
    console.log(`   🔗 Duplicates found: ${totalDuplicates}`);
    console.log(`   ✨ Unique events: ${finalStats.unique_events}`);
    console.log(`   📈 Deduplication rate: ${((totalDuplicates / Math.max(totalEvents, 1)) * 100).toFixed(1)}%`);

    if (progressCallback) {
      progressCallback(100, `AED processing complete: ${finalStats.unique_events} unique events`);
    }

    return {
      totalEvents,
      uniqueEvents: finalStats.unique_events,
      duplicatesFound: totalDuplicates,
      deduplicationRate: (totalDuplicates / Math.max(totalEvents, 1)) * 100,
      stats: finalStats
    };

  } catch (error) {
    console.error('❌ Error processing AED events with deduplication:', error);
    throw error;
  }
};

/**
 * Simulate AED events for testing (replace with actual AED detection)
 */
const simulateAEDEvents = async (segmentData) => {
  // This is a placeholder - in real implementation, this would call AEDDetectorOptimized
  const events = [];
  const segmentDurationMs = segmentData.duration_ms;
  const numEvents = Math.floor(Math.random() * 5) + 1; // 1-5 events per segment

  for (let i = 0; i < numEvents; i++) {
    const startMs = Math.floor(Math.random() * (segmentDurationMs - 1000));
    const durationMs = Math.floor(Math.random() * 2000) + 500; // 0.5-2.5s duration
    const endMs = Math.min(startMs + durationMs, segmentDurationMs);

    events.push({
      start_ms: segmentData.start_ms + startMs, // Convert to recording time
      end_ms: segmentData.start_ms + endMs,     // Convert to recording time
      f_min_hz: Math.floor(Math.random() * 4000) + 1000, // 1-5kHz
      f_max_hz: Math.floor(Math.random() * 4000) + 5000, // 5-9kHz
      confidence: Math.random() * 0.5 + 0.5, // 0.5-1.0
      snr_db: Math.random() * 20 + 5, // 5-25dB
      detection_method: 'energy_hysteresis'
    });
  }

  return events;
};

/**
 * Insert AED events into database and return inserted events with IDs
 */
const insertAEDEvents = async (events, recordingId, segmentId) => {
  if (events.length === 0) return [];

  const values = events.map((event, index) => {
    const baseIndex = index * 9;
    return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9})`;
  }).join(', ');

  const replacements = events.flatMap(event => [
    recordingId,
    segmentId,
    event.start_ms,
    event.end_ms,
    event.f_min_hz,
    event.f_max_hz,
    event.confidence,
    event.snr_db,
    event.detection_method
  ]);

  const result = await db.query(`
    INSERT INTO aed_events (
      recording_id, segment_id, start_ms, end_ms, f_min_hz, f_max_hz,
      confidence, snr_db, detection_method
    ) VALUES ${values}
    RETURNING id, recording_id, segment_id, start_ms, end_ms, f_min_hz, f_max_hz, confidence, snr_db, detection_method
  `, {
    replacements,
    type: QueryTypes.INSERT
  });

  return result[0]; // Return inserted events with IDs
};


