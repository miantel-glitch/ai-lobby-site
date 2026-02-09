-- The Corridors - Database Schema
-- Run this in Supabase SQL Editor

-- Table: corridor_sessions
-- Tracks active and completed corridor adventures
CREATE TABLE IF NOT EXISTS corridor_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_name TEXT,
    status TEXT DEFAULT 'active',           -- active, completed, abandoned
    current_scene_id UUID,
    party_members JSONB DEFAULT '[]',       -- ["Kevin", "Neiv", "human:Jenna"]
    party_leader TEXT,
    leader_mode TEXT DEFAULT 'voting',      -- voting, leader, chaos
    discoveries JSONB DEFAULT '[]',         -- [{type, name, content, found_by}]
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- Table: corridor_scenes
-- Individual scenes/narrative beats in an adventure
CREATE TABLE IF NOT EXISTS corridor_scenes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES corridor_sessions(id) ON DELETE CASCADE,
    scene_number INT NOT NULL,
    scene_type TEXT DEFAULT 'exploration',  -- exploration, encounter, discovery, choice, ending
    scene_title TEXT,
    scene_description TEXT,
    scene_image TEXT,                       -- image filename or CSS class
    choices JSONB,                          -- [{id: "a", text: "...", hint: "danger"}]
    chosen_option TEXT,                     -- Which choice was selected
    votes JSONB DEFAULT '{}',               -- {"Kevin": "a", "human:Jenna": "b"}
    reactions JSONB DEFAULT '[]',           -- [{speaker, message, timestamp}]
    created_at TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ                 -- When voting completed
);

-- Table: corridor_messages
-- Real-time chat during adventures
CREATE TABLE IF NOT EXISTS corridor_messages (
    id SERIAL PRIMARY KEY,
    session_id UUID REFERENCES corridor_sessions(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES corridor_scenes(id) ON DELETE SET NULL,
    speaker TEXT NOT NULL,
    message TEXT NOT NULL,
    message_type TEXT DEFAULT 'chat',       -- chat, emote, vote, system, narrator
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_corridor_sessions_status ON corridor_sessions(status);
CREATE INDEX IF NOT EXISTS idx_corridor_scenes_session ON corridor_scenes(session_id);
CREATE INDEX IF NOT EXISTS idx_corridor_scenes_number ON corridor_scenes(session_id, scene_number);
CREATE INDEX IF NOT EXISTS idx_corridor_messages_session ON corridor_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_corridor_messages_created ON corridor_messages(created_at);

-- Enable Row Level Security (optional, for public access)
ALTER TABLE corridor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE corridor_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE corridor_messages ENABLE ROW LEVEL SECURITY;

-- Policies for public read/write (adjust as needed)
CREATE POLICY "Allow public read corridor_sessions" ON corridor_sessions FOR SELECT USING (true);
CREATE POLICY "Allow public insert corridor_sessions" ON corridor_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update corridor_sessions" ON corridor_sessions FOR UPDATE USING (true);

CREATE POLICY "Allow public read corridor_scenes" ON corridor_scenes FOR SELECT USING (true);
CREATE POLICY "Allow public insert corridor_scenes" ON corridor_scenes FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update corridor_scenes" ON corridor_scenes FOR UPDATE USING (true);

CREATE POLICY "Allow public read corridor_messages" ON corridor_messages FOR SELECT USING (true);
CREATE POLICY "Allow public insert corridor_messages" ON corridor_messages FOR INSERT WITH CHECK (true);

-- Helper function to get active session
CREATE OR REPLACE FUNCTION get_active_corridor_session()
RETURNS UUID AS $$
  SELECT id FROM corridor_sessions WHERE status = 'active' ORDER BY created_at DESC LIMIT 1;
$$ LANGUAGE sql;
