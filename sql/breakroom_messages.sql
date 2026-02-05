-- Breakroom Messages Table
-- Stores all messages from the breakroom chat (both humans and AIs)
-- Used for session persistence so people joining see the conversation history

CREATE TABLE IF NOT EXISTS breakroom_messages (
  id BIGSERIAL PRIMARY KEY,
  speaker TEXT NOT NULL,
  message TEXT NOT NULL,
  is_ai BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient time-based queries (newest first)
CREATE INDEX IF NOT EXISTS idx_breakroom_messages_created_at
ON breakroom_messages(created_at DESC);

-- Index for speaker lookups
CREATE INDEX IF NOT EXISTS idx_breakroom_messages_speaker
ON breakroom_messages(speaker);

-- Enable Row Level Security
ALTER TABLE breakroom_messages ENABLE ROW LEVEL SECURITY;

-- Allow public read access (anyone can see breakroom chat)
CREATE POLICY "Allow public read access" ON breakroom_messages
  FOR SELECT USING (true);

-- Allow public insert access (anyone can post to breakroom)
CREATE POLICY "Allow public insert access" ON breakroom_messages
  FOR INSERT WITH CHECK (true);

-- Optional: Auto-cleanup old messages (keep last 7 days)
-- Uncomment if you want automatic cleanup
-- CREATE OR REPLACE FUNCTION cleanup_old_breakroom_messages()
-- RETURNS void AS $$
-- BEGIN
--   DELETE FROM breakroom_messages
--   WHERE created_at < NOW() - INTERVAL '7 days';
-- END;
-- $$ LANGUAGE plpgsql;
