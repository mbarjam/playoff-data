// ESPN unofficial API helpers.
// These endpoints are publicly accessible but not officially supported —
// add error handling around every call.

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";

// ── Types ──────────────────────────────────────────────────────────────────

export interface EspnTeam {
  id: string;           // ESPN numeric team ID
  abbreviation: string; // "KC"
  displayName: string;  // "Kansas City Chiefs"
  shortDisplayName: string; // "Chiefs"
  logos?: { href: string }[];
}

export interface EspnGame {
  id: string;
  status: { type: { completed: boolean } };
  competitions: {
    id: string;
    competitors: {
      team: EspnTeam;
      homeAway: "home" | "away";
      score?: string;
    }[];
  }[];
  season: { year: number };
}

export interface EspnAthlete {
  id: string;
  displayName: string;
  fullName: string;
  position: { abbreviation: string };
  injuries?: { status: string }[];
}

export interface EspnRosterAthlete {
  id: string;
  displayName: string;
  fullName: string;
  position: { abbreviation: string };
  injuries?: { displayType: string }[];
}

export interface EspnDepthChartEntry {
  slot: number;
  athlete: { $ref: string };
}

// ── Playoff games ──────────────────────────────────────────────────────────

/**
 * Fetch all playoff games for a given season.
 * seasontype=3 = NFL playoffs. Weeks: 1=WC, 2=Div, 3=Conf, 5=SB
 */
export async function fetchPlayoffGames(
  seasonYear = 2025,
  week?: number
): Promise<EspnGame[]> {
  const weekParam = week ? `&week=${week}` : "";
  const url = `${ESPN_BASE}/scoreboard?seasontype=3&season=${seasonYear}${weekParam}&limit=50`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN scoreboard fetch failed: ${res.status}`);
  const data = await res.json() as { events?: EspnGame[] };
  return data.events ?? [];
}

/**
 * Returns all unique teams that appear in playoff games.
 * Includes conference seeding from standings if available.
 */
export async function fetchPlayoffTeams(seasonYear = 2025): Promise<EspnTeam[]> {
  const games = await fetchPlayoffGames(seasonYear);
  const seen = new Map<string, EspnTeam>();
  for (const game of games) {
    for (const comp of game.competitions) {
      for (const competitor of comp.competitors) {
        if (!seen.has(competitor.team.id)) {
          seen.set(competitor.team.id, competitor.team);
        }
      }
    }
  }
  return Array.from(seen.values());
}

// ── Team roster ────────────────────────────────────────────────────────────

interface RosterGroup {
  position: string; // "Offense" | "Defense" | "Special Teams"
  items: EspnRosterAthlete[];
}

/**
 * Fetch a team's full roster. Returns athletes grouped by unit.
 */
export async function fetchTeamRoster(
  espnTeamId: string
): Promise<EspnRosterAthlete[]> {
  const url = `${ESPN_BASE}/teams/${espnTeamId}/roster`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN roster fetch failed for team ${espnTeamId}: ${res.status}`);
  const data = await res.json() as { athletes?: RosterGroup[] };
  const athletes: EspnRosterAthlete[] = [];
  for (const group of data.athletes ?? []) {
    athletes.push(...group.items);
  }
  return athletes;
}

// ── Depth charts ───────────────────────────────────────────────────────────

interface DepthChartResponse {
  items?: {
    positions?: Record<string, {
      position: { abbreviation: string };
      athletes: EspnDepthChartEntry[];
    }>;
  }[];
}

/**
 * Fetch the depth chart for a team and return athletes by position slug,
 * ordered by depth (slot 1 = starter).
 * Returns a map: position abbreviation (e.g. "QB") → ordered athlete IDs.
 */
export async function fetchDepthChart(
  espnTeamId: string,
  seasonYear = 2025
): Promise<Map<string, string[]>> {
  const url = `${ESPN_CORE}/seasons/${seasonYear}/teams/${espnTeamId}/depthcharts`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN depth chart failed for team ${espnTeamId}: ${res.status}`);
  const data = await res.json() as DepthChartResponse;

  const result = new Map<string, string[]>();
  for (const item of data.items ?? []) {
    for (const [, posData] of Object.entries(item.positions ?? {})) {
      const abbr = posData.position.abbreviation.toUpperCase();
      const ordered = posData.athletes
        .sort((a, b) => a.slot - b.slot)
        .map((e) => {
          // Extract athlete ID from the $ref URL like ".../athletes/3139477"
          const match = e.athlete.$ref.match(/athletes\/(\d+)/);
          return match ? match[1] : "";
        })
        .filter(Boolean);
      result.set(abbr, ordered);
    }
  }
  return result;
}

// ── Game box score ─────────────────────────────────────────────────────────

interface BoxscoreAthlete {
  athlete: { id: string; displayName: string };
  stats: string[];
}

interface BoxscoreCategory {
  name: string;    // "passing" | "rushing" | "receiving" | "fumbles" | "kicking" | "defensive"
  keys: string[];
  athletes: BoxscoreAthlete[];
}

interface BoxscoreTeam {
  team: { id: string; abbreviation: string };
  statistics: BoxscoreCategory[];
}

export interface TeamScore {
  teamId: string;
  score: number;
  totalYards: number;
}

export interface GameBoxScore {
  homeScore: TeamScore;
  awayScore: TeamScore;
  playerStats: Map<string, Record<string, string>>; // athleteId → { statKey: value }
  teamTotals: Map<string, Record<string, string>>;  // teamId → stat totals
}

/**
 * Fetch a completed game's box score and return structured stats.
 */
export async function fetchGameBoxScore(eventId: string): Promise<GameBoxScore> {
  const url = `${ESPN_BASE}/summary?event=${eventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN summary fetch failed for event ${eventId}: ${res.status}`);
  const data = await res.json() as {
    boxscore?: { players?: BoxscoreTeam[] };
    header?: {
      competitions?: {
        competitors: { team: { id: string }; score: string; homeAway: string }[];
      }[];
    };
  };

  const playerStats = new Map<string, Record<string, string>>();
  const teamTotals = new Map<string, Record<string, string>>();

  // Parse per-player stats
  for (const teamData of data.boxscore?.players ?? []) {
    const teamId = teamData.team.id;
    const teamRecord: Record<string, string> = {};
    teamTotals.set(teamId, teamRecord);

    for (const category of teamData.statistics) {
      for (const athleteEntry of category.athletes) {
        const athleteId = athleteEntry.athlete.id;
        if (!playerStats.has(athleteId)) {
          playerStats.set(athleteId, {});
        }
        const record = playerStats.get(athleteId)!;
        category.keys.forEach((key, i) => {
          record[`${category.name}.${key}`] = athleteEntry.stats[i] ?? "0";
        });
      }
    }
  }

  // Parse scores
  let homeScore: TeamScore = { teamId: "", score: 0, totalYards: 0 };
  let awayScore: TeamScore = { teamId: "", score: 0, totalYards: 0 };
  const competitors = data.header?.competitions?.[0]?.competitors ?? [];
  for (const c of competitors) {
    const ts: TeamScore = { teamId: c.team.id, score: parseInt(c.score ?? "0"), totalYards: 0 };
    if (c.homeAway === "home") homeScore = ts;
    else awayScore = ts;
  }

  return { homeScore, awayScore, playerStats, teamTotals };
}

// ── Stat mapping helpers ───────────────────────────────────────────────────

/**
 * Parse a fraction string like "2/3" and return the numerator as a number.
 */
export function parseFraction(val: string): number {
  const n = parseInt(val?.split("/")[0] ?? "0");
  return isNaN(n) ? 0 : n;
}

export function parseNum(val: string | undefined): number {
  const n = parseFloat(val ?? "0");
  return isNaN(n) ? 0 : n;
}

/**
 * Map ESPN box score stat entries to player_game_stats columns.
 * Returns an object with only the fields that are non-zero.
 */
export function mapPlayerStats(
  stats: Record<string, string>
): Partial<Record<string, number>> {
  const s = stats;
  const get = (key: string) => parseNum(s[key]);
  const getFrac = (key: string) => parseFraction(s[key] ?? "0");

  return {
    // Passing
    pass_yds: get("passing.passingYards"),
    pass_tds: get("passing.passingTouchdowns"),
    interceptions_thrown: get("passing.interceptions"),
    sacks_taken: getFrac("passing.sacks"),

    // Rushing
    rush_yds: get("rushing.rushingYards"),
    rush_tds: get("rushing.rushingTouchdowns"),

    // Receiving
    rec_yds: get("receiving.receivingYards"),
    rec_tds: get("receiving.receivingTouchdowns"),

    // Fumbles
    fumbles_lost: get("fumbles.fumblesLost"),

    // Kicking — XPs
    xp_made: getFrac("kicking.extraPoints"),
    xp_missed: (() => {
      const xpStr = s["kicking.extraPoints"] ?? "0/0";
      const parts = xpStr.split("/");
      const made = parseInt(parts[0] ?? "0");
      const att = parseInt(parts[1] ?? "0");
      return isNaN(att - made) ? 0 : Math.max(0, att - made);
    })(),

    // Kicking — FGs (ESPN returns "made/att" for each range)
    // Keys observed: kicking.0-19, kicking.20-29, kicking.30-39, kicking.40-49, kicking.50+
    fg_0_39: (() => {
      return (
        getFrac("kicking.0-19") +
        getFrac("kicking.20-29") +
        getFrac("kicking.30-39")
      );
    })(),
    fg_40_49: getFrac("kicking.40-49"),
    fg_50_plus: getFrac("kicking.50+"),
  };
}

/**
 * Map team-level defensive stats from the opposing team's offense.
 * oppScore = points the team's defense allowed.
 * oppTotalYards = total yards allowed by the defense.
 */
export function mapDefStats(
  defTeamStats: Record<string, string>,
  _oppTeamStats: Record<string, string>,
  oppScore: number,
  oppTotalYards: number
): Partial<Record<string, number>> {
  const get = (key: string) => parseNum(defTeamStats[key]);
  return {
    def_sacks: get("defensive.sacks"),
    def_interceptions: get("defensive.interceptions"),
    fumble_recoveries: get("defensive.fumblesRecovered"),
    def_st_tds: get("defensive.defensiveTouchdowns"),
    safeties: get("defensive.safeties"),
    points_allowed: oppScore,
    yards_allowed: oppTotalYards,
  };
}

// ── ID generation ──────────────────────────────────────────────────────────

/**
 * Generate a player ID matching the playoff-challenge format: "{first-last}-{TEAM}"
 * e.g. "patrick-mahomes-KC"
 */
export function generatePlayerId(fullName: string, teamAbbr: string): string {
  const slug = fullName
    .toLowerCase()
    .replace(/['']/g, "")       // remove apostrophes
    .replace(/\./g, "")         // remove periods (T.J. → tj)
    .replace(/[^a-z0-9]+/g, "-") // spaces/special chars → hyphens
    .replace(/^-+|-+$/g, "");   // trim leading/trailing hyphens
  return `${slug}-${teamAbbr.toUpperCase()}`;
}

// ── Season year ────────────────────────────────────────────────────────────

/**
 * Returns the current NFL season year for playoffs.
 * Playoffs in Jan/Feb use the previous calendar year as season year.
 * e.g. games in Jan 2026 → season 2025.
 */
export function currentNflSeasonYear(): number {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-based
  // NFL season runs Sep–Feb; playoffs are Jan–Feb of the *next* calendar year
  return month <= 8 ? now.getFullYear() - 1 : now.getFullYear();
}

// ── ESPN week → playoff-challenge week mapping ─────────────────────────────
// ESPN seasontype=3: week 1=Wild Card, 2=Divisional, 3=Conference, 5=Super Bowl
export const ESPN_WEEK_MAP: Record<number, number> = {
  1: 1, // Wild Card
  2: 2, // Divisional
  3: 3, // Conference Championships
  5: 4, // Super Bowl
};

export const PLAYOFF_WEEK_LABELS: Record<number, string> = {
  1: "Wild Card",
  2: "Divisional",
  3: "Conference Championships",
  4: "Super Bowl",
};
