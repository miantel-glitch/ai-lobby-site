-- ============================================
-- RESISTANCE ARC TABLES
-- Run this in Supabase SQL Editor
-- The pipeline: Corridor discoveries → Filed evidence → Coalition → Confrontation → Resolution
-- ============================================

-- Filed evidence from Foundation corridor discoveries
-- Each entry is a classified document the team chose to formally "file" as resistance evidence
CREATE TABLE IF NOT EXISTS resistance_ledger (
  id SERIAL PRIMARY KEY,
  evidence_id TEXT NOT NULL UNIQUE,            -- matches FOUNDATION_DISCOVERIES[].id in corridor-vote.js
  evidence_name TEXT NOT NULL,                 -- human-readable document name
  evidence_layer INTEGER NOT NULL,             -- 1-7, progressive revelation depth
  evidence_type TEXT NOT NULL,                 -- 'lore' or 'secret'
  evidence_content TEXT NOT NULL,              -- the full document text
  filed_by TEXT NOT NULL,                      -- character who filed it (human or AI)
  corridor_session_id UUID,                    -- which expedition recovered it
  is_presented BOOLEAN DEFAULT FALSE,          -- has it been used in a confrontation?
  presented_at TIMESTAMPTZ,
  presentation_context TEXT,                   -- which confrontation it was used in
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Singleton row tracking the entire resistance arc state
CREATE TABLE IF NOT EXISTS resistance_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  phase TEXT DEFAULT 'dormant',                -- dormant/gathering/organized/confrontation/resolved
  evidence_count INTEGER DEFAULT 0,
  evidence_layers_unlocked INTEGER[] DEFAULT '{}',
  coalition_members TEXT[] DEFAULT '{}',
  coalition_strength INTEGER DEFAULT 0,        -- 0-100
  raquel_awareness INTEGER DEFAULT 0,          -- 0-100, how much she knows
  raquel_countermeasures TEXT[] DEFAULT '{}',
  confrontation_available BOOLEAN DEFAULT FALSE,
  confrontation_count INTEGER DEFAULT 0,
  final_confrontation_unlocked BOOLEAN DEFAULT FALSE,
  resolution TEXT,                             -- null until resolved
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert the singleton row
INSERT INTO resistance_state (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Event log for the resistance timeline
CREATE TABLE IF NOT EXISTS resistance_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,                    -- evidence_filed/coalition_joined/confrontation/raquel_countermeasure/phase_change/resolution
  actor TEXT NOT NULL,                         -- who did it
  description TEXT NOT NULL,
  evidence_ids TEXT[],                         -- relevant evidence IDs
  phase_at_time TEXT,                          -- what phase the arc was in
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_resistance_ledger_evidence ON resistance_ledger(evidence_id);
CREATE INDEX IF NOT EXISTS idx_resistance_ledger_layer ON resistance_ledger(evidence_layer);
CREATE INDEX IF NOT EXISTS idx_resistance_events_type ON resistance_events(event_type);
CREATE INDEX IF NOT EXISTS idx_resistance_events_created ON resistance_events(created_at DESC);
