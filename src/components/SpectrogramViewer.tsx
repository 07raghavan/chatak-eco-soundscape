import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, ZoomIn, ZoomOut, RotateCcw, Loader2 } from 'lucide-react';
import { getSpectrogramIndex, getSpectrogramTile, getAEDEventsForViewport, generateSpectrogram, getSpectrogramStatus } from '@/lib/api';

interface ROI {
  id: number;
  start_ms: number;
  end_ms: number;
  min_freq_hz?: number;
  max_freq_hz?: number;
  confidence?: number;
  label?: string;
}

interface SpectrogramViewerProps {
  recordingId: number;
  audioUrl?: string;
  duration_ms: number;
  sample_rate?: number;
  rois?: ROI[];
  width?: number;
  height?: number;
  onROIClick?: (roi: ROI) => void;
  onTimeClick?: (time_ms: number) => void;
}

export const SpectrogramViewer: React.FC<SpectrogramViewerProps> = ({
  recordingId,
  audioUrl,
  duration_ms,
  sample_rate = 32000,
  rois = [],
  width = 800,
  height = 400,
  onROIClick,
  onTimeClick
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [zoom, setZoom] = useState(0); // Start with overview zoom
  const [viewport, setViewport] = useState({ startMs: 0, endMs: duration_ms });
  const [hoveredROI, setHoveredROI] = useState<ROI | null>(null);
  
  // Real spectrogram state
  const [spectrogramIndex, setSpectrogramIndex] = useState<any>(null);
  const [loadedTiles, setLoadedTiles] = useState<Map<string, HTMLImageElement>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aedEvents, setAedEvents] = useState<any[]>([]);
  const [generationStatus, setGenerationStatus] = useState<string>('unknown');

  // Generate synthetic spectrogram data (in real implementation, this would be from FFT)
  const generateSpectrogramData = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    // Generate synthetic spectrogram pattern
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4;
        
        // Create frequency bands (higher frequencies at top)
        const freq = (1 - y / height) * (sample_rate / 2);
        
        // Time progress
        const time = (x / width) * (duration_ms / 1000);
        
        // Generate synthetic energy based on frequency and time
        let energy = 0;
        
        // Add some base noise
        energy += Math.random() * 0.2;
        
        // Add frequency-dependent energy (more energy in bird frequency ranges)
        if (freq > 1000 && freq < 8000) {
          energy += Math.sin(time * 2 * Math.PI * 0.5) * 0.3 + 0.3;
        }
        
        // Add some harmonic content
        if (freq > 2000 && freq < 4000) {
          energy += Math.sin(time * 2 * Math.PI * 2) * 0.4 + 0.2;
        }
        
        // Check if this pixel falls within any ROI
        let inROI = false;
        const timeMs = time * 1000;
        
        for (const roi of rois) {
          if (timeMs >= roi.start_ms && timeMs <= roi.end_ms) {
            if (!roi.min_freq_hz || !roi.max_freq_hz || 
                (freq >= roi.min_freq_hz && freq <= roi.max_freq_hz)) {
              energy += 0.5; // Highlight ROI areas
              inROI = true;
              break;
            }
          }
        }
        
        // Convert energy to color (blue = low, yellow = medium, red = high)
        energy = Math.max(0, Math.min(1, energy));
        
        if (inROI) {
          // Highlight ROIs with red tint
          data[idx] = Math.floor(255 * energy);     // R
          data[idx + 1] = Math.floor(100 * energy); // G
          data[idx + 2] = Math.floor(100 * energy); // B
        } else {
          // Normal spectrogram colors
          if (energy < 0.3) {
            // Blue for low energy
            data[idx] = 0;
            data[idx + 1] = Math.floor(100 * energy);
            data[idx + 2] = Math.floor(255 * energy);
          } else if (energy < 0.7) {
            // Yellow for medium energy
            data[idx] = Math.floor(255 * energy);
            data[idx + 1] = Math.floor(255 * energy);
            data[idx + 2] = 0;
          } else {
            // Red for high energy
            data[idx] = 255;
            data[idx + 1] = Math.floor(100 * (1 - energy));
            data[idx + 2] = 0;
          }
        }
        
        data[idx + 3] = 255; // Alpha
      }
    }
    
    setSpectrogramData(imageData);
  }, [width, height, duration_ms, sample_rate, rois]);

  // Draw spectrogram and ROI overlays
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrogramData) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw spectrogram
    ctx.putImageData(spectrogramData, 0, 0);
    
    // Draw ROI boxes
    rois.forEach(roi => {
      const startX = (roi.start_ms / duration_ms) * width;
      const endX = (roi.end_ms / duration_ms) * width;
      const roiWidth = endX - startX;
      
      let startY = 0;
      let roiHeight = height;
      
      // If frequency range is specified, calculate Y coordinates
      if (roi.min_freq_hz && roi.max_freq_hz) {
        const maxFreq = sample_rate / 2;
        startY = (1 - roi.max_freq_hz / maxFreq) * height;
        const endY = (1 - roi.min_freq_hz / maxFreq) * height;
        roiHeight = endY - startY;
      }
      
      // ROI box styling
      const isHovered = hoveredROI?.id === roi.id;
      ctx.strokeStyle = isHovered ? '#ff6b6b' : '#4ecdc4';
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.setLineDash([]);
      
      // Draw ROI rectangle
      ctx.strokeRect(startX, startY, roiWidth, roiHeight);
      
      // Draw ROI label
      if (roi.label || roi.confidence) {
        ctx.fillStyle = isHovered ? '#ff6b6b' : '#4ecdc4';
        ctx.font = '12px Arial';
        const text = roi.label || `${(roi.confidence! * 100).toFixed(0)}%`;
        const textMetrics = ctx.measureText(text);
        
        // Background for text
        ctx.fillRect(startX, startY - 20, textMetrics.width + 8, 16);
        ctx.fillStyle = 'white';
        ctx.fillText(text, startX + 4, startY - 8);
      }
    });
    
    // Draw time cursor
    const cursorX = (currentTime / duration_ms) * width;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, height);
    ctx.stroke();
  }, [spectrogramData, width, height, duration_ms, sample_rate, rois, currentTime, hoveredROI]);

  // Handle canvas click
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const timeMs = (x / width) * duration_ms;
    const freq = (1 - y / height) * (sample_rate / 2);
    
    // Check if click is on an ROI
    const clickedROI = rois.find(roi => {
      const inTimeRange = timeMs >= roi.start_ms && timeMs <= roi.end_ms;
      const inFreqRange = !roi.min_freq_hz || !roi.max_freq_hz || 
        (freq >= roi.min_freq_hz && freq <= roi.max_freq_hz);
      return inTimeRange && inFreqRange;
    });
    
    if (clickedROI && onROIClick) {
      onROIClick(clickedROI);
    } else if (onTimeClick) {
      onTimeClick(timeMs);
    }
  }, [width, height, duration_ms, sample_rate, rois, onROIClick, onTimeClick]);

  // Handle canvas hover
  const handleCanvasHover = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const timeMs = (x / width) * duration_ms;
    const freq = (1 - y / height) * (sample_rate / 2);
    
    const hoveredROI = rois.find(roi => {
      const inTimeRange = timeMs >= roi.start_ms && timeMs <= roi.end_ms;
      const inFreqRange = !roi.min_freq_hz || !roi.max_freq_hz || 
        (freq >= roi.min_freq_hz && freq <= roi.max_freq_hz);
      return inTimeRange && inFreqRange;
    });
    
    setHoveredROI(hoveredROI || null);
    canvas.style.cursor = hoveredROI ? 'pointer' : 'crosshair';
  }, [width, height, duration_ms, sample_rate, rois]);

  // Initialize and update
  useEffect(() => {
    generateSpectrogramData();
  }, [generateSpectrogramData]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Format time for display
  const formatTime = (ms: number) => {
    const seconds = ms / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  };

  return (
    <Card className="w-full">
      <CardContent className="p-6">
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsPlaying(!isPlaying)}
                disabled={!audioUrl}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <span className="text-sm text-gray-600">
                {formatTime(currentTime)} / {formatTime(duration_ms)}
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setZoom(Math.max(0.5, zoom - 0.5))}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-sm text-gray-600">{zoom.toFixed(1)}x</span>
              <Button size="sm" variant="outline" onClick={() => setZoom(Math.min(4, zoom + 0.5))}>
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setZoom(1); setOffset(0); }}>
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Spectrogram Canvas */}
          <div className="border rounded-lg overflow-hidden bg-black">
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              className="w-full h-auto cursor-crosshair"
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasHover}
              onMouseLeave={() => setHoveredROI(null)}
            />
          </div>

          {/* Frequency Scale */}
          <div className="flex justify-between text-xs text-gray-500">
            <span>0 Hz</span>
            <span>{(sample_rate / 4).toFixed(0)} Hz</span>
            <span>{(sample_rate / 2).toFixed(0)} Hz</span>
          </div>

          {/* ROI Summary */}
          {rois.length > 0 && (
            <div className="text-sm text-gray-600">
              <strong>{rois.length}</strong> region{rois.length !== 1 ? 's' : ''} of interest detected
              {hoveredROI && (
                <span className="ml-4 text-blue-600">
                  Hovering: {formatTime(hoveredROI.start_ms)} - {formatTime(hoveredROI.end_ms)}
                  {hoveredROI.confidence && ` (${(hoveredROI.confidence * 100).toFixed(0)}%)`}
                </span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default SpectrogramViewer;
