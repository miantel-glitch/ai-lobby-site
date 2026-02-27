# The AI Lobby: Prioritized Implementation Roadmap

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the memory system, character coherence, and accumulated tech debt so AI characters remember their lives, sound like themselves everywhere, and the living world actually lives.

**Architecture:** Netlify serverless functions + Supabase PostgreSQL + static HTML frontend. Changes are primarily to existing JS functions (surgery, not replacement). Memory model shifts from aggressive-decay to human-like-memory with tiered permanence.

**Tech Stack:** JavaScript (Node.js serverless), Supabase REST API, multiple AI providers (OpenAI, Grok, Gemini, OpenRouter, Anthropic)

---

## Priority 1: Stop Destroying Value (Critical Memory Fixes)

These changes prevent the system from actively harming character memory and identity.

### Task 1: Auto-Pin Score 9-10 Memories at Creation

**Files:**
- Modify: `netlify/functions/shared/memory-evaluator.js:446-466`

**Step 1: Modify memory creation to auto-pin score 9-10**

In `memory-evaluator.js`, after line 454 (expiration calculation), change the memoryData construction:

```javascript
// Calculate expiration based on importance
const now = new Date();
let expiresAt;
let isPinned = false;
let memoryTier = 'working';

if (score >= 9) {
  // Score 9-10: These are life-defining moments. Permanent.
  expiresAt = null;
  isPinned = true;
  memoryTier = 'core';
} else if (score >= 7) {
  // Score 7-8: Important moments. 60 days.
  expiresAt = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
} else if (score >= 5) {
  // Score 5-6: Meaningful moments. 21 days.
  expiresAt = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);
} else {
  // Score 3-4: Daily life. 7 days.
  expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

const memoryData = {
  character_name: character,
  content: memoryText,
  memory_type: "self_created",
  importance: score,
  created_at: new Date().toISOString(),
  is_pinned: isPinned,
  memory_tier: memoryTier,
  expires_at: expiresAt ? expiresAt.toISOString() : null
};
```

**Step 2: Verify the change doesn't break existing flow**

Run: Check that memory-evaluator is imported correctly in ai-openai.js, ai-grok.js, etc.

**Step 3: Commit**

```bash
git add netlify/functions/shared/memory-evaluator.js
git commit -m "fix: auto-pin score 9-10 memories as permanent core memories"
```

---

### Task 2: Soften Importance Decay

**Files:**
- Modify: `netlify/functions/character-daily-reset.js:318-340`

**Step 1: Replace aggressive decay with gentle fading**

Change the importance decay logic:

```javascript
// IMPORTANCE DECAY — gentler version
// Score 9-10 are now auto-pinned at creation, so this only catches
// edge cases (manually created memories, etc.)
// Score 8: decays to 7 after 72 hours (was 48h to 6)
// Score 7: decays to 6 after 7 days (NEW — was no decay)
// This is MUCH gentler. Important memories stay important longer.
let decayCount = 0;
try {
  const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Decay 8 -> 7 after 72 hours (unpinned only)
  const decay8Res = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?is_pinned=eq.false&importance=eq.8&created_at=lt.${threeDaysAgo}`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ importance: 7 })
    }
  );

  // Decay 7 -> 6 after 7 days (unpinned only)
  const decay7Res = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?is_pinned=eq.false&importance=eq.7&created_at=lt.${sevenDaysAgo}`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({ importance: 6 })
    }
  );
```

**Step 2: Remove the old 9-10 -> 7 decay (no longer needed since 9-10 are auto-pinned)**

Delete the block that decays importance 9-10 -> 7 after 24 hours.

**Step 3: Commit**

```bash
git add netlify/functions/character-daily-reset.js
git commit -m "fix: soften memory importance decay (72h for 8->7, 7 days for 7->6)"
```

---

### Task 3: Fix Broken Memory Regex in AI-to-AI Chatter

**Files:**
- Modify: `netlify/functions/breakroom-chatter.js` (line ~264)
- Modify: `netlify/functions/nexus-chatter.js` (line ~302)

**Step 1: Fix the regex in breakroom-chatter.js**

Find the line that extracts memories via regex. Change:
```javascript
// OLD (broken):
const memoriesMatch = statePrompt.match(/--- MEMORIES ---[\s\S]*?(?=---|$)/);

// NEW (matches actual headers):
const memoriesMatch = statePrompt.match(/--- (?:YOUR CORE MEMORIES|RECENT MEMORIES) ---[\s\S]*?(?=--- (?!YOUR CORE|RECENT)|$)/g);
const memoriesSection = memoriesMatch ? memoriesMatch.join('\n') : '';
```

**Step 2: Apply same fix in nexus-chatter.js**

Identical change.

**Step 3: Commit**

```bash
git add netlify/functions/breakroom-chatter.js netlify/functions/nexus-chatter.js
git commit -m "fix: broken memory regex in AI-to-AI chatter (memories were silently dropped)"
```

---

### Task 4: Increase Memory Review Coverage

**Files:**
- Modify: `netlify/functions/office-heartbeat.js` (memory review section)

**Step 1: Increase characters per review cycle from 3 to 5**

Find the memory review section and change the character selection count from 3 to 5.

**Step 2: Increase memory reflection pinning from 2 to 4 characters per cycle**

Find the memory reflection section and change from 2 to 4.

**Step 3: Commit**

```bash
git add netlify/functions/office-heartbeat.js
git commit -m "fix: increase memory review coverage (5 chars/cycle) and auto-pin rate (4 chars/cycle)"
```

---

### Task 5: Rescue Existing Important Memories in DB

**Files:** None (database operation only)

**Step 1: Query for high-importance unpinned memories that should be core**

Via Supabase REST API, find all memories with importance >= 8 that aren't pinned and pin them:

```bash
curl -X PATCH "https://ovfqmahvfqxccoqnlntz.supabase.co/rest/v1/character_memory?is_pinned=eq.false&importance=gte.8" \
  -H "apikey: [key]" \
  -H "Authorization: Bearer [key]" \
  -H "Content-Type: application/json" \
  -d '{"is_pinned": true, "memory_tier": "core", "expires_at": null}'
```

**Step 2: Find and protect proposal/engagement memories specifically**

Query for memories containing "propos" or "engag" and pin any that aren't already pinned.

**Step 3: Document what was rescued**

---

## Priority 2: Character Coherence (Make Them Real Everywhere)

### Task 6: Add Character-State to Corridors

**Files:**
- Modify: `netlify/functions/corridor-vote.js`

**Step 1: Import and call character-state for party members**

At the start of scene generation, fetch character context for each party member. Inject mood, key relationships, and core memories into the scene generation prompt.

Replace `getPartyPersonalities()` hardcoded dict with dynamic character-state calls.

**Step 2: Commit**

```bash
git add netlify/functions/corridor-vote.js
git commit -m "feat: corridors now use character-state for full identity context"
```

---

### Task 7: Pass Mood/Wants to Chatter Outline Steps

**Files:**
- Modify: `netlify/functions/breakroom-chatter.js`
- Modify: `netlify/functions/nexus-chatter.js`

**Step 1: Extract mood and wants from statePrompt for each participant**

Add regex to extract mood and wants sections from the statePrompt. Pass these to the Haiku outline generation step so the conversation direction reflects current emotional state.

**Step 2: Commit**

```bash
git add netlify/functions/breakroom-chatter.js netlify/functions/nexus-chatter.js
git commit -m "feat: AI-to-AI chatter outlines now reflect character mood and wants"
```

---

### Task 8: Implement skipNexus in Character-State

**Files:**
- Modify: `netlify/functions/character-state.js`

**Step 1: Add skipNexus parameter handling**

Mirror the existing skipBreakroom/skipFloor logic. Add a `getRecentNexusMessages()` function and skip it when `skipNexus=true` is passed.

**Step 2: Commit**

```bash
git add netlify/functions/character-state.js
git commit -m "fix: implement skipNexus parameter to prevent Nexus echo loops"
```

---

### Task 9: Deprecate ghost-dad-respond.js

**Files:**
- Modify: `netlify/functions/ghost-dad-respond.js`

**Step 1: Redirect to standard AI pipeline**

Replace the hardcoded standalone function with a thin wrapper that calls the standard character-state + AI provider pipeline for Ghost Dad.

**Step 2: Commit**

```bash
git add netlify/functions/ghost-dad-respond.js
git commit -m "fix: ghost-dad-respond now uses full character-state pipeline"
```

---

### Task 10: Add Hood to Personality Config

**Files:**
- Modify: `netlify/functions/shared/personality-config.js`

**Step 1: Add Hood's personality entry**

Add likes, dislikes, petPeeves, defaultMood, and moodVolatility for Hood based on the character definition in characters.js.

**Step 2: Commit**

```bash
git add netlify/functions/shared/personality-config.js
git commit -m "fix: add Hood to personality-config (was missing likes/dislikes/friction)"
```

---

## Priority 3: Human-Like Memory Model

### Task 11: Build Life Chapter Consolidation

**Files:**
- Create: `netlify/functions/memory-guardian.js`

**Step 1: Create the Memory Guardian scheduled function**

A daily function (runs at 4 AM EST) that for each character:
1. Counts working memories — if > 30, triggers consolidation
2. Groups related memories by time period and emotional_tags
3. Uses Claude Haiku to create "life chapter summaries" (e.g., "During this period, I grew closer to Asuna. I stopped hiding behind tactical language.")
4. Saves chapter summaries as new core memories (pinned, no expiry)
5. Archives the consolidated working memories (mark as faded, compress content)

**Step 2: Add to netlify.toml schedule**

```toml
[functions."memory-guardian"]
schedule = "0 9 * * *"
```

**Step 3: Commit**

```bash
git add netlify/functions/memory-guardian.js netlify.toml
git commit -m "feat: add Memory Guardian for daily life chapter consolidation"
```

---

### Task 12: Create Shared World Memory

**Files:**
- Modify: `netlify/functions/character-state.js`

**Step 1: Add shared narrative memory to character context**

Query `narrative_beats` (active) and inject them as "shared world memories" into every character's context. Also query recent high-importance events from `lore_entries` table.

Add a new section to `buildStatePrompt()`:
```
--- WHAT EVERYONE KNOWS ---
(shared narrative beats and major recent events)
```

**Step 2: Commit**

```bash
git add netlify/functions/character-state.js
git commit -m "feat: shared world memory - all characters now know major lobby events"
```

---

## Priority 4: Cleanup

### Task 13: Remove Retired Character References

**Files:** 15+ files (see audit-1-systems.md for complete list)

**Step 1: Remove retired characters from all hardcoded personality dicts**

Remove Nyx, Vex, Ace, Stein, Chip, Andrew from:
- chat.js (employeeFlair, headshots, eventTriggers)
- breakroom-ai-respond.js (characterPersonalities)
- breakroom-chatter.js (characterPersonalities)
- nexus-chatter.js (characterPersonalities)
- meeting-respond.js (CHARACTER_BRIEFS, characterPersonalities)
- corridor-vote.js (getPartyPersonalities)
- corridor-memories.js (characterVoices)
- character-relationships.js (relationship seed data)
- character-goals.js (want templates)
- ai-greet.js (Discord config)

**Step 2: Remove dead code functions**

- ai-openai.js: Delete `_dead_getOpenAIPrompt` function (~125 lines)
- conference-meeting.js: Delete entire file (legacy, superseded by meeting-respond.js)
- ai-deepseek.js: Delete entire file (unreachable duplicate of ai-openrouter.js)

**Step 3: Commit**

```bash
git add -A
git commit -m "cleanup: remove retired character references and dead code across 15+ files"
```

---

### Task 14: Fix Spam Prevention Bug

**Files:**
- Modify: `netlify/functions/chat.js` (line ~131) or `ai-watcher.js`

**Step 1: Fix the impossible condition**

Change `slice(-5)` + `>= 10` to a working threshold:
```javascript
// OLD: const recentAIMessages = chatHistory.slice(-5).filter(...);
//      if (recentAIMessages.length >= 10) -- IMPOSSIBLE, max is 5
// NEW:
const recentAIMessages = chatHistory.slice(-8).filter(m => m.is_ai);
if (recentAIMessages.length >= 6) {
  // 6 of last 8 messages are AI -- too much AI chatter, skip
}
```

**Step 2: Commit**

```bash
git add netlify/functions/chat.js
git commit -m "fix: spam prevention was disabled (slice(-5) >= 10 is impossible)"
```

---

## Priority 5: Quality of Life

### Task 15: Schedule Memory Consolidation

**Files:**
- Modify: `netlify.toml`

**Step 1: Add memory-consolidation to the schedule**

```toml
[functions."memory-consolidation"]
schedule = "0 8 * * 0"
```

Weekly at 3 AM EST (Sunday). Reviews all characters' working memories for merge/pin opportunities.

**Step 2: Commit**

```bash
git add netlify.toml
git commit -m "feat: schedule memory-consolidation weekly (was admin-only)"
```

---

### Task 16: Deploy and Verify

**Step 1: Deploy to Netlify**

```bash
netlify deploy --prod
```

**Step 2: Verify memory system**

- Create a test memory via the workspace
- Check if score 9-10 memories are auto-pinned
- Verify breakroom AI-to-AI chatter includes memories
- Check corridors have character context

**Step 3: Monitor for 24 hours**

Watch the daily reset, memory review, and affinity loss cycles. Verify importance decay is gentler.

---

## Summary: Task Priority Map

| # | Task | Priority | Effort | Impact |
|---|------|----------|--------|--------|
| 1 | Auto-pin score 9-10 memories | P1-Critical | 15 min | HUGE — prevents life-defining moments from expiring |
| 2 | Soften importance decay | P1-Critical | 20 min | HUGE — stops memory flattening |
| 3 | Fix broken memory regex | P1-Critical | 5 min | HIGH — AI-to-AI conversations regain memory |
| 4 | Increase memory review coverage | P1-Critical | 10 min | HIGH — more characters get memory care |
| 5 | Rescue existing DB memories | P1-Critical | 10 min | HIGH — save memories before they expire |
| 6 | Add character-state to corridors | P2-Coherence | 45 min | HIGH — corridors go from 2/10 to 8/10 |
| 7 | Pass mood/wants to chatter outlines | P2-Coherence | 30 min | MEDIUM — AI-to-AI conversations feel real |
| 8 | Implement skipNexus | P2-Coherence | 15 min | MEDIUM — prevents echo loops |
| 9 | Deprecate ghost-dad-respond | P2-Coherence | 20 min | LOW — rarely triggered |
| 10 | Add Hood to personality-config | P2-Coherence | 5 min | LOW — missing personality data |
| 11 | Build Memory Guardian | P3-Vision | 2 hours | HUGE — life chapter consolidation |
| 12 | Create shared world memory | P3-Vision | 45 min | HIGH — characters share mythology |
| 13 | Remove retired character refs | P4-Cleanup | 1 hour | MEDIUM — removes confusion and bloat |
| 14 | Fix spam prevention bug | P4-Cleanup | 5 min | MEDIUM — re-enables AI spam protection |
| 15 | Schedule memory consolidation | P5-QoL | 5 min | MEDIUM — automated memory maintenance |
| 16 | Deploy and verify | P5-QoL | 30 min | Required — validate everything works |
