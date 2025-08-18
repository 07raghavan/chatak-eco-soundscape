import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getApprovedSegments, enqueueAEDForRecording, getAEDEventsForSegment, getAEDEventsForRecording, runAEDNow, runIndustryAEDForRecording, runOptimizedAEDForRecording, processAEDWithDeduplication, getDeduplicationStats, triggerDeduplication } from '../controllers/aedController.js';

const router = express.Router();

router.use(authenticateToken);

// List approved segments for a recording
router.get('/recordings/:recordingId/approved-segments', getApprovedSegments);

// Enqueue AED for all approved segments in a recording
router.post('/recordings/:recordingId/aed/enqueue', enqueueAEDForRecording);

// List AED events for a segment
router.get('/segments/:segmentId/aed-events', getAEDEventsForSegment);

// Run AED synchronously for selected segments
router.post('/recordings/:recordingId/aed/run-now', runAEDNow);

// NEW: Run industry-standard AED for entire recording
router.post('/recordings/:recordingId/aed/industry-standard', runIndustryAEDForRecording);

// NEW: Run optimized high-speed AED for entire recording (with progress streaming)
router.post('/recordings/:recordingId/aed/optimized', runOptimizedAEDForRecording);

// List AED events for a recording
router.get('/recordings/:recordingId/aed-events', getAEDEventsForRecording);

// === CROSS-SEGMENT DEDUPLICATION ROUTES ===

// Process AED with cross-segment deduplication
router.post('/recordings/:recordingId/aed/with-deduplication', processAEDWithDeduplication);

// Get deduplication statistics for a recording
router.get('/recordings/:recordingId/deduplication/stats', getDeduplicationStats);

// Manually trigger deduplication for existing events
router.post('/recordings/:recordingId/deduplication/trigger', triggerDeduplication);

export default router;

