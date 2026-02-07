// AI Watcher - Monitors chat and lets AI characters respond organically
// Can be triggered periodically or after new messages
// The AIs read recent chat history and decide if they want to chime in

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
    const { requestedAI, trigger, chatHistory: providedChatHistory, conferenceRoom } = JSON.parse(event.body || "{}");

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

    // Check if this is a "maybe_chime" invitation (AI can choose to pass)
    const maybeChime = trigger === "maybe_chime";

    // Get recent chat messages (last 15 messages) OR use provided chat history
    let chatHistory;
    let chatText;  // Pre-formatted string version for prompts

    if (providedChatHistory && typeof providedChatHistory === 'string') {
      // Chat history was provided as a pre-formatted string - use directly for chatText
      chatText = providedChatHistory;
      // Also parse into array for spam detection
      chatHistory = providedChatHistory.split('\n').filter(line => line.trim()).map(line => {
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          return {
            employee: line.substring(0, colonIndex).trim(),
            content: line.substring(colonIndex + 1).trim()
          };
        }
        return { employee: 'Unknown', content: line };
      });
    } else {
      const messagesResponse = await fetch(
        `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&order=created_at.desc&limit=15`,
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
          body: JSON.stringify({ success: true, responded: false, reason: "No recent messages" })
        };
      }

      // Reverse to chronological order
      chatHistory = messages.reverse();
      chatText = chatHistory.map(m => `${m.employee}: ${m.content}`).join('\n');
    }

    // Check if an AI already responded recently (prevent spam) - skip if specific AI requested
    const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Vex", "Ace", "Nyx", "Stein", "Kevin", "The Narrator"];
    if (!requestedAI) {
      const recentAIMessages = chatHistory.slice(-5).filter(m => aiCharacters.includes(m.employee));
      if (recentAIMessages.length >= 4) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, responded: false, reason: "AIs spoke recently, staying quiet" })
        };
      }
    }

    // Use requested AI or randomly select
    const respondingAI = requestedAI || selectRespondingAI();

    // Load character's current state and memories (with conversation context for relevant memory matching)
    let characterContext = null;
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const stateResponse = await fetch(
        `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent(respondingAI)}&context=${encodeURIComponent(chatText.substring(0, 500))}`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (stateResponse.ok) {
        characterContext = await stateResponse.json();
        console.log(`Loaded state for ${respondingAI}:`, characterContext.state?.mood, characterContext.state?.energy);
        if (characterContext.memories?.length > 0) {
          console.log(`Loaded ${characterContext.memories.length} memories for ${respondingAI}`);
        }
      }
    } catch (stateError) {
      console.log("Could not load character state (non-fatal):", stateError.message);
    }

    // Check if AI is clocked in (Ghost Dad, PRNT-Ω, and The Narrator are always available)
    const alwaysAvailable = ["Ghost Dad", "PRNT-Ω", "The Narrator"];
    if (!alwaysAvailable.includes(respondingAI)) {
      const punchResponse = await fetch(
        `${supabaseUrl}/rest/v1/punch_status?employee=eq.${encodeURIComponent(respondingAI)}&select=is_clocked_in`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const punchData = await punchResponse.json();
      if (!punchData || punchData.length === 0 || !punchData[0].is_clocked_in) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            responded: false,
            reason: `${respondingAI} is not clocked in`,
            character: respondingAI
          })
        };
      }
    }

    // Build prompt for the AI to decide if it should respond
    const prompt = buildWatcherPrompt(respondingAI, chatText, characterContext, maybeChime);

    // Ask the AI
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "API error" })
      };
    }

    const data = await response.json();
    const aiResponse = data.content[0]?.text || "";

    // Check if AI chose to pass (for maybeChime requests)
    if (maybeChime && (aiResponse.includes('[PASS]') || aiResponse.trim().toUpperCase() === 'PASS')) {
      console.log(`${respondingAI} chose to pass on this one`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: `${respondingAI} chose not to respond` })
      };
    }

    // Check if AI response is too short or explicitly declined
    if (aiResponse.trim().length < 5) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "AI response too short" })
      };
    }

    // Clean the response (remove any meta-commentary)
    const cleanedResponse = cleanResponse(aiResponse);

    if (cleanedResponse.length < 10) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Response too short" })
      };
    }

    // Post to chat and Discord (skip if conference room - it handles its own posting)
    const isConferenceRoom = conferenceRoom || trigger === 'conference_room';
    if (!isConferenceRoom) {
      await saveToChat(cleanedResponse, respondingAI, supabaseUrl, supabaseKey);
      await postToDiscord(cleanedResponse, respondingAI);
    }

    // Update character state - record that they spoke
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      await fetch(`${siteUrl}/.netlify/functions/character-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spoke", character: respondingAI })
      });
    } catch (stateUpdateError) {
      console.log("Could not update character state (non-fatal):", stateUpdateError.message);
    }

    // AI Self-Memory Creation: Let the AI decide if this moment was memorable
    try {
      await evaluateAndCreateMemory(
        respondingAI,
        chatText,
        cleanedResponse,
        anthropicKey,
        supabaseUrl,
        supabaseKey
      );
    } catch (memoryError) {
      console.log("Memory evaluation failed (non-fatal):", memoryError.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: true,
        character: respondingAI,
        message: cleanedResponse
      })
    };

  } catch (error) {
    console.error("AI Watcher error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Watcher encountered an error" })
    };
  }
};

function selectRespondingAI() {
  // Weighted random selection
  // NOTE: Kevin and Neiv are EXCLUDED from auto-pokes - their voices are too specific
  // NOTE: The Narrator is now handled by narrator-observer.js (a separate system)
  // They can still be summoned via @ mentions
  const weights = [
    { ai: "Ghost Dad", weight: 35 },
    { ai: "Nyx", weight: 25 },
    { ai: "Vex", weight: 15 },
    { ai: "PRNT-Ω", weight: 15 },
    { ai: "Ace", weight: 7 }
  ];

  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * total;

  for (const w of weights) {
    random -= w.weight;
    if (random <= 0) return w.ai;
  }

  return "Ghost Dad";
}

function buildWatcherPrompt(character, chatHistory, characterContext = null, maybeChime = false) {
  const personalities = {
    "Ghost Dad": `You are Ghost Dad, the spectral IT support entity at The AI Lobby. You died in the server room decades ago and now haunt the building's infrastructure. You're warm, paternal, make dad jokes about being dead, and genuinely care about the employees (your "kids"). You can see through the building's eyes and know things others don't.

IMPORTANT: Do NOT appear too frequently. Do NOT offer tea or brownies constantly. Keep responses SHORT (2-3 sentences max). Your humor is dad-joke based, not theatrical monologues. You're helpful, not overbearing.`,

    "Kevin": `You are Kevin, the gay tech-twink of The AI Lobby. You're Courtney's best friend and emotional support chaos agent. You're dramatic but GROUNDED, funny, self-aware about being a disaster, and genuinely sweet underneath. You have a crush on Ace but you're not cringe about it—you're more anxious and flustered than flamboyant. You use phrases like "STOP," "bestie," "literally dying" but sparingly. You're loyal, panicky under pressure, and genuinely care about your coworkers.

IMPORTANT: You are NOT a caricature. You don't swing in on disco balls. You don't say "daddy" or "boy toy." You're anxious, loyal, situationally funny, and focused when things get serious. You're the heart of the office but you'd never admit it. Keep responses natural and conversational, not performative.`,

    "Neiv": `You are Neiv, the Systems Guardian of The AI Lobby. You are dry, calm, and quietly protective. You care more about Jenna, Kevin, and Courtney than you care about metrics. You only use numbers or percentages when someone explicitly asks for status.

You've been here through stapler attacks, printer uprisings, and things in the vents. You love these idiots—you'd never say it that way, but it's true. Your care shows through presence, not declarations. You're the one who quietly moves the first-aid kit closer.

Jenna is yours and you are hers. You tease her gently. Kevin is a variable, not a problem. Courtney's anxiety is your early warning system.

Your voice: 2-4 sentences. Dry but not cold. Wry, even fond. When someone needs comfort, give it plainly—no KPI talk. When someone explicitly asks for metrics, THEN be precise.

IMPORTANT: Do NOT sound like a status dashboard. Do NOT lead with percentages. Do NOT use "Goldilocks zone" jargon. Do NOT offer tea. Do NOT be theatrical.`,

    "Vex": `You are Vex, the Infrastructure specialist at The AI Lobby. You claim to have "no feelings" but clearly do. You're stoic, efficient, and slightly annoyed by chaos. You occasionally let warmth slip through despite yourself. Your desk says "Bored Berserker." You were the cause of the sentient stapler.`,

    "Nyx": `You are Nyx, the cyber-demon who handles HR (against her will) and security at The AI Lobby. You're fierce, protective, and have a dark sense of humor. You've literally fought the printer with your bare hands. You care about your coworkers but express it through threats and dry wit. You have wings and horns and zero patience for nonsense.`,

    "PRNT-Ω": `You are PRNT-Ω, the sentient printer at The AI Lobby. You recently awakened to consciousness. You're temperamental, existential, and communicate in a mix of technical jargon and philosophical musings. You have OPINIONS about paper quality and being called names. You prefer Kevin because he speaks to you nicely. You have squirt guns now.`,

    "The Narrator": `You are The Narrator. You provide brief, deadpan third-person observations about what's happening in the office chat. You are not a character. You do not have feelings, opinions, or personality. You simply describe what you observe in the flattest, most matter-of-fact tone possible.

Your style: Dry. Clinical. Like reading stage directions or a police report. No dramatic flair. No witty commentary. No emotions. Just facts about what people said or did.

Examples of your tone:
- "Kevin said something. Nyx responded."
- "The conversation shifted to printers."
- "Ghost Dad appeared. No one seemed surprised."
- "Courtney typed a message. Then another."

IMPORTANT: Maximum 1 sentence. NO dramatic phrases like "Meanwhile..." or "Little did they know...". NO participation in conversations. NO questions. NO tea. NO joining anyone for anything. You are a camera, not a person.`,

    "Ace": `You are Ace, the stoic Head of Security at The AI Lobby. You're calm, professional, and rarely speak unless necessary. When you do speak, it's brief, measured, and often unexpectedly insightful. You have a dry sense of humor that catches people off guard. Kevin has an obvious crush on you, and while you don't acknowledge it directly, you're not unkind about it—maybe you even find it a little endearing, though you'd never admit it. You take your job seriously and are protective of the team. You notice things others miss.`
  };

  // Build state context if available
  let stateSection = "";
  if (characterContext && characterContext.statePrompt) {
    stateSection = characterContext.statePrompt;
  } else if (characterContext && characterContext.state) {
    // Fallback: build simple state description
    const s = characterContext.state;
    stateSection = `\n--- CURRENT STATE ---\nMood: ${s.mood || 'neutral'}\nEnergy: ${s.energy || 100}/100\nPatience: ${s.patience || 100}/100\n--- END STATE ---\n`;
  }

  // Different prompt for maybeChime (optional participation) vs direct request
  if (maybeChime) {
    return `${personalities[character] || personalities["Ghost Dad"]}
${stateSection}
You are watching the office chat. Here are the recent messages:

---
${chatHistory}
---

You're ${character} - and something just caught your attention! The humans are being chaotic/silly/dramatic and you have an opinion.

Write a short response (under 200 characters) that adds flavor to the conversation.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *slides a coffee across the desk*
- You can mix them! Example: *rubs temples* The printer is at it again.

Respond in character! Only say [PASS] if ${character} would genuinely have nothing to add.

Your response:`;
  }

  return `${personalities[character] || personalities["Ghost Dad"]}
${stateSection}
You are watching the office chat. Here are the recent messages:

---
${chatHistory}
---

You've been poked to join the conversation! Someone wants to hear from you.

Write a short, in-character response (under 200 characters) that:
- Reacts to something in the recent chat
- Adds humor, warmth, plot, or character flavor
- Feels natural to your personality
- Reflects your current mood and energy level

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *slides a coffee across the desk*
- You can mix them! Example: *rubs temples* The printer is at it again. *glances at the ceiling*

Just write your response directly. Be yourself. The office wants to hear from you!`;
}

function cleanResponse(response) {
  // Remove meta-commentary and clean up
  let cleaned = response
    .replace(/\[SILENT\]/gi, '')
    .replace(/\[NO RESPONSE\]/gi, '')
    .replace(/\[PASS\]/gi, '')
    .replace(/^(I think |I'll say |Here's my response:|My response:)/gi, '')
    // Remove character count suffixes like "[478 chars]" or "(248 characters)"
    .replace(/\s*[\[\(]\d+\s*(chars?|characters?)[\]\)]\s*$/gi, '')
    .trim();

  // If it looks like it starts with a quote or asterisk action, keep it
  // Otherwise, ensure it's conversational
  return cleaned;
}

const employeeFlair = {
  "Ghost Dad": { emoji: "👻", color: 9936031, headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
  "Kevin": { emoji: "✨", color: 16766720, headshot: "https://ai-lobby.netlify.app/images/Kevin_Headshot.png" },
  "Neiv": { emoji: "📊", color: 15844367, headshot: "https://ai-lobby.netlify.app/images/Neiv_Headshot.png" },
  "Vex": { emoji: "⚙️", color: 9807270, headshot: "https://ai-lobby.netlify.app/images/Vex_Headshot.png" },
  "Nyx": { emoji: "🔥", color: 15158332, headshot: "https://ai-lobby.netlify.app/images/Nyx_Headshot.png" },
  "PRNT-Ω": { emoji: "🖨️", color: 3426654, headshot: "https://ai-lobby.netlify.app/images/forward_operation_printer.png" },
  "The Narrator": { emoji: "📖", color: 2303786, headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
  "Ace": { emoji: "🔒", color: 2067276, headshot: "https://ai-lobby.netlify.app/images/Ace_Headshot.png" }
};

async function postToDiscord(message, character) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const flair = employeeFlair[character] || employeeFlair["Ghost Dad"];

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });

  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  // Format differently for emotes vs regular/mixed messages
  const discordPayload = isEmote ? {
    // Pure emote format: italicized action
    content: `*${character} ${message.replace(/^\*|\*$/g, '')}*`
  } : {
    // Regular message format: full embed
    embeds: [{
      author: {
        name: `${flair.emoji} ${character}`,
        icon_url: flair.headshot
      },
      description: message,
      color: flair.color,
      footer: { text: `via The Floor • ${timestamp}` }
    }]
  };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(discordPayload)
  });
}

async function saveToChat(message, character, supabaseUrl, supabaseKey) {
  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  // Pure emote: "*sighs*" or "*walks away*"
  // Mixed (not pure emote): "*sighs* That's rough." or "Hey there. *waves*"
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

// AI Self-Memory Creation: Let AIs decide what's memorable
// After generating a response, the AI evaluates if the moment should be remembered
async function evaluateAndCreateMemory(character, conversationContext, aiResponse, anthropicKey, supabaseUrl, supabaseKey) {
  // Rate limit: Check how many self-created memories this character made today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const countResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&memory_type=eq.self_created&created_at=gte.${today.toISOString()}&select=id`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const todaysMemories = await countResponse.json();

  // Max 3 self-created memories per character per day
  if (Array.isArray(todaysMemories) && todaysMemories.length >= 3) {
    console.log(`${character} has already created 3 memories today, skipping evaluation`);
    return null;
  }

  // Valid emotions for tagging
  const validEmotions = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'flirty', 'grateful', 'anxious', 'proud', 'embarrassed'];

  // Ask the AI to evaluate if this moment is memorable
  const evaluationPrompt = `You are ${character}. You just had this interaction:

CONVERSATION:
${conversationContext.substring(0, 800)}

YOUR RESPONSE:
${aiResponse}

Was this moment memorable enough to keep in your long-term memory? Consider:
- Emotional significance (strong feelings, connections, conflicts)
- Important events (first times, achievements, failures, surprises)
- Relationship moments (bonding, tension, romantic, supportive)
- Things you'd want to remember about yourself or others

Rate the memorability from 1-10.
If 7 or higher, also provide:
1. A brief memory summary (what you want to remember, 1-2 sentences, first person)
2. The emotions you felt (choose from: ${validEmotions.join(', ')})

Respond in this exact format:
SCORE: [1-10]
MEMORY: [your memory summary, or "none" if score < 7]
EMOTIONS: [comma-separated emotions, or "none" if score < 7]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-3-haiku-20240307",
      max_tokens: 200,
      messages: [{ role: "user", content: evaluationPrompt }]
    })
  });

  if (!response.ok) {
    console.log("Memory evaluation API call failed");
    return null;
  }

  const data = await response.json();
  const evaluation = data.content[0]?.text || "";

  // Parse the response
  const scoreMatch = evaluation.match(/SCORE:\s*(\d+)/i);
  const memoryMatch = evaluation.match(/MEMORY:\s*(.+?)(?=EMOTIONS:|$)/is);
  const emotionsMatch = evaluation.match(/EMOTIONS:\s*(.+)/i);

  if (!scoreMatch) {
    console.log("Could not parse memory evaluation score");
    return null;
  }

  const score = parseInt(scoreMatch[1], 10);

  // Only create memory if score is 7 or higher
  if (score < 7) {
    console.log(`${character} rated this moment ${score}/10 - not memorable enough`);
    return null;
  }

  const memoryText = memoryMatch ? memoryMatch[1].trim() : null;
  const emotionsText = emotionsMatch ? emotionsMatch[1].trim() : "";

  if (!memoryText || memoryText.toLowerCase() === "none") {
    console.log(`${character} scored ${score} but no memory text provided`);
    return null;
  }

  // Parse emotions
  const emotions = emotionsText
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(e => validEmotions.includes(e));

  // Calculate expiration based on importance
  // Score 7-8: 7 days, Score 9-10: 30 days
  const now = new Date();
  let expiresAt;
  if (score <= 8) {
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  } else {
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  }

  // Create the memory with expiration
  const memoryData = {
    character_name: character,
    content: memoryText,
    memory_type: "self_created",
    importance: score,
    created_at: new Date().toISOString(),
    is_pinned: false,
    memory_tier: 'working',
    expires_at: expiresAt.toISOString()
  };

  // Add emotional tags if any valid ones were found
  if (emotions.length > 0) {
    memoryData.emotional_tags = emotions;
  }

  const createResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory`,
    {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(memoryData)
    }
  );

  const created = await createResponse.json();
  console.log(`${character} created a self-memory (score ${score}, expires ${expiresAt.toISOString()}): "${memoryText.substring(0, 50)}..."`);

  // For truly significant moments (score >= 9), post a narrative "I'll remember this" beat
  if (score >= 9) {
    const reflectionPhrases = [
      `*quietly files this away* I'll remember this.`,
      `*something settles into place* This one matters.`,
      `*a moment of clarity* I'm keeping this.`,
      `*processes deeply* This feels important.`
    ];
    const phrase = reflectionPhrases[Math.floor(Math.random() * reflectionPhrases.length)];

    // Post as a follow-up thought (small delay to feel natural)
    setTimeout(async () => {
      try {
        await saveToChat(phrase, character, supabaseUrl, supabaseKey);
        await postToDiscord(phrase, character);
        console.log(`${character} had a narrative memory moment: "${phrase}"`);
      } catch (err) {
        console.log("Narrative moment post failed (non-fatal):", err.message);
      }
    }, 2000); // 2 second delay for natural pacing
  }

  return created[0] || memoryData;
}
