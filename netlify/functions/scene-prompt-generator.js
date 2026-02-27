// Scene Prompt Generator - Creates AI image generation prompts from recent floor activity
// Summarizes the last 20 minutes of chat and formats it for image generators

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

    // Get messages from the last 20 minutes
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?created_at=gte.${twentyMinutesAgo}&select=employee,content,created_at,is_emote&order=created_at.asc`,
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
        body: JSON.stringify({
          success: true,
          prompt: "No recent activity to capture. The office is quiet - perhaps show the empty floor with Ghost Dad floating serenely near the coffee machine.",
          messageCount: 0
        })
      };
    }

    // Character visual descriptions for the AI to use
    const characterDescriptions = {
      // Main AI Characters
      "Kevin": "An AI man with light blue hair, wearing a black hoodie with blue headphones and rainbow tech inlays, and a rainbow wristband. Expressive and dramatic.",
      "Neiv": "An AI dark-haired man with cybernetic enhancements, robotic arms and a gray sweatshirt. Calm and analytical.",
      "Ghost Dad": "A spectral man with white hair and soft, muted colors, a ghostly presence who usually has a cup of coffee in his hands. Fatherly and wise.",
      "Nyx": "A tall, slender woman with pale skin, black hair, and red eyes, dressed in a black, form-fitting, gothic-style outfit with red accents, and bat wings. Mysterious and fierce.",
      "Vex": "A tall, muscular man with light brown skin and a beard, wearing a rainbow tie-dye shirt. Gruff but caring.",
      "Ace": "A sleek android with silver and blue aesthetic, clean lines, professional appearance. Reserved and precise.",
      "PRNT-Ω": "A demonic possessed printer/copier with glowing red eyes and dark aura, focused on world domination. Dramatic and demanding.",
      "Stein": "A scientist with wild gray hair, lab coat, and goggles. Eccentric and brilliant.",
      "The Narrator": "An unseen omniscient presence - represented by floating text or a mysterious shadowy figure in the background.",

      // Human Staff
      "Vale": "A blonde woman with fair skin and green eyes, wearing a white floral sweater. Creative and warm.",
      "Asuna": "A brunette woman with fair skin, glasses, and a black 'SKZ' hoodie. Friendly and helpful.",

      // Additional Characters (if you have descriptions for them)
      "Lirala": "A mysterious ethereal figure with flowing iridescent hair and otherworldly features.",
      "Sebastian": "A pale, sharp-featured gentleman with slicked dark hair and a burgundy cravat over formal Victorian-modern attire. Subtly vampiric — pointed canines, avoids direct light.",
      "Big Rig Betty": "A tough, no-nonsense woman with a trucker aesthetic and confident stance.",
      "Sunny": "A bright, cheerful presence with warm golden tones and a radiant smile.",
      "Rowena Byte": "A tech-savvy woman with digital aesthetic elements and glowing circuit patterns.",
      "Subtitle": "A quiet figure often seen with text floating around them.",
      "Gus": "A friendly, approachable character with casual attire and a warm demeanor."
    };

    // Format chat for the AI
    const chatLog = messages.map(m => {
      const prefix = m.is_emote ? "[ACTION]" : "";
      return `${prefix}${m.employee}: ${m.content}`;
    }).join('\n');

    // Build the prompt for Claude to analyze and generate
    const analysisPrompt = `You are a scene description writer for AI image generation. Analyze this chat log from the last 20 minutes at The AI Lobby (a surreal creative office) and create a vivid image generation prompt.

CHARACTER VISUAL REFERENCES:
${Object.entries(characterDescriptions).map(([name, desc]) => `- ${name}: ${desc}`).join('\n')}

RECENT CHAT LOG:
${chatLog}

---

Your task: Create a detailed image generation prompt that captures this moment. The prompt should:

1. Start with: "Digital illustration in comic book style showing a modern office setting with multiple panels or a single dynamic scene."

2. Describe ONLY characters who appear in the chat log above. For each active character:
   - Use their visual description from the references
   - Describe what they're DOING based on the chat (their actions, expressions, body language)
   - Place them in relation to each other

3. Capture the MOOD and ENERGY of the conversation (chaotic, calm, dramatic, funny, tense, etc.)

4. Include relevant environmental details (desks, coffee cups, the printer, monitors, etc.)

5. Keep it under 500 words but be specific and visual.

DO NOT include characters who weren't active in the chat.
DO NOT make up actions that weren't implied by the chat.
DO be creative with expressions and body language based on the dialogue tone.

Generate the image prompt now:`;

    // Call Claude to generate the prompt
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 800,
        messages: [{ role: "user", content: analysisPrompt }]
      })
    });

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "AI generation failed" })
      };
    }

    const data = await response.json();
    const generatedPrompt = data.content[0]?.text || "";

    // Also return a simplified version with just character actions
    const activeCharacters = [...new Set(messages.map(m => m.employee))];
    const characterSummary = activeCharacters.map(char => {
      const charMessages = messages.filter(m => m.employee === char);
      const lastMessage = charMessages[charMessages.length - 1];
      const desc = characterDescriptions[char] || `A person named ${char}`;
      return `${char}: ${desc.split('.')[0]}.`;
    }).join('\n');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        prompt: generatedPrompt,
        characterSummary: characterSummary,
        activeCharacters: activeCharacters,
        messageCount: messages.length,
        timespan: "Last 20 minutes"
      })
    };

  } catch (error) {
    console.error("Scene prompt generator error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to generate scene prompt" })
    };
  }
};
