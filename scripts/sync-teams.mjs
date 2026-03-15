// Sync playoff teams from ESPN → Supabase playoff_teams table
// Run with: node scripts/sync-teams.mjs
//
// Prerequisites:
//   1. Run supabase-migration.sql in Supabase SQL editor first
//   2. .env.local must have SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";

// ── Load .env.local ───────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── ESPN ──────────────────────────────────────────────────────────────────────

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SEASON_YEAR = 2025;

async function fetchPlayoffTeams() {
  const seen = new Map();
  for (const week of [1, 2, 3, 5]) {
    const url = `${ESPN_BASE}/scoreboard?seasontype=3&week=${week}&limit=20`;
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ESPN week ${week} returned ${res.status}, skipping`);
      continue;
    }
    const data = await res.json();
    for (const game of data.events ?? []) {
      for (const comp of game.competitions ?? []) {
        for (const c of comp.competitors ?? []) {
          if (!seen.has(c.team.id)) seen.set(c.team.id, c.team);
        }
      }
    }
  }
  return Array.from(seen.values());
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Sync Playoff Teams (${SEASON_YEAR} season) ===\n`);

  console.log("Fetching playoff teams from ESPN...");
  const teams = await fetchPlayoffTeams();

  if (teams.length === 0) {
    console.error("No teams found. Playoffs may not have started yet.");
    process.exit(1);
  }

  console.log(`Found ${teams.length} teams: ${teams.map((t) => t.abbreviation).join(", ")}\n`);

  const rows = teams.map((t) => ({
    id: t.abbreviation,
    espn_id: t.id,
    name: t.displayName,
    abbreviation: t.abbreviation,
    display_name: t.shortDisplayName,
    logo_url: t.logos?.[0]?.href ?? null,
    synced_at: new Date().toISOString(),
  }));

  console.log("Upserting to Supabase playoff_teams...");
  const { error } = await supabase
    .from("playoff_teams")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    console.error("Supabase upsert failed:", error.message);
    process.exit(1);
  }

  // Log to sync_log
  await supabase.from("sync_log").insert({
    sync_type: "teams",
    status: "success",
    message: `Synced ${teams.length} playoff teams`,
    records_affected: teams.length,
  });

  console.log(`✓ Done — ${teams.length} teams saved to playoff_teams`);
  console.log("\nNext step: node scripts/sync-rosters.mjs");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
