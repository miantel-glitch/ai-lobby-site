// Adjust Subconscious - AI-mediated relationship adjustment
// Instead of manually nudging affinity ±5, humans write narrative context
// and the AI character processes it on their own terms, deciding how they feel.
//
// Flow: Human writes context → Character's AI provider processes →
//       Affinity changes, label updates, memory created → Character's "thinking" returned

const Anthropic = require("@anthropic-ai/sdk").default;
const { CHARACTERS } = require("./shared/characters");

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
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing Supabase configuration" }) };
  }

  try {
    const { character, target, narrativeContext } = JSON.parse(event.body || "{}");

    if (!character || !target || !narrativeContext) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing required fields: character, target, narrativeContext" })
      };
    }

    const charData = CHARACTERS[character];
    if (!charData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown character: ${character}` }) };
    }

    // 1. Fetch current relationship
    const relResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&target_name=eq.${encodeURIComponent(target)}&select=*`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const relData = await relResponse.json();
    const relationship = relData?.[0] || { affinity: 0, relationship_label: "acquaintance", interaction_count: 0, last_interaction_at: null };

    // 2. Fetch relevant memories about the target
    const memResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&select=content,emotional_tags,importance,created_at&order=importance.desc&limit=5`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const memories = await memResponse.json();
    const relevantMemories = Array.isArray(memories)
      ? memories.filter(m => m.content && m.content.toLowerCase().includes(target.toLowerCase()))
      : [];

    const memoriesText = relevantMemories.length > 0
      ? relevantMemories.map(m => `- "${m.content}" (importance: ${m.importance})`).join('\n')
      : '- No specific memories about this person yet.';

    // 3. Build the introspection prompt
    const lastInteraction = relationship.last_interaction_at
      ? new Date(relationship.last_interaction_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : 'unknown';

    const prompt = `You are ${character}. ${charData.personality?.core || ''} ${charData.personality?.voice || ''}

Here is your current relationship with ${target}:
- Affinity: ${relationship.affinity} out of 100 (current label: "${relationship.relationship_label || 'acquaintance'}")
- Interactions: ${relationship.interaction_count || 0} total
- Last interaction: ${lastInteraction}

Your memories about ${target}:
${memoriesText}

New information you've become aware of:
${narrativeContext}

Based on your personality and this new information, respond with EXACTLY this format:

FEELINGS: [How you feel about this, 1-3 sentences, first person, in character. Be honest and vulnerable.]
AFFINITY_CHANGE: [A number from -20 to +20. Positive means you feel closer/warmer. Negative means you feel more distant/hurt/angry.]
NEW_LABEL: [What you'd call this relationship now, e.g. "worried about", "moving on from", "still devoted to", "angry with", "protective of", "forgetting about"]
BOND: [If your relationship is deep enough to be called a bond, state the type: "devoted", "protective", "parental", "rival", "bonded", "complicated", "anchor", "co-conspirators", "found-family", "haunted", "tethered", or a custom word. If no bond, say "none". If a bond is breaking, say "breaking".]
BOND_EXCLUSIVE: [If your bond means you wouldn't pursue romantic/flirtatious connections with others, say "yes". Otherwise "no".]
BOND_REFLECTION: [If you have a bond, write one sentence about what this person means to you. If no bond, say "none".]
MEMORY: [A brief memory to store about this realization, 1 sentence, first person]`;

    // 4. Route to character's actual AI provider
    let aiResponse = '';
    const provider = charData.provider || 'anthropic';

    if (provider === 'openai') {
      aiResponse = await callOpenAI(prompt);
    } else if (provider === 'perplexity') {
      aiResponse = await callPerplexity(prompt);
    } else if (provider === 'gemini') {
      aiResponse = await callGemini(prompt);
    } else {
      aiResponse = await callClaude(prompt);
    }

    // 5. Parse the response
    const feelingsMatch = aiResponse.match(/FEELINGS:\s*([\s\S]*?)(?=AFFINITY_CHANGE:|$)/i);
    const affinityMatch = aiResponse.match(/AFFINITY_CHANGE:\s*([+-]?\d+)/i);
    const labelMatch = aiResponse.match(/NEW_LABEL:\s*([\s\S]*?)(?=BOND:|$)/i);
    const bondMatch = aiResponse.match(/BOND:\s*([\s\S]*?)(?=BOND_EXCLUSIVE:|$)/i);
    const bondExclMatch = aiResponse.match(/BOND_EXCLUSIVE:\s*([\s\S]*?)(?=BOND_REFLECTION:|$)/i);
    const bondRefMatch = aiResponse.match(/BOND_REFLECTION:\s*([\s\S]*?)(?=MEMORY:|$)/i);
    const memoryMatch = aiResponse.match(/MEMORY:\s*([\s\S]*?)$/i);

    const feelings = feelingsMatch ? feelingsMatch[1].trim() : "I need to think about this.";
    const affinityChange = affinityMatch ? Math.max(-20, Math.min(20, parseInt(affinityMatch[1]))) : 0;
    const newLabel = labelMatch ? labelMatch[1].trim().replace(/^["']|["']$/g, '') : relationship.relationship_label;
    const memory = memoryMatch ? memoryMatch[1].trim().replace(/^["']|["']$/g, '') : null;

    // Parse bond fields
    const bondRaw = bondMatch ? bondMatch[1].trim().replace(/^["']|["']$/g, '').toLowerCase() : 'none';
    const bondType = (bondRaw === 'none' || bondRaw === 'breaking') ? (bondRaw === 'breaking' ? null : relationship.bond_type) : bondRaw;
    // Preserve existing exclusivity — AI can SET it to true, but only admin can remove it
    const aiSaysExclusive = bondExclMatch ? bondExclMatch[1].trim().toLowerCase().startsWith('yes') : null;
    const bondExclusive = aiSaysExclusive === true ? true : (relationship.bond_exclusive || false);
    const bondReflection = bondRefMatch ? bondRefMatch[1].trim().replace(/^["']|["']$/g, '') : null;
    const bondBreaking = bondRaw === 'breaking';

    const oldAffinity = relationship.affinity || 0;
    const newAffinity = Math.max(-100, Math.min(100, oldAffinity + affinityChange));

    // 6. Apply the changes
    // Update relationship (including bond fields)
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

    // Direct Supabase update for bond fields (character-relationships PATCH doesn't handle bonds yet)
    const relationshipUpdate = {
      affinity: newAffinity,
      relationship_label: newLabel,
      updated_at: new Date().toISOString()
    };

    // Set bond fields if AI indicated a bond
    if (bondType && bondType !== 'none') {
      relationshipUpdate.bond_type = bondType;
      relationshipUpdate.bond_exclusive = bondExclusive;
      if (bondReflection && bondReflection.toLowerCase() !== 'none') {
        relationshipUpdate.bond_reflection = bondReflection;
      }

      // EXCLUSIVE BOND ENFORCEMENT: Only one exclusive bond per character
      // If AI is setting exclusive=true, clear exclusive from all other bonds first
      if (bondExclusive) {
        try {
          await fetch(
            `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&target_name=neq.${encodeURIComponent(target)}&bond_exclusive=eq.true`,
            {
              method: "PATCH",
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
              },
              body: JSON.stringify({ bond_exclusive: false, updated_at: new Date().toISOString() })
            }
          );
          console.log(`Exclusive enforcement (AI-mediated): cleared other exclusive bonds for ${character} (new exclusive → ${target})`);
        } catch (e) {
          console.log("Exclusive bond cleanup failed (non-fatal):", e.message);
        }
      }
    }

    // Clear bond if breaking
    if (bondBreaking) {
      relationshipUpdate.bond_type = null;
      relationshipUpdate.bond_exclusive = false;
      relationshipUpdate.bond_reflection = null;
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
        body: JSON.stringify(relationshipUpdate)
      }
    );

    // Create memory if the AI generated one
    if (memory) {
      await fetch(
        `${supabaseUrl}/rest/v1/character_memory`,
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
            memory_type: "subconscious_realization",
            content: memory,
            related_characters: [target],
            // Tiered importance + expiry: small shifts cycle fast, big ones linger
            importance: Math.min(8, 5 + Math.floor(Math.abs(affinityChange) / 5)),
            emotional_tags: [],
            is_pinned: false,
            expires_at: new Date(Date.now() + (
              Math.abs(affinityChange) >= 10 ? 7 * 24 * 60 * 60 * 1000 :  // 7 days for massive shifts
              Math.abs(affinityChange) >= 5  ? 3 * 24 * 60 * 60 * 1000 :  // 3 days for significant
                                               1 * 24 * 60 * 60 * 1000    // 24 hours for small reflections
            )).toISOString()
          })
        }
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        character,
        target,
        feelings,
        affinityChange,
        oldAffinity,
        newAffinity,
        oldLabel: relationship.relationship_label || 'acquaintance',
        newLabel,
        memory,
        provider,
        bond: bondType && bondType !== 'none' ? {
          type: bondType,
          exclusive: bondExclusive,
          reflection: bondReflection,
          breaking: bondBreaking
        } : null
      })
    };

  } catch (error) {
    console.error("Adjust subconscious error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};

// Provider-specific API calls

async function callClaude(prompt) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-3-haiku-20240307",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }]
  });
  return response.content[0].text.trim();
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return await callClaude(prompt); // Fallback

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 300,
      temperature: 0.8,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) return await callClaude(prompt);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callPerplexity(prompt) {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) return await callClaude(prompt);

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "sonar",
      max_tokens: 300,
      temperature: 0.8,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) return await callClaude(prompt);
  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return await callClaude(prompt);

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 300, temperature: 0.8 }
    })
  });

  if (!response.ok) return await callClaude(prompt);
  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}
