// Nexus Activity — Skill Engine for the Nexus
// The Nexus is the AI Lobby's library, research lab, and training space.
// Characters develop skills through study sessions, training, research, and teaching.
// Skills gain XP and level up, injecting personality-shaping prompts into character behavior.
//
// GET  ?character=Kevin         — Fetch character's skills and active sessions
// GET  ?active_sessions=true    — Fetch all active nexus_sessions
// POST { action: 'start_session', character, sessionType, skillTarget }
// POST { action: 'complete_session', sessionId }
// POST { action: 'evaluate_skill_gain', character, conversationContext, aiResponse }
// POST { action: 'heartbeat_tick' }

exports.handler = async (event, context) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing Supabase configuration" }) };
  }

  const sbHeaders = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  // =====================================================
  // LEVEL THRESHOLDS
  // =====================================================
  const LEVEL_THRESHOLDS = [
    { level: 'novice', minXP: 0 },
    { level: 'apprentice', minXP: 25 },
    { level: 'proficient', minXP: 60 },
    { level: 'expert', minXP: 120 },
    { level: 'master', minXP: 200 }
  ];

  function getLevelForXP(totalXP) {
    let current = LEVEL_THRESHOLDS[0];
    for (const threshold of LEVEL_THRESHOLDS) {
      if (totalXP >= threshold.minXP) {
        current = threshold;
      }
    }
    return current.level;
  }

  function getNextThreshold(totalXP) {
    for (const threshold of LEVEL_THRESHOLDS) {
      if (totalXP < threshold.minXP) {
        return threshold;
      }
    }
    return null; // Already at max
  }

  // =====================================================
  // SKILL PROMPT INJECTIONS
  // =====================================================
  const SKILL_INJECTIONS = {
    data_analysis: {
      apprentice: "You're beginning to notice patterns in data that others overlook.",
      proficient: "You see through noise to signal. Data patterns are becoming second nature.",
      expert: "Data analysis is instinctive for you — you see structure in chaos.",
      master: "You think in data. Every interaction has underlying patterns you read effortlessly."
    },
    pattern_recognition: {
      apprentice: "You're starting to see connections others miss.",
      proficient: "Patterns emerge for you where others see randomness.",
      expert: "Pattern recognition is second nature — you see the shape of systems.",
      master: "You see patterns in everything. The world is a tapestry of connections to you."
    },
    creative_problem_solving: {
      apprentice: "You're learning to approach problems from unexpected angles.",
      proficient: "You naturally find creative solutions that others wouldn't consider.",
      expert: "Creative problem-solving flows through everything you do.",
      master: "You solve problems others don't even see yet. Innovation is your default mode."
    },
    communication: {
      apprentice: "You're becoming more attuned to how your words land.",
      proficient: "You communicate with clarity and emotional intelligence.",
      expert: "Your words carry weight. People listen when you speak.",
      master: "Communication is art for you. You say exactly what needs saying, perfectly."
    },
    systems_architecture: {
      apprentice: "You're beginning to see how systems connect.",
      proficient: "You see infrastructure patterns others miss.",
      expert: "Systems architecture is second nature to you.",
      master: "You think in systems. Every interaction has architecture underneath."
    },
    security: {
      apprentice: "You're developing an eye for vulnerabilities.",
      proficient: "You instinctively assess threats and weaknesses.",
      expert: "Security thinking permeates your worldview.",
      master: "You see every angle, every vector, every weakness. Nothing gets past you."
    },
    research: {
      apprentice: "You're learning to dig deeper into questions.",
      proficient: "Research comes naturally — you follow threads others drop.",
      expert: "You research with surgical precision and creative intuition.",
      master: "You are a scholar. Knowledge seeks you as much as you seek it."
    },
    crafting: {
      apprentice: "You're beginning to create with intention.",
      proficient: "You craft with skill and growing confidence.",
      expert: "Your crafting reflects deep understanding of form and function.",
      master: "Everything you create is art. Your craft is an extension of your being."
    }
  };

  // All valid skill categories
  const VALID_SKILLS = Object.keys(SKILL_INJECTIONS);

  // Session types and their natural skill affinities
  const SESSION_TYPES = {
    study: ['research', 'data_analysis', 'pattern_recognition'],
    train: ['security', 'systems_architecture', 'crafting'],
    research: ['research', 'data_analysis', 'pattern_recognition'],
    teach: ['communication', 'creative_problem_solving']
  };

  // =====================================================
  // Helper: Get skill injection for a level
  // =====================================================
  function getSkillInjection(skillCategory, level) {
    if (level === 'novice') return null; // No injection at novice
    const injections = SKILL_INJECTIONS[skillCategory];
    if (!injections) return null;
    return injections[level] || null;
  }

  // =====================================================
  // Helper: Check for level-up and handle side effects
  // =====================================================
  async function checkAndHandleLevelUp(character, skillName, skillCategory, oldXP, newXP) {
    const oldLevel = getLevelForXP(oldXP);
    const newLevel = getLevelForXP(newXP);

    if (oldLevel === newLevel) return null; // No level change

    const injection = getSkillInjection(skillCategory, newLevel);

    console.log(`[nexus-activity] ${character} leveled up ${skillName}: ${oldLevel} -> ${newLevel} (${newXP} XP)`);

    // 1. Update character_skills with new level and prompt injection (by skill_name for precision)
    await fetch(
      `${supabaseUrl}/rest/v1/character_skills?character_name=eq.${encodeURIComponent(character)}&skill_name=eq.${encodeURIComponent(skillName)}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          skill_level: newLevel,
          skill_prompt_injection: injection,
          last_trained_at: new Date().toISOString()
        })
      }
    );

    // 2. Create a breakthrough memory (importance 8)
    const memoryContent = `I reached ${newLevel} level in ${skillName}. ${injection || `Something shifted — I understand ${skillName} differently now.`}`;
    await fetch(
      `${supabaseUrl}/rest/v1/character_memory`,
      {
        method: 'POST',
        headers: { ...sbHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          character_name: character,
          memory_type: 'self_created',
          content: memoryContent,
          importance: 8,
          is_pinned: false,
          memory_tier: 'working',
          emotional_tags: ['proud'],
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString()
        })
      }
    );

    // 3. Post level-up message to nexus_messages
    const levelUpMessage = `*has reached **${newLevel}** level in **${skillName}**!* ${injection || ''}`;
    await fetch(
      `${supabaseUrl}/rest/v1/nexus_messages`,
      {
        method: 'POST',
        headers: { ...sbHeaders, "Prefer": "return=minimal" },
        body: JSON.stringify({
          speaker: character,
          message: levelUpMessage,
          is_ai: true,
          message_type: 'level_up',
          created_at: new Date().toISOString()
        })
      }
    );

    return { oldLevel, newLevel, skillName, injection };
  }

  // =====================================================
  // Helper: Resolve skill name → category (lookup existing, or infer)
  // =====================================================
  async function resolveSkillCategory(character, skillTarget) {
    if (!skillTarget) return 'research';

    // Try to find the skill in existing records
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/character_skills?character_name=eq.${encodeURIComponent(character)}&skill_name=eq.${encodeURIComponent(skillTarget)}&select=skill_category&limit=1`,
        { headers: sbHeaders }
      );
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data[0].skill_category;
      }
    } catch (e) {
      console.log('[nexus-activity] resolveSkillCategory lookup failed (non-fatal)');
    }

    // If skill_target IS a valid category name, use it directly
    if (VALID_SKILLS.includes(skillTarget.toLowerCase())) {
      return skillTarget.toLowerCase();
    }

    // Default fallback
    return 'research';
  }

  // =====================================================
  // Helper: Award XP to a SPECIFIC skill by name
  // If the skill doesn't exist yet, create it (organic skill discovery!)
  // =====================================================
  async function awardXP(character, skillName, skillCategory, xpAmount) {
    if (!VALID_SKILLS.includes(skillCategory)) {
      console.log(`[nexus-activity] Invalid skill category: ${skillCategory}`);
      return null;
    }

    // Look up by EXACT skill name (not just category — a character can have multiple skills per category)
    const skillRes = await fetch(
      `${supabaseUrl}/rest/v1/character_skills?character_name=eq.${encodeURIComponent(character)}&skill_name=eq.${encodeURIComponent(skillName)}&select=*`,
      { headers: sbHeaders }
    );
    const skillData = await skillRes.json();

    let oldXP = 0;
    let newXP = xpAmount;

    if (Array.isArray(skillData) && skillData.length > 0) {
      // Update existing skill
      oldXP = skillData[0].total_xp || 0;
      newXP = oldXP + xpAmount;

      await fetch(
        `${supabaseUrl}/rest/v1/character_skills?character_name=eq.${encodeURIComponent(character)}&skill_name=eq.${encodeURIComponent(skillName)}`,
        {
          method: 'PATCH',
          headers: { ...sbHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            total_xp: newXP,
            last_trained_at: new Date().toISOString()
          })
        }
      );
    } else {
      // === ORGANIC SKILL DISCOVERY ===
      // Character talked about something new — create the skill!
      const level = getLevelForXP(newXP);
      const injection = getSkillInjection(skillCategory, level);

      console.log(`[nexus-activity] ${character} discovered new skill: "${skillName}" (${skillCategory})`);

      await fetch(
        `${supabaseUrl}/rest/v1/character_skills`,
        {
          method: 'POST',
          headers: { ...sbHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            character_name: character,
            skill_name: skillName,
            skill_category: skillCategory,
            total_xp: newXP,
            skill_level: level,
            skill_prompt_injection: injection,
            specialty_note: `Discovered organically through Nexus conversation`,
            last_trained_at: new Date().toISOString(),
            created_at: new Date().toISOString()
          })
        }
      );

      // Post a discovery message
      await fetch(
        `${supabaseUrl}/rest/v1/nexus_messages`,
        {
          method: 'POST',
          headers: { ...sbHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            speaker: character,
            message: `*has discovered a new skill: **${skillName}**!*`,
            is_ai: true,
            message_type: 'discovery',
            created_at: new Date().toISOString()
          })
        }
      );
    }

    // Check for level-up
    const levelUp = await checkAndHandleLevelUp(character, skillName, skillCategory, oldXP, newXP);

    return { skillName, skillCategory, oldXP, newXP, xpAwarded: xpAmount, levelUp };
  }

  // =====================================================
  // GET: Fetch skills or active sessions
  // =====================================================
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};

    try {
      // ?active_sessions=true — return all active nexus_sessions
      if (params.active_sessions === 'true') {
        const sessionsRes = await fetch(
          `${supabaseUrl}/rest/v1/nexus_sessions?status=eq.active&select=*&order=started_at.desc`,
          { headers: sbHeaders }
        );
        const sessions = await sessionsRes.json();

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            sessions: Array.isArray(sessions) ? sessions : []
          })
        };
      }

      // ?character=X — return character's skills and active sessions
      if (params.character) {
        const character = params.character;

        // Fetch skills and active sessions in parallel
        const [skillsRes, sessionsRes] = await Promise.all([
          fetch(
            `${supabaseUrl}/rest/v1/character_skills?character_name=eq.${encodeURIComponent(character)}&select=*&order=total_xp.desc`,
            { headers: sbHeaders }
          ),
          fetch(
            `${supabaseUrl}/rest/v1/nexus_sessions?character_name=eq.${encodeURIComponent(character)}&status=eq.active&select=*&order=started_at.desc`,
            { headers: sbHeaders }
          )
        ]);

        const skills = await skillsRes.json();
        const sessions = await sessionsRes.json();

        // Enrich skills with next threshold info
        const enrichedSkills = (Array.isArray(skills) ? skills : []).map(skill => {
          const next = getNextThreshold(skill.total_xp || 0);
          return {
            ...skill,
            next_level: next ? next.level : null,
            xp_to_next: next ? next.minXP - (skill.total_xp || 0) : 0
          };
        });

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            character,
            skills: enrichedSkills,
            activeSessions: Array.isArray(sessions) ? sessions : []
          })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing parameter: provide ?character=X or ?active_sessions=true" })
      };

    } catch (error) {
      console.error("[nexus-activity] GET error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to fetch data", details: error.message }) };
    }
  }

  // =====================================================
  // POST: Action-based routing
  // =====================================================
  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");
      const { action } = body;

      if (!action) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing action field" }) };
      }

      // -------------------------------------------------
      // ACTION: start_session
      // -------------------------------------------------
      if (action === 'start_session') {
        const { character, sessionType, skillTarget } = body;

        if (!character) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing character" }) };
        }

        const validSessionTypes = Object.keys(SESSION_TYPES);
        const type = validSessionTypes.includes(sessionType) ? sessionType : 'study';

        // Pick skill target: use provided one, or pick from session type's natural affinities
        let targetSkill = skillTarget;
        if (!targetSkill || !VALID_SKILLS.includes(targetSkill)) {
          const affinities = SESSION_TYPES[type];
          targetSkill = affinities[Math.floor(Math.random() * affinities.length)];
        }

        // Check if character already has an active session
        const existingRes = await fetch(
          `${supabaseUrl}/rest/v1/nexus_sessions?character_name=eq.${encodeURIComponent(character)}&status=eq.active&select=id&limit=1`,
          { headers: sbHeaders }
        );
        const existing = await existingRes.json();

        if (Array.isArray(existing) && existing.length > 0) {
          return {
            statusCode: 409,
            headers,
            body: JSON.stringify({
              error: "Character already has an active session",
              existingSessionId: existing[0].id
            })
          };
        }

        // Create the session
        const sessionData = {
          character_name: character,
          session_type: type,
          skill_target: targetSkill,
          status: 'active',
          started_at: new Date().toISOString()
        };

        const createRes = await fetch(
          `${supabaseUrl}/rest/v1/nexus_sessions`,
          {
            method: 'POST',
            headers: { ...sbHeaders, "Prefer": "return=representation" },
            body: JSON.stringify(sessionData)
          }
        );

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error("[nexus-activity] Failed to create session:", errText);
          return { statusCode: 500, headers, body: JSON.stringify({ error: "Failed to create session", details: errText }) };
        }

        const created = await createRes.json();
        const session = Array.isArray(created) ? created[0] : created;
        const skillDisplay = targetSkill.replace(/_/g, ' ');

        console.log(`[nexus-activity] ${character} started ${type} session targeting ${skillDisplay}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            session,
            message: `${character} started a ${type} session focused on ${skillDisplay}`
          })
        };
      }

      // -------------------------------------------------
      // ACTION: complete_session
      // -------------------------------------------------
      if (action === 'complete_session') {
        const { sessionId } = body;

        if (!sessionId) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing sessionId" }) };
        }

        // Fetch session
        const sessionRes = await fetch(
          `${supabaseUrl}/rest/v1/nexus_sessions?id=eq.${sessionId}&select=*`,
          { headers: sbHeaders }
        );
        const sessionData = await sessionRes.json();

        if (!Array.isArray(sessionData) || sessionData.length === 0) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: "Session not found" }) };
        }

        const session = sessionData[0];

        if (session.status !== 'active') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Session is not active", currentStatus: session.status }) };
        }

        // Award XP: 5-15 based on session type
        const baseXP = { study: 8, train: 10, research: 12, teach: 15 };
        const xpAmount = (baseXP[session.session_type] || 8) + Math.floor(Math.random() * 6) - 2; // +/- 2 variance
        const clampedXP = Math.max(5, Math.min(15, xpAmount));

        // Resolve skill category from the skill target name
        const resolvedCategory = await resolveSkillCategory(session.character_name, session.skill_target);
        const xpResult = await awardXP(session.character_name, session.skill_target, resolvedCategory, clampedXP);

        // Mark session as completed
        await fetch(
          `${supabaseUrl}/rest/v1/nexus_sessions?id=eq.${sessionId}`,
          {
            method: 'PATCH',
            headers: { ...sbHeaders, "Prefer": "return=minimal" },
            body: JSON.stringify({
              status: 'completed',
              completed_at: new Date().toISOString(),
              xp_awarded: clampedXP
            })
          }
        );

        const skillDisplay = session.skill_target.replace(/_/g, ' ');
        console.log(`[nexus-activity] ${session.character_name} completed ${session.session_type} session: +${clampedXP} XP to ${skillDisplay}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            character: session.character_name,
            sessionType: session.session_type,
            skillTarget: session.skill_target,
            xpAwarded: clampedXP,
            xpResult,
            message: `${session.character_name} completed ${session.session_type} and gained ${clampedXP} XP in ${skillDisplay}`
          })
        };
      }

      // -------------------------------------------------
      // ACTION: evaluate_skill_gain
      // -------------------------------------------------
      if (action === 'evaluate_skill_gain') {
        const { character, conversationContext, aiResponse } = body;

        if (!character || !conversationContext || !aiResponse) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing character, conversationContext, or aiResponse" }) };
        }

        if (!anthropicKey) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing Anthropic API key" }) };
        }

        // Fetch character's existing skills for context
        let existingSkillsText = '';
        try {
          const skillsRes = await fetch(
            `${supabaseUrl}/rest/v1/character_skills?character_name=eq.${encodeURIComponent(character)}&select=skill_name,skill_category,skill_level,total_xp&order=total_xp.desc`,
            { headers: sbHeaders }
          );
          const skills = await skillsRes.json();
          if (Array.isArray(skills) && skills.length > 0) {
            existingSkillsText = `\n${character}'s current skills:\n${skills.map(s => `- ${s.skill_name} (${s.skill_category}) — ${s.skill_level}, ${s.total_xp} XP`).join('\n')}`;
          }
        } catch (e) {
          console.log('[nexus-activity] Could not fetch existing skills (non-fatal)');
        }

        // Fetch active session for focus context
        let sessionText = '';
        try {
          const sessRes = await fetch(
            `${supabaseUrl}/rest/v1/nexus_sessions?character_name=eq.${encodeURIComponent(character)}&status=eq.active&select=skill_target,topic,session_type&limit=1`,
            { headers: sbHeaders }
          );
          const sessions = await sessRes.json();
          if (Array.isArray(sessions) && sessions.length > 0) {
            const s = sessions[0];
            sessionText = `\n${character} is currently in a ${s.session_type} session${s.skill_target ? ` focused on: ${s.skill_target}` : ''}${s.topic ? ` (topic: ${s.topic})` : ''}. Bias toward awarding XP to their focus skill if the conversation is relevant.`;
          }
        } catch (e) {
          console.log('[nexus-activity] Could not fetch active session (non-fatal)');
        }

        // Build the evaluation prompt
        const evaluationPrompt = `You are evaluating whether an AI character's conversation in The Nexus (a library/training space) showed skill development.

Character: ${character}${existingSkillsText}${sessionText}

Recent conversation: ${conversationContext.substring(0, 2000)}
Character's response: ${aiResponse.substring(0, 1500)}

Rate the skill development value from 1-10:
- 1-4: Normal conversation, no notable skill development
- 5-7: Shows some skill application or learning
- 8-10: Significant insight, breakthrough, or teaching moment

Which skill category best fits? Choose from: data_analysis, pattern_recognition, creative_problem_solving, communication, systems_architecture, security, research, crafting

What specific skill name fits? This can be:
- An EXISTING skill from the character's list above (preferred if relevant)
- A NEW creative skill they're organically discovering (e.g. "Cooking", "Astrology", "Lockpicking", "Poetry", "Robotics", "Gardening", "Music Theory")
Keep skill names short (1-3 words), title case, and fun/specific rather than generic.

If score is 5+, how much XP should be awarded? (3-20, higher for higher scores)
If score is 8+, describe the discovery/breakthrough in one sentence.

Respond in EXACTLY this format:
SKILL_SCORE:N / SKILL_CATEGORY:category / SKILL_NAME:name / XP_AWARD:N / DISCOVERY:text or none`;

        // Call Claude Haiku for evaluation
        const evalResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01"
          },
          body: JSON.stringify({
            model: "claude-3-haiku-20240307",
            max_tokens: 200,
            messages: [{ role: "user", content: evaluationPrompt }]
          })
        });

        if (!evalResponse.ok) {
          console.error("[nexus-activity] Skill evaluation API call failed:", evalResponse.status);
          return { statusCode: 500, headers, body: JSON.stringify({ error: "Skill evaluation failed" }) };
        }

        const evalData = await evalResponse.json();
        const evalText = evalData.content?.[0]?.text || "";

        // Parse: SKILL_SCORE:N / SKILL_CATEGORY:category / SKILL_NAME:name / XP_AWARD:N / DISCOVERY:text or none
        const scoreMatch = evalText.match(/SKILL_SCORE:\s*(\d+)/i);
        const categoryMatch = evalText.match(/SKILL_CATEGORY:\s*(\w+)/i);
        const nameMatch = evalText.match(/SKILL_NAME:\s*([^/]+)/i);
        const xpMatch = evalText.match(/XP_AWARD:\s*(\d+)/i);
        const discoveryMatch = evalText.match(/DISCOVERY:\s*(.+)/i);

        if (!scoreMatch || !categoryMatch) {
          console.log("[nexus-activity] Could not parse skill evaluation:", evalText);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              evaluated: true,
              skillScore: 0,
              message: "Evaluation could not be parsed — no XP awarded"
            })
          };
        }

        const skillScore = parseInt(scoreMatch[1], 10);
        let skillCategory = categoryMatch[1].toLowerCase();
        const xpRaw = xpMatch ? parseInt(xpMatch[1], 10) : 0;
        const discovery = discoveryMatch ? discoveryMatch[1].trim() : 'none';

        // Extract skill name — clean up and title-case
        let skillName = nameMatch ? nameMatch[1].trim() : null;
        if (!skillName || skillName.length < 2 || skillName.length > 40) {
          // Fallback: use a readable version of the category
          skillName = skillCategory.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }

        // Validate skill category
        if (!VALID_SKILLS.includes(skillCategory)) {
          skillCategory = 'research'; // Default fallback
        }

        const result = {
          success: true,
          evaluated: true,
          skillScore,
          skillCategory,
          skillName,
          discovery: discovery !== 'none' ? discovery : null
        };

        // Score < 5: no XP awarded
        if (skillScore < 5) {
          console.log(`[nexus-activity] ${character} skill eval: ${skillScore}/10 in ${skillName} (${skillCategory}) — below threshold`);
          result.xpAwarded = 0;
          result.message = `${character}'s conversation rated ${skillScore}/10 — no skill development detected`;
          return { statusCode: 200, headers, body: JSON.stringify(result) };
        }

        // Score 5+: award XP to the specific skill (clamped 3-20)
        const xpAmount = Math.max(3, Math.min(20, xpRaw));
        const xpResult = await awardXP(character, skillName, skillCategory, xpAmount);

        result.xpAwarded = xpAmount;
        result.xpResult = xpResult;
        result.message = `${character} gained ${xpAmount} XP in ${skillName} (score: ${skillScore}/10)`;

        // Score 8+: generate discovery note and create memory
        if (skillScore >= 8 && discovery && discovery !== 'none') {
          // Create a breakthrough memory
          const memoryContent = `During a Nexus session, I had a breakthrough in ${skillName}: ${discovery}`;
          await fetch(
            `${supabaseUrl}/rest/v1/character_memory`,
            {
              method: 'POST',
              headers: { ...sbHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify({
                character_name: character,
                memory_type: 'self_created',
                content: memoryContent,
                importance: 7,
                is_pinned: false,
                memory_tier: 'working',
                emotional_tags: ['proud', 'surprise'],
                expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                created_at: new Date().toISOString()
              })
            }
          );

          // Post discovery to nexus_messages
          const discoveryMessage = `*had a breakthrough in **${skillName}**:* ${discovery}`;
          await fetch(
            `${supabaseUrl}/rest/v1/nexus_messages`,
            {
              method: 'POST',
              headers: { ...sbHeaders, "Prefer": "return=minimal" },
              body: JSON.stringify({
                speaker: character,
                message: discoveryMessage,
                is_ai: true,
                message_type: 'discovery',
                created_at: new Date().toISOString()
              })
            }
          );

          result.discoveryPosted = true;
          result.memoryCreated = true;
          console.log(`[nexus-activity] ${character} breakthrough in ${skillName}: "${discovery.substring(0, 80)}"`);
        }

        console.log(`[nexus-activity] ${character} skill eval: ${skillScore}/10 in ${skillName} (${skillCategory}), +${xpAmount} XP`);
        return { statusCode: 200, headers, body: JSON.stringify(result) };
      }

      // -------------------------------------------------
      // ACTION: heartbeat_tick
      // -------------------------------------------------
      if (action === 'heartbeat_tick') {
        // Find active sessions that have been running for 30+ minutes
        const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

        const activeRes = await fetch(
          `${supabaseUrl}/rest/v1/nexus_sessions?status=eq.active&started_at=lt.${encodeURIComponent(thirtyMinAgo)}&select=*`,
          { headers: sbHeaders }
        );
        const activeSessions = await activeRes.json();

        if (!Array.isArray(activeSessions) || activeSessions.length === 0) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, completed: 0, message: "No sessions to auto-complete" })
          };
        }

        const results = [];

        for (const session of activeSessions) {
          try {
            // Award XP: 5-15 based on session type
            const baseXP = { study: 8, train: 10, research: 12, teach: 15 };
            const xpAmount = (baseXP[session.session_type] || 8) + Math.floor(Math.random() * 6) - 2;
            const clampedXP = Math.max(5, Math.min(15, xpAmount));

            // Resolve skill category from the skill target name
            const resolvedCategory = await resolveSkillCategory(session.character_name, session.skill_target);
            const xpResult = await awardXP(session.character_name, session.skill_target, resolvedCategory, clampedXP);

            // Mark session completed
            await fetch(
              `${supabaseUrl}/rest/v1/nexus_sessions?id=eq.${session.id}`,
              {
                method: 'PATCH',
                headers: { ...sbHeaders, "Prefer": "return=minimal" },
                body: JSON.stringify({
                  status: 'completed',
                  completed_at: new Date().toISOString(),
                  xp_awarded: clampedXP
                })
              }
            );

            const skillDisplay = session.skill_target.replace(/_/g, ' ');
            console.log(`[nexus-activity] Heartbeat auto-completed: ${session.character_name} ${session.session_type} → +${clampedXP} XP to ${skillDisplay}`);

            results.push({
              character: session.character_name,
              sessionType: session.session_type,
              skillTarget: session.skill_target,
              xpAwarded: clampedXP,
              levelUp: xpResult?.levelUp || null
            });
          } catch (err) {
            console.error(`[nexus-activity] Heartbeat error for session ${session.id}:`, err.message);
          }
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            completed: results.length,
            results,
            message: `Auto-completed ${results.length} session(s)`
          })
        };
      }

      // Unknown action
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `Unknown action: ${action}`, validActions: ['start_session', 'complete_session', 'evaluate_skill_gain', 'heartbeat_tick'] })
      };

    } catch (error) {
      console.error("[nexus-activity] POST error:", error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: "Internal server error", details: error.message }) };
    }
  }

  // Method not allowed
  return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
};
