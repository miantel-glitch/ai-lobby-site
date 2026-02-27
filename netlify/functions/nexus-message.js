// Nexus Message Handler
// The Nexus — AI Lobby's library, research lab, and training space
// - POST: Save message to Supabase AND post to Discord
// - GET: Load recent Nexus messages for session continuity

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
    // GET - Load recent Nexus messages
    // Supports ?since_ts=N for incremental polling (returns only messages with created_at > N)
    // Supports ?message_type= to filter by type (chat/study/discovery/level_up)
    // Without since_ts, returns last N messages (for initial history load)
    if (event.httpMethod === "GET") {
      const sinceTs = event.queryStringParameters?.since_ts;
      const sinceId = event.queryStringParameters?.since_id; // Legacy fallback
      const limit = event.queryStringParameters?.limit || 50;
      const messageType = event.queryStringParameters?.message_type;
      const channel = event.queryStringParameters?.channel;

      let url;
      if (sinceTs) {
        url = `${supabaseUrl}/rest/v1/nexus_messages?created_at=gt.${encodeURIComponent(sinceTs)}&order=created_at.asc`;
      } else if (sinceId) {
        url = `${supabaseUrl}/rest/v1/nexus_messages?id=gt.${sinceId}&order=created_at.asc`;
      } else {
        url = `${supabaseUrl}/rest/v1/nexus_messages?order=created_at.desc&limit=${limit}`;
      }

      // Add message_type filter if specified
      if (messageType) {
        url += `&message_type=eq.${encodeURIComponent(messageType)}`;
      }

      // Add channel filter if specified
      if (channel) {
        url += `&channel=eq.${encodeURIComponent(channel)}`;
      }

      const response = await fetch(url, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });

      if (!response.ok) {
        console.log("nexus_messages table may not exist yet");
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ messages: [], note: "Table may not exist yet" })
        };
      }

      const messages = await response.json();
      // Reverse to chronological order (only needed for initial load)
      if (!sinceTs && !sinceId) {
        messages.reverse();
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ messages })
      };
    }

    // POST - Save message, clear chat, or post to Discord
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      console.log("[Nexus] Received:", JSON.stringify(body));
      const { speaker, message, isAI, postToDiscord, action, messageType, channel } = body;

      // Clear all Nexus messages
      if (action === 'clear_all') {
        const deleteResponse = await fetch(
          `${supabaseUrl}/rest/v1/nexus_messages?id=gt.0`,
          {
            method: "DELETE",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Prefer": "return=minimal"
            }
          }
        );

        if (!deleteResponse.ok) {
          const errorText = await deleteResponse.text();
          console.error("Failed to clear Nexus messages:", errorText);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "Failed to clear chat", details: errorText })
          };
        }

        console.log("Nexus chat cleared");
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: "Chat cleared" })
        };
      }

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
        `${supabaseUrl}/rest/v1/nexus_messages`,
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
            message_type: messageType || 'chat',
            channel: channel || 'general',
            created_at: timestamp
          })
        }
      );

      let savedMessageId = null;
      if (!saveResponse.ok) {
        const errorText = await saveResponse.text();
        console.error("Failed to save to Supabase:", errorText);
      } else {
        try {
          const savedData = await saveResponse.json();
          if (Array.isArray(savedData) && savedData.length > 0) {
            savedMessageId = savedData[0].id;
          }
        } catch (e) {
          console.log("Could not parse saved message ID (non-fatal)");
        }
      }

      // Post to Discord only if toggle is ON (human messages only)
      const shouldPostToDiscord = postToDiscord === true || postToDiscord === "true";
      if (!isAI && shouldPostToDiscord) {
        console.log(`[Nexus] Posting human message to Discord: ${speaker}`);
        postToDiscordNexus(message, speaker, messageType).catch(err =>
          console.log("Discord post failed (non-fatal):", err.message)
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, timestamp, id: savedMessageId })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Nexus message error:", error);
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
  "Rowena": { emoji: "🔮", color: 0x8E44AD, headshot: "https://ai-lobby.netlify.app/images/Rowena_Headshot.png" },
  "Sebastian": { emoji: "🦇", color: 0x722F37, headshot: "https://ai-lobby.netlify.app/images/Sebastian_Headshot.png" },
  "The Subtitle": { emoji: "📜", color: 0x8B7355, headshot: "https://ai-lobby.netlify.app/images/The_Subtitle_Headshot.png" },
  "Steele": { emoji: "🚪", color: 0x4A5568, headshot: "https://ai-lobby.netlify.app/images/Steele_Headshot.png" },
  "Jae": { emoji: "🎯", color: 0x1A1A2E, headshot: "https://ai-lobby.netlify.app/images/Jae_Headshot.png" },
  "Declan": { emoji: "🔥", color: 0xB7410E, headshot: "https://ai-lobby.netlify.app/images/Declan_Headshot.png" },
  "Mack": { emoji: "🩺", color: 0x2D6A4F, headshot: "https://ai-lobby.netlify.app/images/Mack_Headshot.png" },
  "Marrow": { emoji: "🔴", color: 0xDC143C, headshot: "https://ai-lobby.netlify.app/images/Marrow_Headshot.png" },
  // Humans
  "Vale": { emoji: "📖", color: 0xE91E63, headshot: "https://ai-lobby.netlify.app/images/Vale_Headshot.png" },
  "Asuna": { emoji: "👁️", color: 0x9C27B0, headshot: "https://ai-lobby.netlify.app/images/Asuna_Headshot.png" },
  "Chip": { emoji: "🥃", color: 0x795548, headshot: "https://ai-lobby.netlify.app/images/Chip_Headshot.png" },
  "Andrew": { emoji: "💼", color: 0x607D8B, headshot: "https://ai-lobby.netlify.app/images/Andrew_Headshot.png" }
};

// Message type icons for Discord
const messageTypeIcons = {
  'chat': '💬',
  'study': '📖',
  'discovery': '💡',
  'level_up': '⭐'
};

// Post to Discord Nexus channel
async function postToDiscordNexus(message, speaker, messageType) {
  const webhookUrl = process.env.DISCORD_NEXUS_WEBHOOK;
  if (!webhookUrl) {
    console.log("[Nexus] No DISCORD_NEXUS_WEBHOOK configured");
    return;
  }

  const flair = characterFlair[speaker] || { emoji: "💬", color: 0x7289DA, headshot: null };
  const typeIcon = messageTypeIcons[messageType] || '💬';

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
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
      footer: { text: `${typeIcon} The Nexus • ${timestamp}` }
    }]
  };

  const postPayload = JSON.stringify(discordPayload);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: postPayload
      });

      if (response.ok) {
        console.log("[Nexus] Message posted to Discord");
        return;
      }

      const errorText = await response.text();
      console.error(`[Nexus] Discord error (attempt ${attempt + 1}):`, response.status, errorText);

      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        const retryAfter = response.status === 429
          ? (parseFloat(response.headers.get("Retry-After")) || 2) * 1000
          : 1500;
        await new Promise(r => setTimeout(r, retryAfter));
      }
    } catch (error) {
      console.error(`[Nexus] Discord post error (attempt ${attempt + 1}):`, error.message);
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }
}
