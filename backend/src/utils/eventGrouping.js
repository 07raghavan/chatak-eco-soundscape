/**
 * Event Grouping and Classification Utility
 * Groups acoustic events that likely belong to the same source (e.g., same bird)
 * and classifies them by sound type (bird, frog, etc.)
 */

/**
 * Classify sound type based on frequency characteristics and duration
 */
export function classifySoundType(event) {
  const f_min = event.f_min_hz || 0;
  const f_max = event.f_max_hz || 8000;
  const duration_ms = event.end_ms - event.start_ms;
  const freq_range = f_max - f_min;
  const center_freq = (f_min + f_max) / 2;
  
  // Use existing band labels if available
  if (event.band_name) {
    switch (event.band_name.toLowerCase()) {
      case 'low_freq':
        return center_freq < 1000 ? 'frog' : 'bird_low';
      case 'mid_freq':
        return 'bird';
      case 'high_freq':
        return 'bird_high';
      default:
        break;
    }
  }
  
  // Classify based on frequency characteristics
  if (center_freq < 800 && freq_range < 1500) {
    // Low frequency, narrow band - likely frog or toad
    return 'frog';
  } else if (center_freq > 6000 && duration_ms < 200) {
    // High frequency, short duration - likely insect or high-pitched bird
    return 'insect';
  } else if (center_freq >= 1000 && center_freq <= 6000) {
    // Mid-range frequency - most likely bird
    if (duration_ms < 100) {
      return 'bird_chip'; // Short chip calls
    } else if (duration_ms > 1000) {
      return 'bird_song'; // Longer songs
    } else {
      return 'bird'; // General bird call
    }
  } else if (center_freq < 1000) {
    // Low-mid frequency
    return freq_range > 2000 ? 'bird_low' : 'mammal';
  } else {
    // High frequency
    return 'bird_high';
  }
}

/**
 * Calculate overlap between two frequency ranges
 */
function getFrequencyOverlap(event1, event2) {
  const f1_min = event1.f_min_hz || 0;
  const f1_max = event1.f_max_hz || 8000;
  const f2_min = event2.f_min_hz || 0;
  const f2_max = event2.f_max_hz || 8000;
  
  const overlap_min = Math.max(f1_min, f2_min);
  const overlap_max = Math.min(f1_max, f2_max);
  
  if (overlap_max <= overlap_min) return 0;
  
  const overlap_range = overlap_max - overlap_min;
  const total_range = Math.max(f1_max, f2_max) - Math.min(f1_min, f2_min);
  
  return overlap_range / total_range;
}

/**
 * Calculate temporal gap between two events
 */
function getTemporalGap(event1, event2) {
  const end1 = event1.end_ms;
  const start2 = event2.start_ms;
  
  if (start2 < end1) {
    // Events overlap temporally
    return 0;
  }
  
  return start2 - end1;
}

/**
 * Check if two events should be grouped together
 */
function shouldGroupEvents(event1, event2, options = {}) {
  const {
    maxTimeGap = 2000, // Maximum gap between events in ms
    minFreqOverlap = 0.3, // Minimum frequency overlap ratio
    maxFreqDistance = 2000, // Maximum frequency distance in Hz
    sameSoundType = true // Whether events must be of same sound type
  } = options;
  
  // Classify sound types
  const type1 = classifySoundType(event1);
  const type2 = classifySoundType(event2);
  
  // If requiring same sound type, check compatibility
  if (sameSoundType) {
    // Allow grouping of related bird types
    const birdTypes = ['bird', 'bird_low', 'bird_high', 'bird_chip', 'bird_song'];
    const isBird1 = birdTypes.includes(type1);
    const isBird2 = birdTypes.includes(type2);
    
    if (!(type1 === type2 || (isBird1 && isBird2))) {
      return false;
    }
  }
  
  // Check temporal proximity
  const timeGap = getTemporalGap(event1, event2);
  if (timeGap > maxTimeGap) {
    return false;
  }
  
  // Check frequency overlap or proximity
  const freqOverlap = getFrequencyOverlap(event1, event2);
  if (freqOverlap < minFreqOverlap) {
    // If no significant overlap, check if frequencies are close
    const f1_center = (event1.f_min_hz + event1.f_max_hz) / 2;
    const f2_center = (event2.f_min_hz + event2.f_max_hz) / 2;
    const freqDistance = Math.abs(f1_center - f2_center);
    
    if (freqDistance > maxFreqDistance) {
      return false;
    }
  }
  
  // Check confidence similarity (events from same source should have similar confidence)
  const confDiff = Math.abs((event1.confidence || 0.5) - (event2.confidence || 0.5));
  if (confDiff > 0.4) {
    return false;
  }
  
  return true;
}

/**
 * Group events using a simple clustering algorithm
 */
export function groupEvents(events, options = {}) {
  if (!events || events.length === 0) {
    return [];
  }
  
  // Sort events by start time
  const sortedEvents = [...events].sort((a, b) => a.start_ms - b.start_ms);
  
  const groups = [];
  const visited = new Set();
  
  for (let i = 0; i < sortedEvents.length; i++) {
    if (visited.has(i)) continue;
    
    const currentGroup = [sortedEvents[i]];
    visited.add(i);
    
    // Look for events to group with current event
    for (let j = i + 1; j < sortedEvents.length; j++) {
      if (visited.has(j)) continue;
      
      // Check if this event should be grouped with any event in the current group
      const shouldGroup = currentGroup.some(groupEvent => 
        shouldGroupEvents(groupEvent, sortedEvents[j], options)
      );
      
      if (shouldGroup) {
        currentGroup.push(sortedEvents[j]);
        visited.add(j);
      }
    }
    
    groups.push(currentGroup);
  }
  
  return groups;
}

/**
 * Create a combined bounding box for a group of events
 */
export function createGroupBoundingBox(eventGroup) {
  if (!eventGroup || eventGroup.length === 0) {
    return null;
  }
  
  if (eventGroup.length === 1) {
    const event = eventGroup[0];
    return {
      ...event,
      group_id: `single_${event.id}`,
      group_size: 1,
      sound_type: classifySoundType(event),
      event_ids: [event.id],
      representative_event: event
    };
  }
  
  // Calculate combined bounding box
  const startTimes = eventGroup.map(e => e.start_ms);
  const endTimes = eventGroup.map(e => e.end_ms);
  const minFreqs = eventGroup.map(e => e.f_min_hz || 0);
  const maxFreqs = eventGroup.map(e => e.f_max_hz || 8000);
  
  const combinedStart = Math.min(...startTimes);
  const combinedEnd = Math.max(...endTimes);
  const combinedFMin = Math.min(...minFreqs);
  const combinedFMax = Math.max(...maxFreqs);
  
  // Get the highest confidence event as representative
  const representativeEvent = eventGroup.reduce((best, current) => 
    (current.confidence || 0) > (best.confidence || 0) ? current : best
  );
  
  // Calculate average confidence
  const avgConfidence = eventGroup.reduce((sum, e) => sum + (e.confidence || 0), 0) / eventGroup.length;
  
  // Determine sound type (use most common, or representative event's type)
  const soundType = classifySoundType(representativeEvent);
  
  return {
    id: `group_${eventGroup.map(e => e.id).join('_')}`,
    group_id: `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    start_ms: combinedStart,
    end_ms: combinedEnd,
    f_min_hz: combinedFMin,
    f_max_hz: combinedFMax,
    confidence: avgConfidence,
    sound_type: soundType,
    group_size: eventGroup.length,
    event_ids: eventGroup.map(e => e.id),
    representative_event: representativeEvent,
    band_name: representativeEvent.band_name,
    // Include additional metadata
    individual_events: eventGroup.map(e => ({
      id: e.id,
      start_ms: e.start_ms,
      end_ms: e.end_ms,
      f_min_hz: e.f_min_hz,
      f_max_hz: e.f_max_hz,
      confidence: e.confidence
    }))
  };
}

/**
 * Main function to process and group events
 */
export function processAndGroupEvents(events, options = {}) {
  const {
    enableGrouping = true,
    groupingOptions = {},
    minGroupSize = 2 // Minimum events to form a group
  } = options;
  
  if (!enableGrouping || !events || events.length === 0) {
    return events.map(event => ({
      ...event,
      sound_type: classifySoundType(event),
      group_size: 1,
      event_ids: [event.id]
    }));
  }
  
  console.log(`🎵 Grouping ${events.length} events...`);
  
  // Group events
  const groups = groupEvents(events, groupingOptions);
  
  console.log(`🎵 Created ${groups.length} groups from ${events.length} events`);
  
  // Create bounding boxes for groups
  const groupedEvents = groups.map(group => createGroupBoundingBox(group));
  
  // Log grouping results
  const singleEvents = groupedEvents.filter(g => g.group_size === 1).length;
  const multiEvents = groupedEvents.filter(g => g.group_size > 1).length;
  const soundTypes = [...new Set(groupedEvents.map(g => g.sound_type))];
  
  console.log(`🎵 Grouping results:`);
  console.log(`  - Single events: ${singleEvents}`);
  console.log(`  - Multi-event groups: ${multiEvents}`);
  console.log(`  - Sound types detected: ${soundTypes.join(', ')}`);
  
  // Log detailed group information
  groupedEvents.forEach((group, i) => {
    if (group.group_size > 1) {
      console.log(`  Group ${i + 1}: ${group.group_size} events, type: ${group.sound_type}, duration: ${((group.end_ms - group.start_ms) / 1000).toFixed(2)}s`);
    }
  });
  
  return groupedEvents.filter(group => group !== null);
}

/**
 * Get color scheme for different sound types
 */
export function getSoundTypeColor(soundType) {
  const colorMap = {
    'bird': '#FF6B35',           // Orange-red for general birds
    'bird_low': '#FF8C42',       // Light orange for low-freq birds  
    'bird_high': '#FF4081',      // Pink for high-freq birds
    'bird_chip': '#FF7043',      // Orange for chip calls
    'bird_song': '#FFA726',      // Amber for songs
    'frog': '#4CAF50',           // Green for frogs/toads
    'insect': '#FFEB3B',         // Yellow for insects
    'mammal': '#795548',         // Brown for mammals
    'unknown': '#9E9E9E'         // Gray for unknown
  };
  
  return colorMap[soundType] || colorMap['unknown'];
}
