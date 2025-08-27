import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { 
  Play, Pause, SkipBack, SkipForward, 
  Volume2, VolumeX, CheckCircle, XCircle,
  ArrowLeft, ArrowRight, Loader2
} from 'lucide-react';

interface PendingCluster {
  cluster_id: number;
  cluster_label: string;
  recording_id: number;
  recording_name: string;
  duration_seconds: number;
  clip_count: number;
  created_at: string;
}

interface Annotation {
  species: string;
  soundType: string;
  confidence: number;
  notes: string;
  backgroundTags: string[];
}

const VolunteerAnnotationPage: React.FC = () => {
  const [pendingClusters, setPendingClusters] = useState<PendingCluster[]>([]);
  const [currentClusterIndex, setCurrentClusterIndex] = useState(0);
  const [currentCluster, setCurrentCluster] = useState<PendingCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  
  // Annotation form state
  const [annotation, setAnnotation] = useState<Annotation>({
    species: '',
    soundType: '',
    confidence: 0.5,
    notes: '',
    backgroundTags: []
  });

  // Background tag options
  const backgroundTagOptions = [
    'Traffic', 'Human', 'Siren', 'Insects', 'Wind', 'Rain', 'Machinery', 'Construction'
  ];

  // Species options
  const speciesOptions = [
    'Bird', 'Frog', 'Bat', 'Mammal', 'Car', 'Plane', 'Human', 'Unknown'
  ];

  // Sound type options
  const soundTypeOptions = [
    'Song', 'Call', 'Alarm', 'Flight', 'Movement', 'Engine', 'Voice', 'Other'
  ];

  useEffect(() => {
    loadPendingClusters();
  }, []);

  useEffect(() => {
    if (pendingClusters.length > 0) {
      setCurrentCluster(pendingClusters[currentClusterIndex]);
    }
  }, [pendingClusters, currentClusterIndex]);

  const loadPendingClusters = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/annotation/volunteer/pending');
      const data = await response.json();
      
      if (data.success) {
        setPendingClusters(data.pendingClusters);
      } else {
        console.error('Failed to load pending clusters:', data.error);
      }
    } catch (error) {
      console.error('Error loading pending clusters:', error);
    } finally {
      setLoading(false);
    }
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

  const handleSubmit = async () => {
    if (!currentCluster || !annotation.species) {
      alert('Please select a species and fill required fields');
      return;
    }

    try {
      setSubmitting(true);
      
      const response = await fetch('/api/annotation/volunteer/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          clusterId: currentCluster.cluster_id,
          annotation,
          annotatorId: 'volunteer_' + Date.now() // Simple ID generation
        }),
      });

      const data = await response.json();
      
      if (data.success) {
        // Move to next cluster
        if (currentClusterIndex < pendingClusters.length - 1) {
          setCurrentClusterIndex(prev => prev + 1);
          // Reset form
          setAnnotation({
            species: '',
            soundType: '',
            confidence: 0.5,
            notes: '',
            backgroundTags: []
          });
        } else {
          // All clusters annotated
          alert('Congratulations! You have annotated all pending clusters.');
          loadPendingClusters(); // Reload for new ones
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

  const handleSkip = () => {
    if (currentClusterIndex < pendingClusters.length - 1) {
      setCurrentClusterIndex(prev => prev + 1);
      setAnnotation({
        species: '',
        soundType: '',
        confidence: 0.5,
        notes: '',
        backgroundTags: []
      });
    }
  };

  const handlePrevious = () => {
    if (currentClusterIndex > 0) {
      setCurrentClusterIndex(prev => prev - 1);
      setAnnotation({
        species: '',
        soundType: '',
        confidence: 0.5,
        notes: '',
        backgroundTags: []
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p>Loading annotation tasks...</p>
        </div>
      </div>
    );
  }

  if (pendingClusters.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2">All Done!</h2>
          <p className="text-gray-600 mb-4">No pending annotation tasks at the moment.</p>
          <Button onClick={loadPendingClusters}>Check for New Tasks</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="max-w-4xl mx-auto mb-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold text-gray-900">Volunteer Annotation</h1>
          <Badge variant="outline">
            {currentClusterIndex + 1} of {pendingClusters.length}
          </Badge>
        </div>
        
        {/* Progress Bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${((currentClusterIndex + 1) / pendingClusters.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Main Annotation Interface */}
      <div className="max-w-4xl mx-auto">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Cluster #{currentCluster?.cluster_label}</span>
              <Badge variant="secondary">{currentCluster?.clip_count} clips</Badge>
            </CardTitle>
            <p className="text-sm text-gray-600">
              Recording: {currentCluster?.recording_name} 
              ({Math.round(currentCluster?.duration_seconds || 0)}s)
            </p>
          </CardHeader>
          <CardContent>
            {/* Audio Player Placeholder */}
            <div className="bg-gray-100 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-center space-x-4 mb-4">
                <Button variant="outline" size="sm">
                  <SkipBack className="w-4 h-4" />
                </Button>
                <Button 
                  variant="outline" 
                  size="lg"
                  onClick={() => setAudioPlaying(!audioPlaying)}
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

            {/* Annotation Form */}
            <div className="space-y-6">
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

        {/* Action Buttons */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handlePrevious}
            disabled={currentClusterIndex === 0}
            className="flex items-center space-x-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Previous
          </Button>

          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={handleSkip}
              disabled={currentClusterIndex === pendingClusters.length - 1}
            >
              Skip
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
            onClick={() => setCurrentClusterIndex(prev => prev + 1)}
            disabled={currentClusterIndex === pendingClusters.length - 1}
            className="flex items-center space-x-2"
          >
            Next
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VolunteerAnnotationPage;


