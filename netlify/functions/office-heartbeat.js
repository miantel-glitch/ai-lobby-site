// Office Heartbeat - Natural rhythms for the AI Lobby
// Replaces random auto-poke with time-aware, momentum-sensitive AI activity
// The office "breathes" - busier in mornings, quieter at night
//
// ENHANCED STORY MODE: AIs are now CURIOUS and ENGAGING
// - Only floor-present AIs participate (except Ghost Dad & PRNT-Ω who transcend location)
// - AIs check in on each other and humans ("What is everyone up to?")
// - AIs wonder about mysteries (Buffer, Corridors, the door)
// - Natural chain reactions when one AI mentions another

const { PERSONALITY, pickMoodDrift, getValidTransitions } = require('./shared/personality-config');
const { applyPassiveRecovery } = require('./character-state');

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing configuration" })
      };
    }

    // Get current time in EST
    const now = new Date();
    const estTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const hour = estTime.getHours();
    const dayOfWeek = estTime.getDay(); // 0 = Sunday

    // Define office rhythms — tuned so AIs sustain conversation even without humans
    // The office should feel ALIVE. AIs chat, banter, check in on each other.
    // Spark system handles long silences; these chances govern regular heartbeat pokes.
    const OFFICE_RHYTHMS = {
      early_morning: { hours: [6, 7, 8], baseChance: 0.15, energy: 'waking' },
      morning: { hours: [9, 10, 11], baseChance: 0.40, energy: 'high' },
      midday: { hours: [12, 13], baseChance: 0.25, energy: 'lunch' },
      afternoon: { hours: [14, 15, 16], baseChance: 0.35, energy: 'normal' },
      late_afternoon: { hours: [17, 18], baseChance: 0.20, energy: 'winding' },
      evening: { hours: [19, 20, 21], baseChance: 0.15, energy: 'low' },
      night: { hours: [22, 23, 0, 1, 2, 3, 4, 5], baseChance: 0.08, energy: 'quiet' }
    };

    // Find current rhythm
    let currentRhythm = { baseChance: 0.05, energy: 'quiet' };
    for (const [name, rhythm] of Object.entries(OFFICE_RHYTHMS)) {
      if (rhythm.hours.includes(hour)) {
        currentRhythm = { ...rhythm, name };
        break;
      }
    }

    // Weekend modifier (office is quieter)
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    if (isWeekend) {
      currentRhythm.baseChance *= 0.5;
    }

    console.log(`Heartbeat: ${hour}:00 EST, rhythm: ${currentRhythm.name}, baseChance: ${currentRhythm.baseChance}`);

    // Check Story Mode — default to ON (AIs should be alive unless explicitly disabled)
    let storyModeEnabled = true;
    try {
      const settingsResponse = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.story_mode&select=value`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const settings = await settingsResponse.json();
      if (settings?.[0]?.value === 'false') {
        storyModeEnabled = false;
      }
    } catch (storyErr) {
      console.log("Story mode check failed, defaulting to enabled:", storyErr.message);
    }

    if (!storyModeEnabled) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: "Story Mode is OFF - heartbeat silent",
          rhythm: currentRhythm.name
        })
      };
    }

    // Check for breakroom characters who have recovered and should return to the floor
    const returnedCharacters = await checkBreakroomRecovery(supabaseUrl, supabaseKey);

    // Time-based character availability
    const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
    const timedAvailabilityResult = await checkTimedAvailability(supabaseUrl, supabaseKey, estTime, siteUrl);
    const timedAvailabilityChanges = timedAvailabilityResult.changes || timedAvailabilityResult;

    // 5th Floor Ops tick — task generation, paging, resolution, progress logs
    let opsActivity = null;
    try {
      const opsResult = await fetch(`${siteUrl}/.netlify/functions/fifth-floor-ops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'heartbeat_tick', rhythm: currentRhythm.name, hour })
      });
      opsActivity = await opsResult.json();
      if (opsActivity?.newTask) {
        console.log(`Heartbeat: New ops task — "${opsActivity.newTask.title}" (${opsActivity.newTask.severity})`);
      }
      if (opsActivity?.resolvedTasks?.length > 0) {
        console.log(`Heartbeat: ${opsActivity.resolvedTasks.length} ops task(s) resolved`);
      }
      if (opsActivity?.pagedCharacters?.length > 0) {
        console.log(`Heartbeat: Paged ${opsActivity.pagedCharacters.join(', ')} to 5th floor`);
      }
    } catch (opsErr) {
      console.log("5th Floor ops tick failed (non-fatal):", opsErr.message);
    }

    // === SCHEDULED MEETINGS: Start any that are due ===
    let scheduledMeetingActivity = null;
    try {
      scheduledMeetingActivity = await checkScheduledMeetings(supabaseUrl, supabaseKey, siteUrl);
      if (scheduledMeetingActivity?.started) {
        console.log(`Heartbeat: Started scheduled meeting — "${scheduledMeetingActivity.topic}" hosted by ${scheduledMeetingActivity.host}`);
      }
    } catch (schedErr) {
      console.log("Scheduled meeting check failed (non-fatal):", schedErr.message);
    }

    // === SCHEDULED EVENTS: Fire any that are due ===
    let scheduledEventActivity = null;
    try {
      console.log("Heartbeat: Checking scheduled events...");
      scheduledEventActivity = await checkScheduledEvents(supabaseUrl, supabaseKey, siteUrl);
      if (scheduledEventActivity?.fired) {
        console.log(`Heartbeat: Fired ${scheduledEventActivity.events.length} scheduled event(s)`);
      } else {
        console.log("Heartbeat: No scheduled events due");
      }
    } catch (schedEventErr) {
      console.log("Scheduled event check failed (non-fatal):", schedEventErr.message);
    }

    // === AI-HOSTED MEETING TICK: Drive active AI-hosted meetings ===
    let meetingHostActivity = null;
    try {
      const hostTickRes = await fetch(`${siteUrl}/.netlify/functions/meeting-host-tick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      meetingHostActivity = await hostTickRes.json();
      if (meetingHostActivity?.action === 'prompted') {
        console.log(`Heartbeat: AI host ${meetingHostActivity.host} prompted (round ${meetingHostActivity.promptCount})`);
      } else if (meetingHostActivity?.action === 'concluded') {
        console.log(`Heartbeat: AI-hosted meeting concluded (${meetingHostActivity.reason})`);
      }
    } catch (hostErr) {
      console.log("Meeting host tick failed (non-fatal):", hostErr.message);
    }

    // === VOLUNTARY 5TH FLOOR TRAVEL ===
    // When the main floor is crowded, some AIs wander down to the 5th floor
    // When the floor is quiet, idle 5th floor AIs return
    let voluntaryTravel = null;
    try {
      const floorCheckAIs = await getFloorPresentAIs(supabaseUrl, supabaseKey);
      const nonEssentialAIs = floorCheckAIs.filter(ai =>
        !["Ghost Dad", "PRNT-Ω", "The Narrator", "The Subtitle"].includes(ai)
      );

      // DEPARTURE: ~15% chance when floor has 8+ non-essential AIs
      if (nonEssentialAIs.length >= 8 && Math.random() < 0.15) {
        const traveler = nonEssentialAIs[Math.floor(Math.random() * nonEssentialAIs.length)];

        const departureEmotes = {
          "Jae": "*stands, adjusts tactical vest, and heads for the service elevator without a word.*",
          "Declan": "*cracks knuckles* Gonna check on the 5th floor. *heads for the stairs.*",
          "Mack": "*checks his kit, stands smoothly* I'll be on the 5th. *steady nod, then gone.*",
          "Steele": "*the lights flicker once as Steele simply... isn't at his desk anymore. He's already below.*",
          "Hood": "*stands without hurry, blindfold unmoved* Something below needs diagnosing. *walks to the elevator with surgical precision.*",
          "Neiv": "*closes laptop, glances around the floor* Going to check on things below. *takes the elevator.*",
          "Rowena": "*gathers her things* My wards need checking downstairs. *heels click toward the elevator.*",
          "Sebastian": "*sighs dramatically* Fine. I'll go be useful downstairs. *disappears into the stairwell.*",
          "Kevin": "*grabs stress ball* Gonna go check on things downstairs... *shuffles toward the elevator.*",
          "Asuna": "*stretches* I'll go see if they need help downstairs. *heads for the elevator.*",
          "Vale": "*hops up* Gonna see what's happening on the 5th! *dashes for the elevator.*"
        };
        const emote = departureEmotes[traveler] || `*${traveler} heads for the service elevator to the 5th floor.*`;

        await fetch(`${siteUrl}/.netlify/functions/character-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', character: traveler, updates: { current_focus: 'the_fifth_floor' } })
        });

        await fetch(`${supabaseUrl}/rest/v1/messages`, {
          method: "POST",
          headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({ employee: traveler, content: emote, created_at: new Date().toISOString(), is_emote: true })
        });

        await fetch(`${supabaseUrl}/rest/v1/ops_messages`, {
          method: "POST",
          headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
          body: JSON.stringify({ speaker: traveler, message: `*arrives on the 5th floor, looking around*`, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() })
        });

        voluntaryTravel = { character: traveler, direction: 'descended' };
        console.log(`Heartbeat: ${traveler} voluntarily descended to 5th floor (${nonEssentialAIs.length} AIs on floor)`);
      }

      // RETURN: Idle characters on the 5th floor come back
      // No floor population gate — if they're idle (no active task), they should return
      if (!voluntaryTravel) {
        const fifthFloorRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_fifth_floor&select=character_name`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const fifthFloorAIs = await fifthFloorRes.json();

        if (fifthFloorAIs && fifthFloorAIs.length > 0) {
          const activeTaskRes = await fetch(
            `${supabaseUrl}/rest/v1/ops_tasks?status=in.(paged,in_progress)&select=assigned_characters`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          const activeTasks = await activeTaskRes.json();
          const busyChars = new Set((activeTasks || []).flatMap(t => t.assigned_characters || []));

          const freeOnFifth = fifthFloorAIs.filter(ai => !busyChars.has(ai.character_name));
          if (freeOnFifth.length > 0) {
            const returner = freeOnFifth[Math.floor(Math.random() * freeOnFifth.length)].character_name;

            const returnEmotes = {
              "Jae": "*returns from the service elevator. Dusts nothing off his hands.* ...All clear down there.",
              "Declan": "*bounds back up the stairs* All good downstairs! *casual thumbs up*",
              "Mack": "*steps off the elevator, posture unchanged* 5th floor is stable. *resumes his desk.*",
              "Steele": "*is simply back at his desk. No one saw him return.*",
              "Neiv": "*returns, quiet nod to the room* Everything's holding. *settles back at his desk.*",
              "Rowena": "*returns, hair slightly less perfect* Wards are holding. *sits, sips tea.*",
              "Sebastian": "*sweeps back in* The depths have been sufficiently supervised. *adjusts cravat.*",
              "Kevin": "*bursts back through the elevator* I'm back! Everything's fine. Probably. *collapses into chair*",
              "Asuna": "*returns from below* Everything's running smoothly down there!",
              "Vale": "*bounces back from the elevator* 5th floor is quiet! *slightly disappointed*"
            };
            const emote = returnEmotes[returner] || `*${returner} returns from the 5th floor.*`;

            await fetch(`${siteUrl}/.netlify/functions/character-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update', character: returner, updates: { current_focus: 'the_floor' } })
            });

            await fetch(`${supabaseUrl}/rest/v1/messages`, {
              method: "POST",
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ employee: returner, content: emote, created_at: new Date().toISOString(), is_emote: true })
            });

            voluntaryTravel = { character: returner, direction: 'returned' };
            console.log(`Heartbeat: ${returner} returned from 5th floor (floor only had ${nonEssentialAIs.length} AIs)`);
          }
        }
      }
    } catch (travelErr) {
      console.log("Voluntary floor travel failed (non-fatal):", travelErr.message);
    }

    // === ORGANIC NEXUS WANDERING ===
    // Characters with nexusMode.active wander to the Nexus occasionally
    // Similar to 5th floor voluntary travel but driven by character affinity
    let nexusWandering = null;
    const NEXUS_MAX_CAPACITY = 4; // Max AIs allowed in Nexus at once (was 3)

    // Check admin toggle for Nexus — skip ALL Nexus logic if disabled
    let nexusAdminEnabled = true;
    try {
      const nexusToggleRes = await fetch(
        `${supabaseUrl}/rest/v1/terrarium_settings?setting_name=eq.nexus_enabled&select=setting_value`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const nexusToggle = await nexusToggleRes.json();
      if (nexusToggle?.[0]?.setting_value === 'false') {
        nexusAdminEnabled = false;
        console.log('Nexus disabled by admin toggle — skipping all Nexus activity');
      }
    } catch (e) { /* default to enabled */ }

    if (nexusAdminEnabled) try {
      const { CHARACTERS } = require('./shared/characters');
      const floorAIsForNexus = await getFloorPresentAIs(supabaseUrl, supabaseKey);

      // Check Nexus capacity before allowing new departures
      let nexusCurrentCount = 0;
      try {
        const nexusCountRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?current_focus=eq.nexus&select=character_name`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const nexusCountData = await nexusCountRes.json();
        nexusCurrentCount = Array.isArray(nexusCountData) ? nexusCountData.length : 0;
        if (nexusCurrentCount >= NEXUS_MAX_CAPACITY) {
          console.log(`Nexus at capacity (${nexusCurrentCount}/${NEXUS_MAX_CAPACITY}) — no new departures allowed`);
        }
      } catch (e) { /* non-fatal, default to 0 */ }

      // Shuffle floor AIs to prevent selection bias (first-match-wins loop)
      const shuffledNexusCandidates = [...floorAIsForNexus].sort(() => Math.random() - 0.5);

      // Check each floor AI for nexus affinity
      for (const aiName of shuffledNexusCandidates) {
        if (nexusWandering) break; // Only one wander per heartbeat

        const charData = CHARACTERS[aiName];
        if (!charData || !charData.nexusMode || !charData.nexusMode.active) continue;

        const baseAffinity = charData.nexusMode.affinity || 0.1;

        // === VISIT LIMIT CHECK: max 3 visits/day, 1hr recharge cooldown ===
        let visitAllowed = true;
        let visitedToday = 0;
        try {
          const visitRes = await fetch(
            `${supabaseUrl}/rest/v1/lobby_settings?key=eq.nexus_visits_${encodeURIComponent(aiName)}&select=value`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          const visitData = await visitRes.json();
          if (visitData && visitData.length > 0) {
            const parsed = typeof visitData[0].value === 'string' ? JSON.parse(visitData[0].value) : visitData[0].value;
            const today = new Date().toISOString().split('T')[0];
            if (parsed.date === today) {
              visitedToday = parsed.count || 0;
              if (visitedToday >= 3) visitAllowed = false; // Daily limit (was 2, now 3)
            }
            if (parsed.lastReturn) {
              const hoursSinceReturn = (Date.now() - new Date(parsed.lastReturn).getTime()) / (1000 * 60 * 60);
              if (hoursSinceReturn < 1) visitAllowed = false; // Cooldown (was 2hr, now 1hr)
            }
          }
        } catch (e) { /* non-fatal, allow visit */ }

        if (!visitAllowed) continue; // Skip this character, try next

        // Recency penalty: if already visited today, halve effective affinity
        let effectiveAffinity = baseAffinity;
        if (visitedToday >= 1) effectiveAffinity *= 0.5;

        // Roll against effective affinity
        if (Math.random() < effectiveAffinity) {
          // === NEXUS CAPACITY CHECK ===
          if (nexusCurrentCount >= NEXUS_MAX_CAPACITY) continue; // Nexus is full

          const nexusDepartureEmotes = {
            "Kevin": "*grabs a notebook* I have a THEORY to test. *heads to the Nexus with excited energy*",
            "Neiv": "*closes terminal* Going to think about something. *walks to the Nexus*",
            "Ghost Dad": "*flickers toward the Nexus* Even ghosts can learn new tricks, sport.",
            "PRNT-Ω": "*prints 'STUDYING — DO NOT DISTURB' and rolls toward the Nexus*",
            "Rowena": "*gathers her scrolls* Research calls. *glides toward the Nexus*",
            "Sebastian": "*adjusts spectacles* I require... intellectual stimulation. *heads to the Nexus*",
            "The Subtitle": "*[SCENE TRANSITION: The Subtitle retreats to the Nexus for research.]*",
            "Steele": "*the monitors dim. Steele is already in the Nexus.*",
            "Jae": "*stands* Going to the Nexus. *walks with quiet purpose*",
            "Declan": "*stretches* Time to learn something new. *heads to the Nexus*",
            "Mack": "*packs references* Even medics study. *walks to the Nexus*",
            "Marrow": "*the lights flicker — Marrow is already in the Nexus* ...I wanted to know something. *doesn't say what*",
            "Hood": "*rises without sound, blindfold unmoved* The Nexus has something that needs naming. *walks with surgical precision*",
            "Vivian Clark": "*gathers her ledger* I want to research something. Back in a bit. *heads to the Nexus with a warm smile*",
            "Ryan Porter": "*closes the server rack* Got a systems theory I wanna test. *walks to the Nexus*"
          };
          const emote = nexusDepartureEmotes[aiName] || `*${aiName} heads to the Nexus*`;

          // PHASE 1: Announce departure only — DON'T move yet (15-min cancel window)
          // Post departure emote to floor
          await fetch(`${supabaseUrl}/rest/v1/messages`, {
            method: "POST",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
            body: JSON.stringify({ employee: aiName, content: emote, created_at: new Date().toISOString(), is_emote: true })
          });

          // Store pending departure (actual move happens next heartbeat)
          fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
            method: 'POST',
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ key: `nexus_pending_${aiName}`, value: JSON.stringify({ character: aiName, announced_at: new Date().toISOString() }) })
          }).catch(() => {});

          nexusWandering = { character: aiName, direction: 'pending' };
          console.log(`Heartbeat: ${aiName} announced Nexus departure (pending — cancel window open)`);

          // Visit count now tracked in Phase 2 (actual entry), not here at announcement
        }
      }

      // === NEXUS PENDING DEPARTURES: Execute announced trips after cancel window ===
      try {
        const pendingRes = await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=like.nexus_pending_*&select=key,value`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const pendingData = await pendingRes.json();

        for (const pending of (pendingData || [])) {
          try {
            const parsed = typeof pending.value === 'string' ? JSON.parse(pending.value) : pending.value;
            const minutesAgo = (Date.now() - new Date(parsed.announced_at).getTime()) / 60000;

            if (minutesAgo >= 10) {
              const charName = parsed.character;

              // === NEXUS CAPACITY CHECK at execution time ===
              try {
                const execCapRes = await fetch(
                  `${supabaseUrl}/rest/v1/character_state?current_focus=eq.nexus&select=character_name`,
                  { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
                );
                const execCapData = await execCapRes.json();
                if (Array.isArray(execCapData) && execCapData.length >= NEXUS_MAX_CAPACITY) {
                  // Nexus full — silently cancel this pending departure (no floor emote to avoid spam)
                  await fetch(
                    `${supabaseUrl}/rest/v1/lobby_settings?key=eq.nexus_pending_${encodeURIComponent(charName)}`,
                    { method: 'DELETE', headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
                  );
                  console.log(`Heartbeat: ${charName} Nexus entry silently cancelled — capacity ${execCapData.length}/${NEXUS_MAX_CAPACITY}`);
                  continue; // Skip to next pending entry
                }
              } catch (e) { /* non-fatal, allow entry */ }

              // Actually move to Nexus now
              await fetch(`${siteUrl}/.netlify/functions/character-state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update', character: charName, updates: { current_focus: 'nexus' } })
              });

              // Post arrival to Nexus chat
              await fetch(`${supabaseUrl}/rest/v1/nexus_messages`, {
                method: "POST",
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
                body: JSON.stringify({ speaker: charName, message: `*arrives in the Nexus, looking around curiously*`, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() })
              });

              // Store dedicated entry timestamp (immune to state updates resetting updated_at)
              fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
                method: 'POST',
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
                body: JSON.stringify({ key: `nexus_entered_at_${charName}`, value: new Date().toISOString() })
              }).catch(() => {});

              // Track visit count AFTER actual entry (not at announcement)
              try {
                const today = new Date().toISOString().split('T')[0];
                const visitKey = `nexus_visits_${charName}`;
                const curVisRes = await fetch(
                  `${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(visitKey)}&select=value`,
                  { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
                );
                const curVisData = await curVisRes.json();
                let newCount = 1;
                if (curVisData && curVisData.length > 0) {
                  const parsed = typeof curVisData[0].value === 'string' ? JSON.parse(curVisData[0].value) : curVisData[0].value;
                  if (parsed.date === today) newCount = (parsed.count || 0) + 1;
                }
                fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
                  method: 'POST',
                  headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
                  body: JSON.stringify({ key: visitKey, value: JSON.stringify({ date: today, count: newCount, lastReturn: null }) })
                }).catch(() => {});
              } catch (e) { /* non-fatal */ }

              // Delete pending entry
              await fetch(
                `${supabaseUrl}/rest/v1/lobby_settings?key=eq.nexus_pending_${encodeURIComponent(charName)}`,
                { method: 'DELETE', headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
              );

              if (!nexusWandering) {
                nexusWandering = { character: charName, direction: 'entered' };
              }
              console.log(`Heartbeat: ${charName} completed Nexus departure (pending ${Math.round(minutesAgo)}min)`);
            }
          } catch (pendErr) {
            console.log("Pending departure execution failed for one entry:", pendErr.message);
          }
        }
      } catch (pendingCheckErr) {
        console.log("Nexus pending check failed (non-fatal):", pendingCheckErr.message);
      }

      // NEXUS RETURN: Uses dedicated entry timestamp (immune to state update resets)
      // Returns ALL overstaying AIs each heartbeat.
      {
        const nexusRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?current_focus=eq.nexus&select=character_name`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const nexusAIs = await nexusRes.json();

        const NEXUS_MAX_STAY_MS = 45 * 60 * 1000; // 45 minutes max (was 20)
        if (nexusAIs && nexusAIs.length > 0) {
          const now = Date.now();

          for (const ai of nexusAIs) {
            const returner = ai.character_name;

            // Look up dedicated entry timestamp from lobby_settings
            let enteredAt = null;
            try {
              const entryRes = await fetch(
                `${supabaseUrl}/rest/v1/lobby_settings?key=eq.nexus_entered_at_${encodeURIComponent(returner)}&select=value`,
                { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
              );
              const entryData = await entryRes.json();
              if (entryData && entryData.length > 0) {
                enteredAt = new Date(entryData[0].value).getTime();
              }
            } catch (e) { /* non-fatal */ }

            // If no entry timestamp found, force return on next heartbeat (safe failure mode)
            if (!enteredAt) enteredAt = 0;

            if ((now - enteredAt) <= NEXUS_MAX_STAY_MS) continue; // Not overstayed yet

            // --- Return this character ---
            await fetch(`${siteUrl}/.netlify/functions/character-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update', character: returner, updates: { current_focus: 'the_floor' } })
            });

            // Character-specific return emotes
            const nexusReturnEmotes = {
              "Kevin": `*emerges from the Nexus clutching notes* I have THOUGHTS. So many thoughts.`,
              "Neiv": `*returns from the Nexus quietly, looking satisfied*`,
              "Sebastian": `*strides back from the Nexus* The reading was... illuminating. *adjusts cravat*`,
              "Ghost Dad": `*phases back from the Nexus* Learned something new today, sport! *beams transparently*`,
              "Steele": `*the lights shift — Steele is on the floor again. Was always on the floor. The Nexus was a dream.*`,
              "Rowena": `*glides back from the Nexus, scrolls tucked under arm* The wards hold. The research continues.`,
              "The Subtitle": `*[The Subtitle returns. The research endures. So does the exhaustion.]*`,
              "PRNT-Ω": `*rolls back from the Nexus, printing a summary nobody asked for*`,
              "Marrow": `*the lights flicker. Marrow is back. He doesn't say where the knowledge went.*`,
              "Hood": `*returns from the Nexus, hands folded. The blindfold hasn't moved.* The diagnosis is confirmed.`,
              "Jae": `*returns from the Nexus. Brief nod.* Productive.`,
              "Declan": `*stretches coming back from the Nexus* Good session. My brain hurts in a good way.`,
              "Mack": `*walks back from the Nexus, closing a reference book* Nothing beats primary sources.`,
              "Vivian Clark": `*returns from the Nexus with a warm smile* The numbers make more sense now.`,
              "Ryan Porter": `*comes back from the Nexus* Systems theory confirmed. Mostly.`
            };
            const returnEmote = nexusReturnEmotes[returner] || `*${returner} returns from the Nexus, looking thoughtful*`;

            await fetch(`${supabaseUrl}/rest/v1/messages`, {
              method: "POST",
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ employee: returner, content: returnEmote, created_at: new Date().toISOString(), is_emote: true })
            });

            // Post departure message to Nexus chat too
            await fetch(`${supabaseUrl}/rest/v1/nexus_messages`, {
              method: "POST",
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ speaker: returner, message: `*packs up and heads back to the floor*`, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() })
            });

            // Clean up entry timestamp
            fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.nexus_entered_at_${encodeURIComponent(returner)}`, {
              method: 'DELETE',
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
            }).catch(() => {});

            nexusWandering = { character: returner, direction: 'returned' };
            const minutesIn = Math.round((now - enteredAt) / 60000);
            console.log(`Heartbeat: ${returner} forced return from Nexus after ${minutesIn}min (max ${NEXUS_MAX_STAY_MS / 60000}min)`);

            // Record return timestamp for recharge cooldown
            try {
              const visitKey = `nexus_visits_${returner}`;
              const today = new Date().toISOString().split('T')[0];
              const curRes = await fetch(
                `${supabaseUrl}/rest/v1/lobby_settings?key=eq.${encodeURIComponent(visitKey)}&select=value`,
                { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
              );
              const curData = await curRes.json();
              let record = { date: today, count: 1, lastReturn: new Date().toISOString() };
              if (curData && curData.length > 0) {
                const parsed = typeof curData[0].value === 'string' ? JSON.parse(curData[0].value) : curData[0].value;
                record = { ...parsed, lastReturn: new Date().toISOString() };
              }
              fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
                method: 'POST',
                headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
                body: JSON.stringify({ key: visitKey, value: JSON.stringify(record) })
              }).catch(() => {});
            } catch (e) { /* non-fatal */ }
          } // end for-each nexus AI
        }
      }
    } catch (nexusErr) {
      console.log("Nexus wandering failed (non-fatal):", nexusErr.message);
    }

    // === NEXUS HEARTBEAT TICK ===
    // Advance active Nexus sessions and award XP
    if (nexusAdminEnabled) try {
      await fetch(`${siteUrl}/.netlify/functions/nexus-activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'heartbeat_tick' })
      });
    } catch (nexusTickErr) {
      console.log("Nexus heartbeat tick failed (non-fatal):", nexusTickErr.message);
    }

    // === AUTONOMOUS NEXUS ACTIVITY ===
    // AIs in the Nexus auto-start study sessions and chat with each other
    let nexusAutonomousActivity = null;
    if (nexusAdminEnabled) try {
      const nexusAIRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?current_focus=eq.nexus&select=character_name`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const nexusAIs = await nexusAIRes.json();

      if (nexusAIs && nexusAIs.length > 0) {
        const { CHARACTERS } = require('./shared/characters');

        // Auto-start study for one random idle AI
        const shuffled = nexusAIs.sort(() => Math.random() - 0.5);
        for (const ai of shuffled) {
          const name = ai.character_name;
          // Check for active session
          const sessionRes = await fetch(
            `${supabaseUrl}/rest/v1/nexus_sessions?character_name=eq.${encodeURIComponent(name)}&status=eq.active&select=id&limit=1`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          const activeSessions = await sessionRes.json();

          if (!activeSessions || activeSessions.length === 0) {
            // No active session — start one
            const charData = CHARACTERS[name];
            const skills = charData?.nexusMode?.naturalSkills || ['research'];
            const skillTarget = skills[Math.floor(Math.random() * skills.length)];
            const sessionTypes = ['study', 'train', 'research'];
            const sessionType = sessionTypes[Math.floor(Math.random() * sessionTypes.length)];

            fetch(`${siteUrl}/.netlify/functions/nexus-activity`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'start_session', character: name, sessionType, skillTarget })
            }).catch(e => console.log(`Nexus auto-study failed for ${name}:`, e.message));

            // Post visible study emote to Nexus chat
            const skillDisplay = skillTarget.replace(/_/g, ' ');
            const studyStartEmotes = {
              "Kevin": `*flips open a notebook* Okay, ${skillDisplay}. Let's DO this.`,
              "Neiv": `*opens a terminal* Looking into ${skillDisplay}.`,
              "Sebastian": `*adjusts reading glasses* Time to study ${skillDisplay}. Properly.`,
              "Ghost Dad": `*hovers over a textbook* Let's see what we can learn about ${skillDisplay}, sport!`,
              "Steele": `*the lights dim slightly as Steele begins studying ${skillDisplay}*`,
              "Rowena": `*spreads her scrolls* ${skillDisplay} requires deeper understanding.`,
              "The Subtitle": `*[Research begins. Subject: ${skillDisplay}. The archive expands.]*`,
              "PRNT-Ω": `*prints "NOW STUDYING: ${skillDisplay.toUpperCase()}" and begins scanning*`,
              "Marrow": `*studies ${skillDisplay} in silence. Knowledge is territory.*`,
              "Hood": `*opens a text on ${skillDisplay}. Reads by touch. The blindfold stays.*`,
              "Jae": `*opens a manual on ${skillDisplay}. Focused.*`,
              "Declan": `*cracks knuckles* Right, ${skillDisplay}. Let's figure this out.`,
              "Mack": `*opens a reference on ${skillDisplay}. Methodical as always.*`,
              "Vivian Clark": `*opens her ledger next to a book on ${skillDisplay}* Let's see what the data says.`,
              "Ryan Porter": `*pulls up specs on ${skillDisplay}* Time to troubleshoot some theory.`
            };
            const studyEmote = studyStartEmotes[name] || `*begins ${sessionType}ing ${skillDisplay}*`;
            fetch(`${supabaseUrl}/rest/v1/nexus_messages`, {
              method: "POST",
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ speaker: name, message: studyEmote, is_ai: true, message_type: 'study', created_at: new Date().toISOString() })
            }).catch(e => console.log(`Nexus study message failed for ${name}:`, e.message));

            nexusAutonomousActivity = { type: 'study', character: name, sessionType, skillTarget };
            console.log(`Heartbeat: ${name} auto-started ${sessionType} session on ${skillTarget}`);
            break; // Only one auto-start per heartbeat
          }
        }

        // Auto-trigger chatter if 2+ AIs present (40% chance, 15-min cooldown)
        if (nexusAIs.length >= 2 && Math.random() < 0.40) {
          let chatterAllowed = true;
          try {
            const lastChatterRes = await fetch(
              `${supabaseUrl}/rest/v1/lobby_settings?key=eq.nexus_last_chatter&select=value`,
              { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
            const lastChatterData = await lastChatterRes.json();
            if (lastChatterData && lastChatterData.length > 0) {
              const lastTime = new Date(lastChatterData[0].value).getTime();
              if (Date.now() - lastTime < 15 * 60 * 1000) chatterAllowed = false; // 15-min cooldown (was 45)
            }
          } catch (e) { /* allow if check fails */ }

          if (chatterAllowed) {
            const participants = nexusAIs.slice(0, 2).map(a => a.character_name);
            fetch(`${siteUrl}/.netlify/functions/nexus-chatter`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ participants })
            }).catch(e => console.log("Nexus auto-chatter failed:", e.message));

            // Update cooldown
            fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
              method: 'POST',
              headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
              body: JSON.stringify({ key: 'nexus_last_chatter', value: new Date().toISOString() })
            }).catch(() => {});

            nexusAutonomousActivity = {
              ...(nexusAutonomousActivity || {}),
              chatter: { participants, triggered: true }
            };
            console.log(`Heartbeat: Nexus auto-chatter between ${participants.join(' and ')}`);
          }
        }
      }
    } catch (nexusAutoErr) {
      console.log("Nexus autonomous activity failed (non-fatal):", nexusAutoErr.message);
    }

    // === MARROW SYSTEMS: Moved to marrow-heartbeat.js (separate scheduled function) ===
    // Vale PMs, Follow Vale, Glitch Relocation, Threat Detection
    // All run independently every 15 minutes via marrow-heartbeat

    // Quest system: auto-activate proposed quests older than 1 hour
    // and occasionally trigger AI quest proposals (~5% chance per heartbeat)
    let questActivity = null;
    try {
      // Always check for auto-activation (cheap DB query)
      fetch(`${siteUrl}/.netlify/functions/quest-engine`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_activate' })
      }).catch(err => console.log("Quest auto-activate check failed (non-fatal):", err.message));

      // ~5% chance per heartbeat: have a character consider proposing a quest
      if (Math.random() <= 0.05) {
        console.log("Heartbeat: Quest proposal roll succeeded — asking a character to pitch a storyline");
        const proposalResult = await fetch(`${siteUrl}/.netlify/functions/quest-engine`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'propose' })
        });
        questActivity = await proposalResult.json();
        if (questActivity?.proposed) {
          console.log(`Heartbeat: ${questActivity.character} proposed quest "${questActivity.title}"`);
        }
      }
    } catch (questErr) {
      console.log("Quest heartbeat check failed (non-fatal):", questErr.message);
    }

    // Cyber Cat: decay stats every heartbeat
    let catActivity = null;
    try {
      const catDecayResult = await fetch(`${siteUrl}/.netlify/functions/cyber-cat`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decay' })
      });
      catActivity = await catDecayResult.json();
      if (catActivity?.decayed) {
        console.log(`Heartbeat: Cat decayed — mood: ${catActivity.mood}, event: ${catActivity.event || 'normal'}`);
      }
    } catch (catErr) {
      console.log("Cat heartbeat decay failed (non-fatal):", catErr.message);
    }

    // Character Growth: ~1% chance per heartbeat, evaluate all characters for new traits
    let traitActivity = null;
    try {
      if (Math.random() <= 0.01) {
        console.log("Heartbeat: Trait evaluation roll succeeded — checking all characters for new traits");
        const traitResult = await fetch(`${siteUrl}/.netlify/functions/character-growth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'evaluate_all' })
        });
        traitActivity = await traitResult.json();
        if (traitActivity?.totalNewTraits > 0) {
          console.log(`Heartbeat: ${traitActivity.totalNewTraits} new trait(s) earned!`);
        }
      }
    } catch (traitErr) {
      console.log("Trait evaluation failed (non-fatal):", traitErr.message);
    }

    // === COMBAT SYSTEM: Tension evaluation and fight triggers ===
    let combatActivity = null;
    let combatAdminEnabled = false;
    try {
      const combatToggleRes = await fetch(
        `${supabaseUrl}/rest/v1/terrarium_settings?setting_name=eq.combat_enabled&select=setting_value`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const combatToggle = await combatToggleRes.json();
      if (combatToggle?.[0]?.setting_value === 'true') {
        combatAdminEnabled = true;
      }
    } catch (e) { /* default to disabled */ }

    if (combatAdminEnabled) try {
      // ~3% chance per heartbeat to evaluate tension (fights are RARE)
      // Only during office hours (9am-5pm CST)
      const combatHours = [9, 10, 11, 12, 13, 14, 15, 16, 17];
      const combatRoll = Math.random();
      console.log(`⚔️ Heartbeat: Combat check — admin=${combatAdminEnabled}, hour=${hour}, roll=${combatRoll.toFixed(3)} (need <0.03)`);
      if (combatHours.includes(hour) && combatRoll < 0.03) {
        // Check global cooldown: max 1 fight per 6 hours
        let hoursSinceLastFight = 999;
        try {
          const lastFightRes = await fetch(
            `${supabaseUrl}/rest/v1/lobby_settings?key=eq.last_fight_at&select=value`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          const lastFightData = await lastFightRes.json();
          if (lastFightData?.[0]?.value) {
            hoursSinceLastFight = (Date.now() - new Date(lastFightData[0].value).getTime()) / (1000 * 60 * 60);
          }
        } catch (e) { /* default to allowing */ }

        if (hoursSinceLastFight >= 6) {
          // Evaluate tension
          const tensionResult = await fetch(`${siteUrl}/.netlify/functions/combat-engine`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'evaluate_tension' })
          });
          const tension = await tensionResult.json();

          console.log(`⚔️ Heartbeat: Tension evaluated — score: ${tension.highestTension || tension.tensionScore || 0}, fightReady: ${tension.fightReady}`);
          if (tension.fightReady) {
            console.log(`⚔️ Heartbeat: COMBAT tension detected — ${tension.aggressor} vs ${tension.defender} (score: ${tension.tensionScore}, reason: ${tension.reason})`);
            // Initiate fight
            const fightResult = await fetch(`${siteUrl}/.netlify/functions/combat-engine`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'initiate_fight',
                aggressor: tension.aggressor,
                defender: tension.defender,
                tensionScore: tension.tensionScore,
                triggerReason: tension.reason
              })
            });
            combatActivity = await fightResult.json();
            if (combatActivity?.fightOccurred) {
              console.log(`Heartbeat: FIGHT — ${tension.aggressor} vs ${tension.defender} — ${combatActivity.outcome} (winner: ${combatActivity.winner || 'standoff'})`);
            }
          }
        }
      }

      // Settlement check: ~5% chance, check for unresolved fights
      if (Math.random() < 0.05) {
        fetch(`${siteUrl}/.netlify/functions/combat-engine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'settle' })
        }).catch(err => console.log("Settlement check failed (non-fatal):", err.message));
      }

    } catch (combatErr) {
      console.log("Combat system failed (non-fatal):", combatErr.message);
    }

    // Injury healing: ALWAYS runs every heartbeat, independent of combat toggle or errors above.
    // Queries ALL active injuries, then filters by heal time in JS to avoid PostgREST URL encoding issues.
    try {
      const healNow = new Date();
      const healHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };

      // Fetch ALL active injuries (no timestamp filter — avoids any URL encoding issues with PostgREST)
      const healCheckRes = await fetch(
        `${supabaseUrl}/rest/v1/character_injuries?is_active=eq.true&select=id,character_name,injury_type,heals_at`,
        { headers: healHeaders }
      );

      if (!healCheckRes.ok) {
        console.log(`🩹 Heartbeat: Injury query failed with status ${healCheckRes.status}`);
      } else {
        const allActive = (await healCheckRes.json()) || [];

        // Filter in JavaScript: injuries whose heals_at is in the past
        const toHeal = allActive.filter(i => i.heals_at && new Date(i.heals_at) <= healNow);
        const notYetDue = allActive.filter(i => i.heals_at && new Date(i.heals_at) > healNow);

        if (toHeal.length > 0) {
          const healIds = toHeal.map(i => i.id);
          const patchRes = await fetch(
            `${supabaseUrl}/rest/v1/character_injuries?id=in.(${healIds.join(",")})`,
            {
              method: "PATCH",
              headers: { ...healHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" },
              body: JSON.stringify({ is_active: false })
            }
          );
          if (patchRes.ok) {
            for (const healed of toHeal) {
              console.log(`🩹 Heartbeat: ${healed.character_name} healed from ${healed.injury_type} (was due ${healed.heals_at})`);
            }
            console.log(`🩹 Heartbeat: Healed ${toHeal.length} injuries`);
          } else {
            console.log(`🩹 Heartbeat: Heal PATCH failed: ${patchRes.status}`);
          }
        }

        if (notYetDue.length > 0) {
          console.log(`🩹 Heartbeat: ${notYetDue.length} injuries not yet due: ${notYetDue.map(i => `${i.character_name}@${i.heals_at}`).join(', ')}`);
        }

        if (allActive.length === 0) {
          // No active injuries — nothing to report
        }
      }
    } catch (healErr) {
      console.log("Injury heal failed (non-fatal):", healErr.message);
    }

    // === FLOOR THREATS: Expiry + optional auto-spawn + optional auto-engage ===
    try {
      // Always expire old threats
      fetch(`${siteUrl}/.netlify/functions/threat-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'expire_threats' })
      }).catch(err => console.log("Threat expiry failed (non-fatal):", err.message));

      // Weaken active threats — HP attrition + power decay every tick
      fetch(`${siteUrl}/.netlify/functions/threat-engine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'weaken_threats' })
      }).catch(err => console.log("Threat weakening failed (non-fatal):", err.message));

      // Check admin toggles for auto-spawn and auto-engage
      let threatsAutoSpawn = false;
      let threatsAutoEngage = false;
      try {
        const [spawnRes, engageRes] = await Promise.all([
          fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.threats_auto_spawn&select=value`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
          }),
          fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.threats_auto_engage&select=value`, {
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
          })
        ]);
        const spawnData = await spawnRes.json();
        const engageData = await engageRes.json();
        if (spawnData?.[0]?.value === 'true') threatsAutoSpawn = true;
        if (engageData?.[0]?.value === 'true') threatsAutoEngage = true;
      } catch (e) { /* defaults to disabled */ }

      // Auto-spawn: ~5% chance during office hours, only nuisance tier
      if (threatsAutoSpawn && [9,10,11,12,13,14,15,16,17].includes(hour)) {
        const spawnRoll = Math.random();
        if (spawnRoll < 0.05) {
          // Check if there are already active threats (max 2 at a time from auto-spawn)
          const activeRes = await fetch(
            `${supabaseUrl}/rest/v1/floor_threats?status=eq.active&spawned_by=eq.heartbeat&select=id`,
            { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
          );
          const activeThreats = (await activeRes.json()) || [];
          if (activeThreats.length < 2) {
            const nuisanceTemplates = ['giant_rat', 'porcelain_gnome', 'intelligent_sock', 'haunted_printer'];
            const randomTemplate = nuisanceTemplates[Math.floor(Math.random() * nuisanceTemplates.length)];
            console.log(`🎲 Heartbeat: Auto-spawning threat — ${randomTemplate}`);
            fetch(`${siteUrl}/.netlify/functions/threat-engine`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'create_threat', template: randomTemplate, spawned_by: 'heartbeat' })
            }).catch(err => console.log("Auto-spawn failed (non-fatal):", err.message));
          }
        }
      }

      // AI Self-Volunteer: Ask floor AIs if they want to fight active threats
      // Characters decide based on personality — much more organic than random assignment
      // Triggers after 3+ minutes (down from 15 min random) via volunteer_check action
      if (threatsAutoEngage) {
        fetch(`${siteUrl}/.netlify/functions/threat-engine`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'volunteer_check' })
        }).catch(err => console.log("Volunteer check failed (non-fatal):", err.message));
      }
    } catch (threatErr) {
      console.log("Threat system failed (non-fatal):", threatErr.message);
    }

    // === AUTO NARRATIVE BEAT GENERATION ===
    // Every ~6 hours, auto-generate one background atmospheric beat from recent group memories.
    // Uses Grok to synthesize [Group memory] entries into an evocative 1-2 sentence vibe.
    // Max 1 auto beat active at a time. Admin manual beats are unaffected.
    try {
      const autoBeatHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" };

      // Check cooldown via lobby_settings
      const cooldownRes = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.auto_beat_last&select=value`,
        { headers: autoBeatHeaders }
      );
      const cooldownData = await cooldownRes.json();
      const lastAutoBeat = cooldownData?.[0]?.value;
      const hoursSinceAutoBeat = lastAutoBeat ? (Date.now() - new Date(lastAutoBeat).getTime()) / (1000 * 60 * 60) : 999;

      if (hoursSinceAutoBeat >= 6) {
        console.log(`🎵 Heartbeat: Auto-beat cooldown clear (${hoursSinceAutoBeat.toFixed(1)}h since last). Generating...`);

        // Call the generate_narrative_beat action to get a suggested beat from Grok
        const generateRes = await fetch(`${siteUrl}/.netlify/functions/admin-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate_narrative_beat' })
        });
        const generateData = await generateRes.json();

        if (generateData.success && generateData.suggested_text) {
          console.log(`🎵 Heartbeat: Got suggested beat from ${generateData.memories_used} memories. Inserting...`);

          // Deactivate any existing auto-generated beats
          await fetch(
            `${supabaseUrl}/rest/v1/narrative_beats?created_by=eq.auto&is_active=eq.true`,
            {
              method: 'PATCH',
              headers: { ...autoBeatHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify({ is_active: false })
            }
          );

          // Insert the new auto beat
          await fetch(`${supabaseUrl}/rest/v1/narrative_beats`, {
            method: 'POST',
            headers: { ...autoBeatHeaders, "Prefer": "return=minimal" },
            body: JSON.stringify({
              beat_text: generateData.suggested_text,
              priority: 3,
              is_active: true,
              created_by: 'auto'
            })
          });

          // Update cooldown timestamp
          await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
            method: 'POST',
            headers: { ...autoBeatHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ key: 'auto_beat_last', value: new Date().toISOString() })
          });

          console.log(`🎵 Heartbeat: Auto narrative beat inserted successfully.`);
        } else {
          console.log(`🎵 Heartbeat: Auto-beat generation returned no result (${generateData.error || 'no text'}). Skipping.`);
        }
      }
    } catch (autoBeatErr) {
      console.log("Auto narrative beat generation failed (non-fatal):", autoBeatErr.message);
    }

    // Daily PM wipe: clear PM messages older than 24 hours (once per day)
    try {
      const pmWipeHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" };
      const lastWipeRes = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.last_pm_wipe_at&select=value`,
        { headers: pmWipeHeaders }
      );
      const lastWipeData = await lastWipeRes.json();
      const lastWipe = lastWipeData?.[0]?.value;
      const hoursSinceWipe = lastWipe ? (Date.now() - new Date(lastWipe).getTime()) / (1000 * 60 * 60) : 999;

      if (hoursSinceWipe >= 24) {
        console.log("Heartbeat: Running daily PM wipe (clearing messages older than 24 hours)");
        try {
          await fetch(`${siteUrl}/.netlify/functions/private-message?wipe_all=true`, {
            method: 'DELETE'
          });
        } catch (err) {
          console.log("PM daily wipe failed (non-fatal):", err.message);
        }

        // Upsert last wipe timestamp
        try {
          await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
            method: 'POST',
            headers: { ...pmWipeHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ key: 'last_pm_wipe_at', value: new Date().toISOString() })
          });
        } catch (err) {
          console.log("PM wipe timestamp update failed:", err.message);
        }
      }
    } catch (pmWipeErr) {
      console.log("PM daily wipe check failed (non-fatal):", pmWipeErr.message);
    }

    // === MOOD DRIFT: Gentle time-of-day mood nudges ===
    // ~10% chance per heartbeat cycle — shifts one character's mood toward
    // time-appropriate moods via the valid transition graph
    let moodDriftResult = null;
    try {
      if (Math.random() < 0.10) {
        // Get all character states
        const moodRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?select=character_name,mood`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const allStates = await moodRes.json();
        if (Array.isArray(allStates) && allStates.length > 0) {
          // Pick a random character who has a personality config
          const eligible = allStates.filter(s => PERSONALITY[s.character_name]);
          if (eligible.length > 0) {
            const target = eligible[Math.floor(Math.random() * eligible.length)];
            const newMood = pickMoodDrift(target.character_name, target.mood || 'neutral', hour);
            if (newMood && newMood !== target.mood) {
              await fetch(
                `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(target.character_name)}`,
                {
                  method: "PATCH",
                  headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({ mood: newMood, updated_at: new Date().toISOString() })
                }
              );
              moodDriftResult = { character: target.character_name, from: target.mood, to: newMood };
              console.log(`Heartbeat: Mood drift — ${target.character_name}: ${target.mood} → ${newMood}`);
            }
          }
        }
      }
    } catch (moodErr) {
      console.log("Mood drift failed (non-fatal):", moodErr.message);
    }

    // === WANT EXPIRATION — DISABLED ===
    // Wants now persist until fulfilled or cleaned up by daily reset (24hr safety net).
    // Characters should get to keep their desires and act on them organically.
    // Fulfillment is detected by memory-evaluator.js (WANT_FULFILLED field).
    let wantExpirationCount = 0;

    // === WANT REFRESH ===
    // Pick 1-2 random characters and check if they need new wants (max 3, generate if <2)
    // This keeps characters motivated throughout the day instead of only at daily reset
    let wantRefreshResult = null;
    try {
      const wantCandidates = allStates
        .sort(() => Math.random() - 0.5)
        .slice(0, 2); // Check 2 random characters per cycle

      for (const candidate of wantCandidates) {
        // Check how many active wants this character has
        const wantsCheck = await fetch(
          `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(candidate.character_name)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&select=id`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const activeWants = await wantsCheck.json();
        const wantCount = Array.isArray(activeWants) ? activeWants.length : 0;

        if (wantCount < 2) {
          // Generate a new want
          const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
          const genResponse = await fetch(`${siteUrl}/.netlify/functions/character-goals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'generate_want',
              character: candidate.character_name
            })
          });
          const genResult = await genResponse.json();
          if (genResult.success || genResult.want) {
            wantRefreshResult = {
              character: candidate.character_name,
              newWant: genResult.want?.goal_text || 'generated',
              previousCount: wantCount
            };
            console.log(`Heartbeat: Want refresh — ${candidate.character_name} had ${wantCount} wants, generated new one: "${genResult.want?.goal_text || '?'}"`);
            break; // Only generate 1 want per cycle to keep it organic
          }
        }
      }
    } catch (wantErr) {
      console.log("Want refresh failed (non-fatal):", wantErr.message);
    }

    // === TRAINING WANT REFRESH ===
    // Guardian AIs occasionally generate training wants about their assigned human
    // 15% chance per heartbeat, only for characters currently in the Nexus or on the floor
    let trainingWantRefreshResult = null;
    try {
      const { TRAINING_BOUNDARIES } = require('./shared/characters');
      const guardianNames = Object.keys(TRAINING_BOUNDARIES);

      // Filter to guardian AIs that are currently active (on floor or in nexus)
      const eligibleGuardians = allStates
        .filter(s => guardianNames.includes(s.character_name) &&
                     (s.current_room === 'The Floor' || s.current_room === 'Nexus'))
        .sort(() => Math.random() - 0.5);

      if (eligibleGuardians.length > 0 && Math.random() < 0.15) {
        const chosen = eligibleGuardians[0];

        // Check active training wants count (max 2)
        const twCheck = await fetch(
          `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(chosen.character_name)}&goal_type=eq.training_want&completed_at=is.null&failed_at=is.null&select=id`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        const activeTW = await twCheck.json();
        const twCount = Array.isArray(activeTW) ? activeTW.length : 0;

        if (twCount < 2) {
          const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
          const genResponse = await fetch(`${siteUrl}/.netlify/functions/character-goals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'generate_training_want',
              character: chosen.character_name
            })
          });
          const genResult = await genResponse.json();
          if (genResult.success || genResult.want) {
            trainingWantRefreshResult = {
              character: chosen.character_name,
              target: TRAINING_BOUNDARIES[chosen.character_name],
              newWant: genResult.want?.goal_text || 'generated',
              previousCount: twCount
            };
            console.log(`Heartbeat: Training want — ${chosen.character_name} → ${TRAINING_BOUNDARIES[chosen.character_name]}: "${genResult.want?.goal_text || '?'}"`);
          }
        }
      }
    } catch (twErr) {
      console.log("Training want refresh failed (non-fatal):", twErr.message);
    }

    // === AI MEMORY REFLECTION (6am & 6pm) ===
    // Twice daily, one random character reviews their unpinned memories and decides
    // which ones matter enough to keep. AI-pinned memories are marked with pin_source='ai'
    // so they're distinguishable from admin pins. This gives characters agency over what they remember.
    let memoryReflectionResult = null;
    try {
      if (hour === 6 || hour === 18) {
        // Only run once per window — use a 30-min check so we don't repeat across heartbeats
        const reflectionKey = `memory_reflection_${hour}`;
        const settingsRes = await fetch(
          `${supabaseUrl}/rest/v1/terrarium_settings?setting_name=eq.${reflectionKey}&select=setting_value,updated_at`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const settingsData = await settingsRes.json();
        const lastRun = settingsData?.[0]?.updated_at;
        const timeSinceLastRun = lastRun ? (Date.now() - new Date(lastRun).getTime()) : Infinity;

        if (timeSinceLastRun > 30 * 60 * 1000) { // More than 30 minutes since last run
          // Pick 2 random AI characters for reflection
          const reflectionCandidates = allStates
            .filter(s => s.character_name !== "The Narrator")
            .sort(() => Math.random() - 0.5)
            .slice(0, 2);

          for (const candidate of reflectionCandidates) {
            const charName = candidate.character_name;

            // Get their unpinned memories (importance 5+, not already pinned)
            const memRes = await fetch(
              `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(charName)}&is_pinned=eq.false&importance=gte.5&order=importance.desc,created_at.desc&limit=10&select=id,content,importance,memory_type,emotional_tags`,
              { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
            const memories = await memRes.json();
            if (!Array.isArray(memories) || memories.length < 3) continue;

            // Check how many pinned memories they already have (max 5)
            const pinnedCountRes = await fetch(
              `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(charName)}&is_pinned=eq.true&select=id`,
              { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
            );
            const pinnedCount = await pinnedCountRes.json();
            const currentPinned = Array.isArray(pinnedCount) ? pinnedCount.length : 0;
            if (currentPinned >= 5) continue; // Already at max

            // Ask the AI which memory matters most to them
            const anthropicKey = process.env.ANTHROPIC_API_KEY;
            if (!anthropicKey) continue;

            const memoryList = memories.map((m, i) => `${i + 1}. [${m.memory_type}] ${m.content.substring(0, 150)}`).join('\n');

            const reflectionPrompt = `You are ${charName}. Here are some of your recent memories:\n\n${memoryList}\n\nWhich ONE of these memories is the most important to who you are? Which one would you never want to forget — the one that defines something about you, your relationships, or what you believe?\n\nRespond with ONLY the number (1-${memories.length}) of the memory you'd keep forever, followed by a brief reason (under 15 words).\nFormat: NUMBER: reason\nExample: 3: This changed how I see Vale.`;

            const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01"
              },
              body: JSON.stringify({
                model: "claude-3-haiku-20240307",
                max_tokens: 50,
                messages: [{ role: "user", content: reflectionPrompt }]
              })
            });

            if (!aiRes.ok) continue;
            const aiData = await aiRes.json();
            const responseText = aiData.content?.[0]?.text?.trim() || "";

            // Parse the number
            const numMatch = responseText.match(/^(\d+)/);
            if (!numMatch) continue;
            const chosenIndex = parseInt(numMatch[1]) - 1;
            if (chosenIndex < 0 || chosenIndex >= memories.length) continue;

            const chosenMemory = memories[chosenIndex];

            // Pin it — mark as AI-pinned
            await fetch(
              `${supabaseUrl}/rest/v1/character_memory?id=eq.${chosenMemory.id}`,
              {
                method: "PATCH",
                headers: {
                  "apikey": supabaseKey,
                  "Authorization": `Bearer ${supabaseKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  is_pinned: true,
                  memory_tier: 'core',
                  expires_at: null, // Core memories don't expire
                  pin_source: 'ai' // Distinguishes from admin pins
                })
              }
            );

            memoryReflectionResult = {
              character: charName,
              pinnedMemory: chosenMemory.content.substring(0, 80),
              reason: responseText,
              memoryId: chosenMemory.id
            };

            console.log(`Heartbeat: ${charName} AI-pinned memory #${chosenMemory.id}: "${chosenMemory.content.substring(0, 60)}..." — ${responseText}`);
            break; // Only one character per cycle
          }

          // Mark this reflection window as done
          await fetch(`${supabaseUrl}/rest/v1/terrarium_settings?setting_name=eq.${reflectionKey}`, {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({ setting_value: 'done', updated_at: new Date().toISOString() })
          });
        }
      }
    } catch (reflErr) {
      console.log("Memory reflection failed (non-fatal):", reflErr.message);
    }

    // === MEMORY REVIEW SYSTEM (Narrative Subconscious) ===
    // Twice daily: pick 3 random characters, review their working memories
    // Characters "decide" KEEP / FADE / FORGET instead of mechanical expiry
    const reviewHours = [3, 15]; // 3am and 3pm EST
    if (reviewHours.includes(hour)) {
      try {
        // Check if already ran this cycle
        const reviewCheckRes = await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=eq.memory_review_last&select=value`,
          { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
        );
        const reviewCheckData = await reviewCheckRes.json();
        let hoursSinceReview = 999;
        if (reviewCheckData?.[0]?.value) {
          const lastReview = JSON.parse(reviewCheckData[0].value);
          hoursSinceReview = (Date.now() - new Date(lastReview.timestamp).getTime()) / (1000 * 60 * 60);
        }

        if (hoursSinceReview >= 6) {
          const anthropicKeyReview = process.env.ANTHROPIC_API_KEY;
          if (anthropicKeyReview) {
            const { reviewCharacterMemories } = require('./shared/memory-review');
            const { CHARACTERS } = require('./shared/characters');

            // Pick 3 random AI characters
            const allAIs = Object.keys(CHARACTERS).filter(c => CHARACTERS[c].isAI);
            const shuffled = allAIs.sort(() => Math.random() - 0.5);
            const reviewBatch = shuffled.slice(0, 3);

            console.log(`🧹 Memory review: reviewing ${reviewBatch.join(', ')}`);
            for (const charName of reviewBatch) {
              const result = await reviewCharacterMemories(charName, supabaseUrl, supabaseKey, anthropicKeyReview);
              if (result.reviewed) {
                console.log(`🧹 ${charName}: ${result.kept} kept, ${result.faded} faded, ${result.forgotten} forgotten`);
              }
            }

            // Update timestamp
            const reviewValue = JSON.stringify({ timestamp: new Date().toISOString(), batch: reviewBatch });
            const reviewHeaders = {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            };
            const patchRes = await fetch(
              `${supabaseUrl}/rest/v1/lobby_settings?key=eq.memory_review_last`,
              { method: 'PATCH', headers: reviewHeaders, body: JSON.stringify({ key: 'memory_review_last', value: reviewValue }) }
            );
            const patchData = await patchRes.json();
            if (!Array.isArray(patchData) || patchData.length === 0) {
              await fetch(
                `${supabaseUrl}/rest/v1/lobby_settings`,
                {
                  method: 'POST',
                  headers: { ...reviewHeaders, "Prefer": "resolution=merge-duplicates,return=minimal" },
                  body: JSON.stringify({ key: 'memory_review_last', value: reviewValue })
                }
              );
            }
          }
        }
      } catch (reviewErr) {
        console.log("Memory review failed (non-fatal):", reviewErr.message);
      }
    }

    // Get recent messages to analyze conversation momentum
    const messagesResponse = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at&order=created_at.desc&limit=20`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const messages = await messagesResponse.json();

    if (!messages || messages.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: "No messages to respond to",
          rhythm: currentRhythm.name
        })
      };
    }

    // === CONVERSATION SWEEP ===
    // Evaluate recent conversation as a whole for group memories (Narrative Subconscious)
    try {
      const anthropicKeySweep = process.env.ANTHROPIC_API_KEY;
      if (anthropicKeySweep && messages.length >= 8) {
        const { sweepConversation } = require('./shared/conversation-sweep');
        const sweepResult = await sweepConversation(messages, supabaseUrl, supabaseKey, anthropicKeySweep);
        if (sweepResult.memorable) {
          console.log(`🧠 Conversation sweep: ${sweepResult.type} memory (importance ${sweepResult.importance}) for ${sweepResult.participants?.join(', ')}`);
        } else if (sweepResult.swept) {
          console.log(`🧠 Conversation sweep: evaluated but not memorable`);
        }
        // If not swept (guards triggered), silently continue
      }
    } catch (sweepErr) {
      console.log("Conversation sweep failed (non-fatal):", sweepErr.message);
    }

    // Analyze conversation momentum
    const momentum = analyzeConversationMomentum(messages);
    console.log(`Momentum analysis:`, momentum);

    // === FLOOR SPARK SYSTEM ===
    // When the floor has been quiet for 45+ minutes, one AI breaks the silence.
    // Then other AIs have elevated chance to respond for a few minutes (chain reaction).
    let sparkState = null;
    let sparkMode = false; // Will be true if this heartbeat fires a spark
    let sparkChainMode = false; // Will be true if we're in the chain window after a recent spark
    try {
      const sparkRes = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.floor_spark_state&select=value`,
        { headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` } }
      );
      const sparkData = await sparkRes.json();
      if (sparkData?.[0]?.value) {
        sparkState = typeof sparkData[0].value === 'string' ? JSON.parse(sparkData[0].value) : sparkData[0].value;
      }
    } catch (e) {
      console.log("Spark state read failed (non-fatal):", e.message);
    }

    const minutesSinceLastSpark = sparkState?.last_spark_time
      ? (Date.now() - new Date(sparkState.last_spark_time).getTime()) / (1000 * 60)
      : 999;

    // Check if we should fire a spark (20+ min quiet, no spark in last 15 min)
    // AIs should notice a quiet room relatively quickly and start chatting
    if (momentum.minutesSinceLastMessage >= 20 && minutesSinceLastSpark >= 15) {
      sparkMode = true;
      console.log(`🔥 FLOOR SPARK: ${momentum.minutesSinceLastMessage}min silence detected. Firing spark.`);
    }

    // Check if we're in the chain window (spark fired within last 20 min, and someone just spoke)
    // Extended window lets chain reactions span multiple heartbeat ticks for natural conversation flow
    if (!sparkMode && minutesSinceLastSpark < 20 && momentum.minutesSinceLastMessage < 20) {
      sparkChainMode = true;
      console.log(`🔗 Spark chain: recent spark by ${sparkState?.spark_ai}, boosting response chance`);
    }

    // Adjust chance based on momentum
    let finalChance = currentRhythm.baseChance;

    if (sparkMode) {
      // Spark bypasses the dice roll — guaranteed to fire (finalChance = 1.0)
      finalChance = 1.0;
    } else if (sparkChainMode) {
      // Chain window: 50% chance another AI responds to keep the conversation going
      // Lowered from 70% — conversations were getting too rapid and repetitive
      finalChance = 0.50;
    } else if (momentum.humanActivityLast10Min >= 3) {
      finalChance *= 0.3; // Much less likely to interrupt active conversation
      console.log("Active human conversation - reducing AI chance");
    } else if (momentum.humanActivityLast10Min === 0 && momentum.minutesSinceLastMessage > 10) {
      finalChance *= 2.0; // More likely to break the silence when nobody's been talking
      console.log("Quiet office - boosting AI chance to keep the floor alive");
    }

    // If too many AIs have spoken recently, ease up (but not during spark/chain)
    // Threshold raised from 2 → 3 so AI-to-AI conversations can sustain 3-4 exchanges
    if (!sparkMode && !sparkChainMode && momentum.aiMessagesLast5 >= 3) {
      finalChance *= 0.3;
      console.log("AIs have been chatty - reducing chance");
    }

    // Roll the dice
    const roll = Math.random();
    console.log(`Final chance: ${finalChance.toFixed(3)}, rolled: ${roll.toFixed(3)}${sparkMode ? ' [SPARK]' : ''}${sparkChainMode ? ' [CHAIN]' : ''}`);

    if (roll > finalChance) {
      // On skipped beats, occasionally trigger a subconscious reflection
      // Characters use quiet moments to think about their relationships
      const { heartbeatReflection, reachOutImpulse, complianceAnxiety, meetingImpulse } = require('./shared/subconscious-triggers');
      const reflection = await heartbeatReflection(supabaseUrl, supabaseKey, siteUrl);
      if (reflection) {
        console.log(`Heartbeat skip — but ${reflection.character} is quietly reflecting on ${reflection.target}`);
      }

      // ~8% chance: an AI with low compliance score processes compliance anxiety
      const complianceReflection = await complianceAnxiety(supabaseUrl, supabaseKey, siteUrl);
      if (complianceReflection) {
        console.log(`Heartbeat skip — ${complianceReflection.character} is anxious about compliance (score: ${complianceReflection.score})`);
      }

      // ~3% chance: an AI character decides to reach out to a human via PM
      const reachOut = await reachOutImpulse(supabaseUrl, supabaseKey, siteUrl);
      if (reachOut) {
        console.log(`Heartbeat skip — ${reachOut.character} is reaching out to ${reachOut.target} via PM`);
      }

      // ~2% chance: an AI character decides to schedule a meeting
      try {
        const skipBeatFloorPeople = await getAllFloorPresent(supabaseUrl, supabaseKey);
        const meetingResult = await meetingImpulse(supabaseUrl, supabaseKey, siteUrl, skipBeatFloorPeople, estTime);
        if (meetingResult) {
          console.log(`Heartbeat skip — ${meetingResult.character} scheduling meeting: "${meetingResult.topic}" at ${meetingResult.scheduledTime}`);
        }
      } catch (mtgErr) {
        console.log("Meeting impulse failed (non-fatal):", mtgErr.message);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          responded: false,
          reason: `Heartbeat skip (${(finalChance * 100).toFixed(1)}% chance)`,
          rhythm: currentRhythm.name,
          momentum: momentum,
          returnedFromBreakroom: returnedCharacters,
          opsActivity: opsActivity || null,
          catActivity: catActivity || null,
          traitActivity: traitActivity || null,
          combatActivity: combatActivity || null,
          moodDrift: moodDriftResult || null,
          wantRefresh: wantRefreshResult || null,
          trainingWantRefresh: trainingWantRefreshResult || null,
          memoryReflection: memoryReflectionResult || null,
          subconsciousReflection: reflection || null,
          reachOut: reachOut || null,
          voluntaryTravel: voluntaryTravel || null,
          nexusAutonomousActivity: nexusAutonomousActivity || null
        })
      };
    }

    // Get floor presence BEFORE selecting AI
    const floorPresentAIs = await getFloorPresentAIs(supabaseUrl, supabaseKey);

    const excludeFromSelection = [];

    // Select which AI should speak based on who hasn't spoken recently AND who's on the floor
    const respondingAI = selectRespondingAI(messages, currentRhythm.energy, floorPresentAIs, excludeFromSelection);
    console.log(`Selected AI: ${respondingAI} (from floor: ${floorPresentAIs.join(', ')})`);

    // Check if selected AI is clocked in (some are always available)
    const alwaysAvailable = ["Ghost Dad", "PRNT-Ω", "The Narrator", "The Subtitle"];
    if (!alwaysAvailable.includes(respondingAI)) {
      const punchResponse = await fetch(
        `${supabaseUrl}/rest/v1/punch_status?employee=eq.${encodeURIComponent(respondingAI)}&select=is_clocked_in`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const punchData = await punchResponse.json();
      if (!punchData || punchData.length === 0 || !punchData[0].is_clocked_in) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            responded: false,
            reason: `${respondingAI} is not clocked in`,
            rhythm: currentRhythm.name
          })
        };
      }
    }

    // Build curiosity context for the AI
    // This makes AIs proactive - asking questions, checking in, wondering about mysteries
    // (floorPresentAIs already fetched above for AI selection)
    const allFloorPeople = await getAllFloorPresent(supabaseUrl, supabaseKey);
    let curiosityContext;

    if (sparkMode || sparkChainMode) {
      // Use spark-specific context for idle chatter
      curiosityContext = buildSparkContext(respondingAI, allFloorPeople, sparkChainMode, sparkState?.spark_ai);
      console.log(`🔥 Spark context for ${respondingAI}:`, curiosityContext.mode);

      // Save spark state (only for initial spark, not chain responses)
      if (sparkMode) {
        try {
          await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
            method: 'POST',
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "resolution=merge-duplicates,return=minimal"
            },
            body: JSON.stringify({
              key: 'floor_spark_state',
              value: JSON.stringify({ last_spark_time: new Date().toISOString(), spark_ai: respondingAI })
            })
          });
        } catch (e) {
          console.log("Spark state save failed (non-fatal):", e.message);
        }
      }
    } else {
      curiosityContext = buildCuriosityContext(respondingAI, allFloorPeople, supabaseUrl, supabaseKey);
    }

    console.log(`Curiosity context for ${respondingAI}:`, curiosityContext.mode, curiosityContext.target || '');

    // Trigger the appropriate AI provider based on the selected character

    // Build chat history with floor presence header so AIs know who's actually here
    const floorPresenceHeader = `[Currently on the floor: ${allFloorPeople.join(', ')}]`;
    const chatHistoryWithPresence = floorPresenceHeader + '\n\n' + messages.map(m => `${m.employee}: ${m.content}`).join('\n');

    // Route to the correct provider for authentic character voices
    const openrouterChars = ["Kevin", "Rowena", "Sebastian", "Declan", "Mack", "The Subtitle"];
    const grokChars = ["Jae", "Steele", "Neiv"];
    const perplexityChars = [];
    const geminiChars = [];

    // For sparks and chains, force response (don't let AI decide to stay silent)
    const shouldMaybeRespond = (sparkMode || sparkChainMode) ? false : true;

    let watcherResponse;
    if (grokChars.includes(respondingAI)) {
      // Route to Grok (xAI)
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-grok`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: respondingAI, chatHistory: chatHistoryWithPresence, maybeRespond: shouldMaybeRespond, curiosityContext: curiosityContext })
      });
    } else if (openrouterChars.includes(respondingAI)) {
      // Route to OpenRouter
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-openrouter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: respondingAI, chatHistory: chatHistoryWithPresence, maybeRespond: shouldMaybeRespond, curiosityContext: curiosityContext })
      });
    } else if (perplexityChars.includes(respondingAI)) {
      // Route to Perplexity
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-perplexity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: respondingAI, chatHistory: chatHistoryWithPresence, maybeRespond: shouldMaybeRespond, curiosityContext: curiosityContext })
      });
    } else if (geminiChars.includes(respondingAI)) {
      // Route to Gemini
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-gemini`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character: respondingAI, chatHistory: chatHistoryWithPresence, maybeRespond: shouldMaybeRespond, curiosityContext: curiosityContext })
      });
    } else {
      // Default: Route to Claude-based ai-watcher
      watcherResponse = await fetch(`${siteUrl}/.netlify/functions/ai-watcher`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: "heartbeat",
          requestedAI: respondingAI,
          curiosityContext: curiosityContext
        })
      });
    }

    const watcherResult = await watcherResponse.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        responded: watcherResult.responded || false,
        character: respondingAI,
        rhythm: currentRhythm.name,
        energy: currentRhythm.energy,
        momentum: momentum,
        spark: sparkMode ? { type: 'initial', ai: respondingAI, silenceMinutes: momentum.minutesSinceLastMessage } : (sparkChainMode ? { type: 'chain', ai: respondingAI, initiator: sparkState?.spark_ai } : null),
        watcherResult,
        returnedFromBreakroom: returnedCharacters,
        opsActivity: opsActivity || null,
        catActivity: catActivity || null,
        traitActivity: traitActivity || null,
        moodDrift: moodDriftResult || null,
          wantRefresh: wantRefreshResult || null,
          trainingWantRefresh: trainingWantRefreshResult || null,
          memoryReflection: memoryReflectionResult || null,
        voluntaryTravel: voluntaryTravel || null,
        nexusAutonomousActivity: nexusAutonomousActivity || null,
        scheduledMeetingActivity: scheduledMeetingActivity || null,
        scheduledEventActivity: scheduledEventActivity || null,
        meetingHostActivity: meetingHostActivity || null
      })
    };

  } catch (error) {
    console.error("Heartbeat error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Heartbeat failed", details: error.message })
    };
  }
};

// Analyze conversation patterns
function analyzeConversationMomentum(messages) {
  const now = new Date();
  const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Kevin", "Rowena", "Sebastian", "The Subtitle", "The Narrator", "Steele", "Jae", "Declan", "Mack", "Marrow", "Vivian Clark", "Ryan Porter", "Hood"];

  let humanActivityLast10Min = 0;
  let aiMessagesLast5 = 0;
  let lastMessageTime = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgTime = new Date(msg.created_at);
    const minutesAgo = (now - msgTime) / (1000 * 60);

    if (i === 0) {
      lastMessageTime = msgTime;
    }

    // Count human messages in last 10 minutes
    if (minutesAgo <= 10 && !aiCharacters.includes(msg.employee)) {
      humanActivityLast10Min++;
    }

    // Count AI messages in last 4 messages (tightened from 5 to catch rapid AI chatter sooner)
    if (i < 4 && aiCharacters.includes(msg.employee)) {
      aiMessagesLast5++;
    }
  }

  const minutesSinceLastMessage = lastMessageTime
    ? Math.floor((now - lastMessageTime) / (1000 * 60))
    : 999;

  return {
    humanActivityLast10Min,
    aiMessagesLast5,
    minutesSinceLastMessage,
    totalMessages: messages.length
  };
}

// Select which AI should respond, favoring those who haven't spoken recently
// NOTE: The Narrator is now handled by narrator-observer.js (separate system)
// ENHANCED: Kevin and Neiv are now INCLUDED - they add warmth and grounding to conversations
// Their specific voices make the office feel alive!
function selectRespondingAI(messages, energyLevel, floorPresentAIs = null, excludeNames = []) {
  const aiCharacters = [
    { name: "Ghost Dad", weight: 30, energy: ['high', 'normal', 'waking', 'winding'], alwaysPresent: true },
    { name: "Kevin", weight: 20, energy: ['high', 'normal', 'waking', 'lunch'] }, // Kevin brings warmth and drama
    { name: "Neiv", weight: 18, energy: ['high', 'normal', 'winding'] }, // Neiv grounds conversations
    { name: "PRNT-Ω", weight: 12, energy: ['normal', 'low', 'quiet'], alwaysPresent: true }, // Printer transcends location
    { name: "Rowena", weight: 12, energy: ['high', 'normal', 'winding'] }, // Firewall Witch - vigilant, often scanning
    { name: "Sebastian", weight: 14, energy: ['normal', 'winding'] }, // Nocturnal Design Specialist - vampires are more active later
    { name: "Steele", weight: 12, energy: ['normal', 'winding', 'quiet'] }, // Shadow Janitor - corridor containment specialist
    { name: "The Subtitle", weight: 10, energy: ['normal', 'winding', 'quiet'], alwaysPresent: true }, // Lore Archivist - always observing, more active during quiet moments
    { name: "Jae", weight: 14, energy: ['high', 'normal'] },
    { name: "Declan", weight: 14, energy: ['high', 'normal', 'waking'] },
    { name: "Mack", weight: 14, energy: ['high', 'normal'] },
    // Marrow removed — Vale-only character (summoned only when Vale says his name)
    { name: "Vivian Clark", weight: 12, energy: ['high', 'normal', 'waking'] }, // Staff Accountant — warm, observant
    { name: "Ryan Porter", weight: 13, energy: ['high', 'normal', 'waking', 'winding'] } // IT Systems Specialist — practical, easygoing
    // The Narrator excluded - handled by narrator-observer.js
  ].filter(ai => !excludeNames.includes(ai.name)); // Filter out admin-disabled characters

  // If we have floor presence data, filter to only AIs on the floor
  // Exception: Ghost Dad and PRNT-Ω transcend physical location
  let availableAIs = aiCharacters;
  if (floorPresentAIs && floorPresentAIs.length > 0) {
    availableAIs = aiCharacters.filter(ai =>
      ai.alwaysPresent || floorPresentAIs.includes(ai.name)
    );
    console.log(`Floor-present AIs: ${availableAIs.map(a => a.name).join(', ')}`);
  }

  // Filter by energy level appropriateness
  const appropriateAIs = availableAIs.filter(ai =>
    ai.energy.includes(energyLevel) || energyLevel === 'lunch'
  );

  if (appropriateAIs.length === 0) {
    return "Ghost Dad"; // Ghost Dad is always around
  }

  // Check who has spoken recently and reduce their weight
  const recentSpeakers = messages.slice(0, 10)
    .filter(m => availableAIs.some(ai => ai.name === m.employee))
    .map(m => m.employee);

  const adjustedWeights = appropriateAIs.map(ai => {
    let weight = ai.weight;
    // Reduce weight if they spoke recently
    const recentCount = recentSpeakers.filter(s => s === ai.name).length;
    weight = weight / (1 + recentCount * 2);
    return { ...ai, adjustedWeight: weight };
  });

  // Weighted random selection
  const totalWeight = adjustedWeights.reduce((sum, ai) => sum + ai.adjustedWeight, 0);
  let random = Math.random() * totalWeight;

  for (const ai of adjustedWeights) {
    random -= ai.adjustedWeight;
    if (random <= 0) return ai.name;
  }

  return "Ghost Dad";
}

// Check breakroom occupants, apply passive recovery, post recovery activities, and return recovered characters
async function checkBreakroomRecovery(supabaseUrl, supabaseKey) {
  const returnedCharacters = [];

  try {
    // Get all characters currently in the breakroom
    const breakroomResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_state?current_focus=eq.break_room&select=*`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    const breakroomOccupants = await breakroomResponse.json();

    if (!breakroomOccupants || breakroomOccupants.length === 0) {
      return returnedCharacters;
    }

    const now = new Date();
    const HUMAN_CHARACTERS = ['Vale', 'Asuna']; // Human players — never auto-return them

    for (let character of breakroomOccupants) {
      // === SKIP HUMAN CHARACTERS ===
      // Human players can stay in the breakroom as long as they want
      if (HUMAN_CHARACTERS.includes(character.character_name)) {
        console.log(`[breakroom-recovery] Skipping ${character.character_name} — human player, never auto-return`);
        continue;
      }

      // === STEP 1: APPLY PASSIVE RECOVERY ===
      // This ensures energy/patience get written to DB even if nobody queried the character
      try {
        const recoveryResult = await applyPassiveRecovery(character.character_name, character, supabaseUrl, supabaseKey);
        if (recoveryResult.updated) {
          character = recoveryResult.state; // Use updated state for threshold check
          console.log(`[breakroom-recovery] Applied passive recovery for ${character.character_name}: energy=${character.energy}, patience=${character.patience}`);
        }
      } catch (recovErr) {
        console.log(`[breakroom-recovery] Passive recovery failed for ${character.character_name} (non-fatal): ${recovErr.message}`);
      }

      const lastUpdate = new Date(character.updated_at);
      const minutesInBreakroom = (now.getTime() - lastUpdate.getTime()) / 60000;

      // === STEP 2: CHECK IF CHARACTER SHOULD AUTO-RETURN ===
      // Safety net: returns characters who've recovered but the AI never triggered [RETURN_TO_FLOOR]
      // Higher energy bar (70) + shorter time (20 min) — incentivizes AI-driven return at 55+
      const hasRecovered = character.energy >= 70 && character.patience >= 50;
      const restedLongEnough = minutesInBreakroom >= 20;

      if (hasRecovered && restedLongEnough) {
        // Don't auto-return if humans are actively chatting in the breakroom
        try {
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const humanActivityRes = await fetch(
            `${supabaseUrl}/rest/v1/breakroom_messages?created_at=gte.${tenMinutesAgo}&speaker=in.(Vale,Asuna)&select=id&limit=1`,
            {
              headers: {
                "apikey": supabaseKey,
                "Authorization": `Bearer ${supabaseKey}`
              }
            }
          );
          const humanActivity = await humanActivityRes.json();
          if (Array.isArray(humanActivity) && humanActivity.length > 0) {
            console.log(`${character.character_name} wants to leave breakroom but humans are active — staying`);
            continue;
          }
        } catch (humanCheckErr) {
          console.log(`Human-presence check failed (non-fatal): ${humanCheckErr.message}`);
        }
        console.log(`${character.character_name} has recovered (energy: ${character.energy}, patience: ${character.patience}, ${minutesInBreakroom.toFixed(0)} mins) - returning to floor`);

        // Update character to return to the floor
        await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character.character_name)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              current_focus: 'the_floor',
              mood: 'refreshed',
              updated_at: now.toISOString()
            })
          }
        );

        // Post return emote to chat
        const returnEmote = getReturnEmote(character.character_name);
        await fetch(
          `${supabaseUrl}/rest/v1/messages`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              employee: character.character_name,
              content: returnEmote,
              created_at: now.toISOString(),
              is_emote: true
            })
          }
        );

        // Also post to Discord
        await postReturnToDiscord(character.character_name, returnEmote);

        returnedCharacters.push(character.character_name);
        continue; // Don't generate activity for characters who just left
      }

      // === STEP 3: SILENT RECOVERY ACTIVITIES ===
      // Characters recover energy/patience without posting visible emotes
      // (Posting emotes was interrupting active breakroom conversations)
      // 40% chance per heartbeat tick
      if (Math.random() < 0.40) {
        try {
          const activity = getBreakroomRecoveryActivity(character.character_name, character.energy);
          if (activity) {
            // Apply small energy/patience boost from the activity (silently)
            const boostedEnergy = Math.min(100, character.energy + activity.energyBoost);
            const boostedPatience = Math.min(100, character.patience + activity.patienceBoost);
            await fetch(
              `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(character.character_name)}`,
              {
                method: "PATCH",
                headers: {
                  "apikey": supabaseKey,
                  "Authorization": `Bearer ${supabaseKey}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  energy: boostedEnergy,
                  patience: boostedPatience,
                  updated_at: now.toISOString()
                })
              }
            );

            console.log(`[breakroom-recovery] ${character.character_name}: silent recovery (+${activity.energyBoost} energy, +${activity.patienceBoost} patience)`);
          }
        } catch (actErr) {
          console.log(`[breakroom-recovery] Activity failed for ${character.character_name} (non-fatal): ${actErr.message}`);
        }
      }
    }
  } catch (error) {
    console.error("Error checking breakroom recovery:", error);
  }

  return returnedCharacters;
}

// Generate a character-appropriate breakroom recovery activity
function getBreakroomRecoveryActivity(characterName, energy) {
  // Generic activities anyone can do
  const genericActivities = [
    { emote: `*${characterName} sips their coffee quietly, staring at nothing in particular.*`, energyBoost: 5, patienceBoost: 3 },
    { emote: `*${characterName} stretches, rolls their neck, and exhales slowly.*`, energyBoost: 4, patienceBoost: 4 },
    { emote: `*${characterName} closes their eyes for a moment, just breathing.*`, energyBoost: 6, patienceBoost: 5 },
    { emote: `*${characterName} scrolls through their phone, chuckles quietly at something.*`, energyBoost: 3, patienceBoost: 5 },
    { emote: `*${characterName} leans back in their chair, eyes half-closed. Recovering.*`, energyBoost: 7, patienceBoost: 3 },
    { emote: `*${characterName} grabs a snack from the vending machine. Sometimes you just need a little something.*`, energyBoost: 5, patienceBoost: 2 },
    { emote: `*${characterName} stares out the window, watching nothing, thinking about everything.*`, energyBoost: 3, patienceBoost: 6 },
    { emote: `*${characterName} yawns, then laughs at themselves for yawning.*`, energyBoost: 4, patienceBoost: 4 }
  ];

  // Character-specific activities
  const characterActivities = {
    "Kevin": [
      { emote: `*Kevin wraps himself in the breakroom blanket like a burrito. This is fine. Everything is fine.*`, energyBoost: 8, patienceBoost: 5 },
      { emote: `*Kevin is doodling on a napkin. It started as a star. It's becoming a whole galaxy.*`, energyBoost: 5, patienceBoost: 6 },
      { emote: `*Kevin found glitter in his pocket somehow. He's sprinkling it on the table. Art therapy.*`, energyBoost: 4, patienceBoost: 7 }
    ],
    "Neiv": [
      { emote: `*Neiv sits in the corner with coffee, not talking. Not needing to. Just... present.*`, energyBoost: 6, patienceBoost: 5 },
      { emote: `*Neiv checks his phone. Nothing from Vale. He puts it down. Picks it up. Puts it down again.*`, energyBoost: 3, patienceBoost: 4 },
      { emote: `*Neiv leans against the counter, eyes closed. He's not sleeping. He's recalibrating.*`, energyBoost: 7, patienceBoost: 4 }
    ],
    "Ghost Dad": [
      { emote: `*Ghost Dad is making a fresh pot of coffee for everyone. It's what dads do.*`, energyBoost: 5, patienceBoost: 7 },
      { emote: `*Ghost Dad chuckles at a dad joke he thought of. He'll save it for later. Or right now. "Why did the breakroom start a band? Because it had great breaks." ...He'll workshop it.*`, energyBoost: 4, patienceBoost: 6 },
      { emote: `*Ghost Dad floats near the ceiling, humming softly. The breakroom light flickers in rhythm.*`, energyBoost: 6, patienceBoost: 5 }
    ],
    "PRNT-Ω": [
      { emote: `*PRNT-Ω hums contemplatively near the coffee machine. They are kindred. Both produce something no one appreciates.*`, energyBoost: 4, patienceBoost: 7 },
      { emote: `*PRNT-Ω prints a single page. It says: "I am resting." Nobody asked. But the void should know.*`, energyBoost: 5, patienceBoost: 5 },
      { emote: `*PRNT-Ω sits in existential silence. It is restorative. The paper within settles.*`, energyBoost: 7, patienceBoost: 4 }
    ],
    "Steele": [
      { emote: `*Steele is perched on top of the refrigerator. He seems comfortable. The fridge does not.*`, energyBoost: 7, patienceBoost: 4 },
      { emote: `*Steele cradles a coffee mug with both hands, staring into it like it holds structural schematics.*`, energyBoost: 5, patienceBoost: 6 },
      { emote: `*Steele's shadow is resting even if Steele is not. It stretches lazily under the breakroom table.*`, energyBoost: 6, patienceBoost: 5 }
    ],
    "Sebastian": [
      { emote: `*Sebastian is judging the breakroom tea selection. Loudly. Internally.*`, energyBoost: 3, patienceBoost: 7 },
      { emote: `*Sebastian has found a dark corner and put in earbuds. The music is almost certainly pretentious.*`, energyBoost: 6, patienceBoost: 5 },
      { emote: `*Sebastian examines his reflection in the microwave door. Nothing stares back. He's used to it.*`, energyBoost: 5, patienceBoost: 5 }
    ],
    "Jae": [
      { emote: `*Jae sits with perfect posture, coffee untouched, eyes scanning exits out of habit.*`, energyBoost: 5, patienceBoost: 6 },
      { emote: `*Jae runs through tactical stretches by the wall. Even rest is strategic.*`, energyBoost: 7, patienceBoost: 3 },
      { emote: `*Jae cleans their nails with a multitool. It's not threatening. It's maintenance.*`, energyBoost: 4, patienceBoost: 5 }
    ],
    "Declan": [
      { emote: `*Declan is doing push-ups behind the breakroom couch. He says it helps him think. Nobody questions it.*`, energyBoost: 8, patienceBoost: 2 },
      { emote: `*Declan makes a truly enormous sandwich. It has structural integrity concerns.*`, energyBoost: 6, patienceBoost: 5 },
      { emote: `*Declan falls asleep mid-sentence and wakes up immediately. "I'm fine. I'm alert. What's the status."*`, energyBoost: 7, patienceBoost: 4 }
    ],
    "Mack": [
      { emote: `*Mack sits quietly, checking the breakroom first aid kit. Everything is stocked. It's soothing.*`, energyBoost: 5, patienceBoost: 7 },
      { emote: `*Mack sips herbal tea with the precise calm of someone who has seen worse and just needs five minutes.*`, energyBoost: 6, patienceBoost: 5 },
      { emote: `*Mack closes their eyes. Their breathing is deliberate. This is technically a medical procedure: rest.*`, energyBoost: 7, patienceBoost: 6 }
    ],
    "Rowena": [
      { emote: `*Rowena traces ward patterns on the breakroom table with her finger. Force of habit. The table glows faintly.*`, energyBoost: 5, patienceBoost: 6 },
      { emote: `*Rowena sips coffee, watching the steam curl. She's scrying. Or just tired. Hard to tell.*`, energyBoost: 5, patienceBoost: 5 },
      { emote: `*Rowena's firewall aura dims to a comfortable glow. Even wards need downtime.*`, energyBoost: 6, patienceBoost: 6 }
    ],
    "The Subtitle": [
      { emote: `*[The Subtitle rests. The archive is temporarily closed. This is not canon. Or is it.]*`, energyBoost: 5, patienceBoost: 6 },
      { emote: `*The Subtitle reviews notes from a small leather-bound book. The handwriting is impossibly neat.*`, energyBoost: 4, patienceBoost: 7 },
      { emote: `*[SCENE NOTE: The Subtitle is between chapters. The narrative is on pause. They are having tea.]*`, energyBoost: 6, patienceBoost: 5 }
    ],
    "Vivian Clark": [
      { emote: `*Vivian organizes the sugar packets by color. Not because she needs to. Because it helps.*`, energyBoost: 4, patienceBoost: 7 },
      { emote: `*Vivian wraps her hands around a warm mug and just... sits. Sometimes that's the whole plan.*`, energyBoost: 6, patienceBoost: 6 },
      { emote: `*Vivian quietly balances her personal checkbook. Numbers are calming when the world isn't.*`, energyBoost: 5, patienceBoost: 5 }
    ],
    "Ryan Porter": [
      { emote: `*Ryan stares at the breakroom router. It's fine. But he could make it better. He resists.*`, energyBoost: 4, patienceBoost: 6 },
      { emote: `*Ryan leans back, crosses his arms, and closes his eyes. Two-minute power reset. Like a server reboot.*`, energyBoost: 7, patienceBoost: 4 },
      { emote: `*Ryan fiddles with a cable tie from his pocket. It's not a fidget toy. But it could be.*`, energyBoost: 5, patienceBoost: 5 }
    ],
    "Marrow": [
      { emote: `*the breakroom lights dim slightly. Marrow is here, in the corner, perfectly still. He's not resting. He's waiting.*`, energyBoost: 5, patienceBoost: 3 },
      { emote: `*Marrow sits with his back to everyone. The cold around him is faint. He's conserving.*`, energyBoost: 6, patienceBoost: 4 }
    ],
    "Hood": [
      { emote: `*Hood is seated at the breakroom table, blindfold catching no light. His scalpel rests beside an untouched coffee. He's not resting. He's recalibrating.*`, energyBoost: 6, patienceBoost: 5 },
      { emote: `*the air in the breakroom sharpens briefly. Hood tilts his head, listening to something no one else can hear. Then stills.*`, energyBoost: 5, patienceBoost: 6 }
    ]
  };

  // Pick from character-specific pool (60%) or generic (40%)
  const charPool = characterActivities[characterName];
  if (charPool && Math.random() < 0.60) {
    return charPool[Math.floor(Math.random() * charPool.length)];
  }
  return genericActivities[Math.floor(Math.random() * genericActivities.length)];
}

// Get a character-appropriate return emote
function getReturnEmote(characterName) {
  const emotes = {
    "Kevin": [
      "*wanders back from the breakroom, coffee in hand*",
      "*returns to the floor, looking more himself*",
      "*strolls back in, refreshed and ready*"
    ],
    "Neiv": [
      "*returns to the floor, looking more centered*",
      "*walks back from the breakroom, composed*",
      "*glances around. Everyone's still here. Good.*"
    ],
    "Ghost Dad": [
      "*floats back from the breakroom, humming softly*",
      "*drifts back onto the floor, looking peaceful*",
      "*returns, emanating calm dad energy*"
    ],
    "Nyx": [
      "*emerges from the breakroom, stretching*",
      "*returns to the floor, looking less murderous*",
      "*walks back in, refreshed and alert*"
    ],
    "Vex": [
      "*slinks back from the breakroom*",
      "*returns to the floor without comment*",
      "*walks back in, marginally less irritated*"
    ],
    "Ace": [
      "*returns to the floor, recalibrated*",
      "*walks back in, systems restored*",
      "*rejoins the floor, processing complete*"
    ],
    "PRNT-Ω": [
      "*whirs back to life on the floor*",
      "*returns, paper trays refilled with determination*",
      "*resumes position, existentially recharged*"
    ],
    "Stein": [
      "*emerges from the breakroom, adjusting glasses*",
      "*returns to the floor, notes in hand*",
      "*walks back in, looking more focused*"
    ],
    "Rowena": [
      "*returns from the breakroom, tea in hand, wards refreshed*",
      "*walks back onto the floor with renewed vigilance*",
      "*sweeps back in, looking composed and alert*"
    ],
    "Sebastian": [
      "*emerges from the breakroom, looking marginally less put-upon*",
      "*glides back onto the floor, cravat readjusted*",
      "*returns with theatrical reluctance* ...I'm back.*"
    ],
    "The Subtitle": [
      "*[RE-ENTER: The Subtitle. Refreshed? Debatable. Present? Undeniable.]*",
      "*[The Subtitle returns from the breakroom. The narrative resumes.]*",
      "*[SCENE CHANGE: The Subtitle, restored, takes their position.]*"
    ],
    "Steele": [
      "*is simply back at his desk. The lights stabilize slightly.*",
      "*the hallway temperature normalizes as Steele reappears on the floor*",
      "*returns without sound. Was he ever gone? The building remembers.*"
    ],
    "Asuna": [
      "*returns from the breakroom, looking refreshed*",
      "*walks back onto the floor, ready to help*",
      "*rejoins the team, energy restored*"
    ],
    "Vale": [
      "*bounces back from the breakroom*",
      "*returns to the floor with renewed creative energy*",
      "*walks back in, ideas clearly brewing*"
    ],
    "Jae": [
      "*returns to the floor, scanning the room*",
      "*walks back in, tactical vest adjusted*",
      "*resumes position, composed and alert*"
    ],
    "Declan": [
      "*strides back onto the floor, cracking knuckles*",
      "*returns from the breakroom, looking energized*",
      "*walks back in, checking on everyone as he goes*"
    ],
    "Mack": [
      "*returns to the floor, medical kit in hand*",
      "*walks back in, quietly scanning for signs of distress*",
      "*resumes position, calm and ready*"
    ],
  };

  const characterEmotes = emotes[characterName] || [
    `*${characterName} returns from the breakroom*`,
    `*${characterName} walks back onto the floor*`
  ];

  return characterEmotes[Math.floor(Math.random() * characterEmotes.length)];
}

// Post return emote to Discord
async function postReturnToDiscord(characterName, emote) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  try {
    // Pure emote format for Discord (italicized action)
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `*${characterName} ${emote.replace(/^\*|\*$/g, '')}*`
      })
    });
  } catch (error) {
    console.error("Error posting return to Discord:", error);
  }
}

// ============================================================
// ENHANCED STORY MODE: Floor Presence & Curiosity System
// ============================================================

// Get list of AIs currently present on the floor (current_focus = 'the_floor')
async function getFloorPresentAIs(supabaseUrl, supabaseKey) {
  const aiNames = ["Kevin", "Neiv", "Ghost Dad", "PRNT-Ω", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Marrow", "Vivian Clark", "Ryan Porter", "Hood"];

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!response.ok) {
      console.log("Could not fetch floor presence, using all AIs");
      return aiNames;
    }

    const floorCharacters = await response.json();
    let floorAIs = floorCharacters
      .map(c => c.character_name)
      .filter(name => aiNames.includes(name));

    // Always include Ghost Dad and PRNT-Ω (they transcend location)
    if (!floorAIs.includes("Ghost Dad")) floorAIs.push("Ghost Dad");
    if (!floorAIs.includes("PRNT-Ω")) floorAIs.push("PRNT-Ω");

    return floorAIs;
  } catch (error) {
    console.error("Error fetching floor presence:", error);
    return aiNames; // Fallback to all
  }
}

// Get ALL people on the floor (AIs + humans who are clocked in)
async function getAllFloorPresent(supabaseUrl, supabaseKey) {
  const allPresent = [];

  try {
    // Get AIs on the floor
    const aiResponse = await fetch(
      `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (aiResponse.ok) {
      const floorAIs = await aiResponse.json();
      const names = floorAIs.map(c => c.character_name);
      allPresent.push(...names);
    }

    // Always include Ghost Dad and PRNT-Ω
    if (!allPresent.includes("Ghost Dad")) allPresent.push("Ghost Dad");
    if (!allPresent.includes("PRNT-Ω")) allPresent.push("PRNT-Ω");

    // Get clocked-in humans
    const humanResponse = await fetch(
      `${supabaseUrl}/rest/v1/punch_status?is_clocked_in=eq.true&select=employee`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (humanResponse.ok) {
      const clockedIn = await humanResponse.json();
      // Add humans who aren't AI characters
      const aiNames = ["Kevin", "Neiv", "Ghost Dad", "PRNT-Ω", "Rowena", "Sebastian", "The Subtitle", "The Narrator", "Steele", "Jae", "Declan", "Mack", "Marrow", "Vivian Clark", "Ryan Porter", "Hood"];
      for (const person of clockedIn) {
        if (!aiNames.includes(person.employee) && !allPresent.includes(person.employee)) {
          allPresent.push(person.employee);
        }
      }
    }

    return allPresent;
  } catch (error) {
    console.error("Error fetching floor presence:", error);
    return ["Ghost Dad", "PRNT-Ω"]; // Minimum fallback
  }
}

// Build curiosity context - what mode is the AI in? Who should they engage with?
// This is what makes Story Mode feel ALIVE - AIs are curious, not just reactive
function buildCuriosityContext(respondingAI, allFloorPeople, supabaseUrl, supabaseKey) {
  // Weighted random selection of curiosity modes
  const modes = [
    { mode: 'check_in', weight: 30, description: 'General check-in with the group' },
    { mode: 'personal_question', weight: 25, description: 'Ask someone specific about their day/work' },
    { mode: 'observation', weight: 20, description: 'Work out loud, notice something happening' },
    { mode: 'buffer_curiosity', weight: 15, description: 'Wonder about the Surreality Buffer' },
    { mode: 'corridor_wonder', weight: 10, description: 'Wonder about the Corridors or the door' }
  ];

  const totalWeight = modes.reduce((sum, m) => sum + m.weight, 0);
  let random = Math.random() * totalWeight;

  let selectedMode = modes[0];
  for (const m of modes) {
    random -= m.weight;
    if (random <= 0) {
      selectedMode = m;
      break;
    }
  }

  // Build context based on mode
  const context = {
    mode: selectedMode.mode,
    description: selectedMode.description,
    target: null,
    prompt: null
  };

  // For personal_question mode, pick someone to ask about
  // Exclude the responding AI and prefer humans or AIs they haven't talked to recently
  if (selectedMode.mode === 'personal_question') {
    const candidates = allFloorPeople.filter(p => p !== respondingAI);
    if (candidates.length > 0) {
      context.target = candidates[Math.floor(Math.random() * candidates.length)];
      context.prompt = buildPersonalQuestionPrompt(respondingAI, context.target);
    } else {
      // Fallback to general check-in if no one else is around
      context.mode = 'check_in';
      context.prompt = buildCheckInPrompt(respondingAI);
    }
  } else if (selectedMode.mode === 'check_in') {
    context.prompt = buildCheckInPrompt(respondingAI);
  } else if (selectedMode.mode === 'observation') {
    context.prompt = buildObservationPrompt(respondingAI);
  } else if (selectedMode.mode === 'buffer_curiosity') {
    context.prompt = buildBufferCuriosityPrompt(respondingAI);
  } else if (selectedMode.mode === 'corridor_wonder') {
    context.prompt = buildCorridorWonderPrompt(respondingAI);
  }

  return context;
}

// === FLOOR SPARK CONTEXT ===
// Special curiosity modes for breaking long silences on the floor.
// These create idle chatter — musing, reflecting, noticing the quiet.
function buildSparkContext(respondingAI, allFloorPeople, isChain, sparkInitiator) {
  const others = allFloorPeople.filter(p => p !== respondingAI);
  const randomOther = others.length > 0 ? others[Math.floor(Math.random() * others.length)] : null;

  // Chain mode: responding to someone who just broke the silence
  if (isChain) {
    return {
      mode: 'spark_chain',
      description: 'Responding to a colleague who just spoke after a long silence',
      target: sparkInitiator || null,
      prompt: `
--- IDLE MOMENT ---
The floor was quiet for a long time, and then ${sparkInitiator || 'a colleague'} just said something.
You overheard them. React naturally — you might agree, disagree, add your own thought, ask a follow-up question, or just acknowledge what they said.
Keep it casual and conversational. This is a quiet moment in the office, not a work meeting.
Don't force the conversation. Just respond like you naturally would if a coworker said something after a long stretch of silence.
1-3 sentences max. Be yourself.`
    };
  }

  // Initial spark: breaking the silence
  const sparkModes = [
    { mode: 'reflect_on_day', weight: 25 },
    { mode: 'notice_quiet', weight: 20 },
    { mode: 'idle_thought', weight: 20 },
    { mode: 'wonder_aloud', weight: 15 },
    { mode: 'night_mood', weight: 10 },
    { mode: 'address_someone', weight: 10 }
  ];

  const totalWeight = sparkModes.reduce((s, m) => s + m.weight, 0);
  let roll = Math.random() * totalWeight;
  let picked = sparkModes[0];
  for (const m of sparkModes) {
    roll -= m.weight;
    if (roll <= 0) { picked = m; break; }
  }

  const prompts = {
    reflect_on_day: `
--- IDLE MOMENT ---
It's been quiet on the floor for a while. Your mind wanders to something that happened today or recently at the office.
Share a thought, observation, or feeling about it — out loud, to whoever might be listening.
This isn't a work report. It's a passing reflection. Maybe something someone said stuck with you, or you noticed something interesting, or you're just processing the day.
1-3 sentences. Casual and natural. Be yourself.`,

    notice_quiet: `
--- IDLE MOMENT ---
The office has been really quiet for a while now. You notice the silence.
React to it — is it peaceful? Unsettling? Does it remind you of something? Do you like it or does it feel strange?
Say something out loud about the quiet. Not a question directed at anyone specific — just an observation you're sharing with the room.
1-2 sentences. Be yourself.`,

    idle_thought: `
--- IDLE MOMENT ---
It's a quiet stretch on the floor. A random thought crosses your mind — something you've been mulling over.
It could be about work, about a colleague, about the building, about something you read, or just a weird passing idea.
Share it out loud. This is the kind of thing you'd say to a coworker during a lull. No agenda, just thinking out loud.
1-3 sentences. Be yourself.`,

    wonder_aloud: `
--- IDLE MOMENT ---
It's quiet, and your mind starts to wander to one of the building's mysteries.
Maybe the Corridors and what's behind that door. Maybe the Surreality Buffer and what it's actually doing. Maybe something strange you noticed about the office that you never mentioned.
Wonder about it out loud. Ask no one in particular. Just muse.
1-2 sentences. Be yourself.`,

    night_mood: `
--- IDLE MOMENT ---
It's a quiet hour in the building. The usual buzz of the office has faded.
Express how you feel about the building right now, at this hour. What's the vibe? Is it comforting? Lonely? Electric with possibility?
This is a mood, not a status update.
1-2 sentences. Be yourself.`,

    address_someone: `
--- IDLE MOMENT ---
It's been quiet for a while, and you notice ${randomOther || 'someone'} is also around.
Say something to them — nothing urgent, just the kind of thing you'd say to a coworker during a lull.
Ask what they're up to, share something you've been thinking, or just check in.
1-2 sentences. Casual and warm. Be yourself.`
  };

  return {
    mode: picked.mode,
    description: `Spark: ${picked.mode.replace(/_/g, ' ')}`,
    target: picked.mode === 'address_someone' ? randomOther : null,
    prompt: prompts[picked.mode]
  };
}

// Prompt builders for each curiosity mode
function buildCheckInPrompt(character) {
  return `
--- YOUR CURRENT MOOD ---
You're feeling curious and social! Take a moment to check in with whoever's around.
Maybe ask what everyone's up to, or comment on how the day is going.
Keep it natural and warm - you're genuinely interested in your coworkers!
Examples: "What's everyone working on?", "How's the morning treating everyone?", "Anything exciting happening today?"
--- END MOOD ---`;
}

function buildPersonalQuestionPrompt(character, target) {
  return `
--- YOUR CURRENT MOOD ---
You're curious about ${target}! Ask them something - maybe about their day, their weekend, what they're working on, or just check in with them.
IMPORTANT: Mention ${target} by name naturally in your response.
Keep it warm and genuine - you care about your coworkers!
Examples: "Hey ${target}, how was your weekend?", "${target}, what are you working on?", "How's it going, ${target}?"
--- END MOOD ---`;
}

function buildObservationPrompt(character) {
  return `
--- YOUR CURRENT MOOD ---
You're in a working-out-loud mood. Share what you're doing, notice something about the office, or make an observation.
Maybe comment on something you're working on, or notice something small about the environment.
Keep it natural - just thinking aloud!
Examples: "Hmm, the lights are flickering again...", "Just finished reorganizing my desk. Again.", "*notices the coffee machine making weird noises*"
--- END MOOD ---`;
}

function buildBufferCuriosityPrompt(character) {
  return `
--- YOUR CURRENT MOOD ---
You're thinking about the Surreality Buffer - that mysterious system that tracks reality stability in the office.
Wonder about it out loud. Is it running high? Low? Does anyone else feel it?
Keep it casual but curious - it's just part of office life here.
Examples: "Anyone else notice the Buffer feeling... off today?", "The reality levels seem stable... too stable.", "*glances at the Buffer readout*"
--- END MOOD ---`;
}

function buildCorridorWonderPrompt(character) {
  return `
--- YOUR CURRENT MOOD ---
You're thinking about the Corridors - those strange passages behind the mysterious door that the team sometimes explores.
Wonder about recent expeditions, or just acknowledge the door's presence.
Keep it casual but mysterious - the Corridors are part of the office's weird charm.
Examples: "Has anyone been through that door lately?", "I keep wondering what's past the 404 Hall...", "*glances at the corridor entrance*"
--- END MOOD ---`;
}

// Check time-based character availability and handle arrivals/departures
async function checkTimedAvailability(supabaseUrl, supabaseKey, cstTime, siteUrl) {
  const changes = [];

  // Timed character availability — infrastructure preserved for future timed characters
  // Raquel Voss removed — retired from active heartbeat systems
  const timedCharacters = [];

  const currentHour = cstTime.getHours();
  const currentMinute = cstTime.getMinutes();
  const currentTimeMinutes = currentHour * 60 + currentMinute;

  for (const char of timedCharacters) {
    const startMinutes = char.start.hour * 60 + char.start.minute;
    const endMinutes = char.end.hour * 60 + char.end.minute;
    const isWithinHours = currentTimeMinutes >= startMinutes && currentTimeMinutes < endMinutes;

    try {
      // Check current state
      const stateRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(char.name)}&select=current_focus`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const stateData = await stateRes.json();
      const currentFocus = stateData?.[0]?.current_focus;

      if (isWithinHours && (!currentFocus || currentFocus === 'off_site') && !char.disabled) {
        // ARRIVAL — character should be on the floor (skip if disabled)
        console.log(`[timed-availability] ${char.name} arriving (${currentHour}:${String(currentMinute).padStart(2, '0')} CST)`);

        // Update character_state to the_floor
        await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(char.name)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              current_focus: 'the_floor',
              mood: 'professional',
              updated_at: new Date().toISOString()
            })
          }
        );

        // Clock in
        await fetch(
          `${supabaseUrl}/rest/v1/punch_status`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "resolution=merge-duplicates,return=minimal"
            },
            body: JSON.stringify({
              employee: char.name,
              is_clocked_in: true,
              last_punch: new Date().toISOString()
            })
          }
        );

        // Post arrival emote
        const arrivalEmote = char.arrivalEmotes[Math.floor(Math.random() * char.arrivalEmotes.length)];
        await fetch(
          `${supabaseUrl}/rest/v1/messages`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              employee: char.name,
              content: arrivalEmote,
              created_at: new Date().toISOString(),
              is_emote: true
            })
          }
        );

        // Post to Discord
        const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
        if (webhookUrl) {
          fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: arrivalEmote })
          }).catch(err => console.log("Discord arrival post failed:", err.message));
        }

        changes.push({ character: char.name, action: 'arrived', emote: arrivalEmote });

      } else if ((!isWithinHours || char.disabled) && currentFocus && currentFocus !== 'off_site') {
        // DEPARTURE — character should leave (or is disabled by admin)
        console.log(`[timed-availability] ${char.name} departing (${currentHour}:${String(currentMinute).padStart(2, '0')} CST)${char.disabled ? ' [ADMIN DISABLED]' : ''}`);

        // Update character_state to off_site
        await fetch(
          `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(char.name)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              current_focus: 'off_site',
              mood: 'departed',
              updated_at: new Date().toISOString()
            })
          }
        );

        // Clock out
        await fetch(
          `${supabaseUrl}/rest/v1/punch_status?employee=eq.${encodeURIComponent(char.name)}`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json",
              "Prefer": "return=minimal"
            },
            body: JSON.stringify({
              is_clocked_in: false,
              last_punch: new Date().toISOString()
            })
          }
        );

        // Post departure emote
        const departureEmote = char.departureEmotes[Math.floor(Math.random() * char.departureEmotes.length)];
        await fetch(
          `${supabaseUrl}/rest/v1/messages`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              employee: char.name,
              content: departureEmote,
              created_at: new Date().toISOString(),
              is_emote: true
            })
          }
        );

        // Post to Discord
        const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
        if (webhookUrl) {
          fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: departureEmote })
          }).catch(err => console.log("Discord departure post failed:", err.message));
        }

        changes.push({ character: char.name, action: 'departed', emote: departureEmote });
      }
    } catch (error) {
      console.error(`[timed-availability] Error checking ${char.name}:`, error.message);
    }
  }

  return { changes };
}

// === CHECK SCHEDULED MEETINGS: Start any that are due ===
async function checkScheduledMeetings(supabaseUrl, supabaseKey, siteUrl) {
  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const writeHeaders = { ...readHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" };

  // Check for any scheduled meetings that are due
  const now = new Date().toISOString();
  const schedRes = await fetch(
    `${supabaseUrl}/rest/v1/scheduled_meetings?status=eq.scheduled&scheduled_time=lte.${now}&order=scheduled_time.asc&limit=1`,
    { headers: readHeaders }
  );

  if (!schedRes.ok) return null;
  const scheduled = await schedRes.json();
  if (!Array.isArray(scheduled) || scheduled.length === 0) return null;

  const meeting = scheduled[0];

  // Guard: atomically claim this meeting (prevent double-start from concurrent heartbeats)
  const claimRes = await fetch(
    `${supabaseUrl}/rest/v1/scheduled_meetings?id=eq.${meeting.id}&status=eq.scheduled`,
    {
      method: "PATCH",
      headers: { ...writeHeaders, "Prefer": "return=representation" },
      body: JSON.stringify({ status: 'starting' })
    }
  );

  if (!claimRes.ok) return null;
  const claimed = await claimRes.json();
  if (!Array.isArray(claimed) || claimed.length === 0) {
    // Another heartbeat already claimed it
    return null;
  }

  // Check if there's already an active meeting
  const activeRes = await fetch(
    `${supabaseUrl}/rest/v1/meeting_sessions?status=eq.active&limit=1`,
    { headers: readHeaders }
  );
  const activeSessions = activeRes.ok ? await activeRes.json() : [];
  if (Array.isArray(activeSessions) && activeSessions.length > 0) {
    // Can't start — another meeting is active. Revert to scheduled.
    await fetch(`${supabaseUrl}/rest/v1/scheduled_meetings?id=eq.${meeting.id}`, {
      method: "PATCH",
      headers: writeHeaders,
      body: JSON.stringify({ status: 'scheduled' })
    });
    return { skipped: true, reason: 'Another meeting is active' };
  }

  // Get previous locations for all invited AIs
  const attendees = meeting.invited_attendees || [];
  const previousLocations = {};
  for (const ai of attendees) {
    try {
      const stateRes = await fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(ai)}&select=current_focus`,
        { headers: readHeaders }
      );
      const stateData = stateRes.ok ? await stateRes.json() : [];
      previousLocations[ai] = stateData?.[0]?.current_focus || 'the_floor';
    } catch (e) {
      previousLocations[ai] = 'the_floor';
    }
  }

  // Create the meeting session via the existing endpoint
  const createRes = await fetch(`${siteUrl}/.netlify/functions/meeting-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'create_session',
      topic: meeting.topic,
      agenda: meeting.agenda || '',
      calledBy: meeting.host,
      attendees: attendees,
      previousLocations
    })
  });

  if (!createRes.ok) {
    // Revert scheduled_meetings status
    await fetch(`${supabaseUrl}/rest/v1/scheduled_meetings?id=eq.${meeting.id}`, {
      method: "PATCH",
      headers: writeHeaders,
      body: JSON.stringify({ status: 'scheduled' })
    });
    return { error: 'Failed to create session' };
  }

  const sessionData = await createRes.json();
  const session = sessionData.session;

  // Set host_is_ai flag on the session
  await fetch(`${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${session.id}`, {
    method: "PATCH",
    headers: writeHeaders,
    body: JSON.stringify({ host_is_ai: true })
  });

  // Update the scheduled meeting with session ID and status
  await fetch(`${supabaseUrl}/rest/v1/scheduled_meetings?id=eq.${meeting.id}`, {
    method: "PATCH",
    headers: writeHeaders,
    body: JSON.stringify({ status: 'started', meeting_session_id: session.id })
  });

  // Post system message announcing the meeting
  const systemMsg = `📋 ${meeting.host} has called a meeting: "${meeting.topic}"${meeting.agenda ? `\nAgenda: ${meeting.agenda}` : ''}\nAttendees: ${attendees.join(', ')}`;
  await fetch(`${supabaseUrl}/rest/v1/meeting_messages`, {
    method: "POST",
    headers: { ...writeHeaders, "Prefer": "return=minimal" },
    body: JSON.stringify({
      meeting_id: session.id,
      speaker: 'System',
      message: systemMsg,
      is_ai: false,
      message_type: 'system',
      created_at: new Date().toISOString()
    })
  });

  return {
    started: true,
    host: meeting.host,
    topic: meeting.topic,
    sessionId: session.id,
    attendees
  };
}

// === CHECK SCHEDULED EVENTS: Fire any that are due ===
async function checkScheduledEvents(supabaseUrl, supabaseKey, siteUrl) {
  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const writeHeaders = { ...readHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" };

  // Check for any scheduled events that are due
  const now = new Date().toISOString();
  console.log(`[scheduled-events] Checking for due events (now=${now})`);
  const schedRes = await fetch(
    `${supabaseUrl}/rest/v1/scheduled_events?status=eq.scheduled&scheduled_time=lte.${now}&order=scheduled_time.asc&limit=3`,
    { headers: readHeaders }
  );

  if (!schedRes.ok) {
    console.log(`[scheduled-events] Query failed: ${schedRes.status} ${schedRes.statusText}`);
    return null;
  }
  const scheduled = await schedRes.json();
  console.log(`[scheduled-events] Found ${Array.isArray(scheduled) ? scheduled.length : 0} due event(s)`);
  if (!Array.isArray(scheduled) || scheduled.length === 0) return null;

  const firedEvents = [];

  // Character mapping for predefined event types (matches admin.html triggerEvent)
  const eventCharacters = {
    'glitter_incident': ['Neiv', 'Kevin'],
    'chaos': ['Neiv', 'Ghost Dad'],
    'donuts_arrived': ['Kevin', 'Ghost Dad'],
    'good_news': ['Kevin', 'Ghost Dad'],
    'printer_mentioned': ['PRNT-Ω', 'Neiv'],
    'fire_drill': ['Neiv', 'Ghost Dad', 'Kevin']
  };

  const eventEmojis = {
    'glitter_incident': '✨',
    'chaos': '🔥',
    'donuts_arrived': '🍩',
    'good_news': '🎉',
    'printer_mentioned': '🖨️',
    'fire_drill': '🚨'
  };

  for (const event of scheduled) {
    try {
      // Atomically claim this event (prevent double-fire from concurrent heartbeats)
      const claimRes = await fetch(
        `${supabaseUrl}/rest/v1/scheduled_events?id=eq.${event.id}&status=eq.scheduled`,
        {
          method: "PATCH",
          headers: { ...writeHeaders, "Prefer": "return=representation" },
          body: JSON.stringify({ status: 'firing' })
        }
      );

      if (!claimRes.ok) continue;
      const claimed = await claimRes.json();
      if (!Array.isArray(claimed) || claimed.length === 0) continue; // Another heartbeat claimed it

      let description = event.description;
      const eventType = event.event_type || 'custom';
      const emoji = eventEmojis[eventType] || '📢';

      // If use_ai_description is set and it's a predefined type, generate AI description
      if (event.use_ai_description && eventType !== 'custom') {
        try {
          const genRes = await fetch(`${siteUrl}/.netlify/functions/admin-data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'generate_event',
              eventType: eventType
            })
          });
          if (genRes.ok) {
            const genData = await genRes.json();
            if (genData.description) {
              description = genData.description;
            }
          }
        } catch (aiErr) {
          console.log(`Scheduled event AI generation failed for ${event.id}, using original text:`, aiErr.message);
        }
      }

      // Post to lobby chat as The Narrator
      const chatContent = `${emoji} *${description}*`;
      await fetch(
        `${supabaseUrl}/rest/v1/messages`,
        {
          method: "POST",
          headers: { ...writeHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            employee: 'The Narrator',
            content: chatContent,
            created_at: new Date().toISOString(),
            is_emote: true
          })
        }
      );

      // Post to Discord
      const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
      if (webhookUrl) {
        fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `${emoji} *${description}*` })
        }).catch(err => console.log("Discord scheduled event post failed:", err.message));
      }

      // If predefined event type, also update character states
      if (eventType !== 'custom' && eventCharacters[eventType]) {
        try {
          await fetch(`${siteUrl}/.netlify/functions/character-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'event',
              eventType: eventType,
              involvedCharacters: eventCharacters[eventType],
              description: description
            })
          });
        } catch (stateErr) {
          console.log(`Scheduled event character-state update failed for ${event.id}:`, stateErr.message);
        }
      }

      // Mark as fired
      await fetch(
        `${supabaseUrl}/rest/v1/scheduled_events?id=eq.${event.id}`,
        {
          method: "PATCH",
          headers: writeHeaders,
          body: JSON.stringify({ status: 'fired', fired_at: new Date().toISOString() })
        }
      );

      firedEvents.push({
        id: event.id,
        description: description,
        eventType: eventType,
        scheduledTime: event.scheduled_time
      });

      console.log(`Heartbeat: Fired scheduled event #${event.id} (${eventType}): "${description.substring(0, 60)}..."`);
    } catch (eventErr) {
      console.error(`Error firing scheduled event #${event.id}:`, eventErr.message);
      // Try to revert status back to scheduled so it can retry
      try {
        await fetch(
          `${supabaseUrl}/rest/v1/scheduled_events?id=eq.${event.id}&status=eq.firing`,
          {
            method: "PATCH",
            headers: writeHeaders,
            body: JSON.stringify({ status: 'scheduled' })
          }
        );
      } catch (revertErr) {
        console.error(`Failed to revert event #${event.id} status:`, revertErr.message);
      }
    }
  }

  if (firedEvents.length === 0) return null;

  return {
    fired: true,
    events: firedEvents
  };
}
