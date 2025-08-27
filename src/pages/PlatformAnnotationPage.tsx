import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { 
  Play, Pause, SkipBack, SkipForward, 
  Volume2, VolumeX, CheckCircle, XCircle,
  ArrowLeft, ArrowRight, Loader2, Eye,
  Match, X, HelpCircle
} from 'lucide-react';

interface Cluster {
  id: number;
  label: string;
  recording_id: number;
  recording_name: string;
  duration_seconds: number;
  recording_s3_key: string;
  created_at: string;
}

interface ROI {
  roi_id: number;
  start_ms: number;
  end_ms: number;
  roi_s3_key: string;
  roi_confidence: number;
}

interface Suggestion {
  type: string;
  label: string;
  scientific_name: string;
  confidence: number;
}

interface Annotation {
  species: string;
  soundType: string;
  confidence: number;
  notes: string;
  backgroundTags: string[];
  suggestionMatches: { [key: string]: 'match' | 'no_match' | 'not_clear' };
}

const PlatformAnnotationPage: React.FC = () => {
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0);
  const [currentCluster, setCurrentCluster] = useState<Cluster | null>(null);
  const [currentROIs, setCurrentROIs] = useState<ROI[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [currentAudioIndex, setCurrentAudioIndex] = useState(0);
  const [audioProgress, setAudioProgress] = useState(0);
  const [selectedROI, setSelectedROI] = useState<ROI | null>(null);
  
  // Annotation form state
  const [annotation, setAnnotation] = useState<Annotation>({
    species: '',
    soundType: '',
    confidence: 0.5,
    notes: '',
    backgroundTags: [],
    suggestionMatches: {}
  });

  // Background tag options
  const backgroundTagOptions = [
    'Traffic', 'Human', 'Siren', 'Insects', 'Wind', 'Rain', 'Machinery', 'Construction'
  ];

  // Species options
  const speciesOptions = [
    'American Robin', 'Northern Cardinal', 'Blue Jay', 'American Crow',
    'House Sparrow', 'European Starling', 'American Goldfinch', 'Red-winged Blackbird',
    'Common Grackle', 'Mourning Dove', 'Rock Pigeon', 'Other Bird',
    'Frog', 'Bat', 'Mammal', 'Car', 'Plane', 'Human', 'Unknown'
  ];

  // Sound type options
  const soundTypeOptions = [
    'Song', 'Call', 'Alarm', 'Flight', 'Movement', 'Engine', 'Voice', 'Other'
  ];

  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    loadClusters();
  }, []);

  useEffect(() => {
    if (clusters.length > 0) {
      loadClusterDetails(clusters[currentClusterIndex].id);
    }
  }, [clusters, currentClusterIndex]);

  const loadClusters = async () => {
    try {
      setLoading(true);
      // This would be replaced with actual API call to get clusters
      const mockClusters: Cluster[] = [
        {
          id: 1,
          label: 'Cluster_001',
          recording_id: 1,
          recording_name: 'Recording_001.flac',
          duration_seconds: 120,
          recording_s3_key: 'recordings/recording_001.flac',
          created_at: new Date().toISOString()
        }
      ];
      setClusters(mockClusters);
    } catch (error) {
      console.error('Error loading clusters:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClusterDetails = async (clusterId: number) => {
    try {
      // Load cluster details and ROIs
      const response = await fetch(`/api/annotation/cluster/${clusterId}`);
      const data = await response.json();
      
      if (data.success) {
        setCurrentCluster(data.cluster);
        setCurrentROIs(data.rois);
        
        // Load suggestions
        const suggestionsResponse = await fetch(`/api/annotation/suggestions/${clusterId}`);
        const suggestionsData = await suggestionsResponse.json();
        
        if (suggestionsData.success) {
          setSuggestions(suggestionsData.suggestions);
          // Initialize suggestion matches
          const initialMatches: { [key: string]: 'match' | 'no_match' | 'not_clear' } = {};
          suggestionsData.suggestions.forEach((suggestion: Suggestion) => {
            initialMatches[suggestion.label] = 'not_clear';
          });
          setAnnotation(prev => ({ ...prev, suggestionMatches: initialMatches }));
        }
      }
    } catch (error) {
      console.error('Error loading cluster details:', error);
    }
  };

  const handleSuggestionMatch = (suggestionLabel: string, match: 'match' | 'no_match' | 'not_clear') => {
    setAnnotation(prev => ({
      ...prev,
      suggestionMatches: {
        ...prev.suggestionMatches,
        [suggestionLabel]: match
      }
    }));
  };

  const handleSpeciesChange = (value: string) => {
    setAnnotation(prev => ({ ...prev, species: value }));
  };

  const handleSoundTypeChange = (value: string) => {
    setAnnotation(prev => ({ ...prev, soundType: value }));
  };

  const handleConfidenceChange = (value: string) => {
    setAnnotation(prev => ({ ...prev, confidence: parseFloat(value) }));
  };

  const handleBackgroundTagToggle = (tag: string) => {
    setAnnotation(prev => ({
      ...prev,
      backgroundTags: prev.backgroundTags.includes(tag)
        ? prev.backgroundTags.filter(t => t !== tag)
        : [...prev.backgroundTags, tag]
    }));
  };

  const handleROISelect = (roi: ROI) => {
    setSelectedROI(roi);
    setCurrentAudioIndex(currentROIs.findIndex(r => r.roi_id === roi.roi_id));
  };

  const handleAudioPlay = () => {
    if (audioRef.current) {
      if (audioPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setAudioPlaying(!audioPlaying);
    }
  };

  const handleSubmit = async () => {
    if (!currentCluster || !annotation.species) {
      alert('Please select a species and fill required fields');
      return;
    }

    try {
      setSubmitting(true);
      
      const response = await fetch('/api/annotation/platform/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clusterId: currentCluster.id,
          annotation,
          suggestions: annotation.suggestionMatches,
          annotatorId: 'platform_user_' + Date.now()
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Move to next cluster
        if (currentClusterIndex < clusters.length - 1) {
          setCurrentClusterIndex(prev => prev + 1);
          // Reset form
          setAnnotation({
            species: '',
            soundType: '',
            confidence: 0.5,
            notes: '',
            backgroundTags: [],
            suggestionMatches: {}
          });
          setSelectedROI(null);
        } else {
          // All clusters annotated
          alert('Congratulations! You have annotated all clusters.');
          loadClusters(); // Reload for new ones
        }
      } else {
        alert('Failed to submit annotation: ' + data.error);
      }
    } catch (error) {
      console.error('Error submitting annotation:', error);
      alert('Error submitting annotation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Loading annotation interface...</p>
        </div>
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">No Clusters Available</h2>
          <p className="text-gray-600 mb-4">No clusters are currently available for annotation.</p>
          <Button onClick={loadClusters}>Refresh</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Platform Annotation Interface</h1>
          <Badge variant="outline">
            {currentClusterIndex + 1} of {clusters.length}
          </Badge>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentClusterIndex + 1) / clusters.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Main Annotation Interface */}
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Side - Main Clip */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Cluster #{currentCluster?.label}</span>
                <Badge variant="secondary">{currentROIs.length} ROIs</Badge>
              </CardTitle>
              <p className="text-sm text-gray-600">
                Recording: {currentCluster?.recording_name} 
                ({Math.round(currentCluster?.duration_seconds || 0)}s)
              </p>
            </CardHeader>
            <CardContent>
              {/* Spectrogram Placeholder */}
              <div className="bg-gray-100 rounded-lg p-4 mb-4 h-48 flex items-center justify-center">
                <div className="text-center text-gray-500">
                  <Eye className="w-8 h-8 mx-auto mb-2" />
                  <p>Spectrogram View</p>
                  <p className="text-sm">Large, scrollable spectrogram will be displayed here</p>
                </div>
              </div>

              {/* Audio Player */}
              <div className="bg-gray-100 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-center space-x-4 mb-4">
                  <Button variant="outline" size="sm">
                    <SkipBack className="w-4 h-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="lg"
                    onClick={handleAudioPlay}
                  >
                    {audioPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                  </Button>
                  <Button variant="outline" size="sm">
                    <SkipForward className="w-4 h-4" />
                  </Button>
                </div>
                
                {/* Audio Progress Bar */}
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${audioProgress}%` }}
                  />
                </div>
                
                <div className="flex items-center justify-between mt-2 text-sm text-gray-600">
                  <span>0:00</span>
                  <span>{Math.round(currentCluster?.duration_seconds || 0)}s</span>
                </div>
              </div>

              {/* ROI Selection */}
              <div className="mb-4">
                <Label className="text-sm font-medium mb-2 block">Select ROI for Annotation</Label>
                <div className="grid grid-cols-2 gap-2">
                  {currentROIs.map((roi, index) => (
                    <Button
                      key={roi.roi_id}
                      variant={selectedROI?.roi_id === roi.roi_id ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleROISelect(roi)}
                      className="justify-start"
                    >
                      <span className="truncate">
                        ROI {index + 1}: {Math.round(roi.start_ms / 1000)}s - {Math.round(roi.end_ms / 1000)}s
                      </span>
                    </Button>
                  ))}
                </div>
              </div>

              {/* Audio Element */}
              <audio
                ref={audioRef}
                src={selectedROI ? `https://chatak-audio-recordings.s3.us-east-1.amazonaws.com/${selectedROI.roi_s3_key}` : undefined}
                onTimeUpdate={(e) => {
                  const audio = e.target as HTMLAudioElement;
                  if (audio.duration) {
                    setAudioProgress((audio.currentTime / audio.duration) * 100);
                  }
                }}
                onEnded={() => setAudioPlaying(false)}
                style={{ display: 'none' }}
              />
            </CardContent>
          </Card>

          {/* Right Side - Suggestions and Annotation */}
          <div className="space-y-6">
            {/* Suggestions */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <HelpCircle className="w-5 h-5" />
                  AI Suggestions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {suggestions.map((suggestion, index) => (
                    <div key={index} className="border rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h4 className="font-medium">{suggestion.label}</h4>
                          <p className="text-sm text-gray-600">{suggestion.scientific_name}</p>
                          <Badge variant="outline" className="mt-1">
                            {suggestion.type} • {(suggestion.confidence * 100).toFixed(0)}%
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Suggestion Audio Placeholder */}
                      <div className="bg-gray-50 rounded p-3 mb-3">
                        <div className="flex items-center justify-center space-x-2">
                          <Button variant="outline" size="sm">
                            <Play className="w-3 h-3" />
                          </Button>
                          <span className="text-sm text-gray-600">Sample Audio</span>
                        </div>
                      </div>
                      
                      {/* Match Buttons */}
                      <div className="flex space-x-2">
                        <Button
                          size="sm"
                          variant={annotation.suggestionMatches[suggestion.label] === 'match' ? 'default' : 'outline'}
                          onClick={() => handleSuggestionMatch(suggestion.label, 'match')}
                          className="flex-1"
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Match
                        </Button>
                        <Button
                          size="sm"
                          variant={annotation.suggestionMatches[suggestion.label] === 'no_match' ? 'default' : 'outline'}
                          onClick={() => handleSuggestionMatch(suggestion.label, 'no_match')}
                          className="flex-1"
                        >
                          <X className="w-4 h-4 mr-1" />
                          No Match
                        </Button>
                        <Button
                          size="sm"
                          variant={annotation.suggestionMatches[suggestion.label] === 'not_clear' ? 'default' : 'outline'}
                          onClick={() => handleSuggestionMatch(suggestion.label, 'not_clear')}
                          className="flex-1"
                        >
                          <HelpCircle className="w-4 h-4 mr-1" />
                          Not Clear
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Annotation Form */}
            <Card>
              <CardHeader>
                <CardTitle>Annotation Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Species Selection */}
                  <div>
                    <Label htmlFor="species" className="text-sm font-medium">
                      Species/Sound Source *
                    </Label>
                    <Select value={annotation.species} onValueChange={handleSpeciesChange}>
                      <SelectTrigger className="mt-2">
                        <SelectValue placeholder="Select species or sound source" />
                      </SelectTrigger>
                      <SelectContent>
                        {speciesOptions.map(species => (
                          <SelectItem key={species} value={species}>
                            {species}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Sound Type */}
                  <div>
                    <Label htmlFor="soundType" className="text-sm font-medium">
                      Sound Type
                    </Label>
                    <Select value={annotation.soundType} onValueChange={handleSoundTypeChange}>
                      <SelectTrigger className="mt-2">
                        <SelectValue placeholder="Select sound type" />
                      </SelectTrigger>
                      <SelectContent>
                        {soundTypeOptions.map(type => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Confidence */}
                  <div>
                    <Label htmlFor="confidence" className="text-sm font-medium">
                      Confidence Level
                    </Label>
                    <Select value={annotation.confidence.toString()} onValueChange={handleConfidenceChange}>
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.1">Very Low (10%)</SelectItem>
                        <SelectItem value="0.3">Low (30%)</SelectItem>
                        <SelectItem value="0.5">Medium (50%)</SelectItem>
                        <SelectItem value="0.7">High (70%)</SelectItem>
                        <SelectItem value="0.9">Very High (90%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Background Tags */}
                  <div>
                    <Label className="text-sm font-medium mb-2 block">
                      Background Sounds (Optional)
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {backgroundTagOptions.map(tag => (
                        <div key={tag} className="flex items-center space-x-2">
                          <Checkbox
                            id={tag}
                            checked={annotation.backgroundTags.includes(tag)}
                            onCheckedChange={() => handleBackgroundTagToggle(tag)}
                          />
                          <Label htmlFor={tag} className="text-sm">{tag}</Label>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <Label htmlFor="notes" className="text-sm font-medium">
                      Additional Notes (Optional)
                    </Label>
                    <Textarea
                      id="notes"
                      placeholder="Any additional observations or details..."
                      value={annotation.notes}
                      onChange={(e) => setAnnotation(prev => ({ ...prev, notes: e.target.value }))}
                      className="mt-2"
                      rows={3}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between mt-6">
          <Button
            variant="outline"
            onClick={() => setCurrentClusterIndex(prev => Math.max(0, prev - 1))}
            disabled={currentClusterIndex === 0}
            className="flex items-center space-x-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Previous Cluster
          </Button>

          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={() => setCurrentClusterIndex(prev => Math.min(clusters.length - 1, prev + 1))}
              disabled={currentClusterIndex === clusters.length - 1}
            >
              Skip Cluster
            </Button>
            
            <Button
              onClick={handleSubmit}
              disabled={submitting || !annotation.species}
              className="flex items-center space-x-2"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle className="w-4 h-4" />
              )}
              Submit & Continue
            </Button>
          </div>

          <Button
            variant="outline"
            onClick={() => setCurrentClusterIndex(prev => Math.min(clusters.length - 1, prev + 1))}
            disabled={currentClusterIndex === clusters.length - 1}
            className="flex items-center space-x-2"
          >
            Next Cluster
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PlatformAnnotationPage;


