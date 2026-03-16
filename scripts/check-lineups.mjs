// Check which lineup player IDs from sampleParticipants don't exist in Supabase
// Run with: node scripts/check-lineups.mjs

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

// ── Paste the lineups from sampleParticipants.ts here ─────────────────────────

const participants = [
  { name: "Brad Tmp",   lineup: { QB1: "josh-allen-BUF", RB1: "saquon-barkley-PHI", RB2: "dandre-swift-CHI", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "hunter-henry-NE", K1: "chris-boswell-PIT", DEF1: "houston-texans-HOU-DEF" } },
  { name: "Kyle Tmp",   lineup: { QB1: "matthew-stafford-LAR", RB1: "james-cook-BUF", RB2: "dandre-swift-CHI", WR1: "jaxon-smith-njigba-SEA", WR2: "devonta-smith-PHI", TE1: "hunter-henry-NE", K1: "wil-lutz-DEN", DEF1: "houston-texans-HOU-DEF" } },
  { name: "Katie Tmp",  lineup: { QB1: "josh-allen-BUF", RB1: "christian-mccaffrey-SF", RB2: "rhamondre-stevenson-NE", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "dallas-goedert-PHI", K1: "kaimi-fairbairn-HOU", DEF1: "chicago-bears-CHI-DEF" } },
  { name: "Brian Tmp",  lineup: { QB1: "drake-maye-NE", RB1: "saquon-barkley-PHI", RB2: "travis-etienne-jr-JAC", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "colston-loveland-CHI", K1: "tyler-bass-BUF", DEF1: "denver-broncos-DEN-DEF" } },
  { name: "Wyatt Tmp",  lineup: { QB1: "josh-allen-BUF", RB1: "saquon-barkley-PHI", RB2: "josh-jacobs-GB", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "hunter-henry-NE", K1: "little-JAC", DEF1: "houston-texans-HOU-DEF" } },
  { name: "Bree N",     lineup: { QB1: "drake-maye-NE", RB1: "saquon-barkley-PHI", RB2: "travis-etienne-jr-JAC", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "colston-loveland-CHI", K1: "kaimi-fairbairn-HOU", DEF1: "denver-broncos-DEN-DEF" } },
  { name: "Bret B",     lineup: { QB1: "josh-allen-BUF", RB1: "saquon-barkley-PHI", RB2: "christian-mccaffrey-SF", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "hunter-henry-NE", K1: "kaimi-fairbairn-HOU", DEF1: "denver-broncos-DEN-DEF" } },
  { name: "Jon M",      lineup: { QB1: "drake-maye-NE", RB1: "christian-mccaffrey-SF", RB2: "james-cook-BUF", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "colston-loveland-CHI", K1: "wil-lutz-DEN", DEF1: "houston-texans-HOU-DEF" } },
  { name: "Matt B",     lineup: { QB1: "drake-maye-NE", RB1: "harvey-DEN", RB2: "james-cook-BUF", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "dallas-goedert-PHI", K1: "little-JAC", DEF1: "houston-texans-HOU-DEF" } },
  { name: "Brendon N",  lineup: { QB1: "matthew-stafford-LAR", RB1: "james-cook-BUF", RB2: "rhamondre-stevenson-NE", WR1: "jaxon-smith-njigba-SEA", WR2: "nico-collins-HOU", TE1: "dallas-goedert-PHI", K1: "little-JAC", DEF1: "denver-broncos-DEN-DEF" } },
  { name: "Tony N",     lineup: { QB1: "drake-maye-NE", RB1: "james-cook-BUF", RB2: "christian-mccaffrey-SF", WR1: "puka-nacua-LAR", WR2: "courtland-sutton-DEN", TE1: "colston-loveland-CHI", K1: "kaimi-fairbairn-HOU", DEF1: "seattle-seahawks-SEA-DEF" } },
  { name: "Nate S",     lineup: { QB1: "trevor-lawrence-JAC", RB1: "saquon-barkley-PHI", RB2: "hampton-LAC", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "george-kittle-SF", K1: "chris-boswell-PIT", DEF1: "chicago-bears-CHI-DEF" } },
  { name: "Cam B",      lineup: { QB1: "jalen-hurts-PHI", RB1: "ken-walker-iii-SEA", RB2: "james-cook-BUF", WR1: "nico-collins-HOU", WR2: "puka-nacua-LAR", TE1: "cole-kmet-CHI", K1: "wil-lutz-DEN", DEF1: "new-england-patriots-NE-DEF" } },
  { name: "Will E",     lineup: { QB1: "brock-purdy-SF", RB1: "zach-charbonnet-SEA", RB2: "dandre-swift-CHI", WR1: "puka-nacua-LAR", WR2: "stefon-diggs-NE", TE1: "dallas-goedert-PHI", K1: "kaimi-fairbairn-HOU", DEF1: "jacksonville-jaguars-JAC-DEF" } },
  { name: "Steve U",    lineup: { QB1: "matthew-stafford-LAR", RB1: "christian-mccaffrey-SF", RB2: "james-cook-BUF", WR1: "jaxon-smith-njigba-SEA", WR2: "stefon-diggs-NE", TE1: "dalton-schultz-HOU", K1: "little-JAC", DEF1: "denver-broncos-DEN-DEF" } },
  { name: "Brian H",    lineup: { QB1: "trevor-lawrence-JAC", RB1: "josh-jacobs-GB", RB2: "hampton-LAC", WR1: "jaxon-smith-njigba-SEA", WR2: "puka-nacua-LAR", TE1: "dallas-goedert-PHI", K1: "joey-borregales-NE", DEF1: "houston-texans-HOU-DEF" } },
];

// ── Main ──────────────────────────────────────────────────────────────────────

const { data: players } = await supabase.from("players").select("id, name, team, position");
const playerIds = new Set((players ?? []).map((p) => p.id));
const playerById = new Map((players ?? []).map((p) => [p.id, p]));

console.log(`\nPlayers in Supabase: ${playerIds.size}`);

// Show all unique teams
const teams = [...new Set((players ?? []).map((p) => p.team))].sort();
console.log(`Teams: ${teams.join(", ")}\n`);

// Collect all unique player IDs used across all lineups
const allUsedIds = new Set(
  participants.flatMap((p) => Object.values(p.lineup))
);

// Find missing ones
const missing = [...allUsedIds].filter((id) => !playerIds.has(id)).sort();

if (missing.length === 0) {
  console.log("✓ All lineup player IDs found in Supabase — lineups are complete!\n");
} else {
  console.log(`✗ ${missing.length} player ID(s) NOT found in Supabase:\n`);
  for (const id of missing) {
    const who = participants
      .filter((p) => Object.values(p.lineup).includes(id))
      .map((p) => p.name)
      .join(", ");
    console.log(`  ${id.padEnd(40)}  used by: ${who}`);
  }
  console.log();
}

// Also show which participants are affected
console.log("── Per-participant status ──────────────────────────────────");
for (const p of participants) {
  const slots = Object.entries(p.lineup);
  const bad = slots.filter(([, id]) => !playerIds.has(id));
  if (bad.length === 0) {
    console.log(`  ✓ ${p.name}`);
  } else {
    console.log(`  ✗ ${p.name} — missing: ${bad.map(([slot, id]) => `${slot}=${id}`).join(", ")}`);
  }
}
console.log();
