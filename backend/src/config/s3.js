import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Resolve AWS credentials from either CHATAK_* or standard AWS_* env vars
const ACCESS_KEY_ID = process.env.CHATAK_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.CHATAK_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
const AWS_REGION = process.env.CHATAK_AWS_REGION || process.env.AWS_REGION || 'us-east-1';

// Check if AWS credentials are configured
const isS3Configured = Boolean(ACCESS_KEY_ID && SECRET_ACCESS_KEY);

let s3 = null;
let BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'chatak-audio-recordings';

if (isS3Configured) {
  // Create S3 client with AWS SDK v3
  s3 = new S3Client({
    region: AWS_REGION,
    credentials: {
      accessKeyId: ACCESS_KEY_ID,
      secretAccessKey: SECRET_ACCESS_KEY,
    },
  });

  console.log('✅ S3 configured successfully');
  console.log(`📦 S3 Bucket: ${BUCKET_NAME}`);
  console.log(`🌍 AWS Region: ${AWS_REGION}`);
} else {
  console.log('⚠️  S3 credentials not configured. Will use public S3 URL (if bucket is public) or local fallback.');
  console.log(`📦 S3 Bucket (from env if set): ${BUCKET_NAME || 'N/A'}`);
}

// Configure S3 for multipart uploads (for large files)
const s3Config = {
  bucket: BUCKET_NAME,
  region: process.env.CHATAK_AWS_REGION || 'us-east-1',
  // Enable multipart uploads for files larger than 5MB
  multipartThreshold: 5 * 1024 * 1024,
  // Part size for multipart uploads (5MB)
  partSize: 5 * 1024 * 1024,
  // Enable concurrent uploads
  concurrentRequestLimit: 10
};

// Generate unique file path for audio recordings
const generateAudioFilePath = (projectId, siteId, fileName) => {
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `recordings/project-${projectId}/site-${siteId}/${timestamp}-${sanitizedFileName}`;
};

// Upload file to S3 with progress tracking
const uploadToS3 = async (file, projectId, siteId, onProgress) => {
  const filePath = generateAudioFilePath(projectId, siteId, file.originalname);

  if (isS3Configured && s3) {
    // Upload to S3 using AWS SDK v3
    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: filePath,
      Body: file.buffer,
      ContentType: file.mimetype,
      Metadata: {
        'project-id': projectId.toString(),
        'site-id': siteId.toString(),
        'original-name': file.originalname,
        'file-size': file.size.toString(),
        'upload-date': new Date().toISOString()
      }
    };

    try {
      const upload = new Upload({
        client: s3,
        params: uploadParams,
      });

      upload.on('httpUploadProgress', (progress) => {
        if (onProgress && progress.total) {
          const percentage = Math.round((progress.loaded / progress.total) * 100);
          onProgress(percentage);
        }
      });

      const data = await upload.done();
      console.log('✅ File uploaded to S3:', data.Key);
      return {
        filePath: data.Key,
        url: data.Location,
        etag: data.ETag
      };
    } catch (err) {
      console.error('❌ S3 upload error:', err);
      throw err;
    }
  } else {
    // Fallback to local storage for development
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const projectDir = path.join(uploadsDir, `project-${projectId}`);
    const siteDir = path.join(projectDir, `site-${siteId}`);
    
    // Create directories if they don't exist
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });
    if (!fs.existsSync(siteDir)) fs.mkdirSync(siteDir, { recursive: true });
    
    const fileName = `${Date.now()}-${file.originalname}`;
    const localFilePath = path.join(siteDir, fileName);
    
    // Simulate progress for large files
    if (onProgress) {
      const fileSize = file.buffer.length;
      const chunkSize = Math.max(1024 * 1024, Math.floor(fileSize / 20)); // 1MB chunks or 20 chunks
      let processed = 0;
      
      // Simulate progress in chunks
      const writeChunks = () => {
        const chunk = file.buffer.slice(processed, processed + chunkSize);
        fs.appendFileSync(localFilePath, chunk);
        processed += chunk.length;
        
        const percentage = Math.round((processed / fileSize) * 100);
        onProgress(percentage);
        
        if (processed < fileSize) {
          // Continue with next chunk
          setTimeout(writeChunks, 50); // 50ms delay between chunks
        } else {
          // Complete
          onProgress(100);
        }
      };
      
      // Start writing chunks
      writeChunks();
    } else {
      // Write file to local storage immediately
      fs.writeFileSync(localFilePath, file.buffer);
    }
    
    console.log('📁 File saved locally:', localFilePath);
    
    return {
      filePath: `project-${projectId}/site-${siteId}/${fileName}`,
      url: `/uploads/project-${projectId}/site-${siteId}/${fileName}`,
      etag: 'local-storage'
    };
  }
};

// Get signed URL for direct upload (for very large files)
const getSignedUploadUrl = async (projectId, siteId, fileName, contentType) => {
  if (!isS3Configured || !s3) {
    throw new Error('S3 is not configured. Please set up AWS credentials.');
  }

  const filePath = generateAudioFilePath(projectId, siteId, fileName);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: filePath,
    ContentType: contentType,
    Metadata: {
      'project-id': projectId.toString(),
      'site-id': siteId.toString(),
      'original-name': fileName
    }
  });

  return await getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour
};

// Delete file from S3 or local storage
const deleteFromS3 = async (filePath) => {
  if (isS3Configured && s3) {
    // Delete from S3 using AWS SDK v3
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: filePath
    });

    try {
      const result = await s3.send(command);
      console.log('✅ File deleted from S3:', filePath);
      return result;
    } catch (error) {
      console.error('❌ Error deleting from S3:', error);
      throw error;
    }
  } else {
    // Delete from local storage
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('✅ File deleted locally:', filePath);
    }
    return Promise.resolve();
  }
};

// Batch delete helper for S3 (more efficient when removing many objects)
const deleteManyFromS3 = async (filePaths = []) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return;

  if (isS3Configured && s3) {
    // S3 deleteObjects supports up to 1000 keys per request
    const chunkSize = 1000;
    for (let i = 0; i < filePaths.length; i += chunkSize) {
      const chunk = filePaths.slice(i, i + chunkSize).map((key) => ({ Key: key }));
      const command = new DeleteObjectsCommand({
        Bucket: BUCKET_NAME,
        Delete: { Objects: chunk, Quiet: true }
      });
      try {
        await s3.send(command);
        console.log(`✅ Deleted ${chunk.length} objects from S3`);
      } catch (error) {
        console.error('❌ Error batch deleting from S3:', error);
        throw error;
      }
    }
  } else {
    // Local fallback
    for (const key of filePaths) {
      if (fs.existsSync(key)) {
        try { fs.unlinkSync(key); } catch (_) {}
      }
    }
  }
};

// Check if S3 is actually accessible
const checkS3Access = async () => {
  if (!isS3Configured || !s3) {
    return false;
  }

  try {
    // Try to list objects in the bucket to check access
    const command = new ListObjectsCommand({ Bucket: BUCKET_NAME, MaxKeys: 1 });
    await s3.send(command);
    console.log('✅ S3 access confirmed');
    return true;
  } catch (error) {
    console.log('❌ S3 access failed:', error.message);
    return false;
  }
};

// Get file URL (strict: signed URLs in production; dev fallback only in non-production)
const getFileUrl = async (filePath) => {
  console.log('🔗 Generating file URL for:', filePath);

  // If S3 is configured, return a signed GET URL for secure playback
  if (isS3Configured && s3 && BUCKET_NAME) {
    try {
      const expiresSeconds = parseInt(process.env.S3_SIGNED_URL_EXPIRES || '86400'); // 24h

      // Infer content type from file extension
      let responseContentType = 'application/octet-stream';
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.mp3')) responseContentType = 'audio/mpeg';
      else if (lower.endsWith('.wav')) responseContentType = 'audio/wav';
      else if (lower.endsWith('.m4a')) responseContentType = 'audio/mp4';
      else if (lower.endsWith('.flac')) responseContentType = 'audio/flac';

      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: filePath,
        ResponseContentType: responseContentType
      });
      const signed = await getSignedUrl(s3, command, { expiresIn: expiresSeconds });
      console.log('✅ Generated S3 signed URL');
      return signed;
    } catch (err) {
      console.error('❌ Failed to generate S3 signed URL:', err.message);
    }
  }

  // Strict mode: in production, never return public/local; throw if misconfigured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('S3 is not properly configured for signed URLs in production');
  }

  // Non-production dev fallback: local streaming URL (for local testing only)
  const pathMatch = filePath.match(/project-(\d+)\/site-(\d+)\/(.+)/);
  if (pathMatch) {
    const [, projectId, siteId, filename] = pathMatch;
    return `/audio/${projectId}/${siteId}/${encodeURIComponent(filename)}`;
  }
  return `/uploads/${filePath}`;
};

// Get signed URL for audio snippets with optimized settings
const getAudioSnippetUrl = async (snippetKey) => {
  console.log('🎵 Generating signed URL for audio snippet:', snippetKey);

  if (isS3Configured && s3 && BUCKET_NAME) {
    try {
      // Shorter expiration for snippets (1 hour) since they're smaller and more frequently accessed
      const expiresSeconds = parseInt(process.env.S3_SNIPPET_URL_EXPIRES || '3600'); // 1 hour

      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: snippetKey,
        ResponseContentType: 'audio/wav',
        ResponseCacheControl: 'public, max-age=1800' // Cache for 30 minutes
      });
      
      const signedUrl = await getSignedUrl(s3, command, { expiresIn: expiresSeconds });
      console.log('✅ Generated signed URL for audio snippet');
      return signedUrl;
    } catch (err) {
      console.error('❌ Failed to generate signed URL for audio snippet:', err.message);
      throw err;
    }
  }

  // Fallback for non-S3 environments
  if (process.env.NODE_ENV === 'production') {
    throw new Error('S3 is not properly configured for audio snippets in production');
  }

  // Development fallback
  return `/api/aed/audio-snippets/${encodeURIComponent(snippetKey)}`;
};

// Download file by key to a local path; when S3 is not configured, read from local uploads
const downloadFile = async (s3Key, localPath) => {
  const localSource = path.join(process.cwd(), 'uploads', s3Key);
  if (!isS3Configured || !s3) {
    // Fallback to local file system copy
    if (!fs.existsSync(localSource)) {
      throw new Error(`Local source not found for key ${s3Key} at ${localSource}`);
    }
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.copyFileSync(localSource, localPath);
    return;
  }

  const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key });
  try {
    const response = await s3.send(command);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    const writeStream = fs.createWriteStream(localPath);

    return new Promise((resolve, reject) => {
      response.Body.on('error', reject);
      writeStream.on('error', reject);
      writeStream.on('finish', resolve);
      response.Body.pipe(writeStream);
    });
  } catch (error) {
    throw error;
  }
};

// Upload file from local path to S3
const uploadFile = async (localPath, s3Key) => {
  if (!isS3Configured || !s3) {
    console.warn('S3 not configured, skipping upload');
    return { Location: `local://${localPath}` };
  }

  const fileBuffer = fs.readFileSync(localPath);
  
  // Detect content type from file extension
  let contentType = 'application/octet-stream';
  const lower = localPath.toLowerCase();
  if (lower.endsWith('.png')) contentType = 'image/png';
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) contentType = 'image/jpeg';
  else if (lower.endsWith('.gif')) contentType = 'image/gif';
  else if (lower.endsWith('.webp')) contentType = 'image/webp';
  else if (lower.endsWith('.pdf')) contentType = 'application/pdf';
  else if (lower.endsWith('.mp3')) contentType = 'audio/mpeg';
  else if (lower.endsWith('.wav')) contentType = 'audio/wav';
  else if (lower.endsWith('.flac')) contentType = 'audio/flac';
  
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: contentType
  });

  try {
    const result = await s3.send(command);
    console.log(`✅ Uploaded ${localPath} to S3: ${s3Key}`);
    return { Location: `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/${s3Key}`, ETag: result.ETag };
  } catch (error) {
    console.error(`❌ Failed to upload ${localPath} to S3:`, error);
    throw error;
  }
};

export {
  s3,
  BUCKET_NAME,
  uploadToS3,
  getSignedUploadUrl,
  deleteFromS3,
  deleteManyFromS3,
  generateAudioFilePath,
  isS3Configured,
  getFileUrl,
  checkS3Access,
  downloadFile,
  uploadFile,
  getAudioSnippetUrl
}; 