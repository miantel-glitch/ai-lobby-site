// One-time backfill: Create email memories for all existing emails
// Hit this endpoint once to process historical emails through the memory pipeline
// GET /.netlify/functions/email-backfill
//
// After running, you can delete this file — it's not needed for ongoing operation.

const { createEmailMemory } = require('./shared/email-memory');

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "GET only" }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Database not configured" }) };
  }

  try {
    // Fetch ALL emails
    const response = await fetch(
      `${supabaseUrl}/rest/v1/emails?select=id,from_employee,to_employee,subject,body,created_at&order=created_at.asc`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    const emails = await response.json();
    if (!Array.isArray(emails)) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to fetch emails" }) };
    }

    console.log(`[email-backfill] Found ${emails.length} emails to process`);

    const results = [];

    for (const email of emails) {
      try {
        console.log(`[email-backfill] Processing email #${email.id}: "${email.subject}" (${email.from_employee} → ${email.to_employee})`);

        await createEmailMemory(
          {
            from_employee: email.from_employee,
            to_employee: email.to_employee,
            subject: email.subject,
            body: email.body
          },
          supabaseUrl,
          supabaseKey
        );

        results.push({ id: email.id, subject: email.subject, status: 'processed' });

        // Small delay between emails to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (err) {
        console.log(`[email-backfill] Failed on email #${email.id}:`, err.message);
        results.push({ id: email.id, subject: email.subject, status: 'failed', error: err.message });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        totalEmails: emails.length,
        results
      })
    };

  } catch (error) {
    console.error("[email-backfill] Error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
