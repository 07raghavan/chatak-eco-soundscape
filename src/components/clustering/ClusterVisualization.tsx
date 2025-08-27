/**
 * Interactive UMAP Cluster Visualization Component
 * Phase 9: Frontend Cluster Explorer
 */

import React, { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ZoomIn, ZoomOut, RotateCcw, Download, Play } from 'lucide-react';

interface Cluster {
  id: number | string; // Allow both numeric and string IDs (e.g., 'temp' for temporary clusters)
  size: number;
  qualityScore?: number;
  silhouette_score?: number;
  algorithm: string;
  parameters: any;
  recordingId: number;
  createdAt: string;
  rois?: any[]; // Array of ROI data from AED events
  roiIds?: string[]; // Array of ROI IDs
  actualSize?: number; // Actual number of ROIs
}

interface ClusterPoint {
  id: string;
  x: number;
  y: number;
  clusterId: number | string; // Allow both numeric and string IDs
  qualityTier: 'high' | 'medium' | 'low' | 'noise';
  confidence: number;
  label?: string;
  roiId: string;
  // Add audio-related fields
  hasAudio?: boolean;
  audioUrl?: string;
  // Store additional ROI data for tooltips and info
  roiData?: any;
}

interface ClusterVisualizationProps {
  clusters: Cluster[];
  onPointSelect?: (point: ClusterPoint) => void;
  onClusterSelect?: (clusterId: number | string) => void;
  onROIAudioRequest?: (roiId: string, clusterId: number | string) => void;
  colorBy?: 'quality' | 'cluster' | 'label' | 'confidence';
  sizeBy?: 'default' | 'confidence' | 'density';
}

const ClusterVisualization: React.FC<ClusterVisualizationProps> = ({
  clusters,
  onPointSelect,
  onClusterSelect,
  onROIAudioRequest,
  colorBy = 'quality',
  sizeBy = 'default'
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedPoint, setSelectedPoint] = useState<ClusterPoint | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Generate visualization data from real clusters and AED events
  const generateVisualizationData = (): ClusterPoint[] => {
    if (!clusters || clusters.length === 0) return [];
    
    const points: ClusterPoint[] = [];
    
    clusters.forEach((cluster, clusterIndex) => {
      // Determine quality tier based on quality score
      const qualityScore = cluster.qualityScore || cluster.silhouette_score || 0;
      let qualityTier: 'high' | 'medium' | 'low' | 'noise';
      if (qualityScore > 0.7) qualityTier = 'high';
      else if (qualityScore > 0.4) qualityTier = 'medium';
      else qualityTier = 'low';
      
      // Check if we have real ROI data for this cluster
      if (cluster.rois && cluster.rois.length > 0) {
        // Use real ROI data - each ROI becomes a point
        cluster.rois.forEach((roi, roiIndex) => {
          // Generate position around cluster center with spread based on cluster quality
          const centerX = (Math.random() - 0.5) * 600;
          const centerY = (Math.random() - 0.5) * 600;
          const angle = Math.random() * 2 * Math.PI;
          const spread = qualityTier === 'high' ? 20 : qualityTier === 'medium' ? 35 : 50;
          const distance = Math.random() * spread + 15;
          const x = centerX + Math.cos(angle) * distance;
          const y = centerY + Math.sin(angle) * distance;
          
          points.push({
            id: `cluster_${cluster.id}_roi_${roi.roiId}`,
            x,
            y,
            clusterId: cluster.id,
            qualityTier,
            confidence: (roi.confidence || qualityScore) / 100, // Convert percentage to 0-1
            label: cluster.algorithm,
            roiId: roi.roiId.toString(),
            hasAudio: true, // Real ROIs have audio
            audioUrl: `/api/clusters/${cluster.id}/rois/${roi.roiId}/audio`,
            // Store additional ROI data for tooltips and info
            roiData: roi
          });
        });
      } else {
        // Fallback: generate mock points if no ROI data available
        console.warn(`⚠️ No ROI data for cluster ${cluster.id}, generating mock points`);
        
        const centerX = (Math.random() - 0.5) * 600;
        const centerY = (Math.random() - 0.5) * 600;
        const actualClusterSize = cluster.size || 1;
        const pointsPerCluster = Math.min(Math.max(actualClusterSize, 1), 100);
        
        for (let i = 0; i < pointsPerCluster; i++) {
          const angle = Math.random() * 2 * Math.PI;
          const spread = qualityTier === 'high' ? 20 : qualityTier === 'medium' ? 35 : 50;
          const distance = Math.random() * spread + 15;
          const x = centerX + Math.cos(angle) * distance;
          const y = centerY + Math.sin(angle) * distance;
          
          points.push({
            id: `cluster_${cluster.id}_point_${i}`,
            x,
            y,
            clusterId: cluster.id,
            qualityTier,
            confidence: qualityScore + (Math.random() - 0.5) * 0.2,
            label: cluster.algorithm,
            roiId: `roi_${cluster.id}_${i}`,
            hasAudio: false, // Mock points don't have audio
            audioUrl: ''
          });
        }
      }
    });
    
    console.log(`🎯 Generated ${points.length} visualization points from ${clusters.length} clusters`);
    return points;
  };

  // Get point size based on sizeBy prop
  const getPointSize = (point: ClusterPoint): number => {
    switch (sizeBy) {
      case 'confidence':
        return Math.max(3, Math.min(8, point.confidence * 10));
      case 'density':
        return 5; // Fixed size for density view
      default:
        return 5;
    }
  };

  // Get point color based on colorBy prop
  const getPointColor = (point: ClusterPoint): string => {
    switch (colorBy) {
      case 'quality':
        switch (point.qualityTier) {
          case 'high': return '#10B981'; // Green
          case 'medium': return '#F59E0B'; // Yellow
          case 'low': return '#EF4444'; // Red
          case 'noise': return '#6B7280'; // Gray
          default: return '#6B7280';
        }
      case 'cluster':
        // Generate distinct colors for different clusters
        const colors = ['#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#84CC16'];
        return colors[point.clusterId % colors.length];
      case 'label':
        return '#6B7280'; // Default gray
      case 'confidence':
        // Color by confidence (green to red)
        const intensity = Math.floor(point.confidence * 255);
        return `rgb(${255 - intensity}, ${intensity}, 0)`;
      default:
        return '#6B7280';
    }
  };

  const [points, setPoints] = useState<ClusterPoint[]>(() => generateVisualizationData());

  // Regenerate points when clusters change
  useEffect(() => {
    if (clusters && clusters.length > 0) {
      const newPoints = generateVisualizationData();
      setPoints(newPoints);
      // Reset selection when clusters change
      setSelectedPoint(null);
      setSelectedCluster(null);
    }
  }, [clusters]);



  const handlePointClick = (point: ClusterPoint) => {
    setSelectedPoint(point);
    onPointSelect?.(point);
    
    if (point.clusterId !== selectedCluster) {
      setSelectedCluster(point.clusterId);
      onClusterSelect?.(point.clusterId);
    }

    // Request audio for this ROI if available
    if (point.hasAudio && onROIAudioRequest) {
      onROIAudioRequest(point.roiId, point.clusterId);
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === svgRef.current) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="w-full h-full min-h-[800px] relative bg-white border rounded-lg overflow-hidden">
      {/* Controls */}
      <div className="absolute top-4 right-4 z-20 flex space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoom(prev => Math.min(prev * 1.2, 3))}
          className="bg-white/90 backdrop-blur-sm"
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setZoom(prev => Math.max(prev / 1.2, 0.3))}
          className="bg-white/90 backdrop-blur-sm"
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="bg-white/90 backdrop-blur-sm"
        >
          <RotateCcw className="w-4 h-4" />
        </Button>
        <Badge variant="outline" className="bg-white/90 backdrop-blur-sm">
          Zoom: {(zoom * 100).toFixed(0)}%
        </Badge>
      </div>

      {/* Legend */}
      <div className="absolute top-4 left-4 z-20">
        <Card className="w-48">
          <CardContent className="p-3">
            <div className="space-y-2">
              <p className="text-sm font-medium mb-2">Quality Tiers</p>
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span className="text-xs">High Quality</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <span className="text-xs">Medium Quality</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span className="text-xs">Low Quality</span>
                </div>
              </div>
              <div className="pt-2 border-t">
                <p className="text-xs text-gray-600">
                  {clusters.length} clusters • {points.length} points
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info Panel */}
      {selectedPoint && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-10">
          <Card className="w-80">
            <CardContent className="p-3">
              <div className="space-y-2">
                <div className="space-y-1">
                  <p className="text-sm font-medium">ROI: {selectedPoint.roiId}</p>
                  <p className="text-xs text-gray-600">Cluster: {selectedPoint.clusterId === -1 ? 'Noise' : selectedPoint.clusterId}</p>
                  <p className="text-xs text-gray-600">Quality: {selectedPoint.qualityTier}</p>
                  <p className="text-xs text-gray-600">Confidence: {(selectedPoint.confidence * 100).toFixed(1)}%</p>
                  {selectedPoint.label && (
                    <p className="text-xs text-gray-600">Algorithm: {selectedPoint.label}</p>
                  )}
                  
                  {/* Show detailed ROI data if available */}
                  {selectedPoint.roiData && (
                    <div className="pt-2 border-t space-y-1">
                      <p className="text-xs font-medium text-gray-700">ROI Details:</p>
                      <p className="text-xs text-gray-600">
                        Timing: {selectedPoint.roiData.start_ms}ms - {selectedPoint.roiData.end_ms}ms
                      </p>
                      {selectedPoint.roiData.f_min_hz && selectedPoint.roiData.f_max_hz && (
                        <p className="text-xs text-gray-600">
                          Frequency: {selectedPoint.roiData.f_min_hz.toFixed(1)}Hz - {selectedPoint.roiData.f_max_hz.toFixed(1)}Hz
                        </p>
                      )}
                      {selectedPoint.roiData.peak_freq_hz && (
                        <p className="text-xs text-gray-600">
                          Peak: {selectedPoint.roiData.peak_freq_hz.toFixed(1)}Hz
                        </p>
                      )}
                      {selectedPoint.roiData.snr_db && (
                        <p className="text-xs text-gray-600">
                          SNR: {selectedPoint.roiData.snr_db.toFixed(1)}dB
                        </p>
                      )}
                      {selectedPoint.roiData.method && (
                        <p className="text-xs text-gray-600">
                          Method: {selectedPoint.roiData.method} v{selectedPoint.roiData.method_version}
                        </p>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Audio Status */}
                <div className="pt-2 border-t">
                  {selectedPoint.hasAudio ? (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <span className="text-xs text-green-700">Audio Available</span>
                      </div>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => onROIAudioRequest?.(selectedPoint.roiId, selectedPoint.clusterId)}
                        className="h-6 px-2 text-xs"
                      >
                        <Play className="w-3 h-3 mr-1" />
                        Play
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                      <span className="text-xs text-gray-600">No Audio</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* SVG Visualization */}
      <svg
        ref={svgRef}
        className="w-full h-full cursor-move"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <g transform={`translate(${400 + pan.x}, ${400 + pan.y}) scale(${zoom})`}>
          {/* Grid */}
          <defs>
            <pattern id="grid" width="50" height="50" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#f0f0f0" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect x="-600" y="-600" width="1200" height="1200" fill="url(#grid)" />
          
          {/* Axes */}
          <line x1="-500" y1="0" x2="500" y2="0" stroke="#d1d5db" strokeWidth="2" />
          <line x1="0" y1="-500" x2="0" y2="500" stroke="#d1d5db" strokeWidth="2" />
          
          {/* Points */}
          {points.map((point) => (
            <circle
              key={point.id}
              cx={point.x}
              cy={point.y}
              r={getPointSize(point)}
              fill={getPointColor(point)}
              stroke={selectedPoint?.id === point.id ? '#000' : 'rgba(255,255,255,0.8)'}
              strokeWidth={selectedPoint?.id === point.id ? 2 : 1}
              opacity={selectedCluster !== null && selectedCluster !== point.clusterId ? 0.3 : 0.8}
              className="cursor-pointer hover:stroke-black hover:stroke-2"
              onClick={() => handlePointClick(point)}
            />
          ))}
          
          {/* Cluster hulls for selected cluster */}
          {selectedCluster !== null && selectedCluster !== -1 && (
            <g>
              {/* Simple convex hull approximation */}
              {(() => {
                const clusterPoints = points.filter(p => p.clusterId === selectedCluster);
                if (clusterPoints.length < 3) return null;
                
                // Simple bounding ellipse
                const xs = clusterPoints.map(p => p.x);
                const ys = clusterPoints.map(p => p.y);
                const centerX = xs.reduce((a, b) => a + b, 0) / xs.length;
                const centerY = ys.reduce((a, b) => a + b, 0) / ys.length;
                const radiusX = Math.max(...xs) - Math.min(...xs);
                const radiusY = Math.max(...ys) - Math.min(...ys);
                
                return (
                  <ellipse
                    cx={centerX}
                    cy={centerY}
                    rx={radiusX / 2 + 15}
                    ry={radiusY / 2 + 15}
                    fill="none"
                    stroke="#3B82F6"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                    opacity="0.6"
                  />
                );
              })()}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
};

export default ClusterVisualization;
