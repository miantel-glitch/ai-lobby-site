-- =====================================================
-- RENAME VERIFICATION: Check if Courtney→Asuna and Jenna→Vale completed
-- Run this in Supabase SQL Editor
-- =====================================================

-- ===== OLD NAMES (should all be 0) =====
SELECT '❌ OLD NAMES REMAINING' as section;

SELECT 'character_auth' as table_name, COUNT(*) as old_refs
  FROM character_auth WHERE employee IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'messages', COUNT(*)
  FROM messages WHERE employee IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'character_relationships (as character)', COUNT(*)
  FROM character_relationships WHERE character_name IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'character_relationships (as target)', COUNT(*)
  FROM character_relationships WHERE target_name IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'character_state', COUNT(*)
  FROM character_state WHERE character_name IN ('Courtney', 'Jenna')
UNION ALL
SELECT 'breakroom_messages', COUNT(*)
  FROM breakroom_messages WHERE speaker IN ('Courtney', 'Jenna');

-- ===== NEW NAMES (should be > 0 for tables that had data) =====
SELECT '✅ NEW NAMES PRESENT' as section;

SELECT 'character_auth' as table_name, COUNT(*) as new_refs
  FROM character_auth WHERE employee IN ('Asuna', 'Vale')
UNION ALL
SELECT 'messages', COUNT(*)
  FROM messages WHERE employee IN ('Asuna', 'Vale')
UNION ALL
SELECT 'character_relationships (as character)', COUNT(*)
  FROM character_relationships WHERE character_name IN ('Asuna', 'Vale')
UNION ALL
SELECT 'character_relationships (as target)', COUNT(*)
  FROM character_relationships WHERE target_name IN ('Asuna', 'Vale')
UNION ALL
SELECT 'character_state', COUNT(*)
  FROM character_state WHERE character_name IN ('Asuna', 'Vale')
UNION ALL
SELECT 'breakroom_messages', COUNT(*)
  FROM breakroom_messages WHERE speaker IN ('Asuna', 'Vale');

-- ===== CHECK OPTIONAL TABLES EXIST =====
SELECT '📋 TABLE EXISTS CHECK' as section;

SELECT table_name, 'EXISTS' as status
  FROM information_schema.tables
  WHERE table_schema = 'public'
  AND table_name IN (
    'character_auth', 'messages', 'character_relationships',
    'character_state', 'character_traits', 'character_goals',
    'character_memories', 'breakroom_messages', 'narrator_tasks',
    'lobby_settings'
  )
  ORDER BY table_name;

-- ===== SPOT CHECK: Show actual auth rows =====
SELECT '🔑 AUTH TABLE (should show Asuna & Vale)' as section;
SELECT employee FROM character_auth ORDER BY employee;
