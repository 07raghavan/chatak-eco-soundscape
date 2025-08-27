import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getAudioSnippetUrl } from '../config/s3.js';

/**
 * Audio Feature Extraction Service
 * Extracts audio features from BirdNet detection snippets for clustering
 */
export class AudioFeatureService {
  constructor() {
    this.tempDir = path.join(process.cwd(), 'temp_audio_features');
    
    // Ensure temp directory exists
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Extract audio features from a snippet
   * @param {string} s3Key - S3 key of the audio snippet
   * @returns {Promise<Object>} Extracted features
   */
  async extractFeatures(s3Key) {
    try {
      console.log(`🎵 Extracting features from: ${s3Key}`);
      
      // Download snippet to temp directory
      const tempPath = await this.downloadSnippet(s3Key);
      
      // Extract features using Python script
      const features = await this.runFeatureExtraction(tempPath);
      
      // Clean up temp file
      this.cleanupTempFile(tempPath);
      
      return features;
      
    } catch (error) {
      console.error(`❌ Feature extraction failed for ${s3Key}:`, error);
      throw error;
    }
  }

  /**
   * Download audio snippet from S3 to temp directory
   */
  async downloadSnippet(s3Key) {
    const tempPath = path.join(this.tempDir, `snippet_${Date.now()}_${path.basename(s3Key)}`);
    
    // Get signed URL for the snippet
    const snippetUrl = await getAudioSnippetUrl(s3Key);
    
    return new Promise((resolve, reject) => {
      const ffmpegPath = path.join(process.cwd(), 'bin', 'ffmpeg.exe');
      
      const ffmpegProcess = spawn(ffmpegPath, [
        '-y',                    // Overwrite output
        '-i', snippetUrl,        // Input URL
        '-acodec', 'pcm_s16le',  // Convert to WAV
        '-ar', '22050',          // Sample rate (good for speech/bird calls)
        '-ac', '1',              // Mono
        tempPath                 // Output path
      ]);
      
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          console.log(`✅ Snippet downloaded to: ${tempPath}`);
          resolve(tempPath);
        } else {
          reject(new Error(`FFmpeg failed with code ${code}`));
        }
      });
      
      ffmpegProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Run Python script to extract audio features
   */
  async runFeatureExtraction(audioPath) {
    return new Promise((resolve, reject) => {
      const pythonScript = path.join(process.cwd(), 'audio_feature_extractor.py');
      
      const pythonProcess = spawn('python', [
        pythonScript,
        '--audio', audioPath,
        '--output', 'stdout'
      ]);
      
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
            // Parse features from stdout
            const features = JSON.parse(stdout.trim());
            resolve(features);
          } catch (parseError) {
            reject(new Error(`Failed to parse features: ${parseError.message}`));
          }
        } else {
          reject(new Error(`Feature extraction failed with code ${code}: ${stderr}`));
        }
      });
      
      pythonProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Clean up temporary file
   */
  cleanupTempFile(tempPath) {
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
        console.log(`🧹 Cleaned up temp file: ${tempPath}`);
      }
    } catch (error) {
      console.warn('Failed to cleanup temp file:', error);
    }
  }

  /**
   * Extract features for multiple snippets
   * @param {Array} snippets - Array of snippet objects with s3_key
   * @returns {Promise<Array>} Array of features with snippet info
   */
  async extractFeaturesForSnippets(snippets) {
    const features = [];
    
    for (let i = 0; i < snippets.length; i++) {
      const snippet = snippets[i];
      try {
        console.log(`🎵 Processing snippet ${i + 1}/${snippets.length}`);
        
        const extractedFeatures = await this.extractFeatures(snippet.s3_key);
        
        features.push({
          snippet_id: snippet.id,
          event_id: snippet.event_id,
          s3_key: snippet.s3_key,
          features: extractedFeatures
        });
        
      } catch (error) {
        console.error(`❌ Failed to extract features for snippet ${snippet.id}:`, error);
        // Continue with other snippets
      }
    }
    
    return features;
  }
}

export default AudioFeatureService;
