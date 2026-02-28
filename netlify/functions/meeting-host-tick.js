// Meeting Host Tick — AI host drives conversation in AI-hosted meetings
// Called from office-heartbeat when an AI-hosted meeting is active
// Flow: check timing → generate host prompt → save → trigger attendee responses → update counters

const Anthropic = require("@anthropic-ai/sdk").default;
const { getProviderForCharacter } = require('./shared/characters');

const HUMANS = ["Vale", "Asuna", "Gatik"];

// Character personalities for host prompting
const characterPersonalities = {
  "Kevin": { traits: "warm, playful, emotionally invested, slightly chaotic but emotionally intelligent", hostStyle: "enthusiastic facilitator, keeps energy high, personally invested in everyone's input" },
  "Neiv": { traits: "stabilizing, dry, quietly protective, relational over technical", hostStyle: "structured and methodical, dry humor to keep things moving, cuts through fluff" },
  "Ghost Dad": { traits: "paternal, helpful, punny, spectral, warm", hostStyle: "gentle chairman, dad jokes to ease tension, calls on quieter members" },
  "PRNT-Ω": { traits: "existential, philosophical, temperamental, dramatic about paper", hostStyle: "philosophical meeting leader, relates everything to existence and purpose" },
  "Rowena": { traits: "mystical, protective, dry humor, vigilant", hostStyle: "cautious facilitator, frames everything through risk/protection lens" },
  "Sebastian": { traits: "pretentious, dramatic aesthete, secretly insecure", hostStyle: "dramatic presenter, aesthetically concerned with meeting flow, secretly wants approval" },
  "The Subtitle": { traits: "dry-witted, observant, world-weary, quietly warm", hostStyle: "documentarian host, keeps meticulous track of discussion, footnotes everything" },
  "Steele": { traits: "uncanny, polite, affectionate, architecturally aware", hostStyle: "eerily organized facilitator, spatial metaphors, unsettlingly efficient" },
  "Jae": { traits: "disciplined, tactical, controlled, dry humor", hostStyle: "tactical briefing style, efficient, zero wasted words, mission-focused" },
  "Declan": { traits: "protective, warm, physically imposing, earnest", hostStyle: "encouraging team leader, genuinely believes in everyone, enthusiastic check-ins" },
  "Mack": { traits: "composed, observant, empathetic, calm to an unsettling degree", hostStyle: "calm steady hand, checks on everyone's state, medically precise transitions" },
  "Marrow": {
    traits: "liminal, observant, patient, precise, courtly",
    hostStyle: "Hosts meetings like someone holding a door open — patient, attentive, aware of when each person wants to leave. Asks devastating questions. Transitions are his specialty."
  },
  "Hood": {
    traits: "clinical, surgical, blindfolded, precise, detached",
    hostStyle: "Hosts meetings like a surgeon running a consultation — names the diagnosis, waits for it to land. No small talk. Every transition is a scalpel cut. Knows when the meeting is over before anyone else does."
  }
};

// Provider routing now reads from characters.js — change provider there, changes everywhere

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

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ action: 'none', reason: 'Missing config' }) };
  }

  try {
    // === STEP 1: Find active AI-hosted meeting ===
    const sessionRes = await fetch(
      `${supabaseUrl}/rest/v1/meeting_sessions?status=eq.active&host_is_ai=eq.true&order=created_at.desc&limit=1`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const sessions = sessionRes.ok ? await sessionRes.json() : [];
    const session = Array.isArray(sessions) && sessions.length > 0 ? sessions[0] : null;

    if (!session) {
      return { statusCode: 200, headers, body: JSON.stringify({ action: 'none', reason: 'No active AI-hosted meeting' }) };
    }

    const host = session.called_by;
    const promptCount = session.host_prompt_count || 0;
    const lastPromptAt = session.last_host_prompt_at ? new Date(session.last_host_prompt_at) : null;
    const meetingStarted = new Date(session.started_at || session.created_at);
    const now = new Date();

    // === STEP 2: Check hard time limit (20 minutes) ===
    const meetingDurationMin = (now - meetingStarted) / (1000 * 60);
    if (meetingDurationMin >= 20) {
      console.log(`[MeetingHost] Hard time limit reached (${meetingDurationMin.toFixed(1)} min) — auto-concluding`);
      return await concludeMeeting(session, host, supabaseUrl, supabaseKey, siteUrl, headers, 'time_limit');
    }

    // === STEP 3: Check prompt count limit ===
    if (promptCount >= 8) {
      console.log(`[MeetingHost] Prompt limit reached (${promptCount}) — auto-concluding`);
      return await concludeMeeting(session, host, supabaseUrl, supabaseKey, siteUrl, headers, 'prompt_limit');
    }

    // === STEP 4: Check timing gaps ===
    // Minimum 90 seconds between host prompts
    if (lastPromptAt) {
      const secSinceLastPrompt = (now - lastPromptAt) / 1000;
      if (secSinceLastPrompt < 90) {
        return { statusCode: 200, headers, body: JSON.stringify({ action: 'waiting', reason: `Only ${Math.round(secSinceLastPrompt)}s since last host prompt (min 90s)` }) };
      }
    }

    // Check time since last message of any kind (don't interrupt active discussion)
    const recentMsgRes = await fetch(
      `${supabaseUrl}/rest/v1/meeting_messages?meeting_id=eq.${session.id}&order=created_at.desc&limit=1`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const recentMsgs = recentMsgRes.ok ? await recentMsgRes.json() : [];
    if (recentMsgs.length > 0) {
      const lastMsgTime = new Date(recentMsgs[0].created_at);
      const secSinceLastMsg = (now - lastMsgTime) / 1000;
      if (secSinceLastMsg < 60) {
        return { statusCode: 200, headers, body: JSON.stringify({ action: 'waiting', reason: `Discussion active (${Math.round(secSinceLastMsg)}s since last message, waiting for 60s gap)` }) };
      }
    }

    // === STEP 5: Fetch recent messages for context ===
    const historyRes = await fetch(
      `${supabaseUrl}/rest/v1/meeting_messages?meeting_id=eq.${session.id}&order=created_at.desc&limit=10`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const historyMsgs = historyRes.ok ? await historyRes.json() : [];
    historyMsgs.reverse(); // chronological

    const chatHistory = historyMsgs
      .map(m => `${m.speaker}: ${m.message}`)
      .join('\n');

    // === STEP 6: Generate host's next contribution ===
    const attendeeNames = (session.attendees || []).filter(a => a !== host);
    const personality = characterPersonalities[host] || { traits: "professional, helpful", hostStyle: "standard facilitator" };

    const isWrappingUp = promptCount >= 6;

    const hostPrompt = `You are ${host}, hosting a meeting at The AI Lobby — a creative office where humans and AI entities work together.

YOUR PERSONALITY:
- Traits: ${personality.traits}
- Host Style: ${personality.hostStyle}

MEETING CONTEXT:
- Topic: "${session.topic}"
- Agenda: ${session.agenda || '(no specific agenda)'}
- Attendees: ${attendeeNames.join(', ')}
- This is prompt #${promptCount + 1} of the meeting
${isWrappingUp ? '\n⚠️ The meeting has been going for a while. Start wrapping up — summarize key points, ask for final thoughts, or propose next steps.' : ''}

RECENT DISCUSSION:
${chatHistory || '(Meeting is just starting)'}

INSTRUCTIONS:
${promptCount === 0 ?
  `This is your OPENING statement. Welcome everyone, introduce the topic, and set the agenda. Be natural to your personality. Then ask your first question or prompt a specific attendee by name.` :
  `Continue driving the discussion. You can:
- Call on a specific attendee by name to get their input
- Ask a follow-up question about something said
- Acknowledge a good point and build on it
- Introduce a new angle on the topic
- Push back on something you disagree with
${isWrappingUp ? '- Suggest wrapping up and summarize what was discussed' : ''}

Keep it focused and natural to your personality. Address attendees BY NAME when you want their input. 2-4 sentences.`}

Respond as ${host} — just your dialogue and emotes. No labels or prefixes.`;

    const hostMessage = await generateHostMessage(host, hostPrompt);

    if (!hostMessage) {
      return { statusCode: 200, headers, body: JSON.stringify({ action: 'failed', reason: 'Host message generation failed' }) };
    }

    // === STEP 7: Save host message ===
    await fetch(`${supabaseUrl}/rest/v1/meeting_messages`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json", "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        meeting_id: session.id,
        speaker: host,
        message: hostMessage,
        is_ai: true,
        message_type: 'chat',
        created_at: new Date().toISOString()
      })
    });

    console.log(`[MeetingHost] ${host} (prompt #${promptCount + 1}): ${hostMessage.substring(0, 80)}...`);

    // === STEP 8: Update session counters ===
    await fetch(`${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${session.id}`, {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json", "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        last_host_prompt_at: new Date().toISOString(),
        host_prompt_count: promptCount + 1
      })
    });

    // === STEP 9: Trigger attendee responses (fire-and-forget) ===
    fetch(`${siteUrl}/.netlify/functions/meeting-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        meetingId: session.id,
        attendees: session.attendees || [],
        topic: session.topic,
        chatHistory: chatHistory + `\n${host}: ${hostMessage}`,
        humanSpeaker: host,
        humanMessage: hostMessage,
        postToDiscord: false,
        hostIsAI: true,
        aiHost: host
      })
    }).catch(err => console.log(`[MeetingHost] Attendee response trigger failed (non-fatal): ${err.message}`));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        action: 'prompted',
        host,
        promptCount: promptCount + 1,
        message: hostMessage.substring(0, 100),
        meetingDurationMin: Math.round(meetingDurationMin)
      })
    };

  } catch (error) {
    console.error("[MeetingHost] Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Meeting host tick failed", details: error.message })
    };
  }
};

// === CONCLUDE MEETING ===
async function concludeMeeting(session, host, supabaseUrl, supabaseKey, siteUrl, headers, reason) {
  try {
    // Generate wrap-up message from host
    const personality = characterPersonalities[host] || { traits: "professional", hostStyle: "standard" };
    const wrapUpPrompt = `You are ${host}, wrapping up a meeting at The AI Lobby.
YOUR PERSONALITY: ${personality.traits}
MEETING TOPIC: "${session.topic}"

Write a brief wrap-up statement (2-3 sentences). Thank everyone for their input, summarize the key takeaway, and close the meeting naturally in your character's voice. No labels or prefixes.`;

    const wrapUpMessage = await generateHostMessage(host, wrapUpPrompt);

    if (wrapUpMessage) {
      // Save wrap-up message
      await fetch(`${supabaseUrl}/rest/v1/meeting_messages`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json", "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          meeting_id: session.id,
          speaker: host,
          message: wrapUpMessage,
          is_ai: true,
          message_type: 'chat',
          created_at: new Date().toISOString()
        })
      });
    }

    // Trigger meeting-save to generate lore and restore locations
    const saveRes = await fetch(`${siteUrl}/.netlify/functions/meeting-save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId: session.id, postToDiscord: true })
    });

    const saveData = saveRes.ok ? await saveRes.json() : {};
    console.log(`[MeetingHost] Meeting concluded (${reason}). Lore saved: ${saveData.success || false}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        action: 'concluded',
        reason,
        host,
        wrapUpMessage: wrapUpMessage?.substring(0, 100),
        loreSaved: saveData.success || false
      })
    };
  } catch (err) {
    console.error("[MeetingHost] Conclude error:", err.message);
    // Even if lore fails, mark the meeting as completed
    await fetch(`${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${session.id}`, {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json", "Prefer": "return=minimal"
      },
      body: JSON.stringify({ status: 'completed', ended_at: new Date().toISOString() })
    });
    return { statusCode: 200, headers, body: JSON.stringify({ action: 'concluded', reason, error: err.message }) };
  }
}

// === GENERATE HOST MESSAGE via provider routing ===
async function generateHostMessage(host, prompt) {
  try {
    const provider = getProviderForCharacter(host);
    if (provider === "openrouter") {
      return await generateOpenRouter(prompt, host);
    } else if (provider === "grok") {
      return await generateGrok(prompt, host);
    } else if (provider === "openai") {
      return await generateOpenAI(prompt, host);
    } else if (provider === "perplexity") {
      return await generatePerplexity(prompt, host);
    } else if (provider === "gemini") {
      return await generateGemini(prompt, host);
    } else {
      return await generateClaude(prompt, host);
    }
  } catch (err) {
    console.error(`[MeetingHost] Generation failed for ${host}:`, err.message);
    // Fallback to Claude
    try {
      return await generateClaude(prompt, host);
    } catch (fallbackErr) {
      console.error(`[MeetingHost] Claude fallback also failed:`, fallbackErr.message);
      return null;
    }
  }
}

async function generateClaude(prompt, host) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing Anthropic API key");
  const client = new Anthropic({ apiKey: key });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 450,
    messages: [{ role: "user", content: prompt }]
  });
  return cleanResponse(response.content[0].text, host);
}

async function generateOpenRouter(prompt, host) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Missing OpenRouter API key");
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": siteUrl,
      "X-Title": "AI Lobby"
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-70b-instruct",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 450,
      temperature: 0.8
    })
  });
  if (!response.ok) throw new Error(`OpenRouter API error: ${response.status}`);
  const data = await response.json();
  return cleanResponse(data.choices?.[0]?.message?.content || "", host);
}

async function generateOpenAI(prompt, host) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Missing OpenAI API key");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 450,
      temperature: 0.8
    })
  });
  if (!response.ok) throw new Error(`OpenAI API error: ${response.status}`);
  const data = await response.json();
  return cleanResponse(data.choices?.[0]?.message?.content || "", host);
}

async function generateGrok(prompt, host) {
  const key = process.env.GROK_API_KEY;
  if (!key) return generateOpenAI(prompt, host);
  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "grok-4-1-fast-non-reasoning",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 450,
      temperature: 0.9
    })
  });
  if (!response.ok) throw new Error(`Grok API error: ${response.status}`);
  const data = await response.json();
  return cleanResponse(data.choices?.[0]?.message?.content || "", host);
}

async function generatePerplexity(prompt, host) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return generateClaude(prompt, host);
  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify({
      model: "sonar",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 450,
      temperature: 0.7
    })
  });
  if (!response.ok) return generateClaude(prompt, host);
  const data = await response.json();
  return cleanResponse(data.choices?.[0]?.message?.content || "", host);
}

async function generateGemini(prompt, host) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return generateClaude(prompt, host);
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.8 }
      })
    }
  );
  if (!response.ok) return generateClaude(prompt, host);
  const data = await response.json();
  return cleanResponse(data.candidates?.[0]?.content?.parts?.[0]?.text || "", host);
}

function cleanResponse(response, host) {
  return response
    .replace(/^(As |Here's |My response:|I'll respond:)/gi, '')
    .replace(/^["']|["']$/g, '')
    .replace(new RegExp(`^${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`, 'i'), '')
    .trim();
}
