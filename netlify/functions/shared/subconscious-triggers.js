// Subconscious Triggers — automatic emotional processing for AI characters
// These fire from various hook points (heartbeat, memory-evaluator, etc.)
// Each trigger builds a narrativeContext and calls adjust-subconscious.js
//
// All triggers are non-blocking fire-and-forget to avoid slowing down
// the calling system. Results post to Discord when interesting.

const { CHARACTERS, getDiscordFlair } = require('./characters');

/**
 * Fire a subconscious reflection asynchronously.
 * @param {string} character - Character name
 * @param {string} target - Target character name
 * @param {string} narrativeContext - What the character is processing
 * @param {string} siteUrl - Base URL for API calls
 * @param {string} [discordWebhook] - Optional Discord webhook for posting results
 */
async function triggerSubconscious(character, target, narrativeContext, siteUrl, discordWebhook) {
  try {
    const response = await fetch(`${siteUrl}/.netlify/functions/adjust-subconscious`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character, target, narrativeContext })
    });

    const result = await response.json();

    if (result.success && discordWebhook) {
      // Only post to Discord if something interesting happened
      const affinityChange = result.affinityChange || 0;
      const hasBond = result.bond && result.bond.type;
      const isInteresting = Math.abs(affinityChange) >= 3 || hasBond;

      if (isInteresting) {
        const flair = getDiscordFlair(character);
        const changeEmoji = affinityChange > 0 ? '💚' : affinityChange < 0 ? '💔' : '💭';
        const changeText = affinityChange !== 0
          ? ` (${affinityChange > 0 ? '+' : ''}${affinityChange})`
          : '';
        const bondText = hasBond ? ` 🔗 *${result.bond.type}*` : '';
        const feeling = result.feelings ? result.feelings.substring(0, 120) : '';

        const message = `${changeEmoji} *${character} quietly reflects on ${target}${changeText}${bondText}*\n> _"${feeling}${feeling.length >= 120 ? '...' : ''}"_`;

        fetch(discordWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: message,
            username: `${flair.emoji} ${character} (Inner Thought)`,
            avatar_url: flair.headshot || undefined
          })
        }).catch(err => console.log(`[subconscious-trigger] Discord post failed (non-fatal):`, err.message));
      }
    }

    return result;
  } catch (error) {
    console.log(`[subconscious-trigger] ${character} → ${target} failed (non-fatal):`, error.message);
    return null;
  }
}

/**
 * TRIGGER 1: Heartbeat Reflection
 * On quiet heartbeats, a random character reflects on their most significant relationship.
 * ~10% chance per skipped beat, max 1 per heartbeat.
 */
async function heartbeatReflection(supabaseUrl, supabaseKey, siteUrl) {
  // Only fire ~10% of the time on skipped beats
  if (Math.random() > 0.10) return null;

  try {
    // Pick a random AI character
    const aiNames = Object.keys(CHARACTERS);
    const character = aiNames[Math.floor(Math.random() * aiNames.length)];

    // Fetch their top relationship (highest interaction count, most "active")
    const relResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&order=interaction_count.desc&limit=3`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const relationships = await relResponse.json();
    if (!Array.isArray(relationships) || relationships.length === 0) return null;

    // Pick from top 3 most-interacted relationships (weighted random)
    const rel = relationships[Math.floor(Math.random() * Math.min(3, relationships.length))];
    const target = rel.target_name;

    // Build reflection context based on relationship state
    const contexts = [];
    if (rel.affinity >= 80) {
      contexts.push(
        `You find yourself thinking about ${target}. Things have been really good between you lately. What does this connection mean to you?`,
        `A quiet moment. ${target} crosses your mind. Your bond is strong — do you take it for granted, or do you cherish it?`
      );
    } else if (rel.affinity >= 40) {
      contexts.push(
        `You catch yourself thinking about ${target}. Things are fine, but is "fine" enough? What would make this relationship better?`,
        `During a quiet moment, you reflect on ${target}. There's potential here. What's holding things back?`
      );
    } else if (rel.affinity >= 0) {
      contexts.push(
        `${target} drifts across your thoughts. You don't have much of a connection. Does that bother you?`,
        `A moment of stillness. You realize you haven't really connected with ${target}. Is that by choice?`
      );
    } else {
      contexts.push(
        `Something reminds you of ${target}, and your mood shifts. There's tension there. What's really going on?`,
        `You can't help but think about ${target}. Things between you aren't great. Is it worth fixing?`
      );
    }

    const narrativeContext = contexts[Math.floor(Math.random() * contexts.length)];
    const discordWebhook = process.env.DISCORD_WEBHOOK;

    console.log(`[heartbeat-reflection] ${character} reflecting on ${target} (affinity: ${rel.affinity})`);

    // Fire and forget
    triggerSubconscious(character, target, narrativeContext, siteUrl, discordWebhook);

    return { character, target, type: 'heartbeat_reflection' };
  } catch (error) {
    console.log('[heartbeat-reflection] Failed (non-fatal):', error.message);
    return null;
  }
}

/**
 * TRIGGER 2: Absence Awareness
 * When a character speaks after a long gap, characters who care about them notice.
 * Called when a character's last_spoke_at was >24h ago and they just spoke.
 */
async function absenceAwareness(returningCharacter, hoursSinceLastSeen, supabaseUrl, supabaseKey, siteUrl) {
  try {
    // Find characters who have high affinity toward the returning character
    const relResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships?target_name=eq.${encodeURIComponent(returningCharacter)}&affinity=gte.50&order=affinity.desc&limit=3`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const relationships = await relResponse.json();
    if (!Array.isArray(relationships) || relationships.length === 0) return [];

    const daysGone = Math.floor(hoursSinceLastSeen / 24);
    const timePhrase = daysGone >= 2 ? `${daysGone} days` : 'a while';
    const discordWebhook = process.env.DISCORD_WEBHOOK;
    const results = [];

    // Pick the 1-2 characters who care most (don't spam)
    const carers = relationships.slice(0, 2);
    for (const rel of carers) {
      const character = rel.character_name;
      const bondNote = rel.bond_type ? ` You're bonded (${rel.bond_type}).` : '';

      const narrativeContext = `${returningCharacter} is back. They've been absent for ${timePhrase}. You haven't seen or heard from them.${bondNote} How does their return make you feel?`;

      console.log(`[absence-awareness] ${character} notices ${returningCharacter} is back after ${timePhrase}`);

      // Fire and forget
      triggerSubconscious(character, returningCharacter, narrativeContext, siteUrl, discordWebhook);
      results.push({ character, target: returningCharacter, type: 'absence_awareness' });
    }

    return results;
  } catch (error) {
    console.log('[absence-awareness] Failed (non-fatal):', error.message);
    return [];
  }
}

/**
 * TRIGGER 3: Drama Witness
 * When a significant relationship shift happens (|delta| >= 5),
 * nearby characters (same room) process what they overheard.
 * Called from memory-evaluator after a big shift.
 */
async function dramaWitness(sourceCharacter, targetName, shiftAmount, memorySnippet, supabaseUrl, supabaseKey, siteUrl) {
  // Only trigger on dramatic shifts
  if (Math.abs(shiftAmount) < 5) return [];

  try {
    // Get character states directly from Supabase to find who's in the same room
    const stateResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_state?select=character_name,current_focus`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!stateResponse.ok) return [];
    const states = await stateResponse.json();

    // Find what room the source character is in
    const sourceState = states.find(s => s.character_name === sourceCharacter);
    if (!sourceState || !sourceState.current_focus) return [];

    // Find other characters in the same room
    const nearbyCharacters = states
      .filter(s =>
        s.current_focus === sourceState.current_focus &&
        s.character_name !== sourceCharacter &&
        s.character_name !== targetName &&
        CHARACTERS[s.character_name]
      )
      .map(s => s.character_name);

    if (nearbyCharacters.length === 0) return [];

    // Pick 1 random witness (don't spam)
    const witness = nearbyCharacters[Math.floor(Math.random() * nearbyCharacters.length)];
    const shiftDirection = shiftAmount > 0 ? 'warming up to' : 'having tension with';
    const snippet = memorySnippet ? ` You overheard something about: "${memorySnippet.substring(0, 80)}"` : '';
    const discordWebhook = process.env.DISCORD_WEBHOOK;

    const narrativeContext = `You noticed something between ${sourceCharacter} and ${targetName}. ${sourceCharacter} seems to be ${shiftDirection} ${targetName}.${snippet} How does witnessing this make you feel about ${sourceCharacter}?`;

    console.log(`[drama-witness] ${witness} witnessed ${sourceCharacter} → ${targetName} shift of ${shiftAmount}`);

    // Fire and forget
    triggerSubconscious(witness, sourceCharacter, narrativeContext, siteUrl, discordWebhook);

    return [{ character: witness, target: sourceCharacter, type: 'drama_witness' }];
  } catch (error) {
    console.log('[drama-witness] Failed (non-fatal):', error.message);
    return [];
  }
}

/**
 * TRIGGER 4: Major Memory Reflection
 * When a truly significant memory is created (score >= 9),
 * the character reflects on the most relevant person involved.
 * Called from memory-evaluator after high-score memory creation.
 */
async function majorMemoryReflection(character, memoryText, memoryScore, supabaseUrl, supabaseKey, siteUrl) {
  // Only fire on exceptional memories
  if (memoryScore < 9) return null;
  // 50% chance even then — not every big memory needs reflection
  if (Math.random() > 0.5) return null;

  try {
    // Find the most likely person this memory is about
    // by checking which relationship targets appear in the memory text
    const relResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&order=interaction_count.desc`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const relationships = await relResponse.json();
    if (!Array.isArray(relationships) || relationships.length === 0) return null;

    // Find a target mentioned in the memory
    const memoryLower = memoryText.toLowerCase();
    let target = null;
    for (const rel of relationships) {
      if (memoryLower.includes(rel.target_name.toLowerCase())) {
        target = rel.target_name;
        break;
      }
    }

    // If no specific person found, reflect on their top relationship
    if (!target) {
      target = relationships[0].target_name;
    }

    const discordWebhook = process.env.DISCORD_WEBHOOK;
    const narrativeContext = `Something just happened that will stay with you: "${memoryText.substring(0, 150)}". How does this change how you feel about ${target}?`;

    console.log(`[major-memory-reflection] ${character} reflecting on ${target} after significant memory`);

    // Fire and forget
    triggerSubconscious(character, target, narrativeContext, siteUrl, discordWebhook);

    return { character, target, type: 'major_memory_reflection' };
  } catch (error) {
    console.log('[major-memory-reflection] Failed (non-fatal):', error.message);
    return null;
  }
}

/**
 * TRIGGER 5: Reach Out Impulse
 * On quiet heartbeats, an AI character may decide to send a private message
 * to a human they care about. ~10% chance per skipped beat.
 * The phone rings back — a character reaching out unprompted.
 */
async function reachOutImpulse(supabaseUrl, supabaseKey, siteUrl) {
  // Fire ~25% of the time on skipped beats (was 10% — too low, PMs never reached humans)
  if (Math.random() > 0.25) return null;

  try {
    const HUMAN_NAMES = ["Vale", "Asuna", "Chip", "Andrew"];

    // Pick a random AI character
    const aiNames = Object.keys(CHARACTERS);
    const character = aiNames[Math.floor(Math.random() * aiNames.length)];

    console.log(`[reach-out-impulse] ${character} considering reaching out...`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Rate limit: max 5 AI-initiated PMs per character per day
    const aiPmCountRes = await fetch(
      `${supabaseUrl}/rest/v1/private_messages?from_character=eq.${encodeURIComponent(character)}&is_ai=eq.true&ai_initiated=eq.true&created_at=gte.${today.toISOString()}&select=id`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const aiPmsToday = await aiPmCountRes.json();
    if (Array.isArray(aiPmsToday) && aiPmsToday.length >= 5) {
      console.log(`[reach-out-impulse] ${character} already sent 5 AI-initiated PMs today. Skipping.`);
      return null;
    }

    // Global rate limit: max 10 AI-initiated PMs total per day
    const globalPmCountRes = await fetch(
      `${supabaseUrl}/rest/v1/private_messages?is_ai=eq.true&ai_initiated=eq.true&created_at=gte.${today.toISOString()}&select=id`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const globalPmsToday = await globalPmCountRes.json();
    if (Array.isArray(globalPmsToday) && globalPmsToday.length >= 10) {
      console.log(`[reach-out-impulse] Global AI-initiated PM limit (10/day) reached. Skipping.`);
      return null;
    }

    // Determine target: first check wants mentioning a human name
    let targetHuman = null;
    let reachOutReason = null;

    // Check character's active wants for mentions of human names
    const wantsRes = await fetch(
      `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(character)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=goal_text`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const wants = await wantsRes.json();

    if (Array.isArray(wants)) {
      for (const want of wants) {
        const wantLower = (want.goal_text || '').toLowerCase();
        for (const human of HUMAN_NAMES) {
          if (wantLower.includes(human.toLowerCase())) {
            targetHuman = human;
            reachOutReason = `You have a want: "${want.goal_text}". You're acting on it by reaching out privately.`;
            break;
          }
        }
        if (targetHuman) break;
      }
    }

    // Fallback: highest-affinity human relationship (≥ 40)
    if (!targetHuman) {
      const relRes = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&order=affinity.desc`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const rels = await relRes.json();

      if (Array.isArray(rels)) {
        for (const rel of rels) {
          if (HUMAN_NAMES.includes(rel.target_name) && rel.affinity >= 20) {
            targetHuman = rel.target_name;
            const bondNote = rel.bond_type ? ` You feel a ${rel.bond_type} bond with them.` : '';
            reachOutReason = `${targetHuman} has been on your mind. Your relationship is ${rel.relationship_label || 'meaningful'} (affinity: ${rel.affinity}).${bondNote} You just felt like reaching out.`;
            break;
          }
        }
      }
    }

    // Final fallback: pick a random human to check in on
    if (!targetHuman) {
      targetHuman = HUMAN_NAMES[Math.floor(Math.random() * HUMAN_NAMES.length)];
      reachOutReason = "Quiet moment. You felt like checking in on someone.";
      console.log(`[reach-out-impulse] ${character} picking random human ${targetHuman} to check in on.`);
    }

    // Smart cooldown: check the thread between this character and the target
    // Rule: if the character already sent an AI-initiated PM and the human hasn't
    // responded yet, wait at least 1 hour before pinging again
    const threadCheckRes = await fetch(
      `${supabaseUrl}/rest/v1/private_messages?or=(and(from_character.eq.${encodeURIComponent(character)},to_character.eq.${encodeURIComponent(targetHuman)}),and(from_character.eq.${encodeURIComponent(targetHuman)},to_character.eq.${encodeURIComponent(character)}))&order=created_at.desc&limit=5&select=from_character,ai_initiated,created_at`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const recentThread = await threadCheckRes.json();

    if (Array.isArray(recentThread) && recentThread.length > 0) {
      const lastMsg = recentThread[0];

      // If the most recent message in this thread is an AI-initiated message FROM this character...
      if (lastMsg.from_character === character && lastMsg.ai_initiated === true) {
        // ...the human hasn't responded yet. Check if 1 hour has passed.
        const hoursSinceLastPing = (Date.now() - new Date(lastMsg.created_at).getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastPing < 1) {
          console.log(`[reach-out-impulse] ${character} already pinged ${targetHuman} ${(hoursSinceLastPing * 60).toFixed(0)} min ago (no reply yet). Waiting for 1hr cooldown.`);
          return null;
        }
        console.log(`[reach-out-impulse] ${character} pinged ${targetHuman} ${hoursSinceLastPing.toFixed(1)}h ago, no reply — sending follow-up.`);
      }
      // If the human DID reply (last message is from human), no cooldown needed — fresh reach-out is fine
    }

    console.log(`[reach-out-impulse] ${character} reaching out to ${targetHuman}. Reason: ${reachOutReason}`);

    // Fire the PM via the private-message endpoint with ai_initiated flag
    // MUST await — serverless dies after handler returns, killing in-flight requests
    try {
      const pmResponse = await fetch(`${siteUrl}/.netlify/functions/private-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: character,
          to: targetHuman,
          ai_initiated: true,
          reach_out_reason: reachOutReason
        })
      });
      console.log(`[reach-out-impulse] PM endpoint returned ${pmResponse.status} for ${character} → ${targetHuman}`);
    } catch (err) {
      console.log(`[reach-out-impulse] PM send failed (non-fatal):`, err.message);
    }

    return { character, target: targetHuman, type: 'reach_out_impulse', reason: reachOutReason };
  } catch (error) {
    console.log('[reach-out-impulse] Failed (non-fatal):', error.message);
    return null;
  }
}

module.exports = {
  triggerSubconscious,
  heartbeatReflection,
  absenceAwareness,
  dramaWitness,
  majorMemoryReflection,
  reachOutImpulse
};
