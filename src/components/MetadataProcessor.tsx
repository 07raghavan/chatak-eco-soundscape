import React, { useState, useEffect } from 'react';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertCircle, CheckCircle, Clock, Music } from 'lucide-react';

interface Recording {
  id: number;
  name: string;
  file_path: string;
  status: string;
  created_at: string;
}

interface MetadataProcessorProps {
  onMetadataProcessed?: () => void;
}

export const MetadataProcessor: React.FC<MetadataProcessorProps> = ({ onMetadataProcessed }) => {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string>('');

  // Load recordings with missing metadata
  const loadRecordings = async () => {
    try {
      setLoading(true);
      setError('');
      
      const response = await apiRequest('/api/recordings/missing-metadata');
      setRecordings(response.recordings || []);
      
    } catch (err: any) {
      setError(err.message || 'Failed to load recordings');
    } finally {
      setLoading(false);
    }
  };

  // Process metadata for a specific recording
  const processRecordingMetadata = async (recordingId: number) => {
    try {
      setProcessing(prev => new Set(prev).add(recordingId));
      setError('');
      
      const response = await apiRequest(`/api/recordings/${recordingId}/metadata`, {
        method: 'POST'
      });
      
      if (response.success) {
        // Remove from list or update status
        setRecordings(prev => prev.filter(r => r.id !== recordingId));
        
        if (onMetadataProcessed) {
          onMetadataProcessed();
        }
      }
      
    } catch (err: any) {
      setError(`Failed to process metadata for recording ${recordingId}: ${err.message}`);
    } finally {
      setProcessing(prev => {
        const newSet = new Set(prev);
        newSet.delete(recordingId);
        return newSet;
      });
    }
  };

  // Process all recordings
  const processAllMetadata = async () => {
    for (const recording of recordings) {
      if (!processing.has(recording.id)) {
        await processRecordingMetadata(recording.id);
        // Small delay to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  };

  // Load recordings on component mount
  useEffect(() => {
    loadRecordings();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'uploaded':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Pending Metadata</Badge>;
      case 'metadata_failed':
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Metadata Failed</Badge>;
      case 'processing':
        return <Badge variant="outline"><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Processing</Badge>;
      case 'processed':
        return <Badge variant="default"><CheckCircle className="w-3 h-3 mr-1" />Processed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (recordings.length === 0 && !loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Music className="w-5 h-5" />
            Metadata Processing
          </CardTitle>
          <CardDescription>
            All recordings have been processed successfully!
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="w-4 h-4" />
            <span>No recordings require metadata processing</span>
          </div>
          <Button 
            variant="outline" 
            onClick={loadRecordings} 
            className="mt-4"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Music className="w-5 h-5" />
          Metadata Processing
          {recordings.length > 0 && (
            <Badge variant="secondary">{recordings.length} pending</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Process metadata for recordings that failed automatic extraction
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-center gap-2 text-red-700">
              <AlertCircle className="w-4 h-4" />
              <span>{error}</span>
            </div>
          </div>
        )}

        <div className="flex gap-2 mb-4">
          <Button 
            onClick={loadRecordings} 
            variant="outline"
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          
          {recordings.length > 0 && (
            <Button 
              onClick={processAllMetadata}
              disabled={processing.size > 0}
            >
              <Music className="w-4 h-4 mr-2" />
              Process All ({recordings.length})
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" />
            <span>Loading recordings...</span>
          </div>
        ) : (
          <div className="space-y-3">
            {recordings.map((recording) => (
              <div 
                key={recording.id}
                className="flex items-center justify-between p-3 border rounded-lg"
              >
                <div className="flex-1">
                  <div className="font-medium">{recording.name}</div>
                  <div className="text-sm text-gray-500">
                    ID: {recording.id} • Uploaded: {formatDate(recording.created_at)}
                  </div>
                  <div className="mt-1">
                    {getStatusBadge(recording.status)}
                  </div>
                </div>
                
                <Button
                  onClick={() => processRecordingMetadata(recording.id)}
                  disabled={processing.has(recording.id)}
                  size="sm"
                >
                  {processing.has(recording.id) ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Music className="w-4 h-4 mr-2" />
                      Process Metadata
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
