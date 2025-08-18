import {
  pollAndRunSegmentation,
  startSegmentationWorkerLoop,
  stopSegmentationWorkerLoop,
  getWorkerStatus
} from '../services/segmentationWorker.js';

// Run a single iteration of the segmentation worker
export const runSegmentationOnce = async (req, res) => {
  try {
    await pollAndRunSegmentation();
    return res.json({ status: 'ok', message: 'Segmentation worker polled and processed up to one job (if queued).' });
  } catch (err) {
    console.error('runSegmentationOnce error', err);
    return res.status(500).json({ status: 'error', error: String(err) });
  }
};

// Run a single iteration of the AED worker (now uses queue system)
export const runAEDOnce = async (req, res) => {
  // AED background worker removed in this build
  return res.json({ status: 'ok', message: 'AED background worker disabled in this build.' });
};

// Start the segmentation worker loop
export const startWorker = async (req, res) => {
  try {
    const { intervalMs = 5000 } = req.body;
    startSegmentationWorkerLoop(intervalMs);
    return res.json({ status: 'ok', message: 'Segmentation worker started', intervalMs });
  } catch (err) {
    console.error('startWorker error', err);
    return res.status(500).json({ status: 'error', error: String(err) });
  }
};

// Stop the segmentation worker loop
export const stopWorker = async (req, res) => {
  try {
    stopSegmentationWorkerLoop();
    return res.json({ status: 'ok', message: 'Segmentation worker stopped' });
  } catch (err) {
    console.error('stopWorker error', err);
    return res.status(500).json({ status: 'error', error: String(err) });
  }
};

// Get worker status
export const getWorkerStatusEndpoint = async (req, res) => {
  try {
    const status = getWorkerStatus();
    return res.json({ status: 'ok', worker: status });
  } catch (err) {
    console.error('getWorkerStatus error', err);
    return res.status(500).json({ status: 'error', error: String(err) });
  }
};


