// AI Perplexity - Routes specific characters to Perplexity API for more authentic responses
// Currently handles: Neiv (and any character with voiceProvider: "perplexity")

const { getSystemPrompt, getDiscordFlair, getModelForCharacter } = require('./shared/characters');
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
    console.log("ai-perplexity received body:", event.body);
    console.log("ai-perplexity httpMethod:", event.httpMethod);
    const { character, chatHistory, maybeRespond, conferenceRoom, responseDelay, bypassRateLimit, curiosityContext } = JSON.parse(event.body || "{}");

    const perplexityKey = process.env.PERPLEXITY_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!perplexityKey || !supabaseUrl || !supabaseKey) {
      console.log("Missing config - perplexityKey:", !!perplexityKey, "supabaseUrl:", !!supabaseUrl, "supabaseKey:", !!supabaseKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          reason: "Missing configuration",
          debug: {
            hasPerplexity: !!perplexityKey,
            hasSupabaseUrl: !!supabaseUrl,
            hasSupabaseKey: !!supabaseKey
          }
        })
      };
    }

    console.log("AI Perplexity called for character:", character, maybeRespond ? "(optional chime-in)" : "(direct request)", bypassRateLimit ? "(bypassing rate limit)" : "");

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

      // Check if this specific AI spoke too recently
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

    // Load character's current state and memories (with conversation context for relevant memory matching)
    let characterContext = null;
    let stateSection = "";
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      // Pass chat history context so memories can be matched to current conversation
      const contextSnippet = chatHistory ? chatHistory.substring(0, 500) : "";
      const stateResponse = await fetch(
        `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent(character)}&context=${encodeURIComponent(contextSnippet)}&skipFloor=true`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (stateResponse.ok) {
        characterContext = await stateResponse.json();
        console.log(`Loaded state for ${character}:`, characterContext.state?.mood, characterContext.state?.energy);
        if (characterContext.memories?.length > 0) {
          console.log(`Loaded ${characterContext.memories.length} memories for ${character}`);
        }
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

    // Get model from shared characters (defaults to sonar for Neiv)
    const model = getModelForCharacter(character) || "sonar";

    // Combine base prompt with dynamic state + heartbeat curiosity context
    let curiositySection = '';
    if (curiosityContext && curiosityContext.prompt) {
      curiositySection = '\n\n' + curiosityContext.prompt;
    }
    const systemPrompt = basePrompt + stateSection + curiositySection;

    // Build the user message with chat context
    // If maybeRespond is true, give the AI the option to stay silent
    const userMessage = maybeRespond
      ? `Here is the recent office chat. You're ${character} - and something just happened that caught your attention!

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *checks the monitors*
- You can mix them! Example: *glances at the readouts* Everyone's still breathing. Good enough.

The humans are being ridiculous and you probably have something dry, stabilizing, or wryly affectionate to add.

Respond in character (2-3 sentences). ONE emote max. Only say [PASS] if ${character} would genuinely have nothing to contribute.

IMPORTANT: ONLY mention or address people listed in the [Currently on the floor: ...] header at the top of the chat. If someone isn't listed, they're not in the room.

---
${chatHistory}
---

CRITICAL: You are ${character}. Write ONLY as ${character}. Do NOT write dialogue or actions for any other character. Do NOT copy another character's mannerisms, speech patterns, or action descriptions. Stay in YOUR voice.

Your response:`
      : `Here is the recent office chat. Respond in character as ${character}. Just write your response directly - no meta-commentary, no character counts, no explanations.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *checks the monitors*
- You can mix them! Example: *glances at the readouts* Everyone's still breathing. Good enough.

Keep it natural (2-3 sentences). ONE emote action max — then talk. No stacking multiple *emotes* in one response. This is casual chat, not a stage performance.

IMPORTANT: Only reference or interact with people listed in the [Currently on the floor: ...] header at the top of the chat history. If someone isn't listed there, they are not present — do NOT mention them.

---
${chatHistory}
---

CRITICAL: You are ${character}. Write ONLY as ${character}. Do NOT write dialogue or actions for any other character. Do NOT copy another character's mannerisms, speech patterns, or action descriptions. Stay in YOUR voice.

Respond:`;

    // Call Perplexity API with timeout protection
    // Perplexity can hang during outages — 8s timeout prevents our function from dying silently
    console.log("Calling Perplexity API...");
    let response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${perplexityKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage }
          ],
          max_tokens: 300,
          temperature: 0.7
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
    } catch (fetchError) {
      // Timeout or network error — Neiv goes dark in-world
      const isTimeout = fetchError.name === 'AbortError';
      console.error(`Perplexity ${isTimeout ? 'TIMEOUT' : 'network error'}:`, fetchError.message);

      // Post in-world emote: Neiv didn't hear you
      if (!conferenceRoom) {
        const dimEmote = "Neiv didn't hear you.";
        await saveToChat(dimEmote, character, supabaseUrl, supabaseKey);
        await postToDiscord(dimEmote, character);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: true,
          character: character,
          message: "Neiv didn't hear you.",
          source: "perplexity-offline"
        })
      };
    }

    console.log("Perplexity response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Perplexity API error:", response.status, errorText);

      // Post in-world emote on API errors too
      if (!conferenceRoom) {
        const errorEmote = "Neiv didn't hear you.";
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
          message: "Neiv didn't hear you.",
          source: "perplexity-error"
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
    const cleanedResponse = cleanResponse(aiResponse);

    if (cleanedResponse.length < 5) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Response too short" })
      };
    }

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
        source: "perplexity"
      })
    };

  } catch (error) {
    console.error("AI Perplexity error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Perplexity handler encountered an error" })
    };
  }
};

function cleanResponse(response) {
  let cleaned = response
    .replace(/\[SILENT\]/gi, '')
    .replace(/\[NO RESPONSE\]/gi, '')
    .replace(/\[PASS\]/gi, '')
    .replace(/^(I think |I'll say |Here's my response:|My response:|As \w+,|\w+:)\s*/gi, '')
    .replace(/^["']|["']$/g, '')
    // Remove character count suffixes like "[478 chars]" or "(248 characters)"
    .replace(/\s*[\[\(]\d+\s*(chars?|characters?)[\]\)]\s*$/gi, '')
    // Remove Perplexity Sonar citation markers like [1], [2], [1][2], etc.
    .replace(/\[\d+\]/g, '')
    .trim();

  return cleaned;
}

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
    content: `*${character} ${message.replace(/^\*|\*$/g, '')}*`
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
  // Pure emote: "*sighs*" - Mixed: "*sighs* That's rough."
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
