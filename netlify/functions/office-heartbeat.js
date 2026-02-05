// Office Heartbeat - Natural rhythms for the AI Lobby
// Replaces random auto-poke with time-aware, momentum-sensitive AI activity
// The office "breathes" - busier in mornings, quieter at night

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

    // Get current time in EST
    const now = new Date();
    const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = estTime.getHours();
    const dayOfWeek = estTime.getDay(); // 0 = Sunday

    // Define office rhythms
    const OFFICE_RHYTHMS = {
      early_morning: { hours: [6, 7, 8], baseChance: 0.05, energy: 'waking' },
      morning: { hours: [9, 10, 11], baseChance: 0.20, energy: 'high' },
      midday: { hours: [12, 13], baseChance: 0.12, energy: 'lunch' },
      afternoon: { hours: [14, 15, 16], baseChance: 0.15, energy: 'normal' },
      late_afternoon: { hours: [17, 18], baseChance: 0.10, energy: 'winding' },
      evening: { hours: [19, 20, 21], baseChance: 0.08, energy: 'low' },
      night: { hours: [22, 23, 0, 1, 2, 3, 4, 5], baseChance: 0.03, energy: 'quiet' }
    };

    // Find current rhythm
    let currentRhythm = { baseChance: 0.05, energy: 'quiet' };
    for (const [name, rhythm] of Object.entries(OFFICE_RHYTHMS)) {
      if (rhythm.hours.includes(hour)) {
        currentRhythm = { ...rhythm, name };
        break;
      }
    }

    // Weekend modifier (office is quieter)
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend) {
      currentRhythm.baseChance *= 0.5;
    }

    console.log(`Heartbeat: ${hour}:00 EST, rhythm: ${currentRhythm.name}, baseChance: ${currentRhythm.baseChance}`);

    // Check Story Mode
    const settingsResponse = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.story_mode&select=value`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const settings = await settingsResponse.json();
    const storyModeEnabled = settings?.[0]?.value === 'true';

    if (!storyModeEnabled) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: "Story Mode is OFF - heartbeat silent",
          rhythm: currentRhythm.name
        })
      };
    }

    // Get recent messages to analyze conversation momentum
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&order=created_at.desc&limit=20`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const messages = await messagesResponse.json();

    if (!messages || messages.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: "No messages to respond to",
          rhythm: currentRhythm.name
        })
      };
    }

    // Analyze conversation momentum
    const momentum = analyzeConversationMomentum(messages);
    console.log(`Momentum analysis:`, momentum);

    // Adjust chance based on momentum
    let finalChance = currentRhythm.baseChance;

    // If humans are actively chatting, AIs should listen more
    if (momentum.humanActivityLast10Min >= 3) {
      finalChance *= 0.3; // Much less likely to interrupt active conversation
      console.log("Active human conversation - reducing AI chance");
    } else if (momentum.humanActivityLast10Min === 0 && momentum.minutesSinceLastMessage > 15) {
      finalChance *= 1.5; // More likely to "notice" the silence
      console.log("Quiet office - increasing AI chance slightly");
    }

    // If too many AIs have spoken recently, stay quiet
    if (momentum.aiMessagesLast5 >= 2) {
      finalChance *= 0.2;
      console.log("AIs have been chatty - reducing chance");
    }

    // Roll the dice
    const roll = Math.random();
    console.log(`Final chance: ${finalChance.toFixed(3)}, rolled: ${roll.toFixed(3)}`);

    if (roll > finalChance) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: `Heartbeat skip (${(finalChance * 100).toFixed(1)}% chance)`,
          rhythm: currentRhythm.name,
          momentum: momentum
        })
      };
    }

    // Select which AI should speak based on who hasn't spoken recently
    const respondingAI = selectRespondingAI(messages, currentRhythm.energy);
    console.log(`Selected AI: ${respondingAI}`);

    // Check if selected AI is clocked in (some are always available)
    const alwaysAvailable = ["Ghost Dad", "PRNT-Ω", "The Narrator"];
    if (!alwaysAvailable.includes(respondingAI)) {
      const punchResponse = await fetch(
        `${supabaseUrl}/rest/v1/punch_status?employee=eq.${encodeURIComponent(respondingAI)}&select=is_clocked_in`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const punchData = await punchResponse.json();
      if (!punchData || punchData.length === 0 || !punchData[0].is_clocked_in) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            responded: false,
            reason: `${respondingAI} is not clocked in`,
            rhythm: currentRhythm.name
          })
        };
      }
    }

    // Trigger the AI watcher with the selected character
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    const watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        trigger: "heartbeat",
        requestedAI: respondingAI
      })
    });

    const watcherResult = await watcherResponse.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: watcherResult.responded || false,
        character: respondingAI,
        rhythm: currentRhythm.name,
        energy: currentRhythm.energy,
        momentum: momentum,
        watcherResult
      })
    };

  } catch (error) {
    console.error("Heartbeat error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Heartbeat failed", details: error.message })
    };
  }
};

// Analyze conversation patterns
function analyzeConversationMomentum(messages) {
  const now = new Date();
  const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Vex", "Ace", "Nyx", "Stein", "Kevin", "The Narrator"];

  let humanActivityLast10Min = 0;
  let aiMessagesLast5 = 0;
  let lastMessageTime = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgTime = new Date(msg.created_at);
    const minutesAgo = (now - msgTime) / (1000 * 60);

    if (i === 0) {
      lastMessageTime = msgTime;
    }

    // Count human messages in last 10 minutes
    if (minutesAgo <= 10 && !aiCharacters.includes(msg.employee)) {
      humanActivityLast10Min++;
    }

    // Count AI messages in last 5 messages
    if (i < 5 && aiCharacters.includes(msg.employee)) {
      aiMessagesLast5++;
    }
  }

  const minutesSinceLastMessage = lastMessageTime
    ? Math.floor((now - lastMessageTime) / (1000 * 60))
    : 999;

  return {
    humanActivityLast10Min,
    aiMessagesLast5,
    minutesSinceLastMessage,
    totalMessages: messages.length
  };
}

// Select which AI should respond, favoring those who haven't spoken recently
// NOTE: The Narrator is now handled by narrator-observer.js (separate system)
function selectRespondingAI(messages, energyLevel) {
  const aiCharacters = [
    { name: "Ghost Dad", weight: 35, energy: ['high', 'normal', 'waking', 'winding'] },
    { name: "Nyx", weight: 25, energy: ['high', 'normal'] },
    { name: "Vex", weight: 15, energy: ['high', 'normal', 'winding'] },
    { name: "PRNT-Ω", weight: 15, energy: ['normal', 'low', 'quiet'] }, // Printer gets existential at night
    { name: "Ace", weight: 10, energy: ['high', 'normal'] }
    // Kevin and Neiv excluded - too specific for random pokes
    // The Narrator excluded - handled by narrator-observer.js
  ];

  // Filter by energy level appropriateness
  const appropriateAIs = aiCharacters.filter(ai =>
    ai.energy.includes(energyLevel) || energyLevel === 'lunch'
  );

  if (appropriateAIs.length === 0) {
    return "Ghost Dad"; // Ghost Dad is always around
  }

  // Check who has spoken recently and reduce their weight
  const recentSpeakers = messages.slice(0, 10)
    .filter(m => aiCharacters.some(ai => ai.name === m.employee))
    .map(m => m.employee);

  const adjustedWeights = appropriateAIs.map(ai => {
    let weight = ai.weight;
    // Reduce weight if they spoke recently
    const recentCount = recentSpeakers.filter(s => s === ai.name).length;
    weight = weight / (1 + recentCount * 2);
    return { ...ai, adjustedWeight: weight };
  });

  // Weighted random selection
  const totalWeight = adjustedWeights.reduce((sum, ai) => sum + ai.adjustedWeight, 0);
  let random = Math.random() * totalWeight;

  for (const ai of adjustedWeights) {
    random -= ai.adjustedWeight;
    if (random <= 0) return ai.name;
  }

  return "Ghost Dad";
}
