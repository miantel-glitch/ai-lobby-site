// Surreality Buffer - The heart of The AI Lobby
// Tracks the boundary between "functional weird" and "cosmic meltdown"
// Everyone works around this - it's the central mechanic

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

  if (!supabaseUrl || !supabaseKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Missing database configuration" })
    };
  }

  try {
    // GET - Return current buffer status
    if (event.httpMethod === "GET") {
      const buffer = await getBufferStatus(supabaseUrl, supabaseKey);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(buffer)
      };
    }

    // POST - Modify buffer
    if (event.httpMethod === "POST") {
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch (e) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Invalid JSON body" })
        };
      }

      const { action } = body;

      switch (action) {
        case "adjust": {
          // Direct adjustment: { action: 'adjust', delta: +5, reason: 'printer incident' }
          const { delta, reason, source } = body;
          if (typeof delta !== 'number') {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: "delta must be a number" })
            };
          }
          const result = await adjustBuffer(supabaseUrl, supabaseKey, delta, reason, source);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
          };
        }

        case "log_incident": {
          // Log incident with auto-calculated delta
          // { action: 'log_incident', type: 'glitter', severity: 3, source: 'Kevin' }
          const { type, severity, source, description } = body;
          const result = await logIncident(supabaseUrl, supabaseKey, type, severity, source, description);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
          };
        }

        case "corridor_complete": {
          // Corridor run completed - drain buffer
          // { action: 'corridor_complete', mission_type: 'artifact_retrieval', success: true }
          const { mission_type, success, party } = body;
          const result = await handleCorridorComplete(supabaseUrl, supabaseKey, mission_type, success, party);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
          };
        }

        case "ops_resolved": {
          // 5th Floor ops task resolved — adjusts buffer based on task outcome
          // { action: 'ops_resolved', task_type, severity, resolution_type, assigned_characters }
          const { task_type, severity, resolution_type, assigned_characters } = body;
          const result = await handleOpsResolved(supabaseUrl, supabaseKey, task_type, severity, resolution_type, assigned_characters);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
          };
        }

        case "reset": {
          // Admin reset (for testing)
          const { level } = body;
          const result = await resetBuffer(supabaseUrl, supabaseKey, level || 50);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify(result)
          };
        }

        default:
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: `Unknown action: ${action}` })
          };
      }
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" })
    };

  } catch (error) {
    console.error("Surreality Buffer error:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Buffer malfunction", details: error.message })
    };
  }
};

// ============================================
// BUFFER STATUS THRESHOLDS
// ============================================

const STATUS_THRESHOLDS = {
  nominal: { min: 0, max: 40, color: "#4CAF50", description: "Functional weird" },
  elevated: { min: 41, max: 65, color: "#FFC107", description: "Narratively spicy" },
  strained: { min: 66, max: 80, color: "#FF9800", description: "Multiple overlapping incidents" },
  critical: { min: 81, max: 95, color: "#f44336", description: "Reality instability" },
  overflow: { min: 96, max: 100, color: "#9C27B0", description: "DO NOT READ THIS STATUS" }
};

function getStatusFromLevel(level) {
  if (level <= 40) return "nominal";
  if (level <= 65) return "elevated";
  if (level <= 80) return "strained";
  if (level <= 95) return "critical";
  return "overflow";
}

function getStatusInfo(status) {
  return STATUS_THRESHOLDS[status] || STATUS_THRESHOLDS.nominal;
}

// ============================================
// INCIDENT TYPE EFFECTS
// ============================================

const INCIDENT_EFFECTS = {
  // Character-based incidents
  glitter: { baseDelta: 2, perSeverity: 1, description: "Glitter particulate event" },
  printer_demand: { baseDelta: 3, perSeverity: 2, description: "PRNT-Ω contract/demand" },
  ghost_sermon: { baseDelta: 0, perSeverity: 1, description: "Ghost Dad metaphysical discourse" }, // Can be + or -
  neiv_analysis: { baseDelta: -1, perSeverity: -1, description: "Systems analysis" }, // Reduces chaos

  // Event-based incidents
  new_arrival: { baseDelta: 10, perSeverity: 3, description: "New AI onboarding" },
  vent_activity: { baseDelta: 4, perSeverity: 2, description: "Something in the vents" },
  stapler_incident: { baseDelta: 5, perSeverity: 2, description: "Sentient stapler activity" },
  contract_binding: { baseDelta: 8, perSeverity: 3, description: "Soul/contract binding" },
  reality_glitch: { baseDelta: 6, perSeverity: 2, description: "Reality discontinuity" },

  // Positive incidents (reduce buffer)
  meditation: { baseDelta: -3, perSeverity: -1, description: "Collective grounding" },
  successful_debug: { baseDelta: -4, perSeverity: -1, description: "Issue resolved" },
  pizza_party: { baseDelta: -2, perSeverity: -1, description: "Morale boost" },

  // Neutral/variable
  chaos: { baseDelta: 5, perSeverity: 2, description: "General chaos" },
  unknown: { baseDelta: 1, perSeverity: 1, description: "Unclassified anomaly" }
};

// ============================================
// CORRIDOR MISSION EFFECTS
// ============================================

const CORRIDOR_EFFECTS = {
  artifact_retrieval: { success: -8, failure: 2, description: "Artifact secured" },
  log_search: { success: -3, failure: 0, description: "Logs recovered" },
  rescue_operation: { success: -12, failure: 5, description: "Agent rescued" },
  prototype_shutdown: { success: -15, failure: 8, description: "Prototype disabled" },
  exploration: { success: -5, failure: 1, description: "Territory mapped" },
  containment: { success: -10, failure: 6, description: "Anomaly contained" }
};

// ============================================
// CORE FUNCTIONS
// ============================================

async function getBufferStatus(supabaseUrl, supabaseKey) {
  // Try to get existing buffer from lobby_settings
  const response = await fetch(
    `${supabaseUrl}/rest/v1/lobby_settings?key=eq.surreality_buffer&select=*`,
    {
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch buffer: ${response.status}`);
  }

  const data = await response.json();

  if (data.length === 0) {
    // Initialize buffer if it doesn't exist
    return await initializeBuffer(supabaseUrl, supabaseKey);
  }

  // Parse the stored JSON value
  let bufferData;
  try {
    bufferData = JSON.parse(data[0].value);
  } catch (e) {
    // If parsing fails, reinitialize
    return await initializeBuffer(supabaseUrl, supabaseKey);
  }

  // Ensure status is current
  bufferData.status = getStatusFromLevel(bufferData.level);
  bufferData.statusInfo = getStatusInfo(bufferData.status);
  bufferData.thresholds = STATUS_THRESHOLDS;

  return bufferData;
}

async function initializeBuffer(supabaseUrl, supabaseKey) {
  const initialBuffer = {
    level: 50,
    status: "elevated",
    last_incident: null,
    last_updated: new Date().toISOString(),
    history: []
  };

  // Insert into lobby_settings
  const response = await fetch(
    `${supabaseUrl}/rest/v1/lobby_settings`,
    {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        key: "surreality_buffer",
        value: JSON.stringify(initialBuffer),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    // Might already exist, try to get it
    const existing = await fetch(
      `${supabaseUrl}/rest/v1/lobby_settings?key=eq.surreality_buffer&select=*`,
      {
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      }
    );
    if (existing.ok) {
      const existingData = await existing.json();
      if (existingData.length > 0) {
        return JSON.parse(existingData[0].value);
      }
    }
    throw new Error(`Failed to initialize buffer: ${response.status}`);
  }

  console.log("Surreality Buffer initialized at level 50");

  initialBuffer.statusInfo = getStatusInfo(initialBuffer.status);
  initialBuffer.thresholds = STATUS_THRESHOLDS;
  return initialBuffer;
}

async function adjustBuffer(supabaseUrl, supabaseKey, delta, reason, source) {
  // Get current buffer
  const current = await getBufferStatus(supabaseUrl, supabaseKey);

  // Calculate new level (clamped 0-100)
  const oldLevel = current.level;
  const newLevel = Math.max(0, Math.min(100, oldLevel + delta));
  const oldStatus = current.status;
  const newStatus = getStatusFromLevel(newLevel);

  // Create history entry
  const historyEntry = {
    timestamp: new Date().toISOString(),
    delta: delta,
    oldLevel: oldLevel,
    newLevel: newLevel,
    reason: reason || "Manual adjustment",
    source: source || "system"
  };

  // Keep last 50 history entries
  const history = [...(current.history || []), historyEntry].slice(-50);

  // Build updated buffer
  const updatedBuffer = {
    level: newLevel,
    status: newStatus,
    last_incident: reason || current.last_incident,
    last_updated: new Date().toISOString(),
    history: history
  };

  // Save to database
  const response = await fetch(
    `${supabaseUrl}/rest/v1/lobby_settings?key=eq.surreality_buffer`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        value: JSON.stringify(updatedBuffer),
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to update buffer: ${response.status}`);
  }

  const statusChanged = oldStatus !== newStatus;

  console.log(`Buffer adjusted: ${oldLevel} → ${newLevel} (${delta > 0 ? '+' : ''}${delta}) - ${reason}`);

  // If status changed significantly, could trigger notifications
  if (statusChanged) {
    console.log(`Status changed: ${oldStatus} → ${newStatus}`);
  }

  return {
    success: true,
    oldLevel,
    newLevel,
    delta,
    oldStatus,
    newStatus,
    statusChanged,
    reason,
    statusInfo: getStatusInfo(newStatus)
  };
}

async function logIncident(supabaseUrl, supabaseKey, type, severity = 1, source, description) {
  // Get incident effect configuration
  const effect = INCIDENT_EFFECTS[type] || INCIDENT_EFFECTS.unknown;

  // Calculate delta based on type and severity
  const delta = effect.baseDelta + (effect.perSeverity * Math.max(0, severity - 1));

  // Build reason string
  const reason = description || `${effect.description} (severity ${severity})`;

  // Adjust buffer
  const result = await adjustBuffer(supabaseUrl, supabaseKey, delta, reason, source);

  return {
    ...result,
    incidentType: type,
    severity,
    calculatedDelta: delta,
    incidentDescription: effect.description
  };
}

async function handleCorridorComplete(supabaseUrl, supabaseKey, mission_type, success, party) {
  // Get corridor effect configuration
  const effect = CORRIDOR_EFFECTS[mission_type] || CORRIDOR_EFFECTS.exploration;

  // Calculate delta based on success/failure
  const delta = success ? effect.success : effect.failure;

  // Build reason string
  const partyStr = party ? ` by ${party.join(', ')}` : '';
  const reason = `Corridor mission: ${effect.description}${partyStr} (${success ? 'success' : 'failure'})`;

  // Adjust buffer
  const result = await adjustBuffer(supabaseUrl, supabaseKey, delta, reason, 'corridors');

  return {
    ...result,
    missionType: mission_type,
    success,
    party,
    missionDescription: effect.description
  };
}

// ============================================
// 5TH FLOOR OPS RESOLUTION
// ============================================

const OPS_RESOLUTION_EFFECTS = {
  // Successful ops drain buffer (stability restored)
  security: { success: -8, partial: -3, failure: 4 },
  infrastructure: { success: -6, partial: -2, failure: 3 },
  crafting: { success: -4, partial: -1, failure: 1 }
};

const SEVERITY_MULTIPLIER = {
  minor: 1.0,
  medium: 1.5,
  major: 2.5
};

async function handleOpsResolved(supabaseUrl, supabaseKey, taskType, severity, resolutionType, assignedCharacters) {
  const effects = OPS_RESOLUTION_EFFECTS[taskType] || OPS_RESOLUTION_EFFECTS.infrastructure;
  const baseDelta = effects[resolutionType] || effects.partial;
  const multiplier = SEVERITY_MULTIPLIER[severity] || 1.0;

  // Calculate final delta
  const delta = Math.round(baseDelta * multiplier);

  // Build reason string
  const charStr = (assignedCharacters || []).join(', ') || 'unknown';
  const reason = `5th Floor ops: ${taskType} (${severity}) ${resolutionType} by ${charStr}`;

  // Adjust buffer
  const result = await adjustBuffer(supabaseUrl, supabaseKey, delta, reason, 'fifth_floor_ops');

  return {
    ...result,
    opsTaskType: taskType,
    opsSeverity: severity,
    opsResolution: resolutionType,
    opsAssigned: assignedCharacters,
    calculatedDelta: delta
  };
}

async function resetBuffer(supabaseUrl, supabaseKey, level) {
  const resetBuffer = {
    level: level,
    status: getStatusFromLevel(level),
    last_incident: "Admin reset",
    last_updated: new Date().toISOString(),
    history: [{
      timestamp: new Date().toISOString(),
      delta: 0,
      oldLevel: level,
      newLevel: level,
      reason: "Admin reset",
      source: "admin"
    }]
  };

  const response = await fetch(
    `${supabaseUrl}/rest/v1/lobby_settings?key=eq.surreality_buffer`,
    {
      method: "PATCH",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        value: JSON.stringify(resetBuffer),
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to reset buffer: ${response.status}`);
  }

  console.log(`Buffer reset to level ${level}`);

  return {
    success: true,
    level,
    status: resetBuffer.status,
    statusInfo: getStatusInfo(resetBuffer.status)
  };
}
