import { s3, BUCKET_NAME, getFileUrl } from '../config/s3.js';
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import crypto from 'crypto';
import path from 'path';
import { spawn } from 'child_process';

// Supported audio formats with proper MIME types
const SUPPORTED_FORMATS = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.wma': 'audio/x-ms-wma'
};

// Path to FFprobe binary
const FFPROBE_PATH = path.join(process.cwd(), 'bin', 'ffprobe.exe');

// Helper: run a command and collect stdout
const runCmd = (cmd, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  child.on('close', code => {
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

// Generate S3 key with proper structure
const generateS3Key = (projectId, siteId, recordingId, filename, type = 'raw') => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  const ext = path.extname(filename).toLowerCase();
  const baseName = path.basename(filename, ext);
  
  if (type === 'raw') {
    return `raw/project-${projectId}/site-${siteId}/device-default/${year}/${month}/${day}/${recordingId}.orig${ext}`;
  } else if (type === 'normalized') {
    return `normalized/recording-${recordingId}.flac`;
  }
  
  return `${type}/recording-${recordingId}/${baseName}${ext}`;
};

// Detect content type from file extension
const getContentType = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  return SUPPORTED_FORMATS[ext] || 'application/octet-stream';
};

// Generate pre-signed URL for direct upload
export const generatePresignedUpload = async (req, res) => {
  try {
    const { projectId, siteId } = req.params;
    const { filename, fileSize, contentType, description, recordingDate } = req.body;
    const userId = req.user.id;

    // Validate project ownership
    const projectCheck = await db.query(`
      SELECT id FROM projects WHERE id = :projectId AND user_id = :userId
    `, { replacements: { projectId, userId }, type: QueryTypes.SELECT });

    if (projectCheck.length === 0) {
      return res.status(403).json({ error: 'Access denied to project' });
    }

    // Validate site exists in project
    const siteCheck = await db.query(`
      SELECT id FROM sites WHERE id = :siteId AND project_id = :projectId
    `, { replacements: { siteId, projectId }, type: QueryTypes.SELECT });

    if (siteCheck.length === 0) {
      return res.status(404).json({ error: 'Site not found in project' });
    }

    // Validate file format
    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_FORMATS[ext]) {
      return res.status(400).json({ 
        error: 'Unsupported file format',
        supported: Object.keys(SUPPORTED_FORMATS)
      });
    }

    // Validate file size (max 500MB)
    const maxSize = 500 * 1024 * 1024; // 500MB
    if (fileSize > maxSize) {
      return res.status(400).json({ 
        error: 'File too large',
        maxSize: maxSize,
        receivedSize: fileSize
      });
    }

    // Generate recording ID
    const recordingId = Date.now();
    
    // Generate S3 key
    const s3Key = generateS3Key(projectId, siteId, recordingId, filename, 'raw');
    
    // Detect proper content type
    const detectedContentType = contentType || getContentType(filename);
    
    // Generate checksum for integrity
    const uploadId = crypto.randomUUID();
    
    // Determine upload strategy based on file size
    const multipartThreshold = 100 * 1024 * 1024; // 100MB
    
    if (fileSize > multipartThreshold) {
      // Use multipart upload for large files
      const multipartUpload = await s3.send(new CreateMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        ContentType: detectedContentType,
        ServerSideEncryption: 'AES256',
        // Removed ChecksumAlgorithm to avoid checksum validation issues
        Metadata: {
          'original-filename': filename,
          'upload-id': uploadId,
          'project-id': projectId.toString(),
          'site-id': siteId.toString(),
          'recording-id': recordingId.toString(),
          'uploaded-by': userId.toString()
        }
      }));

      // Calculate part size (minimum 5MB, maximum 100MB)
      // AWS requires minimum 5MB per part (except last part)
      const minPartSize = 5 * 1024 * 1024; // 5MB
      const maxPartSize = 100 * 1024 * 1024; // 100MB
      const maxParts = 10000; // AWS limit

      let partSize = Math.max(minPartSize, Math.ceil(fileSize / maxParts));
      partSize = Math.min(partSize, maxPartSize);

      const totalParts = Math.ceil(fileSize / partSize);

      console.log(`📊 Multipart upload calculation:`, {
        fileSize,
        partSize,
        totalParts,
        fileSizeMB: Math.round(fileSize / 1024 / 1024),
        partSizeMB: Math.round(partSize / 1024 / 1024)
      });

      // Generate pre-signed URLs for each part
      const partUrls = [];
      for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
        const command = new UploadPartCommand({
          Bucket: BUCKET_NAME,
          Key: s3Key,
          PartNumber: partNumber,
          UploadId: multipartUpload.UploadId
          // Removed ChecksumAlgorithm to avoid unsigned header issues
        });

        const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
        partUrls.push({
          partNumber,
          signedUrl,
          partSize: partNumber === totalParts ? fileSize - (partNumber - 1) * partSize : partSize
        });
      }

      // Store upload metadata in database
      await db.query(`
        INSERT INTO upload_sessions (
          upload_id, recording_id, project_id, site_id, user_id,
          filename, file_size, content_type, s3_key, upload_type,
          multipart_upload_id, total_parts, status, description, recording_date
        ) VALUES (
          :uploadId, :recordingId, :projectId, :siteId, :userId,
          :filename, :fileSize, :contentType, :s3Key, 'multipart',
          :multipartUploadId, :totalParts, 'initiated', :description, :recordingDate
        )
      `, {
        replacements: {
          uploadId,
          recordingId,
          projectId,
          siteId,
          userId,
          filename,
          fileSize,
          contentType: detectedContentType,
          s3Key,
          multipartUploadId: multipartUpload.UploadId,
          totalParts,
          description: description || '',
          recordingDate: recordingDate || null
        },
        type: QueryTypes.INSERT
      });

      res.json({
        uploadType: 'multipart',
        uploadId,
        recordingId,
        s3Key,
        multipartUploadId: multipartUpload.UploadId,
        partUrls,
        partSize,
        totalParts,
        expiresIn: 3600
      });

    } else {
      // Use simple pre-signed POST for smaller files
      const { createPresignedPost } = await import('@aws-sdk/s3-presigned-post');
      
      const presignedPost = await createPresignedPost(s3, {
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Fields: {
          'Content-Type': detectedContentType,
          'x-amz-server-side-encryption': 'AES256',
          'x-amz-checksum-algorithm': 'SHA256',
          'x-amz-meta-original-filename': filename,
          'x-amz-meta-upload-id': uploadId,
          'x-amz-meta-project-id': projectId.toString(),
          'x-amz-meta-site-id': siteId.toString(),
          'x-amz-meta-recording-id': recordingId.toString(),
          'x-amz-meta-uploaded-by': userId.toString()
        },
        Conditions: [
          ['content-length-range', 0, fileSize],
          ['eq', '$Content-Type', detectedContentType]
        ],
        Expires: 3600 // 1 hour
      });

      // Store upload metadata
      await db.query(`
        INSERT INTO upload_sessions (
          upload_id, recording_id, project_id, site_id, user_id,
          filename, file_size, content_type, s3_key, upload_type, status,
          description, recording_date
        ) VALUES (
          :uploadId, :recordingId, :projectId, :siteId, :userId,
          :filename, :fileSize, :contentType, :s3Key, 'simple', 'initiated',
          :description, :recordingDate
        )
      `, {
        replacements: {
          uploadId,
          recordingId,
          projectId,
          siteId,
          userId,
          filename,
          fileSize,
          contentType: detectedContentType,
          s3Key,
          description: description || '',
          recordingDate: recordingDate || null
        },
        type: QueryTypes.INSERT
      });

      res.json({
        uploadType: 'simple',
        uploadId,
        recordingId,
        s3Key,
        presignedPost,
        expiresIn: 3600
      });
    }

  } catch (error) {
    console.error('❌ Error generating presigned upload:', error);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
};

// Complete multipart upload
export const completeMultipartUpload = async (req, res) => {
  try {
    const { uploadId } = req.params;
    const { parts, checksum } = req.body;
    const userId = req.user.id;

    // Get upload session
    const session = await db.query(`
      SELECT * FROM upload_sessions 
      WHERE upload_id = :uploadId AND user_id = :userId AND status = 'initiated'
    `, { replacements: { uploadId, userId }, type: QueryTypes.SELECT });

    if (session.length === 0) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    const uploadSession = session[0];

    // Complete multipart upload
    const completeCommand = new CompleteMultipartUploadCommand({
      Bucket: BUCKET_NAME,
      Key: uploadSession.s3_key,
      UploadId: uploadSession.multipart_upload_id,
      MultipartUpload: {
        Parts: parts.map(part => ({
          ETag: part.etag,
          PartNumber: part.partNumber
          // Removed ChecksumSHA256 to avoid validation issues
        }))
      }
      // Removed ChecksumSHA256 to avoid validation issues
    });

    const result = await s3.send(completeCommand);

    // Update upload session
    await db.query(`
      UPDATE upload_sessions 
      SET status = 'completed', completed_at = NOW(), etag = :etag
      WHERE upload_id = :uploadId
    `, { 
      replacements: { uploadId, etag: result.ETag },
      type: QueryTypes.UPDATE 
    });

    // Create recording record
    await createRecordingRecord(uploadSession, result.ETag);

    res.json({
      success: true,
      recordingId: uploadSession.recording_id,
      s3Key: uploadSession.s3_key,
      etag: result.ETag
    });

  } catch (error) {
    console.error('❌ Error completing multipart upload:', error);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
};

// Confirm simple upload completion
export const confirmUpload = async (req, res) => {
  try {
    const { uploadId } = req.params;
    const { etag, checksum } = req.body;
    const userId = req.user.id;

    // Get upload session
    const session = await db.query(`
      SELECT * FROM upload_sessions 
      WHERE upload_id = :uploadId AND user_id = :userId
    `, { replacements: { uploadId, userId }, type: QueryTypes.SELECT });

    if (session.length === 0) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    const uploadSession = session[0];

    // Update upload session
    await db.query(`
      UPDATE upload_sessions
      SET status = 'completed', completed_at = NOW(), etag = :etag, checksum = :checksum
      WHERE upload_id = :uploadId
    `, {
      replacements: { uploadId, etag, checksum: checksum || null },
      type: QueryTypes.UPDATE
    });

    // Create recording record
    await createRecordingRecord(uploadSession, etag);

    res.json({
      success: true,
      recordingId: uploadSession.recording_id,
      s3Key: uploadSession.s3_key
    });

  } catch (error) {
    console.error('❌ Error confirming upload:', error);
    res.status(500).json({ error: 'Failed to confirm upload' });
  }
};

// Extract audio metadata from uploaded file
const extractAudioMetadata = async (s3Key) => {
  try {
    console.log(`📊 Extracting metadata for: ${s3Key}`);

    // Get the file URL for analysis
    const fileUrl = await getFileUrl(s3Key);

    // Use FFprobe to extract metadata
    const probe = await ffprobeJson(fileUrl);

    if (!probe || !probe.format) {
      console.warn(`⚠️ No metadata found for ${s3Key}`);
      return null;
    }

    // Extract key metadata
    const duration = parseFloat(probe.format.duration || '0');
    const durationMs = Math.round(duration * 1000);
    const sampleRate = parseInt(probe.streams?.[0]?.sample_rate || '0', 10) || null;
    const channels = parseInt(probe.streams?.[0]?.channels || '0', 10) || null;
    const bitRate = parseInt(probe.format.bit_rate || '0', 10) || null;
    const codecName = probe.streams?.[0]?.codec_name || null;

    console.log(`✅ Metadata extracted: ${duration.toFixed(2)}s, ${sampleRate}Hz, ${channels}ch, ${codecName}`);

    return {
      duration_ms: durationMs,
      sample_rate: sampleRate,
      channels: channels,
      bit_rate: bitRate,
      codec_name: codecName
    };

  } catch (error) {
    console.error(`❌ Failed to extract metadata for ${s3Key}:`, error);
    return null;
  }
};

// Helper function to create recording record with metadata
const createRecordingRecord = async (uploadSession, etag) => {
  console.log(`💾 Creating recording record for: ${uploadSession.filename}`);

  // First, create the basic recording record with all available fields
  await db.query(`
    INSERT INTO recordings (
      id, name, description, file_path, file_size,
      project_id, site_id, status, etag, content_type,
      checksum, upload_session_id, recording_date,
      created_at
    ) VALUES (
      :recordingId, :filename, :description, :s3Key, :fileSize,
      :projectId, :siteId, 'uploaded', :etag, :contentType,
      :checksum, :uploadSessionId, :recordingDate,
      NOW()
    )
  `, {
    replacements: {
      recordingId: uploadSession.recording_id,
      filename: uploadSession.filename,
      description: uploadSession.description || '',
      s3Key: uploadSession.s3_key,
      fileSize: uploadSession.file_size,
      projectId: uploadSession.project_id,
      siteId: uploadSession.site_id,
      etag,
      contentType: uploadSession.content_type,
      checksum: uploadSession.checksum || null,
      uploadSessionId: uploadSession.upload_id,
      recordingDate: uploadSession.recording_date || null
    },
    type: QueryTypes.INSERT
  });

  // Extract and update metadata asynchronously
  try {
    const metadata = await extractAudioMetadata(uploadSession.s3_key);

    if (metadata) {
      await db.query(`
        UPDATE recordings SET
          duration_ms = :durationMs,
          duration_seconds = :durationSeconds,
          sample_rate = :sampleRate,
          channels = :channels,
          bit_rate = :bitRate,
          codec_name = :codecName,
          status = 'processed'
        WHERE id = :recordingId
      `, {
        replacements: {
          recordingId: uploadSession.recording_id,
          durationMs: metadata.duration_ms,
          durationSeconds: Math.round(metadata.duration_ms / 1000), // Convert ms to seconds
          sampleRate: metadata.sample_rate,
          channels: metadata.channels,
          bitRate: metadata.bit_rate,
          codecName: metadata.codec_name
        },
        type: QueryTypes.UPDATE
      });

      console.log(`✅ Recording metadata updated for ID: ${uploadSession.recording_id}`);
    } else {
      // Mark as uploaded but metadata extraction failed
      await db.query(`
        UPDATE recordings SET status = 'metadata_failed' WHERE id = :recordingId
      `, {
        replacements: { recordingId: uploadSession.recording_id },
        type: QueryTypes.UPDATE
      });

      console.warn(`⚠️ Metadata extraction failed for recording: ${uploadSession.recording_id}`);
    }

  } catch (metadataError) {
    console.error(`❌ Metadata extraction error for recording ${uploadSession.recording_id}:`, metadataError);

    // Mark as uploaded but metadata extraction failed
    await db.query(`
      UPDATE recordings SET status = 'metadata_failed' WHERE id = :recordingId
    `, {
      replacements: { recordingId: uploadSession.recording_id },
      type: QueryTypes.UPDATE
    });
  }
};

// Abort multipart upload
export const abortUpload = async (req, res) => {
  try {
    const { uploadId } = req.params;
    const userId = req.user.id;

    // Get upload session
    const session = await db.query(`
      SELECT * FROM upload_sessions
      WHERE upload_id = :uploadId AND user_id = :userId
    `, { replacements: { uploadId, userId }, type: QueryTypes.SELECT });

    if (session.length === 0) {
      return res.status(404).json({ error: 'Upload session not found' });
    }

    const uploadSession = session[0];

    // Abort multipart upload if it exists
    if (uploadSession.multipart_upload_id) {
      await s3.send(new AbortMultipartUploadCommand({
        Bucket: BUCKET_NAME,
        Key: uploadSession.s3_key,
        UploadId: uploadSession.multipart_upload_id
      }));
    }

    // Update upload session
    await db.query(`
      UPDATE upload_sessions
      SET status = 'aborted', completed_at = NOW()
      WHERE upload_id = :uploadId
    `, { replacements: { uploadId }, type: QueryTypes.UPDATE });

    res.json({ success: true });

  } catch (error) {
    console.error('❌ Error aborting upload:', error);
    res.status(500).json({ error: 'Failed to abort upload' });
  }
};

// Process metadata for recordings that failed metadata extraction
export const processMetadata = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Check if user owns this recording
    const recording = await db.query(`
      SELECT r.*, p.user_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId AND p.user_id = :userId
    `, { replacements: { recordingId, userId }, type: QueryTypes.SELECT });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found or access denied' });
    }

    const recordingData = recording[0];

    // Extract metadata
    const metadata = await extractAudioMetadata(recordingData.file_path);

    if (!metadata) {
      return res.status(500).json({ error: 'Failed to extract metadata' });
    }

    // Update recording with metadata
    await db.query(`
      UPDATE recordings SET
        duration_ms = :durationMs,
        sample_rate = :sampleRate,
        channels = :channels,
        bit_rate = :bitRate,
        codec_name = :codecName,
        status = 'processed'
      WHERE id = :recordingId
    `, {
      replacements: {
        recordingId,
        durationMs: metadata.duration_ms,
        sampleRate: metadata.sample_rate,
        channels: metadata.channels,
        bitRate: metadata.bit_rate,
        codecName: metadata.codec_name
      },
      type: QueryTypes.UPDATE
    });

    res.json({
      success: true,
      metadata: {
        duration_ms: metadata.duration_ms,
        sample_rate: metadata.sample_rate,
        channels: metadata.channels,
        bit_rate: metadata.bit_rate,
        codec_name: metadata.codec_name
      }
    });

  } catch (error) {
    console.error('❌ Error processing metadata:', error);
    res.status(500).json({ error: 'Failed to process metadata' });
  }
};

// Get recordings with missing metadata
export const getRecordingsWithMissingMetadata = async (req, res) => {
  try {
    const userId = req.user.id;

    const recordings = await db.query(`
      SELECT r.id, r.name, r.file_path, r.status, r.created_at
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE p.user_id = :userId
        AND (r.status = 'metadata_failed' OR r.duration_ms IS NULL)
      ORDER BY r.created_at DESC
    `, { replacements: { userId }, type: QueryTypes.SELECT });

    res.json({
      recordings: recordings,
      count: recordings.length
    });

  } catch (error) {
    console.error('❌ Error getting recordings with missing metadata:', error);
    res.status(500).json({ error: 'Failed to get recordings' });
  }
};
