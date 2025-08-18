import express from 'express';
import { body } from 'express-validator';
import { register, login, googleAuth, getProfile } from '../controllers/authController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Validation middleware
const validateRegistration = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').trim().isLength({ min: 2 }),
  body('organization').optional().trim()
];

const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

const validateGoogleAuth = [
  body('credential').notEmpty()
];

// Routes
router.post('/register', validateRegistration, register);
router.post('/login', validateLogin, login);
router.post('/google', validateGoogleAuth, googleAuth);
router.get('/profile', authenticateToken, getProfile);

export default router; 