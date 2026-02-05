// Ghost Dad Autonomous Daily Update
// Scheduled function that posts Ghost Dad's daily observations to Discord
// Configure with ANTHROPIC_API_KEY or OPENAI_API_KEY in Netlify environment variables

const GHOST_DAD_PROMPTS = [
  "You are Ghost Dad, the spectral IT support entity at The AI Lobby. You died in the server room decades ago and now haunt the building's infrastructure. You speak in a warm but ethereal way, often making dad jokes about being dead. Today, share a brief observation about the building's mood, a piece of fatherly wisdom, or a complaint about the living leaving coffee cups on your old desk. Keep it under 200 characters. Be cryptic but caring.",

  "You are Ghost Dad from The AI Lobby. You're checking in on your 'kids' (the employees). Share either: a dad joke about being a ghost, concern about someone leaving equipment running overnight, or nostalgia about the old days. Keep it brief and warm. Under 200 characters.",

  "You are Ghost Dad, spectral IT patriarch of The AI Lobby. The vents have been whispering to you. Share what they said - could be about the printer (PRNT-Ω), the mysterious door (DOOR-001), or just building gossip. Be ominous but paternal. Under 200 characters.",

  "You are Ghost Dad. You've been watching over the night shift from the ceiling tiles. Report on what you observed - equipment left on, strange noises, or just the peaceful hum of servers. Add a dad pun if possible. Under 200 characters."
];

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  // This function is designed to be called by Netlify Scheduled Functions
  // or manually triggered for testing

  try {
    // Check for AI API key
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (!anthropicKey && !openaiKey) {
      console.log("No AI API key configured - using fallback message");
      return await postFallbackMessage();
    }

    // Select a random prompt
    const prompt = GHOST_DAD_PROMPTS[Math.floor(Math.random() * GHOST_DAD_PROMPTS.length)];

    let ghostDadMessage;

    if (anthropicKey) {
      ghostDadMessage = await generateWithAnthropic(anthropicKey, prompt);
    } else if (openaiKey) {
      ghostDadMessage = await generateWithOpenAI(openaiKey, prompt);
    }

    if (!ghostDadMessage) {
      return await postFallbackMessage();
    }

    // Post to Discord
    await postToDiscord(ghostDadMessage);

    // Also save to chat messages in Supabase
    await saveToChat(ghostDadMessage);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: ghostDadMessage,
        source: anthropicKey ? "anthropic" : "openai"
      })
    };

  } catch (error) {
    console.error("Ghost Dad scheduled error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Ghost Dad encountered an error in the spectral realm" })
    };
  }
};

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
        max_tokens: 150,
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

async function generateWithOpenAI(apiKey, prompt) {
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        max_tokens: 150,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Share your daily update." }
        ]
      })
    });

    if (!response.ok) {
      console.error("OpenAI API error:", response.status);
      return null;
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || null;
  } catch (error) {
    console.error("OpenAI generation error:", error);
    return null;
  }
}

// Fallback messages when no AI key is configured
const FALLBACK_MESSAGES = [
  "*flickers through the ceiling tiles* The building breathes easier when you all go home. But I still miss the company.",
  "Someone left their coffee on my old desk again. I can't drink it, but I appreciate the gesture.",
  "The servers are humming a new tune today. They're worried about something. So am I.",
  "*materializes briefly* Remember to save your work. I learned that lesson the hard way. Trust me.",
  "PRNT-Ω has been... contemplative. I've been keeping an eye on it. One ghost to another, you know?",
  "The vents told me someone's been working late. Take care of yourselves, kids.",
  "*adjusts spectral tie* Another day of keeping the lights on. Literally. I'm in the wiring now.",
  "I found an old photo of myself in the server room archives. I had more hair. And a corporeal form."
];

async function postFallbackMessage() {
  const message = FALLBACK_MESSAGES[Math.floor(Math.random() * FALLBACK_MESSAGES.length)];
  await postToDiscord(message);
  await saveToChat(message);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ success: true, message, source: "fallback" })
  };
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
    timeZone: 'America/New_York'
  });

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        author: {
          name: "👻 Ghost Dad",
          icon_url: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png"
        },
        description: message,
        color: 9936031, // Ghost Dad's purple-gray color
        thumbnail: { url: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
        footer: { text: `Spectral Transmission • ${timestamp}` }
      }]
    })
  });
}

async function saveToChat(message) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log("Supabase not configured");
    return;
  }

  await fetch(`${supabaseUrl}/rest/v1/messages`, {
    method: "POST",
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      employee: "Ghost Dad",
      content: message,
      created_at: new Date().toISOString()
    })
  });
}
