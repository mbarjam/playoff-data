// Seed all players from the 2025 playoff challenge CSV into Supabase.
// Use this to ensure players from non-playoff teams (NE, JAC, SF, GB, PIT, LAC, CHI)
// are present in the players table so lineup slots resolve correctly.
//
// Run with: node scripts/seed-csv-players.mjs
// (or: npm run seed:players)

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";

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

// ── All players from the 2025 playoff challenge CSV ───────────────────────────
// espn_id is null for players whose teams didn't make the playoffs — they score 0.

const CSV_PLAYERS = [
  // BUF
  { name: "Josh Allen",            team: "BUF", position: "QB" },
  { name: "James Cook",            team: "BUF", position: "RB" },
  { name: "Tyler Bass",            team: "BUF", position: "K"  },
  // PHI
  { name: "Saquon Barkley",        team: "PHI", position: "RB" },
  { name: "DeVonta Smith",         team: "PHI", position: "WR" },
  { name: "Dallas Goedert",        team: "PHI", position: "TE" },
  { name: "Jalen Hurts",           team: "PHI", position: "QB" },
  // CHI
  { name: "D'Andre Swift",         team: "CHI", position: "RB" },
  { name: "Colston Loveland",      team: "CHI", position: "TE" },
  { name: "Cole Kmet",             team: "CHI", position: "TE" },
  { name: "Chicago Bears",         team: "CHI", position: "DEF" },
  // SEA
  { name: "Jaxon Smith-Njigba",    team: "SEA", position: "WR" },
  { name: "Ken Walker III",        team: "SEA", position: "RB" },
  { name: "Zach Charbonnet",       team: "SEA", position: "RB" },
  { name: "Seattle Seahawks",      team: "SEA", position: "DEF" },
  // LAR
  { name: "Puka Nacua",            team: "LAR", position: "WR" },
  { name: "Matthew Stafford",      team: "LAR", position: "QB" },
  // NE
  { name: "Hunter Henry",          team: "NE",  position: "TE" },
  { name: "Rhamondre Stevenson",   team: "NE",  position: "RB" },
  { name: "Drake Maye",            team: "NE",  position: "QB" },
  { name: "Stefon Diggs",          team: "NE",  position: "WR" },
  { name: "Joey Borregales",       team: "NE",  position: "K"  },
  { name: "New England Patriots",  team: "NE",  position: "DEF" },
  // PIT
  { name: "Chris Boswell",         team: "PIT", position: "K"  },
  // HOU
  { name: "Ka'imi Fairbairn",      team: "HOU", position: "K"  },
  { name: "Nico Collins",          team: "HOU", position: "WR" },
  { name: "Dalton Schultz",        team: "HOU", position: "TE" },
  { name: "Houston Texans",        team: "HOU", position: "DEF" },
  // DEN
  { name: "Wil Lutz",              team: "DEN", position: "K"  },
  { name: "RJ Harvey",             team: "DEN", position: "RB" },
  { name: "Courtland Sutton",      team: "DEN", position: "WR" },
  { name: "Denver Broncos",        team: "DEN", position: "DEF" },
  // LAC
  { name: "Omarion Hampton",       team: "LAC", position: "RB" },
  // JAC
  { name: "Travis Etienne Jr.",    team: "JAC", position: "RB" },
  { name: "Cam Little",            team: "JAC", position: "K"  },
  { name: "Trevor Lawrence",       team: "JAC", position: "QB" },
  { name: "Jacksonville Jaguars",  team: "JAC", position: "DEF" },
  // SF
  { name: "Christian McCaffrey",   team: "SF",  position: "RB" },
  { name: "George Kittle",         team: "SF",  position: "TE" },
  { name: "Brock Purdy",           team: "SF",  position: "QB" },
  // GB
  { name: "Josh Jacobs",           team: "GB",  position: "RB" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n=== Seed CSV Players → Supabase players table ===\n");

  const playerRows = CSV_PLAYERS.map((p) => ({
    id: generatePlayerId(p.name, p.team),
    name: p.name,
    team: p.team,
    position: p.position,
    espn_id: null,
  }));

  console.log(`Preparing ${playerRows.length} players:\n`);
  for (const p of playerRows) {
    console.log(`  ${p.position.padEnd(4)} ${p.team.padEnd(4)} ${p.id}`);
  }

  console.log(`\nUpserting to Supabase...`);
  const { error } = await supabase
    .from("players")
    .upsert(playerRows, { onConflict: "id" });

  if (error) {
    console.error("Upsert failed:", error.message);
    process.exit(1);
  }

  await supabase.from("sync_log").insert({
    sync_type: "rosters",
    status: "success",
    message: `Seeded ${playerRows.length} players from 2025 playoff challenge CSV`,
    records_affected: playerRows.length,
  });

  console.log(`\n✓ Done — ${playerRows.length} players saved`);
  console.log("\nNext: run node scripts/check-lineups.mjs to verify all lineup IDs resolve");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
