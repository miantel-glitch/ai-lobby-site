// Story Mode Toggle
// GET: Returns current story mode status
// POST: Toggles or sets story mode (requires admin)

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
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
      body: JSON.stringify({ error: "Missing configuration" })
    };
  }

  // GET: Return current status
  if (event.httpMethod === "GET") {
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.story_mode&select=value`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      const data = await response.json();
      const enabled = data?.[0]?.value !== 'false'; // Default to true

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ enabled })
      };
    } catch (error) {
      console.error("Story mode GET error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to get story mode status" })
      };
    }
  }

  // POST: Toggle or set story mode
  if (event.httpMethod === "POST") {
    try {
      const { enabled } = JSON.parse(event.body || "{}");

      // Check current value first
      const currentResponse = await fetch(
        `${supabaseUrl}/rest/v1/lobby_settings?key=eq.story_mode&select=value`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      const currentData = await currentResponse.json();
      const currentValue = currentData?.[0]?.value !== 'false';

      // Determine new value (toggle if not specified, or use provided value)
      const newValue = enabled !== undefined ? enabled : !currentValue;

      if (currentData && currentData.length > 0) {
        // Update existing record
        await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings?key=eq.story_mode`,
          {
            method: "PATCH",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ value: String(newValue) })
          }
        );
      } else {
        // Insert new record
        await fetch(
          `${supabaseUrl}/rest/v1/lobby_settings`,
          {
            method: "POST",
            headers: {
              "apikey": supabaseKey,
              "Authorization": `Bearer ${supabaseKey}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ key: "story_mode", value: String(newValue) })
          }
        );
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, enabled: newValue })
      };
    } catch (error) {
      console.error("Story mode POST error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to update story mode" })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: "Method not allowed" })
  };
};
