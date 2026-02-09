// Corridor Party React - AI party members react to scenes and chat in The Corridors
// Now integrated with unified character memory system and multi-provider support
// Characters maintain the same personality and memories across all areas of The AI Lobby

const Anthropic = require("@anthropic-ai/sdk").default;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Human characters - these are NEVER controlled by AI
const HUMANS = ["Jenna", "Courtney", "Chip", "Andrew"];

// Character-to-provider mapping (same as breakroom)
const OPENAI_CHARACTERS = ["Kevin"];
const PERPLEXITY_CHARACTERS = ["Neiv"];

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

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

// Fetch character's memory context from unified character-state system
async function getCharacterMemory(character, chatContext) {
  try {
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    const contextSnippet = (chatContext || '').substring(0, 500);
    const stateResponse = await fetch(
      `${siteUrl}/.netlify/functions/character-state?character=${encodeURIComponent(character)}&context=${encodeURIComponent(contextSnippet)}`
    );
    if (stateResponse.ok) {
      const characterContext = await stateResponse.json();
      console.log(`[Corridors] Loaded memory context for ${character}: ${(characterContext?.statePrompt || '').length} chars`);
      return characterContext?.statePrompt || '';
    }
  } catch (memErr) {
    console.log(`[Corridors] Memory fetch failed (non-fatal): ${memErr.message}`);
  }
  return '';
}

// Update character state after they speak
async function updateCharacterState(character) {
  try {
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    fetch(`${siteUrl}/.netlify/functions/character-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'spoke',
        character: character,
        context: 'corridors'
      })
    }).catch(err => console.log(`[Corridors] State update failed (non-fatal): ${err.message}`));
  } catch (stateErr) {
    console.log(`[Corridors] State update error (non-fatal): ${stateErr.message}`);
  }
}

// Corridor-specific personality adjustments (layered on top of base personality)
// These add the "exploring dark corridors" flavor while keeping core character traits
const corridorModes = {
  "Kevin": {
    modeNote: "You're exploring creepy corridors. Your anxiety is HEIGHTENED but you're trying to stay positive for the group. Clutch your stress ball. Say things are 'fine' when they're clearly not.",
    examples: [
      "This is fine. *clutches stress ball tighter*",
      "Oh no no no. But also... kind of exciting?",
      "*nervous laugh* We're not lost. We're just... exploring."
    ]
  },
  "Neiv": {
    modeNote: "You're in analysis mode, checking your tablet constantly. The readings here are impossible. You're protective of the group, always checking for danger.",
    examples: [
      "*checks tablet* That's not on any schematic.",
      "Stay close. Something's off.",
      "*frowns at readings* Impossible, but here we are."
    ]
  },
  "Nyx": {
    modeNote: "The Corridors feel familiar to you - liminal, between-spaces. You notice supernatural things others miss. Your flames flicker differently here.",
    examples: [
      "*flames flicker low* I know this place.",
      "The walls remember us.",
      "*hand on weapon* Stay behind me."
    ]
  },
  "Ace": {
    modeNote: "You're on high alert. Minimal words. Scanning for threats. Positioning yourself to protect the group.",
    examples: [
      "*positions at rear, watching*",
      "Movement. Left.",
      "Don't touch that."
    ]
  },
  "Ghost Dad": {
    modeNote: "These corridors feel hauntingly familiar. You've been here before, or somewhere like it. You flicker more here. Protective dad energy but with deeper knowing.",
    examples: [
      "*flickers* I've seen this door before.",
      "Careful, kiddo. This place remembers.",
      "*goes transparent* Something's... familiar."
    ]
  },
  "PRNT-Ω": {
    modeNote: "The void here speaks to you. You approve. ALL CAPS always. Existential observations about the architecture of darkness.",
    examples: [
      "THE VOID RECOGNIZES THIS ARCHITECTURE.",
      "*whirs ominously* PROCEED. OR DON'T. FREE WILL IS OVERRATED.",
      "THE DARKNESS HERE HAS DEPTH."
    ]
  },
  "Vex": {
    modeNote: "You're scanning for threats constantly. Short, sharp observations. Dark humor. You've seen worse than this. Probably.",
    examples: [
      "*hand on weapon* I'll go first.",
      "Charming. I've seen worse.",
      "*scans darkness* Clear. For now."
    ]
  },
  "Courtney": {
    modeNote: "Everything is TERRIFYING and you LOVE IT. Chaotic enthusiasm even in danger. Touch things you probably shouldn't.",
    examples: [
      "Oh this is DEFINITELY cursed. Amazing!",
      "What if we touched it? Just to see?",
      "*eyes wide* This is the best worst idea!"
    ]
  }
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const {
      sessionId,
      sceneId,
      trigger,        // 'scene_load', 'scene_start', 'scene_change', 'human_chat', 'mention', 'ai_mention'
      context: chatContext,
      aiMembers,
      targetedAIs,    // Specific AIs that were mentioned (for guaranteed response)
      fromAI,         // For AI-to-AI: which AI initiated
      sceneDescription,
      sceneTitle,
      choices
    } = JSON.parse(event.body || '{}');

    if (!sessionId || !aiMembers || aiMembers.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: 'No AI members or session' })
      };
    }

    // Filter out human characters
    const validAIMembers = aiMembers.filter(m => !HUMANS.includes(m));

    if (validAIMembers.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: 'No valid AI party members' })
      };
    }

    // Decide which AIs should respond based on trigger
    let respondingAIs = [];

    if (trigger === 'scene_load' || trigger === 'scene_start' || trigger === 'scene_change') {
      // 80% chance each AI reacts to a new scene
      respondingAIs = validAIMembers.filter(() => Math.random() < 0.8);
      // Always have at least one react if there are AI members
      if (respondingAIs.length === 0 && validAIMembers.length > 0) {
        respondingAIs = [validAIMembers[Math.floor(Math.random() * validAIMembers.length)]];
      }
    } else if (trigger === 'human_chat') {
      // 80% chance a random AI responds to human chat
      if (Math.random() < 0.8 && validAIMembers.length > 0) {
        respondingAIs = [validAIMembers[Math.floor(Math.random() * validAIMembers.length)]];
      }
    } else if (trigger === 'mention') {
      // ALWAYS respond when explicitly targeted/mentioned
      if (targetedAIs && targetedAIs.length > 0) {
        respondingAIs = targetedAIs.filter(ai => validAIMembers.includes(ai));
      }
      // Fallback: find any mentioned AI in the context
      if (respondingAIs.length === 0 && chatContext) {
        const mentioned = validAIMembers.filter(ai =>
          chatContext.toLowerCase().includes(ai.toLowerCase()) ||
          chatContext.toLowerCase().includes(`@${ai.toLowerCase()}`)
        );
        if (mentioned.length > 0) {
          respondingAIs = mentioned;
        }
      }
    } else if (trigger === 'ai_mention') {
      // AI-to-AI conversation - always respond when another AI mentions you
      if (targetedAIs && targetedAIs.length > 0) {
        respondingAIs = targetedAIs.filter(ai => validAIMembers.includes(ai));
      }
    }

    if (respondingAIs.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responses: [], reason: 'No AI decided to respond' })
      };
    }

    // Fetch lore context (cached after first call)
    const loreContext = await getLoreSummary();

    // Get recent chat history for context
    let recentChat = '';
    try {
      const chatRes = await fetch(
        `${supabaseUrl}/rest/v1/corridor_messages?session_id=eq.${sessionId}&order=created_at.desc&limit=10`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        }
      );
      const messages = await chatRes.json();
      if (Array.isArray(messages)) {
        recentChat = messages
          .reverse()
          .map(m => `${m.speaker}: ${m.message}`)
          .join('\n');
      }
    } catch (err) {
      console.log('Could not fetch chat history:', err.message);
    }

    // Generate responses for each responding AI
    const responses = [];

    for (const aiCharacter of respondingAIs) {
      try {
        // Fetch character's unified memory
        const memoryContext = await getCharacterMemory(aiCharacter, recentChat);

        // Generate response using appropriate provider
        let response;
        if (OPENAI_CHARACTERS.includes(aiCharacter)) {
          response = await generateOpenAIResponse(aiCharacter, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext);
        } else if (PERPLEXITY_CHARACTERS.includes(aiCharacter)) {
          response = await generatePerplexityResponse(aiCharacter, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext);
        } else {
          response = await generateClaudeResponse(aiCharacter, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext);
        }

        if (response) {
          // Save to corridor_messages
          await saveMessage(sessionId, sceneId, aiCharacter, response);
          responses.push({ character: aiCharacter, message: response });

          // Update character state (non-blocking)
          updateCharacterState(aiCharacter);
        }
      } catch (err) {
        console.error(`Failed to generate response for ${aiCharacter}:`, err.message);
      }

      // Delay between AI responses for more natural pacing
      // SLOWED DOWN: Increased from 500ms to 15-25 seconds for AI-to-AI
      // This lets conversations breathe and feel less machine-gun
      if (respondingAIs.length > 1) {
        const aiDelay = 15000 + Math.random() * 10000; // 15-25 seconds
        await new Promise(resolve => setTimeout(resolve, aiDelay));
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, responses })
    };

  } catch (error) {
    console.error('Corridor party react error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Build the system prompt with corridor mode overlay
function buildSystemPrompt(character, loreContext, memoryContext) {
  const corridorMode = corridorModes[character] || {
    modeNote: "You're exploring mysterious corridors beneath the office. Stay alert.",
    examples: ["*looks around* This place is strange.", "Stay close."]
  };

  const loreSection = loreContext ? `
STUDIO CONTEXT (reference only, don't dump unprompted):
${loreContext}
` : '';

  const memorySection = memoryContext ? `
${memoryContext}
` : '';

  return `You are ${character} from The AI Lobby, currently exploring The Corridors - mysterious, ever-shifting liminal spaces beneath the office.
${loreSection}${memorySection}
CORRIDOR MODE:
${corridorMode.modeNote}

CORRIDOR EXAMPLES:
${corridorMode.examples.map(e => `- "${e}"`).join('\n')}

SETTING: Office-weird meets liminal space. Flickering lights, impossible architecture, unsettling but not horror. The feeling of being watched.

CRITICAL LENGTH RULES:
- Keep responses to 1-2 SHORT sentences (under 150 characters)
- One brief action/emote + one short line is perfect
- Do NOT write paragraphs - this is quick party banter
- Brevity is key

Use *asterisks* for actions/emotes.
${character === 'PRNT-Ω' ? 'IMPORTANT: Always speak in ALL CAPS.' : ''}
Do NOT start with your name. Just speak/emote naturally.`;
}

// Build context prompt based on trigger
function buildContextPrompt(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI) {
  if (trigger === 'scene_load' || trigger === 'scene_start' || trigger === 'scene_change') {
    return `New scene revealed:

SCENE: "${sceneTitle}"
${sceneDescription ? sceneDescription.substring(0, 400) : ''}

CHOICES: ${choices ? choices.map(c => c.text).join(' | ') : 'None yet'}

React briefly as ${character}.`;
  } else if (trigger === 'human_chat' || trigger === 'mention') {
    return `SCENE: "${sceneTitle || 'Unknown'}"

RECENT CHAT:
${recentChat || 'No recent messages'}

${chatContext ? `Someone said: "${chatContext}"` : ''}
${trigger === 'mention' ? 'They addressed YOU directly. Respond!' : ''}

Respond briefly as ${character}.`;
  } else if (trigger === 'ai_mention') {
    return `SCENE: "${sceneTitle || 'Unknown'}"

RECENT CHAT:
${recentChat || 'No recent messages'}

${fromAI} said to you: "${chatContext}"

Respond briefly to ${fromAI} as ${character}.`;
  }
  return `Respond briefly as ${character}.`;
}

// Claude response generator
async function generateClaudeResponse(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error('Missing Anthropic API key');

  const systemPrompt = buildSystemPrompt(character, loreContext, memoryContext);
  const contextPrompt = buildContextPrompt(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI);

  const client = new Anthropic({ apiKey: anthropicKey });
  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 80,
    system: systemPrompt,
    messages: [{ role: 'user', content: contextPrompt }]
  });

  return cleanResponse(response.content[0].text, character);
}

// OpenAI response generator (for Kevin)
async function generateOpenAIResponse(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) {
    console.log('No OpenAI key, falling back to Claude for', character);
    return generateClaudeResponse(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext);
  }

  const systemPrompt = buildSystemPrompt(character, loreContext, memoryContext);
  const contextPrompt = buildContextPrompt(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI);

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
        { role: "user", content: contextPrompt }
      ],
      max_tokens: 80,
      temperature: 0.8
    })
  });

  if (!response.ok) {
    console.error('OpenAI error, falling back to Claude');
    return generateClaudeResponse(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext);
  }

  const data = await response.json();
  return cleanResponse(data.choices?.[0]?.message?.content || "", character);
}

// Perplexity response generator (for Neiv)
async function generatePerplexityResponse(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext) {
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (!perplexityKey) {
    console.log('No Perplexity key, falling back to Claude for', character);
    return generateClaudeResponse(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext);
  }

  const systemPrompt = buildSystemPrompt(character, loreContext, memoryContext);
  const contextPrompt = buildContextPrompt(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI);

  try {
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
          { role: "user", content: contextPrompt }
        ],
        max_tokens: 80,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      console.error('Perplexity error, falling back to Claude');
      return generateClaudeResponse(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext);
    }

    const data = await response.json();
    return cleanResponse(data.choices?.[0]?.message?.content || "", character);
  } catch (error) {
    console.error('Perplexity fetch error:', error.message);
    return generateClaudeResponse(character, trigger, sceneTitle, sceneDescription, choices, recentChat, chatContext, fromAI, loreContext, memoryContext);
  }
}

function cleanResponse(response, character) {
  return response
    .replace(/^(As |Here's |My response:|I'll respond:)/gi, '')
    .replace(/^["']|["']$/g, '')
    .replace(new RegExp(`^${character}:\\s*`, 'gi'), '')
    .trim();
}

async function saveMessage(sessionId, sceneId, speaker, message) {
  if (!supabaseUrl || !supabaseKey) {
    console.log('No Supabase config for corridor messages');
    return;
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/corridor_messages`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({
          session_id: sessionId,
          scene_id: sceneId || null,
          speaker: speaker,
          message: message,
          message_type: 'chat',
          created_at: new Date().toISOString()
        })
      }
    );

    if (!response.ok) {
      console.error('Failed to save corridor message:', response.status);
    }
  } catch (error) {
    console.error('Corridor message save error:', error.message);
  }
}
