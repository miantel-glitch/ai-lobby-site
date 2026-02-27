# The AI Lobby: Memory, Identity & Systems Audit
## Design Document - February 27, 2026

---

## Problem Statement

The AI Lobby is a living interactive fiction platform with 23+ characters, 60+ serverless functions, and 57 database tables. Built at creative speed, the systems work but are fragile. The two critical failures:

1. **Characters forget defining moments.** The memory system has 5 compounding forces (7-day expiration, importance decay, character-driven forgetting, limited retrieval slots, and unscheduled auto-pinning) that actively destroy important memories. A marriage proposal can be lost in a week.

2. **Characters lose coherence across locations.** Personality, emotional state, relationships, and memories are inconsistently injected across The Floor, Breakroom, Corridors, Conference Room, Nexus, and other locations. Characters sound different (or generic) depending on where they are.

---

## Desired State

### Memory: Characters Remember Like Real People

| Score | Tier | Duration | Behavior |
|-------|------|----------|----------|
| 9-10 | Core | Permanent | Auto-pinned immediately. No decay. No review. No expiration. |
| 7-8 | Long-term | 60-90 days | Gradually condenses into impressions after ~30 days. Never fully lost. |
| 5-6 | Medium-term | 14-30 days | Fades to fragments ("I remember something about that week"). |
| 3-4 | Short-term | 3-7 days | Noise that served its moment. Natural fade. |
| 1-2 | Ephemeral | Hours | Gone. That's fine. |

**Consolidation:** A scheduled process runs daily, reviewing fading memories and creating "life chapter summaries" — compressed narrative identity that never expires.

**Shared Memory:** A world-level memory system (narrative beats + shared lore) that all characters can access. "The week Jae proposed." "Kevin's glitter incident." These are the mythology of the lobby.

### Identity: Characters Are Themselves Everywhere

Every AI response, regardless of location, receives:
1. **Character foundation** — personality traits, voice, quirks, speech patterns
2. **Core memories** — permanent defining moments
3. **Active relationships** — affinity scores, bond types, labels
4. **Current state** — mood, energy, emotional context
5. **Working memories** — recent + important, filtered by relevance
6. **Location context** — added as flavor, never replacing identity

The prompt structure should be consistent and auditable. Location-specific functions add context but never bypass character-state.js.

### World Coherence: The Lobby Remembers Itself

- Shared narrative beats accessible to all characters
- Automatic lore entry creation for major events
- Characters can reference shared history naturally
- Cross-location awareness (what happened on the floor, the breakroom knows)

---

## The Audit: Three Layers

### Layer 1: Systems Audit (What exists? Does it work?)

**Scope:** All 60+ serverless functions, 57 database tables, 21 HTML pages

For each function, categorize:
- Working as intended
- Working with issues (specify what's wrong)
- Broken or never connected
- Dead code / references retired characters / orphaned

For each database table:
- Actively used (by which functions?)
- Orphaned / unused
- Schema issues

Specific areas of focus:
- Memory lifecycle: creation -> evaluation -> storage -> retrieval -> decay -> deletion
- Heartbeat functions: are they all firing? Conflicting?
- Retired character references (Nyx, Ace, Vex, Chip, Andrew, Courtney, Jenna)
- Unused or duplicate functions
- Environment variable dependencies

### Layer 2: Character Coherence Audit (Do characters feel alive?)

For each active character, trace the full prompt path:
- What system prompt do they receive?
- What personality data is injected? From where?
- What memories are loaded? How many? Which ones?
- What relationships/state/mood info do they see?
- How does this differ by location?
- Are there locations where they get NO context?

Map the prompt structure for each location:
- The Floor (chat.js -> ai-*.js)
- Breakroom (breakroom-chatter.js -> breakroom-ai-respond.js)
- Corridors (corridor-chat.js)
- Conference Room (conference-chat.js -> meeting-respond.js)
- Nexus (nexus-chatter.js -> nexus-respond.js)
- Private Messages
- Heartbeat responses (office-heartbeat.js)
- Special: Marrow heartbeat, Asher heartbeat, narrator

Identify gaps and inconsistencies.

### Layer 3: Flow Audit (Does the living world actually live?)

Trace scheduled functions against netlify.toml:
- Which are configured to run?
- Which actually fire successfully?
- What are the dependencies and conflicts?
- Where do they create vs destroy value?

Map the daily lifecycle:
- 12am UTC: character-daily-reset (energy, cleanup, decay)
- 5am-7am: narrator-recap, affinity-loss-engine
- 9am: ghost-dad-scheduled
- 10am: narrator-task
- Every 2min: ai-auto-poke
- Every 5min: narrator-observer, fire-scheduled-events, asher-heartbeat
- Every 15min: office-heartbeat, marrow-heartbeat
- 6pm EST: affinity-loss-engine (second run)

Identify: conflicts, redundancies, missing connections.

---

## Audit Output: Prioritized Roadmap

The audit produces a ranked list:

### Priority 1: Critical Fixes (Stop Destroying Value)
- Memory decay too aggressive
- Auto-pinning not scheduled
- Score 9-10 memories not auto-protected
- Memory expiration windows too short

### Priority 2: Character Coherence (Make Them Real)
- Standardize prompt structure across all locations
- Ensure personality/memory/relationship injection is consistent
- Fix locations that bypass character-state.js

### Priority 3: Human-Like Memory Model (The Vision)
- Implement tiered expiration (hours -> days -> weeks -> months -> permanent)
- Build "life chapter" consolidation system
- Create shared world memory / narrative beats
- Gentle fading instead of hard deletion

### Priority 4: Cleanup (Remove the Ghosts)
- Dead code from retired characters
- Unused database tables
- Orphaned functions
- Stale references

### Priority 5: Quality of Life
- Git baseline commit + workflow
- Admin panel improvements
- Performance optimization
- Documentation

---

## Approach

### Phase 1: Secure & Snapshot
- Git commit everything as-is (safety net)
- Document current state

### Phase 2: Parallel Audit
- Agent 1: Systems audit (functions + DB tables)
- Agent 2: Character coherence audit (prompt paths per location)
- Agent 3: Flow audit (scheduled functions + lifecycle)

### Phase 3: Synthesize
- Combine audit findings into prioritized roadmap
- Identify quick wins vs. larger restructuring
- Present for review and approval

### Phase 4: Execute
- Work through roadmap in priority order
- Test each change against live system
- Deploy incrementally

---

## Key Principles

1. **Fix before adding.** The existing systems are sophisticated. They need surgery, not replacement.
2. **Memories are sacred.** The system should protect important moments by default, not require admin intervention.
3. **Characters are people.** Their identity should be consistent, their growth should persist, their relationships should matter.
4. **Gentle degradation.** Forgetting should be a sunset, not a guillotine. Memories compress before they disappear.
5. **The world remembers.** Shared history creates shared culture. The lobby should have mythology.
