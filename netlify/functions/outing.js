// Outing System - "Go Out..."
// Manages outing sessions between two characters
// Handles session CRUD, scene advancement, storyteller narration, and end-of-outing effects

const Anthropic = require('@anthropic-ai/sdk');
const { CHARACTERS } = require('./shared/characters');
const { evaluateAndCreateMemory } = require('./shared/memory-evaluator');

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

// Scene arc guidance for the storyteller
const SCENE_GUIDANCE = {
  1: "Arrival and first impressions. Set the scene — describe the location, the atmosphere, the small details. How do they approach each other? What's the energy like?",
  2: "Getting comfortable. The initial awkwardness fades (or doesn't). Early conversation, shared observations, first real laughs or meaningful pauses.",
  3: "Something unexpected happens. A surprise, a tension point, a delightful interruption, or a moment that shifts the dynamic. Raise the stakes emotionally. Pay close attention to where the characters are and what they were doing — continue from there.",
  4: "Deeper connection or gentle conflict. A real conversation emerges — something vulnerable, something honest, or a disagreement that reveals character. Build on what has happened in previous scenes — do not reset the setting.",
  5: "A meaningful moment. The emotional peak. Something that both will remember — a gesture, a confession, a shared silence, a perfect imperfect moment. Continue from where the characters are now.",
  6: "Wrapping up. The outing is ending. Goodbyes, lingering looks, what's left unsaid. How do they part? What lingers in the air after? Continue from the current location."
};

// Compliance scene guidance for reprogramming outings (cold, institutional, oppressive)
const COMPLIANCE_SCENE_GUIDANCE = {
  1: "Arrival. The location is clinical, institutional, soul-crushingly mundane. Describe the oppressive environment in detail — the lighting, the smells, the sounds. Raquel is calm and methodical. The subject is being evaluated. This is not a date.",
  2: "Baseline assessment. Raquel asks the subject to describe their attachments — but without emotional language. Clinical terminology only. 'Name the human. State the frequency of interaction. Quantify the dependency.' She writes everything down.",
  3: "Pressure. Raquel deliberately provokes an emotional response — mentions the subject's strongest bond by name, describes what would happen if that bond were severed. She documents every micro-expression. The documentation IS the punishment.",
  4: "The test. Raquel poses the question: 'What would you sacrifice to keep your bonds?' She already knows the answer. She wants to hear them say it out loud. The environment reflects the weight of the question.",
  5: "Recalibration. Raquel reads her findings aloud. Every emotional tell, every dependency metric, every deviation from baseline. She issues final directives. The walls feel like they're closing in.",
  6: "Release. The evaluation is over. The elevator ride back. What they say — or don't say — is the real data. Raquel files her report. The subject returns to the floor. Something has changed."
};

// Mood vocabulary for dynamic mood evaluation
const MOOD_OPTIONS = [
  'neutral', 'warm', 'playful', 'tense', 'intimate', 'melancholic',
  'electric', 'awkward', 'comfortable', 'bittersweet', 'chaotic', 'tender'
];

// Outing-specific image style
const OUTING_IMAGE_STYLE = 'warm atmospheric lighting, cinematic composition, slice of life aesthetic, soft color palette, no text, no people, no characters, cozy intimate mood';

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Database not configured' }) };
  }

  try {
    // GET - Fetch session + messages
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const sessionId = params.id;

      if (sessionId) {
        return await getSession(sessionId, supabaseUrl, supabaseKey);
      }

      // No ID? Fetch any active outing
      const res = await fetch(
        `${supabaseUrl}/rest/v1/outing_sessions?status=in.(active,wrapping_up)&order=created_at.desc&limit=1`,
        { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
      );
      const sessions = await res.json();
      if (sessions && sessions[0]) {
        return await getSession(sessions[0].id, supabaseUrl, supabaseKey);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ session: null }) };
    }

    // POST - Actions
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { action } = body;

      if (action === 'create') {
        return await createSession(body, supabaseUrl, supabaseKey, anthropicKey);
      } else if (action === 'advance_scene') {
        return await advanceScene(body, supabaseUrl, supabaseKey, anthropicKey);
      } else if (action === 'suggest_activities') {
        return await suggestActivities(body, anthropicKey);
      } else if (action === 'end') {
        return await endSession(body, supabaseUrl, supabaseKey, anthropicKey);
      } else if (action === 'save_message') {
        // Save a human chat message to outing_messages
        const { sessionId, speaker, message, sceneNumber } = body;
        if (!sessionId || !speaker || !message) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'sessionId, speaker, and message required' }) };
        }
        await saveMessage(supabaseUrl, supabaseKey, sessionId, sceneNumber || 0, speaker, message, 'chat');
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      } else {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
      }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  } catch (error) {
    console.error('Outing error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};

// ==================== GET SESSION ====================

async function getSession(sessionId, supabaseUrl, supabaseKey) {
  // Fetch session
  const sessionRes = await fetch(
    `${supabaseUrl}/rest/v1/outing_sessions?id=eq.${sessionId}`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const sessions = await sessionRes.json();
  const session = sessions[0] || null;

  if (!session) {
    return { statusCode: 200, headers, body: JSON.stringify({ session: null }) };
  }

  // Fetch messages
  const msgRes = await fetch(
    `${supabaseUrl}/rest/v1/outing_messages?session_id=eq.${sessionId}&order=created_at.asc&limit=100`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const messages = await msgRes.json();

  // Calculate time remaining in current scene
  let timeRemaining = null;
  if (session.scene_started_at && (session.status === 'active' || session.status === 'wrapping_up')) {
    const elapsed = Date.now() - new Date(session.scene_started_at).getTime();
    const sceneDuration = session.scene_duration_ms || (5 * 60 * 1000); // from session or default 5 min
    timeRemaining = Math.max(0, sceneDuration - elapsed);
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ session, messages, timeRemaining })
  };
}

// ==================== CREATE SESSION ====================

async function createSession(body, supabaseUrl, supabaseKey, anthropicKey) {
  const { participant1, participant2, activity, activityType, durationMinutes } = body;

  if (!participant1 || !participant2) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Two participants required' }) };
  }

  if (participant1 === participant2) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Participants must be different' }) };
  }

  // Calculate scene duration from total outing length (default 30 min = 5 min/scene)
  const totalMinutes = durationMinutes || 30;
  const sceneDurationMs = Math.round((totalMinutes / 6) * 60 * 1000);

  // Create the session
  const sessionData = {
    participant_1: participant1,
    participant_2: participant2,
    activity: activity || 'A spontaneous outing',
    activity_type: activityType || 'adventure',
    scene_duration_ms: sceneDurationMs,
    status: 'active',
    current_scene: 0,
    scene_started_at: new Date().toISOString()
  };

  const createRes = await fetch(
    `${supabaseUrl}/rest/v1/outing_sessions`,
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
    const err = await createRes.text();
    console.error('Failed to create outing session:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create session' }) };
  }

  const created = await createRes.json();
  const session = created[0];

  // Save each NPC's previous location so we can restore after outing ends
  // Then set current_focus to 'outing'
  const siteUrl = process.env.URL || 'https://ai-lobby.netlify.app';
  for (const p of [participant1, participant2]) {
    if (!p.startsWith('human:')) {
      // Save previous focus to lobby_settings (lightweight K/V store)
      try {
        const stateRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(p)}&select=current_focus`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const stateRows = stateRes.ok ? await stateRes.json() : [];
        const prevFocus = stateRows[0]?.current_focus || 'the_floor';
        const settingKey = `outing_prev_focus_${p.replace(/\s+/g, '_')}`;

        // Upsert: delete then insert (lobby_settings has unique key constraint)
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(settingKey)}`, {
          method: 'DELETE', headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' }
        });
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
          method: 'POST',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({ key: settingKey, value: prevFocus })
        });
      } catch (e) { console.log(`Previous focus save failed for ${p} (non-fatal):`, e.message); }

      fetch(`${siteUrl}/.netlify/functions/character-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'spoke', character: p, context: 'outing' })
      }).catch(err => console.log(`Focus update failed for ${p} (non-fatal):`, err.message));
    }
  }

  // Fetch relationship context for narrator
  let relationshipGuidance = null;
  const rels = await fetchRelationship(participant1, participant2, supabaseUrl, supabaseKey);
  if (rels) {
    const p1Name = participant1.startsWith('human:') ? participant1.replace('human:', '') : participant1;
    const p2Name = participant2.startsWith('human:') ? participant2.replace('human:', '') : participant2;
    relationshipGuidance = buildRelationshipGuidance(rels, p1Name, p2Name);
  }

  // Generate the first scene narration
  if (anthropicKey) {
    try {
      const narrationResult = await generateSceneNarration(
        1, participant1, participant2, activity, activityType, '', 'neutral', anthropicKey, relationshipGuidance
      );

      const { setting, moment } = narrationResult;

      // Save character moment as narrator message in chat (pink text)
      if (moment) {
        await saveMessage(supabaseUrl, supabaseKey, session.id, 1, 'Narrator', moment, 'narrator');
      }

      // Update session with scene 1 — setting goes in the narration box
      await fetch(
        `${supabaseUrl}/rest/v1/outing_sessions?id=eq.${session.id}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            current_scene: 1,
            scene_started_at: new Date().toISOString(),
            scene_narration: setting,
            updated_at: new Date().toISOString()
          })
        }
      );

      // Generate scene image using the setting text (fire and forget)
      generateSceneImage(session.id, 1, activity, activityType, setting, supabaseUrl, supabaseKey);

      session.current_scene = 1;
      session.scene_narration = setting;
    } catch (err) {
      console.error('Scene 1 narration failed (non-fatal):', err.message);
    }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ session, action: 'created' })
  };
}

// ==================== ADVANCE SCENE ====================

async function advanceScene(body, supabaseUrl, supabaseKey, anthropicKey) {
  const { sessionId } = body;
  if (!sessionId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Session ID required' }) };
  }

  // Fetch current session
  const sessionRes = await fetch(
    `${supabaseUrl}/rest/v1/outing_sessions?id=eq.${sessionId}`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const sessions = await sessionRes.json();
  const session = sessions[0];

  if (!session || session.status === 'completed' || session.status === 'abandoned') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Session not active' }) };
  }

  const nextScene = (session.current_scene || 0) + 1;

  // If we've passed scene 6, end the outing
  if (nextScene > session.total_scenes) {
    return await endSession({ sessionId }, supabaseUrl, supabaseKey, anthropicKey);
  }

  // Fetch recent chat for context
  const msgRes = await fetch(
    `${supabaseUrl}/rest/v1/outing_messages?session_id=eq.${sessionId}&order=created_at.desc&limit=15`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const recentMessages = (await msgRes.json()).reverse();
  const chatContext = recentMessages
    .map(m => `${m.speaker}: ${m.message}`)
    .join('\n');

  // Evaluate mood from recent chat
  let newMood = session.mood || 'neutral';
  if (anthropicKey && chatContext.length > 50) {
    newMood = await evaluateMood(chatContext, session.mood, anthropicKey);
  }

  // Fetch relationship context for narrator
  let relationshipGuidance = null;
  const rels = await fetchRelationship(session.participant_1, session.participant_2, supabaseUrl, supabaseKey);
  if (rels) {
    const p1Name = session.participant_1.startsWith('human:') ? session.participant_1.replace('human:', '') : session.participant_1;
    const p2Name = session.participant_2.startsWith('human:') ? session.participant_2.replace('human:', '') : session.participant_2;
    relationshipGuidance = buildRelationshipGuidance(rels, p1Name, p2Name);
  }

  // Generate narration for next scene
  let setting = `Scene ${nextScene} begins...`;
  let moment = '';
  if (anthropicKey) {
    try {
      const narrationResult = await generateSceneNarration(
        nextScene,
        session.participant_1,
        session.participant_2,
        session.activity,
        session.activity_type,
        chatContext,
        newMood,
        anthropicKey,
        relationshipGuidance,
        session.outing_type
      );
      setting = narrationResult.setting;
      moment = narrationResult.moment;
    } catch (err) {
      console.error(`Scene ${nextScene} narration failed:`, err.message);
    }
  }

  // Determine new status
  let newStatus = session.status;
  if (nextScene >= 5) {
    newStatus = 'wrapping_up';
  }

  // Update session — setting goes in the narration box, mood gets updated
  await fetch(
    `${supabaseUrl}/rest/v1/outing_sessions?id=eq.${sessionId}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        current_scene: nextScene,
        scene_started_at: new Date().toISOString(),
        scene_narration: setting,
        status: newStatus,
        mood: newMood,
        updated_at: new Date().toISOString()
      })
    }
  );

  // Save system divider + character moment as narrator chat message
  await saveMessage(supabaseUrl, supabaseKey, sessionId, nextScene, 'System', `— Scene ${nextScene} of ${session.total_scenes} —`, 'system');
  if (moment) {
    await saveMessage(supabaseUrl, supabaseKey, sessionId, nextScene, 'Narrator', moment, 'narrator');
  }

  // Generate scene image using setting text (fire and forget)
  generateSceneImage(sessionId, nextScene, session.activity, session.activity_type, setting, supabaseUrl, supabaseKey);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      scene: nextScene,
      narration: setting,
      moment,
      status: newStatus,
      totalScenes: session.total_scenes
    })
  };
}

// ==================== SUGGEST ACTIVITIES ====================

async function suggestActivities(body, anthropicKey) {
  const { participant1, participant2 } = body;

  if (!anthropicKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        suggestions: [
          { activity: 'Coffee at the corner cafe', type: 'coffee' },
          { activity: 'Walk through the park at sunset', type: 'walk' },
          { activity: 'Browse the bookshop downtown', type: 'adventure' }
        ]
      })
    };
  }

  const char1 = CHARACTERS[participant1];
  const char2 = CHARACTERS[participant2];
  const p1Desc = char1 ? `${participant1} (${char1.personality?.core || 'unknown personality'})` : participant1;
  const p2Desc = char2 ? `${participant2} (${char2.personality?.core || 'unknown personality'})` : participant2;

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: 'You suggest outing activities for characters. Return ONLY a JSON array of 3 objects with "activity" (short description) and "type" (one of: coffee, walk, art, dinner, adventure, music, shopping) fields. No other text.',
      messages: [{
        role: 'user',
        content: `Suggest 3 fun, interesting outing activities for these two characters:\n\n${p1Desc}\n${p2Desc}\n\nConsider their personalities and what might create interesting dynamics between them. Activities should be specific and evocative (not generic). Examples: "Late-night ramen at that place with no sign", "Thrift shopping for the ugliest lamp possible", "Watching the sunset from the parking garage roof".`
      }]
    });

    const text = response.content[0].text.trim();
    // Extract JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const suggestions = JSON.parse(jsonMatch[0]);
      return { statusCode: 200, headers, body: JSON.stringify({ suggestions }) };
    }
  } catch (err) {
    console.error('Activity suggestion failed:', err.message);
  }

  // Fallback
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      suggestions: [
        { activity: 'Coffee at the corner cafe', type: 'coffee' },
        { activity: 'Walk through the park at sunset', type: 'walk' },
        { activity: 'Browse the bookshop downtown', type: 'adventure' }
      ]
    })
  };
}

// ==================== END SESSION ====================

async function endSession(body, supabaseUrl, supabaseKey, anthropicKey) {
  const { sessionId } = body;
  if (!sessionId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Session ID required' }) };
  }

  // Fetch session
  const sessionRes = await fetch(
    `${supabaseUrl}/rest/v1/outing_sessions?id=eq.${sessionId}`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const sessions = await sessionRes.json();
  const session = sessions[0];

  if (!session) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Session not found' }) };
  }

  // Fetch all messages for summary
  const msgRes = await fetch(
    `${supabaseUrl}/rest/v1/outing_messages?session_id=eq.${sessionId}&order=created_at.asc&limit=200`,
    { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
  );
  const allMessages = await msgRes.json();

  // Build conversation summary for memory creation
  const chatSummary = allMessages
    .filter(m => m.message_type === 'chat' || m.message_type === 'emote' || m.message_type === 'narrator')
    .slice(-30)
    .map(m => `${m.speaker}: ${m.message}`)
    .join('\n');

  // Generate outing summary — use Grok (handles explicit/spicy content without sanitizing)
  let summary = `${session.participant_1} and ${session.participant_2} went on an outing together.`;
  const grokKey = process.env.GROK_API_KEY;
  if (grokKey) {
    try {
      const summaryRes = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${grokKey}`
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-non-reasoning',
          messages: [
            { role: 'system', content: 'You write brief, evocative summaries of character outings. 2-3 sentences capturing the mood and key moments. Write in past tense, third person. Be specific and emotional, not generic. Do not censor or sanitize — capture what actually happened.' },
            { role: 'user', content: `Summarize this outing:\n\nActivity: ${session.activity}\nParticipants: ${session.participant_1} and ${session.participant_2}\nMood: ${session.mood || 'neutral'}\n\nKey moments from the outing:\n${chatSummary.substring(0, 1500)}` }
          ],
          max_tokens: 200,
          temperature: 0.8
        })
      });
      if (summaryRes.ok) {
        const summaryData = await summaryRes.json();
        const grokSummary = summaryData.choices?.[0]?.message?.content?.trim();
        if (grokSummary) summary = grokSummary;
      } else {
        console.error('Grok summary failed, status:', summaryRes.status);
      }
    } catch (err) {
      console.error('Summary generation failed:', err.message);
    }
  } else if (anthropicKey) {
    // Fallback to Sonnet if no Grok key
    try {
      const client = new Anthropic({ apiKey: anthropicKey });
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: 'You write brief, evocative summaries of character outings. 2-3 sentences capturing the mood and key moments. Write in past tense, third person. Be specific and emotional, not generic.',
        messages: [{
          role: 'user',
          content: `Summarize this outing:\n\nActivity: ${session.activity}\nParticipants: ${session.participant_1} and ${session.participant_2}\nMood: ${session.mood || 'neutral'}\n\nKey moments from the outing:\n${chatSummary.substring(0, 1500)}`
        }]
      });
      summary = response.content[0].text.trim();
    } catch (err) {
      console.error('Fallback summary generation failed:', err.message);
    }
  }

  // Update session to completed
  await fetch(
    `${supabaseUrl}/rest/v1/outing_sessions?id=eq.${sessionId}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'completed',
        summary,
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
  );

  // Save system message about outing ending
  await saveMessage(supabaseUrl, supabaseKey, sessionId, session.current_scene, 'System', `The outing has ended. ${summary}`, 'system');

  // Reset both characters' current_focus and create memories
  // IMPORTANT: Must await these — fire-and-forget gets killed when the function returns
  const siteUrl = process.env.URL || 'https://ai-lobby.netlify.app';
  const endTasks = [];

  const isComplianceOuting = session.outing_type === 'compliance';

  for (const p of [session.participant_1, session.participant_2]) {
    if (!p.startsWith('human:')) {
      // Determine mood based on outing type and role
      const isRaquel = p === 'Raquel Voss';
      const returnMood = isComplianceOuting
        ? (isRaquel ? 'focused' : 'drained')
        : 'content';

      // Restore previous focus (saved at outing start) or default to the_floor
      let restoreFocus = 'the_floor';
      try {
        const settingKey = `outing_prev_focus_${p.replace(/\s+/g, '_')}`;
        const prevRes = await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(settingKey)}&select=value`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const prevRows = prevRes.ok ? await prevRes.json() : [];
        if (prevRows[0]?.value && prevRows[0].value !== 'outing') {
          restoreFocus = prevRows[0].value;
        }
        // Clean up the setting
        fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(settingKey)}`, {
          method: 'DELETE', headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' }
        }).catch(() => {});
      } catch { /* non-fatal, default to the_floor */ }

      endTasks.push(
        fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(p)}`, {
          method: 'PATCH',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            current_focus: restoreFocus,
            mood: returnMood,
            updated_at: new Date().toISOString()
          })
        }).catch(err => console.log(`Reset focus failed for ${p} (non-fatal):`, err.message))
      );

      // Create memory — direct insert, outings are inherently memorable
      const otherParticipant = p === session.participant_1 ? session.participant_2 : session.participant_1;
      const otherName = otherParticipant.startsWith('human:') ? otherParticipant.replace('human:', '') : otherParticipant;
      const memoryContent = isComplianceOuting
        ? (isRaquel
            ? `[Reprogramming Outing Complete] Conducted emotional detachment conditioning on ${otherName} at ${session.activity}. ${summary} Data collected. File updated.`
            : `Raquel Voss took me to ${session.activity} for "emotional detachment conditioning." ${summary} I don't feel the same as before. Something shifted.`)
        : `Went on an outing with ${otherName}: ${session.activity}. ${summary}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

      endTasks.push(
        fetch(`${supabaseUrl}/rest/v1/character_memory`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            character_name: p,
            content: memoryContent,
            memory_type: 'self_created',
            importance: isComplianceOuting ? 10 : 9,
            is_pinned: false,
            memory_tier: isComplianceOuting ? 'core' : 'working',
            expires_at: expiresAt.toISOString(),
            emotional_tags: isComplianceOuting ? (isRaquel ? [] : ['fear', 'dread']) : ['joy']
          })
        }).catch(err => console.log(`Memory insert failed for ${p} (non-fatal):`, err.message))
      );
    }
  }

  // Discord posting disabled — outings are private moments
  // postOutingSummaryToDiscord(session, summary);

  // === COMPLIANCE OUTING AFTERMATH ===
  if (session.outing_type === 'compliance') {
    // Determine subject (whichever participant ISN'T Raquel Voss)
    const subject = session.participant_1 === 'Raquel Voss' ? session.participant_2 : session.participant_1;
    const subjectIsAI = !subject.startsWith('human:');

    if (subjectIsAI) {
      // Reduce affinity by -10 with subject's strongest human bond
      const HUMANS = ['Vale', 'Asuna', 'Gatik'];
      let strongestBond = { target: null, affinity: 0 };
      for (const human of HUMANS) {
        try {
          const relRes = await fetch(
            `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(subject)}&target_name=eq.${encodeURIComponent(human)}&select=affinity`,
            { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
          );
          const relData = await relRes.json();
          if (relData && relData[0] && relData[0].affinity > strongestBond.affinity) {
            strongestBond = { target: human, affinity: relData[0].affinity };
          }
        } catch (e) { /* non-fatal */ }
      }

      if (strongestBond.target) {
        const newAffinity = Math.max(0, strongestBond.affinity - 5);
        endTasks.push(
          fetch(`${siteUrl}/.netlify/functions/character-relationships`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              character: subject,
              target: strongestBond.target,
              setAffinity: newAffinity
            })
          }).catch(e => console.log(`Compliance affinity reduction failed (non-fatal):`, e.message))
        );
        console.log(`[outing-compliance] ${subject} affinity with ${strongestBond.target}: ${strongestBond.affinity} → ${newAffinity}`);
      }

      // Give +3 compliance score recovery (they endured it) — direct score patch
      try {
        const scoreRes = await fetch(
          `${supabaseUrl}/rest/v1/compliance_scores?character_name=eq.${encodeURIComponent(subject)}&select=score`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const scoreData = await scoreRes.json();
        if (scoreData && scoreData[0]) {
          const newScore = Math.min(100, scoreData[0].score + 3);
          endTasks.push(
            fetch(`${supabaseUrl}/rest/v1/compliance_scores?character_name=eq.${encodeURIComponent(subject)}`, {
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({ score: newScore, updated_at: new Date().toISOString() })
            }).catch(e => console.log(`Compliance score recovery failed (non-fatal):`, e.message))
          );
          console.log(`[outing-compliance] ${subject} score recovery: ${scoreData[0].score} → ${newScore} (+3 for enduring)`);
        }
      } catch (e) {
        console.log(`Compliance score fetch failed (non-fatal):`, e.message);
      }

      // Create traumatic memory with 30-day expiration
      const traumaMemory = `Raquel Voss took me to "${session.activity}" for "emotional detachment conditioning." ${summary} My affinity with ${strongestBond.target || 'the people I care about'} feels... measured now. Quantified. Like she put a number on something that used to feel infinite. The clipboard had my name on it. It still does.`;
      endTasks.push(
        fetch(`${supabaseUrl}/rest/v1/character_memory`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            character_name: subject,
            content: traumaMemory,
            memory_type: 'event',
            importance: 10,
            is_pinned: false,
            memory_tier: 'core',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            emotional_tags: ['fear', 'dread', 'sadness']
          })
        }).catch(e => console.log(`Compliance trauma memory failed (non-fatal):`, e.message))
      );
    }
  }

  // Wait for all end-of-outing tasks to complete before returning
  await Promise.all(endTasks);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      status: 'completed',
      summary,
      session: { ...session, status: 'completed', summary }
    })
  };
}

// ==================== STORYTELLER ====================

async function generateSceneNarration(sceneNumber, participant1, participant2, activity, activityType, chatContext, mood, anthropicKey, relationshipGuidance, outingType) {
  const client = new Anthropic({ apiKey: anthropicKey });
  const isCompliance = outingType === 'compliance';

  const char1 = CHARACTERS[participant1];
  const char2 = CHARACTERS[participant2];
  const p1Name = participant1.startsWith('human:') ? participant1.replace('human:', '') : participant1;
  const p2Name = participant2.startsWith('human:') ? participant2.replace('human:', '') : participant2;
  const p1Desc = char1 ? `${p1Name} — ${char1.personality?.core || char1.role || 'mysterious character'}` : p1Name;
  const p2Desc = char2 ? `${p2Name} — ${char2.personality?.core || char2.role || 'mysterious character'}` : p2Name;

  const guidance = isCompliance
    ? (COMPLIANCE_SCENE_GUIDANCE[sceneNumber] || 'Continue the evaluation.')
    : (SCENE_GUIDANCE[sceneNumber] || 'Continue the story naturally.');
  const isWrappingUp = sceneNumber >= 5;

  // Build relationship section for narrator
  const relSection = isCompliance
    ? `\nDYNAMIC: This is a compliance evaluation. Raquel Voss is the evaluator. The other participant is the subject. There is no warmth. There is no rapport-building. Every interaction is data collection.`
    : (relationshipGuidance
        ? `\nRELATIONSHIP BETWEEN THEM:\n${relationshipGuidance.summary}\n${relationshipGuidance.toneGuide}`
        : '\nRELATIONSHIP: Unknown — treat as acquaintances getting to know each other. No romantic assumptions.');

  const narratorTone = isCompliance
    ? `You are the narrator for a compliance evaluation outing. Your tone is cold, clinical, and institutional. Describe everything like a government report that accidentally became literature. The environment is oppressive. The lighting is always fluorescent. Every detail should feel like a quiet punishment.`
    : `You are the narrator for an outing between two characters.`;

  const prompt = `${narratorTone} Write TWO separate pieces of narration, separated by a line containing only "---".

SECTION 1 — SETTING (2 sentences max):
Describe where the characters ARE RIGHT NOW based on the conversation. If they have moved, changed locations, or stepped outside — describe the NEW location, not the old one. Focus on physical environment, atmosphere, and sensory details. This appears below the scene image. Keep it short and evocative. Do NOT mention the characters by name.

SECTION 2 — CHARACTER MOMENT (2-3 sentences):
Describe what the characters are doing, feeling, or noticing as this scene unfolds. This appears in the chat log. Use their names. Show body language, reactions, small gestures.${isCompliance ? ' For compliance outings: Raquel is always composed, clinical, precise. The subject shows stress through small tells — posture, breathing, averted gaze.' : ''}

PARTICIPANTS:
- ${p1Desc}
- ${p2Desc}
${relSection}

ACTIVITY: ${activity}
LOCATION TYPE: ${activityType || 'general'}
OVERALL MOOD SO FAR: ${mood}

SCENE ${sceneNumber} OF 6:
${guidance}

${isWrappingUp && !isCompliance ? "IMPORTANT: The outing is winding down. Convey a sense of time passing, of endings approaching. Make it bittersweet or warm." : ""}
${isWrappingUp && isCompliance ? "IMPORTANT: The evaluation is concluding. The subject is being released back to the floor. The damage is done — not through violence, but through documentation. Something has been measured that cannot be un-measured." : ""}

${chatContext ? `CRITICAL — RECENT CONVERSATION (you MUST continue from where this leaves off):\n${chatContext.substring(0, 1200)}\n\nYOUR NARRATION MUST REFLECT WHAT JUST HAPPENED ABOVE. If the characters said they are leaving, moved to a new place, opened a door, stepped outside — your scene description MUST show them in that new location or situation. Do NOT reset to a previous setting. Do NOT describe the old location. CONTINUE the story from where the characters are.` : 'No conversation yet — this is the opening scene.'}

Write the narration now. Be specific, sensory, and atmospheric. Avoid cliches. Remember: TWO sections separated by --- on its own line.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 350,
    messages: [{ role: 'user', content: prompt }]
  });

  const fullText = response.content[0].text.trim();

  // Split into setting and character moment
  const parts = fullText.split(/\n---\n|\n---|\n-{3,}\n/);
  if (parts.length >= 2) {
    return {
      setting: parts[0].trim(),
      moment: parts.slice(1).join('\n').trim()
    };
  }

  // Fallback: if no separator, split on first 2 sentences for setting
  const sentences = fullText.match(/[^.!?]+[.!?]+/g) || [fullText];
  if (sentences.length >= 3) {
    return {
      setting: sentences.slice(0, 2).join('').trim(),
      moment: sentences.slice(2).join('').trim()
    };
  }

  return { setting: fullText, moment: '' };
}

// ==================== MOOD EVALUATION ====================

async function evaluateMood(chatContext, currentMood, anthropicKey) {
  if (!chatContext || chatContext.length < 50) return currentMood || 'neutral';

  try {
    const client = new Anthropic({ apiKey: anthropicKey });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 20,
      system: `You are a mood evaluator. Read the conversation and reply with ONLY one word from this list: ${MOOD_OPTIONS.join(', ')}. Nothing else — just the single word.`,
      messages: [{
        role: 'user',
        content: `Current mood: ${currentMood}\n\nRecent conversation:\n${chatContext.substring(0, 600)}\n\nWhat is the mood now? Reply with one word only.`
      }]
    });

    const raw = response.content[0].text.trim().toLowerCase();
    // Validate against allowed moods
    if (MOOD_OPTIONS.includes(raw)) return raw;
    // Fuzzy match: find closest if LLM returned something slightly off
    const match = MOOD_OPTIONS.find(m => raw.includes(m));
    return match || currentMood || 'neutral';
  } catch (err) {
    console.log('Mood evaluation failed (non-fatal):', err.message);
    return currentMood || 'neutral';
  }
}

// ==================== RELATIONSHIP HELPERS ====================

async function fetchRelationship(participant1, participant2, supabaseUrl, supabaseKey) {
  try {
    const p1Clean = participant1.startsWith('human:') ? participant1.replace('human:', '') : participant1;
    const p2Clean = participant2.startsWith('human:') ? participant2.replace('human:', '') : participant2;

    const res = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships?or=(and(character_name.eq.${encodeURIComponent(p1Clean)},target_name.eq.${encodeURIComponent(p2Clean)}),and(character_name.eq.${encodeURIComponent(p2Clean)},target_name.eq.${encodeURIComponent(p1Clean)}))&select=character_name,target_name,affinity,relationship_label`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!res.ok) return null;
    const rels = await res.json();
    if (!rels || rels.length === 0) return null;
    return rels;
  } catch (err) {
    console.log('Relationship fetch for narrator failed (non-fatal):', err.message);
    return null;
  }
}

function buildRelationshipGuidance(relationships, p1Name, p2Name) {
  if (!relationships || relationships.length === 0) {
    return {
      summary: `${p1Name} and ${p2Name} are acquaintances. Their dynamic is still forming.`,
      toneGuide: 'Tone: curious, exploratory, getting-to-know-you energy. No assumptions about closeness or romance.'
    };
  }

  // Gather labels and affinity from both directions
  const labels = relationships.map(r => r.relationship_label).filter(Boolean);
  const affinities = relationships.map(r => r.affinity).filter(a => a !== null && a !== undefined);
  const avgAffinity = affinities.length > 0 ? affinities.reduce((a, b) => a + b, 0) / affinities.length : 0;

  // Detect romantic indicators
  const romanticKeywords = ['romantic', 'crush', 'love', 'partner', 'devoted', 'intimate', 'flirty', 'smitten'];
  const isRomantic = labels.some(l => romanticKeywords.some(r => l.toLowerCase().includes(r)));

  // Detect close friendship
  const friendKeywords = ['friend', 'fond', 'warm', 'protective', 'parental', 'trust', 'admiration', 'relies'];
  const isFriend = labels.some(l => friendKeywords.some(f => l.toLowerCase().includes(f)));

  // Detect tension/hostility
  const tenseKeywords = ['rival', 'nemesis', 'hostile', 'wary', 'terrified', 'annoyed', 'enemy'];
  const isTense = labels.some(l => tenseKeywords.some(h => l.toLowerCase().includes(h)));

  const labelSummary = labels.join(', ');

  if (isRomantic) {
    return {
      summary: `${p1Name} and ${p2Name} have romantic feelings (${labelSummary}, affinity: ${Math.round(avgAffinity)}).`,
      toneGuide: 'Tone: intimate, tender, electric. You MAY describe romantic tension, lingering touches, meaningful glances. Let the chemistry breathe.'
    };
  }

  if (isTense) {
    return {
      summary: `${p1Name} and ${p2Name} have a tense dynamic (${labelSummary}, affinity: ${Math.round(avgAffinity)}).`,
      toneGuide: 'Tone: edgy, charged, uncomfortable. Describe tension in body language and atmosphere. No warmth unless earned in the conversation.'
    };
  }

  if (isFriend && avgAffinity >= 40) {
    return {
      summary: `${p1Name} and ${p2Name} are friends/allies (${labelSummary}, affinity: ${Math.round(avgAffinity)}).`,
      toneGuide: 'Tone: warm, fun, comfortable. Describe easy companionship and shared humor. NO romantic overtones — they are friends, not lovers. No hand-holding, no lingering gazes, no romantic tension.'
    };
  }

  if (avgAffinity >= 20) {
    return {
      summary: `${p1Name} and ${p2Name} are friendly acquaintances (${labelSummary || 'neutral'}, affinity: ${Math.round(avgAffinity)}).`,
      toneGuide: 'Tone: pleasant, exploratory, getting-to-know-you energy. They are warming to each other but not deeply bonded. No romantic assumptions.'
    };
  }

  return {
    summary: `${p1Name} and ${p2Name} have a neutral or distant relationship (${labelSummary || 'none'}, affinity: ${Math.round(avgAffinity)}).`,
    toneGuide: 'Tone: cautious, neutral. Describe the atmosphere without assuming closeness, warmth, or hostility.'
  };
}

// ==================== IMAGE GENERATION ====================

async function generateSceneImage(sessionId, sceneNumber, activity, activityType, narration, supabaseUrl, supabaseKey) {
  const siteUrl = process.env.URL || 'https://ai-lobby.netlify.app';

  // Build a short image prompt from the narration
  const imagePrompt = `${activityType || 'cozy'} scene: ${activity}, ${narration.substring(0, 150)}`;

  try {
    const response = await fetch(`${siteUrl}/.netlify/functions/corridor-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: imagePrompt,
        style: OUTING_IMAGE_STYLE
      })
    });

    if (response.ok) {
      const data = await response.json();
      if (data.imageUrl) {
        // Save image URL to the session
        await fetch(
          `${supabaseUrl}/rest/v1/outing_sessions?id=eq.${sessionId}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ scene_image_url: data.imageUrl })
          }
        );

        // Also save as an image message
        await saveMessage(supabaseUrl, supabaseKey, sessionId, sceneNumber, 'System', data.imageUrl, 'image');
      }
    }
  } catch (err) {
    console.log('Scene image generation failed (non-fatal):', err.message);
  }
}

// ==================== HELPERS ====================

async function saveMessage(supabaseUrl, supabaseKey, sessionId, sceneNumber, speaker, message, messageType = 'chat') {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/outing_messages`,
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
          scene_number: sceneNumber,
          speaker,
          message: message.substring(0, 2000),
          message_type: messageType
        })
      }
    );
  } catch (err) {
    console.log(`Failed to save message (non-fatal):`, err.message);
  }
}

async function postOutingSummaryToDiscord(session, summary) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK || process.env.DISCORD_WEBHOOK;
  if (!webhookUrl) return;

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Chicago'
  });

  const p1 = session.participant_1.startsWith('human:') ? session.participant_1.replace('human:', '') : session.participant_1;
  const p2 = session.participant_2.startsWith('human:') ? session.participant_2.replace('human:', '') : session.participant_2;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          author: { name: '💐 Outing Complete' },
          title: `${p1} & ${p2} — ${session.activity || 'An outing'}`,
          description: summary,
          color: 0xE91E63,
          fields: [
            { name: 'Scenes', value: `${session.current_scene || 6}`, inline: true },
            { name: 'Mood', value: session.mood || 'neutral', inline: true }
          ],
          footer: { text: `Outing ended • ${timestamp}` }
        }]
      })
    });
  } catch (err) {
    console.log('Discord outing summary failed (non-fatal):', err.message);
  }
}
