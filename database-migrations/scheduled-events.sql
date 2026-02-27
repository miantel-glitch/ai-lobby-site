-- Scheduled Events table
-- Stores events that fire at a future time via the office-heartbeat checker
-- Follows the same pattern as scheduled_meetings

CREATE TABLE IF NOT EXISTS scheduled_events (
  id SERIAL PRIMARY KEY,
  description TEXT NOT NULL,                    -- The narrator text to post
  event_type TEXT DEFAULT 'custom',             -- 'custom' or predefined: 'glitter_incident', 'chaos', etc.
  scheduled_time TIMESTAMPTZ NOT NULL,          -- When the event should fire
  status TEXT DEFAULT 'scheduled',              -- 'scheduled', 'firing', 'fired', 'cancelled'
  use_ai_description BOOLEAN DEFAULT false,     -- Generate creative AI description at fire-time
  created_at TIMESTAMPTZ DEFAULT now(),
  fired_at TIMESTAMPTZ                          -- When it actually fired
);

-- Index for the polling query (office-heartbeat checks every 15 min)
CREATE INDEX IF NOT EXISTS idx_scheduled_events_status_time
  ON scheduled_events(status, scheduled_time);
