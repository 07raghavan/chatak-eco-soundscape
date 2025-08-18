import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { uploadToS3, deleteFromS3, getFileUrl, isS3Configured } from '../config/s3.js';
import { parseBuffer } from 'music-metadata';

// Get all recordings for a project
export const getRecordings = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && !isS3Configured) {
      return res.status(503).json({
        error: 'S3 is not configured for signed URLs in production. Set AWS_S3_BUCKET_NAME, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.'
      });
    }
    const { projectId } = req.params;
    const userId = req.user.id;

    // Verify project ownership
    const projectCheck = await db.query(
      'SELECT id FROM projects WHERE id = :projectId AND user_id = :userId',
      {
        replacements: { projectId, userId },
        type: QueryTypes.SELECT
      }
    );

    if (projectCheck.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get recordings with site information
    const recordings = await db.query(`
      SELECT 
        r.id,
        r.name,
        r.description,
        r.file_path,
        r.file_size,
        r.duration_seconds,
        r.recording_date,
        r.status,
        r.created_at,
        r.updated_at,
        s.name as site_name,
        s.latitude as site_latitude,
        s.longitude as site_longitude
      FROM recordings r
      JOIN sites s ON r.site_id = s.id
      WHERE r.project_id = :projectId
      ORDER BY r.created_at DESC
    `, {
      replacements: { projectId },
      type: QueryTypes.SELECT
    });

    // Add file URLs to recordings
    const recordingsWithUrls = await Promise.all(recordings.map(async (recording) => ({
      ...recording,
      file_url: await getFileUrl(recording.file_path)
    })));

    res.json({ recordings: recordingsWithUrls });
  } catch (error) {
    console.error('❌ Get recordings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Upload new recording
export const uploadRecording = async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production' && !isS3Configured) {
      return res.status(503).json({
        error: 'S3 is not configured for signed URLs in production. Set AWS_S3_BUCKET_NAME, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.'
      });
    }
    const { projectId } = req.params;
    const { name, description, siteId, recordingDate } = req.body;
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    // Validate file type
    const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/m4a', 'audio/flac'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ 
        error: 'Invalid file type. Only WAV, MP3, M4A, and FLAC files are allowed.' 
      });
    }

    // Verify project ownership
    const projectCheck = await db.query(
      'SELECT id FROM projects WHERE id = :projectId AND user_id = :userId',
      {
        replacements: { projectId, userId },
        type: QueryTypes.SELECT
      }
    );

    if (projectCheck.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Verify site belongs to project
    const siteCheck = await db.query(
      'SELECT id FROM sites WHERE id = :siteId AND project_id = :projectId',
      {
        replacements: { siteId, projectId },
        type: QueryTypes.SELECT
      }
    );

    if (siteCheck.length === 0) {
      return res.status(400).json({ error: 'Invalid site selected' });
    }

    console.log('📤 Starting file upload...');
    console.log(`📁 File: ${req.file.originalname}`);
    console.log(`📏 Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

    // Upload to S3 with progress tracking
    const uploadResult = await uploadToS3(
      req.file, 
      projectId, 
      siteId,
      (progress) => {
        // Send progress updates via WebSocket or Server-Sent Events in the future
        console.log(`📊 Upload progress: ${progress}%`);
        
        // Add more detailed logging for large files
        if (req.file.size > 50 * 1024 * 1024) { // 50MB
          const uploadedMB = (req.file.size * progress / 100 / 1024 / 1024).toFixed(2);
          const totalMB = (req.file.size / 1024 / 1024).toFixed(2);
          console.log(`📈 Uploaded: ${uploadedMB}MB / ${totalMB}MB (${progress}%)`);
        }
      }
    );

    console.log('✅ File upload completed');
    console.log(`📂 File path: ${uploadResult.filePath}`);
    try {
      const playableUrl = await getFileUrl(uploadResult.filePath);
      console.log(`🎵 Playable URL: ${playableUrl}`);
    } catch (e) {
      console.error('❌ Failed to generate playable URL:', e);
    }

    // Get basic audio metadata using music-metadata for immediate availability
    let durationSeconds = null;
    let durationMs = null;
    let sampleRate = null;
    let channels = null;
    let codecName = null;
    let bitRate = null;
    
    try {
      const metadata = await parseBuffer(req.file.buffer, req.file.mimetype);
      if (metadata?.format?.duration) {
        durationSeconds = Math.round(metadata.format.duration);
        durationMs = Math.round(metadata.format.duration * 1000);
      }
      if (metadata?.format?.sampleRate) {
        sampleRate = metadata.format.sampleRate;
      }
      if (metadata?.format?.numberOfChannels) {
        channels = metadata.format.numberOfChannels;
      }
      if (metadata?.format?.codec) {
        codecName = metadata.format.codec;
      }
      if (metadata?.format?.bitrate) {
        bitRate = metadata.format.bitrate;
      }
      
      console.log(`⏱️  Audio metadata: ${durationSeconds}s, ${sampleRate}Hz, ${channels}ch, ${codecName}`);
    } catch (error) {
      console.error('⚠️  Error getting audio metadata:', error);
      // Will be extracted precisely later by segmentation worker using ffprobe
    }

    // Create recording record with metadata
    const result = await db.query(`
      INSERT INTO recordings (
        name, description, file_path, file_size, duration_seconds, duration_ms,
        sample_rate, channels, codec_name, bit_rate, recording_date, site_id, project_id, status
      ) VALUES (
        :name, :description, :filePath, :fileSize, :durationSeconds, :durationMs,
        :sampleRate, :channels, :codecName, :bitRate, :recordingDate, :siteId, :projectId, 'completed'
      ) RETURNING *
    `, {
      replacements: {
        name: name || req.file.originalname,
        description: description || '',
        filePath: uploadResult.filePath,
        fileSize: req.file.size,
        durationSeconds,
        durationMs,
        sampleRate,
        channels,
        codecName,
        bitRate,
        recordingDate: recordingDate || new Date().toISOString(),
        siteId,
        projectId
      },
      type: QueryTypes.INSERT
    });

    const recording = result[0][0];

    console.log('✅ Recording uploaded successfully:', recording.id);

    res.status(201).json({
      message: 'Recording uploaded successfully',
      recording: {
        ...recording,
        status: 'completed',
        file_url: await getFileUrl(uploadResult.filePath)
      }
    });

  } catch (error) {
    console.error('❌ Upload recording error:', error);
    res.status(500).json({ error: 'Failed to upload recording' });
  }
};

// Removed ffmpeg-based duration helper (replaced by music-metadata)

// Delete recording
export const deleteRecording = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Get recording with project info
    const recording = await db.query(`
      SELECT r.*, p.user_id as project_user_id 
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, {
      replacements: { recordingId },
      type: QueryTypes.SELECT
    });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recording[0].project_user_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log('🗑️  Deleting recording:', recordingId);

    // Delete from S3 or local storage
    await deleteFromS3(recording[0].file_path);

    // Delete from database
    await db.query(
      'DELETE FROM recordings WHERE id = :recordingId',
      {
        replacements: { recordingId },
        type: QueryTypes.DELETE
      }
    );

    console.log('✅ Recording deleted successfully');

    res.json({ message: 'Recording deleted successfully' });

  } catch (error) {
    console.error('❌ Delete recording error:', error);
    res.status(500).json({ error: 'Failed to delete recording' });
  }
};

// Get recording details
export const getRecording = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    const recording = await db.query(`
      SELECT 
        r.*,
        s.name as site_name,
        s.latitude as site_latitude,
        s.longitude as site_longitude,
        p.name as project_name
      FROM recordings r
      JOIN sites s ON r.site_id = s.id
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId AND p.user_id = :userId
    `, {
      replacements: { recordingId, userId },
      type: QueryTypes.SELECT
    });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    const recordingWithUrl = {
      ...recording[0],
      file_url: await getFileUrl(recording[0].file_path)
    };

    res.json({ recording: recordingWithUrl });

  } catch (error) {
    console.error('❌ Get recording error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 