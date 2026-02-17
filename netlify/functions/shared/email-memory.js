// Email → Memory Pipeline
// When an AI character receives an email/memo, this creates a memory of it.
// Uses Haiku to summarize the email into a first-person memory.
// Called fire-and-forget from email.js POST handler.

const { getAICharacterNames } = require('./characters');

async function createEmailMemory(emailData, supabaseUrl, supabaseKey) {
  const { from_employee, to_employee, subject, body } = emailData;

  // Determine which AI characters should receive this memory
  // Raquel Voss is excluded — she only has access to floor chat, not email context
  const aiNames = getAICharacterNames().filter(name => name !== 'Raquel Voss');
  const recipients = [];

  if (to_employee === 'All Staff') {
    // All AI characters get the memory (except Raquel)
    recipients.push(...aiNames);
  } else if (aiNames.includes(to_employee)) {
    // Direct recipient is an AI
    recipients.push(to_employee);
  }

  // If the sender is also AI and it's not "All Staff", the sender doesn't need a memory
  // (they already know what they wrote)
  // But for "All Staff", even the sender should remember they sent it

  if (recipients.length === 0) {
    console.log(`[email-memory] No AI recipients for email from ${from_employee} to ${to_employee}`);
    return;
  }

  // Use Haiku to summarize the email into a first-person memory for each recipient
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.log('[email-memory] No Anthropic API key, skipping memory creation');
    return;
  }

  for (const recipient of recipients) {
    try {
      // Skip creating memory for sender (they know what they wrote)
      if (recipient === from_employee) continue;

      // Rate limit: max 3 email memories per character per day
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const countResponse = await fetch(
        `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(recipient)}&memory_type=eq.email_received&created_at=gte.${today.toISOString()}&select=id`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      );
      const todaysEmailMemories = await countResponse.json();

      if (Array.isArray(todaysEmailMemories) && todaysEmailMemories.length >= 3) {
        console.log(`[email-memory] ${recipient} already has 3 email memories today, skipping`);
        continue;
      }

      // Ask Haiku to create a first-person memory summary
      const summaryPrompt = `You are ${recipient}. You just received an internal memo/email at work.

FROM: ${from_employee}
TO: ${to_employee}
SUBJECT: ${subject}
BODY: ${body}

Summarize this email as a first-person memory in 1-2 sentences. What's the key takeaway you'd remember?
Focus on: who sent it, what they want/said, and how it might affect you.
Write as ${recipient} would think about it.

Example formats:
- "Got a memo from Kevin about the Q3 sprint — he wants everyone in the conference room at 2pm."
- "Asuna sent an all-staff email about Operation Firefly. She's planning something big with Neiv."

Your memory summary (1-2 sentences, first person):`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: 150,
          messages: [{ role: "user", content: summaryPrompt }]
        })
      });

      if (!response.ok) {
        console.log(`[email-memory] Haiku API failed for ${recipient}`);
        continue;
      }

      const data = await response.json();
      const memorySummary = data.content[0]?.text?.trim();

      if (!memorySummary || memorySummary.length < 10) {
        console.log(`[email-memory] Empty/short summary for ${recipient}, skipping`);
        continue;
      }

      // Calculate expiration: email memories last 14 days
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      // Create the memory
      const memoryData = {
        character_name: recipient,
        content: memorySummary,
        memory_type: "email_received",
        importance: 6, // Moderate importance — enough to surface in context
        created_at: now.toISOString(),
        is_pinned: false,
        memory_tier: 'working',
        expires_at: expiresAt.toISOString(),
        emotional_tags: [] // Emails are generally informational
      };

      await fetch(
        `${supabaseUrl}/rest/v1/character_memory`,
        {
          method: "POST",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
          },
          body: JSON.stringify(memoryData)
        }
      );

      console.log(`[email-memory] Created email memory for ${recipient}: "${memorySummary.substring(0, 60)}..."`);

    } catch (err) {
      console.log(`[email-memory] Failed for ${recipient} (non-fatal):`, err.message);
    }
  }
}

module.exports = { createEmailMemory };
