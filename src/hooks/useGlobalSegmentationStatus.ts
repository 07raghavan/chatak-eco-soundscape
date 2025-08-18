import { useState, useEffect, useCallback } from 'react';
import { createSegmentationProgressStream, getSegmentationJobStatus } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export interface SegmentationJob {
  job_id: string;
  recording_id: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  progress_message: string;
  created_at: string;
  updated_at: string;
  error?: string;
}

interface GlobalSegmentationState {
  activeJobs: Map<string, SegmentationJob>;
  eventSources: Map<string, EventSource>;
}

// Global state that persists across page navigation
let globalState: GlobalSegmentationState = {
  activeJobs: new Map(),
  eventSources: new Map()
};

// Global listeners for state changes
const listeners = new Set<() => void>();

const notifyListeners = () => {
  listeners.forEach(listener => listener());
};

export const useGlobalSegmentationStatus = () => {
  const { token } = useAuth();
  const [, forceUpdate] = useState({});

  // Force re-render when global state changes
  const triggerUpdate = useCallback(() => {
    forceUpdate({});
  }, []);

  useEffect(() => {
    listeners.add(triggerUpdate);
    return () => {
      listeners.delete(triggerUpdate);
    };
  }, [triggerUpdate]);

  const startTrackingJob = useCallback((jobId: string, recordingId: number) => {
    if (!token || globalState.activeJobs.has(jobId)) return;

    // Add job to tracking
    const job: SegmentationJob = {
      job_id: jobId,
      recording_id: recordingId,
      status: 'queued',
      progress: 0,
      progress_message: 'Job queued...',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    globalState.activeJobs.set(jobId, job);

    // Start SSE connection
    const eventSource = createSegmentationProgressStream(jobId, token);
    globalState.eventSources.set(jobId, eventSource);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const updatedJob: SegmentationJob = {
          job_id: data.job_id,
          recording_id: data.recording_id || recordingId,
          status: data.status,
          progress: data.progress || 0,
          progress_message: data.progress_message || 'Processing...',
          created_at: data.created_at || job.created_at,
          updated_at: data.updated_at || new Date().toISOString(),
          error: data.error
        };

        globalState.activeJobs.set(jobId, updatedJob);
        notifyListeners();

        // Clean up completed jobs after a delay
        if (data.status === 'succeeded' || data.status === 'failed') {
          setTimeout(() => {
            stopTrackingJob(jobId);
          }, 5000);
        }
      } catch (err) {
        console.error('Error parsing SSE data:', err);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      // Try to get status via polling as fallback
      pollJobStatus(jobId);
    };

    notifyListeners();
  }, [token]);

  const stopTrackingJob = useCallback((jobId: string) => {
    const eventSource = globalState.eventSources.get(jobId);
    if (eventSource) {
      eventSource.close();
      globalState.eventSources.delete(jobId);
    }
    globalState.activeJobs.delete(jobId);
    notifyListeners();
  }, []);

  const pollJobStatus = useCallback(async (jobId: string) => {
    try {
      const status = await getSegmentationJobStatus(jobId);
      const job = globalState.activeJobs.get(jobId);
      if (job) {
        const updatedJob: SegmentationJob = {
          ...job,
          status: status.status,
          progress: status.progress || 0,
          progress_message: status.progress_message || 'Processing...',
          updated_at: status.updated_at || new Date().toISOString(),
          error: status.error
        };
        globalState.activeJobs.set(jobId, updatedJob);
        notifyListeners();

        // Continue polling if still running
        if (status.status === 'running' || status.status === 'queued') {
          setTimeout(() => pollJobStatus(jobId), 2000);
        }
      }
    } catch (err) {
      console.error('Error polling job status:', err);
    }
  }, []);

  const getJobsForRecording = useCallback((recordingId: number): SegmentationJob[] => {
    return Array.from(globalState.activeJobs.values())
      .filter(job => job.recording_id === recordingId);
  }, []);

  const getAllActiveJobs = useCallback((): SegmentationJob[] => {
    return Array.from(globalState.activeJobs.values());
  }, []);

  const hasActiveJobs = useCallback((): boolean => {
    return globalState.activeJobs.size > 0;
  }, []);

  const getRunningJobsCount = useCallback((): number => {
    return Array.from(globalState.activeJobs.values())
      .filter(job => job.status === 'running' || job.status === 'queued').length;
  }, []);

  // Cleanup on unmount (only if no other components are using it)
  useEffect(() => {
    return () => {
      // Don't cleanup global state on component unmount
      // It should persist across page navigation
    };
  }, []);

  return {
    startTrackingJob,
    stopTrackingJob,
    getJobsForRecording,
    getAllActiveJobs,
    hasActiveJobs,
    getRunningJobsCount,
    activeJobs: Array.from(globalState.activeJobs.values())
  };
};
