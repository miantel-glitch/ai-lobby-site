// AI Auto-Poke - Scheduled function to periodically trigger AI responses
// Runs every 1 minute via Netlify scheduled functions
// Gives AIs a chance to organically comment on recent chat activity
// But ONLY when Story Mode is enabled

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // Check if story mode is enabled (default to FALSE now for safety)
    let storyModeEnabled = false;
    try {
      const settingsResponse = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.story_mode&select=value`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json();
        storyModeEnabled = settings?.[0]?.value === 'true';
      }
    } catch (settingsError) {
      console.log("Could not check story mode, defaulting to disabled:", settingsError);
    }

    if (!storyModeEnabled) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Story mode is disabled" })
      };
    }

    // Random delay simulation: 80% chance to skip (creates ~1-5 min effective interval)
    // Since this runs every minute, skipping 80% means we trigger roughly every 5 minutes on average
    // but with natural randomness
    if (Math.random() < 0.80) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Random skip (natural timing)" })
      };
    }

    // Check for recent chat activity (last 30 minutes)
    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&created_at=gte.${thirtyMinAgo}&order=created_at.desc&limit=15`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!messagesResponse.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: `Messages fetch failed: ${messagesResponse.status}` })
      };
    }

    const recentMessages = await messagesResponse.json();

    // If no recent activity, skip (don't poke an empty room)
    if (!recentMessages || recentMessages.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "No recent chat activity" })
      };
    }

    // Check if an AI already spoke in the last 3 messages (don't over-saturate)
    const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Vex", "Nyx", "Stein", "Kevin", "The Narrator", "Ace"];
    const lastThree = recentMessages.slice(0, 3);
    const recentAICount = lastThree.filter(m => aiCharacters.includes(m.employee)).length;

    if (recentAICount >= 2) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "AIs already active in recent messages" })
      };
    }

    // Check if there's human activity that might warrant a response
    const humanMessages = recentMessages.filter(m => !aiCharacters.includes(m.employee));
    if (humanMessages.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "No human messages to respond to" })
      };
    }

    // Trigger the AI watcher
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    const response = await fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "scheduled_poke" })
    });

    const result = await response.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        triggered: true,
        watcherResult: result
      })
    };

  } catch (error) {
    console.error("AI Auto-Poke error:", error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, reason: "Error during auto-poke" })
    };
  }
};
