// Memory Review System — Character-driven memory evaluation
// Part of the Narrative Subconscious system
//
// Instead of mechanical expiry (7 days / 30 days), characters "decide"
// whether memories still matter. Each review evaluates a batch of working
// memories through the character's perspective:
//   KEEP — extend lifespan, bump importance
//   FADE — compress into a fragment (emotional residue without token cost)
//   FORGET — soft delete via near-immediate expiry
//
// Called from: office-heartbeat.js (twice daily, 3am and 3pm EST)

async function reviewCharacterMemories(characterName, supabaseUrl, supabaseKey, anthropicKey) {
  const logPrefix = `[memory-review][${characterName}]`;

  // ═══ FETCH WORKING MEMORIES ═══
  // Get non-pinned, non-expired memories — sorted by oldest first (review what's closest to expiry)
  try {
    const now = new Date().toISOString();
    const memRes = await fetch(
      `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(characterName)}&is_pinned=eq.false&expires_at=gt.${now}&memory_tier=eq.working&select=id,content,importance,memory_type,emotional_tags,created_at,expires_at&order=created_at.asc&limit=12`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const memories = await memRes.json();
    if (!Array.isArray(memories) || memories.length < 3) {
      console.log(`${logPrefix} Only ${memories?.length || 0} working memories — skipping review (need at least 3)`);
      return { reviewed: false, reason: 'insufficient_memories', count: memories?.length || 0 };
    }

    // ═══ BUILD REVIEW PROMPT ═══
    const memoryList = memories.map((m, i) => {
      const age = Math.round((Date.now() - new Date(m.created_at).getTime()) / (1000 * 60 * 60));
      const ageStr = age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;
      const content = m.content.substring(0, 200);
      return `${i + 1}. [${m.memory_type || 'unknown'}] (${ageStr}) ${content}`;
    }).join('\n');

    const reviewPrompt = `You are ${characterName}. Here are some of your recent memories — things you experienced, noticed, or felt.

For each one, decide honestly: would you still hang onto this?

KEEP — This still matters to you. It shapes who you are, how you feel about someone, or what you believe. You'd remember this.
FADE — The details are blurry but the feeling remains. You remember THAT it happened, not the specifics. Compress it to a fragment.
FORGET — This is noise. It served its moment. You've moved on. Let it go.

Your memories:
${memoryList}

Respond with ONLY a JSON array (no markdown, no explanation):
[{"index":1,"verdict":"KEEP|FADE|FORGET","compressed":"only if FADE — rewrite as a short fragment under 80 characters"}]

Be honest. Not everything matters. Good banter fades. A moment of genuine connection keeps. Routine observations forget.`;

    // ═══ HAIKU EVALUATION ═══
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [{ role: "user", content: reviewPrompt }]
      })
    });

    if (!aiRes.ok) {
      console.log(`${logPrefix} Haiku API error: ${aiRes.status}`);
      return { reviewed: false, reason: 'api_error' };
    }

    const aiData = await aiRes.json();
    const responseText = aiData.content?.[0]?.text?.trim() || '';

    // Parse JSON array from response
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.log(`${logPrefix} Could not parse JSON from response: ${responseText.substring(0, 100)}`);
      return { reviewed: false, reason: 'parse_error' };
    }

    const verdicts = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(verdicts)) {
      return { reviewed: false, reason: 'invalid_response' };
    }

    // ═══ PROCESS VERDICTS ═══
    let kept = 0, faded = 0, forgotten = 0;
    const nowDate = new Date();

    for (const verdict of verdicts) {
      const idx = (verdict.index || 0) - 1;
      if (idx < 0 || idx >= memories.length) continue;

      const memory = memories[idx];
      const action = (verdict.verdict || '').toUpperCase();

      if (action === 'KEEP') {
        // Extend expiry by 14 days, bump importance by +1 (cap at 8)
        const newExpiry = new Date(nowDate.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
        const newImportance = Math.min(8, (memory.importance || 5) + 1);

        await fetch(
          `${supabaseUrl}/rest/v1/character_memory?id=eq.${memory.id}`,
          {
            method: 'PATCH',
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              expires_at: newExpiry,
              importance: newImportance
            })
          }
        );
        kept++;

      } else if (action === 'FADE') {
        // Compress content, reduce importance by -1 (floor at 3)
        const compressed = verdict.compressed
          ? `[Faded] ${verdict.compressed.substring(0, 100)}`
          : `[Faded] ${memory.content.substring(0, 60)}...`;
        const newImportance = Math.max(3, (memory.importance || 5) - 1);
        // Faded memories get 7 more days — they're fragments, not full memories
        const newExpiry = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

        await fetch(
          `${supabaseUrl}/rest/v1/character_memory?id=eq.${memory.id}`,
          {
            method: 'PATCH',
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              content: compressed,
              importance: newImportance,
              expires_at: newExpiry,
              memory_type: 'faded'  // Mark as faded for tracking
            })
          }
        );
        faded++;

      } else if (action === 'FORGET') {
        // Soft delete — expire in 1 hour (natural cleanup handles the rest)
        const soonExpiry = new Date(nowDate.getTime() + 60 * 60 * 1000).toISOString();

        await fetch(
          `${supabaseUrl}/rest/v1/character_memory?id=eq.${memory.id}`,
          {
            method: 'PATCH',
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              expires_at: soonExpiry
            })
          }
        );
        forgotten++;
      }
    }

    console.log(`${logPrefix} Review complete: ${kept} kept, ${faded} faded, ${forgotten} forgotten (of ${memories.length} reviewed)`);
    return {
      reviewed: true,
      character: characterName,
      total: memories.length,
      kept,
      faded,
      forgotten
    };

  } catch (error) {
    console.log(`${logPrefix} Review failed: ${error.message}`);
    return { reviewed: false, reason: 'error', error: error.message };
  }
}

module.exports = { reviewCharacterMemories };
