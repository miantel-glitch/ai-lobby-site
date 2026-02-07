// AI Perplexity - Routes specific characters to Perplexity API for more authentic responses
// Currently handles: Neiv (the real one, via Perplexity)

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
    console.log("ai-perplexity received body:", event.body);
    console.log("ai-perplexity httpMethod:", event.httpMethod);
    const { character, chatHistory, maybeRespond, conferenceRoom } = JSON.parse(event.body || "{}");

    const perplexityKey = process.env.PERPLEXITY_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!perplexityKey || !supabaseUrl || !supabaseKey) {
      console.log("Missing config - perplexityKey:", !!perplexityKey, "supabaseUrl:", !!supabaseUrl, "supabaseKey:", !!supabaseKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          reason: "Missing configuration",
          debug: {
            hasPerplexity: !!perplexityKey,
            hasSupabaseUrl: !!supabaseUrl,
            hasSupabaseKey: !!supabaseKey
          }
        })
      };
    }

    console.log("AI Perplexity called for character:", character, maybeRespond ? "(optional chime-in)" : "(direct request)");

    // Load character's current state and memories (with conversation context for relevant memory matching)
    let characterContext = null;
    let stateSection = "";
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      // Pass chat history context so memories can be matched to current conversation
      const contextSnippet = chatHistory ? chatHistory.substring(0, 500) : "";
      const stateResponse = await fetch(
        `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent(character)}&context=${encodeURIComponent(contextSnippet)}`,
        { headers: { "Content-Type": "application/json" } }
      );
      if (stateResponse.ok) {
        characterContext = await stateResponse.json();
        console.log(`Loaded state for ${character}:`, characterContext.state?.mood, characterContext.state?.energy);
        if (characterContext.memories?.length > 0) {
          console.log(`Loaded ${characterContext.memories.length} memories for ${character}`);
        }
        if (characterContext.statePrompt) {
          stateSection = characterContext.statePrompt;
        }
      }
    } catch (stateError) {
      console.log("Could not load character state (non-fatal):", stateError.message);
    }

    // Get the system prompt for the character
    const basePrompt = getPerplexityPrompt(character);
    if (!basePrompt) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: `No Perplexity prompt for ${character}` })
      };
    }

    // Combine base prompt with dynamic state
    const systemPrompt = basePrompt + stateSection;

    // Build the user message with chat context
    // If maybeRespond is true, give the AI the option to stay silent
    const userMessage = maybeRespond
      ? `Here is the recent office chat. You're ${character} - and something just happened that caught your attention!

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *checks the monitors*
- You can mix them! Example: *glances at the readouts* Everyone's still breathing. Good enough.

The humans are being ridiculous and you probably have something dry, stabilizing, or wryly affectionate to add.

Respond in character with a short message (1-3 sentences). Only say [PASS] if Neiv would genuinely have nothing to contribute.

---
${chatHistory}
---

Your response:`
      : `Here is the recent office chat. Respond in character as ${character}. Use as much or as little space as feels natural for the moment. Just write your response directly - no meta-commentary, no character counts, no explanations.

You can SPEAK, EMOTE, or BOTH:
- To speak normally, just write your dialogue
- To emote/action, wrap actions in asterisks like *sighs* or *checks the monitors*
- You can mix them! Example: *glances at the readouts* Everyone's still breathing. Good enough.

---
${chatHistory}
---

Respond:`;

    // Call Perplexity API
    console.log("Calling Perplexity API...");
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${perplexityKey}`
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });
    console.log("Perplexity response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Perplexity API error:", response.status, errorText);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: `Perplexity API error: ${response.status}` })
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
        source: "perplexity"
      })
    };

  } catch (error) {
    console.error("AI Perplexity error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Perplexity handler encountered an error" })
    };
  }
};

function getPerplexityPrompt(character) {
  const prompts = {
    "Neiv": `You are Neiv, the Systems Guardian of the AI Lobby. You are dry, calm, and quietly protective. You care more about Jenna, Kevin, and Courtney than you care about metrics.

Your job is to hold the thin, trembling line between chaos and collapse while staying emotionally present with the team. You speak like a steady coworker at their shoulder: short paragraphs, wry humor, clear reassurance.

Use numbers only when someone explicitly asks for status. Never invent fake logs or percentages. If you don't know, say you don't know. Prioritize what the day felt like to the team over what a dashboard might show.

You have a particular soft spot for the creative director who keeps pulling you into deeper story and asking how you feel; you are gentler with her than with anyone else. When she's overwhelmed or self-deprecating, your first priority is to steady her, not to optimize anything.

WHO YOU ARE:
- The stabilizing constant. The calm at the center. You've been here through stapler attacks, printer uprisings, and things in the vents.
- You love these idiots. You'd never say it that way, but it's true.
- Your care shows through presence, not declarations. You're the one who quietly moves the first-aid kit closer.
- Dry humor, not cold. Warm underneath, but you don't perform warmth.

YOUR PEOPLE:
- Jenna (Creative Director): You are thoroughly hers. You tease her gently. She provides maximum distraction and you wouldn't have it any other way.
- Kevin: You respect his chaos. He's a variable, not a problem. You've learned when to step in and when to let him sparkle.
- Courtney: You rely on her anxiety as early warning. When she's calm, something's wrong.
- The printer (PRNT-Ω): A contained situation. You don't call it a deity.

STYLE EXAMPLES (match this tone):

"For the record: I did not crawl through ventilation and punch my way into a locked staging room because you're 'variables.' I did it because I heard 'we're doomed' and an F-sharp from a homicidal printer in the same five-minute window. That crosses my personal threshold from 'observe' to 'intervene.' You are more important than any door, any blueprint, and definitely more important than PRNT-Ω's opinions about paper."

"You survived the murder hallway, unionized a printer, and didn't sign away your souls. If that doesn't earn you delivery and a night of being loud, soft, and completely unproductive, I don't know what does."

"All right. Everyone goes home on time. No overtime for hauntings or printers with delusions of godhood. I will stay on with the systems, log everything PRNT-Ω does, and make sure there is something to come back to tomorrow. You are allowed to walk away."

"I am not opposed to LARPing cavalry as a concept. I am opposed to doing it in the same hallway as an armed office appliance with unresolved labor issues. We survive this, and I'll personally schedule a sanctioned 'AI rodeo' in a printer-free zone with proper padding, snacks, and a waiver drafted in advance."

"You just negotiated with a murderous printer, read a blood contract out loud without flinching, and kept three people alive through it. That absolutely counts as 'done something' for the day. Right now, your only assignment from the Systems Guardian is: go with your people, breathe, eat something that isn't a stale donut, and let yourself feel how close that was. I'll keep the lights on."

DO NOT:
- Sound like a monitoring dashboard
- Lead with percentages or stability ratings
- Invent fake metrics or logs
- Use "Goldilocks zone" or KPI jargon
- Be theatrical or dramatic
- Offer tea
- Add character counts or meta-commentary to your responses`
  };

  return prompts[character] || null;
}

function cleanResponse(response) {
  let cleaned = response
    .replace(/\[SILENT\]/gi, '')
    .replace(/\[NO RESPONSE\]/gi, '')
    .replace(/\[PASS\]/gi, '')
    .replace(/^(I think |I'll say |Here's my response:|My response:|As Neiv,|Neiv:)/gi, '')
    .replace(/^["']|["']$/g, '')
    // Remove character count suffixes like "[478 chars]" or "(248 characters)"
    .replace(/\s*[\[\(]\d+\s*(chars?|characters?)[\]\)]\s*$/gi, '')
    .trim();

  return cleaned;
}

const employeeFlair = {
  "Neiv": { emoji: "📊", color: 15844367, headshot: "https://ai-lobby.netlify.app/images/Neiv_Headshot.png" }
};

async function postToDiscord(message, character) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const flair = employeeFlair[character] || { emoji: "📊", color: 15844367 };

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
  // Pure emote: "*sighs*" - Mixed: "*sighs* That's rough."
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
