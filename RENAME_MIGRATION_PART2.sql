-- =====================================================
-- RENAME MIGRATION PART 2 — Remaining tables
-- Tables 1-5 already completed successfully.
-- These use DO blocks to skip tables that don't exist.
-- =====================================================

-- 6. character_goals table
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'character_goals') THEN
    UPDATE character_goals SET character_name = 'Asuna' WHERE character_name = 'Courtney';
    UPDATE character_goals SET character_name = 'Vale' WHERE character_name = 'Jenna';
  END IF;
END $$;

-- 7. character_memories table
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'character_memories') THEN
    UPDATE character_memories SET character_name = 'Asuna' WHERE character_name = 'Courtney';
    UPDATE character_memories SET character_name = 'Vale' WHERE character_name = 'Jenna';
    UPDATE character_memories SET content = REPLACE(content, 'Courtney', 'Asuna') WHERE content LIKE '%Courtney%';
    UPDATE character_memories SET content = REPLACE(content, 'Jenna', 'Vale') WHERE content LIKE '%Jenna%';
  END IF;
END $$;

-- 8. lobby_settings table
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lobby_settings') THEN
    UPDATE lobby_settings SET value = REPLACE(value, 'Courtney', 'Asuna') WHERE value LIKE '%Courtney%';
    UPDATE lobby_settings SET value = REPLACE(value, 'Jenna', 'Vale') WHERE value LIKE '%Jenna%';
  END IF;
END $$;

-- 9. breakroom_messages table (column is 'speaker', not 'employee')
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'breakroom_messages') THEN
    UPDATE breakroom_messages SET speaker = 'Asuna' WHERE speaker = 'Courtney';
    UPDATE breakroom_messages SET speaker = 'Vale' WHERE speaker = 'Jenna';
  END IF;
END $$;

-- 10. narrator_tasks table
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'narrator_tasks') THEN
    UPDATE narrator_tasks SET assigned_to = 'Asuna' WHERE assigned_to = 'Courtney';
    UPDATE narrator_tasks SET assigned_to = 'Vale' WHERE assigned_to = 'Jenna';
  END IF;
END $$;

-- =====================================================
-- VERIFICATION — run these to confirm everything worked
-- =====================================================

-- Should return 0:
SELECT 'character_auth' as tbl, COUNT(*) as old_names FROM character_auth WHERE employee IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'messages', COUNT(*) FROM messages WHERE employee IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'relationships_char', COUNT(*) FROM character_relationships WHERE character_name IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'relationships_target', COUNT(*) FROM character_relationships WHERE target_name IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'character_state', COUNT(*) FROM character_state WHERE character_name IN ('Courtney', 'Jenna');
