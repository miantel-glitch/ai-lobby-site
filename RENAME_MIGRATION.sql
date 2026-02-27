-- =====================================================
-- CHARACTER RENAME MIGRATION
-- Courtney → Asuna, Jenna → Vale
-- Run this in Supabase SQL Editor AFTER deploying code
-- =====================================================

-- 1. character_auth table (login credentials)
UPDATE character_auth SET employee = 'Asuna' WHERE employee = 'Courtney';
UPDATE character_auth SET employee = 'Vale' WHERE employee = 'Jenna';

-- 2. messages table (chat history)
UPDATE messages SET employee = 'Asuna' WHERE employee = 'Courtney';
UPDATE messages SET employee = 'Vale' WHERE employee = 'Jenna';

-- 3. character_relationships table (both directions)
UPDATE character_relationships SET character_name = 'Asuna' WHERE character_name = 'Courtney';
UPDATE character_relationships SET target_name = 'Asuna' WHERE target_name = 'Courtney';
UPDATE character_relationships SET character_name = 'Vale' WHERE character_name = 'Jenna';
UPDATE character_relationships SET target_name = 'Vale' WHERE target_name = 'Jenna';

-- 4. character_state table
UPDATE character_state SET character_name = 'Asuna' WHERE character_name = 'Courtney';
UPDATE character_state SET character_name = 'Vale' WHERE character_name = 'Jenna';

-- 5. character_traits table (if exists)
UPDATE character_traits SET character_name = 'Asuna' WHERE character_name = 'Courtney';
UPDATE character_traits SET character_name = 'Vale' WHERE character_name = 'Jenna';

-- 6. character_goals table (if exists)
UPDATE character_goals SET character_name = 'Asuna' WHERE character_name = 'Courtney';
UPDATE character_goals SET character_name = 'Vale' WHERE character_name = 'Jenna';

-- 7. character_memories table (name column + content text)
UPDATE character_memories SET character_name = 'Asuna' WHERE character_name = 'Courtney';
UPDATE character_memories SET character_name = 'Vale' WHERE character_name = 'Jenna';
UPDATE character_memories SET content = REPLACE(content, 'Courtney', 'Asuna') WHERE content LIKE '%Courtney%';
UPDATE character_memories SET content = REPLACE(content, 'Jenna', 'Vale') WHERE content LIKE '%Jenna%';

-- 8. lobby_settings table (if has character references in values)
UPDATE lobby_settings SET value = REPLACE(value, 'Courtney', 'Asuna') WHERE value LIKE '%Courtney%';
UPDATE lobby_settings SET value = REPLACE(value, 'Jenna', 'Vale') WHERE value LIKE '%Jenna%';

-- 9. breakroom_messages table (if exists separately)
UPDATE breakroom_messages SET employee = 'Asuna' WHERE employee = 'Courtney';
UPDATE breakroom_messages SET employee = 'Vale' WHERE employee = 'Jenna';

-- 10. narrator_tasks table (if exists)
UPDATE narrator_tasks SET assigned_to = 'Asuna' WHERE assigned_to = 'Courtney';
UPDATE narrator_tasks SET assigned_to = 'Vale' WHERE assigned_to = 'Jenna';

-- =====================================================
-- VERIFICATION QUERIES (run after migration)
-- =====================================================

-- Should return 0 rows each:
-- SELECT * FROM character_auth WHERE employee IN ('Courtney', 'Jenna');
-- SELECT * FROM messages WHERE employee IN ('Courtney', 'Jenna');
-- SELECT * FROM character_relationships WHERE character_name IN ('Courtney', 'Jenna') OR target_name IN ('Courtney', 'Jenna');
-- SELECT * FROM character_state WHERE character_name IN ('Courtney', 'Jenna');

-- Should return rows:
-- SELECT * FROM character_auth WHERE employee IN ('Asuna', 'Vale');
-- SELECT * FROM messages WHERE employee IN ('Asuna', 'Vale') LIMIT 5;
