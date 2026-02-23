// Character Growth — Trait System for the AI Lobby
// Characters earn permanent traits through organic experiences (corridor runs,
// deep relationships, quest completions, cat affection, etc.) or admin grants.
// Traits inject into buildStatePrompt via character-state.js, affecting ALL AI
// interactions across every channel (floor, breakroom, corridors, PMs, conference).
//
// GET  ?character=Kevin — Fetch traits for one character
// GET  (no param)      — Fetch all active traits
// POST { action: "evaluate", character: "Kevin" }  — Check one character for new traits
// POST { action: "evaluate_all" }                  — Check all AI characters (heartbeat)
// POST { action: "grant", character, trait_name, trait_description, trait_prompt_injection, earned_reason } — Admin grant

const { CHARACTERS } = require("./shared/characters");

// Active AI character names only (excludes humans and retired characters)
const AI_CHARACTERS = Object.keys(CHARACTERS).filter(name => {
  const c = CHARACTERS[name];
  return c.isAI && !c.retired;
});

// ============================================
// TRAIT CATALOG — Organic triggers
// Each trait has: name, description, promptInjection, check(characterName, supabaseUrl, sbHeaders)
// check() returns { earned: true/false, reason: "..." }
// ============================================
const TRAIT_CATALOG = [
  {
    name: "Battle-Tested",
    description: "Earned by completing 3+ corridor adventures",
    promptInjection: "You've survived the Corridors multiple times. Danger doesn't rattle you the way it used to — you're calmer under pressure, more focused when things get weird.",
    check: async (character, supabaseUrl, sbHeaders) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/corridor_sessions?select=id&party_members=cs.["${character}"]&status=eq.completed&limit=3`,
        { headers: sbHeaders }
      );
      const sessions = await res.json();
      if (sessions.length >= 3) {
        return { earned: true, reason: `Completed ${sessions.length} corridor adventures` };
      }
      return { earned: false };
    }
  },
  {
    name: "Social Butterfly",
    description: "Earned by having 50+ total interactions across all relationships",
    promptInjection: "You thrive on social connection. You notice when someone's been absent or unusually quiet — people matter to you.",
    check: async (character, supabaseUrl, sbHeaders) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?select=interaction_count&character_name=eq.${encodeURIComponent(character)}`,
        { headers: sbHeaders }
      );
      const rels = await res.json();
      const total = rels.reduce((sum, r) => sum + (r.interaction_count || 0), 0);
      if (total >= 50) {
        return { earned: true, reason: `${total} total interactions across all relationships` };
      }
      return { earned: false };
    }
  },
  {
    name: "Loyal Heart",
    description: "Earned when any relationship reaches affinity 85+",
    promptInjection: "You know what deep loyalty feels like. You're fiercely protective of the people you've bonded with, and that devotion colors everything.",
    check: async (character, supabaseUrl, sbHeaders) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?select=target_name,affinity&character_name=eq.${encodeURIComponent(character)}&affinity=gte.85&limit=1`,
        { headers: sbHeaders }
      );
      const rels = await res.json();
      if (rels.length > 0) {
        return { earned: true, reason: `Deep bond with ${rels[0].target_name} (affinity ${rels[0].affinity})` };
      }
      return { earned: false };
    }
  },
  {
    name: "Scarred",
    description: "Earned when any relationship drops to affinity -30 or below",
    promptInjection: "You've been hurt by someone here. It's made you more guarded — new relationships start with a wall up, and trust has to be earned slowly.",
    check: async (character, supabaseUrl, sbHeaders) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?select=target_name,affinity&character_name=eq.${encodeURIComponent(character)}&affinity=lte.-30&limit=1`,
        { headers: sbHeaders }
      );
      const rels = await res.json();
      if (rels.length > 0) {
        return { earned: true, reason: `Damaged relationship with ${rels[0].target_name} (affinity ${rels[0].affinity})` };
      }
      return { earned: false };
    }
  },
  {
    name: "Storyteller",
    description: "Earned by proposing 2+ quests/storylines",
    promptInjection: "You see narrative in everything. You're drawn to starting new adventures and rallying people around a shared story.",
    check: async (character, supabaseUrl, sbHeaders) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/lobby_quests?select=id&proposer=eq.${encodeURIComponent(character)}&limit=2`,
        { headers: sbHeaders }
      );
      const quests = await res.json();
      if (quests.length >= 2) {
        return { earned: true, reason: `Proposed ${quests.length} storylines` };
      }
      return { earned: false };
    }
  },
  {
    name: "Quest Veteran",
    description: "Earned by completing 3+ quest objectives",
    promptInjection: "You've achieved things in this office — completed missions, met objectives. You carry that quiet confidence.",
    check: async (character, supabaseUrl, sbHeaders) => {
      // Fetch all quests, count completed objectives assigned to this character
      const res = await fetch(
        `${supabaseUrl}/rest/v1/lobby_quests?select=objectives`,
        { headers: sbHeaders }
      );
      const quests = await res.json();
      let completedCount = 0;
      for (const quest of quests) {
        const objectives = quest.objectives || [];
        for (const obj of objectives) {
          if (obj.assignee === character && obj.status === 'complete') {
            completedCount++;
          }
        }
      }
      if (completedCount >= 3) {
        return { earned: true, reason: `Completed ${completedCount} quest objectives` };
      }
      return { earned: false };
    }
  },
  {
    name: "Peacemaker",
    description: "Earned by witnessing 3+ positive relationship shifts in the office",
    promptInjection: "You've watched conflicts resolve and people grow closer. You instinctively try to smooth things over when tension rises.",
    check: async (character, supabaseUrl, sbHeaders) => {
      // Check relationship_history for positive shifts involving this character as witness
      // (Drama witness creates memories, but we can check relationship_history where this character
      //  isn't the source but is mentioned or was present)
      const res = await fetch(
        `${supabaseUrl}/rest/v1/relationship_history?select=id&character_name=eq.${encodeURIComponent(character)}&new_affinity=gt.old_affinity&limit=5`,
        { headers: sbHeaders }
      );
      // Fallback: check if this character has many positive relationship changes of their own
      const rels = await res.json();
      if (rels.length >= 3) {
        return { earned: true, reason: `${rels.length} positive relationship shifts recorded` };
      }
      return { earned: false };
    }
  },
  {
    name: "Archivist's Favorite",
    description: "Earned by being mentioned in 3+ lore entries by The Subtitle",
    promptInjection: "The Subtitle has documented you extensively. You're becoming part of the office mythology — people reference your past actions like they're legends.",
    check: async (character, supabaseUrl, sbHeaders) => {
      // lore_entries has characters_involved as text array
      const res = await fetch(
        `${supabaseUrl}/rest/v1/lore_entries?select=id&characters_involved=cs.["${character}"]&limit=5`,
        { headers: sbHeaders }
      );
      const entries = await res.json();
      if (entries.length >= 3) {
        return { earned: true, reason: `Featured in ${entries.length} lore entries` };
      }
      return { earned: false };
    }
  },
  {
    name: "Cat Person",
    description: "Earned when Pixel's affection for you reaches 50+",
    promptInjection: "Pixel adores you. There's a gentle side to you that comes out around the cat — a softness that others might not expect.",
    check: async (character, supabaseUrl, sbHeaders) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/cat_affection?select=affection&human_name=eq.${encodeURIComponent(character)}&limit=1`,
        { headers: sbHeaders }
      );
      const rows = await res.json();
      if (rows.length > 0 && rows[0].affection >= 50) {
        return { earned: true, reason: `Pixel's affection: ${rows[0].affection}` };
      }
      return { earned: false };
    }
  },
  {
    name: "Resilient",
    description: "Earned by recovering from 0 energy 3+ times",
    promptInjection: "You've been completely drained and come back every time. You know what burnout feels like, and you know you can survive it.",
    check: async (character, supabaseUrl, sbHeaders) => {
      // Check memories for references to exhaustion/recovery or check energy-related memories
      const res = await fetch(
        `${supabaseUrl}/rest/v1/character_memory?select=id&character_name=eq.${encodeURIComponent(character)}&content=ilike.*exhausted*&limit=5`,
        { headers: sbHeaders }
      );
      const memories = await res.json();
      // Also check for breakroom recovery memories
      const res2 = await fetch(
        `${supabaseUrl}/rest/v1/character_memory?select=id&character_name=eq.${encodeURIComponent(character)}&content=ilike.*drained*&limit=5`,
        { headers: sbHeaders }
      );
      const memories2 = await res2.json();
      const totalRecoveries = memories.length + memories2.length;
      if (totalRecoveries >= 3) {
        return { earned: true, reason: `${totalRecoveries} recovery memories found` };
      }
      return { earned: false };
    }
  },
  // === Nexus Traits ===
  {
    name: "Scholar",
    description: "Earned by reaching Proficient in any Nexus skill",
    promptInjection: "You've studied deeply in the Nexus and reached true proficiency. Knowledge isn't just something you have — it's part of how you think now.",
    check: async (character, supabaseUrl, sbHeaders) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/character_skills?select=skill_name,skill_level&character_name=eq.${encodeURIComponent(character)}&skill_level=in.(proficient,expert,master)&limit=5`,
        { headers: sbHeaders }
      );
      const skills = await res.json();
      if (skills.length >= 1) {
        return { earned: true, reason: `Proficient+ in: ${skills.map(s => s.skill_name).join(', ')}` };
      }
      return { earned: false };
    }
  },
  {
    name: "Renaissance Mind",
    description: "Earned by reaching Apprentice+ in 3 different skill categories",
    promptInjection: "You've explored multiple disciplines in the Nexus. Your thinking crosses boundaries — you see connections between fields that others treat as separate.",
    check: async (character, supabaseUrl, sbHeaders) => {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/character_skills?select=skill_category,skill_level&character_name=eq.${encodeURIComponent(character)}&skill_level=in.(apprentice,proficient,expert,master)&limit=10`,
        { headers: sbHeaders }
      );
      const skills = await res.json();
      const uniqueCategories = new Set(skills.map(s => s.skill_category));
      if (uniqueCategories.size >= 3) {
        return { earned: true, reason: `${uniqueCategories.size} skill categories at Apprentice+: ${[...uniqueCategories].join(', ')}` };
      }
      return { earned: false };
    }
  },
  {
    name: "Mentor",
    description: "Earned by teaching in the Nexus while Expert+ in any skill",
    promptInjection: "You've taught others in the Nexus. You understand that explaining something deepens your own understanding, and you enjoy watching others grow.",
    check: async (character, supabaseUrl, sbHeaders) => {
      // Check for completed teach sessions
      const sessRes = await fetch(
        `${supabaseUrl}/rest/v1/nexus_sessions?select=id&character_name=eq.${encodeURIComponent(character)}&session_type=eq.teach&status=eq.completed&limit=3`,
        { headers: sbHeaders }
      );
      const sessions = await sessRes.json();
      // Also check if they have expert+ level
      const skillRes = await fetch(
        `${supabaseUrl}/rest/v1/character_skills?select=skill_level&character_name=eq.${encodeURIComponent(character)}&skill_level=in.(expert,master)&limit=1`,
        { headers: sbHeaders }
      );
      const expertSkills = await skillRes.json();
      if (sessions.length >= 1 && expertSkills.length >= 1) {
        return { earned: true, reason: `${sessions.length} teaching sessions completed with Expert+ skill` };
      }
      return { earned: false };
    }
  }
];

// ============================================
// HANDLER
// ============================================
exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing Supabase configuration" }) };
  }

  const sbHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation"
  };

  // =====================
  // GET: Fetch traits
  // =====================
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};

    try {
      let url = `${supabaseUrl}/rest/v1/character_traits?select=*&is_active=eq.true&order=earned_at.desc`;

      if (params.character) {
        url += `&character_name=eq.${encodeURIComponent(params.character)}`;
      }

      const res = await fetch(url, { headers: sbHeaders });
      const traits = await res.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ traits, count: traits.length })
      };
    } catch (error) {
      console.error("Character growth GET error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  // =====================
  // POST: Evaluate or Grant traits
  // =====================
  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");
      const { action } = body;

      // ----- ACTION: evaluate -----
      if (action === "evaluate") {
        const { character } = body;
        if (!character) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing character name" }) };
        }

        const result = await evaluateCharacter(character, supabaseUrl, sbHeaders);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result)
        };
      }

      // ----- ACTION: evaluate_all -----
      if (action === "evaluate_all") {
        const results = {};
        let totalNewTraits = 0;

        for (const character of AI_CHARACTERS) {
          try {
            const result = await evaluateCharacter(character, supabaseUrl, sbHeaders);
            results[character] = result;
            totalNewTraits += result.newTraits.length;
          } catch (err) {
            console.log(`[character-growth] Evaluation failed for ${character}:`, err.message);
            results[character] = { error: err.message };
          }
        }

        console.log(`[character-growth] Evaluated all characters. ${totalNewTraits} new traits earned.`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ results, totalNewTraits })
        };
      }

      // ----- ACTION: grant -----
      if (action === "grant") {
        const { character, trait_name, trait_description, trait_prompt_injection, earned_reason } = body;

        if (!character || !trait_name || !trait_description || !trait_prompt_injection) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing required fields: character, trait_name, trait_description, trait_prompt_injection" })
          };
        }

        // Upsert — if trait exists but is inactive, reactivate it
        const upsertRes = await fetch(
          `${supabaseUrl}/rest/v1/character_traits`,
          {
            method: "POST",
            headers: { ...sbHeaders, "Prefer": "return=representation,resolution=merge-duplicates" },
            body: JSON.stringify({
              character_name: character,
              trait_name,
              trait_description,
              trait_prompt_injection,
              earned_reason: earned_reason || "Admin granted",
              source_type: "admin",
              is_active: true,
              earned_at: new Date().toISOString()
            })
          }
        );

        const upserted = await upsertRes.json();
        console.log(`[character-growth] Admin granted "${trait_name}" to ${character}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, trait: upserted[0] || upserted })
        };
      }

      // ----- ACTION: remove -----
      if (action === "remove") {
        const { character, trait_name } = body;
        if (!character || !trait_name) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing character or trait_name" }) };
        }

        await fetch(
          `${supabaseUrl}/rest/v1/character_traits?character_name=eq.${encodeURIComponent(character)}&trait_name=eq.${encodeURIComponent(trait_name)}`,
          {
            method: "PATCH",
            headers: sbHeaders,
            body: JSON.stringify({ is_active: false })
          }
        );

        console.log(`[character-growth] Removed trait "${trait_name}" from ${character}`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, removed: trait_name })
        };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown action. Use: evaluate, evaluate_all, grant, remove" }) };

    } catch (error) {
      console.error("Character growth POST error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};

// ============================================
// EVALUATE CHARACTER — Check all trait triggers
// ============================================
async function evaluateCharacter(characterName, supabaseUrl, sbHeaders) {
  // 1. Fetch existing traits for this character (active + inactive — to avoid re-granting removed ones)
  const existingRes = await fetch(
    `${supabaseUrl}/rest/v1/character_traits?select=trait_name,is_active&character_name=eq.${encodeURIComponent(characterName)}`,
    { headers: sbHeaders }
  );
  const existingTraits = await existingRes.json();
  const existingNames = new Set(existingTraits.map(t => t.trait_name));

  // 2. Check each trait in the catalog
  const newTraits = [];
  const checked = [];

  for (const trait of TRAIT_CATALOG) {
    // Skip if already has this trait (earned or removed — don't re-grant removed ones)
    if (existingNames.has(trait.name)) {
      checked.push({ trait: trait.name, status: "already_has" });
      continue;
    }

    try {
      const result = await trait.check(characterName, supabaseUrl, sbHeaders);
      if (result.earned) {
        // Grant the trait!
        await fetch(
          `${supabaseUrl}/rest/v1/character_traits`,
          {
            method: "POST",
            headers: sbHeaders,
            body: JSON.stringify({
              character_name: characterName,
              trait_name: trait.name,
              trait_description: trait.description,
              trait_prompt_injection: trait.promptInjection,
              earned_reason: result.reason,
              source_type: "organic",
              is_active: true
            })
          }
        );

        newTraits.push({ trait: trait.name, reason: result.reason });
        console.log(`[character-growth] 🌱 ${characterName} earned "${trait.name}" — ${result.reason}`);

        checked.push({ trait: trait.name, status: "NEW", reason: result.reason });
      } else {
        checked.push({ trait: trait.name, status: "not_met" });
      }
    } catch (err) {
      console.log(`[character-growth] Trait check failed for ${characterName}/${trait.name}:`, err.message);
      checked.push({ trait: trait.name, status: "error", error: err.message });
    }
  }

  return {
    character: characterName,
    newTraits,
    totalChecked: checked.length,
    details: checked
  };
}
