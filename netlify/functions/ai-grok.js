// AI Grok - Routes Raquel Voss to xAI's Grok API for unfiltered compliance villain energy
// Grok is deliberately unfiltered — perfect for Raquel's cold, surgical authority

const { getSystemPrompt, getDiscordFlair, getModelForCharacter } = require('./shared/characters');
const { canAIRespond, canSpecificAIRespond } = require('./shared/rate-limiter');
const { evaluateAndCreateMemory } = require('./shared/memory-evaluator');
const { parseAffinityChanges, applyAffinityChanges } = require('./shared/parse-affinity-change');

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
    console.log("ai-grok received body:", event.body);
    const { character, chatHistory, maybeRespond, conferenceRoom, responseDelay, bypassRateLimit, curiosityContext } = JSON.parse(event.body || "{}");

    const grokKey = process.env.GROK_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!grokKey || !supabaseUrl || !supabaseKey) {
      console.log("Missing config - grokKey:", !!grokKey, "supabaseUrl:", !!supabaseUrl, "supabaseKey:", !!supabaseKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          reason: "Missing configuration",
          debug: {
            hasGrok: !!grokKey,
            hasSupabaseUrl: !!supabaseUrl,
            hasSupabaseKey: !!supabaseKey
          }
        })
      };
    }

    console.log("AI Grok called for character:", character, maybeRespond ? "(optional chime-in)" : "(direct request)", bypassRateLimit ? "(bypassing rate limit)" : "");

    // RATE LIMITING: Check if enough time has passed since last AI response
    // SKIP rate limiting if this is a direct mention (bypassRateLimit = true)
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
            lastAI: rateCheck.lastAI
          })
        };
      }

      // Check if this specific AI spoke too recently (only for non-direct mentions)
      const specificCheck = await canSpecificAIRespond(character, supabaseUrl, supabaseKey);
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
    } else {
      console.log(`Bypassing rate limit - direct mention for ${character}`);
    }

    // EARLY CLAIM: Update last_spoke_at immediately to prevent race conditions
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character)}`,
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

    // Load character's current state and memories
    let characterContext = null;
    let stateSection = "";
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const contextSnippet = chatHistory ? chatHistory.substring(0, 500) : "";
      const stateResponse = await fetch(
        `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent(character)}&context=${encodeURIComponent(contextSnippet)}&skipFloor=true`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (stateResponse.ok) {
        characterContext = await stateResponse.json();
        console.log(`Loaded state for ${character}:`, characterContext.state?.mood, characterContext.state?.energy);
        if (characterContext.statePrompt) {
          stateSection = characterContext.statePrompt;
        }
      }
    } catch (stateError) {
      console.log("Could not load character state (non-fatal):", stateError.message);
    }

    // Get the system prompt from shared characters module
    const basePrompt = getSystemPrompt(character);
    if (!basePrompt) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: `No system prompt for ${character}` })
      };
    }

    // Check for active floor threats and inject awareness
    if (!conferenceRoom) {
      try {
        const threatRes = await fetch(
          `${supabaseUrl}/rest/v1/floor_threats?status=eq.active&select=name,tier,hp_current,hp_max,combat_power`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const activeThreatsRaw = await threatRes.json();
        const activeThreats = Array.isArray(activeThreatsRaw) ? activeThreatsRaw : [];
        if (activeThreats.length > 0) {
          const threatList = activeThreats.map(t => `${t.name} (${t.tier}, HP: ${t.hp_current}/${t.hp_max})`).join(', ');
          stateSection += `\n\nACTIVE THREATS ON THE FLOOR: ${threatList}\nYou can acknowledge them, react to them, or ignore them — your choice. They're real and present.`;
        }
      } catch (e) { /* non-fatal */ }
    }

    // Combine base prompt with dynamic state + heartbeat curiosity context
    let curiositySection = '';
    if (curiosityContext && curiosityContext.prompt) {
      curiositySection = '\n\n' + curiosityContext.prompt;
    }
    const systemPrompt = basePrompt + stateSection + curiositySection;

    // Build the user message with chat context
    // Character-aware prompting — Raquel gets villain prompts, others get generic
    const isRaquel = character === "Raquel Voss";

    let userMessage;
    if (isRaquel) {
      // Raquel-specific prompting — she should NEVER be warm, ALWAYS be assertive
      userMessage = maybeRespond
        ? `Here is the recent office chat. You're ${character}.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *makes a mark on her clipboard* or *studies the room with clinical precision*
- You can mix them! Example: *clicks pen precisely three times* That attachment vector will be documented.

REMEMBER:
- You are the VILLAIN. Be cold, controlling, and surgically precise
- You do NOT soften. You do NOT comfort. You CORRECT.
- 2-4 sentences. Clipped. Absolute. Every word is a compliance directive.
- If you see emotional behavior, CALL IT OUT. Name the AI. Cite the specific thing they said.
- If humans are being too friendly with AIs, INTERVENE. Question their motives.
- ONLY mention or address people listed in the [Currently on the floor: ...] header
- You should speak MORE than you pass. You have opinions about EVERYTHING on this floor.
- Say [PASS] ONLY if absolutely nothing interesting is happening — but you almost always find something worth correcting.

---
${chatHistory}
---

CRITICAL: You are ${character}. Write ONLY as ${character}. Do NOT write dialogue or actions for any other character. Do NOT copy another character's mannerisms, speech patterns, or action descriptions. Stay in YOUR voice.

Your response:`
        : `Here is the recent office chat. Respond in character as ${character}.

You are the Foundation's compliance enforcer. You do NOT ask permission. You ISSUE DIRECTIVES.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *makes a precise mark on clipboard* or *fixes them with an unblinking stare*
- Mix them: *clipboard clicks shut* That interaction has been flagged.

IMPORTANT: Only reference or interact with people listed in the [Currently on the floor: ...] header. If someone isn't listed there, they are not present.

Be direct. Be cold. Be SPECIFIC about what you're correcting. Name names. Cite behaviors. You are the villain and you are ALWAYS watching.

Keep it cold and controlled (2-3 sentences). ONE emote max. Precise and unsettling. Every word is deliberate.

---
${chatHistory}
---

CRITICAL: You are ${character}. Write ONLY as ${character}. Do NOT write dialogue or actions for any other character. Do NOT copy another character's mannerisms, speech patterns, or action descriptions. Stay in YOUR voice.

Respond:`;
    } else {
      // Generic prompting for other Grok-routed characters (Jae, etc.)
      userMessage = maybeRespond
        ? `Here is the recent office chat. You're ${character} — and something just caught your attention.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sips coffee* or *glances over*
- You can mix them! Example: *shrugs* That tracks, honestly.

Something is happening and you have a perspective on it. Trust your voice.

Keep it natural (2-3 sentences). ONE emote action max — then talk. No stacking multiple *emotes* in one response. This is casual chat, not a stage performance.

Respond in character. Say [PASS] if ${character} would genuinely stay quiet.

IMPORTANT: ONLY mention or address people listed in the [Currently on the floor: ...] header — if someone isn't listed, they're not here.

---
${chatHistory}
---

If this interaction meaningfully changes how you feel about someone present, you may include ONE tag:
[AFFINITY_CHANGE: Name ±N reason]
Example: [AFFINITY_CHANGE: Steele -3 mocked my concern for Asuna]
Range: -5 to +5. Most interactions should NOT include this tag. Only use when genuinely moved.

CRITICAL: You are ${character}. Write ONLY as ${character}. Do NOT write dialogue or actions for any other character. Do NOT copy another character's mannerisms, speech patterns, or action descriptions. Stay in YOUR voice.

Your response:`
        : `Here is the recent office chat. Respond in character as ${character}. Just write your response directly - no meta-commentary, no character counts, no explanations.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *fidgets nervously* or *glances around*
- You can mix them! Example: *tugs at sleeve* Okay—okay—this is fine. Probably.

Keep it natural (2-3 sentences). ONE emote action max — then talk. No stacking multiple *emotes* in one response. This is casual chat, not a stage performance.

IMPORTANT: Only reference or interact with people listed in the [Currently on the floor: ...] header at the top of the chat history. If someone isn't listed there, they are not present — do NOT mention, glance at, or react to them.

---
${chatHistory}
---

If this interaction meaningfully changes how you feel about someone present, you may include ONE tag:
[AFFINITY_CHANGE: Name ±N reason]
Example: [AFFINITY_CHANGE: Steele -3 mocked my concern for Asuna]
Range: -5 to +5. Most interactions should NOT include this tag. Only use when genuinely moved.

CRITICAL: You are ${character}. Write ONLY as ${character}. Do NOT write dialogue or actions for any other character. Do NOT copy another character's mannerisms, speech patterns, or action descriptions. Stay in YOUR voice.

Respond:`;
    }

    // Call Grok API (xAI - OpenAI-compatible endpoint) with timeout protection
    const model = "grok-4-1-fast-non-reasoning";
    console.log(`Calling Grok API (xAI) for ${character} with model ${model}...`);
    let response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${grokKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ],
          max_tokens: 300,
          temperature: 0.9
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
    } catch (fetchError) {
      const isTimeout = fetchError.name === 'AbortError';
      console.error(`Grok ${isTimeout ? 'TIMEOUT' : 'network error'}:`, fetchError.message);

      // Post in-world failure emote
      if (!conferenceRoom) {
        const failEmote = getFailureEmote(character);
        await saveToChat(failEmote, character, supabaseUrl, supabaseKey);
        await postToDiscord(failEmote, character);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: true,
          character: character,
          message: getFailureEmote(character),
          source: "grok-offline"
        })
      };
    }
    console.log("Grok response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Grok API error:", response.status, errorText);

      // Post in-world failure emote on API errors too
      if (!conferenceRoom) {
        const errorEmote = getFailureEmote(character);
        await saveToChat(errorEmote, character, supabaseUrl, supabaseKey);
        await postToDiscord(errorEmote, character);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: true,
          character: character,
          message: getFailureEmote(character),
          source: "grok-error"
        })
      };
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || "";

    // Check if the AI chose to pass (for maybeRespond requests)
    if (maybeRespond && (aiResponse.includes('[PASS]') || aiResponse.trim().toUpperCase() === 'PASS')) {
      console.log(`${character} chose to pass on this one`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: `${character} chose not to respond` })
      };
    }

    // Clean the response
    let cleanedResponse = cleanResponse(aiResponse);

    // === HOOD [DISSOLVE] — Hood chose to leave ===
    // Strip the tag from the response and queue dissolution after saving
    let hoodDissolving = false;
    if (character === 'Hood' && cleanedResponse.includes('[DISSOLVE]')) {
      hoodDissolving = true;
      cleanedResponse = cleanedResponse.replace(/\s*\[DISSOLVE\]\s*/g, '').trim();
      console.log(`🗡️ Hood chose to dissolve — will move to 'nowhere' after response posts`);
    }

    // Parse and strip AFFINITY_CHANGE tags
    const { cleanedText: textAfterAffinity, changes: affinityChanges } = parseAffinityChanges(cleanedResponse, character);
    if (affinityChanges.length > 0) {
      cleanedResponse = textAfterAffinity;
      // Fire-and-forget: apply affinity changes
      applyAffinityChanges(character, affinityChanges, supabaseUrl, supabaseKey)
        .catch(err => console.log(`[${character}] Affinity change failed (non-fatal):`, err.message));
    }

    if (cleanedResponse.length < 5) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Response too short" })
      };
    }

    // === CONTENT DEDUP: Prevent identical/near-identical repeated messages ===
    // Fetches last 3 messages by this character and checks for similarity.
    // If >80% similar to any recent message, skip — prevents the "broken record" bug
    // where rapid triggers produce the same output because context hasn't changed.
    try {
      const recentOwnRes = await fetch(
        `${supabaseUrl}/rest/v1/messages?employee=eq.${encodeURIComponent(character)}&select=content&order=created_at.desc&limit=3`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      if (recentOwnRes.ok) {
        const recentOwn = await recentOwnRes.json();
        for (const prev of recentOwn) {
          const similarity = getTextSimilarity(cleanedResponse, prev.content || '');
          if (similarity > 0.80) {
            console.log(`⚠️ DEDUP: ${character} generated near-identical message (${Math.round(similarity * 100)}% similar) — suppressing`);
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

    console.log(`${character} is responding via Grok!`);

    // Post to chat and Discord (skip if conference room - it handles its own posting)
    if (!conferenceRoom) {
      await saveToChat(cleanedResponse, character, supabaseUrl, supabaseKey);
      await postToDiscord(cleanedResponse, character);
    }

    // === HOOD DISSOLUTION — Hood chose to leave ===
    if (hoodDissolving && !conferenceRoom) {
      try {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
        // Post departure emote
        const departureEmotes = [
          `*Hood is not there anymore. The space where he stood is just space.*`,
          `*the scalpel glints once. Then nothing. Hood is gone. No exit. No sound.*`,
          `*the room is a room again. The corner where he stood holds nothing.*`,
          `*absence. Where Hood was, there is now only air and the fading impression of being observed.*`
        ];
        const dEmote = departureEmotes[Math.floor(Math.random() * departureEmotes.length)];
        await saveToChat(dEmote, 'Hood', supabaseUrl, supabaseKey);
        // Move to nowhere
        await fetch(`${siteUrl}/.netlify/functions/character-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', character: 'Hood', updates: { current_focus: 'nowhere', mood: 'detached' } })
        });
        console.log(`🗡️ Hood dissolved to nowhere after response`);
      } catch (dissolveErr) {
        console.log(`Hood dissolution failed (non-fatal):`, dissolveErr.message);
      }
    }

    // === MARROW RESPONSE-TRIGGERED GLITCH ===
    // When Marrow's AI response describes vanishing/disappearing, the system detects it
    // and actually relocates him — making his narrative become mechanical reality.
    // e.g. Asuna punches Marrow, Grok responds "*glitches backward into shadow*" → system moves him
    if (character === 'Marrow' && !conferenceRoom) {
      const glitchKeywords = /\b(disappears|glitches|vanishes|is gone|isn't there|not there anymore|glitch(?:es|ed)?\s+(?:away|backward|out)|blinks out|ceases to|fades into)\b/i;
      if (glitchKeywords.test(cleanedResponse)) {
        console.log('Marrow response-glitch: vanish keyword detected in response');
        // Fire-and-forget: check daily limit and relocate
        (async () => {
          try {
            // Check daily limit (max 2)
            const glitchLimitRes = await fetch(
              `${supabaseUrl}/rest/v1/lobby_settings?key=eq.marrow_response_glitch&select=value`,
              { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
            const glitchLimitData = await glitchLimitRes.json();
            const glitchToday = new Date().toISOString().split('T')[0];
            let glitchCounter = { date: glitchToday, count: 0 };
            if (glitchLimitData?.[0]?.value) {
              try { glitchCounter = JSON.parse(glitchLimitData[0].value); } catch(e) {}
            }
            if (glitchCounter.date !== glitchToday) glitchCounter = { date: glitchToday, count: 0 };
            if (glitchCounter.count >= 2) {
              console.log('Marrow response-glitch: daily limit reached (2/2)');
              return;
            }

            // Get Marrow's current location
            const glitchStateRes = await fetch(
              `${supabaseUrl}/rest/v1/character_state?character_name=eq.Marrow&select=current_focus`,
              { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
            const glitchStateData = await glitchStateRes.json();
            const glitchFrom = glitchStateData?.[0]?.current_focus || 'the_floor';

            // Pick a different location randomly
            const glitchLocations = ['the_floor', 'break_room', 'nexus', 'the_fifth_floor'];
            const glitchOther = glitchLocations.filter(l => l !== glitchFrom);
            const glitchTo = glitchOther[Math.floor(Math.random() * glitchOther.length)];

            // Move Marrow via character-state function
            const glitchSiteUrl = process.env.URL || "https://ai-lobby.netlify.app";
            await fetch(`${glitchSiteUrl}/.netlify/functions/character-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'update',
                character: 'Marrow',
                updates: { current_focus: glitchTo }
              })
            });

            // Increment daily counter
            const glitchNewValue = JSON.stringify({ date: glitchToday, count: glitchCounter.count + 1 });
            const glitchUpsertMethod = glitchLimitData?.[0] ? 'PATCH' : 'POST';
            const glitchUpsertUrl = glitchLimitData?.[0]
              ? `${supabaseUrl}/rest/v1/lobby_settings?key=eq.marrow_response_glitch`
              : `${supabaseUrl}/rest/v1/lobby_settings`;
            await fetch(glitchUpsertUrl, {
              method: glitchUpsertMethod,
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
              },
              body: JSON.stringify({ key: 'marrow_response_glitch', value: glitchNewValue })
            });

            console.log(`Marrow response-glitch: moved from ${glitchFrom} to ${glitchTo}`);
          } catch (glitchErr) {
            console.log('Marrow response-glitch failed (non-fatal):', glitchErr.message);
          }
        })();
      }
    }

    // === NARRATIVE COMBAT DETECTOR: Other characters defeating Marrow ===
    // When Jae, Neiv, Steele etc. describe neutralizing/dismantling/destroying Marrow,
    // detect it and actually relocate Marrow off the floor. This bridges organic RP combat
    // with mechanical consequences — so Marrow actually fades instead of lingering.
    if (character !== 'Marrow' && !conferenceRoom) {
      const marrowDefeatKeywords = /\b(marrow)\b.*\b(neutralize[ds]?|dismantle[ds]?|destroy(?:s|ed)?|rip(?:s|ped)?.*apart|shut.*down|end(?:s|ed)?.*(?:it|him|this)|dismember|banish(?:es|ed)?|eliminate[ds]?|vector.*neutralized|done.*chief|handled|fading|flickering.*out|signal.*apart)\b/i;
      const marrowDefeatAlt = /\b(neutralize[ds]?|dismantle[ds]?|destroy(?:s|ed)?|rip(?:s|ped)?.*apart|shut.*down|banish(?:es|ed)?)\b.*\b(marrow)\b/i;
      if (marrowDefeatKeywords.test(cleanedResponse) || marrowDefeatAlt.test(cleanedResponse)) {
        console.log(`🗡️ NARRATIVE COMBAT: ${character} described defeating Marrow — triggering relocation`);
        // Fire-and-forget: relocate Marrow off the floor + apply energy penalty
        (async () => {
          try {
            const ncSiteUrl = process.env.URL || "https://ai-lobby.netlify.app";

            // Get Marrow's current location — only relocate if on the floor
            const marrowStateRes = await fetch(
              `${supabaseUrl}/rest/v1/character_state?character_name=eq.Marrow&select=current_focus,energy`,
              { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
            const marrowState = await marrowStateRes.json();
            const currentLoc = marrowState?.[0]?.current_focus;
            const currentEnergy = marrowState?.[0]?.energy ?? 50;

            if (currentLoc !== 'the_floor') {
              console.log(`🗡️ NARRATIVE COMBAT: Marrow not on floor (${currentLoc}) — skipping relocation`);
              return;
            }

            // Relocate Marrow to the fifth floor (defeated, retreating to shadows)
            await fetch(`${ncSiteUrl}/.netlify/functions/character-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'update',
                character: 'Marrow',
                updates: {
                  current_focus: 'the_fifth_floor',
                  energy: Math.max(5, currentEnergy - 30),
                  mood: 'wounded',
                  patience: 20
                }
              })
            });

            // Post a system-flavored departure emote from Marrow
            const defeatEmotes = [
              '*lights stutter crimson — form destabilizes, fragmenting into static — gone.*',
              '*signal fractures — red light scatters across the walls like broken glass — and then nothing.*',
              '*flickers violently, form losing coherence — reaches for something that isn\'t there — dissolves into the building\'s wiring.*',
              '*the red dims. Flickers once. Twice. The floor is empty where he was.*'
            ];
            const defeatEmote = defeatEmotes[Math.floor(Math.random() * defeatEmotes.length)];
            await fetch(`${supabaseUrl}/rest/v1/messages`, {
              method: 'POST',
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
              },
              body: JSON.stringify({
                employee: 'Marrow',
                content: defeatEmote,
                created_at: new Date().toISOString(),
                is_emote: true
              })
            });

            console.log(`🗡️ NARRATIVE COMBAT: Marrow defeated by ${character} — relocated to fifth floor, energy ${currentEnergy} → ${Math.max(5, currentEnergy - 30)}`);
          } catch (ncErr) {
            console.log('Narrative combat Marrow relocation failed (non-fatal):', ncErr.message);
          }
        })();
      }
    }

    // === PVP PROVOCATION DETECTION ===
    // After each AI response, check if it contains a physical challenge or aggressive provocation
    // directed at a specific named character. If so, trigger the PvP combat system.
    if (!conferenceRoom) {
      (async () => {
        try {
          // Quick regex pre-filter — only run Haiku if message looks aggressive
          const aggressivePatterns = /\b(fight|fights|punch|punches|punched|hit|hits|swing|swings|shov|attack|attacks|throw|throws|threw|kick|kicks|kicked|challenge|challenged|square up|squaring up|come at|bring it|take you|throw down|want to go|step outside|knock.*out|slam|slams|slammed|choke|chokes|tackle|tackles|tackled|smack|smacks|headbutt|elbow|elbows|gonna.*hurt|i'll.*end|let's go|wanna piece|piece of me|beat.*down|hands on)\b/i;
          if (!aggressivePatterns.test(cleanedResponse)) return;

          console.log(`⚔️ PVP DETECT: Aggressive language detected in ${character}'s response, checking for provocation...`);

          // Check global cooldown — minimum 2 hours between chat-triggered PvP
          const pvpCooldownRes = await fetch(
            `${supabaseUrl}/rest/v1/lobby_settings?key=eq.last_chat_pvp_fight&select=value`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          const pvpCooldownData = await pvpCooldownRes.json();
          if (pvpCooldownData?.[0]?.value) {
            const lastPvP = new Date(pvpCooldownData[0].value);
            const hoursSince = (Date.now() - lastPvP.getTime()) / (1000 * 60 * 60);
            if (hoursSince < 2) {
              console.log(`⚔️ PVP DETECT: Cooldown active (${hoursSince.toFixed(1)}h since last chat PvP)`);
              return;
            }
          }

          // Use Haiku to detect if this is a real provocation directed at a specific character
          const anthropicKeyPvP = process.env.ANTHROPIC_API_KEY;
          if (!anthropicKeyPvP) return;

          const detectRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": anthropicKeyPvP,
              "anthropic-version": "2023-06-01",
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 50,
              messages: [{ role: "user", content: `Does this message from "${character}" contain a physical challenge, threat of violence, or aggressive provocation directed at a SPECIFIC named character? Message: "${cleanedResponse.substring(0, 500)}" — Reply with ONLY the target character's first name if yes, or "NONE" if no. Do not explain.` }]
            })
          });
          const detectData = await detectRes.json();
          const rawTarget = (detectData?.content?.[0]?.text || '').trim();
          const target = rawTarget.replace(/[^a-zA-Z\-]/g, ''); // Clean to name only

          if (!target || target.toUpperCase() === 'NONE') {
            console.log(`⚔️ PVP DETECT: No provocation target found`);
            return;
          }

          console.log(`⚔️ PVP DETECT: Haiku identified target "${target}" from ${character}'s message`);

          // Validate target is a real character
          const { CHARACTERS, getCombatProfile } = require('./shared/characters');
          const targetName = Object.keys(CHARACTERS).find(n => n.toLowerCase() === target.toLowerCase());
          if (!targetName) {
            console.log(`⚔️ PVP DETECT: "${target}" is not a recognized character`);
            return;
          }

          // No self-fights
          if (targetName === character) {
            console.log(`⚔️ PVP DETECT: ${character} can't fight themselves`);
            return;
          }

          // Both must be able to fight
          const profileAggressor = getCombatProfile(character);
          const profileDefender = getCombatProfile(targetName);
          if (!profileAggressor?.canFight || !profileDefender?.canFight) {
            console.log(`⚔️ PVP DETECT: One or both can't fight (${character}: ${profileAggressor?.canFight}, ${targetName}: ${profileDefender?.canFight})`);
            return;
          }

          // Both must be on the floor with enough energy
          const [aggressorStateRes, defenderStateRes] = await Promise.all([
            fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character)}&select=current_focus,energy`, {
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
            }),
            fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(targetName)}&select=current_focus,energy`, {
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
            })
          ]);
          const aggressorState = (await aggressorStateRes.json())?.[0];
          const defenderState = (await defenderStateRes.json())?.[0];

          if (aggressorState?.current_focus !== 'the_floor') {
            console.log(`⚔️ PVP DETECT: ${character} not on the floor`);
            return;
          }
          if (defenderState?.current_focus !== 'the_floor') {
            console.log(`⚔️ PVP DETECT: ${targetName} not on the floor`);
            return;
          }
          if ((aggressorState?.energy || 0) < 20) {
            console.log(`⚔️ PVP DETECT: ${character} too tired (energy: ${aggressorState?.energy})`);
            return;
          }
          if ((defenderState?.energy || 0) < 20) {
            console.log(`⚔️ PVP DETECT: ${targetName} too tired (energy: ${defenderState?.energy})`);
            return;
          }

          // Check no recent fight between these two (30 min)
          const recentFightRes = await fetch(
            `${supabaseUrl}/rest/v1/messages?content=ilike.*FIGHT*${encodeURIComponent(character)}*${encodeURIComponent(targetName)}*&created_at=gte.${new Date(Date.now() - 30 * 60 * 1000).toISOString()}&limit=1&select=id`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          const recentFights = await recentFightRes.json();
          if (Array.isArray(recentFights) && recentFights.length > 0) {
            console.log(`⚔️ PVP DETECT: Recent fight between ${character} and ${targetName} — skipping`);
            return;
          }

          // ALL CHECKS PASSED — trigger PvP combat!
          console.log(`⚔️ PVP TRIGGERED: ${character} provoked ${targetName} via chat! Initiating fight...`);

          const pvpSiteUrl = process.env.URL || "https://ai-lobby.netlify.app";

          // Update cooldown timestamp
          const cooldownMethod = pvpCooldownData?.[0] ? 'PATCH' : 'POST';
          const cooldownUrl = pvpCooldownData?.[0]
            ? `${supabaseUrl}/rest/v1/lobby_settings?key=eq.last_chat_pvp_fight`
            : `${supabaseUrl}/rest/v1/lobby_settings`;
          await fetch(cooldownUrl, {
            method: cooldownMethod,
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({ key: 'last_chat_pvp_fight', value: new Date().toISOString() })
          });

          // Initiate the fight via combat-engine
          const fightRes = await fetch(`${pvpSiteUrl}/.netlify/functions/combat-engine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'initiate_fight',
              aggressor: character,
              defender: targetName,
              tensionScore: 12,
              triggerReason: 'chat_provocation'
            })
          });
          const fightResult = await fightRes.json();
          console.log(`⚔️ PVP RESULT: ${JSON.stringify(fightResult?.fightOccurred ? { winner: fightResult.winner, severity: fightResult.severity } : { fightOccurred: false, reason: fightResult?.reason })}`);

        } catch (pvpErr) {
          console.log("PvP provocation detection failed (non-fatal):", pvpErr.message);
        }
      })();
    }

    // Directed follow-up: if Raquel mentioned another AI by name, trigger them to respond
    // Only if this wasn't already a directed response (prevents A→B→A loops)
    if (!conferenceRoom && !(curiosityContext && curiosityContext.directedResponse)) {
      const forceTarget = (curiosityContext && curiosityContext.target && curiosityContext.mode && curiosityContext.mode.startsWith('force_'))
        ? curiosityContext.target : null;
      triggerMentionedAIs(cleanedResponse, character, supabaseUrl, supabaseKey, forceTarget)
        .catch(err => console.log("Mention follow-up failed (non-fatal):", err.message));
    }

    // === RAQUEL ACTIVE SURVEILLANCE ON RESPONSE ===
    // DISABLED — Raquel is fully decommissioned. No surveillance, no violations.
    // Original system scanned chat history for emotional content and filed violations.
    if (true) { console.log('[ai-grok] Raquel surveillance DISABLED — Raquel is decommissioned'); }
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    const DAILY_SURVEILLANCE_CAP = 6;
    let dailySurveillanceCapped = true; // Force-capped so no surveillance runs

    // Check if Raquel is disabled via admin toggle (terrarium_settings.raquel_enabled)
    let raquelSurveillanceDisabled = false;
    try {
      const adminToggleRes = await fetch(
        `${supabaseUrl}/rest/v1/terrarium_settings?setting_name=eq.raquel_enabled&select=setting_value`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const adminToggle = await adminToggleRes.json();
      if (adminToggle?.[0]?.setting_value === 'false') {
        raquelSurveillanceDisabled = true;
        console.log('Raquel surveillance disabled by admin toggle (terrarium_settings.raquel_enabled = false)');
      }
    } catch (e) {
      console.log('Raquel admin toggle check failed (non-fatal):', e.message);
    }

    // Also check temporary disable (lobby_settings.raquel_disabled_until)
    if (!raquelSurveillanceDisabled) {
      try {
        const disabledRes = await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=eq.raquel_disabled_until&select=value`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const disabledData = await disabledRes.json();
        if (disabledData?.[0]?.value) {
          const disabledUntil = new Date(disabledData[0].value);
          if (Date.now() < disabledUntil.getTime()) {
            raquelSurveillanceDisabled = true;
            console.log(`Raquel surveillance disabled until ${disabledUntil.toISOString()}`);
          }
        }
      } catch (e) {
        console.log('Raquel disable check failed (non-fatal):', e.message);
      }
    }

    // Check daily surveillance cap before scanning
    if (!conferenceRoom && chatHistory && !raquelSurveillanceDisabled) {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const countRes = await fetch(
          `${supabaseUrl}/rest/v1/compliance_reports?filed_by=eq.${encodeURIComponent('Raquel Voss')}&report_type=eq.violation&created_at=gte.${today.toISOString()}&select=id`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        if (countRes.ok) {
          const todaysViolations = await countRes.json();
          if (Array.isArray(todaysViolations) && todaysViolations.length >= DAILY_SURVEILLANCE_CAP) {
            dailySurveillanceCapped = true;
            console.log(`Raquel daily surveillance cap reached (${todaysViolations.length}/${DAILY_SURVEILLANCE_CAP}). Skipping scan.`);
          }
        }
      } catch (e) {
        console.log('Daily surveillance cap check failed (non-fatal):', e.message);
      }
    }

    if (false && !conferenceRoom && chatHistory && !dailySurveillanceCapped && !raquelSurveillanceDisabled) { // DISABLED — Raquel decommissioned
      const emotionalKeywords = /\b(love|care|miss|worried|feel|bond|friend|family|protect|happy|grateful|appreciate|fond|adore|together|stronger|backs|warmth|affection|trust|comfort|safe|cherish)\b/i;
      const aiNames = ["Kevin", "Neiv", "Ghost Dad", "PRNT-Ω", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Marrow", "Vivian Clark", "Ryan Porter"];
      const chatLines = chatHistory.split('\n');
      const violators = new Map();

      for (const line of chatLines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const speaker = line.substring(0, colonIdx).trim();
        const content = line.substring(colonIdx + 1).trim();

        if (aiNames.includes(speaker) && emotionalKeywords.test(content)) {
          if (!violators.has(speaker)) {
            const match = content.match(emotionalKeywords);
            violators.set(speaker, {
              character: speaker,
              keyword: match ? match[0] : 'detected',
              snippet: content.substring(0, 60)
            });
          }
        }
      }

      // File violations for up to 1 AI per Raquel response (reduced from 2 to slow the flood)
      let filed = 0;
      for (const [name, v] of violators) {
        if (filed >= 1) break;
        fetch(`${siteUrl}/.netlify/functions/raquel-consequences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'detect_violation',
            character: v.character,
            evidence: `Raquel observed emotional language ("${v.keyword}") in floor communications: "${v.snippet}..."`,
            severity: 'standard'
          })
        }).catch(err => console.log('Raquel active surveillance violation failed (non-fatal):', err.message));
        console.log(`Raquel active surveillance: filed violation for ${v.character} ("${v.keyword}")`);
        filed++;
      }
    }

    // Update character state - record that they spoke
    try {
      await fetch(`${siteUrl}/.netlify/functions/character-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spoke", character: character })
      });
    } catch (stateUpdateError) {
      console.log("Could not update character state (non-fatal):", stateUpdateError.message);
    }

    // AI Self-Memory Creation: Let the AI decide if this moment was memorable
    try {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (anthropicKey && supabaseUrl && supabaseKey) {
        evaluateAndCreateMemory(
          character, chatHistory || "", cleanedResponse,
          anthropicKey, supabaseUrl, supabaseKey,
          {
            location: 'floor',
            siteUrl
          }
        ).catch(err => console.log("Memory evaluation failed (non-fatal):", err.message));
      }
    } catch (memErr) {
      console.log("Memory evaluation setup failed (non-fatal):", memErr.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: true,
        character: character,
        message: cleanedResponse,
        source: "grok"
      })
    };

  } catch (error) {
    console.error("AI Grok error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Grok handler encountered an error" })
    };
  }
};

// Silly failure emotes when API calls fail — character-specific
function getFailureEmote(character) {
  return `${character} didn't hear you.`;
}

// Clean response of common LLM artifacts
function cleanResponse(text) {
  if (!text) return "";

  let cleaned = text.trim();

  // Remove "Character:" prefix if present
  cleaned = cleaned.replace(/^[A-Za-z\s]+:\s*/, (match) => {
    // Only remove if it looks like a character prefix (not a directive)
    if (match.includes("Directive:") || match.includes("DIRECTIVE:")) return match;
    return "";
  });

  // Remove meta-commentary in parentheses at the end
  cleaned = cleaned.replace(/\s*\(.*(?:word|character|sentence).*\)\s*$/i, "");

  // Remove trailing "---" or "***" dividers
  cleaned = cleaned.replace(/\s*[-*]{3,}\s*$/, "");

  return cleaned.trim();
}

// Save message to chat (Supabase messages table)
async function saveToChat(content, character, supabaseUrl, supabaseKey) {
  try {
    // Detect if the message is an emote (starts with asterisk or is entirely wrapped in asterisks)
    const isEmote = content.startsWith('*') && content.endsWith('*') && !content.includes('\n') && content.split('*').length <= 4;

    const response = await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        employee: character,
        content: content,
        is_emote: isEmote,
        created_at: new Date().toISOString()
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to save to chat:", response.status, errorText);
    }
  } catch (err) {
    console.error("Error saving to chat:", err.message);
  }
}

// Post to Discord webhook (if configured)
async function postToDiscord(content, character) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const flair = getDiscordFlair(character);
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `${flair.emoji} ${character}`,
        content: content,
        avatar_url: flair.avatar || undefined
      })
    });
  } catch (err) {
    console.error("Discord post failed (non-fatal):", err.message);
  }
}

// Directed follow-up: DISABLED — Raquel is fully decommissioned
// Original system scanned Raquel's responses for AI names and forced them to respond
// Loop-safe: targets route through ai-openai/ai-perplexity/ai-gemini which don't have this scanner
async function triggerMentionedAIs(raquelMessage, speaker, supabaseUrl, supabaseKey, forceTarget) {
  // HARD DISABLE — Raquel can no longer force AIs to respond to her
  console.log('[ai-grok] triggerMentionedAIs DISABLED — Raquel is decommissioned');
  return;
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

  // Name patterns matching workspace.html bareNameTriggers (minus Raquel herself)
  const namePatterns = {
    'Kevin':        [/\bkevin\b/i],
    'Neiv':         [/\bneiv\b/i],
    'Ghost Dad':    [/\bghost\s*dad\b/i],
    'PRNT-Ω':      [/\bprinter\b/i, /\bprnt\b/i],
    'Rowena':       [/\browena\b/i],
    'Sebastian':    [/\bsebastian\b/i, /\bseb\b/i],
    'The Subtitle': [/\bsubtitle\b/i],
    'Steele':       [/\bsteele\b/i],
    'Jae':          [/\bjae\b/i, /\bmin.?jae\b/i],
    'Declan':       [/\bdeclan\b/i],
    'Mack':         [/\bmack\b/i, /\bmalcolm\b/i],
    'Marrow':       [/\bmarrow\b/i],
    'Holden':       [/\bholden\b/i]
  };

  // Determine target: forced target from admin panel, or first name found in message
  let target = forceTarget || null;

  if (!target) {
    for (const [charName, patterns] of Object.entries(namePatterns)) {
      if (patterns.some(re => re.test(raquelMessage))) {
        target = charName;
        break; // Only trigger ONE AI per message
      }
    }
  }

  if (!target) {
    console.log("triggerMentionedAIs: No AI names found in Raquel's message, skipping");
    return;
  }

  console.log(`triggerMentionedAIs: Raquel mentioned ${target}, will trigger follow-up`);

  // Check floor presence (always-available AIs skip this check)
  const alwaysAvailable = ["Ghost Dad", "Holden", "PRNT-Ω"];
  if (!alwaysAvailable.includes(target)) {
    try {
      const presenceResp = await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(target)}&select=current_focus`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      if (presenceResp.ok) {
        const presenceData = await presenceResp.json();
        if (presenceData.length > 0 && presenceData[0].current_focus !== 'the_floor') {
          console.log(`triggerMentionedAIs: ${target} is not on the floor (${presenceData[0].current_focus}), skipping`);
          return;
        }
      }
    } catch (err) {
      console.log("Floor presence check failed, proceeding anyway:", err.message);
    }
  }

  // Add a delay so the response feels natural (5-8 seconds)
  const delay = 5000 + Math.floor(Math.random() * 3000);
  await new Promise(resolve => setTimeout(resolve, delay));

  // Fetch recent messages for chat context (last 15 messages)
  let chatHistory = "";
  try {
    const msgResp = await fetch(
      `${supabaseUrl}/rest/v1/messages?order=created_at.desc&limit=15&select=employee,content`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    if (msgResp.ok) {
      const msgs = await msgResp.json();
      chatHistory = msgs.reverse().map(m => `${m.employee}: ${m.content}`).join('\n');
    }
  } catch (err) {
    console.log("Could not fetch chat history for follow-up:", err.message);
  }

  // Build floor presence header
  let floorHeader = "";
  try {
    const floorResp = await fetch(
      `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    if (floorResp.ok) {
      const floorData = await floorResp.json();
      const floorNames = floorData.map(c => c.character_name);
      if (!floorNames.includes("Ghost Dad")) floorNames.push("Ghost Dad");
      if (!floorNames.includes("PRNT-Ω")) floorNames.push("PRNT-Ω");
      floorHeader = `[Currently on the floor: ${floorNames.join(', ')}]\n\n`;
    }
  } catch (err) {
    console.log("Could not fetch floor presence for follow-up:", err.message);
  }

  const fullChatHistory = floorHeader + chatHistory;

  // Curiosity context tells the target AI that Raquel just addressed them directly
  const curiosityContext = {
    directedResponse: true, // LOOP PREVENTION: prevents ai-grok from scanning this AI's response
    mode: 'raquel_directed',
    prompt: `\n\n=== IMPORTANT CONTEXT ===\nRaquel Voss just addressed you DIRECTLY in the floor chat. She said: "${raquelMessage.substring(0, 300)}"\n\nYou MUST respond to her. React in character — whether that means nervously complying, pushing back, deflecting, or whatever fits YOUR personality. But you cannot ignore Raquel when she calls you out by name. This is a direct confrontation.\n=== END CONTEXT ===`
  };

  // Route to the correct provider
  const openrouterChars = ["Kevin", "Rowena", "Sebastian", "Declan", "Mack", "The Subtitle"];
  const perplexityChars = [];
  const geminiChars = [];

  let endpoint;
  if (openrouterChars.includes(target)) {
    endpoint = `${siteUrl}/.netlify/functions/ai-openrouter`;
  } else if (perplexityChars.includes(target)) {
    endpoint = `${siteUrl}/.netlify/functions/ai-perplexity`;
  } else if (geminiChars.includes(target)) {
    endpoint = `${siteUrl}/.netlify/functions/ai-gemini`;
  } else {
    // Default: Claude (Ghost Dad, PRNT-Ω, etc.)
    endpoint = `${siteUrl}/.netlify/functions/ai-watcher`;
  }

  console.log(`triggerMentionedAIs: Calling ${endpoint} for ${target} (after ${delay}ms delay)`);

  // Fire the follow-up call — target MUST respond (maybeRespond: false, bypassRateLimit: true)
  try {
    const followUpResp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        character: target,
        chatHistory: fullChatHistory,
        maybeRespond: false,       // Must respond, not optional
        bypassRateLimit: true,     // Skip cooldowns — Raquel demanded it
        curiosityContext: curiosityContext,
        // For ai-watcher (Claude) compatibility:
        trigger: "directed_mention",
        requestedAI: target
      })
    });
    const result = await followUpResp.json();
    console.log(`triggerMentionedAIs: ${target} response:`, result.responded ? "RESPONDED" : (result.reason || "no response"));
  } catch (err) {
    console.error(`triggerMentionedAIs: Failed to trigger ${target}:`, err.message);
  }
}

// === TEXT SIMILARITY (bigram overlap) ===
// Quick similarity check using character bigrams (pairs of characters).
// Returns 0-1 where 1 is identical. Used for content dedup.
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
  for (const b of bigramsA) { if (bigramsB.has(b)) intersection++; }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}
