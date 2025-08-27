import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';

// Import routes
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import siteRoutes from './routes/sites.js';
import recordingRoutes from './routes/recordings.js';
import segmentationRoutes from './routes/segmentation.js';
import aedRoutes from './routes/aed.js';
import birdnetAEDRoutes from './routes/birdnetAED.js';
import spectrogramRoutes from './routes/spectrogram.js';
import fastSpectrogramRoutes from './routes/fastSpectrogram.js';
import annotationRoutes from './routes/annotation.js';
import clusteringRoutes from './routes/clustering.js';

// Import services
import { getFileUrl } from './config/s3.js';
import { db } from './config/database.js';
import { QueryTypes } from 'sequelize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      mediaSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  }
}));

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static file serving
app.use('/uploads', express.static(join(__dirname, '../uploads')));
app.use('/audio', express.static(join(__dirname, '../audio')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), environment: process.env.NODE_ENV });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api', siteRoutes);
app.use('/api', recordingRoutes);
app.use('/api', segmentationRoutes);
app.use('/api/aed', aedRoutes);
app.use('/api', birdnetAEDRoutes);
app.use('/api', spectrogramRoutes);
app.use('/api', fastSpectrogramRoutes);
app.use('/api/annotation', annotationRoutes);
app.use('/api', clusteringRoutes);

// =====================================================
// SPECTROGRAM GENERATION ENDPOINTS
// =====================================================

// Generate spectrogram for an audio event
app.post('/api/spectrogram/generate/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { width = 1000, height = 600, fmin = 0, fmax = 8000 } = req.body;
    
    console.log(`🎵 Generating spectrogram for event ${eventId}`);
    
    // Import spectrogram service dynamically to avoid circular imports
    const { getOrGenerateSpectrogram } = await import('./services/spectrogramService.js');
    
    // Get event details and generate spectrogram
    const result = await getOrGenerateSpectrogram(eventId, req.body.projectId, req.user.id);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error });
    }
    
  } catch (error) {
    console.error('❌ Error generating spectrogram:', error);
    res.status(500).json({ error: error.message });
  }
});

// =====================================================
// AUDIO SNIPPET ENDPOINTS FOR AED EVENTS
// =====================================================

// Get audio snippet for an AED event
app.get('/api/audio/snippet/:s3Key', async (req, res) => {
  try {
    const { s3Key } = req.params;
    
    if (!s3Key) {
      return res.status(400).json({ 
        success: false, 
        error: 'S3 key is required' 
      });
    }

    console.log(`🎵 Requesting audio snippet: ${s3Key}`);

    // Generate signed URL for the audio snippet
    const signedUrl = await getFileUrl(s3Key);
    
    if (!signedUrl) {
      return res.status(404).json({ 
        success: false, 
        error: 'Audio snippet not found' 
      });
    }

    // Redirect to the signed URL for direct audio streaming
    res.redirect(signedUrl);

  } catch (error) {
    console.error('❌ Error getting audio snippet:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get signed URL for audio segment (for AED event playback)
app.get('/api/audio/segment/:s3Key', async (req, res) => {
  try {
    const { s3Key } = req.params;
    
    if (!s3Key) {
      return res.status(400).json({ 
        success: false, 
        error: 'S3 key is required' 
      });
    }

    console.log(`🎵 Requesting audio segment: ${s3Key}`);

    // Generate signed URL for the audio segment
    const signedUrl = await getFileUrl(s3Key);
    
    if (!signedUrl) {
      return res.status(404).json({ 
        success: false, 
        error: 'Audio segment not found' 
      });
    }

    // Return the signed URL for the frontend to use
    res.json({
      success: true,
      signedUrl: signedUrl,
      s3Key: s3Key,
      expiresIn: 3600
    });

  } catch (error) {
    console.error('❌ Error getting audio segment:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Test endpoints
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

app.get('/api/test-audio/:projectId/:siteId/:filename', (req, res) => {
  const { projectId, siteId, filename } = req.params;
  const filePath = path.join(process.cwd(), 'uploads', `project-${projectId}`, `site-${siteId}`, filename);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    res.json({
      exists: true,
      filePath: filePath,
      size: stats.size,
      url: `/audio/${projectId}/${siteId}/${filename}`,
      staticUrl: `/uploads/project-${projectId}/site-${siteId}/${filename}`
    });
  } else {
    res.status(404).json({ exists: false, filePath: filePath, error: 'File not found' });
  }
});

export default app;