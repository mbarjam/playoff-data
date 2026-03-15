import { useState } from "react";
import { Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import type { Player, PlayoffTeam } from "@/types/database";
import { toast } from "sonner";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

interface PlayersTableProps {
  teams: PlayoffTeam[];
  players: Player[];
  onPlayersChange: () => void;
}

export default function PlayersTable({ teams, players, onPlayersChange }: PlayersTableProps) {
  if (teams.length === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-6">
        No teams synced yet. Run "Fetch Playoff Teams" and "Sync Rosters" first.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {teams
        .sort((a, b) => (a.conference?.localeCompare(b.conference ?? "") ?? 0) || (a.seed ?? 99) - (b.seed ?? 99))
        .map((team) => {
          const teamPlayers = players.filter((p) => p.team === team.abbreviation);
          return (
            <TeamSection
              key={team.id}
              team={team}
              players={teamPlayers}
              onPlayersChange={onPlayersChange}
            />
          );
        })}
    </div>
  );
}

function TeamSection({
  team,
  players,
  onPlayersChange,
}: {
  team: PlayoffTeam;
  players: Player[];
  onPlayersChange: () => void;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      {/* Team header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        {team.logo_url && (
          <img src={team.logo_url} alt={team.abbreviation} className="h-7 w-7 object-contain" />
        )}
        <div>
          <span className="font-display font-semibold text-sm">{team.name}</span>
          {team.conference && team.seed && (
            <span className="ml-2 text-xs text-muted-foreground">
              {team.conference} #{team.seed}
            </span>
          )}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">{players.length} players</span>
      </div>

      {players.length === 0 ? (
        <p className="text-xs text-muted-foreground px-4 py-3">No players synced for this team.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-muted-foreground">
              <th className="text-left px-4 py-2 font-medium">Pos</th>
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">ESPN ID</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {POSITIONS.flatMap((pos) =>
              players
                .filter((p) => p.position === pos)
                .map((player) => (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    onPlayersChange={onPlayersChange}
                  />
                ))
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  onPlayersChange,
}: {
  player: Player;
  onPlayersChange: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.name);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || name.trim() === player.name) {
      setEditing(false);
      setName(player.name);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("players")
      .update({ name: name.trim() })
      .eq("id", player.id);
    setSaving(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      toast.success("Player name updated.");
      setEditing(false);
      onPlayersChange();
    }
  };

  const handleCancel = () => {
    setEditing(false);
    setName(player.name);
  };

  return (
    <tr className="border-b border-border/30 hover:bg-muted/10">
      <td className="px-4 py-2 font-medium text-primary">{player.position}</td>
      <td className="px-4 py-2">
        {editing ? (
          <input
            className="bg-background border border-input rounded px-2 py-0.5 text-xs w-44 focus:outline-none focus:ring-1 focus:ring-ring"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
            autoFocus
          />
        ) : (
          <span>{player.name}</span>
        )}
      </td>
      <td className="px-4 py-2 text-muted-foreground font-mono">{player.espn_id ?? "—"}</td>
      <td className="px-4 py-2">
        {editing ? (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSave} disabled={saving}>
              <Check className="h-3.5 w-3.5 text-primary" />
            </Button>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleCancel}>
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
        ) : (
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </td>
    </tr>
  );
}
