/**
 * Cluster Model
 * Tracks clustering runs and their parameters
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Cluster = sequelize.define('Cluster', {
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
    runId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'run_id',
      comment: 'Unique run identifier'
    },
    algo: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Algorithm: hdbscan, kmeans, auto'
    },
    paramsJson: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'params_json',
      comment: 'Algorithm parameters'
    },
    embeddingVersionId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'embedding_version_id'
    },
    version: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
      comment: 'Clustering version'
    },
    numClusters: {
      type: DataTypes.INTEGER,
      field: 'num_clusters',
      comment: 'Total clusters found'
    },
    numNoise: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'num_noise',
      comment: 'Noise points (HDBSCAN)'
    },
    silhouetteScore: {
      type: DataTypes.FLOAT,
      field: 'silhouette_score',
      comment: 'Clustering quality metric'
    },
    calinskiHarabaszScore: {
      type: DataTypes.FLOAT,
      field: 'calinski_harabasz_score',
      comment: 'Clustering quality metric'
    },
    daviesBouldinScore: {
      type: DataTypes.FLOAT,
      field: 'davies_bouldin_score',
      comment: 'Clustering quality metric'
    },
    stabilityScore: {
      type: DataTypes.FLOAT,
      field: 'stability_score',
      comment: 'Cross-validation stability'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'is_active',
      comment: 'Currently active clustering'
    },
    s3Prefix: {
      type: DataTypes.STRING,
      field: 's3_prefix',
      comment: 'S3 path to cluster artifacts'
    }
  }, {
    tableName: 'clusters',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    indexes: [
      {
        unique: true,
        fields: ['project_id', 'run_id']
      },
      {
        fields: ['project_id']
      },
      {
        unique: true,
        fields: ['project_id', 'is_active'],
        where: { is_active: true }
      }
    ]
  });

  // Associations
  Cluster.associate = (models) => {
    Cluster.belongsTo(models.Project, {
      foreignKey: 'projectId',
      as: 'project'
    });
    
    Cluster.belongsTo(models.EmbeddingVersion, {
      foreignKey: 'embeddingVersionId',
      as: 'embeddingVersion'
    });
    
    Cluster.hasMany(models.ClusterMembership, {
      foreignKey: 'clusterId',
      as: 'memberships'
    });
    
    Cluster.hasMany(models.ClusterExemplar, {
      foreignKey: 'clusterId',
      as: 'exemplars'
    });
    
    Cluster.hasMany(models.ClusterQuality, {
      foreignKey: 'clusterId',
      as: 'qualityMetrics'
    });
    
    Cluster.hasMany(models.PropagationRun, {
      foreignKey: 'clusterId',
      as: 'propagationRuns'
    });
  };

  // Instance methods
  Cluster.prototype.getQualityScore = function() {
    // Combine multiple quality metrics into single score
    const weights = {
      silhouette: 0.4,
      calinskiHarabasz: 0.3,
      daviesBouldin: -0.2, // Lower is better
      stability: 0.1
    };
    
    let score = 0;
    let totalWeight = 0;
    
    if (this.silhouetteScore !== null) {
      score += this.silhouetteScore * weights.silhouette;
      totalWeight += weights.silhouette;
    }
    
    if (this.calinskiHarabaszScore !== null) {
      // Normalize Calinski-Harabasz (higher is better)
      const normalized = Math.min(this.calinskiHarabaszScore / 1000, 1);
      score += normalized * weights.calinskiHarabasz;
      totalWeight += weights.calinskiHarabasz;
    }
    
    if (this.daviesBouldinScore !== null) {
      // Normalize Davies-Bouldin (lower is better, so invert)
      const normalized = Math.max(0, 1 - this.daviesBouldinScore / 2);
      score += normalized * Math.abs(weights.daviesBouldin);
      totalWeight += Math.abs(weights.daviesBouldin);
    }
    
    if (this.stabilityScore !== null) {
      score += this.stabilityScore * weights.stability;
      totalWeight += weights.stability;
    }
    
    return totalWeight > 0 ? score / totalWeight : 0;
  };

  Cluster.prototype.getNoiseRate = function() {
    if (!this.numClusters || !this.numNoise) return 0;
    const totalPoints = this.numClusters + this.numNoise;
    return this.numNoise / totalPoints;
  };

  Cluster.prototype.activate = async function() {
    // Deactivate other clusters for this project
    await Cluster.update(
      { isActive: false },
      { where: { projectId: this.projectId, isActive: true } }
    );
    
    // Activate this cluster
    this.isActive = true;
    return this.save();
  };

  // Class methods
  Cluster.findActive = function(projectId) {
    return this.findOne({
      where: { projectId, isActive: true },
      include: ['embeddingVersion', 'qualityMetrics']
    });
  };

  Cluster.findByRunId = function(projectId, runId) {
    return this.findOne({
      where: { projectId, runId },
      include: ['embeddingVersion', 'memberships', 'exemplars']
    });
  };

  Cluster.getProjectHistory = function(projectId, limit = 10) {
    return this.findAll({
      where: { projectId },
      include: ['embeddingVersion'],
      order: [['created_at', 'DESC']],
      limit
    });
  };

  return Cluster;
};
