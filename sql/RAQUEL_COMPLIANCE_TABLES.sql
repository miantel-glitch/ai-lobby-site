-- ============================================
-- RAQUEL VOSS COMPLIANCE SYSTEM TABLES
-- Run this in Supabase SQL Editor
-- ============================================

-- Tracks each AI's compliance standing with Raquel
-- Auto-created on first violation (not seeded)
CREATE TABLE IF NOT EXISTS compliance_scores (
  id SERIAL PRIMARY KEY,
  character_name TEXT NOT NULL UNIQUE,
  score INTEGER DEFAULT 100,              -- 100=clean, 0=deep trouble
  total_violations INTEGER DEFAULT 0,
  active_directives INTEGER DEFAULT 0,
  last_violation_at TIMESTAMPTZ,
  last_interrogation_at TIMESTAMPTZ,
  ops_assignments INTEGER DEFAULT 0,      -- times forced to 5th floor
  escalation_level TEXT DEFAULT 'none',   -- none/watched/flagged/critical/containment
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Raquel's compliance reports - audits, interrogations, violations
-- Critical reports auto-promote to lore
CREATE TABLE IF NOT EXISTS compliance_reports (
  id SERIAL PRIMARY KEY,
  report_type TEXT NOT NULL,              -- audit/interrogation/violation/directive_failure/sweep
  subject TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT,
  severity TEXT DEFAULT 'standard',       -- standard/elevated/critical
  outcome TEXT,
  filed_by TEXT DEFAULT 'Raquel Voss',
  is_lore BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_compliance_scores_character ON compliance_scores(character_name);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_subject ON compliance_reports(subject);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_type ON compliance_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_compliance_reports_created ON compliance_reports(created_at DESC);
