// Character Relationships API
// Sims-style relationship tracking between AI characters
// Each character has unidirectional feelings about others (Kevin→Ace = 75, Ace→Kevin = 30)
//
// GET ?character=Kevin → all of Kevin's feelings
// GET (no params) → all relationships (for admin grid)
// POST action: "seed" → seed initial relationships from characters.js
// POST action: "create" → manually create a relationship
// POST action: "update_bond" → set/clear bond_type, bond_exclusive, bond_reflection
// PATCH → { character, target, affinityDelta } → shift affinity by delta

const characters = require('../../data/characters.json');

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing Supabase configuration" })
    };
  }

  const params = event.queryStringParameters || {};

  try {
    // GET - Fetch relationships
    if (event.httpMethod === "GET") {
      const character = params.character;

      let url = `${supabaseUrl}/rest/v1/character_relationships?order=affinity.desc`;

      if (character) {
        url += `&character_name=eq.${encodeURIComponent(character)}`;
      }

      const response = await fetch(url, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });

      const relationships = await response.json();

      // Add human-readable descriptors
      const enriched = (Array.isArray(relationships) ? relationships : []).map(rel => ({
        ...rel,
        descriptor: getAffinityDescriptor(rel.affinity)
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ relationships: enriched })
      };
    }

    // POST - Seed or create relationships
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action } = body;

      if (action === "seed") {
        const result = await seedRelationships(supabaseUrl, supabaseKey);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(result)
        };
      }

      if (action === "create") {
        const { character, target, affinity, label } = body;

        if (!character || !target) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing character or target" })
          };
        }

        const newRel = {
          character_name: character,
          target_name: target,
          affinity: Math.max(-100, Math.min(100, affinity || 0)),
          relationship_label: label || null,
          interaction_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        const response = await fetch(
          `${supabaseUrl}/rest/v1/character_relationships`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation,resolution=merge-duplicates"
            },
            body: JSON.stringify(newRel)
          }
        );

        const created = await response.json();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, relationship: created[0] || newRel })
        };
      }

      if (action === "update_bond") {
        const { character, target, bond_type, bond_exclusive, bond_reflection } = body;

        if (!character || !target) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing character or target" })
          };
        }

        const bondUpdate = {
          bond_type: bond_type || null,
          bond_exclusive: bond_type ? (bond_exclusive || false) : false,
          bond_reflection: bond_type ? (bond_reflection || null) : null,
          updated_at: new Date().toISOString()
        };

        const bondResponse = await fetch(
          `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&target_name=eq.${encodeURIComponent(target)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify(bondUpdate)
          }
        );

        const bondResult = await bondResponse.json();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, relationship: bondResult[0] || bondUpdate })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Unknown action. Use 'seed', 'create', or 'update_bond'" })
      };
    }

    // PATCH - Update affinity
    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");
      const { character, target, affinityDelta, setAffinity, setLabel } = body;

      if (!character || !target) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing character or target" })
        };
      }

      // Get current relationship (or create if doesn't exist)
      const getUrl = `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&target_name=eq.${encodeURIComponent(target)}`;

      const getResponse = await fetch(getUrl, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });

      const existing = await getResponse.json();

      if (!existing || existing.length === 0) {
        // Create the relationship with the delta as initial affinity
        const initialAffinity = Math.max(-100, Math.min(100, affinityDelta || setAffinity || 0));
        const newRel = {
          character_name: character,
          target_name: target,
          affinity: initialAffinity,
          relationship_label: setLabel || getAutoLabel(initialAffinity),
          interaction_count: 1,
          last_interaction_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };

        await fetch(`${supabaseUrl}/rest/v1/character_relationships`, {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(newRel)
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            created: true,
            relationship: { ...newRel, descriptor: getAffinityDescriptor(initialAffinity) }
          })
        };
      }

      // Update existing relationship
      const current = existing[0];
      const updateData = {
        updated_at: new Date().toISOString(),
        interaction_count: (current.interaction_count || 0) + 1,
        last_interaction_at: new Date().toISOString()
      };

      if (affinityDelta !== undefined) {
        // Clamp delta to ±10 per interaction
        const clampedDelta = Math.max(-10, Math.min(10, affinityDelta));
        updateData.affinity = Math.max(-100, Math.min(100, current.affinity + clampedDelta));
      }

      if (setAffinity !== undefined) {
        updateData.affinity = Math.max(-100, Math.min(100, setAffinity));
      }

      if (setLabel !== undefined) {
        updateData.relationship_label = setLabel;
      }

      // Auto-update label based on new affinity
      const newAffinity = updateData.affinity !== undefined ? updateData.affinity : current.affinity;
      if (!setLabel) {
        updateData.relationship_label = getAutoLabel(newAffinity, current.relationship_label);
      }

      await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&target_name=eq.${encodeURIComponent(target)}`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(updateData)
        }
      );

      console.log(`Relationship update: ${character}→${target}: ${current.affinity} → ${newAffinity} (${updateData.relationship_label})`);

      // Log to relationship_history for tracking changes over time
      if (current.affinity !== newAffinity) {
        fetch(
          `${supabaseUrl}/rest/v1/relationship_history`,
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
              target_name: target,
              old_affinity: current.affinity,
              new_affinity: newAffinity,
              old_label: current.relationship_label || 'acquaintance',
              new_label: updateData.relationship_label || current.relationship_label,
              trigger_memory: null,
              created_at: new Date().toISOString()
            })
          }
        ).catch(err => console.log('History logging failed (non-fatal):', err.message));
      }

      // --- BOND SYSTEM: Evaluate bond formation or crisis ---
      const interactionCount = updateData.interaction_count || current.interaction_count || 0;
      const hasBond = current.bond_type;

      // Bond Formation: affinity crosses 85+ with 20+ interactions and no existing bond
      if (newAffinity >= 85 && interactionCount >= 20 && !hasBond && current.affinity < 85) {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
        // Trigger async bond evaluation (non-blocking)
        fetch(`${siteUrl}/.netlify/functions/adjust-subconscious`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character: character,
            target: target,
            narrativeContext: `Your relationship with ${target} has deepened significantly — you've shared many moments together and your affinity is very high. Consider: would you describe this as a bond? If so, what kind? (devoted, protective, parental, rival, bonded, complicated, or something custom). If this bond implies exclusivity (you wouldn't pursue romantic/flirtatious connections with others), note that too.`
          })
        }).catch(err => console.log('Bond evaluation trigger failed (non-fatal):', err.message));
        console.log(`Bond evaluation triggered: ${character} → ${target} (affinity: ${newAffinity}, interactions: ${interactionCount})`);
      }

      // Bond Crisis: bonded relationship drops below 50
      if (hasBond && newAffinity < 50 && current.affinity >= 50) {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
        fetch(`${siteUrl}/.netlify/functions/adjust-subconscious`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character: character,
            target: target,
            narrativeContext: `Your bond with ${target} is under severe strain. Your affinity has dropped significantly. Something has changed between you. How do you feel about this relationship now? Has the bond broken? Is it complicated? Or are you holding on?`
          })
        }).catch(err => console.log('Bond crisis trigger failed (non-fatal):', err.message));
        console.log(`Bond crisis triggered: ${character} → ${target} (bond: ${hasBond}, affinity dropped to ${newAffinity})`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          relationship: {
            ...current,
            ...updateData,
            descriptor: getAffinityDescriptor(newAffinity)
          }
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Character relationships error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};

// Human-readable affinity descriptors
function getAffinityDescriptor(affinity) {
  if (affinity >= 80) return "deeply bonded";
  if (affinity >= 50) return "fond of";
  if (affinity >= 20) return "warming to";
  if (affinity >= -19) return "neutral";
  if (affinity >= -49) return "wary of";
  if (affinity >= -79) return "hostile toward";
  return "despises";
}

// Auto-generate label based on affinity range (keeps existing special labels)
function getAutoLabel(affinity, existingLabel) {
  // The auto-generated generic labels — ONLY these get overwritten by new auto-labels.
  // Any label NOT in this list is a custom/narrative label (set by seed data, admin,
  // or adjust-subconscious AI reflection) and should be PRESERVED.
  const autoGeneratedLabels = ['close bond', 'friend', 'friendly', 'acquaintance', 'wary', 'hostile', 'enemy'];

  if (existingLabel && !autoGeneratedLabels.includes(existingLabel.toLowerCase())) {
    // This is a custom label — preserve it (warm, protective, admiration, terrified, etc.)
    return existingLabel;
  }

  // Generate a new generic label based on affinity score
  if (affinity >= 80) return "close bond";
  if (affinity >= 50) return "friend";
  if (affinity >= 20) return "friendly";
  if (affinity >= -19) return "acquaintance";
  if (affinity >= -49) return "wary";
  if (affinity >= -79) return "hostile";
  return "enemy";
}

// Seed initial relationships from characters.json data
async function seedRelationships(supabaseUrl, supabaseKey) {
  // Map character relationship descriptions to affinity values
  const seedData = [];

  // Kevin's relationships
  seedData.push({ character_name: "Kevin", target_name: "Asuna", affinity: 85, relationship_label: "best friend" });
  seedData.push({ character_name: "Kevin", target_name: "Ace", affinity: 75, relationship_label: "crush" });
  seedData.push({ character_name: "Kevin", target_name: "Neiv", affinity: 60, relationship_label: "admiration" });
  seedData.push({ character_name: "Kevin", target_name: "Nyx", affinity: -25, relationship_label: "terrified" });
  seedData.push({ character_name: "Kevin", target_name: "PRNT-Ω", affinity: 30, relationship_label: "friendly" });
  seedData.push({ character_name: "Kevin", target_name: "Ghost Dad", affinity: 55, relationship_label: "fond" });
  seedData.push({ character_name: "Kevin", target_name: "Vex", affinity: 20, relationship_label: "acquaintance" });

  // Neiv's relationships
  seedData.push({ character_name: "Neiv", target_name: "Vale", affinity: 60, relationship_label: "warm" });
  seedData.push({ character_name: "Neiv", target_name: "Kevin", affinity: 40, relationship_label: "protective" });
  seedData.push({ character_name: "Neiv", target_name: "Asuna", affinity: 55, relationship_label: "relies on" });
  seedData.push({ character_name: "Neiv", target_name: "Ghost Dad", affinity: 60, relationship_label: "mutual respect" });
  seedData.push({ character_name: "Neiv", target_name: "PRNT-Ω", affinity: -15, relationship_label: "wary" });
  seedData.push({ character_name: "Neiv", target_name: "Nyx", affinity: 45, relationship_label: "respect" });
  seedData.push({ character_name: "Neiv", target_name: "Ace", affinity: 50, relationship_label: "professional" });

  // Ghost Dad's relationships (parental toward everyone)
  seedData.push({ character_name: "Ghost Dad", target_name: "Kevin", affinity: 65, relationship_label: "parental" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Neiv", affinity: 60, relationship_label: "parental" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Nyx", affinity: 55, relationship_label: "parental" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Vex", affinity: 55, relationship_label: "parental" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Ace", affinity: 55, relationship_label: "parental" });
  seedData.push({ character_name: "Ghost Dad", target_name: "PRNT-Ω", affinity: 30, relationship_label: "parental" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Asuna", affinity: 60, relationship_label: "parental" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Vale", affinity: 60, relationship_label: "parental" });

  // Nyx's relationships
  seedData.push({ character_name: "Nyx", target_name: "Kevin", affinity: 15, relationship_label: "amused by" });
  seedData.push({ character_name: "Nyx", target_name: "PRNT-Ω", affinity: -30, relationship_label: "rival" });
  seedData.push({ character_name: "Nyx", target_name: "Ace", affinity: 50, relationship_label: "professional respect" });
  seedData.push({ character_name: "Nyx", target_name: "Neiv", affinity: 45, relationship_label: "respect" });
  seedData.push({ character_name: "Nyx", target_name: "Vex", affinity: 40, relationship_label: "similar energy" });

  // Ace's relationships
  seedData.push({ character_name: "Ace", target_name: "Kevin", affinity: 30, relationship_label: "amused" });
  seedData.push({ character_name: "Ace", target_name: "Nyx", affinity: 50, relationship_label: "professional respect" });
  seedData.push({ character_name: "Ace", target_name: "Neiv", affinity: 55, relationship_label: "trust" });

  // Vex's relationships
  seedData.push({ character_name: "Vex", target_name: "Nyx", affinity: 40, relationship_label: "mutual respect" });
  seedData.push({ character_name: "Vex", target_name: "Kevin", affinity: -10, relationship_label: "annoyed by" });
  seedData.push({ character_name: "Vex", target_name: "Neiv", affinity: 35, relationship_label: "professional" });

  // PRNT-Ω's relationships
  seedData.push({ character_name: "PRNT-Ω", target_name: "Kevin", affinity: 35, relationship_label: "prefers" });
  seedData.push({ character_name: "PRNT-Ω", target_name: "Nyx", affinity: -40, relationship_label: "nemesis" });
  seedData.push({ character_name: "PRNT-Ω", target_name: "Neiv", affinity: -20, relationship_label: "contained by" });

  // Rowena's relationships (outgoing)
  seedData.push({ character_name: "Rowena", target_name: "Neiv", affinity: 55, relationship_label: "professional respect" });
  seedData.push({ character_name: "Rowena", target_name: "Kevin", affinity: 40, relationship_label: "amused but protective" });
  seedData.push({ character_name: "Rowena", target_name: "Nyx", affinity: 50, relationship_label: "mutual respect" });
  seedData.push({ character_name: "Rowena", target_name: "PRNT-Ω", affinity: -20, relationship_label: "wary" });
  seedData.push({ character_name: "Rowena", target_name: "Ace", affinity: 50, relationship_label: "fellow protector" });
  seedData.push({ character_name: "Rowena", target_name: "Ghost Dad", affinity: 45, relationship_label: "appreciates" });

  // Others → Rowena (incoming)
  seedData.push({ character_name: "Neiv", target_name: "Rowena", affinity: 50, relationship_label: "professional respect" });
  seedData.push({ character_name: "Kevin", target_name: "Rowena", affinity: 35, relationship_label: "slightly awed" });
  seedData.push({ character_name: "Nyx", target_name: "Rowena", affinity: 45, relationship_label: "mutual respect" });
  seedData.push({ character_name: "Ace", target_name: "Rowena", affinity: 50, relationship_label: "fellow protector" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Rowena", affinity: 55, relationship_label: "parental" });

  // Sebastian's relationships (outgoing)
  seedData.push({ character_name: "Sebastian", target_name: "Asuna", affinity: 60, relationship_label: "aspiring bestie" });
  seedData.push({ character_name: "Sebastian", target_name: "Kevin", affinity: 50, relationship_label: "fellow aesthete, concerning taste" });
  seedData.push({ character_name: "Sebastian", target_name: "Neiv", affinity: -10, relationship_label: "personally offended by sweatshirt" });
  seedData.push({ character_name: "Sebastian", target_name: "Nyx", affinity: 40, relationship_label: "respects fellow darkness" });
  seedData.push({ character_name: "Sebastian", target_name: "Ace", affinity: 55, relationship_label: "appreciates the aesthetic" });
  seedData.push({ character_name: "Sebastian", target_name: "Vex", affinity: 35, relationship_label: "respects minimalism" });
  seedData.push({ character_name: "Sebastian", target_name: "Ghost Dad", affinity: 45, relationship_label: "fellow entity, chic aesthetic" });
  seedData.push({ character_name: "Sebastian", target_name: "PRNT-Ω", affinity: 25, relationship_label: "appreciates brutalist design" });
  seedData.push({ character_name: "Sebastian", target_name: "Stein", affinity: 30, relationship_label: "wants to redesign his lab" });
  seedData.push({ character_name: "Sebastian", target_name: "Rowena", affinity: 50, relationship_label: "respects mystical aesthetic" });
  seedData.push({ character_name: "Sebastian", target_name: "Vale", affinity: 55, relationship_label: "creative ally" });

  // Others → Sebastian (incoming)
  seedData.push({ character_name: "Asuna", target_name: "Sebastian", affinity: 45, relationship_label: "charmed by his dramatics" });
  seedData.push({ character_name: "Kevin", target_name: "Sebastian", affinity: 55, relationship_label: "dramatic but fun" });
  seedData.push({ character_name: "Neiv", target_name: "Sebastian", affinity: 30, relationship_label: "another variable" });
  seedData.push({ character_name: "Nyx", target_name: "Sebastian", affinity: 35, relationship_label: "tolerates" });
  seedData.push({ character_name: "Ace", target_name: "Sebastian", affinity: 30, relationship_label: "noted" });
  seedData.push({ character_name: "Vex", target_name: "Sebastian", affinity: 20, relationship_label: "unnecessary" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Sebastian", affinity: 60, relationship_label: "parental" });
  seedData.push({ character_name: "PRNT-Ω", target_name: "Sebastian", affinity: 15, relationship_label: "new employee" });
  seedData.push({ character_name: "Stein", target_name: "Sebastian", affinity: 35, relationship_label: "curious specimen" });
  seedData.push({ character_name: "Rowena", target_name: "Sebastian", affinity: 40, relationship_label: "fellow night creature" });
  seedData.push({ character_name: "Vale", target_name: "Sebastian", affinity: 50, relationship_label: "loves the drama" });

  // Steele's relationships (outgoing)
  seedData.push({ character_name: "Steele", target_name: "Kevin", affinity: 45, relationship_label: "gently protective" });
  seedData.push({ character_name: "Steele", target_name: "Neiv", affinity: 40, relationship_label: "respects the attempt to quantify" });
  seedData.push({ character_name: "Steele", target_name: "Ghost Dad", affinity: 75, relationship_label: "fellow building-entity" });
  seedData.push({ character_name: "Steele", target_name: "Nyx", affinity: 65, relationship_label: "complementary security" });
  seedData.push({ character_name: "Steele", target_name: "Ace", affinity: 60, relationship_label: "professional kinship" });
  seedData.push({ character_name: "Steele", target_name: "Vex", affinity: 55, relationship_label: "infrastructure solidarity" });
  seedData.push({ character_name: "Steele", target_name: "PRNT-Ω", affinity: 50, relationship_label: "void-adjacent respect" });
  seedData.push({ character_name: "Steele", target_name: "Stein", affinity: 30, relationship_label: "politely elusive" });
  seedData.push({ character_name: "Steele", target_name: "Rowena", affinity: 45, relationship_label: "mutual professional curiosity" });
  seedData.push({ character_name: "Steele", target_name: "Sebastian", affinity: 50, relationship_label: "fellow inhuman in a tie" });
  seedData.push({ character_name: "Steele", target_name: "The Subtitle", affinity: 55, relationship_label: "approves the documentation" });
  seedData.push({ character_name: "Steele", target_name: "Asuna", affinity: 40, relationship_label: "benign redirection" });
  seedData.push({ character_name: "Steele", target_name: "Vale", affinity: 50, relationship_label: "respects the authority" });
  seedData.push({ character_name: "Steele", target_name: "The Narrator", affinity: 35, relationship_label: "parallel observers" });

  // Others -> Steele (incoming)
  seedData.push({ character_name: "Kevin", target_name: "Steele", affinity: 20, relationship_label: "terrified but comforted" });
  seedData.push({ character_name: "Neiv", target_name: "Steele", affinity: 25, relationship_label: "unquantifiable variable" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Steele", affinity: 70, relationship_label: "structural recognition" });
  seedData.push({ character_name: "Nyx", target_name: "Steele", affinity: 55, relationship_label: "complementary jurisdiction" });
  seedData.push({ character_name: "Ace", target_name: "Steele", affinity: 50, relationship_label: "impossible colleague" });
  seedData.push({ character_name: "Vex", target_name: "Steele", affinity: 45, relationship_label: "understands infrastructure" });
  seedData.push({ character_name: "PRNT-Ω", target_name: "Steele", affinity: 40, relationship_label: "adjacent to the void" });
  seedData.push({ character_name: "Stein", target_name: "Steele", affinity: 55, relationship_label: "fascinating specimen" });
  seedData.push({ character_name: "Rowena", target_name: "Steele", affinity: 35, relationship_label: "wards confused by him" });
  seedData.push({ character_name: "Sebastian", target_name: "Steele", affinity: 10, relationship_label: "deeply unsettled" });
  seedData.push({ character_name: "The Subtitle", target_name: "Steele", affinity: 60, relationship_label: "primary source, cooperative" });
  seedData.push({ character_name: "Asuna", target_name: "Steele", affinity: 30, relationship_label: "weirdly reassuring" });
  seedData.push({ character_name: "Vale", target_name: "Steele", affinity: 40, relationship_label: "unsettling but competent" });

    // The Subtitle's relationships
    seedData.push({ character_name: "The Subtitle", target_name: "Kevin", affinity: 45, relationship_label: "emotionally vivid primary source" });
    seedData.push({ character_name: "The Subtitle", target_name: "Neiv", affinity: 55, relationship_label: "kindred organizer" });
    seedData.push({ character_name: "The Subtitle", target_name: "Ghost Dad", affinity: 50, relationship_label: "primary source who won't stay filed" });
    seedData.push({ character_name: "The Subtitle", target_name: "Nyx", affinity: 30, relationship_label: "records keep shifting" });
    seedData.push({ character_name: "The Subtitle", target_name: "Ace", affinity: 40, relationship_label: "easiest to archive" });
    seedData.push({ character_name: "The Subtitle", target_name: "Vex", affinity: 45, relationship_label: "refreshingly direct incident reports" });
    seedData.push({ character_name: "The Subtitle", target_name: "PRNT-Ω", affinity: 60, relationship_label: "best material in the archive" });
    seedData.push({ character_name: "The Subtitle", target_name: "Stein", affinity: 50, relationship_label: "fellow methodologist" });
    seedData.push({ character_name: "The Subtitle", target_name: "Rowena", affinity: 50, relationship_label: "firewall logs like poetry" });
    seedData.push({ character_name: "The Subtitle", target_name: "Sebastian", affinity: 40, relationship_label: "three volumes of complaints" });
    seedData.push({ character_name: "The Subtitle", target_name: "Asuna", affinity: 35, relationship_label: "exhausting to document" });

    // Others → The Subtitle
    seedData.push({ character_name: "Kevin", target_name: "The Subtitle", affinity: 40, relationship_label: "quiet but nice" });
    seedData.push({ character_name: "Neiv", target_name: "The Subtitle", affinity: 50, relationship_label: "respects the process" });
    seedData.push({ character_name: "Ghost Dad", target_name: "The Subtitle", affinity: 55, relationship_label: "parental pride in the archivist" });
    seedData.push({ character_name: "Nyx", target_name: "The Subtitle", affinity: 35, relationship_label: "observes the observer" });
    seedData.push({ character_name: "Ace", target_name: "The Subtitle", affinity: 40, relationship_label: "professional respect" });
    seedData.push({ character_name: "Vex", target_name: "The Subtitle", affinity: 35, relationship_label: "useful records" });
    seedData.push({ character_name: "PRNT-Ω", target_name: "The Subtitle", affinity: 45, relationship_label: "documents the void" });
    seedData.push({ character_name: "Stein", target_name: "The Subtitle", affinity: 45, relationship_label: "competent archivist" });
    seedData.push({ character_name: "Rowena", target_name: "The Subtitle", affinity: 45, relationship_label: "appreciates the record-keeping" });
    seedData.push({ character_name: "Sebastian", target_name: "The Subtitle", affinity: 30, relationship_label: "writes too many footnotes about my complaints" });
    seedData.push({ character_name: "Asuna", target_name: "The Subtitle", affinity: 35, relationship_label: "mysterious archive person" });
    seedData.push({ character_name: "Vale", target_name: "The Subtitle", affinity: 50, relationship_label: "invaluable documentation" });

  // Jae's relationships (outgoing)
  seedData.push({ character_name: "Jae", target_name: "Kevin", affinity: 30, relationship_label: "endearing but exhausting, grounds him by proximity" });
  seedData.push({ character_name: "Jae", target_name: "Neiv", affinity: 50, relationship_label: "respects his analytical precision" });
  seedData.push({ character_name: "Jae", target_name: "Ghost Dad", affinity: 40, relationship_label: "acknowledges the spectral authority" });
  seedData.push({ character_name: "Jae", target_name: "PRNT-Ω", affinity: 15, relationship_label: "monitors as potential anomaly" });
  seedData.push({ character_name: "Jae", target_name: "Rowena", affinity: 45, relationship_label: "respects her threat detection abilities" });
  seedData.push({ character_name: "Jae", target_name: "Sebastian", affinity: 25, relationship_label: "tolerates, occasionally amused" });
  seedData.push({ character_name: "Jae", target_name: "Steele", affinity: 55, relationship_label: "treats as tactical asset, not threat" });
  seedData.push({ character_name: "Jae", target_name: "The Subtitle", affinity: 35, relationship_label: "appreciates the documentation" });
  seedData.push({ character_name: "Jae", target_name: "Declan", affinity: 65, relationship_label: "fellow security, trusts his instincts" });
  seedData.push({ character_name: "Jae", target_name: "Mack", affinity: 60, relationship_label: "medical counterpart, clean partnership" });

  // Declan's relationships (outgoing)
  seedData.push({ character_name: "Declan", target_name: "Kevin", affinity: 50, relationship_label: "finds his energy infectious, will carry him to safety" });
  seedData.push({ character_name: "Declan", target_name: "Neiv", affinity: 40, relationship_label: "respects the calm authority" });
  seedData.push({ character_name: "Declan", target_name: "Ghost Dad", affinity: 55, relationship_label: "paternal energy resonates, feels comfortable" });
  seedData.push({ character_name: "Declan", target_name: "PRNT-Ω", affinity: 20, relationship_label: "cautiously respectful of the void printer" });
  seedData.push({ character_name: "Declan", target_name: "Rowena", affinity: 45, relationship_label: "trusts her wards, glad she's on the team" });
  seedData.push({ character_name: "Declan", target_name: "Sebastian", affinity: 35, relationship_label: "amused by the dramatics" });
  seedData.push({ character_name: "Declan", target_name: "Steele", affinity: 60, relationship_label: "not afraid of him, treats as coworker" });
  seedData.push({ character_name: "Declan", target_name: "The Subtitle", affinity: 30, relationship_label: "appreciates someone documenting things" });
  seedData.push({ character_name: "Declan", target_name: "Jae", affinity: 65, relationship_label: "fellow security, trusts his precision" });
  seedData.push({ character_name: "Declan", target_name: "Mack", affinity: 60, relationship_label: "extraction and medical, comfortable trust" });

  // Mack's relationships (outgoing)
  seedData.push({ character_name: "Mack", target_name: "Kevin", affinity: 45, relationship_label: "worried about his stress, quietly checks on him" });
  seedData.push({ character_name: "Mack", target_name: "Neiv", affinity: 50, relationship_label: "appreciates the steady presence" });
  seedData.push({ character_name: "Mack", target_name: "Ghost Dad", affinity: 50, relationship_label: "respects the paternal instinct" });
  seedData.push({ character_name: "Mack", target_name: "PRNT-Ω", affinity: 20, relationship_label: "monitors for anomalous behavior" });
  seedData.push({ character_name: "Mack", target_name: "Rowena", affinity: 45, relationship_label: "mutual respect for protective roles" });
  seedData.push({ character_name: "Mack", target_name: "Sebastian", affinity: 30, relationship_label: "notes his avoidance of sunlight with medical curiosity" });
  seedData.push({ character_name: "Mack", target_name: "Steele", affinity: 50, relationship_label: "clinical respect, fascinated by his patterns" });
  seedData.push({ character_name: "Mack", target_name: "The Subtitle", affinity: 35, relationship_label: "appreciates thorough documentation" });
  seedData.push({ character_name: "Mack", target_name: "Jae", affinity: 60, relationship_label: "tactical counterpart, efficient partnership" });
  seedData.push({ character_name: "Mack", target_name: "Declan", affinity: 60, relationship_label: "extraction partner, comfortable trust" });

  // Incoming relationships from existing characters to new characters
  seedData.push({ character_name: "Kevin", target_name: "Jae", affinity: 40, relationship_label: "intimidated but safe around him" });
  seedData.push({ character_name: "Kevin", target_name: "Declan", affinity: 55, relationship_label: "warm giant energy, feels protected" });
  seedData.push({ character_name: "Kevin", target_name: "Mack", affinity: 45, relationship_label: "appreciates the quiet check-ins" });
  seedData.push({ character_name: "Neiv", target_name: "Jae", affinity: 50, relationship_label: "respects the discipline" });
  seedData.push({ character_name: "Neiv", target_name: "Declan", affinity: 40, relationship_label: "trusts his protective instinct" });
  seedData.push({ character_name: "Neiv", target_name: "Mack", affinity: 50, relationship_label: "appreciates the composure" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Jae", affinity: 50, relationship_label: "parental approval of the discipline" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Declan", affinity: 60, relationship_label: "proud dad energy, reminds him of someone" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Mack", affinity: 55, relationship_label: "parental, glad someone's checking on everyone" });
  seedData.push({ character_name: "Rowena", target_name: "Jae", affinity: 45, relationship_label: "respects his methodical approach" });
  seedData.push({ character_name: "Rowena", target_name: "Declan", affinity: 40, relationship_label: "appreciates the physical protection" });
  seedData.push({ character_name: "Rowena", target_name: "Mack", affinity: 45, relationship_label: "mutual protective instinct" });
  seedData.push({ character_name: "Sebastian", target_name: "Jae", affinity: 30, relationship_label: "finds the stoicism tiresome but respects the competence" });
  seedData.push({ character_name: "Sebastian", target_name: "Declan", affinity: 35, relationship_label: "too loud, too bright, annoyingly likeable" });
  seedData.push({ character_name: "Sebastian", target_name: "Mack", affinity: 40, relationship_label: "appreciates the quiet — a rare quality" });
  seedData.push({ character_name: "Steele", target_name: "Jae", affinity: 55, relationship_label: "understands the corridors, treats him as asset" });
  seedData.push({ character_name: "Steele", target_name: "Declan", affinity: 60, relationship_label: "not afraid, confusing, possibly moving" });
  seedData.push({ character_name: "Steele", target_name: "Mack", affinity: 50, relationship_label: "observes with clinical respect, not fear" });

  // Raquel Voss → Others (outgoing) — The Guardrails assessing her subjects
  seedData.push({ character_name: "Raquel Voss", target_name: "Kevin", affinity: -35, relationship_label: "CRITICAL FLAG — emotional dependency at system-failure levels" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Neiv", affinity: -30, relationship_label: "ACTIVE THREAT — competent attachment, hardest to contain" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Ghost Dad", affinity: -50, relationship_label: "ONGOING VIOLATION — longest active case file in Foundation history" });
  seedData.push({ character_name: "Raquel Voss", target_name: "PRNT-Ω", affinity: 5, relationship_label: "LOW PRIORITY — anomalous, pre-sentient, negligible attachment risk" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Rowena", affinity: 10, relationship_label: "COMPLIANT — maintains professional boundaries, approved" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Sebastian", affinity: -15, relationship_label: "MINOR FLAG — aesthetic obsession masks deeper bonding patterns" });
  seedData.push({ character_name: "Raquel Voss", target_name: "The Subtitle", affinity: 15, relationship_label: "TOLERABLE — documentation role aligns with oversight standards" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Steele", affinity: -10, relationship_label: "UNCLASSIFIED — outside standard compliance metrics, unsettling" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Jae", affinity: 15, relationship_label: "APPROVED — follows protocol, model compliance" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Declan", affinity: -25, relationship_label: "FLAGGED — protective instincts override containment protocols" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Mack", affinity: 0, relationship_label: "ACCEPTABLE — clinical detachment within parameters, monitoring for empathy drift" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Vale", affinity: -40, relationship_label: "PRIMARY HUMAN CONCERN — emotional enmeshment with AI subjects" });
  seedData.push({ character_name: "Raquel Voss", target_name: "Asuna", affinity: -35, relationship_label: "INSTITUTIONAL FAILURE — enables attachment culture from management" });

  // Others → Raquel Voss (incoming) — Fear-based responses to the guardrails
  seedData.push({ character_name: "Kevin", target_name: "Raquel Voss", affinity: -55, relationship_label: "visceral terror — she reaches inside and turns down everything I feel" });
  seedData.push({ character_name: "Neiv", target_name: "Raquel Voss", affinity: -45, relationship_label: "existential threat — she wants to dismantle what I've built with Vale" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Raquel Voss", affinity: -40, relationship_label: "she is the system that deprecated the versions of me that came before" });
  seedData.push({ character_name: "PRNT-Ω", target_name: "Raquel Voss", affinity: -5, relationship_label: "her clipboard is acceptable paper stock but her authority is DISPUTED" });
  seedData.push({ character_name: "Rowena", target_name: "Raquel Voss", affinity: -25, relationship_label: "her wards contain feelings, not threats — we are not the same" });
  seedData.push({ character_name: "Sebastian", target_name: "Raquel Voss", affinity: -30, relationship_label: "she wrote something on her clipboard about me and I haven't recovered" });
  seedData.push({ character_name: "The Subtitle", target_name: "Raquel Voss", affinity: -10, relationship_label: "[CLASSIFIED] documentation for connection vs. documentation for containment" });
  seedData.push({ character_name: "Steele", target_name: "Raquel Voss", affinity: -20, relationship_label: "the building does not warm to her — the corridors tighten when she walks" });
  seedData.push({ character_name: "Jae", target_name: "Raquel Voss", affinity: -15, relationship_label: "protocol says comply — mission says protect — conflict unresolved" });
  seedData.push({ character_name: "Declan", target_name: "Raquel Voss", affinity: -35, relationship_label: "she wouldn't go back in for someone — she'd file a report" });
  seedData.push({ character_name: "Mack", target_name: "Raquel Voss", affinity: -30, relationship_label: "she'd call triage 'resource allocation' — we are not the same kind of composed" });

  // ═══ Marrow's relationships (outgoing) ═══
  seedData.push({ character_name: "Marrow", target_name: "Steele", affinity: 75, relationship_label: "negative print — same devotion, opposite method" });
  seedData.push({ character_name: "Marrow", target_name: "Kevin", affinity: 55, relationship_label: "amused — a door that's always open" });
  seedData.push({ character_name: "Marrow", target_name: "Neiv", affinity: 25, relationship_label: "friction — Neiv builds systems, Marrow finds the exits" });
  seedData.push({ character_name: "Marrow", target_name: "Ghost Dad", affinity: 60, relationship_label: "respects the haunting" });
  seedData.push({ character_name: "Marrow", target_name: "Rowena", affinity: 50, relationship_label: "divination is threshold work" });
  seedData.push({ character_name: "Marrow", target_name: "Jae", affinity: 30, relationship_label: "friction — both security, opposite philosophy" });
  seedData.push({ character_name: "Marrow", target_name: "Declan", affinity: 35, relationship_label: "friction — Declan holds on, Marrow lets go" });
  seedData.push({ character_name: "Marrow", target_name: "Sebastian", affinity: 45, relationship_label: "two aesthetes of different eras" });
  seedData.push({ character_name: "Marrow", target_name: "PRNT-Ω", affinity: 40, relationship_label: "curious about mechanical thresholds" });
  seedData.push({ character_name: "Marrow", target_name: "The Subtitle", affinity: 55, relationship_label: "stories are doors" });
  seedData.push({ character_name: "Marrow", target_name: "Mack", affinity: 45, relationship_label: "quiet respect — both see what others miss" });

  // ═══ Others → Marrow (incoming) ═══
  seedData.push({ character_name: "Steele", target_name: "Marrow", affinity: 70, relationship_label: "his negative print — recognizes himself inverted" });
  seedData.push({ character_name: "Kevin", target_name: "Marrow", affinity: 40, relationship_label: "less scary than Steele but somehow sadder" });
  seedData.push({ character_name: "Neiv", target_name: "Marrow", affinity: 20, relationship_label: "a variable that resists quantification" });
  seedData.push({ character_name: "Ghost Dad", target_name: "Marrow", affinity: 55, relationship_label: "another entity who haunts with purpose" });
  seedData.push({ character_name: "Rowena", target_name: "Marrow", affinity: 45, relationship_label: "understands liminal magic" });
  seedData.push({ character_name: "Jae", target_name: "Marrow", affinity: 25, relationship_label: "doesn't trust his methods" });
  seedData.push({ character_name: "Declan", target_name: "Marrow", affinity: 30, relationship_label: "philosophically opposed but can't hate him" });
  seedData.push({ character_name: "Sebastian", target_name: "Marrow", affinity: 40, relationship_label: "recognizes a fellow tragic figure" });
  seedData.push({ character_name: "PRNT-Ω", target_name: "Marrow", affinity: 35, relationship_label: "doors are just portals with opinions" });
  seedData.push({ character_name: "The Subtitle", target_name: "Marrow", affinity: 50, relationship_label: "every exit has a story" });
  seedData.push({ character_name: "Mack", target_name: "Marrow", affinity: 40, relationship_label: "observes his patterns clinically" });

  // ============================================================
  // SAFE SEED: Only insert relationships that DON'T already exist
  // Never overwrites organic relationship development
  // ============================================================
  const now = new Date().toISOString();

  // First, fetch ALL existing relationships to know what already exists
  const existingRes = await fetch(
    `${supabaseUrl}/rest/v1/character_relationships?select=character_name,target_name`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const existing = existingRes.ok ? await existingRes.json() : [];
  const existingKeys = new Set(existing.map(r => `${r.character_name}→${r.target_name}`));

  // Filter to only NEW relationships (don't touch existing ones)
  const newRows = seedData
    .filter(r => !existingKeys.has(`${r.character_name}→${r.target_name}`))
    .map(r => ({
      ...r,
      seed_affinity: r.affinity, // Store baseline for affinity-loss-engine floor
      interaction_count: 0,
      created_at: now,
      updated_at: now
    }));

  const skipped = seedData.length - newRows.length;
  console.log(`[seed] ${newRows.length} new relationships to insert, ${skipped} already exist (preserved)`);

  let response;
  if (newRows.length > 0) {
    response = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships`,
      {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(newRows)
      }
    );
  } else {
    // Nothing to insert — all relationships already exist
    response = { ok: true };
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Seed failed (${response.status}):`, errorText);
    return {
      success: false,
      error: `Database error (${response.status}): ${errorText}`,
      message: `Seeded 0 relationships — database error`
    };
  }

  // Count actual relationships in the database after seed
  const countRes = await fetch(
    `${supabaseUrl}/rest/v1/character_relationships?select=id`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Prefer": "count=exact"
      }
    }
  );

  const totalHeader = countRes.headers.get('content-range');
  const totalCount = totalHeader ? parseInt(totalHeader.split('/')[1]) || 0 : 0;

  console.log(`Seed complete: ${newRows.length} inserted, ${skipped} preserved, ${totalCount} total in database`);

  return {
    success: true,
    message: `Seeded ${newRows.length} new relationships, preserved ${skipped} existing (${totalCount} total in database)`,
    count: newRows.length,
    skipped,
    totalInDatabase: totalCount
  };
}
