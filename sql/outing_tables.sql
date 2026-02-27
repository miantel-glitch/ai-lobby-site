-- Go Out... Outing/Dating System - Database Schema
-- Run this in Supabase SQL Editor

-- Table: outing_sessions
-- Tracks active and completed outings between two characters
CREATE TABLE IF NOT EXISTS outing_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT DEFAULT 'active',              -- active, wrapping_up, completed, abandoned
    participant_1 TEXT NOT NULL,                -- character name or "human:Name"
    participant_2 TEXT NOT NULL,
    activity TEXT,                              -- "Coffee at Midnight Roast", free-text or AI-suggested
    activity_type TEXT,                         -- coffee, walk, art, dinner, adventure, etc.
    current_scene INT DEFAULT 0,
    total_scenes INT DEFAULT 6,
    scene_started_at TIMESTAMPTZ,              -- when current scene began (for auto-advance timer)
    scene_narration TEXT,                       -- current scene's narrator text
    scene_image_url TEXT,                       -- current scene's generated image URL
    mood TEXT DEFAULT 'neutral',               -- overall outing mood: awkward, flirty, comfortable, tense, fun
    scene_duration_ms INT DEFAULT 300000,      -- ms per scene (300000=5min for 30min outing, 600000=10min for 60min)
    summary TEXT,                               -- AI-generated summary at end
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- Table: outing_messages
-- Chat messages during outings
CREATE TABLE IF NOT EXISTS outing_messages (
    id SERIAL PRIMARY KEY,
    session_id UUID REFERENCES outing_sessions(id) ON DELETE CASCADE,
    scene_number INT,
    speaker TEXT NOT NULL,                     -- character name, "human:Name", "Narrator", "System"
    message TEXT NOT NULL,
    message_type TEXT DEFAULT 'chat',          -- chat, emote, narrator, system, image
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_outing_sessions_status ON outing_sessions(status);
CREATE INDEX IF NOT EXISTS idx_outing_messages_session ON outing_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_outing_messages_created ON outing_messages(created_at);

-- Enable Row Level Security
ALTER TABLE outing_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outing_messages ENABLE ROW LEVEL SECURITY;

-- Policies for public read/write (matches corridor pattern)
CREATE POLICY "Allow public read outing_sessions" ON outing_sessions FOR SELECT USING (true);
CREATE POLICY "Allow public insert outing_sessions" ON outing_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update outing_sessions" ON outing_sessions FOR UPDATE USING (true);

CREATE POLICY "Allow public read outing_messages" ON outing_messages FOR SELECT USING (true);
CREATE POLICY "Allow public insert outing_messages" ON outing_messages FOR INSERT WITH CHECK (true);
