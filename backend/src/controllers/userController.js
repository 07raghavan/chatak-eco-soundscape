import { validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import { db } from '../config/database.js';

/**
 * Update user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateProfile = async (req, res) => {
  try {
    console.log('🔍 Profile update request received:', req.body);
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

    const { name, organization } = req.body;
    const userId = req.user.id;

    console.log('📝 Updating fields:', { name, organization, userId });

    // Build update query dynamically
    const setClauses = [];
    const replacements = { userId };

    if (name !== undefined) {
      setClauses.push('name = :name');
      replacements.name = name;
    }
    if (organization !== undefined) {
      setClauses.push('organization = :organization');
      replacements.organization = organization;
    }

    if (setClauses.length === 0) {
      console.log('⚠️ No fields provided to update');
      return res.status(400).json({ error: 'No fields to update' });
    }

    const updateQuery = `UPDATE users SET ${setClauses.join(', ')} WHERE id = :userId RETURNING id, name, email, organization, created_at`;

    console.log('🔧 Update query:', updateQuery);
    console.log('🔧 Replacements:', replacements);

    // Execute update and return updated row(s)
    const [updatedRows] = await db.query(updateQuery, { replacements });

    if (!updatedRows || updatedRows.length === 0) {
      console.log('❌ No user found with ID:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = updatedRows[0];
    console.log('✅ Updated user data:', updatedUser);

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        organization: updatedUser.organization
      }
    });

  } catch (error) {
    console.error('❌ Profile update error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get user profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('🔍 Get profile request for user ID:', userId);

    const users = await db.query(
      'SELECT id, name, email, organization, created_at FROM users WHERE id = :userId',
      {
        replacements: { userId: userId },
        type: db.QueryTypes.SELECT
      }
    );

    if (!users || users.length === 0) {
      console.log('❌ No user found with ID:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];
    console.log('✅ Retrieved user data:', user);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        organization: user.organization,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('❌ Get profile error:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 