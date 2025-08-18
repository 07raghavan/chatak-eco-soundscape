import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Play, Pause, ZoomIn, ZoomOut, RotateCcw, Loader2, AlertCircle, 
  RefreshCw, Zap, Eye, Settings, Download 
} from 'lucide-react';
import { 
  getSpectrogramIndex, 
  getSpectrogramTile, 
  getAEDEventsForViewport, 
  generateSpectrogram, 
  getSpectrogramStatus, 
  runIndustryAEDForRecording,
  getAEDEventsForRecording 
} from '@/lib/api';

interface AEDEvent {
  id: string;
  start_ms: number;
  end_ms: number;
  f_min_hz?: number;
  f_max_hz?: number;
  peak_freq_hz?: number;
  confidence?: number;
  snr_db?: number;
  band_name?: string;
  verdict?: string;
  method?: string;
}

interface SpectrogramViewerProps {
  recordingId: number;
  audioUrl?: string;
  duration_ms: number;
  sample_rate?: number;
  width?: number;
  height?: number;
  onROIClick?: (event: AEDEvent) => void;
  onTimeClick?: (time_ms: number) => void;
  autoRunAED?: boolean;
}

export const IndustrySpectrogramViewer: React.FC<SpectrogramViewerProps> = ({
  recordingId,
  audioUrl,
  duration_ms,
  sample_rate = 32000,
  width = 1000,
  height = 500,
  onROIClick,
  onTimeClick,
  autoRunAED = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  
  // Zoom and viewport state
  const [zoom, setZoom] = useState(0);
  const [viewport, setViewport] = useState({ startMs: 0, endMs: duration_ms });
  const [hoveredEvent, setHoveredEvent] = useState<AEDEvent | null>(null);
  
  // Spectrogram state
  const [spectrogramIndex, setSpectrogramIndex] = useState<any>(null);
  const [loadedTiles, setLoadedTiles] = useState<Map<string, HTMLImageElement>>(new Map());
  const [spectrogramStatus, setSpectrogramStatus] = useState<string>('unknown');
  const [generating, setGenerating] = useState(false);
  
  // AED state
  const [aedEvents, setAedEvents] = useState<AEDEvent[]>([]);
  const [runningAED, setRunningAED] = useState(false);
  const [aedStats, setAedStats] = useState<any>(null);
  
  // Loading and error state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load initial data
  useEffect(() => {
    loadSpectrogramData();
    if (autoRunAED) {
      setTimeout(runAEDAnalysis, 2000); // Give spectrogram time to load
    }
  }, [recordingId]);

  // Load tiles when viewport changes
  useEffect(() => {
    if (spectrogramIndex && spectrogramStatus === 'completed') {
      loadTilesForViewport();
    }
  }, [viewport, zoom, spectrogramIndex]);

  // Load AED events when viewport changes
  useEffect(() => {
    if (spectrogramStatus === 'completed') {
      loadAEDEventsForViewport();
    }
  }, [viewport, zoom]);

  // Redraw canvas when tiles or events change
  useEffect(() => {
    if (spectrogramIndex && canvasRef.current) {
      drawSpectrogram();
    }
  }, [loadedTiles, aedEvents, hoveredEvent, currentTime, viewport]);

  const loadSpectrogramData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // First, check if spectrogram exists
      try {
        const indexResponse = await getSpectrogramIndex(recordingId);
        if (indexResponse.pyramid) {
          setSpectrogramIndex(indexResponse);
          setSpectrogramStatus('completed');
          await loadTilesForViewport();
        }
      } catch (indexError) {
        // Spectrogram doesn't exist, check status
        const statusResponse = await getSpectrogramStatus(recordingId);
        setSpectrogramStatus(statusResponse.status);
        
        if (statusResponse.status === 'not_generated') {
          setError('Spectrogram not generated yet. Click "Generate Spectrogram" to create it.');
        }
      }
    } catch (err: any) {
      console.error('Failed to load spectrogram data:', err);
      setError('Failed to load spectrogram data: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTilesForViewport = async () => {
    if (!spectrogramIndex?.pyramid?.zoom_levels) return;
    
    const zoomLevel = spectrogramIndex.pyramid.zoom_levels[zoom];
    if (!zoomLevel) return;

    const { px_per_sec, tiles_x, tiles_y } = zoomLevel;
    const tileWidth = spectrogramIndex.pyramid.tile_params?.tile_w || 1024;
    const tileHeight = spectrogramIndex.pyramid.tile_params?.tile_h || 512;
    
    // Calculate visible tiles
    const startTileX = Math.floor(viewport.startMs / 1000 * px_per_sec / tileWidth);
    const endTileX = Math.ceil(viewport.endMs / 1000 * px_per_sec / tileWidth);
    const startTileY = 0;
    const endTileY = tiles_y;

    // Load visible tiles
    const tilesToLoad = [];
    for (let tileY = startTileY; tileY < endTileY; tileY++) {
      for (let tileX = startTileX; tileX <= endTileX && tileX < tiles_x; tileX++) {
        const tileKey = `${zoom}-${tileX}-${tileY}`;
        if (!loadedTiles.has(tileKey)) {
          tilesToLoad.push({ tileX, tileY, tileKey });
        }
      }
    }

    // Load tiles in parallel (limit to prevent overwhelming)
    const tilePromises = tilesToLoad.slice(0, 20).map(async ({ tileX, tileY, tileKey }) => {
      try {
        const tileResponse = await getSpectrogramTile(recordingId, zoom, tileX, tileY);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        return new Promise<void>((resolve, reject) => {
          img.onload = () => {
            setLoadedTiles(prev => new Map(prev).set(tileKey, img));
            resolve();
          };
          img.onerror = reject;
          img.src = tileResponse.tile_url;
        });
      } catch (error) {
        console.warn(`Failed to load tile ${tileKey}:`, error);
      }
    });

    await Promise.allSettled(tilePromises);
  };

  const loadAEDEventsForViewport = async () => {
    try {
      const response = await getAEDEventsForViewport(recordingId, {
        start_ms: viewport.startMs,
        end_ms: viewport.endMs,
        min_freq_hz: 0,
        max_freq_hz: sample_rate / 2,
        min_confidence: 0.2,
        limit: 500
      });
      
      setAedEvents(response.events || []);
    } catch (error) {
      console.error('Failed to load AED events:', error);
    }
  };

  const handleGenerateSpectrogram = async () => {
    try {
      setGenerating(true);
      await generateSpectrogram(recordingId, {
        // Enhanced configuration for better visualization
        zoomLevels: [
          { zoom: 0, pxPerSec: 20, hzPerPx: 15.625 },   // Overview
          { zoom: 1, pxPerSec: 100, hzPerPx: 3.125 },   // Medium
          { zoom: 2, pxPerSec: 200, hzPerPx: 1.5625 },  // Detail
          { zoom: 3, pxPerSec: 400, hzPerPx: 0.78125 }  // High detail
        ],
        colormap: 'viridis',
        dynamicRange: 60
      });
      
      setSpectrogramStatus('processing');
      
      // Poll for completion
      const pollStatus = async () => {
        try {
          const status = await getSpectrogramStatus(recordingId);
          setSpectrogramStatus(status.status);
          
          if (status.status === 'completed') {
            await loadSpectrogramData();
          } else if (status.status === 'processing') {
            setTimeout(pollStatus, 3000);
          }
        } catch (error) {
          console.error('Failed to check status:', error);
        }
      };
      
      setTimeout(pollStatus, 2000);
      
    } catch (error: any) {
      console.error('Failed to generate spectrogram:', error);
      setError('Failed to start spectrogram generation: ' + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const runAEDAnalysis = async () => {
    try {
      setRunningAED(true);
      setError(null);
      
      console.log(`🎯 Running industry-standard AED for recording ${recordingId}`);
      
      const response = await runIndustryAEDForRecording(recordingId, {
        // Advanced AED configuration
        nFFT: 2048,
        hopMs: 5,
        nMels: 128,
        useSpectralNovelty: true,
        useOnsetDetection: true,
        minDurationMs: 50,
        maxDurationMs: 10000,
        onsetThresholdSigma: 2.5,
        mergeGapMs: 100
      });
      
      setAedStats(response);
      
      // Reload events to show newly detected ones
      await loadAEDEventsForViewport();
      
      console.log(`✅ AED completed: ${response.events_detected} events detected`);
      
    } catch (error: any) {
      console.error('Failed to run AED:', error);
      setError('Failed to run AED analysis: ' + error.message);
    } finally {
      setRunningAED(false);
    }
  };

  const drawSpectrogram = () => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrogramIndex) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    if (spectrogramStatus !== 'completed') {
      drawPlaceholder(ctx);
      return;
    }

    // Draw spectrogram tiles
    drawTiles(ctx);
    
    // Draw AED event ROI boxes
    drawEventBoxes(ctx);
    
    // Draw time cursor
    drawTimeCursor(ctx);
  };

  const drawPlaceholder = (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#666';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    
    if (spectrogramStatus === 'not_generated') {
      ctx.fillText('Spectrogram not generated', width / 2, height / 2 - 10);
      ctx.fillText('Click "Generate Spectrogram" to create', width / 2, height / 2 + 15);
    } else if (spectrogramStatus === 'processing') {
      ctx.fillText('Generating spectrogram...', width / 2, height / 2);
    } else {
      ctx.fillText('Loading spectrogram...', width / 2, height / 2);
    }
  };

  const drawTiles = (ctx: CanvasRenderingContext2D) => {
    if (!spectrogramIndex?.pyramid?.zoom_levels) return;
    
    const zoomLevel = spectrogramIndex.pyramid.zoom_levels[zoom];
    if (!zoomLevel) return;

    const { px_per_sec } = zoomLevel;
    const tileWidth = spectrogramIndex.pyramid.tile_params?.tile_w || 1024;
    const tileHeight = spectrogramIndex.pyramid.tile_params?.tile_h || 512;
    
    // Calculate viewport scaling
    const viewportStartPx = viewport.startMs / 1000 * px_per_sec;
    const viewportWidthPx = (viewport.endMs - viewport.startMs) / 1000 * px_per_sec;
    const scaleX = width / viewportWidthPx;
    const scaleY = height / (sample_rate / 2);
    
    // Draw each loaded tile
    loadedTiles.forEach((img, tileKey) => {
      const [zoomStr, tileXStr, tileYStr] = tileKey.split('-');
      if (parseInt(zoomStr) !== zoom) return;
      
      const tileX = parseInt(tileXStr);
      const tileY = parseInt(tileYStr);
      
      // Calculate tile position
      const tilePxX = tileX * tileWidth;
      const tilePxY = tileY * tileHeight;
      
      // Skip tiles outside viewport
      if (tilePxX + tileWidth < viewportStartPx || tilePxX > viewportStartPx + viewportWidthPx) {
        return;
      }
      
      // Calculate drawing position
      const drawX = (tilePxX - viewportStartPx) * scaleX;
      const drawY = tilePxY * scaleY;
      const drawWidth = tileWidth * scaleX;
      const drawHeight = tileHeight * scaleY;
      
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    });
  };

  const drawEventBoxes = (ctx: CanvasRenderingContext2D) => {
    const viewportDuration = viewport.endMs - viewport.startMs;
    const freqRange = sample_rate / 2;
    
    aedEvents.forEach(event => {
      // Calculate event position in canvas
      const startX = ((event.start_ms - viewport.startMs) / viewportDuration) * width;
      const endX = ((event.end_ms - viewport.startMs) / viewportDuration) * width;
      const eventWidth = endX - startX;
      
      // Skip events outside viewport
      if (endX < 0 || startX > width) return;
      
      let startY = 0;
      let eventHeight = height;
      
      // If frequency range is specified, calculate Y coordinates
      if (event.f_min_hz !== undefined && event.f_max_hz !== undefined) {
        startY = height - (event.f_max_hz / freqRange) * height;
        const endY = height - (event.f_min_hz / freqRange) * height;
        eventHeight = endY - startY;
      }
      
      // Event styling based on confidence and band
      const isHovered = hoveredEvent?.id === event.id;
      const confidence = event.confidence || 0;
      
      let boxColor = '#4ecdc4'; // Default teal
      if (event.band_name === 'high_freq') boxColor = '#ff6b6b'; // Red for high freq
      else if (event.band_name === 'mid_freq') boxColor = '#4ecdc4'; // Teal for mid freq  
      else if (event.band_name === 'low_freq') boxColor = '#45b7d1'; // Blue for low freq
      
      if (confidence >= 0.8) boxColor = '#2ecc71'; // High confidence - green
      else if (confidence >= 0.6) boxColor = '#f39c12'; // Medium confidence - orange
      else if (confidence < 0.4) boxColor = '#e74c3c'; // Low confidence - red
      
      ctx.strokeStyle = isHovered ? '#ffffff' : boxColor;
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.setLineDash(confidence < 0.5 ? [4, 4] : []);
      
      // Draw event rectangle
      ctx.strokeRect(Math.max(0, startX), startY, Math.min(eventWidth, width - startX), eventHeight);
      
      // Draw confidence and band labels
      if (confidence > 0) {
        const confidenceText = `${Math.round(confidence * 100)}%`;
        ctx.fillStyle = boxColor;
        ctx.font = '12px Arial';
        const textMetrics = ctx.measureText(confidenceText);
        
        const labelX = Math.max(2, Math.min(startX, width - textMetrics.width - 8));
        const labelY = Math.max(16, startY);
        
        // Background for text
        ctx.fillRect(labelX, labelY - 14, textMetrics.width + 6, 16);
        ctx.fillStyle = '#000';
        ctx.fillText(confidenceText, labelX + 3, labelY - 2);
      }
      
      // Draw band name
      if (event.band_name) {
        ctx.fillStyle = boxColor;
        ctx.font = '10px Arial';
        const bandText = event.band_name.replace('_', ' ');
        const textMetrics = ctx.measureText(bandText);
        
        const labelX = Math.max(2, Math.min(startX, width - textMetrics.width - 6));
        const labelY = Math.min(height - 4, startY + eventHeight + 14);
        
        ctx.fillRect(labelX, labelY - 12, textMetrics.width + 4, 12);
        ctx.fillStyle = '#fff';
        ctx.fillText(bandText, labelX + 2, labelY - 2);
      }
    });
    
    ctx.setLineDash([]); // Reset dash
  };

  const drawTimeCursor = (ctx: CanvasRenderingContext2D) => {
    const viewportDuration = viewport.endMs - viewport.startMs;
    const cursorX = ((currentTime - viewport.startMs) / viewportDuration) * width;
    
    if (cursorX >= 0 && cursorX <= width) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, height);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  // Event handlers
  const handleCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Convert to time and frequency
    const viewportDuration = viewport.endMs - viewport.startMs;
    const timeMs = viewport.startMs + (x / width) * viewportDuration;
    const freq = (1 - y / height) * (sample_rate / 2);
    
    // Check if click is on an AED event
    const clickedEvent = aedEvents.find(aedEvent => {
      const inTimeRange = timeMs >= aedEvent.start_ms && timeMs <= aedEvent.end_ms;
      const inFreqRange = !aedEvent.f_min_hz || !aedEvent.f_max_hz || 
        (freq >= aedEvent.f_min_hz && freq <= aedEvent.f_max_hz);
      return inTimeRange && inFreqRange;
    });
    
    if (clickedEvent && onROIClick) {
      onROIClick(clickedEvent);
    } else if (onTimeClick) {
      onTimeClick(timeMs);
    }
  }, [viewport, sample_rate, aedEvents, onROIClick, onTimeClick]);

  const handleCanvasHover = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const viewportDuration = viewport.endMs - viewport.startMs;
    const timeMs = viewport.startMs + (x / width) * viewportDuration;
    const freq = (1 - y / height) * (sample_rate / 2);
    
    const hoveredEvent = aedEvents.find(aedEvent => {
      const inTimeRange = timeMs >= aedEvent.start_ms && timeMs <= aedEvent.end_ms;
      const inFreqRange = !aedEvent.f_min_hz || !aedEvent.f_max_hz || 
        (freq >= aedEvent.f_min_hz && freq <= aedEvent.f_max_hz);
      return inTimeRange && inFreqRange;
    });
    
    setHoveredEvent(hoveredEvent || null);
    canvas.style.cursor = hoveredEvent ? 'pointer' : 'crosshair';
  }, [viewport, sample_rate, aedEvents]);

  // Zoom controls
  const handleZoomIn = () => {
    if (!spectrogramIndex?.pyramid?.zoom_levels) return;
    const maxZoom = spectrogramIndex.pyramid.zoom_levels.length - 1;
    const newZoom = Math.min(zoom + 1, maxZoom);
    setZoom(newZoom);
    setLoadedTiles(new Map());
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoom - 1, 0);
    setZoom(newZoom);
    setLoadedTiles(new Map());
  };

  const handleReset = () => {
    setZoom(0);
    setViewport({ startMs: 0, endMs: duration_ms });
    setCurrentTime(0);
    setLoadedTiles(new Map());
  };

  const formatTime = (ms: number) => {
    const seconds = ms / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  };

  const getCurrentZoomInfo = () => {
    if (!spectrogramIndex?.pyramid?.zoom_levels) return 'No data';
    const zoomLevel = spectrogramIndex.pyramid.zoom_levels[zoom];
    return zoomLevel ? `${zoomLevel.px_per_sec} px/sec` : 'Unknown';
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="w-5 h-5" />
          Industry-Standard Spectrogram with AED Analysis
          {aedStats && (
            <Badge variant="outline" className="ml-2">
              {aedStats.events_detected} events detected
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
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
              
              {spectrogramStatus !== 'completed' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateSpectrogram}
                  disabled={generating || spectrogramStatus === 'processing'}
                >
                  {generating || spectrogramStatus === 'processing' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {spectrogramStatus === 'processing' ? 'Generating...' : 'Generate Spectrogram'}
                </Button>
              )}
              
              {spectrogramStatus === 'completed' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runAEDAnalysis}
                  disabled={runningAED}
                >
                  {runningAED ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Zap className="w-4 h-4" />
                  )}
                  {runningAED ? 'Running AED...' : 'Run AED Analysis'}
                </Button>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleZoomOut} disabled={zoom <= 0}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <div className="text-sm text-gray-600 min-w-[100px] text-center">
                Zoom {zoom} ({getCurrentZoomInfo()})
              </div>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={handleZoomIn} 
                disabled={!spectrogramIndex?.pyramid?.zoom_levels || zoom >= spectrogramIndex.pyramid.zoom_levels.length - 1}
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={handleReset}>
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Status and Error Messages */}
          {(loading || error || spectrogramStatus !== 'completed') && (
            <Alert>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {error && <AlertCircle className="w-4 h-4 text-red-500" />}
              <AlertDescription>
                {loading && 'Loading spectrogram...'}
                {error && error}
                {spectrogramStatus === 'processing' && 'Generating spectrogram...'}
                {spectrogramStatus === 'not_generated' && !error && 'Spectrogram not generated yet'}
              </AlertDescription>
            </Alert>
          )}

          {/* AED Analysis Results */}
          {aedStats && (
            <Alert>
              <Zap className="w-4 h-4" />
              <AlertDescription>
                <strong>AED Analysis Complete:</strong> {aedStats.events_detected} events detected 
                across {aedStats.segments_processed} approved segments 
                ({aedStats.coverage_percent}% coverage). 
                Method: {aedStats.method}
              </AlertDescription>
            </Alert>
          )}

          {/* Spectrogram Canvas */}
          <div className="border rounded-lg overflow-hidden bg-black">
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              className="w-full h-auto cursor-crosshair"
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasHover}
              onMouseLeave={() => setHoveredEvent(null)}
            />
          </div>

          {/* Frequency Scale and Info Bar */}
          <div className="flex justify-between items-center text-sm text-gray-600">
            <div className="flex items-center gap-4">
              <span>0 Hz</span>
              <span>{(sample_rate / 4).toFixed(0)} Hz</span>
              <span>{(sample_rate / 2).toFixed(0)} Hz</span>
            </div>
            
            {aedEvents.length > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {aedEvents.length} AED Event{aedEvents.length !== 1 ? 's' : ''}
                </Badge>
                {hoveredEvent && (
                  <span className="text-blue-600">
                    {hoveredEvent.band_name}: {formatTime(hoveredEvent.start_ms)} - {formatTime(hoveredEvent.end_ms)}
                    {hoveredEvent.confidence && ` (${(hoveredEvent.confidence * 100).toFixed(0)}%)`}
                    {hoveredEvent.snr_db && ` SNR: ${hoveredEvent.snr_db.toFixed(1)}dB`}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default IndustrySpectrogramViewer;
