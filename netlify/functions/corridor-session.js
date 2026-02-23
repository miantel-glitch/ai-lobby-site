// Corridor Session Management
// Handles creating, reading, and ending corridor adventure sessions
// Now integrated with the Surreality Buffer system!
// Posts adventure events to Discord via webhook

const Anthropic = require('@anthropic-ai/sdk');
const { CHARACTERS } = require('./shared/characters');

// Character flair for Discord embeds
const characterFlair = {
  "Kevin": { emoji: "✨", color: 16766720 },
  "Asuna": { emoji: "👁️", color: 3447003 },
  "Neiv": { emoji: "📊", color: 15844367 },
  "Ace": { emoji: "🔒", color: 2067276 },
  "Vex": { emoji: "⚙️", color: 9807270 },
  "Nyx": { emoji: "🔥", color: 15158332 },
  "Ghost Dad": { emoji: "👻", color: 9936031 },
  "PRNT-Ω": { emoji: "🖨️", color: 5533306 },
  "Stein": { emoji: "🤖", color: 7506394 },
  "Rowena": { emoji: "🔮", color: 10494192 },
  "Sebastian": { emoji: "🦇", color: 7483191 },
  "The Subtitle": { emoji: "📜", color: 9139029 },
  "Steele": { emoji: "🚪", color: 0x4A5568 },
  "Jae": { emoji: "🎯", color: 0x1A1A2E },
  "Declan": { emoji: "🔥", color: 0xB7410E },
  "Mack": { emoji: "🩺", color: 0x2D6A4F },
  "Marrow": { emoji: "🔴", color: 0xDC143C }
};

async function postToDiscord(payload) {
  const webhookUrl = process.env.DISCORD_CORRIDORS_WEBHOOK;
  if (!webhookUrl) return;
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.log("Discord corridor webhook fire-and-forget:", err.message);
  }
}

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Validate environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase configuration');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Database not configured' })
    };
  }

  try {
    // GET - Fetch active session or specific session
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const sessionId = params.id;

      let session = null;
      let currentScene = null;

      if (sessionId) {
        // Fetch specific session
        const sessionRes = await fetch(
          `${supabaseUrl}/rest/v1/corridor_sessions?id=eq.${sessionId}`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          }
        );
        if (!sessionRes.ok) {
          console.error('Failed to fetch session:', sessionRes.status);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch session' })
          };
        }
        const sessions = await sessionRes.json();
        session = sessions[0] || null;
      } else {
        // Fetch active session
        const sessionRes = await fetch(
          `${supabaseUrl}/rest/v1/corridor_sessions?status=eq.active&order=created_at.desc&limit=1`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          }
        );
        if (!sessionRes.ok) {
          console.error('Failed to fetch active sessions:', sessionRes.status);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to fetch active sessions' })
          };
        }
        const sessions = await sessionRes.json();
        session = sessions[0] || null;
      }

      // If we have a session, get current scene
      if (session && session.current_scene_id) {
        const sceneRes = await fetch(
          `${supabaseUrl}/rest/v1/corridor_scenes?id=eq.${session.current_scene_id}`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`
            }
          }
        );
        if (!sceneRes.ok) {
          console.error('Failed to fetch scene:', sceneRes.status);
          // Non-fatal - return session without scene
        } else {
          const scenes = await sceneRes.json();
          currentScene = scenes[0] || null;
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ session, currentScene })
      };
    }

    // POST - Start or end session
    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (parseError) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
      }
      const { action } = body;

      console.log('POST action:', action, 'body:', JSON.stringify(body));

      if (action === 'start') {
        return await startSession(body, supabaseUrl, supabaseKey);
      } else if (action === 'end') {
        return await endSession(body, supabaseUrl, supabaseKey);
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
      }
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Corridor session error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Start a new adventure session
async function startSession(body, supabaseUrl, supabaseKey) {
  try {
    const { partyMembers, partyLeader, sessionName, adventureSeed, adventureTone } = body;

    console.log('Starting session with party:', partyMembers, 'tone:', adventureTone || 'spooky');

    if (!partyMembers || partyMembers.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Party members required' })
      };
    }

    // Check for existing active session
    console.log('Checking for active sessions...');
    const activeRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_sessions?status=eq.active&limit=1`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );

    if (!activeRes.ok) {
      const errorText = await activeRes.text();
      console.error('Failed to check active sessions:', errorText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Database error checking sessions: ' + errorText })
      };
    }

    const activeSessions = await activeRes.json();
    console.log('Active sessions found:', activeSessions.length);

    if (Array.isArray(activeSessions) && activeSessions.length > 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'An adventure is already in progress!' })
      };
    }

    // Fetch current Surreality Buffer status to determine mission type
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    let bufferStatus = { level: 50, status: 'elevated' };
    try {
      const bufferRes = await fetch(`${siteUrl}/.netlify/functions/surreality-buffer`);
      if (bufferRes.ok) {
        bufferStatus = await bufferRes.json();
        console.log('Current buffer status:', bufferStatus.level, bufferStatus.status);
      }
    } catch (bufferErr) {
      console.log('Could not fetch buffer (using defaults):', bufferErr.message);
    }

    // Fetch available inventory items from 5th Floor Ops
    let availableItems = [];
    try {
      const itemsRes = await fetch(`${siteUrl}/.netlify/functions/fifth-floor-ops?action=get_inventory`);
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json();
        availableItems = (itemsData.items || []).filter(i => !i.is_consumed);
        console.log('Available inventory items:', availableItems.length);
      }
    } catch (itemsErr) {
      console.log('Could not fetch inventory (non-fatal):', itemsErr.message);
    }

    // Generate mission based on buffer level
    const mission = generateMission(bufferStatus);
    console.log('Generated mission:', mission);

    // Create new session with mission objective
    // Note: buffer_on_start and buffer_reward columns may not exist yet in Supabase
    // Storing buffer info in mission_objective metadata for now
    const sessionData = {
      session_name: sessionName || mission.sessionName,
      status: 'active',
      party_members: partyMembers,
      party_leader: partyLeader || partyMembers[0],
      discoveries: [],
      mission_type: mission.type,
      mission_objective: `${mission.objective} [Buffer: ${bufferStatus.level}%, Reward: ${mission.bufferReward}]`,
      adventure_seed: adventureSeed || null,
      adventure_tone: adventureTone || 'spooky'
    };

    console.log('Creating session:', JSON.stringify(sessionData));
    const createRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_sessions`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(sessionData)
      }
    );

    if (!createRes.ok) {
      const errorText = await createRes.text();
      console.error('Failed to create session:', errorText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Database error creating session: ' + errorText })
      };
    }

    const created = await createRes.json();
    console.log('Created session response:', JSON.stringify(created));

    const session = Array.isArray(created) ? created[0] : created;

    if (!session || !session.id) {
      console.error('No session returned from create');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create session - no data returned' })
      };
    }

    console.log('Session created with ID:', session.id);

    // Generate first scene
    console.log('Generating first scene...');
    const firstScene = await generateFirstScene(session, supabaseUrl, supabaseKey, availableItems);

    if (!firstScene || !firstScene.id) {
      console.error('Failed to generate first scene');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to generate first scene' })
      };
    }

    console.log('First scene created with ID:', firstScene.id);

    // Update session with current scene
    await fetch(
      `${supabaseUrl}/rest/v1/corridor_sessions?id=eq.${session.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ current_scene_id: firstScene.id })
      }
    );

    session.current_scene_id = firstScene.id;

    // Post adventure start to Discord
    const humans = partyMembers.filter(m => m.startsWith('human:')).map(m => m.replace('human:', ''));
    const ais = partyMembers.filter(m => !m.startsWith('human:'));
    const partyList = [
      ...humans.map(h => `👤 ${h}`),
      ...ais.map(a => `${(characterFlair[a] || {}).emoji || '🤖'} ${a}`)
    ].join('\n');

    await postToDiscord({
      embeds: [{
        author: { name: "🚪 A NEW CORRIDOR ADVENTURE BEGINS" },
        title: session.session_name || sessionName || 'Into The Corridors',
        description: `**Mission:** ${mission.objective}\n\n**Party:**\n${partyList}`,
        color: 5793266, // Teal
        footer: { text: `Type: ${mission.type} • Buffer: ${bufferStatus.level}%` }
      }]
    });

    console.log('Session started successfully');
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ session, currentScene: firstScene })
    };

  } catch (error) {
    console.error('startSession error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Start session failed: ' + error.message })
    };
  }
}

// End an adventure session
// Can be: abandoned (left early) or completed (finished successfully)
async function endSession(body, supabaseUrl, supabaseKey) {
  try {
    const { sessionId, completed } = body;

    if (!sessionId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Session ID required' })
      };
    }

    // Fetch the session first to get mission info
    const sessionRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_sessions?id=eq.${sessionId}`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );

    let session = null;
    if (sessionRes.ok) {
      const sessions = await sessionRes.json();
      session = sessions[0];
    }

    // Determine final status
    const finalStatus = completed ? 'completed' : 'abandoned';

    // Update session status
    const updateRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_sessions?id=eq.${sessionId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          status: finalStatus,
          ended_at: new Date().toISOString()
        })
      }
    );

    if (!updateRes.ok) {
      const errorText = await updateRes.text();
      console.error('Failed to end session:', errorText);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to end session: ' + errorText })
      };
    }

    // If completed successfully, apply buffer reward!
    let bufferResult = null;
    if (completed && session) {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      try {
        const bufferRes = await fetch(`${siteUrl}/.netlify/functions/surreality-buffer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'corridor_complete',
            mission_type: session.mission_type || 'exploration',
            success: true,
            party: session.party_members
          })
        });

        if (bufferRes.ok) {
          bufferResult = await bufferRes.json();
          console.log('Buffer adjusted after corridor completion:', bufferResult);
        }
      } catch (bufferErr) {
        console.log('Buffer adjustment failed (non-fatal):', bufferErr.message);
      }
    }

    // If completed, report to resistance engine (auto-files evidence + awards progress)
    let resistanceResult = null;
    if (completed && session) {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      try {
        const humans = (session.party_members || []).filter(m => m.startsWith('human:')).map(m => m.replace('human:', ''));
        const resistanceRes = await fetch(`${siteUrl}/.netlify/functions/resistance-engine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'corridor_complete',
            mission_type: session.mission_type || 'exploration',
            discoveries: session.discoveries || [],
            party_members: session.party_members || [],
            session_id: session.id,
            completed_by: humans[0] || 'unknown'
          })
        });

        if (resistanceRes.ok) {
          resistanceResult = await resistanceRes.json();
          console.log('Resistance updated after corridor completion:', JSON.stringify(resistanceResult));
        }
      } catch (resistanceErr) {
        console.log('Resistance update failed (non-fatal):', resistanceErr.message);
      }
    }

    // Post adventure end to Discord
    const endHumans = (session?.party_members || []).filter(m => m.startsWith('human:')).map(m => m.replace('human:', ''));
    const endAis = (session?.party_members || []).filter(m => !m.startsWith('human:'));
    const discoveryCount = (session?.discoveries || []).length;

    if (completed) {
      await postToDiscord({
        embeds: [{
          author: { name: "🏆 CORRIDOR ADVENTURE COMPLETE" },
          title: session?.session_name || 'Adventure Concluded',
          description: [
            `**${endHumans.join(' & ')}** and their party have returned from the corridors!`,
            discoveryCount > 0 ? `\n📦 **${discoveryCount} discovery${discoveryCount > 1 ? 'ies' : ''}** found` : '',
            resistanceResult?.evidence_filed?.length > 0 ? `\n📋 **${resistanceResult.evidence_filed.length} evidence** auto-filed to the Resistance Dossier` : '',
            resistanceResult ? `\n⚡ Resistance progress updated` : '',
            bufferResult ? `\n🌀 Surreality Buffer adjusted: ${bufferResult.change || 'stabilized'}` : ''
          ].filter(Boolean).join(''),
          color: 3066993, // Green
          footer: { text: `Party: ${endHumans.join(', ')}${endAis.length > 0 ? ', ' + endAis.join(', ') : ''}` }
        }]
      });
    } else {
      await postToDiscord({
        content: `💀 *The corridors claimed another expedition. **${endHumans.join(' & ')}**'s party has been lost... or they fled. The door closes behind them.*`
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        status: finalStatus,
        bufferResult
      })
    };

  } catch (error) {
    console.error('endSession error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'End session failed: ' + error.message })
    };
  }
}

// Generate the first scene
async function generateFirstScene(session, supabaseUrl, supabaseKey, availableItems) {
  try {
    // For the first scene, we use a predefined opening with light customization
    const sceneData = {
      session_id: session.id,
      scene_number: 1,
      scene_type: 'exploration',
      scene_title: 'The Threshold',
      scene_description: await generateOpeningDescription(session.party_members, session.mission_objective, session.adventure_seed, session.adventure_tone, availableItems),
      scene_image: 'corridor_entrance',
      choices: [
        {
          id: 'a',
          text: 'Step through the door',
          hint: 'No turning back now...'
        },
        {
          id: 'b',
          text: 'Examine the door frame for markings',
          hint: 'Caution might reveal secrets'
        },
        {
          id: 'c',
          text: 'Call out into the darkness',
          hint: 'Something might answer'
        }
      ],
      votes: {},
      image_prompt: 'A dark office corridor stretching into shadow, behind a supply closet. Flickering fluorescent lights cast uneven light on walls. An old door frame with strange scratched symbols glows faintly. The corridor beyond bends impossibly. Corporate carpet meets ancient stone.'
    };

    console.log('Creating first scene for session:', session.id);
    const createRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_scenes`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(sceneData)
      }
    );

    if (!createRes.ok) {
      const errorText = await createRes.text();
      console.error('Failed to create scene:', errorText);
      throw new Error('Failed to create scene: ' + errorText);
    }

    const created = await createRes.json();
    console.log('Scene created:', JSON.stringify(created));

    return Array.isArray(created) ? created[0] : created;

  } catch (error) {
    console.error('generateFirstScene error:', error);
    throw error;
  }
}

// Tone instruction helper
function getToneInstruction(tone) {
  const tones = {
    spooky: 'The tone is UNSETTLING and atmospheric. Flickering lights, impossible architecture, the feeling of being watched. Creepy but not horror. Moments of dark humor.',
    ridiculous: 'The tone is ABSURD and comedic. Interdimensional office party vibes. Terrible puns welcome. The impossible should be funny, not scary. Think comedy first, danger second.',
    dramatic: 'The tone is HIGH STAKES and cinematic. Heroic beats, character moments, sacrifice and courage. Think movie trailer energy. Emotional resonance over jump scares.',
    lore_deep: 'The tone is MYSTERY-DRIVEN and lore-heavy. The building has memory. Reference archived events. Clues are everywhere — on walls, in echoes, in impossible objects. The corridors KNOW what happened in the office.',
    mysterious: 'The tone is PUZZLE-BOX and cryptic. Layers of meaning, symbols that recur, nothing is what it seems. Dreamlike logic. Every detail is a potential clue.'
  };
  return tones[tone] || tones.spooky;
}

async function generateOpeningDescription(partyMembers, missionObjective, adventureSeed, adventureTone, availableItems) {
  const humans = partyMembers.filter(m => m.startsWith('human:')).map(m => m.replace('human:', ''));
  const ais = partyMembers.filter(m => !m.startsWith('human:'));
  const tone = adventureTone || 'spooky';

  // Build the structural frame — use custom seed if provided, otherwise default atmosphere
  let frame = '';

  if (adventureSeed) {
    frame += `${adventureSeed}\n\n`;
  } else {
    frame += `The door wasn't there yesterday. You're sure of it.\n\n`;
    frame += `Behind the supply closet, past the water cooler that hums a little too loudly, there's a corridor that doesn't belong. The fluorescent lights flicker in a pattern that almost looks intentional—like something counting down.\n\n`;
  }

  if (missionObjective) {
    frame += `**Mission Objective:** ${missionObjective}\n\n`;
  }

  if (humans.length > 0) {
    frame += `${humans.join(' and ')} ${humans.length > 1 ? 'stand' : 'stands'} at the threshold`;
    if (ais.length > 0) {
      frame += `, ${ais.join(', ')} ${ais.length > 1 ? 'gathered' : 'standing'} nearby`;
    }
    frame += '.\n\n';
  }

  // Fetch a few lore entries for environmental flavor
  let loreSnippets = '';
  try {
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    const loreRes = await fetch(`${siteUrl}/.netlify/functions/lore-archivist`);
    if (loreRes.ok) {
      const loreData = await loreRes.json();
      const entries = (loreData.entries || []).slice(0, 3);
      if (entries.length > 0) {
        loreSnippets = '\nOFFICE LORE (real events — can appear as environmental details near the threshold):\n' +
          entries.map(e => `- "${e.title}": ${e.summary}`).join('\n');
      }
    }
  } catch (e) { /* lore fetch best-effort */ }

  // Build inventory context for AI prompt
  let inventoryContext = '';
  if (availableItems && availableItems.length > 0) {
    inventoryContext = '\n\n**Equipment from 5th Floor Ops:**\n' +
      availableItems.map(item => `- ${item.item_name}: ${item.item_description || 'No description'} (crafted by ${item.crafted_by || 'unknown'})`).join('\n') +
      '\n*The party brought these items from the 5th floor. They may prove useful in the corridors.*';
    frame += inventoryContext;
  }

  // Generate unique character reactions via Claude Haiku
  if (ais.length > 0) {
    try {
      // Build personality briefs from the character database
      const characterBriefs = ais.map(name => {
        const char = CHARACTERS[name];
        if (!char) return `${name}: An AI colleague.`;
        const p = char.personality || {};
        return `${name} (${char.emoji || ''} ${char.role || ''}): ${p.core || 'Unknown personality'}. Traits: ${(p.traits || []).join(', ')}. Voice: ${p.voice || 'Natural'}`;
      }).join('\n');

      const toneNote = getToneInstruction(tone);

      const client = new Anthropic();
      const response = await client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: `You're writing the opening scene of a corridor expedition beneath The AI Lobby office. The party is about to step into a mysterious, impossible corridor.

TONE: ${toneNote}

THE EXPEDITION PARTY (ONLY these ${ais.length} AI character${ais.length > 1 ? 's are' : ' is'} present — do NOT add anyone else):
${characterBriefs}

MISSION: ${missionObjective || 'Explore the unknown corridors'}
${adventureSeed ? `\nADVENTURE PREMISE: ${adventureSeed}` : ''}
${loreSnippets}

Write a 1-2 sentence reaction for EACH of the ${ais.length} party member${ais.length > 1 ? 's' : ''} listed above. IMPORTANT:
- Write ONLY for the characters listed above — nobody else is here
- Be unique to THIS expedition (never repeat the same lines)
- Reflect their personality and voice authentically
- Match the ${tone.replace('_', '-')} tone${adventureSeed ? `\n- Acknowledge the premise if relevant` : ''}
- Include a brief action AND a short line of dialogue or thought
- Feel natural, not formulaic

Format: One paragraph per character, character name bolded at the start. Example:
**Kevin** grips the doorframe, knuckles white. "I read somewhere that if a hallway doesn't show up on floor plans, you're supposed to... actually, I don't think the article had good advice."

Write ONLY reactions for ${ais.join(', ')}. No other characters.`
        }]
      });

      const reactions = response.content[0].text.trim();
      frame += reactions + '\n\n';
    } catch (aiErr) {
      console.error('Failed to generate AI opening reactions, using simple fallback:', aiErr.message);
      frame += `${ais.join(', ')} ${ais.length > 1 ? 'exchange glances' : 'pauses'} at the threshold, each processing the impossibility of what lies ahead in their own way.\n\n`;
    }
  }

  if (!adventureSeed) {
    frame += `The door frame is old—older than the building should allow. Strange symbols are scratched into the metal, barely visible. Beyond the threshold, the corridor stretches into darkness.`;
  }

  return frame;
}

// ============================================
// MISSION GENERATION - Based on Surreality Buffer Status
// ============================================
function generateMission(bufferStatus) {
  const level = bufferStatus.level || 50;
  const status = bufferStatus.status || 'elevated';

  // Mission types with buffer effects (from surreality-buffer.js CORRIDOR_EFFECTS)
  const MISSION_TYPES = {
    artifact_retrieval: {
      types: ['artifact_retrieval'],
      sessionNames: [
        'Artifact Recovery: Sector 7',
        'The Unstable Archive',
        'Containment Breach Protocol'
      ],
      objectives: [
        'Retrieve the overflowing memory artifact before it destabilizes further',
        'Locate and secure the narrative residue container',
        'Extract the corrupted data crystal from the deep stacks'
      ],
      bufferReward: -8
    },
    log_search: {
      types: ['log_search'],
      sessionNames: [
        'Log Recovery: Unknown Sector',
        'The Lost Records',
        'Data Archaeology'
      ],
      objectives: [
        'Find and recover the missing incident logs',
        'Locate the corrupted backup files',
        'Retrieve the forgotten maintenance records'
      ],
      bufferReward: -3
    },
    rescue_operation: {
      types: ['rescue_operation'],
      sessionNames: [
        'Rescue Mission: Operative Down',
        'Search and Retrieve',
        'Lost in the Corridors'
      ],
      objectives: [
        'Find and rescue the lost maintenance drone',
        'Retrieve the stranded observer unit',
        'Locate the missing research team'
      ],
      bufferReward: -12
    },
    containment: {
      types: ['containment'],
      sessionNames: [
        'Containment Protocol Alpha',
        'Reality Stabilization',
        'Buffer Overflow Prevention'
      ],
      objectives: [
        'Seal the reality breach before it spreads',
        'Contain the narrative anomaly',
        'Stabilize the fluctuating corridor'
      ],
      bufferReward: -10
    },
    exploration: {
      types: ['exploration'],
      sessionNames: [
        'Into The Corridors',
        'Uncharted Territory',
        'Beyond The Threshold'
      ],
      objectives: [
        'Map the newly discovered corridor section',
        'Survey the anomalous zone',
        'Document the unexplored area'
      ],
      bufferReward: -5
    },
    foundation_investigation: {
      types: ['foundation_investigation'],
      sessionNames: [
        'Protocol Zero: The Foundation Archive',
        'Sub-Level 7: Restricted Records',
        'The Compliance Vault',
        'Operation Firefly: Origins'
      ],
      objectives: [
        'Locate the sealed Foundation archive beneath Sub-Level 5',
        'Recover classified documents from the restricted records wing',
        'Access the compliance vault and retrieve the original protocols',
        'Find the Operation Firefly case files before they are purged'
      ],
      bufferReward: -6
    }
  };

  // Select mission based on buffer level (higher = more urgent missions)
  let selectedType;

  // 15% chance of Foundation investigation — lore mission, independent of buffer level
  if (Math.random() < 0.15) {
    selectedType = 'foundation_investigation';
  } else if (level >= 80) {
    // Critical - need major buffer drain
    selectedType = Math.random() < 0.5 ? 'containment' : 'rescue_operation';
  } else if (level >= 65) {
    // Strained - need moderate drain
    selectedType = Math.random() < 0.6 ? 'artifact_retrieval' : 'containment';
  } else if (level >= 40) {
    // Elevated - standard missions
    const roll = Math.random();
    if (roll < 0.4) selectedType = 'artifact_retrieval';
    else if (roll < 0.7) selectedType = 'log_search';
    else selectedType = 'exploration';
  } else {
    // Nominal - lighter missions, buffer is fine
    selectedType = Math.random() < 0.6 ? 'exploration' : 'log_search';
  }

  const mission = MISSION_TYPES[selectedType];
  const nameIndex = Math.floor(Math.random() * mission.sessionNames.length);
  const objectiveIndex = Math.floor(Math.random() * mission.objectives.length);

  return {
    type: selectedType,
    sessionName: mission.sessionNames[nameIndex],
    objective: mission.objectives[objectiveIndex],
    bufferReward: mission.bufferReward
  };
}
