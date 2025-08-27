import express from 'express';
import multer from 'multer';
import { body } from 'express-validator';
import { authenticateToken } from '../middleware/auth.js';
import {
  getRecordings,
  uploadRecording,
  deleteRecording,
  getRecording,
  getAllRecordings
} from '../controllers/recordingController.js';
import {
  generateSegmentSpectrograms,
  getSegmentSpectrograms,
  getApprovedSegmentsForSpectrogram
} from '../controllers/fastSpectrogramController.js';
import {
  generatePresignedUpload,
  completeMultipartUpload,
  confirmUpload,
  abortUpload,
  processMetadata,
  getRecordingsWithMissingMetadata
} from '../controllers/uploadController.js';

const router = express.Router();

// Configure multer for memory storage (for S3 uploads)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 * 1024, // 2GB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    const allowedTypes = ['audio/wav', 'audio/mp3', 'audio/m4a', 'audio/flac'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only WAV, MP3, M4A, and FLAC files are allowed.'), false);
    }
  }
});

// Validation middleware
const validateUploadRecording = [
  body('name').optional().isLength({ min: 1, max: 255 }).withMessage('Name must be between 1 and 255 characters'),
  body('description').optional().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
  body('siteId').isInt().withMessage('Site ID must be a valid integer'),
  body('recordingDate').optional().isISO8601().withMessage('Recording date must be a valid date')
];

// Routes
router.get('/recordings', authenticateToken, getAllRecordings);
router.get('/projects/:projectId/recordings', authenticateToken, getRecordings);
router.get('/recordings/:recordingId', authenticateToken, getRecording);

router.post(
  '/projects/:projectId/recordings/upload',
  authenticateToken,
  upload.single('audioFile'),
  validateUploadRecording,
  uploadRecording
);

router.delete('/recordings/:recordingId', authenticateToken, deleteRecording);

// === NEW DIRECT S3 UPLOAD ROUTES ===

// Generate pre-signed URL for direct S3 upload
router.post('/projects/:projectId/sites/:siteId/upload/presigned', authenticateToken, [
  body('filename').notEmpty().withMessage('Filename is required'),
  body('fileSize').isInt({ min: 1 }).withMessage('Valid file size is required'),
  body('contentType').optional().isString()
], generatePresignedUpload);

// Complete multipart upload
router.post('/upload/:uploadId/complete', authenticateToken, [
  body('parts').isArray().withMessage('Parts array is required'),
  body('checksum').optional().isString()
], completeMultipartUpload);

// Confirm simple upload completion
router.post('/upload/:uploadId/confirm', authenticateToken, [
  body('etag').notEmpty().withMessage('ETag is required'),
  body('checksum').optional().isString()
], confirmUpload);

// Abort upload
router.delete('/upload/:uploadId', authenticateToken, abortUpload);

// === METADATA PROCESSING ROUTES ===

// Process metadata for a specific recording
router.post('/recordings/:recordingId/metadata', authenticateToken, processMetadata);

// Get recordings with missing metadata
router.get('/recordings/missing-metadata', authenticateToken, getRecordingsWithMissingMetadata);

// === SEGMENT SPECTROGRAM ROUTES ===

// Generate segment spectrograms
router.post('/recordings/:recordingId/segment-spectrograms/generate', authenticateToken, generateSegmentSpectrograms);

// Get segment spectrograms
router.get('/recordings/:recordingId/segment-spectrograms', authenticateToken, getSegmentSpectrograms);

// Get approved segments for spectrogram generation
router.get('/recordings/:recordingId/approved-segments', authenticateToken, getApprovedSegmentsForSpectrogram);

export default router;