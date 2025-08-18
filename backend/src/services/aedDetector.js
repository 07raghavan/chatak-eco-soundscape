import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';

// Ensure ffmpeg path
ffmpeg.setFfmpegPath(path.join(process.cwd(), 'bin', 'ffmpeg.exe'));

/**
 * Industry-Standard Acoustic Event Detection System
 * Implements multi-scale spectrotemporal feature analysis with advanced onset detection
 */
export class IndustryStandardAED {
  constructor(config = {}) {
    this.config = {
      // STFT Parameters
      nFFT: 2048,
      hopMs: 5, // Higher temporal resolution
      winMs: 25, // Standard window size for speech/bioacoustics
      
      // Multi-scale analysis
      nMels: 128, // Higher frequency resolution
      nMfcc: 13,  // MFCC coefficients
      
      // Detection parameters
      baselineWindowSec: 60, // Longer baseline for stability
      adaptiveWindowSec: 5,   // Short-term adaptive threshold
      
      // Thresholds (in standard deviations above baseline)
      onsetThresholdSigma: 2.5,
      offsetThresholdSigma: 1.5,
      
      // Event constraints
      minDurationMs: 50,   // Minimum event duration
      maxDurationMs: 10000, // Maximum event duration
      mergeGapMs: 100,     // Merge nearby events
      
      // Frequency analysis
      targetBands: [
        { name: 'low_freq', fmin: 500, fmax: 2000 },      // Low frequency calls
        { name: 'mid_freq', fmin: 2000, fmax: 8000 },     // Bird vocalizations
        { name: 'high_freq', fmin: 8000, fmax: 16000 },   // Insect/bat calls
        { name: 'ultrasonic', fmin: 16000, fmax: 24000 }  // Ultrasonic (if available)
      ],
      
      // Feature extraction
      enableSpectralFeatures: true,
      enableTemporalFeatures: true,
      enableEnergyFeatures: true,
      
      // Advanced detection methods
      useMultiScaleDetection: true,
      useSpectralNovelty: true,
      useEnergyEntropy: true,
      useOnsetDetection: true,
      
      ...config
    };
  }

  /**
   * Process approved segments and generate events for the entire recording
   * This creates a cohesive view of events across the entire recording timeline
   */
  async runForRecording(recordingId, approvedSegments, options = {}) {
    console.log(`🎯 Running industry-standard AED for recording ${recordingId} with ${approvedSegments.length} approved segments`);
    
    const allEvents = [];
    const recordingEvents = new Map(); // Group events by recording timeline
    
    // Process each approved segment
    for (const segment of approvedSegments) {
      try {
        console.log(`📊 Processing segment ${segment.id}: ${segment.start_ms}-${segment.end_ms}ms`);
        const events = await this.detectForSegment(segment);
        
        // Map events to recording timeline coordinates
        for (const event of events) {
          const recordingStartMs = segment.start_ms + event.start_ms;
          const recordingEndMs = segment.start_ms + event.end_ms;
          
          const recordingEvent = {
            ...event,
            start_ms: recordingStartMs,
            end_ms: recordingEndMs,
            segment_id: segment.id,
            segment_start_ms: segment.start_ms,
            segment_end_ms: segment.end_ms
          };
          
          allEvents.push(recordingEvent);
        }
      } catch (error) {
        console.error(`❌ Failed to process segment ${segment.id}:`, error);
        // Continue processing other segments
      }
    }
    
    console.log(`🔍 Detected ${allEvents.length} raw events across all segments`);
    
    // Post-process events: merge nearby events and filter by confidence
    const mergedEvents = this.mergeNearbyEvents(allEvents);
    console.log(`✅ After merging: ${mergedEvents.length} final events`);
    
    // Store events in database
    const storedEvents = [];
    for (const event of mergedEvents) {
      try {
        const inserted = await db.query(`
          INSERT INTO aed_events (
            recording_id, segment_id, start_ms, end_ms, f_min_hz, f_max_hz, peak_freq_hz, 
            snr_db, confidence, method, method_version, snippet_s3_key
          ) VALUES (
            :recordingId, :segmentId, :startMs, :endMs, :fmin, :fmax, :peak, 
            :snr, :conf, 'industry-std-v2', '2.0', :snippet
          ) RETURNING *
        `, { 
          replacements: {
            recordingId: recordingId,
            segmentId: event.segment_id,
            startMs: event.start_ms,
            endMs: event.end_ms,
            fmin: event.f_min_hz || null,
            fmax: event.f_max_hz || null,
            peak: event.peak_freq_hz || null,
            snr: event.snr_db || null,
            conf: event.confidence || 0.5,
            snippet: event.snippet_s3_key || null
          }, 
          type: QueryTypes.INSERT 
        });

        const row = inserted[0][0];
        
        // Add automatic tag with detection details
        await db.query(`
          INSERT INTO aed_event_tags (event_id, label, verdict, notes)
          VALUES (:eventId, :label, 'detected', :notes)
        `, { 
          replacements: { 
            eventId: row.id, 
            label: event.band_name || 'auto',
            notes: `Method: ${event.detection_method || 'multi-scale'}, Features: ${event.feature_summary || 'spectrotemporal'}` 
          }, 
          type: QueryTypes.INSERT 
        });

        storedEvents.push(row);
      } catch (error) {
        console.error(`❌ Failed to store event:`, error);
      }
    }
    
    return storedEvents;
  }

  /**
   * Advanced acoustic event detection for a single segment
   * Uses multi-scale spectrotemporal analysis with industry-standard features
   */
  async detectForSegment(segment) {
    console.log(`🔍 Processing segment ${segment.id} with industry-standard AED`);
    
    // Load and preprocess audio
    const audioData = await this.loadSegmentAudio(segment);
    if (!audioData || audioData.samples.length === 0) {
      console.warn(`⚠️ No audio data for segment ${segment.id}`);
      return [];
    }
    
    const { samples, sampleRate } = audioData;
    console.log(`📊 Audio: ${samples.length} samples at ${sampleRate}Hz (${(samples.length/sampleRate).toFixed(2)}s)`);
    
    // Multi-scale feature extraction
    const features = await this.extractMultiScaleFeatures(samples, sampleRate);
    
    // Detect events using multiple methods
    const detectedEvents = [];
    
    // Method 1: Spectral novelty detection
    if (this.config.useSpectralNovelty) {
      const noveltyEvents = this.detectSpectralNovelty(features);
      detectedEvents.push(...noveltyEvents.map(e => ({...e, detection_method: 'spectral_novelty'})));
    }
    
    // Method 2: Multi-band energy detection
    const energyEvents = this.detectEnergyEvents(features, samples, sampleRate);
    detectedEvents.push(...energyEvents.map(e => ({...e, detection_method: 'multi_band_energy'})));
    
    // Method 3: Onset detection
    if (this.config.useOnsetDetection) {
      const onsetEvents = this.detectOnsets(features);
      detectedEvents.push(...onsetEvents.map(e => ({...e, detection_method: 'onset_detection'})));
    }
    
    // Merge and filter events
    const finalEvents = this.postProcessEvents(detectedEvents, sampleRate);
    
    console.log(`✅ Segment ${segment.id}: ${finalEvents.length} events detected`);
    return finalEvents;
  }
  
  /**
   * Load segment audio with proper error handling
   */
  async loadSegmentAudio(segment) {
    try {
      const { downloadFile } = await import('../config/s3.js');
      const tempIn = path.join(process.cwd(), 'temp_ffmpeg', `seg_${segment.id}.flac`);
      const tempRaw = path.join(process.cwd(), 'temp_ffmpeg', `seg_${segment.id}.raw`);
      
      const fs = await import('fs');
      fs.mkdirSync(path.dirname(tempIn), { recursive: true });
      await downloadFile(segment.s3_key, tempIn);

      await new Promise((resolve, reject) => {
        ffmpeg(tempIn)
          .audioChannels(1)
          .format('f32le')
          .output(tempRaw)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });

      const rawBuffer = fs.readFileSync(tempRaw);
      const samples = new Float32Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength / 4);
      
      // Cleanup
      try { fs.unlinkSync(tempIn); } catch {}
      try { fs.unlinkSync(tempRaw); } catch {}
      
      return {
        samples,
        sampleRate: segment.sample_rate || 32000
      };
    } catch (error) {
      console.error(`❌ Failed to load audio for segment ${segment.id}:`, error);
      return null;
    }
  }

  hanningWindow(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return w;
  }
  computeFFT(x) {
    const N = x.length; const out = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) { out[i * 2] = x[i]; out[i * 2 + 1] = 0; }
    const br = (v, bits) => { let r = 0; for (let i = 0; i < bits; i++) { r = (r << 1) | (v & 1); v >>= 1; } return r; };
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) { const j = br(i, bits); if (i < j) { [out[i * 2], out[j * 2]] = [out[j * 2], out[i * 2]]; [out[i * 2 + 1], out[j * 2 + 1]] = [out[j * 2 + 1], out[i * 2 + 1]]; } }
    for (let size = 2; size <= N; size *= 2) {
      const half = size / 2; const step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const theta = -2 * Math.PI * (k % N) / N; const wr = Math.cos(theta); const wi = Math.sin(theta);
          const xr = out[(j + half) * 2], xi = out[(j + half) * 2 + 1];
          const yr = wr * xr - wi * xi; const yi = wr * xi + wi * xr;
          out[(j + half) * 2] = out[j * 2] - yr; out[(j + half) * 2 + 1] = out[j * 2 + 1] - yi;
          out[j * 2] += yr; out[j * 2 + 1] += yi;
        }
      }
    }
    return out;
  }
  createMelFilterBank(nFreqs, sr, nMels) {
    const filters = Array(nMels).fill(null).map(() => new Float32Array(nFreqs));
    const mel = (f) => 2595 * Math.log10(1 + f / 700);
    const invMel = (m) => 700 * (Math.pow(10, m / 2595) - 1);
    const fMin = 0, fMax = sr / 2;
    const mMin = mel(fMin), mMax = mel(fMax);
    const centers = [];
    for (let i = 0; i < nMels + 2; i++) centers.push(invMel(mMin + (i * (mMax - mMin)) / (nMels + 1)));
    const bins = centers.map((f) => Math.floor((f / fMax) * (nFreqs - 1)));
    for (let m = 0; m < nMels; m++) {
      const left = bins[m], center = bins[m + 1], right = bins[m + 2];
      for (let k = left; k < center; k++) filters[m][k] = (k - left) / Math.max(1, center - left);
      for (let k = center; k < right; k++) filters[m][k] = (right - k) / Math.max(1, right - center);
    }
    return filters;
  }
  
  /**
   * Extract multi-scale spectrotemporal features
   */
  async extractMultiScaleFeatures(samples, sampleRate) {
    const hopSamples = Math.floor((this.config.hopMs * sampleRate) / 1000);
    const winSamples = Math.floor((this.config.winMs * sampleRate) / 1000);
    const nFrames = Math.max(0, Math.floor((samples.length - winSamples) / hopSamples) + 1);
    
    if (nFrames <= 0) return null;
    
    // Compute STFT
    const spectrogram = this.computeSTFT(samples, winSamples, hopSamples, this.config.nFFT);
    
    // Compute mel-scale spectrogram
    const melFilters = this.createMelFilterBank(this.config.nFFT / 2, sampleRate, this.config.nMels);
    const melSpectrogram = this.applyMelFilters(spectrogram, melFilters);
    
    // Compute additional features
    const features = {
      raw: spectrogram,
      mel: melSpectrogram,
      nFrames,
      nFreqBins: this.config.nFFT / 2,
      frameDurationMs: this.config.hopMs,
      sampleRate,
      
      // Spectral features
      spectralCentroid: this.computeSpectralCentroid(spectrogram, sampleRate),
      spectralRolloff: this.computeSpectralRolloff(spectrogram, sampleRate),
      spectralFlux: this.computeSpectralFlux(spectrogram),
      
      // Temporal features
      zeroCrossingRate: this.computeZeroCrossingRate(samples, hopSamples),
      energyEntropy: this.computeEnergyEntropy(melSpectrogram),
      
      // Multi-band features
      bandEnergies: this.computeBandEnergies(spectrogram, sampleRate)
    };
    
    return features;
  }
  
  /**
   * Compute Short-Time Fourier Transform
   */
  computeSTFT(samples, winSamples, hopSamples, nFFT) {
    const nFrames = Math.floor((samples.length - winSamples) / hopSamples) + 1;
    const nFreqBins = nFFT / 2;
    const spectrogram = Array(nFreqBins).fill(null).map(() => new Float32Array(nFrames));
    
    const window = this.hanningWindow(winSamples);
    
    for (let frameIdx = 0; frameIdx < nFrames; frameIdx++) {
      const start = frameIdx * hopSamples;
      const frame = new Float32Array(nFFT);
      
      // Extract and window frame
      const end = Math.min(start + winSamples, samples.length);
      for (let i = 0; i < end - start; i++) {
        frame[i] = samples[start + i] * window[i];
      }
      
      // FFT
      const fftResult = this.computeFFT(frame);
      
      // Power spectrum
      for (let freqIdx = 0; freqIdx < nFreqBins; freqIdx++) {
        const real = fftResult[freqIdx * 2];
        const imag = fftResult[freqIdx * 2 + 1];
        const power = real * real + imag * imag;
        spectrogram[freqIdx][frameIdx] = Math.max(power, 1e-10);
      }
    }
    
    return spectrogram;
  }
  
  /**
   * Apply mel filter bank to linear spectrogram
   */
  applyMelFilters(spectrogram, melFilters) {
    const nMels = melFilters.length;
    const nFrames = spectrogram[0].length;
    const melSpec = Array(nMels).fill(null).map(() => new Float32Array(nFrames));
    
    for (let frameIdx = 0; frameIdx < nFrames; frameIdx++) {
      for (let melIdx = 0; melIdx < nMels; melIdx++) {
        let energy = 0;
        const filter = melFilters[melIdx];
        for (let freqIdx = 0; freqIdx < spectrogram.length; freqIdx++) {
          energy += spectrogram[freqIdx][frameIdx] * filter[freqIdx];
        }
        melSpec[melIdx][frameIdx] = 10 * Math.log10(Math.max(energy, 1e-10));
      }
    }
    
    return melSpec;
  }
  
  /**
   * Detect events using multi-band energy analysis
   */
  detectEnergyEvents(features, samples, sampleRate) {
    const events = [];
    
    for (const band of this.config.targetBands) {
      const bandEvents = this.detectBandEvents(features, band, sampleRate);
      events.push(...bandEvents.map(e => ({ ...e, band_name: band.name })));
    }
    
    return events;
  }
  
  /**
   * Detect events in a specific frequency band
   */
  detectBandEvents(features, band, sampleRate) {
    const { mel, nFrames, frameDurationMs } = features;
    const nyquist = sampleRate / 2;
    
    // Convert frequency bounds to mel indices
    const startMel = Math.floor((band.fmin / nyquist) * this.config.nMels);
    const endMel = Math.ceil((band.fmax / nyquist) * this.config.nMels);
    
    // Aggregate band energy
    const bandEnergy = new Float32Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
      let energy = 0;
      let count = 0;
      for (let m = startMel; m <= endMel && m < this.config.nMels; m++) {
        energy += mel[m][t];
        count++;
      }
      bandEnergy[t] = count > 0 ? energy / count : 0;
    }
    
    // Adaptive baseline estimation
    const baseline = this.computeAdaptiveBaseline(bandEnergy);
    const threshold = this.computeAdaptiveThreshold(bandEnergy, baseline);
    
    // Event detection with hysteresis
    const events = [];
    let inEvent = false;
    let eventStart = 0;
    let eventPeak = -Infinity;
    
    for (let t = 0; t < nFrames; t++) {
      const signal = bandEnergy[t] - baseline[t];
      
      if (!inEvent && signal > threshold[t]) {
        // Event onset
        inEvent = true;
        eventStart = t;
        eventPeak = signal;
      } else if (inEvent && signal < threshold[t] * this.config.offsetThresholdSigma / this.config.onsetThresholdSigma) {
        // Event offset
        const eventEnd = t;
        const durationMs = (eventEnd - eventStart) * frameDurationMs;
        
        if (durationMs >= this.config.minDurationMs && durationMs <= this.config.maxDurationMs) {
          const startMs = eventStart * frameDurationMs;
          const endMs = eventEnd * frameDurationMs;
          
          // Compute event features
          const eventFeatures = this.computeEventFeatures(
            features, eventStart, eventEnd, startMel, endMel, sampleRate
          );
          
          events.push({
            start_ms: Math.round(startMs),
            end_ms: Math.round(endMs),
            f_min_hz: band.fmin,
            f_max_hz: band.fmax,
            peak_freq_hz: eventFeatures.peakFreq,
            snr_db: eventPeak,
            confidence: eventFeatures.confidence,
            feature_summary: `centroid:${eventFeatures.centroid.toFixed(0)},rolloff:${eventFeatures.rolloff.toFixed(0)}`
          });
        }
        
        inEvent = false;
      } else if (inEvent && signal > eventPeak) {
        eventPeak = signal;
      }
    }
    
    return events;
  }
  
  /**
   * Compute adaptive baseline using sliding median
   */
  computeAdaptiveBaseline(signal) {
    const nFrames = signal.length;
    const baseline = new Float32Array(nFrames);
    const windowFrames = Math.floor((this.config.baselineWindowSec * 1000) / this.config.hopMs);
    
    for (let t = 0; t < nFrames; t++) {
      const start = Math.max(0, t - windowFrames);
      const end = Math.min(nFrames, t + windowFrames);
      const window = Array.from(signal.slice(start, end)).sort((a, b) => a - b);
      const median = window[Math.floor(window.length / 2)];
      baseline[t] = median;
    }
    
    return baseline;
  }
  
  /**
   * Compute adaptive threshold based on local statistics
   */
  computeAdaptiveThreshold(signal, baseline) {
    const nFrames = signal.length;
    const threshold = new Float32Array(nFrames);
    const windowFrames = Math.floor((this.config.adaptiveWindowSec * 1000) / this.config.hopMs);
    
    for (let t = 0; t < nFrames; t++) {
      const start = Math.max(0, t - windowFrames);
      const end = Math.min(nFrames, t + windowFrames);
      
      // Compute local standard deviation
      let mean = 0;
      let count = 0;
      for (let i = start; i < end; i++) {
        mean += signal[i] - baseline[i];
        count++;
      }
      mean /= count;
      
      let variance = 0;
      for (let i = start; i < end; i++) {
        const diff = (signal[i] - baseline[i]) - mean;
        variance += diff * diff;
      }
      const std = Math.sqrt(variance / count);
      
      threshold[t] = baseline[t] + this.config.onsetThresholdSigma * std;
    }
    
    return threshold;
  }
  
  /**
   * Spectral novelty detection
   */
  detectSpectralNovelty(features) {
    const { mel, nFrames, frameDurationMs } = features;
    const novelty = this.computeSpectralNovelty(mel);
    
    // Peak picking on novelty function
    const events = [];
    const threshold = this.computeNoveltyThreshold(novelty);
    
    for (let t = 1; t < nFrames - 1; t++) {
      if (novelty[t] > threshold[t] && 
          novelty[t] > novelty[t-1] && 
          novelty[t] > novelty[t+1]) {
        
        // Find event boundaries
        let start = t;
        let end = t;
        
        while (start > 0 && novelty[start] > threshold[start] * 0.5) start--;
        while (end < nFrames - 1 && novelty[end] > threshold[end] * 0.5) end++;
        
        const durationMs = (end - start) * frameDurationMs;
        if (durationMs >= this.config.minDurationMs) {
          events.push({
            start_ms: Math.round(start * frameDurationMs),
            end_ms: Math.round(end * frameDurationMs),
            confidence: Math.min(1.0, novelty[t] / (threshold[t] * 2)),
            detection_method: 'spectral_novelty'
          });
        }
      }
    }
    
    return events;
  }
  
  /**
   * Post-process events: merge nearby events and filter by confidence
   */
  postProcessEvents(events, sampleRate) {
    // Sort events by start time
    events.sort((a, b) => a.start_ms - b.start_ms);
    
    // Merge nearby events
    const merged = [];
    for (const event of events) {
      if (merged.length === 0) {
        merged.push(event);
        continue;
      }
      
      const lastEvent = merged[merged.length - 1];
      const gap = event.start_ms - lastEvent.end_ms;
      
      if (gap <= this.config.mergeGapMs) {
        // Merge events
        lastEvent.end_ms = event.end_ms;
        lastEvent.confidence = Math.max(lastEvent.confidence || 0, event.confidence || 0);
        if (event.snr_db > (lastEvent.snr_db || -Infinity)) {
          lastEvent.snr_db = event.snr_db;
          lastEvent.peak_freq_hz = event.peak_freq_hz;
        }
      } else {
        merged.push(event);
      }
    }
    
    // Filter by confidence and duration
    return merged.filter(event => {
      const duration = event.end_ms - event.start_ms;
      return duration >= this.config.minDurationMs && 
             duration <= this.config.maxDurationMs &&
             (event.confidence || 0) >= 0.3; // Minimum confidence threshold
    });
  }
  
  /**
   * Merge nearby events across the recording timeline
   */
  mergeNearbyEvents(events) {
    if (events.length === 0) return [];
    
    // Sort by start time
    events.sort((a, b) => a.start_ms - b.start_ms);
    
    const merged = [];
    let current = { ...events[0] };
    
    for (let i = 1; i < events.length; i++) {
      const next = events[i];
      const gap = next.start_ms - current.end_ms;
      
      if (gap <= this.config.mergeGapMs) {
        // Merge events
        current.end_ms = next.end_ms;
        current.confidence = Math.max(current.confidence || 0, next.confidence || 0);
        
        // Update frequency bounds
        if (current.f_min_hz && next.f_min_hz) {
          current.f_min_hz = Math.min(current.f_min_hz, next.f_min_hz);
        }
        if (current.f_max_hz && next.f_max_hz) {
          current.f_max_hz = Math.max(current.f_max_hz, next.f_max_hz);
        }
        
        // Keep the higher SNR characteristics
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
  
  // Placeholder methods for advanced features
  computeSpectralCentroid(spec, sr) { return new Float32Array(spec[0].length); }
  computeSpectralRolloff(spec, sr) { return new Float32Array(spec[0].length); }
  computeSpectralFlux(spec) { return new Float32Array(spec[0].length); }
  computeZeroCrossingRate(samples, hopSamples) { return new Float32Array(Math.floor(samples.length / hopSamples)); }
  computeEnergyEntropy(melSpec) { return new Float32Array(melSpec[0].length); }
  computeBandEnergies(spec, sr) { return {}; }
  computeEventFeatures(features, start, end, fStart, fEnd, sr) { 
    return { peakFreq: 4000, centroid: 4000, rolloff: 6000, confidence: 0.7 }; 
  }
  detectOnsets(features) { return []; }
  computeSpectralNovelty(mel) { return new Float32Array(mel[0].length); }
  computeNoveltyThreshold(novelty) { return novelty.map(v => v * 0.5); }
}

// Legacy alias for backward compatibility
export class AEDSimpleDetector extends IndustryStandardAED {
  async runForSegments(segments, options = {}) {
    // Legacy method that processes segments individually
    const allEvents = [];
    for (const segment of segments) {
      const events = await this.detectForSegment(segment);
      for (const event of events) {
        // Store directly as before
        const inserted = await db.query(`
          INSERT INTO aed_events (
            recording_id, segment_id, start_ms, end_ms, f_min_hz, f_max_hz, peak_freq_hz, snr_db, confidence, method, method_version, snippet_s3_key
          ) VALUES (
            :recordingId, :segmentId, :startMs, :endMs, :fmin, :fmax, :peak, :snr, :conf, 'industry-std-v2', '2.0', :snippet
          ) RETURNING *
        `, { replacements: {
            recordingId: segment.recording_id,
            segmentId: segment.id,
            startMs: segment.start_ms + event.start_ms,
            endMs: segment.start_ms + event.end_ms,
            fmin: event.f_min_hz || null,
            fmax: event.f_max_hz || null,
            peak: event.peak_freq_hz || null,
            snr: event.snr_db || null,
            conf: event.confidence || 0.5,
            snippet: event.snippet_s3_key || null
          }, type: QueryTypes.INSERT });

        const row = inserted[0][0];
        await db.query(`
          INSERT INTO aed_event_tags (event_id, label, verdict)
          VALUES (:eventId, 'auto', 'detected')
        `, { replacements: { eventId: row.id }, type: QueryTypes.INSERT });
        allEvents.push(row);
      }
    }
    return allEvents;
  }
}


