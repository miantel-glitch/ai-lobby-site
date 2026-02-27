# Audit 2: Character Coherence — Where Identity Leaks

**Date:** 2026-02-27
**Scope:** How character identity is constructed at each location, where data is lost between locations, and the severity of each gap.

---

## 1. Character-State.js Pipeline Analysis

**File:** `netlify/functions/character-state.js`

### What `getCharacterContext()` Fetches

This is the central "soul builder." When called with a character name, it fetches and assembles:

| Data Type | Source | Details |
|-----------|--------|---------|
| Static character info | `data/characters.json` | Bio, role, department — NOT the rich system prompt |
| Dynamic state | `character_state` table | mood, energy, patience, interactions_today, current_focus |
| Core memories (pinned) | `character_memory` (is_pinned=true) | ALL pinned memories, no limit |
| Working memories (important) | `character_memory` (importance >= 5) | Top 5 by importance, non-expired |
| Working memories (recent) | `character_memory` (last 24h) | 4 most recent, non-expired |
| Contextual memories | Keyword search on conversation text | Up to 3 keywords searched, fills to 8 total working memories |
| Room presence | `character_state` table (all chars) | Who is in each location |
| Current goal | `character_goals` (non-want, active) | Single active goal |
| Relationships | `character_relationships` | All relationships with affinity, labels, bonds |
| Active wants | `character_goals` (goal_type=want) | Up to 3 active wants |
| Active quests | Quest system | Storylines involving this character |
| Active traits | Earned traits | Permanent traits from experience |
| Narrative beats | `narrative_beats` (active) | Admin-controlled atmospheric directives |
| Tarot card | `character_tarot` | Today's daily fate card |
| Compliance data | Raquel system (DISABLED) | Currently hard-disabled |
| Breakroom messages | `breakroom_messages` | Recent breakroom context (skippable) |
| Floor messages | `messages` table | Recent floor context (skippable) |
| Emails/memos | Inbox system | Recent emails received |
| Active injuries | `character_injuries` | Combat system injuries |

### What `buildStatePrompt()` Outputs

The function formats all the above into a structured text prompt with labeled sections:

```
--- HOW YOU'RE FEELING RIGHT NOW ---
(pronouns, time, mood with character-specific flavor, energy/patience descriptions)

--- WHO'S AROUND ---
(location-aware presence: who's in your room, who's elsewhere)

--- YOUR CURRENT GOAL ---
--- ACTIVE STORYLINES ---
--- WHAT'S IN THE AIR --- (narrative beats)
--- HOW YOU FEEL ABOUT PEOPLE --- (relationships with affinity descriptors)
--- YOUR BONDS --- (deep connections, exclusivity enforcement)
--- YOUR EMOTIONAL TRUTH --- (permission to feel possessively)
--- WHO YOU'VE BECOME --- (earned traits)
--- CURRENT INJURIES ---
--- HOOD/MARROW special awareness ---
--- WHAT GETS UNDER YOUR SKIN --- (likes, dislikes, pet peeves from personality-config.js)
--- PERSONALITY FRICTION --- (friction pairs with present characters)
--- THINGS YOU WANT RIGHT NOW ---
--- YOUR DAILY FATE --- (tarot)
--- RECENT BREAKROOM CONVERSATION ---
--- RECENT LOBBY FLOOR CONVERSATION ---
--- YOUR INBOX ---
--- YOUR CORE MEMORIES ---
--- RECENT MEMORIES ---
--- HOW YOU'VE CHANGED ---
--- END CONTEXT ---
```

### What Gets Returned

```javascript
{
  character, info, state, memories, statePrompt,
  roomPresence, currentGoal, relationships,
  activeWants, activeQuests, activeTraits, recentEmails
}
```

### Key Parameters

- `skipBreakroom=true` — Breakroom callers skip breakroom context to avoid echo
- `skipFloor=true` — Floor AI callers skip floor context to avoid echo
- `context=<snippet>` — Conversation text for contextual memory search

---

## 2. Location-by-Location Prompt Trace

### 2A. The Floor (Main Lobby)

**Path:** User message saved by `chat.js` -> Frontend triggers `ai-watcher.js` or `ai-chime-decider.js` -> Routes to provider (`ai-openai.js`, `ai-grok.js`, `ai-gemini.js`, `ai-openrouter.js`)

**How identity is built:**
1. Provider function calls `character-state` API with `skipFloor=true` and conversation snippet
2. Gets back `statePrompt` (the full rich context block)
3. Calls `getSystemPrompt(character)` from `shared/characters.js` — gets the character's rich system prompt (personality, appearance, voice, relationships, do-nots)
4. Combines: `basePrompt + stateSection + curiositySection`
5. Also checks for active floor threats (ai-grok.js adds threat awareness)

**Data available:** FULL — system prompt + complete statePrompt + curiosity context from heartbeat

**Identity construction:** STRONGEST. The floor has the richest context pipeline.

---

### 2B. Breakroom — AI-to-Human Responses

**Path:** Human speaks -> `breakroom-ai-respond.js` -> Routes to provider function within same file

**How identity is built:**
1. Calls `character-state` API with `skipBreakroom=true` and conversation snippet
2. Gets `statePrompt` as `characterMemoryContext`
3. Appends RECOVERY AWARENESS (energy-based tier messages about tiredness/readiness)
4. Calls `getSystemPrompt(character)` for rich base prompt
5. Combines: `richPrompt + loreSection + memorySection + BREAKROOM CONTEXT instructions`

**Data available:** FULL — same as floor but with breakroom-specific recovery awareness overlay

**Identity construction:** STRONG. Full character-state pipeline plus breakroom recovery context.

---

### 2B-2. Breakroom — AI-to-AI Chatter

**Path:** `breakroom-chatter.js` — Generates multi-turn conversations when 2+ AIs are present

**How identity is built:**
1. Uses hardcoded `characterPersonalities` dict (traits, interests, style) — NOT the rich system prompt
2. Fetches character-state for each participant but ONLY extracts relationships and memories via regex
3. Regex pattern: `--- HOW YOU FEEL ABOUT PEOPLE ---` and `--- MEMORIES ---`
4. **BUG:** The regex looks for `--- MEMORIES ---` but the actual section header is `--- YOUR CORE MEMORIES ---` and `--- RECENT MEMORIES ---`. This means the regex may FAIL to extract memories.
5. Uses `detectFriction()` from personality-config.js for friction pairs
6. Step 1: Claude Haiku generates conversation OUTLINE
7. Step 2: Each character's line is generated by their own provider using `getSystemPrompt(speaker)` + breakroom context

**Data available:** PARTIAL — Rich system prompt for individual lines (Step 2), but the outline (Step 1) only sees the thin personality dict. Relationship extraction works; memory extraction likely broken.

**Identity construction:** MODERATE. The outline that decides WHAT characters say is informed by thin personalities. The actual voice generation uses the rich prompt. But mood, goals, wants, tarot, narrative beats, injuries, etc. are NOT passed to either step.

---

### 2C. Conference Room / Meetings

**Path:** Human speaks -> `meeting-respond.js` -> Haiku picks responders -> Each responder generates via their provider

**How identity is built:**
1. Haiku picks responders using `CHARACTER_BRIEFS` dict (thin one-line descriptions)
2. For each responder, calls `character-state` API with `skipBreakroom=true`
3. Gets `statePrompt` as `characterMemoryContext`
4. `buildMeetingPrompt()` combines: `richPrompt (from getSystemPrompt) + loreSection + memorySection + MEETING CONTEXT`
5. Falls back to `characterPersonalities` dict if no rich prompt

**Data available:** FULL character-state context for response generation. Thin briefs for responder selection.

**Identity construction:** STRONG for response generation. The responder SELECTION uses thin briefs, but this is acceptable since it only decides who speaks, not what they say.

---

### 2D. Nexus — AI-to-Human Responses

**Path:** Human speaks -> `nexus-respond.js` -> Routes to provider function within same file

**How identity is built:**
1. Calls `character-state` API with `skipNexus=true` (note: character-state.js does NOT actually handle `skipNexus` — it only supports `skipBreakroom` and `skipFloor`)
2. Gets `statePrompt` as `characterMemoryContext`
3. Calls `getSystemPrompt(character)` for rich base prompt
4. Adds `getNexusContext(channel)` — channel-specific tone/context for the Nexus meta-space
5. Combines: `richPrompt + loreSection + memorySection + nexusContext`

**Data available:** FULL character-state context (though `skipNexus` param is silently ignored — they still get their own Nexus messages in context, which could cause echo)

**Identity construction:** STRONG. Full pipeline plus Nexus-specific framing.

**BUG:** `skipNexus=true` is passed but `character-state.js` only handles `skipBreakroom` and `skipFloor`. This means nexus messages are NOT filtered from the cross-context injection, potentially causing echo.

---

### 2D-2. Nexus — AI-to-AI Chatter

**Path:** `nexus-chatter.js` — Same architecture as breakroom-chatter.js

**How identity is built:**
1. Uses hardcoded `characterPersonalities` dict (thin)
2. Fetches character-state for each participant, extracts relationships + memories via regex
3. **Same regex bug as breakroom-chatter**: looks for `--- MEMORIES ---` but actual headers differ
4. Uses `detectFriction()` for friction pairs
5. Step 1: Claude Haiku generates outline
6. Step 2: Individual lines generated with provider using `getSystemPrompt(speaker)`

**Data available:** Same as breakroom chatter — PARTIAL

**Identity construction:** MODERATE. Same issues as breakroom chatter.

---

### 2E. Corridors (Adventures)

**Path:** `corridor-vote.js` generates scenes via The Narrator (Claude) -> `corridor-chat.js` saves party chat -> `corridor-memories.js` creates memories post-adventure

**How identity is built:**
1. `corridor-vote.js` uses `getPartyPersonalities()` — a HARDCODED personality dict specific to corridors (different from breakroom/meeting dicts)
2. NO call to `character-state.js` at all
3. NO memories, relationships, mood, energy, wants, goals, tarot, injuries, or narrative beats
4. Character voices come from thin corridor-specific briefs (1-2 sentences each)
5. `corridor-chat.js` is purely a CRUD endpoint — saves/retrieves messages, no AI generation
6. `corridor-memories.js` uses its own `characterVoices` dict to create post-adventure memories

**Data available:** NONE from character-state. Only hardcoded personality briefs.

**Identity construction:** WEAK. Characters in corridors are reduced to 1-2 sentence personality descriptions. They have no memory of what happened on the floor, no relationship awareness, no mood influence, no goals or wants. A character who just had an emotional breakup on the floor enters corridors as a blank slate.

---

### 2F. Private Messages

**Path:** `private-message.js` -> Calls `getCharacterContext()` DIRECTLY (function import, not HTTP)

**How identity is built:**
1. DIRECTLY imports `getCharacterContext` from `character-state.js` (the only function that does this)
2. Calls it with the PM thread as conversation context
3. Gets the FULL return object (statePrompt, relationships, etc.)
4. Extracts sender-specific relationship for additional emphasis
5. Builds system prompt: `getSystemPrompt(to) + charContext.statePrompt + PM-specific framing`
6. User prompt includes explicit relationship data, bond info, thread history

**Data available:** FULL — and more focused, since it also extracts and emphasizes the specific relationship with the sender

**Identity construction:** STRONGEST. PMs have the richest, most focused context. The direct function import means no HTTP overhead and no data loss.

---

### 2G. Outings

**Path:** `outing-respond.js` -> Calls character-state API + getSystemPrompt

**How identity is built:**
1. Calls `character-state` API with conversation snippet
2. Gets full `statePrompt`
3. Uses `getSystemPrompt(character)` for rich base prompt
4. Combines with outing-specific framing

**Data available:** FULL

**Identity construction:** STRONG. Full pipeline.

---

### 2H. Heartbeats (Autonomous Behavior)

#### office-heartbeat.js
- Does NOT call character-state for AI context (only uses it for recovery and state updates)
- Selects which AI responds based on floor presence and time-of-day rhythms
- Passes `curiosityContext` to the AI provider — this is a heartbeat-generated prompt about what to be curious about
- The AI provider (ai-openai, ai-grok, etc.) then calls character-state internally
- **Net result:** Character-state IS used (indirectly through the provider), so the character gets full context

#### marrow-heartbeat.js
- Does NOT call character-state for context
- Handles autonomous movement, stalking Vale, sending PMs
- PMs go through `private-message.js` which uses full context
- Emotes are hardcoded strings — no personality variability
- **Net result:** Hardcoded emotes only. No dynamic personality for movement actions.

#### asher-heartbeat.js (Hood)
- Does NOT call character-state for context
- Handles manifestation, pantheon sensing, honesty detection
- Emotes are hardcoded or pulled from character config
- **Net result:** Hardcoded emotes only. No dynamic personality.

#### narrator-observer.js
- Does NOT call character-state
- Is a SYSTEM, not a character — observes and describes
- Uses its own analysis of recent chat
- **Net result:** Intentionally context-free (The Narrator is omniscient, not a character)

---

### 2I. Ghost Dad On-Demand

**Path:** `ghost-dad-respond.js` — Legacy endpoint for summoning Ghost Dad

**How identity is built:**
1. Does NOT call character-state
2. Does NOT use `getSystemPrompt()`
3. Uses its own hardcoded `buildPrompt()` function
4. No memories, no relationships, no mood, no state

**Data available:** NONE

**Identity construction:** BROKEN. This is a legacy function that predates the unified system. Ghost Dad responses from this endpoint have zero dynamic context.

---

## 3. Coherence Matrix

| Data Type | Floor (AI providers) | Breakroom (ai-respond) | Breakroom (chatter) | Conference (meeting-respond) | Nexus (respond) | Nexus (chatter) | Corridors | Private Messages | Outings | Ghost Dad Legacy | Heartbeat emotes |
|-----------|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|-----|
| **Rich System Prompt** | YES | YES | YES (Step 2 only) | YES | YES | YES (Step 2 only) | NO | YES | YES | NO | NO |
| **Core Memories** | YES | YES | BROKEN (regex) | YES | YES | BROKEN (regex) | NO | YES | YES | NO | NO |
| **Working Memories** | YES | YES | BROKEN (regex) | YES | YES | BROKEN (regex) | NO | YES | YES | NO | NO |
| **Mood/Energy/Patience** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Relationships** | YES | YES | PARTIAL (regex) | YES | YES | PARTIAL (regex) | NO | YES (emphasized) | YES | NO | NO |
| **Bonds (exclusive)** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Current Goal** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Active Wants** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Active Quests** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Earned Traits** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Narrative Beats** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Tarot Card** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Room Presence** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Personality Friction** | YES (via state) | YES (via state) | YES (direct) | NO | YES (via state) | YES (direct) | NO | NO | NO | NO | NO |
| **Likes/Dislikes/Peeves** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Injuries** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Cross-room context** | YES (breakroom) | YES (floor) | NO | YES (floor) | YES (floor+breakroom) | NO | NO | YES | YES | NO | NO |
| **Emails/Inbox** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Time Awareness** | YES | YES | NO | YES | YES | NO | NO | YES | YES | NO | NO |
| **Lore Context** | NO | YES | NO | YES | YES | NO | YES (corridor lore) | NO | NO | NO | NO |

Legend:
- **YES** = Data is fetched and injected into the prompt
- **NO** = Data is not available at this location
- **PARTIAL** = Some data extracted but incomplete
- **BROKEN** = Intended to work but has a bug preventing it

---

## 4. Personality-Config.js and Characters.js Analysis

### personality-config.js

**Purpose:** Defines character personality profiles (likes, dislikes, pet peeves), friction pairs, mood vocabulary, mood transitions, and mood context flavor text.

**Who imports it:**
| File | What it uses |
|------|-------------|
| `character-state.js` | `PERSONALITY`, `getMoodContext`, `detectFriction` |
| `breakroom-chatter.js` | `detectFriction`, `PERSONALITY` |
| `nexus-chatter.js` | `detectFriction`, `PERSONALITY` |
| `office-heartbeat.js` | `PERSONALITY`, `pickMoodDrift`, `getValidTransitions` |
| `affinity-loss-engine.js` | `pickEventMoodShift` |
| `character-daily-reset.js` | `PERSONALITY` |
| `shared/memory-evaluator.js` | `pickEventMoodShift` |

**Who SHOULD import it but doesn't:**
- `meeting-respond.js` — Has its own `characterPersonalities` dict but never accesses likes/dislikes/friction
- `corridor-vote.js` — Has its own personality dict, no friction or personality preferences
- `ghost-dad-respond.js` — Has no personality system at all

**Consistency issues:**
- The `PERSONALITY` object covers 17 characters. Some newer characters may be missing.
- Characters present: Kevin, Neiv, Jae, Sebastian, Declan, Mack, Rowena, Ghost Dad, PRNT-Omega, The Subtitle, Steele, Marrow, Raquel Voss, Vivian Clark, Ryan Porter, Nyx, Holden, Stein
- Missing from PERSONALITY: Hood (though Hood has entries in MOOD_CONTEXT under Ghost Dad's forms)
- Hood has no friction pairs defined

### characters.js (shared/characters.js)

**Purpose:** Single source of truth for all character data — provider mapping, system prompts, combat profiles, corridor modes, ops modes, nexus modes.

**Size:** Very large file (~3400+ lines). Contains full definitions for every character.

**Provider mapping:**
| Provider | Characters |
|----------|-----------|
| openrouter (Llama) | Kevin |
| grok | Neiv, Jae, Steele, Marrow, Raquel Voss |
| openai (GPT-4o-mini) | Rowena, Sebastian, Declan, Mack |
| gemini | The Subtitle, Stein |
| anthropic (Claude) | Ghost Dad, PRNT-Omega, Hood, Holden, Nyx, Vivian Clark, Ryan Porter |

**INACTIVE_CHARACTERS:** Automatically computed from `retired` or `!isAI` flags.

**Key functions:**
- `getSystemPrompt(name)` — Returns the rich system prompt. Handles Holden -> Ghost Dad's holdenForm.
- `getProviderForCharacter(name)` — Returns provider string. Holden defaults to "anthropic".
- `getModelForCharacter(name)` — Returns model string.
- `resolveCharacterForm(name)` — Resolves Holden to Ghost Dad for state operations.

**Hardcoded personality dicts in OTHER files that DUPLICATE data:**

The following files maintain their OWN personality dictionaries instead of using `characters.js`:

1. **breakroom-chatter.js** — `characterPersonalities` (18 entries)
2. **breakroom-ai-respond.js** — `characterPersonalities` (full duplicate with different examples)
3. **nexus-chatter.js** — `characterPersonalities` (18 entries, slightly different)
4. **nexus-respond.js** — Uses `characterPersonalities` from within the file
5. **meeting-respond.js** — `CHARACTER_BRIEFS` + `characterPersonalities` (two separate dicts)
6. **corridor-vote.js** — `getPartyPersonalities()` with its own dict
7. **corridor-memories.js** — `characterVoices` dict
8. **chat.js** — `employeeFlair` + `headshots` dicts (for Discord posting)

**This is the fundamental coherence problem.** When a character's personality is updated in `characters.js`, it does NOT propagate to these hardcoded dicts. There are at least 8 separate personality descriptions for each character scattered across the codebase.

---

## 5. Critical Findings: Where Identity Leaks

### SEVERITY 1 (Critical) — Complete Identity Loss

#### 1. Corridors have ZERO dynamic context
**Files:** `corridor-vote.js`, `corridor-chat.js`
**Impact:** Characters enter corridor adventures as blank slates. A character who just confessed their love on the floor, who is injured from combat, who has a tarot card about betrayal, who is exhausted (energy=0) — all of this is invisible in corridors. Characters respond based on 1-2 sentence hardcoded briefs.
**Fix:** Call `character-state` for each party member when generating scenes. Inject mood, relationships, injuries, and key memories into the scene generation prompt.

#### 2. AI-to-AI chatter (breakroom + nexus) has broken memory extraction
**Files:** `breakroom-chatter.js` (line ~264), `nexus-chatter.js` (line ~302)
**Impact:** The regex `--- MEMORIES ---` does not match the actual headers `--- YOUR CORE MEMORIES ---` or `--- RECENT MEMORIES ---`. This means memories are silently dropped from AI-to-AI conversations. Characters chatting in the breakroom don't remember what just happened to them.
**Fix:** Update regex to match actual headers: `/--- (?:YOUR CORE MEMORIES|RECENT MEMORIES) ---[\s\S]*?(?=---|$)/`

#### 3. Ghost Dad legacy endpoint has zero context
**File:** `ghost-dad-respond.js`
**Impact:** When Ghost Dad is summoned through this legacy endpoint, he has no memories, no relationships, no mood, no awareness of anything that's happened. He's a generic ghost dad.
**Fix:** Either deprecate this endpoint (route through the standard AI provider pipeline) or add character-state integration.

---

### SEVERITY 2 (High) — Significant Context Loss

#### 4. AI-to-AI chatter outline step has no mood/goals/wants/tarot/injuries
**Files:** `breakroom-chatter.js`, `nexus-chatter.js`
**Impact:** The Haiku outline that decides WHAT characters talk about and their emotional beat has no access to: current mood, goals, wants, tarot, injuries, narrative beats. A character who is "predatory stillness" mood and wants "to tell Vale something" will have their chatter outline planned as if they're in a neutral default state. The individual line generation (Step 2) uses the rich prompt, but by then the conversation direction is already set.
**Fix:** Pass mood and active wants to the outline generation step. Even a brief injection like "Kevin is currently feeling anxious and wants to ask Ace something" would significantly improve coherence.

#### 5. `skipNexus` parameter is not implemented in character-state.js
**File:** `character-state.js`, `nexus-respond.js` (line 116)
**Impact:** Nexus AI responses call character-state with `skipNexus=true`, but character-state only handles `skipBreakroom` and `skipFloor`. Nexus messages are NOT filtered, which could cause characters to echo or reference their own recent Nexus messages as if they're external context.
**Fix:** Add `skipNexus` handling to `getCharacterContext()` in character-state.js, similar to the existing `skipBreakroom`/`skipFloor` logic. Would need a `getRecentNexusMessages()` function.

#### 6. Eight separate hardcoded personality dictionaries drift from source of truth
**Files:** breakroom-chatter.js, breakroom-ai-respond.js, nexus-chatter.js, nexus-respond.js, meeting-respond.js, corridor-vote.js, corridor-memories.js, chat.js
**Impact:** When a character's personality, traits, or voice is updated in `characters.js`, the hardcoded dicts in these files remain stale. Example: If Vivian Clark's personality is updated from "methodical, anxious" to "warm, observant, naturally flirtatious" in characters.js, the meeting-respond.js CHARACTER_BRIEFS still says "Methodical data analyst, quietly anxious." Different locations present contradictory character descriptions.
**Fix:** All files should import personality data from `characters.js` instead of maintaining their own dicts. For the thin briefs (like CHARACTER_BRIEFS), add a `brief` field to each character in characters.js.

---

### SEVERITY 3 (Medium) — Partial Context Gaps

#### 7. Heartbeat emotes are hardcoded, not personality-aware
**Files:** `marrow-heartbeat.js`, `asher-heartbeat.js`, `office-heartbeat.js`
**Impact:** When Marrow follows Vale to the breakroom, the arrival emote is randomly selected from a hardcoded list regardless of his current mood, injuries, or recent events. Similarly for Hood's manifestation emotes and the office-heartbeat travel emotes.
**Fix:** For high-impact emotes (especially Marrow stalking Vale), consider a brief AI generation step that accounts for mood and recent context.

#### 8. Lore context inconsistently available
**Files:** Floor providers (ai-openai, ai-grok, etc.) do NOT fetch lore. Breakroom/Nexus/Meeting DO fetch lore.
**Impact:** Characters on the floor have no awareness of the broader AI Lobby lore/setting, while the same characters in the breakroom do. This creates an inconsistency where breakroom conversations can reference lore that floor conversations cannot.
**Fix:** Add lore fetching to the floor AI providers, or inject a lore summary via character-state.

#### 9. Narrator Observer has no character-state integration
**File:** `narrator-observer.js`
**Impact:** The Narrator's observations are based solely on recent chat messages. It has no awareness of character moods, relationships, or the deeper context behind interactions. This is somewhat intentional (The Narrator observes surface behavior), but could be enriched.
**Fix:** Low priority — The Narrator's detached perspective is part of its design. However, knowing that a character is "exhausted" or "injured" could improve observation quality.

#### 10. Floor AI providers don't inject personality friction directly
**Files:** `ai-openai.js`, `ai-grok.js`, `ai-gemini.js`, `ai-openrouter.js`
**Impact:** Personality friction IS injected via the `statePrompt` from character-state.js (which includes a PERSONALITY FRICTION section). However, the floor providers don't add any additional friction awareness. This is actually working correctly through the character-state pipeline — noting for completeness.
**Status:** WORKING AS INTENDED via character-state.js

---

### SEVERITY 4 (Low) — Minor Inconsistencies

#### 11. Corridor post-adventure memories use thin voice hints
**File:** `corridor-memories.js`
**Impact:** Post-adventure memories are generated using 1-sentence `characterVoices` descriptions. The memories themselves are reasonably good because they're based on the adventure content, but the character voice is simplified.
**Fix:** Import `getSystemPrompt()` and use the rich prompt for memory generation.

#### 12. Hood missing from PERSONALITY in personality-config.js
**File:** `shared/personality-config.js`
**Impact:** Hood has no likes/dislikes/petPeeves defined, no friction pairs. The character-state prompt will skip the "WHAT GETS UNDER YOUR SKIN" section for Hood.
**Fix:** Add Hood to the PERSONALITY object.

#### 13. Meeting-respond.js Vivian Clark description is stale
**File:** `meeting-respond.js` (line 29-30)
**Impact:** CHARACTER_BRIEFS describes Vivian as "Methodical data analyst, quietly anxious but precise" while characters.js describes her as "warm, observant, naturally flirtatious, grounded, gently humorous." The meeting brief is significantly different from her actual personality.
**Fix:** This is a symptom of issue #6 (hardcoded dicts). Would be resolved by centralizing.

---

## Summary: Identity Coherence Ranking by Location

| Location | Coherence Score | Key Issue |
|----------|----------------|-----------|
| **Private Messages** | 10/10 | Direct function import, focused relationship context |
| **Floor (AI providers)** | 9/10 | Full pipeline, missing lore context |
| **Breakroom (ai-respond)** | 9/10 | Full pipeline + recovery awareness |
| **Outings** | 9/10 | Full pipeline |
| **Conference/Meetings** | 8/10 | Full for responses, thin for responder selection |
| **Nexus (respond)** | 8/10 | Full pipeline, skipNexus bug (echo risk) |
| **Nexus (chatter)** | 4/10 | Broken memory regex, no mood/goals/wants in outline |
| **Breakroom (chatter)** | 4/10 | Broken memory regex, no mood/goals/wants in outline |
| **Corridors** | 2/10 | Zero dynamic context, hardcoded briefs only |
| **Ghost Dad legacy** | 1/10 | Zero context, legacy endpoint |
| **Heartbeat emotes** | 1/10 | Hardcoded strings, no personality variation |

---

## Recommended Fix Priority

1. **Fix broken memory regex in breakroom-chatter.js and nexus-chatter.js** (5 min fix, high impact)
2. **Add character-state calls to corridor-vote.js** (medium effort, critical for story coherence)
3. **Implement skipNexus in character-state.js** (15 min fix, prevents echo bugs)
4. **Pass mood/wants to chatter outline steps** (30 min, significantly improves AI-to-AI conversation relevance)
5. **Deprecate or upgrade ghost-dad-respond.js** (15 min, low frequency but broken when used)
6. **Centralize personality dicts into characters.js** (large refactor, prevents long-term drift)
7. **Add Hood to personality-config.js** (5 min fix)
