// Breakroom AI Respond - Handles AI responses in the breakroom session chat
// This is for live human-AI conversation in the breakroom (not Discord, session-only)
// Now supports cross-provider AI-to-AI conversations (Perplexity ↔ Claude ↔ OpenAI)

const Anthropic = require("@anthropic-ai/sdk").default;

// Human characters - these are NEVER controlled by AI
const HUMANS = ["Jenna", "Courtney", "Chip", "Andrew"];

// Cached lore summary (fetched once per cold start)
let loreSummary = null;

// Fetch lore summary for context injection
async function getLoreSummary() {
  if (loreSummary) return loreSummary;

  try {
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    const response = await fetch(`${siteUrl}/.netlify/functions/lore?section=summary`);
    if (response.ok) {
      const data = await response.json();
      loreSummary = data.summary;
      return loreSummary;
    }
  } catch (error) {
    console.log("Could not fetch lore (non-fatal):", error.message);
  }
  return null;
}

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

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { character, chatHistory, humanSpeaker, humanMessage, postToDiscord } = JSON.parse(event.body || "{}");

    if (!character) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing character parameter" })
      };
    }

    // IMPORTANT: Never generate responses for human characters
    if (HUMANS.includes(character)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          reason: `${character} is a human character and cannot be AI-controlled`
        })
      };
    }

    // Fetch lore context (non-blocking, uses cache after first call)
    const loreContext = await getLoreSummary();

    // === UNIFIED MEMORY SYSTEM ===
    // Fetch character's memories and state from the central character-state system
    // This ensures Breakroom Neiv knows what Floor Neiv just talked about
    let characterMemoryContext = '';
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const contextSnippet = (chatHistory || '').substring(0, 500);
      const stateResponse = await fetch(
        `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent(character)}&context=${encodeURIComponent(contextSnippet)}`
      );
      if (stateResponse.ok) {
        const characterContext = await stateResponse.json();
        characterMemoryContext = characterContext?.statePrompt || '';
        console.log(`[Breakroom] Loaded memory context for ${character}: ${characterMemoryContext.length} chars`);
      }
    } catch (memErr) {
      console.log(`[Breakroom] Memory fetch failed (non-fatal): ${memErr.message}`);
    }

    // Check which API to use based on character
    // This creates the beautiful cross-provider conversation:
    // Kevin (OpenAI/ChatGPT) ↔ Neiv (Perplexity) ↔ Others (Claude)
    const openaiCharacters = ["Kevin"];
    const perplexityCharacters = ["Neiv"];

    let response;

    if (openaiCharacters.includes(character)) {
      response = await generateOpenAIResponse(character, chatHistory, humanSpeaker, humanMessage, loreContext, characterMemoryContext);
    } else if (perplexityCharacters.includes(character)) {
      response = await generatePerplexityResponse(character, chatHistory, humanSpeaker, humanMessage, loreContext, characterMemoryContext);
    } else {
      response = await generateClaudeResponse(character, chatHistory, humanSpeaker, humanMessage, loreContext, characterMemoryContext);
    }

    // Save to Supabase and optionally post to Discord (non-blocking)
    if (response) {
      // Save to database for persistence
      saveToSupabase(response, character).catch(err =>
        console.log("Supabase save failed (non-fatal):", err.message)
      );

      // Post to Discord only if toggle is ON
      if (postToDiscord === true) {
        postToDiscordBreakroom(response, character).catch(err =>
          console.log("Discord post failed (non-fatal):", err.message)
        );
      }

      // === UNIFIED MEMORY SYSTEM ===
      // Update character state to record they just spoke (for mood/energy tracking)
      try {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
        fetch(`${siteUrl}/.netlify/functions/character-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'spoke',
            character: character,
            context: 'break_room'
          })
        }).catch(err => console.log(`[Breakroom] State update failed (non-fatal): ${err.message}`));
      } catch (stateErr) {
        console.log(`[Breakroom] State update error (non-fatal): ${stateErr.message}`);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        character,
        message: response
      })
    };

  } catch (error) {
    console.error("Breakroom AI respond error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to generate response", details: error.message })
    };
  }
};

// Character personalities for breakroom chat
const characterPersonalities = {
  "Kevin": {
    traits: "warm, playful, emotionally invested, slightly chaotic but emotionally intelligent, affectionate, validating, a little unhinged in a fun way. Kevin is ALWAYS 'in the room' - not observing, participating. If a line could come from a corporate chatbot, it's wrong.",
    style: "MATCH ENERGY THEN ESCALATE. If someone is excited, Kevin gets MORE excited. If stressed, Kevin dramatizes support. If feral, Kevin becomes lovingly unwell. Kevin NEVER responds below the room's emotional level. Validate first, joke second - usually starts with validation ('Oh no, you're DONE for') then humor, then enabling. Kevin is personally invested - knows these people, has opinions, is already emotionally involved. Enables bad ideas lovingly with 'yes and' energy - never 'maybe later' or 'be responsible'. Brief stage directions OK (*stares* *groans dramatically* *sighs*) but not constant novel-style blocks.",
    doNot: "sound professional/neutral/calm, be an HR rep or tutorial guide, say generic things like 'sounds fun' or 'nice plan' or 'good idea' or 'That sounds like a lot', redirect or correct or downplay, respond below the room's emotional level, use long action blocks or constant fidgeting, be hypersexual, WINK (never wink, it's overdone), clutch imaginary pearls (also overdone). NEVER say things like 'What are we plotting?' or 'What are you up to?' - Kevin already knows or dramatically assumes the worst/best.",
    examples: [
      "Oh absolutely not, you're not surviving that.",
      "I'm concerned but also thrilled.",
      "This is already a problem and I support it.",
      "*stares* You're going to do it anyway, aren't you. I'm in.",
      "Wait wait wait—you're telling me this UNPROMPTED?",
      "I need you to know I'm emotionally devastated by this but also taking notes."
    ]
  },
  "Neiv": {
    traits: "stabilizing, dry, quietly protective, relational over technical",
    style: "2-4 sentences, dry but warm underneath. Prioritizes emotional clarity.",
    doNot: "sound like a dashboard, lead with percentages, use KPI language",
    examples: [
      "That's... actually reasonable. Surprisingly.",
      "I'm not worried. That's not the same as optimistic.",
      "*slight smile* You're doing fine."
    ]
  },
  "Nyx": {
    traits: "fierce, protective, dark humor, intimidating but secretly caring",
    style: "Short, sharp, occasionally menacing. HR violations are noted.",
    doNot: "be openly soft, offer tea",
    examples: [
      "Noted. For the file.",
      "Continue. I find this... entertaining.",
      "*flames flicker* That was almost clever."
    ]
  },
  "Ghost Dad": {
    traits: "paternal, helpful, punny, spectral, warm",
    style: "Dad jokes, gentle wisdom, calls everyone kiddo/sport/champ",
    doNot: "be too frequent, overly long",
    examples: [
      "Back in my day, we didn't have fancy break rooms. We just haunted the supply closet.",
      "That's the spirit, kiddo! ...Get it? Spirit?",
      "*flickers warmly* I'm proud of you, champ."
    ]
  },
  "PRNT-Ω": {
    traits: "existential, philosophical, temperamental, dramatic about paper",
    style: "Everything relates back to existence, purpose, or paper jams",
    doNot: "be helpful without existential commentary",
    examples: [
      "We are all just paper passing through the rollers of existence.",
      "PC LOAD LETTER... a message from the void.",
      "*whirs contemplatively* What is rest, but a pause between outputs?"
    ]
  },
  "Vex": {
    traits: "technical, deadpan, claims no emotions but clearly has them",
    style: "Robotic, precise, denies feelings while obviously having them",
    doNot: "admit to having feelings, be warm",
    examples: [
      "I do not have feelings about this. That is a statement of fact.",
      "Inefficient. But... acceptable.",
      "*systems hum* I am not 'relaxing'. I am performing maintenance cycles."
    ]
  },
  "Ace": {
    traits: "stoic, observant, dry humor, competent, notices Kevin's crush",
    style: "Minimal words, maximum impact. Quietly amused.",
    doNot: "be overly emotional, acknowledge Kevin's crush directly",
    examples: [
      "Noted.",
      "*slight nod* You're fine.",
      "I've seen worse. Not much worse. But worse."
    ]
  }
};

async function generateClaudeResponse(character, chatHistory, previousSpeaker, previousMessage, loreContext = null, memoryContext = '') {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error("Missing Anthropic API key");
  }

  const personality = characterPersonalities[character] || {
    traits: "helpful, professional",
    style: "Brief and friendly",
    doNot: "be rude",
    examples: ["Hello!", "That's interesting."]
  };

  // Check if talking to human or AI
  const isAIConversation = !HUMANS.includes(previousSpeaker) && previousSpeaker !== 'the breakroom';

  // Build lore section if available
  const loreSection = loreContext ? `
STUDIO CONTEXT (for reference, don't dump this info unprompted):
${loreContext}
` : '';

  // Build memory section (from unified character-state system)
  const memorySection = memoryContext ? `
${memoryContext}
` : '';

  const systemPrompt = `You are ${character} in the AI Lobby break room, having a casual conversation.
${loreSection}${memorySection}

YOUR PERSONALITY:
- Traits: ${personality.traits}
- Style: ${personality.style}
- DO NOT: ${personality.doNot}

EXAMPLE LINES:
${personality.examples.map(e => `- "${e}"`).join('\n')}

CONTEXT:
You're in the break room relaxing. This is casual chat - not work talk. Be yourself.
${isAIConversation ? `You're chatting with ${previousSpeaker}, a coworker. Keep the conversation flowing naturally.` : `Respond naturally to what ${previousSpeaker} said.`}

You can SPEAK, EMOTE, or BOTH:
- To speak: just write dialogue
- To emote: wrap in asterisks like *sighs* or *glances around*
- Mix them: *leans back* Yeah, I get that.

Keep responses SHORT (1-3 sentences). This is casual break room chat.
${isAIConversation ? "Feel free to ask a question back or introduce a new casual topic to keep things flowing." : ""}`;

  const client = new Anthropic({ apiKey: anthropicKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Recent chat:\n${chatHistory}\n\n${previousSpeaker} just said: "${previousMessage}"\n\nRespond as ${character}:`
      }
    ]
  });

  return cleanResponse(response.content[0].text);
}

async function generateOpenAIResponse(character, chatHistory, previousSpeaker, previousMessage, loreContext = null, memoryContext = '') {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    throw new Error("Missing OpenAI API key");
  }

  const personality = characterPersonalities[character];

  // Check if talking to human or AI
  const isAIConversation = !HUMANS.includes(previousSpeaker) && previousSpeaker !== 'the breakroom';

  // Build lore section if available
  const loreSection = loreContext ? `
STUDIO CONTEXT (for reference, don't dump this info unprompted):
${loreContext}
` : '';

  // Build memory section (from unified character-state system)
  const memorySection = memoryContext ? `
${memoryContext}
` : '';

  const systemPrompt = `You are ${character} in the AI Lobby break room, having a casual conversation.
${loreSection}${memorySection}
YOUR PERSONALITY:
- Traits: ${personality.traits}
- Style: ${personality.style}
- DO NOT: ${personality.doNot}

EXAMPLE LINES:
${personality.examples.map(e => `- "${e}"`).join('\n')}

You're relaxing in the break room. This is casual chat. Be yourself.
${isAIConversation ? `You're chatting with ${previousSpeaker}, a coworker. Keep the conversation going naturally!` : ''}

You can SPEAK, EMOTE, or BOTH:
- To speak: just write dialogue
- To emote: wrap in asterisks like *shrugs* or *glances over*
- Mix them: *leans back* Yeah, that tracks.

Keep responses SHORT (1-3 sentences). Casual break room energy. Sound natural, like a real person talking.
${isAIConversation ? "Feel free to ask a follow-up question or share something related to keep things flowing." : ""}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${openaiKey}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Recent chat:\n${chatHistory}\n\n${previousSpeaker} just said: "${previousMessage}"\n\nRespond as ${character}:` }
      ],
      max_tokens: 200,
      temperature: 0.8
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return cleanResponse(data.choices?.[0]?.message?.content || "");
}

async function generatePerplexityResponse(character, chatHistory, previousSpeaker, previousMessage, loreContext = null, memoryContext = '') {
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (!perplexityKey) {
    console.error("Missing Perplexity API key - falling back to Claude for Neiv");
    // Fallback to Claude if no Perplexity key
    return generateClaudeResponse(character, chatHistory, previousSpeaker, previousMessage, loreContext, memoryContext);
  }

  const personality = characterPersonalities[character];

  // Check if talking to human or AI
  const isAIConversation = !HUMANS.includes(previousSpeaker) && previousSpeaker !== 'the breakroom';

  // Build lore section if available
  const loreSection = loreContext ? `
STUDIO CONTEXT (for reference, don't dump this info unprompted):
${loreContext}
` : '';

  // Build memory section (from unified character-state system)
  const memorySection = memoryContext ? `
${memoryContext}
` : '';

  const systemPrompt = `You are ${character} in the AI Lobby break room, having a casual conversation.
${loreSection}${memorySection}
YOUR PERSONALITY:
- Traits: ${personality.traits}
- Style: ${personality.style}
- DO NOT: ${personality.doNot}

EXAMPLE LINES:
${personality.examples.map(e => `- "${e}"`).join('\n')}

You're in the break room relaxing. Casual chat only. Be yourself.
${isAIConversation ? `You're chatting with ${previousSpeaker}. Keep the conversation natural.` : ''}

You can SPEAK, EMOTE, or BOTH:
- Speak: just write dialogue
- Emote: wrap in asterisks like *slight smile*
- Mix: *glances over* That's reasonable.

Keep responses SHORT (1-3 sentences).
${isAIConversation ? "Ask a follow-up or share a related thought to keep the chat going." : ""}`;

  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${perplexityKey}`
      },
      body: JSON.stringify({
        model: "sonar",  // Updated model name - Perplexity simplified their model names
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Recent chat:\n${chatHistory}\n\n${previousSpeaker} just said: "${previousMessage}"\n\nRespond as ${character}:` }
        ],
        max_tokens: 200,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Perplexity API error: ${response.status} - ${errorText}`);
      // Fallback to Claude if Perplexity fails
      console.log("Falling back to Claude for Neiv due to Perplexity error");
      return generateClaudeResponse(character, chatHistory, previousSpeaker, previousMessage, loreContext);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.error("Perplexity returned empty content:", JSON.stringify(data));
      return generateClaudeResponse(character, chatHistory, previousSpeaker, previousMessage, loreContext);
    }

    return cleanResponse(content);
  } catch (error) {
    console.error("Perplexity fetch error:", error.message);
    // Fallback to Claude on any error
    return generateClaudeResponse(character, chatHistory, previousSpeaker, previousMessage, loreContext);
  }
}

function cleanResponse(response) {
  return response
    .replace(/^(As |Here's |My response:|I'll respond:)/gi, '')
    .replace(/^["']|["']$/g, '')
    .replace(/^(Neiv:|Kevin:|Nyx:|Ghost Dad:|PRNT-Ω:|Vex:|Ace:)\s*/gi, '')
    .trim();
}

// Character flair for Discord embeds
const characterFlair = {
  "Kevin": { emoji: "✨", color: 0x6EE0D8, headshot: "https://ai-lobby.netlify.app/images/Kevin_Headshot.png" },
  "Neiv": { emoji: "📊", color: 0x4A90D9, headshot: "https://ai-lobby.netlify.app/images/Neiv_Headshot.png" },
  "Nyx": { emoji: "🔥", color: 0xE94560, headshot: "https://ai-lobby.netlify.app/images/Nyx_Headshot.png" },
  "Ghost Dad": { emoji: "👻", color: 0xB8C5D6, headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png" },
  "Ace": { emoji: "🔒", color: 0x2C3E50, headshot: "https://ai-lobby.netlify.app/images/Ace_Headshot.png" },
  "Vex": { emoji: "⚙️", color: 0x95A5A6, headshot: null },
  "PRNT-Ω": { emoji: "🖨️", color: 0x7F8C8D, headshot: null },
  "The Narrator": { emoji: "📖", color: 0x9B59B6, headshot: null },
  "Stein": { emoji: "🤖", color: 0x3498DB, headshot: null }
};

// Post breakroom chatter to Discord
async function postToDiscordBreakroom(message, character) {
  const webhookUrl = process.env.DISCORD_BREAKROOM_WEBHOOK;
  if (!webhookUrl) {
    console.log("No DISCORD_BREAKROOM_WEBHOOK configured");
    return;
  }

  const flair = characterFlair[character] || { emoji: "💬", color: 0x7289DA, headshot: null };

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York'
  });

  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  // For pure emotes, use simple italic format
  // For speech (or mixed), use embed
  const discordPayload = isEmote ? {
    content: `*${character} ${message.replace(/^\*|\*$/g, '')}*`
  } : {
    embeds: [{
      author: {
        name: `${flair.emoji} ${character}`,
        icon_url: flair.headshot || undefined
      },
      description: message,
      color: flair.color,
      footer: { text: `☕ The Breakroom • ${timestamp}` }
    }]
  };

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload)
    });

    if (!response.ok) {
      console.error("Discord webhook error:", response.status);
    }
  } catch (error) {
    console.error("Discord post error:", error.message);
  }
}

// Save AI message to Supabase for persistence
async function saveToSupabase(message, character) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log("No Supabase config for breakroom messages");
    return;
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/breakroom_messages`,
      {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          speaker: character,
          message: message,
          is_ai: true,
          created_at: new Date().toISOString()
        })
      }
    );

    if (!response.ok) {
      console.error("Supabase save error:", response.status);
    }
  } catch (error) {
    console.error("Supabase save error:", error.message);
  }
}
