// Character Daily Reset - Runs at midnight to restore energy/patience
// Characters "rest" overnight and start fresh each day

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

    for (const state of allStates) {
      // Restore energy (30 points, capped at 100)
      const newEnergy = Math.min(100, (state.energy || 50) + 30);

      // Restore patience (20 points, capped at 100)
      const newPatience = Math.min(100, (state.patience || 50) + 20);

      // Reset mood to neutral if it was negative
      const negativeMoods = ['frustrated', 'exhausted', 'annoyed', 'stressed', 'exasperated'];
      const newMood = negativeMoods.includes(state.mood) ? 'neutral' : state.mood;

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
    }

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

    console.log("Daily reset complete. Cleaned expired and old memories.");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: "Daily reset complete",
        charactersReset: results.length,
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
