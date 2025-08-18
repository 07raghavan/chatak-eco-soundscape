import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Play, Pause, ZoomIn, ZoomOut, RotateCcw, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { getSpectrogramIndex, getSpectrogramTile, getAEDEventsForViewport, generateSpectrogram, getSpectrogramStatus } from '@/lib/api';

interface ROI {
  id: string;
  start_ms: number;
  end_ms: number;
  f_min_hz?: number;
  f_max_hz?: number;
  confidence?: number;
  band_name?: string;
  snippet_url?: string;
}

interface SpectrogramViewerProps {
  recordingId: number;
  audioUrl?: string;
  duration_ms: number;
  sample_rate?: number;
  width?: number;
  height?: number;
  onROIClick?: (roi: ROI) => void;
  onTimeClick?: (time_ms: number) => void;
}

export const RealSpectrogramViewer: React.FC<SpectrogramViewerProps> = ({
  recordingId,
  audioUrl,
  duration_ms,
  sample_rate = 32000,
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
  const [aedEvents, setAedEvents] = useState<ROI[]>([]);
  const [generationStatus, setGenerationStatus] = useState<string>('unknown');
  const [generating, setGenerating] = useState(false);

  // Load spectrogram index on mount
  useEffect(() => {
    loadSpectrogramIndex();
  }, [recordingId]);

  // Load AED events when viewport changes
  useEffect(() => {
    if (spectrogramIndex) {
      loadAEDEventsForViewport();
    }
  }, [viewport, zoom, spectrogramIndex]);

  // Draw canvas when tiles or events change
  useEffect(() => {
    if (spectrogramIndex && canvasRef.current) {
      drawSpectrogram();
    }
  }, [loadedTiles, aedEvents, hoveredROI, currentTime, viewport]);

  const loadSpectrogramIndex = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await getSpectrogramIndex(recordingId);
      
      if (response.pyramid) {
        setSpectrogramIndex(response);
        setGenerationStatus(response.pyramid.status);
        
        // Load initial tiles for current zoom level
        await loadTilesForViewport();
      } else {
        setGenerationStatus('not_generated');
        setError('Spectrogram not generated yet');
      }
    } catch (error: any) {
      console.error('Failed to load spectrogram index:', error);
      if (error.message?.includes('not generated')) {
        setGenerationStatus('not_generated');
        setError('Spectrogram not generated yet');
      } else {
        setError('Failed to load spectrogram data');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadTilesForViewport = async () => {
    if (!spectrogramIndex?.pyramid?.zoom_levels) return;
    
    const zoomLevel = spectrogramIndex.pyramid.zoom_levels[zoom];
    if (!zoomLevel) return;

    const { px_per_sec, tiles_x, tiles_y } = zoomLevel;
    const tileWidth = spectrogramIndex.pyramid.tile_params.tile_w || 1024;
    const tileHeight = spectrogramIndex.pyramid.tile_params.tile_h || 512;
    
    // Calculate which tiles are visible
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

    // Load tiles in parallel
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
        min_confidence: 0.3,
        zoom_level: zoom
      });
      
      setAedEvents(response.events || []);
    } catch (error) {
      console.error('Failed to load AED events:', error);
    }
  };

  const drawSpectrogram = () => {
    const canvas = canvasRef.current;
    if (!canvas || !spectrogramIndex) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);
    
    if (generationStatus !== 'completed') {
      drawPlaceholder(ctx);
      return;
    }

    // Draw tiles
    drawTiles(ctx);
    
    // Draw ROI boxes on top
    drawROIBoxes(ctx);
    
    // Draw time cursor
    drawTimeCursor(ctx);
  };

  const drawPlaceholder = (ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);
    
    ctx.fillStyle = '#666';
    ctx.font = '16px Arial';
    ctx.textAlign = 'center';
    
    if (generationStatus === 'not_generated') {
      ctx.fillText('Spectrogram not generated', width / 2, height / 2 - 10);
      ctx.fillText('Click "Generate Spectrogram" to create', width / 2, height / 2 + 15);
    } else if (generationStatus === 'processing') {
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
    const tileWidth = spectrogramIndex.pyramid.tile_params.tile_w || 1024;
    const tileHeight = spectrogramIndex.pyramid.tile_params.tile_h || 512;
    
    // Calculate viewport in pixels
    const viewportStartPx = viewport.startMs / 1000 * px_per_sec;
    const viewportWidthPx = (viewport.endMs - viewport.startMs) / 1000 * px_per_sec;
    const scaleX = width / viewportWidthPx;
    const scaleY = height / (sample_rate / 2); // Frequency scaling
    
    // Draw each loaded tile
    loadedTiles.forEach((img, tileKey) => {
      const [zoomStr, tileXStr, tileYStr] = tileKey.split('-');
      if (parseInt(zoomStr) !== zoom) return;
      
      const tileX = parseInt(tileXStr);
      const tileY = parseInt(tileYStr);
      
      // Calculate tile position in canvas
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

  const drawROIBoxes = (ctx: CanvasRenderingContext2D) => {
    const viewportDuration = viewport.endMs - viewport.startMs;
    const freqRange = sample_rate / 2;
    
    aedEvents.forEach(roi => {
      // Calculate ROI position in canvas
      const startX = ((roi.start_ms - viewport.startMs) / viewportDuration) * width;
      const endX = ((roi.end_ms - viewport.startMs) / viewportDuration) * width;
      const roiWidth = endX - startX;
      
      let startY = 0;
      let roiHeight = height;
      
      // If frequency range is specified, calculate Y coordinates
      if (roi.f_min_hz !== undefined && roi.f_max_hz !== undefined) {
        startY = height - (roi.f_max_hz / freqRange) * height;
        const endY = height - (roi.f_min_hz / freqRange) * height;
        roiHeight = endY - startY;
      }
      
      // Skip if outside viewport
      if (endX < 0 || startX > width) return;
      
      // ROI box styling based on confidence
      const isHovered = hoveredROI?.id === roi.id;
      const confidence = roi.confidence || 0;
      
      let boxColor = '#4ecdc4'; // Default teal
      if (confidence >= 0.8) boxColor = '#00ff00'; // High confidence - green
      else if (confidence >= 0.6) boxColor = '#ffff00'; // Medium confidence - yellow
      else if (confidence >= 0.4) boxColor = '#ff8800'; // Low confidence - orange
      else boxColor = '#ff4444'; // Very low confidence - red
      
      ctx.strokeStyle = isHovered ? '#ffffff' : boxColor;
      ctx.lineWidth = isHovered ? 3 : 2;
      ctx.setLineDash(isHovered ? [] : [2, 2]);
      
      // Draw ROI rectangle
      ctx.strokeRect(Math.max(0, startX), startY, Math.min(roiWidth, width - startX), roiHeight);
      
      // Draw confidence badge
      if (confidence > 0) {
        const confidenceText = `${Math.round(confidence * 100)}%`;
        ctx.fillStyle = boxColor;
        ctx.font = '12px Arial';
        const textMetrics = ctx.measureText(confidenceText);
        
        const badgeX = Math.max(2, Math.min(startX, width - textMetrics.width - 8));
        const badgeY = Math.max(16, startY);
        
        // Background for text
        ctx.fillRect(badgeX, badgeY - 14, textMetrics.width + 6, 16);
        ctx.fillStyle = '#000';
        ctx.fillText(confidenceText, badgeX + 3, badgeY - 2);
      }
      
      // Draw band name if available
      if (roi.band_name) {
        ctx.fillStyle = boxColor;
        ctx.font = '10px Arial';
        const bandText = roi.band_name;
        const textMetrics = ctx.measureText(bandText);
        
        const badgeX = Math.max(2, Math.min(startX, width - textMetrics.width - 6));
        const badgeY = Math.min(height - 4, startY + roiHeight + 14);
        
        ctx.fillRect(badgeX, badgeY - 12, textMetrics.width + 4, 12);
        ctx.fillStyle = '#fff';
        ctx.fillText(bandText, badgeX + 2, badgeY - 2);
      }
    });
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
      ctx.setLineDash([]); // Reset dash
    }
  };

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
    
    // Check if click is on an ROI
    const clickedROI = aedEvents.find(roi => {
      const inTimeRange = timeMs >= roi.start_ms && timeMs <= roi.end_ms;
      const inFreqRange = !roi.f_min_hz || !roi.f_max_hz || 
        (freq >= roi.f_min_hz && freq <= roi.f_max_hz);
      return inTimeRange && inFreqRange;
    });
    
    if (clickedROI && onROIClick) {
      onROIClick(clickedROI);
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
    
    // Convert to time and frequency
    const viewportDuration = viewport.endMs - viewport.startMs;
    const timeMs = viewport.startMs + (x / width) * viewportDuration;
    const freq = (1 - y / height) * (sample_rate / 2);
    
    const hoveredROI = aedEvents.find(roi => {
      const inTimeRange = timeMs >= roi.start_ms && timeMs <= roi.end_ms;
      const inFreqRange = !roi.f_min_hz || !roi.f_max_hz || 
        (freq >= roi.f_min_hz && freq <= roi.f_max_hz);
      return inTimeRange && inFreqRange;
    });
    
    setHoveredROI(hoveredROI || null);
    canvas.style.cursor = hoveredROI ? 'pointer' : 'crosshair';
  }, [viewport, sample_rate, aedEvents]);

  const handleZoomIn = () => {
    if (!spectrogramIndex?.pyramid?.zoom_levels) return;
    const maxZoom = spectrogramIndex.pyramid.zoom_levels.length - 1;
    const newZoom = Math.min(zoom + 1, maxZoom);
    setZoom(newZoom);
    setLoadedTiles(new Map()); // Clear tiles for new zoom
    loadTilesForViewport();
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(zoom - 1, 0);
    setZoom(newZoom);
    setLoadedTiles(new Map()); // Clear tiles for new zoom
    loadTilesForViewport();
  };

  const handleReset = () => {
    setZoom(0);
    setViewport({ startMs: 0, endMs: duration_ms });
    setCurrentTime(0);
    setLoadedTiles(new Map());
    loadTilesForViewport();
  };

  const handleGenerateSpectrogram = async () => {
    try {
      setGenerating(true);
      await generateSpectrogram(recordingId);
      setGenerationStatus('processing');
      
      // Poll for completion
      const pollStatus = async () => {
        try {
          const status = await getSpectrogramStatus(recordingId);
          setGenerationStatus(status.status);
          
          if (status.status === 'completed') {
            await loadSpectrogramIndex();
          } else if (status.status === 'processing') {
            setTimeout(pollStatus, 5000); // Check again in 5 seconds
          }
        } catch (error) {
          console.error('Failed to check status:', error);
        }
      };
      
      setTimeout(pollStatus, 2000); // Start polling after 2 seconds
      
    } catch (error) {
      console.error('Failed to generate spectrogram:', error);
      setError('Failed to start spectrogram generation');
    } finally {
      setGenerating(false);
    }
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
              
              {generationStatus !== 'completed' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateSpectrogram}
                  disabled={generating || generationStatus === 'processing'}
                >
                  {generating || generationStatus === 'processing' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {generationStatus === 'processing' ? 'Generating...' : 'Generate Spectrogram'}
                </Button>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleZoomOut} disabled={zoom <= 0}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <div className="text-sm text-gray-600 min-w-[80px] text-center">
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

          {/* Status */}
          {(loading || error || generationStatus !== 'completed') && (
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {error && <AlertCircle className="w-4 h-4 text-red-500" />}
              <span className="text-sm">
                {loading && 'Loading spectrogram...'}
                {error && error}
                {generationStatus === 'processing' && 'Generating spectrogram...'}
                {generationStatus === 'not_generated' && !error && 'Spectrogram not generated yet'}
              </span>
              {generationStatus === 'completed' && (
                <Badge variant="outline" className="ml-2">
                  {aedEvents.length} events detected
                </Badge>
              )}
            </div>
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
              onMouseLeave={() => setHoveredROI(null)}
            />
          </div>

          {/* Info Bar */}
          <div className="flex justify-between items-center text-sm text-gray-600">
            <div className="flex items-center gap-4">
              <span>0 Hz</span>
              <span>{(sample_rate / 4).toFixed(0)} Hz</span>
              <span>{(sample_rate / 2).toFixed(0)} Hz</span>
            </div>
            
            {aedEvents.length > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {aedEvents.length} ROI{aedEvents.length !== 1 ? 's' : ''}
                </Badge>
                {hoveredROI && (
                  <span className="text-blue-600">
                    {hoveredROI.band_name}: {formatTime(hoveredROI.start_ms)} - {formatTime(hoveredROI.end_ms)}
                    {hoveredROI.confidence && ` (${(hoveredROI.confidence * 100).toFixed(0)}%)`}
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

export default RealSpectrogramViewer;
