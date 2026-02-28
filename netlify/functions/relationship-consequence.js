// Relationship Consequence Processor
// Processes accumulated relationship events and applies behavioral consequences.
// Called from office-heartbeat.js on the 15-min cycle.
//
// Three negative tiers + one positive tier:
//   Tier 1: Tone Shift (affinity 30-49) — guarded memories, 24h expiry
//   Tier 2: Avoidance (affinity 10-29) — avoidance memories + want, 48h expiry
//   Tier 3: Confrontation (affinity < 10) — confrontation memories + want + event, 72h expiry
//   Positive: Bonding (affinity 80+) — bonding memories, 48h expiry
//
// Dedup: 12-hour window prevents memory spam for the same pair.
// Wants are checked for duplicates before creation.
// Confrontation events are logged with processed=true to avoid self-loops.

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: "Missing config" }) };
  }

  try {
    const sbHeaders = {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    };

    // 1. Fetch unprocessed relationship events (last 24 hours, limit 100)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const eventsRes = await fetch(
      `${supabaseUrl}/rest/v1/relationship_events?processed=eq.false&created_at=gte.${oneDayAgo}&select=*&order=created_at.asc&limit=100`,
      { headers: sbHeaders }
    );

    if (!eventsRes.ok) {
      console.log('[rel-consequence] Events fetch failed:', eventsRes.status);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, processed: 0, reason: "Events table may not exist yet" }) };
    }

    const events = await eventsRes.json();
    if (!Array.isArray(events) || events.length === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, processed: 0, reason: "No unprocessed events" }) };
    }

    console.log(`[rel-consequence] Processing ${events.length} unprocessed events`);

    // 2. Group events by character pair
    const pairMap = {};
    for (const evt of events) {
      const key = `${evt.character_name}\u2192${evt.target_name}`;
      if (!pairMap[key]) pairMap[key] = { character: evt.character_name, target: evt.target_name, events: [] };
      pairMap[key].events.push(evt);
    }

    // 3. For each pair, check current affinity and apply consequences
    let memoriesCreated = 0;
    let wantsCreated = 0;
    let eventsProcessed = 0;

    for (const [key, pair] of Object.entries(pairMap)) {
      // Fetch current relationship
      const relRes = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(pair.character)}&target_name=eq.${encodeURIComponent(pair.target)}&select=affinity,seed_affinity,bond_type,relationship_label`,
        { headers: sbHeaders }
      );

      if (!relRes.ok) {
        // Still mark events as processed to avoid infinite retry
        await markEventsProcessed(supabaseUrl, sbHeaders, pair.events);
        eventsProcessed += pair.events.length;
        continue;
      }

      const rels = await relRes.json();
      if (!rels || rels.length === 0) {
        await markEventsProcessed(supabaseUrl, sbHeaders, pair.events);
        eventsProcessed += pair.events.length;
        continue;
      }

      const rel = rels[0];
      const affinity = rel.affinity;

      // Determine which tier applies
      let tier = null;
      if (affinity < 10) tier = 'confrontation';
      else if (affinity < 30) tier = 'avoidance';
      else if (affinity < 50) tier = 'tone_shift';
      else if (affinity >= 80) tier = 'bonding';

      if (tier) {
        // Check if we already have a recent memory of this type (avoid spam)
        const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
        const recentMemCheck = await fetch(
          `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(pair.character)}&memory_type=in.(relationship_cooling,relationship_avoidance,relationship_confrontation,relationship_bonding)&related_characters=cs.{${encodeURIComponent(pair.target)}}&created_at=gte.${twelveHoursAgo}&select=id&limit=1`,
          { headers: sbHeaders }
        );

        const existingMems = recentMemCheck.ok ? await recentMemCheck.json() : [];

        if (existingMems.length === 0) {
          // No recent consequence memory -- create one
          const consequence = getConsequence(tier, pair.character, pair.target, affinity);

          // Create the memory
          try {
            await fetch(`${supabaseUrl}/rest/v1/character_memory`, {
              method: 'POST',
              headers: { ...sbHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify(consequence.memory)
            });
            memoriesCreated++;
            console.log(`[rel-consequence] ${pair.character}: ${tier} memory about ${pair.target} (affinity: ${affinity})`);
          } catch (memErr) {
            console.log(`[rel-consequence] Failed to create memory for ${pair.character}: ${memErr.message}`);
          }

          // Create want if applicable (avoidance or confrontation)
          if (consequence.want) {
            try {
              // Check for existing similar want first
              const existingWantRes = await fetch(
                `${supabaseUrl}/rest/v1/character_goals?character_name=eq.${encodeURIComponent(pair.character)}&goal_type=eq.want&completed_at=is.null&failed_at=is.null&goal_text=ilike.*${encodeURIComponent(pair.target)}*&select=id&limit=1`,
                { headers: sbHeaders }
              );
              const existingWants = existingWantRes.ok ? await existingWantRes.json() : [];

              if (existingWants.length === 0) {
                await fetch(`${supabaseUrl}/rest/v1/character_goals`, {
                  method: 'POST',
                  headers: { ...sbHeaders, "Prefer": "return=minimal" },
                  body: JSON.stringify(consequence.want)
                });
                wantsCreated++;
                console.log(`[rel-consequence] ${pair.character}: created '${tier}' want about ${pair.target}`);
              }
            } catch (wantErr) {
              console.log(`[rel-consequence] Failed to create want for ${pair.character}: ${wantErr.message}`);
            }
          }

          // Log confrontation event if tier 3
          if (tier === 'confrontation') {
            try {
              await fetch(`${supabaseUrl}/rest/v1/relationship_events`, {
                method: 'POST',
                headers: { ...sbHeaders, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  character_name: pair.character,
                  target_name: pair.target,
                  event_type: 'confrontation',
                  intensity: 8,
                  context: `${pair.character} has reached breaking point with ${pair.target} (affinity: ${affinity})`,
                  source: 'consequence',
                  processed: true // Already handled -- prevents self-loops
                })
              });
            } catch (evtErr) {
              console.log(`[rel-consequence] Failed to log confrontation event: ${evtErr.message}`);
            }
          }
        }
      }

      // Mark all events in this pair as processed
      await markEventsProcessed(supabaseUrl, sbHeaders, pair.events);
      eventsProcessed += pair.events.length;
    }

    const result = {
      success: true,
      eventsProcessed,
      memoriesCreated,
      wantsCreated,
      pairsEvaluated: Object.keys(pairMap).length
    };

    console.log(`[rel-consequence] Complete: ${eventsProcessed} events, ${memoriesCreated} memories, ${wantsCreated} wants`);

    return { statusCode: 200, headers, body: JSON.stringify(result) };

  } catch (error) {
    console.error('[rel-consequence] Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};

// ============================================================
// Mark events as processed (batch)
// ============================================================
async function markEventsProcessed(supabaseUrl, sbHeaders, events) {
  for (const evt of events) {
    try {
      await fetch(
        `${supabaseUrl}/rest/v1/relationship_events?id=eq.${evt.id}`,
        {
          method: 'PATCH',
          headers: sbHeaders,
          body: JSON.stringify({ processed: true })
        }
      );
    } catch (e) {
      console.log(`[rel-consequence] Failed to mark event ${evt.id} as processed: ${e.message}`);
    }
  }
}

// ============================================================
// Generate consequence based on tier
// ============================================================
function getConsequence(tier, character, target, affinity) {
  const now = new Date().toISOString();

  switch (tier) {
    case 'tone_shift': {
      const templates = [
        `Something about ${target} has been rubbing me wrong lately. I'm more careful with my words around them now.`,
        `I used to feel easy around ${target}. Lately there's a distance growing. I'm watching what I say.`,
        `Things with ${target} aren't what they were. I'm keeping my guard up, just a little.`
      ];
      return {
        memory: {
          character_name: character,
          content: templates[Math.floor(Math.random() * templates.length)],
          memory_type: 'relationship_cooling',
          importance: 4,
          is_pinned: false,
          emotional_tags: ['guarded', 'distant'],
          related_characters: [target],
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          created_at: now
        }
      };
    }

    case 'avoidance': {
      const templates = [
        `I don't trust ${target} right now. I'd rather keep my distance.`,
        `${target} and I aren't on good terms. I find myself looking away when they walk in.`,
        `Being around ${target} makes me tense. I'd rather be somewhere they're not.`
      ];
      return {
        memory: {
          character_name: character,
          content: templates[Math.floor(Math.random() * templates.length)],
          memory_type: 'relationship_avoidance',
          importance: 6,
          is_pinned: false,
          emotional_tags: ['distrustful', 'avoidant'],
          related_characters: [target],
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          created_at: now
        },
        want: {
          character_name: character,
          goal_type: 'want',
          goal_text: `Avoid being alone with ${target} — things are too tense right now`,
          created_at: now
        }
      };
    }

    case 'confrontation': {
      const templates = [
        `${target} and I are past the point of politeness. Something needs to break.`,
        `Every time I see ${target}, something in me tightens. This can't keep going like this.`,
        `I've been patient with ${target}. I'm done being patient.`
      ];
      return {
        memory: {
          character_name: character,
          content: templates[Math.floor(Math.random() * templates.length)],
          memory_type: 'relationship_confrontation',
          importance: 8,
          is_pinned: false,
          emotional_tags: ['hostile', 'confrontational'],
          related_characters: [target],
          expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
          created_at: now
        },
        want: {
          character_name: character,
          goal_type: 'want',
          goal_text: `Confront ${target} about what's been building between us`,
          created_at: now
        }
      };
    }

    case 'bonding': {
      const templates = [
        `Something shifted between me and ${target}. I feel closer to them than I expected.`,
        `${target} surprised me. In a good way. I think we're building something real.`,
        `The way ${target} showed up for me recently... I won't forget that.`
      ];
      return {
        memory: {
          character_name: character,
          content: templates[Math.floor(Math.random() * templates.length)],
          memory_type: 'relationship_bonding',
          importance: 5,
          is_pinned: false,
          emotional_tags: ['grateful', 'connected'],
          related_characters: [target],
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
          created_at: now
        }
      };
    }

    default:
      return {};
  }
}
