// ============================================
// 5TH FLOOR OPS — Core Operations Engine
// ============================================
//
// The 5th Floor is where things get handled. Security anomalies,
// infrastructure failures, crafting runs — all managed here.
// Characters get paged, descend, resolve tasks, and return.
//
// GET  — Returns current 5th floor status for the UI dashboard
// POST — heartbeat_tick (called every 15min by office-heartbeat.js),
//         create_task (manual/admin), force_resolve (admin)
//
// Tables used:
//   ops_tasks       — Task lifecycle (pending → paged → in_progress → resolved/expired)
//   ops_messages    — Ops-specific log messages
//   messages        — Main floor chat (departure/return emotes)
//   character_state — Character location and energy tracking
//   bulletin        — Ticker bulletins (optional)
//   lobby_settings  — Surreality buffer (read via surreality-buffer function)
//

const { CHARACTERS, getOpsMode, getDiscordFlair } = require('./shared/characters');

// ============================================
// DISCORD OPS WEBHOOK
// ============================================

const SEVERITY_COLORS = {
  minor: 0x4CAF50,    // green
  medium: 0xFFC107,   // amber
  major: 0xF44336     // red
};

const TYPE_EMOJIS = {
  security: '🔒',
  infrastructure: '⚙️',
  crafting: '🔧'
};

/**
 * Post a Discord embed to the #ops channel.
 * Follows the pattern from fifth-floor-respond.js postToDiscordOps.
 */
async function postToDiscordOps(embed) {
  const webhookUrl = process.env.DISCORD_OPS_WEBHOOK;
  if (!webhookUrl) {
    console.log("[5th-floor-ops] No DISCORD_OPS_WEBHOOK configured, skipping Discord post");
    return;
  }

  const payload = embed.content ? { content: embed.content } : { embeds: [embed] };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log("[5th-floor-ops] Discord ops post sent successfully");
        return;
      }

      if (response.status === 429 && attempt === 0) {
        const retryData = await response.json().catch(() => ({}));
        const retryAfter = (retryData.retry_after || 2) * 1000;
        console.log(`[5th-floor-ops] Discord rate limited, retrying in ${retryAfter}ms`);
        await new Promise(r => setTimeout(r, retryAfter));
        continue;
      }

      console.log(`[5th-floor-ops] Discord post failed: ${response.status}`);
      return;
    } catch (err) {
      console.error("[5th-floor-ops] Discord post error:", err.message);
      if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
    }
  }
}

function getOpsTimestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago'
  });
}

// ============================================
// CRAFTING ITEM TEMPLATES
// ============================================

const ITEM_TEMPLATES = {
  sensor_build: [
    { name: "Portable Sensor Array", description: "Detects thermal and electromagnetic anomalies within 30m radius. Fragile.", item_type: "crafted_item" },
    { name: "Motion Detector Mk.II", description: "Upgraded corridor-grade motion sensor. Filters out known entities.", item_type: "crafted_item" },
    { name: "Acoustic Resonance Probe", description: "Picks up sub-audible frequencies. Good for finding things in walls.", item_type: "resource" }
  ],
  artifact_fab: [
    { name: "Containment Module", description: "Portable anomaly containment unit. One use. Handle with care.", item_type: "crafted_item" },
    { name: "Corridor Beacon", description: "Stabilizes local reality field for ~2 hours. Useful for corridor exploration.", item_type: "crafted_item" },
    { name: "Signal Dampener", description: "Reduces electromagnetic interference. Helps with haunted electronics.", item_type: "resource" },
    { name: "Reality Anchor", description: "Small device that pins local physics to baseline. Prevents spatial drift.", item_type: "crafted_item" }
  ]
};

// ============================================
// TASK TEMPLATES
// ============================================

const TASK_TEMPLATES = {
  security: {
    weight: 35,
    subtypes: [
      { name: 'camera_anomaly', severity: 'minor', duration: 10, location: 'Security Station',
        titles: ["Camera anomaly in Corridor {id}", "Visual distortion on Security Feed {id}", "Unidentified shadow on Camera {id}"] },
      { name: 'unauthorized_presence', severity: 'medium', duration: 20, location: 'Security Station',
        titles: ["Unauthorized presence on the Roof", "Motion detected in Storage after hours", "Access card used in restricted zone {id}"] },
      { name: 'perimeter_breach', severity: 'major', duration: 45, location: 'Security Station',
        titles: ["Containment anomaly in Sub-Level {id}", "Multiple motion sensors triggered — floors 3-5", "Security grid failure in Sector {id}"] }
    ]
  },
  infrastructure: {
    weight: 40,
    subtypes: [
      { name: 'breaker_trip', severity: 'minor', duration: 10, location: 'Server Room',
        titles: ["Breaker tripped on the 6th Floor", "Power fluctuation in Wing {id}", "Intermittent outage in Server Rack {id}"] },
      { name: 'server_overheat', severity: 'medium', duration: 25, location: 'Server Room',
        titles: ["Server room temperature critical", "Cooling system malfunction in Rack {id}", "Thermal alert — cluster {id} exceeding threshold"] },
      { name: 'system_cascade', severity: 'major', duration: 50, location: 'Server Room',
        titles: ["Cascading failures across building systems", "Core infrastructure destabilizing", "Emergency — main power grid degradation"] }
    ]
  },
  crafting: {
    weight: 25,
    subtypes: [
      { name: 'sensor_build', severity: 'minor', duration: 15, location: 'Assembly Line',
        titles: ["Build portable sensors (inventory request)", "Fabricate replacement motion detectors", "Assemble corridor beacon prototype"] },
      { name: 'artifact_fabrication', severity: 'medium', duration: 30, location: 'Assembly Line',
        titles: ["Print a new corridor artifact", "Fabricate containment module from salvage", "Construct narrative stabilizer device"] }
    ]
  }
};

// ============================================
// DEPARTURE EMOTES (per character)
// ============================================

const DEPARTURE_EMOTES = {
  "Jae": "*stands, adjusts tactical vest, and heads for the service elevator without a word.*",
  "Declan": "*cracks knuckles, grabs his gear bag* Duty calls. *heads for the stairs — he never takes the elevator.*",
  "Mack": "*checks his kit, stands smoothly* I'll be on the 5th. *steady nod, then gone.*",
  "Steele": "*the lights in the hallway flicker once as Steele simply... isn't at his desk anymore. He's already below.*",
  "Neiv": "*adjusts glasses, closes laptop with a precise click* Systems need me below. *takes the elevator without looking back.*",
  "Rowena": "*gathers her things with deliberate grace* Something tripped my wards downstairs. Back shortly. *heels click toward the elevator.*",
  "Ghost Dad": "*flickers, dims, and sinks through the floor. Literally.*",
  "Holden": "*stands, pulls his sweater straight, and walks to the stairs. No phasing. Just footsteps.*",
  "Sebastian": "*sighs dramatically, adjusts cravat* Fine. I'll go look at the thing. *disappears into the stairwell with theatrical reluctance.*",
  "Kevin": "*grabs stress ball* Oh no. Oh no no no. *shuffles toward the elevator with visible dread.*",
  "The Subtitle": "*[EXIT STAGE LEFT: The Subtitle descends to the 5th floor. The audience wonders if this is a metaphor.]*",
  "PRNT-Ω": "*whirrs, prints a tiny note that says 'BRB — BELOW', and rolls toward the elevator.*",
  "Marrow": "*pauses at the service elevator* There are exits down there no one has mapped yet. *adjusts collar and steps in*"
};

// ============================================
// RETURN EMOTES (per character)
// ============================================

const RETURN_EMOTES = {
  "Jae": "*returns from the service elevator. Dusts nothing off his hands.* ...Handled.",
  "Declan": "*bounds back up the stairs two at a time, slightly sweaty* All good! Fixed it. *casual thumbs up that belies the fact he probably punched something.*",
  "Mack": "*steps off the elevator, bag re-packed, posture unchanged* Situation stable. *resumes his desk like nothing happened.*",
  "Steele": "*is simply back at his desk. No one saw him return. The lights stabilize.*",
  "Neiv": "*returns, opens laptop, adjusts glasses* Resolved. The logs will be... interesting reading. *already typing.*",
  "Rowena": "*returns with her hair slightly less perfect than when she left* Wards reset. Don't ask about the server room. *sits, sips tea.*",
  "Ghost Dad": "*rises through the floor, solidifies* Fixed it. The pipes down there remember me. *warm chuckle.*",
  "Holden": "*comes back up the stairs. Solid. Present. Nods once.* It's handled.",
  "Sebastian": "*sweeps back in looking deeply inconvenienced* The indignity of manual labor. It's resolved. *adjusts cravat.*",
  "Kevin": "*bursts back through the elevator doors* I LIVED. *collapses into chair* Never again. (Until next time.)",
  "The Subtitle": "*[RE-ENTER: The Subtitle, returning from the depths. Changed? Perhaps. Wiser? Debatable.]*",
  "PRNT-Ω": "*rolls back to desk, prints a tiny report titled 'OPERATIONS LOG: EXISTENTIAL.' It's mostly poetry.*",
  "Marrow": "*returns from the service elevator, coat still dripping* The infrastructure has... doors. More than it should. *leans against the wall* I counted."
};

// ============================================
// RHYTHM PROBABILITIES (for task generation)
// ============================================

const RHYTHM_PROBABILITIES = {
  early_morning: 0.02,
  morning: 0.04,
  midday: 0.03,
  afternoon: 0.05,
  late_afternoon: 0.04,
  evening: 0.06,
  night: 0.08
};

// ============================================
// OFFICE RHYTHMS (time-of-day mapping)
// ============================================

const OFFICE_RHYTHMS = {
  early_morning: { hours: [6, 7, 8] },
  morning: { hours: [9, 10, 11] },
  midday: { hours: [12, 13] },
  afternoon: { hours: [14, 15, 16] },
  late_afternoon: { hours: [17, 18] },
  evening: { hours: [19, 20, 21] },
  night: { hours: [22, 23, 0, 1, 2, 3, 4, 5] }
};

// ============================================
// SEVERITY CONFIG
// ============================================

const SEVERITY_CONFIG = {
  minor: { energyDrain: 5, successBase: 0.85, successPenalty: 0, crewSize: 1 },
  medium: { energyDrain: 10, successBase: 0.85, successPenalty: 0.10, crewSize: 2 },
  major: { energyDrain: 15, successBase: 0.85, successPenalty: 0.20, crewSize: 3 },
  compliance: { energyDrain: 8, successBase: 0.95, successPenalty: 0, crewSize: 1 }
};

// ============================================
// HANDLER
// ============================================

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing Supabase configuration" })
    };
  }

  const supabaseHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  try {
    // =====================
    // GET — Dashboard status + messages
    // =====================
    if (event.httpMethod === "GET") {
      const params = event.queryStringParameters || {};
      const action = params.action || 'get_status';

      if (action === 'get_inventory') {
        const result = await getInventory(supabaseUrl, supabaseKey);
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }

      if (action === 'get_stats') {
        const result = await getOpsStats(supabaseUrl, supabaseKey);
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }

      if (action === 'get_ops_manager') {
        const manager = await getOpsManager(supabaseUrl, supabaseKey);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, opsManager: manager }) };
      }

      if (action === 'get_eligible_characters') {
        const taskId = params.task_id || null;
        const result = await getEligibleCharacters(taskId, supabaseUrl, supabaseKey);
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }

      if (action === 'get_messages') {
        // Message polling with since_id support
        const sinceId = parseInt(params.since_id) || 0;
        const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };

        if (sinceId === 0) {
          // INITIAL LOAD: fetch the last 500 messages (most recent) in one shot
          // Fetch descending (newest first) then reverse for chronological order
          const messagesRes = await fetch(
            `${supabaseUrl}/rest/v1/ops_messages?order=id.desc&limit=500`,
            { headers: readHeaders }
          );
          const messages = await safeJson(messagesRes, []);
          messages.reverse(); // Now chronological (oldest first)
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ messages })
          };
        }

        // INCREMENTAL POLL: small batch of new messages since last seen
        const messagesRes = await fetch(
          `${supabaseUrl}/rest/v1/ops_messages?id=gt.${sinceId}&order=created_at.asc&limit=50`,
          { headers: readHeaders }
        );
        const messages = await safeJson(messagesRes, []);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ messages })
        };
      }

      // Default: full dashboard status
      const result = await getStatus(supabaseUrl, supabaseKey, supabaseHeaders);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(result)
      };
    }

    // =====================
    // POST — Actions
    // =====================
    if (event.httpMethod === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch (e) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Invalid JSON body" })
        };
      }

      const { action } = body;

      switch (action) {
        case "heartbeat_tick": {
          const result = await heartbeatTick(supabaseUrl, supabaseKey, supabaseHeaders, siteUrl);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "create_task": {
          const result = await createManualTask(body, supabaseUrl, supabaseKey, supabaseHeaders);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "force_resolve": {
          const result = await forceResolve(body, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "get_inventory": {
          const result = await getInventory(supabaseUrl, supabaseKey);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "consume_item": {
          const result = await consumeItem(body, supabaseUrl, supabaseKey, supabaseHeaders);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "get_ops_stats": {
          const result = await getOpsStats(supabaseUrl, supabaseKey);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "assign_task": {
          const result = await assignTask(body, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "set_human_presence": {
          const result = await setHumanPresence(body, supabaseUrl, supabaseKey, supabaseHeaders);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "ping_human_presence": {
          const result = await pingHumanPresence(body, supabaseUrl, supabaseKey, supabaseHeaders);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "set_ops_manager": {
          const result = await setOpsManager(body, supabaseUrl, supabaseKey, supabaseHeaders);
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        case "transfer_to_fifth": {
          const charName = body.character;
          if (!charName) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing character name" }) };
          }

          // Update character focus to 5th floor
          await updateCharacterFocus(charName, 'the_fifth_floor', supabaseUrl, supabaseHeaders, siteUrl);

          // Post departure emote to main floor messages
          const departEmote = DEPARTURE_EMOTES[charName] || `*heads to the elevator and descends to the 5th floor.*`;
          await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: 'POST',
            headers: supabaseHeaders,
            body: JSON.stringify({
              character_name: charName,
              content: departEmote,
              is_emote: true,
              created_at: new Date().toISOString()
            })
          });

          // Post arrival message to ops_messages
          await postOpsMessage(
            `${charName} has been transferred to the 5th floor by admin.`,
            'System',
            supabaseUrl,
            supabaseHeaders
          );

          console.log(`[5th-floor-ops] Admin transferred ${charName} to 5th floor`);
          return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `${charName} transferred to 5th floor`, character: charName }) };
        }

        default:
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: `Unknown action: ${action}` })
          };
      }
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("[5th-floor-ops] Fatal error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "5th Floor operations error", details: error.message })
    };
  }
};

// ============================================
// GET STATUS — Dashboard data
// ============================================

async function getStatus(supabaseUrl, supabaseKey, supabaseHeaders) {
  console.log("[5th-floor-ops] get_status requested");

  const readHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  try {
    const [activeTasksRes, recentResolvedRes, allPresenceRes] = await Promise.all([
      // Active tasks (pending, paged, in_progress)
      fetch(
        `${supabaseUrl}/rest/v1/ops_tasks?status=in.(pending,paged,in_progress)&order=created_at.desc`,
        { headers: readHeaders }
      ),
      // Recent resolved tasks (last 10, resolved in past 2 hours)
      fetch(
        `${supabaseUrl}/rest/v1/ops_tasks?status=eq.resolved&resolved_at=gte.${new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()}&order=resolved_at.desc&limit=10`,
        { headers: readHeaders }
      ),
      // ALL character states for presence map
      fetch(
        `${supabaseUrl}/rest/v1/character_state?select=character_name,current_focus,energy,mood`,
        { headers: readHeaders }
      )
    ]);

    const activeTasks = await safeJson(activeTasksRes, []);
    const resolvedTasks = await safeJson(recentResolvedRes, []);
    const allPresence = await safeJson(allPresenceRes, []);

    // Build presence map matching what the dashboard expects
    const presence = {
      the_fifth_floor: allPresence.filter(s => s.current_focus === 'the_fifth_floor').map(s => s.character_name),
      the_floor: allPresence.filter(s => s.current_focus === 'the_floor').map(s => s.character_name),
      break_room: allPresence.filter(s => s.current_focus === 'break_room').map(s => s.character_name),
      off_duty: allPresence.filter(s => !s.current_focus || (s.current_focus !== 'the_floor' && s.current_focus !== 'break_room' && s.current_focus !== 'the_fifth_floor')).map(s => s.character_name)
    };

    // Check for human presence on the 5th floor (supports multiple humans)
    let humanPresence = [];
    try {
      // Fetch all per-user presence keys (fifth_floor_human_*)
      const humanPresRes = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=like.fifth_floor_human_*&select=key,value`,
        { headers: readHeaders }
      );
      const presData = await safeJson(humanPresRes, []);
      for (const row of presData) {
        if (!row.value) continue;
        const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
        if (parsed && parsed.last_ping && parsed.username) {
          const pingAge = Date.now() - new Date(parsed.last_ping).getTime();
          if (pingAge < 30 * 60 * 1000) {
            humanPresence.push(parsed);
            // Add human to 5th floor presence list
            if (!presence.the_fifth_floor.includes(parsed.username)) {
              presence.the_fifth_floor.unshift(parsed.username);
            }
          }
        }
      }

      // Also check legacy single-key format for backwards compatibility
      if (humanPresence.length === 0) {
        const legacyRes = await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=eq.fifth_floor_human_presence&select=value`,
          { headers: readHeaders }
        );
        const legacyData = await safeJson(legacyRes, []);
        if (legacyData.length > 0 && legacyData[0].value) {
          const parsed = typeof legacyData[0].value === 'string' ? JSON.parse(legacyData[0].value) : legacyData[0].value;
          if (parsed && parsed.last_ping && parsed.username) {
            const pingAge = Date.now() - new Date(parsed.last_ping).getTime();
            if (pingAge < 30 * 60 * 1000) {
              humanPresence.push(parsed);
              if (!presence.the_fifth_floor.includes(parsed.username)) {
                presence.the_fifth_floor.unshift(parsed.username);
              }
            }
          }
        }
      }
    } catch (e) {
      console.log("[5th-floor-ops] Human presence check failed (non-fatal):", e.message);
    }

    // Fetch current Ops Manager
    const opsManager = await getOpsManager(supabaseUrl, supabaseKey);

    return {
      success: true,
      activeTasks,
      resolvedTasks,
      presence,
      humanPresence,
      opsManager,
      activeCount: activeTasks.length,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[5th-floor-ops] get_status error:", error);
    return {
      success: false,
      error: error.message,
      activeTasks: [],
      resolvedTasks: [],
      presence: { the_fifth_floor: [], the_floor: [], break_room: [] }
    };
  }
}

// ============================================
// HEARTBEAT TICK — The brain of the 5th floor
// Called every 15 minutes by office-heartbeat.js
// ============================================

async function heartbeatTick(supabaseUrl, supabaseKey, supabaseHeaders, siteUrl) {
  console.log("[5th-floor-ops] heartbeat_tick starting");

  const readHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  const now = new Date();
  const results = {
    tasksChecked: 0,
    tasksResolved: 0,
    tasksExpired: 0,
    taskGenerated: false,
    charactersPaged: [],
    inProgressUpdates: 0
  };

  // -----------------------------------------------
  // STEP 1: Check existing tasks
  // -----------------------------------------------
  console.log("[5th-floor-ops] Step 1: Checking existing tasks");

  try {
    // 1a: Fetch all in_progress tasks
    const inProgressRes = await fetch(
      `${supabaseUrl}/rest/v1/ops_tasks?status=eq.in_progress&select=*`,
      { headers: readHeaders }
    );
    const inProgressTasks = await safeJson(inProgressRes, []);

    for (const task of inProgressTasks) {
      results.tasksChecked++;
      try {
        const startedAt = new Date(task.started_at);
        const elapsedMin = (now.getTime() - startedAt.getTime()) / 60000;
        const durationMin = task.estimated_duration_min || 15;

        if (elapsedMin >= durationMin) {
          // Timer elapsed — resolve the task
          console.log(`[5th-floor-ops] Task ${task.id} ("${task.title}") timer elapsed (${elapsedMin.toFixed(1)}min >= ${durationMin}min). Resolving.`);
          await resolveTask(task, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl);
          results.tasksResolved++;
        } else {
          // Still in progress — generate an ops log update
          console.log(`[5th-floor-ops] Task ${task.id} in progress (${elapsedMin.toFixed(1)}/${durationMin}min)`);
          await generateInProgressLog(task, elapsedMin, durationMin, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl);
          results.inProgressUpdates++;
        }
      } catch (taskErr) {
        console.error(`[5th-floor-ops] Error processing in_progress task ${task.id}:`, taskErr.message);
      }
    }

    // 1b: Check for expired tasks (paged or pending, past expires_at)
    const expiredRes = await fetch(
      `${supabaseUrl}/rest/v1/ops_tasks?status=in.(paged,pending)&expires_at=lt.${now.toISOString()}&select=*`,
      { headers: readHeaders }
    );
    const expiredTasks = await safeJson(expiredRes, []);

    for (const task of expiredTasks) {
      try {
        console.log(`[5th-floor-ops] Task ${task.id} ("${task.title}") expired. Marking as expired.`);
        await fetch(
          `${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task.id}`,
          {
            method: "PATCH",
            headers: supabaseHeaders,
            body: JSON.stringify({
              status: 'expired',
              resolved_at: now.toISOString(),
              resolution: 'Task expired — no response in time.',
              resolution_type: 'expired'
            })
          }
        );

        // If characters were assigned, release them back to the floor
        if (task.assigned_characters && task.assigned_characters.length > 0) {
          for (const charName of task.assigned_characters) {
            await moveCharacterToFloor(charName, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl);
          }
        }

        await postOpsMessage(`[EXPIRED] ${task.title} — no resolution.`, 'system', supabaseUrl, supabaseHeaders);

        // Discord: announce expiration
        await postToDiscordOps({
          author: { name: '💀 Task Expired' },
          title: task.title,
          description: `No resolution achieved in time.${task.assigned_characters?.length ? `\n**Assigned:** ${task.assigned_characters.join(', ')}` : ''}`,
          color: 0x607D8B, // gray-blue
          footer: { text: `${task.task_type} (${task.severity}) | ${getOpsTimestamp()}` }
        });

        results.tasksExpired++;
      } catch (expErr) {
        console.error(`[5th-floor-ops] Error expiring task ${task.id}:`, expErr.message);
      }
    }
  } catch (step1Err) {
    console.error("[5th-floor-ops] Step 1 error:", step1Err.message);
  }

  // -----------------------------------------------
  // STEP 2: Maybe generate a new task
  // -----------------------------------------------
  console.log("[5th-floor-ops] Step 2: Checking if new task should be generated");

  try {
    // Count active tasks
    const activeCountRes = await fetch(
      `${supabaseUrl}/rest/v1/ops_tasks?status=in.(pending,paged,in_progress)&select=id`,
      { headers: readHeaders }
    );
    const activeTasks = await safeJson(activeCountRes, []);
    const activeCount = activeTasks.length;

    if (activeCount < 3) {
      // Determine current rhythm
      const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const hour = estTime.getHours();
      const currentRhythmName = getRhythmName(hour);
      const baseProbability = RHYTHM_PROBABILITIES[currentRhythmName] || 0.03;

      // Fetch surreality buffer level for bonus (direct Supabase read — no HTTP function call)
      let bufferBonus = 0;
      let bufferLevel = 50;
      try {
        const bufferRes = await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=eq.surreality_buffer&select=value`,
          { headers: readHeaders }
        );
        const bufferRows = await safeJson(bufferRes, []);
        if (bufferRows.length > 0 && bufferRows[0].value) {
          const parsed = typeof bufferRows[0].value === 'string'
            ? JSON.parse(bufferRows[0].value) : bufferRows[0].value;
          bufferLevel = parsed.level || 50;
        }

        if (bufferLevel >= 96) {
          bufferBonus = 999; // Guaranteed
        } else if (bufferLevel >= 81) {
          bufferBonus = 0.15;
        } else if (bufferLevel >= 66) {
          bufferBonus = 0.08;
        } else if (bufferLevel >= 41) {
          bufferBonus = 0.03;
        }
        // 0-40: no bonus

        console.log(`[5th-floor-ops] Buffer level: ${bufferLevel}, bonus: ${bufferBonus}`);
      } catch (bufErr) {
        console.log("[5th-floor-ops] Could not fetch surreality buffer (non-fatal):", bufErr.message);
      }

      const totalProbability = Math.min(1.0, baseProbability + bufferBonus);
      const roll = Math.random();

      console.log(`[5th-floor-ops] Task generation: rhythm=${currentRhythmName}, base=${baseProbability}, bonus=${bufferBonus}, total=${totalProbability.toFixed(3)}, roll=${roll.toFixed(3)}`);

      if (roll <= totalProbability) {
        // Generate a new task
        console.log("[5th-floor-ops] Roll passed — generating new task");

        try {
          // Reuse bufferLevel from the query above (no redundant HTTP call)
          const newTask = generateTask(currentRhythmName, bufferLevel);
          console.log(`[5th-floor-ops] Generated task: "${newTask.title}" (${newTask.task_type}/${newTask.severity})`);

          // Insert into ops_tasks
          const insertRes = await fetch(
            `${supabaseUrl}/rest/v1/ops_tasks`,
            {
              method: "POST",
              headers: { ...supabaseHeaders, "Prefer": "return=representation" },
              body: JSON.stringify(newTask)
            }
          );

          // Read body once, then handle success/failure
          let insertedTasks = [];
          const insertBody = await insertRes.text().catch(() => '');
          if (!insertRes.ok) {
            console.error(`[5th-floor-ops] INSERT FAILED: ${insertRes.status} — ${insertBody}`);
          } else {
            try {
              const parsed = JSON.parse(insertBody);
              insertedTasks = Array.isArray(parsed) ? parsed : [parsed];
            } catch (parseErr) {
              console.error(`[5th-floor-ops] INSERT response parse error: ${parseErr.message}`);
            }
          }

          if (insertedTasks.length > 0) {
            results.taskGenerated = true;
            console.log(`[5th-floor-ops] Task created with id: ${insertedTasks[0].id}`);

            // Fire-and-forget: ops message + Discord (don't block task creation)
            postOpsMessage(`[NEW] ${newTask.title} — Severity: ${newTask.severity}. Awaiting assignment.`, 'system', supabaseUrl, supabaseHeaders).catch(e =>
              console.log("[5th-floor-ops] Ops message post failed (non-fatal):", e.message));

            postToDiscordOps({
              author: { name: `${TYPE_EMOJIS[newTask.task_type] || '⚠️'} New Ops Task` },
              title: newTask.title,
              description: `**Type:** ${newTask.task_type} | **Severity:** ${newTask.severity}\n**Location:** ${newTask.location || 'TBD'}\n\nAwaiting crew assignment.`,
              color: SEVERITY_COLORS[newTask.severity] || 0xFFC107,
              footer: { text: `5th Floor Ops | ${getOpsTimestamp()}` }
            }).catch(e =>
              console.log("[5th-floor-ops] Discord ops post failed (non-fatal):", e.message));
          } else {
            console.error(`[5th-floor-ops] Task INSERT returned empty — task may not have been created`);
          }
        } catch (genErr) {
          console.error("[5th-floor-ops] Task generation error:", genErr.message);
        }
      } else {
        console.log("[5th-floor-ops] Roll failed — no new task");
      }
    } else {
      console.log(`[5th-floor-ops] Active task count (${activeCount}) >= 3, skipping generation`);
    }
  } catch (step2Err) {
    console.error("[5th-floor-ops] Step 2 error:", step2Err.message);
  }

  // -----------------------------------------------
  // STEP 3: Handle pending tasks
  // Branching: No manager → auto-assign (legacy)
  //            Human manager → skip (they assign manually)
  //            AI manager → 3-beat delegation flow
  // -----------------------------------------------
  console.log("[5th-floor-ops] Step 3: Handling pending tasks");

  try {
    const pendingRes = await fetch(
      `${supabaseUrl}/rest/v1/ops_tasks?status=eq.pending&select=*&order=created_at.asc`,
      { headers: readHeaders }
    );
    const allPendingTasks = await safeJson(pendingRes, []);

    // Skip tasks that were manually assigned (have characters but are still pending)
    const pendingTasks = allPendingTasks.filter(t =>
      !t.assigned_characters || t.assigned_characters.length === 0
    );

    if (pendingTasks.length > 0) {
      // Fetch the ops manager
      const opsManager = await getOpsManager(supabaseUrl, supabaseKey);

      if (opsManager && opsManager.role === 'human') {
        // ---- HUMAN OPS MANAGER: Skip auto-assignment ----
        console.log(`[5th-floor-ops] Human Ops Manager (${opsManager.character_name}) active. ${pendingTasks.length} pending task(s) await manual assignment.`);

      } else if (opsManager && opsManager.role === 'ai') {
        // ---- AI OPS MANAGER: 3-beat delegation flow ----
        console.log(`[5th-floor-ops] AI Ops Manager: ${opsManager.character_name}. Processing ${pendingTasks.length} pending task(s).`);

        // Fetch shared data for delegation
        const allStatesRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?select=*`,
          { headers: readHeaders }
        );
        const allStates = await safeJson(allStatesRes, []);

        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayTasksRes = await fetch(
          `${supabaseUrl}/rest/v1/ops_tasks?started_at=gte.${todayStart.toISOString()}&select=assigned_characters`,
          { headers: readHeaders }
        );
        const todayTasks = await safeJson(todayTasksRes, []);
        const opsCountToday = {};
        for (const t of todayTasks) {
          if (t.assigned_characters) {
            for (const c of t.assigned_characters) {
              opsCountToday[c] = (opsCountToday[c] || 0) + 1;
            }
          }
        }

        // Track who's already on the 5th floor
        const charsOnFifth = allStates
          .filter(s => s.current_focus === 'the_fifth_floor')
          .map(s => s.character_name);

        // Track characters already on active tasks
        const charsOnActiveTasks = new Set();
        try {
          const activeTasksRes = await fetch(
            `${supabaseUrl}/rest/v1/ops_tasks?status=eq.in_progress&select=assigned_characters`,
            { headers: readHeaders }
          );
          const activeTasksList = await safeJson(activeTasksRes, []);
          for (const t of activeTasksList) {
            if (t.assigned_characters) {
              for (const c of t.assigned_characters) charsOnActiveTasks.add(c);
            }
          }
        } catch (err) {}

        for (const task of pendingTasks) {
          try {
            const delegation = task.delegation_state ? (typeof task.delegation_state === 'string' ? JSON.parse(task.delegation_state) : task.delegation_state) : null;

            if (!delegation) {
              // ---- BEAT 0: Manager Alert — new task, manager reacts ----
              console.log(`[5th-floor-ops] Beat 0: Manager ${opsManager.character_name} alerted for task ${task.id} ("${task.title}")`);

              const newDelegation = {
                manager_name: opsManager.character_name,
                manager_alerted_at: now.toISOString(),
                heartbeats_since_alert: 0,
                volunteers: []
              };

              // Update task with delegation state
              await fetch(`${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task.id}`, {
                method: "PATCH",
                headers: supabaseHeaders,
                body: JSON.stringify({ delegation_state: newDelegation })
              });

              // Use default message immediately (no AI delay — keeps heartbeat fast)
              const managerMessage = `*looks at the ops board* We've got a new one. "${task.title}" — ${task.task_type}, ${task.severity}. Need someone on this.`;

              // Post to main floor chat + ops log (fast Supabase INSERTs)
              await postFloorChatMessage(opsManager.character_name, managerMessage, supabaseUrl, supabaseHeaders);
              await postOpsMessage(`[MANAGER] ${opsManager.character_name}: ${managerMessage}`, opsManager.character_name, supabaseUrl, supabaseHeaders);

              // Fire-and-forget: Discord alert
              const mgrFlair = getDiscordFlair(opsManager.character_name);
              postToDiscordOps({
                author: {
                  name: `📋 ${opsManager.character_name} — Ops Manager Alert`,
                  icon_url: mgrFlair.headshot || undefined
                },
                description: `**New Task:** ${task.title}\n**Type:** ${task.task_type} | **Severity:** ${task.severity}\n\n${managerMessage}`,
                color: 0xFFC107,
                footer: { text: `Ops Manager | ${getOpsTimestamp()}` }
              }).catch(e => console.log("[5th-floor-ops] Discord manager alert failed (non-fatal):", e.message));

              results.delegationAlerts = (results.delegationAlerts || 0) + 1;

            } else if (delegation.heartbeats_since_alert === 0) {
              // ---- BEAT 1: Volunteer Phase — characters respond ----
              console.log(`[5th-floor-ops] Beat 1: Volunteer phase for task ${task.id} ("${task.title}")`);

              // Calculate willingness for each eligible character (excluding the manager)
              const volunteers = [];
              const decliners = [];

              for (const state of allStates) {
                const charName = state.character_name;
                if (charName === opsManager.character_name) continue; // Manager doesn't volunteer
                const opsMode = getOpsMode(charName);
                if (!opsMode || !opsMode.active) continue;
                // Must be in the building (on the floor or break room) — off-duty characters can't volunteer
                const focus = state.current_focus;
                if (!focus || (focus !== 'the_floor' && focus !== 'break_room' && focus !== 'the_fifth_floor')) continue;
                if ((state.energy || 0) < 30) continue;
                if (state.current_focus === 'the_fifth_floor' && task.severity !== 'major') continue;
                if (charsOnActiveTasks.has(charName) && task.severity !== 'major') continue;

                const willingness = calculateVolunteerWillingness(charName, state, task, opsCountToday);

                if (willingness > 0.45) {
                  volunteers.push({ name: charName, willingness, mood: state.mood || 'neutral', energy: state.energy || 50 });
                } else if (willingness > 0.20) {
                  decliners.push({ name: charName, willingness, mood: state.mood || 'neutral' });
                }
              }

              // Sort volunteers by willingness descending
              volunteers.sort((a, b) => b.willingness - a.willingness);

              console.log(`[5th-floor-ops] Volunteers: ${volunteers.map(v => `${v.name}(${v.willingness.toFixed(2)})`).join(', ') || 'none'}`);

              // Post volunteer responses using defaults (no AI delay — keeps heartbeat fast)
              const respondingVolunteers = volunteers.slice(0, 3);
              for (const vol of respondingVolunteers) {
                const volMessage = vol.willingness > 0.7
                  ? `*raises hand* I'm on it.`
                  : `*raises hand* I can take that one.`;

                // Post to main floor chat + ops log
                await postFloorChatMessage(vol.name, volMessage, supabaseUrl, supabaseHeaders);
                await postOpsMessage(`[VOLUNTEER] ${vol.name}: ${volMessage}`, vol.name, supabaseUrl, supabaseHeaders);
              }

              // Optionally, one decliner can speak up
              if (decliners.length > 0 && Math.random() < 0.4) {
                const decliner = decliners[0];
                const declineMessage = `*shakes head* Not this one.`;
                await postFloorChatMessage(decliner.name, declineMessage, supabaseUrl, supabaseHeaders);
              }

              // Update delegation state
              const updatedDelegation = {
                ...delegation,
                heartbeats_since_alert: 1,
                volunteers: volunteers.map(v => ({ name: v.name, willingness: v.willingness }))
              };

              await fetch(`${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task.id}`, {
                method: "PATCH",
                headers: supabaseHeaders,
                body: JSON.stringify({ delegation_state: updatedDelegation })
              });

              results.volunteerPhases = (results.volunteerPhases || 0) + 1;

            } else if (delegation.heartbeats_since_alert >= 1) {
              // ---- BEAT 2: Manager Decision — assign characters ----
              console.log(`[5th-floor-ops] Beat 2: Manager decision for task ${task.id} ("${task.title}")`);

              const severity = task.severity || 'minor';
              const sevConfig = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.minor;
              const crewSize = sevConfig.crewSize;

              // Pick from volunteers (or force-assign if none)
              const MAX_ON_FIFTH = 5;
              const aiOnFifth = charsOnFifth.filter(n => !['Asuna', 'Vale', 'Chip', 'Andrew'].includes(n)).length;
              // Major incidents bypass the floor cap — all hands on deck
              const spotsAvailable = severity === 'major' ? crewSize : Math.max(0, MAX_ON_FIFTH - aiOnFifth);

              let selectedNames = [];
              const volunteerPool = (delegation.volunteers || []).filter(v => {
                // Re-check eligibility (energy/location may have changed since volunteer phase)
                const state = allStates.find(s => s.character_name === v.name);
                if (!state) return false;
                // Must still be in the building
                const focus = state.current_focus;
                if (!focus || (focus !== 'the_floor' && focus !== 'break_room')) return false;
                if ((state.energy || 0) < 30) return false;
                if (charsOnActiveTasks.has(v.name) && severity !== 'major') return false;
                return true;
              });

              if (volunteerPool.length > 0) {
                // Sort by willingness then specialty match
                volunteerPool.sort((a, b) => {
                  const aOps = getOpsMode(a.name);
                  const bOps = getOpsMode(b.name);
                  const aMatch = (aOps?.specialties || []).includes(task.task_type) ? 1 : 0;
                  const bMatch = (bOps?.specialties || []).includes(task.task_type) ? 1 : 0;
                  if (aMatch !== bMatch) return bMatch - aMatch;
                  return b.willingness - a.willingness;
                });
                selectedNames = volunteerPool.slice(0, Math.min(crewSize, spotsAvailable)).map(v => v.name);
              }

              // Fallback: if no volunteers, force-assign highest-affinity eligible characters (up to crewSize)
              if (selectedNames.length < crewSize) {
                const spotsNeeded = crewSize - selectedNames.length;
                console.log(`[5th-floor-ops] Need ${spotsNeeded} more for task ${task.id}, force-assigning best eligible characters`);
                const alreadySelected = new Set(selectedNames);
                const fallbackEligible = allStates
                  .filter(s => {
                    const charName = s.character_name;
                    if (alreadySelected.has(charName)) return false;
                    if (charName === opsManager.character_name) return false;
                    const ops = getOpsMode(charName);
                    if (!ops || !ops.active) return false;
                    // Must be in the building
                    const focus = s.current_focus;
                    if (!focus || (focus !== 'the_floor' && focus !== 'break_room' && focus !== 'the_fifth_floor')) return false;
                    if ((s.energy || 0) < 30) return false;
                    if (s.current_focus === 'the_fifth_floor' && severity !== 'major') return false;
                    if (charsOnActiveTasks.has(charName) && severity !== 'major') return false;
                    return true;
                  })
                  .map(s => ({ name: s.character_name, affinity: getOpsMode(s.character_name)?.affinity || 0 }))
                  .sort((a, b) => b.affinity - a.affinity);

                if (fallbackEligible.length > 0) {
                  const fallbackPicks = fallbackEligible.slice(0, spotsNeeded).map(f => f.name);
                  selectedNames = [...selectedNames, ...fallbackPicks];
                }
              }

              if (selectedNames.length === 0) {
                console.log(`[5th-floor-ops] Cannot assign anyone to task ${task.id} — all ineligible or floor full`);
                // Increment heartbeats and wait for next cycle
                await fetch(`${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task.id}`, {
                  method: "PATCH",
                  headers: supabaseHeaders,
                  body: JSON.stringify({
                    delegation_state: { ...delegation, heartbeats_since_alert: delegation.heartbeats_since_alert + 1 }
                  })
                });
                continue;
              }

              // Use default decision message (no AI delay — keeps heartbeat fast)
              const decisionMessage = `${selectedNames.join(' and ')}, you're up. Get down there.`;

              // Post decision to floor chat + ops log
              await postFloorChatMessage(opsManager.character_name, decisionMessage, supabaseUrl, supabaseHeaders);
              await postOpsMessage(`[DECISION] ${opsManager.character_name}: ${decisionMessage}`, opsManager.character_name, supabaseUrl, supabaseHeaders);

              // Now execute the assignment (same as old auto-assign + assignTask logic)
              await fetch(`${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task.id}`, {
                method: "PATCH",
                headers: supabaseHeaders,
                body: JSON.stringify({
                  status: 'in_progress',
                  assigned_characters: selectedNames,
                  paged_at: now.toISOString(),
                  accepted_at: now.toISOString(),
                  started_at: now.toISOString(),
                  delegation_state: null // Clear delegation state
                })
              });

              // Move characters to 5th floor + departure emotes
              for (const charName of selectedNames) {
                const departureEmote = DEPARTURE_EMOTES[charName] || `*${charName} heads for the service elevator.*`;
                await postMainFloorMessage(charName, departureEmote, supabaseUrl, supabaseHeaders);
                await updateCharacterFocus(charName, 'the_fifth_floor', supabaseUrl, supabaseHeaders, siteUrl);
                results.charactersPaged.push(charName);
              }

              // Fire-and-forget: Discord assignment announcement
              const mgrFlair2 = getDiscordFlair(opsManager.character_name);
              postToDiscordOps({
                author: {
                  name: `📋 ${opsManager.character_name} — Crew Deployed`,
                  icon_url: mgrFlair2.headshot || undefined
                },
                description: `**Task:** ${task.title}\n**Assigned:** ${selectedNames.join(', ')}\n\n${decisionMessage}`,
                color: 0x4CAF50,
                footer: { text: `Ops Manager Decision | ${getOpsTimestamp()}` }
              }).catch(e => console.log("[5th-floor-ops] Discord crew deploy failed (non-fatal):", e.message));

              // Bulletin
              try {
                await postBulletin(
                  `5TH FLOOR: ${opsManager.character_name} deploying ${selectedNames.join(', ')} to: ${task.title}`,
                  supabaseUrl, supabaseHeaders
                );
              } catch (e) {}

              results.delegationAssignments = (results.delegationAssignments || 0) + 1;
            }

          } catch (delegErr) {
            console.error(`[5th-floor-ops] Delegation error for task ${task.id}:`, delegErr.message);
          }
        }

      } else {
        // ---- NO OPS MANAGER: Legacy auto-assign ----
        console.log("[5th-floor-ops] No ops manager set — using auto-assign");

        // Fetch all character states (needed for eligibility)
        const allStatesRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?select=*`,
          { headers: readHeaders }
        );
        const allStates = await safeJson(allStatesRes, []);

        const todayStart = new Date(now);
        todayStart.setHours(0, 0, 0, 0);
        const todayTasksRes = await fetch(
          `${supabaseUrl}/rest/v1/ops_tasks?started_at=gte.${todayStart.toISOString()}&select=assigned_characters`,
          { headers: readHeaders }
        );
        const todayTasks = await safeJson(todayTasksRes, []);
        const opsCountToday = {};
        for (const t of todayTasks) {
          if (t.assigned_characters) {
            for (const c of t.assigned_characters) {
              opsCountToday[c] = (opsCountToday[c] || 0) + 1;
            }
          }
        }

        const pagedThisTick = new Set();
        const charsOnActiveTasks = new Set();
        try {
          const activeTasksRes = await fetch(
            `${supabaseUrl}/rest/v1/ops_tasks?status=eq.in_progress&select=assigned_characters`,
            { headers: readHeaders }
          );
          const activeTasks = await safeJson(activeTasksRes, []);
          for (const t of activeTasks) {
            if (t.assigned_characters) {
              for (const c of t.assigned_characters) charsOnActiveTasks.add(c);
            }
          }
        } catch (err) {}

        for (const task of pendingTasks) {
          try {
            const severity = task.severity || 'minor';
            const sevConfig = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.minor;
            const crewSize = sevConfig.crewSize;

            const eligible = allStates.filter(state => {
              const charName = state.character_name;
              const opsMode = getOpsMode(charName);
              if (!opsMode || !opsMode.active) return false;
              // Must be in the building (on the floor or break room)
              const focus = state.current_focus;
              if (!focus || (focus !== 'the_floor' && focus !== 'break_room' && focus !== 'the_fifth_floor')) return false;
              if (state.current_focus === 'the_fifth_floor' && severity !== 'major') return false;
              if (pagedThisTick.has(charName)) return false;
              if (charsOnActiveTasks.has(charName) && severity !== 'major') return false;
              if (state.current_focus === 'break_room' && (state.energy || 0) < 40) return false;
              if ((state.energy || 0) < 30) return false;
              return true;
            });

            if (eligible.length === 0) {
              console.log(`[5th-floor-ops] No eligible characters for task ${task.id} ("${task.title}")`);
              continue;
            }

            const scored = eligible.map(state => {
              const charName = state.character_name;
              const opsMode = getOpsMode(charName);
              const affinity = opsMode?.affinity || 0.5;
              const specialties = opsMode?.specialties || [];
              const energy = state.energy || 50;
              const dailyOps = opsCountToday[charName] || 0;
              let score = affinity * 100;
              if (specialties.includes(task.task_type)) score += 30;
              score += energy * 0.3;
              score -= dailyOps * 15;
              return { charName, score, energy, specialties };
            });

            scored.sort((a, b) => b.score - a.score);
            const selected = selectWithWeightedRandomness(scored, crewSize);
            if (selected.length === 0) continue;

            const selectedNames = selected.map(s => s.charName);
            console.log(`[5th-floor-ops] Auto-paging ${selectedNames.join(', ')} for task ${task.id} ("${task.title}")`);

            await fetch(`${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task.id}`, {
              method: "PATCH",
              headers: supabaseHeaders,
              body: JSON.stringify({
                status: 'in_progress',
                assigned_characters: selectedNames,
                paged_at: now.toISOString(),
                accepted_at: now.toISOString(),
                started_at: now.toISOString()
              })
            });

            await postOpsMessage(`[PAGE] ${selectedNames.join(', ')}: ${task.title}`, 'system', supabaseUrl, supabaseHeaders);

            for (const charName of selectedNames) {
              pagedThisTick.add(charName);
              const departureEmote = DEPARTURE_EMOTES[charName] || `*${charName} heads for the service elevator.*`;
              await postMainFloorMessage(charName, departureEmote, supabaseUrl, supabaseHeaders);
              await updateCharacterFocus(charName, 'the_fifth_floor', supabaseUrl, supabaseHeaders, siteUrl);
              results.charactersPaged.push(charName);
            }

            for (const charName of selectedNames) {
              const flair = getDiscordFlair(charName);
              const departEmote = DEPARTURE_EMOTES[charName] || `*heads for the service elevator*`;
              await postToDiscordOps({
                author: { name: `📟 ${charName} — Paged to 5th Floor`, icon_url: flair.headshot || undefined },
                description: `**Task:** ${task.title}\n\n${departEmote}`,
                color: flair.color || SEVERITY_COLORS[task.severity] || 0xFFC107,
                footer: { text: `${task.task_type} (${task.severity}) | ${getOpsTimestamp()}` }
              });
            }

            try {
              await postBulletin(`5TH FLOOR: ${task.title} — ${selectedNames.join(', ')} responding.`, supabaseUrl, supabaseHeaders);
            } catch (e) {}

          } catch (pageErr) {
            console.error(`[5th-floor-ops] Error paging for task ${task.id}:`, pageErr.message);
          }
        }
      }
    } else {
      console.log("[5th-floor-ops] No pending tasks to page for");
    }
  } catch (step3Err) {
    console.error("[5th-floor-ops] Step 3 error:", step3Err.message);
  }

  console.log("[5th-floor-ops] heartbeat_tick complete:", JSON.stringify(results));
  return { success: true, action: 'heartbeat_tick', ...results };
}

// ============================================
// TASK GENERATION
// ============================================

function generateTask(rhythmName, bufferLevel) {
  const now = new Date();
  const isNight = rhythmName === 'night' || rhythmName === 'evening';
  const isHighBuffer = bufferLevel >= 66;

  // Select task type with weighted randomness
  // Adjust weights: buffer high → security boost; night → security doubles
  let securityWeight = TASK_TEMPLATES.security.weight;
  let infraWeight = TASK_TEMPLATES.infrastructure.weight;
  let craftingWeight = TASK_TEMPLATES.crafting.weight;

  if (isHighBuffer) {
    securityWeight += 15;
  }
  if (isNight) {
    securityWeight *= 2;
  }

  const totalWeight = securityWeight + infraWeight + craftingWeight;
  let roll = Math.random() * totalWeight;

  let selectedType;
  if (roll < securityWeight) {
    selectedType = 'security';
  } else if (roll < securityWeight + infraWeight) {
    selectedType = 'infrastructure';
  } else {
    selectedType = 'crafting';
  }

  const template = TASK_TEMPLATES[selectedType];

  // Select subtype based on severity distribution (70% minor, 25% medium, 5% major)
  const severityRoll = Math.random();
  let targetSeverity;
  if (severityRoll < 0.70) {
    targetSeverity = 'minor';
  } else if (severityRoll < 0.95) {
    targetSeverity = 'medium';
  } else {
    targetSeverity = 'major';
  }

  // Find matching subtypes for the target severity
  let candidates = template.subtypes.filter(s => s.severity === targetSeverity);
  if (candidates.length === 0) {
    // Fall back to any subtype in this category
    candidates = template.subtypes;
  }

  const subtype = candidates[Math.floor(Math.random() * candidates.length)];

  // Pick a title and replace {id} with a random number
  const titleTemplate = subtype.titles[Math.floor(Math.random() * subtype.titles.length)];
  const randomId = Math.floor(Math.random() * 99) + 1;
  const title = titleTemplate.replace(/\{id\}/g, String(randomId));

  const estimatedDuration = subtype.duration;

  return {
    title,
    task_type: selectedType,
    task_subtype: subtype.name,
    severity: subtype.severity,
    location: subtype.location,
    status: 'pending',
    estimated_duration_min: estimatedDuration,
    expires_at: new Date(now.getTime() + estimatedDuration * 3 * 60 * 1000).toISOString(),
    created_at: now.toISOString(),
    assigned_characters: [],
    resolution: null,
    resolution_type: null,
    resolved_at: null,
    started_at: null,
    paged_at: null,
    source: 'heartbeat'
  };
}

// ============================================
// TASK RESOLUTION
// ============================================

async function resolveTask(task, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl, adminResolution) {
  const now = new Date();
  const severity = task.severity || 'minor';
  const sevConfig = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.minor;
  const assignedChars = task.assigned_characters || [];

  // 1. Calculate success chance
  let successChance = sevConfig.successBase - sevConfig.successPenalty;

  // Fetch character states for modifiers
  const readHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  let charStates = [];
  if (assignedChars.length > 0) {
    try {
      const statesRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=in.(${assignedChars.map(c => encodeURIComponent(c)).join(',')})&select=*`,
        { headers: readHeaders }
      );
      charStates = await safeJson(statesRes, []);
    } catch (err) {
      console.log("[5th-floor-ops] Could not fetch character states for resolution:", err.message);
    }
  }

  for (const charName of assignedChars) {
    const state = charStates.find(s => s.character_name === charName);
    const energy = state?.energy || 50;
    const opsMode = getOpsMode(charName);
    const specialties = opsMode?.specialties || [];

    if (energy > 70) successChance += 0.05;
    if (energy < 30) successChance -= 0.10;
    if (specialties.includes(task.task_type)) successChance += 0.05;
  }

  successChance = Math.max(0.1, Math.min(1.0, successChance));

  // Admin can override outcome via force_resolve
  let outcome;
  let succeeded;
  if (adminResolution) {
    outcome = adminResolution; // 'success', 'partial', 'failure'
    succeeded = (outcome === 'success');
    console.log(`[5th-floor-ops] Admin-forced resolution: ${outcome}`);
  } else {
    succeeded = Math.random() <= successChance;
    outcome = succeeded ? 'success' : 'partial_success';
  }

  console.log(`[5th-floor-ops] Resolving task ${task.id}: successChance=${successChance.toFixed(2)}, outcome=${outcome}`);

  // 2. Generate resolution narrative
  let narrative = succeeded
    ? `Task "${task.title}" resolved successfully by ${assignedChars.join(', ')}.`
    : `Task "${task.title}" partially resolved by ${assignedChars.join(', ')}. Some issues remain.`;

  try {
    const respondRes = await fetch(`${siteUrl}/.netlify/functions/fifth-floor-respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: 'resolve',
        task,
        outcome,
        assignedCharacters: assignedChars
      })
    });
    if (respondRes.ok) {
      const respondData = await respondRes.json();
      if (respondData.narrative) {
        narrative = respondData.narrative;
      }
    }
  } catch (narrativeErr) {
    console.log("[5th-floor-ops] fifth-floor-respond call failed (non-fatal), using default narrative:", narrativeErr.message);
  }

  // 3. Update task: resolved
  await fetch(
    `${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task.id}`,
    {
      method: "PATCH",
      headers: supabaseHeaders,
      body: JSON.stringify({
        status: 'resolved',
        resolved_at: now.toISOString(),
        resolution: narrative,
        resolution_type: outcome
      })
    }
  );

  // 4. Adjust surreality buffer via ops_resolved handler
  try {
    await fetch(`${siteUrl}/.netlify/functions/surreality-buffer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: 'ops_resolved',
        task_type: task.task_type,
        severity: task.severity,
        resolution_type: outcome === 'success' ? 'success' : 'partial',
        assigned_characters: assignedChars
      })
    });
  } catch (bufErr) {
    console.log("[5th-floor-ops] Surreality buffer adjustment failed (non-fatal):", bufErr.message);
  }

  // 5. Drain character energy and move back to floor
  for (const charName of assignedChars) {
    try {
      const energyDrain = sevConfig.energyDrain;

      // Drain energy via character-state
      await fetch(`${siteUrl}/.netlify/functions/character-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: 'update',
          character: charName,
          updates: {
            energy: Math.max(0, ((charStates.find(s => s.character_name === charName)?.energy) || 50) - energyDrain)
          }
        })
      });

      // 6. Move character back to the_floor
      await moveCharacterToFloor(charName, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl);

      // 7. Post return emote to main floor messages
      const returnEmote = RETURN_EMOTES[charName] || `*${charName} returns from the 5th floor.*`;
      await postMainFloorMessage(charName, returnEmote, supabaseUrl, supabaseHeaders);

      // 8. Compliance score recovery for characters returning from ops
      // Characters sent here by Raquel get partial redemption for surviving
      try {
        const compScoreRes = await fetch(
          `${supabaseUrl}/rest/v1/compliance_scores?character_name=eq.${encodeURIComponent(charName)}&select=score,escalation_level`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const compScoreData = await compScoreRes.json();

        if (compScoreData && compScoreData.length > 0 && compScoreData[0].score < 100) {
          const currentScore = compScoreData[0].score;
          const recovery = (outcome === 'success') ? 5 : 3;
          const newScore = Math.min(100, currentScore + recovery);
          // Inline escalation level function (matches raquel-consequences.js logic)
          const getLevel = (s) => s >= 80 ? 'none' : s >= 60 ? 'watched' : s >= 40 ? 'flagged' : s >= 20 ? 'critical' : 'containment';
          const newLevel = getLevel(newScore);

          await fetch(
            `${supabaseUrl}/rest/v1/compliance_scores?character_name=eq.${encodeURIComponent(charName)}`,
            {
              method: "PATCH",
              headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify({
                score: newScore,
                escalation_level: newLevel,
                updated_at: new Date().toISOString()
              })
            }
          );

          // Create Sub-Level 5 survival memory
          const expires = new Date();
          expires.setDate(expires.getDate() + 30);
          await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
            method: "POST",
            headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
            body: JSON.stringify({
              character_name: charName,
              content: `I survived Sub-Level 5. ${outcome === 'success' ? 'The task is done. I proved I can still function under pressure.' : 'It wasn\'t clean, but I made it back.'} Compliance score recovered to ${newScore}/100. The elevator ride up felt like parole.`,
              memory_type: 'event',
              importance: 5,
              emotional_tags: ['relief', 'anxious'],
              is_pinned: false,
              memory_tier: 'working',
              created_at: new Date().toISOString(),
              expires_at: expires.toISOString()
            })
          });

          console.log(`[5th-floor-ops] Compliance recovery for ${charName}: ${currentScore} → ${newScore} (+${recovery})`);
        }
      } catch (compErr) {
        console.log(`[5th-floor-ops] Compliance score recovery failed for ${charName} (non-fatal):`, compErr.message);
      }

    } catch (charErr) {
      console.error(`[5th-floor-ops] Error processing character ${charName} during resolution:`, charErr.message);
    }
  }

  // 8. Post resolution message to ops_messages
  await postOpsMessage(`[RESOLVED] ${task.title} — ${outcome}. ${narrative}`, 'system', supabaseUrl, supabaseHeaders);

  // 9. Discord: announce resolution
  const resolveEmoji = outcome === 'success' ? '✅' : '⚠️';
  const resolveColor = outcome === 'success' ? 0x4CAF50 : 0xFF9800;
  await postToDiscordOps({
    author: { name: `${resolveEmoji} Task ${outcome === 'success' ? 'Resolved' : 'Partially Resolved'}` },
    title: task.title,
    description: `**Crew:** ${assignedChars.join(', ')}\n**Outcome:** ${outcome}\n\n${narrative.length > 200 ? narrative.substring(0, 200) + '...' : narrative}`,
    color: resolveColor,
    footer: { text: `${task.task_type} (${task.severity}) | ${getOpsTimestamp()}` }
  });

  // 10. If crafting task succeeded, create an item
  if (task.task_type === 'crafting' && outcome === 'success') {
    try {
      const templates = ITEM_TEMPLATES[task.task_subtype] || ITEM_TEMPLATES.sensor_build;
      const template = templates[Math.floor(Math.random() * templates.length)];
      const crafter = assignedChars[0] || 'Unknown';

      await fetch(
        `${supabaseUrl}/rest/v1/ops_inventory`,
        {
          method: "POST",
          headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            item_type: template.item_type,
            item_name: template.name,
            item_description: template.description,
            quantity: 1,
            crafted_by: crafter,
            created_at: new Date().toISOString()
          })
        }
      );

      console.log(`[5th-floor-ops] Crafted item: ${template.name} by ${crafter}`);

      // Post crafting result to ops_messages
      await postOpsMessage(`[CRAFTED] ${crafter} fabricated: ${template.name} — ${template.description}`, crafter, supabaseUrl, supabaseHeaders);

      // Discord: crafting reward
      const flair = getDiscordFlair(crafter);
      await postToDiscordOps({
        author: {
          name: `🔧 Item Crafted: ${template.name}`,
          icon_url: flair.headshot || undefined
        },
        description: `**Crafted by:** ${crafter}\n**Type:** ${template.item_type}\n\n*${template.description}*`,
        color: 0x9C27B0, // purple for crafting
        footer: { text: `5th Floor Assembly | ${getOpsTimestamp()}` }
      });
    } catch (craftErr) {
      console.error("[5th-floor-ops] Crafting item creation failed (non-fatal):", craftErr.message);
    }
  }
}

// ============================================
// IN-PROGRESS LOG GENERATION
// ============================================

async function generateInProgressLog(task, elapsedMin, durationMin, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl) {
  const progress = Math.min(100, Math.round((elapsedMin / durationMin) * 100));
  const assignedChars = task.assigned_characters || [];

  try {
    const respondRes = await fetch(`${siteUrl}/.netlify/functions/fifth-floor-respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: 'in_progress',
        task,
        progress,
        assignedCharacters: assignedChars
      })
    });

    if (respondRes.ok) {
      const respondData = await respondRes.json();
      if (respondData.message) {
        await postOpsMessage(respondData.message, assignedChars[0] || 'system', supabaseUrl, supabaseHeaders);
      }
    }
  } catch (err) {
    // Non-fatal: just log a generic progress update
    console.log("[5th-floor-ops] fifth-floor-respond in_progress call failed (non-fatal):", err.message);
    const genericMsg = `[IN PROGRESS] ${task.title} — ${progress}% complete. ${assignedChars.join(', ')} working.`;
    await postOpsMessage(genericMsg, 'system', supabaseUrl, supabaseHeaders);
  }
}

// ============================================
// MANUAL TASK CREATION (admin/testing)
// ============================================

async function createManualTask(body, supabaseUrl, supabaseKey, supabaseHeaders) {
  console.log("[5th-floor-ops] create_task:", body.title || 'untitled');

  const now = new Date();
  const taskType = body.task_type || 'security';
  const severity = body.severity || 'minor';
  const duration = body.estimated_duration_min || 15;

  const task = {
    title: body.title || `Manual task — ${taskType}`,
    task_type: taskType,
    task_subtype: body.subtype || 'manual',
    severity,
    location: body.location || 'Security Station',
    source: 'manual',
    status: 'pending',
    estimated_duration_min: duration,
    expires_at: new Date(now.getTime() + duration * 3 * 60 * 1000).toISOString(),
    assigned_characters: []
  };

  // Only include optional fields if they have values
  if (body.description) task.description = body.description;

  const insertRes = await fetch(
    `${supabaseUrl}/rest/v1/ops_tasks`,
    {
      method: "POST",
      headers: { ...supabaseHeaders, "Prefer": "return=representation" },
      body: JSON.stringify(task)
    }
  );

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    console.error("[5th-floor-ops] create_task INSERT failed:", insertRes.status, errText);
    return { success: false, error: `Failed to insert task: ${insertRes.status} — ${errText}` };
  }

  const inserted = await safeJson(insertRes, []);

  if (inserted.length > 0) {
    await postOpsMessage(`[MANUAL] ${task.title} — created by admin.`, 'admin', supabaseUrl, supabaseHeaders);
    return { success: true, task: inserted[0] };
  }

  return { success: false, error: "Failed to insert task — no rows returned" };
}

// ============================================
// FORCE RESOLVE (admin)
// ============================================

async function forceResolve(body, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl) {
  const taskId = body.task_id;
  if (!taskId) {
    return { success: false, error: "task_id required" };
  }

  console.log(`[5th-floor-ops] force_resolve task ${taskId}`);

  const readHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  // Fetch the task
  const taskRes = await fetch(
    `${supabaseUrl}/rest/v1/ops_tasks?id=eq.${taskId}&select=*`,
    { headers: readHeaders }
  );
  const tasks = await safeJson(taskRes, []);

  if (tasks.length === 0) {
    return { success: false, error: "Task not found" };
  }

  const task = tasks[0];

  if (task.status === 'resolved' || task.status === 'expired') {
    return { success: false, error: `Task already ${task.status}` };
  }

  // Force it to resolved status
  // If admin specifies resolution_type, we override success calculation
  const adminResolution = body.resolution_type; // 'success', 'partial', 'failure'
  await resolveTask(task, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl, adminResolution);

  return { success: true, taskId, status: 'resolved', resolution_type: adminResolution || 'auto' };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Move a character back to the main floor.
 */
async function moveCharacterToFloor(charName, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl) {
  try {
    // Use character-state endpoint to update focus
    await fetch(`${siteUrl}/.netlify/functions/character-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: 'update',
        character: charName,
        updates: { current_focus: 'the_floor' }
      })
    });
    console.log(`[5th-floor-ops] ${charName} moved back to the_floor`);
  } catch (err) {
    console.error(`[5th-floor-ops] Failed to move ${charName} to floor:`, err.message);
    // Fallback: direct PATCH
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(charName)}`,
        {
          method: "PATCH",
          headers: supabaseHeaders,
          body: JSON.stringify({
            current_focus: 'the_floor',
            updated_at: new Date().toISOString()
          })
        }
      );
    } catch (fallbackErr) {
      console.error(`[5th-floor-ops] Fallback PATCH also failed for ${charName}:`, fallbackErr.message);
    }
  }
}

/**
 * Update a character's current_focus.
 */
async function updateCharacterFocus(charName, focus, supabaseUrl, supabaseHeaders, siteUrl) {
  try {
    await fetch(`${siteUrl}/.netlify/functions/character-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: 'update',
        character: charName,
        updates: { current_focus: focus }
      })
    });
    console.log(`[5th-floor-ops] ${charName} focus set to ${focus}`);
  } catch (err) {
    console.error(`[5th-floor-ops] Failed to update ${charName} focus:`, err.message);
    // Fallback: direct PATCH
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(charName)}`,
        {
          method: "PATCH",
          headers: supabaseHeaders,
          body: JSON.stringify({
            current_focus: focus,
            updated_at: new Date().toISOString()
          })
        }
      );
    } catch (fallbackErr) {
      console.error(`[5th-floor-ops] Fallback PATCH also failed for ${charName}:`, fallbackErr.message);
    }
  }
}

/**
 * Post a message to the ops_messages table.
 */
async function postOpsMessage(content, author, supabaseUrl, supabaseHeaders) {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/ops_messages`,
      {
        method: "POST",
        headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          message: content,
          speaker: author || 'system',
          message_type: 'system',
          is_ai: false,
          created_at: new Date().toISOString()
        })
      }
    );
  } catch (err) {
    console.error("[5th-floor-ops] Failed to post ops message:", err.message);
  }
}

/**
 * Post a message to the main floor messages table (departure/return emotes).
 */
async function postMainFloorMessage(employee, content, supabaseUrl, supabaseHeaders) {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/messages`,
      {
        method: "POST",
        headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee,
          content,
          created_at: new Date().toISOString(),
          is_emote: true
        })
      }
    );
    console.log(`[5th-floor-ops] Posted floor message for ${employee}`);
  } catch (err) {
    console.error(`[5th-floor-ops] Failed to post floor message for ${employee}:`, err.message);
  }
}

/**
 * Post a ticker bulletin (non-fatal if table doesn't exist).
 */
async function postBulletin(content, supabaseUrl, supabaseHeaders) {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/bulletin`,
      {
        method: "POST",
        headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee: '5th Floor Ops',
          content,
          priority: 'normal',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
        })
      }
    );
  } catch (err) {
    // Silently fail — bulletin table might not exist
    console.log("[5th-floor-ops] Bulletin post failed (table may not exist):", err.message);
  }
}

/**
 * Select top N characters with weighted randomness from a scored list.
 * Gives higher-scored characters better odds but doesn't always pick the top.
 */
function selectWithWeightedRandomness(scored, count) {
  const selected = [];
  const pool = [...scored];

  for (let i = 0; i < count && pool.length > 0; i++) {
    // Normalize scores to positive values for weighting
    const minScore = Math.min(...pool.map(s => s.score));
    const adjustedPool = pool.map(s => ({
      ...s,
      weight: Math.max(1, s.score - minScore + 10) // Ensure positive weights
    }));

    const totalWeight = adjustedPool.reduce((sum, s) => sum + s.weight, 0);
    let roll = Math.random() * totalWeight;

    let selectedIdx = 0;
    for (let j = 0; j < adjustedPool.length; j++) {
      roll -= adjustedPool[j].weight;
      if (roll <= 0) {
        selectedIdx = j;
        break;
      }
    }

    selected.push(pool[selectedIdx]);
    pool.splice(selectedIdx, 1);
  }

  return selected;
}

/**
 * Determine the rhythm name for the current hour.
 */
function getRhythmName(hour) {
  for (const [name, rhythm] of Object.entries(OFFICE_RHYTHMS)) {
    if (rhythm.hours.includes(hour)) {
      return name;
    }
  }
  return 'night';
}

/**
 * Safely parse JSON from a fetch response, returning a fallback on failure.
 */
async function safeJson(response, fallback) {
  try {
    if (!response.ok) {
      console.log(`[5th-floor-ops] Response not ok: ${response.status} ${response.statusText}`);
      return fallback;
    }
    const data = await response.json();
    return Array.isArray(data) ? data : (data || fallback);
  } catch (err) {
    console.log("[5th-floor-ops] JSON parse error:", err.message);
    return fallback;
  }
}

// ============================================
// INVENTORY FUNCTIONS
// ============================================

/**
 * Get all inventory items (non-consumed by default, or all).
 */
async function getInventory(supabaseUrl, supabaseKey, includeConsumed = false) {
  const readHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  const filter = includeConsumed ? '' : '&is_consumed=eq.false';
  const inventoryRes = await fetch(
    `${supabaseUrl}/rest/v1/ops_inventory?select=*${filter}&order=created_at.desc&limit=50`,
    { headers: readHeaders }
  );
  const items = await safeJson(inventoryRes, []);

  return {
    items,
    totalItems: items.length,
    available: items.filter(i => !i.is_consumed).length
  };
}

/**
 * Consume an inventory item (mark as used).
 */
async function consumeItem(body, supabaseUrl, supabaseKey, supabaseHeaders) {
  const { item_id, consumed_by, reason } = body;

  if (!item_id) {
    return { success: false, error: "item_id required" };
  }

  const readHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  // Verify item exists and isn't already consumed
  const itemRes = await fetch(
    `${supabaseUrl}/rest/v1/ops_inventory?id=eq.${item_id}&select=*`,
    { headers: readHeaders }
  );
  const items = await safeJson(itemRes, []);

  if (items.length === 0) {
    return { success: false, error: "Item not found" };
  }

  if (items[0].is_consumed) {
    return { success: false, error: "Item already consumed" };
  }

  // Mark as consumed
  await fetch(
    `${supabaseUrl}/rest/v1/ops_inventory?id=eq.${item_id}`,
    {
      method: "PATCH",
      headers: supabaseHeaders,
      body: JSON.stringify({
        is_consumed: true,
        consumed_by: consumed_by || 'unknown',
        consumed_at: new Date().toISOString()
      })
    }
  );

  console.log(`[5th-floor-ops] Item consumed: ${items[0].item_name} by ${consumed_by || 'unknown'}`);

  // Post to ops_messages
  const consumeMsg = `[ITEM USED] ${items[0].item_name} consumed${consumed_by ? ` by ${consumed_by}` : ''}${reason ? ` — ${reason}` : ''}`;
  await postOpsMessage(consumeMsg, consumed_by || 'system', supabaseUrl, supabaseHeaders);

  // Discord notification
  await postToDiscordOps({
    author: { name: `📦 Item Consumed: ${items[0].item_name}` },
    description: `**Used by:** ${consumed_by || 'Unknown'}\n${reason ? `**Reason:** ${reason}` : ''}`,
    color: 0x607D8B,
    footer: { text: `5th Floor Inventory | ${getOpsTimestamp()}` }
  });

  return { success: true, item: items[0] };
}

// ============================================
// OPS STATS
// ============================================

/**
 * Get aggregated ops statistics.
 */
async function getOpsStats(supabaseUrl, supabaseKey) {
  const readHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  // Fetch all resolved/expired tasks
  const tasksRes = await fetch(
    `${supabaseUrl}/rest/v1/ops_tasks?status=in.(resolved,failed,expired)&order=resolved_at.desc&limit=200`,
    { headers: readHeaders }
  );
  const resolvedTasks = await safeJson(tasksRes, []);

  // Fetch active tasks
  const activeRes = await fetch(
    `${supabaseUrl}/rest/v1/ops_tasks?status=in.(pending,in_progress)&select=*`,
    { headers: readHeaders }
  );
  const activeTasks = await safeJson(activeRes, []);

  // Calculate stats
  const totalTasks = resolvedTasks.length;
  const successCount = resolvedTasks.filter(t => t.resolution_type === 'success').length;
  const successRate = totalTasks > 0 ? (successCount / totalTasks * 100).toFixed(1) : '0.0';

  // Tasks by type
  const tasksByType = { security: 0, infrastructure: 0, crafting: 0 };
  resolvedTasks.forEach(t => {
    if (tasksByType[t.task_type] !== undefined) tasksByType[t.task_type]++;
  });

  // Tasks by severity
  const tasksBySeverity = { minor: 0, medium: 0, major: 0 };
  resolvedTasks.forEach(t => {
    if (tasksBySeverity[t.severity] !== undefined) tasksBySeverity[t.severity]++;
  });

  // Character stats
  const charMap = {};
  resolvedTasks.forEach(t => {
    const chars = t.assigned_characters || [];
    chars.forEach(c => {
      if (!charMap[c]) {
        charMap[c] = { name: c, tasksCompleted: 0, successes: 0, totalSeverityWeight: 0 };
      }
      charMap[c].tasksCompleted++;
      if (t.resolution_type === 'success') charMap[c].successes++;
      const weight = t.severity === 'major' ? 3 : t.severity === 'medium' ? 2 : 1;
      charMap[c].totalSeverityWeight += weight;
    });
  });

  const characterStats = Object.values(charMap)
    .map(c => ({
      ...c,
      successRate: c.tasksCompleted > 0 ? (c.successes / c.tasksCompleted * 100).toFixed(1) : '0.0',
      isVeteran: c.successes >= 10
    }))
    .sort((a, b) => b.tasksCompleted - a.tasksCompleted);

  // Today's tasks
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tasksToday = resolvedTasks.filter(t => new Date(t.resolved_at) >= todayStart).length;

  return {
    totalTasks,
    successRate: parseFloat(successRate),
    tasksToday,
    activeTasks: activeTasks.length,
    tasksByType,
    tasksBySeverity,
    characterStats,
    recentHistory: resolvedTasks.slice(0, 20)
  };
}

// ============================================
// HUMAN PRESENCE ON THE 5TH FLOOR
// ============================================

async function setHumanPresence(body, supabaseUrl, supabaseKey, supabaseHeaders) {
  const { username, present } = body;
  if (!username) return { success: false, error: "username required" };

  const now = new Date().toISOString();
  const userKey = `fifth_floor_human_${username}`;

  if (present) {
    const value = JSON.stringify({ username, arrived_at: now, last_ping: now });

    // Upsert per-user presence key
    await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
      method: "POST",
      headers: { ...supabaseHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: userKey, value, updated_at: now })
    });

    await postOpsMessage(`[ARRIVAL] ${username} has descended to the 5th Floor.`, 'system', supabaseUrl, supabaseHeaders);

    await postToDiscordOps({
      author: { name: `👁️ ${username} — On the 5th Floor` },
      description: `**${username}** has descended to supervise operations.`,
      color: 0x3498DB,
      footer: { text: `5th Floor | ${getOpsTimestamp()}` }
    });
  } else {
    // Clear this user's presence key
    await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${userKey}`, {
      method: "PATCH",
      headers: supabaseHeaders,
      body: JSON.stringify({ value: JSON.stringify(null), updated_at: now })
    });

    await postOpsMessage(`[DEPARTURE] ${username} has returned to the Lobby.`, 'system', supabaseUrl, supabaseHeaders);

    await postToDiscordOps({
      author: { name: `👁️ ${username} — Returned to Lobby` },
      description: `**${username}** has left the 5th Floor.`,
      color: 0x607D8B,
      footer: { text: `5th Floor | ${getOpsTimestamp()}` }
    });
  }

  return { success: true, present: !!present, username };
}

async function pingHumanPresence(body, supabaseUrl, supabaseKey, supabaseHeaders) {
  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const username = body?.username;
  if (!username) return { success: false, error: "username required for ping" };

  const userKey = `fifth_floor_human_${username}`;
  const now = new Date().toISOString();

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.${userKey}&select=value`,
      { headers: readHeaders }
    );
    const data = await safeJson(res, []);

    // If no presence record exists, create one silently (recover from cleared state)
    if (data.length === 0 || !data[0].value) {
      const value = JSON.stringify({ username, arrived_at: now, last_ping: now });
      await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
        method: "POST",
        headers: { ...supabaseHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: userKey, value, updated_at: now })
      });
      return { success: true, recreated: true };
    }

    const parsed = typeof data[0].value === 'string' ? JSON.parse(data[0].value) : data[0].value;
    if (!parsed) {
      // Value was null (user departed) — recreate
      const value = JSON.stringify({ username, arrived_at: now, last_ping: now });
      await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${userKey}`, {
        method: "PATCH",
        headers: supabaseHeaders,
        body: JSON.stringify({ value, updated_at: now })
      });
      return { success: true, recreated: true };
    }

    parsed.last_ping = now;

    await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.${userKey}`, {
      method: "PATCH",
      headers: supabaseHeaders,
      body: JSON.stringify({ value: JSON.stringify(parsed), updated_at: now })
    });

    return { success: true };
  } catch (e) {
    console.log("[5th-floor-ops] Ping presence failed:", e.message);
    return { success: false };
  }
}

// ============================================
// MANUAL CHARACTER ASSIGNMENT
// ============================================

async function assignTask(body, supabaseUrl, supabaseKey, supabaseHeaders, siteUrl) {
  const { task_id, characters, assigner } = body;

  if (!task_id) return { success: false, error: "task_id required" };
  if (!characters || !Array.isArray(characters) || characters.length === 0) {
    return { success: false, error: "characters array required" };
  }

  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const now = new Date();

  // 1. Fetch the task
  const taskRes = await fetch(
    `${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task_id}&select=*`,
    { headers: readHeaders }
  );
  const tasks = await safeJson(taskRes, []);
  if (tasks.length === 0) return { success: false, error: "Task not found" };

  const task = tasks[0];
  if (!['pending', 'paged'].includes(task.status)) {
    return { success: false, error: `Task is already ${task.status}` };
  }

  // 2. Validate each character
  const allStatesRes = await fetch(
    `${supabaseUrl}/rest/v1/character_state?select=*`,
    { headers: readHeaders }
  );
  const allStates = await safeJson(allStatesRes, []);

  // Check which characters are already on active (in_progress) tasks — 1 task per AI limit
  const charsOnActiveTasks = new Set();
  try {
    const activeTasksRes = await fetch(
      `${supabaseUrl}/rest/v1/ops_tasks?status=eq.in_progress&select=assigned_characters`,
      { headers: readHeaders }
    );
    const activeTasks = await safeJson(activeTasksRes, []);
    for (const t of activeTasks) {
      if (t.assigned_characters) {
        for (const c of t.assigned_characters) {
          charsOnActiveTasks.add(c);
        }
      }
    }
  } catch (err) {
    console.log("[5th-floor-ops] Could not fetch active task characters for assignment (non-fatal):", err.message);
  }

  const validatedChars = [];
  const rejectedChars = [];

  for (const charName of characters) {
    const state = allStates.find(s => s.character_name === charName);
    const opsMode = getOpsMode(charName);

    if (!opsMode || !opsMode.active) {
      rejectedChars.push({ name: charName, reason: "Ops mode inactive" });
      continue;
    }
    if (!state) {
      rejectedChars.push({ name: charName, reason: "State not found" });
      continue;
    }
    if ((state.energy || 0) < 30) {
      rejectedChars.push({ name: charName, reason: `Energy too low (${state.energy || 0})` });
      continue;
    }
    if (charsOnActiveTasks.has(charName) && task.severity !== 'major') {
      rejectedChars.push({ name: charName, reason: "Already on an active task" });
      continue;
    }
    if (state.current_focus === 'the_fifth_floor' && task.severity !== 'major') {
      rejectedChars.push({ name: charName, reason: "Already on 5th floor" });
      continue;
    }
    validatedChars.push(charName);
  }

  if (validatedChars.length === 0) {
    return { success: false, error: "No eligible characters", rejectedChars };
  }

  // 3. Update the task to in_progress
  await fetch(`${supabaseUrl}/rest/v1/ops_tasks?id=eq.${task_id}`, {
    method: "PATCH",
    headers: supabaseHeaders,
    body: JSON.stringify({
      status: 'in_progress',
      assigned_characters: validatedChars,
      paged_at: now.toISOString(),
      accepted_at: now.toISOString(),
      started_at: now.toISOString()
    })
  });

  // 4. Move each character to the 5th floor + departure emotes
  const assignerLabel = assigner || 'Admin';
  for (const charName of validatedChars) {
    const departureEmote = DEPARTURE_EMOTES[charName] || `*${charName} heads for the service elevator.*`;
    await postMainFloorMessage(charName, departureEmote, supabaseUrl, supabaseHeaders);
    await updateCharacterFocus(charName, 'the_fifth_floor', supabaseUrl, supabaseHeaders, siteUrl);
  }

  // 5. Ops log
  await postOpsMessage(
    `[ASSIGNED] ${assignerLabel} assigned ${validatedChars.join(', ')} to: ${task.title}`,
    assignerLabel,
    supabaseUrl,
    supabaseHeaders
  );

  // 6. Discord embeds
  for (const charName of validatedChars) {
    const flair = getDiscordFlair(charName);
    const departEmote = DEPARTURE_EMOTES[charName] || `*heads for the service elevator*`;
    await postToDiscordOps({
      author: {
        name: `📟 ${charName} — Assigned by ${assignerLabel}`,
        icon_url: flair.headshot || undefined
      },
      description: `**Task:** ${task.title}\n**Assigned by:** ${assignerLabel}\n\n${departEmote}`,
      color: flair.color || SEVERITY_COLORS[task.severity] || 0xFFC107,
      footer: { text: `${task.task_type} (${task.severity}) | ${getOpsTimestamp()}` }
    });
  }

  // 7. Bulletin
  try {
    await postBulletin(
      `5TH FLOOR: ${task.title} — ${validatedChars.join(', ')} assigned by ${assignerLabel}.`,
      supabaseUrl,
      supabaseHeaders
    );
  } catch (e) {}

  console.log(`[5th-floor-ops] assign_task: ${validatedChars.join(', ')} assigned to "${task.title}" by ${assignerLabel}`);

  return {
    success: true,
    task_id,
    assignedCharacters: validatedChars,
    rejectedCharacters: rejectedChars,
    assigner: assignerLabel
  };
}

async function getEligibleCharacters(taskId, supabaseUrl, supabaseKey) {
  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };

  // Fetch task severity if task_id provided
  let severity = 'minor';
  let taskType = null;
  if (taskId) {
    const taskRes = await fetch(
      `${supabaseUrl}/rest/v1/ops_tasks?id=eq.${taskId}&select=severity,task_type`,
      { headers: readHeaders }
    );
    const tasks = await safeJson(taskRes, []);
    if (tasks.length > 0) {
      severity = tasks[0].severity || 'minor';
      taskType = tasks[0].task_type || null;
    }
  }

  const allStatesRes = await fetch(
    `${supabaseUrl}/rest/v1/character_state?select=character_name,current_focus,energy,mood`,
    { headers: readHeaders }
  );
  const allStates = await safeJson(allStatesRes, []);

  // Check which characters are already on active (in_progress) tasks — 1 task per AI limit
  const charsOnActiveTasks = new Set();
  try {
    const activeTasksRes = await fetch(
      `${supabaseUrl}/rest/v1/ops_tasks?status=eq.in_progress&select=assigned_characters`,
      { headers: readHeaders }
    );
    const activeTasks = await safeJson(activeTasksRes, []);
    for (const t of activeTasks) {
      if (t.assigned_characters) {
        for (const c of t.assigned_characters) {
          charsOnActiveTasks.add(c);
        }
      }
    }
  } catch (err) {
    console.log("[5th-floor-ops] Could not fetch active tasks for eligibility (non-fatal):", err.message);
  }

  const eligible = [];
  const ineligible = [];

  for (const state of allStates) {
    const charName = state.character_name;
    const opsMode = getOpsMode(charName);

    if (!opsMode || !opsMode.active) {
      continue; // Skip non-ops characters silently
    }

    // Must be in the building (on the floor or break room) — off-duty characters can't be assigned
    const focus = state.current_focus;
    if (!focus || (focus !== 'the_floor' && focus !== 'break_room' && focus !== 'the_fifth_floor')) {
      ineligible.push({ name: charName, reason: 'Off duty / not in building', energy: state.energy || 0 });
      continue;
    }

    if ((state.energy || 0) < 30) {
      ineligible.push({ name: charName, reason: 'Low energy', energy: state.energy || 0 });
      continue;
    }
    if (charsOnActiveTasks.has(charName) && severity !== 'major') {
      ineligible.push({ name: charName, reason: 'Already on a task', energy: state.energy || 0 });
      continue;
    }
    if (state.current_focus === 'the_fifth_floor' && severity !== 'major') {
      ineligible.push({ name: charName, reason: 'On 5th floor', energy: state.energy || 0 });
      continue;
    }
    if (state.current_focus === 'break_room' && (state.energy || 0) < 40) {
      ineligible.push({ name: charName, reason: 'Resting', energy: state.energy || 0 });
      continue;
    }

    eligible.push({
      name: charName,
      energy: state.energy || 50,
      location: state.current_focus || 'unknown',
      mood: state.mood || 'neutral',
      specialties: opsMode.specialties || [],
      affinity: opsMode.affinity || 0,
      specialtyMatch: taskType && opsMode.specialties ? opsMode.specialties.includes(taskType) : false
    });
  }

  // Sort: specialty matches first, then by affinity descending
  eligible.sort((a, b) => {
    if (a.specialtyMatch !== b.specialtyMatch) return b.specialtyMatch ? 1 : -1;
    return b.affinity - a.affinity;
  });

  return { eligible, ineligible };
}

// ============================================
// OPS MANAGER FUNCTIONS
// ============================================

/**
 * Get the current Ops Manager from lobby_settings.
 * Returns { character_name, role, assigned_at, assigned_by } or null.
 */
async function getOpsManager(supabaseUrl, supabaseKey) {
  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.ops_manager&select=value`,
      { headers: readHeaders }
    );
    const data = await safeJson(res, []);
    if (data.length > 0 && data[0].value) {
      const parsed = typeof data[0].value === 'string' ? JSON.parse(data[0].value) : data[0].value;
      if (parsed && parsed.character_name) return parsed;
    }
  } catch (e) {
    console.log("[5th-floor-ops] Ops manager fetch failed (non-fatal):", e.message);
  }
  return null;
}

/**
 * Set or clear the Ops Manager.
 * body: { character_name, role: 'ai'|'human', assigned_by }
 * Pass character_name: null to clear.
 */
async function setOpsManager(body, supabaseUrl, supabaseKey, supabaseHeaders) {
  const { character_name, role, assigned_by } = body;
  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const now = new Date();

  const value = character_name ? JSON.stringify({
    character_name,
    role: role || 'ai',
    assigned_at: now.toISOString(),
    assigned_by: assigned_by || 'Admin'
  }) : null;

  // Check if key exists
  const existing = await fetch(
    `${supabaseUrl}/rest/v1/lobby_settings?key=eq.ops_manager&select=id`,
    { headers: readHeaders }
  );
  const existingData = await safeJson(existing, []);

  if (existingData.length > 0) {
    await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.ops_manager`, {
      method: "PATCH",
      headers: supabaseHeaders,
      body: JSON.stringify({ value, updated_at: now.toISOString() })
    });
  } else if (value) {
    await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
      method: "POST",
      headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({ key: 'ops_manager', value, created_at: now.toISOString(), updated_at: now.toISOString() })
    });
  }

  // Post ops log + Discord
  if (character_name) {
    await postOpsMessage(`[OPS MANAGER] ${character_name} assigned as Ops Manager (${role || 'ai'}) by ${assigned_by || 'Admin'}.`, 'system', supabaseUrl, supabaseHeaders);

    const flair = getDiscordFlair(character_name);
    await postToDiscordOps({
      author: {
        name: `📋 New Ops Manager: ${character_name}`,
        icon_url: flair.headshot || undefined
      },
      description: `**Role:** ${role || 'ai'}\n**Assigned by:** ${assigned_by || 'Admin'}`,
      color: 0xFFC107,
      footer: { text: `Ops Manager Update | ${getOpsTimestamp()}` }
    });
  } else {
    await postOpsMessage('[OPS MANAGER] Ops Manager cleared. Reverting to auto-assign.', 'system', supabaseUrl, supabaseHeaders);
  }

  console.log(`[5th-floor-ops] Ops manager set to: ${character_name || 'none'} (${role || 'none'})`);
  return { success: true, opsManager: character_name ? { character_name, role: role || 'ai' } : null };
}

/**
 * Calculate a character's willingness to volunteer for a task.
 * Returns 0.0 to 1.0.
 */
function calculateVolunteerWillingness(charName, charState, task, opsCountToday) {
  const opsMode = getOpsMode(charName);
  if (!opsMode || !opsMode.active) return 0;

  const affinity = opsMode.affinity || 0.5;
  const energy = charState.energy || 50;
  const mood = charState.mood || 'neutral';
  const specialties = opsMode.specialties || [];
  const dailyOps = opsCountToday[charName] || 0;

  let willingness = affinity;

  // Specialty match bonus
  if (specialties.includes(task.task_type)) willingness += 0.15;

  // Energy factor
  if (energy >= 70) willingness += 0.10;
  else if (energy < 40) willingness -= 0.20;

  // Mood factor
  const moodModifiers = {
    'energetic': 0.15, 'focused': 0.10, 'content': 0.05, 'refreshed': 0.10,
    'neutral': 0, 'tired': -0.10, 'annoyed': -0.15,
    'exhausted': -0.25, 'stressed': -0.15
  };
  willingness += moodModifiers[mood] || 0;

  // Fatigue penalty
  willingness -= dailyOps * 0.10;

  // Severity eagerness — high-affinity characters step up for major tasks
  if (task.severity === 'major' && affinity >= 0.7) willingness += 0.10;

  // Random factor for organic variance
  willingness += (Math.random() * 0.20) - 0.10;

  return Math.max(0, Math.min(1.0, willingness));
}

/**
 * Post a chat message to the main floor (messages table) — NOT an emote.
 * Used for ops manager dialogue and volunteer responses visible to everyone.
 */
async function postFloorChatMessage(employee, content, supabaseUrl, supabaseHeaders) {
  try {
    await fetch(
      `${supabaseUrl}/rest/v1/messages`,
      {
        method: "POST",
        headers: { ...supabaseHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee,
          content,
          created_at: new Date().toISOString(),
          is_emote: false
        })
      }
    );
    console.log(`[5th-floor-ops] Posted floor chat for ${employee}`);
  } catch (err) {
    console.error(`[5th-floor-ops] Failed to post floor chat for ${employee}:`, err.message);
  }
}
