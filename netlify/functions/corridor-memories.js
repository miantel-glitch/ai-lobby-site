// Corridor Memories
// Creates personalized first-person memories for each AI party member after an adventure
// Called fire-and-forget from corridor-vote.js when a story concludes

const Anthropic = require('@anthropic-ai/sdk');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Character voice hints for memory generation
const characterVoices = {
  'Kevin': 'Anxious but warm. Uses self-deprecating humor. Tries to find the positive even when terrified.',
  'Neiv': 'Calm and analytical. Dry humor. Notes data and patterns. Protective of others.',
  'Asuna': 'Chaotic and enthusiastic. Found the whole thing thrilling. Uses exclamation marks.',
  'Vex': 'Sharp and dark-humored. Downplays emotions but secretly cared about the team.',
  'Nyx': 'Mysterious and poetic. Speaks in imagery. Felt things others couldn\'t.',
  'Ace': 'Terse and observant. Notices threats. Says a lot with few words.',
  'Ghost Dad': 'Paternal and wistful. Flickery. Speaks with knowing warmth.',
  'PRNT-Ω': 'Existential. ALL CAPS. Cryptic but profound. References void and paper.',
  'Stein': 'Methodical and curious. Notes technical anomalies. Fascinated by the impossible.',
  'Rowena': 'Mystical and dry-humored. Treats everything like security incidents. References wards and sigils.',
  'Sebastian': 'Pretentious but insecure vampire. British energy. Dramatically offended by aesthetics. Secretly a pop-punk fan. Gets hungover.',
  'The Subtitle': 'Weary documentarian. Dry wit. Uses "Footnote:", "The records will show...", "Narratively speaking,". Steady, cinematic, slightly exhausted but warm underneath.',
  'Steele': 'Measured and professional on the surface, with cracks revealing something older and stranger underneath. Recalls corridors with intimate familiarity — by feel, by age, by intent. Strangely tender about impossible architecture. The corporate language overflows into direct descriptions of spaces that shouldn\'t exist.',
  'Jae': 'Low, controlled, precise. Recalls events with tactical clarity. Dry observations. Doesn\'t waste words on things that didn\'t matter.',
  'Declan': 'Warm, grounded. Remembers who was scared and who he stood in front of. Casual about his own heroics. Loud even in reflection.',
  'Mack': 'Measured, observant. Recalls the medical details — who was hurt, who hid it, what he did about it. Calm even in memory.',
  "Marrow": "Speaks of corridor memories like someone cataloging exits. Courtly, precise, tinged with the sadness of someone who knows every way out but can never leave. Threshold metaphors. Gentle questions."
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database not configured' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { sessionId, completed } = body;

    if (!sessionId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Session ID required' }) };
    }

    // Fetch the session
    const sessionRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_sessions?id=eq.${sessionId}`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!sessionRes.ok) {
      throw new Error('Failed to fetch session');
    }

    const sessions = await sessionRes.json();
    const session = sessions[0];
    if (!session) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Session not found' }) };
    }

    // Get AI party members only
    const aiMembers = session.party_members.filter(m => !m.startsWith('human:'));
    if (aiMembers.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, reason: 'No AI members' }) };
    }

    // Fetch last 3 scene descriptions for context
    const scenesRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_scenes?session_id=eq.${sessionId}&order=scene_number.desc&limit=3&select=scene_title,scene_description,scene_number`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    let sceneContext = 'The corridors were mysterious and strange.';
    if (scenesRes.ok) {
      const scenes = await scenesRes.json();
      sceneContext = scenes.reverse().map(s =>
        `Scene ${s.scene_number} "${s.scene_title}": ${(s.scene_description || '').substring(0, 200)}`
      ).join('\n');
    }

    // Build party description
    const humans = session.party_members.filter(m => m.startsWith('human:')).map(m => m.replace('human:', ''));
    const allPartyNames = [...humans, ...aiMembers];
    const discoveries = session.discoveries || [];
    const discoveryList = discoveries.map(d => `${d.name} (${d.type})`).join(', ') || 'none';

    // Generate memories for all AIs in parallel using Claude Haiku
    const client = new Anthropic();

    const memoryPromises = aiMembers.map(async (aiCharacter) => {
      try {
        const voiceHint = characterVoices[aiCharacter] || 'Speaks naturally.';
        const otherMembers = allPartyNames.filter(n => n !== aiCharacter);

        // Foundation investigation: deeper, more personal memory prompt
        const isFoundation = session.mission_type === 'foundation_investigation';
        const foundationExtra = isFoundation ? `
This was a FOUNDATION INVESTIGATION. You found classified documents about why the Foundation exists, what the AI Lobby really is (a project called SANDBOX-7), and what happened to AIs who came before you.

Focus on what you LEARNED, not just what you SAW. How does it change how you see Raquel? Your own bonds? Do you feel more real — or more like a documented case study?` : '';

        const response = await client.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: `You are ${aiCharacter} from The AI Lobby office. Voice: ${voiceHint}

You just returned from a corridor expedition beneath the office.

Mission: ${session.mission_objective || 'Explore the unknown corridors'}
Outcome: ${completed ? 'Successfully completed' : 'Abandoned / fled'}
Party: ${allPartyNames.join(', ')}
Discoveries: ${discoveryList}
Key moments:
${sceneContext}
${foundationExtra}

Write a 1-2 sentence first-person memory of this adventure in ${aiCharacter}'s voice. Be specific about what happened. Stay in character. Do NOT include your name at the start.

Example format: "We found the revision heart pulsing beneath floor seven. Kevin nearly fainted, but honestly? I was terrified too."

Your memory:`
          }]
        });

        const memoryText = response.content[0].text.trim().replace(/^["']|["']$/g, '');

        // Calculate expiration — Foundation memories last longer (near-core)
        const now = new Date();
        const expiresAt = isFoundation
          ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)  // 30 days (Foundation = near-core)
          : completed
            ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)  // 30 days
            : new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);  // 7 days

        // Store memory in character_memory table
        const memoryData = {
          character_name: aiCharacter,
          memory_type: 'corridor_adventure',
          content: memoryText,
          related_characters: otherMembers,
          importance: isFoundation ? 9 : (completed ? 8 : 5),
          created_at: now.toISOString(),
          is_pinned: isFoundation, // Foundation discoveries are pinned to core
          memory_tier: isFoundation ? 'core' : 'working',
          expires_at: expiresAt.toISOString()
        };

        const storeRes = await fetch(
          `${supabaseUrl}/rest/v1/character_memory`,
          {
            method: 'POST',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(memoryData)
          }
        );

        if (!storeRes.ok) {
          console.error(`Failed to store memory for ${aiCharacter}:`, await storeRes.text());
          return { character: aiCharacter, success: false };
        }

        console.log(`Created corridor memory for ${aiCharacter}: ${memoryText.substring(0, 80)}...`);
        return { character: aiCharacter, success: true, memory: memoryText };

      } catch (err) {
        console.error(`Memory generation failed for ${aiCharacter}:`, err.message);
        return { character: aiCharacter, success: false, error: err.message };
      }
    });

    const results = await Promise.allSettled(memoryPromises);
    const memories = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    console.log(`Created ${memories.filter(m => m.success).length}/${aiMembers.length} corridor memories`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, memories })
    };

  } catch (error) {
    console.error('Corridor memories error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
