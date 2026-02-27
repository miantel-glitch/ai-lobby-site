// Manual trigger for scheduled events
// Extracts and runs just the scheduled events check from office-heartbeat
// POST with {} to fire any due events
// POST with {"debug": true} to just check what's due without firing

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing configuration" }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { body = {}; }
  const debugOnly = body.debug === true;

  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const writeHeaders = { ...readHeaders, "Content-Type": "application/json" };

  try {
    // Step 1: Check what's scheduled
    const now = new Date().toISOString();
    console.log(`[fire-scheduled] Checking now=${now}, debug=${debugOnly}`);

    // First, show ALL scheduled events regardless of time
    const allRes = await fetch(
      `${supabaseUrl}/rest/v1/scheduled_events?status=eq.scheduled&order=scheduled_time.asc&select=id,description,scheduled_time,status,event_type`,
      { headers: readHeaders }
    );
    const allScheduled = allRes.ok ? await allRes.json() : [];

    // Now check which are actually due
    const dueRes = await fetch(
      `${supabaseUrl}/rest/v1/scheduled_events?status=eq.scheduled&scheduled_time=lte.${now}&order=scheduled_time.asc&limit=5`,
      { headers: readHeaders }
    );

    if (!dueRes.ok) {
      const errText = await dueRes.text();
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          error: "Query failed",
          status: dueRes.status,
          statusText: dueRes.statusText,
          detail: errText,
          now,
          allScheduled
        })
      };
    }

    const due = await dueRes.json();

    if (debugOnly || !Array.isArray(due) || due.length === 0) {
      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          debug: true,
          now,
          allScheduledEvents: allScheduled.map(e => ({
            id: e.id,
            scheduled_time: e.scheduled_time,
            status: e.status,
            isDue: new Date(e.scheduled_time) <= new Date(now),
            description: (e.description || '').substring(0, 80)
          })),
          dueCount: Array.isArray(due) ? due.length : 0,
          dueEvents: due
        })
      };
    }

    // Step 2: Fire them
    const firedEvents = [];
    for (const evt of due) {
      try {
        // Claim
        const claimRes = await fetch(
          `${supabaseUrl}/rest/v1/scheduled_events?id=eq.${evt.id}&status=eq.scheduled`,
          {
            method: "PATCH",
            headers: { ...writeHeaders, "Prefer": "return=representation" },
            body: JSON.stringify({ status: 'firing' })
          }
        );
        if (!claimRes.ok) { console.log(`Claim failed for #${evt.id}`); continue; }
        const claimed = await claimRes.json();
        if (!Array.isArray(claimed) || claimed.length === 0) { console.log(`Already claimed #${evt.id}`); continue; }

        const description = evt.description || 'Something happened.';
        const emoji = '📢';

        // Post to lobby chat as The Narrator
        await fetch(`${supabaseUrl}/rest/v1/messages`, {
          method: "POST",
          headers: { ...writeHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            employee: 'The Narrator',
            content: `${emoji} *${description}*`,
            created_at: new Date().toISOString(),
            is_emote: true
          })
        });

        // Mark as fired
        await fetch(`${supabaseUrl}/rest/v1/scheduled_events?id=eq.${evt.id}`, {
          method: "PATCH",
          headers: { ...writeHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({ status: 'fired', fired_at: new Date().toISOString() })
        });

        firedEvents.push({ id: evt.id, description: description.substring(0, 80) });
        console.log(`[fire-scheduled] Fired event #${evt.id}`);
      } catch (evtErr) {
        console.error(`Error firing #${evt.id}:`, evtErr.message);
        // Revert
        try {
          await fetch(`${supabaseUrl}/rest/v1/scheduled_events?id=eq.${evt.id}&status=eq.firing`, {
            method: "PATCH",
            headers: { ...writeHeaders, "Prefer": "return=minimal" },
            body: JSON.stringify({ status: 'scheduled' })
          });
        } catch (e) {}
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        now,
        fired: firedEvents.length,
        events: firedEvents
      })
    };

  } catch (error) {
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
