-- ============================================================
-- playoff-data migration
-- Run this in the Supabase SQL editor for the playoff-challenge
-- Supabase project before using the playoff-data app.
-- ============================================================

-- 1. Add espn_id column to existing players table
--    (used to match ESPN athlete IDs during stats sync)
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS espn_id text;

-- 2. playoff_teams — teams that made the NFL playoffs
CREATE TABLE IF NOT EXISTS public.playoff_teams (
  id            text PRIMARY KEY,          -- team abbreviation e.g. "KC"
  espn_id       text NOT NULL,             -- ESPN numeric team ID e.g. "12"
  name          text NOT NULL,             -- "Kansas City Chiefs"
  abbreviation  text NOT NULL,             -- "KC"
  display_name  text NOT NULL,             -- "Chiefs"
  logo_url      text,
  conference    text,                      -- "AFC" | "NFC"
  seed          int,                       -- 1–7
  synced_at     timestamptz DEFAULT now() NOT NULL
);

-- 3. sync_log — audit trail of all sync operations
CREATE TABLE IF NOT EXISTS public.sync_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_type         text NOT NULL,          -- "teams" | "rosters" | "stats"
  status            text NOT NULL,          -- "running" | "success" | "error"
  message           text,                   -- details or error message
  week              int,                    -- 1–4 for stats syncs
  records_affected  int,
  created_at        timestamptz DEFAULT now() NOT NULL
);

-- 4. sync_schedule — admin-controlled sync settings (singleton row, id = 1)
CREATE TABLE IF NOT EXISTS public.sync_schedule (
  id                    int PRIMARY KEY DEFAULT 1,
  stats_sync_enabled    boolean NOT NULL DEFAULT false,
  stats_sync_cron       text NOT NULL DEFAULT '0 12 * * 2',  -- Tuesdays noon UTC
  stats_current_week    int NOT NULL DEFAULT 1,              -- 1=WC 2=Div 3=Conf 4=SB
  updated_at            timestamptz DEFAULT now() NOT NULL
);

-- Seed the singleton row
INSERT INTO public.sync_schedule (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- 5. Enable Row Level Security on new tables
ALTER TABLE public.playoff_teams  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_schedule  ENABLE ROW LEVEL SECURITY;

-- 6. RLS policies — service role bypasses RLS automatically.
--    Allow authenticated users to read (for the admin UI to display data).
--    Writes go through the service role key in the API functions.

CREATE POLICY "Allow authenticated read playoff_teams"
  ON public.playoff_teams FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Allow authenticated read sync_log"
  ON public.sync_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Allow authenticated read sync_schedule"
  ON public.sync_schedule FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Allow authenticated update sync_schedule"
  ON public.sync_schedule FOR UPDATE
  TO authenticated USING (true);

-- Done.
