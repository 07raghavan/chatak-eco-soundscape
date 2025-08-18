import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { 
  Image, 
  Zap, 
  Download, 
  RefreshCw, 
  Settings, 
  Eye,
  Loader2,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { generateFastSpectrogram, getFastSpectrogram, API_BASE_URL } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

interface FastSpectrogramViewerProps {
  recordingId: number;
  recording: any;
  aedEvents?: any[];
  onEventClick?: (event: any) => void;
  className?: string;
  config?: {
    n_fft?: number;
    hop_length?: number;
    n_mels?: number;
    fmin?: number;
    fmax?: number;
    colormap?: string;
    width_inches?: number;
    height_inches?: number;
    dpi?: number;
    min_confidence?: number;
    include_bands?: string[];
  };
}

export const FastSpectrogramViewer: React.FC<FastSpectrogramViewerProps> = ({
  recordingId,
  recording,
  aedEvents = [],
  onEventClick,
  className = '',
  config = {}
}) => {
  const [spectrogram, setSpectrogram] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const { toast } = useToast();

  // Default configuration
  const defaultConfig = {
    colormap: 'viridis',
    width_inches: 16,
    height_inches: 8,
    dpi: 100,
    min_confidence: 0.15,
    include_bands: ['low_freq', 'mid_freq', 'high_freq'],
    n_fft: 2048,
    hop_length: 512,
    n_mels: 128,
    fmin: 0,
    fmax: null,
    power: 2.0,
    db_range: 80,
    ...config
  };

  // Load existing spectrogram on mount
  useEffect(() => {
    loadExistingSpectrogram();
  }, [recordingId]);

  const loadExistingSpectrogram = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getFastSpectrogram(recordingId);
      
      if (response.success && response.spectrogram) {
        setSpectrogram(response.spectrogram);
        console.log('✅ Loaded existing fast spectrogram');
      }
    } catch (err: any) {
      console.log('ℹ️ No existing spectrogram found:', err.message);
      // Don't set error - this is expected for new recordings
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSpectrogram = async (forceRegenerate = false) => {
    try {
      setGenerating(true);
      setProgress(0);
      setProgressMessage('Starting generation...');
      setError(null);

      console.log('🎨 Starting fast spectrogram generation...');

      const generationConfig = {
        ...defaultConfig,
        force_regenerate: forceRegenerate
      };

      const result = await generateFastSpectrogram(
        recordingId,
        generationConfig,
        (percent: number, message: string) => {
          setProgress(percent);
          setProgressMessage(message);
        }
      );

      if (result?.success) {
        setSpectrogram(result.spectrogram);
        
        toast({
          title: "🎨 Spectrogram Generated!",
          description: `Generated in ${(result.spectrogram.generation_time_ms / 1000).toFixed(1)}s with ${result.spectrogram.aed_events_count} AED events`,
        });
        
        console.log('✅ Fast spectrogram generated successfully');
      } else {
        throw new Error(result?.error || 'Unknown generation error');
      }
    } catch (err: any) {
      console.error('❌ Spectrogram generation failed:', err);
      setError(err.message);
      
      toast({
        title: "❌ Generation Failed",
        description: err.message,
        variant: "destructive"
      });
    } finally {
      setGenerating(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  const handleDownload = () => {
    if (spectrogram?.image_url) {
      const link = document.createElement('a');
      link.href = spectrogram.image_url;
      link.download = `recording_${recordingId}_spectrogram.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: "📥 Download Started",
        description: "Spectrogram image download initiated",
      });
    }
  };

  const formatGenerationTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Card className={`w-full ${className}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image className="w-5 h-5" />
            Fast Spectrogram with AED Events
            {spectrogram && (
              <Badge variant="outline" className="ml-2">
                {spectrogram.aed_events_count} events
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleGenerateSpectrogram(false)}
              disabled={generating || loading}
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              Generate
            </Button>
            
            {spectrogram && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleGenerateSpectrogram(true)}
                  disabled={generating || loading}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Regenerate
                </Button>
                
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownload}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
              </>
            )}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Progress Bar */}
        {generating && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>{progressMessage}</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="w-full" />
          </div>
        )}

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin mr-2" />
            <span>Loading existing spectrogram...</span>
          </div>
        )}

        {/* Spectrogram Display */}
        {spectrogram && spectrogram.image_url && !generating && !loading && (
          <div className="space-y-4">
            {/* Spectrogram Image with Enhanced Scrolling */}
            <div className="border rounded-lg bg-black">
              <div className="overflow-x-auto overflow-y-hidden max-h-[600px]" style={{ scrollbarWidth: 'thin' }}>
                <img
                  ref={imageRef}
                  src={spectrogram.image_url}
                  alt={`Spectrogram for ${recording?.name || 'Recording'}`}
                  className="block h-auto cursor-grab active:cursor-grabbing"
                  style={{ 
                    maxHeight: '600px', 
                    minWidth: 'max-content', 
                    width: 'auto',
                    imageRendering: 'crisp-edges'
                  }}
                  onError={(e) => {
                    console.error('Failed to load spectrogram image:', spectrogram.image_url);
                    setError(`Failed to load spectrogram image: ${spectrogram.image_url}`);
                  }}
                  onLoad={() => {
                    console.log('✅ Spectrogram image loaded successfully');
                    // Show toast with image dimensions for wide spectrograms
                    if (imageRef.current) {
                      const img = imageRef.current;
                      if (img.naturalWidth > 2000) {
                        toast({
                          title: "📏 Wide Spectrogram Loaded",
                          description: `Image: ${img.naturalWidth}×${img.naturalHeight}px. Use horizontal scroll to explore the full timeline.`,
                        });
                      }
                    }
                  }}
                  draggable={false}
                />
              </div>
              
              {/* Scroll indicator for wide images */}
              <div className="text-xs text-gray-500 text-center py-2 border-t bg-gray-50">
                💡 Tip: Scroll horizontally to explore the full spectrogram timeline
                {spectrogram?.config?.width_inches && (
                  <span className="ml-2">
                    (Width: {spectrogram.config.width_inches.toFixed(1)}")
                  </span>
                )}
              </div>
            </div>

            {/* Generation Info */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-gray-600">Status:</span>
                <Badge variant="outline" className="text-green-600">
                  {spectrogram.status || 'completed'}
                </Badge>
              </div>
              
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-blue-500" />
                <span className="text-gray-600">Events:</span>
                <span className="font-medium">{spectrogram.aed_events_count}</span>
              </div>
              
              {spectrogram.generation_time_ms && (
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  <span className="text-gray-600">Generated in:</span>
                  <span className="font-medium">
                    {formatGenerationTime(spectrogram.generation_time_ms)}
                  </span>
                </div>
              )}
              
              {spectrogram.file_size_bytes && (
                <div className="flex items-center gap-2">
                  <Image className="w-4 h-4 text-purple-500" />
                  <span className="text-gray-600">Size:</span>
                  <span className="font-medium">
                    {formatFileSize(spectrogram.file_size_bytes)}
                  </span>
                </div>
              )}
            </div>

            {/* AED ROI Legend with Enhanced Visibility Info */}
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-2">AED Event Boxes & Legend:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 mb-2">
                    AED detected events are marked as colored rectangles with confidence labels:
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-3 border-2 border-green-500 bg-green-500 bg-opacity-30 relative">
                        <div className="absolute inset-0 border-2 border-green-500"></div>
                      </div>
                      <span>High Confidence (≥80%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-3 border-2 border-orange-500 bg-orange-500 bg-opacity-30 relative">
                        <div className="absolute inset-0 border-2 border-orange-500"></div>
                      </div>
                      <span>Medium Confidence (60-80%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-3 border-2 border-red-500 bg-red-500 bg-opacity-30 relative">
                        <div className="absolute inset-0 border-2 border-red-500"></div>
                      </div>
                      <span>Low Confidence (30-60%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-3 border-2 border-cyan-500 bg-cyan-500 bg-opacity-30 relative">
                        <div className="absolute inset-0 border-2 border-cyan-500"></div>
                      </div>
                      <span>Unknown Confidence</span>
                    </div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <p className="text-xs text-gray-600 mb-2">
                    Features enhanced for better visibility:
                  </p>
                  <ul className="text-xs text-gray-600 space-y-1">
                    <li>• Filled rectangles with semi-transparent overlay</li>
                    <li>• Bold borders and confidence percentage labels</li>
                    <li>• Species/band name labels where available</li>
                    <li>• Dynamic width scaling based on audio duration</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* No Spectrogram State */}
        {!spectrogram && !generating && !loading && !error && (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <Image className="w-12 h-12 text-gray-400 mb-4" />
            <h3 className="text-lg font-medium mb-2">No Spectrogram Available</h3>
            <p className="text-gray-600 mb-4">
              Generate a fast spectrogram with AED event overlays to visualize acoustic events in this recording.
            </p>
            <Button
              onClick={() => handleGenerateSpectrogram(false)}
              disabled={generating}
              size="lg"
            >
              <Zap className="w-4 h-4 mr-2" />
              Generate Spectrogram
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default FastSpectrogramViewer;
