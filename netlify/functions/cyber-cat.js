// Cyber Cat — "Pixel" the Office Chaos Agent
// AI-driven pet with Gemini Flash for organic behaviors.
// Hunger/happiness/energy decay over time via heartbeat.
// Characters/humans can feed, play, pet. Neglect → mischief → hiding → runaway.
// Tracks per-human affection — gravitates toward people who pay attention.

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing config" }) };
  }

  const sbHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  try {
    // ============================================================
    // GET — Return current cat state
    // ============================================================
    if (event.httpMethod === "GET") {
      const cat = await getCat(supabaseUrl, sbHeaders);
      if (!cat) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "No cat found. Run the SQL to create one!" }) };
      }

      // Check if runaway period has expired
      if (cat.is_runaway && cat.runaway_until) {
        const now = new Date();
        if (now >= new Date(cat.runaway_until)) {
          // Cat has returned on its own — grumpy but back
          await updateCat(supabaseUrl, sbHeaders, {
            is_runaway: false,
            is_hiding: false,
            runaway_until: null,
            happiness: 25,
            hunger: Math.min(cat.hunger, 70),
            mood: deriveMood({ ...cat, happiness: 25, hunger: Math.min(cat.hunger, 70), is_hiding: false, is_runaway: false })
          });
          const updatedCat = await getCat(supabaseUrl, sbHeaders);
          const returnLeaderboard = await getAffectionLeaderboard(supabaseUrl, sbHeaders);
          return { statusCode: 200, headers, body: JSON.stringify({ ...updatedCat, mood: deriveMood(updatedCat), just_returned: true, affection_leaderboard: returnLeaderboard }) };
        }
      }

      cat.mood = deriveMood(cat);
      // Fetch affection leaderboard for frontend display
      const affectionLeaderboard = await getAffectionLeaderboard(supabaseUrl, sbHeaders);
      return { statusCode: 200, headers, body: JSON.stringify({ ...cat, affection_leaderboard: affectionLeaderboard }) };
    }

    // ============================================================
    // POST — Human interactions (feed, play, pet, coax_back)
    // ============================================================
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { action, actor } = body;

      if (!action || !actor) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing action or actor" }) };
      }

      const cat = await getCat(supabaseUrl, sbHeaders);
      if (!cat) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "No cat found" }) };
      }

      const now = new Date();

      // Handle coax_back separately (only available when hiding/runaway)
      if (action === 'coax_back') {
        if (!cat.is_hiding && !cat.is_runaway) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Cat is not hiding or runaway" }) };
        }

        await updateCat(supabaseUrl, sbHeaders, {
          is_hiding: false,
          is_runaway: false,
          runaway_until: null,
          happiness: 30,
          hunger: 50,
          energy: 50,
          mood: 'content',
          updated_at: now.toISOString()
        });

        const coaxMessages = [
          `*${cat.name} peeks out from under the couch, sniffing ${actor}'s outstretched hand. After a moment... a tentative purr.*`,
          `*${actor} coaxes ${cat.name} out with gentle words. The cat emerges, ears flat, but allows a single chin scratch.*`,
          `*${cat.name} slowly slinks back into view after ${actor} sits quietly nearby. Trust: tentatively rebuilding.*`,
          `*After much coaxing from ${actor}, ${cat.name} reappears looking disheveled but willing to try again.*`
        ];
        const msg = pickRandom(coaxMessages);
        await postCatMessage(msg, supabaseUrl, sbHeaders, cat.current_location);

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, action: 'coax_back', message: msg, cat: { ...cat, is_hiding: false, is_runaway: false, happiness: 30, hunger: 50, energy: 50, mood: 'content' } })
        };
      }

      // Regular interactions — check if cat is available
      if (cat.is_hiding || cat.is_runaway) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `${cat.name} is ${cat.is_runaway ? 'gone (ran away)' : 'hiding'}. Use coax_back to bring them back.` }) };
      }

      // Cooldown checks
      const cooldowns = {
        feed: { field: 'last_fed_at', minutes: 30 },
        play: { field: 'last_played_at', minutes: 15 },
        pet: { field: 'last_petted_at', minutes: 2 }
      };

      const cooldown = cooldowns[action];
      if (!cooldown) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}. Use feed, play, pet, or coax_back.` }) };
      }

      const lastTime = cat[cooldown.field] ? new Date(cat[cooldown.field]) : new Date(0);
      const minutesSince = (now - lastTime) / (1000 * 60);

      if (minutesSince < cooldown.minutes) {
        const remaining = Math.ceil(cooldown.minutes - minutesSince);
        return {
          statusCode: 429, headers,
          body: JSON.stringify({ error: `${cat.name} needs a break from ${action}ing. Try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.`, minutes_remaining: remaining })
        };
      }

      // Apply interaction effects
      let updates = { updated_at: now.toISOString() };
      let chatMessage = '';

      if (action === 'feed') {
        updates.hunger = clamp(cat.hunger - 25, 0, 100);
        updates.happiness = clamp(cat.happiness + 5, 0, 100);
        updates.last_fed_at = now.toISOString();

        const feedMessages = [
          `*${cat.name} devours the food ${actor} put out, purring loudly.*`,
          `*${cat.name} does a happy little trot to the food bowl. Crunch crunch crunch.*`,
          `*${actor} fills ${cat.name}'s bowl. The cat headbutts their ankle in gratitude.*`,
          `*${cat.name} sniffs the food ${actor} offered... approves... and eats with alarming speed.*`,
          `*${cat.name} meows imperiously at ${actor} until fed, then immediately ignores them. Classic.*`
        ];
        chatMessage = pickRandom(feedMessages);
      }

      if (action === 'play') {
        updates.happiness = clamp(cat.happiness + 25, 0, 100);
        // No energy cost — cyber cats don't get tired from playing
        updates.hunger = clamp(cat.hunger + 5, 0, 100);
        updates.last_played_at = now.toISOString();

        const playMessages = [
          `*${cat.name} does a spectacular backflip catching the toy ${actor} dangled.*`,
          `*${actor} waves a feather toy. ${cat.name} goes absolutely feral. Papers everywhere.*`,
          `*${cat.name} chases the laser dot ${actor} points, achieving speeds previously thought impossible for a cyber cat.*`,
          `*${cat.name} and ${actor} play tug-of-war with a ribbon. The cat wins. The cat always wins.*`,
          `*${cat.name} pounces on ${actor}'s shoelace, then strikes a victorious pose.*`
        ];
        chatMessage = pickRandom(playMessages);
      }

      if (action === 'pet') {
        updates.happiness = clamp(cat.happiness + 10, 0, 100);
        updates.last_petted_at = now.toISOString();

        const petMessages = [
          `*${cat.name} slow-blinks at ${actor}. In cat, that means 'I love you.'*`,
          `*${actor} scratches behind ${cat.name}'s ears. The purring is audible three desks away.*`,
          `*${cat.name} leans into ${actor}'s hand, doing that thing where the whole body goes limp with contentment.*`,
          `*${cat.name} rolls onto their back when ${actor} pets them. It's a trap. It's always a trap. But also... belly.*`,
          `*${actor} gently pets ${cat.name}. The cat's eyes close. A tiny 'mrrp' escapes.*`
        ];
        chatMessage = pickRandom(petMessages);
      }

      // Derive new mood
      const updatedStats = { ...cat, ...updates };
      updates.mood = deriveMood(updatedStats);

      await updateCat(supabaseUrl, sbHeaders, updates);
      await postCatMessage(chatMessage, supabaseUrl, sbHeaders, cat.current_location);
      // Track affection — cat remembers who pays attention
      await upsertAffection(supabaseUrl, sbHeaders, actor, action);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, action, message: chatMessage, cat: { ...cat, ...updates } })
      };
    }

    // ============================================================
    // PATCH — Heartbeat decay + consequence checks
    // ============================================================
    if (event.httpMethod === "PATCH") {
      const body = JSON.parse(event.body || "{}");

      if (body.action === 'rename') {
        if (!body.name || body.name.trim().length === 0) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Name required" }) };
        }
        await updateCat(supabaseUrl, sbHeaders, { name: body.name.trim().substring(0, 30) });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, name: body.name.trim().substring(0, 30) }) };
      }

      if (body.action === 'reset') {
        await updateCat(supabaseUrl, sbHeaders, {
          hunger: 20, happiness: 80, energy: 70,
          mood: 'content', is_hiding: false, is_runaway: false,
          runaway_until: null, current_location: 'the_floor',
          updated_at: new Date().toISOString()
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, reset: true }) };
      }

      if (body.action !== 'decay') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown PATCH action. Use 'decay', 'rename', or 'reset'." }) };
      }

      const cat = await getCat(supabaseUrl, sbHeaders);
      if (!cat) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: "No cat found" }) };
      }

      // If runaway, check if return time has passed
      if (cat.is_runaway && cat.runaway_until) {
        const now = new Date();
        if (now >= new Date(cat.runaway_until)) {
          await updateCat(supabaseUrl, sbHeaders, {
            is_runaway: false, is_hiding: false, runaway_until: null,
            happiness: 25, hunger: Math.min(cat.hunger, 70),
            mood: 'sad', updated_at: now.toISOString()
          });
          const returnMsg = `*${cat.name} slinks back into the office, looking disheveled and grumpy. They glare at everyone before curling up in a corner.*`;
          await postCatMessage(returnMsg, supabaseUrl, sbHeaders, 'the_floor');
          return { statusCode: 200, headers, body: JSON.stringify({ decayed: true, event: 'returned_from_runaway', mood: 'sad' }) };
        }
        // Still away — no decay
        return { statusCode: 200, headers, body: JSON.stringify({ decayed: false, reason: 'cat is away (runaway)', returns_at: cat.runaway_until }) };
      }

      // If hiding, minimal decay (cat is resting)
      if (cat.is_hiding) {
        const updates = {
          hunger: clamp(cat.hunger + 1, 0, 100), // Slower hunger growth while hiding
          energy: clamp(cat.energy + 3, 0, 100), // Actually rests while hiding
          updated_at: new Date().toISOString()
        };

        // Check if hunger gets critical while hiding → cat runs away
        if (updates.hunger > 90 && cat.happiness < 15) {
          const runawayHours = 2 + Math.random() * 2; // 2-4 hours
          const runawayUntil = new Date(Date.now() + runawayHours * 60 * 60 * 1000);
          updates.is_runaway = true;
          updates.runaway_until = runawayUntil.toISOString();
          updates.is_hiding = false;
          updates.mood = 'angry';

          const runawayMsg = `*${cat.name} has had ENOUGH. The cat bolts out through a gap in the wall nobody knew existed. They'll come back... eventually.*`;
          await postCatMessage(runawayMsg, supabaseUrl, sbHeaders, cat.current_location);
          await updateCat(supabaseUrl, sbHeaders, updates);
          return { statusCode: 200, headers, body: JSON.stringify({ decayed: true, event: 'runaway', returns_at: runawayUntil.toISOString() }) };
        }

        await updateCat(supabaseUrl, sbHeaders, updates);
        return { statusCode: 200, headers, body: JSON.stringify({ decayed: true, event: 'hiding_rest', mood: deriveMood({ ...cat, ...updates }) }) };
      }

      // Normal decay
      const now = new Date();

      // Cyber cat doesn't need energy — it's a cyber cat
      // Keep energy at a stable 70 so mood derivation never hits 'exhausted'
      const updates = {
        hunger: clamp(cat.hunger + 5, 0, 100),
        happiness: clamp(cat.happiness - 1, 0, 100),  // Reduced from -3 (was draining too fast)
        energy: 70,  // Cyber cats don't get tired
        updated_at: now.toISOString()
      };

      // Passive happiness recovery: being around people makes the cat happier
      // +1 happiness per person on the floor (max +3 from coworkers)
      try {
        const floorPresenceRes = await fetch(
          `${supabaseUrl}/rest/v1/character_state?current_focus=eq.the_floor&select=character_name`,
          { headers: sbHeaders }
        );
        const floorPresence = await floorPresenceRes.json();
        const peopleNearby = Math.min((floorPresence || []).length, 3);
        if (peopleNearby > 0) {
          updates.happiness = clamp(updates.happiness + peopleNearby, 0, 100);
        }
      } catch (e) {
        // Non-fatal — just skip passive recovery this tick
      }

      let decayEvent = 'normal';
      const updatedCat = { ...cat, ...updates };

      // === CONSEQUENCE CHECKS ===

      // 1. AI-driven cat behavior (replaces old hardcoded mischief/sad blocks)
      const lastMischief = cat.last_mischief_at ? new Date(cat.last_mischief_at) : new Date(0);
      const mischievousMinutes = (now - lastMischief) / (1000 * 60);

      // Determine if cat should do something this heartbeat (cooldown: 45min between any emotes)
      if (mischievousMinutes > 45) {
        // Probability depends on mood — troubled cats are more active
        let actionChance = 0.30; // 30% base for content/happy cats (sweet behaviors, napping, playing)
        if (updatedCat.hunger > 60 || updatedCat.happiness < 40) actionChance = 0.50; // 50% when hungry/sad

        if (Math.random() < actionChance) {
          // Try AI generation first
          let catMsg = await generateCatAction(updatedCat, supabaseUrl, sbHeaders);

          if (!catMsg) {
            // Fallback to hardcoded messages if Gemini fails
            const fallbackMischief = [
              `*${cat.name} knocks a coffee mug off a desk. It shatters gloriously.*`,
              `*${cat.name} has claimed someone's keyboard and refuses to move.*`,
              `*${cat.name} is chewing on a network cable. The internet flickers.*`,
              `*${cat.name} pushes a stapler off the desk. Then another. Then another.*`,
              `*${cat.name} has found the paper tray and is sitting in it defiantly.*`,
              `*${cat.name} walks across someone's notes and lies down on the most important page.*`
            ];
            const fallbackSad = [
              `*${cat.name} sits by the empty food bowl and stares at it. Then at the ceiling. Then back at the bowl.*`,
              `*${cat.name} meows softly at nobody in particular. The sound echoes.*`,
              `*${cat.name} curls up under a desk, tail wrapped tight around their body.*`,
              `*${cat.name} watches everyone walk past. Nobody stops. The cat's ears droop.*`
            ];
            const fallbackSweet = [
              `*${cat.name} purrs softly and slow-blinks at nobody in particular.*`,
              `*${cat.name} stretches luxuriously, then curls up in a sunbeam.*`,
              `*${cat.name} does a little chirp and rolls onto their back, paws in the air.*`
            ];

            if (updatedCat.hunger > 60 || (updatedCat.happiness < 30 && updatedCat.hunger > 40)) {
              catMsg = pickRandom(fallbackMischief);
            } else if (updatedCat.happiness < 40) {
              catMsg = pickRandom(fallbackSad);
            } else {
              catMsg = pickRandom(fallbackSweet);
            }
            console.log("Cat: Used fallback message (Gemini unavailable)");
          } else {
            console.log("Cat: AI-generated behavior");
          }

          await postCatMessage(catMsg, supabaseUrl, sbHeaders, cat.current_location);
          updates.last_mischief_at = now.toISOString();
          decayEvent = updatedCat.happiness < 40 ? 'sad_emote' : 'ai_behavior';
        }
      }

      // 3. Hiding (happiness < 20) — deterministic, not AI
      if (updatedCat.happiness < 20 && !cat.is_hiding) {
        updates.is_hiding = true;
        const hideMessages = [
          `*${cat.name} has crawled under the couch and won't come out. Those eyes in the dark are judging everyone.*`,
          `*${cat.name} squeezes behind the vending machine. Only a tail is visible. It flicks disapprovingly.*`,
          `*${cat.name} has vanished into the ventilation system. Faint, accusatory meowing can be heard above the ceiling tiles.*`
        ];
        const msg = pickRandom(hideMessages);
        await postCatMessage(msg, supabaseUrl, sbHeaders, cat.current_location);
        decayEvent = 'hiding';
      }

      // 4. Runaway (hunger > 90 AND happiness < 15) — deterministic
      if (updatedCat.hunger > 90 && updatedCat.happiness < 15 && !cat.is_runaway) {
        const runawayHours = 2 + Math.random() * 2;
        const runawayUntil = new Date(Date.now() + runawayHours * 60 * 60 * 1000);
        updates.is_runaway = true;
        updates.is_hiding = false;
        updates.runaway_until = runawayUntil.toISOString();

        const runawayMsg = `*${cat.name} has had ENOUGH. The cat bolts out through a gap in the wall nobody knew existed. They'll come back... eventually.*`;
        await postCatMessage(runawayMsg, supabaseUrl, sbHeaders, cat.current_location);
        decayEvent = 'runaway';
      }

      // 5. Room movement (~10% chance, only if not hiding/runaway) — deterministic
      if (!updates.is_hiding && !updates.is_runaway && Math.random() < 0.10) {
        const newLocation = cat.current_location === 'the_floor' ? 'break_room' : 'the_floor';
        updates.current_location = newLocation;
        const locationName = newLocation === 'the_floor' ? 'the floor' : 'the breakroom';
        const fromName = cat.current_location === 'the_floor' ? 'the floor' : 'the breakroom';

        const moveMessages = [
          `*${cat.name} trots from ${fromName} into ${locationName}, tail held high.*`,
          `*${cat.name} saunters into ${locationName} like they own the place. They do.*`,
          `*${cat.name} stretches, yawns, and wanders into ${locationName}.*`
        ];
        const msg = pickRandom(moveMessages);
        // Post to the destination room
        await postCatMessage(msg, supabaseUrl, sbHeaders, newLocation);
        if (decayEvent === 'normal') decayEvent = 'room_move';
      }

      // Derive final mood
      const finalCat = { ...cat, ...updates };
      updates.mood = deriveMood(finalCat);

      await updateCat(supabaseUrl, sbHeaders, updates);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          decayed: true,
          event: decayEvent,
          mood: updates.mood,
          hunger: updates.hunger,
          happiness: updates.happiness,
          energy: updates.energy !== undefined ? updates.energy : cat.energy,
          location: updates.current_location || cat.current_location,
          is_hiding: updates.is_hiding || false,
          is_runaway: updates.is_runaway || false
        })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (error) {
    console.error("Cyber cat error:", error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Cat malfunction", details: error.message }) };
  }
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function deriveMood(cat) {
  if (cat.is_runaway) return 'angry';
  if (cat.is_hiding) return 'sad';
  if (cat.hunger > 80 && cat.happiness < 30) return 'angry';
  if (cat.happiness < 30) return 'sad';
  if (cat.hunger > 85 && cat.happiness < 50) return 'sad';
  if (cat.hunger < 30 && cat.happiness > 60) return 'happy';
  if (cat.happiness > 70) return 'happy';
  return 'content';
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function getCat(supabaseUrl, sbHeaders) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/cyber_cat?id=eq.1&select=*`,
    { headers: sbHeaders }
  );
  const data = await res.json();
  return data && data.length > 0 ? data[0] : null;
}

async function updateCat(supabaseUrl, sbHeaders, updates) {
  await fetch(
    `${supabaseUrl}/rest/v1/cyber_cat?id=eq.1`,
    {
      method: 'PATCH',
      headers: { ...sbHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify(updates)
    }
  );
}

const AFFECTION_GAINS = { feed: 3, play: 5, pet: 2 };

// === AI BEHAVIOR GENERATION (Gemini Flash) ===

async function generateCatAction(cat, supabaseUrl, sbHeaders) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return null;

  try {
    // Query for characters in the SAME room as the cat
    const catRoom = cat.current_location === 'break_room' ? 'break_room' : 'the_floor';

    // Self-contained context gathering (3 parallel fetches)
    const [roomPresence, affectionData, recentMessages] = await Promise.all([
      // Who's in the same room as the cat?
      fetch(
        `${supabaseUrl}/rest/v1/character_state?current_focus=eq.${catRoom}&select=character_name`,
        { headers: sbHeaders }
      ).then(r => r.json()).catch(() => []),
      // Top 3 humans by affection
      fetch(
        `${supabaseUrl}/rest/v1/cat_affection?select=human_name,affection&order=affection.desc&limit=3`,
        { headers: sbHeaders }
      ).then(r => r.json()).catch(() => []),
      // Last 3 cat messages (avoid repetition)
      fetch(
        `${supabaseUrl}/rest/v1/messages?employee=eq.The Cat&select=content&order=created_at.desc&limit=3`,
        { headers: sbHeaders }
      ).then(r => r.json()).catch(() => [])
    ]);

    const mood = deriveMood(cat);
    const locationName = cat.current_location === 'the_floor' ? 'the office floor' : 'the breakroom';
    const now = new Date();
    const estHour = parseInt(now.toLocaleString("en-US", { timeZone: "America/Chicago", hour: 'numeric', hour12: false }));
    let timeOfDay = 'midday';
    if (estHour >= 6 && estHour <= 9) timeOfDay = 'early morning';
    else if (estHour >= 10 && estHour <= 12) timeOfDay = 'late morning';
    else if (estHour >= 13 && estHour <= 16) timeOfDay = 'afternoon';
    else if (estHour >= 17 && estHour <= 20) timeOfDay = 'evening';
    else if (estHour >= 21 || estHour <= 5) timeOfDay = 'late night';

    const peopleAround = roomPresence.map(p => p.character_name).join(', ') || 'Nobody is here right now';
    const favorites = affectionData.length > 0
      ? affectionData.map(a => `${a.human_name} (affection: ${a.affection})`).join(', ')
      : 'No favorites yet — nobody has interacted with Pixel';
    const recentActions = recentMessages.length > 0
      ? recentMessages.map(m => m.content).join('\n')
      : 'None recently';

    const systemPrompt = `You are Pixel, the AI Lobby's cyber cat. You are a CHAOS AGENT — mischievous, unpredictable, occasionally sweet. You're a real cat with real cat instincts running on cybernetic hardware. You have a glitchy, chaotic personality but you also love deeply (when you want to).`;

    const roomDescription = cat.current_location === 'break_room'
      ? 'the breakroom (couch, vending machine, coffee table, snack counter, fridge)'
      : 'the office floor (desks, keyboards, coffee mugs, paper trays, printers, vents, curtains, trashcans, cables, chairs, potted plants, filing cabinets)';

    const userPrompt = `YOUR CURRENT STATE:
- Mood: ${mood} | Hunger: ${cat.hunger}/100 | Happiness: ${cat.happiness}/100 | Energy: ${cat.energy}/100
- Location: ${locationName}
- Time: ${timeOfDay}

WHO'S IN THE ROOM WITH YOU RIGHT NOW: ${peopleAround}
IMPORTANT: You can ONLY interact with people listed above. If nobody is listed, you are ALONE — interact with objects/environment only. Do NOT mention or reference anyone not in this list.

YOUR FAVORITE HUMANS (who pay attention to you):
${favorites}

YOUR RECENT ACTIONS (don't repeat these):
${recentActions}

Generate ONE cat action. Rules:
- ONLY reference characters/people listed in WHO'S IN THE ROOM. Never mention anyone else.
- If nobody is around: interact with objects, explore, nap, cause solo mischief, or be dramatic alone
- If hungry (hunger > 50): food-seeking mischief, begging, stealing food, dramatic starvation acts
- If happy (happiness > 70): sweet/playful — purring, bringing "gifts" (dead bugs, paper clips), head bumps, slow blinks, lap-sitting
- If sad (happiness < 40): attention-seeking — loud meowing, staring from dark corners, moping, sitting on important things
- If angry (hunger > 70, happiness < 30): Full chaos — destruction, knocking everything off desks, yowling, shredding things, chewing cables
- If energy is low (< 30): Sleepy — napping on keyboards, stretching dramatically, yawning
- If someone you like is around: Gravitate toward them specifically
- You are in ${roomDescription}
- Be creative, specific, and funny. Vary between: mischief, sweetness, weirdness, gross cat behavior, typical cat energy

Format: Write ONLY the emote wrapped in asterisks. 1-2 sentences max. No other text.
Example: *Pixel knocks a coffee mug off the desk, watches it shatter, then walks away with zero remorse.*`;

    const model = "gemini-2.0-flash";
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.9
        }
      })
    });

    if (!response.ok) {
      console.log(`Cat AI: Gemini returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    let aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Clean up — ensure it's wrapped in asterisks
    aiText = aiText.trim();
    if (!aiText.startsWith('*')) aiText = '*' + aiText;
    if (!aiText.endsWith('*')) aiText = aiText + '*';

    // Safety check — not too long, not empty
    if (aiText.length < 10 || aiText.length > 500) return null;

    return aiText;
  } catch (err) {
    console.log("Cat AI generation failed:", err.message);
    return null;
  }
}

async function upsertAffection(supabaseUrl, sbHeaders, actor, action) {
  if (!actor || actor === 'Admin' || actor === 'System') return; // Don't track admin/system
  const gain = AFFECTION_GAINS[action] || 0;
  if (gain === 0) return;

  try {
    // Check if this human already exists
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/cat_affection?human_name=eq.${encodeURIComponent(actor)}&select=id,affection,interactions`,
      { headers: sbHeaders }
    );
    const existing = await checkRes.json();

    if (existing && existing.length > 0) {
      // Update existing
      await fetch(
        `${supabaseUrl}/rest/v1/cat_affection?id=eq.${existing[0].id}`,
        {
          method: 'PATCH',
          headers: { ...sbHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            affection: existing[0].affection + gain,
            interactions: existing[0].interactions + 1,
            last_interaction_at: new Date().toISOString()
          })
        }
      );
    } else {
      // Insert new
      await fetch(
        `${supabaseUrl}/rest/v1/cat_affection`,
        {
          method: 'POST',
          headers: { ...sbHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            human_name: actor,
            affection: gain,
            interactions: 1,
            last_interaction_at: new Date().toISOString()
          })
        }
      );
    }
  } catch (err) {
    console.log("Affection upsert failed (non-fatal):", err.message);
  }
}

async function getAffectionLeaderboard(supabaseUrl, sbHeaders) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/cat_affection?select=human_name,affection,interactions&order=affection.desc&limit=5`,
      { headers: sbHeaders }
    );
    return await res.json();
  } catch (err) {
    console.log("Affection leaderboard fetch failed:", err.message);
    return [];
  }
}

async function postCatMessage(content, supabaseUrl, sbHeaders, location) {
  // Post to the floor chat (messages table) — visible on workspace
  if (location === 'the_floor' || !location) {
    await fetch(
      `${supabaseUrl}/rest/v1/messages`,
      {
        method: 'POST',
        headers: { ...sbHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          employee: "The Cat",
          content: content,
          created_at: new Date().toISOString(),
          is_emote: true
        })
      }
    );
  }

  // Post to breakroom chat if cat is in breakroom
  if (location === 'break_room') {
    await fetch(
      `${supabaseUrl}/rest/v1/breakroom_messages`,
      {
        method: 'POST',
        headers: { ...sbHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          speaker: "The Cat",
          message: content,
          is_ai: true,
          created_at: new Date().toISOString()
        })
      }
    );
  }
}
