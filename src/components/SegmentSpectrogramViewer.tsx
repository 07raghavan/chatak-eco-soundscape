import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Image, 
  Zap, 
  Clock, 
  CheckCircle2,
  AlertCircle,
  Loader2,
  Download,
  RefreshCw,
  Grid3X3,
  Play,
  Eye,
  ChevronRight,
  Maximize2
} from 'lucide-react';
import { 
  generateSegmentSpectrograms, 
  getSegmentSpectrograms,
  getApprovedSegmentsForSpectrogram,
  getAEDEventsForRecording
} from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { SpectrogramModal } from './SpectrogramModal';

interface SegmentSpectrogramViewerProps {
  recordingId: number;
  recording?: any;
  onSegmentSelect?: (segment: any) => void;
  className?: string;
}

interface SegmentSpectrogram {
  id: number;
  segment_id: number;
  recording_id: number;
  spectrogram_type: string;
  image_url?: string;
  image_s3_key?: string;
  aed_events_count: number;
  generation_time_ms?: number;
  file_size_bytes?: number;
  status: string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  qc_status: string;
  created_at: string;
}

interface GenerationProgress {
  message: string;
  total_segments: number;
  completed_segments: number;
  progress: number;
  timestamp: string;
}

export const SegmentSpectrogramViewer: React.FC<SegmentSpectrogramViewerProps> = ({
  recordingId,
  recording,
  onSegmentSelect,
  className = ''
}) => {
  const [segments, setSegments] = useState<any[]>([]);
  const [spectrograms, setSpectrograms] = useState<SegmentSpectrogram[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aedEvents, setAedEvents] = useState<any[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState<{spectrogram: SegmentSpectrogram | null; segment: any | null; events: any[]}>({ spectrogram: null, segment: null, events: [] });
  const { toast } = useToast();

  // Load segments and existing spectrograms
  useEffect(() => {
    loadSegmentsAndSpectrograms();
  }, [recordingId]);

  // Load AED events for context
  useEffect(() => {
    loadAEDEvents();
  }, [recordingId]);

  // Debug logging for spectrograms
  useEffect(() => {
    console.log(`🔍 SegmentSpectrogramViewer Debug:`, {
      recordingId,
      segmentsCount: segments.length,
      spectrogramsCount: spectrograms.length,
      spectrograms: spectrograms.map(s => ({
        id: s.id,
        segment_id: s.segment_id,
        status: s.status,
        image_url: s.image_url,
        hasImageUrl: !!s.image_url
      }))
    });
  }, [recordingId, segments, spectrograms]);

  const loadSegmentsAndSpectrograms = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load approved segments
      const approvedSegments = await getApprovedSegmentsForSpectrogram(recordingId);
      console.log('✅ Loaded', approvedSegments.length, 'segments');
      setSegments(approvedSegments);

      // Load existing spectrograms
      try {
        const spectrogramsData = await getSegmentSpectrograms(recordingId);
        console.log('🔍 RAW spectrograms response:', spectrogramsData);

        const spectrogramsArray = spectrogramsData.segment_spectrograms || [];
        console.log('✅ Loaded', spectrogramsArray.length, 'spectrograms with URLs');

        setSpectrograms(spectrogramsArray);
      } catch (spectrogramError) {
        // No existing spectrograms - that's OK
        console.log('No existing segment spectrograms found');
        setSpectrograms([]);
      }

    } catch (err: any) {
      console.error('Failed to load segments and spectrograms:', err);
      setError('Failed to load segments: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadAEDEvents = async () => {
    try {
      const events = await getAEDEventsForRecording(recordingId);
      setAedEvents(events || []);
    } catch (err) {
      console.log('No AED events found for recording');
      setAedEvents([]);
    }
  };

  const handleGenerateSpectrograms = async (forceRegenerate = false) => {
    if (segments.length === 0) {
      toast({
        title: "❌ No Segments",
        description: "No approved segments found for spectogram generation",
        variant: "destructive"
      });
      return;
    }

    try {
      setGenerating(true);
      setProgress(null);
      setError(null);

      console.log(`🎨 Starting segment spectrogram generation for ${segments.length} segments`);

      const result = await generateSegmentSpectrograms(
        recordingId,
        {
          colormap: 'viridis',
          n_fft: 512, // Higher resolution for segments
          hop_length: 128,
          dpi: 150, // Higher DPI for better detail
          min_confidence: 0.1, // Lower threshold to show more events
          include_bands: ['low_freq', 'mid_freq', 'high_freq'],
          force_regenerate: forceRegenerate
        },
        (progressData: GenerationProgress) => {
          setProgress(progressData);
          
          // Show toast for first completed segment
          if (progressData.completed_segments === 1 && progressData.total_segments > 1) {
            toast({
              title: "🎨 First Spectrogram Ready!",
              description: "Starting to display completed spectrograms while generation continues...",
            });
            // Reload spectrograms to show first completed one
            setTimeout(loadSegmentsAndSpectrograms, 1000);
          }
        }
      );

      if (result?.success) {
        toast({
          title: "✅ Spectrograms Generated!",
          description: `Generated ${result.successful_segments}/${result.total_segments} segment spectrograms`,
        });
        
        // Reload spectrograms
        await loadSegmentsAndSpectrograms();
        
        console.log(`✅ Generated ${result.successful_segments}/${result.total_segments} segment spectrograms`);
      } else {
        throw new Error(result?.error || 'Unknown generation error');
      }

    } catch (err: any) {
      console.error('❌ Segment spectrogram generation failed:', err);
      setError(err.message);
      
      toast({
        title: "❌ Generation Failed",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  const handleSegmentClick = useCallback((segment: any, spectrogram?: SegmentSpectrogram) => {
    setSelectedSegmentId(segment.id);
    if (onSegmentSelect) {
      onSegmentSelect({ ...segment, spectrogram });
    }
  }, [onSegmentSelect]);

  const formatTime = (ms: number) => {
    const seconds = ms / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getSegmentSpectrogram = (segmentId: number) => {
    // Handle type mismatch: segmentId is string, spec.segment_id is number
    const found = spectrograms.find(spec => spec.segment_id === Number(segmentId));

    return found;
  };

  const getSegmentAEDEvents = (segmentId: number) => {
    const events = aedEvents.filter(event => event.segment_id === Number(segmentId));
    if (events.length > 0) {
      console.log(`🎯 Found ${events.length} events for segment ${segmentId}:`, events);
    }
    return events;
  };

  const handleSpectrogramClick = (e: React.MouseEvent, segment: any, spectrogram: SegmentSpectrogram) => {
    e.stopPropagation(); // Prevent segment selection
    const segmentEvents = getSegmentAEDEvents(segment.id);
    setModalData({ spectrogram, segment, events: segmentEvents });
    setModalOpen(true);
  };

  if (loading) {
    return (
      <Card className={`w-full ${className}`}>
        <CardContent className="p-6 text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Loading segments and spectrograms...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`w-full ${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Grid3X3 className="w-5 h-5" />
            Segment Spectrograms
            <Badge variant="outline" className="ml-2">
              {segments.length} segments
            </Badge>
            <Badge variant="outline">
              {spectrograms.length} generated
            </Badge>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleGenerateSpectrograms(false)}
              disabled={generating || segments.length === 0}
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              Generate All
            </Button>
            
            {spectrograms.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleGenerateSpectrograms(true)}
                disabled={generating}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Regenerate
              </Button>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Generation Progress */}
        {generating && progress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{progress.message}</span>
              <span>{progress.completed_segments}/{progress.total_segments} segments</span>
            </div>
            <Progress value={progress.progress} className="w-full" />
            <div className="text-xs text-gray-500 text-center">
              {progress.progress.toFixed(1)}% complete
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* No Segments State */}
        {segments.length === 0 && !loading && (
          <Alert>
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>
              No approved segments found for this recording. Please run segmentation and approve segments first.
            </AlertDescription>
          </Alert>
        )}

        {/* Segments with Spectrograms */}
        {segments.length > 0 && (
          <Tabs defaultValue="grid" className="space-y-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="grid">
                <Grid3X3 className="w-4 h-4 mr-2" />
                Grid View
              </TabsTrigger>
              <TabsTrigger value="list">
                <Clock className="w-4 h-4 mr-2" />
                Timeline View
              </TabsTrigger>
            </TabsList>

            {/* Grid View */}
            <TabsContent value="grid" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {segments.map((segment) => {
                  const spectrogram = getSegmentSpectrogram(segment.id);
                  const segmentEvents = getSegmentAEDEvents(segment.id);
                  const isSelected = selectedSegmentId === segment.id;

                  return (
                    <Card 
                      key={segment.id}
                      className={`cursor-pointer transition-all ${
                        isSelected ? 'ring-2 ring-blue-500' : 'hover:shadow-md'
                      }`}
                      onClick={() => handleSegmentClick(segment, spectrogram)}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-medium">
                            Segment {segment.id}
                          </div>
                          <div className="flex items-center gap-1">
                            {spectrogram ? (
                              <Badge variant="outline" className="text-green-600">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Ready
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-gray-500">
                                Pending
                              </Badge>
                            )}
                            {segmentEvents.length > 0 && (
                              <Badge variant="outline">
                                {segmentEvents.length} events
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatTime(segment.start_ms)} - {formatTime(segment.end_ms)} 
                          ({formatDuration(segment.duration_ms)})
                        </div>
                      </CardHeader>

                      <CardContent className="pt-2">
                        {spectrogram && spectrogram.image_url ? (
                          <div className="space-y-2">
                            <div className="relative group border rounded-lg bg-black overflow-hidden">
                              <img
                                src={spectrogram.image_url}
                                alt={`Segment ${segment.id} Spectrogram`}
                                className="w-full h-auto max-h-32 object-cover cursor-pointer transition-opacity group-hover:opacity-75"
                                style={{ imageRendering: 'crisp-edges' }}
                                onClick={(e) => handleSpectrogramClick(e, segment, spectrogram)}
                                onLoad={() => {
                                  console.log(`✅ Spectrogram loaded for segment ${segment.id}:`, spectrogram.image_url);
                                }}
                                onError={(e) => {
                                  console.error(`❌ Failed to load segment ${segment.id} spectrogram:`, spectrogram.image_url);
                                  console.error('Spectrogram data:', spectrogram);
                                  e.currentTarget.style.display = 'none';
                                }}
                              />

                              {/* AED Event Overlays */}
                              {segmentEvents.map((event, eventIndex) => {
                                // Calculate relative position within the segment
                                const segmentDurationMs = segment.end_ms - segment.start_ms;
                                const eventStartRelative = event.start_ms - segment.start_ms;
                                const eventEndRelative = event.end_ms - segment.start_ms;

                                // Convert to percentage positions
                                const leftPercent = Math.max(0, (eventStartRelative / segmentDurationMs) * 100);
                                const widthPercent = Math.min(100 - leftPercent, ((eventEndRelative - eventStartRelative) / segmentDurationMs) * 100);

                                return (
                                  <div
                                    key={`${event.id}-${eventIndex}`}
                                    className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
                                    style={{
                                      left: `${leftPercent}%`,
                                      width: `${widthPercent}%`,
                                      top: '10%',
                                      height: '80%',
                                    }}
                                    title={`Event ${event.id}: ${event.confidence?.toFixed(2)} confidence`}
                                  />
                                );
                              })}

                              {/* Expand Button Overlay */}
                              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="bg-white/90 hover:bg-white text-black"
                                  onClick={(e) => handleSpectrogramClick(e, segment, spectrogram)}
                                >
                                  <Maximize2 className="w-4 h-4 mr-1" />
                                  Expand
                                </Button>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="flex items-center gap-1">
                                <Eye className="w-3 h-3" />
                                {spectrogram.aed_events_count} events
                              </div>
                              {spectrogram.generation_time_ms && (
                                <div className="flex items-center gap-1">
                                  <Zap className="w-3 h-3" />
                                  {(spectrogram.generation_time_ms / 1000).toFixed(1)}s
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 text-center">
                              💡 Click image to view full-size with event details
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-4 bg-gray-50 rounded-lg text-sm text-gray-500">
                            <Image className="w-6 h-6 mx-auto mb-2" />
                            <p>Click Generate to create spectrogram</p>
                            {spectrogram && (
                              <div className="text-xs mt-2 p-2 bg-yellow-100 rounded border">
                                <p className="font-medium text-yellow-800">Debug Info:</p>
                                <p>Status: {spectrogram.status}</p>
                                <p>Image URL: {spectrogram.image_url || 'null'}</p>
                                <p>S3 Key: {spectrogram.image_s3_key || 'null'}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </TabsContent>

            {/* Timeline View */}
            <TabsContent value="list" className="space-y-2">
              {segments.map((segment) => {
                const spectrogram = getSegmentSpectrogram(segment.id);
                const segmentEvents = getSegmentAEDEvents(segment.id);
                const isSelected = selectedSegmentId === segment.id;

                return (
                  <Card 
                    key={segment.id}
                    className={`cursor-pointer transition-all ${
                      isSelected ? 'ring-2 ring-blue-500' : 'hover:shadow-sm'
                    }`}
                    onClick={() => handleSegmentClick(segment, spectrogram)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium">Segment {segment.id}</div>
                            <ChevronRight className="w-4 h-4 text-gray-400" />
                          </div>
                          
                          <div className="text-sm text-gray-600">
                            {formatTime(segment.start_ms)} - {formatTime(segment.end_ms)}
                          </div>
                          
                          <div className="text-sm text-gray-500">
                            Duration: {formatDuration(segment.duration_ms)}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {segmentEvents.length > 0 && (
                            <Badge variant="outline">
                              {segmentEvents.length} events
                            </Badge>
                          )}
                          
                          {spectrogram ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-green-600">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Ready
                              </Badge>
                              {spectrogram.generation_time_ms && (
                                <span className="text-xs text-gray-500">
                                  {(spectrogram.generation_time_ms / 1000).toFixed(1)}s gen
                                </span>
                              )}
                            </div>
                          ) : (
                            <Badge variant="outline" className="text-gray-500">
                              Pending
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>
          </Tabs>
        )}

        {/* Summary Statistics */}
        {segments.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{segments.length}</div>
              <div className="text-sm text-gray-600">Total Segments</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{spectrograms.length}</div>
              <div className="text-sm text-gray-600">Generated</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{aedEvents.length}</div>
              <div className="text-sm text-gray-600">Total Events</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {spectrograms.length > 0 ? ((spectrograms.length / segments.length) * 100).toFixed(0) : 0}%
              </div>
              <div className="text-sm text-gray-600">Coverage</div>
            </div>
          </div>
        )}

        {/* Spectrogram Modal */}
        <SpectrogramModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          spectrogram={modalData.spectrogram}
          segment={modalData.segment}
          events={modalData.events}
        />
      </CardContent>
    </Card>
  );
};

export default SegmentSpectrogramViewer;
