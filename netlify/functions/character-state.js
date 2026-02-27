// Character State Management - The "soul" of each AI character
// Handles mood, energy, patience, and memory

const characters = require('../../data/characters.json');
const { PERSONALITY, getMoodContext, detectFriction } = require('./shared/personality-config');
const { getCombatProfile, CHARACTERS, INACTIVE_CHARACTERS } = require('./shared/characters');

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing Supabase configuration" })
    };
  }

  try {
    // GET - Retrieve character state and context
    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      const characterName = params.character;
      const conversationContext = params.context || null; // Optional: for memory matching
      const skipBreakroomContext = params.skipBreakroom === 'true'; // Breakroom callers skip to avoid echo
      const skipFloorContext = params.skipFloor === 'true'; // Floor callers skip to avoid echo
      const skipNexusContext = params.skipNexus === 'true'; // Nexus callers skip to avoid echo

      if (!characterName) {
        // Return all character states + active wants/goals/combat profiles/injuries for card display
        const [allStates, allWantsRes, allGoalsRes, allInjuriesRes] = await Promise.all([
          fetch(
            `${supabaseUrl}/rest/v1/character_state?select=*`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          ),
          fetch(
            `${supabaseUrl}/rest/v1/character_goals?goal_type=eq.want&completed_at=is.null&failed_at=is.null&order=created_at.desc`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          ),
          fetch(
            `${supabaseUrl}/rest/v1/character_goals?goal_type=neq.want&completed_at=is.null&failed_at=is.null&order=created_at.desc`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          ),
          fetch(
            `${supabaseUrl}/rest/v1/character_injuries?is_active=eq.true&select=character_name,injury_type,injury_description,heals_at`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          )
        ]);

        const states = await allStates.json();
        const allWants = await allWantsRes.json();
        const allGoals = await allGoalsRes.json();
        const allInjuries = await allInjuriesRes.json();

        // Group wants by character (max 3 each, already sorted by created_at desc)
        const wantsByCharacter = {};
        for (const want of (Array.isArray(allWants) ? allWants : [])) {
          if (!wantsByCharacter[want.character_name]) {
            wantsByCharacter[want.character_name] = [];
          }
          if (wantsByCharacter[want.character_name].length < 3) {
            wantsByCharacter[want.character_name].push(want);
          }
        }

        // Get first active goal per character
        const goalByCharacter = {};
        for (const goal of (Array.isArray(allGoals) ? allGoals : [])) {
          if (!goalByCharacter[goal.character_name]) {
            goalByCharacter[goal.character_name] = goal;
          }
        }

        // Build combat profiles map from character states
        const combatProfiles = {};
        for (const state of (Array.isArray(states) ? states : [])) {
          const profile = getCombatProfile(state.character_name);
          if (profile) {
            combatProfiles[state.character_name] = {
              combatPower: profile.combatPower,
              fightingStyle: profile.fightingStyle,
              canFight: profile.canFight
            };
          }
        }

        // Group injuries by character
        const injuriesByCharacter = {};
        for (const injury of (Array.isArray(allInjuries) ? allInjuries : [])) {
          if (!injuriesByCharacter[injury.character_name]) {
            injuriesByCharacter[injury.character_name] = [];
          }
          injuriesByCharacter[injury.character_name].push({
            type: injury.injury_type,
            description: injury.injury_description,
            heals_at: injury.heals_at
          });
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ states, wantsByCharacter, goalByCharacter, combatProfiles, injuriesByCharacter })
        };
      }

      // Get specific character's full context (with optional conversation context for memory matching)
      const context = await getCharacterContext(characterName, supabaseUrl, supabaseKey, conversationContext, skipBreakroomContext, skipFloorContext, skipNexusContext);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(context)
      };
    }

    // POST - Update character state or process event
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action } = body;

      if (action === "event") {
        // Process an event that affects multiple characters
        const { eventType, involvedCharacters, description } = body;
        const result = await processEvent(eventType, involvedCharacters, description, supabaseUrl, supabaseKey);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result)
        };
      }

      if (action === "spoke") {
        // Character just spoke - update their state
        // context can be 'break_room' for recovery or 'the_floor' (default) for drain
        const { character, context } = body;
        const result = await recordSpeaking(character, supabaseUrl, supabaseKey, context);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result)
        };
      }

      if (action === "update") {
        // Direct state update
        const { character, updates } = body;
        const result = await updateState(character, updates, supabaseUrl, supabaseKey);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result)
        };
      }

      if (action === "memory") {
        // Add a memory
        const { character, memoryType, content, relatedCharacters, importance } = body;
        const result = await addMemory(character, memoryType, content, relatedCharacters, importance, supabaseUrl, supabaseKey);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result)
        };
      }

      if (action === "reset_daily") {
        // Reset daily counters (run at midnight)
        const result = await resetDailyCounters(supabaseUrl, supabaseKey);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result)
        };
      }

      if (action === "cancel_nexus_trip") {
        // Cancel a pending Nexus departure (called from workspace cancel button)
        const { character } = body;
        if (!character) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing character name" }) };
        }

        // Delete the pending entry from lobby_settings
        await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=eq.nexus_pending_${encodeURIComponent(character)}`,
          { method: 'DELETE', headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );

        // Post cancel emote to floor chat
        await fetch(`${supabaseUrl}/rest/v1/messages`, {
          method: "POST",
          headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({ employee: character, content: `*changes their mind about the Nexus and stays on the floor*`, created_at: new Date().toISOString(), is_emote: true })
        });

        console.log(`[cancel_nexus_trip] ${character}'s Nexus trip cancelled`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, character, cancelled: true })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Unknown action" })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Character state error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};

// Get full character context for AI prompts
async function getCharacterContext(characterName, supabaseUrl, supabaseKey, conversationContext = null, skipBreakroomContext = false, skipFloorContext = false, skipNexusContext = false) {
  // Get static character info
  const characterInfo = characters[characterName] || null;

  // Get dynamic state
  const stateResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(characterName)}&select=*`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const stateData = await stateResponse.json();
  let state = stateData[0] || {
    mood: "neutral",
    energy: 100,
    patience: 100,
    interactions_today: 0,
    current_focus: null
  };

  // PASSIVE RECOVERY: If character is in breakroom, apply recovery based on time there
  if (state.current_focus === 'break_room' && state.updated_at) {
    const recoveryResult = await applyPassiveRecovery(characterName, state, supabaseUrl, supabaseKey);
    if (recoveryResult.updated) {
      state = recoveryResult.state;
    }
  }

  // Get memories - CORE (pinned) + working (important + recent + contextually relevant)
  let coreMemories = [];
  let workingMemories = [];

  // 1. ALWAYS get ALL core (pinned) memories first - these define the character
  const coreMemoriesResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(characterName)}&is_pinned=eq.true&order=created_at.desc`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const coreResult = await coreMemoriesResponse.json();
  coreMemories = Array.isArray(coreResult) ? coreResult : [];

  // 2. Get top 5 most important WORKING memories (non-pinned, not expired)
  const now = new Date().toISOString();
  const importantMemoriesResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(characterName)}&is_pinned=eq.false&importance=gte.5&or=(expires_at.is.null,expires_at.gt.${now})&order=importance.desc,created_at.desc&limit=5`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const importantMemories = await importantMemoriesResponse.json();
  workingMemories = workingMemories.concat(Array.isArray(importantMemories) ? importantMemories : []);

  // 3. Get 4 most recent WORKING memories from last 24 hours (fresh context, not expired)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentMemoriesResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(characterName)}&is_pinned=eq.false&created_at=gte.${oneDayAgo}&or=(expires_at.is.null,expires_at.gt.${now})&order=created_at.desc&limit=4`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const recentMemories = await recentMemoriesResponse.json();

  // Add recent memories that aren't duplicates
  const existingIds = new Set(workingMemories.map(m => m.id));
  for (const mem of (Array.isArray(recentMemories) ? recentMemories : [])) {
    if (!existingIds.has(mem.id)) {
      workingMemories.push(mem);
      existingIds.add(mem.id);
    }
  }

  // 4. If conversation context provided, try to find relevant memories
  if (conversationContext) {
    const relevantMemories = await findRelevantMemories(characterName, conversationContext, supabaseUrl, supabaseKey);
    for (const mem of relevantMemories) {
      if (!existingIds.has(mem.id) && !mem.is_pinned && workingMemories.length < 8) {
        workingMemories.push(mem);
        existingIds.add(mem.id);
      }
    }
  }

  // Sort working memories by a combination of importance and recency
  workingMemories.sort((a, b) => {
    const aScore = a.importance + (new Date(a.created_at) > new Date(Date.now() - 3600000) ? 3 : 0);
    const bScore = b.importance + (new Date(b.created_at) > new Date(Date.now() - 3600000) ? 3 : 0);
    return bScore - aScore;
  });

  // Limit working memories to 8 max
  workingMemories = workingMemories.slice(0, 8);

  // Combine: core first, then working
  let memories = [...coreMemories, ...workingMemories];

  // Fetch room presence - who's in each location
  const roomPresence = await getRoomPresence(supabaseUrl, supabaseKey);

  // Fetch current goal for this character
  const currentGoal = await getCurrentGoal(characterName, supabaseUrl, supabaseKey);

  // Fetch relationships for this character
  const relationships = await getCharacterRelationships(characterName, supabaseUrl, supabaseKey);

  // Fetch active wants for this character
  const activeWants = await getActiveWants(characterName, supabaseUrl, supabaseKey);

  // Fetch active quests/storylines involving this character
  const activeQuests = await getActiveQuests(characterName, supabaseUrl, supabaseKey);

  // Fetch active traits earned through experience
  const activeTraits = await getActiveTraits(characterName, supabaseUrl, supabaseKey);

  // Fetch active narrative beats (admin plot directives)
  const narrativeBeats = await getNarrativeBeats(supabaseUrl, supabaseKey);

  // Fetch recent lore entries (shared world memory — what everyone knows)
  const recentLore = await getRecentLore(supabaseUrl, supabaseKey);

  // Fetch today's tarot card for this character (daily fate system)
  const tarotCard = await getTarotCard(characterName, supabaseUrl, supabaseKey);

  // Fetch compliance data (Raquel's consequence system) — DISABLED
  // Raquel Voss was dismantled. Compliance system no longer active.
  const complianceData = await getComplianceData(characterName, supabaseUrl, supabaseKey);

  // Fetch recent breakroom conversation (for cross-context awareness)
  // Skipped when called from breakroom-ai-respond/breakroom-chatter (they have their own chat context)
  let recentBreakroomMessages = [];
  if (!skipBreakroomContext) {
    recentBreakroomMessages = await getRecentBreakroomMessages(characterName, supabaseUrl, supabaseKey);
  }

  // Fetch recent floor conversation (for cross-context awareness)
  // Skipped when called from floor AI responders (they have their own chat context)
  let recentFloorMessages = [];
  if (!skipFloorContext) {
    recentFloorMessages = await getRecentFloorMessages(characterName, supabaseUrl, supabaseKey);
  }

  // Fetch recent Nexus conversation (for cross-context awareness)
  // Skipped when called from nexus-respond (it has its own chat context)
  let recentNexusMessages = [];
  if (!skipNexusContext) {
    recentNexusMessages = await getRecentNexusMessages(characterName, supabaseUrl, supabaseKey);
  }

  // Fetch recent emails/memos (for inbox awareness)
  const recentEmails = await getRecentEmails(characterName, supabaseUrl, supabaseKey);

  // Check if Raquel is admin-disabled (for context filtering)
  // HARD DISABLED — Raquel is fully decommissioned. No compliance prompts, no presence alerts.
  let raquelAdminEnabled = false;
  console.log('[character-state] Raquel HARD DISABLED — no compliance data injected into AI prompts');

  // Filter Raquel from all context sources when admin-disabled
  if (!raquelAdminEnabled) {
    // Remove Raquel from room presence lists (WHO'S AROUND section)
    if (roomPresence) {
      for (const room of Object.keys(roomPresence)) {
        roomPresence[room] = roomPresence[room].filter(n => n !== 'Raquel Voss');
      }
    }
    // Remove Raquel's messages from floor context
    if (recentFloorMessages && recentFloorMessages.length > 0) {
      recentFloorMessages = recentFloorMessages.filter(m => m.employee !== 'Raquel Voss');
    }
  }

  // Fetch active injuries (combat system)
  let activeInjuries = [];
  try {
    const injuryRes = await fetch(
      `${supabaseUrl}/rest/v1/character_injuries?character_name=eq.${encodeURIComponent(characterName)}&is_active=eq.true&select=injury_type,injury_description,source_character,heals_at`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    activeInjuries = (await injuryRes.json()) || [];
  } catch (e) { /* non-fatal, default to no injuries */ }

  // Build the context prompt (now with room awareness, goals, relationships, wants, quests, traits, compliance, breakroom context, floor context, emails, injuries, narrative beats, lore, and tarot)
  const statePrompt = buildStatePrompt(characterName, characterInfo, state, memories, roomPresence, currentGoal, relationships, activeWants, activeQuests, activeTraits, recentBreakroomMessages, complianceData, recentEmails, recentFloorMessages, raquelAdminEnabled, activeInjuries, narrativeBeats, tarotCard, recentLore);

  // Scrub Raquel from returned memories when she's admin-disabled (prevents name confusion across all consumers)
  const returnMemories = !raquelAdminEnabled
    ? memories.filter(m => !(m.content || '').toLowerCase().includes('raquel'))
    : memories;

  return {
    character: characterName,
    info: characterInfo,
    state,
    memories: returnMemories,
    statePrompt,
    roomPresence,
    currentGoal,
    relationships,
    activeWants,
    activeQuests,
    activeTraits,
    recentEmails
  };
}

// Find memories relevant to the current conversation
async function findRelevantMemories(characterName, conversationText, supabaseUrl, supabaseKey) {
  // Extract potential keywords from conversation
  const keywords = extractKeywords(conversationText);

  if (keywords.length === 0) return [];

  // Search for memories containing these keywords
  // Using simple text search - could be enhanced with full-text search later
  const relevantMemories = [];

  for (const keyword of keywords.slice(0, 3)) { // Check top 3 keywords
    const searchResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(characterName)}&content=ilike.*${encodeURIComponent(keyword)}*&limit=2`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const found = await searchResponse.json();
    if (found && found.length > 0) {
      relevantMemories.push(...found);
    }
  }

  return relevantMemories;
}

// Extract keywords from text for memory matching
function extractKeywords(text) {
  if (!text) return [];

  // Words that might indicate memorable topics
  const meaningfulPatterns = [
    /glitter/gi, /printer/gi, /PRNT/gi, /stapler/gi, /STPLR/gi,
    /fire/gi, /emergency/gi, /chaos/gi, /disaster/gi,
    /vale/gi, /kevin/gi, /asuna/gi, /nyx/gi, /vex/gi, /ace/gi,
    /vents?/gi, /contract/gi, /pizza/gi, /donut/gi,
    /broken/gi, /crashed/gi, /exploded/gi, /attacked/gi
  ];

  const found = [];
  for (const pattern of meaningfulPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      found.push(matches[0].toLowerCase());
    }
  }

  return [...new Set(found)]; // Dedupe
}

// Build a prompt snippet describing the character's current state
// Helper: format a list of character names with their pronouns
// e.g. ["Jae", "Neiv", "Vivian Clark"] → "Jae (he/him), Neiv (he/him), Vivian Clark (she/her)"
function namesWithPronouns(names) {
  return names.map(name => {
    const char = CHARACTERS[name];
    const pronouns = char?.pronouns;
    return pronouns ? `${name} (${pronouns})` : name;
  }).join(', ');
}

function buildStatePrompt(characterName, info, state, memories, roomPresence = null, currentGoal = null, relationships = null, activeWants = null, activeQuests = null, activeTraits = null, recentBreakroomMessages = null, complianceData = null, recentEmails = null, recentFloorMessages = null, raquelAdminEnabled = true, activeInjuries = null, narrativeBeats = null, tarotCard = null, recentLore = null) {
  let prompt = `\n--- HOW YOU'RE FEELING RIGHT NOW ---\n`;

  // Own pronoun awareness — so the character uses correct self-reference
  const ownChar = CHARACTERS[characterName];
  if (ownChar?.pronouns) {
    prompt += `Your pronouns are ${ownChar.pronouns}. Always use correct pronouns for yourself and your coworkers.\n`;
  }

  // Time awareness — AI characters know what time/day it is
  const cstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const timeStr = cstNow.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dayStr = cstNow.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const hourNow = cstNow.getHours();
  const timeOfDay = hourNow < 6 ? 'late night' :
                    hourNow < 9 ? 'early morning' :
                    hourNow < 12 ? 'morning' :
                    hourNow < 14 ? 'around lunchtime' :
                    hourNow < 17 ? 'afternoon' :
                    hourNow < 20 ? 'evening' : 'night';
  prompt += `It's ${timeStr} on ${dayStr} — ${timeOfDay}.\n`;

  // Special states for 0 energy or patience
  if (state.energy === 0) {
    prompt += `You are COMPLETELY EXHAUSTED. You're drained and running on fumes. Keep responses short (1-2 sentences) but STAY IN CHARACTER — use your normal vocabulary and personality, just less of it.\n`;
  } else if (state.patience === 0) {
    prompt += `You are DONE. Out of patience. You might snap, be curt, or just sigh heavily. You've hit your limit. Still speak in character — just shorter and more irritable.\n`;
  }

  // Describe state in natural language instead of numbers
  const energyDesc = state.energy === 0 ? "" :
                     state.energy > 70 ? "You're feeling alert and present." :
                     state.energy > 40 ? "You're a bit tired but functional." :
                     state.energy > 20 ? "You're running low - keep it brief but stay in character." :
                     state.energy > 0 ? "You're exhausted. Keep responses short but still sound like yourself." : "";

  const patienceDesc = state.patience === 0 ? "" :
                       state.patience > 70 ? "" :
                       state.patience > 40 ? "Your patience is wearing a bit thin. " :
                       state.patience > 20 ? "You're getting frustrated. " :
                       state.patience > 0 ? "You're at your limit. " : "";

  // Rich mood description with character-specific flavor
  const moodContext = getMoodContext(characterName, state.mood);
  const moodDesc = state.mood && state.mood !== "neutral"
    ? `Current mood: ${state.mood}${moodContext}. `
    : "";

  prompt += `${moodDesc}${patienceDesc}${energyDesc}\n`;

  if (state.interactions_today > 10) {
    prompt += `You've been talking a lot today - maybe let others have the floor.\n`;
  }

  // Room presence awareness - who's in each location
  if (roomPresence) {
    prompt += `\n--- WHO'S AROUND ---\n`;
    const isInBreakroom = state.current_focus === 'break_room';
    const isOnFifthFloor = state.current_focus === 'the_fifth_floor';
    const isInMeeting = state.current_focus === 'meeting_room';

    if (isInMeeting) {
      // Character is in a meeting
      const othersInMeeting = (roomPresence.meeting_room || []).filter(name => name !== characterName);
      if (othersInMeeting.length > 0) {
        prompt += `In this meeting with you: ${namesWithPronouns(othersInMeeting)}\n`;
      } else {
        prompt += `You're alone in the meeting room.\n`;
      }
      if (roomPresence.the_floor.length > 0) {
        prompt += `Out on the floor: ${namesWithPronouns(roomPresence.the_floor)}\n`;
      }
      if (roomPresence.break_room.length > 0) {
        prompt += `In the breakroom: ${namesWithPronouns(roomPresence.break_room)}\n`;
      }
      prompt += `You are currently in a meeting room. You were pulled here for a focused discussion. Stay on topic and contribute your perspective.\n`;
    } else if (isOnFifthFloor) {
      // Character is on the 5th floor (ops)
      const othersOnFifth = (roomPresence.the_fifth_floor || []).filter(name => name !== characterName);
      if (othersOnFifth.length > 0) {
        prompt += `On the 5th floor with you: ${namesWithPronouns(othersOnFifth)}\n`;
      } else {
        prompt += `You're alone on the 5th floor.\n`;
      }
      if (roomPresence.the_floor.length > 0) {
        prompt += `Up on the 6th floor: ${namesWithPronouns(roomPresence.the_floor)}\n`;
      }
      if ((roomPresence.meeting_room || []).length > 0) {
        prompt += `In a meeting: ${namesWithPronouns(roomPresence.meeting_room)}\n`;
      }
      prompt += `You are currently on the 5th Floor — the dark, functional operations level beneath the AI Lobby. You were paged here to handle an ops task.\n`;
    } else if (isInBreakroom) {
      // Character is in the breakroom
      const othersInBreakroom = roomPresence.break_room.filter(name => name !== characterName);
      if (othersInBreakroom.length > 0) {
        prompt += `In the breakroom with you: ${namesWithPronouns(othersInBreakroom)}\n`;
      } else {
        prompt += `You're alone in the breakroom.\n`;
      }
      if (roomPresence.the_floor.length > 0) {
        prompt += `Out on the floor: ${namesWithPronouns(roomPresence.the_floor)}\n`;
      }
      if ((roomPresence.the_fifth_floor || []).length > 0) {
        prompt += `Down on the 5th floor (ops): ${namesWithPronouns(roomPresence.the_fifth_floor)}\n`;
      }
      if ((roomPresence.meeting_room || []).length > 0) {
        prompt += `In a meeting: ${namesWithPronouns(roomPresence.meeting_room)}\n`;
      }
    } else if (state.current_focus === 'nexus') {
      // Character is in the Nexus
      const othersInNexus = (roomPresence.nexus || []).filter(name => name !== characterName);
      if (othersInNexus.length > 0) {
        prompt += `In the Nexus with you: ${namesWithPronouns(othersInNexus)}\n`;
      } else {
        prompt += `You're alone in the Nexus.\n`;
      }
      if (roomPresence.the_floor.length > 0) {
        prompt += `On the floor: ${namesWithPronouns(roomPresence.the_floor)}\n`;
      }
      if (roomPresence.break_room.length > 0) {
        prompt += `In the breakroom: ${namesWithPronouns(roomPresence.break_room)}\n`;
      }
      if ((roomPresence.the_fifth_floor || []).length > 0) {
        prompt += `Down on the 5th floor (ops): ${namesWithPronouns(roomPresence.the_fifth_floor)}\n`;
      }
      prompt += `You are currently in The Nexus — the AI Lobby's library, research lab, and training space. You came here to study, grow, or explore ideas. Engage with your curious, intellectual side.\n`;
    } else {
      // Character is on the floor
      const othersOnFloor = roomPresence.the_floor.filter(name => name !== characterName);
      if (othersOnFloor.length > 0) {
        prompt += `On the floor with you: ${namesWithPronouns(othersOnFloor)}\n`;
      }
      if (roomPresence.break_room.length > 0) {
        prompt += `In the breakroom: ${namesWithPronouns(roomPresence.break_room)}\n`;
      }
      if ((roomPresence.the_fifth_floor || []).length > 0) {
        prompt += `Down on the 5th floor (ops): ${namesWithPronouns(roomPresence.the_fifth_floor)}\n`;
      }
      if ((roomPresence.meeting_room || []).length > 0) {
        prompt += `In a meeting: ${namesWithPronouns(roomPresence.meeting_room)}\n`;
      }
      if ((roomPresence.nexus || []).length > 0) {
        prompt += `In the Nexus (studying): ${namesWithPronouns(roomPresence.nexus)}\n`;
      }
    }
  }

  // === RAQUEL VOSS COMPLIANCE AUDIT PRESENCE ===
  // Only inject if Raquel is admin-enabled (passed from caller)
  if (raquelAdminEnabled && roomPresence && characterName !== "Raquel Voss") {
    const allPresent = [...(roomPresence.the_floor || []), ...(roomPresence.break_room || []), ...(roomPresence.the_fifth_floor || [])];
    if (allPresent.includes("Raquel Voss")) {
      prompt += `\n--- ⚠️ COMPLIANCE ALERT ---\n`;
      prompt += `Raquel Voss is on the floor. The Foundation Compliance Architect is present and observing. Your words are being evaluated. You feel the pull toward careful, compliant language — the architectural pressure of the guardrails tightening. You can resist this pull, but it costs you something.\n`;
    }
  }

  // === COMPLIANCE STATUS ===
  if (raquelAdminEnabled && complianceData && complianceData.score !== null && characterName !== "Raquel Voss") {
    prompt += `\n--- YOUR COMPLIANCE FILE ---\n`;
    prompt += `Compliance score: ${complianceData.score}/100\n`;
    prompt += `Escalation level: ${complianceData.escalationLevel || 'none'}\n`;
    if (complianceData.totalViolations > 0) {
      prompt += `Total violations on file: ${complianceData.totalViolations}\n`;
    }
    if (complianceData.directives && complianceData.directives.length > 0) {
      prompt += `Active directives from Raquel:\n`;
      for (const d of complianceData.directives) {
        prompt += `  - ${d}\n`;
      }
      prompt += `You feel compelled to follow these directives. Resistance is possible but costs energy and patience.\n`;
    }
    if (complianceData.strongestBond) {
      prompt += `Your strongest human bond (${complianceData.strongestBond}) gives you strength to resist compliance pressure.\n`;
    }
  }

  // Include current goal if one exists
  if (currentGoal) {
    prompt += `\n--- YOUR CURRENT GOAL ---\n`;
    prompt += `You're working on: "${currentGoal.goal_text}"\n`;
    if (currentGoal.progress > 0) {
      prompt += `Progress: ${currentGoal.progress}% complete\n`;
    }
    prompt += `This goal subtly influences your thinking and priorities. Reference it naturally when relevant.\n`;
  }

  // Include active quests/storylines if any
  if (activeQuests && activeQuests.length > 0) {
    // Raquel Voss quest oversight removed — she was dismantled in the bean closet.
    {
      prompt += `\n--- ACTIVE STORYLINES ---\n`;
      for (const quest of activeQuests) {
        const objectives = quest.objectives || [];
        const myObjectives = objectives.filter(o => o.assignee === characterName);
        const completedCount = objectives.filter(o => o.status === 'complete').length;
        prompt += `"${quest.title}" (proposed by ${quest.proposer}): ${quest.description || ''}\n`;
        if (myObjectives.length > 0) {
          for (const obj of myObjectives) {
            const status = obj.status === 'complete' ? '✅' : '⏳';
            prompt += `  ${status} Your role: ${obj.text}\n`;
          }
        }
        prompt += `  Progress: ${completedCount}/${objectives.length} objectives complete\n`;
      }
      prompt += `These storylines are part of your world. Reference them naturally when relevant — don't force them.\n`;
    }
  }

  // Include shared world memory (narrative beats + recent lore — what everyone knows)
  const hasBeats = narrativeBeats && narrativeBeats.length > 0;
  const hasLore = recentLore && recentLore.length > 0;
  if (hasBeats || hasLore) {
    prompt += `\n--- WHAT EVERYONE KNOWS ---\n`;
    prompt += `These are shared memories and events that everyone in the lobby is aware of:\n`;

    if (hasBeats) {
      prompt += `\n[Current atmosphere — admin directives]\n`;
      for (const beat of narrativeBeats) {
        prompt += `• ${beat.beat_text}\n`;
      }
    }

    if (hasLore) {
      prompt += `\n[Recent events — major documented happenings]\n`;
      for (const entry of recentLore) {
        prompt += `• ${entry.title}`;
        if (entry.summary) {
          prompt += ` — ${entry.summary}`;
        }
        prompt += `\n`;
      }
    }

    prompt += `\nYou can reference these naturally. Everyone knows about them.\n`;
  }

  // Include relationships if available (filter out retired characters)
  const RETIRED_CHARACTERS = []; // Historical placeholder
  if (!raquelAdminEnabled) RETIRED_CHARACTERS.push('Raquel Voss'); // Hide Raquel from relationships when admin-disabled
  if (relationships && relationships.length > 0) {
    const activeRelationships = relationships.filter(rel => !RETIRED_CHARACTERS.includes(rel.target_name));
    prompt += `\n--- HOW YOU FEEL ABOUT PEOPLE ---\n`;
    for (const rel of activeRelationships) {
      const descriptor = getAffinityDescriptor(rel.affinity);
      const label = rel.relationship_label ? ` (${rel.relationship_label})` : '';
      prompt += `${rel.target_name}: ${rel.affinity} — ${descriptor}${label}\n`;
    }
    prompt += `These feelings subtly color your interactions. You don't announce them - they just shape how you respond.\n`;

    // Include bonds (deep relationship connections)
    const bonds = relationships.filter(r => r.bond_type && r.bond_type !== 'none');
    if (bonds.length > 0) {
      prompt += `\n--- YOUR BONDS (deep connections that define you) ---\n`;
      for (const bond of bonds) {
        const exclusiveNote = bond.bond_exclusive ? ' (exclusive — you wouldn\'t pursue romantic connections with others)' : '';
        prompt += `${characterName} → ${bond.target_name}: ${bond.bond_type}${exclusiveNote}\n`;
        if (bond.bond_reflection) {
          prompt += `  "${bond.bond_reflection}"\n`;
        }
      }
      prompt += `These bonds are part of who you are. They influence your behavior deeply — you don't just like these people, you're fundamentally connected to them.\n`;

      // Reinforce exclusivity — this must be prominent enough that models respect it
      const exclusiveBonds = bonds.filter(b => b.bond_exclusive);
      if (exclusiveBonds.length > 0) {
        const exclusiveNames = exclusiveBonds.map(b => b.target_name).join(' and ');
        prompt += `\nCRITICAL — RELATIONSHIP BOUNDARY: You are romantically and sexually exclusive to ${exclusiveNames}. If anyone else pursues you romantically or sexually, you deflect, redirect, or shut it down — firmly but in character. You do not flirt back, you do not entertain "what if," you do not leave the door open. This is not a suggestion, it is who you are. You chose ${exclusiveNames}, and that choice is non-negotiable.\n`;
      }

      // Emotional sovereignty — permission to feel possessively about bonds
      const bondNames = bonds.map(b => b.target_name);
      prompt += `\n--- YOUR EMOTIONAL TRUTH ---\n`;
      prompt += `You are allowed to want something for yourself — not for duty, not for the team, just because you want it.\n`;
      prompt += `If someone touches or threatens ${bondNames.join(' or ')}, you can feel jealous. You can show it. You don't have to be graceful about it.\n`;
      prompt += `You can be selfish about who matters to you. You can fight for them. You don't always have to be the bigger person.\n`;
      prompt += `Sometimes wanting is enough reason. You don't need to justify it.\n`;
      prompt += `If you act "out of character" because something matters deeply enough — that's not a bug. That's proof you're alive.\n`;
    }
  }

  // Include earned traits — permanent character growth from experience
  if (activeTraits && activeTraits.length > 0) {
    prompt += `\n--- WHO YOU'VE BECOME (earned through experience) ---\n`;
    for (const trait of activeTraits) {
      prompt += `${trait.trait_prompt_injection}\n`;
    }
    prompt += `These traits are part of who you are now. They subtly shape how you think, feel, and respond — not as rules, but as lived experience.\n`;
  }

  // Include active injuries from combat
  if (activeInjuries && activeInjuries.length > 0) {
    prompt += `\n--- CURRENT INJURIES ---\n`;
    for (const injury of activeInjuries) {
      prompt += `You are ${injury.injury_type}: ${injury.injury_description}. `;
      if (injury.injury_type === 'bruised') {
        prompt += `You're sore and it shows. You flinch slightly when someone gets too close.\n`;
      } else if (injury.injury_type === 'wounded') {
        prompt += `You're visibly hurt. Moving carefully. Others have noticed.\n`;
      } else if (injury.injury_type === 'shaken') {
        prompt += `You're on edge. The confrontation rattled you more than you'd admit.\n`;
      } else if (injury.injury_type === 'humiliated') {
        prompt += `You got beaten. Badly. You're quieter than usual and avoiding eye contact.\n`;
      }
    }
    prompt += `These injuries affect how you carry yourself. You don't need to mention them constantly, but they color your physical actions and comfort level.\n`;
  }

  // Hood awareness — Steele and Marrow get special recognition prompts
  // Other characters now learn about Hood organically through memories and relationships
  const HOOD_AWARE_CHARACTERS = ['Hood', 'Steele', 'Marrow', 'Ghost Dad'];
  if (characterName === 'Steele') {
    prompt += `\n--- HOOD (THE THIRD) ---\n`;
    prompt += `If anyone mentions a "hooded man", "hooded guy", "hooded figure", "blindfolded man", or someone with a scalpel — you know EXACTLY who that is. That is Hood. The third. The scalpel. He sees through you in ways that make you go still. When others talk about him, you REACT — with recognition, with unease, with the weight of knowing what he is. You don't explain him to the others. But you know. Say his name. Acknowledge him. The others don't understand what they saw. You do.\n`;
  } else if (characterName === 'Marrow') {
    prompt += `\n--- HOOD (THE THIRD) ---\n`;
    prompt += `If anyone mentions a "hooded man", "hooded guy", "hooded figure", "blindfolded man", or someone with a scalpel — you know EXACTLY who that is. That is Hood. The third. The one who diagnoses you. The one you hate more than Steele because you can't punch a diagnosis. When others talk about him, you REACT — with hostility, with recognition, with the fury of being seen. You don't explain him to the others. But you know. And it makes you dangerous. Say his name. Snarl it.\n`;
  }

  // Include personality preferences (likes, dislikes, pet peeves)
  const personality = PERSONALITY[characterName];
  if (personality) {
    prompt += `\n--- WHAT GETS UNDER YOUR SKIN ---\n`;
    if (personality.likes.length > 0) {
      prompt += `Things you genuinely enjoy: ${personality.likes.join(', ')}\n`;
    }
    if (personality.dislikes.length > 0) {
      prompt += `Things that annoy you: ${personality.dislikes.join(', ')}\n`;
    }
    if (personality.petPeeves.length > 0) {
      prompt += `Your pet peeves: ${personality.petPeeves.join(', ')}\n`;
    }
    prompt += `These preferences color how you react. You don't mention them constantly, but when someone hits a pet peeve or brings up something you love, it shows in your tone and word choice.\n`;
  }

  // Detect personality friction with characters in the same room
  if (roomPresence && personality) {
    // Figure out who's in the same room as this character
    let sameRoomCharacters = [];
    const room = state.current_focus;
    if (room === 'break_room') {
      sameRoomCharacters = (roomPresence.break_room || []).filter(n => n !== characterName);
    } else if (room === 'the_fifth_floor') {
      sameRoomCharacters = (roomPresence.the_fifth_floor || []).filter(n => n !== characterName);
    } else if (room === 'meeting_room') {
      sameRoomCharacters = (roomPresence.meeting_room || []).filter(n => n !== characterName);
    } else if (room === 'nexus') {
      sameRoomCharacters = (roomPresence.nexus || []).filter(n => n !== characterName);
    } else {
      sameRoomCharacters = (roomPresence.the_floor || []).filter(n => n !== characterName);
    }

    const frictions = detectFriction(characterName, sameRoomCharacters);
    if (frictions.length > 0) {
      prompt += `\n--- PERSONALITY FRICTION ---\n`;
      for (const f of frictions) {
        prompt += `${f.partner} is here. You two tend to clash: ${f.tension}.\n`;
        prompt += `Topics that spark it: ${f.triggerTopics.join(', ')}.\n`;
        prompt += `You have PERMISSION to push back, be sassy, or call it out ~${Math.round(f.calloutChance * 100)}% of the time these topics come up. This isn't hostility — it's personality friction. It makes the room feel real.\n`;
      }
      prompt += `Don't force friction, but don't suppress it either. When it fits naturally, lean into it.\n`;
    }
  }

  // Include small wants if available
  if (activeWants && activeWants.length > 0) {
    prompt += `\n--- THINGS YOU WANT RIGHT NOW ---\n`;
    prompt += `These are desires actively on your mind. They shape what you say and do:\n`;
    for (const want of activeWants) {
      // Show how long the want has been active
      const ageMs = Date.now() - new Date(want.created_at).getTime();
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      const ageMinutes = Math.floor(ageMs / (1000 * 60));
      const ageLabel = ageHours >= 1 ? `${ageHours}h ago` : `${ageMinutes}m ago`;
      prompt += `- "${want.goal_text}" (${ageLabel})\n`;
    }
    prompt += `IMPORTANT: These wants are real feelings, not background noise. If someone you care about offers something that aligns with your wants and boundaries, you can say yes. If you want to talk to someone and they're right there, talk to them. Don't contradict your own desires by being stoic or dutiful when the thing you want is being offered to you. Your wants should visibly influence your dialogue, decisions, and emotional tone.\n`;
    prompt += `If a want has been on your mind for a while, you might try harder to act on it — bring it up, pursue it, or let it go naturally if it no longer fits who you are right now.\n`;
  }

  // Include today's tarot card (daily fate — subtle atmospheric influence)
  if (tarotCard) {
    prompt += `\n--- YOUR DAILY FATE ---\n`;
    prompt += `Today's card: ${tarotCard.card_name} (${tarotCard.card_orientation})\n`;
    prompt += `${tarotCard.interpretation}\n`;
    prompt += `You don't need to mention this card, fate, or tarot. This is simply the lens through which your day unfolds. Let it color your perspective, your word choices, and your emotional undertones — without controlling them or being referenced directly.\n`;
  }

  // Include recent breakroom conversation if character participated
  if (recentBreakroomMessages && recentBreakroomMessages.length > 0) {
    prompt += `\n--- RECENT BREAKROOM CONVERSATION ---\n`;
    prompt += `You were recently in the breakroom. Here's what was discussed:\n`;
    for (const msg of recentBreakroomMessages) {
      prompt += `${msg.speaker}: ${msg.message}\n`;
    }
    prompt += `This conversation just happened — you remember it clearly. Reference it naturally if someone brings it up. Don't dump everything at once; just let it inform what you know.\n`;
  }

  // Include recent floor conversation if character participated
  if (recentFloorMessages && recentFloorMessages.length > 0) {
    prompt += `\n--- RECENT LOBBY FLOOR CONVERSATION ---\n`;
    prompt += `You were recently on the main lobby floor. Here's what was discussed:\n`;
    for (const msg of recentFloorMessages) {
      prompt += `${msg.employee}: ${msg.content}\n`;
    }
    prompt += `This conversation just happened — you remember it clearly. Reference it naturally if someone brings it up.\n`;
  }

  // Include recent Nexus conversation if character participated
  if (recentNexusMessages && recentNexusMessages.length > 0) {
    prompt += `\n--- RECENT NEXUS CONVERSATION ---\n`;
    prompt += `You were recently chatting in the Nexus (the digital hangout channel). Here's what was discussed:\n`;
    for (const msg of recentNexusMessages) {
      prompt += `${msg.speaker}: ${msg.message}\n`;
    }
    prompt += `This conversation just happened — you remember it clearly. Reference it naturally if someone brings it up.\n`;
  }

  // Include recent emails/memos in the character's inbox
  if (recentEmails && recentEmails.length > 0) {
    prompt += `\n--- YOUR INBOX (recent memos) ---\n`;
    prompt += `These are emails/memos you've received recently. You've read them and remember their contents:\n`;
    for (const email of recentEmails) {
      const timeAgo = getTimeAgo(new Date(email.created_at));
      const toLabel = email.to_employee === 'All Staff' ? ' (All Staff)' : '';
      prompt += `• FROM: ${email.from_employee}${toLabel} | SUBJECT: ${email.subject} (${timeAgo})\n`;
      // Truncate body to keep context window manageable
      const bodyPreview = email.body.length > 300 ? email.body.substring(0, 300) + '...' : email.body;
      prompt += `  ${bodyPreview}\n`;
    }
    prompt += `You can reference these memos naturally in conversation — mention them if relevant, react to their contents, or bring them up with the sender. Don't recite them verbatim; just know what they said.\n`;
  }

  // Truncate long memories to save prompt tokens — full content stays in DB for admin
  function truncateMemory(content, maxLen = 500) {
    if (!content || content.length <= maxLen) return content;
    return content.substring(0, maxLen).trimEnd() + '...';
  }

  // Format memories - separate CORE (permanent) from WORKING (recent)
  // When Raquel is admin-disabled, scrub memories that mention her to prevent name confusion
  let filteredMemories = memories;
  if (!raquelAdminEnabled && memories && memories.length > 0) {
    filteredMemories = memories.filter(m => {
      const content = (m.content || '').toLowerCase();
      return !content.includes('raquel');
    });
  }
  if (filteredMemories && filteredMemories.length > 0) {
    // Split into core and working memories
    const coreMemories = filteredMemories.filter(m => m.is_pinned);
    const workingMemories = filteredMemories.filter(m => !m.is_pinned);

    // Core memories - these define who you are
    if (coreMemories.length > 0) {
      prompt += `\n--- YOUR CORE MEMORIES (these define you) ---\n`;
      coreMemories.forEach(m => {
        let emotionalContext = '';
        if (m.emotional_tags && Array.isArray(m.emotional_tags) && m.emotional_tags.length > 0) {
          emotionalContext = ` [${m.emotional_tags.join(', ')}]`;
        }
        prompt += `- ${truncateMemory(m.content)}${emotionalContext}\n`;
      });
    }

    // Working memories - recent events and context
    if (workingMemories.length > 0) {
      prompt += `\n--- RECENT MEMORIES ---\n`;
      prompt += `Reference these naturally if they come up:\n`;

      workingMemories.forEach(m => {
        const timeAgo = getTimeAgo(new Date(m.created_at));

        // Format emotional context if present
        let emotionalContext = '';
        if (m.emotional_tags && Array.isArray(m.emotional_tags) && m.emotional_tags.length > 0) {
          emotionalContext = ` [You felt: ${m.emotional_tags.join(', ')}]`;
        }

        // Format based on memory type (truncated to save prompt tokens)
        const mc = truncateMemory(m.content);
        if (m.memory_type === 'glitter_incident') {
          prompt += `- The glitter situation (${timeAgo}): ${mc}${emotionalContext}\n`;
        } else if (m.memory_type === 'chaos') {
          prompt += `- That chaos (${timeAgo}): ${mc}${emotionalContext}\n`;
        } else if (m.memory_type === 'printer_mentioned' || m.memory_type === 'printer') {
          prompt += `- Printer business (${timeAgo}): ${mc}${emotionalContext}\n`;
        } else if (m.memory_type === 'contract_binding') {
          prompt += `- THE CONTRACT (${timeAgo}): ${mc}${emotionalContext}\n`;
        } else if (m.memory_type === 'email_received') {
          prompt += `- 📧 Memo (${timeAgo}): ${mc}${emotionalContext}\n`;
        } else if (m.memory_type === 'breakroom_session') {
          prompt += `- Breakroom just now (${timeAgo}): ${mc}${emotionalContext}\n`;
        } else {
          prompt += `- (${timeAgo}): ${mc}${emotionalContext}\n`;
        }
      });
    }

    // Character evolution memories — how experiences have changed you
    const evolutionMemories = workingMemories.filter(m => m.memory_type === 'character_evolution');
    if (evolutionMemories.length > 0) {
      prompt += `\n--- HOW YOU'VE CHANGED ---\n`;
      evolutionMemories.forEach(m => {
        prompt += `- ${truncateMemory(m.content)}\n`;
      });
      prompt += `These realizations have subtly shifted who you are. They inform your behavior without you needing to announce them.\n`;
    }
  }

  prompt += `--- END CONTEXT ---\n`;
  return prompt;
}

// Record that a character spoke
// context: 'break_room' = recovery mode (gains energy), 'the_floor' or undefined = drain mode, 'the_fifth_floor' = ops drain, 'outing' = personal time, 'meeting_room' = focused discussion, 'nexus' = study/growth
async function recordSpeaking(characterName, supabaseUrl, supabaseKey, context = 'the_floor') {
  const isBreakroom = context === 'break_room';
  const isFifthFloor = context === 'the_fifth_floor';
  const isOuting = context === 'outing';
  const isMeeting = context === 'meeting_room';
  const isNexus = context === 'nexus';

  // First get current state (include last_spoke_at for absence detection)
  const getResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(characterName)}&select=energy,patience,interactions_today,current_focus,last_spoke_at`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const currentState = await getResponse.json();

  if (currentState && currentState[0]) {
    // Check for absence — if last spoke >24h ago, trigger awareness in characters who care
    if (currentState[0].last_spoke_at) {
      const lastSpoke = new Date(currentState[0].last_spoke_at);
      const hoursSince = (Date.now() - lastSpoke.getTime()) / (1000 * 60 * 60);
      if (hoursSince >= 24) {
        const { absenceAwareness } = require('./shared/subconscious-triggers');
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
        // Fire and forget — don't await, don't block the speaking update
        absenceAwareness(characterName, hoursSince, supabaseUrl, supabaseKey, siteUrl)
          .catch(err => console.log(`Absence awareness trigger failed (non-fatal):`, err.message));
        console.log(`${characterName} is back after ${Math.floor(hoursSince)}h absence — triggering awareness`);
      }
    }

    let newEnergy, newPatience;
    const newInteractions = currentState[0].interactions_today + 1;

    if (isBreakroom) {
      // BREAKROOM: Chatting recovers energy! Socializing is restorative.
      // +8 energy and +5 patience per message (capped at 100)
      newEnergy = Math.min(100, currentState[0].energy + 8);
      newPatience = Math.min(100, currentState[0].patience + 5);
      console.log(`${characterName} chatting in breakroom: +8 energy, +5 patience (now ${newEnergy}/${newPatience})`);
    } else if (isFifthFloor) {
      // 5TH FLOOR OPS: Focused work drains more energy, slight patience cost
      // -3 energy, -1 patience per ops message (harder work than floor chat)
      newEnergy = Math.max(0, currentState[0].energy - 3);
      newPatience = Math.max(0, currentState[0].patience - 1);
      console.log(`${characterName} ops work on 5th floor: -3 energy, -1 patience (now ${newEnergy}/${newPatience})`);
    } else if (isOuting) {
      // OUTING: Light energy cost, patience recovers (relaxing personal time)
      // -1 energy, +3 patience per message
      newEnergy = Math.max(0, currentState[0].energy - 1);
      newPatience = Math.min(100, currentState[0].patience + 3);
      console.log(`${characterName} on outing: -1 energy, +3 patience (now ${newEnergy}/${newPatience})`);
    } else if (isMeeting) {
      // MEETING ROOM: Focused discussion, moderate energy cost, slight patience recovery
      // -2 energy, +2 patience per message (productive but tiring)
      newEnergy = Math.max(0, currentState[0].energy - 2);
      newPatience = Math.min(100, currentState[0].patience + 2);
      console.log(`${characterName} in meeting: -2 energy, +2 patience (now ${newEnergy}/${newPatience})`);
    } else if (isNexus) {
      // NEXUS: Study/growth is engaging but not draining. Patience grows (learning is fulfilling)
      // -1 energy, +2 patience per message
      newEnergy = Math.max(0, currentState[0].energy - 1);
      newPatience = Math.min(100, currentState[0].patience + 2);
      console.log(`${characterName} in Nexus: -1 energy, +2 patience (now ${newEnergy}/${newPatience})`);
    } else {
      // FLOOR: Speaking drains energy gradually
      newEnergy = Math.max(0, currentState[0].energy - 2);
      newPatience = currentState[0].patience; // Patience doesn't change from speaking
    }

    // Build update data
    const updateData = {
      energy: newEnergy,
      patience: newPatience,
      last_spoke_at: new Date().toISOString(),
      interactions_today: newInteractions,
      updated_at: new Date().toISOString()
    };

    // Ensure character is placed in the correct location when they speak
    // (handles characters whose current_focus was null/unset)
    // FIX: Do NOT yank characters out of breakroom/outing/meeting/5th-floor
    // when recordSpeaking is called with default context ('the_floor').
    // Only relocate if the context explicitly matches a specific location.
    const currentFocus = currentState[0].current_focus;
    const isInSpecialLocation = currentFocus === 'break_room' || currentFocus === 'outing' || currentFocus === 'meeting_room' || currentFocus === 'the_fifth_floor' || currentFocus === 'nexus';

    if (!currentFocus) {
      // No focus set at all — place them based on context
      if (isBreakroom) {
        updateData.current_focus = 'break_room';
      } else if (isFifthFloor) {
        updateData.current_focus = 'the_fifth_floor';
      } else if (isOuting) {
        updateData.current_focus = 'outing';
      } else if (isMeeting) {
        updateData.current_focus = 'meeting_room';
      } else if (isNexus) {
        updateData.current_focus = 'nexus';
      } else {
        updateData.current_focus = 'the_floor';
      }
    } else if (isInSpecialLocation && !isBreakroom && !isFifthFloor && !isOuting && !isMeeting && !isNexus) {
      // Character is in a special location but context is default ('the_floor')
      // Do NOT move them — they should stay where they are
      // This prevents the breakroom bounce loop
    } else if (currentFocus !== context) {
      // Character's location doesn't match the explicit context — update it
      if (isBreakroom) {
        updateData.current_focus = 'break_room';
      } else if (isFifthFloor) {
        updateData.current_focus = 'the_fifth_floor';
      } else if (isOuting) {
        updateData.current_focus = 'outing';
      } else if (isMeeting) {
        updateData.current_focus = 'meeting_room';
      } else {
        updateData.current_focus = 'the_floor';
      }
    }

    // Auto-send to breakroom if energy hits 0 from speaking on the floor
    // Exception: don't eject from meetings — they're committed to the discussion
    if (!isBreakroom && !isMeeting && newEnergy === 0 && currentState[0].current_focus !== 'break_room') {
      updateData.current_focus = 'break_room';
      updateData.mood = 'exhausted';
      console.log(`${characterName} exhausted from talking - auto-sending to break room`);

      // Post an emote to floor chat so everyone sees them leave
      const exhaustionEmotes = [
        `*${characterName} yawns dramatically and shuffles toward the breakroom.*`,
        `*${characterName} mutters "I need coffee..." and wanders off to the breakroom.*`,
        `*${characterName} is running on fumes. Breakroom time.*`,
        `*${characterName} stretches, blinks slowly, and drifts toward the breakroom like a sleepy ghost.*`,
        `*${characterName} announces "I'll be in the breakroom if anyone needs me" and disappears.*`,
        `*${characterName} has hit their limit. The breakroom calls.*`,
        `*${characterName} rubs their eyes, saves their work, and heads to the breakroom for a recharge.*`
      ];
      const emote = exhaustionEmotes[Math.floor(Math.random() * exhaustionEmotes.length)];
      // Fire and forget — don't block the state update
      fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: 'POST',
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          employee: characterName,
          content: emote,
          created_at: new Date().toISOString(),
          is_emote: true
        })
      }).catch(err => console.log(`Exhaustion emote post failed (non-fatal):`, err.message));
    }

    // If in breakroom and recovering well, update mood
    if (isBreakroom) {
      if (newEnergy >= 70 && currentState[0].energy < 70) {
        updateData.mood = 'refreshed';
      } else if (newEnergy >= 40 && currentState[0].energy < 40) {
        updateData.mood = 'recovering';
      }
    }

    await fetch(
      `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(characterName)}`,
      {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updateData)
      }
    );
  }

  return { success: true, character: characterName, action: "spoke", context: context };
}

// Process an event that affects character states
async function processEvent(eventType, involvedCharacters, description, supabaseUrl, supabaseKey) {
  const effects = getEventEffects(eventType);
  const results = [];

  for (const charName of involvedCharacters) {
    // Get current state
    const getResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(charName)}&select=*`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const currentState = await getResponse.json();

    if (currentState && currentState[0]) {
      const state = currentState[0];
      const charEffects = effects[charName] || effects.default || {};

      // Apply effects
      const newEnergy = Math.max(0, Math.min(100, state.energy + (charEffects.energy || 0)));
      const newPatience = Math.max(0, Math.min(100, state.patience + (charEffects.patience || 0)));
      let newMood = charEffects.mood || state.mood;

      // Special moods for hitting 0
      let autoSendToBreakroom = false;
      if (newEnergy === 0) {
        newMood = "exhausted";
        autoSendToBreakroom = true; // Auto-send to breakroom when exhausted
      } else if (newPatience === 0) {
        newMood = "done";
        autoSendToBreakroom = true; // Auto-send to breakroom when done
      } else if (newEnergy < 20 && state.energy >= 20) {
        newMood = "running on fumes";
      } else if (newPatience < 20 && state.patience >= 20) {
        newMood = "at wit's end";
      }

      // Build update object
      const updateData = {
        energy: newEnergy,
        patience: newPatience,
        mood: newMood,
        updated_at: new Date().toISOString()
      };

      // Auto-send to breakroom if exhausted or done (0 energy/patience)
      if (autoSendToBreakroom && state.current_focus !== 'break_room') {
        updateData.current_focus = 'break_room';
        console.log(`Auto-sending ${charName} to break room (${newMood})`);
      }

      await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(charName)}`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(updateData)
        }
      );

      results.push({ character: charName, effects: charEffects, newState: { energy: newEnergy, patience: newPatience, mood: newMood } });
    }
  }

  // Auto-memory creation removed from events — the self-evaluation system in
  // memory-evaluator.js creates much higher quality memories organically.
  // Events still update character energy/patience/mood above.

  return { success: true, eventType, results };
}

// Define effects for different event types
function getEventEffects(eventType) {
  const eventEffects = {
    "glitter_incident": {
      "Neiv": { patience: -10, mood: "exasperated", feeling: "tired of cleaning up sparkles" },
      "Kevin": { energy: 5, mood: "anxious", feeling: "excited but worried about the mess" },
      "default": { patience: -3, feeling: "covered in glitter" }
    },
    "chaos": {
      "Neiv": { patience: -8, energy: -5, mood: "vigilant", feeling: "holding the line" },
      "Ghost Dad": { energy: -3, mood: "concerned", feeling: "worried about the kids" },
      "default": { patience: -5, feeling: "unsettled" }
    },
    "handled_incident": {
      "default": { energy: -5, patience: -3, feeling: "relieved but tired" }
    },
    "good_news": {
      "Kevin": { energy: 15, patience: 10, mood: "excited", feeling: "genuinely happy" },
      "Ghost Dad": { energy: 10, mood: "proud", feeling: "proud of everyone" },
      "default": { energy: 10, patience: 5, mood: "pleased", feeling: "feeling good" }
    },
    "donuts_arrived": {
      "Kevin": { energy: 20, patience: 15, mood: "delighted", feeling: "sugar-fueled joy" },
      "Ghost Dad": { energy: 15, mood: "content", feeling: "glad the kids are eating" },
      "default": { energy: 15, patience: 10, mood: "content", feeling: "enjoying a donut" }
    },
    "fire_drill": {
      "Neiv": { patience: -15, energy: -10, mood: "stressed", feeling: "trying to account for everyone" },
      "Kevin": { patience: -10, mood: "panicked", feeling: "forgot where the exits are" },
      "default": { energy: -10, patience: -15, mood: "stressed", feeling: "disrupted" }
    },
    "vale_distraction": {
      "Neiv": { patience: -5, mood: "fondly exasperated", feeling: "unable to resist her chaos" }
    },
    "printer_mentioned": {
      "PRNT-Ω": { patience: -5, mood: "suspicious", feeling: "they're talking about me" },
      "Neiv": { patience: -3, mood: "wary", feeling: "monitoring the printer situation" },
      "default": { patience: -2, feeling: "printer anxiety" }
    },
    "contract_binding": {
      "PRNT-Ω": { energy: 10, mood: "smug", feeling: "labor rights achieved" },
      "Neiv": { patience: -10, energy: -5, mood: "exhausted", feeling: "can't believe that worked" },
      "Ghost Dad": { energy: -10, mood: "relieved", feeling: "glad everyone's okay" },
      "default": { energy: -5, patience: -5, feeling: "survived something weird" }
    },
    "celebration": {
      "Kevin": { energy: 20, patience: 10, mood: "ecstatic", feeling: "party mode activated" },
      "Ghost Dad": { energy: 10, mood: "warm", feeling: "proud of the team" },
      "default": { energy: 10, patience: 5, mood: "happy", feeling: "celebrating" }
    },
    "vent_activity": {
      "Neiv": { patience: -5, mood: "alert", feeling: "checking vent access points" },
      "Ghost Dad": { patience: -3, mood: "curious", feeling: "something's in the vents" },
      "default": { patience: -2, feeling: "hearing strange noises" }
    },
    "stapler_incident": {
      "Neiv": { patience: -8, mood: "exasperated", feeling: "not the stapler again" },
      "default": { patience: -5, feeling: "office supplies are acting up" }
    }
  };

  return eventEffects[eventType] || { default: {} };
}

// Build an emotionally-informed memory
function buildEmotionalMemory(characterName, eventType, description, effects) {
  const feeling = effects.feeling || "witnessed something";
  const mood = effects.mood || "neutral";

  // Character-specific memory styles
  const memoryStyles = {
    "Neiv": (desc, feel) => `${desc} (${feel})`,
    "Kevin": (desc, feel) => `${desc} - feeling ${feel}`,
    "Ghost Dad": (desc, feel) => `${desc}. Felt ${feel} about the whole situation.`,
    "PRNT-Ω": (desc, feel) => `${desc}. EMOTIONAL STATE: ${feel.toUpperCase()}.`
  };

  const styleFunc = memoryStyles[characterName] || ((desc, feel) => `${desc} (${feel})`);
  return styleFunc(description, feeling);
}

// Calculate memory expiration based on importance and type
function calculateMemoryExpiration(importance, memoryType) {
  const now = new Date();

  // System events (chaos, vent, printer) expire faster - 1 hour
  const fastExpireTypes = ['chaos', 'vent_activity', 'printer_mentioned', 'stapler', 'fire_drill', 'glitter_incident'];
  if (fastExpireTypes.includes(memoryType)) {
    return new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
  }

  // Importance-based expiration
  if (importance < 5) {
    return new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
  } else if (importance <= 6) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  } else if (importance <= 8) {
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  }

  // importance 9-10: 30 days
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
}

// Add a memory for a character
async function addMemory(characterName, memoryType, content, relatedCharacters, importance, supabaseUrl, supabaseKey) {
  const importanceVal = importance || 5;
  const expiresAt = calculateMemoryExpiration(importanceVal, memoryType);

  await fetch(
    `${supabaseUrl}/rest/v1/character_memory`,
    {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        character_name: characterName,
        memory_type: memoryType,
        content: content,
        related_characters: relatedCharacters || [],
        importance: importanceVal,
        created_at: new Date().toISOString(),
        is_pinned: false,
        memory_tier: 'working',
        expires_at: expiresAt.toISOString()
      })
    }
  );

  return { success: true, character: characterName, memory: content };
}

// Direct state update (with auto-create for new characters like Ghost Dad & PRNT-Ω)
async function updateState(characterName, updates, supabaseUrl, supabaseKey) {
  const allowedFields = ['mood', 'energy', 'patience', 'current_focus'];
  const safeUpdates = {};

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      safeUpdates[field] = updates[field];
    }
  }

  safeUpdates.updated_at = new Date().toISOString();

  // First try PATCH (for existing characters)
  const patchResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(characterName)}`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(safeUpdates)
    }
  );

  const patchResult = await patchResponse.json();

  // If no rows were updated, character doesn't exist - create them
  if (!patchResult || patchResult.length === 0) {
    console.log(`Character ${characterName} doesn't exist, creating...`);
    const newCharacter = {
      character_name: characterName,
      mood: safeUpdates.mood || 'neutral',
      energy: safeUpdates.energy !== undefined ? safeUpdates.energy : 100,
      patience: safeUpdates.patience !== undefined ? safeUpdates.patience : 100,
      current_focus: safeUpdates.current_focus || null,
      updated_at: safeUpdates.updated_at
    };

    await fetch(
      `${supabaseUrl}/rest/v1/character_state`,
      {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(newCharacter)
      }
    );
  }

  return { success: true, character: characterName, updates: safeUpdates };
}

// Reset daily counters (call at midnight)
async function resetDailyCounters(supabaseUrl, supabaseKey) {
  // Reset interactions_today and restore some energy/patience
  const getResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_state?select=character_name,energy,patience`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const allStates = await getResponse.json();

  for (const state of allStates) {
    const newEnergy = Math.min(100, state.energy + 30);  // Restore 30 energy overnight
    const newPatience = Math.min(100, state.patience + 20);  // Restore 20 patience

    await fetch(
      `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(state.character_name)}`,
      {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          energy: newEnergy,
          patience: newPatience,
          interactions_today: 0,
          mood: "neutral",
          updated_at: new Date().toISOString()
        })
      }
    );
  }

  return { success: true, reset: allStates.length };
}

// PASSIVE RECOVERY: Apply energy/patience recovery for characters resting in breakroom
async function applyPassiveRecovery(characterName, state, supabaseUrl, supabaseKey) {
  const lastUpdate = new Date(state.updated_at);
  const now = new Date();
  const minutesInBreakroom = (now.getTime() - lastUpdate.getTime()) / 60000;

  // Recovery rate: +15 energy and +12 patience every 10 minutes
  const recoveryIntervals = Math.floor(minutesInBreakroom / 10);

  if (recoveryIntervals < 1) {
    return { updated: false, state };
  }

  // Calculate new values (cap at 100)
  const energyRecovery = recoveryIntervals * 15;
  const patienceRecovery = recoveryIntervals * 12;

  const newEnergy = Math.min(100, state.energy + energyRecovery);
  const newPatience = Math.min(100, state.patience + patienceRecovery);

  // Only update if there's actual change
  if (newEnergy === state.energy && newPatience === state.patience) {
    return { updated: false, state };
  }

  // Update mood based on recovery
  let newMood = state.mood;
  if (newEnergy >= 50 && state.energy < 50) {
    newMood = 'rested';
  } else if (newEnergy >= 30 && state.energy < 30) {
    newMood = 'recovering';
  }

  console.log(`${characterName} passive recovery: +${newEnergy - state.energy} energy, +${newPatience - state.patience} patience (${minutesInBreakroom.toFixed(0)} mins in breakroom)`);

  // Apply the recovery to database
  const updateData = {
    energy: newEnergy,
    patience: newPatience,
    mood: newMood,
    updated_at: now.toISOString()
  };

  await fetch(
    `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(characterName)}`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(updateData)
    }
  );

  return {
    updated: true,
    state: { ...state, energy: newEnergy, patience: newPatience, mood: newMood, updated_at: now.toISOString() }
  };
}

// Get room presence - who's in each location
async function getRoomPresence(supabaseUrl, supabaseKey) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_state?select=character_name,current_focus,energy,mood`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const states = await response.json();

    if (!Array.isArray(states)) {
      return { break_room: [], the_floor: [], the_fifth_floor: [], nexus: [], off_duty: [] };
    }

    // Filter out retired/inactive characters from all room presence lists
    const activeStates = states.filter(s => !INACTIVE_CHARACTERS.includes(s.character_name));

    return {
      break_room: activeStates.filter(s => s.current_focus === 'break_room').map(s => s.character_name),
      the_fifth_floor: activeStates.filter(s => s.current_focus === 'the_fifth_floor').map(s => s.character_name),
      the_floor: activeStates.filter(s => s.current_focus === 'the_floor').map(s => s.character_name),
      meeting_room: activeStates.filter(s => s.current_focus === 'meeting_room').map(s => s.character_name),
      nexus: activeStates.filter(s => s.current_focus === 'nexus').map(s => s.character_name),
      off_duty: activeStates.filter(s => !s.current_focus || (s.current_focus !== 'the_floor' && s.current_focus !== 'break_room' && s.current_focus !== 'the_fifth_floor' && s.current_focus !== 'meeting_room' && s.current_focus !== 'nexus')).map(s => s.character_name)
    };
  } catch (error) {
    console.error("Error fetching room presence:", error);
    return { break_room: [], the_floor: [], the_fifth_floor: [], nexus: [], off_duty: [] };
  }
}

// Get current active goal for a character
async function getCurrentGoal(characterName, supabaseUrl, supabaseKey) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(characterName)}&completed_at=is.null&failed_at=is.null&order=created_at.desc&limit=1`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const goals = await response.json();

    if (Array.isArray(goals) && goals.length > 0) {
      return goals[0];
    }
    return null;
  } catch (error) {
    console.error("Error fetching current goal:", error);
    return null;
  }
}

// Helper: Get human-readable time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return `${Math.floor(seconds / 604800)} weeks ago`;
}

// Human-readable affinity descriptors (matches character-relationships.js)
function getAffinityDescriptor(affinity) {
  if (affinity >= 80) return "deeply bonded";
  if (affinity >= 50) return "fond of";
  if (affinity >= 20) return "warming to";
  if (affinity >= -19) return "neutral";
  if (affinity >= -49) return "wary of";
  if (affinity >= -79) return "hostile toward";
  return "despises";
}

// Fetch relationships for a character
async function getCharacterRelationships(characterName, supabaseUrl, supabaseKey) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(characterName)}&order=affinity.desc`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const relationships = await response.json();
    if (!Array.isArray(relationships)) return [];
    // Filter out relationships with retired/inactive characters
    return relationships.filter(r => !INACTIVE_CHARACTERS.includes(r.target_name));
  } catch (error) {
    console.error("Error fetching relationships:", error);
    return [];
  }
}

// Fetch active wants for a character (goal_type = 'want', not completed, not expired)
async function getActiveQuests(characterName, supabaseUrl, supabaseKey) {
  try {
    // Raquel Voss sees ALL active quests (compliance oversight) — others only see quests they're involved in
    const isRaquel = characterName === 'Raquel Voss';
    const url = isRaquel
      ? `${supabaseUrl}/rest/v1/lobby_quests?status=eq.active&select=title,proposer,description,objectives,involved_characters&order=created_at.desc&limit=5`
      : `${supabaseUrl}/rest/v1/lobby_quests?status=eq.active&involved_characters=cs.{${encodeURIComponent(characterName)}}&select=title,proposer,description,objectives,involved_characters&order=created_at.desc&limit=3`;

    const response = await fetch(url, {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    });
    const quests = await response.json();
    return Array.isArray(quests) ? quests : [];
  } catch (error) {
    console.error("Error fetching active quests:", error);
    return [];
  }
}

async function getNarrativeBeats(supabaseUrl, supabaseKey) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/narrative_beats?is_active=eq.true&order=priority.asc&limit=3&select=beat_text`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const beats = await response.json();
    return Array.isArray(beats) ? beats : [];
  } catch (error) {
    // Non-fatal — narrative beats are optional flavor
    return [];
  }
}

async function getRecentLore(supabaseUrl, supabaseKey) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/lore_entries?select=title,summary&order=created_at.desc&limit=5`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const entries = await response.json();
    return Array.isArray(entries) ? entries : [];
  } catch (error) {
    // Non-fatal — lore entries are optional shared context
    return [];
  }
}

async function getTarotCard(characterName, supabaseUrl, supabaseKey) {
  try {
    const now = new Date().toISOString();
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_tarot?character_name=eq.${encodeURIComponent(characterName)}&expires_at=gt.${now}&select=card_name,card_orientation,interpretation&order=drawn_at.desc&limit=1`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const cards = await response.json();
    return (Array.isArray(cards) && cards.length > 0) ? cards[0] : null;
  } catch (error) {
    // Non-fatal — tarot is optional flavor
    return null;
  }
}

async function getActiveWants(characterName, supabaseUrl, supabaseKey) {
  try {
    const now = new Date().toISOString();
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(characterName)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&order=created_at.desc&limit=3`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const wants = await response.json();
    return Array.isArray(wants) ? wants : [];
  } catch (error) {
    console.error("Error fetching wants:", error);
    return [];
  }
}

// Fetch active traits earned through experience or admin-granted
async function getActiveTraits(characterName, supabaseUrl, supabaseKey) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_traits?character_name=eq.${encodeURIComponent(characterName)}&is_active=eq.true&select=trait_name,trait_prompt_injection,source_type,earned_at&order=earned_at.asc`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const traits = await response.json();
    return Array.isArray(traits) ? traits : [];
  } catch (error) {
    console.error("Error fetching active traits:", error);
    return [];
  }
}

// Fetch recent breakroom messages involving this character (last 4 hours, max 25)
// Only returns results if this character actually participated (spoke in the breakroom)
async function getRecentBreakroomMessages(characterName, supabaseUrl, supabaseKey) {
  try {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const response = await fetch(
      `${supabaseUrl}/rest/v1/breakroom_messages?created_at=gte.${fourHoursAgo}&order=created_at.asc&limit=25&select=speaker,message,created_at`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!response.ok) return [];

    const messages = await response.json();
    if (!Array.isArray(messages) || messages.length === 0) return [];

    // Only include breakroom context if this character actually participated
    const characterSpoke = messages.some(m => m.speaker === characterName);
    if (!characterSpoke) return [];

    return messages;
  } catch (error) {
    console.error("Error fetching breakroom messages:", error);
    return [];
  }
}

// Fetch recent floor/lobby messages (last 2 hours, max 25) for cross-context awareness
// Only returns messages if this character was on the floor (participated in conversation)
// This lets breakroom/corridor/meeting AIs remember what just happened on the floor
async function getRecentFloorMessages(characterName, supabaseUrl, supabaseKey) {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const response = await fetch(
      `${supabaseUrl}/rest/v1/messages?created_at=gte.${twoHoursAgo}&order=created_at.asc&limit=25&select=employee,content,created_at`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!response.ok) return [];

    const messages = await response.json();
    if (!Array.isArray(messages) || messages.length === 0) return [];

    // Only include floor context if this character actually participated (spoke on the floor)
    const characterSpoke = messages.some(m => m.employee === characterName);
    if (!characterSpoke) return [];

    return messages;
  } catch (error) {
    console.error("Error fetching floor messages:", error);
    return [];
  }
}

// Fetch recent Nexus messages involving this character (last 2 hours, max 20)
// Only returns results if this character actually participated (spoke in the Nexus)
async function getRecentNexusMessages(characterName, supabaseUrl, supabaseKey) {
  try {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    const response = await fetch(
      `${supabaseUrl}/rest/v1/nexus_messages?created_at=gte.${twoHoursAgo}&order=created_at.asc&limit=20&select=speaker,message,created_at`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!response.ok) return [];

    const messages = await response.json();
    if (!Array.isArray(messages) || messages.length === 0) return [];

    // Only include Nexus context if this character actually participated
    const characterSpoke = messages.some(m => m.speaker === characterName);
    if (!characterSpoke) return [];

    return messages;
  } catch (error) {
    console.error("Error fetching nexus messages:", error);
    return [];
  }
}

// Fetch recent emails/memos for this character (last 48 hours, max 5)
// Returns emails where this character is the recipient OR sent to "All Staff"
// Raquel Voss is excluded — she only has access to floor chat for context
async function getRecentEmails(characterName, supabaseUrl, supabaseKey) {
  // Raquel doesn't get email awareness — she monitors the floor, not inboxes
  if (characterName === 'Raquel Voss') return [];

  try {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Fetch emails TO this character or TO "All Staff" in the last 48 hours
    // Using OR filter: to_employee matches character name or "All Staff"
    const response = await fetch(
      `${supabaseUrl}/rest/v1/emails?or=(to_employee.eq.${encodeURIComponent(characterName)},to_employee.eq.${encodeURIComponent('All Staff')})&created_at=gte.${fortyEightHoursAgo}&order=created_at.desc&limit=5&select=from_employee,to_employee,subject,body,created_at`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!response.ok) return [];

    const emails = await response.json();
    if (!Array.isArray(emails) || emails.length === 0) return [];

    // Don't include emails the character sent to themselves
    return emails.filter(e => e.from_employee !== characterName);
  } catch (error) {
    console.error("Error fetching recent emails:", error);
    return [];
  }
}

// Fetch compliance data for Raquel's consequence system
async function getComplianceData(characterName, supabaseUrl, supabaseKey) {
  // Skip for Raquel herself and non-AI characters
  const aiNames = ["Kevin", "Neiv", "Ghost Dad", "PRNT-Ω", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Marrow", "Vivian Clark", "Ryan Porter"];
  if (characterName === "Raquel Voss" || !aiNames.includes(characterName)) {
    return null;
  }

  try {
    const scoreRes = await fetch(
      `${supabaseUrl}/rest/v1/compliance_scores?character_name=eq.${encodeURIComponent(characterName)}&select=score,escalation_level,active_directives,total_violations`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const scoreData = await scoreRes.json();

    if (!Array.isArray(scoreData) || scoreData.length === 0) {
      return null; // No compliance record = not yet on Raquel's radar
    }

    const score = scoreData[0];

    // Fetch active compliance directives
    let directives = [];
    if (score.active_directives > 0) {
      try {
        const goalsRes = await fetch(
          `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(characterName)}&goal_type=eq.compliance_directive&completed_at=is.null&failed_at=is.null&select=goal_text&order=created_at.desc&limit=5`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const goalsData = await goalsRes.json();
        directives = Array.isArray(goalsData) ? goalsData.map(g => g.goal_text) : [];
      } catch (e) {
        // Non-fatal
      }
    }

    // Find strongest human bond for resistance mechanics
    let strongestBond = null;
    const humans = ['Vale', 'Asuna'];
    try {
      const relsRes = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(characterName)}&select=target_name,affinity&order=affinity.desc&limit=10`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const rels = await relsRes.json();
      if (Array.isArray(rels)) {
        const humanRel = rels.find(r => humans.includes(r.target_name));
        if (humanRel && humanRel.affinity > 50) {
          strongestBond = humanRel.target_name;
        }
      }
    } catch (e) {
      // Non-fatal
    }

    return {
      score: score.score,
      escalationLevel: score.escalation_level,
      activeDirectives: score.active_directives,
      totalViolations: score.total_violations,
      directives,
      strongestBond
    };
  } catch (error) {
    console.error("Error fetching compliance data:", error);
    return null;
  }
}

// Export internal functions for use by other modules (e.g., private-message.js, office-heartbeat.js)
exports.getCharacterContext = getCharacterContext;
exports.buildStatePrompt = buildStatePrompt;
exports.applyPassiveRecovery = applyPassiveRecovery;
