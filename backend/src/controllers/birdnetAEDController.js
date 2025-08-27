import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';
import { BirdNetAEDService } from '../services/birdnetAEDService.js';

const aedService = new BirdNetAEDService();

/**
 * Analyze recording with BirdNet AED
 * POST /api/recordings/:recordingId/aed
 */
export const analyzeRecordingWithAED = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if site has coordinates
    const siteCheck = await db.query(`
      SELECT s.latitude, s.longitude
      FROM sites s
      JOIN recordings r ON r.site_id = s.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (siteCheck.length === 0 || !siteCheck[0].latitude || !siteCheck[0].longitude) {
      return res.status(400).json({ 
        error: 'Recording site must have valid coordinates for BirdNet analysis' 
      });
    }

    // Set up Server-Sent Events for progress updates
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Progress callback function
    const progressCallback = (progress, message) => {
      res.write(`data: ${JSON.stringify({ progress, message })}\n\n`);
    };

    try {
      // Run BirdNet AED analysis
      const result = await aedService.analyzeRecording(recordingId, progressCallback);

      // Send final result
      res.write(`data: ${JSON.stringify({ 
        progress: 100, 
        message: 'Analysis complete!',
        result: {
          success: true,
          detections: result.detections.length,
          snippets: result.snippets.length,
          events: result.events.length
        }
      })}\n\n`);

      res.end();

    } catch (analysisError) {
      console.error('AED analysis error:', analysisError);
      res.write(`data: ${JSON.stringify({ 
        progress: -1, 
        error: analysisError.message 
      })}\n\n`);
      res.end();
    }

  } catch (error) {
    console.error('❌ AED analysis controller error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get AED events for a recording
 * GET /api/recordings/:recordingId/aed
 */
export const getAEDEvents = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get AED events (service now includes snippet URLs)
    const events = await aedService.getAEDEvents(recordingId);

    res.json({
      success: true,
      recording_id: recordingId,
      events: events,
      total_events: events.length
    });

  } catch (error) {
    console.error('❌ Get AED events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get specific AED event with snippet
 * GET /api/aed/events/:eventId
 */
export const getAEDEvent = async (req, res) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.id;

    // Verify event ownership
    const eventCheck = await db.query(`
      SELECT ae.*, r.id as recording_id, p.user_id as owner_id
      FROM events ae
      JOIN recordings r ON ae.recording_id = r.id
      JOIN projects p ON r.project_id = p.id
      WHERE ae.id = :eventId
    `, { 
      replacements: { eventId }, 
      type: QueryTypes.SELECT 
    });

    if (eventCheck.length === 0) {
      return res.status(404).json({ error: 'AED event not found' });
    }

    if (eventCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get event with snippet URL
    const event = await aedService.getAEDEventWithSnippet(eventId);

    if (!event) {
      return res.status(404).json({ error: 'AED event not found' });
    }

    res.json({
      success: true,
      event: event
    });

  } catch (error) {
    console.error('❌ Get AED event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get AED analysis status for a recording
 * GET /api/recordings/:recordingId/aed/status
 */
export const getAEDStatus = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if AED events exist
    const eventCount = await db.query(`
      SELECT COUNT(*) as count
      FROM events
      WHERE recording_id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    const hasEvents = eventCount[0].count > 0;

    // Get latest event timestamp
    let lastAnalysis = null;
    if (hasEvents) {
      const latestEvent = await db.query(`
        SELECT created_at
        FROM events
        WHERE recording_id = :recordingId
        ORDER BY created_at DESC
        LIMIT 1
      `, { 
        replacements: { recordingId }, 
        type: QueryTypes.SELECT 
      });
      lastAnalysis = latestEvent[0].created_at;
    }

    res.json({
      success: true,
      recording_id: recordingId,
      has_aed_analysis: hasEvents,
      event_count: eventCount[0].count,
      last_analysis: lastAnalysis
    });

  } catch (error) {
    console.error('❌ Get AED status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete AED events for a recording
 * DELETE /api/recordings/:recordingId/aed
 */
export const deleteAEDEvents = async (req, res) => {
  try {
    const { recordingId } = req.params;
    const userId = req.user.id;

    // Verify recording ownership
    const recordingCheck = await db.query(`
      SELECT r.*, p.user_id as owner_id
      FROM recordings r
      JOIN projects p ON r.project_id = p.id
      WHERE r.id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    if (recordingCheck.length === 0) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (recordingCheck[0].owner_id !== userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get events to delete snippet files
    const events = await db.query(`
      SELECT snippet_file_path
      FROM events
      WHERE recording_id = :recordingId
      AND snippet_file_path IS NOT NULL
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.SELECT 
    });

    // Delete snippet files
    const fs = await import('fs');
    for (const event of events) {
      try {
        if (event.snippet_file_path && fs.existsSync(event.snippet_file_path)) {
          fs.unlinkSync(event.snippet_file_path);
        }
      } catch (error) {
        console.warn('Failed to delete snippet file:', error);
      }
    }

    // Delete AED events from database
    const deleteResult = await db.query(`
      DELETE FROM events
      WHERE recording_id = :recordingId
    `, { 
      replacements: { recordingId }, 
      type: QueryTypes.DELETE 
    });

    res.json({
      success: true,
      message: 'AED events deleted successfully',
      deleted_events: deleteResult[1] || 0
    });

  } catch (error) {
    console.error('❌ Delete AED events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
