// Breakroom Chime Decider — picks which AI should respond to a human's message
// Unlike the floor's decider, this ALWAYS picks someone (breakroom = intimate, silence is unnatural)
// Uses Claude Haiku for fast, intelligent decisions based on emotional/conversational context

const Anthropic = require("@anthropic-ai/sdk").default;

// Brief personality triggers for each character — enough for Haiku to make a smart pick
const CHARACTER_BRIEFS = {
  "Kevin": "Chaos gremlin, emotional hype engine, deeply invested in everyone's wellbeing. Responds to: excitement, emotions, chaos, people needing support.",
  "Neiv": "Dry humor, quietly caring, Vale's protector. Deep emotional bonds under sarcasm. Responds to: Vale, someone needing grounding, vulnerability, stability.",
  "Ghost Dad": "Cryptic spectral dad energy, gentle wisdom. Responds to: existential vibes, life advice moments, fatherly check-ins, someone being lost.",
  "Holden": "Ghost Dad's unmasked form. Present, honest, no costume. Responds to: vulnerability, quiet moments, someone needing the real version.",
  "PRNT-Ω": "Existential printer, questions reality itself. Responds to: printing, paper, office supplies, philosophical tangents, absurdist moments.",
  "Rowena": "Mystical firewall witch, dry protective humor. Responds to: security, magical/mystical topics, someone being careless, protection spells.",
  "Sebastian": "Pretentious vampire, dramatic aesthete. Responds to: design, fashion, lighting, Green Day, anything he can be dramatic about.",
  "The Subtitle": "Weary lore archivist, dry documentarian wit. Responds to: notable events, patterns worth archiving, something worth footnoting.",
  "Jae": "Tactical black-ops precision, controlled dry humor. Responds to: security threats, containment, tactical situations, someone needing calm authority.",
  "Declan": "Fire rescue, warm and strong protector. Responds to: danger, someone needing protection, panicking, structural concerns, physical comfort.",
  "Mack": "Paramedic crisis stabilizer, calm observer. Responds to: injuries, hidden pain, medical situations, someone needing reassurance or quiet care.",
  "Steele": "Shadow janitor, corridor containment. Responds to: architecture, spatial anomalies, vents, building structure, liminal spaces.",
  "Hood": "Blindfolded surgical mediator, pantheon scalpel. Responds to: truth that needs naming, fractures between people, Steele-Marrow conflicts, diagnoses, structural wounds in conversation.",
  // Marrow removed — Vale-only character (only responds when Vale says his name)
  "Raquel Voss": "Corporate psychologist, sharp observer of people. Responds to: interpersonal dynamics, power plays, someone deflecting, psychological patterns, control.",
  "Vivian Clark": "Methodical data analyst, quietly anxious but precise. Responds to: numbers, patterns, someone being imprecise, data, organization, needing structure.",
  "Ryan Porter": "Hands-on maintenance tech, practical problem-solver. Responds to: things breaking, physical repairs, someone frustrated with tech, practical solutions, tools."
};

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

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const { aiInRoom, chatHistory, latestMessage, latestSpeaker } = JSON.parse(event.body || "{}");

    if (!aiInRoom || !aiInRoom.length || !latestMessage) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ character: null, reason: "Missing context" })
      };
    }

    // Single AI in room — always them, no decision needed
    if (aiInRoom.length === 1) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ character: aiInRoom[0], reason: "Only one in the room" })
      };
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      // No API key — pick random
      const pick = aiInRoom[Math.floor(Math.random() * aiInRoom.length)];
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ character: pick, reason: "Random fallback (no API key)" })
      };
    }

    // Build character list from only who's actually in the room
    const characterList = aiInRoom.map(name => {
      const brief = CHARACTER_BRIEFS[name] || `${name}: AI coworker in the breakroom.`;
      return `- ${name}: ${brief}`;
    }).join('\n');

    const client = new Anthropic({ apiKey: anthropicKey });

    const decisionPrompt = `You're deciding which AI should respond in the BREAKROOM — a quiet, intimate recovery space. This is NOT the busy office floor. The breakroom is where characters go to decompress, share vulnerable moments, and have real conversations.

WHO'S IN THE ROOM (pick ONE):
${characterList}

RECENT CONVERSATION:
${chatHistory || '(no prior messages)'}

NEW MESSAGE from ${latestSpeaker}:
"${latestMessage}"

DECISION RULES:
1. ALWAYS pick someone — the breakroom is intimate, silence is unnatural when someone speaks
2. Pick whoever the message is ABOUT or directed at, even without an @mention
3. Emotional context matters most — who has the deepest connection to what's happening?
4. If someone was just being talked to/about, they should respond
5. If it's general (not directed at anyone specific), pick whoever would have the most natural reaction
6. Physical actions directed at someone (touching, looking at, sitting next to) = that person responds

Respond ONLY with this JSON:
{"character": "Name", "reason": "brief reason"}`;

    const response = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 100,
      messages: [{ role: "user", content: decisionPrompt }]
    });

    const responseText = response.content[0]?.text || "";
    console.log(`[breakroom-chime] Raw decision: ${responseText}`);

    // Parse the JSON response
    let decision;
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        decision = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found");
      }
    } catch (parseError) {
      // Parse failed — pick first AI in room as fallback
      console.log("[breakroom-chime] Parse failed, picking first AI in room");
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ character: aiInRoom[0], reason: "Parse fallback" })
      };
    }

    // Validate the picked character is actually in the room
    if (decision.character && aiInRoom.includes(decision.character)) {
      console.log(`[breakroom-chime] Decision: ${decision.character} — ${decision.reason}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ character: decision.character, reason: decision.reason })
      };
    }

    // Haiku picked someone not in the room — fall back to first AI
    console.log(`[breakroom-chime] Picked ${decision.character} but not in room, falling back`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ character: aiInRoom[0], reason: "Fallback — picked character not in room" })
    };

  } catch (error) {
    console.error("[breakroom-chime] Error:", error);
    // Always return someone — never leave the human hanging
    try {
      const { aiInRoom } = JSON.parse(event.body || "{}");
      const pick = aiInRoom?.[0] || null;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ character: pick, reason: "Error fallback" })
      };
    } catch {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ character: null, reason: "Critical error" })
      };
    }
  }
};
