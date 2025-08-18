import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import jwt from 'jsonwebtoken';
import {
  createSegmentationJob,
  getSegmentationJobs,
  getSegmentationJobStatus,
  streamSegmentationProgress,
  getSegmentsForRecording,
  getSegmentationPresets,
  getBackgroundSegmentationStatus,
  clearBackgroundSegmentationStatus
} from '../controllers/segmentationController.js';
import { approveSegment, rejectSegment } from '../controllers/segmentApprovalController.js';

const router = express.Router();

// Special authentication middleware for SSE that supports query parameter tokens
const authenticateSSE = (req, res, next) => {
  try {
    // Try to get token from query parameter (for EventSource)
    const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Presets for frequency ranges (birds/animals/bats)
router.get('/segmentation/presets', authenticateToken, getSegmentationPresets);

// Create a segmentation job for a recording
router.post('/recordings/:recordingId/segmentation/jobs', authenticateToken, createSegmentationJob);

// List segmentation jobs for a recording
router.get('/recordings/:recordingId/segmentation/jobs', authenticateToken, getSegmentationJobs);

// Get status of a specific segmentation job
router.get('/segmentation/jobs/:jobId/status', authenticateToken, getSegmentationJobStatus);

// Stream real-time progress for a segmentation job
router.get('/segmentation/jobs/:jobId/progress', authenticateSSE, streamSegmentationProgress);

// List segments for a recording
router.get('/recordings/:recordingId/segments', authenticateToken, getSegmentsForRecording);

// Manual review actions
router.post('/segments/:segmentId/approve', authenticateToken, approveSegment);
router.post('/segments/:segmentId/reject', authenticateToken, rejectSegment);

// Background segmentation status
router.get('/recordings/:recordingId/segmentation/status', authenticateToken, getBackgroundSegmentationStatus);
router.delete('/recordings/:recordingId/segmentation/status', authenticateToken, clearBackgroundSegmentationStatus);

export default router;

