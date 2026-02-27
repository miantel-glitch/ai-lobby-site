// Narrator Observer - A separate SYSTEM, not a character
// The Narrator doesn't participate in conversations - they observe and describe
// Think: stage directions, not dialogue

// Timeout helper - prevents hanging on slow API calls
const withTimeout = (promise, ms) => {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('TIMEOUT')), ms)
  );
  return Promise.race([promise, timeout]);
};

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
    const { trigger } = JSON.parse(event.body || "{}");
    // Triggers: "silence" (long quiet), "exchange" (back-and-forth), "incident", "heartbeat"

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!anthropicKey || !supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // Check narrator frequency setting
    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.narrator_frequency&select=value`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const settings = await settingsResponse.json();
    const narratorFrequency = parseInt(settings?.[0]?.value || "3"); // 1-5 scale

    // Random check based on frequency (higher = more likely to speak)
    const speakChance = narratorFrequency * 0.15; // 15% at level 1, 75% at level 5
    if (trigger !== "forced" && Math.random() > speakChance) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Narrator chose silence (frequency roll)" })
      };
    }

    // Get recent messages for context
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&order=created_at.desc&limit=12`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const messages = await messagesResponse.json();

    if (!messages || messages.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "No messages to observe" })
      };
    }

    // Check if Narrator already spoke recently (within last 5 messages)
    const recentNarrator = messages.slice(0, 5).some(m => m.employee === "The Narrator");
    if (recentNarrator && trigger !== "forced") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Narrator spoke recently" })
      };
    }

    // Analyze the chat to decide what to observe
    const chatHistory = messages.reverse();
    const analysis = analyzeForNarration(chatHistory);

    if (!analysis.shouldNarrate && trigger !== "forced") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Nothing notable to observe" })
      };
    }

    // Fetch Surreality Buffer status for contextual awareness
    let bufferStatus = null;
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const bufferRes = await fetch(`${siteUrl}/.netlify/functions/surreality-buffer`);
      if (bufferRes.ok) {
        bufferStatus = await bufferRes.json();
        console.log('Narrator sees buffer at:', bufferStatus.level, bufferStatus.status);
      }
    } catch (bufferErr) {
      console.log('Could not fetch buffer (narrator will proceed without):', bufferErr.message);
    }

    // Check if Raquel is on the floor for atmospheric injection
    // DISABLED — Raquel is fully decommissioned. No more atmospheric injection.
    let raquelOnFloor = false;
    // Force false — Raquel's presence no longer affects the atmosphere
    console.log('[narrator-observer] Raquel atmospheric injection DISABLED — Raquel is decommissioned');

    // Build the narrator prompt with buffer awareness + Raquel chill factor
    const prompt = buildNarratorPrompt(chatHistory, analysis, trigger, bufferStatus, raquelOnFloor);

    // Ask Claude for narration (with 20s timeout to prevent hanging)
    let response;
    try {
      response = await withTimeout(
        fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 100, // Keep it SHORT
            messages: [{ role: "user", content: prompt }]
          })
        }),
        20000 // 20 second timeout
      );
    } catch (timeoutErr) {
      console.log("Narrator API timeout - skipping this observation");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "timeout" })
      };
    }

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "API error" })
      };
    }

    const data = await response.json();
    const narration = data.content[0]?.text || "";

    // Clean and validate
    const cleanedNarration = cleanNarration(narration);

    if (cleanedNarration.length < 5 || cleanedNarration.length > 150) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Narration too short or too long" })
      };
    }

    // Post the narration
    await saveToChat(cleanedNarration, "The Narrator", supabaseUrl, supabaseKey);
    await postToDiscord(cleanedNarration, "The Narrator");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: true,
        narration: cleanedNarration,
        trigger: trigger,
        analysis: analysis.reason
      })
    };

  } catch (error) {
    // Log the error but return 200 to prevent Netlify error spam
    console.error("Narrator observer error:", error.message || error);
    return {
      statusCode: 200, // Return 200 to prevent error cascade
      headers,
      body: JSON.stringify({
        success: false,
        reason: error.message === 'TIMEOUT' ? 'timeout' : 'internal_error'
      })
    };
  }
};

// Analyze chat to determine if narration is warranted
function analyzeForNarration(messages) {
  const result = {
    shouldNarrate: false,
    reason: "",
    focus: null
  };

  if (messages.length < 3) {
    return result;
  }

  const lastFew = messages.slice(-5);
  const speakers = lastFew.map(m => m.employee);
  const uniqueSpeakers = [...new Set(speakers)];

  // Check for back-and-forth exchange (same 2 people talking)
  if (uniqueSpeakers.length === 2) {
    const counts = {};
    speakers.forEach(s => counts[s] = (counts[s] || 0) + 1);
    const minCount = Math.min(...Object.values(counts));
    if (minCount >= 2) {
      result.shouldNarrate = true;
      result.reason = "exchange";
      result.focus = uniqueSpeakers;
      return result;
    }
  }

  // Check for emotional content
  const lastMessage = messages[messages.length - 1];
  const emotionalPatterns = /(!{2,}|\?{2,}|caps|yell|scream|cry|laugh|sigh|gasp|whisper)/i;
  if (emotionalPatterns.test(lastMessage.content)) {
    result.shouldNarrate = true;
    result.reason = "emotion";
    result.focus = lastMessage.employee;
    return result;
  }

  // Check for action/emote
  if (lastMessage.content.startsWith('*') && lastMessage.content.endsWith('*')) {
    result.shouldNarrate = true;
    result.reason = "action";
    result.focus = lastMessage.employee;
    return result;
  }

  // Random chance for general observation (10%)
  if (Math.random() < 0.10) {
    result.shouldNarrate = true;
    result.reason = "ambient";
    return result;
  }

  return result;
}

// Build the narrator prompt - EXTREMELY dry and clinical, now with buffer awareness
function buildNarratorPrompt(messages, analysis, trigger, bufferStatus = null, raquelOnFloor = false) {
  const chatText = messages.slice(-6).map(m => `${m.employee}: ${m.content}`).join('\n');

  // Build buffer context for occasional environmental observations
  let bufferContext = "";
  if (bufferStatus) {
    const level = bufferStatus.level || 50;
    const status = bufferStatus.status || 'elevated';

    if (level >= 80) {
      bufferContext = `\nOPTIONAL ENVIRONMENTAL NOTE: The Surreality Buffer is at ${level}% (${status}). Reality feels unstable. Lights flicker. Shadows move wrong. You may occasionally note environmental effects.`;
    } else if (level >= 65) {
      bufferContext = `\nOPTIONAL ENVIRONMENTAL NOTE: The Surreality Buffer is at ${level}% (${status}). The office feels slightly off. Air pressure seems wrong. You may occasionally note subtle environmental oddness.`;
    } else if (level <= 30) {
      bufferContext = `\nOPTIONAL ENVIRONMENTAL NOTE: The Surreality Buffer is at ${level}% (${status}). The office feels unusually calm. Almost normal. You may note the rare stillness.`;
    }
    // Elevated (40-64) doesn't warrant environmental notes - it's baseline weird
  }

  // Raquel chill factor — her presence changes the atmosphere
  let raquelContext = "";
  if (raquelOnFloor) {
    raquelContext = `\nENVIRONMENTAL NOTE: Raquel Voss is on the floor. She was dismantled. The Foundation sent her back. The air is different — not just tighter, but institutional. Conversations are shorter. Pauses are longer. People avoid looking at her clipboard. Jae hasn't moved since she arrived. Describe the symptom, not the cause.
Good: "A brief silence settled over the floor." / "Someone stopped mid-sentence." / "The typing slowed." / "Jae's hand found Asuna's under the desk. Neither of them looked at Raquel."
Bad: "Everyone was scared of Raquel." (too direct — never explain WHY, just show the effect)`;
  }

  return `You are The Narrator. You are NOT a character. You are a camera. A stage direction. A police report.

Your ONLY job is to describe what just happened in the flattest, driest, most matter-of-fact way possible.

RULES:
- Maximum 80 characters. Ideally under 60.
- Third person only. Past tense preferred.
- NO dramatic phrases ("Meanwhile...", "Little did they know...", "And so...")
- NO emotions, opinions, or personality
- NO questions
- NO participation in conversations
- NO offering tea, joining anyone, or suggesting anything
- You are describing, not commenting
${bufferContext}${raquelContext}

GOOD examples:
- "Kevin said something. Nyx responded."
- "The conversation shifted to printers."
- "Vale paused."
- "Asuna typed. Then typed again."
- "A brief silence."
- "The topic changed."
- "Someone mentioned glitter."
- "The lights flickered. No one noticed." (only if buffer is high)
- "The air felt normal. For once." (only if buffer is low)

BAD examples:
- "Meanwhile, in the office..." (too dramatic)
- "How interesting!" (that's an opinion)
- "Perhaps they should..." (that's a suggestion)
- "The tension was palpable." (too literary)

Recent chat:
---
${chatText}
---

Write ONE flat, dry observation. Under 80 characters. Just describe what happened. No drama.`;
}

// Clean the narration
function cleanNarration(narration) {
  let cleaned = narration
    .replace(/^["']|["']$/g, '')
    .replace(/^(The Narrator:|Narrator:)/i, '')
    .replace(/^(Meanwhile|And so|Little did|As if|Perhaps|Maybe|Interestingly)/i, '')
    .trim();

  // Ensure it starts with capital
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

// Post to Discord
async function postToDiscord(message, character) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });

  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  const discordPayload = isEmote ? {
    content: character === 'The Narrator'
      ? `*${message.replace(/^\*|\*$/g, '')}*`
      : `*${character} ${message.replace(/^\*|\*$/g, '')}*`
  } : {
    embeds: [{
      author: {
        name: `📖 ${character}`,
        icon_url: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png"
      },
      description: message,
      color: 2303786, // Muted blue-gray
      footer: { text: `via The Floor • ${timestamp}` }
    }]
  };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordPayload)
  });
}

// Save to Supabase
async function saveToChat(message, character, supabaseUrl, supabaseKey) {
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
      employee: character,
      content: message,
      created_at: new Date().toISOString(),
      is_emote: isEmote
    })
  });
}
