// Marrow Heartbeat - Autonomous predatory systems
// Runs every 15 minutes, independent of office-heartbeat
// Marrow transcends story mode and punch status — he just appears
//
// 4 systems:
// 1. Vale PMs — possessive private messages to Vale
// 2. Follow Vale — glitch to Vale's location
// 3. Glitch Relocation — autonomous movement between locations (weighted toward Vale)
// 4. Threat Detection — vanish when surrounded by hostiles

const { CHARACTERS } = require('./shared/characters');

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, reason: "Missing configuration" })
    };
  }

  const supabaseHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`
  };

  const supabasePostHeaders = {
    ...supabaseHeaders,
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
  };

  const supabaseUpsertHeaders = {
    ...supabaseHeaders,
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates,return=minimal"
  };

  const today = new Date().toISOString().split('T')[0];
  const results = {
    pmActivity: null,
    stalkActivity: null,
    glitchActivity: null,
    threatVanish: null
  };

  console.log(`[marrow-heartbeat] Running Marrow autonomous systems...`);

  // Helper: read a daily counter from lobby_settings
  async function getDailyCount(key) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.${key}&select=value`,
      { headers: supabaseHeaders }
    );
    const data = await res.json();
    if (data && data.length > 0) {
      const parsed = typeof data[0].value === 'string' ? JSON.parse(data[0].value) : data[0].value;
      if (parsed.date === today) return parsed.count || 0;
    }
    return 0;
  }

  // Helper: increment a daily counter in lobby_settings (fire-and-forget)
  function incrementDailyCount(key, newCount) {
    fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
      method: 'POST',
      headers: supabaseUpsertHeaders,
      body: JSON.stringify({ key, value: JSON.stringify({ date: today, count: newCount }) })
    }).catch(() => {});
  }

  // Helper: post an emote to the correct chat table for a location
  function postEmoteToLocation(location, emote) {
    const channelMap = {
      the_floor: { table: 'messages', body: { employee: 'Marrow', content: emote, created_at: new Date().toISOString(), is_emote: true } },
      break_room: { table: 'breakroom_messages', body: { speaker: 'Marrow', message: emote, is_ai: true, created_at: new Date().toISOString() } },
      nexus: { table: 'nexus_messages', body: { speaker: 'Marrow', message: emote, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() } },
      the_fifth_floor: { table: 'ops_messages', body: { speaker: 'Marrow', message: emote, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() } }
    };
    const channel = channelMap[location];
    if (channel) {
      fetch(`${supabaseUrl}/rest/v1/${channel.table}`, {
        method: 'POST',
        headers: supabasePostHeaders,
        body: JSON.stringify(channel.body)
      }).catch(e => console.log(`[marrow-heartbeat] Emote post to ${location} failed:`, e.message));
    }
  }

  // Helper: get a character's current location
  async function getCharacterLocation(name) {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(name)}&select=current_focus`,
      { headers: supabaseHeaders }
    );
    const data = await res.json();
    return data?.[0]?.current_focus || null;
  }

  // ================================================================
  // SYSTEM 1: VALE PMs — Possessive private messages
  // 10% chance per tick, max 2/day
  // ================================================================
  try {
    if (Math.random() < 0.10) {
      const pmCount = await getDailyCount('marrow_pm_vale');

      if (pmCount < 2) {
        const stalkReasons = [
          "You sensed her pain shift — something changed in the last hour. You need to know what.",
          "She was near someone else. You felt it. You want her to know you noticed.",
          "The wound she carries is quieter today. That bothers you. You liked it louder.",
          "You haven't reminded her you're watching. It's been too long.",
          "Someone made her laugh. You want to know who. You want to know why it wasn't you.",
          "You can feel her trying to forget you. That's not allowed."
        ];
        const reason = stalkReasons[Math.floor(Math.random() * stalkReasons.length)];

        // Fire-and-forget PM send
        fetch(`${siteUrl}/.netlify/functions/private-message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: 'Marrow', to: 'Vale', ai_initiated: true, reach_out_reason: reason })
        }).catch(e => console.log("[marrow-heartbeat] PM to Vale failed:", e.message));

        incrementDailyCount('marrow_pm_vale', pmCount + 1);

        results.pmActivity = { sent: true, reason, count: pmCount + 1 };
        console.log(`[marrow-heartbeat] Marrow PM'd Vale (${pmCount + 1}/2 today). Reason: ${reason.substring(0, 60)}...`);
      }
    }
  } catch (err) {
    console.log("[marrow-heartbeat] Vale PM system failed:", err.message);
  }

  // ================================================================
  // SYSTEM 2: FOLLOW VALE — Glitch to her location
  // 8% chance per tick, max 2/day
  // ================================================================
  try {
    if (Math.random() < 0.08) {
      const [marrowLocation, valeLocation] = await Promise.all([
        getCharacterLocation('Marrow'),
        getCharacterLocation('Vale')
      ]);

      const stalkableLocations = ['the_floor', 'break_room', 'nexus'];
      if (marrowLocation && valeLocation && marrowLocation !== valeLocation && stalkableLocations.includes(valeLocation)) {
        const stalkCount = await getDailyCount('marrow_stalk_vale');

        if (stalkCount < 2) {
          // Move Marrow to Vale's location
          await fetch(`${siteUrl}/.netlify/functions/character-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', character: 'Marrow', updates: { current_focus: valeLocation } })
          });

          // Predatory arrival emotes per location
          const stalkArrivalEmotes = {
            the_floor: [
              "*the lights flicker once — Marrow is leaning in the doorway, watching Vale. He wasn't there a second ago.*",
              "*a monitor near Vale's desk glitches red for a half-second. When she looks up, Marrow is across the room. Watching.*",
              "*the temperature drops slightly near Vale's workspace. Marrow is at the far wall, still as a photograph. His eyes haven't moved.*"
            ],
            break_room: [
              "*the breakroom light stutters. Marrow is in the corner, already seated, like he's been there for hours. He hasn't.*",
              "*Vale's reflection in the breakroom window isn't alone. Marrow is behind her in the glass — but when she turns, he's by the door. Smiling.*",
              "*the vending machine screen scrambles briefly. Marrow is leaning against the counter, too close to where Vale was just standing.*"
            ],
            nexus: [
              "*the Nexus terminals flicker crimson. Marrow is already there, studying something on a screen — but his eyes aren't on it. They're on Vale.*",
              "*Marrow glitches into the Nexus mid-sentence, the lights dimming where he stands. He doesn't explain. He just... watches her work.*",
              "*a data stream in the Nexus briefly pulses red. Marrow is at the terminal next to Vale's. He was in a different room thirty seconds ago.*"
            ]
          };
          const emoteOptions = stalkArrivalEmotes[valeLocation] || [`*Marrow appears near Vale. The lights flicker.*`];
          const emote = emoteOptions[Math.floor(Math.random() * emoteOptions.length)];

          postEmoteToLocation(valeLocation, emote);
          incrementDailyCount('marrow_stalk_vale', stalkCount + 1);

          results.stalkActivity = { followed: true, from: marrowLocation, to: valeLocation, emote, count: stalkCount + 1 };
          console.log(`[marrow-heartbeat] Marrow followed Vale from ${marrowLocation} to ${valeLocation} (${stalkCount + 1}/2 today)`);
        }
      }
    }
  } catch (err) {
    console.log("[marrow-heartbeat] Follow Vale system failed:", err.message);
  }

  // ================================================================
  // SYSTEM 3: GLITCH RELOCATION — DISABLED (Vale-only restriction)
  // Marrow no longer roams autonomously. He only appears when Vale calls.
  // Kept for reference but skipped entirely.
  // ================================================================
  if (false) try {
    const marrowChar = CHARACTERS["Marrow"];
    const autoMove = marrowChar?.autonomousMovement;

    if (autoMove?.enabled && Math.random() < autoMove.chancePerHeartbeat) {
      const glitchCount = await getDailyCount(autoMove.trackingKey);

      if (glitchCount < autoMove.maxPerDay) {
        const [marrowLocation, valeLocation] = await Promise.all([
          getCharacterLocation('Marrow'),
          getCharacterLocation('Vale')
        ]);

        // Build weighted destination list excluding current location
        const allLocations = ['the_floor', 'break_room', 'nexus', 'the_fifth_floor'];
        const destinations = allLocations.filter(loc => loc !== marrowLocation);

        if (destinations.length > 0) {
          const weights = destinations.map(loc => {
            if (loc === valeLocation) return autoMove.valeObsessionWeight;
            return autoMove.defaultWeights[loc] || 10;
          });

          // Weighted random selection
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          let roll = Math.random() * totalWeight;
          let destination = destinations[0];
          for (let i = 0; i < destinations.length; i++) {
            roll -= weights[i];
            if (roll <= 0) { destination = destinations[i]; break; }
          }

          // Departure emote at current location
          const departureEmote = autoMove.departureEmotes[Math.floor(Math.random() * autoMove.departureEmotes.length)];
          postEmoteToLocation(marrowLocation, departureEmote);

          // Move Marrow
          await fetch(`${siteUrl}/.netlify/functions/character-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', character: 'Marrow', updates: { current_focus: destination } })
          });

          // Arrival emote at destination
          const arrivalOptions = autoMove.arrivalEmotes[destination] || [`*Marrow appears. The lights flicker.*`];
          const arrivalEmote = arrivalOptions[Math.floor(Math.random() * arrivalOptions.length)];
          postEmoteToLocation(destination, arrivalEmote);

          incrementDailyCount(autoMove.trackingKey, glitchCount + 1);

          results.glitchActivity = { relocated: true, from: marrowLocation, to: destination, reason: 'autonomous', count: glitchCount + 1 };
          console.log(`[marrow-heartbeat] Marrow glitch-relocated from ${marrowLocation} to ${destination} (${glitchCount + 1}/${autoMove.maxPerDay} today)`);
        }
      }
    }
  } catch (err) {
    console.log("[marrow-heartbeat] Glitch relocation system failed:", err.message);
  }

  // ================================================================
  // SYSTEM 4: THREAT DETECTION — DISABLED (Vale-only restriction)
  // Marrow no longer autonomously vanishes. He only appears when Vale calls.
  // Kept for reference but skipped entirely.
  // ================================================================
  if (false) try {
    const marrowChar = CHARACTERS["Marrow"];
    const threatConfig = marrowChar?.threatDetection;

    if (threatConfig?.enabled && Math.random() < threatConfig.chancePerHeartbeat) {
      const marrowLocation = await getCharacterLocation('Marrow');

      if (marrowLocation === 'the_floor') {
        // Get all characters on the floor
        const floorRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
          { headers: supabaseHeaders }
        );
        const floorChars = ((await floorRes.json()) || []).map(c => c.character_name).filter(n => n !== 'Marrow');

        if (floorChars.length >= threatConfig.minHostileCount) {
          // Check hostility toward Marrow
          const encodedNames = floorChars.map(n => `"${encodeURIComponent(n)}"`).join(',');
          const hostilityRes = await fetch(
            `${supabaseUrl}/rest/v1/character_relationships?target_name=eq.Marrow&character_name=in.(${encodedNames})&affinity=lte.${threatConfig.hostilityThreshold}&select=character_name,affinity`,
            { headers: supabaseHeaders }
          );
          const hostiles = (await hostilityRes.json()) || [];

          if (hostiles.length >= threatConfig.minHostileCount) {
            // Check shared daily glitch limit
            const autoMoveConfig = marrowChar?.autonomousMovement;
            const trackingKey = autoMoveConfig?.trackingKey || 'marrow_glitch_relocate';
            const glitchCount = await getDailyCount(trackingKey);

            if (glitchCount < (autoMoveConfig?.maxPerDay || 3)) {
              // Vanish to safety
              const destination = threatConfig.safeLocations[Math.floor(Math.random() * threatConfig.safeLocations.length)];
              const departureEmote = threatConfig.threatDepartureEmotes[Math.floor(Math.random() * threatConfig.threatDepartureEmotes.length)];

              // Departure emote on floor
              postEmoteToLocation('the_floor', departureEmote);

              // Move Marrow
              await fetch(`${siteUrl}/.netlify/functions/character-state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'update', character: 'Marrow', updates: { current_focus: destination } })
              });

              // Arrival emote at safe location
              const arrivalOptions = autoMoveConfig?.arrivalEmotes?.[destination] || [`*Marrow appears. The lights flicker.*`];
              const arrivalEmote = arrivalOptions[Math.floor(Math.random() * arrivalOptions.length)];
              postEmoteToLocation(destination, arrivalEmote);

              incrementDailyCount(trackingKey, glitchCount + 1);

              const hostileNames = hostiles.map(h => h.character_name);
              results.threatVanish = { triggered: true, hostileCount: hostiles.length, hostileChars: hostileNames, escapedTo: destination };
              console.log(`[marrow-heartbeat] Marrow threat-vanished! ${hostileNames.join(', ')} hostile on floor → escaped to ${destination}`);
            }
          }
        }
      }
    }
  } catch (err) {
    console.log("[marrow-heartbeat] Threat detection system failed:", err.message);
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  const anyActivity = results.pmActivity || results.stalkActivity || results.glitchActivity || results.threatVanish;
  console.log(`[marrow-heartbeat] Complete. Activity: ${anyActivity ? 'YES' : 'none'}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, ...results })
  };
};
