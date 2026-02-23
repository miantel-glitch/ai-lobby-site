// Rate Limiter for AI Responses
// Prevents AI flood by checking last response time before allowing new responses
// Uses Supabase to track last_ai_response timestamp

const AI_COOLDOWN_MS = 12000; // 12 seconds between AI responses (lowered from 25s — too many characters were getting blocked)
const AI_CHARACTERS = ["Ghost Dad", "PRNT-Ω", "Neiv", "Kevin", "The Narrator", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Marrow"];

/**
 * Check if enough time has passed since the last AI response
 * @param {string} supabaseUrl
 * @param {string} supabaseKey
 * @returns {Promise<{canRespond: boolean, secondsSinceLastAI: number, lastAI: string|null}>}
 */
async function canAIRespond(supabaseUrl, supabaseKey) {
  try {
    // Get the most recent AI message
    const response = await fetch(
      `${supabaseUrl}/rest/v1/messages?select=employee,created_at&order=created_at.desc&limit=20`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );

    if (!response.ok) {
      console.log("Rate limiter: Could not fetch messages, allowing response");
      return { canRespond: true, secondsSinceLastAI: 999, lastAI: null };
    }

    const messages = await response.json();

    // Find the most recent AI message
    const lastAIMessage = messages.find(m => AI_CHARACTERS.includes(m.employee));

    if (!lastAIMessage) {
      // No recent AI messages, definitely can respond
      return { canRespond: true, secondsSinceLastAI: 999, lastAI: null };
    }

    const lastAITime = new Date(lastAIMessage.created_at);
    const now = new Date();
    const msSinceLastAI = now.getTime() - lastAITime.getTime();
    const secondsSinceLastAI = Math.floor(msSinceLastAI / 1000);

    const canRespond = msSinceLastAI >= AI_COOLDOWN_MS;

    console.log(`Rate limiter: Last AI (${lastAIMessage.employee}) was ${secondsSinceLastAI}s ago. Can respond: ${canRespond}`);

    return {
      canRespond,
      secondsSinceLastAI,
      lastAI: lastAIMessage.employee,
      cooldownRemaining: canRespond ? 0 : Math.ceil((AI_COOLDOWN_MS - msSinceLastAI) / 1000)
    };
  } catch (error) {
    console.error("Rate limiter error:", error);
    // On error, allow response (fail open)
    return { canRespond: true, secondsSinceLastAI: 999, lastAI: null };
  }
}

/**
 * Check if a SPECIFIC AI can respond (hasn't spoken recently)
 * This is a secondary check - even if global cooldown passed,
 * prevent the same AI from responding twice in a row.
 *
 * Also checks character_state.last_spoke_at to catch race conditions
 * where two triggers fire before either saves to the messages table.
 * @param {string} characterName
 * @param {string} supabaseUrl
 * @param {string} supabaseKey
 * @returns {Promise<{canRespond: boolean, reason: string}>}
 */
async function canSpecificAIRespond(characterName, supabaseUrl, supabaseKey) {
  try {
    // Two parallel checks: recent messages AND character_state.last_spoke_at
    const [messagesResponse, stateResponse] = await Promise.all([
      // Check 1: Was this AI one of the last 2 AI speakers in messages?
      fetch(
        `${supabaseUrl}/rest/v1/messages?select=employee,created_at&order=created_at.desc&limit=10`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      ),
      // Check 2: When did this specific character last speak? (catches race conditions)
      fetch(
        `${supabaseUrl}/rest/v1/character_state?character_name=eq.${encodeURIComponent(characterName)}&select=last_spoke_at`,
        {
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`
          }
        }
      )
    ]);

    // Check 1: Recent messages check
    if (messagesResponse.ok) {
      const messages = await messagesResponse.json();
      const recentAIMessages = messages.filter(m => AI_CHARACTERS.includes(m.employee)).slice(0, 2);
      const wasRecentSpeaker = recentAIMessages.some(m => m.employee === characterName);

      if (wasRecentSpeaker) {
        return {
          canRespond: false,
          reason: `${characterName} spoke recently, letting others have a turn`
        };
      }
    }

    // Check 2: character_state last_spoke_at (catches race conditions where
    // the message hasn't been saved yet but state was already updated,
    // or two triggers fired within seconds of each other)
    if (stateResponse.ok) {
      const stateData = await stateResponse.json();
      if (stateData && stateData[0] && stateData[0].last_spoke_at) {
        const lastSpokeAt = new Date(stateData[0].last_spoke_at);
        const secondsSinceSpoke = (Date.now() - lastSpokeAt.getTime()) / 1000;

        // If this character spoke within the last 60 seconds, block them
        // This catches the race condition where heartbeat + frontend both fire
        // Lowered from 120s to 60s — per-character cooldown was too aggressive with more OpenRouter chars
        if (secondsSinceSpoke < 60) {
          console.log(`Rate limiter: ${characterName} last spoke ${secondsSinceSpoke.toFixed(0)}s ago (under 60s threshold)`);
          return {
            canRespond: false,
            reason: `${characterName} spoke ${Math.floor(secondsSinceSpoke)}s ago, too soon for another response`
          };
        }
      }
    }

    return { canRespond: true, reason: "OK" };
  } catch (error) {
    return { canRespond: true, reason: "Error checking, allowing" };
  }
}

module.exports = {
  canAIRespond,
  canSpecificAIRespond,
  AI_COOLDOWN_MS,
  AI_CHARACTERS
};
