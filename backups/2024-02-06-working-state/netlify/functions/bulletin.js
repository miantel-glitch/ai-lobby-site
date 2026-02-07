// AI Lobby Bulletin Board / Ticker
// CRUD for bulletin items

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
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
      body: JSON.stringify({ error: "Supabase not configured" })
    };
  }

  // GET = fetch bulletin items
  if (event.httpMethod === "GET") {
    try {
      // Get items that haven't expired
      const response = await fetch(
        `${supabaseUrl}/rest/v1/bulletin?select=id,employee,content,priority,created_at&or=(expires_at.is.null,expires_at.gt.${new Date().toISOString()})&order=created_at.desc&limit=20`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      const items = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ items: items || [] })
      };
    } catch (error) {
      console.error("Fetch bulletin error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch bulletin" })
      };
    }
  }

  // POST = add new bulletin item
  if (event.httpMethod === "POST") {
    try {
      const { employee, content, priority, expiresInHours } = JSON.parse(event.body);

      if (!employee || !content) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing employee or content" })
        };
      }

      const sanitizedContent = content.slice(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const now = new Date();

      let expiresAt = null;
      if (expiresInHours && expiresInHours > 0) {
        expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString();
      }

      const response = await fetch(`${supabaseUrl}/rest/v1/bulletin`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify({
          employee: employee,
          content: sanitizedContent,
          priority: priority || "normal",
          created_at: now.toISOString(),
          expires_at: expiresAt
        })
      });

      if (!response.ok) {
        throw new Error("Failed to save bulletin item");
      }

      const saved = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, item: saved[0] })
      };

    } catch (error) {
      console.error("Bulletin post error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to post bulletin item" })
      };
    }
  }

  // DELETE = remove bulletin item
  if (event.httpMethod === "DELETE") {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing item id" })
        };
      }

      await fetch(`${supabaseUrl}/rest/v1/bulletin?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };

    } catch (error) {
      console.error("Bulletin delete error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to delete bulletin item" })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: "Method not allowed" })
  };
};
