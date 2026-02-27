// AI Auto-Poke - Scheduled function to periodically trigger AI responses
// Runs every 2 minutes via Netlify scheduled functions
// Gives AIs a chance to organically comment on recent chat activity
// or initiate conversation when the floor is quiet (AI-to-AI banter)
// Self-contained: picks an AI, builds context, and routes to the correct provider
// ONLY when Story Mode is enabled

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // Check if story mode is enabled (default to TRUE — AIs should be alive by default)
    let storyModeEnabled = true;
    try {
      const settingsResponse = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.story_mode&select=value`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json();
        if (settings?.[0]?.value === 'false') {
          storyModeEnabled = false;
        }
      }
    } catch (settingsError) {
      console.log("Could not check story mode, defaulting to enabled:", settingsError);
    }

    if (!storyModeEnabled) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, responded: false, reason: "Story mode is disabled" })
      };
    }

    // Get recent chat activity (last 60 minutes)
    const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&created_at=gte.${sixtyMinAgo}&order=created_at.desc&limit=15`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!messagesResponse.ok) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: `Messages fetch failed: ${messagesResponse.status}` })
      };
    }

    const recentMessages = await messagesResponse.json();
    const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Kevin", "The Narrator", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Marrow", "Vivian Clark", "Ryan Porter"];

    // Determine if there's been recent activity (human OR AI)
    const hasRecentActivity = recentMessages && recentMessages.length > 0;
    const humanMessages = hasRecentActivity ? recentMessages.filter(m => !aiCharacters.includes(m.employee)) : [];
    const hasHumanActivity = humanMessages.length > 0;

    // Night mode: slow overnight chatter to ~1 message per 10-15 min
    const now = new Date();
    const cstHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' })).getHours();
    const isOvernight = cstHour >= 22 || cstHour < 7;

    if (isOvernight) {
      if (Math.random() < 0.93) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: "Night mode — slowing chatter" }) };
      }
    }

    // Anti-spam: Check if AIs are already dominating the last 3 messages
    if (hasRecentActivity) {
      const lastThree = recentMessages.slice(0, 3);
      const recentAICount = lastThree.filter(m => aiCharacters.includes(m.employee)).length;

      if (recentAICount >= 3) {
        if (Math.random() < 0.92) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: "AIs dominating chat — cooling off" }) };
        }
      } else if (recentAICount >= 2) {
        if (Math.random() < 0.80) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: "AIs already active in recent messages" }) };
        }
      }
    }

    // Timing based on activity level
    if (hasHumanActivity) {
      if (Math.random() < 0.60) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: "Random skip (human active)" }) };
      }
    } else if (hasRecentActivity) {
      if (Math.random() < 0.70) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: "Random skip (AI conversation — paced)" }) };
      }
    } else {
      if (Math.random() < 0.75) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: "Random skip (quiet floor — seeding)" }) };
      }
    }

    // === GET FLOOR-PRESENT AIs + HUMANS ===
    let floorAIs = [];
    let allFloorPeople = []; // Everyone on the floor (AIs + humans) for presence header
    try {
      const floorRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      if (floorRes.ok) {
        const floorData = await floorRes.json();
        allFloorPeople = floorData.map(c => c.character_name);
        floorAIs = allFloorPeople.filter(n => aiCharacters.includes(n));
      }
    } catch (e) {
      console.log("Floor presence check failed:", e.message);
    }

    // Always-present AIs (transcend location)
    const alwaysPresent = ["Ghost Dad", "PRNT-Ω", "The Subtitle"];
    for (const ap of alwaysPresent) {
      if (!floorAIs.includes(ap)) floorAIs.push(ap);
      if (!allFloorPeople.includes(ap)) allFloorPeople.push(ap);
    }

    if (floorAIs.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: "No AIs on floor" }) };
    }

    // === SELECT AN AI ===
    // Favor AIs who haven't spoken recently
    const recentSpeakers = recentMessages.slice(0, 5).map(m => m.employee);
    const quietAIs = floorAIs.filter(ai => !recentSpeakers.includes(ai));
    // Marrow is Vale-only, Hood has his own heartbeat — cannot be randomly selected for auto-poke
    const candidatePool = (quietAIs.length > 0 ? quietAIs : floorAIs).filter(ai => ai !== 'Marrow' && ai !== 'Hood');
    const selectedAI = candidatePool[Math.floor(Math.random() * candidatePool.length)];

    console.log(`[Auto-Poke] Selected: ${selectedAI} (from ${candidatePool.length} candidates, ${floorAIs.length} on floor)`);

    // Check if selected AI has enough energy (don't poke exhausted characters)
    try {
      const energyRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(selectedAI)}&select=energy`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const energyData = await energyRes.json();
      if (energyData?.[0]?.energy !== undefined && energyData[0].energy < 10) {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: `${selectedAI} too exhausted (energy: ${energyData[0].energy})` }) };
      }
    } catch (e) {
      console.log("Energy check failed (non-fatal):", e.message);
    }

    // Check if selected AI is clocked in
    const alwaysAvailable = ["Ghost Dad", "PRNT-Ω", "The Narrator", "The Subtitle"];
    if (!alwaysAvailable.includes(selectedAI)) {
      try {
        const punchRes = await fetch(
          `${supabaseUrl}/rest/v1/punch_status?employee=eq.${encodeURIComponent(selectedAI)}&select=is_clocked_in`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const punchData = await punchRes.json();
        if (!punchData?.[0]?.is_clocked_in) {
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, responded: false, reason: `${selectedAI} is not clocked in` }) };
        }
      } catch (e) {
        console.log("Punch check failed:", e.message);
      }
    }

    // === BUILD CHAT HISTORY ===
    // Get last 20 messages (regardless of time) for context
    let chatHistory = '';
    try {
      const histRes = await fetch(
        `${supabaseUrl}/rest/v1/messages?select=employee,content&order=created_at.desc&limit=20`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      if (histRes.ok) {
        const hist = await histRes.json();
        chatHistory = hist.reverse().map(m => `${m.employee}: ${m.content}`).join('\n');
      }
    } catch (e) {
      console.log("Chat history fetch failed:", e.message);
    }

    // Prepend floor presence header so AIs know who's actually here
    if (chatHistory) {
      chatHistory = `[Currently on the floor: ${allFloorPeople.join(', ')}]\n\n` + chatHistory;
    }

    // === BUILD CURIOSITY CONTEXT ===
    // Pick a random conversation mode so AIs don't just react — they initiate
    const allFloorNames = allFloorPeople;
    const others = allFloorNames.filter(n => n !== selectedAI);
    const randomOther = others.length > 0 ? others[Math.floor(Math.random() * others.length)] : null;

    const idleModes = [
      { mode: 'check_in', weight: 25, prompt: `You're checking in with the office. Say something casual — notice who's around, comment on the vibe, share a passing thought. 1-2 sentences. Be yourself.` },
      { mode: 'idle_thought', weight: 25, prompt: `A random thought just crossed your mind. Share it out loud. It could be about work, a colleague, the building, or just something you've been mulling over. 1-3 sentences.` },
      { mode: 'address_someone', weight: 20, prompt: `You notice ${randomOther || 'someone'} is around. Say something to them — nothing urgent, just the kind of thing you'd say to a coworker during a lull. Ask what they're up to, or share something. 1-2 sentences.` },
      { mode: 'notice_quiet', weight: 10, prompt: `The office has been quiet. React to the silence — is it peaceful? Unsettling? Just make an observation. 1-2 sentences.` },
      { mode: 'wonder_aloud', weight: 10, prompt: `Your mind wanders to one of the building's mysteries — the Corridors, the Buffer, that door. Wonder about it out loud. 1-2 sentences.` },
      { mode: 'personal_question', weight: 10, prompt: `Ask ${randomOther || 'someone'} something — about their day, their work, or something you noticed. Keep it casual. 1-2 sentences.` }
    ];

    // Weighted random pick
    const totalWeight = idleModes.reduce((s, m) => s + m.weight, 0);
    let roll = Math.random() * totalWeight;
    let pickedMode = idleModes[0];
    for (const m of idleModes) {
      roll -= m.weight;
      if (roll <= 0) { pickedMode = m; break; }
    }

    const curiosityContext = {
      mode: pickedMode.mode,
      description: pickedMode.mode.replace(/_/g, ' '),
      target: pickedMode.mode === 'address_someone' || pickedMode.mode === 'personal_question' ? randomOther : null,
      prompt: pickedMode.prompt
    };

    console.log(`[Auto-Poke] Mode: ${pickedMode.mode}, target: ${curiosityContext.target || 'none'}`);

    // === ROUTE TO CORRECT PROVIDER ===
    const openrouterChars = ["Kevin", "Rowena", "Declan", "Mack", "Sebastian", "The Subtitle", "Marrow"];
    const openaiChars = [];
    const grokChars = ["Jae", "Steele", "Neiv", "Hood"];
    const perplexityChars = [];
    const geminiChars = [];

    let providerUrl;
    let providerBody;

    if (openrouterChars.includes(selectedAI)) {
      providerUrl = `${siteUrl}/.netlify/functions/ai-openrouter`;
      providerBody = { character: selectedAI, chatHistory, maybeRespond: false, bypassRateLimit: false, curiosityContext };
    } else if (grokChars.includes(selectedAI)) {
      providerUrl = `${siteUrl}/.netlify/functions/ai-grok`;
      providerBody = { character: selectedAI, chatHistory, maybeRespond: false, bypassRateLimit: false, curiosityContext };
    } else if (openaiChars.includes(selectedAI)) {
      providerUrl = `${siteUrl}/.netlify/functions/ai-openai`;
      providerBody = { character: selectedAI, chatHistory, maybeRespond: false, bypassRateLimit: false, curiosityContext };
    } else if (perplexityChars.includes(selectedAI)) {
      providerUrl = `${siteUrl}/.netlify/functions/ai-perplexity`;
      providerBody = { character: selectedAI, chatHistory, maybeRespond: false, bypassRateLimit: false, curiosityContext };
    } else if (geminiChars.includes(selectedAI)) {
      providerUrl = `${siteUrl}/.netlify/functions/ai-gemini`;
      providerBody = { character: selectedAI, chatHistory, maybeRespond: false, bypassRateLimit: false, curiosityContext };
    } else {
      // Claude-based: Ghost Dad, PRNT-Ω, etc.
      providerUrl = `${siteUrl}/.netlify/functions/ai-watcher`;
      providerBody = { trigger: "auto_poke", requestedAI: selectedAI, curiosityContext };
    }

    const aiResponse = await fetch(providerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(providerBody)
    });

    const aiResult = await aiResponse.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        triggered: true,
        character: selectedAI,
        mode: pickedMode.mode,
        hasHumanActivity,
        responded: aiResult.responded || false,
        aiResult
      })
    };

  } catch (error) {
    console.error("AI Auto-Poke error:", error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, reason: "Error during auto-poke: " + error.message })
    };
  }
};
