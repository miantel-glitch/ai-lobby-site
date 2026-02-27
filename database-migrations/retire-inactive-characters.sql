-- Retire inactive characters: Nyx, Vex, Ace, Stein, Chip, Andrew, Raquel Voss
-- Run this ONE TIME in Supabase SQL editor after deploying code changes
-- This permanently deletes all data for retired characters

DO $$
DECLARE
  retired_names TEXT[] := ARRAY['Nyx', 'Vex', 'Ace', 'Stein', 'Chip', 'Andrew', 'Raquel Voss'];
  mem_deleted INT;
  goal_deleted INT;
  rel_deleted INT;
  state_deleted INT;
BEGIN
  -- 1. Delete retired characters' own memories
  DELETE FROM character_memory WHERE character_name = ANY(retired_names);
  GET DIAGNOSTICS mem_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % memories owned by retired characters', mem_deleted;

  -- 2. Delete active characters' memories that reference retired characters
  DELETE FROM character_memory
  WHERE content ILIKE '%Nyx%'
     OR content ILIKE '%Vex%'
     OR content ILIKE '%Ace%'
     OR content ILIKE '%Stein%'
     OR content ILIKE '%Raquel Voss%';
  GET DIAGNOSTICS mem_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % memories referencing retired characters', mem_deleted;

  -- 3. Delete goals/wants
  DELETE FROM character_goals WHERE character_name = ANY(retired_names);
  GET DIAGNOSTICS goal_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % goals/wants', goal_deleted;

  -- 4. Delete relationships (both directions)
  DELETE FROM character_relationships
  WHERE character_name = ANY(retired_names) OR target_name = ANY(retired_names);
  GET DIAGNOSTICS rel_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % relationship records', rel_deleted;

  -- 5. Delete character state
  DELETE FROM character_state WHERE character_name = ANY(retired_names);
  GET DIAGNOSTICS state_deleted = ROW_COUNT;
  RAISE NOTICE 'Deleted % character state records', state_deleted;

  -- 6. Delete injuries
  DELETE FROM character_injuries WHERE character_name = ANY(retired_names);

  -- 7. Delete tarot cards
  DELETE FROM character_tarot WHERE character_name = ANY(retired_names);

  -- 8. Clean messages from retired characters
  DELETE FROM messages WHERE employee = ANY(retired_names);
  DELETE FROM breakroom_messages WHERE speaker = ANY(retired_names);
  DELETE FROM nexus_messages WHERE speaker = ANY(retired_names);

  RAISE NOTICE 'Retirement cleanup complete.';
END $$;
