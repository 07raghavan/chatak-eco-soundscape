#!/usr/bin/env python3
"""
Spectrogram Generator for Audio Events
Generates high-quality spectrograms using librosa and matplotlib
"""

import argparse
import librosa
import librosa.display
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np
import os
import sys
from pathlib import Path

def generate_spectrogram(audio_path, output_path, options):
    """
    Generate spectrogram from audio file
    
    Args:
        audio_path (str): Path to input audio file
        output_path (str): Path to output spectrogram image
        options (dict): Generation options
    """
    try:
        print(f"[INFO] Loading audio file: {audio_path}")
        
        # Load audio file
        y, sr = librosa.load(audio_path, sr=None)
        
        if len(y) == 0:
            raise ValueError("Audio file is empty or corrupted")
        
        print(f"[INFO] Audio loaded: {len(y)} samples, {sr} Hz sample rate")
        
        # Extract features
        D = librosa.stft(y, n_fft=options['n_fft'], hop_length=options['hop_length'])
        S_db = librosa.amplitude_to_db(np.abs(D), ref=np.max)
        
        # Create figure with specified dimensions
        fig, ax = plt.subplots(figsize=(options['width']/100, options['height']/100), dpi=100)
        
        # Display spectrogram
        img = librosa.display.specshow(
            S_db, 
            sr=sr, 
            hop_length=options['hop_length'],
            x_axis='time', 
            y_axis='hz',
            cmap=options['cmap'],
            fmin=options['fmin'],
            fmax=options['fmax']
        )
        
        # Customize appearance
        ax.set_title('Audio Spectrogram', fontsize=14, fontweight='bold')
        ax.set_xlabel('Time (s)', fontsize=12)
        ax.set_ylabel('Frequency (Hz)', fontsize=12)
        
        # Add colorbar
        cbar = plt.colorbar(img, ax=ax, format='%+2.0f dB')
        cbar.set_label('Intensity (dB)', fontsize=10)
        
        # Set frequency range
        ax.set_ylim([options['fmin'], options['fmax']])
        
        # Grid and styling
        ax.grid(True, alpha=0.3)
        ax.set_facecolor('white')
        
        # Adjust layout
        plt.tight_layout()
        
        # Save spectrogram
        print(f"[INFO] Saving spectrogram to: {output_path}")
        plt.savefig(
            output_path, 
            dpi=100, 
            bbox_inches='tight',
            facecolor='white',
            edgecolor='none'
        )
        
        plt.close()
        
        # Verify file was created
        if os.path.exists(output_path):
            file_size = os.path.getsize(output_path)
            print(f"[INFO] Spectrogram saved successfully: {file_size} bytes")
            return True
        else:
            raise ValueError("Failed to create output file")
            
    except Exception as e:
        print(f"[ERROR] Spectrogram generation failed: {str(e)}")
        return False

def main():
    """Main function to handle command line arguments and generate spectrogram"""
    parser = argparse.ArgumentParser(description='Generate spectrogram from audio file')
    
    # Required arguments
    parser.add_argument('--audio', required=True, help='Path to input audio file')
    parser.add_argument('--output', required=True, help='Path to output spectrogram image')
    
    # Optional arguments with defaults
    parser.add_argument('--width', type=int, default=1000, help='Image width in pixels')
    parser.add_argument('--height', type=int, default=600, help='Image height in pixels')
    parser.add_argument('--fmin', type=int, default=0, help='Minimum frequency (Hz)')
    parser.add_argument('--fmax', type=int, default=8000, help='Maximum frequency (Hz)')
    parser.add_argument('--n_fft', type=int, default=2048, help='FFT window size')
    parser.add_argument('--hop_length', type=int, default=512, help='Hop length for STFT')
    parser.add_argument('--cmap', default='viridis', help='Matplotlib colormap')
    
    args = parser.parse_args()
    
    # Validate input file
    if not os.path.exists(args.audio):
        print(f"[ERROR] Input audio file not found: {args.audio}")
        sys.exit(1)
    
    # Create output directory if it doesn't exist
    output_dir = os.path.dirname(args.output)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)
    
    # Prepare options
    options = {
        'width': args.width,
        'height': args.height,
        'fmin': args.fmin,
        'fmax': args.fmax,
        'n_fft': args.n_fft,
        'hop_length': args.hop_length,
        'cmap': args.cmap
    }
    
    print(f"[INFO] Starting spectrogram generation...")
    print(f"[INFO] Input: {args.audio}")
    print(f"[INFO] Output: {args.output}")
    print(f"[INFO] Options: {options}")
    
    # Generate spectrogram
    success = generate_spectrogram(args.audio, args.output, options)
    
    if success:
        print(f"[SUCCESS] Spectrogram generated successfully")
        sys.exit(0)
    else:
        print(f"[ERROR] Spectrogram generation failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
