import type { Probable } from '../espn';

export type StarterParams = {
  /** Elo per run (MLB) or goal (NHL) of starter quality relative to the team's usual starter. */
  eloPerUnit: number;
  /** Starts' worth of league-average performance every starter begins with (shrinkage). */
  shrink: number;
  /** Per-start decay of older starts, so recent form counts more. */
  decay: number;
};

type StarterState = { sum: number; weight: number; name: string };

/**
 * Rates starting pitchers / goalies from the runs or goals their team allowed
 * in their starts, relative to league average, and compares each starter with
 * the team's recent rotation. The team's Elo already reflects its usual
 * starter, so only the difference from that baseline is applied.
 */
export class StarterModel {
  private starters = new Map<string, StarterState>();
  private rotation = new Map<string, number>();
  private leagueAllowed: number | null = null;

  constructor(private params: StarterParams) {}

  /** Starter quality in units allowed per game below league average (positive = better). */
  quality(athleteId: string) {
    const s = this.starters.get(athleteId);
    return s ? -s.sum / (s.weight + this.params.shrink) : 0;
  }

  /** Elo adjustment for a team's starter; 0 when the starter is unknown. */
  adjustment(teamId: string, probable: Probable | null) {
    if (!probable) return 0;
    return this.params.eloPerUnit * (this.quality(probable.athleteId) - (this.rotation.get(teamId) ?? 0));
  }

  describe(teamId: string, probable: Probable | null, unit: string) {
    if (!probable) return 'Starter not announced';
    const s = this.starters.get(probable.athleteId);
    const vsRotation = this.quality(probable.athleteId) - (this.rotation.get(teamId) ?? 0);
    if (!s || s.weight < 1) return `${probable.name} (no track record yet)`;
    const starts = Math.round(s.weight);
    const direction = vsRotation >= 0 ? 'fewer' : 'more';
    return `${probable.name}: team allows ${Math.abs(vsRotation).toFixed(2)} ${direction} ${unit} than with its usual starter (≈${starts} weighted starts)`;
  }

  /** Records a finished game: `allowed` is what the starter's team gave up. */
  record(teamId: string, probable: Probable | null, allowed: number) {
    this.leagueAllowed = this.leagueAllowed === null ? allowed : this.leagueAllowed + (allowed - this.leagueAllowed) * 0.002;
    if (!probable) return;
    const { decay } = this.params;
    const s = this.starters.get(probable.athleteId) ?? { sum: 0, weight: 0, name: probable.name };
    // Rotation baseline uses the starter's rating as it stood before this game.
    const before = this.quality(probable.athleteId);
    const current = this.rotation.get(teamId) ?? 0;
    this.rotation.set(teamId, current + (before - current) * 0.1);
    s.sum = s.sum * decay + (allowed - this.leagueAllowed);
    s.weight = s.weight * decay + 1;
    this.starters.set(probable.athleteId, s);
  }
}
