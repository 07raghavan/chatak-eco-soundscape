import { apiRequest } from './api';

// Supported audio formats
const SUPPORTED_FORMATS = ['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wma'];

// Upload progress callback type
export type UploadProgressCallback = (progress: {
  loaded: number;
  total: number;
  percentage: number;
  stage: 'preparing' | 'uploading' | 'completing' | 'completed';
  message: string;
}) => void;

// Upload result type
export interface UploadResult {
  success: boolean;
  recordingId?: number;
  s3Key?: string;
  error?: string;
}

// Calculate SHA256 checksum for file integrity
const calculateSHA256 = async (data: ArrayBuffer): Promise<string> => {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

// Validate file before upload
const validateFile = (file: File): { valid: boolean; error?: string } => {
  // Check file extension
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return {
      valid: false,
      error: `Unsupported file format. Supported: ${SUPPORTED_FORMATS.join(', ')}`
    };
  }

  // Check file size (max 500MB)
  const maxSize = 500 * 1024 * 1024;
  if (file.size > maxSize) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${Math.round(maxSize / 1024 / 1024)}MB`
    };
  }

  return { valid: true };
};

// Simple upload for smaller files (< 100MB)
const performSimpleUpload = async (
  file: File,
  presignedPost: any,
  onProgress: UploadProgressCallback
): Promise<{ etag: string; checksum: string }> => {
  
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    
    // Add all the presigned post fields
    Object.keys(presignedPost.fields).forEach(key => {
      formData.append(key, presignedPost.fields[key]);
    });
    
    // Add the file last
    formData.append('file', file);
    
    const xhr = new XMLHttpRequest();
    
    // Track upload progress
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percentage,
          stage: 'uploading',
          message: `Uploading... ${percentage}%`
        });
      }
    });
    
    xhr.addEventListener('load', async () => {
      if (xhr.status === 204) {
        // S3 returns 204 for successful uploads
        const etag = xhr.getResponseHeader('ETag')?.replace(/"/g, '') || '';
        
        // Calculate checksum for integrity verification
        const arrayBuffer = await file.arrayBuffer();
        const checksum = await calculateSHA256(arrayBuffer);
        
        resolve({ etag, checksum });
      } else {
        reject(new Error(`Upload failed with status: ${xhr.status}`));
      }
    });
    
    xhr.addEventListener('error', () => {
      reject(new Error('Upload failed due to network error'));
    });
    
    xhr.open('POST', presignedPost.url);
    xhr.send(formData);
  });
};

// Multipart upload for larger files (≥ 100MB)
const performMultipartUpload = async (
  file: File,
  uploadData: any,
  onProgress: UploadProgressCallback
): Promise<{ parts: Array<{ partNumber: number; etag: string; checksum: string }>, checksum: string }> => {

  const { partUrls, partSize, totalParts } = uploadData;
  const parts: Array<{ partNumber: number; etag: string; checksum: string }> = [];

  let totalUploaded = 0;

  // Upload each part
  for (let i = 0; i < totalParts; i++) {
    const partNumber = i + 1;
    const start = i * partSize;
    const end = Math.min(start + partSize, file.size);
    const partData = file.slice(start, end);

    // Upload part (simplified - no checksum headers)
    const response = await fetch(partUrls[i].signedUrl, {
      method: 'PUT',
      body: partData
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Part ${partNumber} upload failed:`, response.status, errorText);
      throw new Error(`Failed to upload part ${partNumber}: ${response.status} - ${errorText}`);
    }

    const etag = response.headers.get('ETag')?.replace(/"/g, '') || '';
    if (!etag) {
      throw new Error(`No ETag received for part ${partNumber}`);
    }

    parts.push({ partNumber, etag, checksum: null }); // No checksum for simplicity

    totalUploaded += partData.size;
    const percentage = Math.round((totalUploaded / file.size) * 100);

    onProgress({
      loaded: totalUploaded,
      total: file.size,
      percentage,
      stage: 'uploading',
      message: `Uploading part ${partNumber}/${totalParts}... ${percentage}%`
    });
  }

  // Calculate overall file checksum
  const fileArrayBuffer = await file.arrayBuffer();
  const fileChecksum = await calculateSHA256(fileArrayBuffer);

  return { parts, checksum: fileChecksum };
};

// Main upload function
export const uploadAudioFile = async (
  file: File,
  projectId: number,
  siteId: number,
  description?: string,
  recordingDate?: string,
  onProgress?: UploadProgressCallback
): Promise<UploadResult> => {
  
  const progress = onProgress || (() => {});
  
  try {
    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }
    
    progress({
      loaded: 0,
      total: file.size,
      percentage: 0,
      stage: 'preparing',
      message: 'Preparing upload...'
    });
    
    // Request pre-signed URL
    const uploadRequest = await apiRequest(`/api/projects/${projectId}/sites/${siteId}/upload/presigned`, {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        fileSize: file.size,
        contentType: file.type || 'application/octet-stream',
        description: description || '',
        recordingDate: recordingDate || null
      })
    });
    
    progress({
      loaded: 0,
      total: file.size,
      percentage: 5,
      stage: 'uploading',
      message: 'Starting upload...'
    });
    
    let uploadResult: { etag: string; checksum: string };
    
    if (uploadRequest.uploadType === 'simple') {
      // Simple upload for smaller files
      uploadResult = await performSimpleUpload(file, uploadRequest.presignedPost, progress);

      // Calculate file checksum for integrity verification
      const fileArrayBuffer = await file.arrayBuffer();
      const fileChecksum = await calculateSHA256(fileArrayBuffer);

      // Confirm upload completion
      await apiRequest(`/api/upload/${uploadRequest.uploadId}/confirm`, {
        method: 'POST',
        body: JSON.stringify({
          etag: uploadResult.etag,
          checksum: fileChecksum
        })
      });
      
    } else if (uploadRequest.uploadType === 'multipart') {
      // Multipart upload for larger files
      const multipartResult = await performMultipartUpload(file, uploadRequest, progress);

      progress({
        loaded: file.size,
        total: file.size,
        percentage: 95,
        stage: 'completing',
        message: 'Completing upload...'
      });

      // Calculate overall file checksum for integrity verification
      const fileArrayBuffer = await file.arrayBuffer();
      const fileChecksum = await calculateSHA256(fileArrayBuffer);

      // Complete multipart upload with actual parts data
      await apiRequest(`/api/upload/${uploadRequest.uploadId}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          parts: multipartResult.parts,
          checksum: fileChecksum
        })
      });

      uploadResult = { etag: 'multipart-completed', checksum: multipartResult.checksum };
    }
    
    progress({
      loaded: file.size,
      total: file.size,
      percentage: 100,
      stage: 'completed',
      message: 'Upload completed successfully!'
    });
    
    return {
      success: true,
      recordingId: uploadRequest.recordingId,
      s3Key: uploadRequest.s3Key
    };
    
  } catch (error: any) {
    console.error('Upload failed:', error);
    
    // Try to abort the upload if it was initiated
    try {
      if (error.uploadId) {
        await apiRequest(`/api/upload/${error.uploadId}`, { method: 'DELETE' });
      }
    } catch (abortError) {
      console.error('Failed to abort upload:', abortError);
    }
    
    return {
      success: false,
      error: error.message || 'Upload failed'
    };
  }
};

// Utility function to format file size
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// Utility function to get file extension
export const getFileExtension = (filename: string): string => {
  return '.' + filename.split('.').pop()?.toLowerCase() || '';
};

// Check if file format is supported
export const isFileSupported = (filename: string): boolean => {
  const ext = getFileExtension(filename);
  return SUPPORTED_FORMATS.includes(ext);
};
