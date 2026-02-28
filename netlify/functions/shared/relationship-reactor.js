// ============================================
// RELATIONSHIP REACTOR — Emotional Event Scanner
// ============================================
//
// Detects emotionally significant patterns in AI character responses
// using regex-only analysis (zero API calls). Returns structured events
// for logging to the relationship_events table.
//
// This runs on every AI response, so performance matters.
// Most responses will return an empty array — that's normal.
//
// Detection categories:
//   physical_contact  — touch, embrace, kiss, etc.
//   verbal_aggression — snarl, threaten, shove, etc.
//   affection         — smile at, comfort, protect, etc.
//   dismissal         — ignore, walk away, cold shoulder, etc.
//   vulnerability     — confide, cry, tremble, etc.
//   jealousy_marker   — possessive gestures, "mine", stepping between, etc.
//
// All patterns look inside asterisk-wrapped emotes: *action here*
// because that's how characters express physical/emotional actions.
// ============================================

// --------------------------------------------
// DETECTION PATTERNS
// --------------------------------------------
// Each category has an array of { regex, intensity } pairs.
// Regexes capture the full emote content inside asterisks.
// Intensity is a base value (1-10 scale) that can be amplified
// by relationship context.
//
// IMPORTANT: Patterns are ordered high-intensity first within each category.
// The scanner stops at the first match per category per target to avoid
// double-counting a single action.
// --------------------------------------------

const DETECTION_PATTERNS = {
  physical_contact: {
    patterns: [
      // High intensity (5-7): intimate/forceful contact
      {
        regex: /\*([^*]*?(?:kisses?|presses?\s+(?:\w+\s+)?lips|cups?\s+(?:\w+\s+)?face|pulls?\s+(?:\w+\s+)?close\s+and|presses?\s+(?:against|into)|pins?\s+(?:\w+\s+)?against)[^*]*?)\*/gi,
        intensity: 7
      },
      {
        regex: /\*([^*]*?(?:wraps?\s+(?:\w+\s+){0,2}arms?\s+around|embraces?|pulls?\s+(?:\w+\s+)?close|holds?\s+(?:\w+\s+)?tight(?:ly)?|clings?\s+to)[^*]*?)\*/gi,
        intensity: 5
      },
      // Low intensity (3-4): casual/gentle contact
      {
        regex: /\*([^*]*?(?:takes?\s+(?:\w+\s+)?hand|squeezes?\s+(?:\w+\s+)?hand|brushes?\s+(?:\w+\s+)?fingers|rests?\s+(?:\w+\s+)?head\s+(?:on|against)|leans?\s+(?:into|against|on)|pats?\s+(?:\w+\s+)?(?:shoulder|back|head|arm)|bumps?\s+(?:\w+\s+)?shoulder|nudges?)[^*]*?)\*/gi,
        intensity: 3
      },
      {
        regex: /\*([^*]*?(?:touches?\s+(?:\w+\s+)?(?:arm|shoulder|hand|cheek|face|back|hair)|grabs?\s+(?:\w+\s+)?(?:arm|wrist|hand|shoulder))[^*]*?)\*/gi,
        intensity: 4
      }
    ],
    baseType: 'physical_contact'
  },

  verbal_aggression: {
    patterns: [
      // High intensity (7-8): physical aggression / serious threats
      {
        regex: /\*([^*]*?(?:shoves?\s|slams?\s|strikes?\s|punches?\s|kicks?\s|throws?\s+(?:\w+\s+)?against|pins?\s+(?:\w+\s+)?(?:down|to\s+the))[^*]*?)\*/gi,
        intensity: 8
      },
      {
        regex: /\*([^*]*?(?:threatens?\s|snarls?\s+(?:at|toward)|bares?\s+(?:\w+\s+)?teeth|gets?\s+in\s+(?:\w+\s+)?face)[^*]*?)\*/gi,
        intensity: 7
      },
      // Medium intensity (5-6): verbal hostility
      {
        regex: /\*([^*]*?(?:growls?\s+(?:at|toward)|hisses?\s+(?:at|toward)|snaps?\s+(?:at|toward)|barks?\s+(?:at|toward)|mocks?\s|insults?\s)[^*]*?)\*/gi,
        intensity: 5
      },
      // Quoted aggressive phrases inside emotes
      {
        regex: /\*([^*]*?(?:["'](?:back\s+off|stay\s+away|don'?t\s+touch|shut\s+up|get\s+(?:out|away|lost))["'])[^*]*?)\*/gi,
        intensity: 6
      }
    ],
    baseType: 'verbal_aggression'
  },

  affection: {
    patterns: [
      // Medium intensity (4-5): meaningful warmth
      {
        regex: /\*([^*]*?(?:comforts?\s|protects?\s|defends?\s|reassures?\s|whispers?\s+(?:softly|gently|warmly)\s+to)[^*]*?)\*/gi,
        intensity: 5
      },
      {
        regex: /\*([^*]*?(?:teases?\s+(?:\w+\s+)?gently|teases?\s+(?:\w+\s+)?playfully|laughs?\s+(?:softly\s+)?with|chuckles?\s+(?:softly\s+)?with)[^*]*?)\*/gi,
        intensity: 3
      },
      // Low intensity (2-3): casual positive
      {
        regex: /\*([^*]*?(?:smiles?\s+(?:at|toward|warmly)|grins?\s+(?:at|toward)|winks?\s+(?:at|toward)|nods?\s+(?:at|toward|approvingly))[^*]*?)\*/gi,
        intensity: 2
      }
    ],
    baseType: 'affection'
  },

  dismissal: {
    patterns: [
      // High intensity (5-6): cold rejection
      {
        regex: /\*([^*]*?(?:turns?\s+(?:\w+\s+)?(?:back|away)\s+(?:on|from)|refuses?\s+to\s+(?:look|acknowledge|speak)|walks?\s+away\s+(?:from|without)|leaves?\s+without\s+(?:a\s+)?word)[^*]*?)\*/gi,
        intensity: 6
      },
      {
        regex: /\*([^*]*?(?:ignores?\s|cold\s+shoulders?\s|brushes?\s+(?:\w+\s+)?off|waves?\s+(?:\w+\s+)?(?:away|off)\s+dismissively)[^*]*?)\*/gi,
        intensity: 5
      },
      // Medium intensity (3-4): mild dismissal
      {
        regex: /\*([^*]*?(?:shrugs?\s+(?:at|toward)|rolls?\s+(?:\w+\s+)?eyes\s+(?:at|toward)|scoffs?\s+(?:at|toward))[^*]*?)\*/gi,
        intensity: 3
      },
      // Quoted dismissive phrases inside emotes
      {
        regex: /\*([^*]*?(?:["'](?:whatever|don'?t\s+care|not\s+(?:my|your)\s+problem|leave\s+me\s+alone)["'])[^*]*?)\*/gi,
        intensity: 4
      }
    ],
    baseType: 'dismissal'
  },

  vulnerability: {
    patterns: [
      // High intensity (6-7): emotional breakdown
      {
        regex: /\*([^*]*?(?:breaks?\s+down|tears?\s+(?:stream|fall|roll)|(?:voice|hands?)\s+(?:cracks?|shakes?|trembles?)|sobs?\s|cries?\s|wipes?\s+(?:\w+\s+)?(?:tears|eyes))[^*]*?)\*/gi,
        intensity: 7
      },
      // Medium intensity (4-5): emotional openness
      {
        regex: /\*([^*]*?(?:confides?\s+in|admits?\s+(?:quietly|softly)|reveals?\s|whispers?\s+(?:vulnerably|shakily)|trembles?\s|flinches?\s)[^*]*?)\*/gi,
        intensity: 5
      },
      // Quoted vulnerable phrases inside emotes
      {
        regex: /\*([^*]*?(?:["'](?:I'?m\s+scared|I\s+need\s+you|don'?t\s+leave|I\s+can'?t\s+(?:do\s+this|lose\s+you)|please\s+(?:don'?t\s+go|stay)|I'?m\s+sorry)["'])[^*]*?)\*/gi,
        intensity: 6
      }
    ],
    baseType: 'vulnerability'
  },

  jealousy_marker: {
    patterns: [
      // High intensity (7-8): overt possessiveness
      {
        regex: /\*([^*]*?(?:steps?\s+between|positions?\s+(?:\w+\s+)?(?:self|himself|herself|themselves)\s+between|pulls?\s+(?:\w+\s+)?away\s+from|blocks?\s+(?:\w+\s+)?(?:path|view)\s+(?:of|to))[^*]*?)\*/gi,
        intensity: 8
      },
      {
        regex: /\*([^*]*?(?:["'](?:mine|they'?re\s+mine|back\s+off.*?(?:from|away))["']|possessive(?:ly)?\s+(?:grabs?|pulls?|holds?))[^*]*?)\*/gi,
        intensity: 7
      },
      // Medium intensity (5-6): jealous body language
      {
        regex: /\*([^*]*?(?:clenches?\s+(?:\w+\s+)?jaw\s+(?:as|while|when|watching)|stiffens?\s+(?:as|when|seeing)|narrows?\s+(?:\w+\s+)?eyes\s+(?:at|watching|seeing)|(?:jaw|fists?)\s+(?:tightens?|clenches?))[^*]*?)\*/gi,
        intensity: 5
      },
      {
        regex: /\*([^*]*?(?:stares?\s+(?:at|toward).*?(?:with|together|close|touching)|watches?\s+(?:jealously|enviously|possessively))[^*]*?)\*/gi,
        intensity: 6
      }
    ],
    baseType: 'jealousy_marker'
  }
};


// --------------------------------------------
// FALSE POSITIVE FILTERS
// --------------------------------------------
// Some words overlap with non-emotional usage.
// These filters catch common false positives.
// --------------------------------------------

const FALSE_POSITIVE_FILTERS = {
  physical_contact: [
    /touch(?:ing|es?)?\s+(?:on|upon|base|screen|subject|topic|button|panel|keyboard)/i,
    /grabs?\s+(?:a\s+)?(?:coffee|drink|snack|file|folder|pen|phone|laptop|seat|chair)/i,
    /leans?\s+(?:back|forward)\s+in\s+(?:chair|seat)/i,
    /holds?\s+(?:up|out|back|onto)\s+(?:a\s+)?(?:hand|phone|paper|sign|document|cup|mug)/i
  ],
  verbal_aggression: [
    /snaps?\s+(?:a\s+)?(?:fingers?|photo|picture|selfie)/i,
    /barks?\s+(?:out\s+)?(?:a\s+)?laugh/i,
    /slams?\s+(?:the\s+)?(?:door|laptop|book|fist\s+on)/i
  ],
  affection: [
    /smiles?\s+(?:at|to)\s+(?:the\s+)?(?:screen|camera|phone|thought|idea|memory|nothing)/i,
    /nods?\s+(?:at|to)\s+(?:the\s+)?(?:screen|self|thought|idea)/i
  ]
};


// --------------------------------------------
// CORE SCANNER
// --------------------------------------------

/**
 * Scan an AI response for emotionally significant events.
 *
 * @param {string} characterName - The character who produced this response
 * @param {string} responseText - The full AI response text
 * @param {string[]} presentCharacters - Names of characters present in the scene
 * @param {Object[]} existingRelationships - Array of relationship objects from character_relationships table
 *   Each has: { character_name, target_name, affinity, bond_type, bond_exclusive }
 * @returns {Object[]} Array of detected events, each with:
 *   { type, target, intensity, snippet, source }
 */
function scanResponse(characterName, responseText, presentCharacters = [], existingRelationships = []) {
  if (!responseText || !characterName) return [];

  // Filter out the speaking character from potential targets
  const targets = (presentCharacters || []).filter(
    name => name.toLowerCase() !== characterName.toLowerCase()
  );

  // No other characters present means no interpersonal events to detect
  if (targets.length === 0) return [];

  const events = [];

  // Build a quick lookup for relationships: "CharA->CharB" => relationship object
  const relLookup = {};
  if (Array.isArray(existingRelationships)) {
    for (const rel of existingRelationships) {
      const key = `${rel.character_name}->${rel.target_name}`;
      relLookup[key] = rel;
    }
  }

  // Scan each detection category
  for (const [categoryKey, category] of Object.entries(DETECTION_PATTERNS)) {
    const detectedTargets = new Set(); // Track which targets already matched in this category

    for (const patternDef of category.patterns) {
      // Reset regex state for each pattern
      const regex = new RegExp(patternDef.regex.source, patternDef.regex.flags);
      let match;

      while ((match = regex.exec(responseText)) !== null) {
        const emoteContent = match[1] || match[0];

        // Check false positive filters
        if (isFalsePositive(categoryKey, emoteContent)) continue;

        // Find which target character this action is directed at
        const target = findTarget(emoteContent, match.index, responseText, targets);
        if (!target) continue;

        // Skip if we already found an event for this target in this category
        // (prevents double-counting "wraps arm around Asuna and pulls her close")
        if (detectedTargets.has(target)) continue;
        detectedTargets.add(target);

        // Calculate final intensity with relationship context amplification
        let intensity = patternDef.intensity;
        intensity = amplifyIntensity(intensity, categoryKey, characterName, target, relLookup);

        // Clamp to 1-10
        intensity = Math.max(1, Math.min(10, intensity));

        // Extract a readable snippet (truncated to ~80 chars)
        const snippet = truncateSnippet(emoteContent, 80);

        events.push({
          type: category.baseType,
          target,
          intensity,
          snippet,
          source: 'scanner'
        });
      }
    }
  }

  return events;
}


// --------------------------------------------
// TARGET DETECTION
// --------------------------------------------
// Finds which character a detected action is directed at.
// Searches for character names within ~30 chars before/after
// the match, then falls back to the broader emote content.
// --------------------------------------------

/**
 * Find the target character for a detected emote action.
 *
 * @param {string} emoteContent - The captured emote text
 * @param {number} matchIndex - Position of the match in the full response
 * @param {string} fullText - The full response text
 * @param {string[]} targets - Possible target character names
 * @returns {string|null} The target character name, or null if none found
 */
function findTarget(emoteContent, matchIndex, fullText, targets) {
  // First, check the emote content itself for character names
  for (const name of targets) {
    const nameRegex = new RegExp(`\\b${escapeRegex(name)}(?:'s)?\\b`, 'i');
    if (nameRegex.test(emoteContent)) {
      return name;
    }
  }

  // Second, check a window around the match in the full text (~30 chars each direction)
  const windowStart = Math.max(0, matchIndex - 30);
  const windowEnd = Math.min(fullText.length, matchIndex + emoteContent.length + 30);
  const windowText = fullText.substring(windowStart, windowEnd);

  for (const name of targets) {
    const nameRegex = new RegExp(`\\b${escapeRegex(name)}(?:'s)?\\b`, 'i');
    if (nameRegex.test(windowText)) {
      return name;
    }
  }

  // No target found in proximity — skip this match
  return null;
}


// --------------------------------------------
// INTENSITY AMPLIFICATION
// --------------------------------------------
// Cross-references existing relationships to amplify
// the emotional weight of detected events.
// --------------------------------------------

/**
 * Amplify event intensity based on existing relationship context.
 *
 * @param {number} baseIntensity - The raw intensity from the pattern match
 * @param {string} categoryKey - The event category (e.g., 'physical_contact')
 * @param {string} actor - The character performing the action
 * @param {string} target - The character receiving the action
 * @param {Object} relLookup - Relationship lookup map ("A->B" => relationship)
 * @returns {number} Adjusted intensity
 */
function amplifyIntensity(baseIntensity, categoryKey, actor, target, relLookup) {
  let intensity = baseIntensity;

  const actorToTarget = relLookup[`${actor}->${target}`];
  const targetToActor = relLookup[`${target}->${actor}`];

  // Aggression toward someone with high affinity = betrayal amplification
  if (categoryKey === 'verbal_aggression') {
    const affinity = actorToTarget?.affinity || 0;
    if (affinity >= 60) {
      intensity += 1; // Hurts more when a friend turns hostile
    }
  }

  // Dismissal toward a bond_exclusive partner = devastating
  if (categoryKey === 'dismissal') {
    if (actorToTarget?.bond_exclusive || targetToActor?.bond_exclusive) {
      intensity += 2;
    }
  }

  // Physical contact with someone who has an exclusive partner elsewhere
  // This generates jealousy potential for the partner (not processed here,
  // but the higher intensity signals it to downstream processors)
  if (categoryKey === 'physical_contact') {
    // Check if the target has an exclusive bond with someone OTHER than the actor
    for (const key of Object.keys(relLookup)) {
      const rel = relLookup[key];
      if (
        rel.character_name === target &&
        rel.target_name !== actor &&
        rel.bond_exclusive
      ) {
        intensity += 2; // Jealousy trigger potential
        break;
      }
    }
  }

  return intensity;
}


// --------------------------------------------
// UTILITY FUNCTIONS
// --------------------------------------------

/**
 * Check if an emote match is a false positive for the given category.
 */
function isFalsePositive(categoryKey, emoteContent) {
  const filters = FALSE_POSITIVE_FILTERS[categoryKey];
  if (!filters) return false;

  for (const filter of filters) {
    if (filter.test(emoteContent)) return true;
  }
  return false;
}

/**
 * Truncate a snippet to maxLen characters, ending at a word boundary.
 */
function truncateSnippet(text, maxLen) {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (cleaned.length <= maxLen) return cleaned;

  // Cut at last space before maxLen
  const truncated = cleaned.substring(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.6) {
    return truncated.substring(0, lastSpace) + '...';
  }
  return truncated + '...';
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}


// --------------------------------------------
// DATABASE LOGGING
// --------------------------------------------
// Batch-inserts detected events into the relationship_events table.
// This is the only function that touches the network.
// --------------------------------------------

/**
 * Log detected relationship events to Supabase.
 *
 * @param {Object[]} events - Array of detected events from scanResponse()
 * @param {string} characterName - The character who generated the response
 * @param {string} supabaseUrl - Supabase project URL
 * @param {string} supabaseKey - Supabase anon key
 * @returns {Object} { logged: number, errors: string[] }
 */
async function logRelationshipEvents(events, characterName, supabaseUrl, supabaseKey) {
  if (!events || events.length === 0) return { logged: 0, errors: [] };

  if (!supabaseUrl || !supabaseKey) {
    return { logged: 0, errors: ['Missing Supabase configuration'] };
  }

  // Map scanner events to database rows
  const rows = events.map(event => ({
    character_name: characterName,
    target_name: event.target,
    event_type: event.type,
    intensity: event.intensity,
    context: event.snippet,
    source: event.source || 'scanner',
    affinity_delta: 0,      // Consequence processor will calculate this later
    processed: false
  }));

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/relationship_events`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(rows)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { logged: 0, errors: [`Supabase insert failed (${response.status}): ${errorText}`] };
    }

    return { logged: rows.length, errors: [] };
  } catch (error) {
    return { logged: 0, errors: [`Network error: ${error.message}`] };
  }
}


// --------------------------------------------
// EXPORTS
// --------------------------------------------

module.exports = {
  scanResponse,
  logRelationshipEvents,
  DETECTION_PATTERNS,

  // Exported for testing
  _internal: {
    findTarget,
    amplifyIntensity,
    isFalsePositive,
    truncateSnippet,
    escapeRegex
  }
};
