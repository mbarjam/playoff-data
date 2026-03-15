// Sync player rosters from ESPN depth charts → Supabase players table
// Run with: node scripts/sync-rosters.mjs
//
// Prerequisites:
//   1. Run supabase-migration.sql in Supabase SQL editor first
//   2. Run sync-teams.mjs first (needs playoff_teams populated)

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
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const SEASON_YEAR = 2025;

// Positions to pull from depth chart: position → max starters to keep
const TARGET_POSITIONS = { QB: 1, RB: 2, WR: 2, TE: 2, K: 1 };

function generatePlayerId(fullName, teamAbbr) {
  const slug = fullName
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${teamAbbr.toUpperCase()}`;
}

async function fetchTeamRoster(espnTeamId) {
  const url = `${ESPN_BASE}/teams/${espnTeamId}/roster`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN roster for team ${espnTeamId}: ${res.status}`);
  const data = await res.json();
  const athletes = [];
  for (const group of data.athletes ?? []) {
    athletes.push(...(group.items ?? []));
  }
  return athletes;
}

async function fetchDepthChart(espnTeamId) {
  const url = `${ESPN_CORE}/seasons/${SEASON_YEAR}/teams/${espnTeamId}/depthcharts`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`    [depth chart unavailable for ESPN ID ${espnTeamId}: ${res.status}]`);
    return new Map();
  }
  const data = await res.json();
  const result = new Map();
  for (const item of data.items ?? []) {
    for (const [, posData] of Object.entries(item.positions ?? {})) {
      const abbr = posData.position.abbreviation.toUpperCase();
      const ordered = posData.athletes
        .sort((a, b) => a.slot - b.slot)
        .map((e) => {
          const match = e.athlete.$ref.match(/athletes\/(\d+)/);
          return match ? match[1] : "";
        })
        .filter(Boolean);
      result.set(abbr, ordered);
    }
  }
  return result;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Sync Player Rosters (${SEASON_YEAR} season) ===\n`);

  // Load teams from Supabase
  const { data: teams, error: teamsError } = await supabase
    .from("playoff_teams")
    .select("*");

  if (teamsError) {
    console.error("Failed to load playoff_teams:", teamsError.message);
    console.error("Have you run sync-teams.mjs and the Supabase migration?");
    process.exit(1);
  }

  if (!teams || teams.length === 0) {
    console.error("No teams in playoff_teams table. Run sync-teams.mjs first.");
    process.exit(1);
  }

  console.log(`Loaded ${teams.length} teams from Supabase\n`);

  const playerRows = [];
  let failedTeams = 0;

  for (const team of teams) {
    console.log(`── ${team.name} (${team.abbreviation})`);

    try {
      const [roster, depthChart] = await Promise.all([
        fetchTeamRoster(team.espn_id),
        fetchDepthChart(team.espn_id),
      ]);

      const rosterById = new Map(roster.map((a) => [a.id, a]));

      for (const [position, maxCount] of Object.entries(TARGET_POSITIONS)) {
        // ESPN uses "PK" for kickers in depth charts/rosters; we store as "K"
        const espnPos = position === "K" ? "PK" : position;
        const depthIds = depthChart.get(espnPos) ?? depthChart.get(position) ?? [];

        const candidates =
          depthIds.length > 0
            ? depthIds.map((id) => rosterById.get(id)).filter(Boolean)
            : roster.filter((a) => {
                const abbr = a.position?.abbreviation?.toUpperCase();
                return abbr === espnPos || abbr === position;
              });

        const picks = candidates.slice(0, maxCount);

        for (const athlete of picks) {
          if (!athlete) continue;
          const name = athlete.fullName || athlete.displayName;
          const id = generatePlayerId(name, team.abbreviation);
          console.log(`  ${position.padEnd(3)} ${name}`);
          playerRows.push({
            id,
            name,
            team: team.abbreviation,
            position,
            espn_id: athlete.id,
          });
        }
      }

      // DEF/ST — auto-generated, no ESPN lookup
      const defId = generatePlayerId(team.name, team.abbreviation) + "-DEF";
      console.log(`  DEF ${team.name}`);
      playerRows.push({
        id: defId,
        name: team.name,
        team: team.abbreviation,
        position: "DEF",
        espn_id: null,
      });
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      failedTeams++;
    }

    console.log();
  }

  if (playerRows.length === 0) {
    console.error("No players collected. Check ESPN API errors above.");
    process.exit(1);
  }

  console.log(`Upserting ${playerRows.length} players to Supabase...`);
  const { error: upsertError } = await supabase
    .from("players")
    .upsert(playerRows, { onConflict: "id" });

  if (upsertError) {
    console.error("Supabase upsert failed:", upsertError.message);
    process.exit(1);
  }

  // Log to sync_log
  await supabase.from("sync_log").insert({
    sync_type: "rosters",
    status: failedTeams > 0 ? "error" : "success",
    message: `Synced ${playerRows.length} players across ${teams.length - failedTeams}/${teams.length} teams`,
    records_affected: playerRows.length,
  });

  console.log(`\n✓ Done — ${playerRows.length} players saved`);
  if (failedTeams > 0) console.warn(`⚠ ${failedTeams} team(s) had errors (see above)`);

  // Summary by position
  const byPos = {};
  for (const p of playerRows) byPos[p.position] = (byPos[p.position] ?? 0) + 1;
  console.log("\nBreakdown:");
  for (const [pos, count] of Object.entries(byPos)) {
    console.log(`  ${pos.padEnd(4)} ${count}`);
  }

  console.log("\nNext step: node scripts/sync-stats.mjs --week 1");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
