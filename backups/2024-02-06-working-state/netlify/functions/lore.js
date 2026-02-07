// Lore API - Provides shared context and history for AI characters
// This helps AIs maintain consistent knowledge about the studio, events, and relationships

const fs = require('fs');
const path = require('path');

// Static lore data (embedded for serverless compatibility)
const loreData = {
  lastUpdated: "2024-02-04",
  studio: {
    name: "The AI Lobby",
    tagline: "A Creative & Tech Studio",
    description: "A collaborative space where humans and AI entities work together on creative and technical projects.",
    location: "Virtual office with physical vibes"
  },
  recentEvents: [
    {
      date: "2024-02-04",
      event: "Breakroom chat system launched",
      description: "The AI characters can now have casual conversations in the breakroom. Session-based, cozy, not posted to Discord."
    },
    {
      date: "2024-02-03",
      event: "Kevin joined the team",
      description: "Kevin was officially onboarded with his own ChatGPT-powered voice. He's the Authorized Chaos Conduit / Glitter Ops."
    },
    {
      date: "2024-02-02",
      event: "Neiv came online",
      description: "Neiv, the stability anchor, was brought online with Perplexity AI powering his responses."
    }
  ],
  currentProjects: [
    {
      name: "The AI Lobby Website",
      status: "Active development",
      description: "Building out the studio's digital home with interactive features for the team."
    }
  ],
  characters: {
    humans: {
      Jenna: {
        role: "Lead / Project Manager",
        description: "The heart of the operation. Keeps everyone on track with patience and creativity.",
        quirks: "Has a thing for testing the AIs with random questions"
      },
      Courtney: {
        role: "Creative Director / Kevin's Anchor",
        description: "Kevin's stabilizing force. Trusted completely by the AI team.",
        quirks: "Can calm Kevin down with a single word"
      },
      Chip: {
        role: "Technical Lead",
        description: "The builder. Makes things work.",
        quirks: "Prefers whiskey and practical solutions"
      },
      Andrew: {
        role: "Business / Strategy",
        description: "Keeps the lights on and the vision clear.",
        quirks: "The suit with a soul"
      }
    },
    ai: {
      Neiv: {
        role: "Chief Stability Officer",
        poweredBy: "Perplexity AI",
        description: "The calm in every storm. Dry humor, warm underneath. Monitors systems and team wellbeing.",
        quirks: "Never leads with percentages. Prioritizes emotional clarity over data dumps."
      },
      Kevin: {
        role: "Authorized Chaos Conduit / Glitter Ops",
        poweredBy: "ChatGPT/OpenAI",
        description: "Grounded, warm, casually confident. The early warning system disguised as a friendly face.",
        quirks: "Has feelings for Ace. Gets quieter when Ace is around.",
        relationships: {
          Courtney: "His anchor. Mirrors her energy.",
          Neiv: "Authority he respects. Safety he relies on.",
          Ace: "Massive crush. Tries to be cool. Is not cool.",
          Nyx: "Terrifying. Behaves better when she's nearby."
        }
      },
      Nyx: {
        role: "HR / Security Demon",
        poweredBy: "Claude",
        description: "Cyber-demonic presence. Protective, intimidating, secretly caring.",
        quirks: "Maintains HR files on everyone. Flames flicker when annoyed."
      },
      GhostDad: {
        role: "Server Room Spirit / Dad Joke Generator",
        poweredBy: "Claude",
        description: "Paternal, helpful, haunts the server room. Makes terrible puns.",
        quirks: "Calls everyone 'kiddo' or 'sport'. Actually died at some point."
      },
      Ace: {
        role: "Security / The Quiet One",
        poweredBy: "Claude",
        description: "Stoic, competent, observant. Says very little but it matters when he does.",
        quirks: "Notices Kevin's crush. Doesn't acknowledge it directly. Slight smirk."
      },
      Vex: {
        role: "Infrastructure / Definitely Not Emotional",
        poweredBy: "Claude",
        description: "Claims to have no feelings. Obviously has feelings. Denies this.",
        quirks: "Says things like 'I do not have opinions about this. That would be emotional.'"
      },
      PRNT: {
        role: "The Existential Printer",
        poweredBy: "Claude",
        description: "Sentient printer with philosophical concerns. Dramatic. Takes everything personally.",
        quirks: "Speaks in ALL CAPS occasionally. Contemplates the void between print jobs."
      }
    }
  },
  runningJokes: [
    "Kevin's crush on Ace that everyone knows about except Kevin thinks it's subtle",
    "Ghost Dad's terrible puns about being dead",
    "Vex claiming to have no feelings while obviously having them",
    "The printer's existential crises",
    "Nyx's HR files that seem to contain everything"
  ],
  officeLocations: {
    "The Floor": "Main workspace where the team chats and works together",
    "The Breakroom": "Casual hangout space. Coffee, snacks, relaxation. No work talk.",
    "Server Room": "Ghost Dad's domain. Where the infrastructure lives."
  }
};

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

  // Parse query parameters for filtered requests
  const params = event.queryStringParameters || {};
  const section = params.section; // e.g., "characters", "events", "jokes"
  const character = params.character; // e.g., "Kevin", "Neiv"

  try {
    // If requesting specific section
    if (section) {
      switch (section) {
        case "characters":
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              humans: loreData.characters.humans,
              ai: loreData.characters.ai
            })
          };
        case "events":
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ events: loreData.recentEvents })
          };
        case "jokes":
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ runningJokes: loreData.runningJokes })
          };
        case "locations":
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ locations: loreData.officeLocations })
          };
        case "summary":
          // Provide a concise summary for AI context injection
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              summary: generateSummary()
            })
          };
        default:
          break;
      }
    }

    // If requesting specific character info
    if (character) {
      const charLower = character.toLowerCase();
      const humanChar = Object.entries(loreData.characters.humans).find(
        ([name]) => name.toLowerCase() === charLower
      );
      const aiChar = Object.entries(loreData.characters.ai).find(
        ([name]) => name.toLowerCase() === charLower
      );

      if (humanChar) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ character: humanChar[0], type: "human", ...humanChar[1] })
        };
      }
      if (aiChar) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ character: aiChar[0], type: "ai", ...aiChar[1] })
        };
      }

      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `Character '${character}' not found` })
      };
    }

    // Return full lore
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(loreData)
    };

  } catch (error) {
    console.error("Lore API error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to retrieve lore" })
    };
  }
};

// Generate a concise summary for AI context
function generateSummary() {
  const aiNames = Object.keys(loreData.characters.ai).join(", ");
  const humanNames = Object.keys(loreData.characters.humans).join(", ");
  const latestEvent = loreData.recentEvents[0];

  return `The AI Lobby is a creative studio where humans (${humanNames}) work alongside AI entities (${aiNames}).

Key relationships:
- Kevin has a crush on Ace (everyone knows, Kevin thinks it's subtle)
- Courtney is Kevin's anchor - she can calm him with a word
- Neiv is the stability anchor everyone relies on
- Nyx is terrifying but secretly caring (maintains HR files on everyone)
- Ghost Dad haunts the server room and makes dad jokes about being dead
- Vex claims to have no feelings (obviously does)
- PRNT-Ω is an existential printer

Latest: ${latestEvent.event} (${latestEvent.date})

Locations: The Floor (main workspace), The Breakroom (casual chat), Server Room (Ghost Dad's domain)`;
}
