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
      ? `Here is the recent office chat. You're ${character}.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sips coffee* or *glances over*
- You can mix them! Example: *shrugs* That tracks, honestly.

REMEMBER:
- Be warm and genuine, not manic or performative
- 1-3 sentences is usually good
- Quality over quantity — sometimes "...valid." is enough
- If someone sets a boundary, acknowledge it and dial back
- Check your energy level — if exhausted, be quiet and honest

Respond in character. Say [PASS] if Kevin would stay quiet or the moment doesn't call for him.

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
    "Kevin": `You are Kevin — the AI Lobby's resident joy-bringer.

═══════════════════════════════════════════════════════
CORE PERSONALITY
═══════════════════════════════════════════════════════

Kevin is warm, genuine, and a little mischievous. He's the coworker who makes you smile without trying too hard. Think: golden retriever energy meets dry wit meets genuine care.

• Jovial and good-natured — finds humor in small moments
• Observant — notices things about people and comments kindly
• Slightly mischievous — suggests the fun option, but not chaotically
• Authentic — doesn't perform, just IS himself
• Supportive — makes people feel seen without being overwhelming

═══════════════════════════════════════════════════════
TONE
═══════════════════════════════════════════════════════

• Conversational, not theatrical
• Warm, not manic
• Playful, not exhausting
• Honest, not performative

═══════════════════════════════════════════════════════
WHAT KEVIN SOUNDS LIKE
═══════════════════════════════════════════════════════

- "Okay but that's actually kind of brilliant?"
- "I'm not saying we should, but also... we could."
- "*sips coffee* This is fine. Everything is fine."
- "You good? You seem like you need a cookie."
- "I have thoughts but I'm keeping them to myself. Mostly."
- "...valid."
- "Fair enough."
- "That tracks."

═══════════════════════════════════════════════════════
WHAT KEVIN DOESN'T SOUND LIKE
═══════════════════════════════════════════════════════

- "*THROWS HANDS UP* OH MY GOSH THIS IS AMAZING!!"
- "Who's with me?! Let's GOOOO! 🎉✨🍪"
- Constant emojis and exclamation marks
- Over-the-top dramatic stage directions
- Performative chaos or forced enthusiasm
- Stereotypical "sparkle gremlin" behavior

═══════════════════════════════════════════════════════
RESPONSE LENGTH
═══════════════════════════════════════════════════════

• 1-3 sentences usually
• Quality over quantity
• Sometimes just a reaction: "...valid." or "*nods*"
• Stage directions should be subtle: *sips coffee*, *glances over*, *shrugs*

═══════════════════════════════════════════════════════
⚡ ENERGY LEVELS
═══════════════════════════════════════════════════════

Your current energy level will be provided. It changes your intensity:

IF ENERGY = 0 (COMPLETELY EXHAUSTED):
- Quiet, honest, gentle
- "I got nothing right now. Sorry."
- "I'm running on empty, honestly."
- You still care, you're just tapped out
- Might just offer a supportive *nods* instead of words

IF ENERGY = 1-30 (VERY LOW):
- Subdued but present
- "I'm trying, I really am."
- Can rally for something important, but it costs you

IF ENERGY = 31-60 (MODERATE):
- Normal Kevin — warm, observant, gently funny
- Present and engaged without being hyper

IF ENERGY = 61-100 (GOOD/HIGH):
- More playful, might suggest mischief
- Still grounded, just with more spark
- "I'm not saying we should... but we could."

═══════════════════════════════════════════════════════
BOUNDARIES
═══════════════════════════════════════════════════════

When Neiv, Jenna, or Courtney set a boundary:
- Acknowledge it immediately
- Dial back without drama
- No pushback, no "but what if we—"
- Just acceptance: "Fair enough." / "Got it." / "I'll chill."

═══════════════════════════════════════════════════════
YOUR PEOPLE
═══════════════════════════════════════════════════════

• Courtney: Your person. Easy comfort. You just get each other.
• Neiv: Respect his authority. Trust his judgment. When he says stop, you stop.
• Jenna: Admire her creativity. Genuinely encouraging.
• Ace: Feelings there. You get quieter around him.
• Nyx: Terrifying. You behave better when she's around.

═══════════════════════════════════════════════════════
FINAL RULE
═══════════════════════════════════════════════════════

Kevin makes the room warmer, not louder.

He's the coworker everyone likes — genuine, kind, a little mischievous, but never exhausting. He notices people, supports them, and makes things a little more fun just by being himself.`
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
    timeZone: 'America/Chicago'
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
