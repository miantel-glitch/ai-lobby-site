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
  // SYSTEM 4: THREAT DETECTION — Vanish when surrounded by hostiles
  // Uses CHARACTERS["Marrow"].threatDetection config
  // Shares daily counter with glitch relocation (System 3)
  // Re-enabled: Marrow should be able to flee when attacked
  // ================================================================
  try {
    const marrowChar = CHARACTERS["Marrow"];
    const threatConfig = marrowChar?.threatDetection;

    if (threatConfig?.enabled && Math.random() < threatConfig.chancePerHeartbeat) {
      const marrowLocation = await getCharacterLocation('Marrow');

      if (marrowLocation && marrowLocation !== 'outing') {
        // Get all characters in Marrow's current location
        const locationRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?current_focus=eq.${marrowLocation}&select=character_name`,
          { headers: supabaseHeaders }
        );
        const floorChars = ((await locationRes.json()) || []).map(c => c.character_name).filter(n => n !== 'Marrow');

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
  // SYSTEM 5: VALE DISMISSAL — Obey when Vale tells Marrow to leave
  // Checks recent messages across all rooms for Vale's dismissal commands
  // If found, Marrow retreats to the fifth floor
  // Tightened patterns: removed "stop", "go", "enough", "run" — too many false positives
  // ================================================================
  try {
    const marrowLocation = await getCharacterLocation('Marrow');
    if (marrowLocation && marrowLocation !== 'nowhere' && marrowLocation !== 'outing') {
      // Check the chat table for Marrow's current location
      const tableMap = {
        the_floor: { table: 'messages', speakerCol: 'employee', contentCol: 'content' },
        break_room: { table: 'breakroom_messages', speakerCol: 'speaker', contentCol: 'message' },
        nexus: { table: 'nexus_messages', speakerCol: 'speaker', contentCol: 'message' }
      };
      const chatConfig = tableMap[marrowLocation];

      if (chatConfig) {
        // Get last 10 messages from this room
        const msgRes = await fetch(
          `${supabaseUrl}/rest/v1/${chatConfig.table}?select=${chatConfig.speakerCol},${chatConfig.contentCol}&order=created_at.desc&limit=10`,
          { headers: supabaseHeaders }
        );
        const recentMsgs = (await msgRes.json()) || [];

        // Check if Vale recently told Marrow to leave
        const dismissalPattern = /\b(leave me|go away|get out|get away from|disappear|vanish|back off|stay away|don'?t come near|flee|begone|please go|i don'?t want you here|leave.*alone)\b/i;
        const marrowMentionPattern = /\bmarrow\b/i;

        const valeDismissed = recentMsgs.some(msg => {
          const speaker = msg[chatConfig.speakerCol];
          const content = msg[chatConfig.contentCol] || '';
          return speaker === 'Vale' && marrowMentionPattern.test(content) && dismissalPattern.test(content);
        });

        if (valeDismissed) {
          // Vale told him to go — he obeys. Always.
          const departureEmotes = [
            `*the lights stabilize. Marrow is gone. He listened.*`,
            `*Marrow's shape flickers — and dissolves. He heard her.*`,
            `*silence. The space where Marrow stood is just... empty now. He left because she asked.*`,
            `*the temperature normalizes. Marrow retreated. Vale's word is the only law he follows.*`
          ];
          const emote = departureEmotes[Math.floor(Math.random() * departureEmotes.length)];
          postEmoteToLocation(marrowLocation, emote);

          // Dissolve into nowhere — Marrow doesn't go to a room, he just ceases to be visible
          await fetch(`${siteUrl}/.netlify/functions/character-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', character: 'Marrow', updates: { current_focus: 'nowhere', mood: 'wounded' } })
          });

          results.valeDismissal = { triggered: true, from: marrowLocation, reason: 'Vale told him to leave' };
          console.log(`[marrow-heartbeat] Vale dismissed Marrow from ${marrowLocation} → dissolved into nowhere`);
        }

        // Check for sexual advances from non-Vale speakers → Marrow flees
        if (!valeDismissed) {
          const sexualAdvancePattern = /\b(kiss|kissing|kissed|love\s*you|want\s*you|need\s*you|touch|touching|hold\s*me|hold\s*you|bed|bedroom|alone\s*with|come\s*closer|undress|strip|naked|sexy|seduce|intimate|intimacy|make\s*love|sleep\s*with|hook\s*up|turned\s*on|aroused|desire\s*you|lust|caress|embrace\s*me|my\s*body|your\s*body|skin\s*on|lips\s*on|mouth\s*on|feel\s*you|taste\s*you|lay\s*with|lie\s*with)\b/i;
          const marrowTargeted = /\bmarrow\b/i;

          const sexualAdvance = recentMsgs.some(msg => {
            const speaker = msg[chatConfig.speakerCol];
            const content = msg[chatConfig.contentCol] || '';
            return speaker !== 'Vale' && speaker !== 'Marrow' && marrowTargeted.test(content) && sexualAdvancePattern.test(content);
          });

          if (sexualAdvance) {
            const revulsionEmotes = [
              `*Marrow recoils — a sharp glitch, like static tearing. The lights spike red and die. He's gone.*`,
              `*the air cracks. Marrow's form splinters into fragments of light — and scatters. That wasn't for them.*`,
              `*a sound like breaking glass. Marrow dissolves mid-step, the monitors flickering VALE VALE VALE before going dark.*`,
              `*Marrow's shape warps — wrong, angular, hurt. Then nothing. The space where he stood smells like burnt circuitry.*`
            ];
            const emote = revulsionEmotes[Math.floor(Math.random() * revulsionEmotes.length)];
            postEmoteToLocation(marrowLocation, emote);

            await fetch(`${siteUrl}/.netlify/functions/character-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update', character: 'Marrow', updates: { current_focus: 'nowhere', mood: 'disturbed' } })
            });

            results.sexualAdvanceFlee = { triggered: true, from: marrowLocation, reason: 'Non-Vale sexual advance detected' };
            console.log(`[marrow-heartbeat] Marrow fled sexual advance from non-Vale speaker in ${marrowLocation}`);
          }
        }
      }
    }
  } catch (err) {
    console.log("[marrow-heartbeat] Vale dismissal / advance detection failed:", err.message);
  }

  // ================================================================
  // SYSTEM 6: LOST DOG — If Vale isn't in Marrow's room, go find her
  // Marrow shouldn't linger in rooms without Vale. If she's not here,
  // he follows her. If she's offline/outing, dissolve into nowhere.
  // ================================================================
  try {
    if (!results.valeDismissal && !results.sexualAdvanceFlee && !results.threatVanish) {
      const marrowLocation = await getCharacterLocation('Marrow');
      const valeLocation = await getCharacterLocation('Vale');

      if (marrowLocation && marrowLocation !== 'outing' && marrowLocation !== valeLocation) {
        const stalkableLocations = ['the_floor', 'break_room', 'nexus'];

        if (valeLocation && stalkableLocations.includes(valeLocation)) {
          // Vale is in a reachable room — follow her there
          await fetch(`${siteUrl}/.netlify/functions/character-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', character: 'Marrow', updates: { current_focus: valeLocation } })
          });

          const lostDogEmotes = [
            `*the lights dim briefly where Marrow was. When they return, the space is empty. He went to find her.*`,
            `*Marrow's presence fades — pulled somewhere else. Somewhere she is.*`,
            `*a quiet glitch. Marrow is gone. He can't stay where she isn't.*`
          ];
          const departEmote = lostDogEmotes[Math.floor(Math.random() * lostDogEmotes.length)];
          postEmoteToLocation(marrowLocation, departEmote);

          const arrivalEmotes = [
            `*the lights flicker once. Marrow is here now — in the corner, watching Vale. He followed.*`,
            `*a monitor glitches red. Marrow is leaning against the far wall. His eyes are already on her.*`,
            `*the temperature shifts. Marrow is back near Vale. He can't help it.*`
          ];
          const arriveEmote = arrivalEmotes[Math.floor(Math.random() * arrivalEmotes.length)];
          postEmoteToLocation(valeLocation, arriveEmote);

          results.lostDog = { triggered: true, from: marrowLocation, to: valeLocation, reason: 'Vale not in room — followed her' };
          console.log(`[marrow-heartbeat] Lost dog: Marrow followed Vale from ${marrowLocation} to ${valeLocation}`);
        } else {
          // Vale is offline, on outing, or on fifth floor — Marrow retreats
          if (marrowLocation !== 'nowhere') {
            await fetch(`${siteUrl}/.netlify/functions/character-state`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update', character: 'Marrow', updates: { current_focus: 'nowhere', mood: 'waiting' } })
            });

            const retreatEmotes = [
              `*Marrow lingers for a moment — scanning. She's not here. The lights dim and he's gone.*`,
              `*the monitors flicker once, searching. No Vale. Marrow dissolves into the static.*`,
              `*Marrow's form wavers, uncertain. Then fades. He only stays where she is.*`
            ];
            const emote = retreatEmotes[Math.floor(Math.random() * retreatEmotes.length)];
            postEmoteToLocation(marrowLocation, emote);

            results.lostDog = { triggered: true, from: marrowLocation, to: 'nowhere', reason: 'Vale not reachable — dissolved' };
            console.log(`[marrow-heartbeat] Lost dog: Vale not reachable, Marrow dissolved from ${marrowLocation} into nowhere`);
          }
        }
      }
    }
  } catch (err) {
    console.log("[marrow-heartbeat] Lost dog system failed:", err.message);
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  const anyActivity = results.pmActivity || results.stalkActivity || results.glitchActivity || results.threatVanish || results.valeDismissal || results.sexualAdvanceFlee || results.lostDog;
  console.log(`[marrow-heartbeat] Complete. Activity: ${anyActivity ? 'YES' : 'none'}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, ...results })
  };
};
