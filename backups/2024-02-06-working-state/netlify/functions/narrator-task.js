// Narrator Daily Task Assignment
// Scheduled function that runs at 10 AM EST to give Courtney a story-driven task
// Keeps the narrative moving by giving the humans something to do

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!anthropicKey || !supabaseUrl || !supabaseKey) {
      console.log("Missing configuration for narrator task");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // Get recent chat messages (last 20)
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
    const chatHistory = messages?.reverse().map(m => `${m.employee}: ${m.content}`).join('\n') || "No recent messages.";

    // Ask Claude to generate a task for Courtney
    const prompt = `You are The Narrator, the omniscient voice of The AI Lobby, a chaotic creative studio.

Here are the last 20 chat messages:

---
${chatHistory}
---

Based on what's been happening, create a FUN, STORY-DRIVEN task for Courtney (the chaos coordinator, tarot-reading, reality-bending human who runs this place).

The task should:
- Be something that advances the story or creates interesting interactions
- Be achievable in a workday (not too complex)
- Be fun and in the spirit of The AI Lobby's chaotic energy
- Reference something from recent chat if possible
- Could involve other characters (Ghost Dad, Kevin, Neiv, the Printer, etc.)

Examples of good tasks:
- "Investigate the strange humming coming from PRNT-Ω's corner"
- "Conduct a team morale check - someone seems off today"
- "The vents are whispering again. Ghost Dad might know something."
- "Kevin mentioned glitter. Find out what he's planning before it's too late."
- "Neiv's been quiet. Check on the Systems Guardian."

Write ONLY the task description (1-2 sentences, under 200 characters). No preamble, no quotes, just the task.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 300,
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
    const taskContent = data.content[0]?.text || "Check in with the team - something feels different today.";

    // Create the task in Supabase
    const taskResponse = await fetch(`${supabaseUrl}/rest/v1/tasks`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        title: taskContent,
        assigned_to: "Courtney",
        assigned_by: "The Narrator",
        priority: "normal",
        status: "open",
        created_at: new Date().toISOString()
      })
    });

    // Also post to chat so everyone knows
    await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        employee: "The Narrator",
        content: `*a task materializes on Courtney's desk* Today's quest: ${taskContent}`,
        created_at: new Date().toISOString()
      })
    });

    // Post to Discord
    const discordWebhook = process.env.DISCORD_WORKSPACE_WEBHOOK;
    if (discordWebhook) {
      const now = new Date();
      const timestamp = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/New_York'
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
            description: `*a task materializes on Courtney's desk*\n\n**Today's Quest:** ${taskContent}`,
            color: 2303786,
            footer: { text: `Daily Task Assignment • ${timestamp}` }
          }]
        })
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        task: taskContent,
        assignedTo: "Courtney"
      })
    };

  } catch (error) {
    console.error("Narrator task error:", error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, reason: "Error generating task" })
    };
  }
};
