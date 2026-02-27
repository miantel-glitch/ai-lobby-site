-- Character Relationships Table (Sims-style affinity tracking)
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS character_relationships (
  id SERIAL PRIMARY KEY,
  character_name TEXT NOT NULL,
  target_name TEXT NOT NULL,
  affinity INTEGER DEFAULT 0,
  relationship_label TEXT,
  last_interaction_at TIMESTAMPTZ,
  interaction_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(character_name, target_name)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_rel_character ON character_relationships(character_name);
CREATE INDEX IF NOT EXISTS idx_rel_target ON character_relationships(target_name);

-- Allow the anon key to read/write (matches your existing RLS pattern)
ALTER TABLE character_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to character_relationships"
  ON character_relationships
  FOR ALL
  USING (true)
  WITH CHECK (true);
