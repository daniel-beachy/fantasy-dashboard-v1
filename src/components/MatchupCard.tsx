import { ArrowDownRight, ArrowUpRight, ChevronRight, Minus, Trophy } from 'lucide-react';
import type { League } from '../types';
import { formatPoints } from '../lib/dashboard';

export function MatchupCard({ league, compact = false, onSelect }: { league: League; compact?: boolean; onSelect: () => void }) {
  const margin = league.score !== null && league.opponentScore !== null ? league.score - league.opponentScore : null;
  const ahead = margin !== null && margin > 0;
  const total = (league.score ?? 0) + (league.opponentScore ?? 0);
  const percent = total > 0 ? Math.max(5, Math.min(95, (league.score ?? 0) / total * 100)) : 50;
  const descriptionId = `matchup-${league.id}-${compact ? 'compact' : 'full'}`;
  return <button className={`matchup-card ${compact ? 'matchup-compact' : ''}`} onClick={onSelect} aria-label={`Filter ${league.name}`} aria-describedby={descriptionId}>
    <span id={descriptionId} className="sr-only">{league.teamName}: {league.score ?? 'unavailable'} points, projected {league.projected ?? 'unavailable'}. Opponent {league.opponentName}: {league.opponentScore ?? 'unavailable'} points, projected {league.opponentProjected ?? 'unavailable'}. Matchup {league.matchupStatus}.</span>
    <div className="matchup-top"><span><Trophy size={13} />{league.name}</span><span className="scoring-label">{league.scoring}</span></div>
    <div className="matchup-teams"><span>{league.teamName}<small>YOU</small></span><span>{league.opponentName}<small>{league.matchupStatus === 'bye' ? 'BYE WEEK' : 'OPPONENT'}</small></span></div>
    <div className="matchup-scores"><strong className={ahead ? 'for' : ''}>{formatPoints(league.score, 2)}</strong><span>vs</span><strong>{formatPoints(league.opponentScore, 2)}</strong></div>
    <div className="matchup-bar"><span style={{ width: `${percent}%` }} /></div>
    {!compact && <div className="matchup-projections"><span>Proj. {formatPoints(league.projected)}</span><span>Proj. {formatPoints(league.opponentProjected)}</span></div>}
    <div className="matchup-bottom"><span className={margin === null || margin === 0 ? 'muted' : ahead ? 'for' : 'against'}>{margin === null || margin === 0 ? <Minus size={13} /> : ahead ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{league.matchupStatus === 'bye' ? 'On a bye' : margin === null ? 'Awaiting scores' : margin === 0 ? 'All tied up' : `${ahead ? 'Leading' : 'Trailing'} by ${Math.abs(margin).toFixed(2)}`}</span><span>{league.matchupStatus === 'final' ? 'FINAL' : 'View players'}<ChevronRight size={12} /></span></div>
  </button>;
}
