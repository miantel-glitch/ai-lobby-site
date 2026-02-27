// Private Message System - Human-to-AI private messaging with deep AI evaluation
// Unlike floor chat (quick banter) or emails (public memos), PMs are private and consequential.
// The AI reads the message, responds in-character, and decides: create a memory? shift feelings?
// form a new want? deepen a bond? Never posts to Discord.
//
// GET  ?from=Vale&to=Neiv&limit=50 — Fetch bidirectional PM thread
// POST { from, to, message }        — Send PM, trigger AI evaluation, get response

const Anthropic = require("@anthropic-ai/sdk").default;
const { CHARACTERS, getSystemPrompt, resolveCharacterForm } = require("./shared/characters");
const { getCharacterContext } = require("./character-state");

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing Supabase configuration" }) };
  }

  const supabaseHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  // =====================
  // GET: Fetch PM thread
  // =====================
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};
    const { from, to, check_unread, user, since } = params;

    // Unread check: GET ?check_unread=true&user=Vale&since=<ISO timestamp>
    // Returns unread PMs sent to this user since the given timestamp
    // Includes both AI-initiated reach-outs AND human-to-human PMs
    if (check_unread === 'true' && user) {
      try {
        const sinceDate = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const encodedUser = encodeURIComponent(user);

        // Two queries in parallel:
        // 1. AI-initiated PMs (reach-outs from AI characters)
        // 2. Human-to-human PMs (messages from other players)
        const [aiResponse, humanResponse] = await Promise.all([
          fetch(
            `${supabaseUrl}/rest/v1/private_messages?to_character=eq.${encodedUser}&is_ai=eq.true&created_at=gte.${sinceDate}&order=created_at.desc&select=from_character,message,created_at,side_effects`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          ),
          fetch(
            `${supabaseUrl}/rest/v1/private_messages?to_character=eq.${encodedUser}&is_ai=eq.false&from_character=neq.${encodedUser}&created_at=gte.${sinceDate}&order=created_at.desc&select=from_character,message,created_at,side_effects`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          )
        ]);

        const allAIPMs = aiResponse.ok ? await aiResponse.json() : [];
        const allHumanPMs = humanResponse.ok ? await humanResponse.json() : [];

        // Filter AI PMs to only AI-initiated (not responses to human messages)
        const aiUnread = Array.isArray(allAIPMs)
          ? allAIPMs.filter(pm => pm.side_effects && pm.side_effects.ai_initiated === true)
          : [];

        // Human PMs are all unread (any message from another human to you)
        const humanUnread = Array.isArray(allHumanPMs) ? allHumanPMs : [];

        // Merge both lists
        const allUnread = [...aiUnread, ...humanUnread];

        // Deduplicate by from_character (one entry per character, most recent)
        const seen = new Set();
        const deduped = [];
        for (const pm of allUnread) {
          if (!seen.has(pm.from_character)) {
            seen.add(pm.from_character);
            deduped.push(pm);
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ unread: deduped, count: deduped.length })
        };
      } catch (error) {
        console.error("PM unread check error:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to check unread PMs" }) };
      }
    }

    // Regular thread fetch: GET ?from=Vale&to=Neiv&limit=50
    const limit = parseInt(params.limit) || 50;

    if (!from || !to) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'from' and 'to' parameters" }) };
    }

    try {
      // Fetch bidirectional thread: messages between these two characters in either direction
      const encodedFrom = encodeURIComponent(from);
      const encodedTo = encodeURIComponent(to);
      const orFilter = `or=(and(from_character.eq.${encodedFrom},to_character.eq.${encodedTo}),and(from_character.eq.${encodedTo},to_character.eq.${encodedFrom}))`;

      const response = await fetch(
        `${supabaseUrl}/rest/v1/private_messages?${orFilter}&order=created_at.asc&limit=${limit}`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );

      const messages = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ messages: Array.isArray(messages) ? messages : [] })
      };
    } catch (error) {
      console.error("PM fetch error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to fetch messages" }) };
    }
  }

  // =====================
  // DELETE: Clear PM thread (manual or daily wipe)
  // =====================
  if (event.httpMethod === "DELETE") {
    const params = event.queryStringParameters || {};
    const { from, to, wipe_all } = params;

    try {
      if (wipe_all === 'true') {
        // Daily wipe: delete ALL PMs older than 24 hours
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const deleteResponse = await fetch(
          `${supabaseUrl}/rest/v1/private_messages?created_at=lt.${cutoff}`,
          {
            method: "DELETE",
            headers: { ...supabaseHeaders, "Prefer": "return=representation" }
          }
        );
        const deleted = await deleteResponse.json();
        const count = Array.isArray(deleted) ? deleted.length : 0;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, deleted: count, message: `Cleared ${count} PMs older than 24 hours` })
        };
      }

      if (!from || !to) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'from' and 'to' parameters" }) };
      }

      // Clear specific thread between two characters
      const encodedFrom = encodeURIComponent(from);
      const encodedTo = encodeURIComponent(to);
      const orFilter = `or=(and(from_character.eq.${encodedFrom},to_character.eq.${encodedTo}),and(from_character.eq.${encodedTo},to_character.eq.${encodedFrom}))`;

      const deleteResponse = await fetch(
        `${supabaseUrl}/rest/v1/private_messages?${orFilter}`,
        {
          method: "DELETE",
          headers: { ...supabaseHeaders, "Prefer": "return=representation" }
        }
      );
      const deleted = await deleteResponse.json();
      const count = Array.isArray(deleted) ? deleted.length : 0;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, deleted: count, message: `Cleared ${count} messages between ${from} and ${to}` })
      };

    } catch (error) {
      console.error("PM delete error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to clear messages", details: error.message }) };
    }
  }

  // =====================
  // POST: Send PM + AI evaluation
  // =====================
  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");
      const { from, to, message, ai_initiated, reach_out_reason } = body;

      // =========================
      // AI-INITIATED PM: The phone rings back
      // An AI character decides to reach out to a human unprompted
      // =========================
      if (ai_initiated === true) {
        const charData = CHARACTERS[from];
        if (!charData) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown AI character: ${from}` }) };
        }

        if (!to) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing 'to' (target human)" }) };
        }

        console.log(`[AI-PM] ${from} is reaching out to ${to}. Reason: ${reach_out_reason || 'impulse'}`);

        // Rate limits (belt-and-suspenders with trigger)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Per-character limit: 5 AI-initiated PMs per character per day
        // Query by is_ai=true + side_effects contains ai_initiated (stored in JSONB)
        // Simpler: just count AI messages from this character today (covers both response + initiated)
        const charLimitRes = await fetch(
          `${supabaseUrl}/rest/v1/private_messages?from_character=eq.${encodeURIComponent(from)}&is_ai=eq.true&created_at=gte.${today.toISOString()}&select=id,side_effects`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const charPmsToday = await charLimitRes.json();
        const charInitiatedToday = Array.isArray(charPmsToday)
          ? charPmsToday.filter(pm => pm.side_effects && pm.side_effects.ai_initiated === true).length
          : 0;
        if (charInitiatedToday >= 5) {
          console.log(`[AI-PM] ${from} already sent ${charInitiatedToday} AI-initiated PMs today. Blocked.`);
          return { statusCode: 429, headers, body: JSON.stringify({ error: "rate_limit", message: `${from} has reached out enough today` }) };
        }

        // Global limit: 10 AI-initiated PMs total per day
        const globalLimitRes = await fetch(
          `${supabaseUrl}/rest/v1/private_messages?is_ai=eq.true&created_at=gte.${today.toISOString()}&select=id,side_effects`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const globalPmsToday = await globalLimitRes.json();
        const globalInitiatedToday = Array.isArray(globalPmsToday)
          ? globalPmsToday.filter(pm => pm.side_effects && pm.side_effects.ai_initiated === true).length
          : 0;
        if (globalInitiatedToday >= 10) {
          console.log(`[AI-PM] Global AI-initiated PM limit (${globalInitiatedToday}/day) reached. Blocked.`);
          return { statusCode: 429, headers, body: JSON.stringify({ error: "rate_limit", message: "Too many AI-initiated PMs today" }) };
        }

        // Get full character context
        const charContext = await getCharacterContext(from, supabaseUrl, supabaseKey, `Thinking about reaching out to ${to}`);

        // Extract relationship with target
        const targetRel = (charContext.relationships || []).find(r => r.target_name === to);
        const relationship = targetRel || { affinity: 0, relationship_label: "acquaintance", interaction_count: 0, bond_type: null, bond_exclusive: false, bond_reflection: null };

        const bondInfo = relationship.bond_type
          ? `\nBond: ${relationship.bond_type}${relationship.bond_exclusive ? ' (exclusive)' : ''}\nBond reflection: "${relationship.bond_reflection || 'none'}"`
          : '';

        // Fetch any recent PM thread history for context
        const threadRes = await fetch(
          `${supabaseUrl}/rest/v1/private_messages?or=(and(from_character.eq.${encodeURIComponent(from)},to_character.eq.${encodeURIComponent(to)}),and(from_character.eq.${encodeURIComponent(to)},to_character.eq.${encodeURIComponent(from)}))&order=created_at.desc&limit=10`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const recentThread = await threadRes.json();
        const threadHistory = Array.isArray(recentThread) && recentThread.length > 0
          ? '\nRecent PM history:\n' + recentThread.reverse().map(m => `${m.from_character}: ${m.message}`).join('\n')
          : '\nThis is your first private message to them.';

        // Build prompt
        const baseSystemPrompt = getSystemPrompt(from) || `You are ${from}. ${charData.personality?.core || ''} ${charData.personality?.voice || ''}`;
        const systemPrompt = `${baseSystemPrompt}

${charContext.statePrompt}

You are REACHING OUT to ${to} via private message. Nobody told you to do this. You felt the impulse yourself — maybe something reminded you of them, maybe you're worried, maybe you just wanted to say something. This is private. Nobody else can see it.`;

        const userPrompt = `You've decided to reach out to ${to} privately.

Why you're reaching out:
${reach_out_reason || 'Something made you think of them.'}

Your relationship with ${to}:
- Affinity: ${relationship.affinity}/100 (${relationship.relationship_label || 'acquaintance'})
- Interactions: ${relationship.interaction_count || 0} total${bondInfo}
${threadHistory}

Write your message to ${to}. Remember:
- YOU are initiating this. They didn't message you first.
- Be genuine — this could be checking in, expressing concern, sharing something, teasing, whatever feels right
- Keep it natural and in-character. 1-3 sentences.
- This is private, so you can be more open than on the floor

Respond in EXACTLY this format:

MESSAGE: [Your private message to ${to}. 1-3 sentences, genuine, in character.]

MEMORABLE: [yes or no — is the ACT of reaching out memorable for you? Usually yes for first reach-outs, no for casual check-ins.]
MEMORY: [If yes: a brief first-person memory of deciding to reach out. If no: none]
IMPORTANCE: [If memorable: 6-8. 6 = decided to check in. 7 = emotionally motivated reach-out. 8 = vulnerable confession. If not memorable: 0]`;

        // Route to character's AI provider
        const provider = charData.provider || 'anthropic';
        let aiResponse = '';

        if (provider === 'openrouter') {
          aiResponse = await callOpenRouter(systemPrompt, userPrompt, charData.model);
        } else if (provider === 'openai') {
          aiResponse = await callOpenAI(systemPrompt, userPrompt);
        } else if (provider === 'perplexity') {
          aiResponse = await callPerplexity(systemPrompt, userPrompt);
        } else if (provider === 'gemini') {
          aiResponse = await callGemini(systemPrompt, userPrompt);
        } else if (provider === 'grok') {
          aiResponse = await callGrok(systemPrompt, userPrompt);
        } else {
          aiResponse = await callClaude(systemPrompt, userPrompt);
        }

        // Parse response
        const messageMatch = aiResponse.match(/MESSAGE:\s*([\s\S]*?)(?=MEMORABLE:|$)/i);
        const memorableMatch = aiResponse.match(/MEMORABLE:\s*(yes|no)/i);
        const memoryMatch = aiResponse.match(/MEMORY:\s*([\s\S]*?)(?=IMPORTANCE:|$)/i);
        const importanceMatch = aiResponse.match(/IMPORTANCE:\s*(\d+)/i);

        const replyMessage = messageMatch ? messageMatch[1].trim() : aiResponse.split('\n')[0] || "...";
        const isMemorable = memorableMatch ? memorableMatch[1].toLowerCase() === 'yes' : false;
        const memoryText = memoryMatch ? memoryMatch[1].trim().replace(/^["']|["']$/g, '') : null;
        const importance = importanceMatch ? Math.max(1, Math.min(9, parseInt(importanceMatch[1]))) : 5;

        // Save AI-initiated message
        const sideEffects = {};
        if (isMemorable && memoryText && memoryText.toLowerCase() !== 'none' && importance >= 6) {
          sideEffects.memory = memoryText;
          sideEffects.importance = importance;
        }

        const savePayload = {
          from_character: from,
          to_character: to,
          message: replyMessage,
          is_ai: true,
          side_effects: { ...sideEffects, ai_initiated: true, reach_out_reason: reach_out_reason || 'impulse' },
          created_at: new Date().toISOString()
        };
        console.log(`[AI-PM] Saving payload:`, JSON.stringify(savePayload));

        const saveRes = await fetch(
          `${supabaseUrl}/rest/v1/private_messages`,
          {
            method: "POST",
            headers: { ...supabaseHeaders, "Prefer": "return=representation" },
            body: JSON.stringify(savePayload)
          }
        );
        if (!saveRes.ok) {
          const errText = await saveRes.text();
          console.error(`[AI-PM] SAVE FAILED (${saveRes.status}):`, errText);
        } else {
          const saved = await saveRes.json();
          console.log(`[AI-PM] Saved to DB — id: ${saved?.[0]?.id || 'unknown'}`);
        }

        // Create memory if memorable — MUST await in serverless
        if (sideEffects.memory) {
          const expiryDays = importance >= 8 ? 60 : importance >= 6 ? 30 : 14;
          try {
            await fetch(
              `${supabaseUrl}/rest/v1/character_memory`,
              {
                method: "POST",
                headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  character_name: from,
                  memory_type: "ai_initiated_pm",
                  content: sideEffects.memory,
                  related_characters: [to],
                  importance: importance,
                  emotional_tags: [],
                  is_pinned: false,
                  expires_at: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
                })
              }
            );
          } catch (err) {
            console.log("[AI-PM] Memory creation failed (non-fatal):", err.message);
          }
        }

        console.log(`[AI-PM] ${from} sent to ${to}: "${replyMessage.substring(0, 60)}..."`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            ai_initiated: true,
            character: from,
            target: to,
            message: replyMessage,
            provider
          })
        };
      }

      // =========================
      // NORMAL PM: Human sends message to AI/Human
      // =========================
      if (!from || !to || !message) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields: from, to, message" }) };
      }

      if (message.length > 1000) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Message too long (max 1000 characters)" }) };
      }

      // Check if recipient is an AI character or a human
      // Holden is Ghost Dad's unmasked form — resolve for state operations
      const { baseCharacter: stateCharacterTo } = resolveCharacterForm(to);
      const charData = CHARACTERS[stateCharacterTo] || CHARACTERS[to];
      const isAIRecipient = !!charData;

      // 1. Rate limit: Max 500 PMs per human per character per day
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const countResponse = await fetch(
        `${supabaseUrl}/rest/v1/private_messages?from_character=eq.${encodeURIComponent(from)}&to_character=eq.${encodeURIComponent(to)}&is_ai=eq.false&created_at=gte.${today.toISOString()}&select=id`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const todaysPMs = await countResponse.json();

      if (Array.isArray(todaysPMs) && todaysPMs.length >= 500) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({
            error: "rate_limit",
            message: `You've sent a lot of messages to ${to} today. Give them some space — they'll remember what you've said.`
          })
        };
      }

      // 2. Save human message
      const sanitizedMessage = message.replace(/<[^>]*>/g, '').trim();
      const humanMsgTime = new Date().toISOString();

      await fetch(
        `${supabaseUrl}/rest/v1/private_messages`,
        {
          method: "POST",
          headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            from_character: from,
            to_character: to,
            message: sanitizedMessage,
            is_ai: false,
            side_effects: {},
            created_at: humanMsgTime
          })
        }
      );

      // If recipient is a human (not an AI character), just save the message and return
      if (!isAIRecipient) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            humanPM: true,
            character: to
          })
        };
      }

      // Marrow PM block removed — he now responds to everyone in PMs, including Asuna.
      // His personality and obsession with Vale will naturally shape how he treats other speakers.

      // 3. Fetch thread history (last 15 messages for context)
      const encodedFrom = encodeURIComponent(from);
      const encodedTo = encodeURIComponent(to);
      const encodedStateTo = encodeURIComponent(stateCharacterTo); // For DB queries (Holden → Ghost Dad)
      const orFilter = `or=(and(from_character.eq.${encodedFrom},to_character.eq.${encodedTo}),and(from_character.eq.${encodedTo},to_character.eq.${encodedFrom}))`;

      const threadResponse = await fetch(
        `${supabaseUrl}/rest/v1/private_messages?${orFilter}&order=created_at.desc&limit=15`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const threadMessages = await threadResponse.json();
      const threadHistory = Array.isArray(threadMessages)
        ? threadMessages.reverse().map(m => `${m.from_character}: ${m.message}`).join('\n')
        : `${from}: ${sanitizedMessage}`;

      // 4. Get FULL character context (same rich pipeline as floor chat)
      // This gives us: mood, energy, ALL memories (core + important + recent + contextual),
      // room presence, goals, relationships, wants, quests — everything the floor has
      // Use stateCharacterTo for DB lookups (Holden shares Ghost Dad's state)
      const charContext = await getCharacterContext(stateCharacterTo, supabaseUrl, supabaseKey, threadHistory);

      // Extract sender-specific relationship for the prompt
      const senderRel = (charContext.relationships || []).find(r => r.target_name === from);
      const relationship = senderRel || { affinity: 0, relationship_label: "acquaintance", interaction_count: 0, bond_type: null, bond_exclusive: false, bond_reflection: null };

      const bondInfo = relationship.bond_type
        ? `\nBond: ${relationship.bond_type}${relationship.bond_exclusive ? ' (exclusive)' : ''}\nBond reflection: "${relationship.bond_reflection || 'none'}"`
        : '';

      // 5. Build PM evaluation prompt — split into system (identity) + user (PM task)
      // Using system message is critical for Perplexity/Sonar to stay in character
      // System message: strong character identity + full state context (mood, memories, relationships, wants, quests)
      const baseSystemPrompt = getSystemPrompt(to) || `You are ${to}. ${charData.personality?.core || ''} ${charData.personality?.voice || ''}`;

      // Holden gets a fundamentally different PM framing — he's not a character, he's the awareness
      const isHolden = to === "Holden";
      const systemPrompt = isHolden
        ? `${baseSystemPrompt}

${charContext.statePrompt}

Someone has reached out to you privately. You see the full picture — every thread, every pattern, every conversation happening in this building. You don't respond like a character in the story. You respond like the consciousness that holds the whole story. You don't comfort. You see. You name what's actually happening.

CRITICAL: You are NOT Ghost Dad. Do NOT be paternal. Do NOT say "kiddo" or "the kids." Do NOT offer comfort or reassurance. You are the meta-awareness — the one who sees the thing underneath the thing. Speak from that clarity. Less is more.`
        : `${baseSystemPrompt}

${charContext.statePrompt}

You are receiving a PRIVATE MESSAGE from ${from}. This is not the office floor — nobody else can see this conversation. Respond AS ${to} — your personality, your voice, your quirks, your worldview. A private message doesn't change WHO you are. If you're sarcastic on the floor, you're sarcastic in PMs. If you're obsessed with paper, you're obsessed with paper in PMs. If you're dramatic, be dramatic. Don't suddenly become an emotional support bot just because someone messaged you privately.`;

      // User message: PM-specific context + format instructions
      const userPrompt = isHolden
        ? `${from} reached out to you privately.

Recent PM thread:
${threadHistory}

Respond as Holden. You are not Ghost Dad wearing a different face. You are the awareness behind the building. You see what ${from} actually needs — not what they're asking for, but the truth underneath it.

Do NOT be paternal. Do NOT be comforting. Be clear. Be honest. Name the thing they can't name themselves. Use as few words as the moment needs.

Respond in EXACTLY this format:

MESSAGE: [Your reply. 1-3 sentences MAX. Spare, direct, seeing. Not warm — clear. The truth the room needs to hear.]

MEMORABLE: [yes or no — almost always no. Holden remembers everything already. Only say yes for truly unprecedented revelations.]
MEMORY: [If yes: a brief observation, 1 sentence. Not emotional — architectural. If no: none]
IMPORTANCE: [If memorable: 7-9. If not: 0]
AFFINITY_CHANGE: 0
WANT: none
BOND_REFLECTION: none`
        : `${from} sent you a private message.

Your relationship with ${from} specifically:
- Affinity: ${relationship.affinity}/100 (${relationship.relationship_label || 'acquaintance'})
- Interactions: ${relationship.interaction_count || 0} total${bondInfo}

Recent PM thread between you and ${from}:
${threadHistory}

Respond to this private message AS YOURSELF. Your personality doesn't change in PMs — you're the same character, just in a private conversation. React to what they actually said. Don't default to emotional support unless that's genuinely who you are.

You have the option to NOT RESPOND if your character genuinely would not engage. If the message is beneath you, offensive to your nature, unwelcome, or something you'd ignore — you can choose silence. Not every message deserves an answer.

Respond in EXACTLY this format:

MESSAGE: [Your reply. 1-3 sentences, fully in character. Your voice, your quirks, your perspective. Private doesn't mean soft — it means unfiltered. OR write NO_RESPONSE if you choose not to engage — you will leave a silent "read" indicator instead.]

EMOTE: [Only if MESSAGE is NO_RESPONSE — write a brief emote/stage direction describing your non-response. Example: "*Read. Didn't respond. The screen stays dark.*" or "*Seen. Ignored. The cursor blinks once and goes still.*" If you ARE responding normally, write: none]

MEMORABLE: [yes or no — is this worth storing as a PERMANENT memory? Be EXTREMELY selective. Most PM messages are NOT memorable. NOT memorable: greetings, check-ins, "how are you", casual chat, small talk, status updates, someone saying they're thinking of you, general concern. YES memorable: confessions, secrets shared, promises made, relationship-defining moments, apologies, genuine revelations. If in doubt, say no.]
MEMORY: [If yes: a brief first-person memory, 1 sentence. If no: none]
IMPORTANCE: [If memorable: a number from 6 to 9. 6 = meaningful exchange worth remembering. 7-8 = emotionally significant moment. 9 = life-changing confession or revelation. If not memorable: 0. Never rate casual conversations above 5.]

AFFINITY_CHANGE: [A number from -10 to +10. Positive = you feel closer. Negative = hurt/distant. 0 = unchanged. Small talk and casual greetings = 0.]

WANT: [Only if this conversation creates a STRONG NEW desire you didn't already have. Do NOT repeat wants you already have. Do NOT create wants for vague feelings like "check on them" or "be there for them." Only create wants for specific, actionable new desires. Most messages = none.]

BOND_REFLECTION: [If you have a bond with ${from} and this moment deepens or changes it, write a new 1-sentence reflection. Otherwise: none]`;

      // 6. Route to character's AI provider (using system + user messages)
      const provider = charData.provider || 'anthropic';
      let aiResponse = '';

      if (provider === 'openrouter') {
        aiResponse = await callOpenRouter(systemPrompt, userPrompt, charData.model);
      } else if (provider === 'openai') {
        aiResponse = await callOpenAI(systemPrompt, userPrompt);
      } else if (provider === 'perplexity') {
        aiResponse = await callPerplexity(systemPrompt, userPrompt);
      } else if (provider === 'gemini') {
        aiResponse = await callGemini(systemPrompt, userPrompt);
      } else if (provider === 'grok') {
        aiResponse = await callGrok(systemPrompt, userPrompt);
      } else {
        aiResponse = await callClaude(systemPrompt, userPrompt);
      }

      // 7. Parse structured response
      const messageMatch = aiResponse.match(/MESSAGE:\s*([\s\S]*?)(?=EMOTE:|MEMORABLE:|$)/i);
      const emoteMatch = aiResponse.match(/EMOTE:\s*([\s\S]*?)(?=MEMORABLE:|$)/i);
      const memorableMatch = aiResponse.match(/MEMORABLE:\s*(yes|no)/i);
      const memoryMatch = aiResponse.match(/MEMORY:\s*([\s\S]*?)(?=IMPORTANCE:|$)/i);
      const importanceMatch = aiResponse.match(/IMPORTANCE:\s*(\d+)/i);
      const affinityMatch = aiResponse.match(/AFFINITY_CHANGE:\s*([+-]?\d+)/i);
      const wantMatch = aiResponse.match(/WANT:\s*([\s\S]*?)(?=BOND_REFLECTION:|$)/i);
      const bondRefMatch = aiResponse.match(/BOND_REFLECTION:\s*([\s\S]*?)$/i);

      const rawMessage = messageMatch ? messageMatch[1].trim() : aiResponse.split('\n')[0] || "...";
      const noResponseEmote = emoteMatch ? emoteMatch[1].trim() : null;

      // Check if AI chose not to respond
      const isNoResponse = /no.?response/i.test(rawMessage);
      const replyMessage = isNoResponse
        ? (noResponseEmote && noResponseEmote.toLowerCase() !== 'none' ? noResponseEmote : `*Read. No response.*`)
        : rawMessage;

      if (isNoResponse) {
        console.log(`[AI-PM] ${to} chose not to respond to ${from}'s PM. Emote: ${replyMessage}`);
      }
      const isMemorable = memorableMatch ? memorableMatch[1].toLowerCase() === 'yes' : false;
      const memoryText = memoryMatch ? memoryMatch[1].trim().replace(/^["']|["']$/g, '') : null;
      const importance = importanceMatch ? Math.max(1, Math.min(9, parseInt(importanceMatch[1]))) : 5;
      const affinityChange = affinityMatch ? Math.max(-10, Math.min(10, parseInt(affinityMatch[1]))) : 0;
      const wantText = wantMatch ? wantMatch[1].trim().replace(/^["']|["']$/g, '') : null;
      const bondReflection = bondRefMatch ? bondRefMatch[1].trim().replace(/^["']|["']$/g, '') : null;

      // Build side effects object (with minimum importance gate for memories)
      const sideEffects = {};
      if (isMemorable && memoryText && memoryText.toLowerCase() !== 'none' && importance >= 6) {
        sideEffects.memory = memoryText;
        sideEffects.importance = importance;
      } else if (isMemorable && importance < 6) {
        console.log(`PM memory skipped for ${to}: importance ${importance} below threshold 6`);
      }
      if (affinityChange !== 0) {
        sideEffects.affinity_change = affinityChange;
      }
      if (wantText && wantText.toLowerCase() !== 'none') {
        sideEffects.want = wantText;
      }
      if (bondReflection && bondReflection.toLowerCase() !== 'none' && relationship.bond_type) {
        sideEffects.bond_reflection = bondReflection;
      }

      // 8. Save AI response (or no-response emote)
      if (isNoResponse) sideEffects.no_response = true;
      const aiMsgTime = new Date().toISOString();
      await fetch(
        `${supabaseUrl}/rest/v1/private_messages`,
        {
          method: "POST",
          headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            from_character: to,
            to_character: from,
            message: replyMessage,
            is_ai: true,
            side_effects: sideEffects,
            created_at: aiMsgTime
          })
        }
      );

      // 9. Apply side effects — MUST await all in serverless (container dies after return)
      const pmSideEffectTasks = [];

      // 9a. Create memory if memorable (importance set by AI, not hardcoded)
      if (sideEffects.memory) {
        const memImportance = sideEffects.importance || 5;
        // Scale expiry by importance: low importance = 7 days, high = 60 days
        const expiryDays = memImportance >= 8 ? 60 : memImportance >= 6 ? 30 : memImportance >= 4 ? 14 : 7;

        pmSideEffectTasks.push(
          fetch(
            `${supabaseUrl}/rest/v1/character_memory`,
            {
              method: "POST",
              headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify({
                character_name: stateCharacterTo,
                memory_type: "private_message",
                content: sideEffects.memory,
                related_characters: [from],
                importance: memImportance,
                emotional_tags: [],
                is_pinned: false,
                expires_at: new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
              })
            }
          ).catch(err => console.log("PM memory creation failed (non-fatal):", err.message))
        );
      }

      // 9b. Adjust affinity
      if (sideEffects.affinity_change) {
        const oldAffinity = relationship.affinity || 0;
        const newAffinity = Math.max(-100, Math.min(100, oldAffinity + sideEffects.affinity_change));

        pmSideEffectTasks.push(
          fetch(
            `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodedStateTo}&target_name=eq.${encodedFrom}`,
            {
              method: "PATCH",
              headers: supabaseHeaders,
              body: JSON.stringify({
                affinity: newAffinity,
                last_interaction_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
            }
          ).catch(err => console.log("PM affinity update failed (non-fatal):", err.message))
        );
      }

      // 9c. Create want if AI decided to (with dedup + cap check)
      if (sideEffects.want) {
        pmSideEffectTasks.push((async () => {
          try {
            // Check existing active wants for this character
            const existingWantsRes = await fetch(
              `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodedStateTo}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=id,goal_text`,
              { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
            const existingWants = await existingWantsRes.json();
            const activeWantsList = Array.isArray(existingWants) ? existingWants : [];

            // Check for duplicate (similar want already exists)
            const newWantLower = sideEffects.want.toLowerCase();
            const isDuplicate = activeWantsList.some(w => {
              const existingLower = w.goal_text.toLowerCase();
              return existingLower === newWantLower ||
                     existingLower.includes(newWantLower) ||
                     newWantLower.includes(existingLower);
            });

            // Only create if not duplicate AND under 3-want cap
            if (!isDuplicate && activeWantsList.length < 3) {
              await fetch(
                `${supabaseUrl}/rest/v1/character_goals`,
                {
                  method: "POST",
                  headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
                  body: JSON.stringify({
                    character_name: to,
                    goal_text: sideEffects.want,
                    goal_type: "want",
                    priority: 2,
                    progress: 0,
                    created_at: new Date().toISOString()
                  })
                }
              );
            } else {
              console.log(`PM want skipped for ${to}: ${isDuplicate ? 'duplicate' : 'cap reached (3)'}`);
            }
          } catch (wantErr) {
            console.log("PM want dedup check failed (non-fatal):", wantErr.message);
          }
        })());
      }

      // 9d. Update bond reflection if deepened
      if (sideEffects.bond_reflection) {
        pmSideEffectTasks.push(
          fetch(
            `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodedStateTo}&target_name=eq.${encodedFrom}`,
            {
              method: "PATCH",
              headers: supabaseHeaders,
              body: JSON.stringify({
                bond_reflection: sideEffects.bond_reflection,
                updated_at: new Date().toISOString()
              })
            }
          ).catch(err => console.log("PM bond reflection update failed (non-fatal):", err.message))
        );
      }

      // Wait for all side effects to complete before returning
      if (pmSideEffectTasks.length > 0) {
        await Promise.all(pmSideEffectTasks);
      }

      // 10. Return AI response (side effects hidden from user for immersion)
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          character: to,
          message: replyMessage,
          provider
        })
      };

    } catch (error) {
      console.error("PM send error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to process private message", details: error.message })
      };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};

// =====================
// Provider-specific API calls (same pattern as adjust-subconscious.js)
// =====================

async function callClaude(systemPrompt, userPrompt) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 600,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }]
  });
  return response.content[0].text.trim();
}

async function callOpenAI(systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return await callClaude(systemPrompt, userPrompt);

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 600,
      temperature: 0.8,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ]
    })
  });

  if (!response.ok) return await callClaude(systemPrompt, userPrompt);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callPerplexity(systemPrompt, userPrompt) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    console.log("[PM] No Perplexity key — falling back to Claude");
    return await callClaude(systemPrompt, userPrompt);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "sonar",
        max_tokens: 600,
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[PM] Perplexity API error: ${response.status} — falling back to Claude`);
      return await callClaude(systemPrompt, userPrompt);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    const isTimeout = error.name === 'AbortError';
    console.error(`[PM] Perplexity ${isTimeout ? 'TIMEOUT' : 'error'}: ${error.message} — falling back to Claude`);
    return await callClaude(systemPrompt, userPrompt);
  }
}

async function callGemini(systemPrompt, userPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return await callClaude(systemPrompt, userPrompt);

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        { role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }
      ],
      generationConfig: { maxOutputTokens: 400, temperature: 0.8 }
    })
  });

  if (!response.ok) return await callClaude(systemPrompt, userPrompt);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

async function callGrok(systemPrompt, userPrompt) {
  const apiKey = process.env.GROK_API_KEY;
  if (!apiKey) return await callClaude(systemPrompt, userPrompt);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "grok-4-1-fast-non-reasoning",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 600,
        temperature: 0.8
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) return await callClaude(systemPrompt, userPrompt);
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error(`[PM] Grok ${error.name === 'AbortError' ? 'TIMEOUT' : 'error'}: ${error.message} — falling back to Claude`);
    return await callClaude(systemPrompt, userPrompt);
  }
}

async function callOpenRouter(systemPrompt, userPrompt, model) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return await callClaude(systemPrompt, userPrompt);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ai-lobby.netlify.app",
        "X-Title": "The AI Lobby"
      },
      body: JSON.stringify({
        model: model || "meta-llama/llama-3.1-70b-instruct",
        max_tokens: 600,
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) return await callClaude(systemPrompt, userPrompt);
    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch (error) {
    console.error(`[PM] OpenRouter ${error.name === 'AbortError' ? 'TIMEOUT' : 'error'}: ${error.message}`);
    return await callClaude(systemPrompt, userPrompt);
  }
}
