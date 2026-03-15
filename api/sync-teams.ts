import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminSupabase } from "./lib/supabase";
import { fetchPlayoffTeams, currentNflSeasonYear } from "./lib/espn";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const seasonYear: number = (req.body as { seasonYear?: number })?.seasonYear ?? currentNflSeasonYear();

  // Log as running
  const { data: logRow } = await adminSupabase
    .from("sync_log")
    .insert({ sync_type: "teams", status: "running", message: `Fetching season ${seasonYear} playoff teams` })
    .select("id")
    .single();
  const logId = logRow?.id;

  try {
    const teams = await fetchPlayoffTeams(seasonYear);

    if (teams.length === 0) {
      await updateLog(logId, "error", "No playoff teams found — playoffs may not have started yet.");
      return res.status(200).json({ ok: false, error: "No teams found" });
    }

    // Upsert all playoff teams
    const rows = teams.map((t) => ({
      id: t.abbreviation,
      espn_id: t.id,
      name: t.displayName,
      abbreviation: t.abbreviation,
      display_name: t.shortDisplayName,
      logo_url: t.logos?.[0]?.href ?? null,
      synced_at: new Date().toISOString(),
    }));

    const { error: upsertError } = await adminSupabase
      .from("playoff_teams")
      .upsert(rows, { onConflict: "id" });

    if (upsertError) throw new Error(upsertError.message);

    await updateLog(logId, "success", `Fetched ${teams.length} playoff teams`, teams.length);

    return res.status(200).json({
      ok: true,
      teams: teams.map((t) => t.abbreviation),
      count: teams.length,
    });
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
