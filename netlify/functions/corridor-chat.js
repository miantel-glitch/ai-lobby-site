// Corridor Chat Handler
// Manages party chat messages during corridor adventures

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Validate environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase configuration');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Database not configured' })
    };
  }

  try {
    // GET - Fetch chat messages for a session
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      const sessionId = params.sessionId;
      const limit = parseInt(params.limit) || 50;

      if (!sessionId) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Session ID required' })
        };
      }

      const response = await fetch(
        `${supabaseUrl}/rest/v1/corridor_messages?session_id=eq.${sessionId}&order=created_at.asc&limit=${limit}`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        }
      );

      if (!response.ok) {
        console.error('Failed to fetch messages:', response.status);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to fetch messages' })
        };
      }

      const messages = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ messages })
      };
    }

    // POST - Add a new chat message
    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch (parseError) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid JSON in request body' })
        };
      }

      const { sessionId, sceneId, speaker, message, messageType } = body;

      if (!sessionId || !speaker || !message) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Session ID, speaker, and message required' })
        };
      }

      // Create the message
      const messageData = {
        session_id: sessionId,
        scene_id: sceneId || null,
        speaker,
        message: message.substring(0, 500), // Limit message length
        message_type: messageType || 'chat'
      };

      const response = await fetch(
        `${supabaseUrl}/rest/v1/corridor_messages`,
        {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(messageData)
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to create message:', errorText);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to save message' })
        };
      }

      const created = await response.json();
      const newMessage = created[0];

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: newMessage,
          id: newMessage?.id // Return ID for duplicate prevention
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (error) {
    console.error('Corridor chat error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
