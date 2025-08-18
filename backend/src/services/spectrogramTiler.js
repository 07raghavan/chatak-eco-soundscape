/**
 * Spectrogram Pyramid Tiling System
 * Implements the tiling system from extra.txt for efficient visualization
 * Creates zoom levels and tiles for seamless scrolling and zooming
 */

import { createWriteStream, createReadStream } from 'fs';
import { promisify } from 'util';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
// Audio processing using FFmpeg and built-in functions
// Canvas functionality will be implemented using alternative methods
import sharp from 'sharp';
import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { uploadFile } from '../config/s3.js';

// Set FFmpeg path
ffmpeg.setFfmpegPath(path.join(process.cwd(), 'bin', 'ffmpeg.exe'));

/**
 * Spectrogram Tiler Class
 * Creates multi-resolution pyramid of spectrogram tiles for efficient viewing
 */
export class SpectrogramTiler {
  constructor(config = {}) {
    this.config = {
      // Tile dimensions
      tileWidth: config.tileWidth || 1024,
      tileHeight: config.tileHeight || 512,
      
      // STFT parameters
      nFFT: config.nFFT || 1024,
      hopMs: config.hopMs || 10,
      winMs: config.winMs || 32,
      
      // Frequency parameters
      maxFreqHz: config.maxFreqHz || 16000, // Nyquist for 32kHz
      frequencyScale: config.frequencyScale || 'linear', // 'linear' or 'mel'
      
      // Visual parameters
      colormap: config.colormap || 'viridis',
      dynamicRange: config.dynamicRange || 60, // dB
      
      // Zoom levels (pixels per second at each zoom)
      zoomLevels: config.zoomLevels || [
        { zoom: 0, pxPerSec: 10, hzPerPx: 31.25 },   // Overview
        { zoom: 1, pxPerSec: 50, hzPerPx: 6.25 },    // Medium
        { zoom: 2, pxPerSec: 100, hzPerPx: 3.125 },  // Detail
        { zoom: 3, pxPerSec: 200, hzPerPx: 1.5625 }, // High detail
        { zoom: 4, pxPerSec: 400, hzPerPx: 0.78125 } // Maximum zoom
      ],
      
      ...config
    };
  }

  /**
   * Generate spectrogram pyramid for a recording
   * @param {number} recordingId - Recording ID
   * @param {string} audioS3Key - S3 key for the normalized audio file
   * @returns {Object} - Pyramid metadata
   */
  async generatePyramid(recordingId, audioS3Key) {
    console.log(`🎨 Generating spectrogram pyramid for recording ${recordingId}`);
    
    try {
      // 1. Download and process audio
      const audioData = await this.loadAudio(audioS3Key);
      
      // 2. Compute full-resolution spectrogram
      const spectrogram = await this.computeSpectrogram(audioData);
      
      // 3. Generate tiles for each zoom level
      const pyramidData = await this.generateZoomLevels(spectrogram, recordingId);
      
      // 4. Store pyramid metadata in database
      await this.storePyramidMetadata(recordingId, pyramidData);
      
      console.log(`✅ Spectrogram pyramid generated: ${pyramidData.totalTiles} tiles`);
      return pyramidData;
      
    } catch (error) {
      console.error(`❌ Pyramid generation failed for recording ${recordingId}:`, error);
      throw error;
    }
  }

  /**
   * Load and preprocess audio for spectrogram computation
   */
  async loadAudio(s3Key) {
    console.log(`📥 Loading audio: ${s3Key}`);
    
    const tempInputPath = `/tmp/audio_${Date.now()}.wav`;
    const tempRawPath = `/tmp/raw_${Date.now()}.raw`;
    
    try {
      // Download from S3
      const { downloadFile } = await import('../config/s3.js');
      await downloadFile(s3Key, tempInputPath);
      
      // Convert to raw PCM using FFmpeg
      await new Promise((resolve, reject) => {
        ffmpeg(tempInputPath)
          .audioChannels(1)
          .format('f32le')
          .output(tempRawPath)
          .on('end', resolve)
          .on('error', reject)
          .run();
      });
      
      // Read raw PCM data
      const fs = await import('fs');
      const rawBuffer = fs.readFileSync(tempRawPath);
      const samples = new Float32Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength / 4);
      
      // Get sample rate from original file using ffprobe
      const metadata = await this.getAudioMetadata(tempInputPath);
      
      // Clean up
      fs.unlinkSync(tempInputPath);
      fs.unlinkSync(tempRawPath);
      
      return {
        samples: samples,
        sampleRate: metadata.sampleRate,
        duration: samples.length / metadata.sampleRate
      };
      
    } catch (error) {
      console.error('Audio loading failed:', error);
      throw error;
    }
  }

  /**
   * Get audio metadata using ffprobe
   */
  async getAudioMetadata(filePath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
        if (!audioStream) {
          reject(new Error('No audio stream found'));
          return;
        }
        
        resolve({
          sampleRate: audioStream.sample_rate,
          duration: parseFloat(audioStream.duration),
          channels: audioStream.channels
        });
      });
    });
  }

  /**
   * Compute high-resolution spectrogram
   */
  async computeSpectrogram(audioData) {
    console.log('🔊 Computing high-resolution spectrogram...');
    
    const { samples, sampleRate, duration } = audioData;
    const hopSamples = Math.floor((this.config.hopMs * sampleRate) / 1000);
    const winSamples = Math.floor((this.config.winMs * sampleRate) / 1000);
    const nFrames = Math.floor((samples.length - winSamples) / hopSamples) + 1;
    const nFreqBins = this.config.nFFT / 2;
    
    // Initialize spectrogram matrix [nFreqBins x nFrames]
    const spectrogram = Array(nFreqBins).fill(null).map(() => new Float32Array(nFrames));
    
    // Hanning window
    const window = this.hanningWindow(winSamples);
    
    // Process in chunks to manage memory
    const chunkSize = 10000; // frames per chunk
    
    for (let chunkStart = 0; chunkStart < nFrames; chunkStart += chunkSize) {
      const chunkEnd = Math.min(chunkStart + chunkSize, nFrames);
      
      for (let frameIdx = chunkStart; frameIdx < chunkEnd; frameIdx++) {
        const start = frameIdx * hopSamples;
        const end = Math.min(start + winSamples, samples.length);
        
        // Extract and window frame
        const frame = new Float32Array(this.config.nFFT);
        for (let i = 0; i < end - start; i++) {
          frame[i] = samples[start + i] * window[i];
        }
        
        // FFT using built-in implementation
        const fftResult = this.computeFFT(frame);
        
        // Power spectrum and convert to dB
        for (let freqIdx = 0; freqIdx < nFreqBins; freqIdx++) {
          const real = fftResult[freqIdx * 2];
          const imag = fftResult[freqIdx * 2 + 1];
          const power = real * real + imag * imag;
          spectrogram[freqIdx][frameIdx] = 10 * Math.log10(Math.max(power, 1e-10));
        }
      }
      
      // Progress logging
      if (chunkStart % (chunkSize * 10) === 0) {
        const progress = Math.floor((chunkEnd / nFrames) * 100);
        console.log(`📊 Spectrogram computation: ${progress}%`);
      }
    }
    
    return {
      data: spectrogram,
      nFrames,
      nFreqBins,
      frameDurationMs: this.config.hopMs,
      sampleRate,
      duration,
      maxFreqHz: this.config.maxFreqHz
    };
  }

  /**
   * Generate tiles for all zoom levels
   */
  async generateZoomLevels(spectrogram, recordingId) {
    console.log('🔍 Generating zoom levels...');
    
    const pyramidData = {
      recordingId,
      zoomLevels: [],
      tileParams: {
        sr: spectrogram.sampleRate,
        n_fft: this.config.nFFT,
        hop_ms: this.config.hopMs,
        scale: this.config.frequencyScale,
        colormap: this.config.colormap,
        tile_w: this.config.tileWidth,
        tile_h: this.config.tileHeight
      },
      totalTiles: 0,
      s3Prefix: `spec-tiles/${recordingId}/`
    };
    
    // Normalize spectrogram for display
    const normalizedSpec = this.normalizeSpectrogram(spectrogram);
    
    for (const zoomConfig of this.config.zoomLevels) {
      console.log(`🎯 Generating zoom level ${zoomConfig.zoom}...`);
      
      const zoomData = await this.generateZoomLevel(
        normalizedSpec,
        zoomConfig,
        recordingId,
        pyramidData.s3Prefix
      );
      
      pyramidData.zoomLevels.push(zoomData);
      pyramidData.totalTiles += zoomData.tileCount;
    }
    
    return pyramidData;
  }

  /**
   * Generate tiles for a specific zoom level
   */
  async generateZoomLevel(spectrogram, zoomConfig, recordingId, s3Prefix) {
    const { zoom, pxPerSec, hzPerPx } = zoomConfig;
    const { data, nFrames, frameDurationMs, maxFreqHz } = spectrogram;
    
    // Calculate downsampling factors
    const timeDownsample = Math.max(1, Math.floor(1000 / (pxPerSec * frameDurationMs)));
    const freqDownsample = Math.max(1, Math.floor(hzPerPx * data.length / maxFreqHz));
    
    // Downsample spectrogram
    const downsampledSpec = this.downsampleSpectrogram(data, timeDownsample, freqDownsample);
    
    // Calculate tile grid dimensions
    const totalWidth = downsampledSpec.nFrames;
    const totalHeight = downsampledSpec.nFreqBins;
    const tilesX = Math.ceil(totalWidth / this.config.tileWidth);
    const tilesY = Math.ceil(totalHeight / this.config.tileHeight);
    const tileCount = tilesX * tilesY;
    
    console.log(`📐 Zoom ${zoom}: ${totalWidth}x${totalHeight} → ${tilesX}x${tilesY} tiles`);
    
    // Generate tiles
    const tiles = [];
    
    for (let tileY = 0; tileY < tilesY; tileY++) {
      for (let tileX = 0; tileX < tilesX; tileX++) {
        const tile = await this.generateTile(
          downsampledSpec,
          tileX,
          tileY,
          zoom,
          s3Prefix
        );
        
        if (tile) {
          tiles.push(tile);
        }
      }
      
      // Progress logging
      const progress = Math.floor(((tileY + 1) / tilesY) * 100);
      console.log(`🎨 Zoom ${zoom} tiles: ${progress}%`);
    }
    
    return {
      zoom,
      pxPerSec,
      hzPerPx,
      totalWidth,
      totalHeight,
      tilesX,
      tilesY,
      tileCount: tiles.length,
      timeDownsample,
      freqDownsample,
      tiles
    };
  }

  /**
   * Generate a single tile
   */
  async generateTile(spectrogram, tileX, tileY, zoom, s3Prefix) {
    const { data, nFrames, nFreqBins } = spectrogram;
    
    // Calculate tile bounds
    const startX = tileX * this.config.tileWidth;
    const endX = Math.min(startX + this.config.tileWidth, nFrames);
    const startY = tileY * this.config.tileHeight;
    const endY = Math.min(startY + this.config.tileHeight, nFreqBins);
    
    const tileWidth = endX - startX;
    const tileHeight = endY - startY;
    
    if (tileWidth <= 0 || tileHeight <= 0) {
      return null; // Skip empty tiles
    }
    
    // Extract tile data
    const tileData = new Float32Array(tileWidth * tileHeight);
    
    for (let y = 0; y < tileHeight; y++) {
      const freqIdx = nFreqBins - 1 - (startY + y); // Flip frequency axis
      for (let x = 0; x < tileWidth; x++) {
        const frameIdx = startX + x;
        tileData[y * tileWidth + x] = data[freqIdx][frameIdx];
      }
    }
    
    // Render tile to image
    const imageBuffer = await this.renderTileImage(tileData, tileWidth, tileHeight);
    
    // Persist tile locally under /uploads and optionally to S3
    const s3Key = `${s3Prefix}${zoom}/${tileX}/${tileY}.webp`;
    const fs = await import('fs');
    const outPath = path.join(process.cwd(), 'uploads', s3Key);
    const dir = path.dirname(outPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, imageBuffer);
    try { await uploadFile(outPath, s3Key); } catch (_) {}
    
    return {
      x: tileX,
      y: tileY,
      s3Key,
      width: tileWidth,
      height: tileHeight
    };
  }

  /**
   * Render tile data to image using Sharp
   */
  async renderTileImage(tileData, width, height) {
    // Create RGB buffer
    const rgbBuffer = Buffer.alloc(width * height * 3);
    
    // Apply colormap and fill RGB buffer
    for (let i = 0; i < tileData.length; i++) {
      const value = tileData[i];
      const color = this.applyColormap(value);
      
      const pixelIdx = i * 3;
      rgbBuffer[pixelIdx] = color.r;     // Red
      rgbBuffer[pixelIdx + 1] = color.g; // Green
      rgbBuffer[pixelIdx + 2] = color.b; // Blue
    }
    
    // Create image using Sharp and convert to WebP
    const webpBuffer = await sharp(rgbBuffer, {
      raw: {
        width: width,
        height: height,
        channels: 3
      }
    })
    .webp({ quality: 85, lossless: false })
    .toBuffer();
    
    return webpBuffer;
  }

  /**
   * Apply colormap to normalized value
   */
  applyColormap(value) {
    // Clamp value to [0, 1]
    const clamped = Math.max(0, Math.min(1, value));
    
    // Viridis colormap (simplified)
    if (this.config.colormap === 'viridis') {
      return this.viridisColormap(clamped);
    } else {
      // Grayscale fallback
      const gray = Math.floor(clamped * 255);
      return { r: gray, g: gray, b: gray };
    }
  }

  /**
   * Simplified Viridis colormap
   */
  viridisColormap(t) {
    // Simplified viridis approximation
    const r = Math.max(0, Math.min(255, Math.floor(255 * (0.267004 + t * (1.052264 + t * (-2.948554 + t * 4.076056))))));
    const g = Math.max(0, Math.min(255, Math.floor(255 * (0.004874 + t * (1.424810 + t * (-2.174063 + t * 1.906148))))));
    const b = Math.max(0, Math.min(255, Math.floor(255 * (0.329415 + t * (1.060982 + t * (-3.362077 + t * 2.853923))))));
    
    return { r, g, b };
  }

  /**
   * Normalize spectrogram for display
   */
  normalizeSpectrogram(spectrogram) {
    console.log('📊 Normalizing spectrogram...');
    
    const { data, nFrames, nFreqBins } = spectrogram;
    
    // Find global min/max
    let globalMin = Infinity;
    let globalMax = -Infinity;
    
    for (let freqIdx = 0; freqIdx < nFreqBins; freqIdx++) {
      for (let frameIdx = 0; frameIdx < nFrames; frameIdx++) {
        const value = data[freqIdx][frameIdx];
        if (value > globalMax) globalMax = value;
        if (value < globalMin) globalMin = value;
      }
    }
    
    // Limit dynamic range
    const rangeMin = globalMax - this.config.dynamicRange;
    const actualMin = Math.max(globalMin, rangeMin);
    
    // Normalize to [0, 1]
    const normalizedData = Array(nFreqBins).fill(null).map(() => new Float32Array(nFrames));
    
    for (let freqIdx = 0; freqIdx < nFreqBins; freqIdx++) {
      for (let frameIdx = 0; frameIdx < nFrames; frameIdx++) {
        const value = data[freqIdx][frameIdx];
        normalizedData[freqIdx][frameIdx] = (value - actualMin) / (globalMax - actualMin);
      }
    }
    
    return {
      data: normalizedData,
      nFrames,
      nFreqBins,
      frameDurationMs: spectrogram.frameDurationMs,
      sampleRate: spectrogram.sampleRate,
      duration: spectrogram.duration,
      maxFreqHz: spectrogram.maxFreqHz,
      normalizedRange: { min: actualMin, max: globalMax }
    };
  }

  /**
   * Downsample spectrogram for zoom level
   */
  downsampleSpectrogram(data, timeDownsample, freqDownsample) {
    const nFreqBins = data.length;
    const nFrames = data[0].length;
    
    const newFreqBins = Math.floor(nFreqBins / freqDownsample);
    const newFrames = Math.floor(nFrames / timeDownsample);
    
    const downsampled = Array(newFreqBins).fill(null).map(() => new Float32Array(newFrames));
    
    for (let newFreq = 0; newFreq < newFreqBins; newFreq++) {
      for (let newFrame = 0; newFrame < newFrames; newFrame++) {
        // Average over downsampling window
        let sum = 0;
        let count = 0;
        
        for (let df = 0; df < freqDownsample; df++) {
          for (let dt = 0; dt < timeDownsample; dt++) {
            const origFreq = newFreq * freqDownsample + df;
            const origFrame = newFrame * timeDownsample + dt;
            
            if (origFreq < nFreqBins && origFrame < nFrames) {
              sum += data[origFreq][origFrame];
              count++;
            }
          }
        }
        
        downsampled[newFreq][newFrame] = count > 0 ? sum / count : 0;
      }
    }
    
    return {
      data: downsampled,
      nFreqBins: newFreqBins,
      nFrames: newFrames
    };
  }

  /**
   * Store pyramid metadata in database
   */
  async storePyramidMetadata(recordingId, pyramidData) {
    console.log('💾 Storing pyramid metadata and tiles...');

    try {
      // First, insert or update the pyramid record
      const pyramidResult = await db.query(`
        INSERT INTO spec_pyramids (
          recording_id,
          spectrogram_type,
          zoom_levels_json,
          tile_params_json,
          tiles_s3_prefix,
          method_version,
          sr,
          hop,
          n_mels,
          fmin,
          fmax,
          zoom_levels,
          px_per_sec,
          tile_w,
          tile_h,
          status,
          total_tiles,
          generated_tiles,
          created_at,
          updated_at
        ) VALUES (
          :recordingId, 'tiled', :zoomLevels, :tileParams, :s3Prefix, 'v2.0',
          :sr, :hop, :nMels, :fmin, :fmax, :zoomLevelsArray, :pxPerSecArray,
          :tileW, :tileH, 'completed', :totalTiles, :generatedTiles, NOW(), NOW()
        )
        ON CONFLICT (recording_id, spectrogram_type) WHERE segment_id IS NULL
        DO UPDATE SET
          zoom_levels_json = EXCLUDED.zoom_levels_json,
          tile_params_json = EXCLUDED.tile_params_json,
          tiles_s3_prefix = EXCLUDED.tiles_s3_prefix,
          sr = EXCLUDED.sr,
          hop = EXCLUDED.hop,
          n_mels = EXCLUDED.n_mels,
          fmin = EXCLUDED.fmin,
          fmax = EXCLUDED.fmax,
          zoom_levels = EXCLUDED.zoom_levels,
          px_per_sec = EXCLUDED.px_per_sec,
          tile_w = EXCLUDED.tile_w,
          tile_h = EXCLUDED.tile_h,
          status = EXCLUDED.status,
          total_tiles = EXCLUDED.total_tiles,
          generated_tiles = EXCLUDED.generated_tiles,
          updated_at = NOW()
        RETURNING id
      `, {
        replacements: {
          recordingId,
          zoomLevels: JSON.stringify(pyramidData.zoomLevels),
          tileParams: JSON.stringify(pyramidData.tileParams),
          s3Prefix: pyramidData.s3Prefix,
          sr: pyramidData.tileParams.sr,
          hop: pyramidData.tileParams.hop_ms,
          nMels: pyramidData.tileParams.n_mels || 128,
          fmin: pyramidData.tileParams.fmin || 0,
          fmax: pyramidData.tileParams.fmax || 16000,
          zoomLevelsArray: pyramidData.zoomLevels.map(z => z.zoom),
          pxPerSecArray: pyramidData.zoomLevels.map(z => z.pxPerSec),
          tileW: pyramidData.tileParams.tile_w,
          tileH: pyramidData.tileParams.tile_h,
          totalTiles: pyramidData.totalTiles,
          generatedTiles: pyramidData.totalTiles
        },
        type: QueryTypes.INSERT
      });

      const pyramidId = pyramidResult[0][0].id;

      // Now insert individual tiles
      await this.storeTileRecords(pyramidId, pyramidData);

      console.log('✅ Pyramid metadata and tiles stored successfully');

    } catch (error) {
      console.error('Failed to store pyramid metadata:', error);
      throw error;
    }
  }

  /**
   * Store individual tile records in spec_tiles table
   */
  async storeTileRecords(pyramidId, pyramidData) {
    console.log(`💾 Storing ${pyramidData.totalTiles} tile records...`);

    const tileRecords = [];

    for (const zoomLevel of pyramidData.zoomLevels) {
      for (const tile of zoomLevel.tiles) {
        // Calculate tile bounds
        const timePerPxMs = 1000 / zoomLevel.pxPerSec;
        const freqPerPxHz = (pyramidData.tileParams.fmax - pyramidData.tileParams.fmin) / pyramidData.tileParams.tile_h;

        const startTimeMs = Math.floor(tile.x * pyramidData.tileParams.tile_w * timePerPxMs);
        const endTimeMs = Math.floor((tile.x + 1) * pyramidData.tileParams.tile_w * timePerPxMs);
        const maxFreqHz = pyramidData.tileParams.fmax - (tile.y * pyramidData.tileParams.tile_h * freqPerPxHz);
        const minFreqHz = Math.max(
          pyramidData.tileParams.fmax - ((tile.y + 1) * pyramidData.tileParams.tile_h * freqPerPxHz),
          pyramidData.tileParams.fmin
        );

        tileRecords.push({
          index_id: pyramidId,
          zoom: zoomLevel.zoom,
          tile_x: tile.x,
          tile_y: tile.y,
          s3_key: tile.s3Key,
          width_px: tile.width,
          height_px: tile.height,
          start_time_ms: startTimeMs,
          end_time_ms: endTimeMs,
          min_freq_hz: minFreqHz,
          max_freq_hz: maxFreqHz,
          format: 'webp',
          status: 'completed'
        });
      }
    }

    // Batch insert tiles
    if (tileRecords.length > 0) {
      const values = tileRecords.map((_, index) => {
        const baseIndex = index * 12;
        return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10}, $${baseIndex + 11}, $${baseIndex + 12})`;
      }).join(', ');

      const replacements = tileRecords.flatMap(tile => [
        tile.index_id, tile.zoom, tile.tile_x, tile.tile_y, tile.s3_key,
        tile.width_px, tile.height_px, tile.start_time_ms, tile.end_time_ms,
        tile.min_freq_hz, tile.max_freq_hz, tile.status
      ]);

      await db.query(`
        INSERT INTO spec_tiles (
          index_id, zoom, tile_x, tile_y, s3_key,
          width_px, height_px, start_time_ms, end_time_ms,
          min_freq_hz, max_freq_hz, status
        ) VALUES ${values}
        ON CONFLICT (index_id, zoom, tile_x, tile_y) DO UPDATE SET
          s3_key = EXCLUDED.s3_key,
          width_px = EXCLUDED.width_px,
          height_px = EXCLUDED.height_px,
          start_time_ms = EXCLUDED.start_time_ms,
          end_time_ms = EXCLUDED.end_time_ms,
          min_freq_hz = EXCLUDED.min_freq_hz,
          max_freq_hz = EXCLUDED.max_freq_hz,
          status = EXCLUDED.status,
          updated_at = NOW()
      `, {
        replacements,
        type: QueryTypes.INSERT
      });

      console.log(`✅ Stored ${tileRecords.length} tile records`);
    }
  }

  /**
   * Get pyramid metadata for a recording
   */
  async getPyramidMetadata(recordingId) {
    try {
      const records = await db.query(`
        SELECT * FROM spec_pyramids WHERE recording_id = :recordingId
      `, { replacements: { recordingId }, type: QueryTypes.SELECT });

      if (!records || (Array.isArray(records) && records.length === 0)) {
        return null;
      }

      const pyramid = Array.isArray(records) ? records[0] : records;
      return {
        recordingId: pyramid.recording_id,
        zoomLevels: pyramid.zoom_levels_json,
        tileParams: pyramid.tile_params_json,
        s3Prefix: pyramid.tiles_s3_prefix,
        status: pyramid.status,
        totalTiles: pyramid.total_tiles,
        generatedTiles: pyramid.generated_tiles,
        createdAt: pyramid.created_at,
        updatedAt: pyramid.updated_at
      };
      
    } catch (error) {
      console.error('Failed to get pyramid metadata:', error);
      throw error;
    }
  }

  // Helper methods

  /**
   * Compute FFT using Cooley-Tukey algorithm
   */
  computeFFT(x) {
    const N = x.length;
    const output = new Float32Array(N * 2); // Real and imaginary parts interleaved
    
    // Copy input to output (real parts)
    for (let i = 0; i < N; i++) {
      output[i * 2] = x[i];
      output[i * 2 + 1] = 0; // Imaginary part is 0
    }
    
    // Bit-reverse copy
    const bitReverse = (x, bits) => {
      let reversed = 0;
      for (let i = 0; i < bits; i++) {
        reversed = (reversed << 1) | (x & 1);
        x >>= 1;
      }
      return reversed;
    };
    
    const bits = Math.log2(N);
    for (let i = 0; i < N; i++) {
      const j = bitReverse(i, bits);
      if (i < j) {
        // Swap real parts
        [output[i * 2], output[j * 2]] = [output[j * 2], output[i * 2]];
        // Swap imaginary parts
        [output[i * 2 + 1], output[j * 2 + 1]] = [output[j * 2 + 1], output[i * 2 + 1]];
      }
    }
    
    // Cooley-Tukey FFT
    for (let size = 2; size <= N; size *= 2) {
      const halfsize = size / 2;
      const tablestep = N / size;
      
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
          const thetaIdx = k % N;
          const theta = -2 * Math.PI * thetaIdx / N;
          const wr = Math.cos(theta);
          const wi = Math.sin(theta);
          
          const xr = output[(j + halfsize) * 2];
          const xi = output[(j + halfsize) * 2 + 1];
          
          const yr = wr * xr - wi * xi;
          const yi = wr * xi + wi * xr;
          
          output[(j + halfsize) * 2] = output[j * 2] - yr;
          output[(j + halfsize) * 2 + 1] = output[j * 2 + 1] - yi;
          
          output[j * 2] += yr;
          output[j * 2 + 1] += yi;
        }
      }
    }
    
    return output;
  }

  hanningWindow(length) {
    const window = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (length - 1)));
    }
    return window;
  }
}

/**
 * Factory function to create spectrogram tiler
 */
export function createSpectrogramTiler(config = {}) {
  return new SpectrogramTiler(config);
}

/**
 * Generate spectrogram pyramid for a recording (main entry point)
 */
export async function generateSpectrogramPyramid(recordingId, audioS3Key, config = {}) {
  const tiler = createSpectrogramTiler(config);
  return await tiler.generatePyramid(recordingId, audioS3Key);
}

/**
 * Get spectrogram pyramid metadata
 */
export async function getSpectrogramPyramid(recordingId) {
  const tiler = createSpectrogramTiler();
  return await tiler.getPyramidMetadata(recordingId);
}
