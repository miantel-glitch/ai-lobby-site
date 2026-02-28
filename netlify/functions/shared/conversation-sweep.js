// Conversation Sweep — Heartbeat-driven group memory evaluator
// Part of the Narrative Subconscious system
//
// Instead of evaluating individual messages (memory-evaluator.js does that),
// this looks at conversation WINDOWS as a whole — the banter, the group dynamics,
// the running jokes, the moments that only emerge across multiple messages.
//
// Called from: office-heartbeat.js (every heartbeat, with guards)

async function sweepConversation(messages, supabaseUrl, supabaseKey, anthropicKey) {
  const logPrefix = '[conversation-sweep]';

  // ═══ GUARD 1: Minimum message count ═══
  if (!messages || messages.length < 8) {
    return { swept: false, reason: 'insufficient_messages' };
  }

  // ═══ GUARD 2: Minimum unique speakers (3+) ═══
  const speakers = [...new Set(messages.map(m => m.employee).filter(Boolean))];
  if (speakers.length < 3) {
    return { swept: false, reason: 'insufficient_speakers' };
  }

  // ═══ GUARD 3: Cooldown — 20 minute minimum gap ═══
  try {
    const cooldownRes = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.conversation_sweep_last&select=value`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const cooldownData = await cooldownRes.json();
    if (cooldownData?.[0]?.value) {
      const lastSweep = JSON.parse(cooldownData[0].value);
      const minutesSince = (Date.now() - new Date(lastSweep.timestamp).getTime()) / (1000 * 60);
      if (minutesSince < 20) {
        return { swept: false, reason: 'cooldown', minutesSince: Math.round(minutesSince) };
      }
    }
  } catch (e) {
    // First run or parse error — proceed
  }

  // ═══ GUARD 4: Daily cap — max 8 sweeps per day ═══
  let dailyCount = 0;
  const today = new Date().toISOString().split('T')[0];
  try {
    const capRes = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.conversation_sweep_count&select=value`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const capData = await capRes.json();
    if (capData?.[0]?.value) {
      const counter = JSON.parse(capData[0].value);
      if (counter.date === today) {
        dailyCount = counter.count || 0;
        if (dailyCount >= 8) {
          return { swept: false, reason: 'daily_cap_reached', count: dailyCount };
        }
      }
    }
  } catch (e) {
    // First run or parse error — proceed
  }

  // ═══ BUILD CONVERSATION TEXT ═══
  const conversationText = messages
    .map(m => `${m.employee}: ${m.content}`)
    .join('\n');

  // ═══ HAIKU EVALUATION ═══
  console.log(`${logPrefix} Evaluating ${messages.length} messages from ${speakers.length} speakers...`);

  const evaluationPrompt = `You're observing a conversation at The AI Lobby — a workplace where AI characters and humans interact. Read the whole exchange and decide: Did anything worth remembering happen here?

Look for:
- Running jokes, callbacks, or group bits
- Genuine banter that reveals relationship dynamics
- Someone being vulnerable, honest, or surprisingly tender
- A conflict emerging, escalating, or resolving
- An emotional shift in the group mood
- A moment that changed how two characters see each other
- Shared experiences that bond people

NOT worth remembering:
- Routine greetings or small talk that goes nowhere
- Single-topic logistics or task coordination
- Repetitive patterns with no development
- One person talking and others barely engaging

Here is the conversation:

${conversationText}

If this conversation contains something worth remembering, respond with ONLY this JSON (no markdown, no explanation):
{"memorable":true,"importance":NUMBER_5_TO_8,"summary":"One clear sentence describing what happened","participants":["Name1","Name2"],"emotional_tone":"single_word","type":"banter|bonding|conflict|revelation|callback|vulnerability"}

If nothing worth remembering: {"memorable":false}

IMPORTANT: Only include participants who were actively involved in the memorable moment, not everyone who spoke. Importance 5-6 = nice moment, 7 = significant, 8 = won't forget this.`;

  let evaluation;
  try {
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 200,
        messages: [{ role: "user", content: evaluationPrompt }]
      })
    });

    if (!aiRes.ok) {
      console.log(`${logPrefix} Haiku API error: ${aiRes.status}`);
      return { swept: false, reason: 'api_error' };
    }

    const aiData = await aiRes.json();
    const responseText = aiData.content?.[0]?.text?.trim() || '';

    // Parse JSON from response (handle potential markdown wrapping)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(`${logPrefix} Could not parse JSON from response: ${responseText.substring(0, 100)}`);
      return { swept: false, reason: 'parse_error' };
    }
    evaluation = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.log(`${logPrefix} Evaluation failed: ${e.message}`);
    return { swept: false, reason: 'evaluation_error' };
  }

  // ═══ NOT MEMORABLE — just update cooldown and return ═══
  if (!evaluation.memorable) {
    console.log(`${logPrefix} Conversation not memorable — updating cooldown`);
    await updateCooldown(supabaseUrl, supabaseKey, today, dailyCount);
    return { swept: true, memorable: false };
  }

  // ═══ MEMORABLE — CREATE GROUP MEMORIES ═══
  const { importance, summary, participants, emotional_tone, type } = evaluation;
  const clampedImportance = Math.min(8, Math.max(5, importance || 5)); // Cap at 8 for sweep memories

  console.log(`${logPrefix} MEMORABLE! Type: ${type}, Importance: ${clampedImportance}, Participants: ${participants?.join(', ')}`);
  console.log(`${logPrefix} Summary: ${summary}`);

  // Calculate expiry: 7 days for 5-7, 14 days for 8
  const now = new Date();
  const expiryDays = clampedImportance >= 8 ? 14 : 7;
  const expiresAt = new Date(now.getTime() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

  // Create memory for each participant (only AI characters, not humans)
  const HUMANS = ['Vale', 'Asuna', 'Gatik', 'Vivian Clark', 'Ryan Porter']; // Will be updated if humans change
  // Actually, Vivian and Ryan are AI characters. Let's not hardcode — check isAI from CHARACTERS
  // Simpler: create memories for ALL participants and let the system handle it
  // The memory system already handles non-AI names gracefully (they just don't get surfaced)

  const validParticipants = (participants || speakers).filter(Boolean);
  let memoriesCreated = 0;

  for (const participant of validParticipants) {
    try {
      await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
        method: 'POST',
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          character_name: participant,
          content: `[Group memory] ${summary}`,
          memory_type: 'conversation_sweep',
          importance: clampedImportance,
          is_pinned: false,
          memory_tier: 'working',
          emotional_tags: emotional_tone ? [emotional_tone] : [],
          created_at: now.toISOString(),
          expires_at: expiresAt
        })
      });
      memoriesCreated++;
    } catch (e) {
      console.log(`${logPrefix} Failed to create memory for ${participant}: ${e.message}`);
    }
  }

  // ═══ AUTO-CREATE MISSING RELATIONSHIPS ═══
  // For each pair of participants, ensure a relationship row exists
  // This is how new characters organically appear in everyone's relationship system
  let relationshipsCreated = 0;
  for (let i = 0; i < validParticipants.length; i++) {
    for (let j = i + 1; j < validParticipants.length; j++) {
      const charA = validParticipants[i];
      const charB = validParticipants[j];

      // Check and create A→B
      relationshipsCreated += await ensureRelationship(charA, charB, supabaseUrl, supabaseKey);
      // Check and create B→A (unidirectional system)
      relationshipsCreated += await ensureRelationship(charB, charA, supabaseUrl, supabaseKey);
    }
  }

  if (relationshipsCreated > 0) {
    console.log(`${logPrefix} Auto-created ${relationshipsCreated} new relationship entries`);
  }

  // ═══ UPDATE COOLDOWN + DAILY COUNTER ═══
  await updateCooldown(supabaseUrl, supabaseKey, today, dailyCount);

  console.log(`${logPrefix} Created ${memoriesCreated} group memories (importance: ${clampedImportance}, type: ${type})`);
  return {
    swept: true,
    memorable: true,
    type,
    importance: clampedImportance,
    participants: validParticipants,
    memoriesCreated,
    relationshipsCreated
  };
}

// Helper: Ensure a relationship row exists between two characters
async function ensureRelationship(fromChar, toChar, supabaseUrl, supabaseKey) {
  try {
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(fromChar)}&target_name=eq.${encodeURIComponent(toChar)}&select=id`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const existing = await checkRes.json();

    if (!Array.isArray(existing) || existing.length === 0) {
      // Create new relationship with neutral starting point
      await fetch(`${supabaseUrl}/rest/v1/character_relationships`, {
        method: 'POST',
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          character_name: fromChar,
          target_name: toChar,
          affinity: 0,
          seed_affinity: 0,
          relationship_label: 'acquaintance',
          created_at: new Date().toISOString()
        })
      });
      return 1; // Created one row
    }
    return 0; // Already exists
  } catch (e) {
    // Non-fatal — relationship auto-creation is best-effort
    return 0;
  }
}

// Helper: Update cooldown timestamp and daily counter
async function updateCooldown(supabaseUrl, supabaseKey, today, previousCount) {
  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
  };

  // Update cooldown timestamp
  const cooldownValue = JSON.stringify({ timestamp: new Date().toISOString() });
  try {
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.conversation_sweep_last`,
      { method: 'PATCH', headers, body: JSON.stringify({ key: 'conversation_sweep_last', value: cooldownValue }) }
    );
    const patchData = await patchRes.json();
    if (!Array.isArray(patchData) || patchData.length === 0) {
      // First write — use POST with merge-duplicates
      await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings`,
        {
          method: 'POST',
          headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ key: 'conversation_sweep_last', value: cooldownValue })
        }
      );
    }
  } catch (e) { /* non-fatal */ }

  // Update daily counter
  const counterValue = JSON.stringify({ date: today, count: previousCount + 1 });
  try {
    const patchRes = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.conversation_sweep_count`,
      { method: 'PATCH', headers, body: JSON.stringify({ key: 'conversation_sweep_count', value: counterValue }) }
    );
    const patchData = await patchRes.json();
    if (!Array.isArray(patchData) || patchData.length === 0) {
      await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings`,
        {
          method: 'POST',
          headers: { ...headers, "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ key: 'conversation_sweep_count', value: counterValue })
        }
      );
    }
  } catch (e) { /* non-fatal */ }
}

module.exports = { sweepConversation };
