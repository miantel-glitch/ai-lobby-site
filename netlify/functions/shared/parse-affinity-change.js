// Parse AFFINITY_CHANGE tags from AI responses
// Tags look like: [AFFINITY_CHANGE: CharacterName +3 shared a vulnerable moment]
// or: [AFFINITY_CHANGE: Steele -5 disrespected my relationship with Asuna]
//
// Returns parsed changes AND the cleaned response text with tags stripped.

const AFFINITY_CHANGE_REGEX = /\[AFFINITY_CHANGE:\s*([A-Za-z\s\-Ω]+?)\s+([+-]\d+)\s+(.*?)\]/g;

// Per-interaction cap: no single response can shift more than ±5
const PER_INTERACTION_CAP = 5;

/**
 * Parse AFFINITY_CHANGE tags from AI response text
 * @param {string} responseText - The raw AI response
 * @param {string} characterName - The character who wrote this response
 * @returns {{ cleanedText: string, changes: Array<{ target: string, delta: number, reason: string }> }}
 */
function parseAffinityChanges(responseText, characterName) {
  if (!responseText) return { cleanedText: '', changes: [] };

  const changes = [];
  let match;

  // Reset regex lastIndex for safety
  AFFINITY_CHANGE_REGEX.lastIndex = 0;

  while ((match = AFFINITY_CHANGE_REGEX.exec(responseText)) !== null) {
    const target = match[1].trim();
    const delta = parseInt(match[2], 10);
    const reason = match[3].trim();

    // Validate
    if (isNaN(delta) || delta === 0) continue;
    if (target.toLowerCase() === characterName.toLowerCase()) continue; // Can't change affinity with yourself

    // Cap at ±5
    const cappedDelta = Math.max(-PER_INTERACTION_CAP, Math.min(PER_INTERACTION_CAP, delta));

    changes.push({
      target,
      delta: cappedDelta,
      reason
    });
  }

  // Strip all AFFINITY_CHANGE tags from the visible response
  const cleanedText = responseText.replace(AFFINITY_CHANGE_REGEX, '').replace(/\s{2,}/g, ' ').trim();

  return { cleanedText, changes };
}

/**
 * Apply parsed affinity changes to the database
 * Fire-and-forget — errors are logged but don't block the response
 *
 * @param {string} characterName - The character whose feelings changed
 * @param {Array<{ target: string, delta: number, reason: string }>} changes
 * @param {string} supabaseUrl
 * @param {string} supabaseKey
 */
async function applyAffinityChanges(characterName, changes, supabaseUrl, supabaseKey) {
  if (!changes || changes.length === 0) return;

  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  for (const change of changes) {
    try {
      // 1. Fetch current relationship
      const relRes = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(characterName)}&target_name=eq.${encodeURIComponent(change.target)}&select=affinity,seed_affinity,relationship_label`,
        { headers }
      );

      if (!relRes.ok) {
        console.log(`[affinity-change] Failed to fetch relationship ${characterName}→${change.target}: ${relRes.status}`);
        continue;
      }

      const rels = await relRes.json();
      if (!rels || rels.length === 0) {
        console.log(`[affinity-change] No relationship found: ${characterName}→${change.target}`);
        continue;
      }

      const rel = rels[0];
      const oldAffinity = rel.affinity;
      // Clamp to -100..100
      const newAffinity = Math.max(-100, Math.min(100, oldAffinity + change.delta));

      if (newAffinity === oldAffinity) continue;

      // 2. Update relationship
      await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(characterName)}&target_name=eq.${encodeURIComponent(change.target)}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            affinity: newAffinity,
            updated_at: new Date().toISOString()
          })
        }
      );

      // 3. Log to relationship_events
      try {
        await fetch(
          `${supabaseUrl}/rest/v1/relationship_events`,
          {
            method: 'POST',
            headers: { ...headers, "Prefer": "return=minimal" },
            body: JSON.stringify({
              character_name: characterName,
              target_name: change.target,
              event_type: 'affinity_change',
              intensity: Math.abs(change.delta),
              context: `${characterName} ${change.delta > 0 ? 'warmed toward' : 'cooled toward'} ${change.target}: ${change.reason}`,
              source: 'ai_response',
              affinity_delta: change.delta,
              processed: false
            })
          }
        );
      } catch (e) {
        // Table might not exist yet — non-fatal
        console.log(`[affinity-change] Failed to log event (non-fatal):`, e.message);
      }

      // 4. Log to relationship_history
      await fetch(
        `${supabaseUrl}/rest/v1/relationship_history`,
        {
          method: 'POST',
          headers: { ...headers, "Prefer": "return=minimal" },
          body: JSON.stringify({
            character_name: characterName,
            target_name: change.target,
            old_affinity: oldAffinity,
            new_affinity: newAffinity,
            trigger_memory: `affinity_change: ${change.reason} (${change.delta > 0 ? '+' : ''}${change.delta})`
          })
        }
      );

      console.log(`[affinity-change] ${characterName}→${change.target}: ${oldAffinity} → ${newAffinity} (${change.delta > 0 ? '+' : ''}${change.delta}) — ${change.reason}`);

    } catch (err) {
      console.log(`[affinity-change] Error applying ${characterName}→${change.target} (non-fatal):`, err.message);
    }
  }
}

module.exports = {
  parseAffinityChanges,
  applyAffinityChanges,
  AFFINITY_CHANGE_REGEX,
  PER_INTERACTION_CAP
};
