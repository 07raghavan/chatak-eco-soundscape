/**
 * ROI Inspector Component
 * Phase 9: Frontend Cluster Explorer
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Play, 
  Pause, 
  Volume2, 
  VolumeX, 
  Download,
  Tag,
  Eye,
  BarChart3,
  Activity,
  Clock,
  MapPin
} from 'lucide-react';

interface ROIData {
  id: string;
  clusterId: number;
  filename: string;
  startTime: number;
  duration: number;
  confidence: number;
  qualityTier: 'high' | 'medium' | 'low';
  labels: { name: string; confidence: number; source: 'human' | 'propagated' | 'model' }[];
  features: {
    spectralCentroid: number;
    spectralBandwidth: number;
    mfcc: number[];
    snr: number;
  };
  coordinates: { x: number; y: number };
}

interface ROIInspectorProps {
  selectedROI?: string;
}

const ROIInspector: React.FC<ROIInspectorProps> = ({ selectedROI }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackPosition, setPlaybackPosition] = useState(0);

  // Mock ROI data
  const generateROIData = (roiId: string): ROIData => {
    const qualityTiers: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
    const qualityTier = qualityTiers[Math.floor(Math.random() * qualityTiers.length)];

    return {
      id: roiId,
      clusterId: Math.floor(Math.random() * 10),
      filename: `recording_${Math.floor(Math.random() * 100)}.wav`,
      startTime: Math.random() * 3600, // seconds
      duration: Math.random() * 5 + 0.5, // 0.5-5.5 seconds
      confidence: Math.random(),
      qualityTier,
      labels: [
        { name: 'bird_song', confidence: 0.85, source: 'human' },
        { name: 'dawn_chorus', confidence: 0.72, source: 'propagated' }
      ],
      features: {
        spectralCentroid: Math.random() * 4000 + 1000,
        spectralBandwidth: Math.random() * 2000 + 500,
        mfcc: Array.from({length: 13}, () => Math.random() * 2 - 1),
        snr: Math.random() * 30 + 5
      },
      coordinates: { x: Math.random() * 400 - 200, y: Math.random() * 400 - 200 }
    };
  };

  const roiData = selectedROI ? generateROIData(selectedROI) : null;

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getQualityColor = (tier: string) => {
    switch (tier) {
      case 'high': return 'bg-green-100 text-green-800 border-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getLabelSourceColor = (source: string) => {
    switch (source) {
      case 'human': return 'bg-blue-100 text-blue-800';
      case 'propagated': return 'bg-purple-100 text-purple-800';
      case 'model': return 'bg-orange-100 text-orange-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const togglePlayback = () => {
    setIsPlaying(!isPlaying);
    // In a real implementation, this would control audio playback
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  if (!roiData) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <div className="text-center">
          <Eye className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Select an ROI to inspect</p>
          <p className="text-sm mt-2">Click on points in the visualization</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ROI Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold truncate">{roiData.id}</h3>
          <Badge className={getQualityColor(roiData.qualityTier)}>
            {roiData.qualityTier.toUpperCase()}
          </Badge>
        </div>
        <p className="text-sm text-gray-600 truncate">{roiData.filename}</p>
      </div>

      {/* Audio Controls */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center">
            <Volume2 className="w-4 h-4 mr-2" />
            Audio Playback
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Waveform Placeholder */}
          <div className="h-16 bg-gradient-to-r from-blue-100 to-blue-200 rounded flex items-center justify-center">
            <Activity className="w-8 h-8 text-blue-600 opacity-50" />
          </div>
          
          {/* Playback Controls */}
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={togglePlayback}>
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </Button>
            <Button variant="outline" size="sm" onClick={toggleMute}>
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </Button>
            <div className="flex-1">
              <Progress value={playbackPosition} className="h-2" />
            </div>
            <Button variant="outline" size="sm">
              <Download className="w-4 h-4" />
            </Button>
          </div>
          
          {/* Time Info */}
          <div className="flex justify-between text-xs text-gray-600">
            <span>{formatTime(playbackPosition * roiData.duration / 100)}</span>
            <span>{formatTime(roiData.duration)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center">
            <Clock className="w-4 h-4 mr-2" />
            Metadata
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-gray-600">Start Time:</span>
              <p className="font-medium">{formatTime(roiData.startTime)}</p>
            </div>
            <div>
              <span className="text-gray-600">Duration:</span>
              <p className="font-medium">{roiData.duration.toFixed(2)}s</p>
            </div>
            <div>
              <span className="text-gray-600">Cluster:</span>
              <p className="font-medium">{roiData.clusterId}</p>
            </div>
            <div>
              <span className="text-gray-600">Confidence:</span>
              <p className="font-medium">{(roiData.confidence * 100).toFixed(1)}%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Labels */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center">
            <Tag className="w-4 h-4 mr-2" />
            Labels
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {roiData.labels.map((label, index) => (
            <div key={index} className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Badge variant="outline" className={getLabelSourceColor(label.source)}>
                  {label.source}
                </Badge>
                <span className="text-sm">{label.name}</span>
              </div>
              <span className="text-sm font-medium">{(label.confidence * 100).toFixed(0)}%</span>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-full mt-2">
            <Tag className="w-3 h-3 mr-2" />
            Add Label
          </Button>
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center">
            <BarChart3 className="w-4 h-4 mr-2" />
            Features
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Spectral Centroid:</span>
              <span className="font-medium">{roiData.features.spectralCentroid.toFixed(0)} Hz</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Bandwidth:</span>
              <span className="font-medium">{roiData.features.spectralBandwidth.toFixed(0)} Hz</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">SNR:</span>
              <span className="font-medium">{roiData.features.snr.toFixed(1)} dB</span>
            </div>
          </div>
          
          {/* MFCC Visualization */}
          <div className="mt-3">
            <p className="text-xs text-gray-600 mb-2">MFCC Coefficients</p>
            <div className="grid grid-cols-13 gap-1">
              {roiData.features.mfcc.map((coeff, index) => (
                <div
                  key={index}
                  className="h-8 bg-blue-200 rounded-sm flex items-end"
                  title={`MFCC ${index + 1}: ${coeff.toFixed(3)}`}
                >
                  <div
                    className="w-full bg-blue-500 rounded-sm"
                    style={{ height: `${Math.abs(coeff) * 100}%` }}
                  />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Position */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center">
            <MapPin className="w-4 h-4 mr-2" />
            UMAP Position
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-gray-600">X:</span>
              <p className="font-medium">{roiData.coordinates.x.toFixed(2)}</p>
            </div>
            <div>
              <span className="text-gray-600">Y:</span>
              <p className="font-medium">{roiData.coordinates.y.toFixed(2)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ROIInspector;
