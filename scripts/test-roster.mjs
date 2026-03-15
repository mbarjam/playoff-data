// Test script: fetch playoff teams and best players from ESPN
// Run with: node scripts/test-roster.mjs
//
// This mirrors the logic in api/sync-rosters.ts so you can verify
// the player selection before running the full sync.

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const SEASON_YEAR = 2025;

const TARGET_POSITIONS = { QB: 1, RB: 2, WR: 2, TE: 2, K: 1 };

// ── Helpers ──────────────────────────────────────────────────────────────────

function generatePlayerId(fullName, teamAbbr) {
  const slug = fullName
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\./g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${teamAbbr.toUpperCase()}`;
}

async function fetchPlayoffTeams() {
  // Query all playoff weeks to collect all 14 teams (including the 2 bye-week teams
  // that don't appear in Wild Card). ESPN week 5 = Super Bowl.
  const seen = new Map();
  for (const week of [1, 2, 3, 5]) {
    const url = `${ESPN_BASE}/scoreboard?seasontype=3&week=${week}&limit=20`;
    const res = await fetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    for (const game of data.events ?? []) {
      for (const comp of game.competitions ?? []) {
        for (const competitor of comp.competitors ?? []) {
          const t = competitor.team;
          if (!seen.has(t.id)) seen.set(t.id, t);
        }
      }
    }
  }
  return Array.from(seen.values());
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
    console.warn(`    [depth chart unavailable for ${espnTeamId}: ${res.status}]`);
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
  console.log(`\n=== ESPN Playoff Roster Test (${SEASON_YEAR} season) ===\n`);

  console.log("Fetching playoff teams...");
  const teams = await fetchPlayoffTeams();
  console.log(`Found ${teams.length} teams: ${teams.map(t => t.abbreviation).join(", ")}\n`);

  const allPlayers = [];

  for (const team of teams) {
    console.log(`\n── ${team.displayName} (${team.abbreviation}, ESPN ID: ${team.id}) ──`);

    try {
      const [roster, depthChart] = await Promise.all([
        fetchTeamRoster(team.id),
        fetchDepthChart(team.id),
      ]);

      const rosterById = new Map(roster.map(a => [a.id, a]));
      const selected = [];

      for (const [position, maxCount] of Object.entries(TARGET_POSITIONS)) {
        // ESPN uses "PK" for kickers in depth charts and rosters; we store as "K"
        const espnPos = position === "K" ? "PK" : position;
        const depthIds = depthChart.get(espnPos) ?? depthChart.get(position) ?? [];
        const candidates =
          depthIds.length > 0
            ? depthIds.map(id => rosterById.get(id)).filter(Boolean)
            : roster.filter(a => {
                const abbr = a.position?.abbreviation?.toUpperCase();
                return abbr === espnPos || abbr === position;
              });

        const picks = candidates.slice(0, maxCount);
        for (const athlete of picks) {
          if (!athlete) continue;
          const name = athlete.fullName || athlete.displayName;
          const playerId = generatePlayerId(name, team.abbreviation);
          const injuryStatus = athlete.injuries?.[0]?.displayType ?? null;
          selected.push({ position, name, playerId, espnId: athlete.id, injuryStatus });
          console.log(`  ${position.padEnd(3)} ${name.padEnd(25)} → id: ${playerId}${injuryStatus ? `  ⚠ ${injuryStatus}` : ""}`);
        }
      }

      // DEF/ST (auto-generated, no ESPN call)
      const defId = generatePlayerId(team.displayName, team.abbreviation) + "-DEF";
      console.log(`  DEF ${team.displayName.padEnd(25)} → id: ${defId}`);
      selected.push({ position: "DEF", name: team.displayName, playerId: defId, espnId: null, injuryStatus: null });

      allPlayers.push(...selected.map(p => ({ ...p, team: team.abbreviation })));
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
    }
  }

  console.log(`\n\n=== Summary ===`);
  console.log(`Total players to insert: ${allPlayers.length}`);
  const byPos = {};
  for (const p of allPlayers) {
    byPos[p.position] = (byPos[p.position] ?? 0) + 1;
  }
  for (const [pos, count] of Object.entries(byPos)) {
    console.log(`  ${pos.padEnd(4)} ${count}`);
  }

  // Check for any players without ESPN IDs (only DEF should have null)
  const missingId = allPlayers.filter(p => !p.espnId && p.position !== "DEF");
  if (missingId.length > 0) {
    console.log(`\n⚠ Players missing ESPN ID (won't get stats matched):`);
    for (const p of missingId) console.log(`  ${p.team} ${p.position} ${p.name}`);
  } else {
    console.log(`\n✓ All skill position players have ESPN IDs`);
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
