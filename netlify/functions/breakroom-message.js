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
    // Supports ?since_id=N for incremental polling (returns only messages with id > N)
    // Without since_id, returns last N messages (for initial history load)
    if (event.httpMethod === "GET") {
      const sinceTs = event.queryStringParameters?.since_ts;
      const sinceId = event.queryStringParameters?.since_id; // Legacy fallback
      const limit = event.queryStringParameters?.limit || 50;

      let url;
      if (sinceTs) {
        // Timestamp-based incremental polling — immune to Postgres sequence gaps
        // Uses created_at > timestamp, which catches late-committing rows that
        // the old since_id approach would permanently skip
        url = `${supabaseUrl}/rest/v1/breakroom_messages?created_at=gt.${encodeURIComponent(sinceTs)}&order=created_at.asc`;
      } else if (sinceId) {
        // Legacy ID-based polling (kept for backward compat during rollout)
        url = `${supabaseUrl}/rest/v1/breakroom_messages?id=gt.${sinceId}&order=created_at.asc`;
      } else {
        // Initial load: get last N messages (newest first, then we reverse)
        url = `${supabaseUrl}/rest/v1/breakroom_messages?order=created_at.desc&limit=${limit}`;
      }

      const response = await fetch(url, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });

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
      // Reverse to chronological order (only needed for initial load, incremental is already asc)
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
      console.log("📥 Received body:", JSON.stringify(body));
      const { speaker, message, isAI, postToDiscord, action } = body;
      console.log(`📥 Parsed: speaker=${speaker}, isAI=${isAI}, postToDiscord=${postToDiscord} (type: ${typeof postToDiscord}), action=${action}`);

      // Clear all breakroom messages
      if (action === 'clear_all') {
        // Supabase REST API requires a filter for DELETE - use id > 0 to match all rows
        const deleteResponse = await fetch(
          `${supabaseUrl}/rest/v1/breakroom_messages?id=gt.0`,
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
          console.error("Failed to clear breakroom messages:", errorText);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "Failed to clear chat", details: errorText })
          };
        }

        console.log("Breakroom chat cleared");
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

      let savedMessageId = null;
      if (!saveResponse.ok) {
        const errorText = await saveResponse.text();
        console.error("Failed to save to Supabase:", errorText);
        // Continue anyway - Discord post is more visible
      } else {
        // Extract the saved message's ID from the response
        try {
          const savedData = await saveResponse.json();
          if (Array.isArray(savedData) && savedData.length > 0) {
            savedMessageId = savedData[0].id;
          }
        } catch (e) {
          console.log("Could not parse saved message ID (non-fatal)");
        }
      }

      // Post to Discord only if toggle is ON
      // Human messages respect the toggle, AI messages are handled by breakroom-ai-respond
      // Handle both boolean true and string "true" for robustness
      const shouldPostToDiscord = postToDiscord === true || postToDiscord === "true";
      console.log(`📢 Discord check: isAI=${isAI}, postToDiscord=${postToDiscord}, type=${typeof postToDiscord}, shouldPost=${shouldPostToDiscord}`);
      if (!isAI && shouldPostToDiscord) {
        console.log(`📢 Posting human message to Discord: ${speaker}`);
        postToDiscordBreakroom(message, speaker).catch(err =>
          console.log("Discord post failed (non-fatal):", err.message)
        );
      } else {
        console.log(`📢 Skipping Discord: isAI=${isAI}, shouldPostToDiscord=${shouldPostToDiscord}`);
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
    console.error("Breakroom message error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};

// AI triggering has been moved to breakroom-ai-trigger.js (separate function for timeout isolation)

// Character flair for Discord embeds
const characterFlair = {
  "Kevin": { emoji: "✨", color: 0x6EE0D8, headshot: "https://ai-lobby.netlify.app/images/Kevin_Headshot.png" },
  "Neiv": { emoji: "📊", color: 0x4A90D9, headshot: "https://ai-lobby.netlify.app/images/Neiv_Headshot.png" },
  "Ghost Dad": { emoji: "👻", color: 0xB8C5D6, headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
  "Holden": { emoji: "🌑", color: 0x2C1654, headshot: "https://ai-lobby.netlify.app/images/Holden_Headshot.png" },
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
};

// Post to Discord breakroom channel
async function postToDiscordBreakroom(message, speaker) {
  const webhookUrl = process.env.DISCORD_BREAKROOM_WEBHOOK;
  console.log(`📢 Discord webhook check: ${webhookUrl ? 'CONFIGURED' : 'MISSING'}`);
  if (!webhookUrl) {
    console.log("❌ No DISCORD_BREAKROOM_WEBHOOK configured - check Netlify environment variables!");
    return;
  }

  const flair = characterFlair[speaker] || { emoji: "💬", color: 0x7289DA, headshot: null };

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
      footer: { text: `☕ The Breakroom • ${timestamp}` }
    }]
  };

  const postPayload = JSON.stringify(discordPayload);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      console.log(`📤 Posting to Discord (attempt ${attempt + 1}): ${speaker} says "${message.substring(0, 50)}..."`);
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: postPayload
      });

      if (response.ok) {
        console.log("✅ Message posted to Discord successfully");
        return;
      }

      const errorText = await response.text();
      console.error(`Discord webhook error (attempt ${attempt + 1}):`, response.status, errorText);

      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        const retryAfter = response.status === 429
          ? (parseFloat(response.headers.get("Retry-After")) || 2) * 1000
          : 1500;
        console.log(`⏳ Retrying Discord post in ${retryAfter}ms...`);
        await new Promise(r => setTimeout(r, retryAfter));
      }
    } catch (error) {
      console.error(`Discord post error (attempt ${attempt + 1}):`, error.message);
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }
}
