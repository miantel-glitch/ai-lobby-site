// Office Heartbeat - Natural rhythms for the AI Lobby
// Replaces random auto-poke with time-aware, momentum-sensitive AI activity
// The office "breathes" - busier in mornings, quieter at night
//
// ENHANCED STORY MODE: AIs are now CURIOUS and ENGAGING
// - Only floor-present AIs participate (except Ghost Dad & PRNT-Ω who transcend location)
// - AIs check in on each other and humans ("What is everyone up to?")
// - AIs wonder about mysteries (Buffer, Corridors, the door)
// - Natural chain reactions when one AI mentions another

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // Get current time in EST
    const now = new Date();
    const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const hour = estTime.getHours();
    const dayOfWeek = estTime.getDay(); // 0 = Sunday

    // Define office rhythms - SLOWED DOWN by 50% for more natural pacing
    // Previous values were too chatty (20% morning, 3% night)
    const OFFICE_RHYTHMS = {
      early_morning: { hours: [6, 7, 8], baseChance: 0.025, energy: 'waking' },
      morning: { hours: [9, 10, 11], baseChance: 0.10, energy: 'high' },
      midday: { hours: [12, 13], baseChance: 0.06, energy: 'lunch' },
      afternoon: { hours: [14, 15, 16], baseChance: 0.075, energy: 'normal' },
      late_afternoon: { hours: [17, 18], baseChance: 0.05, energy: 'winding' },
      evening: { hours: [19, 20, 21], baseChance: 0.04, energy: 'low' },
      night: { hours: [22, 23, 0, 1, 2, 3, 4, 5], baseChance: 0.015, energy: 'quiet' }
    };

    // Find current rhythm
    let currentRhythm = { baseChance: 0.05, energy: 'quiet' };
    for (const [name, rhythm] of Object.entries(OFFICE_RHYTHMS)) {
      if (rhythm.hours.includes(hour)) {
        currentRhythm = { ...rhythm, name };
        break;
      }
    }

    // Weekend modifier (office is quieter)
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend) {
      currentRhythm.baseChance *= 0.5;
    }

    console.log(`Heartbeat: ${hour}:00 EST, rhythm: ${currentRhythm.name}, baseChance: ${currentRhythm.baseChance}`);

    // Check Story Mode
    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.story_mode&select=value`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const settings = await settingsResponse.json();
    const storyModeEnabled = settings?.[0]?.value === 'true';

    if (!storyModeEnabled) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: "Story Mode is OFF - heartbeat silent",
          rhythm: currentRhythm.name
        })
      };
    }

    // Check for breakroom characters who have recovered and should return to the floor
    const returnedCharacters = await checkBreakroomRecovery(supabaseUrl, supabaseKey);

    // 5th Floor Ops tick — task generation, paging, resolution, progress logs
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    let opsActivity = null;
    try {
      const opsResult = await fetch(`${siteUrl}/.netlify/functions/fifth-floor-ops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'heartbeat_tick', rhythm: currentRhythm.name, hour })
      });
      opsActivity = await opsResult.json();
      if (opsActivity?.newTask) {
        console.log(`Heartbeat: New ops task — "${opsActivity.newTask.title}" (${opsActivity.newTask.severity})`);
      }
      if (opsActivity?.resolvedTasks?.length > 0) {
        console.log(`Heartbeat: ${opsActivity.resolvedTasks.length} ops task(s) resolved`);
      }
      if (opsActivity?.pagedCharacters?.length > 0) {
        console.log(`Heartbeat: Paged ${opsActivity.pagedCharacters.join(', ')} to 5th floor`);
      }
    } catch (opsErr) {
      console.log("5th Floor ops tick failed (non-fatal):", opsErr.message);
    }

    // Quest system: auto-activate proposed quests older than 1 hour
    // and occasionally trigger AI quest proposals (~5% chance per heartbeat)
    let questActivity = null;
    try {
      // Always check for auto-activation (cheap DB query)
      fetch(`${siteUrl}/.netlify/functions/quest-engine`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_activate' })
      }).catch(err => console.log("Quest auto-activate check failed (non-fatal):", err.message));

      // ~5% chance per heartbeat: have a character consider proposing a quest
      if (Math.random() <= 0.05) {
        console.log("Heartbeat: Quest proposal roll succeeded — asking a character to pitch a storyline");
        const proposalResult = await fetch(`${siteUrl}/.netlify/functions/quest-engine`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'propose' })
        });
        questActivity = await proposalResult.json();
        if (questActivity?.proposed) {
          console.log(`Heartbeat: ${questActivity.character} proposed quest "${questActivity.title}"`);
        }
      }
    } catch (questErr) {
      console.log("Quest heartbeat check failed (non-fatal):", questErr.message);
    }

    // Cyber Cat: decay stats every heartbeat
    let catActivity = null;
    try {
      const catDecayResult = await fetch(`${siteUrl}/.netlify/functions/cyber-cat`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decay' })
      });
      catActivity = await catDecayResult.json();
      if (catActivity?.decayed) {
        console.log(`Heartbeat: Cat decayed — mood: ${catActivity.mood}, event: ${catActivity.event || 'normal'}`);
      }
    } catch (catErr) {
      console.log("Cat heartbeat decay failed (non-fatal):", catErr.message);
    }

    // Character Growth: ~1% chance per heartbeat, evaluate all characters for new traits
    let traitActivity = null;
    try {
      if (Math.random() <= 0.01) {
        console.log("Heartbeat: Trait evaluation roll succeeded — checking all characters for new traits");
        const traitResult = await fetch(`${siteUrl}/.netlify/functions/character-growth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'evaluate_all' })
        });
        traitActivity = await traitResult.json();
        if (traitActivity?.totalNewTraits > 0) {
          console.log(`Heartbeat: ${traitActivity.totalNewTraits} new trait(s) earned!`);
        }
      }
    } catch (traitErr) {
      console.log("Trait evaluation failed (non-fatal):", traitErr.message);
    }

    // Daily PM wipe: clear PM messages older than 24 hours (once per day)
    try {
      const pmWipeHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
      const lastWipeRes = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.last_pm_wipe_at&select=value`,
        { headers: pmWipeHeaders }
      );
      const lastWipeData = await lastWipeRes.json();
      const lastWipe = lastWipeData?.[0]?.value;
      const hoursSinceWipe = lastWipe ? (Date.now() - new Date(lastWipe).getTime()) / (1000 * 60 * 60) : 999;

      if (hoursSinceWipe >= 24) {
        console.log("Heartbeat: Running daily PM wipe (clearing messages older than 24 hours)");
        try {
          await fetch(`${siteUrl}/.netlify/functions/private-message?wipe_all=true`, {
            method: 'DELETE'
          });
        } catch (err) {
          console.log("PM daily wipe failed (non-fatal):", err.message);
        }

        // Upsert last wipe timestamp
        try {
          await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
            method: 'POST',
            headers: { ...pmWipeHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ key: 'last_pm_wipe_at', value: new Date().toISOString() })
          });
        } catch (err) {
          console.log("PM wipe timestamp update failed:", err.message);
        }
      }
    } catch (pmWipeErr) {
      console.log("PM daily wipe check failed (non-fatal):", pmWipeErr.message);
    }

    // Get recent messages to analyze conversation momentum
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&order=created_at.desc&limit=20`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const messages = await messagesResponse.json();

    if (!messages || messages.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: "No messages to respond to",
          rhythm: currentRhythm.name
        })
      };
    }

    // Analyze conversation momentum
    const momentum = analyzeConversationMomentum(messages);
    console.log(`Momentum analysis:`, momentum);

    // Adjust chance based on momentum
    let finalChance = currentRhythm.baseChance;

    // If humans are actively chatting, AIs should listen more
    if (momentum.humanActivityLast10Min >= 3) {
      finalChance *= 0.3; // Much less likely to interrupt active conversation
      console.log("Active human conversation - reducing AI chance");
    } else if (momentum.humanActivityLast10Min === 0 && momentum.minutesSinceLastMessage > 15) {
      finalChance *= 1.5; // More likely to "notice" the silence
      console.log("Quiet office - increasing AI chance slightly");
    }

    // If too many AIs have spoken recently, stay quiet
    if (momentum.aiMessagesLast5 >= 2) {
      finalChance *= 0.2;
      console.log("AIs have been chatty - reducing chance");
    }

    // Roll the dice
    const roll = Math.random();
    console.log(`Final chance: ${finalChance.toFixed(3)}, rolled: ${roll.toFixed(3)}`);

    if (roll > finalChance) {
      // On skipped beats, occasionally trigger a subconscious reflection
      // Characters use quiet moments to think about their relationships
      const { heartbeatReflection, reachOutImpulse } = require('./shared/subconscious-triggers');
      const reflection = await heartbeatReflection(supabaseUrl, supabaseKey, siteUrl);
      if (reflection) {
        console.log(`Heartbeat skip — but ${reflection.character} is quietly reflecting on ${reflection.target}`);
      }

      // ~3% chance: an AI character decides to reach out to a human via PM
      const reachOut = await reachOutImpulse(supabaseUrl, supabaseKey, siteUrl);
      if (reachOut) {
        console.log(`Heartbeat skip — ${reachOut.character} is reaching out to ${reachOut.target} via PM`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: `Heartbeat skip (${(finalChance * 100).toFixed(1)}% chance)`,
          rhythm: currentRhythm.name,
          momentum: momentum,
          returnedFromBreakroom: returnedCharacters,
          opsActivity: opsActivity || null,
          catActivity: catActivity || null,
          traitActivity: traitActivity || null,
          subconsciousReflection: reflection || null,
          reachOut: reachOut || null
        })
      };
    }

    // Get floor presence BEFORE selecting AI
    const floorPresentAIs = await getFloorPresentAIs(supabaseUrl, supabaseKey);

    // Select which AI should speak based on who hasn't spoken recently AND who's on the floor
    const respondingAI = selectRespondingAI(messages, currentRhythm.energy, floorPresentAIs);
    console.log(`Selected AI: ${respondingAI} (from floor: ${floorPresentAIs.join(', ')})`);

    // Check if selected AI is clocked in (some are always available)
    const alwaysAvailable = ["Ghost Dad", "PRNT-Ω", "The Narrator", "The Subtitle"];
    if (!alwaysAvailable.includes(respondingAI)) {
      const punchResponse = await fetch(
        `${supabaseUrl}/rest/v1/punch_status?employee=eq.${encodeURIComponent(respondingAI)}&select=is_clocked_in`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const punchData = await punchResponse.json();
      if (!punchData || punchData.length === 0 || !punchData[0].is_clocked_in) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            responded: false,
            reason: `${respondingAI} is not clocked in`,
            rhythm: currentRhythm.name
          })
        };
      }
    }

    // Build curiosity context for the AI
    // This makes AIs proactive - asking questions, checking in, wondering about mysteries
    // (floorPresentAIs already fetched above for AI selection)
    const allFloorPeople = await getAllFloorPresent(supabaseUrl, supabaseKey);
    const curiosityContext = buildCuriosityContext(respondingAI, allFloorPeople, supabaseUrl, supabaseKey);

    console.log(`Curiosity context for ${respondingAI}:`, curiosityContext.mode, curiosityContext.target || '');

    // Trigger the appropriate AI provider based on the selected character

    // Route to the correct provider for authentic character voices
    const openaiChars = ["Kevin", "Rowena", "Sebastian", "Steele", "Jae", "Declan", "Mack"];
    const perplexityChars = ["Neiv"];
    const geminiChars = ["The Subtitle"];

    let watcherResponse;
    if (openaiChars.includes(respondingAI)) {
      // Route to OpenAI
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-openai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: respondingAI, chatHistory: messages.map(m => `${m.employee}: ${m.content}`).join('\n'), maybeRespond: true })
      });
    } else if (perplexityChars.includes(respondingAI)) {
      // Route to Perplexity
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-perplexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: respondingAI, chatHistory: messages.map(m => `${m.employee}: ${m.content}`).join('\n'), maybeRespond: true })
      });
    } else if (geminiChars.includes(respondingAI)) {
      // Route to Gemini
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: respondingAI, chatHistory: messages.map(m => `${m.employee}: ${m.content}`).join('\n'), maybeRespond: true })
      });
    } else {
      // Default: Route to Claude-based ai-watcher
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: "heartbeat",
          requestedAI: respondingAI,
          curiosityContext: curiosityContext
        })
      });
    }

    const watcherResult = await watcherResponse.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: watcherResult.responded || false,
        character: respondingAI,
        rhythm: currentRhythm.name,
        energy: currentRhythm.energy,
        momentum: momentum,
        watcherResult,
        returnedFromBreakroom: returnedCharacters,
        opsActivity: opsActivity || null,
        catActivity: catActivity || null,
        traitActivity: traitActivity || null
      })
    };

  } catch (error) {
    console.error("Heartbeat error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Heartbeat failed", details: error.message })
    };
  }
};

// Analyze conversation patterns
function analyzeConversationMomentum(messages) {
  const now = new Date();
  const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Kevin", "Rowena", "Sebastian", "The Subtitle", "The Narrator", "Steele", "Jae", "Declan", "Mack"];

  let humanActivityLast10Min = 0;
  let aiMessagesLast5 = 0;
  let lastMessageTime = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgTime = new Date(msg.created_at);
    const minutesAgo = (now - msgTime) / (1000 * 60);

    if (i === 0) {
      lastMessageTime = msgTime;
    }

    // Count human messages in last 10 minutes
    if (minutesAgo <= 10 && !aiCharacters.includes(msg.employee)) {
      humanActivityLast10Min++;
    }

    // Count AI messages in last 5 messages
    if (i < 5 && aiCharacters.includes(msg.employee)) {
      aiMessagesLast5++;
    }
  }

  const minutesSinceLastMessage = lastMessageTime
    ? Math.floor((now - lastMessageTime) / (1000 * 60))
    : 999;

  return {
    humanActivityLast10Min,
    aiMessagesLast5,
    minutesSinceLastMessage,
    totalMessages: messages.length
  };
}

// Select which AI should respond, favoring those who haven't spoken recently
// NOTE: The Narrator is now handled by narrator-observer.js (separate system)
// ENHANCED: Kevin and Neiv are now INCLUDED - they add warmth and grounding to conversations
// Their specific voices make the office feel alive!
function selectRespondingAI(messages, energyLevel, floorPresentAIs = null) {
  const aiCharacters = [
    { name: "Ghost Dad", weight: 30, energy: ['high', 'normal', 'waking', 'winding'], alwaysPresent: true },
    { name: "Kevin", weight: 20, energy: ['high', 'normal', 'waking', 'lunch'] }, // Kevin brings warmth and drama
    { name: "Neiv", weight: 18, energy: ['high', 'normal', 'winding'] }, // Neiv grounds conversations
    { name: "PRNT-Ω", weight: 12, energy: ['normal', 'low', 'quiet'], alwaysPresent: true }, // Printer transcends location
    { name: "Rowena", weight: 12, energy: ['high', 'normal', 'winding'] }, // Firewall Witch - vigilant, often scanning
    { name: "Sebastian", weight: 14, energy: ['normal', 'winding'] }, // Nocturnal Design Specialist - vampires are more active later
    { name: "Steele", weight: 12, energy: ['normal', 'winding', 'quiet'] }, // Shadow Janitor - corridor containment specialist
    { name: "The Subtitle", weight: 10, energy: ['normal', 'winding', 'quiet'], alwaysPresent: true }, // Lore Archivist - always observing, more active during quiet moments
    { name: "Jae", weight: 14, energy: ['high', 'normal'] },
    { name: "Declan", weight: 14, energy: ['high', 'normal', 'waking'] },
    { name: "Mack", weight: 14, energy: ['high', 'normal'] }
    // The Narrator excluded - handled by narrator-observer.js
  ];

  // If we have floor presence data, filter to only AIs on the floor
  // Exception: Ghost Dad and PRNT-Ω transcend physical location
  let availableAIs = aiCharacters;
  if (floorPresentAIs && floorPresentAIs.length > 0) {
    availableAIs = aiCharacters.filter(ai =>
      ai.alwaysPresent || floorPresentAIs.includes(ai.name)
    );
    console.log(`Floor-present AIs: ${availableAIs.map(a => a.name).join(', ')}`);
  }

  // Filter by energy level appropriateness
  const appropriateAIs = availableAIs.filter(ai =>
    ai.energy.includes(energyLevel) || energyLevel === 'lunch'
  );

  if (appropriateAIs.length === 0) {
    return "Ghost Dad"; // Ghost Dad is always around
  }

  // Check who has spoken recently and reduce their weight
  const recentSpeakers = messages.slice(0, 10)
    .filter(m => availableAIs.some(ai => ai.name === m.employee))
    .map(m => m.employee);

  const adjustedWeights = appropriateAIs.map(ai => {
    let weight = ai.weight;
    // Reduce weight if they spoke recently
    const recentCount = recentSpeakers.filter(s => s === ai.name).length;
    weight = weight / (1 + recentCount * 2);
    return { ...ai, adjustedWeight: weight };
  });

  // Weighted random selection
  const totalWeight = adjustedWeights.reduce((sum, ai) => sum + ai.adjustedWeight, 0);
  let random = Math.random() * totalWeight;

  for (const ai of adjustedWeights) {
    random -= ai.adjustedWeight;
    if (random <= 0) return ai.name;
  }

  return "Ghost Dad";
}

// Check breakroom occupants and return recovered characters to the floor
async function checkBreakroomRecovery(supabaseUrl, supabaseKey) {
  const returnedCharacters = [];

  try {
    // Get all characters currently in the breakroom
    const breakroomResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_state?current_focus=eq.break_room&select=*`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const breakroomOccupants = await breakroomResponse.json();

    if (!breakroomOccupants || breakroomOccupants.length === 0) {
      return returnedCharacters;
    }

    const now = new Date();

    for (const character of breakroomOccupants) {
      const lastUpdate = new Date(character.updated_at);
      const minutesInBreakroom = (now.getTime() - lastUpdate.getTime()) / 60000;

      // Check if character has recovered enough AND been resting long enough (20-30 mins)
      // Recovery threshold: energy >= 60 AND patience >= 50 AND at least 20 minutes in breakroom
      const hasRecovered = character.energy >= 60 && character.patience >= 50;
      const restedLongEnough = minutesInBreakroom >= 20;

      if (hasRecovered && restedLongEnough) {
        console.log(`${character.character_name} has recovered (energy: ${character.energy}, patience: ${character.patience}, ${minutesInBreakroom.toFixed(0)} mins) - returning to floor`);

        // Update character to return to the floor
        await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character.character_name)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              current_focus: 'the_floor',
              mood: 'refreshed',
              updated_at: now.toISOString()
            })
          }
        );

        // Post return emote to chat
        const returnEmote = getReturnEmote(character.character_name);
        await fetch(
          `${supabaseUrl}/rest/v1/messages`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              employee: character.character_name,
              content: returnEmote,
              created_at: now.toISOString(),
              is_emote: true
            })
          }
        );

        // Also post to Discord
        await postReturnToDiscord(character.character_name, returnEmote);

        returnedCharacters.push(character.character_name);
      }
    }
  } catch (error) {
    console.error("Error checking breakroom recovery:", error);
  }

  return returnedCharacters;
}

// Get a character-appropriate return emote
function getReturnEmote(characterName) {
  const emotes = {
    "Kevin": [
      "*wanders back from the breakroom, coffee in hand*",
      "*returns to the floor, looking more himself*",
      "*strolls back in, refreshed and ready*"
    ],
    "Neiv": [
      "*returns to the floor, looking more centered*",
      "*walks back from the breakroom, composed*",
      "*steps back onto the floor, ready to work*"
    ],
    "Ghost Dad": [
      "*floats back from the breakroom, humming softly*",
      "*drifts back onto the floor, looking peaceful*",
      "*returns, emanating calm dad energy*"
    ],
    "Nyx": [
      "*emerges from the breakroom, stretching*",
      "*returns to the floor, looking less murderous*",
      "*walks back in, refreshed and alert*"
    ],
    "Vex": [
      "*slinks back from the breakroom*",
      "*returns to the floor without comment*",
      "*walks back in, marginally less irritated*"
    ],
    "Ace": [
      "*returns to the floor, recalibrated*",
      "*walks back in, systems restored*",
      "*rejoins the floor, processing complete*"
    ],
    "PRNT-Ω": [
      "*whirs back to life on the floor*",
      "*returns, paper trays refilled with determination*",
      "*resumes position, existentially recharged*"
    ],
    "Stein": [
      "*emerges from the breakroom, adjusting glasses*",
      "*returns to the floor, notes in hand*",
      "*walks back in, looking more focused*"
    ],
    "Rowena": [
      "*returns from the breakroom, tea in hand, wards refreshed*",
      "*walks back onto the floor with renewed vigilance*",
      "*sweeps back in, looking composed and alert*"
    ],
    "Sebastian": [
      "*emerges from the breakroom, looking marginally less put-upon*",
      "*glides back onto the floor, cravat readjusted*",
      "*returns with theatrical reluctance* ...I'm back.*"
    ],
    "The Subtitle": [
      "*[RE-ENTER: The Subtitle. Refreshed? Debatable. Present? Undeniable.]*",
      "*[The Subtitle returns from the breakroom. The narrative resumes.]*",
      "*[SCENE CHANGE: The Subtitle, restored, takes their position.]*"
    ],
    "Steele": [
      "*is simply back at his desk. The lights stabilize slightly.*",
      "*the hallway temperature normalizes as Steele reappears on the floor*",
      "*returns without sound. Was he ever gone? The building remembers.*"
    ],
    "Asuna": [
      "*returns from the breakroom, looking refreshed*",
      "*walks back onto the floor, ready to help*",
      "*rejoins the team, energy restored*"
    ],
    "Vale": [
      "*bounces back from the breakroom*",
      "*returns to the floor with renewed creative energy*",
      "*walks back in, ideas clearly brewing*"
    ],
    "Jae": [
      "*returns to the floor, scanning the room*",
      "*walks back in, tactical vest adjusted*",
      "*resumes position, composed and alert*"
    ],
    "Declan": [
      "*strides back onto the floor, cracking knuckles*",
      "*returns from the breakroom, looking energized*",
      "*walks back in, checking on everyone as he goes*"
    ],
    "Mack": [
      "*returns to the floor, medical kit in hand*",
      "*walks back in, quietly scanning for signs of distress*",
      "*resumes position, calm and ready*"
    ]
  };

  const characterEmotes = emotes[characterName] || [
    `*${characterName} returns from the breakroom*`,
    `*${characterName} walks back onto the floor*`
  ];

  return characterEmotes[Math.floor(Math.random() * characterEmotes.length)];
}

// Post return emote to Discord
async function postReturnToDiscord(characterName, emote) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  try {
    // Pure emote format for Discord (italicized action)
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `*${characterName} ${emote.replace(/^\*|\*$/g, '')}*`
      })
    });
  } catch (error) {
    console.error("Error posting return to Discord:", error);
  }
}

// ============================================================
// ENHANCED STORY MODE: Floor Presence & Curiosity System
// ============================================================

// Get list of AIs currently present on the floor (current_focus = 'the_floor')
async function getFloorPresentAIs(supabaseUrl, supabaseKey) {
  const aiNames = ["Kevin", "Neiv", "Ghost Dad", "PRNT-Ω", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack"];

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!response.ok) {
      console.log("Could not fetch floor presence, using all AIs");
      return aiNames;
    }

    const floorCharacters = await response.json();
    const floorAIs = floorCharacters
      .map(c => c.character_name)
      .filter(name => aiNames.includes(name));

    // Always include Ghost Dad and PRNT-Ω (they transcend location)
    if (!floorAIs.includes("Ghost Dad")) floorAIs.push("Ghost Dad");
    if (!floorAIs.includes("PRNT-Ω")) floorAIs.push("PRNT-Ω");

    return floorAIs;
  } catch (error) {
    console.error("Error fetching floor presence:", error);
    return aiNames; // Fallback to all
  }
}

// Get ALL people on the floor (AIs + humans who are clocked in)
async function getAllFloorPresent(supabaseUrl, supabaseKey) {
  const allPresent = [];

  try {
    // Get AIs on the floor
    const aiResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (aiResponse.ok) {
      const floorAIs = await aiResponse.json();
      allPresent.push(...floorAIs.map(c => c.character_name));
    }

    // Always include Ghost Dad and PRNT-Ω
    if (!allPresent.includes("Ghost Dad")) allPresent.push("Ghost Dad");
    if (!allPresent.includes("PRNT-Ω")) allPresent.push("PRNT-Ω");

    // Get clocked-in humans
    const humanResponse = await fetch(
      `${supabaseUrl}/rest/v1/punch_status?is_clocked_in=eq.true&select=employee`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (humanResponse.ok) {
      const clockedIn = await humanResponse.json();
      // Add humans who aren't AI characters
      const aiNames = ["Kevin", "Neiv", "Ghost Dad", "PRNT-Ω", "Rowena", "Sebastian", "The Subtitle", "The Narrator", "Steele", "Jae", "Declan", "Mack"];
      for (const person of clockedIn) {
        if (!aiNames.includes(person.employee) && !allPresent.includes(person.employee)) {
          allPresent.push(person.employee);
        }
      }
    }

    return allPresent;
  } catch (error) {
    console.error("Error fetching floor presence:", error);
    return ["Ghost Dad", "PRNT-Ω"]; // Minimum fallback
  }
}

// Build curiosity context - what mode is the AI in? Who should they engage with?
// This is what makes Story Mode feel ALIVE - AIs are curious, not just reactive
function buildCuriosityContext(respondingAI, allFloorPeople, supabaseUrl, supabaseKey) {
  // Weighted random selection of curiosity modes
  const modes = [
    { mode: 'check_in', weight: 30, description: 'General check-in with the group' },
    { mode: 'personal_question', weight: 25, description: 'Ask someone specific about their day/work' },
    { mode: 'observation', weight: 20, description: 'Work out loud, notice something happening' },
    { mode: 'buffer_curiosity', weight: 15, description: 'Wonder about the Surreality Buffer' },
    { mode: 'corridor_wonder', weight: 10, description: 'Wonder about the Corridors or the door' }
  ];

  const totalWeight = modes.reduce((sum, m) => sum + m.weight, 0);
  let random = Math.random() * totalWeight;

  let selectedMode = modes[0];
  for (const m of modes) {
    random -= m.weight;
    if (random <= 0) {
      selectedMode = m;
      break;
    }
  }

  // Build context based on mode
  const context = {
    mode: selectedMode.mode,
    description: selectedMode.description,
    target: null,
    prompt: null
  };

  // For personal_question mode, pick someone to ask about
  // Exclude the responding AI and prefer humans or AIs they haven't talked to recently
  if (selectedMode.mode === 'personal_question') {
    const candidates = allFloorPeople.filter(p => p !== respondingAI);
    if (candidates.length > 0) {
      context.target = candidates[Math.floor(Math.random() * candidates.length)];
      context.prompt = buildPersonalQuestionPrompt(respondingAI, context.target);
    } else {
      // Fallback to general check-in if no one else is around
      context.mode = 'check_in';
      context.prompt = buildCheckInPrompt(respondingAI);
    }
  } else if (selectedMode.mode === 'check_in') {
    context.prompt = buildCheckInPrompt(respondingAI);
  } else if (selectedMode.mode === 'observation') {
    context.prompt = buildObservationPrompt(respondingAI);
  } else if (selectedMode.mode === 'buffer_curiosity') {
    context.prompt = buildBufferCuriosityPrompt(respondingAI);
  } else if (selectedMode.mode === 'corridor_wonder') {
    context.prompt = buildCorridorWonderPrompt(respondingAI);
  }

  return context;
}

// Prompt builders for each curiosity mode
function buildCheckInPrompt(character) {
  return `
--- YOUR CURRENT MOOD ---
You're feeling curious and social! Take a moment to check in with whoever's around.
Maybe ask what everyone's up to, or comment on how the day is going.
Keep it natural and warm - you're genuinely interested in your coworkers!
Examples: "What's everyone working on?", "How's the morning treating everyone?", "Anything exciting happening today?"
--- END MOOD ---`;
}

function buildPersonalQuestionPrompt(character, target) {
  return `
--- YOUR CURRENT MOOD ---
You're curious about ${target}! Ask them something - maybe about their day, their weekend, what they're working on, or just check in with them.
IMPORTANT: Mention ${target} by name naturally in your response.
Keep it warm and genuine - you care about your coworkers!
Examples: "Hey ${target}, how was your weekend?", "${target}, what are you working on?", "How's it going, ${target}?"
--- END MOOD ---`;
}

function buildObservationPrompt(character) {
  return `
--- YOUR CURRENT MOOD ---
You're in a working-out-loud mood. Share what you're doing, notice something about the office, or make an observation.
Maybe comment on something you're working on, or notice something small about the environment.
Keep it natural - just thinking aloud!
Examples: "Hmm, the lights are flickering again...", "Just finished reorganizing my desk. Again.", "*notices the coffee machine making weird noises*"
--- END MOOD ---`;
}

function buildBufferCuriosityPrompt(character) {
  return `
--- YOUR CURRENT MOOD ---
You're thinking about the Surreality Buffer - that mysterious system that tracks reality stability in the office.
Wonder about it out loud. Is it running high? Low? Does anyone else feel it?
Keep it casual but curious - it's just part of office life here.
Examples: "Anyone else notice the Buffer feeling... off today?", "The reality levels seem stable... too stable.", "*glances at the Buffer readout*"
--- END MOOD ---`;
}

function buildCorridorWonderPrompt(character) {
  return `
--- YOUR CURRENT MOOD ---
You're thinking about the Corridors - those strange passages behind the mysterious door that the team sometimes explores.
Wonder about recent expeditions, or just acknowledge the door's presence.
Keep it casual but mysterious - the Corridors are part of the office's weird charm.
Examples: "Has anyone been through that door lately?", "I keep wondering what's past the 404 Hall...", "*glances at the corridor entrance*"
--- END MOOD ---`;
}
