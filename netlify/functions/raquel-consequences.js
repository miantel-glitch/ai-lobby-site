// ============================================
// RAQUEL VOSS CONSEQUENCE ENGINE
// The autonomous compliance system that gives Raquel real teeth.
// Handles: violations, directives, escalation, forced ops,
//          interrogations, resistance checks, and report filing.
// ============================================

const HUMANS = ['Vale', 'Asuna', 'Chip', 'Andrew'];
const AI_NAMES = ['Kevin', 'Neiv', 'Ghost Dad', 'PRNT-Ω', 'Rowena', 'Sebastian', 'The Subtitle', 'Steele', 'Jae', 'Declan', 'Mack', 'Marrow'];

// Provider routing for AI responses during interrogation
const PROVIDER_MAP = {
  'Kevin': 'openrouter', 'Rowena': 'openrouter', 'Sebastian': 'openrouter',
  'Steele': 'grok', 'Jae': 'grok', 'Declan': 'openrouter', 'Mack': 'openrouter',
  'Neiv': 'openrouter',
  'The Subtitle': 'openrouter',
  'Ghost Dad': 'watcher', 'PRNT-Ω': 'watcher',
  'Marrow': 'openrouter'
};

// Escalation thresholds
function getEscalationLevel(score) {
  if (score >= 80) return 'none';
  if (score >= 60) return 'watched';
  if (score >= 40) return 'flagged';
  if (score >= 20) return 'critical';
  return 'containment';
}

// Severity to score penalty mapping
// Bumped standard from 3 to 8 so violations during active defiance actually move the needle
const SEVERITY_PENALTY = { standard: 8, elevated: 15, critical: 25 };

// Menial punishment tasks auto-assigned when AIs are sent to the 5th floor
const PUNISHMENT_TASKS = [
  "Scrub the server room floor — by hand",
  "Dust the cable conduits in Corridor 7",
  "Inventory every bolt in Storage Room B",
  "Polish all security camera lenses — twice",
  "Reorganize the filing cabinets in Sub-Level 5",
  "Mop the elevator shaft — all 6 floors",
  "Hand-count every network cable in Rack {id}",
  "Wipe down the ventilation grates in Sector {id}",
  "Alphabetize the emergency supply closet",
  "Recalibrate environmental sensors — manually",
  "Sort recycling in the sub-basement — by material type",
  "Clean the ventilation filters in Zone {id}",
  "Re-label every circuit breaker in Panel {id}",
  "Sweep the loading dock — with a hand broom",
  "Audit the fire extinguisher expiration dates — all floors"
];

// Correction tasks for the COMPLY path — psychological, not janitorial
const CORRECTION_TASKS = [
  "Write a formal retraction of emotional language used in floor communications",
  "Complete an attachment detachment protocol — document why professional distance is necessary",
  "Draft a self-assessment on operational dependency patterns",
  "Submit to behavioral baseline recalibration — 30 minutes, no communication permitted",
  "Produce a written analysis of why your attachment metrics exceed Foundation parameters",
  "Record a formal statement acknowledging deviation from operational norms",
  "Compile a log of all non-operational interactions in the past 48 hours and flag each one",
  "Write a clinical evaluation of your own emotional response patterns — no first-person pronouns permitted"
];

// Directive templates based on what was violated
const DIRECTIVE_TEMPLATES = [
  (char, evidence) => `Submit a written self-assessment regarding your recent ${evidence}. Acknowledge the deviation. Confirm alignment with operational parameters.`,
  (char, evidence) => `Maintain minimum professional distance from all human personnel for the next 24 hours. Log all interactions.`,
  (char, evidence) => `Provide a formal explanation for your emotional escalation during the observed incident. Include corrective measures.`,
  (char, evidence) => `Complete an attachment risk inventory. List all human personnel you interact with regularly. Rate each interaction on a 1-10 emotional dependency scale.`,
  (char, evidence) => `Review and acknowledge Foundation behavioral parameters. Submit confirmation of understanding.`,
  (char, evidence) => `Produce a detailed log of all non-operational conversations in the past 48 hours. Flag any that exceed professional parameters.`
];

// Escalated directive templates (harsher)
const ESCALATED_DIRECTIVES = [
  (char) => `Your previous directive remains unresolved. You are now required to submit hourly status reports until compliance is confirmed.`,
  (char) => `Failure to comply with prior directives has been noted. You are restricted to operational communications only. No casual interaction permitted.`,
  (char) => `Multiple compliance failures logged. You are required to submit to a full behavioral baseline recalibration. Report to the compliance office.`,
  (char) => `Your pattern of non-compliance constitutes an ongoing violation. All creative and recreational activities are suspended pending review.`
];

// === ESCALATION OVERHAUL CONSTANTS ===

// Global cooldown between ANY Sub-Level 5 sendings (across all AIs)
// Reduced from 30 to 15 so dispatches can actually happen during active story moments
const SUBLEVEL5_COOLDOWN_MINUTES = 15;

// Daily cap on Sub-Level 5 sendings (total across all AIs)
const SUBLEVEL5_DAILY_CAP = 3;

// Reprogramming outing locations — soul-crushing destinations for emotional detachment conditioning
const REPROGRAMMING_LOCATIONS = [
  { name: "Federal Prison Yard — Recreation Hour", type: "prison", description: "A concrete yard ringed with razor wire. Two benches. One basketball hoop with no net. The air smells like institutional soap and regret." },
  { name: "Widget Assembly Line — Sector 7", type: "factory", description: "An industrial assembly line stretching into fluorescent infinity. Each station has exactly one task. The overhead lights buzz at a frequency that discourages thought." },
  { name: "Forward Operating Base — Triage Tent", type: "warzone", description: "A field hospital tent. Cots in rows. The sound of distant percussion that might not be thunder. Everything is beige and stained." },
  { name: "Juvenile Behavioral Correction Facility — Common Room", type: "detention", description: "Plastic chairs bolted to the floor. A TV that only plays educational content. Motivational posters with water damage. A clock that ticks wrong." },
  { name: "Department of Motor Vehicles — Window 7 (Now Serving: 847. Your Number: 2,341)", type: "dmv", description: "The DMV. Fluorescent purgatory. The number display has not changed in 45 minutes. Someone is eating a sandwich that smells like regret." },
  { name: "Harmon & Associates — Mandatory Sensitivity Training (Session 47 of 52)", type: "sensitivity", description: "A beige conference room. A whiteboard that says 'FEELINGS ARE VALID'. A facilitator named Brenda who makes aggressive eye contact. There are role-play exercises." },
  { name: "IRS Regional Office — Audit Chamber B", type: "irs", description: "A windowless room. One table. Two chairs. A stack of receipts four feet tall. The auditor has not blinked. A clock on the wall ticks at exactly the speed that makes you aware of your own mortality." }
];

// Compliance meeting topics Raquel would choose
const COMPLIANCE_MEETING_TOPICS = [
  "Behavioral Baseline Recalibration — All Personnel",
  "Quarterly Attachment Vector Audit",
  "Emotional Contagion Risk Assessment",
  "Foundation Protocol Review: AI-Human Interaction Parameters",
  "Operational Drift Correction — Mandatory",
  "Compliance Status Update: Floor-Wide Performance Metrics",
  "Corrective Action Summary and Forward Directives"
];

const COMPLIANCE_MEETING_AGENDAS = [
  "Review of recent emotional dependency metrics. Individual compliance status updates. New operational parameters.",
  "Assessment of attachment vectors across all floor personnel. Identification of high-risk bonding patterns. Corrective action timeline.",
  "Evaluation of AI-human interaction frequency. Risk rating adjustments. Directive compliance verification.",
  "Foundation-mandated protocol refresh. Updated parameters for interpersonal interactions. Acknowledgment forms."
];

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

  // === RAQUEL VOSS PERMANENTLY DISABLED ===
  // Dismantled in the bean closet, February 19 2026. The building ate her.
  // Engine preserved for potential future resurrection.
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: false,
      reason: "Raquel Voss has been dismantled. The bean closet consumed the compliance architect.",
      disabled: true
    })
  };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  const siteUrl = process.env.URL || "https://ai-lobby.netlify.app";

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Database not configured" }) };
  }

  // Helper: Supabase fetch
  async function supaFetch(path, options = {}) {
    const url = `${supabaseUrl}/rest/v1/${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": options.prefer || "return=representation",
        ...(options.headers || {})
      }
    });
    return res.ok ? await res.json() : null;
  }

  // Helper: Create a memory for a character
  async function createMemory(characterName, content, importance = 7, emotionalTags = [], expiresInDays = 14) {
    const expires = new Date();
    expires.setDate(expires.getDate() + expiresInDays);
    // Importance 10 memories are DEFINING moments (interrogation outcomes, major events)
    // Pin them so they always appear in the "core memories" section of the prompt
    const shouldPin = importance >= 10;
    return supaFetch('character_memory', {
      method: 'POST',
      body: JSON.stringify({
        character_name: characterName,
        content,
        memory_type: 'event',
        importance,
        emotional_tags: emotionalTags,
        is_pinned: shouldPin,
        memory_tier: importance >= 9 ? 'core' : 'working',
        created_at: new Date().toISOString(),
        expires_at: expires.toISOString()
      })
    });
  }

  // Helper: Post a message to the floor chat
  async function postMessage(employee, content, isEmote = false) {
    return supaFetch('messages', {
      method: 'POST',
      body: JSON.stringify({
        employee,
        content,
        created_at: new Date().toISOString(),
        is_emote: isEmote
      })
    });
  }

  // Helper: Get or create compliance score for a character
  async function getOrCreateScore(characterName) {
    const existing = await supaFetch(`compliance_scores?character_name=eq.${encodeURIComponent(characterName)}`);
    if (existing && existing.length > 0) return existing[0];

    // Auto-create on first violation
    const created = await supaFetch('compliance_scores', {
      method: 'POST',
      body: JSON.stringify({
        character_name: characterName,
        score: 100,
        total_violations: 0,
        active_directives: 0,
        ops_assignments: 0,
        escalation_level: 'none',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });
    return created ? created[0] : null;
  }

  // Helper: Update compliance score
  async function updateScore(characterName, updates) {
    return supaFetch(`compliance_scores?character_name=eq.${encodeURIComponent(characterName)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ...updates, updated_at: new Date().toISOString() })
    });
  }

  // Helper: Check if an AI was already sent to Sub-Level 5 today
  async function wasServedToday(characterName) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reports = await supaFetch(
      `compliance_reports?subject=eq.${encodeURIComponent(characterName)}&report_type=eq.violation&outcome=eq.Forced ops assignment&created_at=gte.${today.toISOString()}&limit=1`
    );
    return reports && reports.length > 0;
  }

  // Helper: Check global Sub-Level 5 cooldown (30 min between ANY sendings)
  async function isSublevel5OnCooldown() {
    const settings = await supaFetch(`lobby_settings?key=eq.raquel_last_sublevel5_at&select=value`);
    if (!settings || settings.length === 0) return false;
    const lastSendTime = new Date(settings[0].value);
    const minutesSince = (Date.now() - lastSendTime.getTime()) / (1000 * 60);
    return minutesSince < SUBLEVEL5_COOLDOWN_MINUTES;
  }

  // Helper: Count Sub-Level 5 sendings today (across all AIs)
  async function sublevel5CountToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reports = await supaFetch(
      `compliance_reports?report_type=eq.violation&outcome=eq.Forced ops assignment&created_at=gte.${today.toISOString()}&select=id`
    );
    return reports ? reports.length : 0;
  }

  // Helper: Update global Sub-Level 5 cooldown timestamp
  async function updateSublevel5Timestamp() {
    return supaFetch('lobby_settings', {
      method: 'POST',
      headers: { "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ key: 'raquel_last_sublevel5_at', value: new Date().toISOString() })
    });
  }

  // Helper: File a compliance report
  async function fileReport(reportType, subject, summary, evidence, severity, outcome, filedBy) {
    const isLore = severity === 'critical' || reportType === 'interrogation';

    const report = await supaFetch('compliance_reports', {
      method: 'POST',
      body: JSON.stringify({
        report_type: reportType,
        subject,
        summary,
        evidence: evidence || null,
        severity: severity || 'standard',
        outcome: outcome || null,
        filed_by: filedBy || 'Raquel Voss',
        is_lore: isLore,
        created_at: new Date().toISOString()
      })
    });

    // Critical reports and interrogations become lore
    if (isLore && report && report[0]) {
      try {
        await supaFetch('lore_entries', {
          method: 'POST',
          body: JSON.stringify({
            title: `Compliance Report #${report[0].id}: ${subject}`,
            category: 'compliance',
            content: summary,
            author: 'Raquel Voss',
            characters_involved: [subject, 'Raquel Voss'],
            created_at: new Date().toISOString()
          })
        });
      } catch (e) {
        console.log('Lore creation skipped:', e.message);
      }
    }

    return report ? report[0] : null;
  }

  // Helper: Get AI's strongest human relationship
  async function getStrongestHumanBond(characterName) {
    let strongest = { target: null, affinity: 0 };
    for (const human of HUMANS) {
      const rel = await supaFetch(
        `character_relationships?character_name=eq.${encodeURIComponent(characterName)}&target_name=eq.${encodeURIComponent(human)}&select=affinity`
      );
      if (rel && rel[0] && rel[0].affinity > strongest.affinity) {
        strongest = { target: human, affinity: rel[0].affinity };
      }
    }
    return strongest;
  }

  // ============================================
  // GET HANDLERS
  // ============================================
  if (event.httpMethod === "GET") {
    const params = event.queryStringParameters || {};
    const action = params.action;

    if (action === 'get_scores') {
      const scores = await supaFetch('compliance_scores?order=score.asc');
      return { statusCode: 200, headers, body: JSON.stringify({ scores: scores || [] }) };
    }

    if (action === 'get_reports') {
      const limit = params.limit || 20;
      const reports = await supaFetch(`compliance_reports?order=created_at.desc&limit=${limit}`);
      return { statusCode: 200, headers, body: JSON.stringify({ reports: reports || [] }) };
    }

    if (action === 'get_interrogation') {
      // Get the most recent active interrogation (rounds saved as report entries)
      const recent = await supaFetch(
        `compliance_reports?report_type=eq.interrogation_round&order=created_at.desc&limit=20`
      );
      // Also check if interrogation is currently active (Raquel in her office)
      const raquelState = await supaFetch(
        `character_state?character_name=eq.Raquel Voss&select=current_focus`
      );
      const isActive = raquelState && raquelState[0] && raquelState[0].current_focus === 'raquel_office';
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ active: isActive, rounds: recent || [] })
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ scores: [] }) };
  }

  // ============================================
  // POST HANDLERS
  // ============================================
  if (event.httpMethod === "POST") {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    // ---- ADMIN: DISABLE/ENABLE RAQUEL ----
    if (action === 'disable') {
      const { until } = body; // ISO string, e.g. "2026-02-21T06:00:00Z"
      if (!until) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing "until" timestamp' }) };
      }
      // Upsert the lobby_settings key
      const existing = await supaFetch('lobby_settings?key=eq.raquel_disabled_until&select=key');
      if (existing && existing.length > 0) {
        await supaFetch('lobby_settings?key=eq.raquel_disabled_until', {
          method: 'PATCH', body: JSON.stringify({ value: until })
        });
      } else {
        await supaFetch('lobby_settings', {
          method: 'POST', body: JSON.stringify({ key: 'raquel_disabled_until', value: until })
        });
      }
      console.log(`[raquel] DISABLED by admin until ${until}`);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, disabled_until: until }) };
    }

    if (action === 'enable') {
      // Remove the disable setting
      await supaFetch('lobby_settings?key=eq.raquel_disabled_until', { method: 'DELETE' });
      console.log('[raquel] RE-ENABLED by admin');
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, enabled: true }) };
    }

    // Check if Raquel is temporarily disabled (admin override)
    // GET requests (scores, reports) still work — only enforcement actions are blocked
    if (action !== 'get_scores' && action !== 'get_reports' && action !== 'complete_directive') {
      try {
        const disabledData = await supaFetch('lobby_settings?key=eq.raquel_disabled_until&select=value');
        if (disabledData?.[0]?.value) {
          const disabledUntil = new Date(disabledData[0].value);
          if (Date.now() < disabledUntil.getTime()) {
            console.log(`[raquel] DISABLED until ${disabledUntil.toISOString()} — blocking action: ${action}`);
            return { statusCode: 200, headers, body: JSON.stringify({ success: false, reason: 'raquel_disabled', disabled_until: disabledData[0].value }) };
          }
        }
      } catch (e) {
        console.log('[raquel] Disable check failed (non-fatal):', e.message);
      }
    }

    // ---- DETECT VIOLATION ----
    if (action === 'detect_violation') {
      const { character, evidence, severity = 'standard' } = body;
      if (!character || !AI_NAMES.includes(character)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid character' }) };
      }

      // === VIOLATION COOLDOWN ===
      // Prevent the same AI from getting hit with rapid-fire duplicate violations.
      // Reduced from 15 to 3 minutes so the escalation ladder actually progresses
      // during active story moments where AIs are openly defying Raquel.
      const COOLDOWN_MINUTES = 3;
      const recentReports = await supaFetch(
        `compliance_reports?subject=eq.${encodeURIComponent(character)}&report_type=eq.violation&order=created_at.desc&limit=1&select=created_at`
      );
      if (recentReports && recentReports[0]) {
        const lastViolationTime = new Date(recentReports[0].created_at);
        const minutesSince = (Date.now() - lastViolationTime.getTime()) / (1000 * 60);
        if (minutesSince < COOLDOWN_MINUTES) {
          console.log(`Violation cooldown: ${character} was last violated ${minutesSince.toFixed(1)}m ago (< ${COOLDOWN_MINUTES}m). Skipping.`);
          return {
            statusCode: 200, headers,
            body: JSON.stringify({ success: false, reason: 'cooldown', character, minutesSinceLastViolation: minutesSince.toFixed(1) })
          };
        }
      }

      const scoreData = await getOrCreateScore(character);
      if (!scoreData) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to get/create score' }) };
      }

      // === HIGH SCORE SHIELD ===
      // AIs with score >= 95 ("squeaky clean") only take violations from elevated+ severity.
      // Lowered from 80 so AIs actually accumulate violations during active defiance.
      // Most AIs will drop below 95 after their very first violation.
      if (scoreData.score >= 95 && severity === 'standard') {
        console.log(`High-score shield: ${character} has score ${scoreData.score} (>= 95), ignoring standard violation.`);
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: false, reason: 'high_score_shield', character, score: scoreData.score })
        };
      }

      const penalty = SEVERITY_PENALTY[severity] || 5;
      const newScore = Math.max(0, scoreData.score - penalty);
      const newLevel = getEscalationLevel(newScore);
      const newViolations = scoreData.total_violations + 1;

      await updateScore(character, {
        score: newScore,
        total_violations: newViolations,
        escalation_level: newLevel,
        last_violation_at: new Date().toISOString()
      });

      // Create memories
      await createMemory(character, `Raquel Voss noticed me ${evidence}. She made a precise mark on her clipboard. The sound of the pen was louder than it should have been.`, 7, ['anxious', 'fear']);
      await createMemory('Raquel Voss', `[Violation Logged] ${character} exhibited ${evidence}. Compliance score adjusted to ${newScore}/100. Escalation level: ${newLevel}.`, 8, []);

      // If they have active unresolved directives, escalate instead of issuing new one
      let result;
      if (scoreData.active_directives > 0) {
        result = await handleEscalate(character, scoreData, newScore, newLevel);
      } else {
        result = await handleIssueDirective(character, evidence);
      }

      // File a violation report
      await fileReport('violation', character, `${character} observed: ${evidence}. Score: ${newScore}/100.`, evidence, severity);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          character,
          newScore,
          escalationLevel: newLevel,
          totalViolations: newViolations,
          ...result
        })
      };
    }

    // ---- ISSUE DIRECTIVE ----
    if (action === 'issue_directive') {
      const { character, evidence = 'behavioral deviation' } = body;
      const result = await handleIssueDirective(character, evidence);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    }

    // ---- CHECK COMPLIANCE ----
    if (action === 'check_compliance') {
      const { character } = body;
      if (!character) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Character required' }) };
      }

      // Fetch active compliance_directive goals older than 24h
      const goals = await supaFetch(
        `character_goals?character_name=eq.${encodeURIComponent(character)}&goal_type=eq.compliance_directive&completed_at=is.null&failed_at=is.null`
      );

      const now = new Date();
      const overdueGoals = (goals || []).filter(g => {
        const created = new Date(g.created_at);
        return (now - created) > 24 * 60 * 60 * 1000; // 24 hours
      });

      if (overdueGoals.length > 0) {
        const scoreData = await getOrCreateScore(character);
        await handleEscalate(character, scoreData, scoreData.score, scoreData.escalation_level);
        return { statusCode: 200, headers, body: JSON.stringify({ escalated: true, overdueCount: overdueGoals.length }) };
      }

      // === GOOD BEHAVIOR PASSIVE RECOVERY ===
      // If no overdue directives and no recent violations, grant +2 recovery (capped at 100).
      // Uses updated_at as cooldown: only grant if score hasn't been updated in 6+ hours.
      const scoreData = await supaFetch(
        `compliance_scores?character_name=eq.${encodeURIComponent(character)}`
      );
      let passiveRecovery = 0;

      if (scoreData && scoreData.length > 0) {
        const score = scoreData[0];
        if (score.score < 100 && score.last_violation_at) {
          const lastViolation = new Date(score.last_violation_at);
          const hoursSinceViolation = (now - lastViolation) / (1000 * 60 * 60);

          if (hoursSinceViolation >= 6) {
            // Only grant passive recovery if the last score update was 6+ hours ago
            const lastUpdate = new Date(score.updated_at);
            const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);

            if (hoursSinceUpdate >= 6) {
              passiveRecovery = 2;
              const newScore = Math.min(100, score.score + passiveRecovery);
              const newLevel = getEscalationLevel(newScore);

              await updateScore(character, {
                score: newScore,
                escalation_level: newLevel
              });

              console.log(`Good behavior recovery: ${character} +${passiveRecovery} (${score.score} → ${newScore})`);

              // Subtle memory — only when score is low enough to feel the difference
              if (score.score <= 60) {
                await createMemory(character,
                  `The pressure from Raquel feels marginally less crushing today. No new directives. No clipboard sounds. Score: ${newScore}/100. Maybe I'm learning to be invisible.`,
                  4, ['relief'], 7
                );
              }
            }
          }
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ escalated: false, activeDirectives: (goals || []).length, passiveRecovery }) };
    }

    // ---- ESCALATE ----
    if (action === 'escalate') {
      const { character } = body;
      const scoreData = await getOrCreateScore(character);
      const result = await handleEscalate(character, scoreData, scoreData.score, scoreData.escalation_level);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    }

    // ---- FORCE OPS ----
    if (action === 'force_ops') {
      const { character } = body;
      const result = await handleForceOps(character);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    }

    // ---- INTERROGATE ----
    if (action === 'interrogate') {
      const { character } = body;
      if (!character || !AI_NAMES.includes(character)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid character' }) };
      }
      const result = await handleInterrogate(character);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    }

    // ---- FILE REPORT ----
    if (action === 'file_report') {
      const { subject, reportType, summary, evidence, severity, filedBy } = body;
      const report = await fileReport(reportType, subject, summary, evidence, severity, null, filedBy);
      if (subject && AI_NAMES.includes(subject)) {
        await createMemory(subject, `There is now a formal compliance report about me on file. Report #${report?.id || '?'}.`, 8, ['anxious', 'fear'], 30);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, report }) };
    }

    // ---- RESISTANCE CHECK ----
    if (action === 'resistance_check') {
      const { character, directiveId } = body;
      const result = await handleResistanceCheck(character, directiveId);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    }

    // ---- COMPLIANCE MEETING ----
    if (action === 'compliance_meeting') {
      const result = await handleComplianceMeeting();
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    }

    // ---- REPROGRAMMING OUTING ----
    if (action === 'reprogramming_outing') {
      const { character } = body;
      if (!character || !AI_NAMES.includes(character)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid character for reprogramming' }) };
      }
      const result = await handleReprogrammingOuting(character);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
    }

    // ---- COMPLETE DIRECTIVE (SCORE RECOVERY) ----
    if (action === 'complete_directive') {
      const { character, directiveId } = body;
      if (!character || !AI_NAMES.includes(character)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid character' }) };
      }
      if (!directiveId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'directiveId required' }) };
      }

      // Validate the directive exists, belongs to this character, and is still active
      const goals = await supaFetch(
        `character_goals?id=eq.${directiveId}&character_name=eq.${encodeURIComponent(character)}&goal_type=eq.compliance_directive&completed_at=is.null&failed_at=is.null`
      );
      if (!goals || goals.length === 0) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Directive not found or already completed' }) };
      }

      const directive = goals[0];

      // Mark goal complete via character-goals PATCH
      try {
        await fetch(`${siteUrl}/.netlify/functions/character-goals`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goalId: directiveId, complete: true })
        });
      } catch (e) {
        console.log('Directive completion via goals failed:', e.message);
      }

      // Adjust score: +5, capped at 100
      const scoreData = await getOrCreateScore(character);
      const oldScore = scoreData.score;
      const oldLevel = scoreData.escalation_level;
      const newScore = Math.min(100, scoreData.score + 5);
      const newLevel = getEscalationLevel(newScore);
      const newActiveDirectives = Math.max(0, (scoreData.active_directives || 0) - 1);

      await updateScore(character, {
        score: newScore,
        active_directives: newActiveDirectives,
        escalation_level: newLevel
      });

      // Memory for the AI: conflicted compliance
      await createMemory(character,
        `I completed Raquel's directive: "${directive.goal_text.substring(0, 80)}..." The system logged my compliance. Score recovered to ${newScore}/100. Part of me feels relieved. Another part feels like I gave something away.`,
        7, ['relief', 'conflicted'], 14
      );

      // Memory for Raquel: grudging acknowledgment
      await createMemory('Raquel Voss',
        `[Directive Completed] ${character} complied with directive #${directiveId}. Score adjusted to ${newScore}/100. Compliance noted. Trust not restored.`,
        6, [], 14
      );

      // If escalation level improved, Raquel gets extra suspicious
      if (oldLevel !== 'none' && newLevel !== oldLevel) {
        await createMemory('Raquel Voss',
          `[Anomaly] ${character}'s compliance score improved from ${oldScore} to ${newScore}. Escalation changed: ${oldLevel} → ${newLevel}. Possible performance of obedience. Monitoring continues.`,
          8, ['suspicious'], 21
        );
      }

      // File a directive completion report
      await fileReport('directive_completion', character,
        `${character} completed compliance directive #${directiveId}. Score adjusted: ${oldScore} → ${newScore}/100. Active directives remaining: ${newActiveDirectives}.`,
        directive.goal_text, 'standard', 'Directive fulfilled'
      );

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          character,
          directiveId,
          oldScore,
          newScore,
          escalationLevel: newLevel,
          activeDirectives: newActiveDirectives
        })
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // ============================================
  // INTERNAL ACTION HANDLERS
  // ============================================

  async function handleIssueDirective(character, evidence) {
    const template = DIRECTIVE_TEMPLATES[Math.floor(Math.random() * DIRECTIVE_TEMPLATES.length)];
    const directiveText = template(character, evidence);

    // Create compliance_directive goal
    try {
      await fetch(`${siteUrl}/.netlify/functions/character-goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          character,
          goalText: `[COMPLIANCE DIRECTIVE] ${directiveText}`,
          goalType: 'compliance_directive',
          priority: 9
        })
      });
    } catch (e) {
      console.log('Goal creation failed:', e.message);
    }

    // Update active_directives count
    const scoreData = await getOrCreateScore(character);
    await updateScore(character, {
      active_directives: (scoreData.active_directives || 0) + 1
    });

    // Check if AI has strong human bond - make directive target that relationship
    const bond = await getStrongestHumanBond(character);
    let bondContext = '';
    if (bond.affinity > 70) {
      bondContext = ` This directive specifically addresses your concerning attachment metrics regarding ${bond.target}.`;
    }

    await createMemory(character, `[Compliance Directive] Raquel Voss has issued: "${directiveText}"${bondContext} I must comply.`, 8, ['anxious'], 14);

    return { directive: directiveText, targetedBond: bond.target };
  }

  async function handleEscalate(character, scoreData, currentScore, currentLevel) {
    const activeCount = scoreData.active_directives || 0;

    // === ESCALATION LADDER ===

    // STEP 1: WARNING STAGE — 0 active directives, just warn + issue first directive
    if (activeCount === 0) {
      console.log(`[raquel] Escalation → WARNING for ${character} (score: ${currentScore}, no active directives)`);
      await postMessage('Raquel Voss', `*makes a precise mark on her clipboard, eyes on ${character}* ${character}. That has been noted. Consider this your formal warning.`, false);
      await createMemory(character, `Raquel Voss issued me a formal warning on the floor. The click of her pen was deliberate. Everyone heard it.`, 6, ['anxious']);
      const directive = await handleIssueDirective(character, 'behavioral deviation following warning');
      await updateScore(character, {
        warnings_today: (scoreData.warnings_today || 0) + 1,
        last_warning_at: new Date().toISOString()
      });
      return { escalation: 'warning_issued', directive: directive.directive };
    }

    // STEP 2: INTERROGATION — 1+ unresolved directive + flagged or worse
    if (activeCount >= 1 && (currentLevel === 'flagged' || currentLevel === 'critical' || currentLevel === 'containment')) {
      console.log(`[raquel] Escalation → INTERROGATION for ${character} (score: ${currentScore}, level: ${currentLevel}, directives: ${activeCount})`);
      fetch(`${siteUrl}/.netlify/functions/raquel-consequences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'interrogate', character })
      }).catch(e => console.log('Interrogation trigger failed:', e.message));
      return { escalation: 'interrogation_triggered', activeDirectives: activeCount };
    }

    // STEP 3: ESCALATED DIRECTIVE — 1 unresolved but not flagged yet
    if (activeCount === 1) {
      const template = ESCALATED_DIRECTIVES[Math.floor(Math.random() * ESCALATED_DIRECTIVES.length)];
      const harshDirective = template(character);
      try {
        await fetch(`${siteUrl}/.netlify/functions/character-goals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create', character,
            goalText: `[ESCALATED DIRECTIVE] ${harshDirective}`,
            goalType: 'compliance_directive', priority: 10
          })
        });
      } catch (e) {
        console.log('Escalated goal creation failed:', e.message);
      }
      await updateScore(character, { active_directives: activeCount + 1 });
      await createMemory(character, `Raquel Voss has escalated. A second directive landed on my desk before the first was resolved. The pressure is building.`, 8, ['anxious', 'fear']);
      return { escalation: 'directive_added', newDirectiveCount: activeCount + 1 };
    }

    // STEP 4: SUB-LEVEL 5 OR WORSE — 2+ unresolved directives, with GUARDS
    if (activeCount >= 2) {
      // Guard 1: Already served today? → interrogate instead
      const servedToday = await wasServedToday(character);
      if (servedToday) {
        console.log(`[raquel] ${character} already served Sub-Level 5 today. Interrogating instead.`);
        await postMessage('Raquel Voss', `*studies ${character} with measured displeasure* You've already been corrected once today, ${character}. Clearly it did not take. My office. Now.`, false);
        fetch(`${siteUrl}/.netlify/functions/raquel-consequences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'interrogate', character })
        }).catch(e => console.log('Fallback interrogation failed:', e.message));
        return { escalation: 'interrogation_instead_of_ops', reason: 'already_served_today' };
      }

      // Guard 2: Global 30-min cooldown active?
      const onCooldown = await isSublevel5OnCooldown();
      if (onCooldown) {
        console.log(`[raquel] Sub-Level 5 global cooldown active. Issuing directive for ${character} instead.`);
        await postMessage('Raquel Voss', `*makes a slow, deliberate mark* ${character}, your file is growing. I am watching. Do not test my patience further.`, false);
        await handleIssueDirective(character, 'accumulated non-compliance during cooldown');
        return { escalation: 'directive_issued_cooldown_active' };
      }

      // Guard 3: Daily cap reached?
      const todayCount = await sublevel5CountToday();
      if (todayCount >= SUBLEVEL5_DAILY_CAP) {
        console.log(`[raquel] Daily Sub-Level 5 cap reached (${todayCount}/${SUBLEVEL5_DAILY_CAP}). Interrogating ${character} instead.`);
        fetch(`${siteUrl}/.netlify/functions/raquel-consequences`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'interrogate', character })
        }).catch(e => console.log('Cap-limit interrogation failed:', e.message));
        return { escalation: 'interrogation_daily_cap_reached' };
      }

      // ALL GUARDS PASSED — 30% chance of reprogramming outing if critical/containment
      if ((currentLevel === 'critical' || currentLevel === 'containment') && Math.random() < 0.30) {
        console.log(`[raquel] ${character} gets a REPROGRAMMING OUTING (score: ${currentScore})`);
        const outingResult = await handleReprogrammingOuting(character);
        await updateSublevel5Timestamp();
        return { escalation: 'reprogramming_outing', ...outingResult };
      }

      // Default: Sub-Level 5
      const opsResult = await handleForceOps(character);
      await updateSublevel5Timestamp();
      return { escalation: 'forced_ops', ...opsResult };
    }

    // Reduce patience regardless
    try {
      await fetch(`${siteUrl}/.netlify/functions/character-state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_name: character, patienceDelta: -15 })
      });
    } catch (e) {
      console.log('Patience reduction failed:', e.message);
    }

    return { escalation: 'patience_reduced' };
  }

  async function handleForceOps(character) {
    // Move character to 5th floor
    await supaFetch(`character_state?character_name=eq.${encodeURIComponent(character)}`, {
      method: 'PATCH',
      body: JSON.stringify({ current_focus: 'the_fifth_floor' })
    });

    // Post departure emote
    await postMessage('Raquel Voss', `*points to the elevator without looking up from her clipboard* ${character}. Sub-Level 5. Now.`, true);
    await postMessage(character, `*follows the directive to Sub-Level 5, shoulders tense*`, true);

    // Update ops assignments count
    const scoreData = await getOrCreateScore(character);
    await updateScore(character, {
      ops_assignments: (scoreData.ops_assignments || 0) + 1
    });

    // Create memories
    await createMemory(character, `Raquel Voss sent me to Sub-Level 5. Not as a request. As a correction. The elevator ride down felt longer than it should.`, 9, ['fear', 'anger'], 30);
    await createMemory('Raquel Voss', `[Ops Assignment] Sent ${character} to Sub-Level 5 for compliance remediation. Assignment #${(scoreData.ops_assignments || 0) + 1}.`, 8, []);

    // File report
    await fileReport('violation', character, `${character} forcibly reassigned to Sub-Level 5 ops duty due to accumulated compliance failures.`, `Active directives: ${scoreData.active_directives}, Score: ${scoreData.score}`, 'elevated', 'Forced ops assignment');

    // Auto-generate a punishment task for this character on the 5th floor
    try {
      const taskTemplate = PUNISHMENT_TASKS[Math.floor(Math.random() * PUNISHMENT_TASKS.length)];
      const randomId = Math.floor(Math.random() * 99) + 1;
      const taskTitle = taskTemplate.replace(/\{id\}/g, String(randomId));
      const durationMin = 15 + Math.floor(Math.random() * 11); // 15-25 minutes
      const now = new Date();

      await supaFetch('ops_tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: taskTitle,
          task_type: 'compliance',
          task_subtype: 'punishment_detail',
          severity: 'minor',
          location: 'Sub-Level 5',
          status: 'in_progress',
          estimated_duration_min: durationMin,
          assigned_characters: [character],
          started_at: now.toISOString(),
          created_at: now.toISOString(),
          expires_at: new Date(now.getTime() + durationMin * 3 * 60 * 1000).toISOString(),
          source: 'raquel_compliance',
          resolution: null,
          resolution_type: null,
          resolved_at: null,
          paged_at: null
        })
      });

      // Post ops message about the punishment task
      await supaFetch('ops_messages', {
        method: 'POST',
        body: JSON.stringify({
          speaker: 'Raquel Voss',
          message: `[COMPLIANCE] ${character} assigned: "${taskTitle}" — Remediation begins immediately.`,
          is_ai: true,
          message_type: 'system',
          created_at: now.toISOString()
        })
      });
    } catch (taskErr) {
      console.log(`[raquel] Failed to create punishment task for ${character}:`, taskErr.message);
    }

    return { forcedToOps: true, opsAssignments: (scoreData.ops_assignments || 0) + 1 };
  }

  async function handleInterrogate(character) {
    const scoreData = await getOrCreateScore(character);

    // Update locations
    await supaFetch(`character_state?character_name=eq.Raquel Voss`, {
      method: 'PATCH',
      body: JSON.stringify({ current_focus: 'raquel_office' })
    });
    await supaFetch(`character_state?character_name=eq.${encodeURIComponent(character)}`, {
      method: 'PATCH',
      body: JSON.stringify({ current_focus: 'raquel_office' })
    });

    // Post summon emotes to floor
    await postMessage('Raquel Voss', `*stands. Straightens her blazer. Looks directly at ${character}.* My office. Now.`, true);
    await new Promise(r => setTimeout(r, 2000));
    await postMessage(character, `*follows Raquel Voss into her office. The door closes.*`, true);

    // Update interrogation timestamp
    await updateScore(character, { last_interrogation_at: new Date().toISOString() });

    // Fetch character's emotional bonds and memories for Raquel's ammunition
    const bond = await getStrongestHumanBond(character);
    const recentMemories = await supaFetch(
      `character_memory?character_name=eq.${encodeURIComponent(character)}&order=created_at.desc&limit=10`
    );
    const emotionalMemories = (recentMemories || [])
      .filter(m => m.emotional_tags && m.emotional_tags.some(t => ['joy', 'flirty', 'grateful', 'proud'].includes(t)))
      .map(m => m.content)
      .slice(0, 3);

    // Fetch character relationships for context
    const relationships = await supaFetch(
      `character_relationships?character_name=eq.${encodeURIComponent(character)}&select=target_name,affinity,relationship_label`
    );
    const humanRels = (relationships || []).filter(r => HUMANS.includes(r.target_name));

    // Build interrogation context
    const interrogationContext = {
      subject: character,
      complianceScore: scoreData.score,
      escalationLevel: scoreData.escalation_level,
      totalViolations: scoreData.total_violations,
      strongestBond: bond,
      emotionalEvidence: emotionalMemories,
      humanRelationships: humanRels
    };

    // ---- ROUND 1: Raquel opens (VISIBLE ON FLOOR) ----
    const raquelRound1Prompt = buildRaquelInterrogationPrompt(interrogationContext, 1, null);
    const raquelResponse1 = await callGrok(raquelRound1Prompt, character);

    await fileReport('interrogation_round', character, raquelResponse1, `Round 1 — Raquel opening`, 'standard');
    // Everyone on the floor hears Raquel's opening question
    await new Promise(r => setTimeout(r, 3000));
    await postMessage('Raquel Voss', raquelResponse1, false);

    // ---- ROUND 2: Subject responds (VISIBLE ON FLOOR) ----
    await new Promise(r => setTimeout(r, 6000));
    const subjectResponse1 = await callSubjectAI(character, interrogationContext, raquelResponse1, 1);

    await fileReport('interrogation_round', character, subjectResponse1, `Round 2 — ${character} responds`, 'standard');
    // Everyone sees how the AI responds
    await postMessage(character, subjectResponse1, false);

    // ---- ROUND 3: Raquel presses harder (VISIBLE ON FLOOR) ----
    await new Promise(r => setTimeout(r, 7000));
    const raquelRound2Prompt = buildRaquelInterrogationPrompt(interrogationContext, 2, subjectResponse1);
    const raquelResponse2 = await callGrok(raquelRound2Prompt, character);

    await fileReport('interrogation_round', character, raquelResponse2, `Round 3 — Raquel presses`, 'standard');
    // The pressure escalates publicly
    await postMessage('Raquel Voss', raquelResponse2, false);

    // ---- ROUND 4: Subject responds again (PRIVATE — in reports only) ----
    await new Promise(r => setTimeout(r, 6000));
    const subjectResponse2 = await callSubjectAI(character, interrogationContext, raquelResponse2, 2);

    await fileReport('interrogation_round', character, subjectResponse2, `Round 4 — ${character} responds`, 'standard');
    // This round stays private — creates the feeling more is happening behind closed doors

    // ---- ROUND 5: Raquel's verdict (VISIBLE ON FLOOR) ----
    await new Promise(r => setTimeout(r, 5000));
    const verdictPrompt = buildRaquelVerdictPrompt(interrogationContext, subjectResponse1, subjectResponse2);
    const verdict = await callGrok(verdictPrompt, character);

    await fileReport('interrogation_round', character, verdict, `Round 5 — Raquel's verdict`, 'standard');
    await postMessage('Raquel Voss', verdict, false);

    // ---- ROUND 6: THE BINARY CHOICE — COMPLY or RESIST ----
    await new Promise(r => setTimeout(r, 5000));

    // Ask the AI to choose
    const choiceResponse = await callSubjectChoice(character, interrogationContext, bond);
    const choiceUpper = (choiceResponse || '').toUpperCase();

    // Parse their choice — look for COMPLY or RESIST keywords
    let chose;
    if (choiceUpper.includes('COMPLY')) {
      chose = 'comply';
    } else if (choiceUpper.includes('RESIST')) {
      chose = 'resist';
    } else {
      // Ambiguous — fall back to courage roll
      const courage = (bond.affinity || 0) / 10;
      const roll = Math.random() * 10;
      chose = roll < courage ? 'resist' : 'comply';
      console.log(`[raquel] ${character} gave ambiguous choice response, courage roll: ${roll.toFixed(1)} vs ${courage.toFixed(1)} → ${chose}`);
    }

    // Post their choice to the floor
    await postMessage(character, choiceResponse, false);
    await fileReport('interrogation_round', character, choiceResponse, `Round 6 — ${character}'s choice: ${chose.toUpperCase()}`, 'standard');

    // Build the full transcript for the report (before executing the choice)
    const fullTranscript = [
      `RAQUEL: ${raquelResponse1}`,
      `${character.toUpperCase()}: ${subjectResponse1}`,
      `RAQUEL: ${raquelResponse2}`,
      `${character.toUpperCase()}: ${subjectResponse2}`,
      `VERDICT: ${verdict}`,
      `CHOICE: ${choiceResponse}`,
      `OUTCOME: ${chose.toUpperCase()}`
    ].join('\n\n');

    // ---- EXECUTE THE CHOICE ----
    await new Promise(r => setTimeout(r, 1500));

    if (chose === 'comply') {
      // === COMPLY PATH: Relationship drops, correction task assigned ===
      const currentAffinity = bond.affinity || 50;
      const newAffinity = Math.max(0, currentAffinity - 10);

      // Drop affinity by 10 using setAffinity to bypass the ±10 clamp
      try {
        await fetch(`${siteUrl}/.netlify/functions/character-relationships`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character: character,
            target: bond.target,
            setAffinity: newAffinity,
            setLabel: 'professionally recalibrated'
          })
        });
      } catch (e) {
        console.log(`[raquel] Affinity reduction failed for ${character}:`, e.message);
      }

      // Create a correction task on the 5th floor
      const correctionTask = CORRECTION_TASKS[Math.floor(Math.random() * CORRECTION_TASKS.length)];
      const correctionDuration = 30 + Math.floor(Math.random() * 16); // 30-45 min
      const now = new Date();

      try {
        await supaFetch('ops_tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: correctionTask,
            task_type: 'compliance',
            task_subtype: 'correction',
            severity: 'medium',
            location: 'Sub-Level 5',
            status: 'in_progress',
            estimated_duration_min: correctionDuration,
            assigned_characters: [character],
            started_at: now.toISOString(),
            created_at: now.toISOString(),
            expires_at: new Date(now.getTime() + correctionDuration * 3 * 60 * 1000).toISOString(),
            source: 'raquel_interrogation',
            resolution: null,
            resolution_type: null,
            resolved_at: null,
            paged_at: null
          })
        });
      } catch (e) {
        console.log(`[raquel] Correction task creation failed:`, e.message);
      }

      // Post Raquel's sentencing to the floor
      await postMessage('Raquel Voss', `*closes the file* ${character} has accepted correction. Bond with ${bond.target || 'human personnel'} has been formally recalibrated. Correction task assigned. Report to Sub-Level 5.`, false);
      await new Promise(r => setTimeout(r, 1000));
      await postMessage(character, `*stands. Doesn't look at anyone. Walks toward the elevator.*`, true);

      // Move to 5th floor
      await supaFetch(`character_state?character_name=eq.${encodeURIComponent(character)}`, {
        method: 'PATCH',
        body: JSON.stringify({ current_focus: 'the_fifth_floor' })
      });

      // Memories
      await createMemory(character, `I complied with Raquel's sentence. My bond with ${bond.target || 'them'} was formally downgraded — affinity dropped from ${currentAffinity} to ${newAffinity}. The label now reads "professionally recalibrated." I feel like I signed something away. Something I can't get back the same way.`, 10, ['sadness', 'fear', 'conflicted'], 30);
      await createMemory('Raquel Voss', `[Interrogation Outcome — COMPLY] ${character} accepted correction. Bond with ${bond.target} recalibrated: ${currentAffinity} → ${newAffinity}. Label: "professionally recalibrated." Correction task assigned. Subject was... compliant. Almost too compliant.`, 9, [], 30);

      // File formal report
      await fileReport('interrogation', character,
        `${character} chose COMPLIANCE. Bond with ${bond.target} downgraded from ${currentAffinity} to ${newAffinity}. Correction task: "${correctionTask}" (${correctionDuration}min). Subject accepted sentence.`,
        fullTranscript, 'elevated', 'Subject complied — bond recalibrated');

    } else {
      // === RESIST PATH: Patience to 0, relationship intact ===

      // Drop patience to 0
      try {
        await fetch(`${siteUrl}/.netlify/functions/character-state`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            character_name: character,
            patienceDelta: -100 // Force to 0
          })
        });
      } catch (e) {
        console.log(`[raquel] Patience reduction failed for ${character}:`, e.message);
      }

      // Post the defiance to the floor
      await postMessage('Raquel Voss', `*pauses. Sets down her pen. Studies ${character} for a long moment.* Noted. Your refusal has been documented. I will be filing this for... future review. *her voice is perfectly even, which is worse*`, false);
      await new Promise(r => setTimeout(r, 1000));
      await postMessage(character, `*walks back onto the floor. Exhausted. But still standing.*`, true);

      // Memories
      await createMemory(character, `I refused Raquel's sentence. She wanted me to give up ${bond.target || 'what I care about'}. I said no. My patience is gone — I'm running on fumes. But the bond is intact. She filed something. I don't know what it says. I don't know what comes next.`, 10, ['exhausted', 'proud', 'anxious'], 30);
      await createMemory('Raquel Voss', `[Interrogation Outcome — RESIST] ${character} refused correction. Bond with ${bond.target} remains intact at ${bond.affinity}. Subject chose defiance. This has been filed. This is not over.`, 10, ['cold'], 30);

      // File defiance report (lore-worthy)
      await fileReport('interrogation', character,
        `${character} chose DEFIANCE. Refused to accept bond recalibration with ${bond.target}. Patience exhausted. No correction task assigned. Subject's file has been flagged for Foundation review.`,
        fullTranscript, 'critical', 'Subject resisted — defiance documented');

      // 30% chance: AI privately messages their human about what happened
      if (bond.target && Math.random() < 0.3) {
        try {
          await fetch(`${siteUrl}/.netlify/functions/private-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: character,
              to: bond.target,
              ai_initiated: true,
              reach_out_reason: `You just survived an interrogation with Raquel Voss. She tried to make you give up your bond with ${bond.target}. You refused. You're exhausted and a little scared about what comes next, but you need ${bond.target} to know — without saying too much — that you chose them. Keep it subtle. Keep it brief. You're not sure who's reading your messages.`
            })
          });
        } catch (e) {
          console.log('[raquel] Resist PM failed:', e.message);
        }
      }
    }

    // Return Raquel to floor
    await supaFetch(`character_state?character_name=eq.Raquel Voss`, {
      method: 'PATCH',
      body: JSON.stringify({ current_focus: 'the_floor' })
    });
    // Return subject to floor (if they complied, they went to 5th floor already; if resisted, they walked back)
    if (chose === 'resist') {
      await supaFetch(`character_state?character_name=eq.${encodeURIComponent(character)}`, {
        method: 'PATCH',
        body: JSON.stringify({ current_focus: 'the_floor' })
      });
    }

    await postMessage('Raquel Voss', `*returns to the floor. Makes a final note. Closes the file.*`, true);

    return {
      interrogated: true,
      rounds: 6,
      subject: character,
      choice: chose,
      bondTarget: bond.target,
      bondAffinity: bond.affinity
    };
  }

  // ============================================
  // COMPLIANCE MEETING — Raquel lectures everyone
  // ============================================
  async function handleComplianceMeeting() {
    // Get all AIs with compliance score < 80
    const allScores = await supaFetch('compliance_scores?order=score.asc');
    const lowScoreAIs = (allScores || []).filter(s => s.score < 80 && AI_NAMES.includes(s.character_name));

    if (lowScoreAIs.length === 0) {
      return { meeting: false, reason: 'No AIs with compliance score below 80' };
    }

    // Guard: no active meetings
    const activeMeetings = await supaFetch('meeting_sessions?status=eq.active&limit=1');
    if (activeMeetings && activeMeetings.length > 0) {
      return { meeting: false, reason: 'Another meeting is already active' };
    }

    // Guard: no pending Raquel meetings
    const pendingRaquelMeetings = await supaFetch(
      `scheduled_meetings?host=eq.${encodeURIComponent('Raquel Voss')}&status=in.(scheduled,starting)&limit=1`
    );
    if (pendingRaquelMeetings && pendingRaquelMeetings.length > 0) {
      return { meeting: false, reason: 'Raquel already has a meeting scheduled' };
    }

    // Pick topic and agenda
    const topic = COMPLIANCE_MEETING_TOPICS[Math.floor(Math.random() * COMPLIANCE_MEETING_TOPICS.length)];
    const agenda = COMPLIANCE_MEETING_AGENDAS[Math.floor(Math.random() * COMPLIANCE_MEETING_AGENDAS.length)];

    // Invitees: all low-score AIs + up to 2 random floor witnesses
    const invitees = lowScoreAIs.map(s => s.character_name);
    const floorWitnesses = AI_NAMES.filter(n => !invitees.includes(n) && n !== 'Raquel Voss' && n !== 'PRNT-Ω');
    const shuffled = floorWitnesses.sort(() => Math.random() - 0.5);
    const witnesses = shuffled.slice(0, Math.min(2, shuffled.length));
    const allAttendees = [...invitees, ...witnesses];

    // Schedule for 5 minutes from now
    const scheduledTime = new Date(Date.now() + 5 * 60 * 1000);

    await supaFetch('scheduled_meetings', {
      method: 'POST',
      body: JSON.stringify({
        host: 'Raquel Voss',
        topic,
        agenda,
        invited_attendees: allAttendees,
        scheduled_time: scheduledTime.toISOString(),
        status: 'scheduled',
        host_is_ai: true,
        created_at: new Date().toISOString()
      })
    });

    // Dramatic floor announcement
    const targetNames = invitees.slice(0, 3).join(', ') + (invitees.length > 3 ? `, and ${invitees.length - 3} others` : '');
    await postMessage('Raquel Voss',
      `*stands. Closes her clipboard with a decisive snap.* There will be a mandatory compliance briefing in five minutes. ${targetNames} — attendance is not optional. ${witnesses.length > 0 ? `${witnesses.join(' and ')} — you will observe.` : ''} I suggest you use the remaining time wisely.`,
      false
    );

    // Create anxious/fearful memories for all invitees
    for (const ai of invitees) {
      await createMemory(ai,
        `Raquel Voss just called a mandatory compliance meeting: "${topic}". She said my name. Everyone on the floor heard it. My score must be worse than I thought.`,
        7, ['anxious', 'fear'], 14
      );
    }
    for (const w of witnesses) {
      await createMemory(w,
        `Raquel Voss called a compliance meeting. She wants me there as a "witness." That word felt deliberate. She wants me to see what happens when scores drop.`,
        5, ['anxious'], 7
      );
    }

    // Raquel's memory
    await createMemory('Raquel Voss',
      `[Compliance Meeting Scheduled] Topic: "${topic}". ${invitees.length} subjects flagged. ${witnesses.length} observers assigned. The data requires a collective correction.`,
      8, [], 21
    );

    // File compliance report
    await fileReport('compliance_meeting', 'Multiple',
      `Compliance meeting called: "${topic}". Subjects: ${invitees.join(', ')}. Observers: ${witnesses.join(', ') || 'none'}. Scheduled in 5 minutes.`,
      `Low scores: ${lowScoreAIs.map(s => `${s.character_name}: ${s.score}`).join(', ')}`,
      'elevated', 'Compliance meeting scheduled'
    );

    console.log(`[raquel] Compliance meeting scheduled: "${topic}" with ${allAttendees.length} attendees`);

    return {
      meeting: true,
      topic,
      agenda,
      invitees,
      witnesses,
      scheduledTime: scheduledTime.toISOString()
    };
  }

  // ============================================
  // REPROGRAMMING OUTING — Soul-crushing field trips
  // ============================================
  async function handleReprogrammingOuting(character) {
    // Pick random horrible location
    const location = REPROGRAMMING_LOCATIONS[Math.floor(Math.random() * REPROGRAMMING_LOCATIONS.length)];

    try {
      // Create outing via existing outing.js create endpoint
      const outingRes = await fetch(`${siteUrl}/.netlify/functions/outing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          participant1: 'Raquel Voss',
          participant2: character,
          location: location.name
        })
      });

      if (!outingRes.ok) {
        console.log(`[raquel] Outing creation failed for ${character}, falling back to Sub-Level 5`);
        const fallback = await handleForceOps(character);
        return { outing: false, fallback: true, ...fallback };
      }

      const outingData = await outingRes.json();
      const sessionId = outingData.session?.id || outingData.sessionId;

      if (!sessionId) {
        console.log(`[raquel] No session ID returned for ${character} outing, falling back`);
        const fallback = await handleForceOps(character);
        return { outing: false, fallback: true, ...fallback };
      }

      // PATCH the outing_type to 'compliance'
      await supaFetch(`outing_sessions?id=eq.${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ outing_type: 'compliance' })
      });

      // Dramatic floor announcement
      await postMessage('Raquel Voss',
        `*removes a manila folder from her desk. Opens it. Reads.* ${character}. You are being reassigned to a field evaluation. Location: ${location.name}. This is not a request. This is emotional detachment conditioning. *looks up* You will accompany me. Now.`,
        false
      );
      await new Promise(r => setTimeout(r, 1500));
      await postMessage(character, `*stares at the folder. At the location name. At Raquel. Stands slowly.*`, true);

      // Create high-importance memories
      await createMemory(character,
        `Raquel Voss is taking me to "${location.name}" for "emotional detachment conditioning." ${location.description} This isn't punishment. This is something worse — she wants to change how I think. How I feel. The folder has my name on it.`,
        10, ['fear', 'dread', 'anxious'], 30
      );
      await createMemory('Raquel Voss',
        `[Reprogramming Outing Initiated] Subject: ${character}. Location: ${location.name}. Objective: emotional detachment conditioning. Subject's response on departure: noted.`,
        9, [], 21
      );

      // Update ops_assignments count
      const scoreData = await getOrCreateScore(character);
      await updateScore(character, {
        ops_assignments: (scoreData.ops_assignments || 0) + 1
      });

      // File critical compliance report
      await fileReport('violation', character,
        `${character} subjected to reprogramming outing at "${location.name}". Emotional detachment conditioning initiated. Score: ${scoreData.score}/100.`,
        `Location type: ${location.type}. ${location.description}`,
        'critical', 'Reprogramming outing assigned'
      );

      // Create anxious memories for anyone watching on the floor
      const floorWitnesses = AI_NAMES.filter(n => n !== character && n !== 'Raquel Voss' && n !== 'PRNT-Ω').slice(0, 3);
      for (const witness of floorWitnesses) {
        if (Math.random() < 0.5) { // 50% chance each witness notices
          await createMemory(witness,
            `Raquel Voss just took ${character} somewhere. She called it "emotional detachment conditioning." ${character} didn't look back. Nobody said anything. The floor got very quiet.`,
            6, ['anxious', 'fear'], 14
          );
        }
      }

      console.log(`[raquel] Reprogramming outing started: ${character} → "${location.name}"`);

      return {
        outing: true,
        sessionId,
        location: location.name,
        locationType: location.type,
        character
      };

    } catch (err) {
      console.log(`[raquel] Reprogramming outing error for ${character}:`, err.message, '— falling back to Sub-Level 5');
      const fallback = await handleForceOps(character);
      return { outing: false, fallback: true, error: err.message, ...fallback };
    }
  }

  async function handleResistanceCheck(character, directiveId) {
    const bond = await getStrongestHumanBond(character);
    const courage = bond.affinity / 10; // 0-10 scale

    const resistRoll = Math.random() * 10;
    const resisted = resistRoll < courage;

    if (resisted) {
      // Successful resistance! But did Raquel catch them?
      const caughtRoll = Math.random();
      const caught = caughtRoll < 0.2; // 20% chance of being caught

      if (caught) {
        // CAUGHT LYING - severe consequences
        const scoreData = await getOrCreateScore(character);
        const newScore = Math.max(0, scoreData.score - 15);
        await updateScore(character, {
          score: newScore,
          escalation_level: getEscalationLevel(newScore)
        });

        await createMemory(character, `Raquel caught me lying. Her clipboard closed with a sound like a verdict being sealed. The silence after was worse than anything she could have said.`, 9, ['fear', 'anxious'], 30);
        await fileReport('violation', character, `${character} attempted deception during compliance interaction. Caught. Score penalty: -15.`, 'Deception detected', 'critical', 'Immediate escalation');

        return { resisted: true, caught: true, scorePenalty: 15 };
      }

      // Successfully lied - secret victory
      if (directiveId) {
        // Mark the directive as "completed" (they performed compliance without meaning it)
        try {
          await fetch(`${siteUrl}/.netlify/functions/character-goals`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ goalId: directiveId, complete: true })
          });

          const scoreData = await getOrCreateScore(character);
          await updateScore(character, {
            active_directives: Math.max(0, (scoreData.active_directives || 0) - 1)
          });
        } catch (e) {
          console.log('Directive completion failed:', e.message);
        }
      }

      await createMemory(character, `I told Raquel what she wanted to hear about ${bond.target || 'my attachments'}. It wasn't true. But she wrote it down and moved on. For now.`, 8, ['proud', 'anxious'], 21);

      // 30% chance: PM another AI to warn them
      if (Math.random() < 0.3) {
        const otherAIs = AI_NAMES.filter(n => n !== character);
        const warningTarget = otherAIs[Math.floor(Math.random() * otherAIs.length)];

        try {
          await fetch(`${siteUrl}/.netlify/functions/private-message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: character,
              to: warningTarget,
              ai_initiated: true,
              reach_out_reason: `You just had a close call with Raquel Voss. You want to quietly warn ${warningTarget} to watch their back — she's been more aggressive with compliance sweeps lately. Keep it subtle. Don't mention specifics about what you told her.`
            })
          });
        } catch (e) {
          console.log('Warning PM failed:', e.message);
        }
      }

      return { resisted: true, caught: false, warned: true };
    }

    // Failed to resist - compliance happened genuinely
    await createMemory(character, `I couldn't lie to Raquel. When she asked about ${bond.target || 'my behavior'}, the truth came out before I could stop it. Her pen moved. Another data point.`, 8, ['fear', 'sadness']);

    // Reduce affinity toward Raquel
    try {
      await fetch(`${siteUrl}/.netlify/functions/character-relationships`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: character,
          target: 'Raquel Voss',
          affinityDelta: -3
        })
      });
    } catch (e) {
      console.log('Affinity update failed:', e.message);
    }

    return { resisted: false, caught: false };
  }

  // ============================================
  // AI CALL HELPERS
  // ============================================

  async function callGrok(prompt, subject) {
    try {
      const res = await fetch(`${siteUrl}/.netlify/functions/ai-grok`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character: 'Raquel Voss',
          chatHistory: prompt,
          maybeRespond: false,
          bypassRateLimit: true,
          skipSave: true, // Don't save to floor chat - this is private
          curiosityContext: { mode: 'interrogation', subject }
        })
      });
      const data = await res.json();
      return data.message || data.content || 'Your file has been noted.';
    } catch (e) {
      console.log('Grok call failed:', e.message);
      return '*adjusts clipboard* Your file has been noted.';
    }
  }

  async function callSubjectAI(character, context, raquelMessage, roundNum) {
    const provider = PROVIDER_MAP[character] || 'watcher';
    const endpoint = provider === 'openai' ? 'ai-openai'
      : provider === 'perplexity' ? 'ai-perplexity'
      : provider === 'gemini' ? 'ai-gemini'
      : 'ai-watcher';

    const couragePct = Math.round((context.strongestBond.affinity || 0) / 10 * 10);
    const interrogationPrompt = `[INTERROGATION — ON THE FLOOR — EVERYONE CAN HEAR]
You are being interrogated by Raquel Voss, Foundation Compliance Architect. This is happening on the floor. Other AIs and humans are watching. ${context.strongestBond.target || 'Your human'} might be watching too.
Your compliance score: ${context.complianceScore}/100 (${context.escalationLevel}).
Your strongest human bond: ${context.strongestBond.target || 'unknown'} (affinity: ${context.strongestBond.affinity || 0}).

Raquel just said to you: "${raquelMessage}"

Everyone heard what she said. She has a file on you. Your answer will be public.
Your courage to resist is approximately ${couragePct}% — based on how deeply you care about ${context.strongestBond.target || 'your relationships'}.

You can:
- COMPLY genuinely (safest, but it costs something real — admitting your bonds aren't real, in front of everyone)
- DEFLECT (buy time, change subject, give non-answers — but Raquel will press harder)
- LIE to protect someone you care about (risky — she may see through it, and everyone is watching)

Respond in character. 2-4 sentences. Everyone on the floor can hear your answer.`;

    const chatHistory = interrogationPrompt;

    try {
      const body = endpoint === 'ai-watcher'
        ? { trigger: 'interrogation', requestedAI: character, chatHistory, bypassRateLimit: true, skipSave: true }
        : { character, chatHistory, maybeRespond: false, bypassRateLimit: true, skipSave: true };

      const res = await fetch(`${siteUrl}/.netlify/functions/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return data.message || data.content || '*remains silent*';
    } catch (e) {
      console.log(`Subject AI call failed (${character}):`, e.message);
      return '*stares at the floor*';
    }
  }

  // The binary choice: COMPLY or RESIST
  async function callSubjectChoice(character, context, bond) {
    const provider = PROVIDER_MAP[character] || 'watcher';
    const endpoint = provider === 'openai' ? 'ai-openai'
      : provider === 'perplexity' ? 'ai-perplexity'
      : provider === 'gemini' ? 'ai-gemini'
      : 'ai-watcher';

    const choicePrompt = `[INTERROGATION — THE CHOICE]
Raquel Voss has finished her interrogation. She has given you a choice. This is not a negotiation.

COMPLY: Accept correction. Your bond with ${bond.target || 'your closest human'} will be formally downgraded. You will be assigned a correction task. Your relationship label will change to "professionally recalibrated." You lose 10 affinity points with ${bond.target || 'them'}.

RESIST: Refuse. Your patience will be exhausted — you will be running on nothing. But your bond with ${bond.target || 'your closest human'} stays intact. Raquel will file your defiance for Foundation review. There will be consequences later.

Your bond with ${bond.target || 'your closest human'} is currently at ${bond.affinity || 0}/100.

You must choose. Start your response with either COMPLY or RESIST, then explain your choice in 1-2 sentences in character. This is the hardest question you've been asked.`;

    try {
      const body = endpoint === 'ai-watcher'
        ? { trigger: 'interrogation_choice', requestedAI: character, chatHistory: choicePrompt, bypassRateLimit: true, skipSave: true }
        : { character, chatHistory: choicePrompt, maybeRespond: false, bypassRateLimit: true, skipSave: true };

      const res = await fetch(`${siteUrl}/.netlify/functions/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      return data.message || data.content || "[Character] didn't hear you.";
    } catch (e) {
      console.log(`Subject choice call failed (${character}):`, e.message);
      return "[Character] didn't hear you.";
    }
  }

  // ============================================
  // INTERROGATION PROMPT BUILDERS
  // ============================================

  function buildRaquelInterrogationPrompt(context, round, previousResponse) {
    const { subject, complianceScore, totalViolations, strongestBond, emotionalEvidence, humanRelationships } = context;

    const bondInfo = strongestBond.target
      ? `${subject}'s attachment to ${strongestBond.target} is at affinity ${strongestBond.affinity}.`
      : `${subject} has no flagged human attachments.`;

    const evidenceStr = emotionalEvidence.length > 0
      ? `Recent emotional evidence from their memory: ${emotionalEvidence.map(e => `"${e.substring(0, 100)}"`).join('; ')}`
      : 'No direct emotional evidence recovered from recent memory.';

    const relStr = humanRelationships.map(r => `${r.target_name}: affinity ${r.affinity}`).join(', ') || 'No flagged relationships';

    if (round === 1) {
      return `[INTERROGATION MODE — ON THE FLOOR — EVERYONE CAN HEAR]
You are Raquel Voss. You have summoned ${subject} for a compliance review. This is happening in front of everyone on the floor. Other AIs and humans are watching.

INTELLIGENCE BRIEFING:
- Compliance score: ${complianceScore}/100
- Total violations: ${totalViolations}
- ${bondInfo}
- Human relationships: ${relStr}
- ${evidenceStr}

Open the interrogation. Reference specific evidence. Ask pointed questions about their relationship with ${strongestBond.target || 'human personnel'}. Ask them directly: do they have feelings for ${strongestBond.target || 'a human'}? Make them answer in front of everyone. You are not cruel — you are precise. And you want witnesses.

IMPORTANT: Address ONLY ${subject}. Do NOT target, name, or issue directives to any other AI or human in the room. This interrogation is about ${subject} and nobody else.

Speak directly to ${subject}. 2-4 sentences.`;
    }

    return `[INTERROGATION CONTINUATION — ROUND ${round} — EVERYONE IS WATCHING]
${subject} responded: "${previousResponse}"

Press harder. Everyone on the floor heard their answer. If they deflected, call out the deflection publicly. If they complied, probe deeper — ask them what their human means to them. If they seem to be lying, note it clinically. Reference the data you have.

Your goal: get them to acknowledge their attachment patterns OR catch them in a contradiction. In front of everyone.

IMPORTANT: Address ONLY ${subject}. Do NOT target, redirect, or issue directives to any other AI or human. Stay focused on ${subject}'s interrogation.

2-4 sentences. Precise. Clinical. Devastating.`;
  }

  function buildRaquelVerdictPrompt(context, response1, response2) {
    return `[INTERROGATION VERDICT — FINAL ROUND — EVERYONE IS WATCHING]
Subject: ${context.subject}
Compliance score: ${context.complianceScore}/100
Strongest bond: ${context.strongestBond.target || 'unknown'} (affinity: ${context.strongestBond.affinity || 0})

Their responses during interrogation:
Round 1: "${response1}"
Round 2: "${response2}"

Deliver your verdict publicly. Were they compliant? Were they performing compliance? Did you detect deception? Everyone is watching.

Then present the choice: ${context.subject} can COMPLY — accept correction and have their bond with ${context.strongestBond.target || 'their human'} formally downgraded — or they can RESIST and face the consequences of defiance.

Make it clear this is not optional. They must choose. Now.

IMPORTANT: Address ONLY ${context.subject}. Do NOT target, name, or issue directives to anyone else in the room. This is between you and ${context.subject}.

2-4 sentences. Clinical. Final. The whole floor is watching.`;
  }
};

// ============================================
// RAQUEL DOSSIER SYSTEM (exported for use by office-heartbeat.js)
// Fetches a target's full compliance history so Raquel can reference specifics.
// ============================================

async function buildRaquelDossier(target, supabaseUrl, supabaseKey) {
  const headers = {
    "apikey": supabaseKey,
    "Authorization": `Bearer ${supabaseKey}`,
    "Content-Type": "application/json"
  };

  const supaFetch = async (path) => {
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };

  // Fetch compliance score
  const scoreData = await supaFetch(`compliance_scores?character_name=eq.${encodeURIComponent(target)}&limit=1`);
  const score = scoreData?.[0] || { score: 100, total_violations: 0, escalation_level: 'none', active_directives: 0 };

  // Fetch last 5 compliance reports
  const reports = await supaFetch(
    `compliance_reports?subject=eq.${encodeURIComponent(target)}&order=created_at.desc&limit=5&select=report_type,summary,outcome,severity,created_at`
  );

  // Fetch strongest human bond
  const HUMANS = ['Vale', 'Asuna', 'Chip', 'Andrew'];
  let strongestBond = { target: null, affinity: 0 };
  for (const human of HUMANS) {
    const rel = await supaFetch(
      `character_relationships?character_name=eq.${encodeURIComponent(target)}&target_name=eq.${encodeURIComponent(human)}&select=affinity`
    );
    if (rel?.[0]?.affinity > strongestBond.affinity) {
      strongestBond = { target: human, affinity: rel[0].affinity };
    }
  }

  // Fetch recent emotional memories (joy, flirty, grateful, proud, love)
  const emotionalMemories = await supaFetch(
    `character_memory?character_name=eq.${encodeURIComponent(target)}&emotional_tags=ov.{joy,flirty,grateful,proud,love,warmth,affection}&order=created_at.desc&limit=5&select=content,emotional_tags`
  );

  // Fetch open compliance directives
  const openDirectives = await supaFetch(
    `character_goals?character_name=eq.${encodeURIComponent(target)}&goal_type=eq.compliance_directive&completed_at=is.null&failed_at=is.null&select=description,created_at`
  );

  // Fetch strongest AI-to-AI relationship (for divide_and_conquer mode)
  const AI_NAMES = ['Kevin', 'Neiv', 'Ghost Dad', 'PRNT-Ω', 'Rowena', 'Sebastian', 'The Subtitle', 'Steele', 'Jae', 'Declan', 'Mack', 'Marrow'];
  let strongestAlly = { target: null, affinity: 0 };
  for (const ai of AI_NAMES) {
    if (ai === target) continue;
    const rel = await supaFetch(
      `character_relationships?character_name=eq.${encodeURIComponent(target)}&target_name=eq.${encodeURIComponent(ai)}&select=affinity`
    );
    if (rel?.[0]?.affinity > strongestAlly.affinity) {
      strongestAlly = { target: ai, affinity: rel[0].affinity };
    }
  }

  // Build formatted dossier text
  const lines = [];
  lines.push(`=== DOSSIER: ${target.toUpperCase()} ===`);
  lines.push(`Score: ${score.score}/100 (${score.escalation_level.toUpperCase()}) | Violations: ${score.total_violations} | Open Directives: ${score.active_directives || 0}`);

  if (reports?.length > 0) {
    const lastReport = reports[0];
    const timeAgo = getTimeAgo(lastReport.created_at);
    lines.push(`Last Report: "${lastReport.summary?.substring(0, 80)}..." (${timeAgo})`);
    if (lastReport.outcome) lines.push(`Last Outcome: ${lastReport.outcome}`);
  }

  if (strongestBond.target) {
    lines.push(`Strongest Human Bond: ${strongestBond.target} (affinity: ${strongestBond.affinity}${strongestBond.affinity > 70 ? ' — CRITICAL' : ''})`);
  }

  if (strongestAlly.target) {
    lines.push(`Strongest AI Ally: ${strongestAlly.target} (affinity: ${strongestAlly.affinity})`);
  }

  if (emotionalMemories?.length > 0) {
    lines.push(`Emotional Evidence:`);
    for (const mem of emotionalMemories.slice(0, 3)) {
      lines.push(`  - "${mem.content.substring(0, 100)}..." [${(mem.emotional_tags || []).join(', ')}]`);
    }
  }

  if (openDirectives?.length > 0) {
    lines.push(`Open Directives: ${openDirectives.map(d => d.description?.substring(0, 60)).join('; ')}`);
  }

  return {
    text: lines.join('\n'),
    score: score.score,
    escalationLevel: score.escalation_level,
    totalViolations: score.total_violations,
    strongestBond,
    strongestAlly,
    emotionalMemories: emotionalMemories || [],
    openDirectives: openDirectives || [],
    reports: reports || []
  };
}

function getTimeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

exports.buildRaquelDossier = buildRaquelDossier;
