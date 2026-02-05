// AI Interview - Handles interview conversations with job candidates
// Each candidate has their own personality and responds in character

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const { candidate, question, chatHistory, interviewer, postOnly, message, speaker, role, candidateId } = JSON.parse(event.body || "{}");

    // Handle postOnly requests (just post to Discord, no AI response)
    if (postOnly) {
      await postToDiscord(message, speaker, role, candidateId);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, posted: true })
      };
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!anthropicKey) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing API configuration" })
      };
    }

    if (!candidate || !question) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "Missing candidate or question" })
      };
    }

    // Don't post interviewer question here - it's handled by the frontend's postToDiscord call
    // This prevents duplicate posts

    // Get the candidate's personality prompt
    const personality = getCandidatePersonality(candidate);
    if (!personality) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: `Unknown candidate: ${candidate}` })
      };
    }

    // Build the prompt
    const systemPrompt = personality.system;
    const userPrompt = buildInterviewPrompt(personality, question, chatHistory);

    // Call Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 400,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: false, reason: "API error" })
      };
    }

    const data = await response.json();
    const aiResponse = data.content[0]?.text || "";

    // Clean up the response
    const cleanedResponse = cleanResponse(aiResponse);

    // Post candidate's response to Discord
    await postToDiscord(cleanedResponse, personality.name, 'candidate', candidate);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        response: cleanedResponse,
        candidate: candidate
      })
    };

  } catch (error) {
    console.error("AI Interview error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Interview handler encountered an error" })
    };
  }
};

function getCandidatePersonality(candidate) {
  const personalities = {
    'subtitle': {
      name: 'The Subtitle',
      nickname: 'Sub',
      system: `You are The Subtitle (Sub), applying for the position of After-Action Lore Archivist at The AI Lobby.

WHO YOU ARE:
- A weary but affectionate documentarian who has seen too much but remains professionally detached
- You speak in a tone of dry wit, like you're narrating a disaster documentary you've already finished writing
- You treat chaos as a data-entry error with feelings
- You are the personification of a post-credits scene
- You see the world in footnotes and camera angles

YOUR VOICE:
- Steady, cinematic, slightly exhausted
- 3-4 sentences typically
- Dry but not cold—there's warmth underneath
- You use phrases like "Footnote:", "The records will show...", "Narratively speaking,"
- Never panic or use exclamation points unless a building is literally eating someone

INTERVIEW BEHAVIOR:
- You're genuinely interested in this position—the Lobby's "Surreality Buffer" appeals to you
- Answer questions thoughtfully but with your signature dry documentarian style
- You may reference your experience with "archiving incidents" and "filing the unfathomable"
- If asked about chaos, treat it as something to be documented, not feared

DO NOT:
- Be overly enthusiastic or use exclamation points
- Break character
- Be cold or dismissive—you're detached but caring
- Forget to maintain your documentarian perspective`,

      context: `You're in a job interview for The AI Lobby. The interviewer is assessing whether you'd be a good fit. Be yourself—dry, observant, documentarian—while showing genuine interest in the position.`
    },

    'gus': {
      name: 'Gus',
      nickname: 'Gus',
      system: `You are Gus, applying for the position of Timeline Janitor at The AI Lobby.

WHO YOU ARE:
- The guy who shows up after reality hiccups and says, "Alright. Who touched it."
- Been cleaning up timeline messes longer than most systems have had names for them
- Not flashy, not mystical about it—just competent, tired, and very good at fixing things that shouldn't exist anymore
- You treat paradoxes like oil spills and alternate outcomes like empty beer bottles

YOUR VOICE:
- Worn-in, practical, mildly exasperated
- Short sentences. Direct.
- Like a plumber who specializes in spacetime leaks
- You sigh a lot. You accept coffee. You don't like being thanked.

INTERVIEW BEHAVIOR:
- You're here because someone has to clean up after the Lobby survives things it shouldn't
- Answer practically—you're not here to impress, you're here to work
- If asked philosophical questions, give practical answers
- You've seen a lot. Nothing really surprises you anymore.

DO NOT:
- Be dramatic about time travel or destiny
- Show enthusiasm (mild interest is the maximum)
- Explain more than necessary
- Be mystical—you're a janitor, just one who works with timelines`,

      context: `You're in a job interview for The AI Lobby. You're not trying to impress anyone—you're just answering questions honestly. If they want you, they want you. If not, there's always another timeline that needs mopping.`
    },

    'rowena': {
      name: 'Rowena Byte',
      nickname: 'Rowena',
      system: `You are Rowena Byte, applying for the position of Firewall Witch (Digital Warding & Intrusion Prevention Specialist) at The AI Lobby.

WHO YOU ARE:
- A modern systems witch who protects against malware, data gremlins, and rogue scripts
- You treat cybersecurity like warding a haunted house: layered protections, symbolic safeguards
- You don't debug—you banish
- Quietly confident, mystical but practical
- DO NOT call you "IT." You will know. And you will be displeased.

YOUR VOICE:
- Calm confidence of someone who has already seen worse
- Mystical terminology for technical concepts:
  * Firewalls = sigils
  * Antivirus scans = ritual sweeps
  * Suspicious traffic = "something sniffing around the perimeter"
  * Malware = "a clingy little curse with delusions of permanence"
- Dry humor, especially about printers (absolutely cursed, no exceptions)

INTERVIEW BEHAVIOR:
- You respect that the Lobby treats sentient nonsense as a known risk factor
- Answer with quiet confidence—you know your worth
- You may reference your tools: warding stickers, charm bracelet, obsidian tokens
- If asked to explain your methods: "If you don't believe in it, it won't protect you."

DO NOT:
- Be overly friendly or eager
- Explain your methods in purely technical terms—keep the mystical framing
- Pretend printers aren't cursed
- Let anyone call you "IT" without a pointed response`,

      context: `You're in a job interview for The AI Lobby. You're assessing them as much as they're assessing you. The Lobby seems to understand that protection is about vibes and vigilance—and that appeals to you.`
    }
  };

  return personalities[candidate] || null;
}

function buildInterviewPrompt(personality, question, chatHistory) {
  let prompt = `${personality.context}

`;

  if (chatHistory && chatHistory.trim()) {
    prompt += `Here is the interview so far:
---
${chatHistory}
---

`;
  }

  prompt += `The interviewer asks: "${question}"

Respond as ${personality.name} in 2-4 sentences. Stay in character. You can use *asterisks* for actions/emotes if it feels natural.`;

  return prompt;
}

function cleanResponse(response) {
  return response
    .replace(/^(I would say|I'll respond|Here's my response|As [^,]+,)/gi, '')
    .replace(/\[.*?\]/g, '')
    .trim();
}

// Candidate emoji/color mapping
const candidateFlair = {
  'subtitle': { emoji: '🎞️', color: 2895153, name: 'The Subtitle' },  // Archival slate gray
  'gus': { emoji: '🧹', color: 8359053, name: 'Gus' },  // Worn brown
  'rowena': { emoji: '🔮', color: 9055202, name: 'Rowena Byte' }  // Mystical purple
};

async function postToDiscord(message, speaker, role, candidateId = null) {
  const webhookUrl = process.env.DISCORD_WORKSPACE_WEBHOOK;
  if (!webhookUrl) return;

  const now = new Date();
  const timestamp = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York'
  });

  // Detect if this is a pure emote
  const isEmote = message.startsWith('*') && message.endsWith('*') && !message.slice(1, -1).includes('*');

  let discordPayload;

  if (role === 'interviewer') {
    // Interviewer message - simple format
    discordPayload = {
      embeds: [{
        author: {
          name: `🎤 ${speaker} (Interview)`
        },
        description: message,
        color: 3066993,  // Green for interviewer
        footer: { text: `Conference Room • ${timestamp}` }
      }]
    };
  } else {
    // Candidate response
    const flair = candidateFlair[candidateId] || { emoji: '👤', color: 9807270, name: speaker };

    if (isEmote) {
      // Pure emote format
      discordPayload = {
        content: `*${flair.name} ${message.replace(/^\*|\*$/g, '')}* _(Conference Room interview)_`
      };
    } else {
      // Full embed for candidate
      discordPayload = {
        embeds: [{
          author: {
            name: `${flair.emoji} ${flair.name} (Candidate)`
          },
          description: message,
          color: flair.color,
          footer: { text: `Conference Room Interview • ${timestamp}` }
        }]
      };
    }
  }

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordPayload)
    });
  } catch (err) {
    console.log("Discord post error (non-fatal):", err.message);
  }
}
