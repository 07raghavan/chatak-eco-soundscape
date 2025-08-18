import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiRequest } from '@/lib/api';

interface Tile {
  tileId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  url: string;
}

interface Viewport {
  zoom: number;
  startTimeMs: number;
  endTimeMs: number;
  minFreqHz: number;
  maxFreqHz: number;
}

interface TiledSpectrogramViewerProps {
  recordingId: number;
  width?: number;
  height?: number;
  initialZoom?: number;
  onTimeRangeChange?: (startMs: number, endMs: number) => void;
  onFrequencyRangeChange?: (minHz: number, maxHz: number) => void;
}

export const TiledSpectrogramViewer: React.FC<TiledSpectrogramViewerProps> = ({
  recordingId,
  width = 1200,
  height = 600,
  initialZoom = 0,
  onTimeRangeChange,
  onFrequencyRangeChange
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [viewport, setViewport] = useState<Viewport>({
    zoom: initialZoom,
    startTimeMs: 0,
    endTimeMs: 10000, // Initial 10 second view
    minFreqHz: 0,
    maxFreqHz: 16000
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [pyramid, setPyramid] = useState<any>(null);
  
  // Tile cache for performance
  const tileCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const loadingTiles = useRef<Set<string>>(new Set());

  // Load pyramid metadata
  useEffect(() => {
    const loadPyramid = async () => {
      try {
        const response = await apiRequest(`/api/spectrograms/recordings/${recordingId}/pyramid`);
        setPyramid(response.pyramid);
        
        // Set initial viewport based on recording duration
        if (response.recordingDuration) {
          setViewport(prev => ({
            ...prev,
            endTimeMs: Math.min(prev.endTimeMs, response.recordingDuration),
            maxFreqHz: response.pyramid.fmax || 16000
          }));
        }
      } catch (err: any) {
        setError(err.message || 'Failed to load spectrogram pyramid');
      }
    };

    loadPyramid();
  }, [recordingId]);

  // Load tiles for current viewport
  const loadTilesForViewport = useCallback(async (currentViewport: Viewport) => {
    if (!pyramid) return;

    try {
      setLoading(true);
      setError('');

      const response = await apiRequest(
        `/api/spectrograms/recordings/${recordingId}/tiles?` +
        `zoom=${currentViewport.zoom}&` +
        `startTimeMs=${currentViewport.startTimeMs}&` +
        `endTimeMs=${currentViewport.endTimeMs}&` +
        `minFreqHz=${currentViewport.minFreqHz}&` +
        `maxFreqHz=${currentViewport.maxFreqHz}`
      );

      setTiles(response.tiles);
      
      // Preload tile images
      response.tiles.forEach((tile: Tile) => {
        const cacheKey = `${tile.x}_${tile.y}_${currentViewport.zoom}`;
        if (!tileCache.current.has(cacheKey) && !loadingTiles.current.has(cacheKey)) {
          loadingTiles.current.add(cacheKey);
          
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            tileCache.current.set(cacheKey, img);
            loadingTiles.current.delete(cacheKey);
            renderCanvas(); // Re-render when tile loads
          };
          img.onerror = () => {
            loadingTiles.current.delete(cacheKey);
            console.warn(`Failed to load tile: ${cacheKey}`);
          };
          img.src = tile.url;
        }
      });

      renderCanvas();

    } catch (err: any) {
      setError(err.message || 'Failed to load tiles');
    } finally {
      setLoading(false);
    }
  }, [recordingId, pyramid]);

  // Render tiles on canvas
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pyramid) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate scale factors
    const timeRange = viewport.endTimeMs - viewport.startTimeMs;
    const freqRange = viewport.maxFreqHz - viewport.minFreqHz;
    const timeScale = width / timeRange;
    const freqScale = height / freqRange;

    // Render tiles
    tiles.forEach((tile) => {
      const cacheKey = `${tile.x}_${tile.y}_${viewport.zoom}`;
      const img = tileCache.current.get(cacheKey);
      
      if (img) {
        // Calculate tile position on canvas
        const tileTimeMs = tile.x * pyramid.tileWidth * (1000 / pyramid.pxPerSec[viewport.zoom]);
        const tileFreqHz = pyramid.fmax - (tile.y * pyramid.tileHeight * (freqRange / pyramid.tileHeight));
        
        const canvasX = (tileTimeMs - viewport.startTimeMs) * timeScale;
        const canvasY = (pyramid.fmax - tileFreqHz - viewport.maxFreqHz) * freqScale;
        const canvasW = tile.width * timeScale / pyramid.pxPerSec[viewport.zoom] * 1000;
        const canvasH = tile.height * freqScale / pyramid.tileHeight * freqRange;

        // Only draw if tile is visible
        if (canvasX + canvasW >= 0 && canvasX <= width && 
            canvasY + canvasH >= 0 && canvasY <= height) {
          ctx.drawImage(img, canvasX, canvasY, canvasW, canvasH);
        }
      }
    });

    // Draw loading indicator
    if (loading) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'white';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Loading tiles...', width / 2, height / 2);
    }

  }, [tiles, viewport, pyramid, width, height, loading]);

  // Load tiles when viewport changes
  useEffect(() => {
    loadTilesForViewport(viewport);
  }, [viewport, loadTilesForViewport]);

  // Handle zoom
  const handleZoom = (delta: number, centerX: number) => {
    if (!pyramid) return;

    const newZoom = Math.max(0, Math.min(pyramid.zoomLevels.length - 1, viewport.zoom + delta));
    if (newZoom === viewport.zoom) return;

    // Calculate new time range maintaining center point
    const currentTimeRange = viewport.endTimeMs - viewport.startTimeMs;
    const zoomFactor = pyramid.pxPerSec[viewport.zoom] / pyramid.pxPerSec[newZoom];
    const newTimeRange = currentTimeRange * zoomFactor;
    
    const centerTimeMs = viewport.startTimeMs + (centerX / width) * currentTimeRange;
    const newStartTimeMs = Math.max(0, centerTimeMs - (centerX / width) * newTimeRange);
    const newEndTimeMs = newStartTimeMs + newTimeRange;

    setViewport(prev => ({
      ...prev,
      zoom: newZoom,
      startTimeMs: newStartTimeMs,
      endTimeMs: newEndTimeMs
    }));
  };

  // Handle pan
  const handlePan = (deltaX: number) => {
    const timeRange = viewport.endTimeMs - viewport.startTimeMs;
    const deltaTimeMs = (deltaX / width) * timeRange;
    
    setViewport(prev => ({
      ...prev,
      startTimeMs: Math.max(0, prev.startTimeMs - deltaTimeMs),
      endTimeMs: Math.max(timeRange, prev.endTimeMs - deltaTimeMs)
    }));
  };

  // Mouse event handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const centerX = e.clientX - rect.left;
    const zoomDelta = e.deltaY > 0 ? 1 : -1;
    handleZoom(zoomDelta, centerX);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startViewport = { ...viewport };

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const timeRange = startViewport.endTimeMs - startViewport.startTimeMs;
      const deltaTimeMs = (deltaX / width) * timeRange;
      
      setViewport({
        ...startViewport,
        startTimeMs: Math.max(0, startViewport.startTimeMs - deltaTimeMs),
        endTimeMs: Math.max(timeRange, startViewport.endTimeMs - deltaTimeMs)
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  // Notify parent of viewport changes
  useEffect(() => {
    if (onTimeRangeChange) {
      onTimeRangeChange(viewport.startTimeMs, viewport.endTimeMs);
    }
    if (onFrequencyRangeChange) {
      onFrequencyRangeChange(viewport.minFreqHz, viewport.maxFreqHz);
    }
  }, [viewport, onTimeRangeChange, onFrequencyRangeChange]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
        <div className="text-center">
          <p className="text-red-600 mb-2">Error loading spectrogram</p>
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="border border-gray-300 cursor-move"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ width: `${width}px`, height: `${height}px` }}
      />
      
      {/* Controls */}
      <div className="absolute top-2 right-2 bg-white bg-opacity-90 rounded p-2 text-xs">
        <div>Zoom: {viewport.zoom}</div>
        <div>Time: {(viewport.startTimeMs / 1000).toFixed(1)}s - {(viewport.endTimeMs / 1000).toFixed(1)}s</div>
        <div>Freq: {(viewport.minFreqHz / 1000).toFixed(1)}kHz - {(viewport.maxFreqHz / 1000).toFixed(1)}kHz</div>
        <div>Tiles: {tiles.length}</div>
      </div>
      
      {loading && (
        <div className="absolute inset-0 bg-black bg-opacity-25 flex items-center justify-center">
          <div className="bg-white rounded px-4 py-2">Loading tiles...</div>
        </div>
      )}
    </div>
  );
};
