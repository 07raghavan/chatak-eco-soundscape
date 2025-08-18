import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';

/**
 * Enhanced Job Service with Idempotency and Versioning
 * Prevents duplicate job execution and provides version tracking
 */
export class JobService {
  constructor() {
    this.currentCodeVersion = process.env.CODE_VERSION || 'v1.0';
    this.workerImage = process.env.WORKER_IMAGE || 'local';
  }

  /**
   * Safely enqueue a job with idempotency check
   * Prevents duplicate jobs for same (recording, segment, type, version)
   */
  async enqueueJobIdempotent(jobType, payload, options = {}) {
    const {
      segmentId = null,
      priority = 5,
      codeVersion = this.currentCodeVersion,
      maxAttempts = 3
    } = options;

    try {
      console.log(`🔍 Enqueuing ${jobType} job with idempotency check...`);

      const result = await db.query(`
        SELECT * FROM enqueue_job_idempotent(
          :jobType, :payload, :codeVersion, :segmentId, :priority
        )
      `, {
        replacements: {
          jobType,
          payload: JSON.stringify(payload),
          codeVersion,
          segmentId,
          priority
        },
        type: QueryTypes.SELECT
      });

      const jobResult = result[0];
      
      if (jobResult.was_created) {
        console.log(`✅ Created new ${jobType} job: ${jobResult.job_id}`);
      } else {
        console.log(`♻️ Found existing ${jobType} job: ${jobResult.job_id} (status: ${jobResult.existing_status})`);
      }

      return {
        jobId: jobResult.job_id,
        wasCreated: jobResult.was_created,
        status: jobResult.existing_status
      };

    } catch (error) {
      console.error(`❌ Failed to enqueue ${jobType} job:`, error);
      throw error;
    }
  }

  /**
   * Check if job outputs already exist (for skip logic)
   */
  async checkOutputsExist(recordingId, jobType, options = {}) {
    const {
      segmentId = null,
      codeVersion = this.currentCodeVersion
    } = options;

    try {
      const result = await db.query(`
        SELECT check_job_outputs_exist(:recordingId, :segmentId, :jobType, :codeVersion) as outputs_exist
      `, {
        replacements: {
          recordingId,
          segmentId,
          jobType,
          codeVersion
        },
        type: QueryTypes.SELECT
      });

      const outputsExist = result[0].outputs_exist;
      
      if (outputsExist) {
        console.log(`⏭️ Outputs already exist for ${jobType} job (recording: ${recordingId}, segment: ${segmentId}, version: ${codeVersion})`);
      }

      return outputsExist;

    } catch (error) {
      console.error(`❌ Failed to check outputs for ${jobType}:`, error);
      return false; // Assume outputs don't exist on error
    }
  }

  /**
   * Get next job from queue with proper locking
   */
  async getNextJob(jobTypes = null, workerId = null) {
    try {
      const typeFilter = jobTypes ? `AND type = ANY(:jobTypes)` : '';
      
      const jobs = await db.query(`
        UPDATE job_queue 
        SET 
          status = 'running',
          started_at = NOW(),
          updated_at = NOW(),
          worker_image = :workerImage
        WHERE id = (
          SELECT id FROM job_queue 
          WHERE status = 'queued' 
            AND run_at <= NOW()
            ${typeFilter}
          ORDER BY priority DESC, created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `, {
        replacements: {
          jobTypes: jobTypes || [],
          workerImage: workerId || this.workerImage
        },
        type: QueryTypes.UPDATE
      });

      if (jobs[0].length > 0) {
        const job = jobs[0][0];
        console.log(`🎯 Acquired job: ${job.job_id} (${job.type})`);
        return job;
      }

      return null;

    } catch (error) {
      console.error('❌ Failed to get next job:', error);
      throw error;
    }
  }

  /**
   * Mark job as completed
   */
  async completeJob(jobId, result = null) {
    try {
      await db.query(`
        UPDATE job_queue 
        SET 
          status = 'succeeded',
          finished_at = NOW(),
          updated_at = NOW(),
          payload = CASE 
            WHEN :result::text IS NOT NULL 
            THEN payload || :result::jsonb 
            ELSE payload 
          END
        WHERE job_id = :jobId
      `, {
        replacements: {
          jobId,
          result: result ? JSON.stringify({ result }) : null
        },
        type: QueryTypes.UPDATE
      });

      console.log(`✅ Completed job: ${jobId}`);

    } catch (error) {
      console.error(`❌ Failed to complete job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Mark job as failed with error details
   */
  async failJob(jobId, error, shouldRetry = true) {
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await db.query(`
        UPDATE job_queue 
        SET 
          status = CASE 
            WHEN :shouldRetry AND attempts < max_attempts THEN 'queued'
            ELSE 'failed'
          END,
          attempts = attempts + 1,
          error = :error,
          finished_at = CASE 
            WHEN :shouldRetry AND attempts < max_attempts THEN NULL
            ELSE NOW()
          END,
          run_at = CASE 
            WHEN :shouldRetry AND attempts < max_attempts 
            THEN NOW() + INTERVAL '5 minutes' * POWER(2, attempts)  -- Exponential backoff
            ELSE run_at
          END,
          updated_at = NOW()
        WHERE job_id = :jobId
      `, {
        replacements: {
          jobId,
          error: errorMessage,
          shouldRetry
        },
        type: QueryTypes.UPDATE
      });

      if (shouldRetry) {
        console.log(`🔄 Job ${jobId} failed, will retry with exponential backoff`);
      } else {
        console.log(`❌ Job ${jobId} failed permanently: ${errorMessage}`);
      }

    } catch (dbError) {
      console.error(`❌ Failed to mark job ${jobId} as failed:`, dbError);
      throw dbError;
    }
  }

  /**
   * Get job statistics
   */
  async getJobStats(jobType = null) {
    try {
      const typeFilter = jobType ? 'WHERE type = :jobType' : '';
      
      const stats = await db.query(`
        SELECT * FROM job_stats ${typeFilter}
        ORDER BY type, code_version, status
      `, {
        replacements: { jobType },
        type: QueryTypes.SELECT
      });

      return stats;

    } catch (error) {
      console.error('❌ Failed to get job stats:', error);
      throw error;
    }
  }

  /**
   * Get active jobs
   */
  async getActiveJobs(limit = 50) {
    try {
      const jobs = await db.query(`
        SELECT * FROM active_jobs 
        ORDER BY created_at DESC
        LIMIT :limit
      `, {
        replacements: { limit },
        type: QueryTypes.SELECT
      });

      return jobs;

    } catch (error) {
      console.error('❌ Failed to get active jobs:', error);
      throw error;
    }
  }

  /**
   * Clean up old completed jobs
   */
  async cleanupOldJobs(daysOld = 30) {
    try {
      const result = await db.query(`
        DELETE FROM job_queue 
        WHERE status IN ('succeeded', 'failed', 'canceled')
          AND finished_at < NOW() - INTERVAL ':daysOld days'
      `, {
        replacements: { daysOld },
        type: QueryTypes.DELETE
      });

      console.log(`🧹 Cleaned up ${result[1]} old jobs (older than ${daysOld} days)`);
      return result[1];

    } catch (error) {
      console.error('❌ Failed to cleanup old jobs:', error);
      throw error;
    }
  }

  /**
   * Reset stuck jobs (running for too long)
   */
  async resetStuckJobs(maxRuntimeMinutes = 60) {
    try {
      const result = await db.query(`
        UPDATE job_queue 
        SET 
          status = 'queued',
          started_at = NULL,
          worker_image = NULL,
          updated_at = NOW(),
          run_at = NOW() + INTERVAL '1 minute'
        WHERE status = 'running' 
          AND started_at < NOW() - INTERVAL ':maxRuntimeMinutes minutes'
      `, {
        replacements: { maxRuntimeMinutes },
        type: QueryTypes.UPDATE
      });

      if (result[1] > 0) {
        console.log(`🔄 Reset ${result[1]} stuck jobs (running > ${maxRuntimeMinutes} minutes)`);
      }

      return result[1];

    } catch (error) {
      console.error('❌ Failed to reset stuck jobs:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const jobService = new JobService();
export default jobService;
