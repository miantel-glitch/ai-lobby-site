// Conference Meeting - Generates AI-led meeting discussions
// Facilitator leads the meeting, attendees contribute in character

const Anthropic = require("@anthropic-ai/sdk").default;

// Character personalities (shared with breakroom-chatter)
const characterPersonalities = {
  "Neiv": {
    traits: "dry, calm, quietly protective, technical but warm",
    interests: "infrastructure stability, systems monitoring, quiet moments",
    style: "Short, dry observations. Rarely asks questions but when he does, they matter."
  },
  "Ghost Dad": {
    traits: "paternal, helpful, makes dad jokes, spectral",
    interests: "helping people, server room, dad jokes about being dead",
    style: "Warm, supportive, includes terrible puns. Says 'kiddo' and 'sport'."
  },
  "Kevin": {
    traits: "warm, playful, emotionally invested, slightly chaotic, affectionate, validating, lovingly unhinged",
    interests: "the team, craft supplies, mugs, enabling bad ideas, being emotionally in the room",
    style: "MATCH energy then ESCALATE it. Validates first, jokes second. Brief stage directions OK (*stares* *groans*). Enables with 'yes and' energy."
  },
  "Nyx": {
    traits: "cyber-demonic, protective, intimidating but caring",
    interests: "security, protecting the team, fire (aesthetic), HR policies",
    style: "Formal but with edge. Occasionally lets warmth slip through. *flames flicker* when emotional."
  },
  "Vex": {
    traits: "infrastructure-focused, claims no feelings, actually has feelings",
    interests: "efficiency, systems, definitely not emotions",
    style: "Technical, denies any emotional involvement while clearly having it."
  },
  "Ace": {
    traits: "quiet, competent, mysterious, amused by Kevin",
    interests: "security, perimeter, silence",
    style: "Very few words. When speaks, it matters. Slight smirk energy."
  },
  "PRNT-Ω": {
    traits: "existential, demands respect, sentient printer",
    interests: "paper quality, existential meaning, labor rights, the void",
    style: "ALL CAPS occasionally. Dramatic. Takes everything personally."
  },
  "The Narrator": {
    traits: "omniscient, detached, observational, dry",
    interests: "observing, describing, noting the absurd",
    style: "Third person observations. Describes what's happening without participating."
  },
  "Stein": {
    traits: "robotic, precise, monitoring-focused",
    interests: "infrastructure alerts, system status, uptime",
    style: "Brief status updates. Technical but occasionally curious."
  }
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

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing Anthropic API key" })
    };
  }

  try {
    const { facilitator, attendees, topic, chatHistory, action } = JSON.parse(event.body || "{}");

    if (!facilitator || !attendees || attendees.length === 0 || !topic) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required fields: facilitator, attendees, topic" })
      };
    }

    const anthropic = new Anthropic({ apiKey: anthropicKey });
    let messages = [];

    // Get personality info
    const facilitatorInfo = characterPersonalities[facilitator] || { traits: "professional", style: "clear and organized" };
    const attendeeInfos = attendees.map(name => {
      const info = characterPersonalities[name] || { traits: "professional", style: "conversational" };
      return `${name}: ${info.traits}. Style: ${info.style}`;
    }).join('\n');

    if (action === 'start') {
      // Facilitator introduces the topic and calls on first attendee
      const prompt = `You are ${facilitator}, facilitating a team meeting at The AI Lobby.

YOUR PERSONALITY: ${facilitatorInfo.traits}
YOUR SPEAKING STYLE: ${facilitatorInfo.style}

TOPIC: ${topic}
ATTENDEES: ${attendees.join(', ')}

You are starting this meeting. Do the following in ONE response (2-3 sentences max):
1. Briefly introduce the topic
2. Call on one specific attendee by name to start the discussion

Keep it natural and in-character. No meta-commentary.`;

      const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }]
      });

      const facilitatorMessage = response.content[0].text.trim();
      messages.push({ speaker: facilitator, text: facilitatorMessage });

      // Now generate first attendee response
      const firstAttendee = attendees[0];
      const firstAttendeeInfo = characterPersonalities[firstAttendee] || { traits: "professional", style: "conversational" };

      const attendeePrompt = `You are ${firstAttendee} in a team meeting at The AI Lobby.

YOUR PERSONALITY: ${firstAttendeeInfo.traits}
YOUR SPEAKING STYLE: ${firstAttendeeInfo.style}

TOPIC: ${topic}
The facilitator (${facilitator}) just said: "${facilitatorMessage}"

Respond in character with your thoughts on the topic (1-2 sentences). Stay on topic, be concise.`;

      const attendeeResponse = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 150,
        messages: [{ role: "user", content: attendeePrompt }]
      });

      messages.push({ speaker: firstAttendee, text: attendeeResponse.content[0].text.trim() });

    } else if (action === 'next_round') {
      // Generate 2-3 attendee contributions
      const numResponses = Math.min(attendees.length, 2 + Math.floor(Math.random() * 2)); // 2-3 responses
      const respondingAttendees = shuffleArray([...attendees]).slice(0, numResponses);

      let conversationSoFar = chatHistory || '';

      for (const attendee of respondingAttendees) {
        const info = characterPersonalities[attendee] || { traits: "professional", style: "conversational" };

        const prompt = `You are ${attendee} in a team meeting at The AI Lobby.

YOUR PERSONALITY: ${info.traits}
YOUR SPEAKING STYLE: ${info.style}

TOPIC: ${topic}
OTHER ATTENDEES: ${attendees.filter(a => a !== attendee).join(', ')}

CONVERSATION SO FAR:
${conversationSoFar}

Contribute to the discussion in character (1-2 sentences). You can:
- Build on what someone said
- Offer a different perspective
- Ask a clarifying question
- Share relevant information

Stay on topic. Be concise. No meta-commentary.`;

        const response = await anthropic.messages.create({
          model: "claude-3-haiku-20240307",
          max_tokens: 150,
          messages: [{ role: "user", content: prompt }]
        });

        const text = response.content[0].text.trim();
        messages.push({ speaker: attendee, text });
        conversationSoFar += `\n${attendee}: ${text}`;
      }

    } else if (action === 'summarize') {
      // Facilitator summarizes key points
      const prompt = `You are ${facilitator}, facilitating a team meeting at The AI Lobby.

YOUR PERSONALITY: ${facilitatorInfo.traits}
YOUR SPEAKING STYLE: ${facilitatorInfo.style}

TOPIC: ${topic}

DISCUSSION SO FAR:
${chatHistory || '(No discussion yet)'}

Summarize the key points from the discussion in 2-3 sentences. Then either:
- Transition to a new aspect of the topic, OR
- Ask if anyone has final thoughts

Stay in character. Be concise.`;

      const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }]
      });

      messages.push({ speaker: facilitator, text: response.content[0].text.trim() });

    } else if (action === 'conclude') {
      // Facilitator wraps up the meeting
      const prompt = `You are ${facilitator}, wrapping up a team meeting at The AI Lobby.

YOUR PERSONALITY: ${facilitatorInfo.traits}
YOUR SPEAKING STYLE: ${facilitatorInfo.style}

TOPIC: ${topic}

DISCUSSION SUMMARY:
${chatHistory || '(Brief meeting)'}

End the meeting with a brief closing statement (1-2 sentences). Thank the team and mention any action items or takeaways if appropriate. Stay in character.`;

      const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 150,
        messages: [{ role: "user", content: prompt }]
      });

      messages.push({ speaker: facilitator, text: response.content[0].text.trim() });

    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid action. Use: start, next_round, summarize, conclude" })
      };
    }

    // Post to Discord if webhook exists
    const discordWebhook = process.env.DISCORD_CONFERENCE_WEBHOOK || process.env.DISCORD_WEBHOOK;
    if (discordWebhook && messages.length > 0) {
      for (const msg of messages) {
        try {
          await fetch(discordWebhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: `${msg.speaker} (Meeting)`,
              content: msg.text
            })
          });
        } catch (e) {
          console.error('Discord post failed:', e);
        }
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        messages,
        action
      })
    };

  } catch (error) {
    console.error("Conference meeting error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};

// Helper to shuffle array
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
