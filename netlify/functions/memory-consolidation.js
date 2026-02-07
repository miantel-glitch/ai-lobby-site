// Memory Consolidation - AI-powered memory cleanup
// Admin triggers this to have a character review and clean up their memories

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

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
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

  try {
    const { character } = JSON.parse(event.body || "{}");

    if (!character) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing character parameter" })
      };
    }

    // Fetch all WORKING (non-pinned) memories for this character
    const memoriesResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&is_pinned=eq.false&order=created_at.desc&limit=100`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const memories = await memoriesResponse.json();

    if (!Array.isArray(memories) || memories.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: "No working memories to consolidate",
          deleted: 0,
          merged: 0,
          coreCandidates: []
        })
      };
    }

    if (memories.length < 5) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: "Not enough memories to consolidate (need at least 5)",
          deleted: 0,
          merged: 0,
          coreCandidates: []
        })
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

Be aggressive about FORGET - routine events like "took a coffee break" or repeated mentions of the same topic should be forgotten unless they're emotionally significant.

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
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "AI evaluation failed" })
      };
    }

    const aiData = await aiResponse.json();
    const evaluation = aiData.content[0]?.text || "";

    // Parse the AI's response
    const keepMatch = evaluation.match(/KEEP:\s*\[([^\]]*)\]/i);
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
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
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
                      headers: {
                        "apikey": supabaseKey,
                        "Authorization": `Bearer ${supabaseKey}`
                      }
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
                      "apikey": supabaseKey,
                      "Authorization": `Bearer ${supabaseKey}`,
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

    // Collect core candidates
    const coreCandidates = coreIndices
      .map(idx => memories[idx])
      .filter(m => m);

    console.log(`[Consolidation] ${character}: deleted ${deleted}, merged ${merged}, suggested ${coreCandidates.length} core candidates`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        character,
        deleted,
        merged,
        coreCandidates: coreCandidates.map(m => ({
          id: m.id,
          content: m.content,
          importance: m.importance
        })),
        reasoning: reasoningMatch?.[1]?.trim() || "No reasoning provided"
      })
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

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
