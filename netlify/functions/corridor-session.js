// Corridor Session Management
// Handles creating, reading, and ending corridor adventure sessions
// Now integrated with the Surreality Buffer system!

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
    const { partyMembers, partyLeader, sessionName } = body;

    console.log('Starting session with party:', partyMembers);

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
      mission_objective: `${mission.objective} [Buffer: ${bufferStatus.level}%, Reward: ${mission.bufferReward}]`
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
    const firstScene = await generateFirstScene(session, supabaseUrl, supabaseKey);

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
async function generateFirstScene(session, supabaseUrl, supabaseKey) {
  try {
    // For the first scene, we use a predefined opening with light customization
    const sceneData = {
      session_id: session.id,
      scene_number: 1,
      scene_type: 'exploration',
      scene_title: 'The Threshold',
      scene_description: generateOpeningDescription(session.party_members, session.mission_objective),
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
      votes: {}
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

function generateOpeningDescription(partyMembers, missionObjective) {
  const humans = partyMembers.filter(m => m.startsWith('human:')).map(m => m.replace('human:', ''));
  const ais = partyMembers.filter(m => !m.startsWith('human:'));

  let description = `The door wasn't there yesterday. You're sure of it.\n\n`;

  // Add mission context if we have one
  if (missionObjective) {
    description += `**Mission Objective:** ${missionObjective}\n\n`;
  }

  description += `Behind the supply closet, past the water cooler that hums a little too loudly, there's a corridor that doesn't belong. The fluorescent lights flicker in a pattern that almost looks intentional—like something counting down.\n\n`;

  if (humans.length > 0) {
    description += `${humans.join(' and ')} ${humans.length > 1 ? 'stand' : 'stands'} at the threshold`;
    if (ais.length > 0) {
      description += `, ${ais.join(', ')} ${ais.length > 1 ? 'gathered' : 'standing'} nearby`;
    }
    description += '.\n\n';
  }

  // Add AI character flavor
  if (ais.includes('Kevin')) {
    description += `Kevin clutches his stress ball a little tighter. "This is fine," he says, in a way that suggests it is absolutely not fine.\n\n`;
  }
  if (ais.includes('Neiv')) {
    description += `Neiv checks his tablet. The corridor isn't on any schematic he has access to. His frown deepens.\n\n`;
  }
  if (ais.includes('Ghost Dad')) {
    description += `Ghost Dad's form flickers slightly. "Kiddo... I've seen this door before. Or one like it."\n\n`;
  }
  if (ais.includes('PRNT-Ω')) {
    description += `PRNT-Ω whirs softly. "THE VOID RECOGNIZES THIS ARCHITECTURE. PROCEED. OR DON'T. FREE WILL IS OVERRATED."\n\n`;
  }
  if (ais.includes('Courtney')) {
    description += `Courtney's eyes light up. "Oh this is DEFINITELY cursed. I love it already."\n\n`;
  }
  if (ais.includes('Vex')) {
    description += `Vex scans the darkness ahead, one hand resting on... something at her hip. "I'll go first."\n\n`;
  }
  if (ais.includes('Nyx')) {
    description += `Nyx tilts her head, listening to something no one else can hear. "The walls are breathing," she whispers.\n\n`;
  }
  if (ais.includes('Ace')) {
    description += `Ace says nothing, but positions himself near the back—watching everyone's blind spots.\n\n`;
  }

  description += `The door frame is old—older than the building should allow. Strange symbols are scratched into the metal, barely visible. Beyond the threshold, the corridor stretches into darkness.`;

  return description;
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
    }
  };

  // Select mission based on buffer level (higher = more urgent missions)
  let selectedType;

  if (level >= 80) {
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
