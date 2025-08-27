import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Play, 
  Pause, 
  Download, 
  Trash2, 
  RefreshCw, 
  Bird, 
  Clock, 
  Volume2,
  AlertCircle,
  CheckCircle,
  Loader2,
  MapPin,
  Music
} from 'lucide-react';
import { API_BASE_URL } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAppearance } from '@/contexts/AppearanceContext';
import BottomNavigation from '@/components/BottomNavigation';

interface Recording {
  id: number;
  name: string;
  description: string;
  file_url: string;
  duration_seconds: number;
  site_name: string;
  site_latitude: number | string;
  site_longitude: number | string;
}

interface AEDEvent {
  id: number;
  species: string;
  scientific_name: string;
  confidence: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  snippet_url?: string;
  created_at: string;
}

interface GroupedEvent extends AEDEvent {
  timeKey: string;
  startSec: number;
  endSec: number;
  detectionCount: number;
}

interface AEDStatus {
  has_aed_analysis: boolean;
  event_count: number;
  last_analysis: string | null;
}

const BirdNetAEDPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { transparencyEnabled } = useAppearance();
  
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [events, setEvents] = useState<AEDEvent[]>([]);
  const [status, setStatus] = useState<AEDStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');
  const [currentlyPlaying, setCurrentlyPlaying] = useState<string | null>(null);
  const [audioElements, setAudioElements] = useState<{ [key: string]: HTMLAudioElement }>({});

  useEffect(() => {
    fetchRecordings();
  }, []);

  useEffect(() => {
    if (selectedRecording) {
      fetchAEDStatus();
    }
  }, [selectedRecording]);

  // Group events by timing to avoid duplicates
  const groupedEvents = React.useMemo(() => {
    if (events.length === 0) return [];
    
    const grouped = new Map<string, AEDEvent[]>();
    
    events.forEach(event => {
      // Create a key based on start and end time (in seconds)
      const startSec = Math.floor(event.start_ms / 1000);
      const endSec = Math.floor(event.end_ms / 1000);
      const timeKey = `${startSec}-${endSec}`;
      
      if (!grouped.has(timeKey)) {
        grouped.set(timeKey, []);
      }
      grouped.get(timeKey)!.push(event);
    });
    
    // Convert to array and sort by start time
    return Array.from(grouped.entries())
      .map(([timeKey, events]) => {
        // Use the event with highest confidence as the representative
        const representative = events.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        
        return {
          ...representative,
          timeKey,
          startSec: Math.floor(representative.start_ms / 1000),
          endSec: Math.floor(representative.end_ms / 1000),
          // Add count of detections in this time slot
          detectionCount: events.length
        };
      })
      .sort((a, b) => a.startSec - b.startSec);
  }, [events]);

  // Debug: Log events when they change
  useEffect(() => {
    if (events.length > 0) {
      console.log('Events loaded:', events);
      console.log('Grouped events:', groupedEvents);
      console.log('First event snippet_url:', events[0]?.snippet_url);
    }
  }, [events, groupedEvents]);

  const fetchRecordings = async () => {
    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/recordings`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch recordings');
      }

      const data = await response.json();
      setRecordings(data.recordings || []);
    } catch (error) {
      console.error('Error fetching recordings:', error);
      setError('Failed to load recordings');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAEDStatus = async () => {
    if (!selectedRecording) return;

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/recordings/${selectedRecording.id}/aed/status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setStatus(data);
        
        // If analysis exists, fetch events
        if (data.has_aed_analysis) {
          fetchAEDEvents();
        } else {
          setEvents([]);
        }
      }
    } catch (error) {
      console.error('Error fetching AED status:', error);
    }
  };

  const fetchAEDEvents = async () => {
    if (!selectedRecording) return;

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/recordings/${selectedRecording.id}/aed`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setEvents(data.events);
      }
    } catch (error) {
      console.error('Error fetching AED events:', error);
    }
  };

  const startAnalysis = async () => {
    if (!selectedRecording) return;

    setIsAnalyzing(true);
    setProgress(0);
    setProgressMessage('');
    setError('');

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/recordings/${selectedRecording.id}/aed`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to start analysis');
      }

      // Handle Server-Sent Events for progress updates
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                
                if (data.progress !== undefined) {
                  setProgress(data.progress);
                }
                
                if (data.message) {
                  setProgressMessage(data.message);
                }

                                 if (data.error) {
                   throw new Error(data.error);
                 }

                 if (data.progress === 100) {
                   // Analysis complete, refresh data
                   await fetchAEDStatus();
                   await fetchAEDEvents();
                 }
               } catch (parseError) {
                 console.warn('Failed to parse SSE data:', parseError);
                 
                 // Check if it's a "No detections found" error
                 if (parseError instanceof Error && parseError.message.includes('No detections found')) {
                   setError('No acoustic events detected in this recording. The analysis completed but found no bird calls or other acoustic events.');
                   break; // Exit the loop since analysis is complete
                 }
               }
            }
          }
        }
      }
    } catch (error) {
      console.error('Analysis error:', error);
      setError(error instanceof Error ? error.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const deleteAnalysis = async () => {
    if (!selectedRecording || !confirm('Are you sure you want to delete all detection results for this recording?')) {
      return;
    }

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/recordings/${selectedRecording.id}/aed`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        setEvents([]);
        setStatus({ has_aed_analysis: false, event_count: 0, last_analysis: null });
      }
    } catch (error) {
      console.error('Error deleting analysis:', error);
      setError('Failed to delete analysis');
    }
  };

  const playSnippet = (timeKey: string, snippetUrl: string) => {
    // Stop currently playing audio
    if (currentlyPlaying && audioElements[currentlyPlaying]) {
      audioElements[currentlyPlaying].pause();
      audioElements[currentlyPlaying].currentTime = 0;
    }

    let audio: HTMLAudioElement;

    // Create new audio element if it doesn't exist
    if (!audioElements[timeKey]) {
      audio = new Audio(snippetUrl); // Use snippetUrl directly since it's already a full URL
      audio.addEventListener('ended', () => setCurrentlyPlaying(null));
      audio.addEventListener('error', (e) => {
        console.error('Audio playback error:', e);
        setCurrentlyPlaying(null);
      });
      setAudioElements(prev => ({ ...prev, [timeKey]: audio }));
    } else {
      audio = audioElements[timeKey];
    }

    // Play the snippet
    try {
      audio.play().then(() => {
        setCurrentlyPlaying(timeKey);
      }).catch((error) => {
        console.error('Failed to play audio:', error);
        setCurrentlyPlaying(null);
      });
    } catch (error) {
      console.error('Error playing audio:', error);
      setCurrentlyPlaying(null);
    }
  };

  const stopSnippet = (timeKey: string) => {
    if (audioElements[timeKey]) {
      audioElements[timeKey].pause();
      audioElements[timeKey].currentTime = 0;
      setCurrentlyPlaying(null);
    }
  };

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };



  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-coral" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Acoustic Event Detection
              </h1>
              <p className="text-gray-600">
                Detect and analyze acoustic events in audio recordings
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate(-1)}
              className="text-coral border-coral hover:bg-coral hover:text-white"
            >
              ← Back
            </Button>
          </div>
        </div>

        {/* Recording Selection */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Music className="w-5 h-5 text-coral" />
              Select Recording
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Select onValueChange={(value) => {
              const recording = recordings.find(r => r.id.toString() === value);
              setSelectedRecording(recording || null);
            }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a recording to analyze..." />
              </SelectTrigger>
              <SelectContent>
                {recordings.map((recording) => (
                  <SelectItem key={recording.id} value={recording.id.toString()}>
                    {recording.name} - {recording.site_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Selected Recording Info */}
        {selectedRecording && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bird className="w-5 h-5 text-coral" />
                {selectedRecording.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Site</p>
                  <p className="font-medium">{selectedRecording.site_name}</p>
                </div>
                                 <div>
                   <p className="text-sm text-gray-500">Duration</p>
                   <p className="font-medium">{formatTime(selectedRecording.duration_seconds * 1000)}</p>
                 </div>

                                 <div>
                   <p className="text-sm text-gray-500">Coordinates</p>
                   <p className="font-medium flex items-center gap-1">
                     <MapPin className="w-4 h-4" />
                     {Number(selectedRecording.site_latitude).toFixed(4)}, {Number(selectedRecording.site_longitude).toFixed(4)}
                   </p>
                 </div>
                                 <div>
                   <p className="text-sm text-gray-500">Status</p>
                   <Badge variant={status?.has_aed_analysis ? "default" : "secondary"}>
                     {status?.has_aed_analysis ? "Analyzed" : "Not Analyzed"}
                   </Badge>
                 </div>

              </div>
              {selectedRecording.description && (
                <p className="text-gray-600 mt-4">{selectedRecording.description}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Analysis Controls */}
        {selectedRecording && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Analysis Controls</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4">
                {!status?.has_aed_analysis ? (
                  <Button
                    onClick={startAnalysis}
                    disabled={isAnalyzing}
                    className="bg-coral hover:bg-coral/90 text-white"
                  >
                    {isAnalyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                                               <>
                           <RefreshCw className="w-4 h-4 mr-2" />
                           Start Analysis
                         </>
                    )}
                  </Button>
                ) : (
                  <div className="flex items-center gap-4">
                    <Button
                      onClick={startAnalysis}
                      disabled={isAnalyzing}
                      variant="outline"
                      className="text-coral border-coral hover:bg-coral hover:text-white"
                    >
                      {isAnalyzing ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Re-analyzing...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Re-analyze
                        </>
                      )}
                    </Button>
                    <Button
                      onClick={deleteAnalysis}
                      variant="destructive"
                      size="sm"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Analysis
                    </Button>
                  </div>
                )}
              </div>

              {/* Progress Bar */}
              {isAnalyzing && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-600">Progress</span>
                    <span className="text-sm font-medium">{progress}%</span>
                  </div>
                  <Progress value={progress} className="w-full" />
                  <p className="text-sm text-gray-500 mt-2">{progressMessage}</p>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <Alert className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* Analysis Results */}
        {selectedRecording && status?.has_aed_analysis && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-600" />
                Detection Results
                <Badge variant="outline" className="ml-2">
                  {groupedEvents.length} detections
                </Badge>
              </CardTitle>
              {status.last_analysis && (
                <p className="text-sm text-gray-500">
                  Last analyzed: {new Date(status.last_analysis).toLocaleString()}
                </p>
              )}
            </CardHeader>
            <CardContent>
              {groupedEvents.length === 0 ? (
                <p className="text-gray-500 text-center py-8">
                  No acoustic events detected in this recording.
                </p>
              ) : (
                <div className="space-y-4">
                  {groupedEvents.map((event) => (
                    <Card key={event.timeKey} className="border-l-4 border-l-coral">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h3 className="font-semibold text-lg">
                                Acoustic Event at {event.startSec}s - {event.endSec}s
                              </h3>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-gray-500">
                              <div className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {formatTime(event.start_ms)} - {formatTime(event.end_ms)}
                              </div>
                              <div className="flex items-center gap-1">
                                <Volume2 className="w-4 h-4" />
                                {formatTime(event.duration_ms)}
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {event.snippet_url && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (currentlyPlaying === event.timeKey) {
                                    stopSnippet(event.timeKey);
                                  } else {
                                    playSnippet(event.timeKey, event.snippet_url!);
                                  }
                                }}
                                className="text-coral border-coral hover:bg-coral hover:text-white"
                              >
                                {currentlyPlaying === event.timeKey ? (
                                  <Pause className="w-4 h-4" />
                                ) : (
                                  <Play className="w-4 h-4" />
                                )}
                              </Button>
                            )}
                            {event.snippet_url && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  // snippet_url is already a complete S3 signed URL
                                  const link = document.createElement('a');
                                  link.href = event.snippet_url!;
                                  link.download = `acoustic_event_${event.startSec}s_${event.endSec}s.wav`;
                                  link.click();
                                }}
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                              )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* No Recording Selected */}
        {!selectedRecording && (
          <Card>
            <CardContent className="p-8 text-center">
              <Bird className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-600 mb-2">
                No Recording Selected
              </h3>
              <p className="text-gray-500">
                Please select a recording from the dropdown above to start acoustic event detection analysis.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
      
      {/* Bottom Navigation */}
      <BottomNavigation />
    </div>
  );
};

export default BirdNetAEDPage;
