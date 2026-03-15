import { type ReactNode } from "react";
import { CheckCircle, AlertCircle, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SyncStatus = "idle" | "running" | "success" | "error";

interface SyncCardProps {
  title: string;
  description: string;
  status: SyncStatus;
  lastSynced?: string | null;
  recordCount?: number | null;
  errorMessage?: string | null;
  disabled?: boolean;
  buttonLabel: string;
  onSync: () => void;
  children?: ReactNode;
}

export default function SyncCard({
  title,
  description,
  status,
  lastSynced,
  recordCount,
  errorMessage,
  disabled,
  buttonLabel,
  onSync,
  children,
}: SyncCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="font-display font-semibold text-base text-foreground">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {recordCount != null && (
          <span className="text-foreground font-medium">{recordCount} records</span>
        )}
        {lastSynced && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(lastSynced).toLocaleString()}
          </span>
        )}
      </div>

      {errorMessage && (
        <div className="flex items-start gap-1.5 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span className="break-all">{errorMessage}</span>
        </div>
      )}

      {children}

      <Button
        onClick={onSync}
        disabled={disabled || status === "running"}
        variant={status === "error" ? "destructive" : "default"}
        size="sm"
        className="w-full sm:w-auto"
      >
        {status === "running" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {buttonLabel}
      </Button>
    </div>
  );
}

function StatusBadge({ status }: { status: SyncStatus }) {
  const config = {
    idle: { label: "Not synced", icon: null, cls: "text-muted-foreground bg-muted" },
    running: { label: "Running…", icon: <Loader2 className="h-3 w-3 animate-spin" />, cls: "text-accent-foreground bg-accent" },
    success: { label: "Synced", icon: <CheckCircle className="h-3 w-3" />, cls: "text-primary-foreground bg-primary" },
    error: { label: "Error", icon: <AlertCircle className="h-3 w-3" />, cls: "text-destructive-foreground bg-destructive" },
  }[status];

  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", config.cls)}>
      {config.icon}
      {config.label}
    </span>
  );
}
