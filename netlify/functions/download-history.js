// Download History - Returns chat messages and emails from the last 24 hours
// This runs server-side so Supabase credentials stay secure

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Missing Supabase configuration" })
      };
    }

    // Get timestamp for 24 hours ago
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Fetch messages from last 24 hours
    const messagesRes = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,content,created_at,is_emote&created_at=gte.${yesterday}&order=created_at.asc`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!messagesRes.ok) {
      console.error('Messages fetch failed:', messagesRes.status);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch messages" })
      };
    }

    const messages = await messagesRes.json();

    // Fetch emails from last 24 hours
    const emailsRes = await fetch(
      `${supabaseUrl}/rest/v1/emails?select=from_employee,to_employee,subject,body,created_at&created_at=gte.${yesterday}&order=created_at.asc`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!emailsRes.ok) {
      console.error('Emails fetch failed:', emailsRes.status);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch emails" })
      };
    }

    const emails = await emailsRes.json();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        messages: Array.isArray(messages) ? messages : [],
        emails: Array.isArray(emails) ? emails : [],
        timeRange: {
          from: yesterday,
          to: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error("Download history error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to fetch history" })
    };
  }
};
