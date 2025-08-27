/**
 * Batch Processing System for Feature Extraction
 * Efficiently processes large-scale ROI feature extraction
 */

const clusteringConfig = require('../../config/clusteringConfig');

class BatchProcessor {
  constructor(db, jobOrchestrator, s3DataLayout) {
    this.db = db;
    this.jobOrchestrator = jobOrchestrator;
    this.s3Layout = s3DataLayout;
    
    // Batch configuration
    this.config = clusteringConfig.get('jobs', {});
    this.batchSizes = {
      dsp: 500,           // ROIs per DSP batch
      embeddings: 100,    // ROIs per embedding batch (GPU memory limited)
      validation: 1000    // ROIs per validation batch
    };
    
    // Processing limits
    this.maxConcurrentBatches = 3;
    this.maxRoisPerRun = 100000;  // Safety limit
  }

  /**
   * Process feature extraction for a project
   */
  async processFeatureExtraction(projectId, params = {}) {
    try {
      console.log(`🚀 Starting batch feature extraction for project ${projectId}`);
      
      const runId = this.s3Layout.generateRunId();
      
      // Get ROIs to process
      const rois = await this.getROIsForProcessing(projectId, params);
      console.log(`📊 Found ${rois.length} ROIs to process`);
      
      if (rois.length === 0) {
        throw new Error('No ROIs found for processing');
      }
      
      if (rois.length > this.maxRoisPerRun) {
        throw new Error(`Too many ROIs: ${rois.length} > ${this.maxRoisPerRun}`);
      }
      
      // Create processing plan
      const plan = this.createProcessingPlan(rois, params);
      console.log(`📋 Created processing plan: ${plan.batches.length} batches`);
      
      // Submit batch jobs
      const jobIds = await this.submitBatchJobs(projectId, runId, plan);
      
      // Create run record
      await this.createRunRecord(projectId, runId, plan, jobIds);
      
      return {
        runId,
        projectId,
        totalROIs: rois.length,
        totalBatches: plan.batches.length,
        jobIds,
        estimatedDuration: plan.estimatedDuration
      };
      
    } catch (error) {
      console.error('Batch feature extraction failed:', error);
      throw error;
    }
  }

  /**
   * Get ROIs that need feature extraction
   */
  async getROIsForProcessing(projectId, params) {
    try {
      // Build query conditions
      const whereConditions = {
        project_id: projectId
      };
      
      // Filter by date range if specified
      if (params.startDate) {
        whereConditions.created_at = {
          [this.db.Sequelize.Op.gte]: new Date(params.startDate)
        };
      }
      
      if (params.endDate) {
        whereConditions.created_at = {
          ...whereConditions.created_at,
          [this.db.Sequelize.Op.lte]: new Date(params.endDate)
        };
      }
      
      // Filter by confidence if specified
      if (params.minConfidence) {
        whereConditions.confidence = {
          [this.db.Sequelize.Op.gte]: params.minConfidence
        };
      }
      
      // Get ROIs from aed_events table
      const aedEvents = await this.db.AEDEvent.findAll({
        where: whereConditions,
        include: [
          {
            model: this.db.Segment,
            as: 'segment',
            required: true,
            where: {
              approval_status: 'approved'  // Only approved segments
            }
          }
        ],
        order: [['created_at', 'ASC']],
        limit: params.limit || this.maxRoisPerRun
      });
      
      // Convert to ROI format
      const rois = aedEvents.map(event => ({
        id: event.id,
        project_id: projectId,
        segment_id: event.segment_id,
        start_ms: event.start_ms,
        end_ms: event.end_ms,
        confidence: event.confidence,
        f_min_hz: event.f_min_hz,
        f_max_hz: event.f_max_hz,
        segment_s3_key: event.segment?.s3_key,
        segment_start_ms: event.segment?.start_ms || 0
      }));
      
      // Filter out ROIs that already have features (if not forcing reprocessing)
      if (!params.forceReprocess) {
        return this.filterExistingFeatures(rois, params.featureTypes || ['dsp', 'embeddings']);
      }
      
      return rois;
      
    } catch (error) {
      console.error('Failed to get ROIs for processing:', error);
      throw error;
    }
  }

  /**
   * Filter out ROIs that already have features
   */
  async filterExistingFeatures(rois, featureTypes) {
    try {
      const roiIds = rois.map(roi => roi.id);
      
      // Check which ROIs already have features
      const existingFeatures = await this.db.ROIFeature.findAll({
        where: {
          roiId: {
            [this.db.Sequelize.Op.in]: roiIds
          },
          featureType: {
            [this.db.Sequelize.Op.in]: featureTypes
          }
        },
        attributes: ['roiId', 'featureType']
      });
      
      // Group by ROI ID
      const existingByRoi = {};
      existingFeatures.forEach(feature => {
        if (!existingByRoi[feature.roiId]) {
          existingByRoi[feature.roiId] = new Set();
        }
        existingByRoi[feature.roiId].add(feature.featureType);
      });
      
      // Filter ROIs that need processing
      const filteredRois = rois.filter(roi => {
        const existing = existingByRoi[roi.id] || new Set();
        return featureTypes.some(type => !existing.has(type));
      });
      
      console.log(`📊 Filtered ${rois.length - filteredRois.length} ROIs with existing features`);
      return filteredRois;
      
    } catch (error) {
      console.error('Failed to filter existing features:', error);
      return rois; // Return all if filtering fails
    }
  }

  /**
   * Create processing plan with optimal batching
   */
  createProcessingPlan(rois, params) {
    const featureTypes = params.featureTypes || ['dsp', 'embeddings'];
    const plan = {
      batches: [],
      estimatedDuration: 0,
      totalROIs: rois.length
    };
    
    // Create batches for each feature type
    for (const featureType of featureTypes) {
      const batchSize = this.batchSizes[featureType];
      const batches = this.createBatches(rois, batchSize, featureType);
      
      plan.batches.push(...batches);
    }
    
    // Estimate total duration
    plan.estimatedDuration = this.estimateProcessingTime(plan.batches);
    
    // Sort batches by priority (embeddings first, then DSP)
    plan.batches.sort((a, b) => {
      const priority = { embeddings: 1, dsp: 2 };
      return priority[a.featureType] - priority[b.featureType];
    });
    
    return plan;
  }

  /**
   * Create batches for a specific feature type
   */
  createBatches(rois, batchSize, featureType) {
    const batches = [];
    
    for (let i = 0; i < rois.length; i += batchSize) {
      const batchRois = rois.slice(i, i + batchSize);
      
      batches.push({
        id: `${featureType}_batch_${Math.floor(i / batchSize) + 1}`,
        featureType,
        rois: batchRois,
        size: batchRois.length,
        estimatedDuration: this.estimateBatchDuration(batchRois.length, featureType)
      });
    }
    
    return batches;
  }

  /**
   * Estimate processing time for batches
   */
  estimateProcessingTime(batches) {
    return batches.reduce((total, batch) => total + batch.estimatedDuration, 0);
  }

  /**
   * Estimate duration for a single batch
   */
  estimateBatchDuration(roiCount, featureType) {
    // Time estimates in seconds per ROI
    const timePerROI = {
      dsp: 0.5,        // 0.5 seconds per ROI for DSP features
      embeddings: 2.0   // 2 seconds per ROI for deep embeddings (GPU)
    };
    
    return roiCount * (timePerROI[featureType] || 1.0);
  }

  /**
   * Submit batch jobs to the job orchestrator
   */
  async submitBatchJobs(projectId, runId, plan) {
    const jobIds = [];
    
    for (const batch of plan.batches) {
      try {
        const jobType = batch.featureType === 'dsp' ? 'extract_features' : 'extract_features';
        const jobParams = {
          runId,
          subtype: batch.featureType,
          roi_batch: batch.rois,
          batch_id: batch.id,
          batch_size: batch.size
        };
        
        const jobResult = await this.jobOrchestrator.submitJob(
          jobType,
          projectId,
          jobParams
        );
        
        jobIds.push(jobResult.jobId);
        console.log(`📋 Submitted ${batch.featureType} batch job: ${jobResult.jobId}`);
        
      } catch (error) {
        console.error(`Failed to submit batch job for ${batch.id}:`, error);
        throw error;
      }
    }
    
    return jobIds;
  }

  /**
   * Create run record in database
   */
  async createRunRecord(projectId, runId, plan, jobIds) {
    try {
      // This would create a record in a processing_runs table
      // For now, just log the information
      
      const runRecord = {
        id: runId,
        project_id: projectId,
        status: 'running',
        total_rois: plan.totalROIs,
        total_batches: plan.batches.length,
        job_ids: jobIds,
        estimated_duration: plan.estimatedDuration,
        created_at: new Date()
      };
      
      console.log(`📝 Created run record: ${runId}`);
      console.log(`   - ROIs: ${runRecord.total_rois}`);
      console.log(`   - Batches: ${runRecord.total_batches}`);
      console.log(`   - Jobs: ${jobIds.length}`);
      console.log(`   - Estimated duration: ${Math.round(runRecord.estimated_duration / 60)} minutes`);
      
      return runRecord;
      
    } catch (error) {
      console.error('Failed to create run record:', error);
      throw error;
    }
  }

  /**
   * Monitor batch processing progress
   */
  async getProcessingStatus(runId) {
    try {
      // Get all jobs for this run
      const jobs = await this.db.ProcessingJob.findAll({
        where: { runId },
        order: [['created_at', 'ASC']]
      });
      
      if (jobs.length === 0) {
        return { status: 'not_found' };
      }
      
      // Calculate overall progress
      const totalJobs = jobs.length;
      const completedJobs = jobs.filter(job => job.status === 'completed').length;
      const failedJobs = jobs.filter(job => job.status === 'failed').length;
      const runningJobs = jobs.filter(job => job.status === 'running').length;
      const queuedJobs = jobs.filter(job => job.status === 'queued').length;
      
      const overallProgress = Math.round((completedJobs / totalJobs) * 100);
      
      // Determine overall status
      let overallStatus = 'running';
      if (completedJobs === totalJobs) {
        overallStatus = 'completed';
      } else if (failedJobs > 0 && (runningJobs + queuedJobs) === 0) {
        overallStatus = 'failed';
      }
      
      // Calculate processing statistics
      const completedJobsData = jobs.filter(job => job.status === 'completed');
      const totalProcessingTime = completedJobsData.reduce((sum, job) => 
        sum + (job.actualDurationMs || 0), 0);
      const avgProcessingTime = completedJobsData.length > 0 ? 
        totalProcessingTime / completedJobsData.length : 0;
      
      return {
        runId,
        status: overallStatus,
        progress: overallProgress,
        jobs: {
          total: totalJobs,
          completed: completedJobs,
          failed: failedJobs,
          running: runningJobs,
          queued: queuedJobs
        },
        timing: {
          total_processing_time_ms: totalProcessingTime,
          avg_processing_time_ms: Math.round(avgProcessingTime),
          estimated_remaining_ms: avgProcessingTime * (totalJobs - completedJobs)
        },
        job_details: jobs.map(job => ({
          jobId: job.id,
          jobType: job.jobType,
          subtype: job.jobSubtype,
          status: job.status,
          progress: job.progressPct || 0,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
          duration: job.actualDurationMs
        }))
      };
      
    } catch (error) {
      console.error(`Failed to get processing status for run ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel batch processing
   */
  async cancelProcessing(runId) {
    try {
      // Get all jobs for this run
      const jobs = await this.db.ProcessingJob.findAll({
        where: { runId }
      });
      
      let cancelledCount = 0;
      
      // Cancel each job
      for (const job of jobs) {
        if (job.status === 'queued' || job.status === 'running') {
          const success = await this.jobOrchestrator.cancelJob(job.id);
          if (success) {
            cancelledCount++;
          }
        }
      }
      
      console.log(`🛑 Cancelled ${cancelledCount} jobs for run ${runId}`);
      
      return {
        runId,
        cancelledJobs: cancelledCount,
        totalJobs: jobs.length
      };
      
    } catch (error) {
      console.error(`Failed to cancel processing for run ${runId}:`, error);
      throw error;
    }
  }

  /**
   * Get batch processing statistics
   */
  async getProcessingStats(projectId, timeRange = '7d') {
    try {
      const startDate = new Date();
      const days = parseInt(timeRange.replace('d', ''));
      startDate.setDate(startDate.getDate() - days);
      
      const jobs = await this.db.ProcessingJob.findAll({
        where: {
          projectId,
          createdAt: {
            [this.db.Sequelize.Op.gte]: startDate
          }
        },
        attributes: [
          'jobType',
          'jobSubtype',
          'status',
          'actualDurationMs',
          'memoryUsageMb',
          'createdAt'
        ]
      });
      
      // Calculate statistics
      const stats = {
        total_jobs: jobs.length,
        by_type: {},
        by_status: {},
        performance: {
          avg_duration_ms: 0,
          avg_memory_mb: 0,
          throughput_jobs_per_hour: 0
        }
      };
      
      // Group by type and status
      jobs.forEach(job => {
        const type = job.jobSubtype || job.jobType;
        stats.by_type[type] = (stats.by_type[type] || 0) + 1;
        stats.by_status[job.status] = (stats.by_status[job.status] || 0) + 1;
      });
      
      // Calculate performance metrics
      const completedJobs = jobs.filter(job => job.status === 'completed');
      if (completedJobs.length > 0) {
        stats.performance.avg_duration_ms = Math.round(
          completedJobs.reduce((sum, job) => sum + (job.actualDurationMs || 0), 0) / completedJobs.length
        );
        
        stats.performance.avg_memory_mb = Math.round(
          completedJobs.reduce((sum, job) => sum + (job.memoryUsageMb || 0), 0) / completedJobs.length
        );
        
        const hoursSpanned = (new Date() - startDate) / (1000 * 60 * 60);
        stats.performance.throughput_jobs_per_hour = Math.round(completedJobs.length / hoursSpanned);
      }
      
      return stats;
      
    } catch (error) {
      console.error('Failed to get processing stats:', error);
      throw error;
    }
  }
}

module.exports = BatchProcessor;
