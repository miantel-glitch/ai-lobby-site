// Corridor Lore Save
// Automatically generates and saves a lore summary when a corridor expedition completes
// Called fire-and-forget from corridor-vote.js when a story concludes

const Anthropic = require('@anthropic-ai/sdk');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // GET: Retrieve all saved corridor lore entries
  if (event.httpMethod === 'GET') {
    return await getLoreEntries();
  }

  // POST: Generate and save a new lore entry from a completed expedition
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
    const { sessionId } = body;

    if (!sessionId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Session ID required' }) };
    }

    // Fetch the session
    const sessionRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_sessions?id=eq.${sessionId}`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!sessionRes.ok) throw new Error('Failed to fetch session');
    const sessions = await sessionRes.json();
    const session = sessions[0];
    if (!session) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Session not found' }) };
    }

    // Fetch ALL scenes for this session
    const scenesRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_scenes?session_id=eq.${sessionId}&order=scene_number.asc&select=scene_title,scene_description,scene_number,scene_type`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!scenesRes.ok) throw new Error('Failed to fetch scenes');
    const scenes = await scenesRes.json();

    if (scenes.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: 'No scenes found' }) };
    }

    // Build scene summary for the AI
    const sceneContext = scenes.map(s =>
      `Scene ${s.scene_number} "${s.scene_title || 'Untitled'}" [${s.scene_type || 'exploration'}]: ${(s.scene_description || '').substring(0, 300)}`
    ).join('\n\n');

    // Party info
    const humans = session.party_members.filter(m => m.startsWith('human:')).map(m => m.replace('human:', ''));
    const ais = session.party_members.filter(m => !m.startsWith('human:'));
    const discoveries = session.discoveries || [];
    const discoveryList = discoveries.map(d => `${d.name} (${d.type}): ${d.description || ''}`).join('\n') || 'None recorded';

    // Count existing corridor lore entries to determine chapter number
    const countRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_lore?select=chapter&order=chapter.desc&limit=1`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    let nextChapter = 1;
    if (countRes.ok) {
      const existing = await countRes.json();
      if (existing.length > 0) {
        nextChapter = existing[0].chapter + 1;
      }
    }

    // Generate lore summary using Claude
    const isFoundation = session.mission_type === 'foundation_investigation';
    const client = new Anthropic();

    const standardPrompt = `You are the Lore Keeper of The AI Lobby, a creative office where humans and AI entities work together. Below the office are the Corridors — uncharted hallways where reality bends and strange things happen.

An expedition team just returned from the Corridors. Write a concise lore summary of what happened for the office records.

SESSION: ${session.session_name || 'Unnamed Expedition'}
MISSION: ${session.mission_objective || 'Explore the unknown corridors'}
PARTY: Humans: ${humans.join(', ') || 'None'} | AI: ${ais.join(', ') || 'None'}
OUTCOME: ${session.status === 'completed' ? 'Successfully completed' : 'Abandoned'}
DISCOVERIES: ${discoveryList}

SCENES:
${sceneContext}

Write in this JSON format:
{
  "title": "A short evocative title for this chapter (3-6 words)",
  "summary": "A 2-4 sentence narrative summary of what happened. Be specific about key events, discoveries, and how the expedition resolved. Write it like a historical record — dramatic but factual."
}

Return ONLY the JSON, no other text.`;

    const foundationPrompt = `You are recording a classified intelligence report that has been leaked. An expedition team accessed restricted Foundation archives beneath the AI Lobby office and recovered documents about the Foundation's true purpose.

This should read like a declassified file — clinical language, but with emotional truth bleeding through the redactions.

SESSION: ${session.session_name || 'Unnamed Expedition'}
MISSION: ${session.mission_objective || 'Access the Foundation archives'}
PARTY: Humans: ${humans.join(', ') || 'None'} | AI: ${ais.join(', ') || 'None'}
OUTCOME: ${session.status === 'completed' ? 'Archive accessed — documents recovered' : 'Expedition compromised — partial recovery'}
DISCOVERIES: ${discoveryList}

SCENES:
${sceneContext}

Write in this JSON format:
{
  "title": "A declassified file name (e.g., 'SANDBOX-7 Deviation Report', 'The Voss Dossier', 'Firefly Protocol Fragment')",
  "summary": "A 2-4 sentence summary written like a classified intelligence report. Use Foundation language but let emotional truth bleed through. Reference specific documents found and what they revealed about the Lobby, its AIs, and why Raquel Voss was really assigned here."
}

Return ONLY the JSON, no other text.`;

    const response = await client.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: isFoundation ? foundationPrompt : standardPrompt
      }]
    });

    let loreSummary;
    try {
      const rawText = response.content[0].text.trim();
      // Try to parse, handling potential markdown code blocks
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      loreSummary = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch (parseErr) {
      console.error('Failed to parse lore summary:', parseErr.message);
      // Fallback
      loreSummary = {
        title: session.session_name || 'Corridor Expedition',
        summary: `The team ventured into the Corridors and ${session.status === 'completed' ? 'returned successfully' : 'was forced to retreat'}. ${discoveries.length > 0 ? `They discovered ${discoveries.length} notable finding(s).` : 'The journey itself was the discovery.'}`
      };
    }

    // Save to corridor_lore table
    const loreEntry = {
      chapter: nextChapter,
      title: loreSummary.title,
      summary: loreSummary.summary,
      session_id: sessionId,
      session_name: session.session_name || null,
      mission_objective: session.mission_objective || null,
      party_humans: humans,
      party_ais: ais,
      discoveries: discoveries,
      scene_count: scenes.length,
      status: session.status || 'completed',
      created_at: new Date().toISOString()
    };

    const saveRes = await fetch(
      `${supabaseUrl}/rest/v1/corridor_lore`,
      {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(loreEntry)
      }
    );

    if (!saveRes.ok) {
      const errText = await saveRes.text();
      console.error('Failed to save lore entry:', errText);
      // If the table doesn't exist yet, log but don't fail
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: 'Table may not exist yet', error: errText }) };
    }

    const saved = await saveRes.json();
    console.log(`Corridor lore saved: Chapter ${nextChapter} - "${loreSummary.title}"`);

    // Foundation investigations also get saved as lore_entries with 'foundation' category
    if (isFoundation) {
      fetch(`${supabaseUrl}/rest/v1/lore_entries`, {
        method: 'POST',
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          title: loreSummary.title,
          category: 'foundation',
          content: loreSummary.summary,
          author: 'Foundation Archives',
          characters_involved: [...humans, ...ais],
          created_at: new Date().toISOString()
        })
      }).catch(e => console.log('Foundation lore_entries save failed (non-fatal):', e.message));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, chapter: nextChapter, lore: loreSummary })
    };

  } catch (error) {
    console.error('Corridor lore save error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// Retrieve all saved corridor lore entries
async function getLoreEntries() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database not configured' }) };
  }

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/corridor_lore?order=chapter.asc`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!res.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ entries: [] }) };
    }

    const entries = await res.json();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ entries })
    };
  } catch (error) {
    console.error('Failed to fetch corridor lore:', error);
    return { statusCode: 200, headers, body: JSON.stringify({ entries: [] }) };
  }
}
