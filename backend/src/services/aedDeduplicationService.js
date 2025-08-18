import { db } from '../config/database.js';
import { QueryTypes } from 'sequelize';

/**
 * AED Event Deduplication Service
 * Handles cross-segment duplicate detection and removal for overlapping segments
 */
export class AEDDeduplicationService {
  constructor(config = {}) {
    this.config = {
      temporalIouThreshold: 0.5,    // Temporal IoU threshold for duplicates
      frequencyIouThreshold: 0.5,   // Frequency IoU threshold for duplicates
      overlapWindowMs: 5000,        // Look-back window for checking duplicates (5 seconds)
      confidenceWeight: 0.7,        // Weight for confidence in duplicate resolution
      ...config
    };
  }

  /**
   * Calculate Intersection over Union (IoU) for temporal overlap
   */
  calculateTemporalIoU(event1, event2) {
    const start1 = event1.start_ms;
    const end1 = event1.end_ms;
    const start2 = event2.start_ms;
    const end2 = event2.end_ms;

    // Calculate intersection
    const intersectionStart = Math.max(start1, start2);
    const intersectionEnd = Math.min(end1, end2);
    const intersection = Math.max(0, intersectionEnd - intersectionStart);

    // Calculate union
    const duration1 = end1 - start1;
    const duration2 = end2 - start2;
    const union = duration1 + duration2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Calculate Intersection over Union (IoU) for frequency overlap
   */
  calculateFrequencyIoU(event1, event2) {
    const fmin1 = event1.f_min_hz;
    const fmax1 = event1.f_max_hz;
    const fmin2 = event2.f_min_hz;
    const fmax2 = event2.f_max_hz;

    // Calculate intersection
    const intersectionMin = Math.max(fmin1, fmin2);
    const intersectionMax = Math.min(fmax1, fmax2);
    const intersection = Math.max(0, intersectionMax - intersectionMin);

    // Calculate union
    const range1 = fmax1 - fmin1;
    const range2 = fmax2 - fmin2;
    const union = range1 + range2 - intersection;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Determine which event to keep when duplicates are found
   * Returns the event to keep and the event to mark as duplicate
   */
  resolveDuplicate(event1, event2, temporalIoU, frequencyIoU) {
    // Calculate composite confidence score
    const confidence1 = event1.confidence || 0;
    const confidence2 = event2.confidence || 0;
    
    // Factor in SNR if available
    const snr1 = event1.snr_db || 0;
    const snr2 = event2.snr_db || 0;
    
    // Composite score: confidence + SNR + duration preference
    const duration1 = event1.end_ms - event1.start_ms;
    const duration2 = event2.end_ms - event2.start_ms;
    const durationScore1 = Math.min(1.0, duration1 / 1000); // Prefer longer events up to 1s
    const durationScore2 = Math.min(1.0, duration2 / 1000);
    
    const score1 = (confidence1 * this.config.confidenceWeight) + 
                   (snr1 / 60 * 0.2) + 
                   (durationScore1 * 0.1);
    const score2 = (confidence2 * this.config.confidenceWeight) + 
                   (snr2 / 60 * 0.2) + 
                   (durationScore2 * 0.1);

    // Return [keepEvent, duplicateEvent, confidence]
    if (score1 >= score2) {
      return {
        keep: event1,
        duplicate: event2,
        confidence: Math.min(1.0, Math.abs(score1 - score2) + 0.5)
      };
    } else {
      return {
        keep: event2,
        duplicate: event1,
        confidence: Math.min(1.0, Math.abs(score2 - score1) + 0.5)
      };
    }
  }

  /**
   * Find potential duplicates for a new event by checking previous segments
   */
  async findPotentialDuplicates(newEvent, recordingId) {
    // Look for events in the overlap window before this event
    const searchStartMs = newEvent.start_ms - this.config.overlapWindowMs;
    const searchEndMs = newEvent.end_ms + this.config.overlapWindowMs;

    const potentialDuplicates = await db.query(`
      SELECT 
        id, segment_id, start_ms, end_ms, f_min_hz, f_max_hz, 
        confidence, snr_db, detection_method
      FROM aed_events 
      WHERE recording_id = :recordingId
        AND duplicate_of IS NULL
        AND (
          (start_ms BETWEEN :searchStartMs AND :searchEndMs) OR
          (end_ms BETWEEN :searchStartMs AND :searchEndMs) OR
          (start_ms <= :newStartMs AND end_ms >= :newEndMs)
        )
        AND id != :newEventId
      ORDER BY start_ms
    `, {
      replacements: {
        recordingId,
        searchStartMs,
        searchEndMs,
        newStartMs: newEvent.start_ms,
        newEndMs: newEvent.end_ms,
        newEventId: newEvent.id || -1
      },
      type: QueryTypes.SELECT
    });

    return potentialDuplicates;
  }

  /**
   * Process deduplication for a batch of new events
   */
  async deduplicateEvents(newEvents, recordingId) {
    const duplicateUpdates = [];
    const processedEventIds = new Set();

    console.log(`🔍 Deduplicating ${newEvents.length} events for recording ${recordingId}...`);

    for (const newEvent of newEvents) {
      if (processedEventIds.has(newEvent.id)) continue;

      // Find potential duplicates
      const potentialDuplicates = await this.findPotentialDuplicates(newEvent, recordingId);

      for (const candidate of potentialDuplicates) {
        if (processedEventIds.has(candidate.id)) continue;

        // Calculate IoU metrics
        const temporalIoU = this.calculateTemporalIoU(newEvent, candidate);
        const frequencyIoU = this.calculateFrequencyIoU(newEvent, candidate);

        // Check if this is a duplicate
        if (temporalIoU >= this.config.temporalIouThreshold && 
            frequencyIoU >= this.config.frequencyIouThreshold) {

          // Resolve which event to keep
          const resolution = this.resolveDuplicate(newEvent, candidate, temporalIoU, frequencyIoU);

          // Mark the duplicate
          duplicateUpdates.push({
            duplicateId: resolution.duplicate.id,
            originalId: resolution.keep.id,
            temporalIoU: temporalIoU,
            frequencyIoU: frequencyIoU,
            confidence: resolution.confidence
          });

          processedEventIds.add(resolution.duplicate.id);
          
          console.log(`🔗 Duplicate found: Event ${resolution.duplicate.id} → ${resolution.keep.id} (tIoU=${temporalIoU.toFixed(3)}, fIoU=${frequencyIoU.toFixed(3)})`);
        }
      }

      processedEventIds.add(newEvent.id);
    }

    // Apply duplicate markings in batch
    if (duplicateUpdates.length > 0) {
      await this.markDuplicatesBatch(duplicateUpdates);
      console.log(`✅ Marked ${duplicateUpdates.length} duplicates`);
    }

    return {
      totalProcessed: newEvents.length,
      duplicatesFound: duplicateUpdates.length,
      uniqueEvents: newEvents.length - duplicateUpdates.filter(d => 
        newEvents.some(e => e.id === d.duplicateId)).length
    };
  }

  /**
   * Mark events as duplicates in batch for performance
   */
  async markDuplicatesBatch(duplicateUpdates) {
    if (duplicateUpdates.length === 0) return;

    // Build batch update query
    const updateCases = duplicateUpdates.map((update, index) => {
      const baseIndex = index * 5;
      return `WHEN id = $${baseIndex + 1} THEN $${baseIndex + 2}`;
    }).join(' ');

    const temporalIouCases = duplicateUpdates.map((update, index) => {
      const baseIndex = index * 5;
      return `WHEN id = $${baseIndex + 1} THEN $${baseIndex + 3}`;
    }).join(' ');

    const frequencyIouCases = duplicateUpdates.map((update, index) => {
      const baseIndex = index * 5;
      return `WHEN id = $${baseIndex + 1} THEN $${baseIndex + 4}`;
    }).join(' ');

    const confidenceCases = duplicateUpdates.map((update, index) => {
      const baseIndex = index * 5;
      return `WHEN id = $${baseIndex + 1} THEN $${baseIndex + 5}`;
    }).join(' ');

    const ids = duplicateUpdates.map(update => update.duplicateId);
    const replacements = duplicateUpdates.flatMap(update => [
      update.duplicateId,
      update.originalId,
      update.temporalIoU,
      update.frequencyIoU,
      update.confidence
    ]);

    await db.query(`
      UPDATE aed_events SET
        duplicate_of = CASE ${updateCases} END,
        temporal_iou = CASE ${temporalIouCases} END,
        frequency_iou = CASE ${frequencyIouCases} END,
        dedup_confidence = CASE ${confidenceCases} END,
        updated_at = NOW()
      WHERE id IN (${ids.map((_, i) => `$${i * 5 + 1}`).join(', ')})
    `, {
      replacements,
      type: QueryTypes.UPDATE
    });
  }

  /**
   * Get deduplication statistics for a recording
   */
  async getDeduplicationStats(recordingId) {
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(CASE WHEN duplicate_of IS NULL THEN 1 END) as unique_events,
        COUNT(CASE WHEN duplicate_of IS NOT NULL THEN 1 END) as duplicate_events,
        AVG(CASE WHEN temporal_iou IS NOT NULL THEN temporal_iou END) as avg_temporal_iou,
        AVG(CASE WHEN frequency_iou IS NOT NULL THEN frequency_iou END) as avg_frequency_iou,
        AVG(CASE WHEN dedup_confidence IS NOT NULL THEN dedup_confidence END) as avg_dedup_confidence
      FROM aed_events 
      WHERE recording_id = :recordingId
    `, {
      replacements: { recordingId },
      type: QueryTypes.SELECT
    });

    return stats[0];
  }
}

export default AEDDeduplicationService;
