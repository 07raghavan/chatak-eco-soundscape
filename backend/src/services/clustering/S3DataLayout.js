/**
 * S3 Data Layout Manager
 * Manages versioned S3 structure for clustering artifacts
 */

const path = require('path');
const { v4: uuidv4 } = require('uuid');

class S3DataLayout {
  constructor(s3Client, bucketName) {
    this.s3 = s3Client;
    this.bucket = bucketName;
  }

  /**
   * Generate run ID for clustering operations
   */
  generateRunId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const uuid = uuidv4().split('-')[0];
    return `${timestamp}_${uuid}`;
  }

  /**
   * Get base path for project clustering data
   */
  getProjectPath(projectId) {
    return `projects/${projectId}/clustering`;
  }

  /**
   * Get run-specific path
   */
  getRunPath(projectId, runId) {
    return `${this.getProjectPath(projectId)}/runs/${runId}`;
  }

  // =====================================================
  // ROI DATA PATHS
  // =====================================================

  /**
   * Get path for ROI metadata (Parquet)
   */
  getRoisPath(projectId, runId, shardIndex = null) {
    const basePath = `${this.getRunPath(projectId, runId)}/rois`;
    if (shardIndex !== null) {
      return `${basePath}/rois_${String(shardIndex).padStart(3, '0')}.parquet`;
    }
    return basePath;
  }

  /**
   * Get path for cached ROI audio snippets
   */
  getSnippetsPath(projectId, runId, roiId = null) {
    const basePath = `${this.getRunPath(projectId, runId)}/snippets`;
    if (roiId) {
      return `${basePath}/${roiId}.flac`;
    }
    return basePath;
  }

  // =====================================================
  // EMBEDDING PATHS
  // =====================================================

  /**
   * Get path for embeddings (Parquet shards)
   */
  getEmbeddingsPath(projectId, runId, modelVersion, shardIndex = null) {
    const basePath = `${this.getRunPath(projectId, runId)}/embeddings/${modelVersion}`;
    if (shardIndex !== null) {
      return `${basePath}/emb_${String(shardIndex).padStart(3, '0')}.parquet`;
    }
    return basePath;
  }

  /**
   * Get path for PCA model
   */
  getPcaPath(projectId, runId, version = 'v1') {
    return `${this.getRunPath(projectId, runId)}/pca/pca_${version}.pkl`;
  }

  /**
   * Get path for PCA-transformed embeddings
   */
  getPcaEmbeddingsPath(projectId, runId, version = 'v1', shardIndex = null) {
    const basePath = `${this.getRunPath(projectId, runId)}/pca/embeddings_${version}`;
    if (shardIndex !== null) {
      return `${basePath}/pca_emb_${String(shardIndex).padStart(3, '0')}.parquet`;
    }
    return basePath;
  }

  // =====================================================
  // FAISS INDEX PATHS
  // =====================================================

  /**
   * Get path for FAISS index files
   */
  getFaissPath(projectId, runId, version = 'v1', shardIndex = null) {
    const basePath = `${this.getRunPath(projectId, runId)}/faiss/faiss_${version}`;
    if (shardIndex !== null) {
      return `${basePath}_shard_${shardIndex}.bin`;
    }
    return `${basePath}.bin`;
  }

  /**
   * Get path for FAISS index metadata
   */
  getFaissMetadataPath(projectId, runId, version = 'v1') {
    return `${this.getRunPath(projectId, runId)}/faiss/faiss_${version}_metadata.json`;
  }

  // =====================================================
  // UMAP PATHS
  // =====================================================

  /**
   * Get path for UMAP coordinates
   */
  getUmapPath(projectId, runId, version = 'v1') {
    return `${this.getRunPath(projectId, runId)}/umap/umap_${version}.parquet`;
  }

  // =====================================================
  // CLUSTERING PATHS
  // =====================================================

  /**
   * Get path for cluster results
   */
  getClustersPath(projectId, runId, algorithm, version = 'v1') {
    return `${this.getRunPath(projectId, runId)}/clusters/${algorithm}_${version}`;
  }

  /**
   * Get path for cluster memberships
   */
  getClusterMembershipsPath(projectId, runId, algorithm, version = 'v1') {
    return `${this.getClustersPath(projectId, runId, algorithm, version)}/memberships.parquet`;
  }

  /**
   * Get path for cluster centroids
   */
  getClusterCentroidsPath(projectId, runId, algorithm, version = 'v1') {
    return `${this.getClustersPath(projectId, runId, algorithm, version)}/centroids.npy`;
  }

  /**
   * Get path for cluster exemplars
   */
  getClusterExemplarsPath(projectId, runId, algorithm, version = 'v1') {
    return `${this.getClustersPath(projectId, runId, algorithm, version)}/exemplars.parquet`;
  }

  /**
   * Get path for cluster quality metrics
   */
  getClusterQualityPath(projectId, runId, algorithm, version = 'v1') {
    return `${this.getClustersPath(projectId, runId, algorithm, version)}/quality.parquet`;
  }

  // =====================================================
  // PROPAGATION PATHS
  // =====================================================

  /**
   * Get path for propagation results
   */
  getPropagationPath(projectId, runId, propVersion = 'v1') {
    return `${this.getRunPath(projectId, runId)}/propagation/prop_${propVersion}.parquet`;
  }

  /**
   * Get path for propagation graph
   */
  getPropagationGraphPath(projectId, runId, propVersion = 'v1') {
    return `${this.getRunPath(projectId, runId)}/propagation/graph_${propVersion}.npz`;
  }

  // =====================================================
  // METRICS & MONITORING PATHS
  // =====================================================

  /**
   * Get path for run metrics
   */
  getMetricsPath(projectId, runId, version = 'v1') {
    return `${this.getRunPath(projectId, runId)}/metrics/metrics_${version}.json`;
  }

  /**
   * Get path for performance logs
   */
  getLogsPath(projectId, runId, logType = 'general') {
    return `${this.getRunPath(projectId, runId)}/logs/${logType}.log`;
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  /**
   * Check if S3 object exists
   */
  async exists(s3Key) {
    try {
      await this.s3.headObject({
        Bucket: this.bucket,
        Key: s3Key
      }).promise();
      return true;
    } catch (error) {
      if (error.code === 'NotFound') {
        return false;
      }
      throw error;
    }
  }

  /**
   * List objects with prefix
   */
  async listObjects(prefix, maxKeys = 1000) {
    try {
      const response = await this.s3.listObjectsV2({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: maxKeys
      }).promise();
      
      return response.Contents || [];
    } catch (error) {
      console.error(`Failed to list objects with prefix ${prefix}:`, error);
      throw error;
    }
  }

  /**
   * Get object metadata
   */
  async getObjectMetadata(s3Key) {
    try {
      const response = await this.s3.headObject({
        Bucket: this.bucket,
        Key: s3Key
      }).promise();
      
      return {
        size: response.ContentLength,
        lastModified: response.LastModified,
        etag: response.ETag,
        contentType: response.ContentType,
        metadata: response.Metadata
      };
    } catch (error) {
      console.error(`Failed to get metadata for ${s3Key}:`, error);
      throw error;
    }
  }

  /**
   * Generate signed URL for object
   */
  async getSignedUrl(s3Key, expiresIn = 3600) {
    try {
      return await this.s3.getSignedUrlPromise('getObject', {
        Bucket: this.bucket,
        Key: s3Key,
        Expires: expiresIn
      });
    } catch (error) {
      console.error(`Failed to generate signed URL for ${s3Key}:`, error);
      throw error;
    }
  }

  /**
   * Delete objects with prefix (cleanup)
   */
  async deletePrefix(prefix) {
    try {
      const objects = await this.listObjects(prefix);
      
      if (objects.length === 0) {
        return 0;
      }

      const deleteParams = {
        Bucket: this.bucket,
        Delete: {
          Objects: objects.map(obj => ({ Key: obj.Key }))
        }
      };

      const response = await this.s3.deleteObjects(deleteParams).promise();
      return response.Deleted ? response.Deleted.length : 0;
      
    } catch (error) {
      console.error(`Failed to delete objects with prefix ${prefix}:`, error);
      throw error;
    }
  }

  /**
   * Get run summary (all artifacts for a run)
   */
  async getRunSummary(projectId, runId) {
    const runPrefix = this.getRunPath(projectId, runId);
    const objects = await this.listObjects(runPrefix);
    
    const summary = {
      runId,
      projectId,
      totalObjects: objects.length,
      totalSize: objects.reduce((sum, obj) => sum + obj.Size, 0),
      artifacts: {
        rois: [],
        embeddings: [],
        clusters: [],
        propagation: [],
        metrics: []
      }
    };

    // Categorize objects
    for (const obj of objects) {
      const relativePath = obj.Key.replace(runPrefix + '/', '');
      
      if (relativePath.startsWith('rois/')) {
        summary.artifacts.rois.push(obj);
      } else if (relativePath.startsWith('embeddings/')) {
        summary.artifacts.embeddings.push(obj);
      } else if (relativePath.startsWith('clusters/')) {
        summary.artifacts.clusters.push(obj);
      } else if (relativePath.startsWith('propagation/')) {
        summary.artifacts.propagation.push(obj);
      } else if (relativePath.startsWith('metrics/')) {
        summary.artifacts.metrics.push(obj);
      }
    }

    return summary;
  }
}

module.exports = S3DataLayout;
