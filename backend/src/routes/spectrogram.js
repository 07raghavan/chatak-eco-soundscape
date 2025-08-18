import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getSpectrogramIndex, generateSpectrogram, getSpectrogramStatus, getSpectrogramTile, getAEDEventsForViewport, getTilesForViewport, getTileByCoordinates } from '../controllers/spectrogramController.js';

const router = express.Router();

router.use(authenticateToken);

// Spectrogram pyramid endpoints
router.get('/recordings/:recordingId/spectrogram', getSpectrogramIndex);
router.post('/recordings/:recordingId/spectrogram/generate', generateSpectrogram);
router.get('/recordings/:recordingId/spectrogram/status', getSpectrogramStatus);
router.get('/recordings/:recordingId/spectrogram/tiles/:zoom/:x/:y', getSpectrogramTile);

// AED events for ROI display in spectrogram
router.get('/recordings/:recordingId/viewport-events', getAEDEventsForViewport);

// === TILED SPECTROGRAM PYRAMID ROUTES ===

// Get tiles for viewport (optimized for smooth scrolling)
router.get('/recordings/:recordingId/tiles', getTilesForViewport);

// Get individual tile by coordinates
router.get('/recordings/:recordingId/tiles/:zoom/:tileX/:tileY', getTileByCoordinates);

export default router;
