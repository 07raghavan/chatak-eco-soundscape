import dotenv from 'dotenv';
import sequelize, { testConnection } from './config/database.js';
import { validateJWTConfig } from './services/jwtService.js';
import { validateGoogleConfig } from './services/googleAuth.js';
import app from './app.js';
import { startSegmentationWorkerLoop } from './services/segmentationWorker.js';
// AED worker queue removed for now (no background AED in this build)

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3001;

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Initialize server
const startServer = async () => {
  try {
    // Validate configurations
    validateJWTConfig();
    validateGoogleConfig();
    
    // Test database connection (throws on failure)
    await testConnection();
    
    // Start server
    app.listen(PORT, () => {
      console.log(`🚀 Chatak Backend Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`🔐 Auth API: http://localhost:${PORT}/api/auth`);
      console.log(`👤 Users API: http://localhost:${PORT}/api/users`);
      console.log(`📁 Projects API: http://localhost:${PORT}/api/projects`);
      console.log(`📍 Sites API: http://localhost:${PORT}/api/projects/:projectId/sites`);
      console.log(`🎵 Recordings API: http://localhost:${PORT}/api/projects/:projectId/recordings`);
      console.log(`✂️  Segmentation API: http://localhost:${PORT}/api/recordings/:recordingId/segmentation/jobs`);
      console.log(`🧪 Test API: http://localhost:${PORT}/api/test`);
    });

    // Start background workers only if explicitly enabled
    if (process.env.ENABLE_SEGMENTATION_WORKER === 'true') {
      console.log('🧵 Segmentation worker enabled');
      startSegmentationWorkerLoop(parseInt(process.env.SEGMENTATION_POLL_MS || '5000', 10));
    } else {
      console.log('⏸️ Segmentation worker auto-start disabled (ENABLE_SEGMENTATION_WORKER != true). Use /api/workers/segmentation/poll-once to run on-demand.');
    }

    // AED background worker disabled; AED is queued via API and processed by a separate process if needed
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, shutting down gracefully');
  await sequelize.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, shutting down gracefully');
  await sequelize.close();
  process.exit(0);
});

startServer(); 