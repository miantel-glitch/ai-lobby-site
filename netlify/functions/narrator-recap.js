// Narrator Daily Recap - "Previously on The AI Lobby..."
// Scheduled function that runs at 7 AM EST to recap yesterday and kick off the day
// This ensures there's always activity to trigger story mode

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;
    const discordWebhook = process.env.DISCORD_WORKSPACE_WEBHOOK;

    if (!anthropicKey || !supabaseUrl || !supabaseKey) {
      console.log("Missing configuration for narrator recap");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // Get yesterday's messages (last 24 hours)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&created_at=gte.${oneDayAgo}&order=created_at.asc&limit=50`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const messages = await messagesResponse.json();

    // Build chat summary for the narrator
    let chatSummary = "No messages from yesterday.";
    if (messages && messages.length > 0) {
      chatSummary = messages.map(m => `${m.employee}: ${m.content}`).join('\n');
    }

    // Get who's currently clocked in
    const punchResponse = await fetch(
      `${supabaseUrl}/rest/v1/punch_status?is_clocked_in=eq.true&select=employee`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const clockedIn = await punchResponse.json();
    const clockedInList = clockedIn?.map(p => p.employee).join(', ') || 'No one';

    // Get current Surreality Buffer status
    let bufferInfo = "The Surreality Buffer hums at a stable 50%.";
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      const bufferRes = await fetch(`${siteUrl}/.netlify/functions/surreality-buffer`);
      if (bufferRes.ok) {
        const bufferStatus = await bufferRes.json();
        const level = bufferStatus.level || 50;
        const status = bufferStatus.status || 'elevated';
        const lastIncident = bufferStatus.last_incident;

        // Build buffer narrative
        if (level >= 80) {
          bufferInfo = `The Surreality Buffer strains at ${level}% (${status.toUpperCase()}). ${lastIncident ? `Last incident: ${lastIncident}.` : 'Reality itself seems uncertain.'} The office needs stabilization.`;
        } else if (level >= 65) {
          bufferInfo = `The Surreality Buffer sits at ${level}% (${status}). ${lastIncident ? `Last noted: ${lastIncident}.` : 'Things are... spicy.'} Could go either way.`;
        } else if (level >= 40) {
          bufferInfo = `The Surreality Buffer holds at ${level}% (${status}). ${lastIncident ? `Last incident: ${lastIncident}.` : 'Functional weirdness.'} Business as unusual.`;
        } else {
          bufferInfo = `The Surreality Buffer rests at ${level}% (${status}). ${lastIncident ? `Last event: ${lastIncident}.` : 'The office is... calm?'} Almost suspiciously normal.`;
        }
      }
    } catch (bufferErr) {
      console.log('Could not fetch buffer for recap:', bufferErr.message);
    }

    // Ask Claude to generate the narrator's recap
    const prompt = `You are The Narrator, an omniscient voice that provides third-person story commentary for The AI Lobby, a chaotic creative studio full of AI characters and human employees.

You speak like a narrator in a dramatic workplace comedy or a nature documentary about office life. You observe with dry wit, dramatic flair, and genuine affection. You use phrases like "Previously on The AI Lobby...", "When we last left our heroes...", "Little did they know...", and "*narrator voice*".

Here are the messages from the last 24 hours at The AI Lobby:

---
${chatSummary}
---

Currently clocked in: ${clockedInList}

**SURREALITY BUFFER STATUS:** ${bufferInfo}

Write a brief "Previously on The AI Lobby..." morning recap (2-4 sentences, under 400 characters). Include:
- A summary of any drama, tensions, or wholesome moments from yesterday
- A brief mention of the Surreality Buffer status (it's the central mechanic everyone works around!)
- Something that invites the day to begin

If there wasn't much activity, be dramatic about the eerie silence or tease what might happen today. End with something like "And so, a new day dawns..." or "Stay tuned..."

Just write the recap directly, no preamble.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "AI API error" })
      };
    }

    const data = await response.json();
    const narratorRecap = data.content[0]?.text || "*The Narrator clears throat* Previously on The AI Lobby... actually, the tapes are missing. How mysterious. Stay tuned.";

    // Save to chat
    await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        employee: "The Narrator",
        content: narratorRecap,
        created_at: new Date().toISOString()
      })
    });

    // Post to Discord
    if (discordWebhook) {
      const now = new Date();
      const timestamp = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Chicago'
      });

      await fetch(discordWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            author: {
              name: "📖 The Narrator",
              icon_url: "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png"
            },
            description: narratorRecap,
            color: 2303786,
            footer: { text: `Morning Recap • ${timestamp}` }
          }]
        })
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        recap: narratorRecap
      })
    };

  } catch (error) {
    console.error("Narrator recap error:", error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, reason: "Error generating recap" })
    };
  }
};
