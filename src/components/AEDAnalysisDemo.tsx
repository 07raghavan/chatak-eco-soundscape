import React, { useState, useEffect } from 'react';
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
  getAEDEventsForRecording 
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
      const eventsData = await getAEDEventsForRecording(recordingId);
      setAedEvents(eventsData || []);
      calculateEventStats(eventsData || [], recording);
    } catch (eventsError) {
      console.log('No existing AED events found for current recording');
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

      const response = await runOptimizedAEDForRecording(
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

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    const seconds = ms / 1000;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = (seconds % 60).toFixed(1);
    return `${minutes}:${remainingSeconds.padStart(4, '0')}`;
  };

  const formatTime = (ms: number) => {
    const seconds = ms / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
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
                <CardTitle>Detected Events</CardTitle>
              </CardHeader>
              <CardContent>
                {aedEvents.length > 0 ? (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {aedEvents.map((event, index) => (
                      <div 
                        key={event.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          selectedEvent?.id === event.id ? 'bg-blue-50 border-blue-300' : 'hover:bg-gray-50'
                        }`}
                        onClick={() => setSelectedEvent(event)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Badge variant="outline">
                            {event.band_name?.replace('_', ' ') || 'unknown'}
                          </Badge>
                          <span className="text-sm text-gray-500">
                            {formatTime(event.start_ms)} - {formatTime(event.end_ms)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span>
                            Confidence: {((event.confidence || 0) * 100).toFixed(0)}%
                          </span>
                          {event.snr_db && (
                            <span>SNR: {event.snr_db.toFixed(1)}dB</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    No AED events detected yet.
                    {approvedSegments.length > 0 && ' Click "Run AED Analysis" to detect events.'}
                  </p>
                )}
              </CardContent>
            </Card>

            {selectedEvent && (
              <Card>
                <CardHeader>
                  <CardTitle>Event Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-semibold mb-2">Time & Frequency</h4>
                      <p><strong>Start:</strong> {formatTime(selectedEvent.start_ms)}</p>
                      <p><strong>End:</strong> {formatTime(selectedEvent.end_ms)}</p>
                      <p><strong>Duration:</strong> {formatDuration(selectedEvent.end_ms - selectedEvent.start_ms)}</p>
                      {selectedEvent.f_min_hz && (
                        <p><strong>Frequency Range:</strong> {selectedEvent.f_min_hz} - {selectedEvent.f_max_hz} Hz</p>
                      )}
                      {selectedEvent.peak_freq_hz && (
                        <p><strong>Peak Frequency:</strong> {selectedEvent.peak_freq_hz} Hz</p>
                      )}
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">Detection Quality</h4>
                      <p><strong>Confidence:</strong> {((selectedEvent.confidence || 0) * 100).toFixed(1)}%</p>
                      {selectedEvent.snr_db && (
                        <p><strong>Signal-to-Noise Ratio:</strong> {selectedEvent.snr_db.toFixed(1)} dB</p>
                      )}
                      <p><strong>Detection Method:</strong> {selectedEvent.method || 'Industry Standard v2'}</p>
                      <p><strong>Frequency Band:</strong> {selectedEvent.band_name?.replace('_', ' ') || 'Unknown'}</p>
                    </div>

                    <div>
                      <h4 className="font-semibold mb-2">Actions</h4>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline">
                          <Eye className="w-4 h-4 mr-2" />
                          View in Spectrogram
                        </Button>
                        {selectedEvent.snippet_s3_key && (
                          <Button size="sm" variant="outline">
                            <Clock className="w-4 h-4 mr-2" />
                            Play Snippet
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
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
    </div>
  );
};

export default AEDAnalysisDemo;
