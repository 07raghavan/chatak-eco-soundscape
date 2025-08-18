import { validationResult } from 'express-validator';
import { db } from '../config/database.js';
import { deleteManyFromS3 } from '../config/s3.js';

/**
 * Create a new project
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const createProject = async (req, res) => {
  try {
    console.log('🔍 Create project request received:', req.body);
    console.log('👤 User ID:', req.user.id);

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Validation errors:', errors.array());
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { name, description, start_date, end_date, is_ongoing } = req.body;
    const userId = req.user.id;

    console.log('📝 Project data:', { name, description, start_date, end_date, is_ongoing, userId });

    // If project is ongoing, set end_date to NULL
    const projectEndDate = is_ongoing ? null : end_date;

    // Insert project and get the created project data
    const [projects] = await db.query(
      'INSERT INTO projects (name, description, start_date, end_date, is_ongoing, user_id, status) VALUES (:name, :description, :start_date, :end_date, :is_ongoing, :user_id, :status) RETURNING *',
      {
        replacements: {
          name: name,
          description: description || '',
          start_date: start_date,
          end_date: projectEndDate,
          is_ongoing: is_ongoing,
          user_id: userId,
          status: 'active'
        },
        type: db.QueryTypes.INSERT
      }
    );

    const createdProject = projects[0];
    console.log('✅ Project created successfully:', createdProject);

    res.status(201).json({
      message: 'Project created successfully',
      project: createdProject
    });

  } catch (error) {
    console.error('❌ Create project error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all projects for a user
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProjects = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔍 Getting projects for user ID:', userId);

    const result = await db.query(
      `SELECT 
        p.id,
        p.name,
        p.description,
        p.start_date,
        p.end_date,
        p.is_ongoing,
        p.status,
        p.created_at,
        p.updated_at,
        COALESCE(sites_count.count, 0) as sites_count,
        0 as recordings_count
      FROM projects p
      LEFT JOIN (
        SELECT project_id, COUNT(*) as count 
        FROM sites 
        GROUP BY project_id
      ) sites_count ON p.id = sites_count.project_id
      WHERE p.user_id = :userId
      ORDER BY p.created_at DESC`,
      {
        replacements: { userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    console.log('📊 Query result:', result);
    console.log('📊 Result type:', typeof result);
    console.log('📊 Result length:', Array.isArray(result) ? result.length : 'Not an array');

    // Handle the result properly - it should be an array
    const projects = Array.isArray(result) ? result : [];
    
    console.log('📋 Projects found:', projects.length);

    res.json({
      projects: projects
    });

  } catch (error) {
    console.error('❌ Get projects error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get a specific project
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `SELECT 
        p.*
      FROM projects p
      WHERE p.id = :id AND p.user_id = :userId`,
      {
        replacements: { id: id, userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    const projects = Array.isArray(result) ? result : [];

    if (projects.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const project = projects[0];
    project.sites_count = 0; // Placeholder until sites table is created
    project.recordings_count = 0; // Placeholder until recordings table is created

    res.json({ project });

  } catch (error) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update a project
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateProject = async (req, res) => {
  try {
    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed', 
        details: errors.array() 
      });
    }

    const { id } = req.params;
    const userId = req.user.id;
    const { name, description, start_date, end_date, is_ongoing, status } = req.body;

    // Check if project exists and belongs to user
    const [existingProjects] = await db.query(
      'SELECT * FROM projects WHERE id = :id AND user_id = :userId',
      {
        replacements: { id: id, userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    if (existingProjects.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Build update query
    let updateQuery = 'UPDATE projects SET ';
    const replacements = { id: id };
    
    if (name !== undefined) {
      updateQuery += 'name = :name, ';
      replacements.name = name;
    }
    if (description !== undefined) {
      updateQuery += 'description = :description, ';
      replacements.description = description;
    }
    if (start_date !== undefined) {
      updateQuery += 'start_date = :start_date, ';
      replacements.start_date = start_date;
    }
    if (is_ongoing !== undefined) {
      updateQuery += 'is_ongoing = :is_ongoing, ';
      replacements.is_ongoing = is_ongoing;
    }
    if (status !== undefined) {
      updateQuery += 'status = :status, ';
      replacements.status = status;
    }
    
    // Handle end_date based on is_ongoing
    if (is_ongoing) {
      updateQuery += 'end_date = NULL, ';
    } else if (end_date !== undefined) {
      updateQuery += 'end_date = :end_date, ';
      replacements.end_date = end_date;
    }

    updateQuery += 'updated_at = NOW() WHERE id = :id';

    // Update project
    const [result] = await db.query(updateQuery, {
      replacements: replacements,
      type: db.QueryTypes.UPDATE
    });

    if (result === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get updated project
    const [projects] = await db.query(
      'SELECT * FROM projects WHERE id = :id',
      {
        replacements: { id: id },
        type: db.QueryTypes.SELECT
      }
    );

    res.json({
      message: 'Project updated successfully',
      project: projects[0]
    });

  } catch (error) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete a project
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if project exists and belongs to user
    const [existingProjects] = await db.query(
      'SELECT * FROM projects WHERE id = :id AND user_id = :userId',
      {
        replacements: { id: id, userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    if (existingProjects.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Collect recording file paths for S3 cleanup before DB delete
    const recordingRows = await db.query(
      'SELECT file_path FROM recordings WHERE project_id = :id',
      { replacements: { id }, type: db.QueryTypes.SELECT }
    );
    const filePaths = (recordingRows || []).map((r) => r.file_path);

    // Delete project (cascade will handle related records in DB)
    const [result] = await db.query(
      'DELETE FROM projects WHERE id = :id',
      {
        replacements: { id: id },
        type: db.QueryTypes.DELETE
      }
    );

    if (result === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Best-effort delete S3 objects
    try {
      await deleteManyFromS3(filePaths);
    } catch (e) {
      console.error('⚠️  Failed to delete some S3 objects for project:', id, e?.message);
    }

    res.json({ message: 'Project deleted successfully' });

  } catch (error) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 