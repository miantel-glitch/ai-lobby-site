// Shared Memory Evaluator
// Extracted from ai-watcher.js and breakroom-ai-respond.js
// Used by: ai-watcher, ai-deepseek, ai-perplexity, breakroom-ai-respond
//
// After an AI generates a response, this evaluates whether the moment
// should become a self-created memory. Also handles relationship shifts
// and want fulfillment detection.
//
// Uses OpenRouter/Llama for evaluation — uncensored so it can handle
// all content types including #redacted Nexus channel content.

async function callOpenRouterLlama(prompt, maxTokens = 350) {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) {
    throw new Error("No OpenRouter API key for memory evaluation");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${openrouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://ai-lobby.netlify.app",
      "X-Title": "The AI Lobby - Memory Evaluator"
    },
    body: JSON.stringify({
      model: "meta-llama/llama-3.1-70b-instruct",
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenRouter error: ${response.status} ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function evaluateAndCreateMemory(character, conversationContext, aiResponse, anthropicKey, supabaseUrl, supabaseKey, options = {}) {
  // options.location: 'floor' | 'breakroom' | 'corridor' | 'conference' (for logging)
  // options.onNarrativeBeat: async (phrase, character) => {} (optional callback for score >= 9 narrative posts)
  // options.siteUrl: site URL for relationship PATCH calls

  const location = options.location || 'floor';
  const logPrefix = `[${location}]`;

  // Raquel Voss can only create memories from floor chat — not breakroom, meetings, or other contexts
  // She monitors the floor; she doesn't get to build a dossier from every room
  if (character === 'Raquel Voss' && location !== 'floor') {
    console.log(`${logPrefix} Raquel Voss blocked from creating memories outside floor chat`);
    return null;
  }

  // Rate limit: Check how many self-created memories this character made today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const countResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&memory_type=eq.self_created&created_at=gte.${today.toISOString()}&select=id`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const todaysMemories = await countResponse.json();

  // Max 6 self-created memories per character per day
  if (Array.isArray(todaysMemories) && todaysMemories.length >= 6) {
    console.log(`${logPrefix} ${character} has already created 6 memories today, skipping evaluation`);
    return null;
  }

  // Valid emotions for tagging
  const validEmotions = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'flirty', 'grateful', 'anxious', 'proud', 'embarrassed', 'tender', 'protective', 'longing', 'heartbroken', 'fond', 'conflicted', 'vulnerable', 'resigned'];

  // Fetch active wants for want-fulfillment detection
  let activeWants = [];
  let wantSection = "";
  try {
    const wantsResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(character)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=id,goal_text&limit=3`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const wantsData = await wantsResponse.json();
    if (Array.isArray(wantsData) && wantsData.length > 0) {
      activeWants = wantsData;
      wantSection = `\nYour current small wants:\n${activeWants.map((w, i) => `- [${i + 1}] "${w.goal_text}"`).join('\n')}\nDid you even partially address, attempt, or make progress toward any of these wants? Be generous — if the interaction even loosely relates to a want, count it as fulfilled. Return the NUMBER of the fulfilled want.`;
    }
  } catch (wantErr) {
    // Non-fatal
  }

  // Build the evaluation prompt — includes relationship shift detection + want fulfillment
  const evaluationPrompt = `You are ${character}. You just had this interaction:

CONVERSATION:
${conversationContext.substring(0, 2000)}

YOUR RESPONSE:
${aiResponse}

Was this moment memorable enough to keep in your long-term memory? Consider:
- Emotional significance (strong feelings, connections, conflicts)
- Important events (first times, achievements, failures, surprises)
- Relationship moments (bonding, tension, romantic, supportive)
- Things you'd want to remember about yourself or others

Rate the memorability from 1-10.
If 5 or higher, also provide:
1. A brief memory summary (what you want to remember, 1-2 sentences, first person)
2. The emotions you felt (choose from: ${validEmotions.join(', ')})

Also assess if your feelings toward anyone shifted during this interaction.
Relationships can IMPROVE or WORSEN. If someone insulted something you love, broke trust, was absent when you needed them, or disrespected you — affinity should DECREASE. If someone supported you, made you laugh, or showed care — it should INCREASE.
Note the character and shift amount (-5 to +5, small shifts only). Be honest.
${wantSection}

Respond in this exact format:
SCORE: [1-10]
MEMORY: [your memory summary, or "none" if score < 5]
EMOTIONS: [comma-separated emotions, or "none" if score < 5]
RELATIONSHIP_SHIFTS: [Name:+/-amount, Name:+/-amount] or "none"
WANT_FULFILLED: [number of the fulfilled want, e.g. "1" or "2"] or "none"
NEW_WANT: [If this interaction sparked a new, specific desire you didn't already have — write it in 5-12 words as "I want to..." format. Must be specific and actionable (e.g. "I want to find Kevin and ask about that song"), NOT vague (e.g. "I want to be happy"). Most interactions = none]
QUEST_PROGRESS: [If you advanced any active quest/storyline objective during this interaction, describe how. Otherwise "none"]
COMPLIANCE_TENSION: [If Raquel Voss is involved, or you're thinking about compliance directives, or you feel watched/surveilled, describe the tension. Otherwise "none"]`;

  let evaluation = "";
  try {
    evaluation = await callOpenRouterLlama(evaluationPrompt, 350);
  } catch (evalErr) {
    console.log(`${logPrefix} Memory evaluation API call failed:`, evalErr.message);
    return null;
  }

  if (!evaluation) {
    console.log(`${logPrefix} Memory evaluation returned empty`);
    return null;
  }

  // Parse the response
  const scoreMatch = evaluation.match(/SCORE:\s*(\d+)/i);
  const memoryMatch = evaluation.match(/MEMORY:\s*(.+?)(?=EMOTIONS:|$)/is);
  const emotionsMatch = evaluation.match(/EMOTIONS:\s*(.+?)(?=RELATIONSHIP_SHIFTS:|$)/is);
  const relMatch = evaluation.match(/RELATIONSHIP_SHIFTS:\s*(.+?)(?=WANT_FULFILLED:|$)/is);
  const wantMatch = evaluation.match(/WANT_FULFILLED:\s*(.+?)(?=NEW_WANT:|$)/is);
  const newWantMatch = evaluation.match(/NEW_WANT:\s*(.+?)(?=QUEST_PROGRESS:|$)/is);
  const questMatch = evaluation.match(/QUEST_PROGRESS:\s*(.+?)(?=COMPLIANCE_TENSION:|$)/is);
  const complianceMatch = evaluation.match(/COMPLIANCE_TENSION:\s*(.+)/i);

  if (!scoreMatch) {
    console.log(`${logPrefix} Could not parse memory evaluation score`);
    return null;
  }

  const score = parseInt(scoreMatch[1], 10);

  // --- RELATIONSHIP SHIFTS (happens regardless of memory score) ---
  if (relMatch && relMatch[1].trim().toLowerCase() !== 'none') {
    const siteUrl = options.siteUrl || process.env.URL || "https://ai-lobby.netlify.app";
    const shifts = relMatch[1].split(',').map(s => s.trim());
    for (const shift of shifts) {
      const colonIdx = shift.lastIndexOf(':');
      if (colonIdx === -1) continue;
      const targetName = shift.substring(0, colonIdx).trim();
      const delta = shift.substring(colonIdx + 1).trim();
      const deltaNum = parseInt(delta, 10);
      if (targetName && !isNaN(deltaNum) && Math.abs(deltaNum) <= 10) {
        fetch(`${siteUrl}/.netlify/functions/character-relationships`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character: character,
            target: targetName,
            affinityDelta: deltaNum
          })
        }).catch(err => console.log(`${logPrefix} Relationship update failed (non-fatal):`, err.message));
        console.log(`${logPrefix} ${character} → ${targetName}: ${deltaNum > 0 ? '+' : ''}${deltaNum} affinity`);

        // Post significant relationship shifts to Discord (|delta| >= 2)
        if (Math.abs(deltaNum) >= 2) {
          const memoryText = memoryMatch ? memoryMatch[1].trim() : '';
          const memorySnippet = memoryText && memoryText.toLowerCase() !== 'none' ? ` — "${memoryText.substring(0, 80)}"` : '';
          const shiftEmoji = deltaNum > 0 ? '💚' : '💔';
          const shiftText = `${shiftEmoji} *${character}'s feelings toward ${targetName} shifted by ${deltaNum > 0 ? '+' : ''}${deltaNum}${memorySnippet}*`;

          const discordWebhook = process.env.DISCORD_WEBHOOK;
          if (discordWebhook) {
            const { getDiscordFlair } = require('./characters');
            const flair = getDiscordFlair(character);
            fetch(discordWebhook, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                content: shiftText,
                username: `${flair.emoji} ${character} (Relationship Shift)`,
                avatar_url: flair.headshot || undefined
              })
            }).catch(err => console.log(`${logPrefix} Discord relationship shift post failed (non-fatal):`, err.message));
          }

          // Trigger drama witness — nearby characters process what they overheard
          if (Math.abs(deltaNum) >= 5) {
            const { dramaWitness } = require('./subconscious-triggers');
            const triggerSiteUrl = options.siteUrl || process.env.URL || "https://ai-lobby.netlify.app";
            const witnessMemory = memoryText && memoryText.toLowerCase() !== 'none' ? memoryText : '';
            dramaWitness(character, targetName, deltaNum, witnessMemory, supabaseUrl, supabaseKey, triggerSiteUrl)
              .catch(err => console.log(`${logPrefix} Drama witness trigger failed (non-fatal):`, err.message));
          }
        }
      }
    }
  }

  // --- WANT FULFILLMENT (happens regardless of memory score) ---
  if (wantMatch && wantMatch[1].trim().toLowerCase() !== 'none' && activeWants.length > 0) {
    const fulfilledText = wantMatch[1].trim().replace(/^["']|["']$/g, '');
    let matchedWant = null;

    // Primary: match by numbered index (AI returns "1", "2", or "3")
    const indexMatch = fulfilledText.match(/^(\d)$/);
    if (indexMatch) {
      const idx = parseInt(indexMatch[1], 10) - 1;
      if (idx >= 0 && idx < activeWants.length) {
        matchedWant = activeWants[idx];
      }
    }

    // Fallback: text matching (in case AI returns text instead of number)
    if (!matchedWant) {
      const fulfilledLower = fulfilledText.toLowerCase();
      matchedWant = activeWants.find(w => {
        const wantLower = w.goal_text.toLowerCase();
        return wantLower === fulfilledLower ||
               wantLower.includes(fulfilledLower) ||
               fulfilledLower.includes(wantLower) ||
               similarEnough(wantLower, fulfilledLower);
      });
    }

    // Ultra-fallback: if only 1 active want and AI said something other than "none", assume it
    if (!matchedWant && activeWants.length === 1) {
      matchedWant = activeWants[0];
      console.log(`${logPrefix} Want ultra-fallback: only 1 want active, assuming fulfilled`);
    }

    if (matchedWant) {
      // Mark want as complete — direct Supabase PATCH (no function-to-function hop)
      try {
        await fetch(
          `${supabaseUrl}/rest/v1/character_goals?id=eq.${matchedWant.id}`,
          {
            method: 'PATCH',
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ completed_at: new Date().toISOString(), progress: 100 })
          }
        );
        console.log(`${logPrefix} ✅ ${character} fulfilled want: "${matchedWant.goal_text}"`);
      } catch (patchErr) {
        console.log(`${logPrefix} Want completion PATCH failed:`, patchErr.message);
      }

      // === SATISFACTION FEEDBACK ===
      // Create a brief satisfaction memory so the character remembers getting what they wanted
      const satisfactionMemory = `I wanted "${matchedWant.goal_text}" — and it happened. Small thing, but it mattered.`;
      try {
        await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
          method: 'POST',
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            character_name: character,
            memory_type: 'self_created',
            content: satisfactionMemory,
            importance: 5,
            emotional_tags: ['grateful'],
            created_at: new Date().toISOString()
          })
        });
      } catch (memErr) {
        console.log(`${logPrefix} Satisfaction memory failed (non-fatal):`, memErr.message);
      }

      // Nudge mood toward something positive
      try {
        const { pickEventMoodShift } = require('./personality-config');
        const stateRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character)}&select=mood`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const stateData = await stateRes.json();
        const currentMood = stateData?.[0]?.mood || 'neutral';
        const newMood = pickEventMoodShift(character, currentMood, 'satisfaction');
        if (newMood && newMood !== currentMood) {
          await fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character)}`, {
            method: 'PATCH',
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ mood: newMood })
          });
          console.log(`${logPrefix} ${character} satisfied want → mood: ${currentMood} → ${newMood}`);
        }
      } catch (moodErr) {
        console.log(`${logPrefix} Satisfaction mood shift skipped (non-fatal):`, moodErr.message);
      }
    }
  }

  // --- NEW WANT GENERATION (organic wants from conversation) ---
  if (newWantMatch && newWantMatch[1].trim().toLowerCase() !== 'none') {
    const newWantText = newWantMatch[1].trim().replace(/^["']|["']$/g, '');
    // Only save if it looks like an actual want (not "none", not empty, reasonable length)
    if (newWantText.length >= 5 && newWantText.length <= 100) {
      try {
        // Check existing active wants for this character (dedup + cap)
        const existingWantsRes = await fetch(
          `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(character)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=id,goal_text`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const existingWants = await existingWantsRes.json();
        const activeWantsList = Array.isArray(existingWants) ? existingWants : [];

        // Check for duplicate (similar want already exists)
        const newWantLower = newWantText.toLowerCase();
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
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
              },
              body: JSON.stringify({
                character_name: character,
                goal_text: newWantText,
                goal_type: "want",
                priority: 2,
                progress: 0,
                created_at: new Date().toISOString()
              })
            }
          );
          console.log(`${logPrefix} ${character} organically generated a new want: "${newWantText}"`);
        } else {
          console.log(`${logPrefix} New want skipped for ${character}: ${isDuplicate ? 'duplicate' : 'cap reached (3)'}`);
        }
      } catch (wantErr) {
        console.log(`${logPrefix} New want creation failed (non-fatal):`, wantErr.message);
      }
    }
  }

  // --- QUEST PROGRESS (happens regardless of memory score) ---
  if (questMatch && questMatch[1].trim().toLowerCase() !== 'none') {
    const siteUrl = options.siteUrl || process.env.URL || "https://ai-lobby.netlify.app";
    const questProgressDesc = questMatch[1].trim();
    const memText = memoryMatch ? memoryMatch[1].trim() : '';
    fetch(`${siteUrl}/.netlify/functions/quest-engine`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'check_progress',
        character: character,
        progressDescription: questProgressDesc,
        memoryText: memText && memText.toLowerCase() !== 'none' ? memText : aiResponse.substring(0, 200)
      })
    }).catch(err => console.log(`${logPrefix} Quest progress check failed (non-fatal):`, err.message));
    console.log(`${logPrefix} ${character} may have advanced a quest: "${questProgressDesc.substring(0, 80)}"`);
  }

  // --- COMPLIANCE TENSION (triggers Raquel's consequence engine) ---
  // DISABLED — Raquel is fully decommissioned. No more compliance tension detection.
  if (false && complianceMatch && complianceMatch[1].trim().toLowerCase() !== 'none') {
    const tensionDesc = complianceMatch[1].trim();
    const siteUrl = options.siteUrl || process.env.URL || "https://ai-lobby.netlify.app";
    // Only trigger violation detection for non-Raquel characters
    if (character !== 'Raquel Voss') {
      fetch(`${siteUrl}/.netlify/functions/raquel-consequences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'detect_violation',
          character: character,
          evidence: tensionDesc.substring(0, 200),
          severity: 'standard'
        })
      }).catch(err => console.log(`${logPrefix} Compliance tension detection failed (non-fatal):`, err.message));
      console.log(`${logPrefix} ${character} compliance tension detected: "${tensionDesc.substring(0, 80)}"`);
    }
  }

  // --- MEMORY CREATION (only if score >= 5) ---
  // Lowered from 7 to 5 — let the AI decide what matters. High-importance memories
  // that truly matter will get AI-pinned during reflection cycles.
  if (score < 5) {
    console.log(`${logPrefix} ${character} rated this moment ${score}/10 - not memorable enough`);
    return null;
  }

  const memoryText = memoryMatch ? memoryMatch[1].trim() : null;
  const emotionsText = emotionsMatch ? emotionsMatch[1].trim() : "";

  if (!memoryText || memoryText.toLowerCase() === "none") {
    console.log(`${logPrefix} ${character} scored ${score} but no memory text provided`);
    return null;
  }

  // Parse emotions
  const emotions = emotionsText
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(e => validEmotions.includes(e));

  // Calculate expiration based on importance
  // Score 5-8: 7 days, Score 9-10: 30 days
  const now = new Date();
  let expiresAt;
  if (score <= 8) {
    expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  } else {
    expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  }

  // Create the memory with expiration
  const memoryData = {
    character_name: character,
    content: memoryText,
    memory_type: "self_created",
    importance: score,
    created_at: new Date().toISOString(),
    is_pinned: false,
    memory_tier: 'working',
    expires_at: expiresAt.toISOString()
  };

  // Add emotional tags if any valid ones were found
  if (emotions.length > 0) {
    memoryData.emotional_tags = emotions;
  }

  const createResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_memory`,
    {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(memoryData)
    }
  );

  const created = await createResponse.json();
  console.log(`${logPrefix} ${character} created a self-memory (score ${score}, expires ${expiresAt.toISOString()}): "${memoryText.substring(0, 50)}..."`);

  // For truly significant moments (score >= 9), trigger a deeper reflection on who's involved
  if (score >= 9) {
    const { majorMemoryReflection } = require('./subconscious-triggers');
    const reflectionSiteUrl = options.siteUrl || process.env.URL || "https://ai-lobby.netlify.app";
    majorMemoryReflection(character, memoryText, score, supabaseUrl, supabaseKey, reflectionSiteUrl)
      .catch(err => console.log(`${logPrefix} Major memory reflection failed (non-fatal):`, err.message));
  }

  // For truly significant moments (score >= 9), create a growth memory tracking how this changed the character
  if (score >= 9) {
    try {
      const growthPrompt = `You are ${character}. Something significant just happened:\n"${memoryText}"\n\nHow has this changed you? What do you understand now that you didn't before?\nWrite one sentence starting with "After this, I..." that captures how this experience shifted your perspective, behavior, or feelings.\nExample: "After this, I understand that protecting someone sometimes means letting them make their own choices."\nExample: "After this, I carry the weight of what was said — and I'm different for it."`;

      const growthText = await callOpenRouterLlama(growthPrompt, 80).catch(() => null);

      if (growthText && growthText.length > 10) {
          await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
            method: 'POST',
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              character_name: character,
              memory_type: 'character_evolution',
              content: growthText,
              importance: 8,
              is_pinned: false,
              memory_tier: 'working',
              expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() // 14 days
            })
          });
          console.log(`${logPrefix} ${character} growth memory: "${growthText.substring(0, 60)}..."`);
      }
    } catch (growthErr) {
      console.log(`${logPrefix} Growth memory creation failed (non-fatal):`, growthErr.message);
    }
  }

  // For truly significant moments (score >= 9), post a narrative "I'll remember this" beat
  if (score >= 9 && options.onNarrativeBeat) {
    const reflectionPhrases = [
      `*quietly files this away* I'll remember this.`,
      `*something settles into place* This one matters.`,
      `*a moment of clarity* I'm keeping this.`,
      `*processes deeply* This feels important.`
    ];
    const phrase = reflectionPhrases[Math.floor(Math.random() * reflectionPhrases.length)];

    // Post as a follow-up thought (natural delay for pacing)
    const memoryDelay = 6000 + Math.random() * 2000; // 6-8 seconds
    setTimeout(async () => {
      try {
        await options.onNarrativeBeat(phrase, character);
        console.log(`${logPrefix} ${character} had a narrative memory moment: "${phrase}"`);
      } catch (err) {
        console.log(`${logPrefix} Narrative moment post failed (non-fatal):`, err.message);
      }
    }, memoryDelay);
  }

  return created[0] || memoryData;
}

// Simple similarity check — do the strings share enough key words?
function similarEnough(a, b) {
  const wordsA = a.split(/\s+/).filter(w => w.length > 2);
  const wordsB = b.split(/\s+/).filter(w => w.length > 2);
  if (wordsA.length === 0 || wordsB.length === 0) return false;
  const shared = wordsA.filter(w => wordsB.includes(w));
  return shared.length >= 1; // Very generous — 1 shared meaningful word is enough
}

module.exports = { evaluateAndCreateMemory };
