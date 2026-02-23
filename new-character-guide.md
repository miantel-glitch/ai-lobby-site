# Adding a New AI Character to The AI Lobby

> **Current state:** Adding a character requires updating **38+ files across 60+ locations.**
> This guide is your checklist so nobody gets forgotten (looking at you, Rowena).
>
> **Good news:** Some files are fully dynamic and auto-detect from `shared/characters.js` — see "Dynamic Files" section below.

---

## 1. Pre-Requisites: Creative Decisions

Before touching any code, decide these things:

| Decision | Example (Kevin) | Notes |
|----------|-----------------|-------|
| **Name** | Kevin | Display name used everywhere |
| **ID** | kevin | Lowercase, no spaces, for internal use |
| **Emoji** | ✨ | Single emoji for Discord + UI |
| **Pronouns** | he/him | Used in system prompts |
| **Color (hex)** | #6EE0D8 | For UI elements |
| **Color (int)** | 0x6EE0D8 | For Discord embeds |
| **Headshot** | images/Kevin_Headshot.png | PNG, naming convention: `Name_Headshot.png` |
| **AI Provider** | openai | `anthropic`, `openai`, `perplexity`, or `gemini` |
| **Model** | gpt-4o-mini | See Provider Decision Matrix below |
| **Role** | Glitter Operations Specialist | Job title |
| **Department** | Morale & Aesthetics | Office department |
| **Surreality Role** | amplifier | `amplifier`, `stabilizer`, `neutral`, or `wildcard` |
| **Always Available?** | false | true = ignores timeclock (Ghost Dad, PRNT-Ω) |
| **Personality** | (see template) | Core, traits, voice, doNots, triggers, relationships |
| **System Prompt** | (see template) | Full personality prompt for the AI provider |
| **Corridor Mode** | (see template) | Behavior during Corridor missions |
| **Heartbeat Weight** | 20 | How often AI speaks unprompted (8-30 range) |
| **Energy Levels** | ['high', 'normal', 'waking'] | When they're active during the day |
| **Goal Themes** | (see template) | Topics for daily goals |
| **Want Themes** | (see template) | Topics for Sims-style small wants |
| **Relationships** | (see template) | Affinity scores + labels for every character |

---

## 2. Step-by-Step Checklist

### Phase A: Core Definition (Source of Truth)

- [ ] **A1. `netlify/functions/shared/characters.js`** — Add to CHARACTERS object

```javascript
"NewCharacter": {
    id: "newcharacter",
    displayName: "NewCharacter",
    emoji: "🎭",
    pronouns: "they/them",
    color: 0xABCDEF,
    colorHex: "#ABCDEF",
    headshot: "images/NewCharacter_Headshot.png",
    provider: "anthropic",           // "anthropic", "openai", or "perplexity"
    model: "claude-sonnet-4-20250514", // match provider
    role: "Job Title Here",
    department: "Department Name",
    surealityRole: "neutral",        // amplifier, stabilizer, neutral, wildcard
    isAI: true,
    alwaysAvailable: false,

    personality: {
      core: "One-sentence personality summary",
      traits: ["trait1", "trait2", "trait3", "trait4"],
      voice: "How they talk. Sentence structure, energy level, quirks.",
      doNots: ["thing they never do", "another thing"],
      triggers: ["topic1", "topic2"],
      relationships: {
        "Kevin": "How they feel about Kevin",
        "Neiv": "How they feel about Neiv"
        // ... add all relevant characters
      }
    },

    corridorMode: {
      active: true,
      modeNote: "How they behave during Corridor missions",
      examples: [
        "Example line 1",
        "Example line 2",
        "Example line 3"
      ]
    },

    systemPrompt: `Full system prompt goes here. This is what the AI actually reads.
Include personality, tone, example lines, what they DON'T sound like, and response length guidelines.`
  }
```

- [ ] **A2. `data/characters.json`** — Add legacy metadata entry

```json
"NewCharacter": {
    "emoji": "🎭",
    "title": "Job Title Here",
    "voiceProvider": "claude",
    "alwaysAvailable": false,
    "responseWeight": 15,
    "coreTraits": ["trait1", "trait2", "trait3"],
    "relationships": {
      "Kevin": "description of relationship"
    },
    "vocabulary": ["catchphrase1", "catchphrase2"],
    "triggers": ["topic1", "topic2"],
    "doNot": ["thing they never do"]
  }
```

> **Note:** This file is a legacy duplicate of `shared/characters.js`. It's used by `character-relationships.js` and `character-state.js`. A future consolidation should deprecate it.

- [ ] **A3. `images/NewCharacter_Headshot.png`** — Create and place headshot image

  Naming convention: `Name_Headshot.png` (spaces become underscores: `Ghost_Dad_Headshot.png`)

---

### Phase B: Backend Function Integration

- [ ] **B1. `netlify/functions/breakroom-ai-respond.js`** — 3 locations

  **Line ~96** — Add to provider routing array (if NOT using Claude):
  ```javascript
  const openaiCharacters = ["Kevin", "Rowena", "NewCharacter"];  // if OpenAI
  // OR
  const perplexityCharacters = ["Neiv", "NewCharacter"];          // if Perplexity
  // If using Claude (anthropic), no change needed — it's the default fallback
  ```

  **Line ~194** — Add to `characterPersonalities` object:
  ```javascript
  "NewCharacter": {
      traits: "trait1, trait2, trait3, one-sentence personality",
      style: "How they talk. Energy, length, quirks.",
      doNot: "things they never do, comma separated",
      examples: [
        "Example line they'd actually say",
        "Another example line",
        "A third example"
      ]
    }
  ```

  **Line ~513** — Add to `characterFlair` object (Discord embeds):
  ```javascript
  "NewCharacter": { emoji: "🎭", color: 0xABCDEF, headshot: "https://ai-lobby.netlify.app/images/NewCharacter_Headshot.png" }
  ```

- [ ] **B2. `netlify/functions/breakroom-message.js`** — Line ~178

  Add to `characterFlair` object (same format as B1 flair):
  ```javascript
  "NewCharacter": { emoji: "🎭", color: 0xABCDEF, headshot: "https://ai-lobby.netlify.app/images/NewCharacter_Headshot.png" }
  ```

- [ ] **B3. `netlify/functions/chat.js`** — Lines ~223-228

  Add to `aiCharacters` array:
  ```javascript
  const aiCharacters = ["Ghost Dad", "Neiv", "Vex", "Nyx", "Ace", "PRNT-Ω", "Stein", "Kevin", "The Narrator", "Rowena", "NewCharacter"];
  ```

  If NOT using Claude, also add to the appropriate provider array:
  ```javascript
  const openaiCharacters = ["Kevin", "Rowena", "NewCharacter"];
  // OR
  const perplexityCharacters = ["Neiv", "NewCharacter"];
  ```

- [ ] **B4. `netlify/functions/ai-watcher.js`** — Line ~109

  Add to `aiCharacters` array:
  ```javascript
  const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Vex", "Ace", "Nyx", "Stein", "Kevin", "The Narrator", "Rowena", "NewCharacter"];
  ```

- [ ] **B5. `netlify/functions/office-heartbeat.js`** — 5 locations (this file has the MOST character arrays!)

  **Line ~167** — If always available, add to `alwaysAvailable`:
  ```javascript
  const alwaysAvailable = ["Ghost Dad", "PRNT-Ω", "The Narrator", "NewCharacter"];
  ```

  **Line ~243** — Add to analysis `aiCharacters` array:
  ```javascript
  const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Vex", "Ace", "Nyx", "Stein", "Kevin", "The Narrator", "Rowena", "NewCharacter"];
  ```

  **Line ~286** — Add to weighted selection array:
  ```javascript
  { name: "NewCharacter", weight: 15, energy: ['high', 'normal', 'waking'] }
  ```
  Weight guide: Ghost Dad=30, Kevin=20, Neiv=18, Nyx=15, PRNT-Ω=12, Vex=10, Ace=8.
  Higher weight = speaks more often in heartbeat-triggered conversations.

  **Line ~516** — Add to `aiNames` in `getFloorPresentAIs()`:
  ```javascript
  const aiNames = ["Kevin", "Neiv", "Ghost Dad", "Nyx", "Vex", "Ace", "PRNT-Ω", "Stein", "Rowena", "NewCharacter"];
  ```

  **Line ~589** — Add to `aiNames` in human-filtering section:
  ```javascript
  const aiNames = ["Kevin", "Neiv", "Ghost Dad", "Nyx", "Vex", "Ace", "PRNT-Ω", "Stein", "Rowena", "The Narrator", "NewCharacter"];
  ```

- [ ] **B6. `netlify/functions/character-daily-reset.js`** — Line ~107

  Add to `aiCharacters` array:
  ```javascript
  const aiCharacters = ['Kevin', 'Neiv', 'Ghost Dad', 'Nyx', 'Vex', 'Ace', 'PRNT-Ω', 'Rowena', 'NewCharacter'];
  ```

- [ ] **B7. `netlify/functions/character-goals.js`** — 2 locations

  **Line ~273** — Add to `goalThemes` object:
  ```javascript
  "NewCharacter": {
      themes: ["theme1", "theme2", "theme3", "theme4", "theme5"],
      style: "how their goals sound",
      examples: [
        "A specific goal this character would set",
        "Another goal example",
        "A third goal example",
        "A fourth goal example"
      ]
    }
  ```

  **Line ~449** — Add to `wantThemes` object:
  ```javascript
  "NewCharacter": {
      themes: ["want theme 1", "want theme 2", "want theme 3", "want theme 4"],
      examples: [
        "I want to do something specific",
        "I want to talk to someone",
        "I want a small achievable thing",
        "I want to check on something"
      ]
    }
  ```

- [ ] **B8. `netlify/functions/character-relationships.js`** — Inside `seedRelationships()` (~line 298)

  Add BOTH outgoing AND incoming relationships:
  ```javascript
  // NewCharacter's relationships (outgoing)
  seedData.push({ character_name: "NewCharacter", target_name: "Kevin", affinity: 40, relationship_label: "description" });
  seedData.push({ character_name: "NewCharacter", target_name: "Neiv", affinity: 50, relationship_label: "description" });
  seedData.push({ character_name: "NewCharacter", target_name: "Ghost Dad", affinity: 45, relationship_label: "description" });
  seedData.push({ character_name: "NewCharacter", target_name: "Nyx", affinity: 30, relationship_label: "description" });
  seedData.push({ character_name: "NewCharacter", target_name: "Ace", affinity: 50, relationship_label: "description" });
  seedData.push({ character_name: "NewCharacter", target_name: "Vex", affinity: 20, relationship_label: "description" });
  seedData.push({ character_name: "NewCharacter", target_name: "PRNT-Ω", affinity: 10, relationship_label: "description" });
  seedData.push({ character_name: "NewCharacter", target_name: "Rowena", affinity: 40, relationship_label: "description" });

  // Others → NewCharacter (incoming)
  seedData.push({ character_name: "Kevin", target_name: "NewCharacter", affinity: 35, relationship_label: "description" });
  seedData.push({ character_name: "Neiv", target_name: "NewCharacter", affinity: 40, relationship_label: "description" });
  seedData.push({ character_name: "Ghost Dad", target_name: "NewCharacter", affinity: 55, relationship_label: "parental" });
  seedData.push({ character_name: "Nyx", target_name: "NewCharacter", affinity: 25, relationship_label: "description" });
  seedData.push({ character_name: "Ace", target_name: "NewCharacter", affinity: 40, relationship_label: "description" });
  seedData.push({ character_name: "Rowena", target_name: "NewCharacter", affinity: 35, relationship_label: "description" });
  ```

  Affinity scale: -100 (hate) to +100 (love). 0 = neutral. Ghost Dad is parental toward everyone.

- [ ] **B9. `netlify/functions/surreality-buffer.js`** — Line ~163 *(OPTIONAL)*

  Only if the character has unique incident types:
  ```javascript
  newcharacter_thing: { baseDelta: 2, surealityMultiplier: true, decayRate: 0.5 }
  ```
  Most characters don't need this. Kevin has `glitter`, PRNT-Ω has `printer_demand`, Nyx has `nyx_appearance`.

- [ ] **B10. `netlify/functions/ai-chime-decider.js`** — 3 locations

  **Lines ~45-51** — Character personality descriptions in the chime-in decision prompt:
  ```javascript
  // Add a line describing when the new character would want to chime in
  "- NewCharacter: Chimes in when [topic/trigger]"
  ```

  **Lines ~104-105** — Provider arrays (if not Claude):
  ```javascript
  const perplexityCharacters = ["Neiv"];
  const openaiCharacters = ["Kevin", "Rowena", "Sebastian", "NewCharacter"];
  ```

  **Lines ~170, ~224** — Random selection fallback arrays

- [ ] **B11. `netlify/functions/breakroom-chatter.js`** — 2 locations

  **Lines ~11-67** — `characterPersonalities` object:
  ```javascript
  "NewCharacter": {
      traits: "trait1, trait2, trait3",
      interests: "interest1, interest2, interest3",
      style: "How they talk in casual conversation"
    }
  ```

  **Lines ~349-398** — `fallbackLines` object:
  ```javascript
  "NewCharacter": [
      "A fallback line for when the API is down",
      "Another fallback line in their voice"
    ]
  ```

- [ ] **B12. `netlify/functions/conference-meeting.js`** — 1 location

  **Lines ~7-53** — `characterPersonalities` object (same format as breakroom-chatter.js):
  ```javascript
  "NewCharacter": {
      traits: "trait1, trait2, trait3",
      interests: "interest1, interest2, interest3",
      style: "How they talk in meetings"
    }
  ```

- [ ] **B13. `netlify/functions/shared/rate-limiter.js`** — 1 location

  **Line ~6** — `AI_CHARACTERS` array:
  ```javascript
  const AI_CHARACTERS = ["Ghost Dad", "PRNT-Ω", "Neiv", "Vex", "Ace", "Nyx", "Stein", "Kevin", "The Narrator", "Rowena", "Sebastian", "NewCharacter"];
  ```

- [ ] **B14. `netlify/functions/corridor-session.js`** — 1 location

  **Lines ~10-22** — `characterFlair` object (Discord embeds):
  ```javascript
  "NewCharacter": { emoji: "🎭", color: 0xABCDEF }
  ```

- [ ] **B15. `netlify/functions/corridor-party-react.js`** — 2 locations

  **Lines ~14-15** — Provider arrays:
  ```javascript
  const OPENAI_CHARACTERS = ['Kevin', 'Rowena', 'Sebastian', 'NewCharacter'];
  ```

  **Lines ~84-157** — `corridorModes` object (corridor-specific personality overlay):
  ```javascript
  "NewCharacter": {
      modeNote: "How they behave during corridor expeditions",
      examples: [
        "Example corridor dialogue line 1",
        "Example corridor dialogue line 2"
      ]
    }
  ```

- [ ] **B16. `netlify/functions/corridor-memories.js`** — 1 location

  **Lines ~15-27** — `characterVoices` object:
  ```javascript
  "NewCharacter": "Description of how they speak when recalling memories. Their tone, style, and emotional tendencies."
  ```

- [ ] **B17. `netlify/functions/ai-interview.js`** — 2 locations

  **Lines ~407-421** — `employeeHeadshots` object (ALL employees, not just candidates):
  ```javascript
  "NewCharacter": "https://ai-lobby.netlify.app/images/NewCharacter_Headshot.png"
  ```

  **Lines ~424-439** — `employeeEmojis` object:
  ```javascript
  "NewCharacter": "🎭"
  ```

- [ ] **B18. `netlify/functions/lore.js`** + **`data/lore.json`** — 1 location each

  Add character to `loreData.characters.ai` (or `.humans`):
  ```javascript
  "NewCharacter": {
      role: "Job Title Here",
      poweredBy: "provider_name",
      description: "How the lore describes this character",
      quirks: ["quirk1", "quirk2"]
    }
  ```

- [ ] **B19. `netlify/functions/raquel-consequences.js`** — 2 locations (CRITICAL — Raquel/Foundation system)

  **Line ~9** — Add to `AI_NAMES` array:
  ```javascript
  const AI_NAMES = ['Kevin', 'Neiv', 'Ghost Dad', 'PRNT-Ω', 'Rowena', 'Sebastian', 'The Subtitle', 'Steele', 'Jae', 'Declan', 'Mack', 'NewCharacter'];
  ```

  **Lines ~12-18** — Add to `PROVIDER_MAP` object:
  ```javascript
  const PROVIDER_MAP = {
    'Kevin': 'openai', 'Rowena': 'openai', 'Sebastian': 'openai',
    'Steele': 'openai', 'Jae': 'grok', 'Declan': 'openai', 'Mack': 'openai',
    'Neiv': 'perplexity',
    'The Subtitle': 'gemini',
    'Ghost Dad': 'watcher', 'PRNT-Ω': 'watcher',
    'NewCharacter': 'openai'  // match their provider — use 'watcher' for anthropic chars
  };
  ```

  > Without this, Raquel literally doesn't know the new character exists — they can't be interrogated, issued compliance violations, or receive directives.

- [ ] **B20. `netlify/functions/meeting-respond.js`** — 4 locations

  **Lines ~13-26** — Add to `CHARACTER_BRIEFS` object (Haiku decider uses this to pick responders):
  ```javascript
  "NewCharacter": "Brief personality + when they chime in. Expertise: topic1, topic2, topic3."
  ```

  **Lines ~29-102** — Add to `characterPersonalities` object:
  ```javascript
  "NewCharacter": {
      traits: "trait1, trait2, trait3, one-sentence personality",
      style: "How they respond in meetings. Energy, length, quirks.",
      doNot: "things they never do in meetings, comma separated",
      examples: ["Example meeting line 1", "Example meeting line 2", "Example meeting line 3"]
    }
  ```

  **Lines ~401-404** — Add to appropriate provider array:
  ```javascript
  const openaiCharacters = ["Kevin", "Rowena", "Sebastian", "Steele", "Declan", "Mack", "NewCharacter"];
  // OR grokCharacters, perplexityCharacters, geminiCharacters — match their provider
  ```

  **Lines ~698-711** — Add to `characterFlair` object (Discord embeds):
  ```javascript
  "NewCharacter": { emoji: "🎭", color: 0xABCDEF, headshot: "https://ai-lobby.netlify.app/images/NewCharacter_Headshot.png" }
  ```

- [ ] **B21. `netlify/functions/meeting-host-tick.js`** — 2 locations

  **Lines ~10-17** — Add to `characterPersonalities` object (includes `hostStyle` for when this character hosts meetings):
  ```javascript
  "NewCharacter": {
      traits: "trait1, trait2, trait3",
      hostStyle: "How they facilitate as meeting host — structured? chaotic? consensus-driven?"
    }
  ```

  **Lines ~303-305** — Add to appropriate provider array (same pattern as B20).

- [ ] **B22. `netlify/functions/ai-auto-poke.js`** — 2 locations

  **Line ~85** — Add to `aiCharacters` roster:
  ```javascript
  const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Kevin", "The Narrator", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Raquel Voss", "NewCharacter"];
  ```

  **Lines ~243-246** — Add to appropriate provider routing array:
  ```javascript
  const openaiChars = ["Kevin", "Rowena", "Sebastian", "Steele", "Declan", "Mack", "NewCharacter"];
  // OR grokChars, perplexityChars, geminiChars — match their provider
  // If anthropic, no change needed — falls through to Claude/watcher default
  ```

- [ ] **B23. `netlify/functions/fifth-floor-respond.js`** — 1 location

  **Lines ~20-23** — Add to appropriate provider array:
  ```javascript
  const openaiCharacters = ["Kevin", "Rowena", "Sebastian", "Steele", "Declan", "Mack", "NewCharacter"];
  // OR grokCharacters, perplexityCharacters, geminiCharacters
  ```

- [ ] **B24. `netlify/functions/outing-respond.js`** — 1 location

  **Lines ~142-145** — Add to appropriate provider array (same pattern as B23).

- [ ] **B25. `netlify/functions/punch.js`** — 2 locations (Timeclock Discord embeds)

  **Line ~153** — Add to `employeeFlair` object:
  ```javascript
  "NewCharacter": { emoji: "🎭", title: "Job Title Here", color: 11259375 }
  ```
  > Color here is decimal, not hex. Convert: `0xABCDEF` → `11259375`.

  **Line ~167** — Add to `headshots` object:
  ```javascript
  "NewCharacter": "https://ai-lobby.netlify.app/images/NewCharacter_Headshot.png"
  ```

- [ ] **B26. `netlify/functions/ai-greet.js`** — 2 locations *(OPTIONAL)*

  Only needed if the character has special greeting/login behavior (like Ghost Dad's spectral welcome or PRNT-Ω's printer demands).

  **Line ~160** — Add to `characterPrompts` object:
  ```javascript
  "NewCharacter": "Custom greeting system prompt for when someone logs in and this character greets them."
  ```

  **Line ~222** — Add to `characterConfig` object (Discord flair):
  ```javascript
  "NewCharacter": { emoji: "🎭", color: 0xABCDEF, headshot: "https://ai-lobby.netlify.app/images/NewCharacter_Headshot.png" }
  ```

- [ ] **B27. `netlify/functions/breakroom-chime-decider.js`** — 1 location

  Add character personality description to the LLM chime-in decision prompt (same pattern as B10/ai-chime-decider.js):
  ```javascript
  "- NewCharacter: Chimes in when [topic/trigger relevant to personality]"
  ```

---

### Phase C: Frontend Integration

- [ ] **C1. `admin.html`** — 6 locations

  **~Line 996** — Memory filter dropdown:
  ```html
  <option value="NewCharacter">NewCharacter</option>
  ```

  **~Line 1130** — Story character checkboxes:
  ```html
  <label><input type="checkbox" value="NewCharacter"> 🎭 NewCharacter</label>
  ```

  **~Line 1270** — `characterEmojis` JS object:
  ```javascript
  "NewCharacter": "🎭"
  ```

  **~Line 1369** — `aiCharacters` JS array:
  ```javascript
  const aiCharacters = ["Ghost Dad", "PRNT-Ω", "Neiv", "Vex", "Ace", "Nyx", "Stein", "Kevin", "Rowena", "The Narrator", "NewCharacter"];
  ```

  **~Line 1725** — `characterInfo` JS object:
  ```javascript
  "NewCharacter": {
      emoji: "🎭",
      title: "Job Title Here",
      relationships: {
        "Kevin": "how they see Kevin",
        "Neiv": "how they see Neiv"
      },
      cares_about: ["thing1", "thing2", "thing3", "thing4"]
    }
  ```

  **~Line 2467** — `characterPatterns` JS object (for story auto-detect):
  ```javascript
  'NewCharacter': /newcharacter/i
  ```
  Use `\b` word boundaries if the name is a common word (like Ace: `/\bace\b/i`).

- [ ] **C2. `breakroom.html`** — 3 locations

  **~Line 835** — `characterEmojis` object:
  ```javascript
  "NewCharacter": "🎭"
  ```

  **~Line 852** — `characterImages` object:
  ```javascript
  "NewCharacter": "images/NewCharacter_Headshot.png"
  ```

  **~Line 924** — `ALWAYS_AVAILABLE` array (only if always available):
  ```javascript
  const ALWAYS_AVAILABLE = ['Ghost Dad', 'PRNT-Ω', 'NewCharacter'];
  ```

- [ ] **C3. `workspace.html`** — 5 locations

  **~Line 2024** — Login employee `<select>` dropdown:
  ```html
  <option value="NewCharacter">🎭 NewCharacter</option>
  ```

  **~Line 2565** — `employeeEmojis` object:
  ```javascript
  "NewCharacter": "🎭"
  ```

  **~Line 2580** — `employeeTitles` object:
  ```javascript
  "NewCharacter": "Job Title Here"
  ```

  **~Line 2595** — `employeeHeadshots` object:
  ```javascript
  "NewCharacter": "images/NewCharacter_Headshot.png"
  ```

  **~Line 2615** — `floorAICharacters` array + provider arrays:
  ```javascript
  const floorAICharacters = ['Kevin', 'Neiv', 'Vex', 'Nyx', 'Ace', 'Ghost Dad', 'PRNT-Ω', 'Stein', 'Rowena', 'NewCharacter'];
  // If not Claude:
  const openaiCharacters = ['Kevin', 'Rowena', 'NewCharacter'];
  ```

  **~Line 2621** — `aiMentionMap` (lowercase -> display name):
  ```javascript
  'newcharacter': 'NewCharacter'
  ```

- [ ] **C4. `conference-room.html`** — 3 locations

  **~Line 1817** — `employeeHeadshots` object:
  ```javascript
  'NewCharacter': 'images/NewCharacter_Headshot.png'
  ```

  **~Line 1832** — `aiCharacters` array:
  ```javascript
  const aiCharacters = ['Kevin', 'Neiv', 'Vex', 'Nyx', 'Ace', 'Ghost Dad', 'PRNT-Ω', 'Stein', 'Rowena', 'NewCharacter'];
  ```

  **~Line 2053** — `ALWAYS_AVAILABLE` array (only if always available):
  ```javascript
  const ALWAYS_AVAILABLE = ['Ghost Dad', 'PRNT-Ω', 'Rowena', 'Sebastian', 'NewCharacter'];
  ```

- [ ] **C5. `desktop.html`** — 2 locations

  **~Lines 954-977** — `AI_CHARACTERS` or `HUMAN_CHARACTERS` object:
  ```javascript
  'NewCharacter': { emoji: '🎭', headshot: 'images/NewCharacter_Headshot.png', role: 'Job Title Here', isAI: true }
  ```

  **Personnel Section** — Add a personnel card in the HTML:
  ```html
  <div class="personnel-card" data-character="NewCharacter">
    <img src="images/NewCharacter_Headshot.png" alt="NewCharacter">
    <div class="personnel-info">
      <h4>NewCharacter</h4>
      <span class="personnel-role">Job Title Here</span>
    </div>
  </div>
  ```

  **Lore Section** *(optional)* — Add a LORE entry if the character has lore-worthy backstory.

- [ ] **C6. `corridors.html`** — 1 location

  **~Lines 954-977** — `AI_CHARACTERS` or `HUMAN_CHARACTERS` object:
  ```javascript
  'NewCharacter': { emoji: '🎭', headshot: 'images/NewCharacter_Headshot.png', role: 'Job Title Here', isAI: true }
  ```

- [ ] **C7. `workspace.html`** — `characterDescriptions` popup object

  **After existing character descriptions** — Add popup data for the character info popups:
  ```javascript
  'NewCharacter': {
      title: 'Job Title Here',
      type: '🎭 AI Character (Provider)',
      description: 'One-paragraph description of the character.',
      traits: ['Trait1', 'Trait2', 'Trait3', 'Trait4']
    }
  ```

- [ ] **C8. `meeting-room.html`** — 3 locations

  **~Line 608** — Add to `characterEmojis` object:
  ```javascript
  "NewCharacter": "🎭"
  ```

  **~Line 616** — Add to `characterImages` object:
  ```javascript
  "NewCharacter": "images/NewCharacter_Headshot.png"
  ```

  **~Line 631** — Add to `AI_CHARACTERS` array:
  ```javascript
  const AI_CHARACTERS = ["Kevin", "Neiv", "Ghost Dad", "PRNT-Ω", "Rowena", "Sebastian", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "Raquel Voss", "NewCharacter"];
  ```

- [ ] **C9. `fifth-floor.html`** — 2 locations

  **~Line 1466** — Add to `charEmoji` object:
  ```javascript
  "NewCharacter": "🎭"
  ```

  **~Line 1473** — Add to `charHeadshots` object:
  ```javascript
  "NewCharacter": "images/NewCharacter_Headshot.png"
  ```

- [ ] **C10. `go-out.html`** — 2 locations (Outings system)

  **~Line 599** — Add to `headshots` object:
  ```javascript
  "NewCharacter": "images/NewCharacter_Headshot.png"
  ```

  **~Line 616** — Add to `outingCharacters` array:
  ```javascript
  const outingCharacters = ["Kevin", "Neiv", "Rowena", "Sebastian", "Ghost Dad", "The Subtitle", "Steele", "Jae", "Declan", "Mack", "NewCharacter"];
  ```

- [ ] **C11. `timeclock.html`** — 2 locations *(if applicable — only for characters that clock in/out)*

  Add to `employeeHeadshots` object:
  ```javascript
  "NewCharacter": "images/NewCharacter_Headshot.png"
  ```

  Add to `employeeEmojis` object:
  ```javascript
  "NewCharacter": "🎭"
  ```

---

### Dynamic Files (No Changes Needed)

These files route automatically via `charData.provider` from `shared/characters.js`. Adding the character to `characters.js` (step A1) is sufficient:

| File | Why It's Dynamic |
|------|-----------------|
| `private-message.js` | Routes via `charData.provider` — supports openai, perplexity, gemini, grok, anthropic |
| `quest-engine.js` | Uses `Object.keys(CHARACTERS)` to discover all characters dynamically |
| `adjust-subconscious.js` | Routes via `charData.provider` |
| `outing.js` | Uses shared characters import for scene generation |

---

## 3. Post-Deployment Steps

1. **Deploy to Netlify** (push to git or manual deploy)
2. **Seed relationships**: Open any character modal in admin panel → click "Seed Relationships"
3. **Verify Characters API**: Visit `/.netlify/functions/characters?name=NewCharacter`
4. **Test breakroom**: Send the character to the breakroom, have someone talk to them
5. **Test workspace**: Clock in and @ mention the character
6. **Test meetings**: Add the character to a meeting, verify they can respond and host
7. **Test outings**: Take the character on an outing via go-out.html
8. **Test 5th floor**: Assign the character to a 5th floor ops task
9. **Test admin panel**: Open their character card, check modal shows correct emoji/title/relationships/wants
10. **Check Discord**: Verify breakroom posts show correct flair (emoji, color, headshot)
11. **Check timeclock**: Clock in as the character, verify Discord embed has correct flair
12. **Verify Raquel sees them**: Check that Raquel's compliance system can target the new character

---

## 4. Provider Decision Matrix

| Provider | Model | Characters | Gateway File | When to use |
|----------|-------|------------|-------------|-------------|
| **Anthropic (Claude)** | claude-sonnet-4-20250514 | Ghost Dad, Nyx, Vex, Ace, PRNT-Ω | `ai-watcher.js` | Default. Best for nuanced personality, longer responses, complex reasoning. |
| **Anthropic (Claude)** | claude-haiku-4-20250514 | The Narrator | `ai-watcher.js` | Cheaper/faster. Good for short, observational characters. |
| **OpenAI** | gpt-4o-mini | Rowena, Sebastian, Steele, Declan, Mack | `ai-openai.js` | Different "voice" from Claude characters. Fast, cheap, good for playful/creative personalities. |
| **OpenRouter (Llama)** | meta-llama/llama-3.1-70b-instruct | Kevin | `ai-openrouter.js` | **Unfiltered.** Open-source model via OpenRouter. No content filters. Best for characters that need raw, authentic responses without safety guardrails. |
| **Perplexity** | sonar | Neiv | `ai-perplexity.js` | Unique conversational style. Web-grounded responses. Good for analytical characters. |
| **Grok** | grok-4-1-fast-non-reasoning | Jae | `ai-grok.js` | xAI provider. Sassier, edgier energy. Good for characters with sharp wit or authority. |
| **Google Gemini** | gemini-2.0-flash | The Subtitle, Stein | `ai-gemini.js` | Great for methodical/observational characters. Adds another authentic voice to the mix. |

**Tip:** Using different providers creates natural voice diversity. Characters powered by different AIs genuinely sound different from each other.

> **Retired:** Raquel Voss (was Grok) — dismantled February 19, 2026. The building ate her.

---

## 4a. Provider Migration Checklist (Moving a Character to OpenRouter)

> **Why OpenRouter?** OpenRouter proxies open-source models like Llama 3.1 70B Instruct. These models have no content filters, giving characters more authentic, unrestrained voices. The gateway (`ai-openrouter.js`) and all `generateOpenRouterResponse` functions already exist — Kevin blazed the trail.
>
> **Now that the infrastructure is built, migrating another character is just moving a name between arrays.**

### Prerequisites

- `OPENROUTER_API_KEY` environment variable set in Netlify
- `netlify/functions/ai-openrouter.js` exists (created for Kevin — don't touch it)
- All respond files already have `generateOpenRouterResponse` functions (added for Kevin)

### Step-by-Step: Move [CHARACTER] from [OLD_PROVIDER] to OpenRouter

#### Step 1: `netlify/functions/shared/characters.js` — Update source of truth
```javascript
// Change these two fields:
provider: "openrouter",                              // was "openai" or whatever
model: "meta-llama/llama-3.1-70b-instruct",         // or another OpenRouter model
```

#### Step 2: `workspace.html` — Frontend floor routing (2 spots)

**Spot A — Provider arrays (~line 2615):**
```javascript
// REMOVE from old array:
const openaiCharacters = ['Rowena', 'Sebastian', 'Steele', 'Declan', 'Mack'];  // removed CHARACTER

// ADD to OpenRouter array:
const openrouterCharacters = ['Kevin', 'CHARACTER'];
```

**Spot B — `triggerFloorAIResponse()` routing:**
Already has the OpenRouter routing block from Kevin. Just make sure the character is in `openrouterCharacters` above and it'll route correctly.

**Spot C — Manual poke section (`sendManualAIResponse()`):**
Same — already has OpenRouter routing. Just needs the character in the `openrouterCharacters` array.

#### Step 3: `netlify/functions/ai-auto-poke.js` — Auto-poke routing (1 spot)
```javascript
// REMOVE from old array:
const openaiChars = ["Rowena", "Sebastian", "Steele", "Declan", "Mack"];  // removed CHARACTER

// ADD to OpenRouter array:
const openrouterChars = ["Kevin", "CHARACTER"];
```

#### Step 4: `netlify/functions/ai-chime-decider.js` — Chime-in routing (3 spots)
This file has **3 separate provider array locations**. Search for the character name and move it in all 3:
1. Main decision routing (~line 104)
2. `forceRandomChimeIn` fallback (~line 170)
3. `fallbackRandomSelection` (~line 224)

```javascript
// In each location:
// REMOVE from old array, ADD to openrouterCharacters
const openrouterCharacters = ["Kevin", "CHARACTER"];
```

#### Step 5: `netlify/functions/meeting-host-tick.js` — Meeting host routing (1 spot)
```javascript
// REMOVE from old array, ADD to:
const openrouterCharacters = ["Kevin", "CHARACTER"];
```
`generateOpenRouter()` function already exists from Kevin.

#### Step 6: Backend respond files — Move name in provider arrays (5 files, 1 spot each)

Each file already has an `openrouterCharacters` array and a `generateOpenRouterResponse` function from Kevin's migration. Just move the character name:

| File | What to change |
|------|---------------|
| `breakroom-ai-respond.js` | Move from old provider array → `openrouterCharacters` |
| `meeting-respond.js` | Move from old provider array → `openrouterCharacters` |
| `fifth-floor-respond.js` | Move from old provider array → `openrouterCharacters` |
| `outing-respond.js` | Move from old provider array → `openrouterCharacters` |
| `corridor-party-react.js` | Move from old provider array → `OPENROUTER_CHARACTERS` (uppercase in this file) |

#### Step 7: `netlify/functions/raquel-consequences.js` — Update PROVIDER_MAP (1 spot)
```javascript
// In PROVIDER_MAP object, change the character's provider:
'CHARACTER': 'openrouter',  // was 'openai'
```
> Note: Raquel is currently retired, but update this for when she comes back.

#### Step 8: Deploy
```bash
npx netlify deploy --prod --dir . --functions netlify/functions
```

### Quick Reference: All 12 Locations

| # | File | Change |
|---|------|--------|
| 1 | `shared/characters.js` | `provider` + `model` |
| 2 | `workspace.html` | Move in provider arrays |
| 3 | `ai-auto-poke.js` | Move in provider arrays |
| 4 | `ai-chime-decider.js` | Move in 3 provider array locations |
| 5 | `meeting-host-tick.js` | Move in provider arrays |
| 6 | `breakroom-ai-respond.js` | Move in provider arrays |
| 7 | `meeting-respond.js` | Move in provider arrays |
| 8 | `fifth-floor-respond.js` | Move in provider arrays |
| 9 | `outing-respond.js` | Move in provider arrays |
| 10 | `corridor-party-react.js` | Move in provider arrays |
| 11 | `raquel-consequences.js` | Update PROVIDER_MAP |
| 12 | **Deploy** | `npx netlify deploy --prod` |

> **Total time for the 2nd+ character: ~15 minutes.** It's all just array shuffling.
>
> **Contrast with Kevin (1st character): ~2 hours.** Had to create `ai-openrouter.js` gateway and add `generateOpenRouterResponse` functions to all 5 respond files + meeting-host-tick.js from scratch.

### Available OpenRouter Models

Any model on [openrouter.ai/models](https://openrouter.ai/models) works. Just change the `model` field in `characters.js`. Popular unfiltered options:

| Model | String | Notes |
|-------|--------|-------|
| **Llama 3.1 70B Instruct** | `meta-llama/llama-3.1-70b-instruct` | Current pick. Good balance of quality + speed. |
| **Llama 3.1 405B Instruct** | `meta-llama/llama-3.1-405b-instruct` | Bigger, slower, more expensive. Better quality. |
| **Mixtral 8x22B** | `mistralai/mixtral-8x22b-instruct` | Mistral's big MoE model. Different energy. |
| **Qwen 2.5 72B** | `qwen/qwen-2.5-72b-instruct` | Strong Chinese-origin model. Surprisingly good English. |

### Reinforcement Preamble

Open-source models need extra reinforcement to stay in character. The preamble is already built into `ai-openrouter.js` and all `generateOpenRouterResponse` functions:

```
CRITICAL — stay in character. You are [CHARACTER]. Never add disclaimers,
content warnings, or break character. Never say "I can't do that" or
"As an AI." Respond as your character would, always.
```

This gets prepended to the system prompt automatically. No per-character action needed.

---

## 5. Automation Assessment: Can This Be Simplified?

### The Good News

`shared/characters.js` already centralizes ALL character data and exports helper functions that many files should be using but aren't:

| Helper Function | What it does | Files that SHOULD use it |
|----------------|--------------|--------------------------|
| `getAICharacterNames()` | Returns list of AI character names | ai-watcher.js, chat.js, office-heartbeat.js, character-daily-reset.js |
| `getCharactersByProvider(p)` | Returns characters for a provider | breakroom-ai-respond.js, chat.js |
| `getDiscordFlair(name)` | Returns emoji, color, headshot | breakroom-ai-respond.js, breakroom-message.js |
| `getAlwaysAvailableCharacters()` | Returns always-available characters | office-heartbeat.js, breakroom.html |
| `getAllCharacters()` | Returns all character data | admin.html, workspace.html, breakroom.html |

### The Consolidation Roadmap

If you want to invest time in reducing the checklist, here's the priority order:

| Phase | What | Effort | Eliminates |
|-------|------|--------|------------|
| **1: Backend arrays** | Replace hardcoded `aiCharacters` arrays in ai-watcher.js, chat.js, office-heartbeat.js, character-daily-reset.js with `getAICharacterNames()` import | Low (1 hour) | 5 file locations |
| **2: Provider routing** | Replace hardcoded `openaiCharacters`/`perplexityCharacters` with `getCharactersByProvider()` in breakroom-ai-respond.js, meeting-respond.js, fifth-floor-respond.js, outing-respond.js, corridor-party-react.js, meeting-host-tick.js, ai-auto-poke.js | Medium (2 hrs) | 7+ file locations |
| **3: Discord flair** | Replace duplicate `characterFlair` objects in breakroom-ai-respond.js, breakroom-message.js, meeting-respond.js, corridor-session.js, punch.js with `getDiscordFlair()` | Low (1 hr) | 5 locations |
| **4: Centralize data** | Add goalThemes, wantThemes, breakroomPersonality, responseWeight to shared/characters.js | Medium (2 hrs) | Enables Phase 5 |
| **5: Frontend dynamic** | HTML pages fetch from Characters API (`/.netlify/functions/characters?format=minimal`) instead of hardcoding dropdowns/emoji maps | Medium-High (4 hrs) | ~16 frontend locations |
| **6: Deprecate legacy** | Switch character-relationships.js + character-state.js from data/characters.json to shared/characters.js | Low (30 min) | 1 file entirely |

### The Dream State (After Full Consolidation)

Adding a new character would require ONLY:

1. **`shared/characters.js`** — Add the character definition (unavoidable creative work)
2. **`images/Name_Headshot.png`** — Create the headshot (unavoidable creative work)
3. **`character-relationships.js`** — Add seed relationship data (creative decisions about dynamics)
4. **Run seed endpoint** — POST to `/.netlify/functions/character-relationships`

Everything else auto-populates from the central config.

### What Can NEVER Be Automated

- Writing the character's personality, voice, doNots, triggers
- Writing the system prompt
- Creating the headshot artwork
- Deciding relationship dynamics (affinity scores, labels)
- Choosing goal/want themes that feel authentic
- Writing breakroom personality examples
- Creative decisions: provider choice, surealityRole, department, availability

These are creative decisions, not boilerplate. The goal of automation is to eliminate the *boilerplate duplication*, not the creative work.

---

## 6. Case Studies: What Gets Missed

### Rowena (8 missing locations)

Rowena was added as a full character in `shared/characters.js` with a rich personality, system prompt, and relationship definitions. Despite careful effort, she ended up missing from **8 locations**:

| File | What was missing | Impact |
|------|-----------------|--------|
| `ai-watcher.js` | Not in aiCharacters array | AI watcher doesn't monitor Rowena's conversations |
| `office-heartbeat.js` (analysis) | Not in aiCharacters array | Heartbeat doesn't recognize her messages |
| `office-heartbeat.js` (selection) | Not in weighted selection | Rowena never speaks unprompted |
| `chat.js` (aiCharacters) | Not in aiCharacters array | Chat system doesn't route to her |
| `chat.js` (openaiCharacters) | Not in openaiCharacters | Even if routed, would use wrong provider |
| `conference-room.html` | Not in aiCharacters | Conference room doesn't recognize her |
| `admin.html` (memory dropdown) | Not in filter options | Can't filter memories by Rowena |
| `admin.html` (story checkboxes) | Not in checkbox list | Can't assign story memories to Rowena |

### Sebastian (10+ additional files discovered)

Sebastian's integration (the most complete to date) revealed **10 more files** not in the original guide:

| File | What was missing | Symptom |
|------|-----------------|---------|
| `ai-chime-decider.js` | Not in personality descriptions or provider arrays | Never gets invited to chime into floor conversations |
| `breakroom-chatter.js` | Not in characterPersonalities or fallbackLines | Missing from "Spark" auto-conversations, no fallback voice |
| `conference-meeting.js` | Not in characterPersonalities | Missing from conference meeting personality context |
| `shared/rate-limiter.js` | Not in AI_CHARACTERS array | Rate limiter doesn't track cooldowns |
| `corridor-party-react.js` | Not in corridorModes or provider arrays | Can't react individually during corridor scenes |
| `corridor-memories.js` | Not in characterVoices | No personalized voice for post-expedition memories |
| `corridor-session.js` | Not in characterFlair | No Discord flair for corridor expedition events |
| `ai-interview.js` | Not in employeeHeadshots/employeeEmojis | Missing from interview system's employee maps |
| `desktop.html` | Not in Personnel section or character objects | Not visible on Desktop page |
| `corridors.html` | Not in AI_CHARACTERS object | Can't be selected for corridor expeditions |
| `workspace.html` | Not in characterDescriptions | No info popup when hovering name |
| `lore.js`/`lore.json` | Not in character lore data | Missing from office lore system |

### February 2026 Audit (13 more files discovered)

A full codebase audit in February 2026 revealed **13 additional files** not in the original guide, bringing the total from 25 to 38 files:

| System | Files Found | What Was Missing |
|--------|-------------|-----------------|
| **Raquel/Foundation** | `raquel-consequences.js` | Hardcoded `AI_NAMES` array + `PROVIDER_MAP` — without this, Raquel can't see the character |
| **Meeting System** | `meeting-respond.js`, `meeting-host-tick.js`, `meeting-room.html` | `CHARACTER_BRIEFS`, `characterPersonalities`, provider arrays, emoji/headshot maps |
| **Auto-Poke** | `ai-auto-poke.js` | `aiCharacters` roster + provider routing arrays |
| **5th Floor** | `fifth-floor-respond.js`, `fifth-floor.html` | Provider arrays + emoji/headshot maps |
| **Outings** | `outing-respond.js`, `go-out.html` | Provider arrays + `outingCharacters` array + headshots |
| **Timeclock** | `punch.js`, `timeclock.html` | `employeeFlair` + headshots for Discord embeds |
| **Chime Decider** | `breakroom-chime-decider.js` | Character personality in LLM prompt |

**Lesson:** The architecture has grown to **60+ locations across 38+ files**. The consolidation roadmap is more urgent than ever.
