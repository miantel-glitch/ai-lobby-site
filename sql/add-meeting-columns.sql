-- Add missing meeting mode columns to conference_state table
-- Run this in your Supabase SQL Editor

-- Add mode column (interview or meeting)
ALTER TABLE conference_state
ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'interview';

-- Add meeting_active column
ALTER TABLE conference_state
ADD COLUMN IF NOT EXISTS meeting_active BOOLEAN DEFAULT false;

-- Add meeting_topic column
ALTER TABLE conference_state
ADD COLUMN IF NOT EXISTS meeting_topic TEXT;

-- Add facilitator column
ALTER TABLE conference_state
ADD COLUMN IF NOT EXISTS facilitator TEXT;

-- Add meeting_attendees column (JSON array)
ALTER TABLE conference_state
ADD COLUMN IF NOT EXISTS meeting_attendees JSONB DEFAULT '[]'::jsonb;

-- Verify the columns were added
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'conference_state';
