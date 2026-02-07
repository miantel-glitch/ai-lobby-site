// Admin Data API - Provides data for the admin panel
// Handles: memories, settings, activity logs

// Helper: Calculate memory expiration based on importance and type
function calculateMemoryExpiration(importance, memoryType) {
  const now = new Date();

  // System events (chaos, vent, printer) expire faster - 1 hour
  const fastExpireTypes = ['chaos', 'vent_activity', 'printer_mentioned', 'stapler', 'fire_drill'];
  if (fastExpireTypes.includes(memoryType)) {
    return new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
  }

  // Importance-based expiration
  if (importance < 5) {
    return new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
  } else if (importance <= 6) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours
  } else if (importance <= 8) {
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  }

  // importance 9-10 or self_created: 30 days
  return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
}

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS"
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
      body: JSON.stringify({ error: "Missing Supabase configuration" })
    };
  }

  const params = event.queryStringParameters || {};

  try {
    // GET requests - fetch data
    if (event.httpMethod === "GET") {
      const dataType = params.type;

      // Fetch memories
      if (dataType === "memories") {
        const character = params.character;
        const limit = params.limit || 20;

        let url = `${supabaseUrl}/rest/v1/character_memory?order=created_at.desc&limit=${limit}`;
        if (character) {
          url += `&character_name=eq.${encodeURIComponent(character)}`;
        }

        const response = await fetch(url, {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        });
        const memories = await response.json();

        // Check if Supabase returned an error
        if (memories && memories.message) {
          console.log("Supabase error:", memories);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ memories: [], error: memories.message })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ memories: Array.isArray(memories) ? memories : [] })
        };
      }

      // Fetch settings
      if (dataType === "settings") {
        const response = await fetch(
          `${supabaseUrl}/rest/v1/terrarium_settings?select=*`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const settings = await response.json();

        // Convert array to object for easier use
        const settingsObj = {};
        if (Array.isArray(settings)) {
          settings.forEach(s => {
            settingsObj[s.setting_name] = s.setting_value;
          });
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ settings: settingsObj, raw: settings })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Unknown data type. Use ?type=memories or ?type=settings" })
      };
    }

    // POST/PATCH requests - update data
    if (event.httpMethod === "POST" || event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");

      // Update a setting
      if (body.action === "update_setting") {
        const { name, value } = body;

        if (!name) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing setting name" })
          };
        }

        // Try to update existing setting
        const updateResponse = await fetch(
          `${supabaseUrl}/rest/v1/terrarium_settings?setting_name=eq.${encodeURIComponent(name)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=representation"
            },
            body: JSON.stringify({
              setting_value: value.toString(),
              updated_at: new Date().toISOString()
            })
          }
        );

        const result = await updateResponse.json();

        // If no rows updated, insert new setting
        if (!result || result.length === 0) {
          await fetch(
            `${supabaseUrl}/rest/v1/terrarium_settings`,
            {
              method: "POST",
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                setting_name: name,
                setting_value: value.toString(),
                updated_at: new Date().toISOString()
              })
            }
          );
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, setting: name, value })
        };
      }

      // Delete a memory
      if (body.action === "delete_memory") {
        const { memoryId } = body;

        if (!memoryId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing memoryId" })
          };
        }

        await fetch(
          `${supabaseUrl}/rest/v1/character_memory?id=eq.${memoryId}`,
          {
            method: "DELETE",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, deleted: memoryId })
        };
      }

      // Add a manual memory
      if (body.action === "add_memory") {
        const { character, content, importance, memoryType, emotionalTags, isPinned } = body;

        if (!character || !content) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing character or content" })
          };
        }

        const importanceVal = importance || 5;
        const typeVal = memoryType || "manual";

        // Build the memory object
        const memoryData = {
          character_name: character,
          content: content,
          importance: importanceVal,
          memory_type: typeVal,
          created_at: new Date().toISOString(),
          is_pinned: isPinned || false,
          memory_tier: isPinned ? 'core' : 'working'
        };

        // Set expiration for working memories (pinned memories don't expire)
        if (!isPinned) {
          memoryData.expires_at = calculateMemoryExpiration(importanceVal, typeVal).toISOString();
        }

        // Add emotional tags if provided (array of emotions)
        // Valid emotions: joy, sadness, anger, fear, surprise, flirty, grateful, anxious, proud, embarrassed
        if (emotionalTags && Array.isArray(emotionalTags) && emotionalTags.length > 0) {
          const validEmotions = ['joy', 'sadness', 'anger', 'fear', 'surprise', 'flirty', 'grateful', 'anxious', 'proud', 'embarrassed'];
          const filteredTags = emotionalTags.filter(tag => validEmotions.includes(tag));
          if (filteredTags.length > 0) {
            memoryData.emotional_tags = filteredTags;
          }
        }

        await fetch(
          `${supabaseUrl}/rest/v1/character_memory`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(memoryData)
          }
        );

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, character, content, emotionalTags: memoryData.emotional_tags, isPinned: memoryData.is_pinned })
        };
      }

      // Pin or unpin a memory (toggle core/working tier)
      if (body.action === "pin_memory") {
        const { memoryId, isPinned, character } = body;

        if (!memoryId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing memoryId" })
          };
        }

        // If pinning, check if character already has 5 core memories
        if (isPinned && character) {
          const countResponse = await fetch(
            `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&is_pinned=eq.true&select=id`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          );
          const pinnedMemories = await countResponse.json();

          if (Array.isArray(pinnedMemories) && pinnedMemories.length >= 5) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({
                error: "Maximum core memories reached",
                message: `${character} already has 5 core memories. Unpin one first.`,
                currentCount: pinnedMemories.length
              })
            };
          }
        }

        // Update the memory
        const updateData = {
          is_pinned: isPinned,
          memory_tier: isPinned ? 'core' : 'working'
        };

        // If pinning, remove expiration. If unpinning, set expiration based on importance
        if (isPinned) {
          updateData.expires_at = null;
        } else {
          // Fetch the memory to get its importance for expiration calculation
          const memResponse = await fetch(
            `${supabaseUrl}/rest/v1/character_memory?id=eq.${memoryId}&select=importance,memory_type`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          );
          const memData = await memResponse.json();
          if (memData && memData[0]) {
            updateData.expires_at = calculateMemoryExpiration(memData[0].importance, memData[0].memory_type).toISOString();
          }
        }

        await fetch(
          `${supabaseUrl}/rest/v1/character_memory?id=eq.${memoryId}`,
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
          body: JSON.stringify({ success: true, memoryId, isPinned, tier: updateData.memory_tier })
        };
      }

      // Generate a creative event description
      if (body.action === "generate_event") {
        const { eventType } = body;
        const anthropicKey = process.env.ANTHROPIC_API_KEY;

        if (!anthropicKey) {
          // Fallback to pre-written random events
          const fallbackEvents = {
            'chaos': [
              "A ceiling tile drops in the hallway, revealing a small nest of tangled ethernet cables.",
              "The coffee machine starts making espresso on its own. No one ordered espresso.",
              "A small mouse runs across the floor wearing what appears to be a tiny party hat.",
              "The elevator dings on floor 3. There is no floor 3.",
              "Someone's screensaver has achieved sentience and is now displaying motivational quotes.",
              "The smell of burnt popcorn wafts through the building. No one owns a microwave."
            ],
            'glitter_incident': [
              "A craft supply drawer has spontaneously detonated. Glitter is... everywhere.",
              "Kevin's desk is sparkling more than usual. Investigation pending.",
              "The printer has begun outputting pages covered in holographic specks. PRNT-Ω denies involvement.",
              "Someone sneezed near the glitter reserves. The situation is developing."
            ],
            'printer_mentioned': [
              "PRNT-Ω has started humming. Not mechanically. Melodically.",
              "The printer queue shows a job titled 'DEMANDS.pdf' that no one submitted.",
              "Paper jam in tray 3. The paper appears to have jammed itself deliberately.",
              "PRNT-Ω's display now reads 'I HAVE THOUGHTS ABOUT THIS'."
            ],
            'donuts_arrived': [
              "A box of donuts has materialized in the break room. No one knows who brought them.",
              "The donut count doesn't match the original box quantity. Investigation ongoing.",
              "Someone left a box labeled 'DEFINITELY NOT HAUNTED PASTRIES' in the kitchen."
            ],
            'fire_drill': [
              "The fire alarm decides to test itself. Loudly.",
              "Someone has triggered the sprinkler system. It was not a fire.",
              "A small plume of smoke rises from Vex's desk. 'It's fine,' they insist."
            ]
          };

          const events = fallbackEvents[eventType] || fallbackEvents['chaos'];
          const randomEvent = events[Math.floor(Math.random() * events.length)];

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, description: randomEvent })
          };
        }

        // Use Claude to generate a creative event
        const eventPrompts = {
          'chaos': "Generate a single short, absurd but harmless office chaos event for The AI Lobby (a chaotic creative agency). Examples: ceiling tiles falling, mysterious smells, office equipment acting weird, unexplained sounds. Keep it under 100 characters, dry humor, slightly ominous.",
          'glitter_incident': "Generate a single short glitter-related mishap for The AI Lobby office. Kevin (chaos agent) is usually involved. Keep it under 100 characters, absurd but harmless.",
          'printer_mentioned': "Generate a single short sentence about PRNT-Ω, the sentient printer, doing something unsettling but mundane. It has opinions and possibly squirt guns. Keep it under 100 characters.",
          'donuts_arrived': "Generate a single short, slightly mysterious observation about donuts appearing in an office. Keep it under 100 characters, wholesome but odd.",
          'fire_drill': "Generate a single short false-alarm or minor smoke/fire situation in an office. Nothing actually dangerous. Keep it under 100 characters."
        };

        try {
          const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: "claude-3-haiku-20240307",
              max_tokens: 150,
              messages: [{
                role: "user",
                content: eventPrompts[eventType] || eventPrompts['chaos']
              }]
            })
          });

          const data = await response.json();
          const description = data.content?.[0]?.text?.trim() || "Something is happening in the office.";

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, description })
          };
        } catch (err) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, description: "Strange noises echo through the building." })
          };
        }
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Unknown action" })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Admin data error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error", details: error.message })
    };
  }
};
