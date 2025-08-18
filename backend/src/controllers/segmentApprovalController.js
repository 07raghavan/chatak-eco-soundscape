import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';

export const approveSegment = async (req, res) => {
  try {
    const { segmentId } = req.params;
    const userId = req.user.id;

    // Ensure segment exists and belongs to the user
    const seg = await db.query(`
      SELECT s.*, r.project_id, p.user_id as owner_id
      FROM segments s
      JOIN recordings r ON s.recording_id = r.id
      JOIN projects p ON r.project_id = p.id
      WHERE s.id = :segmentId
    `, { replacements: { segmentId }, type: QueryTypes.SELECT });

    if (seg.length === 0) return res.status(404).json({ error: 'Segment not found' });
    if (seg[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    const result = await db.query(`
      INSERT INTO segment_approvals (segment_id, status, approved_by, approved_at)
      VALUES (:segmentId, 'approved', :userId, NOW())
      ON CONFLICT (segment_id) DO UPDATE SET status = 'approved', approved_by = :userId, approved_at = NOW(), updated_at = NOW()
      RETURNING *
    `, { replacements: { segmentId, userId }, type: QueryTypes.INSERT });

    return res.json({ message: 'Segment approved', approval: result[0][0] });
  } catch (err) {
    console.error('approveSegment error', err);
    res.status(500).json({ error: 'Failed to approve segment' });
  }
};

export const rejectSegment = async (req, res) => {
  try {
    const { segmentId } = req.params;
    const userId = req.user.id;
    const { notes } = req.body || {};

    const seg = await db.query(`
      SELECT s.*, r.project_id, p.user_id as owner_id
      FROM segments s
      JOIN recordings r ON s.recording_id = r.id
      JOIN projects p ON r.project_id = p.id
      WHERE s.id = :segmentId
    `, { replacements: { segmentId }, type: QueryTypes.SELECT });

    if (seg.length === 0) return res.status(404).json({ error: 'Segment not found' });
    if (seg[0].owner_id !== userId) return res.status(403).json({ error: 'Access denied' });

    const result = await db.query(`
      INSERT INTO segment_approvals (segment_id, status, approved_by, approved_at, notes)
      VALUES (:segmentId, 'rejected', :userId, NOW(), :notes)
      ON CONFLICT (segment_id) DO UPDATE SET status = 'rejected', approved_by = :userId, approved_at = NOW(), notes = :notes, updated_at = NOW()
      RETURNING *
    `, { replacements: { segmentId, userId, notes: notes ?? null }, type: QueryTypes.INSERT });

    return res.json({ message: 'Segment rejected', approval: result[0][0] });
  } catch (err) {
    console.error('rejectSegment error', err);
    res.status(500).json({ error: 'Failed to reject segment' });
  }
};


