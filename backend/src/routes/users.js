import express from 'express';
import { body } from 'express-validator';
import { updateProfile, getProfile } from '../controllers/userController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Validation middleware
const validateProfileUpdate = [
  body('name').optional().trim().isLength({ min: 2 }),
  body('organization').optional().trim()
];

// Routes
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, validateProfileUpdate, updateProfile);

export default router; 