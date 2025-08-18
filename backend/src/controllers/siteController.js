import { validationResult } from 'express-validator';
import { db } from '../config/database.js';
import { deleteManyFromS3 } from '../config/s3.js';

/**
 * Create a new site
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const createSite = async (req, res) => {
  try {
    console.log('🔍 Create site request received:', req.body);
    console.log('👤 User ID:', req.user.id);
    console.log('📁 Project ID:', req.params.projectId);

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { name, latitude, longitude, description } = req.body;
    const projectId = req.params.projectId;
    const userId = req.user.id;

    console.log('📝 Site data:', { name, latitude, longitude, description, projectId });

    // First, verify that the project belongs to the user
    const [projects] = await db.query(
      'SELECT id FROM projects WHERE id = :projectId AND user_id = :userId',
      {
        replacements: { projectId: projectId, userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    if (projects.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Insert site and get the created site data
    const [sites] = await db.query(
      'INSERT INTO sites (name, latitude, longitude, description, project_id) VALUES (:name, :latitude, :longitude, :description, :project_id) RETURNING *',
      {
        replacements: {
          name: name,
          latitude: latitude,
          longitude: longitude,
          description: description || '',
          project_id: projectId
        },
        type: db.QueryTypes.INSERT
      }
    );

    const createdSite = sites[0];
    console.log('✅ Site created successfully:', createdSite);

    res.status(201).json({
      message: 'Site created successfully',
      site: createdSite
    });

  } catch (error) {
    console.error('❌ Create site error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error code:', error.code);
    console.error('❌ Error constraint:', error.constraint);
    console.error('❌ Error detail:', error.detail);
    
    // Handle specific database constraint errors
    if (error.code === '23505') {
      // Unique constraint violation
      if (error.constraint === 'idx_sites_project_name' || error.detail?.includes('project_id, name')) {
        return res.status(400).json({ 
          error: 'A site with this name already exists in this project. Please choose a different name.' 
        });
      }
      return res.status(400).json({ 
        error: 'Duplicate entry. Please check your input and try again.' 
      });
    }
    
    // Handle other database errors
    if (error.code && error.code.startsWith('23')) {
      return res.status(400).json({ 
        error: 'Invalid data provided. Please check your input and try again.' 
      });
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all sites for a project
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getSites = async (req, res) => {
  try {
    const projectId = req.params.projectId;
    const userId = req.user.id;
    console.log('🔍 Getting sites for project ID:', projectId, 'User ID:', userId);

    // First, verify that the project belongs to the user
    const [projects] = await db.query(
      'SELECT id FROM projects WHERE id = :projectId AND user_id = :userId',
      {
        replacements: { projectId: projectId, userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    if (projects.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = await db.query(
      `SELECT 
        s.id,
        s.name,
        s.latitude,
        s.longitude,
        s.description,
        s.created_at,
        s.updated_at
      FROM sites s
      WHERE s.project_id = :projectId
      ORDER BY s.created_at DESC`,
      {
        replacements: { projectId: projectId },
        type: db.QueryTypes.SELECT
      }
    );

    console.log('📊 Sites query result:', result);
    console.log('📊 Result type:', typeof result);
    console.log('📊 Result length:', Array.isArray(result) ? result.length : 'Not an array');

    // Handle the result properly - it should be an array
    const sites = Array.isArray(result) ? result : [];
    
    console.log('📋 Sites found:', sites.length);

    res.json({
      sites: sites
    });

  } catch (error) {
    console.error('❌ Get sites error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get a specific site
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getSite = async (req, res) => {
  try {
    const { siteId } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT 
        s.*
      FROM sites s
      JOIN projects p ON s.project_id = p.id
      WHERE s.id = :siteId AND p.user_id = :userId`,
      {
        replacements: { siteId: siteId, userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    const sites = Array.isArray(result) ? result : [];

    if (sites.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }

    res.json({ site: sites[0] });

  } catch (error) {
    console.error('Get site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update a site
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateSite = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { siteId } = req.params;
    const userId = req.user.id;
    const { name, latitude, longitude, description } = req.body;

    // Check if site exists and belongs to user's project
    const [existingSites] = await db.query(
      `SELECT s.* FROM sites s
       JOIN projects p ON s.project_id = p.id
       WHERE s.id = :siteId AND p.user_id = :userId`,
      {
        replacements: { siteId: siteId, userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    if (existingSites.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Build update query
    let updateQuery = 'UPDATE sites SET ';
    const replacements = { siteId: siteId };
    
    if (name !== undefined) {
      updateQuery += 'name = :name, ';
      replacements.name = name;
    }
    if (latitude !== undefined) {
      updateQuery += 'latitude = :latitude, ';
      replacements.latitude = latitude;
    }
    if (longitude !== undefined) {
      updateQuery += 'longitude = :longitude, ';
      replacements.longitude = longitude;
    }
    if (description !== undefined) {
      updateQuery += 'description = :description, ';
      replacements.description = description;
    }

    updateQuery += 'updated_at = NOW() WHERE id = :siteId';

    // Update site
    const [result] = await db.query(updateQuery, {
      replacements: replacements,
      type: db.QueryTypes.UPDATE
    });

    if (result === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Get updated site
    const [sites] = await db.query(
      'SELECT * FROM sites WHERE id = :siteId',
      {
        replacements: { siteId: siteId },
        type: db.QueryTypes.SELECT
      }
    );

    res.json({
      message: 'Site updated successfully',
      site: sites[0]
    });

  } catch (error) {
    console.error('Update site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete a site
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteSite = async (req, res) => {
  try {
    const { siteId } = req.params;
    const userId = req.user.id;

    // Check if site exists and belongs to user's project
    const [existingSites] = await db.query(
      `SELECT s.* FROM sites s
       JOIN projects p ON s.project_id = p.id
       WHERE s.id = :siteId AND p.user_id = :userId`,
      {
        replacements: { siteId: siteId, userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    if (existingSites.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Collect recording file paths for S3 cleanup
    const recordingRows = await db.query(
      'SELECT file_path FROM recordings WHERE site_id = :siteId',
      { replacements: { siteId }, type: db.QueryTypes.SELECT }
    );
    const filePaths = (recordingRows || []).map((r) => r.file_path);

    // Delete site
    const [result] = await db.query(
      'DELETE FROM sites WHERE id = :siteId',
      {
        replacements: { siteId: siteId },
        type: db.QueryTypes.DELETE
      }
    );

    if (result === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Best-effort delete S3 objects for that site
    try {
      await deleteManyFromS3(filePaths);
    } catch (e) {
      console.error('⚠️  Failed to delete some S3 objects for site:', siteId, e?.message);
    }

    res.json({ message: 'Site deleted successfully' });

  } catch (error) {
    console.error('Delete site error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 