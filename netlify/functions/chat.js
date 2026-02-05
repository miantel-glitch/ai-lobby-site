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
        "Courtney": { emoji: "👁️", color: 3447003 },
        "Jenna": { emoji: "📖", color: 10181046 },
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
        "Courtney": "https://ai-lobby.netlify.app/images/Courtney_Headshot.png",
        "Jenna": "https://ai-lobby.netlify.app/images/Jenna_Headshot.png",
        "Neiv": "https://ai-lobby.netlify.app/images/Neiv_Headshot.png",
        "Ace": "https://ai-lobby.netlify.app/images/Ace_Headshot.png",
        "Vex": "https://ai-lobby.netlify.app/images/Vex_Headshot.png",
        "Nyx": "https://ai-lobby.netlify.app/images/Nyx_Headshot.png",
        "Ghost Dad": "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png",
        "Chip": "https://ai-lobby.netlify.app/images/Chip_Headshot.png",
        "Andrew": "https://ai-lobby.netlify.app/images/Andrew_Headshot.png",
        "Stein": "https://ai-lobby.netlify.app/images/Stein_Headshot.png"
      };

      const flair = employeeFlair[employee] || { emoji: "👤", color: 9807270 };

      const timestamp = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/New_York'
      });

      // Post to Discord
      const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;

      if (webhookUrl) {
        // Format differently for emotes vs regular messages
        const discordPayload = isEmote ? {
          // Emote format: italicized, no embed, more subtle
          // Content already has asterisks like *action*, so strip them and rebuild
          content: `*${employee} ${sanitizedContent.replace(/^\*|\*$/g, '')}*`
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

      // Check for @ mentions to summon specific AIs
      const aiMentions = {
        "@ghostdad": "Ghost Dad",
        "@ghost dad": "Ghost Dad",
        "@kevin": "Kevin",
        "@neiv": "Neiv",
        "@vex": "Vex",
        "@nyx": "Nyx",
        "@ace": "Ace",
        "@prnt": "PRNT-Ω",
        "@printer": "PRNT-Ω",
        "@stein": "Stein",
        "@narrator": "The Narrator",
        "@thenarrator": "The Narrator"
      };

      const contentLower = sanitizedContent.toLowerCase();
      let mentionedAI = null;

      for (const [mention, aiName] of Object.entries(aiMentions)) {
        if (contentLower.includes(mention)) {
          mentionedAI = aiName;
          break;
        }
      }

      // Trigger AI response - @ mentions get guaranteed response, otherwise 50% chance to chime in
      const aiCharacters = ["Ghost Dad", "Neiv", "Vex", "Nyx", "Ace", "PRNT-Ω", "Stein", "Kevin", "The Narrator"];

      // Characters that use Perplexity API instead of Claude (more authentic voices)
      const perplexityCharacters = ["Neiv"];
      // Characters that use OpenAI/ChatGPT API
      const openaiCharacters = ["Kevin"];

      // Human posted a message - invite ALL available AIs to consider responding (if no @ mention)
      // Each AI decides for themselves if they want to chime in!
      if (!aiCharacters.includes(employee) && !mentionedAI) {
        try {
          const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

          // Get recent chat for context
          const recentMessages = await fetch(
            `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&order=created_at.desc&limit=15`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          );
          const messages = await recentMessages.json();
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

          // Always include Ghost Dad and PRNT-Ω (they transcend the timeclock)
          const alwaysAvailable = ["Ghost Dad", "PRNT-Ω"];
          const availableAIs = [...new Set([...clockedInAIs, ...alwaysAvailable])];

          console.log(`📢 Inviting AIs to consider chiming in: ${availableAIs.join(', ')}`);

          // Pick 1-2 random AIs to actually ask (prevents spam, still feels organic)
          // Shuffle the available AIs and pick up to 2
          const shuffledAIs = availableAIs.sort(() => Math.random() - 0.5);
          const selectedAIs = shuffledAIs.slice(0, Math.min(2, shuffledAIs.length));
          console.log(`📢 Selected AIs to ask: ${selectedAIs.join(', ')}`);

          // Fire off requests to selected AIs (fire and forget - no await, no setTimeout)
          // These will complete in the background after this function returns
          for (const aiName of selectedAIs) {
            if (perplexityCharacters.includes(aiName)) {
              // Neiv uses Perplexity - ask if he wants to respond
              fetch(`${siteUrl}/.netlify/functions/ai-perplexity`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  character: aiName,
                  chatHistory,
                  maybeRespond: true  // Flag: this is optional, AI decides
                })
              }).catch(err => console.log(`${aiName} chime check error:`, err));
            } else if (openaiCharacters.includes(aiName)) {
              // Kevin uses OpenAI - ask if he wants to respond
              fetch(`${siteUrl}/.netlify/functions/ai-openai`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  character: aiName,
                  chatHistory,
                  maybeRespond: true
                })
              }).catch(err => console.log(`${aiName} chime check error:`, err));
            } else {
              // Everyone else uses Claude via ai-watcher
              fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  trigger: "maybe_chime",
                  requestedAI: aiName,
                  chatHistory: chatHistory  // Pass context so AI can decide
                })
              }).catch(err => console.log(`${aiName} chime check error:`, err));
            }
          }
        } catch (chimeError) {
          console.log("Chime-in invites skipped:", chimeError);
        }
      }

      if (!aiCharacters.includes(employee) && mentionedAI) {
        try {
          const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

          // Get recent chat for context
          const recentMessages = await fetch(
            `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&order=created_at.desc&limit=15`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          );
          const messages = await recentMessages.json();
          const chatHistory = messages.reverse().map(m => `${m.employee}: ${m.content}`).join('\n');

          if (perplexityCharacters.includes(mentionedAI)) {
            // Route to Perplexity for authentic character voices
            console.log("Routing to Perplexity for:", mentionedAI);
            fetch(`${siteUrl}/.netlify/functions/ai-perplexity`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                character: mentionedAI,
                chatHistory: chatHistory
              })
            }).catch(err => console.log("Perplexity fire-and-forget error:", err));
          } else if (openaiCharacters.includes(mentionedAI)) {
            // Route to OpenAI/ChatGPT for Kevin
            console.log("Routing to OpenAI for:", mentionedAI);
            fetch(`${siteUrl}/.netlify/functions/ai-openai`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                character: mentionedAI,
                chatHistory: chatHistory
              })
            }).catch(err => console.log("OpenAI fire-and-forget error:", err));
          } else {
            // Route to Claude-based ai-watcher for other characters
            fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                trigger: "mention",
                requestedAI: mentionedAI
              })
            }).catch(err => console.log("AI watcher fire-and-forget:", err));
          }
        } catch (watcherError) {
          console.log("AI trigger skipped:", watcherError);
        }
      }

      // ============================================
      // EVENT DETECTION & CHARACTER STATE UPDATES
      // Detect notable events and update character states/memories
      // ============================================
      try {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
        const contentLowerForEvents = sanitizedContent.toLowerCase();

        // Define event triggers
        const eventTriggers = [
          {
            pattern: /glitter|sparkle|bedazzle/i,
            condition: () => true,
            event: "glitter_incident",
            characters: ["Neiv", "Kevin"],
            memory: `${employee} mentioned glitter: "${sanitizedContent.substring(0, 50)}..."`,
            importance: 6
          },
          {
            pattern: /fire|burning|smoke|emergency/i,
            condition: () => !contentLowerForEvents.includes("fire drill"),
            event: "chaos",
            characters: ["Neiv", "Nyx", "Ghost Dad"],
            memory: `Potential emergency mentioned by ${employee}`,
            importance: 8
          },
          {
            pattern: /printer|prnt|paper jam/i,
            condition: () => employee !== "PRNT-Ω",
            event: "printer_mentioned",
            characters: ["PRNT-Ω", "Neiv"],
            memory: `${employee} talked about the printer`,
            importance: 4
          },
          {
            pattern: /jenna/i,
            condition: () => employee !== "Jenna" && employee !== "Neiv",
            event: "jenna_mentioned",
            characters: ["Neiv"],
            memory: `Someone mentioned Jenna: "${sanitizedContent.substring(0, 50)}..."`,
            importance: 5
          },
          {
            pattern: /love you|i love|<3|heart/i,
            condition: () => true,
            event: "affection",
            characters: [], // Just create memory, no state change
            memory: `${employee} expressed affection`,
            importance: 5
          },
          {
            pattern: /sorry|apologize|my bad|my fault/i,
            condition: () => true,
            event: "apology",
            characters: [], // Just memory
            memory: `${employee} apologized`,
            importance: 3
          },
          {
            pattern: /ace/i,
            condition: () => employee === "Kevin",
            event: "kevin_mentions_ace",
            characters: ["Kevin", "Ace"],
            memory: `Kevin mentioned Ace (crush alert)`,
            importance: 5
          },
          {
            pattern: /chaos|disaster|everything.*(broke|broken|down)|we're doomed/i,
            condition: () => true,
            event: "chaos",
            characters: ["Neiv", "Ghost Dad"],
            memory: `Chaos reported by ${employee}`,
            importance: 7
          },
          {
            pattern: /contract|binding|blood.*(sign|contract)|soul/i,
            condition: () => true,
            event: "contract_binding",
            characters: ["PRNT-Ω", "Neiv", "Ghost Dad", "Nyx"],
            memory: `Contract/binding mentioned by ${employee}: "${sanitizedContent.substring(0, 60)}..."`,
            importance: 9
          },
          {
            pattern: /pizza|victory|celebrate|we did it|survived/i,
            condition: () => true,
            event: "celebration",
            characters: ["Kevin", "Ghost Dad"],
            memory: `${employee} called for celebration`,
            importance: 5
          },
          {
            pattern: /vents?|hvac|air.?duct|crawl/i,
            condition: () => true,
            event: "vent_activity",
            characters: ["Neiv", "Ghost Dad"],
            memory: `Vent activity mentioned by ${employee}`,
            importance: 6
          },
          {
            pattern: /stapler|STPLR|sentient.?office.?supply/i,
            condition: () => true,
            event: "stapler_incident",
            characters: ["Vex", "Neiv"],
            memory: `Stapler situation mentioned by ${employee}`,
            importance: 6
          },
          {
            pattern: /thank you|thanks|grateful|appreciate/i,
            condition: () => aiCharacters.some(ai => sanitizedContent.toLowerCase().includes(ai.toLowerCase())),
            event: "gratitude",
            characters: [], // Just memory
            memory: `${employee} expressed gratitude`,
            importance: 4
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
                  description: trigger.memory
                })
              }).catch(err => console.log("Event trigger fire-and-forget:", err));
            }

            // Create memories for witnesses (characters currently "present")
            // For now, just create memory for directly involved characters
            if (trigger.memory && trigger.characters.length > 0) {
              for (const char of trigger.characters) {
                fetch(`${siteUrl}/.netlify/functions/character-state`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "memory",
                    character: char,
                    memoryType: trigger.event,
                    content: trigger.memory,
                    relatedCharacters: [employee, ...trigger.characters],
                    importance: trigger.importance
                  })
                }).catch(err => console.log("Memory creation fire-and-forget:", err));
              }
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
