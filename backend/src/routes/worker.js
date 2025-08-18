import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  runSegmentationOnce,
  runAEDOnce,
  startWorker,
  stopWorker,
  getWorkerStatusEndpoint
} from '../controllers/workerController.js';

const router = express.Router();

// Protect these endpoints
router.use(authenticateToken);

// On-demand worker polls
router.post('/workers/segmentation/poll-once', runSegmentationOnce);
router.post('/workers/aed/poll-once', runAEDOnce);

// Worker management
router.post('/workers/segmentation/start', startWorker);
router.post('/workers/segmentation/stop', stopWorker);
router.get('/workers/segmentation/status', getWorkerStatusEndpoint);

export default router;


