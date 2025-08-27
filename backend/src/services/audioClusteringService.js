import { spawn } from 'child_process';
import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import path from 'path';

/**
 * Audio Clustering Service
 * Performs HDBSCAN clustering on extracted audio features
 */
export class AudioClusteringService {
  constructor() {
    this.pythonScript = path.join(process.cwd(), 'audio_clustering.py');
  }

  /**
   * Perform clustering on extracted features
   * @param {Array} features - Array of feature objects
   * @returns {Promise<Object>} Clustering results
   */
  async performClustering(features) {
    try {
      console.log(`🎯 Starting clustering for ${features.length} audio features`);
      
      // Prepare features for clustering
      const featureData = this.prepareFeatureData(features);
      
      // Run Python clustering script
      const clusteringResults = await this.runClustering(featureData);
      
      // Process and store results
      const processedResults = await this.processClusteringResults(features, clusteringResults);
      
      console.log(`✅ Clustering completed! Found ${processedResults.clusters.length} clusters`);
      
      return processedResults;
      
    } catch (error) {
      console.error('❌ Clustering failed:', error);
      throw error;
    }
  }

  /**
   * Prepare feature data for clustering
   */
  prepareFeatureData(features) {
    return features.map(feature => ({
      id: feature.snippet_id,
      event_id: feature.event_id,
      s3_key: feature.s3_key,
      features: feature.features
    }));
  }

  /**
   * Run Python clustering script
   */
  async runClustering(featureData) {
    return new Promise(async (resolve, reject) => {
      try {
        // Create temporary file for features data
        const fs = await import('fs/promises');
        const path = await import('path');
        const os = await import('os');
        
        const tempDir = os.tmpdir();
        const tempFile = path.join(tempDir, `clustering_features_${Date.now()}.json`);
        
        // Write features data to temporary file
        await fs.writeFile(tempFile, JSON.stringify(featureData, null, 2));
        
        const pythonProcess = spawn('python', [
          this.pythonScript,
          '--features-file', tempFile,
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
        
        pythonProcess.on('close', async (code) => {
          try {
            // Clean up temporary file
            await fs.unlink(tempFile);
            
            if (code === 0) {
              try {
                const results = JSON.parse(stdout.trim());
                resolve(results);
              } catch (parseError) {
                reject(new Error(`Failed to parse clustering results: ${parseError.message}`));
              }
            } else {
              reject(new Error(`Clustering failed with code ${code}: ${stderr}`));
            }
          } catch (cleanupError) {
            console.warn('Warning: Failed to clean up temporary file:', cleanupError);
            // Continue with result processing even if cleanup fails
            if (code === 0) {
              try {
                const results = JSON.parse(stdout.trim());
                resolve(results);
              } catch (parseError) {
                reject(new Error(`Failed to parse clustering results: ${parseError.message}`));
              }
            } else {
              reject(new Error(`Clustering failed with code ${code}: ${stderr}`));
            }
          }
        });
        
        pythonProcess.on('error', async (error) => {
          try {
            await fs.unlink(tempFile);
          } catch (cleanupError) {
            console.warn('Warning: Failed to clean up temporary file:', cleanupError);
          }
          reject(error);
        });
        
      } catch (error) {
        reject(new Error(`Failed to create temporary file: ${error.message}`));
      }
    });
  }

  /**
   * Process clustering results and store in database
   */
  async processClusteringResults(features, clusteringResults) {
    const { cluster_labels, umap_embeddings, cluster_centers } = clusteringResults;
    
    // Create clusters
    const clusters = await this.createClusters(cluster_centers);
    
    // Assign snippets to clusters
    const assignments = await this.createClusterAssignments(features, cluster_labels, clusters);
    
    // Store UMAP embeddings for visualization
    const embeddings = await this.storeUMAPEmbeddings(features, umap_embeddings);
    
    return {
      clusters,
      assignments,
      embeddings,
      total_clusters: clusters.length,
      total_snippets: features.length
    };
  }

  /**
   * Create cluster records in database
   */
  async createClusters(clusterCenters) {
    const clusters = [];
    
    for (let i = 0; i < clusterCenters.length; i++) {
      const center = clusterCenters[i];
      
      try {
        const [clusterResult] = await db.query(`
          INSERT INTO audio_clusters (
            name,
            cluster_label,
            feature_centroid,
            snippet_count,
            created_at
          ) VALUES (
            :name,
            :clusterLabel,
            :featureCentroid,
            :snippetCount,
            NOW()
          ) RETURNING id
        `, {
          replacements: {
            name: `Cluster ${i + 1}`,
            clusterLabel: i,
            featureCentroid: JSON.stringify(center),
            snippetCount: 0  // Will be updated after assignments
          },
          type: QueryTypes.INSERT
        });
        
        clusters.push({
          id: clusterResult[0].id,
          name: `Cluster ${i + 1}`,
          cluster_label: i,
          feature_centroid: center
        });
        
      } catch (error) {
        console.error(`❌ Failed to create cluster ${i}:`, error);
        // Continue with other clusters
      }
    }
    
    return clusters;
  }

  /**
   * Create cluster assignments for snippets
   */
  async createClusterAssignments(features, clusterLabels, clusters) {
    const assignments = [];
    
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const clusterLabel = clusterLabels[i];
      
      // Skip noise points (cluster label -1)
      if (clusterLabel === -1) {
        console.log(`⚠️ Snippet ${feature.snippet_id} marked as noise (no cluster)`);
        continue;
      }
      
      // Find corresponding cluster
      const cluster = clusters.find(c => c.cluster_label === clusterLabel);
      if (!cluster) {
        console.warn(`⚠️ No cluster found for label ${clusterLabel}`);
        continue;
      }
      
      try {
        const [assignmentResult] = await db.query(`
          INSERT INTO cluster_assignments (
            cluster_id,
            event_id,
            confidence,
            created_at
          ) VALUES (
            :clusterId,
            :eventId,
            :confidence,
            NOW()
          ) RETURNING id
        `, {
          replacements: {
            clusterId: cluster.id,
            eventId: feature.event_id,
            confidence: 1.0  // Default confidence for now
          },
          type: QueryTypes.INSERT
        });
        
        assignments.push({
          id: assignmentResult[0].id,
          cluster_id: cluster.id,
          event_id: feature.event_id,
          snippet_id: feature.snippet_id
        });
        
      } catch (error) {
        console.error(`❌ Failed to create assignment for snippet ${feature.snippet_id}:`, error);
        // Continue with other assignments
      }
    }
    
    // Update snippet counts for clusters
    await this.updateClusterSnippetCounts(clusters);
    
    return assignments;
  }

  /**
   * Update snippet counts for clusters
   */
  async updateClusterSnippetCounts(clusters) {
    for (const cluster of clusters) {
      try {
        const [countResult] = await db.query(`
          SELECT COUNT(*) as count
          FROM cluster_assignments
          WHERE cluster_id = :clusterId
        `, {
          replacements: { clusterId: cluster.id },
          type: QueryTypes.SELECT
        });
        
        await db.query(`
          UPDATE audio_clusters
          SET snippet_count = :count
          WHERE id = :clusterId
        `, {
          replacements: {
            count: countResult[0].count,
            clusterId: cluster.id
          },
          type: QueryTypes.UPDATE
        });
        
      } catch (error) {
        console.error(`❌ Failed to update snippet count for cluster ${cluster.id}:`, error);
      }
    }
  }

  /**
   * Store UMAP embeddings for visualization
   */
  async storeUMAPEmbeddings(features, umapEmbeddings) {
    const embeddings = [];
    
    for (let i = 0; i < features.length; i++) {
      const feature = features[i];
      const embedding = umapEmbeddings[i];
      
      try {
        const [embeddingResult] = await db.query(`
          INSERT INTO audio_features (
            event_id,
            feature_vector,
            umap_x,
            umap_y,
            created_at
          ) VALUES (
            :eventId,
            :featureVector,
            :umapX,
            :umapY,
            NOW()
          ) RETURNING id
        `, {
          replacements: {
            eventId: feature.event_id,
            featureVector: JSON.stringify(feature.features),
            umapX: embedding[0],
            umapY: embedding[1]
          },
          type: QueryTypes.INSERT
        });
        
        embeddings.push({
          id: embeddingResult[0].id,
          event_id: feature.event_id,
          umap_x: embedding[0],
          umap_y: embedding[1]
        });
        
      } catch (error) {
        console.error(`❌ Failed to store UMAP embedding for event ${feature.event_id}:`, error);
        // Continue with other embeddings
      }
    }
    
    return embeddings;
  }

  /**
   * Get clustering results for a recording
   */
  async getClusteringResults(recordingId) {
    try {
      // Get clusters with snippet counts
      const clusters = await db.query(`
        SELECT 
          c.id,
          c.name,
          c.cluster_label,
          c.feature_centroid,
          c.created_at,
          COUNT(DISTINCT ca.event_id) as snippet_count
        FROM audio_clusters c
        JOIN cluster_assignments ca ON c.id = ca.cluster_id
        JOIN events e ON ca.event_id = e.id
        WHERE e.recording_id = :recordingId
        GROUP BY c.id, c.name, c.cluster_label, c.feature_centroid, c.created_at
        ORDER BY c.cluster_label
      `, {
        replacements: { recordingId },
        type: QueryTypes.SELECT
      });

      console.log(`📊 Clustering service: Found ${clusters.length} clusters for recording ${recordingId}:`);
      clusters.forEach(cluster => {
        console.log(`  - Cluster ${cluster.cluster_label}: ${cluster.snippet_count} clips`);
      });
      
      // Get UMAP embeddings for visualization
      const embeddings = await db.query(`
        SELECT 
          af.event_id,
          af.umap_x,
          af.umap_y,
          ca.cluster_id
        FROM audio_features af
        JOIN cluster_assignments ca ON af.event_id = ca.event_id
        JOIN events e ON af.event_id = e.id
        WHERE e.recording_id = :recordingId
      `, {
        replacements: { recordingId },
        type: QueryTypes.SELECT
      });
      
      return {
        clusters,
        embeddings,
        total_clusters: clusters.length,
        total_snippets: embeddings.length
      };
      
    } catch (error) {
      console.error('❌ Failed to get clustering results:', error);
      throw error;
    }
  }
}
