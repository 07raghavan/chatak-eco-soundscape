import { generateSpectrogramPyramid, getSpectrogramPyramid } from '../services/spectrogramTiler.js';
import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { getFileUrl } from '../config/s3.js';

export const getSpectrogramIndex = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const pyramid = await getSpectrogramPyramid(recordingId);
    if (!pyramid) return res.status(404).json({ error: 'Not generated' });
    return res.json({ pyramid });
  } catch (err) {
    console.error('getSpectrogramIndex error', err);
    return res.status(500).json({ error: 'Failed to get spectrogram' });
  }
};

export const generateSpectrogram = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;
    const { config = {} } = req.body || {};
    
    const rec = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    console.log(`🎨 Generating spectrogram pyramid for recording ${recordingId}`);
    const pyramid = await generateSpectrogramPyramid(recordingId, rec[0].file_path, config);
    
    return res.json({ 
      message: 'Spectrogram pyramid generated successfully',
      pyramid,
      recording: {
        id: recordingId,
        name: rec[0].name,
        duration_seconds: rec[0].duration_seconds
      }
    });
  } catch (err) {
    console.error('generateSpectrogram error', err);
    return res.status(500).json({ error: 'Failed to generate spectrogram: ' + err.message });
  }
};

// Get spectrogram status
export const getSpectrogramStatus = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;
    
    // Verify ownership
    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });
    
    const pyramid = await getSpectrogramPyramid(recordingId);
    if (!pyramid) {
      return res.json({ status: 'not_generated', message: 'Spectrogram not generated yet' });
    }
    
    return res.json({ 
      status: pyramid.status || 'completed',
      total_tiles: pyramid.totalTiles || 0,
      generated_tiles: pyramid.generatedTiles || 0,
      progress: pyramid.totalTiles > 0 ? (pyramid.generatedTiles / pyramid.totalTiles * 100) : 0
    });
  } catch (err) {
    console.error('getSpectrogramStatus error', err);
    return res.status(500).json({ error: 'Failed to get spectrogram status' });
  }
};

// Get spectrogram tile (returns signed URL)
export const getSpectrogramTile = async (req, res) => {
  try {
    const { recordingId, zoom, x, y } = req.params;
    const userId = req.user.id;
    
    // Verify ownership
    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });
    
    // Get pyramid metadata
    const pyramid = await getSpectrogramPyramid(recordingId);
    if (!pyramid) {
      return res.status(404).json({ error: 'Spectrogram not generated' });
    }
    
    // Generate tile S3 key
    const tileKey = `${pyramid.s3Prefix}${zoom}/${x}/${y}.webp`;
    
    // Get signed URL for tile
    const { getFileUrl } = await import('../config/s3.js');
    const tileUrl = await getFileUrl(tileKey);
    
    return res.json({ tile_url: tileUrl });
  } catch (err) {
    console.error('getSpectrogramTile error', err);
    return res.status(500).json({ error: 'Failed to get spectrogram tile' });
  }
};

// Get AED events for viewport (for ROI display)
export const getAEDEventsForViewport = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;
    const { 
      start_ms, 
      end_ms, 
      min_freq_hz = 0, 
      max_freq_hz = 24000, 
      min_confidence = 0.0,
      limit = 1000 
    } = req.query;
    
    // Verify ownership
    const rec = await db.query(`
      SELECT r.id, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });
    if (rec.length === 0) return res.status(404).json({ error: 'Recording not found' });
    if (rec[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });
    
    // Build dynamic query for AED events in viewport
    let query = `
      SELECT ae.*, aet.label, aet.verdict
      FROM aed_events ae
      LEFT JOIN aed_event_tags aet ON ae.id = aet.event_id
      WHERE ae.recording_id = :recordingId
    `;
    const replacements = { recordingId };
    
    if (start_ms !== undefined) {
      query += ` AND ae.end_ms >= :startMs`;
      replacements.startMs = parseInt(start_ms);
    }
    
    if (end_ms !== undefined) {
      query += ` AND ae.start_ms <= :endMs`;
      replacements.endMs = parseInt(end_ms);
    }
    
    if (min_freq_hz > 0) {
      query += ` AND (ae.f_max_hz IS NULL OR ae.f_max_hz >= :minFreq)`;
      replacements.minFreq = parseInt(min_freq_hz);
    }
    
    if (max_freq_hz < 24000) {
      query += ` AND (ae.f_min_hz IS NULL OR ae.f_min_hz <= :maxFreq)`;
      replacements.maxFreq = parseInt(max_freq_hz);
    }
    
    if (min_confidence > 0) {
      query += ` AND ae.confidence >= :minConf`;
      replacements.minConf = parseFloat(min_confidence);
    }
    
    query += ` ORDER BY ae.start_ms ASC LIMIT :limit`;
    replacements.limit = parseInt(limit);
    
    const events = await db.query(query, { replacements, type: QueryTypes.SELECT });
    
    // Transform events for frontend ROI display
    const rois = events.map(event => ({
      id: event.id.toString(),
      start_ms: event.start_ms,
      end_ms: event.end_ms,
      f_min_hz: event.f_min_hz,
      f_max_hz: event.f_max_hz,
      peak_freq_hz: event.peak_freq_hz,
      confidence: event.confidence,
      snr_db: event.snr_db,
      band_name: event.label || 'detected',
      verdict: event.verdict || 'auto',
      method: event.method,
      created_at: event.created_at
    }));
    
    return res.json({ events: rois, count: rois.length });
  } catch (err) {
    console.error('getAEDEventsForViewport error', err);
    return res.status(500).json({ error: 'Failed to get AED events for viewport' });
  }
};

// =====================================================
// TILED SPECTROGRAM PYRAMID FUNCTIONS
// =====================================================

/**
 * Get tiles for a specific viewport (time and frequency range)
 * Optimized for smooth horizontal scrolling over hours of audio
 */
export const getTilesForViewport = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const {
      zoom = 0,
      startTimeMs = 0,
      endTimeMs,
      minFreqHz,
      maxFreqHz
    } = req.query;
    const userId = req.user.id;

    // Verify user owns this recording
    const recording = await db.query(`
      SELECT r.*, p.user_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId AND p.user_id = :userId
    `, { replacements: { recordingId, userId }, type: QueryTypes.SELECT });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found or access denied' });
    }

    // Get pyramid info
    const pyramid = await db.query(`
      SELECT id, fmin, fmax, tiles_s3_prefix
      FROM spec_pyramids
      WHERE recording_id = :recordingId
        AND spectrogram_type = 'tiled'
        AND segment_id IS NULL
    `, { replacements: { recordingId }, type: QueryTypes.SELECT });

    if (pyramid.length === 0) {
      return res.status(404).json({ error: 'Spectrogram pyramid not found' });
    }

    const pyramidData = pyramid[0];
    const actualEndTimeMs = endTimeMs || recording[0].duration_ms;
    const actualMinFreqHz = minFreqHz || pyramidData.fmin;
    const actualMaxFreqHz = maxFreqHz || pyramidData.fmax;

    // Get tiles for viewport using the database function
    const tiles = await db.query(`
      SELECT * FROM get_tiles_for_viewport(
        :pyramidId, :zoom, :startTimeMs, :endTimeMs, :minFreqHz, :maxFreqHz
      )
    `, {
      replacements: {
        pyramidId: pyramidData.id,
        zoom: parseInt(zoom),
        startTimeMs: parseInt(startTimeMs),
        endTimeMs: parseInt(actualEndTimeMs),
        minFreqHz: parseFloat(actualMinFreqHz),
        maxFreqHz: parseFloat(actualMaxFreqHz)
      },
      type: QueryTypes.SELECT
    });

    // Generate presigned URLs for tiles
    const tilesWithUrls = await Promise.all(tiles.map(async (tile) => {
      const url = await getFileUrl(tile.s3_key);
      return {
        tileId: tile.tile_id,
        x: tile.tile_x,
        y: tile.tile_y,
        width: tile.width_px,
        height: tile.height_px,
        url: url
      };
    }));

    res.json({
      viewport: {
        zoom: parseInt(zoom),
        startTimeMs: parseInt(startTimeMs),
        endTimeMs: parseInt(actualEndTimeMs),
        minFreqHz: parseFloat(actualMinFreqHz),
        maxFreqHz: parseFloat(actualMaxFreqHz)
      },
      tiles: tilesWithUrls,
      tileCount: tilesWithUrls.length,
      s3Prefix: pyramidData.tiles_s3_prefix
    });

  } catch (error) {
    console.error('❌ Error getting tiles for viewport:', error);
    res.status(500).json({ error: 'Failed to get tiles for viewport' });
  }
};

/**
 * Get individual tile by coordinates
 */
export const getTileByCoordinates = async (req, res) => {
  try {
    const { recordingId, zoom, tileX, tileY } = req.params;
    const userId = req.user.id;

    // Verify user owns this recording
    const recording = await db.query(`
      SELECT r.*, p.user_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId AND p.user_id = :userId
    `, { replacements: { recordingId, userId }, type: QueryTypes.SELECT });

    if (recording.length === 0) {
      return res.status(404).json({ error: 'Recording not found or access denied' });
    }

    // Get tile
    const tile = await db.query(`
      SELECT st.*, sp.tiles_s3_prefix
      FROM spec_tiles st
      JOIN spec_pyramids sp ON st.index_id = sp.id
      WHERE sp.recording_id = :recordingId
        AND sp.spectrogram_type = 'tiled'
        AND sp.segment_id IS NULL
        AND st.zoom = :zoom
        AND st.tile_x = :tileX
        AND st.tile_y = :tileY
        AND st.status = 'completed'
    `, {
      replacements: {
        recordingId,
        zoom: parseInt(zoom),
        tileX: parseInt(tileX),
        tileY: parseInt(tileY)
      },
      type: QueryTypes.SELECT
    });

    if (tile.length === 0) {
      return res.status(404).json({ error: 'Tile not found' });
    }

    const tileData = tile[0];
    const url = await getFileUrl(tileData.s3_key);

    res.json({
      tile: {
        id: tileData.id,
        zoom: tileData.zoom,
        x: tileData.tile_x,
        y: tileData.tile_y,
        width: tileData.width_px,
        height: tileData.height_px,
        startTimeMs: tileData.start_time_ms,
        endTimeMs: tileData.end_time_ms,
        minFreqHz: tileData.min_freq_hz,
        maxFreqHz: tileData.max_freq_hz,
        format: tileData.format,
        url: url
      }
    });

  } catch (error) {
    console.error('❌ Error getting tile:', error);
    res.status(500).json({ error: 'Failed to get tile' });
  }
};


