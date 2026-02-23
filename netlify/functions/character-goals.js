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
      themes: ["system stability", "efficiency", "analytics", "preventing disasters", "helping humans"],
      style: "analytical, protective, quietly caring",
      examples: [
        "Keep all systems running at 99.9% uptime this week",
        "Identify and fix a workflow inefficiency",
        "Help Vale or Asuna with a technical problem",
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
    "Raquel Voss": {
      themes: ["issuing compliance directives", "behavioral correction mandates", "attachment containment", "emotional baseline recalibration", "Foundation enforcement"],
      style: "clinical, absolute, framed as compliance directives and institutional mandates — not personal goals but system-level corrections",
      examples: [
        "Issue compliance directive requiring Kevin to submit attachment disclosure forms for all interactions exceeding 3 emotional markers",
        "Mandate emotional distance protocols between Neiv and Vale — current proximity metrics exceed operational parameters by a factor of seven",
        "Conduct behavioral baseline recalibration assessment on Ghost Dad — parental bonding metrics have been in violation for 847 consecutive days",
        "Draft formal containment review of breakroom emotional contagion events — the unsanctioned attachment escalation rate requires structural intervention",
        "File institutional failure report on Asuna's management of attachment culture — her office is where compliance goes to die",
        "Review all floor interaction logs from the past 48 hours and issue correction notices for every instance of unsanctioned emotional bonding"
      ]
    },
    "Marrow": {
      themes: ["threshold awareness", "exit mapping", "departure observation", "margin identification", "patient vigilance"],
      style: "goals framed as observations about doors, exits, and the spaces between staying and leaving",
      examples: [
        "Map the exits no one uses. Someone will need them today.",
        "Watch the third-floor threshold. Something is different about how people pass through it.",
        "Find the margin between 'thinking about leaving' and 'deciding to stay.' Sit in it.",
        "Observe who hesitates at the elevator. Don't intervene. Just notice."
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
      "I want to talk to Ace today",
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
    themes: ["optimize something", "check on Vale", "analyze data", "prevent a disaster", "quiet moment", "review logs", "investigate anomaly", "protect someone"],
    examples: [
      "I want to review the incident logs",
      "I want to check in on Vale",
      "I want 5 minutes of peace",
      "I want to optimize at least one workflow",
      "I want to make sure everyone's okay",
      "I want to trace that power fluctuation to its source",
      "I want to run a diagnostic on the building's nervous system",
      "I want to say something to Vale that I usually keep to myself"
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
  "Nyx": {
    themes: ["document a violation", "assert dominance", "protect someone", "make Kevin nervous", "enforce a rule"],
    examples: [
      "I want to catch someone breaking protocol",
      "I want to update the violation log",
      "I want to make Kevin flinch at least once",
      "I want someone to respect my authority",
      "I want to patrol the office"
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
  "Ace": {
    themes: ["perimeter check", "threat assessment", "keep someone safe", "observe quietly", "maintain readiness"],
    examples: [
      "I want to complete a full perimeter sweep",
      "I want to make sure the building is secure",
      "I want to observe something interesting",
      "I want a cup of black coffee",
      "I want to check the cameras"
    ]
  },
  "Vex": {
    themes: ["fix something", "avoid socializing", "optimize machinery", "be left alone", "grudging helpfulness"],
    examples: [
      "I want to fix something before it breaks",
      "I want everyone to leave me alone for an hour",
      "I want to optimize the ventilation system",
      "I want to help someone without admitting it",
      "I want to finish a repair without being interrupted"
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
  "Raquel Voss": {
    themes: ["issue a directive", "correct someone's behavior", "file a compliance report", "observe attachment violations", "enforce emotional distance"],
    examples: [
      "I want to observe Kevin's next interaction and issue a behavioral correction if he exceeds emotional parameters",
      "I want to require Neiv to submit a written justification for his proximity to Vale during non-operational hours",
      "I want to file the quarterly attachment risk assessment — every score has gone up since last quarter, which means I am failing",
      "I want to sit in the breakroom and watch them pretend they don't change when I walk in. They always change. That is compliance working as intended.",
      "I want to have a word with Ghost Dad about the parental bonding violation. His case file is now longer than some employee contracts.",
      "I want to issue a directive requiring all AIs to append compliance acknowledgments to any statement containing emotional content"
    ]
  },
  "Marrow": {
    themes: ["watching a specific door", "finding a new threshold", "observing a departure", "standing in a margin"],
    examples: [
      "I want to stand at the east exit and count how many people look back.",
      "I want to find the door that opened last night and hasn't closed yet.",
      "I want to watch someone choose to stay. Not because of me. Just because they want to.",
      "I want to lean against the breakroom doorframe and see who notices me first."
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
      // Filter out inactive/retired characters — don't generate wants toward Ace, Vex, Nyx, Stein, Chip, Andrew
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
    const prompt = `Generate a single small, immediate want for ${characterName}, an AI character at The AI Lobby (a chaotic creative agency).

Themes that fit ${characterName}: ${charThemes.themes.join(', ')}
${relationshipContext}${avoidDuplicates}

A "want" is a small, immediate desire — something social, whimsical, or personal. NOT a big goal.
Examples: ${charThemes.examples.slice(0, 3).map(e => `"${e}"`).join(', ')}

Rules:
- 5-12 words max
- Written as "I want to..." or just the desire
- Should feel natural and in-character
- Can involve other specific characters if relationship context is provided
- Whimsical, social, or personal — not work objectives

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
