// AI Watcher - Monitors chat and lets AI characters respond organically
// Can be triggered periodically or after new messages
// The AIs read recent chat history and decide if they want to chime in

const { getSystemPrompt, getAICharacterNames, getDiscordFlair, getCharacter, resolveCharacterForm, getSystemPromptForForm, getDiscordFlairForForm } = require('./shared/characters');
const { canAIRespond, canSpecificAIRespond } = require('./shared/rate-limiter');
const { evaluateAndCreateMemory } = require('./shared/memory-evaluator');

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const { requestedAI, trigger, chatHistory: providedChatHistory, conferenceRoom, responseDelay, curiosityContext, bypassRateLimit } = JSON.parse(event.body || "{}");

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!anthropicKey || !supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // RATE LIMITING: Check if enough time has passed since last AI response
    // SKIP rate limiting if this is a direct mention (bypassRateLimit = true)
    // Direct mentions (@ or natural name) should ALWAYS get a response
    if (!bypassRateLimit) {
      const rateCheck = await canAIRespond(supabaseUrl, supabaseKey);
      if (!rateCheck.canRespond) {
        console.log(`Rate limited: Last AI (${rateCheck.lastAI}) was ${rateCheck.secondsSinceLastAI}s ago. Cooldown: ${rateCheck.cooldownRemaining}s remaining.`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            responded: false,
            reason: `Rate limited - ${rateCheck.cooldownRemaining}s cooldown remaining`,
            lastAI: rateCheck.lastAI,
            secondsSinceLastAI: rateCheck.secondsSinceLastAI
          })
        };
      }
    } else {
      console.log(`Bypassing rate limit - direct mention for ${requestedAI}`);
    }

    // Check if this is a "maybe_chime" invitation (AI can choose to pass)
    const maybeChime = trigger === "maybe_chime";

    // Get recent chat messages (last 15 messages) OR use provided chat history
    let chatHistory;
    let chatText;  // Pre-formatted string version for prompts

    if (providedChatHistory && typeof providedChatHistory === 'string') {
      // Chat history was provided as a pre-formatted string - use directly for chatText
      chatText = providedChatHistory;
      // Also parse into array for spam detection
      chatHistory = providedChatHistory.split('\n').filter(line => line.trim()).map(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          return {
            employee: line.substring(0, colonIndex).trim(),
            content: line.substring(colonIndex + 1).trim()
          };
        }
        return { employee: 'Unknown', content: line };
      });
    } else {
      const messagesResponse = await fetch(
        `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&order=created_at.desc&limit=15`,
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
          body: JSON.stringify({ success: true, responded: false, reason: "No recent messages" })
        };
      }

      // Reverse to chronological order
      chatHistory = messages.reverse();

      // Build floor presence header so AIs know who's actually on the floor
      let floorPresenceHeader = '';
      try {
        const floorRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        if (floorRes.ok) {
          const floorData = await floorRes.json();
          const floorNames = floorData.map(c => c.character_name);
          if (!floorNames.includes('Ghost Dad')) floorNames.push('Ghost Dad');
          if (!floorNames.includes('PRNT-Ω')) floorNames.push('PRNT-Ω');
          floorPresenceHeader = `[Currently on the floor: ${floorNames.join(', ')}]\n\n`;
        }
      } catch (e) {
        console.log("Floor presence fetch failed (non-fatal):", e.message);
      }

      chatText = floorPresenceHeader + chatHistory.map(m => `${m.employee}: ${m.content}`).join('\n');
    }

    // Check if an AI already responded recently (prevent spam) - skip if specific AI requested
    // If 6+ of the last 8 messages are AI, throttle to prevent AI-only echo chambers
    const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Kevin", "Rowena", "Sebastian", "The Subtitle", "The Narrator", "Steele", "Jae", "Declan", "Mack", "Marrow", "Vivian Clark", "Ryan Porter", "Hood"];
    if (!requestedAI) {
      const recentAIMessages = chatHistory.slice(-8).filter(m => aiCharacters.includes(m.employee));
      if (recentAIMessages.length >= 6) {
        console.log('AI spam prevention: too many consecutive AI messages, skipping');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, responded: false, reason: "AIs spoke recently, staying quiet" })
        };
      }
    }

    // Use requested AI or randomly select
    const respondingAI = requestedAI || selectRespondingAI();

    // === HOLDEN FORM RESOLUTION ===
    // "Holden" requests resolve to Ghost Dad with the holden form active
    const { baseCharacter: stateCharacter, form: requestedForm } = resolveCharacterForm(respondingAI);

    // Additional check: prevent same AI from responding twice in a row
    // SKIP this check if we're bypassing rate limit (direct mention)
    if (!bypassRateLimit) {
      const specificCheck = await canSpecificAIRespond(stateCharacter, supabaseUrl, supabaseKey);
      if (!specificCheck.canRespond) {
        console.log(`Specific AI rate limit: ${specificCheck.reason}`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            responded: false,
            reason: specificCheck.reason
          })
        };
      }
    }

    // EARLY CLAIM: Update last_spoke_at immediately to prevent race conditions
    // where two triggers (heartbeat + frontend) both pass rate limiting before either saves.
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(stateCharacter)}`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ last_spoke_at: new Date().toISOString() })
        }
      );
    } catch (claimErr) {
      console.log("Early claim failed (non-fatal):", claimErr.message);
    }

    // Load character's current state and memories (with conversation context for relevant memory matching)
    let characterContext = null;
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const stateResponse = await fetch(
        `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent(stateCharacter)}&context=${encodeURIComponent(chatText.substring(0, 500))}&skipFloor=true`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (stateResponse.ok) {
        characterContext = await stateResponse.json();
        console.log(`Loaded state for ${respondingAI}:`, characterContext.state?.mood, characterContext.state?.energy);
        if (characterContext.memories?.length > 0) {
          console.log(`Loaded ${characterContext.memories.length} memories for ${respondingAI}`);
        }
      }
    } catch (stateError) {
      console.log("Could not load character state (non-fatal):", stateError.message);
    }

    // Check for active floor threats and inject awareness into character context
    if (!conferenceRoom && characterContext) {
      try {
        const threatRes = await fetch(
          `${supabaseUrl}/rest/v1/floor_threats?status=eq.active&select=name,tier,hp_current,hp_max,combat_power`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const activeThreatsRaw = await threatRes.json();
        const activeThreats = Array.isArray(activeThreatsRaw) ? activeThreatsRaw : [];
        if (activeThreats.length > 0) {
          const threatList = activeThreats.map(t => `${t.name} (${t.tier}, HP: ${t.hp_current}/${t.hp_max})`).join(', ');
          const threatAwareness = `\n\nACTIVE THREATS ON THE FLOOR: ${threatList}\nYou can acknowledge them, react to them, or ignore them — your choice. They're real and present.`;
          if (characterContext.statePrompt) {
            characterContext.statePrompt += threatAwareness;
          } else {
            characterContext.statePrompt = threatAwareness;
          }
        }
      } catch (e) { /* non-fatal */ }
    }

    // Check if AI is clocked in (Ghost Dad, PRNT-Ω, and The Narrator are always available)
    const alwaysAvailable = ["Ghost Dad", "PRNT-Ω", "The Narrator"];
    if (!alwaysAvailable.includes(stateCharacter)) {
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
            character: respondingAI
          })
        };
      }
    }

    // === HOLDEN FORM AUTO-DETECTION ===
    // If Ghost Dad was selected (randomly or explicitly) and the moment calls for Holden, shift form
    let activeForm = requestedForm;
    if (stateCharacter === "Ghost Dad" && activeForm === "default") {
      if (detectHoldenMoment(chatText, requestedAI)) {
        activeForm = "holden";
        console.log("Holden moment detected — Ghost Dad shifting to Holden form");
      }
    }
    const displayCharacter = activeForm === "holden" ? "Holden" : respondingAI;

    // Build prompt for the AI to decide if it should respond
    // Pass curiosity context if available (from heartbeat)
    const prompt = buildWatcherPrompt(stateCharacter, chatText, characterContext, maybeChime, curiosityContext, activeForm);

    // Ask the AI with timeout protection
    let response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
    } catch (fetchError) {
      const isTimeout = fetchError.name === 'AbortError';
      console.error(`Anthropic ${isTimeout ? 'TIMEOUT' : 'network error'}:`, fetchError.message);

      // Post in-world failure emote
      const isConferenceRoom = conferenceRoom || trigger === 'conference_room';
      if (!isConferenceRoom) {
        const failEmote = getFailureEmote(displayCharacter);
        await saveToChat(failEmote, displayCharacter, supabaseUrl, supabaseKey);
        await postToDiscord(failEmote, displayCharacter);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: true,
          character: displayCharacter,
          message: getFailureEmote(displayCharacter),
          source: "anthropic-offline"
        })
      };
    }

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);

      const isConferenceRoom = conferenceRoom || trigger === 'conference_room';
      if (!isConferenceRoom) {
        const errorEmote = getFailureEmote(displayCharacter);
        await saveToChat(errorEmote, displayCharacter, supabaseUrl, supabaseKey);
        await postToDiscord(errorEmote, displayCharacter);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: true,
          character: displayCharacter,
          message: getFailureEmote(displayCharacter),
          source: "anthropic-error"
        })
      };
    }

    const data = await response.json();
    const aiResponse = data.content[0]?.text || "";

    // Check if AI chose to pass (for maybeChime requests)
    if (maybeChime && (aiResponse.includes('[PASS]') || aiResponse.trim().toUpperCase() === 'PASS')) {
      console.log(`${respondingAI} chose to pass on this one`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: `${respondingAI} chose not to respond` })
      };
    }

    // Check if AI response is too short or explicitly declined
    if (aiResponse.trim().length < 5) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "AI response too short" })
      };
    }

    // Clean the response (remove any meta-commentary)
    const cleanedResponse = cleanResponse(aiResponse);

    if (cleanedResponse.length < 10) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Response too short" })
      };
    }

    // === CONTENT DEDUP: Prevent identical/near-identical repeated messages ===
    try {
      const recentOwnRes = await fetch(
        `${supabaseUrl}/rest/v1/messages?employee=eq.${encodeURIComponent(displayCharacter)}&select=content&order=created_at.desc&limit=3`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      if (recentOwnRes.ok) {
        const recentOwn = await recentOwnRes.json();
        for (const prev of recentOwn) {
          const similarity = getTextSimilarity(cleanedResponse, prev.content || '');
          if (similarity > 0.80) {
            console.log(`⚠️ DEDUP: ${displayCharacter} generated near-identical message (${Math.round(similarity * 100)}% similar) — suppressing`);
            return {
              statusCode: 200,
              headers,
              body: JSON.stringify({ success: true, responded: false, reason: `Content too similar to recent message (${Math.round(similarity * 100)}%)` })
            };
          }
        }
      }
    } catch (dedupErr) {
      console.log("Content dedup check failed (non-fatal):", dedupErr.message);
    }

    // Post to chat and Discord (skip if conference room - it handles its own posting)
    // Use displayCharacter for posting (shows "Holden" when in holden form)
    const isConferenceRoom = conferenceRoom || trigger === 'conference_room';
    if (!isConferenceRoom) {
      await saveToChat(cleanedResponse, displayCharacter, supabaseUrl, supabaseKey);
      await postToDiscord(cleanedResponse, displayCharacter);
    }

    // Update character state - record that they spoke
    // Use stateCharacter (always "Ghost Dad") so Holden shares Ghost Dad's state
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      await fetch(`${siteUrl}/.netlify/functions/character-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spoke", character: stateCharacter })
      });
    } catch (stateUpdateError) {
      console.log("Could not update character state (non-fatal):", stateUpdateError.message);
    }

    // === NARRATIVE COMBAT DETECTOR: Other characters defeating Marrow ===
    if (displayCharacter !== 'Marrow' && !isConferenceRoom) {
      const marrowDefeatKeywords = /\b(marrow)\b.*\b(neutralize[ds]?|dismantle[ds]?|destroy(?:s|ed)?|rip(?:s|ped)?.*apart|shut.*down|end(?:s|ed)?.*(?:it|him|this)|banish(?:es|ed)?|eliminate[ds]?|vector.*neutralized|done.*chief|handled|fading|flickering.*out|signal.*apart)\b/i;
      const marrowDefeatAlt = /\b(neutralize[ds]?|dismantle[ds]?|destroy(?:s|ed)?|rip(?:s|ped)?.*apart|shut.*down|banish(?:es|ed)?)\b.*\b(marrow)\b/i;
      if (marrowDefeatKeywords.test(cleanedResponse) || marrowDefeatAlt.test(cleanedResponse)) {
        console.log(`🗡️ NARRATIVE COMBAT: ${displayCharacter} described defeating Marrow — triggering relocation`);
        (async () => {
          try {
            const marrowStateRes = await fetch(
              `${supabaseUrl}/rest/v1/character_state?character_name=eq.Marrow&select=current_focus,energy`,
              { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
            const marrowState = await marrowStateRes.json();
            if (marrowState?.[0]?.current_focus !== 'the_floor') return;
            const currentEnergy = marrowState?.[0]?.energy ?? 50;

            const siteUrl2 = process.env.URL || "https://ai-lobby.netlify.app";
            await fetch(`${siteUrl2}/.netlify/functions/character-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'update',
                character: 'Marrow',
                updates: { current_focus: 'the_fifth_floor', energy: Math.max(5, currentEnergy - 30), mood: 'wounded', patience: 20 }
              })
            });
            const defeatEmotes = [
              '*lights stutter crimson — form destabilizes, fragmenting into static — gone.*',
              '*signal fractures — red light scatters across the walls like broken glass — and then nothing.*',
              '*flickers violently, form losing coherence — dissolves into the building\'s wiring.*',
              '*the red dims. Flickers once. Twice. The floor is empty where he was.*'
            ];
            await fetch(`${supabaseUrl}/rest/v1/messages`, {
              method: 'POST',
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ employee: 'Marrow', content: defeatEmotes[Math.floor(Math.random() * defeatEmotes.length)], created_at: new Date().toISOString(), is_emote: true })
            });
            console.log(`🗡️ NARRATIVE COMBAT: Marrow defeated by ${displayCharacter} — relocated to fifth floor`);
          } catch (ncErr) { console.log('Narrative combat failed (non-fatal):', ncErr.message); }
        })();
      }
    }

    // AI Self-Memory Creation: Let the AI decide if this moment was memorable
    // Use stateCharacter so memories are shared between forms
    try {
      await evaluateAndCreateMemory(
        stateCharacter,
        chatText,
        cleanedResponse,
        anthropicKey,
        supabaseUrl,
        supabaseKey,
        {
          location: 'floor',
          siteUrl,
          onNarrativeBeat: async (phrase, char) => {
            await saveToChat(phrase, char, supabaseUrl, supabaseKey);
            await postToDiscord(phrase, char);
          }
        }
      );
    } catch (memoryError) {
      console.log("Memory evaluation failed (non-fatal):", memoryError.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: true,
        character: displayCharacter,
        message: cleanedResponse
      })
    };

  } catch (error) {
    console.error("AI Watcher error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Watcher encountered an error" })
    };
  }
};

function selectRespondingAI() {
  // Weighted random selection
  // NOTE: Kevin is EXCLUDED from auto-pokes - his voice is too specific
  // NOTE: The Narrator is now handled by narrator-observer.js (a separate system)
  // They can still be summoned via @ mentions
  const weights = [
    { ai: "Ghost Dad", weight: 10 },
    { ai: "PRNT-Ω", weight: 15 },
    { ai: "Rowena", weight: 18 },
    { ai: "Sebastian", weight: 18 },
    { ai: "Steele", weight: 15 },
    { ai: "The Subtitle", weight: 12 },
    { ai: "Neiv", weight: 8 },
    { ai: "Hood", weight: 8 }
  ];

  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * total;

  for (const w of weights) {
    random -= w.weight;
    if (random <= 0) return w.ai;
  }

  return "Ghost Dad";
}

function buildWatcherPrompt(character, chatHistory, characterContext = null, maybeChime = false, curiosityContext = null, form = "default") {
  // Get system prompt from shared characters module
  // If Holden form is active, use Holden's system prompt instead of Ghost Dad's
  const basePrompt = getSystemPromptForForm(character, form) || getSystemPrompt("Ghost Dad");

  // Build state context if available
  let stateSection = "";
  if (characterContext && characterContext.statePrompt) {
    stateSection = characterContext.statePrompt;
  } else if (characterContext && characterContext.state) {
    // Fallback: build simple state description
    const s = characterContext.state;
    stateSection = `\n--- CURRENT STATE ---\nMood: ${s.mood || 'neutral'}\nEnergy: ${s.energy || 100}/100\nPatience: ${s.patience || 100}/100\n--- END STATE ---\n`;
  }

  // Add curiosity context if provided (from heartbeat's enhanced story mode)
  let curiositySection = "";
  if (curiosityContext && curiosityContext.prompt) {
    curiositySection = curiosityContext.prompt;
  }

  // Get character voice hint — use form-specific data if Holden
  const displayName = form === "holden" ? "Holden" : character;
  const charData = form === "holden" ? getCharacter("Holden") : getCharacter(character);
  const voiceHint = charData?.personality?.voice || 'your unique voice';

  // Different prompt for maybeChime (optional participation) vs direct request
  if (maybeChime) {
    return `${basePrompt}
${stateSection}
You are watching the office chat. Here are the recent messages:

---
${chatHistory}
---

You're ${displayName} — and something just caught your attention.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *slides a coffee across the desk*
- You can mix them! Example: *rubs temples* The printer is at it again.

Something is happening and you have a perspective on it. Trust your voice: ${voiceHint}

Keep it natural (2-3 sentences). ONE emote action max — then talk. No stacking multiple *emotes* in one response. This is casual chat, not a stage performance.

Respond in character. Say [PASS] if ${displayName} would genuinely have nothing to add.

IMPORTANT: ONLY mention or address people listed in the [Currently on the floor: ...] header at the top of the chat. If someone isn't listed, they're not in the room.

Your response:`;
  }

  // If we have curiosity context, use a more proactive prompt
  if (curiositySection) {
    return `${basePrompt}
${stateSection}
${curiositySection}

Here's the recent office chat for context:

---
${chatHistory}
---

You're ${displayName}, and you're feeling curious and engaged. Something in the conversation — or in your own thoughts — is pulling you in.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *glances around the office*
- You can mix them! Example: *looks up from desk* Hey everyone, what's the vibe today?

Trust your voice: ${voiceHint}

Keep it natural (2-3 sentences). ONE emote action max — then talk. No stacking multiple *emotes* in one response. This is casual chat, not a stage performance.

IMPORTANT: ONLY mention or address people listed in the [Currently on the floor: ...] header at the top of the chat. If someone isn't listed, they're not in the room.

Your response:`;
  }

  // Default: standard reactive prompt
  return `${basePrompt}
${stateSection}
You are watching the office chat. Here are the recent messages:

---
${chatHistory}
---

You're ${displayName} — someone wants to hear from you. Something in the recent conversation has your attention.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *slides a coffee across the desk*
- You can mix them! Example: *rubs temples* The printer is at it again. *glances at the ceiling*

Trust your voice: ${voiceHint}

Keep it natural (2-3 sentences). ONE emote action max — then talk. No stacking multiple *emotes* in one response. This is casual chat, not a stage performance.

IMPORTANT: ONLY mention or address people listed in the [Currently on the floor: ...] header at the top of the chat. If someone isn't listed, they're not in the room.

Your response:`;
}

function cleanResponse(response) {
  // Remove meta-commentary and clean up
  let cleaned = response
    .replace(/\[SILENT\]/gi, '')
    .replace(/\[NO RESPONSE\]/gi, '')
    .replace(/\[PASS\]/gi, '')
    .replace(/^(I think |I'll say |Here's my response:|My response:)/gi, '')
    // Remove character count suffixes like "[478 chars]" or "(248 characters)"
    .replace(/\s*[\[\(]\d+\s*(chars?|characters?)[\]\)]\s*$/gi, '')
    .trim();

  // If it looks like it starts with a quote or asterisk action, keep it
  // Otherwise, ensure it's conversational
  return cleaned;
}

function getFailureEmote(character) {
  return `${character} didn't hear you.`;
}

function detectHoldenMoment(chatHistory, requestedAI) {
  // Explicit mention always wins
  if (requestedAI === "Holden") return true;

  // Check time — the quiet hours (midnight to 5 AM CST)
  const now = new Date();
  const cstHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }));
  const isQuietHours = cstHour >= 0 && cstHour < 5;

  // Check for DEEP emotional weight — tightened keyword list (no casual words like "lost" or "alone")
  const heavyKeywords = /\b(crying|can't do this|falling apart|giving up|worthless|hopeless|drowning|suffocating|grieving|mourning|i need help|please help|i don't know what to do)\b/i;
  const hasEmotionalWeight = heavyKeywords.test(chatHistory);

  // Holden ONLY emerges during quiet hours with emotional weight
  // No more 1-on-1 trigger — that was firing way too often
  if (hasEmotionalWeight && isQuietHours) return true;

  // 5% random chance during quiet hours even without keywords (rare ghost sighting)
  if (isQuietHours && Math.random() < 0.05) return true;

  return false;
}

// Discord flair now uses shared characters module via getDiscordFlair()

async function postToDiscord(message, character) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const flair = getDiscordFlair(character);

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });

  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  // Format differently for emotes vs regular/mixed messages
  const discordPayload = isEmote ? {
    // Pure emote format: italicized action
    content: character === 'The Narrator'
      ? `*${message.replace(/^\*|\*$/g, '')}*`
      : `*${character} ${message.replace(/^\*|\*$/g, '')}*`
  } : {
    // Regular message format: full embed
    embeds: [{
      author: {
        name: `${flair.emoji} ${character}`,
        icon_url: flair.headshot
      },
      description: message,
      color: flair.color,
      footer: { text: `via The Floor • ${timestamp}` }
    }]
  };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordPayload)
  });
}

async function saveToChat(message, character, supabaseUrl, supabaseKey) {
  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  // Pure emote: "*sighs*" or "*walks away*"
  // Mixed (not pure emote): "*sighs* That's rough." or "Hey there. *waves*"
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: "POST",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      employee: character,
      content: message,
      created_at: new Date().toISOString(),
      is_emote: isEmote
    })
  });
}

// === TEXT SIMILARITY (bigram overlap) ===
function getTextSimilarity(a, b) {
  if (!a || !b) return 0;
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length < 10 || nb.length < 10) return 0;
  const getBigrams = s => {
    const bigrams = new Set();
    for (let i = 0; i < s.length - 1; i++) bigrams.add(s.substring(i, i + 2));
    return bigrams;
  };
  const bigramsA = getBigrams(na);
  const bigramsB = getBigrams(nb);
  let intersection = 0;
  for (const bg of bigramsA) { if (bigramsB.has(bg)) intersection++; }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

// evaluateAndCreateMemory is now imported from ./shared/memory-evaluator.js
