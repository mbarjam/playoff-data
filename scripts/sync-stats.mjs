// Sync player game stats from ESPN box scores → Supabase player_game_stats table
// Run with: node scripts/sync-stats.mjs --week 1
//           node scripts/sync-stats.mjs --week 2
//           ... up to --week 4 (Super Bowl)
//
// Week mapping: 1=Wild Card, 2=Divisional, 3=Conference, 4=Super Bowl
//
// Prerequisites:
//   1. Run supabase-migration.sql in Supabase SQL editor first
//   2. Run sync-teams.mjs and sync-rosters.mjs first

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

// Our week (1-4) → ESPN seasontype=3 week number
const ESPN_WEEK_MAP = { 1: 1, 2: 2, 3: 3, 4: 5 };

// Week labels for logging
const WEEK_LABELS = { 1: "Wild Card", 2: "Divisional", 3: "Conference Championships", 4: "Super Bowl" };

async function fetchPlayoffGames(espnWeek) {
  const url = `${ESPN_BASE}/scoreboard?seasontype=3&week=${espnWeek}&limit=20`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard fetch failed: ${res.status}`);
  const data = await res.json();
  return data.events ?? [];
}

async function fetchGameBoxScore(eventId) {
  const url = `${ESPN_BASE}/summary?event=${eventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN summary fetch failed for event ${eventId}: ${res.status}`);
  return res.json();
}

// ── Stat parsing helpers ──────────────────────────────────────────────────────

function parseNum(val) {
  const n = parseFloat(val ?? "0");
  return isNaN(n) ? 0 : n;
}

function parseFraction(val) {
  const n = parseInt((val ?? "0").split("/")[0]);
  return isNaN(n) ? 0 : n;
}

function mapPlayerStats(stats) {
  const get = (k) => parseNum(stats[k]);
  const getFrac = (k) => parseFraction(stats[k]);

  const xpStr = stats["kicking.extraPoints"] ?? "0/0";
  const xpParts = xpStr.split("/");
  const xpMade = parseInt(xpParts[0] ?? "0");
  const xpAtt = parseInt(xpParts[1] ?? "0");
  const xpMissed = isNaN(xpAtt - xpMade) ? 0 : Math.max(0, xpAtt - xpMade);

  return {
    pass_yds: get("passing.passingYards"),
    pass_tds: get("passing.passingTouchdowns"),
    interceptions_thrown: get("passing.interceptions"),
    sacks_taken: getFrac("passing.sacks"),
    rush_yds: get("rushing.rushingYards"),
    rush_tds: get("rushing.rushingTouchdowns"),
    rec_yds: get("receiving.receivingYards"),
    rec_tds: get("receiving.receivingTouchdowns"),
    fumbles_lost: get("fumbles.fumblesLost"),
    xp_made: getFrac("kicking.extraPoints"),
    xp_missed: xpMissed,
    fg_0_39: getFrac("kicking.0-19") + getFrac("kicking.20-29") + getFrac("kicking.30-39"),
    fg_40_49: getFrac("kicking.40-49"),
    fg_50_plus: getFrac("kicking.50+"),
  };
}

function mapDefStats(oppScore) {
  return {
    points_allowed: oppScore,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Parse --week argument
  const weekArg = process.argv.indexOf("--week");
  const week = weekArg !== -1 ? parseInt(process.argv[weekArg + 1]) : null;

  if (!week || week < 1 || week > 4) {
    console.error("Usage: node scripts/sync-stats.mjs --week <1-4>");
    console.error("  1 = Wild Card");
    console.error("  2 = Divisional");
    console.error("  3 = Conference Championships");
    console.error("  4 = Super Bowl");
    process.exit(1);
  }

  const espnWeek = ESPN_WEEK_MAP[week];
  const weekLabel = WEEK_LABELS[week];

  console.log(`\n=== Sync Stats — Week ${week}: ${weekLabel} (${SEASON_YEAR} season) ===\n`);

  // Load players from Supabase
  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, name, team, position, espn_id");

  if (playersError) {
    console.error("Failed to load players:", playersError.message);
    process.exit(1);
  }

  if (!players || players.length === 0) {
    console.error("No players found. Run sync-rosters.mjs first.");
    process.exit(1);
  }

  // Load playoff teams for DEF matching
  const { data: playoffTeams } = await supabase
    .from("playoff_teams")
    .select("espn_id, abbreviation");

  const teamAbbrByEspnId = new Map((playoffTeams ?? []).map((t) => [t.espn_id, t.abbreviation]));
  const playerByEspnId = new Map(
    players.filter((p) => p.espn_id).map((p) => [p.espn_id, p])
  );

  console.log(`Loaded ${players.length} players, ${playoffTeams?.length ?? 0} teams\n`);

  // Fetch games for this ESPN week
  console.log(`Fetching ESPN week ${espnWeek} games...`);
  const games = await fetchPlayoffGames(espnWeek);
  const completedGames = games.filter(
    (g) => g.competitions?.[0]?.competitors?.length === 2
  );

  if (completedGames.length === 0) {
    console.error(`No completed games found for ESPN week ${espnWeek}.`);
    process.exit(1);
  }

  console.log(`Found ${completedGames.length} game(s)\n`);

  const statRows = [];

  for (const game of completedGames) {
    const eventId = game.id;
    const gameTeams = game.competitions[0].competitors.map((c) => c.team.abbreviation).join(" vs ");
    console.log(`Processing: ${gameTeams} (event ${eventId})`);

    try {
      const data = await fetchGameBoxScore(eventId);

      // Parse scores
      const competitors = data.header?.competitions?.[0]?.competitors ?? [];
      const scoreByTeamId = new Map();
      for (const c of competitors) {
        scoreByTeamId.set(c.team.id, parseInt(c.score ?? "0"));
      }

      const teamIds = Array.from(scoreByTeamId.keys());
      const homeTeamId = competitors.find((c) => c.homeAway === "home")?.team.id;
      const awayTeamId = competitors.find((c) => c.homeAway === "away")?.team.id;

      // Per-player offensive stats
      let playerCount = 0;
      for (const teamData of data.boxscore?.players ?? []) {
        for (const category of teamData.statistics ?? []) {
          for (const entry of category.athletes ?? []) {
            const espnAthleteId = entry.athlete.id;
            const player = playerByEspnId.get(espnAthleteId);
            if (!player || player.position === "DEF") continue;

            // Build stat map: "category.key" → value
            const statsMap = {};
            category.keys.forEach((key, i) => {
              statsMap[`${category.name}.${key}`] = entry.stats[i] ?? "0";
            });

            const mapped = mapPlayerStats(statsMap);

            statRows.push({
              player_id: player.id,
              week,
              pass_yds: mapped.pass_yds,
              pass_tds: mapped.pass_tds,
              interceptions_thrown: mapped.interceptions_thrown,
              sacks_taken: mapped.sacks_taken,
              rush_yds: mapped.rush_yds,
              rush_tds: mapped.rush_tds,
              rec_yds: mapped.rec_yds,
              rec_tds: mapped.rec_tds,
              fumbles_lost: mapped.fumbles_lost,
              xp_made: mapped.xp_made,
              xp_missed: mapped.xp_missed,
              fg_0_39: mapped.fg_0_39,
              fg_40_49: mapped.fg_40_49,
              fg_50_plus: mapped.fg_50_plus,
              return_tds: 0,
              fumble_rec_tds: 0,
              two_pt_conversions: 0,
              def_st_tds: 0,
              def_interceptions: 0,
              fumble_recoveries: 0,
              blocked_kicks: 0,
              safeties: 0,
              pat_safeties: 0,
              def_sacks: 0,
              yards_allowed: 0,
              points_allowed: 0,
            });
            playerCount++;
          }
        }
      }

      // DEF/ST — one entry per team in this game
      for (const teamEspnId of teamIds) {
        const teamAbbr = teamAbbrByEspnId.get(teamEspnId);
        if (!teamAbbr) continue;

        const defPlayer = players.find((p) => p.team === teamAbbr && p.position === "DEF");
        if (!defPlayer) continue;

        const oppTeamId = teamEspnId === homeTeamId ? awayTeamId : homeTeamId;
        const oppScore = scoreByTeamId.get(oppTeamId) ?? 0;

        statRows.push({
          player_id: defPlayer.id,
          week,
          pass_yds: 0, pass_tds: 0, interceptions_thrown: 0, sacks_taken: 0,
          rush_yds: 0, rush_tds: 0, rec_yds: 0, rec_tds: 0,
          fumbles_lost: 0, xp_made: 0, xp_missed: 0,
          fg_0_39: 0, fg_40_49: 0, fg_50_plus: 0,
          return_tds: 0, fumble_rec_tds: 0, two_pt_conversions: 0,
          def_st_tds: 0, def_interceptions: 0, fumble_recoveries: 0,
          blocked_kicks: 0, safeties: 0, pat_safeties: 0,
          def_sacks: 0, yards_allowed: 0,
          points_allowed: oppScore,
        });
      }

      console.log(`  ✓ ${playerCount} players + ${teamIds.length} DEF entries`);
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  if (statRows.length === 0) {
    console.error("\nNo stat rows generated. Check ESPN API errors above.");
    process.exit(1);
  }

  console.log(`\nUpserting ${statRows.length} stat rows to Supabase...`);
  const { error: upsertError } = await supabase
    .from("player_game_stats")
    .upsert(statRows, { onConflict: "player_id,week" });

  if (upsertError) {
    console.error("Supabase upsert failed:", upsertError.message);
    process.exit(1);
  }

  // Log to sync_log
  await supabase.from("sync_log").insert({
    sync_type: "stats",
    status: "success",
    week,
    message: `Synced ${statRows.length} stat rows for week ${week} (${weekLabel})`,
    records_affected: statRows.length,
  });

  console.log(`\n✓ Done — ${statRows.length} stat rows saved for week ${week} (${weekLabel})`);

  if (week < 4) {
    console.log(`\nNext: node scripts/sync-stats.mjs --week ${week + 1}`);
  } else {
    console.log("\nAll 4 playoff weeks synced!");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
