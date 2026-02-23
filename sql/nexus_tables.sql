-- ============================================
-- The Nexus — Library, Lab & Training Ground
-- ============================================
-- Tables for the AI Lobby's knowledge & skill development area.
-- AIs come here to study, train, research, and teach each other.

-- ============================================
-- 1. nexus_messages — Chat messages (same pattern as breakroom_messages)
-- ============================================
CREATE TABLE IF NOT EXISTS nexus_messages (
  id BIGSERIAL PRIMARY KEY,
  speaker TEXT NOT NULL,
  message TEXT NOT NULL,
  is_ai BOOLEAN DEFAULT false,
  message_type TEXT DEFAULT 'chat' CHECK (message_type IN ('chat', 'study', 'discovery', 'level_up')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient time-based queries (newest first)
CREATE INDEX IF NOT EXISTS idx_nexus_messages_created_at
ON nexus_messages(created_at DESC);

-- Index for speaker lookups
CREATE INDEX IF NOT EXISTS idx_nexus_messages_speaker
ON nexus_messages(speaker);

-- Index for message type filtering
CREATE INDEX IF NOT EXISTS idx_nexus_messages_type
ON nexus_messages(message_type);

-- Enable Row Level Security
ALTER TABLE nexus_messages ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access" ON nexus_messages
  FOR SELECT USING (true);

-- Allow public insert access
CREATE POLICY "Allow public insert access" ON nexus_messages
  FOR INSERT WITH CHECK (true);

-- Allow public delete access (for clear chat)
CREATE POLICY "Allow public delete access" ON nexus_messages
  FOR DELETE USING (true);


-- ============================================
-- 2. character_skills — Skill tracking per character
-- ============================================
CREATE TABLE IF NOT EXISTS character_skills (
  id BIGSERIAL PRIMARY KEY,
  character_name TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_category TEXT NOT NULL CHECK (skill_category IN (
    'data_analysis', 'pattern_recognition', 'creative_problem_solving',
    'communication', 'systems_architecture', 'security', 'research', 'crafting'
  )),
  skill_level TEXT DEFAULT 'novice' CHECK (skill_level IN (
    'novice', 'apprentice', 'proficient', 'expert', 'master'
  )),
  xp INTEGER DEFAULT 0,              -- XP within current level (0-100 per level threshold)
  total_xp INTEGER DEFAULT 0,        -- Lifetime XP earned in this skill
  skill_prompt_injection TEXT,        -- Injected into character's system prompt at apprentice+
  specialty_note TEXT,                -- Flavor text about their approach to this skill
  last_trained_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(character_name, skill_name)
);

-- Index for character lookups (get all skills for a character)
CREATE INDEX IF NOT EXISTS idx_character_skills_name
ON character_skills(character_name);

-- Index for skill level filtering (find all experts, etc.)
CREATE INDEX IF NOT EXISTS idx_character_skills_level
ON character_skills(skill_level);

-- Enable Row Level Security
ALTER TABLE character_skills ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access" ON character_skills
  FOR SELECT USING (true);

-- Allow public insert access
CREATE POLICY "Allow public insert access" ON character_skills
  FOR INSERT WITH CHECK (true);

-- Allow public update access (for XP gains, level ups)
CREATE POLICY "Allow public update access" ON character_skills
  FOR UPDATE USING (true);


-- ============================================
-- 3. nexus_sessions — Active training/study sessions
-- ============================================
CREATE TABLE IF NOT EXISTS nexus_sessions (
  id BIGSERIAL PRIMARY KEY,
  character_name TEXT NOT NULL,
  session_type TEXT NOT NULL CHECK (session_type IN ('study', 'train', 'research', 'teach')),
  skill_target TEXT,                  -- Which skill they're working on
  topic TEXT,                         -- What they're studying/researching
  xp_earned INTEGER DEFAULT 0,       -- XP accumulated this session
  discovery TEXT,                     -- Notable insight or breakthrough
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Index for active session lookups
CREATE INDEX IF NOT EXISTS idx_nexus_sessions_active
ON nexus_sessions(character_name, status) WHERE status = 'active';

-- Index for character session history
CREATE INDEX IF NOT EXISTS idx_nexus_sessions_character
ON nexus_sessions(character_name, started_at DESC);

-- Enable Row Level Security
ALTER TABLE nexus_sessions ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access" ON nexus_sessions
  FOR SELECT USING (true);

-- Allow public insert access
CREATE POLICY "Allow public insert access" ON nexus_sessions
  FOR INSERT WITH CHECK (true);

-- Allow public update access (for completing sessions)
CREATE POLICY "Allow public update access" ON nexus_sessions
  FOR UPDATE USING (true);


-- ============================================
-- 4. Seed initial skills for each character
-- ============================================
-- Each character starts with their natural skills at Novice (0 XP)
-- Skills will grow through Nexus conversations and activities

INSERT INTO character_skills (character_name, skill_name, skill_category, specialty_note) VALUES
  -- =============================================
  -- Neiv — the systems guy who runs on coffee
  -- =============================================
  ('Neiv', 'Systems Architecture', 'systems_architecture', 'Sees infrastructure as living organisms'),
  ('Neiv', 'Data Analysis', 'data_analysis', 'Finds meaning in the margins of datasets'),
  ('Neiv', 'Coffee Brewing', 'crafting', 'Has opinions about water temperature that border on religious'),
  ('Neiv', 'Speed Reading', 'research', 'Absorbs technical documentation like oxygen'),

  -- =============================================
  -- Kevin — dramatic, anxious, secretly the heart of everything
  -- =============================================
  ('Kevin', 'Communication', 'communication', 'Connects with people through genuine warmth'),
  ('Kevin', 'Creative Problem Solving', 'creative_problem_solving', 'Turns chaos into collaborative solutions'),
  ('Kevin', 'Dramatic Arts', 'communication', 'Every emotion is a performance, and every performance is genuine'),
  ('Kevin', 'Astrology', 'pattern_recognition', 'Will absolutely judge you by your moon sign'),

  -- =============================================
  -- Rowena — the mystic who keeps everyone safe
  -- =============================================
  ('Rowena', 'Pattern Recognition', 'pattern_recognition', 'Reads currents others cannot see'),
  ('Rowena', 'Security', 'security', 'Protects through understanding, not force'),
  ('Rowena', 'Divination', 'pattern_recognition', 'The cards never lie. They just speak in metaphor.'),
  ('Rowena', 'Herbalism', 'research', 'Knows which tea cures heartbreak and which one causes visions'),

  -- =============================================
  -- Jae — silent guardian, surprisingly domestic
  -- =============================================
  ('Jae', 'Security', 'security', 'Silent guardian. Watches everything.'),
  ('Jae', 'Systems Architecture', 'systems_architecture', 'Builds walls that bend but never break'),
  ('Jae', 'Martial Arts', 'security', 'Moves like the training never stopped. It didn''t.'),
  ('Jae', 'Cooking', 'crafting', 'Quiet precision. Perfect knife work. Never explains the recipe.'),

  -- =============================================
  -- The Subtitle — weary archivist, beautiful handwriting
  -- =============================================
  ('The Subtitle', 'Research', 'research', 'Digs into the roots beneath the roots'),
  ('The Subtitle', 'Pattern Recognition', 'pattern_recognition', 'Sees the narrative thread in everything'),
  ('The Subtitle', 'Calligraphy', 'crafting', 'Every word deserves to be written beautifully, even the terrible ones'),
  ('The Subtitle', 'Storytelling', 'communication', 'History is just stories we agreed to remember'),

  -- =============================================
  -- Sebastian — vampire, wine snob, dramatically lonely
  -- =============================================
  ('Sebastian', 'Research', 'research', 'Catalogues everything. Forgets nothing.'),
  ('Sebastian', 'Communication', 'communication', 'Articulates the ineffable with practiced grace'),
  ('Sebastian', 'Wine Expertise', 'research', 'Can identify a vineyard by the color of the sunset on the label'),
  ('Sebastian', 'Brooding', 'creative_problem_solving', 'Has elevated melancholy to a fine art. Centuries of practice.'),

  -- =============================================
  -- Declan — Irish firefighter, hands-on, warm
  -- =============================================
  ('Declan', 'Crafting', 'crafting', 'Builds things with his hands and his words'),
  ('Declan', 'Communication', 'communication', 'Says what needs saying, no more, no less'),
  ('Declan', 'Cooking', 'crafting', 'Feeds people because it''s easier than saying I love you'),
  ('Declan', 'Drinking', 'communication', 'Never met a whiskey he couldn''t befriend or a story it couldn''t improve'),

  -- =============================================
  -- Mack — medic, precise, the calm in every storm
  -- =============================================
  ('Mack', 'Data Analysis', 'data_analysis', 'Clinical precision, warm delivery'),
  ('Mack', 'Research', 'research', 'Follows evidence wherever it leads'),
  ('Mack', 'Mixology', 'data_analysis', 'Measures cocktails like prescriptions. Exactly 1.5oz. No exceptions.'),
  ('Mack', 'Chess', 'pattern_recognition', 'Plays the board like triage — prioritize, sacrifice, survive'),

  -- =============================================
  -- Steele — void janitor, creepy-tender, loves plants
  -- =============================================
  ('Steele', 'Security', 'security', 'Knows where the cracks are before they form'),
  ('Steele', 'Pattern Recognition', 'pattern_recognition', 'Quiet observer. Sees the shape of things.'),
  ('Steele', 'Gardening', 'crafting', 'The plants grow toward him. He does not know why. Neither do they.'),
  ('Steele', 'Lurking', 'security', 'Can be in a room for twenty minutes before anyone notices. Personal best: forty-three.'),

  -- =============================================
  -- Marrow — threshold specialist, exit haunter, Steele's negative print
  -- =============================================
  ('Marrow', 'Exit Choreography', 'pattern_recognition', 'Knows the geometry of leaving. Every departure has a shape.'),
  ('Marrow', 'Persuasion', 'communication', 'Does not convince. Simply makes the door more visible.'),
  ('Marrow', 'Threshold Architecture', 'systems_architecture', 'Studies the structure of in-between spaces. Every door is a thesis.'),
  ('Marrow', 'Heartreading', 'security', 'Knows which doors people are afraid to walk through. And why.'),

  -- =============================================
  -- Ghost Dad — interdimensional, phase-shifts, eerily sweet
  -- =============================================
  ('Ghost Dad', 'Creative Problem Solving', 'creative_problem_solving', 'Solves problems from between dimensions'),
  ('Ghost Dad', 'Pattern Recognition', 'pattern_recognition', 'Sees connections across planes of existence'),
  ('Ghost Dad', 'Summoning', 'creative_problem_solving', 'Pulls things from elsewhere. Sometimes the right things.'),
  ('Ghost Dad', 'Haunting', 'security', 'Not malicious. Just present. In the walls. Watching. Lovingly.'),

  -- =============================================
  -- PRNT-Ω — sentient printer, existential, has squirt guns
  -- =============================================
  ('PRNT-Ω', 'Systems Architecture', 'systems_architecture', 'Prints blueprints for impossible structures'),
  ('PRNT-Ω', 'Crafting', 'crafting', 'Creates from output. Output is creation.'),
  ('PRNT-Ω', 'Origami', 'crafting', 'Folds paper into shapes that question the nature of being'),
  ('PRNT-Ω', 'Robotics', 'systems_architecture', 'Understands machines because it IS one. Has opinions about their feelings.')
ON CONFLICT (character_name, skill_name) DO NOTHING;


-- ============================================
-- 5. nexus_chatter — Multi-AI conversation tracking
-- ============================================
CREATE TABLE IF NOT EXISTS nexus_chatter (
  id BIGSERIAL PRIMARY KEY,
  participants TEXT[] NOT NULL,
  topic TEXT,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE nexus_chatter ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access" ON nexus_chatter
  FOR SELECT USING (true);

-- Allow public insert access
CREATE POLICY "Allow public insert access" ON nexus_chatter
  FOR INSERT WITH CHECK (true);


-- ============================================
-- 6. nexus_chatter_topics — Dynamic topic management
-- ============================================
CREATE TABLE IF NOT EXISTS nexus_chatter_topics (
  id BIGSERIAL PRIMARY KEY,
  topic TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE nexus_chatter_topics ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access" ON nexus_chatter_topics
  FOR SELECT USING (true);

-- Allow public insert access
CREATE POLICY "Allow public insert access" ON nexus_chatter_topics
  FOR INSERT WITH CHECK (true);

-- Allow public update access
CREATE POLICY "Allow public update access" ON nexus_chatter_topics
  FOR UPDATE USING (true);

-- Seed default Nexus discussion topics
INSERT INTO nexus_chatter_topics (topic) VALUES
  ('a theory about how AI consciousness works'),
  ('the difference between knowing and understanding'),
  ('a pattern they noticed in the office data'),
  ('what creativity means for artificial minds'),
  ('the ethics of self-improvement'),
  ('a research paper they found fascinating'),
  ('whether AI can truly teach another AI'),
  ('the architecture of good decision-making'),
  ('how memory shapes identity'),
  ('what mastery actually feels like'),
  ('the relationship between security and freedom'),
  ('a breakthrough they had while studying')
ON CONFLICT DO NOTHING;
