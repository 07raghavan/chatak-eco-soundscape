import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';

// Ensure ffmpeg path
ffmpeg.setFfmpegPath(path.join(process.cwd(), 'bin', 'ffmpeg.exe'));

/**
 * High-Performance Acoustic Event Detection System
 * Optimized for speed with parallel processing, optimized FFT, and reduced I/O overhead
 * FIXED: All critical logical and algorithmic issues
 */
export class OptimizedAED {
  constructor(config = {}) {
    this.config = {
      // STFT Parameters - FIXED: Proper FFT sizing
      nFFT: 1024,          // FFT size (must be power of 2)
      hopMs: 5,            // Keep fine temporal resolution for birds (critical!)
      winMs: 25,           
      
      // Feature complexity - increased from original optimized version
      nMels: 128,          // Increased mel bins for bird vocalization detection
      
      // Detection parameters - Will be dynamically adapted based on audio
      baselineWindowSec: 60,     // Default, will adapt 30-120s based on audio variability
      adaptiveWindowSec: 3,      // Keep short for local adaptation

      // Hysteresis thresholds - FIXED: Proper dB-based thresholds
      onsetThresholdDb: 6.0,     // K_on threshold in dB
      offsetThresholdDb: 3.0,    // K_off threshold in dB (must be < K_on)

      // Streaming processing parameters
      chunkDurationSec: 120,     // Process in 120s chunks
      chunkOverlapSec: 1,        // 1s overlap between chunks

      // Enhanced feature parameters
      enableLogMel: true,        // Use log-mel features for stability
      enableSpectralWhitening: true, // Optional spectral whitening
      melFilterBanks: 64,        // 64-128 mel bins as suggested

      // Dynamic adaptation parameters
      enableDynamicAdaptation: true,    // Enable audio-aware parameter adaptation
      adaptationAnalysisWindowSec: 30,  // Initial analysis window
      reAnalysisIntervalSec: 300,       // Re-analyze environment every 5 minutes
      adaptationSmoothingFactor: 0.3,   // Smooth parameter changes (0=no change, 1=instant)
      noiseFloorPercentile: 10,         // Use 10th percentile as noise floor
      signalPercentile: 90,             // Use 90th percentile as signal level
      outlierRejectionThreshold: 3.0,   // Reject outliers beyond 3 sigma for SNR estimation
      
      // Event constraints - better suited for bird calls
      minDurationMs: 50,    // Reduced to catch short bird calls
      maxDurationMs: 8000,  // Lower maximum
      mergeGapMs: 100,      // Reduced for better event separation in birds
      
      // Bird-optimized frequency bands - FIXED: Proper frequency ranges
      targetBands: [
        { name: 'low_freq', fmin: 500, fmax: 2000 },     // Important for many birds  
        { name: 'mid_freq', fmin: 2000, fmax: 8000 },    // Critical bird vocalization range
        { name: 'high_freq', fmin: 8000, fmax: 16000 }   // High-frequency bird calls
      ],
      
      // Performance optimizations
      enableParallelProcessing: true,
      maxWorkers: Math.min(4, os.cpus().length), // Limit workers to avoid memory issues
      enableBatchAudioLoading: true,
      enableOptimizedFFT: true,
      enableProgressTracking: true,
      
      // Enable key features needed for birds but with optimized implementations
      useSpectralNovelty: true,
      useOnsetDetection: true,
      useEnergyEntropy: true,
      
      // FIXED: Add missing config for spectral novelty
      onsetThresholdSigma: 2.0,  // Standard deviations above mean for novelty detection
      
      ...config
    };

    // Progress callback
    this.onProgress = null;
    
    // FIXED: Pre-compute mel filter bank for efficiency
    this.melFilters = null;
    this.melFilterBankSampleRate = null;
  }

  setProgressCallback(callback) {
    this.onProgress = callback;
  }

  /**
   * High-speed processing with parallel segment analysis
   * FIXED: Proper timing coordinate system
   */
  async runForRecording(recordingId, approvedSegments, options = {}) {
    console.log(`🚀 Starting optimized AED for recording ${recordingId} with ${approvedSegments.length} segments`);
    
    if (approvedSegments.length === 0) return [];

    this.reportProgress(0, 'Initializing...');
    
    // Debug: Log segment information
    approvedSegments.forEach((segment, idx) => {
      console.log(`📊 Segment ${idx + 1}: ID=${segment.id}, start=${segment.start_ms}ms, duration=${segment.duration_ms}ms`);
    });
    
    // Batch load all audio files in parallel
    const audioDataMap = await this.batchLoadAudio(approvedSegments);
    this.reportProgress(20, 'Audio loaded...');
    
    // Process segments in parallel batches
    const allEvents = [];
    const batchSize = this.config.maxWorkers;
    
    for (let i = 0; i < approvedSegments.length; i += batchSize) {
      const batch = approvedSegments.slice(i, i + batchSize);
      const batchProgress = 20 + ((i / approvedSegments.length) * 60);
      
      this.reportProgress(batchProgress, `Processing batch ${Math.floor(i/batchSize) + 1}...`);
      
      const batchPromises = batch.map(async (segment) => {
        const audioData = audioDataMap.get(segment.id);
        if (!audioData) return [];
        
        console.log(`🎵 Processing segment ${segment.id}: ${audioData.samples.length} samples at ${audioData.sampleRate}Hz`);
        
        const events = await this.detectForSegmentOptimized(segment, audioData);
        
        console.log(`✅ Segment ${segment.id}: detected ${events.length} events`);
        
        // FIXED: Clear timing coordinate system with proper validation
        return events.map(event => {
          // Validate timing values
          const startMs = Number(event.start_ms) || 0;
          const endMs = Number(event.end_ms) || 0;
          const segmentStartMs = Number(segment.start_ms) || 0;
          
          if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || !Number.isFinite(segmentStartMs)) {
            console.warn(`⚠️ Invalid timing values for event: start=${startMs}, end=${endMs}, segment_start=${segmentStartMs}`);
            return null;
          }
          
          // Ensure end time is after start time
          if (endMs <= startMs) {
            console.warn(`⚠️ Invalid event duration: start=${startMs}ms, end=${endMs}ms`);
            return null;
          }
          
          // FIXED: Proper timing coordinate system
          const eventWithTiming = {
          ...event,
            // Segment-relative timing (0ms to segment duration) - for audio playback
            start_ms: startMs,
            end_ms: endMs,
          segment_id: segment.id,
            
            // FIXED: Calculate absolute recording timing correctly
            absolute_start_ms: segmentStartMs + startMs,
            absolute_end_ms: segmentStartMs + endMs,
            
            // Clear metadata
            timing_system: 'segment_relative',
            recording_id: recordingId
          };
          
          console.log(`🎯 Event: segment-relative ${startMs}ms-${endMs}ms, absolute ${eventWithTiming.absolute_start_ms}ms-${eventWithTiming.absolute_end_ms}ms`);
          
          return eventWithTiming;
        }).filter(Boolean); // Remove null events
      });
      
      const batchResults = await Promise.all(batchPromises);
      allEvents.push(...batchResults.flat());
    }
    
    console.log(`📊 Total events detected: ${allEvents.length}`);
    
    this.reportProgress(80, 'Merging events...');
    
    // FIXED: Apply deduplication before merging
    const deduplicatedEvents = await this.applyDeduplication(allEvents);
    
    // Fast merge of nearby events
    const mergedEvents = this.fastMergeEvents(deduplicatedEvents);
    
    console.log(`📊 After deduplication: ${deduplicatedEvents.length} events`);
    console.log(`📊 After merging: ${mergedEvents.length} events`);
    
    // NEW: Apply post-processing filters and refinements
    const postProcessedEvents = this.postProcessEvents(mergedEvents);
    
    console.log(`📊 After post-processing: ${postProcessedEvents.length} events`);
    
    this.reportProgress(90, 'Saving to database...');
    
    // Batch insert events
    const storedEvents = await this.batchInsertEvents(recordingId, postProcessedEvents);
    
    this.reportProgress(100, 'Complete!');
    
    console.log(`✅ Optimized AED completed: ${storedEvents.length} events detected`);
    return storedEvents;
  }

  /**
   * Apply deduplication to remove cross-segment duplicates
   * FIXED: Properly integrates with database deduplication fields
   */
  async applyDeduplication(events) {
    if (events.length <= 1) return events;
    
    console.log(`🔍 Applying deduplication to ${events.length} events...`);
    
    // Sort by absolute start time for efficient processing
    events.sort((a, b) => a.absolute_start_ms - b.absolute_start_ms);
    
    const uniqueEvents = [];
    const duplicateEvents = [];
    
    for (let i = 0; i < events.length; i++) {
      const current = events[i];
      let isDuplicate = false;
      let duplicateInfo = null;
      
      // Check against previous events within overlap window
      for (let j = i - 1; j >= 0; j--) {
        const previous = events[j];
        
        // Skip if too far back in time
        if (current.absolute_start_ms - previous.absolute_end_ms > 5000) break;
        
        // Calculate temporal and frequency overlap
        const temporalIoU = this.calculateTemporalIoU(current, previous);
        const frequencyIoU = this.calculateFrequencyIoU(current, previous);
        
        // Check if this is a duplicate
        if (temporalIoU > 0.5 && frequencyIoU > 0.5) {
          // Resolve which event to keep
          const resolution = this.resolveDuplicate(current, previous);
          
          if (resolution.keep === current) {
            // Mark previous as duplicate
            duplicateEvents.push({
              ...previous,
              duplicate_of: current.id,
              temporal_iou: temporalIoU,
              frequency_iou: frequencyIoU,
              dedup_confidence: resolution.confidence
            });
          } else {
            // Mark current as duplicate
            isDuplicate = true;
            duplicateInfo = {
              duplicate_of: previous.id,
              temporal_iou: temporalIoU,
              frequency_iou: frequencyIoU,
              dedup_confidence: resolution.confidence
            };
            break;
          }
        }
      }
      
      if (!isDuplicate) {
        uniqueEvents.push(current);
      } else {
        // Add duplicate info to the event
        duplicateEvents.push({
          ...current,
          ...duplicateInfo
        });
      }
    }
    
    console.log(`✅ Deduplication complete: ${uniqueEvents.length} unique events, ${duplicateEvents.length} duplicates`);
    
    // Store both unique and duplicate events (duplicates will be marked in database)
    return [...uniqueEvents, ...duplicateEvents];
  }

  /**
   * Calculate temporal IoU between two events
   */
  calculateTemporalIoU(event1, event2) {
    const start1 = event1.absolute_start_ms;
    const end1 = event1.absolute_end_ms;
    const start2 = event2.absolute_start_ms;
    const end2 = event2.absolute_end_ms;

    const intersectionStart = Math.max(start1, start2);
    const intersectionEnd = Math.min(end1, end2);
    const intersection = Math.max(0, intersectionEnd - intersectionStart);

    const duration1 = end1 - start1;
    const duration2 = end2 - start2;
    const union = duration1 + duration2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Calculate frequency IoU between two events
   */
  calculateFrequencyIoU(event1, event2) {
    const fmin1 = event1.f_min_hz || 0;
    const fmax1 = event1.f_max_hz || 0;
    const fmin2 = event2.f_min_hz || 0;
    const fmax2 = event2.f_max_hz || 0;

    if (fmax1 <= fmin1 || fmax2 <= fmin2) return 0;

    const intersectionMin = Math.max(fmin1, fmin2);
    const intersectionMax = Math.min(fmax1, fmax2);
    const intersection = Math.max(0, intersectionMax - intersectionMin);

    const range1 = fmax1 - fmin1;
    const range2 = fmax2 - fmin2;
    const union = range1 + range2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Resolve duplicate events - keep the better one
   */
  resolveDuplicate(event1, event2) {
    const confidence1 = event1.confidence || 0;
    const confidence2 = event2.confidence || 0;
    const snr1 = event1.snr_db || 0;
    const snr2 = event2.snr_db || 0;
    
    // Composite score: confidence + SNR + duration preference
    const duration1 = event1.end_ms - event1.start_ms;
    const duration2 = event2.end_ms - event2.start_ms;
    const durationScore1 = Math.min(1.0, duration1 / 1000);
    const durationScore2 = Math.min(1.0, duration2 / 1000);
    
    const score1 = (confidence1 * 0.7) + (snr1 / 60 * 0.2) + (durationScore1 * 0.1);
    const score2 = (confidence2 * 0.7) + (snr2 / 60 * 0.2) + (durationScore2 * 0.1);

    if (score1 >= score2) {
      return {
        keep: event1,
        duplicate: event2,
        confidence: Math.min(1.0, Math.abs(score1 - score2) + 0.5)
      };
    } else {
      return {
        keep: event2,
        duplicate: event1,
        confidence: Math.min(1.0, Math.abs(score2 - score1) + 0.5)
      };
    }
  }

  /**
   * Batch load audio for multiple segments to reduce I/O overhead
   */
  async batchLoadAudio(segments) {
    const { downloadFile } = await import('../config/s3.js');
    const audioDataMap = new Map();
    
    // Download all files in parallel
    const downloadPromises = segments.map(async (segment) => {
      try {
        const tempIn = path.join(process.cwd(), 'temp_ffmpeg', `seg_${segment.id}.flac`);
        const tempRaw = path.join(process.cwd(), 'temp_ffmpeg', `seg_${segment.id}.raw`);
        
        const fs = await import('fs');
        fs.mkdirSync(path.dirname(tempIn), { recursive: true });
        
        // Download file
        await downloadFile(segment.s3_key, tempIn);
        
        // Convert to raw audio
        await new Promise((resolve, reject) => {
          ffmpeg(tempIn)
            .audioChannels(1)
            .format('f32le')
            .output(tempRaw)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });

        // Load samples
        const rawBuffer = fs.readFileSync(tempRaw);
        const samples = new Float32Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength / 4);
        
        audioDataMap.set(segment.id, {
          samples,
          sampleRate: segment.sample_rate || 32000
        });
        
        // Cleanup
        try { fs.unlinkSync(tempIn); } catch {}
        try { fs.unlinkSync(tempRaw); } catch {}
        
      } catch (error) {
        console.error(`Failed to load audio for segment ${segment.id}:`, error);
      }
    });
    
    await Promise.all(downloadPromises);
    return audioDataMap;
  }

  /**
   * Enhanced streaming detection with dynamic parameter adaptation
   * Analyzes audio characteristics and adapts parameters accordingly
   * FIXED: Proper timing coordinate system and audio snippet extraction
   */
  async detectForSegmentOptimized(segment, audioData) {
    const { samples, sampleRate } = audioData;
    if (!samples || samples.length === 0) return [];

    // Analyze audio characteristics and adapt parameters dynamically
    const audioProfile = this.config.enableDynamicAdaptation
      ? await this.analyzeAudioCharacteristics(samples, sampleRate)
      : null;

    // Extract features with adaptive parameters
    const features = await this.extractEnhancedFeatures(samples, sampleRate, audioProfile);
    
    // Detect events using spectral novelty
    const rawEvents = this.detectOptimizedSpectralNovelty(features);
    
    // Filter and merge events
    const filteredEvents = this.filterOptimizedEvents(rawEvents, features, audioProfile);
    
    // FIXED: Convert frame-based events to time-based events with PROPER segment-relative timing
    const timeEvents = filteredEvents.map(event => {
      // FIXED: Use segment-relative timing (0ms to segment duration)
      const startMs = Math.round(event.start_ms || 0);
      const endMs = Math.round(event.end_ms || 0);
      
      // Validate timing is within segment bounds
      const segmentDurationMs = Math.floor((samples.length / sampleRate) * 1000);
      const validStartMs = Math.max(0, Math.min(startMs, segmentDurationMs));
      const validEndMs = Math.max(validStartMs + 50, Math.min(endMs, segmentDurationMs)); // Min 50ms duration
      
      return {
        start_ms: validStartMs,  // FIXED: Segment-relative timing (0ms to segment duration)
        end_ms: validEndMs,      // FIXED: Segment-relative timing (0ms to segment duration)
        confidence: event.confidence || 0.5,
        snr_db: event.snr_db || 0,
        f_min_hz: event.f_min_hz || 0,
        f_max_hz: event.f_max_hz || 0,
        peak_freq_hz: event.peak_freq_hz || 0,
        band_name: event.band_name || 'unknown'
      };
    });

    // FIXED: Generate audio snippets for detected events with proper timing
    const eventsWithSnippets = await Promise.all(
      timeEvents.map(async (event) => {
        try {
          console.log(`🎵 Generating snippet for event: ${event.start_ms}ms - ${event.end_ms}ms (duration: ${event.end_ms - event.start_ms}ms)`);
          
          // FIXED: Pass segment-relative timing to audio snippet generation
          const snippetS3Key = await this.generateAudioSnippet(
            segment, 
            event.start_ms,  // Segment-relative start time
            event.end_ms,    // Segment-relative end time
            samples,         // Full segment audio data
            sampleRate
          );
          
          console.log(`🎵 Snippet result for event: ${snippetS3Key ? 'SUCCESS' : 'FAILED'} - ${snippetS3Key || 'No key generated'}`);
          
          return {
            ...event,
            snippet_s3_key: snippetS3Key
          };
        } catch (error) {
          console.error(`❌ Failed to generate snippet for event ${event.start_ms}ms - ${event.end_ms}ms:`, error);
          return event; // Return event without snippet
        }
      })
    );
    
    // Summary of snippet generation
    const successfulSnippets = eventsWithSnippets.filter(event => event.snippet_s3_key).length;
    console.log(`📊 Audio snippet generation summary: ${successfulSnippets}/${timeEvents.length} events have snippets`);
    
    return eventsWithSnippets;
  }

  /**
   * Generate audio snippet for a detected event
   * FIXED: Proper segment-relative timing and audio extraction
   */
  async generateAudioSnippet(segment, startMs, endMs, samples, sampleRate) {
    try {
      console.log(`🎵 Starting audio snippet generation for segment ${segment.id}: ${startMs}ms - ${endMs}ms`);
      
      const { uploadFile } = await import('../config/s3.js');
      const fs = await import('fs');
      const path = await import('path');
      
      // FIXED: Validate segment-relative timing
      const segmentDurationMs = Math.floor((samples.length / sampleRate) * 1000);
      
      console.log(`🎵 Segment info: duration=${segmentDurationMs}ms, samples=${samples.length}, sampleRate=${sampleRate}Hz`);
      
      if (startMs < 0 || endMs <= startMs || endMs > segmentDurationMs) {
        console.warn(`⚠️ Invalid segment-relative timing: ${startMs}ms - ${endMs}ms, segment duration: ${segmentDurationMs}ms`);
        return null;
      }
      
      // FIXED: Calculate sample indices for segment-relative timing
      const startSample = Math.floor((startMs / 1000) * sampleRate);
      const endSample = Math.floor((endMs / 1000) * sampleRate);
      
      console.log(`🎵 Sample range: ${startSample} - ${endSample} (total samples: ${samples.length})`);
      
      // FIXED: Better validation and bounds checking
      if (startSample >= endSample) {
        console.warn(`⚠️ Invalid sample range: start >= end (${startSample} >= ${endSample})`);
        return null;
      }
      
      if (startSample >= samples.length) {
        console.warn(`⚠️ Start sample beyond audio length: ${startSample} >= ${samples.length}`);
        return null;
      }
      
      // FIXED: Clamp end sample to available audio length
      const clampedEndSample = Math.min(endSample, samples.length);
      if (clampedEndSample <= startSample) {
        console.warn(`⚠️ No valid samples after clamping: start=${startSample}, end=${clampedEndSample}`);
        return null;
      }
      
      console.log(`🎵 Using clamped sample range: ${startSample} - ${clampedEndSample} (original end: ${endSample})`);
      
      // FIXED: Extract the correct audio snippet from segment data using clamped range
      const snippetSamples = samples.slice(startSample, clampedEndSample);
      
      if (snippetSamples.length === 0) {
        console.warn(`⚠️ No samples for snippet: ${startMs}ms - ${endMs}ms`);
        return null;
      }

      // Validate the extracted snippet duration
      const actualDurationMs = Math.floor((snippetSamples.length / sampleRate) * 1000);
      const expectedDurationMs = endMs - startMs;
      const actualEndMs = startMs + actualDurationMs;
      
      console.log(`🎵 Snippet validation: expected=${expectedDurationMs}ms, actual=${actualDurationMs}ms, samples=${snippetSamples.length}`);
      console.log(`🎵 Timing: start=${startMs}ms, expected_end=${endMs}ms, actual_end=${actualEndMs}ms`);
      
      if (Math.abs(actualDurationMs - expectedDurationMs) > 50) {
        console.warn(`⚠️ Duration mismatch: expected ${expectedDurationMs}ms, got ${actualDurationMs}ms (clamped due to audio length)`);
      }

      console.log(`🎵 Generating snippet: ${startMs}ms - ${endMs}ms (${snippetSamples.length} samples)`);

      // Create temporary file for the snippet
      const tempDir = path.join(process.cwd(), 'temp_ffmpeg');
      const tempSnippet = path.join(tempDir, `snippet_${segment.id}_${startMs}_${endMs}.wav`);
      
      console.log(`🎵 Temp files: dir=${tempDir}, snippet=${tempSnippet}`);
      
      // Ensure temp directory exists
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
        console.log(`🎵 Created temp directory: ${tempDir}`);
      }

      // Convert Float32Array to WAV file using ffmpeg
      const ffmpeg = await import('fluent-ffmpeg');
      
      // Set ffmpeg path to use local bin version
      const ffmpegPath = path.join(process.cwd(), 'backend', 'bin', 'ffmpeg.exe');
      
      // Check if ffmpeg exists
      if (!fs.existsSync(ffmpegPath)) {
        console.error(`❌ FFmpeg not found at: ${ffmpegPath}`);
        throw new Error(`FFmpeg executable not found at ${ffmpegPath}`);
      }
      
      ffmpeg.setFfmpegPath(ffmpegPath);
      
      console.log(`🎵 Using ffmpeg from: ${ffmpegPath}`);
      
      // Write raw audio data to temporary file
      const rawFile = tempSnippet.replace('.wav', '.raw');
      const buffer = Buffer.from(snippetSamples.buffer, snippetSamples.byteOffset, snippetSamples.byteLength);
      fs.writeFileSync(rawFile, buffer);
      
      console.log(`🎵 Wrote raw file: ${rawFile} (${buffer.length} bytes)`);

      // Convert to WAV using ffmpeg with proper settings
      console.log(`🎵 Converting to WAV with ffmpeg...`);
      await new Promise((resolve, reject) => {
        ffmpeg(rawFile)
          .inputFormat('f32le')
          .audioChannels(1)
          .audioFrequency(sampleRate)
          .output(tempSnippet)
          .on('end', () => {
            console.log(`🎵 FFmpeg conversion completed: ${tempSnippet}`);
            
            // Validate the generated WAV file
            if (fs.existsSync(tempSnippet)) {
              const stats = fs.statSync(tempSnippet);
              console.log(`🎵 Generated WAV file: ${tempSnippet} (${stats.size} bytes)`);
              
              // Check if file has reasonable size (should be > 44 bytes for WAV header)
              if (stats.size < 44) {
                console.error(`❌ Generated WAV file is too small: ${stats.size} bytes`);
                reject(new Error('Generated WAV file is too small'));
                return;
              }
            }
            
            resolve();
          })
          .on('error', (err) => {
            console.error(`❌ FFmpeg conversion failed:`, err);
            reject(err);
          })
          .run();
      });

      // Generate S3 key for the snippet
      const snippetS3Key = `snippets/project-${segment.project_id || 1}/segment-${segment.id}/event_${startMs}_${endMs}.wav`;
      
      console.log(`🎵 Uploading to S3: ${snippetS3Key}`);
      
      // Upload to S3
      await uploadFile(tempSnippet, snippetS3Key);
      
      console.log(`✅ Successfully uploaded to S3: ${snippetS3Key}`);
      
      // Cleanup temporary files
      try { fs.unlinkSync(rawFile); } catch {}
      try { fs.unlinkSync(tempSnippet); } catch {}
      
      console.log(`✅ Generated audio snippet: ${snippetS3Key} (${snippetSamples.length} samples, ${actualDurationMs}ms)`);
      return snippetS3Key;
      
    } catch (error) {
      console.error(`❌ Failed to generate audio snippet:`, error);
      
      // Fallback: Try to generate a simple WAV file without ffmpeg
      try {
        console.log(`🔄 Trying fallback audio snippet generation...`);
        return await this.generateSimpleWavSnippet(segment, startMs, endMs, samples, sampleRate);
      } catch (fallbackError) {
        console.error(`❌ Fallback audio snippet generation also failed:`, fallbackError);
        return null;
      }
    }
  }
  
  /**
   * Fallback method to generate WAV snippet without ffmpeg
   * NEW: Simple WAV generation for when ffmpeg is not available
   */
  async generateSimpleWavSnippet(segment, startMs, endMs, samples, sampleRate) {
    try {
      const { uploadFile } = await import('../config/s3.js');
      const fs = await import('fs');
      const path = await import('path');
      
      console.log(`🎵 Generating simple WAV snippet for segment ${segment.id}: ${startMs}ms - ${endMs}ms`);
      
      // Calculate sample indices
      const startSample = Math.floor((startMs / 1000) * sampleRate);
      const endSample = Math.floor((endMs / 1000) * sampleRate);
      
      // FIXED: Better validation and bounds checking
      if (startSample >= endSample) {
        console.warn(`⚠️ Invalid sample range: start >= end (${startSample} >= ${endSample})`);
        return null;
      }
      
      if (startSample >= samples.length) {
        console.warn(`⚠️ Start sample beyond audio length: ${startSample} >= ${samples.length}`);
        return null;
      }
      
      // FIXED: Clamp end sample to available audio length
      const clampedEndSample = Math.min(endSample, samples.length);
      if (clampedEndSample <= startSample) {
        console.warn(`⚠️ No valid samples after clamping: start=${startSample}, end=${clampedEndSample}`);
        return null;
      }
      
      console.log(`🎵 Simple snippet using clamped sample range: ${startSample} - ${clampedEndSample} (original end: ${endSample})`);
      
      const snippetSamples = samples.slice(startSample, clampedEndSample);
      
      if (snippetSamples.length === 0) {
        console.warn(`⚠️ No samples for simple snippet: ${startMs}ms - ${endMs}ms`);
        return null;
      }
      
      // Validate the extracted snippet duration
      const actualDurationMs = Math.floor((snippetSamples.length / sampleRate) * 1000);
      const expectedDurationMs = endMs - startMs;
      const actualEndMs = startMs + actualDurationMs;
      
      console.log(`🎵 Simple snippet validation: expected=${expectedDurationMs}ms, actual=${actualDurationMs}ms, samples=${snippetSamples.length}`);
      console.log(`🎵 Simple snippet timing: start=${startMs}ms, expected_end=${endMs}ms, actual_end=${actualEndMs}ms`);
      
      if (Math.abs(actualDurationMs - expectedDurationMs) > 50) {
        console.warn(`⚠️ Simple snippet duration mismatch: expected ${expectedDurationMs}ms, got ${actualDurationMs}ms (clamped due to audio length)`);
      }
      
      // Create WAV file header
      const wavHeader = this.createWavHeader(snippetSamples.length, sampleRate, 1, 16);
      
      // Convert Float32Array to 16-bit PCM
      const pcmData = new Int16Array(snippetSamples.length);
      for (let i = 0; i < snippetSamples.length; i++) {
        // Convert float32 (-1 to 1) to int16 (-32768 to 32767)
        pcmData[i] = Math.max(-32768, Math.min(32767, Math.round(snippetSamples[i] * 32767)));
      }
      
      // Combine header and data
      const wavBuffer = Buffer.concat([
        Buffer.from(wavHeader),
        Buffer.from(pcmData.buffer)
      ]);
      
      console.log(`🎵 Simple WAV buffer: header=${wavHeader.length} bytes, data=${pcmData.buffer.byteLength} bytes, total=${wavBuffer.length} bytes`);
      
      // Create temporary file
      const tempDir = path.join(process.cwd(), 'temp_ffmpeg');
      const tempSnippet = path.join(tempDir, `simple_snippet_${segment.id}_${startMs}_${endMs}.wav`);
      
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Write WAV file
      fs.writeFileSync(tempSnippet, wavBuffer);
      console.log(`🎵 Created simple WAV file: ${tempSnippet} (${wavBuffer.length} bytes)`);
      
      // Validate the generated file
      if (fs.existsSync(tempSnippet)) {
        const stats = fs.statSync(tempSnippet);
        if (stats.size !== wavBuffer.length) {
          console.error(`❌ File size mismatch: expected ${wavBuffer.length} bytes, got ${stats.size} bytes`);
          throw new Error('File size mismatch');
        }
      }
      
      // Generate S3 key and upload
      const snippetS3Key = `snippets/project-${segment.project_id || 1}/segment-${segment.id}/simple_event_${startMs}_${endMs}.wav`;
      
      console.log(`🎵 Uploading simple snippet to S3: ${snippetS3Key}`);
      await uploadFile(tempSnippet, snippetS3Key);
      
      // Cleanup
      try { fs.unlinkSync(tempSnippet); } catch {}
      
      console.log(`✅ Generated simple audio snippet: ${snippetS3Key} (${snippetSamples.length} samples, ${actualDurationMs}ms)`);
      return snippetS3Key;
      
    } catch (error) {
      console.error(`❌ Failed to generate simple WAV snippet:`, error);
      return null;
    }
  }
  
  /**
   * Create WAV file header
   * NEW: Helper method for simple WAV generation
   */
  createWavHeader(dataLength, sampleRate, channels, bitsPerSample) {
    const buffer = Buffer.alloc(44);
    
    // Calculate byte rate and block align
    const byteRate = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const dataSize = dataLength * 2; // 16-bit samples = 2 bytes per sample
    const fileSize = 36 + dataSize;
    
    console.log(`🎵 WAV header calculations: dataLength=${dataLength}, sampleRate=${sampleRate}, channels=${channels}, bitsPerSample=${bitsPerSample}`);
    console.log(`🎵 WAV header calculations: byteRate=${byteRate}, blockAlign=${blockAlign}, dataSize=${dataSize}, fileSize=${fileSize}`);
    
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(fileSize, 4); // File size
    buffer.write('WAVE', 8);
    
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28); // Byte rate
    buffer.writeUInt16LE(blockAlign, 32); // Block align
    buffer.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40); // Data size
    
    return buffer;
  }

  /**
   * Enhanced feature extraction with log-mel and optional spectral whitening
   * More stable features for adaptive thresholding
   * FIXED: FFT size mismatch and mel frequency mapping
   */
  extractEnhancedFeatures(samples, sampleRate, carryOverBaseline = null) {
    console.log(`🎵 Extracting features: ${samples.length} samples at ${sampleRate}Hz`);

    const hopSamples = Math.floor((this.config.hopMs * sampleRate) / 1000);
    const winSamples = Math.floor((this.config.winMs * sampleRate) / 1000);
    const nFrames = Math.max(0, Math.floor((samples.length - winSamples) / hopSamples) + 1);

    console.log(`📊 Frame params: hop=${hopSamples}, win=${winSamples}, frames=${nFrames}`);

    if (nFrames <= 0) {
      console.warn('⚠️ No frames to process');
      return null;
    }

    // FIXED: STFT with proper frame sizing
    const spectrogram = this.computeOptimizedSTFT(samples, winSamples, hopSamples);
    if (!spectrogram) {
      console.warn('⚠️ STFT computation failed');
      return null;
    }

    // FIXED: Enhanced mel-scale conversion with proper frequency mapping
    const melSpectrogram = this.computeEnhancedMelSpectrogram(spectrogram, sampleRate);
    if (!melSpectrogram) {
      console.warn('⚠️ Mel spectrogram computation failed');
      return null;
    }

    console.log(`✅ Mel spectrogram: ${melSpectrogram.length} mel bins × ${melSpectrogram[0]?.length || 0} frames`);

    // Apply log-mel transformation for stability
    const logMelSpectrogram = this.config.enableLogMel
      ? this.applyLogMelTransform(melSpectrogram)
      : melSpectrogram;

    // Optional spectral whitening for better noise robustness
    const whitenedSpectrogram = this.config.enableSpectralWhitening
      ? this.applySpectralWhitening(logMelSpectrogram)
      : logMelSpectrogram;

    // Additional features needed for bird detection
    const spectralNovelty = this.config.useSpectralNovelty
      ? this.computeOptimizedSpectralNovelty(whitenedSpectrogram)
      : null;

    const energyEntropy = this.config.useEnergyEntropy
      ? this.computeOptimizedEnergyEntropy(whitenedSpectrogram)
      : null;

    // Add band energies for multi-band detection
    const bandEnergies = this.computeOptimizedBandEnergies(spectrogram, sampleRate);

    return {
      mel: whitenedSpectrogram,
      nFrames,
      frameDurationMs: this.config.hopMs,
      sampleRate,
      spectralNovelty,
      energyEntropy,
      bandEnergies,
      carryOverBaseline
    };
  }

  /**
   * Enhanced mel-spectrogram with configurable number of mel bins
   * FIXED: Proper mel-scale frequency mapping
   */
  computeEnhancedMelSpectrogram(spectrogram, sampleRate) {
    if (!spectrogram || spectrogram.length === 0 || !spectrogram[0]) {
      console.warn('⚠️ Invalid spectrogram for mel conversion');
      return null;
    }

    const nMels = this.config.melFilterBanks || this.config.nMels;
    const nFreqBins = spectrogram.length;
    const nFrames = spectrogram[0].length;

    console.log(`🎼 Computing mel spectrogram: ${nFreqBins} freq bins → ${nMels} mel bins`);

    // FIXED: Create mel filter bank with proper frequency mapping
    const melFilters = this.createMelFilterBank(nFreqBins, sampleRate, nMels);
    if (!melFilters) {
      console.warn('⚠️ Failed to create mel filter bank');
      return null;
    }

    console.log(`🔧 Mel filter bank created: ${nMels} filters for ${nFreqBins} frequency bins`);

    // Apply mel filters
    const melSpectrogram = [];
    for (let m = 0; m < nMels; m++) {
      melSpectrogram[m] = new Float32Array(nFrames);
      for (let t = 0; t < nFrames; t++) {
        let melEnergy = 0;
        for (let f = 0; f < nFreqBins; f++) {
          const spectrogramValue = spectrogram[f][t];
          const filterValue = melFilters[m][f];
          if (Number.isFinite(spectrogramValue) && Number.isFinite(filterValue)) {
            melEnergy += spectrogramValue * filterValue;
          }
        }
        melSpectrogram[m][t] = Math.max(melEnergy, 1e-10); // Prevent zero/negative values
      }
    }

    // Validate output
    let validMelBins = 0;
    for (let m = 0; m < nMels; m++) {
      let hasValidData = false;
      for (let t = 0; t < nFrames; t++) {
        if (melSpectrogram[m][t] > 1e-9) {
          hasValidData = true;
          break;
        }
      }
      if (hasValidData) validMelBins++;
    }

    console.log(`✅ Mel spectrogram computed: ${validMelBins}/${nMels} mel bins have valid data`);

    if (validMelBins === 0) {
      console.warn('⚠️ No valid mel bins - all energy may be zero');
      return null;
    }

    return melSpectrogram;
  }

  /**
   * FIXED: Create mel filter bank with proper frequency mapping
   */
  createMelFilterBank(nFreqBins, sampleRate, nMels) {
    // FIXED: Use proper mel-scale frequency mapping
    const melToHz = (mel) => 700 * (Math.pow(10, mel / 2595) - 1);
    const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
    
    const nyquist = sampleRate / 2;
    const melMin = hzToMel(0);
    const melMax = hzToMel(nyquist);
    
    // Create mel points
    const melPoints = [];
    for (let i = 0; i <= nMels + 1; i++) {
      melPoints.push(melMin + (melMax - melMin) * i / (nMels + 1));
    }
    
    // Convert back to Hz
    const hzPoints = melPoints.map(melToHz);
    
    // Create filter bank
    const filters = [];
    for (let m = 0; m < nMels; m++) {
      filters[m] = new Float32Array(nFreqBins);
      
      for (let f = 0; f < nFreqBins; f++) {
        const freqHz = (f / nFreqBins) * nyquist;
        
        // Triangular filter response
        if (freqHz >= hzPoints[m] && freqHz <= hzPoints[m + 2]) {
          if (freqHz <= hzPoints[m + 1]) {
            filters[m][f] = (freqHz - hzPoints[m]) / (hzPoints[m + 1] - hzPoints[m]);
          } else {
            filters[m][f] = (hzPoints[m + 2] - freqHz) / (hzPoints[m + 2] - hzPoints[m + 1]);
          }
        } else {
          filters[m][f] = 0;
        }
      }
    }
    
    return filters;
  }

  /**
   * Process a single audio chunk with memory-efficient algorithms
   */
  async processAudioChunk(samples, sampleRate, timeOffsetMs = 0, carryOverBaseline = null, adaptedConfig = null) {
    // Store original config before any processing
    const originalConfig = this.config;

    try {
      console.log(`🔧 Processing audio chunk: ${samples?.length || 'undefined'} samples, offset=${timeOffsetMs}ms`);

      // Validate inputs
      if (!samples) {
        console.warn('⚠️ Samples is undefined in processAudioChunk');
        return [];
      }

      if (!samples.length) {
        console.warn('⚠️ Samples array is empty in processAudioChunk');
        return [];
      }

      // Use adapted config if provided, otherwise use default
      const config = adaptedConfig || this.config;

      // Temporarily use adapted config
      if (adaptedConfig) {
        this.config = adaptedConfig;
      }

      // Enhanced feature extraction with log-mel and optional spectral whitening
      console.log('🎵 Extracting enhanced features...');
      const features = this.extractEnhancedFeatures(samples, sampleRate, carryOverBaseline);
      if (!features) {
        console.warn('⚠️ Feature extraction returned null');
        return [];
      }

    // Combine multiple detection methods with enhanced algorithms
    const allEvents = [];

    // Method 1: Enhanced per-band energy detection with hysteresis
    const energyEvents = this.detectEnergyEventsOptimized(features);
    allEvents.push(...energyEvents.map(e => ({
      ...e,
      detection_method: 'energy_hysteresis',
      start_ms: e.start_ms + timeOffsetMs,
      end_ms: e.end_ms + timeOffsetMs
    })));

    // Method 2: Spectral novelty detection (critical for birds)
    if (this.config.useSpectralNovelty && features.spectralNovelty) {
      const noveltyEvents = this.detectOptimizedSpectralNovelty(features);
      allEvents.push(...noveltyEvents.map(e => ({
        ...e,
        detection_method: 'spectral_novelty',
        start_ms: e.start_ms + timeOffsetMs,
        end_ms: e.end_ms + timeOffsetMs
      })));
    }

    // Method 3: Onset detection (if enabled)
    if (this.config.useOnsetDetection) {
      const onsetEvents = this.detectOptimizedOnsets(features);
      allEvents.push(...onsetEvents.map(e => ({
        ...e,
        detection_method: 'onset_detection',
        start_ms: e.start_ms + timeOffsetMs,
        end_ms: e.end_ms + timeOffsetMs
      })));
    }

      // Filter and refine events
      console.log(`🔍 Filtering ${allEvents.length} raw events...`);
      const filteredEvents = this.filterAndRefineEvents(allEvents);
      console.log(`✅ Audio chunk processed: ${filteredEvents.length} final events`);
      return filteredEvents;

    } catch (error) {
      console.error('❌ Error in processAudioChunk:', error);
      console.error('Stack trace:', error.stack);
      console.error('Samples info:', {
        samplesType: typeof samples,
        samplesLength: samples?.length,
        sampleRate,
        timeOffsetMs
      });
      return [];
    } finally {
      // Restore original config
      if (adaptedConfig) {
        this.config = originalConfig;
      }
    }
  }

  /**
   * Merge events that span chunk boundaries
   */
  mergeChunkBoundaryEvents(allEvents) {
    if (allEvents.length <= 1) return allEvents;

    // Sort events by start time
    allEvents.sort((a, b) => a.start_ms - b.start_ms);

    const merged = [];
    let current = allEvents[0];

    for (let i = 1; i < allEvents.length; i++) {
      const next = allEvents[i];

      // Check if events are close enough to merge (within overlap region)
      const gap = next.start_ms - current.end_ms;
      if (gap <= this.config.chunkOverlapSec * 1000 &&
          Math.abs(current.f_min_hz - next.f_min_hz) < 500) { // Same frequency band

        // Merge events
        current = {
          ...current,
          end_ms: Math.max(current.end_ms, next.end_ms),
          confidence: Math.max(current.confidence, next.confidence),
          snr_db: Math.max(current.snr_db, next.snr_db),
          detection_method: `${current.detection_method}+${next.detection_method}`
        };
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);

    return merged;
  }

  /**
   * Fast event merging without complex overlap analysis
   */
  fastMergeEvents(events) {
    if (events.length === 0) return [];
    
    events.sort((a, b) => a.start_ms - b.start_ms);
    
    const merged = [];
    let current = { ...events[0] };
    
    for (let i = 1; i < events.length; i++) {
      const next = events[i];
      const gap = next.start_ms - current.end_ms;
      
      if (gap <= this.config.mergeGapMs) {
        // Simple merge
        current.end_ms = next.end_ms;
        current.confidence = Math.max(current.confidence || 0, next.confidence || 0);
        if ((next.snr_db || -Infinity) > (current.snr_db || -Infinity)) {
          current.snr_db = next.snr_db;
          current.peak_freq_hz = next.peak_freq_hz;
          current.band_name = next.band_name;
        }
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    
    merged.push(current);
    return merged;
  }

  /**
   * Filter and refine detected events
   * FIXED: Added missing method that was referenced but not implemented
   */
  filterOptimizedEvents(events, features, audioProfile) {
    if (!events || events.length === 0) return [];
    
    // First merge similar events (often detected by different methods)
    const merged = this.mergeOverlappingEvents(events);
    
    // Then filter by duration and confidence
    return merged.filter(event => {
      const duration = event.end_ms - event.start_ms;
      return duration >= this.config.minDurationMs && 
             duration <= this.config.maxDurationMs &&
             (event.confidence || 0) >= 0.15;  // Lower confidence threshold to catch more bird calls
    });
  }
  
  /**
   * Merge events that have significant overlap
   */
  mergeOverlappingEvents(events) {
    if (events.length <= 1) return events;
    
    // Sort by start time
    events.sort((a, b) => a.start_ms - b.start_ms);
    
    const merged = [];
    let current = { ...events[0] };
    
    for (let i = 1; i < events.length; i++) {
      const next = events[i];
      
      // Check if events overlap significantly
      const overlapStart = Math.max(current.start_ms, next.start_ms);
      const overlapEnd = Math.min(current.end_ms, next.end_ms);
      const overlapDuration = overlapEnd - overlapStart;
      const currentDuration = current.end_ms - current.start_ms;
      const nextDuration = next.end_ms - next.start_ms;
      
      // If overlap is significant, merge the events
      if (overlapDuration > 0 && 
          (overlapDuration / currentDuration > 0.3 || 
           overlapDuration / nextDuration > 0.3)) {
        
        // Create merged event with best properties from both
        current.start_ms = Math.min(current.start_ms, next.start_ms);
        current.end_ms = Math.max(current.end_ms, next.end_ms);
        current.confidence = Math.max(current.confidence || 0, next.confidence || 0);
        
        // Keep frequency bounds if available
        if (next.f_min_hz !== undefined && current.f_min_hz !== undefined) {
          current.f_min_hz = Math.min(current.f_min_hz, next.f_min_hz);
        }
        if (next.f_max_hz !== undefined && current.f_max_hz !== undefined) {
          current.f_max_hz = Math.max(current.f_max_hz, next.f_max_hz);
        }
        
        // Keep the higher SNR data
        if ((next.snr_db || -Infinity) > (current.snr_db || -Infinity)) {
          current.snr_db = next.snr_db;
          current.peak_freq_hz = next.peak_freq_hz;
        }
        
        // If the events come from different detection methods, note that
        if (current.detection_method && next.detection_method && 
            current.detection_method !== next.detection_method) {
          current.detection_method = `multi_method`;
        }
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    
    merged.push(current);
    return merged;
  }

  /**
   * Batch insert events to reduce database overhead
   * FIXED: Properly handles deduplication fields and audio snippets
   */
  async batchInsertEvents(recordingId, events) {
    if (events.length === 0) return [];
    
    // Clear existing events for this recording
    await db.query(`DELETE FROM aed_events WHERE recording_id = :recordingId`, {
      replacements: { recordingId },
      type: QueryTypes.DELETE
    });
    
    // Batch insert - prepare values with all fields including deduplication
    const values = events.map((event, idx) => ({
      recordingId: recordingId,
      segmentId: event.segment_id,
      startMs: event.start_ms,                    // Relative timing (0ms to segment duration)
      endMs: event.end_ms,                        // Relative timing (0ms to segment duration)
      absoluteStartMs: event.absolute_start_ms || event.start_ms,  // Absolute timing (fallback)
      absoluteEndMs: event.absolute_end_ms || event.end_ms,        // Absolute timing (fallback)
      fmin: event.f_min_hz || null,
      fmax: event.f_max_hz || null,
      peak: event.peak_freq_hz || null,
      snr: event.snr_db || null,
      conf: event.confidence || 0.5,
      method: 'optimized-v1',
      version: '1.0',
      snippetS3Key: event.snippet_s3_key || null,  // Audio snippet S3 key
      // FIXED: Add deduplication fields
      duplicateOf: event.duplicate_of || null,
      temporalIou: event.temporal_iou || null,
      frequencyIou: event.frequency_iou || null,
      dedupConfidence: event.dedup_confidence || null
    }));
    
    // Build batch insert query with deduplication fields
    const placeholders = values.map((_, idx) => 
      `(:recordingId${idx}, :segmentId${idx}, :startMs${idx}, :endMs${idx}, :absoluteStartMs${idx}, :absoluteEndMs${idx}, :fmin${idx}, :fmax${idx}, :peak${idx}, :snr${idx}, :conf${idx}, :method${idx}, :version${idx}, :snippetS3Key${idx}, :duplicateOf${idx}, :temporalIou${idx}, :frequencyIou${idx}, :dedupConfidence${idx})`
    ).join(', ');
    
    const replacements = {};
    values.forEach((v, idx) => {
      replacements[`recordingId${idx}`] = v.recordingId;
      replacements[`segmentId${idx}`] = v.segmentId;
      replacements[`startMs${idx}`] = v.startMs;
      replacements[`endMs${idx}`] = v.endMs;
      replacements[`absoluteStartMs${idx}`] = v.absoluteStartMs;
      replacements[`absoluteEndMs${idx}`] = v.absoluteEndMs;
      replacements[`fmin${idx}`] = v.fmin;
      replacements[`fmax${idx}`] = v.fmax;
      replacements[`peak${idx}`] = v.peak;
      replacements[`snr${idx}`] = v.snr;
      replacements[`conf${idx}`] = v.conf;
      replacements[`method${idx}`] = v.method;
      replacements[`version${idx}`] = v.version;
      replacements[`snippetS3Key${idx}`] = v.snippetS3Key;
      // FIXED: Add deduplication field replacements
      replacements[`duplicateOf${idx}`] = v.duplicateOf;
      replacements[`temporalIou${idx}`] = v.temporalIou;
      replacements[`frequencyIou${idx}`] = v.frequencyIou;
      replacements[`dedupConfidence${idx}`] = v.dedupConfidence;
    });
    
    const insertedEvents = await db.query(`
      INSERT INTO aed_events (
        recording_id, segment_id, start_ms, end_ms, absolute_start_ms, absolute_end_ms, 
        f_min_hz, f_max_hz, peak_freq_hz, snr_db, confidence, method, method_version, snippet_s3_key,
        duplicate_of, temporal_iou, frequency_iou, dedup_confidence
      ) VALUES ${placeholders}
      RETURNING *
    `, {
      replacements,
      type: QueryTypes.INSERT
    });
    
    // Batch insert tags
    const tagValues = insertedEvents[0].map((row, idx) => ({
      eventId: row.id,
      label: events[idx].band_name || 'auto',
      verdict: events[idx].duplicate_of ? 'duplicate' : 'detected',
      notes: events[idx].duplicate_of 
        ? `Duplicate of event ${events[idx].duplicate_of} (temporal IoU: ${events[idx].temporal_iou?.toFixed(3)}, frequency IoU: ${events[idx].frequency_iou?.toFixed(3)})`
        : `Optimized method v1.0`
    }));
    
    const tagPlaceholders = tagValues.map((_, idx) => 
      `(:eventId${idx}, :label${idx}, :verdict${idx}, :notes${idx})`
    ).join(', ');
    
    const tagReplacements = {};
    tagValues.forEach((v, idx) => {
      tagReplacements[`eventId${idx}`] = v.eventId;
      tagReplacements[`label${idx}`] = v.label;
      tagReplacements[`verdict${idx}`] = v.verdict;
      tagReplacements[`notes${idx}`] = v.notes;
    });
    
    await db.query(`
      INSERT INTO aed_event_tags (event_id, label, verdict, notes)
      VALUES ${tagPlaceholders}
    `, {
      replacements: tagReplacements,
      type: QueryTypes.INSERT
    });
    
    console.log(`✅ Database insertion complete: ${insertedEvents[0].length} events stored`);
    return insertedEvents[0];
  }

  /**
   * Compute spectral novelty from mel spectrogram (optimized version)
   */
  computeOptimizedSpectralNovelty(melSpec) {
    const nFrames = melSpec[0].length;
    const nMels = melSpec.length;
    const novelty = new Float32Array(nFrames);
    
    // Skip first frame since we need a difference
    for (let t = 1; t < nFrames; t++) {
      let sum = 0;
      for (let m = 0; m < nMels; m++) {
        // Spectral flux with half-wave rectification
        const diff = melSpec[m][t] - melSpec[m][t-1];
        sum += diff > 0 ? diff : 0;
      }
      novelty[t] = sum / nMels;
    }
    
    return novelty;
  }
  
  /**
   * Detect events using spectral novelty (optimized)
   */
  detectOptimizedSpectralNovelty(features) {
    const { nFrames, frameDurationMs, spectralNovelty } = features;
    if (!spectralNovelty) return [];
    
    // Adaptive thresholding
    let meanNovelty = 0;
    let count = 0;
    for (let t = 0; t < nFrames; t++) {
      if (spectralNovelty[t] > 0) {
        meanNovelty += spectralNovelty[t];
        count++;
      }
    }
    meanNovelty = count > 0 ? meanNovelty / count : 0;
    
    // Standard deviation
    let variance = 0;
    for (let t = 0; t < nFrames; t++) {
      if (spectralNovelty[t] > 0) {
        const diff = spectralNovelty[t] - meanNovelty;
        variance += diff * diff;
      }
    }
    const stdDev = Math.sqrt(variance / Math.max(1, count));
    
    // Threshold for peak picking
    const threshold = meanNovelty + stdDev * this.config.onsetThresholdSigma;
    
    // Find novelty peaks - these represent acoustic events
    const events = [];
    for (let t = 2; t < nFrames - 2; t++) {
      if (spectralNovelty[t] > threshold && 
          spectralNovelty[t] > spectralNovelty[t-1] && 
          spectralNovelty[t] >= spectralNovelty[t+1]) {
        
        // Find event boundaries
        let start = t;
        let end = t;
        
        // Search backward for start
        while (start > 0 && spectralNovelty[start] > threshold * 0.3) {
          start--;
        }
        
        // Search forward for end
        while (end < nFrames - 1 && spectralNovelty[end] > threshold * 0.3) {
          end++;
        }
        
        const durationMs = (end - start) * frameDurationMs;
        if (durationMs >= this.config.minDurationMs) {
          events.push({
            start_ms: Math.round(start * frameDurationMs),
            end_ms: Math.round(end * frameDurationMs),
            confidence: Math.min(1.0, spectralNovelty[t] / (threshold * 1.5)),
            detection_method: 'spectral_novelty'
          });
          
          // Skip ahead to avoid multiple detections of same event
          t = end;
        }
      }
    }
    
    return events;
  }
  
  /**
   * Compute energy entropy - important for bird calls (optimized)
   */
  computeOptimizedEnergyEntropy(melSpec) {
    const nFrames = melSpec[0].length;
    const entropy = new Float32Array(nFrames);
    const nBands = melSpec.length;
    
    // Skip processing every frame to speed up - process every 2nd frame
    for (let t = 0; t < nFrames; t += 2) {
      // Collect band energies
      const bandEnergies = [];
      let totalEnergy = 0;
      
      for (let b = 0; b < nBands; b++) {
        const energy = Math.pow(10, melSpec[b][t] / 10); // Convert from dB
        bandEnergies.push(energy);
        totalEnergy += energy;
      }
      
      // Calculate entropy if we have energy
      if (totalEnergy > 0) {
        let entropyValue = 0;
        for (let b = 0; b < nBands; b++) {
          const p = bandEnergies[b] / totalEnergy;
          if (p > 0) {
            entropyValue -= p * Math.log2(p);
          }
        }
        entropy[t] = entropyValue / Math.log2(nBands); // Normalize to [0, 1]
      }
      
      // Fill in skipped frames
      if (t > 0 && t < nFrames - 1) {
        entropy[t-1] = (entropy[t-2] + entropy[t]) / 2;
      }
    }
    
    // Fill in any remaining frames
    for (let t = 0; t < nFrames; t++) {
      if (entropy[t] === 0 && t > 0) {
        entropy[t] = entropy[t-1];
      }
    }
    
    return entropy;
  }
  
  /**
   * Detect onsets using combination of spectral novelty and energy changes
   */
  detectOptimizedOnsets(features) {
    // If we don't have spectral novelty, can't run onset detection
    if (!features.spectralNovelty) return [];
    
    const { nFrames, frameDurationMs, spectralNovelty, energyEntropy } = features;
    const events = [];
    
    // Adaptive thresholding as with spectral novelty
    let meanNovelty = 0;
    let count = 0;
    for (let t = 0; t < nFrames; t++) {
      if (spectralNovelty[t] > 0) {
        meanNovelty += spectralNovelty[t];
        count++;
      }
    }
    meanNovelty = count > 0 ? meanNovelty / count : 0;
    const threshold = meanNovelty * 1.5;
    
    // Find onsets by looking for simultaneous novelty and entropy changes
    for (let t = 2; t < nFrames - 2; t++) {
      if (spectralNovelty[t] > threshold) {
        // Look for start of event
        let start = t;
        while (start > 0 && spectralNovelty[start] > threshold * 0.3) {
          start--;
        }
        
        // Look for end of event
        let end = t;
        while (end < nFrames - 1 && spectralNovelty[end] > threshold * 0.3) {
          end++;
        }
        
        const durationMs = (end - start) * frameDurationMs;
        if (durationMs >= this.config.minDurationMs) {
          events.push({
            start_ms: Math.round(start * frameDurationMs),
            end_ms: Math.round(end * frameDurationMs),
            confidence: Math.min(1.0, spectralNovelty[t] / threshold),
            detection_method: 'onset_detection'
          });
          
          // Skip ahead
          t = end;
        }
      }
    }
    
    return events;
  }
  
  /**
   * Compute optimized band energies for each frequency band
   */
  computeOptimizedBandEnergies(spectrogram, sampleRate) {
    const nFreqBins = spectrogram.length;
    const nyquist = sampleRate / 2;
    const binHz = nyquist / nFreqBins;
    const nFrames = spectrogram[0].length;
    const bandEnergies = {};
    
    // Calculate energy in each band
    for (const band of this.config.targetBands) {
      const startBin = Math.floor(band.fmin / binHz);
      const endBin = Math.ceil(band.fmax / binHz);
      const energy = new Float32Array(nFrames);
      
      for (let t = 0; t < nFrames; t++) {
        let sum = 0;
        for (let f = startBin; f <= endBin && f < nFreqBins; f++) {
          sum += spectrogram[f][t];
        }
        energy[t] = sum / Math.max(1, endBin - startBin + 1);
      }
      
      bandEnergies[band.name] = energy;
    }
    
    return bandEnergies;
  }
  
  /**
   * REMOVED: Duplicate method - use the corrected version above
   * The corrected version is in the detectBandEventsOptimized method
   */
  
  /**
   * Create mel filter bank with debugging
   */
  // REMOVED: Duplicate method - use the corrected version above

  /**
   * Report progress to callback
   */
  reportProgress(percent, message) {
    if (this.onProgress) {
      this.onProgress(percent, message);
    }
  }

  /**
   * Analyze audio characteristics to determine optimal detection parameters
   * Returns audio profile for dynamic parameter adaptation
   */
  async analyzeAudioCharacteristics(samples, sampleRate) {
    console.log('🔍 Analyzing audio characteristics for parameter adaptation...');

    // Analyze first portion of audio (configurable window)
    const analysisWindowSamples = Math.min(
      samples.length,
      Math.floor(this.config.adaptationAnalysisWindowSec * sampleRate)
    );
    const analysisSamples = samples.slice(0, analysisWindowSamples);

    // Extract features for analysis
    const analysisFeatures = this.extractOptimizedFeatures(analysisSamples, sampleRate);
    if (!analysisFeatures) return null;

    // 1. Estimate overall SNR and noise characteristics
    const snrAnalysis = this.estimateSignalToNoiseRatio(analysisFeatures);

    // 2. Analyze temporal variability (dawn chorus vs steady noise)
    const variabilityAnalysis = this.analyzeTemporalVariability(analysisFeatures);

    // 3. Analyze frequency content (birds vs insects vs wind)
    const frequencyAnalysis = this.analyzeFrequencyContent(analysisFeatures);

    // 4. Detect environment type (quiet forest, noisy urban, etc.)
    const environmentType = this.classifyEnvironmentType(snrAnalysis, variabilityAnalysis, frequencyAnalysis);

    return {
      estimatedSNR: snrAnalysis.snrDb,
      noiseFloor: snrAnalysis.noiseFloor,
      signalLevel: snrAnalysis.signalLevel,
      variabilityScore: variabilityAnalysis.variabilityScore,
      temporalPattern: variabilityAnalysis.pattern,
      dominantFreqRange: frequencyAnalysis.dominantRange,
      spectralSpread: frequencyAnalysis.spectralSpread,
      environmentType: environmentType,
      adaptationConfidence: Math.min(snrAnalysis.confidence, variabilityAnalysis.confidence)
    };
  }

  /**
   * Enhanced SNR estimation with outlier rejection for extreme noise/clipping
   */
  estimateSignalToNoiseRatio(features) {
    if (!features || !features.mel) {
      console.warn('⚠️ Invalid features for SNR estimation');
      return { snrDb: 10.0, noiseFloor: 1e-6, signalLevel: 1e-5, confidence: 0.1 };
    }

    const { mel, nFrames } = features;
    const nMels = mel.length;

    // Collect all energy values across time and frequency
    const allEnergies = [];
    for (let m = 0; m < nMels; m++) {
      if (!mel[m]) continue; // Skip invalid mel bands
      for (let t = 0; t < nFrames; t++) {
        const energy = mel[m][t];
        if (Number.isFinite(energy) && energy > 0) {
          allEnergies.push(energy);
        }
      }
    }

    if (allEnergies.length === 0) {
      console.warn('⚠️ No valid energy values found for SNR estimation');
      return { snrDb: 10.0, noiseFloor: 1e-6, signalLevel: 1e-5, confidence: 0.1 };
    }

    // OUTLIER REJECTION: Remove extreme values (thunder, gunshots, mic pops)
    const cleanedEnergies = this.rejectOutliers(allEnergies);

    if (cleanedEnergies.length < allEnergies.length * 0.5) {
      // Too many outliers removed, use original data but with low confidence
      console.log('⚠️ High outlier rate detected, using original data with low confidence');
      return this.estimateRobustSNR(allEnergies, 0.3); // Low confidence
    }

    // Sort cleaned energies to find percentiles
    cleanedEnergies.sort((a, b) => a - b);

    // Use robust percentiles for noise floor and signal level
    const noiseFloorIdx = Math.floor(cleanedEnergies.length * this.config.noiseFloorPercentile / 100);
    const signalLevelIdx = Math.floor(cleanedEnergies.length * this.config.signalPercentile / 100);

    const noiseFloor = cleanedEnergies[Math.max(0, Math.min(noiseFloorIdx, cleanedEnergies.length - 1))];
    const signalLevel = cleanedEnergies[Math.max(0, Math.min(signalLevelIdx, cleanedEnergies.length - 1))];

    // Validate values and provide fallbacks
    const validNoiseFloor = Number.isFinite(noiseFloor) ? Math.max(noiseFloor, 1e-10) : 1e-6;
    const validSignalLevel = Number.isFinite(signalLevel) ? Math.max(signalLevel, validNoiseFloor) : validNoiseFloor * 10;

    // Calculate SNR in dB with protection against invalid values
    const snrLinear = validSignalLevel / validNoiseFloor;
    const snrDb = Number.isFinite(snrLinear) && snrLinear > 0 ?
      20 * Math.log10(snrLinear) : 10.0; // Default to 10dB if calculation fails

    // Enhanced confidence based on multiple factors
    const separation = validSignalLevel - validNoiseFloor;
    const separationConfidence = Math.min(1.0, separation / (validNoiseFloor + 1e-10));
    const outlierConfidence = cleanedEnergies.length / allEnergies.length; // Lower if many outliers
    const confidence = Number.isFinite(separationConfidence) ?
      separationConfidence * outlierConfidence : 0.1;

    const finalSnrDb = Number.isFinite(snrDb) ? Math.max(-20, Math.min(60, snrDb)) : 10.0;

    return {
      snrDb: finalSnrDb,
      noiseFloor: validNoiseFloor,
      signalLevel: validSignalLevel,
      confidence: Math.max(0, Math.min(1, confidence)),
      outlierRate: 1 - outlierConfidence
    };
  }

  /**
   * Reject outliers using modified Z-score method
   * Robust against extreme spikes (thunder, gunshots, clipping)
   */
  rejectOutliers(data) {
    if (data.length < 10) return data; // Too few samples for outlier detection

    // Calculate median and MAD (Median Absolute Deviation) for robustness
    const sorted = [...data].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    const deviations = data.map(x => Math.abs(x - median));
    deviations.sort((a, b) => a - b);
    const mad = deviations[Math.floor(deviations.length / 2)];

    // Modified Z-score threshold (more robust than standard deviation)
    const threshold = this.config.outlierRejectionThreshold;
    const madThreshold = threshold * mad * 1.4826; // 1.4826 makes MAD consistent with std dev

    // Filter out outliers
    const cleaned = data.filter(x => Math.abs(x - median) <= madThreshold);

    const outlierRate = 1 - (cleaned.length / data.length);
    if (outlierRate > 0.1) {
      console.log(`🚨 Outlier rejection: removed ${(outlierRate * 100).toFixed(1)}% of samples`);
    }

    return cleaned;
  }

  /**
   * Fallback robust SNR estimation for high-outlier scenarios
   */
  estimateRobustSNR(data, confidence) {
    const sorted = [...data].sort((a, b) => a - b);

    // Use more conservative percentiles when outliers are present
    const noiseFloor = sorted[Math.floor(sorted.length * 0.25)]; // 25th percentile
    const signalLevel = sorted[Math.floor(sorted.length * 0.75)]; // 75th percentile

    const snrLinear = signalLevel / Math.max(noiseFloor, 1e-10);
    const snrDb = 20 * Math.log10(snrLinear);

    return {
      snrDb: Math.max(-20, Math.min(60, snrDb)),
      noiseFloor,
      signalLevel,
      confidence,
      outlierRate: 0.5 // Assume high outlier rate
    };
  }

  /**
   * Analyze temporal variability to detect dawn chorus, steady noise, etc.
   */
  analyzeTemporalVariability(features) {
    if (!features || !features.mel || !features.nFrames) {
      console.warn('⚠️ Invalid features for temporal variability analysis');
      return { variabilityScore: 0.5, pattern: 'steady', confidence: 0.1 };
    }

    const { mel, nFrames } = features;
    const nMels = mel.length;

    if (nFrames === 0 || nMels === 0) {
      return { variabilityScore: 0.5, pattern: 'steady', confidence: 0.1 };
    }

    // Compute frame-wise energy with NaN protection
    const frameEnergies = new Float32Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
      let energy = 0;
      let validMels = 0;
      for (let m = 0; m < nMels; m++) {
        if (mel[m] && Number.isFinite(mel[m][t])) {
          energy += mel[m][t];
          validMels++;
        }
      }
      frameEnergies[t] = validMels > 0 ? energy / validMels : 0;
    }

    // Compute temporal variability metrics
    let mean = 0;
    let validFrames = 0;
    for (let t = 0; t < nFrames; t++) {
      if (Number.isFinite(frameEnergies[t])) {
        mean += frameEnergies[t];
        validFrames++;
      }
    }

    if (validFrames === 0) {
      return { variabilityScore: 0.5, pattern: 'steady', confidence: 0.1 };
    }

    mean /= validFrames;

    let variance = 0;
    for (let t = 0; t < nFrames; t++) {
      if (Number.isFinite(frameEnergies[t])) {
        const diff = frameEnergies[t] - mean;
        variance += diff * diff;
      }
    }
    const std = Math.sqrt(variance / validFrames);

    // Variability score (coefficient of variation) with NaN protection
    const variabilityScore = Number.isFinite(std) && Number.isFinite(mean) && mean > 0 ?
      Math.min(2.0, std / Math.max(mean, 1e-10)) : 0.5; // Default to moderate variability

    // Detect temporal patterns
    let pattern = 'steady';
    if (variabilityScore > 0.8) {
      pattern = 'highly_variable'; // Dawn chorus, mixed activity
    } else if (variabilityScore > 0.4) {
      pattern = 'moderately_variable'; // Occasional calls
    } else if (variabilityScore < 0.2) {
      pattern = 'very_steady'; // Continuous noise (wind, insects)
    }

    // Confidence based on analysis window length and data validity
    const dataQuality = validFrames / nFrames;
    const lengthConfidence = Math.min(1.0, nFrames / 1000);
    const confidence = lengthConfidence * dataQuality;

    return {
      variabilityScore: Number.isFinite(variabilityScore) ? variabilityScore : 0.5,
      pattern,
      confidence: Math.max(0, Math.min(1, confidence))
    };
  }

  /**
   * Analyze frequency content to distinguish birds, insects, wind, etc.
   */
  analyzeFrequencyContent(features) {
    if (!features || !features.mel || !features.nFrames) {
      console.warn('⚠️ Invalid features for frequency analysis');
      return {
        dominantRange: 'mid_freq',
        dominantFreq: 4000,
        spectralSpread: 10,
        spectralCentroid: 32
      };
    }

    const { mel, nFrames } = features;
    const nMels = mel.length;

    if (nMels === 0 || nFrames === 0) {
      console.warn('⚠️ Empty mel spectrogram for frequency analysis');
      return {
        dominantRange: 'mid_freq',
        dominantFreq: 4000,
        spectralSpread: 10,
        spectralCentroid: 32
      };
    }

    // Compute average energy per mel bin with validation
    const melAverages = new Float32Array(nMels);
    for (let m = 0; m < nMels; m++) {
      let sum = 0;
      let validFrames = 0;
      for (let t = 0; t < nFrames; t++) {
        if (mel[m] && Number.isFinite(mel[m][t])) {
          sum += mel[m][t];
          validFrames++;
        }
      }
      melAverages[m] = validFrames > 0 ? sum / validFrames : 0;
    }

    // Find dominant frequency range
    let maxEnergy = 0;
    let dominantMel = 0;
    for (let m = 0; m < nMels; m++) {
      if (melAverages[m] > maxEnergy) {
        maxEnergy = melAverages[m];
        dominantMel = m;
      }
    }

    // Convert mel bin to frequency range
    const melToFreq = (mel) => 700 * (Math.exp(mel / 1127) - 1);
    const dominantFreq = melToFreq(dominantMel * 22050 / nMels); // Approximate conversion

    let dominantRange = 'mid_freq';
    if (dominantFreq < 1000) {
      dominantRange = 'low_freq'; // Wind, large animals
    } else if (dominantFreq > 8000) {
      dominantRange = 'high_freq'; // Insects, high-pitched birds
    }

    // Compute spectral spread (how concentrated the energy is)
    let weightedSum = 0;
    let totalEnergy = 0;
    for (let m = 0; m < nMels; m++) {
      weightedSum += m * melAverages[m];
      totalEnergy += melAverages[m];
    }
    const spectralCentroid = weightedSum / Math.max(totalEnergy, 1e-10);

    let spreadSum = 0;
    for (let m = 0; m < nMels; m++) {
      const diff = m - spectralCentroid;
      spreadSum += diff * diff * melAverages[m];
    }
    const spectralSpread = Number.isFinite(spreadSum) && totalEnergy > 0 ?
      Math.sqrt(spreadSum / Math.max(totalEnergy, 1e-10)) : 10.0;

    const result = {
      dominantRange,
      dominantFreq: Number.isFinite(dominantFreq) ? dominantFreq : 4000,
      spectralSpread: Number.isFinite(spectralSpread) ? spectralSpread : 10.0,
      spectralCentroid: Number.isFinite(spectralCentroid) ? spectralCentroid : 32
    };

    console.log(`🎼 Frequency analysis: dominant=${result.dominantFreq.toFixed(0)}Hz (${result.dominantRange}), spread=${result.spectralSpread.toFixed(1)}`);

    return result;
  }

  /**
   * Classify environment type based on audio characteristics
   */
  classifyEnvironmentType(snrAnalysis, variabilityAnalysis, frequencyAnalysis) {
    const { snrDb } = snrAnalysis;
    const { variabilityScore, pattern } = variabilityAnalysis;
    const { dominantRange, spectralSpread } = frequencyAnalysis;

    // Decision tree for environment classification
    if (snrDb < 5 && variabilityScore < 0.3) {
      return 'very_noisy'; // Urban, traffic, constant noise
    } else if (snrDb > 20 && variabilityScore < 0.2) {
      return 'very_quiet'; // Remote forest, minimal activity
    } else if (variabilityScore > 0.8 && dominantRange === 'mid_freq') {
      return 'dawn_chorus'; // High bird activity
    } else if (dominantRange === 'high_freq' && spectralSpread < 10) {
      return 'insect_dominated'; // Crickets, cicadas
    } else if (dominantRange === 'low_freq' && variabilityScore < 0.4) {
      return 'wind_dominated'; // Wind noise
    } else if (snrDb > 10 && variabilityScore > 0.4) {
      return 'moderate_activity'; // Normal bird activity
    } else {
      return 'mixed_environment'; // Complex soundscape
    }
  }

  /**
   * Enhanced continuous adaptation model - no discrete classes
   * Uses sliding thresholds based on measured SNR & temporal entropy
   */
  adaptParametersToAudio(audioProfile) {
    const adaptedConfig = { ...this.config };

    // Validate and sanitize audio profile values
    const estimatedSNR = Number.isFinite(audioProfile.estimatedSNR) ? audioProfile.estimatedSNR : 10.0;
    const variabilityScore = Number.isFinite(audioProfile.variabilityScore) ?
      Math.max(0, Math.min(1, audioProfile.variabilityScore)) : 0.5;
    const environmentType = audioProfile.environmentType || 'mixed_environment';
    const adaptationConfidence = Number.isFinite(audioProfile.adaptationConfidence) ?
      Math.max(0, Math.min(1, audioProfile.adaptationConfidence)) : 0.5;

    console.log(`🎛️ Continuous adaptation: SNR=${estimatedSNR.toFixed(1)}dB, Var=${variabilityScore.toFixed(2)}, Env=${environmentType}`);

    // Check adaptation confidence - use conservative defaults if low confidence
    if (adaptationConfidence < 0.3) {
      console.log('⚠️ Low adaptation confidence, using conservative parameters');
      adaptedConfig.onsetThresholdDb = 6.0;  // Conservative default
      adaptedConfig.offsetThresholdDb = 3.0; // Conservative default
      adaptedConfig.baselineWindowSec = 60;  // Default baseline window

      console.log(`✅ Adapted parameters: baseline=${adaptedConfig.baselineWindowSec}s, K_on=${adaptedConfig.onsetThresholdDb.toFixed(1)}dB, K_off=${adaptedConfig.offsetThresholdDb.toFixed(1)}dB`);
      return adaptedConfig;
    }

    // CONTINUOUS BASELINE ADAPTATION (no discrete thresholds)
    // Map variability score (0-1) to baseline window (30-120s) using smooth function
    const baselineRange = 120 - 30; // 90s range
    const variabilityFactor = Math.pow(1 - variabilityScore, 0.7); // Non-linear mapping
    adaptedConfig.baselineWindowSec = Math.round(30 + baselineRange * variabilityFactor);

    // CONTINUOUS THRESHOLD ADAPTATION based on SNR and variability
    // Base threshold from SNR with variability adjustment
    const snrFactor = Math.max(0.1, Math.min(1.0, (estimatedSNR + 10) / 30)); // Map -10 to 20dB → 0 to 1
    const variabilityAdjustment = 1 + (variabilityScore - 0.5) * 0.4; // ±20% based on variability

    const baseThreshold = 3.0 + (snrFactor * 7.0); // 3-10dB range
    adaptedConfig.onsetThresholdDb = baseThreshold * variabilityAdjustment;
    adaptedConfig.offsetThresholdDb = adaptedConfig.onsetThresholdDb * 0.5; // Maintain 2:1 ratio

    // MULTI-LABEL ENVIRONMENT HANDLING
    const environmentFactors = this.analyzeMultiLabelEnvironment(audioProfile);

    // Apply environment-specific adjustments (additive, not exclusive)
    if (environmentFactors.noiseLevel > 0.7) {
      // High noise component
      adaptedConfig.onsetThresholdDb += environmentFactors.noiseLevel * 2.0;
      adaptedConfig.enableSpectralWhitening = true;
    }

    if (environmentFactors.windLevel > 0.5) {
      // Wind component detected
      adaptedConfig.onsetThresholdDb += environmentFactors.windLevel * 1.5;
      // Gradually shift frequency focus upward
      const windShift = environmentFactors.windLevel * 1000; // Up to 1kHz shift
      adaptedConfig.targetBands = adaptedConfig.targetBands.map(band => ({
        ...band,
        fmin: band.fmin + windShift,
        fmax: band.fmax + windShift
      }));
    }

    if (environmentFactors.insectLevel > 0.6) {
      // Insect component detected
      adaptedConfig.onsetThresholdDb += environmentFactors.insectLevel * 1.0;
      // Reduce high-frequency sensitivity
      adaptedConfig.targetBands = adaptedConfig.targetBands.filter(band => band.fmax < 8000);
    }

    if (environmentFactors.birdActivityLevel > 0.8) {
      // High bird activity (dawn chorus)
      adaptedConfig.mergeGapMs = Math.max(25, 100 - environmentFactors.birdActivityLevel * 50);
      adaptedConfig.minDurationMs = Math.max(25, 50 - environmentFactors.birdActivityLevel * 25);
    }

    // CONTINUOUS FEATURE ADAPTATION
    // Mel filter banks based on spectral spread (continuous)
    const spectralSpread = audioProfile.spectralSpread || 10.0; // Extract from audioProfile
    const spreadFactor = Math.min(1.0, spectralSpread / 20); // Normalize spread
    adaptedConfig.melFilterBanks = Math.round(64 + spreadFactor * 64); // 64-128 range

    // Spectral whitening based on noise level (continuous)
    const whiteningThreshold = 0.3 + environmentFactors.noiseLevel * 0.4; // 0.3-0.7 range
    adaptedConfig.enableSpectralWhitening = environmentFactors.noiseLevel > whiteningThreshold;

    // Adapt spectral whitening based on environment
    if (environmentType === 'very_noisy' || environmentType === 'wind_dominated') {
      adaptedConfig.enableSpectralWhitening = true; // Help with noise robustness
    } else if (environmentType === 'very_quiet') {
      adaptedConfig.enableSpectralWhitening = false; // Preserve subtle features
    }

    // Adapt mel filter banks based on dominant frequency content
    if (audioProfile.dominantFreqRange === 'high_freq') {
      adaptedConfig.melFilterBanks = 128; // More resolution for high frequencies
    } else if (audioProfile.dominantFreqRange === 'low_freq') {
      adaptedConfig.melFilterBanks = 64; // Less resolution needed for low frequencies
    }

    // Confidence-based parameter adjustment
    if (adaptationConfidence < 0.5) {
      // Low confidence - use more conservative parameters
      console.log('⚠️ Low adaptation confidence, using conservative parameters');
      adaptedConfig.onsetThresholdDb = Math.max(adaptedConfig.onsetThresholdDb, 5.0);
      adaptedConfig.baselineWindowSec = Math.max(adaptedConfig.baselineWindowSec, 60);
    }

    console.log(`✅ Adapted parameters: baseline=${adaptedConfig.baselineWindowSec}s, K_on=${adaptedConfig.onsetThresholdDb.toFixed(1)}dB, K_off=${adaptedConfig.offsetThresholdDb.toFixed(1)}dB`);

    return adaptedConfig;
  }

  /**
   * Smooth parameter transition to avoid abrupt changes during re-analysis
   * Uses exponential smoothing to gradually adapt parameters
   */
  smoothParameterTransition(currentConfig, newConfig) {
    const smoothed = { ...currentConfig };
    const alpha = this.config.adaptationSmoothingFactor;

    // Smooth numerical parameters
    smoothed.onsetThresholdDb = currentConfig.onsetThresholdDb * (1 - alpha) + newConfig.onsetThresholdDb * alpha;
    smoothed.offsetThresholdDb = currentConfig.offsetThresholdDb * (1 - alpha) + newConfig.offsetThresholdDb * alpha;
    smoothed.baselineWindowSec = Math.round(currentConfig.baselineWindowSec * (1 - alpha) + newConfig.baselineWindowSec * alpha);
    smoothed.mergeGapMs = Math.round(currentConfig.mergeGapMs * (1 - alpha) + newConfig.mergeGapMs * alpha);

    // For boolean/categorical parameters, use threshold-based switching
    if (alpha > 0.5) {
      smoothed.enableSpectralWhitening = newConfig.enableSpectralWhitening;
      smoothed.melFilterBanks = newConfig.melFilterBanks;
      smoothed.targetBands = newConfig.targetBands;
    }

    console.log(`🔄 Smoothed transition: K_on ${currentConfig.onsetThresholdDb.toFixed(1)}→${smoothed.onsetThresholdDb.toFixed(1)}dB`);

    return smoothed;
  }

  /**
   * Multi-label environment analysis - detect overlapping conditions
   * Returns continuous factors (0-1) for each environment component
   */
  analyzeMultiLabelEnvironment(audioProfile) {
    const { estimatedSNR, variabilityScore, dominantFreqRange, spectralSpread, dominantFreq } = audioProfile;

    // Noise level factor (0-1)
    const noiseLevel = Math.max(0, Math.min(1, (15 - estimatedSNR) / 20)); // High when SNR is low

    // Wind level factor based on low-frequency dominance and low variability
    const lowFreqFactor = dominantFreq < 1500 ? 1.0 : Math.max(0, (2000 - dominantFreq) / 1500);
    const steadinessFactor = 1 - variabilityScore; // High when variability is low
    const windLevel = Math.min(1, (lowFreqFactor * 0.7 + steadinessFactor * 0.3));

    // Insect level factor based on high-frequency dominance and narrow spread
    const highFreqFactor = dominantFreq > 6000 ? 1.0 : Math.max(0, (dominantFreq - 4000) / 4000);
    const validSpectralSpread = Number.isFinite(spectralSpread) ? spectralSpread : 10.0;
    const narrowSpreadFactor = Math.max(0, (15 - validSpectralSpread) / 15); // High when spread is narrow
    const insectLevel = Math.min(1, (highFreqFactor * 0.6 + narrowSpreadFactor * 0.4));

    // Bird activity level based on mid-frequency dominance and variability
    const midFreqFactor = (dominantFreq >= 1500 && dominantFreq <= 8000) ? 1.0 : 0.3;
    const activityFactor = variabilityScore; // High when variability is high
    const birdActivityLevel = Math.min(1, (midFreqFactor * 0.5 + activityFactor * 0.5));

    // Urban/traffic level based on low-frequency and steady patterns
    const trafficPattern = lowFreqFactor * steadinessFactor * (noiseLevel > 0.5 ? 1.0 : 0.5);
    const urbanLevel = Math.min(1, trafficPattern);

    return {
      noiseLevel,
      windLevel,
      insectLevel,
      birdActivityLevel,
      urbanLevel,
      // Composite scores
      naturalness: Math.max(birdActivityLevel, windLevel * 0.5) * (1 - urbanLevel),
      complexity: (birdActivityLevel + insectLevel + windLevel) / 3
    };
  }

  /**
   * Hardware calibration - detect device characteristics and apply corrections
   * Analyzes noise floor and frequency response to calibrate for different recorders
   */
  async calibrateForHardware(samples, sampleRate, deviceInfo = null) {
    if (!this.config.enableHardwareCalibration) return null;

    console.log('🔧 Performing hardware calibration...');

    // Extract features for calibration analysis
    const features = this.extractOptimizedFeatures(samples, sampleRate);
    if (!features) return null;

    // 1. Detect device noise floor characteristics
    const noiseProfile = this.analyzeDeviceNoiseFloor(features);

    // 2. Analyze frequency response characteristics
    const frequencyProfile = this.analyzeDeviceFrequencyResponse(features);

    // 3. Estimate device-specific calibration offset
    const calibrationOffset = this.estimateDeviceCalibration(noiseProfile, frequencyProfile, deviceInfo);

    console.log(`🎛️ Hardware calibration: offset=${calibrationOffset.dbOffset.toFixed(1)}dB, type=${calibrationOffset.deviceType}`);

    return {
      dbOffset: calibrationOffset.dbOffset,
      deviceType: calibrationOffset.deviceType,
      noiseFloorDb: noiseProfile.noiseFloorDb,
      frequencyBias: frequencyProfile.bias,
      confidence: Math.min(noiseProfile.confidence, frequencyProfile.confidence)
    };
  }

  /**
   * Analyze device-specific noise floor characteristics
   */
  analyzeDeviceNoiseFloor(features) {
    const { mel, nFrames } = features;
    const nMels = mel.length;

    // Find quietest regions (bottom 5th percentile of frames)
    const frameEnergies = [];
    for (let t = 0; t < nFrames; t++) {
      let energy = 0;
      for (let m = 0; m < nMels; m++) {
        energy += mel[m][t];
      }
      frameEnergies.push(energy / nMels);
    }

    frameEnergies.sort((a, b) => a - b);
    const quietFrameThreshold = frameEnergies[Math.floor(frameEnergies.length * 0.05)];

    // Analyze noise floor in quiet regions
    const noiseFloorSamples = [];
    for (let t = 0; t < nFrames; t++) {
      let frameEnergy = 0;
      for (let m = 0; m < nMels; m++) {
        frameEnergy += mel[m][t];
      }
      frameEnergy /= nMels;

      if (frameEnergy <= quietFrameThreshold * 1.2) { // Within 20% of quietest
        for (let m = 0; m < nMels; m++) {
          noiseFloorSamples.push(mel[m][t]);
        }
      }
    }

    if (noiseFloorSamples.length === 0) {
      return { noiseFloorDb: -60, confidence: 0 };
    }

    // Calculate noise floor statistics
    noiseFloorSamples.sort((a, b) => a - b);
    const medianNoise = noiseFloorSamples[Math.floor(noiseFloorSamples.length / 2)];
    const noiseFloorDb = 20 * Math.log10(Math.max(medianNoise, 1e-10));

    // Confidence based on consistency of noise floor
    const q25 = noiseFloorSamples[Math.floor(noiseFloorSamples.length * 0.25)];
    const q75 = noiseFloorSamples[Math.floor(noiseFloorSamples.length * 0.75)];
    const iqr = q75 - q25;
    const consistency = Math.max(0, 1 - (iqr / Math.max(medianNoise, 1e-10)));

    return {
      noiseFloorDb: Math.max(-80, Math.min(-20, noiseFloorDb)),
      consistency,
      confidence: consistency
    };
  }

  /**
   * Analyze device frequency response characteristics
   */
  analyzeDeviceFrequencyResponse(features) {
    const { mel, nFrames } = features;
    const nMels = mel.length;

    // Compute average energy per frequency band
    const bandAverages = new Float32Array(nMels);
    for (let m = 0; m < nMels; m++) {
      let sum = 0;
      for (let t = 0; t < nFrames; t++) {
        sum += mel[m][t];
      }
      bandAverages[m] = sum / nFrames;
    }

    // Analyze frequency response curve
    const lowFreqEnergy = bandAverages.slice(0, Math.floor(nMels * 0.3)).reduce((a, b) => a + b, 0);
    const midFreqEnergy = bandAverages.slice(Math.floor(nMels * 0.3), Math.floor(nMels * 0.7)).reduce((a, b) => a + b, 0);
    const highFreqEnergy = bandAverages.slice(Math.floor(nMels * 0.7)).reduce((a, b) => a + b, 0);

    const totalEnergy = lowFreqEnergy + midFreqEnergy + highFreqEnergy;
    const lowRatio = lowFreqEnergy / totalEnergy;
    const midRatio = midFreqEnergy / totalEnergy;
    const highRatio = highFreqEnergy / totalEnergy;

    // Detect frequency bias
    let bias = 'balanced';
    if (lowRatio > 0.5) {
      bias = 'low_freq_bias';
    } else if (highRatio > 0.4) {
      bias = 'high_freq_bias';
    } else if (midRatio > 0.6) {
      bias = 'mid_freq_emphasis';
    }

    // Calculate spectral tilt (slope of frequency response)
    let tiltSum = 0;
    for (let m = 1; m < nMels; m++) {
      tiltSum += (bandAverages[m] - bandAverages[m-1]) * m;
    }
    const spectralTilt = tiltSum / (nMels * nMels);

    return {
      bias,
      lowRatio,
      midRatio,
      highRatio,
      spectralTilt,
      confidence: Math.min(1.0, totalEnergy / (nMels * nFrames * 0.1)) // Higher confidence with more energy
    };
  }

  /**
   * Estimate device-specific calibration based on noise and frequency analysis
   */
  estimateDeviceCalibration(noiseProfile, frequencyProfile, deviceInfo) {
    let dbOffset = 0;
    let deviceType = 'unknown';

    // Device type classification based on characteristics
    if (noiseProfile.noiseFloorDb < -65 && frequencyProfile.bias === 'balanced') {
      deviceType = 'professional'; // High-end recorder
      dbOffset = 0; // No adjustment needed
    } else if (noiseProfile.noiseFloorDb > -45 && frequencyProfile.lowRatio > 0.4) {
      deviceType = 'smartphone'; // Phone recording
      dbOffset = 3.0; // Boost sensitivity
    } else if (frequencyProfile.bias === 'high_freq_bias') {
      deviceType = 'consumer_digital'; // Consumer digital recorder
      dbOffset = 1.5; // Slight boost
    } else if (noiseProfile.noiseFloorDb > -55) {
      deviceType = 'budget_recorder'; // Budget device
      dbOffset = 2.5; // Compensate for higher noise floor
    } else {
      deviceType = 'standard'; // Standard recording device
      dbOffset = 1.0; // Small adjustment
    }

    // Apply device info if available
    if (deviceInfo) {
      if (deviceInfo.includes('iPhone') || deviceInfo.includes('Android')) {
        deviceType = 'smartphone';
        dbOffset = Math.max(dbOffset, 2.0);
      } else if (deviceInfo.includes('Zoom') || deviceInfo.includes('Tascam')) {
        deviceType = 'professional';
        dbOffset = Math.min(dbOffset, 1.0);
      }
    }

    return {
      dbOffset,
      deviceType
    };
  }

  /**
   * Optimized STFT with reduced FFT points and faster computation
   * FIXED: FFT size mismatch and proper frame handling
   */
  computeOptimizedSTFT(samples, winSamples, hopSamples) {
    // Validate inputs
    if (!samples || samples.length === 0) {
      console.warn('⚠️ Empty samples for STFT');
      return null;
    }

    const nFrames = Math.floor((samples.length - winSamples) / hopSamples) + 1;
    // FIXED: Use actual FFT size, not hardcoded division
    const nFreqBins = Math.floor(this.config.nFFT / 2);

    if (nFrames <= 0) {
      console.warn('⚠️ No frames for STFT computation');
      return null;
    }

    console.log(`🔧 STFT: ${samples.length} samples → ${nFrames} frames × ${nFreqBins} freq bins`);

    const spectrogram = Array(nFreqBins).fill(null).map(() => new Float32Array(nFrames));
    const window = this.fastWindow(winSamples);

    let validFrames = 0;
    for (let frameIdx = 0; frameIdx < nFrames; frameIdx++) {
      const start = frameIdx * hopSamples;
      
      // FIXED: Ensure frame size matches FFT size
      const frameSize = Math.min(winSamples, this.config.nFFT);
      const frame = new Float32Array(this.config.nFFT);
      frame.fill(0); // Zero-pad if needed

      // Extract and window frame
      const end = Math.min(start + winSamples, samples.length);
      let hasValidData = false;

      for (let i = 0; i < Math.min(end - start, frameSize); i++) {
        const sample = samples[start + i];
        if (Number.isFinite(sample)) {
          frame[i] = sample * window[i];
          hasValidData = true;
        }
      }

      if (!hasValidData) continue;

      // Fast FFT
      const powerSpectrum = this.fastFFT(frame);
      if (!powerSpectrum) continue;

      // Store power spectrum with validation
      let frameHasEnergy = false;
      for (let freqIdx = 0; freqIdx < nFreqBins; freqIdx++) {
        const power = powerSpectrum[freqIdx];
        if (Number.isFinite(power) && power > 0) {
          spectrogram[freqIdx][frameIdx] = Math.max(power, 1e-10);
          frameHasEnergy = true;
        } else {
          spectrogram[freqIdx][frameIdx] = 1e-10;
        }
      }

      if (frameHasEnergy) validFrames++;
    }

    console.log(`✅ STFT computed: ${validFrames}/${nFrames} valid frames`);

    if (validFrames === 0) {
      console.warn('⚠️ No valid frames in STFT - all audio data may be invalid');
      return null;
    }

    return spectrogram;
  }

  /**
   * Enhanced rolling baseline using trailing median for adaptive per-band processing
   * Uses longer window (30-120s) and more efficient approach for memory management
   * FIXED: Consistent baseline calculation and memory management
   */
  computeOptimizedBaseline(signal) {
    const nFrames = signal.length;
    const baseline = new Float32Array(nFrames);
    const windowFrames = Math.floor((this.config.baselineWindowSec * 1000) / this.config.hopMs);

    // FIXED: Use consistent baseline calculation for all frames
    for (let t = 0; t < nFrames; t++) {
      const windowStart = Math.max(0, t - windowFrames + 1);
      const window = signal.slice(windowStart, t + 1);
      
      // Sort and get median
      const sortedWindow = [...window].sort((a, b) => a - b);
      baseline[t] = sortedWindow[Math.floor(sortedWindow.length / 2)];
    }

    return baseline;
  }

  /**
   * Memory-efficient streaming baseline for chunk processing
   * Carries over baseline state between chunks to maintain continuity
   * FIXED: Proper circular buffer implementation
   */
  computeStreamingBaseline(signal, carryOverBaseline = null) {
    const nFrames = signal.length;
    const baseline = new Float32Array(nFrames);
    const windowFrames = Math.floor((this.config.baselineWindowSec * 1000) / this.config.hopMs);

    // Initialize with carry-over from previous chunk if available
    let initBuffer = [];
    if (carryOverBaseline && carryOverBaseline.length > 0) {
      const carryFrames = Math.min(windowFrames, carryOverBaseline.length);
      initBuffer = carryOverBaseline.slice(-carryFrames);
    }

    // FIXED: Proper circular buffer with fixed size
    const sortedWindow = [...initBuffer].sort((a, b) => a - b);
    const maxWindowSize = windowFrames;

    for (let t = 0; t < nFrames; t++) {
      const value = signal[t];

      // Binary search insertion to maintain sorted order
      let left = 0, right = sortedWindow.length;
      while (left < right) {
        const mid = Math.floor((left + right) / 2);
        if (sortedWindow[mid] < value) left = mid + 1;
        else right = mid;
      }
      sortedWindow.splice(left, 0, value);

      // FIXED: Maintain fixed window size to prevent memory leaks
      if (sortedWindow.length > maxWindowSize) {
        // Remove oldest sample
        const removeIndex = t - maxWindowSize + initBuffer.length;
        if (removeIndex >= 0 && removeIndex < signal.length) {
          const oldValue = signal[removeIndex];
          const removePos = sortedWindow.indexOf(oldValue);
          if (removePos !== -1) {
            sortedWindow.splice(removePos, 1);
          }
        } else if (initBuffer.length > 0) {
          // Remove from carry-over buffer
          const oldValue = initBuffer.shift();
          const removePos = sortedWindow.indexOf(oldValue);
          if (removePos !== -1) {
            sortedWindow.splice(removePos, 1);
          }
        }
      }

      // Get median from sorted window
      baseline[t] = sortedWindow[Math.floor(sortedWindow.length / 2)];
    }

    return baseline;
  }
  
  /**
   * Enhanced hysteresis threshold computation with K_on and K_off
   * Returns both onset and offset thresholds for better event boundaries
   * FIXED: Proper dB-based threshold calculation
   */
  computeOptimizedThreshold(signal, baseline) {
    const nFrames = signal.length;
    const onsetThreshold = new Float32Array(nFrames);
    const offsetThreshold = new Float32Array(nFrames);

    // FIXED: Convert dB thresholds to linear scale correctly
    const konLinear = Math.pow(10, this.config.onsetThresholdDb / 20);
    const koffLinear = Math.pow(10, this.config.offsetThresholdDb / 20);

    for (let t = 0; t < nFrames; t++) {
      // FIXED: Proper threshold calculation - multiply by linear factors
      onsetThreshold[t] = baseline[t] * konLinear;   // baseline * 10^(K_on/20)
      offsetThreshold[t] = baseline[t] * koffLinear; // baseline * 10^(K_off/20)
    }

    return {
      onset: onsetThreshold,
      offset: offsetThreshold
    };
  }

  /**
   * Alternative adaptive threshold with local noise estimation
   * Fallback for very noisy environments where fixed dB thresholds don't work
   * FIXED: Proper threshold calculation
   */
  computeAdaptiveThreshold(signal, baseline) {
    const nFrames = signal.length;
    const threshold = new Float32Array(nFrames);
    const windowFrames = Math.floor((this.config.adaptiveWindowSec * 1000) / this.config.hopMs);

    // Use reduced sampling for efficiency
    for (let t = 0; t < nFrames; t++) {
      const windowStart = Math.max(0, t - windowFrames + 1);
      const window = signal.slice(windowStart, t + 1);
      
      // Calculate local noise level
      const sortedWindow = [...window].sort((a, b) => a - b);
      const noiseLevel = sortedWindow[Math.floor(sortedWindow.length * 0.1)]; // 10th percentile
      
      // FIXED: Use proper threshold calculation
      threshold[t] = noiseLevel * Math.pow(10, this.config.onsetThresholdDb / 20);
    }

    return threshold;
  }

  /**
   * Improved band event detection with adaptive thresholding
   * FIXED: Proper frequency band mapping and event validation
   */
  detectBandEventsOptimized(features, band) {
    const { mel, nFrames, frameDurationMs } = features;
    const nyquist = features.sampleRate / 2;
    
    // FIXED: Proper mel-to-frequency mapping for target bands
    const melToHz = (mel) => 700 * (Math.pow(10, mel / 2595) - 1);
    const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
    
    // Map frequency band to mel indices using proper mel scale
    const bandMelMin = hzToMel(band.fmin);
    const bandMelMax = hzToMel(band.fmax);
    
    // Find mel bins that actually contain the target frequency range
    const startMel = Math.floor((bandMelMin / hzToMel(nyquist)) * this.config.nMels);
    const endMel = Math.ceil((bandMelMax / hzToMel(nyquist)) * this.config.nMels);
    
    // Validate mel bin range
    const validStartMel = Math.max(0, Math.min(startMel, this.config.nMels - 1));
    const validEndMel = Math.max(validStartMel, Math.min(endMel, this.config.nMels - 1));
    
    if (validEndMel <= validStartMel) {
      console.warn(`⚠️ Invalid mel bin range for band ${band.name}: ${validStartMel}-${validEndMel}`);
      return [];
    }
    
    // Compute band energy
    const bandEnergy = new Float32Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
      let energy = 0;
      let validBins = 0;
      
      for (let m = validStartMel; m <= validEndMel && m < this.config.nMels; m++) {
        if (mel[m] && Number.isFinite(mel[m][t])) {
          energy += mel[m][t];
          validBins++;
        }
      }
      
      bandEnergy[t] = validBins > 0 ? energy / validBins : 1e-10;
    }
    
    // Enhanced per-band rolling baseline with longer window
    const baseline = this.computeOptimizedBaseline(bandEnergy);
    const thresholds = this.computeOptimizedThreshold(bandEnergy, baseline);

    // Enhanced event detection with proper hysteresis (K_on and K_off)
    const events = [];
    let inEvent = false;
    let eventStart = 0;
    let maxEnergy = -Infinity;
    let peakTime = 0;
    let peakFreq = 0;

    for (let t = 0; t < nFrames; t++) {
      const signal = bandEnergy[t];

      if (!inEvent && signal > thresholds.onset[t]) {
        // Event onset: signal > baseline + K_on dB
        inEvent = true;
        eventStart = t;
        maxEnergy = signal - baseline[t];
        peakTime = t;
      } else if (inEvent && signal < thresholds.offset[t]) {
        // Event offset: signal < baseline + K_off dB (K_off < K_on)
        const eventEnd = t;
        const durationMs = (eventEnd - eventStart) * frameDurationMs;

        // FIXED: Validate event duration before creating
        if (durationMs >= this.config.minDurationMs && durationMs <= this.config.maxDurationMs) {
          // Find peak frequency for this event
          const estPeakFreq = this.estimatePeakFrequency(features, band, eventStart, eventEnd);

          // Calculate SNR in dB
          const snrLinear = maxEnergy / Math.max(baseline[peakTime], 1e-10);
          const snrDb = 20 * Math.log10(snrLinear);

          events.push({
            start_ms: Math.round(eventStart * frameDurationMs),
            end_ms: Math.round(eventEnd * frameDurationMs),
            f_min_hz: band.fmin,
            f_max_hz: band.fmax,
            peak_freq_hz: estPeakFreq || (band.fmin + band.fmax) / 2,
            snr_db: snrDb,
            confidence: Math.min(1.0, Math.max(0.1, snrDb / 20.0)) // dB-based confidence
          });
        }
        
        inEvent = false;
      } else if (inEvent && signal > maxEnergy) {
        maxEnergy = signal;
        peakTime = t;
      }
    }
    
    // Handle event that extends to end of audio
    if (inEvent) {
      const durationMs = (nFrames - eventStart) * frameDurationMs;
      if (durationMs >= this.config.minDurationMs && durationMs <= this.config.maxDurationMs) {
        const estPeakFreq = this.estimatePeakFrequency(features, band, eventStart, nFrames - 1);
        const snrLinear = maxEnergy / Math.max(baseline[peakTime], 1e-10);
        const snrDb = 20 * Math.log10(snrLinear);

        events.push({
          start_ms: Math.round(eventStart * frameDurationMs),
          end_ms: Math.round(nFrames * frameDurationMs),
          f_min_hz: band.fmin,
          f_max_hz: band.fmax,
          peak_freq_hz: estPeakFreq || (band.fmin + band.fmax) / 2,
          snr_db: snrDb,
          confidence: Math.min(1.0, Math.max(0.1, snrDb / 20.0))
        });
      }
    }
    
    return events;
  }

  /**
   * Estimate peak frequency for an event
   * NEW: Proper frequency estimation
   */
  estimatePeakFrequency(features, band, startFrame, endFrame) {
    try {
      const { mel, sampleRate } = features;
      const nyquist = sampleRate / 2;
      
      // Find the frame with maximum energy in the band
      let maxEnergy = -Infinity;
      let peakFrame = startFrame;
      
      for (let t = startFrame; t <= endFrame && t < mel[0].length; t++) {
        let frameEnergy = 0;
        for (let m = 0; m < mel.length; m++) {
          if (mel[m] && Number.isFinite(mel[m][t])) {
            frameEnergy += mel[m][t];
          }
        }
        
        if (frameEnergy > maxEnergy) {
          maxEnergy = frameEnergy;
          peakFrame = t;
        }
      }
      
      // Convert mel bin to frequency
      const melToHz = (mel) => 700 * (Math.pow(10, mel / 2595) - 1);
      const peakMelBin = Math.floor((peakFrame / mel.length) * this.config.nMels);
      const peakFreq = melToHz(peakMelBin);
      
      // Ensure frequency is within band bounds
      return Math.max(band.fmin, Math.min(band.fmax, peakFreq));
      
    } catch (error) {
      console.warn('⚠️ Failed to estimate peak frequency:', error);
      return (band.fmin + band.fmax) / 2; // Fallback to band center
    }
  }

  /**
   * Fallback to original feature extraction for compatibility
   * FIXED: Added missing method that was referenced but not implemented
   */
  extractOptimizedFeatures(samples, sampleRate) {
    return this.extractEnhancedFeatures(samples, sampleRate, null);
  }

  /**
   * Optimized energy-based event detection
   * FIXED: Added missing method that was referenced but not implemented
   */
  detectEnergyEventsOptimized(features) {
    const events = [];
    
    for (const band of this.config.targetBands) {
      const bandEvents = this.detectBandEventsOptimized(features, band);
      events.push(...bandEvents.map(e => ({ ...e, band_name: band.name })));
    }
    
    return events;
  }

  /**
   * Filter and refine events (legacy method for compatibility)
   * FIXED: Added missing method that was referenced but not implemented
   */
  filterAndRefineEvents(events) {
    return this.filterOptimizedEvents(events, null, null);
  }

  /**
   * Test method to verify AED system functionality
   * NEW: Simple test to check if all methods are working
   */
  async testAEDSystem() {
    console.log('🧪 Testing AED system...');
    
    try {
      // Test 1: Check if all required methods exist
      const requiredMethods = [
        'extractOptimizedFeatures',
        'extractEnhancedFeatures',
        'detectOptimizedSpectralNovelty',
        'filterOptimizedEvents',
        'detectEnergyEventsOptimized',
        'detectBandEventsOptimized',
        'detectOptimizedOnsets',
        'filterAndRefineEvents',
        'generateAudioSnippet',
        'applyDeduplication',
        'batchInsertEvents'
      ];
      
      for (const method of requiredMethods) {
        if (typeof this[method] !== 'function') {
          throw new Error(`Missing method: ${method}`);
        }
      }
      
      console.log('✅ All required methods exist');
      
      // Test 2: Check configuration
      if (!this.config) {
        throw new Error('Configuration is missing');
      }
      
      console.log('✅ Configuration is valid');
      
      // Test 3: Create dummy audio data
      const sampleRate = 32000;
      const duration = 1; // 1 second
      const samples = new Float32Array(sampleRate * duration);
      
      // Generate a simple sine wave for testing
      const frequency = 1000; // 1kHz
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.1;
      }
      
      console.log('✅ Test audio data created');
      
      // Test 4: Test feature extraction
      const features = this.extractOptimizedFeatures(samples, sampleRate);
      if (!features) {
        throw new Error('Feature extraction failed');
      }
      
      console.log('✅ Feature extraction works');
      
      // Test 5: Test event detection
      const events = this.detectOptimizedSpectralNovelty(features);
      console.log(`✅ Event detection works: ${events.length} events detected`);
      
      console.log('🎉 AED system test completed successfully!');
      return true;
      
    } catch (error) {
      console.error('❌ AED system test failed:', error.message);
      return false;
    }
  }

  /**
   * Fast Hanning window generation
   * FIXED: Added missing method
   */
  fastWindow(n) {
    const w = new Float32Array(n);
    const factor = 2 * Math.PI / (n - 1);
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 * (1 - Math.cos(factor * i));
    }
    return w;
  }

  /**
   * Simplified FFT that returns power spectrum directly
   * FIXED: Added missing method
   */
  fastFFT(x) {
    const N = x.length;

    // Validate input
    if (N === 0 || !Number.isFinite(N)) {
      console.warn('⚠️ Invalid FFT input length:', N);
      return new Float32Array(N / 2);
    }

    // Check if N is power of 2, if not, use DFT fallback
    if ((N & (N - 1)) !== 0) {
      return this.computeDFT(x);
    }

    const out = new Float32Array(N * 2);

    // Copy input to complex array with NaN/Infinity checks
    for (let i = 0; i < N; i++) {
      const val = x[i];
      out[i * 2] = Number.isFinite(val) ? val : 0;
      out[i * 2 + 1] = 0;
    }

    // Bit-reversal
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      const j = this.bitReverse(i, bits);
      if (i < j) {
        [out[i * 2], out[j * 2]] = [out[j * 2], out[i * 2]];
        [out[i * 2 + 1], out[j * 2 + 1]] = [out[j * 2 + 1], out[i * 2 + 1]];
      }
    }
    
    // FFT
    for (let size = 2; size <= N; size *= 2) {
      const half = size / 2;
      const step = N / size;
      
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const theta = -2 * Math.PI * (k % N) / N;
          const wr = Math.cos(theta);
          const wi = Math.sin(theta);
          
          const xr = out[(j + half) * 2];
          const xi = out[(j + half) * 2 + 1];
          const yr = wr * xr - wi * xi;
          const yi = wr * xi + wi * xr;
          
          out[(j + half) * 2] = out[j * 2] - yr;
          out[(j + half) * 2 + 1] = out[j * 2 + 1] - yi;
          out[j * 2] += yr;
          out[j * 2 + 1] += yi;
        }
      }
    }
    
    // Return power spectrum with NaN protection
    const power = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) {
      const real = out[i * 2];
      const imag = out[i * 2 + 1];
      const powerVal = real * real + imag * imag;
      power[i] = Number.isFinite(powerVal) ? Math.max(powerVal, 1e-10) : 1e-10;
    }

    return power;
  }

  /**
   * DFT fallback for non-power-of-2 inputs
   * FIXED: Added missing method
   */
  computeDFT(x) {
    const N = x.length;
    const power = new Float32Array(N / 2);

    for (let k = 0; k < N / 2; k++) {
      let real = 0;
      let imag = 0;

      for (let n = 0; n < N; n++) {
        const angle = -2 * Math.PI * k * n / N;
        const val = Number.isFinite(x[n]) ? x[n] : 0;
        real += val * Math.cos(angle);
        imag += val * Math.sin(angle);
      }

      const powerVal = real * real + imag * imag;
      power[k] = Number.isFinite(powerVal) ? Math.max(powerVal, 1e-10) : 1e-10;
    }

    return power;
  }

  /**
   * Bit reverse for FFT
   * FIXED: Added missing method
   */
  bitReverse(num, bits) {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      result = (result << 1) | (num & 1);
      num >>= 1;
    }
    return result;
  }

  /**
   * Apply log-mel transformation for more stable features
   * FIXED: Added missing method
   */
  applyLogMelTransform(melSpectrogram) {
    const logMel = [];
    for (let m = 0; m < melSpectrogram.length; m++) {
      logMel[m] = new Float32Array(melSpectrogram[m].length);
      for (let t = 0; t < melSpectrogram[m].length; t++) {
        // Add small epsilon to avoid log(0)
        logMel[m][t] = Math.log(melSpectrogram[m][t] + 1e-10);
      }
    }
    return logMel;
  }

  /**
   * Apply spectral whitening for noise robustness
   * FIXED: Added missing method
   */
  applySpectralWhitening(spectrogram) {
    const whitened = [];
    const nMels = spectrogram.length;
    const nFrames = spectrogram[0].length;

    // Compute mean and std for each mel bin
    for (let m = 0; m < nMels; m++) {
      whitened[m] = new Float32Array(nFrames);

      // Compute mean
      let mean = 0;
      for (let t = 0; t < nFrames; t++) {
        mean += spectrogram[m][t];
      }
      mean /= nFrames;

      // Compute std
      let variance = 0;
      for (let t = 0; t < nFrames; t++) {
        const diff = spectrogram[m][t] - mean;
        variance += diff * diff;
      }
      const std = Math.sqrt(variance / nFrames);

      // Apply whitening
      for (let t = 0; t < nFrames; t++) {
        whitened[m][t] = (spectrogram[m][t] - mean) / Math.max(std, 1e-10);
      }
    }

    return whitened;
  }

  /**
   * Batch load audio for multiple segments to reduce I/O overhead
   * FIXED: Added missing method
   */
  async batchLoadAudio(segments) {
    const { downloadFile } = await import('../config/s3.js');
    const audioDataMap = new Map();
    
    // Download all files in parallel
    const downloadPromises = segments.map(async (segment) => {
      try {
        const tempIn = path.join(process.cwd(), 'temp_ffmpeg', `seg_${segment.id}.flac`);
        const tempRaw = path.join(process.cwd(), 'temp_ffmpeg', `seg_${segment.id}.raw`);
        
        const fs = await import('fs');
        fs.mkdirSync(path.dirname(tempIn), { recursive: true });
        
        // Download file
        await downloadFile(segment.s3_key, tempIn);
        
        // Convert to raw audio
        await new Promise((resolve, reject) => {
          ffmpeg(tempIn)
            .audioChannels(1)
            .format('f32le')
            .output(tempRaw)
            .on('end', resolve)
            .on('error', reject)
            .run();
        });

        // Load samples
        const rawBuffer = fs.readFileSync(tempRaw);
        const samples = new Float32Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength / 4);
        
        audioDataMap.set(segment.id, {
          samples,
          sampleRate: segment.sample_rate || 32000
        });
        
        // Cleanup
        try { fs.unlinkSync(tempIn); } catch {}
        try { fs.unlinkSync(tempRaw); } catch {}
        
      } catch (error) {
        console.error(`Failed to load audio for segment ${segment.id}:`, error);
      }
    });
    
    await Promise.all(downloadPromises);
    return audioDataMap;
  }

  /**
   * Analyze audio characteristics to determine optimal detection parameters
   * FIXED: Added missing method
   */
  async analyzeAudioCharacteristics(samples, sampleRate) {
    console.log('🔍 Analyzing audio characteristics for parameter adaptation...');

    // Analyze first portion of audio (configurable window)
    const analysisWindowSamples = Math.min(
      samples.length,
      Math.floor(this.config.adaptationAnalysisWindowSec * sampleRate)
    );
    const analysisSamples = samples.slice(0, analysisWindowSamples);

    // Extract features for analysis
    const analysisFeatures = this.extractOptimizedFeatures(analysisSamples, sampleRate);
    if (!analysisFeatures) return null;

    // 1. Estimate overall SNR and noise characteristics
    const snrAnalysis = this.estimateSignalToNoiseRatio(analysisFeatures);

    // 2. Analyze temporal variability (dawn chorus vs steady noise)
    const variabilityAnalysis = this.analyzeTemporalVariability(analysisFeatures);

    // 3. Analyze frequency content (birds vs insects vs wind)
    const frequencyAnalysis = this.analyzeFrequencyContent(analysisFeatures);

    // 4. Detect environment type (quiet forest, noisy urban, etc.)
    const environmentType = this.classifyEnvironmentType(snrAnalysis, variabilityAnalysis, frequencyAnalysis);

    return {
      estimatedSNR: snrAnalysis.snrDb,
      noiseFloor: snrAnalysis.noiseFloor,
      signalLevel: snrAnalysis.signalLevel,
      variabilityScore: variabilityAnalysis.variabilityScore,
      temporalPattern: variabilityAnalysis.pattern,
      dominantFreqRange: frequencyAnalysis.dominantRange,
      spectralSpread: frequencyAnalysis.spectralSpread,
      environmentType: environmentType,
      adaptationConfidence: Math.min(snrAnalysis.confidence, variabilityAnalysis.confidence)
    };
  }

  /**
   * Post-process events with filtering and refinement
   * NEW: Implements proper post-processing as requested
   */
  postProcessEvents(events) {
    if (!events || events.length === 0) return [];
    
    console.log(`🔧 Post-processing ${events.length} events...`);
    
    // Log event durations before processing
    events.forEach((event, index) => {
      const duration = event.end_ms - event.start_ms;
      console.log(`🔍 Event ${index + 1}: ${event.start_ms}ms - ${event.end_ms}ms (duration: ${duration}ms)`);
    });
    
    // Step 1: Filter by duration and confidence
    const filteredEvents = events.filter(event => {
      const duration = event.end_ms - event.start_ms;
      const confidence = event.confidence || 0;
      
      // Filter criteria:
      // - Duration >= 50ms (too short = noise)
      // - Duration <= 10s (too long = background)
      // - Confidence >= 0.3 (minimum confidence threshold)
      const isValidDuration = duration >= 50 && duration <= 10000;
      const isValidConfidence = confidence >= 0.3;
      
      // Enhanced logging to debug filtering
      console.log(`🔍 Event ${event.id || 'unknown'}: duration=${duration}ms, confidence=${(confidence * 100).toFixed(1)}%, valid_duration=${isValidDuration}, valid_confidence=${isValidConfidence}`);
      
      if (!isValidDuration) {
        console.log(`❌ Filtered out event: duration ${duration}ms (${duration < 50 ? 'too short' : 'too long'})`);
      }
      if (!isValidConfidence) {
        console.log(`❌ Filtered out event: confidence ${(confidence * 100).toFixed(1)}% (too low)`);
      }
      
      return isValidDuration && isValidConfidence;
    });
    
    console.log(`📊 After duration/confidence filtering: ${filteredEvents.length} events`);
    
    // Step 2: Merge overlapping events (within 100ms)
    const mergedEvents = this.mergeOverlappingEventsWithin100ms(filteredEvents);
    
    console.log(`📊 After overlap merging: ${mergedEvents.length} events`);
    
    // Log event durations after merging
    mergedEvents.forEach((event, index) => {
      const duration = event.end_ms - event.start_ms;
      console.log(`🔍 Merged Event ${index + 1}: ${event.start_ms}ms - ${event.end_ms}ms (duration: ${duration}ms)`);
    });
    
    // Step 3: Final validation - ensure no events with duration < 50ms make it through
    const finalEvents = mergedEvents.filter(event => {
      const duration = event.end_ms - event.start_ms;
      if (duration < 50) {
        console.log(`🚨 CRITICAL: Event with duration ${duration}ms still present after filtering!`);
        return false;
      }
      return true;
    });
    
    console.log(`📊 Final validation: ${finalEvents.length} events (removed ${mergedEvents.length - finalEvents.length} short events)`);
    
    return finalEvents;
  }
  
  /**
   * Merge overlapping events within 100ms window
   * NEW: Implements the 100ms overlap merging as requested
   */
  mergeOverlappingEventsWithin100ms(events) {
    if (events.length <= 1) return events;
    
    // Sort by start time
    events.sort((a, b) => a.start_ms - b.start_ms);
    
    const merged = [];
    let current = { ...events[0] };
    
    for (let i = 1; i < events.length; i++) {
      const next = events[i];
      
      // Check if events overlap or are within 100ms of each other
      const gap = next.start_ms - current.end_ms;
      const overlapStart = Math.max(current.start_ms, next.start_ms);
      const overlapEnd = Math.min(current.end_ms, next.end_ms);
      const overlapDuration = overlapEnd - overlapStart;
      
      // Merge if:
      // 1. Events overlap significantly (>0ms overlap)
      // 2. Events are within 100ms of each other (gap <= 100ms)
      if (overlapDuration > 0 || gap <= 100) {
        console.log(`🔗 Merging events: gap=${gap}ms, overlap=${overlapDuration}ms`);
        
        // Create merged event with best properties from both
        current.start_ms = Math.min(current.start_ms, next.start_ms);
        current.end_ms = Math.max(current.end_ms, next.end_ms);
        current.confidence = Math.max(current.confidence || 0, next.confidence || 0);
        
        // Keep frequency bounds if available
        if (next.f_min_hz !== undefined && current.f_min_hz !== undefined) {
          current.f_min_hz = Math.min(current.f_min_hz, next.f_min_hz);
        }
        if (next.f_max_hz !== undefined && current.f_max_hz !== undefined) {
          current.f_max_hz = Math.max(current.f_max_hz, next.f_max_hz);
        }
        
        // Keep the higher SNR data
        if ((next.snr_db || -Infinity) > (current.snr_db || -Infinity)) {
          current.snr_db = next.snr_db;
          current.peak_freq_hz = next.peak_freq_hz;
          current.band_name = next.band_name;
        }
        
        // Update method to indicate merging
        current.method = current.method ? `${current.method}+merged` : 'merged';
        
      } else {
        // No overlap, add current event and move to next
        merged.push(current);
        current = { ...next };
      }
    }
    
    // Add the last event
    merged.push(current);
    
    return merged;
  }
}

export default OptimizedAED;
