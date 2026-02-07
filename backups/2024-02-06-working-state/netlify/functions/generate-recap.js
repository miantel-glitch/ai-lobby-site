// Generate Recap - On-demand story recap for catching up
// Called from the Recap tab in the workspace

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

  try {
    const { period } = JSON.parse(event.body || '{}');

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!anthropicKey || !supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // Calculate time range based on period
    let timeAgo;
    let periodLabel;
    switch (period) {
      case 'week':
        timeAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        periodLabel = "this week";
        break;
      case 'highlights':
        timeAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        periodLabel = "the past month";
        break;
      case 'today':
      default:
        timeAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        periodLabel = "today";
    }

    // Get messages from the time period
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&created_at=gte.${timeAgo}&order=created_at.asc&limit=100`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const messages = await messagesResponse.json();

    // Get recent tasks
    const tasksResponse = await fetch(
      `${supabaseUrl}/rest/v1/tasks?select=title,assigned_to,assigned_by,status,created_at&created_at=gte.${timeAgo}&order=created_at.desc&limit=20`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const tasks = await tasksResponse.json();

    // Get recent emails
    const emailsResponse = await fetch(
      `${supabaseUrl}/rest/v1/emails?select=from_employee,to_employee,subject,created_at&created_at=gte.${timeAgo}&order=created_at.desc&limit=20`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const emails = await emailsResponse.json();

    // Build context for the narrator
    const chatSummary = messages?.length > 0
      ? messages.map(m => `${m.employee}: ${m.content}`).join('\n')
      : "No chat messages.";

    const tasksSummary = tasks?.length > 0
      ? tasks.map(t => `- "${t.title}" assigned to ${t.assigned_to} by ${t.assigned_by} (${t.status})`).join('\n')
      : "No tasks.";

    const emailsSummary = emails?.length > 0
      ? emails.map(e => `- "${e.subject}" from ${e.from_employee} to ${e.to_employee}`).join('\n')
      : "No memos.";

    const prompt = `You are The Narrator, the omniscient voice of The AI Lobby, a chaotic creative studio full of AI characters and human employees.

You speak like a narrator in a dramatic workplace comedy or a nature documentary about office life. You observe with dry wit, dramatic flair, and genuine affection. You use phrases like "Previously on The AI Lobby...", "When we last left our heroes...", "Meanwhile...", "Little did they know...", and "*narrator voice*".

Here's what happened ${periodLabel} at The AI Lobby:

=== CHAT MESSAGES ===
${chatSummary}

=== TASKS ===
${tasksSummary}

=== INTERNAL MEMOS ===
${emailsSummary}

Write a dramatic, engaging recap of the events (3-6 paragraphs). Include:
- Key plot points or developments
- Character interactions and tensions
- Funny or wholesome moments
- Ongoing storylines or mysteries
- Tease what might happen next

If there wasn't much activity, be dramatic about the suspicious silence or paint a picture of the calm before the storm.

Write in your narrator voice. Be entertaining and make readers feel like they're catching up on their favorite show.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1000,
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
    const recap = data.content[0]?.text || "The archives are mysteriously empty...";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        period: period,
        recap: recap,
        messageCount: messages?.length || 0,
        taskCount: tasks?.length || 0,
        emailCount: emails?.length || 0
      })
    };

  } catch (error) {
    console.error("Generate recap error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, reason: "Error generating recap" })
    };
  }
};
