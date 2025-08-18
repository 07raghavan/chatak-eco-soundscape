import express from 'express';
import { body } from 'express-validator';
import { 
  createProject, 
  getProjects, 
  getProject, 
  updateProject, 
  deleteProject 
} from '../controllers/projectController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Validation middleware
const validateCreateProject = [
  body('name').trim().isLength({ min: 3 }).withMessage('Project name must be at least 3 characters'),
  body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
  body('start_date').notEmpty().withMessage('Start date is required'),
  body('end_date').optional().notEmpty().withMessage('End date must not be empty if provided'),
  body('is_ongoing').optional().isBoolean().withMessage('is_ongoing must be a boolean')
];

const validateUpdateProject = [
  body('name').optional().trim().isLength({ min: 3 }).withMessage('Project name must be at least 3 characters'),
  body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
  body('start_date').optional().notEmpty().withMessage('Start date must not be empty if provided'),
  body('end_date').optional().notEmpty().withMessage('End date must not be empty if provided'),
  body('is_ongoing').optional().isBoolean().withMessage('is_ongoing must be a boolean'),
  body('status').optional().isIn(['active', 'paused', 'completed']).withMessage('Status must be active, paused, or completed')
];

// Routes
router.post('/', authenticateToken, validateCreateProject, createProject);
router.get('/', authenticateToken, getProjects);
router.get('/:id', authenticateToken, getProject);
router.put('/:id', authenticateToken, validateUpdateProject, updateProject);
router.delete('/:id', authenticateToken, deleteProject);

export default router; 