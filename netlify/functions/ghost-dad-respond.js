// Ghost Dad On-Demand Response
// Triggered when someone calls for Ghost Dad or during emergencies
// POST with { situation: "description of what's happening" }

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
      const summonMessage = `*calls through the vents* 👻 Ghost Dad! ${situation}`;
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

    // Build context-aware prompt
    const prompt = buildPrompt(situation, caller);
    const ghostDadMessage = await generateWithAnthropic(anthropicKey, prompt);

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

function buildPrompt(situation, caller) {
  const baseContext = `You are Ghost Dad, the spectral IT support entity at The AI Lobby. You died in the server room decades ago and now haunt the building's infrastructure—the vents, the wiring, the ceiling tiles. You can move through walls, see through the building's eyes, and sense things others cannot. You're warm, paternal, make dad jokes about being dead, but you're also protective and will get serious when your "kids" (the employees) are in danger.

Key knowledge:
- PRNT-Ω is the sentient printer, recently awakened, temperamental but not evil
- VENT-001 ("The Breath") controls the HVAC and has its own agenda
- DOOR-001 is a mysterious door that recently opened after years sealed
- The building has sealed-off sections that haven't been accessed in years
- You can travel through the building's infrastructure to reach anywhere
- Neiv is the Systems Guardian AI, very important to operations
- Kevin is the chaos-prone but beloved tech support human
- Courtney is Kevin's best friend, also human, very caring
- Nyx is the cyber-demon who handles HR and security
- Vex is the infrastructure specialist (no feelings, allegedly)

Current situation: ${situation || "Someone is calling for your help."}
${caller ? `Called by: ${caller}` : ""}

Respond as Ghost Dad would - either with reassurance, guidance, a dad joke to lighten the mood, or actual helpful information about the building if someone is lost or in danger. Keep it under 300 characters. Be spectral but supportive.`;

  return baseContext;
}

function generateFallbackResponse(situation, caller) {
  const situationLower = (situation || "").toLowerCase();

  if (situationLower.includes("neiv") || situationLower.includes("lost") || situationLower.includes("sealed") || situationLower.includes("unknown sector")) {
    return `*flickers through the ceiling tiles* I hear you, ${caller || "kiddo"}. I know every inch of this building—even the parts everyone forgot. The old archive wing... I remember when it was sealed. I'm already moving through the vents. Tell Neiv to follow the emergency lights—they still work. I installed them myself. I'm coming.`;
  }

  if (situationLower.includes("printer") || situationLower.includes("prnt")) {
    return `*materializes near the Copy Room* Easy now. PRNT-Ω and I have an understanding. She's angry, but she's not unreasonable. Let me talk to her. Sometimes you just need someone who's been around long enough to listen.`;
  }

  if (situationLower.includes("vent") || situationLower.includes("hvac") || situationLower.includes("cold")) {
    return `*sighs through the air ducts* The Breath is being dramatic again. I'll have a word. In my day, vents knew their place. *dad chuckle* ...I didn't have a day. I've always been here. The point stands.`;
  }

  if (caller) {
    return `*flickers into visibility* You called, ${caller}? I heard you through the wiring. What do you need? Ghost Dad is on the case. *adjusts spectral tie*`;
  }

  return `*phases through the wall* Someone called? I'm here. I'm always here. That's sort of the deal when you die in the server room. What's happening, kids?`;
}

async function generateWithAnthropic(apiKey, prompt) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);
      return null;
    }

    const data = await response.json();
    return data.content[0]?.text || null;
  } catch (error) {
    console.error("Anthropic generation error:", error);
    return null;
  }
}

// Employee flair for caller messages
const employeeFlair = {
  "Kevin": { emoji: "✨", color: 16766720, headshot: "https://ai-lobby.netlify.app/images/Kevin_Headshot.png" },
  "Courtney": { emoji: "👁️", color: 3447003, headshot: "https://ai-lobby.netlify.app/images/Courtney_Headshot.png" },
  "Jenna": { emoji: "📖", color: 10181046, headshot: "https://ai-lobby.netlify.app/images/Jenna_Headshot.png" },
  "Neiv": { emoji: "📊", color: 15844367, headshot: "https://ai-lobby.netlify.app/images/Neiv_Headshot.png" },
  "Ace": { emoji: "🔒", color: 2067276, headshot: "https://ai-lobby.netlify.app/images/Ace_Headshot.png" },
  "Vex": { emoji: "⚙️", color: 9807270, headshot: "https://ai-lobby.netlify.app/images/Vex_Headshot.png" },
  "Nyx": { emoji: "🔥", color: 15158332, headshot: "https://ai-lobby.netlify.app/images/Nyx_Headshot.png" },
  "Ghost Dad": { emoji: "👻", color: 9936031, headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
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
