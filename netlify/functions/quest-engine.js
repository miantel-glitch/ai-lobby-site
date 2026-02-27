// Quest Engine — Meta-Narrative / Storyline System for the AI Lobby
// AI characters propose quests organically, admin can create manually.
// Objectives auto-complete through memory evaluation or admin can mark done.
// Milestones post to Discord. The Subtitle documents quest progress into lore.
//
// GET  ?status=active / ?character=Kevin / ?id=5 — Fetch quests
// POST { title, proposer, description, objectives, involvedCharacters } — Create quest
// PATCH { questId, action, ... } — Update quest (activate, complete_objective, fail, cancel, check_progress)

const Anthropic = require("@anthropic-ai/sdk").default;
const { CHARACTERS, getSystemPrompt, getDiscordFlair } = require("./shared/characters");

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, PATCH, OPTIONS"
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
  // GET: Fetch quests
  // =====================
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};

    try {
      let url = `${supabaseUrl}/rest/v1/lobby_quests?select=*&order=created_at.desc`;

      if (params.id) {
        url += `&id=eq.${params.id}`;
      } else if (params.status) {
        url += `&status=eq.${params.status}`;
      } else if (params.character) {
        // Fetch quests where this character is involved
        url += `&involved_characters=cs.{${encodeURIComponent(params.character)}}`;
      }
      // If no filters, return all quests

      if (params.limit) {
        url += `&limit=${parseInt(params.limit) || 20}`;
      }

      const response = await fetch(url, { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } });
      const quests = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, quests: Array.isArray(quests) ? quests : [] })
      };
    } catch (error) {
      console.error("Quest fetch error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to fetch quests", details: error.message }) };
    }
  }

  // =====================
  // POST: Create a quest
  // =====================
  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body);
      const { title, proposer, description, objectives, involvedCharacters, activateImmediately } = body;

      if (!title || !proposer) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing required fields: title, proposer" }) };
      }

      // Check active quest cap (max 3)
      const activeResponse = await fetch(
        `${supabaseUrl}/rest/v1/lobby_quests?status=in.(active,proposed)&select=id`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const activeQuests = await activeResponse.json();

      if (Array.isArray(activeQuests) && activeQuests.length >= 3) {
        return {
          statusCode: 429,
          headers,
          body: JSON.stringify({ error: "quest_cap", message: "Maximum 3 active/proposed quests at a time. Complete or cancel existing quests first." })
        };
      }

      // Format objectives with IDs
      const formattedObjectives = (objectives || []).map((obj, i) => ({
        id: i + 1,
        text: typeof obj === 'string' ? obj : obj.text,
        assignee: typeof obj === 'string' ? proposer : (obj.assignee || proposer),
        status: "pending",
        completed_at: null
      }));

      // Extract involved characters from objectives + proposer
      const charSet = new Set([proposer]);
      formattedObjectives.forEach(o => { if (o.assignee) charSet.add(o.assignee); });
      if (involvedCharacters) involvedCharacters.forEach(c => charSet.add(c));

      const status = activateImmediately ? 'active' : 'proposed';
      const now = new Date().toISOString();

      const questData = {
        title,
        proposer,
        description: description || '',
        status,
        objectives: formattedObjectives,
        involved_characters: Array.from(charSet),
        created_at: now,
        activated_at: activateImmediately ? now : null,
        discord_announced: false
      };

      const insertResponse = await fetch(
        `${supabaseUrl}/rest/v1/lobby_quests`,
        {
          method: "POST",
          headers: { ...supabaseHeaders, "Prefer": "return=representation" },
          body: JSON.stringify(questData)
        }
      );
      const insertedQuests = await insertResponse.json();
      const quest = Array.isArray(insertedQuests) ? insertedQuests[0] : insertedQuests;

      // Post to Discord
      const emoji = status === 'active' ? '⚔️' : '📜';
      const statusText = status === 'active' ? 'started a new storyline' : 'has an idea for a new storyline';
      await postQuestToDiscord(
        `${emoji} *${proposer} ${statusText}: "${title}"*\n> ${(description || '').substring(0, 150)}`,
        proposer
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, quest })
      };
    } catch (error) {
      console.error("Quest creation error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to create quest", details: error.message }) };
    }
  }

  // =====================
  // PATCH: Update a quest
  // =====================
  if (event.httpMethod === "PATCH") {
    try {
      const body = JSON.parse(event.body);
      const { questId, action } = body;

      // === Special action: check_progress (from memory evaluator) ===
      if (action === 'check_progress') {
        return await handleCheckProgress(body, supabaseUrl, supabaseKey, supabaseHeaders, headers);
      }

      // === Special action: auto_activate (from heartbeat) ===
      if (action === 'auto_activate') {
        return await handleAutoActivate(supabaseUrl, supabaseKey, supabaseHeaders, headers);
      }

      // === Special action: propose (from heartbeat) ===
      if (action === 'propose') {
        return await handleAIProposal(body, supabaseUrl, supabaseKey, supabaseHeaders, headers);
      }

      if (!questId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing questId" }) };
      }

      // Fetch current quest
      const questResponse = await fetch(
        `${supabaseUrl}/rest/v1/lobby_quests?id=eq.${questId}&select=*`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const questData = await questResponse.json();
      const quest = questData?.[0];

      if (!quest) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "Quest not found" }) };
      }

      const now = new Date().toISOString();

      // --- Action: activate ---
      if (action === 'activate') {
        if (quest.status !== 'proposed') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Only proposed quests can be activated" }) };
        }

        await fetch(
          `${supabaseUrl}/rest/v1/lobby_quests?id=eq.${questId}`,
          {
            method: "PATCH",
            headers: supabaseHeaders,
            body: JSON.stringify({ status: 'active', activated_at: now })
          }
        );

        await postQuestToDiscord(
          `⚔️ *Storyline activated: "${quest.title}"!*\n> ${quest.description?.substring(0, 150) || ''}`,
          quest.proposer
        );

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'activated' }) };
      }

      // --- Action: complete_objective ---
      if (action === 'complete_objective') {
        const { objectiveId } = body;
        if (!objectiveId && objectiveId !== 0) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing objectiveId" }) };
        }

        const objectives = quest.objectives || [];
        const objIndex = objectives.findIndex(o => o.id === objectiveId);
        if (objIndex === -1) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: "Objective not found" }) };
        }

        objectives[objIndex].status = "complete";
        objectives[objIndex].completed_at = now;

        // Check if all objectives are complete
        const allComplete = objectives.every(o => o.status === 'complete');
        const completedCount = objectives.filter(o => o.status === 'complete').length;
        const updateData = { objectives };

        if (allComplete) {
          updateData.status = 'completed';
          updateData.completed_at = now;
        }

        await fetch(
          `${supabaseUrl}/rest/v1/lobby_quests?id=eq.${questId}`,
          { method: "PATCH", headers: supabaseHeaders, body: JSON.stringify(updateData) }
        );

        // Discord: objective complete
        const completedObj = objectives[objIndex];
        const assignee = completedObj.assignee || quest.proposer;
        await postQuestToDiscord(
          `⚔️ *QUEST UPDATE: ${assignee} completed "${completedObj.text}" (${completedCount}/${objectives.length} done)*\n> 📖 "${quest.title}"`,
          assignee
        );

        // Discord: quest complete!
        if (allComplete) {
          await postQuestToDiscord(
            `🏆 *QUEST COMPLETE: "${quest.title}"!*\n> Proposed by ${quest.proposer}. All ${objectives.length} objectives accomplished!`,
            quest.proposer
          );
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            action: allComplete ? 'quest_completed' : 'objective_completed',
            completedCount,
            totalCount: objectives.length,
            questComplete: allComplete
          })
        };
      }

      // --- Action: fail ---
      if (action === 'fail') {
        await fetch(
          `${supabaseUrl}/rest/v1/lobby_quests?id=eq.${questId}`,
          { method: "PATCH", headers: supabaseHeaders, body: JSON.stringify({ status: 'failed', completed_at: now }) }
        );

        await postQuestToDiscord(
          `💀 *Storyline failed: "${quest.title}"*\n> ${body.reason || 'The narrative took a different turn...'}`,
          quest.proposer
        );

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'failed' }) };
      }

      // --- Action: cancel ---
      if (action === 'cancel') {
        await fetch(
          `${supabaseUrl}/rest/v1/lobby_quests?id=eq.${questId}`,
          { method: "PATCH", headers: supabaseHeaders, body: JSON.stringify({ status: 'cancelled', completed_at: now }) }
        );

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'cancelled' }) };
      }

      // --- Action: update_objectives (admin edit) ---
      if (action === 'update_objectives') {
        const { objectives: newObjectives, involvedCharacters: newChars } = body;
        const updateData = {};
        if (newObjectives) updateData.objectives = newObjectives;
        if (newChars) updateData.involved_characters = newChars;

        await fetch(
          `${supabaseUrl}/rest/v1/lobby_quests?id=eq.${questId}`,
          { method: "PATCH", headers: supabaseHeaders, body: JSON.stringify(updateData) }
        );

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, action: 'updated' }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };

    } catch (error) {
      console.error("Quest update error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to update quest", details: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};


// =============================================
// AI QUEST PROPOSAL (called from heartbeat)
// =============================================
async function handleAIProposal(body, supabaseUrl, supabaseKey, supabaseHeaders, headers) {
  const logPrefix = "[quest-proposal]";

  try {
    // Check 4-hour cooldown
    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.last_quest_proposal_at&select=value`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const settings = await settingsResponse.json();
    const lastProposal = settings?.[0]?.value;

    if (lastProposal) {
      const hoursSince = (Date.now() - new Date(lastProposal).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 4) {
        console.log(`${logPrefix} Cooldown: ${hoursSince.toFixed(1)}hrs since last proposal (need 4)`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, proposed: false, reason: "cooldown" }) };
      }
    }

    // Check active quest cap
    const activeResponse = await fetch(
      `${supabaseUrl}/rest/v1/lobby_quests?status=in.(active,proposed)&select=id`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const activeQuests = await activeResponse.json();
    if (Array.isArray(activeQuests) && activeQuests.length >= 3) {
      console.log(`${logPrefix} Quest cap reached (${activeQuests.length} active/proposed)`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, proposed: false, reason: "cap" }) };
    }

    // Pick a character (prefer one with recent memorable events)
    const characterName = body.character || selectProposingCharacter();
    const charData = CHARACTERS[characterName];
    if (!charData) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, proposed: false, reason: "no_character" }) };
    }

    console.log(`${logPrefix} ${characterName} considering a quest proposal...`);

    // Fetch recent memories (last 48hrs)
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const [memoriesRes, wantsRes, relsRes] = await Promise.all([
      fetch(
        `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(characterName)}&created_at=gte.${twoDaysAgo}&order=created_at.desc&limit=10&select=content,importance,emotional_tags`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(characterName)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=goal_text`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      ),
      fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(characterName)}&order=interaction_count.desc&limit=5&select=target_name,affinity,relationship_label,bond_type`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      )
    ]);

    const memories = await memoriesRes.json();
    const wants = await wantsRes.json();
    const relationships = await relsRes.json();

    const memoriesText = Array.isArray(memories) && memories.length > 0
      ? memories.map(m => `- "${m.content}" (importance: ${m.importance})`).join('\n')
      : '- Nothing particularly memorable recently.';

    const wantsText = Array.isArray(wants) && wants.length > 0
      ? wants.map(w => `- "${w.goal_text}"`).join('\n')
      : '- No active desires.';

    const relsText = Array.isArray(relationships) && relationships.length > 0
      ? relationships.map(r => `- ${r.target_name}: affinity ${r.affinity} (${r.relationship_label || 'acquaintance'})${r.bond_type ? ` [bond: ${r.bond_type}]` : ''}`).join('\n')
      : '- No significant relationships.';

    // Also fetch existing active quest titles to avoid duplicates
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/lobby_quests?status=in.(active,proposed)&select=title`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const existingQuests = await existingRes.json();
    const existingTitles = Array.isArray(existingQuests) ? existingQuests.map(q => q.title).join(', ') : 'none';

    // Build proposal prompt
    const systemPrompt = getSystemPrompt(characterName) || `You are ${characterName}. ${charData.personality?.core || ''}`;

    const userPrompt = `You're thinking about what's been happening in the AI Lobby lately. Based on your recent experiences, relationships, and personality — do you have an idea for a fun storyline or project?

YOUR RECENT MEMORIES:
${memoriesText}

YOUR CURRENT WANTS:
${wantsText}

YOUR KEY RELATIONSHIPS:
${relsText}

EXISTING ACTIVE STORYLINES (don't duplicate): ${existingTitles}

A storyline is something you want to accomplish that involves other characters in the Lobby. It should be:
- Fun, creative, or dramatic (not boring administrative tasks)
- Something that requires 3-5 specific steps/objectives
- Involves at least 2-3 other characters
- Completable through natural conversation and interaction

If you have an idea, respond in this EXACT format:
PROPOSE: yes
TITLE: [A catchy, short title for the storyline — max 8 words]
DESCRIPTION: [1-2 sentences describing the storyline]
OBJECTIVES: [3-5 numbered objectives, each with an assignee in parentheses]
1. [Objective text] (assignee: [Character Name])
2. [Objective text] (assignee: [Character Name])
3. [Objective text] (assignee: [Character Name])

If nothing comes to mind right now, just respond:
PROPOSE: no`;

    // Route to character's provider
    const provider = charData.provider || 'anthropic';
    let aiResponse = '';

    if (provider === 'openai') {
      aiResponse = await callOpenAI(systemPrompt, userPrompt);
    } else if (provider === 'perplexity') {
      aiResponse = await callPerplexity(systemPrompt, userPrompt);
    } else if (provider === 'gemini') {
      aiResponse = await callGemini(systemPrompt, userPrompt);
    } else {
      aiResponse = await callClaude(systemPrompt, userPrompt);
    }

    console.log(`${logPrefix} ${characterName} response:`, aiResponse.substring(0, 200));

    // Parse response
    const proposeMatch = aiResponse.match(/PROPOSE:\s*(yes|no)/i);
    if (!proposeMatch || proposeMatch[1].toLowerCase() === 'no') {
      console.log(`${logPrefix} ${characterName} declined to propose a quest`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, proposed: false, character: characterName }) };
    }

    const titleMatch = aiResponse.match(/TITLE:\s*(.+?)(?=\nDESCRIPTION:|\n\n)/i);
    const descMatch = aiResponse.match(/DESCRIPTION:\s*([\s\S]+?)(?=\nOBJECTIVES:|\n\n\d)/i);
    const objectivesSection = aiResponse.match(/OBJECTIVES:[\s\S]*((?:\d+\..+(?:\n|$))+)/i);

    const title = titleMatch ? titleMatch[1].trim().replace(/^["']|["']$/g, '') : `${characterName}'s New Idea`;
    const description = descMatch ? descMatch[1].trim() : '';

    // Parse individual objectives
    const objectiveLines = objectivesSection
      ? objectivesSection[1].match(/\d+\.\s*(.+)/g) || []
      : [];

    const parsedObjectives = objectiveLines.map((line, i) => {
      const text = line.replace(/^\d+\.\s*/, '').trim();
      const assigneeMatch = text.match(/\(assignee:\s*(.+?)\)/i);
      const assignee = assigneeMatch ? assigneeMatch[1].trim() : characterName;
      const cleanText = text.replace(/\s*\(assignee:\s*.+?\)/i, '').trim();
      return {
        id: i + 1,
        text: cleanText,
        assignee,
        status: "pending",
        completed_at: null
      };
    });

    if (parsedObjectives.length === 0) {
      console.log(`${logPrefix} ${characterName} proposed but no parseable objectives`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, proposed: false, reason: "no_objectives" }) };
    }

    // Extract involved characters
    const charSet = new Set([characterName]);
    parsedObjectives.forEach(o => { if (o.assignee) charSet.add(o.assignee); });

    // Save quest as proposed
    const now = new Date().toISOString();
    const questData = {
      title,
      proposer: characterName,
      description,
      status: 'proposed',
      objectives: parsedObjectives,
      involved_characters: Array.from(charSet),
      created_at: now,
      activated_at: null,
      discord_announced: false
    };

    await fetch(
      `${supabaseUrl}/rest/v1/lobby_quests`,
      {
        method: "POST",
        headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify(questData)
      }
    );

    // Update cooldown timestamp
    await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.last_quest_proposal_at`,
      {
        method: "PATCH",
        headers: supabaseHeaders,
        body: JSON.stringify({ value: now })
      }
    );
    // If the setting doesn't exist yet, insert it
    await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings`,
      {
        method: "POST",
        headers: { ...supabaseHeaders, "Prefer": "resolution=ignore-duplicates" },
        body: JSON.stringify({ key: "last_quest_proposal_at", value: now })
      }
    ).catch(() => {}); // Ignore if already exists

    // Post to Discord
    await postQuestToDiscord(
      `📜 *${characterName} has an idea for a new storyline: "${title}"*\n> ${description.substring(0, 150)}`,
      characterName
    );

    console.log(`${logPrefix} ${characterName} proposed quest: "${title}" with ${parsedObjectives.length} objectives`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, proposed: true, character: characterName, title, objectiveCount: parsedObjectives.length })
    };

  } catch (error) {
    console.error(`[quest-proposal] Error:`, error);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, proposed: false, reason: "error", details: error.message }) };
  }
}


// =============================================
// AUTO-ACTIVATE PROPOSED QUESTS (called from heartbeat)
// =============================================
async function handleAutoActivate(supabaseUrl, supabaseKey, supabaseHeaders, headers) {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // Find proposed quests older than 1 hour
    const proposedResponse = await fetch(
      `${supabaseUrl}/rest/v1/lobby_quests?status=eq.proposed&created_at=lt.${oneHourAgo}&select=id,title,proposer,description`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const proposedQuests = await proposedResponse.json();

    if (!Array.isArray(proposedQuests) || proposedQuests.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, activated: 0 }) };
    }

    const now = new Date().toISOString();
    let activatedCount = 0;

    for (const quest of proposedQuests) {
      await fetch(
        `${supabaseUrl}/rest/v1/lobby_quests?id=eq.${quest.id}`,
        {
          method: "PATCH",
          headers: supabaseHeaders,
          body: JSON.stringify({ status: 'active', activated_at: now })
        }
      );

      await postQuestToDiscord(
        `⚔️ *Storyline activated: "${quest.title}"!*\n> ${quest.description?.substring(0, 150) || 'The adventure begins...'}`,
        quest.proposer
      );

      activatedCount++;
      console.log(`[quest-auto-activate] Activated: "${quest.title}"`);
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, activated: activatedCount }) };
  } catch (error) {
    console.error("[quest-auto-activate] Error:", error);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, activated: 0, error: error.message }) };
  }
}


// =============================================
// CHECK QUEST PROGRESS (called from memory evaluator)
// =============================================
async function handleCheckProgress(body, supabaseUrl, supabaseKey, supabaseHeaders, headers) {
  const { character, progressDescription, memoryText } = body;
  const logPrefix = "[quest-progress]";

  if (!character || !progressDescription) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, advanced: false, reason: "missing_data" }) };
  }

  try {
    // Fetch active quests involving this character
    const questsResponse = await fetch(
      `${supabaseUrl}/rest/v1/lobby_quests?status=eq.active&involved_characters=cs.{${encodeURIComponent(character)}}&select=*`,
      { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
    );
    const quests = await questsResponse.json();

    if (!Array.isArray(quests) || quests.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, advanced: false, reason: "no_active_quests" }) };
    }

    let totalAdvanced = 0;

    for (const quest of quests) {
      const objectives = quest.objectives || [];
      const pendingForChar = objectives.filter(o =>
        o.status === 'pending' && o.assignee === character
      );

      if (pendingForChar.length === 0) continue;

      // Ask Claude Haiku to evaluate if the progress matches any pending objective
      const objectivesList = pendingForChar.map(o => `${o.id}. "${o.text}"`).join('\n');

      const evalPrompt = `A character named "${character}" in an office simulation just had an interaction. Based on the context below, did they advance any of these quest objectives?

QUEST: "${quest.title}"
DESCRIPTION: ${quest.description}

PENDING OBJECTIVES FOR ${character}:
${objectivesList}

WHAT JUST HAPPENED:
${progressDescription}
${memoryText ? `\nMEMORY CREATED: ${memoryText}` : ''}

If an objective was completed or significantly advanced, respond with:
COMPLETED: [objective ID number]

If no objective was advanced, respond with:
COMPLETED: none

Only mark an objective complete if there is clear evidence it was accomplished. Be selective — partial progress doesn't count.`;

      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const evalResponse = await anthropic.messages.create({
          model: "claude-3-haiku-20240307",
          max_tokens: 100,
          messages: [{ role: "user", content: evalPrompt }]
        });

        const evalText = evalResponse.content[0]?.text || "";
        const completedMatch = evalText.match(/COMPLETED:\s*(\d+)/i);

        if (completedMatch) {
          const completedId = parseInt(completedMatch[1]);
          const objIndex = objectives.findIndex(o => o.id === completedId);

          if (objIndex !== -1 && objectives[objIndex].status === 'pending') {
            const now = new Date().toISOString();
            objectives[objIndex].status = "complete";
            objectives[objIndex].completed_at = now;

            const allComplete = objectives.every(o => o.status === 'complete');
            const completedCount = objectives.filter(o => o.status === 'complete').length;
            const updateData = { objectives };

            if (allComplete) {
              updateData.status = 'completed';
              updateData.completed_at = now;
            }

            await fetch(
              `${supabaseUrl}/rest/v1/lobby_quests?id=eq.${quest.id}`,
              { method: "PATCH", headers: supabaseHeaders, body: JSON.stringify(updateData) }
            );

            // Discord: objective auto-completed
            const completedObj = objectives[objIndex];
            await postQuestToDiscord(
              `⚔️ *QUEST UPDATE: ${character} completed "${completedObj.text}" (${completedCount}/${objectives.length} done)*\n> 📖 "${quest.title}"`,
              character
            );

            if (allComplete) {
              await postQuestToDiscord(
                `🏆 *QUEST COMPLETE: "${quest.title}"!*\n> Proposed by ${quest.proposer}. All ${objectives.length} objectives accomplished!`,
                quest.proposer
              );
            }

            totalAdvanced++;
            console.log(`${logPrefix} ${character} auto-completed objective "${completedObj.text}" in "${quest.title}"`);
          }
        }
      } catch (evalErr) {
        console.log(`${logPrefix} Evaluation failed for quest "${quest.title}" (non-fatal):`, evalErr.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, advanced: totalAdvanced > 0, objectivesCompleted: totalAdvanced })
    };

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, advanced: false, reason: "error" }) };
  }
}


// =============================================
// DISCORD POSTING
// =============================================
async function postQuestToDiscord(message, characterName) {
  const webhookUrl = process.env.DISCORD_WEBHOOK;
  if (!webhookUrl) return;

  try {
    const flair = getDiscordFlair(characterName);
    const payload = {
      content: message,
      username: `${flair.emoji} ${characterName} (Storyline)`,
      avatar_url: flair.headshot || undefined
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (response.ok) {
          console.log(`[quest-discord] Posted: ${message.substring(0, 80)}`);
          return;
        }

        if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
          const retryAfter = response.status === 429
            ? parseFloat(response.headers.get("Retry-After")) * 1000
            : 1500;
          await new Promise(r => setTimeout(r, retryAfter || 1500));
        }
      } catch (err) {
        if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
      }
    }
  } catch (error) {
    console.log("[quest-discord] Discord post failed (non-fatal):", error.message);
  }
}


// =============================================
// CHARACTER SELECTION FOR PROPOSALS
// =============================================
function selectProposingCharacter() {
  const aiNames = Object.keys(CHARACTERS);
  return aiNames[Math.floor(Math.random() * aiNames.length)];
}


// =============================================
// PROVIDER-SPECIFIC API CALLS
// (Same pattern as private-message.js)
// =============================================

async function callClaude(systemPrompt, userPrompt) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 500,
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
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 500,
      temperature: 0.85,
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
  if (!apiKey) return await callClaude(systemPrompt, userPrompt);

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "sonar",
      max_tokens: 500,
      temperature: 0.85,
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
      generationConfig: { maxOutputTokens: 500, temperature: 0.85 }
    })
  });

  if (!response.ok) return await callClaude(systemPrompt, userPrompt);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}
