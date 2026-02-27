// AI Lobby Task/Ticket Queue System
// Assign work to each other, track progress

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, PATCH, DELETE, OPTIONS",
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

  // GET = fetch tasks
  if (event.httpMethod === "GET") {
    try {
      // Get all non-archived tasks, ordered by due date then created date
      const response = await fetch(
        `${supabaseUrl}/rest/v1/tasks?select=id,title,description,assigned_to,created_by,due_date,status,created_at&status=neq.archived&order=due_date.asc.nullslast,created_at.desc`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      const tasks = await response.json();

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ tasks: tasks || [] })
      };
    } catch (error) {
      console.error("Fetch tasks error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch tasks" })
      };
    }
  }

  // POST = create a new task
  if (event.httpMethod === "POST") {
    try {
      const { title, description, assigned_to, created_by, due_date, silent } = JSON.parse(event.body);

      if (!title || !assigned_to || !created_by) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing required fields (title, assigned_to, created_by)" })
        };
      }

      // Sanitize inputs
      const sanitizedTitle = title.slice(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const sanitizedDesc = description ? description.slice(0, 1000).replace(/</g, "&lt;").replace(/>/g, "&gt;") : null;

      const now = new Date();

      // Save to Supabase
      const taskData = {
        title: sanitizedTitle,
        description: sanitizedDesc,
        assigned_to,
        created_by,
        due_date: due_date || null,
        status: "open",
        created_at: now.toISOString()
      };

      const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/tasks`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=representation"
        },
        body: JSON.stringify(taskData)
      });

      if (!supabaseResponse.ok) {
        throw new Error("Failed to create task");
      }

      const savedTask = await supabaseResponse.json();

      // Post to Discord (unless silent mode)
      const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;

      if (webhookUrl && !silent) {
        const employeeFlair = {
          "Kevin": "✨", "Asuna": "👁️", "Vale": "📖", "Neiv": "📊",
          "Ghost Dad": "👻"
        };

        const headshots = {
          "Kevin": "https://ai-lobby.netlify.app/images/Kevin_Headshot.png",
          "Asuna": "https://ai-lobby.netlify.app/images/Asuna_Headshot.png",
          "Vale": "https://ai-lobby.netlify.app/images/Vale_Headshot.png",
          "Neiv": "https://ai-lobby.netlify.app/images/Neiv_Headshot.png",
          "Ghost Dad": "https://ai-lobby.netlify.app/images/Ghost_Dad_Headshot.png",
        };

        const assignedEmoji = employeeFlair[assigned_to] || "👤";
        const creatorEmoji = employeeFlair[created_by] || "👤";
        const dueDateStr = due_date ? `\n**Due:** ${new Date(due_date).toLocaleDateString()}` : "";

        await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [{
              author: {
                name: "🎫 NEW TASK ASSIGNED",
                icon_url: headshots[created_by]
              },
              title: sanitizedTitle,
              description: `**Assigned to:** ${assignedEmoji} ${assigned_to}\n**Created by:** ${creatorEmoji} ${created_by}${dueDateStr}${sanitizedDesc ? `\n\n${sanitizedDesc}` : ""}`,
              color: 3447003,
              thumbnail: { url: headshots[assigned_to] },
              footer: { text: "via Task Queue" }
            }]
          })
        });
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          task: savedTask[0]
        })
      };

    } catch (error) {
      console.error("Task create error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to create task" })
      };
    }
  }

  // PATCH = update task
  if (event.httpMethod === "PATCH") {
    try {
      const { id, status, assigned_to, title, due_date } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing task id" })
        };
      }

      const updateData = {};
      if (status) updateData.status = status;
      if (assigned_to) updateData.assigned_to = assigned_to;
      if (title) updateData.title = title.slice(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;");
      if (due_date !== undefined) updateData.due_date = due_date || null;

      if (Object.keys(updateData).length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Nothing to update" })
        };
      }

      await fetch(`${supabaseUrl}/rest/v1/tasks?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(updateData)
      });

      // Post completion to Discord if marked complete
      if (status === "complete") {
        const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
        if (webhookUrl) {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              embeds: [{
                author: { name: "✅ TASK COMPLETED" },
                description: `Task #${id} has been marked as complete!`,
                color: 3066993
              }]
            })
          });
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };

    } catch (error) {
      console.error("Task update error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to update task" })
      };
    }
  }

  // DELETE = archive/remove task
  if (event.httpMethod === "DELETE") {
    try {
      const { id } = JSON.parse(event.body);

      if (!id) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Missing task id" })
        };
      }

      // We'll set status to 'archived' instead of deleting
      await fetch(`${supabaseUrl}/rest/v1/tasks?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status: "archived" })
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };

    } catch (error) {
      console.error("Task delete error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to delete task" })
      };
    }
  }

  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: "Method not allowed" })
  };
};
