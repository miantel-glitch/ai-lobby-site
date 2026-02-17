// AI Lobby Internal Email/Memo System
// Public emails for lore building - everyone can see!

const { createEmailMemory } = require('./shared/email-memory');

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, DELETE, PATCH, OPTIONS",
    "Content-Type": "application/json"
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
      body: JSON.stringify({ error: "Database not configured" })
    };
  }

  // GET = fetch emails
  if (event.httpMethod === "GET") {
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/emails?select=id,from_employee,to_employee,subject,body,read_by,created_at&order=created_at.desc&limit=50`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      const emails = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ emails: emails || [] })
      };
    } catch (error) {
      console.error("Fetch emails error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch emails" })
      };
    }
  }

  // PATCH = mark email as read by a character
  if (event.httpMethod === "PATCH") {
    try {
      const { id, employee, action } = JSON.parse(event.body);

      // Mark ALL emails as read for this employee
      if (action === 'markAllRead' && employee) {
        // Get all emails
        const getAllResponse = await fetch(
          `${supabaseUrl}/rest/v1/emails?select=id,read_by`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );

        const allEmails = await getAllResponse.json();

        // Update each email that the employee hasn't read
        for (const email of allEmails) {
          const currentReadBy = email.read_by || [];
          if (!currentReadBy.includes(employee)) {
            currentReadBy.push(employee);
            await fetch(`${supabaseUrl}/rest/v1/emails?id=eq.${email.id}`, {
              method: "PATCH",
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json",
                "Prefer": "return=minimal"
              },
              body: JSON.stringify({ read_by: currentReadBy })
            });
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, markedCount: allEmails.length })
        };
      }

      // Mark single email as read
      if (!id || !employee) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing email id or employee" })
        };
      }

      // First, get current read_by array
      const getResponse = await fetch(
        `${supabaseUrl}/rest/v1/emails?id=eq.${id}&select=read_by`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      const emailData = await getResponse.json();
      const currentReadBy = emailData[0]?.read_by || [];

      // Add employee if not already in the array
      if (!currentReadBy.includes(employee)) {
        currentReadBy.push(employee);

        // Update the email
        await fetch(`${supabaseUrl}/rest/v1/emails?id=eq.${id}`, {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ read_by: currentReadBy })
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, read_by: currentReadBy })
      };

    } catch (error) {
      console.error("Mark read error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to mark as read" })
      };
    }
  }

  // POST = send a new email
  if (event.httpMethod === "POST") {
    try {
      const { from_employee, to_employee, subject, body } = JSON.parse(event.body);

      if (!from_employee || !to_employee || !subject || !body) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing required fields" })
        };
      }

      // Sanitize inputs
      const sanitizedSubject = subject.slice(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const sanitizedBody = body.slice(0, 2000).replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const now = new Date();

      // Save to Supabase
      const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/emails`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          from_employee,
          to_employee,
          subject: sanitizedSubject,
          body: sanitizedBody,
          created_at: now.toISOString()
        })
      });

      if (!supabaseResponse.ok) {
        throw new Error("Failed to save email");
      }

      const savedEmail = await supabaseResponse.json();

      // Employee flair for Discord
      const employeeFlair = {
        "Kevin": { emoji: "✨", color: 16766720 },
        "Asuna": { emoji: "👁️", color: 3447003 },
        "Vale": { emoji: "📖", color: 10181046 },
        "Neiv": { emoji: "📊", color: 15844367 },
        "Ace": { emoji: "🔒", color: 2067276 },
        "Vex": { emoji: "⚙️", color: 9807270 },
        "Nyx": { emoji: "🔥", color: 15158332 },
        "Ghost Dad": { emoji: "👻", color: 9936031 },
        "Chip": { emoji: "🥃", color: 15105570 },
        "Andrew": { emoji: "💼", color: 5793266 },
        "Stein": { emoji: "🤖", color: 7506394 }
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
        "Stein": "https://ai-lobby.netlify.app/images/Stein_Headshot.png"
      };

      const flair = employeeFlair[from_employee] || { emoji: "👤", color: 9807270 };

      const timestamp = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Chicago'
      });

      // Post to Discord
      const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;

      if (webhookUrl) {
        const toDisplay = to_employee === "All Staff" ? "📢 All Staff" : `→ ${to_employee}`;
        const toEmoji = employeeFlair[to_employee]?.emoji || "👤";

        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              author: {
                name: `📧 INTERNAL MEMO`,
                icon_url: headshots[from_employee]
              },
              title: sanitizedSubject,
              description: `**From:** ${flair.emoji} ${from_employee}\n**To:** ${toEmoji} ${toDisplay}\n\n${sanitizedBody}`,
              color: flair.color,
              thumbnail: { url: headshots[from_employee] },
              footer: { text: `via Lobby Mail • ${timestamp}` }
            }]
          })
        });
      }

      // Fire-and-forget: Create memories for AI recipients
      createEmailMemory(
        { from_employee, to_employee, subject: sanitizedSubject, body: sanitizedBody },
        supabaseUrl,
        supabaseKey
      ).catch(err => console.log('[email] Memory creation failed (non-fatal):', err.message));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          email: savedEmail[0]
        })
      };

    } catch (error) {
      console.error("Email send error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to send email" })
      };
    }
  }

  // DELETE = remove an email
  if (event.httpMethod === "DELETE") {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing email id" })
        };
      }

      await fetch(`${supabaseUrl}/rest/v1/emails?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };

    } catch (error) {
      console.error("Email delete error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to delete email" })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: "Method not allowed" })
  };
};
