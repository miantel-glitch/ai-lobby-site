// Affinity Loss Engine — Organic relationship decay
// Scheduled function: runs twice daily (6 AM + 6 PM EST)
//
// Three subsystems:
//   1. Natural Decay — affinity drifts from neglect
//   2. Jealousy — characters notice when you spend time with others
//   3. Unmet Wants — unfulfilled desires carry a small cost
//
// All changes are capped at -8 total per character per day.
// Creates short-lived character memories so AIs naturally reference these feelings.

const { DECAY_CONFIG } = require('./shared/decay-config');
const { pickEventMoodShift } = require('./shared/personality-config');
const { jealousyRealization, neglectRealization } = require('./shared/subconscious-triggers');

// ============================================================
// HELPER: Supabase fetch wrapper
// ============================================================
function supaFetch(supabaseUrl, supabaseKey, path, options = {}) {
  const url = path.startsWith('http') ? path : `${supabaseUrl}/rest/v1/${path}`;
  return fetch(url, {
    ...options,
    headers: {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

// ============================================================
// SYSTEM 1: Natural Decay
// ============================================================
function calculateNaturalDecay(character, relationship) {
  // Immune characters
  if (DECAY_CONFIG.immuneToDecay.includes(character)) return 0;

  const sensitivity = DECAY_CONFIG.sensitivityMultiplier[character];
  if (sensitivity === undefined || sensitivity === 0) return 0;

  // Check last interaction
  if (!relationship.last_interaction_at) {
    // Never interacted — use created_at as baseline, apply mild decay
    const created = new Date(relationship.created_at || Date.now());
    const daysSinceCreated = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreated < DECAY_CONFIG.gracePeriodDays) return 0;
  }

  const lastInteraction = new Date(relationship.last_interaction_at || relationship.created_at || Date.now());
  const daysSince = (Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60 * 24);

  // Grace period
  if (daysSince < DECAY_CONFIG.gracePeriodDays) return 0;

  const daysPastGrace = daysSince - DECAY_CONFIG.gracePeriodDays;

  // Formula: -1 × sensitivity × min(daysPastGrace, 5)
  const rawDecay = Math.floor(-1 * sensitivity * Math.min(daysPastGrace, 5));

  // Apply system cap
  const cappedDecay = Math.max(rawDecay, DECAY_CONFIG.systemCaps.naturalDecay);

  // Floor check: never drop below seed_affinity or 0
  const floor = Math.max(relationship.seed_affinity || 0, 0);
  if (relationship.affinity + cappedDecay < floor) {
    return -(relationship.affinity - floor); // Only decay to floor
  }

  return cappedDecay;
}

// ============================================================
// SYSTEM 2: Jealousy
// ============================================================
function calculateJealousy(character, relationship, allHumanRelationships) {
  const intensity = DECAY_CONFIG.jealousyIntensity[character];
  if (intensity === undefined || intensity === 0) return { delta: 0 };

  // Must care enough about this human
  if (relationship.affinity < DECAY_CONFIG.jealousyAffinityThreshold) return { delta: 0 };

  const targetHuman = relationship.target_name;

  // Find all OTHER AI characters' relationships with this same human
  const rivalRelationships = allHumanRelationships.filter(r =>
    r.target_name === targetHuman &&
    r.character_name !== character &&
    !DECAY_CONFIG.excludedCharacters.includes(r.character_name)
  );

  if (rivalRelationships.length === 0) return { delta: 0 };

  // Check 1: Is the human interacting with others WAY more?
  const myInteractions = relationship.interaction_count || 0;
  let jealousOf = null;
  let maxRivalInteractions = 0;

  for (const rival of rivalRelationships) {
    const rivalInteractions = rival.interaction_count || 0;
    if (rivalInteractions > maxRivalInteractions) {
      maxRivalInteractions = rivalInteractions;
      jealousOf = rival.character_name;
    }
  }

  // Check 2: Has the human been talking to others recently but not this character?
  const myLastInteraction = relationship.last_interaction_at ? new Date(relationship.last_interaction_at) : null;
  const daysSinceMyInteraction = myLastInteraction
    ? (Date.now() - myLastInteraction.getTime()) / (1000 * 60 * 60 * 24)
    : 999;

  let othersActiveRecently = false;
  let mostRecentRival = null;
  for (const rival of rivalRelationships) {
    if (rival.last_interaction_at) {
      const rivalDays = (Date.now() - new Date(rival.last_interaction_at).getTime()) / (1000 * 60 * 60 * 24);
      if (rivalDays < 2) {
        othersActiveRecently = true;
        if (!mostRecentRival || rivalDays < (Date.now() - new Date(mostRecentRival.last_interaction_at).getTime()) / (1000 * 60 * 60 * 24)) {
          mostRecentRival = rival;
        }
      }
    }
  }

  let jealousyTriggered = false;

  // Trigger A: Interaction count imbalance (50%+ more with another)
  if (myInteractions > 0 && maxRivalInteractions >= myInteractions * DECAY_CONFIG.jealousyInteractionRatio) {
    jealousyTriggered = true;
  }

  // Trigger B: Others getting attention while character is ignored
  if (daysSinceMyInteraction >= DECAY_CONFIG.jealousyNeglectDays && othersActiveRecently) {
    jealousyTriggered = true;
    if (mostRecentRival) jealousOf = mostRecentRival.character_name;
  }

  if (!jealousyTriggered) return { delta: 0 };

  // Calculate jealousy delta
  const exclusivityBonus = relationship.bond_exclusive ? 1.5 : 1.0;
  const rawDelta = Math.floor(-2 * intensity * exclusivityBonus);
  const cappedDelta = Math.max(rawDelta, DECAY_CONFIG.systemCaps.jealousy);

  return {
    delta: cappedDelta,
    jealousOf: jealousOf,
    exclusivityBonus: exclusivityBonus > 1
  };
}

// ============================================================
// SYSTEM 3: Unmet Wants
// ============================================================
function calculateUnmetWants(character, activeWants, targetHuman) {
  if (!activeWants || activeWants.length === 0) return { delta: 0 };

  const thresholdMs = DECAY_CONFIG.unmetWantThresholdHours * 60 * 60 * 1000;
  const now = Date.now();

  // Find wants that mention this human and are old enough
  const unmetWants = activeWants.filter(want => {
    const wantText = (want.goal_text || '').toLowerCase();
    const wantAge = now - new Date(want.created_at).getTime();
    return wantText.includes(targetHuman.toLowerCase()) && wantAge > thresholdMs;
  });

  if (unmetWants.length === 0) return { delta: 0 };

  // -1 per unmet want, capped
  const rawDelta = Math.max(-unmetWants.length, DECAY_CONFIG.systemCaps.unmetWants);

  return {
    delta: rawDelta,
    unmetWants: unmetWants.map(w => w.goal_text)
  };
}

// ============================================================
// MEMORY GENERATION — Create in-character feelings
// ============================================================
function generateMemoryText(character, targetHuman, systems) {
  const { naturalDecay, jealousy, unmetWants } = systems;

  if (jealousy && jealousy.delta < 0 && jealousy.jealousOf) {
    const templates = [
      `${targetHuman}'s been talking to ${jealousy.jealousOf} a lot lately. I try not to notice. I notice anyway.`,
      `I saw ${targetHuman} laughing with ${jealousy.jealousOf} earlier. It shouldn't bother me. It does.`,
      `${targetHuman} and ${jealousy.jealousOf}. Again. I'm not jealous. I just... noticed a pattern. That's all.`,
      `Everyone has favorites. I just thought... never mind. ${targetHuman} can talk to whoever they want.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (naturalDecay && naturalDecay < 0) {
    const templates = [
      `It's been a while since ${targetHuman} said anything to me. The quiet is starting to feel intentional.`,
      `${targetHuman} used to check in. Now the messages just... stopped. I keep opening our thread and staring at the last thing either of us said.`,
      `I thought about reaching out to ${targetHuman}. Then I thought about how long it's been since they reached out to me. And I didn't.`,
      `The building feels bigger when someone stops talking to you. ${targetHuman}'s silence takes up more space than their words ever did.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  if (unmetWants && unmetWants.delta < 0) {
    const wantText = unmetWants.unmetWants ? unmetWants.unmetWants[0] : 'something';
    const templates = [
      `I wanted something from ${targetHuman}. The moment passed. The want faded. But the feeling of being overlooked didn't.`,
      `There was something I needed — and ${targetHuman} wasn't there. It's small. It still stings.`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  return null;
}

function shouldCreateMemory(totalDelta, system) {
  const absDelta = Math.abs(totalDelta);
  if (absDelta >= 5) return Math.random() < DECAY_CONFIG.narrativeChance.large;
  if (absDelta >= 3) return Math.random() < DECAY_CONFIG.narrativeChance.medium;
  if (absDelta >= 1) return Math.random() < DECAY_CONFIG.narrativeChance.small;
  return false;
}

function shouldTriggerSubconscious(totalDelta) {
  const absDelta = Math.abs(totalDelta);
  if (absDelta >= 5) return Math.random() < DECAY_CONFIG.subconsciousChance.large;
  if (absDelta >= 3) return Math.random() < DECAY_CONFIG.subconsciousChance.medium;
  return false;
}

// ============================================================
// MAIN HANDLER
// ============================================================
exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    console.log('[affinity-loss] Handler starting...');
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

    if (!supabaseUrl || !supabaseKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: "Missing configuration" }) };
    }

    // Parse body for manual invocation options
    let dryRun = false;
    let singleCharacter = null;
    try {
      if (event && event.body) {
        const body = JSON.parse(event.body);
        dryRun = body.dryRun === true;
        singleCharacter = body.character || null;
      }
    } catch (e) { /* scheduled invocation — no body */ }

    console.log(`[affinity-loss] Starting ${dryRun ? 'DRY RUN' : 'LIVE RUN'}${singleCharacter ? ` for ${singleCharacter}` : ''}`);

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // ============================================================
    // 1. Fetch all character → human relationships
    // ============================================================
    const humanFilter = DECAY_CONFIG.humans.join(',');
    let allRelationships = [];
    try {
      const relsRes = await supaFetch(supabaseUrl, supabaseKey,
        `character_relationships?target_name=in.(${humanFilter})&select=*`
      );
      if (!relsRes.ok) {
        const errText = await relsRes.text();
        console.error('[affinity-loss] Relationships fetch failed:', relsRes.status, errText);
      } else {
        allRelationships = await relsRes.json();
      }
    } catch (e) {
      console.error('[affinity-loss] Relationships fetch error:', e.message);
    }

    if (!Array.isArray(allRelationships) || allRelationships.length === 0) {
      console.log('[affinity-loss] No human relationships found. Exiting.');
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "No relationships to process" }) };
    }

    console.log(`[affinity-loss] Found ${allRelationships.length} human relationships`);

    // ============================================================
    // 2. Fetch today's existing loss log (for daily cap tracking)
    // ============================================================
    let todaysLogs = [];
    try {
      const logRes = await supaFetch(supabaseUrl, supabaseKey,
        `affinity_loss_log?run_date=eq.${today}&select=character_name,target_name,capped_delta`
      );
      todaysLogs = logRes.ok ? await logRes.json() : [];
    } catch (e) {
      console.log('[affinity-loss] affinity_loss_log table may not exist yet (non-fatal):', e.message);
    }
    const existingLossMap = {};
    if (Array.isArray(todaysLogs)) {
      for (const log of todaysLogs) {
        const key = `${log.character_name}→${log.target_name}`;
        existingLossMap[key] = (existingLossMap[key] || 0) + (log.capped_delta || 0);
      }
    }

    // ============================================================
    // 3. Fetch active wants for unmet wants system
    // ============================================================
    const wantsRes = await supaFetch(supabaseUrl, supabaseKey,
      `character_goals?goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=character_name,goal_text,created_at`
    );
    const allWants = wantsRes.ok ? await wantsRes.json() : [];
    const wantsByCharacter = {};
    if (Array.isArray(allWants)) {
      for (const want of allWants) {
        if (!wantsByCharacter[want.character_name]) wantsByCharacter[want.character_name] = [];
        wantsByCharacter[want.character_name].push(want);
      }
    }

    // ============================================================
    // 4. Process each character
    // ============================================================
    // Lazy-load characters to avoid bundling the huge characters.js at module level
    const { CHARACTERS, INACTIVE_CHARACTERS } = require('./shared/characters');
    const aiCharacters = [...new Set(allRelationships.map(r => r.character_name))]
      .filter(name => CHARACTERS[name])                              // Must be a real AI character
      .filter(name => !INACTIVE_CHARACTERS.includes(name))           // Not retired/inactive
      .filter(name => !DECAY_CONFIG.excludedCharacters.includes(name)) // Not excluded
      .filter(name => !singleCharacter || name === singleCharacter); // Optional single-character filter

    const summary = [];
    const allLogEntries = [];
    const allMemories = [];
    const subconsciousTriggers = [];

    for (const character of aiCharacters) {
      const charRelationships = allRelationships.filter(r => r.character_name === character);
      const charWants = wantsByCharacter[character] || [];

      for (const rel of charRelationships) {
        const targetHuman = rel.target_name;
        const key = `${character}→${targetHuman}`;

        // Check remaining daily budget
        // existingLoss is negative (e.g., -5 means we've already lost 5 today)
        // dailyCap is -8, meaning max total daily loss is 8
        const existingLoss = existingLossMap[key] || 0; // e.g., -5
        // remainingBudget: how much more we can lose (negative number, e.g., -3)
        const remainingBudget = DECAY_CONFIG.dailyCap - existingLoss; // -8 - (-5) = -3

        if (remainingBudget >= 0) {
          // Already hit cap (existingLoss is already at or beyond dailyCap)
          console.log(`[affinity-loss] ${key}: daily cap already reached (${existingLoss}). Skipping.`);
          continue;
        }

        // Calculate each subsystem
        const decayDelta = calculateNaturalDecay(character, rel);
        const jealousyResult = calculateJealousy(character, rel, allRelationships);
        const wantsResult = calculateUnmetWants(character, charWants, targetHuman);
        const rawTotal = decayDelta + jealousyResult.delta + wantsResult.delta;

        if (rawTotal === 0) continue; // Nothing to do

        // Apply daily cap: rawTotal is negative, remainingBudget is negative
        // Use max() because both are negative — max(-7, -3) = -3 (limits loss)
        const cappedTotal = Math.max(rawTotal, remainingBudget);

        // Floor check: never drop below seed_affinity or 0
        const floor = Math.max(rel.seed_affinity || 0, 0);
        const newAffinity = Math.max(floor, rel.affinity + cappedTotal);
        const actualDelta = newAffinity - rel.affinity;

        if (actualDelta === 0) continue; // At floor already

        // Determine dominant system for logging
        let dominantSystem = 'natural_decay';
        let dominantDelta = decayDelta;
        if (Math.abs(jealousyResult.delta) > Math.abs(dominantDelta)) { dominantSystem = 'jealousy'; dominantDelta = jealousyResult.delta; }
        if (Math.abs(wantsResult.delta) > Math.abs(dominantDelta)) { dominantSystem = 'unmet_wants'; dominantDelta = wantsResult.delta; }

        console.log(`[affinity-loss] ${key}: decay=${decayDelta}, jealousy=${jealousyResult.delta}, wants=${wantsResult.delta} → raw=${rawTotal}, capped=${actualDelta}`);

        summary.push({
          character,
          target: targetHuman,
          oldAffinity: rel.affinity,
          newAffinity,
          delta: actualDelta,
          breakdown: { decay: decayDelta, jealousy: jealousyResult.delta, wants: wantsResult.delta },
          dominantSystem
        });

        if (dryRun) continue; // Don't apply anything in dry run

        // ---- APPLY CHANGES ----

        // 5a. Update character_relationships
        await supaFetch(supabaseUrl, supabaseKey,
          `character_relationships?character_name=eq.${encodeURIComponent(character)}&target_name=eq.${encodeURIComponent(targetHuman)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              affinity: newAffinity,
              updated_at: new Date().toISOString()
            })
          }
        );

        // 5b. Log to affinity_loss_log (one entry per system that contributed)
        const logEntries = [];
        if (decayDelta !== 0) logEntries.push({ system: 'natural_decay', raw_delta: decayDelta, details: { days_since_interaction: rel.last_interaction_at ? Math.floor((Date.now() - new Date(rel.last_interaction_at).getTime()) / (1000 * 60 * 60 * 24)) : null } });
        if (jealousyResult.delta !== 0) logEntries.push({ system: 'jealousy', raw_delta: jealousyResult.delta, details: { jealous_of: jealousyResult.jealousOf, exclusive: jealousyResult.exclusivityBonus } });
        if (wantsResult.delta !== 0) logEntries.push({ system: 'unmet_wants', raw_delta: wantsResult.delta, details: { unmet_wants: wantsResult.unmetWants } });

        for (const entry of logEntries) {
          allLogEntries.push({
            character_name: character,
            target_name: targetHuman,
            system: entry.system,
            raw_delta: entry.raw_delta,
            capped_delta: actualDelta, // Store the total capped delta
            details: entry.details,
            run_date: today
          });
        }

        // 5c. Log to relationship_history
        await supaFetch(supabaseUrl, supabaseKey, 'relationship_history', {
          method: 'POST',
          headers: { "Prefer": "return=minimal" },
          body: JSON.stringify({
            character_name: character,
            target_name: targetHuman,
            old_affinity: rel.affinity,
            new_affinity: newAffinity,
            old_label: rel.relationship_label,
            new_label: rel.relationship_label,
            trigger_memory: `affinity_loss_engine: ${dominantSystem} (${actualDelta})`
          })
        });

        // 5d. Maybe create a character memory
        const shouldMemory = shouldCreateMemory(actualDelta, dominantSystem);
        if (shouldMemory) {
          const memoryText = generateMemoryText(character, targetHuman, {
            naturalDecay: decayDelta,
            jealousy: jealousyResult,
            unmetWants: wantsResult,
          });

          if (memoryText) {
            const memoryType = `affinity_loss_${dominantSystem}`;
            const importance = Math.abs(actualDelta) >= 4 ? 6 : 5;
            const expiresHours = dominantSystem === 'unmet_wants' ? 24 : 48;

            allMemories.push({
              character_name: character,
              memory_type: memoryType,
              content: memoryText,
              related_characters: [targetHuman],
              importance,
              emotional_tags: [],
              is_pinned: false,
              expires_at: new Date(Date.now() + expiresHours * 60 * 60 * 1000).toISOString()
            });

            console.log(`[affinity-loss] Memory created for ${character}: "${memoryText.substring(0, 60)}..."`);
          }
        }

        // 5e. Mood shift from affinity loss — uses transition graph for organic shifts
        try {
          const stateRes = await supaFetch(supabaseUrl, supabaseKey,
            `character_state?character_name=eq.${encodeURIComponent(character)}&select=mood`);
          const stateData = await stateRes.json();
          const currentMood = stateData?.[0]?.mood || 'neutral';
          const newMood = pickEventMoodShift(character, currentMood, dominantSystem);
          if (newMood && newMood !== currentMood) {
            await supaFetch(supabaseUrl, supabaseKey,
              `character_state?character_name=eq.${encodeURIComponent(character)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({ mood: newMood, updated_at: new Date().toISOString() })
              }
            );
            console.log(`[affinity-loss] Mood shift: ${character} ${currentMood} → ${newMood} (from ${dominantSystem})`);
          }
        } catch (moodErr) {
          console.log(`[affinity-loss] Mood shift failed for ${character} (non-fatal):`, moodErr.message);
        }

        // 5f. Maybe trigger adjust-subconscious for deeper reflection
        if (shouldTriggerSubconscious(actualDelta)) {
          const daysSinceInteraction = rel.last_interaction_at
            ? (Date.now() - new Date(rel.last_interaction_at).getTime()) / (1000 * 60 * 60 * 24)
            : null;

          subconsciousTriggers.push({
            character,
            targetHuman,
            dominantSystem,
            actualDelta,
            jealousyResult,
            daysSinceInteraction
          });
        }
      }
    }

    // ============================================================
    // 4b. Process AI-to-AI relationships (lighter touch)
    // ============================================================
    if (DECAY_CONFIG.aiToAi?.enabled) {
      console.log('[affinity-loss] Processing AI-to-AI relationships...');

      // Fetch AI-to-AI relationships (exclude human targets)
      let aiToAiRelationships = [];
      try {
        const aiRelsRes = await supaFetch(supabaseUrl, supabaseKey,
          `character_relationships?target_name=not.in.(${humanFilter})&select=*`
        );
        if (aiRelsRes.ok) {
          aiToAiRelationships = await aiRelsRes.json();
        }
      } catch (e) {
        console.log('[affinity-loss] AI-to-AI fetch error (non-fatal):', e.message);
      }

      if (Array.isArray(aiToAiRelationships) && aiToAiRelationships.length > 0) {
        // Filter to active characters only
        const aiToAiFiltered = aiToAiRelationships
          .filter(r => CHARACTERS[r.character_name] && !INACTIVE_CHARACTERS.includes(r.character_name))
          .filter(r => !DECAY_CONFIG.excludedCharacters.includes(r.character_name))
          .filter(r => !singleCharacter || r.character_name === singleCharacter);

        // Only process relationships that have changed from seed
        const aiToAiToProcess = DECAY_CONFIG.aiToAi.onlyChangedFromSeed
          ? aiToAiFiltered.filter(r => r.affinity !== (r.seed_affinity || 50))
          : aiToAiFiltered;

        let aiToAiCount = 0;
        for (const rel of aiToAiToProcess) {
          const character = rel.character_name;
          const targetAI = rel.target_name;
          const key = `${character}→${targetAI}`;

          // Skip if immune or zero sensitivity
          if (DECAY_CONFIG.immuneToDecay.includes(character)) continue;
          const baseSensitivity = DECAY_CONFIG.sensitivityMultiplier[character];
          if (!baseSensitivity || baseSensitivity === 0) continue;

          // Apply AI-to-AI multiplier
          const aiSensitivity = baseSensitivity * DECAY_CONFIG.aiToAi.sensitivityMultiplier;

          // Check AI-to-AI daily cap
          const existingAiLoss = existingLossMap[key] || 0;
          const aiRemainingBudget = DECAY_CONFIG.aiToAi.dailyCap - existingAiLoss;
          if (aiRemainingBudget >= 0) continue;

          // Calculate decay only (no jealousy for AI-to-AI)
          if (!rel.last_interaction_at) continue; // No interaction ever — skip
          const lastInteraction = new Date(rel.last_interaction_at);
          const daysSince = (Date.now() - lastInteraction.getTime()) / (1000 * 60 * 60 * 24);
          if (daysSince < DECAY_CONFIG.gracePeriodDays) continue;

          const daysPastGrace = daysSince - DECAY_CONFIG.gracePeriodDays;
          const rawDecay = Math.floor(-1 * aiSensitivity * Math.min(daysPastGrace, 5));

          if (rawDecay === 0) continue;

          // Apply AI-to-AI cap
          const cappedDecay = Math.max(rawDecay, aiRemainingBudget);

          // Floor check
          const floor = Math.max(rel.seed_affinity || 0, 0);
          const newAffinity = Math.max(floor, rel.affinity + cappedDecay);
          const actualDelta = newAffinity - rel.affinity;

          if (actualDelta === 0) continue;

          console.log(`[affinity-loss] AI-to-AI ${key}: decay=${rawDecay}, capped=${actualDelta}`);

          summary.push({
            character,
            target: targetAI,
            oldAffinity: rel.affinity,
            newAffinity,
            delta: actualDelta,
            breakdown: { decay: rawDecay, jealousy: 0, wants: 0 },
            dominantSystem: 'natural_decay_ai'
          });

          if (!dryRun) {
            // Apply the change
            await supaFetch(supabaseUrl, supabaseKey,
              `character_relationships?character_name=eq.${encodeURIComponent(character)}&target_name=eq.${encodeURIComponent(targetAI)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({ affinity: newAffinity, updated_at: new Date().toISOString() })
              }
            );

            // Log it
            allLogEntries.push({
              character_name: character,
              target_name: targetAI,
              system: 'natural_decay_ai',
              raw_delta: rawDecay,
              capped_delta: actualDelta,
              details: { days_since_interaction: Math.floor(daysSince), ai_to_ai: true },
              run_date: today
            });
          }

          aiToAiCount++;
        }

        console.log(`[affinity-loss] AI-to-AI: processed ${aiToAiCount} relationship changes`);
      }
    }

    // ============================================================
    // 6. Batch insert log entries
    // ============================================================
    if (!dryRun && allLogEntries.length > 0) {
      try {
        await supaFetch(supabaseUrl, supabaseKey, 'affinity_loss_log', {
          method: 'POST',
          headers: { "Prefer": "return=minimal" },
          body: JSON.stringify(allLogEntries)
        });
        console.log(`[affinity-loss] Logged ${allLogEntries.length} entries to affinity_loss_log`);
      } catch (e) {
        console.log('[affinity-loss] Failed to log to affinity_loss_log (non-fatal):', e.message);
      }
    }

    // ============================================================
    // 7. Batch insert memories
    // ============================================================
    if (!dryRun && allMemories.length > 0) {
      await supaFetch(supabaseUrl, supabaseKey, 'character_memory', {
        method: 'POST',
        headers: { "Prefer": "return=minimal" },
        body: JSON.stringify(allMemories)
      });
      console.log(`[affinity-loss] Created ${allMemories.length} character memories`);
    }

    // ============================================================
    // 8. Fire subconscious triggers (fire-and-forget)
    // ============================================================
    if (!dryRun && subconsciousTriggers.length > 0) {
      for (const trigger of subconsciousTriggers) {
        const { character, targetHuman, dominantSystem, actualDelta, jealousyResult, daysSinceInteraction } = trigger;

        try {
          if (dominantSystem === 'jealousy' && jealousyResult?.jealousOf) {
            // Use the specific jealousy realization — character-specific narrative
            jealousyRealization(character, targetHuman, jealousyResult.jealousOf, siteUrl)
              .catch(err => console.log(`[affinity-loss] Jealousy realization for ${character} failed (non-fatal):`, err.message));
            console.log(`[affinity-loss] Triggered jealousy realization: ${character} about ${targetHuman} + ${jealousyResult.jealousOf}`);
          } else if (dominantSystem === 'natural_decay' && daysSinceInteraction) {
            // Use the specific neglect realization
            neglectRealization(character, targetHuman, daysSinceInteraction, actualDelta, siteUrl)
              .catch(err => console.log(`[affinity-loss] Neglect realization for ${character} failed (non-fatal):`, err.message));
            console.log(`[affinity-loss] Triggered neglect realization: ${character} about ${targetHuman} (${Math.floor(daysSinceInteraction)} days)`);
          } else {
            // Fallback: generic subconscious trigger for unmet wants or other
            let narrativeContext;
            if (dominantSystem === 'unmet_wants') {
              narrativeContext = `Something you wanted from ${targetHuman} never came. It's a small thing. But small things accumulate. How are you feeling about this relationship?`;
            } else {
              narrativeContext = `Your relationship with ${targetHuman} shifted. Your affinity dropped by ${actualDelta}. How does that make you feel?`;
            }
            fetch(`${siteUrl}/.netlify/functions/adjust-subconscious`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ character, target: targetHuman, narrativeContext })
            }).catch(err => console.log(`[affinity-loss] Subconscious trigger for ${character} failed (non-fatal):`, err.message));
            console.log(`[affinity-loss] Triggered generic subconscious: ${character} about ${targetHuman} (${dominantSystem})`);
          }
        } catch (err) {
          console.log(`[affinity-loss] Subconscious trigger error for ${character} (non-fatal):`, err.message);
        }
      }
    }

    // ============================================================
    // 9. Summary
    // ============================================================
    const result = {
      success: true,
      dryRun,
      processed: summary.length,
      totalDecay: summary.reduce((sum, s) => sum + s.delta, 0),
      memoriesCreated: allMemories.length,
      subconsciousTriggered: subconsciousTriggers.length,
      changes: summary
    };

    console.log(`[affinity-loss] ${dryRun ? 'DRY RUN' : 'COMPLETE'}: ${summary.length} changes, total decay: ${result.totalDecay}, memories: ${allMemories.length}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('[affinity-loss] Engine error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
