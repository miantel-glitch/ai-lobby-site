// Memory Consolidation - AI-powered memory cleanup
// Runs weekly on Sundays at 4 AM EST (9:00 UTC) via Netlify scheduled functions
// Also supports manual POST with { character: "Name" } for single-character consolidation

const { getAICharacterNames, INACTIVE_CHARACTERS } = require('./shared/characters');

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey || !anthropicKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing configuration" })
    };
  }

  // ── Scheduled invocation: consolidate ALL active AI characters ──
  if (!event.httpMethod || event.httpMethod === "GET") {
    console.log("[Memory Consolidation] Scheduled run — consolidating all AI characters...");

    const activeCharacters = getAICharacterNames().filter(
      name => !INACTIVE_CHARACTERS.includes(name)
    );

    const results = [];
    // Process in batches of 3 to avoid timeout
    const BATCH_SIZE = 3;
    for (let i = 0; i < activeCharacters.length; i += BATCH_SIZE) {
      const batch = activeCharacters.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(name => consolidateCharacter(name, supabaseUrl, supabaseKey, anthropicKey))
      );
      results.push(...batchResults);
    }

    const totalDeleted = results.reduce((sum, r) => sum + (r.deleted || 0), 0);
    const totalMerged = results.reduce((sum, r) => sum + (r.merged || 0), 0);
    const totalPinned = results.filter(r => r.aiPinned).length;

    console.log(`[Memory Consolidation] Complete: ${activeCharacters.length} characters processed, ${totalDeleted} deleted, ${totalMerged} merged, ${totalPinned} pinned`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        scheduled: true,
        charactersProcessed: activeCharacters.length,
        totalDeleted,
        totalMerged,
        totalPinned,
        results
      })
    };
  }

  // ── Manual POST: consolidate a single character ──
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const { character } = JSON.parse(event.body || "{}");

    if (!character) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing character parameter" })
      };
    }

    const result = await consolidateCharacter(character, supabaseUrl, supabaseKey, anthropicKey);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error("Memory consolidation error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to consolidate memories", details: error.message })
    };
  }
};

// ── Core consolidation logic for a single character ──
async function consolidateCharacter(character, supabaseUrl, supabaseKey, anthropicKey) {
  const sbHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  try {
    // Fetch all WORKING (non-pinned) memories for this character
    const memoriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&is_pinned=eq.false&order=created_at.desc&limit=100`,
      { headers: sbHeaders }
    );
    const memories = await memoriesResponse.json();

    if (!Array.isArray(memories) || memories.length === 0) {
      return {
        success: true,
        character,
        message: "No working memories to consolidate",
        deleted: 0,
        merged: 0,
        coreCandidates: []
      };
    }

    if (memories.length < 5) {
      return {
        success: true,
        character,
        message: "Not enough memories to consolidate (need at least 5)",
        deleted: 0,
        merged: 0,
        coreCandidates: []
      };
    }

    // Format memories for the AI to evaluate
    const formattedMemories = memories.map((m, i) => {
      const age = getTimeAgo(new Date(m.created_at));
      return `[${i}] (importance: ${m.importance}, ${age}): ${m.content}`;
    }).join('\n');

    // Ask Claude to evaluate the memories
    const consolidationPrompt = `You are ${character}. Review your memories and decide what to keep.

YOUR CURRENT WORKING MEMORIES:
${formattedMemories}

Instructions:
1. KEEP: Memory indices that are meaningful, unique, or emotionally significant
2. MERGE: Groups of similar/duplicate memories that should be combined into one (provide the merged text)
3. FORGET: Memory indices that are noise, too generic, repetitive, or superseded by newer information
4. CORE_CANDIDATE: 1-2 memories that feel foundational to who you are (these will be suggested for pinning)

Be aggressive about FORGET. These should almost always be forgotten:
- Generic observations like "talked about the printer" or "mentioned X" with no emotional context
- Routine events like "took a coffee break" or "someone apologized"
- Repeated mentions of the same topic without new information
Only keep memories that have genuine emotional weight, narrative significance, or reveal something about relationships.

Respond in this EXACT format (use real index numbers from above):
KEEP: [list of indices to keep, e.g., 2, 5, 12]
MERGE: [groups to merge, e.g., [[0, 3, 7], [4, 8]]]
MERGE_TEXT: [merged memory texts, one per group above, e.g., ["I've been monitoring vent activity", "The printer situation continues"]]
FORGET: [list of indices to delete, e.g., 1, 6, 9, 10, 11]
CORE_CANDIDATE: [1-2 indices that could be core memories, e.g., 5, 12]
REASONING: Brief explanation of your choices (1-2 sentences)`;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [{ role: "user", content: consolidationPrompt }]
      })
    });

    if (!aiResponse.ok) {
      console.error(`[Consolidation] AI evaluation failed for ${character}: ${aiResponse.status}`);
      return {
        success: false,
        character,
        error: "AI evaluation failed",
        deleted: 0,
        merged: 0
      };
    }

    const aiData = await aiResponse.json();
    const evaluation = aiData.content[0]?.text || "";

    // Parse the AI's response
    const mergeMatch = evaluation.match(/MERGE:\s*\[([^\]]*\])\]/i);
    const mergeTextMatch = evaluation.match(/MERGE_TEXT:\s*\[([^\]]*)\]/is);
    const forgetMatch = evaluation.match(/FORGET:\s*\[([^\]]*)\]/i);
    const coreMatch = evaluation.match(/CORE_CANDIDATE:\s*\[([^\]]*)\]/i);
    const reasoningMatch = evaluation.match(/REASONING:\s*(.+)/is);

    // Parse indices
    const parseIndices = (str) => {
      if (!str) return [];
      return str.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    };

    const forgetIndices = parseIndices(forgetMatch?.[1]);
    const coreIndices = parseIndices(coreMatch?.[1]);

    // Execute deletions
    let deleted = 0;
    for (const idx of forgetIndices) {
      if (memories[idx]) {
        await fetch(
          `${supabaseUrl}/rest/v1/character_memory?id=eq.${memories[idx].id}`,
          {
            method: "DELETE",
            headers: sbHeaders
          }
        );
        deleted++;
      }
    }

    // Parse and execute merges
    let merged = 0;
    try {
      // Parse the merge groups - this is tricky because it's nested arrays
      const mergeGroupsStr = mergeMatch?.[1]?.trim();
      const mergeTextsStr = mergeTextMatch?.[1]?.trim();

      if (mergeGroupsStr && mergeTextsStr) {
        // Simple parsing for merge groups like [[0, 3], [4, 8]]
        const groupMatches = mergeGroupsStr.match(/\[[\d\s,]+\]/g);
        const textMatches = mergeTextsStr.match(/"[^"]+"/g);

        if (groupMatches && textMatches) {
          for (let i = 0; i < groupMatches.length && i < textMatches.length; i++) {
            const indices = parseIndices(groupMatches[i].replace(/[\[\]]/g, ''));
            const mergedText = textMatches[i].replace(/^"|"$/g, '');

            if (indices.length > 1 && mergedText) {
              // Delete the old memories (except the first one which we'll update)
              for (let j = 1; j < indices.length; j++) {
                const mem = memories[indices[j]];
                if (mem) {
                  await fetch(
                    `${supabaseUrl}/rest/v1/character_memory?id=eq.${mem.id}`,
                    {
                      method: "DELETE",
                      headers: sbHeaders
                    }
                  );
                }
              }

              // Update the first memory with merged text
              const firstMem = memories[indices[0]];
              if (firstMem) {
                await fetch(
                  `${supabaseUrl}/rest/v1/character_memory?id=eq.${firstMem.id}`,
                  {
                    method: "PATCH",
                    headers: {
                      ...sbHeaders,
                      "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                      content: mergedText,
                      memory_type: "merged"
                    })
                  }
                );
                merged++;
              }
            }
          }
        }
      }
    } catch (mergeErr) {
      console.log("Merge parsing failed (non-fatal):", mergeErr.message);
    }

    // Collect core candidates and AUTO-PIN the AI's top choice
    const coreCandidates = coreIndices
      .map(idx => memories[idx])
      .filter(m => m);

    let aiPinned = null;
    if (coreCandidates.length > 0) {
      // Check current pinned count (max 5)
      const pinnedCountRes = await fetch(
        `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&is_pinned=eq.true&select=id`,
        { headers: sbHeaders }
      );
      const pinnedCount = await pinnedCountRes.json();
      const currentPinned = Array.isArray(pinnedCount) ? pinnedCount.length : 0;

      if (currentPinned < 5) {
        // Pin the AI's top core candidate
        const topCandidate = coreCandidates[0];
        await fetch(
          `${supabaseUrl}/rest/v1/character_memory?id=eq.${topCandidate.id}`,
          {
            method: "PATCH",
            headers: {
              ...sbHeaders,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              is_pinned: true,
              memory_tier: 'core',
              expires_at: null,
              pin_source: 'ai'
            })
          }
        );
        aiPinned = {
          id: topCandidate.id,
          content: topCandidate.content.substring(0, 100)
        };
        console.log(`[Consolidation] ${character} AI-pinned memory #${topCandidate.id}: "${topCandidate.content.substring(0, 60)}..."`);
      }
    }

    console.log(`[Consolidation] ${character}: deleted ${deleted}, merged ${merged}, AI-pinned ${aiPinned ? 1 : 0}, suggested ${coreCandidates.length} core candidates`);

    return {
      success: true,
      character,
      deleted,
      merged,
      aiPinned,
      coreCandidates: coreCandidates.map(m => ({
        id: m.id,
        content: m.content,
        importance: m.importance
      })),
      reasoning: reasoningMatch?.[1]?.trim() || "No reasoning provided"
    };

  } catch (error) {
    console.error(`[Consolidation] Error for ${character}:`, error.message);
    return {
      success: false,
      character,
      error: error.message,
      deleted: 0,
      merged: 0
    };
  }
}

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
