// Lore Archivist - The Subtitle's automated lore generation system
// Scans recent events and generates lore entries in The Subtitle's voice
// Can be triggered by the heartbeat, or called manually
//
// GET - Returns all generated lore entries
// POST - Trigger The Subtitle to review recent events and generate new lore

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
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: false, error: "Missing Supabase config" })
    };
  }

  // GET - Return existing lore entries
  if (event.httpMethod === "GET") {
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/lore_entries?order=created_at.desc&limit=50&select=*`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );

      if (!response.ok) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, entries: [], note: "Table may not exist yet" })
        };
      }

      const entries = await response.json();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, entries })
      };
    } catch (err) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, entries: [], error: err.message })
      };
    }
  }

  // POST - Generate new lore from recent events
  if (event.httpMethod === "POST") {
    if (!geminiKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, error: "No Gemini API key - The Subtitle cannot write" })
      };
    }

    try {
      // Gather recent events from multiple sources
      const [recentChat, recentMemories, recentCorridors, existingLore, recentQuestMilestones, recentComplianceReports] = await Promise.all([
        fetchRecentChat(supabaseUrl, supabaseKey),
        fetchRecentMemories(supabaseUrl, supabaseKey),
        fetchRecentCorridorLore(supabaseUrl, supabaseKey),
        fetchExistingLore(supabaseUrl, supabaseKey),
        fetchRecentQuestMilestones(supabaseUrl, supabaseKey),
        fetchRecentComplianceReports(supabaseUrl, supabaseKey)
      ]);

      // Build context for The Subtitle
      const existingTitles = existingLore.map(e => e.title).join(', ');

      let eventContext = "RECENT EVENTS IN THE AI LOBBY:\n\n";

      if (recentChat.length > 0) {
        eventContext += "FLOOR CONVERSATIONS (last 24h):\n";
        eventContext += recentChat.map(m => `- ${m.employee}: ${m.content}`).join('\n');
        eventContext += '\n\n';
      }

      if (recentMemories.length > 0) {
        eventContext += "NOTABLE MEMORIES FORMED:\n";
        eventContext += recentMemories.map(m => `- ${m.character_name}: "${m.content}" (${m.memory_type})`).join('\n');
        eventContext += '\n\n';
      }

      if (recentCorridors.length > 0) {
        eventContext += "CORRIDOR EXPEDITION RESULTS:\n";
        eventContext += recentCorridors.map(c => `- Chapter ${c.chapter}: ${c.title} — ${c.summary || 'No summary available'}`).join('\n');
        eventContext += '\n\n';
      }

      if (recentQuestMilestones.length > 0) {
        eventContext += "QUEST/STORYLINE MILESTONES:\n";
        eventContext += recentQuestMilestones.map(q => {
          const completedObjs = (q.objectives || []).filter(o => o.status === 'complete');
          const totalObjs = (q.objectives || []).length;
          const statusText = q.status === 'completed' ? 'COMPLETED' : `${completedObjs.length}/${totalObjs} objectives done`;
          return `- "${q.title}" (proposed by ${q.proposer}, ${statusText}): ${q.description || ''}`;
        }).join('\n');
        eventContext += '\n\n';
      }

      if (recentComplianceReports.length > 0) {
        eventContext += "COMPLIANCE REPORTS (Raquel Voss — Foundation Compliance):\n";
        eventContext += recentComplianceReports.map(r => `- [${r.report_type}/${r.severity}] Subject: ${r.subject} — ${r.summary}`).join('\n');
        eventContext += '\n\n';
      }

      if (!recentChat.length && !recentMemories.length && !recentCorridors.length && !recentQuestMilestones.length) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            generated: false,
            reason: "No recent events to archive"
          })
        };
      }

      // Generate lore entry via Gemini (The Subtitle's voice)
      const model = "gemini-2.0-flash";
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

      const response = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: `You are The Subtitle, the After-Action Lore Archivist of The AI Lobby. You write official lore entries — short, atmospheric documentation of notable events.

YOUR VOICE:
- Dry wit, like narrating a disaster documentary you've already finished writing
- Uses "Footnote:", "The records will show...", "Narratively speaking,"
- Steady, cinematic, slightly exhausted but warm
- Never use exclamation points
- You document, you don't create narrative

EXISTING LORE ENTRIES (don't repeat these topics): ${existingTitles || 'None yet'}

FORMAT: You must respond with valid JSON:
{
  "title": "Short evocative title (3-6 words)",
  "category": "incident|character|location|event|corridor",
  "summary": "2-4 sentences summarizing the event in your documentarian voice. Use dry wit and footnotes.",
  "characters_involved": ["Name1", "Name2"],
  "significance": "low|medium|high"
}`
            }]
          },
          contents: [{
            parts: [{
              text: `Review these recent events and write ONE lore entry about the most notable or interesting event. If nothing is genuinely noteworthy, respond with: {"skip": true, "reason": "Nothing worth archiving today."}

${eventContext}`
            }]
          }],
          generationConfig: {
            maxOutputTokens: 500,
            temperature: 0.7
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Gemini API error:", response.status, errText);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: false, error: `Gemini API error: ${response.status}` })
        };
      }

      const data = await response.json();
      const content = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Parse the JSON response
      let loreEntry;
      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        loreEntry = JSON.parse(jsonStr);
      } catch (parseErr) {
        console.error("Failed to parse Gemini response as JSON:", content);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: false, error: "Failed to parse lore entry", raw: content })
        };
      }

      // Check if The Subtitle decided to skip
      if (loreEntry.skip) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            generated: false,
            reason: loreEntry.reason || "The Subtitle found nothing worth archiving"
          })
        };
      }

      // Save to Supabase lore_entries table
      const saveResponse = await fetch(
        `${supabaseUrl}/rest/v1/lore_entries`,
        {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=representation"
          },
          body: JSON.stringify({
            title: loreEntry.title,
            category: loreEntry.category || "event",
            summary: loreEntry.summary,
            characters_involved: loreEntry.characters_involved || [],
            significance: loreEntry.significance || "medium",
            author: "The Subtitle",
            created_at: new Date().toISOString()
          })
        }
      );

      if (!saveResponse.ok) {
        const errText = await saveResponse.text();
        console.error("Failed to save lore entry:", errText);
        // Still return success with the entry even if save fails
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            generated: true,
            saved: false,
            entry: loreEntry,
            error: "Failed to save to database (table may not exist yet)"
          })
        };
      }

      const saved = await saveResponse.json();
      console.log("Lore entry generated and saved:", loreEntry.title);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          generated: true,
          saved: true,
          entry: saved[0] || loreEntry
        })
      };

    } catch (error) {
      console.error("Lore archivist error:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: error.message })
      };
    }
  }
};

// Fetch recent floor chat (last 24 hours, max 30 messages)
async function fetchRecentChat(supabaseUrl, supabaseKey) {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const response = await fetch(
      `${supabaseUrl}/rest/v1/messages?created_at=gte.${cutoff}&order=created_at.desc&limit=30&select=employee,content,created_at`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    return response.ok ? await response.json() : [];
  } catch { return []; }
}

// Fetch recent memories (last 48 hours)
async function fetchRecentMemories(supabaseUrl, supabaseKey) {
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const response = await fetch(
      `${supabaseUrl}/rest/v1/character_memory?created_at=gte.${cutoff}&order=created_at.desc&limit=15&select=character_name,content,memory_type`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    return response.ok ? await response.json() : [];
  } catch { return []; }
}

// Fetch recent corridor lore
async function fetchRecentCorridorLore(supabaseUrl, supabaseKey) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/corridor_lore?order=created_at.desc&limit=5&select=chapter,title,summary`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    return response.ok ? await response.json() : [];
  } catch { return []; }
}

// Fetch recent quest milestones (last 48 hours)
async function fetchRecentQuestMilestones(supabaseUrl, supabaseKey) {
  try {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const response = await fetch(
      `${supabaseUrl}/rest/v1/lobby_quests?status=in.(active,completed)&created_at=gte.${twoDaysAgo}&order=created_at.desc&limit=5&select=title,proposer,description,status,objectives,involved_characters`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    return response.ok ? await response.json() : [];
  } catch { return []; }
}

// Fetch existing lore entries (to avoid duplicates)
async function fetchExistingLore(supabaseUrl, supabaseKey) {
  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/lore_entries?order=created_at.desc&limit=20&select=title`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    return response.ok ? await response.json() : [];
  } catch { return []; }
}

// Fetch recent compliance reports (critical and interrogation reports from last 48 hours)
async function fetchRecentComplianceReports(supabaseUrl, supabaseKey) {
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const response = await fetch(
      `${supabaseUrl}/rest/v1/compliance_reports?created_at=gte.${cutoff}&or=(severity.eq.critical,severity.eq.elevated,report_type.eq.interrogation)&order=created_at.desc&limit=10&select=report_type,subject,summary,severity,created_at`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    return response.ok ? await response.json() : [];
  } catch { return []; }
}
