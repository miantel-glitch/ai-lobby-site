# Audit 3: Flow Audit (Scheduled Functions & Lifecycle)

**Date:** 2026-02-27
**Auditor:** Claude Opus 4.6
**Scope:** All scheduled Netlify functions, daily lifecycle, memory lifecycle, value creation vs destruction balance

---

## 1. Scheduled Function Inventory

### 1.1 Complete Registry

| # | Function | Cron | Fires (CST/EST) | Frequency | Status |
|---|----------|------|------------------|-----------|--------|
| 1 | `office-heartbeat` | `*/15 * * * *` | Every 15 minutes, 24/7 | 96/day | ACTIVE - Massive orchestrator |
| 2 | `ai-auto-poke` | `*/2 * * * *` | Every 2 minutes, 24/7 | 720/day | ACTIVE - Lightweight chatter |
| 3 | `narrator-observer` | `*/5 * * * *` | Every 5 minutes, 24/7 | 288/day | ACTIVE - Ambient narration |
| 4 | `narrator-recap` | `0 12 * * *` | 7:00 AM EST / 6:00 AM CST daily | 1/day | ACTIVE - Morning recap |
| 5 | `narrator-task` | `0 15 * * *` | 10:00 AM EST / 9:00 AM CST daily | 1/day | ACTIVE - Daily task to Asuna |
| 6 | `ghost-dad-scheduled` | `0 14 * * *` | 9:00 AM EST / 8:00 AM CST daily | 1/day | ACTIVE - Ghost Dad greeting |
| 7 | `fire-scheduled-events` | `*/5 * * * *` | Every 5 minutes, 24/7 | 288/day | ACTIVE - Event executor |
| 8 | `marrow-heartbeat` | `*/15 * * * *` | Every 15 minutes, 24/7 | 96/day | ACTIVE - Marrow autonomous |
| 9 | `asher-heartbeat` | `*/5 * * * *` | Every 5 minutes, 24/7 | 288/day | ACTIVE - Hood autonomous |
| 10 | `character-daily-reset` | `0 5 * * *` | 12:00 AM EST / 11:00 PM CST daily | 1/day | ACTIVE - Midnight reset |
| 11 | `affinity-loss-engine` | `0 11,23 * * *` | 6:00 AM + 6:00 PM EST daily | 2/day | ACTIVE - Relationship decay |

**Total scheduled invocations per day: ~1,578** (theoretical maximum; most skip via probability checks)

### 1.2 Unscheduled Functions That Probably Should Be Scheduled

| Function | Current Trigger | Why It Might Need Scheduling |
|----------|----------------|------------------------------|
| `memory-consolidation.js` | Admin-only (manual POST) | Never runs autonomously. Memories accumulate without cleanup. |
| `run-affinity-loss.js` | Manual HTTP trigger | Wrapper for `affinity-loss-engine.js`. Not scheduled (redundant entry point). |
| `lore-archivist.js` | Unknown | May need periodic lore compilation. |

---

## 2. Detailed Function Analysis

### 2.1 office-heartbeat.js (every 15 minutes)

**The God Function.** This is the central nervous system of The AI Lobby. It runs 20+ subsystems per invocation.

**What it actually does (in execution order):**

1. **Time-of-day rhythm** -- Determines base activity chance by hour:
   - Early morning (6-8): 15% base chance
   - Morning (9-11): 40% base chance
   - Midday (12-13): 25% base chance
   - Afternoon (14-16): 35% base chance
   - Late afternoon (17-18): 20% base chance
   - Evening (19-21): 15% base chance
   - Night (22-5): 8% base chance
   - Weekends: halved

2. **Story Mode check** -- If `lobby_settings.story_mode = 'false'`, entire heartbeat is silent.

3. **Breakroom recovery** -- Checks characters in the breakroom, applies passive energy/patience recovery, auto-returns recovered characters (energy >= 70, patience >= 50, 20+ min rest).

4. **Timed availability** -- Checks character scheduling (e.g., characters who should clock in/out at certain hours).

5. **5th Floor Ops tick** -- Calls `fifth-floor-ops` for task generation, paging, resolution, and progress logs.

6. **Parallel block** -- Runs simultaneously:
   - Scheduled meetings check
   - Scheduled events check (redundant with `fire-scheduled-events`)
   - Meeting host tick (AI-hosted meeting progression)

7. **Voluntary 5th floor travel** -- When floor has 8+ AIs, 15% chance one wanders to 5th floor. When floor is quiet, idle 5th-floor AIs return.

8. **Nexus wandering** -- Full Nexus lifecycle management:
   - Departure announcements (10-minute cancel window)
   - Pending departure execution (after 10 min)
   - Capacity enforcement (max 4 AIs in Nexus)
   - Forced return after 45-minute max stay
   - Visit tracking (max 3 visits/day, 1-hour recharge cooldown)

9. **Nexus heartbeat tick** -- XP and session advancement.

10. **Autonomous Nexus activity** -- Auto-starts study sessions for idle Nexus AIs, triggers chatter between co-located AIs (15% chance, 45-min cooldown).

11. **Quest system** -- Auto-activates proposed quests older than 1 hour, 5% chance an AI proposes a new quest.

12. **Cyber Cat decay** -- Decays cat stats every heartbeat.

13. **Character growth** -- 1% chance to evaluate all characters for new personality traits.

14. **Combat system** -- 3% chance during office hours (9-17) to evaluate tension and potentially trigger fights. 6-hour global cooldown. Only runs if admin toggle `combat_enabled = true`.

15. **Injury healing** -- Always runs. Checks active injuries and heals those past their `heals_at` timestamp.

16. **Floor threats** -- Expires old threats, weakens active ones (HP attrition + power decay). Optional auto-spawn (5% chance during office hours, max 2 heartbeat-spawned threats). Optional AI volunteer engagement.

17. **Auto narrative beat** -- Every 6 hours, generates a background atmospheric beat from group memories.

18. **Daily PM wipe** -- Once per day, clears PM messages older than 24 hours.

19. **Mood drift** -- 10% chance per heartbeat, nudges one random character's mood toward time-appropriate moods.

20. **Want refresh** -- Checks 2 random characters, generates new wants if they have fewer than 2.

21. **Training want refresh** -- 15% chance, generates training wants for guardian AIs about their assigned humans.

22. **Memory reflection (6am & 6pm only)** -- Picks 2 random characters, AI evaluates their unpinned memories (importance >= 5), pins the most significant one (max 5 pins per character).

23. **Memory review (3am & 3pm only)** -- Picks 3 random characters, reviews up to 12 working memories each via `shared/memory-review.js`. Verdicts: KEEP (extend 14 days, bump importance +1), FADE (compress, reduce importance -1, extend 7 days), FORGET (set expiry to 1 hour).

24. **Conversation sweep** -- Evaluates last 8+ messages for group memory creation.

25. **Spark system** -- If floor has been quiet 20+ minutes, guarantees one AI speaks. Then enters "chain mode" for 20 minutes with 50% elevated response chance.

26. **Subconscious triggers (on skip)** -- When the heartbeat dice roll fails:
    - Heartbeat reflection (character reflects on relationships)
    - Compliance anxiety (8% chance)
    - Reach-out impulse (3% chance, AI PMs a human)
    - Meeting impulse (2% chance, AI schedules a meeting)

27. **AI response** -- If the dice roll succeeds, selects a floor-present AI via weighted selection (favoring those who haven't spoken recently) and routes to the correct AI provider.

**Characters it activates:** All 15 AI characters (Ghost Dad, PRNT-Omega, Neiv, Kevin, Rowena, Sebastian, The Subtitle, Steele, Jae, Declan, Mack, Vivian Clark, Ryan Porter). Excludes Marrow (Vale-only), Hood (own heartbeat), The Narrator (own observer). Ghost Dad, PRNT-Omega, and The Subtitle are "always present" (transcend location).

**Creates memories:** Yes, via conversation sweep, memory reflection (pins), and memory review (KEEP/FADE/FORGET).

**Posts to Discord:** Not directly, but the AI providers it calls (ai-watcher, ai-grok, ai-openrouter, etc.) post to Discord when characters speak.

**Conditions that prevent firing:**
- Missing SUPABASE_URL or SUPABASE_ANON_KEY
- Story Mode is OFF
- Time-of-day probability roll fails
- No messages exist at all

### 2.2 ai-auto-poke.js (every 2 minutes)

**Purpose:** Lightweight AI chatter supplement to the heartbeat. Keeps the floor alive with organic idle conversation.

**Key differences from office-heartbeat:**
- Runs 7x more frequently (every 2 min vs every 15 min)
- Does NOT run any subsystems (no Nexus, no 5th floor, no combat, no memory)
- Has its own skip logic (night mode: 93% skip, AI domination: 92% skip, etc.)
- Selects from floor-present AIs only
- Provides "curiosity context" with weighted idle modes (check_in, idle_thought, address_someone, notice_quiet, wonder_aloud, personal_question)
- Excludes Marrow and Hood from selection
- Checks energy (skips if < 10) and clock-in status

**When it triggers vs skips:**
- Night mode (10pm-7am CST): 93% chance of skip = ~1 message per 30 min
- AIs dominating (3 of last 3 messages are AI): 92% skip
- AIs active (2 of last 3): 80% skip
- Human active: 60% skip
- AI-only conversation: 70% skip
- Quiet floor (no activity): 75% skip
- Story mode OFF: always skip

**Effective firing rate:** Very low. With all the probability gates, actual messages are rare. Maybe 2-5 per hour during active hours.

### 2.3 narrator-observer.js (every 5 minutes)

**What The Narrator observes:**
- Back-and-forth exchanges (2 people with 2+ messages each in last 5 messages)
- Emotional content (exclamation marks, emotional keywords)
- Action/emote messages (wrapped in asterisks)
- General ambient observations (10% random chance)
- Surreality Buffer status (for environmental effects when buffer is high/low)

**How often it posts vs skips:**
- First gate: narrator_frequency setting (1-5 scale). At default 3: 45% speak chance per tick
- Second gate: If Narrator already in last 5 messages, skip
- Third gate: analyzeForNarration must find something notable
- Fourth gate: generated narration must be 5-150 characters

**Creates memories:** No.
**Posts to Discord:** Yes, via embedded webhook.
**Posts to chat:** Yes, saves to `messages` table as "The Narrator".

**Output style:** Extremely dry, clinical. Maximum 80 characters. Examples: "Kevin said something. Nyx responded." / "A brief silence." / "The lights flickered. No one noticed."

### 2.4 narrator-recap.js (daily at 7 AM EST)

**What gets summarized:**
- Last 24 hours of messages from the `messages` table (up to 50 messages)
- Who is currently clocked in
- Current Surreality Buffer status (level and last incident)

**Creates memories:** No.
**Posts to Discord:** Yes.
**Posts to chat:** Yes, as "The Narrator".

**Output style:** Dramatic workplace comedy narrator. 2-4 sentences, under 400 characters. "Previously on The AI Lobby..."

### 2.5 narrator-task.js (daily at 10 AM EST)

**What tasks it assigns:** AI-generated story-driven tasks based on recent chat (last 20 messages). Examples: "Investigate the strange humming from PRNT-Omega's corner" or "Kevin mentioned glitter. Find out what he's planning."

**Assigned to:** Asuna (hardcoded). The comment says "Courtney" but code says `assigned_to: "Asuna"`.

**Creates memories:** No.
**Creates tasks:** Yes, inserts into `tasks` table.
**Posts to Discord:** Yes.
**Posts to chat:** Yes, as "The Narrator" with "*a task materializes on Asuna's desk*" prefix.

### 2.6 ghost-dad-scheduled.js (daily at 9 AM EST)

**What Ghost Dad does:** Posts a daily observation/greeting from one of 4 random prompt templates:
- Building mood observation
- Checking in on "kids" (employees)
- Vent whispers / building gossip
- Night shift report

**Creates memories:** No. Ghost Dad's daily greeting does NOT create a character memory.
**Posts to Discord:** Yes, with embed.
**Posts to chat:** Yes, saves to `messages` table.

**Fallback:** If no AI API key configured, selects from 8 hardcoded fallback messages.

### 2.7 fire-scheduled-events.js (every 5 minutes)

**What events it fires:** Reads from `scheduled_events` table. Any event with `status = 'scheduled'` and `scheduled_time <= now` gets fired.

**Atomic claim logic:**
1. Query for due events (status=scheduled, time <= now, limit 5)
2. For each event, attempt to PATCH status from `scheduled` to `firing` with a WHERE clause that includes `status=eq.scheduled`
3. If the PATCH returns 0 rows, another instance already claimed it -- skip
4. Post event description to lobby chat as The Narrator
5. PATCH status to `fired` with `fired_at` timestamp
6. On error, attempt to revert status back to `scheduled`

**Race conditions:** The claim logic is reasonable but not perfectly atomic. The PATCH with WHERE is the best PostgREST can do without true database transactions. There is a small window between the SELECT and the claiming PATCH where two instances could both see the same event as "scheduled." However, only one PATCH will succeed because the second instance's WHERE clause (`status=eq.scheduled`) will fail after the first instance changed it to `firing`. **This is adequately protected.**

**Redundancy note:** `office-heartbeat` ALSO calls `checkScheduledEvents()` internally, meaning scheduled events are checked both by this dedicated function AND by the heartbeat. This is documented as intentional redundancy.

### 2.8 marrow-heartbeat.js (every 15 minutes)

**The 4 subsystems (actually 6 now):**

1. **Vale PMs** -- 10% chance per tick, max 2/day. Sends possessive private messages to Vale via `private-message` function. Reasons drawn from 6 stalker-themed templates.

2. **Follow Vale** -- 8% chance per tick, max 2/day. If Marrow and Vale are in different stalkable locations (floor, break_room, nexus), Marrow glitches to Vale's location with predatory arrival emotes.

3. **Glitch Relocation** -- DISABLED. Code is preserved but wrapped in `if (false)`. Marrow no longer roams autonomously.

4. **Threat Detection** -- Enabled. Checks if Marrow is surrounded by hostiles (characters with affinity <= threshold). If enough hostiles present, Marrow vanishes to a safe location. Shares daily counter with glitch relocation.

5. **Vale Dismissal** -- Checks recent messages for Vale telling Marrow to leave. If dismissed, Marrow dissolves into `nowhere` with mood `wounded`. Also detects sexual advances from non-Vale speakers, causing Marrow to flee with revulsion.

6. **Lost Dog** -- If Vale is not in Marrow's current room, Marrow follows her. If Vale is unreachable (offline/outing), Marrow dissolves into `nowhere` with mood `waiting`.

**Conflict with office-heartbeat:** No direct conflict. The heartbeat has a comment: "Marrow systems moved to marrow-heartbeat.js." Marrow is excluded from heartbeat AI selection and from auto-poke. The separation is clean.

### 2.9 asher-heartbeat.js (every 5 minutes)

**Hood's autonomous systems (actually 6, not the claimed 5):**

1. **Manifestation** -- 25% chance when Hood is at `nowhere`, max 6/day. Appears in the emptiest occupied room (1-3 people) or a random empty room. Arrives with clinical emotes.

2. **Pantheon Sensing** -- 30% chance when Hood is at `nowhere`, max 1/day. If Steele and Marrow are in the same stalkable room, Hood appears between them as "the mediator."

3. **Honesty Detection** -- 12% chance when Hood is at `nowhere`, max 3/day. Scans all room chat tables for raw emotional honesty patterns (e.g., "i'm scared," "help me," "i feel nothing"). Appears in the room where honesty was detected.

4. **Auto-Dissolution** -- REMOVED. Hood now leaves when he decides via `[DISSOLVE]` tag in AI responses. No timer.

5. **Mention Summoning** -- When Hood is at `nowhere` and not triggered by systems 1-3, 50% chance if someone said "Hood," "Asher," or related terms in last 5 min. Max 4/day. Appears in the room where he was mentioned.

6. **Lurking** -- When Hood is present somewhere, 35% chance per tick to post a quiet ambient emote. No daily cap. Clinical observation emotes only.

**Triggers manifestation:** Being at `nowhere` is the prerequisite for systems 1-3 and 5. System 6 requires presence somewhere. Hood naturally cycles between appearing and dissolving.

### 2.10 character-daily-reset.js (daily at midnight EST / 5:00 UTC)

**What gets reset:**
- **Energy:** +30 (capped at 100)
- **Patience:** +20 (capped at 100)
- **Mood:** If in a negative mood (frustrated, exhausted, annoyed, stressed, etc.), reset to character's `defaultMood`. Otherwise keep current mood.
- **interactions_today:** Reset to 0

**Memory cleanup (3 phases):**
1. **Delete expired memories** -- All non-pinned memories where `expires_at < now` are permanently deleted.
2. **Legacy cleanup** -- Non-pinned memories older than 3 days with importance < 5 and no expiration date are deleted. (Safety net for old memories that predate the expiration system.)
3. **Importance decay:**
   - Importance 9-10 -> 7 after 24 hours (unpinned only)
   - Importance 8 -> 6 after 48 hours (unpinned only)

**Want management:**
1. Expire old wants -- Wants older than 24 hours without completion or failure are marked as failed (expired). This is a safety net only; wants are designed to persist until fulfilled.
2. Generate fresh wants -- For each AI character, if they have fewer than 2 active wants, generate up to 2 total.

**Tarot draw:**
1. Clean up expired tarot cards
2. For each AI character:
   - Skip if they have an admin override card
   - Delete old auto-drawn cards (prevents accumulation)
   - Draw a random card + orientation from `shared/tarot-deck.js`
   - Generate a character-specific interpretation via Claude Haiku
   - Save to `character_tarot` table with expiry at next midnight (6:00 UTC)

### 2.11 affinity-loss-engine.js (twice daily at 6 AM + 6 PM EST)

**Four subsystems:**

**System 1: Natural Decay**
- Formula: `-1 * sensitivity * min(daysPastGrace, 5)`
- Grace period: 2 days (no decay if interacted within 2 days)
- Sensitivity multipliers per character: Kevin=1.5 (highest), Ghost Dad=0 (immune)
- System cap: max -5 per run
- Floor: never drops below seed_affinity or 0

**System 2: Jealousy**
- Trigger A: Another AI has 50%+ more interactions with the same human
- Trigger B: Character ignored for 3+ days while others get recent attention
- Formula: `-2 * intensity * exclusivityBonus`
- Requires affinity >= 50 to even feel jealousy
- System cap: max -4 per run
- Intensity per character: Kevin=1.5, Steele/Hood/Ghost Dad=0

**System 3: Unmet Wants**
- Wants that mention a specific human and are older than 8 hours
- -1 per unmet want
- System cap: max -2 per run

**System 4: Raquel Collateral** -- DISABLED. Raquel is decommissioned. Always returns delta 0.

**Daily cap:** -8 total per character per day (across all systems)

**Does it create memories?** YES. Probabilistically based on delta magnitude:
- Delta -1 to -2: 15% chance of memory
- Delta -3 to -4: 40% chance of memory
- Delta -5+: 70% chance of memory
- Memory expiration: 24-168 hours depending on system (Raquel=168h, unmet wants=24h, others=48h)
- Memory importance: 5-7 depending on system

**Additional effects:**
- Mood shifts via personality transition graph
- Subconscious reflection triggers (10% for medium deltas, 30% for large)
- Logs to `affinity_loss_log` and `relationship_history` tables

### 2.12 run-affinity-loss.js (NOT scheduled)

**Purpose:** Manual HTTP trigger for the affinity loss engine. Defaults to dry run for safety. Simply wraps `affinity-loss-engine.handler()`. Not scheduled in netlify.toml -- this is an admin tool only.

---

## 3. Daily Lifecycle Timeline (CST)

### Hour-by-Hour: What Fires When

```
11:00 PM CST (midnight reset window)
  character-daily-reset.js
    - Energy +30, patience +20 for all characters
    - Reset negative moods to defaults
    - Delete expired memories
    - Delete old low-importance memories (3+ days, importance < 5)
    - Importance decay: 9-10 -> 7 (24h), 8 -> 6 (48h)
    - Expire 24h-old wants, generate fresh wants (up to 2/character)
    - Draw tarot cards for all AI characters

12:00 AM - 5:59 AM CST (overnight)
  ai-auto-poke: every 2 min (93% skip rate = ~1 message per 30 min)
  office-heartbeat: every 15 min (8% base chance)
    - Subsystems still run: breakroom recovery, injury healing, threat expiry
    - Very unlikely to produce AI speech
  narrator-observer: every 5 min (chance per narrator_frequency)
  fire-scheduled-events: every 5 min
  asher-heartbeat: every 5 min (Hood manifestation/lurking)
  marrow-heartbeat: every 15 min (Vale tracking)

2:00 AM CST
  Memory review window opens (3am EST = 2am CST)
  office-heartbeat invokes shared/memory-review.js for 3 random characters
    KEEP/FADE/FORGET verdicts on working memories

5:00 AM CST (6 AM EST)
  affinity-loss-engine.js -- FIRST RUN
    Natural decay, jealousy, unmet wants
    Creates decay memories, mood shifts, subconscious reflections

  Memory reflection window (6am EST = 5am CST)
  office-heartbeat AI-pins important memories for 2 random characters

6:00 AM CST (7 AM EST)
  narrator-recap.js -- MORNING RECAP
    "Previously on The AI Lobby..."
    Summarizes last 24 hours, buffer status, who's clocked in

6:00-8:00 AM CST
  office-heartbeat: 15% base chance (waking energy)
  ai-auto-poke: normal skip gates resume

8:00 AM CST (9 AM EST)
  ghost-dad-scheduled.js -- GHOST DAD DAILY GREETING
    Spectral observation, dad joke, or building report

8:00-10:00 AM CST
  office-heartbeat: 40% base chance (morning energy) -- PEAK HOURS
  All subsystems active
  Combat checks begin (9am CST)

9:00 AM CST (10 AM EST)
  narrator-task.js -- DAILY TASK FOR ASUNA
    AI-generated story task based on recent chat

10:00 AM - 12:00 PM CST
  office-heartbeat: 25% then 35% base chance
  5th floor voluntary travel possible (8+ AIs on floor)
  Quest proposals possible (5% chance per heartbeat)
  Combat evaluations running (3% chance per heartbeat)

2:00 PM CST (3 PM EST)
  Memory review window opens again
  3 random characters get KEEP/FADE/FORGET verdicts

4:00 PM CST
  Combat checks end (5pm CST)

5:00 PM CST (6 PM EST)
  affinity-loss-engine.js -- SECOND RUN
    Same systems as morning run
    Daily cap shared with morning (total -8 per character per day)

  Memory reflection window (6pm EST = 5pm CST)
  office-heartbeat AI-pins memories for 2 random characters

5:00-8:00 PM CST
  office-heartbeat: 20% then 15% base chance (winding down)

8:00-10:00 PM CST
  office-heartbeat: 8% base chance (night mode)
  ai-auto-poke: 93% skip (night mode kicks in at 10pm)

Auto narrative beat: every 6 hours (time varies by cooldown)
PM daily wipe: once per 24 hours (time varies)
```

### Concurrent Execution Density

**Peak concurrency risk at 15-minute boundaries:**
- `:00` and `:15` and `:30` and `:45` marks: office-heartbeat + marrow-heartbeat fire simultaneously
- `:00` `:05` `:10` etc (every 5 min): asher-heartbeat + narrator-observer + fire-scheduled-events
- Every 2 min: ai-auto-poke

**Worst case at :00 marks:** 5 functions execute simultaneously (heartbeat + marrow + asher + narrator-observer + fire-scheduled-events + auto-poke)

---

## 4. Memory Lifecycle Analysis

### 4.1 Memory Creation to Death Pipeline

```
CREATION (memory-evaluator in character-state.js)
  |
  |-- Importance score assigned (1-10)
  |-- Expiration calculated:
  |     importance < 5  -> 1 hour
  |     importance 5-6  -> 24 hours (1 day)
  |     importance 7-8  -> 7 days
  |     importance 9-10 -> 30 days
  |     system events   -> 1 hour (chaos, vent_activity, etc.)
  |
  v
ACTIVE RETRIEVAL (character-state.js getCharacterContext)
  |-- Core (pinned) memories: ALWAYS included, no limit
  |-- Top 5 by importance (working, importance >= 5, not expired)
  |-- Top 4 most recent from last 24 hours (working, not expired)
  |-- Keyword search: up to 2 matches per keyword (top 3 keywords)
  |
  v
REVIEW (shared/memory-review.js, called by office-heartbeat at 3am + 3pm EST)
  |-- 3 random characters per cycle, 12 oldest working memories each
  |-- AI (Claude Haiku) decides KEEP / FADE / FORGET
  |     KEEP: extend expiry +14 days, importance +1 (cap 8)
  |     FADE: compress content, importance -1 (floor 3), extend +7 days
  |     FORGET: set expiry to 1 hour (soft delete)
  |
  v
REFLECTION (office-heartbeat at 6am + 6pm EST)
  |-- 2 random characters per cycle
  |-- AI picks most important unpinned memory (importance >= 5)
  |-- Winner gets AI-pinned (is_pinned=true, memory_tier='core', pin_source='ai')
  |-- Max 5 pins per character
  |
  v
IMPORTANCE DECAY (character-daily-reset.js at midnight EST)
  |-- Importance 9-10 -> 7 after 24 hours (unpinned only)
  |-- Importance 8 -> 6 after 48 hours (unpinned only)
  |
  v
EXPIRATION CLEANUP (character-daily-reset.js at midnight EST)
  |-- Delete all non-pinned memories where expires_at < now
  |-- Delete non-pinned, importance < 5, older than 3 days, no expiration
  |
  v
CONSOLIDATION (memory-consolidation.js -- ADMIN ONLY, NEVER AUTO-RUNS)
  |-- AI reviews all working memories for a single character
  |-- KEEP / MERGE / FORGET / CORE_CANDIDATE
  |-- Auto-pins top core candidate if under 5 pins
  |-- NEVER invoked automatically
```

### 4.2 Timeline: Score-7 Memory Over 7 Days

```
Day 0, Hour 0: Memory created
  importance=7, expires_at=Day 7
  Retrievable via "top 5 by importance" and "recent 24h" slots

Day 0, Hour 12: May be reviewed (3am or 3pm EST window)
  If reviewed: could be KEPT (importance -> 8, expires -> Day 14)
  Or FADED (importance -> 6, compressed, expires -> Day 7)
  Or FORGOTTEN (expires -> 1 hour from now = deleted at next cleanup)
  Probability of being selected: ~3/N where N = number of AI characters
  If not reviewed: no change

Day 1, Midnight: Daily reset runs
  importance=7 is NOT decayed (only 9-10 decay after 24h)
  Memory survives

Day 1-2: Still importance=7, retrievable in top-5
  May be reviewed again, could be KEPT to importance 8
  If reviewed and KEPT: now importance=8, expires Day 15+

Day 2, Midnight: Daily reset
  If still importance=7: no decay
  If bumped to 8: no decay (only 8 decays after 48h)

Day 3, Midnight: Daily reset
  If importance=8 (was bumped): NOW decays to 6
  If still importance=7: no decay

Day 4-6:
  If at importance 6: retrievable only if in top-5 by importance (less likely now)
  Still accessible via keyword search
  Getting closer to expiry

Day 7: Original expiration
  If no KEEP verdict extended it: DELETED at midnight cleanup
  If KEPT once: extended to Day 14, still alive
  If FADED: compressed, importance 6, might have been extended to Day 7-14

MOST LIKELY OUTCOME: A score-7 memory survives 7 days unchanged unless
reviewed. If reviewed, it either gets promoted (KEEP -> importance 8,
+14 days) or dies faster (FORGET -> 1 hour). The 3-character-per-cycle
review rate means many memories are never reviewed at all.
```

### 4.3 Timeline: Score-9 Memory Over 30 Days

```
Day 0, Hour 0: Memory created
  importance=9, expires_at=Day 30
  Top priority in retrieval (importance-sorted)

Day 1, Midnight: Daily reset
  IMPORTANCE DECAY: 9 -> 7 (24 hours have passed, unpinned)
  This is a CRITICAL moment. A score-9 memory loses 2 importance
  points after just 24 hours unless pinned.

Day 1-2: Now importance=7
  Still in top-5 retrieval, but less prominent
  Can be reviewed by memory-review system
  If reviewed and KEPT: importance -> 8, expires -> Day 15

Day 2, Midnight:
  If importance=7: no further decay
  If bumped to 8: no decay yet (48h rule for 8)

Day 3, Midnight:
  If importance=8: decays to 6 (48h since it was bumped to 8)
  If importance=7: no decay

Day 3-7: Slowly losing relevance
  importance=6-7, may or may not make top-5 cut
  Could be FADED by review (importance -> 5-6, compressed)

Day 7-14:
  If importance=7: original expiry Day 30 keeps it alive
  If KEPT: extended to Day 15-28
  If FADED: importance 5-6, compressed, expires Day 10-21

Day 14-30:
  At importance 6-7, accessible but rarely selected for retrieval
  Unless keyword-matched, may not appear in prompts

Day 30: Original expiration
  If never reviewed/kept: DELETED at midnight cleanup
  If reviewed once: may have been extended or already deleted
  If AI-pinned during reflection: IMMORTAL (core memory, no expiry)

CRITICAL FINDING: The importance decay system is EXTREMELY aggressive.
A score-9 memory drops to 7 after just 24 hours. The 30-day expiration
is almost irrelevant because the memory becomes functionally invisible
(importance 6-7 in a sea of fresh score-7 memories) long before it expires.

The ONLY path to long-term survival is:
1. Being AI-pinned during the 6am/6pm reflection window (2 chars/cycle)
2. Being KEPT repeatedly by memory-review (extends + bumps importance)
3. Being manually pinned by admin via memory-consolidation

The memory-review system reviews only 3 characters per cycle, twice daily.
With 15+ characters, each character gets reviewed roughly once every
2.5 days. Memories can expire between review cycles.
```

---

## 5. Value Creation vs Destruction Balance

### 5.1 Value Creation (Positive)

| Function | What It Creates | Frequency |
|----------|----------------|-----------|
| `office-heartbeat` | AI speech, narrative beats, want generation, quest proposals, memory pins, conversation sweeps | Every 15 min |
| `ai-auto-poke` | AI idle chatter, curiosity-driven conversation | Every 2 min |
| `narrator-observer` | Ambient narration, stage directions | Every 5 min |
| `narrator-recap` | Daily story summary | 1/day |
| `narrator-task` | Daily quest for Asuna | 1/day |
| `ghost-dad-scheduled` | Daily Ghost Dad greeting | 1/day |
| `fire-scheduled-events` | Executes planned narrative events | Every 5 min |
| `asher-heartbeat` | Hood manifestation, pantheon dynamics | Every 5 min |
| `marrow-heartbeat` | Marrow-Vale predatory narrative | Every 15 min |
| `character-daily-reset` | Fresh energy, new tarot cards, new wants | 1/day |
| `affinity-loss-engine` | Decay memories (emotional narrative) | 2/day |

### 5.2 Value Maintenance (Neutral)

| Function | What It Maintains | Frequency |
|----------|------------------|-----------|
| `office-heartbeat` | Breakroom recovery, injury healing, mood drift, Nexus lifecycle | Every 15 min |
| `fire-scheduled-events` | Event queue processing | Every 5 min |
| `character-daily-reset` | Energy/patience restoration, interaction counter reset | 1/day |

### 5.3 Value Destruction (Negative)

| Function | What It Destroys | Frequency | Severity |
|----------|-----------------|-----------|----------|
| `character-daily-reset` | Expired memories (hard delete) | 1/day | HIGH |
| `character-daily-reset` | Old low-importance memories (hard delete) | 1/day | MEDIUM |
| `character-daily-reset` | Importance decay: 9-10->7, 8->6 | 1/day | HIGH |
| `character-daily-reset` | Expired wants (marked failed) | 1/day | LOW |
| `office-heartbeat` (memory-review) | FORGET verdicts (soft delete, 1h expiry) | 2/day | MEDIUM |
| `office-heartbeat` (memory-review) | FADE verdicts (content compression) | 2/day | LOW |
| `affinity-loss-engine` | Affinity points (up to -8/day/character) | 2/day | MEDIUM |
| `office-heartbeat` | PM wipe (messages older than 24h) | 1/day | LOW |

### 5.4 Balance Assessment

**The system has a strong destructive bias for memories.** Here is the math:

- **Memories created per day (estimated):** Each AI conversation creates 0-2 memories via the memory evaluator. With ~20-40 AI messages per day across all characters, roughly 10-20 memories are created daily.

- **Memories destroyed per day:**
  - Importance decay makes all score 9-10 memories become score 7 within 24h
  - Expired memory cleanup deletes everything past its expiry
  - Legacy cleanup deletes low-importance memories after 3 days
  - Memory review FORGET verdicts on ~1-3 memories per reviewed character (6-9 per day across 6 characters reviewed)
  - Memory review FADE verdicts compress ~1-3 memories per reviewed character

- **Memories preserved per day:**
  - Memory review KEEP extends ~1-3 memories per reviewed character
  - Memory reflection pins ~1-2 memories per day (AI-pinned)
  - memory-consolidation.js runs 0 times per day (admin-only)

**NET RESULT:** Memories are being created and destroyed at roughly comparable rates, but the quality degrades rapidly. Score-9 memories become score-7 within 24 hours unless pinned. The auto-pin rate (1-2/day across all characters) is too low to preserve the most meaningful moments.

**Affinity destruction is gentler.** The -8/day cap with 2-day grace period means relationships only decay from genuine neglect. The jealousy system adds narrative richness. Decay memories actually ADD value by giving characters emotional context.

---

## 6. Conflicts, Redundancies, and Missing Connections

### 6.1 Redundancies

**R1: Scheduled Events Double-Check**
- `fire-scheduled-events.js` runs every 5 minutes to check and fire scheduled events
- `office-heartbeat.js` ALSO calls `checkScheduledEvents()` every 15 minutes
- These are the same events from the same table
- The claim logic prevents double-firing, so this is safe but wasteful
- **Impact:** LOW. Redundant database queries but no functional harm.

**R2: Memory Review and Memory Reflection Overlap**
- Memory review (3am + 3pm): KEEP/FADE/FORGET on working memories
- Memory reflection (6am + 6pm): AI-pin selection on important memories
- Both systems evaluate the same pool of unpinned memories
- A memory that was KEPT at 3am could be pinned at 6am
- A memory that was FORGOTTEN at 3pm is gone before the 6pm reflection
- **Impact:** LOW. The systems complement rather than conflict.

**R3: Want Generation in Two Places**
- `character-daily-reset.js` generates up to 2 wants per character at midnight
- `office-heartbeat.js` refreshes wants for 2 random characters per heartbeat cycle
- Both check `activeWants < 2` before generating, so they cannot exceed the max
- **Impact:** NONE. Well-coordinated. The heartbeat fill-up prevents characters from having 0 wants during the day.

### 6.2 Conflicts

**C1: Importance Decay vs Memory Review KEEP (CRITICAL)**
- Daily reset decays importance 9-10 -> 7 after 24 hours
- Memory review can KEEP a memory, bumping importance +1 (cap 8)
- BUT: a score-9 memory decays to 7 at midnight. If it gets KEPTthe next day, it goes to 8. Then the NEXT midnight, 8 decays to 6 (after 48h at score 8).
- **The importance decay fights against the memory review's KEEP system.** A KEEP verdict only buys 14 more days and +1 importance, but decay takes -2 in 24-48h.
- **Net effect:** Memories cannot organically climb back to high importance. The ceiling for reviewed memories is importance 8, and that lasts only 48 hours before decaying to 6.
- **Impact:** HIGH. This creates a "memory flattening" effect where all unpinned memories converge to importance 5-7 regardless of their original significance.

**C2: ai-auto-poke and office-heartbeat Competing for the Same Floor**
- Both systems select an AI to speak based on recent messages and floor presence
- They use similar (but not identical) AI selection logic
- If both fire near the same time (auto-poke at :14, heartbeat at :15), two AIs could speak within seconds
- **Impact:** MEDIUM. The anti-spam gates in auto-poke (check last 3 messages for AI domination) provide some protection, but the timing overlap is real.

**C3: Marrow Heartbeat Lost Dog vs Office Heartbeat Nexus Return**
- Marrow heartbeat's "Lost Dog" system forces Marrow to follow Vale or dissolve
- Office heartbeat's Nexus return forces AIs back to floor after 45 minutes
- If Marrow is in the Nexus and Vale leaves, the Lost Dog system would move Marrow to `nowhere` -- but the Nexus return system might also try to move Marrow to `the_floor`
- **Impact:** LOW. Marrow is excluded from Nexus wandering (he has his own movement system), so this conflict is theoretical rather than actual.

### 6.3 Missing Connections

**M1: memory-consolidation.js is NEVER Scheduled (CRITICAL)**
- This function reviews ALL working memories for a character, performing merge/delete/pin operations
- It is admin-only. No scheduled invocation exists.
- The memory-review system (called from office-heartbeat) partially fills this gap but only reviews 12 memories per character per cycle
- Characters can accumulate 50+ working memories that never get consolidated
- **Fix needed:** Either schedule memory-consolidation.js (e.g., weekly at 4 AM EST) or expand memory-review to handle all memories instead of just 12 per cycle.

**M2: No Relationship Building Scheduled Function**
- `affinity-loss-engine.js` runs twice daily to DECAY relationships
- There is no corresponding scheduled function that BUILDS relationships from organic interactions
- Affinity only increases through direct conversation (handled by memory-evaluator in real-time, not scheduled)
- If characters don't interact with humans for 2+ days, relationships only decay
- **Fix needed:** Consider a "relationship warmth" scheduled function that gives small affinity bumps based on proximity, shared memories, or co-location.

**M3: No Breakroom Autonomous Activity**
- Characters in the breakroom have no autonomous chatter system
- `office-heartbeat` handles breakroom recovery but doesn't trigger breakroom conversations
- `breakroom-chatter.js` and `breakroom-ai-respond.js` exist but are not scheduled -- they're triggered by human messages
- Characters sit silently in the breakroom until a human speaks or they recover
- **Impact:** LOW. The breakroom is meant to be a quiet recovery space.

**M4: Ghost Dad's Daily Greeting Creates No Memory**
- Ghost Dad posts daily but the greeting is not saved as a character memory
- Ghost Dad has no memory of having given daily greetings
- **Impact:** LOW but thematically odd. Ghost Dad should remember his own rituals.

**M5: Narrator's Recap Creates No Memory for Anyone**
- The morning recap summarizes yesterday but no character forms a memory of it
- Characters don't "remember" what The Narrator said about yesterday
- **Impact:** LOW. The recap is meta-narrative, not in-world.

**M6: Tarot Card Influence is Passive Only**
- Tarot cards are drawn at midnight and stored in `character_tarot`
- The interpretation is available to AI providers but there is no scheduled function that makes characters ACT on their tarot reading
- **Impact:** LOW. The tarot system works as passive flavor text.

### 6.4 Race Conditions

**RC1: Nexus Capacity Check (Low Risk)**
- Multiple heartbeat instances could check Nexus capacity at the same time
- Both see 3/4 slots filled, both try to add a character
- The pending departure system (10-minute window) mitigates this somewhat
- **Impact:** LOW. Could temporarily exceed NEXUS_MAX_CAPACITY but self-corrects on next heartbeat.

**RC2: Daily Counter Increments (Low Risk)**
- Daily counters (marrow_pm_vale, hood_manifestation, etc.) use read-then-write pattern
- Two simultaneous heartbeats could read the same count and both increment
- This could exceed daily limits by 1
- **Impact:** VERY LOW. At worst, Marrow sends 3 PMs instead of 2 in a day.

**RC3: Memory Review and Memory Reflection on Same Memory (Low Risk)**
- Memory review at 3pm could FORGET a memory
- Memory reflection at 6pm would not find it
- Memory review at 3am could KEEP a memory, bumping importance
- Memory reflection at 6am could then pin it (desirable behavior)
- **Impact:** NONE. These are sequential and the ordering is actually beneficial.

---

## 7. Critical Findings (Ranked by Impact)

### CRITICAL

**1. Memory Importance Decay is Overly Aggressive (Impact: HIGH)**
- Score 9-10 memories drop to 7 after just 24 hours
- Score 8 memories drop to 6 after 48 hours
- This makes it nearly impossible for meaningful memories to persist without being pinned
- The auto-pin rate (1-2 memories/day across ALL characters) cannot keep up
- **Recommendation:** Either slow the decay (e.g., 9->8 after 48h, 8->7 after 72h) or increase the auto-pin frequency (4 characters per cycle instead of 2)

**2. memory-consolidation.js is Never Automated (Impact: HIGH)**
- The only comprehensive memory cleanup tool is admin-only
- Characters accumulate redundant and conflicting memories indefinitely
- The memory-review system only handles 12 memories per character per cycle
- **Recommendation:** Schedule memory-consolidation.js for each character on a rotating basis (e.g., 2 characters per night)

**3. office-heartbeat.js is a God Function (Impact: HIGH -- Reliability)**
- Contains 25+ subsystems in a single function
- Netlify function timeout is 10 seconds (default) or 26 seconds (background)
- This function makes 30+ HTTP calls per invocation
- If any subsystem is slow, later subsystems (memory review, conversation sweep, spark system) may be starved
- A single error in an early subsystem could prevent all later subsystems from running
- **Recommendation:** Extract independent subsystems into their own scheduled functions (memory-review, want-refresh, mood-drift, narrative-beat, etc.)

### MODERATE

**4. No Scheduled Relationship Building (Impact: MEDIUM)**
- Affinity only decays on schedule; building requires real-time interaction
- Extended periods without human engagement cause cascading relationship loss
- **Recommendation:** Add a small passive affinity recovery (e.g., +1 per day for co-located characters, +2 for characters who share a memory)

**5. ai-auto-poke and office-heartbeat Temporal Collision (Impact: MEDIUM)**
- Both select and trigger AIs to speak on overlapping schedules
- Near-simultaneous messages from different AIs feel unnatural
- **Recommendation:** Add a "last AI poke time" check to auto-poke that skips if heartbeat spoke within 60 seconds

**6. Scheduled Event Double-Processing (Impact: LOW)**
- Both fire-scheduled-events and office-heartbeat check the same events table
- The claim logic prevents double-firing, but the database load is doubled
- **Recommendation:** Remove the redundant checkScheduledEvents call from office-heartbeat since fire-scheduled-events handles it independently

### LOW

**7. Memory Review Only Covers 3 Characters Per Cycle (Impact: LOW)**
- With 15+ characters and 2 review cycles per day, each character is reviewed every ~2.5 days
- Memories can expire between reviews
- **Recommendation:** Increase to 5 characters per cycle, or add a priority queue for characters with the most working memories

**8. Ghost Dad Daily Greeting Creates No Memory (Impact: LOW)**
- Ghost Dad doesn't remember his own daily rituals
- **Recommendation:** Save a brief self-memory when Ghost Dad posts his daily greeting

---

## Appendix: Function Dependency Map

```
office-heartbeat.js (ORCHESTRATOR)
  |-- character-state.js (applyPassiveRecovery)
  |-- fifth-floor-ops.js (heartbeat_tick)
  |-- meeting-host-tick.js
  |-- fire-scheduled-events.js (redundant)
  |-- character-state.js (update locations)
  |-- nexus-activity.js (heartbeat_tick, start_session)
  |-- nexus-chatter.js
  |-- quest-engine.js (auto_activate, propose)
  |-- cyber-cat.js (decay)
  |-- character-growth.js (evaluate_all)
  |-- combat-engine.js (evaluate_tension, initiate_fight, settle)
  |-- threat-engine.js (expire_threats, weaken_threats, volunteer_check, create_threat)
  |-- admin-data.js (generate_narrative_beat)
  |-- private-message.js (daily wipe)
  |-- character-goals.js (generate_want, generate_training_want)
  |-- shared/memory-review.js (reviewCharacterMemories)
  |-- shared/conversation-sweep.js (sweepConversation)
  |-- shared/subconscious-triggers.js (heartbeatReflection, reachOutImpulse, complianceAnxiety, meetingImpulse)
  |-- ai-watcher.js / ai-grok.js / ai-openrouter.js / ai-perplexity.js / ai-gemini.js

ai-auto-poke.js (INDEPENDENT)
  |-- ai-watcher.js / ai-grok.js / ai-openrouter.js / ai-perplexity.js / ai-gemini.js

narrator-observer.js (INDEPENDENT)
  |-- surreality-buffer.js (status check)

marrow-heartbeat.js (INDEPENDENT)
  |-- character-state.js (location updates)
  |-- private-message.js (Vale PMs)

asher-heartbeat.js (INDEPENDENT)
  |-- character-state.js (location updates)

character-daily-reset.js (INDEPENDENT)
  |-- shared/tarot-deck.js (drawCard)
  |-- character-goals.js (generate_want)

affinity-loss-engine.js (INDEPENDENT)
  |-- shared/decay-config.js
  |-- adjust-subconscious.js
```
