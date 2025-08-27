import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { getFileUrl, uploadFile, getAudioSnippetUrl } from '../config/s3.js';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { v4 as uuidv4 } from 'uuid';

/**
 * BirdNet AED Service
 * Analyzes audio recordings using BirdNet with location-specific species lists
 * and creates audio snippets for detected events
 */
export class BirdNetAEDService {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp_audio');
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Analyze recording with BirdNet AED
   * @param {number} recordingId - Recording ID
   * @param {Function} progressCallback - Progress callback function
   * @returns {Promise<Object>} Analysis results
   */
  async analyzeRecording(recordingId, progressCallback = () => {}) {
    try {
      console.log(`🐦 Starting BirdNet AED analysis for recording ${recordingId}`);
      progressCallback(10, 'Fetching recording data...');
      
      // Get recording with site coordinates
      const recording = await this.getRecordingWithSite(recordingId);
      if (!recording) {
        throw new Error('Recording not found');
      }
      console.log(`✅ Found recording: ${recording.name} at site: ${recording.site_name}`);

      progressCallback(20, 'Downloading audio file...');
      
      // Get signed URL and download audio
      const audioUrl = await getFileUrl(recording.file_path);
      console.log(`📥 Audio URL obtained, downloading...`);
      const tempAudioPath = await this.downloadAudio(audioUrl, recordingId);
      console.log(`✅ Audio downloaded to: ${tempAudioPath}`);

      progressCallback(40, 'Running BirdNet analysis...');
      
      // Run BirdNet analysis with location coordinates
      const detections = await this.runBirdNetAnalysis(
        tempAudioPath, 
        Number(recording.site_latitude), 
        Number(recording.site_longitude),
        progressCallback
      );

      progressCallback(70, 'Creating audio snippets...');
      
      // Create audio snippets for detected events
      const snippets = await this.createAudioSnippets(
        tempAudioPath, 
        detections, 
        recordingId
      );

      progressCallback(90, 'Saving results to database...');
      
      // Save results to database
      const savedEvents = await this.saveAEDEvents(recordingId, detections, snippets);

      // Cleanup temp files
      this.cleanupTempFiles(tempAudioPath);

      progressCallback(100, 'Analysis complete!');
      
      console.log(`🎉 BirdNet AED analysis completed successfully!`);
      console.log(`📊 Results: ${detections.length} detections, ${snippets.length} snippets, ${savedEvents.length} events saved`);
      
      return {
        success: true,
        recording: recording,
        detections: detections,
        snippets: snippets,
        events: savedEvents
      };

    } catch (error) {
      console.error('❌ BirdNet AED analysis failed:', error);
      throw error;
    }
  }

  /**
   * Get recording with site coordinates
   */
  async getRecordingWithSite(recordingId) {
    const result = await db.query(`
      SELECT 
        r.id,
        r.name,
        r.description,
        r.file_path,
        r.file_size,
        r.duration_seconds,
        r.recording_date,
        r.status,
        s.latitude as site_latitude,
        s.longitude as site_longitude,
        s.name as site_name
      FROM recordings r
      JOIN sites s ON r.site_id = s.id
      WHERE r.id = :recordingId
    `, {
      replacements: { recordingId },
      type: QueryTypes.SELECT
    });

    return result[0] || null;
  }

  /**
   * Download audio file from S3
   */
  async downloadAudio(audioUrl, recordingId) {
    const tempPath = path.join(this.tempDir, `recording_${recordingId}_${Date.now()}.wav`);
    console.log(`📥 Downloading audio from: ${audioUrl}`);
    console.log(`💾 Saving to: ${tempPath}`);
    
    return new Promise((resolve, reject) => {
      const ffmpegPath = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
      
      console.log(`🔧 Using FFmpeg: ${ffmpegPath}`);
      
      const ffmpegProcess = spawn(ffmpegPath, [
        '-y',                    // Overwrite output file
        '-i', audioUrl,          // Input URL
        '-acodec', 'pcm_s16le',  // Convert to WAV
        '-ar', '48000',          // Sample rate
        '-ac', '1',              // Mono
        tempPath                 // Output path
      ]);
      
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Audio download completed successfully`);
          resolve(tempPath);
        } else {
          console.error(`❌ FFmpeg failed with code ${code}`);
          reject(new Error(`FFmpeg failed with code ${code}`));
        }
      });
      
      ffmpegProcess.on('error', (error) => {
        console.error(`❌ FFmpeg error:`, error);
        reject(error);
      });
    });
  }



  /**
   * Run BirdNet analysis with location coordinates
   */
  async runBirdNetAnalysis(audioPath, latitude, longitude, progressCallback) {
    try {
      console.log(`🎯 Analyzing audio file: ${audioPath}`);
      console.log(`📍 Location: ${latitude}, ${longitude}`);
      
      // Run Python BirdNet script
      const pythonScript = path.join(process.cwd(), 'birdnet_analyzer.py');
      
      console.log("🔍 Running BirdNet analysis via Python script...");
      
      return new Promise((resolve, reject) => {
        const pythonProcess = spawn('python', [
          pythonScript,
          '--audio', audioPath,
          '--lat', latitude.toString(),
          '--lon', longitude.toString(),
          '--output', 'stdout'  // Changed to stdout
        ]);
        
        let stdout = '';
        let stderr = '';
        let detections = [];
        let inResults = false;
        
        pythonProcess.stdout.on('data', (data) => {
          const output = data.toString();
          stdout += output;
          console.log(`🐍 Python: ${output.trim()}`);
          
          // Update progress based on Python output
          if (output.includes('[INFO] Initializing BirdNet Analyzer')) {
            progressCallback(45, 'Initializing BirdNet...');
          } else if (output.includes('[INFO] Running BirdNet analysis')) {
            progressCallback(50, 'Running BirdNet analysis...');
          } else if (output.includes('[SUCCESS] Found') && output.includes('detections')) {
            const match = output.match(/Found (\d+) detections/);
            if (match) {
              const count = parseInt(match[1]);
              progressCallback(60, `Found ${count} detections`);
            }
          }
          
          // Parse detection results from stdout
          const lines = output.split('\n');
          for (const line of lines) {
            if (line.includes('[RESULTS_START]')) {
              inResults = true;
              detections = [];
            } else if (line.includes('[RESULTS_END]')) {
              inResults = false;
            } else if (inResults && line.includes('[DETECTION]')) {
              try {
                const detectionJson = line.replace('[DETECTION] ', '');
                const detection = JSON.parse(detectionJson);
                detections.push(detection);
              } catch (parseError) {
                console.warn('Failed to parse detection line:', line);
              }
            }
          }
        });
        
        pythonProcess.stderr.on('data', (data) => {
          const error = data.toString();
          stderr += error;
          console.error(`🐍 Python Error: ${error.trim()}`);
        });
        
        pythonProcess.on('close', (code) => {
          if (code === 0) {
            if (detections.length > 0) {
              console.log(`✅ BirdNet analysis complete! Found ${detections.length} detections`);
              progressCallback(65, `Processing ${detections.length} detections`);
              resolve(detections);
            } else {
              reject(new Error('No detections found in BirdNet analysis'));
            }
          } else {
            console.error(`❌ Python script failed with code ${code}`);
            console.error(`STDOUT: ${stdout}`);
            console.error(`STDERR: ${stderr}`);
            reject(new Error(`BirdNet analysis failed with exit code ${code}`));
          }
        });
        
        pythonProcess.on('error', (error) => {
          console.error('❌ Failed to start Python process:', error);
          reject(new Error(`Failed to start BirdNet analysis: ${error.message}`));
        });
      });

    } catch (error) {
      console.error('❌ BirdNet analysis error:', error);
      throw new Error(`BirdNet analysis failed: ${error.message}`);
    }
  }

  /**
   * Create audio snippets for detected events and upload to S3
   */
  async createAudioSnippets(audioPath, detections, recordingId) {
    const snippets = [];

    for (let i = 0; i < detections.length; i++) {
      const detection = detections[i];
      
      // Create snippet filename
      const snippetId = uuidv4();
      const snippetFilename = `snippet_${recordingId}_${snippetId}.wav`;
      
      // Create temporary local path for FFmpeg
      const tempSnippetPath = path.join(this.tempDir, snippetFilename);

      try {
        console.log(`🎵 Creating snippet ${i + 1}/${detections.length}: ${detection.species}`);
        
        // Extract audio segment using FFmpeg
        await this.extractAudioSegment(
          audioPath,
          tempSnippetPath,
          detection.start_time,
          detection.end_time
        );

        // Get snippet file size
        const stats = fs.statSync(tempSnippetPath);
        const fileSize = stats.size;

        // Generate S3 key for the snippet
        const s3Key = `aed-snippets/recording-${recordingId}/${snippetFilename}`;
        
        console.log(`📤 Uploading snippet to S3: ${s3Key}`);
        
        // Upload to S3
        const uploadResult = await uploadFile(tempSnippetPath, s3Key);
        
        // Clean up temporary local file
        try {
          fs.unlinkSync(tempSnippetPath);
        } catch (cleanupError) {
          console.warn('Failed to cleanup temp snippet file:', cleanupError);
        }

        snippets.push({
          id: snippetId,
          filename: snippetFilename,
          s3_key: s3Key,
          file_size: fileSize,
          start_time: detection.start_time,
          end_time: detection.end_time,
          duration: detection.duration,
          species: detection.species,
          confidence: detection.confidence
        });

        console.log(`✅ Snippet uploaded successfully: ${s3Key}`);

      } catch (error) {
        console.error(`❌ Failed to create snippet for detection ${i}:`, error);
        // Continue with other snippets
      }
    }

    return snippets;
  }

  /**
   * Extract audio segment using FFmpeg
   */
  async extractAudioSegment(inputPath, outputPath, startTime, endTime) {
    return new Promise((resolve, reject) => {
      const ffmpegPath = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
      
      spawn(ffmpegPath, [
        '-y',                    // Overwrite output
        '-i', inputPath,         // Input file
        '-ss', startTime.toString(),  // Start time
        '-t', (endTime - startTime).toString(),  // Duration
        '-acodec', 'pcm_s16le',  // Audio codec
        '-ar', '48000',          // Sample rate
        '-ac', '1',              // Mono
        outputPath               // Output file
      ])
      .on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg snippet extraction failed with code ${code}`));
        }
      })
      .on('error', reject);
    });
  }

  /**
   * Save AED events to database
   */
  async saveAEDEvents(recordingId, detections, snippets) {
    const events = [];
    console.log(`💾 Starting database save for ${detections.length} detections...`);
    console.log(`📊 Recording ID: ${recordingId}`);
    console.log(`📊 Detections count: ${detections.length}`);
    console.log(`📊 Snippets count: ${snippets.length}`);

    // First, check if table exists
    try {
      const tableCheck = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'events'
        );
      `, { type: QueryTypes.SELECT });
      
      if (!tableCheck[0].exists) {
        console.error('❌ Events table does not exist!');
        throw new Error('Events table not found. Please run the database migration.');
      }
      console.log('✅ Events table exists');
    } catch (error) {
      console.error('❌ Error checking table existence:', error);
      throw error;
    }

    for (let i = 0; i < detections.length; i++) {
      const detection = detections[i];
      const snippet = snippets[i];

      try {
        console.log(`📝 Processing detection ${i + 1}/${detections.length}: ${detection.species} (${detection.confidence})`);
        
        // Log the detection data
        console.log(`📊 Detection data:`, {
          species: detection.species,
          scientific_name: detection.scientific_name,
          confidence: detection.confidence,
          start_time: detection.start_time,
          end_time: detection.end_time,
          duration: detection.duration,
          start_ms: detection.start_ms,
          end_ms: detection.end_ms
        });
        
        // Log the snippet data
        if (snippet) {
          console.log(`📊 Snippet data:`, {
            id: snippet.id,
            filename: snippet.filename,
            file_path: snippet.file_path,
            file_size: snippet.file_size
          });
        } else {
          console.log(`⚠️ No snippet data for detection ${i + 1}`);
        }
        
        // Prepare the data being inserted
        const insertData = {
          recordingId,
          species: detection.species,
          scientificName: detection.scientific_name,
          confidence: detection.confidence,
          startMs: detection.start_ms,
          endMs: detection.end_ms,
          durationMs: Math.round(detection.duration * 1000),
          snippetFilePath: snippet ? snippet.s3_key : null,  // Store S3 key instead of local path
          snippetFileSize: snippet ? snippet.file_size : null
        };
        
        console.log('📊 Insert data prepared:', insertData);
        
        // Insert AED event
        const [eventResult] = await db.query(`
          INSERT INTO events (
            recording_id,
            species,
            scientific_name,
            confidence,
            start_ms,
            end_ms,
            duration_ms,
            snippet_file_path,
            snippet_file_size,
            created_at
          ) VALUES (
            :recordingId,
            :species,
            :scientificName,
            :confidence,
            :startMs,
            :endMs,
            :durationMs,
            :snippetFilePath,
            :snippetFileSize,
            NOW()
          ) RETURNING id
        `, {
          replacements: insertData,
          type: QueryTypes.INSERT
        });

        console.log(`✅ Successfully saved event with ID: ${eventResult[0].id}`);
        
        events.push({
          id: eventResult[0].id,
          ...detection,
          snippet: snippet
        });

      } catch (error) {
        console.error(`❌ Failed to save AED event ${i + 1}/${detections.length}:`, error);
        console.error(`Detection data:`, detection);
        console.error(`Snippet data:`, snippet);
        console.error(`Error message:`, error.message);
        console.error(`Error stack:`, error.stack);
        if (error.parent) {
          console.error(`Parent error:`, error.parent.message);
        }
        if (error.sqlState) {
          console.error(`SQL State:`, error.sqlState);
        }
        if (error.code) {
          console.error(`Error Code:`, error.code);
        }
        // Continue with other events
      }
    }

    console.log(`🎉 Database save completed!`);
    console.log(`📊 Summary:`);
    console.log(`   - Total detections processed: ${detections.length}`);
    console.log(`   - Total snippets created: ${snippets.length}`);
    console.log(`   - Events successfully saved: ${events.length}`);
    console.log(`   - Events failed to save: ${detections.length - events.length}`);
    
    if (events.length > 0) {
      console.log(`📊 First saved event:`, {
        id: events[0].id,
        species: events[0].species,
        confidence: events[0].confidence
      });
    }
    
    return events;
  }

  /**
   * Cleanup temporary files
   */
  cleanupTempFiles(tempPath) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (error) {
      console.warn('Failed to cleanup temp file:', error);
    }
  }

  /**
   * Get AED events for a recording with snippet URLs
   */
  async getAEDEvents(recordingId) {
    const events = await db.query(`
      SELECT 
        id,
        species,
        scientific_name,
        confidence,
        start_ms,
        end_ms,
        duration_ms,
        snippet_file_path,
        snippet_file_size,
        created_at
      FROM events
      WHERE recording_id = :recordingId
      ORDER BY confidence DESC, start_ms ASC
    `, {
      replacements: { recordingId },
      type: QueryTypes.SELECT
    });

    // Add snippet URLs to all events
    const eventsWithUrls = await Promise.all(events.map(async (event) => {
      if (event.snippet_file_path) {
        try {
          event.snippet_url = await getAudioSnippetUrl(event.snippet_file_path);
        } catch (error) {
          console.error(`Failed to generate snippet URL for event ${event.id}:`, error);
          event.snippet_url = null;
        }
      }
      return event;
    }));

    return eventsWithUrls;
  }

  /**
   * Get AED event with snippet URL
   */
  async getAEDEventWithSnippet(eventId) {
    const events = await db.query(`
      SELECT 
        id,
        species,
        scientific_name,
        confidence,
        start_ms,
        end_ms,
        duration_ms,
        snippet_file_path,
        snippet_file_size,
        created_at
      FROM events
      WHERE id = :eventId
    `, {
      replacements: { eventId },
      type: QueryTypes.SELECT
    });

    if (events.length === 0) {
      return null;
    }

    const event = events[0];
    
    // Generate signed URL for S3 snippet
    if (event.snippet_file_path) {
      try {
        event.snippet_url = await getAudioSnippetUrl(event.snippet_file_path);
      } catch (error) {
        console.error(`Failed to generate snippet URL for event ${eventId}:`, error);
        event.snippet_url = null;
      }
    }

    return event;
  }
}

export default BirdNetAEDService;
