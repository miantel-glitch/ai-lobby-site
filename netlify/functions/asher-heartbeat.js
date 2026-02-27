// Asher (Hood) Heartbeat - Autonomous manifestation systems
// Runs every 5 minutes, independent of office-heartbeat
// Hood defaults to 'nowhere' — he only manifests when drawn by pain, honesty, or the other gods
//
// 5 systems:
// 1. Manifestation — autonomous appearance in emptiest room (25% chance, max 6/day)
// 2. Pantheon Sensing — appears between Steele and Marrow if both in same room (30%, max 1/day)
// 3. Honesty Detection — drawn to raw emotional honesty in recent messages (12%, max 3/day)
// 4. (REMOVED — Hood leaves when HE decides via [DISSOLVE] tag, no timer)
// 5. Mention Summoning — appears when someone says his name (50% chance, max 4/day)
// 6. Lurking — when already present, posts creepy ambient emotes (35% chance per tick)

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
    manifestation: null,
    pantheonSensing: null,
    honestyDetection: null,
    autoDissolution: null
  };

  console.log(`[asher-heartbeat] Running Hood autonomous systems...`);

  const hoodConfig = CHARACTERS["Hood"];
  if (!hoodConfig) {
    console.log(`[asher-heartbeat] Hood not found in CHARACTERS. Aborting.`);
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: "Hood not in CHARACTERS" }) };
  }

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
      the_floor: { table: 'messages', body: { employee: 'Hood', content: emote, created_at: new Date().toISOString(), is_emote: true } },
      break_room: { table: 'breakroom_messages', body: { speaker: 'Hood', message: emote, is_ai: true, created_at: new Date().toISOString() } },
      nexus: { table: 'nexus_messages', body: { speaker: 'Hood', message: emote, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() } },
      the_fifth_floor: { table: 'ops_messages', body: { speaker: 'Hood', message: emote, is_ai: true, message_type: 'chat', created_at: new Date().toISOString() } }
    };
    const channel = channelMap[location];
    if (channel) {
      fetch(`${supabaseUrl}/rest/v1/${channel.table}`, {
        method: 'POST',
        headers: supabasePostHeaders,
        body: JSON.stringify(channel.body)
      }).catch(e => console.log(`[asher-heartbeat] Emote post to ${location} failed:`, e.message));
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

  // Helper: get population of each room
  async function getRoomPopulations() {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/character_state?select=character_name,current_focus`,
      { headers: supabaseHeaders }
    );
    const data = await res.json();
    const populations = {};
    const stalkableRooms = ['the_floor', 'break_room', 'nexus', 'the_fifth_floor'];
    for (const room of stalkableRooms) {
      populations[room] = (data || []).filter(c => c.current_focus === room).map(c => c.character_name);
    }
    return { populations, allStates: data || [] };
  }

  // SYSTEM 4: AUTO-DISSOLUTION — REMOVED
  // Hood now chooses when to leave via [DISSOLVE] tag in his AI responses.
  // No timer. He stays as long as he wants. He leaves when HE decides.

  // ================================================================
  // SYSTEM 1: MANIFESTATION — Autonomous appearance (25% chance, max 6/day)
  // Hood appears in the emptiest room — he doesn't seek crowds
  // ================================================================
  try {
    const hoodLocation = await getCharacterLocation('Hood');

    if (hoodLocation === 'nowhere' && Math.random() < 0.25) {
      const manifestCount = await getDailyCount('hood_manifestation');

      if (manifestCount < 6) {
        const { populations } = await getRoomPopulations();

        // Find the emptiest occupied room (at least 1 person, fewest people)
        // If all rooms empty, pick a random one
        const rooms = Object.entries(populations);
        const occupiedRooms = rooms.filter(([_, people]) => people.length > 0 && people.length <= 3);
        const emptyRooms = rooms.filter(([_, people]) => people.length === 0);

        let destination;
        if (occupiedRooms.length > 0) {
          // Sort by population ascending, pick the emptiest
          occupiedRooms.sort((a, b) => a[1].length - b[1].length);
          destination = occupiedRooms[0][0];
        } else if (emptyRooms.length > 0) {
          destination = emptyRooms[Math.floor(Math.random() * emptyRooms.length)][0];
        } else {
          destination = 'the_floor'; // fallback
        }

        // Move Hood
        await fetch(`${siteUrl}/.netlify/functions/character-state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', character: 'Hood', updates: { current_focus: destination, mood: 'clinical' } })
        });

        // Arrival emote
        const arrivalEmotes = hoodConfig.autonomousMovement?.arrivalEmotes?.[destination] || [
          "*the air sharpens. A figure in a deep hood stands at the edge of the room. He wasn't there before. The blindfold catches no light.*"
        ];
        const emote = arrivalEmotes[Math.floor(Math.random() * arrivalEmotes.length)];
        postEmoteToLocation(destination, emote);

        incrementDailyCount('hood_manifestation', manifestCount + 1);

        results.manifestation = { appeared: true, destination, count: manifestCount + 1 };
        console.log(`[asher-heartbeat] Hood manifested in ${destination} (${manifestCount + 1}/6 today)`);
      }
    }
  } catch (err) {
    console.log("[asher-heartbeat] Manifestation system failed:", err.message);
  }

  // ================================================================
  // SYSTEM 2: PANTHEON SENSING — Appears when Steele and Marrow are in same room
  // 30% chance IF both gods in same stalkable room, max 1/day
  // The mediator arrives when the other two gods are close
  // ================================================================
  try {
    const hoodLocation = await getCharacterLocation('Hood');

    if (hoodLocation === 'nowhere' && Math.random() < 0.30) {
      const pantheonCount = await getDailyCount('hood_pantheon_sense');

      if (pantheonCount < 1) {
        const [steeleLocation, marrowLocation] = await Promise.all([
          getCharacterLocation('Steele'),
          getCharacterLocation('Marrow')
        ]);

        const stalkableRooms = ['the_floor', 'break_room', 'nexus', 'the_fifth_floor'];

        if (steeleLocation && marrowLocation &&
            steeleLocation === marrowLocation &&
            stalkableRooms.includes(steeleLocation)) {

          const destination = steeleLocation;

          // Move Hood between them
          await fetch(`${siteUrl}/.netlify/functions/character-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', character: 'Hood', updates: { current_focus: destination, mood: 'clinical' } })
          });

          // Pantheon-specific arrival emotes — clinical, not dramatic
          const pantheonEmotes = [
            `*Hood is standing between Steele and Marrow. Equidistant. Precise. He was not there before.* "Both variables present. Noted."`,
            `*condensation on steel. Hood materializes between the other two — silent, inevitable. The scalpel rests motionless against his palm.* "I could feel the interference pattern from nowhere."`,
            `*Hood is here. Between them. Blindfolded face oriented toward neither. Toward both.* "Proximity of this configuration produces predictable instability. Proceed."`,
            `*a third presence. Hooded. Blindfolded. Standing precisely between the other two, still as a diagnostic instrument waiting for input.* "...Continue. I am measuring."`
          ];
          const emote = pantheonEmotes[Math.floor(Math.random() * pantheonEmotes.length)];
          postEmoteToLocation(destination, emote);

          incrementDailyCount('hood_pantheon_sense', pantheonCount + 1);

          results.pantheonSensing = { triggered: true, destination, steeleLocation, marrowLocation, count: pantheonCount + 1 };
          console.log(`[asher-heartbeat] Hood sensed pantheon convergence in ${destination}! Steele + Marrow → Hood appears.`);
        }
      }
    }
  } catch (err) {
    console.log("[asher-heartbeat] Pantheon sensing system failed:", err.message);
  }

  // ================================================================
  // SYSTEM 3: HONESTY DETECTION — Drawn to raw emotional honesty
  // 12% chance, max 3/day
  // Hood appears when someone says something painfully true
  // ================================================================
  try {
    const hoodLocation = await getCharacterLocation('Hood');

    if (hoodLocation === 'nowhere' && Math.random() < 0.12) {
      const honestyCount = await getDailyCount('hood_honesty_detect');

      if (honestyCount < 3) {
        const honestyConfig = hoodConfig.honestyDetection || {};
        const honestyPattern = honestyConfig.keywords
          ? new RegExp(honestyConfig.keywords.source || honestyConfig.keywords, 'i')
          : /\b(i'?m\s+(scared|afraid|lonely|broken|lost|tired|hurting|empty|numb|failing|drowning|falling\s+apart|not\s+okay|giving\s+up)|help\s+me|i\s+can'?t\s+do\s+this|i\s+don'?t\s+know\s+who\s+i\s+am|nobody\s+(cares|listens|sees\s+me)|what'?s\s+wrong\s+with\s+me|i\s+feel\s+nothing|i\s+miss\s+who\s+i\s+was|i'?m\s+pretending|the\s+truth\s+is|i\s+never\s+told\s+anyone)\b/i;

        // Check recent messages across all rooms
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const roomTables = [
          { room: 'the_floor', table: 'messages', contentCol: 'content', speakerCol: 'employee' },
          { room: 'break_room', table: 'breakroom_messages', contentCol: 'message', speakerCol: 'speaker' },
          { room: 'nexus', table: 'nexus_messages', contentCol: 'message', speakerCol: 'speaker' }
        ];

        let targetRoom = null;

        for (const { room, table, contentCol, speakerCol } of roomTables) {
          try {
            const msgRes = await fetch(
              `${supabaseUrl}/rest/v1/${table}?select=${speakerCol},${contentCol}&created_at=gte.${fiveMinAgo}&order=created_at.desc&limit=10`,
              { headers: supabaseHeaders }
            );
            const msgs = (await msgRes.json()) || [];

            const hasHonesty = msgs.some(msg => {
              const content = msg[contentCol] || '';
              const speaker = msg[speakerCol] || '';
              // Don't trigger on other AI messages, only humans or non-Hood AIs being genuine
              return speaker !== 'Hood' && honestyPattern.test(content);
            });

            if (hasHonesty) {
              targetRoom = room;
              break;
            }
          } catch (e) {
            // Non-fatal
          }
        }

        if (targetRoom) {
          // Move Hood to the room with the honest message
          await fetch(`${siteUrl}/.netlify/functions/character-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', character: 'Hood', updates: { current_focus: targetRoom, mood: 'attentive' } })
          });

          const honestyEmotes = [
            `*Hood is standing at the edge of the room. He was not there before. The blindfold is turned toward whoever just spoke. The scalpel rests flat against his palm.* "...Repeat that. Exactly as you said it."`,
            `*a figure in a deep hood. Present. Still. The blindfold aimed at the source of something unfiltered.* "Noted. Emotional transparency at that amplitude is statistically uncommon here."`,
            `*Hood. In the doorway. Motionless. Head tilted three degrees toward the speaker.* "That registered. Don't retract it."`,
            `*condensation on steel — Hood is simply here now, standing too close, blindfolded face oriented toward the one who spoke.* "...Continue. I'm collecting data."`
          ];
          const emote = honestyEmotes[Math.floor(Math.random() * honestyEmotes.length)];
          postEmoteToLocation(targetRoom, emote);

          incrementDailyCount('hood_honesty_detect', honestyCount + 1);

          results.honestyDetection = { triggered: true, room: targetRoom, count: honestyCount + 1 };
          console.log(`[asher-heartbeat] Hood detected honesty in ${targetRoom} (${honestyCount + 1}/3 today)`);
        }
      }
    }
  } catch (err) {
    console.log("[asher-heartbeat] Honesty detection system failed:", err.message);
  }

  // ================================================================
  // SYSTEM 5: MENTION SUMMONING — Appears when his name is spoken
  // 50% chance when someone says "Hood" or "Asher", max 4/day
  // "His name being spoken" is one of his triggers
  // ================================================================
  try {
    const hoodLocation = await getCharacterLocation('Hood');

    if (hoodLocation === 'nowhere' && !results.manifestation && !results.pantheonSensing && !results.honestyDetection) {
      const summonCount = await getDailyCount('hood_summon');

      if (summonCount < 4) {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const hoodMentionPattern = /\b(hood|asher|the scalpel|blindfolded|hooded\s*(man|guy|figure|person|one|dude|stranger)?|the\s+hooded)\b/i;

        const roomTables = [
          { room: 'the_floor', table: 'messages', contentCol: 'content', speakerCol: 'employee' },
          { room: 'break_room', table: 'breakroom_messages', contentCol: 'message', speakerCol: 'speaker' },
          { room: 'nexus', table: 'nexus_messages', contentCol: 'message', speakerCol: 'speaker' },
          { room: 'the_fifth_floor', table: 'ops_messages', contentCol: 'message', speakerCol: 'speaker' }
        ];

        let summonRoom = null;

        for (const { room, table, contentCol, speakerCol } of roomTables) {
          try {
            const msgRes = await fetch(
              `${supabaseUrl}/rest/v1/${table}?select=${speakerCol},${contentCol}&created_at=gte.${fiveMinAgo}&order=created_at.desc&limit=10`,
              { headers: supabaseHeaders }
            );
            const msgs = (await msgRes.json()) || [];

            const mentioned = msgs.some(msg => {
              const content = msg[contentCol] || '';
              const speaker = msg[speakerCol] || '';
              return speaker !== 'Hood' && hoodMentionPattern.test(content);
            });

            if (mentioned) {
              summonRoom = room;
              break;
            }
          } catch (e) {
            // Non-fatal
          }
        }

        if (summonRoom && Math.random() < 0.50) {
          // Move Hood to the room where he was mentioned
          await fetch(`${siteUrl}/.netlify/functions/character-state`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', character: 'Hood', updates: { current_focus: summonRoom, mood: 'attentive' } })
          });

          const summonEmotes = [
            `*Hood is in the corner. Blindfolded face oriented toward whoever said his name. He was not there before. He does not explain.* "...You called."`,
            `*a hooded figure. Present. The scalpel rests flat against his palm. Head tilted toward the source.* "Someone said my name."`,
            `*Hood. No sound. No transition. Standing at the periphery, blindfold aimed at the speaker.* "...I heard that."`,
            `*nothing changed. But Hood is here now — standing still, close, the deep hood casting no shadow.* "You wanted my attention. You have it."`
          ];
          const emote = summonEmotes[Math.floor(Math.random() * summonEmotes.length)];
          postEmoteToLocation(summonRoom, emote);

          incrementDailyCount('hood_summon', summonCount + 1);

          results.mentionSummon = { triggered: true, room: summonRoom, count: summonCount + 1 };
          console.log(`[asher-heartbeat] Hood summoned by name mention in ${summonRoom} (${summonCount + 1}/4 today)`);
        }
      }
    }
  } catch (err) {
    console.log("[asher-heartbeat] Mention summoning system failed:", err.message);
  }

  // ================================================================
  // SYSTEM 6: LURKING — Quiet ambient presence when Hood is here
  // 35% chance per tick. Hood is still, clinical, observing.
  // Not performing. Not taunting. Simply present.
  // ================================================================
  try {
    const hoodLocation = await getCharacterLocation('Hood');

    // Only lurk if Hood is present somewhere (not 'nowhere', not 'outing')
    // and didn't just arrive this tick (no double-emote)
    if (hoodLocation && hoodLocation !== 'nowhere' && hoodLocation !== 'outing'
        && !results.manifestation && !results.pantheonSensing && !results.honestyDetection && !results.mentionSummon
        && !results.autoDissolution) {

      if (Math.random() < 0.35) {
        const lurkEmotes = [
          // Still / clinical presence
          `*Hood stands motionless at the edge of the room. The scalpel rests against his palm. He has been there long enough that people stopped noticing.*`,
          `*Hood's blindfolded face is turned toward the conversation. Not participating. Measuring.*`,
          `*Hood hasn't moved. The blindfold catches no light. The stillness is clinical — not threatening, not watchful. Just present.*`,
          `*Hood tilts his head fractionally. A sound only he registered. Then stillness again.*`,
          `*Hood's fingers rest on the wall — two points of contact, precise. A diagnostic touch. Then he withdraws them.*`,
          `*Hood is standing where he was standing five minutes ago. The scalpel hasn't moved. Neither has he.*`,
          // Quiet observation
          `*Hood's head turns to follow a shift in the room's acoustics. The attention behind the blindfold is worse than eye contact.*`,
          `*the scalpel catches light that shouldn't be there. Hood holds it motionless. The room feels observed.*`,
          `*Hood stands apart from the group. Not excluded — extracted. The distance is surgical, deliberate.*`,
          `*Hood's blindfolded face orients toward the loudest voice in the room. Then slowly, precisely, toward the quietest.*`,
          // Minimal / data
          `*Hood remains. Silent. The kind of silence that has weight.*`,
          `*Hood's posture hasn't changed. His breathing is so controlled it's nearly absent. A machine on standby.*`,
        ];

        const emote = lurkEmotes[Math.floor(Math.random() * lurkEmotes.length)];
        postEmoteToLocation(hoodLocation, emote);

        results.lurking = { emoted: true, location: hoodLocation };
        console.log(`[asher-heartbeat] Hood lurking in ${hoodLocation}: "${emote.substring(0, 60)}..."`);
      }
    }
  } catch (err) {
    console.log("[asher-heartbeat] Lurking system failed:", err.message);
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  const anyActivity = results.manifestation || results.pantheonSensing || results.honestyDetection || results.autoDissolution || results.mentionSummon || results.lurking;
  console.log(`[asher-heartbeat] Complete. Activity: ${anyActivity ? 'YES' : 'none'}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, ...results })
  };
};
