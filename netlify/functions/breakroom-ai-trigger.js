// Breakroom AI Trigger — Server-side AI response triggering
// Called by the frontend after a human message is saved to the DB
// This ensures ALL users see AI responses via polling (not just the sender's browser)
// Separated from breakroom-message.js to avoid timeout issues (each function gets its own 10s window)

// Human characters - never trigger AI responses AS these characters
const HUMANS = ["Vale", "Asuna"];

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
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing config" }) };
  }

  try {
    const { humanSpeaker, humanMessage, postToDiscord } = JSON.parse(event.body || "{}");

    if (!humanSpeaker || !humanMessage) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing humanSpeaker or humanMessage" }) };
    }

    console.log(`[AI trigger] Triggered for ${humanSpeaker}: "${humanMessage.substring(0, 50)}..."`);

    // 1. Get characters currently in the breakroom (from character_state table)
    const locResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_state?current_focus=eq.break_room&select=character_name`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!locResponse.ok) {
      console.log("[AI trigger] Failed to fetch breakroom characters:", locResponse.status);
      return { statusCode: 200, headers, body: JSON.stringify({ triggered: false, reason: "Failed to fetch locations" }) };
    }

    const characters = await locResponse.json();
    const aiInRoom = characters
      .map(c => c.character_name)
      .filter(name => !HUMANS.includes(name));

    if (aiInRoom.length === 0) {
      console.log("[AI trigger] No AI characters in breakroom");
      return { statusCode: 200, headers, body: JSON.stringify({ triggered: false, reason: "No AI in breakroom" }) };
    }

    console.log(`[AI trigger] AI in breakroom: ${aiInRoom.join(', ')}`);

    // 2. Get recent chat history for context
    const historyResponse = await fetch(
      `${supabaseUrl}/rest/v1/breakroom_messages?order=created_at.desc&limit=25`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    let chatHistory = '';
    if (historyResponse.ok) {
      const historyMessages = await historyResponse.json();
      historyMessages.reverse();
      chatHistory = historyMessages.map(m => `${m.speaker}: ${m.message}`).join('\n');
    }

    // 3. Check for @ mentions AND plain name mentions — mentioned AIs always respond
    const aliases = {
      'kev': 'Kevin', 'kevin': 'Kevin',
      'neiv': 'Neiv',
      'ghost': 'Ghost Dad', 'ghostdad': 'Ghost Dad', 'dad': 'Ghost Dad',
      'holden': 'Ghost Dad',
      'prnt': 'PRNT-Ω', 'printer': 'PRNT-Ω', 'omega': 'PRNT-Ω',
      'rowena': 'Rowena', 'witch': 'Rowena',
      'seb': 'Sebastian', 'sebastian': 'Sebastian', 'vampire': 'Sebastian',
      'subtitle': 'The Subtitle', 'sub': 'The Subtitle',
      'steele': 'Steele',
      'jae': 'Jae', 'minjae': 'Jae',
      'declan': 'Declan', 'dec': 'Declan',
      'mack': 'Mack', 'malcolm': 'Mack',
      'marrow': 'Marrow',
      'hood': 'Hood', 'mr. hood': 'Hood', 'mr hood': 'Hood', 'asher': 'Hood',
      'raquel': 'Raquel Voss', 'raq': 'Raquel Voss', 'voss': 'Raquel Voss',
      'narrator': 'The Narrator'
    };

    const mentions = [];
    let match;
    const lowerMessage = humanMessage.toLowerCase();

    // Check @mentions first
    const atMentionRegex = /@(\w+)/g;
    while ((match = atMentionRegex.exec(humanMessage)) !== null) {
      const name = match[1].toLowerCase();
      // Check alias map
      if (aliases[name] && aiInRoom.includes(aliases[name]) && !mentions.includes(aliases[name])) {
        mentions.push(aliases[name]);
      }
      // Check direct name match (case insensitive)
      const directMatch = aiInRoom.find(n => n.toLowerCase() === name);
      if (directMatch && !mentions.includes(directMatch)) {
        mentions.push(directMatch);
      }
    }

    // If no @mentions, check for plain name mentions (e.g., "hey Kevin")
    if (mentions.length === 0) {
      for (const aiName of aiInRoom) {
        try {
          const nameRegex = new RegExp('\\b' + aiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          if (nameRegex.test(humanMessage) && !mentions.includes(aiName)) {
            mentions.push(aiName);
          }
        } catch (e) { /* regex safety */ }
        // Check aliases too
        for (const [alias, fullName] of Object.entries(aliases)) {
          if (fullName === aiName && !mentions.includes(aiName)) {
            try {
              const aliasRegex = new RegExp('\\b' + alias + '\\b', 'i');
              if (aliasRegex.test(humanMessage)) {
                mentions.push(aiName);
                break;
              }
            } catch (e) { /* regex safety */ }
          }
        }
      }
    }

    // Marrow is Vale-only — only responds when Vale says his name
    if (humanSpeaker !== 'Vale') {
      const marrowIdx = mentions.indexOf('Marrow');
      if (marrowIdx !== -1) {
        mentions.splice(marrowIdx, 1);
        console.log(`[AI trigger] Marrow blocked — only responds to Vale`);
      }
      // Also exclude from solo/chime-decider selection
      const aiRoomIdx = aiInRoom.indexOf('Marrow');
      if (aiRoomIdx !== -1) aiInRoom.splice(aiRoomIdx, 1);
    }

    let primaryResponder;

    if (mentions.length > 0) {
      primaryResponder = mentions[0];
      console.log(`[AI trigger] @mentioned: ${primaryResponder}`);
    } else if (aiInRoom.length === 1) {
      primaryResponder = aiInRoom[0];
      console.log(`[AI trigger] Solo AI: ${primaryResponder}`);
    } else {
      // Multiple AIs — use chime-decider to pick
      try {
        const deciderResponse = await fetch(`${siteUrl}/.netlify/functions/breakroom-chime-decider`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aiInRoom,
            chatHistory,
            latestMessage: humanMessage,
            latestSpeaker: humanSpeaker
          })
        });

        const decision = await deciderResponse.json();
        primaryResponder = decision.character || aiInRoom[0];
        console.log(`[AI trigger] Chime decider picked: ${primaryResponder} (${decision.reason})`);
      } catch (err) {
        primaryResponder = aiInRoom[Math.floor(Math.random() * aiInRoom.length)];
        console.log(`[AI trigger] Chime decider failed, random pick: ${primaryResponder}`);
      }
    }

    // 4. Trigger the primary AI response
    console.log(`[AI trigger] Triggering response from ${primaryResponder}...`);
    const shouldPost = postToDiscord === true || postToDiscord === "true";
    const aiResponse = await fetch(`${siteUrl}/.netlify/functions/breakroom-ai-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        character: primaryResponder,
        chatHistory,
        humanSpeaker,
        humanMessage,
        postToDiscord: shouldPost
      })
    });

    const aiResult = await aiResponse.json();
    console.log(`[AI trigger] ${primaryResponder} responded: ${aiResult.success ? 'success' : 'failed'}`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        triggered: true,
        character: primaryResponder,
        success: aiResult.success || false
      })
    };

  } catch (error) {
    console.error("[AI trigger] Error:", error.message);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ triggered: false, reason: error.message })
    };
  }
};
