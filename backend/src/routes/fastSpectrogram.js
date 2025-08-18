import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { 
  generateFastSpectrogram, 
  getFastSpectrogram,
  generateSegmentSpectrograms,
  getSegmentSpectrograms
} from '../controllers/fastSpectrogramController.js';

const router = express.Router();

router.use(authenticateToken);

// Generate fast spectrogram with AED ROI overlays (for full recordings)
router.post('/recordings/:recordingId/fast-spectrogram/generate', generateFastSpectrogram);

// Get existing fast spectrogram (for full recordings)
router.get('/recordings/:recordingId/fast-spectrogram', getFastSpectrogram);

// Generate spectrograms for all segments of a recording
router.post('/recordings/:recordingId/segment-spectrograms/generate', generateSegmentSpectrograms);

// Get segment spectrograms for a recording
router.get('/recordings/:recordingId/segment-spectrograms', getSegmentSpectrograms);

export default router;
