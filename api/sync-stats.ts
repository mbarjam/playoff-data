import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./lib/supabase";
import {
  fetchPlayoffGames,
  fetchGameBoxScore,
  mapPlayerStats,
  mapDefStats,
  currentNflSeasonYear,
  ESPN_WEEK_MAP,
} from "./lib/espn";

const CRON_SECRET = process.env.CRON_SECRET;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Support GET (Vercel cron) and POST (manual trigger)
  const isCron = req.method === "GET";

  if (isCron) {
    // Verify Vercel cron secret
    const auth = req.headers["authorization"];
    if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  } else if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Determine week to sync
  let week: number;
  if (isCron) {
    // For cron: read from sync_schedule
    const { data: schedule } = await adminSupabase
      .from("sync_schedule")
      .select("stats_sync_enabled, stats_current_week")
      .eq("id", 1)
      .single();
    if (!schedule?.stats_sync_enabled) {
      return res.status(200).json({ ok: true, skipped: true, reason: "Auto-sync disabled" });
    }
    week = schedule.stats_current_week;
  } else {
    week = (req.body as { week?: number })?.week ?? 1;
  }

  const seasonYear: number = (req.body as { seasonYear?: number })?.seasonYear ?? currentNflSeasonYear();

  // Map our week (1-4) to ESPN week
  const espnWeek = Object.entries(ESPN_WEEK_MAP).find(([, v]) => v === week)?.[0];
  if (!espnWeek) {
    return res.status(400).json({ ok: false, error: `Invalid week: ${week}` });
  }

  // Log as running
  const { data: logRow } = await adminSupabase
    .from("sync_log")
    .insert({ sync_type: "stats", status: "running", week, message: `Syncing week ${week} stats` })
    .select("id")
    .single();
  const logId = logRow?.id;

  try {
    // Load our players table (espn_id → player DB id + position)
    const { data: players, error: playersError } = await adminSupabase
      .from("players")
      .select("id, name, team, position, espn_id");
    if (playersError) throw new Error(playersError.message);

    // Build lookup maps
    const playerByEspnId = new Map(
      (players ?? []).filter((p) => p.espn_id).map((p) => [p.espn_id!, p])
    );
    // Get completed games for the ESPN week
    const games = await fetchPlayoffGames(seasonYear, parseInt(espnWeek));
    const completedGames = games.filter(
      (g) => g.competitions[0]?.competitors.length === 2
    );

    if (completedGames.length === 0) {
      await updateLog(logId, "error", `No completed games found for ESPN week ${espnWeek}`);
      return res.status(200).json({ ok: false, error: "No completed games" });
    }

    const statRows: {
      player_id: string;
      week: number;
      [key: string]: number | string;
    }[] = [];

    for (const game of completedGames) {
      const eventId = game.id;

      try {
        const boxScore = await fetchGameBoxScore(eventId);

        // Build team score lookup: teamId → score
        const teamScores = new Map([
          [boxScore.homeScore.teamId, boxScore.homeScore],
          [boxScore.awayScore.teamId, boxScore.awayScore],
        ]);

        // Get ESPN team IDs for both teams
        const homeTeamEspnId = boxScore.homeScore.teamId;
        const awayTeamEspnId = boxScore.awayScore.teamId;

        // Get our playoff teams (to find DEF player IDs)
        const { data: playoffTeams } = await adminSupabase
          .from("playoff_teams")
          .select("espn_id, abbreviation")
          .in("espn_id", [homeTeamEspnId, awayTeamEspnId]);

        const teamAbbrById = new Map(
          (playoffTeams ?? []).map((t) => [t.espn_id, t.abbreviation])
        );

        // Per-player offensive stats
        for (const [espnAthleteId, athleteStats] of boxScore.playerStats) {
          let player =
            playerByEspnId.get(espnAthleteId) ?? null;

          // Fallback name match if espn_id not stored yet
          if (!player) {
            // Try to find name in the stats (ESPN doesn't give us the name here directly,
            // but we stored it when we synced rosters)
            // Skip if we can't match
            continue;
          }

          // Skip DEF/ST players — their stats are handled separately below
          if (player.position === "DEF") continue;

          const mappedStats = mapPlayerStats(athleteStats);

          statRows.push({
            player_id: player.id,
            week,
            pass_yds: mappedStats.pass_yds ?? 0,
            pass_tds: mappedStats.pass_tds ?? 0,
            interceptions_thrown: mappedStats.interceptions_thrown ?? 0,
            sacks_taken: mappedStats.sacks_taken ?? 0,
            rush_yds: mappedStats.rush_yds ?? 0,
            rush_tds: mappedStats.rush_tds ?? 0,
            rec_yds: mappedStats.rec_yds ?? 0,
            rec_tds: mappedStats.rec_tds ?? 0,
            fumbles_lost: mappedStats.fumbles_lost ?? 0,
            xp_made: mappedStats.xp_made ?? 0,
            xp_missed: mappedStats.xp_missed ?? 0,
            fg_0_39: mappedStats.fg_0_39 ?? 0,
            fg_40_49: mappedStats.fg_40_49 ?? 0,
            fg_50_plus: mappedStats.fg_50_plus ?? 0,
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
        }

        // DEF/ST stats — one entry per team
        for (const [teamEspnId] of teamScores) {
          const teamAbbr = teamAbbrById.get(teamEspnId);
          if (!teamAbbr) continue;

          // Find DEF player for this team
          const defPlayer = (players ?? []).find(
            (p) => p.team === teamAbbr && p.position === "DEF"
          );
          if (!defPlayer) continue;

          // Opposing team's score = points this defense allowed
          const oppEspnId =
            teamEspnId === homeTeamEspnId ? awayTeamEspnId : homeTeamEspnId;
          const oppScore = teamScores.get(oppEspnId)?.score ?? 0;

          const defStats = mapDefStats(
            {}, // team-level defensive stats (ESPN doesn't always expose these here)
            {},
            oppScore,
            0   // yards allowed — would need team stats endpoint for this
          );

          statRows.push({
            player_id: defPlayer.id,
            week,
            pass_yds: 0,
            pass_tds: 0,
            interceptions_thrown: 0,
            sacks_taken: 0,
            rush_yds: 0,
            rush_tds: 0,
            rec_yds: 0,
            rec_tds: 0,
            fumbles_lost: 0,
            xp_made: 0,
            xp_missed: 0,
            fg_0_39: 0,
            fg_40_49: 0,
            fg_50_plus: 0,
            return_tds: 0,
            fumble_rec_tds: 0,
            two_pt_conversions: 0,
            def_st_tds: defStats.def_st_tds ?? 0,
            def_interceptions: defStats.def_interceptions ?? 0,
            fumble_recoveries: defStats.fumble_recoveries ?? 0,
            blocked_kicks: defStats.blocked_kicks ?? 0,
            safeties: defStats.safeties ?? 0,
            pat_safeties: 0,
            def_sacks: defStats.def_sacks ?? 0,
            yards_allowed: defStats.yards_allowed ?? 0,
            points_allowed: defStats.points_allowed ?? 0,
          });
        }
      } catch (gameErr) {
        console.error(`Failed to process game ${eventId}:`, gameErr);
        // Continue with remaining games
      }
    }

    if (statRows.length === 0) {
      await updateLog(logId, "error", "No stat rows generated — check ESPN API response or player ESPN ID matching.");
      return res.status(200).json({ ok: false, error: "No stats to insert" });
    }

    // Upsert — unique constraint on (player_id, week)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await adminSupabase
      .from("player_game_stats")
      .upsert(statRows as any[], { onConflict: "player_id,week" });

    if (upsertError) throw new Error(upsertError.message);

    const msg = `Synced ${statRows.length} player stats for week ${week} (${completedGames.length} games)`;
    await updateLog(logId, "success", msg, statRows.length);

    return res.status(200).json({ ok: true, count: statRows.length });
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
