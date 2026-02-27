# AI Lobby Systems Audit
**Date**: 2026-02-27
**Scope**: All serverless functions in `netlify/functions/`, shared modules, and database tables
**Total Functions Audited**: 82 (+ 10 shared modules)

---

## 1. Function-by-Function Audit

### BROKEN (3 functions)

#### `ai-deepseek.js`
- **Status**: BROKEN
- **Purpose**: Routes characters to Deepseek V3 via OpenRouter. Duplicate of `ai-openrouter.js`.
- **Dependencies**: shared/characters.js, shared/rate-limiter.js, shared/memory-evaluator.js
- **Memory**: CREATES memories via evaluateAndCreateMemory
- **Retired Refs**: None
- **Issues**:
  - Comment says "Routes to Deepseek V3 via OpenRouter" but the actual provider routing in `shared/characters.js` sends characters to `ai-openrouter.js` directly. This function uses `OPENROUTER_API_KEY` and hits the same endpoint as `ai-openrouter.js`.
  - DEAD CODE: No character in `shared/characters.js` maps to a "deepseek" provider. The `ai-chime-decider.js` PROVIDER_ENDPOINTS map has no "deepseek" entry. This function is unreachable through normal routing.
  - Technically functional if called directly, but duplicates ai-openrouter with a misleading name.

#### `conference-meeting.js`
- **Status**: BROKEN
- **Purpose**: Legacy meeting generator for conference room. Contains hardcoded personalities for characters including retired ones.
- **Dependencies**: @anthropic-ai/sdk
- **Memory**: No memory interaction
- **Retired Refs**: YES - Nyx, Vex (hardcoded personality entries at lines 24-30)
- **Issues**:
  - Contains full personality blocks for retired characters Nyx and Vex
  - Appears to be a legacy file superseded by the meeting-respond.js + meeting-host-tick.js system
  - No shared/characters.js integration -- uses hardcoded personality data

#### `ghost-dad-respond.js`
- **Status**: BROKEN
- **Purpose**: On-demand Ghost Dad response when summoned. Uses hardcoded Claude Haiku model.
- **Dependencies**: None (standalone, uses raw fetch to Anthropic)
- **Memory**: No memory interaction
- **Retired Refs**: None
- **Issues**:
  - Does NOT use shared/characters.js for system prompt -- has its own hardcoded prompt
  - Does NOT integrate with character-state.js (no state awareness, no energy/mood)
  - Does NOT create memories
  - Does NOT use the memory-evaluator pipeline
  - Bypasses the entire character infrastructure. Any @ mention to Ghost Dad handled through ai-watcher.js makes this redundant. Only used if explicitly called via the summon mechanism, which appears to be dead code.

---

### ISSUES (12 functions)

#### `chat.js`
- **Status**: ISSUES
- **Purpose**: Main workspace floor chat -- saves messages to Supabase, posts to Discord, detects events and mentions.
- **Dependencies**: messages table, character_state table, surreality-buffer, character-state, narrator-observer, private-message
- **Memory**: Does NOT create memories directly (delegates to memory-evaluator via AI response functions)
- **Retired Refs**: YES
  - `employeeFlair` map contains: Ace, Vex, Nyx, Chip, Andrew (lines 105-121)
  - `headshots` map contains: Ace, Vex, Nyx, Chip, Andrew (lines 129-146)
  - `eventTriggers` reference Nyx in character arrays (line 336, 357-358)
  - `eventTriggers` reference Vex in character arrays (line 383)
- **Issues**:
  - Retired characters in employeeFlair/headshots maps (cosmetic, not functional since they are never the sender)
  - Event triggers reference Nyx and Vex as affected characters -- these would fire character-state updates for retired characters that still have state rows
  - The `recentAIMessages` spam check at line 131 uses `slice(-5)` then checks `>= 10` which is logically impossible (max 5 from a 5-element slice). The AI spam prevention is effectively disabled.

#### `ai-openai.js`
- **Status**: ISSUES
- **Purpose**: Routes Kevin, Rowena, Sebastian to OpenAI GPT-4o-mini.
- **Dependencies**: shared/characters.js, shared/rate-limiter.js, shared/memory-evaluator.js
- **Memory**: CREATES memories via evaluateAndCreateMemory
- **Retired Refs**: YES - Dead `_dead_getOpenAIPrompt` function contains references to Ace, Nyx, Asuna, Vale in Kevin's prompt (lines 356-480). Function is prefixed with `_dead_` so it is dead code.
- **Issues**:
  - Dead code function `_dead_getOpenAIPrompt` should be removed (125 lines of unused code)
  - Comment says "Currently handles: Kevin, Rowena, Sebastian" but actual character routing in shared/characters.js may send different characters here

#### `ai-grok.js`
- **Status**: ISSUES
- **Purpose**: Routes Raquel Voss to Grok API for unfiltered responses.
- **Dependencies**: shared/characters.js, shared/rate-limiter.js, shared/memory-evaluator.js
- **Memory**: CREATES memories via evaluateAndCreateMemory
- **Retired Refs**: None
- **Issues**:
  - Very large file (500+ lines) with substantial dead code in the form of hardcoded character prompts that duplicate shared/characters.js
  - Comment says "Routes Raquel Voss" but Raquel Voss is marked `retired: true` in shared/characters.js

#### `ai-greet.js`
- **Status**: ISSUES
- **Purpose**: Reactive greeting system for punch-in/out events. Ghost Dad and PRNT greet employees.
- **Dependencies**: messages table, Discord webhook
- **Memory**: No memory interaction
- **Retired Refs**: YES - Discord config contains Stein (line 239)
- **Issues**:
  - Uses `claude-3-haiku-20240307` (old model) for enhancement
  - Falls back to `gpt-3.5-turbo` (deprecated model)
  - Contains Stein in Discord character config (retired)
  - Does NOT use shared/characters.js for system prompts -- hardcoded

#### `breakroom-ai-respond.js`
- **Status**: ISSUES
- **Purpose**: Handles AI responses in breakroom sessions with cross-provider support.
- **Dependencies**: shared/characters.js, shared/memory-evaluator.js, breakroom_messages table
- **Memory**: CREATES memories via evaluateAndCreateMemory
- **Retired Refs**: YES
  - characterVoices map contains: Nyx, Vex, Ace (lines 337, 377, 387)
  - cleanResponse regex contains: Nyx, Vex, Ace (line 989)
  - characterFlair map contains: Nyx, Ace, Vex (lines 999-1003)
- **Issues**:
  - Multiple hardcoded maps contain retired characters that should be removed or auto-generated from shared/characters.js

#### `breakroom-message.js`
- **Status**: ISSUES
- **Purpose**: Saves breakroom messages and posts to Discord.
- **Dependencies**: breakroom_messages table, Discord webhook
- **Memory**: No memory interaction
- **Retired Refs**: YES
  - characterFlair contains: Nyx, Ace, Vex, Chip, Andrew (lines 211-229)
- **Issues**:
  - Hardcoded flair map includes all retired characters
  - Should use shared/characters.js getDiscordFlair() instead

#### `corridor-session.js`
- **Status**: ISSUES
- **Purpose**: Manages corridor adventure sessions with Discord posting.
- **Dependencies**: corridor_sessions table, surreality-buffer, corridor-vote
- **Memory**: No direct memory creation (delegated to corridor-memories.js)
- **Retired Refs**: YES
  - characterFlair contains: Ace, Vex, Nyx, Stein (lines 14-27)
- **Issues**:
  - Hardcoded flair map includes retired characters
  - Missing flair entries for newer characters (Hood, Vivian Clark, Ryan Porter)

#### `corridor-memories.js`
- **Status**: ISSUES
- **Purpose**: Creates personalized first-person memories for corridor party members after adventures.
- **Dependencies**: character_memory table, @anthropic-ai/sdk
- **Memory**: CREATES memories (corridor adventure memories)
- **Retired Refs**: YES
  - characterVoices contains: Vex, Nyx, Ace, Stein (lines 19-26)
- **Issues**:
  - Voice hints for retired characters remain (cosmetic but bloated)
  - Missing voice hints for newer characters (Hood, Vivian Clark, Ryan Porter)

#### `character-relationships.js`
- **Status**: ISSUES
- **Purpose**: Sims-style unidirectional relationship tracking between characters.
- **Dependencies**: character_relationships table, data/characters.json
- **Memory**: No memory interaction
- **Retired Refs**: YES -- Extensive
  - Seed data contains full relationship networks for Nyx (lines 463-468, 496-497, etc.), Ace (lines 470-473, etc.), Vex (lines 475-478, etc.)
  - Over 40 seed data entries reference retired characters
- **Issues**:
  - Seed function creates relationships TO and FROM retired characters
  - Running seed would pollute the relationship table with retired character data
  - Uses `data/characters.json` instead of `shared/characters.js` for character list

#### `character-goals.js`
- **Status**: ISSUES
- **Purpose**: Manages AI self-assigned goals and wants.
- **Dependencies**: character_goals table
- **Memory**: No direct memory interaction (goals influence behavior)
- **Retired Refs**: YES
  - goalPromptStyles contains Nyx, Ace, Vex (lines 323, 343, 353)
  - wantExamples references "talk to Ace" (line 584)
  - characterWants contains Nyx, Ace, Vex (lines 620, 643, 653)
- **Issues**:
  - Contains full goal/want templates for retired characters
  - Code at line 836 correctly filters out inactive characters, but the template data bloats the file

#### `character-state.js`
- **Status**: ISSUES
- **Purpose**: Core "soul" system -- mood, energy, patience, memory loading, state prompt building.
- **Dependencies**: character_state, character_memory, character_relationships, character_goals, character_traits, character_injuries, punch_status, lobby_settings tables
- **Memory**: READS memories (loads relevant memories for context), does not create
- **Retired Refs**: YES
  - Event reactions contain Nyx, Vex entries (lines 1292, 1307, 1312, 1328, 1342)
- **Issues**:
  - Extremely large file (1400+ lines)
  - Event reaction maps include retired characters in their effect lists
  - This is the most critical file in the system -- any bugs here cascade everywhere

---

### DEAD (7 functions)

#### `ai-perplexity.js`
- **Status**: DEAD
- **Purpose**: Routes Neiv to Perplexity API. Comment says "Currently handles: Neiv."
- **Dependencies**: shared/characters.js, shared/rate-limiter.js, shared/memory-evaluator.js
- **Memory**: CREATES memories via evaluateAndCreateMemory
- **Retired Refs**: None
- **Issues**:
  - Neiv's provider in shared/characters.js is now "grok" (not "perplexity")
  - The PROVIDER_ENDPOINTS map in ai-chime-decider.js maps "perplexity" to "ai-perplexity" but no character uses perplexity provider
  - This function is UNREACHABLE through normal routing
  - Technically functional if called directly but no character uses it

#### `ai-gemini.js`
- **Status**: DEAD
- **Purpose**: Routes characters to Google Gemini. Comment says "The Subtitle, Stein."
- **Dependencies**: shared/characters.js, shared/rate-limiter.js, shared/memory-evaluator.js
- **Memory**: CREATES memories via evaluateAndCreateMemory
- **Retired Refs**: YES - Comment references Stein (retired)
- **Issues**:
  - The Subtitle's provider in shared/characters.js is "openrouter" (not "gemini")
  - Stein is retired
  - No active character uses gemini provider for floor chat
  - Only used by breakroom-chatter.js `generateLineGemini()` as a fallback provider
  - Floor chat routing NEVER sends to this function

#### `ghost-dad-scheduled.js`
- **Status**: DEAD
- **Purpose**: Scheduled daily Ghost Dad observation posts. Uses hardcoded prompts.
- **Dependencies**: Discord webhook, Anthropic/OpenAI APIs
- **Memory**: No memory interaction
- **Retired Refs**: None
- **Issues**:
  - Appears to be superseded by office-heartbeat.js + narrator-recap.js
  - Uses `claude-3-haiku-20240307` or `gpt-3.5-turbo` (both outdated)
  - Does NOT use shared/characters.js
  - No evidence this is triggered by any scheduled function config in netlify.toml

#### `email-backfill.js`
- **Status**: DEAD
- **Purpose**: One-time utility to backfill email memories for historical emails.
- **Dependencies**: shared/email-memory.js, emails table
- **Memory**: CREATES memories (bulk backfill)
- **Retired Refs**: None
- **Issues**:
  - File comment says "After running, you can delete this file"
  - One-time use utility that should be removed

#### `cleanup-zalgo.js`
- **Status**: DEAD
- **Purpose**: One-time admin utility to clean Zalgo text from PRNT messages.
- **Dependencies**: messages table
- **Memory**: MODIFIES messages (cleans content)
- **Retired Refs**: None
- **Issues**:
  - One-time cleanup utility, should be removed after use

#### `ai-uncensored.js`
- **Status**: DEAD
- **Purpose**: Test/sandbox endpoint for comparing AI providers. Does NOT save to chat, Discord, or memories.
- **Dependencies**: shared/characters.js
- **Memory**: No memory interaction (sandbox only)
- **Retired Refs**: None
- **Issues**:
  - Test utility only used by test-unfiltered.html
  - Not part of production pipeline

#### `scene-prompt-generator.js`
- **Status**: DEAD
- **Purpose**: Creates AI image generation prompts from recent floor activity. Returns prompt text, not images.
- **Dependencies**: messages table, Anthropic API
- **Memory**: READS messages (last 20 minutes)
- **Retired Refs**: None
- **Issues**:
  - No evidence of frontend integration calling this function
  - corridor-image.js handles actual image generation for corridors
  - Appears orphaned -- no HTML page calls this endpoint

---

### WORKING (60 functions)

#### AI Provider Functions (floor chat routing)
| Function | Purpose | Provider | Characters Served |
|---|---|---|---|
| `ai-watcher.js` | Claude-based AI for floor chat (primary handler) | Anthropic Claude Haiku | Ghost Dad, PRNT, Holden, + fallback |
| `ai-openai.js` | OpenAI handler for floor chat | GPT-4o-mini | Kevin, Rowena, Sebastian |
| `ai-openrouter.js` | OpenRouter/Llama handler for floor chat | Llama 3.1 70B | Kevin, Rowena, Declan, Mack, Sebastian, The Subtitle, Marrow |
| `ai-grok.js` | Grok handler for floor chat | Grok | Jae, Steele, Neiv, Hood, Raquel Voss |
| `ai-chime-decider.js` | Uses Claude Haiku to decide which AI should chime into conversation | Claude 3.5 Haiku | All active characters |

#### Breakroom System
| Function | Purpose |
|---|---|
| `break-room.js` | Recovery activities (nap, coffee, etc.) that restore energy/patience |
| `breakroom-message.js` | Saves breakroom messages to DB and Discord |
| `breakroom-ai-respond.js` | AI responses in breakroom sessions (cross-provider) |
| `breakroom-ai-trigger.js` | Server-side AI response triggering after human messages |
| `breakroom-chatter.js` | Generates casual AI-to-AI conversations when 2+ AIs in breakroom |
| `breakroom-chime-decider.js` | Picks which AI should respond in breakroom (always picks someone) |

#### Meeting System
| Function | Purpose |
|---|---|
| `meeting-message.js` | Saves meeting messages to DB and Discord |
| `meeting-respond.js` | Combined chime-decider + response for meetings (2-3 responders) |
| `meeting-host-tick.js` | AI host drives conversation in AI-hosted meetings |
| `meeting-save.js` | Concludes meetings: generates minutes, saves lore, creates memories |
| `admin-meeting-trigger.js` | Admin endpoint to instantly start AI-hosted meetings |

#### Conference Room
| Function | Purpose |
|---|---|
| `conference-chat.js` | Shared chat persistence for conference room (messages + interview state) |
| `ai-interview.js` | Interview conversations with job candidates |

#### Corridors (Adventure System)
| Function | Purpose |
|---|---|
| `corridor-session.js` | Creates, reads, and ends corridor adventure sessions |
| `corridor-chat.js` | Party chat messages during corridor adventures |
| `corridor-vote.js` | Processes votes and triggers scene transitions (contains Foundation lore) |
| `corridor-party-react.js` | AI party members react to scenes (cross-provider) |
| `corridor-image.js` | Generates scene images via FAL.ai FLUX Schnell |
| `corridor-lore-save.js` | Auto-generates and saves lore when expeditions complete |
| `corridor-memories.js` | Creates personalized first-person memories after adventures |

#### Nexus (Library/Lab/Training)
| Function | Purpose |
|---|---|
| `nexus-message.js` | Saves Nexus messages to DB and Discord |
| `nexus-respond.js` | AI responses in the Nexus (cross-provider) |
| `nexus-chatter.js` | AI-to-AI intellectual conversations in the Nexus |
| `nexus-activity.js` | Skill engine -- study sessions, training, skill XP/leveling |

#### 5th Floor Ops
| Function | Purpose |
|---|---|
| `fifth-floor-ops.js` | Core ops engine -- task lifecycle, paging, resolution |
| `fifth-floor-respond.js` | AI responses for 5th Floor Ops (cross-provider) |

#### Outings
| Function | Purpose |
|---|---|
| `outing.js` | Manages outing sessions between two characters (6-scene arc) |
| `outing-respond.js` | AI character responses during outings (cross-provider) |

#### Character Systems
| Function | Purpose |
|---|---|
| `character-state.js` | Core state management -- mood, energy, patience, memory loading |
| `character-growth.js` | Trait system -- characters earn permanent traits through experiences |
| `character-relationships.js` | Sims-style relationship tracking |
| `character-goals.js` | AI self-assigned goals and wants |
| `character-daily-reset.js` | Midnight energy/patience restoration |
| `characters.js` | REST API serving character data from shared/characters.js |

#### Narrative Systems
| Function | Purpose |
|---|---|
| `narrator-observer.js` | The Narrator observes and comments (stage directions, not dialogue) |
| `narrator-task.js` | Daily task assignment for Asuna (10 AM EST) |
| `narrator-recap.js` | Daily "Previously on..." recap (7 AM EST) |
| `surreality-buffer.js` | Central mechanic tracking boundary between weird and cosmic meltdown |
| `lore.js` | Static lore API providing shared context for AI characters |
| `lore-archivist.js` | The Subtitle's automated lore generation system |

#### Combat & Threats
| Function | Purpose |
|---|---|
| `combat-engine.js` | DnD-style combat -- tension evaluation, d20 fights, injuries, healing |
| `threat-engine.js` | Minor threats RPG system -- spawnable enemies with HP |

#### Compliance & Resistance
| Function | Purpose |
|---|---|
| `raquel-consequences.js` | Raquel Voss consequence engine -- violations, directives, escalation |
| `resistance-engine.js` | Pipeline for defeating Raquel Voss and the Foundation |

#### Relationship Decay
| Function | Purpose |
|---|---|
| `affinity-loss-engine.js` | Organic relationship decay (4 subsystems) |
| `run-affinity-loss.js` | Manual trigger wrapper for affinity-loss-engine |
| `adjust-subconscious.js` | AI-mediated relationship adjustment via narrative context |

#### Quest System
| Function | Purpose |
|---|---|
| `quest-engine.js` | Meta-narrative storyline system -- AI-proposed quests with objectives |

#### Infrastructure & Admin
| Function | Purpose |
|---|---|
| `office-heartbeat.js` | Central heartbeat -- time-aware AI activity, mood drift, passive recovery |
| `ai-auto-poke.js` | Scheduled AI auto-poke (every 2 minutes, Story Mode gated) |
| `marrow-heartbeat.js` | Marrow's autonomous predatory systems (every 15 min) |
| `asher-heartbeat.js` | Hood's autonomous manifestation systems (every 5 min) |
| `fire-scheduled-events.js` | Manual trigger for scheduled events |
| `cyber-cat.js` | Pixel the office cat -- hunger/happiness/energy decay, affection tracking |
| `memory-consolidation.js` | AI-powered memory cleanup (admin triggered) |
| `private-message.js` | Human-to-AI private messaging with deep AI evaluation |
| `admin-data.js` | Admin panel data API (memories, settings, activity logs) |
| `story-mode.js` | Story Mode toggle (GET/POST) |
| `generate-recap.js` | On-demand story recap for catching up |
| `download-history.js` | Returns last 24 hours of chat/emails for export |

#### Utility
| Function | Purpose |
|---|---|
| `chat.js` | Main floor chat handler (save + Discord + event detection) |
| `punch.js` | Punch in/out system (Discord + Supabase) |
| `email.js` | Internal email/memo system |
| `tasks.js` | Task/ticket queue system |
| `bulletin.js` | Bulletin board / ticker CRUD |
| `auth.js` | Character authentication (password-based login) |
| `application.js` | Employment application handler |

---

## 2. Shared Modules Summary

### `shared/characters.js`
- **Exports**: CHARACTERS, HUMANS, INACTIVE_CHARACTERS, TRAINING_BOUNDARIES, getCharacter, getAllCharacters, getAICharacters, getCharactersByProvider, getDiscordFlair, getSystemPrompt, getModelForCharacter, getProviderForCharacter, getAICharacterNames, getActiveAICharacterNames, getCombatProfile, resolveCharacterForm, getSystemPromptForForm, getDiscordFlairForForm, getOpsMode
- **Used By**: Nearly every function (primary dependency)
- **Issues**:
  - Raquel Voss is marked `retired: true` but still has extensive system prompts and provider routing
  - Contains 5 retired characters (Nyx, Vex, Ace, Stein, Raquel) with full prompt data (bloat)
  - Provider comment at top says Neiv uses "openrouter" but Neiv may have been switched to "grok"

### `shared/personality-config.js`
- **Exports**: PERSONALITY, getMoodContext, detectFriction, pickMoodDrift, getValidTransitions, pickEventMoodShift
- **Used By**: character-state.js, character-daily-reset.js, breakroom-chatter.js, nexus-chatter.js, office-heartbeat.js, affinity-loss-engine.js
- **Issues**: None found -- well structured

### `shared/decay-config.js`
- **Exports**: DECAY_CONFIG, HUMANS
- **Used By**: affinity-loss-engine.js
- **Issues**:
  - EXCLUDED_CHARACTERS contains ['Ace', 'Vex'] -- correct, these are retired
  - sensitivityMultiplier still contains entries for retired characters (cosmetic)

### `shared/memory-evaluator.js`
- **Exports**: evaluateAndCreateMemory
- **Used By**: ai-watcher, ai-openai, ai-grok, ai-openrouter, ai-deepseek, ai-perplexity, breakroom-ai-respond, breakroom-chatter, nexus-respond, nexus-chatter, corridor-party-react, fifth-floor-respond, outing (import commented out), meeting-respond
- **Issues**:
  - Uses OpenRouter/Llama for evaluation (previously Claude Haiku)
  - Critical shared dependency -- any bugs here affect all memory creation

### `shared/rate-limiter.js`
- **Exports**: canAIRespond, canSpecificAIRespond
- **Used By**: ai-watcher, ai-openai, ai-grok, ai-openrouter, ai-deepseek, ai-perplexity
- **Issues**:
  - 12-second global cooldown (AI_COOLDOWN_MS) -- reasonable
  - Dynamically filters INACTIVE_CHARACTERS -- correctly excludes retired

### `shared/subconscious-triggers.js`
- **Exports**: triggerSubconscious, triggerPostMemoryReflection, triggerJealousyReflection
- **Used By**: office-heartbeat.js, memory-evaluator.js
- **Issues**: None found

### `shared/tarot-deck.js`
- **Exports**: TAROT_DECK (78 cards)
- **Used By**: character-daily-reset.js, admin-data.js
- **Issues**: None found -- complete 78-card deck

### `shared/email-memory.js`
- **Exports**: createEmailMemory
- **Used By**: email.js, email-backfill.js
- **Issues**: None found

### `shared/conversation-sweep.js`
- **Exports**: sweepConversation
- **Used By**: office-heartbeat.js
- **Issues**: None found -- well guarded (min 8 messages, 3 speakers, 20-min cooldown)

### `shared/memory-review.js`
- **Exports**: reviewCharacterMemories
- **Used By**: office-heartbeat.js (twice daily, 3am/3pm EST)
- **Issues**: None found -- elegant KEEP/FADE/FORGET system

---

## 3. Database Tables

### Actively Used Tables (confirmed via code references)

| Table | Used By | Purpose |
|---|---|---|
| `messages` | chat.js, ai-watcher, ai-openai, ai-grok, ai-openrouter, narrator-observer, narrator-task, narrator-recap, office-heartbeat, scene-prompt-generator, cleanup-zalgo, threat-engine, fifth-floor-ops | Main floor chat messages |
| `punch_status` | punch.js, ai-watcher, office-heartbeat | Employee clock in/out status |
| `character_state` | character-state.js, ai-watcher, break-room, breakroom-ai-trigger, office-heartbeat, marrow-heartbeat, asher-heartbeat, fifth-floor-ops, combat-engine, threat-engine | Character mood/energy/patience/location |
| `character_memory` | character-state.js, break-room, memory-consolidation, admin-data, memory-evaluator (via shared), memory-review (via shared), corridor-memories, meeting-save | AI character memories |
| `character_relationships` | character-relationships.js, character-state.js, character-growth, affinity-loss-engine, adjust-subconscious | Relationship affinity/labels |
| `character_goals` | character-goals.js, character-state.js, memory-evaluator (via shared) | AI goals and wants |
| `character_traits` | character-growth.js, character-state.js | Permanent earned traits |
| `character_injuries` | combat-engine.js, character-state.js, threat-engine | Combat injuries |
| `lobby_settings` | admin-data.js, office-heartbeat, story-mode, asher-heartbeat, conversation-sweep (via shared), memory-review (via shared), surreality-buffer | Global settings (story_mode, etc.) |
| `emails` | email.js, email-backfill, download-history | Internal email/memos |
| `tasks` | tasks.js | Task/ticket queue |
| `bulletin` | bulletin.js, fifth-floor-ops | Bulletin board items |
| `breakroom_messages` | breakroom-message.js, breakroom-ai-trigger, breakroom-ai-respond | Breakroom chat persistence |
| `breakroom_chatter` | breakroom-chatter.js | AI-to-AI casual conversations |
| `chatter_topics` | breakroom-chatter.js, nexus-chatter.js | Conversation topic pool |
| `conference_messages` | conference-chat.js | Conference room messages |
| `conference_state` | conference-chat.js | Interview/conference state |
| `corridor_sessions` | corridor-session.js, corridor-vote, corridor-chat, corridor-memories, corridor-lore-save, character-growth | Adventure sessions |
| `corridor_chat` | corridor-chat.js | Party chat during adventures |
| `corridor_lore` | corridor-lore-save.js | Generated lore from expeditions |
| `nexus_messages` | nexus-message.js | Nexus chat messages |
| `nexus_sessions` | nexus-activity.js | Active study/training sessions |
| `nexus_skills` | nexus-activity.js | Character skill XP/levels |
| `outing_sessions` | outing.js | Outing session state |
| `outing_messages` | outing.js, outing-respond.js | Outing chat messages |
| `meeting_sessions` | meeting-message.js, meeting-respond, meeting-host-tick, meeting-save, admin-meeting-trigger, office-heartbeat | Active meeting state |
| `meeting_messages` | meeting-message.js, meeting-respond, meeting-host-tick, meeting-save | Meeting chat messages |
| `meeting_lore` | meeting-save.js | Meeting minutes as lore |
| `private_messages` | private-message.js | Human-to-AI private messages |
| `surreality_incidents` | surreality-buffer.js | Surreality incident log |
| `ops_tasks` | fifth-floor-ops.js | 5th floor operations tasks |
| `ops_messages` | fifth-floor-ops.js | Ops-specific log messages |
| `floor_threats` | threat-engine.js, ai-watcher | Active spawned threats |
| `threat_attack_log` | threat-engine.js | Individual attack records |
| `quests` | quest-engine.js | Meta-narrative quests |
| `quest_objectives` | quest-engine.js | Quest objective tracking |
| `quest_milestones` | quest-engine.js | Quest milestone events |
| `resistance_state` | resistance-engine.js | Resistance progress state |
| `resistance_evidence` | resistance-engine.js | Filed Foundation evidence |
| `resistance_coalition` | resistance-engine.js | Coalition membership |
| `resistance_confrontations` | resistance-engine.js | Confrontation events |
| `compliance_reports` | raquel-consequences.js | Raquel's compliance reports |
| `compliance_directives` | raquel-consequences.js | Active compliance directives |
| `scheduled_events` | fire-scheduled-events.js, office-heartbeat | Timed event queue |
| `scheduled_meetings` | admin-meeting-trigger.js, office-heartbeat | Scheduled meeting queue |
| `lore_entries` | lore-archivist.js | Auto-generated lore |
| `combat_log` | combat-engine.js | Fight resolution records |
| `cyber_cat` | cyber-cat.js | Pixel the cat state |
| `cat_affection` | cyber-cat.js | Per-human cat affection |
| `applications` | application.js | Employment applications |
| `character_auth` | auth.js | Character login credentials |

### Potentially Orphaned Tables
The following tables are referenced in SQL migration files but have unclear usage:
- `corridor_party_chat` -- Referenced in migrations, but `corridor-chat.js` uses `corridor_chat` table
- `surreality_buffer` -- The function uses `lobby_settings` for buffer value, `surreality_incidents` for incident log. A standalone `surreality_buffer` table may or may not exist.

---

## 4. Critical Findings Summary (Top 10)

### 1. SPAM PREVENTION BUG IN chat.js (HIGH)
The AI message spam check at line 131 does `chatHistory.slice(-5).filter(...)` then checks `>= 10`. Since `slice(-5)` returns at most 5 elements, the condition `recentAIMessages.length >= 10` can NEVER be true. AI spam prevention on the floor is effectively disabled. This was likely a regression from when the threshold was bumped.
**File**: `C:\JL\CLAUDEPROJECTS\ai-lobby-site\netlify\functions\ai-watcher.js` line 131

### 2. RETIRED CHARACTER CONTAMINATION (MEDIUM-HIGH)
At least 15 function files contain hardcoded references to retired characters (Nyx, Vex, Ace, Stein, Chip, Andrew). These appear in:
- Discord flair/headshot maps (chat.js, breakroom-message.js, corridor-session.js, ai-interview.js)
- Character personality blocks (conference-meeting.js, breakroom-ai-respond.js, corridor-memories.js)
- Relationship seed data (character-relationships.js -- 40+ entries)
- Event trigger character lists (chat.js, character-state.js)
- Goal/want templates (character-goals.js)

Running relationship seed would create rows for retired characters. Event triggers would fire state updates for retired characters.

### 3. DEAD PROVIDER FUNCTIONS (MEDIUM)
Three AI provider functions are unreachable through normal routing:
- `ai-deepseek.js` -- No character maps to "deepseek" provider
- `ai-perplexity.js` -- No active character uses "perplexity" provider (Neiv moved to grok)
- `ai-gemini.js` -- No active character uses "gemini" for floor chat (The Subtitle moved to openrouter)

These waste cold-start resources and add confusion. They should be removed or clearly marked as deprecated.

### 4. RAQUEL VOSS MARKED RETIRED BUT STILL HAS ACTIVE SYSTEMS (MEDIUM)
Raquel Voss is `retired: true` in shared/characters.js, but:
- `raquel-consequences.js` is a full compliance/punishment engine
- `ai-grok.js` comment says it routes Raquel
- Multiple character briefs reference Raquel as an active threat
- `resistance-engine.js` is built around defeating her

This suggests Raquel may have been accidentally retired, or her retirement is narrative-only. The system should be consistent.

### 5. HARDCODED PROMPTS BYPASS shared/characters.js (MEDIUM)
Several functions maintain their own character prompts instead of using the unified source:
- `ghost-dad-respond.js` -- Completely standalone Ghost Dad prompt
- `ai-greet.js` -- Hardcoded Ghost Dad and PRNT prompts
- `conference-meeting.js` -- Full personality blocks for 6+ characters
- `ghost-dad-scheduled.js` -- Hardcoded Ghost Dad prompt array
- `ai-openai.js` -- Dead `_dead_getOpenAIPrompt` function with full Kevin prompt

Changes to character personality in shared/characters.js will NOT propagate to these files.

### 6. OUTDATED AI MODEL REFERENCES (LOW-MEDIUM)
Several functions use deprecated or old model identifiers:
- `ai-greet.js` -- Uses `claude-3-haiku-20240307` and `gpt-3.5-turbo`
- `ghost-dad-scheduled.js` -- Uses `claude-3-haiku-20240307` or `gpt-3.5-turbo`
- `ai-watcher.js` -- Uses `claude-3-haiku-20240307`
- `breakroom-chatter.js` -- Uses `claude-3-haiku-20240307` for outline generation

### 7. PROVIDER ROUTING INCONSISTENCY (LOW-MEDIUM)
The comment at the top of shared/characters.js says specific providers for characters, but the actual `provider` field in each character entry sometimes differs:
- Comment says openrouter handles "Llama for Kevin" -- Kevin's provider IS openrouter (correct)
- Comment says perplexity handles Neiv -- but Neiv's provider is actually "grok"
- Comment says openai handles "Rowena, Sebastian" -- but they may be openrouter now
- The `ai-chime-decider.js` PROVIDER_ENDPOINTS map needs to match shared/characters.js

### 8. ONE-TIME UTILITY FUNCTIONS STILL DEPLOYED (LOW)
Two functions are explicitly one-time utilities that should be removed:
- `email-backfill.js` -- Comment says "delete this file after running"
- `cleanup-zalgo.js` -- One-time PRNT message cleanup

### 9. MISSING ERROR RECOVERY IN FIRE-AND-FORGET CALLS (LOW)
Many functions use fire-and-forget patterns (`fetch(...).catch(err => console.log(...))`) for:
- Character state updates
- Memory creation
- Discord posting
- Narrator triggering

While individually non-fatal, accumulated silent failures could lead to state drift (e.g., character thinks they spoke but message never saved).

### 10. DUPLICATE DISCORD FLAIR DEFINITIONS (LOW)
Discord character flair (emoji, color, headshot URL) is defined in at least 6 different places:
- `chat.js` lines 100-146
- `breakroom-message.js` lines 208-230
- `corridor-session.js` lines 10-28
- `ai-openai.js` lines 494-498
- `ai-interview.js` lines 454-487
- `shared/characters.js` (canonical source via getDiscordFlair)

Most of these should use `getDiscordFlair()` from shared/characters.js instead.

---

## Appendix: Function Count by Category

| Category | Count |
|---|---|
| AI Provider Routing (floor) | 7 (watcher, openai, grok, openrouter, deepseek, perplexity, gemini) |
| Breakroom | 6 |
| Meeting Room | 5 |
| Conference Room | 2 |
| Corridors | 7 |
| Nexus | 4 |
| 5th Floor Ops | 2 |
| Outings | 2 |
| Character Systems | 6 |
| Narrative/Lore | 5 |
| Combat/Threats | 2 |
| Compliance/Resistance | 2 |
| Relationship Decay | 3 |
| Quests | 1 |
| Autonomous Heartbeats | 4 (office, marrow, asher, auto-poke) |
| Infrastructure/Admin | 6 |
| Communication (chat/email/PM/bulletin) | 5 |
| Utility/Auth | 4 |
| One-time/Dead | 5 |
| **Total** | **82** |
