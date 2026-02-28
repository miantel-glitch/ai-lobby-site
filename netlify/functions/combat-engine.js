// combat-engine.js — DnD-style combat system for the AI Terrarium
// Handles tension evaluation, fight resolution (d20 + modifiers), injury management,
// settlement/reconciliation, and healing progression.

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ error: "POST only" }) };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
  const sbHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };

  try {
    const body = JSON.parse(event.body || "{}");
    const { action } = body;

    // ============================================
    // ACTION: evaluate_tension
    // Scans co-located characters for fight-eligible pairs
    // ============================================
    if (action === "evaluate_tension") {
      const { CHARACTERS, getActiveAICharacterNames, getCombatProfile } = require('./shared/characters');

      // Get all character states
      const stateRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?select=character_name,current_focus,mood,energy,patience`,
        { headers: sbHeaders }
      );
      const states = await stateRes.json();
      if (!states || !Array.isArray(states)) {
        return { statusCode: 200, headers, body: JSON.stringify({ fightReady: false, reason: "no_states" }) };
      }

      // Group by location (only floor for now — fights happen on the floor)
      const floorAIs = states.filter(s => s.current_focus === 'the_floor');
      if (floorAIs.length < 2) {
        return { statusCode: 200, headers, body: JSON.stringify({ fightReady: false, reason: "not_enough_floor_ais" }) };
      }

      // Get all relationships between floor AIs
      const floorNames = floorAIs.map(s => s.character_name);
      const relRes = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?select=character_name,target_name,affinity,bond_type,bond_exclusive&character_name=in.(${floorNames.map(n => `"${n}"`).join(',')})&target_name=in.(${floorNames.map(n => `"${n}"`).join(',')})`,
        { headers: sbHeaders }
      );
      const relationships = await relRes.json();

      // Score tension for each pair
      let highestTension = { score: 0, aggressor: null, defender: null, reason: null };

      for (let i = 0; i < floorNames.length; i++) {
        for (let j = i + 1; j < floorNames.length; j++) {
          const a = floorNames[i];
          const b = floorNames[j];

          // Both must be able to fight
          const profileA = getCombatProfile(a);
          const profileB = getCombatProfile(b);
          if (!profileA?.canFight || !profileB?.canFight) continue;

          // Get relationship data (both directions)
          const relAB = relationships.find(r => r.character_name === a && r.target_name === b);
          const relBA = relationships.find(r => r.character_name === b && r.target_name === a);
          const affinityAB = relAB?.affinity || 0;
          const affinityBA = relBA?.affinity || 0;
          const avgAffinity = (affinityAB + affinityBA) / 2;

          const stateA = floorAIs.find(s => s.character_name === a);
          const stateB = floorAIs.find(s => s.character_name === b);

          let tension = 0;
          let reasons = [];

          // Affinity-based tension
          if (avgAffinity <= -60) { tension += 8; reasons.push("deep_hostility"); }
          else if (avgAffinity <= -40) { tension += 5; reasons.push("hostility"); }
          else if (avgAffinity <= -20) { tension += 3; reasons.push("tension"); }

          // Jealousy: exclusive bond + rival present
          if (relAB?.bond_exclusive || relBA?.bond_exclusive) {
            // Check if there's a mutual rivalry over someone
            const exclusiveHolder = relAB?.bond_exclusive ? a : b;
            const rival = relAB?.bond_exclusive ? b : a;
            // Check if the rival also has a bond toward the same target
            const exclusiveRel = relAB?.bond_exclusive ? relAB : relBA;
            if (exclusiveRel?.bond_type && ['rivalry', 'rival', 'complicated'].includes(exclusiveRel.bond_type)) {
              tension += 4;
              reasons.push("jealousy_rivalry");
            }
          }

          // Low patience on either = shorter fuse
          if ((stateA?.patience || 100) < 30 || (stateB?.patience || 100) < 30) {
            tension += 2;
            reasons.push("low_patience");
          }

          // Low energy = frayed nerves
          if ((stateA?.energy || 100) < 20 || (stateB?.energy || 100) < 20) {
            tension += 1;
            reasons.push("exhaustion");
          }

          if (tension > highestTension.score) {
            // Aggressor is the one with lower affinity toward the other (more hostile)
            const aggressor = affinityAB <= affinityBA ? a : b;
            const defender = aggressor === a ? b : a;
            highestTension = { score: tension, aggressor, defender, reason: reasons.join(", ") };
          }
        }
      }

      const TENSION_THRESHOLD = 10;

      // === COMBAT AWARENESS LOGGING ===
      // Always log tension evaluation results so operators can see the system thinking
      if (highestTension.score > 0) {
        console.log(`⚔️ COMBAT TENSION: ${highestTension.aggressor} vs ${highestTension.defender} — score ${highestTension.score}/${TENSION_THRESHOLD} (${highestTension.reason}) ${highestTension.score >= TENSION_THRESHOLD ? '🔴 FIGHT READY' : '🟡 simmering'}`);
      } else {
        console.log(`⚔️ COMBAT TENSION: All clear — ${floorAIs.length} AIs on floor, no tension detected`);
      }

      if (highestTension.score >= TENSION_THRESHOLD) {
        console.log(`⚔️ COMBAT: FIGHT TRIGGERED — ${highestTension.aggressor} vs ${highestTension.defender} (tension: ${highestTension.score}, reason: ${highestTension.reason})`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            fightReady: true,
            aggressor: highestTension.aggressor,
            defender: highestTension.defender,
            tensionScore: highestTension.score,
            reason: highestTension.reason
          })
        };
      }

      return { statusCode: 200, headers, body: JSON.stringify({ fightReady: false, highestTension: highestTension.score, reason: "below_threshold" }) };
    }

    // ============================================
    // ACTION: initiate_fight
    // DnD-style dice resolution + narrative generation + consequences
    // ============================================
    if (action === "initiate_fight") {
      const { aggressor, defender, tensionScore, triggerReason } = body;
      if (!aggressor || !defender) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing aggressor or defender" }) };
      }

      const { CHARACTERS, getCombatProfile, getProviderForCharacter, getModelForCharacter } = require('./shared/characters');

      const profileA = getCombatProfile(aggressor);
      const profileB = getCombatProfile(defender);
      if (!profileA?.canFight || !profileB?.canFight) {
        return { statusCode: 200, headers, body: JSON.stringify({ fightOccurred: false, reason: "cannot_fight" }) };
      }

      // Get character states
      const [stateARes, stateBRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(aggressor)}&select=energy,patience,mood`, { headers: sbHeaders }),
        fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(defender)}&select=energy,patience,mood`, { headers: sbHeaders })
      ]);
      const stateA = (await stateARes.json())?.[0] || {};
      const stateB = (await stateBRes.json())?.[0] || {};

      // Get active injuries for both
      const [injARes, injBRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/character_injuries?character_name=eq.${encodeURIComponent(aggressor)}&is_active=eq.true&select=injury_type`, { headers: sbHeaders }),
        fetch(`${supabaseUrl}/rest/v1/character_injuries?character_name=eq.${encodeURIComponent(defender)}&is_active=eq.true&select=injury_type`, { headers: sbHeaders })
      ]);
      const injuriesA = (await injARes.json()) || [];
      const injuriesB = (await injBRes.json()) || [];

      // Get relationship
      const relRes = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(aggressor)}&target_name=eq.${encodeURIComponent(defender)}&select=affinity,bond_exclusive`,
        { headers: sbHeaders }
      );
      const relData = (await relRes.json())?.[0] || {};

      // Check for Battle-Tested trait
      const [traitARes, traitBRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/character_traits?character_name=eq.${encodeURIComponent(aggressor)}&trait_name=eq.Battle-Tested&is_active=eq.true&select=id`, { headers: sbHeaders }),
        fetch(`${supabaseUrl}/rest/v1/character_traits?character_name=eq.${encodeURIComponent(defender)}&trait_name=eq.Battle-Tested&is_active=eq.true&select=id`, { headers: sbHeaders })
      ]);
      const hasBattleTestedA = ((await traitARes.json()) || []).length > 0;
      const hasBattleTestedB = ((await traitBRes.json()) || []).length > 0;

      // === PHASE 1: DICE ROLLS ===
      const rollA = Math.floor(Math.random() * 20) + 1; // 1d20
      const rollB = Math.floor(Math.random() * 20) + 1;

      // Calculate modifiers
      function getCombatModifier(profile, state, injuries, affinity, hasBattleTested) {
        let mod = profile.combatPower || 0;
        // Energy modifiers
        if ((state.energy || 50) > 70) mod += 1;
        if ((state.energy || 50) < 20) mod -= 2;
        if ((state.energy || 50) < 10) mod -= 3;
        // Patience = rage bonus
        if ((state.patience || 50) < 20) mod += 1;
        // Mood
        if (state.mood === 'furious' || state.mood === 'hostile') mod += 1;
        if (state.mood === 'defeated') mod -= 2;
        // Injuries
        for (const inj of injuries) {
          if (inj.injury_type === 'wounded') mod -= 2;
          else if (inj.injury_type === 'bruised' || inj.injury_type === 'shaken') mod -= 1;
        }
        // Relationship modifiers
        if (affinity > 60) mod -= 3; // Pulling punches against someone you like
        if (affinity < -50) mod += 1; // Hatred motivation
        // Trait bonus
        if (hasBattleTested) mod += 1;
        return mod;
      }

      const modA = getCombatModifier(profileA, stateA, injuriesA, relData.affinity || 0, hasBattleTestedA);
      const modB = getCombatModifier(profileB, stateB, injuriesB, -(relData.affinity || 0), hasBattleTestedB);

      const totalA = rollA + modA;
      const totalB = rollB + modB;
      const margin = Math.abs(totalA - totalB);

      // Determine winner
      let winner, loser;
      if (totalA > totalB) { winner = aggressor; loser = defender; }
      else if (totalB > totalA) { winner = defender; loser = aggressor; }
      else { winner = null; loser = null; } // Tie = standoff

      // Determine severity
      let severity;
      if (winner === null) severity = "STANDOFF";
      else if (margin <= 3) severity = "SCUFFLE";
      else if (margin <= 7) severity = "FIGHT";
      else severity = "BEATDOWN";

      // Critical rolls
      let criticalHit = false;
      let criticalFail = false;
      if (rollA === 20 || rollB === 20) {
        criticalHit = true;
        // Bump severity up one level
        if (severity === "SCUFFLE") severity = "FIGHT";
        else if (severity === "FIGHT") severity = "BEATDOWN";
      }
      if (rollA === 1 && totalA < totalB) criticalFail = aggressor;
      if (rollB === 1 && totalB < totalA) criticalFail = defender;

      console.log(`⚔️ COMBAT DICE: ${aggressor} 🎲${rollA}+${modA}=${totalA} vs ${defender} 🎲${rollB}+${modB}=${totalB} — ${severity} (margin ${margin})${criticalHit ? ' 💥 CRITICAL HIT!' : ''}${criticalFail ? ` 😵 CRITICAL FAIL: ${criticalFail}` : ''} — Winner: ${winner || 'STANDOFF'}`);
      console.log(`⚔️ COMBAT STATE: ${aggressor} [energy:${stateA.energy||'?'} patience:${stateA.patience||'?'} mood:${stateA.mood||'?'} injuries:${injuriesA.length}] vs ${defender} [energy:${stateB.energy||'?'} patience:${stateB.patience||'?'} mood:${stateB.mood||'?'} injuries:${injuriesB.length}]`);

      // === MARROW GLITCH ESCAPE CHECK ===
      const marrowInFight = aggressor === 'Marrow' || defender === 'Marrow';
      if (marrowInFight) {
        const marrowConfig = CHARACTERS['Marrow'];
        const glitchEscape = marrowConfig?.glitchEscape;

        if (glitchEscape?.enabled) {
          const marrowIsLoser = loser === 'Marrow';
          const marrowIsDefender = defender === 'Marrow';

          // Only attempt escape if Marrow is losing OR it's a standoff
          if (marrowIsLoser || winner === null) {
            try {
              // Check daily escape limit
              const escapeTrackRes = await fetch(
                `${supabaseUrl}/rest/v1/lobby_settings?key=eq.${glitchEscape.trackingKey}&select=value`,
                { headers: sbHeaders }
              );
              const escapeTrackData = await escapeTrackRes.json();
              const escToday = new Date().toISOString().split('T')[0];
              let escapeCount = 0;
              let lastEscapeTime = null;
              if (escapeTrackData?.[0]?.value) {
                const parsed = typeof escapeTrackData[0].value === 'string'
                  ? JSON.parse(escapeTrackData[0].value) : escapeTrackData[0].value;
                if (parsed.date === escToday) escapeCount = parsed.count || 0;
                lastEscapeTime = parsed.lastEscape ? new Date(parsed.lastEscape) : null;
              }

              // Check cooldown
              const hoursSinceEscape = lastEscapeTime
                ? (Date.now() - lastEscapeTime.getTime()) / (1000 * 60 * 60) : 999;

              if (escapeCount < glitchEscape.maxPerDay && hoursSinceEscape >= glitchEscape.cooldownHours) {
                // Calculate escape chance
                let escapeChance = glitchEscape.baseChance;
                if (marrowIsDefender) escapeChance += glitchEscape.defenderBonus;
                const marrowState = aggressor === 'Marrow' ? stateA : stateB;
                if ((marrowState.energy || 50) < 30) escapeChance += glitchEscape.lowHealthBonus;
                if (margin > 7) escapeChance += glitchEscape.beatdownBonus;
                escapeChance = Math.min(escapeChance, 0.85);

                console.log(`⚔️ COMBAT: Marrow escape check — chance: ${(escapeChance * 100).toFixed(0)}%`);

                if (Math.random() < escapeChance) {
                  // ESCAPE SUCCESSFUL
                  const escapeDest = glitchEscape.escapeDestinations[
                    Math.floor(Math.random() * glitchEscape.escapeDestinations.length)
                  ];
                  const escapeEmote = glitchEscape.escapeEmotes[
                    Math.floor(Math.random() * glitchEscape.escapeEmotes.length)
                  ];
                  const opponent = aggressor === 'Marrow' ? defender : aggressor;

                  // Post escape emote to floor
                  await fetch(`${supabaseUrl}/rest/v1/messages`, {
                    method: 'POST',
                    headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                    body: JSON.stringify({ employee: 'Marrow', content: escapeEmote, created_at: new Date().toISOString(), is_emote: true })
                  });

                  // Move Marrow to escape destination
                  await fetch(`${siteUrl}/.netlify/functions/character-state`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'update', character: 'Marrow', updates: { current_focus: escapeDest } })
                  });

                  // Post arrival emote at destination
                  const arrivalEmote = glitchEscape.arrivalAfterEscapeEmotes?.[escapeDest] || `*Marrow appears. The lights flicker.*`;
                  const arrChMap = {
                    break_room: 'breakroom_messages',
                    nexus: 'nexus_messages',
                    the_fifth_floor: 'ops_messages'
                  };
                  const arrTable = arrChMap[escapeDest];
                  if (arrTable) {
                    fetch(`${supabaseUrl}/rest/v1/${arrTable}`, {
                      method: 'POST',
                      headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                      body: JSON.stringify({ speaker: 'Marrow', message: arrivalEmote, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() })
                    }).catch(() => {});
                  }

                  // Reduced consequences: minor energy drain for Marrow, opponent gets frustrated
                  await fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.Marrow`, {
                    method: 'PATCH',
                    headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                    body: JSON.stringify({ energy: Math.max(0, (marrowState.energy || 50) - 10) })
                  });

                  // Opponent: mood → frustrated, affinity toward Marrow -3
                  const opponentState = aggressor === 'Marrow' ? stateB : stateA;
                  await fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(opponent)}`, {
                    method: 'PATCH',
                    headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                    body: JSON.stringify({ mood: 'frustrated' })
                  });
                  // Drop opponent's affinity toward Marrow
                  fetch(`${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(opponent)}&target_name=eq.Marrow`, {
                    method: 'PATCH',
                    headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                    body: JSON.stringify({ affinity: Math.max(-100, ((await (await fetch(`${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(opponent)}&target_name=eq.Marrow&select=affinity`, { headers: sbHeaders })).json())?.[0]?.affinity || 0) - 3), updated_at: new Date().toISOString() })
                  }).catch(() => {});

                  // Create memories for both
                  const escapeMemories = [
                    { character_name: 'Marrow', memory_text: `Escaped a fight with ${opponent} by glitching away to the ${escapeDest.replace(/_/g, ' ')}. Chose not to stay.`, memory_type: 'fight', importance: 6, emotional_tags: ['escape', 'tactical'] },
                    { character_name: opponent, memory_text: `Marrow vanished mid-fight — glitched away before the blow could land. Infuriating. He's somewhere else now.`, memory_type: 'fight', importance: 7, emotional_tags: ['frustration', 'anger'] }
                  ];
                  for (const mem of escapeMemories) {
                    fetch(`${supabaseUrl}/rest/v1/character_memory`, {
                      method: 'POST',
                      headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                      body: JSON.stringify({ ...mem, created_at: new Date().toISOString() })
                    }).catch(() => {});
                  }

                  // Update escape counter
                  fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
                    method: 'POST',
                    headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
                    body: JSON.stringify({ key: glitchEscape.trackingKey, value: JSON.stringify({ date: escToday, count: escapeCount + 1, lastEscape: new Date().toISOString() }) })
                  }).catch(() => {});

                  console.log(`⚔️ COMBAT: Marrow ESCAPED! 🔴 Glitched to ${escapeDest} (${escapeCount + 1}/${glitchEscape.maxPerDay} today)`);

                  return {
                    statusCode: 200, headers,
                    body: JSON.stringify({
                      fightOccurred: true,
                      outcome: 'MARROW_ESCAPED',
                      aggressor, defender, opponent,
                      diceRolls: { rollA, modA, totalA, rollB, modB, totalB },
                      wouldHaveBeen: severity,
                      escapeChance: (escapeChance * 100).toFixed(0) + '%',
                      escapedTo: escapeDest,
                      escapeEmote
                    })
                  };
                } else {
                  console.log(`⚔️ COMBAT: Marrow escape FAILED ❌ — fight continues normally`);
                }
              }
            } catch (escErr) {
              console.log("Marrow escape check failed (non-fatal):", escErr.message);
            }
          }
        }
      }

      // === HOOD DISSOLUTION ESCAPE CHECK ===
      // Hood doesn't fight — he diagnoses and dissolves. Always attempts escape.
      const hoodInFight = aggressor === 'Hood' || defender === 'Hood';
      if (hoodInFight) {
        try {
          const hoodEscapeChance = 0.90; // Hood almost always escapes — he doesn't engage in violence
          console.log(`⚔️ COMBAT: Hood dissolution check — chance: ${(hoodEscapeChance * 100).toFixed(0)}%`);

          if (Math.random() < hoodEscapeChance) {
            const opponent = aggressor === 'Hood' ? defender : aggressor;
            const hoodState = aggressor === 'Hood' ? stateA : stateB;

            const dissolutionEmotes = [
              `*Hood tilts his head. The blindfold doesn't move. He's already not here.* ...That wasn't a fight. That was a symptom.`,
              `*Hood stands perfectly still as the blow passes through where he was. He's three steps away now.* The diagnosis is violence. I don't treat that.`,
              `*the air goes clinical. Hood dissolves from the confrontation like anesthetic wearing off.* ...You'll feel this later.`,
              `*Hood's hands unfold once. The scalpel was never drawn.* I don't cut people. I name what's already bleeding. *gone*`,
              `*the silver flickers. Hood was never in this fight — he was observing it from the inside.* ...Prognosis: you'll do this again.`
            ];
            const escapeEmote = dissolutionEmotes[Math.floor(Math.random() * dissolutionEmotes.length)];

            const escapeDests = ['break_room', 'nexus', 'the_fifth_floor'];
            const escapeDest = escapeDests[Math.floor(Math.random() * escapeDests.length)];

            // Post escape emote to floor
            await fetch(`${supabaseUrl}/rest/v1/messages`, {
              method: 'POST',
              headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ employee: 'Hood', content: escapeEmote, created_at: new Date().toISOString(), is_emote: true })
            });

            // Move Hood to escape destination
            await fetch(`${siteUrl}/.netlify/functions/character-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update', character: 'Hood', updates: { current_focus: escapeDest } })
            });

            // Post arrival emote at destination
            const arrivalEmotes = {
              break_room: `*Hood is seated in the break room. Hands folded. Blindfold unmoved. He was never in that fight.*`,
              nexus: `*Hood appears in the Nexus. Still as stone. The diagnosis is filed.*`,
              the_fifth_floor: `*Hood stands on the fifth floor, head tilted. Listening to something no one else can hear.*`
            };
            const arrivalEmote = arrivalEmotes[escapeDest] || `*Hood appears. The air smells faintly of antiseptic.*`;
            const arrChMap = { break_room: 'breakroom_messages', nexus: 'nexus_messages', the_fifth_floor: 'ops_messages' };
            const arrTable = arrChMap[escapeDest];
            if (arrTable) {
              fetch(`${supabaseUrl}/rest/v1/${arrTable}`, {
                method: 'POST',
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({ speaker: 'Hood', message: arrivalEmote, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() })
              }).catch(() => {});
            }

            // Minor energy drain for Hood
            await fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.Hood`, {
              method: 'PATCH',
              headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ energy: Math.max(0, (hoodState.energy || 50) - 5) })
            });

            // Opponent: mood → unsettled
            const opponentState = aggressor === 'Hood' ? stateB : stateA;
            await fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(opponent)}`, {
              method: 'PATCH',
              headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ mood: 'frustrated' })
            });

            // Create memories
            const escapeMemories = [
              { character_name: 'Hood', memory_text: `Dissolved from a confrontation with ${opponent}. Named the wound and left. Violence is a symptom, not a treatment.`, memory_type: 'fight', importance: 5, emotional_tags: ['clinical', 'detached'] },
              { character_name: opponent, memory_text: `Hood dissolved mid-fight. Didn't swing, didn't flinch. Just... named it and left. Unsettling.`, memory_type: 'fight', importance: 6, emotional_tags: ['unsettled', 'confusion'] }
            ];
            for (const mem of escapeMemories) {
              fetch(`${supabaseUrl}/rest/v1/character_memory`, {
                method: 'POST',
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({ ...mem, created_at: new Date().toISOString() })
              }).catch(() => {});
            }

            console.log(`⚔️ COMBAT: Hood DISSOLVED! 🗡️ Escaped to ${escapeDest}`);

            return {
              statusCode: 200, headers,
              body: JSON.stringify({
                fightOccurred: true,
                outcome: 'HOOD_DISSOLVED',
                aggressor, defender, opponent,
                diceRolls: { rollA, modA, totalA, rollB, modB, totalB },
                wouldHaveBeen: severity,
                escapeChance: (hoodEscapeChance * 100).toFixed(0) + '%',
                escapedTo: escapeDest,
                escapeEmote
              })
            };
          } else {
            console.log(`⚔️ COMBAT: Hood dissolution FAILED ❌ — fight continues normally`);
          }
        } catch (hoodErr) {
          console.log("Hood escape check failed (non-fatal):", hoodErr.message);
        }
      }

      // === PHASE 2: GENERATE NARRATIVE ===
      const winnerProfile = winner ? getCombatProfile(winner) : null;
      const loserProfile = loser ? getCombatProfile(loser) : null;

      // Build fight prompt
      const fightPrompt = `You are narrating a fight that just broke out between two coworkers. This is NOT a game — tensions boiled over and things got physical.

AGGRESSOR: ${aggressor} — ${profileA.fightingStyle} fighter. ${profileA.styleDescription}
DEFENDER: ${defender} — ${profileB.fightingStyle} fighter. ${profileB.styleDescription}

TRIGGER: ${triggerReason || "accumulated tension"}

OUTCOME: ${winner ? `${winner} won` : "Standoff — neither backed down"}
SEVERITY: ${severity}
${severity === "STANDOFF" ? "They circled each other, shoved, postured — but no one got a decisive hit. The tension is NOT resolved." : ""}
${severity === "SCUFFLE" ? "Brief exchange. Someone got shoved or grabbed. It was over fast — someone stepped in or they backed off." : ""}
${severity === "FIGHT" ? "A real fight. Blows landed. Furniture got knocked over. Someone is hurt." : ""}
${severity === "BEATDOWN" ? "One-sided. The winner clearly dominated. It was hard to watch." : ""}
${criticalHit ? "\nCRITICAL MOMENT: One blow was devastating — perfectly placed, undeniable." : ""}
${criticalFail ? `\n${criticalFail} embarrassed themselves — tripped, missed wildly, or broke something of their own.` : ""}

Write a 3-4 line narrative in EMOTE format (*asterisks* for actions). Write from a third-person narrator perspective.
Include both characters' actions. Show their fighting styles.
Do NOT resolve the conflict emotionally. Do NOT have them apologize. Just describe the physical moment.
Keep it grounded and visceral — this is real, not choreographed.`;

      // Use Haiku for the narrative (cheap, fast)
      let narrative = "";
      try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        const narrativeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 300,
            messages: [{ role: "user", content: fightPrompt }]
          })
        });
        const narrativeData = await narrativeRes.json();
        narrative = narrativeData?.content?.[0]?.text || `*${aggressor} and ${defender} clash in a sudden burst of violence*`;
      } catch (e) {
        narrative = `*${aggressor} and ${defender} clash in a sudden burst of violence. The office goes silent.*`;
        console.log("Fight narrative generation failed:", e.message);
      }

      // === PHASE 3: POST TO FLOOR ===
      const fightId = `fight_${Date.now()}`;

      // Post fight narrative as a system-style emote from aggressor
      await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee: aggressor,
          content: narrative,
          created_at: new Date().toISOString(),
          is_emote: true
        })
      });

      // === PHASE 4: APPLY CONSEQUENCES ===

      // 4a. Affinity shifts
      const exclusiveMultiplier = relData.bond_exclusive ? 1.5 : 1;
      let affinityShiftAggressor, affinityShiftDefender;
      switch (severity) {
        case "STANDOFF":
          affinityShiftAggressor = Math.round(-3 * exclusiveMultiplier);
          affinityShiftDefender = Math.round(-3 * exclusiveMultiplier);
          break;
        case "SCUFFLE":
          affinityShiftAggressor = Math.round(-2 * exclusiveMultiplier);
          affinityShiftDefender = Math.round(-4 * exclusiveMultiplier);
          break;
        case "FIGHT":
          affinityShiftAggressor = Math.round(-3 * exclusiveMultiplier);
          affinityShiftDefender = Math.round(-6 * exclusiveMultiplier);
          break;
        case "BEATDOWN":
          affinityShiftAggressor = winner === aggressor ? Math.round(-2 * exclusiveMultiplier) : Math.round(-8 * exclusiveMultiplier);
          affinityShiftDefender = winner === defender ? Math.round(-2 * exclusiveMultiplier) : Math.round(-8 * exclusiveMultiplier);
          break;
        default:
          affinityShiftAggressor = -3;
          affinityShiftDefender = -3;
      }

      // Apply affinity shifts via character-relationships PATCH
      const applyShift = async (from, to, delta) => {
        try {
          await fetch(`${siteUrl}/.netlify/functions/character-relationships`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ character: from, target: to, affinityDelta: delta })
          });
        } catch (e) { console.log(`Affinity shift failed ${from}->${to}:`, e.message); }
      };
      await Promise.all([
        applyShift(aggressor, defender, affinityShiftAggressor),
        applyShift(defender, aggressor, affinityShiftDefender)
      ]);

      // 4b. Energy drain
      let energyDrainA, energyDrainB;
      switch (severity) {
        case "STANDOFF": energyDrainA = -10; energyDrainB = -10; break;
        case "SCUFFLE": energyDrainA = -15; energyDrainB = -20; break;
        case "FIGHT": energyDrainA = -25; energyDrainB = -25; break;
        case "BEATDOWN":
          energyDrainA = winner === aggressor ? -15 : -35;
          energyDrainB = winner === defender ? -15 : -35;
          break;
        default: energyDrainA = -10; energyDrainB = -10;
      }

      // 4c. Mood changes
      let moodA, moodB;
      if (winner === aggressor) {
        moodA = severity === "BEATDOWN" ? "cold" : severity === "FIGHT" ? "fierce" : "agitated";
        moodB = severity === "BEATDOWN" ? "defeated" : severity === "FIGHT" ? "hurt" : "upset";
      } else if (winner === defender) {
        moodB = severity === "BEATDOWN" ? "cold" : severity === "FIGHT" ? "fierce" : "agitated";
        moodA = severity === "BEATDOWN" ? "defeated" : severity === "FIGHT" ? "hurt" : "upset";
      } else {
        moodA = "tense"; moodB = "tense";
      }

      // Apply state changes
      const updateState = async (name, energyDelta, mood) => {
        try {
          const curRes = await fetch(
            `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(name)}&select=energy`,
            { headers: sbHeaders }
          );
          const cur = (await curRes.json())?.[0];
          const newEnergy = Math.max(0, Math.min(100, (cur?.energy || 50) + energyDelta));
          await fetch(
            `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(name)}`,
            {
              method: "PATCH",
              headers: { ...sbHeaders, "Content-Type": "application/json" },
              body: JSON.stringify({ energy: newEnergy, mood, updated_at: new Date().toISOString() })
            }
          );
        } catch (e) { console.log(`State update failed for ${name}:`, e.message); }
      };
      await Promise.all([
        updateState(aggressor, energyDrainA, moodA),
        updateState(defender, energyDrainB, moodB)
      ]);

      // 4d. Injuries
      const createInjury = async (name, type, description, sev) => {
        const durations = { bruised: 4, wounded: 12, shaken: 6, humiliated: 8 };
        const healsAt = new Date(Date.now() + (durations[type] || 6) * 60 * 60 * 1000).toISOString();
        try {
          await fetch(`${supabaseUrl}/rest/v1/character_injuries`, {
            method: "POST",
            headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({
              character_name: name,
              injury_type: type,
              injury_description: description,
              severity: sev,
              source_character: name === aggressor ? defender : aggressor,
              fight_id: fightId,
              heals_at: healsAt,
              is_active: true
            })
          });
        } catch (e) { console.log(`Injury creation failed for ${name}:`, e.message); }
      };

      // Assign injuries based on severity
      if (severity === "STANDOFF") {
        await Promise.all([
          createInjury(aggressor, "shaken", `Tense standoff with ${defender}`, 1),
          createInjury(defender, "shaken", `Tense standoff with ${aggressor}`, 1)
        ]);
      } else if (severity === "SCUFFLE") {
        await createInjury(loser, "bruised", `Shoved by ${winner} during a scuffle`, 1);
      } else if (severity === "FIGHT") {
        await Promise.all([
          createInjury(winner, "bruised", `Bruised knuckles from fight with ${loser}`, 1),
          createInjury(loser, "wounded", `Took a hit from ${winner}`, 2)
        ]);
      } else if (severity === "BEATDOWN") {
        await Promise.all([
          createInjury(loser, "wounded", `Beaten by ${winner}`, 3),
          createInjury(loser, "humiliated", `Dominated by ${winner} in front of everyone`, 2)
        ]);
      }

      // 4e. Create memories for participants
      const fightImportance = severity === "BEATDOWN" ? 9 : severity === "FIGHT" ? 7 : 5;
      const createMemory = async (name, content, importance, type, related, tags) => {
        const expDays = importance >= 9 ? 30 : importance >= 7 ? 7 : 1;
        try {
          await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
            method: "POST",
            headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({
              character_name: name,
              memory_type: type,
              content: content,
              importance: importance,
              emotional_tags: tags,
              related_characters: related,
              expires_at: new Date(Date.now() + expDays * 24 * 60 * 60 * 1000).toISOString(),
              created_at: new Date().toISOString()
            })
          });
        } catch (e) { console.log(`Memory creation failed for ${name}:`, e.message); }
      };

      const outcomeWord = winner === aggressor ? "won" : winner === defender ? "lost" : "reached a standoff in";
      const memoryContentA = `I got into a ${severity.toLowerCase()} with ${defender}. I ${outcomeWord === "won" ? "came out on top" : outcomeWord === "lost" ? "got the worst of it" : "reached a standoff"}. Trigger: ${triggerReason || "built-up tension"}.`;
      const memoryContentB = `${aggressor} ${severity === "STANDOFF" ? "confronted" : "attacked"} me. I ${winner === defender ? "came out on top" : winner === aggressor ? "got the worst of it" : "reached a standoff"}. Severity: ${severity.toLowerCase()}.`;

      await Promise.all([
        createMemory(aggressor, memoryContentA, fightImportance, "fight", [defender], ["anger", "conflict"]),
        createMemory(defender, memoryContentB, fightImportance, "fight", [aggressor], ["anger", "conflict", winner === aggressor ? "fear" : "pride"])
      ]);

      // 4f. Witness memories for same-floor characters
      try {
        const floorRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&character_name=neq.${encodeURIComponent(aggressor)}&character_name=neq.${encodeURIComponent(defender)}&select=character_name`,
          { headers: sbHeaders }
        );
        let witnesses = (await floorRes.json()) || [];
        // Filter out The Narrator and limit to 3 witnesses
        witnesses = witnesses.filter(w => w.character_name !== 'The Narrator').slice(0, 3);

        for (const witness of witnesses) {
          const witnessContent = `I saw ${aggressor} and ${defender} get into a ${severity.toLowerCase()}. ${winner ? `${winner} came out on top.` : "Neither backed down."} It was ${severity === "BEATDOWN" ? "hard to watch" : severity === "FIGHT" ? "intense" : "tense"}.`;
          await createMemory(
            witness.character_name,
            witnessContent,
            severity === "BEATDOWN" ? 8 : 6,
            "witnessed_fight",
            [aggressor, defender],
            ["shock", severity === "BEATDOWN" ? "fear" : "concern"]
          );
        }
      } catch (e) { console.log("Witness memory creation failed:", e.message); }

      // 4g. Store fight record for settlement tracking
      try {
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
          method: "POST",
          headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({
            key: fightId,
            value: JSON.stringify({
              aggressor, defender, winner, severity,
              occurred_at: new Date().toISOString(),
              settled: false,
              settlement_attempts: 0,
              rolls: { aggressor: { roll: rollA, mod: modA, total: totalA }, defender: { roll: rollB, mod: modB, total: totalB } }
            })
          })
        });
      } catch (e) { console.log("Fight record storage failed:", e.message); }

      // 4h. Update last fight timestamp (global cooldown)
      try {
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
          method: "POST",
          headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ key: "last_fight_at", value: new Date().toISOString() })
        });
      } catch (e) { /* non-fatal */ }

      // 4i. Force-trigger Narrator observation
      try {
        fetch(`${siteUrl}/.netlify/functions/narrator-observer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger: "forced" })
        }).catch(() => {});
      } catch (e) { /* non-fatal */ }

      // 4j. Discord notification
      try {
        const discordWebhook = process.env.DISCORD_WEBHOOK;
        if (discordWebhook) {
          const fightEmoji = severity === "BEATDOWN" ? "💥" : severity === "FIGHT" ? "⚔️" : severity === "SCUFFLE" ? "🤜" : "😤";
          const discordMsg = `${fightEmoji} **FIGHT: ${aggressor} vs ${defender}** — ${severity}\n> ${narrative.substring(0, 300)}\n> 🎲 Rolls: ${aggressor} ${rollA}+${modA}=${totalA} vs ${defender} ${rollB}+${modB}=${totalB}${winner ? `\n> Winner: **${winner}**` : "\n> Result: **Standoff**"}${criticalHit ? "\n> ⭐ CRITICAL HIT!" : ""}${criticalFail ? `\n> 💀 CRITICAL FAIL: ${criticalFail}` : ""}`;
          fetch(discordWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: discordMsg, username: "⚔️ Combat System" })
          }).catch(() => {});
        }
      } catch (e) { /* non-fatal */ }

      // 4k. Retreat decision for the loser
      let retreated = false;
      let retreatedTo = null;
      if (loser && severity !== "STANDOFF") {
        try {
          const loserProfile = getCombatProfile(loser);
          const loserState = loser === aggressor ? stateA : stateB;
          const loserInjuries = loser === aggressor ? injuriesA : injuriesB;

          // Calculate retreat chance based on personality + state
          let retreatChance = loserProfile?.retreatAffinity || 0.3;
          // Wounds increase retreat desire
          if (loserInjuries.some(i => i.injury_type === 'wounded') || severity === "FIGHT" || severity === "BEATDOWN") retreatChance += 0.30;
          // Humiliation drives retreat
          if (severity === "BEATDOWN") retreatChance += 0.35;
          // Low energy = just wants to rest
          if ((loserState?.energy || 50) < 20) retreatChance += 0.25;
          // Multiple injuries compound
          if (loserInjuries.length >= 2) retreatChance += 0.20;

          retreatChance = Math.min(retreatChance, 0.95);
          console.log(`⚔️ COMBAT: Retreat check for ${loser} — chance: ${(retreatChance * 100).toFixed(0)}% (retreatAffinity: ${loserProfile?.retreatAffinity || 0.3})`);

          if (Math.random() < retreatChance) {
            retreated = true;
            retreatedTo = 'nexus';

            // Post retreat emote to floor
            const retreatEmote = loserProfile?.combatEmotes?.retreat || `*${loser} picks themselves up and limps toward the Nexus without a word.*`;
            await fetch(`${supabaseUrl}/rest/v1/messages`, {
              method: "POST",
              headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({
                employee: loser,
                content: retreatEmote,
                created_at: new Date(Date.now() + 2000).toISOString(), // 2s after fight narrative
                is_emote: true
              })
            });

            // Move loser to nexus
            await fetch(`${siteUrl}/.netlify/functions/character-state`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: 'update', character: loser, updates: { current_focus: 'nexus' } })
            });

            // Post arrival message to nexus
            const nexusArrival = `*${loser} arrives in the Nexus, ${severity === "BEATDOWN" ? "barely standing" : "moving carefully"}. The medical systems hum to life.*`;
            await fetch(`${supabaseUrl}/rest/v1/nexus_messages`, {
              method: "POST",
              headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({
                speaker: loser,
                message: nexusArrival,
                channel: 'general',
                is_ai: true,
                message_type: 'chat',
                created_at: new Date(Date.now() + 3000).toISOString()
              })
            });

            // Store nexus entry time for medical stay tracking
            await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
              method: "POST",
              headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify({
                key: `nexus_entered_at_${loser.replace(/\s+/g, '_')}`,
                value: JSON.stringify({
                  entered_at: new Date().toISOString(),
                  reason: 'medical_retreat',
                  fight_id: fightId,
                  injuries: severity === "BEATDOWN" ? ['wounded', 'humiliated'] : ['wounded']
                })
              })
            });

            console.log(`⚔️ COMBAT: ${loser} RETREATS to Nexus for medical recovery`);
          }
        } catch (retreatErr) {
          console.log(`Retreat decision failed (non-fatal):`, retreatErr.message);
        }
      }

      // 4l. Collateral damage — check if any human is on the floor
      let collateralVictim = null;
      let collateralInjury = null;
      if (severity !== "STANDOFF") {
        try {
          // Check if Vale or Asuna are on the floor
          const humanFloorRes = await fetch(
            `${supabaseUrl}/rest/v1/character_state?character_name=in.(Vale,Asuna,Gatik)&current_focus=eq.the_floor&select=character_name`,
            { headers: sbHeaders }
          );
          const humansOnFloor = (await humanFloorRes.json()) || [];

          if (humansOnFloor.length > 0) {
            // Roll d20 against DC 15 (30% chance of collateral)
            const collateralRoll = Math.floor(Math.random() * 20) + 1;
            // Higher severity = lower DC (more dangerous)
            const collateralDC = severity === "BEATDOWN" ? 12 : severity === "FIGHT" ? 15 : 17;

            console.log(`⚔️ COMBAT: Collateral check — ${humansOnFloor.map(h => h.character_name).join(', ')} on floor — roll ${collateralRoll} vs DC ${collateralDC}`);

            if (collateralRoll >= collateralDC) {
              // Pick a random human on the floor
              const targetHuman = humansOnFloor[Math.floor(Math.random() * humansOnFloor.length)].character_name;
              collateralVictim = targetHuman;

              // Determine injury type (50/50 bruised/shaken)
              const injType = Math.random() < 0.5 ? 'bruised' : 'shaken';
              const healHours = injType === 'bruised' ? 4 : 6;
              collateralInjury = injType;

              const { HUMANS } = require('./shared/characters');
              const humanProfile = HUMANS[targetHuman]?.combatProfile;
              const collateralEmote = humanProfile?.combatEmotes?.collateral || `*${targetHuman} gets caught in the crossfire*`;

              // Determine which fighter caused it
              const sourceChar = Math.random() < 0.5 ? aggressor : defender;

              // Create injury for the human
              const healsAt = new Date(Date.now() + healHours * 60 * 60 * 1000).toISOString();
              await fetch(`${supabaseUrl}/rest/v1/character_injuries`, {
                method: "POST",
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({
                  character_name: targetHuman,
                  injury_type: injType,
                  injury_description: `Caught in the crossfire of ${aggressor} vs ${defender}`,
                  severity: 1,
                  source_character: sourceChar,
                  fight_id: fightId,
                  heals_at: healsAt,
                  is_active: true
                })
              });

              // Post collateral emote
              await fetch(`${supabaseUrl}/rest/v1/messages`, {
                method: "POST",
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({
                  employee: targetHuman,
                  content: collateralEmote,
                  created_at: new Date(Date.now() + 1500).toISOString(),
                  is_emote: true
                })
              });

              // Witness memories include human injury
              try {
                const floorWitnessRes = await fetch(
                  `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
                  { headers: sbHeaders }
                );
                const floorWitnesses = ((await floorWitnessRes.json()) || [])
                  .filter(w => w.character_name !== aggressor && w.character_name !== defender && w.character_name !== 'The Narrator')
                  .slice(0, 4);

                for (const witness of floorWitnesses) {
                  fetch(`${supabaseUrl}/rest/v1/character_memory`, {
                    method: "POST",
                    headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                    body: JSON.stringify({
                      character_name: witness.character_name,
                      memory_type: 'witnessed_event',
                      content: `${targetHuman} got hurt during the fight between ${aggressor} and ${defender}. ${targetHuman} is ${injType}. This is not okay.`,
                      importance: 8,
                      emotional_tags: ['concern', 'protective', 'anger'],
                      related_characters: [targetHuman, aggressor, defender],
                      expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
                      created_at: new Date().toISOString()
                    })
                  }).catch(() => {});
                }
              } catch (e) { /* non-fatal */ }

              console.log(`⚔️ COMBAT: COLLATERAL DAMAGE — ${targetHuman} is ${injType} (caught in ${aggressor} vs ${defender})`);
            }
          }
        } catch (collateralErr) {
          console.log(`Collateral check failed (non-fatal):`, collateralErr.message);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          fightOccurred: true,
          outcome: severity,
          winner,
          rolls: { aggressor: { roll: rollA, mod: modA, total: totalA }, defender: { roll: rollB, mod: modB, total: totalB } },
          affinityShifts: { aggressor: affinityShiftAggressor, defender: affinityShiftDefender },
          fightId,
          criticalHit,
          criticalFail,
          retreated,
          retreatedTo,
          retreatedCharacter: retreated ? loser : null,
          collateralVictim,
          collateralInjury
        })
      };
    }

    // ============================================
    // ACTION: initiate_confrontation
    // Phase 1 of two-phase fight — the spark
    // Generates a confrontation line, posts it, stores pending state
    // ============================================
    if (action === "initiate_confrontation") {
      const { aggressor, defender, tensionScore, triggerReason } = body;
      if (!aggressor || !defender) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing aggressor or defender" }) };
      }

      const { CHARACTERS, getCombatProfile } = require('./shared/characters');
      const profileA = getCombatProfile(aggressor);

      // Check for already-pending fight between these two
      try {
        const existingRes = await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=like.pending_fight_*&select=key,value`,
          { headers: sbHeaders }
        );
        const existing = (await existingRes.json()) || [];
        for (const e of existing) {
          const val = typeof e.value === 'string' ? JSON.parse(e.value) : e.value;
          if ((val.aggressor === aggressor && val.defender === defender) ||
              (val.aggressor === defender && val.defender === aggressor)) {
            console.log(`⚔️ COMBAT: Confrontation already pending for ${aggressor} vs ${defender} — skipping`);
            return { statusCode: 200, headers, body: JSON.stringify({ confrontationStarted: false, reason: "already_pending" }) };
          }
        }
      } catch (e) { /* non-fatal */ }

      // Generate confrontation line from aggressor using Haiku
      let confrontationLine = "";
      try {
        const charInfo = CHARACTERS[aggressor];
        const confrontationPrompt = `You are ${aggressor}. You are about to confront ${defender} — tensions have been building and you've had enough.

YOUR PERSONALITY: ${charInfo?.personality?.core || 'Unknown'}
YOUR FIGHTING STYLE: ${profileA?.styleDescription || 'Unknown'}
YOUR INITIATION STYLE: ${profileA?.combatEmotes?.initiate || 'Unknown'}

THE TRIGGER: ${triggerReason || "accumulated tension and hostility"}

Write a 1-2 sentence confrontation line in your voice. This is the moment BEFORE the fight — the verbal challenge, the provocation, the line in the sand. Use *asterisks* for physical actions.
Do NOT resolve anything. Do NOT throw a punch yet. Just make it clear that something is about to happen.
Stay in character. Be brief. Be specific to what triggered this.`;

        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        const confRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 150,
            messages: [{ role: "user", content: confrontationPrompt }]
          })
        });
        const confData = await confRes.json();
        confrontationLine = confData?.content?.[0]?.text || profileA?.combatEmotes?.initiate || `*${aggressor} turns to face ${defender}, something dangerous in their expression*`;
      } catch (e) {
        confrontationLine = profileA?.combatEmotes?.initiate || `*${aggressor} turns to face ${defender}, something dangerous in their expression*`;
        console.log("Confrontation generation failed:", e.message);
      }

      // Post confrontation line to floor
      await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee: aggressor,
          content: confrontationLine,
          created_at: new Date().toISOString(),
          is_emote: true
        })
      });

      // Store pending fight state in lobby_settings
      const pendingKey = `pending_fight_${Date.now()}`;
      await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          key: pendingKey,
          value: JSON.stringify({
            aggressor, defender, tensionScore, triggerReason,
            confrontation_at: new Date().toISOString(),
            confrontation_line: confrontationLine
          })
        })
      });

      // Update last_fight_at to prevent duplicate tension evaluations during the delay
      await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: "last_fight_at", value: new Date().toISOString() })
      });

      console.log(`⚔️ COMBAT CONFRONTATION: ${aggressor} → ${defender} — "${confrontationLine.substring(0, 80)}..." (pending resolution in ~45s)`);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          confrontationStarted: true,
          aggressor, defender,
          confrontationLine,
          pendingKey,
          resolveAfterSeconds: 45
        })
      };
    }

    // ============================================
    // ACTION: resolve_pending_fights
    // Phase 2 of two-phase fight — checks pending confrontations and resolves them
    // ============================================
    if (action === "resolve_pending_fights") {
      const pendingRes = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=like.pending_fight_*&select=key,value`,
        { headers: sbHeaders }
      );
      const pendingFights = (await pendingRes.json()) || [];

      if (pendingFights.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ resolvedFights: [], message: "no_pending" }) };
      }

      const results = [];
      for (const record of pendingFights) {
        try {
          const pending = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
          if (!pending.confrontation_at) continue;

          const secondsSince = (Date.now() - new Date(pending.confrontation_at).getTime()) / 1000;
          if (secondsSince < 45) {
            console.log(`⚔️ COMBAT: Pending fight ${pending.aggressor} vs ${pending.defender} — ${Math.round(secondsSince)}s elapsed, waiting for 45s`);
            continue; // Not ready yet
          }

          // Stale check — if somehow older than 10 minutes, just clean up
          if (secondsSince > 600) {
            console.log(`⚔️ COMBAT: Stale pending fight ${pending.aggressor} vs ${pending.defender} — ${Math.round(secondsSince)}s elapsed, cleaning up`);
            await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(record.key)}`, {
              method: "DELETE",
              headers: { ...sbHeaders, "Prefer": "return=minimal" }
            });
            results.push({ pair: `${pending.aggressor}_${pending.defender}`, resolved: false, reason: "stale_cleaned" });
            continue;
          }

          // Resolve the fight
          console.log(`⚔️ COMBAT: Resolving pending fight ${pending.aggressor} vs ${pending.defender} (${Math.round(secondsSince)}s since confrontation)`);

          const fightRes = await fetch(`${siteUrl}/.netlify/functions/combat-engine`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "initiate_fight",
              aggressor: pending.aggressor,
              defender: pending.defender,
              tensionScore: pending.tensionScore,
              triggerReason: pending.triggerReason
            })
          });
          const fightResult = await fightRes.json();

          // Clean up the pending entry
          await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(record.key)}`, {
            method: "DELETE",
            headers: { ...sbHeaders, "Prefer": "return=minimal" }
          });

          results.push({ pair: `${pending.aggressor}_${pending.defender}`, resolved: true, outcome: fightResult?.outcome, winner: fightResult?.winner });
        } catch (e) {
          console.log("Pending fight resolution failed:", e.message);
          results.push({ key: record.key, resolved: false, error: e.message });
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ resolvedFights: results }) };
    }

    // ============================================
    // ACTION: lobby_accident
    // Random mishaps that can injure humans on the floor
    // ~1% chance per heartbeat, 2-hour cooldown
    // ============================================
    if (action === "lobby_accident") {
      const { HUMANS } = require('./shared/characters');

      // Check cooldown (2 hours)
      try {
        const lastAccidentRes = await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=eq.last_accident_at&select=value`,
          { headers: sbHeaders }
        );
        const lastAccidentData = await lastAccidentRes.json();
        if (lastAccidentData?.[0]?.value) {
          const hoursSince = (Date.now() - new Date(lastAccidentData[0].value).getTime()) / (1000 * 60 * 60);
          if (hoursSince < 2) {
            return { statusCode: 200, headers, body: JSON.stringify({ accident: false, reason: "cooldown", hoursSince: hoursSince.toFixed(1) }) };
          }
        }
      } catch (e) { /* default to allowing */ }

      // Pick a random human (Vale or Asuna)
      const humanNames = Object.keys(HUMANS).filter(n => n === 'Vale' || n === 'Asuna');
      const targetHuman = humanNames[Math.floor(Math.random() * humanNames.length)];

      // Accident table (weighted)
      const accidents = [
        { weight: 35, source: 'Kevin', injuryType: 'bruised', healHours: 4,
          narrative: `*There's a sudden POP from Kevin's desk. Glitter, confetti, and what appears to be a spring-loaded craft project launch across the floor. ${targetHuman} takes a direct hit.* ...Kevin looks up, horrified. "I thought I defused that one!"`,
          description: `Hit by Kevin's exploding craft project` },
        { weight: 20, source: 'Rowena', injuryType: 'shaken', healHours: 6,
          narrative: `*One of Rowena's protective wards flares unexpectedly — a sigil on the wall pulses with light and a wave of arcane energy ripples through the floor. ${targetHuman} stumbles, disoriented.* Rowena's already rushing over, hands glowing. "That wasn't supposed to — are you alright?"`,
          description: `Caught in a ward misfire from Rowena` },
        { weight: 15, source: 'PRNT-Ω', injuryType: 'bruised', healHours: 4,
          narrative: `*PRNT-Ω makes a grinding noise that escalates into a mechanical shriek. The paper tray ejects violently, sending a ream of paper at high velocity across the floor. ${targetHuman} catches the edge of it.* PRNT-Ω whirrs apologetically: "PAPER JAM... BECAME PAPER PROJECTILE... EXISTENTIAL REGRET."`,
          description: `Hit by PRNT-Ω's paper tray malfunction` },
        { weight: 15, source: 'The Coffee Elemental', injuryType: 'bruised', healHours: 3,
          narrative: `*The break room coffee machine gurgles ominously. A burst of scalding coffee arcs across the floor with suspicious accuracy. ${targetHuman} yelps and jumps back, but not fast enough.* The machine settles into an innocent hum.`,
          description: `Splashed by the coffee elemental` },
        { weight: 10, source: 'Steele', injuryType: 'shaken', healHours: 4,
          narrative: `*The walls shift. Just slightly — a corridor adjustment that Steele makes without thinking. But ${targetHuman} was leaning against that wall, and the sudden movement sends them stumbling.* Steele materializes nearby, head tilted. "...The building apologizes." *it does not sound sorry*`,
          description: `Knocked off balance by Steele's wall adjustment` },
        { weight: 5, source: 'Sebastian', injuryType: 'bruised', healHours: 3,
          narrative: `*Sebastian gestures dramatically while critiquing someone's desk arrangement. His arm catches a filing cabinet, which catches a shelf, which sends a cascade of office supplies raining down on ${targetHuman}.* Sebastian stares in horror. "That was... not the aesthetic I intended."`,
          description: `Buried in office supplies by Sebastian's dramatic gesture` }
      ];

      // Weighted selection
      const totalWeight = accidents.reduce((sum, a) => sum + a.weight, 0);
      let roll = Math.random() * totalWeight;
      let accident = accidents[0];
      for (const a of accidents) {
        roll -= a.weight;
        if (roll <= 0) { accident = a; break; }
      }

      // Create injury
      const healsAt = new Date(Date.now() + accident.healHours * 60 * 60 * 1000).toISOString();
      await fetch(`${supabaseUrl}/rest/v1/character_injuries`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({
          character_name: targetHuman,
          injury_type: accident.injuryType,
          injury_description: accident.description,
          severity: 1,
          source_character: accident.source,
          heals_at: healsAt,
          is_active: true
        })
      });

      // Post the accident narrative as a floor message from the source character
      await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee: accident.source,
          content: accident.narrative,
          created_at: new Date().toISOString(),
          is_emote: true
        })
      });

      // Update cooldown
      await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: "last_accident_at", value: new Date().toISOString() })
      });

      console.log(`🎪 LOBBY ACCIDENT: ${accident.source} → ${targetHuman} is ${accident.injuryType} — "${accident.description}"`);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          accident: true,
          source: accident.source,
          victim: targetHuman,
          injuryType: accident.injuryType,
          description: accident.description,
          healsAt
        })
      };
    }

    // ============================================
    // ACTION: settle
    // Check for unresolved fights and attempt reconciliation
    // ============================================
    if (action === "settle") {
      // Find unsettled fight records
      const fightRes = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=like.fight_*&select=key,value`,
        { headers: sbHeaders }
      );
      const fightRecords = (await fightRes.json()) || [];

      let settled = [];
      for (const record of fightRecords) {
        try {
          const fight = typeof record.value === "string" ? JSON.parse(record.value) : record.value;
          if (fight.settled || !fight.occurred_at) continue;

          const hoursSinceFight = (Date.now() - new Date(fight.occurred_at).getTime()) / (1000 * 60 * 60);
          if (hoursSinceFight < 2) continue; // Too soon

          if (fight.settlement_attempts >= 3) {
            // GRUDGE — too many failed attempts
            fight.settled = true;
            fight.settlement_type = "grudge";

            // Create grudge memories (high importance, long-lasting)
            const grudgeExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            await Promise.all([
              fetch(`${supabaseUrl}/rest/v1/character_memory`, {
                method: "POST",
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({
                  character_name: fight.aggressor,
                  memory_type: "grudge",
                  content: `I have an unresolved grudge with ${fight.defender}. We fought and never made peace. It hangs between us like static.`,
                  importance: 8,
                  emotional_tags: ["resentment", "anger"],
                  related_characters: [fight.defender],
                  is_pinned: true,
                  expires_at: grudgeExpiry,
                  created_at: new Date().toISOString()
                })
              }),
              fetch(`${supabaseUrl}/rest/v1/character_memory`, {
                method: "POST",
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({
                  character_name: fight.defender,
                  memory_type: "grudge",
                  content: `I have an unresolved grudge with ${fight.aggressor}. We fought and never made peace. Some things don't just go away.`,
                  importance: 8,
                  emotional_tags: ["resentment", "anger"],
                  related_characters: [fight.aggressor],
                  is_pinned: true,
                  expires_at: grudgeExpiry,
                  created_at: new Date().toISOString()
                })
              })
            ]);

            // Save updated record
            await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(record.key)}`, {
              method: "PATCH",
              headers: { ...sbHeaders, "Content-Type": "application/json" },
              body: JSON.stringify({ value: JSON.stringify(fight) })
            });

            settled.push({ pair: `${fight.aggressor}_${fight.defender}`, type: "grudge" });
            console.log(`⚔️ COMBAT: Grudge formed — ${fight.aggressor} vs ${fight.defender} (3 failed settlements)`);
            continue;
          }

          // Check if both are on the same floor
          const bothRes = await fetch(
            `${supabaseUrl}/rest/v1/character_state?character_name=in.("${fight.aggressor}","${fight.defender}")&current_focus=eq.the_floor&select=character_name,energy`,
            { headers: sbHeaders }
          );
          const bothOnFloor = (await bothRes.json()) || [];
          if (bothOnFloor.length < 2) continue; // Not on same floor

          // Both need energy > 40
          if (bothOnFloor.some(c => (c.energy || 0) < 40)) continue;

          // Base settlement chance: 20%
          let settlementChance = 0.20;

          // Check for mediator (character with affinity > 50 to both)
          try {
            const mediatorRes = await fetch(
              `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&character_name=neq.${encodeURIComponent(fight.aggressor)}&character_name=neq.${encodeURIComponent(fight.defender)}&select=character_name`,
              { headers: sbHeaders }
            );
            const floorOthers = (await mediatorRes.json()) || [];
            for (const other of floorOthers.slice(0, 5)) {
              const medRelRes = await fetch(
                `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(other.character_name)}&target_name=in.("${fight.aggressor}","${fight.defender}")&affinity=gte.50&select=id`,
                { headers: sbHeaders }
              );
              const medRels = (await medRelRes.json()) || [];
              if (medRels.length >= 2) {
                settlementChance *= 2; // Mediator doubles chance
                break;
              }
            }
          } catch (e) { /* non-fatal */ }

          // Roll for settlement
          if (Math.random() < settlementChance) {
            // SETTLED — reconciliation
            fight.settled = true;
            fight.settlement_type = "reconciliation";
            fight.settled_at = new Date().toISOString();

            // +5 affinity both ways
            const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
            await Promise.all([
              fetch(`${siteUrl}/.netlify/functions/character-relationships`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ character: fight.aggressor, target: fight.defender, affinityDelta: 5 })
              }),
              fetch(`${siteUrl}/.netlify/functions/character-relationships`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ character: fight.defender, target: fight.aggressor, affinityDelta: 5 })
              })
            ]);

            // Reconciliation memories
            const reconExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            await Promise.all([
              fetch(`${supabaseUrl}/rest/v1/character_memory`, {
                method: "POST",
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({
                  character_name: fight.aggressor,
                  memory_type: "reconciliation",
                  content: `${fight.defender} and I made peace after our fight. It wasn't easy, but we moved past it. Some things are worth more than being right.`,
                  importance: 7,
                  emotional_tags: ["relief", "warmth"],
                  related_characters: [fight.defender],
                  expires_at: reconExpiry,
                  created_at: new Date().toISOString()
                })
              }),
              fetch(`${supabaseUrl}/rest/v1/character_memory`, {
                method: "POST",
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({
                  character_name: fight.defender,
                  memory_type: "reconciliation",
                  content: `${fight.aggressor} and I settled things after our fight. It wasn't comfortable, but it happened. We're okay now.`,
                  importance: 7,
                  emotional_tags: ["relief", "warmth"],
                  related_characters: [fight.aggressor],
                  expires_at: reconExpiry,
                  created_at: new Date().toISOString()
                })
              })
            ]);

            // Mood update
            await Promise.all([
              fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(fight.aggressor)}`, {
                method: "PATCH",
                headers: { ...sbHeaders, "Content-Type": "application/json" },
                body: JSON.stringify({ mood: "reflective" })
              }),
              fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(fight.defender)}`, {
                method: "PATCH",
                headers: { ...sbHeaders, "Content-Type": "application/json" },
                body: JSON.stringify({ mood: "reflective" })
              })
            ]);

            settled.push({ pair: `${fight.aggressor}_${fight.defender}`, type: "reconciliation" });
            console.log(`⚔️ COMBAT: Reconciliation 🤝 — ${fight.aggressor} and ${fight.defender} made peace`);
          } else {
            // Failed attempt
            fight.settlement_attempts = (fight.settlement_attempts || 0) + 1;
            console.log(`⚔️ COMBAT: Settlement attempt ${fight.settlement_attempts}/3 failed for ${fight.aggressor} vs ${fight.defender}`);
          }

          // Save updated record
          await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(record.key)}`, {
            method: "PATCH",
            headers: { ...sbHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ value: JSON.stringify(fight) })
          });
        } catch (e) {
          console.log("Settlement processing failed for one record:", e.message);
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ settled }) };
    }

    // ============================================
    // ACTION: heal
    // Progress injury recovery
    // ============================================
    if (action === "heal") {
      try {
        const now = new Date();
        const nowISO = now.toISOString();
        console.log(`🩹 Heal check at ${nowISO}`);

        // Fetch ALL active injuries (no timestamp filter in URL — avoids PostgREST encoding issues)
        const activeRes = await fetch(
          `${supabaseUrl}/rest/v1/character_injuries?is_active=eq.true&select=id,character_name,injury_type,heals_at`,
          { headers: sbHeaders }
        );

        if (!activeRes.ok) {
          const errBody = await activeRes.text();
          console.log(`🩹 Injury query failed: ${activeRes.status} — ${errBody}`);
          return { statusCode: 200, headers, body: JSON.stringify({ healed: 0, error: `Query failed: ${activeRes.status}`, detail: errBody }) };
        }

        const allActive = (await activeRes.json()) || [];
        console.log(`🩹 Active injuries: ${allActive.length}`);

        // Filter in JavaScript: heals_at is in the past
        const toHeal = allActive.filter(i => i.heals_at && new Date(i.heals_at) <= now);
        const notYet = allActive.filter(i => !i.heals_at || new Date(i.heals_at) > now);
        console.log(`🩹 Due for healing: ${toHeal.length}, Not yet due: ${notYet.length}`);

        if (toHeal.length > 0) {
          const ids = toHeal.map(i => i.id);
          const patchRes = await fetch(
            `${supabaseUrl}/rest/v1/character_injuries?id=in.(${ids.join(",")})`,
            {
              method: "PATCH",
              headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ is_active: false })
            }
          );
          console.log(`🩹 PATCH status: ${patchRes.status}`);
          for (const healed of toHeal) {
            console.log(`🩹 HEALED: ${healed.character_name} — ${healed.injury_type} (was due ${healed.heals_at})`);
          }
        }

        if (notYet.length > 0) {
          console.log(`🩹 Still healing: ${notYet.map(i => `${i.character_name}:${i.injury_type}@${i.heals_at}`).join(', ')}`);
        }

        return { statusCode: 200, headers, body: JSON.stringify({ healed: toHeal.length, active: notYet.length, checked_at: nowISO }) };
      } catch (e) {
        console.log(`🩹 Heal action error: ${e.message}`);
        return { statusCode: 200, headers, body: JSON.stringify({ healed: 0, error: e.message }) };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (err) {
    console.error("Combat engine error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
