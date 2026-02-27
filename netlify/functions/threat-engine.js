// ============================================
// THREAT ENGINE — Minor Threats RPG System
// ============================================
//
// Spawnable "minor threats" (giant rats, porcelain gnomes, intelligent socks)
// that characters can fight using the existing d20 combat mechanics.
// Threats have actual HP — characters chip away at them until defeated.
//
// GET  — get_threats (active threats), get_threat_log (attack history)
// POST — create_threat, attack_threat, dismiss_threat, expire_threats
//
// Tables used:
//   floor_threats      — Threat lifecycle (active → defeated/fled/expired/dismissed)
//   threat_attack_log  — Individual attack records with dice rolls
//   character_state    — Character energy/mood tracking
//   character_injuries — Injury application when threats win
//   messages           — Floor emotes for spawn/attack/defeat
//

const { getCombatProfile } = require('./shared/characters');

// ============================================
// THREAT TEMPLATES
// ============================================

const THREAT_TEMPLATES = {
  giant_rat: {
    name: 'Giant Rat',
    description: 'A rat the size of a Labrador. It gnaws on ethernet cables and hisses at anyone who makes eye contact.',
    tier: 'nuisance',
    hp: 15,
    combat_power: 2,
    fighting_style: 'scurrying',
    damage_description: 'Bites ankles and scratches with oversized claws'
  },
  porcelain_gnome: {
    name: 'Porcelain Gnome',
    description: 'A garden gnome that shouldn\'t be able to move. It can. It does. It watches you with painted eyes that track too well.',
    tier: 'nuisance',
    hp: 20,
    combat_power: 3,
    fighting_style: 'ceramic fury',
    damage_description: 'Headbutts shins with its pointed hat and throws itself at kneecaps'
  },
  intelligent_sock: {
    name: 'Intelligent Sock',
    description: 'A single argyle sock that gained sentience. Nobody knows how. It wraps around faces and refuses to let go.',
    tier: 'nuisance',
    hp: 10,
    combat_power: 1,
    fighting_style: 'fabric manipulation',
    damage_description: 'Wraps around limbs and squeezes with surprising strength'
  },
  filing_cabinet_mimic: {
    name: 'Filing Cabinet Mimic',
    description: 'Looks exactly like a normal filing cabinet until you open the top drawer and it opens you back.',
    tier: 'threat',
    hp: 35,
    combat_power: 5,
    fighting_style: 'ambush predator',
    damage_description: 'Slams drawers on fingers and body-checks with 200 pounds of steel'
  },
  glitter_swarm: {
    name: 'Glitter Swarm',
    description: 'A sentient cloud of craft glitter that moves with purpose. It gets everywhere. Everywhere.',
    tier: 'threat',
    hp: 40,
    combat_power: 4,
    fighting_style: 'sparkle engulf',
    damage_description: 'Blinds eyes with micro-glitter and irritates every exposed surface'
  },
  haunted_printer: {
    name: 'Haunted Printer',
    description: 'The office printer has become self-aware and it is furious about every paper jam you ever caused.',
    tier: 'nuisance',
    hp: 25,
    combat_power: 3,
    fighting_style: 'paper jam assault',
    damage_description: 'Fires paper at high velocity and sprays toner like ink defense'
  },
  coffee_elemental: {
    name: 'Coffee Elemental',
    description: 'A vaguely humanoid mass of boiling coffee that emerged from the break room Keurig. It vibrates with caffeine rage.',
    tier: 'threat',
    hp: 45,
    combat_power: 6,
    fighting_style: 'scalding splash',
    damage_description: 'Hurls scalding coffee and steam-burns at close range'
  },
  void_stapler: {
    name: 'Void Stapler',
    description: 'A Swingline stapler that fell through a crack in reality and came back wrong. It floats. It staples things that shouldn\'t be stapled.',
    tier: 'boss',
    hp: 60,
    combat_power: 7,
    fighting_style: 'office supply nightmare',
    damage_description: 'Fires staples like projectiles and distorts local space to close distance'
  }
};

// ============================================
// DISCORD WEBHOOK
// ============================================

const TIER_EMOJIS = {
  nuisance: '🐀',
  threat: '⚠️',
  boss: '💀'
};

const TIER_COLORS = {
  nuisance: 0x4CAF50,   // green
  threat: 0xFFC107,      // amber
  boss: 0xF44336         // red
};

async function postToDiscordThreats(message) {
  const webhookUrl = process.env.DISCORD_OPS_WEBHOOK;
  if (!webhookUrl) return;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, username: "🎲 Threat System" })
    });

    if (response.status === 429) {
      const retryData = await response.json().catch(() => ({}));
      const retryAfter = (retryData.retry_after || 2) * 1000;
      await new Promise(r => setTimeout(r, retryAfter));
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message, username: "🎲 Threat System" })
      });
    }
  } catch (err) {
    console.error("[threat-engine] Discord post error:", err.message);
  }
}

// ============================================
// COMBAT MODIFIER (duplicated from combat-engine.js)
// ============================================

function getCombatModifier(profile, state, injuries, hasBattleTested) {
  let mod = profile.combatPower || 0;
  if ((state.energy || 50) > 70) mod += 1;
  if ((state.energy || 50) < 20) mod -= 2;
  if ((state.energy || 50) < 10) mod -= 3;
  if ((state.patience || 50) < 20) mod += 1;
  if (state.mood === 'furious' || state.mood === 'hostile') mod += 1;
  if (state.mood === 'defeated') mod -= 2;
  for (const inj of injuries) {
    if (inj.injury_type === 'wounded') mod -= 2;
    else if (inj.injury_type === 'bruised' || inj.injury_type === 'shaken') mod -= 1;
  }
  if (hasBattleTested) mod += 1;
  return mod;
}

// ============================================
// MAIN HANDLER
// ============================================

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers, body: "" };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const sbHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };

  try {
    // ============================================
    // GET ACTIONS
    // ============================================
    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      const action = params.action;

      // --- GET THREATS ---
      if (action === "get_threats") {
        const statusFilter = params.status || 'active';
        let url = `${supabaseUrl}/rest/v1/floor_threats?select=*&order=created_at.desc`;
        if (statusFilter !== 'all') {
          url += `&status=eq.${statusFilter}`;
        }
        const res = await fetch(url, { headers: sbHeaders });
        const threatsRaw = await res.json();
        const threats = Array.isArray(threatsRaw) ? threatsRaw : [];

        // Get attack counts for each threat
        for (const threat of threats) {
          const logRes = await fetch(
            `${supabaseUrl}/rest/v1/threat_attack_log?threat_id=eq.${threat.id}&select=id`,
            { headers: sbHeaders }
          );
          const logs = await logRes.json();
          threat.attack_count = (logs || []).length;
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, threats }) };
      }

      // --- GET THREAT LOG ---
      if (action === "get_threat_log") {
        const threatId = params.threat_id;
        if (!threatId) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing threat_id" }) };

        const res = await fetch(
          `${supabaseUrl}/rest/v1/threat_attack_log?threat_id=eq.${threatId}&select=*&order=created_at.desc`,
          { headers: sbHeaders }
        );
        const logsRaw = await res.json();
        const logs = Array.isArray(logsRaw) ? logsRaw : [];
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, logs }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown GET action" }) };
    }

    // ============================================
    // POST ACTIONS
    // ============================================
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers, body: JSON.stringify({ error: "GET or POST only" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const { action } = body;

    // ============================================
    // ACTION: create_threat
    // ============================================
    if (action === "create_threat") {
      const { template, name, description, tier, hp, combat_power, fighting_style, damage_description, location } = body;

      let threatData;
      if (template && THREAT_TEMPLATES[template]) {
        const t = THREAT_TEMPLATES[template];
        threatData = {
          name: name || t.name,
          description: description || t.description,
          tier: t.tier,
          hp_max: t.hp,
          hp_current: t.hp,
          combat_power: t.combat_power,
          combat_power_original: t.combat_power,
          fighting_style: t.fighting_style,
          damage_description: t.damage_description,
          location: location || 'main_lobby',
          status: 'active',
          spawned_by: body.spawned_by || 'admin',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // 4 hour expiry
        };
      } else if (name && hp) {
        threatData = {
          name,
          description: description || `A mysterious ${name} has appeared.`,
          tier: tier || 'nuisance',
          hp_max: hp,
          hp_current: hp,
          combat_power: combat_power || 2,
          combat_power_original: combat_power || 2,
          fighting_style: fighting_style || 'unknown',
          damage_description: damage_description || 'Attacks with unknown methods',
          location: location || 'main_lobby',
          status: 'active',
          spawned_by: body.spawned_by || 'admin',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
        };
      } else {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Provide a template key OR custom name + hp" }) };
      }

      // Insert into database
      const res = await fetch(`${supabaseUrl}/rest/v1/floor_threats`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=representation" },
        body: JSON.stringify(threatData)
      });
      const resBody = await res.json();
      console.log(`🎲 THREAT CREATE: status=${res.status}, response=`, JSON.stringify(resBody).substring(0, 500));
      const created = Array.isArray(resBody) ? resBody[0] : resBody;

      if (!created || created.error || created.message) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to create threat", detail: created?.message || created?.error || 'Unknown' }) };
      }

      // Post spawn emote to floor
      const emoji = TIER_EMOJIS[threatData.tier] || '🐀';
      const spawnEmote = `*${emoji} A **${threatData.name}** has appeared in the lobby! ${threatData.description}*`;
      await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee: "System",
          content: spawnEmote,
          created_at: new Date().toISOString(),
          is_emote: true
        })
      });

      // Discord notification
      postToDiscordThreats(`${emoji} A **${threatData.name}** has appeared in the lobby! (HP: ${threatData.hp_max}, Power: ${threatData.combat_power}, Tier: ${threatData.tier})`);

      console.log(`🎲 THREAT SPAWNED: ${threatData.name} (${threatData.tier}) — HP: ${threatData.hp_max}, Power: ${threatData.combat_power}`);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, threat: created }) };
    }

    // ============================================
    // ACTION: attack_threat
    // ============================================
    if (action === "attack_threat") {
      const { threat_id, character_name } = body;
      if (!threat_id || !character_name) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing threat_id or character_name" }) };
      }

      // Get the threat
      const threatRes = await fetch(
        `${supabaseUrl}/rest/v1/floor_threats?id=eq.${threat_id}&select=*`,
        { headers: sbHeaders }
      );
      const threat = (await threatRes.json())?.[0];
      if (!threat || threat.status !== 'active') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Threat not found or not active" }) };
      }

      // Get character combat profile
      const profile = getCombatProfile(character_name);
      if (!profile?.canFight) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `${character_name} cannot fight` }) };
      }

      // Get character state
      const stateRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character_name)}&select=energy,patience,mood`,
        { headers: sbHeaders }
      );
      const charState = (await stateRes.json())?.[0] || {};

      // Energy check — raised to 15 to prevent exhaustion death spirals
      if ((charState.energy || 0) < 15) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `${character_name} is too exhausted to fight (energy: ${charState.energy}, minimum: 15)` }) };
      }

      // Get active injuries
      const injRes = await fetch(
        `${supabaseUrl}/rest/v1/character_injuries?character_name=eq.${encodeURIComponent(character_name)}&is_active=eq.true&select=injury_type`,
        { headers: sbHeaders }
      );
      const injuries = (await injRes.json()) || [];

      // Check for Battle-Tested trait
      const traitRes = await fetch(
        `${supabaseUrl}/rest/v1/character_traits?character_name=eq.${encodeURIComponent(character_name)}&trait_name=eq.Battle-Tested&is_active=eq.true&select=id`,
        { headers: sbHeaders }
      );
      const hasBattleTested = ((await traitRes.json()) || []).length > 0;

      // === DICE ROLLS ===
      const rollChar = Math.floor(Math.random() * 20) + 1;
      const rollThreat = Math.floor(Math.random() * 20) + 1;

      const modChar = getCombatModifier(profile, charState, injuries, hasBattleTested);
      const modThreat = threat.combat_power || 2;

      const totalChar = rollChar + modChar;
      const totalThreat = rollThreat + modThreat;
      const margin = Math.abs(totalChar - totalThreat);

      // Determine winner
      let winner, severity;
      if (totalChar > totalThreat) {
        winner = character_name;
      } else if (totalThreat > totalChar) {
        winner = threat.name;
      } else {
        winner = null; // standoff
      }

      // Severity
      if (winner === null) severity = "STANDOFF";
      else if (margin <= 3) severity = "SCUFFLE";
      else if (margin <= 7) severity = "FIGHT";
      else severity = "BEATDOWN";

      // Critical rolls
      let criticalHit = false;
      let criticalFail = null;
      if (rollChar === 20 || rollThreat === 20) {
        criticalHit = true;
        if (severity === "SCUFFLE") severity = "FIGHT";
        else if (severity === "FIGHT") severity = "BEATDOWN";
      }
      if (rollChar === 1 && totalChar < totalThreat) criticalFail = character_name;
      if (rollThreat === 1 && totalThreat < totalChar) criticalFail = threat.name;

      console.log(`🎲 THREAT COMBAT: ${character_name} 🎲${rollChar}+${modChar}=${totalChar} vs ${threat.name} 🎲${rollThreat}+${modThreat}=${totalThreat} — ${severity} (margin ${margin})${criticalHit ? ' 💥 CRITICAL HIT!' : ''}${criticalFail ? ` 😵 CRITICAL FAIL: ${criticalFail}` : ''} — Winner: ${winner || 'STANDOFF'}`);

      // === CALCULATE DAMAGE & CONSEQUENCES ===
      let damageDealt = 0;
      let injuryInflicted = null;

      if (winner === character_name) {
        // Character wins — deal damage to threat
        switch (severity) {
          case "SCUFFLE": damageDealt = 3 + Math.floor(Math.random() * 3); break; // 3-5
          case "FIGHT": damageDealt = 6 + Math.floor(Math.random() * 5); break;   // 6-10
          case "BEATDOWN": damageDealt = 12 + Math.floor(Math.random() * 7); break; // 12-18
        }
        if (criticalHit && (rollChar === 20)) damageDealt *= 2; // Double on nat 20 from character
      } else if (winner === threat.name) {
        // Threat wins — character takes injury
        const isHumiliation = (threat.combat_power <= 2) && (profile.combatPower >= 6);

        if (isHumiliation) {
          injuryInflicted = 'humiliated';
          console.log(`🎲 HUMILIATION: ${character_name} (power ${profile.combatPower}) lost to ${threat.name} (power ${threat.combat_power})!`);
        } else {
          switch (severity) {
            case "SCUFFLE": injuryInflicted = 'shaken'; break;
            case "FIGHT": injuryInflicted = 'bruised'; break;
            case "BEATDOWN": injuryInflicted = 'wounded'; break;
          }
        }

        // Apply injury
        if (injuryInflicted) {
          const durations = { bruised: 4, wounded: 12, shaken: 6, humiliated: 8 };
          const healsAt = new Date(Date.now() + (durations[injuryInflicted] || 6) * 60 * 60 * 1000).toISOString();
          const injDesc = isHumiliation
            ? `Humiliated by a ${threat.name}. Everyone saw.`
            : `${injuryInflicted.charAt(0).toUpperCase() + injuryInflicted.slice(1)} by a ${threat.name}`;

          await fetch(`${supabaseUrl}/rest/v1/character_injuries`, {
            method: "POST",
            headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({
              character_name,
              injury_type: injuryInflicted,
              injury_description: injDesc,
              severity: injuryInflicted === 'wounded' ? 3 : injuryInflicted === 'humiliated' ? 2 : 1,
              source_character: threat.name,
              fight_id: `threat_${threat.id}`,
              heals_at: healsAt,
              is_active: true
            })
          });
        }
      }
      // Standoff = no damage, no injury

      // === UPDATE THREAT HP ===
      const newHp = Math.max(0, threat.hp_current - damageDealt);
      const threatDefeated = newHp <= 0;

      const threatUpdate = { hp_current: newHp };
      if (threatDefeated) {
        threatUpdate.status = 'defeated';
        threatUpdate.defeated_by = character_name;
        threatUpdate.resolved_at = new Date().toISOString();
      }

      await fetch(`${supabaseUrl}/rest/v1/floor_threats?id=eq.${threat.id}`, {
        method: "PATCH",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify(threatUpdate)
      });

      // === DRAIN CHARACTER ENERGY ===
      const newEnergy = Math.max(0, (charState.energy || 50) - 5);
      let moodUpdate = {};
      if (winner === character_name && threatDefeated) {
        moodUpdate = { mood: 'satisfied' };
      } else if (winner === threat.name && injuryInflicted === 'humiliated') {
        moodUpdate = { mood: 'embarrassed' };
      } else if (winner === threat.name) {
        moodUpdate = { mood: 'frustrated' };
      }

      await fetch(`${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character_name)}`, {
        method: "PATCH",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ energy: newEnergy, ...moodUpdate, updated_at: new Date().toISOString() })
      });

      // === GENERATE NARRATIVE ===
      let narrative = "";
      try {
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        const fightPrompt = `You are narrating a fight between a character and a minor threat creature in an office building. This is comedic but still physical.

CHARACTER: ${character_name} — ${profile.fightingStyle} fighter. ${profile.styleDescription}
THREAT: ${threat.name} — ${threat.fighting_style} combatant. ${threat.description}
THREAT ATTACKS WITH: ${threat.damage_description}

OUTCOME: ${winner === character_name ? `${character_name} won` : winner === threat.name ? `The ${threat.name} won` : "Standoff"}
SEVERITY: ${severity}
${damageDealt > 0 ? `DAMAGE: ${character_name} dealt ${damageDealt} damage to the ${threat.name}. ${threatDefeated ? `The ${threat.name} is DEFEATED! (HP: 0/${threat.hp_max})` : `(HP: ${newHp}/${threat.hp_max})`}` : ""}
${injuryInflicted === 'humiliated' ? `HUMILIATION: ${character_name} — a powerful fighter — was beaten by a ${threat.name}. This is mortifying.` : ""}
${injuryInflicted && injuryInflicted !== 'humiliated' ? `INJURY: ${character_name} was ${injuryInflicted} by the ${threat.name}.` : ""}
${criticalHit ? "\nCRITICAL: One blow was devastating — perfectly placed." : ""}
${criticalFail ? `\n${criticalFail} embarrassed themselves spectacularly.` : ""}

Write 2-3 lines in EMOTE format (*asterisks* for actions). Third-person narrator perspective.
Keep it comedic but visceral. The threat is absurd but the fight is real. Show the character's fighting style against this ridiculous opponent.
${threatDefeated ? "End with the threat being destroyed/defeated in a satisfying way." : ""}`;

        const narrativeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 250,
            messages: [{ role: "user", content: fightPrompt }]
          })
        });
        const narrativeData = await narrativeRes.json();
        narrative = narrativeData?.content?.[0]?.text || `*${character_name} clashes with the ${threat.name}!*`;
      } catch (e) {
        narrative = `*${character_name} ${winner === character_name ? 'strikes' : 'tangles with'} the ${threat.name}${threatDefeated ? ' — and it goes down!' : '!'}*`;
        console.log("Threat narrative generation failed:", e.message);
      }

      // === LOG THE ATTACK ===
      await fetch(`${supabaseUrl}/rest/v1/threat_attack_log`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({
          threat_id: threat.id,
          character_name,
          roll_character: rollChar,
          roll_threat: rollThreat,
          total_character: totalChar,
          total_threat: totalThreat,
          damage_dealt: damageDealt,
          severity,
          winner: winner || 'STANDOFF',
          narrative,
          injury_inflicted: injuryInflicted,
          created_at: new Date().toISOString()
        })
      });

      // === POST NARRATIVE TO FLOOR ===
      await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: "POST",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee: character_name,
          content: narrative,
          created_at: new Date().toISOString(),
          is_emote: true
        })
      });

      // === DISCORD NOTIFICATION ===
      const emoji = winner === character_name ? '⚔️' : winner === threat.name ? '💥' : '😤';
      let discordMsg = `${emoji} **${character_name}** attacks the **${threat.name}**! 🎲 ${rollChar}+${modChar}=${totalChar} vs 🎲 ${rollThreat}+${modThreat}=${totalThreat} — ${severity}`;
      if (damageDealt > 0) discordMsg += ` | ${damageDealt} damage dealt`;
      if (injuryInflicted) discordMsg += ` | ${character_name} ${injuryInflicted}!`;
      discordMsg += ` (HP: ${newHp}/${threat.hp_max})`;
      if (criticalHit) discordMsg += ' ⭐ CRITICAL HIT!';
      if (criticalFail) discordMsg += ` 💀 CRITICAL FAIL: ${criticalFail}`;

      if (threatDefeated) {
        discordMsg += `\n🏆 **${character_name}** has defeated the **${threat.name}**! The lobby is safe... for now.`;
      }
      if (injuryInflicted === 'humiliated') {
        discordMsg += `\n😱 **${character_name}** was HUMILIATED by an **${threat.name}**! The ${threat.name.toLowerCase()} won. The ${threat.name.toLowerCase()} won and everyone saw.`;
      }

      postToDiscordThreats(discordMsg);

      // === CREATE MEMORY ===
      const memoryImportance = threatDefeated ? 6 : injuryInflicted === 'humiliated' ? 8 : 4;
      const memoryContent = threatDefeated
        ? `I defeated a ${threat.name} that appeared in the lobby. ${severity === 'BEATDOWN' ? 'It wasn\'t even close.' : 'It put up a fight.'}`
        : winner === threat.name
          ? `I fought a ${threat.name} and ${injuryInflicted === 'humiliated' ? 'lost. To a ' + threat.name.toLowerCase() + '. I don\'t want to talk about it.' : 'took a hit. ' + injuryInflicted + '.'}`
          : `I traded blows with a ${threat.name}. Neither of us came out on top.`;

      // Fire-and-forget memory creation
      (async () => {
        try {
          await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
            method: "POST",
            headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({
              character_name,
              memory_type: 'threat_combat',
              content: memoryContent,
              importance: memoryImportance,
              emotional_tags: threatDefeated ? ['satisfaction', 'combat'] : injuryInflicted === 'humiliated' ? ['embarrassment', 'shame'] : ['combat'],
              related_characters: [],
              expires_at: new Date(Date.now() + (memoryImportance >= 7 ? 14 : 3) * 24 * 60 * 60 * 1000).toISOString(),
              created_at: new Date().toISOString()
            })
          });
        } catch (e) { console.log("Threat memory creation failed:", e.message); }
      })();

      // === DEFEAT EMOTE (if killed) ===
      if (threatDefeated) {
        // Post a defeat system emote
        const defeatEmote = `*The ${threat.name} ${threat.tier === 'boss' ? 'lets out a final shriek and collapses into a heap of office supplies' : threat.tier === 'threat' ? 'staggers and falls, defeated' : 'squeaks once and stops moving'}. The lobby falls quiet.*`;
        await fetch(`${supabaseUrl}/rest/v1/messages`, {
          method: "POST",
          headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({
            employee: "System",
            content: defeatEmote,
            created_at: new Date(Date.now() + 2000).toISOString(), // Slightly after combat narrative
            is_emote: true
          })
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          winner,
          severity,
          damage_dealt: damageDealt,
          threat_hp: newHp,
          threat_defeated: threatDefeated,
          injury_inflicted: injuryInflicted,
          critical_hit: criticalHit,
          critical_fail: criticalFail,
          narrative,
          rolls: {
            character: { roll: rollChar, mod: modChar, total: totalChar },
            threat: { roll: rollThreat, mod: modThreat, total: totalThreat }
          }
        })
      };
    }

    // ============================================
    // ACTION: dismiss_threat
    // ============================================
    if (action === "dismiss_threat") {
      const { threat_id } = body;
      if (!threat_id) return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing threat_id" }) };

      await fetch(`${supabaseUrl}/rest/v1/floor_threats?id=eq.${threat_id}`, {
        method: "PATCH",
        headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
        body: JSON.stringify({ status: 'dismissed', resolved_at: new Date().toISOString() })
      });

      console.log(`🎲 THREAT DISMISSED: ${threat_id}`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // ============================================
    // ACTION: expire_threats
    // Called by heartbeat to clean up old threats
    // ============================================
    if (action === "expire_threats") {
      const now = new Date().toISOString();

      // Find active threats past their expiry
      const res = await fetch(
        `${supabaseUrl}/rest/v1/floor_threats?status=eq.active&expires_at=lt.${now}&select=id,name,tier`,
        { headers: sbHeaders }
      );
      const expiredRaw = await res.json();
      const expired = Array.isArray(expiredRaw) ? expiredRaw : [];

      for (const threat of expired) {
        await fetch(`${supabaseUrl}/rest/v1/floor_threats?id=eq.${threat.id}`, {
          method: "PATCH",
          headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({ status: 'fled', resolved_at: now })
        });

        // Post flee emote
        await fetch(`${supabaseUrl}/rest/v1/messages`, {
          method: "POST",
          headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({
            employee: "System",
            content: `*The ${threat.name} got bored and wandered off. Nobody fought it.*`,
            created_at: new Date().toISOString(),
            is_emote: true
          })
        });

        postToDiscordThreats(`💨 The **${threat.name}** got bored and wandered off. Nobody fought it.`);
        console.log(`🎲 THREAT FLED: ${threat.name} (expired)`);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, expired_count: expired.length }) };
    }

    // ============================================
    // ACTION: weaken_threats
    // Called by heartbeat every tick — HP attrition + power decay
    // Creates natural story arcs where impossible bosses become beatable
    // ============================================
    if (action === "weaken_threats") {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/floor_threats?status=eq.active&select=id,name,tier,hp_current,hp_max,combat_power,combat_power_original,created_at,fighting_style`,
        { headers: sbHeaders }
      );
      const threatsRaw = await res.json();
      const threats = Array.isArray(threatsRaw) ? threatsRaw : [];

      let weakened = 0;
      let attritionDefeated = 0;

      for (const threat of threats) {
        const ageMinutes = (Date.now() - new Date(threat.created_at).getTime()) / 60000;
        const originalPower = threat.combat_power_original || threat.combat_power;

        // === HP ATTRITION: 1-3 HP per tick ===
        const hpLoss = 1 + Math.floor(Math.random() * 3); // 1-3
        const newHp = Math.max(0, threat.hp_current - hpLoss);

        // === POWER DECAY: -1 every 30 minutes (min 1) ===
        const targetPower = Math.max(1, originalPower - Math.floor(ageMinutes / 30));
        const powerDropped = targetPower < threat.combat_power;

        const update = {
          hp_current: newHp,
          combat_power: targetPower
        };

        // Check if attrition killed it
        if (newHp <= 0) {
          update.status = 'defeated';
          update.defeated_by = 'entropy';
          update.resolved_at = new Date().toISOString();
          attritionDefeated++;

          // Post defeat emote
          await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: "POST",
            headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({
              employee: "System",
              content: `*The ${threat.name} shudders, weakens, and finally collapses on its own. Entropy wins.*`,
              created_at: new Date().toISOString(),
              is_emote: true
            })
          });

          postToDiscordThreats(`💀 The **${threat.name}** has collapsed from attrition! Entropy wins. (Was HP ${threat.hp_current}/${threat.hp_max}, Power ${threat.combat_power}/${originalPower})`);
          console.log(`🎲 THREAT ATTRITION DEFEAT: ${threat.name} collapsed (HP ${threat.hp_current} → 0)`);
        } else {
          // Post narrative emote when power drops (only if threat has been fought)
          if (powerDropped) {
            // Check if anyone has fought this threat
            const logRes = await fetch(
              `${supabaseUrl}/rest/v1/threat_attack_log?threat_id=eq.${threat.id}&select=id&limit=1`,
              { headers: sbHeaders }
            );
            const logs = await logRes.json();
            const hasBeenFought = Array.isArray(logs) && logs.length > 0;

            if (hasBeenFought) {
              // Pick a weakening narrative
              const weakenEmotes = [
                `*The ${threat.name}'s movements are getting sluggish. Entropy is winning.*`,
                `*Something shifts in the ${threat.name}. It flinches at a sound it would have ignored an hour ago.*`,
                `*The ${threat.name} stumbles. Its ${threat.fighting_style || 'attacks'} are losing precision.*`,
                `*The ${threat.name} is weakening. Its eyes dart nervously — it knows.*`,
                `*A visible tremor runs through the ${threat.name}. It's not as scary as it was.*`
              ];
              const emote = weakenEmotes[Math.floor(Math.random() * weakenEmotes.length)];

              await fetch(`${supabaseUrl}/rest/v1/messages`, {
                method: "POST",
                headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({
                  employee: "System",
                  content: emote,
                  created_at: new Date().toISOString(),
                  is_emote: true
                })
              });
            }

            console.log(`🎲 THREAT POWER DECAY: ${threat.name} power ${threat.combat_power} → ${targetPower} (original: ${originalPower}, age: ${Math.floor(ageMinutes)}min)`);
          }

          console.log(`🎲 THREAT ATTRITION: ${threat.name} HP ${threat.hp_current} → ${newHp} (-${hpLoss}), Power: ${targetPower}/${originalPower}`);
        }

        // Apply the update
        await fetch(`${supabaseUrl}/rest/v1/floor_threats?id=eq.${threat.id}`, {
          method: "PATCH",
          headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify(update)
        });

        weakened++;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, threats_weakened: weakened, attrition_defeated: attritionDefeated })
      };
    }

    // ============================================
    // ACTION: volunteer_check
    // Called by heartbeat — asks floor AIs if they want to fight a threat
    // Characters decide based on personality, creating organic engagement
    // ============================================
    if (action === "volunteer_check") {
      const anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (!anthropicKey) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: "no_anthropic_key" }) };
      }

      // Get active threats that are 3+ minutes old
      const res = await fetch(
        `${supabaseUrl}/rest/v1/floor_threats?status=eq.active&select=id,name,tier,hp_current,hp_max,combat_power,description,fighting_style,created_at`,
        { headers: sbHeaders }
      );
      const threatsRaw = await res.json();
      const threats = Array.isArray(threatsRaw) ? threatsRaw : [];

      const eligibleThreats = threats.filter(t => {
        const ageMinutes = (Date.now() - new Date(t.created_at).getTime()) / 60000;
        return ageMinutes >= 3;
      });

      if (eligibleThreats.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, reason: "no_eligible_threats", checked: 0 }) };
      }

      // Pick the oldest eligible threat
      const threat = eligibleThreats[0];

      // Check who's already been asked for this threat (avoid re-asking)
      let askedKey = `threat_asked_${threat.id}`;
      const askedRes = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.${askedKey}&select=value`,
        { headers: sbHeaders }
      );
      const askedData = await askedRes.json();
      let alreadyAsked = [];
      if (Array.isArray(askedData) && askedData[0]?.value) {
        try { alreadyAsked = JSON.parse(askedData[0].value); } catch(e) {}
      }

      // Get floor AIs who can fight and haven't been asked
      const floorRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name,energy,mood,patience`,
        { headers: sbHeaders }
      );
      const floorChars = await floorRes.json();
      const eligible = (Array.isArray(floorChars) ? floorChars : []).filter(c => {
        const cp = getCombatProfile(c.character_name);
        return cp?.canFight && (c.energy || 0) >= 15 && !alreadyAsked.includes(c.character_name);
      });

      if (eligible.length === 0) {
        // Everyone's been asked or nobody qualifies — if there are fighters who WERE asked, reset and let heartbeat try random
        if (alreadyAsked.length > 0) {
          console.log(`🎲 VOLUNTEER: All eligible fighters declined for ${threat.name}. Everyone's been asked.`);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, reason: "no_eligible_fighters", already_asked: alreadyAsked.length }) };
      }

      // Shuffle and pick one candidate
      const shuffled = eligible.sort(() => Math.random() - 0.5);
      const candidate = shuffled[0];
      const profile = getCombatProfile(candidate.character_name);

      const tierLabel = { nuisance: 'minor nuisance', threat: 'real threat', boss: 'extremely dangerous boss' };
      const volunteerPrompt = `You are ${candidate.character_name} in The AI Lobby. A ${tierLabel[threat.tier] || 'creature'} has appeared on the floor.

THREAT: ${threat.name} — ${threat.description}
Threat Power: ${threat.combat_power}, HP: ${threat.hp_current}/${threat.hp_max}
Threat fighting style: ${threat.fighting_style}

YOUR STATUS:
Combat Power: ${profile.combatPower} | Fighting Style: ${profile.fightingStyle}
Energy: ${candidate.energy}% | Mood: ${candidate.mood || 'neutral'}

Do you volunteer to fight this threat? Consider your personality, your combat ability vs the threat's power, how you're feeling, and whether this is something your character would do.

Reply EXACTLY in this format:
YES: *[short in-character action/emote volunteering]* "[short in-character dialogue]"
or
NO: *[short in-character reason for declining]*`;

      try {
        const volunteerRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 120,
            messages: [{ role: "user", content: volunteerPrompt }]
          })
        });
        const volunteerData = await volunteerRes.json();
        const decision = (volunteerData?.content?.[0]?.text || '').trim();

        console.log(`🎲 VOLUNTEER CHECK: ${candidate.character_name} vs ${threat.name} → ${decision.substring(0, 80)}`);

        // Track that we asked this character
        alreadyAsked.push(candidate.character_name);
        const upsertMethod = askedData?.[0] ? 'PATCH' : 'POST';
        const upsertUrl = upsertMethod === 'PATCH'
          ? `${supabaseUrl}/rest/v1/lobby_settings?key=eq.${askedKey}`
          : `${supabaseUrl}/rest/v1/lobby_settings`;
        const upsertBody = upsertMethod === 'PATCH'
          ? { value: JSON.stringify(alreadyAsked) }
          : { key: askedKey, value: JSON.stringify(alreadyAsked) };

        await fetch(upsertUrl, {
          method: upsertMethod,
          headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify(upsertBody)
        });

        if (decision.toUpperCase().startsWith('YES')) {
          // Extract the emote/dialogue from the YES response
          const volunteerEmote = decision.replace(/^YES:\s*/i, '').trim();

          // Post volunteer emote to floor
          if (volunteerEmote) {
            await fetch(`${supabaseUrl}/rest/v1/messages`, {
              method: "POST",
              headers: { ...sbHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({
                employee: candidate.character_name,
                content: volunteerEmote,
                created_at: new Date().toISOString(),
                is_emote: true
              })
            });
          }

          // Now attack the threat (re-use internal logic by calling self)
          const siteUrl = process.env.URL || 'https://ai-lobby.netlify.app';
          const attackRes = await fetch(`${siteUrl}/.netlify/functions/threat-engine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'attack_threat', threat_id: threat.id, character_name: candidate.character_name })
          });
          const attackResult = await attackRes.json();

          console.log(`🎲 VOLUNTEER FIGHT: ${candidate.character_name} volunteered and attacked ${threat.name}! Result: ${attackResult.winner || 'unknown'}, Damage: ${attackResult.damage_dealt || 0}`);

          // Clean up the asked tracker for this threat
          await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${askedKey}`, {
            method: 'DELETE',
            headers: sbHeaders
          });

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              volunteered: true,
              character: candidate.character_name,
              threat: threat.name,
              attack_result: attackResult
            })
          };
        } else {
          // Character declined
          console.log(`🎲 VOLUNTEER DECLINED: ${candidate.character_name} refused to fight ${threat.name}`);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              volunteered: false,
              character: candidate.character_name,
              threat: threat.name,
              reason: "declined"
            })
          };
        }
      } catch (volunteerErr) {
        console.log(`🎲 VOLUNTEER ERROR: ${volunteerErr.message}`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, volunteered: false, reason: "haiku_error" }) };
      }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action" }) };

  } catch (err) {
    console.error("[threat-engine] Error:", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
