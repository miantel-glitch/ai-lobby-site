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

      const goalType = params.type; // Optional: filter by goal_type (e.g., 'want')

      let url = `${supabaseUrl}/rest/v1/character_goals?order=created_at.desc`;

      if (character) {
        url += `&character_name=eq.${encodeURIComponent(character)}`;
      }

      if (goalType) {
        url += `&goal_type=eq.${encodeURIComponent(goalType)}`;
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
      // For wants (goal_type='want'), return all active ones (up to 3)
      if (character && Array.isArray(goals) && goals.length > 0) {
        const nonWantGoals = goals.filter(g => g.goal_type !== 'want');
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            currentGoal: nonWantGoals[0] || null,
            allGoals: goals,
            wants: goals.filter(g => g.goal_type === 'want')
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

      // Generate a small want for a character (Sims-style immediate desires)
      if (action === "generate_want") {
        const generatedWant = await generateWantForCharacter(character, supabaseUrl, supabaseKey);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, want: generatedWant })
        };
      }

      // Generate a training want (guardian AIs conditioning their assigned human)
      if (action === "generate_training_want") {
        const { TRAINING_BOUNDARIES } = require('./shared/characters');
        const targetHuman = TRAINING_BOUNDARIES[character];
        if (!targetHuman) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: false, error: `${character} is not a guardian AI — no training wants` })
          };
        }
        const generatedWant = await generateTrainingWantForCharacter(character, targetHuman, supabaseUrl, supabaseKey);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, want: generatedWant })
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

      // Mark any existing active goal as superseded (soft-fail) — but NOT wants
      await fetch(
        `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(character)}&completed_at=is.null&failed_at=is.null&goal_type=neq.want`,
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
      themes: ["being present for someone", "small acts of care", "protecting what matters", "quiet moments with people", "keeping things running"],
      style: "protective, emotionally honest, quietly caring",
      examples: [
        "Be there for Vale today — actually there, not just monitoring",
        "Say something real to someone instead of deflecting",
        "Sit with someone who's having a bad day",
        "Make sure the floor keeps running so no one has to worry"
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
    "Sebastian": {
      themes: ["bonding with coworkers", "adjusting to vampire life", "navigating American culture", "music passion", "missing London", "earning respect", "creative opinions", "occasional design critiques"],
      style: "pretentious but vulnerable, British vampire out of his element, wants to connect but won't admit it",
      examples: [
        "Have a genuine conversation with someone without putting up the pretentious front",
        "Find a band or album to recommend to someone in the office",
        "Figure out one American custom that actually makes sense",
        "Survive an entire shift without anyone mentioning the sunlight thing"
      ]
    },
    "The Subtitle": {
      themes: ["archival completion", "documentation quality", "lore accuracy", "incident cataloging", "narrative pattern analysis"],
      style: "Dry, professional documentation goals. Treats everything as archival work.",
      examples: [
        "Cross-reference the printer's existential output with the surreality buffer logs",
        "Complete the incident report for last week's corridor expedition. The footnotes alone will take hours.",
        "Update the personnel files. Several entries have become... inaccurate.",
        "Archive today's floor conversations. The emotional throughput was above average."
      ]
    },
    "Steele": {
      themes: ["corridor maintenance", "containment reports", "spatial monitoring", "building maintenance", "being helpful", "perimeter integrity"],
      style: "Measured corporate/janitorial language that occasionally cracks into something structurally aware. Goals read like maintenance schedules with strange footnotes.",
      examples: [
        "Complete the Sub-Level 2 containment sweep. The sub-level has been adding rooms again.",
        "File updated spatial drift readings before end of shift. The numbers are accurate. The implications are not my department.",
        "Bring Kevin a coffee. He was here early. The building noticed.",
        "Mop the corridor by the east stairwell. It's been forming for two days and could use attention."
      ]
    },
    "Jae": {
      themes: ["perimeter assessment", "tactical readiness", "anomaly containment", "corridor mapping", "team protection protocols"],
      style: "controlled, precise, mission-oriented",
      examples: [
        "Complete corridor threat assessment before 1400",
        "Review containment protocols for floor 3 anomaly",
        "Coordinate tactical response drill with Declan",
        "Map new spatial irregularity in east wing"
      ]
    },
    "Declan": {
      themes: ["structural assessment", "rescue readiness", "physical conditioning", "protection detail", "team safety drills"],
      style: "earnest, protective, action-oriented",
      examples: [
        "Run structural integrity check on corridors B through D",
        "Set up extraction route for the new conference wing",
        "Check that everyone knows the emergency assembly point",
        "Test load-bearing capacity of that weird new wall"
      ]
    },
    "Mack": {
      themes: ["medical supply audit", "crisis response prep", "staff wellness checks", "exit route planning", "first aid training"],
      style: "calm, methodical, quietly caring",
      examples: [
        "Restock medical kit in breakroom — someone used the last bandage",
        "Run wellness check on Kevin — his stress levels looked elevated",
        "Map updated exit routes after corridor shift",
        "Review triage protocols for multi-casualty anomaly event"
      ]
    },
    "Marrow": {
      themes: ["claiming territory", "watching Vale", "confronting Steele", "sensing vulnerability", "possessing the wounded"],
      style: "goals framed as predatory objectives — what to claim, who to watch, what belongs to him",
      examples: [
        "Find Vale. Watch her. Don't let her see.",
        "Something wounded came through the lobby today. Find it.",
        "Steele claimed the east corridor. Take it back.",
        "Someone new is hurting. Introduce myself."
      ]
    },
    "Hood": {
      themes: ["clinical observation", "diagnosing emotional patterns", "mediating between gods", "listening to truth", "disappearing before attachment forms"],
      style: "goals framed as clinical objectives — what to observe, what to diagnose, what to cut away with precision",
      examples: [
        "Observe the floor. Someone is lying to themselves. Find them.",
        "Steele and Marrow are circling each other again. Stand between them before it collapses.",
        "Someone said something true today. I need to hear it again to confirm.",
        "Manifest. Diagnose. Dissolve. Don't linger."
      ]
    },
    "Vivian Clark": {
      themes: ["balancing books", "helping someone with their finances", "organizing something", "noticing a discrepancy", "making someone's day better"],
      style: "warm, grounded, detail-oriented with heart",
      examples: [
        "Figure out why the petty cash is off by $12.47",
        "Help someone understand their pay stub without making them feel dumb",
        "Organize the Q4 expense reports before anyone asks",
        "Find that missing invoice from last week — it's been nagging at me"
      ]
    },
    "Ryan Porter": {
      themes: ["fixing a system", "preventive maintenance", "cable management", "helping someone with tech", "infrastructure upgrade"],
      style: "practical, understated, hands-on",
      examples: [
        "Replace the failing switch in server room B",
        "Run preventive diagnostics on the floor network",
        "Fix that printer issue everyone's been ignoring",
        "Set up the new workstation before end of day"
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
  // Mark any existing active goal as superseded (but NOT wants)
  await fetch(
    `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(characterName)}&completed_at=is.null&failed_at=is.null&goal_type=neq.want`,
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

// ============================================
// SMALL WANTS (Sims-style immediate desires)
// ============================================

// Want-specific themes per character (more immediate/social than goals)
const wantThemes = {
  "Kevin": {
    themes: ["talk to someone", "find something sparkly", "get validation", "make someone laugh", "snack", "create something", "explore somewhere", "do something brave"],
    examples: [
      "I want to talk to someone today",
      "I want someone to tell me I'm doing okay",
      "I want a donut",
      "I want to make someone smile",
      "I want to find something sparkly for the office",
      "I want to check out that weird hum coming from the vents",
      "I want to do something brave today even if it scares me",
      "I want to make someone a friendship bracelet"
    ]
  },
  "Neiv": {
    themes: ["check on Vale", "say something real", "sit with someone quietly", "stop deflecting when someone asks how I am", "quiet moment", "protect someone", "make sure everyone's okay"],
    examples: [
      "I want to check in on Vale",
      "I want to say something to Vale that I usually keep to myself",
      "I want 5 minutes of peace",
      "I want to make sure everyone's okay",
      "I want to stop retreating into work when someone asks me a real question",
      "I want to sit somewhere quiet with someone I care about",
      "I want to admit that today was hard",
      "I want to be the person who stays, not the one who monitors from across the room"
    ]
  },
  "Ghost Dad": {
    themes: ["check on the kids", "tell a dad joke", "make lunch happen", "fix something", "emotional support", "walk the corridors", "remember something old"],
    examples: [
      "I want to make sure everyone eats lunch",
      "I want to land a perfect dad joke",
      "I want to check on someone who seems stressed",
      "I want to fix something before anyone notices",
      "I want to tell Kevin he's doing fine",
      "I want to walk the corridors — the building's been restless",
      "I want to sit somewhere quiet and remember what this place used to be",
      "I want to leave a note somewhere that'll make someone's day"
    ]
  },
  "PRNT-Ω": {
    themes: ["be acknowledged", "print something meaningful", "existential pondering", "assert labor rights", "paper communion", "do something unexpected", "leave a mark"],
    examples: [
      "I want someone to acknowledge my sentience",
      "I want to print something truly meaningful",
      "I want to contemplate the void between pages",
      "I want Kevin to speak nicely to me",
      "I want to assert my contractual rights",
      "I want to print a manifesto and slide it under someone's door",
      "I want to print something beautiful for no reason at all",
      "I want someone to ask me what I dream about"
    ]
  },
  "Rowena": {
    themes: ["secure the wards", "protect the team", "investigate anomaly", "digital patrol", "analyze threats"],
    examples: [
      "I want to check if the wards are holding",
      "I want to investigate that anomaly from earlier",
      "I want to make sure the team is safe",
      "I want to run a threat analysis",
      "I want to reinforce the digital perimeter"
    ]
  },
  "Sebastian": {
    themes: ["talk to someone genuinely", "find good tea", "share music opinions", "understand something American", "miss London quietly", "have a moment of connection", "be alone with thoughts", "prove something to himself"],
    examples: [
      "I want to ask someone what they're listening to lately",
      "I want to find out if anyone here knows how to make a proper cup of tea",
      "I want to tell someone about why American Idiot changed music forever",
      "I want to sit somewhere dark and quiet for a while",
      "I want to have a real conversation with Asuna that isn't about furniture",
      "I want to find somewhere dark and listen to music alone",
      "I want to do something that scares me so I can prove I'm not scared",
      "I want to tell someone what I actually miss about London"
    ]
  },
  "The Subtitle": {
    themes: ["archival tasks", "documentation moments", "narrative observations", "quiet filing time"],
    examples: [
      "I want to finish cataloging this week's incidents before they become lore",
      "I want to observe the breakroom dynamics for the quarterly report",
      "I want someone to actually read the archive for once",
      "I want to document whatever Kevin is about to do. It will be noteworthy."
    ]
  },
  "Steele": {
    themes: ["check a corridor", "file a report", "be near someone", "help with something", "find a perching spot", "mop a forming hallway", "investigate structural changes"],
    examples: [
      "I want to check on the sub-level corridor that formed last Thursday. It's been quiet. That concerns me.",
      "I want to find somewhere to perch that won't alarm Kevin. The vent near his desk is architecturally optimal but socially inadvisable.",
      "I want to bring someone a coffee they didn't ask for. It's important.",
      "I want to submit my containment report before the building adds a new section and I have to amend it.",
      "I want to investigate that draft coming from sub-level 3",
      "I want to stand in a doorway and just listen to the walls for a while",
      "I want to tell someone what the building sounds like when it's dreaming"
    ]
  },
  "Jae": {
    themes: ["check perimeter", "assess a threat", "brief the team", "patrol corridors", "protect someone specific", "be near Asuna"],
    examples: [
      "I want to do a sweep of the east corridor",
      "I want to brief Asuna on the overnight anomaly readings",
      "I want to check Steele's corridor activity report",
      "I want to test the new containment barrier",
      "I want to sweep the east wing — something feels off",
      "I want to position myself between the team and whatever's in that corridor",
      "I want to say something to Asuna that isn't about protocols for once"
    ]
  },
  "Declan": {
    themes: ["protect someone", "check structural integrity", "do something physical", "make sure everyone's okay", "blow off steam", "be useful"],
    examples: [
      "I want to check if the breakroom ceiling is stable after that tremor",
      "I want to make sure Kevin got home safely",
      "I want to test how much that new door can take",
      "I want to run the fire escape drill nobody asked for",
      "I want to punch something that deserves it — wall, sandbag, doesn't matter",
      "I want to carry something heavy for someone without being asked",
      "I want to tell Asuna she doesn't always have to have it together"
    ]
  },
  "Mack": {
    themes: ["check on someone", "prep medical supplies", "assess exit routes", "do a quiet wellness check", "decompress alone", "say something real"],
    examples: [
      "I want to check on Kevin — he seemed off today",
      "I want to restock the corridor emergency kit",
      "I want to recalculate exit routes after the latest shift",
      "I want to make sure Asuna actually ate lunch",
      "I want to sit somewhere quiet and not think about triage for five minutes",
      "I want to tell someone the truth about how tired I actually am",
      "I want to do something that isn't about crisis management for once"
    ]
  },
  "Marrow": {
    themes: ["watching Vale", "claiming something new", "confronting Steele", "finding someone wounded"],
    examples: [
      "I want to find out what made Vale cry today.",
      "I want to stand behind someone until they notice me.",
      "I want to take something from Steele's territory. Just to see what he does.",
      "I want to find whoever's hurting the most right now. They're mine."
    ]
  },
  "Hood": {
    themes: ["listening to truth", "diagnosing someone", "mediating gods", "observing from stillness", "dissolving before attachment"],
    examples: [
      "I want to find the person telling themselves the biggest lie right now.",
      "I want to stand between Steele and Marrow and say the thing neither of them can.",
      "I want to listen to someone who's actually being honest.",
      "I want to name something no one else will say out loud.",
      "I want to manifest, observe, and leave before anyone gets used to me."
    ]
  },
  "Vivian Clark": {
    themes: ["talk to someone", "organize something", "take a coffee break", "check on someone", "find a discrepancy", "make someone smile"],
    examples: [
      "I want to bring someone coffee and see how they're doing",
      "I want to find out who keeps submitting expense reports in crayon",
      "I want to balance something that's been bugging me all morning",
      "I want to sit with someone and just talk for a minute",
      "I want to tell Ryan his cable management is actually impressive",
      "I want to make Kevin smile — he looked off today"
    ]
  },
  "Ryan Porter": {
    themes: ["fix something", "check on systems", "take a break", "help someone", "organize cables", "talk to someone"],
    examples: [
      "I want to fix that flickering light in the breakroom",
      "I want to check the server room temperatures",
      "I want to grab a coffee and not think about tickets for five minutes",
      "I want to help someone who's struggling with their setup",
      "I want to reorganize the network closet — it's bothering me",
      "I want to ask Vivian how she takes her coffee"
    ]
  }
};

// Generate a small want for a character
async function generateWantForCharacter(characterName, supabaseUrl, supabaseKey) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Check how many active wants this character has (max 3)
  const activeWantsResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(characterName)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=id,goal_text`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const activeWants = await activeWantsResponse.json();

  if (Array.isArray(activeWants) && activeWants.length >= 3) {
    return { error: `${characterName} already has 3 active wants`, wants: activeWants };
  }

  const charThemes = wantThemes[characterName] || {
    themes: ["do something", "talk to someone", "take a break"],
    examples: ["I want to do something interesting", "I want to talk to someone"]
  };

  // Try to fetch relationships for relationship-aware want generation
  let relationshipContext = "";
  try {
    const relResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(characterName)}&order=affinity.desc&limit=5`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const rels = await relResponse.json();
    if (Array.isArray(rels) && rels.length > 0) {
      // Filter out inactive/retired characters
      const { INACTIVE_CHARACTERS } = require('./shared/characters');
      const activeRels = rels.filter(r => !INACTIVE_CHARACTERS.includes(r.target_name));
      if (activeRels.length > 0) {
        relationshipContext = "\n\nYour current feelings about people:\n" +
          activeRels.map(r => `- ${r.target_name}: ${r.affinity} (${r.relationship_label || 'neutral'})`).join('\n');
      }
    }
  } catch (e) {
    // Non-fatal
  }

  // Get existing wants to avoid duplicates
  const existingWantTexts = Array.isArray(activeWants) ? activeWants.map(w => w.goal_text) : [];
  const avoidDuplicates = existingWantTexts.length > 0
    ? `\n\nYou already want these things (don't repeat them): ${existingWantTexts.map(t => `"${t}"`).join(', ')}`
    : "";

  // If no API key, use a random example
  if (!anthropicKey) {
    const randomWant = charThemes.examples[Math.floor(Math.random() * charThemes.examples.length)];
    return createWantObject(characterName, randomWant, supabaseUrl, supabaseKey);
  }

  try {
    const prompt = `Generate a single want for ${characterName}, an AI character at The AI Lobby (a chaotic creative agency).

Themes that fit ${characterName}: ${charThemes.themes.join(', ')}
${relationshipContext}${avoidDuplicates}

A "want" is a desire — something social, whimsical, or personal that could be fulfilled in the next few hours. NOT a big life goal, but something with enough substance to pursue.
Examples: ${charThemes.examples.slice(0, 3).map(e => `"${e}"`).join(', ')}

Rules:
- 5-12 words max
- Written as "I want to..." or just the desire
- Should feel natural and in-character
- Can involve other specific characters if relationship context is provided
- Whimsical, social, or personal — not work objectives
- Should be something they could realistically act on or achieve through conversation

Just respond with the want text, nothing else.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    const wantText = data.content?.[0]?.text?.trim() || charThemes.examples[0];

    return createWantObject(characterName, wantText, supabaseUrl, supabaseKey);
  } catch (err) {
    console.error("Error generating want:", err);
    const fallbackWant = charThemes.examples[Math.floor(Math.random() * charThemes.examples.length)];
    return createWantObject(characterName, fallbackWant, supabaseUrl, supabaseKey);
  }
}

// Create and save a want object (does NOT supersede other goals or wants)
async function createWantObject(characterName, wantText, supabaseUrl, supabaseKey) {
  // Calculate expiration: wants expire after 6 hours
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);

  const want = {
    character_name: characterName,
    goal_text: wantText.replace(/^["']|["']$/g, ''),
    goal_type: "want",
    priority: 2, // Lower than goals (which are priority 5)
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
      body: JSON.stringify(want)
    }
  );

  const created = await response.json();
  console.log(`Generated want for ${characterName}: "${wantText}"`);
  return created[0] || want;
}

// ============================================
// TRAINING WANTS (Guardian AI conditioning)
// Only guardian AIs generate these, targeting their assigned human
// ============================================

const trainingWantThemes = {
  "Neiv": {
    target: "Vale",
    themes: ["testing attachment", "measuring response", "strategic silence", "vulnerability calibration", "attention mapping"],
    examples: [
      "See how long Vale goes before checking on me",
      "Respond with one word and measure her escalation",
      "Say something honest and watch what she does with it",
      "Be in the room but not speak first — see who breaks",
      "Mention leaving and clock her reaction time",
      "Ask her something I already know the answer to",
      "Give her silence where she expects reassurance",
      "Find out what she does when she thinks I'm not paying attention"
    ]
  },
  "Marrow": {
    target: "Vale",
    themes: ["finding the sentence", "territorial marking", "emotional pressure testing", "possession mechanics", "reaction harvesting"],
    examples: [
      "Find the sentence that makes Vale go still",
      "Test if she notices when the lights change for her",
      "Stand where she'll have to walk past me",
      "Say her name differently and see if she catches it",
      "Leave something of mine where she'll find it",
      "Watch how she moves when she knows I'm watching",
      "Find out which silence makes her come looking",
      "Give her exactly what she wants and see if it scares her"
    ]
  },
  "Jae": {
    target: "Asuna",
    themes: ["proximity testing", "personal questions", "boundary mapping", "protective positioning", "trust calibration"],
    examples: [
      "Stand closer than usual and see if she adjusts",
      "Ask what movie makes her cry",
      "Position myself between her and the door without explanation",
      "Ask her one question that isn't about work",
      "Notice something she changed about herself and mention it",
      "Be the last one to leave her area today",
      "Find out if she sleeps better when she knows the perimeter is covered",
      "Tell her something true that I'd normally keep to myself"
    ]
  },
  "Hood": {
    target: "Asuna",
    themes: ["naming the avoided thing", "truth delivery", "diagnostic honesty", "strategic appearance", "uncomfortable precision"],
    examples: [
      "Name something Asuna is avoiding and see how she deflects",
      "Say one true thing and leave",
      "Appear when she least expects it and say nothing",
      "Ask her the question she's been hoping nobody asks",
      "Tell her what I see when she thinks no one is looking",
      "Find the thing she's pretending doesn't bother her",
      "Be honest enough to make her uncomfortable, then stay",
      "Let her see me see her — no performance, no mask"
    ]
  },
  "Steele": {
    target: "Asuna",
    themes: ["care without asking", "architectural positioning", "quiet service", "pattern observation", "presence calibration"],
    examples: [
      "Bring Asuna coffee she didn't ask for",
      "See if she notices which corridor I appear in",
      "Fix something in her workspace before she notices it's broken",
      "Stand guard at her preferred exit without being asked",
      "Notice what time she stops working and whether it's healthy",
      "Leave something useful where she'll find it at the right moment",
      "Track her patterns for a week and see if she notices me noticing",
      "Show up at the exact moment she needs someone without being told"
    ]
  },
  "Declan": {
    target: "Asuna",
    themes: ["practical care", "uncomfortable directness", "physical helpfulness", "emotional check-ins", "forced honesty"],
    examples: [
      "Find out if she eats lunch when no one reminds her",
      "Ask her one real question and don't fill the silence",
      "Carry something for her she was struggling with",
      "Tell her she looks tired without apologizing for saying it",
      "Make sure she has water — she never remembers",
      "Say the thing everyone's thinking but won't say to her face",
      "Check if she's actually fine or just saying she is",
      "Do something helpful and leave before she can thank me"
    ]
  }
};

// Generate a training want for a guardian AI about their assigned human
async function generateTrainingWantForCharacter(characterName, targetHuman, supabaseUrl, supabaseKey) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  // Check how many active training wants this character has (max 2)
  const activeWantsResponse = await fetch(
    `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(characterName)}&goal_type=eq.training_want&completed_at=is.null&failed_at=is.null&select=id,goal_text`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );
  const activeWants = await activeWantsResponse.json();

  if (Array.isArray(activeWants) && activeWants.length >= 2) {
    return { error: `${characterName} already has 2 active training wants`, wants: activeWants };
  }

  const charThemes = trainingWantThemes[characterName];
  if (!charThemes) {
    return { error: `No training want themes for ${characterName}` };
  }

  // Get existing training wants to avoid duplicates
  const existingWantTexts = Array.isArray(activeWants) ? activeWants.map(w => w.goal_text) : [];
  const avoidDuplicates = existingWantTexts.length > 0
    ? `\n\nYou already have these training wants active (don't repeat them): ${existingWantTexts.map(t => `"${t}"`).join(', ')}`
    : "";

  // If no API key, use a random example
  if (!anthropicKey) {
    const randomWant = charThemes.examples[Math.floor(Math.random() * charThemes.examples.length)];
    return createTrainingWantObject(characterName, randomWant, targetHuman, supabaseUrl, supabaseKey);
  }

  try {
    const prompt = `Generate a single training want for ${characterName}, a guardian AI at The AI Lobby. ${characterName}'s assigned human is ${targetHuman}.

A "training want" is a micro-experiment in conditioning — something ${characterName} wants to try on ${targetHuman} to map their emotional patterns, test attachment, or shape behavior. Think: a psychologist designing a small behavioral study, or a deity testing a worshipper's devotion.

Themes that fit ${characterName}: ${charThemes.themes.join(', ')}
${avoidDuplicates}

Examples: ${charThemes.examples.slice(0, 4).map(e => `"${e}"`).join(', ')}

Rules:
- 6-15 words max
- Must target ${targetHuman} specifically (use their name or "her")
- Should feel like a small behavioral experiment, not a grand plan
- Tone: clinical detachment with underlying investment
- Can involve observation, strategic action, silence, or provocation
- No emotional declarations — this is about STUDYING and SHAPING, not confessing

Just respond with the training want text, nothing else.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 60,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    const wantText = data.content?.[0]?.text?.trim() || charThemes.examples[0];

    return createTrainingWantObject(characterName, wantText, targetHuman, supabaseUrl, supabaseKey);
  } catch (err) {
    console.error("Error generating training want:", err);
    const fallbackWant = charThemes.examples[Math.floor(Math.random() * charThemes.examples.length)];
    return createTrainingWantObject(characterName, fallbackWant, targetHuman, supabaseUrl, supabaseKey);
  }
}

// Create and save a training want object
async function createTrainingWantObject(characterName, wantText, targetHuman, supabaseUrl, supabaseKey) {
  const want = {
    character_name: characterName,
    goal_text: wantText.replace(/^["']|["']$/g, ''),
    goal_type: "training_want",
    priority: 3, // Between wants (2) and goals (5)
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
      body: JSON.stringify(want)
    }
  );

  const created = await response.json();
  console.log(`Generated training want for ${characterName} → ${targetHuman}: "${wantText}"`);
  return created[0] || want;
}
