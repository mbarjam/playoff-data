import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database, Users, BarChart3, Settings, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import type { SyncLog } from "@/types/database";

interface SyncStatus {
  teams: { count: number; lastSynced: string | null };
  rosters: { count: number; lastSynced: string | null };
  stats: { count: number; lastSynced: string | null };
}

const WEEK_LABELS: Record<number, string> = {
  1: "Wild Card",
  2: "Divisional",
  3: "Conference",
  4: "Super Bowl",
};

export default function Dashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SyncStatus>({
    teams: { count: 0, lastSynced: null },
    rosters: { count: 0, lastSynced: null },
    stats: { count: 0, lastSynced: null },
  });
  const [recentLogs, setRecentLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    setLoading(true);
    const [teamsRes, playersRes, statsRes, logsRes] = await Promise.all([
      supabase.from("playoff_teams").select("synced_at").order("synced_at", { ascending: false }).limit(1),
      supabase.from("players").select("id", { count: "exact", head: false }).limit(1),
      supabase.from("player_game_stats").select("id", { count: "exact", head: false }).limit(1),
      supabase.from("sync_log").select("*").order("created_at", { ascending: false }).limit(5),
    ]);

    const teamsCount = teamsRes.data?.length ? await supabase.from("playoff_teams").select("id", { count: "exact", head: true }) : { count: 0 };

    setStatus({
      teams: {
        count: (teamsCount as { count: number | null }).count ?? 0,
        lastSynced: teamsRes.data?.[0]?.synced_at ?? null,
      },
      rosters: {
        count: playersRes.count ?? 0,
        lastSynced: logsRes.data?.find((l) => l.sync_type === "rosters" && l.status === "success")?.created_at ?? null,
      },
      stats: {
        count: statsRes.count ?? 0,
        lastSynced: logsRes.data?.find((l) => l.sync_type === "stats" && l.status === "success")?.created_at ?? null,
      },
    });
    setRecentLogs(logsRes.data ?? []);
    setLoading(false);
  }

  const cards = [
    {
      icon: <Database className="h-5 w-5 text-primary" />,
      label: "Playoff Teams",
      value: status.teams.count,
      sub: status.teams.lastSynced
        ? `Last synced ${new Date(status.teams.lastSynced).toLocaleDateString()}`
        : "Not yet synced",
    },
    {
      icon: <Users className="h-5 w-5 text-accent" />,
      label: "Players",
      value: status.rosters.count,
      sub: status.rosters.lastSynced
        ? `Last synced ${new Date(status.rosters.lastSynced).toLocaleDateString()}`
        : "Not yet synced",
    },
    {
      icon: <BarChart3 className="h-5 w-5 text-positive" />,
      label: "Stat Rows",
      value: status.stats.count,
      sub: status.stats.lastSynced
        ? `Last synced ${new Date(status.stats.lastSynced).toLocaleDateString()}`
        : "Not yet synced",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold text-sm">Playoff Data</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate("/admin")}>
            <Settings className="h-3.5 w-3.5" />
            Admin
          </Button>
          <Button size="sm" variant="ghost" onClick={logout}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-display font-bold">Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-1">
            ESPN data sync status for the 2025 NFL playoffs
          </p>
        </div>

        {/* Status cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {cards.map((card) => (
            <div key={card.label} className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2 animate-slide-up">
              <div className="flex items-center gap-2">
                {card.icon}
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {card.label}
                </span>
              </div>
              {loading ? (
                <div className="h-7 w-12 bg-muted/50 rounded animate-pulse" />
              ) : (
                <p className="text-3xl font-display font-bold text-foreground">{card.value}</p>
              )}
              <p className="text-xs text-muted-foreground">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Quick action */}
        <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
          <h2 className="text-sm font-display font-semibold">Quick Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigate("/admin")}>
              <Settings className="h-3.5 w-3.5" />
              Open Admin Panel
            </Button>
            <Button size="sm" variant="outline" onClick={fetchStatus}>
              Refresh Status
            </Button>
          </div>
        </div>

        {/* Recent activity */}
        <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-3">
          <h2 className="text-sm font-display font-semibold">Recent Activity</h2>
          {recentLogs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sync activity yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {recentLogs.map((log) => (
                <div key={log.id} className="flex items-center gap-3 text-xs">
                  <span
                    className={
                      log.status === "success"
                        ? "text-positive font-medium"
                        : log.status === "error"
                        ? "text-destructive font-medium"
                        : "text-accent font-medium"
                    }
                  >
                    {log.status}
                  </span>
                  <span className="text-muted-foreground capitalize">{log.sync_type}</span>
                  {log.week && (
                    <span className="text-muted-foreground">
                      {WEEK_LABELS[log.week] ?? `Wk ${log.week}`}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-auto">
                    {new Date(log.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
