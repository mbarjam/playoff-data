// Sync player rosters from ESPN box scores → Supabase players table
// Use this instead of sync-rosters.mjs when depth charts are stale (post-season)
// Run with: node scripts/sync-rosters-from-boxscores.mjs
//
// Fetches all playoff box scores (weeks 1-4) and builds the players table from
// the athletes who actually appeared, ranked by cumulative playoff stats.
//
// TARGET_POSITIONS: QB:1, RB:4, WR:4, TE:4, K:1 per team
//
// After running, re-run sync-stats.mjs for all 4 weeks.

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

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// ── Config ────────────────────────────────────────────────────────────────────

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SEASON_YEAR = 2025;

// Our week (1-4) → ESPN seasontype=3 week number
const ESPN_WEEK_MAP = { 1: 1, 2: 2, 3: 3, 4: 5 };

// Max players to keep per position per team (ranked by cumulative playoff stats)
const TARGET_POSITIONS = { QB: 1, RB: 4, WR: 4, TE: 4, K: 1 };

// ESPN position abbreviation → our position
function mapPosition(espnAbbr) {
  if (!espnAbbr) return null;
  const a = espnAbbr.toUpperCase();
  if (a === "QB") return "QB";
  if (a === "RB" || a === "FB" || a === "HB") return "RB";
  if (a === "WR") return "WR";
  if (a === "TE") return "TE";
  if (a === "K" || a === "PK") return "K";
  return null;
}

// ── ID generation (same as sync-rosters.mjs) ─────────────────────────────────

function generatePlayerId(fullName, teamAbbr) {
  const slug = fullName
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${teamAbbr.toUpperCase()}`;
}

// ── ESPN helpers ──────────────────────────────────────────────────────────────

async function fetchPlayoffGames(espnWeek) {
  const url = `${ESPN_BASE}/scoreboard?seasontype=3&week=${espnWeek}&limit=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard failed: ${res.status}`);
  const data = await res.json();
  return data.events ?? [];
}

async function fetchBoxScore(eventId) {
  const url = `${ESPN_BASE}/summary?event=${eventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN summary failed for ${eventId}: ${res.status}`);
  return res.json();
}

// ── Stat helpers for ranking ──────────────────────────────────────────────────

function parseNum(val) {
  const n = parseFloat(val ?? "0");
  return isNaN(n) ? 0 : n;
}

function parseFrac(val) {
  const n = parseInt((val ?? "0").split("/")[0]);
  return isNaN(n) ? 0 : n;
}

function rankingScore(position, statsMap) {
  const get = (k) => parseNum(statsMap[k]);
  const frac = (k) => parseFrac(statsMap[k]);
  switch (position) {
    case "QB":
      return get("passing.passingYards") + get("rushing.rushingYards");
    case "RB":
      return get("rushing.rushingYards") + get("receiving.receivingYards");
    case "WR":
    case "TE":
      return get("receiving.receivingYards");
    case "K":
      return frac("kicking.0-19") + frac("kicking.20-29") + frac("kicking.30-39") +
             frac("kicking.40-49") + frac("kicking.50+");
    default:
      return 0;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== Sync Rosters from Box Scores (${SEASON_YEAR} season) ===\n`);

  // Load teams from Supabase
  const { data: teams, error: teamsError } = await supabase
    .from("playoff_teams")
    .select("espn_id, abbreviation, name");

  if (teamsError || !teams || teams.length === 0) {
    console.error("Failed to load playoff_teams:", teamsError?.message ?? "no data");
    process.exit(1);
  }

  const teamByEspnId = new Map(teams.map((t) => [t.espn_id, t]));
  console.log(`Loaded ${teams.length} playoff teams\n`);

  // Per ESPN athlete ID: accumulate stats and record name/position/team
  // Key: espnAthleteId → { name, position, teamAbbr, statsMap }
  const athleteMap = new Map();

  for (const [ourWeek, espnWeek] of Object.entries(ESPN_WEEK_MAP)) {
    console.log(`── Week ${ourWeek} (ESPN week ${espnWeek})`);
    const games = await fetchPlayoffGames(espnWeek);
    const validGames = games.filter((g) => g.competitions?.[0]?.competitors?.length === 2);
    console.log(`   ${validGames.length} game(s)`);

    for (const game of validGames) {
      const eventId = game.id;
      const matchup = game.competitions[0].competitors.map((c) => c.team.abbreviation).join(" vs ");
      process.stdout.write(`   Processing ${matchup}...`);

      try {
        const data = await fetchBoxScore(eventId);

        for (const teamData of data.boxscore?.players ?? []) {
          const espnTeamId = teamData.team?.id;
          const team = teamByEspnId.get(espnTeamId);
          if (!team) continue;

          for (const category of teamData.statistics ?? []) {
            for (const entry of category.athletes ?? []) {
              const espnId = entry.athlete?.id;
              if (!espnId) continue;

              const name = entry.athlete.displayName || entry.athlete.shortName || "";
              const espnPos = entry.athlete.position?.abbreviation;
              const ourPos = mapPosition(espnPos);
              if (!ourPos) continue; // skip non-skill positions

              const existing = athleteMap.get(espnId) ?? {
                name,
                position: ourPos,
                teamAbbr: team.abbreviation,
                statsMap: {},
              };

              // Accumulate stats
              category.keys.forEach((key, i) => {
                existing.statsMap[`${category.name}.${key}`] = entry.stats[i] ?? "0";
              });

              athleteMap.set(espnId, existing);
            }
          }
        }
        console.log(" ✓");
      } catch (err) {
        console.log(` ✗ ${err.message}`);
      }
    }
    console.log();
  }

  console.log(`Found ${athleteMap.size} unique athletes across all playoff games\n`);

  // Group athletes by team + position, ranked by cumulative stats
  // teamAbbr → position → [{ espnId, name, score }]
  const byTeamPos = new Map();

  for (const [espnId, athlete] of athleteMap) {
    const { name, position, teamAbbr, statsMap } = athlete;
    if (!(position in TARGET_POSITIONS)) continue;

    const key = `${teamAbbr}::${position}`;
    const group = byTeamPos.get(key) ?? [];
    group.push({
      espnId,
      name,
      position,
      teamAbbr,
      score: rankingScore(position, statsMap),
    });
    byTeamPos.set(key, group);
  }

  // Select top N per team/position
  const playerRows = [];

  for (const team of teams) {
    console.log(`── ${team.name} (${team.abbreviation})`);

    for (const [position, maxCount] of Object.entries(TARGET_POSITIONS)) {
      const key = `${team.abbreviation}::${position}`;
      const group = (byTeamPos.get(key) ?? [])
        .sort((a, b) => b.score - a.score)
        .slice(0, maxCount);

      for (const p of group) {
        const id = generatePlayerId(p.name, p.teamAbbr);
        console.log(`  ${position.padEnd(3)} ${p.name} (score: ${p.score})`);
        playerRows.push({
          id,
          name: p.name,
          team: p.teamAbbr,
          position,
          espn_id: p.espnId,
        });
      }
    }

    // DEF entry
    const defId = generatePlayerId(team.name, team.abbreviation) + "-DEF";
    console.log(`  DEF ${team.name}`);
    playerRows.push({
      id: defId,
      name: team.name,
      team: team.abbreviation,
      position: "DEF",
      espn_id: null,
    });

    console.log();
  }

  if (playerRows.length === 0) {
    console.error("No player rows generated. Check ESPN API errors above.");
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

  await supabase.from("sync_log").insert({
    sync_type: "rosters",
    status: "success",
    message: `Synced ${playerRows.length} players from box scores (${SEASON_YEAR} playoffs)`,
    records_affected: playerRows.length,
  });

  // Summary by position
  const byPos = {};
  for (const p of playerRows) byPos[p.position] = (byPos[p.position] ?? 0) + 1;
  console.log(`\n✓ Done — ${playerRows.length} players saved`);
  console.log("\nBreakdown:");
  for (const [pos, count] of Object.entries(byPos)) {
    console.log(`  ${pos.padEnd(4)} ${count}`);
  }

  console.log("\nNext steps:");
  console.log("  node scripts/sync-stats.mjs --week 1");
  console.log("  node scripts/sync-stats.mjs --week 2");
  console.log("  node scripts/sync-stats.mjs --week 3");
  console.log("  node scripts/sync-stats.mjs --week 4");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
