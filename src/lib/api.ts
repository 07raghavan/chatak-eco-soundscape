// API Configuration
// Provider-agnostic: use env URL when provided, localhost in dev, same-origin by default in prod
export const API_BASE_URL: string = (() => {
  const envUrl = (import.meta as any)?.env?.VITE_API_BASE_URL || (import.meta as any)?.env?.VITE_BACKEND_URL;
  if (envUrl) return String(envUrl).replace(/\/$/, '');

  if (import.meta.env.DEV) {
    // Development: use localhost backend
    return 'http://localhost:3001';
  }

  // Production default: same-origin (requires reverse proxy at /api) if no env is set
  return '';
})();

// Helper function to make authenticated API requests
export const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
  const token = localStorage.getItem('chatak_token');
  
  const defaultOptions: RequestInit = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
    ...options,
  };

  console.log('[API] →', `${API_BASE_URL}${endpoint}`, defaultOptions.method || 'GET');
  const response = await fetch(`${API_BASE_URL}${endpoint}`, defaultOptions);
  
  if (!response.ok) {
    let errorData: any = null;
    try { errorData = await response.json(); } catch (_) { errorData = { error: 'Network error' }; }
    console.error('[API] ←', response.status, errorData);
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }
  const data = await response.json();
  console.log('[API] ← 200', data);
  return data;
};

// Recordings
export interface Recording {
  id: number;
  name: string;
  description: string;
  file_path: string;
  file_size: number;
  duration_seconds: number | null;
  recording_date: string;
  status: string;
  created_at: string;
  updated_at: string;
  site_name: string;
  site_latitude: number;
  site_longitude: number;
  file_url: string;
}

export const getRecordings = async (projectId: string): Promise<Recording[]> => {
  const data = await apiRequest(`/api/projects/${projectId}/recordings`, { method: 'GET' });
  return data.recordings as Recording[];
};

// Segmentation APIs
export const getSegmentationPresets = async (): Promise<Array<{ key: string; label: string; min_hz: number | null; max_hz: number | null; default_sr: number }>> => {
  const data = await apiRequest(`/api/segmentation/presets`, { method: 'GET' });
  return data.presets;
};

export const createSegmentationJob = async (
  recordingId: number,
  payload: {
    strategy?: 'fixed' | 'energy' | 'hybrid';
    seg_len_s?: number;
    overlap_pct?: number;
    min_hz?: number | null;
    max_hz?: number | null;
    preset_key?: string;
    sample_rate?: number;
    pipeline_version?: string;
  }
): Promise<{ recording_id: number; message: string; status: string }> => {
  return apiRequest(`/api/recordings/${recordingId}/segmentation/jobs`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

// Get background segmentation status
export const getBackgroundSegmentationStatus = async (recordingId: number) => {
  return apiRequest(`/api/recordings/${recordingId}/segmentation/status`, {
    method: 'GET',
  });
};

// Clear background segmentation status
export const clearBackgroundSegmentationStatus = async (recordingId: number) => {
  return apiRequest(`/api/recordings/${recordingId}/segmentation/status`, {
    method: 'DELETE',
  });
};

// Note: Job-related functions removed since we're using direct segmentation

export const getSegmentsForRecording = async (recordingId: number) => {
  const data = await apiRequest(`/api/recordings/${recordingId}/segments`, { method: 'GET' });
  return data.segments as any[];
};

// Single recording details
export const getRecordingById = async (recordingId: number): Promise<Recording> => {
  const data = await apiRequest(`/api/recordings/${recordingId}`, { method: 'GET' });
  return data.recording as Recording;
};

// Backward-compatible alias used by AEDAnalysisPage
export const getSegmentsByRecording = async (recordingId: number) => {
  return getSegmentsForRecording(recordingId);
};

// AED API functions
export const getAEDResultsForRecording = async (recordingId: number) => {
  const data = await apiRequest(`/api/recordings/${recordingId}/aed`, { method: 'GET' });
  return data.results as any[];
};

export const getROIsForSegment = async (segmentId: number) => {
  const data = await apiRequest(`/api/segments/${segmentId}/rois`, { method: 'GET' });
  return data.rois as any[];
};

// AED job enqueue
export const createAEDJobs = async (
  segmentIds: number[],
  params: {
    sample_rate: number;
    amplitude_threshold_db?: number;
    min_duration_ms?: number;
    max_duration_ms?: number;
    min_freq_hz?: number;
    max_freq_hz?: number;
  }
) => {
  return apiRequest(`/api/aed/jobs`, {
    method: 'POST',
    body: JSON.stringify({ segment_ids: segmentIds, params })
  });
};

// Job status API functions (duplicate removed - already defined above)

// Worker triggers
export const runSegmentationOnce = async () => {
  const data = await apiRequest(`/api/workers/segmentation/poll-once`, { method: 'POST' });
  return data;
};

export const runAEDOnce = async () => {
  const data = await apiRequest(`/api/workers/aed/poll-once`, { method: 'POST' });
  return data;
};

// Segment approval APIs
export const approveSegment = async (segmentId: number) => {
  return apiRequest(`/api/segments/${segmentId}/approve`, { method: 'POST' });
};

export const rejectSegment = async (segmentId: number, notes?: string) => {
  return apiRequest(`/api/segments/${segmentId}/reject`, { method: 'POST', body: JSON.stringify({ notes }) });
};

// Advanced AED API functions - REMOVED (using simple AED now)
/*
export const getAEDEventsByTimeRange = async (
  recordingId: number,
  options: {
    start_ms?: number;
    end_ms?: number;
    min_confidence?: number;
    max_confidence?: number;
    band_name?: string;
    limit?: number;
    offset?: number;
    include_duplicates?: boolean;
    sort_by?: string;
    sort_order?: 'ASC' | 'DESC';
  } = {}
) => {
  const params = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, value.toString());
    }
  });
  
  const data = await apiRequest(`/api/recordings/${recordingId}/aed-events?${params}`, { method: 'GET' });
  return data;
};
*/

/*
export const tagAEDEvent = async (
  eventId: string,
  tag: {
    label?: string;
    species?: string;
    verdict?: string;
    notes?: string;
    confidence_override?: number;
  }
) => {
  return apiRequest(`/api/aed-events/${eventId}/tag`, {
    method: 'POST',
    body: JSON.stringify(tag)
  });
};

export const getAEDSummary = async (recordingId: number) => {
  const data = await apiRequest(`/api/recordings/${recordingId}/aed-summary`, { method: 'GET' });
  return data;
};

export const getAudioRange = async (recordingId: number, startMs?: number, endMs?: number) => {
  const params = new URLSearchParams();
  if (startMs !== undefined) params.append('start_ms', startMs.toString());
  if (endMs !== undefined) params.append('end_ms', endMs.toString());
  
  const data = await apiRequest(`/api/recordings/${recordingId}/audio-range?${params}`, { method: 'GET' });
  return data;
};
*/

/*
export const getAEDConfigs = async (projectId: number, speciesType?: string) => {
  const params = new URLSearchParams();
  if (speciesType) params.append('species_type', speciesType);
  
  const data = await apiRequest(`/api/projects/${projectId}/aed-configs?${params}`, { method: 'GET' });
  return data.configs;
};

export const createAEDConfig = async (
  projectId: number,
  config: {
    config_name: string;
    species_type: string;
    config_json: object;
    site_id?: number;
    is_default?: boolean;
  }
) => {
  return apiRequest(`/api/projects/${projectId}/aed-configs`, {
    method: 'POST',
    body: JSON.stringify(config)
  });
};
*/

// Real Spectrogram API functions - COMMENTED OUT FOR NOW
/*
export const getSpectrogramIndex = async (recordingId: number) => {
  const data = await apiRequest(`/api/recordings/${recordingId}/spectrogram/index`, { method: 'GET' });
  return data;
};
*/

/*
export const getSpectrogramTile = async (recordingId: number, zoom: number, x: number, y: number) => {
  const data = await apiRequest(`/api/recordings/${recordingId}/spectrogram/tiles/${zoom}/${x}/${y}`, { method: 'GET' });
  return data;
};

export const generateSpectrogram = async (recordingId: number, forceRegenerate = false) => {
  return apiRequest(`/api/recordings/${recordingId}/spectrogram/generate`, {
    method: 'POST',
    body: JSON.stringify({ force_regenerate: forceRegenerate })
  });
};

export const getSpectrogramStatus = async (recordingId: number) => {
  const data = await apiRequest(`/api/recordings/${recordingId}/spectrogram/status`, { method: 'GET' });
  return data;
};

export const getAEDEventsForViewport = async (
  recordingId: number,
  options: {
    start_ms?: number;
    end_ms?: number;
    min_freq_hz?: number;
    max_freq_hz?: number;
    min_confidence?: number;
    zoom_level?: number;
  } = {}
) => {
  const params = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, value.toString());
    }
  });
  
  const data = await apiRequest(`/api/recordings/${recordingId}/viewport-events?${params}`, { method: 'GET' });
  return data;
};
*/

// =================
// NEW AED API FUNCTIONS
// =================

/**
 * Enqueue AED for all approved segments in a recording
 */
export const enqueueAEDForRecording = async (recordingId: number) => {
  return apiRequest(`/api/aed/recordings/${recordingId}/aed/enqueue`, {
    method: 'POST'
  });
};

/**
 * Run AED synchronously for selected segments
 */
export const runAEDNow = async (recordingId: number, segmentIds: number[]) => {
  return apiRequest(`/api/aed/recordings/${recordingId}/aed/run-now`, {
    method: 'POST',
    body: JSON.stringify({ segmentIds })
  });
};

/**
 * Run industry-standard AED for entire recording
 */
export const runIndustryAEDForRecording = async (recordingId: number, config: object = {}) => {
  return apiRequest(`/api/aed/recordings/${recordingId}/aed/industry-standard`, {
    method: 'POST',
    body: JSON.stringify({ config })
  });
};

// Helper function to get token
const getToken = () => localStorage.getItem('chatak_token');

/**
 * Run optimized high-speed AED for entire recording with progress streaming
 */
export const runOptimizedAEDForRecording = async (
  recordingId: number,
  config: object = {},
  onProgress?: (percent: number, message: string) => void
) => {
  const response = await fetch(`${API_BASE_URL}/api/aed/recordings/${recordingId}/aed/optimized`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({ config })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result = null;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            if (data.progress !== undefined && onProgress) {
              onProgress(data.progress, data.message || '');
            }
            
            if (data.complete && data.result) {
              result = data.result;
            }
            
            if (data.error) {
              throw new Error(data.error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  return result;
};

/**
 * Run optimized AED for all segments (development/testing - no approval required)
 */
export const runOptimizedAEDForAllSegments = async (
  recordingId: number,
  config: object = {},
  onProgress?: (percent: number, message: string) => void
) => {
  const response = await fetch(`${API_BASE_URL}/api/aed/recordings/${recordingId}/aed/optimized-all-segments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({ config })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result = null;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.slice(6));
            
            if (data.progress !== undefined && onProgress) {
              onProgress(data.progress, data.message || '');
            }
            
            if (data.complete && data.result) {
              result = data.result;
            }
            
            if (data.error) {
              throw new Error(data.error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  return result;
};

/**
 * Generate spectrogram pyramid for a recording
 */
export const generateSpectrogram = async (recordingId: number, config: object = {}) => {
  return apiRequest(`/api/recordings/${recordingId}/spectrogram/generate`, {
    method: 'POST',
    body: JSON.stringify({ config })
  });
};

/**
 * Get spectrogram pyramid metadata
 */
export const getSpectrogramIndex = async (recordingId: number) => {
  return apiRequest(`/api/recordings/${recordingId}/spectrogram`, { method: 'GET' });
};

/**
 * Get spectrogram status
 */
export const getSpectrogramStatus = async (recordingId: number) => {
  return apiRequest(`/api/recordings/${recordingId}/spectrogram/status`, { method: 'GET' });
};

/**
 * Get spectrogram tile (returns S3 signed URL)
 */
export const getSpectrogramTile = async (recordingId: number, zoom: number, x: number, y: number) => {
  return apiRequest(`/api/recordings/${recordingId}/spectrogram/tiles/${zoom}/${x}/${y}`, { method: 'GET' });
};

/**
 * Get AED events for viewport (for ROI display in spectrogram)
 */
export const getAEDEventsForViewport = async (
  recordingId: number,
  options: {
    start_ms?: number;
    end_ms?: number;
    min_freq_hz?: number;
    max_freq_hz?: number;
    min_confidence?: number;
    zoom_level?: number;
    limit?: number;
  } = {}
) => {
  const params = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, value.toString());
    }
  });
  
  return apiRequest(`/api/recordings/${recordingId}/viewport-events?${params}`, { method: 'GET' });
};

export const getApprovedSegments = async (recordingId: number) => {
  const data = await apiRequest(`/api/recordings/${recordingId}/approved-segments`, { method: 'GET' });
  // Backend returns segments directly, not wrapped in an object
  return Array.isArray(data) ? data : (data.segments || []);
};

export const getAEDEventsForSegment = async (segmentId: number) => {
  const data = await apiRequest(`/api/segments/${segmentId}/aed-events`, { method: 'GET' });
  return data.events as any[];
};

export const getAEDEventsForRecording = async (recordingId: number): Promise<any[]> => {
  const data = await apiRequest(`/api/aed/recordings/${recordingId}/aed-events`, { method: 'GET' });
  return data.events || [];
};

/**
 * Tag/annotate an AED event
 */
export const tagAEDEvent = async (
  eventId: string,
  tag: {
    label: string;
    species?: string;
    verdict?: string;
    notes?: string;
    confidence_override?: number;
  }
) => {
  return apiRequest(`/api/events/${eventId}/tag`, {
    method: 'POST',
    body: JSON.stringify(tag)
  });
};

/**
 * Get AED configurations for a project
 */
export const getAEDConfigs = async (projectId: number, speciesType?: string) => {
  const params = new URLSearchParams();
  if (speciesType) params.append('species_type', speciesType);
  
  return apiRequest(`/api/projects/${projectId}/configs?${params}`, { method: 'GET' });
};

/**
 * Create AED configuration
 */
export const createAEDConfig = async (
  projectId: number,
  config: {
    config_name: string;
    species_type: string;
    config_json: object;
    site_id?: number;
    is_default?: boolean;
  }
) => {
  return apiRequest(`/api/projects/${projectId}/configs`, {
    method: 'POST',
    body: JSON.stringify(config)
  });
};

/**
 * Update AED configuration
 */
export const updateAEDConfig = async (
  configId: number,
  updates: {
    config_name?: string;
    config_json?: object;
    is_default?: boolean;
    is_active?: boolean;
  }
) => {
  return apiRequest(`/api/configs/${configId}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
};

/**
 * Delete AED configuration
 */
export const deleteAEDConfig = async (configId: number) => {
  return apiRequest(`/api/configs/${configId}`, { method: 'DELETE' });
};

// =================
// FAST SPECTROGRAM API FUNCTIONS
// =================

/**
 * Generate fast spectrogram with AED ROI overlays using Python service
 */
export const generateFastSpectrogram = async (
  recordingId: number, 
  config: {
    n_fft?: number;
    hop_length?: number;
    n_mels?: number;
    fmin?: number;
    fmax?: number;
    power?: number;
    db_range?: number;
    colormap?: string;
    width_inches?: number;
    height_inches?: number;
    dpi?: number;
    min_confidence?: number;
    include_bands?: string[];
    force_regenerate?: boolean;
  } = {},
  onProgress?: (percent: number, message: string) => void
) => {
  const response = await fetch(`${API_BASE_URL}/api/recordings/${recordingId}/fast-spectrogram/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({
      config,
      min_confidence: config.min_confidence || 0.15,
      include_bands: config.include_bands || ['low_freq', 'mid_freq', 'high_freq'],
      force_regenerate: config.force_regenerate || false
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to generate fast spectrogram');
  }

  // Handle streaming response with progress updates
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let result = null;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.progress !== undefined && onProgress) {
                onProgress(data.progress, data.message || '');
              }
              
              if (data.result) {
                result = data.result;
              }
              
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (parseError) {
              console.warn('Failed to parse progress data:', parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  return result;
};

/**
 * Get existing fast spectrogram for a recording
 */
export const getFastSpectrogram = async (recordingId: number) => {
  return apiRequest(`/api/recordings/${recordingId}/fast-spectrogram`, { method: 'GET' });
};

// =================
// SEGMENT SPECTROGRAM API FUNCTIONS
// =================

/**
 * Generate spectrograms for all segments of a recording
 */
export const generateSegmentSpectrograms = async (
  recordingId: number,
  config: {
    n_fft?: number;
    hop_length?: number;
    n_mels?: number;
    fmin?: number;
    fmax?: number;
    power?: number;
    db_range?: number;
    colormap?: string;
    width_inches?: number;
    height_inches?: number;
    dpi?: number;
    min_confidence?: number;
    include_bands?: string[];
    force_regenerate?: boolean;
  } = {},
  onProgress?: (data: {
    message: string;
    total_segments: number;
    completed_segments: number;
    progress: number;
    timestamp: string;
  }) => void
) => {
  const response = await fetch(`${API_BASE_URL}/api/recordings/${recordingId}/segment-spectrograms/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`
    },
    body: JSON.stringify({
      config,
      min_confidence: config.min_confidence || 0.15,
      include_bands: config.include_bands || ['low_freq', 'mid_freq', 'high_freq'],
      force_regenerate: config.force_regenerate || false
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || 'Failed to generate segment spectrograms');
  }

  // Handle streaming response with progress updates
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let finalResult = null;

  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              
              if (onProgress && !data.completed) {
                onProgress(data);
              }
              
              if (data.completed) {
                finalResult = data;
              }
              
              if (data.error) {
                throw new Error(data.error);
              }
            } catch (parseError) {
              console.warn('Failed to parse progress data:', parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  return finalResult;
};

/**
 * Get segment spectrograms for a recording
 */
export const getSegmentSpectrograms = async (recordingId: number) => {
  return apiRequest(`/api/recordings/${recordingId}/segment-spectrograms`, { method: 'GET' });
};

/**
 * Get approved segments for a recording (used for spectogram generation)
 */
export const getApprovedSegmentsForSpectrogram = async (recordingId: number) => {
  const segments = await getApprovedSegments(recordingId);
  return segments.map((segment: any) => ({
    ...segment,
    duration_seconds: (segment.duration_ms || 0) / 1000,
    start_seconds: (segment.start_ms || 0) / 1000,
    end_seconds: (segment.end_ms || 0) / 1000
  }));
};

// Get audio snippet signed URL from backend
export const getAudioSnippetSignedUrl = async (snippetKey: string): Promise<string> => {
  const data = await apiRequest(`/api/aed/audio-snippets/${encodeURIComponent(snippetKey)}/signed-url`, { method: 'GET' });
  return data.signedUrl;
};

// Get AED status for a recording
export const getAEDStatus = async (recordingId: number) => {
  const data = await apiRequest(`/api/aed/recordings/${recordingId}/aed`, { method: 'GET' });
  return data;
};

// Get AED events for a recording with optional filtering
export const getAEDEvents = async (
  recordingId: number,
  options: {
    start_ms?: number;
    end_ms?: number;
    min_confidence?: number;
    max_confidence?: number;
    band_name?: string;
    limit?: number;
    offset?: number;
  } = {}
) => {
  const params = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, value.toString());
    }
  });

  const data = await apiRequest(`/api/aed/recordings/${recordingId}/aed-events?${params}`, { method: 'GET' });
  return data.events as any[];
};

// Get AED summary for a recording
export const getAEDSummary = async (recordingId: number) => {
  const data = await apiRequest(`/api/aed/recordings/${recordingId}/aed-summary`, { method: 'GET' });
  return data;
};
