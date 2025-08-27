import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Zap, BarChart3, Eye, CheckCircle, AlertCircle, 
  Clock, Target, Layers, TrendingUp, RefreshCw, Image 
} from 'lucide-react';
import { 
  getRecordingById, 
  getApprovedSegments, 
  runIndustryAEDForRecording,
  runOptimizedAEDForRecording,
  runOptimizedAEDForAllSegments,
  getAEDEventsForRecording,
  getAudioSnippetSignedUrl
} from '@/lib/api';
import FastSpectrogramViewer from '@/components/FastSpectrogramViewer';
import SegmentSpectrogramViewer from '@/components/SegmentSpectrogramViewer';

interface AEDAnalysisDemoProps {
  recordingId: number;
  recordings?: any[];
  onRecordingChange?: (id: number) => void;
}

interface EventStats {
  total: number;
  byBand: { [key: string]: number };
  avgConfidence: number;
  avgDuration: number;
  coveragePercent: number;
}

// Audio Player Component for AED Events
const AEDEventAudioPlayer = ({ audioData, isVisible, onClose, recordings }: { 
  audioData: any; 
  isVisible: boolean; 
  onClose: () => void; 
  recordings: any[];
}) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Helper functions for formatting time
  const formatTime = (ms: number) => {
    if (!ms && ms !== 0) return '0:00.0';
    const seconds = Math.floor(ms / 1000);
    const milliseconds = Math.floor((ms % 1000) / 100);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds}`;
  };

  const formatDuration = (ms: number) => {
    if (!ms && ms !== 0) return '0:00.0';
    const seconds = Math.floor(ms / 1000);
    const milliseconds = Math.floor((ms % 1000) / 100);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}.${milliseconds}`;
  };

  useEffect(() => {
    if (isVisible && audioData?.recording_id && audioData?.aed_event_id) {
      console.log('🎵 Audio player opened with data:', {
        event: {
          start: audioData.start_ms,
          end: audioData.end_ms,
          duration: audioData.duration_ms
        },
        recording: {
          id: audioData.recording_id,
          event_id: audioData.aed_event_id
        }
      });
      generateAudioUrl();
    }
  }, [isVisible, audioData]);

  const generateAudioUrl = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('🎵 Audio player opened with data:', audioData);
      console.log('🎵 Recordings passed to audio player:', recordings);
      
      // FIXED: Use snippet_s3_key directly from the AED event
      if (audioData.snippet_s3_key) {
        // Get signed URL from backend for secure S3 access
        try {
          console.log('🎵 Getting signed URL for snippet:', audioData.snippet_s3_key);
          console.log('🎵 Expected event duration:', audioData.duration_ms, 'ms');
          console.log('🎵 Expected event timing:', audioData.start_ms, 'ms -', audioData.end_ms, 'ms');
          
          const signedUrl = await getAudioSnippetSignedUrl(audioData.snippet_s3_key);
          console.log('🎵 Using signed URL for snippet:', signedUrl);
          setAudioUrl(signedUrl);
        } catch (error) {
          console.error('❌ Failed to get signed URL for snippet:', error);
          setError('Failed to get audio snippet URL');
        }
        return;
      }
      
      // Fallback: If no snippet available, try to extract from full recording
      console.log('🎵 Looking for recording with ID:', audioData.recording_id);
      console.log('🎵 Available recordings:', recordings);
      
      let recording = recordings.find(r => r.id === parseInt(audioData.recording_id));
      
      // Fallback: If no recording found in array, try to use the current recording
      if (!recording && recordings.length === 0) {
        console.log('🎵 No recordings array, trying to use current recording...');
        // We'll need to get the recording data from the parent component
        // For now, let's try to construct a basic recording object
        recording = {
          id: parseInt(audioData.recording_id),
          s3_key: `recordings/${audioData.recording_id}.flac`, // Default S3 key pattern
          s3_url: `https://chatak-audio-recordings.s3.us-east-1.amazonaws.com/recordings/${audioData.recording_id}.flac`
        };
        console.log('🎵 Created fallback recording:', recording);
      }
      
      console.log('🔍 Available recordings:', recordings);
      console.log('🔍 Looking for recording ID:', audioData.recording_id);
      console.log('🔍 Found recording:', recording);
      
      if (!recording) {
        console.error('❌ Recording not found. Available recordings:', recordings.map(r => ({ id: r.id, name: r.name || r.filename })));
        throw new Error('Recording not found');
      }
      
      // Check what fields are available in the recording
      console.log('🔍 Recording fields:', Object.keys(recording));
      console.log('🔍 Recording s3_key:', recording.s3_key);
      console.log('🔍 Recording s3_url:', recording.s3_url);
      console.log('🔍 Recording url:', recording.url);
      
      // Try different possible URL fields
      let audioUrl = null;
      if (recording.s3_url) {
        audioUrl = recording.s3_url;
      } else if (recording.url) {
        audioUrl = recording.url;
      } else if (recording.s3_key) {
        // Construct S3 URL from key
        audioUrl = `https://chatak-audio-recordings.s3.us-east-1.amazonaws.com/${recording.s3_key}`;
      } else {
        throw new Error('No audio URL or S3 key available for this recording');
      }
      
      console.log('🎵 Using fallback audio URL:', audioUrl);
      setAudioUrl(audioUrl);
      
    } catch (err: any) {
      console.error('❌ Error generating audio URL:', err);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlay = () => {
    if (audioRef.current && audioUrl) {
      if (audioData.snippet_s3_key) {
        // If we have a snippet, play it from the beginning (it's already the extracted event)
        console.log(`🎵 Playing AED event snippet:`, {
          snippetKey: audioData.snippet_s3_key,
          duration: audioData.duration_ms
        });
        audioRef.current.currentTime = 0;
        audioRef.current.play();
      } else {
        // Fallback: Event timing is relative to the recording, so use it directly
        const eventStartSeconds = audioData.start_ms / 1000;
        const eventEndSeconds = audioData.end_ms / 1000;
        
        console.log(`🎵 Playing AED event from full recording:`, {
          eventStart: audioData.start_ms,
          eventEnd: audioData.end_ms,
          startSeconds: eventStartSeconds,
          endSeconds: eventEndSeconds,
          duration: eventEndSeconds - eventStartSeconds
        });
        
        // Set the start time to the event's start time in the recording
        audioRef.current.currentTime = eventStartSeconds;
        audioRef.current.play();
      }
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      if (audioData.snippet_s3_key) {
        // If we have a snippet, let it play through (it's already the extracted event)
        return;
      }
      
      // Fallback: For full recording playback, stop at event end
      const currentTime = audioRef.current.currentTime;
      const eventStartSeconds = audioData.start_ms / 1000;
      const eventEndSeconds = audioData.end_ms / 1000;
      
      // Stop playback when we reach the end of the AED event
      if (currentTime >= eventEndSeconds) {
        console.log(`⏹️ Reached event end, stopping playback at ${currentTime.toFixed(2)}s`);
        audioRef.current.pause();
        audioRef.current.currentTime = eventEndSeconds;
      }
    }
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">🎵 AED Event Audio</h3>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="text-sm text-gray-600">
            <p><strong>Event ID:</strong> #{audioData.roi_id}</p>
            <p><strong>Event Timing:</strong> {formatTime(audioData.start_ms)} - {formatTime(audioData.end_ms)}</p>
            <p><strong>Event Duration:</strong> {formatDuration(audioData.duration_ms)}</p>
            <p><strong>Confidence:</strong> {((audioData.confidence || 0) * 100).toFixed(1)}%</p>
            {audioData.snr_db && (
              <p><strong>SNR:</strong> {audioData.snr_db.toFixed(1)} dB</p>
            )}
          </div>

          {isLoading && (
            <div className="text-center py-4">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
              <p>Loading audio...</p>
            </div>
          )}

          {error && (
            <div className="text-red-600 text-center py-2">
              <p>❌ Error: {error}</p>
            </div>
          )}

          {audioUrl && !isLoading && (
            <div className="space-y-3">
              <audio
                ref={audioRef}
                controls
                onTimeUpdate={handleTimeUpdate}
                onError={(e) => {
                  console.error('❌ Audio loading error:', e);
                  setError('Failed to load audio file');
                }}
                onLoadStart={() => console.log('🎵 Audio loading started...')}
                onCanPlay={() => console.log('🎵 Audio can play!')}
                onLoadedData={() => {
                  console.log('🎵 Audio data loaded successfully');
                  if (audioRef.current) {
                    console.log('🎵 Audio duration:', audioRef.current.duration);
                    console.log('🎵 Audio current time:', audioRef.current.currentTime);
                    console.log('🎵 Expected event duration:', audioData.duration_ms / 1000);
                    
                    if (audioRef.current.duration === 0 || isNaN(audioRef.current.duration)) {
                      console.error('❌ Audio duration is 0 or NaN - file may be empty or corrupted');
                      setError('Audio file appears to be empty or corrupted');
                    } else {
                      // Check if the audio duration matches the expected event duration
                      const expectedDuration = audioData.duration_ms / 1000;
                      const actualDuration = audioRef.current.duration;
                      const durationDiff = Math.abs(actualDuration - expectedDuration);
                      
                      console.log(`🎵 Duration check: expected=${expectedDuration}s, actual=${actualDuration}s, diff=${durationDiff}s`);
                      
                      if (durationDiff > 0.5) {
                        console.warn(`⚠️ Audio duration mismatch: expected ${expectedDuration}s, got ${actualDuration}s`);
                        setError(`Audio duration mismatch: expected ${expectedDuration.toFixed(1)}s, got ${actualDuration.toFixed(1)}s`);
                      }
                    }
                  }
                }}
                className="w-full"
                preload="metadata"
              >
                <source src={audioUrl} type="audio/wav" />
                <source src={audioUrl} type="audio/mpeg" />
                <source src={audioUrl} type="audio/flac" />
                Your browser does not support the audio element.
              </audio>
              
              <div className="text-center">
                <Button 
                  onClick={handlePlay} 
                  className="w-full"
                >
                  🎵 Play AED Event Only
                </Button>
                <p className="text-xs text-gray-500 mt-1">
                  This will play only the detected event portion ({formatDuration(audioData.duration_ms)}) from the recording
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const AEDAnalysisDemo: React.FC<AEDAnalysisDemoProps> = ({ recordingId, recordings = [], onRecordingChange }) => {
  const [recording, setRecording] = useState<any>(null);
  const [approvedSegments, setApprovedSegments] = useState<any[]>([]);
  const [aedEvents, setAedEvents] = useState<any[]>([]);
  const [eventStats, setEventStats] = useState<EventStats | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aedRunning, setAedRunning] = useState(false);
  const [aedResults, setAedResults] = useState<any>(null);
  const [selectedRecordingForResults, setSelectedRecordingForResults] = useState<number>(recordingId);
  const [aedProgress, setAedProgress] = useState(0);
  const [aedProgressMessage, setAedProgressMessage] = useState('');

  useEffect(() => {
    loadData();
  }, [recordingId]);

  // Load AED events when selectedRecordingForResults changes
  useEffect(() => {
    loadAEDEventsForSelectedRecording();
  }, [selectedRecordingForResults]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load recording details
      const recordingData = await getRecordingById(recordingId);
      setRecording(recordingData);

      // Load approved segments
      const segmentsData = await getApprovedSegments(recordingId);
      setApprovedSegments(Array.isArray(segmentsData) ? segmentsData : []);

      // Always try to load AED events from database - this fixes persistence issue
      await loadAEDEventsForCurrentRecording();

    } catch (err: any) {
      console.error('Failed to load data:', err);
      setError('Failed to load recording data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAEDEventsForCurrentRecording = async () => {
    try {
      console.log(`🔍 Loading AED events for recording ${recordingId}...`);
      const eventsData = await getAEDEventsForRecording(recordingId);
      console.log(`✅ AED events loaded:`, eventsData);
      setAedEvents(eventsData || []);
      calculateEventStats(eventsData || [], recording);
    } catch (eventsError) {
      console.error(`❌ Error loading AED events for recording ${recordingId}:`, eventsError);
      setAedEvents([]);
      setEventStats(null);
    }
  };

  const loadAEDEventsForSelectedRecording = async () => {
    try {
      const eventsData = await getAEDEventsForRecording(selectedRecordingForResults);
      setAedEvents(eventsData || []);
      const selectedRecordingData = await getRecordingById(selectedRecordingForResults);
      calculateEventStats(eventsData || [], selectedRecordingData);
    } catch (eventsError) {
      console.log(`No AED events found for recording ${selectedRecordingForResults}`);
      setAedEvents([]);
      setEventStats(null);
    }
  };

  const calculateEventStats = (events: any[], recording: any) => {
    if (!events || events.length === 0) {
      setEventStats(null);
      return;
    }

    const byBand: { [key: string]: number } = {};
    let totalConfidence = 0;
    let totalDuration = 0;
    let validConfidenceCount = 0;

    events.forEach(event => {
      // Band statistics
      const bandName = event.band_name || 'unknown';
      byBand[bandName] = (byBand[bandName] || 0) + 1;

      // Confidence statistics
      if (event.confidence && event.confidence > 0) {
        totalConfidence += event.confidence;
        validConfidenceCount++;
      }

      // Duration statistics
      totalDuration += (event.end_ms - event.start_ms);
    });

    const avgConfidence = validConfidenceCount > 0 ? totalConfidence / validConfidenceCount : 0;
    const avgDuration = totalDuration / events.length;

    // Calculate coverage (simplified - assumes events don't overlap significantly)
    const totalRecordingDuration = (recording?.duration_seconds || 0) * 1000;
    const eventCoverage = totalDuration;
    const coveragePercent = totalRecordingDuration > 0 ? (eventCoverage / totalRecordingDuration) * 100 : 0;

    setEventStats({
      total: events.length,
      byBand,
      avgConfidence,
      avgDuration,
      coveragePercent
    });
  };

  const runAEDAnalysis = async () => {
    try {
      setAedRunning(true);
      setError(null);
      setAedProgress(0);
      setAedProgressMessage('Starting analysis...');

      console.log(`🚀 Running optimized AED analysis for recording ${recordingId}`);

      const response = await runOptimizedAEDForAllSegments(
        recordingId,
        {
          // Optimized configuration for speed
          nFFT: 1024,
          hopMs: 10,
          nMels: 64,
          minDurationMs: 80,
          maxDurationMs: 8000,
          mergeGapMs: 150,
          targetBands: [
            { name: 'low_freq', fmin: 800, fmax: 3000 },
            { name: 'mid_freq', fmin: 3000, fmax: 10000 },
            { name: 'high_freq', fmin: 10000, fmax: 20000 }
          ]
        },
        (percent, message) => {
          setAedProgress(percent);
          setAedProgressMessage(message);
        }
      );

      setAedResults(response);
      setAedProgress(100);
      setAedProgressMessage('Complete!');

      // Reload events to show newly detected ones
      const eventsData = await getAEDEventsForRecording(recordingId);
      setAedEvents(eventsData);
      calculateEventStats(eventsData, recording);

      console.log(`✅ Optimized AED analysis completed: ${response.events_detected} events detected`);

      // Show success message with segment info
      if (response.events_detected > 0) {
        setAedProgressMessage(`✅ Analysis complete! ${response.events_detected} events detected. Check the "Segments & Spectrograms" tab to see detected events on segment spectrograms.`);
      } else {
        setAedProgressMessage(`✅ Analysis complete! No events detected. Check the "Segments & Spectrograms" tab to generate segment spectrograms.`);
      }

    } catch (err: any) {
      console.error('Failed to run AED analysis:', err);
      setError('Failed to run AED analysis: ' + err.message);
      setAedProgress(0);
      setAedProgressMessage('');
    } finally {
      setAedRunning(false);
    }
  };

  const handleEventClick = (event: any) => {
    setSelectedEvent(event);
  };

  const formatTime = (ms: number) => {
    if (!ms || isNaN(ms)) return '0:00.0';
    const seconds = ms / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  };

  const formatDuration = (ms: number) => {
    if (!ms || isNaN(ms)) return '0:00.0';
    const seconds = ms / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  };

  // Audio playback state
  const [audioPlayerVisible, setAudioPlayerVisible] = useState(false);
  const [currentAudioData, setCurrentAudioData] = useState<any>(null);
  const [audioLoading, setAudioLoading] = useState(false);

  // Handle ROI audio request from event list
  const handleEventAudioRequest = async (event: any) => {
    if (!event || !event.id) return;
    
    try {
      setAudioLoading(true);
      console.log('🎵 Requesting audio for AED event:', event.id);
      console.log('🎵 Event details:', {
        id: event.id,
        start_ms: event.start_ms,
        end_ms: event.end_ms,
        duration: (parseInt(event.end_ms) || 0) - (parseInt(event.start_ms) || 0),
        snippet_s3_key: event.snippet_s3_key
      });
      console.log('🎵 Available recordings:', recordings);
      console.log('🎵 Current recording:', recording);
      
      // Create audio data structure for AED event playback directly from recording
      const audioData = {
        roi_id: event.id,
        cluster_id: 'aed_event',
        cluster_label: 'aed',
        aed_event_id: event.id.toString(),
        recording_id: recordingId.toString(),
        start_ms: parseInt(event.start_ms) || 0,
        end_ms: parseInt(event.end_ms) || 0,
        duration_ms: (parseInt(event.end_ms) || 0) - (parseInt(event.start_ms) || 0),
        audio_type: 'aed_event',
        confidence: event.confidence || 0,
        snr_db: event.snr_db || null,
        method: event.method || 'unknown',
        snippet_s3_key: event.snippet_s3_key || null
      };
      
      console.log('🎵 Created audio data:', audioData);
      console.log('🎵 Snippet key for this event:', audioData.snippet_s3_key);
      
      setCurrentAudioData(audioData);
      setAudioPlayerVisible(true);
    } catch (error) {
      console.error('❌ Error preparing audio for event:', error);
    } finally {
      setAudioLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="w-full">
        <CardContent className="p-6 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p>Loading AED analysis...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert>
        <AlertCircle className="w-4 h-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5" />
            Acoustic Event Detection Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold mb-2">Recording Details</h4>
              <p><strong>Name:</strong> {recording?.name}</p>
              <p><strong>Duration:</strong> {recording?.duration_seconds ? formatDuration(recording.duration_seconds * 1000) : 'Unknown'}</p>
              <p><strong>Sample Rate:</strong> 32kHz (inferred)</p>
            </div>
            <div>
              <h4 className="font-semibold mb-2">Processing Status</h4>
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span>Approved Segments: {approvedSegments?.length || 0}</span>
              </div>
              <div className="flex items-center gap-2 mb-2">
                {aedEvents.length > 0 ? (
                  <CheckCircle className="w-4 h-4 text-green-500" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-orange-500" />
                )}
                <span>AED Events: {aedEvents.length}</span>
              </div>
              {(approvedSegments?.length || 0) > 0 && aedEvents.length === 0 && (
                <>
                  <Button 
                    onClick={runAEDAnalysis} 
                    disabled={aedRunning}
                    className="mt-2"
                  >
                    {aedRunning ? (
                      <>
                        <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2" />
                        Running AED...
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4 mr-2" />
                        Run AED Analysis
                      </>
                    )}
                  </Button>
                  {aedRunning && (
                    <div className="mt-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>{aedProgressMessage}</span>
                        <span>{Math.round(aedProgress)}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${aedProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AED Results Summary */}
      {aedResults && (
        <Alert>
          <Zap className="w-4 h-4" />
          <AlertDescription>
            <strong>AED Analysis Complete!</strong> Detected {aedResults.events_detected} acoustic events 
            across {aedResults.segments_processed} approved segments 
            ({aedResults.coverage_percent}% recording coverage). 
            Processing method: {aedResults.method}
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content Tabs */}
      <Tabs defaultValue="segments" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="statistics">
            <BarChart3 className="w-4 h-4 mr-2" />
            Statistics
          </TabsTrigger>
          <TabsTrigger value="events">
            <Layers className="w-4 h-4 mr-2" />
            Events
          </TabsTrigger>
          <TabsTrigger value="segments">
            <Image className="w-4 h-4 mr-2" />
            Segments & Spectrograms
          </TabsTrigger>
        </TabsList>

        {/* Statistics Tab */}
        <TabsContent value="statistics">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Event Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {eventStats ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-gray-600">Total Events</p>
                        <p className="text-2xl font-bold text-blue-600">{eventStats.total}</p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Avg Confidence</p>
                        <p className="text-2xl font-bold text-green-600">
                          {(eventStats.avgConfidence * 100).toFixed(0)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Avg Duration</p>
                        <p className="text-2xl font-bold text-orange-600">
                          {formatDuration(eventStats.avgDuration)}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm text-gray-600">Coverage</p>
                        <p className="text-2xl font-bold text-purple-600">
                          {eventStats.coveragePercent.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                    
                    <div>
                      <h4 className="font-semibold mb-2">Events by Frequency Band</h4>
                      <div className="space-y-2">
                        {Object.entries(eventStats.byBand).map(([band, count]) => (
                          <div key={band} className="flex items-center justify-between">
                            <Badge variant="outline">{band.replace('_', ' ')}</Badge>
                            <span className="font-medium">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-gray-500">No AED events to analyze yet.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Processing Quality
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span>Approved Segments</span>
                    <Badge variant="outline">{approvedSegments.length}</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span>Detection Method</span>
                    <Badge>Industry Standard v2</Badge>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span>Multi-band Analysis</span>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span>Spectral Novelty</span>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <span>Onset Detection</span>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  </div>

                  {eventStats && (
                    <div className="pt-4 border-t">
                      <p className="text-sm text-gray-600 mb-2">Quality Metrics</p>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span>High Confidence (&gt;80%)</span>
                          <span>
                            {aedEvents.filter(e => (e.confidence || 0) > 0.8).length}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Medium Confidence (60-80%)</span>
                          <span>
                            {aedEvents.filter(e => (e.confidence || 0) > 0.6 && (e.confidence || 0) <= 0.8).length}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Low Confidence (&lt;60%)</span>
                          <span>
                            {aedEvents.filter(e => (e.confidence || 0) <= 0.6).length}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Event Details Tab */}
        <TabsContent value="events">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Detected Events by Segment</CardTitle>
              </CardHeader>
              <CardContent>
                {aedEvents && aedEvents.length > 0 ? (
                  <div className="space-y-4 max-h-96 overflow-y-auto">
                    {/* Group events by segment */}
                    {(() => {
                      // Group events by segment_id
                      const eventsBySegment = aedEvents.reduce((acc, event) => {
                        const segmentId = event.segment_id;
                        if (!acc[segmentId]) {
                          acc[segmentId] = [];
                        }
                        acc[segmentId].push(event);
                        return acc;
                      }, {} as { [key: string]: any[] });

                      // Sort segments by their start time (if available)
                      const sortedSegmentIds = Object.keys(eventsBySegment).sort((a, b) => {
                        const segmentA = approvedSegments.find(s => s.id === parseInt(a));
                        const segmentB = approvedSegments.find(s => s.id === parseInt(b));
                        return (segmentA?.start_ms || 0) - (segmentB?.start_ms || 0);
                      });

                      return sortedSegmentIds.map(segmentId => {
                        const segmentEvents = eventsBySegment[segmentId];
                        const segment = approvedSegments.find(s => s.id === parseInt(segmentId));
                        
                        return (
                          <div key={segmentId} className="border rounded-lg p-4 bg-gray-50">
                            {/* Segment Header */}
                            <div className="flex items-center justify-between mb-3 pb-2 border-b">
                              <div>
                                <h4 className="font-semibold text-lg">
                                  Segment {segmentId}
                                </h4>
                                {segment && (
                                  <p className="text-sm text-gray-600">
                                    {formatTime(segment.start_ms || 0)} - {formatTime((segment.start_ms || 0) + (segment.duration_ms || 0))}
                                    {segment.duration_ms && ` (${formatDuration(segment.duration_ms)})`}
                                  </p>
                                )}
                              </div>
                              <Badge variant="outline" className="text-sm">
                                {segmentEvents.length} event{segmentEvents.length !== 1 ? 's' : ''}
                              </Badge>
                            </div>

                            {/* Events in this segment */}
                            <div className="space-y-2">
                              {segmentEvents.map((event, index) => {
                                // Debug: Log event structure for first few events
                                if (index < 2) {
                                  console.log(`🔍 Segment ${segmentId} Event ${index + 1} structure:`, {
                                    id: event.id,
                                    start_ms: event.start_ms,
                                    end_ms: event.end_ms,
                                    segment_id: event.segment_id,
                                    snippet_s3_key: event.snippet_s3_key,
                                    confidence: event.confidence,
                                    method: event.method
                                  });
                                }
                                
                                return (
                                  <div 
                                    key={event.id || index}
                                    className={`p-3 border rounded-lg cursor-pointer transition-colors bg-white ${
                                      selectedEvent?.id === event.id ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'
                                    }`}
                                    onClick={() => setSelectedEvent(event)}
                                  >
                                    <div className="flex items-center justify-between mb-2">
                                      <Badge variant="outline" className="text-xs">
                                        {event.method?.replace('_', ' ') || 'unknown'}
                                      </Badge>
                                      <div className="flex items-center gap-2">
                                        {event.snippet_s3_key && (
                                          <span className="text-green-600 text-xs">🎵</span>
                                        )}
                                        <span className="text-sm text-gray-500">
                                          {formatTime(event.start_ms || 0)} - {formatTime(event.end_ms || 0)}
                                          {event.start_ms && event.end_ms && (
                                            <span className="ml-1 text-xs">
                                              ({formatDuration((event.end_ms || 0) - (event.start_ms || 0))})
                                            </span>
                                          )}
                                        </span>
                                      </div>
                                    </div>
                                    <div className="flex items-center justify-between text-sm">
                                      <span>
                                        Confidence: {((event.confidence || 0) * 100).toFixed(0)}%
                                      </span>
                                      {event.snr_db && (
                                        <span>SNR: {event.snr_db.toFixed(1)}dB</span>
                                      )}
                                    </div>
                                    <div className="flex items-center space-x-2 mt-2">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleEventAudioRequest(event);
                                        }}
                                        className="flex-1 text-xs"
                                      >
                                        {event.snippet_s3_key ? '🎵 Play Snippet' : '🎵 Play Event'}
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setSelectedEvent(event);
                                        }}
                                        className="flex-1 text-xs"
                                      >
                                        📊 Details
                                      </Button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    No AED events detected yet.
                    {approvedSegments && approvedSegments.length > 0 && ' Click "Run AED Analysis" to detect events.'}
                  </p>
                )}
              </CardContent>
            </Card>

            {selectedEvent && (
              <div className="bg-gray-50 p-4 rounded-lg">
                <h3 className="text-lg font-semibold mb-3">Event Details</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-medium text-gray-700 mb-2">Time & Frequency</h4>
                    <div className="space-y-1 text-sm">
                      <p><strong>Start:</strong> {formatTime(selectedEvent.start_ms)}</p>
                      <p><strong>End:</strong> {formatTime(selectedEvent.end_ms)}</p>
                      <p><strong>Duration:</strong> {formatDuration(selectedEvent.end_ms - selectedEvent.start_ms)}</p>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-gray-700 mb-2">Detection Quality</h4>
                    <div className="space-y-1 text-sm">
                      <p><strong>Confidence:</strong> {((selectedEvent.confidence || 0) * 100).toFixed(1)}%</p>
                      <p><strong>Detection Method:</strong> {selectedEvent.method || 'Unknown'}</p>
                      {selectedEvent.snr_db && (
                        <p><strong>SNR:</strong> {selectedEvent.snr_db.toFixed(1)} dB</p>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="mt-4">
                  <h4 className="font-medium text-gray-700 mb-2">Audio Information</h4>
                  <div className="space-y-1 text-sm">
                    {selectedEvent.snippet_s3_key ? (
                      <>
                        <p><strong>Audio Snippet:</strong> Available ✅</p>
                        <p><strong>Snippet Key:</strong> <code className="text-xs bg-gray-100 px-1 rounded">{selectedEvent.snippet_s3_key}</code></p>
                        <p><strong>Audio Source:</strong> Dedicated event snippet</p>
                      </>
                    ) : (
                      <>
                        <p><strong>Audio Snippet:</strong> Not available ❌</p>
                        <p><strong>Audio Source:</strong> Extract from full recording</p>
                      </>
                    )}
                    <p><strong>Event Timing:</strong> {formatTime(selectedEvent.start_ms)} - {formatTime(selectedEvent.end_ms)}</p>
                    <p><strong>Event Duration:</strong> {formatDuration(selectedEvent.end_ms - selectedEvent.start_ms)}</p>
                  </div>
                </div>
                
                <div className="mt-4 flex space-x-2">
                  <Button 
                    onClick={() => handleEventAudioRequest(selectedEvent)}
                    className="flex-1"
                  >
                    {selectedEvent.snippet_s3_key ? '🎵 Play Event Snippet' : '🎵 Play Event Audio'}
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => setSelectedEvent(null)}
                    className="flex-1"
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        </TabsContent>



        {/* Segment Spectrograms Tab */}
        <TabsContent value="segments">
          <SegmentSpectrogramViewer 
            recordingId={recordingId} 
            recording={recording}
            onSegmentSelect={(segment) => {
              console.log('Selected segment:', segment);
              // Could implement segment-specific actions here
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Audio Player Modal */}
      {audioPlayerVisible && currentAudioData && (
        <AEDEventAudioPlayer 
          audioData={currentAudioData} 
          isVisible={audioPlayerVisible} 
          onClose={() => setAudioPlayerVisible(false)} 
          recordings={recordings.length > 0 ? recordings : [recording]}
        />
      )}
    </div>
  );
};

export default AEDAnalysisDemo;
