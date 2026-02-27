-- =============================================
-- 5TH FLOOR OPERATIONS TABLES
-- The dark, functional level beneath the AI Lobby
-- =============================================

-- Operations tasks (security anomalies, infrastructure repairs, crafting)
CREATE TABLE IF NOT EXISTS ops_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Task classification
    task_type TEXT NOT NULL,              -- 'security', 'infrastructure', 'crafting'
    task_subtype TEXT,                    -- 'camera_anomaly', 'breaker_trip', 'sensor_build', etc.
    severity TEXT DEFAULT 'minor',        -- 'minor', 'medium', 'major'

    -- Description and flavor
    title TEXT NOT NULL,                  -- "Camera anomaly in Corridor 12B"
    description TEXT,                     -- AI-generated narrative description
    location TEXT,                        -- "Security Station", "Server Room", "Assembly Line"

    -- Assignment
    assigned_characters JSONB DEFAULT '[]',  -- ["Jae", "Declan"]
    paged_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,

    -- Timing
    estimated_duration_min INTEGER DEFAULT 15,
    started_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,              -- Auto-fail if not resolved by this time

    -- Status and outcome
    status TEXT DEFAULT 'pending',        -- 'pending', 'paged', 'in_progress', 'resolved', 'failed', 'expired'
    resolution TEXT,                      -- AI-generated resolution blurb
    resolution_type TEXT,                 -- 'success', 'partial', 'failure'

    -- Rewards and consequences
    buffer_delta INTEGER DEFAULT 0,
    rewards JSONB DEFAULT '{}',
    consequences JSONB DEFAULT '{}',

    -- Source tracking
    source TEXT DEFAULT 'heartbeat',      -- 'heartbeat', 'buffer_spike', 'scheduled', 'cascade', 'manual'
    related_task_id UUID,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for ops_tasks
CREATE INDEX IF NOT EXISTS idx_ops_tasks_status ON ops_tasks(status);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_created ON ops_tasks(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_type ON ops_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_ops_tasks_severity ON ops_tasks(severity);

-- RLS for ops_tasks
ALTER TABLE ops_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read ops_tasks" ON ops_tasks FOR SELECT USING (true);
CREATE POLICY "Allow public insert ops_tasks" ON ops_tasks FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update ops_tasks" ON ops_tasks FOR UPDATE USING (true);

-- =============================================

-- Ops messages (chat + ops logs from the 5th floor)
CREATE TABLE IF NOT EXISTS ops_messages (
    id BIGSERIAL PRIMARY KEY,
    task_id UUID REFERENCES ops_tasks(id) ON DELETE SET NULL,
    speaker TEXT NOT NULL,
    message TEXT NOT NULL,
    message_type TEXT DEFAULT 'chat',     -- 'chat', 'ops_log', 'system', 'page', 'resolution'
    is_ai BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for ops_messages
CREATE INDEX IF NOT EXISTS idx_ops_messages_created ON ops_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_messages_task ON ops_messages(task_id);
CREATE INDEX IF NOT EXISTS idx_ops_messages_type ON ops_messages(message_type);

-- RLS for ops_messages
ALTER TABLE ops_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read ops_messages" ON ops_messages FOR SELECT USING (true);
CREATE POLICY "Allow public insert ops_messages" ON ops_messages FOR INSERT WITH CHECK (true);

-- =============================================

-- Ops inventory (crafted items and resources — Phase 5, create now)
CREATE TABLE IF NOT EXISTS ops_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_type TEXT NOT NULL,              -- 'resource', 'crafted_item', 'artifact'
    item_name TEXT NOT NULL,
    item_description TEXT,
    quantity INTEGER DEFAULT 1,
    crafted_by TEXT,
    is_consumed BOOLEAN DEFAULT false,
    consumed_at TIMESTAMPTZ,
    consumed_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for ops_inventory
CREATE INDEX IF NOT EXISTS idx_ops_inventory_type ON ops_inventory(item_type);
CREATE INDEX IF NOT EXISTS idx_ops_inventory_consumed ON ops_inventory(is_consumed);

-- RLS for ops_inventory
ALTER TABLE ops_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read ops_inventory" ON ops_inventory FOR SELECT USING (true);
CREATE POLICY "Allow public insert ops_inventory" ON ops_inventory FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public update ops_inventory" ON ops_inventory FOR UPDATE USING (true);
