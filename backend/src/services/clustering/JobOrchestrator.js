/**
 * Job Orchestrator for Clustering System
 * Manages job queue, worker coordination, and progress tracking
 */

const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const clusteringConfig = require('../../config/clusteringConfig');

class JobOrchestrator {
  constructor(db, s3DataLayout) {
    this.db = db;
    this.s3Layout = s3DataLayout;
    this.activeJobs = new Map();
    this.jobQueue = [];
    this.maxConcurrentJobs = 3;
    
    // Job type configurations
    this.jobTypes = {
      'extract_features': {
        worker: 'feature_extraction_worker.py',
        priority: 5,
        timeout: 3600000, // 1 hour
        memory_limit: '8GB',
        retry_count: 3
      },
      'build_index': {
        worker: 'index_builder_worker.py',
        priority: 4,
        timeout: 1800000, // 30 minutes
        memory_limit: '16GB',
        retry_count: 2
      },
      'cluster': {
        worker: 'clustering_worker.py',
        priority: 3,
        timeout: 7200000, // 2 hours
        memory_limit: '32GB',
        retry_count: 2
      },
      'propagate': {
        worker: 'propagation_worker.py',
        priority: 2,
        timeout: 1800000, // 30 minutes
        memory_limit: '16GB',
        retry_count: 3
      }
    };
  }

  /**
   * Submit a new job to the queue
   */
  async submitJob(jobType, projectId, params = {}) {
    try {
      const jobId = uuidv4();
      const runId = params.runId || this.s3Layout.generateRunId();
      
      // Validate job type
      if (!this.jobTypes[jobType]) {
        throw new Error(`Unknown job type: ${jobType}`);
      }

      // Create job record
      const job = await this.db.ProcessingJob.create({
        id: jobId,
        projectId,
        jobType,
        jobSubtype: params.subtype || null,
        runId,
        status: 'queued',
        priority: params.priority || this.jobTypes[jobType].priority,
        paramsJson: params,
        maxRetries: this.jobTypes[jobType].retry_count,
        estimatedDurationMs: this.jobTypes[jobType].timeout
      });

      // Add to queue
      this.jobQueue.push({
        jobId,
        jobType,
        projectId,
        runId,
        params,
        priority: job.priority,
        createdAt: new Date()
      });

      // Sort queue by priority
      this.jobQueue.sort((a, b) => a.priority - b.priority);

      console.log(`📋 Job ${jobId} (${jobType}) queued for project ${projectId}`);
      
      // Try to process queue
      this.processQueue();

      return {
        jobId,
        runId,
        status: 'queued',
        estimatedDuration: this.jobTypes[jobType].timeout
      };

    } catch (error) {
      console.error('Failed to submit job:', error);
      throw error;
    }
  }

  /**
   * Process the job queue
   */
  async processQueue() {
    // Check if we can start more jobs
    if (this.activeJobs.size >= this.maxConcurrentJobs) {
      return;
    }

    // Get next job from queue
    const nextJob = this.jobQueue.shift();
    if (!nextJob) {
      return;
    }

    try {
      await this.startJob(nextJob);
    } catch (error) {
      console.error(`Failed to start job ${nextJob.jobId}:`, error);
      await this.updateJobStatus(nextJob.jobId, 'failed', error.message);
    }

    // Continue processing queue
    setTimeout(() => this.processQueue(), 1000);
  }

  /**
   * Start executing a job
   */
  async startJob(jobInfo) {
    const { jobId, jobType, projectId, runId, params } = jobInfo;
    
    console.log(`🚀 Starting job ${jobId} (${jobType})`);

    try {
      // Update job status
      await this.updateJobStatus(jobId, 'running', 'Starting worker process');

      // Get job configuration
      const jobConfig = this.jobTypes[jobType];
      const workerConfig = clusteringConfig.exportForWorker(jobType);

      // Prepare worker parameters
      const workerParams = {
        job_id: jobId,
        project_id: projectId,
        run_id: runId,
        config: workerConfig,
        ...params
      };

      // Start Python worker
      const workerProcess = await this.spawnWorker(jobConfig.worker, workerParams);
      
      // Track active job
      this.activeJobs.set(jobId, {
        process: workerProcess,
        startTime: new Date(),
        jobType,
        projectId,
        runId
      });

      // Set up process handlers
      this.setupProcessHandlers(jobId, workerProcess);

    } catch (error) {
      console.error(`Failed to start job ${jobId}:`, error);
      await this.updateJobStatus(jobId, 'failed', error.message);
      throw error;
    }
  }

  /**
   * Spawn Python worker process
   */
  async spawnWorker(workerScript, params) {
    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, '../../workers/python', workerScript);
      
      // Check if worker script exists
      if (!fs.existsSync(workerPath)) {
        reject(new Error(`Worker script not found: ${workerPath}`));
        return;
      }

      // Spawn Python process
      const process = spawn('python3', [workerPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONPATH: path.join(__dirname, '../../workers/python'),
          AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
          AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
          AWS_REGION: process.env.AWS_REGION
        }
      });

      // Send parameters to worker
      process.stdin.write(JSON.stringify(params));
      process.stdin.end();

      // Handle process startup
      process.on('spawn', () => {
        console.log(`✅ Worker process spawned: PID ${process.pid}`);
        resolve(process);
      });

      process.on('error', (error) => {
        console.error('Failed to spawn worker process:', error);
        reject(error);
      });
    });
  }

  /**
   * Set up process event handlers
   */
  setupProcessHandlers(jobId, workerProcess) {
    let outputBuffer = '';
    let errorBuffer = '';

    // Handle stdout (progress updates, logs)
    workerProcess.stdout.on('data', (data) => {
      const output = data.toString();
      outputBuffer += output;
      
      // Parse progress updates
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.parseWorkerOutput(jobId, line.trim());
        }
      }
    });

    // Handle stderr (errors, warnings)
    workerProcess.stderr.on('data', (data) => {
      const error = data.toString();
      errorBuffer += error;
      console.error(`Worker ${jobId} stderr:`, error);
    });

    // Handle process completion
    workerProcess.on('close', async (code) => {
      console.log(`🏁 Worker ${jobId} exited with code ${code}`);
      
      // Remove from active jobs
      this.activeJobs.delete(jobId);

      try {
        if (code === 0) {
          // Success
          await this.updateJobStatus(jobId, 'completed', 'Worker completed successfully');
          
          // Parse final result from output
          const result = this.parseWorkerResult(outputBuffer);
          if (result) {
            await this.handleJobResult(jobId, result);
          }
          
        } else {
          // Failure
          const errorMsg = errorBuffer || `Worker exited with code ${code}`;
          await this.handleJobFailure(jobId, errorMsg);
        }
      } catch (error) {
        console.error(`Error handling job completion for ${jobId}:`, error);
      }

      // Continue processing queue
      this.processQueue();
    });

    // Handle process errors
    workerProcess.on('error', async (error) => {
      console.error(`Worker ${jobId} process error:`, error);
      this.activeJobs.delete(jobId);
      await this.handleJobFailure(jobId, error.message);
      this.processQueue();
    });
  }

  /**
   * Parse worker output for progress updates
   */
  parseWorkerOutput(jobId, line) {
    try {
      // Look for JSON progress updates
      if (line.startsWith('PROGRESS:')) {
        const progressData = JSON.parse(line.substring(9));
        this.updateJobProgress(jobId, progressData);
      }
      
      // Log other output
      console.log(`Worker ${jobId}: ${line}`);
      
    } catch (error) {
      // Not JSON, just log as regular output
      console.log(`Worker ${jobId}: ${line}`);
    }
  }

  /**
   * Parse final worker result
   */
  parseWorkerResult(output) {
    try {
      // Look for final result JSON
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.startsWith('RESULT:')) {
          return JSON.parse(line.substring(7));
        }
      }
      return null;
    } catch (error) {
      console.error('Failed to parse worker result:', error);
      return null;
    }
  }

  /**
   * Update job status in database
   */
  async updateJobStatus(jobId, status, message = null, progress = null) {
    try {
      const updateData = {
        status,
        updatedAt: new Date()
      };

      if (message) {
        updateData.currentStep = message;
      }

      if (progress !== null) {
        updateData.progressPct = Math.min(100, Math.max(0, progress));
      }

      if (status === 'running' && !updateData.startedAt) {
        updateData.startedAt = new Date();
      }

      if (status === 'completed' || status === 'failed') {
        updateData.finishedAt = new Date();
        
        // Calculate actual duration
        const job = await this.db.ProcessingJob.findByPk(jobId);
        if (job && job.startedAt) {
          updateData.actualDurationMs = new Date() - new Date(job.startedAt);
        }
      }

      await this.db.ProcessingJob.update(updateData, {
        where: { id: jobId }
      });

      console.log(`📊 Job ${jobId} status: ${status}${message ? ` - ${message}` : ''}`);

    } catch (error) {
      console.error(`Failed to update job status for ${jobId}:`, error);
    }
  }

  /**
   * Update job progress
   */
  async updateJobProgress(jobId, progressData) {
    try {
      await this.updateJobStatus(
        jobId,
        'running',
        progressData.step || null,
        progressData.progress || null
      );

      // Update additional metrics if provided
      if (progressData.metrics) {
        await this.db.ProcessingJob.update({
          memoryUsageMb: progressData.metrics.memory_mb,
          cpuUsagePct: progressData.metrics.cpu_pct
        }, {
          where: { id: jobId }
        });
      }

    } catch (error) {
      console.error(`Failed to update job progress for ${jobId}:`, error);
    }
  }

  /**
   * Handle successful job completion
   */
  async handleJobResult(jobId, result) {
    try {
      console.log(`✅ Job ${jobId} completed successfully`);
      
      // Store result metrics
      if (result.metrics) {
        await this.db.ProcessingJob.update({
          memoryUsageMb: result.metrics.memory_peak_mb,
          actualDurationMs: result.metrics.duration_ms
        }, {
          where: { id: jobId }
        });
      }

      // Trigger dependent jobs if needed
      await this.triggerDependentJobs(jobId, result);

    } catch (error) {
      console.error(`Error handling job result for ${jobId}:`, error);
    }
  }

  /**
   * Handle job failure
   */
  async handleJobFailure(jobId, errorMessage) {
    try {
      const job = await this.db.ProcessingJob.findByPk(jobId);
      
      if (job && job.retryCount < job.maxRetries) {
        // Retry the job
        console.log(`🔄 Retrying job ${jobId} (attempt ${job.retryCount + 1})`);
        
        await this.db.ProcessingJob.update({
          retryCount: job.retryCount + 1,
          status: 'queued',
          errorMessage: null
        }, {
          where: { id: jobId }
        });

        // Re-add to queue
        this.jobQueue.push({
          jobId,
          jobType: job.jobType,
          projectId: job.projectId,
          runId: job.runId,
          params: job.paramsJson,
          priority: job.priority + 1, // Lower priority for retries
          createdAt: new Date()
        });

        this.jobQueue.sort((a, b) => a.priority - b.priority);

      } else {
        // Max retries reached
        console.error(`❌ Job ${jobId} failed permanently: ${errorMessage}`);
        
        await this.db.ProcessingJob.update({
          status: 'failed',
          errorMessage: errorMessage,
          finishedAt: new Date()
        }, {
          where: { id: jobId }
        });
      }

    } catch (error) {
      console.error(`Error handling job failure for ${jobId}:`, error);
    }
  }

  /**
   * Trigger dependent jobs after successful completion
   */
  async triggerDependentJobs(completedJobId, result) {
    // This would implement job dependency logic
    // For example: feature extraction -> clustering -> propagation
    console.log(`🔗 Checking for dependent jobs after ${completedJobId}`);
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId) {
    try {
      const job = await this.db.ProcessingJob.findByPk(jobId);
      if (!job) {
        return null;
      }

      return {
        jobId: job.id,
        status: job.status,
        progress: job.progressPct || 0,
        currentStep: job.currentStep,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        errorMessage: job.errorMessage,
        retryCount: job.retryCount,
        estimatedDuration: job.estimatedDurationMs,
        actualDuration: job.actualDurationMs
      };

    } catch (error) {
      console.error(`Failed to get job status for ${jobId}:`, error);
      return null;
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId) {
    try {
      // Remove from queue if queued
      this.jobQueue = this.jobQueue.filter(job => job.jobId !== jobId);

      // Kill process if running
      const activeJob = this.activeJobs.get(jobId);
      if (activeJob) {
        activeJob.process.kill('SIGTERM');
        this.activeJobs.delete(jobId);
      }

      // Update database
      await this.updateJobStatus(jobId, 'cancelled', 'Job cancelled by user');

      console.log(`🛑 Job ${jobId} cancelled`);
      return true;

    } catch (error) {
      console.error(`Failed to cancel job ${jobId}:`, error);
      return false;
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      queueLength: this.jobQueue.length,
      activeJobs: this.activeJobs.size,
      maxConcurrent: this.maxConcurrentJobs,
      nextJobs: this.jobQueue.slice(0, 5).map(job => ({
        jobId: job.jobId,
        jobType: job.jobType,
        priority: job.priority,
        createdAt: job.createdAt
      }))
    };
  }
}

module.exports = JobOrchestrator;
