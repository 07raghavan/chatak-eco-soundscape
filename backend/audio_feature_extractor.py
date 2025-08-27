#!/usr/bin/env python3
"""
Audio Feature Extractor for Clustering
Extracts audio features from BirdNet detection snippets
"""

import os
import sys
import json
import argparse
import numpy as np
import librosa

def extract_audio_features(audio_path):
    """
    Extract audio features from audio file
    Focuses on features relevant for bird call clustering
    """
    try:
        # Load audio file
        y, sr = librosa.load(audio_path, sr=22050)
        
        # Ensure audio is mono
        if len(y.shape) > 1:
            y = np.mean(y, axis=1)
        
        # Extract MFCCs (Mel-frequency cepstral coefficients)
        mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=512)
        mfcc_mean = np.mean(mfcc, axis=1)
        mfcc_std = np.std(mfcc, axis=1)
        
        # Extract spectral features
        spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=512)
        spectral_bandwidth = librosa.feature.spectral_bandwidth(y=y, sr=sr, hop_length=512)
        spectral_rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, hop_length=512)
        
        # Extract zero crossing rate
        zero_crossing_rate = librosa.feature.zero_crossing_rate(y, hop_length=512)
        
        # Extract energy features
        rms = librosa.feature.rms(y=y, hop_length=512)
        
        # Extract pitch features (chroma)
        chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=512)
        
        # Combine all features into a single vector
        features = {
            # MFCC features
            'mfcc_mean': mfcc_mean.tolist(),
            'mfcc_std': mfcc_std.tolist(),
            
            # Spectral features
            'spectral_centroid_mean': float(np.mean(spectral_centroid)),
            'spectral_centroid_std': float(np.std(spectral_centroid)),
            'spectral_bandwidth_mean': float(np.mean(spectral_bandwidth)),
            'spectral_bandwidth_std': float(np.std(spectral_bandwidth)),
            'spectral_rolloff_mean': float(np.mean(spectral_rolloff)),
            'spectral_rolloff_std': float(np.std(spectral_rolloff)),
            
            # Rate features
            'zero_crossing_rate_mean': float(np.mean(zero_crossing_rate)),
            'zero_crossing_rate_std': float(np.std(zero_crossing_rate)),
            
            # Energy features
            'rms_mean': float(np.mean(rms)),
            'rms_std': float(np.std(rms)),
            
            # Chroma features (pitch)
            'chroma_mean': np.mean(chroma, axis=1).tolist(),
            'chroma_std': np.std(chroma, axis=1).tolist(),
            
            # Audio metadata
            'duration': float(librosa.get_duration(y=y, sr=sr)),
            'sample_rate': int(sr),
            'audio_length': len(y)
        }
        
        return features
        
    except Exception as e:
        print(f"[ERROR] Feature extraction failed: {str(e)}", file=sys.stderr)
        return None

def main():
    parser = argparse.ArgumentParser(description='Extract audio features from audio file')
    parser.add_argument('--audio', required=True, help='Path to audio file')
    parser.add_argument('--output', default='stdout', help='Output method (stdout or file path)')
    
    args = parser.parse_args()
    
    # Check if audio file exists
    if not os.path.exists(args.audio):
        print(f"[ERROR] Audio file not found: {args.audio}", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Extract features
        features = extract_audio_features(args.audio)
        
        if features is None:
            print("[ERROR] Feature extraction failed", file=sys.stderr)
            sys.exit(1)
        
        # Output features
        if args.output == 'stdout':
            print(json.dumps(features))
        else:
            with open(args.output, 'w') as f:
                json.dump(features, f, indent=2)
            print(f"[SUCCESS] Features saved to: {args.output}")
            
    except Exception as e:
        print(f"[ERROR] Unexpected error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
