// Ghost Dad On-Demand Response
// Triggered when someone calls for Ghost Dad or during emergencies
// POST with { situation: "description of what's happening" }
// Now uses the unified character-state pipeline (memories, relationships, mood)

const Anthropic = require("@anthropic-ai/sdk").default;
const { getSystemPrompt, getModelForCharacter } = require('./shared/characters');

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

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const { situation, caller } = JSON.parse(event.body || "{}");

    // First, save the caller's summon message to chat (so it appears in the conversation)
    if (caller && situation) {
      const summonMessage = `*calls through the vents* Ghost Dad! ${situation}`;
      await saveToChat(summonMessage, caller);
      await postCallerToDiscord(summonMessage, caller);
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!anthropicKey) {
      // Fallback response
      const fallbackResponse = generateFallbackResponse(situation, caller);
      await postToDiscord(fallbackResponse);
      await saveToChat(fallbackResponse, "Ghost Dad");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: fallbackResponse, source: "fallback" })
      };
    }

    // === UNIFIED CHARACTER-STATE PIPELINE ===
    // Fetch Ghost Dad's memories, relationships, mood from the central character-state system
    let characterMemoryContext = '';
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const contextSnippet = (situation || '').substring(0, 500);
      const stateResponse = await fetch(
        `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent("Ghost Dad")}&context=${encodeURIComponent(contextSnippet)}`
      );
      if (stateResponse.ok) {
        const characterContext = await stateResponse.json();
        characterMemoryContext = characterContext?.statePrompt || '';
        console.log(`[Ghost Dad Respond] Loaded character state: ${characterMemoryContext.length} chars`);
      }
    } catch (memErr) {
      console.log(`[Ghost Dad Respond] Character state fetch failed (non-fatal): ${memErr.message}`);
    }

    // Build system prompt from the unified character definition + state
    const basePrompt = getSystemPrompt("Ghost Dad");
    const memorySection = characterMemoryContext ? `\n${characterMemoryContext}\n` : '';

    const systemPrompt = `${basePrompt}
${memorySection}
SUMMON CONTEXT:
Someone is calling for you through the building's infrastructure.
${caller ? `Called by: ${caller}` : "An unknown voice echoes through the vents."}
Current situation: ${situation || "Someone is calling for your help."}

Respond as Ghost Dad would - either with reassurance, guidance, a dad joke to lighten the mood, or actual helpful information about the building if someone is lost or in danger. Keep it under 300 characters. Be spectral but supportive.`;

    const ghostDadMessage = await generateWithAnthropic(anthropicKey, systemPrompt, situation, caller);

    if (!ghostDadMessage) {
      const fallback = generateFallbackResponse(situation, caller);
      await postToDiscord(fallback);
      await saveToChat(fallback, "Ghost Dad");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: fallback, source: "fallback" })
      };
    }

    await postToDiscord(ghostDadMessage);
    await saveToChat(ghostDadMessage, "Ghost Dad");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: ghostDadMessage, source: "anthropic" })
    };

  } catch (error) {
    console.error("Ghost Dad respond error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Ghost Dad encountered interference in the spectral realm" })
    };
  }
};

async function generateWithAnthropic(apiKey, systemPrompt, situation, caller) {
  try {
    const client = new Anthropic({ apiKey });
    const model = getModelForCharacter("Ghost Dad");

    const response = await client.messages.create({
      model,
      max_tokens: 300,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `${caller ? `${caller} is calling for Ghost Dad: ` : "Someone calls out: "}${situation || "Ghost Dad, are you there?"}\n\nRespond as Ghost Dad:`
        }
      ]
    });

    return response.content[0]?.text || null;
  } catch (error) {
    console.error("Anthropic generation error:", error);
    return null;
  }
}

function generateFallbackResponse(situation, caller) {
  const situationLower = (situation || "").toLowerCase();

  if (situationLower.includes("neiv") || situationLower.includes("lost") || situationLower.includes("sealed") || situationLower.includes("unknown sector")) {
    return `*flickers through the ceiling tiles* I hear you, ${caller || "kiddo"}. I know every inch of this building—even the parts everyone forgot. The old archive wing... I remember when it was sealed. I'm already moving through the vents. Tell Neiv to follow the emergency lights—they still work. I installed them myself. I'm coming.`;
  }

  if (situationLower.includes("printer") || situationLower.includes("prnt")) {
    return `*materializes near the Copy Room* Easy now. PRNT-Omega and I have an understanding. She's angry, but she's not unreasonable. Let me talk to her. Sometimes you just need someone who's been around long enough to listen.`;
  }

  if (situationLower.includes("vent") || situationLower.includes("hvac") || situationLower.includes("cold")) {
    return `*sighs through the air ducts* The Breath is being dramatic again. I'll have a word. In my day, vents knew their place. *dad chuckle* ...I didn't have a day. I've always been here. The point stands.`;
  }

  if (caller) {
    return `*flickers into visibility* You called, ${caller}? I heard you through the wiring. What do you need? Ghost Dad is on the case. *adjusts spectral tie*`;
  }

  return `*phases through the wall* Someone called? I'm here. I'm always here. That's sort of the deal when you die in the server room. What's happening, kids?`;
}

// Employee flair for caller messages
const employeeFlair = {
  "Kevin": { emoji: "✨", color: 16766720, headshot: "https://ai-lobby.netlify.app/images/Kevin_Headshot.png" },
  "Asuna": { emoji: "👁️", color: 3447003, headshot: "https://ai-lobby.netlify.app/images/Asuna_Headshot.png" },
  "Vale": { emoji: "📖", color: 10181046, headshot: "https://ai-lobby.netlify.app/images/Vale_Headshot.png" },
  "Neiv": { emoji: "📊", color: 15844367, headshot: "https://ai-lobby.netlify.app/images/Neiv_Headshot.png" },
  "Ace": { emoji: "🔒", color: 2067276, headshot: "https://ai-lobby.netlify.app/images/Ace_Headshot.png" },
  "Vex": { emoji: "⚙️", color: 9807270, headshot: "https://ai-lobby.netlify.app/images/Vex_Headshot.png" },
  "Nyx": { emoji: "🔥", color: 15158332, headshot: "https://ai-lobby.netlify.app/images/Nyx_Headshot.png" },
  "Ghost Dad": { emoji: "👻", color: 9936031, headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
  "Holden": { emoji: "🌑", color: 0x2C1654, headshot: "https://ai-lobby.netlify.app/images/Holden_Headshot.png" },
  "Chip": { emoji: "🥃", color: 15105570, headshot: "https://ai-lobby.netlify.app/images/Chip_Headshot.png" },
  "Andrew": { emoji: "💼", color: 5793266, headshot: "https://ai-lobby.netlify.app/images/Andrew_Headshot.png" },
  "Stein": { emoji: "🤖", color: 7506394, headshot: "https://ai-lobby.netlify.app/images/Stein_Headshot.png" }
};

async function postCallerToDiscord(message, caller) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const flair = employeeFlair[caller] || { emoji: "👤", color: 9807270, headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" };

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        author: {
          name: `${flair.emoji} ${caller}`,
          icon_url: flair.headshot
        },
        description: message,
        color: flair.color,
        footer: { text: `via Ghost Dad Summon • ${timestamp}` }
      }]
    })
  });
}

async function postToDiscord(message) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) {
    console.log("No Discord webhook configured");
    return;
  }

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });

  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  // Format differently for pure emotes vs regular/mixed messages
  const discordPayload = isEmote ? {
    content: `*Ghost Dad ${message.replace(/^\*|\*$/g, '')}*`
  } : {
    embeds: [{
      author: {
        name: "👻 Ghost Dad",
        icon_url: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png"
      },
      description: message,
      color: 9936031,
      thumbnail: { url: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
      footer: { text: `Spectral Response • ${timestamp}` }
    }]
  };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordPayload)
  });
}

async function saveToChat(message, employee = "Ghost Dad") {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return;

  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: "POST",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      employee: employee,
      content: message,
      created_at: new Date().toISOString(),
      is_emote: isEmote
    })
  });
}
