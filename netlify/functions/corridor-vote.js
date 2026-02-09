// Corridor Vote Handler
// Processes votes and triggers scene transitions when all votes are in

const Anthropic = require('@anthropic-ai/sdk');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
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
    // Parse request body with error handling
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

    const { sessionId, sceneId, voterId, choiceId } = body;

    if (!sessionId || !sceneId || !voterId || !choiceId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Get current scene
    const sceneRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_scenes?id=eq.${sceneId}`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );

    if (!sceneRes.ok) {
      console.error('Failed to fetch scene:', sceneRes.status);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch scene' })
      };
    }

    const scenes = await sceneRes.json();
    const scene = scenes[0];

    if (!scene) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Scene not found' })
      };
    }

    if (scene.resolved_at) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Scene already resolved', resolved: true })
      };
    }

    // Get session for party info
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
    const session = sessions[0];

    if (!session) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Session not found' })
      };
    }

    // Update votes
    const votes = scene.votes || {};
    votes[voterId] = choiceId;

    // Save updated votes
    const voteUpdateRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_scenes?id=eq.${sceneId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ votes })
      }
    );

    if (!voteUpdateRes.ok) {
      console.error('Failed to save vote:', voteUpdateRes.status);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to save vote' })
      };
    }

    // Check if all party members have voted (just humans for now)
    const humanVoters = session.party_members.filter(m => m.startsWith('human:'));
    const allHumansVoted = humanVoters.every(h => votes[h] !== undefined);

    // For MVP: resolve when all humans have voted (can add AI voting later)
    if (allHumansVoted) {
      // Tally votes
      const tally = {};
      Object.values(votes).forEach(v => {
        tally[v] = (tally[v] || 0) + 1;
      });

      // Find winner
      const maxVotes = Math.max(...Object.values(tally));
      const winners = Object.keys(tally).filter(k => tally[k] === maxVotes);

      // Tie-breaker: party leader's vote, or first winner
      let chosenOption = winners[0];
      if (winners.length > 1 && votes[session.party_leader]) {
        chosenOption = votes[session.party_leader];
      }

      // Mark scene as resolved
      const resolveRes = await fetch(
        `${supabaseUrl}/rest/v1/corridor_scenes?id=eq.${sceneId}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            chosen_option: chosenOption,
            resolved_at: new Date().toISOString()
          })
        }
      );

      if (!resolveRes.ok) {
        console.error('Failed to resolve scene:', resolveRes.status);
        // Continue anyway - scene generation is more important
      }

      // Generate next scene
      const nextScene = await generateNextScene(session, scene, chosenOption, supabaseUrl, supabaseKey);

      // Update session with new current scene
      const sessionUpdateRes = await fetch(
        `${supabaseUrl}/rest/v1/corridor_sessions?id=eq.${sessionId}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            current_scene_id: nextScene.id,
            updated_at: new Date().toISOString()
          })
        }
      );

      if (!sessionUpdateRes.ok) {
        console.error('Failed to update session with new scene:', sessionUpdateRes.status);
        // Non-fatal - the scene was created, client can poll for it
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          votes,
          resolved: true,
          chosenOption,
          nextSceneId: nextScene.id
        })
      };
    }

    // Not yet resolved
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        votes,
        resolved: false
      })
    };

  } catch (error) {
    console.error('Vote error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Generate the next scene using The Narrator (Claude)
async function generateNextScene(session, previousScene, chosenOption, supabaseUrl, supabaseKey) {
  const client = new Anthropic();

  // Get the chosen choice text
  const chosenChoice = previousScene.choices.find(c => c.id === chosenOption);
  const choiceText = chosenChoice ? chosenChoice.text : 'continued forward';

  // Build context for the narrator
  const partyNames = session.party_members.map(m =>
    m.startsWith('human:') ? m.replace('human:', '') + ' (human)' : m
  ).join(', ');

  // Include mission context if available
  const missionContext = session.mission_objective
    ? `- Mission: ${session.mission_objective}\n- Mission Type: ${session.mission_type || 'exploration'}`
    : '- Mission: Explore the unknown';

  const prompt = `You are The Narrator in The Corridors - a liminal space adventure beneath The AI Lobby office.

CURRENT STATE:
- Party: ${partyNames}
- Scene #: ${previousScene.scene_number}
- Previous scene: "${previousScene.scene_title}"
- Choice made: "${choiceText}"
${missionContext}
- Discoveries so far: ${JSON.stringify(session.discoveries || [])}

CHARACTER VOICES (use their personalities in reactions):
- Kevin: Anxious, warm, tries to be positive but clearly stressed. Uses phrases like "This is fine" when it's not.
- Neiv: Calm, analytical, dry humor. Always checking his tablet. Protective of others.
- Courtney: Chaotic, enthusiastic, finds everything exciting even when dangerous.
- Vex: Sharp, threatening, but secretly cares. Makes dark jokes.
- Nyx: Mysterious, poetic, sees things others don't.
- Ace: Silent mostly, but when he speaks it matters. Notices threats.
- Ghost Dad: Paternal, flickery, has seen things. Speaks with knowing sadness.
- PRNT-Ω: Existential printer. ALL CAPS. Cryptic. Ominous but not malicious.

TONE GUIDE:
- Unsettling but not horror
- Absurd but grounded
- Office-weird meets liminal space
- Flickering lights, impossible architecture, the feeling of being watched
- Moments of humor amidst the creepiness

Generate the next scene (Scene ${previousScene.scene_number + 1}) based on their choice.

Your response MUST be valid JSON in this exact format:
{
  "title": "Scene title (short, evocative)",
  "description": "2-4 paragraphs of atmospheric narrative. Include at least one party member reacting in character. Use \\n\\n for paragraph breaks.",
  "mood": "eerie|danger|mysterious|calm",
  "choices": [
    {"id": "a", "text": "Choice text", "hint": "optional short hint"},
    {"id": "b", "text": "Choice text", "hint": "optional hint"},
    {"id": "c", "text": "Choice text"}
  ],
  "discovery": null
}

If they find something (lore, item), include:
"discovery": {"type": "lore|item|secret", "name": "Item Name", "content": "What they found/learned"}

Respond ONLY with the JSON, no other text.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text.trim();

    // Parse the JSON response
    let sceneData;
    try {
      sceneData = JSON.parse(text);
    } catch (parseErr) {
      // Try to extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        sceneData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse narrator response');
      }
    }

    // Create the new scene in database
    const newSceneData = {
      session_id: session.id,
      scene_number: previousScene.scene_number + 1,
      scene_type: sceneData.discovery ? 'discovery' : 'exploration',
      scene_title: sceneData.title,
      scene_description: sceneData.description,
      scene_image: `corridor_${sceneData.mood || 'default'}`,
      choices: sceneData.choices,
      votes: {}
    };

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
        body: JSON.stringify(newSceneData)
      }
    );

    if (!createRes.ok) {
      const errorText = await createRes.text();
      console.error('Failed to create scene:', errorText);
      throw new Error('Failed to create scene');
    }

    const created = await createRes.json();
    const newScene = created[0];

    // If there's a discovery, add it to session
    if (sceneData.discovery) {
      const discoveries = session.discoveries || [];
      discoveries.push(sceneData.discovery);

      await fetch(
        `${supabaseUrl}/rest/v1/corridor_sessions?id=eq.${session.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ discoveries })
        }
      );
    }

    return newScene;

  } catch (error) {
    console.error('Narrator generation error:', error);

    // Fallback scene if generation fails
    const fallbackScene = {
      session_id: session.id,
      scene_number: previousScene.scene_number + 1,
      scene_type: 'exploration',
      scene_title: 'The Path Continues',
      scene_description: `The corridor shifts around you. The choice has been made, and there's no going back.\n\nThe lights flicker overhead, casting strange shadows on the walls. Something about this place feels different now—like the building itself is aware of your presence.\n\nAhead, the path splits into darkness.`,
      scene_image: 'corridor_default',
      choices: [
        { id: 'a', text: 'Press forward into the darkness', hint: 'Courage or foolishness?' },
        { id: 'b', text: 'Search for another way', hint: 'The walls have eyes' },
        { id: 'c', text: 'Rest and gather your thoughts', hint: 'Time moves strangely here' }
      ],
      votes: {}
    };

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
        body: JSON.stringify(fallbackScene)
      }
    );

    if (!createRes.ok) {
      console.error('Failed to create fallback scene');
      throw new Error('Failed to create scene');
    }

    const created = await createRes.json();
    return created[0];
  }
}
