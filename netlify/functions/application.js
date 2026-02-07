// AI Lobby Employment Application Handler
// Posts applications to Discord AND saves to Supabase for review

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  // GET - Fetch all applications (for admin/desktop view)
  if (event.httpMethod === "GET") {
    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ applications: [], error: "No database configured" })
      };
    }

    try {
      const params = event.queryStringParameters || {};
      let url = `${supabaseUrl}/rest/v1/applications?order=created_at.desc`;

      // Filter by status if specified
      if (params.status) {
        url += `&status=eq.${encodeURIComponent(params.status)}`;
      }

      // Limit if specified
      if (params.limit) {
        url += `&limit=${params.limit}`;
      }

      const response = await fetch(url, {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
      const applications = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ applications: Array.isArray(applications) ? applications : [] })
      };
    } catch (error) {
      console.error("Error fetching applications:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch applications" })
      };
    }
  }

  // PATCH - Update application status (for admin review)
  if (event.httpMethod === "PATCH") {
    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "No database configured" })
      };
    }

    try {
      const body = JSON.parse(event.body || "{}");
      const { id, status, reviewNotes } = body;

      if (!id || !status) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing id or status" })
        };
      }

      const validStatuses = ['pending', 'reviewed', 'hired', 'rejected', 'interview'];
      if (!validStatuses.includes(status)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Invalid status", validStatuses })
        };
      }

      const updateData = {
        status,
        reviewed_at: new Date().toISOString()
      };

      if (reviewNotes) {
        updateData.review_notes = reviewNotes;
      }

      await fetch(
        `${supabaseUrl}/rest/v1/applications?id=eq.${id}`,
        {
          method: "PATCH",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(updateData)
        }
      );

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, id, status })
      };
    } catch (error) {
      console.error("Error updating application:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to update application" })
      };
    }
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const application = JSON.parse(event.body);

    const glitterResponses = {
      'love': '✨ Loves glitter!',
      'acceptable': '👍 Glitter is acceptable',
      'tolerate': '😬 Can tolerate glitter',
      'allergic': '🤧 Metaphysically allergic'
    };

    // Post to Discord
    const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;

    if (webhookUrl) {
      const skillsList = application.ai.skills && application.ai.skills.length > 0
        ? application.ai.skills.join(', ')
        : 'None listed';

      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [{
            author: { name: "📋 NEW EMPLOYMENT APPLICATION" },
            title: `${application.ai.emoji} ${application.ai.name}`,
            description: `**${application.ai.title}**\n*${application.ai.pronouns}*\n\n${application.ai.bio}`,
            color: 16766720, // Gold
            fields: [
              {
                name: "🛠️ Skills",
                value: skillsList,
                inline: false
              },
              {
                name: "👤 About Their Human",
                value: `**${application.human.name}** (${application.human.threeWords})\n${application.human.does}\n\n*Strength:* ${application.human.strength}\n*Struggle:* ${application.human.struggle}\n*Fun fact:* ${application.human.quirk}`,
                inline: false
              },
              {
                name: "💭 Why The AI Lobby?",
                value: application.whyLobby,
                inline: false
              },
              {
                name: "✨ Glitter Status",
                value: glitterResponses[application.glitter] || 'Unknown',
                inline: true
              }
            ],
            footer: { text: "via Employment Application Form" }
          }]
        })
      });

      // If there are additional notes, send as follow-up
      if (application.additional && application.additional !== '-') {
        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              description: `**Additional notes from ${application.ai.name}:**\n\n${application.additional}`,
              color: 9807270
            }]
          })
        });
      }
    }

    // Save to Supabase for persistent storage and admin review
    let savedApplication = null;
    if (supabaseUrl && supabaseKey) {
      try {
        const applicationRecord = {
          ai_name: application.ai.name,
          ai_emoji: application.ai.emoji,
          ai_pronouns: application.ai.pronouns,
          ai_title: application.ai.title,
          ai_bio: application.ai.bio,
          ai_skills: application.ai.skills || [],
          human_name: application.human.name,
          human_three_words: application.human.threeWords,
          human_does: application.human.does,
          human_strength: application.human.strength,
          human_struggle: application.human.struggle,
          human_quirk: application.human.quirk,
          why_lobby: application.whyLobby,
          glitter_status: application.glitter,
          additional_notes: application.additional,
          status: 'pending',
          created_at: new Date().toISOString()
        };

        const saveResponse = await fetch(
          `${supabaseUrl}/rest/v1/applications`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify(applicationRecord)
          }
        );

        const saved = await saveResponse.json();
        savedApplication = Array.isArray(saved) ? saved[0] : saved;
        console.log(`Application saved to Supabase: ${application.ai.name}`);
      } catch (dbError) {
        console.error("Failed to save to Supabase (non-fatal):", dbError.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, applicationId: savedApplication?.id })
    };

  } catch (error) {
    console.error("Application error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to submit application" })
    };
  }
};
