import express from 'express';
import { body } from 'express-validator';
import { 
  createSite, 
  getSites, 
  getSite, 
  updateSite, 
  deleteSite 
} from '../controllers/siteController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Validation middleware
const validateCreateSite = [
  body('name').trim().isLength({ min: 2 }).withMessage('Site name must be at least 2 characters'),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be less than 500 characters')
];

const validateUpdateSite = [
  body('name').optional().trim().isLength({ min: 2 }).withMessage('Site name must be at least 2 characters'),
  body('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
  body('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),
  body('description').optional().trim().isLength({ max: 500 }).withMessage('Description must be less than 500 characters')
];

// Routes - all routes are prefixed with /projects/:projectId/sites
router.post('/projects/:projectId/sites', authenticateToken, validateCreateSite, createSite);
router.get('/projects/:projectId/sites', authenticateToken, getSites);
router.get('/sites/:siteId', authenticateToken, getSite);
router.put('/sites/:siteId', authenticateToken, validateUpdateSite, updateSite);
router.delete('/sites/:siteId', authenticateToken, deleteSite);

export default router; 