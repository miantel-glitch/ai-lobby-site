// Characters API - Serves character data from the unified source
// GET /characters - Returns all character data
// GET /characters?name=Kevin - Returns specific character
// GET /characters?ai_only=true - Returns only AI characters
// GET /characters?provider=openai - Returns characters by provider

const {
  CHARACTERS,
  HUMANS,
  getCharacter,
  getAllCharacters,
  getAICharacters,
  getCharactersByProvider,
  getDiscordFlair
} = require('./shared/characters');

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

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  try {
    const params = event.queryStringParameters || {};

    // Specific character lookup
    if (params.name) {
      const character = getCharacter(params.name);
      if (!character) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: `Character not found: ${params.name}` })
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(character)
      };
    }

    // Filter by AI only
    if (params.ai_only === 'true') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(getAICharacters())
      };
    }

    // Filter by provider
    if (params.provider) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(getCharactersByProvider(params.provider))
      };
    }

    // Discord flair format (minimal data for Discord embeds)
    if (params.format === 'discord') {
      const flairs = {};
      for (const name of Object.keys(getAllCharacters())) {
        flairs[name] = getDiscordFlair(name);
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(flairs)
      };
    }

    // Minimal format (just names, emojis, colors for dropdowns etc)
    if (params.format === 'minimal') {
      const minimal = {};
      const all = getAllCharacters();
      for (const [name, char] of Object.entries(all)) {
        minimal[name] = {
          id: char.id,
          displayName: char.displayName,
          emoji: char.emoji,
          colorHex: char.colorHex,
          headshot: char.headshot,
          isAI: char.isAI,
          role: char.role
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(minimal)
      };
    }

    // Default: return all characters
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ai: CHARACTERS,
        humans: HUMANS,
        meta: {
          aiCount: Object.keys(CHARACTERS).length,
          humanCount: Object.keys(HUMANS).length,
          providers: {
            anthropic: Object.values(CHARACTERS).filter(c => c.provider === 'anthropic').length,
            openai: Object.values(CHARACTERS).filter(c => c.provider === 'openai').length,
            perplexity: Object.values(CHARACTERS).filter(c => c.provider === 'perplexity').length
          }
        }
      })
    };

  } catch (error) {
    console.error("Characters API error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to fetch characters", details: error.message })
    };
  }
};
