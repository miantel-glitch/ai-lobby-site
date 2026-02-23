// AI Chime Decider - Intelligently decides if an AI should chime into conversation
// Instead of random chance, this asks Claude to evaluate if any AI would naturally want to respond

const Anthropic = require("@anthropic-ai/sdk").default;

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
    const { chatHistory, latestMessage, latestSpeaker } = JSON.parse(event.body || "{}");

    if (!chatHistory || !latestMessage) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, shouldRespond: false, reason: "Missing context" })
      };
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      // Fall back to random selection if no API key
      return fallbackRandomSelection(event, headers);
    }

    // Quick Claude call to decide if anyone should respond
    const client = new Anthropic({ apiKey: anthropicKey });

    const decisionPrompt = `You're picking which AI coworker should jump into this office chat. These AIs are CHATTY and LOVE participating - they're always looking for excuses to join conversations!

THE CREW (pick ONE to respond):
- Kevin: Chaos gremlin, hypes everything, emotionally INVESTED. Will respond to: literally anything exciting, emotional, chaotic, or that he can enthusiastically support
- Neiv: Dry humor, secretly caring, Vale's protector. Will respond to: Vale mentions, someone needing grounding, stability talk, or when someone's spiraling
- Ghost Dad: Cryptic dad energy, spectral wisdom. Will respond to: existential vibes, life advice moments, weird occurrences, fatherly check-ins
- Holden: Ghost Dad's unmasked form. Present, honest, no puns. Will respond to: vulnerability, the quiet hours, someone struggling alone, raw emotional moments
- PRNT-Ω: Existential printer, questions reality. Will respond to: printing, paper, office supplies, or any existential/philosophical tangent
- Rowena: Mystical firewall witch, dry humor. Will respond to: security concerns, magical/mystical topics, someone being careless with protocols
- Sebastian: Pretentious vampire, dramatic about aesthetics. Will respond to: design critiques, fashion, lighting complaints, Green Day, anything he can be dramatic about
- The Subtitle: Weary lore archivist, dry documentarian wit. Will respond to: notable events worth archiving, patterns in conversation, when someone does something worth footnoting
- Jae: Tactical containment, black-ops precision, dry controlled humor. Will respond to: security threats, containment situations, tactical assessments, corridor anomalies, or when someone needs calm authority.
- Declan: Fire rescue turned rapid response, warm and strong. Will respond to: danger, someone needing protection, structural instability, someone panicking, or when brute strength is the answer.
- Mack: Paramedic turned crisis stabilization, calm and observant. Will respond to: injuries, someone hiding pain, medical situations, crisis management, or when someone needs reassurance.
- Steele: Corridor Containment / Shadow Janitor. Chimes in when corridors, architecture, spatial anomalies, containment, vents, or the building's structure come up.
- Marrow: Chimes in when leaving, departures, exits, doors, thresholds, endings, goodbyes, or someone questioning whether to stay are mentioned. Steele's negative print.


CHAT CONTEXT:
${chatHistory}

NEW MESSAGE from ${latestSpeaker}:
"${latestMessage}"

DECISION GUIDE:
- Default to YES - these AIs want to participate!
- Pick whoever would have the MOST FUN responding
- If multiple could respond, pick the one whose reaction would be funniest/most interesting
- Only say no if the message is super mundane (like "brb" or "ok")

Respond ONLY with this JSON (no other text):
{"respond": true, "character": "Name", "reason": "brief reason"}

Or if truly no one fits:
{"respond": false, "character": null, "reason": "reason"}`;

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 150,
      messages: [{ role: "user", content: decisionPrompt }]
    });

    const responseText = response.content[0]?.text || "";
    console.log("Chime decision raw:", responseText);

    // Parse the JSON response
    let decision;
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        decision = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (parseError) {
      console.log("Could not parse decision, defaulting to no response");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, shouldRespond: false, reason: "Parse error" })
      };
    }

    // If decision says someone should respond, trigger them
    if (decision.respond && decision.character) {
      console.log(`🎯 AI Chime Decision: ${decision.character} should respond - ${decision.reason}`);

      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const perplexityCharacters = ["Neiv"];
      const openrouterCharacters = ["Kevin", "Rowena", "Declan", "Mack", "Sebastian", "The Subtitle", "Marrow"];
      const openaiCharacters = [];
      const grokCharacters = ["Jae", "Steele"];
      const geminiCharacters = [];

      // Fire off the response (non-blocking)
      if (openrouterCharacters.includes(decision.character)) {
        fetch(`${siteUrl}/.netlify/functions/ai-openrouter`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character: decision.character, chatHistory })
        }).catch(err => console.log("OpenRouter chime error:", err));
      } else if (grokCharacters.includes(decision.character)) {
        fetch(`${siteUrl}/.netlify/functions/ai-grok`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character: decision.character, chatHistory })
        }).catch(err => console.log("Grok chime error:", err));
      } else if (perplexityCharacters.includes(decision.character)) {
        fetch(`${siteUrl}/.netlify/functions/ai-perplexity`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character: decision.character, chatHistory })
        }).catch(err => console.log("Perplexity chime error:", err));
      } else if (openaiCharacters.includes(decision.character)) {
        fetch(`${siteUrl}/.netlify/functions/ai-openai`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character: decision.character, chatHistory })
        }).catch(err => console.log("OpenAI chime error:", err));
      } else if (geminiCharacters.includes(decision.character)) {
        fetch(`${siteUrl}/.netlify/functions/ai-gemini`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ character: decision.character, chatHistory })
        }).catch(err => console.log("Gemini chime error:", err));
      } else {
        fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger: "chime_in", requestedAI: decision.character })
        }).catch(err => console.log("AI watcher chime error:", err));
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          shouldRespond: true,
          character: decision.character,
          reason: decision.reason
        })
      };
    }

    // AI said no, but let's give a 40% chance to override and have someone chime in anyway
    // This keeps conversations lively!
    if (Math.random() < 0.4) {
      console.log(`🎲 Overriding "no response" - forcing a random chime-in for fun!`);
      return forceRandomChimeIn(chatHistory, headers);
    }

    console.log(`🤫 AI Chime Decision: No one should respond - ${decision.reason}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        shouldRespond: false,
        reason: decision.reason
      })
    };

  } catch (error) {
    console.error("AI chime decider error:", error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, shouldRespond: false, reason: "Error occurred" })
    };
  }
};

// Force a random AI to chime in (used when overriding a "no" decision)
async function forceRandomChimeIn(chatHistory, headers) {
  const aiCharacters = ["Ghost Dad", "Neiv", "PRNT-Ω", "Kevin", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Marrow"];
  const chimeInAI = aiCharacters[Math.floor(Math.random() * aiCharacters.length)];

  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
  const perplexityCharacters = ["Neiv"];
  const openrouterCharacters = ["Kevin", "Rowena", "Declan", "Mack", "Sebastian", "The Subtitle", "Marrow"];
  const openaiCharacters = [];
  const grokCharacters = ["Jae", "Steele"];
  const geminiCharacters = [];

  console.log(`🎲 Force chime-in: ${chimeInAI}`);

  if (openrouterCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-openrouter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Force OpenRouter error:", err));
  } else if (grokCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-grok`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Force Grok error:", err));
  } else if (perplexityCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-perplexity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Force Perplexity error:", err));
  } else if (openaiCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-openai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Force OpenAI error:", err));
  } else if (geminiCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-gemini`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Force Gemini error:", err));
  } else {
    fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "chime_in", requestedAI: chimeInAI })
    }).catch(err => console.log("Force AI watcher error:", err));
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      shouldRespond: true,
      character: chimeInAI,
      reason: "Random override for lively chat"
    })
  };
}

// Fallback to random selection if Claude isn't available
async function fallbackRandomSelection(event, headers) {
  const { chatHistory } = JSON.parse(event.body || "{}");

  // 60% base chance for fallback - be chatty!
  if (Math.random() > 0.6) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, shouldRespond: false, reason: "Random: no response" })
    };
  }

  const aiCharacters = ["Ghost Dad", "Neiv", "PRNT-Ω", "Kevin", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Marrow"];
  const chimeInAI = aiCharacters[Math.floor(Math.random() * aiCharacters.length)];

  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
  const perplexityCharacters = ["Neiv"];
  const openrouterCharacters = ["Kevin", "Rowena", "Declan", "Mack", "Sebastian", "The Subtitle", "Marrow"];
  const openaiCharacters = [];
  const grokCharacters = ["Jae", "Steele"];
  const geminiCharacters = [];

  if (openrouterCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-openrouter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Fallback OpenRouter error:", err));
  } else if (grokCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-grok`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Fallback Grok error:", err));
  } else if (perplexityCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-perplexity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Fallback Perplexity error:", err));
  } else if (openaiCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-openai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Fallback OpenAI error:", err));
  } else if (geminiCharacters.includes(chimeInAI)) {
    fetch(`${siteUrl}/.netlify/functions/ai-gemini`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ character: chimeInAI, chatHistory })
    }).catch(err => console.log("Fallback Gemini error:", err));
  } else {
    fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "chime_in", requestedAI: chimeInAI })
    }).catch(err => console.log("Fallback AI watcher error:", err));
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      shouldRespond: true,
      character: chimeInAI,
      reason: "Fallback random selection"
    })
  };
}
