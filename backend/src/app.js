import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import projectRoutes from './routes/projects.js';
import siteRoutes from './routes/sites.js';
import recordingRoutes from './routes/recordings.js';
import segmentationRoutes from './routes/segmentation.js';
import aedRoutes from './routes/aed.js';
import spectrogramRoutes from './routes/spectrogram.js';
import fastSpectrogramRoutes from './routes/fastSpectrogram.js';

// Load environment variables
dotenv.config();

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration (provider-agnostic)
const defaultOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:8080',
  'http://localhost:3000'
];
const envOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const allowedOrigins = envOrigins.length > 0 ? envOrigins : defaultOrigins;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // allow non-browser tools
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from uploads directory (dev/local only)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Local audio streaming (not used on serverless prod)
app.get('/audio/:projectId/:siteId/:filename', (req, res) => {
  const { projectId, siteId, filename } = req.params;
  const filePath = path.join(process.cwd(), 'uploads', `project-${projectId}`, `site-${siteId}`, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Audio file not found' });
  }

  const lower = filename.toLowerCase();
  let contentType = 'application/octet-stream';
  if (lower.endsWith('.mp3')) contentType = 'audio/mpeg';
  else if (lower.endsWith('.wav')) contentType = 'audio/wav';
  else if (lower.endsWith('.m4a')) contentType = 'audio/mp4';
  else if (lower.endsWith('.flac')) contentType = 'audio/flac';

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
      return res.end();
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.pipe(res);
    stream.on('error', () => res.status(500).end());
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType
    });
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => res.status(500).end());
  }
});

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
app.use('/api', aedRoutes);
app.use('/api', spectrogramRoutes);
app.use('/api', fastSpectrogramRoutes);

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

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found', path: req.originalUrl, method: req.method });
});

export default app;




