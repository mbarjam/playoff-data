import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./lib/supabase";
import {
  fetchTeamRoster,
  fetchDepthChart,
  generatePlayerId,
  currentNflSeasonYear,
} from "./lib/espn";

// Positions we pull from the depth chart
const TARGET_POSITIONS: Record<string, number> = {
  QB: 1,  // top 1
  RB: 2,  // top 2
  WR: 2,  // top 2
  TE: 2,  // top 2
  K:  1,  // top 1
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const seasonYear: number = (req.body as { seasonYear?: number })?.seasonYear ?? currentNflSeasonYear();

  // Get playoff teams from DB
  const { data: teams, error: teamsError } = await adminSupabase
    .from("playoff_teams")
    .select("*");
  if (teamsError) return res.status(500).json({ ok: false, error: teamsError.message });
  if (!teams || teams.length === 0) {
    return res.status(400).json({ ok: false, error: "No playoff teams found. Run sync-teams first." });
  }

  // Log as running
  const { data: logRow } = await adminSupabase
    .from("sync_log")
    .insert({ sync_type: "rosters", status: "running", message: `Syncing rosters for ${teams.length} teams` })
    .select("id")
    .single();
  const logId = logRow?.id;

  try {
    const playerRows: {
      id: string;
      name: string;
      team: string;
      position: string;
      espn_id: string | null;
    }[] = [];

    for (const team of teams) {
      try {
        // Get full roster (name + position, keyed by ESPN athlete ID)
        const roster = await fetchTeamRoster(team.espn_id);
        const rosterById = new Map(roster.map((a) => [a.id, a]));

        // Get depth chart (position → ordered athlete IDs)
        const depthChart = await fetchDepthChart(team.espn_id, seasonYear);

        for (const [position, maxCount] of Object.entries(TARGET_POSITIONS)) {
          const depthIds = depthChart.get(position) ?? [];

          // If depth chart has entries, use them; otherwise fall back to roster order
          const candidates =
            depthIds.length > 0
              ? depthIds.map((id) => rosterById.get(id)).filter(Boolean)
              : roster.filter((a) => a.position.abbreviation.toUpperCase() === position);

          const selected = candidates.slice(0, maxCount);

          for (const athlete of selected) {
            if (!athlete) continue;
            playerRows.push({
              id: generatePlayerId(athlete.fullName || athlete.displayName, team.abbreviation),
              name: athlete.fullName || athlete.displayName,
              team: team.abbreviation,
              position: position,
              espn_id: athlete.id,
            });
          }
        }

        // Add DEF/ST — no ESPN lookup needed; name = full team name
        playerRows.push({
          id: generatePlayerId(team.name, team.abbreviation) + "-DEF",
          name: team.name,
          team: team.abbreviation,
          position: "DEF",
          espn_id: null,
        });
      } catch (teamErr) {
        console.error(`Failed to sync roster for ${team.abbreviation}:`, teamErr);
        // Continue with other teams rather than aborting entire sync
      }
    }

    if (playerRows.length === 0) {
      await updateLog(logId, "error", "No players found across all teams.");
      return res.status(200).json({ ok: false, error: "No players found" });
    }

    // Upsert all players (preserves any admin name edits for existing rows
    // if we use onConflict update only specific columns)
    const { error: upsertError } = await adminSupabase
      .from("players")
      .upsert(playerRows, { onConflict: "id" });

    if (upsertError) throw new Error(upsertError.message);

    await updateLog(logId, "success", `Synced ${playerRows.length} players across ${teams.length} teams`, playerRows.length);

    return res.status(200).json({ ok: true, count: playerRows.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateLog(logId, "error", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
}

async function updateLog(
  logId: string | undefined,
  status: string,
  message: string,
  records?: number
) {
  if (!logId) return;
  await adminSupabase
    .from("sync_log")
    .update({ status, message, records_affected: records ?? null })
    .eq("id", logId);
}
