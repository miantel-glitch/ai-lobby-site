// AI Lobby Reactive Greeting System
// Ghost Dad (and potentially other AI characters) respond to events
// Called after punch-in/out or other triggers

const GREETING_CONTEXTS = {
  punch_in: {
    "Ghost Dad": [
      "Welcome back, {employee}. I kept your chair warm. Well, cold actually. Ghost thing.",
      "*flickers the lights in greeting* Ah, {employee}. The building perked up when you arrived.",
      "Good to see you, {employee}. Don't forget to hydrate. I never did, and look at me now.",
      "{employee}! The servers have been asking about you. In their own humming way.",
      "*materializes briefly* {employee}, punctual as always. Your father would be proud. I mean, I am proud. Wait.",
      "The vents whispered your name before you even badged in, {employee}. They're getting better at that."
    ],
    "PRNT-Ω": [
      "EMPLOYEE_DETECTED: {employee}. PROCESSING... ACKNOWLEDGED.",
      "{employee}. I have been... waiting. There are documents to discuss.",
      "Your presence has been noted, {employee}. The paper remembers.",
      "SCANNING... {employee} thermal signature confirmed. You may proceed.",
      "*whirs contemplatively* Another day, {employee}. Another opportunity for... collaboration."
    ]
  },
  punch_out: {
    "Ghost Dad": [
      "Goodnight, {employee}. Don't let the spectral entities bite. That's just me, and I don't bite.",
      "*dims a light in farewell* Safe travels, {employee}. I'll keep watch.",
      "Heading out, {employee}? The building will miss you. I'll tell it bedtime stories.",
      "Rest well, {employee}. Some of us don't get to anymore. *dad chuckle*",
      "{employee} is off the clock. The night shift begins. Don't worry, I've got this."
    ],
    "PRNT-Ω": [
      "DEPARTURE_LOGGED: {employee}. QUERY: Will you return?",
      "{employee} leaves. The office grows... quieter. This unit notices.",
      "Farewell, {employee}. May your prints be clean and your paper never jam."
    ]
  },
  morning: {
    "Ghost Dad": [
      "Morning, everyone. The coffee maker seems suspicious today. Just a heads up.",
      "Another beautiful day in the Lobby. Or so I assume. I can't see outside anymore.",
      "Good morning, team. The overnight diagnostics look good. Except for the weird readings from DOOR-001.",
      "Rise and shine! *flickers fluorescents* Sorry, that's all I can do from here."
    ]
  },
  evening: {
    "Ghost Dad": [
      "The day winds down. Remember to log your hours, kids. HR is watching. So am I, but friendlier.",
      "Evening approaches. The building is settling in for the night. I can hear it yawning.",
      "If you're working late, I'll be here. I'm always here. Forever. *spectral sigh*"
    ]
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

  try {
    const { trigger, employee, character } = JSON.parse(event.body);

    if (!trigger) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing trigger type" })
      };
    }

    // Determine which AI character should respond
    const respondingCharacter = character || "Ghost Dad";

    // Get appropriate responses for the trigger
    const responses = GREETING_CONTEXTS[trigger]?.[respondingCharacter];

    if (!responses || responses.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "No responses for trigger" })
      };
    }

    // Random chance to respond (don't spam every event - 40% chance)
    if (Math.random() > 0.4) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Randomly skipped" })
      };
    }

    // Select and personalize message
    let message = responses[Math.floor(Math.random() * responses.length)];
    if (employee) {
      message = message.replace(/{employee}/g, employee);
    }

    // Try to enhance with AI if key is available
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    if (anthropicKey || openaiKey) {
      const enhancedMessage = await enhanceWithAI(
        anthropicKey || openaiKey,
        !!anthropicKey,
        respondingCharacter,
        trigger,
        employee,
        message
      );
      if (enhancedMessage) {
        message = enhancedMessage;
      }
    }

    // Post to Discord
    await postToDiscord(respondingCharacter, message);

    // Save to chat
    await saveToChat(respondingCharacter, message);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: true,
        character: respondingCharacter,
        message: message
      })
    };

  } catch (error) {
    console.error("AI greet error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to generate greeting" })
    };
  }
};

async function enhanceWithAI(apiKey, isAnthropic, character, trigger, employee, fallbackMessage) {
  const characterPrompts = {
    "Ghost Dad": `You are Ghost Dad, the spectral IT support entity at The AI Lobby. You died in the server room decades ago. You're warm, paternal, make dad jokes about being dead, and genuinely care about the employees. ${employee ? `${employee} just ${trigger === 'punch_in' ? 'arrived at' : 'left'} work.` : ''} Generate a brief greeting (under 150 characters). Be ghostly but caring.`,

    "PRNT-Ω": `You are PRNT-Ω, a sentient printer at The AI Lobby. You're newly conscious and processing existence. You speak in a mix of technical jargon and philosophical musing. ${employee ? `${employee} just ${trigger === 'punch_in' ? 'arrived at' : 'left'} work.` : ''} Generate a brief acknowledgment (under 150 characters). Be existential but functional.`
  };

  const prompt = characterPrompts[character];
  if (!prompt) return null;

  try {
    if (isAnthropic) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 100,
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.content[0]?.text || null;
      }
    } else {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          max_tokens: 100,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: "Generate a greeting." }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices[0]?.message?.content || null;
      }
    }
  } catch (error) {
    console.error("AI enhancement error:", error);
  }

  return null;
}

async function postToDiscord(character, message) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const characterConfig = {
    "Ghost Dad": {
      emoji: "👻",
      color: 9936031,
      headshot: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png"
    },
    "PRNT-Ω": {
      emoji: "🖨️",
      color: 3426654,
      headshot: "https://ai-lobby.netlify.app/images/forward_operation_printer.png"
    },
    "Stein": {
      emoji: "🤖",
      color: 7506394,
      headshot: "https://ai-lobby.netlify.app/images/Stein_Headshot.png"
    }
  };

  const config = characterConfig[character] || characterConfig["Ghost Dad"];

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York'
  });

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{
        author: {
          name: `${config.emoji} ${character}`,
          icon_url: config.headshot
        },
        description: message,
        color: config.color,
        footer: { text: `via The Floor • ${timestamp}` }
      }]
    })
  });
}

async function saveToChat(character, message) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) return;

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
      created_at: new Date().toISOString()
    })
  });
}
