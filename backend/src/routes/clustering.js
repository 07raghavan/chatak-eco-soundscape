import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  startAudioClustering,
  getClusteringResults,
  getClusteringStatus,
  deleteClustering,
  getEventsForRecording,
  getEventSnippet
} from '../controllers/audioClusteringController.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * Audio Clustering Routes
 * 
 * POST   /api/recordings/:recordingId/clustering     - Start audio clustering
 * GET    /api/recordings/:recordingId/clustering     - Get clustering results
 * GET    /api/recordings/:recordingId/clustering/status - Get clustering status
 * DELETE /api/recordings/:recordingId/clustering     - Delete clustering results
 */

// Start audio clustering for a recording
router.post('/recordings/:recordingId/clustering', startAudioClustering);

// Get clustering results for a recording
router.get('/recordings/:recordingId/clustering', getClusteringResults);

// Get clustering status for a recording
router.get('/recordings/:recordingId/clustering/status', getClusteringStatus);

// Delete clustering results for a recording
router.delete('/recordings/:recordingId/clustering', deleteClustering);

// Get events for a recording (for preview)
router.get('/recordings/:recordingId/events', getEventsForRecording);

// Get audio snippet for an event
router.get('/recordings/:recordingId/events/:eventId/snippet', getEventSnippet);

export default router;
