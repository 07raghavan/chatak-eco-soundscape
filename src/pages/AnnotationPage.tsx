import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Play, 
  Pause, 
  Volume2, 
  Clock, 
  MapPin, 
  Users, 
  BarChart3,
  Send,
  CheckCircle,
  AlertCircle,
  Mic,
  Music,
  Car,
  Plane,
  User,
  Bug,
  Waves,
  Tag
} from 'lucide-react';
import BottomNavigation from '@/components/BottomNavigation';
import AudioPlayer from '@/components/AudioPlayer';
import { API_BASE_URL } from '@/lib/api';

interface Recording {
  id: string;
  name: string;
  description?: string;
  duration_seconds: number;
  site_name?: string;
  site_latitude: number | string | null;
  site_longitude: number | string | null;
  s3_key: string;
  created_at: string;
}

interface Cluster {
  id: number;
  name: string;
  cluster_label: string;
  snippet_count: number;
  created_at: string;
  annotation_count: number;
  representative_count: number;
  needs_annotation: boolean;
  representative_samples: RepresentativeSample[];
}

interface RepresentativeSample {
  id: number;
  species_label: string;
  confidence_score: number;
  annotation_type: string;
  created_at: string;
  start_ms: number;
  end_ms: number;
}

interface Clip {
  id: number;
  start_ms: number;
  end_ms: number;
  snippet_file_path: string;
  cluster_confidence: number;
  annotation_count: number;
  suggestions: Suggestion[];
  has_high_confidence: boolean;
}

interface Suggestion {
  id: number;
  species: string;
  scientific_name: string;
  confidence: number;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  snippet_file_path?: string;
}

interface UMAPPoint {
  event_id: number;
  umap_x: number;
  umap_y: number;
  cluster_id: number;
}

interface AnnotationForm {
  speciesLabel: string;
  confidenceScore: number;
  backgroundTags: string[];
  notes: string;
}

const AnnotationPage: React.FC = () => {
  const { projectId, recordingId } = useParams<{ projectId: string; recordingId?: string }>();
  const navigate = useNavigate();

  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [signedUrls, setSignedUrls] = useState<{ [clipId: number]: string }>({});
  const [umapPoints, setUmapPoints] = useState<UMAPPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<UMAPPoint | null>(null);
  const [annotationForms, setAnnotationForms] = useState<{ [clipId: number]: AnnotationForm }>({});
  const [showAnnotationForm, setShowAnnotationForm] = useState<{ [clipId: number]: boolean }>({});
  const [successMessages, setSuccessMessages] = useState<{ [clipId: number]: string }>({});
  const [spectrograms, setSpectrograms] = useState<{ [clipId: number]: { url: string; loading: boolean } }>({});

  const backgroundTagOptions = [
    { value: 'traffic', label: 'Traffic', icon: Car },
    { value: 'human', label: 'Human', icon: User },
    { value: 'siren', label: 'Siren', icon: AlertCircle },
    { value: 'insects', label: 'Insects', icon: Bug },
    { value: 'water', label: 'Water', icon: Waves },
    { value: 'plane', label: 'Plane', icon: Plane },
    { value: 'music', label: 'Music', icon: Music },
    { value: 'mic', label: 'Microphone', icon: Mic }
  ];

  // Fetch recordings for the project
  useEffect(() => {
    if (projectId) {
      fetchRecordings();
    }
  }, [projectId]);

  // Fetch clusters when recording is selected
  useEffect(() => {
    if (selectedRecording && projectId) {
      fetchClusters();
    }
  }, [selectedRecording, projectId]);

  // Fetch clips when cluster is selected
  useEffect(() => {
    if (selectedCluster && projectId) {
      fetchClips();
    }
  }, [selectedCluster, projectId]);

  const fetchRecordings = async () => {
    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/projects/${projectId}/recordings`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setRecordings(data.recordings || []);
      } else {
        console.error('Failed to fetch recordings');
      }
    } catch (error) {
      console.error('Error fetching recordings:', error);
    }
  };

  const fetchClusters = async () => {
    if (!selectedRecording || !projectId) return;

    try {
      setLoading(true);
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/annotation/projects/${projectId}/recordings/${selectedRecording.id}/clusters`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setClusters(data.clusters || []);
      } else {
        console.error('Failed to fetch clusters');
      }
    } catch (error) {
      console.error('Error fetching clusters:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchClips = async () => {
    if (!selectedCluster && !selectedPoint) return;

    try {
      setLoading(true);
      const token = localStorage.getItem('chatak_token');
      
      // If a point is selected, fetch clips for that specific event
      if (selectedPoint) {
        const response = await fetch(`${API_BASE_URL}/api/annotation/projects/${projectId}/events/${selectedPoint.event_id}/clips?limit=10`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          const clipsData = data.clips || [];
          setClips(clipsData);
          
          // Fetch detections and signed URLs for all clips in parallel
          await Promise.all([
            fetchDetectionsForClips(clipsData),
            fetchSignedUrlsForClips(clipsData)
          ]);
        } else {
          console.error('Failed to fetch clips for selected point');
        }
      } else if (selectedCluster) {
        // Fetch clips for the selected cluster
        const response = await fetch(`${API_BASE_URL}/api/annotation/projects/${projectId}/clusters/${selectedCluster.id}/clips?limit=20`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          const clipsData = data.clips || [];
          setClips(clipsData);
          
          // Fetch detections and signed URLs for all clips in parallel
          await Promise.all([
            fetchDetectionsForClips(clipsData),
            fetchSignedUrlsForClips(clipsData)
          ]);
          
          // Fetch UMAP data for the cluster
          await fetchUMAPData();
        } else {
          console.error('Failed to fetch clips');
        }
      }
    } catch (error) {
      console.error('Error fetching clips:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch BirdNet detections for clips from events table
  const fetchDetectionsForClips = async (clipsData: Clip[]) => {
    if (!projectId || !selectedRecording) return;
    
    console.log(`🦅 Fetching BirdNet detections for ${clipsData.length} clips from recording ${selectedRecording.id}...`);
    setLoadingSuggestions(true);
    try {
      const token = localStorage.getItem('chatak_token');
      
      // First, get all events for this recording
      const response = await fetch(
        `${API_BASE_URL}/api/recordings/${selectedRecording.id}/events?limit=1000`,
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      );
      
      if (response.ok) {
        const data = await response.json();
        const allEvents = data.events || [];
        
        // For each clip, find overlapping events and use them as suggestions
        const updatedClips = clipsData.map(clip => {
          const overlappingEvents = allEvents.filter((event: any) => {
            const eventStart = event.start_ms;
            const eventEnd = event.end_ms;
            const clipStart = clip.start_ms;
            const clipEnd = clip.end_ms;
            
            // Check if events overlap with clip timing
            return (eventStart < clipEnd && eventEnd > clipStart);
          });
          
          // Sort by confidence and take top 3
          const topSuggestions = overlappingEvents
            .sort((a: any, b: any) => b.confidence - a.confidence)
            .slice(0, 3)
            .map((event: any) => ({
              id: event.id,
              species: event.species,
              scientific_name: event.scientific_name,
              confidence: event.confidence,
              start_ms: event.start_ms,
              end_ms: event.end_ms,
              duration_ms: event.duration_ms
            }));
          
          return {
            ...clip,
            suggestions: topSuggestions,
            has_high_confidence: topSuggestions.length > 0
          };
        });
        
        setClips(updatedClips);
        console.log(`✅ Successfully fetched ${updatedClips.reduce((sum, clip) => sum + clip.suggestions.length, 0)} BirdNet detections for ${updatedClips.length} clips`);
      } else {
        console.error('Failed to fetch events for detections');
      }
    } catch (error) {
      console.error('Error fetching detections:', error);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  // Fetch signed URLs for audio snippets
  const fetchSignedUrlsForClips = async (clipsData: Clip[]) => {
    const newSignedUrls: { [clipId: number]: string } = {};
    
    await Promise.all(
      clipsData.map(async (clip) => {
        const signedUrl = await getSignedUrl(clip.snippet_file_path);
        if (signedUrl) {
          newSignedUrls[clip.id] = signedUrl;
        }
      })
    );
    
    setSignedUrls(prev => ({ ...prev, ...newSignedUrls }));
  };

  // Get signed URL for audio snippet
  const getSignedUrl = async (snippetFilePath: string): Promise<string | null> => {
    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/audio/segment/${encodeURIComponent(snippetFilePath)}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        return data.signedUrl;
      } else {
        console.error('Failed to get signed URL for snippet');
        return null;
      }
    } catch (error) {
      console.error('Error getting signed URL:', error);
      return null;
    }
  };

  // Fetch UMAP data for visualization
  const fetchUMAPData = async () => {
    if (!selectedRecording) return;

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/recordings/${selectedRecording.id}/clustering`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.embeddings) {
          setUmapPoints(data.embeddings);
        }
      } else {
        console.error('Failed to fetch UMAP data');
      }
    } catch (error) {
      console.error('Error fetching UMAP data:', error);
    }
  };

  // Fetch events for a specific point (like clustering page)
  const fetchEventsForPoint = async (eventId: number) => {
    try {
      setLoading(true);
      const token = localStorage.getItem('chatak_token');
      
      // Get the specific event as a clip
      const response = await fetch(`${API_BASE_URL}/api/recordings/${selectedRecording?.id}/events?limit=1000`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        const allEvents = data.events || [];
        
        // Find the specific event
        const targetEvent = allEvents.find((event: any) => event.id === eventId);
        
        if (targetEvent) {
          const clip = {
            id: targetEvent.id,
            start_ms: targetEvent.start_ms,
            end_ms: targetEvent.end_ms,
            snippet_file_path: targetEvent.snippet_file_path,
            cluster_confidence: 1.0,
            annotation_count: 0,
            suggestions: [],
            has_high_confidence: false
          };
          
          setClips([clip]);
          
          // Fetch signed URL for this clip
          await fetchSignedUrlsForClips([clip]);
          
          // Fetch detections for this clip
          await fetchDetectionsForClips([clip]);
        }
      } else {
        console.error('Failed to fetch events for point');
      }
    } catch (error) {
      console.error('Error fetching events for point:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRecordingSelect = (recording: Recording | null) => {
    setSelectedRecording(recording);
    setSelectedCluster(null);
    setSelectedPoint(null);
    setClips([]);
    setSignedUrls({});
    setAnnotationForms({});
    setShowAnnotationForm({});
    setSpectrograms({});
  };

  const handleClusterSelect = (cluster: Cluster | null) => {
    setSelectedCluster(cluster);
    setSelectedPoint(null);
    setClips([]);
    setSignedUrls({});
    setAnnotationForms({});
    setShowAnnotationForm({});
    setSpectrograms({});
  };

  const handlePointClick = (point: UMAPPoint) => {
    setSelectedPoint(point);
    setSelectedCluster(null);
    setClips([]);
    setSignedUrls({});
    setAnnotationForms({});
    setShowAnnotationForm({});
    
    // Load events for this specific point (like clustering page does)
    if (selectedRecording) {
      fetchEventsForPoint(point.event_id);
    }
  };

  const handleSuggestionVote = async (clipId: number, suggestion: Suggestion, vote: 'match' | 'no_match' | 'not_clear') => {
    if (!projectId) return;

    try {
      if (vote === 'match') {
        // Auto-fill the annotation form with suggestion data
        setAnnotationForms(prev => ({
          ...prev,
          [clipId]: {
            speciesLabel: suggestion.species,
            confidenceScore: suggestion.confidence,
            backgroundTags: [],
            notes: `Auto-filled from BirdNet suggestion: ${suggestion.species} (${Math.round(suggestion.confidence * 100)}% confidence)`
          }
        }));
        setShowAnnotationForm(prev => ({ ...prev, [clipId]: true }));
      } else if (vote === 'no_match') {
        // Show empty form for manual annotation
        setAnnotationForms(prev => ({
          ...prev,
          [clipId]: {
            speciesLabel: '',
            confidenceScore: 0.8,
            backgroundTags: [],
            notes: `Rejected BirdNet suggestion: ${suggestion.species}`
          }
        }));
        setShowAnnotationForm(prev => ({ ...prev, [clipId]: true }));
      } else {
        // Not clear - just log the vote
        console.log(`Vote recorded: ${vote} for suggestion ${suggestion.species}`);
      }

      // Submit the vote to backend
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/annotation/projects/${projectId}/clips/${clipId}/annotate-with-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          clusterId: selectedCluster?.id || selectedPoint?.cluster_id,
          annotationType: 'suggestion_vote',
          speciesLabel: vote === 'match' ? suggestion.species : '',
          confidenceScore: vote === 'match' ? suggestion.confidence : 0.8,
          backgroundTags: [],
          notes: `Voted ${vote} on suggestion: ${suggestion.species}`,
          suggestionVotes: [{
            suggestionId: suggestion.id,
            vote
          }],
          regionBoxes: []
        })
      });

      if (response.ok) {
        console.log(`Suggestion vote submitted: ${vote}`);
        // Show success message
        setSuccessMessages(prev => ({ ...prev, [clipId]: `Vote recorded: ${vote} for ${suggestion.species}` }));
        setTimeout(() => {
          setSuccessMessages(prev => {
            const newMessages = { ...prev };
            delete newMessages[clipId];
            return newMessages;
          });
        }, 3000);
      } else {
        console.error('Failed to submit suggestion vote');
      }
    } catch (error) {
      console.error('Error submitting suggestion vote:', error);
    }
  };

  const handleAnnotationSubmit = async (clipId: number) => {
    if (!projectId) return;

    const form = annotationForms[clipId];
    if (!form) return;

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/annotation/projects/${projectId}/clips/${clipId}/annotate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          clusterId: selectedCluster?.id || selectedPoint?.cluster_id,
          annotationType: 'representative_sample',
          ...form
        })
      });

      if (response.ok) {
        // Show success message
        const responseData = await response.json();
        const isUpdate = responseData.metadata?.updated;
        setSuccessMessages(prev => ({ 
          ...prev, 
          [clipId]: `${isUpdate ? 'Annotation updated' : 'Annotation saved'}: ${form.speciesLabel}` 
        }));
        setTimeout(() => {
          setSuccessMessages(prev => {
            const newMessages = { ...prev };
            delete newMessages[clipId];
            return newMessages;
          });
        }, 3000);
        
        // Reset form and hide it
        setAnnotationForms(prev => {
          const newForms = { ...prev };
          delete newForms[clipId];
          return newForms;
        });
        setShowAnnotationForm(prev => ({ ...prev, [clipId]: false }));
        
        // Refresh clusters and clips
        await fetchClusters();
        await fetchClips();
      } else {
        console.error('Failed to create annotation');
      }
    } catch (error) {
      console.error('Error creating annotation:', error);
    }
  };

  const handleSubmitToPublic = async (clipId: number) => {
    if (!projectId) return;

    try {
      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/annotation/projects/${projectId}/clips/${clipId}/submit-to-public`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          submissionReason: 'Difficult to classify - needs volunteer input',
          difficultyLevel: 'Hard'
        })
      });

      if (response.ok) {
        console.log('Clip submitted to public platform');
      } else {
        console.error('Failed to submit clip to public platform');
      }
    } catch (error) {
      console.error('Error submitting clip to public:', error);
    }
  };

  const handleGenerateSpectrogram = async (clipId: number) => {
    if (!projectId) return;

    try {
      // Set loading state
      setSpectrograms(prev => ({ ...prev, [clipId]: { url: '', loading: true } }));

      const token = localStorage.getItem('chatak_token');
      const response = await fetch(`${API_BASE_URL}/api/spectrogram/generate/${clipId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          projectId,
          width: 1200,
          height: 800,
          fmin: 0,
          fmax: 8000
        })
      });

      if (response.ok) {
        const result = await response.json();
        console.log('Spectrogram generated:', result);
        
        if (result.success && result.spectrogram?.signedUrl) {
          // Store spectrogram URL
          setSpectrograms(prev => ({ 
            ...prev, 
            [clipId]: { url: result.spectrogram.signedUrl, loading: false } 
          }));
          
          // Show success message
          setSuccessMessages(prev => ({ ...prev, [clipId]: 'Spectrogram generated successfully' }));
          setTimeout(() => {
            setSuccessMessages(prev => {
              const newMessages = { ...prev };
              delete newMessages[clipId];
              return newMessages;
            });
          }, 3000);
        } else {
          setSpectrograms(prev => ({ ...prev, [clipId]: { url: '', loading: false } }));
          console.error('Failed to generate spectrogram:', result.error);
        }
      } else {
        setSpectrograms(prev => ({ ...prev, [clipId]: { url: '', loading: false } }));
        console.error('Failed to generate spectrogram');
      }
    } catch (error) {
      setSpectrograms(prev => ({ ...prev, [clipId]: { url: '', loading: false } }));
      console.error('Error generating spectrogram:', error);
    }
  };

  // Get cluster color for visualization
  const getClusterColor = (clusterLabel: string) => {
    const colors = [
      '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6',
      '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1'
    ];
    const index = parseInt(clusterLabel) % colors.length;
    return colors[index];
  };

  // Filter UMAP points for selected cluster
  const filteredUMAPPoints = useMemo(() => {
    if (!selectedCluster) return umapPoints;
    return umapPoints.filter(point => point.cluster_id === selectedCluster.id);
  }, [umapPoints, selectedCluster]);

  // Safe coordinate display
  const getSafeCoordinate = (coord: number | string | null, type: 'lat' | 'lng') => {
    if (coord === null || coord === undefined) return 'Unknown';
    const num = Number(coord);
    if (isNaN(num)) return 'Invalid';
    return num.toFixed(6);
  };

  // Safe duration display
  const getSafeDuration = (duration: number | null | undefined) => {
    return Math.round(duration || 0);
  };

  // Use exact same UMAP scaling as clustering page
  const getUMAPScaling = () => {
    // Exact same scaling as AudioClusteringPage
    return { scale: 30, offsetX: 250, offsetY: 200, padding: 10 };
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="container mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Audio Annotation</h1>
            <p className="text-gray-600">Annotate audio clips with species identification and confidence scores</p>
          </div>
          <div className="flex gap-2">
            <Link to={`/projects/${projectId}/annotation/public`}>
              <Button variant="outline" size="sm">
                <Users className="w-4 h-4 mr-2" />
                Public Annotation Platform
              </Button>
            </Link>
          </div>
        </div>

        {/* Recording Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic className="w-5 h-5" />
              Select Recording
            </CardTitle>
            <CardDescription>
              Choose a recording to analyze and annotate its audio clips
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                <p className="text-gray-600 mt-2">Loading recordings...</p>
              </div>
            ) : recordings.length === 0 ? (
              <div className="text-center py-8">
                <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No recordings found for this project</p>
              </div>
            ) : (
              <div className="space-y-4">
                <Select
                  value={selectedRecording?.id.toString() || ''}
                  onValueChange={(value) => {
                    const recording = recordings.find(r => r.id.toString() === value);
                    handleRecordingSelect(recording || null);
                  }}
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
                            {recording.site_name || 'Unknown Site'} • {getSafeDuration(recording.duration_seconds)}s
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedRecording && (
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-gray-600">Site:</span>
                        <p className="font-medium">{selectedRecording.site_name || 'Unknown'}</p>
                      </div>
                      <div>
                        <span className="text-gray-600">Coordinates:</span>
                        <p className="font-medium">
                          {getSafeCoordinate(selectedRecording.site_latitude, 'lat')}, {getSafeCoordinate(selectedRecording.site_longitude, 'lng')}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-600">Duration:</span>
                        <p className="font-medium">{getSafeDuration(selectedRecording.duration_seconds)}s</p>
                      </div>
                      <div>
                        <span className="text-gray-600">Created:</span>
                        <p className="font-medium">{new Date(selectedRecording.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cluster Selection */}
        {selectedRecording && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Select Cluster
              </CardTitle>
              <CardDescription>
                Choose a cluster to annotate, or click on the map to select specific events
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-600 mt-2">Loading clusters...</p>
                </div>
              ) : clusters.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No clusters found. Run clustering analysis first.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex gap-2">
                    <Select
                      value={selectedCluster?.id.toString() || ''}
                      onValueChange={(value) => {
                        const cluster = clusters.find(c => c.id.toString() === value);
                        handleClusterSelect(cluster || null);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a cluster to analyze" />
                      </SelectTrigger>
                      <SelectContent>
                        {clusters.map((cluster) => (
                          <SelectItem key={cluster.id} value={cluster.id.toString()}>
                            <div className="flex flex-col">
                              <span className="font-medium">Cluster {cluster.cluster_label}</span>
                              <span className="text-sm text-gray-500">
                                {cluster.snippet_count} clips
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedCluster && (
                      <Button variant="outline" size="sm" onClick={() => handleClusterSelect(null)} className="whitespace-nowrap">
                        Clear
                      </Button>
                    )}
                  </div>
                  {selectedCluster && (
                    <div className="p-4 bg-green-50 rounded-lg">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Cluster:</span>
                          <p className="font-medium">{selectedCluster.cluster_label}</p>
                        </div>
                        <div>
                          <span className="text-gray-600">Clips:</span>
                          <p className="font-medium">{selectedCluster.snippet_count}</p>
                        </div>
                        <div>
                          <span className="text-gray-600">Annotations:</span>
                          <p className="font-medium">{selectedCluster.annotation_count}</p>
                        </div>
                        <div>
                          <span className="text-gray-600">Created:</span>
                          <p className="font-medium">{new Date(selectedCluster.created_at).toLocaleDateString()}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* UMAP Visualization */}
        {selectedRecording && umapPoints.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Interactive Cluster Map
              </CardTitle>
              <CardDescription>
                Click on any point to fetch clips for that specific event. Selected cluster is highlighted.
              </CardDescription>
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
                  
                  {/* Points */}
                  {umapPoints.map((point, index) => {
                    const cluster = clusters.find(c => c.id === point.cluster_id);
                    const isSelectedCluster = selectedCluster && point.cluster_id === selectedCluster.id;
                    const isSelectedPoint = selectedPoint && point.event_id === selectedPoint.event_id;
                    const color = cluster ? getClusterColor(cluster.cluster_label) : '#999';
                    const opacity = isSelectedCluster || isSelectedPoint ? 1 : 0.3;
                    const strokeColor = isSelectedPoint ? '#dc2626' : (isSelectedCluster ? '#2563eb' : 'white');
                    const strokeWidth = isSelectedPoint ? 4 : (isSelectedCluster ? 3 : 2);
                    const radius = isSelectedPoint ? 16 : (isSelectedCluster ? 12 : 10);
                    
                    const { scale, offsetX, offsetY, padding } = getUMAPScaling();
                    const x = (point.umap_x + padding) * scale + offsetX;
                    const y = (point.umap_y + padding) * scale + offsetY;
                    
                    return (
                      <circle
                        key={index}
                        cx={x}
                        cy={y}
                        r={radius}
                        fill={color}
                        opacity={opacity}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        className="cursor-pointer hover:r-16 transition-all"
                        onClick={() => handlePointClick(point)}
                      />
                    );
                  })}
                </svg>

                {/* Cluster Legend */}
                <div className="absolute top-4 right-4 bg-white p-3 rounded-lg shadow-lg border">
                  <div className="text-sm font-medium text-gray-700 mb-2">Clusters</div>
                  <div className="space-y-1">
                    {clusters.map((cluster) => {
                      const isSelected = selectedCluster && cluster.id === selectedCluster.id;
                      return (
                        <div key={cluster.id} className="flex items-center gap-2">
                          <div 
                            className="w-3 h-3 rounded-full border border-gray-300"
                            style={{ 
                              backgroundColor: getClusterColor(cluster.cluster_label),
                              opacity: isSelected ? 1 : 0.3
                            }}
                          />
                          <span className={`text-xs ${isSelected ? 'font-medium text-gray-900' : 'text-gray-500'}`}>
                            Cluster {cluster.cluster_label} ({cluster.snippet_count})
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Selected Point Details */}
        {selectedPoint && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Selected Event Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-600">Event ID:</span>
                  <p className="font-medium">{selectedPoint.event_id}</p>
                </div>
                <div>
                  <span className="text-gray-600">Cluster:</span>
                  <p className="font-medium">
                    {clusters.find(c => c.id === selectedPoint.cluster_id)?.cluster_label || 'Unknown'}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600">UMAP X:</span>
                  <p className="font-medium">{selectedPoint.umap_x.toFixed(2)}</p>
                </div>
                <div>
                  <span className="text-gray-600">UMAP Y:</span>
                  <p className="font-medium">{selectedPoint.umap_y.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Clips for Annotation */}
        {(selectedCluster || selectedPoint) && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="w-5 h-5" />
                {selectedPoint ? 'Event Clips' : `Cluster ${selectedCluster?.cluster_label} Clips`}
                <Badge variant="secondary">{clips.length} clips</Badge>
                {clips.length > 0 && (
                  <div className="flex gap-2 ml-4">
                    <Badge variant="outline" className="text-xs">
                      {clips.filter(c => c.has_high_confidence).length} with suggestions
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {clips.filter(c => !c.has_high_confidence).length} without suggestions
                    </Badge>
                  </div>
                )}
              </CardTitle>
              <CardDescription>
                Listen to clips and annotate them. Use BirdNet suggestions or provide your own labels.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-600 mt-2">Loading clips...</p>
                </div>
              ) : loadingSuggestions ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto"></div>
                  <p className="text-gray-600 mt-2">Loading BirdNet detections...</p>
                </div>
              ) : clips.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No clips found for selection</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {clips.map((clip) => (
                    <div key={clip.id} className="p-6 border rounded-lg bg-white shadow-sm">
                      {/* Success Message */}
                      {successMessages[clip.id] && (
                        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600" />
                            <span className="text-sm text-green-800 font-medium">
                              {successMessages[clip.id]}
                            </span>
                          </div>
                        </div>
                      )}
                      
                      {/* Clip Header */}
                      <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-gray-500" />
                          <span className="text-sm font-medium">
                            {clip.start_ms}ms - {clip.end_ms}ms
                          </span>
                        </div>
                      </div>
                      
                      {/* Clip Content - Two Column Layout */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-4">
                        {/* Left Column - Suggestions */}
                        <div className="space-y-4">
                          {/* BirdNet Suggestions with Voting */}
                          {clip.has_high_confidence && (
                            <div>
                              <h4 className="text-sm font-medium text-gray-700 mb-2">BirdNet Suggestions:</h4>
                              <div className="space-y-2">
                                {clip.suggestions.map((suggestion) => (
                                  <div key={suggestion.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div className="flex-1">
                                      <div className="font-medium text-sm">
                                        {suggestion.species}
                                      </div>
                                      <div className="text-xs text-gray-600">
                                        {suggestion.scientific_name} • {Math.round(suggestion.confidence * 100)}% confidence
                                      </div>
                                    </div>
                                    <div className="flex gap-1">
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs bg-green-50 hover:bg-green-100 text-green-700"
                                        onClick={() => handleSuggestionVote(clip.id, suggestion, 'match')}
                                      >
                                        ✓ Match
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs bg-red-50 hover:bg-red-100 text-red-700"
                                        onClick={() => handleSuggestionVote(clip.id, suggestion, 'no_match')}
                                      >
                                        ✗ No Match
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="h-7 px-2 text-xs bg-yellow-50 hover:bg-yellow-100 text-yellow-700"
                                        onClick={() => handleSuggestionVote(clip.id, suggestion, 'not_clear')}
                                      >
                                        ? Not Clear
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* No Suggestions Message */}
                          {!clip.has_high_confidence && clip.suggestions.length === 0 && (
                            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-yellow-600" />
                                <span className="text-sm text-yellow-800">
                                  No BirdNet suggestions available for this clip
                                </span>
                              </div>
                              <p className="text-xs text-yellow-700 mt-1">
                                You can still annotate this clip manually using the Label button
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Right Column - Audio Player and Spectrogram */}
                        <div className="space-y-4">
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2">Audio Playback:</h4>
                            {signedUrls[clip.id] ? (
                              <AudioPlayer 
                                audioUrl={signedUrls[clip.id]}
                                title={`Clip ${clip.start_ms}ms - ${clip.end_ms}ms`}
                                className="w-full"
                              />
                            ) : (
                              <div className="p-4 border rounded-lg bg-gray-50 text-center">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
                                <p className="text-sm text-gray-600">Loading audio...</p>
                              </div>
                            )}
                          </div>

                          {/* Spectrogram Display */}
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-2">Spectrogram:</h4>
                            {spectrograms[clip.id]?.loading ? (
                              <div className="p-4 border rounded-lg bg-blue-50 text-center">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto mb-2"></div>
                                <p className="text-sm text-blue-600">Generating spectrogram...</p>
                              </div>
                            ) : spectrograms[clip.id]?.url ? (
                              <div className="border rounded-lg overflow-hidden">
                                <img 
                                  src={spectrograms[clip.id].url} 
                                  alt="Spectrogram" 
                                  className="w-full h-auto"
                                  style={{ maxHeight: '300px', objectFit: 'contain' }}
                                />
                              </div>
                            ) : (
                              <div className="p-4 border rounded-lg bg-gray-50 text-center">
                                <p className="text-sm text-gray-600">No spectrogram available</p>
                                <p className="text-xs text-gray-500 mt-1">Click "View Spectrogram" to generate</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Action Buttons - Bottom Row */}
                      <div className="flex gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleGenerateSpectrogram(clip.id)}
                        >
                          <BarChart3 className="w-4 h-4 mr-1" />
                          View Spectrogram
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleSubmitToPublic(clip.id)}
                        >
                          <Send className="w-4 h-4 mr-1" />
                          Send to Public Annotation
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => {
                            // If form is already shown, replace with empty form
                            if (showAnnotationForm[clip.id]) {
                              setAnnotationForms(prev => ({
                                ...prev,
                                [clip.id]: {
                                  speciesLabel: '',
                                  confidenceScore: 0.8,
                                  backgroundTags: [],
                                  notes: ''
                                }
                              }));
                            }
                            setShowAnnotationForm(prev => ({ ...prev, [clip.id]: !prev[clip.id] }));
                          }}
                        >
                          <Tag className="w-4 h-4 mr-1" />
                          {showAnnotationForm[clip.id] ? 'Reset' : 'Start Labeling'}
                        </Button>
                      </div>
                      


                      {/* Annotation Form */}
                      {showAnnotationForm[clip.id] && (
                        <div className="mt-4 p-4 border rounded-lg bg-blue-50">
                          <h4 className="font-medium text-blue-900 mb-3">Annotation Form</h4>
                          <div className="space-y-4">
                            <div>
                              <Label htmlFor={`species-${clip.id}`}>Species Label</Label>
                              <Input
                                id={`species-${clip.id}`}
                                placeholder="e.g., American Robin, Northern Cardinal"
                                value={annotationForms[clip.id]?.speciesLabel || ''}
                                onChange={(e) => setAnnotationForms(prev => ({
                                  ...prev,
                                  [clip.id]: { ...prev[clip.id], speciesLabel: e.target.value }
                                }))}
                              />
                            </div>

                            <div>
                              <Label htmlFor={`confidence-${clip.id}`}>Confidence Score</Label>
                              <Select
                                value={(annotationForms[clip.id]?.confidenceScore || 0.8).toString()}
                                onValueChange={(value) => setAnnotationForms(prev => ({
                                  ...prev,
                                  [clip.id]: { ...prev[clip.id], confidenceScore: parseFloat(value) }
                                }))}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="1.0">100% - Very Sure</SelectItem>
                                  <SelectItem value="0.9">90% - Quite Sure</SelectItem>
                                  <SelectItem value="0.8">80% - Pretty Sure</SelectItem>
                                  <SelectItem value="0.7">70% - Somewhat Sure</SelectItem>
                                  <SelectItem value="0.6">60% - Not Very Sure</SelectItem>
                                  <SelectItem value="0.5">50% - Uncertain</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label>Background Tags</Label>
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                                {backgroundTagOptions.map((tag) => {
                                  const Icon = tag.icon;
                                  const isSelected = annotationForms[clip.id]?.backgroundTags?.includes(tag.value) || false;
                                  return (
                                    <Button
                                      key={tag.value}
                                      type="button"
                                      variant={isSelected ? "default" : "outline"}
                                      size="sm"
                                      className="h-auto p-2 flex flex-col items-center gap-1"
                                      onClick={() => {
                                        const currentTags = annotationForms[clip.id]?.backgroundTags || [];
                                        const newTags = isSelected 
                                          ? currentTags.filter(t => t !== tag.value)
                                          : [...currentTags, tag.value];
                                        setAnnotationForms(prev => ({
                                          ...prev,
                                          [clip.id]: { ...prev[clip.id], backgroundTags: newTags }
                                        }));
                                      }}
                                    >
                                      <Icon className="w-4 h-4" />
                                      <span className="text-xs">{tag.label}</span>
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>

                            <div>
                              <Label htmlFor={`notes-${clip.id}`}>Notes</Label>
                              <Textarea
                                id={`notes-${clip.id}`}
                                placeholder="Additional observations, uncertainties, or context..."
                                value={annotationForms[clip.id]?.notes || ''}
                                onChange={(e) => setAnnotationForms(prev => ({
                                  ...prev,
                                  [clip.id]: { ...prev[clip.id], notes: e.target.value }
                                }))}
                                rows={3}
                              />
                            </div>

                            <div className="flex gap-2">
                              <Button 
                                onClick={() => handleAnnotationSubmit(clip.id)}
                                disabled={!annotationForms[clip.id]?.speciesLabel}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Submit Annotation
                              </Button>
                              <Button 
                                variant="outline"
                                onClick={() => {
                                  setShowAnnotationForm(prev => ({ ...prev, [clip.id]: false }));
                                  setAnnotationForms(prev => {
                                    const newForms = { ...prev };
                                    delete newForms[clip.id];
                                    return newForms;
                                  });
                                }}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <BottomNavigation projectId={projectId} />
    </div>
  );
};

export default AnnotationPage;
