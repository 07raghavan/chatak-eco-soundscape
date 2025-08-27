import { spawn } from 'child_process';
import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { getFileUrl, uploadFile } from '../utils/s3Utils.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

/**
 * Spectrogram Service
 * Handles generation and storage of spectrograms for audio events
 */

/**
 * Generate spectrogram for an audio event
 */
export const getOrGenerateSpectrogram = async (eventId, projectId, userId) => {
  try {
    console.log(`🎵 Generating spectrogram for event ${eventId}`);

    // Get event details
    const event = await db.query(`
      SELECT e.*, r.s3_key as recording_s3_key
      FROM events e
      JOIN recordings r ON e.recording_id = r.id
      WHERE e.id = :eventId
    `, {
      replacements: { eventId },
      type: QueryTypes.SELECT
    });

    if (event.length === 0) {
      return { success: false, error: 'Event not found' };
    }

    const eventData = event[0];
    const { start_ms, end_ms, snippet_file_path, recording_s3_key } = eventData;

    // Check if spectrogram already exists
    const existingSpectrogram = await db.query(`
      SELECT * FROM spectrograms 
      WHERE event_id = :eventId
    `, {
      replacements: { eventId },
      type: QueryTypes.SELECT
    });

    if (existingSpectrogram.length > 0) {
      const spectrogram = existingSpectrogram[0];
      const signedUrl = await getFileUrl(spectrogram.s3_key);
      return {
        success: true,
        spectrogram: {
          ...spectrogram,
          signedUrl
        },
        message: 'Spectrogram already exists'
      };
    }

    // Download audio snippet
    const audioUrl = await getFileUrl(snippet_file_path);
    if (!audioUrl) {
      return { success: false, error: 'Audio snippet not found' };
    }

    // Create temporary directory
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectrogram-'));
    const inputPath = path.join(tempDir, 'input.wav');
    const outputPath = path.join(tempDir, 'spectrogram.png');

    // Download audio file
    const response = await fetch(audioUrl);
    const buffer = await response.arrayBuffer();
    fs.writeFileSync(inputPath, Buffer.from(buffer));

    // Generate spectrogram using Python script
    const spectrogramResult = await generateSpectrogramPython(inputPath, outputPath, {
      width: 1200,
      height: 800,
      fmin: 0,
      fmax: 8000
    });

    if (!spectrogramResult.success) {
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { success: false, error: spectrogramResult.error };
    }

    // Upload spectrogram to S3
    const spectrogramBuffer = fs.readFileSync(outputPath);
    const s3Key = `spectrograms/event-${eventId}/spectrogram-${Date.now()}.png`;
    
    const uploadResult = await uploadFile(s3Key, spectrogramBuffer, 'image/png');
    
    if (!uploadResult.success) {
      // Cleanup
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { success: false, error: 'Failed to upload spectrogram to S3' };
    }

    // Save spectrogram metadata to database
    const [spectrogramRecord] = await db.query(`
      INSERT INTO spectrograms (
        event_id,
        file_path,
        s3_key,
        width,
        height,
        fmin,
        fmax,
        generated_at,
        expires_at
      ) VALUES (
        :eventId,
        :filePath,
        :s3Key,
        :width,
        :height,
        :fmin,
        :fmax,
        NOW(),
        NOW() + INTERVAL '7 days'
      ) RETURNING *
    `, {
      replacements: {
        eventId,
        filePath: outputPath,
        s3Key,
        width: 1200,
        height: 800,
        fmin: 0,
        fmax: 8000
      },
      type: QueryTypes.INSERT
    });

    // Cleanup temporary files
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Get signed URL for the spectrogram
    const signedUrl = await getFileUrl(s3Key);

    console.log(`✅ Spectrogram generated and uploaded: ${s3Key}`);

    return {
      success: true,
      spectrogram: {
        ...spectrogramRecord[0],
        signedUrl
      },
      message: 'Spectrogram generated successfully'
    };

  } catch (error) {
    console.error('❌ Error in getOrGenerateSpectrogram:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Generate spectrogram using Python script
 */
const generateSpectrogramPython = (inputPath, outputPath, options) => {
  return new Promise((resolve) => {
    const pythonScript = `
import librosa
import librosa.display
import matplotlib.pyplot as plt
import numpy as np
import sys

def generate_spectrogram(audio_path, output_path, options):
    try:
        # Load audio
        y, sr = librosa.load(audio_path, sr=None)
        
        # Generate spectrogram
        D = librosa.amplitude_to_db(np.abs(librosa.stft(y)), ref=np.max)
        
        # Create figure
        plt.figure(figsize=(options['width']/100, options['height']/100), dpi=100)
        librosa.display.specshow(D, sr=sr, x_axis='time', y_axis='hz',
                               fmin=options['fmin'], fmax=options['fmax'])
        
        plt.colorbar(format='%+2.0f dB')
        plt.title('Spectrogram')
        plt.tight_layout()
        
        # Save spectrogram
        plt.savefig(output_path, dpi=100, bbox_inches='tight')
        plt.close()
        
        return True
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return False

# Parse arguments
audio_path = "${inputPath.replace(/\\/g, '\\\\')}"
output_path = "${outputPath.replace(/\\/g, '\\\\')}"
options = {
    'width': ${options.width},
    'height': ${options.height},
    'fmin': ${options.fmin},
    'fmax': ${options.fmax}
}

success = generate_spectrogram(audio_path, output_path, options)
print("SUCCESS" if success else "ERROR")
`;

    const pythonProcess = spawn('python', ['-c', pythonScript]);

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code === 0 && stdout.trim() === 'SUCCESS') {
        resolve({ success: true });
      } else {
        console.error('Python spectrogram generation failed:', stderr);
        resolve({ success: false, error: stderr || 'Spectrogram generation failed' });
      }
    });

    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python process:', error);
      resolve({ success: false, error: error.message });
    });
  });
};
