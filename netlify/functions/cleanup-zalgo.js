// Cleanup Zalgo - Find and clean up Zalgo text (corrupted Unicode) from messages
// One-time admin use

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

    // Fetch all PRNT-Ω messages
    const messagesRes = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=id,employee,content,created_at&employee=eq.PRNT-Ω&order=created_at.desc&limit=50`,
      { headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` } }
    );

    if (!messagesRes.ok) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch messages" })
      };
    }

    const messages = await messagesRes.json();

    // Find messages with Zalgo text (lots of combining characters)
    // Zalgo text uses Unicode combining diacritical marks (U+0300 - U+036F)
    const zalgoPattern = /[\u0300-\u036f]{2,}/g;

    const zalgoMessages = messages.filter(m => zalgoPattern.test(m.content));

    if (event.httpMethod === "GET") {
      // Just report what we found
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          found: zalgoMessages.length,
          messages: zalgoMessages.map(m => ({
            id: m.id,
            content: m.content.substring(0, 100) + (m.content.length > 100 ? '...' : ''),
            created_at: m.created_at
          }))
        })
      };
    }

    if (event.httpMethod === "POST") {
      // Clean up the Zalgo text
      const cleaned = [];

      for (const msg of zalgoMessages) {
        // Remove all combining diacritical marks
        const cleanContent = msg.content.replace(/[\u0300-\u036f]/g, '');

        // Update the message
        const updateRes = await fetch(
          `${supabaseUrl}/rest/v1/messages?id=eq.${msg.id}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({ content: cleanContent })
          }
        );

        if (updateRes.ok) {
          cleaned.push({
            id: msg.id,
            before: msg.content.substring(0, 50),
            after: cleanContent.substring(0, 50)
          });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          cleaned: cleaned.length,
          results: cleaned
        })
      };
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  } catch (error) {
    console.error("Cleanup Zalgo error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to process request" })
    };
  }
};
