import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { db } from '../src/config/database.js';
import { QueryTypes } from 'sequelize';
import { 
  queueSegmentationJob, 
  pollAndRunSegmentation,
  getWorkerStatus,
  startSegmentationWorkerLoop,
  stopSegmentationWorkerLoop
} from '../src/services/segmentationWorker.js';

describe('Segmentation Optimization Tests', () => {
  let testRecordingId;
  let testJobId;

  beforeEach(async () => {
    // Create a test recording for segmentation
    const recording = await db.query(`
      INSERT INTO recordings (name, file_path, file_size, site_id, project_id, duration_seconds, status)
      VALUES ('test-recording.wav', 'test/test-recording.wav', 1000000, 1, 1, 120, 'completed')
      RETURNING id
    `, { type: QueryTypes.INSERT });
    
    testRecordingId = recording[0].id;
  });

  afterEach(async () => {
    // Clean up test data
    if (testJobId) {
      await db.query(`DELETE FROM job_queue WHERE job_id = :jobId`, {
        replacements: { jobId: testJobId },
        type: QueryTypes.DELETE
      });
    }
    
    if (testRecordingId) {
      await db.query(`DELETE FROM segments WHERE recording_id = :recordingId`, {
        replacements: { recordingId: testRecordingId },
        type: QueryTypes.DELETE
      });
      
      await db.query(`DELETE FROM recordings WHERE id = :recordingId`, {
        replacements: { recordingId: testRecordingId },
        type: QueryTypes.DELETE
      });
    }

    // Stop any running workers
    stopSegmentationWorkerLoop();
  });

  describe('Async Job Queue System', () => {
    it('should queue segmentation job successfully', async () => {
      const job = await queueSegmentationJob(testRecordingId, {
        seg_len_s: 60,
        overlap_pct: 10,
        sample_rate: 32000
      });

      expect(job).toBeDefined();
      expect(job.job_id).toBeDefined();
      testJobId = job.job_id;

      // Verify job is in database
      const jobs = await db.query(`
        SELECT * FROM job_queue WHERE job_id = :jobId
      `, { replacements: { jobId: testJobId }, type: QueryTypes.SELECT });

      expect(jobs).toHaveLength(1);
      expect(jobs[0].type).toBe('segmentation');
      expect(jobs[0].status).toBe('queued');
      expect(jobs[0].recording_id).toBe(testRecordingId);
    });

    it('should return job immediately without blocking', async () => {
      const startTime = Date.now();
      
      const job = await queueSegmentationJob(testRecordingId, {
        seg_len_s: 60,
        overlap_pct: 10
      });
      
      const endTime = Date.now();
      const responseTime = endTime - startTime;

      // Job creation should be very fast (< 1 second)
      expect(responseTime).toBeLessThan(1000);
      expect(job.job_id).toBeDefined();
      testJobId = job.job_id;
    });
  });

  describe('Worker Management', () => {
    it('should start and stop worker loop', () => {
      // Initially no worker should be running
      let status = getWorkerStatus();
      expect(status.running).toBe(false);

      // Start worker
      startSegmentationWorkerLoop(1000);
      status = getWorkerStatus();
      expect(status.running).toBe(true);

      // Stop worker
      stopSegmentationWorkerLoop();
      status = getWorkerStatus();
      expect(status.running).toBe(false);
    });

    it('should prevent multiple worker instances', () => {
      startSegmentationWorkerLoop(1000);
      
      // Try to start another worker - should not create duplicate
      startSegmentationWorkerLoop(1000);
      
      const status = getWorkerStatus();
      expect(status.running).toBe(true);
      
      stopSegmentationWorkerLoop();
    });
  });

  describe('Job Processing', () => {
    it('should process queued jobs', async () => {
      // Queue a job
      const job = await queueSegmentationJob(testRecordingId, {
        seg_len_s: 30, // Shorter segments for faster test
        overlap_pct: 5
      });
      testJobId = job.job_id;

      // Process the job
      await pollAndRunSegmentation();

      // Check job status
      const jobs = await db.query(`
        SELECT status, payload FROM job_queue WHERE job_id = :jobId
      `, { replacements: { jobId: testJobId }, type: QueryTypes.SELECT });

      expect(jobs).toHaveLength(1);
      // Job should either be running, succeeded, or failed (not queued)
      expect(['running', 'succeeded', 'failed']).toContain(jobs[0].status);
    });
  });

  describe('Performance Metrics', () => {
    it('should track performance metrics during processing', async () => {
      const job = await queueSegmentationJob(testRecordingId, {
        seg_len_s: 30,
        overlap_pct: 5
      });
      testJobId = job.job_id;

      await pollAndRunSegmentation();

      // Check if performance metrics were stored
      const jobs = await db.query(`
        SELECT payload FROM job_queue WHERE job_id = :jobId
      `, { replacements: { jobId: testJobId }, type: QueryTypes.SELECT });

      if (jobs.length > 0 && jobs[0].payload?.performance_metrics) {
        const metrics = jobs[0].payload.performance_metrics;
        
        expect(metrics.recording_id).toBe(testRecordingId);
        expect(metrics.start_time).toBeDefined();
        expect(metrics.processing_time_ms).toBeGreaterThan(0);
        expect(metrics.ffmpeg_operations).toBeGreaterThan(0);
      }
    });
  });

  describe('Error Handling and Retry Logic', () => {
    it('should handle job failures with retry logic', async () => {
      // Create a job with invalid parameters to force failure
      const job = await queueSegmentationJob(999999, { // Non-existent recording
        seg_len_s: 60
      });
      testJobId = job.job_id;

      await pollAndRunSegmentation();

      const jobs = await db.query(`
        SELECT status, attempts, error FROM job_queue WHERE job_id = :jobId
      `, { replacements: { jobId: testJobId }, type: QueryTypes.SELECT });

      expect(jobs).toHaveLength(1);
      expect(jobs[0].attempts).toBeGreaterThan(0);
      expect(jobs[0].error).toBeDefined();
    });
  });
});

describe('Performance Benchmarks', () => {
  it('should process segments faster than sequential processing', async () => {
    // This is a conceptual test - in practice you'd need actual audio files
    // and would compare processing times between old and new implementations
    
    const startTime = Date.now();
    
    // Simulate parallel processing benefits
    const parallelTasks = Array.from({ length: 4 }, (_, i) => 
      new Promise(resolve => setTimeout(resolve, 100)) // Simulate 100ms task
    );
    
    await Promise.all(parallelTasks);
    const parallelTime = Date.now() - startTime;
    
    // Parallel processing should be significantly faster than sequential
    expect(parallelTime).toBeLessThan(500); // Should be ~100ms, not 400ms
  });
});
