// Character State Management - The "soul" of each AI character
// Handles mood, energy, patience, and memory

const characters = require('../../data/characters.json');

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

      if (!characterName) {
        // Return all character states
        const allStates = await fetch(
          `${supabaseUrl}/rest/v1/character_state?select=*`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const states = await allStates.json();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ states })
        };
      }

      // Get specific character's full context (with optional conversation context for memory matching)
      const context = await getCharacterContext(characterName, supabaseUrl, supabaseKey, conversationContext);
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
        const { character } = body;
        const result = await recordSpeaking(character, supabaseUrl, supabaseKey);
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
async function getCharacterContext(characterName, supabaseUrl, supabaseKey, conversationContext = null) {
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
  const state = stateData[0] || {
    mood: "neutral",
    energy: 100,
    patience: 100,
    interactions_today: 0,
    current_focus: null
  };

  // Get memories - mix of important + recent + contextually relevant
  let memories = [];

  // 1. Get top 3 most important memories (the big stuff)
  const importantMemoriesResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(characterName)}&importance=gte.7&order=importance.desc,created_at.desc&limit=3`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const importantMemories = await importantMemoriesResponse.json();
  memories = memories.concat(importantMemories || []);

  // 2. Get 3 most recent memories from last 24 hours (fresh context)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const recentMemoriesResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(characterName)}&created_at=gte.${oneDayAgo}&order=created_at.desc&limit=3`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const recentMemories = await recentMemoriesResponse.json();

  // Add recent memories that aren't duplicates
  const existingIds = new Set(memories.map(m => m.id));
  for (const mem of (recentMemories || [])) {
    if (!existingIds.has(mem.id)) {
      memories.push(mem);
      existingIds.add(mem.id);
    }
  }

  // 3. If conversation context provided, try to find relevant memories
  if (conversationContext) {
    const relevantMemories = await findRelevantMemories(characterName, conversationContext, supabaseUrl, supabaseKey);
    for (const mem of relevantMemories) {
      if (!existingIds.has(mem.id) && memories.length < 8) {
        memories.push(mem);
        existingIds.add(mem.id);
      }
    }
  }

  // Sort by a combination of importance and recency
  memories.sort((a, b) => {
    const aScore = a.importance + (new Date(a.created_at) > new Date(Date.now() - 3600000) ? 3 : 0);
    const bScore = b.importance + (new Date(b.created_at) > new Date(Date.now() - 3600000) ? 3 : 0);
    return bScore - aScore;
  });

  // Limit to 6 memories max
  memories = memories.slice(0, 6);

  // Build the context prompt
  const statePrompt = buildStatePrompt(characterName, characterInfo, state, memories);

  return {
    character: characterName,
    info: characterInfo,
    state,
    memories,
    statePrompt
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
    /jenna/gi, /kevin/gi, /courtney/gi, /nyx/gi, /vex/gi, /ace/gi,
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
function buildStatePrompt(characterName, info, state, memories) {
  let prompt = `\n--- HOW YOU'RE FEELING RIGHT NOW ---\n`;

  // Special states for 0 energy or patience
  if (state.energy === 0) {
    prompt += `You are COMPLETELY EXHAUSTED. You can barely form words. Keep responses to 1-2 sentences max. You need rest.\n`;
  } else if (state.patience === 0) {
    prompt += `You are DONE. Out of patience. You might snap, go silent, or just walk away. You've hit your limit.\n`;
  }

  // Describe state in natural language instead of numbers
  const energyDesc = state.energy === 0 ? "" :
                     state.energy > 70 ? "You're feeling alert and present." :
                     state.energy > 40 ? "You're a bit tired but functional." :
                     state.energy > 20 ? "You're running low - keep it brief." :
                     state.energy > 0 ? "You're exhausted. Minimal responses." : "";

  const patienceDesc = state.patience === 0 ? "" :
                       state.patience > 70 ? "" :
                       state.patience > 40 ? "Your patience is wearing a bit thin. " :
                       state.patience > 20 ? "You're getting frustrated. " :
                       state.patience > 0 ? "You're at your limit. " : "";

  const moodDesc = state.mood !== "neutral" ? `Current mood: ${state.mood}. ` : "";

  prompt += `${moodDesc}${patienceDesc}${energyDesc}\n`;

  if (state.current_focus) {
    prompt += `You're currently focused on: ${state.current_focus}\n`;
  }

  if (state.interactions_today > 10) {
    prompt += `You've been talking a lot today - maybe let others have the floor.\n`;
  }

  // Format memories as things you remember, not database entries
  if (memories && memories.length > 0) {
    prompt += `\n--- THINGS YOU REMEMBER ---\n`;
    prompt += `These are real things that happened. Reference them naturally if they come up, but don't force them into conversation:\n`;

    memories.forEach(m => {
      const timeAgo = getTimeAgo(new Date(m.created_at));
      // Format based on memory type
      if (m.memory_type === 'glitter_incident') {
        prompt += `- The glitter situation (${timeAgo}): ${m.content}\n`;
      } else if (m.memory_type === 'chaos') {
        prompt += `- That chaos (${timeAgo}): ${m.content}\n`;
      } else if (m.memory_type === 'printer_mentioned' || m.memory_type === 'printer') {
        prompt += `- Printer business (${timeAgo}): ${m.content}\n`;
      } else if (m.memory_type === 'contract_binding') {
        prompt += `- THE CONTRACT (${timeAgo}): ${m.content}\n`;
      } else {
        prompt += `- (${timeAgo}): ${m.content}\n`;
      }
    });
  }

  prompt += `--- END CONTEXT ---\n`;
  return prompt;
}

// Record that a character spoke
async function recordSpeaking(characterName, supabaseUrl, supabaseKey) {
  // Decrement energy slightly, update last_spoke_at, increment interactions
  const response = await fetch(
    `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(characterName)}`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        energy: `GREATEST(0, energy - 3)`,  // Lose 3 energy per message
        last_spoke_at: new Date().toISOString(),
        interactions_today: `interactions_today + 1`,
        updated_at: new Date().toISOString()
      })
    }
  );

  // Supabase doesn't support expressions in PATCH, so we need to do it differently
  // First get current state
  const getResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(characterName)}&select=energy,interactions_today`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const currentState = await getResponse.json();

  if (currentState && currentState[0]) {
    const newEnergy = Math.max(0, currentState[0].energy - 3);
    const newInteractions = currentState[0].interactions_today + 1;

    // Build update data
    const updateData = {
      energy: newEnergy,
      last_spoke_at: new Date().toISOString(),
      interactions_today: newInteractions,
      updated_at: new Date().toISOString()
    };

    // Auto-send to breakroom if energy hits 0 from speaking
    if (newEnergy === 0 && currentState[0].current_focus !== 'break_room') {
      updateData.current_focus = 'break_room';
      updateData.mood = 'exhausted';
      console.log(`${characterName} exhausted from talking - auto-sending to break room`);
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

  return { success: true, character: characterName, action: "spoke" };
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

  // Create emotionally-informed memories for involved characters
  for (const charName of involvedCharacters) {
    const charEffects = effects[charName] || effects.default || {};
    const emotionalMemory = buildEmotionalMemory(charName, eventType, description, charEffects);
    await addMemory(charName, eventType, emotionalMemory, involvedCharacters, 6, supabaseUrl, supabaseKey);
  }

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
      "Nyx": { energy: 5, mood: "alert", feeling: "ready to fight something" },
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
      "Vex": { energy: 10, patience: 5, mood: "satisfied", feeling: "grudgingly pleased" },
      "default": { energy: 15, patience: 10, mood: "content", feeling: "enjoying a donut" }
    },
    "fire_drill": {
      "Neiv": { patience: -15, energy: -10, mood: "stressed", feeling: "trying to account for everyone" },
      "Nyx": { energy: -5, mood: "annoyed", feeling: "this better not be real" },
      "Kevin": { patience: -10, mood: "panicked", feeling: "forgot where the exits are" },
      "default": { energy: -10, patience: -15, mood: "stressed", feeling: "disrupted" }
    },
    "jenna_distraction": {
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
      "Nyx": { energy: 5, mood: "impressed", feeling: "respect for the negotiation" },
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
      "Vex": { patience: -10, mood: "guilty", feeling: "this is technically my fault" },
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
    "Nyx": (desc, feel) => `${desc}. (${feel})`,
    "PRNT-Ω": (desc, feel) => `${desc}. EMOTIONAL STATE: ${feel.toUpperCase()}.`,
    "Vex": (desc, feel) => `${desc}. No particular feelings about this. (${feel})`,
    "Ace": (desc, feel) => `${desc}. Noted.`
  };

  const styleFunc = memoryStyles[characterName] || ((desc, feel) => `${desc} (${feel})`);
  return styleFunc(description, feeling);
}

// Add a memory for a character
async function addMemory(characterName, memoryType, content, relatedCharacters, importance, supabaseUrl, supabaseKey) {
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
        importance: importance || 5,
        created_at: new Date().toISOString()
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

// Helper: Get human-readable time ago
function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);

  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return `${Math.floor(seconds / 604800)} weeks ago`;
}
