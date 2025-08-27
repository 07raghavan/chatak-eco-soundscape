/**
 * ROIFeature Model
 * Stores ROI feature metadata and S3 pointers
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ROIFeature = sequelize.define('ROIFeature', {
    roiId: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      field: 'roi_id',
      comment: 'Foreign key to aed_events.id'
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'project_id'
    },
    embeddingVersionId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'embedding_version_id'
    },
    featureType: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'feature_type',
      comment: 'Feature type: dsp, panns, yamnet, etc.'
    },
    s3Key: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 's3_key',
      comment: 'Parquet shard containing this ROI'
    },
    shardIndex: {
      type: DataTypes.INTEGER,
      field: 'shard_index',
      comment: 'Index within the Parquet shard'
    },
    dim: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Feature vector dimension'
    },
    normVersion: {
      type: DataTypes.STRING,
      defaultValue: 'v1',
      field: 'norm_version',
      comment: 'Normalization version'
    },
    qualityScore: {
      type: DataTypes.FLOAT,
      field: 'quality_score',
      comment: 'Feature quality metric (0-1)'
    },
    extractionTimeMs: {
      type: DataTypes.INTEGER,
      field: 'extraction_time_ms',
      comment: 'Processing time in milliseconds'
    }
  }, {
    tableName: 'roi_features',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
      {
        fields: ['project_id']
      },
      {
        fields: ['embedding_version_id']
      },
      {
        fields: ['feature_type']
      },
      {
        fields: ['project_id', 'feature_type', 'embedding_version_id']
      }
    ]
  });

  // Associations
  ROIFeature.associate = (models) => {
    ROIFeature.belongsTo(models.Project, {
      foreignKey: 'projectId',
      as: 'project'
    });
    
    ROIFeature.belongsTo(models.EmbeddingVersion, {
      foreignKey: 'embeddingVersionId',
      as: 'embeddingVersion'
    });
    
    // Note: ROI is from aed_events table, association handled separately
  };

  // Instance methods
  ROIFeature.prototype.getS3Path = function() {
    return this.s3Key;
  };

  ROIFeature.prototype.isHighQuality = function() {
    return this.qualityScore && this.qualityScore >= 0.8;
  };

  // Class methods
  ROIFeature.findByROI = function(roiId) {
    return this.findAll({
      where: { roiId },
      include: ['embeddingVersion']
    });
  };

  ROIFeature.findByProject = function(projectId, featureType = null) {
    const where = { projectId };
    if (featureType) {
      where.featureType = featureType;
    }
    
    return this.findAll({
      where,
      include: ['embeddingVersion'],
      order: [['created_at', 'DESC']]
    });
  };

  ROIFeature.getFeatureStats = function(projectId) {
    return this.findAll({
      where: { projectId },
      attributes: [
        'featureType',
        [sequelize.fn('COUNT', sequelize.col('roi_id')), 'count'],
        [sequelize.fn('AVG', sequelize.col('quality_score')), 'avgQuality'],
        [sequelize.fn('AVG', sequelize.col('extraction_time_ms')), 'avgTime']
      ],
      group: ['featureType']
    });
  };

  ROIFeature.findMissingFeatures = function(projectId, roiIds, featureType) {
    return sequelize.query(`
      SELECT roi_id FROM unnest(ARRAY[:roiIds]) AS roi_id
      WHERE roi_id NOT IN (
        SELECT roi_id FROM roi_features 
        WHERE project_id = :projectId AND feature_type = :featureType
      )
    `, {
      replacements: { projectId, roiIds, featureType },
      type: sequelize.QueryTypes.SELECT
    });
  };

  return ROIFeature;
};
