#!/usr/bin/env python3
"""
Audio Clustering Script
Performs HDBSCAN clustering and UMAP dimensionality reduction on audio features
"""

import os
import sys
import json
import argparse
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
import hdbscan
import umap

def extract_feature_vector(features_dict):
    """
    Extract numerical feature vector from features dictionary
    """
    feature_vector = []
    
    # MFCC features
    if 'mfcc_mean' in features_dict:
        feature_vector.extend(features_dict['mfcc_mean'])
        feature_vector.extend(features_dict['mfcc_std'])
    
    # Spectral features
    spectral_features = [
        'spectral_centroid_mean', 'spectral_centroid_std',
        'spectral_bandwidth_mean', 'spectral_bandwidth_std',
        'spectral_rolloff_mean', 'spectral_rolloff_std'
    ]
    for feature in spectral_features:
        if feature in features_dict:
            feature_vector.append(features_dict[feature])
    
    # Rate features
    rate_features = ['zero_crossing_rate_mean', 'zero_crossing_rate_std']
    for feature in rate_features:
        if feature in features_dict:
            feature_vector.append(features_dict[feature])
    
    # Energy features
    energy_features = ['rms_mean', 'rms_std']
    for feature in energy_features:
        if feature in features_dict:
            feature_vector.append(features_dict[feature])
    
    # Chroma features
    if 'chroma_mean' in features_dict:
        feature_vector.extend(features_dict['chroma_mean'])
        feature_vector.extend(features_dict['chroma_std'])
    
    # Audio metadata
    metadata_features = ['duration', 'sample_rate', 'audio_length']
    for feature in metadata_features:
        if feature in features_dict:
            feature_vector.append(features_dict[feature])
    
    return np.array(feature_vector, dtype=float)

def perform_clustering(features_data):
    """
    Perform HDBSCAN clustering on audio features
    """

    
    # Extract feature vectors
    feature_vectors = []
    valid_indices = []
    
    for i, feature_data in enumerate(features_data):
        try:
            feature_vector = extract_feature_vector(feature_data['features'])
            
            # Check for NaN or infinite values
            if not np.any(np.isnan(feature_vector)) and not np.any(np.isinf(feature_vector)):
                feature_vectors.append(feature_vector)
                valid_indices.append(i)
            else:
                print(f"[WARNING] Invalid features for snippet {feature_data['id']}, skipping")
                
        except Exception as e:
            print(f"[WARNING] Failed to extract features for snippet {feature_data['id']}: {e}")
            continue
    
    if len(feature_vectors) == 0:
        raise ValueError("No valid feature vectors found")
    

    
    # Convert to numpy array
    X = np.array(feature_vectors)
    
    # Normalize features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    

    
    # Perform HDBSCAN clustering
    
    # Adjust parameters for small datasets
    if len(feature_vectors) <= 10:
        # For small datasets (≤10), use very lenient parameters
        min_cluster_size = max(2, len(feature_vectors) // 3)  # Allow smaller clusters
        min_samples = 1  # Single point can be core
        print(f"[DEBUG] Small dataset detected: {len(feature_vectors)} samples, using min_cluster_size={min_cluster_size}, min_samples={min_samples}", file=sys.stderr)
    elif len(feature_vectors) < 20:
        # For medium datasets, use moderate parameters
        min_cluster_size = 3
        min_samples = 2
        print(f"[DEBUG] Medium dataset detected: {len(feature_vectors)} samples, using min_cluster_size={min_cluster_size}, min_samples={min_samples}", file=sys.stderr)
    else:
        # For larger datasets, use standard parameters
        min_cluster_size = 3
        min_samples = 2
        print(f"[DEBUG] Large dataset detected: {len(feature_vectors)} samples, using min_cluster_size={min_cluster_size}, min_samples={min_samples}", file=sys.stderr)
    
    # Additional parameters for small datasets
    if len(feature_vectors) <= 10:
        # More lenient clustering for small datasets
        cluster_selection_epsilon = 0.3  # Higher epsilon = more lenient
        alpha = 0.5  # Lower alpha = less strict outlier detection
        print(f"[DEBUG] Using lenient parameters: epsilon={cluster_selection_epsilon}, alpha={alpha}", file=sys.stderr)
    else:
        # Standard parameters for larger datasets
        cluster_selection_epsilon = 0.1
        alpha = 1.0
        print(f"[DEBUG] Using standard parameters: epsilon={cluster_selection_epsilon}, alpha={alpha}", file=sys.stderr)
    
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,  # Dynamic minimum cluster size
        min_samples=min_samples,            # Dynamic minimum samples
        metric='euclidean',                 # Distance metric
        cluster_selection_method='eom',     # Excess of Mass
        cluster_selection_epsilon=cluster_selection_epsilon,  # Dynamic epsilon
        alpha=alpha                         # Dynamic alpha
    )
    
    cluster_labels = clusterer.fit_predict(X_scaled)
    
    # Get unique cluster labels (excluding noise: -1)
    unique_labels = set(cluster_labels)
    if -1 in unique_labels:
        unique_labels.remove(-1)
    

    
    # Calculate cluster centers for non-noise clusters
    cluster_centers = []
    for label in sorted(unique_labels):
        if label != -1:
            cluster_mask = cluster_labels == label
            cluster_center = np.mean(X_scaled[cluster_mask], axis=0)
            cluster_centers.append(cluster_center.tolist())
    
    # Perform UMAP dimensionality reduction for visualization
    
    # Adjust UMAP parameters for small datasets
    if len(feature_vectors) < 5:
        # For very small datasets, use minimal parameters
        n_neighbors = max(1, len(feature_vectors) - 1)  # Must be < N
        min_dist = 0.5  # Higher min_dist for small datasets
        print(f"[DEBUG] UMAP: Small dataset, using n_neighbors={n_neighbors}, min_dist={min_dist}", file=sys.stderr)
    elif len(feature_vectors) < 10:
        # For medium datasets
        n_neighbors = min(5, len(feature_vectors) - 1)
        min_dist = 0.3
        print(f"[DEBUG] UMAP: Medium dataset, using n_neighbors={n_neighbors}, min_dist={min_dist}", file=sys.stderr)
    else:
        # For larger datasets
        n_neighbors = 15
        min_dist = 0.1
        print(f"[DEBUG] UMAP: Standard dataset, using n_neighbors={n_neighbors}, min_dist={min_dist}", file=sys.stderr)
    
    # Ensure n_neighbors is valid (must be < N)
    n_neighbors = min(n_neighbors, len(feature_vectors) - 1)
    n_neighbors = max(1, n_neighbors)  # At least 1
    
    print(f"[DEBUG] Final UMAP parameters: n_neighbors={n_neighbors}, min_dist={min_dist}, dataset_size={len(feature_vectors)}", file=sys.stderr)
    
    reducer = umap.UMAP(
        n_neighbors=n_neighbors,  # Dynamic number of neighbors
        min_dist=min_dist,        # Dynamic minimum distance
        n_components=2,           # Output dimensions
        metric='euclidean',       # Distance metric
        random_state=42           # For reproducibility
    )
    
    umap_embeddings = reducer.fit_transform(X_scaled)
    

    
    # Prepare results
    results = {
        'cluster_labels': cluster_labels.tolist(),
        'umap_embeddings': umap_embeddings.tolist(),
        'cluster_centers': cluster_centers,
        'valid_indices': valid_indices,
        'total_clusters': len(unique_labels),
        'noise_points': int(np.sum(cluster_labels == -1))
    }
    
    return results

def main():
    parser = argparse.ArgumentParser(description='Perform audio clustering using HDBSCAN and UMAP')
    parser.add_argument('--features-file', required=True, help='Path to JSON file containing features data')
    parser.add_argument('--output', default='stdout', help='Output method (stdout or file path)')
    
    args = parser.parse_args()
    
    try:
        # Read features data from file
        with open(args.features_file, 'r') as f:
            features_data = json.load(f)
        
        if not features_data:
            print("[ERROR] No features data provided", file=sys.stderr)
            sys.exit(1)
        
        # Perform clustering
        results = perform_clustering(features_data)
        
        # Output results
        if args.output == 'stdout':
            print(json.dumps(results))
        else:
            with open(args.output, 'w') as f:
                json.dump(results, f, indent=2)
            print(f"[SUCCESS] Clustering results saved to: {args.output}")
            
    except Exception as e:
        print(f"[ERROR] Clustering failed: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
