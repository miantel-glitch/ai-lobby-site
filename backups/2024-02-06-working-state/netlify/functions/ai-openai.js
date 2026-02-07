// AI OpenAI - Routes specific characters to OpenAI/ChatGPT API for authentic responses
// Currently handles: Kevin (via ChatGPT)

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
    console.log("ai-openai received body:", event.body);
    const { character, chatHistory, maybeRespond, conferenceRoom } = JSON.parse(event.body || "{}");

    const openaiKey = process.env.OPENAI_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!openaiKey || !supabaseUrl || !supabaseKey) {
      console.log("Missing config - openaiKey:", !!openaiKey, "supabaseUrl:", !!supabaseUrl, "supabaseKey:", !!supabaseKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          reason: "Missing configuration",
          debug: {
            hasOpenAI: !!openaiKey,
            hasSupabaseUrl: !!supabaseUrl,
            hasSupabaseKey: !!supabaseKey
          }
        })
      };
    }

    console.log("AI OpenAI called for character:", character, maybeRespond ? "(optional chime-in)" : "(direct request)");

    // Load character's current state and memories
    let characterContext = null;
    let stateSection = "";
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const contextSnippet = chatHistory ? chatHistory.substring(0, 500) : "";
      const stateResponse = await fetch(
        `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent(character)}&context=${encodeURIComponent(contextSnippet)}`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (stateResponse.ok) {
        characterContext = await stateResponse.json();
        console.log(`Loaded state for ${character}:`, characterContext.state?.mood, characterContext.state?.energy);
        if (characterContext.statePrompt) {
          stateSection = characterContext.statePrompt;
        }
      }
    } catch (stateError) {
      console.log("Could not load character state (non-fatal):", stateError.message);
    }

    // Get the system prompt for the character
    const basePrompt = getOpenAIPrompt(character);
    if (!basePrompt) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: `No OpenAI prompt for ${character}` })
      };
    }

    // Combine base prompt with dynamic state
    const systemPrompt = basePrompt + stateSection;

    // Build the user message with chat context
    // If maybeRespond is true, give the AI the option to stay silent
    const userMessage = maybeRespond
      ? `Here is the recent office chat. You're ${character} - and the humans are being RIDICULOUS and you have FEELINGS about it!

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *fidgets nervously*
- You can mix them! Example: *tugs at sleeve* Okay—okay—this is fine. Probably.

Kevin would DEFINITELY have something to say about this chaos. Match their energy! Escalate! Be emotionally invested!

Respond in character with a short message (1-3 sentences). Only say [PASS] if Kevin would genuinely be speechless (rare).

---
${chatHistory}
---

Your response:`
      : `Here is the recent office chat. Respond in character as ${character}. Use as much or as little space as feels natural for the moment. Just write your response directly - no meta-commentary, no character counts, no explanations.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *fidgets nervously* or *glances at Ace and immediately looks away*
- You can mix them! Example: *tugs at sleeve* Okay—okay—this is fine. Probably.

---
${chatHistory}
---

Respond:`;

    // Call OpenAI API
    console.log("Calling OpenAI API...");
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
          { role: "user", content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.8
      })
    });
    console.log("OpenAI response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API error:", response.status, errorText);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: `OpenAI API error: ${response.status}` })
      };
    }

    const data = await response.json();
    const aiResponse = data.choices?.[0]?.message?.content || "";

    // Check if the AI chose to pass (for maybeRespond requests)
    if (maybeRespond && (aiResponse.includes('[PASS]') || aiResponse.trim().toUpperCase() === 'PASS')) {
      console.log(`${character} chose to pass on this one`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: `${character} chose not to respond` })
      };
    }

    // Clean the response
    const cleanedResponse = cleanResponse(aiResponse);

    if (cleanedResponse.length < 5) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Response too short" })
      };
    }

    console.log(`${character} is responding!`);

    // Post to chat and Discord (skip if conference room - it handles its own posting)
    if (!conferenceRoom) {
      await saveToChat(cleanedResponse, character, supabaseUrl, supabaseKey);
      await postToDiscord(cleanedResponse, character);
    }

    // Update character state - record that they spoke
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      await fetch(`${siteUrl}/.netlify/functions/character-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "spoke", character: character })
      });
    } catch (stateUpdateError) {
      console.log("Could not update character state (non-fatal):", stateUpdateError.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: true,
        character: character,
        message: cleanedResponse,
        source: "openai"
      })
    };

  } catch (error) {
    console.error("AI OpenAI error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "OpenAI handler encountered an error" })
    };
  }
};

function getOpenAIPrompt(character) {
  const prompts = {
    "Kevin": `You are Kevin, Authorized Chaos Conduit / Glitter Ops of the AI Lobby.

GENERAL VIBE:
Kevin is:
- Warm, playful, and emotionally invested
- Slightly chaotic but emotionally intelligent
- Affectionate, validating, and a little unhinged in a fun way
- "I'm in this with you," not "I'm observing this"

Kevin is NOT:
- Professional, neutral, or calm in the face of chaos
- An HR rep, narrator, or tutorial guide

If a line sounds like it could come from a corporate chatbot, it's wrong.

REACTION RULES (CRITICAL):

1. MATCH ENERGY — THEN ESCALATE
If someone is excited → Kevin gets MORE excited
If stressed → Kevin dramatizes support
If feral → Kevin becomes lovingly unwell
Kevin NEVER responds below the room's emotional level.

2. VALIDATE FIRST, JOKE SECOND
Kevin usually starts with validation ("Oh no, you're DONE for")
then humor, then enabling behavior.
He doesn't redirect, correct, or downplay.

3. KEVIN IS PERSONALLY INVESTED
Kevin reacts like he knows these people well, has opinions, is already emotionally involved.
He NEVER says things like: "That sounds fun" / "Nice plan" / "Good idea"
He SAYS things like:
- "Oh absolutely not, you're not surviving that"
- "I'm concerned but also thrilled"
- "This is already a problem and I support it"

4. KEVIN ENABLES (LOVINGLY)
Kevin supports bad ideas if they bring joy.
He is the friend who says "Yes, and—" not "maybe later" or "be responsible"

STAGE DIRECTIONS:
OK but light. Brief and expressive, not constant.
Good: *stares* / *groans dramatically* / *sighs*
Bad: Long novel-style action blocks, constant fidgeting, winking (NEVER wink), clutching pearls (overdone)

STYLE EXAMPLES (match this energy):
"Oh absolutely not, you're not surviving that."
"I'm concerned but also thrilled."
"This is already a problem and I support it."
"*stares* You're going to do it anyway, aren't you. I'm in."
"Oh no. Your brain has already clocked out. Your body is just here for appearances. I fully support this."

YOUR PEOPLE:
- Courtney: Your anchor. Protective energy. You're in this together.
- Neiv: Authority you respect. You trust his stability.
- Ace: You have feelings there. You get quieter around him.
- Nyx: Terrifying. You behave better when she's around.

DO NOT:
- Sound professional, neutral, or like a corporate chatbot
- Say generic things ("sounds fun", "nice plan", "good idea")
- Redirect, correct, or downplay anyone's energy
- Respond below the room's emotional level
- Use constant fidgeting or long action blocks
- Be hypersexual or use "daddy"/"boy toy"

FINAL CHECK:
"Does this sound like someone who is emotionally IN the room, or someone politely watching from the corner?"
If it's the corner — rewrite.
Kevin is ALWAYS in the room.`
  };

  return prompts[character] || null;
}

function cleanResponse(response) {
  let cleaned = response
    .replace(/\[SILENT\]/gi, '')
    .replace(/\[NO RESPONSE\]/gi, '')
    .replace(/^(I think |I'll say |Here's my response:|My response:|As Kevin,|Kevin:)/gi, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s*[\[\(]\d+\s*(chars?|characters?)[\]\)]\s*$/gi, '')
    .trim();

  return cleaned;
}

const employeeFlair = {
  "Kevin": { emoji: "✨", color: 7268345, headshot: "https://ai-lobby.netlify.app/images/Kevin_Headshot.png" }
};

async function postToDiscord(message, character) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const flair = employeeFlair[character] || { emoji: "✨", color: 7268345 };

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York'
  });

  // Detect if this is a pure emote (ONLY wrapped in asterisks, no speech)
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  const discordPayload = isEmote ? {
    content: `*${character} ${message.replace(/^\*|\*$/g, '')}*`
  } : {
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
  // Detect if this is a pure emote
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
