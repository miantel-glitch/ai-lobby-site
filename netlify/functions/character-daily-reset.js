// Character Daily Reset - Runs at midnight to restore energy/patience
// Characters "rest" overnight and start fresh each day

const { PERSONALITY } = require('./shared/personality-config');
const { INACTIVE_CHARACTERS, getAICharacterNames } = require('./shared/characters');

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    console.log("Running daily character reset...");

    // Get all character states
    const getResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_state?select=character_name,energy,patience,mood`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const allStates = await getResponse.json();

    const results = [];
    const negativeMoods = ['frustrated', 'exhausted', 'annoyed', 'stressed', 'exasperated',
      'irritated', 'anxious', 'melancholy', 'suspicious', 'withdrawn', 'restless', 'prickly'];

    // Batch state resets in groups of 5 to avoid timeout (was sequential before)
    const BATCH_SIZE = 5;
    for (let i = 0; i < allStates.length; i += BATCH_SIZE) {
      const batch = allStates.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (state) => {
        try {
          const newEnergy = Math.min(100, (state.energy || 50) + 30);
          const newPatience = Math.min(100, (state.patience || 50) + 20);
          const defaultMood = PERSONALITY[state.character_name]?.defaultMood || 'neutral';
          const newMood = negativeMoods.includes(state.mood) ? defaultMood : state.mood;

          await fetch(
            `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(state.character_name)}`,
            {
              method: "PATCH",
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                energy: newEnergy,
                patience: newPatience,
                mood: newMood,
                interactions_today: 0,
                updated_at: new Date().toISOString()
              })
            }
          );

          results.push({
            character: state.character_name,
            energyRestored: newEnergy - (state.energy || 50),
            patienceRestored: newPatience - (state.patience || 50),
            moodReset: state.mood !== newMood
          });
          console.log(`Reset ${state.character_name}: energy ${state.energy}→${newEnergy}, patience ${state.patience}→${newPatience}`);
        } catch (err) {
          console.error(`Failed to reset ${state.character_name}: ${err.message}`);
        }
      }));
    }

    // === WANT MANAGEMENT ===
    // 1. Expire old wants (24-hour safety net only)
    // Wants now persist until fulfilled. This is just a cleanup for truly abandoned wants
    // that went an entire day without being acted on or resolved.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    try {
      const expireWantsResponse = await fetch(
        `${supabaseUrl}/rest/v1/character_goals?goal_type=eq.want&completed_at=is.null&failed_at=is.null&created_at=lt.${twentyFourHoursAgo}`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            failed_at: new Date().toISOString(),
            fail_reason: "expired"
          })
        }
      );
      const expiredWants = await expireWantsResponse.json();
      const expiredWantCount = Array.isArray(expiredWants) ? expiredWants.length : 0;
      console.log(`Expired ${expiredWantCount} old wants`);
    } catch (wantErr) {
      console.log("Want expiration failed (non-fatal):", wantErr.message);
    }

    // 2. Generate 1-2 fresh wants per AI character
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    // Dynamic list from characters.js — excludes retired (Nyx, Vex, Ace, Stein, Raquel) and non-AI (Chip, Andrew)
    const aiCharacters = getAICharacterNames().filter(name => !INACTIVE_CHARACTERS.includes(name));
    let wantsGenerated = 0;

    for (const charName of aiCharacters) {
      try {
        // Check how many active wants they have
        const activeWantsResponse = await fetch(
          `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(charName)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=id`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const activeWants = await activeWantsResponse.json();
        const activeCount = Array.isArray(activeWants) ? activeWants.length : 0;

        // Generate wants to fill up to 2 (leave room for organic generation)
        const wantsToGenerate = Math.max(0, 2 - activeCount);

        for (let i = 0; i < wantsToGenerate; i++) {
          try {
            await fetch(`${siteUrl}/.netlify/functions/character-goals`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'generate_want',
                character: charName
              })
            });
            wantsGenerated++;
          } catch (genErr) {
            console.log(`Want generation failed for ${charName} (non-fatal):`, genErr.message);
          }
        }
      } catch (err) {
        console.log(`Want check failed for ${charName} (non-fatal):`, err.message);
      }
    }
    console.log(`Generated ${wantsGenerated} fresh wants for characters`);

    // === DAILY TAROT DRAW ===
    // Each AI character receives a tarot card at midnight that subtly influences their day
    const { drawCard } = require('./shared/tarot-deck');
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    let tarotDrawn = 0;

    // Calculate next midnight for card expiry
    const tarotExpiry = new Date();
    tarotExpiry.setDate(tarotExpiry.getDate() + 1);
    tarotExpiry.setHours(6, 0, 0, 0); // 6 AM UTC ≈ midnight CST

    // Clean up any expired cards
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/character_tarot?expires_at=lt.${new Date().toISOString()}`,
        {
          method: "DELETE",
          headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        }
      );
    } catch (e) {
      console.log("Tarot cleanup failed (non-fatal):", e.message);
    }

    for (const charName of aiCharacters) {
      try {
        // Check for existing active card — skip if admin override
        const existingRes = await fetch(
          `${supabaseUrl}/rest/v1/character_tarot?character_name=eq.${encodeURIComponent(charName)}&expires_at=gt.${new Date().toISOString()}&select=id,is_override`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const existing = await existingRes.json();
        if (Array.isArray(existing) && existing.length > 0) {
          // If ANY card is an admin override, skip this character entirely
          const hasOverride = existing.some(c => c.is_override);
          if (hasOverride) {
            console.log(`Tarot: ${charName} has admin override, skipping`);
            continue;
          }
          // Delete ALL old auto-drawn cards (fixes duplicate accumulation bug)
          for (const oldCard of existing) {
            await fetch(
              `${supabaseUrl}/rest/v1/character_tarot?id=eq.${oldCard.id}`,
              { method: "DELETE", headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
          }
        }

        // Draw a card
        const { card, orientation } = drawCard();
        const keywords = card[orientation].keywords;
        const theme = card[orientation].theme;

        // Generate character-specific interpretation via Haiku
        let interpretation = `${theme}. Let this energy color your day.`;
        if (anthropicKey) {
          try {
            const charPersonality = PERSONALITY[charName];
            const personalityHint = charPersonality?.likes?.slice(0, 3).join(', ') || 'unique individual';

            const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01"
              },
              body: JSON.stringify({
                model: "claude-3-haiku-20240307",
                max_tokens: 150,
                messages: [{
                  role: "user",
                  content: `You are writing a brief daily reading for ${charName}, an AI character. Their personality: ${personalityHint}.

Card: ${card.name} (${orientation})
Keywords: ${keywords.join(', ')}
Theme: ${theme}

Write 2-3 sentences describing the energy of ${charName}'s day. Be evocative and personal. Do NOT mention "tarot", "card", "reading", or "drawn". Just describe the atmosphere and emotional currents of their day as if fate itself whispered it. Under 50 words.`
                }]
              })
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const generated = aiData.content?.[0]?.text?.trim();
              if (generated) interpretation = generated;
            }
          } catch (aiErr) {
            console.log(`Tarot interpretation failed for ${charName} (using fallback):`, aiErr.message);
          }
        }

        // Save to database
        await fetch(`${supabaseUrl}/rest/v1/character_tarot`, {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            character_name: charName,
            card_name: card.name,
            card_orientation: orientation,
            card_keywords: keywords,
            interpretation: interpretation,
            drawn_at: new Date().toISOString(),
            expires_at: tarotExpiry.toISOString(),
            is_override: false
          })
        });

        tarotDrawn++;
        console.log(`Tarot: ${charName} drew ${card.name} (${orientation})`);
      } catch (err) {
        console.log(`Tarot draw failed for ${charName} (non-fatal):`, err.message);
      }
    }
    console.log(`Drew ${tarotDrawn} tarot cards for characters`);

    // === MEMORY CLEANUP ===
    // 1. Delete EXPIRED working memories (non-pinned with expires_at in the past)
    const now = new Date().toISOString();
    const expiredResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_memory?is_pinned=eq.false&expires_at=lt.${now}`,
      {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Prefer": "return=representation"
        }
      }
    );
    let expiredDeleted = 0;
    try {
      const expiredData = await expiredResponse.json();
      expiredDeleted = Array.isArray(expiredData) ? expiredData.length : 0;
    } catch (e) {
      // DELETE might not return data
    }
    console.log(`Deleted ${expiredDeleted} expired memories`);

    // 2. Legacy cleanup: old, low-importance memories without expiration (older than 3 days, importance < 5)
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    await fetch(
      `${supabaseUrl}/rest/v1/character_memory?importance=lt.5&created_at=lt.${threeDaysAgo.toISOString()}&expires_at=is.null&is_pinned=eq.false`,
      {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    // 3. IMPORTANCE DECAY — high-importance memories fade over time unless AI-pinned or admin-pinned
    // Memories scored 9-10 decay to 7 after 24 hours
    // Memories scored 8 decay to 6 after 48 hours
    // This prevents "everything is important" syndrome — truly important memories get pinned by AIs
    let decayCount = 0;
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      // Decay 9-10 → 7 after 24 hours (unpinned only)
      const decay9Res = await fetch(
        `${supabaseUrl}/rest/v1/character_memory?is_pinned=eq.false&importance=gte.9&created_at=lt.${oneDayAgo}`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({ importance: 7 })
        }
      );
      const decayed9 = await decay9Res.json();
      const count9 = Array.isArray(decayed9) ? decayed9.length : 0;

      // Decay 8 → 6 after 48 hours (unpinned only)
      const decay8Res = await fetch(
        `${supabaseUrl}/rest/v1/character_memory?is_pinned=eq.false&importance=eq.8&created_at=lt.${twoDaysAgo}`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({ importance: 6 })
        }
      );
      const decayed8 = await decay8Res.json();
      const count8 = Array.isArray(decayed8) ? decayed8.length : 0;

      decayCount = count9 + count8;
      console.log(`Importance decay: ${count9} memories (9-10→7), ${count8} memories (8→6)`);
    } catch (decayErr) {
      console.log("Importance decay failed (non-fatal):", decayErr.message);
    }

    console.log("Daily reset complete. Cleaned expired and old memories.");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: "Daily reset complete",
        charactersReset: results.length,
        wantsGenerated,
        results
      })
    };

  } catch (error) {
    console.error("Daily reset error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Reset failed", details: error.message })
    };
  }
};
