import { useState, useRef, useEffect } from 'react';
import { Upload, Mic, Play, Pause, Trash2, Clock, MapPin, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Site {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  description: string;
}

interface AudioUploadComponentProps {
  projectId: string;
  sites: Site[];
  onUploadComplete?: () => void;
}

import { API_BASE_URL } from "@/lib/api";
import { uploadAudioFile, formatFileSize, isFileSupported, type UploadProgressCallback } from "@/lib/directUpload";

const AudioUploadComponent = ({ projectId, sites, onUploadComplete }: AudioUploadComponentProps) => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [audioPreview, setAudioPreview] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    siteId: '',
    recordingDate: new Date().toISOString().split('T')[0]
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Use the new validation from directUpload
    if (!isFileSupported(file.name)) {
      setError('Invalid file type. Supported formats: WAV, MP3, FLAC, M4A, AAC, OGG, WMA');
      return;
    }

    const maxSize = 500 * 1024 * 1024; // 500MB (updated limit)
    if (file.size > maxSize) {
      setError(`File size too large. Maximum size is ${formatFileSize(maxSize)}.`);
      return;
    }

    setSelectedFile(file);
    setError('');
    setUploadStatus('idle');
    
    const previewUrl = URL.createObjectURL(file);
    setAudioPreview(previewUrl);

    const audio = new Audio(previewUrl);
    audio.addEventListener('loadedmetadata', () => {
      setDuration(audio.duration);
    });

    if (!formData.name) {
      setFormData(prev => ({
        ...prev,
        name: file.name.replace(/\.[^/.]+$/, '')
      }));
    }
  };

  const handlePlayPause = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile || !formData.siteId) {
      setError('Please select a file and a site.');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadStatus('uploading');
    setError('');

    // Progress callback for direct upload
    const onProgress: UploadProgressCallback = (progress) => {
      setUploadProgress(progress.percentage);

      // Update status message based on stage
      if (progress.stage === 'preparing') {
        setUploadStatus('uploading');
      } else if (progress.stage === 'uploading') {
        setUploadStatus('uploading');
      } else if (progress.stage === 'completing') {
        setUploadStatus('uploading');
      } else if (progress.stage === 'completed') {
        setUploadStatus('success');
      }
    };

    try {
      // Use direct S3 upload
      const result = await uploadAudioFile(
        selectedFile,
        parseInt(projectId),
        parseInt(formData.siteId),
        formData.description,
        formData.recordingDate,
        onProgress
      );

      if (!result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      setUploadStatus('success');
      setUploadProgress(100);

      // Reset form
      setSelectedFile(null);
      setAudioPreview(null);
      setFormData({
        name: '',
        description: '',
        siteId: '',
        recordingDate: new Date().toISOString().split('T')[0]
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      if (onUploadComplete) {
        onUploadComplete();
      }

      // Reset status after 3 seconds
      setTimeout(() => {
        setUploadStatus('idle');
        setUploadProgress(0);
      }, 3000);

    } catch (error) {
      console.error('Upload error:', error);
      setError(error instanceof Error ? error.message : 'Upload failed');
      setUploadStatus('error');
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setAudioPreview(null);
    setDuration(0);
    setError('');
    setUploadStatus('idle');
    setUploadProgress(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-coral/20 bg-gradient-to-br from-coral/5 to-orange-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-coral">
            <Upload className="w-5 h-5" />
            Upload Audio Recording
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* File Selection */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="audioFile" className="text-sm font-medium">
                Select Audio File *
              </Label>
              <div className="mt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  id="audioFile"
                  accept="audio/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-coral/30 text-coral hover:bg-coral/10"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Choose Audio File
                </Button>
              </div>
            </div>

            {selectedFile && (
              <div className="border border-coral/20 rounded-lg p-4 bg-coral/5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Mic className="w-4 h-4 text-coral" />
                    <span className="font-medium">{selectedFile.name}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={removeFile}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
                
                <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground mb-3">
                  <div>
                    <span className="font-medium">Size:</span> {formatFileSize(selectedFile.size)}
                  </div>
                  <div>
                    <span className="font-medium">Duration:</span> {formatDuration(duration)}
                  </div>
                </div>

                {/* Audio Preview */}
                {audioPreview && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Preview</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handlePlayPause}
                        className="border-coral/30 text-coral hover:bg-coral/10"
                      >
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                      <audio
                        ref={audioRef}
                        src={audioPreview}
                        onEnded={() => setIsPlaying(false)}
                        className="hidden"
                      />
                      <span className="text-sm text-muted-foreground">
                        {formatDuration(duration)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Upload Progress */}
          {uploadStatus === 'uploading' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-coral">Uploading...</span>
                <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2 bg-coral/20">
                <div 
                  className="h-full bg-gradient-to-r from-coral to-orange-500 transition-all duration-300 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </Progress>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-coral"></div>
                Processing audio file...
              </div>
            </div>
          )}

          {/* Success State */}
          {uploadStatus === 'success' && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                Audio recording uploaded successfully! 🎉
              </AlertDescription>
            </Alert>
          )}

          {/* Error State */}
          {uploadStatus === 'error' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name" className="text-sm font-medium">
                  Recording Name *
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1"
                  required
                />
              </div>

              <div>
                <Label htmlFor="siteId" className="text-sm font-medium">
                  Site *
                </Label>
                <Select
                  value={formData.siteId}
                  onValueChange={(value) => setFormData({ ...formData, siteId: value })}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select a site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((site) => (
                      <SelectItem key={site.id} value={site.id.toString()}>
                        <div className="flex items-center gap-2">
                          <MapPin className="w-3 h-3" />
                          {site.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label htmlFor="description" className="text-sm font-medium">
                Description
              </Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="mt-1"
                rows={3}
                placeholder="Describe this recording..."
              />
            </div>

            <div>
              <Label htmlFor="recordingDate" className="text-sm font-medium">
                Recording Date
              </Label>
              <Input
                id="recordingDate"
                type="date"
                value={formData.recordingDate}
                onChange={(e) => setFormData({ ...formData, recordingDate: e.target.value })}
                className="mt-1"
              />
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={isUploading || !selectedFile || !formData.siteId || !formData.name}
              className="w-full bg-coral hover:bg-coral/90 text-white"
            >
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Recording
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AudioUploadComponent; 