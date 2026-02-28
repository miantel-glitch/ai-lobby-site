-- Relationship Events Table
-- Logs real-time relationship events detected by the Relationship Reactor scanner
-- Created: 2026-02-27

CREATE TABLE IF NOT EXISTS relationship_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  character_name TEXT NOT NULL,
  target_name TEXT NOT NULL,
  event_type TEXT NOT NULL,           -- 'jealousy_trigger', 'bond_moment', 'confrontation', 'affinity_change', 'avoidance', 'physical_contact', 'verbal_aggression', 'affection', 'dismissal', 'vulnerability'
  intensity SMALLINT DEFAULT 1,       -- 1-10 scale
  context TEXT,                       -- what happened (snippet from response)
  source TEXT DEFAULT 'scanner',      -- 'ai_response', 'scanner', 'affinity_engine', 'consequence'
  affinity_delta SMALLINT DEFAULT 0,  -- actual affinity change applied
  processed BOOLEAN DEFAULT FALSE,    -- has consequence processor handled this?
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for looking up events by character
CREATE INDEX IF NOT EXISTS idx_rel_events_character ON relationship_events(character_name);

-- Index for looking up events targeting a character
CREATE INDEX IF NOT EXISTS idx_rel_events_target ON relationship_events(target_name);

-- Index for consequence processor to find unprocessed events
CREATE INDEX IF NOT EXISTS idx_rel_events_unprocessed ON relationship_events(processed) WHERE processed = FALSE;

-- Index for recent events (used by relationship landscape in prompts)
CREATE INDEX IF NOT EXISTS idx_rel_events_recent ON relationship_events(created_at DESC);

-- Composite index for character pair lookups
CREATE INDEX IF NOT EXISTS idx_rel_events_pair ON relationship_events(character_name, target_name);

-- Enable RLS
ALTER TABLE relationship_events ENABLE ROW LEVEL SECURITY;

-- Allow anon read/write (same pattern as other tables in this project)
CREATE POLICY "Allow anon read" ON relationship_events FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON relationship_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update" ON relationship_events FOR UPDATE TO anon USING (true);
CREATE POLICY "Allow anon delete" ON relationship_events FOR DELETE TO anon USING (true);
