import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Scissors, BarChart3, Play, Settings, Filter, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";
import { PlatformNav } from "@/components/PlatformNav";
import { BottomNavigation } from "@/components/BottomNavigation";
import EcoForestBackground from "@/components/EcoForestBackground";
import { useAppearance } from "@/contexts/AppearanceContext";
import { getRecordings, getSegmentsForRecording, approveSegment, rejectSegment, createSegmentationJob, getBackgroundSegmentationStatus, clearBackgroundSegmentationStatus, type Recording } from "@/lib/api";

const SegmentationPage = () => {
  const { projectId } = useParams();
  const { transparencyEnabled } = useAppearance();
  const { toast } = useToast();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<number | null>(null);
  const [segLen, setSegLen] = useState<string>("60");
  const [overlap, setOverlap] = useState<string>("10");
  const [sampleRate, setSampleRate] = useState<string>("32000");
  const [segments, setSegments] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [segmentationProgress, setSegmentationProgress] = useState<{
    isRunning: boolean;
    progress: number;
    message: string;
    status?: string;
  }>({
    isRunning: false,
    progress: 0,
    message: '',
    status: undefined
  });

  // Check if selected recording is already segmented
  const isRecordingSegmented = segments.length > 0;

  // Check if selected recording is a short clip (< 60 seconds)
  const selectedRecording = recordings.find(r => r.id === selectedRecordingId);
  const isShortClip = selectedRecording && selectedRecording.duration_ms && selectedRecording.duration_ms < 60000;

  // Prevent multiple polling instances
  const [isPolling, setIsPolling] = useState(false);
  
  // Global stats for the entire project
  const [globalStats, setGlobalStats] = useState({
    totalSegments: 0,
    totalRecordings: 0,
    segmentedRecordings: 0
  });
  
  // Clips viewer state
  const [viewerRecordingId, setViewerRecordingId] = useState<number | null>(null);
  const [viewerSegments, setViewerSegments] = useState<any[]>([]);
  const [filteredSegments, setFilteredSegments] = useState<any[]>([]);
  const [selectedSegments, setSelectedSegments] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  
  // Approval/rejection loading states
  const [processingSegments, setProcessingSegments] = useState<Set<number>>(new Set());
  
  // Filter states
  const [qcFilter, setQcFilter] = useState<string>('all');
  const [approvalFilter, setApprovalFilter] = useState<string>('all');
  const [minDuration, setMinDuration] = useState<string>('');
  const [maxDuration, setMaxDuration] = useState<string>('');
  const [silenceThreshold, setSilenceThreshold] = useState<string>('');

  useEffect(() => {
    if (!projectId) return;
    getRecordings(projectId).then(setRecordings).catch(() => {});
    loadGlobalStats();
  }, [projectId]);

  const loadGlobalStats = async () => {
    if (!projectId) return;
    
    try {
      // Get all recordings for this project to count segments
      const allRecordings = await getRecordings(projectId);
      let totalSegments = 0;
      let segmentedRecordings = 0;

      // Load segments for each recording
      for (const recording of allRecordings) {
        try {
          const recordingSegments = await getSegmentsForRecording(recording.id);
          totalSegments += recordingSegments.length;
          if (recordingSegments.length > 0) {
            segmentedRecordings++;
          }
        } catch (err) {
          console.error(`Failed to load data for recording ${recording.id}:`, err);
        }
      }

      setGlobalStats({
        totalSegments,
        totalRecordings: allRecordings.length,
        segmentedRecordings
      });
    } catch (err) {
      console.error('Failed to load global stats:', err);
    }
  };

  // Apply filters effect
  useEffect(() => {
    applyFilters();
  }, [viewerSegments, qcFilter, approvalFilter, minDuration, maxDuration, silenceThreshold]);

  // Check for background segmentation status on page load and when recording changes
  useEffect(() => {
    if (!selectedRecordingId) return;

    checkBackgroundStatus(selectedRecordingId);
  }, [selectedRecordingId]);

  // Poll for background segmentation status
  useEffect(() => {
    if (!segmentationProgress.isRunning || !selectedRecordingId || isPolling) return;

    setIsPolling(true);
    const pollInterval = setInterval(async () => {
      try {
        const status = await getBackgroundSegmentationStatus(selectedRecordingId);

        if (status.status === 'completed') {
          setSegmentationProgress({
            isRunning: false,
            progress: 100,
            message: status.message,
            status: 'completed'
          });

          // Refresh segments
          await loadSegments(selectedRecordingId);
          await loadGlobalStats();

          // Clear status after showing success
          setTimeout(() => {
            clearBackgroundSegmentationStatus(selectedRecordingId);
            setSegmentationProgress({
              isRunning: false,
              progress: 0,
              message: '',
              status: undefined
            });
          }, 3000);

        } else if (status.status === 'failed') {
          setSegmentationProgress({
            isRunning: false,
            progress: 0,
            message: status.message,
            status: 'failed'
          });

          toast({
            title: "Segmentation Failed",
            description: status.error || 'Segmentation failed',
            variant: "destructive",
          });

        } else if (status.status === 'running') {
          // Update progress (simulate since we don't have real progress)
          setSegmentationProgress(prev => ({
            ...prev,
            progress: Math.min(prev.progress + Math.random() * 5, 95),
            message: status.message
          }));
        }

      } catch (err: any) {
        // Status not found or network error - handle gracefully
        console.log('Error checking background segmentation status:', err.message);

        // If it's a network error, stop polling to prevent spam
        if (err.message?.includes('Network error') || err.message?.includes('429')) {
          setSegmentationProgress(prev => ({
            ...prev,
            isRunning: false
          }));
          setIsPolling(false);
        }
      }
    }, 5000); // Poll every 5 seconds to avoid rate limiting

    return () => {
      clearInterval(pollInterval);
      setIsPolling(false);
    };
  }, [segmentationProgress.isRunning, selectedRecordingId, isPolling]);

  const checkBackgroundStatus = async (recordingId: number) => {
    try {
      const status = await getBackgroundSegmentationStatus(recordingId);

      if (status.status === 'running') {
        setSegmentationProgress({
          isRunning: true,
          progress: 10,
          message: status.message,
          status: 'running'
        });
      } else if (status.status === 'completed') {
        setSegmentationProgress({
          isRunning: false,
          progress: 100,
          message: status.message,
          status: 'completed'
        });
      }
    } catch (err) {
      // No background status found - that's normal
      console.log('No background segmentation status found for recording', recordingId);
    }
  };

  const loadSegments = async (rid: number) => {
    const segs = await getSegmentsForRecording(rid);
    setSegments(segs);
  };

  // loadJobs function removed since we're using direct processing

  // Clips viewer functions
  const loadViewerSegments = async (recordingId: number) => {
    setLoading(true);
    try {
      const data = await getSegmentsForRecording(recordingId);
      setViewerSegments(data);
      setSelectedSegments([]);
    } catch (err) {
      console.error('Failed to load segments:', err);
      setViewerSegments([]);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    let filtered = [...viewerSegments];

    // QC Status filter
    if (qcFilter !== 'all') {
      filtered = filtered.filter(s => s.qc_status === qcFilter);
    }

    // Approval Status filter
    if (approvalFilter !== 'all') {
      filtered = filtered.filter(s => s.approval_status === approvalFilter);
    }

    // Duration filters
    if (minDuration) {
      const minMs = parseFloat(minDuration) * 1000;
      filtered = filtered.filter(s => s.duration_ms >= minMs);
    }
    if (maxDuration) {
      const maxMs = parseFloat(maxDuration) * 1000;
      filtered = filtered.filter(s => s.duration_ms <= maxMs);
    }

    // Silence threshold filter
    if (silenceThreshold) {
      const threshold = parseFloat(silenceThreshold);
      filtered = filtered.filter(s => s.silence_pct !== null && s.silence_pct <= threshold);
    }

    setFilteredSegments(filtered);
  };

  const handleViewerRecordingSelect = (recordingId: string) => {
    const id = parseInt(recordingId);
    setViewerRecordingId(id);
    loadViewerSegments(id);
  };

  const toggleSegmentSelection = (segmentId: number) => {
    setSelectedSegments(prev => 
      prev.includes(segmentId) 
        ? prev.filter(id => id !== segmentId)
        : [...prev, segmentId]
    );
  };

  const selectAllFiltered = () => {
    setSelectedSegments(filteredSegments.map(s => s.id));
  };

  const clearSelection = () => {
    setSelectedSegments([]);
  };

  const downloadSelected = () => {
    // Implementation for downloading selected segments
    console.log('Downloading segments:', selectedSegments);
    // This would trigger download of selected segment files
  };

  // Handle segment approval with feedback
  const handleSegmentApproval = async (segmentId: number) => {
    // Add to processing set
    setProcessingSegments(prev => new Set(prev).add(segmentId));
    
    try {
      await approveSegment(segmentId);
      
      // Update local state to remove from needs review
      setSegments(prevSegments => 
        prevSegments.map(seg => 
          seg.id === segmentId 
            ? { ...seg, approval_status: 'approved' }
            : seg
        )
      );
      
      // Update global stats
      await loadGlobalStats();
      
      // Show success toast
      toast({
        title: "✅ Segment Approved",
        description: `Segment ${segmentId} has been approved and is now ready for AED processing.`,
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to approve segment:', error);
      toast({
        title: "❌ Approval Failed", 
        description: "Failed to approve segment. Please try again.",
        variant: "destructive",
        duration: 4000,
      });
    } finally {
      // Remove from processing set
      setProcessingSegments(prev => {
        const newSet = new Set(prev);
        newSet.delete(segmentId);
        return newSet;
      });
    }
  };

  // Handle segment rejection with feedback
  const handleSegmentRejection = async (segmentId: number) => {
    // Add to processing set
    setProcessingSegments(prev => new Set(prev).add(segmentId));
    
    try {
      await rejectSegment(segmentId);
      
      // Update local state to remove from needs review
      setSegments(prevSegments => 
        prevSegments.map(seg => 
          seg.id === segmentId 
            ? { ...seg, approval_status: 'rejected' }
            : seg
        )
      );
      
      // Update global stats
      await loadGlobalStats();
      
      // Show success toast
      toast({
        title: "🚫 Segment Rejected",
        description: `Segment ${segmentId} has been rejected and will not be processed further.`,
        duration: 3000,
      });
    } catch (error) {
      console.error('Failed to reject segment:', error);
      toast({
        title: "❌ Rejection Failed",
        description: "Failed to reject segment. Please try again.", 
        variant: "destructive",
        duration: 4000,
      });
    } finally {
      // Remove from processing set
      setProcessingSegments(prev => {
        const newSet = new Set(prev);
        newSet.delete(segmentId);
        return newSet;
      });
    }
  };



  const onCreateJob = async () => {
    if (!selectedRecordingId) return;

    setIsSubmitting(true);
    setSegmentationProgress({
      isRunning: true,
      progress: 5,
      message: isShortClip ? 'Processing short clip...' : 'Starting background segmentation...',
      status: 'running'
    });

    try {
      const result = await createSegmentationJob(selectedRecordingId, {
        strategy: 'hybrid',
        seg_len_s: Number(segLen) || 60,
        overlap_pct: Number(overlap) || 0,
        sample_rate: Number(sampleRate) || 32000,
        pipeline_version: 'seg-v1.0'
      });

      // Check if it's a short clip
      if (result.is_short_clip) {
        // Short clip processed immediately
        setSegmentationProgress({
          isRunning: false,
          progress: 100,
          message: result.message,
          status: 'completed'
        });

        toast({
          title: "Short Clip Processed",
          description: `Clip processed as single segment (${result.segments?.length || 0} segment created).`,
        });

        // Refresh segments immediately
        await loadSegments(selectedRecordingId);
        await loadGlobalStats();

        // Clear progress after showing success
        setTimeout(() => {
          setSegmentationProgress({
            isRunning: false,
            progress: 0,
            message: '',
            status: undefined
          });
        }, 3000);

      } else {
        // Normal segmentation started in background
        toast({
          title: "Segmentation Started",
          description: "Segmentation is running in the background. You can navigate to other pages.",
        });
      }

      // Progress will be updated by polling

    } catch (err: any) {
      console.error('❌ Failed to start segmentation:', err);
      setSegmentationProgress({
        isRunning: false,
        progress: 0,
        message: '',
        status: undefined
      });

      toast({
        title: "Failed to Start Segmentation",
        description: err.message || 'Failed to start segmentation',
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen relative">
      <EcoForestBackground />
      <div className="relative z-10">
      <PlatformNav />
      
      <main className="container mx-auto px-6 py-8 pb-24">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Audio Segmentation</h1>
            <p className="text-muted-foreground">
              Automatically segment audio recordings into meaningful chunks
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-green-200 bg-green-50"}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <Scissors className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold text-green-700">{globalStats.totalSegments}</p>
                    <p className="text-sm text-green-600">Segments Created</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-green-200 bg-green-50"}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <Play className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold text-green-700">{globalStats.totalRecordings}</p>
                    <p className="text-sm text-green-600">Total Recordings</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-green-200 bg-green-50"}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <BarChart3 className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold text-green-700">{globalStats.segmentedRecordings}</p>
                    <p className="text-sm text-green-600">Segmented</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-green-200 bg-green-50"}>
              <CardContent className="p-6">
                <div className="flex items-center gap-3">
                  <Settings className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="text-2xl font-bold text-green-700">{globalStats.totalRecordings - globalStats.segmentedRecordings}</p>
                    <p className="text-sm text-green-600">Pending</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <Card className={transparencyEnabled ? "glass-card bg-white/60" : "border-green-200 bg-gradient-to-br from-green-50 to-white"}>
            <CardHeader>
              <CardTitle className="text-green-700">Audio Segmentation & Clips</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="segmentation" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="segmentation">Segmentation</TabsTrigger>
                  <TabsTrigger value="clips">Clips Viewer</TabsTrigger>
                </TabsList>

                <TabsContent value="segmentation" className="mt-6">
              <div className="grid gap-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <Label className="text-green-700">Recording</Label>
                      <Select onValueChange={async (v)=> {
                        const rid = Number(v);
                        setSelectedRecordingId(rid);
                        if (!Number.isNaN(rid)) {
                          await loadSegments(rid);
                        }
                      }}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Select a recording" />
                        </SelectTrigger>
                        <SelectContent>
                          {recordings.map(r => (
                            <SelectItem key={r.id} value={String(r.id)}>{r.name || `Recording #${r.id}`} ({r.duration_seconds ?? 0}s)</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-green-700">Audio Standardization Sample Rate</Label>
                      <Select value={sampleRate} onValueChange={setSampleRate}>
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Select standardization sample rate" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="8000">8 kHz - Ultra Low (very specific use)</SelectItem>
                          <SelectItem value="22050">22.05 kHz - Birds (low frequency)</SelectItem>
                          <SelectItem value="32000">32 kHz - Birds (standard)</SelectItem>
                          <SelectItem value="44100">44.1 kHz - Birds (high quality)</SelectItem>
                          <SelectItem value="48000">48 kHz - Professional audio</SelectItem>
                          <SelectItem value="96000">96 kHz - Bats & Ultrasonic</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-green-600 mt-1">
                        Choose sample rate for audio standardization to FLAC. Higher rates capture ultrasonic sounds (bats) but create larger files.
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <Label className="text-green-700">Segment length (s)</Label>
                        <Input type="number" inputMode="numeric" value={segLen} onChange={(e)=> setSegLen(e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-green-700">Overlap (%)</Label>
                        <Input type="number" inputMode="numeric" value={overlap} onChange={(e)=> setOverlap(e.target.value)} placeholder="10" />
                        <p className="text-xs text-green-600 mt-1">
                          Prevents split bird calls across segments. 10% recommended.
                        </p>
                      </div>
                      {/* Sample rate removed from segmentation UI */}
                    </div>

                    <Button
                      disabled={!selectedRecordingId || isSubmitting || isRecordingSegmented}
                      onClick={onCreateJob}
                      className={isRecordingSegmented ? "bg-gray-400 cursor-not-allowed" : "bg-green-600 hover:bg-green-700 text-white"}
                    >
                      <Scissors className="w-4 h-4 mr-2" />
                      {isRecordingSegmented ? 'Already Processed' :
                       isSubmitting ? 'Processing…' :
                       isShortClip ? 'Process Short Clip' : 'Start Segmentation'}
                    </Button>

                    {/* Show message for already processed recordings */}
                    {isRecordingSegmented && selectedRecordingId && (
                      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                          <p className="text-sm text-blue-700">
                            This recording has already been processed into <strong>{segments.length} segment{segments.length !== 1 ? 's' : ''}</strong>.
                            You can view and manage the existing segments below.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Show message for short clips */}
                    {isShortClip && !isRecordingSegmented && selectedRecordingId && (
                      <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
                          <p className="text-sm text-yellow-700">
                            Short clip detected ({Math.round((selectedRecording?.duration_ms || 0) / 1000)}s &lt; 60s).
                            Will be processed as a single segment with QC analysis.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Segmentation Progress */}
                    {segmentationProgress.isRunning && (
                      <div className="mt-4 p-4 border rounded-lg bg-blue-50 dark:bg-blue-900/20">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="font-medium">Segmentation in Progress</h4>
                          <Badge variant="secondary">
                            Processing
                          </Badge>
                        </div>

                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span>{segmentationProgress.message}</span>
                            <span>{Math.round(segmentationProgress.progress)}%</span>
                          </div>

                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className="bg-green-600 h-2 rounded-full transition-all duration-300"
                              style={{ width: `${segmentationProgress.progress}%` }}
                            />
                          </div>

                          <div className="text-xs text-gray-500">
                            <span className="text-green-600">● Processing audio segments...</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Show completion message briefly */}
                    {!segmentationProgress.isRunning && segmentationProgress.status === 'completed' && (
                      <div className="mt-4 p-4 border rounded-lg bg-green-50 dark:bg-green-900/20">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-green-800 dark:text-green-200">Segmentation Completed!</h4>
                          <Badge variant="default">
                            Success
                          </Badge>
                        </div>
                        <p className="text-sm text-green-600 dark:text-green-300 mt-1">
                          {segmentationProgress.message}
                        </p>
                      </div>
                    )}

                    {/* Show failure message */}
                    {!segmentationProgress.isRunning && segmentationProgress.status === 'failed' && (
                      <div className="mt-4 p-4 border rounded-lg bg-red-50 dark:bg-red-900/20">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-red-800 dark:text-red-200">Segmentation Failed</h4>
                          <Badge variant="destructive">
                            Failed
                          </Badge>
                        </div>
                        <p className="text-sm text-red-600 dark:text-red-300 mt-1">
                          {segmentationProgress.message}
                        </p>
                      </div>
                    )}
                  </div>


                </div>

                {/* Job Status section removed - using direct processing now */}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-green-700 font-semibold">Segmented Clips</h3>
                    {selectedRecordingId && (
                      <Button variant="outline" onClick={() => {
                        loadSegments(selectedRecordingId);
                        loadGlobalStats();
                      }} className="border-green-300 text-green-700 hover:bg-green-50">Refresh</Button>
                    )}
                  </div>
                  {segments.length === 0 ? (
                    <p className="text-green-700/80 text-sm">No segments yet. Create a job to begin.</p>
                  ) : (
                    <div className="space-y-6">
                      <div>
                        <h4 className="text-green-700 font-medium mb-2">Approved / Passed QC</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {segments.filter(s => s.qc_status === 'pass' || s.approval_status === 'approved').map((s, i) => (
                            <Card key={`pass-${s.id}-${i}`} className={transparencyEnabled ? "glass-card bg-white/60" : "border-green-200 bg-green-50"}>
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-green-800 text-sm font-medium">{Math.round(s.start_ms/1000)}s → {Math.round(s.end_ms/1000)}s</p>
                                    <span className="mt-1 inline-block px-2 py-1 rounded text-xs bg-green-100 text-green-700">QC: {s.qc_status}</span>
                                  </div>
                                  {s.file_url && (<audio controls className="h-8"><source src={s.file_url} type="audio/flac" /></audio>)}
                                </div>
                                <div className="mt-2 text-xs text-green-600 space-y-1">
                                  <div>Silence: {s.silence_pct != null ? `${s.silence_pct.toFixed(1)}%` : 'n/a'}</div>
                                  {s.rms_db != null && <div>RMS: {s.rms_db.toFixed(1)} dB</div>}
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-green-700 font-medium mb-2">Needs Review</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {segments.filter(s => !(s.qc_status === 'pass' || s.approval_status === 'approved')).map((s, i) => (
                            <Card key={`rev-${s.id}-${i}`} className={`${transparencyEnabled ? "glass-card bg-white/60" : "border-green-200 bg-green-50"} ${processingSegments.has(s.id) ? 'opacity-75 pointer-events-none' : ''}`}>
                              <CardContent className="p-4">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-green-800 text-sm font-medium">{Math.round(s.start_ms/1000)}s → {Math.round(s.end_ms/1000)}s</p>
                                    <span className="mt-1 inline-block px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-700">QC: {s.qc_status}</span>
                                  </div>
                                  {s.file_url && (<audio controls className="h-8"><source src={s.file_url} type="audio/flac" /></audio>)}
                                </div>
                                <div className="mt-2 text-xs text-green-600 space-y-1">
                                  <div>Silence: {s.silence_pct != null ? `${s.silence_pct.toFixed(1)}%` : 'n/a'}</div>
                                  {s.rms_db != null && <div>RMS: {s.rms_db.toFixed(1)} dB</div>}
                                </div>
                                <div className="mt-2 flex gap-2">
                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="text-green-700 border-green-300" 
                                    onClick={() => handleSegmentApproval(s.id)}
                                    disabled={processingSegments.has(s.id)}
                                  >
                                    {processingSegments.has(s.id) ? "Approving..." : "Approve"}
                                  </Button>
                                  <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="text-red-700 border-red-300" 
                                    onClick={() => handleSegmentRejection(s.id)}
                                    disabled={processingSegments.has(s.id)}
                                  >
                                    {processingSegments.has(s.id) ? "Rejecting..." : "Reject"}
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* AED controls moved to AED page */}
              </div>
                </TabsContent>

                <TabsContent value="clips" className="mt-6">
                  <div className="space-y-6">
                    {/* Recording Selection */}
                    <div>
                      <Label className="text-green-700 font-medium mb-2">Select Recording to View Clips</Label>
                      <Select onValueChange={handleViewerRecordingSelect}>
                        <SelectTrigger className="w-full max-w-md">
                          <SelectValue placeholder="Choose a recording to view segments..." />
                        </SelectTrigger>
                        <SelectContent>
                          {recordings.map(recording => (
                            <SelectItem key={recording.id} value={recording.id.toString()}>
                              {recording.name} ({recording.duration_seconds ? `${Math.round(recording.duration_seconds)}s` : 'Unknown duration'})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {viewerRecordingId && recordings.find(r => r.id === viewerRecordingId) && (
                      <>
                        {/* Recording Info */}
                        <div className="p-4 bg-green-50 rounded-lg">
                          <h3 className="text-green-800 font-semibold mb-2">
                            Recording: {recordings.find(r => r.id === viewerRecordingId)?.name}
                          </h3>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-green-700">
                            <div>Duration: {recordings.find(r => r.id === viewerRecordingId)?.duration_seconds ? `${Math.round(recordings.find(r => r.id === viewerRecordingId)!.duration_seconds)}s` : 'Unknown'}</div>
                            <div>File Size: {recordings.find(r => r.id === viewerRecordingId)?.file_size ? `${Math.round(recordings.find(r => r.id === viewerRecordingId)!.file_size / 1024 / 1024)}MB` : 'Unknown'}</div>
                            <div>Status: {recordings.find(r => r.id === viewerRecordingId)?.status || 'Unknown'}</div>
                            <div>Total Segments: {viewerSegments.length}</div>
                          </div>
                        </div>

                        {/* Filters */}
                        <div className="p-4 border rounded-lg">
                          <div className="flex items-center gap-2 mb-4">
                            <Filter className="w-5 h-5 text-green-600" />
                            <h4 className="text-green-700 font-medium">Filters</h4>
                            <Button variant="outline" size="sm" onClick={() => {
                              setQcFilter('all');
                              setApprovalFilter('all');
                              setMinDuration('');
                              setMaxDuration('');
                              setSilenceThreshold('');
                            }}>Clear All</Button>
                          </div>
                          
                          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            <div>
                              <Label className="text-sm text-green-700 mb-1">QC Status</Label>
                              <Select value={qcFilter} onValueChange={setQcFilter}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All</SelectItem>
                                  <SelectItem value="pass">Pass</SelectItem>
                                  <SelectItem value="review">Review</SelectItem>
                                  <SelectItem value="fail">Fail</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label className="text-sm text-green-700 mb-1">Approval Status</Label>
                              <Select value={approvalFilter} onValueChange={setApprovalFilter}>
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="all">All</SelectItem>
                                  <SelectItem value="approved">Approved</SelectItem>
                                  <SelectItem value="pending">Pending</SelectItem>
                                  <SelectItem value="rejected">Rejected</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label className="text-sm text-green-700 mb-1">Min Duration (s)</Label>
                              <Input 
                                type="number" 
                                placeholder="0" 
                                value={minDuration}
                                onChange={(e) => setMinDuration(e.target.value)}
                              />
                            </div>

                            <div>
                              <Label className="text-sm text-green-700 mb-1">Max Duration (s)</Label>
                              <Input 
                                type="number" 
                                placeholder="∞" 
                                value={maxDuration}
                                onChange={(e) => setMaxDuration(e.target.value)}
                              />
                            </div>

                            <div>
                              <Label className="text-sm text-green-700 mb-1">Max Silence %</Label>
                              <Input 
                                type="number" 
                                placeholder="100" 
                                value={silenceThreshold}
                                onChange={(e) => setSilenceThreshold(e.target.value)}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Selection Controls */}
                        {filteredSegments.length > 0 && (
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <span className="text-green-700">
                                Showing {filteredSegments.length} of {viewerSegments.length} segments
                              </span>
                              <span className="text-green-600">
                                ({selectedSegments.length} selected)
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" size="sm" onClick={selectAllFiltered}>
                                Select All Filtered
                              </Button>
                              <Button variant="outline" size="sm" onClick={clearSelection}>
                                Clear Selection
                              </Button>
                              {selectedSegments.length > 0 && (
                                <Button size="sm" onClick={downloadSelected} className="bg-green-600 hover:bg-green-700">
                                  <Download className="w-4 h-4 mr-2" />
                                  Download Selected
                                </Button>
                              )}
                              <Button variant="outline" size="sm" onClick={() => viewerRecordingId && loadViewerSegments(viewerRecordingId)}>
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Refresh
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* Segments Grid */}
                        {loading ? (
                          <div className="text-center py-8">
                            <RefreshCw className="w-8 h-8 text-green-600 animate-spin mx-auto mb-2" />
                            <p className="text-green-700">Loading segments...</p>
                          </div>
                        ) : filteredSegments.length === 0 ? (
                          <div className="text-center py-8">
                            <p className="text-green-700">
                              {viewerSegments.length === 0 ? 'No segments found for this recording.' : 'No segments match the current filters.'}
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredSegments.map((segment) => (
                              <Card key={segment.id} className={`${
                                transparencyEnabled ? "glass-card bg-white/60" : "border-green-200 bg-green-50"
                              } ${selectedSegments.includes(segment.id) ? 'ring-2 ring-green-500' : ''}`}>
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <Checkbox 
                                        checked={selectedSegments.includes(segment.id)}
                                        onCheckedChange={() => toggleSegmentSelection(segment.id)}
                                      />
                                      <div>
                                        <p className="text-green-800 text-sm font-medium">
                                          {Math.round(segment.start_ms/1000)}s → {Math.round(segment.end_ms/1000)}s
                                        </p>
                                        <p className="text-xs text-green-600">
                                          Duration: {Math.round(segment.duration_ms/1000)}s
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Status Badges */}
                                  <div className="flex flex-wrap gap-2 mb-3">
                                    <Badge variant={segment.qc_status === 'pass' ? 'default' : 'secondary'}>
                                      QC: {segment.qc_status}
                                    </Badge>
                                    {segment.approval_status && (
                                      <Badge variant={segment.approval_status === 'approved' ? 'default' : 'secondary'}>
                                        {segment.approval_status}
                                      </Badge>
                                    )}
                                  </div>

                                  {/* Audio Controls */}
                                  {segment.file_url && (
                                    <div className="mb-3">
                                      <audio controls className="w-full h-8">
                                        <source src={segment.file_url} type="audio/flac" />
                                        <source src={segment.file_url} type="audio/wav" />
                                      </audio>
                                    </div>
                                  )}

                                  {/* Metadata */}
                                  <div className="text-xs text-green-600 space-y-1">
                                    {segment.silence_pct !== null && (
                                      <div>Silence: {segment.silence_pct.toFixed(1)}%</div>
                                    )}
                                    {segment.rms_db !== null && (
                                      <div>RMS: {segment.rms_db.toFixed(1)} dB</div>
                                    )}
                                    {segment.clipping_pct !== null && segment.clipping_pct > 0 && (
                                      <div className="text-orange-600">Clipping: {segment.clipping_pct.toFixed(2)}%</div>
                                    )}
                                    <div>Created: {new Date(segment.created_at).toLocaleDateString()}</div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Bottom Navigation */}
      <BottomNavigation projectId={projectId} />
      
      {/* Toast Notifications */}
      <Toaster />
      </div>
    </div>
  );
};

export default SegmentationPage; 