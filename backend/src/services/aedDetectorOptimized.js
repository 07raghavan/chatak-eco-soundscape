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
 */
export class OptimizedAED {
  constructor(config = {}) {
    this.config = {
      // STFT Parameters - maintained higher quality but faster implementation
      nFFT: 1024,          // Reduced FFT size for speed
      hopMs: 5,            // Keep fine temporal resolution for birds (critical!)
      winMs: 25,           
      
      // Feature complexity - increased from original optimized version
      nMels: 128,          // Increased mel bins for bird vocalization detection
      
      // Detection parameters - Will be dynamically adapted based on audio
      baselineWindowSec: 60,     // Default, will adapt 30-120s based on audio variability
      adaptiveWindowSec: 3,      // Keep short for local adaptation

      // Hysteresis thresholds - Will be dynamically set based on noise analysis
      onsetThresholdDb: 6.0,     // Default K_on, will adapt 3-12dB based on SNR
      offsetThresholdDb: 3.0,    // Default K_off, will maintain ratio with K_on

      // Streaming processing parameters
      chunkDurationSec: 120,     // Process in 120s chunks
      chunkOverlapSec: 1,        // 1s overlap between chunks

      // Enhanced feature parameters
      enableLogMel: true,        // Use log-mel features for stability
      enableSpectralWhitening: true, // Optional spectral whitening
      melFilterBanks: 64,        // 64-128 mel bins as suggested

      // Hardware calibration parameters
      enableHardwareCalibration: true,  // Enable device-specific calibration
      deviceCalibrationDb: 0.0,         // Device-specific dB offset (will be auto-detected)
      frequencyResponseCorrection: null, // Device-specific frequency response curve

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
      
      // Bird-optimized frequency bands
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
      
      ...config
    };

    // Progress callback
    this.onProgress = null;
  }

  setProgressCallback(callback) {
    this.onProgress = callback;
  }

  /**
   * High-speed processing with parallel segment analysis
   */
  async runForRecording(recordingId, approvedSegments, options = {}) {
    console.log(`🚀 Starting optimized AED for recording ${recordingId} with ${approvedSegments.length} segments`);
    
    if (approvedSegments.length === 0) return [];

    this.reportProgress(0, 'Initializing...');
    
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
        
        const events = await this.detectForSegmentOptimized(segment, audioData);
        
        // Map to recording coordinates
        return events.map(event => ({
          ...event,
          start_ms: segment.start_ms + event.start_ms,
          end_ms: segment.start_ms + event.end_ms,
          segment_id: segment.id
        }));
      });
      
      const batchResults = await Promise.all(batchPromises);
      allEvents.push(...batchResults.flat());
    }
    
    this.reportProgress(80, 'Merging events...');
    
    // Fast merge of nearby events
    const mergedEvents = this.fastMergeEvents(allEvents);
    
    this.reportProgress(90, 'Saving to database...');
    
    // Batch insert events
    const storedEvents = await this.batchInsertEvents(recordingId, mergedEvents);
    
    this.reportProgress(100, 'Complete!');
    
    console.log(`✅ Optimized AED completed: ${storedEvents.length} events detected`);
    return storedEvents;
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
   */
  async detectForSegmentOptimized(segment, audioData) {
    const { samples, sampleRate } = audioData;
    if (!samples || samples.length === 0) return [];

    // Skip hardware calibration - not needed and causing issues
    const hardwareCalibration = null;

    // Analyze audio characteristics and adapt parameters dynamically
    const audioProfile = this.config.enableDynamicAdaptation
      ? await this.analyzeAudioCharacteristics(samples, sampleRate)
      : null;

    // Adapt detection parameters based on audio analysis and hardware calibration
    let adaptedConfig = audioProfile
      ? this.adaptParametersToAudio(audioProfile)
      : this.config;

    // Apply hardware calibration adjustments
    if (hardwareCalibration && hardwareCalibration.confidence > 0.5) {
      adaptedConfig = {
        ...adaptedConfig,
        onsetThresholdDb: adaptedConfig.onsetThresholdDb + hardwareCalibration.dbOffset,
        offsetThresholdDb: adaptedConfig.offsetThresholdDb + hardwareCalibration.dbOffset,
        deviceCalibrationDb: hardwareCalibration.dbOffset
      };
      console.log(`🔧 Hardware calibration applied: ${hardwareCalibration.deviceType} (+${hardwareCalibration.dbOffset.toFixed(1)}dB)`);
    }

    console.log(`🎵 Audio Analysis: ${audioProfile ?
      `SNR=${audioProfile.estimatedSNR.toFixed(1)}dB, Variability=${audioProfile.variabilityScore.toFixed(2)}, Environment=${audioProfile.environmentType}` :
      'Using default parameters'}`);

    // Calculate chunk parameters
    const chunkSamples = Math.floor(adaptedConfig.chunkDurationSec * sampleRate);
    const overlapSamples = Math.floor(adaptedConfig.chunkOverlapSec * sampleRate);

    // If audio is short enough, process directly without chunking
    if (samples.length <= chunkSamples) {
      return this.processAudioChunk(samples, sampleRate, 0, null, adaptedConfig);
    }

    // Process in streaming chunks with continuous re-analysis
    const allEvents = [];
    let carryOverBaseline = null;
    let chunkStartSample = 0;
    let currentAdaptedConfig = adaptedConfig;
    let lastReAnalysisTime = 0;

    while (chunkStartSample < samples.length) {
      const chunkEndSample = Math.min(chunkStartSample + chunkSamples, samples.length);
      const chunkSamples_data = samples.slice(chunkStartSample, chunkEndSample);
      const currentTimeMs = chunkStartSample / sampleRate * 1000;

      // Re-analyze environment periodically to handle changing conditions
      if (currentTimeMs - lastReAnalysisTime >= this.config.reAnalysisIntervalSec * 1000) {
        console.log(`🔄 Re-analyzing environment at ${(currentTimeMs/1000/60).toFixed(1)} minutes...`);

        // Analyze current chunk for environment changes
        const reAnalysisProfile = await this.analyzeAudioCharacteristics(chunkSamples_data, sampleRate);

        if (reAnalysisProfile && reAnalysisProfile.adaptationConfidence > 0.3) {
          // Smooth transition to new parameters to avoid abrupt changes
          const newAdaptedConfig = this.adaptParametersToAudio(reAnalysisProfile);
          currentAdaptedConfig = this.smoothParameterTransition(currentAdaptedConfig, newAdaptedConfig);

          console.log(`🎛️ Environment change detected: ${reAnalysisProfile.environmentType}`);
        }

        lastReAnalysisTime = currentTimeMs;
      }

      // Process chunk with baseline continuity and current adapted config
      const chunkEvents = await this.processAudioChunk(
        chunkSamples_data,
        sampleRate,
        currentTimeMs, // offset in ms
        carryOverBaseline,
        currentAdaptedConfig
      );

      // Add events with time offset correction
      allEvents.push(...chunkEvents);

      // Prepare for next chunk
      chunkStartSample += chunkSamples - overlapSamples;

      // Extract baseline for next chunk (last few seconds)
      const baselineCarryFrames = Math.floor(this.config.baselineWindowSec * 1000 / this.config.hopMs);
      if (chunkEvents.length > 0) {
        // This would need to be extracted from the chunk processing
        carryOverBaseline = null; // Simplified for now
      }
    }

    // Merge overlapping events from chunk boundaries
    return this.mergeChunkBoundaryEvents(allEvents);
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
   * Enhanced feature extraction with log-mel and optional spectral whitening
   * More stable features for adaptive thresholding
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

    // Fast STFT with optimized FFT
    const spectrogram = this.computeOptimizedSTFT(samples, winSamples, hopSamples);
    if (!spectrogram) {
      console.warn('⚠️ STFT computation failed');
      return null;
    }

    // Enhanced mel-scale conversion with more bins (64-128 as suggested)
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
   * Fallback to original feature extraction for compatibility
   */
  extractOptimizedFeatures(samples, sampleRate) {
    return this.extractEnhancedFeatures(samples, sampleRate, null);
  }

  /**
   * Enhanced mel-spectrogram with configurable number of mel bins
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

    // Create mel filter bank with correct parameter order
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
   * Apply log-mel transformation for more stable features
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
   * Optimized STFT with reduced FFT points and faster computation
   */
  computeOptimizedSTFT(samples, winSamples, hopSamples) {
    // Validate inputs
    if (!samples || samples.length === 0) {
      console.warn('⚠️ Empty samples for STFT');
      return null;
    }

    const nFrames = Math.floor((samples.length - winSamples) / hopSamples) + 1;
    const nFreqBins = this.config.nFFT / 2;

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
      const frame = new Float32Array(this.config.nFFT);

      // Extract and window frame
      const end = Math.min(start + winSamples, samples.length);
      let hasValidData = false;

      for (let i = 0; i < end - start; i++) {
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
   * Fast Hanning window generation
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
   * Fixed to handle non-power-of-2 inputs and prevent NaN values
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

  bitReverse(num, bits) {
    let result = 0;
    for (let i = 0; i < bits; i++) {
      result = (result << 1) | (num & 1);
      num >>= 1;
    }
    return result;
  }

  /**
   * Fast mel-scale conversion with pre-computed filter bank
   */
  computeFastMelSpectrogram(spectrogram, sampleRate) {
    const nFreqBins = spectrogram.length;
    const nFrames = spectrogram[0].length;
    const nMels = this.config.nMels;
    
    // Create mel filter bank (cached for reuse)
    if (!this.melFilters) {
      this.melFilters = this.createMelFilterBank(nFreqBins, sampleRate, nMels);
    }
    
    const melSpec = Array(nMels).fill(null).map(() => new Float32Array(nFrames));
    
    for (let frameIdx = 0; frameIdx < nFrames; frameIdx++) {
      for (let melIdx = 0; melIdx < nMels; melIdx++) {
        let energy = 0;
        const filter = this.melFilters[melIdx];
        
        for (let freqIdx = 0; freqIdx < nFreqBins; freqIdx++) {
          energy += spectrogram[freqIdx][frameIdx] * filter[freqIdx];
        }
        
        melSpec[melIdx][frameIdx] = 10 * Math.log10(Math.max(energy, 1e-10));
      }
    }
    
    return melSpec;
  }

  /**
   * Optimized energy-based event detection
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
   * Improved band event detection with adaptive thresholding
   */
  detectBandEventsOptimized(features, band) {
    const { mel, nFrames, frameDurationMs } = features;
    const nyquist = features.sampleRate / 2;
    
    // Map frequency band to mel indices
    const startMel = Math.floor((band.fmin / nyquist) * this.config.nMels);
    const endMel = Math.ceil((band.fmax / nyquist) * this.config.nMels);
    
    // Compute band energy
    const bandEnergy = new Float32Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
      let energy = 0;
      for (let m = startMel; m <= endMel && m < this.config.nMels; m++) {
        energy += mel[m][t];
      }
      bandEnergy[t] = energy / Math.max(1, endMel - startMel + 1);
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
    
    return events;
  }

  /**
   * Enhanced rolling baseline using trailing median for adaptive per-band processing
   * Uses longer window (30-120s) and more efficient approach for memory management
   */
  computeOptimizedBaseline(signal) {
    const nFrames = signal.length;
    const baseline = new Float32Array(nFrames);
    const windowFrames = Math.floor((this.config.baselineWindowSec * 1000) / this.config.hopMs);

    // Use circular buffer for efficient rolling median computation
    const windowBuffer = [];
    let bufferIndex = 0;

    for (let t = 0; t < nFrames; t++) {
      // Add current sample to circular buffer
      if (windowBuffer.length < windowFrames) {
        windowBuffer.push(signal[t]);
      } else {
        windowBuffer[bufferIndex] = signal[t];
        bufferIndex = (bufferIndex + 1) % windowFrames;
      }

      // Compute trailing median (only look backward for true trailing baseline)
      if (t >= Math.min(windowFrames, Math.floor(windowFrames * 0.3))) {
        const sortedBuffer = [...windowBuffer].sort((a, b) => a - b);
        baseline[t] = sortedBuffer[Math.floor(sortedBuffer.length / 2)];
      } else {
        // For initial frames, use expanding window
        const sortedWindow = signal.slice(0, t + 1).sort((a, b) => a - b);
        baseline[t] = sortedWindow[Math.floor(sortedWindow.length / 2)];
      }
    }

    return baseline;
  }

  /**
   * Memory-efficient streaming baseline for chunk processing
   * Carries over baseline state between chunks to maintain continuity
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

    // Efficient rolling median using sorted insertion for memory efficiency
    const sortedWindow = [...initBuffer].sort((a, b) => a - b);

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

      // Remove oldest sample if window exceeds size
      if (sortedWindow.length > windowFrames) {
        const removeIndex = t - windowFrames + initBuffer.length;
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
   */
  computeOptimizedThreshold(signal, baseline) {
    const nFrames = signal.length;
    const onsetThreshold = new Float32Array(nFrames);
    const offsetThreshold = new Float32Array(nFrames);

    // Convert dB thresholds to linear scale
    const konLinear = Math.pow(10, this.config.onsetThresholdDb / 20);
    const koffLinear = Math.pow(10, this.config.offsetThresholdDb / 20);

    for (let t = 0; t < nFrames; t++) {
      // Hysteresis thresholds: K_on > K_off for stable event boundaries
      onsetThreshold[t] = baseline[t] * konLinear;   // baseline + K_on dB
      offsetThreshold[t] = baseline[t] * koffLinear; // baseline + K_off dB
    }

    return {
      onset: onsetThreshold,
      offset: offsetThreshold
    };
  }

  /**
   * Alternative adaptive threshold with local noise estimation
   * Fallback for very noisy environments where fixed dB thresholds don't work
   */
  computeAdaptiveThreshold(signal, baseline) {
    const nFrames = signal.length;
    const threshold = new Float32Array(nFrames);
    const windowFrames = Math.floor((this.config.adaptiveWindowSec * 1000) / this.config.hopMs);

    // Use reduced sampling for efficiency
    const samplingRate = 3;

    for (let t = 0; t < nFrames; t += samplingRate) {
      const start = Math.max(0, t - windowFrames);
      const end = Math.min(nFrames, t + windowFrames);

      // Compute local noise statistics
      let sum = 0;
      let count = 0;
      for (let i = start; i < end; i += samplingRate) {
        const residual = signal[i] - baseline[i];
        if (residual > 0) { // Only consider positive residuals for noise estimation
          sum += residual;
          count++;
        }
      }
      const meanNoise = count > 0 ? sum / count : 0;

      // Compute noise variance
      let variance = 0;
      for (let i = start; i < end; i += samplingRate) {
        const residual = signal[i] - baseline[i];
        if (residual > 0) {
          const diff = residual - meanNoise;
          variance += diff * diff;
        }
      }
      const noiseStd = Math.sqrt(variance / Math.max(1, count));

      // Adaptive threshold based on local noise characteristics
      threshold[t] = baseline[t] + meanNoise + (noiseStd * 2.5);

      // Interpolate for skipped points
      if (t > 0 && t - samplingRate >= 0) {
        const prevValue = threshold[t - samplingRate];
        const step = (threshold[t] - prevValue) / samplingRate;
        for (let i = 1; i < samplingRate && t - samplingRate + i < nFrames; i++) {
          threshold[t - samplingRate + i] = prevValue + (step * i);
        }
      }
    }

    // Fill in any remaining values
    for (let t = 0; t < nFrames; t++) {
      if (threshold[t] === 0 && t > 0) {
        threshold[t] = threshold[t-1];
      }
    }

    return { onset: threshold, offset: threshold };
  }
  
  /**
   * Legacy fast threshold computation using percentiles
   */
  computeFastThreshold(signal) {
    const sorted = Array.from(signal).sort((a, b) => a - b);
    const p75 = sorted[Math.floor(sorted.length * 0.75)];
    const p50 = sorted[Math.floor(sorted.length * 0.50)];
    return p50 + (p75 - p50) * this.config.onsetThresholdSigma;
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
   */
  filterAndRefineEvents(events) {
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
   */
  async batchInsertEvents(recordingId, events) {
    if (events.length === 0) return [];
    
    // Clear existing events
    await db.query(`DELETE FROM aed_events WHERE recording_id = :recordingId`, {
      replacements: { recordingId },
      type: QueryTypes.DELETE
    });
    
    // Batch insert - prepare values
    const values = events.map((event, idx) => ({
      recordingId: recordingId,
      segmentId: event.segment_id,
      startMs: event.start_ms,
      endMs: event.end_ms,
      fmin: event.f_min_hz || null,
      fmax: event.f_max_hz || null,
      peak: event.peak_freq_hz || null,
      snr: event.snr_db || null,
      conf: event.confidence || 0.5,
      method: 'optimized-v1',
      version: '1.0'
    }));
    
    // Build batch insert query
    const placeholders = values.map((_, idx) => 
      `(:recordingId${idx}, :segmentId${idx}, :startMs${idx}, :endMs${idx}, :fmin${idx}, :fmax${idx}, :peak${idx}, :snr${idx}, :conf${idx}, :method${idx}, :version${idx}, NULL)`
    ).join(', ');
    
    const replacements = {};
    values.forEach((v, idx) => {
      replacements[`recordingId${idx}`] = v.recordingId;
      replacements[`segmentId${idx}`] = v.segmentId;
      replacements[`startMs${idx}`] = v.startMs;
      replacements[`endMs${idx}`] = v.endMs;
      replacements[`fmin${idx}`] = v.fmin;
      replacements[`fmax${idx}`] = v.fmax;
      replacements[`peak${idx}`] = v.peak;
      replacements[`snr${idx}`] = v.snr;
      replacements[`conf${idx}`] = v.conf;
      replacements[`method${idx}`] = v.method;
      replacements[`version${idx}`] = v.version;
    });
    
    const insertedEvents = await db.query(`
      INSERT INTO aed_events (
        recording_id, segment_id, start_ms, end_ms, f_min_hz, f_max_hz, peak_freq_hz, 
        snr_db, confidence, method, method_version, snippet_s3_key
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
      verdict: 'detected',
      notes: `Optimized method v1.0`
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
   * Estimate peak frequency for an event
   */
  estimatePeakFrequency(features, band, startFrame, endFrame) {
    // Use mel spectrogram since raw spectrogram is not available
    const { mel, sampleRate } = features;
    if (!mel || !mel.length) {
      // Return band center frequency as fallback
      return (band.fmin + band.fmax) / 2;
    }

    const nMels = mel.length;
    const nyquist = sampleRate / 2;

    // Map band to mel bins (approximate)
    const melToFreq = (mel) => 700 * (Math.exp(mel / 1127) - 1);
    const freqToMel = (freq) => 1127 * Math.log(1 + freq / 700);

    const startMel = Math.floor(freqToMel(band.fmin) * nMels / freqToMel(nyquist));
    const endMel = Math.ceil(freqToMel(band.fmax) * nMels / freqToMel(nyquist));

    // Find peak mel bin over the event duration
    let maxEnergy = -Infinity;
    let peakMel = Math.floor((startMel + endMel) / 2); // Default to band center

    for (let m = Math.max(0, startMel); m <= Math.min(endMel, nMels - 1); m++) {
      let energy = 0;
      let validFrames = 0;
      for (let t = startFrame; t <= endFrame && t < mel[m].length; t++) {
        if (Number.isFinite(mel[m][t])) {
          energy += mel[m][t];
          validFrames++;
        }
      }

      if (validFrames > 0 && energy > maxEnergy) {
        maxEnergy = energy;
        peakMel = m;
      }
    }

    // Convert bin to frequency
    // Convert mel bin back to frequency
    const peakFreq = melToFreq(peakMel * freqToMel(nyquist) / nMels);
    return Number.isFinite(peakFreq) ? peakFreq : (band.fmin + band.fmax) / 2;
  }
  
  /**
   * Create mel filter bank with debugging
   */
  createMelFilterBank(nFreqs, sr, nMels) {
    console.log(`🎼 Creating mel filter bank: ${nFreqs} freq bins, ${sr}Hz sample rate, ${nMels} mel bins`);

    const filters = Array(nMels).fill(null).map(() => new Float32Array(nFreqs));
    const mel = (f) => 2595 * Math.log10(1 + f / 700);
    const invMel = (m) => 700 * (Math.pow(10, m / 2595) - 1);
    const fMin = 0, fMax = sr / 2;
    const mMin = mel(fMin), mMax = mel(fMax);
    const centers = [];

    console.log(`🔧 Frequency range: ${fMin}Hz - ${fMax}Hz, Mel range: ${mMin.toFixed(1)} - ${mMax.toFixed(1)}`);

    for (let i = 0; i < nMels + 2; i++) {
      centers.push(invMel(mMin + (i * (mMax - mMin)) / (nMels + 1)));
    }

    const bins = centers.map((f) => Math.floor((f / fMax) * (nFreqs - 1)));

    console.log(`🔧 Filter centers (Hz): ${centers.slice(0, 5).map(f => f.toFixed(0)).join(', ')}...`);
    console.log(`🔧 Filter bins: ${bins.slice(0, 5).join(', ')}...`);

    let totalFilterWeight = 0;
    for (let m = 0; m < nMels; m++) {
      const left = bins[m], center = bins[m + 1], right = bins[m + 2];
      let filterSum = 0;

      for (let k = left; k < center; k++) {
        if (k >= 0 && k < nFreqs) {
          const weight = (k - left) / Math.max(1, center - left);
          filters[m][k] = weight;
          filterSum += weight;
        }
      }
      for (let k = center; k < right; k++) {
        if (k >= 0 && k < nFreqs) {
          const weight = (right - k) / Math.max(1, right - center);
          filters[m][k] = weight;
          filterSum += weight;
        }
      }

      totalFilterWeight += filterSum;
    }

    console.log(`✅ Mel filter bank created: total filter weight = ${totalFilterWeight.toFixed(3)}`);

    if (totalFilterWeight < 0.1) {
      console.warn('⚠️ Very low total filter weight - filters may be incorrectly positioned');
    }

    return filters;
  }

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
}

export default OptimizedAED;
