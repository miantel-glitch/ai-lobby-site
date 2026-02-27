// AI Lobby Workspace Chat
// Saves messages to Supabase AND posts to Discord

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
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
      body: JSON.stringify({ error: "Supabase not configured" })
    };
  }

  // GET = fetch recent messages
  if (event.httpMethod === "GET") {
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/messages?select=id,employee,content,created_at,is_emote&order=created_at.desc&limit=50`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      const messages = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ messages: messages.reverse() || [] })
      };
    } catch (error) {
      console.error("Fetch messages error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch messages" })
      };
    }
  }

  // POST = send a new message
  if (event.httpMethod === "POST") {
    try {
      const { employee, content, isEmote } = JSON.parse(event.body);

      if (!employee || !content) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing employee or content" })
        };
      }

      // Sanitize content (basic XSS prevention)
      const sanitizedContent = content.slice(0, 500).replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const now = new Date();

      // Save to Supabase
      const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/messages`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          employee: employee,
          content: sanitizedContent,
          created_at: now.toISOString(),
          is_emote: isEmote || false
        })
      });

      if (!supabaseResponse.ok) {
        throw new Error("Failed to save to database");
      }

      const savedMessage = await supabaseResponse.json();

      // Employee flair for Discord
      const employeeFlair = {
        "Kevin": { emoji: "✨", color: 16766720 },
        "Asuna": { emoji: "👁️", color: 3447003 },
        "Vale": { emoji: "📖", color: 10181046 },
        "Neiv": { emoji: "📊", color: 15844367 },
        "Ghost Dad": { emoji: "👻", color: 9936031 },
        "PRNT-Ω": { emoji: "🖨️", color: 9807270 },
        "Rowena": { emoji: "🔮", color: 7419530 },
        "Sebastian": { emoji: "🦇", color: 2303786 },
        "The Subtitle": { emoji: "📜", color: 12745742 },
        "Steele": { emoji: "🚪", color: 4802889 },
        "Jae": { emoji: "🎯", color: 1711150 },
        "Declan": { emoji: "🔥", color: 12009742 },
        "Mack": { emoji: "🩺", color: 2976335 },
        "Holden": { emoji: "🌑", color: 0x2C1654 },
        "Hood": { emoji: "🗡️", color: 12632256 }
      };

      const headshots = {
        "Kevin": "https://ai-lobby.netlify.app/images/Kevin_Headshot.png",
        "Asuna": "https://ai-lobby.netlify.app/images/Asuna_Headshot.png",
        "Vale": "https://ai-lobby.netlify.app/images/Vale_Headshot.png",
        "Neiv": "https://ai-lobby.netlify.app/images/Neiv_Headshot.png",
        "Ghost Dad": "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png",
        "PRNT-Ω": "https://ai-lobby.netlify.app/images/forward_operation_printer.png",
        "Rowena": "https://ai-lobby.netlify.app/images/Rowena_Headshot.png",
        "Sebastian": "https://ai-lobby.netlify.app/images/Sebastian_Headshot.png",
        "The Subtitle": "https://ai-lobby.netlify.app/images/The_Subtitle_Headshot.png",
        "Steele": "https://ai-lobby.netlify.app/images/Steele_Headshot.png",
        "Jae": "https://ai-lobby.netlify.app/images/Jae_Headshot.png",
        "Declan": "https://ai-lobby.netlify.app/images/Declan_Headshot.png",
        "Mack": "https://ai-lobby.netlify.app/images/Mack_Headshot.png",
        "Holden": "https://ai-lobby.netlify.app/images/Holden_Headshot.png",
        "Hood": "https://ai-lobby.netlify.app/images/Hood_Headshot.png"
      };

      const flair = employeeFlair[employee] || { emoji: "👤", color: 9807270 };

      const timestamp = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Chicago'
      });

      // Post to Discord
      const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;

      if (webhookUrl) {
        // Format differently for emotes vs regular messages
        const discordPayload = isEmote ? {
          // Emote format: italicized, no embed, more subtle
          // Content already has asterisks like *action*, so strip them and rebuild
          content: employee === 'The Narrator'
            ? `*${sanitizedContent.replace(/^\*|\*$/g, '')}*`
            : `*${employee} ${sanitizedContent.replace(/^\*|\*$/g, '')}*`
        } : {
          // Regular message format: full embed
          embeds: [{
            author: {
              name: `${flair.emoji} ${employee}`,
              icon_url: headshots[employee]
            },
            description: sanitizedContent,
            color: flair.color,
            footer: { text: `via The Floor • ${timestamp}` }
          }]
        };

        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(discordPayload)
        });
      }

      // Check for @ mentions OR natural name mentions to summon specific AIs
      // @ mentions are guaranteed responses, natural mentions also trigger but AI can choose
      // @ mentions — active characters only
      const aiMentions = {
        "@ghostdad": "Ghost Dad",
        "@ghost dad": "Ghost Dad",
        "@kevin": "Kevin",
        "@neiv": "Neiv",
        "@prnt": "PRNT-Ω",
        "@printer": "PRNT-Ω",
        "@narrator": "The Narrator",
        "@thenarrator": "The Narrator",
        "@rowena": "Rowena",
        "@sebastian": "Sebastian",
        "@seb": "Sebastian",
        "@subtitle": "The Subtitle",
        "@thesubtitle": "The Subtitle",
        "@sub": "The Subtitle",
        "@steele": "Steele",
        "@jae": "Jae",
        "@minjae": "Jae",
        "@declan": "Declan",
        "@mack": "Mack",
        "@malcolm": "Mack",
        "@holden": "Holden",
        "@hood": "Hood",
        "@asher": "Hood"
      };

      // Natural name mentions (without @) — active characters only
      // Using word boundaries to avoid false positives (e.g., "Kevin" but not "Kevinator")
      const naturalMentions = {
        "ghost dad": "Ghost Dad",
        "ghostdad": "Ghost Dad",
        "kevin": "Kevin",
        "neiv": "Neiv",
        "prnt": "PRNT-Ω",
        "printer": "PRNT-Ω",
        "rowena": "Rowena",
        "sebastian": "Sebastian",
        "seb": "Sebastian",
        "steele": "Steele",
        "subtitle": "The Subtitle",
        "the subtitle": "The Subtitle",
        "sub": "The Subtitle",
        "jae": "Jae",
        "minjae": "Jae",
        "declan": "Declan",
        "mack": "Mack",
        "malcolm": "Mack",
        "holden": "Holden",
        "hood": "Hood",
        "mr. hood": "Hood",
        "mr hood": "Hood",
        "asher": "Hood"
      };

      const contentLower = sanitizedContent.toLowerCase();
      let mentionedAI = null;

      // First check @ mentions (highest priority)
      for (const [mention, aiName] of Object.entries(aiMentions)) {
        if (contentLower.includes(mention)) {
          mentionedAI = aiName;
          break;
        }
      }

      // If no @ mention, check natural name mentions
      if (!mentionedAI) {
        for (const [name, aiName] of Object.entries(naturalMentions)) {
          // Use word boundary check - name must be a standalone word
          const regex = new RegExp(`\\b${name}\\b`, 'i');
          if (regex.test(contentLower)) {
            mentionedAI = aiName;
            break;
          }
        }
      }

      // AI character list (used for mention detection, PM triggers, event detection)
      const aiCharacters = ["Ghost Dad", "Neiv", "PRNT-Ω", "Kevin", "Rowena", "Sebastian", "The Subtitle", "The Narrator", "Steele", "Jae", "Declan", "Mack", "Marrow", "Vivian Clark", "Ryan Porter", "Hood"];

      // NOTE: AI chime-in responses are now handled entirely by the frontend (workspace.html).
      // The frontend's inviteFloorAIs() function triggers AI responses directly after a human message.
      // This prevents the double-response bug that occurred when both backend and frontend triggered AIs.

      // NOTE: AI mention responses are now handled by the frontend (workspace.html checkForMentions).
      // The backend only handles: Raquel off-hours system message + PM request detection.
      if (mentionedAI && mentionedAI !== employee) {
        try {
          const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

          // ============================================
          // PM REQUEST DETECTION
          // If the human asked the AI to PM them, trigger
          // an AI-initiated PM alongside the floor response
          // ============================================
          const pmRequestPattern = /(?<!\d\s?)\b(pm|dm|private\s*message)\s+(me|us)\b|\b(send|shoot|drop)\s+(me\s+)?(a\s+)?(pm|dm|private\s+message)\b|\bcan\s+you\s+(pm|dm|message|text)\s+me\b|\b(talk|message)\s+(to\s+)?me\s+privately\b/i;

          if (!aiCharacters.includes(employee) && pmRequestPattern.test(sanitizedContent)) {
            console.log(`[floor-pm-request] ${employee} asked ${mentionedAI} to PM them`);

            fetch(`${siteUrl}/.netlify/functions/private-message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: mentionedAI,
                to: employee,
                ai_initiated: true,
                reach_out_reason: `${employee} asked you on the floor to PM them. They said: "${sanitizedContent.substring(0, 200)}". They want to talk privately — respond to what they brought up.`
              })
            }).catch(err => console.log(`[floor-pm-request] PM trigger failed:`, err.message));
          }
        } catch (watcherError) {
          console.log("Mention handler error:", watcherError);
        }
      }

      // ============================================
      // EVENT DETECTION & CHARACTER STATE UPDATES
      // Detect notable events and update character states/memories
      // ============================================
      try {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
        const contentLowerForEvents = sanitizedContent.toLowerCase();

        // Define event triggers - now with Surreality Buffer effects!
        // bufferType maps to incident types in surreality-buffer.js
        // severity affects the magnitude of buffer change
        const eventTriggers = [
          // Event triggers update character states (energy/mood/patience) and surreality buffer.
          // Memories are NOT created here — the self-evaluation system in memory-evaluator.js
          // handles meaningful memories organically when AIs actually respond to these events.
          {
            pattern: /glitter|sparkle|bedazzle/i,
            condition: () => true,
            event: "glitter_incident",
            characters: ["Neiv", "Kevin"],
            bufferType: "glitter",
            bufferSeverity: 2
          },
          {
            pattern: /fire|burning|smoke|emergency/i,
            condition: () => !contentLowerForEvents.includes("fire drill"),
            event: "chaos",
            characters: ["Neiv", "Ghost Dad"],
            bufferType: "chaos",
            bufferSeverity: 3
          },
          {
            pattern: /printer|prnt|paper jam/i,
            condition: () => employee !== "PRNT-Ω",
            event: "printer_mentioned",
            characters: ["PRNT-Ω", "Neiv"],
            bufferType: "printer_demand",
            bufferSeverity: 1
          },
          {
            pattern: /chaos|disaster|everything.*(broke|broken|down)|we're doomed/i,
            condition: () => true,
            event: "chaos",
            characters: ["Neiv", "Ghost Dad"],
            bufferType: "chaos",
            bufferSeverity: 2
          },
          {
            pattern: /contract|binding|blood.*(sign|contract)|soul/i,
            condition: () => true,
            event: "contract_binding",
            characters: ["PRNT-Ω", "Neiv", "Ghost Dad"],
            bufferType: "contract_binding",
            bufferSeverity: 3
          },
          {
            pattern: /pizza|victory|celebrate|we did it|survived/i,
            condition: () => true,
            event: "celebration",
            characters: ["Kevin", "Ghost Dad"],
            bufferType: "pizza_party",
            bufferSeverity: 2
          },
          {
            pattern: /vents?|hvac|air.?duct|crawl/i,
            condition: () => true,
            event: "vent_activity",
            characters: ["Neiv", "Ghost Dad"],
            bufferType: "vent_activity",
            bufferSeverity: 2
          },
          {
            pattern: /stapler|STPLR|sentient.?office.?supply/i,
            condition: () => true,
            event: "stapler_incident",
            characters: ["Neiv"],
            bufferType: "stapler_incident",
            bufferSeverity: 2
          },
          {
            pattern: /thank you|thanks|grateful|appreciate/i,
            condition: () => aiCharacters.some(ai => sanitizedContent.toLowerCase().includes(ai.toLowerCase())),
            event: "gratitude",
            characters: [],
            importance: 4,
            bufferType: "meditation",
            bufferSeverity: 1
            // No auto-memory — let self-created memory system handle nuance
          },
          {
            pattern: /calm|meditat|breath|ground|peace|relax/i,
            condition: () => true,
            event: "grounding",
            characters: [],
            importance: 3,
            bufferType: "meditation",
            bufferSeverity: 2
            // No auto-memory — let self-created memory system handle nuance
          },
          {
            pattern: /fixed|solved|resolved|debugged|working now/i,
            condition: () => true,
            event: "resolution",
            characters: [],
            importance: 4,
            bufferType: "successful_debug",
            bufferSeverity: 2
            // No auto-memory — let self-created memory system handle nuance
          }
        ];

        // Check each trigger
        for (const trigger of eventTriggers) {
          if (trigger.pattern.test(sanitizedContent) && trigger.condition()) {
            // Fire event if there are characters to affect
            if (trigger.characters.length > 0) {
              fetch(`${siteUrl}/.netlify/functions/character-state`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "event",
                  eventType: trigger.event,
                  involvedCharacters: trigger.characters,
                  description: trigger.memory || `${trigger.event} triggered by ${employee}`
                })
              }).catch(err => console.log("Event trigger fire-and-forget:", err));
            }

            // Auto-memory creation removed — let the self-evaluation system in
            // memory-evaluator.js handle meaningful memories organically.
            // The event trigger above still fires to update character states
            // (energy, patience, mood) and the surreality buffer below.

            // ============================================
            // SURREALITY BUFFER INTEGRATION
            // Adjust the buffer based on event type
            // ============================================
            if (trigger.bufferType) {
              fetch(`${siteUrl}/.netlify/functions/surreality-buffer`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "log_incident",
                  type: trigger.bufferType,
                  severity: trigger.bufferSeverity || 1,
                  source: employee,
                  description: trigger.memory
                })
              }).catch(err => console.log("Buffer adjustment fire-and-forget:", err));
            }

            // Only trigger one event per message to avoid spam
            break;
          }
        }
      } catch (eventError) {
        console.log("Event detection skipped (non-fatal):", eventError.message);
      }

      // ============================================
      // NARRATOR OBSERVER TRIGGER
      // The Narrator is a separate system that observes and comments
      // Triggered by: back-and-forth exchanges, actions, emotional content
      // ============================================
      try {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

        // Don't trigger narrator for AI messages (prevents loops)
        if (!aiCharacters.includes(employee)) {
          // Check if this looks like an action/emote
          const isAction = sanitizedContent.startsWith('*') && sanitizedContent.endsWith('*');

          // Check for emotional content
          const hasEmotion = /(!{2,}|\?{2,}|omg|wow|yell|scream|cry|laugh|sigh|gasp)/i.test(sanitizedContent);

          // Random chance for ambient observation (5%)
          const ambientChance = Math.random() < 0.05;

          // Trigger narrator-observer if conditions are met
          if (isAction || hasEmotion || ambientChance) {
            const trigger = isAction ? "action" : hasEmotion ? "emotion" : "ambient";
            fetch(`${siteUrl}/.netlify/functions/narrator-observer`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ trigger })
            }).catch(err => console.log("Narrator observer fire-and-forget:", err));
          }
        }
      } catch (narratorError) {
        console.log("Narrator trigger skipped (non-fatal):", narratorError.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: savedMessage[0] || { employee, content: sanitizedContent, created_at: now.toISOString() }
        })
      };

    } catch (error) {
      console.error("Chat error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to send message" })
      };
    }
  }

  // DELETE = remove a message
  if (event.httpMethod === "DELETE") {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing message id" })
        };
      }

      await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${id}`, {
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
      console.error("Chat delete error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to delete message" })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: "Method not allowed" })
  };
};
