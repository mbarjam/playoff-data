import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import type { SyncLog as SyncLogRow } from "@/types/database";
import { cn } from "@/lib/utils";

const WEEK_LABELS: Record<number, string> = {
  1: "Wild Card",
  2: "Divisional",
  3: "Conference",
  4: "Super Bowl",
};

const TYPE_LABELS: Record<string, string> = {
  teams: "Playoff Teams",
  rosters: "Rosters",
  stats: "Player Stats",
};

export default function SyncLog({ entries }: { entries: SyncLogRow[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-6">
        No sync activity yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="text-left pb-2 font-medium pr-4">Time</th>
            <th className="text-left pb-2 font-medium pr-4">Type</th>
            <th className="text-left pb-2 font-medium pr-4">Week</th>
            <th className="text-left pb-2 font-medium pr-4">Status</th>
            <th className="text-left pb-2 font-medium pr-4">Records</th>
            <th className="text-left pb-2 font-medium">Message</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/20">
              <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                {new Date(entry.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="py-2 pr-4 font-medium">
                {TYPE_LABELS[entry.sync_type] ?? entry.sync_type}
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {entry.week ? WEEK_LABELS[entry.week] ?? `Wk ${entry.week}` : "—"}
              </td>
              <td className="py-2 pr-4">
                <StatusChip status={entry.status} />
              </td>
              <td className="py-2 pr-4 text-muted-foreground">
                {entry.records_affected ?? "—"}
              </td>
              <td className="py-2 text-muted-foreground max-w-[240px] truncate">
                {entry.message ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map = {
    success: { cls: "text-primary", icon: <CheckCircle className="h-3 w-3" /> },
    error: { cls: "text-destructive", icon: <AlertCircle className="h-3 w-3" /> },
    running: { cls: "text-accent", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  } as Record<string, { cls: string; icon: React.ReactNode }>;
  const cfg = map[status] ?? { cls: "text-muted-foreground", icon: null };
  return (
    <span className={cn("flex items-center gap-1 font-medium capitalize", cfg.cls)}>
      {cfg.icon}
      {status}
    </span>
  );
}
