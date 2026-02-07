// AI Response Trigger - Actively checks for recent human messages and triggers AI responses
// This is called periodically (every 30 seconds or so) to ensure AIs actually respond
// Works around the fire-and-forget issue in serverless functions

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
  };

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

    // AI characters list
    const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Vex", "Ace", "Nyx", "Stein", "Kevin", "The Narrator"];
    const perplexityCharacters = ["Neiv"];
    const openaiCharacters = ["Kevin"];

    // Get recent messages (last 10)
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=id,employee,content,created_at&order=created_at.desc&limit=10`,
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
        body: JSON.stringify({ success: true, triggered: false, reason: "No messages" })
      };
    }

    // Check if the most recent message is from a human (not an AI)
    const lastMessage = messages[0];
    const lastMessageTime = new Date(lastMessage.created_at);
    const now = new Date();
    const secondsAgo = (now - lastMessageTime) / 1000;

    // Only trigger if last message was from a human and within the last 60 seconds
    if (aiCharacters.includes(lastMessage.employee)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          triggered: false,
          reason: "Last message was from an AI",
          lastSpeaker: lastMessage.employee
        })
      };
    }

    if (secondsAgo > 60) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          triggered: false,
          reason: `Last human message was ${Math.floor(secondsAgo)}s ago (too old)`,
          lastSpeaker: lastMessage.employee
        })
      };
    }

    // Check if an AI already responded to this message
    // (Look for AI messages after the human message)
    const humanMessageTime = lastMessageTime.getTime();
    const aiResponsedAfter = messages.some((msg, idx) => {
      if (idx === 0) return false; // Skip the human message itself
      const msgTime = new Date(msg.created_at).getTime();
      return aiCharacters.includes(msg.employee) && msgTime > humanMessageTime - 5000; // Within 5s before
    });

    // Actually, check if ANY AI message came AFTER the last human message
    // by looking at messages newer than the human one
    const newerAiMessages = messages.filter(msg => {
      const msgTime = new Date(msg.created_at).getTime();
      return msgTime > humanMessageTime && aiCharacters.includes(msg.employee);
    });

    if (newerAiMessages.length > 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          triggered: false,
          reason: "AI already responded to this message",
          responder: newerAiMessages[0].employee
        })
      };
    }

    console.log(`🎯 Human message from ${lastMessage.employee} (${Math.floor(secondsAgo)}s ago) needs AI response!`);

    // Build chat history for context
    const chatHistory = messages.reverse().map(m => `${m.employee}: ${m.content}`).join('\n');

    // Get clocked-in AIs
    const punchResponse = await fetch(
      `${supabaseUrl}/rest/v1/timeclock?is_clocked_in=eq.true&select=employee`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const clockedIn = await punchResponse.json();
    const clockedInAIs = (clockedIn || [])
      .map(e => e.employee)
      .filter(name => aiCharacters.includes(name));

    // Always include Ghost Dad and PRNT-Ω
    const alwaysAvailable = ["Ghost Dad", "PRNT-Ω"];
    const availableAIs = [...new Set([...clockedInAIs, ...alwaysAvailable])];

    console.log(`📢 Available AIs: ${availableAIs.join(', ')}`);

    // Pick 1-2 random AIs
    const shuffledAIs = availableAIs.sort(() => Math.random() - 0.5);
    const selectedAIs = shuffledAIs.slice(0, Math.min(2, shuffledAIs.length));

    console.log(`🎲 Selected AIs to trigger: ${selectedAIs.join(', ')}`);

    // Now ACTUALLY AWAIT the AI responses
    const results = [];
    for (const aiName of selectedAIs) {
      try {
        let response;

        if (perplexityCharacters.includes(aiName)) {
          console.log(`📡 Calling Perplexity for ${aiName}...`);
          response = await fetch(`${siteUrl}/.netlify/functions/ai-perplexity`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              character: aiName,
              chatHistory,
              maybeRespond: true
            })
          });
        } else if (openaiCharacters.includes(aiName)) {
          console.log(`📡 Calling OpenAI for ${aiName}...`);
          response = await fetch(`${siteUrl}/.netlify/functions/ai-openai`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              character: aiName,
              chatHistory,
              maybeRespond: true
            })
          });
        } else {
          console.log(`📡 Calling ai-watcher for ${aiName}...`);
          response = await fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trigger: "response_trigger",
              requestedAI: aiName,
              chatHistory: chatHistory
            })
          });
        }

        const result = await response.json();
        console.log(`📨 ${aiName} result:`, result.responded ? 'RESPONDED' : result.reason || 'passed');
        results.push({ ai: aiName, ...result });

        // If someone responded, maybe don't need to ask more
        if (result.responded) {
          console.log(`✅ ${aiName} responded! Stopping here.`);
          break;
        }
      } catch (err) {
        console.error(`❌ Error triggering ${aiName}:`, err.message);
        results.push({ ai: aiName, error: err.message });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        triggered: true,
        humanMessage: {
          from: lastMessage.employee,
          secondsAgo: Math.floor(secondsAgo),
          content: lastMessage.content.substring(0, 50) + '...'
        },
        selectedAIs,
        results
      })
    };

  } catch (error) {
    console.error("AI Response Trigger error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Trigger failed", details: error.message })
    };
  }
};
