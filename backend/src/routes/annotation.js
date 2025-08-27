import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getRecordingClusters,
  getClusterClips,
  getEventClips,
  createAnnotation,
  submitClipToPublic,
  getProjectAnnotationStats,
  getPublicClips,
  getVolunteerProgress,
  submitVolunteerAnnotation,
  getEventSuggestions,
  createAnnotationWithSuggestions
} from '../controllers/annotationController.js';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);

/**
 * @route GET /api/projects/:projectId/recordings/:recordingId/clusters
 * @desc Get clusters for a recording with annotation status
 * @access Private (Project members)
 */
router.get('/projects/:projectId/recordings/:recordingId/clusters', getRecordingClusters);

/**
 * @route GET /api/projects/:projectId/clusters/:clusterId/clips
 * @desc Get clips for a specific cluster with suggestions
 * @access Private (Project members)
 */
router.get('/projects/:projectId/clusters/:clusterId/clips', getClusterClips);

/**
 * @route GET /api/projects/:projectId/events/:eventId/clips
 * @desc Get clips for a specific event
 * @access Private (Project members)
 */
router.get('/projects/:projectId/events/:eventId/clips', getEventClips);

/**
 * @route POST /api/projects/:projectId/clips/:eventId/annotate
 * @desc Create annotation for a clip
 * @access Private (Project members)
 */
router.post('/projects/:projectId/clips/:eventId/annotate', createAnnotation);

/**
 * @route POST /api/projects/:projectId/clips/:eventId/annotate-with-suggestions
 * @desc Create annotation with suggestion voting and region boxing
 * @access Private (Project members)
 */
router.post('/projects/:projectId/clips/:eventId/annotate-with-suggestions', createAnnotationWithSuggestions);

/**
 * @route GET /api/projects/:projectId/events/:eventId/suggestions
 * @desc Get BirdNet suggestions for an event
 * @access Private (Project members)
 */
router.get('/projects/:projectId/events/:eventId/suggestions', getEventSuggestions);

/**
 * @route POST /api/projects/:projectId/clips/:eventId/submit-to-public
 * @desc Submit clip to public annotation platform
 * @access Private (Project members)
 */
router.post('/projects/:projectId/clips/:eventId/submit-to-public', submitClipToPublic);

/**
 * @route GET /api/projects/:projectId/annotation-stats
 * @desc Get annotation statistics for a project
 * @access Private (Project members)
 */
router.get('/projects/:projectId/annotation-stats', getProjectAnnotationStats);

/**
 * @route GET /api/projects/:projectId/public-clips
 * @desc Get clips available for public annotation
 * @access Private (Project members)
 */
router.get('/projects/:projectId/public-clips', getPublicClips);

/**
 * @route GET /api/annotation/volunteer/progress
 * @desc Get volunteer progress and statistics
 * @access Private (Authenticated users)
 */
router.get('/volunteer/progress', getVolunteerProgress);

/**
 * @route POST /api/annotation/volunteer/submit
 * @desc Submit volunteer annotation
 * @access Private (Authenticated users)
 */
router.post('/volunteer/submit', submitVolunteerAnnotation);

export default router;
