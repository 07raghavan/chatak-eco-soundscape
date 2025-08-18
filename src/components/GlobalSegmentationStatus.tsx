import React from 'react';
import { Scissors, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useGlobalSegmentationStatus } from '@/hooks/useGlobalSegmentationStatus';

export const GlobalSegmentationStatus: React.FC = () => {
  const { activeJobs, hasActiveJobs, getRunningJobsCount } = useGlobalSegmentationStatus();

  if (!hasActiveJobs()) {
    return null;
  }

  const runningCount = getRunningJobsCount();
  const completedJobs = activeJobs.filter(job => job.status === 'succeeded');
  const failedJobs = activeJobs.filter(job => job.status === 'failed');

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm">
      <Card className="bg-white/95 backdrop-blur-sm border-green-200 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Scissors className="w-5 h-5 text-green-600" />
            <h3 className="font-semibold text-green-800">Segmentation Status</h3>
          </div>
          
          <div className="space-y-2">
            {runningCount > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-blue-500 animate-spin" />
                  <span className="text-sm">Processing</span>
                </div>
                <Badge variant="secondary">{runningCount}</Badge>
              </div>
            )}
            
            {completedJobs.length > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm">Completed</span>
                </div>
                <Badge variant="default">{completedJobs.length}</Badge>
              </div>
            )}
            
            {failedJobs.length > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-500" />
                  <span className="text-sm">Failed</span>
                </div>
                <Badge variant="destructive">{failedJobs.length}</Badge>
              </div>
            )}
          </div>

          {/* Show active job details */}
          {activeJobs.filter(job => job.status === 'running' || job.status === 'queued').slice(0, 2).map(job => (
            <div key={job.job_id} className="mt-3 p-2 bg-blue-50 rounded-lg">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium">Recording {job.recording_id}</span>
                <span className="text-xs text-gray-500">{job.progress}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div 
                  className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" 
                  style={{ width: `${job.progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-600 mt-1">{job.progress_message}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};
