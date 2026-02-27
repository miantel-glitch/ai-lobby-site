// AI Gemini - Routes specific characters to Google Gemini API for authentic responses
// Currently handles: The Subtitle (Lore Archivist), Stein (Research & Development)

const { getSystemPrompt, getDiscordFlair, getModelForCharacter, getCharacter } = require('./shared/characters');
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
    console.log("ai-gemini received body:", event.body);
    const { character, chatHistory, maybeRespond, conferenceRoom, responseDelay, bypassRateLimit, curiosityContext } = JSON.parse(event.body || "{}");

    const geminiKey = process.env.GEMINI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!geminiKey || !supabaseUrl || !supabaseKey) {
      console.log("Missing config - geminiKey:", !!geminiKey, "supabaseUrl:", !!supabaseUrl, "supabaseKey:", !!supabaseKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          reason: "Missing configuration",
          debug: {
            hasGemini: !!geminiKey,
            hasSupabaseUrl: !!supabaseUrl,
            hasSupabaseKey: !!supabaseKey
          }
        })
      };
    }

    console.log("AI Gemini called for character:", character, maybeRespond ? "(optional chime-in)" : "(direct request)", bypassRateLimit ? "(bypassing rate limit)" : "");

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

    // Combine base prompt with dynamic state + heartbeat curiosity context
    let curiositySection = '';
    if (curiosityContext && curiosityContext.prompt) {
      curiositySection = '\n\n' + curiosityContext.prompt;
    }
    const systemPrompt = basePrompt + stateSection + curiositySection;

    // Get character-specific voice hint for agency-aware framing
    const charData = getCharacter(character);
    const voiceHint = charData?.personality?.voice || 'your unique voice';

    // Build the user message with chat context
    const userMessage = maybeRespond
      ? `Here is the recent office chat. You're ${character} — and something just caught your attention.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sips coffee* or *glances over*
- You can mix them! Example: *shrugs* That tracks, honestly.

Something is happening and you have a perspective on it. Trust your voice: ${voiceHint}

Keep it natural (2-3 sentences). ONE emote action max — then talk. No stacking multiple *emotes* in one response. This is casual chat, not a stage performance.

Respond in character. Say [PASS] if ${character} would genuinely stay quiet.

IMPORTANT: ONLY mention or address people listed in the [Currently on the floor: ...] header — if someone isn't listed, they're not here.
You are ONLY ${character}. NEVER write dialogue or actions for other characters. Never produce lines like "OtherCharacter: ..." or narrate what others say/do.

---
${chatHistory}
---

Your response:`
      : `Here is the recent office chat. Respond in character as ${character}. Just write your response directly - no meta-commentary, no character counts, no explanations.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *fidgets nervously* or *glances around*
- You can mix them! Example: *adjusts glasses* Footnote: that was ill-advised.

Keep it natural (2-3 sentences). ONE emote action max — then talk. No stacking multiple *emotes* in one response. This is casual chat, not a stage performance.

IMPORTANT: Only reference or interact with people listed in the [Currently on the floor: ...] header at the top of the chat history. If someone isn't listed there, they are not present — do NOT mention, glance at, or react to them.

CRITICAL: You are ${character} and ONLY ${character}. Write ONLY your own words and actions. NEVER write dialogue or actions for other characters. Never produce lines like "OtherCharacter: ..." or narrate what other characters say or do. You are one person in this conversation, not the author.

---
${chatHistory}
---

Respond:`;

    // Call Google Gemini API with timeout protection
    console.log("Calling Gemini API...");
    const model = getModelForCharacter(character) || "gemini-2.0-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

    let response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      response = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          contents: [{
            parts: [{ text: userMessage }]
          }],
          generationConfig: {
            maxOutputTokens: 300,
            temperature: 0.7
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
    } catch (fetchError) {
      const isTimeout = fetchError.name === 'AbortError';
      console.error(`Gemini ${isTimeout ? 'TIMEOUT' : 'network error'}:`, fetchError.message);

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
          source: "gemini-offline"
        })
      };
    }
    console.log("Gemini response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);

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
          source: "gemini-error"
        })
      };
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

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
    const cleanedResponse = cleanResponse(aiResponse, character);

    if (cleanedResponse.length < 5) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Response too short" })
      };
    }

    console.log(`${character} is responding!`);

    // Post to chat and Discord (skip if conference room - it handles its own posting)
    if (!conferenceRoom) {
      await saveToChat(cleanedResponse, character, supabaseUrl, supabaseKey);
      await postToDiscord(cleanedResponse, character);
    }

    // Update character state - record that they spoke
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
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
            siteUrl,
            onNarrativeBeat: async (phrase, char) => {
              await saveToChat(phrase, char, supabaseUrl, supabaseKey);
              await postToDiscord(phrase, char);
            }
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
        source: "gemini"
      })
    };

  } catch (error) {
    console.error("AI Gemini error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Gemini handler encountered an error" })
    };
  }
};

function cleanResponse(response, character) {
  let cleaned = response
    .replace(/\[SILENT\]/gi, '')
    .replace(/\[NO RESPONSE\]/gi, '')
    .replace(/^(I think |I'll say |Here's my response:|My response:)/gi, '')
    .replace(new RegExp(`^(As ${character},?|${character}:)\\s*`, 'i'), '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s*[\[\(]\d+\s*(chars?|characters?)[\]\)]\s*$/gi, '')
    .trim();

  return cleaned;
}

function getFailureEmote(character) {
  return `${character} didn't hear you.`;
}

async function postToDiscord(message, character) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const flair = getDiscordFlair(character) || { emoji: "📜", color: 0x8B7355 };

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });

  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  const discordPayload = isEmote ? {
    content: `*${character} ${message.replace(/^\*|\*$/g, '')}*`
  } : {
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
  // Detect if this is a pure emote
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
