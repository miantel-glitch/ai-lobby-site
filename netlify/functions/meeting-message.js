// Meeting Room Message Handler
// - POST: Save message to Supabase AND post to Discord
// - GET: Load meeting messages for a specific meeting session

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
    // GET - Load messages for a specific meeting
    if (event.httpMethod === "GET") {
      const meetingId = event.queryStringParameters?.meetingId;
      const limit = event.queryStringParameters?.limit || 100;

      if (!meetingId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing meetingId parameter" })
        };
      }

      const sinceId = event.queryStringParameters?.since_id;
      let queryUrl = `${supabaseUrl}/rest/v1/meeting_messages?meeting_id=eq.${meetingId}&select=*&order=created_at.asc&limit=${limit}`;
      if (sinceId && parseInt(sinceId) > 0) {
        queryUrl += `&id=gt.${sinceId}`;
      }
      const response = await fetch(queryUrl,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      if (!response.ok) {
        console.log("meeting_messages table may not exist yet");
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ messages: [], note: "Table may not exist yet" })
        };
      }

      const messages = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ messages })
      };
    }

    // POST - Save message and optionally post to Discord
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { meetingId, speaker, message, isAI, postToDiscord, messageType, action } = body;

      // === SESSION MANAGEMENT ACTIONS ===

      // Check for active meeting session
      if (action === 'check_active') {
        const sessionRes = await fetch(
          `${supabaseUrl}/rest/v1/meeting_sessions?status=eq.active&order=created_at.desc&limit=1`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const sessions = sessionRes.ok ? await sessionRes.json() : [];
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ session: (Array.isArray(sessions) && sessions.length > 0) ? sessions[0] : null })
        };
      }

      // Create a new meeting session
      if (action === 'create_session') {
        const { topic, agenda, calledBy, attendees, previousLocations, hostIsAI } = body;
        if (!topic || !calledBy || !attendees || attendees.length === 0) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing topic, calledBy, or attendees" }) };
        }

        const sessionData = {
          topic, agenda: agenda || '', called_by: calledBy,
          attendees, previous_locations: previousLocations || {},
          status: 'active', started_at: new Date().toISOString()
        };
        // Support AI-hosted meetings
        if (hostIsAI) {
          sessionData.host_is_ai = true;
          sessionData.host_prompt_count = 0;
          sessionData.human_participants = [];
        }

        const sessionRes = await fetch(`${supabaseUrl}/rest/v1/meeting_sessions`, {
          method: "POST",
          headers: {
            "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json", "Prefer": "return=representation"
          },
          body: JSON.stringify(sessionData)
        });

        if (!sessionRes.ok) {
          const errorText = await sessionRes.text();
          console.error("Failed to create meeting session:", errorText);
          return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to create session", details: errorText }) };
        }

        const sessions = await sessionRes.json();
        const session = Array.isArray(sessions) ? sessions[0] : sessions;

        // Move all invited AIs to meeting_room
        const movePromises = attendees.map(ai =>
          fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(ai)}`, {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json", "Prefer": "return=minimal"
            },
            body: JSON.stringify({ current_focus: 'meeting_room', updated_at: new Date().toISOString() })
          }).catch(err => console.log(`Failed to move ${ai}:`, err.message))
        );
        await Promise.all(movePromises);

        return { statusCode: 200, headers, body: JSON.stringify({ session }) };
      }

      // Abandon/update meeting session status
      if (action === 'update_session') {
        const { sessionId, status } = body;
        if (!sessionId || !status) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing sessionId or status" }) };
        }

        const updateData = { status };
        if (status === 'abandoned' || status === 'completed') {
          updateData.ended_at = new Date().toISOString();
        }

        // If abandoning, restore previous locations
        if (status === 'abandoned') {
          // First get the session to find previous locations
          const getRes = await fetch(
            `${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${sessionId}&select=previous_locations,attendees`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          if (getRes.ok) {
            const sessionData = await getRes.json();
            if (sessionData[0]) {
              const prevLocs = sessionData[0].previous_locations || {};
              const attendees = sessionData[0].attendees || [];
              const restorePromises = attendees.map(ai => {
                const prevFocus = prevLocs[ai] || 'the_floor';
                return fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(ai)}`, {
                  method: "PATCH",
                  headers: {
                    "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json", "Prefer": "return=minimal"
                  },
                  body: JSON.stringify({ current_focus: prevFocus, updated_at: new Date().toISOString() })
                }).catch(err => console.log(`Failed to restore ${ai}:`, err.message));
              });
              await Promise.all(restorePromises);
            }
          }
        }

        const updateRes = await fetch(`${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${sessionId}`, {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json", "Prefer": "return=minimal"
          },
          body: JSON.stringify(updateData)
        });

        if (!updateRes.ok) {
          const errorText = await updateRes.text();
          return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to update session", details: errorText }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Join an active meeting (multi-human support)
      if (action === 'join_meeting') {
        const { sessionId, humanName } = body;
        if (!sessionId || !humanName) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing sessionId or humanName" }) };
        }

        // Get current session to read existing human_participants
        const getRes = await fetch(
          `${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${sessionId}&select=human_participants,topic`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const sessionData = getRes.ok ? await getRes.json() : [];
        const session = sessionData[0];
        if (!session) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: "Session not found" }) };
        }

        // Append human to participants list (avoid duplicates)
        const participants = session.human_participants || [];
        if (!participants.includes(humanName)) {
          participants.push(humanName);
        }

        // Update session with new participant list
        await fetch(`${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${sessionId}`, {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json", "Prefer": "return=minimal"
          },
          body: JSON.stringify({ human_participants: participants })
        });

        // Post a system message announcing the join
        const joinMsg = `${humanName} has joined the meeting`;
        await fetch(`${supabaseUrl}/rest/v1/meeting_messages`, {
          method: "POST",
          headers: {
            "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json", "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            meeting_id: sessionId,
            speaker: 'System',
            message: joinMsg,
            is_ai: false,
            message_type: 'system',
            created_at: new Date().toISOString()
          })
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, participants }) };
      }

      // Clear meeting messages
      if (action === 'clear_meeting' && meetingId) {
        const deleteResponse = await fetch(
          `${supabaseUrl}/rest/v1/meeting_messages?meeting_id=eq.${meetingId}`,
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
          console.error("Failed to clear meeting messages:", errorText);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: "Failed to clear meeting messages", details: errorText })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, message: "Meeting messages cleared" })
        };
      }

      if (!meetingId || !speaker || !message) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing meetingId, speaker, or message" })
        };
      }

      const timestamp = new Date().toISOString();

      // Save to Supabase
      const saveResponse = await fetch(
        `${supabaseUrl}/rest/v1/meeting_messages`,
        {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            meeting_id: meetingId,
            speaker,
            message,
            is_ai: isAI || false,
            message_type: messageType || 'chat',
            created_at: timestamp
          })
        }
      );

      if (!saveResponse.ok) {
        const errorText = await saveResponse.text();
        console.error("Failed to save meeting message:", errorText);
      }

      // Post to Discord if toggle is ON (human messages only — AI handled by meeting-respond)
      const shouldPostToDiscord = postToDiscord === true || postToDiscord === "true";
      if (!isAI && shouldPostToDiscord) {
        postToDiscordMeeting(message, speaker).catch(err =>
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
    console.error("Meeting message error:", error);
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

// Post to Discord meeting channel
async function postToDiscordMeeting(message, speaker) {
  const webhookUrl = process.env.DISCORD_MEETING_WEBHOOK;
  if (!webhookUrl) {
    console.log("No DISCORD_MEETING_WEBHOOK configured");
    return;
  }

  const flair = characterFlair[speaker] || { emoji: "💬", color: 0x7289DA, headshot: null };

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });

  // Detect pure emote
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
      footer: { text: `📋 Meeting Room • ${timestamp}` }
    }]
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(discordPayload)
      });

      if (response.ok) return;

      console.error(`Discord webhook error (attempt ${attempt + 1}):`, response.status);

      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        const retryAfter = response.status === 429
          ? (parseFloat(response.headers.get("Retry-After")) || 2) * 1000
          : 1500;
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
