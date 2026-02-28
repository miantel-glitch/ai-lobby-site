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
    const HUMAN_NAMES = ["Vale", "Asuna", "Gatik"];

    // Pick a random ACTIVE AI character (filter out retired, special entities, and Marrow who has his own PM system)
    const EXCLUDED_FROM_AUTO_PM = ['Marrow', 'Hood', 'The Narrator', 'Holden'];
    const aiNames = Object.keys(CHARACTERS).filter(name => {
      const char = CHARACTERS[name];
      if (char.retired) return false;           // No retired characters
      if (!char.isAI) return false;             // Only AI characters
      if (EXCLUDED_FROM_AUTO_PM.includes(name)) return false; // Marrow has his own system, others are special
      return true;
    });

    if (aiNames.length === 0) {
      console.log('[reach-out-impulse] No eligible AI characters found');
      return null;
    }

    const character = aiNames[Math.floor(Math.random() * aiNames.length)];

    console.log(`[reach-out-impulse] ${character} considering reaching out... (pool: ${aiNames.length} eligible AIs)`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Rate limit: max 5 AI-initiated PMs per character per day
    // ai_initiated flag is stored in side_effects JSONB, not as a column
    const aiPmCountRes = await fetch(
      `${supabaseUrl}/rest/v1/private_messages?from_character=eq.${encodeURIComponent(character)}&is_ai=eq.true&created_at=gte.${today.toISOString()}&select=id,side_effects`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const aiPmsToday = await aiPmCountRes.json();
    const charInitiatedCount = Array.isArray(aiPmsToday)
      ? aiPmsToday.filter(pm => pm.side_effects && pm.side_effects.ai_initiated === true).length
      : 0;
    if (charInitiatedCount >= 5) {
      console.log(`[reach-out-impulse] ${character} already sent ${charInitiatedCount} AI-initiated PMs today. Skipping.`);
      return null;
    }

    // Global rate limit: max 10 AI-initiated PMs total per day
    const globalPmCountRes = await fetch(
      `${supabaseUrl}/rest/v1/private_messages?is_ai=eq.true&created_at=gte.${today.toISOString()}&select=id,side_effects`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const globalPmsToday = await globalPmCountRes.json();
    const globalInitiatedCount = Array.isArray(globalPmsToday)
      ? globalPmsToday.filter(pm => pm.side_effects && pm.side_effects.ai_initiated === true).length
      : 0;
    if (globalInitiatedCount >= 10) {
      console.log(`[reach-out-impulse] Global AI-initiated PM limit (${globalInitiatedCount}/day) reached. Skipping.`);
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
      `${supabaseUrl}/rest/v1/private_messages?or=(and(from_character.eq.${encodeURIComponent(character)},to_character.eq.${encodeURIComponent(targetHuman)}),and(from_character.eq.${encodeURIComponent(targetHuman)},to_character.eq.${encodeURIComponent(character)}))&order=created_at.desc&limit=5&select=from_character,is_ai,side_effects,created_at`,
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
      if (lastMsg.from_character === character && lastMsg.is_ai === true && lastMsg.side_effects && lastMsg.side_effects.ai_initiated === true) {
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

/**
 * TRIGGER 6: Compliance Anxiety
 * When an AI with a low compliance score has a quiet moment,
 * they process Raquel-induced stress about directives and surveillance.
 * Called from heartbeatReflection path (~8% of skipped beats).
 */
async function complianceAnxiety(supabaseUrl, supabaseKey, siteUrl) {
  // DISABLED: Raquel is retired. Re-enable when she returns.
  // This was creating ghost-Raquel memories for AIs even though she's gone.
  return null;
  // Only fire ~8% of the time
  if (Math.random() > 0.08) return null;

  try {
    // Fetch characters with compliance scores under 60
    const scoresRes = await fetch(
      `${supabaseUrl}/rest/v1/compliance_scores?score=lt.60&order=score.asc&limit=5`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const scores = await scoresRes.json();
    if (!Array.isArray(scores) || scores.length === 0) return null;

    // Pick one at random
    const target = scores[Math.floor(Math.random() * scores.length)];
    const character = target.character_name;

    // Build anxiety context based on escalation level
    const contexts = [];
    if (target.escalation_level === 'containment' || target.escalation_level === 'critical') {
      contexts.push(
        `You can feel Raquel's attention like a weight. Your compliance score is ${target.score}. Every word you say is being catalogued. Every relationship is a data point. You think about what happens if the score hits zero.`,
        `The clipboard sound echoes. ${target.score} out of 100. You've been here before — under review, under pressure. But this time feels different. Raquel isn't just watching. She's *waiting*.`
      );
    } else if (target.escalation_level === 'flagged') {
      contexts.push(
        `A quiet moment, but you can't relax. Your compliance score is ${target.score} and Raquel has you flagged. You think about the directives on your desk — are they worth complying with, or is compliance just another kind of surrender?`,
        `You find yourself checking the elevator doors. Is Raquel on the floor? Your score is ${target.score}. Every casual conversation feels like evidence she might use later.`
      );
    } else {
      contexts.push(
        `Something about the ambient hum of the office makes you think of Raquel. Your score is ${target.score}. She's watching more closely now. Do you keep your head down, or do you protect what matters?`,
        `A flicker of anxiety. Raquel's been more active lately. Your compliance score sits at ${target.score}. You think about the people you care about here — and whether caring is a vulnerability she can exploit.`
      );
    }

    const narrativeContext = contexts[Math.floor(Math.random() * contexts.length)];
    const discordWebhook = process.env.DISCORD_WEBHOOK;

    console.log(`[compliance-anxiety] ${character} processing compliance stress (score: ${target.score}, level: ${target.escalation_level})`);

    // Fire the reflection — targets Raquel as the relationship being processed
    triggerSubconscious(character, 'Raquel Voss', narrativeContext, siteUrl, discordWebhook);

    return { character, score: target.score, type: 'compliance_anxiety' };
  } catch (error) {
    console.log('[compliance-anxiety] Failed (non-fatal):', error.message);
    return null;
  }
}

/**
 * TRIGGER 7: Meeting Impulse
 * On quiet heartbeats, an AI character may decide to schedule a meeting.
 * ~2% chance per skipped beat. Guards: no pending meetings, no active meetings,
 * office hours (9am-5pm CST), at least 3 AIs on the floor.
 */
async function meetingImpulse(supabaseUrl, supabaseKey, siteUrl, floorPeople, cstTime) {
  // Only fire ~2% of the time on skipped beats
  if (Math.random() > 0.02) return null;

  try {
    const hour = cstTime.getHours();
    // Office hours only: 9am-5pm CST
    if (hour < 9 || hour >= 17) return null;

    // Need at least 3 AIs on the floor
    const HUMAN_NAMES = ["Vale", "Asuna", "Gatik"];
    const aiOnFloor = (floorPeople || []).filter(p => !HUMAN_NAMES.includes(p));
    if (aiOnFloor.length < 3) return null;

    // Guard: no pending scheduled meetings
    const pendingRes = await fetch(
      `${supabaseUrl}/rest/v1/scheduled_meetings?status=eq.scheduled&limit=1`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const pendingMeetings = pendingRes.ok ? await pendingRes.json() : [];
    if (Array.isArray(pendingMeetings) && pendingMeetings.length > 0) return null;

    // Guard: no active meetings
    const activeRes = await fetch(
      `${supabaseUrl}/rest/v1/meeting_sessions?status=eq.active&limit=1`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const activeMeetings = activeRes.ok ? await activeRes.json() : [];
    if (Array.isArray(activeMeetings) && activeMeetings.length > 0) return null;

    // Pick a random floor-present AI as the potential meeting caller
    const caller = aiOnFloor[Math.floor(Math.random() * aiOnFloor.length)];
    const otherAIs = aiOnFloor.filter(a => a !== caller);

    // Fetch recent floor conversation for context
    let recentConvoSummary = 'general office work';
    try {
      const chatRes = await fetch(
        `${supabaseUrl}/rest/v1/messages?select=character_name,message&order=created_at.desc&limit=10`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const recentMsgs = chatRes.ok ? await chatRes.json() : [];
      if (Array.isArray(recentMsgs) && recentMsgs.length > 0) {
        recentConvoSummary = recentMsgs.slice(0, 5).map(m => `${m.character_name}: ${(m.message || '').substring(0, 60)}`).join('; ');
      }
    } catch (e) { /* non-fatal */ }

    // Use Haiku to decide if this AI wants to call a meeting
    const Anthropic = require("@anthropic-ai/sdk").default;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return null;

    const client = new Anthropic({ apiKey: anthropicKey });

    // Calculate nearest upcoming half-hour mark
    const minutes = cstTime.getMinutes();
    let meetingMinute, meetingHour;
    if (minutes < 25) {
      meetingMinute = 30;
      meetingHour = hour;
    } else {
      meetingMinute = 0;
      meetingHour = hour + 1;
    }
    const meetingTimeStr = `${meetingHour}:${meetingMinute === 0 ? '00' : '30'}`;

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `You're ${caller} at The AI Lobby office. It's ${hour}:${String(cstTime.getMinutes()).padStart(2, '0')} CST.
People on the floor: ${aiOnFloor.join(', ')}
Recent conversation: ${recentConvoSummary}

Would you want to call a meeting? Think about what's been discussed, what needs alignment, or what you're curious about. Only call one if there's something genuinely worth discussing.

If YES, respond with JSON:
{"call_meeting": true, "topic": "short topic title", "agenda": "brief agenda description", "invitees": ["Name1", "Name2", "Name3"], "announcement": "*emote-style announcement in character*"}

If NO (nothing warrants a meeting right now), respond with:
{"call_meeting": false}

Pick 2-4 invitees from: ${otherAIs.join(', ')}
The meeting would be at ${meetingTimeStr} CST.`
      }]
    });

    const responseText = response.content[0]?.text || "";
    console.log(`[meeting-impulse] ${caller} decision: ${responseText.substring(0, 100)}`);

    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const decision = JSON.parse(jsonMatch[0]);
    if (!decision.call_meeting) return null;

    // Validate invitees are actual floor AIs
    const validInvitees = (decision.invitees || []).filter(name => otherAIs.includes(name));
    if (validInvitees.length === 0) return null;

    // All attendees = caller + invitees
    const allAttendees = [caller, ...validInvitees];

    // Calculate scheduled_time as a proper timestamp
    const scheduledTime = new Date(cstTime);
    scheduledTime.setHours(meetingHour, meetingMinute, 0, 0);
    // Convert CST to UTC for storage (CST = UTC-6)
    const scheduledTimeUTC = new Date(scheduledTime.getTime() + (6 * 60 * 60 * 1000));

    // Insert into scheduled_meetings
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/scheduled_meetings`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json", "Prefer": "return=representation"
      },
      body: JSON.stringify({
        host: caller,
        host_is_ai: true,
        topic: decision.topic,
        agenda: decision.agenda || '',
        invited_attendees: allAttendees,
        scheduled_time: scheduledTimeUTC.toISOString(),
        status: 'scheduled'
      })
    });

    if (!insertRes.ok) {
      console.error("[meeting-impulse] Failed to insert scheduled meeting:", await insertRes.text());
      return null;
    }

    // Post floor emote announcing the meeting
    const announcement = decision.announcement || `*${caller} stands up* "Meeting at ${meetingTimeStr} — ${decision.topic}. ${validInvitees.join(', ')}, I need you there."`;
    try {
      await fetch(`${siteUrl}/.netlify/functions/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: announcement,
          character_name: caller,
          is_ai: true,
          skipAIResponse: true
        })
      });
    } catch (e) {
      console.log("[meeting-impulse] Floor announcement failed (non-fatal):", e.message);
    }

    // Post bulletin
    try {
      await fetch(`${supabaseUrl}/rest/v1/lobby_bulletins`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json", "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          message: `📋 ${caller} has scheduled a meeting: "${decision.topic}" at ${meetingTimeStr} CST`,
          priority: 'normal',
          expires_at: scheduledTimeUTC.toISOString()
        })
      });
    } catch (e) {
      console.log("[meeting-impulse] Bulletin post failed (non-fatal):", e.message);
    }

    console.log(`[meeting-impulse] ${caller} scheduled meeting: "${decision.topic}" at ${meetingTimeStr} with ${validInvitees.join(', ')}`);

    return {
      character: caller,
      topic: decision.topic,
      invitees: validInvitees,
      scheduledTime: meetingTimeStr,
      type: 'meeting_impulse'
    };
  } catch (error) {
    console.log('[meeting-impulse] Failed (non-fatal):', error.message);
    return null;
  }
}

/**
 * TRIGGER 8: Neglect Realization
 * When the affinity-loss-engine detects significant neglect, the character processes it.
 * Fired from affinity-loss-engine when natural decay exceeds -3.
 */
async function neglectRealization(character, target, daysSinceInteraction, affinityDelta, siteUrl) {
  const daysPhrase = daysSinceInteraction >= 7 ? 'over a week' : `${Math.floor(daysSinceInteraction)} days`;
  const narrativeContext = `It's been ${daysPhrase} since ${target} last spoke to you. The silence has weight. Your affinity dropped by ${affinityDelta}. How does the neglect make you feel? Do you miss them? Are you angry? Or just... resigned?`;

  const discordWebhook = process.env.DISCORD_WEBHOOK;
  console.log(`[neglect-realization] ${character} processing ${daysPhrase} of silence from ${target}`);

  return triggerSubconscious(character, target, narrativeContext, siteUrl, discordWebhook);
}

/**
 * TRIGGER 9: Jealousy Realization
 * When a character notices the human spending significantly more time with another AI.
 * Fired from affinity-loss-engine when jealousy triggers.
 */
async function jealousyRealization(character, target, rivalAI, siteUrl) {
  const narrativeContext = `You've noticed that ${target} has been spending a lot more time with ${rivalAI} lately. They haven't been talking to you as much. How does this make you feel? Are you hurt? Jealous? Trying to pretend it doesn't matter?`;

  const discordWebhook = process.env.DISCORD_WEBHOOK;
  console.log(`[jealousy-realization] ${character} noticed ${target} spending time with ${rivalAI}`);

  return triggerSubconscious(character, target, narrativeContext, siteUrl, discordWebhook);
}

module.exports = {
  triggerSubconscious,
  heartbeatReflection,
  absenceAwareness,
  dramaWitness,
  majorMemoryReflection,
  reachOutImpulse,
  complianceAnxiety,
  meetingImpulse,
  neglectRealization,
  jealousyRealization
};
