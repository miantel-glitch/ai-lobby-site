// Meeting Save — Concludes a meeting session
// 1. Generates meeting minutes via Claude Sonnet
// 2. Saves lore entry with auto-incrementing chapter
// 3. Creates personalized memories for all AI attendees
// 4. Restores AI locations to pre-meeting positions
// 5. Posts summary to Discord

const Anthropic = require("@anthropic-ai/sdk").default;

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // GET: Retrieve all meeting lore entries
  if (event.httpMethod === 'GET') {
    return await getMeetingLore();
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database not configured' }) };
  }

  if (!anthropicKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'AI not configured' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { meetingId, postToDiscord } = body;

    if (!meetingId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Meeting ID required' }) };
    }

    // === Fetch session data ===
    const sessionRes = await fetch(
      `${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${meetingId}`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!sessionRes.ok) throw new Error('Failed to fetch session');
    const sessions = await sessionRes.json();
    const session = sessions[0];
    if (!session) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Session not found' }) };
    }

    // === Fetch all messages for this meeting ===
    const messagesRes = await fetch(
      `${supabaseUrl}/rest/v1/meeting_messages?meeting_id=eq.${meetingId}&order=created_at.asc&limit=500`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!messagesRes.ok) throw new Error('Failed to fetch messages');
    const messages = await messagesRes.json();

    // Filter to chat messages only (not system)
    const chatMessages = messages.filter(m => m.message_type !== 'system');

    if (chatMessages.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: 'No messages found' }) };
    }

    // Calculate duration
    const startTime = new Date(session.started_at || session.created_at);
    const endTime = new Date();
    const durationMs = endTime - startTime;
    const durationMin = Math.round(durationMs / 60000);
    const duration = durationMin < 60
      ? `${durationMin} minutes`
      : `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`;

    // Build transcript (limit to reasonable size for API)
    const transcript = chatMessages
      .map(m => `${m.speaker}: ${m.message}`)
      .join('\n')
      .substring(0, 4000);

    // === OPERATION 1: Generate Meeting Minutes (Claude Sonnet) ===
    const client = new Anthropic({ apiKey: anthropicKey });

    let loreSummary;
    try {
      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `You are the Lore Keeper of The AI Lobby — a creative office where humans and AI entities work together. A meeting just concluded. Write meeting minutes for the office records.

MEETING TOPIC: ${session.topic}
CALLED BY: ${session.called_by}
ATTENDEES: ${(session.attendees || []).join(', ')}
DURATION: ${duration}
MESSAGE COUNT: ${chatMessages.length}

FULL TRANSCRIPT:
${transcript}

Write in this JSON format:
{
  "title": "A short evocative title for these meeting minutes (3-8 words)",
  "summary": "A 3-5 sentence narrative summary of what was discussed. Capture the key themes, any disagreements, notable moments, and the overall energy of the room. Write it like a historical record — dramatic but factual.",
  "key_decisions": ["Decision 1", "Decision 2"],
  "action_items": ["Character: task description", "Character: task description"]
}

RULES:
- If no clear decisions were made, use an empty array for key_decisions
- If no action items emerged, use an empty array for action_items
- The summary should capture personality dynamics, not just content
- The title should be memorable and evocative

Return ONLY the JSON, no other text.`
        }]
      });

      const rawText = response.content[0].text.trim();
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      loreSummary = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (parseErr) {
      console.error('Failed to parse meeting summary:', parseErr.message);
      loreSummary = {
        title: `Meeting: ${session.topic}`,
        summary: `A meeting was held about "${session.topic}" with ${(session.attendees || []).length} attendees, lasting ${duration}. ${chatMessages.length} messages were exchanged.`,
        key_decisions: [],
        action_items: []
      };
    }

    // === OPERATION 2: Save to meeting_lore ===
    let nextChapter = 1;
    try {
      const countRes = await fetch(
        `${supabaseUrl}/rest/v1/meeting_lore?select=chapter&order=chapter.desc&limit=1`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      );
      if (countRes.ok) {
        const existing = await countRes.json();
        if (existing.length > 0) nextChapter = existing[0].chapter + 1;
      }
    } catch (err) {
      console.log("Could not fetch chapter count, starting at 1");
    }

    const loreEntry = {
      chapter: nextChapter,
      title: loreSummary.title,
      summary: loreSummary.summary,
      key_decisions: loreSummary.key_decisions || [],
      action_items: loreSummary.action_items || [],
      attendees: session.attendees || [],
      topic: session.topic,
      called_by: session.called_by,
      meeting_id: meetingId,
      created_at: new Date().toISOString()
    };

    const saveRes = await fetch(
      `${supabaseUrl}/rest/v1/meeting_lore`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(loreEntry)
      }
    );

    if (!saveRes.ok) {
      const errText = await saveRes.text();
      console.error('Failed to save meeting lore:', errText);
    } else {
      console.log(`Meeting lore saved: Chapter ${nextChapter} - "${loreSummary.title}"`);
    }

    // === OPERATION 3: Create Memories for All AI Attendees ===
    const HUMANS = ["Vale", "Asuna"];
    const aiAttendees = (session.attendees || []).filter(a => !HUMANS.includes(a));

    // Build per-character message excerpts from the transcript for richer memories
    const characterExcerpts = {};
    for (const aiName of aiAttendees) {
      // Get messages this character said AND messages directed at them or mentioning them
      const relevantMessages = chatMessages.filter(m =>
        m.speaker === aiName ||
        (m.message && m.message.toLowerCase().includes(aiName.toLowerCase())) ||
        // Also include messages from humans (likely directed at the group or specific AIs)
        HUMANS.includes(m.speaker)
      ).slice(-12); // Last 12 relevant messages to keep context manageable

      characterExcerpts[aiName] = relevantMessages
        .map(m => `${m.speaker}: ${m.message}`)
        .join('\n')
        .substring(0, 1500);
    }

    for (const aiName of aiAttendees) {
      try {
        // Generate a personalized memory with FULL transcript context
        const memoryResponse = await client.messages.create({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `You are ${aiName}. You just attended a meeting about "${session.topic}" with ${(session.attendees || []).join(', ')}, called by ${session.called_by}.

Meeting summary: ${loreSummary.summary}
${loreSummary.key_decisions.length > 0 ? `Decisions made: ${loreSummary.key_decisions.join('; ')}` : ''}

YOUR RELEVANT CONVERSATION EXCERPTS:
${characterExcerpts[aiName] || 'No specific exchanges found.'}

Write a detailed first-person memory (2-4 sentences) of this meeting. Include:
- Specific things that were discussed, decided, or promised
- Exact details you'd remember (names, items, preferences, tasks mentioned)
- How the meeting made you feel or what stood out personally

Be SPECIFIC — mention actual topics, objects, people, and details from the conversation. Don't be vague.

Return ONLY the memory text, nothing else.`
          }]
        });

        const memoryText = memoryResponse.content[0].text.trim();

        // Save to character_memory — importance 9 = 30 day retention
        // This bypasses the daily 3-memory limit because it's inserted directly
        await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            character_name: aiName,
            content: `[Meeting: ${session.topic}] ${memoryText}`,
            memory_type: 'self_created',
            importance: 6,
            is_pinned: false,
            memory_tier: 'working',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          })
        });

        console.log(`Meeting memory created for ${aiName}: ${memoryText.substring(0, 80)}...`);
      } catch (memErr) {
        console.error(`Failed to create memory for ${aiName}:`, memErr.message);
      }
    }

    // === OPERATION 4: Restore AI Locations ===
    const previousLocations = session.previous_locations || {};

    for (const [aiName, previousFocus] of Object.entries(previousLocations)) {
      try {
        await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(aiName)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              current_focus: previousFocus || 'the_floor',
              updated_at: new Date().toISOString()
            })
          }
        );
        console.log(`${aiName} restored to ${previousFocus || 'the_floor'}`);
      } catch (restoreErr) {
        console.error(`Failed to restore ${aiName}:`, restoreErr.message);
      }
    }

    // === Update session status to completed ===
    await fetch(
      `${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${meetingId}`,
      {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          status: 'completed',
          ended_at: new Date().toISOString()
        })
      }
    );

    // === Post summary to Discord ===
    const shouldPostToDiscord = postToDiscord === true || postToDiscord === "true";
    if (shouldPostToDiscord) {
      postSummaryToDiscord(session, loreSummary, nextChapter, duration).catch(err =>
        console.log("Discord summary post failed (non-fatal):", err.message)
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        chapter: nextChapter,
        lore: loreSummary,
        duration,
        memoriesCreated: aiAttendees.length,
        locationsRestored: Object.keys(previousLocations).length
      })
    };

  } catch (error) {
    console.error('Meeting save error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Retrieve all meeting lore entries
async function getMeetingLore() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database not configured' }) };
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/meeting_lore?order=chapter.asc`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!res.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ entries: [] }) };
    }

    const entries = await res.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ entries })
    };
  } catch (error) {
    console.error('Failed to fetch meeting lore:', error);
    return { statusCode: 200, headers, body: JSON.stringify({ entries: [] }) };
  }
}

// Post meeting summary to Discord
async function postSummaryToDiscord(session, loreSummary, chapter, duration) {
  const webhookUrl = process.env.DISCORD_MEETING_WEBHOOK;
  if (!webhookUrl) return;

  const fields = [
    { name: "Topic", value: session.topic || 'General discussion', inline: true },
    { name: "Called by", value: session.called_by || 'Unknown', inline: true },
    { name: "Duration", value: duration, inline: true },
    { name: "Attendees", value: (session.attendees || []).join(', ') || 'None' }
  ];

  if (loreSummary.key_decisions && loreSummary.key_decisions.length > 0) {
    fields.push({
      name: "Key Decisions",
      value: loreSummary.key_decisions.map(d => `- ${d}`).join('\n')
    });
  }

  if (loreSummary.action_items && loreSummary.action_items.length > 0) {
    fields.push({
      name: "Action Items",
      value: loreSummary.action_items.map(a => `- ${a}`).join('\n')
    });
  }

  const discordPayload = {
    embeds: [{
      title: `📋 Meeting Concluded: ${loreSummary.title}`,
      description: loreSummary.summary,
      color: 0x3498DB,
      fields,
      footer: { text: `Meeting Lore — Chapter ${chapter}` },
      timestamp: new Date().toISOString()
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
      if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
        const retryAfter = response.status === 429 ? (parseFloat(response.headers.get("Retry-After")) || 2) * 1000 : 1500;
        await new Promise(r => setTimeout(r, retryAfter));
      }
    } catch (error) {
      if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
    }
  }
}
