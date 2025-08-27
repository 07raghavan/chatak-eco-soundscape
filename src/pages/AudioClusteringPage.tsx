import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MapPin, Trash2, BarChart3, Eye, EyeOff, Play, Pause, AlertCircle, CheckCircle, Lightbulb } from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import { API_BASE_URL } from '@/lib/api';

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

interface Cluster {
  id: number;
  name: string;
  cluster_label: number;
  snippet_count: number;
  created_at: string;
}

interface Event {
  id: number;
  snippet_url?: string;
}

interface UMAPPoint {
  event_id: number;
  umap_x: number;
  umap_y: number;
  cluster_id: number;
}

interface ClusteringStatus {
  has_clustering: boolean;
  cluster_count: number;
  last_clustering: string | null;
}

const AudioClusteringPage: React.FC = () => {
  const { projectId, recordingId: urlRecordingId } = useParams<{ projectId: string; recordingId?: string }>();
  const navigate = useNavigate();
  
  // State
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [clusteringStatus, setClusteringStatus] = useState<ClusteringStatus | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [umapPoints, setUmapPoints] = useState<UMAPPoint[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [totalUniqueEvents, setTotalUniqueEvents] = useState<number>(0);
  const [isClustering, setIsClustering] = useState(false);
  const [clusteringProgress, setClusteringProgress] = useState(0);
  const [clusteringMessage, setClusteringMessage] = useState('');
  const [showUMAP, setShowUMAP] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingClusteringStatus, setLoadingClusteringStatus] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingEvent, setPlayingEvent] = useState<string | null>(null);
  const [audioElements, setAudioElements] = useState<{ [key: string]: HTMLAudioElement }>({});
  const [selectedPoint, setSelectedPoint] = useState<UMAPPoint | null>(null);

  // Fetch recordings on component mount
  useEffect(() => {
    fetchRecordings();
  }, []); // Empty dependency array - should run once on mount



  // Set selected recording from URL if available
  useEffect(() => {
    if (urlRecordingId && recordings.length > 0) {
      const recording = recordings.find(r => r.id === parseInt(urlRecordingId));
      if (recording) {
        setSelectedRecording(recording);
        fetchClusteringStatus(recording.id);
        fetchEvents(recording.id); // Also fetch events
      }
    }
  }, [urlRecordingId, recordings]);

  // Fetch clustering status when recording changes
  useEffect(() => {
    if (selectedRecording) {
      fetchClusteringStatus(selectedRecording.id);
    }
  }, [selectedRecording]);

  // Fetch recordings from API
  const fetchRecordings = async () => {
    try {
      setLoading(true);
      setError(null);
      const token = localStorage.getItem('chatak_token');
      
      const response = await fetch(`${API_BASE_URL}/api/recordings`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('HTTP Error:', response.status, errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      setRecordings(data.recordings || []);
    } catch (error) {
      console.error('Error fetching recordings:', error);
      setError('Failed to fetch recordings');
    } finally {
      setLoading(false);
    }
  };

  // Fetch clustering status for a recording
  const fetchClusteringStatus = async (recordingId: number) => {
    try {
      setLoadingClusteringStatus(true);
      setError(null);
      const token = localStorage.getItem('chatak_token');
      
      const response = await fetch(`${API_BASE_URL}/api/recordings/${recordingId}/clustering/status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setClusteringStatus(data);
        
        // If clustering exists, fetch results
        if (data.has_clustering) {
          fetchClusteringResults(recordingId);
        }
      } else {
        const errorText = await response.text();
        console.error(`❌ HTTP ${response.status}: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('❌ Error fetching clustering status:', error);
      setError(`Failed to fetch clustering status: ${error.message}`);
    } finally {
      setLoadingClusteringStatus(false);
    }
  };

  // Fetch events for the selected recording
  const fetchEvents = async (recordingId: number) => {
    try {
      setLoadingEvents(true);
      const token = localStorage.getItem('chatak_token');
      
      const response = await fetch(`${API_BASE_URL}/api/recordings/${recordingId}/events?limit=3`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setEvents(data.events || []);
        setTotalUniqueEvents(data.total_found || 0);
      } else {
        console.error(`Failed to fetch events: ${response.status}`);
        setEvents([]);
        setTotalUniqueEvents(0);
      }
    } catch (error) {
      console.error('Error fetching events:', error);
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  };

  // Fetch clustering results
  const fetchClusteringResults = async (recordingId: number) => {
    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/recordings/${recordingId}/clustering`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        setClusters(data.clusters || []);
        setUmapPoints(data.embeddings || []);
        
        // Auto-show UMAP visualization if we have results
        if (data.clusters && data.clusters.length > 0) {
          setShowUMAP(true);
        }
      }
    } catch (error) {
      console.error('Error fetching clustering results:', error);
    }
  };

  // Start audio clustering
  const startClustering = async () => {
    if (!selectedRecording) return;

    setIsClustering(true);
    setClusteringProgress(0);
    setClusteringMessage('Initializing clustering...');
    setError(null);

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(
        `${API_BASE_URL}/api/recordings/${selectedRecording.id}/clustering`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
                  setClusteringProgress(data.progress);
                }
                
                if (data.message) {
                  setClusteringMessage(data.message);
                }
                
                if (data.error) {
                  setError(data.error);
                  setIsClustering(false);
                  break;
                }
                
                if (data.progress === 100) {
                  setClusteringMessage('Clustering completed!');
                  setIsClustering(false);
                  
                  // Refresh clustering results
                  setTimeout(() => {
                    fetchClusteringStatus(selectedRecording.id);
                  }, 1000);
                  break;
                }
              } catch (parseError) {
                console.error('Failed to parse SSE data:', parseError);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error starting clustering:', error);
      setError('Failed to start clustering');
      setIsClustering(false);
    }
  };

  // Delete clustering results
  const deleteClustering = async () => {
    if (!selectedRecording) return;

    if (!confirm('Are you sure you want to delete all clustering results? This action cannot be undone.')) {
      return;
    }

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(
        `${API_BASE_URL}/api/recordings/${selectedRecording.id}/clustering`,
        { 
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (response.ok) {
        setClusters([]);
        setUmapPoints([]);
        setClusteringStatus(null);
        setSelectedCluster(null);
      } else {
        throw new Error('Failed to delete clustering');
      }
    } catch (error) {
      console.error('Error deleting clustering:', error);
      setError('Failed to delete clustering results');
    }
  };

  // Filter UMAP points by selected cluster
  const filteredUMAPPoints = useMemo(() => {
    if (selectedCluster === null) return umapPoints;
    return umapPoints.filter(point => point.cluster_id === selectedCluster);
  }, [umapPoints, selectedCluster]);

  // Get cluster color for visualization
  const getClusterColor = (clusterId: number) => {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
      '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
    ];
    return colors[clusterId % colors.length];
  };

  // Play audio event
  const playEvent = async (eventId: string) => {
    try {
      // Stop any currently playing audio
      if (playingEvent && audioElements[playingEvent]) {
        audioElements[playingEvent].pause();
        audioElements[playingEvent].currentTime = 0;
      }

      // Get the event data from the selected point (which has the full clustering data)
      if (!selectedPoint || !selectedRecording) {
        console.error('No point or recording selected');
        return;
      }

      // Create or get audio element
      let audio = audioElements[eventId];
      if (!audio) {
        audio = new Audio();
        audio.preload = 'auto';
        setAudioElements(prev => ({ ...prev, [eventId]: audio }));
      }

      // First, fetch the signed URL from the backend
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(
        `${API_BASE_URL}/api/recordings/${selectedRecording.id}/events/${eventId}/snippet`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get snippet URL: ${response.status}`);
      }

      const data = await response.json();
      const snippetUrl = data.snippet_url;

      if (!snippetUrl) {
        throw new Error('No snippet URL received');
      }

      // Set audio source and play
      audio.src = snippetUrl;
      audio.onended = () => setPlayingEvent(null);
      audio.onerror = () => {
        console.error('Audio playback error for event:', eventId);
        setPlayingEvent(null);
      };

      await audio.play();
      setPlayingEvent(eventId);
    } catch (error) {
      console.error('Error playing audio:', error);
      setPlayingEvent(null);
    }
  };

  // Stop audio playback
  const stopEvent = (eventId: string) => {
    const audio = audioElements[eventId];
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPlayingEvent(null);
  };

  // Handle recording selection
  const handleRecordingSelect = (recordingId: string) => {
    // Try both string and number comparison
    const recording = recordings.find(r => 
      r.id.toString() === recordingId || r.id === parseInt(recordingId)
    );
    
    setSelectedRecording(recording || null);
    setSelectedCluster(null);
    setSelectedPoint(null); // Clear selected point
    setEvents([]); // Clear previous events
    setClusters([]); // Clear previous clusters
    setUmapPoints([]); // Clear previous UMAP points
    setShowUMAP(false); // Hide UMAP visualization
    setClusteringStatus(null); // Clear previous clustering status
    
    if (recording) {
      fetchClusteringStatus(recording.id);
      fetchEvents(recording.id); // Fetch events for the selected recording
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
             {/* Header */}
       <div className="bg-white border-b border-gray-200 px-4 py-4">
         <div className="max-w-7xl mx-auto">
           <div className="flex items-center justify-between">
             <div>
               <h1 className="text-2xl font-bold text-gray-900">Audio Clustering</h1>
               <p className="text-gray-600 mt-1">
                 Group similar acoustic events using AI-powered clustering
               </p>
             </div>
             {/* Debug button */}

           </div>
         </div>
       </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Recording Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Select Recording
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-4">
                <p className="text-gray-600">Loading recordings...</p>
              </div>
            ) : recordings.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-gray-600">No recordings found</p>
              </div>
            ) : (
              <div className="space-y-4">
                <Select
                  value={selectedRecording?.id.toString() || ''}
                  onValueChange={handleRecordingSelect}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a recording to analyze" />
                  </SelectTrigger>
                  <SelectContent>
                    {recordings.map((recording) => (
                      <SelectItem key={recording.id} value={recording.id.toString()}>
                        <div className="flex flex-col">
                          <span className="font-medium">{recording.name || 'Unnamed Recording'}</span>
                          <span className="text-sm text-gray-500">
                            {recording.site_name || 'Unknown Site'} • {Math.round(recording.duration_seconds || 0)}s
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selectedRecording && (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span className="text-sm font-medium text-blue-700">Recording Selected</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Site:</span>
                        <p className="font-medium">{selectedRecording.site_name || 'Unknown'}</p>
                      </div>
                      <div>
                        <span className="text-gray-600">Coordinates:</span>
                                                 <p className="font-medium">
                           {selectedRecording.site_latitude && selectedRecording.site_longitude 
                             ? `${Number(selectedRecording.site_latitude).toFixed(4)}, ${Number(selectedRecording.site_longitude).toFixed(4)}`
                             : 'Not available'
                           }
                         </p>
                      </div>
                      <div>
                        <span className="text-gray-600">Duration:</span>
                        <p className="font-medium">{Math.round(selectedRecording.duration_seconds || 0)}s</p>
                      </div>

                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
                 </Card>

         {/* Events Status */}
         {selectedRecording && (
           <Card>
             <CardHeader>
               <CardTitle className="flex items-center gap-2">
                 <BarChart3 className="h-5 w-5" />
                 Acoustic Events Status
               </CardTitle>
               <p className="text-sm text-gray-600">
                 Check if acoustic events are available for clustering analysis
               </p>
             </CardHeader>
             <CardContent>
               {loadingEvents ? (
                 <div className="text-center py-4">
                   <p className="text-gray-600">Checking events...</p>
                 </div>
               ) : events.length === 0 ? (
                 <div className="text-center py-4">
                   <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                     <div className="flex items-center gap-2 mb-2">
                       <AlertCircle className="h-5 w-5 text-yellow-600" />
                       <span className="font-medium text-yellow-800">No Acoustic Events Found</span>
                     </div>
                     <p className="text-yellow-700 text-sm">
                       This recording doesn't have any acoustic events detected yet.
                     </p>
                     <p className="text-yellow-600 text-xs mt-2">
                       Please run Acoustic Event Detection (AED) first to identify bird calls and sounds.
                     </p>
                   </div>
                 </div>
               ) : (
                 <div className="text-center py-4">
                   <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                     <div className="flex items-center gap-2 mb-2">
                       <CheckCircle className="h-5 w-5 text-green-600" />
                       <span className="font-medium text-green-800">Events Available</span>
                     </div>
                     <p className="text-green-700 text-sm">
                       Found <strong>{totalUniqueEvents}</strong> unique acoustic events for clustering analysis.
                     </p>
                     <p className="text-green-600 text-xs mt-2">
                       Showing {events.length} preview events • You can now start the audio clustering process.
                     </p>
                   </div>
                 </div>
               )}
             </CardContent>
           </Card>
         )}

         {/* Clustering Controls */}
        {!selectedRecording ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Clustering Controls
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center p-6">
                <p className="text-gray-600">
                  Please select a recording above to start audio clustering analysis.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Clustering Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingClusteringStatus ? (
                <div className="text-center p-6">
                  <p className="text-gray-600 mb-4">Checking clustering status...</p>
                  <div className="animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto"></div>
                  </div>
                </div>
              ) : clusteringStatus?.has_clustering ? (
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg">
                  <div>
                    <p className="font-medium text-green-800">
                      Clustering completed! Found {clusteringStatus.cluster_count} clusters
                    </p>
                    <p className="text-sm text-green-600">
                      Last updated: {new Date(clusteringStatus.last_clustering!).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setShowUMAP(!showUMAP)}
                    >
                      {showUMAP ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      {showUMAP ? 'Hide' : 'Show'} Visualization
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={deleteClustering}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Results
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-center p-6">
                  <p className="text-gray-600 mb-4">
                    No clustering results found for this recording. Start clustering to group similar acoustic events.
                  </p>
                  <Button
                    onClick={startClustering}
                    disabled={isClustering}
                    className="px-8"
                  >
                    <BarChart3 className="h-4 w-4 mr-2" />
                    Start Audio Clustering
                  </Button>
                </div>
              )}

              {/* Clustering Progress */}
              {isClustering && (
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span>Progress</span>
                    <span>{clusteringProgress}%</span>
                  </div>
                  <Progress value={clusteringProgress} className="w-full" />
                  <p className="text-sm text-gray-600">{clusteringMessage}</p>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}

        {/* Clusters List */}
        {clusters.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Audio Clusters</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {clusters.map((cluster) => (
                  <div
                    key={cluster.id}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedCluster === cluster.id
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setSelectedCluster(selectedCluster === cluster.id ? null : cluster.id)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-lg">{cluster.name}</h3>
                      <Badge variant="secondary">{cluster.snippet_count} events</Badge>
                    </div>
                    <div className="text-sm text-gray-600">
                      <p>Cluster ID: {cluster.cluster_label}</p>
                      <p>Created: {new Date(cluster.created_at).toLocaleDateString()}</p>
                    </div>
                    <div
                      className="w-4 h-4 rounded-full mt-2"
                      style={{ backgroundColor: getClusterColor(cluster.cluster_label) }}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* UMAP Visualization */}
        {showUMAP && umapPoints.length > 0 && (
          <div className="space-y-6">
            {/* Instructions and Legend - Above the map */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Instructions */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5" />
                    Interactive Visualization Guide
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm text-gray-600">
                    <div className="flex items-start gap-2">
                      <span className="text-blue-600">•</span>
                      <span>Click cluster cards above to filter points</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-blue-600">•</span>
                      <span>Click on points to see event details</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-blue-600">•</span>
                      <span>Use the details card below to play audio</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-blue-600">•</span>
                      <span>Each quadrant represents different audio patterns</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Legend */}
              <Card>
                <CardHeader>
                  <CardTitle>Audio Clusters</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {clusters.map((cluster) => (
                      <div key={cluster.id} className="flex items-center gap-3 text-sm">
                        <div
                          className="w-4 h-4 rounded-full"
                          style={{ backgroundColor: getClusterColor(cluster.cluster_label) }}
                        />
                        <span className="font-medium">{cluster.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {cluster.snippet_count} events
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* UMAP Visualization - Full width, no overlapping elements */}
            <Card>
              <CardHeader>
                <CardTitle>Cluster Visualization (UMAP)</CardTitle>
                <p className="text-sm text-gray-600">
                  Interactive 2D visualization of audio clusters. Each point represents an acoustic event.
                </p>
              </CardHeader>
              <CardContent>
                <div className="relative w-full h-[700px] bg-gray-100 rounded-lg overflow-hidden">
                  <svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 1000 700"
                    className="absolute inset-0"
                  >
                    {/* Background grid */}
                    <defs>
                      <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
                        <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />

                    {/* Center axes (4-quadrant style) */}
                    <line x1="500" y1="0" x2="500" y2="700" stroke="#9ca3af" strokeWidth="2" />
                    <line x1="0" y1="350" x2="1000" y2="350" stroke="#9ca3af" strokeWidth="2" />
                    
                    {/* Axis labels */}
                    <text x="10" y="370" className="text-sm font-medium fill-gray-600">Y-</text>
                    <text x="10" y="680" className="text-sm font-medium fill-gray-600">Y+</text>
                    <text x="20" y="360" className="text-sm font-medium fill-gray-600">X-</text>
                    <text x="980" y="360" className="text-sm font-medium fill-gray-600">X+</text>
                    
                    {/* Quadrant labels */}
                    <text x="50" y="50" className="text-lg font-bold fill-gray-400">Q1</text>
                    <text x="850" y="50" className="text-lg font-bold fill-gray-400">Q2</text>
                    <text x="50" y="650" className="text-lg font-bold fill-gray-400">Q3</text>
                    <text x="850" y="650" className="text-lg font-bold fill-gray-400">Q4</text>

                    {/* UMAP Points */}
                    {filteredUMAPPoints.map((point, index) => {
                      const cluster = clusters.find(c => c.id === point.cluster_id);
                      const color = cluster ? getClusterColor(cluster.cluster_label) : '#999';
                      const isSelected = selectedCluster === point.cluster_id;
                      const isPlaying = playingEvent === point.event_id.toString();
                      
                      // Scale coordinates to fit viewBox (centered around origin)
                      const x = (point.umap_x + 10) * 30 + 250;
                      const y = (point.umap_y + 10) * 30 + 200;
                      
                      return (
                        <circle
                          key={index}
                          cx={x}
                          cy={y}
                          r={isSelected ? 12 : 10}
                          fill={color}
                          stroke={isPlaying ? '#FF6B6B' : isSelected ? '#2563eb' : 'white'}
                          strokeWidth={isPlaying ? 4 : isSelected ? 3 : 2}
                          className="cursor-pointer hover:r-14 transition-all"
                          onClick={() => setSelectedPoint(point)}
                        />
                      );
                    })}
                  </svg>

                  {/* Audio Controls - Only show when playing */}
                  {playingEvent && (
                    <div className="absolute top-6 left-6 bg-white p-4 rounded-lg shadow-lg border">
                      <div className="flex items-center gap-3">
                        <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                        <span className="text-sm font-medium text-gray-700">
                          Playing Event {playingEvent}
                        </span>
                        <Button
                          onClick={() => stopEvent(playingEvent)}
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                        >
                          Stop
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Event Details Card */}
        {selectedPoint && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Event Details
              </CardTitle>
              <p className="text-sm text-gray-600">
                Details for the selected acoustic event
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Event Information */}
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Event Information</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Event ID:</span>
                        <span className="font-medium">{selectedPoint.event_id}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Cluster:</span>
                        <span className="font-medium">
                          {clusters.find(c => c.id === selectedPoint.cluster_id)?.name || 'Unknown'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">UMAP Coordinates:</span>
                        <span className="font-medium">
                          ({selectedPoint.umap_x.toFixed(2)}, {selectedPoint.umap_y.toFixed(2)})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Audio Controls */}
                  <div>
                    <h4 className="font-medium text-gray-900 mb-2">Audio Playback</h4>
                    <div className="flex items-center gap-3">
                      {playingEvent === selectedPoint.event_id.toString() ? (
                        <>
                          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                          <span className="text-sm text-gray-600">Playing...</span>
                          <Button
                            onClick={() => stopEvent(selectedPoint.event_id.toString())}
                            size="sm"
                            variant="outline"
                          >
                            Stop
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            onClick={() => playEvent(selectedPoint.event_id.toString())}
                            size="sm"
                            className="flex items-center gap-2"
                          >
                            <Play className="h-4 w-4" />
                            Play Audio
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Cluster Information */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-2">Cluster Information</h4>
                  {(() => {
                    const cluster = clusters.find(c => c.id === selectedPoint.cluster_id);
                    if (!cluster) return <p className="text-gray-500">Cluster not found</p>;
                    
                    return (
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">Cluster Name:</span>
                          <span className="font-medium">{cluster.name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Label:</span>
                          <span className="font-medium">{cluster.cluster_label}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Event Count:</span>
                          <span className="font-medium">{cluster.snippet_count}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">Created:</span>
                          <span className="font-medium">
                            {new Date(cluster.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Close Button */}
              <div className="flex justify-end mt-6">
                <Button
                  onClick={() => setSelectedPoint(null)}
                  variant="outline"
                  size="sm"
                >
                  Close Details
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Bottom Navigation */}
              <BottomNavigation projectId={projectId} />
    </div>
  );
};

export default AudioClusteringPage;
