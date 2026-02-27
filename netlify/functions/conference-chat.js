// Conference Chat - Handles shared chat persistence for the conference room
// Uses Supabase conference_messages table and conference_state table

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
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

  try {
    // GET - Load all conference messages AND interview state
    if (event.httpMethod === "GET") {
      // Fetch messages
      const messagesResponse = await fetch(
        `${supabaseUrl}/rest/v1/conference_messages?select=*&order=created_at.asc&limit=100`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      let messages = [];
      if (messagesResponse.ok) {
        messages = await messagesResponse.json();
      }

      // Fetch interview state
      const stateResponse = await fetch(
        `${supabaseUrl}/rest/v1/conference_state?id=eq.1`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      let interviewState = {
        interviewActive: false,
        interviewPanel: [],
        currentTurnIndex: 0
      };

      // Meeting mode state
      let meetingState = {
        mode: 'interview',
        meetingActive: false,
        meetingTopic: '',
        facilitator: null,
        meetingAttendees: []
      };

      if (stateResponse.ok) {
        const stateData = await stateResponse.json();
        if (stateData && stateData.length > 0) {
          interviewState = {
            interviewActive: stateData[0].interview_active || false,
            interviewPanel: stateData[0].interview_panel || [],
            currentTurnIndex: stateData[0].current_turn_index || 0
          };
          // Meeting mode fields
          meetingState = {
            mode: stateData[0].mode || 'interview',
            meetingActive: stateData[0].meeting_active || false,
            meetingTopic: stateData[0].meeting_topic || '',
            facilitator: stateData[0].facilitator || null,
            meetingAttendees: stateData[0].meeting_attendees || []
          };
        }
      }

      // Fetch meeting topics for dropdown
      let meetingTopics = [];
      try {
        const topicsResponse = await fetch(
          `${supabaseUrl}/rest/v1/meeting_topics?is_active=eq.true&select=id,topic,category`,
          {
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`
            }
          }
        );
        if (topicsResponse.ok) {
          meetingTopics = await topicsResponse.json();
        }
      } catch (e) {
        console.log("Could not fetch meeting topics:", e);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          messages: messages || [],
          interviewState,
          meetingState,
          meetingTopics
        })
      };
    }

    // POST - Save a new message
    if (event.httpMethod === "POST") {
      const { type, speaker, text, candidateId, mode } = JSON.parse(event.body || "{}");
      console.log(`📥 Conference POST: type=${type}, speaker=${speaker}, text="${text?.substring(0, 50)}..."`);

      if (!text) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Message text is required" })
        };
      }

      const messageData = {
        type: type || "employee",
        speaker: speaker || null,
        text: text,
        is_candidate: type === "candidate",
        candidate_id: candidateId || null,
        mode: mode || "interview",
        created_at: new Date().toISOString()
      };
      console.log(`📤 Saving to Supabase:`, JSON.stringify(messageData));

      const response = await fetch(`${supabaseUrl}/rest/v1/conference_messages`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(messageData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Failed to save conference message: ${response.status} - ${errorText}`);
        return {
          statusCode: 200,  // Return 200 to not break frontend
          headers,
          body: JSON.stringify({ success: false, error: "Failed to save message", details: errorText })
        };
      }

      const saved = await response.json();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: saved[0] })
      };
    }

    // PUT - Update interview/meeting state
    if (event.httpMethod === "PUT") {
      const {
        interviewActive, interviewPanel, currentTurnIndex,
        mode, meetingActive, meetingTopic, facilitator, meetingAttendees
      } = JSON.parse(event.body || "{}");

      // Atomic upsert state (id=1 is always the current state)
      const stateData = {
        id: 1,
        interview_active: interviewActive,
        interview_panel: interviewPanel,
        current_turn_index: currentTurnIndex,
        mode: mode || 'interview',
        meeting_active: meetingActive || false,
        meeting_topic: meetingTopic || null,
        facilitator: facilitator || null,
        meeting_attendees: meetingAttendees || [],
        updated_at: new Date().toISOString()
      };

      const upsertResponse = await fetch(`${supabaseUrl}/rest/v1/conference_state`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify(stateData)
      });

      if (!upsertResponse.ok) {
        const errorText = await upsertResponse.text();
        console.error("Failed to upsert conference state:", upsertResponse.status, errorText);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    // DELETE - Clear all conference messages (for resetting)
    if (event.httpMethod === "DELETE") {
      // Clear messages
      await fetch(
        `${supabaseUrl}/rest/v1/conference_messages?id=gt.0`,
        {
          method: "DELETE",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      // Also reset interview state
      await fetch(
        `${supabaseUrl}/rest/v1/conference_state?id=eq.1`,
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
        body: JSON.stringify({ success: true, cleared: true })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Conference chat error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error" })
    };
  }
};
