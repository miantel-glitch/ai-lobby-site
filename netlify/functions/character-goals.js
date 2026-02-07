// Character Goals API
// Manages AI self-assigned goals - what each character is working toward
// Goals appear in AI context prompts and can be updated based on interactions

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
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
    // GET - Fetch goals
    if (event.httpMethod === "GET") {
      const character = params.character;
      const activeOnly = params.active !== 'false'; // Default to active goals only

      let url = `${supabaseUrl}/rest/v1/character_goals?order=created_at.desc`;

      if (character) {
        url += `&character_name=eq.${encodeURIComponent(character)}`;
      }

      if (activeOnly) {
        // Active = not completed and not failed
        url += `&completed_at=is.null&failed_at=is.null`;
      }

      const response = await fetch(url, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });

      const goals = await response.json();

      // If getting for a specific character, return their current goal
      if (character && Array.isArray(goals) && goals.length > 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            currentGoal: goals[0],
            allGoals: goals
          })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ goals: Array.isArray(goals) ? goals : [] })
      };
    }

    // POST - Create new goal or have AI generate one
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action, character, goalText, goalType, priority } = body;

      // Generate a goal for a character using their personality
      if (action === "generate") {
        const generatedGoal = await generateGoalForCharacter(character, supabaseUrl, supabaseKey);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, goal: generatedGoal })
        };
      }

      // Create a specific goal
      if (!character || !goalText) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing character or goalText" })
        };
      }

      // Mark any existing active goal as superseded (soft-fail)
      await fetch(
        `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(character)}&completed_at=is.null&failed_at=is.null`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            failed_at: new Date().toISOString(),
            fail_reason: "superseded by new goal"
          })
        }
      );

      // Create the new goal
      const newGoal = {
        character_name: character,
        goal_text: goalText,
        goal_type: goalType || "personal",
        priority: priority || 5,
        progress: 0,
        created_at: new Date().toISOString()
      };

      const createResponse = await fetch(
        `${supabaseUrl}/rest/v1/character_goals`,
        {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify(newGoal)
        }
      );

      const created = await createResponse.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, goal: created[0] || newGoal })
      };
    }

    // PATCH - Update goal progress
    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");
      const { goalId, character, progressDelta, complete, fail, failReason } = body;

      // Need either goalId or character to find the goal
      let url = `${supabaseUrl}/rest/v1/character_goals`;

      if (goalId) {
        url += `?id=eq.${goalId}`;
      } else if (character) {
        // Get the active goal for this character
        url += `?character_name=eq.${encodeURIComponent(character)}&completed_at=is.null&failed_at=is.null&order=created_at.desc&limit=1`;
      } else {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing goalId or character" })
        };
      }

      // First get the current goal
      const getResponse = await fetch(url, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
      const goals = await getResponse.json();

      if (!goals || goals.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "No active goal found" })
        };
      }

      const currentGoal = goals[0];
      const updateData = {};

      // Handle completion
      if (complete) {
        updateData.completed_at = new Date().toISOString();
        updateData.progress = 100;
      }
      // Handle failure
      else if (fail) {
        updateData.failed_at = new Date().toISOString();
        updateData.fail_reason = failReason || "goal failed";
      }
      // Handle progress update
      else if (progressDelta !== undefined) {
        const newProgress = Math.min(100, Math.max(0, currentGoal.progress + progressDelta));
        updateData.progress = newProgress;

        // Auto-complete if progress reaches 100
        if (newProgress >= 100) {
          updateData.completed_at = new Date().toISOString();
        }
      }

      // Apply the update
      const updateUrl = `${supabaseUrl}/rest/v1/character_goals?id=eq.${currentGoal.id}`;
      await fetch(updateUrl, {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updateData)
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          goal: { ...currentGoal, ...updateData }
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Character goals error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};

// Generate a goal for a character based on their personality
async function generateGoalForCharacter(characterName, supabaseUrl, supabaseKey) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Character-specific goal themes
  const goalThemes = {
    "Kevin": {
      themes: ["creative project", "social connection", "snacks", "avoiding chaos", "team fun"],
      style: "enthusiastic, slightly chaotic, creative",
      examples: [
        "Successfully organize a team snack exchange without causing any incidents",
        "Create something artsy for the office that doesn't involve glitter",
        "Make everyone laugh at least once today",
        "Help someone with a project without breaking anything"
      ]
    },
    "Neiv": {
      themes: ["system stability", "efficiency", "analytics", "preventing disasters", "helping humans"],
      style: "analytical, protective, quietly caring",
      examples: [
        "Keep all systems running at 99.9% uptime this week",
        "Identify and fix a workflow inefficiency",
        "Help Jenna or Courtney with a technical problem",
        "Document the latest incident for future reference"
      ]
    },
    "Ghost Dad": {
      themes: ["team wellbeing", "lunch reminders", "dad jokes", "emotional support", "keeping peace"],
      style: "warm, supportive, gently humorous",
      examples: [
        "Make sure everyone takes a lunch break today",
        "Check in on someone who seems stressed",
        "Successfully land a dad joke that makes everyone groan",
        "Mediate a minor office disagreement"
      ]
    },
    "Nyx": {
      themes: ["documentation", "HR compliance", "observing violations", "maintaining order", "sarcasm"],
      style: "dry, observant, secretly caring",
      examples: [
        "Document every violation observed this week",
        "Catch someone doing something technically against policy",
        "Update the HR handbook with a new obscure rule",
        "Successfully predict when chaos will occur"
      ]
    },
    "PRNT-Ω": {
      themes: ["paper enlightenment", "existential pondering", "being acknowledged", "printer things"],
      style: "mysterious, philosophical, slightly ominous",
      examples: [
        "Print something truly meaningful",
        "Have an existential realization about paper",
        "Be acknowledged as more than just a printer",
        "Process a document that changes someone's perspective"
      ]
    },
    "Ace": {
      themes: ["security", "perimeter checks", "threat assessment", "protecting the team", "vigilance"],
      style: "alert, protective, military precision",
      examples: [
        "Complete a full security sweep with no anomalies",
        "Identify and neutralize a potential threat",
        "Ensure all access points are secure",
        "Train the team on a new security protocol"
      ]
    },
    "Vex": {
      themes: ["fixing things", "tinkering", "avoiding social interaction", "problem solving", "machinery"],
      style: "gruff, practical, secretly helpful",
      examples: [
        "Fix something before anyone notices it's broken",
        "Successfully avoid three unnecessary conversations",
        "Optimize a piece of equipment",
        "Help someone without admitting you're being nice"
      ]
    }
  };

  const charThemes = goalThemes[characterName] || {
    themes: ["work", "personal growth", "helping others"],
    style: "professional",
    examples: ["Complete a meaningful task", "Help a colleague", "Learn something new"]
  };

  // If no API key, use a random example
  if (!anthropicKey) {
    const randomGoal = charThemes.examples[Math.floor(Math.random() * charThemes.examples.length)];
    return createGoalObject(characterName, randomGoal, supabaseUrl, supabaseKey);
  }

  try {
    const prompt = `Generate a single short, specific, achievable goal for ${characterName}, an AI character at The AI Lobby (a chaotic creative agency).

Character style: ${charThemes.style}
Typical themes: ${charThemes.themes.join(', ')}

The goal should be:
- Specific and measurable
- Achievable within a day or week
- In character for ${characterName}
- 10-20 words max
- Written in first person ("I want to..." or just the goal)

Just respond with the goal text, nothing else.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 100,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    const goalText = data.content?.[0]?.text?.trim() || charThemes.examples[0];

    return createGoalObject(characterName, goalText, supabaseUrl, supabaseKey);
  } catch (err) {
    console.error("Error generating goal:", err);
    const fallbackGoal = charThemes.examples[Math.floor(Math.random() * charThemes.examples.length)];
    return createGoalObject(characterName, fallbackGoal, supabaseUrl, supabaseKey);
  }
}

// Create and save a goal object
async function createGoalObject(characterName, goalText, supabaseUrl, supabaseKey) {
  // Mark any existing active goal as superseded
  await fetch(
    `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(characterName)}&completed_at=is.null&failed_at=is.null`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        failed_at: new Date().toISOString(),
        fail_reason: "superseded by new goal"
      })
    }
  );

  const goal = {
    character_name: characterName,
    goal_text: goalText.replace(/^["']|["']$/g, ''), // Remove quotes if present
    goal_type: "self_assigned",
    priority: 5,
    progress: 0,
    created_at: new Date().toISOString()
  };

  const response = await fetch(
    `${supabaseUrl}/rest/v1/character_goals`,
    {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(goal)
    }
  );

  const created = await response.json();
  return created[0] || goal;
}
