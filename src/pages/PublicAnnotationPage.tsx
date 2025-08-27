import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import AudioPlayer from '@/components/AudioPlayer';
import { 
  Play, 
  Pause, 
  Volume2, 
  Clock, 
  MapPin, 
  Users, 
  BarChart3,
  CheckCircle,
  AlertCircle,
  Info,
  Mic,
  Music,
  Car,
  Plane,
  User,
  Bug,
  Waves,
  Trophy,
  Star,
  Target,
  Award
} from 'lucide-react';

interface ClipSubmission {
  id: number;
  project_id: number;
  cluster_id: number;
  event_id: number;
  submission_reason: string;
  difficulty_level: string;
  status: string;
  volunteer_annotations_count: number;
  consensus_reached: boolean;
  consensus_species: string;
  consensus_confidence: number;
  created_at: string;
  event: {
    start_ms: number;
    end_ms: number;
    snippet_file_path: string;
  };
  cluster: {
    name: string;
    cluster_label: string;
  };
}

interface VolunteerProgress {
  total_annotations: number;
  accuracy_score: number;
  level: string;
  experience_points: number;
  badges: string[];
  streak_days: number;
}

interface AnnotationForm {
  basicClassification: string;
  detailedSpecies: string;
  confidenceLevel: string;
  backgroundNoise: string[];
  notes: string;
}

const PublicAnnotationPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  
  const [availableClips, setAvailableClips] = useState<ClipSubmission[]>([]);
  const [selectedClip, setSelectedClip] = useState<ClipSubmission | null>(null);
  const [volunteerProgress, setVolunteerProgress] = useState<VolunteerProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [annotationForm, setAnnotationForm] = useState<AnnotationForm>({
    basicClassification: '',
    detailedSpecies: '',
    confidenceLevel: 'Somewhat Sure',
    backgroundNoise: [],
    notes: ''
  });

  const basicClassifications = [
    { value: 'Bird', label: 'Bird', icon: Mic, color: 'bg-blue-100 text-blue-800' },
    { value: 'Frog', label: 'Frog', icon: Waves, color: 'bg-green-100 text-green-800' },
    { value: 'Bat', label: 'Bat', icon: Mic, color: 'bg-purple-100 text-purple-800' },
    { value: 'Mammal', label: 'Mammal', icon: User, color: 'bg-orange-100 text-orange-800' },
    { value: 'Car', label: 'Car', icon: Car, color: 'bg-gray-100 text-gray-800' },
    { value: 'Plane', label: 'Plane', icon: Plane, color: 'bg-indigo-100 text-indigo-800' },
    { value: 'Human', label: 'Human', icon: User, color: 'bg-pink-100 text-pink-800' },
    { value: 'Insect', label: 'Insect', icon: Bug, color: 'bg-yellow-100 text-yellow-800' },
    { value: 'Water', label: 'Water', icon: Waves, color: 'bg-cyan-100 text-cyan-800' },
    { value: 'Unknown', label: 'Unknown', icon: AlertCircle, color: 'bg-red-100 text-red-800' }
  ];

  const backgroundNoiseOptions = [
    { value: 'traffic', label: 'Traffic', icon: Car },
    { value: 'human', label: 'Human', icon: User },
    { value: 'siren', label: 'Siren', icon: AlertCircle },
    { value: 'insects', label: 'Insects', icon: Bug },
    { value: 'water', label: 'Water', icon: Waves },
    { value: 'plane', label: 'Plane', icon: Plane },
    { value: 'music', label: 'Music', icon: Music },
    { value: 'mic', label: 'Microphone', icon: Mic }
  ];

  const confidenceLevels = [
    { value: 'Very Sure', label: 'Very Sure', color: 'text-green-600' },
    { value: 'Somewhat Sure', label: 'Somewhat Sure', color: 'text-yellow-600' },
    { value: 'Not Sure', label: 'Not Sure', color: 'text-red-600' }
  ];

  // Fetch available clips for annotation
  useEffect(() => {
    if (projectId) {
      fetchAvailableClips();
      fetchVolunteerProgress();
    }
  }, [projectId]);

  const fetchAvailableClips = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/annotation/projects/${projectId}/public-clips`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAvailableClips(data.clips || []);
      } else {
        console.error('Failed to fetch available clips');
      }
    } catch (error) {
      console.error('Error fetching available clips:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchVolunteerProgress = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/annotation/volunteer/progress`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setVolunteerProgress(data.progress);
      }
    } catch (error) {
      console.error('Error fetching volunteer progress:', error);
    }
  };

  const handleClipSelect = (clip: ClipSubmission) => {
    setSelectedClip(clip);
    // Reset form when selecting new clip
    setAnnotationForm({
      basicClassification: '',
      detailedSpecies: '',
      confidenceLevel: 'Somewhat Sure',
      backgroundNoise: [],
      notes: ''
    });
  };

  const handleAnnotationSubmit = async () => {
    if (!selectedClip || !projectId) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/annotation/volunteer/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          clipSubmissionId: selectedClip.id,
          ...annotationForm
        })
      });

      if (response.ok) {
        // Reset form and refresh data
        setAnnotationForm({
          basicClassification: '',
          detailedSpecies: '',
          confidenceLevel: 'Somewhat Sure',
          backgroundNoise: [],
          notes: ''
        });
        
        // Refresh clips and progress
        await fetchAvailableClips();
        await fetchVolunteerProgress();
        
        // Show success message (you could add a toast notification here)
        console.log('Annotation submitted successfully!');
      } else {
        console.error('Failed to submit annotation');
      }
    } catch (error) {
      console.error('Error submitting annotation:', error);
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'Master': return 'text-purple-600';
      case 'Expert': return 'text-blue-600';
      case 'Intermediate': return 'text-green-600';
      case 'Beginner': return 'text-gray-600';
      default: return 'text-gray-600';
    }
  };

  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'Master': return <Trophy className="w-5 h-5" />;
      case 'Expert': return <Star className="w-5 h-5" />;
      case 'Intermediate': return <Target className="w-5 h-5" />;
      case 'Beginner': return <Award className="w-5 h-5" />;
      default: return <Award className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Public Annotation Platform</h1>
          <p className="text-gray-600">Help classify audio clips and contribute to acoustic research</p>
        </div>

        {/* Volunteer Progress Dashboard */}
        {volunteerProgress && (
          <Card className="mb-6 bg-gradient-to-r from-blue-50 to-purple-50 border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-900">
                {getLevelIcon(volunteerProgress.level)}
                Volunteer Dashboard - {volunteerProgress.level}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{volunteerProgress.total_annotations}</div>
                  <div className="text-sm text-gray-600">Total Annotations</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{volunteerProgress.accuracy_score}%</div>
                  <div className="text-sm text-gray-600">Accuracy Score</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{volunteerProgress.experience_points}</div>
                  <div className="text-sm text-gray-600">Experience Points</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-orange-600">{volunteerProgress.streak_days}</div>
                  <div className="text-sm text-gray-600">Day Streak</div>
                </div>
              </div>
              
              {/* Progress to next level */}
              <div className="mt-4">
                <div className="flex justify-between text-sm text-gray-600 mb-1">
                  <span>Progress to next level</span>
                  <span>{volunteerProgress.experience_points % 100}/100 XP</span>
                </div>
                <Progress value={(volunteerProgress.experience_points % 100)} className="h-2" />
              </div>

              {/* Badges */}
              {volunteerProgress.badges.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-2">Badges Earned:</h4>
                  <div className="flex gap-2 flex-wrap">
                    {volunteerProgress.badges.map((badge, index) => (
                      <Badge key={index} variant="secondary" className="bg-yellow-100 text-yellow-800">
                        {badge}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Available Clips */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="w-5 h-5" />
                Available Clips
                <Badge variant="secondary">{availableClips.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
                  <p className="text-gray-600 mt-2">Loading clips...</p>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {availableClips.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Mic className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                      <p>No clips available for annotation</p>
                      <p className="text-sm">Check back later for new submissions</p>
                    </div>
                  ) : (
                    availableClips.map((clip) => (
                      <div
                        key={clip.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          selectedClip?.id === clip.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                        onClick={() => handleClipSelect(clip)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="font-medium text-gray-900">
                            Cluster {clip.cluster?.cluster_label}
                          </h3>
                          <Badge 
                            variant="secondary"
                            className={
                              clip.difficulty_level === 'Easy' ? 'bg-green-100 text-green-800' :
                              clip.difficulty_level === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                              'bg-red-100 text-red-800'
                            }
                          >
                            {clip.difficulty_level}
                          </Badge>
                        </div>
                        
                        <div className="text-sm text-gray-600 space-y-1">
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {clip.event.start_ms}ms - {clip.event.end_ms}ms
                          </div>
                          <div className="text-xs text-gray-500">
                            {clip.volunteer_annotations_count} annotations so far
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Annotation Interface */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Annotate Clip
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedClip ? (
                <div className="text-center py-12 text-gray-500">
                  <Mic className="w-16 h-16 mx-auto mb-4 text-gray-300" />
                  <p>Select a clip from the left to start annotating</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Clip Info */}
                  <div className="p-3 bg-gray-50 rounded-lg">
                    <h4 className="font-medium text-gray-900 mb-2">Selected Clip</h4>
                    <div className="text-sm text-gray-600 space-y-1">
                      <div>Cluster: {selectedClip.cluster?.cluster_label}</div>
                      <div>Time: {selectedClip.event.start_ms}ms - {selectedClip.event.end_ms}ms</div>
                      <div>Difficulty: {selectedClip.difficulty_level}</div>
                      <div>Reason: {selectedClip.submission_reason}</div>
                    </div>
                  </div>

                                     {/* Audio Player */}
                   <AudioPlayer 
                     audioUrl={`/api/audio/snippet/${selectedClip.event.snippet_file_path}`}
                     title={`Cluster ${selectedClip.cluster?.cluster_label} - ${selectedClip.event.start_ms}ms to ${selectedClip.event.end_ms}ms`}
                     className="w-full"
                   />

                  {/* Annotation Form */}
                  <div className="space-y-4">
                    <div>
                      <Label>Basic Classification *</Label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {basicClassifications.map((classification) => {
                          const Icon = classification.icon;
                          const isSelected = annotationForm.basicClassification === classification.value;
                          return (
                            <Button
                              key={classification.value}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              className="h-auto p-3 flex flex-col items-center gap-2"
                              onClick={() => setAnnotationForm(prev => ({ 
                                ...prev, 
                                basicClassification: classification.value 
                              }))}
                            >
                              <Icon className="w-5 h-5" />
                              <span className="text-sm">{classification.label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {annotationForm.basicClassification && (
                      <div>
                        <Label htmlFor="detailedSpecies">Detailed Species (Optional)</Label>
                        <Input
                          id="detailedSpecies"
                          placeholder="e.g., American Robin, Northern Cardinal"
                          value={annotationForm.detailedSpecies}
                          onChange={(e) => setAnnotationForm(prev => ({ 
                            ...prev, 
                            detailedSpecies: e.target.value 
                          }))}
                        />
                      </div>
                    )}

                    <div>
                      <Label>Confidence Level *</Label>
                      <Select
                        value={annotationForm.confidenceLevel}
                        onValueChange={(value) => setAnnotationForm(prev => ({ 
                          ...prev, 
                          confidenceLevel: value 
                        }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {confidenceLevels.map((level) => (
                            <SelectItem key={level.value} value={level.value}>
                              <span className={level.color}>{level.label}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label>Background Noise (Optional)</Label>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {backgroundNoiseOptions.map((noise) => {
                          const Icon = noise.icon;
                          const isSelected = annotationForm.backgroundNoise.includes(noise.value);
                          return (
                            <Button
                              key={noise.value}
                              type="button"
                              variant={isSelected ? "default" : "outline"}
                              size="sm"
                              className="h-auto p-2 flex flex-col items-center gap-1"
                              onClick={() => {
                                if (isSelected) {
                                  setAnnotationForm(prev => ({
                                    ...prev,
                                    backgroundNoise: prev.backgroundNoise.filter(n => n !== noise.value)
                                  }));
                                } else {
                                  setAnnotationForm(prev => ({
                                    ...prev,
                                    backgroundNoise: [...prev.backgroundNoise, noise.value]
                                  }));
                                }
                              }}
                            >
                              <Icon className="w-4 h-4" />
                              <span className="text-xs">{noise.label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="notes">Additional Notes (Optional)</Label>
                      <Textarea
                        id="notes"
                        placeholder="Any additional observations or context..."
                        value={annotationForm.notes}
                        onChange={(e) => setAnnotationForm(prev => ({ 
                          ...prev, 
                          notes: e.target.value 
                        }))}
                        rows={3}
                      />
                    </div>

                    <Button 
                      className="w-full"
                      onClick={handleAnnotationSubmit}
                      disabled={!annotationForm.basicClassification}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Submit Annotation
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default PublicAnnotationPage;
