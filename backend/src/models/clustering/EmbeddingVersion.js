/**
 * EmbeddingVersion Model
 * Tracks different embedding models and their configurations
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmbeddingVersion = sequelize.define('EmbeddingVersion', {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    projectId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'project_id'
    },
    modelName: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'model_name',
      comment: 'Model name like panns_cnn14, yamnet, openl3'
    },
    modelVersion: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'model_version',
      comment: 'Model version like v1.0, v2.1'
    },
    pooling: {
      type: DataTypes.STRING,
      defaultValue: 'mean',
      comment: 'Pooling strategy: mean, max, attention'
    },
    dim: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Embedding dimension'
    },
    pcaComponents: {
      type: DataTypes.INTEGER,
      defaultValue: 50,
      field: 'pca_components',
      comment: 'PCA target dimensions'
    },
    pcaS3Key: {
      type: DataTypes.STRING,
      field: 'pca_s3_key',
      comment: 'S3 path to pca.pkl file'
    },
    faissS3Prefix: {
      type: DataTypes.STRING,
      field: 'faiss_s3_prefix',
      comment: 'S3 prefix for FAISS indices'
    },
    umapS3Key: {
      type: DataTypes.STRING,
      field: 'umap_s3_key',
      comment: 'S3 path to UMAP coordinates'
    },
    statsJson: {
      type: DataTypes.JSONB,
      field: 'stats_json',
      comment: 'Model performance statistics'
    },
    configJson: {
      type: DataTypes.JSONB,
      field: 'config_json',
      comment: 'Full model configuration'
    }
  }, {
    tableName: 'embedding_versions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['project_id', 'model_name', 'model_version']
      }
    ]
  });

  // Associations
  EmbeddingVersion.associate = (models) => {
    EmbeddingVersion.belongsTo(models.Project, {
      foreignKey: 'projectId',
      as: 'project'
    });
    
    EmbeddingVersion.hasMany(models.ROIFeature, {
      foreignKey: 'embeddingVersionId',
      as: 'roiFeatures'
    });
    
    EmbeddingVersion.hasMany(models.Cluster, {
      foreignKey: 'embeddingVersionId',
      as: 'clusters'
    });
  };

  // Instance methods
  EmbeddingVersion.prototype.getS3Paths = function() {
    return {
      pca: this.pcaS3Key,
      faiss: this.faissS3Prefix,
      umap: this.umapS3Key
    };
  };

  EmbeddingVersion.prototype.isReady = function() {
    return !!(this.pcaS3Key && this.faissS3Prefix);
  };

  // Class methods
  EmbeddingVersion.findByModel = function(projectId, modelName, modelVersion) {
    return this.findOne({
      where: {
        projectId,
        modelName,
        modelVersion
      }
    });
  };

  EmbeddingVersion.getLatestForProject = function(projectId) {
    return this.findAll({
      where: { projectId },
      order: [['created_at', 'DESC']],
      limit: 10
    });
  };

  return EmbeddingVersion;
};
