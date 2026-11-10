import type { BoxScore, NhlGoalieLine } from '../boxscores';
import type { Probable } from '../espn';

export type GoalieParams = {
  /** Per-game decay of a goalie's older games. */
  decay: number;
  /** Shots of league-average goaltending every goalie starts with (shrinkage). */
  priorShots: number;
  /** Elo points per goal saved above average. */
  eloPerGoal: number;
  /** How fast a team's baseline goalie quality follows its recent starters. */
  rotationAlpha: number;
};

type GoalieState = { name: string; team: string; saved: number; shots: number; starts: number };

/** Shots a typical team faces per game; turns a save-rate edge into goals. */
const SHOTS_PER_GAME = 29;

/**
 * Rates goalies by goals saved above average per shot faced, from box scores.
 * That isolates the goalie from the skaters in front of him, which raw goals
 * allowed doesn't. Like the team ratings, only the gap between tonight's
 * starter and the team's recent starters moves the forecast.
 */
export class GoalieModel {
  private goalies = new Map<string, GoalieState>();
  private rotation = new Map<string, number>();
  private leagueSv = 0.9;

  constructor(private params: GoalieParams) {}

  /** Goals saved above average per shot (0.01 = one extra save per 100 shots). */
  quality(athleteId: string) {
    const g = this.goalies.get(athleteId);
    return g ? g.saved / (g.shots + this.params.priorShots) : 0;
  }

  /** Elo for a team's starter against its usual starters; 0 when unknown. */
  adjustment(teamId: string, starterId: string | null) {
    if (!starterId) return 0;
    return this.params.eloPerGoal * SHOTS_PER_GAME * (this.quality(starterId) - (this.rotation.get(teamId) ?? 0));
  }

  describe(teamId: string, starter: Pick<Probable, 'athleteId' | 'name'> | null) {
    if (!starter) return 'Starter not announced';
    const g = this.goalies.get(starter.athleteId);
    if (!g || g.shots < 50) return `${starter.name} (little NHL history)`;
    const vsAverage = this.quality(starter.athleteId) * 100;
    const vsUsual = (this.quality(starter.athleteId) - (this.rotation.get(teamId) ?? 0)) * SHOTS_PER_GAME;
    return `${starter.name}: ${vsAverage >= 0 ? '+' : '−'}${Math.abs(vsAverage).toFixed(1)} saves per 100 shots vs. average, ${
      vsUsual >= 0 ? '+' : '−'
    }${Math.abs(vsUsual).toFixed(2)} goals vs. the team's usual starter`;
  }

  /** Records a finished game: rotation first (with pre-game ratings), then each goalie's shots. */
  record(teamId: string, starterId: string | null, lines: NhlGoalieLine[]) {
    const { decay, rotationAlpha } = this.params;
    if (starterId) {
      const current = this.rotation.get(teamId) ?? 0;
      this.rotation.set(teamId, current + rotationAlpha * (this.quality(starterId) - current));
    }
    for (const line of lines) {
      if (line.sa <= 0) continue;
      const g = this.goalies.get(line.id) ?? { name: line.name, team: teamId, saved: 0, shots: 0, starts: 0 };
      const expectedGoals = line.sa * (1 - this.leagueSv);
      g.saved = g.saved * decay + (expectedGoals - line.ga);
      g.shots = g.shots * decay + line.sa;
      g.starts += line.id === starterId ? 1 : 0;
      g.team = teamId;
      this.goalies.set(line.id, g);
      this.leagueSv += 0.002 * ((line.sa - line.ga) / line.sa - this.leagueSv);
    }
  }
}

/** Tonight's starter: ESPN's announced goalie, else whoever played most in the box score. */
export function startingGoalie(probable: Probable | null, box: Extract<BoxScore, { league: 'nhl' }> | null, teamId: string) {
  if (probable?.role === 'goalie') return probable.athleteId;
  const lines = box?.teams[teamId]?.goalies ?? [];
  return lines.length ? [...lines].sort((a, b) => b.toi - a.toi)[0].id : null;
}
