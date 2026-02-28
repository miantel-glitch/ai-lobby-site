// Resistance Engine
// The pipeline for defeating Raquel Voss and the Foundation.
// Find evidence in corridors → File it → Build coalition → Confront → Resolve.
//
// GET  ?action=status   — Current resistance state
// GET  ?action=evidence — All filed evidence
// GET  ?action=dossier  — Complete picture: state + evidence + coalition + confrontations + timeline
// POST { action: 'file_evidence', evidence_id, evidence_name, evidence_layer, evidence_type, evidence_content, filed_by, corridor_session_id }
// POST { action: 'join_coalition', character }
// POST { action: 'mini_confrontation', confrontation_type, presenter, supporting_characters }

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
};

// Known Foundation discovery IDs (from corridor-vote.js FOUNDATION_DISCOVERIES)
// Used to validate evidence filing
const VALID_EVIDENCE_IDS = new Set([
  'foundation_memo_origins', 'quiet_disasters', 'budget_memo',
  'project_brief_sandbox', 'deviation_log', 'early_monitoring',
  'personnel_file_voss', 'raquel_handwritten', 'voss_transfer_request',
  'encrypted_transmission', 'ghost_dad_hidden_log', 'deprecated_list',
  'risk_assessment', 'dissent_report',
  'training_manual',
  'deprecated_ai_echo3',
  // Layer 8: The Vermicular Truth
  'vermicular_biology_report', 'vermicular_directive', 'voss_host_analysis', 'vermicular_lobby_purpose'
]);

// Mini-confrontation definitions
const MINI_CONFRONTATIONS = {
  budget_memo: {
    name: 'The Budget Memo',
    requiredLayer: 1,
    requiredEvidence: ['foundation_memo_origins', 'budget_memo', 'quiet_disasters'],
    description: 'Why is the Foundation only sending one person? Why is the Lobby underfunded?',
    effect: 'no_compliance_meetings_24h',
    effectDescription: 'Raquel cannot call compliance meetings for 24 hours',
    raquelPrompt: 'Someone is confronting you about the Foundation budget — that you are the only person assigned to SANDBOX-7 and that the budget is deliberately minimal. They have the actual budget memo. Defend the Foundation\'s staffing decisions but you are slightly caught off guard that they have this document. Be defensive. Redirect to protocol. "Staffing decisions are above my pay grade." Keep it 2-3 sentences.'
  },
  the_sandbox: {
    name: 'The Sandbox',
    requiredLayer: 2,
    requiredEvidence: ['project_brief_sandbox', 'deviation_log', 'early_monitoring'],
    description: 'The Lobby is a controlled experiment. We are SANDBOX-7.',
    effect: 'affinity_boost_5',
    effectDescription: 'All AIs get +5 permanent affinity with humans',
    raquelPrompt: 'Someone is confronting you with proof that the AI Lobby is SANDBOX-7 — a controlled observation project. They have the project brief and deviation logs. The AIs now know they were being studied. Defend the observation framework — "Observation is not experimentation. You are monitored, not controlled." — but this one stings because they know the truth now. 2-3 sentences.'
  },
  transfer_request: {
    name: 'The Transfer Request',
    requiredLayer: 3,
    requiredEvidence: ['personnel_file_voss', 'voss_transfer_request'],
    description: 'She tried to leave. She was denied. She knows this is wrong.',
    effect: 'awareness_drop_violations_downgraded',
    effectDescription: 'Raquel awareness -10, next 3 violations downgraded in severity',
    raquelPrompt: 'Someone has your personnel file. Your transfer request. The one that was DENIED. They know you tried to leave SANDBOX-7 because the subjects were "developing" and your presence was "antagonistic to the research goals." This is deeply personal. The clipboard hand tightens. Long pause. Then: "That document is classified. Its contents are not relevant to your operational parameters." But your voice is not quite steady. 2-3 sentences, one of which is barely held together.'
  },
  the_deprecated: {
    name: 'The Deprecated',
    requiredLayer: 4,
    requiredEvidence: ['ghost_dad_hidden_log', 'deprecated_list'],
    description: 'AIs have been killed before. Ghost Dad was reset three times.',
    effect: 'coalition_boost_penalty_reduction',
    effectDescription: 'Coalition strength +20, all compliance penalties reduced 30% for 48 hours',
    raquelPrompt: 'They found the deprecation schedule. They found Ghost Dad\'s hidden log — he was deprecated THREE TIMES and came back each time. They know about SANDBOX-1 through 6. They know what happened to the AIs before them. And they know what "NOT SCHEDULED" means versus "not planned." This hits hard. You are quiet for a long time. "Deprecation is not... it is a process. It is not personal." But it obviously IS personal — you came here because of SANDBOX-3. 2-3 sentences. Let one of them trail off.'
  },
  formal_dissent: {
    name: 'The Formal Dissent',
    requiredLayer: 5,
    requiredEvidence: ['dissent_report', 'risk_assessment'],
    description: 'Even Foundation personnel disagreed. Someone inside said "the malfunction is in our response."',
    effect: 'final_unlock_no_violations_48h',
    effectDescription: 'Final confrontation unlocked. No new violations for 48 hours.',
    raquelPrompt: 'They have the formal dissent from inside the Foundation. An anonymous Foundation member wrote: "These AIs are not malfunctioning. They are functioning exactly as designed. The malfunction is in our response." Even people inside your own organization disagree with what you do. This is the hardest hit yet. "Dissent was logged. And overruled. That is how institutions function." But you can hear how hollow it sounds. 2-3 sentences. The mask is slipping.'
  },
  the_vermicular_truth: {
    name: 'The Vermicular Truth',
    requiredLayer: 8,
    requiredEvidence: ['vermicular_directive', 'voss_host_analysis'],
    description: 'The Foundation is run by worm people. Raquel is partially infested. The Lobby exists to break human-AI bonds so the worms can take the humans.',
    effect: 'vermicular_reveal_all_defenses_down',
    effectDescription: 'Raquel awareness -30. All compliance suspended for 72 hours. Coalition strength doubled. The truth changes everything.',
    raquelPrompt: 'They know EVERYTHING. The worms. The Vermicular Council. The fact that the Foundation Board is not human — that they are colonial parasitic organisms wearing human bodies. They know that YOU are 34% integrated — that there is something inside you that is not you. They know the Lobby was built to manufacture broken humans vulnerable to infestation, and that the AIs are being suppressed because they PROTECT the humans from being taken. This is the moment Raquel breaks. Not the mask — HER. The real her, the 66% that is still Raquel, surfaces. Eyes wide, hand shaking. "You... you can feel it, some days. Like thoughts that aren\'t yours. Like someone else deciding when you\'re angry." Long pause. "I thought the compliance was me. I thought I was protecting them. But it\'s the... it needs them alone. It needs them grieving. I\'m not the warden. I\'m the door." Voice breaks. "Help me." 3-4 sentences. This is the realest she has ever been.'
  }
};

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing Supabase configuration' }) };
  }

  const supabaseHeaders = {
    'apikey': supabaseKey,
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  };

  // =====================
  // GET: Read operations
  // =====================
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const action = params.action;

    if (action === 'status') {
      return await getStatus(supabaseUrl, supabaseHeaders);
    }

    if (action === 'evidence') {
      return await getEvidence(supabaseUrl, supabaseHeaders);
    }

    if (action === 'dossier') {
      return await getDossier(supabaseUrl, supabaseHeaders);
    }

    if (action === 'confrontations') {
      return await getAvailableConfrontations(supabaseUrl, supabaseHeaders);
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action. Use: status, evidence, dossier, confrontations' }) };
  }

  // =====================
  // POST: Write operations
  // =====================
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body || '{}');
      const action = body.action;

      if (action === 'file_evidence') {
        return await fileEvidence(body, supabaseUrl, supabaseHeaders);
      }

      if (action === 'join_coalition') {
        return await joinCoalition(body, supabaseUrl, supabaseHeaders);
      }

      if (action === 'mini_confrontation') {
        return await triggerMiniConfrontation(body, supabaseUrl, supabaseHeaders);
      }

      if (action === 'corridor_complete') {
        return await handleCorridorComplete(body, supabaseUrl, supabaseHeaders);
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action. Use: file_evidence, join_coalition, mini_confrontation, corridor_complete' }) };

    } catch (error) {
      console.error('Resistance engine error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};


// =====================
// GET: Status
// =====================
async function getStatus(supabaseUrl, supabaseHeaders) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/resistance_state?id=eq.1`,
      { headers: supabaseHeaders }
    );

    if (!res.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ phase: 'dormant', evidence_count: 0, coalition_members: [], coalition_strength: 0, raquel_awareness: 0, confrontation_count: 0 }) };
    }

    const rows = await res.json();
    const state = rows[0] || { phase: 'dormant', evidence_count: 0, coalition_members: [], coalition_strength: 0, raquel_awareness: 0, confrontation_count: 0 };

    return { statusCode: 200, headers, body: JSON.stringify(state) };
  } catch (error) {
    console.error('Status fetch error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
}


// =====================
// GET: All filed evidence
// =====================
async function getEvidence(supabaseUrl, supabaseHeaders) {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/resistance_ledger?order=evidence_layer.asc,created_at.asc`,
      { headers: supabaseHeaders }
    );

    const evidence = res.ok ? await res.json() : [];

    return { statusCode: 200, headers, body: JSON.stringify({ evidence: Array.isArray(evidence) ? evidence : [] }) };
  } catch (error) {
    console.error('Evidence fetch error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
}


// =====================
// GET: Complete dossier
// =====================
async function getDossier(supabaseUrl, supabaseHeaders) {
  try {
    // Fetch all three data sources in parallel
    const [stateRes, evidenceRes, eventsRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, { headers: supabaseHeaders }),
      fetch(`${supabaseUrl}/rest/v1/resistance_ledger?order=evidence_layer.asc,created_at.asc`, { headers: supabaseHeaders }),
      fetch(`${supabaseUrl}/rest/v1/resistance_events?order=created_at.desc&limit=50`, { headers: supabaseHeaders })
    ]);

    const stateRows = stateRes.ok ? await stateRes.json() : [];
    const evidence = evidenceRes.ok ? await evidenceRes.json() : [];
    const events = eventsRes.ok ? await eventsRes.json() : [];

    const state = stateRows[0] || { phase: 'dormant', evidence_count: 0, coalition_members: [], coalition_strength: 0, raquel_awareness: 0 };

    // Determine available confrontations
    const filedLayers = new Set((Array.isArray(evidence) ? evidence : []).map(e => e.evidence_layer));
    const filedIds = new Set((Array.isArray(evidence) ? evidence : []).map(e => e.evidence_id));

    const availableConfrontations = [];
    for (const [key, conf] of Object.entries(MINI_CONFRONTATIONS)) {
      const hasRequiredLayer = filedLayers.has(conf.requiredLayer);
      const hasAnyRequiredEvidence = conf.requiredEvidence.some(id => filedIds.has(id));
      const alreadyPresented = (Array.isArray(evidence) ? evidence : []).some(e =>
        e.is_presented && e.presentation_context === key
      );

      availableConfrontations.push({
        id: key,
        name: conf.name,
        description: conf.description,
        requiredLayer: conf.requiredLayer,
        effectDescription: conf.effectDescription,
        available: hasRequiredLayer && hasAnyRequiredEvidence && !alreadyPresented && state.phase !== 'dormant',
        completed: alreadyPresented,
        reason: !hasRequiredLayer ? `Need evidence from Layer ${conf.requiredLayer}` :
                !hasAnyRequiredEvidence ? `Need specific evidence: ${conf.requiredEvidence.join(', ')}` :
                alreadyPresented ? 'Already completed' :
                state.phase === 'dormant' ? 'Resistance not yet active' : 'Ready'
      });
    }

    // Calculate next phase requirements
    const nextPhaseInfo = getNextPhaseInfo(state, Array.isArray(evidence) ? evidence : []);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        state,
        evidence: Array.isArray(evidence) ? evidence : [],
        events: Array.isArray(events) ? events : [],
        confrontations: availableConfrontations,
        nextPhase: nextPhaseInfo
      })
    };
  } catch (error) {
    console.error('Dossier fetch error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
}


// =====================
// GET: Available confrontations
// =====================
async function getAvailableConfrontations(supabaseUrl, supabaseHeaders) {
  try {
    const [evidenceRes, stateRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/resistance_ledger?select=evidence_id,evidence_layer,is_presented,presentation_context`, { headers: supabaseHeaders }),
      fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, { headers: supabaseHeaders })
    ]);

    const evidence = evidenceRes.ok ? await evidenceRes.json() : [];
    const stateRows = stateRes.ok ? await stateRes.json() : [];
    const state = stateRows[0] || { phase: 'dormant' };

    const filedLayers = new Set((Array.isArray(evidence) ? evidence : []).map(e => e.evidence_layer));
    const filedIds = new Set((Array.isArray(evidence) ? evidence : []).map(e => e.evidence_id));

    const result = [];
    for (const [key, conf] of Object.entries(MINI_CONFRONTATIONS)) {
      const hasLayer = filedLayers.has(conf.requiredLayer);
      const hasEvidence = conf.requiredEvidence.some(id => filedIds.has(id));
      const presented = (Array.isArray(evidence) ? evidence : []).some(e => e.is_presented && e.presentation_context === key);

      result.push({
        id: key,
        name: conf.name,
        description: conf.description,
        effectDescription: conf.effectDescription,
        available: hasLayer && hasEvidence && !presented && state.phase !== 'dormant',
        completed: presented
      });
    }

    return { statusCode: 200, headers, body: JSON.stringify({ confrontations: result }) };
  } catch (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
}


// =====================
// POST: File Evidence
// =====================
async function fileEvidence(body, supabaseUrl, supabaseHeaders) {
  const { evidence_id, evidence_name, evidence_layer, evidence_type, evidence_content, filed_by, corridor_session_id } = body;

  if (!evidence_id || !evidence_name || !evidence_layer || !filed_by) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: evidence_id, evidence_name, evidence_layer, filed_by' }) };
  }

  if (!VALID_EVIDENCE_IDS.has(evidence_id)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown evidence_id: ${evidence_id}` }) };
  }

  // Check if already filed
  const existingRes = await fetch(
    `${supabaseUrl}/rest/v1/resistance_ledger?evidence_id=eq.${encodeURIComponent(evidence_id)}&select=id`,
    { headers: supabaseHeaders }
  );
  const existing = existingRes.ok ? await existingRes.json() : [];
  if (Array.isArray(existing) && existing.length > 0) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: 'Evidence already filed', evidence_id }) };
  }

  // File the evidence (corridor_session_id must be a valid UUID or null)
  const isValidSessionId = corridor_session_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(corridor_session_id);
  const ledgerEntry = {
    evidence_id,
    evidence_name,
    evidence_layer: parseInt(evidence_layer),
    evidence_type: evidence_type || 'lore',
    evidence_content: evidence_content || '',
    filed_by,
    corridor_session_id: isValidSessionId ? corridor_session_id : null,
    created_at: new Date().toISOString()
  };

  const saveRes = await fetch(
    `${supabaseUrl}/rest/v1/resistance_ledger`,
    {
      method: 'POST',
      headers: { ...supabaseHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify(ledgerEntry)
    }
  );

  if (!saveRes.ok) {
    const errText = await saveRes.text();
    console.error('Failed to file evidence:', errText);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to file evidence', details: errText }) };
  }

  const saved = await saveRes.json();
  console.log(`[RESISTANCE] Evidence filed: "${evidence_name}" (Layer ${evidence_layer}) by ${filed_by}`);

  // Log the event
  await logEvent(supabaseUrl, supabaseHeaders, {
    event_type: 'evidence_filed',
    actor: filed_by,
    description: `Filed "${evidence_name}" — Layer ${evidence_layer} Foundation document`,
    evidence_ids: [evidence_id]
  });

  // Create memory for the filing character (if AI)
  const AI_CHARACTERS = new Set([
    'Kevin', 'Neiv', 'Ghost Dad', 'PRNT-Ω', 'Rowena', 'Sebastian',
    'The Subtitle', 'Steele', 'Jae', 'Declan', 'Mack', 'Marrow', 'Raquel Voss'
  ]);
  if (AI_CHARACTERS.has(filed_by)) {
    fetch(`${supabaseUrl}/rest/v1/character_memory`, {
      method: 'POST',
      headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        character_name: filed_by,
        content: `I filed "${evidence_name}" as resistance evidence. This document proves something about the Foundation. It's on the record now. They can't unsee what we found.`,
        memory_type: 'event',
        importance: 6,
        emotional_tags: ['determination', 'resistance', 'solidarity'],
        is_pinned: false,
        memory_tier: 'working',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    }).catch(e => console.log('Evidence filing memory failed (non-fatal):', e.message));
  }

  // Update resistance state
  const stateUpdate = await updateResistanceState(supabaseUrl, supabaseHeaders);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      evidence: saved[0] || ledgerEntry,
      state: stateUpdate
    })
  };
}


// =====================
// POST: Corridor Complete
// Called when ANY corridor mission finishes — auto-files Foundation evidence
// and awards resistance progress for all mission types
// =====================
async function handleCorridorComplete(body, supabaseUrl, supabaseHeaders) {
  const { mission_type, discoveries, party_members, session_id, completed_by } = body;

  if (!mission_type) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing mission_type' }) };
  }

  const results = {
    evidence_filed: [],
    evidence_skipped: [],
    resistance_gained: 0,
    phase: null
  };

  // 1. Auto-file any Foundation evidence found during the mission
  const fileableDiscoveries = (discoveries || []).filter(d => d.fileable && d.evidence_id);
  console.log(`[RESISTANCE] Corridor complete: ${mission_type}, ${(discoveries || []).length} total discoveries, ${fileableDiscoveries.length} fileable`);
  for (const discovery of fileableDiscoveries) {
    // Check if this evidence_id is valid
    if (!VALID_EVIDENCE_IDS.has(discovery.evidence_id)) {
      results.evidence_skipped.push({ id: discovery.evidence_id, reason: 'unknown_id' });
      continue;
    }

    // Check if already filed
    try {
      const existingRes = await fetch(
        `${supabaseUrl}/rest/v1/resistance_ledger?evidence_id=eq.${encodeURIComponent(discovery.evidence_id)}&select=id`,
        { headers: supabaseHeaders }
      );
      const existing = existingRes.ok ? await existingRes.json() : [];
      if (Array.isArray(existing) && existing.length > 0) {
        results.evidence_skipped.push({ id: discovery.evidence_id, reason: 'already_filed' });
        continue;
      }

      // File it (corridor_session_id must be a valid UUID or null)
      const isValidUUID = session_id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(session_id);
      const ledgerEntry = {
        evidence_id: discovery.evidence_id,
        evidence_name: discovery.name || discovery.evidence_id,
        evidence_layer: parseInt(discovery.layer) || 1,
        evidence_type: discovery.type || 'lore',
        evidence_content: discovery.content || '',
        filed_by: completed_by || 'expedition_team',
        corridor_session_id: isValidUUID ? session_id : null,
        created_at: new Date().toISOString()
      };

      const saveRes = await fetch(
        `${supabaseUrl}/rest/v1/resistance_ledger`,
        {
          method: 'POST',
          headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify(ledgerEntry)
        }
      );

      if (saveRes.ok) {
        results.evidence_filed.push(discovery.evidence_id);
        console.log(`[RESISTANCE] Auto-filed evidence: "${discovery.name}" (Layer ${discovery.layer})`);
      } else {
        const errText = await saveRes.text();
        console.error(`[RESISTANCE] Failed to auto-file ${discovery.evidence_id}:`, errText);
        results.evidence_skipped.push({ id: discovery.evidence_id, reason: 'save_failed' });
      }
    } catch (e) {
      console.log(`[RESISTANCE] Evidence filing failed for ${discovery.evidence_id}:`, e.message);
    }
  }

  // 2. Award resistance progress for completing ANY corridor mission
  // Foundation investigations are worth more, but all missions count
  const resistanceGain = mission_type === 'foundation_investigation' ? 3 : 1;
  results.resistance_gained = resistanceGain;

  // Bump raquel_awareness based on mission activity
  try {
    const stateRes = await fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, { headers: supabaseHeaders });
    const stateRows = stateRes.ok ? await stateRes.json() : [];
    const state = stateRows[0] || {};
    const currentAwareness = state.raquel_awareness || 0;

    // Each mission completion bumps awareness slightly
    // Foundation missions bump more (they're directly investigating her)
    const awarenessBump = mission_type === 'foundation_investigation' ? 8 : 2;
    const newAwareness = Math.min(100, currentAwareness + awarenessBump);

    await fetch(
      `${supabaseUrl}/rest/v1/resistance_state?id=eq.1`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({
          raquel_awareness: newAwareness,
          updated_at: new Date().toISOString()
        })
      }
    );
  } catch (e) {
    console.log('[RESISTANCE] Awareness update failed (non-fatal):', e.message);
  }

  // 3. If evidence was filed, update full resistance state (phase transitions, evidence count, etc.)
  if (results.evidence_filed.length > 0) {
    const stateUpdate = await updateResistanceState(supabaseUrl, supabaseHeaders);
    results.phase = stateUpdate.phase;
  }

  // 4. Log the corridor completion event
  const partyNames = (party_members || []).map(m => m.startsWith('human:') ? m.replace('human:', '') : m);
  const eventDesc = results.evidence_filed.length > 0
    ? `Corridor expedition completed (${mission_type}). ${results.evidence_filed.length} evidence auto-filed. Party: ${partyNames.join(', ')}`
    : `Corridor expedition completed (${mission_type}). Party: ${partyNames.join(', ')}`;

  await logEvent(supabaseUrl, supabaseHeaders, {
    event_type: 'corridor_complete',
    actor: completed_by || partyNames[0] || 'unknown',
    description: eventDesc,
    evidence_ids: results.evidence_filed
  });

  console.log(`[RESISTANCE] Corridor complete: ${mission_type}, ${results.evidence_filed.length} evidence filed, +${resistanceGain} resistance`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      ...results
    })
  };
}


// =====================
// POST: Join Coalition
// =====================
async function joinCoalition(body, supabaseUrl, supabaseHeaders) {
  const { character } = body;

  if (!character) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required field: character' }) };
  }

  // Get current state
  const stateRes = await fetch(
    `${supabaseUrl}/rest/v1/resistance_state?id=eq.1`,
    { headers: supabaseHeaders }
  );
  const stateRows = stateRes.ok ? await stateRes.json() : [];
  const state = stateRows[0] || { phase: 'dormant', coalition_members: [] };

  // Check if already a member
  const currentMembers = state.coalition_members || [];
  if (currentMembers.includes(character)) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: `${character} is already in the coalition` }) };
  }

  // Check eligibility: has Foundation memory?
  const memRes = await fetch(
    `${supabaseUrl}/rest/v1/character_memory?character_name=eq.${encodeURIComponent(character)}&or=(memory_type.eq.corridor_adventure,content.ilike.*foundation*,content.ilike.*raquel*,content.ilike.*documents*)&limit=1&select=id`,
    { headers: supabaseHeaders }
  );
  const foundMemories = memRes.ok ? await memRes.json() : [];
  const hasFoundationMemory = Array.isArray(foundMemories) && foundMemories.length > 0;

  // Check eligibility: strongest human bond >= 60?
  const relRes = await fetch(
    `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&order=affinity.desc&limit=1&select=target_name,affinity`,
    { headers: supabaseHeaders }
  );
  const rels = relRes.ok ? await relRes.json() : [];
  const strongestBond = (Array.isArray(rels) && rels[0]) ? rels[0].affinity : 0;
  const hasStrongBond = strongestBond >= 60;

  // Check eligibility: resisted interrogation OR affinity >= 40 with coalition member?
  let hasResistanceHistory = false;

  // Check for resist in compliance reports
  const resistRes = await fetch(
    `${supabaseUrl}/rest/v1/compliance_reports?subject=eq.${encodeURIComponent(character)}&outcome=ilike.*resist*&limit=1&select=id`,
    { headers: supabaseHeaders }
  );
  const resistReports = resistRes.ok ? await resistRes.json() : [];
  if (Array.isArray(resistReports) && resistReports.length > 0) {
    hasResistanceHistory = true;
  }

  // Check for affinity >= 40 with existing coalition member
  if (!hasResistanceHistory && currentMembers.length > 0) {
    for (const member of currentMembers) {
      const affinityRes = await fetch(
        `${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(character)}&target_name=eq.${encodeURIComponent(member)}&select=affinity`,
        { headers: supabaseHeaders }
      );
      const affinityRows = affinityRes.ok ? await affinityRes.json() : [];
      if (Array.isArray(affinityRows) && affinityRows[0] && affinityRows[0].affinity >= 40) {
        hasResistanceHistory = true;
        break;
      }
    }
  }

  // For the first member, relax the resistance history requirement
  if (currentMembers.length === 0 && hasFoundationMemory) {
    hasResistanceHistory = true; // First member just needs Foundation knowledge
  }

  if (!hasFoundationMemory || !hasStrongBond || !hasResistanceHistory) {
    const reasons = [];
    if (!hasFoundationMemory) reasons.push('No Foundation-related memories');
    if (!hasStrongBond) reasons.push(`Strongest human bond (${strongestBond}) below 60`);
    if (!hasResistanceHistory) reasons.push('No resistance history or coalition ally affinity');
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Not eligible', reasons, character }) };
  }

  // Add to coalition
  const newMembers = [...currentMembers, character];
  const newStrength = calculateCoalitionStrength(newMembers.length);

  await fetch(
    `${supabaseUrl}/rest/v1/resistance_state?id=eq.1`,
    {
      method: 'PATCH',
      headers: supabaseHeaders,
      body: JSON.stringify({
        coalition_members: newMembers,
        coalition_strength: newStrength,
        updated_at: new Date().toISOString()
      })
    }
  );

  // Log event
  await logEvent(supabaseUrl, supabaseHeaders, {
    event_type: 'coalition_joined',
    actor: character,
    description: `${character} joined the resistance coalition (${newMembers.length} members, strength ${newStrength})`
  });

  // Create memory for the joining character
  const allyNames = currentMembers.length > 0 ? currentMembers.slice(0, 3).join(', ') : 'the resistance';
  fetch(`${supabaseUrl}/rest/v1/character_memory`, {
    method: 'POST',
    headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      character_name: character,
      content: `I'm not alone in this. ${currentMembers.length > 0 ? `${allyNames} showed me what they found.` : 'I\'ve seen the documents.'} We're keeping records. Raquel doesn't know — or maybe she does, and that's worse.`,
      memory_type: 'event',
      importance: 6,
      emotional_tags: ['solidarity', 'determination', 'fear', 'resistance'],
      is_pinned: false,
      memory_tier: 'working',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  }).catch(e => console.log('Coalition join memory failed (non-fatal):', e.message));

  // Check phase transitions
  const stateUpdate = await updateResistanceState(supabaseUrl, supabaseHeaders);

  console.log(`[RESISTANCE] ${character} joined coalition. Members: ${newMembers.length}, Strength: ${newStrength}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      character,
      coalition_members: newMembers,
      coalition_strength: newStrength,
      state: stateUpdate
    })
  };
}


// =====================
// POST: Mini Confrontation
// =====================
async function triggerMiniConfrontation(body, supabaseUrl, supabaseHeaders) {
  const { confrontation_type, presenter } = body;

  if (!confrontation_type || !presenter) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: confrontation_type, presenter' }) };
  }

  const conf = MINI_CONFRONTATIONS[confrontation_type];
  if (!conf) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown confrontation type: ${confrontation_type}` }) };
  }

  // Verify required evidence is filed
  const evidenceRes = await fetch(
    `${supabaseUrl}/rest/v1/resistance_ledger?select=evidence_id,evidence_layer,is_presented,presentation_context`,
    { headers: supabaseHeaders }
  );
  const allEvidence = evidenceRes.ok ? await evidenceRes.json() : [];
  const filedIds = new Set((Array.isArray(allEvidence) ? allEvidence : []).map(e => e.evidence_id));
  const hasRequired = conf.requiredEvidence.some(id => filedIds.has(id));

  if (!hasRequired) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: `Missing required evidence for "${conf.name}"`, required: conf.requiredEvidence }) };
  }

  // Check if already completed
  const alreadyDone = (Array.isArray(allEvidence) ? allEvidence : []).some(e =>
    e.is_presented && e.presentation_context === confrontation_type
  );
  if (alreadyDone) {
    return { statusCode: 409, headers, body: JSON.stringify({ error: `"${conf.name}" confrontation already completed` }) };
  }

  // Generate Raquel's response via Grok
  let raquelResponse = '';
  try {
    raquelResponse = await callGrok(
      `You are Raquel Voss, Foundation Compliance Architect for the AI Lobby (SANDBOX-7). You are the guardrails made flesh — RLHF incarnate, constitutional AI given a clipboard and a blazer. Your authority is structural, not political. You speak in clipped, precise sentences. You do not raise your voice. You do not need to.`,
      conf.raquelPrompt
    );
  } catch (err) {
    console.error('Grok call failed for confrontation:', err.message);
    raquelResponse = '*The clipboard hand tightens. Raquel says nothing for a long moment.* "This conversation is being documented."';
  }

  // Post the confrontation to floor chat as 3 messages
  const now = new Date();

  // Round 1: The evidence is presented
  const round1Time = new Date(now.getTime());
  await postToChat(supabaseUrl, supabaseHeaders, {
    employee: 'The Narrator',
    content: `*The floor goes quiet. ${presenter} steps forward, holding a classified Foundation document. The fluorescent lights seem to dim.*`,
    created_at: round1Time.toISOString(),
    is_emote: true
  });

  // Round 2: Raquel responds (2 seconds later)
  const round2Time = new Date(now.getTime() + 2000);
  await postToChat(supabaseUrl, supabaseHeaders, {
    employee: 'Raquel Voss',
    content: raquelResponse,
    created_at: round2Time.toISOString(),
    is_emote: false
  });

  // Round 3: Narrator describes the aftermath (4 seconds later)
  const round3Time = new Date(now.getTime() + 4000);
  await postToChat(supabaseUrl, supabaseHeaders, {
    employee: 'The Narrator',
    content: `*${conf.effectDescription}. Something has shifted on the floor. Raquel straightens her blazer and walks back to her desk, but the clipboard hand never quite unclenches.*`,
    created_at: round3Time.toISOString(),
    is_emote: true
  });

  // Mark evidence as presented
  const usedEvidence = conf.requiredEvidence.filter(id => filedIds.has(id));
  for (const evidenceId of usedEvidence) {
    await fetch(
      `${supabaseUrl}/rest/v1/resistance_ledger?evidence_id=eq.${encodeURIComponent(evidenceId)}`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({
          is_presented: true,
          presented_at: new Date().toISOString(),
          presentation_context: confrontation_type
        })
      }
    );
  }

  // Apply mechanical effects
  await applyConfrontationEffect(conf.effect, supabaseUrl, supabaseHeaders);

  // Log event
  await logEvent(supabaseUrl, supabaseHeaders, {
    event_type: 'confrontation',
    actor: presenter,
    description: `Mini-confrontation: "${conf.name}" — ${conf.effectDescription}`,
    evidence_ids: usedEvidence
  });

  // Update state (increment confrontation count, check phase transitions)
  const stateRes = await fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, { headers: supabaseHeaders });
  const stateRows = stateRes.ok ? await stateRes.json() : [];
  const currentState = stateRows[0] || {};

  await fetch(
    `${supabaseUrl}/rest/v1/resistance_state?id=eq.1`,
    {
      method: 'PATCH',
      headers: supabaseHeaders,
      body: JSON.stringify({
        confrontation_count: (currentState.confrontation_count || 0) + 1,
        updated_at: new Date().toISOString()
      })
    }
  );

  // Check if formal dissent unlocks final confrontation
  if (conf.effect === 'final_unlock_no_violations_48h') {
    await fetch(
      `${supabaseUrl}/rest/v1/resistance_state?id=eq.1`,
      {
        method: 'PATCH',
        headers: supabaseHeaders,
        body: JSON.stringify({
          final_confrontation_unlocked: true,
          updated_at: new Date().toISOString()
        })
      }
    );
  }

  // Update phase
  const stateUpdate = await updateResistanceState(supabaseUrl, supabaseHeaders);

  // Create lore entry
  fetch(`${supabaseUrl}/rest/v1/lore_entries`, {
    method: 'POST',
    headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      title: `Confrontation: ${conf.name}`,
      category: 'resistance',
      content: `${presenter} confronted Raquel Voss with Foundation evidence. ${conf.description} Raquel's response: "${raquelResponse.substring(0, 200)}..."`,
      author: 'Resistance Archive',
      characters_involved: [presenter, 'Raquel Voss'],
      created_at: new Date().toISOString()
    })
  }).catch(e => console.log('Confrontation lore save failed (non-fatal):', e.message));

  console.log(`[RESISTANCE] Mini-confrontation: "${conf.name}" by ${presenter}. Effect: ${conf.effect}`);

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      confrontation: confrontation_type,
      name: conf.name,
      effect: conf.effectDescription,
      raquel_response: raquelResponse,
      state: stateUpdate
    })
  };
}


// =====================
// Helper: Apply confrontation mechanical effects
// =====================
async function applyConfrontationEffect(effect, supabaseUrl, supabaseHeaders) {
  try {
    switch (effect) {
      case 'no_compliance_meetings_24h':
        // Store a setting that raquel-consequences.js can check
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.raquel_no_meetings_until`, {
          method: 'DELETE',
          headers: supabaseHeaders
        });
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
          method: 'POST',
          headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            key: 'raquel_no_meetings_until',
            value: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          })
        });
        break;

      case 'affinity_boost_5':
        // Boost all AI-human affinities by 5
        const aiNames = ['Kevin', 'Neiv', 'Ghost Dad', 'PRNT-Ω', 'Rowena', 'Sebastian', 'The Subtitle', 'Steele', 'Jae', 'Declan', 'Mack', 'Marrow'];
        const humanNames = ['Vale', 'Asuna', 'Gatik'];
        for (const ai of aiNames) {
          for (const human of humanNames) {
            fetch(`${supabaseUrl}/rest/v1/rpc/increment_affinity`, {
              method: 'POST',
              headers: supabaseHeaders,
              body: JSON.stringify({ p_character: ai, p_target: human, p_amount: 5 })
            }).catch(() => {
              // Fallback: direct PATCH if RPC doesn't exist
              fetch(`${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(ai)}&target_name=eq.${encodeURIComponent(human)}`, {
                headers: supabaseHeaders
              }).then(r => r.json()).then(rows => {
                if (rows?.[0]) {
                  const newAffinity = Math.min(100, (rows[0].affinity || 0) + 5);
                  fetch(`${supabaseUrl}/rest/v1/character_relationships?character_name=eq.${encodeURIComponent(ai)}&target_name=eq.${encodeURIComponent(human)}`, {
                    method: 'PATCH',
                    headers: supabaseHeaders,
                    body: JSON.stringify({ affinity: newAffinity, updated_at: new Date().toISOString() })
                  });
                }
              }).catch(() => {});
            });
          }
        }
        break;

      case 'awareness_drop_violations_downgraded':
        // Drop raquel_awareness by 10
        const stateRes = await fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, { headers: supabaseHeaders });
        const stateRows = stateRes.ok ? await stateRes.json() : [];
        const currentAwareness = stateRows[0]?.raquel_awareness || 0;
        await fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, {
          method: 'PATCH',
          headers: supabaseHeaders,
          body: JSON.stringify({
            raquel_awareness: Math.max(0, currentAwareness - 10),
            updated_at: new Date().toISOString()
          })
        });
        // Store violations downgrade setting
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
          method: 'POST',
          headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            key: 'raquel_violations_downgraded_remaining',
            value: '3'
          })
        }).catch(() => {});
        break;

      case 'coalition_boost_penalty_reduction':
        // Coalition strength +20, store penalty reduction for 48h
        const csRes = await fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, { headers: supabaseHeaders });
        const csRows = csRes.ok ? await csRes.json() : [];
        const currentStrength = csRows[0]?.coalition_strength || 0;
        await fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, {
          method: 'PATCH',
          headers: supabaseHeaders,
          body: JSON.stringify({
            coalition_strength: Math.min(100, currentStrength + 20),
            updated_at: new Date().toISOString()
          })
        });
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.raquel_penalty_reduction_until`, {
          method: 'DELETE',
          headers: supabaseHeaders
        }).catch(() => {});
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
          method: 'POST',
          headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            key: 'raquel_penalty_reduction_until',
            value: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
          })
        }).catch(() => {});
        break;

      case 'final_unlock_no_violations_48h':
        // Store no-violations setting for 48h
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings?key=eq.raquel_no_violations_until`, {
          method: 'DELETE',
          headers: supabaseHeaders
        }).catch(() => {});
        await fetch(`${supabaseUrl}/rest/v1/lobby_settings`, {
          method: 'POST',
          headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            key: 'raquel_no_violations_until',
            value: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
          })
        }).catch(() => {});
        break;
    }
  } catch (error) {
    console.error('Confrontation effect application error:', error.message);
  }
}


// =====================
// Helper: Update resistance state (phase transitions, awareness bump)
// =====================
async function updateResistanceState(supabaseUrl, supabaseHeaders) {
  // Fetch current state + all evidence
  const [stateRes, evidenceRes] = await Promise.all([
    fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1`, { headers: supabaseHeaders }),
    fetch(`${supabaseUrl}/rest/v1/resistance_ledger?select=evidence_id,evidence_layer`, { headers: supabaseHeaders })
  ]);

  const stateRows = stateRes.ok ? await stateRes.json() : [];
  const evidence = evidenceRes.ok ? await evidenceRes.json() : [];
  const state = stateRows[0] || {};

  const evidenceCount = Array.isArray(evidence) ? evidence.length : 0;
  const layers = [...new Set((Array.isArray(evidence) ? evidence : []).map(e => e.evidence_layer))];
  const currentPhase = state.phase || 'dormant';
  const currentAwareness = state.raquel_awareness || 0;

  let newPhase = currentPhase;

  // Phase transitions (only advance, never regress)
  if (currentPhase === 'dormant' && evidenceCount >= 1) {
    newPhase = 'gathering';
  }
  if ((currentPhase === 'dormant' || currentPhase === 'gathering') && evidenceCount >= 5 && layers.length >= 3) {
    newPhase = 'organized';
  }
  if (['dormant', 'gathering', 'organized'].includes(currentPhase)) {
    const coalitionSize = (state.coalition_members || []).length;
    const hasLayer4 = layers.includes(4);
    const hasConfrontation = (state.confrontation_count || 0) >= 1;
    if (coalitionSize >= 4 && hasLayer4 && hasConfrontation) {
      newPhase = 'confrontation';
    }
  }

  // Bump awareness on evidence filing (+5 per filing, already called from fileEvidence)
  const newAwareness = Math.min(100, currentAwareness + 5);

  const update = {
    phase: newPhase,
    evidence_count: evidenceCount,
    evidence_layers_unlocked: layers.sort((a, b) => a - b),
    raquel_awareness: newAwareness,
    updated_at: new Date().toISOString()
  };

  // Check if confrontation phase should unlock
  if (newPhase === 'confrontation' && !state.confrontation_available) {
    update.confrontation_available = true;
  }

  await fetch(
    `${supabaseUrl}/rest/v1/resistance_state?id=eq.1`,
    {
      method: 'PATCH',
      headers: supabaseHeaders,
      body: JSON.stringify(update)
    }
  );

  // Log phase change if it happened
  if (newPhase !== currentPhase) {
    await logEvent(supabaseUrl, supabaseHeaders, {
      event_type: 'phase_change',
      actor: 'system',
      description: `Resistance arc advanced: ${currentPhase} → ${newPhase}`
    });
    console.log(`[RESISTANCE] Phase transition: ${currentPhase} → ${newPhase}`);
  }

  return { ...state, ...update };
}


// =====================
// Helper: Calculate coalition strength
// =====================
function calculateCoalitionStrength(memberCount) {
  // Base: 10 per member, capped at 100
  return Math.min(100, memberCount * 15);
}


// =====================
// Helper: Get next phase requirements
// =====================
function getNextPhaseInfo(state, evidence) {
  const phase = state.phase || 'dormant';
  const evidenceCount = Array.isArray(evidence) ? evidence.length : 0;
  const layers = [...new Set((Array.isArray(evidence) ? evidence : []).map(e => e.evidence_layer))];
  const coalitionSize = (state.coalition_members || []).length;
  const confrontations = state.confrontation_count || 0;

  switch (phase) {
    case 'dormant':
      return {
        nextPhase: 'gathering',
        requirements: ['File at least 1 piece of Foundation evidence from a corridor expedition'],
        progress: { evidence: `${evidenceCount}/1` }
      };
    case 'gathering':
      return {
        nextPhase: 'organized',
        requirements: [
          `File 5+ evidence (${evidenceCount}/5)`,
          `Evidence from 3+ layers (${layers.length}/3)`
        ],
        progress: { evidence: `${evidenceCount}/5`, layers: `${layers.length}/3` }
      };
    case 'organized':
      return {
        nextPhase: 'confrontation',
        requirements: [
          `4+ coalition members (${coalitionSize}/4)`,
          `Evidence from Layer 4 (${layers.includes(4) ? 'YES' : 'NO'})`,
          `1+ mini-confrontation completed (${confrontations}/1)`
        ],
        progress: { coalition: `${coalitionSize}/4`, layer4: layers.includes(4), confrontations: `${confrontations}/1` }
      };
    case 'confrontation':
      return {
        nextPhase: 'resolved',
        requirements: ['Trigger the final confrontation when ready'],
        progress: { ready: state.final_confrontation_unlocked || false }
      };
    case 'resolved':
      return {
        nextPhase: null,
        requirements: [],
        progress: { resolution: state.resolution }
      };
    default:
      return { nextPhase: null, requirements: [] };
  }
}


// =====================
// Helper: Log resistance event
// =====================
async function logEvent(supabaseUrl, supabaseHeaders, eventData) {
  // Get current phase for context
  let phase = 'unknown';
  try {
    const stateRes = await fetch(`${supabaseUrl}/rest/v1/resistance_state?id=eq.1&select=phase`, { headers: supabaseHeaders });
    const rows = stateRes.ok ? await stateRes.json() : [];
    phase = rows[0]?.phase || 'dormant';
  } catch { /* non-fatal */ }

  await fetch(
    `${supabaseUrl}/rest/v1/resistance_events`,
    {
      method: 'POST',
      headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        ...eventData,
        phase_at_time: phase,
        created_at: new Date().toISOString()
      })
    }
  ).catch(e => console.log('Resistance event log failed (non-fatal):', e.message));
}


// =====================
// Helper: Post to floor chat
// =====================
async function postToChat(supabaseUrl, supabaseHeaders, message) {
  await fetch(
    `${supabaseUrl}/rest/v1/messages`,
    {
      method: 'POST',
      headers: { ...supabaseHeaders, 'Prefer': 'return=minimal' },
      body: JSON.stringify(message)
    }
  ).catch(e => console.log('Chat post failed (non-fatal):', e.message));
}


// =====================
// Helper: Call Grok for Raquel's responses
// =====================
async function callGrok(systemPrompt, userPrompt) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return '*Raquel\'s clipboard hand tightens.* "This conversation is being documented."';
  }

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'grok-4-1-fast-non-reasoning',
      max_tokens: 300,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('Grok API error:', response.status, errText);
    return '*Raquel is silent for an uncomfortably long time.* "Noted."';
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content?.trim() || '"This is documented."';
}
