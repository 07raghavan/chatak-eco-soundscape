#!/usr/bin/env node

/**
 * Job Queue Status Checker
 * This script checks the current status of jobs in the queue
 */

import { db } from '../src/config/database.js';
import { QueryTypes } from 'sequelize';

const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

const log = (color, message) => console.log(`${color}${message}${colors.reset}`);

async function checkJobQueue() {
  try {
    await db.authenticate();
    log(colors.green, '✅ Database connection successful');

    // Get all jobs
    const jobs = await db.query(`
      SELECT 
        id, job_id, type, status, priority, attempts, max_attempts,
        recording_id, created_at, updated_at, run_at, error
      FROM job_queue 
      ORDER BY created_at DESC
    `, { type: QueryTypes.SELECT });

    log(colors.blue, `\n📋 Found ${jobs.length} jobs in queue:\n`);

    if (jobs.length === 0) {
      log(colors.yellow, '   No jobs found in queue');
      return;
    }

    // Group by status
    const byStatus = jobs.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});

    log(colors.blue, '📊 Jobs by status:');
    Object.entries(byStatus).forEach(([status, count]) => {
      const color = status === 'succeeded' ? colors.green : 
                   status === 'failed' ? colors.red : 
                   status === 'running' ? colors.yellow : colors.blue;
      log(color, `   ${status}: ${count}`);
    });

    // Show recent jobs
    log(colors.blue, '\n🕒 Recent jobs:');
    jobs.slice(0, 10).forEach(job => {
      const statusColor = job.status === 'succeeded' ? colors.green : 
                         job.status === 'failed' ? colors.red : 
                         job.status === 'running' ? colors.yellow : colors.blue;
      
      const timeAgo = new Date(Date.now() - new Date(job.created_at).getTime());
      const minutes = Math.floor(timeAgo.getTime() / (1000 * 60));
      
      log(colors.blue, `   ${job.job_id?.substring(0, 8) || job.id} (${job.type})`);
      log(statusColor, `     Status: ${job.status}`);
      log(colors.blue, `     Recording: ${job.recording_id}`);
      log(colors.blue, `     Created: ${minutes}m ago`);
      if (job.error) {
        log(colors.red, `     Error: ${job.error.substring(0, 100)}...`);
      }
      console.log();
    });

    // Check for stuck jobs
    const stuckJobs = jobs.filter(job => {
      const createdAt = new Date(job.created_at);
      const now = new Date();
      const ageMinutes = (now - createdAt) / (1000 * 60);
      return job.status === 'running' && ageMinutes > 30; // Running for more than 30 minutes
    });

    if (stuckJobs.length > 0) {
      log(colors.red, `⚠️ Found ${stuckJobs.length} potentially stuck jobs (running > 30 minutes)`);
      stuckJobs.forEach(job => {
        log(colors.red, `   ${job.job_id?.substring(0, 8) || job.id} - Recording ${job.recording_id}`);
      });
    }

    // Check for failed jobs that could be retried
    const retryableJobs = jobs.filter(job => 
      job.status === 'failed' && job.attempts < (job.max_attempts || 3)
    );

    if (retryableJobs.length > 0) {
      log(colors.yellow, `🔄 Found ${retryableJobs.length} jobs that could be retried`);
    }

  } catch (error) {
    log(colors.red, `❌ Error checking job queue: ${error.message}`);
  } finally {
    await db.close();
  }
}

async function resetStuckJobs() {
  try {
    await db.authenticate();
    
    // Reset jobs that have been running for more than 30 minutes
    const result = await db.query(`
      UPDATE job_queue 
      SET status = 'queued', updated_at = NOW()
      WHERE status = 'running' 
        AND created_at < NOW() - INTERVAL '30 minutes'
    `, { type: QueryTypes.UPDATE });

    log(colors.green, `✅ Reset ${result[1]} stuck jobs back to queued status`);
    
  } catch (error) {
    log(colors.red, `❌ Error resetting stuck jobs: ${error.message}`);
  }
}

// Command line interface
const command = process.argv[2];

if (command === 'reset') {
  log(colors.yellow, '🔄 Resetting stuck jobs...');
  resetStuckJobs().then(() => process.exit(0));
} else {
  checkJobQueue().then(() => process.exit(0));
}
