/**
 * Quality Tier System
 * Assesses cluster quality and assigns High/Medium/Low tiers
 */

const clusteringConfig = require('../../config/clusteringConfig');

class QualityTierSystem {
  constructor(db, s3DataLayout) {
    this.db = db;
    this.s3Layout = s3DataLayout;
    
    // Quality configuration
    this.qualityConfig = clusteringConfig.get('cluster_quality', {});
    this.metricWeights = this.qualityConfig.metric_weights || {
      cohesion: 0.25,
      separation: 0.25,
      density: 0.20,
      consensus: 0.15,
      stability: 0.15
    };
    
    // Tier thresholds (z-scores)
    this.tierThresholds = this.qualityConfig.tier_thresholds || {
      high: 0.8,
      medium: -0.3,
      low: -999
    };
    
    this.logger = console;
  }

  /**
   * Assess cluster quality and assign tiers
   */
  async assessClusterQuality(projectId, runId, clusteringResults) {
    try {
      this.logger.log(`🎯 Assessing cluster quality for run ${runId}`);
      
      // Load cluster memberships
      const memberships = await this.loadClusterMemberships(
        clusteringResults.memberships_s3_key
      );
      
      if (!memberships || memberships.length === 0) {
        throw new Error('No cluster memberships found');
      }
      
      // Calculate quality metrics for each cluster
      const clusterQualities = await this.calculateClusterQualities(
        memberships, clusteringResults
      );
      
      // Assign quality tiers
      const tieredClusters = this.assignQualityTiers(clusterQualities);
      
      // Save quality assessments
      await this.saveQualityAssessments(projectId, runId, tieredClusters);
      
      // Generate quality summary
      const qualitySummary = this.generateQualitySummary(tieredClusters);
      
      this.logger.log(`✅ Quality assessment complete: ${qualitySummary.high_tier} high, ${qualitySummary.medium_tier} medium, ${qualitySummary.low_tier} low tier clusters`);
      
      return {
        cluster_qualities: tieredClusters,
        quality_summary: qualitySummary,
        tier_distribution: qualitySummary.tier_distribution
      };
      
    } catch (error) {
      this.logger.error('Cluster quality assessment failed:', error);
      throw error;
    }
  }

  /**
   * Load cluster memberships from S3
   */
  async loadClusterMemberships(membershipsS3Key) {
    try {
      // In production, this would download and parse the Parquet file
      // For now, simulate cluster memberships
      
      const exists = await this.s3Layout.exists(membershipsS3Key);
      if (!exists) {
        throw new Error('Memberships file not found');
      }
      
      // Simulate cluster memberships data
      const numClusters = Math.floor(Math.random() * 50) + 20; // 20-70 clusters
      const numROIs = Math.floor(Math.random() * 10000) + 1000; // 1k-11k ROIs
      
      const memberships = [];
      for (let i = 0; i < numROIs; i++) {
        const clusterId = Math.floor(Math.random() * numClusters);
        const membershipProba = 0.5 + Math.random() * 0.5; // 0.5-1.0
        
        memberships.push({
          roi_id: i + 1,
          cluster_label: clusterId,
          membership_proba: membershipProba,
          is_noise: clusterId === -1
        });
      }
      
      return memberships;
      
    } catch (error) {
      this.logger.error('Failed to load cluster memberships:', error);
      throw error;
    }
  }

  /**
   * Calculate quality metrics for each cluster
   */
  async calculateClusterQualities(memberships, clusteringResults) {
    try {
      // Group memberships by cluster
      const clusterGroups = {};
      memberships.forEach(member => {
        if (member.cluster_label !== -1) { // Exclude noise
          if (!clusterGroups[member.cluster_label]) {
            clusterGroups[member.cluster_label] = [];
          }
          clusterGroups[member.cluster_label].push(member);
        }
      });
      
      const clusterQualities = [];
      
      for (const [clusterId, members] of Object.entries(clusterGroups)) {
        const quality = await this.calculateSingleClusterQuality(
          parseInt(clusterId), members, clusteringResults
        );
        clusterQualities.push(quality);
      }
      
      return clusterQualities;
      
    } catch (error) {
      this.logger.error('Failed to calculate cluster qualities:', error);
      throw error;
    }
  }

  /**
   * Calculate quality metrics for a single cluster
   */
  async calculateSingleClusterQuality(clusterId, members, clusteringResults) {
    try {
      const clusterSize = members.length;
      
      // Cohesion: How tightly packed the cluster is
      const avgMembershipProba = members.reduce((sum, m) => sum + m.membership_proba, 0) / clusterSize;
      const cohesion = avgMembershipProba;
      
      // Separation: How well separated from other clusters (simulated)
      const separation = 0.3 + Math.random() * 0.4; // 0.3-0.7
      
      // Density: Local density of the cluster (simulated)
      const density = Math.max(0.1, 1.0 - (clusterSize / 1000)); // Smaller clusters = higher density
      
      // Consensus: Agreement between different clustering runs (simulated)
      const consensus = 0.6 + Math.random() * 0.3; // 0.6-0.9
      
      // Stability: Cross-validation stability (simulated)
      const stability = 0.5 + Math.random() * 0.4; // 0.5-0.9
      
      // Calculate composite quality score
      const qualityScore = (
        cohesion * this.metricWeights.cohesion +
        separation * this.metricWeights.separation +
        density * this.metricWeights.density +
        consensus * this.metricWeights.consensus +
        stability * this.metricWeights.stability
      );
      
      return {
        cluster_id: clusterId,
        cluster_size: clusterSize,
        metrics: {
          cohesion,
          separation,
          density,
          consensus,
          stability
        },
        quality_score: qualityScore,
        roi_ids: members.map(m => m.roi_id)
      };
      
    } catch (error) {
      this.logger.error(`Failed to calculate quality for cluster ${clusterId}:`, error);
      return {
        cluster_id: clusterId,
        cluster_size: members.length,
        metrics: {},
        quality_score: 0.0,
        roi_ids: members.map(m => m.roi_id)
      };
    }
  }

  /**
   * Assign quality tiers based on z-scores
   */
  assignQualityTiers(clusterQualities) {
    try {
      // Calculate z-scores for quality scores
      const qualityScores = clusterQualities.map(c => c.quality_score);
      const mean = qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length;
      const variance = qualityScores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) / qualityScores.length;
      const stdDev = Math.sqrt(variance);
      
      // Assign tiers based on z-scores
      const tieredClusters = clusterQualities.map(cluster => {
        const zScore = stdDev > 0 ? (cluster.quality_score - mean) / stdDev : 0;
        
        let tier;
        if (zScore >= this.tierThresholds.high) {
          tier = 'high';
        } else if (zScore >= this.tierThresholds.medium) {
          tier = 'medium';
        } else {
          tier = 'low';
        }
        
        return {
          ...cluster,
          z_score: zScore,
          quality_tier: tier,
          tier_confidence: Math.abs(zScore), // Higher z-score = more confident tier assignment
          eligible_for_propagation: tier === 'high' || (tier === 'medium' && cluster.cluster_size >= 50),
          requires_manual_review: tier === 'low' || cluster.cluster_size < 20
        };
      });
      
      return tieredClusters;
      
    } catch (error) {
      this.logger.error('Failed to assign quality tiers:', error);
      return clusterQualities.map(cluster => ({
        ...cluster,
        z_score: 0,
        quality_tier: 'medium',
        tier_confidence: 0,
        eligible_for_propagation: false,
        requires_manual_review: true
      }));
    }
  }

  /**
   * Generate quality summary statistics
   */
  generateQualitySummary(tieredClusters) {
    try {
      const summary = {
        total_clusters: tieredClusters.length,
        high_tier: 0,
        medium_tier: 0,
        low_tier: 0,
        eligible_for_propagation: 0,
        requires_manual_review: 0,
        avg_quality_score: 0,
        avg_cluster_size: 0,
        tier_distribution: {},
        quality_distribution: {
          excellent: 0,  // > 0.8
          good: 0,       // 0.6-0.8
          fair: 0,       // 0.4-0.6
          poor: 0        // < 0.4
        }
      };
      
      let totalQuality = 0;
      let totalSize = 0;
      
      tieredClusters.forEach(cluster => {
        // Count tiers
        summary[`${cluster.quality_tier}_tier`]++;
        
        // Count special categories
        if (cluster.eligible_for_propagation) summary.eligible_for_propagation++;
        if (cluster.requires_manual_review) summary.requires_manual_review++;
        
        // Accumulate for averages
        totalQuality += cluster.quality_score;
        totalSize += cluster.cluster_size;
        
        // Quality distribution
        const score = cluster.quality_score;
        if (score > 0.8) summary.quality_distribution.excellent++;
        else if (score > 0.6) summary.quality_distribution.good++;
        else if (score > 0.4) summary.quality_distribution.fair++;
        else summary.quality_distribution.poor++;
      });
      
      // Calculate averages
      summary.avg_quality_score = totalQuality / tieredClusters.length;
      summary.avg_cluster_size = totalSize / tieredClusters.length;
      
      // Tier distribution percentages
      summary.tier_distribution = {
        high: (summary.high_tier / summary.total_clusters * 100).toFixed(1),
        medium: (summary.medium_tier / summary.total_clusters * 100).toFixed(1),
        low: (summary.low_tier / summary.total_clusters * 100).toFixed(1)
      };
      
      return summary;
      
    } catch (error) {
      this.logger.error('Failed to generate quality summary:', error);
      return { total_clusters: 0 };
    }
  }

  /**
   * Save quality assessments to database and S3
   */
  async saveQualityAssessments(projectId, runId, tieredClusters) {
    try {
      // Save to S3
      const qualityS3Key = `projects/${projectId}/clustering/runs/${runId}/quality/cluster_quality.json`;
      
      const qualityData = {
        project_id: projectId,
        run_id: runId,
        assessment_timestamp: new Date().toISOString(),
        tier_thresholds: this.tierThresholds,
        metric_weights: this.metricWeights,
        clusters: tieredClusters
      };
      
      const success = await this.s3Layout.s3_upload_json(qualityData, qualityS3Key);
      
      if (!success) {
        throw new Error('Failed to save quality assessments to S3');
      }
      
      // In production, would also save to database
      this.logger.log(`📄 Quality assessments saved: ${qualityS3Key}`);
      
      return qualityS3Key;
      
    } catch (error) {
      this.logger.error('Failed to save quality assessments:', error);
      throw error;
    }
  }

  /**
   * Get clusters by quality tier
   */
  async getClustersByTier(projectId, runId, tier) {
    try {
      const qualityS3Key = `projects/${projectId}/clustering/runs/${runId}/quality/cluster_quality.json`;
      const qualityData = await this.s3Layout.s3_download_json(qualityS3Key);
      
      if (!qualityData) {
        throw new Error('Quality assessments not found');
      }
      
      const tierClusters = qualityData.clusters.filter(cluster => 
        cluster.quality_tier === tier
      );
      
      return {
        tier,
        count: tierClusters.length,
        clusters: tierClusters
      };
      
    } catch (error) {
      this.logger.error(`Failed to get ${tier} tier clusters:`, error);
      throw error;
    }
  }

  /**
   * Get propagation-eligible clusters
   */
  async getPropagationEligibleClusters(projectId, runId) {
    try {
      const qualityS3Key = `projects/${projectId}/clustering/runs/${runId}/quality/cluster_quality.json`;
      const qualityData = await this.s3Layout.s3_download_json(qualityS3Key);
      
      if (!qualityData) {
        throw new Error('Quality assessments not found');
      }
      
      const eligibleClusters = qualityData.clusters.filter(cluster => 
        cluster.eligible_for_propagation
      );
      
      return {
        count: eligibleClusters.length,
        total_rois: eligibleClusters.reduce((sum, cluster) => sum + cluster.cluster_size, 0),
        clusters: eligibleClusters
      };
      
    } catch (error) {
      this.logger.error('Failed to get propagation-eligible clusters:', error);
      throw error;
    }
  }

  /**
   * Update tier thresholds
   */
  updateTierThresholds(newThresholds) {
    this.tierThresholds = { ...this.tierThresholds, ...newThresholds };
    this.logger.log('🔧 Updated tier thresholds:', this.tierThresholds);
  }

  /**
   * Update metric weights
   */
  updateMetricWeights(newWeights) {
    this.metricWeights = { ...this.metricWeights, ...newWeights };
    this.logger.log('⚖️ Updated metric weights:', this.metricWeights);
  }
}

module.exports = QualityTierSystem;
