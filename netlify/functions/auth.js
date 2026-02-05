// AI Lobby Character Authentication
// Simple password-based login for roleplay characters

const crypto = require('crypto');

// Hash function for passwords
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
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
      body: JSON.stringify({ error: "Database not configured" })
    };
  }

  // POST = login attempt
  if (event.httpMethod === "POST") {
    try {
      const { employee, password } = JSON.parse(event.body);

      if (!employee || !password) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing employee or password" })
        };
      }

      const passwordHash = hashPassword(password);

      // Check if credentials match
      const response = await fetch(
        `${supabaseUrl}/rest/v1/character_auth?employee=eq.${encodeURIComponent(employee)}&password_hash=eq.${passwordHash}&select=employee`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      const results = await response.json();

      if (results && results.length > 0) {
        // Login successful!
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            employee: employee,
            message: `Welcome back, ${employee}!`
          })
        };
      } else {
        // Login failed
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({
            success: false,
            error: "Invalid credentials. The building doesn't recognize you."
          })
        };
      }

    } catch (error) {
      console.error("Auth error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Authentication failed" })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: "Method not allowed" })
  };
};
