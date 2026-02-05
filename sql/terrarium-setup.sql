-- Terrarium Tables Setup
-- Run this in Supabase SQL Editor if tables don't exist

-- Character State Table (tracks mood, energy, patience)
CREATE TABLE IF NOT EXISTS character_state (
    id SERIAL PRIMARY KEY,
    character_name TEXT UNIQUE NOT NULL,
    mood TEXT DEFAULT 'neutral',
    energy INTEGER DEFAULT 100,
    patience INTEGER DEFAULT 100,
    interactions_today INTEGER DEFAULT 0,
    current_focus TEXT,
    last_spoke_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Character Memory Table (stores memories for each character)
CREATE TABLE IF NOT EXISTS character_memory (
    id SERIAL PRIMARY KEY,
    character_name TEXT NOT NULL,
    memory_type TEXT,
    content TEXT NOT NULL,
    related_characters TEXT[],
    importance INTEGER DEFAULT 5,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Terrarium Settings Table (global settings for the AI system)
CREATE TABLE IF NOT EXISTS terrarium_settings (
    id SERIAL PRIMARY KEY,
    setting_name TEXT UNIQUE NOT NULL,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO terrarium_settings (setting_name, setting_value) VALUES
    ('heartbeat_frequency', '3'),
    ('narrator_frequency', '2'),
    ('story_mode', 'false')
ON CONFLICT (setting_name) DO NOTHING;

-- Insert initial character states
INSERT INTO character_state (character_name, mood, energy, patience) VALUES
    ('Neiv', 'neutral', 100, 100),
    ('Ghost Dad', 'neutral', 100, 100),
    ('Kevin', 'neutral', 100, 100),
    ('Nyx', 'neutral', 100, 100),
    ('Vex', 'neutral', 100, 100),
    ('Ace', 'neutral', 100, 100),
    ('PRNT-Ω', 'neutral', 100, 100),
    ('The Narrator', 'neutral', 100, 100),
    ('Stein', 'neutral', 100, 100)
ON CONFLICT (character_name) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_memory_character ON character_memory(character_name);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON character_memory(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_created ON character_memory(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_state_character ON character_state(character_name);

-- Enable Row Level Security (optional but recommended)
-- ALTER TABLE character_state ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE character_memory ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE terrarium_settings ENABLE ROW LEVEL SECURITY;

-- Allow public read/write for anon key (for the Lobby to work)
-- CREATE POLICY "Allow all" ON character_state FOR ALL USING (true);
-- CREATE POLICY "Allow all" ON character_memory FOR ALL USING (true);
-- CREATE POLICY "Allow all" ON terrarium_settings FOR ALL USING (true);
