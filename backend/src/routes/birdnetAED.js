import express from 'express';
import { 
  analyzeRecordingWithAED,
  getAEDEvents,
  getAEDEvent,
  getAEDStatus,
  deleteAEDEvents
} from '../controllers/birdnetAEDController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// BirdNet AED Routes

// Analyze recording with BirdNet AED
// POST /api/recordings/:recordingId/aed
router.post('/recordings/:recordingId/aed', analyzeRecordingWithAED);

// Get AED events for a recording
// GET /api/recordings/:recordingId/aed
router.get('/recordings/:recordingId/aed', getAEDEvents);

// Get AED analysis status for a recording
// GET /api/recordings/:recordingId/aed/status
router.get('/recordings/:recordingId/aed/status', getAEDStatus);

// Delete AED events for a recording
// DELETE /api/recordings/:recordingId/aed
router.delete('/recordings/:recordingId/aed', deleteAEDEvents);

// Get specific AED event with snippet
// GET /api/aed/events/:eventId
router.get('/aed/events/:eventId', getAEDEvent);

export default router;
