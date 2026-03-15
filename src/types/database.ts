// Supabase database types — includes all playoff-challenge tables plus
// the new playoff-data tables: playoff_teams, sync_log, sync_schedule.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      // ── Existing playoff-challenge tables ────────────────────────────────

      profiles: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: { id: string; first_name?: string; last_name?: string };
        Update: { first_name?: string; last_name?: string; updated_at?: string };
        Relationships: [];
      };

      app_settings: {
        Row: {
          id: number;
          playoffs_start: string | null;
          playoffs_end: string | null;
          phase_override: string | null;
          demo_mode: boolean;
          updated_at: string;
        };
        Insert: {
          id?: number;
          playoffs_start?: string | null;
          playoffs_end?: string | null;
          phase_override?: string | null;
          demo_mode?: boolean;
        };
        Update: {
          playoffs_start?: string | null;
          playoffs_end?: string | null;
          phase_override?: string | null;
          demo_mode?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };

      players: {
        Row: {
          id: string;
          name: string;
          team: string;
          position: string;
          espn_id: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          name: string;
          team: string;
          position: string;
          espn_id?: string | null;
        };
        Update: {
          name?: string;
          team?: string;
          position?: string;
          espn_id?: string | null;
        };
        Relationships: [];
      };

      player_game_stats: {
        Row: {
          id: number;
          player_id: string;
          week: number;
          pass_yds: number;
          pass_tds: number;
          rush_yds: number;
          rush_tds: number;
          rec_yds: number;
          rec_tds: number;
          return_tds: number;
          fumble_rec_tds: number;
          two_pt_conversions: number;
          interceptions_thrown: number;
          fumbles_lost: number;
          sacks_taken: number;
          fg_50_plus: number;
          fg_40_49: number;
          fg_0_39: number;
          xp_made: number;
          xp_missed: number;
          def_st_tds: number;
          def_interceptions: number;
          fumble_recoveries: number;
          blocked_kicks: number;
          safeties: number;
          pat_safeties: number;
          def_sacks: number;
          yards_allowed: number;
          points_allowed: number;
        };
        Insert: {
          player_id: string;
          week: number;
          pass_yds?: number;
          pass_tds?: number;
          rush_yds?: number;
          rush_tds?: number;
          rec_yds?: number;
          rec_tds?: number;
          return_tds?: number;
          fumble_rec_tds?: number;
          two_pt_conversions?: number;
          interceptions_thrown?: number;
          fumbles_lost?: number;
          sacks_taken?: number;
          fg_50_plus?: number;
          fg_40_49?: number;
          fg_0_39?: number;
          xp_made?: number;
          xp_missed?: number;
          def_st_tds?: number;
          def_interceptions?: number;
          fumble_recoveries?: number;
          blocked_kicks?: number;
          safeties?: number;
          pat_safeties?: number;
          def_sacks?: number;
          yards_allowed?: number;
          points_allowed?: number;
        };
        Update: {
          pass_yds?: number;
          pass_tds?: number;
          rush_yds?: number;
          rush_tds?: number;
          rec_yds?: number;
          rec_tds?: number;
          return_tds?: number;
          fumble_rec_tds?: number;
          two_pt_conversions?: number;
          interceptions_thrown?: number;
          fumbles_lost?: number;
          sacks_taken?: number;
          fg_50_plus?: number;
          fg_40_49?: number;
          fg_0_39?: number;
          xp_made?: number;
          xp_missed?: number;
          def_st_tds?: number;
          def_interceptions?: number;
          fumble_recoveries?: number;
          blocked_kicks?: number;
          safeties?: number;
          pat_safeties?: number;
          def_sacks?: number;
          yards_allowed?: number;
          points_allowed?: number;
        };
        Relationships: [];
      };

      participants: {
        Row: {
          id: number;
          user_id: string | null;
          display_name: string;
          lineup_slots: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string | null;
          display_name: string;
          lineup_slots?: Json;
        };
        Update: { display_name?: string; lineup_slots?: Json; updated_at?: string };
        Relationships: [];
      };

      // ── New playoff-data tables ───────────────────────────────────────────

      playoff_teams: {
        Row: {
          id: string;
          espn_id: string;
          name: string;
          abbreviation: string;
          display_name: string;
          logo_url: string | null;
          conference: string | null;
          seed: number | null;
          synced_at: string;
        };
        Insert: {
          id: string;
          espn_id: string;
          name: string;
          abbreviation: string;
          display_name: string;
          logo_url?: string | null;
          conference?: string | null;
          seed?: number | null;
        };
        Update: {
          espn_id?: string;
          name?: string;
          abbreviation?: string;
          display_name?: string;
          logo_url?: string | null;
          conference?: string | null;
          seed?: number | null;
          synced_at?: string;
        };
        Relationships: [];
      };

      sync_log: {
        Row: {
          id: string;
          sync_type: string;
          status: string;
          message: string | null;
          week: number | null;
          records_affected: number | null;
          created_at: string;
        };
        Insert: {
          sync_type: string;
          status: string;
          message?: string | null;
          week?: number | null;
          records_affected?: number | null;
        };
        Update: {
          status?: string;
          message?: string | null;
          records_affected?: number | null;
        };
        Relationships: [];
      };

      sync_schedule: {
        Row: {
          id: number;
          stats_sync_enabled: boolean;
          stats_sync_cron: string;
          stats_current_week: number;
          updated_at: string;
        };
        Insert: {
          id?: number;
          stats_sync_enabled?: boolean;
          stats_sync_cron?: string;
          stats_current_week?: number;
        };
        Update: {
          stats_sync_enabled?: boolean;
          stats_sync_cron?: string;
          stats_current_week?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

// Convenience row types
export type PlayoffTeam = Database["public"]["Tables"]["playoff_teams"]["Row"];
export type SyncLog = Database["public"]["Tables"]["sync_log"]["Row"];
export type SyncSchedule = Database["public"]["Tables"]["sync_schedule"]["Row"];
export type Player = Database["public"]["Tables"]["players"]["Row"];
export type PlayerGameStats = Database["public"]["Tables"]["player_game_stats"]["Row"];
