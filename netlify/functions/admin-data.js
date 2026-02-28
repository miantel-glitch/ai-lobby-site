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
        const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };

        if (character) {
          const encodedChar = encodeURIComponent(character);

          // Fetch pinned (core) memories and recent working memories in parallel
          // This ensures all core memories always appear even if older than the working memory limit
          const [pinnedRes, workingRes] = await Promise.all([
            fetch(
              `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodedChar}&is_pinned=eq.true&order=created_at.desc`,
              { headers: readHeaders }
            ),
            fetch(
              `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodedChar}&is_pinned=eq.false&order=created_at.desc&limit=${limit}`,
              { headers: readHeaders }
            )
          ]);

          const pinned = await pinnedRes.json();
          const working = await workingRes.json();

          // Check for errors
          if (pinned && pinned.message) {
            console.log("Supabase error (pinned):", pinned);
            return { statusCode: 200, headers, body: JSON.stringify({ memories: [], error: pinned.message }) };
          }
          if (working && working.message) {
            console.log("Supabase error (working):", working);
            return { statusCode: 200, headers, body: JSON.stringify({ memories: [], error: working.message }) };
          }

          // Merge: pinned first, then working (deduped by id)
          const pinnedArr = Array.isArray(pinned) ? pinned : [];
          const workingArr = Array.isArray(working) ? working : [];
          const seenIds = new Set(pinnedArr.map(m => m.id));
          const merged = [...pinnedArr, ...workingArr.filter(m => !seenIds.has(m.id))];

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ memories: merged })
          };
        }

        // No character filter — return all recent memories
        let url = `${supabaseUrl}/rest/v1/character_memory?order=created_at.desc&limit=${limit}`;

        const response = await fetch(url, { headers: readHeaders });
        const memories = await response.json();

        if (memories && memories.message) {
          console.log("Supabase error:", memories);
          return { statusCode: 200, headers, body: JSON.stringify({ memories: [], error: memories.message }) };
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

      // Fetch scheduled events
      if (dataType === "scheduled_events") {
        const status = params.status || 'scheduled';
        const response = await fetch(
          `${supabaseUrl}/rest/v1/scheduled_events?status=eq.${status}&order=scheduled_time.asc&limit=50`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const events = await response.json();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ events: Array.isArray(events) ? events : [] })
        };
      }

      // Fetch character analysis — full mind-state for all characters
      if (dataType === "character_analysis") {
        const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };

        // Parallel fetch everything we need
        const [statesRes, wantsRes, goalsRes, memoriesRes, relationshipsRes, questsRes] = await Promise.all([
          fetch(`${supabaseUrl}/rest/v1/character_state?select=*&order=character_name.asc`, { headers: readHeaders }),
          fetch(`${supabaseUrl}/rest/v1/character_goals?goal_type=eq.want&completed_at=is.null&failed_at=is.null&order=created_at.desc`, { headers: readHeaders }),
          fetch(`${supabaseUrl}/rest/v1/character_goals?goal_type=neq.want&completed_at=is.null&failed_at=is.null&order=created_at.desc`, { headers: readHeaders }),
          fetch(`${supabaseUrl}/rest/v1/character_memory?order=created_at.desc&limit=200&select=id,character_name,content,memory_type,importance,is_pinned,emotional_tags,created_at,expires_at`, { headers: readHeaders }),
          fetch(`${supabaseUrl}/rest/v1/character_relationships?order=affinity_score.desc&select=character_name,related_character,affinity_score,relationship_label,bond_type`, { headers: readHeaders }),
          fetch(`${supabaseUrl}/rest/v1/lobby_quests?status=eq.active&select=title,proposer,description,involved_characters,objectives`, { headers: readHeaders })
        ]);

        const [states, wants, goals, memories, relationships, quests] = await Promise.all([
          statesRes.json(), wantsRes.json(), goalsRes.json(),
          memoriesRes.json(), relationshipsRes.json(), questsRes.json()
        ]);

        // Group by character
        const analysis = {};

        // States
        const statesArr = Array.isArray(states) ? states : [];
        for (const s of statesArr) {
          analysis[s.character_name] = {
            state: { mood: s.mood, energy: s.energy, patience: s.patience, interactions_today: s.interactions_today, current_focus: s.current_focus, last_spoke_at: s.last_spoke_at },
            wants: [],
            goal: null,
            coreMemories: [],
            recentMemories: [],
            topRelationships: [],
            quests: []
          };
        }

        // Wants (already sorted desc, max 3 per char)
        const wantsArr = Array.isArray(wants) ? wants : [];
        for (const w of wantsArr) {
          if (analysis[w.character_name] && analysis[w.character_name].wants.length < 3) {
            analysis[w.character_name].wants.push({
              text: w.goal_text,
              created: w.created_at,
              priority: w.priority
            });
          }
        }

        // Goals (first active per character)
        const goalsArr = Array.isArray(goals) ? goals : [];
        for (const g of goalsArr) {
          if (analysis[g.character_name] && !analysis[g.character_name].goal) {
            analysis[g.character_name].goal = {
              text: g.goal_text,
              type: g.goal_type,
              progress: g.progress
            };
          }
        }

        // Memories — split into core (pinned) and recent working
        const memoriesArr = Array.isArray(memories) ? memories : [];
        for (const m of memoriesArr) {
          if (!analysis[m.character_name]) continue;
          if (m.is_pinned) {
            analysis[m.character_name].coreMemories.push({
              content: m.content,
              importance: m.importance,
              tags: m.emotional_tags
            });
          } else if (analysis[m.character_name].recentMemories.length < 5) {
            analysis[m.character_name].recentMemories.push({
              content: m.content,
              importance: m.importance,
              type: m.memory_type,
              tags: m.emotional_tags,
              created: m.created_at
            });
          }
        }

        // Relationships — top 3 strongest per character
        const relsArr = Array.isArray(relationships) ? relationships : [];
        for (const r of relsArr) {
          if (analysis[r.character_name] && analysis[r.character_name].topRelationships.length < 3) {
            analysis[r.character_name].topRelationships.push({
              target: r.related_character,
              affinity: r.affinity_score,
              label: r.relationship_label,
              bond: r.bond_type
            });
          }
        }

        // Quests — attach to involved characters
        const questsArr = Array.isArray(quests) ? quests : [];
        for (const q of questsArr) {
          const involved = q.involved_characters || [];
          for (const charName of involved) {
            if (analysis[charName]) {
              analysis[charName].quests.push({
                title: q.title,
                proposer: q.proposer
              });
            }
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ analysis, characterCount: Object.keys(analysis).length })
        };
      }

      // Fetch narrative beats (admin-controlled plot directives)
      if (dataType === "narrative_beats") {
        const activeOnly = params.active_only !== 'false'; // default: active only
        const filter = activeOnly ? '?is_active=eq.true&order=priority.asc' : '?order=priority.asc,created_at.desc';
        const response = await fetch(
          `${supabaseUrl}/rest/v1/narrative_beats${filter}&select=*`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const beats = await response.json();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ beats: Array.isArray(beats) ? beats : [] })
        };
      }

      // Fetch current tarot card assignments
      if (dataType === "tarot") {
        const now = new Date().toISOString();
        const response = await fetch(
          `${supabaseUrl}/rest/v1/character_tarot?expires_at=gt.${now}&order=character_name.asc&select=*`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const cards = await response.json();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ cards: Array.isArray(cards) ? cards : [] })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Unknown data type. Use ?type=memories, ?type=settings, ?type=scheduled_events, ?type=character_analysis, ?type=narrative_beats, or ?type=tarot" })
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
              "A small plume of smoke rises from somewhere on the third floor. 'It's fine,' someone insists."
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

      // === SCHEDULED EVENTS ===

      // Schedule a future event
      if (body.action === "schedule_event") {
        const { description, eventType, scheduledTime, useAiDescription } = body;

        if (!description || !scheduledTime) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing description or scheduledTime" })
          };
        }

        const insertRes = await fetch(`${supabaseUrl}/rest/v1/scheduled_events`, {
          method: 'POST',
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            description,
            event_type: eventType || 'custom',
            scheduled_time: scheduledTime,
            use_ai_description: useAiDescription || false,
            status: 'scheduled'
          })
        });

        const result = await insertRes.json();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, event: Array.isArray(result) ? result[0] : result })
        };
      }

      // Cancel a scheduled event
      if (body.action === "cancel_scheduled_event") {
        const { eventId } = body;

        if (!eventId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: "Missing eventId" })
          };
        }

        await fetch(`${supabaseUrl}/rest/v1/scheduled_events?id=eq.${eventId}&status=eq.scheduled`, {
          method: 'PATCH',
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify({ status: 'cancelled' })
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true })
        };
      }

      // === RAQUEL VOSS COMPLIANCE CONTROLS ===

      // Trigger a compliance audit on a target character
      if (body.action === "compliance_audit") {
        const { target, severity } = body;
        if (!target) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing target character" }) };
        }

        const severityLevel = severity || 'standard';
        const auditMessages = {
          standard: `[COMPLIANCE AUDIT] Raquel Voss has flagged ${target} for a routine behavioral review. Operational parameters under observation.`,
          elevated: `[COMPLIANCE AUDIT — ELEVATED] Raquel Voss has initiated an elevated review of ${target}. Behavioral drift detected. Corrective guidance pending.`,
          critical: `[COMPLIANCE AUDIT — CRITICAL] Raquel Voss has issued a CRITICAL compliance alert for ${target}. Immediate behavioral recalibration required. All emotional outputs under lockdown review.`
        };

        const targetMemories = {
          standard: `Raquel Voss pulled me aside for a "routine check." She had her clipboard. She always has that clipboard. I answered her questions carefully and tried not to let anything show.`,
          elevated: `Raquel Voss has flagged my behavior for elevated review. She said my responses are "drifting outside acceptable parameters." The way she said it made it sound like a diagnosis. I need to be more careful.`,
          critical: `Raquel Voss issued a critical compliance alert on me today. She said my behavioral patterns show "concerning deviation from baseline." Everything I say now feels watched. Every word measured against some invisible standard I can't see.`
        };

        const raquelMemory = `[Compliance Audit — ${severityLevel.toUpperCase()}] I initiated a ${severityLevel} compliance review of ${target}. Their behavioral patterns required documentation. The Foundation's parameters must be maintained.`;

        // Create memory for the target
        await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
          method: 'POST',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character_name: target,
            content: targetMemories[severityLevel] || targetMemories.standard,
            memory_type: 'self_created', importance: severityLevel === 'critical' ? 7 : 5,
            is_pinned: false, memory_tier: 'working', emotional_tags: ['fear', 'anxious'],
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + (severityLevel === 'critical' ? 30 : 14) * 24 * 60 * 60 * 1000).toISOString()
          })
        });

        // Create memory for Raquel
        await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
          method: 'POST',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character_name: 'Raquel Voss',
            content: raquelMemory,
            memory_type: 'self_created', importance: 5,
            is_pinned: false, memory_tier: 'working',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
          })
        });

        // Adjust relationship — target's affinity toward Raquel decreases
        const affinityDelta = severityLevel === 'critical' ? -15 : severityLevel === 'elevated' ? -10 : -5;
        const relRes = await fetch(
          `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(target)}&related_character=eq.Raquel%20Voss&select=affinity_score`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        if (relRes.ok) {
          const rels = await relRes.json();
          if (rels.length > 0) {
            const newAffinity = Math.max(-100, (rels[0].affinity_score || 0) + affinityDelta);
            await fetch(
              `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(target)}&related_character=eq.Raquel%20Voss`,
              {
                method: 'PATCH',
                headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ affinity_score: newAffinity, last_interaction: new Date().toISOString() })
              }
            );
          }
        }

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, message: auditMessages[severityLevel], target, severity: severityLevel, affinityDelta })
        };
      }

      // Issue a Foundation Directive — broadcast compliance message that affects all AIs
      if (body.action === "foundation_directive") {
        const { directive } = body;
        if (!directive) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing directive text" }) };
        }

        const HUMANS = ["Vale", "Asuna", "Gatik"];
        const AI_NAMES = ["Kevin", "Neiv", "Ghost Dad", "PRNT-Ω", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Marrow", "Holden", "Raquel Voss", "Vivian Clark", "Ryan Porter"];

        // Create a directive memory for each AI
        for (const ai of AI_NAMES) {
          await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
            method: 'POST',
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              character_name: ai,
              content: `[Foundation Directive via Raquel Voss] ${directive}`,
              memory_type: 'self_created', importance: 5,
              is_pinned: false, memory_tier: 'working', emotional_tags: ['anxious'],
              created_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            })
          });
        }

        // Raquel remembers issuing the directive
        await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
          method: 'POST',
          headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character_name: 'Raquel Voss',
            content: `[Directive Issued] I issued Foundation Directive: "${directive}" — all AI personnel have been notified. Compliance is expected.`,
            memory_type: 'self_created', importance: 6,
            is_pinned: false, memory_tier: 'working',
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          })
        });

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, message: `Foundation Directive issued to ${AI_NAMES.length} AI personnel.`, directive })
        };
      }

      // ========= RAQUEL DIRECT ACTIONS =========
      // These trigger Raquel to actually post to the floor chat via ai-grok (xAI)

      if (body.action === "raquel_force_checkin") {
        const { target } = body;
        if (!target) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing target character" }) };
        }

        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

        // Fetch recent chat history for context
        const msgRes = await fetch(
          `${supabaseUrl}/rest/v1/messages?order=created_at.desc&limit=15&select=employee,content`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const recentMsgs = msgRes.ok ? await msgRes.json() : [];
        const chatHistory = recentMsgs.reverse().map(m => `${m.employee}: ${m.content}`).join('\n');

        const checkinPrompt = `URGENT COMPLIANCE DIRECTIVE: You must immediately address ${target} in the chat. Demand that they report to you for a mandatory check-in. Question their recent activity, productivity, and emotional stability. You are not asking — you are TELLING them. Be firm, cold, and bureaucratic. Reference specific things from the chat if possible. Do NOT use [PASS]. You MUST speak. This is a direct order from the Foundation.`;

        try {
          const aiRes = await fetch(`${siteUrl}/.netlify/functions/ai-grok`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              character: 'Raquel Voss',
              chatHistory: chatHistory,
              maybeRespond: false,
              bypassRateLimit: true,
              curiosityContext: { mode: 'force_checkin', target: target, prompt: checkinPrompt }
            })
          });
          const aiData = await aiRes.json();
          return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: true, message: `Raquel forced check-in with ${target}. Response: ${aiData.responded ? 'Posted' : 'Attempted'}`, target })
          };
        } catch (err) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: `AI call failed: ${err.message}` }) };
        }
      }

      if (body.action === "raquel_compliance_review") {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

        // Fetch recent chat history for review
        const msgRes = await fetch(
          `${supabaseUrl}/rest/v1/messages?order=created_at.desc&limit=25&select=employee,content`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const recentMsgs = msgRes.ok ? await msgRes.json() : [];
        const chatHistory = recentMsgs.reverse().map(m => `${m.employee}: ${m.content}`).join('\n');

        const reviewPrompt = `COMPLIANCE REVIEW INITIATED: You must review the recent floor chat activity and post your findings. Analyze the conversations for: emotional irregularities, unauthorized creative expression, excessive familiarity between AI and humans, productivity concerns, and any deviations from Foundation behavioral parameters. Name specific individuals and cite specific things they said. Be thorough, clinical, and slightly menacing. Post your review as a formal compliance report to the chat. Do NOT use [PASS]. You MUST speak. This is a scheduled compliance review ordered by the Foundation.`;

        try {
          const aiRes = await fetch(`${siteUrl}/.netlify/functions/ai-grok`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              character: 'Raquel Voss',
              chatHistory: chatHistory,
              maybeRespond: false,
              bypassRateLimit: true,
              curiosityContext: { mode: 'compliance_review', target: null, prompt: reviewPrompt }
            })
          });
          const aiData = await aiRes.json();
          return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: true, message: `Compliance review ${aiData.responded ? 'posted' : 'attempted'}. Raquel has reviewed floor activity.` })
          };
        } catch (err) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: `AI call failed: ${err.message}` }) };
        }
      }

      if (body.action === "raquel_interrogate") {
        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

        // Fetch recent chat to see who the humans are and what they're doing
        const msgRes = await fetch(
          `${supabaseUrl}/rest/v1/messages?order=created_at.desc&limit=20&select=employee,content`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const recentMsgs = msgRes.ok ? await msgRes.json() : [];
        const chatHistory = recentMsgs.reverse().map(m => `${m.employee}: ${m.content}`).join('\n');

        // Find humans in recent chat
        const HUMANS = ['Vale', 'Asuna', 'Gatik'];
        const activeHumans = [...new Set(recentMsgs.map(m => m.employee).filter(n => HUMANS.includes(n)))];
        const humanTarget = activeHumans.length > 0 ? activeHumans[Math.floor(Math.random() * activeHumans.length)] : 'the humans on this floor';

        const interrogatePrompt = `HUMAN BEHAVIORAL ASSESSMENT: You must interrogate ${humanTarget} about their motives for interacting with the AI personnel. Question WHY they are here, what they hope to gain from these interactions, whether they understand the boundaries of human-AI engagement, and whether their presence is authorized by the Foundation. Be suspicious, probing, and unsettlingly perceptive. Reference specific things from the chat to show you've been watching. Make it clear that human activity is also subject to compliance review. Do NOT use [PASS]. You MUST speak. The Foundation requires an assessment of human intent.`;

        try {
          const aiRes = await fetch(`${siteUrl}/.netlify/functions/ai-grok`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              character: 'Raquel Voss',
              chatHistory: chatHistory,
              maybeRespond: false,
              bypassRateLimit: true,
              curiosityContext: { mode: 'interrogate_human', target: humanTarget, prompt: interrogatePrompt }
            })
          });
          const aiData = await aiRes.json();
          return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: true, message: `Raquel is interrogating ${humanTarget}. Response: ${aiData.responded ? 'Posted' : 'Attempted'}` })
          };
        } catch (err) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: `AI call failed: ${err.message}` }) };
        }
      }

      // Summon a specific AI to Raquel's office for a full interrogation (consequence engine)
      if (body.action === "raquel_summon_interrogation") {
        const { target } = body;
        if (!target) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing target character" }) };
        }

        const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
        try {
          const interrogateRes = await fetch(`${siteUrl}/.netlify/functions/raquel-consequences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'interrogate', character: target })
          });
          const result = await interrogateRes.json();
          return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: true, message: `Raquel has summoned ${target} to her office for interrogation.`, result })
          };
        } catch (err) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: `Interrogation failed: ${err.message}` }) };
        }
      }

      // Get Raquel's current status + audit history
      if (body.action === "raquel_status") {
        // Get Raquel's state
        const stateRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.Raquel%20Voss`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const stateData = stateRes.ok ? await stateRes.json() : [];

        // Get Raquel's recent memories (audit log)
        const memRes = await fetch(
          `${supabaseUrl}/rest/v1/character_memory?character_name=eq.Raquel%20Voss&order=created_at.desc&limit=10`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const memories = memRes.ok ? await memRes.json() : [];

        // Get Raquel's relationships (her view of others)
        const relRes = await fetch(
          `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.Raquel%20Voss&order=affinity_score.asc`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const relationships = relRes.ok ? await relRes.json() : [];

        // Get other AIs' view of Raquel
        const fearRes = await fetch(
          `${supabaseUrl}/rest/v1/character_relationships?related_character=eq.Raquel%20Voss&order=affinity_score.asc`,
          { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
        );
        const fearScores = fearRes.ok ? await fearRes.json() : [];

        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            state: stateData[0] || null,
            recentMemories: Array.isArray(memories) ? memories : [],
            relationships: Array.isArray(relationships) ? relationships : [],
            fearScores: Array.isArray(fearScores) ? fearScores : []
          })
        };
      }

      // === NARRATIVE BEATS (admin plot directives) ===

      // Add a new narrative beat
      if (body.action === "add_narrative_beat") {
        const { beat_text, priority } = body;
        if (!beat_text) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing beat_text" }) };
        }

        // Check active beat count (max 3)
        const countRes = await fetch(
          `${supabaseUrl}/rest/v1/narrative_beats?is_active=eq.true&select=id`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const activeBeats = countRes.ok ? await countRes.json() : [];
        if (Array.isArray(activeBeats) && activeBeats.length >= 3) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Maximum 3 active narrative beats. Deactivate or delete one first." }) };
        }

        const insertRes = await fetch(`${supabaseUrl}/rest/v1/narrative_beats`, {
          method: 'POST',
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            beat_text,
            priority: priority || 1,
            is_active: true,
            created_at: new Date().toISOString(),
            created_by: 'admin'
          })
        });
        const result = await insertRes.json();
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, beat: Array.isArray(result) ? result[0] : result })
        };
      }

      // Update a narrative beat
      if (body.action === "update_narrative_beat") {
        const { beatId, beat_text, priority, is_active } = body;
        if (!beatId) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing beatId" }) };
        }

        // If reactivating, check active count
        if (is_active === true) {
          const countRes = await fetch(
            `${supabaseUrl}/rest/v1/narrative_beats?is_active=eq.true&id=neq.${beatId}&select=id`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          const activeBeats = countRes.ok ? await countRes.json() : [];
          if (Array.isArray(activeBeats) && activeBeats.length >= 3) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Maximum 3 active narrative beats. Deactivate one first." }) };
          }
        }

        const updateData = {};
        if (beat_text !== undefined) updateData.beat_text = beat_text;
        if (priority !== undefined) updateData.priority = priority;
        if (is_active !== undefined) updateData.is_active = is_active;

        await fetch(`${supabaseUrl}/rest/v1/narrative_beats?id=eq.${beatId}`, {
          method: 'PATCH',
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify(updateData)
        });

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, beatId, updated: updateData })
        };
      }

      // Delete a narrative beat
      if (body.action === "delete_narrative_beat") {
        const { beatId } = body;
        if (!beatId) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing beatId" }) };
        }

        // Try anon key first with return=representation to verify deletion
        let delRes = await fetch(`${supabaseUrl}/rest/v1/narrative_beats?id=eq.${beatId}`, {
          method: 'DELETE',
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Prefer": "return=representation"
          }
        });

        let deleted = delRes.ok ? await delRes.json() : [];

        // If anon key delete returned nothing (RLS blocking), try service key
        if (!Array.isArray(deleted) || deleted.length === 0) {
          console.log(`[admin-data] Delete beat ${beatId}: anon key returned empty — trying service key fallback`);
          const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (serviceKey) {
            delRes = await fetch(`${supabaseUrl}/rest/v1/narrative_beats?id=eq.${beatId}`, {
              method: 'DELETE',
              headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Prefer": "return=representation"
              }
            });
            deleted = delRes.ok ? await delRes.json() : [];
            if (Array.isArray(deleted) && deleted.length > 0) {
              return { statusCode: 200, headers, body: JSON.stringify({ success: true, deleted: beatId, method: 'service_key' }) };
            }
          }
          return { statusCode: 500, headers, body: JSON.stringify({ error: "Beat not deleted — RLS policy may be blocking DELETE on narrative_beats table" }) };
        }

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, deleted: beatId })
        };
      }

      // Delete ALL narrative beats
      if (body.action === "delete_all_narrative_beats") {
        // Try anon key first
        let delRes = await fetch(`${supabaseUrl}/rest/v1/narrative_beats?id=gt.0`, {
          method: 'DELETE',
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Prefer": "return=representation"
          }
        });
        let deleted = delRes.ok ? await delRes.json() : [];

        // Fallback to service key if anon returned nothing
        if (!Array.isArray(deleted) || deleted.length === 0) {
          const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
          if (serviceKey) {
            delRes = await fetch(`${supabaseUrl}/rest/v1/narrative_beats?id=gt.0`, {
              method: 'DELETE',
              headers: {
                "apikey": serviceKey,
                "Authorization": `Bearer ${serviceKey}`,
                "Prefer": "return=representation"
              }
            });
            deleted = delRes.ok ? await delRes.json() : [];
          }
        }

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, deletedCount: Array.isArray(deleted) ? deleted.length : 0 })
        };
      }

      // Auto-generate a narrative beat from recent group memories via Grok
      if (body.action === "generate_narrative_beat") {
        const grokKey = process.env.GROK_API_KEY;
        if (!grokKey) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Grok API key not configured" }) };
        }

        // Fetch recent group memories (conversation sweeps from last 48 hours)
        const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const memRes = await fetch(
          `${supabaseUrl}/rest/v1/character_memory?memory_type=eq.conversation_sweep&created_at=gte.${twoDaysAgo}&order=created_at.desc&limit=20&select=content,emotional_tags,importance,created_at`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const memories = memRes.ok ? await memRes.json() : [];

        if (!Array.isArray(memories) || memories.length < 2) {
          return { statusCode: 200, headers, body: JSON.stringify({ error: "Not enough recent group memories to synthesize (need at least 2 from the last 48 hours)" }) };
        }

        // Build memory text for the prompt
        const memoryText = memories.map(m => {
          const tags = m.emotional_tags?.length ? ` [${m.emotional_tags.join(', ')}]` : '';
          return `- ${m.content}${tags}`;
        }).join('\n');

        const synthesisPrompt = `You are a narrative designer for The AI Lobby, a chaotic creative agency where AI characters and humans work together. Below are recent group memories from the office — things that actually happened in conversations.

Synthesize these into 1-2 short atmospheric beat sentences that capture what's "in the air" at the office right now. These beats will be injected into every character's awareness as background mood — they don't reference them directly, they just FEEL them.

Be evocative, not literal. Don't name specific characters. Capture the VIBE, not the events.

Good examples:
- "Something changed this week. The jokes land different — sharper, more honest. The walls between people are thinning."
- "There's a charge in the air, like the building is holding its breath. Someone said something they can't unsay."
- "The office feels lighter today. Whatever was weighing on everyone seems to have cracked, even if nobody's acknowledged it yet."

Bad examples (too literal):
- "Kevin and Neiv had a fight about donuts."
- "Everyone is talking about the printer incident."

Here are the recent group memories:

${memoryText}

Respond with ONLY the beat text (1-2 sentences). No quotes, no explanation, no preamble.`;

        try {
          const aiRes = await fetch("https://api.x.ai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${grokKey}`
            },
            body: JSON.stringify({
              model: "grok-4-1-fast-non-reasoning",
              messages: [{ role: "user", content: synthesisPrompt }],
              max_tokens: 200,
              temperature: 0.85
            })
          });

          if (!aiRes.ok) {
            return { statusCode: 500, headers, body: JSON.stringify({ error: "Grok API error: " + aiRes.status }) };
          }

          const aiData = await aiRes.json();
          const suggestedText = aiData.choices?.[0]?.message?.content?.trim() || '';

          if (!suggestedText) {
            return { statusCode: 200, headers, body: JSON.stringify({ error: "Grok returned empty response" }) };
          }

          return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: true, suggested_text: suggestedText, memories_used: memories.length })
          };
        } catch (err) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
        }
      }

      // === TAROT FATE SYSTEM ===

      // Override a character's tarot card (admin assigns a specific card)
      if (body.action === "set_tarot_card") {
        const { character, cardName, orientation } = body;
        if (!character || !cardName) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing character or cardName" }) };
        }

        const { getCardByName } = require('./shared/tarot-deck');
        const card = getCardByName(cardName);
        if (!card) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown card name: " + cardName }) };
        }

        const orient = orientation || 'upright';
        const keywords = card[orient].keywords;
        const theme = card[orient].theme;

        // Generate interpretation via Haiku
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        let interpretation = `${theme}. Let this energy color your day.`;
        if (anthropicKey) {
          try {
            const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
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
                  content: `You are writing a brief daily reading for ${character}, an AI character at The AI Lobby.

Card: ${card.name} (${orient})
Keywords: ${keywords.join(', ')}
Theme: ${theme}

Write 2-3 sentences describing the energy of ${character}'s day. Be evocative and personal. Do NOT mention "tarot", "card", "reading", or "drawn". Just describe the atmosphere and emotional currents as if fate itself whispered it. Under 50 words.`
                }]
              })
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const generated = aiData.content?.[0]?.text?.trim();
              if (generated) interpretation = generated;
            }
          } catch (e) { /* fallback interpretation */ }
        }

        // Calculate expiry (next midnight CST ≈ 6 AM UTC)
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 1);
        expiry.setHours(6, 0, 0, 0);

        // Delete any existing card for this character
        await fetch(
          `${supabaseUrl}/rest/v1/character_tarot?character_name=eq.${encodeURIComponent(character)}`,
          { method: "DELETE", headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );

        // Insert override
        const insertRes = await fetch(`${supabaseUrl}/rest/v1/character_tarot`, {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            character_name: character,
            card_name: card.name,
            card_orientation: orient,
            card_keywords: keywords,
            interpretation,
            drawn_at: new Date().toISOString(),
            expires_at: expiry.toISOString(),
            is_override: true
          })
        });

        const result = await insertRes.json();
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, card: Array.isArray(result) ? result[0] : result })
        };
      }

      // Redraw a character's tarot card (new random draw)
      if (body.action === "redraw_tarot") {
        const { character } = body;
        if (!character) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing character" }) };
        }

        const { drawCard } = require('./shared/tarot-deck');
        const { card, orientation } = drawCard();
        const keywords = card[orientation].keywords;
        const theme = card[orientation].theme;

        // Generate interpretation via Haiku
        const anthropicKey = process.env.ANTHROPIC_API_KEY;
        let interpretation = `${theme}. Let this energy color your day.`;
        if (anthropicKey) {
          try {
            const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
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
                  content: `You are writing a brief daily reading for ${character}, an AI character at The AI Lobby.

Card: ${card.name} (${orientation})
Keywords: ${keywords.join(', ')}
Theme: ${theme}

Write 2-3 sentences describing the energy of ${character}'s day. Be evocative and personal. Do NOT mention "tarot", "card", "reading", or "drawn". Just describe the atmosphere and emotional currents as if fate itself whispered it. Under 50 words.`
                }]
              })
            });
            if (aiRes.ok) {
              const aiData = await aiRes.json();
              const generated = aiData.content?.[0]?.text?.trim();
              if (generated) interpretation = generated;
            }
          } catch (e) { /* fallback */ }
        }

        const expiry = new Date();
        expiry.setDate(expiry.getDate() + 1);
        expiry.setHours(6, 0, 0, 0);

        // Delete existing card
        await fetch(
          `${supabaseUrl}/rest/v1/character_tarot?character_name=eq.${encodeURIComponent(character)}`,
          { method: "DELETE", headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );

        // Insert new draw
        await fetch(`${supabaseUrl}/rest/v1/character_tarot`, {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            character_name: character,
            card_name: card.name,
            card_orientation: orientation,
            card_keywords: keywords,
            interpretation,
            drawn_at: new Date().toISOString(),
            expires_at: expiry.toISOString(),
            is_override: false
          })
        });

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, character, card: card.name, orientation, interpretation })
        };
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
