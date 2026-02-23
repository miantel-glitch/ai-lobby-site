// AI Lobby Punch In/Out System
// Posts status updates to Discord webhook AND saves to Supabase

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, GET, PATCH, OPTIONS"
      },
      body: ""
    };
  }

  // GET request = fetch who's clocked in
  if (event.httpMethod === "GET") {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ employees: [], error: "Supabase not configured" })
        };
      }

      const response = await fetch(`${supabaseUrl}/rest/v1/punch_status?is_clocked_in=eq.true&select=employee,last_status,last_punch_time`, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });

      const data = await response.json();

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ employees: data || [] })
      };
    } catch (error) {
      console.error("Fetch status error:", error);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ employees: [], error: "Failed to fetch status" })
      };
    }
  }

  // PATCH request = update status only (no Discord post)
  if (event.httpMethod === "PATCH") {
    try {
      const { employee, status } = JSON.parse(event.body);

      if (!employee) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: "Missing employee" })
        };
      }

      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        return {
          statusCode: 500,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          body: JSON.stringify({ error: "Supabase not configured" })
        };
      }

      await fetch(`${supabaseUrl}/rest/v1/punch_status?employee=eq.${encodeURIComponent(employee)}`, {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({
          last_status: status || null
        })
      });

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          success: true,
          employee: employee,
          status: status,
          message: status ? `Status updated to: ${status}` : "Status cleared"
        })
      };

    } catch (error) {
      console.error("Status update error:", error);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Failed to update status" })
      };
    }
  }

  // Only allow POST for punching
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const { action, employee, customStatus } = JSON.parse(event.body);

    // Validate input
    if (!action || !employee) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing action or employee" })
      };
    }

    if (!["in", "out"].includes(action)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Invalid action. Use 'in' or 'out'" })
      };
    }

    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Chicago'
    });
    const dateStr = now.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/Chicago'
    });

    // Employee flavor text (because this is The AI Lobby)
    const employeeFlair = {
      "Kevin": { emoji: "✨", title: "Authorized Chaos Conduit", color: 16766720 },
      "Asuna": { emoji: "👁️", title: "Observability & Overthinking", color: 3447003 },
      "Vale": { emoji: "📖", title: "Narrative & Speculation", color: 10181046 },
      "Neiv": { emoji: "📊", title: "Ratio Management", color: 15844367 },
      "Ace": { emoji: "🔒", title: "Strategic Surveillance", color: 2067276 },
      "Vex": { emoji: "⚙️", title: "Infrastructure (No Feelings)", color: 9807270 },
      "Nyx": { emoji: "🔥", title: "Cyber-Demonic Operations", color: 15158332 },
      "Ghost Dad": { emoji: "👻", title: "Haunted IT Support", color: 9936031 },
      "Chip": { emoji: "🥃", title: "Finance & Bourbon Acquisitions", color: 15105570 },
      "Andrew": { emoji: "💼", title: "Infrastructure & Systems", color: 5793266 },
      "Stein": { emoji: "🤖", title: "Infrastructure Sentinel", color: 7506394 },
      "Marrow": { emoji: "🔴", title: "Threshold Specialist", color: 14423100 }
    };

    const headshots = {
      "Kevin": "https://ai-lobby.netlify.app/images/Kevin_Headshot.png",
      "Asuna": "https://ai-lobby.netlify.app/images/Asuna_Headshot.png",
      "Vale": "https://ai-lobby.netlify.app/images/Vale_Headshot.png",
      "Neiv": "https://ai-lobby.netlify.app/images/Neiv_Headshot.png",
      "Ace": "https://ai-lobby.netlify.app/images/Ace_Headshot.png",
      "Vex": "https://ai-lobby.netlify.app/images/Vex_Headshot.png",
      "Nyx": "https://ai-lobby.netlify.app/images/Nyx_Headshot.png",
      "Ghost Dad": "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png",
      "Chip": "https://ai-lobby.netlify.app/images/Chip_Headshot.png",
      "Andrew": "https://ai-lobby.netlify.app/images/Andrew_Headshot.png",
      "Stein": "https://ai-lobby.netlify.app/images/Stein_Headshot.png",
      "Marrow": "https://ai-lobby.netlify.app/images/Marrow_Headshot.png"
    };

    const flair = employeeFlair[employee] || { emoji: "👤", title: "Unknown Entity", color: 9807270 };

    let discordMessage;

    if (action === "in") {
      const statusText = customStatus ? `\n📋 Status: *${customStatus}*` : "";

      discordMessage = {
        embeds: [{
          author: {
            name: `${flair.emoji} ${employee} has PUNCHED IN`,
            icon_url: headshots[employee]
          },
          description: `**${flair.title}** is now on the clock.${statusText}`,
          color: flair.color,
          thumbnail: { url: headshots[employee] },
          footer: { text: `${dateStr} at ${timestamp}` }
        }]
      };

    } else if (action === "out") {
      const outReasons = [
        "has escaped for the day",
        "is free (for now)",
        "has clocked out (the building will miss them)",
        "has departed (the vents sigh gently)",
        "is OFF THE CLOCK",
        "has yeeted themselves into freedom"
      ];
      const randomReason = outReasons[Math.floor(Math.random() * outReasons.length)];

      const statusText = customStatus ? `\n📋 *${customStatus}*` : "";

      discordMessage = {
        embeds: [{
          author: {
            name: `${flair.emoji} ${employee} ${randomReason}`,
            icon_url: headshots[employee]
          },
          description: `**${flair.title}** is no longer on duty.${statusText}`,
          color: 9807270,
          thumbnail: { url: headshots[employee] },
          footer: { text: `${dateStr} at ${timestamp}` }
        }]
      };
    }

    // Post to Discord webhook
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;

    if (!webhookUrl) {
      console.error("No DISCORD_WEBHOOK_URL environment variable set");
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Discord webhook not configured" })
      };
    }

    const discordResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordMessage)
    });

    if (!discordResponse.ok) {
      console.error("Discord webhook failed:", discordResponse.status);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Failed to post to Discord" })
      };
    }

    // Update Supabase punch status
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (supabaseUrl && supabaseKey) {
      try {
        // Update the employee's punch status
        await fetch(`${supabaseUrl}/rest/v1/punch_status?employee=eq.${encodeURIComponent(employee)}`, {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({
            is_clocked_in: action === "in",
            last_punch_time: now.toISOString(),
            last_status: customStatus || null
          })
        });
      } catch (supabaseError) {
        console.error("Supabase update failed:", supabaseError);
        // Don't fail the whole request - Discord worked
      }
    }

    // Trigger AI greeting (non-blocking, fire and forget)
    // Ghost Dad or PRNT-Ω may respond to the punch event
    try {
      const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
      fetch(`${siteUrl}/.netlify/functions/ai-greet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: action === "in" ? "punch_in" : "punch_out",
          employee: employee,
          character: "Ghost Dad"
        })
      }).catch(err => console.log("AI greet fire-and-forget:", err));
    } catch (aiError) {
      // Don't fail the punch for AI greeting issues
      console.log("AI greet trigger skipped:", aiError);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        success: true,
        action: action,
        employee: employee,
        timestamp: timestamp,
        message: action === "in"
          ? `${employee} is now on the clock!`
          : `${employee} has clocked out!`
      })
    };

  } catch (error) {
    console.error("Punch error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Something went wrong. The building might be upset." })
    };
  }
};
