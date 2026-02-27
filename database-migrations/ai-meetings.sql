-- AI-Hosted Meetings: Database changes
-- Run this in the Supabase SQL editor

-- 1. New table: scheduled_meetings
CREATE TABLE IF NOT EXISTS scheduled_meetings (
  id SERIAL PRIMARY KEY,
  host TEXT NOT NULL,
  host_is_ai BOOLEAN DEFAULT true,
  topic TEXT NOT NULL,
  agenda TEXT,
  invited_attendees JSONB DEFAULT '[]',
  scheduled_time TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'scheduled',
  meeting_session_id INTEGER,
  announced BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Add new columns to meeting_sessions
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS host_is_ai BOOLEAN DEFAULT false;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS last_host_prompt_at TIMESTAMPTZ;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS host_prompt_count INTEGER DEFAULT 0;
ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS human_participants JSONB DEFAULT '[]';
