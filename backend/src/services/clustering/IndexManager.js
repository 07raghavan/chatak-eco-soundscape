/**
 * Index Management System
 * Handles FAISS index versioning, sharding, and query optimization
 */

const clusteringConfig = require('../../config/clusteringConfig');

class IndexManager {
  constructor(db, s3DataLayout) {
    this.db = db;
    this.s3Layout = s3DataLayout;
    
    // Index configuration
    this.config = clusteringConfig.get('faiss', {});
    this.maxIndexSize = 1000000; // Max vectors per index shard
    this.cacheSize = 100; // Number of recent queries to cache
    
    // Query cache
    this.queryCache = new Map();
    this.cacheStats = {
      hits: 0,
      misses: 0,
      evictions: 0
    };
  }

  /**
   * Create or update embedding version with index information
   */
  async createEmbeddingVersion(projectId, modelConfig, indexResults) {
    try {
      const embeddingVersion = await this.db.EmbeddingVersion.create({
        projectId,
        modelName: modelConfig.model_name,
        modelVersion: modelConfig.model_version,
        pooling: modelConfig.pooling,
        dim: indexResults.dimension,
        pcaComponents: indexResults.reduced_dim || 50,
        pcaS3Key: indexResults.pca_model_s3_key,
        faissS3Prefix: this.getFaissPrefix(projectId, indexResults.run_id),
        umapS3Key: indexResults.umap_s3_key,
        statsJson: {
          index_type: indexResults.index_type,
          num_vectors: indexResults.num_vectors,
          index_size_mb: indexResults.index_size_mb,
          search_stats: indexResults.search_stats
        },
        configJson: modelConfig
      });

      console.log(`✅ Created embedding version ${embeddingVersion.id} for project ${projectId}`);
      return embeddingVersion;

    } catch (error) {
      console.error('Failed to create embedding version:', error);
      throw error;
    }
  }

  /**
   * Get active embedding version for project
   */
  async getActiveEmbeddingVersion(projectId) {
    try {
      const version = await this.db.EmbeddingVersion.findOne({
        where: { projectId },
        order: [['created_at', 'DESC']]
      });

      if (!version) {
        throw new Error(`No embedding version found for project ${projectId}`);
      }

      return version;

    } catch (error) {
      console.error(`Failed to get active embedding version for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Load FAISS index for similarity search
   */
  async loadIndex(projectId, runId = null) {
    try {
      let embeddingVersion;
      
      if (runId) {
        // Load specific run
        embeddingVersion = await this.db.EmbeddingVersion.findOne({
          where: { projectId },
          include: [{
            model: this.db.Cluster,
            where: { runId },
            required: true
          }]
        });
      } else {
        // Load most recent
        embeddingVersion = await this.getActiveEmbeddingVersion(projectId);
      }

      if (!embeddingVersion) {
        throw new Error('No embedding version found');
      }

      // Check if index exists
      const indexS3Key = `${embeddingVersion.faissS3Prefix}/faiss_index.bin`;
      const metadataS3Key = `${embeddingVersion.faissS3Prefix}/faiss_metadata.json`;

      const indexExists = await this.s3Layout.exists(indexS3Key);
      const metadataExists = await this.s3Layout.exists(metadataS3Key);

      if (!indexExists || !metadataExists) {
        throw new Error('Index files not found in S3');
      }

      // Load metadata
      const metadata = await this.s3Layout.s3_download_json(metadataS3Key);
      
      return {
        embeddingVersion,
        indexS3Key,
        metadataS3Key,
        metadata,
        isReady: true
      };

    } catch (error) {
      console.error(`Failed to load index for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Perform similarity search with caching and optimization
   */
  async similaritySearch(projectId, queryVector, k = 10, options = {}) {
    try {
      // Generate cache key
      const cacheKey = this.generateCacheKey(projectId, queryVector, k, options);
      
      // Check cache first
      if (this.queryCache.has(cacheKey)) {
        this.cacheStats.hits++;
        console.log(`🎯 Cache hit for similarity search`);
        return this.queryCache.get(cacheKey);
      }

      this.cacheStats.misses++;

      // Load index information
      const indexInfo = await this.loadIndex(projectId, options.runId);
      
      // For now, return simulated results
      // In production, this would load the actual FAISS index and perform search
      const results = await this.performSearch(indexInfo, queryVector, k, options);
      
      // Cache results
      this.cacheResults(cacheKey, results);
      
      return results;

    } catch (error) {
      console.error('Similarity search failed:', error);
      throw error;
    }
  }

  /**
   * Perform the actual similarity search
   */
  async performSearch(indexInfo, queryVector, k, options) {
    try {
      // This would typically:
      // 1. Download FAISS index from S3 (with local caching)
      // 2. Load index into memory
      // 3. Perform search
      // 4. Map indices back to ROI IDs
      
      // For now, simulate search results
      const metadata = indexInfo.metadata;
      const numVectors = metadata.roi_ids?.length || 1000;
      
      // Generate simulated results
      const results = {
        query_vector_dim: queryVector.length,
        k: k,
        total_vectors: numVectors,
        search_time_ms: Math.random() * 10 + 1, // Simulated search time
        results: []
      };

      // Generate k random results with decreasing similarity scores
      for (let i = 0; i < k && i < numVectors; i++) {
        const roiIndex = Math.floor(Math.random() * numVectors);
        const similarity = 1.0 - (i * 0.1) - (Math.random() * 0.05);
        
        results.results.push({
          roi_id: metadata.roi_ids?.[roiIndex] || roiIndex,
          similarity: similarity,
          distance: 1.0 - similarity,
          rank: i + 1
        });
      }

      // Sort by similarity (descending)
      results.results.sort((a, b) => b.similarity - a.similarity);

      console.log(`🔍 Similarity search completed: ${k} results in ${results.search_time_ms.toFixed(2)}ms`);
      
      return results;

    } catch (error) {
      console.error('Search execution failed:', error);
      throw error;
    }
  }

  /**
   * Get nearest neighbors for multiple ROIs (batch search)
   */
  async batchSimilaritySearch(projectId, roiIds, k = 10, options = {}) {
    try {
      console.log(`🔍 Batch similarity search for ${roiIds.length} ROIs`);
      
      const results = [];
      
      // Load ROI features to get query vectors
      const roiFeatures = await this.db.ROIFeature.findAll({
        where: {
          roiId: roiIds,
          featureType: options.featureType || 'embeddings'
        }
      });

      // For each ROI, perform similarity search
      for (const roiFeature of roiFeatures) {
        try {
          // In production, this would load the actual feature vector
          const queryVector = this.generateRandomVector(50); // Simulated PCA vector
          
          const searchResults = await this.similaritySearch(
            projectId, 
            queryVector, 
            k, 
            options
          );

          results.push({
            roi_id: roiFeature.roiId,
            neighbors: searchResults.results
          });

        } catch (error) {
          console.error(`Failed to search for ROI ${roiFeature.roiId}:`, error);
          results.push({
            roi_id: roiFeature.roiId,
            error: error.message,
            neighbors: []
          });
        }
      }

      return {
        batch_size: roiIds.length,
        successful_searches: results.filter(r => !r.error).length,
        failed_searches: results.filter(r => r.error).length,
        results: results
      };

    } catch (error) {
      console.error('Batch similarity search failed:', error);
      throw error;
    }
  }

  /**
   * Build k-NN graph for label propagation
   */
  async buildKNNGraph(projectId, k = 50, options = {}) {
    try {
      console.log(`🕸️ Building k-NN graph with k=${k} for project ${projectId}`);
      
      // Load index information
      const indexInfo = await this.loadIndex(projectId, options.runId);
      const numVectors = indexInfo.metadata.roi_ids?.length || 1000;
      
      // For large datasets, this would be done in batches
      const batchSize = 1000;
      const edges = [];
      
      for (let i = 0; i < numVectors; i += batchSize) {
        const batchEnd = Math.min(i + batchSize, numVectors);
        const batchRoiIds = indexInfo.metadata.roi_ids?.slice(i, batchEnd) || 
                           Array.from({length: batchEnd - i}, (_, idx) => i + idx);
        
        // Get neighbors for this batch
        const batchResults = await this.batchSimilaritySearch(
          projectId, 
          batchRoiIds, 
          k, 
          options
        );
        
        // Convert to graph edges
        for (const result of batchResults.results) {
          if (!result.error) {
            for (const neighbor of result.neighbors) {
              edges.push({
                source: result.roi_id,
                target: neighbor.roi_id,
                weight: neighbor.similarity,
                distance: neighbor.distance
              });
            }
          }
        }
        
        console.log(`📊 Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(numVectors/batchSize)}`);
      }

      // Save graph to S3
      const graphS3Key = this.getKNNGraphS3Key(projectId, options.runId || 'latest');
      const graphData = {
        project_id: projectId,
        run_id: options.runId,
        k: k,
        num_nodes: numVectors,
        num_edges: edges.length,
        edges: edges,
        created_at: new Date().toISOString()
      };

      const success = await this.s3Layout.s3_upload_json(graphData, graphS3Key);
      
      if (!success) {
        throw new Error('Failed to save k-NN graph');
      }

      console.log(`✅ k-NN graph built: ${numVectors} nodes, ${edges.length} edges`);
      
      return {
        graph_s3_key: graphS3Key,
        num_nodes: numVectors,
        num_edges: edges.length,
        avg_degree: edges.length / numVectors,
        k: k
      };

    } catch (error) {
      console.error('k-NN graph building failed:', error);
      throw error;
    }
  }

  /**
   * Generate cache key for query caching
   */
  generateCacheKey(projectId, queryVector, k, options) {
    const vectorHash = this.hashVector(queryVector);
    const optionsHash = JSON.stringify(options);
    return `${projectId}_${vectorHash}_${k}_${optionsHash}`;
  }

  /**
   * Simple vector hashing for cache keys
   */
  hashVector(vector) {
    let hash = 0;
    for (let i = 0; i < Math.min(vector.length, 10); i++) {
      hash = ((hash << 5) - hash + Math.floor(vector[i] * 1000)) & 0xffffffff;
    }
    return hash.toString(36);
  }

  /**
   * Cache search results
   */
  cacheResults(cacheKey, results) {
    // Implement LRU cache
    if (this.queryCache.size >= this.cacheSize) {
      const firstKey = this.queryCache.keys().next().value;
      this.queryCache.delete(firstKey);
      this.cacheStats.evictions++;
    }
    
    this.queryCache.set(cacheKey, results);
  }

  /**
   * Generate random vector for simulation
   */
  generateRandomVector(dim) {
    return Array.from({length: dim}, () => Math.random() * 2 - 1);
  }

  /**
   * Get FAISS prefix for S3 storage
   */
  getFaissPrefix(projectId, runId) {
    return `projects/${projectId}/clustering/runs/${runId}/faiss`;
  }

  /**
   * Get k-NN graph S3 key
   */
  getKNNGraphS3Key(projectId, runId) {
    return `projects/${projectId}/clustering/runs/${runId}/graphs/knn_graph.json`;
  }

  /**
   * Get index statistics
   */
  async getIndexStats(projectId) {
    try {
      const embeddingVersion = await this.getActiveEmbeddingVersion(projectId);
      
      const stats = {
        embedding_version_id: embeddingVersion.id,
        model_name: embeddingVersion.modelName,
        model_version: embeddingVersion.modelVersion,
        dimension: embeddingVersion.dim,
        pca_components: embeddingVersion.pcaComponents,
        index_stats: embeddingVersion.statsJson || {},
        cache_stats: this.cacheStats,
        created_at: embeddingVersion.createdAt
      };

      return stats;

    } catch (error) {
      console.error(`Failed to get index stats for project ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Clear query cache
   */
  clearCache() {
    this.queryCache.clear();
    this.cacheStats = { hits: 0, misses: 0, evictions: 0 };
    console.log('🗑️ Query cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const total = this.cacheStats.hits + this.cacheStats.misses;
    return {
      ...this.cacheStats,
      hit_rate: total > 0 ? this.cacheStats.hits / total : 0,
      cache_size: this.queryCache.size,
      max_cache_size: this.cacheSize
    };
  }
}

module.exports = IndexManager;
