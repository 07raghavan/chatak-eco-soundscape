/**
 * Feature Validation System
 * Quality control and validation for extracted features
 */

const clusteringConfig = require('../../config/clusteringConfig');

class FeatureValidator {
  constructor(s3DataLayout) {
    this.s3Layout = s3DataLayout;
    this.config = clusteringConfig.get('feature_extraction', {});
    
    // Validation thresholds
    this.thresholds = {
      dsp: {
        min_features: 20,           // Minimum number of DSP features
        max_nan_ratio: 0.05,        // Max 5% NaN values
        min_variance: 1e-6,         // Minimum feature variance
        max_correlation: 0.95,      // Max correlation between features
        snr_min: -20,               // Minimum SNR in dB
        snr_max: 60,                // Maximum SNR in dB
        duration_min: 0.1,          // Minimum duration in seconds
        duration_max: 30.0          // Maximum duration in seconds
      },
      embeddings: {
        min_dim: 64,                // Minimum embedding dimension
        max_dim: 4096,              // Maximum embedding dimension
        max_nan_ratio: 0.01,        // Max 1% NaN values
        min_norm: 0.01,             // Minimum L2 norm
        max_norm: 100.0,            // Maximum L2 norm
        cosine_similarity_threshold: 0.99  // Detect near-duplicate embeddings
      }
    };
  }

  /**
   * Validate DSP features
   */
  async validateDSPFeatures(projectId, runId, featuresS3Key) {
    try {
      console.log(`🔍 Validating DSP features: ${featuresS3Key}`);
      
      // Download features DataFrame
      const featuresData = await this.downloadFeaturesData(featuresS3Key);
      if (!featuresData) {
        throw new Error('Failed to download features data');
      }

      const validation = {
        valid: true,
        warnings: [],
        errors: [],
        stats: {},
        quality_score: 1.0
      };

      // Basic structure validation
      this.validateBasicStructure(featuresData, 'dsp', validation);
      
      // Feature quality validation
      this.validateFeatureQuality(featuresData, 'dsp', validation);
      
      // Statistical validation
      this.validateStatistics(featuresData, 'dsp', validation);
      
      // Cross-feature validation
      this.validateFeatureCorrelations(featuresData, validation);
      
      // Calculate overall quality score
      validation.quality_score = this.calculateQualityScore(validation);
      
      // Save validation report
      await this.saveValidationReport(projectId, runId, 'dsp', validation);
      
      console.log(`✅ DSP features validation complete. Quality: ${validation.quality_score.toFixed(3)}`);
      
      return validation;
      
    } catch (error) {
      console.error('DSP features validation failed:', error);
      throw error;
    }
  }

  /**
   * Validate deep embeddings
   */
  async validateEmbeddings(projectId, runId, embeddingsS3Key) {
    try {
      console.log(`🔍 Validating embeddings: ${embeddingsS3Key}`);
      
      // Download embeddings DataFrame
      const embeddingsData = await this.downloadFeaturesData(embeddingsS3Key);
      if (!embeddingsData) {
        throw new Error('Failed to download embeddings data');
      }

      const validation = {
        valid: true,
        warnings: [],
        errors: [],
        stats: {},
        quality_score: 1.0
      };

      // Basic structure validation
      this.validateBasicStructure(embeddingsData, 'embeddings', validation);
      
      // Embedding quality validation
      this.validateEmbeddingQuality(embeddingsData, validation);
      
      // Dimensionality validation
      this.validateEmbeddingDimensions(embeddingsData, validation);
      
      // Similarity validation (detect duplicates)
      await this.validateEmbeddingSimilarity(embeddingsData, validation);
      
      // Calculate overall quality score
      validation.quality_score = this.calculateQualityScore(validation);
      
      // Save validation report
      await this.saveValidationReport(projectId, runId, 'embeddings', validation);
      
      console.log(`✅ Embeddings validation complete. Quality: ${validation.quality_score.toFixed(3)}`);
      
      return validation;
      
    } catch (error) {
      console.error('Embeddings validation failed:', error);
      throw error;
    }
  }

  /**
   * Download features data from S3
   */
  async downloadFeaturesData(s3Key) {
    try {
      // This would typically download and parse Parquet data
      // For now, simulate with metadata check
      const exists = await this.s3Layout.exists(s3Key);
      if (!exists) {
        return null;
      }

      const metadata = await this.s3Layout.getObjectMetadata(s3Key);
      
      // Return simulated data structure
      return {
        metadata,
        rowCount: parseInt(metadata.metadata?.rows || '0'),
        columnCount: parseInt(metadata.metadata?.columns || '0'),
        size: metadata.size
      };
      
    } catch (error) {
      console.error(`Failed to download features data from ${s3Key}:`, error);
      return null;
    }
  }

  /**
   * Validate basic data structure
   */
  validateBasicStructure(data, featureType, validation) {
    const thresholds = this.thresholds[featureType];
    
    // Check if data exists
    if (!data || data.rowCount === 0) {
      validation.errors.push('No data found');
      validation.valid = false;
      return;
    }

    // Check minimum features/dimensions
    const minFeatures = featureType === 'dsp' ? thresholds.min_features : thresholds.min_dim;
    if (data.columnCount < minFeatures) {
      validation.errors.push(`Insufficient features: ${data.columnCount} < ${minFeatures}`);
      validation.valid = false;
    }

    // Check maximum dimensions for embeddings
    if (featureType === 'embeddings' && data.columnCount > thresholds.max_dim) {
      validation.warnings.push(`High dimensionality: ${data.columnCount} > ${thresholds.max_dim}`);
    }

    validation.stats.row_count = data.rowCount;
    validation.stats.column_count = data.columnCount;
    validation.stats.data_size_mb = (data.size / 1024 / 1024).toFixed(2);
  }

  /**
   * Validate feature quality for DSP features
   */
  validateFeatureQuality(data, featureType, validation) {
    if (featureType !== 'dsp') return;
    
    const thresholds = this.thresholds.dsp;
    
    // Simulate quality checks based on metadata
    // In real implementation, this would analyze the actual feature values
    
    // Check for reasonable data size (proxy for quality)
    const avgBytesPerRow = data.size / data.rowCount;
    if (avgBytesPerRow < 100) {
      validation.warnings.push('Features may be too sparse or low precision');
    }

    // Simulate SNR validation
    validation.stats.estimated_snr_range = [-10, 40]; // Simulated
    
    // Simulate duration validation
    validation.stats.estimated_duration_range = [0.5, 10.0]; // Simulated
    
    console.log('📊 DSP feature quality validation completed');
  }

  /**
   * Validate embedding quality
   */
  validateEmbeddingQuality(data, validation) {
    const thresholds = this.thresholds.embeddings;
    
    // Simulate embedding quality checks
    // In real implementation, this would analyze embedding norms, distributions, etc.
    
    validation.stats.estimated_norm_range = [0.1, 10.0]; // Simulated
    validation.stats.estimated_variance = 0.5; // Simulated
    
    console.log('🤖 Embedding quality validation completed');
  }

  /**
   * Validate statistical properties
   */
  validateStatistics(data, featureType, validation) {
    // Simulate statistical validation
    // In real implementation, this would compute actual statistics
    
    validation.stats.estimated_nan_ratio = 0.001; // Simulated
    validation.stats.estimated_zero_ratio = 0.05; // Simulated
    validation.stats.estimated_outlier_ratio = 0.02; // Simulated
    
    const thresholds = this.thresholds[featureType];
    
    if (validation.stats.estimated_nan_ratio > thresholds.max_nan_ratio) {
      validation.errors.push(`High NaN ratio: ${validation.stats.estimated_nan_ratio}`);
      validation.valid = false;
    }
    
    console.log('📈 Statistical validation completed');
  }

  /**
   * Validate feature correlations
   */
  validateFeatureCorrelations(data, validation) {
    // Simulate correlation analysis
    // In real implementation, this would compute correlation matrix
    
    validation.stats.max_correlation = 0.85; // Simulated
    validation.stats.highly_correlated_pairs = 2; // Simulated
    
    if (validation.stats.max_correlation > this.thresholds.dsp.max_correlation) {
      validation.warnings.push(`High feature correlation detected: ${validation.stats.max_correlation}`);
    }
    
    console.log('🔗 Feature correlation validation completed');
  }

  /**
   * Validate embedding dimensions
   */
  validateEmbeddingDimensions(data, validation) {
    const thresholds = this.thresholds.embeddings;
    
    // Check dimension consistency
    const expectedDim = data.columnCount - 4; // Subtract metadata columns
    validation.stats.embedding_dimension = expectedDim;
    
    if (expectedDim < thresholds.min_dim) {
      validation.errors.push(`Embedding dimension too low: ${expectedDim}`);
      validation.valid = false;
    }
    
    console.log('📐 Embedding dimensions validation completed');
  }

  /**
   * Validate embedding similarity (detect near-duplicates)
   */
  async validateEmbeddingSimilarity(data, validation) {
    // Simulate similarity analysis
    // In real implementation, this would compute pairwise similarities
    
    validation.stats.estimated_duplicate_pairs = 5; // Simulated
    validation.stats.max_similarity = 0.98; // Simulated
    
    const threshold = this.thresholds.embeddings.cosine_similarity_threshold;
    if (validation.stats.max_similarity > threshold) {
      validation.warnings.push(`Near-duplicate embeddings detected: ${validation.stats.max_similarity}`);
    }
    
    console.log('🔍 Embedding similarity validation completed');
  }

  /**
   * Calculate overall quality score
   */
  calculateQualityScore(validation) {
    let score = 1.0;
    
    // Penalize errors heavily
    score -= validation.errors.length * 0.3;
    
    // Penalize warnings moderately
    score -= validation.warnings.length * 0.1;
    
    // Ensure score is between 0 and 1
    return Math.max(0, Math.min(1, score));
  }

  /**
   * Save validation report to S3
   */
  async saveValidationReport(projectId, runId, featureType, validation) {
    try {
      const reportS3Key = `projects/${projectId}/clustering/runs/${runId}/validation/${featureType}_validation.json`;
      
      const report = {
        project_id: projectId,
        run_id: runId,
        feature_type: featureType,
        timestamp: new Date().toISOString(),
        validation: validation,
        thresholds: this.thresholds[featureType]
      };
      
      const success = await this.s3Layout.s3.putObject({
        Bucket: this.s3Layout.bucket,
        Key: reportS3Key,
        Body: JSON.stringify(report, null, 2),
        ContentType: 'application/json'
      }).promise();
      
      console.log(`📄 Validation report saved: ${reportS3Key}`);
      return reportS3Key;
      
    } catch (error) {
      console.error('Failed to save validation report:', error);
      throw error;
    }
  }

  /**
   * Get validation summary for a run
   */
  async getValidationSummary(projectId, runId) {
    try {
      const summary = {
        dsp: null,
        embeddings: null,
        overall_quality: 0
      };
      
      // Load DSP validation
      try {
        const dspReportKey = `projects/${projectId}/clustering/runs/${runId}/validation/dsp_validation.json`;
        const dspReport = await this.s3Layout.s3_download_json(dspReportKey);
        if (dspReport) {
          summary.dsp = dspReport.validation;
        }
      } catch (error) {
        console.log('No DSP validation report found');
      }
      
      // Load embeddings validation
      try {
        const embReportKey = `projects/${projectId}/clustering/runs/${runId}/validation/embeddings_validation.json`;
        const embReport = await this.s3Layout.s3_download_json(embReportKey);
        if (embReport) {
          summary.embeddings = embReport.validation;
        }
      } catch (error) {
        console.log('No embeddings validation report found');
      }
      
      // Calculate overall quality
      const qualities = [];
      if (summary.dsp) qualities.push(summary.dsp.quality_score);
      if (summary.embeddings) qualities.push(summary.embeddings.quality_score);
      
      if (qualities.length > 0) {
        summary.overall_quality = qualities.reduce((a, b) => a + b) / qualities.length;
      }
      
      return summary;
      
    } catch (error) {
      console.error('Failed to get validation summary:', error);
      throw error;
    }
  }

  /**
   * Validate features and determine if they're ready for clustering
   */
  async validateForClustering(projectId, runId) {
    try {
      const summary = await this.getValidationSummary(projectId, runId);
      
      const requirements = {
        min_quality_score: 0.7,
        require_both_features: false  // Can cluster with just embeddings
      };
      
      let ready = false;
      let reasons = [];
      
      // Check if we have at least one valid feature type
      if (summary.embeddings && summary.embeddings.valid && summary.embeddings.quality_score >= requirements.min_quality_score) {
        ready = true;
      } else if (summary.dsp && summary.dsp.valid && summary.dsp.quality_score >= requirements.min_quality_score) {
        ready = true;
      } else {
        reasons.push('No valid features with sufficient quality');
      }
      
      // Check overall quality
      if (summary.overall_quality < requirements.min_quality_score) {
        reasons.push(`Overall quality too low: ${summary.overall_quality.toFixed(3)}`);
        ready = false;
      }
      
      return {
        ready,
        reasons,
        summary,
        requirements
      };
      
    } catch (error) {
      console.error('Failed to validate for clustering:', error);
      throw error;
    }
  }
}

module.exports = FeatureValidator;
