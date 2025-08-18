import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Download, X, Eye, Clock, Zap } from 'lucide-react';

interface SpectrogramModalProps {
  isOpen: boolean;
  onClose: () => void;
  spectrogram: {
    id: number;
    segment_id: number;
    recording_id: number;
    image_url?: string;
    aed_events_count: number;
    generation_time_ms?: number;
    file_size_bytes?: number;
    start_ms: number;
    end_ms: number;
    duration_ms: number;
    status: string;
  } | null;
  segment?: {
    id: number;
    start_ms: number;
    end_ms: number;
    duration_ms: number;
  } | null;
  events?: Array<{
    id: number;
    start_ms: number;
    end_ms: number;
    f_min_hz?: number;
    f_max_hz?: number;
    confidence: number;
    label?: string;
  }>;
}

export const SpectrogramModal: React.FC<SpectrogramModalProps> = ({
  isOpen,
  onClose,
  spectrogram,
  segment,
  events = []
}) => {
  if (!spectrogram || !isOpen) return null;

  const formatTime = (ms: number) => {
    const seconds = ms / 1000;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(1);
    return `${mins}:${secs.padStart(4, '0')}`;
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = async () => {
    if (!spectrogram.image_url) return;
    
    try {
      const response = await fetch(spectrogram.image_url);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `segment-${spectrogram.segment_id}-spectrogram.png`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Failed to download spectrogram:', error);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-[95vw] max-h-[95vh] w-auto h-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <Eye className="w-5 h-5" />
                Segment {spectrogram.segment_id} Spectrogram
              </DialogTitle>
              <DialogDescription className="mt-2">
                {segment && (
                  <>
                    Time: {formatTime(segment.start_ms)} - {formatTime(segment.end_ms)} 
                    ({formatDuration(segment.duration_ms)})
                  </>
                )}
              </DialogDescription>
            </div>
            
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleDownload}
                disabled={!spectrogram.image_url}
              >
                <Download className="w-4 h-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Main Spectrogram Image */}
        <div className="flex flex-col space-y-4">
          {spectrogram.image_url ? (
            <div className="bg-black rounded-lg overflow-hidden border">
              <img
                src={spectrogram.image_url}
                alt={`Segment ${spectrogram.segment_id} Spectrogram`}
                className="w-full h-auto max-w-[90vw] max-h-[70vh] object-contain"
                style={{ 
                  imageRendering: 'crisp-edges',
                  display: 'block',
                  margin: '0 auto'
                }}
                onError={(e) => {
                  console.error('Failed to load spectrogram image');
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 bg-gray-50 rounded-lg">
              <span className="text-gray-500">No spectrogram image available</span>
            </div>
          )}

          {/* Metadata and Events */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
            {/* Spectrogram Info */}
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">Spectrogram Info</h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-1">
                  <Eye className="w-3 h-3" />
                  <span>{spectrogram.aed_events_count} events detected</span>
                </div>
                {spectrogram.generation_time_ms && (
                  <div className="flex items-center gap-1">
                    <Zap className="w-3 h-3" />
                    <span>{(spectrogram.generation_time_ms / 1000).toFixed(1)}s generation</span>
                  </div>
                )}
                {spectrogram.file_size_bytes && (
                  <div className="flex items-center gap-1">
                    <span>Size: {formatFileSize(spectrogram.file_size_bytes)}</span>
                  </div>
                )}
                <div className="flex items-center gap-1">
                  <span>Status: </span>
                  <Badge variant={spectrogram.status === 'completed' ? 'default' : 'secondary'}>
                    {spectrogram.status}
                  </Badge>
                </div>
              </div>
            </div>

            {/* AED Events */}
            <div className="space-y-3">
              <h3 className="font-semibold text-sm">
                Detected Events ({events.length})
              </h3>
              {events.length > 0 ? (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {events.map((event, index) => (
                    <div 
                      key={event.id || index} 
                      className="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
                    >
                      <div className="space-y-1">
                        <div className="font-medium">Event #{index + 1}</div>
                        <div className="text-gray-600">
                          {formatTime(event.start_ms)} - {formatTime(event.end_ms)}
                        </div>
                        {event.f_min_hz && event.f_max_hz && (
                          <div className="text-gray-600">
                            {event.f_min_hz.toFixed(0)} - {event.f_max_hz.toFixed(0)} Hz
                          </div>
                        )}
                      </div>
                      <div className="text-right space-y-1">
                        <div>
                          <Badge variant="outline" className="text-xs">
                            {event.confidence?.toFixed(2) || 'N/A'}
                          </Badge>
                        </div>
                        {event.label && (
                          <div className="text-gray-500">{event.label}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-gray-500 italic">
                  No events detected in this segment
                </div>
              )}
            </div>
          </div>

          {/* Help Text */}
          <div className="text-xs text-gray-500 text-center pt-2 border-t">
            💡 Orange boxes on the spectrogram show detected acoustic events with their frequency ranges and timing
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SpectrogramModal;
