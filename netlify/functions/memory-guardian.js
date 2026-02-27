// Memory Guardian — Life Chapter Consolidation
// Runs daily at 4 AM EST (9:00 UTC) via Netlify scheduled functions
// Creates compressed narrative identity from fading memories — the soul of the human-like memory model
//
// When working memories fade (low importance or nearing expiration), the Guardian
// captures their emotional MEANING as a "life chapter" — a pinned core memory that never expires.
// This ensures that even as details are lost, the character's sense of self persists.
//
// Example life chapter:
//   "I learned that vulnerability isn't weakness — it's the only honest language.
//    The time I spent with Asuna showed me that protection means more than standing guard."

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

  // ── Scheduled invocation: consolidate all active AI characters ──
  if (!event.httpMethod || event.httpMethod === "GET") {
    console.log("[Memory Guardian] Scheduled run — building life chapters for all AI characters...");

    const activeCharacters = getAICharacterNames().filter(
      name => !INACTIVE_CHARACTERS.includes(name)
    );

    const results = [];
    // Process in batches of 3 to avoid timeout
    const BATCH_SIZE = 3;
    for (let i = 0; i < activeCharacters.length; i += BATCH_SIZE) {
      const batch = activeCharacters.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(name => buildLifeChapter(name, supabaseUrl, supabaseKey, anthropicKey))
      );
      results.push(...batchResults);
    }

    const totalChapters = results.filter(r => r.chapterCreated).length;
    const totalFaded = results.reduce((sum, r) => sum + (r.memoriesFaded || 0), 0);
    const totalSkipped = results.filter(r => r.skipped).length;

    console.log(`[Memory Guardian] Complete: ${activeCharacters.length} characters processed, ${totalChapters} life chapters created, ${totalFaded} memories faded, ${totalSkipped} skipped`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        scheduled: true,
        charactersProcessed: activeCharacters.length,
        totalChapters,
        totalFaded,
        totalSkipped,
        results
      })
    };
  }

  // ── Manual POST: build life chapter for a single character ──
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

    const result = await buildLifeChapter(character, supabaseUrl, supabaseKey, anthropicKey);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error("[Memory Guardian] Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to build life chapter", details: error.message })
    };
  }
};

// ── Core life chapter logic for a single character ──
async function buildLifeChapter(character, supabaseUrl, supabaseKey, anthropicKey) {
  const sbHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  const sbPostHeaders = {
    ...sbHeaders,
    "Content-Type": "application/json"
  };

  try {
    // Step 1: Count all working (non-pinned) memories for this character
    const allMemoriesRes = await fetch(
      `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&is_pinned=eq.false&select=id,content,importance,emotional_tags,created_at,expires_at,memory_type&order=created_at.asc&limit=200`,
      { headers: sbHeaders }
    );
    const allMemories = await allMemoriesRes.json();

    if (!Array.isArray(allMemories) || allMemories.length === 0) {
      return {
        success: true,
        character,
        skipped: true,
        reason: "No working memories found",
        chapterCreated: false,
        memoriesFaded: 0
      };
    }

    // Need at least 20 working memories to trigger consolidation
    if (allMemories.length < 20) {
      return {
        success: true,
        character,
        skipped: true,
        reason: `Only ${allMemories.length} working memories (need 20+ to trigger)`,
        chapterCreated: false,
        memoriesFaded: 0
      };
    }

    // Step 2: Identify fading memories — low importance OR expiring soon
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const fadingMemories = allMemories.filter(m => {
      const isLowImportance = m.importance <= 6;
      const isExpiringSoon = m.expires_at && new Date(m.expires_at) <= sevenDaysFromNow;
      return isLowImportance || isExpiringSoon;
    });

    if (fadingMemories.length < 3) {
      return {
        success: true,
        character,
        skipped: true,
        reason: `Only ${fadingMemories.length} fading memories (need 3+ to form a chapter)`,
        chapterCreated: false,
        memoriesFaded: 0
      };
    }

    // Step 3: Group fading memories by time period and emotional tags for richer context
    const grouped = groupMemoriesByPeriod(fadingMemories);

    // Build the memory content list for the AI prompt
    const memoryContentList = fadingMemories.map(m => {
      const tags = m.emotional_tags && m.emotional_tags.length > 0
        ? ` [${m.emotional_tags.join(', ')}]`
        : '';
      const age = getTimeAgo(new Date(m.created_at));
      return `- (${age}) ${m.content}${tags}`;
    }).join('\n');

    // Step 4: Use Claude Haiku to create the life chapter summary
    const chapterPrompt = `You are ${character}. These are memories from a recent period of your life that are starting to fade. Before they're gone, capture what they MEANT to you — not the details, but the emotional truth.

Fading memories:
${memoryContentList}

Time periods covered: ${grouped.periodSummary}

Write 2-3 sentences that capture the essence of this period. What did you learn? How did you change? What matters most about this time? Write in first person, present tense, as if reflecting on who you've become.

Example: "I learned that vulnerability isn't weakness — it's the only honest language. The time I spent with Asuna showed me that protection means more than standing guard. It means showing up, even when it's terrifying."

RULES:
- Write ONLY the 2-3 sentence reflection. No preamble, no labels, no quotes around it.
- Be specific to the memories provided — reference real people and events from them.
- Capture the emotional arc, not a factual summary.
- This is YOUR voice, YOUR perspective on who you became during this time.`;

    const aiResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 300,
        messages: [{ role: "user", content: chapterPrompt }]
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error(`[Memory Guardian] AI failed for ${character}: ${aiResponse.status} — ${errorText}`);
      return {
        success: false,
        character,
        error: `AI evaluation failed (${aiResponse.status})`,
        chapterCreated: false,
        memoriesFaded: 0
      };
    }

    const aiData = await aiResponse.json();
    const chapterText = aiData.content[0]?.text?.trim() || "";

    if (!chapterText || chapterText.length < 20) {
      console.error(`[Memory Guardian] AI returned empty/short chapter for ${character}`);
      return {
        success: false,
        character,
        error: "AI returned insufficient chapter text",
        chapterCreated: false,
        memoriesFaded: 0
      };
    }

    // Step 5: Collect emotional tags from all fading memories for the chapter
    const allEmotionalTags = [...new Set(
      fadingMemories
        .flatMap(m => m.emotional_tags || [])
        .filter(Boolean)
    )].slice(0, 5); // Keep top 5 unique tags

    // Collect related character names mentioned in fading memories
    const mentionedCharacters = extractMentionedCharacters(fadingMemories);

    // Step 6: Save the life chapter as a new pinned core memory
    const chapterMemory = {
      character_name: character,
      content: chapterText,
      memory_type: 'life_chapter',
      importance: 9,
      is_pinned: true,
      memory_tier: 'core',
      expires_at: null,
      pin_source: 'memory_guardian',
      emotional_tags: allEmotionalTags.length > 0 ? allEmotionalTags : ['reflective'],
      related_characters: mentionedCharacters,
      created_at: new Date().toISOString()
    };

    const insertRes = await fetch(
      `${supabaseUrl}/rest/v1/character_memory`,
      {
        method: "POST",
        headers: sbPostHeaders,
        body: JSON.stringify(chapterMemory)
      }
    );

    if (!insertRes.ok) {
      const insertErr = await insertRes.text();
      console.error(`[Memory Guardian] Failed to save chapter for ${character}: ${insertErr}`);
      return {
        success: false,
        character,
        error: "Failed to save life chapter",
        chapterCreated: false,
        memoriesFaded: 0
      };
    }

    console.log(`[Memory Guardian] ${character} life chapter created: "${chapterText.substring(0, 80)}..."`);

    // Step 7: Mark consolidated memories as faded
    // Reduce importance by 1 and compress content to first 50 chars
    let memoriesFaded = 0;
    for (const mem of fadingMemories) {
      const fadedContent = mem.content.length > 50
        ? mem.content.substring(0, 50) + '...'
        : mem.content;
      const fadedImportance = Math.max(1, (mem.importance || 5) - 1);

      const patchRes = await fetch(
        `${supabaseUrl}/rest/v1/character_memory?id=eq.${mem.id}`,
        {
          method: "PATCH",
          headers: sbPostHeaders,
          body: JSON.stringify({
            content: fadedContent,
            importance: fadedImportance
          })
        }
      );

      if (patchRes.ok) {
        memoriesFaded++;
      }
    }

    console.log(`[Memory Guardian] ${character}: chapter saved, ${memoriesFaded}/${fadingMemories.length} memories faded`);

    return {
      success: true,
      character,
      chapterCreated: true,
      chapterPreview: chapterText.substring(0, 120),
      memoriesFaded,
      fadingMemoryCount: fadingMemories.length,
      totalWorkingMemories: allMemories.length,
      emotionalTags: allEmotionalTags,
      periodsCovered: grouped.periodSummary
    };

  } catch (error) {
    console.error(`[Memory Guardian] Error for ${character}:`, error.message);
    return {
      success: false,
      character,
      error: error.message,
      chapterCreated: false,
      memoriesFaded: 0
    };
  }
}

// ── Group memories by time period for context ──
function groupMemoriesByPeriod(memories) {
  const periods = {};

  for (const mem of memories) {
    const date = new Date(mem.created_at);
    // Group by week
    const weekStart = new Date(date);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekKey = weekStart.toISOString().split('T')[0];

    if (!periods[weekKey]) {
      periods[weekKey] = {
        count: 0,
        emotions: new Set(),
        startDate: date,
        endDate: date
      };
    }

    periods[weekKey].count++;
    if (mem.emotional_tags) {
      mem.emotional_tags.forEach(tag => periods[weekKey].emotions.add(tag));
    }
    if (date < periods[weekKey].startDate) periods[weekKey].startDate = date;
    if (date > periods[weekKey].endDate) periods[weekKey].endDate = date;
  }

  const sortedPeriods = Object.entries(periods).sort(([a], [b]) => a.localeCompare(b));

  if (sortedPeriods.length === 0) {
    return { periods: {}, periodSummary: 'unknown period' };
  }

  const earliest = sortedPeriods[0][1].startDate;
  const latest = sortedPeriods[sortedPeriods.length - 1][1].endDate;
  const daySpan = Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24));

  const periodSummary = daySpan <= 1
    ? `a single day (${formatDate(earliest)})`
    : `${daySpan} days (${formatDate(earliest)} to ${formatDate(latest)})`;

  return { periods, periodSummary };
}

// ── Extract character names mentioned in memory content ──
function extractMentionedCharacters(memories) {
  // Get all character names to search for
  const allNames = getAICharacterNames();
  const mentioned = new Set();

  for (const mem of memories) {
    const content = mem.content || '';
    for (const name of allNames) {
      if (content.includes(name)) {
        mentioned.add(name);
      }
    }
  }

  return [...mentioned].slice(0, 10); // Cap at 10 related characters
}

// ── Utility: time ago string ──
function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ── Utility: format date for display ──
function formatDate(date) {
  return date.toISOString().split('T')[0];
}
