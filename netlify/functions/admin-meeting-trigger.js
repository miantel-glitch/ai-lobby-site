// Admin Meeting Trigger
// Instantly starts an AI-hosted meeting without waiting for heartbeat.
// POST with: { host, topic, agenda?, attendees[] }
// Or GET with no body to start any pending scheduled_meetings immediately.

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";
  const readHeaders = { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` };
  const writeHeaders = { ...readHeaders, "Content-Type": "application/json", "Prefer": "return=minimal" };

  try {
    let host, topic, agenda, attendees;

    if (event.httpMethod === "POST" && event.body) {
      // Direct meeting creation from admin
      const body = JSON.parse(event.body);
      host = body.host;
      topic = body.topic;
      agenda = body.agenda || '';
      attendees = body.attendees || [];

      if (!host || !topic || attendees.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Need host, topic, and attendees" }) };
      }
    } else {
      // GET: grab the next pending scheduled meeting
      const schedRes = await fetch(
        `${supabaseUrl}/rest/v1/scheduled_meetings?status=eq.scheduled&order=scheduled_time.asc&limit=1`,
        { headers: readHeaders }
      );
      if (!schedRes.ok) return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to fetch scheduled meetings" }) };
      const scheduled = await schedRes.json();
      if (!Array.isArray(scheduled) || scheduled.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ message: "No scheduled meetings pending" }) };
      }

      const meeting = scheduled[0];
      host = meeting.host;
      topic = meeting.topic;
      agenda = meeting.agenda || '';
      attendees = meeting.invited_attendees || [];

      // Mark as starting
      await fetch(`${supabaseUrl}/rest/v1/scheduled_meetings?id=eq.${meeting.id}`, {
        method: "PATCH",
        headers: { ...writeHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: 'starting' })
      });
    }

    // Check for existing active meeting
    const activeRes = await fetch(
      `${supabaseUrl}/rest/v1/meeting_sessions?status=eq.active&limit=1`,
      { headers: readHeaders }
    );
    const activeSessions = activeRes.ok ? await activeRes.json() : [];
    if (Array.isArray(activeSessions) && activeSessions.length > 0) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: "Another meeting is already active", activeSession: activeSessions[0].id }) };
    }

    // Get previous locations for all attendees
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

    // Create the meeting session
    const createRes = await fetch(`${siteUrl}/.netlify/functions/meeting-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create_session',
        topic,
        agenda,
        calledBy: host,
        attendees,
        previousLocations,
        hostIsAI: true
      })
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to create session", detail: errText }) };
    }

    const sessionData = await createRes.json();
    const session = sessionData.session;

    // Set host_is_ai flag
    await fetch(`${supabaseUrl}/rest/v1/meeting_sessions?id=eq.${session.id}`, {
      method: "PATCH",
      headers: writeHeaders,
      body: JSON.stringify({ host_is_ai: true })
    });

    // Post system message
    const systemMsg = `📋 ${host} has called a meeting: "${topic}"${agenda ? `\nAgenda: ${agenda}` : ''}\nAttendees: ${attendees.join(', ')}`;
    await fetch(`${supabaseUrl}/rest/v1/meeting_messages`, {
      method: "POST",
      headers: { ...writeHeaders, "Prefer": "return=minimal" },
      body: JSON.stringify({
        session_id: session.id,
        speaker: 'System',
        message: systemMsg,
        message_type: 'system'
      })
    });

    // Update any matching scheduled_meetings record
    await fetch(`${supabaseUrl}/rest/v1/scheduled_meetings?host=eq.${encodeURIComponent(host)}&status=in.(scheduled,starting)`, {
      method: "PATCH",
      headers: writeHeaders,
      body: JSON.stringify({ status: 'started', meeting_session_id: session.id })
    });

    console.log(`[admin-meeting-trigger] Started meeting: "${topic}" hosted by ${host} with ${attendees.length} attendees`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Meeting started! "${topic}" hosted by ${host}`,
        sessionId: session.id,
        attendees,
        note: "AI host will begin driving conversation on next heartbeat via meeting-host-tick. Humans can join from the Meeting Room page."
      })
    };

  } catch (error) {
    console.error("[admin-meeting-trigger] Error:", error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
