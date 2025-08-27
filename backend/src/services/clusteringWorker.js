/**
 * Clustering Worker Service
 * Manages Python worker processes for real clustering operations
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ClusteringWorkerService {
  constructor() {
    this.activeWorkers = new Map();
    this.workerPath = join(__dirname, '..', 'workers', 'python');
    this.configPath = join(__dirname, '..', 'config', 'clusteringConfig.json');
    
    // Ensure worker directory exists
    if (!existsSync(this.workerPath)) {
      throw new Error(`Worker directory not found: ${this.workerPath}`);
    }
    
    console.log(`🔧 Clustering Worker Service initialized at: ${this.workerPath}`);
  }

  /**
   * Start a clustering job using Python workers
   */
  async startClusteringJob(jobParams) {
    const {
      projectId,
      recordingId,
      aedEventIds,
      aedEvents,
      algorithm = 'hdbscan',
      featureTypes = ['dsp', 'panns_cnn14']
    } = jobParams;

    const runId = `run_${uuidv4()}`;
    const jobId = uuidv4();

    console.log(`🚀 Starting real clustering job ${jobId} for project ${projectId}`);
    console.log(`📊 Recording: ${recordingId}, Algorithm: ${algorithm}, Features: ${featureTypes.join(', ')}`);

    try {
      // Step 1: Extract DSP features
      console.log(`🔧 Step 1: Extracting DSP features...`);
      console.log(`📊 ROI data being sent to DSP worker:`, aedEventIds.map(id => {
        const aedEvent = aedEvents?.find(e => e.id === id);
        return {
          roi_id: id,
          recording_id: recordingId,
          start_ms: aedEvent?.start_ms || 0,
          end_ms: aedEvent?.end_ms || 0,
          segment_s3_key: aedEvent?.segment_s3_key || null,
          segment_start_ms: aedEvent?.segment_start_ms || 0,
          segment_end_ms: aedEvent?.segment_end_ms || 0,
          confidence: aedEvent?.confidence || 0.5,
          method: aedEvent?.method || 'unknown'
        };
      }));
      
      const dspFeatures = await this.runDSPFeatureExtraction({
        projectId,
        recordingId,
        aedEventIds,
        aedEvents,
        runId
      });
      console.log(`📊 DSP Features result:`, dspFeatures);

      // Step 2: Extract deep embeddings
      console.log(`🔧 Step 2: Extracting deep embeddings...`);
      const deepEmbeddings = await this.runDeepEmbeddingExtraction({
        projectId,
        recordingId,
        aedEventIds,
        aedEvents,
        runId,
        featureTypes
      });
      console.log(`🧠 Deep Embeddings result:`, deepEmbeddings);

      // Step 3: Run PCA transformation
      console.log(`🔧 Step 3: Running PCA transformation...`);
      console.log(`📤 Passing to PCA: DSP key: ${dspFeatures?.result?.features_s3_key}, Deep key: ${deepEmbeddings?.result?.embeddings_s3_key}`);
      const pcaResults = await this.runPCATransformation({
        projectId,
        recordingId,
        runId,
        dspFeaturesS3Key: dspFeatures?.result?.features_s3_key,
        deepEmbeddingsS3Key: deepEmbeddings?.result?.embeddings_s3_key
      });
      console.log(`📊 PCA Results:`, pcaResults);

      // Step 4: Run clustering algorithm
      console.log(`🔧 Step 4: Running ${algorithm} clustering...`);
      const clusteringResults = await this.runClustering({
        projectId,
        recordingId,
        runId,
        algorithm,
        pcaFeaturesS3Key: pcaResults?.result?.pca_embeddings_s3_key
      });

      // Step 5: Build FAISS index
      console.log(`🔧 Step 5: Building FAISS index...`);
      const faissIndex = await this.runFAISSIndexBuilding({
        projectId,
        recordingId,
        runId,
        pcaFeaturesS3Key: pcaResults?.result?.pca_embeddings_s3_key,
        membershipsS3Key: clusteringResults?.result?.memberships_s3_key
      });

      // Step 6: Generate UMAP visualization
      console.log(`🔧 Step 6: Generating UMAP visualization...`);
      const umapResults = await this.runUMAPVisualization({
        projectId,
        recordingId,
        runId,
        pcaFeaturesS3Key: pcaResults?.result?.pca_embeddings_s3_key,
        membershipsS3Key: clusteringResults?.result?.memberships_s3_key
      });

      console.log(`✅ Real clustering pipeline completed successfully!`);
      
      return {
        success: true,
        jobId,
        runId,
        results: {
          dspFeatures,
          deepEmbeddings,
          pcaResults,
          clusteringResults,
          faissIndex,
          umapResults
        }
      };

    } catch (error) {
      console.error(`❌ Clustering job ${jobId} failed:`, error);
      throw error;
    }
  }

  /**
   * Run DSP feature extraction
   */
  async runDSPFeatureExtraction(params) {
    return new Promise((resolve, reject) => {
      const workerScript = join(this.workerPath, 'dsp_feature_extractor.py');
      
      const worker = spawn('python', [workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: this.workerPath }
      });

      // Create the config and job parameters that the Python worker expects
      const config = {
        storage: {
          bucket: process.env.AWS_S3_BUCKET_NAME || 'chatak-audio-recordings',
          region: process.env.AWS_REGION || 'us-east-1'
        },
        feature_extraction: {
          dsp: {
            mfcc_coeffs: 13,
            n_fft: 2048,
            hop_length: 512,
            window: 'hann',
            features: ['mfcc', 'spectral_centroid', 'spectral_rolloff', 'zero_crossing_rate', 'chroma', 'tonnetz']
          }
        }
      };

      // Get actual AED event data including S3 keys and timing
      const roi_batch = params.aedEventIds.map(id => {
        const aedEvent = params.aedEvents?.find(e => e.id === id);
        return {
          roi_id: id,
          recording_id: params.recordingId,
          start_ms: aedEvent?.start_ms || 0,
          end_ms: aedEvent?.end_ms || 0,
          segment_s3_key: aedEvent?.segment_s3_key || null,
          segment_start_ms: aedEvent?.segment_start_ms || 0,
          segment_end_ms: aedEvent?.segment_end_ms || 0,
          // Add other relevant AED event data
          confidence: aedEvent?.confidence || 0.5,
          method: aedEvent?.method || 'unknown'
        };
      });

      const jobParams = {
        config: config,
        project_id: params.projectId,
        run_id: params.runId,
        roi_batch: roi_batch
      };

      const inputData = JSON.stringify(jobParams);
      worker.stdin.write(inputData);
      worker.stdin.end();

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', (code) => {
        if (code === 0) {
          try {
            // Extract only the RESULT line from the output
            const lines = output.split('\n');
            let resultLine = null;
            
            for (const line of lines) {
              if (line.startsWith('RESULT:')) {
                resultLine = line.substring(7); // Remove "RESULT:" prefix
                break;
              }
            }
            
            if (!resultLine) {
              reject(new Error('No RESULT line found in DSP feature extraction output'));
              return;
            }
            
            // Clean NaN values from the result line before JSON parsing
            const cleanedResultLine = resultLine.replace(/:\s*NaN/g, ': 0.0')
                                              .replace(/:\s*Infinity/g, ': 0.0')
                                              .replace(/:\s*-Infinity/g, ': 0.0');
            
            const result = JSON.parse(cleanedResultLine);
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse DSP feature extraction output: ${parseError.message}`));
          }
        } else {
          reject(new Error(`DSP feature extraction failed with code ${code}: ${errorOutput}`));
        }
      });

      worker.on('error', (error) => {
        reject(new Error(`Failed to start DSP feature extraction worker: ${error.message}`));
      });
    });
  }

  /**
   * Run deep embedding extraction
   */
  async runDeepEmbeddingExtraction(params) {
    return new Promise((resolve, reject) => {
      const workerScript = join(this.workerPath, 'deep_embedding_extractor.py');
      
      const worker = spawn('python', [workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: this.workerPath }
      });

      // Create the config and job parameters that the Python worker expects
      const config = {
        storage: {
          bucket: process.env.AWS_S3_BUCKET_NAME || 'chatak-audio-recordings',
          region: process.env.AWS_REGION || 'us-east-1'
        },
        feature_extraction: {
          embeddings: {
            models: {
              panns_cnn14: {
                dim: 2048,
                batch_size: 32,
                device: 'cpu', // Use CPU for Windows compatibility
                pooling: 'mean',
                sample_rate: 32000
              }
            }
          }
        }
      };

      const jobParams = {
        config: config,
        project_id: params.projectId,
        run_id: params.runId,
        roi_batch: params.aedEventIds.map(id => {
          const aedEvent = params.aedEvents?.find(e => e.id === id);
          return {
            roi_id: id,
            recording_id: params.recordingId,
            start_ms: aedEvent?.start_ms || 0,
            end_ms: aedEvent?.end_ms || 0,
            segment_s3_key: aedEvent?.segment_s3_key || null,
            segment_start_ms: aedEvent?.segment_start_ms || 0,
            segment_end_ms: aedEvent?.segment_end_ms || 0,
            // Add other relevant AED event data
            confidence: aedEvent?.confidence || 0.5,
            method: aedEvent?.method || 'unknown'
          };
        }),
        model_names: params.featureTypes.filter(type => type !== 'dsp')
      };

      const inputData = JSON.stringify(jobParams);
      worker.stdin.write(inputData);
      worker.stdin.end();

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', (code) => {
        if (code === 0) {
          try {
            // Extract only the RESULT line from the output
            const lines = output.split('\n');
            let resultLine = null;
            
            for (const line of lines) {
              if (line.startsWith('RESULT:')) {
                resultLine = line.substring(7); // Remove "RESULT:" prefix
                break;
              }
            }
            
            if (!resultLine) {
              reject(new Error('No RESULT line found in deep embedding extraction output'));
              return;
            }
            
            // Clean NaN values from the result line before JSON parsing
            const cleanedResultLine = resultLine.replace(/:\s*NaN/g, ': 0.0')
                                              .replace(/:\s*Infinity/g, ': 0.0')
                                              .replace(/:\s*-Infinity/g, ': 0.0');
            
            const result = JSON.parse(cleanedResultLine);
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse deep embedding extraction output: ${parseError.message}`));
          }
        } else {
          reject(new Error(`Deep embedding extraction failed with code ${code}: ${errorOutput}`));
        }
      });

      worker.on('error', (error) => {
        reject(new Error(`Failed to start deep embedding extraction worker: ${error.message}`));
      });
    });
  }

  /**
   * Run PCA transformation
   */
  async runPCATransformation(params) {
    return new Promise((resolve, reject) => {
      const workerScript = join(this.workerPath, 'pca_transformer.py');
      
      const worker = spawn('python', [workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: this.workerPath }
      });

      // Create the config and job parameters that the Python worker expects
      const config = {
        storage: {
          bucket: process.env.AWS_S3_BUCKET_NAME || 'chatak-audio-recordings',
          region: process.env.AWS_REGION || 'us-east-1'
        },
        dimensionality_reduction: {
          pca: {
            n_components: 50,
            whiten: true,
            random_state: 42
          }
        }
      };

      const jobParams = {
        config: config,
        project_id: params.projectId,
        run_id: params.runId,
        dsp_features_s3_key: params.dspFeaturesS3Key || null,
        deep_embeddings_s3_key: params.deepEmbeddingsS3Key || null
      };

      const inputData = JSON.stringify(jobParams);
      worker.stdin.write(inputData);
      worker.stdin.end();

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', (code) => {
        if (code === 0) {
          try {
            // Extract only the RESULT line from the output
            const lines = output.split('\n');
            let resultLine = null;
            
            for (const line of lines) {
              if (line.startsWith('RESULT:')) {
                resultLine = line.substring(7); // Remove "RESULT:" prefix
                break;
              }
            }
            
            if (!resultLine) {
              reject(new Error('No RESULT line found in PCA transformation output'));
              return;
            }
            
            // Clean NaN values from the result line before JSON parsing
            const cleanedResultLine = resultLine.replace(/:\s*NaN/g, ': 0.0')
                                              .replace(/:\s*Infinity/g, ': 0.0')
                                              .replace(/:\s*-Infinity/g, ': 0.0');
            
            const result = JSON.parse(cleanedResultLine);
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse PCA transformation output: ${parseError.message}`));
          }
        } else {
          reject(new Error(`PCA transformation failed with code ${code}: ${errorOutput}`));
        }
      });

      worker.on('error', (error) => {
        reject(new Error(`Failed to start PCA transformation worker: ${error.message}`));
      });
    });
  }

  /**
   * Run clustering algorithm
   */
  async runClustering(params) {
    return new Promise((resolve, reject) => {
      const workerScript = join(this.workerPath, 'kmeans_clustering_worker.py');
      
      const worker = spawn('python', [workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: this.workerPath }
      });

      // Create the config and job parameters that the Python worker expects
      const config = {
        storage: {
          bucket: process.env.AWS_S3_BUCKET_NAME || 'chatak-audio-recordings',
          region: process.env.AWS_REGION || 'us-east-1'
        },
        clustering: {
          kmeans: {
            k_grid: [2, 3, 4, 5, 6, 7, 8, 9, 10],
            init: 'k-means++',
            n_init: 10,
            max_iter: 300,
            random_state: 42
          }
        }
      };

      const jobParams = {
        config: config,
        project_id: params.projectId,
        run_id: params.runId,
        pca_embeddings_s3_key: params.pcaFeaturesS3Key || 'pca_embeddings.parquet'
      };

      const inputData = JSON.stringify(jobParams);
      worker.stdin.write(inputData);
      worker.stdin.end();

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', (code) => {
        if (code === 0) {
          try {
            // Extract only the RESULT line from the output
            const lines = output.split('\n');
            let resultLine = null;
            
            for (const line of lines) {
              if (line.startsWith('RESULT:')) {
                resultLine = line.substring(7); // Remove "RESULT:" prefix
                break;
              }
            }
            
            if (!resultLine) {
              reject(new Error('No RESULT line found in clustering output'));
              return;
            }
            
            // Clean NaN values from the result line before JSON parsing
            const cleanedResultLine = resultLine.replace(/:\s*NaN/g, ': 0.0')
                                              .replace(/:\s*Infinity/g, ': 0.0')
                                              .replace(/:\s*-Infinity/g, ': 0.0');
            
            const result = JSON.parse(cleanedResultLine);
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse clustering output: ${parseError.message}`));
          }
        } else {
          reject(new Error(`Clustering failed with code ${code}: ${errorOutput}`));
        }
      });

      worker.on('error', (error) => {
        reject(new Error(`Failed to start clustering worker: ${error.message}`));
      });
    });
  }

  /**
   * Run FAISS index building
   */
  async runFAISSIndexBuilding(params) {
    return new Promise((resolve, reject) => {
      const workerScript = join(this.workerPath, 'faiss_index_builder.py');
      
      const worker = spawn('python', [workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: this.workerPath }
      });

      // Create the config and job parameters that the Python worker expects
      const config = {
        storage: {
          bucket: process.env.AWS_S3_BUCKET_NAME || 'chatak-audio-recordings',
          region: process.env.AWS_REGION || 'us-east-1'
        },
        indexing: {
          faiss: {
            index_type: 'IVFFlat',
            nlist: 100,
            nprobe: 10,
            metric: 'L2'
          }
        }
      };

      const jobParams = {
        config: config,
        project_id: params.projectId,
        run_id: params.runId,
        embeddings_s3_key: params.pcaFeaturesS3Key || 'pca_embeddings.parquet',
        memberships_s3_key: params.membershipsS3Key || 'memberships.parquet'
      };

      const inputData = JSON.stringify(jobParams);
      worker.stdin.write(inputData);
      worker.stdin.end();

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', (code) => {
        if (code === 0) {
          try {
            // Extract only the RESULT line from the output
            const lines = output.split('\n');
            let resultLine = null;
            
            for (const line of lines) {
              if (line.startsWith('RESULT:')) {
                resultLine = line.substring(7); // Remove "RESULT:" prefix
                break;
              }
            }
            
            if (!resultLine) {
              reject(new Error('No RESULT line found in FAISS index building output'));
              return;
            }
            
            // Clean NaN values from the result line before JSON parsing
            const cleanedResultLine = resultLine.replace(/:\s*NaN/g, ': 0.0')
                                              .replace(/:\s*Infinity/g, ': 0.0')
                                              .replace(/:\s*-Infinity/g, ': 0.0');
            
            const result = JSON.parse(cleanedResultLine);
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse FAISS index building output: ${parseError.message}`));
          }
        } else {
          reject(new Error(`FAISS index building failed with code ${code}: ${errorOutput}`));
        }
      });

      worker.on('error', (error) => {
        reject(new Error(`Failed to start FAISS index building worker: ${error.message}`));
      });
    });
  }

  /**
   * Run UMAP visualization
   */
  async runUMAPVisualization(params) {
    return new Promise((resolve, reject) => {
      const workerScript = join(this.workerPath, 'umap_visualizer.py');
      
      const worker = spawn('python', [workerScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: this.workerPath }
      });

      // Create the config and job parameters that the Python worker expects
      const config = {
        storage: {
          bucket: process.env.AWS_S3_BUCKET_NAME || 'chatak-audio-recordings',
          region: process.env.AWS_REGION || 'us-east-1'
        },
        dimensionality_reduction: {
          umap: {
            n_components: 2,
            n_neighbors: 15,
            min_dist: 0.1,
            metric: 'euclidean',
            random_state: 42
          }
        }
      };

      const jobParams = {
        config: config,
        project_id: params.projectId,
        run_id: params.runId,
        embeddings_s3_key: params.pcaFeaturesS3Key || 'pca_embeddings.parquet',
        memberships_s3_key: params.membershipsS3Key || 'memberships.parquet'
      };

      const inputData = JSON.stringify(jobParams);
      worker.stdin.write(inputData);
      worker.stdin.end();

      let output = '';
      let errorOutput = '';

      worker.stdout.on('data', (data) => {
        output += data.toString();
      });

      worker.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      worker.on('close', (code) => {
        if (code === 0) {
          try {
            // Extract only the RESULT line from the output
            const lines = output.split('\n');
            let resultLine = null;
            
            for (const line of lines) {
              if (line.startsWith('RESULT:')) {
                resultLine = line.substring(7); // Remove "RESULT:" prefix
                break;
              }
            }
            
            if (!resultLine) {
              reject(new Error('No RESULT line found in UMAP visualization output'));
              return;
            }
            
            // Clean NaN values from the result line before JSON parsing
            const cleanedResultLine = resultLine.replace(/:\s*NaN/g, ': 0.0')
                                              .replace(/:\s*Infinity/g, ': 0.0')
                                              .replace(/:\s*-Infinity/g, ': 0.0');
            
            const result = JSON.parse(cleanedResultLine);
            resolve(result);
          } catch (parseError) {
            reject(new Error(`Failed to parse UMAP visualization output: ${parseError.message}`));
          }
        } else {
          reject(new Error(`UMAP visualization failed with code ${code}: ${errorOutput}`));
        }
      });

      worker.on('error', (error) => {
        reject(new Error(`Failed to start UMAP visualization worker: ${error.message}`));
      });
    });
  }

  /**
   * Stop all active workers
   */
  stopAllWorkers() {
    for (const [workerId, worker] of this.activeWorkers) {
      console.log(`🛑 Stopping worker ${workerId}`);
      worker.kill('SIGTERM');
    }
    this.activeWorkers.clear();
  }

  /**
   * Get worker status
   */
  getWorkerStatus() {
    return {
      activeWorkers: this.activeWorkers.size,
      workerPath: this.workerPath,
      configPath: this.configPath
    };
  }
}

export default ClusteringWorkerService;
