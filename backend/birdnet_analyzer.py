#!/usr/bin/env python3
"""
BirdNet Analyzer Script
Called by Node.js backend to perform BirdNet analysis
"""

import os
import sys
import json
import argparse
from datetime import datetime

def analyze_audio_with_birdnet(audio_path, latitude, longitude, output_method='stdout'):
    """Analyze audio file with BirdNet and output results to stdout."""
    try:
        # Import BirdNet libraries
        from birdnetlib import Recording
        from birdnetlib.analyzer import Analyzer
        
        print(f"[INFO] Initializing BirdNet Analyzer...")
        analyzer = Analyzer()
        print("[SUCCESS] BirdNet Analyzer initialized successfully!")
        
        print(f"[INFO] Analyzing audio file: {audio_path}")
        print(f"[INFO] Using global species list (location filtering disabled)")
        
        # Create recording object WITHOUT location coordinates (global species list)
        recording = Recording(
            analyzer,
            audio_path,
            # lat=float(latitude),  # Commented out to use global species list
            # lon=float(longitude), # Commented out to use global species list
            date=datetime.now(),
            min_conf=0.05  # Lower threshold to catch more events
        )
        
        print("[INFO] Running BirdNet analysis...")
        # Run analysis
        recording.analyze()
        print("[SUCCESS] BirdNet analysis complete!")
        
        print(f"[INFO] Processing {len(recording.detections)} detections...")
        
        # Process and format detections
        detections = []
        for detection in recording.detections:
            # Handle both object and dictionary formats
            if hasattr(detection, 'common_name'):
                # Object format
                detection_data = {
                    "species": detection.common_name,
                    "scientific_name": detection.scientific_name,
                    "confidence": float(detection.confidence),
                    "start_time": float(detection.start_time),
                    "end_time": float(detection.end_time),
                    "duration": float(detection.end_time - detection.start_time),
                    "start_ms": int(detection.start_time * 1000),
                    "end_ms": int(detection.end_time * 1000)
                }
            else:
                # Dictionary format
                detection_data = {
                    "species": detection.get('common_name', detection.get('species', 'Unknown')),
                    "scientific_name": detection.get('scientific_name', 'Unknown'),
                    "confidence": float(detection.get('confidence', 0)),
                    "start_time": float(detection.get('start_time', 0)),
                    "end_time": float(detection.get('end_time', 0)),
                    "duration": float(detection.get('end_time', 0) - detection.get('start_time', 0)),
                    "start_ms": int(detection.get('start_time', 0) * 1000),
                    "end_ms": int(detection.get('end_time', 0) * 1000)
                }
            detections.append(detection_data)
        
        # Sort by confidence (highest first)
        detections.sort(key=lambda x: x['confidence'], reverse=True)
        
        print(f"[SUCCESS] Found {len(detections)} detections")
        
        # Print results directly to stdout for Node.js to capture
        print(f"[RESULTS_START]")
        for detection in detections:
            print(f"[DETECTION] {json.dumps(detection)}")
        print(f"[RESULTS_END]")
        
        return True
        
    except ImportError as e:
        print(f"[ERROR] BirdNet library not available: {e}")
        error_result = {
            "success": False,
            "error": "BirdNet library not available. Please install: pip install birdnetlib",
            "details": str(e)
        }
        with open(output_file, 'w') as f:
            json.dump(error_result, f, indent=2)
        return False
        
    except Exception as e:
        print(f"[ERROR] BirdNet analysis error: {e}")
        error_result = {
            "success": False,
            "error": f"BirdNet analysis failed: {str(e)}",
            "details": str(e)
        }
        with open(output_file, 'w') as f:
            json.dump(error_result, f, indent=2)
        return False

def main():
    """Main function to handle command line arguments."""
    parser = argparse.ArgumentParser(description='BirdNet Audio Analysis')
    parser.add_argument('--audio', required=True, help='Path to audio file')
    parser.add_argument('--lat', required=True, help='Latitude coordinate')
    parser.add_argument('--lon', required=True, help='Longitude coordinate')
    parser.add_argument('--output', default='stdout', help='Output method (stdout or file path)')
    
    args = parser.parse_args()
    
    # Validate inputs
    if not os.path.exists(args.audio):
        print(f"[ERROR] Audio file not found: {args.audio}")
        sys.exit(1)
    
    try:
        lat = float(args.lat)
        lon = float(args.lon)
    except ValueError:
        print("[ERROR] Invalid coordinates provided")
        sys.exit(1)
    
    # Run analysis
    success = analyze_audio_with_birdnet(args.audio, lat, lon, args.output)
    
    if success:
        print("[SUCCESS] BirdNet analysis completed successfully!")
        sys.exit(0)
    else:
        print("[ERROR] BirdNet analysis failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()
