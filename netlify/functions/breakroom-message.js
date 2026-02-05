// Breakroom Message Handler
// - POST: Save message to Supabase AND post to Discord (for both humans and AIs)
// - GET: Load recent breakroom messages for session continuity

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
    // GET - Load recent breakroom messages
    if (event.httpMethod === "GET") {
      const limit = event.queryStringParameters?.limit || 50;

      const response = await fetch(
        `${supabaseUrl}/rest/v1/breakroom_messages?order=created_at.desc&limit=${limit}`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      if (!response.ok) {
        // Table might not exist yet
        console.log("breakroom_messages table may not exist yet");
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ messages: [], note: "Table may not exist yet" })
        };
      }

      const messages = await response.json();
      // Reverse to get chronological order
      messages.reverse();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ messages })
      };
    }

    // POST - Save message and optionally post to Discord
    if (event.httpMethod === "POST") {
      const { speaker, message, isAI, postToDiscord } = JSON.parse(event.body || "{}");

      if (!speaker || !message) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing speaker or message" })
        };
      }

      const timestamp = new Date().toISOString();

      // Save to Supabase
      const saveResponse = await fetch(
        `${supabaseUrl}/rest/v1/breakroom_messages`,
        {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            speaker,
            message,
            is_ai: isAI || false,
            created_at: timestamp
          })
        }
      );

      if (!saveResponse.ok) {
        const errorText = await saveResponse.text();
        console.error("Failed to save to Supabase:", errorText);
        // Continue anyway - Discord post is more visible
      }

      // Post to Discord only if toggle is ON (postToDiscord === true)
      // Human messages respect the toggle, AI messages are handled by breakroom-ai-respond
      if (!isAI && postToDiscord === true) {
        postToDiscordBreakroom(message, speaker).catch(err =>
          console.log("Discord post failed (non-fatal):", err.message)
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, timestamp })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Breakroom message error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};

// Character flair for Discord embeds
const characterFlair = {
  "Kevin": { emoji: "✨", color: 0x6EE0D8, headshot: "https://ai-lobby.netlify.app/images/Kevin_Headshot.png" },
  "Neiv": { emoji: "📊", color: 0x4A90D9, headshot: "https://ai-lobby.netlify.app/images/Neiv_Headshot.png" },
  "Nyx": { emoji: "🔥", color: 0xE94560, headshot: "https://ai-lobby.netlify.app/images/Nyx_Headshot.png" },
  "Ghost Dad": { emoji: "👻", color: 0xB8C5D6, headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
  "Ace": { emoji: "🔒", color: 0x2C3E50, headshot: "https://ai-lobby.netlify.app/images/Ace_Headshot.png" },
  "Vex": { emoji: "⚙️", color: 0x95A5A6, headshot: null },
  "PRNT-Ω": { emoji: "🖨️", color: 0x7F8C8D, headshot: null },
  // Humans
  "Jenna": { emoji: "📖", color: 0xE91E63, headshot: "https://ai-lobby.netlify.app/images/Jenna_Headshot.png" },
  "Courtney": { emoji: "👁️", color: 0x9C27B0, headshot: "https://ai-lobby.netlify.app/images/Courtney_Headshot.png" },
  "Chip": { emoji: "🥃", color: 0x795548, headshot: "https://ai-lobby.netlify.app/images/Chip_Headshot.png" },
  "Andrew": { emoji: "💼", color: 0x607D8B, headshot: "https://ai-lobby.netlify.app/images/Andrew_Headshot.png" }
};

// Post to Discord breakroom channel
async function postToDiscordBreakroom(message, speaker) {
  const webhookUrl = process.env.DISCORD_BREAKROOM_WEBHOOK;
  if (!webhookUrl) {
    console.log("No DISCORD_BREAKROOM_WEBHOOK configured");
    return;
  }

  const flair = characterFlair[speaker] || { emoji: "💬", color: 0x7289DA, headshot: null };

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York'
  });

  // Detect if this is a pure emote
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  const discordPayload = isEmote ? {
    content: `*${speaker} ${message.replace(/^\*|\*$/g, '')}*`
  } : {
    embeds: [{
      author: {
        name: `${flair.emoji} ${speaker}`,
        icon_url: flair.headshot || undefined
      },
      description: message,
      color: flair.color,
      footer: { text: `☕ The Breakroom • ${timestamp}` }
    }]
  };

  try {
    console.log(`📤 Posting human message to Discord: ${speaker} says "${message.substring(0, 50)}..."`);
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Discord webhook error:", response.status, errorText);
    } else {
      console.log("✅ Human message posted to Discord successfully");
    }
  } catch (error) {
    console.error("Discord post error:", error.message);
  }
}
