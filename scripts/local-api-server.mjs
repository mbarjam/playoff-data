// Local API server for playoff-data Admin UI (replaces vercel dev)
// Run with: node scripts/local-api-server.mjs
//
// Handles POST /api/sync-stats so the Admin page "Sync Stats" button works locally.
// Vite (npm run dev) proxies /api/* to this server on port 3001.

import http from "http";
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

// ── ESPN helpers ──────────────────────────────────────────────────────────────

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const SEASON_YEAR = 2025;
const ESPN_WEEK_MAP = { 1: 1, 2: 2, 3: 3, 4: 5 };
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

// ── Sync stats handler ────────────────────────────────────────────────────────

async function syncStats(week) {
  const espnWeek = ESPN_WEEK_MAP[week];
  const weekLabel = WEEK_LABELS[week];

  console.log(`\nSyncing stats — Week ${week}: ${weekLabel} (${SEASON_YEAR} season)`);

  const { data: players, error: playersError } = await supabase
    .from("players")
    .select("id, name, team, position, espn_id");
  if (playersError) throw new Error("Failed to load players: " + playersError.message);
  if (!players || players.length === 0) throw new Error("No players found. Run sync-rosters first.");

  const { data: playoffTeams } = await supabase
    .from("playoff_teams")
    .select("espn_id, abbreviation");

  const teamAbbrByEspnId = new Map((playoffTeams ?? []).map((t) => [t.espn_id, t.abbreviation]));
  const playerByEspnId = new Map(players.filter((p) => p.espn_id).map((p) => [p.espn_id, p]));

  const games = await fetchPlayoffGames(espnWeek);
  const completedGames = games.filter((g) => g.competitions?.[0]?.competitors?.length === 2);
  if (completedGames.length === 0) throw new Error(`No completed games found for ESPN week ${espnWeek}`);

  console.log(`  Found ${completedGames.length} game(s)`);
  const statRows = [];

  for (const game of completedGames) {
    const eventId = game.id;
    try {
      const data = await fetchGameBoxScore(eventId);
      const competitors = data.header?.competitions?.[0]?.competitors ?? [];
      const scoreByTeamId = new Map();
      for (const c of competitors) scoreByTeamId.set(c.team.id, parseInt(c.score ?? "0"));

      const teamIds = Array.from(scoreByTeamId.keys());
      const homeTeamId = competitors.find((c) => c.homeAway === "home")?.team.id;
      const awayTeamId = competitors.find((c) => c.homeAway === "away")?.team.id;

      let playerCount = 0;
      for (const teamData of data.boxscore?.players ?? []) {
        for (const category of teamData.statistics ?? []) {
          for (const entry of category.athletes ?? []) {
            const player = playerByEspnId.get(entry.athlete.id);
            if (!player || player.position === "DEF") continue;
            const statsMap = {};
            category.keys.forEach((key, i) => {
              statsMap[`${category.name}.${key}`] = entry.stats[i] ?? "0";
            });
            const mapped = mapPlayerStats(statsMap);
            statRows.push({
              player_id: player.id, week,
              pass_yds: mapped.pass_yds, pass_tds: mapped.pass_tds,
              interceptions_thrown: mapped.interceptions_thrown, sacks_taken: mapped.sacks_taken,
              rush_yds: mapped.rush_yds, rush_tds: mapped.rush_tds,
              rec_yds: mapped.rec_yds, rec_tds: mapped.rec_tds,
              fumbles_lost: mapped.fumbles_lost, xp_made: mapped.xp_made,
              xp_missed: mapped.xp_missed, fg_0_39: mapped.fg_0_39,
              fg_40_49: mapped.fg_40_49, fg_50_plus: mapped.fg_50_plus,
              return_tds: 0, fumble_rec_tds: 0, two_pt_conversions: 0,
              def_st_tds: 0, def_interceptions: 0, fumble_recoveries: 0,
              blocked_kicks: 0, safeties: 0, pat_safeties: 0,
              def_sacks: 0, yards_allowed: 0, points_allowed: 0,
            });
            playerCount++;
          }
        }
      }

      for (const teamEspnId of teamIds) {
        const teamAbbr = teamAbbrByEspnId.get(teamEspnId);
        if (!teamAbbr) continue;
        const defPlayer = players.find((p) => p.team === teamAbbr && p.position === "DEF");
        if (!defPlayer) continue;
        const oppTeamId = teamEspnId === homeTeamId ? awayTeamId : homeTeamId;
        const oppScore = scoreByTeamId.get(oppTeamId) ?? 0;
        statRows.push({
          player_id: defPlayer.id, week,
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

      console.log(`  ✓ game ${eventId}: ${playerCount} players + ${teamIds.length} DEF`);
    } catch (err) {
      console.error(`  ✗ game ${eventId}: ${err.message}`);
    }
  }

  if (statRows.length === 0) throw new Error("No stat rows generated — check ESPN API errors above");

  const { error: upsertError } = await supabase
    .from("player_game_stats")
    .upsert(statRows, { onConflict: "player_id,week" });
  if (upsertError) throw new Error("Supabase upsert failed: " + upsertError.message);

  await supabase.from("sync_log").insert({
    sync_type: "stats",
    status: "success",
    week,
    message: `Synced ${statRows.length} stat rows for week ${week} (${weekLabel})`,
    records_affected: statRows.length,
  });

  console.log(`  ✓ Done — ${statRows.length} rows saved`);
  return statRows.length;
}

// ── HTTP server ───────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

function send(res, status, data) {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = req.url?.split("?")[0];
  console.log(`${req.method} ${url}`);

  if (req.method === "POST" && url === "/api/sync-stats") {
    try {
      const body = await readBody(req);
      const week = typeof body.week === "number" ? body.week : parseInt(body.week ?? "1");
      if (!week || week < 1 || week > 4) {
        return send(res, 400, { ok: false, error: "week must be 1-4" });
      }
      const count = await syncStats(week);
      return send(res, 200, { ok: true, count });
    } catch (err) {
      console.error("Error:", err.message);
      return send(res, 500, { ok: false, error: err.message });
    }
  }

  send(res, 404, { error: "Not found" });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`\nLocal API server running on http://localhost:${PORT}`);
  console.log("Handles: POST /api/sync-stats");
  console.log("\nStart the React app in another terminal: npm run dev");
  console.log("Then open http://localhost:8081 → Admin → Sync Stats\n");
});
