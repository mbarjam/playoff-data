import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Database, ArrowLeft, RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import SyncCard from "@/components/SyncCard";
import SyncLog from "@/components/SyncLog";
import PlayersTable from "@/components/PlayersTable";
import type { SyncLog as SyncLogRow, SyncSchedule, PlayoffTeam, Player } from "@/types/database";

type SyncType = "teams" | "rosters" | "stats";
type SyncStatus = "idle" | "running" | "success" | "error";

interface SyncState {
  status: SyncStatus;
  lastSynced: string | null;
  recordCount: number | null;
  errorMessage: string | null;
}

const WEEK_OPTIONS = [
  { value: 1, label: "Week 1 — Wild Card" },
  { value: 2, label: "Week 2 — Divisional" },
  { value: 3, label: "Week 3 — Conference Championships" },
  { value: 4, label: "Week 4 — Super Bowl" },
];

const inputCls =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";

export default function Admin() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  // Sync states
  const [syncState, setSyncState] = useState<Record<SyncType, SyncState>>({
    teams: { status: "idle", lastSynced: null, recordCount: null, errorMessage: null },
    rosters: { status: "idle", lastSynced: null, recordCount: null, errorMessage: null },
    stats: { status: "idle", lastSynced: null, recordCount: null, errorMessage: null },
  });
  const [selectedWeek, setSelectedWeek] = useState(1);

  // Schedule settings
  const [schedule, setSchedule] = useState<SyncSchedule | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleCron, setScheduleCron] = useState("0 12 * * 2");
  const [scheduleWeek, setScheduleWeek] = useState(1);
  const [savingSchedule, setSavingSchedule] = useState(false);

  // Data
  const [teams, setTeams] = useState<PlayoffTeam[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [logs, setLogs] = useState<SyncLogRow[]>([]);

  const loadData = useCallback(async () => {
    const [teamsRes, playersRes, logsRes, schedRes] = await Promise.all([
      supabase.from("playoff_teams").select("*").order("conference").order("seed"),
      supabase.from("players").select("*").order("team").order("position"),
      supabase.from("sync_log").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("sync_schedule").select("*").eq("id", 1).single(),
    ]);

    if (teamsRes.data) setTeams(teamsRes.data);
    if (playersRes.data) setPlayers(playersRes.data);
    if (logsRes.data) setLogs(logsRes.data);
    if (schedRes.data) {
      const s = schedRes.data;
      setSchedule(s);
      setScheduleEnabled(s.stats_sync_enabled);
      setScheduleCron(s.stats_sync_cron);
      setScheduleWeek(s.stats_current_week);
    }

    // Derive sync state from log history
    const lastSuccess = (type: SyncType) =>
      logsRes.data?.find((l) => l.sync_type === type && l.status === "success") ?? null;
    const lastError = (type: SyncType) =>
      logsRes.data?.find((l) => l.sync_type === type && l.status === "error") ?? null;

    setSyncState((prev) => {
      const updated = { ...prev };
      (["teams", "rosters", "stats"] as SyncType[]).forEach((type) => {
        const success = lastSuccess(type);
        const error = lastError(type);
        if (success) {
          updated[type] = {
            status: "success",
            lastSynced: success.created_at,
            recordCount: success.records_affected,
            errorMessage: null,
          };
        } else if (error) {
          updated[type] = {
            status: "error",
            lastSynced: null,
            recordCount: null,
            errorMessage: error.message,
          };
        }
      });
      return updated;
    });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Sync actions ──────────────────────────────────────────────────────────

  const runSync = async (type: SyncType, body: Record<string, unknown> = {}) => {
    setSyncState((prev) => ({
      ...prev,
      [type]: { ...prev[type], status: "running", errorMessage: null },
    }));

    try {
      const res = await fetch(`/api/sync-${type}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json() as { ok: boolean; error?: string; count?: number };

      if (json.ok) {
        setSyncState((prev) => ({
          ...prev,
          [type]: {
            status: "success",
            lastSynced: new Date().toISOString(),
            recordCount: json.count ?? null,
            errorMessage: null,
          },
        }));
        toast.success(
          type === "teams"
            ? `Synced ${json.count} playoff teams`
            : type === "rosters"
            ? `Synced ${json.count} players`
            : `Synced ${json.count} stat rows for week ${selectedWeek}`
        );
        await loadData();
      } else {
        throw new Error(json.error ?? "Unknown error");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSyncState((prev) => ({
        ...prev,
        [type]: { ...prev[type], status: "error", errorMessage: msg },
      }));
      toast.error(`Sync failed: ${msg}`);
      await loadData(); // reload logs
    }
  };

  const handleSaveSchedule = async () => {
    setSavingSchedule(true);
    const { error } = await supabase
      .from("sync_schedule")
      .update({
        stats_sync_enabled: scheduleEnabled,
        stats_sync_cron: scheduleCron,
        stats_current_week: scheduleWeek,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);
    setSavingSchedule(false);
    if (error) {
      toast.error("Failed to save schedule: " + error.message);
    } else {
      toast.success("Schedule saved.");
    }
  };

  const teamsReady = syncState.teams.status === "success" || (teams.length > 0);

  return (
    <>
      <Toaster richColors position="top-right" />
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => navigate("/dashboard")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-primary" />
              <span className="font-display font-semibold text-sm">Admin Panel</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={loadData}>
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" variant="ghost" onClick={logout}>
              Sign out
            </Button>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-8">

          {/* ── Section 1: Sync Actions ─────────────────────────────────── */}
          <section className="flex flex-col gap-4">
            <SectionHeader title="Sync Actions" desc="Fetch data from the ESPN API into Supabase" />

            <SyncCard
              title="1 — Playoff Teams"
              description="Fetch all 14 teams in the 2025 NFL playoffs from ESPN. Run this first."
              status={syncState.teams.status}
              lastSynced={syncState.teams.lastSynced}
              recordCount={syncState.teams.recordCount}
              errorMessage={syncState.teams.errorMessage}
              buttonLabel={syncState.teams.status === "success" ? "Re-fetch Teams" : "Fetch Playoff Teams"}
              onSync={() => runSync("teams")}
            />

            <SyncCard
              title="2 — Player Rosters"
              description="Pull the starting QB, top 2 RB/WR/TE, K, and auto-add DEF/ST for each playoff team using ESPN depth charts."
              status={syncState.rosters.status}
              lastSynced={syncState.rosters.lastSynced}
              recordCount={syncState.rosters.recordCount}
              errorMessage={syncState.rosters.errorMessage}
              disabled={!teamsReady}
              buttonLabel={syncState.rosters.status === "success" ? "Re-sync Rosters" : "Sync Rosters"}
              onSync={() => runSync("rosters")}
            >
              {!teamsReady && (
                <p className="text-xs text-muted-foreground">
                  Run "Fetch Playoff Teams" first to enable this.
                </p>
              )}
            </SyncCard>

            <SyncCard
              title="3 — Player Stats"
              description="Fetch game stats from ESPN box scores for each player in the database."
              status={syncState.stats.status}
              lastSynced={syncState.stats.lastSynced}
              recordCount={syncState.stats.recordCount}
              errorMessage={syncState.stats.errorMessage}
              buttonLabel={`Sync Stats for ${WEEK_OPTIONS.find((w) => w.value === selectedWeek)?.label ?? "Week " + selectedWeek}`}
              onSync={() => runSync("stats", { week: selectedWeek })}
            >
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">Week:</label>
                <select
                  className={inputCls + " max-w-[260px]"}
                  value={selectedWeek}
                  onChange={(e) => setSelectedWeek(Number(e.target.value))}
                >
                  {WEEK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </SyncCard>
          </section>

          {/* ── Section 2: Schedule ─────────────────────────────────────── */}
          <section className="flex flex-col gap-4">
            <SectionHeader title="Auto-Sync Schedule" desc="Configure Vercel Cron to automatically sync stats on a schedule" />
            <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Enable automatic stats sync</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When enabled, the Vercel cron job will call /api/sync-stats automatically
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                  />
                  <div className="w-10 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
                </label>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Cron Schedule
                </label>
                <input
                  className={inputCls}
                  value={scheduleCron}
                  onChange={(e) => setScheduleCron(e.target.value)}
                  placeholder="0 12 * * 2"
                  disabled={!scheduleEnabled}
                />
                <p className="text-xs text-muted-foreground">
                  Standard cron syntax. Default: <code className="text-foreground">0 12 * * 2</code> = every Tuesday at 12:00 UTC.
                  Note: the vercel.json cron schedule is separate — update both when changing.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Current Week (auto-sync will use this)
                </label>
                <select
                  className={inputCls + " max-w-[260px]"}
                  value={scheduleWeek}
                  onChange={(e) => setScheduleWeek(Number(e.target.value))}
                  disabled={!scheduleEnabled}
                >
                  {WEEK_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {schedule && (
                <p className="text-xs text-muted-foreground">
                  Last updated: {new Date(schedule.updated_at).toLocaleString()}
                </p>
              )}

              <Button size="sm" onClick={handleSaveSchedule} disabled={savingSchedule} className="w-full sm:w-auto">
                <Save className="h-3.5 w-3.5" />
                {savingSchedule ? "Saving…" : "Save Schedule"}
              </Button>
            </div>
          </section>

          {/* ── Section 3: Players Editor ────────────────────────────────── */}
          <section className="flex flex-col gap-4">
            <SectionHeader
              title="Players Editor"
              desc="Review and edit players synced from ESPN depth charts. Click the pencil icon to rename a player."
            />
            <PlayersTable
              teams={teams}
              players={players}
              onPlayersChange={loadData}
            />
          </section>

          {/* ── Section 4: Sync Log ──────────────────────────────────────── */}
          <section className="flex flex-col gap-4">
            <SectionHeader title="Sync Log" desc="Last 50 sync operations" />
            <div className="bg-card border border-border rounded-xl p-5">
              <SyncLog entries={logs} />
            </div>
          </section>

        </main>
      </div>
    </>
  );
}

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h2 className="text-base font-display font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
    </div>
  );
}
