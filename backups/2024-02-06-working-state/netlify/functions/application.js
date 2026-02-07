// AI Lobby Employment Application Handler
// Posts applications to Discord for review

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
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

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
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
