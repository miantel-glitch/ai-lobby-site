// Break Room - Where exhausted characters go to recover
// Provides recovery activities that restore energy and patience

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
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

  try {
    // GET - Check who's in the break room / needs a break
    if (event.httpMethod === "GET") {
      // Get all character states
      const response = await fetch(
        `${supabaseUrl}/rest/v1/character_state?select=*`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const states = await response.json();

      // Categorize characters
      const exhausted = states.filter(s => s.energy === 0);
      const done = states.filter(s => s.patience === 0);
      const needsBreak = states.filter(s => s.energy <= 20 || s.patience <= 20);
      const inBreakRoom = states.filter(s => s.current_focus === 'break_room');

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          exhausted,
          done,
          needsBreak,
          inBreakRoom,
          allStates: states
        })
      };
    }

    // POST - Perform a break room activity
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action, character, targetCharacter } = body;

      // Define recovery activities
      const activities = {
        "take_nap": {
          energy: 40,
          patience: 10,
          mood: "rested",
          message: "took a nap in the break room",
          duration: "a quick power nap"
        },
        "coffee_break": {
          energy: 25,
          patience: 5,
          mood: "caffeinated",
          message: "grabbed some coffee",
          duration: "a coffee break"
        },
        "snack_time": {
          energy: 15,
          patience: 15,
          mood: "content",
          message: "had a snack",
          duration: "snack time"
        },
        "deep_breath": {
          energy: 5,
          patience: 30,
          mood: "centered",
          message: "took some deep breaths",
          duration: "a moment to breathe"
        },
        "vent_session": {
          energy: -5,
          patience: 40,
          mood: "relieved",
          message: "vented about the day",
          duration: "a venting session"
        },
        "pet_the_void": {
          energy: 10,
          patience: 20,
          mood: "comforted",
          message: "stared into the void (the void stared back, comfortingly)",
          duration: "some quality void time"
        },
        "check_on_friend": {
          energy: -5,
          patience: 10,
          mood: "caring",
          message: `checked on ${targetCharacter}`,
          duration: "a supportive visit",
          affectsTarget: true,
          targetBonus: { energy: 15, patience: 20, mood: "supported" }
        },
        "existential_acceptance": {
          energy: 20,
          patience: 25,
          mood: "philosophical",
          message: "accepted that chaos is the natural state of the office",
          duration: "some existential reflection"
        }
      };

      const activity = activities[action];
      if (!activity) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Unknown activity", available: Object.keys(activities) })
        };
      }

      // Get current state
      const getResponse = await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character)}&select=*`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const currentState = await getResponse.json();

      if (!currentState || currentState.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "Character not found" })
        };
      }

      const state = currentState[0];

      // COOLDOWN CHECK: 5-minute global cooldown between ANY activities
      const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
      if (state.last_activity_at) {
        const lastActivity = new Date(state.last_activity_at);
        const now = new Date();
        const timeSinceActivity = now.getTime() - lastActivity.getTime();

        if (timeSinceActivity < COOLDOWN_MS) {
          const remainingMs = COOLDOWN_MS - timeSinceActivity;
          const remainingSeconds = Math.ceil(remainingMs / 1000);
          const remainingMinutes = Math.floor(remainingSeconds / 60);
          const remainingSecs = remainingSeconds % 60;

          return {
            statusCode: 429, // Too Many Requests
            headers,
            body: JSON.stringify({
              success: false,
              error: "cooldown",
              message: `${character} needs to rest before another activity`,
              cooldownRemaining: remainingMs,
              cooldownDisplay: remainingMinutes > 0
                ? `${remainingMinutes}m ${remainingSecs}s`
                : `${remainingSecs}s`
            })
          };
        }
      }

      // Apply recovery
      const newEnergy = Math.max(0, Math.min(100, state.energy + activity.energy));
      const newPatience = Math.max(0, Math.min(100, state.patience + activity.patience));

      // Human characters stay in the breakroom after activities — only AIs auto-return to floor
      const HUMAN_CHARACTERS = ['Vale', 'Asuna', 'Gatik'];
      const isHuman = HUMAN_CHARACTERS.includes(character);

      const stateUpdate = {
        energy: newEnergy,
        patience: newPatience,
        mood: activity.mood,
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString() // Track for cooldown
      };

      // Only send AI characters back to the floor — humans can stay as long as they want
      if (!isHuman) {
        stateUpdate.current_focus = 'the_floor';
      }

      await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character)}`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(stateUpdate)
        }
      );

      // If this activity affects another character (like checking on a friend)
      if (activity.affectsTarget && targetCharacter) {
        const targetResponse = await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(targetCharacter)}&select=*`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const targetState = await targetResponse.json();

        if (targetState && targetState[0]) {
          const ts = targetState[0];
          await fetch(
            `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(targetCharacter)}`,
            {
              method: "PATCH",
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                energy: Math.min(100, ts.energy + activity.targetBonus.energy),
                patience: Math.min(100, ts.patience + activity.targetBonus.patience),
                mood: activity.targetBonus.mood,
                updated_at: new Date().toISOString()
              })
            }
          );
        }
      }

      // Create a memory of this recovery moment (expires in 1 hour - routine activity)
      const memoryExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await fetch(
        `${supabaseUrl}/rest/v1/character_memory`,
        {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            character_name: character,
            memory_type: "break_room",
            content: `Took ${activity.duration} in the break room. ${activity.message}. Feeling ${activity.mood} now.`,
            importance: 3,
            created_at: new Date().toISOString(),
            is_pinned: false,
            memory_tier: 'working',
            expires_at: memoryExpiresAt.toISOString()
          })
        }
      );

      // Post to chat if we want this visible
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      await fetch(`${siteUrl}/.netlify/functions/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee: "The Narrator",
          content: `*${character} ${activity.message}.*`,
          isEmote: true
        })
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          character,
          activity: action,
          message: activity.message,
          newState: {
            energy: newEnergy,
            patience: newPatience,
            mood: activity.mood
          },
          recovery: {
            energy: `+${activity.energy}`,
            patience: `+${activity.patience}`
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
    console.error("Break room error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};
