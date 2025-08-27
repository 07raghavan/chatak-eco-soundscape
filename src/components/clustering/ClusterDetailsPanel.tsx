/**
 * Cluster Details Panel Component
 * Phase 9: Frontend Cluster Explorer
 */

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Users, 
  Target, 
  BarChart3, 
  Play, 
  Tag, 
  Download,
  Eye,
  Zap,
  TrendingUp,
  AlertCircle
} from 'lucide-react';

interface ClusterInfo {
  id: number | string;
  size: number;
  qualityTier: 'high' | 'medium' | 'low';
  qualityScore: number;
  cohesionScore: number;
  separationScore: number;
  densityScore: number;
  isEligibleForPropagation: boolean;
  exemplarROIs: string[];
  labels: { name: string; confidence: number; count: number }[];
  centroid: number[];
}

interface ClusterDetailsPanelProps {
  selectedCluster?: number | string;
}

const ClusterDetailsPanel: React.FC<ClusterDetailsPanelProps> = ({ selectedCluster }) => {
  const [activeTab, setActiveTab] = useState('overview');

  // Mock cluster data
  const generateClusterInfo = (clusterId: number | string): ClusterInfo => {
    const qualityTiers: ('high' | 'medium' | 'low')[] = ['high', 'medium', 'low'];
    const qualityTier = qualityTiers[Math.floor(Math.random() * qualityTiers.length)];
    const qualityScore = qualityTier === 'high' ? 0.8 + Math.random() * 0.2 : 
                       qualityTier === 'medium' ? 0.5 + Math.random() * 0.3 : 
                       Math.random() * 0.5;

    return {
      id: clusterId,
      size: Math.floor(Math.random() * 500) + 50,
      qualityTier,
      qualityScore,
      cohesionScore: Math.random(),
      separationScore: Math.random(),
      densityScore: Math.random(),
      isEligibleForPropagation: qualityScore > 0.6,
      exemplarROIs: Array.from({length: 5}, (_, i) => `roi_${clusterId}_${i + 1}`),
      labels: [
        { name: 'bird_song', confidence: 0.85, count: 45 },
        { name: 'insect_buzz', confidence: 0.72, count: 23 },
        { name: 'water_sound', confidence: 0.68, count: 12 }
      ],
      centroid: Array.from({length: 50}, () => Math.random() * 2 - 1)
    };
  };

  const clusterInfo = selectedCluster !== undefined && selectedCluster !== null ? 
    generateClusterInfo(selectedCluster) : null;

  if (!clusterInfo) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <div className="text-center">
          <Target className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Select a cluster to view details</p>
          <p className="text-sm mt-2">Click on points in the visualization</p>
        </div>
      </div>
    );
  }

  const getQualityColor = (tier: string) => {
    switch (tier) {
      case 'high': return 'bg-green-100 text-green-800 border-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="space-y-4">
      {/* Cluster Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Cluster {clusterInfo.id}</h3>
            <p className="text-sm text-gray-600">{clusterInfo.size} ROIs</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Badge className={getQualityColor(clusterInfo.qualityTier)}>
            {clusterInfo.qualityTier.toUpperCase()}
          </Badge>
          {clusterInfo.isEligibleForPropagation && (
            <Badge variant="outline" className="text-green-600 border-green-600">
              <Zap className="w-3 h-3 mr-1" />
              Propagation Ready
            </Badge>
          )}
        </div>
      </div>

      {/* Quality Metrics */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center">
            <BarChart3 className="w-4 h-4 mr-2" />
            Quality Metrics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Overall Quality</span>
              <span className="font-medium">{(clusterInfo.qualityScore * 100).toFixed(1)}%</span>
            </div>
            <Progress value={clusterInfo.qualityScore * 100} className="h-2" />
          </div>
          
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="text-center">
              <p className="text-gray-600">Cohesion</p>
              <p className="font-medium">{(clusterInfo.cohesionScore * 100).toFixed(0)}%</p>
            </div>
            <div className="text-center">
              <p className="text-gray-600">Separation</p>
              <p className="font-medium">{(clusterInfo.separationScore * 100).toFixed(0)}%</p>
            </div>
            <div className="text-center">
              <p className="text-gray-600">Density</p>
              <p className="font-medium">{(clusterInfo.densityScore * 100).toFixed(0)}%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="labels">Labels</TabsTrigger>
          <TabsTrigger value="exemplars">Exemplars</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <Users className="w-4 h-4 text-blue-600" />
                  <span className="text-sm font-medium">Size Distribution</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Total ROIs</span>
                    <span className="font-medium">{clusterInfo.size}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Labeled</span>
                    <span className="font-medium">{Math.floor(clusterInfo.size * 0.3)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Unlabeled</span>
                    <span className="font-medium">{Math.floor(clusterInfo.size * 0.7)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 mb-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium">Statistics</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Avg Confidence</span>
                    <span className="font-medium">{(Math.random() * 0.3 + 0.7).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Std Deviation</span>
                    <span className="font-medium">{(Math.random() * 0.2 + 0.1).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Outliers</span>
                    <span className="font-medium">{Math.floor(Math.random() * 5)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="flex space-x-2">
            <Button className="flex-1">
              <Play className="w-4 h-4 mr-2" />
              Start Propagation
            </Button>
            <Button variant="outline">
              <Eye className="w-4 h-4 mr-2" />
              Inspect ROIs
            </Button>
            <Button variant="outline">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="labels" className="space-y-4">
          <div className="space-y-3">
            {clusterInfo.labels.map((label, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <Tag className="w-4 h-4 text-gray-600" />
                  <div>
                    <p className="font-medium">{label.name}</p>
                    <p className="text-sm text-gray-600">{label.count} ROIs</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium">{(label.confidence * 100).toFixed(1)}%</p>
                  <Progress value={label.confidence * 100} className="w-16 h-1 mt-1" />
                </div>
              </div>
            ))}
          </div>
          
          <Button variant="outline" className="w-full">
            <Tag className="w-4 h-4 mr-2" />
            Add Manual Label
          </Button>
        </TabsContent>

        <TabsContent value="exemplars" className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {clusterInfo.exemplarROIs.map((roiId, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-blue-200 rounded flex items-center justify-center">
                    <span className="text-xs font-medium">{index + 1}</span>
                  </div>
                  <div>
                    <p className="font-medium">{roiId}</p>
                    <p className="text-sm text-gray-600">Representativeness: {(Math.random() * 0.3 + 0.7).toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  <Button variant="outline" size="sm">
                    <Eye className="w-3 h-3" />
                  </Button>
                  <Button variant="outline" size="sm">
                    <Play className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ClusterDetailsPanel;
