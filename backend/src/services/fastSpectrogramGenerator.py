#!/usr/bin/env python3
"""
Ultra-Fast Spectrogram Generator with AED ROI Integration
Uses optimized Python libraries for maximum speed
"""

import os
import sys
import json
import argparse
import numpy as np
import librosa
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend for speed
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.colors import LinearSegmentedColormap
import warnings
warnings.filterwarnings('ignore')

class FastSpectrogramGenerator:
    def __init__(self):
        self.default_config = {
            'n_fft': 1024,  # Smaller FFT for better time resolution
            'hop_length': 256,  # Smaller hop for more detail
            'n_mels': 128,
            'fmin': 0,
            'fmax': None,  # Will be set to sr/2
            'power': 2.0,
            'db_range': 80,
            'colormap': 'viridis',
            'width_inches': 12,  # Standard width for clips
            'height_inches': 6,   # Standard height for clips
            'dpi': 100,
            'roi_color': '#ff6b35',  # Single orange color for all ROI boxes
            'roi_alpha': 0.6         # Semi-transparent boxes
        }
    
    def generate_spectrogram(self, audio_file, output_file, aed_events=None, config=None):
        """
        Generate ultra-fast spectrogram with AED ROI overlays
        
        Args:
            audio_file (str): Path to input audio file
            output_file (str): Path to output spectrogram image
            aed_events (list): List of AED events with time/frequency info
            config (dict): Configuration parameters
            
        Returns:
            dict: Generation statistics and metadata
        """
        print(f"[INFO] Generating fast spectrogram: {audio_file} to {output_file}")
        
        # Merge configuration
        cfg = self.default_config.copy()
        if config:
            cfg.update(config)
        
        try:
            # Load audio with librosa (fastest audio loading)
            print("[INFO] Loading audio...")
            y, sr = librosa.load(audio_file, sr=None, mono=True)
            duration = len(y) / sr
            print(f"[INFO] Audio loaded: {duration:.2f}s at {sr}Hz")
            
            if cfg['fmax'] is None:
                cfg['fmax'] = sr // 2
            
            # Generate mel spectrogram (faster than STFT for visualization)
            print("[INFO] Computing mel spectrogram...")
            S = librosa.feature.melspectrogram(
                y=y, 
                sr=sr,
                n_fft=cfg['n_fft'],
                hop_length=cfg['hop_length'],
                n_mels=cfg['n_mels'],
                fmin=cfg['fmin'],
                fmax=cfg['fmax'],
                power=cfg['power']
            )
            
            # Convert to dB
            S_dB = librosa.power_to_db(S, ref=np.max, top_db=cfg['db_range'])
            
            # Create figure with optimized settings
            print("[INFO] Creating visualization...")
            fig, ax = plt.subplots(
                figsize=(cfg['width_inches'], cfg['height_inches']), 
                dpi=cfg['dpi'],
                facecolor='black'
            )
            
            # Plot spectrogram
            img = librosa.display.specshow(
                S_dB,
                sr=sr,
                hop_length=cfg['hop_length'],
                x_axis='time',
                y_axis='mel',
                fmin=cfg['fmin'],
                fmax=cfg['fmax'],
                ax=ax,
                cmap=cfg['colormap']
            )
            
            # Style the plot
            ax.set_facecolor('black')
            ax.set_xlabel('Time (s)', color='white', fontsize=12)
            ax.set_ylabel('Frequency (Hz)', color='white', fontsize=12)
            ax.tick_params(colors='white')
            
            # Add ROI boxes for AED events
            if aed_events:
                print(f"[INFO] Adding {len(aed_events)} ROI boxes...")
                self.add_roi_boxes(ax, aed_events, duration, cfg)
            
            # Add colorbar
            cbar = plt.colorbar(img, ax=ax, format='%+2.0f dB')
            cbar.ax.tick_params(colors='white')
            cbar.set_label('Power (dB)', color='white', fontsize=12)
            
            # Set title with clip information
            filename = os.path.basename(audio_file)
            clip_info = config.get('clip_info', '')
            title = f'Clip Spectrogram: {filename}'
            if clip_info:
                title = f'Clip Spectrogram: {clip_info}'
            ax.set_title(title, color='white', fontsize=12, pad=15)
            
            # Tight layout
            plt.tight_layout()
            
            # Save with high quality
            print(f"[INFO] Saving to {output_file}...")
            plt.savefig(
                output_file,
                facecolor='black',
                edgecolor='none',
                bbox_inches='tight',
                dpi=cfg['dpi'],
                format='png'
            )
            plt.close(fig)  # Free memory
            
            # Generate metadata
            metadata = {
                'success': True,
                'duration_seconds': duration,
                'sample_rate': sr,
                'n_events': len(aed_events) if aed_events else 0,
                'dimensions': {
                    'width': cfg['width_inches'] * cfg['dpi'],
                    'height': cfg['height_inches'] * cfg['dpi']
                },
                'config': cfg,
                'file_size_bytes': os.path.getsize(output_file) if os.path.exists(output_file) else 0
            }
            
            print(f"[SUCCESS] Spectrogram generated successfully!")
            return metadata
            
        except Exception as e:
            print(f"[ERROR] Error generating spectrogram: {str(e)}")
            return {
                'success': False,
                'error': str(e),
                'n_events': len(aed_events) if aed_events else 0
            }
    
    def get_sound_type_color(self, sound_type):
        """Get color scheme for different sound types"""
        color_map = {
            'bird': '#FF6B35',           # Orange-red for general birds
            'bird_low': '#FF8C42',       # Light orange for low-freq birds  
            'bird_high': '#FF4081',      # Pink for high-freq birds
            'bird_chip': '#FF7043',      # Orange for chip calls
            'bird_song': '#FFA726',      # Amber for songs
            'frog': '#4CAF50',           # Green for frogs/toads
            'insect': '#FFEB3B',         # Yellow for insects
            'mammal': '#795548',         # Brown for mammals
            'unknown': '#9E9E9E'         # Gray for unknown
        }
        return color_map.get(sound_type, color_map['unknown'])
        
    def add_roi_boxes(self, ax, aed_events, duration, config):
        """Add enhanced ROI boxes for grouped AED events on the spectrogram (clip-based timing)"""
        
        default_color = config['roi_color']
        alpha = config['roi_alpha']
        
        print(f"[INFO] ===== ROI BOXING DEBUG (GROUPED) ======")
        print(f"[INFO] Processing {len(aed_events)} events/groups for ROI boxes...")
        print(f"[INFO] Audio duration: {duration:.3f}s")
        print(f"[INFO] Default box color: {default_color}, alpha: {alpha}")
        
        if len(aed_events) == 0:
            print(f"[WARNING] No events to process for ROI boxes!")
            return
        
        boxes_added = 0
        
        for i, event in enumerate(aed_events):
            try:
                print(f"\n[DEBUG] Processing Event {i+1}:")
                print(f"[DEBUG] Raw event data: {event}")
                
                # Extract event properties with relative timing (clip-based)
                start_sec = event.get('start_ms', 0) / 1000.0
                end_sec = event.get('end_ms', 0) / 1000.0
                f_min = event.get('f_min_hz')
                f_max = event.get('f_max_hz')
                confidence = event.get('confidence', 0.0)
                sound_type = event.get('sound_type', 'unknown')
                group_size = event.get('group_size', 1)
                event_ids = event.get('event_ids', [event.get('id', i)])
                
                print(f"[DEBUG] Parsed timing: {start_sec:.3f}s - {end_sec:.3f}s")
                print(f"[DEBUG] Parsed frequency: {f_min}Hz - {f_max}Hz")
                print(f"[DEBUG] Confidence: {confidence:.3f}")
                print(f"[DEBUG] Sound type: {sound_type}")
                print(f"[DEBUG] Group size: {group_size} (contains events: {event_ids})")
                
                # Skip invalid events
                if start_sec >= end_sec:
                    print(f"[WARNING] Invalid time range: start ({start_sec:.3f}s) >= end ({end_sec:.3f}s)")
                    continue
                    
                if start_sec >= duration:
                    print(f"[WARNING] Event starts after audio ends: {start_sec:.3f}s >= {duration:.3f}s")
                    continue
                    
                if end_sec <= 0:
                    print(f"[WARNING] Event ends before audio starts: {end_sec:.3f}s <= 0s")
                    continue
                
                # Clamp to clip boundaries
                original_start = start_sec
                original_end = end_sec
                start_sec = max(0, start_sec)
                end_sec = min(duration, end_sec)
                
                if start_sec != original_start or end_sec != original_end:
                    print(f"[INFO] Clamped timing: {original_start:.3f}s-{original_end:.3f}s -> {start_sec:.3f}s-{end_sec:.3f}s")
                
                # Handle frequency bounds - use defaults if missing
                if f_min is None or f_max is None:
                    print(f"[WARNING] Missing frequency data - f_min: {f_min}, f_max: {f_max}")
                    # Use reasonable defaults for bird calls
                    f_min = f_min if f_min is not None else 1000.0  # Default minimum 1kHz
                    f_max = f_max if f_max is not None else 8000.0  # Default maximum 8kHz
                    print(f"[INFO] Using default frequency bounds: {f_min:.0f}Hz - {f_max:.0f}Hz")
                
                # Ensure frequency bounds are valid
                if f_min >= f_max:
                    print(f"[WARNING] Invalid frequency range: f_min ({f_min:.0f}) >= f_max ({f_max:.0f})")
                    f_max = f_min + 1000  # Add 1kHz if invalid range
                    print(f"[INFO] Fixed frequency range: {f_min:.0f}Hz - {f_max:.0f}Hz")
                
                # Calculate box dimensions
                width = end_sec - start_sec
                height = f_max - f_min
                
                print(f"[INFO] Box dimensions: width={width:.3f}s, height={height:.0f}Hz")
                
                if width <= 0:
                    print(f"[WARNING] Zero or negative width: {width:.3f}s")
                    continue
                    
                if height <= 0:
                    print(f"[WARNING] Zero or negative height: {height:.0f}Hz")
                    continue
                
                # Use simple orange color for all boxes
                box_color = '#FF6B35'  # Orange color
                border_color = '#D84315'  # Dark orange border
                
                # Make boxes VERY visible with consistent coloring
                # 1. Semi-transparent fill
                fill_rect = patches.Rectangle(
                    (start_sec, f_min),
                    width,
                    height,
                    linewidth=0,
                    facecolor=box_color,  # Simple orange color
                    alpha=0.4,  # Semi-transparent fill
                    zorder=10  # Ensure it's on top
                )
                ax.add_patch(fill_rect)
                
                # 2. Very thick, bright border
                border_rect = patches.Rectangle(
                    (start_sec, f_min),
                    width,
                    height,
                    linewidth=4,  # Very thick border
                    edgecolor=border_color,  # Dark orange border
                    facecolor='none',
                    alpha=1.0,  # Fully opaque border
                    linestyle='-',
                    zorder=11  # Even higher z-order
                )
                ax.add_patch(border_rect)
                
                # 3. Large, visible label with sound type and group info
                label_x = start_sec + max(0.01, width * 0.05)
                label_y = f_min + height * 0.8
                
                # Create simple label without sound type classification
                if group_size > 1:
                    label_text = f'GROUP ({group_size})'
                    if confidence > 0:
                        label_text = f'GROUP ({group_size})\n{confidence:.2f}'
                else:
                    label_text = f'EVENT'
                    if confidence > 0:
                        label_text = f'EVENT\n{confidence:.2f}'
                
                # Use contrasting text color
                text_color = 'white' if sound_type in ['mammal', 'unknown'] else 'black'
                
                ax.text(
                    label_x, label_y,
                    label_text,
                    fontsize=10,  # Slightly smaller for multi-line text
                    color=text_color,  # Contrasting text color
                    weight='bold',
                    ha='left', va='top',  # Anchor to top-left
                    bbox=dict(
                        boxstyle='round,pad=0.3', 
                        facecolor=box_color, 
                        alpha=0.8,  # Semi-transparent background
                        edgecolor=border_color, 
                        linewidth=2
                    ),
                    zorder=12  # Highest z-order for text
                )
                
                boxes_added += 1
                print(f"[SUCCESS] ✅ Added ROI box #{i+1}: {start_sec:.3f}s-{end_sec:.3f}s, {f_min:.0f}-{f_max:.0f}Hz")
                        
            except Exception as e:
                print(f"[ERROR] ❌ Failed to process event {i}: {e}")
                import traceback
                traceback.print_exc()
                continue
        
        print(f"\n[INFO] ===== SUMMARY ======")
        print(f"[INFO] Total events processed: {len(aed_events)}")
        print(f"[INFO] Boxes successfully added: {boxes_added}")
        print(f"[INFO] ============================")

def main():
    """Command line interface"""
    parser = argparse.ArgumentParser(description='Fast Spectrogram Generator with AED ROI')
    parser.add_argument('audio_file', help='Input audio file path')
    parser.add_argument('output_file', help='Output spectrogram image path')
    parser.add_argument('--events', help='JSON file containing AED events')
    parser.add_argument('--config', help='JSON configuration file')
    parser.add_argument('--events-json', help='AED events as JSON string')
    
    args = parser.parse_args()
    
    # Load AED events
    aed_events = []
    if args.events and os.path.exists(args.events):
        with open(args.events, 'r') as f:
            aed_events = json.load(f)
    elif args.events_json:
        aed_events = json.loads(args.events_json)
    
    # Load configuration
    config = {}
    if args.config and os.path.exists(args.config):
        with open(args.config, 'r') as f:
            config = json.load(f)
    
    # Generate spectrogram
    generator = FastSpectrogramGenerator()
    result = generator.generate_spectrogram(
        args.audio_file,
        args.output_file,
        aed_events,
        config
    )
    
    # Print result as JSON for Node.js consumption
    print(json.dumps(result))

if __name__ == '__main__':
    main()
