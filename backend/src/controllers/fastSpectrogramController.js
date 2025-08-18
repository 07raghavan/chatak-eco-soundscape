import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getFileUrl, uploadFile, getFileUrl as getS3FileUrl } from '../config/s3.js';
import { processAndGroupEvents } from '../utils/eventGrouping.js';

/**
 * Ultra-Fast Spectrogram Controller
 * Integrates with Python service for high-speed spectrogram generation with AED ROI overlays
 */

export const generateFastSpectrogram = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const { segmentId } = req.query; // Optional segment ID for segment-specific generation
    const userId = req.user.id;
    const { 
      config = {},
      force_regenerate = false,
      min_confidence = 0.15,
      include_bands = ['low_freq', 'mid_freq', 'high_freq']
    } = req.body || {};

    console.log(`🚀 Fast spectrogram generation request for recording ${recordingId}`);

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id, r.file_path
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const recording = recordingCheck[0];

    // Check if spectrogram already exists and is valid
    if (!force_regenerate) {
      const existingSpectrogram = await db.query(`
        SELECT * FROM spec_pyramids 
        WHERE recording_id = :recordingId 
        AND spectrogram_type = 'fast_single' 
        AND status = 'completed'
        ORDER BY created_at DESC 
        LIMIT 1
      `, { replacements: { recordingId }, type: QueryTypes.SELECT });

      if (existingSpectrogram.length > 0) {
        const existing = existingSpectrogram[0];
        
        // Check if file still exists
        if (existing.image_local_path && fs.existsSync(existing.image_local_path)) {
          console.log(`✨ Using existing fast spectrogram for recording ${recordingId}`);
          
          // If we have an S3 key, get a fresh signed URL
          let imageUrl = `/uploads/fast-spectrograms/${path.basename(existing.image_local_path)}`;
          if (existing.image_s3_key) {
            try {
              imageUrl = await getS3FileUrl(existing.image_s3_key);
            } catch (s3Error) {
              console.warn('⚠️ Failed to get S3 URL, using fallback:', s3Error.message);
            }
          }
          
          return res.json({
            success: true,
            message: 'Fast spectrogram already exists',
            spectrogram: {
              ...existing,
              image_url: imageUrl,
              cached: true
            }
          });
        }
      }
    }

    // Set response headers for streaming progress
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    res.write(`data: ${JSON.stringify({ progress: 0, message: 'Starting fast spectrogram generation...' })}\n\n`);

    // Get AED events for ROI overlay
    res.write(`data: ${JSON.stringify({ progress: 10, message: 'Loading AED events...' })}\n\n`);
    
    const aedEvents = await db.query(`
      SELECT ae.*, aet.label as band_name
      FROM aed_events ae
      LEFT JOIN aed_event_tags aet ON ae.id = aet.event_id
      WHERE ae.recording_id = :recordingId 
      AND ae.confidence >= :minConf
      AND (aet.label IN (:bands) OR aet.label IS NULL)
      ORDER BY ae.start_ms ASC
    `, { 
      replacements: { 
        recordingId, 
        minConf: min_confidence,
        bands: include_bands
      }, 
      type: QueryTypes.SELECT 
    });

    console.log(`📊 Found ${aedEvents.length} AED events for ROI overlay`);
    res.write(`data: ${JSON.stringify({ progress: 20, message: `Found ${aedEvents.length} AED events for overlay` })}\n\n`);

    // Prepare file paths
    const outputDir = path.join(process.cwd(), 'uploads', 'fast-spectrograms');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFile = path.join(outputDir, `recording_${recordingId}_fast_spectrogram.png`);
    const pythonScript = path.join(process.cwd(), 'src', 'services', 'fastSpectrogramGenerator.py');

    // Get signed URL for input audio
    res.write(`data: ${JSON.stringify({ progress: 30, message: 'Downloading audio file...' })}\n\n`);
    const audioUrl = await getFileUrl(recording.file_path);
    
    // Download audio file temporarily for Python processing
    const tempAudioFile = path.join(process.cwd(), 'temp_ffmpeg', `recording_${recordingId}.flac`);
    fs.mkdirSync(path.dirname(tempAudioFile), { recursive: true });
    
    // Use ffmpeg to download and prepare audio file (already available in your system)
    await new Promise((resolve, reject) => {
      const ffmpegPath = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
      spawn(ffmpegPath, ['-y', '-i', audioUrl, tempAudioFile])
        .on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg failed with code ${code}`));
        })
        .on('error', reject);
    });

    // Prepare generation config with dynamic width based on audio duration
    const audioDuration = recording.duration_seconds || 60; // fallback to 60s
    const minWidth = 12; // minimum width in inches
    const maxWidth = 200; // maximum width to prevent excessive memory usage
    const pixelsPerSecond = 20; // scale factor: pixels per second of audio
    const dynamicWidth = Math.max(minWidth, Math.min(maxWidth, audioDuration * pixelsPerSecond / 100)); // /100 for inches
    
    console.log(`📏 Calculated spectrogram width: ${dynamicWidth} inches for ${audioDuration}s audio`);
    res.write(`data: ${JSON.stringify({ progress: 35, message: `Configuring ${dynamicWidth.toFixed(1)}" wide spectrogram for ${audioDuration}s audio` })}\n\n`);
    
    const generationConfig = {
      n_fft: config.n_fft || 1024,   // Better time resolution
      hop_length: config.hop_length || 256,  // Higher detail
      n_mels: config.n_mels || 128,
      fmin: config.fmin || 0,
      fmax: config.fmax || null,
      power: config.power || 2.0,
      db_range: config.db_range || 80,
      colormap: config.colormap || 'viridis',
      width_inches: dynamicWidth,  // Dynamic width based on audio length
      height_inches: config.height_inches || 8,  // Taller for better frequency detail
      dpi: config.dpi || 100,
      ...config
    };

    // Create or update database entry
    res.write(`data: ${JSON.stringify({ progress: 40, message: 'Setting up database entry...' })}\n\n`);
    
    await db.query(`
      INSERT INTO spec_pyramids (
        recording_id, spectrogram_type, status, aed_events_count, 
        generation_config_json, image_local_path
      ) VALUES (
        :recordingId, 'fast_single', 'processing', :eventCount, :config, :outputPath
      )
      ON CONFLICT (recording_id) DO UPDATE SET
        spectrogram_type = EXCLUDED.spectrogram_type,
        status = EXCLUDED.status,
        aed_events_count = EXCLUDED.aed_events_count,
        generation_config_json = EXCLUDED.generation_config_json,
        image_local_path = EXCLUDED.image_local_path,
        updated_at = NOW()
    `, {
      replacements: {
        recordingId,
        eventCount: aedEvents.length,
        config: JSON.stringify(generationConfig),
        outputPath: outputFile
      },
      type: QueryTypes.INSERT
    });

    // Call Python spectrogram generator
    res.write(`data: ${JSON.stringify({ progress: 50, message: 'Generating spectrogram with Python service...' })}\n\n`);
    
    const startTime = Date.now();
    
    try {
      const result = await callPythonSpectrogramGenerator(
        pythonScript,
        tempAudioFile,
        outputFile,
        aedEvents,
        generationConfig
      );

      const endTime = Date.now();
      const generationTime = endTime - startTime;

      if (!result.success) {
        throw new Error(result.error || 'Python spectrogram generation failed');
      }

      res.write(`data: ${JSON.stringify({ progress: 90, message: 'Updating database...' })}\n\n`);

      // Update database with success
      await db.query(`
        UPDATE spec_pyramids SET
          status = 'completed',
          generation_time_ms = :genTime,
          file_size_bytes = :fileSize,
          updated_at = NOW()
        WHERE recording_id = :recordingId AND spectrogram_type = 'fast_single'
      `, {
        replacements: {
          recordingId,
          genTime: generationTime,
          fileSize: result.file_size_bytes || 0
        },
        type: QueryTypes.UPDATE
      });

      // Upload spectrogram to S3
      res.write(`data: ${JSON.stringify({ progress: 95, message: 'Uploading spectrogram to S3...' })}\n\n`);
      
      const s3Key = `spectrograms/recording-${recordingId}/fast-spectrogram-${Date.now()}.png`;
      let imageUrl = `/uploads/fast-spectrograms/${path.basename(outputFile)}`; // fallback
      
      try {
        const s3Result = await uploadFile(outputFile, s3Key);
        if (s3Result && s3Result.Location) {
          // Get signed URL for the uploaded spectrogram
          imageUrl = await getS3FileUrl(s3Key);
          console.log(`✅ Spectrogram uploaded to S3: ${s3Key}`);
        }
      } catch (s3Error) {
        console.warn('⚠️ S3 upload failed, using local fallback:', s3Error.message);
        // Keep local fallback URL
      }

      // Update database with S3 path
      await db.query(`
        UPDATE spec_pyramids SET
          image_s3_key = :s3Key
        WHERE recording_id = :recordingId AND spectrogram_type = 'fast_single'
      `, {
        replacements: {
          recordingId,
          s3Key
        },
        type: QueryTypes.UPDATE
      });

      // Clean up temp audio file
      try { fs.unlinkSync(tempAudioFile); } catch {}

      const spectrogramResult = {
        success: true,
        message: 'Fast spectrogram generated successfully',
        spectrogram: {
          recording_id: recordingId,
          type: 'fast_single',
          image_url: imageUrl,
          image_local_path: outputFile,
          image_s3_key: s3Key,
          aed_events_count: aedEvents.length,
          generation_time_ms: generationTime,
          file_size_bytes: result.file_size_bytes || 0,
          config: generationConfig,
          metadata: result
        }
      };

      res.write(`data: ${JSON.stringify({ progress: 100, message: 'Complete!', result: spectrogramResult })}\n\n`);
      res.end();

      console.log(`✅ Fast spectrogram generated in ${generationTime}ms for recording ${recordingId}`);

    } catch (error) {
      console.error('Python spectrogram generation failed:', error);
      
      // Update database with failure
      await db.query(`
        UPDATE spec_pyramids SET
          status = 'failed',
          error_message = :error,
          updated_at = NOW()
        WHERE recording_id = :recordingId AND spectrogram_type = 'fast_single'
      `, {
        replacements: {
          recordingId,
          error: error.message
        },
        type: QueryTypes.UPDATE
      });

      // Clean up temp files
      try { fs.unlinkSync(tempAudioFile); } catch {}
      try { fs.unlinkSync(outputFile); } catch {}

      res.write(`data: ${JSON.stringify({ error: 'Spectrogram generation failed: ' + error.message })}\n\n`);
      res.end();
    }

  } catch (error) {
    console.error('Fast spectrogram generation error:', error);
    
    if (!res.headersSent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to generate fast spectrogram: ' + error.message 
      });
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Setup failed: ' + error.message })}\n\n`);
      res.end();
    }
  }
};

/**
 * Get existing fast spectrogram
 */
export const getFastSpectrogram = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get spectrogram
    const spectrogram = await db.query(`
      SELECT * FROM spec_pyramids 
      WHERE recording_id = :recordingId 
      AND spectrogram_type = 'fast_single'
      ORDER BY created_at DESC 
      LIMIT 1
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (spectrogram.length === 0) {
      return res.status(404).json({ error: 'Fast spectrogram not found' });
    }

    const spec = spectrogram[0];
    
    // Check if file exists
    if (spec.image_local_path && !fs.existsSync(spec.image_local_path)) {
      return res.status(404).json({ 
        error: 'Spectrogram file not found',
        status: 'file_missing'
      });
    }

    // If we have an S3 key, get a fresh signed URL
    let imageUrl = spec.image_local_path ? `/uploads/fast-spectrograms/${path.basename(spec.image_local_path)}` : null;
    if (spec.image_s3_key) {
      try {
        imageUrl = await getS3FileUrl(spec.image_s3_key);
      } catch (s3Error) {
        console.warn('⚠️ Failed to get S3 URL, using fallback:', s3Error.message);
      }
    }

    return res.json({
      success: true,
      spectrogram: {
        ...spec,
        image_url: imageUrl
      }
    });

  } catch (error) {
    console.error('Get fast spectrogram error:', error);
    return res.status(500).json({ error: 'Failed to retrieve fast spectrogram' });
  }
};

/**
 * Generate spectrograms for all segments of a recording
 */
export const generateSegmentSpectrograms = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;
    const { 
      config = {},
      force_regenerate = false,
      min_confidence = 0.1, // Lower threshold to include more events
      include_bands = ['low_freq', 'mid_freq', 'high_freq']
    } = req.body || {};

    console.log(`🚀 Segment spectrograms generation for recording ${recordingId}`);

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get approved segments
    const segments = await db.query(`
      SELECT s.*
      FROM segments s
      JOIN segment_approvals sa ON sa.segment_id = s.id AND sa.status = 'approved'
      WHERE s.recording_id = :recordingId
      ORDER BY s.start_ms ASC
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (segments.length === 0) {
      return res.status(404).json({ error: 'No approved segments found' });
    }

    // Set up streaming response
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked'
    });

    const results = [];
    let completed = 0;
    
    const sendProgress = (message, progress = null) => {
      const progressData = {
        message,
        total_segments: segments.length,
        completed_segments: completed,
        progress: progress || (completed / segments.length * 100),
        timestamp: new Date().toISOString()
      };
      res.write(JSON.stringify(progressData) + '\n');
    };

    sendProgress(`Starting generation for ${segments.length} segments...`, 0);

    // Process segments (you can make this parallel for faster processing)
    for (const segment of segments) {
      try {
        sendProgress(`Generating spectrogram for segment ${segment.id}...`);
        
        const result = await generateSingleSegmentSpectrogram(
          recordingId,
          segment,
          { config, min_confidence, include_bands, force_regenerate }
        );
        
        results.push(result);
        completed++;
        sendProgress(`Completed segment ${segment.id}`, completed / segments.length * 100);
        
      } catch (error) {
        console.error(`Failed to generate spectrogram for segment ${segment.id}:`, error);
        results.push({
          segment_id: segment.id,
          success: false,
          error: error.message
        });
        completed++;
      }
    }

    // Send final results
    const finalResult = {
      success: true,
      message: `Generated spectrograms for ${results.filter(r => r.success).length}/${segments.length} segments`,
      recording_id: recordingId,
      total_segments: segments.length,
      successful_segments: results.filter(r => r.success).length,
      failed_segments: results.filter(r => !r.success).length,
      results,
      completed: true
    };
    
    res.write(JSON.stringify(finalResult) + '\n');
    res.end();

  } catch (error) {
    console.error('Segment spectrograms generation error:', error);
    
    if (!res.headersSent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to generate segment spectrograms: ' + error.message 
      });
    } else {
      res.write(JSON.stringify({ error: error.message, completed: true }) + '\n');
      res.end();
    }
  }
};

/**
 * Generate spectrogram for a single segment
 */
export const generateSingleSegmentSpectrogram = async (recordingId, segment, options = {}) => {
  const { config = {}, min_confidence = 0.15, include_bands = ['low_freq', 'mid_freq', 'high_freq'], force_regenerate = false } = options;
  
  try {
    // Check if spectrogram already exists
    if (!force_regenerate) {
      const existing = await db.query(`
        SELECT * FROM spec_pyramids 
        WHERE segment_id = :segmentId 
        AND spectrogram_type = 'fast_single' 
        AND status = 'completed'
        ORDER BY created_at DESC 
        LIMIT 1
      `, { replacements: { segmentId: segment.id }, type: QueryTypes.SELECT });

      if (existing.length > 0 && existing[0].image_local_path && fs.existsSync(existing[0].image_local_path)) {
        return {
          segment_id: segment.id,
          success: true,
          spectrogram: existing[0],
          cached: true
        };
      }
    }

    // Get ALL AED events for this specific segment (remove restrictive filtering for debugging)
    console.log(`🔍 DEBUG: Querying events for segment ${segment.id} with min_confidence=${min_confidence}, bands=${include_bands.join(', ')}`);
    
    // Get events that belong to this specific segment and overlap with segment boundaries
    const allEventsForSegment = await db.query(`
      SELECT ae.*, aet.label as band_name,
        (ae.start_ms - :segmentStartMs) as relative_start_ms,
        (ae.end_ms - :segmentStartMs) as relative_end_ms
      FROM aed_events ae
      LEFT JOIN aed_event_tags aet ON ae.id = aet.event_id
      WHERE ae.segment_id = :segmentId
        AND ae.start_ms >= :segmentStartMs
        AND ae.end_ms <= :segmentEndMs
        AND ae.start_ms < ae.end_ms
      ORDER BY ae.start_ms ASC
    `, {
      replacements: {
        segmentId: segment.id,
        segmentStartMs: segment.start_ms,
        segmentEndMs: segment.end_ms
      },
      type: QueryTypes.SELECT
    });
    
    console.log(`🔍 DEBUG: Found ${allEventsForSegment.length} TOTAL events for segment ${segment.id}`);
    
    // Apply filtering and log what gets filtered out
    const aedEvents = allEventsForSegment.filter(event => {
      const passesConfidence = event.confidence >= min_confidence;
      // Be more inclusive with band filtering - include events with no band_name
      const passesTagFilter = !event.band_name || event.band_name === 'auto' || include_bands.includes(event.band_name);

      if (!passesConfidence) {
        console.log(`🔍 DEBUG: Event ${event.id} FILTERED OUT by confidence: ${event.confidence} < ${min_confidence}`);
      }
      if (!passesTagFilter) {
        console.log(`🔍 DEBUG: Event ${event.id} FILTERED OUT by band: '${event.band_name}' not in [${include_bands.join(', ')}]`);
      }

      return passesConfidence && passesTagFilter;
    });
    
    console.log(`🔍 DEBUG: After filtering: ${aedEvents.length} events remaining`);
    
    // Use properly filtered events for each segment
    const eventsToProcess = aedEvents;

    console.log(`🔍 DEBUG: Will process ${eventsToProcess.length} filtered events for segment ${segment.id}`);
    
    // Use the events to process
    const finalEvents = eventsToProcess;

    // Prepare file paths
    const outputDir = path.join(process.cwd(), 'uploads', 'segment-spectrograms');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFile = path.join(outputDir, `segment_${segment.id}_spectrogram.png`);
    const pythonScript = path.join(process.cwd(), 'src', 'services', 'fastSpectrogramGenerator.py');

    // Get segment audio file
    const segmentAudioUrl = await getFileUrl(segment.s3_key);
    const tempAudioFile = path.join(process.cwd(), 'temp_ffmpeg', `segment_${segment.id}.flac`);
    fs.mkdirSync(path.dirname(tempAudioFile), { recursive: true });
    
    // Download segment audio
    await new Promise((resolve, reject) => {
      const ffmpegPath = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
      spawn(ffmpegPath, ['-y', '-i', segmentAudioUrl, tempAudioFile])
        .on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg failed with code ${code}`));
        })
        .on('error', reject);
    });

    // Configure for segment (shorter duration, better detail)
    const segmentDuration = (segment.end_ms - segment.start_ms) / 1000; // in seconds
    const generationConfig = {
      n_fft: config.n_fft || 512,  // Higher resolution for short segments
      hop_length: config.hop_length || 128,  // More detail
      n_mels: config.n_mels || 128,
      fmin: config.fmin || 0,
      fmax: config.fmax || null,
      power: config.power || 2.0,
      db_range: config.db_range || 80,
      colormap: config.colormap || 'viridis',
      width_inches: Math.max(8, Math.min(20, segmentDuration * 2)), // 2 inches per second for segments
      height_inches: config.height_inches || 6,
      dpi: config.dpi || 150, // Higher DPI for segments
      ...config
    };

    // Create database entry
    const [dbEntry] = await db.query(`
      INSERT INTO spec_pyramids (
        recording_id, segment_id, spectrogram_type, status, aed_events_count, 
        generation_config_json, image_local_path
      ) VALUES (
        :recordingId, :segmentId, 'fast_single', 'processing', :eventCount, :config, :outputPath
      )
      ON CONFLICT (segment_id, spectrogram_type) DO UPDATE SET
        status = EXCLUDED.status,
        aed_events_count = EXCLUDED.aed_events_count,
        generation_config_json = EXCLUDED.generation_config_json,
        image_local_path = EXCLUDED.image_local_path,
        updated_at = NOW()
      RETURNING id
    `, {
      replacements: {
        recordingId,
        segmentId: segment.id,
        eventCount: aedEvents.length,
        config: JSON.stringify(generationConfig),
        outputPath: outputFile
      },
      type: QueryTypes.INSERT
    });

    const startTime = Date.now();
    
    // Use the relative timing already calculated in SQL query
    const adjustedEvents = finalEvents.map(event => ({
      ...event,
      start_ms: event.relative_start_ms,
      end_ms: event.relative_end_ms
    }));

    // DEBUG: Log detailed timing information
    console.log(`🔍 DEBUG: ========== TIMING ANALYSIS ==========`);
    console.log(`🔍 DEBUG: Segment ${segment.id}:`);
    console.log(`  - Segment start_ms: ${segment.start_ms}`);
    console.log(`  - Segment end_ms: ${segment.end_ms}`);
    console.log(`  - Segment duration: ${segmentDuration}s (${segment.end_ms - segment.start_ms}ms)`);
    console.log(`🔍 DEBUG: Found ${finalEvents.length} events to process:`);
    
    finalEvents.forEach((event, i) => {
      const expectedRelativeStart = event.start_ms - segment.start_ms;
      const expectedRelativeEnd = event.end_ms - segment.start_ms;
      
      console.log(`  Event ${i+1} (ID: ${event.id}):`);
      console.log(`    - Absolute: ${event.start_ms}ms-${event.end_ms}ms`);
      console.log(`    - SQL Relative: ${event.relative_start_ms}ms-${event.relative_end_ms}ms`);
      console.log(`    - Expected Relative: ${expectedRelativeStart}ms-${expectedRelativeEnd}ms`);
      console.log(`    - Expected Relative (sec): ${expectedRelativeStart/1000}s-${expectedRelativeEnd/1000}s`);
      console.log(`    - Frequency: ${event.f_min_hz}Hz-${event.f_max_hz}Hz`);
      console.log(`    - Confidence: ${event.confidence}`);
      console.log(`    - Band: ${event.band_name || 'None'}`);
      
      // Check if event is actually within segment bounds
      if (event.start_ms < segment.start_ms || event.end_ms > segment.end_ms) {
        console.log(`    - ⚠️ WARNING: Event outside segment bounds!`);
      }
    });
    
    // 🎵 APPLY EVENT GROUPING - Group similar events together
    console.log(`🎵 DEBUG: ========== EVENT GROUPING ==========`);
    
    const groupingOptions = {
      enableGrouping: true,
      groupingOptions: {
        maxTimeGap: 2000,        // Max 2 second gap between events
        minFreqOverlap: 0.2,     // Minimum 20% frequency overlap
        maxFreqDistance: 1500,   // Max 1.5kHz frequency distance
        sameSoundType: true      // Group only similar sound types
      }
    };
    
    const groupedEvents = processAndGroupEvents(adjustedEvents, groupingOptions);
    
    console.log(`🎵 DEBUG: Event grouping results:`);
    console.log(`  - Original events: ${adjustedEvents.length}`);
    console.log(`  - Grouped into: ${groupedEvents.length} boxes`);
    
    groupedEvents.forEach((group, i) => {
      if (group.group_size > 1) {
        console.log(`  Group ${i+1}: ${group.group_size} events combined`);
        console.log(`    - Sound type: ${group.sound_type}`);
        console.log(`    - Time span: ${group.start_ms}ms-${group.end_ms}ms (${((group.end_ms - group.start_ms) / 1000).toFixed(2)}s)`);
        console.log(`    - Frequency range: ${group.f_min_hz}Hz-${group.f_max_hz}Hz`);
        console.log(`    - Individual events: [${group.event_ids.join(', ')}]`);
      } else {
        console.log(`  Single ${i+1}: Event ${group.event_ids[0]}, type: ${group.sound_type}`);
      }
    });
    
    console.log(`🔍 DEBUG: Final grouped events being sent to Python:`);
    groupedEvents.forEach((event, i) => {
      console.log(`  Event ${i+1} (${event.group_size > 1 ? 'GROUP' : 'SINGLE'}): ${event.start_ms}ms-${event.end_ms}ms (${event.start_ms/1000}s-${event.end_ms/1000}s)`);
      console.log(`           Type: ${event.sound_type}, Freq: ${event.f_min_hz}Hz-${event.f_max_hz}Hz, Conf: ${event.confidence.toFixed(2)}`);
      if (event.group_size > 1) {
        console.log(`           Contains ${event.group_size} individual events: [${event.event_ids.join(', ')}]`);
      }
    });
    console.log(`🔍 DEBUG: =======================================`);
    
    // Use grouped events for spectrogram generation
    const finalEventsForPython = groupedEvents;

    // Generate spectrogram
    const result = await callPythonSpectrogramGenerator(
      pythonScript,
      tempAudioFile,
      outputFile,
      finalEventsForPython,
      generationConfig
    );

    const generationTime = Date.now() - startTime;

    if (!result.success) {
      throw new Error(result.error || 'Python spectrogram generation failed');
    }

    // Update database with success
    await db.query(`
      UPDATE spec_pyramids SET
        status = 'completed',
        generation_time_ms = :genTime,
        file_size_bytes = :fileSize,
        updated_at = NOW()
      WHERE segment_id = :segmentId AND spectrogram_type = 'fast_single'
    `, {
      replacements: {
        segmentId: segment.id,
        genTime: generationTime,
        fileSize: result.file_size_bytes || 0
      },
      type: QueryTypes.UPDATE
    });

    // Upload to S3 (optional)
    const s3Key = `spectrograms/segment-${segment.id}/spectrogram-${Date.now()}.png`;
    let imageUrl = `/uploads/segment-spectrograms/${path.basename(outputFile)}`; // fallback
    
    try {
      const s3Result = await uploadFile(outputFile, s3Key);
      if (s3Result && s3Result.Location) {
        imageUrl = await getS3FileUrl(s3Key);
        
        // Update S3 key in database
        await db.query(`
          UPDATE spec_pyramids SET image_s3_key = :s3Key
          WHERE segment_id = :segmentId AND spectrogram_type = 'fast_single'
        `, {
          replacements: { segmentId: segment.id, s3Key },
          type: QueryTypes.UPDATE
        });
      }
    } catch (s3Error) {
      console.warn('⚠️ S3 upload failed for segment:', s3Error.message);
    }

    // Clean up temp file
    try { fs.unlinkSync(tempAudioFile); } catch {}

    return {
      segment_id: segment.id,
      success: true,
      spectrogram: {
        recording_id: recordingId,
        segment_id: segment.id,
        type: 'fast_single',
        image_url: imageUrl,
        image_local_path: outputFile,
        image_s3_key: s3Key,
        aed_events_count: aedEvents.length,
        generation_time_ms: generationTime,
        file_size_bytes: result.file_size_bytes || 0,
        config: generationConfig,
        segment_info: {
          start_ms: segment.start_ms,
          end_ms: segment.end_ms,
          duration_ms: segment.duration_ms
        }
      }
    };

  } catch (error) {
    // Update database with failure
    await db.query(`
      UPDATE spec_pyramids SET
        status = 'failed',
        error_message = :error,
        updated_at = NOW()
      WHERE segment_id = :segmentId AND spectrogram_type = 'fast_single'
    `, {
      replacements: {
        segmentId: segment.id,
        error: error.message
      },
      type: QueryTypes.UPDATE
    });

    throw error;
  }
};

/**
 * Get segment spectrograms for a recording
 */
export const getSegmentSpectrograms = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }
    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get segment spectrograms
    const spectrograms = await db.query(`
      SELECT sp.*, s.start_ms, s.end_ms, s.duration_ms, s.qc_status
      FROM spec_pyramids sp
      JOIN segments s ON sp.segment_id = s.id
      WHERE sp.recording_id = :recordingId 
      AND sp.segment_id IS NOT NULL
      AND sp.spectrogram_type = 'fast_single'
      ORDER BY s.start_ms ASC
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    // Add image URLs for each spectrogram
    const spectrogramsWithUrls = await Promise.all(
      spectrograms.map(async (spec) => {
        let imageUrl = spec.image_local_path ? `/uploads/segment-spectrograms/${path.basename(spec.image_local_path)}` : null;
        
        if (spec.image_s3_key) {
          try {
            imageUrl = await getS3FileUrl(spec.image_s3_key);
          } catch (s3Error) {
            console.warn('⚠️ Failed to get S3 URL, using fallback:', s3Error.message);
          }
        }
        
        return {
          ...spec,
          image_url: imageUrl
        };
      })
    );

    return res.json({
      success: true,
      recording_id: recordingId,
      segment_spectrograms: spectrogramsWithUrls,
      count: spectrogramsWithUrls.length
    });

  } catch (error) {
    console.error('Get segment spectrograms error:', error);
    return res.status(500).json({ error: 'Failed to retrieve segment spectrograms' });
  }
};

/**
 * Call Python spectrogram generator service
 */
async function callPythonSpectrogramGenerator(pythonScript, audioFile, outputFile, aedEvents, config) {
  return new Promise((resolve, reject) => {
    const eventsJson = JSON.stringify(aedEvents);
    
    // Use the system Python or specify python path
    const pythonProcess = spawn('python', [
      pythonScript,
      audioFile,
      outputFile,
      '--events-json', eventsJson
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        try {
          // Python script should output JSON result on the last line
          const lines = stdout.trim().split('\n');
          const resultLine = lines[lines.length - 1];
          const result = JSON.parse(resultLine);
          resolve(result);
        } catch (parseError) {
          console.error('Failed to parse Python output:', parseError);
          console.log('stdout:', stdout);
          resolve({ success: false, error: 'Failed to parse Python output' });
        }
      } else {
        console.error('Python process failed:', stderr);
        reject(new Error(`Python process failed with code ${code}: ${stderr}`));
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python process:', error);
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

/**
 * Get approved segments for spectrogram generation
 */
export const getApprovedSegmentsForSpectrogram = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Check if user has access to this recording
    const recording = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recording[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get approved segments (or all segments if no approval system)
    const segments = await db.query(`
      SELECT
        s.*,
        sa.status as approval_status,
        sa.approved_at,
        sa.approved_by
      FROM segments s
      LEFT JOIN segment_approvals sa ON s.id = sa.segment_id
      WHERE s.recording_id = :recordingId
        AND (sa.status = 'approved' OR sa.status IS NULL)
      ORDER BY s.start_ms ASC
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    console.log(`📊 Found ${segments.length} approved segments for recording ${recordingId}`);

    res.json(segments);

  } catch (error) {
    console.error('❌ Error getting approved segments:', error);
    res.status(500).json({ error: 'Failed to get approved segments: ' + error.message });
  }
};
