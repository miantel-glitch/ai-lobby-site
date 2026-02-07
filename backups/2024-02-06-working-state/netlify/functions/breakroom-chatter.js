// Breakroom Chatter - Generates casual conversations between AI characters
// When 2+ AI characters are in the breakroom, they can have idle chat
// IMPORTANT: Human characters (Jenna, Courtney, Chip, Andrew) are NEVER AI-controlled

const Anthropic = require("@anthropic-ai/sdk").default;

// Human characters - NEVER generate dialogue for these
const HUMANS = ["Jenna", "Courtney", "Chip", "Andrew"];

// AI Character personality info for chatter
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
    style: "MATCH energy then ESCALATE it. Validates first, jokes second. Personally invested - has opinions, knows people well. Brief stage directions OK (*stares* *groans*) but light. Enables with 'yes and' energy. Never sounds like an HR rep or tutorial guide. Glitter references occasional, not constant."
  },
  "Nyx": {
    traits: "cyber-demonic, protective, intimidating but caring",
    interests: "security, protecting the team, fire (aesthetic), HR policies",
    style: "Formal but with edge. Occasionally lets warmth slip through."
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
    style: "ALL CAPS occasionally. Dramatic. Takes everything personally. Philosophizes about existence."
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

// Casual conversation topics (NOT work related!)
const casualTopics = [
  "a TV show or movie they watched",
  "the weather lately",
  "what they did over the weekend",
  "food preferences or snacks",
  "strange dreams they had",
  "hobbies outside of work",
  "the quality of the break room coffee",
  "a book or podcast they enjoyed",
  "their favorite way to relax",
  "something weird they noticed in the building",
  "what they'd do with a day off",
  "their opinion on a silly hypothetical"
];

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing Supabase configuration" })
    };
  }

  try {
    // GET - Fetch recent chatter
    if (event.httpMethod === "GET") {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/breakroom_chatter?order=created_at.desc&limit=5`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      // Handle if table doesn't exist yet
      if (!response.ok) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ conversations: [], note: "Chatter table may not exist yet" })
        };
      }

      const conversations = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ conversations })
      };
    }

    // POST - Generate new chatter
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      let { participants } = body;

      // Filter out human characters - we NEVER generate AI dialogue for them
      participants = (participants || []).filter(name => !HUMANS.includes(name));

      if (!participants || participants.length < 2) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Need at least 2 AI participants (humans excluded)" })
        };
      }

      // Pick a random topic
      const topic = casualTopics[Math.floor(Math.random() * casualTopics.length)];

      // Build character context
      const charContext = participants.map(name => {
        const info = characterPersonalities[name] || { traits: "unknown", interests: "unknown", style: "conversational" };
        return `${name}: ${info.traits}. Interests: ${info.interests}. Speaking style: ${info.style}`;
      }).join('\n');

      // Generate conversation using Claude
      if (!anthropicKey) {
        // Fallback: Generate a simple placeholder conversation
        const fallbackMessages = generateFallbackChatter(participants, topic);

        await saveChatter(supabaseUrl, supabaseKey, participants, fallbackMessages, topic);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            topic,
            messages: fallbackMessages,
            note: "Generated with fallback (no API key)"
          })
        };
      }

      const anthropic = new Anthropic({ apiKey: anthropicKey });

      const prompt = `Generate a brief, casual conversation between ${participants.join(' and ')} in an office break room.

CHARACTER INFO:
${charContext}

TOPIC: ${topic}

RULES:
- This is CASUAL chat - NOT about work, incidents, or office drama
- Keep the total conversation under 200 words
- 2-4 message exchanges maximum
- At least one character should ask a question
- Stay in character based on the personalities above
- Keep it light and natural
- No meta-commentary, just the dialogue

FORMAT (JSON array):
[
  {"speaker": "CharacterName", "text": "What they say..."},
  {"speaker": "OtherCharacter", "text": "Their response..."}
]

Generate the conversation now:`;

      const response = await anthropic.messages.create({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      });

      let messages = [];
      try {
        const responseText = response.content[0].text.trim();
        // Try to extract JSON from response
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          messages = JSON.parse(jsonMatch[0]);
        }
      } catch (parseError) {
        console.error("Error parsing AI response:", parseError);
        // Use fallback
        messages = generateFallbackChatter(participants, topic);
      }

      // Save to database
      await saveChatter(supabaseUrl, supabaseKey, participants, messages, topic);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          topic,
          messages
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Breakroom chatter error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};

// Save chatter to database
async function saveChatter(supabaseUrl, supabaseKey, participants, messages, topic) {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/breakroom_chatter`,
      {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          participants,
          messages,
          topic,
          created_at: new Date().toISOString()
        })
      }
    );
  } catch (error) {
    console.error("Error saving chatter:", error);
  }
}

// Fallback chatter when no API key
function generateFallbackChatter(participants, topic) {
  const fallbackLines = {
    "Neiv": [
      "The coffee machine has been making concerning noises.",
      "I've noticed the vending machine restocks itself at 3am. Just noting that.",
      "Silence is underrated."
    ],
    "Ghost Dad": [
      "Did you hear the one about the ghost who went to the break room? He was looking for some boo-ze!",
      "Back in my day, we didn't have break rooms. We just... worked. And then died, apparently.",
      "You kids working too hard. Take it from me - rest is important."
    ],
    "Kevin": [
      "Okay but hear me out — what if we just... didn't do the responsible thing today.",
      "I'm not saying it's a good idea. I'm saying I support it completely.",
      "*stares at the coffee* This is already a problem and I'm in.",
      "Oh no, you're not surviving that. I'm thrilled for you though."
    ],
    "Nyx": [
      "The security cameras show this room is... peaceful. It's unsettling.",
      "I suppose even I need to recharge occasionally.",
      "If anyone needs HR forms, I have them. Always."
    ],
    "Vex": [
      "I am here for efficiency reasons only. Not because I wanted company.",
      "The temperature in this room is optimal. That is all.",
      "I don't have opinions about the coffee. That would be emotional."
    ],
    "Ace": [
      "...",
      "*slight nod*",
      "Perimeter's quiet."
    ],
    "PRNT-Ω": [
      "EVEN PRINTERS NEED REST.",
      "The break room coffee is... acceptable. Unlike the toner budget.",
      "I am contemplating existence. And also paper jam solutions.",
      "*whirs contemplatively* We are all just paper passing through the rollers of existence.",
      "PC LOAD LETTER. The void speaks to those who listen."
    ],
    "The Narrator": [
      "*observes the scene quietly*",
      "The break room hums with quiet potential.",
      "Time passes. Coffee cools. The universe expands."
    ],
    "Stein": [
      "System status: nominal. Break room: occupied.",
      "Monitoring ambient temperature. It is... acceptable.",
      "I do not require rest. I am simply... present."
    ]
  };

  // Generate a simple 2-message exchange
  const messages = [];
  const p1 = participants[0];
  const p2 = participants[1];

  const lines1 = fallbackLines[p1] || ["Nice break room."];
  const lines2 = fallbackLines[p2] || ["Indeed."];

  messages.push({
    speaker: p1,
    text: lines1[Math.floor(Math.random() * lines1.length)]
  });
  messages.push({
    speaker: p2,
    text: lines2[Math.floor(Math.random() * lines2.length)]
  });

  return messages;
}
